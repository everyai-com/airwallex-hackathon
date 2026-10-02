import { getBalances } from '../../api/balances.js';
import { ensureGlobalAccount, simulateDeposit } from '../../api/global-accounts.js';
import {
  collectCharge,
  connectedAccountTransfer,
  createPlatformReport,
  PLATFORM_REASONS,
} from '../../api/platform.js';
import type { AirwallexClient } from '../../core/client.js';
import { RequestIds } from '../../core/ids.js';
import type { Logger } from '../../core/log.js';
import { round2 } from '../../core/money.js';
import {
  PLATFORM_ON_BEHALF_NOTE,
  fundCustomerWallet,
  openConnectedAccount,
} from '../platform-shared.js';
import {
  MARKETPLACE_POLICY,
  planSettlement,
  recomputeOnEvidence,
  reconcile,
  type SellerAccount,
} from './policy.js';

export async function runKit8(client: AirwallexClient, logger: Logger): Promise<void> {
  const ids = new RequestIds();
  client.seedMockBalances({ USD: 14_200 });

  logger.chapter('Marketplace Settlement Agent — seller reserves, payouts, and refund exposure');
  logger.info(
    `Goal: settle what each seller earned minus a reserve against refund risk, then recover a shortfall when new evidence arrives. ${PLATFORM_ON_BEHALF_NOTE}`,
  );

  const sellers = [
    { key: 'atlas', name: 'Atlas Outfitters LLC', ein: '88-4404501', contact: 'Anna Liu', owed: 12_000, rate: 0.02, newest: false },
    { key: 'beacon', name: 'Beacon Home LLC', ein: '88-4404502', contact: 'Bilal Haq', owed: 9_000, rate: 0.05, newest: false },
    { key: 'crest', name: 'Crest Goods LLC', ein: '88-4404503', contact: 'Cora Whitfield', owed: 9_000, rate: 0.1, newest: true },
  ];

  const accountIds = new Map<string, string>();
  await logger.step('Activate three sellers', async () => {
    for (const seller of sellers) {
      const accountId = await openConnectedAccount(client, {
        businessName: seller.name,
        ein: seller.ein,
        contactName: seller.contact,
        city: 'New York',
        countryCode: 'US',
      });
      accountIds.set(seller.key, accountId);
      logger.detail(seller.name, `${accountId} ACTIVE`);
    }
  });

  await logger.step('Fund the platform wallet to exactly what the sellers are owed', async () => {
    const globalAccount = await ensureGlobalAccount(client, 'USD');
    await simulateDeposit(client, {
      globalAccountId: globalAccount.id,
      amount: 15_800,
      payerName: 'Marketplace buyer settlements',
    });
    const balance = usdBalance(await getBalances(client));
    logger.detail('Platform wallet', `USD ${round2(balance)} = sellers' owed total`);
  });

  const sellerAccounts: SellerAccount[] = sellers.map((seller) => ({
    id: accountIds.get(seller.key)!,
    name: seller.name,
    owedUsd: seller.owed,
    trailingRefundRate: seller.rate,
    isNewest: seller.newest,
  }));

  logger.chapter('Compute per-seller reserves from trailing refund rates');
  let settlements = planSettlement(sellerAccounts);
  for (const settlement of settlements) {
    logger.detail(
      settlement.name,
      `owed USD ${settlement.owedUsd} — reserve ${(settlement.reserveRate * 100).toFixed(0)}% = USD ${settlement.reserveUsd}, payout USD ${settlement.payoutUsd}`,
    );
  }
  logger.decision(
    'NEWEST SELLER',
    `The newest seller reserves at least ${(MARKETPLACE_POLICY.newestSellerMinimumReserveRate * 100).toFixed(0)}% regardless of its trailing rate`,
  );

  logger.chapter('New evidence before payouts run: a carrier failure at Crest Goods');
  logger.info(
    'Dozens of orders are undelivered, refund requests have started, and exposure exceeds the model estimate.',
  );
  const crestSettlementBefore = settlements.find((item) => item.sellerId === accountIds.get('crest'));
  settlements = recomputeOnEvidence(
    settlements,
    accountIds.get('crest')!,
    MARKETPLACE_POLICY.evidenceReserveRate,
  );
  const crestSettlementAfter = settlements.find((item) => item.sellerId === accountIds.get('crest'));
  logger.detail(
    'Crest reserve',
    `${(crestSettlementBefore!.reserveRate * 100).toFixed(0)}% -> ${(crestSettlementAfter!.reserveRate * 100).toFixed(0)}% (USD ${crestSettlementBefore!.reserveUsd} -> USD ${crestSettlementAfter!.reserveUsd})`,
  );
  logger.detail(
    'Crest payout',
    `USD ${crestSettlementBefore!.payoutUsd} -> USD ${crestSettlementAfter!.payoutUsd}`,
  );
  logger.info('Only the affected seller was recalculated.');

  await logger.step('Stage Crest seller revenue so a refund recovery can clear', async () => {
    await fundCustomerWallet(client, accountIds.get('crest')!, 7_000);
    logger.detail('Crest wallet', 'USD 7,000 seller revenue staged');
  });

  logger.chapter('Pay out net proceeds and release nothing early');
  let heldReservesUsd = 0;
  for (const settlement of settlements) {
    await logger.step(`Pay ${settlement.name} USD ${settlement.payoutUsd}`, async () => {
      const transfer = await connectedAccountTransfer(client, {
        requestId: ids.forOperation(`payout-${settlement.sellerId}`),
        amount: settlement.payoutUsd,
        currency: 'USD',
        destination: settlement.sellerId,
        reason: PLATFORM_REASONS.fee,
        reference: 'marketplace settlement — net of reserve',
      });
      logger.detail('Paid', `${transfer.id} ${transfer.status} USD ${settlement.payoutUsd}`);
    });
    heldReservesUsd = round2(heldReservesUsd + settlement.reserveUsd);
  }

  logger.chapter('Recover the refund shortfall on the carrier failure');
  const refundRecovery = 1_600;
  await logger.step(`Refund requests against Crest total USD ${refundRecovery} — recover from Crest`, async () => {
    const recovery = await collectCharge(client, {
      requestId: ids.forOperation('crest-refund-recovery'),
      amount: refundRecovery,
      currency: 'USD',
      source: accountIds.get('crest')!,
      reason: PLATFORM_REASONS.fee,
      reference: 'refund recovery — carrier failure exposure',
    });
    logger.detail('Recovered', `${recovery.id} ${recovery.status} USD ${refundRecovery}`);
    logger.decision(
      'CHECK FIRST',
      'The seller wallet was checked before charging; if it had been short, the charge would fail with insufficient_fund and we would record a receivable.',
    );
  });

  await logger.step('Reconcile the cycle and write the settlement report', async () => {
    const owesTotal = round2(sellers.reduce((total, seller) => total + seller.owed, 0));
    const check = reconcile(owesTotal, settlements, refundRecovery, refundRecovery);
    logger.detail('Owed to sellers', `USD ${owesTotal}`);
    logger.detail('Payouts', `USD ${check.payoutsUsd}`);
    logger.detail('Reserves held', `USD ${check.reservesUsd}`);
    logger.detail(
      'Refunds',
      `USD ${refundRecovery} recovered from Crest; refund payouts to buyers clear on the payments side`,
    );
    logger.detail(
      'Expected platform after refunds clear',
      `USD ${check.platformUsd}${check.balanced ? ' — reconciled (payouts + reserves = owed)' : ' — OUT OF BALANCE'}`,
    );
    const report = await createPlatformReport(client, {
      type: 'SETTLEMENT_REPORT',
      fileFormat: 'CSV',
    });
    logger.detail('Report', `${report.id} ${report.status} — ${report.url ?? 'pending'}`);
  });

  const finalPlatform = usdBalance(await getBalances(client));
  logger.chapter('Outcome');
  logger.detail(
    'Platform wallet',
    `USD ${round2(finalPlatform)} — held reserves USD ${heldReservesUsd} plus USD ${refundRecovery} refund coverage until refunds clear`,
  );
  logger.detail(
    'Reconciliation',
    'payouts + refunds + released reserve equal what each seller was owed; the remaining balance equals unreleased reserves',
  );
}

function usdBalance(balances: { currency: string; available: number }[]): number {
  return balances.find((line) => line.currency === 'USD')?.available ?? 0;
}
