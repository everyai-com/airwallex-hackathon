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

export function toTransfer(item: unknown): TransferRecord {
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
 * reporting failure we look the transfer up by request_id, so a retry — even
 * from a previous process with a persisted request id — can never create a
 * second payment.
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drive a transfer to PAID through the sandbox simulator. Resumable: a transfer
 * that is already PAID (for example from an earlier run with a persisted
 * request id) is returned untouched instead of being simulated again.
 */
export async function advanceTransferToPaid(
  client: AirwallexClient,
  transfer: TransferRecord,
  options: { onBehalfOf?: string } = {},
): Promise<TransferRecord> {
  let current = transfer;
  if (current.status === 'PAID') return current;
  if (current.status === 'CANCELLED' || current.status === 'FAILED') {
    throw new Error(
      `Transfer ${current.id} is ${current.status} (${current.failureType ?? 'no failure_type'}); it cannot be advanced to PAID.`,
    );
  }

  if (current.status === 'PROCESSING') {
    current = await simulateTransferTransition(client, current.id, {
      nextStatus: 'SENT',
      ...(options.onBehalfOf ? { onBehalfOf: options.onBehalfOf } : {}),
    });
  }
  if (current.status === 'SENT' || current.status === 'FAILED') {
    current = await simulateTransferTransition(client, current.id, {
      nextStatus: 'PAID',
      ...(options.onBehalfOf ? { onBehalfOf: options.onBehalfOf } : {}),
    });
  }
  return current;
}

/**
 * Poll until the transfer reaches a terminal status. SENT is never final, and
 * a failed transfer can appear as FAILED before it settles as CANCELLED — both
 * are terminal for decision purposes.
 */
export async function waitForTerminalTransfer(
  client: AirwallexClient,
  transferId: string,
  options: { onBehalfOf?: string; attempts?: number } = {},
): Promise<TransferRecord> {
  const attempts = options.attempts ?? 6;
  let current = await getTransfer(client, transferId, options);
  for (let attempt = 0; attempt < attempts && !isTerminalTransferStatus(current.status); attempt += 1) {
    await sleep(500);
    current = await getTransfer(client, transferId, options);
  }
  return current;
}

export function isTerminalTransferStatus(status: string): boolean {
  return ['PAID', 'CANCELLED', 'FAILED'].includes(status);
}

export type TransferNextStatus = 'PROCESSING' | 'SENT' | 'PAID' | 'FAILED' | 'CANCELLED' | 'OVERDUE';

/**
 * Sandbox only. A FAILED transition carries the chosen failure_type; the live
 * lifecycle may report FAILED transiently and then settle as CANCELLED, so
 * always branch on both statuses and read failure_type.
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
