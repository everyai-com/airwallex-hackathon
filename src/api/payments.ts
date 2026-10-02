import type { AirwallexClient } from '../core/client.js';
import { asRecord, num, str } from '../core/parse.js';

export interface PaymentIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
  merchantOrderId?: string;
}

export interface DisputeRecord {
  id: string;
  stage: string;
  status: string;
  amount: number;
  currency: string;
  paymentIntentId: string;
  reasonCode?: string;
  reasonType?: string;
  reasonDescription?: string;
  dueAt?: string;
}

function toPaymentIntent(item: unknown): PaymentIntent {
  const record = asRecord(item);
  return {
    id: String(record.id ?? ''),
    status: String(record.status ?? ''),
    amount: num(record.amount) ?? 0,
    currency: String(record.currency ?? ''),
    ...(str(record.merchant_order_id) ? { merchantOrderId: str(record.merchant_order_id) } : {}),
  };
}

export async function createPaymentIntent(
  client: AirwallexClient,
  input: {
    requestId: string;
    amount: number;
    currency: string;
    merchantOrderId: string;
    descriptor?: string;
  },
): Promise<PaymentIntent> {
  const response = await client.request<unknown>('/api/v1/pa/payment_intents/create', {
    body: {
      request_id: input.requestId,
      amount: input.amount,
      currency: input.currency,
      merchant_order_id: input.merchantOrderId,
      ...(input.descriptor ? { descriptor: input.descriptor } : {}),
    },
  });
  return toPaymentIntent(response);
}

/** Confirm with the sandbox test card 4035501000000008. */
export async function confirmPaymentIntent(
  client: AirwallexClient,
  input: {
    intentId: string;
    requestId: string;
    card: { number: string; expiryMonth: string; expiryYear: string; cvc: string; name: string };
  },
): Promise<PaymentIntent> {
  const response = await client.request<unknown>(
    `/api/v1/pa/payment_intents/${input.intentId}/confirm`,
    {
      body: {
        request_id: input.requestId,
        payment_method: {
          type: 'card',
          card: {
            number: input.card.number,
            expiry_month: input.card.expiryMonth,
            expiry_year: input.card.expiryYear,
            cvc: input.card.cvc,
            name: input.card.name,
          },
        },
      },
    },
  );
  return toPaymentIntent(response);
}

function toDispute(item: unknown): DisputeRecord {
  const record = asRecord(item);
  const reason = asRecord(record.reason);
  return {
    id: String(record.id ?? ''),
    stage: String(record.stage ?? ''),
    status: String(record.status ?? ''),
    amount: num(record.amount) ?? 0,
    currency: String(record.currency ?? ''),
    paymentIntentId: String(record.payment_intent_id ?? ''),
    ...(str(reason.original_code) ? { reasonCode: str(reason.original_code) } : {}),
    ...(str(reason.type) ? { reasonType: str(reason.type) } : {}),
    ...(str(reason.description) ? { reasonDescription: str(reason.description) } : {}),
    ...(str(record.due_at) ? { dueAt: str(record.due_at) } : {}),
  };
}

/** Sandbox only: stage a dispute at RFI / PRE_CHARGEBACK / CHARGEBACK / PRE_ARBITRATION. */
export async function simulatePaymentDispute(
  client: AirwallexClient,
  input: {
    paymentIntentId: string;
    stage: 'RFI' | 'PRE_CHARGEBACK' | 'CHARGEBACK' | 'PRE_ARBITRATION';
    reasonCode: string;
    amount?: number;
    dueAt?: string;
    comment?: string;
    documents?: string[];
  },
): Promise<DisputeRecord> {
  const response = await client.request<unknown>('/api/v1/simulation/pa/payment_disputes/create', {
    body: {
      payment_intent_id: input.paymentIntentId,
      stage: input.stage,
      reason_code: input.reasonCode,
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.dueAt ? { due_at: input.dueAt } : {}),
      ...(input.comment ? { comment: input.comment } : {}),
      ...(input.documents ? { documents: input.documents } : {}),
    },
  });
  return toDispute(response);
}

