# Airwallex Developer Lab — Agentic Starter (Kits 1–16)

A TypeScript starter for the Airwallex sandbox hackathon, built around one rule:
**the model reads, the code decides, the API moves the money.** Sixteen starter kits share a typed
REST client, a platform/connected-account layer, a policy layer, an approval gate, an in-memory
sandbox simulator, and merchant Agentic Commerce + finance-ops simulators so every demo runs end
to end with or without credentials.

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
| 9. Approval-Bound Shopping Agent | `npm run kit9` | Re-approve when product, merchant, total or fulfillment changes — and report every payment result to Airi before any retry |
| 10. Merchant-Enabled Agentic Checkout | `npm run kit10` | Snapshot prices into checkout sessions, refuse stale charges, and return the same order on a retry |
| 11. Invoice-Matching Reconciliation Agent | `npm run kit11` | Match every receipt to its invoice — exact, deduction, partial, overpayment, duplicate, unmatched — and prove the AR and cash identities |
| 12. Zero-Day Close Agent | `npm run kit12` | Cutoff, revaluation and accrual calls, a balanced double-entry journal, and a trial balance tied to the wallet |
| 13. AR Collections Agent | `npm run kit13` | Proportionate pressure per overdue invoice — reminder, plan, escalation, write-off — decided from aging, history and risk |
| 14. Contract-to-Cash Billing Agent | `npm run kit14` | Issue, hold or partially bill each contract from its parsed terms — then collect and reconcile every dollar |
| 15. Supplier Onboarding Agent | `npm run kit15` | Validate supplier bank details in code, create the beneficiary, and verify each corridor with a funded transfer |
| 16. FX Exposure Hedger | `npm run kit16` | Hedge foreign surpluses to the market view, buy shortfalls regardless, re-hedge when obligations move |

Kits 1–4 and 11–16 run with a plain sandbox account. Kits 5–8 need **platform access** (connected accounts +
platform payments), kit 9 needs **Airi CLI access** and kit 10 needs **merchant-side Agentic
Commerce** — all enabled on request; see
[`submission/enablement-requests.md`](submission/enablement-requests.md) for ready-to-send emails.
Until access lands, kits 5–10 run fully in mock mode.

