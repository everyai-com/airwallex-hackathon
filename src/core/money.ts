/** Amounts from the API are major units: 100 means one hundred dollars. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Round to an arbitrary precision (rates need more than 2 decimals). */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function formatAmount(value: number, currency: string): string {
  const symbol: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    AUD: 'A$',
    SGD: 'S$',
    HKD: 'HK$',
  };
  const prefix = symbol[currency] ?? `${currency} `;
  return `${prefix}${round2(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Flat EUR fee Airwallex charges per SWIFT payout. LOCAL payouts are free. */
export const SWIFT_FEE_EUR = 12.85;
