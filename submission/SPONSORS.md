# Sponsor & Prize Coverage — "win every prize" plan

_Last updated: Oct 6, 2026. Build period runs Oct 25 – Nov 13; registration closes Oct 23._

The strategy: **one repo, one interface per rail.** Airwallex is the fiat brain (accounts, FX,
transfers, cards, payment acceptance, marketplace). Every other sponsor becomes a rail or an
evidence layer behind a small, mock-first interface — so each prize requirement is met by
shipped, tested code, not a promise.

| Prize | Requirement | Status | Where it lives |
| --- | --- | --- | --- |
| Founder's Choice $30K | Open | Ready | Whole repo — 18 kits, 65+ tests, live-verified on Airwallex sandbox |
| Judges' Choice $20K | Open | Ready | `submission/` pitch + 12 live demo clips |
| **Visa $15K** | Visa + Airwallex tooling | **Shipped (v1), parity work scheduled** | `src/core/tap.ts`, Kit 10 chapter, `tests/tap.test.ts` |
| **Metal $15K** | Metal + Airwallex tooling | Planned, adapter interface next | `src/api/settlement-chain.ts` (planned) |
| Claude $10K credits | Use Claude | Live | Analyst layer (`src/core/analyst.ts`) across kits 5–8, 11, 13 |
| AWS credits (TBD) | Use AWS / AgentCore | Planned | `deploy/agentcore/` (planned) |
| Coinbase (CDP) | Partner tooling | Planned | `src/api/stablecoin-rail.ts` (planned) |
| tZERO (T:0 = DayZero) | Partner tooling | Planned — strong fit with Kit 12 | `src/api/dayzero.ts` (planned) |
| Base44 credits (TBD) | Use Base44 | Optional | Judge-facing dashboard rebuild |

## Visa — Trusted Agent Protocol ($15K)

**What it is.** Visa's TAP (github.com/visa/trusted-agent-protocol, developer.visa.com) is an
RFC 9421 message-signature standard, co-developed with Cloudflare, that lets a merchant
cryptographically verify (a) that an agent is a registered agent, (b) that it is bound to this
merchant and this exact operation, and (c) that the signed request is fresh and single-use.
Tags: `agent-browser-auth`, `agent-payer-auth`. Algorithms: Ed25519 (recommended) and RSA-PSS-SHA256.

**Shipped now.**
- `src/core/tap.ts` — Ed25519 request signing (`signTapRequest`) producing RFC 9421
  `Signature-Input`/`Signature` headers over `@method`, `@authority`, `@path` (+`@query`),
  merchant-side verification (`verifyTapRequest`) with an agent registry and nonce replay guard.
- Kit 10 ("Merchant-Enabled Agentic Checkout") now opens with the merchant verifying the agent:
  signed request → ALLOW; tampered path → REFUSE (`bad_signature`); replayed headers → REFUSE
  (`replayed`). Recorded on `Kit10Result.tap` and asserted in `tests/commerce.test.ts`.
- `tests/tap.test.ts` — round-trip, cross-request tamper, unregistered key, expiry, replay.