For the official challenge mapping — reconciliation, treasury, collections, payouts, spend policy,
close — see [`submission/CHALLENGE.md`](submission/CHALLENGE.md). Recorded live sandbox runs —
kits 1, 2, 3, 11, 12, 13, 14, 15 and 16, real time, no mock — are attached to the repo's
[releases](https://github.com/everyai-com/airwallex-hackathon/releases/tag/live-kit1-demo-2026-10-04).

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

## Web dashboard (all sixteen kits in the browser)

`web/` is a Next.js dashboard that runs every kit through `src/web-runner.ts` — same code paths
as the CLI, mock or live, with the full chapter/decision event stream rendered per kit:

```sh
cd web && npm install && npm run dev   # http://localhost:3000
```

Pick a kit, choose mock or live (live needs the root `.env` sandbox keys), and watch the agent
observe, decide, act and reconcile. Production build: `npm run build && npm run start`.

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
Kits 5–8 need platform access, kit 9 needs Airi CLI access and kit 10 needs merchant-side Agentic
Commerce: email [devhelp@airwallex.com](mailto:devhelp@airwallex.com) with your sandbox email and
Client ID (templates in `submission/enablement-requests.md`), then run them live with the same
commands. Until then they all run in mock mode.

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

### Kit 9 — Approval-Bound Shopping Agent (`src/kits/kit9-shopping`)

A procurement mission — "highest rated espresso machine under USD 500 delivered by Friday" —
searches the merchant catalog (`commerce-catalog.ts`, 106 deterministic listings). The agent
prices every listing × fulfillment option and picks the Gaggia Classic Evo Pro from CremaCo: USD
464 delivered, expedited in 2 days (the standard tier is rejected by the deadline; the Bambino
Plus by the budget; the cheaper Dedica by rating). The approval is bound to a fingerprint of
**product + merchant + total + fulfillment** and recorded with its evidence.

Then the merchant feed contradicts the choice: CremaCo's listing is backordered. The agent
re-plans to the same machine from RoastWorks at USD 484 — the fingerprint changes in three
dimensions (product, merchant, total), so the old approval cannot cover it and the gate raises a
**fresh approval**. The checkout then snapshots the price, and the agent verifies the checkout
total equals the approved total before paying with Airi one-click.

The Airi CLI contract is enforced in code (`AiriReportGuard`): the first attempt is declined with
`AUTHENTICATION_EXPIRED`; a retry is **refused until the failure is reported to Airi**; after the
report, a second attempt with a new `request_id` succeeds and the order (`MO-2026-····`) is
returned. The closing ledger shows both approvals, both reports, and that the approved total
equals the executed total.

### Kit 10 — Merchant-Enabled Agentic Checkout (`src/kits/kit10-checkout`)

The merchant side of the same rails: load the catalog, expose the product-search tool (text
tokens plus category/price/stock filters and deterministic pagination), and take an agent through
checkout. The checkout snapshots prices at creation and is idempotent by `request_id` — asking
twice returns the same session, never a second cart. When the supplier price moves after the
snapshot, completion is refused with `price_changed` and a revised checkout is issued; a session
created with `ttl 0` is refused with `checkout_expired` and flipped to `EXPIRED`. The revised
session is paid on the hosted test page (sandbox card `4035501000000008`), producing an order with
a merchant order number; repeating the completion with the same `request_id` returns that same
order — the retry contract never creates a second charge (one payment intent, one order).

### Kit 11 — Invoice-Matching Reconciliation Agent (`src/kits/kit11-reconciliation`)

The receive-money loop the challenge opens with. Eight bank-feed receipts land against an open AR
book of USD 43,500 and EUR 26,000, and the agent matches every one:

- **Exact** — a wire referencing INV-1042 is applied in full.
- **Deduction** — Datawise short-pays by USD 120. The analyst reads the remittance advice
  (`readRemittance`), extracts the invoice reference and flags the claimed credit note; the
  tolerance policy computes `max(USD 25, 2%)` = USD 85, so the USD 120 deduction needs a bound
  human approval before it is written off.
- **Partial** — Northwind pays USD 5,500 of INV-1041; USD 2,900 stays open.
- **Unreferenced** — a bare wire from Bluepeak matches one invoice by payer + exact amount.
- **Duplicate** — the same Northwind wire arrives twice; the second is held as unapplied cash,
  never applied twice.
- **Overpayment** — Cascade's USD 10,400 settles INV-1047 with USD 500 left as customer credit.
- **Unmatched** — USD 3,400 from a new payer matches nothing; held with a person to ask.

The closing chapter proves two identities in code and fails the run if either breaks:
`opening = applied + written off + still open` and `wallet = starting cash + applied + credits +
unapplied`. Nothing is written off, credited or held without a threshold saying so.

### Kit 12 — Zero-Day Close Agent (`src/kits/kit12-close`)

The close kit keeps a real mini-ledger (`ledger.ts`: every journal entry must balance before it
can be posted, and the trial balance is the proof). It decides the period-end calls — a wire at
16:40 books to this period, one at 17:05 defers — revalues the EUR position from the book rate
(1.09) to the closing rate (1.0869) for an USD 86.80 presentation loss, posts the prepaid and
payroll accruals, and closes with a balanced 13-account trial balance whose cash ties out to the
wallet per currency. Verdict: **CLOSED** (zero-day), with the deferred wire and unapplied cash
assigned as next-period follow-ups.

### Kit 13 — AR Collections Agent (`src/kits/kit13-collections`)

The overdue book as of 2026-11-05: six open invoices plus one forgotten USD 60 balance. The agent
decides proportionate pressure per invoice — a friendly reminder for good payers, a firm notice
before escalation, a payment plan for customers who keep promises, one escalation for a
high-risk repeat offender (bound approval + analyst-written note), and an autonomous small-balance
write-off because chasing costs more than the balance. A 7-day cooldown stops a second chase on a
customers contacted two days ago. Then new information: Cascade replies offering 40% now and the
balance in three weeks — the plan policy accepts it (floor 30%, max 30 days), the first USD 3,960
really lands, and the book reconciles: `opening = recovered + written off + still open`.

### Kit 14 — Contract-to-Cash Billing Agent (`src/kits/kit14-billing`)

Three inbound contracts land as raw text. The analyst reads each one and flags only the billing
shape — net terms, milestone billing, a disputed line — with verbatim citations; `policy.ts`
parses every line, quantity, amount, date and milestone in code. The clean USD 8,000 PO issues and
finalizes immediately; the milestone contract bills 50% on signing and holds the rest until a
delivery confirmation (new information, analyst-read, code-confirmed) unlocks it; the disputed PO
bills its USD 4,500 of clean lines and escalates the USD 1,200 workshop line through a bound
approval, because it exceeds the `max(USD 25, 2%)` tolerance. Every invoice is a real Billing API
object — DRAFT → line items → FINALIZED, with hosted payment URLs — collected by bank transfer and
marked paid as the deposits land. The run closes on the identity
`issued = paid + open` plus a wallet-delta tie-out, and fails if either breaks. A contract the
analyst and the parser read differently is held for a person instead of billed.

### Kit 15 — Supplier Onboarding Agent (`src/kits/kit15-onboarding`)

Three supplier onboarding letters arrive as raw text. The analyst flags only the shape — bank
details present, multiple countries signalled, anything missing — with verbatim citations;
`policy.ts` extracts every field and checksums it in code: ABA (3-7-1), IBAN (mod-97), SWIFT format,
sort-code shape. The US and German letters validate and onboard immediately (schema check, then the
beneficiary, then a USD 25 / EUR 25 verification transfer driven to PAID); the UK letter signals
two corridors and a short sort code, so it is held and escalated with approval. Then new
information: a corrected letter lands, the analyst re-reads it clean, the code re-validates, and
the GBP beneficiary onboards with its own PAID verification. The run closes on three beneficiaries,
three PAID verifications and a per-currency wallet tie-out — resumed transfers count zero new
spend, so re-runs never double-pay.

### Kit 16 — FX Exposure Hedger (`src/kits/kit16-hedging`)

The treasury loop for currency risk. The analyst reads two market notes into direction and
confidence with verbatim citations; `policy.ts` maps the view to a hedge ratio (full / half /
hold) and computes net exposure per currency from balances minus obligations. EUR 3,000 of surplus
sells to USD on a weakening view while a GBP 1,000 shortfall is bought whatever the steady view
says — obligations dominate. Then new information: Steinmetz pulls EUR 2,000 forward, the hedge
has overshot, and the agent buys back exactly the new shortfall. Every conversion books a fresh
single-use quote; the run closes with every foreign obligation covered, USD above the floor, and
a per-currency exposure report.

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
                            (forecast confidence, remittance reading, escalation notes)
    money.ts, parse.ts, log.ts
  api/                      balances, global accounts + deposits, fx, beneficiaries, transfers,
                            issuing, payments/disputes, files, accounts, platform money movement,
                            billing (customers + one-off invoices)
  kits/                     kit1-treasury … kit16-hedging, shared.ts, platform-shared.ts,
                            commerce-catalog.ts (merchant catalog + search),
                            commerce-merchant.ts (hosted checkout + order/Airi contract),
                            billing-shared.ts (receivables book + aging),
                            kit12-close/ledger.ts (double-entry journal + trial balance)
  setup.ts                  Global Account + simulated deposit
  cli.ts                    command dispatch
tests/                      policy unit tests + mock end-to-end runs of all sixteen kits
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
- **Purchases are approval-bound**: an approval covers product + merchant + total + fulfillment,
  and a material change voids it in code (`kit9-shopping/policy.ts`).
- **Airi retries require the previous result to be reported first**; the report-before-retry guard
  refuses otherwise.
- **Merchant checkouts snapshot prices, expire after an hour, and replay orders by `request_id`**,
  so a stale price is refused and a retry returns the same order instead of a second charge.
- **Live sandbox quirks the code absorbed**: `GET /balances/current` returns a bare array live
  (the mock wraps it in `items`); global-account list items carry the currency inside
  `required_features`; transfers require `source_currency` and start `SCHEDULED`; FX quotes require
  `validity`; conversions and deposits post a few seconds after they report success, so payouts
  wait for the funded balance; live SWIFT fees are percentage-based while the mock models the
  documented flat EUR 12.85. Kits 1–3 and 11–16 are verified end to end against
  `api.sandbox.airwallex.com`; kit 4 waits on native Payment Acceptance enablement and kits 5–10
  on platform/Airi/merchant access (see `submission/enablement-requests.md`).
- **Receivables rules live in code**: deductions clear autonomously only within a
  `max(USD 25, 2%)` tolerance, duplicates are held as unapplied cash, unmatched receipts over
  USD 1,000 need a person, and the AR and cash identities must close or the run fails.
- **The close proves itself**: every journal entry must balance before posting, and the trial
  balance and per-currency cash tie-out run before the close verdict is printed.
- **Duplicate locks and tenant isolation live in code**, never in prompts.
- Sandbox simulation calls sit behind the shared `api/` functions, so the decision logic never
  calls a simulator directly and live calls can replace mock ones one function at a time.

### REST vs MCP

This project calls REST directly (the developer MCP cannot send `x-on-behalf-of`, which kits 5–8
need, and MCP has no FX conversion tool); kits 9–10 keep the merchant Agentic Commerce surface in
an in-process simulator until that access lands. If your agent has the docs MCP at
`https://mcp.sandbox.airwallex.com/docs` connected, use it to check exact payload fields before
live runs. FX conversions, beneficiary validation, dispute challenges and all simulation calls are
REST here on purpose.

## Tests

```sh
npm run typecheck
npm test          # node:test — policy unit tests + all sixteen kits end to end in mock mode
```

## Extending

- Replace scenario data in the kit sources (`kit1-treasury/scenario.ts`, `kit4-dispute/cases.ts`,
  and the scenario constants at the top of the other kits' `index.ts` / `policy.ts`).
- Swap the mock transport for live by removing `MOCK` (or pass `--live`).
- Add a kit by copying the `policy.ts` + `planner.ts` split: keep money math pure and testable,
  keep approvals bound, and let only the `index.ts` orchestrator make API calls.
- Kits 9–10 are built mock-first like 5–8: their merchant Agentic Commerce surface is simulated
  in-process (`commerce-catalog.ts`, `commerce-merchant.ts`) until Airi CLI and merchant access
  land — both request templates are in `submission/enablement-requests.md`.
- Kits 11–16 need no new enablement: they run live on a plain sandbox account and mock-first
  everywhere else (`billing-shared.ts` holds the receivables book; `submission/CHALLENGE.md`
  maps every challenge domain to a kit).
- A reusable starting point for platform kits: `src/kits/platform-shared.ts` (`openConnectedAccount`,
  `fundCustomerWallet`) and `src/api/platform.ts` (`connectedAccountTransfer`, `collectCharge`,
  `createPlatformReport`).

## Safety

Sandbox only: synthetic counterparties, no real money, no live credentials. Never commit `.env`.
