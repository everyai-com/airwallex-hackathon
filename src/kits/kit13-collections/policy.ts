/**
 * Kit 13 policy — AR collections decisions, pure and testable.
 * The agent decides how to chase each overdue invoice from aging, customer
 * history and cash exposure; the thresholds live here, not in a prompt.
 */

import { formatAmount, round2 } from '../../core/money.js';
import { agingDays, outstanding, type Invoice } from '../billing-shared.js';

export const COLLECTIONS_POLICY = {
  /** Do not contact the same customer again within this many days. */
  reminderCooldownDays: 7,
  /** Chasing costs more than the balance: write off small, very old invoices. */
  smallBalanceUsd: 75,
  smallBalanceAgingDays: 90,
  /** High-risk customers escalate early. */
  escalateRiskScore: 0.6,
  escalateAgingDays: 45,
  escalateLargeUsd: 5_000,
  /** Payment plans are offered to good payers with material balances. */
  planMinPromisesKept: 0.8,
  planMinOpenUsd: 2_000,
  goodPayerRemindPromises: 0.9,
  /** A proposed plan must clear both bounds to be accepted. */
  planFirstPaymentMinPercent: 0.3,
  planMaxDays: 30,
};

const USD_RATES: Record<string, number> = { USD: 1, EUR: 1.0869 };

export interface CustomerProfile {
  name: string;
  avgDaysLate: number;
  /** 0..1 — how often this customer keeps a promise. */
  promisesKept: number;
  /** 0..1 — 0.6+ is high risk. */
  riskScore: number;
}

export type CollectionAction =
  | 'NO_ACTION'
  | 'COOLDOWN'
  | 'WRITE_OFF_SMALL'
  | 'REMIND'
  | 'FIRM_NOTICE'
  | 'PAYMENT_PLAN'
  | 'ESCALATE';

export interface CollectionDecision {
  invoiceId: string;
  customer: string;
  action: CollectionAction;
  openAmount: number;
  currency: string;
  openUsd: number;
  daysOverdue: number;
  requiresApproval: boolean;
  reason: string;
}

export function usdValueOf(currency: string): number {
  return USD_RATES[currency] ?? 1;
}

export function decideCollection(
  invoice: Invoice,
  customer: CustomerProfile,
  context: { asOf: string; lastContactDaysAgo?: number },
  policy = COLLECTIONS_POLICY,
): CollectionDecision {
  const base = {
    invoiceId: invoice.id,
    customer: invoice.customer,
    openAmount: outstanding(invoice),
    currency: invoice.currency,
    openUsd: round2(outstanding(invoice) * usdValueOf(invoice.currency)),
    daysOverdue: agingDays(invoice, context.asOf),
  };
  const money = formatAmount(outstanding(invoice), invoice.currency);

  if (base.daysOverdue <= 0) {
    return { ...base, action: 'NO_ACTION', requiresApproval: false, reason: `${invoice.id} is not yet due; leave it alone.` };
  }

  if (base.openUsd <= policy.smallBalanceUsd && base.daysOverdue > policy.smallBalanceAgingDays) {
    return {
      ...base,
      action: 'WRITE_OFF_SMALL',
      requiresApproval: false,
      reason: `${invoice.id} is ${money} and ${base.daysOverdue} days past due — chasing costs more than the balance; write it off within the autonomous limit.`,
    };
  }

  if (context.lastContactDaysAgo !== undefined && context.lastContactDaysAgo < policy.reminderCooldownDays) {
    return {
      ...base,
      action: 'COOLDOWN',
      requiresApproval: false,
      reason: `${invoice.id} was contacted ${context.lastContactDaysAgo} day(s) ago; the ${policy.reminderCooldownDays}-day cooldown protects the relationship.`,
    };
  }

  const escalate =
    (base.daysOverdue > policy.escalateAgingDays && base.openUsd >= policy.escalateLargeUsd) ||
    (customer.riskScore >= policy.escalateRiskScore && base.daysOverdue > 14);
  if (escalate) {
    return {
      ...base,
      action: 'ESCALATE',
      requiresApproval: true,
      reason: `${invoice.id} is ${money}, ${base.daysOverdue} days past due with risk ${customer.riskScore} and ${Math.round(customer.promisesKept * 100)}% promises kept — escalate beyond reminders; a person must approve.`,
    };
  }

  if (base.daysOverdue >= 31) {
    const planFits = customer.promisesKept >= policy.planMinPromisesKept && base.openUsd >= policy.planMinOpenUsd;
    return planFits
      ? {
          ...base,
          action: 'PAYMENT_PLAN',
          requiresApproval: false,
          reason: `${invoice.id} is ${base.daysOverdue} days past due but ${customer.name} keeps ${Math.round(customer.promisesKept * 100)}% of promises — offer a payment plan instead of pressure.`,
        }
      : {
          ...base,
          action: 'FIRM_NOTICE',
          requiresApproval: false,
          reason: `${invoice.id} is ${base.daysOverdue} days past due and ${customer.name} has missed ${Math.round((1 - customer.promisesKept) * 100)}% of promises — send a firm notice before escalating.`,
        };
  }

  if (base.daysOverdue >= 15) {
    return customer.promisesKept >= policy.goodPayerRemindPromises
      ? {
          ...base,
          action: 'REMIND',
          requiresApproval: false,
          reason: `${invoice.id} is ${base.daysOverdue} days past due; ${customer.name} averages ${customer.avgDaysLate} days late — a friendly reminder keeps it moving.`,
        }
      : {
          ...base,
          action: 'FIRM_NOTICE',
          requiresApproval: false,
          reason: `${invoice.id} is ${base.daysOverdue} days past due and not a reliable payer — escalate the tone.`,
        };
  }

  return {
    ...base,
    action: 'REMIND',
    requiresApproval: false,
    reason: `${invoice.id} is ${base.daysOverdue} day(s) past due — start with a reminder.`,
  };
}

export interface PaymentPlanProposal {
  firstPaymentPercent: number;
  remainingDays: number;
}

export interface PlanAssessment {
  accepted: boolean;
  reason: string;
}

export function assessPlan(
  proposal: PaymentPlanProposal,
  policy = COLLECTIONS_POLICY,
): PlanAssessment {
  if (proposal.firstPaymentPercent + 1e-6 < policy.planFirstPaymentMinPercent) {
    return {
      accepted: false,
      reason: `first payment of ${Math.round(proposal.firstPaymentPercent * 100)}% is below the ${Math.round(policy.planFirstPaymentMinPercent * 100)}% floor.`,
    };
  }
  if (proposal.remainingDays > policy.planMaxDays) {
    return {
      accepted: false,
      reason: `the balance would land in ${proposal.remainingDays} days, beyond the ${policy.planMaxDays}-day maximum.`,
    };
  }
  return {
    accepted: true,
    reason: `first payment of ${Math.round(proposal.firstPaymentPercent * 100)}% clears the floor and the balance lands within ${proposal.remainingDays} days — accept and pause dunning.`,
  };
}
