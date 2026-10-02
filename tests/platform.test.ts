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
import {
  planSettlement,
  recomputeOnEvidence,
  reserveRate,
} from '../src/kits/kit8-marketplace/policy.js';

const logger = createLogger({ silent: true });

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

test('kit5 runs end to end against the mock sandbox', async () => {
  await runKit5(testClient(), logger);
});

// --- Kit 6: payroll pricing and isolation ------------------------------------

test('kit6 prices SWIFT fees into the conversion and blocks cross-tenant funding', () => {
  const assessment = assessPayroll(
    [
      { name: 'One', amount: 3_400, currency: 'EUR' },
      { name: 'Two', amount: 2_600, currency: 'EUR' },
    ],
    1.09,
    { USD: 20_000 },
  );
  assert.equal(assessment.totalPayroll, 6_000);
  assert.equal(assessment.swiftFees, 25.7);
  assert.equal(assessment.totalRequired, 6_025.7);
  assert.equal(assessment.canRun, true);

  const short = assessPayroll(
    [{ name: 'One', amount: 6_000, currency: 'EUR' }],
    1.09,
    { USD: 5_000 },
  );
  assert.equal(short.canRun, false);
  assert.ok(short.shortfallUsd > 0);
  assert.match(crossTenantGuard('B', 'C'), /tenant-scoped/);
});

test('kit6 runs end to end against the mock sandbox', async () => {
  await runKit6(testClient(), logger);
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

test('kit7 runs end to end against the mock sandbox', async () => {
  await runKit7(testClient(), logger);
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

test('kit8 runs end to end against the mock sandbox', async () => {
  await runKit8(testClient(), logger);
});
