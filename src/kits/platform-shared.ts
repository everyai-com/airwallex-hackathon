import {
  activateWhenReady,
  createConnectedAccount,
  getConnectedAccount,
  submitConnectedAccount,
  updateConnectedAccount,
} from '../api/accounts.js';
import { ensureGlobalAccount, simulateDeposit } from '../api/global-accounts.js';
import type { AirwallexClient } from '../core/client.js';
import { newRequestId } from '../core/ids.js';
import { round2 } from '../core/money.js';

export const PLATFORM_ON_BEHALF_NOTE =
  'MCP authenticates as the platform and cannot send x-on-behalf-of, so every customer-scoped call here is REST.';

/**
 * Create -> update -> submit -> activate a connected account.
 * The documented schema requires business_details.business_name,
 * business_address/registration_address (address_line1/suburb naming), person
 * entries with first_name/last_name/roles, and business_identifiers with an EIN
 * before submit; without the EIN, on-behalf transfers fail later (001 when the
 * payer is omitted, 048 when supplied).
 */
export async function openConnectedAccount(
  client: AirwallexClient,
  input: { businessName: string; ein: string; contactName: string; city: string; countryCode: string },
): Promise<string> {
  const [firstName, lastName] = input.contactName.split(' ');
  const businessAddress = {
    // Account addresses use address_line1/suburb, not beneficiary field names.
    country_code: input.countryCode,
    city: input.city,
    address_line1: '1 Sandbox Plaza',
    suburb: input.city,
    state: 'NY',
    postcode: '10001',
  };
  const contactEmail = `${input.contactName.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`;
  const accountDetails = {
    business_details: {
      business_name: input.businessName,
      // Live validates this enum (field_required without it) even though the
      // docs' minimal sample omits it; COMPANY is the closest generic fit.
      business_structure: 'COMPANY',
      // Live validates this at submit time (400 field_required, 1..500 chars).
      description_of_goods_or_services: 'Business and financial software services.',
      // Live validates the code against GET /api/v1/reference/industry_categories;
      // ICCV3_0006XX is "Software development" from the Digital and tech group.
      industry_category_code: 'ICCV3_0006XX',
      // Live validates supported 2-letter ISO 3166-2 codes at submit time.
      operating_country: ['US'],
      account_usage: {
        product_reference: ['MAKE_TRANSFERS', 'RECEIVE_TRANSFERS', 'CONVERT_FUNDS'],
        estimated_monthly_revenue: { amount: '100000', currency: 'USD' },
      },
      business_address: businessAddress,
      registration_address: businessAddress,
      business_identifiers: [{ type: 'EIN', country_code: 'US', number: input.ein }],
    },
    business_person_details: [
      {
        first_name: firstName ?? 'Sandbox',
        last_name: lastName ?? 'Owner',
        email: contactEmail,
        // US submit requirements: all three roles, DOB, residential address,
        // nationality, and a primary identification document.
        roles: ['AUTHORISED_PERSON', 'BENEFICIAL_OWNER', 'DIRECTOR'],
        residential_address: businessAddress,
        nationality: input.countryCode,
        date_of_birth: '1990-01-01',
        identifications: {
          primary: {
            identification_type: 'TAX_ID',
            issuing_country_code: input.countryCode,
            tax_id: { number: '123456789', type: 'SSN' },
          },
        },
      },
    ],
  };

  const created = await createConnectedAccount(client, {
    requestId: newRequestId(),
    accountDetails,
    primaryContactEmail: contactEmail,
  });
  await updateConnectedAccount(client, created.id, accountDetails);
  await submitConnectedAccount(client, created.id);
  const active = await activateWhenReady(client, created.id);
  return active.id;
}

export async function confirmAccountActive(
  client: AirwallexClient,
  accountId: string,
): Promise<string> {
  const account = await getConnectedAccount(client, accountId);
  return account.status;
}

/** Fund a customer wallet with a simulated deposit, scoped to the customer. */
export async function fundCustomerWallet(
  client: AirwallexClient,
  accountId: string,
  amount: number,
  currency = 'USD',
): Promise<number> {
  const globalAccount = await ensureGlobalAccount(client, currency, { onBehalfOf: accountId });
  await simulateDeposit(client, {
    globalAccountId: globalAccount.id,
    amount,
    payerName: 'Customer funding',
    onBehalfOf: accountId,
  });
  return round2(amount);
}
