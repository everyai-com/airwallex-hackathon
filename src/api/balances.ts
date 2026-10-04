import type { AirwallexClient } from '../core/client.js';
import { asRecord, num, str } from '../core/parse.js';

export interface BalanceLine {
  currency: string;
  available: number;
}

/** GET /balances/current. Amounts are major units. Live returns a bare array; the mock wraps it in { items }. */
export async function getBalances(
  client: AirwallexClient,
  options: { onBehalfOf?: string } = {},
): Promise<BalanceLine[]> {
  const response = await client.request<unknown>('/api/v1/balances/current', {
    method: 'GET',
    ...(options.onBehalfOf ? { onBehalfOf: options.onBehalfOf } : {}),
  });
  const items = Array.isArray(response) ? response : asRecord(response).items;
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const record = asRecord(item);
      return {
        currency: String(record.currency ?? ''),
        available: num(
          record.available_amount,
          record.available,
          record.balance,
          record.total_amount,
        ) ?? 0,
      };
    })
    .filter((line) => line.currency !== '');
}

export function balanceOf(lines: BalanceLine[], currency: string): number {
  return lines.find((line) => line.currency === currency)?.available ?? 0;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until a currency is funded. Live FX conversions and deposits post a few
 * seconds after they report success, so a payout that depends on them should
 * poll instead of racing the balance.
 */
export async function waitForAvailableBalance(
  client: AirwallexClient,
  input: { currency: string; amount: number; attempts?: number; delayMs?: number; onBehalfOf?: string },
): Promise<BalanceLine[]> {
  const attempts = input.attempts ?? 8;
  let lines = await getBalances(client, input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {});
  for (
    let attempt = 0;
    attempt < attempts && balanceOf(lines, input.currency) + 0.005 < input.amount;
    attempt += 1
  ) {
    await sleep(input.delayMs ?? 1_000);
    lines = await getBalances(client, input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {});
  }
  return lines;
}

export function formatBalances(lines: BalanceLine[]): string {
  return lines.map((line) => `${line.currency} ${line.available.toFixed(2)}`).join(' | ');
}
