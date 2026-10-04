import { join } from 'node:path';
import { loadConfig, requireCredentials, type Config } from './config.js';
import { AirwallexClient } from './core/client.js';
import { isAirwallexError } from './core/errors.js';
import { RequestIds } from './core/ids.js';
import { createLogger } from './core/log.js';
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
import { runSetup } from './setup.js';

const USAGE = `
Airwallex hackathon starter — treasury, purchases, payment ops, disputes,
and platform kits for connected accounts.

Usage:
  npm run setup                Fund the sandbox wallet (simulated deposit)
  npm run kit1                 Adaptive Treasury Controller (recommended)
  npm run kit2                 Intent-Bound Purchase Agent
  npm run kit3                 Payment Ops Incident Commander
  npm run kit4                 Dispute Response Agent
  npm run kit5                 Platform Spend Controller      (connected accounts)
  npm run kit6                 Multi-Employer Payroll Executor (connected accounts)
  npm run kit7                 Portfolio Lending Agent         (connected accounts)
  npm run kit8                 Marketplace Settlement Agent    (connected accounts)
  npm run kit9                 Approval-Bound Shopping Agent   (Airi checkout)
  npm run kit10                Merchant-Enabled Agentic Checkout (merchant catalog)
  npm run all                  Run all ten kits against the same client

Kits 5-8 need platform access, kit 9 needs Airi CLI access and kit 10 needs
merchant-side Agentic Commerce: email devhelp@airwallex.com with your sandbox
email and Client ID. In mock mode they all run without any credentials.

Flags:
  --mock                       Use the in-memory sandbox simulator (no credentials)
  --live                       Force real sandbox calls even if MOCK is set
  --fresh                      Rotate persisted request ids (live) so new payments are created
  --no-auto-approve            Require an interactive prompt for approvals
  --heuristic                  Force the deterministic analyst (no Claude call)
  --deposit=<amount>           Setup deposit in major units (default 13000)
  --no-deposit                 Setup without simulating a deposit
`.trim();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args.find((arg) => !arg.startsWith('-')) ?? 'help';
  const config: Config = loadConfig();

  if (args.includes('--mock')) config.mock = true;
  if (args.includes('--live')) config.mock = false;

  const logger = createLogger();
  const client = AirwallexClient.create(config);

  if (!config.mock) {
    requireCredentials(config);
    if (args.includes('--fresh')) {
      RequestIds.clear(join(config.dataDir, 'request-ids.json'));
      logger.info('Fresh run: persisted request ids rotated, so new payments will be created.');
    } else {
      logger.info(
        'Request ids persist under .data/ — a re-run resumes instead of re-paying. Use --fresh to rotate them.',
      );
    }
  } else {
    logger.info('MOCK mode: every call runs against the in-memory sandbox simulator.');
  }

  const autoApprove = !args.includes('--no-auto-approve');
  const depositArg = args.find((arg) => arg.startsWith('--deposit='));
  const depositUsd = depositArg ? Number(depositArg.split('=')[1]) : undefined;

  switch (command) {
    case 'setup':
      await runSetup(client, logger, {
        ...(depositUsd !== undefined ? { depositUsd } : {}),
        skipDeposit: args.includes('--no-deposit'),
      });
      break;
    case 'kit1':
      await runKit1(client, logger, {
        autoApprove,
        ...(args.includes('--heuristic') ? { forceHeuristicAnalyst: true } : {}),
      });
      break;
    case 'kit2':
      await runKit2(client, logger);
      break;
    case 'kit3':
      await runKit3(client, logger);
      break;
    case 'kit4':
      await runKit4(client, logger);
      break;
    case 'kit5':
      await runKit5(client, logger);
      break;
    case 'kit6':
      await runKit6(client, logger);
      break;
    case 'kit7':
      await runKit7(client, logger);
      break;
    case 'kit8':
      await runKit8(client, logger);
      break;
    case 'kit9':
      await runKit9(client, logger, { autoApprove });
      break;
    case 'kit10':
      await runKit10(client, logger);
      break;
    case 'all':
      await runKit1(client, logger, {
        autoApprove,
        ...(args.includes('--heuristic') ? { forceHeuristicAnalyst: true } : {}),
      });
      await runKit2(client, logger);
      await runKit3(client, logger);
      await runKit4(client, logger);
      await runKit5(client, logger);
      await runKit6(client, logger);
      await runKit7(client, logger);
      await runKit8(client, logger);
      await runKit9(client, logger, { autoApprove });
      await runKit10(client, logger);
      break;
    default:
      process.stdout.write(`${USAGE}\n`);
  }
}

main().catch((error: unknown) => {
  const message = isAirwallexError(error)
    ? error.summary
    : error instanceof Error
      ? error.message
      : String(error);
  process.stderr.write(`\nFailed: ${message}\n`);
  process.stderr.write(
    'Check .env credentials, sandbox enablement, and whether the wallet is funded. Run with --mock to try the simulator.\n',
  );
  process.exitCode = 1;
});
