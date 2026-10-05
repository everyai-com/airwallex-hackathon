import type { AirwallexClient } from '../core/client.js';
import { isAirwallexError } from '../core/errors.js';
import { asRecord, num, str } from '../core/parse.js';

export interface BillingCustomer {
  id: string;
  email?: string;
  name?: string;
}

export interface BillingInvoice {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  totalAmount: number;
  amountDue: number;
  currency: string;
  billingCustomerId: string;
  hostedUrl?: string;
  pdfUrl?: string;
}

export interface BillingLine {
  description: string;
  quantity: number;
  unitAmount: number;
  productName: string;
}

function toCustomer(item: unknown): BillingCustomer {
  const record = asRecord(item);
  return {
    id: String(record.id ?? ''),
    ...(str(record.email) ? { email: str(record.email) } : {}),
    ...(str(record.name) ? { name: str(record.name) } : {}),
  };
}

function toInvoice(item: unknown): BillingInvoice {
  const record = asRecord(item);
  return {
    id: String(record.id ?? ''),
    number: String(record.number ?? ''),
    status: String(record.status ?? ''),
    paymentStatus: String(record.payment_status ?? ''),
    totalAmount: num(record.total_amount) ?? 0,
    amountDue: num(record.amount_due) ?? 0,
    currency: String(record.currency ?? ''),
    billingCustomerId: String(record.billing_customer_id ?? ''),
    ...(str(record.hosted_url) ? { hostedUrl: str(record.hosted_url) } : {}),
    ...(str(record.pdf_url) ? { pdfUrl: str(record.pdf_url) } : {}),
  };
}

export async function listBillingCustomers(client: AirwallexClient): Promise<BillingCustomer[]> {
  const response = await client.request<{ items: unknown[] }>('/api/v1/billing/billing_customers', {
    method: 'GET',
  });
  return (response.items ?? []).map(toCustomer);
}

export async function findBillingCustomerByEmail(
  client: AirwallexClient,
  email: string,
): Promise<BillingCustomer | undefined> {
  const customers = await listBillingCustomers(client);
  return customers.find((entry) => entry.email?.toLowerCase() === email.toLowerCase());
}

export async function createBillingCustomer(
  client: AirwallexClient,
  input: { requestId: string; name: string; email: string; currency?: string },
): Promise<BillingCustomer> {
  try {
    const response = await client.request<unknown>('/api/v1/billing/billing_customers/create', {
      body: {
        request_id: input.requestId,
        name: input.name,
        email: input.email,
        type: 'BUSINESS',
        ...(input.currency ? { default_billing_currency: input.currency } : {}),
      },
    });
    return toCustomer(response);
  } catch (error) {
    if (isAirwallexError(error) && error.isDuplicateRequestId) {
      const existing = await findBillingCustomerByEmail(client, input.email);
      if (existing) return existing;
    }
    throw error;
  }
}

/** Find-or-create by email so live re-runs reuse the customer instead of piling up. */
export async function ensureBillingCustomer(
  client: AirwallexClient,
  input: { requestId: string; name: string; email: string; currency?: string },
): Promise<BillingCustomer> {
  const existing = await findBillingCustomerByEmail(client, input.email);
  if (existing) return existing;
  return createBillingCustomer(client, input);
}

export async function listInvoices(client: AirwallexClient): Promise<BillingInvoice[]> {
  const response = await client.request<{ items: unknown[] }>('/api/v1/billing/invoices', {
    method: 'GET',
  });
  return (response.items ?? []).map(toInvoice);
}

export async function findInvoiceByNumber(
  client: AirwallexClient,
  number: string,
): Promise<BillingInvoice | undefined> {
  const invoices = await listInvoices(client);
  return invoices.find((entry) => entry.number === number);
}

export async function getInvoice(client: AirwallexClient, invoiceId: string): Promise<BillingInvoice> {
  const response = await client.request<unknown>(`/api/v1/billing/invoices/${invoiceId}`, {
    method: 'GET',
  });
  return toInvoice(response);
}

