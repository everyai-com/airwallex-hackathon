/**
 * Kit 14 policy — contract-to-cash billing, pure and testable.
 *
 * The rule: the analyst may flag the billing shape of a contract (net terms,
 * milestones, a dispute), but every line, amount, date and threshold is parsed
 * and decided in code. A contract the analyst and the parser read differently
 * is held for a person instead of billed.
 */

import { formatAmount, round2 } from '../../core/money.js';
import type { ContractReading } from '../../core/analyst.js';

export const BILLING_POLICY = {
  /** Net days when the contract states no payment terms. */
  defaultNetDays: 30,
  /** Disputes up to the greater of this floor or 2% of the contract are immaterial. */
  disputeFloor: 25,
  disputePercent: 0.02,
};

export interface ParsedLine {
  description: string;
  quantity: number;
  unitAmount: number;
}

export interface ParsedMilestone {
  label: string;
  percent: number;
  amount: number;
  trigger: 'signing' | 'delivery';
}

export interface ParsedContract {
  reference: string;
  customer: string;
  currency: string;
  netDays: number;
  lines: ParsedLine[];
  milestones: ParsedMilestone[];
  /** Amount the customer says it will withhold, 0 when nothing is disputed. */
  disputedAmount: number;
}

export type BillingAction = 'ISSUE_NOW' | 'ISSUE_MILESTONES_DUE' | 'PARTIAL_ISSUE' | 'HOLD';

export interface BillingDecision {
  reference: string;
  action: BillingAction;
  issueLines: ParsedLine[];
  heldLines: ParsedLine[];
  dueMilestones: ParsedMilestone[];
  heldMilestones: ParsedMilestone[];
  disputedAmount: number;
  requiresApproval: boolean;
  reason: string;
}

const LINE_PATTERN = /^LINE:\s*(.+?)\s*\|\s*QTY\s*(\d+)\s*\|\s*@\s*([A-Z]{3})\s*([\d,]+\.\d{2})/im;
const MILESTONE_PATTERN =
  /^MILESTONE\s*(\d+):\s*(.+?)\s*[-–]\s*(\d+)%\s*\(([A-Z]{3})\s*([\d,]+\.\d{2})\)\s*due on (signing|delivery)/im;
const NET_PATTERN = /Net\s*(\d{1,3})/i;
const WITHHOLD_PATTERN = /withhold\s*([A-Z]{3})\s*([\d,]+\.\d{2})/i;

export function lineTotal(line: ParsedLine): number {
  return round2(line.quantity * line.unitAmount);
}

export function contractTotal(parsed: ParsedContract): number {
  const lines = parsed.lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const milestones = parsed.milestones.reduce((sum, entry) => sum + entry.amount, 0);
  return round2(lines + milestones);
}

export function disputeTolerance(total: number): number {
  return Math.max(BILLING_POLICY.disputeFloor, round2(total * BILLING_POLICY.disputePercent));
}

/** Deterministic parse of the semi-structured contract text. No model involved. */
export function parseContract(
  reference: string,
  customer: string,
  currency: string,
  text: string,
): ParsedContract {
  const lines: ParsedLine[] = [];
  const milestones: ParsedMilestone[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const lineMatch = line.match(LINE_PATTERN);
    if (lineMatch) {
      lines.push({
        description: lineMatch[1]!.trim(),
        quantity: Number(lineMatch[2]),
        unitAmount: Number(lineMatch[4]!.replace(/,/g, '')),
      });
      continue;
    }
    const milestoneMatch = line.match(MILESTONE_PATTERN);
    if (milestoneMatch) {
      milestones.push({
        label: milestoneMatch[2]!.trim(),
        percent: Number(milestoneMatch[3]),
        amount: Number(milestoneMatch[5]!.replace(/,/g, '')),
        trigger: milestoneMatch[6]!.toLowerCase() === 'delivery' ? 'delivery' : 'signing',
      });
    }
  }
  const netMatch = text.match(NET_PATTERN);
  const withholdMatch = text.match(WITHHOLD_PATTERN);
  return {
    reference,
    customer,
    currency,
    netDays: netMatch ? Number(netMatch[1]) : BILLING_POLICY.defaultNetDays,
    lines,
    milestones,
    disputedAmount: withholdMatch ? Number(withholdMatch[2]!.replace(/,/g, '')) : 0,
  };
}

