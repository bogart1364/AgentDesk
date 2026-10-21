# Deploy AgentDesk (Vercel + Base Sepolia)

Everything below is real: real SIWE wallet login, real on-chain reads/writes on Base
Sepolia, real x402 settlement through the facilitator. No demo shortcuts.

## 0. What's where

| Piece | Command |
|---|---|
| Contracts (AgentRegistry, PolicyEngine) | `cd contracts && npx hardhat compile` |
| Deploy contracts to Base Sepolia | `npm run deploy:sepolia` (root) |
| API + frontend build | `npm run build` (root → `web/dist`) |
| Local full stack | `npm run dev` (root → API :8787 + Vite) |

The server runs in **two modes**:

- `local` — JSON demo DB, mock settlement. Used when contract addresses are not set.
- `chain` — activates automatically when **both** `AGENT_REGISTRY_ADDRESS` and
  `POLICY_ENGINE_ADDRESS` are set: reads via `eth_call` + event logs, writes happen
  in the user's wallet (wagmi), settlement via the x402 facilitator.

## 1. Fund a deployer wallet (Base Sepolia)

1. Create/fund a wallet with Sepolia ETH on Base:
   - Faucet: https://docs.base.org/chain/network-faucets
2. Put the key in the **repo root** `.env` (this file is gitignored, never commit it):

```env
DEPLOYER_PRIVATE_KEY=0x...
BASE_SEPOLIA_RPC=https://sepolia.base.org
```

## 2. Deploy the contracts

```bash
npm run deploy:sepolia
```

Output includes:

```
Base Verify SignerRegistry: 0x4f15593fbF7e3491d15080e1610E7AF8deBA1a02
AgentRegistry: 0x...
PolicyEngine: 0x...
Deploy block: 1234567
--- Add to .env / Vercel env ---
AGENT_REGISTRY_ADDRESS=0x...
POLICY_ENGINE_ADDRESS=0x...
BASE_VERIFY_SIGNER_REGISTRY=0x4f15593fbF7e3491d15080e1610E7AF8deBA1a02
DEPLOY_BLOCK=1234567
```

The registry is passed into the `AgentRegistry` constructor and is what calls
`verifyVerification(...)` on every `createAgent`, so agents can only be created by wallets that hold
the on-chain trait (default `provider = "coinbase"`, `conditions = [{ coinbase_one_active, eq, true }]`).

Deployment artifact is saved to `contracts/deployments/baseSepolia.json` (addresses, deploy block,
`baseVerifySignerRegistry`, `verifyPolicy`).
Optional verification: `cd contracts && npx hardhat verify --network baseSepolia <addr> <ctor-arg>`.

## 3. Local smoke test (chain mode)

Add the two addresses to root `.env`, then:

```bash
npm run dev
```

- `GET http://localhost:8787/api/health` must show `"mode":"chain"`.
- Open http://localhost:8787 — connect wallet → sign → console.
- Create Agent: the UI asks Base Verify for an onchain proof (`POST /v1/onchain_verifications`), your
  wallet signs the SIWE message, then sends **2 real txs**: `createAgent` + `setPolicy`. The wallet must
  hold the verified trait (default: an active Coinbase One on the provider account), otherwise
  `createAgent` reverts — that is the gate working, see `npm run chain:smoke`.

```bash
npm run chain:status                  # policy read live from the contract
npm run chain:smoke                   # proves an unverifiable createAgent reverts
npm run verify:onchain                # real proof for DEPLOYER_PRIVATE_KEY (404 → verify first)
```

## 3.5 Privy login (email / social / wallet modal)

Login uses Privy when `PRIVY_APP_ID` is set; otherwise it falls back to plain
SIWE wallet sign-in. To enable Privy:

1. Create a free app at <https://dashboard.privy.io> → copy the **App ID**.
2. In the app settings create an **App Secret** (Authentication → App secrets).
3. In the dashboard add **Base Sepolia (84532)** under supported chains and
   enable login methods **Email** + **Wallet** (Coinbase Wallet appears in the
   modal automatically).
4. Set the three env vars (local `.env` + Vercel):

```
PRIVY_APP_ID=…            # server
PRIVY_APP_SECRET=…        # server only — never expose
VITE_PRIVY_APP_ID=…       # same App ID, build-time for the frontend
```

Flow: Privy modal login → frontend sends its Privy identity token + wallet
address to `POST /api/auth/verify` → server verifies the token (JWKS), checks
the wallet is linked to that account, issues the same 7-day JWT as SIWE.
Everything downstream (authFetch, x402, console) is unchanged.

## 4. Deploy to Vercel

```bash
npm i -g vercel
vercel link
```

Set **Environment Variables** in the Vercel dashboard (Project → Settings →
Environment Variables, Production + Preview):