export async function listPaymentDisputes(client: AirwallexClient): Promise<DisputeRecord[]> {
  const response = await client.request<{ items: unknown[] }>('/api/v1/pa/payment_disputes', {
    method: 'GET',
  });
  return (response.items ?? []).map(toDispute);
}

/** Accept: use the typed reason enum, including LOW_VALUE_TRANSACTION. */
export async function acceptPaymentDispute(
  client: AirwallexClient,
  input: {
    disputeId: string;
    requestId: string;
    reason:
      | 'AGREEMENT_REACHED_WITH_CUSTOMER'
      | 'CUSTOMER_RELATIONSHIP_MAINTENANCE'
      | 'LOW_VALUE_TRANSACTION'
      | 'VALID_CUSTOMER_DISPUTE'
      | 'NO_ACTION_TAKEN_BY_MERCHANT'
      | 'OTHERS';
    description?: string;
  },
): Promise<DisputeRecord> {
  const response = await client.request<unknown>(
    `/api/v1/pa/payment_disputes/${input.disputeId}/accept`,
    {
      body: {
        request_id: input.requestId,
        reason: input.reason,
        ...(input.description ? { description: input.description } : {}),
      },
    },
  );
  return toDispute(response);
}

/** REST only: the MCP challenge tool lacks required fields. */
export async function challengePaymentDispute(
  client: AirwallexClient,
  input: {
    disputeId: string;
    requestId: string;
    reason?: string;
    productType?: string;
    productDescription?: string;
    customerInfo?: Record<string, string>;
    deliveryInfo?: Record<string, unknown>;
    supportingDocuments?: { type: string; file_ids: string[] }[];
  },
): Promise<DisputeRecord> {
  const response = await client.request<unknown>(
    `/api/v1/pa/payment_disputes/${input.disputeId}/challenge`,
    {
      body: {
        request_id: input.requestId,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.productType ? { product_type: input.productType } : {}),
        ...(input.productDescription ? { product_description: input.productDescription } : {}),
        ...(input.customerInfo ? { customer_info: input.customerInfo } : {}),
        ...(input.deliveryInfo ? { delivery_info: input.deliveryInfo } : {}),
        ...(input.supportingDocuments
          ? { supporting_documents: { documents: input.supportingDocuments } }
          : {}),
      },
    },
  );
  return toDispute(response);
}

/** Sandbox only: escalate a challenged dispute to the next stage. */
export async function escalatePaymentDispute(
  client: AirwallexClient,
  input: { disputeId: string; dueAt?: string; comment?: string; amount?: number; documents?: string[] },
): Promise<DisputeRecord> {
  const response = await client.request<unknown>(
    `/api/v1/simulation/pa/payment_disputes/${input.disputeId}/escalate`,
    {
      body: {
        ...(input.dueAt ? { due_at: input.dueAt } : {}),
        ...(input.comment ? { comment: input.comment } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.documents ? { documents: input.documents } : {}),
      },
    },
  );
  return toDispute(response);
}

/** Sandbox only: final ruling. CUSTOMER means the merchant loses, MERCHANT means won/reversed. */
export async function resolvePaymentDispute(
  client: AirwallexClient,
  input: { disputeId: string; inFavorOf: 'MERCHANT' | 'CUSTOMER'; amount?: number; comment?: string },
): Promise<DisputeRecord> {
  const response = await client.request<unknown>(
    `/api/v1/simulation/pa/payment_disputes/${input.disputeId}/resolve`,
    {
      body: {
        in_favor_of: input.inFavorOf,
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.comment ? { comment: input.comment } : {}),
      },
    },
  );
  return toDispute(response);
}

export async function listRefunds(client: AirwallexClient): Promise<Record<string, unknown>[]> {
  const response = await client.request<{ items: Record<string, unknown>[] }>('/api/v1/pa/refunds', {
    method: 'GET',
  });
  return response.items ?? [];
}
