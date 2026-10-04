/** Kit 12 scenario: one month of activity, two near-cutoff wires, one close. */

import type { JournalLine } from './ledger.js';
import type { PendingItem } from './policy.js';

export const CLOSE_PERIOD = {
  label: 'October 2026 — zero-day close',
  asOf: '2026-10-31',
};

export const BOOK_EUR_RATE = 1.09;
export const CLOSING_EUR_RATE = 1.0869;

/** Opening balances, including the retained-earnings plug. */
export const OPENING_TRIAL_BALANCE: JournalLine[] = [
  { account: 'CASH_USD', debit: 22_000 },
  { account: 'CASH_EUR', debit: 10_900 }, // EUR 10,000 booked at 1.09
  { account: 'AR_USD', debit: 30_000 },
  { account: 'AR_EUR', debit: 13_080 }, // EUR 12,000 booked at 1.09
  { account: 'RETAINED_EARNINGS', credit: 75_980 },
];

export const PERIOD_REVENUE = { usd: 18_000, eur: 6_000 };
export const PERIOD_RECEIPTS = { usd: 18_000, eur: 6_000 };
export const UNAPPLIED_RECEIPT_USD = 2_400;
export const PREPAID_INSURANCE_USD = 1_200;
export const WRITE_OFF = { invoiceId: 'INV-1050', customer: 'Bluepeak LLC', amountUsd: 150 };
export const PAYROLL_ACCRUAL_USD = 3_600;

/** Net EUR monetary position at close: cash 16,000 + receivables 12,000. */
export const FX_POSITION_EUR = 28_000;

export const PENDING_ITEMS: PendingItem[] = [
  {
    id: 'wire-4471',
    description: 'Northwind Traders wire',
    amountUsd: 5_000,
    receivedAt: '2026-10-31T16:40:00Z',
  },
  {
    id: 'wire-4472',
    description: 'Cascade Co wire',
    amountUsd: 2_750,
    receivedAt: '2026-10-31T17:05:00Z',
  },
];

export const CLOSING_CASH = { USD: 41_200, EUR: 16_000 };
