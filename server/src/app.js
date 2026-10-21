/**
 * AgentDesk API — exportable Express app (works on Vercel + local).
 * Local:  src/index.js → app.listen
 * Vercel: api/index.js  → export default app
 */
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { cfg, logCfg } from './config.js';
import { createNonce, verifyLogin, verifyPrivyLogin, requireAuth, optionalAuth } from './auth.js';
import * as chain from './chain.js';
import { humans, agents, policies, allowlist, spend, policyEngine, fmtUsdc, dbInfo } from './db/index.js';
import { paymentMiddleware } from './middleware/x402.js';
import {
  checkSocialVerification,
  buildVerifyMessage,
  verifyPolicySummary,
  buildOnchainVerifyMessage,
  validateOnchainMessage,
  fetchOnchainVerification,
  onchainVerifyConfigured,
} from './services/verify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.join(__dirname, '..', '..', 'web', 'dist');

const app = express();
app.disable('x-powered-by');

// Security headers (no CSP: the wallet/Privy SDKs load remote frames + RPC)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// CORS — permissive only until CORS_ORIGINS is configured (see config.js)
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // curl, same-origin, server-side
      if (!cfg.corsOrigins.length) return cb(null, true);
      const o = origin.toLowerCase();
      let host = '';
      try {
        host = new URL(origin).host.toLowerCase();
      } catch {
        /* ignore */
      }
      cb(null, cfg.corsOrigins.includes(o) || (host && cfg.corsOrigins.includes(host)));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));

