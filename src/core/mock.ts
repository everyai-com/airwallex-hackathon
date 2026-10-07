import { randomUUID } from 'node:crypto';
import { AirwallexError } from './errors.js';
import { SWIFT_FEE_EUR, round2 } from './money.js';
import type { ApiRequest, ApiResponse, Transport } from './transport.js';

function fail(status: number, code: string, message: string): never {
  throw new AirwallexError({ status, code, message });
}

function nowIso(): string {
  return new Date().toISOString();
}

function plusHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

interface MockCard {
  card_id: string;
  cardholder_id: string;
  card_status: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'CLOSED';
  form_factor: string;
  card_number: string;
  authorization_controls: Record<string, unknown>;
  created_at: string;
  spent: { MONTHLY: number; ALL_TIME: number };
}

interface MockCardTransaction {
  card_transaction_id: string;
  card_id: string;
  type: 'AUTHORIZATION' | 'CLEARING' | 'REVERSAL_AUTH';
  subtype: string;
  process_result: 'APPROVED' | 'DECLINED';
  failure_reason?: string;
  transaction_amount: number;
  transaction_currency: string;
  merchant: { name: string; category_code: string };
  masked_card_number: string;
  transacted_at: string;
  status: 'PENDING' | 'SETTLED' | 'FAILED';
}

interface MockTransfer {
  id: string;
  request_id: string;
  status: 'PROCESSING' | 'SENT' | 'PAID' | 'CANCELLED';
  transfer_currency: string;
  transfer_amount: number;
  transfer_method: string;
  beneficiary_id: string;
  reason: string;
  reference: string;
  fee_amount: number;
  failure_type?: string;
  failure_reason?: string;
  account_id?: string | null;
  created_at: string;
}

interface MockDispute {
  id: string;
  stage: string;
  status: string;
  payment_intent_id: string;
  amount: number;
  currency: string;
  reason: { original_code: string; type: string; description: string };
  due_at: string;
  created_at: string;
  challenge_details: unknown[];
  accept_details: unknown[];
}

interface MockState {
  platformBalances: Record<string, number>;
  customerBalances: Map<string, Record<string, number>>;
  accounts: Record<string, any>[];
  moneyMoves: Map<string, Record<string, any>>;
  platformReports: Record<string, unknown>[];
  globalAccounts: Record<string, unknown>[];
  beneficiaries: Record<string, unknown>[];
  transfers: MockTransfer[];
  conversions: Record<string, unknown>[];
  requestIds: Map<string, string>;
  cardholders: Record<string, unknown>[];
  cards: MockCard[];
  billingCustomers: Map<string, Record<string, unknown>>;
  invoices: Map<string, Record<string, any>>;
  cardTransactions: MockCardTransaction[];
  paymentIntents: Map<string, Record<string, unknown>>;
  disputes: MockDispute[];
  refunds: Record<string, unknown>[];
  files: Record<string, unknown>[];
  quotes: Map<string, { buy_currency: string; sell_currency: string; rate: number; used: boolean }>;
}

export interface MockSeed {
  balances?: Record<string, number>;
}

export interface MockSnapshot {
  balances: Record<string, number>;
  customerBalances: Record<string, Record<string, number>>;
  transfers: MockTransfer[];
  conversions: Record<string, unknown>[];
  moneyMoves: Record<string, any>[];
  cardTransactions: MockCardTransaction[];
  cards: MockCard[];
  beneficiaries: Record<string, unknown>[];
  disputes: MockDispute[];
  refunds: Record<string, unknown>[];
  paymentIntents: Record<string, unknown>[];
}

export const MOCK_FX_RATES: Record<string, number> = {
  USDEUR: 0.92,
  EURUSD: 1.0869,
  USDGBP: 0.79,
  GBPUSD: 1.2658,
  EURGBP: 0.858,
  GBPEUR: 1.1655,
};

function rateFor(buyCurrency: string, sellCurrency: string): number {
  const direct = MOCK_FX_RATES[`${sellCurrency}${buyCurrency}`];
  if (direct) return direct;
  const inverse = MOCK_FX_RATES[`${buyCurrency}${sellCurrency}`];
  if (inverse && inverse > 0) return round2((1 / inverse) * 10000) / 10000;
  fail(400, 'currency_pair_invalid', `No FX rate for ${sellCurrency}->${buyCurrency} in the mock.`);
}

