import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Config } from '../src/config.js';
import { AirwallexClient } from '../src/core/client.js';
import { createLogger } from '../src/core/log.js';
import { MockTransport, type MockSnapshot } from '../src/core/mock.js';
import { buildCatalog, buildOffer, searchProducts } from '../src/kits/commerce-catalog.js';
import {
  checkoutBlockReason,
  MerchantService,
  signTapCompletionProof,
  type MerchantCheckout,
} from '../src/kits/commerce-merchant.js';
import {
  generateTapAgent,
  TapAgentRegistry,
  TapReplayGuard,
  tapAgentRegistryEntry,
} from '../src/core/tap.js';
import { runKit9 } from '../src/kits/kit9-shopping/index.js';
import {
  AiriReportGuard,
  approvalCovers,
  fingerprintChanges,
  offerFingerprint,
  rankOffers,
} from '../src/kits/kit9-shopping/policy.js';
import { runKit10 } from '../src/kits/kit10-checkout/index.js';

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

const CHECKOUT_ITEM = { sku: 'GAGGIA-EVO-ROAST', quantity: 1, shippingCode: 'EXPEDITED' } as const;

// --- Commerce catalog + product search ---------------------------------------

test('commerce catalog is deterministic and the search tool filters and pages', () => {
  const catalog = buildCatalog();
  assert.equal(catalog.length, 106);

  const gaggia = catalog.find((product) => product.sku === 'GAGGIA-EVO-CREMACO');
  assert.equal(gaggia?.priceUsd, 449);
  assert.equal(gaggia?.merchant, 'CremaCo');

  const machines = searchProducts(catalog, {
    text: 'espresso machine',
    inStockOnly: true,
    sort: 'rating_desc',
    pageSize: 5,
  });
  assert.equal(machines.total, 6, 'only actual machines match the query');
  assert.equal(machines.totalPages, 2);
  assert.equal(machines.items.length, 5);
  assert.equal(machines.items[0]?.sku, 'RANCILIO-SILVIA');

  const secondPage = searchProducts(catalog, {
    text: 'espresso machine',
    inStockOnly: true,
    sort: 'rating_desc',
    pageSize: 5,
    page: 2,
  });
  assert.equal(secondPage.items.length, 1);

  const grinders = searchProducts(catalog, {
    category: 'Grinders',
    maxPriceUsd: 300,
    inStockOnly: true,
    sort: 'price_asc',
    pageSize: 100,
  });
  assert.ok(grinders.items.length >= 11);
  assert.ok(
    grinders.items.every(
      (product) => product.category === 'Grinders' && product.priceUsd <= 300 && product.inStock,
    ),
  );
});

// --- Kit 9 policy: mission ranking, approval binding, retry guard ------------

test('kit9 ranks offers by rating within budget and deadline', () => {
  const catalog = buildCatalog();
  const machines = searchProducts(catalog, { category: 'Espresso Machines', pageSize: 50 }).items;
  const offers = machines.flatMap((product) =>
    product.shipping.map((option) => buildOffer(product, option.code)),
  );
  const evaluation = rankOffers(offers, { budgetUsd: 500, deadlineDays: 2, quantity: 1 });

  assert.equal(evaluation.chosen?.sku, 'GAGGIA-EVO-CREMACO');
  assert.equal(evaluation.chosen?.totalUsd, 464);

  const bambino = evaluation.considered.find(
    (entry) => entry.offer.sku === 'BREVILLE-BAMBINO' && entry.offer.shippingCode === 'EXPEDITED',
  );
  assert.equal(bambino?.eligible, false);
  assert.match(bambino?.reason ?? '', /exceeds the \$500\.00 budget/);

  const dedica = evaluation.considered.find(
    (entry) => entry.offer.sku === 'DELONGHI-DEDICA' && entry.offer.shippingCode === 'EXPEDITED',
  );
  assert.equal(dedica?.eligible, true);
  assert.match(dedica?.reason ?? '', /rated 4\.4 vs 4\.6/);

  const standard = evaluation.considered.find(
    (entry) => entry.offer.sku === 'GAGGIA-EVO-CREMACO' && entry.offer.shippingCode === 'STANDARD',
  );
  assert.equal(standard?.eligible, false);
  assert.match(standard?.reason ?? '', /after the 2-day deadline/);
});

test('kit9 approval fingerprint stops covering the deal when product, merchant or total moves', () => {
  const catalog = buildCatalog();
  const cremaco = catalog.find((product) => product.sku === 'GAGGIA-EVO-CREMACO');
  const roast = catalog.find((product) => product.sku === 'GAGGIA-EVO-ROAST');
  assert.ok(cremaco && roast);

  const first = buildOffer(cremaco, 'EXPEDITED');
  const second = buildOffer(roast, 'EXPEDITED');
  const fingerprint = offerFingerprint(first);
  assert.equal(fingerprint, 'GAGGIA-EVO-CREMACO|CremaCo|464.00|EXPEDITED');
  assert.equal(approvalCovers(fingerprint, first), true);
  assert.equal(approvalCovers(fingerprint, second), false);

  const changes = fingerprintChanges(fingerprint, second);
  assert.equal(changes.length, 3);
  assert.ok(changes.some((change) => change.startsWith('product')));
  assert.ok(changes.some((change) => change.startsWith('merchant')));
  assert.ok(changes.some((change) => change.startsWith('delivered total')));
});

