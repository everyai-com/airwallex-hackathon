# The challenge, mapped — Agentic Banking Hackathon

The official challenge: build AI agents that do real finance work across
**reconciliation, treasury, collections, payouts, spend policy, and close** —
around the loop Airwallex calls agentic speed:
**Observe → Decide → Act → Reconcile → Repeat**.

This repo answers every domain with a kit that runs end to end (`--mock`) and
keeps every threshold in code, never in a prompt.

## Domain coverage

| Domain | Kit(s) | The decision it demonstrates |
| --- | --- | --- |
| Reconciliation | **Kit 11** `kit11-reconciliation` | Match each bank-feed receipt to the invoice it settles — exact, deduction, partial, overpayment, duplicate, unmatched — while the analyst reads the remittance advice and the code owns tolerance and approvals |
| Treasury | **Kit 1** `kit1-treasury`, **Kit 16** `kit16-hedging`, **Kit 18** `kit18-netting` | Fund / convert / defer / escalate five obligations under a reserve floor and a forecast-confidence commitment limit; hedge FX exposure to the market view and re-hedge when obligations move; net intercompany legs to minimal settlements, excluding disputes |
| Collections | **Kit 13** `kit13-collections` | Proportionate pressure per overdue invoice: reminder, firm notice, payment plan, escalation or small-balance write-off — with cooldowns and plan thresholds |
| Payouts | **Kit 3** `kit3-incident`, **Kit 6** `kit6-payroll`, **Kit 7** `kit7-lending`, **Kit 8** `kit8-marketplace`, **Kit 15** `kit15-onboarding`, **Kit 17** `kit17-webhooks` | Wait / replace / escalate without double-paying; tenant-isolated payroll; floor-bounded advances; net settlement with recomputed reserves; doc-driven beneficiary onboarding with checksums and verification transfers; webhook reactions with dedupe, single retry and escalation |
| Spend policy | **Kit 2** `kit2-purchase`, **Kit 5** `kit5-platform-spend` | Card controls that encode a cash decision; rationed bridge capital across connected accounts |
| Close | **Kit 12** `kit12-close` | Zero-day close: cutoff calls, FX revaluation, accruals, a balanced double-entry journal, and a trial balance tied to the wallet |
| Billing (receivables extension) | **Kit 14** `kit14-billing` | Contract-to-cash: parse PO/contract terms in code, issue real one-off invoices, hold milestones and disputes by policy, collect and reconcile |

## The loop, in the three new finance kits

- **Kit 11 — reconciliation:** observe the bank feed → decide the match per
  receipt (pure policy) → act (apply, hold or escalate; approvals bound to the
  exact decision) → reconcile the AR identity *and* the cash identity against
  the wallet. Duplicate receipts are held, never applied twice.
- **Kit 12 — close:** observe the month → decide what policy posts and what a
  person must sign → act by posting a balanced journal → reconcile via the
  trial balance and the cash tie-out per currency.
- **Kit 13 — collections:** observe the overdue book with customer history →
  decide a proportionate action per invoice → act (plans, notices, one
  approved escalation) → reconcile `opening = recovered + written off + still
  open` and the wallet delta.

## Model reads, code decides

The analyst layer (`src/core/analyst.ts`) reads remittance advice now as well:
it extracts invoice references and deduction claims with verbatim citations,
and nothing else. Every amount, tolerance and approval decision lives in
`policy.ts` files. With `ANTHROPIC_API_KEY` set the analyst asks Claude and
falls back to the deterministic heuristic on any failure; without a key it
uses the heuristic directly.

## Partner alignment

- **Visa / Metal:** money moves on Airwallex rails (balances, transfers, FX,
  platform money movement); kits 2, 5 and 9 exercise card controls end to end.
- **Claude:** the analyst only ever produces judgment — direction, confidence,
  invoice references, rationale and citations — never amounts or actions.
- **AWS / Base44:** plain Node + TypeScript; every demo runs without
  credentials through the in-memory simulator, so it deploys anywhere.

## Live vs mock

Kits 11–18 need only a plain sandbox account for live runs, like kits 1–4:
run `npm run kit11`, `npm run kit12`, `npm run kit13`, `npm run kit14`, `npm run kit15`, `npm run kit16`, `npm run kit17`, `npm run kit18` without `MOCK`. Kits 5–10
are the enablement-gated ones (platform, Airi, merchant Agentic Commerce) — see
`enablement-requests.md` for the exact requests.
