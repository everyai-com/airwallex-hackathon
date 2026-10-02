import {
  createCard,
  createCardholder,
  getCardLimits,
  simulateCardTransaction,
  updateCardStatus,
  waitForCardActive,
  waitForCardholderReady,
} from '../../api/issuing.js';
import type { AirwallexClient } from '../../core/client.js';
import { RequestIds } from '../../core/ids.js';
import type { Logger } from '../../core/log.js';
import { formatAmount, round2 } from '../../core/money.js';
import { PURCHASE_POLICY, chooseOption } from './policy.js';
import {
  RAW_SAAS_QUOTE,
  parseSaaSQuote,
  projectCash,
  type CashProjection,
  type ParsedOption,
} from './terms.js';

export async function runKit2(client: AirwallexClient, logger: Logger): Promise<void> {
  const ids = new RequestIds();
  client.seedMockBalances({ USD: 14_200 });

  logger.chapter('Intent-Bound Purchase Agent — annual vs monthly, enforced by card controls');
  logger.info(
    'Goal: pick the SaaS terms that protect cash, then make the card itself enforce that choice.',
  );

  const [annual, monthly] = parseSaaSQuote(RAW_SAAS_QUOTE);
  if (!annual || !monthly) throw new Error('Quote parsing failed.');

  logger.chapter('The model reads the terms; code owns the numbers');
  for (const option of [annual, monthly]) {
    logger.detail(
      option.label,
      `upfront ${formatAmount(option.upfrontUsd, 'USD')} + monthly ${formatAmount(option.monthlyUsd, 'USD')}${option.cancelable ? ' (cancelable)' : ' (locked in)'}`,
    );
  }

  const projectionInput = {
    startingCashUsd: PURCHASE_POLICY.startingCashUsd,
    weeklyOperatingCostUsd: PURCHASE_POLICY.weeklyOperatingCostUsd,
    reserveFloorUsd: PURCHASE_POLICY.reserveFloorUsd,
    horizonWeeks: PURCHASE_POLICY.horizonWeeks,
    monthlyBillingEveryWeeks: PURCHASE_POLICY.monthlyBillingEveryWeeks,
  };
  const annualProjection = projectCash(annual, projectionInput);
  const monthlyProjection = projectCash(monthly, projectionInput);

  logger.chapter(`Cash projection — floor ${formatAmount(PURCHASE_POLICY.reserveFloorUsd, 'USD')}, 12 weeks`);
  printProjection(logger, annual, annualProjection);
  printProjection(logger, monthly, monthlyProjection);

  const decision = chooseOption(
    annual,
    monthly,
    annualProjection.firstBreachWeek,
    monthlyProjection.firstBreachWeek,
  );
  logger.chapter('Decision');
  logger.decision('PLAN', decision.reason);
  logger.detail('Reconsider in', `${decision.reconsiderAfterWeeks} weeks (before renewal)`);
  logger.detail(
    'Paid over the 12-week horizon',
    `annual ${formatAmount(annualProjection.totalPaid, 'USD')} vs monthly ${formatAmount(monthlyProjection.totalPaid, 'USD')}`,
  );
  const annualTwelveMonths = annual.upfrontUsd;
  const monthlyTwelveMonths = round2(monthly.monthlyUsd * 12);
  logger.detail(
    '12-month economics',
    `annual ${formatAmount(annualTwelveMonths, 'USD')} vs monthly ${formatAmount(monthlyTwelveMonths, 'USD')} — annual is cheaper by ${formatAmount(round2(monthlyTwelveMonths - annualTwelveMonths), 'USD')} (${annual.discountVsMonthlyPercent ?? 18}%), but it breaches the floor`,
  );

  const monthlyAmount = decision.chosen.monthlyUsd > 0 ? decision.chosen.monthlyUsd : decision.chosen.upfrontUsd;
  const limits = {
    perTransaction: monthlyAmount,
    monthly: monthlyAmount,
    allTime: round2(monthlyAmount * 12),
  };

  let cardId = '';
  await logger.step('Issue a virtual card whose controls encode the monthly decision', async () => {
    const cardholder = await createCardholder(client, {
      requestId: ids.forOperation('cardholder'),
      email: 'finance@acme-demo.example',
      firstName: 'Dana',
      lastName: 'Reed',
      dateOfBirth: '1991-04-12',
      address: {
        line1: '1 Market Street',
        city: 'San Francisco',
        state: 'CA',
        postcode: '94105',
        country: 'US',
      },
    });
    const ready = await waitForCardholderReady(client, cardholder.cardholderId);
    logger.detail('Cardholder', `${ready.cardholderId} (${ready.status})`);

    const card = await createCard(client, {
      requestId: ids.forOperation('card'),
      cardholderId: ready.cardholderId,
      createdBy: 'Dana Reed',
      limitCurrency: 'USD',
      limits: [
        { interval: 'PER_TRANSACTION', amount: limits.perTransaction },
        { interval: 'MONTHLY', amount: limits.monthly },
        { interval: 'ALL_TIME', amount: limits.allTime },
      ],
      allowedCurrencies: PURCHASE_POLICY.cardLimits.allowedCurrencies,
      allowedMerchantCategories: PURCHASE_POLICY.cardLimits.allowedMerchantCategories,
      nickName: 'Lowly Software — monthly plan',
      purpose: 'SUBSCRIPTIONS',
    });
    const active = await waitForCardActive(client, card.cardId);
    cardId = active.cardId;
    logger.detail('Card', `${active.cardId} ${active.cardStatus} ${active.cardNumber ?? ''}`);
    logger.detail(
      'Controls',
      `PER_TRANSACTION USD ${limits.perTransaction} | MONTHLY USD ${limits.monthly} | ALL_TIME USD ${limits.allTime}`,
    );
    logger.detail(
      'Allowed',
      `currencies ${PURCHASE_POLICY.cardLimits.allowedCurrencies.join(',')} | MCC ${PURCHASE_POLICY.cardLimits.allowedMerchantCategories.join(',')}`,
    );
  });

  logger.chapter('Simulated authorizations — the controls decide, not the prompt');

  await logger.step('Try USD 1,201 — one dollar over the inclusive limit', async () => {
    const transaction = await simulateCardTransaction(client, {
      cardId,
      amount: 1_201,
      currency: 'USD',
      merchantCategoryCode: '5734',
      merchantInfo: 'Lowly Software Inc.',
    });
    logger.detail('Result', `${transaction.processResult} — ${transaction.failureReason}`);
    logger.decision(
      'DECLINE',
      `LIMIT_EXCEEDED maps to the PER_TRANSACTION control of USD ${limits.perTransaction}; per-transaction limits are inclusive, so 1,200.00 would clear.`,
    );
  });

  await logger.step('Try an out-of-policy merchant category (7995 gambling)', async () => {
    const transaction = await simulateCardTransaction(client, {
      cardId,
      amount: 1_200,
      currency: 'USD',
      merchantCategoryCode: '7995',
      merchantInfo: 'Lucky Spins Casino',
    });
    logger.detail('Result', `${transaction.processResult} — ${transaction.failureReason}`);
    logger.decision(
      'DECLINE',
      'MERCHANT_CATEGORY_NOT_ALLOWED maps to the card allowlist; the intent is enforced by controls a prompt cannot override.',
    );
  });

  await logger.step('Charge exactly USD 1,200 to the allowed vendor — single-phase clear', async () => {
    const transaction = await simulateCardTransaction(client, {
      cardId,
      amount: 1_200,
      currency: 'USD',
      merchantCategoryCode: '5734',
      merchantInfo: 'Lowly Software Inc.',
      singlePhase: true,
    });
    logger.detail(
      'Result',
      `${transaction.processResult} — transaction_type ${transaction.type} / subtype ${transaction.subtype}`,
    );
    logger.decision(
      'ACCEPT',
      'Treat transaction_type CLEARING as accepted; the guide warns not to wait for a status literally named APPROVED.',
    );
  });

  await logger.step('Read the remaining limits', async () => {
    const remaining = await getCardLimits(client, cardId);
    for (const limit of remaining) {
      logger.detail(`Remaining ${limit.interval}`, `${limit.remaining} of ${limit.amount}`);
    }
  });

  await logger.step('Revoke the agent\'s own authority: freeze the card', async () => {
    const card = await updateCardStatus(client, cardId, 'INACTIVE');
    logger.detail('Card status', card.cardStatus ?? 'INACTIVE');
    const blocked = await simulateCardTransaction(client, {
      cardId,
      amount: 1_200,
      currency: 'USD',
      merchantCategoryCode: '5734',
      merchantInfo: 'Lowly Software Inc.',
    });
    logger.detail('Post-freeze attempt', `${blocked.processResult} — ${blocked.failureReason}`);
    logger.decision('STOP', 'CARD_INACTIVE: the agent can revoke its own spending authority mid-run.');
  });

  logger.chapter('Outcome');
  logger.info(
    `Monthly plan chosen and enforced: PER_TRANSACTION USD ${limits.perTransaction}, MONTHLY USD ${limits.monthly}, ALL_TIME USD ${limits.allTime}.`,
  );
  logger.detail(
    'Why not annual',
    `Annual costs ${formatAmount(annualProjection.totalPaid, 'USD')} over 12 weeks but breaches the reserve floor in week ${annualProjection.firstBreachWeek}.`,
  );
}

function printProjection(logger: Logger, option: ParsedOption, projection: CashProjection): void {
  const breach =
    projection.firstBreachWeek === undefined
      ? 'never breaches the floor'
      : `below floor from week ${projection.firstBreachWeek}`;
  logger.detail(option.label, `${breach}; min cash ${formatAmount(projection.minCash, 'USD')}`);
  const samples = projection.weeks.filter((point) => [0, 4, 7, 8, 12].includes(point.week));
  for (const point of samples) {
    logger.detail(
      `  week ${point.week}`,
      `${formatAmount(point.cash, 'USD')}${point.belowFloor ? '  <-- below floor' : ''}`,
    );
  }
}
