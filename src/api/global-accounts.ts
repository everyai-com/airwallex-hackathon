import { randomUUID } from 'node:crypto';
import type { AirwallexClient } from '../core/client.js';
import { asRecord, str } from '../core/parse.js';

export interface GlobalAccount {
  id: string;
  currency: string;
  countryCode?: string;
  status?: string;
}

function toGlobalAccount(item: unknown): GlobalAccount {
  const record = asRecord(item);
  // Live list items carry the currency inside required_features; the mock puts
  // it at the top level. Read both so lookups match real accounts.
  const features = Array.isArray(record.required_features) ? record.required_features : [];
  const firstFeature = asRecord(features[0]);
  return {
    id: String(record.id ?? ''),
    currency: String(record.currency ?? firstFeature.currency ?? ''),
    ...(str(record.country_code, record.countryCode) ? { countryCode: str(record.country_code, record.countryCode) } : {}),
    ...(str(record.status) ? { status: str(record.status) } : {}),
  };
}

export async function listGlobalAccounts(
  client: AirwallexClient,
  options: { onBehalfOf?: string } = {},
): Promise<GlobalAccount[]> {
  const response = await client.request<{ items: unknown[] }>('/api/v1/global_accounts', {
    method: 'GET',
    ...(options.onBehalfOf ? { onBehalfOf: options.onBehalfOf } : {}),
  });
  return (response.items ?? []).map(toGlobalAccount);
}

export async function createGlobalAccount(
  client: AirwallexClient,
  input: { requestId: string; countryCode: string; currency: string; transferMethod?: 'LOCAL' | 'SWIFT'; onBehalfOf?: string },
): Promise<GlobalAccount> {
  const response = await client.request<unknown>('/api/v1/global_accounts/create', {
    body: {
      request_id: input.requestId,
      country_code: input.countryCode,
      required_features: [
        { currency: input.currency, transfer_method: input.transferMethod ?? 'LOCAL' },
      ],
    },
    ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}),
  });
  return toGlobalAccount(response);
}

/** Sandbox only: the deposit reports PENDING but posts to the balance immediately. */
export async function simulateDeposit(
  client: AirwallexClient,
  input: { globalAccountId: string; amount: number; payerName?: string; onBehalfOf?: string },
): Promise<{ id: string; status: string }> {
  const response = await client.request<Record<string, unknown>>(
    '/api/v1/simulation/deposit/create',
    {
      body: {
        global_account_id: input.globalAccountId,
        amount: input.amount,
        ...(input.payerName ? { payer_name: input.payerName } : {}),
      },
      ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}),
    },
  );
  return { id: String(response.id ?? ''), status: String(response.status ?? '') };
}

/**
 * Find a funded Global Account for the currency, creating one if none exists.
 * Setup helper shared by the CLI `setup` command and kit demos.
 */
export async function ensureGlobalAccount(
  client: AirwallexClient,
  currency: string,
  options: { onBehalfOf?: string } = {},
): Promise<GlobalAccount> {
  const accounts = await listGlobalAccounts(client, options);
  const existing = accounts.find((account) => account.currency === currency);
  if (existing) return existing;
  const countryForCurrency: Record<string, string> = { USD: 'US', EUR: 'DE', GBP: 'GB' };
  const countryCode = countryForCurrency[currency] ?? 'US';
  try {
    return await createGlobalAccount(client, {
      requestId: randomUUID(),
      countryCode,
      currency,
      transferMethod: 'LOCAL',
      ...(options.onBehalfOf ? { onBehalfOf: options.onBehalfOf } : {}),
    });
  } catch (error) {
    // The sandbox caps virtual accounts per currency; re-list in case the
    // account exists but was created after the first read.
    const retry = await listGlobalAccounts(client, options);
    const found = retry.find((account) => account.currency === currency);
    if (found) return found;
    throw error;
  }
}
