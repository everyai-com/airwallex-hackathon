/** Kit 9 scenario: the procurement request and the merchant feed that changes it. */

export const PROCUREMENT_REQUEST = {
  goal: 'One espresso machine for the office kitchen.',
  constraint:
    'Pick the highest rated that stays within USD 500 delivered and arrives by Friday (2 days).',
  budgetUsd: 500,
  deadlineDays: 2,
  quantity: 1,
};

export const FIRST_SEARCH = 'espresso machine';

export const BACKORDER_NOTE = {
  from: 'CremaCo merchant feed',
  body: 'Heads up — our Gaggia Classic Evo Pro listing is backordered: the next EU warehouse shipment leaves in 10 business days. The same machine ships in 2 days from RoastWorks.',
  affectedSku: 'GAGGIA-EVO-CREMACO',
};

export const AIRI_SHOPPER_EMAIL = 'office.shopper@airi.example';
