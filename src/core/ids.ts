import { randomUUID } from 'node:crypto';

/**
 * Generate a request id. Reuse it only when retrying the exact same operation;
 * a fresh id for every new operation. Reusing one inside 7 days makes Airwallex
 * reject the new request with a duplicate-id error.
 */
export function newRequestId(): string {
  return randomUUID();
}

/**
 * Stable per-operation request ids. If a retry is needed for the same logical
 * operation, call forOperation() again with the same key and get the same id;
 * call rotate() only when starting a genuinely new operation.
 */
export class RequestIds {
  private ids = new Map<string, string>();

  forOperation(key: string): string {
    let id = this.ids.get(key);
    if (!id) {
      id = newRequestId();
      this.ids.set(key, id);
    }
    return id;
  }
}
