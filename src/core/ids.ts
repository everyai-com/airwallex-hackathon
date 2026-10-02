import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Generate a request id. Reuse it only when retrying the exact same operation;
 * a fresh id for every new operation. Reusing one inside 7 days makes Airwallex
 * reject the new request with a duplicate-id error.
 */
export function newRequestId(): string {
  return randomUUID();
}

/**
 * Stable per-operation request ids, optionally persisted to disk.
 *
 * Live-mode safety: with a store path, each operation key maps to the same
 * request id across process restarts. A crash-and-rerun therefore reuses ids,
 * the sandbox rejects the duplicate, and the lookup helpers return the original
 * transfer/conversion instead of creating a second payment. `--fresh` (or
 * deleting the store) deliberately rotates every id.
 *
 * In mock mode no store is passed: every demo run starts from a clean slate.
 */
export class RequestIds {
  private ids = new Map<string, string>();

  constructor(private readonly storePath?: string) {
    if (this.storePath) this.load();
  }

  forOperation(key: string): string {
    let id = this.ids.get(key);
    if (!id) {
      id = newRequestId();
      this.ids.set(key, id);
      this.persist();
    }
    return id;
  }

  /** Always rotate: for values that must be fresh per run (e.g. FX quotes). */
  fresh(): string {
    return newRequestId();
  }

  /** Remove a persisted store so the next operation gets a new id. */
  static clear(storePath: string): void {
    rmSync(storePath, { force: true });
  }

  private load(): void {
    if (!this.storePath || !existsSync(this.storePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.storePath, 'utf8')) as Record<string, string>;
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') this.ids.set(key, value);
      }
    } catch {
      // A corrupt store must never block a payment; start fresh.
      this.ids.clear();
    }
  }

  private persist(): void {
    if (!this.storePath) return;
    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      writeFileSync(this.storePath, JSON.stringify(Object.fromEntries(this.ids), null, 2));
    } catch {
      // Persistence is a safety net, not a prerequisite for moving money.
    }
  }
}
