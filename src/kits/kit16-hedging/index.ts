import { balanceOf, getBalances, waitForAvailableBalance } from '../../api/balances.js';
import { createFxConversion, createFxQuote, getFxRate } from '../../api/fx.js';
import { ensureGlobalAccount, simulateDeposit } from '../../api/global-accounts.js';
import { createAnalyst, type ForecastAssessment } from '../../core/analyst.js';
import type { AirwallexClient } from '../../core/client.js';
import type { Logger } from '../../core/log.js';
import { formatAmount, round2 } from '../../core/money.js';
import {
  HEDGE_OBLIGATIONS,
  HEDGE_RESERVE_FLOOR_USD,
  HEDGE_STARTING_BALANCES,
  STEINMETZ_PULL_FORWARD,
  EUR_MARKET_NOTE,
  GBP_MARKET_NOTE,
  type HedgeObligation,
} from './scenario.js';
import {
  hedgeRatio,
  netExposure,
  obligationsByCurrency,
  planHedges,
  usdHeadroom,
  type HedgeAction,
} from './policy.js';

export interface Kit16Options {
  /** Force the deterministic analyst (tests, reproducible demos). */
  forceHeuristicAnalyst?: boolean;
}

export interface HedgeConversion {
  pair: string;
  sellCurrency: string;
  buyCurrency: string;
  sellAmount: number;
  buyAmount: number;
  rate: number;
  conversionId: string;
  quoteId: string;
}

export interface Kit16Result {
  actions: HedgeAction[];
  revisedActions: HedgeAction[];
  conversions: HedgeConversion[];
  exposures: Record<string, number>;
  wallet: Record<string, number>;
}

/**
 * FX Exposure Hedger — the treasury loop for currency risk: read the market
 * notes, hedge foreign surpluses to the view, cover every shortfall whatever
 * the view says, then re-hedge when an obligation moves.
 */
