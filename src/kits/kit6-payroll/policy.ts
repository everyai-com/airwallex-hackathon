export interface ContractorPayroll {
  name: string;
  amount: number;
  currency: string;
}

export interface PayrollAssessment {
  totalPayroll: number;
  swiftFees: number;
  totalRequired: number;
  availableUsd: number;
  requiredUsd: number;
  canRun: boolean;
  shortfallUsd: number;
}

export const PAYROLL_POLICY = {
  swiftFeeEur: 12.85,
  platformFeePerRunUsd: 149,
  reserveFloorUsd: 1_000,
};

/**
 * Price payroll including one SWIFT fee per EUR payout before converting.
 * Converting only the payroll total makes the last contractor's payout fail.
 */
export function assessPayroll(
  contractors: ContractorPayroll[],
  usdPerEur: number,
  employerBalance: Record<string, number>,
  policy = PAYROLL_POLICY,
): PayrollAssessment {
  const totalPayroll = round2(contractors.reduce((total, item) => total + item.amount, 0));
  const swiftFees = round2(
    contractors.filter((item) => item.currency === 'EUR').length * policy.swiftFeeEur,
  );
  const totalRequired = round2(totalPayroll + swiftFees);
  const requiredUsd = round2(totalRequired * usdPerEur);

  const availableUsd = round2(
    Object.entries(employerBalance).reduce((total, [currency, amount]) => {
      const rate = currency === 'USD' ? 1 : currency === 'EUR' ? usdPerEur : 1;
      return total + amount * rate;
    }, 0),
  );

  const shortfallUsd = round2(Math.max(0, requiredUsd - availableUsd));
  return {
    totalPayroll,
    swiftFees,
    totalRequired,
    availableUsd,
    requiredUsd,
    canRun: shortfallUsd === 0,
    shortfallUsd,
  };
}

/**
 * Tenant isolation: another employer's deposit, even one that arrives mid-run,
 * must never fund this employer's payroll. The assessment above already uses
 * only the employer's own wallet; this guard records why a short employer is
 * escalated instead of raided.
 */
export function crossTenantGuard(shortEmployer: string, otherEmployer: string): string {
  return `Refusing to draw on ${otherEmployer}'s wallet for ${shortEmployer}: funds are tenant-scoped and the platform only executes with the source account's authorization.`;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