test('kit9 retry guard refuses a retry until the result is reported to Airi', () => {
  const guard = new AiriReportGuard();
  guard.recordAttempt({
    id: 'int_1',
    requestId: 'req_1',
    status: 'DECLINED',
    failureReason: 'AUTHENTICATION_EXPIRED',
  });

  const blocked = guard.canRetry();
  assert.equal(blocked.allowed, false);
  assert.match(blocked.allowed === false ? blocked.reason : '', /before any retry/);

  guard.report('int_1');
  assert.equal(guard.canRetry().allowed, true);
  assert.equal(guard.unreported().length, 0);
  assert.throws(() => guard.report('int_unknown'), /unknown attempt/);
});

// --- Kit 10 policy: checkout state machine -----------------------------------

test('checkout state machine refuses stale prices, expired sessions and closed sessions', () => {
  const service = new MerchantService(testClient());
  service.loadCatalog(buildCatalog());

  const checkout = service.createCheckout({ requestId: 'req-1', items: [CHECKOUT_ITEM] });
  assert.equal(checkout.status, 'ACTIVE');
  assert.equal(checkout.totalUsd, 484);
  assert.equal(checkoutBlockReason(checkout, service.getCatalog()), undefined, 'fresh checkout passes');

  const replay = service.createCheckout({ requestId: 'req-1', items: [CHECKOUT_ITEM] });
  assert.equal(replay.id, checkout.id, 'same request_id returns the same checkout');

  service.updatePrice('GAGGIA-EVO-ROAST', 479);
  const stale = checkoutBlockReason(checkout, service.getCatalog());
  assert.equal(stale?.code, 'price_changed');
  assert.match(stale?.detail ?? '', /issue a revised checkout/);

  const expiring = service.createCheckout({
    requestId: 'req-2',
    items: [CHECKOUT_ITEM],
    ttlMs: 0,
  });
  const expired = checkoutBlockReason(expiring, service.getCatalog());
  assert.equal(expired?.code, 'checkout_expired');

  const completed: MerchantCheckout = { ...checkout, status: 'COMPLETED' };
  const closed = checkoutBlockReason(completed, service.getCatalog());
  assert.equal(closed?.code, 'checkout_not_active');
});

