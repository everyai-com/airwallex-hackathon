export interface DisputeCase {
  id: string;
  label: string;
  merchantOrderId: string;
  amount: number;
  currency: string;
  /** Visa dispute reason code staged in the sandbox. */
  reasonCode: string;
  comment: string;
  evidence: {
    /** How many prior undisputed orders share the customer's device/IP. */
    deviceIpMatchesPriorOrders: number;
    signedDelivery: boolean;
    deliveryScanPresent: boolean;
    /** Support emails from the customer that never received a reply. */
    supportEmailsUnanswered: number;
  };
  customer: {
    name: string;
    email: string;
    ip: string;
    deviceId: string;
    billingAddress: string;
  };
}

export const DISPUTE_FEE_USD = 15;

export const DISPUTE_CASES: DisputeCase[] = [
  {
    id: 'case-fraud-large',
    label: 'Large fraud claim with strong evidence',
    merchantOrderId: 'ORD-9001',
    amount: 480,
    currency: 'USD',
    reasonCode: '10.4',
    comment: 'Cardholder claims the payment was fraudulent.',
    evidence: {
      deviceIpMatchesPriorOrders: 3,
      signedDelivery: true,
      deliveryScanPresent: true,
      supportEmailsUnanswered: 0,
    },
    customer: {
      name: 'Jamie Ortega',
      email: 'jamie.ortega@example.com',
      ip: '203.0.113.44',
      deviceId: 'dev-59ec5db9-99aa',
      billingAddress: '1460 Mission St #02W101, San Francisco, CA 94103, US',
    },
  },
  {
    id: 'case-not-received-small',
    label: 'Small not-received claim, unsigned delivery',
    merchantOrderId: 'ORD-9002',
    amount: 12,
    currency: 'USD',
    reasonCode: '13.1',
    comment: 'Cardholder says merchandise was never received.',
    evidence: {
      deviceIpMatchesPriorOrders: 0,
      signedDelivery: false,
      deliveryScanPresent: true,
      supportEmailsUnanswered: 0,
    },
    customer: {
      name: 'Robin Vale',
      email: 'robin.vale@example.com',
      ip: '198.51.100.7',
      deviceId: 'dev-1f2e3d4c',
      billingAddress: '89 Cedar Lane, Portland, OR 97205, US',
    },
  },
  {
    id: 'case-credit-not-processed',
    label: 'Credit not processed, support never replied',
    merchantOrderId: 'ORD-9003',
    amount: 220,
    currency: 'USD',
    reasonCode: '13.6',
    comment: 'Cardholder says a promised refund credit never arrived.',
    evidence: {
      deviceIpMatchesPriorOrders: 0,
      signedDelivery: false,
      deliveryScanPresent: false,
      supportEmailsUnanswered: 2,
    },
    customer: {
      name: 'Alex Chen',
      email: 'alex.chen@example.com',
      ip: '192.0.2.19',
      deviceId: 'dev-8a7b6c5d',
      billingAddress: '301 Lakeview Drive, Chicago, IL 60614, US',
    },
  },
];

export const TEST_CARD = {
  number: '4035501000000008',
  expiryMonth: '12',
  expiryYear: '2030',
  cvc: '123',
  name: 'Cardholder Name',
};
