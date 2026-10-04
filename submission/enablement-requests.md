# Applications & credits — ready to send

Everything you can claim, in one place. Kits 1–4 need nothing beyond a sandbox
account; every other item is an enablement, a budget, or a partner credit that only
Airwallex can grant — so this file contains the exact asks. Kits 9–10 are already
built and run against in-process simulators, so these emails unlock live runs, not
the build.

**Fastest path:** fill `submission/.env.applications` (copy the example) and run
`node submission/send-applications.mjs`. It opens each email as a **draft** in your
mail client; you review and hit send. Nothing is sent automatically. Use
`--all` to open the consolidated email plus the four individual ones (five drafts
in total), or `--print` to just print them.

Recipient for all of them: **devhelp@airwallex.com** (the hackathon support address).
Also ask the hackathon organisers on the kickoff / community channels for the
submission deadline and judging criteria — the SF Tech Week kickoff is Oct 5 and the
prize pool is USD 70k with Visa, Claude Code, Coinbase, Metal, T:0 and AWS as product
partners.

---

## The one consolidated email (covers everything)

**Subject:** Agentic Banking Hackathon — enablements, credits and card budget for sandbox account

```
Hi Airwallex team,

I'm building for the Agentic Banking Hackathon. Here is everything I'd like enabled
or allocated for my sandbox account — happy to split this into separate threads if
easier.

Sandbox email: <your sandbox email>
Client ID: <your Client ID>

1) PLATFORM ACCESS (kits 5-8)
Please enable connected accounts AND platform payments on this sandbox account
(needed for /connected_account_transfers/create and /charges/create). We have four
platform kits built and tested against a simulator:
Platform Spend Controller, Multi-Employer Payroll Executor, Portfolio Lending
Agent, Marketplace Settlement Agent. They are ready to run live immediately.

Also, please enable native Payment Acceptance API access on this sandbox account:
creating payment intents currently returns "This account is not enabled for native
API access" and our disputes demo (kit 4) needs it.

2) AIRI CLI + CARD BUDGET (kit 9)
Airi account email: <the email on your app.airi.com account>
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

Thanks!
```

---

## Individual emails (if you prefer to send them separately)

<details>
<summary>Email A — platform access (kits 5–8)</summary>

**Subject:** Sandbox platform enablement request — connected accounts + platform payments

```
Hi Airwallex team,

I'm building for the Agentic Banking Hackathon with a sandbox account.

Sandbox email: <your sandbox email>
Client ID: <your Client ID>

Could you please enable on this sandbox account:
1. Connected accounts, and
2. Platform payments (needed for POST /connected_account_transfers/create and
   POST /charges/create).

We have four platform kits built and tested against a sandbox simulator (Platform
Spend Controller, Multi-Employer Payroll Executor, Portfolio Lending Agent,
Marketplace Settlement Agent), ready to run live the moment the switches are on.
Thanks!
```
</details>

<details>
<summary>Email B — Airi CLI + pre-funded card budget (kit 9)</summary>

**Subject:** Airi CLI access request — hackathon Approval-Bound Shopping Agent

Create/manage your Airi account at app.airi.com first, then send this with that email.

```
Hi Airwallex team,

I'm building the Approval-Bound Shopping Agent for the Agentic Banking Hackathon
and would like Airi CLI access (allowlisted during internal testing).

Airi account email: <the email on your app.airi.com account>
Sandbox email: <your sandbox email>
Client ID: <your Client ID>

Please include the beta testing instructions, installation and authentication steps.
Please also confirm how to claim the pre-funded, Airwallex-issued card budget for
hackathon teams. Our agent requests a fresh approval whenever the product, merchant,
total or fulfillment choice changes, and reports the payment result back to Airi CLI
before any retry. Thanks!
```
</details>

<details>
<summary>Email C — merchant-side Agentic Commerce (kit 10)</summary>

**Subject:** Merchant-side Agentic Commerce sandbox access + sample catalog format

```
Hi Airwallex team,

I signed up for the sandbox and would like merchant-side Agentic Commerce enabled
so I can build the Merchant-Enabled Agentic Checkout kit.

Sandbox email: <your sandbox email>
Client ID: <your Client ID>

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
will return a merchant order number alongside the payment outcome. Thanks!
```
</details>

<details>
<summary>Email D — credits, budget and prizes (send with the consolidated email or on its own)</summary>

**Subject:** Hackathon credits and partner resources — how do we claim them?

```
Hi Airwallex team,

Could you point me to everything a hackathon team can claim, and the process for
each:
1. Any Airwallex credit or budget allocation for participants
2. Partner credits from the listed product partners (Claude Code / Anthropic, AWS,
   Coinbase, Visa, Metal, T:0) — key names, application links or claim codes
3. The pre-funded Airwallex-issued card budget for Agentic Commerce teams
4. The submission deadline, required deliverables and judging criteria

Sandbox email: <your sandbox email>
Client ID: <your Client ID>

Thanks!
```
</details>

---

## What is NOT claimable (so you don't chase it)

- **Sandbox balances** are simulated and unlimited — there is no credit to claim;
  `POST /simulation/deposit/create` funds you instantly, as many times as you like.
  Nothing to request from anyone.
- **Prizes** (USD 70k pool) are awarded by the judges after submission — the only way
  to "get" them is to submit a strong build. Kit 1 is the recommended recipe; see
  `submission/DEMO.md` for the script that shows it off.

## Tracking

| # | Item | Blocks | Status |
| - | ---- | ------ | ------ |
| 1 | Connected accounts + platform payments | Kits 5–8 live | email ready |
| 2 | Airi CLI allowlist + card budget | Kit 9 live | email ready (needs your Airi email); kit 9 built and running in mock mode |
| 3 | Merchant-side Agentic Commerce | Kit 10 live | email ready; kit 10 built with an in-process merchant simulator |
| 4 | Credit / partner-credit program | — | email ready |
| 5 | Submission deadline + judging criteria | Submission | asked in email 1/4 |

While you wait: `npm run all --mock` runs every kit end to end with no credentials.
