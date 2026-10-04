/**
 * Kit 12 ledger — a minimal double-entry book, pure and testable.
 * Every entry must balance before it can be posted; the trial balance is the
 * close agent's proof that the books hold together.
 */

import { round2 } from '../../core/money.js';

export interface JournalLine {
  account: string;
  debit?: number;
  credit?: number;
}

export interface JournalEntry {
  date: string;
  memo: string;
  lines: JournalLine[];
}

export interface TrialBalanceRow {
  account: string;
  debit: number;
  credit: number;
  /** debit − credit; positive is a debit balance. */
  net: number;
  side: 'DEBIT' | 'CREDIT' | 'ZERO';
}

export function makeEntry(date: string, memo: string, lines: JournalLine[]): JournalEntry {
  const debit = round2(lines.reduce((sum, line) => sum + (line.debit ?? 0), 0));
  const credit = round2(lines.reduce((sum, line) => sum + (line.credit ?? 0), 0));
  if (Math.abs(debit - credit) > 0.005) {
    throw new Error(`Entry "${memo}" does not balance: debit ${debit} vs credit ${credit}.`);
  }
  return { date, memo, lines };
}

export function trialBalance(entries: JournalEntry[]): TrialBalanceRow[] {
  const accounts = new Map<string, { debit: number; credit: number }>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const current = accounts.get(line.account) ?? { debit: 0, credit: 0 };
      current.debit = round2(current.debit + (line.debit ?? 0));
      current.credit = round2(current.credit + (line.credit ?? 0));
      accounts.set(line.account, current);
    }
  }
  return [...accounts.entries()]
    .map(([account, totals]) => {
      const net = round2(totals.debit - totals.credit);
      return {
        account,
        debit: totals.debit,
        credit: totals.credit,
        net,
        side: net > 0.005 ? ('DEBIT' as const) : net < -0.005 ? ('CREDIT' as const) : ('ZERO' as const),
      };
    })
    .sort((a, b) => a.account.localeCompare(b.account));
}

export function isBalanced(entries: JournalEntry[]): boolean {
  const debit = round2(
    entries.reduce(
      (sum, entry) => sum + entry.lines.reduce((lineSum, line) => lineSum + (line.debit ?? 0), 0),
      0,
    ),
  );
  const credit = round2(
    entries.reduce(
      (sum, entry) => sum + entry.lines.reduce((lineSum, line) => lineSum + (line.credit ?? 0), 0),
      0,
    ),
  );
  return Math.abs(debit - credit) <= 0.005;
}

/** Net balance of one account (debit − credit). */
export function accountNet(entries: JournalEntry[], account: string): number {
  const row = trialBalance(entries).find((entry) => entry.account === account);
  return row?.net ?? 0;
}
