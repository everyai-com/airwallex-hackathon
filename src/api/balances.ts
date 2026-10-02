import type { AirwallexClient } from '../core/client.js';
import { asRecord, num, str } from '../core/parse.js';

export interface BalanceLine {
  currency: string;
  available: number;
}

/** GET /balances/current. Amounts are major units. */
export async function getBalances(
  client: AirwallexClient,
  options: { onBehalfOf?: string } = {},
): Promise<BalanceLine[]> {
  const response = await client.request<{ items: unknown[] }>('/api/v1/balances/current', {
    method: 'GET',
    ...(options.onBehalfOf ? { onBehalfOf: options.onBehalfOf } : {}),
  });
  return (response.items ?? [])
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

export function formatBalances(lines: BalanceLine[]): string {
  return lines.map((line) => `${line.currency} ${line.available.toFixed(2)}`).join(' | ');
}
