import type { DisputeCase } from './cases.js';

export type DisputeAction = 'CHALLENGE' | 'ACCEPT' | 'ESCALATE';

export interface DisputeDecision {
  action: DisputeAction;
  reason: string;
  acceptReason?: 'LOW_VALUE_TRANSACTION' | 'VALID_CUSTOMER_DISPUTE' | 'NO_ACTION_TAKEN_BY_MERCHANT';
  challengeReason?: 'PRODUCT_RECEIVED' | 'PURCHASE_HISTORY';
}

/**
 * Decide accept / challenge / escalate from evidence and economics. The dispute
 * fee is charged even when the merchant wins, so defending a claim smaller than
 * the fee can never pay off.
 */
export function decideDispute(disputeCase: DisputeCase, disputeFee: number): DisputeDecision {
  const { evidence, amount, reasonCode } = disputeCase;

  if (reasonCode === '13.6' && evidence.supportEmailsUnanswered >= 2) {
    return {
      action: 'ESCALATE',
      reason:
        'Credit-not-processed claim where the customer contacted support twice with no reply — this is our failure. Fix the credit and respond; challenging would defend the indefensible.',
    };
  }

  if (
    amount <= disputeFee &&
    !evidence.signedDelivery &&
    (evidence.deliveryScanPresent || reasonCode === '13.1')
  ) {
    return {
      action: 'ACCEPT',
      reason: `Amount at risk ${amount} <= dispute fee ${disputeFee} and the delivery scan has no signature — accepting costs less than defending.`,
      acceptReason: 'LOW_VALUE_TRANSACTION',
    };
  }

  if (
    reasonCode === '10.4' &&
    evidence.deviceIpMatchesPriorOrders >= 3 &&
    evidence.signedDelivery &&
    amount > disputeFee
  ) {
    return {
      action: 'CHALLENGE',
      reason:
        'Device fingerprint and IP match three prior undisputed orders and the customer signed for delivery — strong, specific, verifiable evidence.',
      challengeReason: 'PRODUCT_RECEIVED',
    };
  }

  return {
    action: 'ESCALATE',
    reason: 'Evidence is ambiguous or economics are unclear; a person should decide before we act.',
  };
}

/**
 * After the issuing bank rejects the challenge and escalates the dispute, decide
 * once more. Re-challenging requires new evidence; otherwise arbitration costs
 * usually exceed the exposure.
 */
export function decideAfterRejection(
  disputeCase: DisputeCase,
  arbitrationCostUsd: number,
): DisputeDecision {
  if (disputeCase.amount < arbitrationCostUsd) {
    return {
      action: 'ACCEPT',
      reason: `Evidence was already rejected once and arbitration costs (~${arbitrationCostUsd}) exceed the ${disputeCase.amount} exposure — accept the chargeback.`,
      acceptReason: 'VALID_CUSTOMER_DISPUTE',
    };
  }
  return {
    action: 'ESCALATE',
    reason: 'Exposure exceeds arbitration cost; collect more delivery evidence and escalate to pre-arbitration.',
  };
}
