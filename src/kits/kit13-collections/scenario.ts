/** Kit 13 scenario: the overdue book, customer history, and the reply that changes the plan. */

import type { Invoice } from '../billing-shared.js';
import type { CustomerProfile } from './policy.js';

export const AS_OF = '2026-11-05';

export const CUSTOMERS: CustomerProfile[] = [
  { name: 'Northwind Traders', avgDaysLate: 6, promisesKept: 0.9, riskScore: 0.15 },
  { name: 'Alpine GmbH', avgDaysLate: 4, promisesKept: 0.95, riskScore: 0.1 },
  { name: 'Bluepeak LLC', avgDaysLate: 34, promisesKept: 0.3, riskScore: 0.8 },
  { name: 'Cascade Co', avgDaysLate: 9, promisesKept: 0.85, riskScore: 0.25 },
  { name: 'Vela Studio', avgDaysLate: 60, promisesKept: 0.2, riskScore: 0.9 },
  { name: 'Datawise Inc', avgDaysLate: 5, promisesKept: 0.9, riskScore: 0.2 },
];

/** The customer was reminded two days ago — the cooldown should stop a second chase. */
export const LAST_CONTACT_DAYS_AGO: Record<string, number> = {
  'INV-1043': 2,
};

/** A long-forgotten small balance: chasing it costs more than it is worth. */
export const SMALL_BALANCE: Invoice = {
  id: 'INV-1049',
  customer: 'Vela Studio',
  currency: 'USD',
  total: 60,
  paid: 0,
  writtenOff: 0,
  issueDate: '2026-05-01',
  dueDate: '2026-06-15',
  status: 'OPEN',
};

export const CASCADE_REPLY = {
  invoiceId: 'INV-1047',
  from: 'ar@cascade.example',
  body: `Hi — cash is tight this month. We can send 40% of INV-1047 this week and the balance in three weeks. Would that work?`,
  firstPaymentPercent: 0.4,
  remainingDays: 21,
};

export function customerFor(name: string): CustomerProfile {
  const customer = CUSTOMERS.find((entry) => entry.name === name);
  if (!customer) throw new Error(`No customer profile for ${name}.`);
  return customer;
}
