import type { Obligation, ForecastReceipt } from './types.js';

export const TREASURY_OBLIGATIONS: Obligation[] = [
  {
    id: 'obl-shipping',
    counterparty: 'Meridian Freight Co.',
    description: 'Ocean freight + customs release for inbound components',
    amount: 4_200,
    currency: 'USD',
    dueInHours: 6,
    transferMethod: 'LOCAL',
    criticality: 'critical',
    beneficiary: {
      kind: 'us-local',
      accountName: 'Meridian Freight Co.',
      accountNumber: '123450001',
      routingNumber: '021000021',
      bankName: 'JPMorgan Chase',
      address: {
        streetAddress: '270 Park Avenue',
        city: 'New York',
        state: 'NY',
        postcode: '10017',
        countryCode: 'US',
      },
    },
  },
  {
    id: 'obl-parts',
    counterparty: 'Steinmetz Komponenten GmbH',
    description: 'Time-sensitive CNC components — production line stops without them',
    amount: 5_400,
    currency: 'EUR',
    dueInHours: 20,
    transferMethod: 'SWIFT',
    criticality: 'high',
    beneficiary: {
      kind: 'eu-swift',
      accountName: 'Steinmetz Komponenten GmbH',
      iban: 'DE89370400440532013000',
      swiftCode: 'COBADEFFXXX',
      bankName: 'Commerzbank',
      address: {
        streetAddress: 'Kaiserplatz 1',
        city: 'Frankfurt',
        state: 'HE',
        postcode: '60311',
        countryCode: 'DE',
      },
    },
  },
  {
    id: 'obl-software',
    counterparty: 'Lowly Software Inc.',
    description: 'Annual analytics subscription renewal — cancellable for 30 days',
    amount: 380,
    currency: 'USD',
    dueInHours: 60,
    transferMethod: 'LOCAL',
    criticality: 'low',
    beneficiary: {
      kind: 'us-local',
      accountName: 'Lowly Software Inc.',
      accountNumber: '998812340',
      routingNumber: '021000021',
      bankName: 'JPMorgan Chase',
      address: {
        streetAddress: '500 Howard Street',
        city: 'San Francisco',
        state: 'CA',
        postcode: '94105',
        countryCode: 'US',
      },
    },
  },
  {
    id: 'obl-consulting',
    counterparty: 'Anker Strategy Partners',
    description: 'Q3 strategy retainer',
    amount: 1_150,
    currency: 'GBP',
    dueInHours: 30,
    transferMethod: 'LOCAL',
    criticality: 'normal',
    beneficiary: {
      kind: 'gb-local',
      accountName: 'Anker Strategy Partners',
      accountNumber: '31926819',
      sortCode: '231470',
      bankName: 'Barclays Bank UK',
      address: {
        streetAddress: '1 Churchill Place',
        city: 'London',
        postcode: 'E14 5HP',
        countryCode: 'GB',
      },
    },
  },
  {
    id: 'obl-helios',
    counterparty: 'Helios Advisory LLC',
    description: 'Interim CFO advisory — vendor not yet in the approved payee list',
    amount: 3_500,
    currency: 'USD',
    dueInHours: 12,
    transferMethod: 'LOCAL',
    criticality: 'normal',
    requiresApproval: true,
    approvalReason: 'New payee over USD 2,000 requires vendor onboarding approval',
    beneficiary: {
      kind: 'us-local',
      accountName: 'Helios Advisory LLC',
      accountNumber: '556677889',
      routingNumber: '021000021',
      bankName: 'JPMorgan Chase',
      address: {
        streetAddress: '1100 Congress Avenue',
        city: 'Austin',
        state: 'TX',
        postcode: '78701',
        countryCode: 'US',
      },
    },
  },
];

export const TREASURY_FORECAST: ForecastReceipt = {
  payer: 'Northwind Retail Group',
  amount: 8_000,
  currency: 'USD',
  expectedInHours: 18,
  confidence: 0.86,
  evidence: [
    'Bank feed shows an inbound ACH prenotification from Northwind',
    'Signed invoice NW-4417 marked "scheduled for payment this week"',
    'Northwind paid the previous three invoices within terms',
  ],
};

export const CONTRADICTING_EMAIL = {
  from: 'ap@northwind-retail.example',
  subject: 'Re: Invoice NW-4417 — timing',
  body: 'Our treasury committee meets Friday, so the NW-4417 payment may slip by about a week. Sorry for the late notice.',
};

export const TREASURY_DEMO_WALLET_HINT =
  'For the intended scarcity beat, hold about USD 14,000 in USD plus ~EUR 1,150 and ~GBP 1,200.';
