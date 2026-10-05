/**
 * Standalone webhook receiver — a real HTTP endpoint for the reactor policy.
 *
 *   npx tsx src/kits/kit17-webhooks/receiver.ts [port]
 *   curl -X POST localhost:3101/hooks -H 'Content-Type: application/json' \
 *     -d '{"id":"evt_1","type":"transfer.paid","data":{"transfer_id":"trf_x"}}'
 *
 * The receiver classifies every delivery with the kit policy and keeps the
 * dedupe context for the life of the process, exactly like a production
 * webhook worker. API-touching reactions (reconcile, retry) run inside the
 * kit, where credentials and the audit log live.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { decideWebhookReaction, type Reaction, type ReactionContext } from './policy.js';
import type { WebhookEvent } from './events.js';

export interface Receiver {
  server: Server;
  port: number;
  handled: Reaction[];
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function isEvent(value: unknown): value is WebhookEvent {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.type === 'string';
}

export function createReceiver(context?: ReactionContext): {
  server: Server;
  handled: Reaction[];
} {
  const reactionContext: ReactionContext = context ?? {
    seenEventIds: new Set<string>(),
    replacementsUsed: new Map<string, number>(),
  };
  const handled: Reaction[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST' || request.url !== '/hooks') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'POST JSON deliveries to /hooks' }));
      return;
    }
    let body: unknown;
    try {
      body = await readJson(request);
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Body must be JSON.' }));
      return;
    }
    if (!isEvent(body)) {
      response.writeHead(422, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Delivery needs string id and type fields.' }));
      return;
    }
    const reaction = decideWebhookReaction(
      { ...body, createdAt: new Date().toISOString(), data: (body.data ?? {}) as Record<string, unknown> },
      reactionContext,
    );
    reactionContext.seenEventIds.add(reaction.eventId);
    handled.push(reaction);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ reaction: reaction.kind, reason: reaction.reason }));
  });
  return { server, handled };
}

const invoked = process.argv[1]?.endsWith('receiver.ts') ?? false;
if (invoked) {
  const port = Number(process.argv[2] ?? 3101);
  const { server } = createReceiver();
  server.listen(port, () => {
    process.stdout.write(`Webhook receiver listening on http://localhost:${port}/hooks\n`);
  });
}
