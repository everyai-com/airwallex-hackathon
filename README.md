# Airwallex Developer Lab — Agentic Starter (Kits 1–8)

A TypeScript starter for the Airwallex sandbox hackathon, built around one rule:
**the model reads, the code decides, the API moves the money.** Eight starter kits share a typed
REST client, a platform/connected-account layer, a policy layer, an approval gate, and an
in-memory sandbox simulator so every demo runs end to end with or without credentials.

| Kit | Command | The decision |
| --- | --- | --- |
| 1. Adaptive Treasury Controller | `npm run kit1` | Which obligations to fund, convert, defer or escalate when cash is short — and how forecast confidence moves the autonomous limit |
| 2. Intent-Bound Purchase Agent | `npm run kit2` | Annual vs monthly SaaS terms, then card controls that enforce the choice |
| 3. Payment Ops Incident Commander | `npm run kit3` | Wait, replace or escalate a failed supplier transfer — without ever paying twice |
| 4. Dispute Response Agent | `npm run kit4` | Accept, challenge or escalate chargebacks from evidence and the dispute fee |
| 5. Platform Spend Controller | `npm run kit5` | Issue cards to connected accounts and ration bridge funding when deposits arrive late |
| 6. Multi-Employer Payroll Executor | `npm run kit6` | Run payroll per employer without using one employer's funds for another |
| 7. Portfolio Lending Agent | `npm run kit7` | Collect revenue-based repayments and size an advance without breaching the reserve floor |
| 8. Marketplace Settlement Agent | `npm run kit8` | Set seller reserves, pay net proceeds, and recompute one reserve when risk changes |

Kits 1–4 run with a plain sandbox account. Kits 5–8 need **platform access** (connected accounts +
platform payments), which Airwallex enables on request — see
[`submission/enablement-requests.md`](submission/enablement-requests.md) for ready-to-send
emails. Until access lands, kits 5–8 run fully in mock mode.

For the demo script and the submission checklist, see [`submission/DEMO.md`](submission/DEMO.md).

Each demo follows the same narrative shape the brief asks for:
**goal → initial plan → new information → revised decision → financial outcome or escalation.**

## Quick start (no credentials)

```sh
npm install
npm run demo           # alias for kit1, the recommended Treasury recipe
npm run all            # every kit in sequence
```

`npm run all` without a `MOCK` setting needs credentials — add `--mock` to try the simulator:

```sh
npx tsx src/cli.ts all --mock
npx tsx src/cli.ts kit1 --mock
npx tsx src/cli.ts kit1 --mock --heuristic   # force the deterministic analyst
```

In mock mode an in-memory transport mirrors sandbox semantics: balances post immediately after a
simulated deposit, transfers move PROCESSING → SENT → PAID/CANCELLED, card controls produce
`LIMIT_EXCEEDED` / `MERCHANT_CATEGORY_NOT_ALLOWED` / `CARD_INACTIVE`, FX quotes are single-use,
and duplicate `request_id`s are rejected.

## Live sandbox setup

