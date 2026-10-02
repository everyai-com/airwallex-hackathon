import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AirwallexClient } from '../src/core/client.js';
import { createLogger } from '../src/core/log.js';
import type { Config } from '../src/config.js';
import { runKit1 } from '../src/kits/kit1-treasury/index.js';
import { planTreasury } from '../src/kits/kit1-treasury/planner.js';
import { TREASURY_POLICY } from '../src/kits/kit1-treasury/policy.js';
import {
  TREASURY_FORECAST,
  TREASURY_OBLIGATIONS,
} from '../src/kits/kit1-treasury/scenario.js';
import { runKit2 } from '../src/kits/kit2-purchase/index.js';
import { chooseOption, PURCHASE_POLICY } from '../src/kits/kit2-purchase/policy.js';
import { parseSaaSQuote, projectCash, RAW_SAAS_QUOTE } from '../src/kits/kit2-purchase/terms.js';
import { runKit3 } from '../src/kits/kit3-incident/index.js';
import { decideIncident, DuplicatePaymentGuard } from '../src/kits/kit3-incident/state.js';
import { DISPUTE_CASES } from '../src/kits/kit4-dispute/cases.js';
import { buildPdfEvidence } from '../src/kits/kit4-dispute/evidence.js';
import { decideAfterRejection, decideDispute } from '../src/kits/kit4-dispute/policy.js';
import { runKit4 } from '../src/kits/kit4-dispute/index.js';
import type { TransferRecord } from '../src/api/transfers.js';
import { MockTransport, type MockSnapshot } from '../src/core/mock.js';

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

// --- Kit 1: treasury planner -------------------------------------------------

const usdValue = { USD: 1, EUR: 1.0869, GBP: 1.2658 };
const baseBalances = { USD: 14_200, EUR: 1_150, GBP: 1_200 };

test('kit1 plan funds the critical bill, converts the minimum, defers and escalates', () => {
  const result = planTreasury({
    balances: baseBalances,
    usdValue,
    obligations: TREASURY_OBLIGATIONS,
    forecast: TREASURY_FORECAST,
    policy: TREASURY_POLICY,
  });
  const byId = new Map(result.actions.map((action) => [action.obligation.id, action]));

  assert.equal(byId.get('obl-shipping')?.kind, 'FUND');
  const parts = byId.get('obl-parts');
  assert.equal(parts?.kind, 'CONVERT_AND_FUND');
  if (parts?.kind === 'CONVERT_AND_FUND') {
    assert.equal(parts.buyCurrency, 'EUR');
    // EUR 5,400 + 12.85 SWIFT fee - 1,150 held = 4,262.85 to convert.
    assert.equal(parts.convertAmount.toFixed(2), '4262.85');
  }
  assert.equal(byId.get('obl-software')?.kind, 'DEFER');
  assert.equal(byId.get('obl-consulting')?.kind, 'DEFER');
  assert.equal(byId.get('obl-helios')?.kind, 'ESCALATE');
});

test('kit1 confidence drop flips the conversion to human approval, and approval unlocks it', () => {
  const low = planTreasury({
    balances: { USD: 10_000, EUR: 1_150, GBP: 1_200 },
    usdValue,
    obligations: TREASURY_OBLIGATIONS,
    forecast: { ...TREASURY_FORECAST, confidence: 0.42 },
    policy: TREASURY_POLICY,
    executedObligationIds: ['obl-shipping'],
  });
  const lowParts = low.actions.find((action) => action.obligation.id === 'obl-parts');
  assert.equal(lowParts?.kind, 'REQUIRE_APPROVAL');

  const approved = planTreasury({
    balances: { USD: 18_000, EUR: 1_150, GBP: 1_200 },
    usdValue,
    obligations: TREASURY_OBLIGATIONS,
    forecast: { ...TREASURY_FORECAST, confidence: 0.42 },
    policy: TREASURY_POLICY,
    executedObligationIds: ['obl-shipping'],
    approvedObligationIds: ['obl-parts'],
  });
  const approvedParts = approved.actions.find((action) => action.obligation.id === 'obl-parts');
  assert.equal(approvedParts?.kind, 'CONVERT_AND_FUND');
  if (approvedParts?.kind === 'CONVERT_AND_FUND') assert.equal(approvedParts.approved, true);
});

