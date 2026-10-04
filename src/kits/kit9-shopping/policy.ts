/**
 * Kit 9 policy — pure decisions, no API calls.
 *
 * The core rule: an approval is bound to product + merchant + total +
 * fulfillment. If any one of them changes, the old approval does not cover the
 * new deal and a fresh approval is required. And no payment retry may happen
 * until the previous result has been reported to Airi.
 */

import { formatAmount } from '../../core/money.js';
import type { PurchaseOffer } from '../commerce-catalog.js';

export interface ShoppingMission {
  budgetUsd: number;
  deadlineDays: number;
  quantity: number;
}

export interface OfferConsideration {
  offer: PurchaseOffer;
  eligible: boolean;
  reason: string;
}

export interface OfferEvaluation {
  chosen?: PurchaseOffer;
  considered: OfferConsideration[];
}

/** Rank offers under the mission: highest rating inside budget and deadline. */
export function rankOffers(offers: PurchaseOffer[], mission: ShoppingMission): OfferEvaluation {
  const considered: OfferConsideration[] = offers.map((offer) => {
    if (offer.quantity !== mission.quantity) {
      return {
        offer,
        eligible: false,
        reason: `quantity ${offer.quantity} does not match the request (${mission.quantity})`,
      };
    }
    if (offer.totalUsd > mission.budgetUsd) {
      return {
        offer,
        eligible: false,
        reason: `delivered total ${formatAmount(offer.totalUsd, 'USD')} exceeds the ${formatAmount(mission.budgetUsd, 'USD')} budget`,
      };
    }
    if (offer.etaDays > mission.deadlineDays) {
      return {
        offer,
        eligible: false,
        reason: `${offer.shippingCode} arrives in ${offer.etaDays} days — after the ${mission.deadlineDays}-day deadline`,
      };
    }
    return { offer, eligible: true, reason: '' };
  });

  const eligible = considered
    .filter((entry) => entry.eligible)
    .map((entry) => entry.offer)
    .sort((a, b) => b.rating - a.rating || a.totalUsd - b.totalUsd);
  const chosen = eligible[0];

  if (chosen) {
    for (const entry of considered) {
      if (!entry.eligible) continue;
      if (entry.offer === chosen) {
        entry.reason = 'highest rating within budget and deadline';
        continue;
      }
      entry.reason =
        entry.offer.rating < chosen.rating
          ? `rated ${entry.offer.rating} vs ${chosen.rating} on the chosen offer`
          : `same rating but ${formatAmount(entry.offer.totalUsd - chosen.totalUsd, 'USD')} more expensive`;
    }
  }

  return { ...(chosen ? { chosen } : {}), considered };
}

export interface OfferFingerprint {
  product: string;
  merchant: string;
  totalUsd: string;
  fulfillment: string;
}

export function fingerprintFields(offer: PurchaseOffer): OfferFingerprint {
  return {
    product: offer.sku,
    merchant: offer.merchant,
    totalUsd: offer.totalUsd.toFixed(2),
    fulfillment: offer.shippingCode,
  };
}

/** The exact binding an approval covers. */
export function offerFingerprint(offer: PurchaseOffer): string {
  const fields = fingerprintFields(offer);
  return [fields.product, fields.merchant, fields.totalUsd, fields.fulfillment].join('|');
}

export function approvalCovers(fingerprint: string, offer: PurchaseOffer): boolean {
  return fingerprint === offerFingerprint(offer);
}

/** Human-readable list of the dimensions that changed since the approval. */
export function fingerprintChanges(previousFingerprint: string, next: PurchaseOffer): string[] {
  const [product, merchant, totalUsd, fulfillment] = previousFingerprint.split('|');
  const fields = fingerprintFields(next);
  const changes: string[] = [];
  if (product !== fields.product) changes.push(`product ${product ?? '?'} -> ${fields.product}`);
  if (merchant !== fields.merchant) changes.push(`merchant ${merchant ?? '?'} -> ${fields.merchant}`);
  if (totalUsd !== fields.totalUsd) {
    changes.push(`delivered total USD ${totalUsd ?? '?'} -> USD ${fields.totalUsd}`);
  }
  if (fulfillment !== fields.fulfillment) {
    changes.push(`fulfillment ${fulfillment ?? '?'} -> ${fields.fulfillment}`);
  }
  return changes;
}

export interface RecordedAttempt {
  id: string;
  requestId: string;
  status: 'DECLINED' | 'SUCCEEDED';
  failureReason?: string;
}

/**
 * The Airi CLI contract: every payment result is reported before any retry.
 * The guard refuses a retry while an attempt is unreported.
 */
export class AiriReportGuard {
  private attempts: RecordedAttempt[] = [];
  private readonly reported = new Set<string>();

  recordAttempt(attempt: RecordedAttempt): void {
    this.attempts.push(attempt);
  }

  report(attemptId: string): void {
    if (!this.attempts.some((attempt) => attempt.id === attemptId)) {
      throw new Error(`Cannot report unknown attempt ${attemptId}.`);
    }
    this.reported.add(attemptId);
  }

  unreported(): RecordedAttempt[] {
    return this.attempts.filter((attempt) => !this.reported.has(attempt.id));
  }

  canRetry(): { allowed: true } | { allowed: false; reason: string } {
    const open = this.unreported();
    if (open.length === 0) return { allowed: true };
    return {
      allowed: false,
      reason: `${open.length} payment result(s) not yet reported to Airi — report the result before any retry.`,
    };
  }

  history(): RecordedAttempt[] {
    return [...this.attempts];
  }
}
