/**
 * JSON runner for the web dashboard (web/app/api).
 * Prints exactly one JSON object to stdout — kits only emit via Logger.
 *
 * Usage:
 *   npx tsx src/web-runner.ts status
 *   npx tsx src/web-runner.ts run <kit1..kit16> [--mock|--live] [--heuristic]
 */
import { loadConfig, requireCredentials } from './config.js';
import { AirwallexClient } from './core/client.js';
import { isAirwallexError } from './core/errors.js';
import type { Logger } from './core/log.js';
import { runKit1 } from './kits/kit1-treasury/index.js';
import { runKit2 } from './kits/kit2-purchase/index.js';
import { runKit3 } from './kits/kit3-incident/index.js';
import { runKit4 } from './kits/kit4-dispute/index.js';
import { runKit5 } from './kits/kit5-platform-spend/index.js';
import { runKit6 } from './kits/kit6-payroll/index.js';
import { runKit7 } from './kits/kit7-lending/index.js';
import { runKit8 } from './kits/kit8-marketplace/index.js';
import { runKit9 } from './kits/kit9-shopping/index.js';
import { runKit10 } from './kits/kit10-checkout/index.js';
import { runKit11 } from './kits/kit11-reconciliation/index.js';
import { runKit12 } from './kits/kit12-close/index.js';
import { runKit13 } from './kits/kit13-collections/index.js';
import { runKit14 } from './kits/kit14-billing/index.js';
import { runKit15 } from './kits/kit15-onboarding/index.js';
import { runKit16 } from './kits/kit16-hedging/index.js';

type RunEvent =
  | { type: 'chapter'; title: string }
  | { type: 'step'; title: string }
  | { type: 'info'; message: string }
  | { type: 'detail'; label: string; value: string }
  | { type: 'decision'; label: string; reason: string };

interface RunOptions {
  autoApprove: boolean;
  forceHeuristicAnalyst: boolean;
}

type Runner = (
  client: AirwallexClient,
  logger: Logger,
  options: RunOptions,
) => Promise<unknown>;

const RUNNERS: Record<string, Runner> = {
  kit1: (c, l, o) => runKit1(c, l, o),
  kit2: (c, l) => runKit2(c, l),
  kit3: (c, l) => runKit3(c, l),
  kit4: (c, l) => runKit4(c, l),
  kit5: (c, l) => runKit5(c, l),
  kit6: (c, l) => runKit6(c, l),
  kit7: (c, l) => runKit7(c, l),
  kit8: (c, l) => runKit8(c, l),
  kit9: (c, l, o) => runKit9(c, l, { autoApprove: o.autoApprove }),
  kit10: (c, l) => runKit10(c, l),
  kit11: (c, l, o) => runKit11(c, l, o),
  kit12: (c, l) => runKit12(c, l),
  kit13: (c, l, o) => runKit13(c, l, o),
  kit14: (c, l, o) => runKit14(c, l, o),
  kit15: (c, l, o) => runKit15(c, l, o),
  kit16: (c, l, o) => runKit16(c, l, { forceHeuristicAnalyst: o.forceHeuristicAnalyst }),
};

function createCapturingLogger(events: RunEvent[]): Logger {
  return {
    silent: true,
    chapter(title) {
      events.push({ type: 'chapter', title });
    },
    async step(title, fn) {
      events.push({ type: 'step', title });
      await fn();
    },
    info(message) {
      events.push({ type: 'info', message });
    },
    detail(label, value) {
      events.push({ type: 'detail', label, value });
    },
    decision(label, reason) {
      events.push({ type: 'decision', label, reason });
    },
  };
}

function errorMessage(error: unknown): string {
  if (isAirwallexError(error)) return error.summary;
  if (error instanceof Error) return error.message;
  return String(error);
}

async function main(): Promise<void> {
  const [action, kitId, ...flags] = process.argv.slice(2);

  if (action === 'status') {
    const config = loadConfig();
    process.stdout.write(
      `${JSON.stringify({
        live: Boolean(config.clientId && config.apiKey),
        analyst: config.anthropicApiKey ? config.anthropicModel : 'heuristic',
      })}\n`,
    );
    return;
  }

  if (action === 'run' && kitId && RUNNERS[kitId]) {
    const config = loadConfig();
    const live = flags.includes('--live');
    config.mock = !live;
    const events: RunEvent[] = [];
    const started = Date.now();
    try {
      if (live) requireCredentials(config);
      const client = AirwallexClient.create(config);
      const logger = createCapturingLogger(events);
      await RUNNERS[kitId](client, logger, {
        autoApprove: true,
        forceHeuristicAnalyst: flags.includes('--heuristic'),
      });
      process.stdout.write(
        `${JSON.stringify({ ok: true, mode: live ? 'live' : 'mock', durationMs: Date.now() - started, events })}\n`,
      );
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({
          ok: false,
          mode: live ? 'live' : 'mock',
          durationMs: Date.now() - started,
          events,
          error: errorMessage(error),
        })}\n`,
      );
    }
    return;
  }

  process.stderr.write('Usage: web-runner.ts status | run <kit1..kit16> [--mock|--live] [--heuristic]\n');
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  process.stderr.write(`Runner failed: ${errorMessage(error)}\n`);
  process.exitCode = 1;
});
