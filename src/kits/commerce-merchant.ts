/**
 * In-memory merchant service for the Agentic Commerce kits (9-10): the
 * merchant's catalog, product-search tool, hosted checkout, order-response and
 * retry contract. It stands in for the enablement-gated merchant-side Agentic
 * Commerce surface (see submission/enablement-requests.md) — while the payment
 * underneath is a real Airwallex payment intent through the shared client, so
 * the money path is identical in mock and live sandbox runs.
 *
 * Rules the merchant enforces in code, never in a prompt:
 * - a checkout snapshots prices at creation; a later price change forces a
 *   revised checkout instead of a silent charge;
 * - a checkout expires one hour after creation;
 * - completing with a request_id that already produced an order returns that
 *   order — retries never create a second charge;
 * - when constructed with TAP enforcement, the completion path verifies a
 *   Visa Trusted Agent Protocol signature first — unsigned or forged
 *   completions are refused before any checkout rule is even evaluated.
 */

import { randomUUID } from 'node:crypto';
import { confirmPaymentIntent, createPaymentIntent } from '../api/payments.js';
import type { AirwallexClient } from '../core/client.js';
import { round2 } from '../core/money.js';
import {
  signTapRequest,
  verifyTapRequest,
  type TapAgentKey,
  type TapAgentRegistry,
  type TapReplayGuard,
} from '../core/tap.js';
import type { Product, ProductQuery, SearchResult } from './commerce-catalog.js';
import { searchProducts } from './commerce-catalog.js';

export const CHECKOUT_TTL_MS = 60 * 60 * 1000;

export type CheckoutStatus = 'ACTIVE' | 'COMPLETED' | 'EXPIRED';

export interface CheckoutLineItem {
  sku: string;
  name: string;
  quantity: number;
  unitPriceUsd: number;
  shippingCode: 'STANDARD' | 'EXPEDITED';
  shippingUsd: number;
  lineAmountUsd: number;
}

export interface CheckoutAttempt {
  id: string;
  requestId: string;
  paymentIntentId?: string;
  status: 'DECLINED' | 'SUCCEEDED';
  failureReason?: string;
  at: string;
}

export interface MerchantCheckout {
  id: string;
  requestId: string;
  status: CheckoutStatus;
  currency: 'USD';
  lineItems: CheckoutLineItem[];
  subtotalUsd: number;
  shippingUsd: number;
  totalUsd: number;
  url: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  paymentIntentId?: string;
  orderId?: string;
  attempts: CheckoutAttempt[];
}

export interface MerchantOrder {
  id: string;
  merchantOrderNumber: string;
  checkoutId: string;
  paymentIntentId: string;
  totalUsd: number;
  currency: 'USD';
  status: 'SUCCEEDED';
  createdAt: string;
}

export interface AiriReport {
  id: string;
  checkoutId: string;
  requestId: string;
  result: 'DECLINED' | 'SUCCEEDED';
  reason?: string;
  at: string;
}

export interface CardPayment {
  number: string;
  expiryMonth: string;
  expiryYear: string;
  cvc: string;
  name: string;
}

export type PaymentInput = { type: 'card'; card: CardPayment } | { type: 'airi'; email: string };

export interface CheckoutBlock {
  code: 'checkout_expired' | 'checkout_not_active' | 'price_changed' | 'item_unavailable';
  detail: string;
}

export type CompletionResult =
  | { ok: true; order: MerchantOrder; replayed: boolean }
  | {
      ok: false;
      code:
        | CheckoutBlock['code']
        | 'checkout_not_found'
        | 'request_id_conflict'
        | 'payment_declined'
        | 'payment_error'
        | 'tap_required'
        | 'tap_rejected';
      detail: string;
      failureReason?: string;
      paymentIntentId?: string;
    };

const nowIso = (): string => new Date().toISOString();
const id = (prefix: string): string => `${prefix}_${randomUUID().slice(0, 8)}`;

/**
 * The checkout state machine as a pure function: active, unexpired, with every
 * line item still available at the price the checkout snapshotted.
 */
