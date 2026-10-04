import { formatBalances, getBalances } from '../../api/balances.js';
import { ensureGlobalAccount, simulateDeposit } from '../../api/global-accounts.js';
import { createAnalyst } from '../../core/analyst.js';
import { ApprovalGate } from '../../core/approvals.js';
import type { AirwallexClient } from '../../core/client.js';
import type { Logger } from '../../core/log.js';
import { formatAmount, round2 } from '../../core/money.js';
import {
  agingBucket,
  buildReceivables,
  openByCurrency,
  outstanding,
  withPayment,
  withWriteOff,
  type Invoice,
} from '../billing-shared.js';
import { assessPlan, decideCollection, type CollectionDecision } from './policy.js';
import {
  AS_OF,
  CASCADE_REPLY,
  LAST_CONTACT_DAYS_AGO,
  SMALL_BALANCE,
  customerFor,
} from './scenario.js';

export interface Kit13Options {
  autoApprove?: boolean;
  /** Force the deterministic analyst (tests, reproducible demos). */
  forceHeuristicAnalyst?: boolean;
}

export interface Kit13Result {
  decisions: CollectionDecision[];
  invoices: Invoice[];
  recoveredUsd: number;
  writtenOffUsd: number;
  plan?: {
    invoiceId: string;
    firstPaymentUsd: number;
    remainingUsd: number;
    remainingDays: number;
  };
  escalationNote?: string;
  wallet: Record<string, number>;
}

/**
 * AR Collections Agent — the challenge's collections loop: observe the overdue
 * book, decide a proportionate action per invoice, act within policy (plans,
 * reminders, one escalation a person approves), and reconcile what came back.
 */
