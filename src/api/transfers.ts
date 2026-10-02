import type { AirwallexClient } from '../core/client.js';
import { isAirwallexError, TransportError } from '../core/errors.js';
import { asRecord, num, str } from '../core/parse.js';
import type { BeneficiaryPayload } from './beneficiaries.js';

export interface TransferRecord {
  id: string;
  status: string;
  requestId: string;
  transferCurrency: string;
  transferAmount: number;
  transferMethod?: string;
  failureType?: string;
  failureReason?: string;
  feeAmount?: number;
}

function toTransfer(item: unknown): TransferRecord {
  const record = asRecord(item);
  return {
    id: String(record.id ?? ''),
    status: String(record.status ?? ''),
    requestId: String(record.request_id ?? ''),
    transferCurrency: String(record.transfer_currency ?? ''),
    transferAmount: num(record.transfer_amount) ?? 0,
    ...(str(record.transfer_method) ? { transferMethod: str(record.transfer_method) } : {}),
    ...(str(record.failure_type) ? { failureType: str(record.failure_type) } : {}),
    ...(str(record.failure_reason) ? { failureReason: str(record.failure_reason) } : {}),
    ...(num(record.fee_amount) !== undefined ? { feeAmount: num(record.fee_amount) } : {}),
  };
}

export interface CreateTransferInput {
  requestId: string;
  transferCurrency: string;
  transferAmount: number;
  transferMethod: 'LOCAL' | 'SWIFT';
  reason: string;
  reference: string;
  beneficiaryId?: string;
  beneficiary?: BeneficiaryPayload['beneficiary'];
  sourceCurrency?: string;
  onBehalfOf?: string;
}

function shouldLookUpOutcome(error: unknown): boolean {
  if (error instanceof TransportError) return true;
  if (isAirwallexError(error)) {
    return error.isDuplicateRequestId || error.status >= 500 || error.code === 'request_pending';
  }
  return false;
}

/**
 * Create a transfer. Any non-success response is treated as ambiguous: before
 * reporting failure we look the transfer up by request_id, so a retry can never
 * create a second payment.
 */
export async function createTransfer(
  client: AirwallexClient,
  input: CreateTransferInput,
): Promise<TransferRecord> {
  try {
    const response = await client.request<unknown>('/api/v1/transfers/create', {
      body: {
        request_id: input.requestId,
        transfer_currency: input.transferCurrency,
        transfer_amount: String(input.transferAmount),
        transfer_method: input.transferMethod,
        reason: input.reason,
        reference: input.reference,
        ...(input.beneficiaryId ? { beneficiary_id: input.beneficiaryId } : {}),
        ...(input.beneficiary ? { beneficiary: input.beneficiary } : {}),
        ...(input.sourceCurrency ? { source_currency: input.sourceCurrency } : {}),
      },
      ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}),
    });
    return toTransfer(response);
  } catch (error) {
    if (shouldLookUpOutcome(error)) {
      const existing = await findTransferByRequestId(client, input.requestId, input.onBehalfOf);
      if (existing) return existing;
    }
    throw error;
  }
}

export async function findTransferByRequestId(
  client: AirwallexClient,
  requestId: string,
  onBehalfOf?: string,
): Promise<TransferRecord | undefined> {
  const response = await client.request<{ items: unknown[] }>('/api/v1/transfers', {
    method: 'GET',
    query: { request_id: requestId },
    ...(onBehalfOf ? { onBehalfOf } : {}),
  });
  const first = (response.items ?? [])[0];
  return first ? toTransfer(first) : undefined;
}

export async function getTransfer(
  client: AirwallexClient,
  transferId: string,
  options: { onBehalfOf?: string } = {},
): Promise<TransferRecord> {
  const response = await client.request<unknown>(`/api/v1/transfers/${transferId}`, {
    method: 'GET',
    ...(options.onBehalfOf ? { onBehalfOf: options.onBehalfOf } : {}),
  });
  return toTransfer(response);
}

export type TransferNextStatus = 'PROCESSING' | 'SENT' | 'PAID' | 'FAILED' | 'CANCELLED' | 'OVERDUE';

/**
 * Sandbox only. A FAILED transition ends with status CANCELLED plus the chosen
 * failure_type; failure_type applies only after the transfer reaches SENT.
 * Transfers created on behalf of a connected account stay in PROCESSING until
 * you advance them here.
 */
export async function simulateTransferTransition(
  client: AirwallexClient,
  transferId: string,
  input: { nextStatus: TransferNextStatus; failureType?: string; onBehalfOf?: string },
): Promise<TransferRecord> {
  const response = await client.request<unknown>(
    `/api/v1/simulation/transfers/${transferId}/transition`,
    {
      body: {
        next_status: input.nextStatus,
        ...(input.failureType ? { failure_type: input.failureType } : {}),
      },
      ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}),
    },
  );
  return toTransfer(response);
}
