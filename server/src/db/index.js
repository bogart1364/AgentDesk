/**
 * AgentDesk DB layer — pure JS (no native deps)
 * JSON file persistence + in-memory indexes. Swap for SQLite/Postgres in production.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'agentdesk-data.json');

// ── load / init ──
let data = {
  humans: {},        // address -> human
  agents: [],        // agent objects
  policies: {},      // agentId -> policy
  allowlist: {},     // agentId -> [{merchant,label,allowed}]
  spendLogs: [],
  seq: { agent: 1, spend: 1 },
};

if (fs.existsSync(DB_PATH)) {
  try {
    data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    // corrupt → fresh
  }
}

function persist() {
  fs.writeFileSync(DB_PATH, JSON.stringify(data));
}

const now = () => Math.floor(Date.now() / 1000);
const lower = (a) => String(a || '').toLowerCase();

// ── humans ──
export const humans = {
  get(address) {
    return data.humans[lower(address)] || null;
  },
  upsert(address, fields = {}) {
    const addr = lower(address);
    const existing = data.humans[addr] || {
      address: addr,
      identity_hash: null,
      verified: 0,
      verify_provider: null,
      created_at: now(),
    };
    data.humans[addr] = {
      ...existing,
      ...fields,
      identity_hash: fields.identity_hash ?? existing.identity_hash,
      verified: Math.max(existing.verified || 0, fields.verified || 0),
      verify_provider: fields.verify_provider ?? existing.verify_provider,
    };
    persist();
    return data.humans[addr];
  },
};

// ── agents ──
export const agents = {
  listByOwner(address) {
    return data.agents.filter((a) => a.owner_address === lower(address));
  },
  get(id) {
    return data.agents.find((a) => a.id === Number(id)) || null;
  },
  countByOwner(address) {
    return data.agents.filter((a) => a.owner_address === lower(address)).length;
  },
  create({ owner_address, name, description, identity_hash }) {
    const id = data.seq.agent++;
    const t = now();
    const agent = {
      id,
      owner_address: lower(owner_address),
      name,
      description: description || '',
      identity_hash: identity_hash || null,
      status: 'active',
      created_at: t,
      updated_at: t,
    };
    data.agents.push(agent);
    persist();
    return agent;
  },
  setStatus(id, status) {
    const a = agents.get(id);
    if (a) {
      a.status = status;
      a.updated_at = now();
      persist();
    }
    return a;
  },
};

// ── policies ──
export const policies = {
  get(agentId) {
    return data.policies[Number(agentId)] || null;
  },
  upsert(agentId, fields) {
    const id = Number(agentId);
    const existing = data.policies[id] || { agent_id: id, created_at: now() };
    data.policies[id] = {
      ...existing,
      ...fields,
      agent_id: id,
      updated_at: now(),
    };
    persist();
    return data.policies[id];
  },
  setPaused(agentId, paused) {
    const p = policies.get(agentId);
    if (p) {
      p.paused = paused ? 1 : 0;
      p.updated_at = now();
      persist();
    }
    return p;
  },
};

// ── allowlist ──
export const allowlist = {
  list(agentId) {
    return data.allowlist[Number(agentId)] || [];
  },
  upsert(agentId, { merchant, label = '', allowed = true }) {
    const id = Number(agentId);
    const m = lower(merchant);
    const list = data.allowlist[id] || [];
    const idx = list.findIndex((x) => x.merchant === m);
    if (idx >= 0) list[idx] = { merchant: m, label, allowed: allowed ? 1 : 0 };
    else list.push({ merchant: m, label, allowed: allowed ? 1 : 0 });
    data.allowlist[id] = list;
    persist();
    return list;
  },
  isAllowed(agentId, merchant) {
    const row = allowlist.list(agentId).find((x) => x.merchant === lower(merchant));
    return !!(row && row.allowed);
  },
};

// ── spend logs ──
export const spend = {
  insert(fields) {
    const id = data.seq.spend++;
    const row = {
      id,
      agent_id: Number(fields.agent_id),
      merchant: lower(fields.merchant),
      amount: Number(fields.amount),
      currency: fields.currency || 'USDC',
      endpoint: fields.endpoint || '',
      tx_hash: fields.tx_hash || null,
      status: fields.status || 'settled',
      policy_checked: fields.policy_checked || '',
      created_at: fields.created_at || now(),
    };
    data.spendLogs.push(row);
    // cap log size
    if (data.spendLogs.length > 5000) data.spendLogs = data.spendLogs.slice(-4000);
    persist();
    return row;
  },
  listByAgent(agentId, limit = 20) {
    return data.spendLogs
      .filter((r) => r.agent_id === Number(agentId))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, limit);
  },
  listRecent(limit = 50) {
    return [...data.spendLogs].sort((a, b) => b.created_at - a.created_at).slice(0, limit);
  },
  sumSince(agentId, sinceTs) {
    return data.spendLogs
      .filter((r) => r.agent_id === Number(agentId) && r.status === 'settled' && r.created_at >= sinceTs)
      .reduce((s, r) => s + r.amount, 0);
  },
};

// ── policy engine (mirrors on-chain PolicyEngine.sol) ──
export const policyEngine = {
  canSpend(agentId, merchant, amountMicro) {
    const agent = agents.get(agentId);
    if (!agent || agent.status !== 'active') return { allowed: false, reason: 'agent_inactive' };

    const policy = policies.get(agentId);
    if (!policy) return { allowed: false, reason: 'no_policy' };
    if (policy.paused) return { allowed: false, reason: 'paused' };
    if (amountMicro <= 0) return { allowed: false, reason: 'zero_amount' };

    if (policy.per_tx_cap > 0 && amountMicro > policy.per_tx_cap) {
      return { allowed: false, reason: 'exceeds_per_tx_cap' };
    }

    const t = now();
    const dayStart = t - (t % 86400);
    const monthStart = t - (t % (30 * 86400));

    if (policy.daily_budget > 0) {
      const today = spend.sumSince(agentId, dayStart);
      if (today + amountMicro > policy.daily_budget) {
        return { allowed: false, reason: 'exceeds_daily_budget' };
      }
    }
    if (policy.monthly_budget > 0) {
      const month = spend.sumSince(agentId, monthStart);
      if (month + amountMicro > policy.monthly_budget) {
        return { allowed: false, reason: 'exceeds_monthly_budget' };
      }
    }

    if (policy.use_allowlist) {
      if (!allowlist.isAllowed(agentId, merchant)) {
        return { allowed: false, reason: 'merchant_not_allowed' };
      }
    }

    if (policy.time_window_en) {
      const h = new Date().getUTCHours();
      const s = policy.time_start_hour ?? 0;
      const e = policy.time_end_hour ?? 23;
      let ok;
      if (s <= e) ok = h >= s && h < e;
      else ok = h >= s || h < e;
      if (!ok) return { allowed: false, reason: 'outside_time_window' };
    }

    return { allowed: true, reason: 'ok' };
  },

  recordSpend(agentId, merchant, amountMicro, endpoint, txHash, policyChecked) {
    return spend.insert({
      agent_id: agentId,
      merchant,
      amount: amountMicro,
      endpoint,
      tx_hash: txHash,
      status: 'settled',
      policy_checked: policyChecked || 'ok',
    });
  },
};

// ── utils ──
export const fmtUsdc = (micro) => {
  const n = Number(micro) / 1e6;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
};

export const dbInfo = () => ({
  humans: Object.keys(data.humans).length,
  agents: data.agents.length,
  spendLogs: data.spendLogs.length,
  path: DB_PATH,
});

export { persist, data as _data };
