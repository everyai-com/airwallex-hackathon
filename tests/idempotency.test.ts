import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createFxConversion,
  createFxQuote,
} from '../src/api/fx.js';
import { createPaymentIntent, confirmPaymentIntent } from '../src/api/payments.js';
import { createTransfer } from '../src/api/transfers.js';
import { AirwallexClient } from '../src/core/client.js';
import { RequestIds } from '../src/core/ids.js';
import type { Config } from '../src/config.js';

function testClient(): AirwallexClient {
  const config: Config = {
    baseUrl: 'https://api.sandbox.airwallex.com',
    filesUrl: 'https://files.sandbox.airwallex.com',
    mock: true,
    dataDir: '/tmp/awx-test',
    anthropicModel: 'claude-sonnet-4-5',
  };
  return AirwallexClient.create(config);
}

test('request ids persist across processes and rotate when cleared', () => {
  const dir = mkdtempSync(join(tmpdir(), 'awx-ids-'));
  const path = join(dir, 'request-ids.json');

  const first = new RequestIds(path);
  const id = first.forOperation('obl-shipping-transfer');
  assert.ok(id.length >= 10);

  // A "restarted process" reads the same store and gets the same id.
  const second = new RequestIds(path);
  assert.equal(second.forOperation('obl-shipping-transfer'), id);

  // --fresh rotates.
  RequestIds.clear(path);
  const third = new RequestIds(path);
  assert.notEqual(third.forOperation('obl-shipping-transfer'), id);
});

test('a duplicated transfer request resolves to the original, never a second payment', async () => {
  const client = testClient();
  const input = {
    requestId: 'transfer-idempotency-test-0001',
    transferCurrency: 'USD',
    transferAmount: 3_200,
    transferMethod: 'LOCAL' as const,
    reason: 'goods_purchased',
    reference: 'PO-8842',
    beneficiary: { type: 'BANK_ACCOUNT' },
  };
  const first = await createTransfer(client, input);
  const again = await createTransfer(client, input);
  assert.equal(again.id, first.id);
});

test('a duplicated conversion request resolves to the original, never a second conversion', async () => {
  const client = testClient();
  client.seedMockBalances({ USD: 100_000 });
  const quote = await createFxQuote(client, {
    requestId: 'quote-idempotency-test-0001',
    sellCurrency: 'USD',
    buyCurrency: 'EUR',
    buyAmount: 100,
  });
  const input = {
    requestId: 'conversion-idempotency-test-0001',
    sellCurrency: 'USD',
    buyCurrency: 'EUR',
    buyAmount: 100,
    quoteId: quote.id,
  };
  const first = await createFxConversion(client, input);
  const again = await createFxConversion(client, input);
  assert.equal(again.conversionId, first.conversionId);
  assert.equal(first.status, 'SETTLED');
});

test('a duplicated payment intent request resolves to the original', async () => {
  const client = testClient();
  const input = {
    requestId: 'intent-idempotency-test-0001',
    amount: 12,
    currency: 'USD',
    merchantOrderId: 'ORD-9002',
  };
  const first = await createPaymentIntent(client, input);
  const again = await createPaymentIntent(client, input);
  assert.equal(again.id, first.id);
});

test('a duplicated payment intent confirm is rejected and a success clears the failure', async () => {
  const client = testClient();
  const intent = await createPaymentIntent(client, {
    requestId: 'intent-confirm-test-0001',
    amount: 12,
    currency: 'USD',
    merchantOrderId: 'ORD-9003',
  });
  const card = {
    number: '4035501000000008',
    expiryMonth: '12',
    expiryYear: '2027',
    cvc: '123',
    name: 'Sandbox Shopper',
  };

  const failed = await confirmPaymentIntent(client, {
    intentId: intent.id,
    requestId: 'confirm-idempotency-test-0001',
    card,
    simulateFailureReason: 'AUTHENTICATION_EXPIRED',
  });
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.failureReason, 'AUTHENTICATION_EXPIRED');

  await assert.rejects(
    () =>
      confirmPaymentIntent(client, {
        intentId: intent.id,
        requestId: 'confirm-idempotency-test-0001',
        card,
      }),
    /already used/,
  );

  const succeeded = await confirmPaymentIntent(client, {
    intentId: intent.id,
    requestId: 'confirm-idempotency-test-0002',
    card,
  });
  assert.equal(succeeded.status, 'SUCCEEDED');
  assert.equal(succeeded.failureReason, undefined);
});
