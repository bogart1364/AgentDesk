# AgentDesk API Reference

Base URL: `http://localhost:8787`

## Health

```
GET /api/health
→ { ok, service, version, ts, db: { humans, agents, spendLogs } }
```

## Auth (JWT login)

Both flows return the same 7-day HMAC JWT. Send it on every call as
`Authorization: Bearer <token>`.

```
# A) SIWE — wallet sign-in (default when PRIVY_APP_ID is not set)

GET /api/auth/nonce?address=0x…
→ { nonce, message, expiresAt }

POST /api/auth/verify
body: { address, message, signature }
→ { ok: true, token, address }
```

```
# B) Privy — email / social / wallet modal (when PRIVY_APP_ID is set)

POST /api/auth/verify
body: { privyIdentityToken, address }   # identity token from getIdentityToken(),
                                         # address = active wallet (must be linked)
→ { ok: true, token, address }
# 401 if the token is invalid/expired or the wallet is not linked to that user
```

## Base Verify (social identity → identityHash)

```
POST /api/auth/verify-social          [requires JWT]
body: { siweMessage, signature, provider: "x"|"coinbase"|"instagram"|"tiktok" }
→ { identityHash, verified, provider, demo? }
```

One verified identity → up to **5 agents**. Unverified → **1 agent**.

## Profile

```
GET /api/me?address=0x…
→ { human, agents[] }
```

## Agents

```
POST /api/agents
body: { ownerAddress, name, description? }
→ 201 Agent + policy        (default: $5/tx, $50/day, $500/mo)

GET /api/agents?address=0x… → Agent[]

GET /api/agents/:id
→ { …agent, policy: { …, spentToday, spentThisMonth, dailyRemaining, monthlyRemaining },
    allowlist[], recentSpend[] }

PUT /api/agents/:id/policy
body: { perTxCapUsd?, dailyBudgetUsd?, monthlyBudgetUsd?, useAllowlist?,
        timeWindowEnabled?, timeStartHour?, timeEndHour? }

POST /api/agents/:id/pause     → kill-switch
POST /api/agents/:id/resume

PUT /api/agents/:id/allowlist
body: { merchant: "0x…", label?, allowed? }
```

## Live feed

```
GET /api/feed?limit=50
→ [{ id, agent_id, merchant, amount, amountDisplay, endpoint, tx_hash, status, created_at }]
```

## x402 paid endpoints

```
GET /api/paid                 → resource catalog (free)
GET /api/paid/:slug           → 402 challenge without payment
GET /api/paid/market-data?agentId=1
  Header: payment-signature: <any>   → 200 resource + settlement proof
```

- Slugs: `market-data`, `news-brief`, `agent-scan`
- Price: **$0.01 USDC** per call → `10000` micro-USDC
- Denied by policy → `403 { error: "policy_denied", reason }`
- Reasons: `agent_inactive | no_policy | paused | exceeds_per_tx_cap | exceeds_daily_budget | exceeds_monthly_budget | merchant_not_allowed | outside_time_window`

### 402 challenge shape (x402 v1)

```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:8453",
    "maxAmountRequired": "10000",
    "asset": "USDC",
    "payTo": "0x…",
    "resource": "/api/paid/market-data?agentId=1",
    "description": "…",
    "mimeType": "application/json",
    "maxTimeoutSeconds": 60
  }]
}
```

## On-chain contracts

| Contract | Path | Role |
|----------|------|------|
| `AgentRegistry` | `contracts/AgentRegistry.sol` | agent ↔ Base Verify identityHash, sybil cap |
| `PolicyEngine` | `contracts/PolicyEngine.sol` | `canSpend()` view + `recordSpend()`, budgets/allowlist/time-window/kill-switch |

Server's `policyEngine` mirrors `PolicyEngine.sol` exactly; swap to `eth_call` in production.