| Name | Value |
|---|---|
| `AGENT_REGISTRY_ADDRESS` | from step 2 |
| `POLICY_ENGINE_ADDRESS` | from step 2 |
| `DEPLOY_BLOCK` | from step 2 (optional but recommended) |
| `BASE_VERIFY_SIGNER_REGISTRY` | `0x4f15593fbF7e3491d15080e1610E7AF8deBA1a02` — only read by `deploy.js` (baked into the constructor) |
| `BASE_VERIFY_SECRET_KEY` | secret from the [Base Verify form](https://forms.gle/6L4hWAHkojYcefz27). Optional: without it the social endpoint refuses in production (501) instead of faking a verification |
| `BASE_VERIFY_API_URL` | `https://verify.base.dev/v1` (default) |
| `BASE_VERIFY_APP_URL` | `https://verify.base.dev` (default) — where unverified users are sent |
| `LOG_MAX_WINDOWS` | optional, default `600` (x200-block `eth_getLogs` windows = 120k blocks). Raise if the deploy is older; a warning is logged when history is truncated |
| `FEED_LOOKBACK_BLOCKS` | optional, default `0` = full history from `DEPLOY_BLOCK`; set e.g. `4000` for a fast "recent activity" feed |
| `AUTH_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` — **required**: the server refuses to boot in production without it |
| `CORS_ORIGINS` | your origins/hosts, comma-separated (e.g. `agentdesk.xyz,https://agentdesk.vercel.app`) — leave empty only for dev |
| `PRIVY_APP_ID` | from dashboard.privy.io (optional — SIWE fallback without it) |
| `PRIVY_APP_SECRET` | from dashboard.privy.io (server only) |
| `PAY_TO` | your receiving wallet (0x…) |
| `APP_DOMAIN` | your vercel.app domain |
| `CHAIN_ID` | `84532` |
| `RPC_URL` | `https://sepolia.base.org` |
| `VITE_AGENT_REGISTRY_ADDRESS` | same as registry |
| `VITE_POLICY_ENGINE_ADDRESS` | same as policy |
| `VITE_CHAIN_ID` | `84532` |
| `VITE_PRIVY_APP_ID` | same as `PRIVY_APP_ID` |

> `VITE_*` values are baked into the JS bundle at build time (public by design —
> they are on-chain addresses). `AUTH_SECRET`, `PRIVY_APP_SECRET` and `PAY_TO`
> stay server-side only.

Deploy:

```bash
vercel --prod
```

Vercel config lives in `vercel.json`: Vite build → `web/dist`, `/api/*` → the
Express app (`api/index.js`), SPA fallback rewrite.

## 5. Post-deploy checks

1. `GET https://<your-domain>/api/health` → `"mode":"chain"`, contracts non-null.
2. Open the site → Sign In (Privy modal) or Connect Wallet → sign message if
   SIWE fallback → dashboard loads (JWT stored 7 days).
3. Base Verify: `GET /api/verify/payload?provider=x` (with your JWT) returns a SIWE message whose
   `Resources` carry the provider/trait/action urns; `POST /api/verify/social` with that message signed
   by your wallet returns `verified: true` + a `token`, or `404` + a `verify.base.dev` link, or `400`
   when the account is verified but below the trait bar. `GET /api/verify/onchain/payload` +
   `POST /api/verify/onchain` must return the same proof `createAgent` needs.
4. Create Agent → Base Verify proof → your wallet signs → **2 transactions** → agent appears with
   `AGENT CREATED ON CHAIN` and a Basescan link.
5. Agent detail → Save Policy / Kill-switch → wallet tx → status updates after
   confirmation.
6. x402 tab → "Send $0.01 paid request" → facilitator settles → spend log entry
   with real tx hash.
7. Sign Out → console shows "Authentication required" gate.

## 6. Mainnet later

- Deploy: `cd contracts && npx hardhat run scripts/deploy.js --network base`
- Set `CHAIN_ID=8453`, `VITE_CHAIN_ID=84533`→`8453`, `RPC_URL=https://mainnet.base.org`.
- `PAY_TO` must be a wallet you control. USDC on Base mainnet:
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

## Troubleshooting

- **402 with `settlement_failed`** — facilitator rejected the payment signature;
  check `PAY_TO` and that the buyer wallet has Base Sepolia USDC.
- **`409 chain_mode`** — server is in chain mode; that write must go through the
  wallet (on-chain tx), not the JSON-DB API.
- **`createAgent` reverts** — Base Verify rejected the proof: expired signature, wallet differs from the
  one that requested the proof, or the account does not satisfy `coinbase_one_active eq true`. Re-run
  `npm run verify:onchain` to see the exact reason.
- **`501 verify_not_configured`** — `BASE_VERIFY_SECRET_KEY` is missing while `NODE_ENV=production`;
  the server refuses to hand out fake verifications instead.
- **`404 verification_not_found`** — the wallet has never verified that provider. Send the user to the
  returned `redirectUrl` (`https://verify.base.dev?redirect_uri=…&providers=coinbase`); do not retry.
- **Base Verify rejects our SIWE message** — the address must be EIP-55 checksummed and the onchain flow
  must include an `Expiration Time`; both are handled in `server/src/services/verify.js`.
- **Login fails** — `AUTH_SECRET` missing/rotated invalidates tokens; set it and retry.
- **Frontend shows LOCAL mode banner** — the `VITE_*` addresses were not present
  at build time; redeploy after setting them.
