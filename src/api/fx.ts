import type { AirwallexClient } from '../core/client.js';
import { isAirwallexError, TransportError } from '../core/errors.js';
import { num, str } from '../core/parse.js';

export interface FxQuote {
  id: string;
  rate: number;
  currencyPair?: string;
}

export interface FxConversion {
  conversionId: string;
  status: string;
  rate: number;
  buyAmount: number;
  sellAmount: number;
  buyCurrency: string;
  sellCurrency: string;
}

/**
 * GET /fx/rates/current — indicative only, no quote id.
 * Field names vary; sandbox MCP exposes `rate`, quotes expose `client_rate`.
 */
export async function getFxRate(
  client: AirwallexClient,
  input: { sellCurrency: string; buyCurrency: string; onBehalfOf?: string },
): Promise<number> {
  const response = await client.request<Record<string, unknown>>('/api/v1/fx/rates/current', {
    method: 'GET',
    query: { sell_currency: input.sellCurrency, buy_currency: input.buyCurrency },
    ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}),
  });
  const rate = num(response.rate, response.client_rate, response.mid_rate, response.awx_rate);
  if (rate === undefined) throw new Error('FX rate response did not include a rate.');
  return rate;
}

/** Quote validity periods accepted by the live FX quote endpoint. */
export type QuoteValidity = 'MIN_1' | 'MIN_15' | 'MIN_30' | 'HR_1' | 'HR_4' | 'HR_8' | 'HR_24';

/**
 * POST /fx/quotes/create — a quote is single-use. Book it once with one
 * conversion, then request a fresh quote for any further conversion.
 */
export async function createFxQuote(
  client: AirwallexClient,
  input: {
    requestId: string;
    sellCurrency: string;
    buyCurrency: string;
    buyAmount?: number;
    sellAmount?: number;
    /** Live requires validity; MIN_30 works in the default short-validity group. */
    validity?: QuoteValidity;
    onBehalfOf?: string;
  },
): Promise<FxQuote> {
  const response = await client.request<Record<string, unknown>>('/api/v1/fx/quotes/create', {
    body: {
      request_id: input.requestId,
      sell_currency: input.sellCurrency,
      buy_currency: input.buyCurrency,
      validity: input.validity ?? 'MIN_30',
      ...(input.buyAmount !== undefined ? { buy_amount: String(input.buyAmount) } : {}),
      ...(input.sellAmount !== undefined ? { sell_amount: String(input.sellAmount) } : {}),
    },
    ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}),
  });
  const id = str(response.id, response.quote_id);
  const rate = num(response.client_rate, response.rate, response.quote_rate);
  if (!id || rate === undefined) {
    throw new Error('FX quote response was missing id or rate.');
  }
  return { id, rate, ...(str(response.currency_pair) ? { currencyPair: str(response.currency_pair) } : {}) };
}

function toConversion(response: Record<string, unknown>, fallback: {
  buyCurrency: string;
  sellCurrency: string;
}): FxConversion {
  return {
    conversionId: String(response.conversion_id ?? ''),
    status: String(response.status ?? ''),
    rate: num(response.client_rate, response.rate) ?? 0,
    buyAmount: num(response.buy_amount) ?? 0,
    sellAmount: num(response.sell_amount) ?? 0,
    buyCurrency: String(response.buy_currency ?? fallback.buyCurrency),
    sellCurrency: String(response.sell_currency ?? fallback.sellCurrency),
  };
}

export async function findConversionByRequestId(
  client: AirwallexClient,
  requestId: string,
): Promise<FxConversion | undefined> {
  const response = await client.request<{ items: Record<string, unknown>[] }>(
    '/api/v1/fx/conversions',
    { method: 'GET', query: { request_id: requestId } },
  );
  const first = (response.items ?? [])[0];
  return first
    ? toConversion(first, {
        buyCurrency: String(first.buy_currency ?? ''),
        sellCurrency: String(first.sell_currency ?? ''),
      })
    : undefined;
}

/**
 * POST /fx/conversions/create — REST only, no MCP tool exists.
 * Never send x-api-version on FX calls; this client never sets it.
 * Any non-success response is treated as ambiguous: the conversion is looked up
 * by request_id before reporting failure, so a retried or resumed run converts
 * exactly once.
 */
export async function createFxConversion(
  client: AirwallexClient,
  input: {
    requestId: string;
    sellCurrency: string;
    buyCurrency: string;
    buyAmount?: number;
    sellAmount?: number;
    quoteId?: string;
    onBehalfOf?: string;
  },
): Promise<FxConversion> {
  try {
    const response = await client.request<Record<string, unknown>>('/api/v1/fx/conversions/create', {
      body: {
        request_id: input.requestId,
        sell_currency: input.sellCurrency,
        buy_currency: input.buyCurrency,
        ...(input.buyAmount !== undefined ? { buy_amount: String(input.buyAmount) } : {}),
        ...(input.sellAmount !== undefined ? { sell_amount: String(input.sellAmount) } : {}),
        ...(input.quoteId ? { quote_id: input.quoteId } : {}),
      },
      ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}),
    });
    return toConversion(response, input);
  } catch (error) {
    const ambiguous =
      error instanceof TransportError ||
      (isAirwallexError(error) &&
        (error.isDuplicateRequestId || error.status >= 500 || error.code === 'request_pending'));
    if (ambiguous) {
      const existing = await findConversionByRequestId(client, input.requestId);
      if (existing) return existing;
    }
    throw error;
  }
}