function luhnValid(number: string): boolean {
  const digits = [...number].reverse().map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = digits[i]!;
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

function ibanChecksumValid(iban: string): boolean {
  const normalized = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(normalized)) return false;
  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  const digits = [...rearranged].map((ch) =>
    /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch,
  );
  let remainder = 0;
  for (const digit of digits.join('')) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

const DISPUTE_REASONS: Record<string, { type: string; description: string }> = {
  '10.4': { type: 'FRAUDULENT', description: 'Fraudulent transaction.' },
  '13.1': { type: 'PRODUCT_NOT_RECEIVED', description: 'Merchandise/Services not received.' },
  '13.6': { type: 'CREDIT_NOT_PROCESSED', description: 'Credit not processed.' },
  '13.5': { type: 'MISREPRESENTATION', description: 'Misrepresentation.' },
};

export class MockTransport implements Transport {
  readonly kind = 'mock' as const;
  private state: MockState = MockTransport.freshState();

  constructor(seed?: MockSeed) {
    if (seed) this.seed(seed);
  }

  private static freshState(): MockState {
    return {
      platformBalances: {
        USD: 14_200,
        EUR: 1_150,
        GBP: 400,
      },
      customerBalances: new Map(),
      accounts: [],
      moneyMoves: new Map(),
      platformReports: [],
      globalAccounts: [
        {
          id: 'ga_mock_usd',
          currency: 'USD',
          country_code: 'US',
          account_number: '1234567890',
          status: 'ACTIVE',
          account_id: null,
        },
      ],
      beneficiaries: [],
      transfers: [],
      conversions: [],
      requestIds: new Map(),
      cardholders: [],
      cards: [],
      billingCustomers: new Map(),
      invoices: new Map(),
      cardTransactions: [],
      paymentIntents: new Map(),
      disputes: [],
      refunds: [],
      files: [],
      quotes: new Map(),
    };
  }

  /** Seed balances for a scenario. Balances replace the current values. */
  seed(seed: MockSeed): void {
    if (seed.balances) this.state.platformBalances = { ...seed.balances };
  }

  /**
   * Read-only view of everything that moved, for assertions in tests:
   * transfers, conversions, platform money movement, card transactions,
   * disputes, and both wallet layers.
   */
  snapshot(): MockSnapshot {
    const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    return {
      balances: copy(this.state.platformBalances),
      customerBalances: copy(Object.fromEntries(this.state.customerBalances)),
      transfers: copy(this.state.transfers),
      conversions: copy(this.state.conversions),
      moneyMoves: copy([...this.state.moneyMoves.values()]),
      cardTransactions: copy(this.state.cardTransactions),
      cards: copy(this.state.cards),
      beneficiaries: copy(this.state.beneficiaries),
      disputes: copy(this.state.disputes),
      refunds: copy(this.state.refunds),
      paymentIntents: copy([...this.state.paymentIntents.values()]),
    };
  }

  /** Customer wallet for an x-on-behalf-of account, or the platform wallet. */
  private wallet(accountId?: string): Record<string, number> {
    if (!accountId) return this.state.platformBalances;
    let wallet = this.state.customerBalances.get(accountId);
    if (!wallet) {
      wallet = {};
      this.state.customerBalances.set(accountId, wallet);
    }
    return wallet;
  }

  private scopedAccount(request: ApiRequest): string | undefined {
    return request.headers?.['x-on-behalf-of'];
  }

  private move(
    from: Record<string, number>,
    to: Record<string, number>,
    currency: string,
    amount: number,
    insufficientCode: string,
  ): void {
    const balance = from[currency] ?? 0;
    if (balance < amount) {
      fail(400, insufficientCode, `Insufficient ${currency} balance.`);
    }
    from[currency] = round2(balance - amount);
    to[currency] = round2((to[currency] ?? 0) + amount);
  }

  async send<T>(request: ApiRequest): Promise<ApiResponse<T>> {
    const { status, data } = this.route(request);
    return { status, data: data as T };
  }

  // eslint-disable-next-line complexity
  private route(request: ApiRequest): { status: number; data: unknown } {
    const { method, path } = request;
    const body = (request.body ?? {}) as Record<string, any>;
    const query = request.query ?? {};

    if (method === 'POST' && path === '/api/v1/authentication/login') {
      return { status: 200, data: { token: `mock.${randomUUID()}`, expires_at: plusHours(1) } };
    }

    if (method === 'GET' && path === '/api/v1/balances/current') {
      const wallet = this.wallet(this.scopedAccount(request));
      const items = Object.entries(wallet)
        .filter(([, amount]) => amount > 0.0001)
        .map(([currency, amount]) => ({
          currency,
          available_amount: round2(amount),
          total_amount: round2(amount),
        }));
      return { status: 200, data: { items } };
    }

    if (method === 'GET' && path === '/api/v1/global_accounts') {
      const scope = this.scopedAccount(request) ?? null;
      const items = this.state.globalAccounts.filter((account) => (account.account_id ?? null) === scope);
      return { status: 200, data: { items } };
    }

    if (method === 'POST' && path === '/api/v1/global_accounts/create') {
      const account = {
        id: `ga_${randomUUID().slice(0, 8)}`,
        currency: body.required_features?.[0]?.currency ?? 'USD',
        country_code: body.country_code ?? 'US',
        status: 'ACTIVE',
        account_id: this.scopedAccount(request) ?? null,
      };
      this.state.globalAccounts.push(account);
      return { status: 201, data: account };
    }

    if (method === 'POST' && path === '/api/v1/simulation/deposit/create') {
      const account = this.state.globalAccounts.find((a) => a.id === body.global_account_id);
      if (!account) fail(400, 'invalid_argument', 'Unknown global_account_id.');
      const currency = String(account.currency);
      if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0) {
        fail(400, 'invalid_argument', 'amount must be a positive, finite number.');
      }
      const wallet = this.wallet(this.scopedAccount(request));
      wallet[currency] = round2((wallet[currency] ?? 0) + body.amount);
      return {
        status: 201,
        data: {
          id: `dep_${randomUUID().slice(0, 8)}`,
          amount: body.amount,
          currency,
          status: 'PENDING',
          deposit_type: 'CREDIT',
          payer_name: body.payer_name ?? 'Seed funding',
        },
      };
    }

    if (method === 'GET' && path === '/api/v1/fx/rates/current') {
      const sell = String(query.sell_currency);
      const buy = String(query.buy_currency);
      const rate = rateFor(buy, sell);
      return {
        status: 200,
        data: {
          currency_pair: `${sell}${buy}`,
          rate,
          mid_rate: rate,
          buy_currency: buy,
          sell_currency: sell,
        },
      };
    }

    if (method === 'POST' && path === '/api/v1/fx/quotes/create') {
      if (!body.validity) {
        fail(400, 'field_required', 'field [validity] is required (live).');
      }
      const sell = String(body.sell_currency);
      const buy = String(body.buy_currency);
      const spot = rateFor(buy, sell);
      const rate = Math.round(spot * 0.998 * 1_000_000) / 1_000_000;
      const id = `qte_${randomUUID().slice(0, 8)}`;
      this.state.quotes.set(id, { buy_currency: buy, sell_currency: sell, rate, used: false });
      return {
        status: 201,
        data: {
          id,
          quote_id: id,
          currency_pair: `${sell}${buy}`,
          client_rate: rate,
          mid_rate: spot,
          buy_currency: buy,
          sell_currency: sell,
          expires_at: plusHours(1),
        },
      };
    }

    if (method === 'POST' && path === '/api/v1/fx/conversions/create') {
      const requestId = String(body.request_id ?? '');
      this.claimRequestId(requestId, 'conversion');
      const sell = String(body.sell_currency);
      const buy = String(body.buy_currency);
      let rate = rateFor(buy, sell);
      if (body.quote_id) {
        const quote = this.state.quotes.get(String(body.quote_id));
        if (!quote) fail(400, 'invalid_quote_id', 'Quote not found.');
        if (quote.used) fail(400, 'invalid_quote_id', 'Quote already used by a conversion.');
        if (quote.buy_currency !== buy || quote.sell_currency !== sell) {
          fail(400, 'invalid_quote_id', 'Quote currency pair does not match the conversion.');
        }
        quote.used = true;
        rate = quote.rate;
      }
      const buyAmount = body.buy_amount !== undefined ? Number(body.buy_amount) : undefined;
      const sellAmount = body.sell_amount !== undefined ? Number(body.sell_amount) : undefined;
      if (buyAmount === undefined && sellAmount === undefined) {
        fail(400, 'field_required', 'One of buy_amount or sell_amount is required.');
      }
      const finalBuy = buyAmount ?? round2(sellAmount! * rate);
      const finalSell = sellAmount ?? round2(buyAmount! / rate);
      const wallet = this.wallet(this.scopedAccount(request));
      const sellBalance = wallet[sell] ?? 0;
      if (sellBalance < finalSell) {
        fail(400, 'insufficient_funds', `Insufficient ${sell} balance for conversion.`);
      }
      wallet[sell] = round2(sellBalance - finalSell);
      wallet[buy] = round2((wallet[buy] ?? 0) + finalBuy);
      const conversion = {
        conversion_id: `cnv_${randomUUID().slice(0, 8)}`,
        request_id: requestId,
        status: 'SETTLED',
        currency_pair: `${sell}${buy}`,
        client_rate: rate,
        buy_amount: finalBuy,
        sell_amount: finalSell,
        buy_currency: buy,
        sell_currency: sell,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      this.state.conversions.push(conversion);
      return { status: 201, data: conversion };
    }

    if (method === 'GET' && path === '/api/v1/fx/conversions') {
      const requestId = query.request_id ? String(query.request_id) : undefined;
      const items = requestId
        ? this.state.conversions.filter((item) => item.request_id === requestId)
        : this.state.conversions;
      return { status: 200, data: { items } };
    }

    if (method === 'POST' && path === '/api/v1/beneficiaries/schema') {
      return {
        status: 200,
        data: {
          transfer_methods: ['LOCAL', 'SWIFT'],
          fields: ['bank_details', 'address'],
          country_code: body.country_code ?? 'US',
          currency: body.currency ?? 'USD',
        },
      };
    }

    if (method === 'POST' && path === '/api/v1/beneficiaries/validate') {
      const beneficiary = body.beneficiary as Record<string, any> | undefined;
      this.validateBeneficiary(beneficiary);
      return { status: 200, data: { status: 'OK' } };
    }

    if (method === 'POST' && path === '/api/v1/beneficiaries/create') {
      const beneficiary = body.beneficiary as Record<string, any> | undefined;
      this.validateBeneficiary(beneficiary);
      const record = {
        id: `ben_${randomUUID().slice(0, 8)}`,
        beneficiary: beneficiary ?? {},
        transfer_methods: body.transfer_methods ?? ['LOCAL'],
        nickname: body.nickname,
        created_at: nowIso(),
      };
      this.state.beneficiaries.push(record);
      return { status: 201, data: record };
    }

    if (method === 'POST' && path === '/api/v1/transfers/create') {
      const requestId = String(body.request_id ?? '');
      if (requestId.length < 10 || requestId.length > 50) {
        fail(400, '018', 'request_id must be between 10 and 50 characters.');
      }
      this.claimRequestId(requestId, 'transfer');
      const currency = String(body.transfer_currency ?? '');
      const amount = Number(body.transfer_amount ?? NaN);
      if (!currency || Number.isNaN(amount)) {
        fail(400, '001', 'transfer_currency and transfer_amount are required.');
      }
      if (!body.beneficiary_id && !body.beneficiary) {
        fail(400, '001', 'beneficiary_id or beneficiary is required.');
      }
      if (!body.reason || !body.reference) {
        fail(400, '001', 'reason and reference are required.');
      }
      if (!body.source_currency) {
        fail(400, 'validation_failed', 'source_currency is required (001 on live).');
      }
      const method = String(body.transfer_method ?? 'LOCAL');
      const fee = method === 'SWIFT' && currency === 'EUR' ? SWIFT_FEE_EUR : 0;
      const scope = this.scopedAccount(request);
      const wallet = this.wallet(scope);
      const balance = wallet[currency] ?? 0;
      if (balance < amount + fee) {
        fail(400, 'balance_insufficient', `Insufficient ${currency} balance for this transfer.`);
      }
      wallet[currency] = round2(balance - amount - fee);
      const transfer: MockTransfer = {
        id: `trf_${randomUUID().slice(0, 8)}`,
        request_id: requestId,
        status: 'PROCESSING',
        transfer_currency: currency,
        transfer_amount: amount,
        transfer_method: method,
        beneficiary_id: body.beneficiary_id ?? 'inline',
        reason: String(body.reason),
        reference: String(body.reference),
        fee_amount: fee,
        account_id: scope ?? null,
        created_at: nowIso(),
      };
      this.state.transfers.push(transfer);
      return { status: 201, data: { ...transfer, amount_beneficiary_receives: amount, amount_payer_pays: amount + fee, transfer_date: nowIso().slice(0, 10) } };
    }

    if (method === 'GET' && path === '/api/v1/transfers') {
      const requestId = query.request_id ? String(query.request_id) : undefined;
      const items = requestId
        ? this.state.transfers.filter((transfer) => transfer.request_id === requestId)
        : this.state.transfers;
      return { status: 200, data: { items } };
    }

    const transferMatch = path.match(/^\/api\/v1\/transfers\/([^/]+)$/);
    if (method === 'GET' && transferMatch) {
      const transfer = this.state.transfers.find((item) => item.id === transferMatch[1]);
      if (!transfer) fail(404, 'not_found', 'Transfer not found.');
      return { status: 200, data: transfer };
    }

    const transitionMatch = path.match(/^\/api\/v1\/simulation\/transfers\/([^/]+)\/transition$/);
    if (method === 'POST' && transitionMatch) {
      const transfer = this.state.transfers.find((item) => item.id === transitionMatch[1]);
      if (!transfer) fail(404, 'not_found', 'Transfer not found.');
      const next = String(body.next_status);
      const allowed: Record<string, string[]> = {
        PROCESSING: ['SENT', 'FAILED', 'CANCELLED'],
        SENT: ['PAID', 'FAILED', 'CANCELLED'],
        PAID: [],
        CANCELLED: [],
      };
      if (!allowed[transfer.status]?.includes(next)) {
        fail(400, 'validation_error', `Transition ${transfer.status} -> ${next} is not supported.`);
      }
      if (next === 'FAILED') {
        if (transfer.status !== 'SENT') {
          fail(400, 'validation_error', 'failure_type applies only after the transfer reaches SENT.');
        }
        transfer.status = 'CANCELLED';
        transfer.failure_type = String(body.failure_type ?? 'OTHER');
        transfer.failure_reason = `Simulated failure: ${transfer.failure_type}`;
        // A failed payout returns the transfer amount, less any applicable fees.
        const wallet = this.wallet(transfer.account_id ?? undefined);
        wallet[transfer.transfer_currency] = round2(
          (wallet[transfer.transfer_currency] ?? 0) + transfer.transfer_amount,
        );
      } else {
        transfer.status = next as MockTransfer['status'];
      }
      return { status: 200, data: transfer };
    }

    if (method === 'POST' && path === '/api/v1/issuing/cardholders/create') {
      const record = {
        cardholder_id: `chd_${randomUUID().slice(0, 8)}`,
        email: body.email,
        type: body.type ?? 'INDIVIDUAL',
        status: 'READY',
        individual: body.individual,
      };
      this.state.cardholders.push(record);
      return { status: 202, data: record };
    }

    const cardholderMatch = path.match(/^\/api\/v1\/issuing\/cardholders\/([^/]+)$/);
    if (method === 'GET' && cardholderMatch) {
      const cardholder = this.state.cardholders.find(
        (item) => item.cardholder_id === cardholderMatch[1],
      );
      if (!cardholder) fail(404, 'not_found', 'Cardholder not found.');
      return { status: 200, data: cardholder };
    }

    if (method === 'POST' && path === '/api/v1/issuing/cards/create') {
      const controls = (body.authorization_controls ?? {}) as Record<string, any>;
      const card: MockCard = {
        card_id: `crd_${randomUUID().slice(0, 8)}`,
        cardholder_id: String(body.cardholder_id),
        card_status: 'ACTIVE',
        form_factor: String(body.form_factor ?? 'VIRTUAL'),
        card_number: `**** **** **** ${String(4000 + Math.floor(Math.random() * 999)).slice(0, 4)}`,
        authorization_controls: controls,
        created_at: nowIso(),
        spent: { MONTHLY: 0, ALL_TIME: 0 },
      };
      this.state.cards.push(card);
      return {
        status: 202,
        data: {
          card_id: card.card_id,
          cardholder_id: card.cardholder_id,
          card_status: card.card_status,
          card_number: card.card_number,
          form_factor: card.form_factor,
          authorization_controls: controls,
          created_at: card.created_at,
        },
      };
    }

    const cardMatch = path.match(/^\/api\/v1\/issuing\/cards\/([^/]+)$/);
    if (method === 'GET' && cardMatch) {
      const card = this.state.cards.find((item) => item.card_id === cardMatch[1]);
      if (!card) fail(404, 'not_found', 'Card not found.');
      return { status: 200, data: this.cardView(card) };
    }

    const cardLimitsMatch = path.match(/^\/api\/v1\/issuing\/cards\/([^/]+)\/limits$/);
    if (method === 'GET' && cardLimitsMatch) {
      const card = this.state.cards.find((item) => item.card_id === cardLimitsMatch[1]);
      if (!card) fail(404, 'not_found', 'Card not found.');
      return { status: 200, data: this.cardLimits(card) };
    }

    const cardUpdateMatch = path.match(/^\/api\/v1\/issuing\/cards\/([^/]+)\/update$/);
    if (method === 'POST' && cardUpdateMatch) {
      const card = this.state.cards.find((item) => item.card_id === cardUpdateMatch[1]);
      if (!card) fail(404, 'not_found', 'Card not found.');
      if (body.card_status) card.card_status = String(body.card_status) as MockCard['card_status'];
      if (body.authorization_controls) {
        card.authorization_controls = { ...card.authorization_controls, ...body.authorization_controls };
      }
      return { status: 200, data: this.cardView(card) };
    }

    if (method === 'POST' && path === '/api/v1/simulation/issuing/create') {
      return {
        status: 201,
        data: this.simulateCardTransaction(body, this.scopedAccount(request)),
      };
    }

    const captureMatch = path.match(/^\/api\/v1\/simulation\/issuing\/([^/]+)\/capture$/);
    if (method === 'POST' && captureMatch) {
      const transaction = this.findCardTransaction(captureMatch[1]!);
      transaction.subtype = 'CLEARING';
      transaction.type = 'CLEARING';
      transaction.status = 'PENDING';
      const card = this.state.cards.find((item) => item.card_id === transaction.card_id);
      if (card && transaction.process_result === 'APPROVED') {
        card.spent.MONTHLY = round2(card.spent.MONTHLY + transaction.transaction_amount);
        card.spent.ALL_TIME = round2(card.spent.ALL_TIME + transaction.transaction_amount);
        this.debitWallet(
          this.scopedAccount(request),
          transaction.transaction_currency,
          transaction.transaction_amount,
        );
      }
      return { status: 200, data: transaction };
    }

    const reverseMatch = path.match(/^\/api\/v1\/simulation\/issuing\/([^/]+)\/reverse$/);
    if (method === 'POST' && reverseMatch) {
      const transaction = this.findCardTransaction(reverseMatch[1]!);
      transaction.subtype = 'REVERSAL';
      transaction.type = 'REVERSAL_AUTH';
      transaction.status = 'SETTLED';
      return { status: 200, data: transaction };
    }

    if (method === 'POST' && path === '/api/v1/simulation/issuing/refund') {
      const original = this.findCardTransaction(String(body.card_transaction_id));
      const refund = {
        ...original,
        card_transaction_id: `ctx_${randomUUID().slice(0, 8)}`,
        type: 'CLEARING',
        subtype: 'CLEARING_REVERSAL',
        transaction_amount: body.amount ?? original.transaction_amount,
        status: 'SETTLED',
      };
      this.state.cardTransactions.push(refund as MockCardTransaction);
      return { status: 201, data: refund };
    }

    if (method === 'GET' && path === '/api/v1/issuing/transactions') {
      const cardId = query.card_id ? String(query.card_id) : undefined;
      const items = cardId
        ? this.state.cardTransactions.filter((item) => item.card_id === cardId)
        : this.state.cardTransactions;
      return { status: 200, data: { items } };
    }

    if (method === 'POST' && path === '/api/v1/pa/payment_intents/create') {
      const requestId = String(body.request_id ?? '');
      this.claimRequestId(requestId, 'payment_intent');
      for (const field of ['amount', 'currency', 'merchant_order_id']) {
        if (body[field] === undefined) fail(400, 'field_required', `${field} is required.`);
      }
      const id = `int_${randomUUID().slice(0, 10)}`;
      const intent = {
        id,
        request_id: requestId,
        amount: body.amount,
        currency: body.currency,
        merchant_order_id: body.merchant_order_id,
        status: 'REQUIRES_PAYMENT_METHOD',
        created_at: nowIso(),
      };
      this.state.paymentIntents.set(id, intent);
      return { status: 201, data: { ...intent, client_secret: `secret_${randomUUID()}` } };
    }

    if (method === 'GET' && path === '/api/v1/pa/payment_intents') {
      const requestId = query.request_id ? String(query.request_id) : undefined;
      const items = [...this.state.paymentIntents.values()].filter(
        (intent) => !requestId || intent.request_id === requestId,
      );
      return { status: 200, data: { items } };
    }

    const confirmMatch = path.match(/^\/api\/v1\/pa\/payment_intents\/([^/]+)\/confirm$/);
    if (method === 'POST' && confirmMatch) {
      const intent = this.state.paymentIntents.get(confirmMatch[1]!);
      if (!intent) fail(404, 'not_found', 'Payment intent not found.');
      this.claimRequestId(String(body.request_id ?? ''), 'payment_intent_confirm');
      const paymentMethod = (body.payment_method ?? {}) as Record<string, any>;
      if (paymentMethod.type === 'airi') {
        // Airi one-click: a saved credential; the simulator mirrors the flow
        // that live calls need enablement for.
        if (!paymentMethod.airi?.email) {
          fail(400, 'field_required', 'payment_method.airi.email is required.');
        }
      } else {
        const card = paymentMethod.card as Record<string, string> | undefined;
        if (!card?.number || !luhnValid(String(card.number))) {
          fail(400, 'invalid_card_number', 'Card number failed validation.');
        }
      }
      const simulatedFailure = body.simulate_failure_reason
        ? String(body.simulate_failure_reason)
        : undefined;
      if (simulatedFailure) {
        intent.status = 'FAILED';
        intent.failure_reason = simulatedFailure;
        intent.latest_payment_attempt = {
          id: `att_${randomUUID().slice(0, 8)}`,
          status: 'FAILED',
          failure_reason: simulatedFailure,
        };
        return { status: 200, data: intent };
      }
      delete intent.failure_reason;
      intent.status = 'SUCCEEDED';
      intent.latest_payment_attempt = { id: `att_${randomUUID().slice(0, 8)}`, status: 'SETTLED' };
      return { status: 200, data: intent };
    }

    if (method === 'POST' && path === '/api/v1/simulation/pa/payment_disputes/create') {
      const intent = this.state.paymentIntents.get(String(body.payment_intent_id));
      if (!intent) {
        fail(404, 'not_found', `Payment with ${body.payment_intent_id} not found.`);
      }
      const stage = String(body.stage ?? '');
      if (!['RFI', 'PRE_CHARGEBACK', 'CHARGEBACK', 'PRE_ARBITRATION'].includes(stage)) {
        fail(400, 'validation_error', `Invalid stage.`);
      }
      const reason = DISPUTE_REASONS[String(body.reason_code)];
      if (!reason) fail(400, 'validation_error', 'Invalid reason_code.');
      const dispute: MockDispute = {
        id: `dst_${randomUUID().slice(0, 8)}`,
        stage,
        status: stage === 'PRE_CHARGEBACK' ? 'ACCEPTED' : 'REQUIRES_RESPONSE',
        payment_intent_id: String(body.payment_intent_id),
        amount: Number(body.amount ?? intent.amount),
        currency: String(intent.currency),
        reason: { original_code: String(body.reason_code), ...reason },
        due_at: String(body.due_at ?? plusHours(72)),
        created_at: nowIso(),
        challenge_details: [],
        accept_details: [],
      };
      this.state.disputes.push(dispute);
      return { status: 201, data: dispute };
    }

    if (method === 'GET' && path === '/api/v1/pa/payment_disputes') {
      return { status: 200, data: { items: this.state.disputes } };
    }

    const disputeMatch = path.match(/^\/api\/v1\/pa\/payment_disputes\/([^/]+)$/);
    if (method === 'GET' && disputeMatch) {
      const dispute = this.state.disputes.find((item) => item.id === disputeMatch[1]);
      if (!dispute) fail(404, 'not_found', 'Payment dispute not found.');
      return { status: 200, data: dispute };
    }

    const acceptMatch = path.match(/^\/api\/v1\/pa\/payment_disputes\/([^/]+)\/accept$/);
    if (method === 'POST' && acceptMatch) {
      const dispute = this.state.disputes.find((item) => item.id === acceptMatch[1]);
      if (!dispute) fail(404, 'not_found', 'Payment dispute not found.');
      if (dispute.status !== 'REQUIRES_RESPONSE') {
        fail(400, 'validation_error', 'Dispute transition is not supported.');
      }
      dispute.status = 'ACCEPTED';
      dispute.accept_details.push({
        accepted_at: nowIso(),
        accepted_by: 'agentic-demo',
        reason: body.reason ?? 'VALID_CUSTOMER_DISPUTE',
        description: body.description,
        stage: dispute.stage,
      });
      const refund = {
        id: `rfd_${randomUUID().slice(0, 8)}`,
        payment_intent_id: dispute.payment_intent_id,
        amount: dispute.amount,
        currency: dispute.currency,
        reason: body.refund?.reason ?? 'OTHERS',
        status: 'SETTLED',
      };
      this.state.refunds.push(refund);
      return { status: 200, data: { ...dispute, refund } };
    }

    const challengeMatch = path.match(/^\/api\/v1\/pa\/payment_disputes\/([^/]+)\/challenge$/);
    if (method === 'POST' && challengeMatch) {
      const dispute = this.state.disputes.find((item) => item.id === challengeMatch[1]);
      if (!dispute) fail(404, 'not_found', 'Payment dispute not found.');
      if (dispute.status !== 'REQUIRES_RESPONSE') {
        fail(400, 'validation_error', 'Dispute transition is not supported.');
      }
      dispute.status = 'CHALLENGED';
      dispute.challenge_details.push({
        stage: dispute.stage,
        reason: body.reason,
        product_type: body.product_type,
        product_description: body.product_description,
        supporting_documents: body.supporting_documents,
        challenged_by: body.challenged_by ?? 'agentic-demo',
        challenged_at: nowIso(),
      });
      return { status: 200, data: dispute };
    }

    const escalateMatch = path.match(/^\/api\/v1\/simulation\/pa\/payment_disputes\/([^/]+)\/escalate$/);
    if (method === 'POST' && escalateMatch) {
      const dispute = this.state.disputes.find((item) => item.id === escalateMatch[1]);
      if (!dispute) fail(404, 'not_found', 'Payment dispute not found.');
      if (dispute.status !== 'CHALLENGED') {
        fail(400, 'validation_error', 'Dispute transition is not supported.');
      }
      // Per the hackathon guide: escalating a challenged RFI case moves it to
      // CHARGEBACK with status REQUIRES_RESPONSE (the rejection beat).
      const nextStage: Record<string, string> = {
        RFI: 'CHARGEBACK',
        PRE_CHARGEBACK: 'CHARGEBACK',
        CHARGEBACK: 'PRE_ARBITRATION',
      };
      const stage = nextStage[dispute.stage];
      if (!stage) fail(400, 'validation_error', 'Dispute transition is not supported.');
      dispute.stage = stage;
      dispute.status = 'REQUIRES_RESPONSE';
      return { status: 200, data: dispute };
    }

    const resolveMatch = path.match(/^\/api\/v1\/simulation\/pa\/payment_disputes\/([^/]+)\/resolve$/);
    if (method === 'POST' && resolveMatch) {
      const dispute = this.state.disputes.find((item) => item.id === resolveMatch[1]);
      if (!dispute) fail(404, 'not_found', 'Payment dispute not found.');
      const inFavorOf = String(body.in_favor_of ?? '');
      if (!['MERCHANT', 'CUSTOMER'].includes(inFavorOf)) {
        fail(400, 'validation_error', 'Invalid value in in_favor_of.');
      }
      dispute.status = inFavorOf === 'CUSTOMER' ? 'LOST' : 'WON';
      return { status: 200, data: dispute };
    }

    if (method === 'GET' && path === '/api/v1/pa/refunds') {
      return { status: 200, data: { items: this.state.refunds } };
    }

    if (method === 'POST' && path === '/api/v1/files/upload') {
      const record = {
        file_id: `file_${randomUUID().slice(0, 10)}`,
        filename: 'uploaded.pdf',
        size: 1024,
        object_type: 'file',
        created: Date.now(),
      };
      this.state.files.push(record);
      return { status: 201, data: record };
    }

    // --- Connected accounts (platform kits 5-8) ---

    if (method === 'POST' && path === '/api/v1/accounts/create') {
      const details = body.account_details as Record<string, any> | undefined;
      if (details === undefined) {
        fail(400, 'field_required', 'account_details is required (an empty object is allowed).');
      }
      // Live rejects without this: 400 field_required: field [primary_contact] is required.
      const contact = body.primary_contact as Record<string, any> | undefined;
      if (!contact?.email) {
        fail(400, 'field_required', 'field [primary_contact] is required.');
      }
      const business = details.business_details as Record<string, any> | undefined;
      if (!business?.business_name) {
        fail(400, 'validation_failed', 'account_details.business_details.business_name is required.');
      }
      // Live validates the enum even though the docs' minimal sample omits it.
      const businessStructures = [
        'COMPANY',
        'CORPORATION',
        'GENERAL_PARTNERSHIP',
        'LIMITED_LIABILITY_COMPANY',
        'LIMITED_LIABILITY_PARTNERSHIP',
        'LIMITED_PARTNERSHIP',
        'PARTNERSHIP',
        'SELF_MANAGED_SUPER_FUND',
        'SOLE_PROPRIETOR',
        'NON_REGISTERED_SOLE_PROPRIETOR',
        'TRUST',
        'OTHER',
      ];
      if (
        typeof business.business_structure !== 'string' ||
        !businessStructures.includes(business.business_structure)
      ) {
        fail(
          400,
          'field_required',
          `ensure is one of [${businessStructures.join(', ')}]`,
        );
      }
      const persons = details.business_person_details as Record<string, any>[] | undefined;
      if (
        !Array.isArray(persons) ||
        persons.length === 0 ||
        !persons.every(
          (person) =>
            person?.first_name &&
            person?.last_name &&
            Array.isArray(person?.roles) &&
            person.roles.length > 0,
        )
      ) {
        fail(
          400,
          'validation_failed',
          'account_details.business_person_details must be a non-empty array of persons with first_name, last_name and roles.',
        );
      }
      if (
        !Array.isArray(business.business_identifiers) ||
        business.business_identifiers.length === 0
      ) {
        fail(
          400,
          'validation_failed',
          'business_details.business_identifiers (for example an EIN) is required before submit.',
        );
      }
      const account = {
        id: `acct_${randomUUID().slice(0, 8)}`,
        status: 'CREATED',
        account_details: details,
        created_at: nowIso(),
      };
      this.state.accounts.push(account);
      return { status: 201, data: account };
    }

    const accountUpdateMatch = path.match(/^\/api\/v1\/accounts\/([^/]+)\/update$/);
    if (method === 'POST' && accountUpdateMatch) {
      const account = this.state.accounts.find((item) => item.id === accountUpdateMatch[1]);
      if (!account) fail(404, 'not_found', 'Account not found.');
      account.account_details = {
        ...(account.account_details ?? {}),
        ...(body.account_details ?? {}),
      };
      return { status: 200, data: account };
    }

    const accountSubmitMatch = path.match(/^\/api\/v1\/accounts\/([^/]+)\/submit$/);
    if (method === 'POST' && accountSubmitMatch) {
      const account = this.state.accounts.find((item) => item.id === accountSubmitMatch[1]);
      if (!account) fail(404, 'not_found', 'Account not found.');
      // Live validates this at submit time (400 field_required, 1..500 chars).
      const submitDetails = account.account_details as Record<string, any> | undefined;
      const submitBusiness = submitDetails?.business_details as Record<string, any> | undefined;
      const description = submitBusiness?.description_of_goods_or_services;
      if (typeof description !== 'string' || description.length < 1 || description.length > 500) {
        fail(
          400,
          'field_required',
          'ensure length is between 1 and 500 (source: account_details.business_details.description_of_goods_or_services)',
        );
      }
      // Live validates the code against the industry categories reference; the
      // mock only enforces presence (mirrors the live field_required).
      const industryCode = submitBusiness?.industry_category_code;
      if (typeof industryCode !== 'string' || industryCode.length === 0) {
        fail(
          400,
          'field_required',
          'ensure industry_category_code should be valid value, please refer to Industry categories API',
        );
      }
      const operatingCountry = submitBusiness?.operating_country;
      if (
        !Array.isArray(operatingCountry) ||
        operatingCountry.length === 0 ||
        !operatingCountry.every((code) => typeof code === 'string' && /^[A-Z]{2}$/.test(code))
      ) {
        fail(
          400,
          'field_required',
          'ensure operating_country should be supported 2-letter ISO 3166-2 code',
        );
      }
      const productReference = submitBusiness?.account_usage?.product_reference;
      const productReferenceValues = [
        'ACCEPT_ONLINE_PAYMENTS',
        'COLLECT_MARKETPLACE_PROCEEDS',
        'RECEIVE_TRANSFERS',
        'GET_PAID',
        'CONVERT_FUNDS',
        'MAKE_TRANSFERS',
        'CREATE_CARDS',
        'MANAGE_EXPENSES',
        'USE_AWX_API',
        'TRANSFER_CNY_INBOUND',
      ];
      if (
        !Array.isArray(productReference) ||
        productReference.length === 0 ||
        !productReference.every(
          (value) => typeof value === 'string' && productReferenceValues.includes(value),
        )
      ) {
        fail(
          400,
          'invalid_argument',
          `ensure product_reference should be one of [${productReferenceValues.join(', ')}]`,
        );
      }
      const submitPersons = submitDetails?.business_person_details as
        | Record<string, any>[]
        | undefined;
      if (
        !Array.isArray(submitPersons) ||
        !submitPersons.every((person) => {
          const country = person?.residential_address?.country_code;
          const nationality = person?.nationality;
          const roles = person?.roles as string[] | undefined;
          const primary = person?.identifications?.primary as Record<string, any> | undefined;
          const hasIdentity =
            typeof primary?.identification_type === 'string' &&
            typeof primary?.issuing_country_code === 'string' &&
            (typeof primary?.tax_id?.number === 'string'
              ? /^\d{9}$/.test(primary.tax_id.number)
              : typeof primary?.passport?.number === 'string' ||
                typeof primary?.personal_id?.number === 'string' ||
                typeof primary?.drivers_license?.number === 'string');
          return (
            typeof country === 'string' &&
            /^[A-Z]{2}$/.test(country) &&
            typeof nationality === 'string' &&
            /^[A-Z]{2}$/.test(nationality) &&
            typeof person?.date_of_birth === 'string' &&
            Array.isArray(roles) &&
            roles.includes('AUTHORISED_PERSON') &&
            roles.includes('BENEFICIAL_OWNER') &&
            (roles.includes('DIRECTOR') || roles.includes('CONTROLLING_PERSON')) &&
            hasIdentity
          );
        })
      ) {
        fail(
          400,
          'field_required',
          'business_person_details must include residential address country, nationality, date of birth, roles (AUTHORISED_PERSON + BENEFICIAL_OWNER + DIRECTOR or CONTROLLING_PERSON) and a primary identification before submit.',
        );
      }
      account.status = 'SUBMITTED';
      return { status: 200, data: account };
    }

    const accountActivateMatch = path.match(
      /^\/api\/v1\/simulation\/accounts\/([^/]+)\/update_status$/,
    );
    if (method === 'POST' && accountActivateMatch) {
      const account = this.state.accounts.find((item) => item.id === accountActivateMatch[1]);
      if (!account) fail(404, 'not_found', 'Account not found.');
      // Live refuses activation before the submit transition lands.
      if (account.status !== 'SUBMITTED') {
        fail(400, 'bad_request', 'Account needs to be submitted for review before using this endpoint');
      }
      account.status = String(body.next_status ?? 'ACTIVE');
      return { status: 200, data: account };
    }

    const accountMatch = path.match(/^\/api\/v1\/accounts\/([^/]+)$/);
    if (method === 'GET' && accountMatch) {
      const account = this.state.accounts.find((item) => item.id === accountMatch[1]);
      if (!account) fail(404, 'not_found', 'Account not found.');
      return { status: 200, data: account };
    }

    // --- Platform money movement ---

    if (method === 'POST' && path === '/api/v1/connected_account_transfers/create') {
      const requestId = String(body.request_id ?? '');
      this.claimRequestId(requestId, 'connected_account_transfer');
      if (!this.state.accounts.some((item) => item.id === body.destination)) {
        fail(400, 'invalid_argument', 'destination must be an existing acct_ id.');
      }
      if (!body.reason || !body.reference) {
        fail(400, '001', 'reason and reference are required (reference is validated first).');
      }
      const currency = String(body.currency ?? 'USD');
      this.move(
        this.state.platformBalances,
        this.wallet(String(body.destination)),
        currency,
        Number(body.amount),
        'insufficient_fund',
      );
      const record = {
        id: `cat_${randomUUID().slice(0, 8)}`,
        request_id: requestId,
        amount: Number(body.amount),
        currency,
        destination: String(body.destination),
        reason: body.reason,
        reference: body.reference,
        status: 'NEW',
        created_at: nowIso(),
      };
      this.state.moneyMoves.set(record.id, record);
      return { status: 201, data: record };
    }

    if (method === 'POST' && path === '/api/v1/charges/create') {
      const requestId = String(body.request_id ?? '');
      this.claimRequestId(requestId, 'charge');
      if (!this.state.accounts.some((item) => item.id === body.source)) {
        fail(400, 'invalid_argument', 'source must be an existing acct_ id.');
      }
      if (!body.reason || !body.reference) {
        fail(400, '001', 'reason and reference are required (reference is validated first).');
      }
      const currency = String(body.currency ?? 'USD');
      this.move(
        this.wallet(String(body.source)),
        this.state.platformBalances,
        currency,
        Number(body.amount),
        // charges/create uses its own insufficient-funds code.
        'insufficient_fund',
      );
      const record = {
        id: `chg_${randomUUID().slice(0, 8)}`,
        request_id: requestId,
        amount: Number(body.amount),
        currency,
        source: String(body.source),
        reason: body.reason,
        reference: body.reference,
        status: 'NEW',
        created_at: nowIso(),
      };
      this.state.moneyMoves.set(record.id, record);
      return { status: 201, data: record };
    }

    const moneyMoveMatch = path.match(/^\/api\/v1\/(?:connected_account_transfers|charges)\/([^/]+)$/);
    if (method === 'GET' && moneyMoveMatch) {
      const record = this.state.moneyMoves.get(moneyMoveMatch[1]!);
      if (!record) fail(404, 'not_found', 'Resource not found.');
      if (record.status === 'NEW') record.status = 'SETTLED';
      return { status: 200, data: record };
    }

    if (method === 'POST' && path === '/api/v1/platform_reports/create') {
      // type is validated before file_format.
      if (!body.type) fail(400, 'field_required', 'type is required.');
      if (!body.file_format) fail(400, 'field_required', 'file_format is required.');
      const report = {
        id: `rpt_${randomUUID().slice(0, 8)}`,
        type: body.type,
        file_format: body.file_format,
        status: 'READY',
        url: `https://mock-reports.local/${randomUUID()}.csv`,
        created_at: nowIso(),
      };
      this.state.platformReports.push(report);
      return { status: 201, data: report };
    }

    // --- Billing: customers and one-off invoices (kit 14) ---

    if (method === 'POST' && path === '/api/v1/billing/billing_customers/create') {
      const requestId = String(body.request_id ?? '');
      this.claimRequestId(requestId, 'billing_customer');
      const id = `bcus_${randomUUID().slice(0, 10)}`;
      const customer = {
        id,
        name: body.name ?? null,
        email: body.email ?? null,
        type: body.type ?? 'INDIVIDUAL',
        created_at: nowIso(),
      };
      this.state.billingCustomers.set(id, customer);
      return { status: 201, data: customer };
    }

    if (method === 'GET' && path === '/api/v1/billing/billing_customers') {
      return { status: 200, data: { items: [...this.state.billingCustomers.values()] } };
    }

    if (method === 'POST' && path === '/api/v1/billing/invoices/create') {
      const requestId = String(body.request_id ?? '');
      this.claimRequestId(requestId, 'invoice');
      for (const field of ['billing_customer_id', 'currency']) {
        if (body[field] === undefined) fail(400, 'field_required', `${field} is required.`);
      }
      if (!this.state.billingCustomers.has(String(body.billing_customer_id))) {
        fail(404, 'resource_not_found', 'Billing customer not found.');
      }
      const number = String(body.number ?? `INV-MOCK-${randomUUID().slice(0, 6).toUpperCase()}`);
      if ([...this.state.invoices.values()].some((entry) => entry.number === number)) {
        fail(400, 'validation_error', `Duplicated invoice number: ${number}`);
      }
      const id = `inv_${randomUUID().slice(0, 10)}`;
      const invoice = {
        id,
        number,
        billing_customer_id: body.billing_customer_id,
        currency: body.currency,
        collection_method: body.collection_method ?? 'OUT_OF_BAND',
        status: 'DRAFT',
        payment_status: 'UNPAID',
        total_amount: 0,
        amount_due: 0,
        line_items: [] as Record<string, any>[],
        created_at: nowIso(),
      };
      this.state.invoices.set(id, invoice);
      return { status: 201, data: invoice };
    }

    if (method === 'GET' && path === '/api/v1/billing/invoices') {
      return { status: 200, data: { items: [...this.state.invoices.values()] } };
    }

    const invoiceLinesMatch = path.match(/^\/api\/v1\/billing\/invoices\/([^/]+)\/line_items$/);
    if (method === 'GET' && invoiceLinesMatch) {
      const invoice = this.state.invoices.get(invoiceLinesMatch[1]!);
      if (!invoice) fail(404, 'not_found', 'Invoice not found.');
      return { status: 200, data: { items: invoice.line_items } };
    }

    const invoiceAddLinesMatch = path.match(/^\/api\/v1\/billing\/invoices\/([^/]+)\/add_line_items$/);
    if (method === 'POST' && invoiceAddLinesMatch) {
      const invoice = this.state.invoices.get(invoiceAddLinesMatch[1]!);
      if (!invoice) fail(404, 'not_found', 'Invoice not found.');
      if (invoice.status !== 'DRAFT') {
        fail(400, 'validation_error', 'Line items can only be added to a DRAFT invoice.');
      }
      this.claimRequestId(String(body.request_id ?? ''), 'invoice_line_items');
      const items = (body.line_items ?? []) as Record<string, any>[];
      if (!Array.isArray(items) || items.length === 0) {
        fail(400, 'field_required', 'line_items must be a non-empty array.');
      }
      let added = 0;
      for (const item of items) {
        const price = (item.price ?? {}) as Record<string, any>;
        const quantity = Number(item.quantity ?? 1);
        const amount =
          price.pricing_model === 'FLAT'
            ? Number(price.flat_amount ?? 0)
            : Number(price.unit_amount ?? 0) * quantity;
        added = Math.round((added + amount) * 100) / 100;
        invoice.line_items.push({
          id: `li_${randomUUID().slice(0, 8)}`,
          description: item.description ?? '',
          quantity,
          amount: Math.round(amount * 100) / 100,
        });
      }
      invoice.total_amount = Math.round((invoice.total_amount + added) * 100) / 100;
      invoice.amount_due = invoice.total_amount;
      return { status: 201, data: invoice };
    }

    const invoiceFinalizeMatch = path.match(/^\/api\/v1\/billing\/invoices\/([^/]+)\/finalize$/);
    if (method === 'POST' && invoiceFinalizeMatch) {
      const invoice = this.state.invoices.get(invoiceFinalizeMatch[1]!);
      if (!invoice) fail(404, 'not_found', 'Invoice not found.');
      if (invoice.status !== 'DRAFT') {
        fail(400, 'validation_error', 'Only a DRAFT invoice can be finalized.');
      }
      if (invoice.line_items.length === 0) {
        fail(400, 'validation_error', 'An invoice needs at least one line item to finalize.');
      }
      invoice.status = 'FINALIZED';
      invoice.finalized_at = nowIso();
      return { status: 200, data: invoice };
    }

    const invoicePayMatch = path.match(/^\/api\/v1\/billing\/invoices\/([^/]+)\/mark_as_paid$/);
    if (method === 'POST' && invoicePayMatch) {
      const invoice = this.state.invoices.get(invoicePayMatch[1]!);
      if (!invoice) fail(404, 'not_found', 'Invoice not found.');
      if (invoice.status !== 'FINALIZED' || invoice.payment_status === 'PAID') {
        fail(400, 'validation_error', 'Only a FINALIZED unpaid invoice can be marked paid.');
      }
      invoice.payment_status = 'PAID';
      invoice.amount_due = 0;
      invoice.paid_at = nowIso();
      invoice.paid_out_of_band = true;
      return { status: 200, data: invoice };
    }

    const invoiceMatch = path.match(/^\/api\/v1\/billing\/invoices\/([^/]+)$/);
    if (method === 'GET' && invoiceMatch) {
      const invoice = this.state.invoices.get(invoiceMatch[1]!);
      if (!invoice) fail(404, 'not_found', 'Invoice not found.');
      return { status: 200, data: invoice };
    }

    fail(400, 'invalid_endpoint', `Mock transport has no route for ${method} ${path}.`);
  }

  private claimRequestId(requestId: string, kind: string): void {
    if (!requestId) fail(400, 'field_required', 'request_id is required.');
    if (this.state.requestIds.has(requestId)) {
      fail(400, 'duplicate_request_id', `request_id ${requestId} was already used for a ${kind}.`);
    }
    this.state.requestIds.set(requestId, kind);
  }

  private validateBeneficiary(beneficiary: Record<string, any> | undefined): void {
    if (!beneficiary) fail(400, '001', 'beneficiary is required.');
    const bank = beneficiary.bank_details as Record<string, any> | undefined;
    if (!bank) fail(400, '001', 'beneficiary.bank_details is required.');
    const country = String(bank.bank_country_code ?? '');
    const accountCurrency = String(bank.account_currency ?? '');
    if (country === 'US' && accountCurrency === 'USD') {
      if (!['Checking', 'Savings'].includes(String(bank.bank_account_category))) {
        fail(400, '016', 'bank_account_category must be exactly Checking or Savings.');
      }
      const routing = String(bank.account_routing_value1 ?? '');
      if (!/^\d{9}$/.test(routing)) {
        fail(400, '010', 'account_routing_value1 must be a valid 9-digit ABA routing number.');
      }
      if (String(bank.account_routing_type1 ?? '') !== 'aba') {
        fail(400, '011', 'account_routing_type1 must be aba for US USD local.');
      }
    } else if (country === 'GB' && accountCurrency === 'GBP') {
      if (String(bank.account_routing_type1 ?? '') !== 'sort_code') {
        fail(400, '011', 'account_routing_type1 must be lowercase sort_code for GB local.');
      }
    } else if (String(bank.iban ?? '')) {
      if (!ibanChecksumValid(String(bank.iban))) {
        fail(400, '083', 'iban checksum validation failed.');
      }
      if (!bank.swift_code) fail(400, '010', 'swift_code is required alongside iban.');
    }
  }

  private cardView(card: MockCard): Record<string, unknown> {
    return {
      card_id: card.card_id,
      cardholder_id: card.cardholder_id,
      card_status: card.card_status,
      card_number: card.card_number,
      form_factor: card.form_factor,
      authorization_controls: card.authorization_controls,
      created_at: card.created_at,
    };
  }

  private cardLimits(card: MockCard): Record<string, unknown> {
    const limits = (card.authorization_controls.transaction_limits as Record<string, any> | undefined)?.limits as
      | { interval: string; amount: number }[]
      | undefined;
    const currency =
      (card.authorization_controls.transaction_limits as Record<string, any> | undefined)?.currency ?? 'USD';
    return {
      currency,
      limits: (limits ?? []).map((limit) => ({
        interval: limit.interval,
        amount: limit.amount,
        remaining:
          limit.interval === 'PER_TRANSACTION'
            ? limit.amount
            : round2(limit.amount - (card.spent[limit.interval as 'MONTHLY' | 'ALL_TIME'] ?? 0)),
      })),
    };
  }

  private findCardTransaction(id: string): MockCardTransaction {
    const transaction = this.state.cardTransactions.find((item) => item.card_transaction_id === id);
    if (!transaction) fail(404, 'not_found', `Card transaction ${id} not found.`);
    return transaction;
  }

  private debitWallet(accountId: string | undefined, currency: string, amount: number): void {
    const wallet = this.wallet(accountId);
    const balance = wallet[currency] ?? 0;
    if (balance < amount) fail(400, 'insufficient_fund', `Insufficient ${currency} balance.`);
    wallet[currency] = round2(balance - amount);
  }

  private simulateCardTransaction(
    body: Record<string, any>,
    accountId: string | undefined,
  ): MockCardTransaction {
    const amount = Number(body.transaction_amount ?? NaN);
    const currency = String(body.transaction_currency ?? '');
    const mcc = String(body.merchant_category_code ?? '');
    const merchantInfo = String(body.merchant_info ?? 'Sandbox merchant');
    const singlePhase = Boolean(body.single_phase);

    const card =
      this.state.cards.find((item) => item.card_id === body.card_id) ??
      this.state.cards.find((item) => item.card_number.includes(String(body.card_number ?? '').slice(-4)));
    if (!card) fail(404, 'not_found', 'Card not found.');
    const controls = card.authorization_controls as Record<string, any>;
    const limits = (controls.transaction_limits as Record<string, any> | undefined)?.limits as
      | { interval: string; amount: number }[]
      | undefined;
    const limitFor = (interval: string): number | undefined =>
      limits?.find((limit) => limit.interval === interval)?.amount;

    let failureReason: string | undefined;
    if (card.card_status === 'CLOSED') failureReason = 'CARD_CLOSED';
    else if (card.card_status !== 'ACTIVE') failureReason = 'CARD_INACTIVE';
    else if (body.transaction_failure_reason) failureReason = String(body.transaction_failure_reason);
    else if (
      Array.isArray(controls.allowed_currencies) &&
      controls.allowed_currencies.length > 0 &&
      !controls.allowed_currencies.includes(currency)
    ) {
      failureReason = 'CURRENCY_NOT_ALLOWED';
    } else if (
      Array.isArray(controls.allowed_merchant_categories) &&
      controls.allowed_merchant_categories.length > 0 &&
      !controls.allowed_merchant_categories.includes(mcc)
    ) {
      failureReason = 'MERCHANT_CATEGORY_NOT_ALLOWED';
    } else if (limitFor('PER_TRANSACTION') !== undefined && amount > limitFor('PER_TRANSACTION')!) {
      failureReason = 'LIMIT_EXCEEDED';
    } else if (
      limitFor('MONTHLY') !== undefined &&
      round2(card.spent.MONTHLY + amount) > limitFor('MONTHLY')!
    ) {
      failureReason = 'LIMIT_EXCEEDED';
    } else if (
      limitFor('ALL_TIME') !== undefined &&
      round2(card.spent.ALL_TIME + amount) > limitFor('ALL_TIME')!
    ) {
      failureReason = 'LIMIT_EXCEEDED';
    } else if ((this.wallet(accountId)[currency] ?? 0) < amount) {
      failureReason = 'INSUFFICIENT_FUNDS';
    }

    const approved = failureReason === undefined;
    const transaction: MockCardTransaction = {
      card_transaction_id: `ctx_${randomUUID().slice(0, 8)}`,
      card_id: card.card_id,
      type: approved && singlePhase ? 'CLEARING' : 'AUTHORIZATION',
      subtype: approved && singlePhase ? 'CLEARING' : 'AUTHORIZATION',
      process_result: approved ? 'APPROVED' : 'DECLINED',
      ...(failureReason ? { failure_reason: failureReason } : {}),
      transaction_amount: amount,
      transaction_currency: currency,
      merchant: { name: merchantInfo, category_code: mcc },
      masked_card_number: card.card_number,
      transacted_at: nowIso(),
      // Declined card transactions end in FAILED, never CANCELLED.
      status: approved ? 'PENDING' : 'FAILED',
    };
    this.state.cardTransactions.push(transaction);

    if (approved && singlePhase) {
      card.spent.MONTHLY = round2(card.spent.MONTHLY + amount);
      card.spent.ALL_TIME = round2(card.spent.ALL_TIME + amount);
      this.debitWallet(accountId, currency, amount);
    }
    return transaction;
  }
}
