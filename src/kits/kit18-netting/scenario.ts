/**
 * Kit 18 scenario — intercompany legs across four entities, plus the dispute
 * memo that arrives as new information mid-run.
 */

export type EntityId = 'US' | 'DE' | 'UK' | 'SG';

export interface IntercompanyLeg {
  id: string;
  from: EntityId;
  to: EntityId;
  amount: number;
  currency: 'USD' | 'EUR' | 'GBP';
  memo: string;
}

export const INTERCOMPANY_LEGS: IntercompanyLeg[] = [
  { id: 'leg-1', from: 'DE', to: 'US', amount: 8_000, currency: 'USD', memo: 'DE management fees Q3' },
  { id: 'leg-2', from: 'SG', to: 'US', amount: 3_000, currency: 'USD', memo: 'SG dividend upstream' },
  { id: 'leg-3', from: 'US', to: 'SG', amount: 5_000, currency: 'USD', memo: 'US working-capital loan' },
  { id: 'leg-4', from: 'UK', to: 'US', amount: 1_500, currency: 'USD', memo: 'UK royalty catch-up' },
  { id: 'leg-5', from: 'US', to: 'DE', amount: 800, currency: 'USD', memo: 'US recharge IC-2214' },
  { id: 'leg-6', from: 'US', to: 'DE', amount: 6_000, currency: 'EUR', memo: 'US tooling prepay' },
  { id: 'leg-7', from: 'SG', to: 'DE', amount: 2_500, currency: 'EUR', memo: 'SG license fees' },
  { id: 'leg-8', from: 'DE', to: 'US', amount: 1_000, currency: 'EUR', memo: 'DE refund overbill' },
  { id: 'leg-9', from: 'US', to: 'UK', amount: 4_000, currency: 'GBP', memo: 'US freight funding' },
  { id: 'leg-10', from: 'DE', to: 'UK', amount: 1_500, currency: 'GBP', memo: 'DE marketing share' },
  { id: 'leg-11', from: 'UK', to: 'US', amount: 1_000, currency: 'GBP', memo: 'UK surplus sweep' },
];

/** New information mid-run: DE disputes one leg, which must leave the net. */
export const DISPUTE_MEMO = {
  counterparty: 'DE Sub',
  reference: 'IC-2214',
  text: [
    'From: DE Sub finance team',
    'Subject: Disputed intercompany charge IC-2214',
    '',
    'We dispute the USD 800 recharge from US Parent under reference IC-2214.',
    'It duplicates the September management fee, which is already settled.',
    'Please exclude IC-2214 from this settlement run until reconciled.',
  ].join('\n'),
};

export const DISPUTED_LEG_ID = 'leg-5';

export const NETTING_STARTING_BALANCES = { USD: 30_000, EUR: 12_000, GBP: 6_000 };