test('kit1 moves exactly the money its plan describes', async () => {
  const client = testClient();
  await runKit1(client, logger, { autoApprove: true, forceHeuristicAnalyst: true });
  const snapshot = mockSnapshot(client);
  assert.equal(snapshot.transfers.length, 2, 'one freight transfer and one supplier transfer');
  assert.ok(snapshot.transfers.every((transfer) => transfer.status === 'PAID'));
  assert.equal(snapshot.conversions.length, 1, 'exactly one FX conversion');
  assert.equal(Number(snapshot.conversions[0]!.buy_amount), 4_262.85);
  assert.ok(
    (snapshot.balances.USD ?? 0) > 9_000,
    'reserve stays above the USD 9,000 floor in mid-rate terms',
  );
});

// --- Kit 2: purchase cash model ---------------------------------------------

test('kit2 parses the quote and the annual plan breaches the floor in week 7', () => {
  const [annual, monthly] = parseSaaSQuote(RAW_SAAS_QUOTE);
  assert.ok(annual && monthly);
  assert.equal(annual.upfrontUsd, 11_808);
  assert.equal(monthly.monthlyUsd, 1_200);

  const input = {
    startingCashUsd: PURCHASE_POLICY.startingCashUsd,
    weeklyOperatingCostUsd: PURCHASE_POLICY.weeklyOperatingCostUsd,
    reserveFloorUsd: PURCHASE_POLICY.reserveFloorUsd,
    horizonWeeks: PURCHASE_POLICY.horizonWeeks,
    monthlyBillingEveryWeeks: PURCHASE_POLICY.monthlyBillingEveryWeeks,
  };
  const annualProjection = projectCash(annual, input);
  const monthlyProjection = projectCash(monthly, input);
  assert.equal(annualProjection.firstBreachWeek, 7);
  assert.equal(monthlyProjection.firstBreachWeek, undefined);

  const decision = chooseOption(
    annual,
    monthly,
    annualProjection.firstBreachWeek,
    monthlyProjection.firstBreachWeek,
  );
  assert.equal(decision.chosen.id, 'monthly');
});

test('kit2 issues a card whose controls decline and clear as designed', async () => {
  const client = testClient();
  await runKit2(client, logger);
  const snapshot = mockSnapshot(client);
  assert.equal(snapshot.cardTransactions.length, 4);
  const reasons = snapshot.cardTransactions
    .filter((transaction) => transaction.process_result === 'DECLINED')
    .map((transaction) => transaction.failure_reason)
    .sort();
  assert.deepEqual(reasons, ['CARD_INACTIVE', 'LIMIT_EXCEEDED', 'MERCHANT_CATEGORY_NOT_ALLOWED']);
  const accepted = snapshot.cardTransactions.find(
    (transaction) => transaction.process_result === 'APPROVED',
  );
  assert.equal(accepted?.type, 'CLEARING');
  assert.equal(snapshot.cards[0]?.card_status, 'INACTIVE', 'the agent froze its own card');
});

// --- Kit 3: incident state machine ------------------------------------------

function transfer(overrides: Partial<TransferRecord>): TransferRecord {
  return {
    id: 'trf_test',
    status: 'SENT',
    requestId: 'req_test_123456',
    transferCurrency: 'USD',
    transferAmount: 3_200,
    ...overrides,
  };
}

test('kit3 waits while SENT, replaces on a retryable failure, blocks duplicates', () => {
  const wait = decideIncident({
    transfer: transfer({ status: 'SENT' }),
    deadlineHoursRemaining: 8,
    availableBalance: 20_000,
    duplicatePaymentExists: false,
  });
  assert.equal(wait.action, 'WAIT');

  const replace = decideIncident({
    transfer: transfer({ status: 'CANCELLED', failureType: 'BENEFICIARY_BANK_RETURNED' }),
    deadlineHoursRemaining: 8,
    availableBalance: 20_000,
    duplicatePaymentExists: false,
  });
  assert.equal(replace.action, 'REPLACE');

  const duplicate = decideIncident({
    transfer: transfer({ status: 'CANCELLED', failureType: 'BENEFICIARY_BANK_RETURNED' }),
    deadlineHoursRemaining: 8,
    availableBalance: 20_000,
    duplicatePaymentExists: true,
  });
  assert.equal(duplicate.action, 'ESCALATE');

  const nonRetryable = decideIncident({
    transfer: transfer({ status: 'CANCELLED', failureType: 'TM_SUSPENDED' }),
    deadlineHoursRemaining: 8,
    availableBalance: 20_000,
    duplicatePaymentExists: false,
  });
  assert.equal(nonRetryable.action, 'ESCALATE');

  const short = decideIncident({
    transfer: transfer({ status: 'CANCELLED', failureType: 'BENEFICIARY_BANK_RETURNED' }),
    deadlineHoursRemaining: 8,
    availableBalance: 100,
    duplicatePaymentExists: false,
  });
  assert.equal(short.action, 'ESCALATE');
});

