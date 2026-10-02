import { round2, SWIFT_FEE_EUR } from '../../core/money.js';
import type { TransferRecord } from '../../api/transfers.js';

export type IncidentAction = 'WAIT' | 'REPLACE' | 'ESCALATE';

export interface IncidentDecision {
  action: IncidentAction;
  reason: string;
}

/**
 * Failure types that may be retried with a replacement payout. Compliance and
 * policy failures are not retryable — replacing them would just fail again.
 */
export const RETRYABLE_FAILURE_TYPES = new Set([
  'BENEFICIARY_BANK_RETURNED',
  'BENEFICIARY_REQUESTED',
  'RECALL_REQUESTED',
  'INVALID_BANK_INFORMATION',
  'ACCOUNT_INACTIVE_OR_DORMANT',
  'ACCOUNT_CLOSED',
  'CHANNEL_TIMEOUT',
  'SYSTEM_ERROR',
]);

export const NON_RETRYABLE_FAILURE_TYPES = new Set([
  'TM_SUSPENDED',
  'CHANNEL_POLICY',
  'INVALID_PAYMENT_PURPOSE',
  'BENEFICIARY_NAME_MISMATCH',
]);

export function isTerminal(status: string): boolean {
  // FAILED can appear transiently before the sandbox settles it as CANCELLED;
  // both are terminal for decision purposes, PAID is success.
  return ['PAID', 'CANCELLED', 'FAILED'].includes(status);
}

/** Cost of funding this payout from the wallet: principal plus any SWIFT fee. */
export function transferCost(transfer: TransferRecord): number {
  const fee =
    transfer.transferMethod === 'SWIFT' && transfer.transferCurrency === 'EUR' ? SWIFT_FEE_EUR : 0;
  return round2(transfer.transferAmount + fee);
}

export interface IncidentInput {
  transfer: TransferRecord;
  deadlineHoursRemaining: number;
  availableBalance: number;
  duplicatePaymentExists: boolean;
  replacementAlreadyAttempted?: boolean;
}

/**
 * Decide what happens to a delayed supplier transfer. A failed transfer is
 * final: the bank may have returned it (CANCELLED with failure_type) or it may
 * still read FAILED before settling, so read failure_type and never assume a
 * person cancelled it. SENT is never final.
 */
export function decideIncident(input: IncidentInput): IncidentDecision {
  const { transfer } = input;

  if (transfer.status === 'SENT') {
    return {
      action: 'WAIT',
      reason: 'Transfer is in flight: SENT is intermediate and not final, and the deadline has not passed.',
    };
  }

  if (transfer.status === 'PAID') {
    return { action: 'WAIT', reason: 'Transfer is already PAID; nothing to do.' };
  }

  if (transfer.status !== 'CANCELLED' && transfer.status !== 'FAILED') {
    return {
      action: 'WAIT',
      reason: `Status ${transfer.status} is still moving; poll until it reaches a terminal state.`,
    };
  }

  const failureType = transfer.failureType ?? '';
  if (NON_RETRYABLE_FAILURE_TYPES.has(failureType)) {
    return {
      action: 'ESCALATE',
      reason: `Failure ${failureType} is not retryable; a replacement would fail the same way. Route to payment ops.`,
    };
  }

  if (!RETRYABLE_FAILURE_TYPES.has(failureType)) {
    return {
      action: 'ESCALATE',
      reason: `Unrecognized failure_type ${failureType || '(none)'} — a person must review before more money moves.`,
    };
  }

  if (input.duplicatePaymentExists || input.replacementAlreadyAttempted) {
    return {
      action: 'ESCALATE',
      reason: 'A payment (or replacement) already exists for this incident; the duplicate lock forbids another.',
    };
  }

  if (input.deadlineHoursRemaining <= 0) {
    return {
      action: 'ESCALATE',
      reason: 'The supplier deadline has passed; replacing cannot help — escalate for recovery.',
    };
  }

  if (input.availableBalance < transferCost(transfer)) {
    return {
      action: 'ESCALATE',
      reason: `Insufficient balance (${input.availableBalance} < ${transferCost(transfer)} including fees) for a full replacement; do not part-pay.`,
    };
  }

  return {
    action: 'REPLACE',
    reason: `Failure ${failureType} is retryable, funds are available and the deadline is ${input.deadlineHoursRemaining}h away. Issue a replacement with a NEW request_id.`,
  };
}

export interface LockedPayment {
  transferId: string;
  requestId: string;
  amount: number;
  currency: string;
  status: 'PROCESSING' | 'SENT' | 'PAID' | 'CANCELLED';
  createdAt: string;
}

const LIVE_STATUSES: LockedPayment['status'][] = ['PROCESSING', 'SENT'];

/**
 * In-code duplicate lock driven by payment history for one incident key:
 * - never start a new payment while one is live or after one reached PAID
 * - allow exactly one replacement after a failed payment, then escalate
 * The lock is consulted before any create call, so retries and racing workers
 * cannot pay twice for the same incident.
 */
export class DuplicatePaymentGuard {
  private byIncident = new Map<string, LockedPayment[]>();

  record(incidentKey: string, payment: Omit<LockedPayment, 'createdAt'>): void {
    const history = this.byIncident.get(incidentKey) ?? [];
    this.byIncident.set(incidentKey, [
      ...history,
      { ...payment, createdAt: new Date().toISOString() },
    ]);
  }

  history(incidentKey: string): LockedPayment[] {
    return this.byIncident.get(incidentKey) ?? [];
  }

  updateStatus(incidentKey: string, transferId: string, status: LockedPayment['status']): void {
    const history = this.byIncident.get(incidentKey) ?? [];
    const payment = history.find((item) => item.transferId === transferId);
    if (payment) payment.status = status;
  }

  canCreatePayment(incidentKey: string): { allowed: boolean; reason: string } {
    const history = this.history(incidentKey);
    if (history.some((payment) => payment.status === 'PAID')) {
      return { allowed: false, reason: 'a payment for this incident already reached PAID' };
    }
    if (history.some((payment) => LIVE_STATUSES.includes(payment.status))) {
      return { allowed: false, reason: 'a payment for this incident is still in flight' };
    }
    const cancelled = history.filter((payment) => payment.status === 'CANCELLED').length;
    if (cancelled >= 1 && history.length >= 2) {
      return { allowed: false, reason: 'a replacement was already attempted for this incident' };
    }
    return { allowed: true, reason: 'no live or settled payment and no replacement attempted yet' };
  }

  totalPaid(incidentKey: string): number {
    return round2(
      this.history(incidentKey)
        .filter((payment) => payment.status === 'PAID')
        .reduce((total, payment) => total + payment.amount, 0),
    );
  }
}
