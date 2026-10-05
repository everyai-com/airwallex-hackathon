# Demo script — how to run this and win

The judges score one thing: **does an agent make a financial decision that changes
when the balance, deadline, evidence or risk changes — and move money with it?**
Every kit below is built around that, with the thresholds in code.

## 0. Setup (2 minutes)

```sh
npm install                      # dev deps included via .npmrc (NODE_ENV=production safe)
npx tsx src/cli.ts all --mock    # smoke-test all fifteen kits, no credentials
```

For the live flagship demo:

```sh
cp .env.example .env             # add AWX_CLIENT_ID and AWX_API_KEY
npm run setup                    # USD 13,000 simulated deposit
npm run kit1                     # the flagship
```

## 1. Flagship — Kit 1, Adaptive Treasury Controller (4–5 minutes)

This is the recommended Treasury recipe, so give it the most screen time.

| Beat | What you say | What the terminal shows |
| ---- | ------------ | ----------------------- |
| Goal | "Five obligations, 72 hours, three currencies, and not enough cash to fund them all while holding a USD 9,000 reserve floor." | Wallet + obligations + initial plan |
| Plan (in code) | "Priority is criticality then deadline; spending is bounded by settled cash above the floor plus a forecast-confidence commitment limit." | FUND Meridian Freight, CONVERT+FUND Steinmetz, DEFER Lowly, ESCALATE Helios |
| Money moves | "The critical freight invoice is paid first because non-payment stops operations." | Transfer → SENT → PAID |
| New information | "A customer email contradicts the receipt forecast — and the analyst layer reads it: direction, confidence, rationale and the sentences it relied on. Only judgment comes from the analyst; the tiers and amounts are code." | Analyst reading `contradicted — confidence 0.42` + cited evidence; autonomous limit 6,500 → 500; `NEEDS APPROVAL` + approval gate bound to amount/currency/counterparty/evidence |
| Deposit | "The forecast receipt actually lands." | Simulated deposit posts immediately (response says PENDING) |
| Revised decision | "Only decisions the new cash changes are reopened — Lowly still deferred, Helios still escalated." | Recalculated plan |
| Outcome | "One FX conversion (minimum amount, SWIFT fee included, single-use quote) and the supplier payment; reserve confirmed above the floor." | Final wallet + reserve vs floor + **decision ledger** |
| Close | "Every action is accounted for: what moved, what waited, what a person must clear." | The ledger table: PAID / CONVERTED / DEFERRED / ESCALATED rows with ids |

Talking points judges love:
- Run `npm run demo` (alias for kit1). With `ANTHROPIC_API_KEY` set the analyst uses Claude and
  cites the email verbatim; without it the deterministic analyst produces the same decision.
  Say that out loud — it shows the model is swappable and the numbers are never model output.
- The conversion converts **the minimum** (5,400 + 12.85 fee − existing EUR balance),
  and the quote is **booked exactly once**.
- FX calls carry **no `x-api-version`**, and the approval is **bound to the exact
  conversion** shown to the approver.
- Everything threshold-shaped is in `policy.ts`, not in a prompt.

## 2. Rapid fire (1 minute each)

- **Kit 2 (Purchase):** annual is 18% cheaper but breaches the floor in week 7 →
  monthly, then the card's `authorization_controls` enforce it: 1,201 → `LIMIT_EXCEEDED`,
  gambling MCC → `MERCHANT_CATEGORY_NOT_ALLOWED`, exactly 1,200 → `CLEARING`, frozen card
  → `CARD_INACTIVE`.
- **Kit 3 (Incident):** `SENT` is never final; the bank return lands as `CANCELLED` with
  `failure_type`; the duplicate lock allows exactly one replacement with a **new
  request_id**, then blocks; both payments are reconciled.
- **Kit 4 (Disputes):** accept the USD 12 claim (fee 15 > risk), challenge the USD 480
  fraud claim with uploaded PDF evidence, sandbox escalates to CHARGEBACK →
  rejection → reasoned accept; the double-escalate fails with
  `validation_error | Dispute transition is not supported`.
- **Kits 5–8 (Platform, mock until access lands):** cards on behalf + rationed bridge
  capital; tenant-isolated payroll with fees priced before conversion; repayments and a
  floor-bounded advance re-decided when a borrower underperforms; seller reserves
  recomputed on carrier-failure evidence and a refund shortfall recovered.
- **Kit 9 (Approval-Bound Shopping):** the merchant feed backorders the approved listing —
  product, merchant and total change, so the old approval is void and a fresh one is raised;
  the Airi payment is declined once, a retry is refused until the result is reported, then
  the retry succeeds. Approved total == executed total.
