export interface BridgeRequest {
  customerId: string;
  customerName: string;
  shortfallUsd: number;
  dueInHours: number;
}

export interface BridgeDecision {
  approved: BridgeRequest[];
  declined: { request: BridgeRequest; reason: string }[];
  capacityUsd: number;
}

export const SPEND_POLICY = {
  reserveFloorUsd: 12_000,
  maxBridgePerCustomerUsd: 3_000,
};

/**
 * Ration bridge capital. The platform advances a shortfall from its own wallet
 * and collects it back when the customer's deposit lands; the reserve floor
 * bounds how much can be advanced in total, so scarcity forces a choice.
 */
export function planBridges(
  requests: BridgeRequest[],
  platformBalanceUsd: number,
  policy = SPEND_POLICY,
): BridgeDecision {
  let capacityUsd = Math.max(0, platformBalanceUsd - policy.reserveFloorUsd);
  const approved: BridgeRequest[] = [];
  const declined: { request: BridgeRequest; reason: string }[] = [];

  const ordered = [...requests].sort(
    (a, b) => a.dueInHours - b.dueInHours || a.shortfallUsd - b.shortfallUsd,
  );

  for (const request of ordered) {
    if (request.shortfallUsd > policy.maxBridgePerCustomerUsd) {
      declined.push({
        request,
        reason: `Shortfall ${request.shortfallUsd} exceeds the per-customer bridge limit ${policy.maxBridgePerCustomerUsd}.`,
      });
      continue;
    }
    if (request.shortfallUsd <= capacityUsd) {
      approved.push(request);
      capacityUsd -= request.shortfallUsd;
    } else {
      declined.push({
        request,
        reason: `Only USD ${capacityUsd.toFixed(2)} of bridge capacity remains above the USD ${policy.reserveFloorUsd} reserve floor.`,
      });
    }
  }

  return { approved, declined, capacityUsd };
}