export async function runKit13(
  client: AirwallexClient,
  logger: Logger,
  options: Kit13Options = {},
): Promise<Kit13Result> {
  const gate = new ApprovalGate({ autoApprove: options.autoApprove });
  const analyst = createAnalyst({
    ...(options.forceHeuristicAnalyst ? { forceHeuristic: true } : {}),
    ...(client.config.anthropicApiKey ? { apiKey: client.config.anthropicApiKey } : {}),
    model: client.config.anthropicModel,
  });

  client.seedMockBalances({ USD: 30_000, EUR: 10_000 });
  const startingCash = { USD: 30_000, EUR: 10_000 };

  let invoices: Invoice[] = [...buildReceivables(), SMALL_BALANCE];
  const opening = openByCurrency(invoices);
  let writtenOffUsd = 0;
  let recoveredUsd = 0;
  let escalationNote: string | undefined;

  logger.chapter('AR Collections Agent — observe → decide → act → reconcile');
  logger.info(
    `Goal: work the overdue book as of ${AS_OF} — proportionate pressure per customer, plans where they fit, escalation where they do not.`,
  );
  logger.detail('Analyst', `${analyst.kind} — drafts the escalation reasoning; the thresholds are code`);

  logger.chapter('Observe — the overdue book');
  const overdue = invoices
    .filter((entry) => outstanding(entry) > 0.005)
    .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate));
  for (const entry of overdue) {
    const days = Math.floor((Date.parse(AS_OF) - Date.parse(entry.dueDate)) / 86_400_000);
    const customer = customerFor(entry.customer);
    logger.detail(
      `${entry.id} · ${entry.customer}`,
      `${formatAmount(outstanding(entry), entry.currency)} · ${days} days · ${agingBucket(days)} · promises ${Math.round(customer.promisesKept * 100)}% · risk ${customer.riskScore}`,
    );
  }
  logger.detail(
    'Open receivables',
    Object.entries(opening)
      .map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`)
      .join(' | '),
  );

  logger.chapter('Decide and act — proportionate pressure per invoice');
  const decisions: CollectionDecision[] = [];
  for (const entry of overdue) {
    const open = outstanding(entry);
    if (open <= 0.005) continue;
    const customer = customerFor(entry.customer);
    const lastContact = LAST_CONTACT_DAYS_AGO[entry.id];
    const decision = decideCollection(entry, customer, {
      asOf: AS_OF,
      ...(lastContact !== undefined ? { lastContactDaysAgo: lastContact } : {}),
    });
    decisions.push(decision);

    await logger.step(
      `${entry.id} — ${entry.customer} ${formatAmount(open, entry.currency)}`,
      async () => {
        logger.decision(decision.action, decision.reason);
        if (decision.requiresApproval) {
          const approval = await gate.request({
            operationId: `collect-${entry.id}`,
            summary: `Escalate ${entry.id} (${entry.customer})`,
            amount: open,
            currency: entry.currency,
            counterparty: entry.customer,
            evidence: [decision.reason],
          });
          logger.detail(
            'Approval',
            approval.approved
              ? `cleared by ${approval.approver}`
              : 'denied — the invoice stays in reminders',
          );
          if (approval.approved) {
            escalationNote = await analyst.explainException({
              counterparty: entry.customer,
              amount: open,
              currency: entry.currency,
              reason: decision.reason,
            });
            logger.detail('Escalation note', escalationNote);
          }
        }
        if (decision.action === 'WRITE_OFF_SMALL') {
          invoices = invoices.map((item) =>
            item.id === entry.id ? withWriteOff(item, open) : item,
          );
          writtenOffUsd = round2(writtenOffUsd + open);
        }
      },
    );
  }

  logger.chapter('New information — a customer answers with a plan');
  const target = invoices.find((entry) => entry.id === CASCADE_REPLY.invoiceId);
  if (!target) throw new Error(`Missing ${CASCADE_REPLY.invoiceId} in the book.`);
  const targetOpen = outstanding(target);
  logger.info(`${CASCADE_REPLY.from}: "${CASCADE_REPLY.body}"`);

  const planAssessment = assessPlan({
    firstPaymentPercent: CASCADE_REPLY.firstPaymentPercent,
    remainingDays: CASCADE_REPLY.remainingDays,
  });
  logger.decision(planAssessment.accepted ? 'ACCEPT PLAN' : 'REJECT PLAN', planAssessment.reason);

  let plan: Kit13Result['plan'];
  if (planAssessment.accepted) {
    await logger.step(`${target.customer} pays the first installment`, async () => {
      const firstPayment = round2(targetOpen * CASCADE_REPLY.firstPaymentPercent);
      const account = await ensureGlobalAccount(client, 'USD');
      await simulateDeposit(client, {
        globalAccountId: account.id,
        amount: firstPayment,
        payerName: target.customer,
      });
      invoices = invoices.map((entry) =>
        entry.id === target.id ? withPayment(entry, firstPayment) : entry,
      );
      recoveredUsd = firstPayment;
      plan = {
        invoiceId: target.id,
        firstPaymentUsd: firstPayment,
        remainingUsd: round2(targetOpen - firstPayment),
        remainingDays: CASCADE_REPLY.remainingDays,
      };
      logger.detail(
        'Payment received',
        `${formatAmount(firstPayment, 'USD')} now; ${formatAmount(plan.remainingUsd, 'USD')} scheduled in ${plan.remainingDays} days — dunning pauses meanwhile.`,
      );
    });
  }

  logger.chapter('Reconcile — what moved and what remains');
  const closing = openByCurrency(invoices);
  const balances = await getBalances(client);
  const wallet: Record<string, number> = {};
  for (const line of balances) wallet[line.currency] = line.available;

  for (const currency of ['USD', 'EUR'] as const) {
    const open = opening[currency] ?? 0;
    const gone = (currency === 'USD' ? writtenOffUsd + recoveredUsd : 0) + (closing[currency] ?? 0);
    if (Math.abs(open - gone) > 0.01) {
      throw new Error(
        `Collections do not reconcile for ${currency}: opening ${open} vs written-off + recovered + closing ${round2(gone)}.`,
      );
    }
    if (Math.abs((startingCash[currency] ?? 0) + (currency === 'USD' ? recoveredUsd : 0) - (wallet[currency] ?? 0)) > 0.01) {
      throw new Error(`Cash does not tie out for ${currency}.`);
    }
  }

  logger.detail(
    'Open receivables',
    `${Object.entries(opening)
      .map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`)
      .join(' | ')} → ${Object.entries(closing)
      .map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`)
      .join(' | ')}`,
  );
  logger.detail('Recovered this run', `USD ${recoveredUsd.toFixed(2)}; written off USD ${writtenOffUsd.toFixed(2)}`);
  logger.detail('Wallet', formatBalances(balances));
  logger.decision('RECONCILED', 'opening = recovered + written off + still open — the book ties out.');

  logger.chapter('Decision ledger');
  for (const decision of decisions) {
    logger.detail(decision.action, `${decision.invoiceId} ${decision.customer} — ${decision.reason}`);
  }
  if (plan) {
    logger.detail(
      'PLAN ACCEPTED',
      `${plan.invoiceId} — ${formatAmount(plan.firstPaymentUsd, 'USD')} now, ${formatAmount(plan.remainingUsd, 'USD')} in ${plan.remainingDays} days`,
    );
  }

  return {
    decisions,
    invoices,
    recoveredUsd,
    writtenOffUsd,
    ...(plan ? { plan } : {}),
    ...(escalationNote ? { escalationNote } : {}),
    wallet,
  };
}
