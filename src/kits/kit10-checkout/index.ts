import type { AirwallexClient } from '../../core/client.js';
import type { Logger } from '../../core/log.js';
import { formatAmount } from '../../core/money.js';
import {
  generateTapAgent,
  TapAgentRegistry,
  TapReplayGuard,
  tapAgentRegistryEntry,
} from '../../core/tap.js';
import { buildCatalog, type SearchResult } from '../commerce-catalog.js';
import {
  MerchantService,
  signTapCompletionProof,
  type MerchantCheckout,
  type MerchantOrder,
} from '../commerce-merchant.js';

const TEST_CARD = {
  number: '4035501000000008',
  expiryMonth: '12',
  expiryYear: '2027',
  cvc: '123',
  name: 'Sandbox Shopper',
};

export interface Kit10Result {
  catalogSize: number;
  searchSample: SearchResult;
  checkouts: MerchantCheckout[];
  orders: MerchantOrder[];
  tap: {
    agentId: string;
    verified: boolean;
    unsignedRefused: boolean;
    tamperRefused: boolean;
    replayRefused: boolean;
  };
}

/**
 * Merchant-Enabled Agentic Checkout: the merchant side. Loads a catalog,
 * exposes the product-search tool, snapshots prices into checkout sessions,
 * enforces expiry and revised-checkout rules, takes the hosted test payment,
 * and returns the order contract that makes retries safe.
 */
