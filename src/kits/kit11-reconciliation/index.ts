import { balanceOf, formatBalances, getBalances } from '../../api/balances.js';
import { ensureGlobalAccount, simulateDeposit } from '../../api/global-accounts.js';
import { createAnalyst } from '../../core/analyst.js';
import { ApprovalGate } from '../../core/approvals.js';
import type { AirwallexClient } from '../../core/client.js';
import type { Logger } from '../../core/log.js';
import { formatAmount, round2 } from '../../core/money.js';
import {
  buildReceivables,
  openByCurrency,
  outstanding,
  type Invoice,
  type Receipt,
} from '../billing-shared.js';
import {
  applyMatch,
  matchReceipt,
  type MatchDecision,
} from './policy.js';
import { RECEIPTS, REMITTANCE_ADVICE } from './scenario.js';

export interface Kit11Options {
  autoApprove?: boolean;
  forceHeuristicAnalyst?: boolean;
}

export interface Kit11Result {
  decisions: MatchDecision[];
  invoices: Invoice[];
  approvalsUsed: number;
  wallet: Record<string, number>;
  arCheck: {
    opening: Record<string, number>;
    applied: Record<string, number>;
    writtenOff: Record<string, number>;
    creditsUsd: number;
    unappliedUsd: number;
    closing: Record<string, number>;
  };
}

/**
 * Invoice-Matching Reconciliation Agent — the challenge's receive-money loop:
 * Observe the bank feed, Decide each match against the AR book, Act within
 * policy (with a person clearing anything beyond it), Reconcile the books
 * against the wallet.
 */
