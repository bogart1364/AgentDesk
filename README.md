# AgentDesk

**AI Agent Commerce Control Plane on Base**

The missing layer between humans and autonomous agents: create agents, fund them, enforce spend
policies, and pay for APIs via **x402** — with Base-native identity.

![Landing](docs/assets/landing.png)

## Why AgentDesk?

Base shipped **x402** (HTTP-native payments) and **Base Verify** (sybil-resistant identity). Agents can
already pay for APIs — but **humans have zero control**: no budgets, no per-transaction caps, no
merchant allowlists, no live spend visibility, no kill switch.

AgentDesk adds a policy engine + control dashboard: every agent is a wallet you own, every payment is
checked against caps you set (on-chain in chain mode), and you can halt an agent instantly.

| Console | Agent detail (policy + allowlist) |
| --- | --- |
| ![Console](docs/assets/dashboard.png) | ![Agent](docs/assets/agent-detail.png) |

## Two modes

| Mode | When | Writes | Reads |
| --- | --- | --- | --- |
| **local** (demo) | `AGENT_REGISTRY_ADDRESS` / `POLICY_ENGINE_ADDRESS` unset | JSON demo DB over the REST API | JSON demo DB |
| **chain** (real) | both addresses set (`.env`) | your wallet → `AgentRegistry` / `PolicyEngine` on Base | contracts + event logs, server is read-only |

Chain mode is what runs on Base Sepolia today: AgentRegistry
`0x4b9F26A00C0c5Cd940221d6A44326F203aa59Be5`, PolicyEngine
`0x5545EaC0b1ACadDB117b9E12aE59290cBDe18a4C` — gated by **Base Verify Onchain**
(`SignerRegistry 0x4f15593fbF7e3491d15080e1610E7AF8deBA1a02`, policy: `coinbase ·
coinbase_one_active eq true`).

## Layout

```
agentdesk/
├─ api/                Vercel serverless entry (rewrites /api/* → Express app)
├─ contracts/          Solidity policy engine
│  ├─ src/             AgentRegistry.sol · PolicyEngine.sol
│  ├─ scripts/         deploy.js · export-abis.js
│  ├─ abi/             exported ABIs
│  └─ deployments/     baseSepolia.json (addresses + deploy block)
├─ server/             REST API + x402 middleware (Express, viem, nodeps JSON DB)
│  └─ src/             app.js · auth.js · chain.js · config.js · middleware/ · services/ · db/
├─ web/                Control dashboard + landing (React, Vite, Tailwind, wagmi/Privy)
│  └─ src/             pages/ · components/ · lib/ · abi/ · styles/
├─ examples/           agent-client.js — machine-to-machine x402 caller
├─ docs/               API.md · assets/ (screenshots)
├─ tools/              operator scripts (not shipped to users)
│  ├─ e2e/             api-e2e.mjs · ui-e2e.mjs · cleanup.mjs · run-e2e.ps1
│  ├─ chain/           chain-status.mjs · chain-smoke.mjs · verify-onchain.mjs · rpc-probe.mjs · build-chain.ps1
│  └─ faucet/          mine-and-claim.ps1 (PoW testnet ETH, no login)
├─ README.md · DEPLOY.md · SECURITY.md
└─ .env.example · vercel.json · package.json
```

## Quickstart

```bash
npm install                     # root (tooling: e2e, chain scripts)
cd server && npm install        # API deps        (viem, express, zod, @privy-io/node)
cd ../web && npm install        # dashboard deps  (@stripe/stripe-js + .npmrc legacy-peer-deps)
cd ../contracts && npm install  # hardhat         (deploy only)

cp .env.example .env            # leave the contract addresses empty → local demo mode
npm run dev                     # API :8787 + Vite :5173  (run from the repo root)
```

Open <http://localhost:8787> (built UI + API) or <http://localhost:5173> (Vite dev server).
Connect a wallet → sign in → create an agent → set caps → run a paid request.

### Chain mode (Base Sepolia)

Set `AGENT_REGISTRY_ADDRESS`, `POLICY_ENGINE_ADDRESS`, `DEPLOY_BLOCK` in `.env` (see `DEPLOY.md`), then
`npm run dev` again — the banner flips to **CHAIN MODE** and all writes go through your wallet:

```bash
npm run build:chain             # build the UI in chain mode (VITE_* addresses)
npm run chain:status            # read-only sanity check: contracts + Base Verify policy
npm run chain:smoke             # verify gate + create/policy/spend on-chain (deployer key)
npm run chain:probe             # measure the RPC's eth_getLogs range limit
npm run verify:onchain          # ask Base Verify for a real {identityHash, expiration, signature}
```

`chain:smoke` first proves the gate: an unverifiable `createAgent` must revert. The write path
(`createAgent` → `setPolicy` → `recordSpend`) only runs when you pass a genuine proof as
`VERIFY_IDENTITY_HASH` / `VERIFY_EXPIRATION` / `VERIFY_SIGNATURE`, which `verify:onchain` prints for
a wallet that holds the verified trait.