1. Sign up at [sandbox.airwallex.com](https://sandbox.airwallex.com), then copy your Client ID
   and API key from **Account → Developer → API keys**.
2. `cp .env.example .env` and fill in `AWX_CLIENT_ID` and `AWX_API_KEY` (never commit them).
3. Create a USD Global Account and fund it with a simulated deposit:

```sh
npm run setup                 # deposits USD 13,000 by default
npm run setup -- --deposit=20000
npm run setup -- --no-deposit # just create the account and read balances
```

There is no top-up button in the sandbox; `POST /simulation/deposit/create` reports `PENDING`
but posts immediately. About **USD 13,000** produces the intended scarcity in Kit 1.

4. Run the kits:

```sh
npm run kit1        # and kit2, kit3, kit4
npm run kit5        # needs platform access; use --mock meanwhile
```

Kits 1–4 need no platform enablement and no connected accounts. Everything stays in the sandbox.
Kits 5–8 need platform access: email [devhelp@airwallex.com](mailto:devhelp@airwallex.com) with
your sandbox email and Client ID (template in `submission/enablement-requests.md`), then run them
live with the same commands.

## What each kit demonstrates

### Kit 1 — Adaptive Treasury Controller (`src/kits/kit1-treasury`)

Five obligations across USD, EUR and GBP fall due over 72 hours. The planner
(`planner.ts`, pure and unit-tested) ranks by criticality and due date, then spends against two
budgets: settled cash above the reserve floor, plus a commitment limit derived from forecast
confidence (`policy.ts`):

| Forecast confidence | Autonomous commitment limit |
| --- | --- |
| ≥ 0.8 | USD 6,500 |
| 0.5 – 0.8 | USD 3,000 |
| < 0.5 | USD 500 |

The **analyst layer** (`src/core/analyst.ts`) is the "model reads" half of the brief: given the
forecast and the raw customer email, it returns only a direction, a confidence, a rationale and
verbatim citations — never amounts, tiers or floors. With `ANTHROPIC_API_KEY` set it asks Claude
and falls back to the deterministic heuristic on any failure; without a key (tests, CI, `--mock`)
it uses the heuristic directly. This is the literal split the hackathon asks for: the model reads
unstructured text and compares evidence, the code owns every number.

The run: read balances and rates → plan → fund the critical freight invoice → **a customer email
contradicts the receipt forecast**, which the analyst reads and cites, lowering confidence so the
EUR conversion exceeds the autonomous limit and requires a bound human approval → the forecast
receipt lands via a simulated deposit → recalculate (only decisions the new cash changes reopen)
→ one FX conversion (quote booked exactly once, minimum amount, SWIFT fee included) → one supplier
transfer → reserve confirmed above the floor, followed by a **decision ledger** that shows every
fund / convert / defer / escalate with the transfer id where money moved and the reason in every
case. The cheapest obligation stays deferred;
the unsanctioned payee stays escalated with an analyst-written escalation note.

### Kit 2 — Intent-Bound Purchase Agent (`src/kits/kit2-purchase`)

The model reads the vendor quote; `terms.ts` parses it and projects 12 weeks of cash for both
options. Annual pricing is 18% cheaper but breaches the USD 25,000 reserve floor in week 7, so the
agent chooses monthly and records when to reconsider. It then issues a virtual card whose
`authorization_controls` encode that decision, and the sandbox control engine does the enforcing:

- USD 1,201 → `LIMIT_EXCEEDED` (per-transaction limits are inclusive, so 1,200.00 clears)
- MCC 7995 → `MERCHANT_CATEGORY_NOT_ALLOWED` (intent enforced beyond amount)
- USD 1,200 at MCC 5734, single-phase → `transaction_type: CLEARING` (accepted — the demo never
  waits for a status literally named `APPROVED`)
- card frozen → `CARD_INACTIVE` (the agent revokes its own authority mid-run)

### Kit 3 — Payment Ops Incident Commander (`src/kits/kit3-incident`)

A USD 3,200 supplier payout is left at `SENT`, then fails with
`failure_type: BENEFICIARY_BANK_RETURNED`. Note the sandbox convention: failed transfers end in
`CANCELLED`, and `CANCELLED` does not mean a person cancelled it. The state machine
(`state.ts`, pure) decides WAIT (SENT is never final) → REPLACE (retryable failure, funds
available, deadline not passed) and refuses to act when the failure is non-retryable
(`TM_SUSPENDED`), the balance is short, or a duplicate already exists. A `DuplicatePaymentGuard`
locks one payment per incident key, so the replacement uses a **new** `request_id` while a second
attempt is blocked. The closing ledger accounts for both the original and the replacement.

### Kit 4 — Dispute Response Agent (`src/kits/kit4-dispute`)

Three payment intents are created and confirmed with test card `4035501000000008`, then disputes
are staged with Visa reason codes `10.4` (fraud), `13.1` (not received) and `13.6` (credit not
processed). `policy.ts` decides per case from evidence and the configured USD 15 dispute fee
(the sandbox does not deduct it, but the merchant pays it even when winning):

- **Challenge** the large fraud claim: device/IP match three prior undisputed orders, signed delivery
- **Accept** the USD 12 not-received claim: fee exceeds the amount at risk, unsigned delivery scan
- **Escalate** the credit-not-processed case: the customer emailed support twice with no reply —
  that is our failure to fix

Evidence is generated as real PDFs (PNG is rejected by Airwallex) and uploaded over multipart to
`files.sandbox.airwallex.com`. The challenge is escalated by the sandbox simulator to
`CHARGEBACK`, where it returns to `REQUIRES_RESPONSE` as the rejection beat; the agent then
re-evaluates (arbitration cost exceeds exposure) and accepts, recording why. A second escalation
attempt from `CHARGEBACK` is caught and shown to fail with
`validation_error | Dispute transition is not supported`.

### Kit 5 — Platform Spend Controller (`src/kits/kit5-platform-spend`)

You are the platform issuing cards to small businesses, each a connected account with its own
wallet. Customer spend draws on the customer's wallet (never the platform's), and one simulated
authorization shows the ordering rule: a USD 1,500 attempt from a USD 1,000 wallet passes the
USD 2,000 limit check and then declines with `INSUFFICIENT_FUNDS` — fund the wallet if you want
to reach the limit behaviour. When two customers are short on the same
day, `policy.ts` rations bridge capital against the platform reserve floor — one advance is
approved (leaving exactly zero capacity), the other is declined with the reason, then Harbor's late
deposit repays the bridge via `charges/create` and the monthly fee is collected.

