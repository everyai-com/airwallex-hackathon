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
 * `usdValue` must give the USD value of one unit of each currency actually held;
 * an unknown currency makes the assessment refuse rather than guess at 1:1.
 */
export function assessPayroll(
  contractors: ContractorPayroll[],
  usdValue: Record<string, number>,
  employerBalance: Record<string, number>,
  policy = PAYROLL_POLICY,
): PayrollAssessment {
  const totalPayroll = round2(contractors.reduce((total, item) => total + item.amount, 0));
  const swiftFees = round2(
    contractors.filter((item) => item.currency === 'EUR').length * policy.swiftFeeEur,
  );
  const totalRequired = round2(totalPayroll + swiftFees);
  const payrollCurrency = contractors[0]?.currency ?? 'EUR';
  const payrollRate = usdValue[payrollCurrency];
  if (payrollRate === undefined) {
    throw new Error(`No USD rate supplied for payroll currency ${payrollCurrency}; refusing to assess affordability.`);
  }
  const requiredUsd = round2(totalRequired * payrollRate);

  const availableUsd = round2(
    Object.entries(employerBalance).reduce((total, [currency, amount]) => {
      if (amount === 0) return total;
      const rate = usdValue[currency];
      if (rate === undefined) {
        throw new Error(`No USD rate supplied for ${currency} in the employer wallet; refusing to assess affordability.`);
      }
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
