export interface SellerAccount {
  id: string;
  name: string;
  owedUsd: number;
  trailingRefundRate: number;
  isNewest: boolean;
}

export interface SellerSettlement {
  sellerId: string;
  name: string;
  owedUsd: number;
  reserveRate: number;
  reserveUsd: number;
  payoutUsd: number;
}

export const MARKETPLACE_POLICY = {
  /** The newest seller always reserves at least this share of what they are owed. */
  newestSellerMinimumReserveRate: 0.1,
  /** Reserve rate applied when carrier-failure evidence raises one seller's exposure. */
  evidenceReserveRate: 0.25,
};

export function reserveRate(seller: SellerAccount): number {
  return seller.isNewest
    ? Math.max(seller.trailingRefundRate, MARKETPLACE_POLICY.newestSellerMinimumReserveRate)
    : seller.trailingRefundRate;
}

export function planSettlement(sellers: SellerAccount[]): SellerSettlement[] {
  return sellers.map((seller) => {
    const rate = reserveRate(seller);
    const reserveUsd = round2(seller.owedUsd * rate);
    return {
      sellerId: seller.id,
      name: seller.name,
      owedUsd: seller.owedUsd,
      reserveRate: rate,
      reserveUsd,
      payoutUsd: round2(seller.owedUsd - reserveUsd),
    };
  });
}

/** New evidence changes one seller's exposure; recalculate only that seller. */
export function recomputeOnEvidence(
  plan: SellerSettlement[],
  sellerId: string,
  newRate: number,
): SellerSettlement[] {
  return plan.map((settlement) =>
    settlement.sellerId === sellerId
      ? {
          ...settlement,
          reserveRate: newRate,
          reserveUsd: round2(settlement.owedUsd * newRate),
          payoutUsd: round2(settlement.owedUsd * (1 - newRate)),
        }
      : settlement,
  );
}

/** Platform balance must equal unreleased reserves once payouts and recoveries settle. */
export function reconcile(
  owedTotalUsd: number,
  settlements: SellerSettlement[],
  recoveredUsd: number,
  refundsPaidUsd: number,
): { payoutsUsd: number; reservesUsd: number; platformUsd: number; balanced: boolean } {
  const payoutsUsd = round2(settlements.reduce((total, item) => total + item.payoutUsd, 0));
  const reservesUsd = round2(settlements.reduce((total, item) => total + item.reserveUsd, 0));
  const platformUsd = round2(owedTotalUsd - payoutsUsd + recoveredUsd - refundsPaidUsd);
  return {
    payoutsUsd,
    reservesUsd,
    platformUsd,
    balanced: round2(payoutsUsd + platformUsd) === round2(owedTotalUsd),
  };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
