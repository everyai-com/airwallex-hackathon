# Pitch — Agentic Banking Starter Lab

## The 30-second hook

Finance teams drown in unpaid invoices, idle foreign cash, and payout incidents —
while AI demos move toy money with no audit trail. We built **eighteen treasury
agents** where the model reads, the code decides, and the API moves the money:
every run ends on a financial identity, or it fails loudly.

## Problem (15 seconds)

Controllers can't trust AI with money: models invent amounts, retries double-pay,
and "approved" means nobody-knows-what. Sandbox demos hide it because nothing
real moves.

## Solution (30 seconds)

One rule, enforced in architecture: **the model reads, the code decides, the API
moves the money.** The analyst returns judgment with citations — never amounts.
Policy code owns every number, threshold and state machine. Request ids persist,
so re-runs resume instead of re-paying. Approvals bind the approver to exactly
what they saw. Eleven of eighteen kits run **live against the Airwallex sandbox**,
moving real test money through transfers, FX, invoices, cards and deposits.

## Why we win (differentiation)

1. **Live-verified, not mock-only.** 11 kits move real sandbox money end to end;
   every run closes on a reconciling identity (`issued = paid + open`,
   `nets sum to zero`, wallet tie-outs) — or throws.
2. **Idempotency as a feature.** Persisted request ids, duplicate resume, zero-new-
   spend re-runs. Proven in tests and in live `--fresh` runs.
3. **Bound approvals.** The approver approves exactly the evidence shown — no
   blanket auto-approve on money.
4. **Analyst/parser disagreement holds.** When the model and the code read a
   document differently, the kit stops for a person instead of billing on hope.
5. **Credential-free by construction.** No secrets in the repo, none in any of
   the 12 demo recordings (session tokens redacted from output).

## Numbers

| Metric | Value |
| ------ | ----- |
| Starter kits | 18 across 6 challenge domains + billing, onboarding, hedging, webhooks, netting |
| Live-verified on `api.sandbox.airwallex.com` | 11 (kits 1–3, 11–18) |
| Tests (`node:test`, zero-config) | 71 passing |
| Demo videos (real-time, no credentials) | 12 assets on the [live release](https://github.com/everyai-com/airwallex-hackathon/releases/tag/live-kit1-demo-2026-10-04) |
| Dashboard | all 18 kits runnable mock-or-live in the browser |
| Gated kits with exact live errors documented | 6 (kits 4–10, tracked in `enablement-requests.md`) |

## 90-second demo script

- **0:00–0:15 — Hook.** "Watch a treasury agent fund five obligations across
  three currencies — live, on real sandbox rails — and prove every dollar."
- **0:15–1:00 — Flagship.** `npm run kit1`: forecast read, USD 3,200 LOCAL
  transfer to PAID, EUR conversion on a single-use quote, EUR 1,500 SWIFT payout
  funded at 11:59, Lowly still deferred. Outcome identity on screen.
- **1:00–1:20 — Breadth.** Dashboard: run kit 14 (real invoices with hosted
  payment URLs) or kit 15 (ABA/IBAN checksums in code) in one click.
- **1:20–1:30 — Close.** "Eighteen kits, eleven live, sixty-five tests, zero
  credentials. The model reads, the code decides — that is why a controller
  could trust it."

Backup: the 12 release videos play the same arcs if the network drops.

## Q&A prep

- **Why not LangChain / an agent framework?** Money needs determinism: pure
  policy functions, tested state machines and persisted idempotency beat prompt
  chains. The model does what it is good at (reading documents) and nothing else.
- **Mock or live?** Same code paths; the transport swaps. Eleven kits are
  verified live; the gated six fail with the exact sandbox error, documented.
- **What breaks in production?** Settlement delays (handled with bounded waits),
  duplicate deliveries (deduped by id), analyst/model disagreement (held for a
  person). Each has a test and a live scar.
- **What with platform access?** Kits 5–8 run unmodified — the payload fix is
  already in and the runbook is one command per gate.
- **Security?** Secrets only in gitignored `.env`; recordings scanned for
  tokens; approvals bound to evidence; the analyst is read-only by interface.
