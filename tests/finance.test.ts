import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Config } from '../src/config.js';
import { AirwallexClient } from '../src/core/client.js';
import { createLogger } from '../src/core/log.js';
import { MockTransport, type MockSnapshot } from '../src/core/mock.js';
import {
  agingBucket,
  buildReceivables,
  outstanding,
  withPayment,
  type Invoice,
  type Receipt,
} from '../src/kits/billing-shared.js';
import { runKit11 } from '../src/kits/kit11-reconciliation/index.js';
import {
  applyMatch,
  matchReceipt,
  type MatchContext,
  type MatchDecision,
} from '../src/kits/kit11-reconciliation/policy.js';
import { RECEIPTS } from '../src/kits/kit11-reconciliation/scenario.js';
import { runKit12 } from '../src/kits/kit12-close/index.js';
import { isBalanced, makeEntry, trialBalance } from '../src/kits/kit12-close/ledger.js';
import { assessClose, decideCutoff, fxRevaluation } from '../src/kits/kit12-close/policy.js';
import { runKit13 } from '../src/kits/kit13-collections/index.js';
import { assessPlan, decideCollection } from '../src/kits/kit13-collections/policy.js';
import { AS_OF, customerFor } from '../src/kits/kit13-collections/scenario.js';

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

function mockSnapshot(client: AirwallexClient): MockSnapshot {
  const transport = client.transport;
  assert.ok(transport instanceof MockTransport, 'expected the mock transport');
  return transport.snapshot();
}

// --- Receivables book --------------------------------------------------------

test('receivables helpers age, pay down and write off correctly', () => {
  const book = buildReceivables();
  assert.equal(book.length, 8);

  const northwind = book.find((entry) => entry.id === 'INV-1041');
  assert.ok(northwind);
  assert.equal(outstanding(northwind), 8_400);

  const settled = withPayment(northwind, 8_400);
  assert.equal(settled.status, 'PAID');
  assert.equal(outstanding(settled), 0);

  assert.equal(agingBucket(0), 'CURRENT');
  assert.equal(agingBucket(22), '1-30');
  assert.equal(agingBucket(38), '31-60');
  assert.equal(agingBucket(143), '61+');
});

// --- Kit 11 policy -----------------------------------------------------------

test('kit11 matches every receipt shape and gates deductions beyond tolerance', () => {
  let invoices: Invoice[] = buildReceivables();
  const prior: Receipt[] = [];
  const decisions: MatchDecision[] = [];

  for (const receipt of RECEIPTS) {
    const context: MatchContext = {
      invoices,
      priorReceipts: prior,
      ...(receipt.id === 'rcp-02' ? { analystRefs: ['INV-1044'], claimsDeduction: true } : {}),
    };
    const decision = matchReceipt(receipt, context);
    decisions.push(decision);
    invoices = applyMatch(invoices, decision);
    prior.push(receipt);
  }

  assert.deepEqual(
    decisions.map((entry) => entry.kind),
    ['EXACT', 'DEDUCTION', 'PARTIAL', 'UNREFERENCED', 'EXACT', 'DUPLICATE', 'OVERPAYMENT', 'UNMATCHED'],
  );

  const deduction = decisions.find((entry) => entry.receiptId === 'rcp-02');
  assert.equal(deduction?.writeOffAmount, 120);
  assert.equal(deduction?.requiresApproval, true, '120 exceeds the 85 autonomous tolerance');

  const closed = invoices.find((entry) => entry.id === 'INV-1044');
  assert.equal(closed?.status, 'PAID');
  assert.equal(closed?.writtenOff, 120);

  const duplicate = decisions.find((entry) => entry.receiptId === 'rcp-06');
  assert.equal(duplicate?.appliedAmount, 0);
  assert.equal(duplicate?.unappliedAmount, 12_000);

  const overpayment = decisions.find((entry) => entry.receiptId === 'rcp-07');
  assert.equal(overpayment?.appliedAmount, 9_900);
  assert.equal(overpayment?.creditAmount, 500);

  const unmatched = decisions.find((entry) => entry.receiptId === 'rcp-08');
  assert.equal(unmatched?.requiresApproval, true);
});

test('kit11 reconciles the whole bank feed against the AR book and the wallet', async () => {
  const client = testClient();
  const result = await runKit11(client, logger, {
    autoApprove: true,
    forceHeuristicAnalyst: true,
  });

  assert.deepEqual(
    result.decisions.map((entry) => entry.kind),
    ['EXACT', 'DEDUCTION', 'PARTIAL', 'UNREFERENCED', 'EXACT', 'DUPLICATE', 'OVERPAYMENT', 'UNMATCHED'],
  );
  assert.equal(result.approvalsUsed, 2);
  assert.equal(result.arCheck.opening.USD, 43_500);
  assert.equal(result.arCheck.opening.EUR, 26_000);
  assert.equal(result.arCheck.closing.USD, 9_700);
  assert.equal(result.arCheck.closing.EUR, 7_400);
  assert.equal(result.arCheck.creditsUsd, 500);
  assert.equal(result.arCheck.unappliedUsd, 15_400);
  assert.equal(result.wallet.USD, 54_580);
  assert.equal(result.wallet.EUR, 18_600);

  const snapshot = mockSnapshot(client);
  assert.equal(snapshot.balances.USD, 54_580, 'the deposits really posted to the wallet');
  assert.equal(snapshot.balances.EUR, 18_600);
});

// --- Kit 12 ledger + close ---------------------------------------------------

