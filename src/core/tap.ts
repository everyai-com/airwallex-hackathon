/**
 * Visa Trusted Agent Protocol (TAP) — a TypeScript implementation of the
 * RFC 9421 message-signature flow Visa publishes at
 * github.com/visa/trusted-agent-protocol, adapted to this repo's rules:
 * the agent signs, the merchant verifies, and replay/tamper defense live in
 * code. Ed25519 keys; the tags match Visa's sample (`agent-browser-auth` for
 * browsing, `agent-payer-auth` for the payment-bound request).
 *
 * This is the integration the Visa Award looks for: an agent proves its
 * identity and its authorization to the merchant before checkout, and the
 * merchant decides from the cryptographic evidence rather than a prompt.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';

export type TapTag = 'agent-browser-auth' | 'agent-payer-auth';

export interface TapAgentKey {
  agentId: string;
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export type TapSignedHeaders = Record<string, string | undefined> & {
  'Signature-Input': string;
  Signature: string;
};

export interface TapVerifyInput {
  method: string;
  authority: string;
  path: string;
  query?: string;
  headers: Record<string, string | undefined>;
  registry: TapAgentRegistry;
  replayGuard?: TapReplayGuard;
  nowSeconds?: number;
  /** Allowed clock skew for created/expires, in seconds. Default 60. */
  skewSeconds?: number;
}

export type TapVerifyResult =
  | { valid: true; agentId: string; keyId: string; tag: TapTag; nonce: string }
  | {
      valid: false;
      code:
        | 'missing_headers'
        | 'malformed_signature_input'
        | 'unregistered_agent'
        | 'unsupported_algorithm'
        | 'not_yet_valid'
        | 'expired'
        | 'bad_signature'
        | 'replayed';
      detail: string;
    };

/** keyId -> { publicKeyPem, agentId }, standing in for Visa's Agent Registry. */
export class TapAgentRegistry {
  private readonly agents = new Map<string, { publicKeyPem: string; agentId: string }>();

  register(entry: { keyId: string; publicKeyPem: string; agentId: string }): void {
    this.agents.set(entry.keyId, { publicKeyPem: entry.publicKeyPem, agentId: entry.agentId });
  }

  lookup(keyId: string): { publicKeyPem: string; agentId: string } | undefined {
    return this.agents.get(keyId);
  }
}

/** Nonces are single-use per merchant; a captured request cannot be replayed. */
export class TapReplayGuard {
  private readonly seen = new Set<string>();

  /** Returns false when the nonce was already used. */
  record(nonce: string): boolean {
    if (this.seen.has(nonce)) return false;
    this.seen.add(nonce);
    return true;
  }
}

export const TAP_ALGORITHM = 'ed25519';

export function generateTapAgent(input: { agentId: string; keyId?: string }): TapAgentKey {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    agentId: input.agentId,
    keyId: input.keyId ?? `${input.agentId}-key-1`,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function tapAgentRegistryEntry(agent: TapAgentKey): {
  keyId: string;
  publicKeyPem: string;
  agentId: string;
} {
  return { keyId: agent.keyId, publicKeyPem: agent.publicKeyPem, agentId: agent.agentId };
}

function signatureBase(input: {
  method: string;
  authority: string;
  path: string;
  query?: string;
  components: string[];
  paramsValue: string;
}): string {
  const lines: string[] = [];
  for (const component of input.components) {
    switch (component) {
      case '@method':
        lines.push(`"@method": ${input.method.toUpperCase()}`);
        break;
      case '@authority':
        lines.push(`"@authority": ${input.authority}`);
        break;
      case '@path':
        lines.push(`"@path": ${input.path}`);
        break;
      case '@query':
        lines.push(`"@query": ?${input.query ?? ''}`);
        break;
      default:
        lines.push(`"${component}": `);
        break;
    }
  }
  lines.push(`"@signature-params": ${input.paramsValue}`);
  return lines.join('\n');
}

/**
 * Produce RFC 9421 `Signature-Input` + `Signature` headers for a request.
 * Covered components default to `@method`, `@authority`, `@path` (and `@query`
 * when present); params carry created/expires/nonce/keyid/alg/tag.
 */
export function signTapRequest(input: {
  key: TapAgentKey;
  method: string;
  authority: string;
  path: string;
  query?: string;
  tag: TapTag;
  /** Seconds; defaults to now / now+300. */
  created?: number;
  expires?: number;
  nonce?: string;
}): TapSignedHeaders {
  const created = input.created ?? Math.floor(Date.now() / 1000);
  const expires = input.expires ?? created + 300;
  const nonce = input.nonce ?? randomUUID();
  const components = input.query ? ['@method', '@authority', '@path', '@query'] : ['@method', '@authority', '@path'];
  const paramsValue =
    `(${components.map((component) => `"${component}"`).join(' ')});` +
    `created=${created};keyid="${input.key.keyId}";alg="${TAP_ALGORITHM}";` +
    `expires=${expires};nonce="${nonce}";tag="${input.tag}"`;

  const base = signatureBase({
    method: input.method,
    authority: input.authority,
    path: input.path,
    ...(input.query !== undefined ? { query: input.query } : {}),
    components,
    paramsValue,
  });

  const signature = sign(null, Buffer.from(base, 'utf8'), createPrivateKey(input.key.privateKeyPem));
  return {
    'Signature-Input': `sig1=${paramsValue}`,
    Signature: `sig1=:${signature.toString('base64')}:`,
  };
}

interface ParsedSignatureInput {
  components: string[];
  params: Record<string, string>;
}

function parseSignatureInput(value: string): ParsedSignatureInput | undefined {
  const match = value.match(/^sig1=\(([^)]*)\)(;.*)$/);
  if (!match) return undefined;
  const componentsRaw = match[1] ?? '';
  const paramsRaw = match[2] ?? '';
  const components = [...componentsRaw.matchAll(/"([^"]+)"/g)].map((entry) => entry[1] ?? '');
  const params: Record<string, string> = {};
  for (const raw of paramsRaw.split(';')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1).replace(/^"|"$/g, '');
    params[key] = value;
  }
  return { components, params };
}

