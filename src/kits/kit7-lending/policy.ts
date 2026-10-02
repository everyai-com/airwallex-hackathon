export const LENDING_POLICY = {
  reserveFloorUsd: 20_000,
  repaymentShare: 0.08,
  minimumTrancheRatio: 0.4,
};

export interface DisbursementPlan {
  action: 'FULL' | 'PARTIAL' | 'DELAY';
  amountUsd: number;
  capacityUsd: number;
  reason: string;
}

/**
 * Size an advance against the portfolio reserve floor. Full funding is best,
 * a partial first tranche is acceptable above the minimum ratio, otherwise the
 * disbursement waits for cash.
 */
export function planDisbursement(input: {
  platformBalanceUsd: number;
  requestedUsd: number;
  reserveFloorUsd?: number;
  minimumTrancheRatio?: number;
}): DisbursementPlan {
  const reserveFloorUsd = input.reserveFloorUsd ?? LENDING_POLICY.reserveFloorUsd;
  const minimumTrancheRatio = input.minimumTrancheRatio ?? LENDING_POLICY.minimumTrancheRatio;
  const capacityUsd = round2(Math.max(0, input.platformBalanceUsd - reserveFloorUsd));

  if (capacityUsd >= input.requestedUsd) {
    return {
      action: 'FULL',
      amountUsd: input.requestedUsd,
      capacityUsd,
      reason: `Capacity ${capacityUsd} covers the full USD ${input.requestedUsd} advance without breaching the floor.`,
    };
  }

  const ratio = capacityUsd / input.requestedUsd;
  if (ratio >= minimumTrancheRatio) {
    return {
      action: 'PARTIAL',
      amountUsd: capacityUsd,
      capacityUsd,
      reason: `Disburse a first tranche of USD ${capacityUsd} (${(ratio * 100).toFixed(1)}% of the request) and fund the remainder as repayments land.`,
    };
  }

  return {
    action: 'DELAY',
    amountUsd: 0,
    capacityUsd,
    reason: `Only USD ${capacityUsd} is available (${(ratio * 100).toFixed(1)}% of the request) — below the ${(minimumTrancheRatio * 100).toFixed(0)}% minimum tranche. Delay and reallocate.`,
  };
}

/** Repayment due for the week: a share of the revenue that actually landed. */
export function repaymentDue(revenueUsd: number, share = LENDING_POLICY.repaymentShare): number {
  return round2(revenueUsd * share);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