`npm run e2e` tests whatever `web/dist` currently holds and the UI suite expects the **local-mode**
build (`npm run build`), because the chain-mode create flow needs a real Base Verify proof; that path
is covered by `contracts/test/AgentRegistry.verify.test.js` + `npm run chain:smoke` instead.

In chain mode the API is **read-only**: it lists agents via `nextAgentId()` + `getAgent(i)`,
reads spend/allowlist history from chunked `eth_getLogs` (public Base RPC caps a query at 200
blocks, so windows are scanned in parallel — tune `LOG_MAX_WINDOWS`, and `FEED_LOOKBACK_BLOCKS`
for a shorter live feed), and all state changes are signed by the user's wallet on-chain.

Need testnet ETH for a fresh wallet? The OpenFaucet flow is proof-of-work only, no login:

```bash
npm run faucet -- -Address 0xYourWallet -Secs 600 -Claim
```

## Commands

| Command | What |
| --- | --- |
| `npm run dev` | API + web dev servers (API serves the built UI on :8787) |
| `npm run build` | production UI build → `web/dist` (local mode) |
| `npm run build:chain` | UI build wired to the deployed contracts |
| `npm run deploy:sepolia` | compile + deploy contracts, print addresses |
| `npm run e2e` | full API + UI suite, twice, leaves the server up |
| `npm run e2e:api` · `e2e:ui` · `e2e:clean` | individual suites / demo-data cleanup |
| `npm run chain:status` · `chain:smoke` | read-only chain check / on-chain write smoke test |
| `npm run chain:probe` | probe `eth_getLogs` range limits on your RPC |
| `npm run verify:onchain` | fetch a Base Verify onchain proof for `DEPLOYER_PRIVATE_KEY` |
| `npm run faucet -- -Address 0x…` | PoW faucet claim (testnet ETH) |

## Core concepts

**Agent** — a wallet owned by the human, operated by software. Identity is `keccak256(owner)` on-chain;
the spend policy is what actually gates the money.

**Policy** — `perTxCap`, `dailyBudget`, `monthlyBudget`, optional merchant allowlist, optional time
window, `paused` kill switch. In chain mode these live in `PolicyEngine.sol` and are read via
`canSpend()`.

**x402 flow** — 1) agent calls a paid endpoint → `402 Payment Required`; 2) server checks the agent's
policy (`canSpend` on-chain in chain mode); 3) the client's EIP-3009 USDC authorization is validated
against the challenge (payee, amount, asset, window) and settled by the x402 facilitator; 4) the
resource is returned with an `X-Payment-Settlement` proof. In local mode settlement is mocked so the
whole flow is demoable offline.

**Identity** — `POST /api/auth/verify` accepts a Privy identity token (with `linked_accounts`) or a
SIWE signature, and issues the app's own 7-day HMAC JWT. One unverified human → 1 agent, verified → 5.

### Base Verify (both documented integrations)

`server/src/services/verify.js` implements the [Base Verify SDK](https://docs.base.org/sdks/base-verify)
flows end-to-end; `contracts/src/baseverify/` vendors `BaseVerifyConsumer.sol` + `ISignerRegistry.sol`.

**1. Verify Social Accounts (backend-enforced)** — `GET /api/verify/payload?provider=x|coinbase|instagram|tiktok`
returns the SIWE message to sign (provider/trait/action live in the `Resources` urns, the client cannot
weaken them). `POST /api/verify/social` sends it to `POST /v1/base_verify_token` with our secret key and
returns the Sybil `token`, which is stored per human so one verified identity cannot be reused by
another wallet (409 `identity_already_verified`). The backend re-validates the requested traits before
calling upstream; `404` ⇒ the user must verify at `verify.base.dev` first, `400` ⇒ traits not satisfied.
Without a key the endpoint refuses in production (501) and returns a clearly-flagged demo identity in dev.

**2. Verify Users Onchain (contract-enforced)** — `AgentRegistry` extends `BaseVerifyConsumer`, so
`createAgent(identityHash, expiration, signature, name, metadataURI)` only succeeds with a fresh proof
from `POST /v1/onchain_verifications` (no key needed). The policy is stored on-chain and read live by
the backend, currently `provider = "coinbase"`, `conditions = [{ coinbase_one_active, eq, true }]`;
the API exposes `GET /api/verify/onchain/payload` (payload) and `POST /api/verify/onchain` (proof fetch),
and the dashboard/`CreateAgent` sign and submit it. Anything else reverts (verified on Base Sepolia).

## Security

See [SECURITY.md](SECURITY.md) for the threat model, the review findings (all fixed) and the known
limitations. Highlights: JWT-authenticated ownership on every write, chain-mode x402 payload binding
(no free/underpaid resources), no default `AUTH_SECRET` in production, and rate-limited auth/paid
endpoints.

## Deploy

`DEPLOY.md` walks through contracts, Vercel (env vars, `vercel.json`), Privy, and the post-deploy
verification list.

## Grant alignment

| Base grant category | How AgentDesk fits |
| --- | --- |
| Agents — commerce, x402 | Core product |
| Consumer apps (tx growth) | Every agent payment is a transaction |
| DeFi 2.0 (payments rail) | USDC settlement on Base |

## License

MIT
