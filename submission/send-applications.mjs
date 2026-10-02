#!/usr/bin/env node
/**
 * Opens the application emails as DRAFTS in your default mail client.
 * Nothing is sent automatically — you review each draft and press send.
 *
 * Setup:
 *   cp submission/.env.applications.example submission/.env.applications
 *   edit submission/.env.applications  (sandbox email, Client ID, Airi email)
 *
 * Usage:
 *   node submission/send-applications.mjs           # consolidated email (recommended)
 *   node submission/send-applications.mjs --all     # consolidated + four individual emails
 *   node submission/send-applications.mjs --print   # print to stdout instead of opening drafts
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '.env.applications');

const env = { ...process.env };
if (existsSync(envFile)) {
  for (const raw of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
}

const missing = ['AWX_SANDBOX_EMAIL', 'AWX_CLIENT_ID', 'AIRI_EMAIL'].filter((key) => !env[key]);
if (missing.length > 0) {
  console.error(
    `Missing ${missing.join(', ')}. Copy submission/.env.applications.example to submission/.env.applications and fill it in.`,
  );
  process.exit(1);
}

const sandboxEmail = env.AWX_SANDBOX_EMAIL;
const clientId = env.AWX_CLIENT_ID;
const airiEmail = env.AIRI_EMAIL;
const mode = process.argv.includes('--print') ? 'print' : 'open';
const all = process.argv.includes('--all');

const consolidated = {
  subject:
    'Agentic Banking Hackathon — enablements, credits and card budget for sandbox account',
  body: `Hi Airwallex team,

I'm building for the Agentic Banking Hackathon. Here is everything I'd like enabled
or allocated for my sandbox account — happy to split this into separate threads if
easier.

Sandbox email: ${sandboxEmail}
Client ID: ${clientId}

1) PLATFORM ACCESS (kits 5-8)
Please enable connected accounts AND platform payments on this sandbox account
(needed for /connected_account_transfers/create and /charges/create). We have four
platform kits built and tested against a simulator: Platform Spend Controller,
Multi-Employer Payroll Executor, Portfolio Lending Agent, Marketplace Settlement
Agent. They are ready to run live immediately.

2) AIRI CLI + CARD BUDGET (kit 9)
Airi account email: ${airiEmail}
Please allowlist Airi CLI for this account and send the beta testing, installation
and authentication instructions. Please also tell me how to claim the pre-funded,
Airwallex-issued card budget that Agentic Commerce teams receive.

3) MERCHANT-SIDE AGENTIC COMMERCE (kit 10)
Please enable merchant-side Agentic Commerce and send: merchant setup/activation
steps, the sample catalog schema + upload/update mechanism (we'll load 100+
synthetic products), the merchant-specific MCP endpoint and permissions, Claude
connection instructions, the product-search tool schema (filters, pagination),
checkout creation/state rules, hosted test-payment details, and the completion /
order-response / retry contract.

4) CREDITS & PARTNER RESOURCES
Could you tell me which hackathon credit or budget programs participants can claim,
and how? Specifically:
- Any Airwallex credit allocation for hackathon teams
- Partner credits for the listed product partners (Claude Code / Anthropic, AWS,
  Coinbase, Visa, Metal, T:0) and how to apply
- Confirmation of the pre-funded card budget above
If there is a claim form or a partner-specific application, please point me to it.

5) SUBMISSION DETAILS
Please confirm the submission deadline, the required deliverables (repo, video,
demo), and the judging criteria, or point me to the page/document that has them.

Thanks!`,
};

const platformEmail = {
  subject: 'Sandbox platform enablement request — connected accounts + platform payments',
  body: `Hi Airwallex team,

I'm building for the Agentic Banking Hackathon with a sandbox account.

Sandbox email: ${sandboxEmail}
Client ID: ${clientId}

Could you please enable on this sandbox account:
1. Connected accounts, and
2. Platform payments (needed for POST /connected_account_transfers/create and
   POST /charges/create).

We have four platform kits built and tested against a sandbox simulator (Platform
Spend Controller, Multi-Employer Payroll Executor, Portfolio Lending Agent,
Marketplace Settlement Agent), ready to run live the moment the switches are on.
Thanks!`,
};

const airiEmail_ = {
  subject: 'Airi CLI access request — hackathon Approval-Bound Shopping Agent',
  body: `Hi Airwallex team,

I'm building the Approval-Bound Shopping Agent for the Agentic Banking Hackathon
and would like Airi CLI access (allowlisted during internal testing).

Airi account email: ${airiEmail}
Sandbox email: ${sandboxEmail}
Client ID: ${clientId}

Please include the beta testing instructions, installation and authentication steps.
Please also confirm how to claim the pre-funded, Airwallex-issued card budget for
hackathon teams. Our agent requests a fresh approval whenever the product, merchant,
total or fulfillment choice changes, and reports the payment result back to Airi CLI
before any retry. Thanks!`,
};

const merchantEmail = {
  subject: 'Merchant-side Agentic Commerce sandbox access + sample catalog format',
  body: `Hi Airwallex team,

I signed up for the sandbox and would like merchant-side Agentic Commerce enabled
so I can build the Merchant-Enabled Agentic Checkout kit.

Sandbox email: ${sandboxEmail}
Client ID: ${clientId}

Could you send:
1. Merchant setup and activation steps for the sandbox merchant/storefront
2. The sample catalog schema, upload method and supported product-update mechanism
   (we will load 100+ synthetic products)
3. The merchant-specific MCP endpoint URL, permissions and Claude connection
   instructions
4. The product-search tool schema (filters and pagination)
5. Checkout creation and state rules, plus the hosted test-payment component details
6. The completion, order-response and retry/idempotency contract

We will use synthetic catalog and shopper data and sandbox test cards only, and we
will return a merchant order number alongside the payment outcome. Thanks!`,
};

const creditsEmail = {
  subject: 'Hackathon credits and partner resources — how do we claim them?',
  body: `Hi Airwallex team,

Could you point me to everything a hackathon team can claim, and the process for
each:
1. Any Airwallex credit or budget allocation for participants
2. Partner credits from the listed product partners (Claude Code / Anthropic, AWS,
   Coinbase, Visa, Metal, T:0) — key names, application links or claim codes
3. The pre-funded Airwallex-issued card budget for Agentic Commerce teams
4. The submission deadline, required deliverables and judging criteria

Sandbox email: ${sandboxEmail}
Client ID: ${clientId}

Thanks!`,
};

const emails = all
  ? [consolidated, platformEmail, airiEmail_, merchantEmail, creditsEmail]
  : [consolidated];

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

for (const email of emails) {
  if (mode === 'print') {
    process.stdout.write(`\n===== ${email.subject} =====\n${email.body}\n`);
    continue;
  }
  const url = `mailto:devhelp@airwallex.com?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;
  await execFileAsync('open', [url]);
  await sleep(1_000);
}

if (mode === 'print') {
  process.stdout.write('\n(print mode: nothing was opened)\n');
} else {
  process.stdout.write(
    `Drafts opened in your mail client (${emails.length}). Review and send each one.\n`,
  );
}
