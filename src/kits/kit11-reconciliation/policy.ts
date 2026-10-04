/**
 * Kit 11 policy — receivables matching, pure and testable.
 *
 * The rule: the analyst may read a remittance advice, but the match, the
 * tolerance and the write-off limits are code. Duplicates are held, not
 * applied; deductions beyond tolerance need a person.
 */

import { formatAmount, round2 } from '../../core/money.js';
import { outstanding, withPayment, withWriteOff, type Invoice, type Receipt } from '../billing-shared.js';

export const RECONCILIATION_POLICY = {
  /** Deductions up to the greater of this floor or 2% of the invoice may be written off autonomously. */
  writeOffFloor: 25,
  writeOffPercent: 0.02,
  /** Unmatched cash at or above this amount must be cleared by a person. */
  unmatchedReviewThreshold: 1_000,
};

export type MatchKind =
  | 'EXACT'
  | 'DEDUCTION'
  | 'PARTIAL'
  | 'OVERPAYMENT'
  | 'UNREFERENCED'
  | 'DUPLICATE'
  | 'UNMATCHED';

export interface MatchAllocation {
  invoiceId: string;
  applied: number;
  writeOff: number;
}

export interface MatchDecision {
  receiptId: string;
  customer: string;
  kind: MatchKind;
  invoiceIds: string[];
  allocations: MatchAllocation[];
  appliedAmount: number;
  writeOffAmount: number;
  creditAmount: number;
  unappliedAmount: number;
  requiresApproval: boolean;
  reason: string;
}

export interface MatchContext {
  invoices: Invoice[];
  /** Receipts already processed this run, for exact-duplicate detection. */
  priorReceipts: Receipt[];
  /** Invoice references the analyst read from the remittance advice. */
  analystRefs?: string[];
  /** The advice claims a discount or credit against this payment. */
  claimsDeduction?: boolean;
}

const REF_PATTERN = /\b[A-Z]{2,4}-\d{3,}\b/gi;
const sameAmount = (a: number, b: number): boolean => Math.abs(a - b) <= 0.005;

export function extractRefs(reference: string | undefined, analystRefs: string[] | undefined): string[] {
  const found = new Set<string>();
  for (const text of [reference ?? '', ...(analystRefs ?? [])]) {
    for (const match of text.match(REF_PATTERN) ?? []) found.add(match.toUpperCase());
  }
  return [...found];
}

function unmatched(receipt: Receipt, reason: string): MatchDecision {
  return {
    receiptId: receipt.id,
    customer: receipt.customer,
    kind: 'UNMATCHED',
    invoiceIds: [],
    allocations: [],
    appliedAmount: 0,
    writeOffAmount: 0,
    creditAmount: 0,
    unappliedAmount: receipt.amount,
    requiresApproval: receipt.amount >= RECONCILIATION_POLICY.unmatchedReviewThreshold,
    reason,
  };
}

