/**
 * Kit 17 policy — webhook reaction routing, pure and testable.
 *
 * The rules: every delivery id is handled exactly once (redeliveries are
 * acknowledged without action), paid events reconcile against API state
 * before the ledger moves, retryable failures get one replacement with a new
 * request id, and anything unknown or non-retryable escalates to a person.
 */

import { numField, strField, type WebhookEvent } from './events.js';

export const WEBHOOK_POLICY = {
  /** Retryable bank failures get this many replacements before escalation. */
  maxReplacements: 1,
  retryableFailureTypes: ['BENEFICIARY_BANK_RETURNED', 'BENEFICIARY_BANK_TIMEOUT'],
};

export type ReactionKind =
  | 'RECONCILE'
  | 'RETRY'
  | 'ESCALATE'
  | 'ACK'
  | 'DEDUPED';

export interface Reaction {
  eventId: string;
  type: string;
  kind: ReactionKind;
  requiresApproval: boolean;
  reason: string;
}

export interface ReactionContext {
  /** Delivery ids already handled this run — the at-least-once guard. */
  seenEventIds: Set<string>;
  /** Replacements already issued per failed transfer id. */
  replacementsUsed: Map<string, number>;
}

/** A delivery id the platform already sent is acknowledged, never re-applied. */
export function decideWebhookReaction(
  event: WebhookEvent,
  context: ReactionContext,
): Reaction {
  if (!event.id || !event.type) {
    return {
      eventId: event.id ?? '',
      type: event.type ?? '',
      kind: 'ESCALATE',
      requiresApproval: true,
      reason: 'Malformed delivery: missing id or type — a person inspects it.',
    };
  }
  if (context.seenEventIds.has(event.id)) {
    return {
      eventId: event.id,
      type: event.type,
      kind: 'DEDUPED',
      requiresApproval: false,
      reason: `Redelivery of ${event.id} — acknowledged without action.`,
    };
  }

  switch (event.type) {
    case 'transfer.paid': {
      const reference = strField(event, 'transfer_id') || strField(event, 'request_id');
      return {
        eventId: event.id,
        type: event.type,
        kind: 'RECONCILE',
        requiresApproval: false,
        reason: `Verify ${reference} reads PAID from the API, then close it in the ledger.`,
      };
    }
    case 'invoice.payment.paid':
    case 'invoice.finalized': {
      const reference = strField(event, 'number') || strField(event, 'invoice_id');
      return {
        eventId: event.id,
        type: event.type,
        kind: 'RECONCILE',
        requiresApproval: false,
        reason: `Verify invoice ${reference} from the API, then record its state.`,
      };
    }
    case 'invoice.payment.failed': {
      return {
        eventId: event.id,
        type: event.type,
        kind: 'ESCALATE',
        requiresApproval: true,
        reason: `Collection on ${strField(event, 'number')} failed for ${numField(event, 'amount')} ${strField(event, 'currency')} — a person decides retry or dunning.`,
      };
    }
    case 'transfer.failed': {
      const failureType = strField(event, 'failure_type');
      const transferId = strField(event, 'transfer_id');
      const used = context.replacementsUsed.get(transferId) ?? 0;
      if (
        WEBHOOK_POLICY.retryableFailureTypes.includes(failureType) &&
        used < WEBHOOK_POLICY.maxReplacements
      ) {
        return {
          eventId: event.id,
          type: event.type,
          kind: 'RETRY',
          requiresApproval: false,
          reason: `${failureType} is retryable and no replacement exists yet — issue one with a new request id.`,
        };
      }
      return {
        eventId: event.id,
        type: event.type,
        kind: 'ESCALATE',
        requiresApproval: true,
        reason:
          used >= WEBHOOK_POLICY.maxReplacements
            ? `Replacement already issued for ${transferId} — a person decides the next move.`
            : `${failureType || 'unknown failure'} is not retryable — a person takes it from here.`,
      };
    }
    default:
      return {
        eventId: event.id,
        type: event.type,
        kind: 'ESCALATE',
        requiresApproval: true,
        reason: `Unknown event type ${event.type} — a person classifies it before anything acts.`,
      };
  }
}
