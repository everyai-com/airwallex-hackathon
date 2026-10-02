import { getBalances } from '../../api/balances.js';
import { ensureGlobalAccount, simulateDeposit } from '../../api/global-accounts.js';
import {
  collectCharge,
  connectedAccountTransfer,
  createPlatformReport,
  PLATFORM_REASONS,
} from '../../api/platform.js';
import type { AirwallexClient } from '../../core/client.js';
import type { Logger } from '../../core/log.js';
import { round2 } from '../../core/money.js';
import {
  PLATFORM_ON_BEHALF_NOTE,
  fundCustomerWallet,
  openConnectedAccount,
} from '../platform-shared.js';
import { LENDING_POLICY, planDisbursement, repaymentDue } from './policy.js';

export async function runKit7(client: AirwallexClient, logger: Logger): Promise<void> {
  const ids = client.requestIds();
  client.seedMockBalances({ USD: 14_200 });

  logger.chapter('Portfolio Lending Agent — repayments, a reserve floor, and a new advance');
  logger.info(
    `Goal: collect revenue-based repayments and size a new advance without breaching the USD ${LENDING_POLICY.reserveFloorUsd} portfolio floor. ${PLATFORM_ON_BEHALF_NOTE}`,
  );

  const borrowers = [
    { key: 'aster', name: 'Aster Apps LLC', ein: '88-3304501', contact: 'Ada Reyes' },
    { key: 'bluefin', name: 'Bluefin Services LLC', ein: '88-3304502', contact: 'Ben Okafor' },
    { key: 'cobalt', name: 'Cobalt Studio LLC', ein: '88-3304503', contact: 'Camille Duarte' },
  ];

  const accountIds = new Map<string, string>();
  await logger.step('Activate the two current borrowers and the newly approved one', async () => {
    for (const borrower of borrowers) {
      const accountId = await openConnectedAccount(client, {
        businessName: borrower.name,
        ein: borrower.ein,
        contactName: borrower.contact,
        city: 'New York',
        countryCode: 'US',
      });
      accountIds.set(borrower.key, accountId);
      logger.detail(borrower.name, `${accountId} ACTIVE`);
    }
  });

  const asterAccount = accountIds.get('aster')!;
  const bluefinAccount = accountIds.get('bluefin')!;
  const cobaltAccount = accountIds.get('cobalt')!;

  logger.chapter("This week's revenue lands in borrower wallets");
  await logger.step("Aster receives USD 12,000; Bluefin's revenue is delayed", async () => {
    await fundCustomerWallet(client, asterAccount, 12_000);
    logger.detail('Aster revenue', 'USD 12,000');
    logger.detail('Bluefin revenue', 'not yet landed — deposit expected later today');
  });

  await logger.step('Aster: collect 8% of USD 12,000 = USD 960', async () => {
    const collection = await collectCharge(client, {
      requestId: ids.forOperation('aster-repayment'),
      amount: repaymentDue(12_000),
      currency: 'USD',
      source: asterAccount,
      reason: PLATFORM_REASONS.fee,
      reference: 'weekly revenue share',
    });
    logger.detail('Collected', `${collection.id} ${collection.status} USD 960`);
  });

  await logger.step('Stage additional portfolio capital for the advance', async () => {
    const globalAccount = await ensureGlobalAccount(client, 'USD');
    await simulateDeposit(client, {
      globalAccountId: globalAccount.id,
      amount: 12_000,
      payerName: 'Portfolio capital',
    });
    logger.detail('Portfolio capital', 'USD 12,000 staged');
  });

  logger.chapter('Decision 1 — size the approved advance on expected receivables');
  logger.info('Bluefin is expected to repay USD 640 (8% of USD 8,000) once its revenue lands.');
  let platformBalance = usdBalance(await getBalances(client));
  const expectedReceivable = repaymentDue(8_000);
  const plan1 = planDisbursement({
    platformBalanceUsd: round2(platformBalance + expectedReceivable),
    requestedUsd: 15_000,
  });
  logger.detail('Platform + expected receivable', `USD ${round2(platformBalance + expectedReceivable)}`);
  logger.decision(plan1.action, plan1.reason);
  logger.detail('Planned for Cobalt Studio', `USD ${plan1.amountUsd} first tranche`);

  logger.chapter("New information — Bluefin's revenue lands lower than expected");
  await logger.step('Revenue is USD 4,000, not 8,000: adjust the receivable and collect the actual', async () => {
    await fundCustomerWallet(client, bluefinAccount, 4_000);
    const actualDue = repaymentDue(4_000);
    const collection = await collectCharge(client, {
      requestId: ids.forOperation('bluefin-repayment'),
      amount: actualDue,
      currency: 'USD',
      source: bluefinAccount,
      reason: PLATFORM_REASONS.fee,
      reference: 'weekly revenue share (actual revenue)',
    });
    logger.detail('Collected', `${collection.id} ${collection.status} USD ${actualDue}`);
    logger.detail(
      'Receivable',
      `USD ${round2(expectedReceivable - actualDue)} overdue against the original USD ${expectedReceivable} expectation — the charge was sent only after checking the balance`,
    );
  });

  logger.chapter('Decision 2 — re-decide with less cash available');
  platformBalance = usdBalance(await getBalances(client));
  const plan2 = planDisbursement({
    platformBalanceUsd: platformBalance,
    requestedUsd: 15_000,
  });
  logger.detail('Platform (actual)', `USD ${round2(platformBalance)}`);
  logger.decision(plan2.action, plan2.reason);

  if (plan2.action === 'FULL' || plan2.action === 'PARTIAL') {
    await logger.step(`Disburse USD ${plan2.amountUsd} to Cobalt Studio`, async () => {
      const transfer = await connectedAccountTransfer(client, {
        requestId: ids.forOperation('cobalt-advance'),
        amount: plan2.amountUsd,
        currency: 'USD',
        destination: cobaltAccount,
        reason: PLATFORM_REASONS.fee,
        reference: 'revenue-based advance — first tranche',
      });
      logger.detail('Advance', `${transfer.id} ${transfer.status} USD ${plan2.amountUsd}`);
    });
  }

  const remainder = round2(15_000 - plan2.amountUsd);
  logger.detail('Remainder', `USD ${remainder} delayed until the next collection cycle`);

  await logger.step('Portfolio snapshot', async () => {
    const report = await createPlatformReport(client, { type: 'BALANCE_REPORT', fileFormat: 'CSV' });
    logger.detail(
      'Report',
      `${report.id} ${report.status} — download within 60 seconds: ${report.url ?? 'pending'}`,
    );
  });

  const finalPlatform = usdBalance(await getBalances(client));
  logger.chapter('Outcome');
  logger.detail('Platform wallet', `USD ${round2(finalPlatform)}`);
  logger.detail(
    'Reserve floor',
    `USD ${LENDING_POLICY.reserveFloorUsd} — ${finalPlatform >= LENDING_POLICY.reserveFloorUsd ? 'maintained' : 'BREACHED'}`,
  );
  logger.detail('Collections', 'Aster USD 960 + Bluefin USD 320 on actual revenue; USD 320 stays a receivable');
  logger.detail(
    'Disbursement',
    `Cobalt received USD ${plan2.amountUsd} (planned USD ${plan1.amountUsd} before the shortfall); USD ${remainder} waits`,
  );
}

function usdBalance(balances: { currency: string; available: number }[]): number {
  return balances.find((line) => line.currency === 'USD')?.available ?? 0;
}
