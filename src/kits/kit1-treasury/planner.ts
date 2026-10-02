import { SWIFT_FEE_EUR, round2 } from '../../core/money.js';
import type {
  Obligation,
  PlanAction,
  PlannerInput,
  PlannerResult,
} from './types.js';

const CRITICALITY_RANK: Record<Obligation['criticality'], number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function usdValueOf(amount: number, currency: string, usdValue: Record<string, number>): number {
  return round2(amount * (usdValue[currency] ?? 1));
}

export function feeFor(obligation: Obligation): number {
  return obligation.transferMethod === 'SWIFT' && obligation.currency === 'EUR' ? SWIFT_FEE_EUR : 0;
}

export function amountWithFee(obligation: Obligation): number {
  return round2(obligation.amount + feeFor(obligation));
}

/**
 * Pure planning. No network calls, no prompts: given balances, obligations,
 * a forecast and policy thresholds, decide FUND / CONVERT_AND_FUND / DEFER /
 * ESCALATE / REQUIRE_APPROVAL.
 *
 * Budget model:
 *   settled budget   = wallet USD value - reserve floor
 *   forecast budget  = commitment limit derived from forecast confidence
 * Amounts funded beyond settled cash consume forecast budget; when the limit is
 * exhausted the action flips to REQUIRE_APPROVAL instead of silently overspending.
 */
export function planTreasury(input: PlannerInput): PlannerResult {
  const { balances, usdValue, obligations, forecast, policy } = input;
  const executed = new Set(input.executedObligationIds ?? []);
  const approved = new Set(input.approvedObligationIds ?? []);

  const reserveBeforeUsd = round2(
    Object.entries(balances).reduce(
      (total, [currency, amount]) => total + amount * (usdValue[currency] ?? 1),
      0,
    ),
  );
  const settledUsd = round2(Math.max(0, reserveBeforeUsd - policy.reserveFloorUsd));
  const commitmentLimitUsd = policy.commitmentLimitUsd(forecast.confidence);
  let budget = round2(settledUsd + commitmentLimitUsd);
  let projectedReserveUsd = reserveBeforeUsd;

  const ordered = [...obligations].sort((a, b) => {
    const rank = CRITICALITY_RANK[a.criticality] - CRITICALITY_RANK[b.criticality];
    if (rank !== 0) return rank;
    return a.dueInHours - b.dueInHours;
  });

  const actions: PlanAction[] = [];

  for (const obligation of ordered) {
    if (executed.has(obligation.id)) continue;

    const approvalPolicy = policy.requiresApproval(obligation);
    if (approvalPolicy.required) {
      actions.push({
        kind: 'ESCALATE',
        obligation,
        reason: approvalPolicy.reason ?? 'Policy exception requires a person',
      });
      continue;
    }

    if (obligation.dueInHours > policy.fundingWindowHours) {
      actions.push({
        kind: 'DEFER',
        obligation,
        reason: `Due in ${obligation.dueInHours}h — outside the ${policy.fundingWindowHours}h funding window, revisit later`,
      });
      continue;
    }

    const hold = balances[obligation.currency] ?? 0;
    const required = amountWithFee(obligation);
    const convertAmount = round2(Math.max(0, required - hold));
    // Budget and reserve are consumed by the full outflow; `newMoneyUsd` only
    // describes how much must be converted because the wallet is short.
    const outflowUsd = usdValueOf(required, obligation.currency, usdValue);
    const isApproved = approved.has(obligation.id);

    if (outflowUsd <= budget || isApproved) {
      budget = round2(Math.max(0, budget - outflowUsd));
      projectedReserveUsd = round2(projectedReserveUsd - outflowUsd);
      if (convertAmount <= 0) {
        actions.push({
          kind: 'FUND',
          obligation,
          reason: `${obligation.currency} balance covers ${required} ${obligation.currency}`,
          costUsd: outflowUsd,
          approved: isApproved,
        });
      } else {
        actions.push({
          kind: 'CONVERT_AND_FUND',
          obligation,
          reason: isApproved
            ? `Human approved ${convertAmount} ${obligation.currency} conversion beyond the autonomous limit`
            : `Convert the minimum ${convertAmount} ${obligation.currency} (incl. SWIFT fee)`,
          sellCurrency: 'USD',
          buyCurrency: obligation.currency,
          convertAmount,
          costUsd: outflowUsd,
          approved: isApproved,
        });
      }
    } else {
      actions.push({
        kind: 'REQUIRE_APPROVAL',
        obligation,
        reason: `Needs USD ${outflowUsd} but only USD ${budget} is inside policy at confidence ${forecast.confidence.toFixed(2)}`,
        costUsd: outflowUsd,
      });
    }
  }

  return {
    actions,
    budget: { settledUsd, commitmentLimitUsd, totalUsd: round2(settledUsd + commitmentLimitUsd) },
    reserveBeforeUsd,
    projectedReserveUsd,
  };
}
