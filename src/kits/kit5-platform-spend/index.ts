import { getBalances, balanceOf } from '../../api/balances.js';
import {
  createCard,
  createCardholder,
  simulateCardTransaction,
  waitForCardActive,
  waitForCardholderReady,
} from '../../api/issuing.js';
import { collectCharge, connectedAccountTransfer, PLATFORM_REASONS } from '../../api/platform.js';
import type { AirwallexClient } from '../../core/client.js';
import type { Logger } from '../../core/log.js';
import { round2 } from '../../core/money.js';
import {
  PLATFORM_ON_BEHALF_NOTE,
  fundCustomerWallet,
  openConnectedAccount,
} from '../platform-shared.js';
import { SPEND_POLICY, planBridges, type BridgeRequest } from './policy.js';

export async function runKit5(client: AirwallexClient, logger: Logger): Promise<void> {
  const ids = client.requestIds();
  client.seedMockBalances({ USD: 14_200 });

  logger.chapter('Platform Spend Controller — cards for customers, rationed bridge capital');
  logger.info(
    `Goal: let customer spend draw on their own wallets, bridge only what the platform can afford, and collect fees. ${PLATFORM_ON_BEHALF_NOTE}`,
  );

  const customers = [
    { key: 'nova', name: 'Nova Retail LLC', ein: '88-1234501', contact: 'Nora Vance' },
    { key: 'harbor', name: 'Harbor Fitness LLC', ein: '88-1234502', contact: 'Hugo Marsh' },
    { key: 'juniper', name: 'Juniper Bakery LLC', ein: '88-1234503', contact: 'June Park' },
  ];

  const accountIds = new Map<string, string>();
  await logger.step('Create and activate three connected accounts', async () => {
    for (const customer of customers) {
      const accountId = await openConnectedAccount(client, {
        businessName: customer.name,
        ein: customer.ein,
        contactName: customer.contact,
        city: 'New York',
        countryCode: 'US',
      });
      accountIds.set(customer.key, accountId);
      logger.detail(customer.name, `${accountId} ACTIVE`);
    }
  });

  await logger.step("Fund each customer wallet (their money, not the platform's)", async () => {
    await fundCustomerWallet(client, accountIds.get('nova')!, 6_000);
    await fundCustomerWallet(client, accountIds.get('harbor')!, 800);
    await fundCustomerWallet(client, accountIds.get('juniper')!, 1_000);
    for (const customer of customers) {
      const balances = await getBalances(client, { onBehalfOf: accountIds.get(customer.key)! });
      logger.detail(
        customer.name,
        balances.map((line) => `${line.currency} ${line.available}`).join(' | ') || 'USD 0',
      );
    }
  });

  const cardIds = new Map<string, string>();
  await logger.step('Issue cards on behalf of two customers', async () => {
    for (const key of ['nova', 'juniper']) {
      const customer = customers.find((item) => item.key === key)!;
      const accountId = accountIds.get(key)!;
      const [firstName, lastName] = customer.contact.split(' ');
      const cardholder = await createCardholder(client, {
        // Fresh per run: live re-runs create new cardholders and cards.
        requestId: ids.fresh(),
        // The live sandbox rejects a reused cardholder email, so tag each run.
        email: `${key}.${Date.now().toString(36)}@example.com`,
        firstName: firstName ?? 'Sandbox',
        lastName: lastName ?? 'Owner',
        dateOfBirth: '1988-06-15',
        address: {
          line1: '1 Sandbox Plaza',
          city: 'New York',
          state: 'NY',
          postcode: '10001',
          country: 'US',
        },
        onBehalfOf: accountId,
      });
      const ready = await waitForCardholderReady(client, cardholder.cardholderId, 6, {
        onBehalfOf: accountId,
      });
      const card = await createCard(client, {
        requestId: ids.fresh(),
        cardholderId: ready.cardholderId,
        createdBy: customer.contact,
        limitCurrency: 'USD',
        limits: [
          { interval: 'PER_TRANSACTION', amount: 2_000 },
          { interval: 'MONTHLY', amount: 2_000 },
        ],
        allowedCurrencies: ['USD'],
        allowedMerchantCategories: ['5734', '7372', '5942'],
        nickName: `${customer.name} corporate card`,
        onBehalfOf: accountId,
      });
      await waitForCardActive(client, card.cardId, 6, { onBehalfOf: accountId });
      cardIds.set(key, card.cardId);
      logger.detail(customer.name, `${card.cardId} ACTIVE — PER_TRANSACTION/MONTHLY USD 2,000`);
    }
  });

  logger.chapter('Simulated customer spend — their wallets fund it');
  const novaAccount = accountIds.get('nova')!;
  await logger.step("Nova spends USD 1,800 on software — clears from Nova's wallet", async () => {
    const transaction = await simulateCardTransaction(client, {
      cardId: cardIds.get('nova')!,
      amount: 1_800,
      currency: 'USD',
      merchantCategoryCode: '5734',
      merchantInfo: 'Cloud Tools Inc.',
      singlePhase: true,
      onBehalfOf: novaAccount,
    });
    logger.detail('Result', `${transaction.processResult} — ${transaction.type ?? ''}`);
    const balances = await getBalances(client, { onBehalfOf: novaAccount });
    logger.detail('Nova wallet', balances.map((line) => `USD ${line.available}`).join(' | '));
  });

  await logger.step('Nova tries USD 2,500 — over the card limit, declined', async () => {
    const transaction = await simulateCardTransaction(client, {
      cardId: cardIds.get('nova')!,
      amount: 2_500,
      currency: 'USD',
      merchantCategoryCode: '5734',
      merchantInfo: 'Cloud Tools Inc.',
      onBehalfOf: novaAccount,
    });
    logger.detail('Result', `${transaction.processResult} — ${transaction.failureReason}`);
  });

  const juniperAccount = accountIds.get('juniper')!;
  await logger.step('Juniper tries USD 1,500 with only USD 1,000 funded', async () => {
    const transaction = await simulateCardTransaction(client, {
      cardId: cardIds.get('juniper')!,
      amount: 1_500,
      currency: 'USD',
      merchantCategoryCode: '7372',
      merchantInfo: 'Data Services Co.',
      onBehalfOf: juniperAccount,
    });
    logger.detail('Result', `${transaction.processResult} — ${transaction.failureReason}`);
    logger.decision(
      'ORDER',
      'The limit check passes at 1,500 (limit 2,000); the wallet is checked after the controls. Fund the customer enough to reach the limit check, or insufficient funds is what you see.',
    );
  });

  logger.chapter('Bridge decision — two customers short today, capital for one');
  const platformBalance = balanceOf(await getBalances(client), 'USD');
  logger.detail('Platform wallet', `USD ${platformBalance}`);
  logger.detail('Reserve floor', `USD ${SPEND_POLICY.reserveFloorUsd}`);

  const requests: BridgeRequest[] = [
    {
      customerId: accountIds.get('harbor')!,
      customerName: 'Harbor Fitness LLC (payment due today)',
      shortfallUsd: 2_200,
      dueInHours: 4,
    },
    {
      customerId: juniperAccount,
      customerName: 'Juniper Bakery LLC (payment due today)',
      shortfallUsd: 1_500,
      dueInHours: 6,
    },
  ];
  const plan = planBridges(requests, platformBalance);
  for (const request of plan.approved) {
    logger.decision('BRIDGE', `${request.customerName} — advance USD ${request.shortfallUsd}`);
  }
  for (const declined of plan.declined) {
    logger.decision('DECLINE BRIDGE', `${declined.request.customerName} — ${declined.reason}`);
  }

  for (const request of plan.approved) {
    await logger.step(`Advance the shortfall to ${request.customerName}`, async () => {
      const move = await connectedAccountTransfer(client, {
        requestId: ids.forOperation(`bridge-${request.customerId}`),
        amount: request.shortfallUsd,
        currency: 'USD',
        destination: request.customerId,
        reason: PLATFORM_REASONS.fee,
        reference: 'bridge advance — deposit expected today',
      });
      logger.detail('Transfer', `${move.id} ${move.status} USD ${request.shortfallUsd}`);
    });
  }

  const harborAccountId = accountIds.get('harbor')!;
  await logger.step("Harbor's deposit lands late — repay the bridge and collect the fee", async () => {
    await fundCustomerWallet(client, harborAccountId, 3_500);
    const repayment = await collectCharge(client, {
      requestId: ids.forOperation('bridge-recovery'),
      amount: 2_200,
      currency: 'USD',
      source: harborAccountId,
      reason: PLATFORM_REASONS.fee,
      reference: 'bridge recovery',
    });
    const fee = await collectCharge(client, {
      requestId: ids.forOperation('monthly-fee'),
      amount: 49,
      currency: 'USD',
      source: harborAccountId,
      reason: PLATFORM_REASONS.fee,
      reference: 'platform monthly plan',
    });
    logger.detail('Bridge recovered', `${repayment.id} ${repayment.status}`);
    logger.detail('Monthly fee', `${fee.id} ${fee.status} USD 49`);
  });

  const finalPlatform = balanceOf(await getBalances(client), 'USD');
  const bridged = plan.approved.map((request) => request.customerName.split(' (')[0]).join(', ');
  const declined = plan.declined.map((entry) => entry.request.customerName.split(' (')[0]).join(', ');
  logger.chapter('Outcome');
  logger.detail('Platform wallet', `USD ${round2(finalPlatform)}`);
  logger.detail(
    'Isolation',
    "customer spend hit customer wallets, never the platform's money",
  );
  logger.detail(
    'Bridges',
    bridged
      ? `${bridged} advanced and recovered${declined ? `; ${declined} declined — capacity ran out against the reserve floor` : ''}`
      : `none advanced; all requests declined against the reserve floor`,
  );
}