### Kit 6 — Multi-Employer Payroll Executor (`src/kits/kit6-payroll`)

Three employers, payroll priced **before** conversion (`assessPayroll` adds one EUR 12.85 SWIFT fee
per payout — converting only the payroll total makes the last contractor's payout fail). Acme's
quote, conversion, beneficiary creation, transfers and simulations all carry `x-on-behalf-of`.
Borealis is short: its payroll is held, and when Cobalt's deposit lands mid-run the books show
Borealis unchanged — the tenant guard refuses to sum or borrow across wallets.

### Kit 7 — Portfolio Lending Agent (`src/kits/kit7-lending`)

Repayments are 8% of revenue that actually lands. Bluefin's revenue is delayed, so a receivable is
recorded instead of a charge that would fail; when revenue lands 50% short, the receivable is
adjusted and only the actual amount is collected. Decision 1 sizes a USD 15,000 advance from
expected receivables (partial, USD 7,800); Decision 2 re-decides with less cash (USD 7,480) and
disburses via `connected_account_transfers`, ending exactly on the USD 20,000 portfolio floor. A
`BALANCE_REPORT` platform report closes the cycle.

### Kit 8 — Marketplace Settlement Agent (`src/kits/kit8-marketplace`)

The platform wallet holds exactly what three sellers are owed. Reserves come from trailing refund
rates, with the newest seller at the highest rate. Before payouts run, a carrier failure raises
that seller's reserve from 10% to 25% — **only that seller is recalculated** — then all three are
paid out net. A USD 1,600 refund recovery is charged back (balance checked first), and the cycle
reconciles: payouts + reserves = owed, platform balance = unreleased reserves. A
`SETTLEMENT_REPORT` platform report closes the cycle.

## Architecture

```
src/
  config.ts                 .env loading, base URLs, MOCK switch
  core/
    client.ts               auth (30-min token, refreshed at 25 min), 429 backoff,
                            persisted request ids, x-on-behalf-of, files host
    http.ts                 live fetch transport          transport.ts  pluggable interface
    mock.ts                 in-memory sandbox simulator (wallets per account, controls, state machines)
    errors.ts               AirwallexError with duplicate/insufficient-funds helpers
    ids.ts                  one stable request_id per operation
    approvals.ts            approval gate bound to amount/currency/counterparty/evidence
    analyst.ts              the "model reads" layer: Claude or deterministic heuristic
    money.ts, parse.ts, log.ts
  api/                      balances, global accounts + deposits, fx, beneficiaries, transfers,
                            issuing, payments/disputes, files, accounts, platform money movement
  kits/                     kit1-treasury … kit8-marketplace, shared.ts, platform-shared.ts
  setup.ts                  Global Account + simulated deposit
  cli.ts                    command dispatch
tests/                      policy unit tests + mock end-to-end runs of all eight kits
submission/                 enablement email templates + demo script + checklist
```

### Sandbox conventions the code enforces

- **Amounts are major units** (`100` is one hundred dollars) and are rounded at every boundary.
- **One `request_id` per logical operation**, reused only on retry; a fresh UUID for each new
  operation. `createTransfer` treats *any* non-success response as ambiguous and looks the
  transfer up by `request_id` before reporting failure, so retries cannot double-pay.
- **FX is REST-only and quote-driven**: a quote is single-use, the minimum amount is converted
  (SWIFT fee included), and `x-api-version` is never sent on FX calls.
- **Card transactions are read by vocabulary, not status name**: `process_result`,
  `failure_reason` and `transaction_type` — REST and MCP use different status words, and declined
  card transactions end in `FAILED` while failed transfers end in `CANCELLED`.
- **Retryable vs non-retryable failure types** are separated in code; a failed transfer reads
  `CANCELLED` (or transiently `FAILED`) and always carries a `failure_type` to branch on.
- **Live payments are idempotent across restarts**: request ids persist under `.data/`, so a
  crash-and-rerun reuses them, the sandbox rejects the duplicate, and the lookup helpers return the
  original transfer/conversion/intent. `--fresh` rotates them deliberately.
- **Duplicate locks and tenant isolation live in code**, never in prompts.
- Sandbox simulation calls sit behind the shared `api/` functions, so the decision logic never
  calls a simulator directly and live calls can replace mock ones one function at a time.

### REST vs MCP

This project calls REST directly (the developer MCP cannot send `x-on-behalf-of`, which kits 5–8
need, and MCP has no FX conversion tool). If your agent has the docs MCP at
`https://mcp.sandbox.airwallex.com/docs` connected, use it to check exact payload fields before
live runs. FX conversions, beneficiary validation, dispute challenges and all simulation calls are
REST here on purpose.

## Tests

```sh
npm run typecheck
npm test          # node:test — policy unit tests + all eight kits end to end in mock mode
```

## Extending

- Replace scenario data in the kit sources (`kit1-treasury/scenario.ts`, `kit4-dispute/cases.ts`,
  and the scenario constants at the top of the other kits' `index.ts` / `policy.ts`).
- Swap the mock transport for live by removing `MOCK` (or pass `--live`).
- Add a kit by copying the `policy.ts` + `planner.ts` split: keep money math pure and testable,
  keep approvals bound, and let only the `index.ts` orchestrator make API calls.
- Kit 9 (Approval-Bound Shopping Agent) needs Airi CLI access — request it with the template in
  `submission/enablement-requests.md`. Kit 10 (Merchant-Enabled Agentic Checkout) needs
  merchant-side Agentic Commerce access; the same file has that request too.
- A reusable starting point for platform kits: `src/kits/platform-shared.ts` (`openConnectedAccount`,
  `fundCustomerWallet`) and `src/api/platform.ts` (`connectedAccountTransfer`, `collectCharge`,
  `createPlatformReport`).

## Safety

Sandbox only: synthetic counterparties, no real money, no live credentials. Never commit `.env`.
