/**
 * Kit 16 scenario — balances, obligations and the market notes the analyst reads.
 * The pull-forward is the new information: Steinmetz moves EUR 2,000 of its
 * invoice to tomorrow, after the first hedge already ran.
 */

export interface HedgeObligation {
  id: string;
  counterparty: string;
  amount: number;
  currency: 'USD' | 'EUR' | 'GBP';
  dueInDays: number;
}

export const HEDGE_STARTING_BALANCES = { USD: 20_000, EUR: 12_000, GBP: 3_000 };

export const HEDGE_RESERVE_FLOOR_USD = 9_000;

export const HEDGE_OBLIGATIONS: HedgeObligation[] = [
  { id: 'obl-steinmetz', counterparty: 'Steinmetz GmbH', amount: 9_000, currency: 'EUR', dueInDays: 5 },
  { id: 'obl-lowly', counterparty: 'Lowly Freight', amount: 4_000, currency: 'GBP', dueInDays: 3 },
  { id: 'obl-meridian', counterparty: 'Meridian Freight', amount: 5_000, currency: 'USD', dueInDays: 7 },
];

export const EUR_MARKET_NOTE =
  'EUR desk: ECB signals point to a softer euro into month-end; expect EUR/USD to slip about 2% before the Steinmetz payment lands.';

export const GBP_MARKET_NOTE =
  'GBP desk: the Bank keeps rates steady and confirms no change before the Lowly payment clears; the transfer is scheduled and on track.';

export interface PullForward {
  obligationId: string;
  amount: number;
  reason: string;
}

export const STEINMETZ_PULL_FORWARD: PullForward = {
  obligationId: 'obl-steinmetz',
  amount: 2_000,
  reason: 'Steinmetz pulls EUR 2,000 of its invoice forward to tomorrow — the hedge overshot and must be partly undone.',
};
