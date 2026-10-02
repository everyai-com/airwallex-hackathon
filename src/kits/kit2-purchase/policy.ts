import type { ParsedOption } from './terms.js';

export interface PurchasePolicy {
  startingCashUsd: number;
  weeklyOperatingCostUsd: number;
  reserveFloorUsd: number;
  horizonWeeks: number;
  monthlyBillingEveryWeeks: number;
  cardLimits: {
    perTransactionUsd: number;
    monthlyUsd: number;
    allTimeUsd: number;
    allowedCurrencies: string[];
    allowedMerchantCategories: string[];
  };
}

export const PURCHASE_POLICY: PurchasePolicy = {
  startingCashUsd: 42_000,
  weeklyOperatingCostUsd: 750,
  reserveFloorUsd: 25_000,
  horizonWeeks: 12,
  monthlyBillingEveryWeeks: 4,
  cardLimits: {
    perTransactionUsd: 1_200,
    monthlyUsd: 1_200,
    allTimeUsd: 14_400,
    allowedCurrencies: ['USD'],
    // 5734 computer software stores, 7372 computer programming & data processing.
    allowedMerchantCategories: ['5734', '7372'],
  },
};

export interface PurchaseDecision {
  chosen: ParsedOption;
  reason: string;
  annualBreachWeek?: number;
  monthlyBreachWeek?: number;
  reconsiderAfterWeeks: number;
}

/**
 * Choose the option that keeps cash above the reserve floor across the horizon.
 * Annual saves money, but a floor breach forfeits the decision.
 */
export function chooseOption(
  annual: ParsedOption,
  monthly: ParsedOption,
  annualBreachWeek: number | undefined,
  monthlyBreachWeek: number | undefined,
): PurchaseDecision {
  if (annualBreachWeek !== undefined) {
    return {
      chosen: monthly,
      reason: `Annual pricing pushes cash below the USD ${PURCHASE_POLICY.reserveFloorUsd} reserve floor in week ${annualBreachWeek}; monthly keeps the floor and the option to cancel.`,
      annualBreachWeek,
      ...(monthlyBreachWeek !== undefined ? { monthlyBreachWeek } : {}),
      reconsiderAfterWeeks: 36,
    };
  }
  return {
    chosen: annual,
    reason: `Annual pricing stays above the reserve floor and saves ${annual.discountVsMonthlyPercent ?? 18}% versus monthly.`,
    ...(monthlyBreachWeek !== undefined ? { monthlyBreachWeek } : {}),
    reconsiderAfterWeeks: 48,
  };
}