test('kit3 duplicate lock allows one replacement after a failure, then blocks', () => {
  const guard = new DuplicatePaymentGuard();
  guard.record('incident-1', {
    transferId: 'trf_1',
    requestId: 'req_original',
    amount: 3_200,
    currency: 'USD',
    status: 'CANCELLED',
  });
  assert.equal(guard.canCreatePayment('incident-1').allowed, true);

  guard.record('incident-1', {
    transferId: 'trf_2',
    requestId: 'req_replacement',
    amount: 3_200,
    currency: 'USD',
    status: 'PAID',
  });
  const blocked = guard.canCreatePayment('incident-1');
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /PAID/);
  assert.equal(guard.totalPaid('incident-1'), 3_200);
});

test('kit3 treats a transient FAILED as terminal, and prices fees before replacing', () => {
  const failed = decideIncident({
    transfer: transfer({ status: 'FAILED', failureType: 'BENEFICIARY_BANK_RETURNED' }),
    deadlineHoursRemaining: 8,
    availableBalance: 20_000,
    duplicatePaymentExists: false,
  });
  assert.equal(failed.action, 'REPLACE');

  const swift = transfer({
    status: 'CANCELLED',
    failureType: 'BENEFICIARY_BANK_RETURNED',
    transferMethod: 'SWIFT',
    transferCurrency: 'EUR',
    transferAmount: 1_000,
  });
  const feeAware = decideIncident({
    transfer: swift,
    deadlineHoursRemaining: 8,
    availableBalance: 1_005, // covers the principal but not the EUR 12.85 fee
    duplicatePaymentExists: false,
  });
  assert.equal(feeAware.action, 'ESCALATE');
});

test('kit3 replaces the failed transfer exactly once', async () => {
  const client = testClient();
  await runKit3(client, logger);
  const snapshot = mockSnapshot(client);
  assert.equal(snapshot.transfers.length, 2);
  const original = snapshot.transfers.find((transfer) => transfer.status === 'CANCELLED');
  assert.equal(original?.failure_type, 'BENEFICIARY_BANK_RETURNED');
  assert.ok(snapshot.transfers.some((transfer) => transfer.status === 'PAID'));
});

// --- Kit 4: dispute policy and evidence -------------------------------------

test('kit4 decides accept, challenge and escalate from evidence and fees', () => {
  const [fraud, small, credit] = DISPUTE_CASES;
  assert.ok(fraud && small && credit);

  assert.equal(decideDispute(fraud, 15).action, 'CHALLENGE');
  const accept = decideDispute(small, 15);
  assert.equal(accept.action, 'ACCEPT');
  assert.equal(accept.acceptReason, 'LOW_VALUE_TRANSACTION');
  assert.equal(decideDispute(credit, 15).action, 'ESCALATE');
  assert.equal(decideAfterRejection(fraud, 500).action, 'ACCEPT');
});

test('kit4 evidence is a valid PDF and starts with the PDF header', () => {
  const pdf = buildPdfEvidence('Test evidence', ['line one', 'line two']);
  assert.equal(pdf.subarray(0, 5).toString('utf8'), '%PDF-');
  assert.ok(pdf.includes(Buffer.from('%%EOF')));
});

test('kit4 settles all three disputes and creates exactly two refunds', async () => {
  const client = testClient();
  await runKit4(client, logger);
  const snapshot = mockSnapshot(client);
  assert.equal(snapshot.disputes.length, 3);
  const statuses = snapshot.disputes.map((dispute) => dispute.status).sort();
  assert.deepEqual(statuses, ['ACCEPTED', 'ACCEPTED', 'REQUIRES_RESPONSE']);
  assert.equal(snapshot.refunds.length, 2);
});
