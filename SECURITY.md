# Security

Last review: 2026-10-19 · Scope: `server/` (API, auth, x402 middleware), `contracts/`, `web/`

## Reporting

Found something? Open a private advisory or email the maintainer. Please do not open a public issue for
unpatched vulnerabilities.

## Threat model (short)

| Actor | Can do | Cannot do |
| --- | --- | --- |
| Anyone on the internet | read public chain/DB state, request a nonce, hit paid endpoints (needs payment) | write to another wallet's agents, forge a JWT, get paid data for free |
| Signed-in human | create agents for **its own** wallet, edit **its own** policies/allowlists | touch other wallets' agents |
| Agent (machine) | call paid endpoints inside its policy caps | exceed caps, pay a non-allowlisted merchant, bypass settlement |

Trust boundaries: the JWT is the human identity; the wallet signature is the login proof; the
x402 facilitator is the settlement counterparty; the chain is the source of truth for policies
(chain mode).

## Findings from this review (all fixed)

### HIGH — unauthenticated writes + missing ownership checks (`server/src/app.js`)
`POST /api/agents`, `PUT /api/agents/:id/policy`, `POST /api/agents/:id/{pause,resume}` and
`PUT /api/agents/:id/allowlist` accepted anonymous callers in local mode. An attacker could create
agents in the victim's name (burning their agent quota) and, worse, **change any agent's spend
policy** — lower caps, pause, or add allowlist entries.
*Fix:* every local-mode write now requires a valid Bearer JWT (`requireAuth`), `ownerAddress` must
match the JWT subject, and policy/allowlist/pause/resume verify `agent.owner_address === req.user.address`
(`requireAgentOwner` → `403 forbidden`).

### HIGH — x402 payment bypass in chain mode (`server/src/middleware/x402.js`)
Two ways to get paid data for free:
1. a `PAYMENT-SIGNATURE` header that failed to parse fell through to the **mock settlement** branch, and
2. a well-formed payload was forwarded to the facilitator **without checking the amount or payee** — a
client could settle `1` micro-USDC (or pay an address of its own) and still receive the resource.

*Fix:* chain mode never falls back to the mock path. The payload must parse, and
`validateExactPayment()` binds it to the challenge: scheme `exact`, matching `network`, `to == payTo`,
`value >= maxAmountRequired`, asset == USDC (when supplied), and a `validBefore`/`validAfter` window.
Anything else returns `402 payment_does_not_match_requirements`. The mock path is now unreachable in
chain mode.

### MEDIUM — default JWT secret in production (`server/src/config.js`)
`AUTH_SECRET` fell back to the public string `dev-only-change-me`, so a production deploy missing the
var would accept attacker-forged JWTs for any address (full account takeover).
*Fix:* the server now refuses to start (`throw`) when `NODE_ENV=production`/`VERCEL=1` without
`AUTH_SECRET`. The dev fallback remains for local runs only.

### MEDIUM — Base Verify key name mismatch (`server/src/services/verify.js`)
The demo-mode gate tested `process.env.BASE_VERIFYKEY` while the production call read
`BASE_VERIFY_API_KEY`, so configuring the key still produced **mock verification** (`verified: 1` for
free → sybil-resistance limit bypass).
*Fix:* both use `BASE_VERIFY_API_KEY`. Demo mode is now explicit and only triggers when the key is
genuinely absent.

### LOW — signed message without `Issued At` / `Nonce` accepted (`server/src/auth.js`)
Freshness was only checked when the message happened to contain `Issued At:`, so a signed message
with neither field was a permanent credential.
*Fix:* both fields are now required and validated (`missing_issued_at`, `missing_nonce`, `nonce_expired`).

### LOW — permissive CORS + no rate limiting (`server/src/app.js`)
`cors({ origin: true, credentials: true })` reflected any origin, and auth/paid endpoints had no
throttle (nonce farming, sign-in attempts, paid-endpoint hammering).
*Fix:* CORS is now an allowlist from `CORS_ORIGINS` (comma-separated origins or hosts; empty =
permissive for local dev), plus a small in-memory per-IP limiter on `/api/auth/*` (60/min nonce,
30/min verify) and `/api/paid/*` (120/min), and hardened headers (`X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `x-powered-by` disabled).

### LOW — internal error text leaked (`server/src/app.js`)
`POST /api/auth/verify` returned raw exception messages. Now logged server-side and answered with
`{ error: 'internal' }`.

### Cleanup — dead unauthenticated client (`web/src/lib/api.js`)
Removed an unused fetch wrapper that called write endpoints without a token (would now be rejected);
formatters moved to `web/src/lib/format.js`.

## Verification

`npm run e2e:api` (29 assertions) covers the fixes:

```
create without JWT → 401 · create for foreign owner → 403 · policy on foreign agent → 403
SIWE without Issued At → 401 (missing_issued_at)
x402 payload: valid accepted · redirected payee rejected · underpayment rejected
             · expired authorization rejected · network mismatch rejected · garbage rejected
```

`npm run e2e:ui` (10 checks) confirms the dashboard still creates agents, shows the 3s toast, and
gates the console after sign-out.

## Known limitations / by design

- **Facilitator trust.** Settlement is delegated to the configured `X402_FACILITATOR_URL`; the
  facilitator verifies the EIP-3009 signature and moves the USDC. We verify the *binding*
  (payee/amount/asset/window), not the signature itself. Point `X402_FACILITATOR_URL` at a
  counterparty you trust.
- **x402 payments are not auto-recorded on-chain.** `PolicyEngine.recordSpend` is permissionless, but
  the server has no relayer key, so chain-mode spend history only shows spends that were recorded
  explicitly (the UI's own flow does this from the user's wallet). Add a relayer to close the loop.
- **In-memory limiter + nonce cache.** Per serverless instance; a cold start resets both. Use KV/Redis
  (`Upstash`) if you need hard guarantees across instances.
- **Demo dataset.** The bundled `server/src/db/agentdesk-data.json` contains demo humans/agents. It is
  committed to make the local demo useful; delete it for a clean start.
- **Secrets.** `VITE_*` values are baked into the public JS bundle. Only put public values there
  (never `AUTH_SECRET`, `PRIVY_APP_SECRET`, `DEPLOYER_PRIVATE_KEY`). `DEPLOYER_PRIVATE_KEY` is used
  only by `contracts/scripts/deploy.js`; the server never needs it.
- **Contracts.** `PolicyEngine.recordSpend` is open by design (agents/relayers must be able to log
  spend) and `setMerchantAllowed`/`setPolicy` are `onlyAgentOwner`. Re-audit before mainnet with real
  funds; this code has not been formally audited.
