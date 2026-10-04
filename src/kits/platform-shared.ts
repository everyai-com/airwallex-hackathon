import {
  activateAndConfirm,
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
      business_address: businessAddress,
      registration_address: businessAddress,
      business_identifiers: [{ type: 'EIN', country_code: 'US', number: input.ein }],
    },
    business_person_details: [
      {
        first_name: firstName ?? 'Sandbox',
        last_name: lastName ?? 'Owner',
        email: contactEmail,
        roles: ['AUTHORISED_PERSON'],
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
  const active = await activateAndConfirm(client, created.id);
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
