/**
 * Kit 14 scenario — three inbound contracts and one delivery confirmation.
 * Semi-structured like real POs: the billing policy parses every line, amount
 * and date in code, and the analyst only flags the billing shape.
 */

export interface ContractCase {
  id: string;
  reference: string;
  customer: string;
  email: string;
  currency: string;
  text: string;
}

export const CONTRACTS: ContractCase[] = [
  {
    id: 'po-clean',
    reference: 'PO-2201',
    customer: 'Northwind Traders',
    email: 'ap@northwind.example.com',
    currency: 'USD',
    text: [
      'PURCHASE ORDER PO-2201',
      'Buyer: Northwind Traders (ap@northwind.example.com)',
      'Supplier: Sandbox Business',
      'Payment terms: Net 30 from invoice date.',
      '',
      'LINE: Industrial sensor array | QTY 4 | @ USD 1850.00',
      'LINE: Calibration service (onsite) | QTY 1 | @ USD 600.00',
      '',
      'Deliver to: Reno warehouse, dock 7. Reference PO-2201 on all invoices.',
    ].join('\n'),
  },
  {
    id: 'msa-milestones',
    reference: 'MSA-117',
    customer: 'Cascade Co',
    email: 'billing@cascade.example.com',
    currency: 'USD',
    text: [
      'MASTER SERVICES AGREEMENT MSA-117',
      'Client: Cascade Co (billing@cascade.example.com)',
      'Project: Warehouse automation rollout, total contract value USD 12000.00.',
      '',
      'MILESTONE 1: Project kickoff and hardware staging - 50% (USD 6000.00) due on signing.',
      'MILESTONE 2: Final delivery and acceptance - 50% (USD 6000.00) due on delivery.',
      '',
      'Payment terms: Net 15 from each milestone invoice. No payment is due for',
      'milestone 2 until the delivery milestone is accepted by the client.',
    ].join('\n'),
  },
  {
    id: 'po-disputed',
    reference: 'PO-2202',
    customer: 'Datawise Inc',
    email: 'ap@datawise.example.com',
    currency: 'USD',
    text: [
      'PURCHASE ORDER PO-2202',
      'Buyer: Datawise Inc (ap@datawise.example.com)',
      'Supplier: Sandbox Business',
      'Payment terms: Net 30 from invoice date.',
      '',
      'LINE: Logistics software licenses (annual) | QTY 10 | @ USD 450.00',
      'LINE: Onboarding workshop (two days, onsite) | QTY 1 | @ USD 1200.00',
      '',
      'AMENDMENT 2026-10-03: the onboarding workshop was cancelled - the trainer',
      'never arrived. Datawise disputes the workshop line and will withhold',
      'USD 1200.00 until the missed session is rescheduled. All other lines stand.',
    ].join('\n'),
  },
];

/** New information mid-run: the Cascade delivery lands, unlocking milestone 2. */
export const DELIVERY_CONFIRMATION = {
  customer: 'Cascade Co',
  reference: 'MSA-117 delivery note',
  text: [
    'From: Cascade Co warehouse team',
    'Subject: MSA-117 milestone 2 delivered',
    '',
    'The automation rollout is installed and running at our Reno site. Delivery',
    'milestone accepted - please invoice the final 50% per MSA-117.',
  ].join('\n'),
};
