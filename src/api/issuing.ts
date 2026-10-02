import type { AirwallexClient } from '../core/client.js';
import { asRecord, num, str } from '../core/parse.js';

export interface CardholderRecord {
  cardholderId: string;
  status?: string;
}

export interface CardRecord {
  cardId: string;
  cardStatus?: string;
  cardNumber?: string;
  authorizationControls?: Record<string, unknown>;
}

export interface CardLimit {
  interval: string;
  amount: number;
  remaining?: number;
}

export async function createCardholder(
  client: AirwallexClient,
  input: {
    requestId: string;
    email: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    address: { line1: string; city: string; state?: string; postcode: string; country: string };
    onBehalfOf?: string;
  },
): Promise<CardholderRecord> {
  const response = await client.request<Record<string, unknown>>('/api/v1/issuing/cardholders/create', {
    body: {
      request_id: input.requestId,
      email: input.email,
      type: 'INDIVIDUAL',
      individual: {
        name: { first_name: input.firstName, last_name: input.lastName },
        date_of_birth: input.dateOfBirth,
        address: input.address,
        express_consent_obtained: 'yes',
      },
    },
    ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}),
  });
  return {
    cardholderId: String(response.cardholder_id ?? ''),
    ...(str(response.status) ? { status: str(response.status) } : {}),
  };
}

/**
 * POST /issuing/cards/create. Spend controls live here and only they can block
 * an authorization; prompts cannot. Per-transaction limits are inclusive.
 */
export async function createCard(
  client: AirwallexClient,
  input: {
    requestId: string;
    cardholderId: string;
    createdBy: string;
    limitCurrency: string;
    limits: { interval: 'PER_TRANSACTION' | 'MONTHLY' | 'ALL_TIME'; amount: number }[];
    allowedCurrencies: string[];
    allowedMerchantCategories: string[];
    nickName?: string;
    purpose?: string;
    onBehalfOf?: string;
  },
): Promise<CardRecord> {
  const response = await client.request<Record<string, unknown>>('/api/v1/issuing/cards/create', {
    body: {
      request_id: input.requestId,
      cardholder_id: input.cardholderId,
      created_by: input.createdBy,
      form_factor: 'VIRTUAL',
      is_personalized: false,
      program: { purpose: 'COMMERCIAL' },
      ...(input.nickName ? { nick_name: input.nickName } : {}),
      ...(input.purpose ? { purpose: input.purpose } : {}),
      authorization_controls: {
        allowed_transaction_count: 'MULTIPLE',
        allowed_currencies: input.allowedCurrencies,
        allowed_merchant_categories: input.allowedMerchantCategories,
        transaction_limits: {
          currency: input.limitCurrency,
          limits: input.limits.map((limit) => ({ interval: limit.interval, amount: limit.amount })),
        },
      },
    },
    ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}),
  });
  return {
    cardId: String(response.card_id ?? ''),
    ...(str(response.card_status) ? { cardStatus: str(response.card_status) } : {}),
    ...(str(response.card_number) ? { cardNumber: str(response.card_number) } : {}),
    ...(response.authorization_controls
      ? { authorizationControls: response.authorization_controls as Record<string, unknown> }
      : {}),
  };
}

export async function getCard(
  client: AirwallexClient,
  cardId: string,
  options: { onBehalfOf?: string } = {},
): Promise<CardRecord> {
  const response = await client.request<Record<string, unknown>>(`/api/v1/issuing/cards/${cardId}`, {
    method: 'GET',
    ...(options.onBehalfOf ? { onBehalfOf: options.onBehalfOf } : {}),
  });
  return {
    cardId: String(response.card_id ?? cardId),
    ...(str(response.card_status) ? { cardStatus: str(response.card_status) } : {}),
    ...(str(response.card_number) ? { cardNumber: str(response.card_number) } : {}),
  };
}

export async function getCardholder(
  client: AirwallexClient,
  cardholderId: string,
  options: { onBehalfOf?: string } = {},
): Promise<CardholderRecord> {
  const response = await client.request<Record<string, unknown>>(
    `/api/v1/issuing/cardholders/${cardholderId}`,
    {
      method: 'GET',
      ...(options.onBehalfOf ? { onBehalfOf: options.onBehalfOf } : {}),
    },
  );
  return {
    cardholderId: String(response.cardholder_id ?? cardholderId),
    ...(str(response.status) ? { status: str(response.status) } : {}),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cardholders reach READY without an approval call — poll instead of calling
 * pass_review. Fails loudly rather than creating a card against a cardholder
 * that is still PENDING or INCOMPLETE.
 */
export async function waitForCardholderReady(
  client: AirwallexClient,
  cardholderId: string,
  attempts = 6,
  options: { onBehalfOf?: string } = {},
): Promise<CardholderRecord> {
  let last: CardholderRecord = { cardholderId };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await getCardholder(client, cardholderId, options);
    if (last.status === 'READY') return last;
    await sleep(1_000);
  }
  if (last.status !== 'READY') {
    throw new Error(
      `Cardholder ${cardholderId} is ${last.status ?? 'unknown'} after ${attempts} checks; refusing to issue a card.`,
    );
  }
  return last;
}

export async function waitForCardActive(
  client: AirwallexClient,
  cardId: string,
  attempts = 6,
  options: { onBehalfOf?: string } = {},
): Promise<CardRecord> {
  let last: CardRecord = { cardId };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await getCard(client, cardId, options);
    if (last.cardStatus === 'ACTIVE') return last;
    await sleep(1_000);
  }
  if (last.cardStatus !== 'ACTIVE') {
    throw new Error(
      `Card ${cardId} is ${last.cardStatus ?? 'unknown'} after ${attempts} checks; refusing to use a card that is not ACTIVE.`,
    );
  }
  return last;
}

