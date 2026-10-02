# Demo script — how to run this and win

The judges score one thing: **does an agent make a financial decision that changes
when the balance, deadline, evidence or risk changes — and move money with it?**
Every kit below is built around that, with the thresholds in code.

## 0. Setup (2 minutes)

```sh
npm install --include=dev        # note: NODE_ENV=production skips dev deps otherwise
npx tsx src/cli.ts all --mock    # smoke-test all eight kits, no credentials
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
| New information | "A customer email contradicts the receipt forecast. Confidence drops 0.86 → 0.42, so the autonomous conversion limit drops USD 6,500 → USD 500 and the same conversion now needs a person." | `NEEDS APPROVAL` + approval gate bound to amount/currency/counterparty/evidence |
| Deposit | "The forecast receipt actually lands." | Simulated deposit posts immediately (response says PENDING) |
| Revised decision | "Only decisions the new cash changes are reopened — Lowly still deferred, Helios still escalated." | Recalculated plan |
| Outcome | "One FX conversion (minimum amount, SWIFT fee included, single-use quote) and the supplier payment; reserve confirmed above the floor." | Final wallet + reserve vs floor |

Talking points judges love:
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

- [ ] `npm run typecheck` clean
- [ ] `npm test` — 19 passing tests (policy unit tests + all eight kits end to end)
- [ ] `npx tsx src/cli.ts all --mock` exits 0
- [ ] Live sandbox run of Kit 1 recorded (goal → plan → new info → revised decision → outcome)
- [ ] Enablement emails sent from `submission/enablement-requests.md` (platform, Airi, merchant)
- [ ] `.env` never committed; screen recording blurs credentials if shown
- [ ] Repo link + one-paragraph summary: "eight agentic banking starter kits; the
      recommended Treasury controller decides fund/convert/defer/escalate from a
      reserve floor and forecast confidence, with every threshold in code and every
      approval bound to what the approver saw."
