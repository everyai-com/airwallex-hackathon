import { balanceOf, getBalances, waitForAvailableBalance } from '../../api/balances.js';
import {
  addInvoiceLineItems,
  createInvoice,
  ensureBillingCustomer,
  finalizeInvoice,
  getInvoice,
  markInvoicePaid,
  type BillingCustomer,
  type BillingInvoice,
  type BillingLine,
} from '../../api/billing.js';
import { ensureGlobalAccount, simulateDeposit } from '../../api/global-accounts.js';
import { createAnalyst, type ContractReading } from '../../core/analyst.js';
import { ApprovalGate } from '../../core/approvals.js';
import type { AirwallexClient } from '../../core/client.js';
import type { Logger } from '../../core/log.js';
import { formatAmount, round2 } from '../../core/money.js';
import { CONTRACTS, DELIVERY_CONFIRMATION, type ContractCase } from './contracts.js';
import {
  assertBillingIdentity,
  contractTotal,
  decideBilling,
  deliveryConfirmed,
  lineTotal,
  parseContract,
  type BillingDecision,
  type ParsedContract,
  type ParsedLine,
  type ParsedMilestone,
} from './policy.js';

export interface Kit14Options {
  autoApprove?: boolean;
  /** Force the deterministic analyst (tests, reproducible demos). */
  forceHeuristicAnalyst?: boolean;
}

export interface Kit14Result {
  decisions: BillingDecision[];
  invoices: BillingInvoice[];
  paidTotal: number;
  openTotal: number;
  escalationNote?: string;
  wallet: Record<string, number>;
}

/**
 * Contract-to-Cash Billing Agent — the challenge's billing loop: read inbound
 * contracts, decide what bills now and what waits, issue real one-off invoices
 * through the Billing API, collect by bank transfer and reconcile every dollar.
 */
