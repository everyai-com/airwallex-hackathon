/**
 * Shared receivables book for the finance kits (11-13): deterministic invoices,
 * receipts, and aging helpers. Pure — the same book backs demos, kits and tests,
 * exactly like commerce-catalog.ts does for the shopping kits.
 */

import { round2 } from '../core/money.js';

export type InvoiceCurrency = 'USD' | 'EUR';
export type InvoiceStatus = 'OPEN' | 'PARTIALLY_PAID' | 'PAID';

export interface Invoice {
  id: string;
  customer: string;
  currency: InvoiceCurrency;
  total: number;
  paid: number;
  writtenOff: number;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
}

export interface Receipt {
  id: string;
  customer: string;
  amount: number;
  currency: InvoiceCurrency;
  reference?: string;
  receivedAt: string;
  channel: 'BANK_TRANSFER' | 'CARD' | 'WALLET';
}

export type AgingBucket = 'CURRENT' | '1-30' | '31-60' | '61+';

export function outstanding(invoice: Invoice): number {
  return round2(invoice.total - invoice.paid - invoice.writtenOff);
}

/** Open balance per currency across a book. */
export function openByCurrency(invoices: Invoice[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const entry of invoices) {
    const open = outstanding(entry);
    if (open > 0.005) totals[entry.currency] = round2((totals[entry.currency] ?? 0) + open);
  }
  return totals;
}

function statusFor(invoice: Omit<Invoice, 'status'>): InvoiceStatus {
  const open = round2(invoice.total - invoice.paid - invoice.writtenOff);
  if (open <= 0.005) return 'PAID';
  if (invoice.paid > 0 || invoice.writtenOff > 0) return 'PARTIALLY_PAID';
  return 'OPEN';
}

export function withPayment(invoice: Invoice, amount: number): Invoice {
  const next = { ...invoice, paid: round2(invoice.paid + amount) };
  return { ...next, status: statusFor(next) };
}

export function withWriteOff(invoice: Invoice, amount: number): Invoice {
  const next = { ...invoice, writtenOff: round2(invoice.writtenOff + amount) };
  return { ...next, status: statusFor(next) };
}

/** Days past due at `asOf` (ISO date or timestamp); negative means not yet due. */
export function agingDays(invoice: Invoice, asOf: string): number {
  const due = Date.parse(invoice.dueDate);
  const at = Date.parse(asOf);
  return Math.floor((at - due) / 86_400_000);
}

export function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'CURRENT';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  return '61+';
}

const invoice = (
  id: string,
  customer: string,
  currency: InvoiceCurrency,
  total: number,
  issueDate: string,
  dueDate: string,
  paid = 0,
  writtenOff = 0,
): Invoice => {
  const base = { id, customer, currency, total, paid, writtenOff, issueDate, dueDate };
  return { ...base, status: statusFor(base) };
};

/** The shared open book, as of the October close period. */
export function buildReceivables(): Invoice[] {
  return [
    invoice('INV-1041', 'Northwind Traders', 'USD', 8_400, '2026-08-29', '2026-09-28'),
    invoice('INV-1042', 'Northwind Traders', 'USD', 12_000, '2026-09-06', '2026-10-06'),
    invoice('INV-1043', 'Alpine GmbH', 'EUR', 18_600, '2026-09-02', '2026-10-02'),
    invoice('INV-1044', 'Datawise Inc', 'USD', 4_250, '2026-09-10', '2026-10-10'),
    invoice('INV-1045', 'Northwind Traders', 'USD', 6_800, '2026-09-15', '2026-10-15'),
    invoice('INV-1046', 'Bluepeak LLC', 'USD', 2_150, '2026-08-21', '2026-09-20'),
    invoice('INV-1047', 'Cascade Co', 'USD', 9_900, '2026-08-26', '2026-09-25'),
    invoice('INV-1048', 'Alpine GmbH', 'EUR', 7_400, '2026-09-20', '2026-10-20'),
  ];
}
