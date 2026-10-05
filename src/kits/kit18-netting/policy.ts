/**
 * Kit 18 policy — intercompany netting, pure and testable.
 *
 * The rule: the analyst may flag a disputed leg, but net positions, the
 * zero-sum identity and the minimal settlement plan are code. A disputed leg
 * leaves the net and escalates; it is never netted on hope.
 */

import { round2 } from '../../core/money.js';
import type { EntityId, IntercompanyLeg } from './scenario.js';

export type NetPositions = Record<string, Record<EntityId, number>>;

export interface Settlement {
  from: EntityId;
  to: EntityId;
  amount: number;
  currency: 'USD' | 'EUR' | 'GBP';
}

/** Net position per entity per currency: positive is owed, negative owes. */
export function netPositions(legs: IntercompanyLeg[]): NetPositions {
  const nets: NetPositions = {};
  for (const leg of legs) {
    nets[leg.currency] ??= { US: 0, DE: 0, UK: 0, SG: 0 };
    nets[leg.currency]![leg.to] = round2(nets[leg.currency]![leg.to]! + leg.amount);
    nets[leg.currency]![leg.from] = round2(nets[leg.currency]![leg.from]! - leg.amount);
  }
  return nets;
}

/** Every currency must net to zero, or a leg is missing or double-counted. */
export function assertNetsZero(nets: NetPositions): void {
  for (const [currency, positions] of Object.entries(nets)) {
    const total = round2(Object.values(positions).reduce((sum, value) => sum + value, 0));
    if (Math.abs(total) > 0.005) {
      throw new Error(`Net positions for ${currency} sum to ${total}, not zero.`);
    }
  }
}

/**
 * Greedy minimal settlement per currency: the largest debtor pays the largest
 * creditor until every net is zero. Optimal for single-currency netting.
 */
export function planSettlements(nets: NetPositions): Settlement[] {
  const settlements: Settlement[] = [];
  for (const [currency, positions] of Object.entries(nets)) {
    const debtors = (Object.entries(positions) as [EntityId, number][])
      .filter(([, net]) => net < -0.005)
      .map(([entity, net]) => ({ entity, owes: round2(-net) }))
      .sort((a, b) => b.owes - a.owes);
    const creditors = (Object.entries(positions) as [EntityId, number][])
      .filter(([, net]) => net > 0.005)
      .map(([entity, net]) => ({ entity, owed: net }))
      .sort((a, b) => b.owed - a.owed);
    let debtorIndex = 0;
    let creditorIndex = 0;
    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
      const debtor = debtors[debtorIndex]!;
      const creditor = creditors[creditorIndex]!;
      const amount = round2(Math.min(debtor.owes, creditor.owed));
      settlements.push({
        from: debtor.entity,
        to: creditor.entity,
        amount,
        currency: currency as Settlement['currency'],
      });
      debtor.owes = round2(debtor.owes - amount);
      creditor.owed = round2(creditor.owed - amount);
      if (debtor.owes <= 0.005) debtorIndex += 1;
      if (creditor.owed <= 0.005) creditorIndex += 1;
    }
    const unsettled = [...debtors.slice(debtorIndex), ...creditors.slice(creditorIndex)];
    if (unsettled.some((entry) => Math.abs('owes' in entry ? entry.owes : entry.owed) > 0.005)) {
      throw new Error(`Could not settle ${currency} nets to zero.`);
    }
  }
  return settlements;
}

/** Gross cash that must leave the hub wallet per currency. */
export function settlementTotals(settlements: Settlement[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const entry of settlements) {
    totals[entry.currency] = round2((totals[entry.currency] ?? 0) + entry.amount);
  }
  return totals;
}