export async function runKit16(
  client: AirwallexClient,
  logger: Logger,
  options: Kit16Options = {},
): Promise<Kit16Result> {
  const ids = client.requestIds();
  const analyst = createAnalyst({
    ...(options.forceHeuristicAnalyst ? { forceHeuristic: true } : {}),
    ...(client.config.anthropicApiKey ? { apiKey: client.config.anthropicApiKey } : {}),
    model: client.config.anthropicModel,
  });

  client.seedMockBalances({ ...HEDGE_STARTING_BALANCES });
  if (!client.isMock) {
    // Fund up to the scenario starts; above-scenario wallets just work —
    // the policy hedges relative exposure, not absolute levels.
    await logger.step('Sandbox setup — fund the wallet to the scenario starts', async () => {
      const opening = await getBalances(client);
      for (const currency of ['USD', 'EUR', 'GBP'] as const) {
        const target = HEDGE_STARTING_BALANCES[currency];
        const current = balanceOf(opening, currency);
        if (current + 0.01 < target) {
          const account = await ensureGlobalAccount(client, currency);
          await simulateDeposit(client, {
            globalAccountId: account.id,
            amount: round2(target - current),
            payerName: 'Hedge scenario funding',
          });
          logger.detail(`${currency} funded`, `${round2(target - current)} to reach ${target}`);
        }
      }
    });
  }

  logger.chapter('FX Exposure Hedger — observe → decide → act → reconcile');
  logger.info(
    `Goal: keep every foreign obligation covered and the USD reserve above ${HEDGE_RESERVE_FLOOR_USD} — hedge surpluses to the market view, buy shortfalls regardless of it.`,
  );
  logger.detail('Analyst', `${analyst.kind} — reads the market notes into direction and confidence; ratios and amounts are code`);

  const readBalances = async (): Promise<Record<string, number>> => {
    const lines = await getBalances(client);
    return {
      USD: balanceOf(lines, 'USD'),
      EUR: balanceOf(lines, 'EUR'),
      GBP: balanceOf(lines, 'GBP'),
    };
  };

  const conversions: HedgeConversion[] = [];
  const quotesBooked = new Set<string>();

  const execute = async (action: HedgeAction): Promise<void> => {
    if (action.side === 'HOLD') return;
    const sellCurrency = action.side === 'SELL_SURPLUS' ? action.currency : 'USD';
    const buyCurrency = action.side === 'SELL_SURPLUS' ? 'USD' : action.currency;
    // Fresh ids per run: each run hedges from live balances, so a re-run
    // re-plans from the new state instead of replaying stale conversions.
    const quote = await createFxQuote(client, {
      requestId: ids.fresh(),
      sellCurrency,
      buyCurrency,
      ...(action.side === 'SELL_SURPLUS'
        ? { sellAmount: action.amount }
        : { buyAmount: action.amount }),
    });
    if (quotesBooked.has(quote.id)) throw new Error(`Quote ${quote.id} booked twice.`);
    quotesBooked.add(quote.id);
    const conversion = await createFxConversion(client, {
      requestId: ids.fresh(),
      sellCurrency,
      buyCurrency,
      ...(action.side === 'SELL_SURPLUS'
        ? { sellAmount: action.amount }
        : { buyAmount: action.amount }),
      quoteId: quote.id,
    });
    conversions.push({
      pair: `${sellCurrency}->${buyCurrency}`,
      sellCurrency,
      buyCurrency,
      sellAmount: conversion.sellAmount,
      buyAmount: conversion.buyAmount,
      rate: conversion.rate,
      conversionId: conversion.conversionId,
      quoteId: quote.id,
    });
    logger.detail(
      'Converted',
      `${formatAmount(conversion.sellAmount, sellCurrency)} -> ${formatAmount(conversion.buyAmount, buyCurrency)} at ${conversion.rate} (quote ${quote.id} booked once)`,
    );
  };

  logger.chapter('Observe — balances, obligations, rates');
  const opening = await readBalances();
  logger.detail(
    'Wallet',
    Object.entries(opening)
      .map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`)
      .join(' | '),
  );
  for (const entry of HEDGE_OBLIGATIONS) {
    logger.detail(
      entry.counterparty,
      `${formatAmount(entry.amount, entry.currency)} due in ${entry.dueInDays}d`,
    );
  }
  const eurRate = await getFxRate(client, { sellCurrency: 'USD', buyCurrency: 'EUR' });
  const gbpRate = await getFxRate(client, { sellCurrency: 'USD', buyCurrency: 'GBP' });
  logger.detail('Indicative rates', `USD/EUR ${eurRate} · USD/GBP ${gbpRate}`);

  logger.chapter('The analyst reads the market notes');
  const readView = async (currency: 'EUR' | 'GBP', note: string): Promise<ForecastAssessment> => {
    const assessment = await analyst.assessForecast({
      forecast: {
        payer: `${currency}/USD market`,
        amount: currency === 'EUR' ? eurRate : gbpRate,
        currency,
        expectedInHours: 24 * 30,
        confidence: 0.86,
        evidence: ['Treasury baseline: rates steady into month-end'],
      },
      newInformation: note,
      source: `${currency} desk note`,
    });
    logger.detail(
      `${currency} view`,
      `${assessment.direction} — confidence ${assessment.confidence} → hedge ratio ${hedgeRatio(assessment)}`,
    );
    for (const quote of assessment.citedEvidence) logger.detail('Cited', `"${quote}"`);
    return assessment;
  };
  const eurView = await readView('EUR', EUR_MARKET_NOTE);
  const gbpView = await readView('GBP', GBP_MARKET_NOTE);

  logger.chapter('Decide and act — hedge the surpluses, buy the shortfalls');
  const headroom = usdHeadroom(opening, HEDGE_OBLIGATIONS, HEDGE_RESERVE_FLOOR_USD);
  logger.detail('USD headroom', `${headroom} above the floor and USD obligations`);
  if (headroom <= 0) throw new Error('No USD headroom above the reserve floor — cannot fund hedge buys.');
  const actions = planHedges(opening, HEDGE_OBLIGATIONS, { EUR: eurView, GBP: gbpView });
  for (const action of actions) {
    await logger.step(`${action.currency} — ${action.side}`, async () => {
      logger.decision(action.side, action.reason);
      await execute(action);
    });
  }

  logger.chapter('New information — Steinmetz pulls EUR 2,000 forward');
  logger.decision('PULL FORWARD', STEINMETZ_PULL_FORWARD.reason);
  const revisedObligations: HedgeObligation[] = HEDGE_OBLIGATIONS.map((entry) =>
    entry.id === STEINMETZ_PULL_FORWARD.obligationId
      ? { ...entry, amount: round2(entry.amount + STEINMETZ_PULL_FORWARD.amount), dueInDays: 1 }
      : entry,
  );
  const midBalances = await readBalances();
  const revisedActions = planHedges(midBalances, revisedObligations, { EUR: eurView, GBP: gbpView });
  for (const action of revisedActions) {
    await logger.step(`${action.currency} — ${action.side} (revised)`, async () => {
      logger.decision(action.side, action.reason);
      await execute(action);
    });
  }

  logger.chapter('Outcome');
  const owed = obligationsByCurrency(revisedObligations);
  // Live conversions post seconds after they report success — wait for each
  // currency the plan touched before proving coverage.
  for (const currency of ['EUR', 'GBP'] as const) {
    await waitForAvailableBalance(client, { currency, amount: owed[currency] ?? 0, attempts: 20 });
  }
  const closing = await readBalances();
  const exposures = netExposure(closing, revisedObligations);
  for (const currency of ['EUR', 'GBP'] as const) {
    if ((exposures[currency] ?? 0) + 0.005 < 0) {
      throw new Error(`${currency} exposure ${exposures[currency]} is short of obligations.`);
    }
  }
  if (closing.USD! + 0.005 < HEDGE_RESERVE_FLOOR_USD) {
    throw new Error(`USD ${closing.USD} breached the ${HEDGE_RESERVE_FLOOR_USD} reserve floor.`);
  }
  logger.detail(
    'Exposure',
    Object.entries(exposures)
      .map(([currency, net]) => `${currency} ${net >= 0 ? '+' : ''}${net.toFixed(2)}`)
      .join(' | '),
  );
  logger.detail(
    'Conversions',
    `${conversions.length} booked, ${quotesBooked.size} unique quotes — every quote used exactly once`,
  );
  logger.detail('Identity', 'every foreign obligation covered, USD above the floor');

  return {
    actions,
    revisedActions,
    conversions,
    exposures,
    wallet: closing,
  };
}
