import { balanceOf, formatBalances, getBalances } from '../../api/balances.js';
import { ensureGlobalAccount, simulateDeposit } from '../../api/global-accounts.js';
import type { AirwallexClient } from '../../core/client.js';
import type { Logger } from '../../core/log.js';
import { round2 } from '../../core/money.js';
import {
  accountNet,
  isBalanced,
  makeEntry,
  trialBalance,
  type JournalEntry,
  type TrialBalanceRow,
} from './ledger.js';
import {
  assessClose,
  decideCutoff,
  fxRevaluation,
  writeOffPosts,
  type CloseAssessment,
  type CutoffDecision,
} from './policy.js';
import {
  BOOK_EUR_RATE,
  CLOSE_PERIOD,
  CLOSING_CASH,
  CLOSING_EUR_RATE,
  FX_POSITION_EUR,
  OPENING_TRIAL_BALANCE,
  PAYROLL_ACCRUAL_USD,
  PENDING_ITEMS,
  PERIOD_RECEIPTS,
  PERIOD_REVENUE,
  PREPAID_INSURANCE_USD,
  UNAPPLIED_RECEIPT_USD,
  WRITE_OFF,
} from './scenario.js';

export interface Kit12Result {
  entries: JournalEntry[];
  trialBalance: TrialBalanceRow[];
  assessment: CloseAssessment;
  cutoff: CutoffDecision[];
  verdict: 'CLOSED' | 'HELD';
  wallet: Record<string, number>;
}

/**
 * Zero-Day Close Agent — the challenge's close loop: observe the month, decide
 * what policy posts and what a person must sign, act through a balanced journal,
 * reconcile the trial balance against the wallet.
 */
