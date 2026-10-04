/** Kit 11 scenario: one morning of bank-feed receipts against the open AR book. */

import type { Receipt } from '../billing-shared.js';

export const RECEIPTS: Receipt[] = [
  {
    id: 'rcp-01',
    customer: 'Northwind Traders',
    amount: 12_000,
    currency: 'USD',
    reference: 'Wire ref INV-1042',
    receivedAt: '2026-10-04T09:12:00Z',
    channel: 'BANK_TRANSFER',
  },
  {
    id: 'rcp-02',
    customer: 'Datawise Inc',
    amount: 4_130,
    currency: 'USD',
    reference: 'INV-1044 less agreed deductions',
    receivedAt: '2026-10-04T09:40:00Z',
    channel: 'BANK_TRANSFER',
  },
  {
    id: 'rcp-03',
    customer: 'Northwind Traders',
    amount: 5_500,
    currency: 'USD',
    reference: 'INV-1041 part payment',
    receivedAt: '2026-10-04T10:05:00Z',
    channel: 'BANK_TRANSFER',
  },
  {
    id: 'rcp-04',
    customer: 'Bluepeak LLC',
    amount: 2_150,
    currency: 'USD',
    receivedAt: '2026-10-04T10:31:00Z',
    channel: 'BANK_TRANSFER',
  },
  {
    id: 'rcp-05',
    customer: 'Alpine GmbH',
    amount: 18_600,
    currency: 'EUR',
    reference: 'INV-1043',
    receivedAt: '2026-10-04T11:02:00Z',
    channel: 'BANK_TRANSFER',
  },
  {
    id: 'rcp-06',
    customer: 'Northwind Traders',
    amount: 12_000,
    currency: 'USD',
    reference: 'Wire ref INV-1042',
    receivedAt: '2026-10-04T11:26:00Z',
    channel: 'BANK_TRANSFER',
  },
  {
    id: 'rcp-07',
    customer: 'Cascade Co',
    amount: 10_400,
    currency: 'USD',
    reference: 'INV-1047 final settlement',
    receivedAt: '2026-10-04T13:44:00Z',
    channel: 'BANK_TRANSFER',
  },
  {
    id: 'rcp-08',
    customer: 'Vela Studio',
    amount: 3_400,
    currency: 'USD',
    receivedAt: '2026-10-04T14:10:00Z',
    channel: 'BANK_TRANSFER',
  },
];

export const REMITTANCE_ADVICE = {
  receiptId: 'rcp-02',
  from: 'ap@datawise.example',
  subject: 'Remittance — INV-1044',
  body: `Hi team,

We've wired USD 4,130 for INV-1044 today: the invoice total less the USD 120 credit note CR-88 for the damaged shipment, taking the early-payment discount we agreed.

Invoice USD 4,250 − credit note USD 120 = USD 4,130. Please reconcile against INV-1044 and confirm.

Thanks,
Datawise AP`,
};