export function checkoutBlockReason(
  checkout: MerchantCheckout,
  catalog: Product[],
  nowMs: number = Date.now(),
): CheckoutBlock | undefined {
  if (checkout.status !== 'ACTIVE') {
    return {
      code: 'checkout_not_active',
      detail: `Checkout ${checkout.id} is ${checkout.status}; a closed checkout is never charged again.`,
    };
  }
  if (nowMs >= Date.parse(checkout.expiresAt)) {
    return {
      code: 'checkout_expired',
      detail: `Checkout ${checkout.id} expired at ${checkout.expiresAt} — issue a revised checkout.`,
    };
  }
  for (const item of checkout.lineItems) {
    const product = catalog.find((entry) => entry.sku === item.sku);
    if (!product || !product.inStock) {
      return {
        code: 'item_unavailable',
        detail: `${item.sku} went out of stock after the checkout was created.`,
      };
    }
    if (round2(product.priceUsd) !== round2(item.unitPriceUsd)) {
      return {
        code: 'price_changed',
        detail: `${item.sku} moved from USD ${item.unitPriceUsd.toFixed(2)} to USD ${product.priceUsd.toFixed(2)} after the checkout was created — issue a revised checkout.`,
      };
    }
  }
  return undefined;
}

export interface CreateCheckoutInput {
  requestId: string;
  items: { sku: string; quantity: number; shippingCode: 'STANDARD' | 'EXPEDITED' }[];
  customerEmail?: string;
  successUrl?: string;
  ttlMs?: number;
}

/** Visa TAP proof the agent attaches to a completion request. */
export interface TapCompletionProof {
  method: string;
  authority: string;
  path: string;
  query?: string;
  headers: Record<string, string | undefined>;
  body?: string;
}

export interface MerchantTapEnforcement {
  registry: TapAgentRegistry;
  replayGuard?: TapReplayGuard;
}

/** Merchant domain TAP completion signatures bind to. */
export const TAP_MERCHANT_AUTHORITY = 'sandbox.merchant.example';

/**
 * Shopper-side helper: sign a TAP completion proof (`agent-payer-auth` over
 * method, merchant domain, path, query, and a Content-Digest of the body).
 */
export function signTapCompletionProof(input: {
  agent: TapAgentKey;
  checkoutId: string;
  requestId: string;
  paymentType: 'card' | 'airi';
  authority?: string;
}): TapCompletionProof {
  const authority = input.authority ?? TAP_MERCHANT_AUTHORITY;
  const body = JSON.stringify({
    checkout_id: input.checkoutId,
    request_id: input.requestId,
    payment_type: input.paymentType,
  });
  const path = `/checkout/${input.checkoutId}/complete`;
  const query = `request_id=${input.requestId}`;
  const headers = signTapRequest({
    key: input.agent,
    method: 'POST',
    authority,
    path,
    query,
    tag: 'agent-payer-auth',
    body,
  });
  return { method: 'POST', authority, path, query, headers, body };
}

export interface CompleteCheckoutInput {
  checkoutId: string;
  requestId: string;
  payment: PaymentInput;
  /** Sandbox only: force a declined attempt to exercise report-before-retry. */
  simulateFailureReason?: string;
  /** Required when the merchant was constructed with TAP enforcement. */
  tap?: TapCompletionProof;
}

export class MerchantService {
  private catalog: Product[] = [];
  private readonly checkouts = new Map<string, MerchantCheckout>();
  private readonly checkoutsByRequestId = new Map<string, string>();
  private readonly orders: MerchantOrder[] = [];
  private readonly ordersByRequestId = new Map<string, MerchantOrder>();
  private readonly reports: AiriReport[] = [];
  private orderSequence = 1000;

  private readonly tapEnforcement?: MerchantTapEnforcement;

  constructor(
    private readonly client: AirwallexClient,
    opts?: { tap?: MerchantTapEnforcement },
  ) {
    this.tapEnforcement = opts?.tap;
  }

  loadCatalog(products: Product[]): void {
    this.catalog = products.map((product) => ({ ...product }));
  }