/** Tiny in-memory per-IP limiter (per instance — enough to blunt scripted abuse). */
function rateLimit({ windowMs, max, name }) {
  const hits = new Map();
  return function limiter(req, res, next) {
    const nowMs = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${name}:${ip}`;
    const rec = hits.get(key);
    if (!rec || rec.reset < nowMs) {
      hits.set(key, { count: 1, reset: nowMs + windowMs });
    } else if (rec.count >= max) {
      return res.status(429).json({ error: 'rate_limited', retryAfterMs: rec.reset - nowMs });
    } else {
      rec.count += 1;
    }
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < nowMs) hits.delete(k);
    next();
  };
}

// Serve built web (Vercel serves static separately; this is for local)
app.use(express.static(WEB_DIST));

const now = () => Math.floor(Date.now() / 1000);
const lower = (a) => String(a || '').toLowerCase();
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const isChain = cfg.mode === 'chain';

function ensureHuman(address) {
  const addr = lower(address);
  if (!humans.get(addr)) humans.upsert(addr, {});
  return humans.get(addr);
}

/** Local-mode ownership guard: the caller's JWT address must own the agent. */
function requireAgentOwner(req, res, agentId) {
  const agent = agents.get(agentId);
  if (!agent) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  if (lower(agent.owner_address) !== lower(req.user?.address)) {
    res.status(403).json({ error: 'forbidden', hint: 'This agent belongs to a different wallet' });
    return null;
  }
  return agent;
}

/** Compose agent view — chain mode reads on-chain policy, local uses DB. */
async function agentView(agentId) {
  if (isChain) {
    const [agent, policy, usage, recentSpend, allow] = await Promise.all([
      chain.getAgentOnChain(agentId),
      chain.getPolicyOnChain(agentId),
      chain.getUsageOnChain(agentId),
      chain.getRecentSpendByAgent(agentId, 20),
      chain.getAllowlistOnChain(agentId),
    ]);
    if (!agent) return null;
    return {
      ...agent,
      policy: policy && policy.exists ? { ...policy, ...(usage || {}) } : null,
      allowlist: allow,
      recentSpend,
      source: 'chain',
    };
  }

  const agent = agents.get(agentId);
  if (!agent) return null;
  const policy = policies.get(agentId);
  const list = allowlist.list(agentId);
  const recent = spend.listByAgent(agentId, 20);
  const t = now();
  const dayStart = t - (t % 86400);
  const monthStart = t - (t % (30 * 86400));
  const spentToday = policy ? spend.sumSince(agentId, dayStart) : 0;
  const spentThisMonth = policy ? spend.sumSince(agentId, monthStart) : 0;

  return {
    ...agent,
    policy: policy
      ? {
          ...policy,
          spentToday,
          spentThisMonth,
          dailyRemaining: policy.daily_budget > 0 ? Math.max(policy.daily_budget - spentToday, 0) : null,
          monthlyRemaining: policy.monthly_budget > 0 ? Math.max(policy.monthly_budget - spentThisMonth, 0) : null,
        }
      : null,
    allowlist: list,
    recentSpend: recent.map((r) => ({ ...r, amountDisplay: fmtUsdc(r.amount) })),
    source: 'local',
  };
}

// ─────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  const chainPing = isChain ? await chain.pingChain() : null;
  res.json({
    ok: true,
    service: 'agentdesk',
    version: '0.2.0',
    mode: cfg.mode,
    chainId: cfg.chainId,
    network: cfg.networkLabel,
    contracts: {
      registry: cfg.registryAddress,
      policy: cfg.policyAddress,
    },
    chain: chainPing,
    ts: now(),
    db: dbInfo(),
  });
});

// ─────────────────────────────────────────────
// Auth — Privy identity-token exchange or SIWE fallback
// ─────────────────────────────────────────────
app.get(
  '/api/auth/nonce',
  rateLimit({ windowMs: 60_000, max: 60, name: 'nonce' }),
  (req, res) => {
    const address = lower(req.query.address);
    if (!ADDR_RE.test(address)) return res.status(400).json({ error: 'invalid_address' });
    res.json(createNonce(address));
  }
);

app.post('/api/auth/verify', rateLimit({ windowMs: 60_000, max: 30, name: 'verify' }), async (req, res) => {
  try {
    const body = req.body || {};

    // Privy path: identity token exchange (email / social / wallet login)
    if (body.privyIdentityToken) {
      const parsed = z
        .object({
          privyIdentityToken: z.string().min(20),
          address: z.string().regex(ADDR_RE).optional(),
        })
        .parse(body);

      const result = await verifyPrivyLogin(parsed);
      if (!result.ok) return res.status(401).json({ error: result.error });

      ensureHuman(result.address);
      return res.json({ ok: true, token: result.token, address: result.address });
    }

    // SIWE fallback path
    const parsed = z
      .object({
        address: z.string().regex(ADDR_RE),
        message: z.string().min(1),
        signature: z.string().min(1),
      })
      .parse(body);

    const result = await verifyLogin(parsed);
    if (!result.ok) return res.status(401).json({ error: result.error });

    ensureHuman(result.address);
    res.json({ ok: true, token: result.token, address: result.address });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: 'validation', issues: e.issues });
    console.error('[auth/verify]', e?.message);
    res.status(500).json({ error: 'internal' });
  }
});

// ─────────────────────────────────────────────
// Base Verify — https://docs.base.org/sdks/base-verify
//
//  Social (backend-enforced):  GET  /api/verify/payload  → SIWE message w/ urn:verify resources
//                              POST /api/verify/social   → {token, action, wallet} (Sybil token)
//  Onchain (contract-enforced): GET  /api/verify/onchain/payload → SIWE naming our registry
//                               POST /api/verify/onchain  → {identityHash, expiration, signature}
// ─────────────────────────────────────────────
const providerSchema = z.enum(['x', 'coinbase', 'instagram', 'tiktok']).default('x');

app.get('/api/verify/payload', requireAuth, (req, res) => {
  const provider = providerSchema.parse(req.query.provider);
  const summary = verifyPolicySummary(provider);
  const payload = buildVerifyMessage(req.user.address, provider);
  res.json({ ...summary, ...payload });
});

app.get('/api/verify/onchain/payload', requireAuth, (req, res) => {
  if (!onchainVerifyConfigured()) return res.status(501).json({ error: 'onchain_verify_not_configured' });
  res.json(buildOnchainVerifyMessage(req.user.address));
});

const socialVerify = async (req, res) => {
  try {
    const body = z
      .object({
        message: z.string().min(1),
        signature: z.string().min(1),
        provider: providerSchema.optional(),
      })
      .parse(req.body || {});

    const provider = body.provider || 'x';
    const result = await checkSocialVerification({
      address: req.user.address,
      message: body.message,
      signature: body.signature,
      provider,
    });

    if (result.status === 200) {
      const token = result.body.token;
      // one verified identity = one token across wallets (docs: store the token, reject reuse)
      const existing = humans.findByVerifyToken(token);
      if (existing && existing.address !== req.user.address) {
        return res.status(409).json({ error: 'identity_already_verified' });
      }
      humans.upsert(req.user.address, {
        identity_hash: result.body.identityHash,
        verified: 1,
        verify_provider: provider,
        verify_action: result.body.action,
        verify_token: token,
        verified_at: now(),
      });
      return res.json({ ...result.body, address: req.user.address });
    }

    res.status(result.status).json(result.body);
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: 'validation', issues: e.issues });
    console.error('[verify/social]', e?.message);
    res.status(500).json({ error: 'internal' });
  }
};

app.post('/api/verify/social', rateLimit({ windowMs: 60_000, max: 30, name: 'verify' }), requireAuth, socialVerify);
// legacy path kept for clients built before the Base Verify rework
app.post('/api/auth/verify-social', rateLimit({ windowMs: 60_000, max: 30, name: 'verify' }), requireAuth, socialVerify);

app.post(
  '/api/verify/onchain',
  rateLimit({ windowMs: 60_000, max: 30, name: 'verify-onchain' }),
  requireAuth,
  async (req, res) => {
    try {
      const body = z
        .object({ message: z.string().min(1), signature: z.string().min(1) })
        .parse(req.body || {});
      const result = await fetchOnchainVerification({ address: req.user.address, ...body });
      res.status(result.status === 200 ? 200 : result.status).json(result.body);
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: 'validation', issues: e.issues });
      console.error('[verify/onchain]', e?.message);
      res.status(500).json({ error: 'internal' });
    }
  }
);

// ─────────────────────────────────────────────
// Me
// ─────────────────────────────────────────────
app.get('/api/me', optionalAuth, async (req, res) => {
  const address = lower(req.query.address || req.user?.address);
  if (!ADDR_RE.test(address)) return res.status(400).json({ error: 'invalid_address' });
  const human = ensureHuman(address);

  if (isChain) {
    try {
      const list = await chain.listAgentsByOwner(address);
      return res.json({ human, agents: list, mode: 'chain' });
    } catch (e) {
      return res.status(502).json({ error: 'chain_read_failed', detail: e.message?.slice(0, 200) });
    }
  }

  const list = agents.listByOwner(address).map((a) => ({ ...a, policy: policies.get(a.id) || null }));
  res.json({ human, agents: list, mode: 'local' });
});

// ─────────────────────────────────────────────
// Agents — chain mode: writes happen on-chain from wallet,
//          server only reads. Local mode: full CRUD in DB.
// ─────────────────────────────────────────────
app.get('/api/agents', optionalAuth, async (req, res) => {
  const address = lower(req.query.address || req.user?.address);
  if (!ADDR_RE.test(address)) return res.status(400).json({ error: 'invalid_address' });

  if (isChain) {
    try {
      const list = await chain.listAgentsByOwner(address);
      return res.json(list);
    } catch (e) {
      return res.status(502).json({ error: 'chain_read_failed', detail: e.message?.slice(0, 200) });
    }
  }
  res.json(agents.listByOwner(address).map((a) => agentViewSync(a.id)));
});

function agentViewSync(agentId) {
  const agent = agents.get(agentId);
  if (!agent) return null;
  const policy = policies.get(agentId);
  const t = now();
  const dayStart = t - (t % 86400);
  const monthStart = t - (t % (30 * 86400));
  const spentToday = policy ? spend.sumSince(agentId, dayStart) : 0;
  const spentThisMonth = policy ? spend.sumSince(agentId, monthStart) : 0;
  return {
    ...agent,
    policy: policy
      ? {
          ...policy,
          spentToday,
          spentThisMonth,
          dailyRemaining: policy.daily_budget > 0 ? Math.max(policy.daily_budget - spentToday, 0) : null,
          monthlyRemaining: policy.monthly_budget > 0 ? Math.max(policy.monthly_budget - spentThisMonth, 0) : null,
        }
      : null,
    allowlist: allowlist.list(agentId),
    recentSpend: spend.listByAgent(agentId, 20).map((r) => ({ ...r, amountDisplay: fmtUsdc(r.amount) })),
    source: 'local',
  };
}

app.get('/api/agents/:id', optionalAuth, async (req, res) => {
  const view = await agentView(Number(req.params.id));
  if (!view) return res.status(404).json({ error: 'not_found' });
  res.json(view);
});

// Local-mode writes (chain mode: client writes on-chain directly)
app.post('/api/agents', requireAuth, (req, res) => {
  if (isChain) {
    return res.status(409).json({
      error: 'chain_mode',
      hint: 'In chain mode, create the agent from your wallet: AgentRegistry.createAgent(identityHash, name, metadataURI)',
    });
  }
  try {
    const body = z
      .object({
        ownerAddress: z.string().regex(ADDR_RE),
        name: z.string().min(1).max(64),
        description: z.string().max(500).optional().default(''),
      })
      .parse(req.body);

    // the JWT is the identity: a caller can only create agents for itself
    if (lower(body.ownerAddress) !== lower(req.user.address)) {
      return res.status(403).json({ error: 'forbidden', hint: 'ownerAddress must match the signed-in wallet' });
    }

    const human = ensureHuman(body.ownerAddress);
    const maxAgents = human.verified ? 5 : 1;
    const existing = agents.countByOwner(body.ownerAddress);
    if (existing >= maxAgents) {
      return res.status(403).json({
        error: 'agent_limit_reached',
        maxAgents,
        hint: human.verified ? 'Verified limit reached' : 'Verify via Base Verify to create more agents',
      });
    }

    const agent = agents.create({
      owner_address: body.ownerAddress,
      name: body.name,
      description: body.description,
      identity_hash: human.identity_hash,
    });

    policies.upsert(agent.id, {
      per_tx_cap: 5_000_000,
      daily_budget: 50_000_000,
      monthly_budget: 500_000_000,
      use_allowlist: 0,
      time_window_en: 0,
      time_start_hour: 0,
      time_end_hour: 23,
      paused: 0,
    });

    res.status(201).json(agentViewSync(agent.id));
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: 'validation', issues: e.issues });
    throw e;
  }
});

app.put('/api/agents/:id/policy', requireAuth, (req, res) => {
  if (isChain) {
    return res.status(409).json({
      error: 'chain_mode',
      hint: 'In chain mode, update the policy from your wallet: PolicyEngine.setPolicy(agentId, perTxCap, dailyBudget, monthlyBudget)',
    });
  }
  try {
    const agentId = Number(req.params.id);
    if (!requireAgentOwner(req, res, agentId)) return;

    const b = z
      .object({
        perTxCapUsd: z.number().min(0).optional(),
        dailyBudgetUsd: z.number().min(0).optional(),
        monthlyBudgetUsd: z.number().min(0).optional(),
        useAllowlist: z.boolean().optional(),
        timeWindowEnabled: z.boolean().optional(),
        timeStartHour: z.number().int().min(0).max(23).optional(),
        timeEndHour: z.number().int().min(0).max(23).optional(),
      })
      .parse(req.body);

    const existing = policies.get(agentId) || {};
    const toMicro = (usd, fallback) => (usd === undefined ? (fallback ?? 0) : Math.round(usd * 1e6));

    policies.upsert(agentId, {
      per_tx_cap: toMicro(b.perTxCapUsd, existing.per_tx_cap),
      daily_budget: toMicro(b.dailyBudgetUsd, existing.daily_budget),
      monthly_budget: toMicro(b.monthlyBudgetUsd, existing.monthly_budget),
      use_allowlist: b.useAllowlist === undefined ? (existing.use_allowlist ?? 0) : b.useAllowlist ? 1 : 0,
      time_window_en: b.timeWindowEnabled === undefined ? (existing.time_window_en ?? 0) : b.timeWindowEnabled ? 1 : 0,
      time_start_hour: b.timeStartHour ?? existing.time_start_hour ?? 0,
      time_end_hour: b.timeEndHour ?? existing.time_end_hour ?? 23,
      paused: existing.paused ?? 0,
    });

    res.json(agentViewSync(agentId));
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: 'validation', issues: e.issues });
    throw e;
  }
});

app.post('/api/agents/:id/pause', requireAuth, (req, res) => {
  if (isChain) {
    return res.status(409).json({ error: 'chain_mode', hint: 'Call pausePolicy(agentId) from your wallet' });
  }
  const agentId = Number(req.params.id);
  if (!requireAgentOwner(req, res, agentId)) return;
  policies.setPaused(agentId, true);
  agents.setStatus(agentId, 'paused');
  res.json(agentViewSync(agentId));
});

app.post('/api/agents/:id/resume', requireAuth, (req, res) => {
  if (isChain) {
    return res.status(409).json({ error: 'chain_mode', hint: 'Call resumePolicy(agentId) from your wallet' });
  }
  const agentId = Number(req.params.id);
  if (!requireAgentOwner(req, res, agentId)) return;
  policies.setPaused(agentId, false);
  agents.setStatus(agentId, 'active');
  res.json(agentViewSync(agentId));
});

app.put('/api/agents/:id/allowlist', requireAuth, (req, res) => {
  if (isChain) {
    return res.status(409).json({ error: 'chain_mode', hint: 'Call setMerchantAllowed(...) from your wallet' });
  }
  try {
    const agentId = Number(req.params.id);
    if (!requireAgentOwner(req, res, agentId)) return;
    const b = z
      .object({
        merchant: z.string().regex(ADDR_RE),
        label: z.string().max(64).optional().default(''),
        allowed: z.boolean().default(true),
      })
      .parse(req.body);
    allowlist.upsert(agentId, b);
    res.json(allowlist.list(agentId));
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: 'validation', issues: e.issues });
    throw e;
  }
});

// ─────────────────────────────────────────────
// Feed — chain mode: on-chain events; local: DB
// ─────────────────────────────────────────────
app.get('/api/feed', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  if (isChain) {
    try {
      const rows = await chain.getRecentSpend(limit);
      return res.json(rows);
    } catch (e) {
      return res.status(502).json({ error: 'chain_read_failed', detail: e.message?.slice(0, 200) });
    }
  }
  res.json(spend.listRecent(limit).map((r) => ({ ...r, amountDisplay: fmtUsdc(r.amount) })));
});

// ─────────────────────────────────────────────
// x402 paid endpoints
// ─────────────────────────────────────────────
const PAID_RESOURCES = {
  'market-data': {
    label: 'Live market data',
    body: { ethUsd: 3842.11, btcUsd: 104210.55, baseTvlUsd: 6140576793 },
  },
  'news-brief': {
    label: 'AI news brief',
    body: { headlines: ['Base Azul upgrade live', 'Aave+Morpho on Base', 'x402 adoption grows'] },
  },
  'agent-scan': { label: 'Threat scan', body: { score: 92, flags: [], recommendation: 'safe' } },
};

app.get('/api/paid', (_req, res) => {
  res.json(
    Object.entries(PAID_RESOURCES).map(([slug, r]) => ({
      slug,
      label: r.label,
      price: '$0.01',
      endpoint: `/api/paid/${slug}`,
    }))
  );
});

app.get(
  '/api/paid/:slug',
  rateLimit({ windowMs: 60_000, max: 120, name: 'paid' }),
  paymentMiddleware({
    price: '$0.01',
    payTo: cfg.payTo,
    description: 'AgentDesk paid data endpoint',
    getAgentId: (req) => req.query.agentId,
  }),
  (req, res) => {
    const resource = PAID_RESOURCES[req.params.slug];
    if (!resource) return res.status(404).json({ error: 'unknown_resource' });
    res.json({ ok: true, label: resource.label, data: resource.body, payment: req.payment });
  }
);

// ─────────────────────────────────────────────
// Errors + SPA fallback
// ─────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (err instanceof z.ZodError) {
    return res.status(400).json({ error: 'validation', issues: err.issues });
  }
  console.error(err);
  res.status(500).json({ error: 'internal' });
});

// SPA fallback for non-API routes (local only; Vercel handles rewrites)
app.get(/^\/(?!api\/).*/, (_req, res, next) => {
  const idx = path.join(WEB_DIST, 'index.html');
  res.sendFile(idx, (err) => {
    if (err) next();
  });
});

if (process.env.NODE_ENV !== 'production') {
  logCfg();
}

export default app;