export async function runKit11(
  client: AirwallexClient,
  logger: Logger,
  options: Kit11Options = {},
): Promise<Kit11Result> {
  const gate = new ApprovalGate({ autoApprove: options.autoApprove });
  const analyst = createAnalyst({
    ...(options.forceHeuristicAnalyst ? { forceHeuristic: true } : {}),
    ...(client.config.anthropicApiKey ? { apiKey: client.config.anthropicApiKey } : {}),
    model: client.config.anthropicModel,
  });

  client.seedMockBalances({ USD: 5_000, EUR: 0 });
  // Live runs start from whatever the wallet holds, so the cash identity stays
  // true on a re-run; the mock seeds the scenario cash above.
  const openingCashLines = await getBalances(client);
  const startingCash: Record<string, number> = {
    USD: balanceOf(openingCashLines, 'USD'),
    EUR: balanceOf(openingCashLines, 'EUR'),
  };

  logger.chapter('Invoice-Matching Reconciliation Agent — observe → decide → act → reconcile');
  logger.info(
    'Goal: match every incoming payment to the invoice it settles, auto-clear only what policy allows, and hold what a person must decide.',
  );
  logger.detail('Analyst', `${analyst.kind} — reads remittance advice; the matching policy owns every amount`);

  let invoices = buildReceivables();
  const opening = openByCurrency(invoices);
  logger.detail(
    'Open receivables',
    Object.entries(opening)
      .map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`)
      .join(' | '),
  );

  logger.chapter('Observe — the bank feed lands eight receipts');
  await logger.step('Post the feed to the wallet', async () => {
    const usdAccount = await ensureGlobalAccount(client, 'USD');
    const eurAccount = await ensureGlobalAccount(client, 'EUR');
    for (const receipt of RECEIPTS) {
      await simulateDeposit(client, {
        globalAccountId: receipt.currency === 'EUR' ? eurAccount.id : usdAccount.id,
        amount: receipt.amount,
        payerName: receipt.customer,
      });
    }
    const balances = await getBalances(client);
    logger.detail('Wallet after the feed', formatBalances(balances));
  });

  logger.chapter('Decide and act — match, hold or escalate');
  const decisions: MatchDecision[] = [];
  const priorReceipts: Receipt[] = [];
  const postedWriteOffs: Record<string, number> = {};
  const credits: Record<string, number> = {};
  const unapplied: Record<string, number> = {};
  let approvalsUsed = 0;

  for (const receipt of RECEIPTS) {
    await logger.step(
      `${receipt.id} — ${receipt.customer} ${formatAmount(receipt.amount, receipt.currency)}`,
      async () => {
        let analystRefs: string[] = [];
        let claimsDeduction = false;
        if (REMITTANCE_ADVICE.receiptId === receipt.id) {
          const reading = await analyst.readRemittance({
            customer: receipt.customer,
            amount: receipt.amount,
            currency: receipt.currency,
            reference: receipt.reference,
            email: REMITTANCE_ADVICE.body,
          });
          analystRefs = reading.invoiceRefs;
          claimsDeduction = reading.mentionsCredit || reading.mentionsDiscount;
          logger.detail(
            'Analyst reading',
            `${reading.invoiceRefs.join(', ') || 'no references'}${reading.mentionsCredit ? ' + credit claimed' : ''}${reading.mentionsDiscount ? ' + discount mentioned' : ''}`,
          );
          if (reading.citedEvidence.length > 0) {
            logger.info(`  cited: "${reading.citedEvidence[0]}"`);
          }
        }

        const decision = matchReceipt(receipt, {
          invoices,
          priorReceipts,
          analystRefs,
          claimsDeduction,
        });
        decisions.push(decision);

        let postedWriteOff = 0;
        if (decision.requiresApproval) {
          const approval = await gate.request({
            operationId: `reconcile-${receipt.id}`,
            summary: `Clear ${decision.kind} ${receipt.id} (${receipt.customer})`,
            amount: decision.writeOffAmount > 0 ? decision.writeOffAmount : decision.unappliedAmount,
            currency: receipt.currency,
            counterparty: receipt.customer,
            evidence: [decision.reason],
          });
          if (approval.approved) {
            approvalsUsed += 1;
            invoices = applyMatch(invoices, decision);
            postedWriteOff = decision.writeOffAmount;
            logger.detail('Approval', `cleared by ${approval.approver}`);
          } else {
            invoices = applyMatch(invoices, {
              ...decision,
              allocations: decision.allocations.map((entry) => ({ ...entry, writeOff: 0 })),
              writeOffAmount: 0,
            });
            logger.decision('DENIED', 'the person declined the write-off; the balance stays open.');
          }
        } else {
          invoices = applyMatch(invoices, decision);
          postedWriteOff = decision.writeOffAmount;
        }

        priorReceipts.push(receipt);
        if (postedWriteOff > 0) {
          postedWriteOffs[receipt.currency] = round2(
            (postedWriteOffs[receipt.currency] ?? 0) + postedWriteOff,
          );
        }
        credits[receipt.currency] = round2((credits[receipt.currency] ?? 0) + decision.creditAmount);
        unapplied[receipt.currency] = round2(
          (unapplied[receipt.currency] ?? 0) + decision.unappliedAmount,
        );
        logger.detail('Decision', `${decision.kind} — ${decision.reason}`);
      },
    );
  }

  logger.chapter('Reconcile — the books prove themselves');
  const closing = openByCurrency(invoices);
  const balances = await getBalances(client);
  const wallet: Record<string, number> = {};
  for (const line of balances) wallet[line.currency] = line.available;

  const applied: Record<string, number> = {};
  for (const decision of decisions) {
    const currency = RECEIPTS.find((entry) => entry.id === decision.receiptId)?.currency ?? 'USD';
    if (decision.appliedAmount > 0) {
      applied[currency] = round2((applied[currency] ?? 0) + decision.appliedAmount);
    }
  }
  const creditsUsd = credits.USD ?? 0;
  const unappliedUsd = unapplied.USD ?? 0;

  for (const currency of ['USD', 'EUR'] as const) {
    const open = opening[currency] ?? 0;
    const gone =
      (applied[currency] ?? 0) + (postedWriteOffs[currency] ?? 0) + (closing[currency] ?? 0);
    if (Math.abs(open - gone) > 0.01) {
      throw new Error(
        `AR does not reconcile for ${currency}: opening ${open} vs applied+written-off+closing ${round2(gone)}.`,
      );
    }
    const received = (applied[currency] ?? 0) + (credits[currency] ?? 0) + (unapplied[currency] ?? 0);
    if (Math.abs((startingCash[currency] ?? 0) + received - (wallet[currency] ?? 0)) > 0.01) {
      throw new Error(
        `Cash does not reconcile for ${currency}: starting ${startingCash[currency] ?? 0} + receipts ${round2(received)} vs wallet ${wallet[currency] ?? 0}.`,
      );
    }
  }

  logger.detail(
    'AR identity',
    Object.keys(opening)
      .map(
        (currency) =>
          `${currency}: ${opening[currency]?.toFixed(2)} opening = ${(applied[currency] ?? 0).toFixed(2)} applied + ${(postedWriteOffs[currency] ?? 0).toFixed(2)} written off + ${(closing[currency] ?? 0).toFixed(2)} still open`,
      )
      .join(' | '),
  );
  logger.detail(
    'Cash identity',
    Object.keys(startingCash)
      .map(
        (currency) =>
          `${currency} wallet ${(wallet[currency] ?? 0).toFixed(2)} = ${startingCash[currency]} starting + ${(applied[currency] ?? 0).toFixed(2)} applied + ${(credits[currency] ?? 0).toFixed(2)} credit + ${(unapplied[currency] ?? 0).toFixed(2)} unapplied`,
      )
      .join(' | '),
  );
  logger.decision('RECONCILED', 'every receipt is either applied, held or escalated — and the numbers close.');

  logger.chapter('Decision ledger');
  for (const decision of decisions) {
    logger.detail(decision.kind, `${decision.receiptId} ${decision.customer} — ${decision.reason}`);
  }
  const openInvoices = invoices.filter((entry) => outstanding(entry) > 0.005);
  logger.detail(
    'Still open',
    openInvoices
      .map((entry) => `${entry.id} ${entry.customer} ${formatAmount(outstanding(entry), entry.currency)}`)
      .join(' | '),
  );
  logger.detail(
    'Held for people',
    `${decisions.filter((entry) => entry.kind === 'UNMATCHED' || entry.kind === 'DUPLICATE').length} item(s) needing review before close; ${approvalsUsed} approval(s) used.`,
  );

  return {
    decisions,
    invoices,
    approvalsUsed,
    wallet,
    arCheck: { opening, applied, writtenOff: postedWriteOffs, creditsUsd, unappliedUsd, closing },
  };
}
