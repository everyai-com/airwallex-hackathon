import type { AirwallexClient } from '../../core/client.js';
import type { Logger } from '../../core/log.js';
import { formatAmount } from '../../core/money.js';
import { buildCatalog, type SearchResult } from '../commerce-catalog.js';
import {
  MerchantService,
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
}

/**
 * Merchant-Enabled Agentic Checkout: the merchant side. Loads a catalog,
 * exposes the product-search tool, snapshots prices into checkout sessions,
 * enforces expiry and revised-checkout rules, takes the hosted test payment,
 * and returns the order contract that makes retries safe.
 */
export async function runKit10(client: AirwallexClient, logger: Logger): Promise<Kit10Result> {
  const ids = client.requestIds();
  const merchant = new MerchantService(client);
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
  const staleAttempt = await merchant.completeCheckout({
    checkoutId: checkout.id,
    requestId: ids.fresh(),
    payment: { type: 'card', card: TEST_CARD },
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
  const expiredAttempt = await merchant.completeCheckout({
    checkoutId: expiring.id,
    requestId: ids.fresh(),
    payment: { type: 'card', card: TEST_CARD },
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
  const completion = await merchant.completeCheckout({
    checkoutId: revised.id,
    requestId: completionRequestId,
    payment: { type: 'card', card: TEST_CARD },
  });
  if (!completion.ok) throw new Error(`Hosted test payment failed: ${completion.detail}`);
  logger.detail('Hosted test payment', 'card 4035 5010 0000 0008 accepted');
  logger.detail('Order', `${completion.order.merchantOrderNumber} ${completion.order.status}`);
  logger.detail('Payment intent', completion.order.paymentIntentId);

  const replayCompletion = await merchant.completeCheckout({
    checkoutId: revised.id,
    requestId: completionRequestId,
    payment: { type: 'card', card: TEST_CARD },
  });
  logger.detail(
    'Same completion request_id',
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
  };
}