/** The disputed line is the one whose total equals the withheld amount. */
export function matchDisputedLine(parsed: ParsedContract): ParsedLine | undefined {
  if (parsed.disputedAmount <= 0) return undefined;
  return parsed.lines.find(
    (line) => Math.abs(lineTotal(line) - parsed.disputedAmount) <= 0.005,
  );
}

/** Delivery evidence counts when the analyst sees no dispute and the note accepts. */
export function deliveryConfirmed(reading: ContractReading, noteText: string): boolean {
  return !reading.mentionsDispute && /accept|confirmed|complete|approved/i.test(noteText);
}

export interface BillingEvidence {
  /** Milestone triggers already met (signing is met at contract start). */
  delivered: boolean;
}

export function decideBilling(
  parsed: ParsedContract,
  reading: ContractReading,
  evidence: BillingEvidence,
): BillingDecision {
  const money = (value: number): string => formatAmount(value, parsed.currency);
  const total = contractTotal(parsed);
  const base = {
    reference: parsed.reference,
    issueLines: [] as ParsedLine[],
    heldLines: [] as ParsedLine[],
    dueMilestones: [] as ParsedMilestone[],
    heldMilestones: [] as ParsedMilestone[],
    disputedAmount: parsed.disputedAmount,
    requiresApproval: false,
  };

  const parserSeesMilestones = parsed.milestones.length > 0;
  const parserSeesDispute = parsed.disputedAmount > 0;
  if (
    parserSeesMilestones !== reading.mentionsMilestones ||
    parserSeesDispute !== reading.mentionsDispute
  ) {
    return {
      ...base,
      action: 'HOLD',
      heldLines: parsed.lines,
      heldMilestones: parsed.milestones,
      requiresApproval: true,
      reason: `Analyst and parser disagree (milestones ${reading.mentionsMilestones}/${parserSeesMilestones}, dispute ${reading.mentionsDispute}/${parserSeesDispute}) — a person confirms the shape before anything is billed.`,
    };
  }

  const tolerance = disputeTolerance(total);
  if (parsed.disputedAmount > tolerance) {
    const disputed = matchDisputedLine(parsed);
    const clean = disputed ? parsed.lines.filter((line) => line !== disputed) : parsed.lines;
    return {
      ...base,
      action: 'PARTIAL_ISSUE',
      issueLines: clean,
      heldLines: disputed ? [disputed] : [],
      requiresApproval: true,
      reason: `Disputed ${money(parsed.disputedAmount)} exceeds the ${money(tolerance)} tolerance — bill the clean lines now, escalate the disputed line with approval.`,
    };
  }

  if (parsed.milestones.length > 0) {
    const due = parsed.milestones.filter(
      (entry) => entry.trigger === 'signing' || evidence.delivered,
    );
    const held = parsed.milestones.filter(
      (entry) => !(entry.trigger === 'signing' || evidence.delivered),
    );
    if (held.length > 0) {
      return {
        ...base,
        action: 'ISSUE_MILESTONES_DUE',
        dueMilestones: due,
        heldMilestones: held,
        reason: `Milestone contract: ${due.length} due now, ${held.length} held until the delivery trigger is met.`,
      };
    }
    return {
      ...base,
      action: 'ISSUE_MILESTONES_DUE',
      dueMilestones: due,
      heldMilestones: [],
      reason: 'All milestone triggers are met — every milestone bills.',
    };
  }

  if (parsed.disputedAmount > 0) {
    return {
      ...base,
      action: 'ISSUE_NOW',
      issueLines: parsed.lines,
      reason: `Disputed ${money(parsed.disputedAmount)} is within the ${money(tolerance)} tolerance — immaterial, bill the full contract and note it.`,
    };
  }

  return {
    ...base,
    action: 'ISSUE_NOW',
    issueLines: parsed.lines,
    reason: `Clean PO for ${money(total)} on Net ${parsed.netDays} — issue and finalize one invoice.`,
  };
}

/** issued = paid + open, or the run fails. All run-relative, all in code. */
export function assertBillingIdentity(input: {
  issued: number;
  paid: number;
  open: number;
  currency: string;
}): void {
  if (Math.abs(input.issued - input.paid - input.open) > 0.005) {
    throw new Error(
      `Billing identity broken: issued ${input.issued} != paid ${input.paid} + open ${input.open} (${input.currency}).`,
    );
  }
}