export function matchReceipt(receipt: Receipt, context: MatchContext): MatchDecision {
  const money = (value: number): string => formatAmount(value, receipt.currency);

  const prior = context.priorReceipts.find(
    (entry) =>
      entry.customer === receipt.customer &&
      entry.currency === receipt.currency &&
      sameAmount(entry.amount, receipt.amount) &&
      (entry.reference ?? '') === (receipt.reference ?? ''),
  );
  if (prior) {
    return {
      receiptId: receipt.id,
      customer: receipt.customer,
      kind: 'DUPLICATE',
      invoiceIds: [],
      allocations: [],
      appliedAmount: 0,
      writeOffAmount: 0,
      creditAmount: 0,
      unappliedAmount: receipt.amount,
      requiresApproval: false,
      reason: `${prior.id} already brought ${money(prior.amount)} from ${receipt.customer} on the same reference; hold this second arrival as unapplied cash — never apply it twice.`,
    };
  }

  const candidates = context.invoices
    .filter(
      (entry) =>
        entry.customer === receipt.customer &&
        entry.currency === receipt.currency &&
        outstanding(entry) > 0.005,
    )
    .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate));

  const refs = extractRefs(receipt.reference, context.analystRefs);
  let targets: Invoice[];
  if (refs.length > 0) {
    targets = candidates.filter((entry) => refs.includes(entry.id));
    if (targets.length === 0) {
      return unmatched(
        receipt,
        `reference ${refs.join(', ')} matches no open ${receipt.currency} invoice for ${receipt.customer}; hold as unapplied cash and request a corrected remittance.`,
      );
    }
  } else {
    const exact = candidates.filter((entry) => sameAmount(outstanding(entry), receipt.amount));
    if (exact.length === 1) targets = exact;
    else if (exact.length > 1) {
      return unmatched(
        receipt,
        `${exact.length} open invoices match ${money(receipt.amount)} exactly — ambiguous without a reference; a person must choose one.`,
      );
    } else {
      return unmatched(
        receipt,
        `no open ${receipt.currency} invoice for ${receipt.customer} matches ${money(receipt.amount)}; hold as unapplied cash.`,
      );
    }
  }

  let remaining = receipt.amount;
  const allocations: MatchAllocation[] = [];
  let writeOffAmount = 0;
  let writeOffTolerance: number | undefined;
  let requiresApproval = false;

  const applyTo = (target: Invoice): void => {
    if (remaining <= 0.005) return;
    const open = outstanding(target);
    if (remaining >= open - 0.005) {
      allocations.push({ invoiceId: target.id, applied: open, writeOff: 0 });
      remaining = round2(remaining - open);
      return;
    }
    const shortfall = round2(open - remaining);
    if (context.claimsDeduction) {
      writeOffTolerance = Math.max(
        RECONCILIATION_POLICY.writeOffFloor,
        round2(open * RECONCILIATION_POLICY.writeOffPercent),
      );
      allocations.push({ invoiceId: target.id, applied: round2(remaining), writeOff: shortfall });
      writeOffAmount = round2(writeOffAmount + shortfall);
      if (shortfall > writeOffTolerance + 0.005) requiresApproval = true;
      remaining = 0;
      return;
    }
    allocations.push({ invoiceId: target.id, applied: round2(remaining), writeOff: 0 });
    remaining = 0;
  };

  for (const target of targets) applyTo(target);
  if (remaining > 0.005) {
    for (const extra of candidates.filter((entry) => !targets.includes(entry))) applyTo(extra);
  }
  const creditAmount = remaining > 0.005 ? round2(remaining) : 0;

  const appliedAmount = round2(allocations.reduce((sum, entry) => sum + entry.applied, 0));
  const openTargets = [...new Set(allocations.map((entry) => entry.invoiceId))]
    .map((invoiceId) => {
      const invoice = context.invoices.find((entry) => entry.id === invoiceId);
      if (!invoice) return { id: invoiceId, open: 0 };
      const handled = allocations
        .filter((entry) => entry.invoiceId === invoiceId)
        .reduce((sum, entry) => sum + entry.applied + entry.writeOff, 0);
      return { id: invoiceId, open: round2(Math.max(0, outstanding(invoice) - handled)) };
    })
    .filter((entry) => entry.open > 0.005);
  const openAfter = round2(openTargets.reduce((sum, entry) => sum + entry.open, 0));

  let kind: MatchKind;
  let reason: string;
  if (creditAmount > 0) {
    kind = 'OVERPAYMENT';
    reason = `applied ${money(appliedAmount)} and left ${money(creditAmount)} as customer credit — nothing else is open for ${receipt.customer}.`;
  } else if (writeOffAmount > 0) {
    kind = 'DEDUCTION';
    reason = requiresApproval
      ? `the remittance claims a ${money(writeOffAmount)} deduction, above the ${money(writeOffTolerance ?? 0)} autonomous tolerance — a person must approve the write-off before it posts.`
      : `the remittance claims a ${money(writeOffAmount)} deduction, within the ${money(writeOffTolerance ?? 0)} autonomous tolerance — written off with the payment.`;
  } else if (refs.length === 0) {
    kind = 'UNREFERENCED';
    reason = `no reference on the wire, but the amount equals ${targets[0]?.id ?? 'an open invoice'} exactly; applied ${money(appliedAmount)} on the payer + amount evidence.`;
  } else if (openAfter > 0.005) {
    kind = 'PARTIAL';
    reason = `applied ${money(appliedAmount)}; ${money(openAfter)} stays open on ${openTargets.map((entry) => entry.id).join(', ')} for ${receipt.customer} to pay.`;
  } else {
    kind = 'EXACT';
    reason = `matched by reference to ${allocations.map((entry) => entry.invoiceId).join(', ')}; applied ${money(appliedAmount)} — settled in full.`;
  }

  return {
    receiptId: receipt.id,
    customer: receipt.customer,
    kind,
    invoiceIds: allocations.map((entry) => entry.invoiceId),
    allocations,
    appliedAmount,
    writeOffAmount,
    creditAmount,
    unappliedAmount: 0,
    requiresApproval,
    reason,
  };
}

/** Apply a decision to the book; a denied write-off is applied as cash-only. */
export function applyMatch(invoices: Invoice[], decision: MatchDecision): Invoice[] {
  const byId = new Map(invoices.map((entry) => [entry.id, entry]));
  for (const allocation of decision.allocations) {
    const current = byId.get(allocation.invoiceId);
    if (!current) continue;
    let next = allocation.applied > 0 ? withPayment(current, allocation.applied) : current;
    if (allocation.writeOff > 0) next = withWriteOff(next, allocation.writeOff);
    byId.set(next.id, next);
  }
  return invoices.map((entry) => byId.get(entry.id)!);
}
