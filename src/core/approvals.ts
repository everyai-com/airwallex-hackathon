import { createInterface } from 'node:readline/promises';

export interface ApprovalRequest {
  operationId: string;
  summary: string;
  amount: number;
  currency: string;
  counterparty: string;
  evidence: string[];
}

export interface Approval {
  approved: boolean;
  approver: string;
  approvedAt: string;
  request: ApprovalRequest;
}

export interface ApprovalGateOptions {
  /**
   * true  -> approve automatically (demo/CI).
   * false -> prompt when a TTY is available, otherwise refuse.
   * Defaults to auto-approving when stdin is not interactive.
   */
  autoApprove?: boolean;
  approver?: string;
}

/**
 * Bind every approval to the amount, currency, counterparty and evidence shown
 * to the approver. The gate records what was approved so the caller can re-check
 * that nothing material changed before executing.
 */
export class ApprovalGate {
  private readonly autoApprove: boolean;
  private readonly approver: string;

  constructor(options: ApprovalGateOptions = {}) {
    const env = process.env.AWX_AUTO_APPROVE;
    this.autoApprove =
      options.autoApprove ??
      (env === undefined ? !process.stdin.isTTY : ['1', 'true', 'yes'].includes(env.toLowerCase()));
    this.approver = options.approver ?? 'demo-operator';
  }

  async request(request: ApprovalRequest): Promise<Approval> {
    if (!this.autoApprove && process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await rl.question(
          `Approve ${request.summary} (${request.amount} ${request.currency} to ${request.counterparty})? [y/N] `,
        );
        const approved = ['y', 'yes'].includes(answer.trim().toLowerCase());
        return { approved, approver: 'human', approvedAt: new Date().toISOString(), request };
      } finally {
        rl.close();
      }
    }

    if (!this.autoApprove) {
      return { approved: false, approver: 'none', approvedAt: new Date().toISOString(), request };
    }
    return {
      approved: true,
      approver: `${this.approver} (auto)`,
      approvedAt: new Date().toISOString(),
      request,
    };
  }
}