export async function getCardLimits(
  client: AirwallexClient,
  cardId: string,
  options: { onBehalfOf?: string } = {},
): Promise<CardLimit[]> {
  const response = await client.request<Record<string, unknown>>(
    `/api/v1/issuing/cards/${cardId}/limits`,
    {
      method: 'GET',
      ...(options.onBehalfOf ? { onBehalfOf: options.onBehalfOf } : {}),
    },
  );
  const limits = (response.limits ?? []) as unknown[];
  return limits.map((item) => {
    const record = asRecord(item);
    return {
      interval: String(record.interval ?? ''),
      amount: num(record.amount) ?? 0,
      ...(num(record.remaining) !== undefined ? { remaining: num(record.remaining) } : {}),
    };
  });
}

/** Allowed card_status values: INACTIVE, ACTIVE, CLOSED. Freeze or revoke with this. */
export async function updateCardStatus(
  client: AirwallexClient,
  cardId: string,
  cardStatus: 'INACTIVE' | 'ACTIVE' | 'CLOSED',
  options: { onBehalfOf?: string } = {},
): Promise<CardRecord> {
  const response = await client.request<Record<string, unknown>>(
    `/api/v1/issuing/cards/${cardId}/update`,
    {
      body: { card_status: cardStatus },
      ...(options.onBehalfOf ? { onBehalfOf: options.onBehalfOf } : {}),
    },
  );
  return {
    cardId: String(response.card_id ?? cardId),
    ...(str(response.card_status) ? { cardStatus: str(response.card_status) } : {}),
  };
}

export interface CardTransaction {
  transactionId: string;
  processResult: string;
  failureReason?: string;
  type?: string;
  subtype?: string;
  amount: number;
  currency: string;
  merchantCategory?: string;
}

function toCardTransaction(item: unknown): CardTransaction {
  const record = asRecord(item);
  return {
    transactionId: String(record.card_transaction_id ?? ''),
    processResult: String(record.process_result ?? ''),
    ...(str(record.failure_reason) ? { failureReason: str(record.failure_reason) } : {}),
    ...(str(record.type) ? { type: str(record.type) } : {}),
    ...(str(record.subtype) ? { subtype: str(record.subtype) } : {}),
    amount: num(record.transaction_amount) ?? 0,
    currency: String(record.transaction_currency ?? ''),
    ...(record.merchant
      ? { merchantCategory: str(asRecord(record.merchant).category_code) }
      : {}),
  };
}

/**
 * POST /simulation/issuing/create. The sandbox control engine decides the result:
 * a disallowed currency or merchant category, a breached limit or a wallet
 * shortfall produce a DECLINED event with a failure_reason.
 */
export async function simulateCardTransaction(
  client: AirwallexClient,
  input: {
    cardId: string;
    amount: number;
    currency: string;
    merchantCategoryCode: string;
    merchantInfo: string;
    singlePhase?: boolean;
    simulatedFailureReason?: string;
    onBehalfOf?: string;
  },
): Promise<CardTransaction> {
  const response = await client.request<unknown>('/api/v1/simulation/issuing/create', {
    body: {
      card_id: input.cardId,
      transaction_amount: input.amount,
      transaction_currency: input.currency,
      merchant_category_code: input.merchantCategoryCode,
      merchant_info: input.merchantInfo,
      single_phase: input.singlePhase ?? false,
      ...(input.simulatedFailureReason
        ? { transaction_failure_reason: input.simulatedFailureReason }
        : {}),
    },
    ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}),
  });
  return toCardTransaction(response);
}

/** Move an authorization to clearing; the guide treats transaction_type CLEARING as accepted. */
export async function captureCardTransaction(
  client: AirwallexClient,
  transactionId: string,
  options: { onBehalfOf?: string } = {},
): Promise<CardTransaction> {
  const response = await client.request<unknown>(
    `/api/v1/simulation/issuing/${transactionId}/capture`,
    { ...(options.onBehalfOf ? { onBehalfOf: options.onBehalfOf } : {}) },
  );
  return toCardTransaction(response);
}

export async function reverseCardTransaction(
  client: AirwallexClient,
  transactionId: string,
): Promise<CardTransaction> {
  const response = await client.request<unknown>(
    `/api/v1/simulation/issuing/${transactionId}/reverse`,
  );
  return toCardTransaction(response);
}

export async function refundCardTransaction(
  client: AirwallexClient,
  input: { transactionId: string; amount?: number },
): Promise<CardTransaction> {
  const response = await client.request<unknown>('/api/v1/simulation/issuing/refund', {
    body: {
      card_transaction_id: input.transactionId,
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
    },
  });
  return toCardTransaction(response);
}

export async function listCardTransactions(
  client: AirwallexClient,
  options: { cardId?: string } = {},
): Promise<CardTransaction[]> {
  const response = await client.request<{ items: unknown[] }>('/api/v1/issuing/transactions', {
    method: 'GET',
    ...(options.cardId ? { query: { card_id: options.cardId } } : {}),
  });
  return (response.items ?? []).map(toCardTransaction);
}
