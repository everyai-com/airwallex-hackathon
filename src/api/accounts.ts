import type { AirwallexClient } from '../core/client.js';
import { isAirwallexError } from '../core/errors.js';
import { asRecord } from '../core/parse.js';

export interface ConnectedAccount {
  id: string;
  status: string;
}

function toAccount(item: unknown): ConnectedAccount {
  const record = asRecord(item);
  return { id: String(record.id ?? ''), status: String(record.status ?? '') };
}

/**
 * Connected-account lifecycle (platform kits 5-8):
 *   create (CREATED) -> update -> submit -> simulate ACTIVE -> confirm.
 * Airwallex does not enable connected accounts by default; request access first.
 */
export async function createConnectedAccount(
  client: AirwallexClient,
  input: {
    requestId: string;
    accountDetails: Record<string, unknown>;
    /** Live requires a top-level primary_contact with at least an email. */
    primaryContactEmail: string;
    customerAgreements?: { agreedToDataUsage?: boolean; agreedToTermsAndConditions?: boolean };
  },
): Promise<ConnectedAccount> {
  const response = await client.request<unknown>('/api/v1/accounts/create', {
    body: {
      request_id: input.requestId,
      account_details: input.accountDetails,
      customer_agreements: {
        agreed_to_data_usage: input.customerAgreements?.agreedToDataUsage ?? true,
        agreed_to_terms_and_conditions:
          input.customerAgreements?.agreedToTermsAndConditions ?? true,
      },
      primary_contact: { email: input.primaryContactEmail },
    },
  });
  return toAccount(response);
}

export async function updateConnectedAccount(
  client: AirwallexClient,
  accountId: string,
  accountDetails: Record<string, unknown>,
): Promise<ConnectedAccount> {
  const response = await client.request<unknown>(`/api/v1/accounts/${accountId}/update`, {
    body: { account_details: accountDetails },
  });
  return toAccount(response);
}

export async function submitConnectedAccount(
  client: AirwallexClient,
  accountId: string,
): Promise<ConnectedAccount> {
  const response = await client.request<unknown>(`/api/v1/accounts/${accountId}/submit`, {
    body: {},
  });
  return toAccount(response);
}

/** Sandbox only: force the account to ACTIVE. Wait ~2s after submit in live runs. */
export async function activateConnectedAccount(
  client: AirwallexClient,
  accountId: string,
): Promise<ConnectedAccount> {
  const response = await client.request<unknown>(
    `/api/v1/simulation/accounts/${accountId}/update_status`,
    { body: { next_status: 'ACTIVE', force: true } },
  );
  return toAccount(response);
}

export async function getConnectedAccount(
  client: AirwallexClient,
  accountId: string,
): Promise<ConnectedAccount> {
  const response = await client.request<unknown>(`/api/v1/accounts/${accountId}`, {
    method: 'GET',
  });
  return toAccount(response);
}

/**
 * Activate with retries. Live reads SUBMITTED immediately after submit but the
 * simulation endpoint still refuses for a short window (observed ~2 minutes):
 * "Account needs to be submitted for review before using this endpoint".
 * Mock transitions synchronously, so the first attempt succeeds there.
 */
export async function activateWhenReady(
  client: AirwallexClient,
  accountId: string,
  attempts = 10,
  delayMs = 18_000,
): Promise<ConnectedAccount> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await activateAndConfirm(client, accountId);
    } catch (error) {
      lastError = error;
      if (!isAirwallexError(error) || error.status !== 400) throw error;
    }
    await sleep(delayMs);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Activate then confirm. A newly activated account may need a few minutes before FX works. */
export async function activateAndConfirm(
  client: AirwallexClient,
  accountId: string,
  attempts = 6,
): Promise<ConnectedAccount> {
  await activateConnectedAccount(client, accountId);
  let account = await getConnectedAccount(client, accountId);
  for (let attempt = 0; attempt < attempts && account.status !== 'ACTIVE'; attempt += 1) {
    await sleep(1_000);
    account = await getConnectedAccount(client, accountId);
  }
  return account;
}