export async function runKit10(client: AirwallexClient, logger: Logger): Promise<Kit10Result> {
  const ids = client.requestIds();
  const tapAgent = generateTapAgent({ agentId: 'agentic-shopper-1' });
  const tapRegistry = new TapAgentRegistry();
  tapRegistry.register(tapAgentRegistryEntry(tapAgent));
  const merchant = new MerchantService(client, { tap: { registry: tapRegistry, replayGuard: new TapReplayGuard() } });
  const catalog = buildCatalog();
  merchant.loadCatalog(catalog);

  logger.chapter('Merchant-Enabled Agentic Checkout — the merchant side of an agent purchase');
  logger.info(
    'Goal: expose a catalog and product-search tool, take an agent through checkout, and enforce the retry contract.',
  );

  const categories = [...new Set(catalog.map((product) => product.category))];
  const inStock = catalog.filter((product) => product.inStock).length;
  logger.detail(
    'Catalog loaded',
    `${catalog.length} products across ${categories.length} categories (${inStock} in stock)`,
  );
  for (const category of categories) {
    const count = catalog.filter((product) => product.category === category).length;
    logger.detail(`  ${category}`, `${count} listings`);
  }

  logger.chapter('Product-search tool — filters and pagination');
  const machineSearch = merchant.search({
    text: 'espresso machine',
    inStockOnly: true,
    sort: 'rating_desc',
    pageSize: 5,
  });
  logger.detail(
    'Search',
    `"espresso machine" -> ${machineSearch.total} matches, page ${machineSearch.page}/${machineSearch.totalPages}`,
  );
  for (const product of machineSearch.items) {
    logger.detail(
      `  ${product.sku}`,
      `${product.name} — USD ${product.priceUsd.toFixed(2)} | ${product.merchant} | rating ${product.rating}`,
    );
  }

  const grinderPage = merchant.search({
    category: 'Grinders',
    maxPriceUsd: 300,
    inStockOnly: true,
    sort: 'price_asc',
    page: 2,
    pageSize: 3,
  });
  logger.detail(
    'Filtered page',
    `Grinders <= USD 300 -> ${grinderPage.total} matches, page ${grinderPage.page}/${grinderPage.totalPages}`,
  );
  for (const product of grinderPage.items) {
    logger.detail(`  ${product.sku}`, `${product.name} — USD ${product.priceUsd.toFixed(2)}`);
  }

  logger.chapter('Checkout creation — price snapshot, idempotent by request_id');
  const checkoutRequestId = ids.forOperation('kit10-checkout');
  const checkout = merchant.createCheckout({
    requestId: checkoutRequestId,
    items: [{ sku: 'GAGGIA-EVO-ROAST', quantity: 1, shippingCode: 'EXPEDITED' }],
    customerEmail: 'agent-checkout@example.com',
    successUrl: 'https://merchant.example/orders/thanks',
  });
  logger.detail('Checkout', `${checkout.id} ${checkout.status}`);
  logger.detail(
    'Line items',
    checkout.lineItems
      .map(
        (item) =>
          `${item.sku} x${item.quantity} @ ${formatAmount(item.unitPriceUsd, 'USD')} + ${formatAmount(item.shippingUsd, 'USD')} ${item.shippingCode}`,
      )
      .join(' | '),
  );
  logger.detail(
    'Total',
    `${formatAmount(checkout.totalUsd, 'USD')} (subtotal ${formatAmount(checkout.subtotalUsd, 'USD')} + shipping ${formatAmount(checkout.shippingUsd, 'USD')})`,
  );
  logger.detail('Hosted page', checkout.url);
  logger.detail('Expires', checkout.expiresAt);

  const checkoutReplay = merchant.createCheckout({
    requestId: checkoutRequestId,
    items: [{ sku: 'GAGGIA-EVO-ROAST', quantity: 1, shippingCode: 'EXPEDITED' }],
  });
  logger.detail(
    'Same request_id again',
    `${checkoutReplay.id} — ${checkoutReplay.id === checkout.id ? 'the existing checkout is returned, never a second cart' : 'UNEXPECTED: a second checkout was created'}`,
  );

  logger.chapter('New information: the supplier price changes after the snapshot');
  merchant.updatePrice('GAGGIA-EVO-ROAST', 479);
  logger.info('The merchant price feed moved GAGGIA-EVO-ROAST from USD 469.00 to USD 479.00.');
  const staleRequestId = ids.fresh();
  const staleAttempt = await merchant.completeCheckout({
    checkoutId: checkout.id,
    requestId: staleRequestId,
    payment: { type: 'card', card: TEST_CARD },
    tap: signTapCompletionProof({ agent: tapAgent, checkoutId: checkout.id, requestId: staleRequestId, paymentType: 'card' }),
  });
  logger.detail(
    'Complete attempt',
    staleAttempt.ok ? 'UNEXPECTED: stale checkout was charged' : `${staleAttempt.code} — ${staleAttempt.detail}`,
  );
  logger.decision(
    'REFUSE CHARGE',
    'The checkout snapshotted USD 469.00; the current price is USD 479.00. The agent gets a revised checkout, not a silent charge.',
  );

  logger.chapter('State rules — an expired checkout is never charged');
  const expiring = merchant.createCheckout({
    requestId: ids.fresh(),
    items: [{ sku: 'GAGGIA-EVO-ROAST', quantity: 1, shippingCode: 'EXPEDITED' }],
    ttlMs: 0,
  });
  const expiredRequestId = ids.fresh();
  const expiredAttempt = await merchant.completeCheckout({
    checkoutId: expiring.id,
    requestId: expiredRequestId,
    payment: { type: 'card', card: TEST_CARD },
    tap: signTapCompletionProof({ agent: tapAgent, checkoutId: expiring.id, requestId: expiredRequestId, paymentType: 'card' }),
  });
  logger.detail(
    'Checkout with ttl 0',
    expiredAttempt.ok
      ? 'UNEXPECTED: expired checkout was charged'
      : `${expiredAttempt.code} — ${expiredAttempt.detail}`,
  );
  logger.detail('Status transition', `${expiring.id} -> ${merchant.getCheckout(expiring.id)?.status}`);
  logger.decision(
    'EXPIRE',
    'Checkout sessions live one hour; completing a stale session is refused and the status becomes EXPIRED.',
  );

  logger.chapter('Revised checkout and hosted test payment');
  const revised = merchant.createCheckout({
    requestId: ids.forOperation('kit10-checkout-revised'),
    items: [{ sku: 'GAGGIA-EVO-ROAST', quantity: 1, shippingCode: 'EXPEDITED' }],
    customerEmail: 'agent-checkout@example.com',
    successUrl: 'https://merchant.example/orders/thanks',
  });
  logger.detail(
    'Revised checkout',
    `${revised.id} ${revised.status} — ${formatAmount(revised.totalUsd, 'USD')} at the new price`,
  );

  const completionRequestId = ids.forOperation('kit10-complete');

  logger.chapter('Visa Trusted Agent Protocol — the merchant verifies the agent, not a prompt');
  logger.info(
    'Every completion on this merchant carries a TAP signature; the merchant verifies it before any checkout rule runs.',
  );
  let agentVerified = '';
  let unsignedRefused = false;
  let tamperRefused = false;
  let replayRefused = false;

  await logger.step('An unsigned completion is refused', async () => {
    const unsigned = await merchant.completeCheckout({
      checkoutId: revised.id,
      requestId: ids.fresh(),
      payment: { type: 'card', card: TEST_CARD },
    });
    if (unsigned.ok || unsigned.code !== 'tap_required') {
      throw new Error('Expected the unsigned completion to be refused with tap_required.');
    }
    unsignedRefused = true;
    logger.detail('Result', `${unsigned.code} — ${unsigned.detail}`);
    logger.decision('REFUSE', 'No agent signature, no charge — authentication precedes authorization.');
  });

  const completionProof = signTapCompletionProof({
    agent: tapAgent,
    checkoutId: revised.id,
    requestId: completionRequestId,
    paymentType: 'card',
  });

  await logger.step('The agent signs its completion (Ed25519, RFC 9421, body-bound)', async () => {
    logger.detail('Signature-Input', `${completionProof.headers['Signature-Input']?.slice(0, 110) ?? ''}...`);
    logger.detail('Content-Digest', `${completionProof.headers['Content-Digest']?.slice(0, 60) ?? ''}...`);
    logger.detail('Body', completionProof.body ?? '');
  });

  const completion = await merchant.completeCheckout({
    checkoutId: revised.id,
    requestId: completionRequestId,
    payment: { type: 'card', card: TEST_CARD },
    tap: completionProof,
  });
  if (!completion.ok) throw new Error(`Hosted test payment failed: ${completion.detail}`);
  agentVerified = tapAgent.agentId;
  logger.decision(
    'ALLOW',
    'The merchant verified cryptographic agent identity and authorization before taking the payment.',
  );
  logger.detail('Hosted test payment', 'card 4035 5010 0000 0008 accepted');
  logger.detail('Order', `${completion.order.merchantOrderNumber} ${completion.order.status}`);
  logger.detail('Payment intent', completion.order.paymentIntentId);

  await logger.step('A retargeted signature is refused at the completion path', async () => {
    const retargeted = await merchant.completeCheckout({
      checkoutId: checkout.id,
      requestId: ids.fresh(),
      payment: { type: 'card', card: TEST_CARD },
      tap: { ...completionProof, path: `/checkout/${checkout.id}/complete` },
    });
    if (retargeted.ok || retargeted.code !== 'tap_rejected') {
      throw new Error('Expected the retargeted completion to be refused with tap_rejected.');
    }
    tamperRefused = true;
    logger.detail('Result', `${retargeted.code} — ${retargeted.detail}`);
    logger.decision(
      'REFUSE',
      'The signature is bound to the merchant domain, path, and body; a signature lifted onto another checkout cannot verify.',
    );
  });

  await logger.step('A replayed signature is refused at the completion path', async () => {
    const replayed = await merchant.completeCheckout({
      checkoutId: revised.id,
      requestId: completionRequestId,
      payment: { type: 'card', card: TEST_CARD },
      tap: completionProof,
    });
    if (replayed.ok || replayed.code !== 'tap_rejected') {
      throw new Error('Expected the replayed completion to be refused with tap_rejected.');
    }
    replayRefused = true;
    logger.detail('Result', `${replayed.code} — ${replayed.detail}`);
    logger.decision('REFUSE', 'Nonces are single-use; a captured completion cannot be replayed.');
  });

  const retryProof = signTapCompletionProof({
    agent: tapAgent,
    checkoutId: revised.id,
    requestId: completionRequestId,
    paymentType: 'card',
  });
  const replayCompletion = await merchant.completeCheckout({
    checkoutId: revised.id,
    requestId: completionRequestId,
    payment: { type: 'card', card: TEST_CARD },
    tap: retryProof,
  });
  logger.detail(
    'Same completion request_id, fresh signature',
    replayCompletion.ok && replayCompletion.replayed
      ? `${replayCompletion.order.id} — the same order is returned, no second charge`
      : 'UNEXPECTED: the retry did not replay the order',
  );

  logger.chapter('Order response and reconciliation');
  logger.detail(
    'Order response',
    `{ merchant_order_number: ${completion.order.merchantOrderNumber}, status: ${completion.order.status}, amount: ${formatAmount(completion.order.totalUsd, 'USD')}, payment_intent_id: ${completion.order.paymentIntentId} }`,
  );
  logger.detail(
    'Checkouts',
    merchant
      .listCheckouts()
      .map((entry) => `${entry.id} ${entry.status}`)
      .join(' | '),
  );
  logger.detail('Orders', `${merchant.listOrders().length} — retries never create a second charge`);
  logger.detail('Completion attempts', `${revised.attempts.length} on the revised session (one charge)`);

  logger.chapter('Outcome');
  logger.info(
    `Catalog of ${catalog.length} products; one revised checkout completed; order ${completion.order.merchantOrderNumber} is returned by both the original completion and its retry.`,
  );

  return {
    catalogSize: catalog.length,
    searchSample: machineSearch,
    checkouts: merchant.listCheckouts(),
    orders: merchant.listOrders(),
    tap: {
      agentId: agentVerified,
      verified: agentVerified !== '',
      unsignedRefused,
      tamperRefused,
      replayRefused,
    },
  };
}
