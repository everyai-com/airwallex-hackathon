import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateTapAgent,
  signTapRequest,
  TapAgentRegistry,
  TapReplayGuard,
  tapAgentRegistryEntry,
  verifyTapRequest,
} from '../src/core/tap.js';

const REQUEST = {
  method: 'POST',
  authority: 'sandbox.merchant.example',
  path: '/checkout/mch_1/complete',
  query: 'request_id=req-1',
};

function setup(): { registry: TapAgentRegistry; key: ReturnType<typeof generateTapAgent> } {
  const key = generateTapAgent({ agentId: 'shopper-agent-1' });
  const registry = new TapAgentRegistry();
  registry.register(tapAgentRegistryEntry(key));
  return { registry, key };
}

test('tap: a signed agent request verifies, carries identity, and nonce-replays are refused', () => {
  const { registry, key } = setup();
  const replayGuard = new TapReplayGuard();
  const created = 1_800_000_000;
  const expires = created + 300;
  const headers = signTapRequest({ key, ...REQUEST, tag: 'agent-payer-auth', created, expires, nonce: 'n-1' });

  const first = verifyTapRequest({
    ...REQUEST,
    headers,
    registry,
    replayGuard,
    nowSeconds: created + 10,
  });
  assert.equal(first.valid, true);
  if (first.valid) {
    assert.equal(first.agentId, 'shopper-agent-1');
    assert.equal(first.tag, 'agent-payer-auth');
    assert.equal(first.nonce, 'n-1');
  }

  const replayed = verifyTapRequest({
    ...REQUEST,
    headers,
    registry,
    replayGuard,
    nowSeconds: created + 11,
  });
  assert.equal(replayed.valid, false);
  if (!replayed.valid) assert.equal(replayed.code, 'replayed');
});

test('tap: tampering the path, method or registry invalidates verification', () => {
  const { registry, key } = setup();
  const headers = signTapRequest({ key, ...REQUEST, tag: 'agent-payer-auth' });

  const wrongPath = verifyTapRequest({ ...REQUEST, path: '/checkout/other/complete', headers, registry });
  assert.equal(wrongPath.valid, false);
  if (!wrongPath.valid) assert.equal(wrongPath.code, 'bad_signature');

  const wrongMethod = verifyTapRequest({ ...REQUEST, method: 'GET', headers, registry });
  assert.equal(wrongMethod.valid, false);
  if (!wrongMethod.valid) assert.equal(wrongMethod.code, 'bad_signature');

  const emptyRegistry = new TapAgentRegistry();
  const unknown = verifyTapRequest({ ...REQUEST, headers, registry: emptyRegistry });
  assert.equal(unknown.valid, false);
  if (!unknown.valid) assert.equal(unknown.code, 'unregistered_agent');
});

test('tap: RSA-PSS-SHA256 agents verify, and algorithm mismatches are refused', () => {
  const rsa = generateTapAgent({ agentId: 'rsa-shopper', algorithm: 'rsa-pss-sha256' });
  assert.equal(rsa.algorithm, 'rsa-pss-sha256');
  const registry = new TapAgentRegistry();
  registry.register(tapAgentRegistryEntry(rsa));

  const body = '{"checkout_id":"mch_1","request_id":"req-1"}';
  const headers = signTapRequest({ key: rsa, ...REQUEST, tag: 'agent-payer-auth', body });
  assert.ok(headers['Content-Digest']?.startsWith('sha-512=:'));

  const ok = verifyTapRequest({ ...REQUEST, headers, registry, body });
  assert.equal(ok.valid, true);
  if (ok.valid) assert.equal(ok.agentId, 'rsa-shopper');

  const relabeled = {
    ...headers,
    'Signature-Input': headers['Signature-Input'].replace('rsa-pss-sha256', 'ed25519'),
  };
  const mismatch = verifyTapRequest({ ...REQUEST, headers: relabeled, registry, body });
  assert.equal(mismatch.valid, false);
  if (!mismatch.valid) assert.equal(mismatch.code, 'unsupported_algorithm');
});

test('tap: a tampered body fails the content-digest binding', () => {
  const { registry, key } = setup();
  const body = '{"checkout_id":"mch_1","request_id":"req-1"}';
  const headers = signTapRequest({ key, ...REQUEST, tag: 'agent-payer-auth', body });

  const tampered = verifyTapRequest({
    ...REQUEST,
    headers,
    registry,
    body: '{"checkout_id":"mch_2","request_id":"req-1"}',
  });
  assert.equal(tampered.valid, false);
  if (!tampered.valid) assert.equal(tampered.code, 'digest_mismatch');

  const intact = verifyTapRequest({ ...REQUEST, headers, registry, body });
  assert.equal(intact.valid, true);
});

test('tap: expired signatures and modified headers are refused', () => {
  const { registry, key } = setup();
  const created = 1_800_000_000;
  const headers = signTapRequest({
    key,
    ...REQUEST,
    tag: 'agent-browser-auth',
    created,
    expires: created + 60,
  });

  const expired = verifyTapRequest({
    ...REQUEST,
    headers,
    registry,
    nowSeconds: created + 3600,
  });
  assert.equal(expired.valid, false);
  if (!expired.valid) assert.equal(expired.code, 'expired');

  const tamperedHeaders = { ...headers, Signature: `${headers.Signature.slice(0, -4)}AAAA:` };
  const tampered = verifyTapRequest({
    ...REQUEST,
    headers: tamperedHeaders,
    registry,
    nowSeconds: created + 10,
  });
  assert.equal(tampered.valid, false);
  if (!tampered.valid) assert.equal(tampered.code, 'bad_signature');

  const missing = verifyTapRequest({ ...REQUEST, headers: {}, registry });
  assert.equal(missing.valid, false);
  if (!missing.valid) assert.equal(missing.code, 'missing_headers');
});
