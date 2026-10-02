import { getBalances, formatBalances } from './api/balances.js';
import { ensureGlobalAccount, listGlobalAccounts, simulateDeposit } from './api/global-accounts.js';
import type { AirwallexClient } from './core/client.js';
import type { Logger } from './core/log.js';

export interface SetupOptions {
  depositUsd?: number;
  skipDeposit?: boolean;
}

const DEFAULT_DEPOSIT_USD = 13_000;

/**
 * Sandbox prep: find or create a USD Global Account, simulate a deposit, then
 * read balances back. There is no top-up button in the sandbox — deposits are
 * simulated and post immediately even though the response says PENDING.
 */
export async function runSetup(
  client: AirwallexClient,
  logger: Logger,
  options: SetupOptions = {},
): Promise<void> {
  logger.chapter('Sandbox setup');

  const accounts = await listGlobalAccounts(client);
  logger.detail(
    'Global accounts',
    accounts.length === 0
      ? 'none found'
      : accounts.map((account) => `${account.id} (${account.currency})`).join(', '),
  );

  const account = await ensureGlobalAccount(client, 'USD');
  logger.detail('USD account', `${account.id} (${account.status ?? 'ready'})`);

  const before = await getBalances(client);
  logger.detail('Balances before', before.length ? formatBalances(before) : 'empty wallet');

  if (!options.skipDeposit) {
    const amount = options.depositUsd ?? DEFAULT_DEPOSIT_USD;
    const deposit = await simulateDeposit(client, {
      globalAccountId: account.id,
      amount,
      payerName: 'Seed funding',
    });
    logger.detail(
      'Deposit simulated',
      `USD ${amount} — response status ${deposit.status}, balance posts immediately`,
    );
    logger.info(
      'Suggested for the Kit 1 demo: ~USD 13,000 total. Deposit more only if you want a different story.',
    );
  }

  const after = await getBalances(client);
  logger.detail('Balances after', after.length ? formatBalances(after) : 'empty wallet');
  logger.info('Setup complete. Run `npm run kit1` next.');
}
