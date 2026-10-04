/**
 * Kit 12 policy — cutoff, revaluation and close-readiness decisions, pure and
 * testable. Nothing here talks to an API; the orchestrator posts what these
 * functions decide.
 */

import { round2 } from '../../core/money.js';

export const CLOSE_POLICY = {
  /** Wires received after this instant belong to the next period. */
  cutoffIso: '2026-10-31T17:00:00Z',
  /** Unapplied cash at or above this is parked with an owner, never recognized as revenue. */
  unappliedReviewThresholdUsd: 10_000,
  /** Write-offs at or below this post autonomously at close. */
  writeOffAutoLimitUsd: 500,
};

export interface PendingItem {
  id: string;
  description: string;
  amountUsd: number;
  receivedAt: string;
}

export interface CutoffDecision {
  itemId: string;
  inPeriod: boolean;
  reason: string;
}

export function decideCutoff(
  item: PendingItem,
  cutoffIso: string = CLOSE_POLICY.cutoffIso,
): CutoffDecision {
  const inPeriod = Date.parse(item.receivedAt) <= Date.parse(cutoffIso);
  return {
    itemId: item.id,
    inPeriod,
    reason: inPeriod
      ? `${item.description} hit the account at ${item.receivedAt}, at or before the ${cutoffIso} cutoff — book it to this period.`
      : `${item.description} hit the account at ${item.receivedAt}, after the ${cutoffIso} cutoff — defer it to the next period.`,
  };
}

export interface CloseAssessment {
  blockers: { id: string; reason: string }[];
  notes: { id: string; reason: string }[];
}

/** Whether a write-off posts autonomously at close. */
export function writeOffPosts(amountUsd: number): boolean {
  return amountUsd <= CLOSE_POLICY.writeOffAutoLimitUsd + 0.005;
}

/** What a person must sign before close, and what the close pack must disclose. */
export function assessClose(input: {
  writeOffUsd: number;
  unappliedUsd: number;
  fxLossUsd: number;
}): CloseAssessment {
  const blockers: { id: string; reason: string }[] = [];
  const notes: { id: string; reason: string }[] = [];

  if (input.writeOffUsd > 0 && !writeOffPosts(input.writeOffUsd)) {
    blockers.push({
      id: 'write-off',
      reason: `Write-off of USD ${input.writeOffUsd.toFixed(2)} exceeds the USD ${CLOSE_POLICY.writeOffAutoLimitUsd} autonomous limit — a person must sign before close.`,
    });
  } else if (input.writeOffUsd > 0) {
    notes.push({
      id: 'write-off',
      reason: `Write-off of USD ${input.writeOffUsd.toFixed(2)} is within the autonomous limit and posted.`,
    });
  }

  if (input.unappliedUsd >= CLOSE_POLICY.unappliedReviewThresholdUsd) {
    notes.push({
      id: 'unapplied-cash',
      reason: `USD ${input.unappliedUsd.toFixed(2)} of unapplied cash is parked as a liability with an owner for next period — it is not revenue.`,
    });
  }

  if (input.fxLossUsd > 0) {
    notes.push({
      id: 'fx-revaluation',
      reason: `EUR balances revalued from the book rate to the closing rate: USD ${input.fxLossUsd.toFixed(2)} presentation loss posted to the valuation reserve.`,
    });
  }

  return { blockers, notes };
}

export interface FxRevaluation {
  netPositionEur: number;
  bookValueUsd: number;
  closeValueUsd: number;
  /** Positive means a presentation loss at the closing rate. */
  lossUsd: number;
}

export function fxRevaluation(
  netPositionEur: number,
  bookRate: number,
  closeRate: number,
): FxRevaluation {
  const bookValueUsd = round2(netPositionEur * bookRate);
  const closeValueUsd = round2(netPositionEur * closeRate);
  return {
    netPositionEur,
    bookValueUsd,
    closeValueUsd,
    lossUsd: round2(bookValueUsd - closeValueUsd),
  };
}
