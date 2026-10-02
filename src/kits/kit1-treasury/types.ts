import type { Address } from '../../api/beneficiaries.js';

export type Criticality = 'critical' | 'high' | 'normal' | 'low';

export interface BeneficiaryProfile {
  kind: 'us-local' | 'eu-swift' | 'gb-local';
  accountName: string;
  accountNumber?: string;
  routingNumber?: string;
  iban?: string;
  swiftCode?: string;
  sortCode?: string;
  bankName: string;
  address: Address;
}

export interface Obligation {
  id: string;
  counterparty: string;
  description: string;
  amount: number;
  currency: string;
  dueInHours: number;
  transferMethod: 'LOCAL' | 'SWIFT';
  criticality: Criticality;
  beneficiary: BeneficiaryProfile;
  /** Policy exception: payee outside the approved vendor list. */
  requiresApproval?: boolean;
  approvalReason?: string;
}

export interface ForecastReceipt {
  payer: string;
  amount: number;
  currency: string;
  expectedInHours: number;
  confidence: number;
  evidence: string[];
  contradictingEvidence?: string;
}

export type PlanAction =
  | {
      kind: 'FUND';
      obligation: Obligation;
      reason: string;
      costUsd: number;
      approved: boolean;
    }
  | {
      kind: 'CONVERT_AND_FUND';
      obligation: Obligation;
      reason: string;
      sellCurrency: string;
      buyCurrency: string;
      convertAmount: number;
      costUsd: number;
      approved: boolean;
    }
  | { kind: 'DEFER'; obligation: Obligation; reason: string }
  | { kind: 'ESCALATE'; obligation: Obligation; reason: string }
  | { kind: 'REQUIRE_APPROVAL'; obligation: Obligation; reason: string; costUsd: number };

export interface TreasuryPolicy {
  reserveFloorUsd: number;
  fundingWindowHours: number;
  commitmentLimitUsd(confidence: number): number;
  requiresApproval(obligation: Obligation): { required: boolean; reason?: string };
}

export interface PlannerInput {
  /** Wallet balances in major units, keyed by currency. */
  balances: Record<string, number>;
  /** USD value of one unit of each currency. */
  usdValue: Record<string, number>;
  obligations: Obligation[];
  forecast: ForecastReceipt;
  policy: TreasuryPolicy;
  /** Obligations already executed in an earlier pass. */
  executedObligationIds?: string[];
  /** Human-approved operation ids that may exceed the autonomous limit. */
  approvedObligationIds?: string[];
}

export interface PlannerResult {
  actions: PlanAction[];
  budget: {
    settledUsd: number;
    commitmentLimitUsd: number;
    totalUsd: number;
  };
  reserveBeforeUsd: number;
  projectedReserveUsd: number;
}
