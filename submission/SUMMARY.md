# Submission summary — Airwallex Developer Lab (Agentic Starter)

**Repo:** https://github.com/everyai-com/airwallex-hackathon

Eighteen agentic banking starter kits covering the official challenge domains —
reconciliation, treasury, collections, payouts, spend policy and close. The recommended Treasury
controller decides fund/convert/defer/escalate from a reserve floor and forecast confidence; the
receive-money reconciliation kit matches every bank-feed receipt and proves the AR and cash
identities; the close kit posts a balanced journal with a trial balance tied to the wallet; the
collections kit decides proportionate pressure per invoice. Every threshold is in code and every
approval is bound to what the approver saw. Kits 1–4 and 11–18 run against a plain sandbox
account, kits 5–8 against the in-memory sandbox simulator until platform access lands, and kits
9–10 add an in-process merchant Agentic Commerce simulator on the same rails — every demo runs end
to end with `--mock` and the same code paths switch to live sandbox calls as enablements arrive.

The official challenge map is in `submission/CHALLENGE.md`. Kits 1–3 and 11–18 are also verified
live against the sandbox: beneficiary creation, transfers to PAID, an approval gate, a settled FX
conversion, a SWIFT payout, reconciliation, a full close with a balanced trial balance, and the
collections plan recovery all ran on `api.sandbox.airwallex.com`. A recorded live run of Kit 1 is
attached to the repo's releases.

## Verify in one command

```sh
npm install
npx tsx src/cli.ts all --mock   # all eighteen kits end to end, exit 0, no credentials
npm test                        # 71 passing tests
```

## Contents

- Web dashboard (`web/`) running all eighteen kits mock-or-live in the browser
- Pitch (`submission/PITCH.md`): 30-second hook, differentiation, numbers, 90-second demo script, Q&A prep
- Kits 1–18 as described in `README.md`, each following the same narrative shape:
  goal → initial plan → new information → revised decision → financial outcome or escalation.
- `submission/CHALLENGE.md` — every official challenge domain mapped to a kit, plus the
  Observe → Decide → Act → Reconcile loop.
- `submission/DEMO.md` — judge-facing demo script and submission checklist.
- `submission/enablement-requests.md` — the exact access requests for live runs
  (platform, Airi CLI, merchant Agentic Commerce, partner credits).
