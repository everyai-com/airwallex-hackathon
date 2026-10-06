# Contributing

Thanks for helping — outside contributions are welcome. This repo has a few
hard rules that keep eighteen kits coherent; please follow them and CI will
stay green.

## Ground rules

1. **The model reads, the code decides, the API moves the money.** Analyst
   methods return judgment with citations — never amounts, dates, or account
   numbers. Every number lives in `policy.ts` and is unit-tested.
2. **Mock-first, live-verified.** Every API call must work against the
   in-memory simulator (`src/core/mock.ts`) with zero credentials. Live runs
   are a second pass, never the only path.
3. **Idempotency is a feature.** Mutating calls take persisted `request_id`s;
   re-runs resume instead of re-paying. Add a resume test when you add a
   money-moving call.
4. **No secrets, ever.** `.env` and `submission/.env.applications` are
   gitignored. Never commit keys, tokens, emails, or client IDs — not even
   sandbox ones. Demo output must stay credential-free (redact session tokens).
5. **Kits close on an identity or throw.** A kit run ends by proving its books
   (`issued = paid + open`, nets sum to zero, wallet tie-outs) — not by
   printing vibes.

## Workflow

```sh
npm ci
npm run verify        # typecheck + tests + all kits in mock mode — must exit 0
```

- Put shared API calls in `src/api/`, pure decisions in the kit's `policy.ts`,
  scenarios in `scenario.ts`/`contracts.ts`, orchestration in `index.ts`.
- Add tests in `tests/` next to the kit's siblings: policy unit tests plus a
  mock end-to-end run with effect assertions.
- Update the kit table + section in `README.md`, the rapid-fire entry in
  `submission/DEMO.md`, and counts everywhere (`SUMMARY.md`, `CHALLENGE.md`,
  `web/lib/kits.ts`) when you add a kit.
- The web dashboard (`web/`) must keep building: `cd web && npm run build`.
- Open a PR against `main`. CI runs `verify` plus the web build.

## Good first issues

Look for issues labeled `good first issue`: usually a new kit scenario branch,
an extra policy unit test, or dashboard polish. Ask in the issue if the shape
is unclear — the fastest answer references an existing kit that already does
the same thing.

## Security

Found a secret in the tree or a vulnerability? See [SECURITY.md](SECURITY.md) —
do not open a public issue for it.
