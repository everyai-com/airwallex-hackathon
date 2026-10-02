/**
 * Raw quote text a model would read, plus deterministic parsing and pure cash
 * math. The model reads prose; code owns every number.
 */

export const RAW_SAAS_QUOTE = `
Vendor: Lowly Software Inc. — Analytics Platform
Renewal window: 14 days. Current plan: Growth (annual contract).

Option A — Annual, billed upfront: USD 11,808 per year.
  (List price USD 1,200/month, 18% discount for annual prepayment.)

Option B — Monthly, billed monthly: USD 1,200 per month, cancel anytime
  with 30 days notice. No discount.

Both options include the same seats and SLA. Price locked for 12 months.
`;

export interface ParsedOption {
  id: 'annual' | 'monthly';
  label: string;
  upfrontUsd: number;
  monthlyUsd: number;
  discountVsMonthlyPercent?: number;
  cancelable: boolean;
}

export function parseSaaSQuote(text: string): ParsedOption[] {
  const annual = text.match(/USD\s*([\d,]+(?:\.\d+)?)\s*per year/i);
  const monthly = text.match(/USD\s*([\d,]+(?:\.\d+)?)\s*per month/i);
  const discount = text.match(/(\d+(?:\.\d+)?)%\s*discount/i);
  if (!annual || !monthly) throw new Error('Could not parse the SaaS quote.');
  return [
    {
      id: 'annual',
      label: 'Annual, billed upfront',
      upfrontUsd: toNumber(annual[1]!),
      monthlyUsd: 0,
      ...(discount ? { discountVsMonthlyPercent: Number(discount[1]) } : {}),
      cancelable: false,
    },
    {
      id: 'monthly',
      label: 'Monthly, cancel anytime',
      upfrontUsd: 0,
      monthlyUsd: toNumber(monthly[1]!),
      cancelable: true,
    },
  ];
}

function toNumber(value: string): number {
  return Number(value.replace(/,/g, ''));
}

export interface WeekPoint {
  week: number;
  cash: number;
  belowFloor: boolean;
}

export interface CashProjection {
  optionId: ParsedOption['id'];
  weeks: WeekPoint[];
  minCash: number;
  firstBreachWeek?: number;
  totalPaid: number;
}

export interface ProjectionInput {
  startingCashUsd: number;
  weeklyOperatingCostUsd: number;
  reserveFloorUsd: number;
  horizonWeeks: number;
  monthlyBillingEveryWeeks: number;
}

export function projectCash(option: ParsedOption, input: ProjectionInput): CashProjection {
  const weeks: WeekPoint[] = [];
  let cash = input.startingCashUsd;
  let totalPaid = 0;
  let firstBreachWeek: number | undefined;

  for (let week = 0; week <= input.horizonWeeks; week += 1) {
    if (week > 0) cash -= input.weeklyOperatingCostUsd;
    if (week === 0 && option.upfrontUsd > 0) {
      cash -= option.upfrontUsd;
      totalPaid += option.upfrontUsd;
    }
    if (
      option.monthlyUsd > 0 &&
      week % input.monthlyBillingEveryWeeks === 0 &&
      week < input.horizonWeeks
    ) {
      cash -= option.monthlyUsd;
      totalPaid += option.monthlyUsd;
    }
    const belowFloor = cash < input.reserveFloorUsd;
    if (belowFloor && firstBreachWeek === undefined) firstBreachWeek = week;
    weeks.push({ week, cash: round2(cash), belowFloor });
  }

  return {
    optionId: option.id,
    weeks,
    minCash: round2(Math.min(...weeks.map((point) => point.cash))),
    ...(firstBreachWeek !== undefined ? { firstBreachWeek } : {}),
    totalPaid: round2(totalPaid),
  };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