export async function runKit12(client: AirwallexClient, logger: Logger): Promise<Kit12Result> {
  client.seedMockBalances({ ...CLOSING_CASH });
  if (!client.isMock) {
    await logger.step('Sandbox setup — fund the wallet to the scenario closing cash', async () => {
      for (const currency of ['USD', 'EUR'] as const) {
        const target = CLOSING_CASH[currency];
        const current = balanceOf(await getBalances(client), currency);
        if (current + 0.01 < target) {
          const account = await ensureGlobalAccount(client, currency);
          await simulateDeposit(client, {
            globalAccountId: account.id,
            amount: round2(target - current),
            payerName: 'Close scenario funding',
          });
          logger.detail(`${currency} funded`, `${round2(target - current)} to reach ${target}`);
        } else if (current > target + 0.01) {
          throw new Error(
            `${currency} wallet ${current} is above the scenario closing cash ${target}; sweep it before running the close live.`,
          );
        }
      }
    });
  }

  logger.chapter(`Zero-Day Close Agent — ${CLOSE_PERIOD.label}`);
  logger.info(
    'Goal: close the same day the numbers land — post what policy allows, hold what a person must sign, and prove the books balance.',
  );

  logger.chapter('Observe — the period in one glance');
  const balances = await getBalances(client);
  const wallet: Record<string, number> = {};
  for (const line of balances) wallet[line.currency] = line.available;
  logger.detail('Closing cash (wallet)', formatBalances(balances));
  logger.detail(
    'Opening trial balance',
    `${OPENING_TRIAL_BALANCE.length} accounts, retained-earnings plug USD 75,980.00`,
  );
  logger.detail(
    'Period activity',
    `revenue USD ${PERIOD_REVENUE.usd} / EUR ${PERIOD_REVENUE.eur}; receipts USD ${PERIOD_RECEIPTS.usd} / EUR ${PERIOD_RECEIPTS.eur}; unapplied USD ${UNAPPLIED_RECEIPT_USD}; prepaid USD ${PREPAID_INSURANCE_USD}; write-off USD ${WRITE_OFF.amountUsd}; payroll accrual USD ${PAYROLL_ACCRUAL_USD}`,
  );

  logger.chapter('Decide — cutoff and close rules');
  const cutoff = PENDING_ITEMS.map((item) => decideCutoff(item));
  for (const decision of cutoff) {
    logger.decision(decision.inPeriod ? 'BOOK IN PERIOD' : 'DEFER', decision.reason);
  }

  const revaluation = fxRevaluation(FX_POSITION_EUR, BOOK_EUR_RATE, CLOSING_EUR_RATE);
  logger.detail(
    'FX revaluation',
    `EUR ${revaluation.netPositionEur} at book ${BOOK_EUR_RATE} = USD ${revaluation.bookValueUsd}; at closing ${CLOSING_EUR_RATE} = USD ${revaluation.closeValueUsd}; loss USD ${revaluation.lossUsd}`,
  );

  const assessment = assessClose({
    writeOffUsd: WRITE_OFF.amountUsd,
    unappliedUsd: UNAPPLIED_RECEIPT_USD,
    fxLossUsd: revaluation.lossUsd,
  });
  for (const note of assessment.notes) logger.detail('Close note', note.reason);
  for (const blocker of assessment.blockers) logger.detail('CLOSE BLOCKER', blocker.reason);
  const verdict: Kit12Result['verdict'] = assessment.blockers.length === 0 ? 'CLOSED' : 'HELD';
  logger.decision('CLOSE', verdict === 'CLOSED' ? 'nothing blocks the close — post the adjustments and publish.' : 'the close is held pending sign-off.');

  logger.chapter('Act — post the balanced journal');
  const eurReceiptUsd = round2(PERIOD_RECEIPTS.eur * BOOK_EUR_RATE);
  const eurRevenueUsd = round2(PERIOD_REVENUE.eur * BOOK_EUR_RATE);
  const writeOffBlocked = !writeOffPosts(WRITE_OFF.amountUsd);
  const fxAmount = Math.abs(revaluation.lossUsd);
  const entries: JournalEntry[] = [
    makeEntry(CLOSE_PERIOD.asOf, 'Opening balances — October 2026', OPENING_TRIAL_BALANCE),
    makeEntry(CLOSE_PERIOD.asOf, `Revenue recognized — USD ${PERIOD_REVENUE.usd}, EUR ${PERIOD_REVENUE.eur}`, [
      { account: 'AR_USD', debit: PERIOD_REVENUE.usd },
      { account: 'AR_EUR', debit: eurRevenueUsd },
      { account: 'REVENUE', credit: PERIOD_REVENUE.usd + eurRevenueUsd },
    ]),
    makeEntry(CLOSE_PERIOD.asOf, `Receipts applied — USD ${PERIOD_RECEIPTS.usd}, EUR ${PERIOD_RECEIPTS.eur}`, [
      { account: 'CASH_USD', debit: PERIOD_RECEIPTS.usd },
      { account: 'CASH_EUR', debit: eurReceiptUsd },
      { account: 'AR_USD', credit: PERIOD_RECEIPTS.usd },
      { account: 'AR_EUR', credit: eurReceiptUsd },
    ]),
    makeEntry(CLOSE_PERIOD.asOf, 'Receipt with no match — parked as unapplied cash', [
      { account: 'CASH_USD', debit: UNAPPLIED_RECEIPT_USD },
      { account: 'UNAPPLIED_CASH', credit: UNAPPLIED_RECEIPT_USD },
    ]),
    makeEntry(CLOSE_PERIOD.asOf, 'Prepaid insurance — next period coverage', [
      { account: 'PREPAID_INSURANCE', debit: PREPAID_INSURANCE_USD },
      { account: 'CASH_USD', credit: PREPAID_INSURANCE_USD },
    ]),
    ...(writeOffBlocked
      ? []
      : [
          makeEntry(CLOSE_PERIOD.asOf, `Write-off ${WRITE_OFF.invoiceId} (${WRITE_OFF.customer})`, [
            { account: 'BAD_DEBT', debit: WRITE_OFF.amountUsd },
            { account: 'AR_USD', credit: WRITE_OFF.amountUsd },
          ]),
        ]),
    makeEntry(CLOSE_PERIOD.asOf, 'Payroll accrual — paid next period', [
      { account: 'PAYROLL_EXPENSE', debit: PAYROLL_ACCRUAL_USD },
      { account: 'ACCRUED_PAYROLL', credit: PAYROLL_ACCRUAL_USD },
    ]),
    ...(fxAmount > 0
      ? [
          makeEntry(
            CLOSE_PERIOD.asOf,
            `EUR balances revalued to the closing rate (${revaluation.lossUsd >= 0 ? 'loss' : 'gain'} USD ${fxAmount.toFixed(2)})`,
            revaluation.lossUsd >= 0
              ? [
                  { account: 'FX_REVALUATION_LOSS', debit: fxAmount },
                  { account: 'FX_VALUATION_RESERVE', credit: fxAmount },
                ]
              : [
                  { account: 'FX_VALUATION_RESERVE', debit: fxAmount },
                  { account: 'FX_REVALUATION_GAIN', credit: fxAmount },
                ],
          ),
        ]
      : []),
  ];
  if (writeOffBlocked) {
    logger.detail(
      'Write-off held',
      `${WRITE_OFF.invoiceId} USD ${WRITE_OFF.amountUsd} is not posted — sign-off required; the receivable stays open.`,
    );
  }

  for (const entry of entries) {
    const total = round2(entry.lines.reduce((sum, line) => sum + (line.debit ?? 0), 0));
    logger.detail(entry.memo, `${entry.lines.length} lines · USD ${total.toFixed(2)}`);
  }

  logger.chapter('Reconcile — the trial balance proves itself');
  const rows = trialBalance(entries);
  for (const row of rows) {
    logger.detail(
      row.account,
      `${row.side === 'DEBIT' ? 'Dr' : row.side === 'CREDIT' ? 'Cr' : '--'} ${Math.abs(row.net).toFixed(2)}`,
    );
  }
  if (!isBalanced(entries)) throw new Error('The trial balance does not balance.');
  const cashUsd = accountNet(entries, 'CASH_USD');
  const cashEur = accountNet(entries, 'CASH_EUR');
  if (Math.abs(cashUsd - (wallet.USD ?? 0)) > 0.01) {
    throw new Error(`CASH_USD per books ${cashUsd} does not tie to the wallet ${wallet.USD ?? 0}.`);
  }
  const eurWalletInBook = round2((wallet.EUR ?? 0) * BOOK_EUR_RATE);
  if (Math.abs(cashEur - eurWalletInBook) > 0.01) {
    throw new Error(
      `CASH_EUR per books ${cashEur} does not tie to EUR ${wallet.EUR ?? 0} at the book rate (${eurWalletInBook}).`,
    );
  }
  logger.detail('Balanced', 'every entry balances; debits equal credits across the journal.');
  logger.detail(
    'Cash tie-out',
    `CASH_USD ${cashUsd.toFixed(2)} = wallet USD; CASH_EUR ${cashEur.toFixed(2)} = EUR ${wallet.EUR ?? 0} at the ${BOOK_EUR_RATE} book rate.`,
  );

  logger.chapter('Outcome');
  logger.detail('Close', `${verdict} — ${rows.length} accounts, ${entries.length} journal entries`);
  const deferred = cutoff.filter((decision) => !decision.inPeriod).map((decision) => decision.itemId);
  logger.detail('Deferred to next period', deferred.join(', ') || 'none');
  logger.detail(
    'Next-period follow-ups',
    `unapplied cash USD ${UNAPPLIED_RECEIPT_USD} (owner assigned); deferred wire(s) ${deferred.join(', ') || 'none'}.`,
  );
  logger.info(
    'Zero-day close: the morning reconciliation cleared every receipt, so the books were ready before lunch — the loop closes the same day.',
  );

  return { entries, trialBalance: rows, assessment, cutoff, verdict, wallet };
}
