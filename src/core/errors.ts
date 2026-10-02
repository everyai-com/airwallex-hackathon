export interface AirwallexErrorOptions {
  status: number;
  code: string;
  message: string;
  body?: unknown;
}

export class AirwallexError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;

  constructor(options: AirwallexErrorOptions) {
    super(options.message);
    this.name = 'AirwallexError';
    this.status = options.status;
    this.code = options.code;
    this.body = options.body;
  }

  /**
   * Sandbox returns different duplicate-id codes across endpoints, and 409
   * request_pending means the original request is still in flight.
   */
  get isDuplicateRequestId(): boolean {
    return [
      'duplicate_request_id',
      'request_id_duplicate',
      'request_id_used',
      'request_pending',
    ].includes(this.code);
  }

  /** Airwallex uses three different codes for the same account state. */
  get isInsufficientFunds(): boolean {
    return ['balance_insufficient', 'insufficient_fund', 'insufficient_funds'].includes(
      this.code,
    );
  }

  get summary(): string {
    return `${this.status} ${this.code}: ${this.message}`;
  }
}

export function errorFromResponse(status: number, body: unknown): AirwallexError {
  const data = (body ?? {}) as Record<string, unknown>;
  const code =
    typeof data.code === 'string'
      ? data.code
      : typeof data.error_code === 'string'
        ? data.error_code
        : `http_${status}`;
  const message =
    typeof data.message === 'string'
      ? data.message
      : typeof data.error === 'string'
        ? data.error
        : typeof data.detail === 'string'
          ? data.detail
          : `Airwallex request failed with status ${status}`;
  return new AirwallexError({ status, code, message, body });
}

export class TransportError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

export function isAirwallexError(error: unknown): error is AirwallexError {
  return error instanceof AirwallexError;
}
