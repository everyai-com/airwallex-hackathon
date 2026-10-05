/**
 * Kit 17 events — canonical Airwallex webhook shapes the reactor handles.
 * The kit builds its own payout, collection and invoice, then feeds the
 * matching events through the policy exactly as the platform would deliver
 * them: at-least-once, possibly duplicated, possibly unknown.
 */

export type WebhookEventType =
  | 'transfer.paid'
  | 'transfer.failed'
  | 'invoice.finalized'
  | 'invoice.payment.paid'
  | 'invoice.payment.failed';

export interface WebhookEvent {
  /** Platform delivery id — dedupe key. Redeliveries reuse it. */
  id: string;
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
}

export function transferPaidEvent(
  id: string,
  input: { transferId: string; requestId: string; amount: number; currency: string },
): WebhookEvent {
  return {
    id,
    type: 'transfer.paid',
    createdAt: new Date().toISOString(),
    data: {
      transfer_id: input.transferId,
      request_id: input.requestId,
      amount: input.amount,
      currency: input.currency,
    },
  };
}

export function transferFailedEvent(
  id: string,
  input: {
    transferId: string;
    requestId: string;
    amount: number;
    currency: string;
    failureType: string;
  },
): WebhookEvent {
  return {
    id,
    type: 'transfer.failed',
    createdAt: new Date().toISOString(),
    data: {
      transfer_id: input.transferId,
      request_id: input.requestId,
      amount: input.amount,
      currency: input.currency,
      failure_type: input.failureType,
    },
  };
}

export function invoiceFinalizedEvent(
  id: string,
  input: { invoiceId: string; number: string; amount: number; currency: string },
): WebhookEvent {
  return {
    id,
    type: 'invoice.finalized',
    createdAt: new Date().toISOString(),
    data: {
      invoice_id: input.invoiceId,
      number: input.number,
      amount: input.amount,
      currency: input.currency,
    },
  };
}

export function invoicePaidEvent(
  id: string,
  input: { invoiceId: string; number: string; amount: number; currency: string },
): WebhookEvent {
  return {
    id,
    type: 'invoice.payment.paid',
    createdAt: new Date().toISOString(),
    data: {
      invoice_id: input.invoiceId,
      number: input.number,
      amount: input.amount,
      currency: input.currency,
    },
  };
}

export function strField(event: WebhookEvent, key: string): string {
  const value = event.data[key];
  return typeof value === 'string' ? value : '';
}

export function numField(event: WebhookEvent, key: string): number {
  const value = event.data[key];
  return typeof value === 'number' ? value : 0;
}
