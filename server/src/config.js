/**
 * Central env config — works locally and on Vercel.
 * Locally loads repo-root .env (no dotenv dependency — tiny parser below).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.VERCEL !== '1') {
  for (const p of [
    path.join(__dirname, '..', '..', '.env'), // repo root
    path.join(__dirname, '..', '.env'), // server/.env
  ]) {
    try {
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && !(m[1] in process.env)) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
      }
    } catch {
      /* file not present — fine */
    }
  }
}
const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
const authSecret = process.env.AUTH_SECRET || (isProd ? '' : 'dev-only-change-me');
if (!authSecret) {
  throw new Error(
    'AUTH_SECRET is required in production — set it in the environment (Vercel: Project → Settings → Environment Variables).'
  );
}

export const cfg = {
  port: Number(process.env.PORT || 8787),
  isProd,

  // chain
  chainId: Number(process.env.CHAIN_ID || 84532), // Base Sepolia by default
  rpcUrl: process.env.RPC_URL || 'https://sepolia.base.org',
  registryAddress: process.env.AGENT_REGISTRY_ADDRESS || null,
  policyAddress: process.env.POLICY_ENGINE_ADDRESS || null,
  usdcAddress:
    process.env.USDC_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // USDC Base Sepolia

  // auth
  authSecret,
  appDomain: process.env.APP_DOMAIN || 'agentdesk.xyz',

  // CORS — comma-separated origins (or bare hosts). Empty = reflect any origin
  // (fine for local dev; set CORS_ORIGINS in production, e.g. "agentdesk.xyz,https://agentdesk.vercel.app")
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Privy login (identity token exchange) — both required to enable it
  privyAppId: process.env.PRIVY_APP_ID || null,
  privyAppSecret: process.env.PRIVY_APP_SECRET || null,
  get privyEnabled() {
    return !!(this.privyAppId && this.privyAppSecret);
  },

  // x402
  payTo: process.env.PAY_TO || '0x000000000000000000000000000000000000dEaD',
  facilitatorUrl: process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator',

  // mode: chain = real Sepolia reads/writes; local = JSON demo DB
  get mode() {
    return this.registryAddress && this.policyAddress ? 'chain' : 'local';
  },
  get networkLabel() {
    if (this.chainId === 8453) return 'eip155:8453';
    if (this.chainId === 84532) return 'eip155:84532';
    return `eip155:${this.chainId}`;
  },
};

export const logCfg = () => {
  console.log('mode:', cfg.mode, '| env:', cfg.isProd ? 'production' : 'development');
  console.log('chainId:', cfg.chainId, '| network:', cfg.networkLabel);
  console.log('registry:', cfg.registryAddress || '(not set)');
  console.log('policy:', cfg.policyAddress || '(not set)');
  console.log('privy:', cfg.privyEnabled ? 'enabled' : 'disabled (SIWE fallback)');
  console.log('facilitator:', cfg.facilitatorUrl);
  console.log('payTo:', cfg.payTo);
  console.log('cors:', cfg.corsOrigins.length ? cfg.corsOrigins.join(', ') : '(any origin — set CORS_ORIGINS in production)');
  if (cfg.mode === 'chain' && /^0x0{38}dEaD$/i.test(cfg.payTo)) {
    console.warn('warning: PAY_TO is the burn address — payments would be unrecoverable');
  }
};
