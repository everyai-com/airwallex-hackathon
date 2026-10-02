import type { Obligation, TreasuryPolicy } from './types.js';

/**
 * Every threshold lives here, in code, not in a prompt. The autonomous
 * conversion limit scales with forecast confidence: when the evidence behind an
 * expected receipt weakens, the agent may commit less before a person approves.
 */
export const TREASURY_POLICY: TreasuryPolicy = {
  reserveFloorUsd: 9_000,
  fundingWindowHours: 24,
  commitmentLimitUsd(confidence: number): number {
    if (confidence >= 0.8) return 6_500;
    if (confidence >= 0.5) return 3_000;
    return 500;
  },
  requiresApproval(obligation: Obligation): { required: boolean; reason?: string } {
    if (obligation.requiresApproval) {
      return { required: true, reason: obligation.approvalReason ?? 'Policy exception' };
    }
    return { required: false };
  },
};

export const NEW_PAYEE_APPROVAL_THRESHOLD_USD = 2_000;
