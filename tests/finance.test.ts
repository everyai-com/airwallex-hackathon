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
import { assessClose, decideCutoff, fxRevaluation, writeOffPosts } from '../src/kits/kit12-close/policy.js';
import { runKit13 } from '../src/kits/kit13-collections/index.js';
import { assessPlan, decideCollection } from '../src/kits/kit13-collections/policy.js';
import { AS_OF, customerFor } from '../src/kits/kit13-collections/scenario.js';
import { runKit14 } from '../src/kits/kit14-billing/index.js';
import {
  assertBillingIdentity,
  contractTotal,
  decideBilling,
  deliveryConfirmed,
  disputeTolerance,
  matchDisputedLine,
  parseContract,
} from '../src/kits/kit14-billing/policy.js';
import { CONTRACTS, DELIVERY_CONFIRMATION } from '../src/kits/kit14-billing/contracts.js';

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

test('kit11 labels a spread payment partial when any referenced target stays open', () => {
  let invoices = buildReceivables();
  const first = RECEIPTS.find((entry) => entry.id === 'rcp-03');
  assert.ok(first);
  invoices = applyMatch(invoices, matchReceipt(first, { invoices, priorReceipts: [] }));

  const spread: Receipt = {
    id: 'rcp-x',
    customer: 'Northwind Traders',
    amount: 5_500,
    currency: 'USD',
    reference: 'INV-1041 balance',
    receivedAt: '2026-10-04T15:00:00Z',
    channel: 'BANK_TRANSFER',
  };
  const decision = matchReceipt(spread, { invoices, priorReceipts: [first] });
  assert.equal(decision.kind, 'PARTIAL');
  assert.equal(decision.appliedAmount, 5_500);
  assert.deepEqual(decision.invoiceIds, ['INV-1041', 'INV-1042']);
});

