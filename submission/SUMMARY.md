# Submission summary — Airwallex Developer Lab (Agentic Starter)

**Repo:** https://github.com/everyai-com/airwallex-hackathon

Ten agentic banking starter kits; the recommended Treasury controller decides fund/convert/defer/escalate from a reserve floor and forecast confidence, with every threshold in code and every approval bound to what the approver saw. Kits 1–4 run against a plain sandbox account, kits 5–8 against the in-memory sandbox simulator until platform access lands, and kits 9–10 add an in-process merchant Agentic Commerce simulator (catalog, product search, hosted checkout) on the same rails — every demo runs end to end with `--mock` and the same code paths switch to live sandbox calls as enablements arrive.

## Verify in one command

```sh
npm install
npx tsx src/cli.ts all --mock   # all ten kits end to end, exit 0, no credentials
npm test                        # 38 passing tests
```

## Contents

- Kits 1–10 as described in `README.md`, each following the same narrative shape:
  goal → initial plan → new information → revised decision → financial outcome or escalation.
- `submission/DEMO.md` — judge-facing demo script and submission checklist.
- `submission/enablement-requests.md` — the exact access requests for live runs
  (platform, Airi CLI, merchant Agentic Commerce, partner credits).