  getCatalog(): Product[] {
    return this.catalog;
  }

  search(query: ProductQuery): SearchResult {
    return searchProducts(this.catalog, query);
  }

  setAvailability(sku: string, inStock: boolean): void {
    const product = this.requireProduct(sku);
    product.inStock = inStock;
  }

  updatePrice(sku: string, priceUsd: number): void {
    const product = this.requireProduct(sku);
    product.priceUsd = round2(priceUsd);
  }

  createCheckout(input: CreateCheckoutInput): MerchantCheckout {
    const existingId = this.checkoutsByRequestId.get(input.requestId);
    if (existingId) {
      const existing = this.checkouts.get(existingId);
      if (existing) return existing;
    }

    const lineItems: CheckoutLineItem[] = input.items.map((item) => {
      const product = this.requireProduct(item.sku);
      if (!product.inStock) throw new Error(`${item.sku} is out of stock and cannot be checked out.`);
      const option = product.shipping.find((entry) => entry.code === item.shippingCode);
      if (!option) throw new Error(`${item.sku} has no ${item.shippingCode} shipping option.`);
      const quantity = Math.max(1, Math.trunc(item.quantity));
      return {
        sku: product.sku,
        name: product.name,
        quantity,
        unitPriceUsd: round2(product.priceUsd),
        shippingCode: option.code,
        shippingUsd: round2(option.priceUsd),
        lineAmountUsd: round2(product.priceUsd * quantity),
      };
    });

    const subtotalUsd = round2(lineItems.reduce((sum, item) => sum + item.lineAmountUsd, 0));
    const shippingUsd = round2(lineItems.reduce((sum, item) => sum + item.shippingUsd, 0));
    const createdAtMs = Date.now();
    const ttlMs = Math.max(0, input.ttlMs ?? CHECKOUT_TTL_MS);
    const checkoutId = id('mch');
    const checkout: MerchantCheckout = {
      id: checkoutId,
      requestId: input.requestId,
      status: 'ACTIVE',
      currency: 'USD',
      lineItems,
      subtotalUsd,
      shippingUsd,
      totalUsd: round2(subtotalUsd + shippingUsd),
      url: `https://sandbox.merchant.example/checkout/${checkoutId}`,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + ttlMs).toISOString(),
      attempts: [],
    };

