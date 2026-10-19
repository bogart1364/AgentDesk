/**
 * Seed demo data for AgentDesk dashboard
 * Run: npm run seed
 */
import { humans, agents, policies, allowlist, spend, dbInfo } from './index.js';

const now = Math.floor(Date.now() / 1000);

const demoHumans = [
  {
    address: '0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    verified: 1,
    provider: 'x',
    hash: '0x' + 'aa'.repeat(32),
  },
  {
    address: '0x1111111111111111111111111111111111111111',
    verified: 0,
    provider: null,
    hash: null,
  },
];

for (const h of demoHumans) {
  humans.upsert(h.address, {
    identity_hash: h.hash,
    verified: h.verified,
    verify_provider: h.provider,
  });
}

const demoAgents = [
  {
    owner: demoHumans[0].address,
    name: 'Market Scout',
    desc: 'Fetches live market data, pays $0.01 per call via x402',
    perTx: 10_000_000,
    daily: 100_000_000,
    monthly: 1_000_000_000,
  },
  {
    owner: demoHumans[0].address,
    name: 'News Bot',
    desc: 'Monitors Base ecosystem news, pays for briefs',
    perTx: 5_000_000,
    daily: 50_000_000,
    monthly: 500_000_000,
  },
  {
    owner: demoHumans[1].address,
    name: 'Threat Scanner',
    desc: 'Scans contracts, limited budget',
    perTx: 2_000_000,
    daily: 20_000_000,
    monthly: 200_000_000,
  },
];

const agentIds = [];
for (const a of demoAgents) {
  const human = humans.get(a.owner);
  const agent = agents.create({
    owner_address: a.owner,
    name: a.name,
    description: a.desc,
    identity_hash: human?.identity_hash,
  });
  agentIds.push(agent.id);
  policies.upsert(agent.id, {
    per_tx_cap: a.perTx,
    daily_budget: a.daily,
    monthly_budget: a.monthly,
    use_allowlist: 0,
    time_window_en: 0,
    time_start_hour: 0,
    time_end_hour: 23,
    paused: 0,
  });
}

allowlist.upsert(agentIds[0], {
  merchant: '0xdead00000000000000000000000000000000dead',
  label: 'AgentDesk Demo API',
  allowed: true,
});

const merchants = [
  '0xdead00000000000000000000000000000000dead',
  '0x0000000000000000000000000000000000000002',
  '0x0000000000000000000000000000000000000003',
];
const endpoints = ['/api/paid/market-data', '/api/paid/news-brief', '/api/paid/agent-scan'];

for (let i = 0; i < 24; i++) {
  spend.insert({
    agent_id: agentIds[i % agentIds.length],
    merchant: merchants[i % merchants.length],
    amount: (Math.floor(Math.random() * 90) + 10) * 10_000,
    endpoint: endpoints[i % endpoints.length],
    tx_hash: '0x' + Buffer.from(`seed:${i}:${now}`).toString('hex').padEnd(64, '0').slice(0, 64),
    status: 'settled',
    policy_checked: 'ok',
    created_at: now - Math.floor(Math.random() * 86400),
  });
}

console.log(`Seeded: ${demoHumans.length} humans, ${demoAgents.length} agents, 24 spend logs`);
console.log(dbInfo());