export async function runKit14(
  client: AirwallexClient,
  logger: Logger,
  options: Kit14Options = {},
): Promise<Kit14Result> {
  const ids = client.requestIds();
  const gate = new ApprovalGate({ autoApprove: options.autoApprove });
  const analyst = createAnalyst({
    ...(options.forceHeuristicAnalyst ? { forceHeuristic: true } : {}),
    ...(client.config.anthropicApiKey ? { apiKey: client.config.anthropicApiKey } : {}),
    model: client.config.anthropicModel,
  });

  client.seedMockBalances({ USD: 30_000 });
  const openingBalances = await getBalances(client);
  const startingUsd = balanceOf(openingBalances, 'USD');

  logger.chapter('Contract-to-Cash Billing Agent — observe → decide → act → reconcile');
  logger.info(
    'Goal: turn three inbound contracts into billed, collected cash — clean lines now, milestones on their triggers, disputes escalated with approval.',
  );
  logger.detail(
    'Analyst',
    `${analyst.kind} — flags the billing shape of each contract; every line, amount and threshold is code`,
  );

  const parsed = new Map<string, ParsedContract>();
  logger.chapter('Observe — the analyst reads, the parser measures');
  for (const contract of CONTRACTS) {
    const reading = await analyst.readContract({
      customer: contract.customer,
      reference: contract.reference,
      text: contract.text,
    });
    const terms = parseContract(contract.reference, contract.customer, contract.currency, contract.text);
    parsed.set(contract.id, terms);
    logger.detail(
      `${contract.reference} · ${contract.customer}`,
      `${reading.rationale} Total ${formatAmount(contractTotal(terms), terms.currency)}, Net ${terms.netDays}.`,
    );
    for (const quote of reading.citedEvidence) logger.detail('Cited', `"${quote}"`);
  }

  const customers = new Map<string, BillingCustomer>();
  await logger.step('Register the three buyers as billing customers', async () => {
    for (const contract of CONTRACTS) {
      const customer = await ensureBillingCustomer(client, {
        requestId: ids.forOperation(`customer-${contract.id}`),
        name: contract.customer,
        email: contract.email,
        currency: contract.currency,
      });
      customers.set(contract.id, customer);
      logger.detail(contract.customer, `${customer.id}`);
    }
  });

  const issueFinalized = async (
    number: string,
    contract: ContractCase,
    lines: BillingLine[],
  ): Promise<BillingInvoice> => {
    const customerId = customers.get(contract.id)!.id;
    const terms = parsed.get(contract.id)!;
    const created = await createInvoice(client, {
      requestId: ids.forOperation(`invoice-${number}`),
      number,
      billingCustomerId: customerId,
      currency: contract.currency,
      daysUntilDue: terms.netDays,
      memo: `Contract ${contract.reference} — issued by the billing agent.`,
    });
    await addInvoiceLineItems(client, {
      invoiceId: created.id,
      requestId: ids.forOperation(`lines-${number}`),
      lines,
    });
    return finalizeInvoice(client, created.id);
  };

  const toBillingLines = (contract: ContractCase, lines: ParsedLine[]): BillingLine[] =>
    lines.map((line) => ({
      description: `${contract.reference} — ${line.description}`,
      quantity: line.quantity,
      unitAmount: line.unitAmount,
      productName: `${contract.customer} services`,
    }));

  const milestoneLine = (contract: ContractCase, milestone: ParsedMilestone): BillingLine => ({
    description: `${contract.reference} milestone — ${milestone.label} (${milestone.percent}%)`,
    quantity: 1,
    unitAmount: milestone.amount,
    productName: `${contract.customer} milestones`,
  });

  const compact = (reference: string): string => reference.replace(/-/g, '');
  const milestoneNumber = (contract: ContractCase, milestone: ParsedMilestone): string => {
    const terms = parsed.get(contract.id)!;
    const position = terms.milestones.indexOf(milestone) + 1;
    return `K14-${compact(contract.reference)}-M${position}`;
  };

  const decisions: BillingDecision[] = [];
  const issued: { invoice: BillingInvoice; customer: string; payNow: boolean }[] = [];
  let escalationNote: string | undefined;

  logger.chapter('Decide and act — bill what is due, hold what is not');
  for (const contract of CONTRACTS) {
    const terms = parsed.get(contract.id)!;
    const reading = await analyst.readContract({
      customer: contract.customer,
      reference: contract.reference,
      text: contract.text,
    });
    const decision = decideBilling(terms, reading, { delivered: false });
    decisions.push(decision);
    await logger.step(`${contract.reference} — ${contract.customer}`, async () => {
      logger.decision(decision.action, decision.reason);
      if (decision.action === 'ISSUE_NOW') {
        const invoice = await issueFinalized(
          `K14-${compact(contract.reference)}`,
          contract,
          toBillingLines(contract, decision.issueLines),
        );
        issued.push({ invoice, customer: contract.customer, payNow: true });
        logger.detail('Issued', `${invoice.number} ${invoice.id} FINALized ${formatAmount(invoice.totalAmount, invoice.currency)}`);
      } else if (decision.action === 'ISSUE_MILESTONES_DUE') {
        for (const milestone of decision.dueMilestones) {
          const invoice = await issueFinalized(
            milestoneNumber(contract, milestone),
            contract,
            [milestoneLine(contract, milestone)],
          );
          issued.push({ invoice, customer: contract.customer, payNow: true });
          logger.detail('Issued', `${invoice.number} Finalized ${formatAmount(invoice.totalAmount, invoice.currency)}`);
        }
        for (const milestone of decision.heldMilestones) {
          logger.detail('Held', `${milestone.label} — waits for the ${milestone.trigger} trigger`);
        }
      } else if (decision.action === 'PARTIAL_ISSUE') {
        const invoice = await issueFinalized(
          `K14-${compact(contract.reference)}-PART`,
          contract,
          toBillingLines(contract, decision.issueLines),
        );
        issued.push({ invoice, customer: contract.customer, payNow: true });
        logger.detail('Issued', `${invoice.number} Finalized ${formatAmount(invoice.totalAmount, invoice.currency)} (clean lines only)`);
        const held = decision.heldLines.map(lineTotal).reduce((sum, value) => round2(sum + value), 0);
        const approval = await gate.request({
          operationId: `escalate-${contract.id}`,
          summary: `Escalate disputed ${formatAmount(held, contract.currency)} on ${contract.reference}`,
          amount: held,
          currency: contract.currency,
          counterparty: contract.customer,
          evidence: decision.heldLines.map((line) => line.description),
        });
        escalationNote = await analyst.explainException({
          counterparty: contract.customer,
          amount: held,
          currency: contract.currency,
          reason: `the ${decision.heldLines.map((line) => line.description).join(', ')} line is disputed and over tolerance`,
        });
        logger.decision(
          approval.approved ? 'ESCALATED' : 'HELD',
          `${escalationNote} Approved by ${approval.approver}.`,
        );
      } else {
        logger.detail('Held', 'Analyst and parser disagree — a person confirms the shape first.');
      }
    });
  }

  logger.chapter('New information — the Cascade delivery lands');
  const deliveryReading: ContractReading = await analyst.readContract(DELIVERY_CONFIRMATION);
  logger.detail('Analyst', deliveryReading.rationale);
  for (const quote of deliveryReading.citedEvidence) logger.detail('Cited', `"${quote}"`);
  const cascade = CONTRACTS.find((entry) => entry.id === 'msa-milestones')!;
  if (deliveryConfirmed(deliveryReading, DELIVERY_CONFIRMATION.text)) {
    const terms = parsed.get(cascade.id)!;
    const reading = await analyst.readContract({
      customer: cascade.customer,
      reference: cascade.reference,
      text: cascade.text,
    });
    const revised = decideBilling(terms, reading, { delivered: true });
    decisions.push(revised);
    logger.decision('REVISED', revised.reason);
    for (const milestone of revised.dueMilestones) {
      const number = milestoneNumber(cascade, milestone);
      if (issued.some((entry) => entry.invoice.number === number)) continue;
      const invoice = await issueFinalized(number, cascade, [
        milestoneLine(cascade, milestone),
      ]);
      issued.push({ invoice, customer: cascade.customer, payNow: false });
      logger.detail('Issued', `${invoice.number} Finalized ${formatAmount(invoice.totalAmount, invoice.currency)} — due later, still open`);
    }
  } else {
    logger.detail('Held', 'Delivery not confirmed — milestone 2 stays held.');
  }

  logger.chapter('Collect — the bank transfers land');
  const account = await ensureGlobalAccount(client, 'USD');
  let paidTotal = 0;
  for (const entry of issued.filter((item) => item.payNow)) {
    const fresh = await getInvoice(client, entry.invoice.id);
    await simulateDeposit(client, {
      globalAccountId: account.id,
      amount: fresh.totalAmount,
      payerName: `${entry.customer} ${fresh.number}`,
    });
    const paid = await markInvoicePaid(client, fresh.id);
    paidTotal = round2(paidTotal + paid.totalAmount);
    entry.invoice = paid;
    logger.detail('Collected', `${paid.number} ${formatAmount(paid.totalAmount, paid.currency)} → ${paid.paymentStatus}`);
  }

  logger.chapter('Outcome');
  const finals: BillingInvoice[] = [];
  for (const entry of issued) finals.push(await getInvoice(client, entry.invoice.id));
  const issuedTotal = round2(finals.reduce((sum, invoice) => sum + invoice.totalAmount, 0));
  const openTotal = round2(
    finals
      .filter((invoice) => invoice.paymentStatus !== 'PAID')
      .reduce((sum, invoice) => sum + invoice.amountDue, 0),
  );
  assertBillingIdentity({ issued: issuedTotal, paid: paidTotal, open: openTotal, currency: 'USD' });
  // Live deposits post a few seconds after they report success — wait for the
  // collections to land instead of racing the balance.
  const endingUsd = balanceOf(
    await waitForAvailableBalance(client, {
      currency: 'USD',
      amount: round2(startingUsd + paidTotal),
      attempts: 20,
    }),
    'USD',
  );
  if (Math.abs(round2(endingUsd - startingUsd) - paidTotal) > 0.005) {
    throw new Error(
      `Cash identity broken: wallet moved ${round2(endingUsd - startingUsd)} but collections are ${paidTotal} (USD).`,
    );
  }
  for (const invoice of finals) {
    // The hosted URL carries a session token — prove the page exists without
    // printing a bearer secret, so demos and recordings stay credential-free.
    const hosted = invoice.hostedUrl?.replace(/\?s=.*$/, '?s=[session]');
    logger.detail(
      invoice.number,
      `${invoice.status} / ${invoice.paymentStatus} — ${formatAmount(invoice.totalAmount, invoice.currency)}${hosted ? ` — ${hosted}` : ''}`,
    );
  }
  logger.detail('Identity', `issued ${issuedTotal} = paid ${paidTotal} + open ${openTotal}; wallet +${paidTotal}`);
  if (escalationNote) logger.detail('Escalation', escalationNote);

  return {
    decisions,
    invoices: finals,
    paidTotal,
    openTotal,
    ...(escalationNote ? { escalationNote } : {}),
    wallet: { USD: round2(endingUsd) },
  };
}