function headerValue(headers: Record<string, string | undefined>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/**
 * Merchant-side verification. Order of checks mirrors what a payment-bound
 * merchant must answer: is the request well formed, is the agent registered,
 * is the signature fresh, does the signature hold, has this nonce been seen?
 */
export function verifyTapRequest(input: TapVerifyInput): TapVerifyResult {
  const signatureInput = headerValue(input.headers, 'Signature-Input');
  const signatureHeader = headerValue(input.headers, 'Signature');
  if (!signatureInput || !signatureHeader) {
    return { valid: false, code: 'missing_headers', detail: 'Signature-Input and Signature headers are both required.' };
  }

  const parsed = parseSignatureInput(signatureInput);
  if (!parsed) {
    return { valid: false, code: 'malformed_signature_input', detail: `Signature-Input did not parse: ${signatureInput.slice(0, 80)}` };
  }
  const { components, params } = parsed;
  for (const required of ['@method', '@authority', '@path']) {
    if (!components.includes(required)) {
      return { valid: false, code: 'malformed_signature_input', detail: `Covered components must include ${required}.` };
    }
  }

  const keyId = params.keyid;
  const nonce = params.nonce;
  if (!keyId || !nonce) {
    return { valid: false, code: 'malformed_signature_input', detail: 'keyid and nonce are required parameters.' };
  }
  if ((params.alg ?? TAP_ALGORITHM) !== TAP_ALGORITHM) {
    return { valid: false, code: 'unsupported_algorithm', detail: `Only ${TAP_ALGORITHM} is supported here, got ${params.alg}.` };
  }

  const registered = input.registry.lookup(keyId);
  if (!registered) {
    return { valid: false, code: 'unregistered_agent', detail: `No registry entry for keyId ${keyId}.` };
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = input.skewSeconds ?? 60;
  const created = Number(params.created);
  const expires = Number(params.expires);
  if (Number.isFinite(created) && created - skew > now) {
    return { valid: false, code: 'not_yet_valid', detail: `Signature created at ${created} is in the future.` };
  }
  if (Number.isFinite(expires) && expires + skew < now) {
    return { valid: false, code: 'expired', detail: `Signature expired at ${expires}.` };
  }

  const signatureValue = signatureHeader.match(/^sig1=:([^:]+):$/)?.[1];
  if (!signatureValue) {
    return { valid: false, code: 'malformed_signature_input', detail: `Signature header did not parse: ${signatureHeader.slice(0, 80)}` };
  }

  const paramsValue = signatureInput.slice('sig1='.length);
  const base = signatureBase({
    method: input.method,
    authority: input.authority,
    path: input.path,
    ...(input.query !== undefined ? { query: input.query } : {}),
    components,
    paramsValue,
  });

  let signatureOk = false;
  try {
    signatureOk = verify(
      null,
      Buffer.from(base, 'utf8'),
      createPublicKey(registered.publicKeyPem),
      Buffer.from(signatureValue, 'base64'),
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    return { valid: false, code: 'bad_signature', detail: 'Ed25519 verification failed for the constructed signature base.' };
  }

  if (input.replayGuard && !input.replayGuard.record(nonce)) {
    return { valid: false, code: 'replayed', detail: `Nonce ${nonce} was already used; replay refused.` };
  }

  const tag = (params.tag ?? '') as TapTag;
  return { valid: true, agentId: registered.agentId, keyId, tag, nonce };
}