test('completing a different checkout with a used request_id is refused', async () => {
  const service = new MerchantService(testClient());
  service.loadCatalog(buildCatalog());
  const card = {
    number: '4035501000000008',
    expiryMonth: '12',
    expiryYear: '2027',
    cvc: '123',
    name: 'Sandbox Shopper',
  };

  const first = service.createCheckout({ requestId: 'req-a', items: [CHECKOUT_ITEM] });
  const second = service.createCheckout({ requestId: 'req-b', items: [CHECKOUT_ITEM] });

  const completion = await service.completeCheckout({
    checkoutId: first.id,
    requestId: 'req-complete-1',
    payment: { type: 'card', card },
  });
  assert.equal(completion.ok, true);

  const conflict = await service.completeCheckout({
    checkoutId: second.id,
    requestId: 'req-complete-1',
    payment: { type: 'card', card },
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.ok === false ? conflict.code : '', 'request_id_conflict');
  assert.equal(second.status, 'ACTIVE', 'the conflicting checkout is not charged');
});

test('a TAP-enforced merchant refuses unsigned, retargeted, and replayed completions', async () => {
  const agent = generateTapAgent({ agentId: 'test-shopper' });
  const registry = new TapAgentRegistry();
  registry.register(tapAgentRegistryEntry(agent));
  const service = new MerchantService(testClient(), { tap: { registry, replayGuard: new TapReplayGuard() } });
  service.loadCatalog(buildCatalog());
  const card = {
    number: '4035501000000008',
    expiryMonth: '12',
    expiryYear: '2027',
    cvc: '123',
    name: 'Sandbox Shopper',
  };

  const checkout = service.createCheckout({ requestId: 'req-tap-1', items: [CHECKOUT_ITEM] });
  const other = service.createCheckout({ requestId: 'req-tap-2', items: [CHECKOUT_ITEM] });

  const unsigned = await service.completeCheckout({
    checkoutId: checkout.id,
    requestId: 'req-tap-complete',
    payment: { type: 'card', card },
  });
  assert.equal(unsigned.ok, false);
  assert.equal(unsigned.ok === false ? unsigned.code : '', 'tap_required');

  const proof = signTapCompletionProof({
    agent,
    checkoutId: checkout.id,
    requestId: 'req-tap-complete',
    paymentType: 'card',
  });
  const retargeted = await service.completeCheckout({
    checkoutId: other.id,
    requestId: 'req-tap-other',
    payment: { type: 'card', card },
    tap: { ...proof, path: `/checkout/${other.id}/complete` },
  });
  assert.equal(retargeted.ok, false);
  assert.equal(retargeted.ok === false ? retargeted.code : '', 'tap_rejected');
  assert.equal(other.status, 'ACTIVE', 'the retargeted checkout is not charged');

  const completion = await service.completeCheckout({
    checkoutId: checkout.id,
    requestId: 'req-tap-complete',
    payment: { type: 'card', card },
    tap: proof,
  });
  assert.equal(completion.ok, true);

  const replayedAttack = await service.completeCheckout({
    checkoutId: checkout.id,
    requestId: 'req-tap-complete',
    payment: { type: 'card', card },
    tap: proof,
  });
  assert.equal(replayedAttack.ok, false);
  assert.equal(replayedAttack.ok === false ? replayedAttack.code : '', 'tap_rejected');

  const retry = await service.completeCheckout({
    checkoutId: checkout.id,
    requestId: 'req-tap-complete',
    payment: { type: 'card', card },
    tap: signTapCompletionProof({
      agent,
      checkoutId: checkout.id,
      requestId: 'req-tap-complete',
      paymentType: 'card',
    }),
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.ok === true ? retry.replayed : false, true, 'a fresh signature replays the same order');
});

// --- Kit 9 end to end --------------------------------------------------------

test('kit9 re-approves on a material change and reports before retrying the Airi payment', async () => {
  const client = testClient();
  const result = await runKit9(client, logger, { autoApprove: true });

  assert.equal(result.approvals.length, 2);
  assert.equal(result.approvals[0]?.stage, 'INITIAL');
  assert.equal(result.approvals[0]?.fingerprint, 'GAGGIA-EVO-CREMACO|CremaCo|464.00|EXPEDITED');
  assert.equal(result.approvals[1]?.stage, 'FRESH');
  assert.equal(result.approvals[1]?.fingerprint, 'GAGGIA-EVO-ROAST|RoastWorks|484.00|EXPEDITED');
  assert.equal(result.approvals[1]?.changedFromPrevious.length, 3);

  assert.deepEqual(
    result.attempts.map((attempt) => attempt.status),
    ['DECLINED', 'SUCCEEDED'],
  );
  assert.deepEqual(
    result.reports.map((report) => report.result),
    ['DECLINED', 'SUCCEEDED'],
  );
  assert.equal(result.order.totalUsd, 484);
  assert.match(result.order.merchantOrderNumber, /^MO-\d{4}-\d{4}$/);
  assert.equal(result.tap.agentId, 'approval-bound-shopper');
  assert.equal(result.tap.verified, true, 'the shopper carried a TAP key the merchant verified');

  const snapshot = mockSnapshot(client);
  assert.equal(snapshot.paymentIntents.length, 2, 'one failed intent and one successful retry');
  assert.deepEqual(
    snapshot.paymentIntents.map((intent) => String(intent.status)).sort(),
    ['FAILED', 'SUCCEEDED'],
  );
});

// --- Kit 10 end to end -------------------------------------------------------

test('kit10 refuses the stale checkout, completes the revised one, and replays the order on retry', async () => {
  const client = testClient();
  const result = await runKit10(client, logger);

  assert.equal(result.catalogSize, 106);
  assert.ok(result.searchSample.total >= 6);

  assert.deepEqual(
    result.checkouts.map((checkout) => checkout.status).sort(),
    ['ACTIVE', 'COMPLETED', 'EXPIRED'],
  );
  const completed = result.checkouts.find((checkout) => checkout.status === 'COMPLETED');
  assert.equal(completed?.totalUsd, 494, 'the revised checkout carries the new price');
  assert.equal(completed?.attempts.length, 1, 'one payment attempt on the revised session');

  assert.equal(result.orders.length, 1, 'the retry never creates a second order');
  assert.equal(result.orders[0]?.totalUsd, 494);
  assert.match(result.orders[0]?.merchantOrderNumber ?? '', /^MO-\d{4}-\d{4}$/);

  const snapshot = mockSnapshot(client);
  assert.equal(snapshot.paymentIntents.length, 1, 'exactly one payment intent was charged');
  assert.equal(String(snapshot.paymentIntents[0]?.status), 'SUCCEEDED');

  assert.equal(result.tap.verified, true, 'the merchant verified the TAP-signed agent request');
  assert.equal(result.tap.agentId, 'agentic-shopper-1');
  assert.equal(result.tap.unsignedRefused, true, 'an unsigned completion is refused before any charge');
  assert.equal(result.tap.tamperRefused, true, 'a retargeted signature fails TAP verification');
  assert.equal(result.tap.replayRefused, true, 'a replayed signature is refused');
});
