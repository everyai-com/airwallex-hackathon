import type { AirwallexClient } from '../core/client.js';
import { isAirwallexError, TransportError } from '../core/errors.js';
import { asRecord, str } from '../core/parse.js';

/** reason is a closed enum: no `platform_fee`; use professional_business_services for fees. */
export const PLATFORM_REASONS = {
  fee: 'professional_business_services',
  payrollTopUp: 'wages_salary',
} as const;

export interface MoneyMove {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

function toMoneyMove(item: unknown): MoneyMove {
  const record = asRecord(item);
  return {
    id: String(record.id ?? ''),
    status: String(record.status ?? ''),
    amount: Number(record.amount ?? 0),
    currency: String(record.currency ?? ''),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isAmbiguous(error: unknown): boolean {
  return (
    error instanceof TransportError ||
    (isAirwallexError(error) &&
      (error.isDuplicateRequestId || error.code === 'request_pending' || error.status >= 500))
  );
}

/**
 * There is no documented lookup-by-request_id for platform money movement, so an
 * ambiguous response must stop the caller instead of letting it retry with a
 * fresh id and create a second move.
 */
function ambiguousOutcome(resource: string, requestId: string, error: unknown): never {
  throw new Error(
    `Outcome unknown for ${resource} (request_id ${requestId}): ${(error as Error).message}. Reconcile with the sandbox before creating another move; do not retry with a new request_id.`,
  );
}

async function pollUntilSettled(
  client: AirwallexClient,
  path: string,
  id: string,
  attempts = 5,
): Promise<MoneyMove> {
  let move = toMoneyMove({ id });
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await client.request<unknown>(`${path}/${id}`, { method: 'GET' });
    move = toMoneyMove(response);
    if (move.status === 'SETTLED') return move;
    await sleep(500);
  }
  return move;
}

/**
 * Platform -> customer. destination is a plain acct_ id string, not an object.
 * The create response is status NEW; retrieve until it becomes SETTLED.
 */
export async function connectedAccountTransfer(
  client: AirwallexClient,
  input: {
    requestId: string;
    amount: number;
    currency: string;
    destination: string;
    reason: string;
    reference: string;
  },
): Promise<MoneyMove> {
  let response: unknown;
  try {
    response = await client.request<unknown>('/api/v1/connected_account_transfers/create', {
      body: {
        request_id: input.requestId,
        amount: String(input.amount),
        currency: input.currency,
        destination: input.destination,
        reason: input.reason,
        reference: input.reference,
      },
    });
  } catch (error) {
    if (isAmbiguous(error)) ambiguousOutcome('connected_account_transfer', input.requestId, error);
    throw error;
  }
  const created = toMoneyMove(response);
  return created.status === 'SETTLED'
    ? created
    : pollUntilSettled(client, '/api/v1/connected_account_transfers', created.id);
}

/**
 * Customer -> platform. source is a plain acct_ id string. Returns status NEW;
 * retrieve until SETTLED. If the customer wallet is short the call fails with
 * `insufficient_fund` — check the balance and record a receivable instead.
 */
export async function collectCharge(
  client: AirwallexClient,
  input: {
    requestId: string;
    amount: number;
    currency: string;
    source: string;
    reason: string;
    reference: string;
  },
): Promise<MoneyMove> {
  let response: unknown;
  try {
    response = await client.request<unknown>('/api/v1/charges/create', {
      body: {
        request_id: input.requestId,
        amount: String(input.amount),
        currency: input.currency,
        source: input.source,
        reason: input.reason,
        reference: input.reference,
      },
    });
  } catch (error) {
    if (isAmbiguous(error)) ambiguousOutcome('charge', input.requestId, error);
    throw error;
  }
  const created = toMoneyMove(response);
  return created.status === 'SETTLED' ? created : pollUntilSettled(client, '/api/v1/charges', created.id);
}

export interface PlatformReport {
  id: string;
  type: string;
  fileFormat: string;
  status: string;
  url?: string;
}

/**
 * Platform reports: type is validated before file_format, so always send both.
 * BALANCE_REPORT takes no date filters. Download within 60 seconds of the link
 * appearing.
 */
export async function createPlatformReport(
  client: AirwallexClient,
  input: { type: 'BALANCE_REPORT' | 'SETTLEMENT_REPORT' | 'PAYOUT_REPORT'; fileFormat: 'CSV' | 'XLSX' | 'PDF' },
): Promise<PlatformReport> {
  const response = await client.request<Record<string, unknown>>('/api/v1/platform_reports/create', {
    body: { type: input.type, file_format: input.fileFormat },
  });
  return {
    id: String(response.id ?? ''),
    type: String(response.type ?? input.type),
    fileFormat: String(response.file_format ?? input.fileFormat),
    status: String(response.status ?? ''),
    ...(str(response.url) ? { url: str(response.url) } : {}),
  };
}
