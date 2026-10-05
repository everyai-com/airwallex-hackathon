/**
 * Kit 16 policy — FX exposure hedging, pure and testable.
 *
 * The rule: the analyst may read a market note into a direction and a
 * confidence, but the hedge ratio, the surplus math and the rebalance band are
 * code. Obligations always dominate the view — a shortfall is bought whatever
 * the market says.
 */

import { round2 } from '../../core/money.js';
import type { ForecastAssessment } from '../../core/analyst.js';
import type { HedgeObligation } from './scenario.js';

export const HEDGE_POLICY = {
  /** Surpluses below this band are left alone — hedging dust wastes spread. */
  rebalanceBand: 500,
  /** Confidence at or below this on a contradicted view means a full hedge. */
  fullHedgeConfidence: 0.5,
};

export type HedgeSide = 'SELL_SURPLUS' | 'BUY_SHORTFALL' | 'HOLD';

export interface HedgeAction {
  currency: 'EUR' | 'GBP';
  side: HedgeSide;
  /** Foreign-currency amount to sell (surplus) or buy (shortfall). */
  amount: number;
  reason: string;
}

export function obligationsByCurrency(obligations: HedgeObligation[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const entry of obligations) {
    totals[entry.currency] = round2((totals[entry.currency] ?? 0) + entry.amount);
  }
  return totals;
}

/** Net exposure per currency: positive is surplus, negative is shortfall. */
export function netExposure(
  balances: Record<string, number>,
  obligations: HedgeObligation[],
): Record<string, number> {
  const owed = obligationsByCurrency(obligations);
  const exposure: Record<string, number> = {};
  for (const currency of new Set([...Object.keys(balances), ...Object.keys(owed)])) {
    exposure[currency] = round2((balances[currency] ?? 0) - (owed[currency] ?? 0));
  }
  return exposure;
}

/**
 * The view moves the ratio, never the amounts: a contradicted low-confidence
 * view hedges the whole surplus, a weakened view hedges half, a reaffirmed
 * view holds.
 */
export function hedgeRatio(assessment: ForecastAssessment): number {
  if (assessment.direction === 'contradicted' && assessment.confidence <= HEDGE_POLICY.fullHedgeConfidence) {
    return 1;
  }
  if (assessment.direction === 'weakened') return 0.5;
  if (assessment.direction === 'contradicted') return 0.75;
  return 0;
}

export function planHedges(
  balances: Record<string, number>,
  obligations: HedgeObligation[],
  views: Partial<Record<'EUR' | 'GBP', ForecastAssessment>>,
): HedgeAction[] {
  const exposure = netExposure(balances, obligations);
  const actions: HedgeAction[] = [];
  for (const currency of ['EUR', 'GBP'] as const) {
    const net = exposure[currency] ?? 0;
    if (net < -0.005) {
      actions.push({
        currency,
        side: 'BUY_SHORTFALL',
        amount: round2(-net),
        reason: `${currency} is short ${round2(-net)} against obligations — buy it whatever the market says.`,
      });
      continue;
    }
    const ratio = views[currency] ? hedgeRatio(views[currency]!) : 0;
    const hedgeable = round2(net * ratio);
    if (hedgeable >= HEDGE_POLICY.rebalanceBand) {
      actions.push({
        currency,
        side: 'SELL_SURPLUS',
        amount: hedgeable,
        reason: `${currency} surplus ${net} at hedge ratio ${ratio} — sell ${hedgeable} to USD.`,
      });
      continue;
    }
    actions.push({
      currency,
      side: 'HOLD',
      amount: 0,
      reason:
        ratio === 0
          ? `${currency} view is steady — hold the ${net} surplus.`
          : `${currency} hedgeable ${hedgeable} is inside the ${HEDGE_POLICY.rebalanceBand} band — hold.`,
    });
  }
  return actions;
}

/** USD available for hedge buys after the floor and USD obligations are covered. */
export function usdHeadroom(
  balances: Record<string, number>,
  obligations: HedgeObligation[],
  reserveFloorUsd: number,
): number {
  const owed = obligationsByCurrency(obligations);
  return round2((balances.USD ?? 0) - reserveFloorUsd - (owed.USD ?? 0));
}