test('kit11 a refused write-off stays open instead of breaking the identities', async () => {
  const client = testClient();
  const result = await runKit11(client, logger, {
    autoApprove: false,
    forceHeuristicAnalyst: true,
  });

  assert.equal(result.approvalsUsed, 0);
  const deduction = result.decisions.find((entry) => entry.receiptId === 'rcp-02');
  assert.equal(deduction?.kind, 'DEDUCTION');
  assert.equal(result.arCheck.writtenOff.USD ?? 0, 0, 'a denied write-off posts nothing');
  assert.equal(result.arCheck.closing.USD, 9_820);
  const stillOpen = result.invoices.find((entry) => entry.id === 'INV-1044');
  assert.ok(stillOpen);
  assert.equal(outstanding(stillOpen), 120, 'the deducted balance stays open');
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

  assert.equal(writeOffPosts(150), true, 'within the autonomous limit');
  assert.equal(writeOffPosts(600), false, 'beyond the limit — blocked until signed');
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

// --- Kit 14: contract-to-cash billing ------------------------------------------

test('kit14 parses lines, milestones, terms and disputes in code', () => {
  const [clean, milestones, disputed] = CONTRACTS;
  const cleanParsed = parseContract(clean!.reference, clean!.customer, clean!.currency, clean!.text);
  assert.equal(cleanParsed.lines.length, 2);
  assert.equal(cleanParsed.netDays, 30);
  assert.equal(contractTotal(cleanParsed), 8_000);
  assert.equal(cleanParsed.disputedAmount, 0);

  const milestoneParsed = parseContract(
    milestones!.reference,
    milestones!.customer,
    milestones!.currency,
    milestones!.text,
  );
  assert.equal(milestoneParsed.milestones.length, 2);
  assert.equal(milestoneParsed.netDays, 15);
  assert.equal(contractTotal(milestoneParsed), 12_000);

  const disputedParsed = parseContract(
    disputed!.reference,
    disputed!.customer,
    disputed!.currency,
    disputed!.text,
  );
  assert.equal(disputedParsed.disputedAmount, 1_200);
  assert.equal(matchDisputedLine(disputedParsed)?.description, 'Onboarding workshop (two days, onsite)');
  assert.equal(disputeTolerance(contractTotal(disputedParsed)), 114);
});

test('kit14 bills clean lines, holds milestones, escalates disputes, holds on mismatch', () => {
  const [clean, milestones, disputed] = CONTRACTS.map((entry) =>
    parseContract(entry.reference, entry.customer, entry.currency, entry.text),
  );
  const reading = (overrides = {}) => ({
    mentionsNetTerms: true,
    mentionsMilestones: false,
    mentionsDispute: false,
    rationale: '',
    citedEvidence: [] as string[],
    ...overrides,
  });

  assert.equal(decideBilling(clean!, reading(), { delivered: false }).action, 'ISSUE_NOW');

  const held = decideBilling(milestones!, reading({ mentionsMilestones: true }), { delivered: false });
  assert.equal(held.action, 'ISSUE_MILESTONES_DUE');
  assert.equal(held.dueMilestones.length, 1);
  assert.equal(held.heldMilestones.length, 1);
  const released = decideBilling(milestones!, reading({ mentionsMilestones: true }), { delivered: true });
  assert.equal(released.heldMilestones.length, 0);

  const partial = decideBilling(disputed!, reading({ mentionsDispute: true }), { delivered: false });
  assert.equal(partial.action, 'PARTIAL_ISSUE');
  assert.equal(partial.requiresApproval, true);
  assert.equal(partial.issueLines.length, 1);

  assert.equal(
    decideBilling(milestones!, reading(), { delivered: false }).action,
    'HOLD',
    'analyst missed the milestones the parser found',
  );
  assert.equal(
    decideBilling(clean!, reading({ mentionsDispute: true }), { delivered: false }).action,
    'HOLD',
    'analyst sees a dispute the parser cannot find',
  );

  assert.equal(
    deliveryConfirmed(
      reading({ mentionsMilestones: true }),
      DELIVERY_CONFIRMATION.text,
    ),
    true,
  );
  assert.equal(deliveryConfirmed(reading({ mentionsDispute: true }), DELIVERY_CONFIRMATION.text), false);

  assertBillingIdentity({ issued: 24_500, paid: 18_500, open: 6_000, currency: 'USD' });
  assert.throws(
    () => assertBillingIdentity({ issued: 24_500, paid: 18_000, open: 6_000, currency: 'USD' }),
    /Billing identity broken/,
  );
});

test('kit14 issues real invoices, collects three and leaves one open', async () => {
  const client = testClient();
  const result = await runKit14(client, logger, {
    autoApprove: true,
    forceHeuristicAnalyst: true,
  });

  assert.equal(result.invoices.length, 4);
  assert.ok(result.invoices.every((invoice) => invoice.status === 'FINALIZED'));
  assert.equal(result.invoices.filter((invoice) => invoice.paymentStatus === 'PAID').length, 3);
  assert.deepEqual(
    result.invoices.map((invoice) => invoice.number).sort(),
    ['K14-MSA117-M1', 'K14-MSA117-M2', 'K14-PO2201', 'K14-PO2202-PART'],
  );
  assert.equal(result.paidTotal, 18_500);
  assert.equal(result.openTotal, 6_000);
  assert.ok(result.escalationNote?.includes('Datawise Inc'));
  assert.equal(result.wallet.USD, 48_500);

  const snapshot = mockSnapshot(client);
  assert.equal(snapshot.balances.USD, 48_500, 'the three bank transfers really landed');
});

test('kit14 resumes on a second run without duplicating invoices', async () => {
  const client = testClient();
  const options = { autoApprove: true, forceHeuristicAnalyst: true };
  await runKit14(client, logger, options);
  // Mock request ids are ephemeral, so the second run reuses the invoice
  // numbers with fresh ids — the same shape as a live --fresh re-run.
  const second = await runKit14(client, logger, options);
  assert.equal(second.invoices.length, 4);
  assert.deepEqual(
    [...new Set(second.invoices.map((invoice) => invoice.number))].sort(),
    ['K14-MSA117-M1', 'K14-MSA117-M2', 'K14-PO2201', 'K14-PO2202-PART'],
  );
  assert.equal(second.paidTotal, 18_500);
  assert.equal(second.openTotal, 6_000);
});