test('ledger refuses unbalanced entries and the trial balance nets correctly', () => {
  const entry = makeEntry('2026-10-31', 'test entry', [
    { account: 'CASH_USD', debit: 100 },
    { account: 'REVENUE', credit: 100 },
  ]);
  assert.equal(isBalanced([entry]), true);
  const rows = trialBalance([entry]);
  assert.equal(rows.find((row) => row.account === 'CASH_USD')?.side, 'DEBIT');
  assert.equal(rows.find((row) => row.account === 'REVENUE')?.side, 'CREDIT');

  assert.throws(
    () =>
      makeEntry('2026-10-31', 'bad entry', [
        { account: 'CASH_USD', debit: 100 },
        { account: 'REVENUE', credit: 90 },
      ]),
    /does not balance/,
  );
});

test('kit12 decides cutoff, revaluation and close blockers', () => {
  const post = decideCutoff({
    id: 'w1',
    description: 'wire before cutoff',
    amountUsd: 100,
    receivedAt: '2026-10-31T16:40:00Z',
  });
  assert.equal(post.inPeriod, true);

  const defer = decideCutoff({
    id: 'w2',
    description: 'wire after cutoff',
    amountUsd: 100,
    receivedAt: '2026-10-31T17:05:00Z',
  });
  assert.equal(defer.inPeriod, false);

  const revaluation = fxRevaluation(28_000, 1.09, 1.0869);
  assert.equal(revaluation.lossUsd, 86.8);

  const held = assessClose({ writeOffUsd: 600, unappliedUsd: 0, fxLossUsd: 0 });
  assert.equal(held.blockers.length, 1);
  const closed = assessClose({ writeOffUsd: 150, unappliedUsd: 12_000, fxLossUsd: 86.8 });
  assert.equal(closed.blockers.length, 0);
  assert.equal(closed.notes.length, 3);
});

test('kit12 closes with a balanced trial balance tied to the wallet', async () => {
  const client = testClient();
  const result = await runKit12(client, logger);

  assert.equal(result.verdict, 'CLOSED');
  assert.equal(isBalanced(result.entries), true);
  assert.equal(result.assessment.blockers.length, 0);
  assert.equal(result.trialBalance.find((row) => row.account === 'CASH_USD')?.net, 41_200);
  assert.equal(result.trialBalance.find((row) => row.account === 'CASH_EUR')?.net, 17_440);
  assert.equal(result.cutoff.find((entry) => entry.itemId === 'wire-4472')?.inPeriod, false);
  assert.equal(result.wallet.USD, 41_200);
  assert.equal(result.wallet.EUR, 16_000);
});

// --- Kit 13 collections ------------------------------------------------------

test('kit13 decides proportionate actions from aging, history and risk', () => {
  const book = buildReceivables();

  const bluepeak = book.find((entry) => entry.id === 'INV-1046');
  assert.ok(bluepeak);
  const escalate = decideCollection(bluepeak, customerFor('Bluepeak LLC'), { asOf: AS_OF });
  assert.equal(escalate.action, 'ESCALATE');
  assert.equal(escalate.requiresApproval, true);

  const alpine = book.find((entry) => entry.id === 'INV-1043');
  assert.ok(alpine);
  const cooldown = decideCollection(alpine, customerFor('Alpine GmbH'), {
    asOf: AS_OF,
    lastContactDaysAgo: 2,
  });
  assert.equal(cooldown.action, 'COOLDOWN');

  const cascade = book.find((entry) => entry.id === 'INV-1047');
  assert.ok(cascade);
  assert.equal(
    decideCollection(cascade, customerFor('Cascade Co'), { asOf: AS_OF }).action,
    'PAYMENT_PLAN',
  );

  const small: Invoice = {
    id: 'INV-1049',
    customer: 'Vela Studio',
    currency: 'USD',
    total: 60,
    paid: 0,
    writtenOff: 0,
    issueDate: '2026-05-01',
    dueDate: '2026-06-15',
    status: 'OPEN',
  };
  assert.equal(
    decideCollection(small, customerFor('Vela Studio'), { asOf: AS_OF }).action,
    'WRITE_OFF_SMALL',
  );

  assert.equal(assessPlan({ firstPaymentPercent: 0.2, remainingDays: 10 }).accepted, false);
  assert.equal(assessPlan({ firstPaymentPercent: 0.4, remainingDays: 40 }).accepted, false);
  const accepted = assessPlan({ firstPaymentPercent: 0.4, remainingDays: 21 });
  assert.equal(accepted.accepted, true);
  assert.match(accepted.reason, /pause dunning/);
});

test('kit13 works the book, recovers the plan payment and ties out', async () => {
  const client = testClient();
  const result = await runKit13(client, logger, {
    autoApprove: true,
    forceHeuristicAnalyst: true,
  });

  const byAction = (action: string): number =>
    result.decisions.filter((entry) => entry.action === action).length;
  assert.equal(byAction('ESCALATE'), 1);
  assert.equal(byAction('PAYMENT_PLAN'), 2);
  assert.equal(byAction('COOLDOWN'), 1);
  assert.equal(byAction('WRITE_OFF_SMALL'), 1);
  assert.ok(result.escalationNote?.includes('Bluepeak LLC'));

  assert.equal(result.recoveredUsd, 3_960);
  assert.equal(result.writtenOffUsd, 60);
  assert.equal(result.plan?.remainingUsd, 5_940);
  assert.equal(result.wallet.USD, 33_960);
  assert.equal(result.wallet.EUR, 10_000);

  const snapshot = mockSnapshot(client);
  assert.equal(snapshot.balances.USD, 33_960, 'the plan installment really landed');
});