- **Kit 10 (Merchant Agentic Checkout):** the search tool filters and pages; checkout is
  idempotent by request_id; a stale price is refused (`price_changed`) and an expired session
  is refused (`checkout_expired`); the revised checkout is paid with the sandbox card and a
  retry returns the same order — never a second charge.
- **Kit 11 (Reconciliation — receive-money flagship):** `npm run kit11`. Eight receipts, eight
  decisions: exact, deduction beyond tolerance (analyst-read credit note → bound approval),
  partial, unreferenced, duplicate held, overpayment credited, unmatched held. Closes with both
  identities proven in code: AR and cash.
- **Kit 12 (Close):** `npm run kit12`. A 16:40 wire books, a 17:05 wire defers, EUR revalues for
  an USD 86.80 loss, accruals post, and the close verdict prints only after a balanced trial
  balance and a per-currency cash tie-out.
- **Kit 13 (Collections):** `npm run kit13`. Reminder / firm notice / payment plan / approved
  escalation / small-balance write-off per invoice; a 7-day cooldown; then Cascade accepts a plan
  (40% now) and the first payment lands for real.
- **Kit 14 (Billing — contract-to-cash):** `npm run kit14`. Three raw contracts in: a clean PO
  issues immediately, a milestone contract bills 50% now and 50% on the delivery trigger, a
  disputed PO bills clean lines and escalates the USD 1,200 line with approval. Real Billing API
  invoices with hosted payment URLs; closes on `issued = paid + open` plus a wallet tie-out.
- **Kit 15 (Supplier onboarding):** `npm run kit15`. Three bank-detail letters in: US and German
  suppliers validate (ABA/IBAN checksums in code) and onboard with PAID verification transfers;
  the UK letter is held (two corridors, short sort code) until a corrected letter lands, then it
  onboards too. Resumed runs show zero new spend — never a double-pay.

The full domain map is in [`submission/CHALLENGE.md`](CHALLENGE.md): every official challenge
domain — reconciliation, treasury, collections, payouts, spend policy, close — has a kit.

## 3. If asked "why is this safe / production-shaped?"

- Amounts are major units and rounded at every boundary.
- One `request_id` per logical operation; reused only on retry. `createTransfer`
  treats any non-success as ambiguous and looks the transfer up by `request_id`
  before failing, so retries cannot double-pay.
- Approved/settled/failed state machines are separate for transfers and cards, with
  the sandbox's real vocabularies (`CANCELLED` ≠ FAILED; declined cards end `FAILED`).
- Customer funds are tenant-scoped; kits 6–8 refuse to sum or borrow across wallets.
- Simulation-only calls sit behind the shared API layer and have a one-line swap.

## 4. Submission checklist

- [x] `npm run typecheck` clean
- [x] `npm test` — 58 passing tests (policy unit tests, idempotency, commerce state machines, finance-ops identities, connected-account payload shape, billing parser/decisions, and effect assertions on all fifteen kits)
- [x] `npx tsx src/cli.ts all --mock` exits 0
- [x] Live sandbox run of Kit 1 completed against the real sandbox (2026-10-04): LOCAL transfer PAID, confidence drop → approval gate, FX conversion SETTLED, SWIFT payout PAID
- [x] Live-verified kits 1–3 and 11–15 against the sandbox (kits 14–15 live Oct 5: real invoices issued/collected/reconciled; 3 suppliers onboarded with PAID verifications); kit 4 partially open (intent create/list work, confirm still gated — verified Oct 4); kits 5–8 still gated at business onboarding (verified Oct 4, repo payload fixed); kits 9–10 await the Airi/merchant replies (all tracked in `enablement-requests.md`)
- [x] Live runs recorded for kits 1, 2, 3, 11, 12, 13, 14 and 15 (real time, no credentials shown): [release videos](https://github.com/everyai-com/airwallex-hackathon/releases/tag/live-kit1-demo-2026-10-04)
- [x] Enablement emails sent — the consolidated email to devhelp@airwallex.com went out from Gmail on 2026-10-04 (platform access, native Payment Acceptance, Airi CLI, merchant Agentic Commerce, credits, submission details)
- [x] `.env` never committed (verified absent from git history; `.env`, `.data/` and `submission/.env.applications` are gitignored)
- [x] Recording shows no credentials (terminal text only)
- [x] Repo link + one-paragraph summary: [github.com/everyai-com/airwallex-hackathon](https://github.com/everyai-com/airwallex-hackathon) — summary in `submission/SUMMARY.md`