export async function listInvoiceLineItems(
  client: AirwallexClient,
  invoiceId: string,
): Promise<Record<string, unknown>[]> {
  const response = await client.request<{ items: Record<string, unknown>[] }>(
    `/api/v1/billing/invoices/${invoiceId}/line_items`,
    { method: 'GET' },
  );
  return response.items ?? [];
}

/**
 * Create a DRAFT one-off invoice collected OUT_OF_BAND: the customer pays by
 * bank transfer and the kit marks it paid when the deposit lands, so no
 * payment account or payment source is needed. On a duplicate request_id the
 * merchant number (deterministic per operation) recovers the original.
 */
export async function createInvoice(
  client: AirwallexClient,
  input: {
    requestId: string;
    number: string;
    billingCustomerId: string;
    currency: string;
    daysUntilDue: number;
    memo?: string;
  },
): Promise<BillingInvoice> {
  try {
    const response = await client.request<unknown>('/api/v1/billing/invoices/create', {
      body: {
        request_id: input.requestId,
        number: input.number,
        billing_customer_id: input.billingCustomerId,
        currency: input.currency,
        collection_method: 'OUT_OF_BAND',
        days_until_due: input.daysUntilDue,
        ...(input.memo ? { memo: input.memo } : {}),
      },
    });
    return toInvoice(response);
  } catch (error) {
    // duplicate_request_id (same request retried) or a duplicated merchant
    // number (fresh request ids after --fresh): either way the number recovers it.
    if (
      isAirwallexError(error) &&
      (error.isDuplicateRequestId ||
        (error.code === 'validation_error' && /duplicat/i.test(error.message)))
    ) {
      const existing = await findInvoiceByNumber(client, input.number);
      if (existing) return existing;
    }
    throw error;
  }
}

/** Ad-hoc PER_UNIT prices with inline products: no product/price setup needed. */
export async function addInvoiceLineItems(
  client: AirwallexClient,
  input: { invoiceId: string; requestId: string; lines: BillingLine[] },
): Promise<BillingInvoice> {
  try {
    await client.request<unknown>(`/api/v1/billing/invoices/${input.invoiceId}/add_line_items`, {
      body: {
        request_id: input.requestId,
        line_items: input.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          price: {
            pricing_model: 'PER_UNIT',
            unit_amount: line.unitAmount,
            product: { name: line.productName },
          },
        })),
      },
    });
    return getInvoice(client, input.invoiceId);
  } catch (error) {
    // The add is atomic, so any failure with lines already present means an
    // earlier attempt succeeded — a retry, a resumed run, or fresh request ids
    // against a finalized invoice. With no lines present the error is genuine.
    if (isAirwallexError(error)) {
      const lines = await listInvoiceLineItems(client, input.invoiceId);
      if (lines.length > 0) return getInvoice(client, input.invoiceId);
    }
    throw error;
  }
}

/** DRAFT -> FINALIZED. Re-finalizing is reconciled by reading the invoice state. */
export async function finalizeInvoice(
  client: AirwallexClient,
  invoiceId: string,
): Promise<BillingInvoice> {
  try {
    const response = await client.request<unknown>(
      `/api/v1/billing/invoices/${invoiceId}/finalize`,
      { body: {} },
    );
    return toInvoice(response);
  } catch (error) {
    if (isAirwallexError(error)) {
      const current = await getInvoice(client, invoiceId);
      if (current.status === 'FINALIZED') return current;
    }
    throw error;
  }
}

/** Mark paid once the bank transfer lands. Re-marking is reconciled the same way. */
export async function markInvoicePaid(client: AirwallexClient, invoiceId: string): Promise<BillingInvoice> {
  try {
    const response = await client.request<unknown>(
      `/api/v1/billing/invoices/${invoiceId}/mark_as_paid`,
      { body: {} },
    );
    return toInvoice(response);
  } catch (error) {
    if (isAirwallexError(error)) {
      const current = await getInvoice(client, invoiceId);
      if (current.paymentStatus === 'PAID') return current;
    }
    throw error;
  }
}