    this.checkouts.set(checkout.id, checkout);
    this.checkoutsByRequestId.set(input.requestId, checkout.id);
    return checkout;
  }

  async completeCheckout(input: CompleteCheckoutInput): Promise<CompletionResult> {
    if (this.tapEnforcement) {
      const proof = input.tap;
      if (!proof) {
        return {
          ok: false,
          code: 'tap_required',
          detail: `Checkout ${input.checkoutId} requires a Visa TAP agent signature; the unsigned completion was refused.`,
        };
      }
      const verified = verifyTapRequest({
        method: proof.method,
        authority: proof.authority,
        path: proof.path,
        ...(proof.query !== undefined ? { query: proof.query } : {}),
        headers: proof.headers,
        registry: this.tapEnforcement.registry,
        ...(this.tapEnforcement.replayGuard ? { replayGuard: this.tapEnforcement.replayGuard } : {}),
        ...(proof.body !== undefined ? { body: proof.body } : {}),
      });
      if (!verified.valid) {
        return {
          ok: false,
          code: 'tap_rejected',
          detail: `TAP verification failed (${verified.code}): ${verified.detail} The completion was refused.`,
        };
      }
    }

    const replay = this.ordersByRequestId.get(input.requestId);
    if (replay) {
      if (replay.checkoutId !== input.checkoutId) {
        return {
          ok: false,
          code: 'request_id_conflict',
          detail: `request_id ${input.requestId} already produced an order for checkout ${replay.checkoutId}; it cannot complete ${input.checkoutId}.`,
        };
      }
      return { ok: true, order: replay, replayed: true };
    }

    const checkout = this.checkouts.get(input.checkoutId);
    if (!checkout) {
      return { ok: false, code: 'checkout_not_found', detail: `No checkout ${input.checkoutId}.` };
    }

    const block = checkoutBlockReason(checkout, this.catalog);
    if (block) {
      if (block.code === 'checkout_expired' && checkout.status === 'ACTIVE') {
        checkout.status = 'EXPIRED';
      }
      return { ok: false, ...block };
    }

    const failureReason = input.simulateFailureReason
      ? String(input.simulateFailureReason)
      : undefined;
    let paymentIntentId: string | undefined;

    try {
      const intent = await createPaymentIntent(this.client, {
        requestId: `pay-${input.requestId}`,
        amount: checkout.totalUsd,
        currency: checkout.currency,
        merchantOrderId: checkout.id,
      });
      paymentIntentId = intent.id;
      const confirmed = await confirmPaymentIntent(this.client, {
        intentId: intent.id,
        requestId: `confirm-${input.requestId}`,
        ...(input.payment.type === 'card'
          ? { card: input.payment.card }
          : { airi: { email: input.payment.email } }),
        ...(failureReason ? { simulateFailureReason: failureReason } : {}),
      });

      const attempt: CheckoutAttempt = {
        id: id('att'),
        requestId: input.requestId,
        paymentIntentId: intent.id,
        status: confirmed.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'DECLINED',
        ...(confirmed.failureReason ? { failureReason: confirmed.failureReason } : {}),
        at: nowIso(),
      };
      checkout.attempts.push(attempt);

      if (confirmed.status !== 'SUCCEEDED') {
        return {
          ok: false,
          code: 'payment_declined',
          detail: `Payment declined (${attempt.failureReason ?? 'unknown reason'}). Report the result to Airi before retrying.`,
          ...(attempt.failureReason ? { failureReason: attempt.failureReason } : {}),
          paymentIntentId: intent.id,
        };
      }

      this.orderSequence += 1;
      const year = new Date().getUTCFullYear();
      const order: MerchantOrder = {
        id: id('ord'),
        merchantOrderNumber: `MO-${year}-${String(this.orderSequence).padStart(4, '0')}`,
        checkoutId: checkout.id,
        paymentIntentId: intent.id,
        totalUsd: checkout.totalUsd,
        currency: checkout.currency,
        status: 'SUCCEEDED',
        createdAt: nowIso(),
      };

      checkout.status = 'COMPLETED';
      checkout.completedAt = order.createdAt;
      checkout.paymentIntentId = intent.id;
      checkout.orderId = order.id;
      this.orders.push(order);
      this.ordersByRequestId.set(input.requestId, order);
      return { ok: true, order, replayed: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checkout.attempts.push({
        id: id('att'),
        requestId: input.requestId,
        ...(paymentIntentId ? { paymentIntentId } : {}),
        status: 'DECLINED',
        failureReason: message,
        at: nowIso(),
      });
      return {
        ok: false,
        code: 'payment_error',
        detail: message,
        ...(paymentIntentId ? { paymentIntentId } : {}),
      };
    }
  }

  /** The Airi CLI contract: every payment result is reported before any retry. */
  reportToAiri(input: {
    checkoutId: string;
    requestId: string;
    result: 'DECLINED' | 'SUCCEEDED';
    reason?: string;
  }): AiriReport {
    const report: AiriReport = {
      id: id('airi'),
      checkoutId: input.checkoutId,
      requestId: input.requestId,
      result: input.result,
      ...(input.reason ? { reason: input.reason } : {}),
      at: nowIso(),
    };
    this.reports.push(report);
    return report;
  }

  getCheckout(checkoutId: string): MerchantCheckout | undefined {
    return this.checkouts.get(checkoutId);
  }

  listCheckouts(): MerchantCheckout[] {
    return [...this.checkouts.values()];
  }

  listOrders(): MerchantOrder[] {
    return [...this.orders];
  }

  listReports(): AiriReport[] {
    return [...this.reports];
  }

  private requireProduct(sku: string): Product {
    const product = this.catalog.find((entry) => entry.sku === sku);
    if (!product) throw new Error(`Unknown SKU ${sku} in the merchant catalog.`);
    return product;
  }
}
