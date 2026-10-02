import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AirwallexClient } from '../src/core/client.js';
import { createLogger } from '../src/core/log.js';
import type { Config } from '../src/config.js';
import { runKit5 } from '../src/kits/kit5-platform-spend/index.js';
import { planBridges } from '../src/kits/kit5-platform-spend/policy.js';
import { runKit6 } from '../src/kits/kit6-payroll/index.js';
import { assessPayroll, crossTenantGuard } from '../src/kits/kit6-payroll/policy.js';
import { runKit7 } from '../src/kits/kit7-lending/index.js';
import { planDisbursement, repaymentDue } from '../src/kits/kit7-lending/policy.js';
import { runKit8 } from '../src/kits/kit8-marketplace/index.js';
import { MockTransport, type MockSnapshot } from '../src/core/mock.js';
import {
  planSettlement,
  recomputeOnEvidence,
  reserveRate,
} from '../src/kits/kit8-marketplace/policy.js';

const logger = createLogger({ silent: true });

function mockSnapshot(client: AirwallexClient): MockSnapshot {
  const transport = client.transport;
  assert.ok(transport instanceof MockTransport, 'expected the mock transport');
  return transport.snapshot();
}

function testConfig(): Config {
  return {
    baseUrl: 'https://api.sandbox.airwallex.com',
    filesUrl: 'https://files.sandbox.airwallex.com',
    mock: true,
    dataDir: '/tmp/awx-test',
    anthropicModel: 'claude-sonnet-4-5',
  };
}

function testClient(): AirwallexClient {
  return AirwallexClient.create(testConfig());
}

// --- Kit 5: bridge rationing -------------------------------------------------

test('kit5 rationes bridge capital against the reserve floor', () => {
  const plan = planBridges(
    [
      { customerId: 'acct_b', customerName: 'B due today', shortfallUsd: 2_200, dueInHours: 4 },
      { customerId: 'acct_c', customerName: 'C due today', shortfallUsd: 1_500, dueInHours: 6 },
    ],
    14_200,
  );
  assert.equal(plan.approved.length, 1);
  assert.equal(plan.approved[0]?.customerId, 'acct_b');
  assert.equal(plan.declined.length, 1);
  assert.equal(plan.capacityUsd, 0);
});

test('kit5 advances exactly one bridge and collects the recovery plus fee', async () => {
  const client = testClient();
  await runKit5(client, logger);
  const snapshot = mockSnapshot(client);
  const bridges = snapshot.moneyMoves.filter((move) => String(move.id).startsWith('cat_'));
  const charges = snapshot.moneyMoves.filter((move) => String(move.id).startsWith('chg_'));
  assert.equal(bridges.length, 1);
  assert.equal(Number(bridges[0]!.amount), 2_200);
  assert.equal(String(bridges[0]!.status), 'SETTLED');
  assert.deepEqual(
    charges.map((charge) => Number(charge.amount)).sort((a, b) => a - b),
    [49, 2_200],
  );
});

// --- Kit 6: payroll pricing and isolation ------------------------------------

test('kit6 prices SWIFT fees into the conversion and blocks cross-tenant funding', () => {
  const assessment = assessPayroll(
    [
      { name: 'One', amount: 3_400, currency: 'EUR' },
      { name: 'Two', amount: 2_600, currency: 'EUR' },
    ],
    { USD: 1, EUR: 1.09 },
    { USD: 20_000 },
  );
  assert.equal(assessment.totalPayroll, 6_000);
  assert.equal(assessment.swiftFees, 25.7);
  assert.equal(assessment.totalRequired, 6_025.7);
  assert.equal(assessment.canRun, true);

  const short = assessPayroll(
    [{ name: 'One', amount: 6_000, currency: 'EUR' }],
    { USD: 1, EUR: 1.09 },
    { USD: 5_000 },
  );
  assert.equal(short.canRun, false);
  assert.ok(short.shortfallUsd > 0);
  assert.match(crossTenantGuard('B', 'C'), /tenant-scoped/);
  assert.throws(
    () => assessPayroll([{ name: 'One', amount: 100, currency: 'EUR' }], { USD: 1 }, { GBP: 50 }),
    /No USD rate supplied/,
  );
});

