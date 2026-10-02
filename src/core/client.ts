import { requireCredentials, type Config } from '../config.js';
import { AirwallexError, TransportError } from './errors.js';
import { liveTransport } from './http.js';
import { MockTransport } from './mock.js';
import type { ApiRequest, HttpMethod, Transport } from './transport.js';

export interface RequestOptions {
  method?: HttpMethod;
  query?: ApiRequest['query'];
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
  /** Send x-on-behalf-of for a connected account. */
  onBehalfOf?: string;
  /** Skip bearer authentication (only the login call does this). */
  noAuth?: boolean;
  /** Use the files host instead of the main API host. */
  filesHost?: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class AirwallexClient {
  private token?: { value: string; expiresAtMs: number };

  constructor(
    readonly config: Config,
    readonly transport: Transport,
  ) {}

  static create(config: Config): AirwallexClient {
    const transport = config.mock ? new MockTransport() : liveTransport();
    return new AirwallexClient(config, transport);
  }

  get isMock(): boolean {
    return this.transport.kind === 'mock';
  }

  /**
   * Demo helper: in mock mode, replace the platform wallet balances so each kit
   * starts from its intended scenario. No-op against the live sandbox.
   */
  seedMockBalances(balances: Record<string, number>): void {
    if (this.transport instanceof MockTransport) {
      this.transport.seed({ balances });
    }
  }

  async login(): Promise<void> {
    const credentials = this.isMock
      ? { clientId: 'mock-client', apiKey: 'mock-key' }
      : requireCredentials(this.config);
    const response = await this.transport.send<{ token: string }>({
      method: 'POST',
      path: '/api/v1/authentication/login',
      baseUrl: this.config.baseUrl,
      headers: {
        'x-client-id': credentials.clientId,
        'x-api-key': credentials.apiKey,
      },
    });
    this.token = {
      value: response.data.token,
      expiresAtMs: Date.now() + 25 * 60_000,
    };
  }

  private async ensureToken(): Promise<void> {
    if (!this.token || Date.now() > this.token.expiresAtMs) {
      await this.login();
    }
  }

  /**
   * Send an authenticated request with light retry handling:
   * - 429 rate limits are retried with backoff (sandbox allows 20 rps global / 10 per endpoint).
   * - GET network errors are retried once. POST retries are the caller's decision,
   *   because a POST retry needs the same request_id (idempotency) or an outcome lookup.
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'POST';
    const headers: Record<string, string> = { ...options.headers };

    if (!options.noAuth) {
      await this.ensureToken();
      headers['Authorization'] = `Bearer ${this.token!.value}`;
    }
    if (options.onBehalfOf) headers['x-on-behalf-of'] = options.onBehalfOf;

    const request: ApiRequest = {
      method,
      path,
      headers,
      baseUrl: options.filesHost ? this.config.filesUrl : this.config.baseUrl,
      ...(options.query ? { query: options.query } : {}),
      ...(options.body !== undefined ? { body: options.body } : {}),
      ...(options.formData ? { formData: options.formData } : {}),
    };

    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await this.transport.send<T>(request);
        return response.data;
      } catch (error) {
        const retryableRateLimit = error instanceof AirwallexError && error.status === 429;
        const retryableNetwork = error instanceof TransportError && method === 'GET';
        const attemptsLeft = attempt < 2;
        if ((retryableRateLimit || retryableNetwork) && attemptsLeft) {
          await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 250));
          continue;
        }
        throw error;
      }
    }
  }
}
