# Security Policy

## Supported

Latest `main` only — this is an active hackathon repo, not a versioned product.

## Reporting

**Do not open a public issue for secrets or vulnerabilities.** This repo talks
to financial APIs; treat any leak as urgent:

1. If you found a committed secret (API key, token, credentials), contact the
   maintainer privately so it can be rotated and purged.
2. For code vulnerabilities (injection, auth bypass, unsafe money movement),
   describe impact and reproduction privately.

What we guarantee in return: no secrets are committed by policy (`.env` files
are gitignored and CI never sees credentials), demo recordings are scanned for
tokens before upload, and the mock simulator lets anyone verify fixes with
zero credentials.

## Scope notes

- Sandbox API keys have no path to real money, but are still secrets: the same
  code paths run against production with different keys.
- `node:crypto` is used for checksums and Visa TAP signatures; no custom
  cryptography is invented here — report it if you see any.
