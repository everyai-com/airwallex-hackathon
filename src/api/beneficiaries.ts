import type { AirwallexClient } from '../core/client.js';
import { asRecord, str } from '../core/parse.js';

export interface Address {
  streetAddress: string;
  city: string;
  state?: string;
  postcode: string;
  countryCode: string;
}

export interface BankDetails {
  accountName: string;
  accountCurrency: string;
  bankCountryCode: string;
  accountNumber?: string;
  iban?: string;
  swiftCode?: string;
  bankName?: string;
  routingType?: string;
  routingValue?: string;
  bankAccountCategory?: 'Checking' | 'Savings';
}

export interface BeneficiaryPayload {
  beneficiary: Record<string, unknown>;
  transfer_methods: ('LOCAL' | 'SWIFT')[];
  nickname?: string;
}

/**
 * US / USD / LOCAL: flat bank_details with account_routing_type1 "aba" and a
 * bank_account_category of exactly "Checking" or "Savings" (other casing is rejected with 016).
 */
export function usLocalBeneficiary(input: {
  accountName: string;
  accountNumber: string;
  routingNumber: string;
  address: Address;
  bankName?: string;
}): BeneficiaryPayload {
  return {
    beneficiary: {
      type: 'BANK_ACCOUNT',
      entity_type: 'COMPANY',
      address: {
        street_address: input.address.streetAddress,
        city: input.address.city,
        state: input.address.state,
        postcode: input.address.postcode,
        country_code: input.address.countryCode,
      },
      bank_details: {
        account_name: input.accountName,
        account_currency: 'USD',
        bank_country_code: 'US',
        account_number: input.accountNumber,
        account_routing_type1: 'aba',
        account_routing_value1: input.routingNumber,
        bank_account_category: 'Checking',
        ...(input.bankName ? { bank_name: input.bankName } : {}),
      },
    },
    transfer_methods: ['LOCAL'],
  };
}

/** GB / GBP / LOCAL: bank_name required, routing type must be lowercase `sort_code`. */
export function gbLocalBeneficiary(input: {
  accountName: string;
  accountNumber: string;
  sortCode: string;
  bankName: string;
  address: Address;
}): BeneficiaryPayload {
  return {
    beneficiary: {
      type: 'BANK_ACCOUNT',
      entity_type: 'COMPANY',
      address: {
        street_address: input.address.streetAddress,
        city: input.address.city,
        state: input.address.state,
        postcode: input.address.postcode,
        country_code: input.address.countryCode,
      },
      bank_details: {
        account_name: input.accountName,
        account_currency: 'GBP',
        bank_country_code: 'GB',
        account_number: input.accountNumber,
        account_routing_type1: 'sort_code',
        account_routing_value1: input.sortCode,
        bank_name: input.bankName,
        bank_account_category: 'Checking',
      },
    },
    transfer_methods: ['LOCAL'],
  };
}

/** DE / EUR / SWIFT: IBAN plus swift_code, no routing fields. */
export function euSwiftBeneficiary(input: {
  accountName: string;
  iban: string;
  swiftCode: string;
  bankName: string;
  address: Address;
}): BeneficiaryPayload {
  return {
    beneficiary: {
      type: 'BANK_ACCOUNT',
      entity_type: 'COMPANY',
      address: {
        street_address: input.address.streetAddress,
        city: input.address.city,
        state: input.address.state,
        postcode: input.address.postcode,
        country_code: input.address.countryCode,
      },
      bank_details: {
        account_name: input.accountName,
        account_currency: 'EUR',
        bank_country_code: 'DE',
        iban: input.iban,
        swift_code: input.swiftCode,
        bank_name: input.bankName,
      },
    },
    transfer_methods: ['SWIFT'],
  };
}

export async function getBeneficiarySchema(
  client: AirwallexClient,
  input: { countryCode: string; currency: string; transferMethod: 'LOCAL' | 'SWIFT'; onBehalfOf?: string },
): Promise<unknown> {
  return client.request('/api/v1/beneficiaries/schema', {
    body: {
      country_code: input.countryCode,
      currency: input.currency,
      transfer_methods: [input.transferMethod],
    },
    ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}),
  });
}

export interface BeneficiaryRecord {
  id: string;
}

/** POST /beneficiaries/create — bank details are validated here, not at pay time. */
export async function createBeneficiary(
  client: AirwallexClient,
  payload: BeneficiaryPayload,
  options: { onBehalfOf?: string } = {},
): Promise<BeneficiaryRecord> {
  const response = await client.request<unknown>('/api/v1/beneficiaries/create', {
    body: {
      beneficiary: payload.beneficiary,
      transfer_methods: payload.transfer_methods,
      ...(payload.nickname ? { nickname: payload.nickname } : {}),
    },
    ...(options.onBehalfOf ? { onBehalfOf: options.onBehalfOf } : {}),
  });
  const id = str(asRecord(response).id);
  if (!id) throw new Error('Beneficiary create response was missing an id.');
  return { id };
}