**Build phase.**
1. RSA-PSS-SHA256 parity so both TAP algorithms verify.
2. Body binding: add `Content-Digest` (RFC 9530) so the signature covers the completion payload.
3. Interop: run Visa's sample agent-registry/CDN-proxy locally and verify our signatures against
   their verifier (and ours against their tap-agent's signatures).
4. Require TAP on the `completeCheckout` path in Kit 10; Kit 9's shopper carries the key.
5. Demo clip: the merchant refusing an unregistered agent and a replay, then accepting the signed one.

**Access needed:** Visa developer center account, TAP sample repo already public; ask the event
Slack for the Visa sponsor channel.

## Metal — on-chain settlement attestation ($15K)

**What it is.** Metal (metallicus.com) is a finance-oriented L0/L1 with an EVM-compatible
Metal L2 (OP-Stack Superchain). Tooling: docs.metalblockchain.org, docs.metall2.com (faucets,
viem bridging, account abstraction, explorers), Metallicus-Partner-Resources (SDKs/contracts),
Metal Pay Connect.

**Plan.** Treat the chain as the *attestation layer for fiat settlement*, not a replacement rail:
- `SettlementRegistry` contract on Metal L2 testnet: one event per Airwallex settlement leg,
  carrying `transferId` hash, currency, amount, timestamp, counterparty hash.
- Interface `SettlementChain` with two implementations: `MockSettlementChain` (offline demos,
  deterministic) and `MetalL2SettlementChain` (viem, testnet RPC, faucet-funded, explorer link).
- Wire into Kit 18 (intercompany netting) and Kit 10's merchant settlement receipt: every
  fiat settlement gets an on-chain, independently checkable receipt. Both prize requirements in
  one flow: Metal tooling + Airwallex tooling, provably.

**Build phase.** Deploy to Metal L2 testnet (needs faucet funds), record tx hashes in the demo,
add the explorer link to the video and README. Mock-first so judge runs work offline.

**Access needed:** Superchain faucet, Metal Discord/Slack + partner-resources intro.

## Claude — analyst layer ($10K credits)

Already live and verified: the model **reads** (remittance advice, bank narrative, policy text)
and code **decides** — thresholds, approvals and postings are deterministic. Used by kits 5–8,
11 (flagship), 13. This repo is itself built with Claude Code. Build phase: expand analyst
coverage to the remaining kits' free-text inputs; keep the "model reads, code decides" rule.

## AWS — Bedrock AgentCore (credits TBD)

**Plan.** Deploy the flagship agent (Kit 11 reconciliation or Kit 12 close) to AgentCore Runtime:
a thin container that boots the same kit code, with AgentCore Gateway exposing the Airwallex
tool surface and AgentCore Observability feeding the audit trail the finance kits already prove.
The deployed agent must behave identically to `npm run kit11` offline. Deliverable: one-click
deploy script + a recorded live session against the sandbox.

**Access needed:** AWS account with Bedrock AgentCore enabled, credits request via event Slack.

## Coinbase CDP — stablecoin rail

**Plan.** `StablecoinRail` interface with mock + CDP implementations:
- x402: a premium data endpoint (e.g., FX research feed) priced in USDC and paid per call via
  a CDP facilitator — agents monetize and pay straight from the same treasury story.
- Optional second settlement leg for payouts where USDC is faster/cheaper than SWIFT (the repo
  already models fees and buffers, so the comparison is quantitative).
Mock-first; live needs CDP API keys.

## tZERO — T:0 (DayZero) accounting API + MCP

**Plan.** Kit 12 (Zero-Day Close) already produces balanced double-entry journals and a trial
balance. DayZero exposes the same concepts as a REST API and an MCP server (integer cents,
dry-run previews on every write, approval gates on high-stakes writes, full audit trail).
Adapter `DayZeroClient` (mock + live):
1. Kit 12 pushes close journals via `dry_run → approval → commit` (mirrors our approval model 1:1).
2. Read back reports to prove the books agree with the Airwallex wallet.
3. MCP: expose the same tools to any MCP client with scoped OAuth 2.1.

**Access needed:** developer account at ondayzero.com/signup (`type=self-managed`), pilot/Slack intro
via the event.

## Base44 — demo console (credits TBD)

Optional: build the judge-facing console (kit catalog, live run traces, sponsor-rail status) as a
Base44 app reading the repo's JSON outputs. Low effort, visible polish; keep the repo itself the
source of truth.

## Access asks (send via event Slack / partner channels)

1. **Visa:** sponsor channel; guidance on TAP sandbox requirements and whether an agent-registry
   entry for the demo agent is possible.
2. **Metal:** partner-resources intro; testnet faucet access; contract deploy guidance.
3. **AWS:** AgentCore credits + enablement; review of the adapter plan.
4. **Coinbase:** CDP account + facilitator access for x402 on testnet.
5. **DayZero (T:0):** developer account + API key; MCP OAuth client for the close kit.
6. **Base44:** credits + workspace.

The consolidated enablement email (`submission/ready-to-send-email.txt`) already requests the
Airwallex-side asks; partner asks go to their channels at build-phase start.

## Build-phase order (Oct 25 → Nov 13)

1. Visa interop + content-digest binding + Kit 9/10 enforcement (protects the $15K).
2. Metal L2 settlement registry + viem adapter + testnet deployment (protects the $15K).
3. DayZero adapter for Kit 12 (partner story; complements Judges' pitch).
4. AgentCore deployment of the flagship kit (AWS credits narrative).
5. x402/stablecoin rail (Coinbase story) — smallest, do last unless credits land.
6. Base44 console only if time remains after the video is cut.