test('kit6 pays only the funded employer, never across tenants', async () => {
  const client = testClient();
  await runKit6(client, logger);
  const snapshot = mockSnapshot(client);
  const euroPayments = snapshot.transfers.filter(
    (transfer) => transfer.transfer_currency === 'EUR' && transfer.status === 'PAID',
  );
  assert.equal(euroPayments.length, 2, 'Acme pays two contractors; Borealis stays blocked');
  assert.equal(snapshot.conversions.length, 1);
  assert.equal(
    snapshot.moneyMoves.filter((move) => String(move.id).startsWith('chg_')).length,
    2,
  );
});

// --- Kit 7: disbursement sizing ----------------------------------------------

test('kit7 sizes tranches against the floor and re-decides with less cash', () => {
  const full = planDisbursement({ platformBalanceUsd: 40_000, requestedUsd: 15_000 });
  assert.equal(full.action, 'FULL');

  const partial = planDisbursement({ platformBalanceUsd: 27_800, requestedUsd: 15_000 });
  assert.equal(partial.action, 'PARTIAL');
  assert.equal(partial.amountUsd, 7_800);

  const smaller = planDisbursement({ platformBalanceUsd: 27_480, requestedUsd: 15_000 });
  assert.equal(smaller.amountUsd, 7_480);

  const delay = planDisbursement({ platformBalanceUsd: 21_000, requestedUsd: 15_000 });
  assert.equal(delay.action, 'DELAY');
  assert.equal(repaymentDue(4_000), 320);
});

test('kit7 collects the actual repayments and disburses the smaller tranche', async () => {
  const client = testClient();
  await runKit7(client, logger);
  const snapshot = mockSnapshot(client);
  const charges = snapshot.moneyMoves.filter((move) => String(move.id).startsWith('chg_'));
  assert.deepEqual(charges.map((charge) => Number(charge.amount)).sort((a, b) => a - b), [320, 960]);
  const disbursement = snapshot.moneyMoves.find((move) => String(move.id).startsWith('cat_'));
  assert.equal(Number(disbursement?.amount), 7_480);
  assert.equal(snapshot.balances.USD, 20_000, 'ends exactly on the portfolio floor');
});

// --- Kit 8: reserves and settlement ------------------------------------------

test('kit8 reserves the highest rate for the newest seller and recomputes only it', () => {
  const sellers = [
    { id: 'a', name: 'A', owedUsd: 12_000, trailingRefundRate: 0.02, isNewest: false },
    { id: 'b', name: 'B', owedUsd: 9_000, trailingRefundRate: 0.05, isNewest: false },
    { id: 'c', name: 'C', owedUsd: 9_000, trailingRefundRate: 0.04, isNewest: true },
  ];
  assert.equal(reserveRate(sellers[2]!), 0.1);

  const plan = planSettlement(sellers);
  const crest = plan.find((item) => item.sellerId === 'c')!;
  assert.equal(crest.payoutUsd, 8_100);

  const revised = recomputeOnEvidence(plan, 'c', 0.25);
  assert.equal(revised.find((item) => item.sellerId === 'c')!.payoutUsd, 6_750);
  assert.equal(revised.find((item) => item.sellerId === 'a')!.payoutUsd, 11_760);
});

test('kit8 pays all three sellers net of reserve and reconciles the wallet', async () => {
  const client = testClient();
  await runKit8(client, logger);
  const snapshot = mockSnapshot(client);
  const payouts = snapshot.moneyMoves
    .filter((move) => String(move.id).startsWith('cat_'))
    .map((move) => Number(move.amount))
    .sort((a, b) => a - b);
  assert.deepEqual(payouts, [6_750, 8_550, 11_760]);
  const recoveries = snapshot.moneyMoves.filter((move) => String(move.id).startsWith('chg_'));
  assert.equal(recoveries.length, 1);
  assert.equal(Number(recoveries[0]!.amount), 1_600);
  assert.equal(snapshot.balances.USD, 4_540, 'reserves 2,940 + refund coverage 1,600');
});
