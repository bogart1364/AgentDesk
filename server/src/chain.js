/**
 * Chain layer — real reads against Base Sepolia via viem.
 * Used only when AGENT_REGISTRY_ADDRESS + POLICY_ENGINE_ADDRESS are set.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  http,
  defineChain,
  parseAbiItem,
} from 'viem';
import { cfg } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadAbi(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'abi', `${name}.json`), 'utf8'));
}

export const registryAbi = loadAbi('AgentRegistry');
export const policyAbi = loadAbi('PolicyEngine');

const baseSepolia = defineChain({
  id: 84532,
  name: 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.base.org'] } },
  blockExplorers: { default: { name: 'Basescan', url: 'https://sepolia.basescan.org' } },
  testnet: true,
});

const baseChain = defineChain({
  id: 8453,
  name: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.base.org'] } },
  blockExplorers: { default: { name: 'Basescan', url: 'https://basescan.org' } },
});

export const chain = cfg.chainId === 8453 ? baseChain : baseSepolia;

export const publicClient = createPublicClient({
  chain,
  transport: http(cfg.rpcUrl, { timeout: 15_000 }),
});

export const contracts = {
  registry: cfg.registryAddress
    ? { address: cfg.registryAddress, abi: registryAbi }
    : null,
  policy: cfg.policyAddress
    ? { address: cfg.policyAddress, abi: policyAbi }
    : null,
};

// ── chunked getLogs (public Sepolia RPC caps eth_getLogs at 200 blocks/query) ──
const LOG_CHUNK = 200n;
// Total windows per query. 600 x 200 = 120k blocks (~2.5 days on Base Sepolia).
// Override with LOG_MAX_WINDOWS when your history is longer than that.
const LOG_MAX_WINDOWS = Number(process.env.LOG_MAX_WINDOWS || 600);
const LOG_CONCURRENCY = 8;

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * getLogs split into <=200-block ranges (the RPC rejects wider ranges).
 * Scans [fromBlock, toBlock] oldest-first; if the span exceeds LOG_MAX_WINDOWS
 * windows the oldest part is dropped (with a warning) so latency stays bounded.
 * Returns flattened, block-ordered logs.
 */
async function getLogsChunked({ address, event, args, fromBlock, toBlock }) {
  let start = fromBlock;
  const span = toBlock - fromBlock + 1n;
  const needed = Number((span + LOG_CHUNK - 1n) / LOG_CHUNK);
  if (needed > LOG_MAX_WINDOWS) {
    start = toBlock - LOG_CHUNK * BigInt(LOG_MAX_WINDOWS) + 1n;
    if (start < fromBlock) start = fromBlock;
    console.warn(
      `[chain] ${needed} windows needed from block ${fromBlock} but LOG_MAX_WINDOWS=${LOG_MAX_WINDOWS}; scanning from ${start}. Raise LOG_MAX_WINDOWS for full history.`
    );
  }
  const windows = [];
  for (let s = start; s <= toBlock; s += LOG_CHUNK) {
    const e = s + LOG_CHUNK - 1n > toBlock ? toBlock : s + LOG_CHUNK - 1n;
    windows.push({ fromBlock: s, toBlock: e });
  }
  const parts = await mapLimit(windows, LOG_CONCURRENCY, async (w) => {
    try {
      return await publicClient.getLogs({ address, event, args, ...w });
    } catch (e) {
      console.warn(`[chain] getLogs ${w.fromBlock}-${w.toBlock} failed: ${e?.shortMessage || e?.message}`);
      return [];
    }
  });
  return parts.flat();
}

// ── short TTL cache: feed/agents are polled every few seconds ──
const readCache = new Map();
const READ_TTL_MS = 8_000;
function cached(key, fn) {
  const hit = readCache.get(key);
  if (hit && Date.now() - hit.t < READ_TTL_MS) return hit.p;
  const p = Promise.resolve().then(fn).catch((e) => {
    readCache.delete(key);
    throw e;
  });
  readCache.set(key, { t: Date.now(), p });
  return p;
}

// ── event fragments ──
const spendRecordedEvent = parseAbiItem(
  'event SpendRecorded(uint256 indexed agentId, address indexed merchant, uint256 amount, uint256 txHashHint)'
);
const allowlistUpdatedEvent = parseAbiItem(
  'event AllowlistUpdated(uint256 indexed agentId, address merchant, bool allowed)'
);

/**
 * canSpend — real eth_call to PolicyEngine.sol.
 * @returns {{allowed: boolean, reason: string}}
 */
export async function canSpendOnChain(agentId, merchant, amountMicro) {
  if (!contracts.policy) throw new Error('POLICY_ENGINE_ADDRESS not configured');
  try {
    const [allowed, reason] = await publicClient.readContract({
      ...contracts.policy,
      functionName: 'canSpend',
      args: [BigInt(agentId), merchant, BigInt(amountMicro)],
    });
    return { allowed, reason: reason || (allowed ? 'ok' : 'denied') };
  } catch (e) {
    // contract revert with custom error → parse message
    const short = e?.shortMessage || e?.message || 'call failed';
    return { allowed: false, reason: `chain_error: ${short.slice(0, 120)}` };
  }
}

/** getPolicy — full policy struct from chain. */
export async function getPolicyOnChain(agentId) {
  if (!contracts.policy) return null;
  try {
    const p = await publicClient.readContract({
      ...contracts.policy,
      functionName: 'getPolicy',
      args: [BigInt(agentId)],
    });
    return {
      agentId: Number(p.agentId),
      perTxCap: Number(p.perTxCap),
      dailyBudget: Number(p.dailyBudget),
      monthlyBudget: Number(p.monthlyBudget),
      dayStart: Number(p.dayStart),
      monthStart: Number(p.monthStart),
      spentToday: Number(p.spentToday),
      spentThisMonth: Number(p.spentThisMonth),
      paused: p.paused,
      exists: p.exists,
    };
  } catch {
    return null;
  }
}

/** getUsage — remaining budgets from chain. */
export async function getUsageOnChain(agentId) {
  if (!contracts.policy) return null;
  try {
    const u = await publicClient.readContract({
      ...contracts.policy,
      functionName: 'getUsage',
      args: [BigInt(agentId)],
    });
    const MAX = 2n ** 256n - 1n;
    return {
      spentToday: Number(u[0]),
      spentThisMonth: Number(u[1]),
      dailyRemaining: u[2] === MAX ? null : Number(u[2]),
      monthlyRemaining: u[3] === MAX ? null : Number(u[3]),
      daySecondsLeft: Number(u[4]),
      monthSecondsLeft: Number(u[5]),
    };
  } catch {
    return null;
  }
}

/** getAgent — agent struct from registry. */
export async function getAgentOnChain(agentId) {
  if (!contracts.registry) return null;
  try {
    const a = await publicClient.readContract({
      ...contracts.registry,
      functionName: 'getAgent',
      args: [BigInt(agentId)],
    });
    return {
      id: Number(agentId),
      owner_address: a.owner.toLowerCase(),
      name: a.name,
      description: a.metadataURI,
      identity_hash: a.identityHash,
      status: a.active ? 'active' : 'paused',
      created_at: Number(a.createdAt),
      version: a.version,
    };
  } catch {
    return null;
  }
}

/**
 * List agents for an owner. Reads nextAgentId() then getAgent(i) directly —
 * no log scanning, so it works regardless of how far back the deploy was.
 */
export async function listAgentsByOwner(owner) {
  if (!contracts.registry) return [];
  const want = owner.toLowerCase();
  return cached(`agents:${want}`, async () => {
    let next = 1n;
    try {
      next = await publicClient.readContract({ ...contracts.registry, functionName: 'nextAgentId' });
    } catch {
      next = 1n;
    }
    const ids = [];
    for (let i = 1n; i < next; i++) ids.push(i);
    if (!ids.length) return [];

    const found = await mapLimit(ids, 8, async (id) => {
      const a = await getAgentOnChain(Number(id));
      return a && String(a.owner_address || '').toLowerCase() === want ? a : null;
    });
    return found.filter(Boolean).sort((x, y) => y.id - x.id);
  });
}

/** Recent SpendRecorded events for the live feed.
 * FEED_LOOKBACK_BLOCKS: window size (default 0 = from DEPLOY_BLOCK, full history). */
export async function getRecentSpend(limit = 50) {
  if (!contracts.policy) return [];
  return cached(`spend:${limit}`, async () => {
    const deployBlock = process.env.DEPLOY_BLOCK ? BigInt(process.env.DEPLOY_BLOCK) : 0n;
    const latest = await publicClient.getBlockNumber();
    const lookback = BigInt(Number(process.env.FEED_LOOKBACK_BLOCKS || 0));
    let start = deployBlock;
    if (lookback > 0n) {
      const windowStart = latest > lookback ? latest - lookback : 0n;
      start = windowStart > deployBlock ? windowStart : deployBlock;
    }

    const logs = await getLogsChunked({
      address: cfg.policyAddress,
      event: spendRecordedEvent,
      fromBlock: start,
      toBlock: latest,
    });

    const rows = await Promise.all(
      logs.slice(-limit).reverse().map(async (log) => {
        const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
        const amount = Number(log.args.amount);
        return {
          id: `${log.transactionHash}-${log.logIndex}`,
          agent_id: Number(log.args.agentId),
          merchant: log.args.merchant.toLowerCase(),
          amount,
          amountDisplay: (amount / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }),
          currency: 'USDC',
          endpoint: '(on-chain)',
          tx_hash: log.transactionHash,
          status: 'settled',
          policy_checked: 'on-chain',
          created_at: Number(block.timestamp),
        };
      })
    );
    return rows;
  });
}

/** Recent SpendRecorded events for a single agent (chain-mode agent detail). */
export async function getRecentSpendByAgent(agentId, limit = 20) {
  if (!contracts.policy) return [];
  return cached(`spend:agent:${agentId}:${limit}`, async () => {
    const fromBlock = process.env.DEPLOY_BLOCK ? BigInt(process.env.DEPLOY_BLOCK) : 0n;
    const latest = await publicClient.getBlockNumber();
    const logs = await getLogsChunked({
      address: cfg.policyAddress,
      event: spendRecordedEvent,
      args: { agentId: BigInt(agentId) },
      fromBlock,
      toBlock: latest,
    });

    const rows = await Promise.all(
      logs.slice(-limit).reverse().map(async (log) => {
        const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
        const amount = Number(log.args.amount);
        return {
          id: `${log.transactionHash}-${log.logIndex}`,
          agent_id: Number(log.args.agentId),
          merchant: log.args.merchant.toLowerCase(),
          amount,
          amountDisplay: (amount / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }),
          currency: 'USDC',
          endpoint: '(on-chain)',
          tx_hash: log.transactionHash,
          status: 'settled',
          policy_checked: 'on-chain',
          created_at: Number(block.timestamp),
        };
      })
    );
    return rows;
  });
}

/** Current allowlist state for an agent, derived from AllowlistUpdated events. */
export async function getAllowlistOnChain(agentId) {
  if (!contracts.policy) return [];
  return cached(`allow:${agentId}`, async () => {
    const fromBlock = process.env.DEPLOY_BLOCK ? BigInt(process.env.DEPLOY_BLOCK) : 0n;
    const latest = await publicClient.getBlockNumber();
    const logs = await getLogsChunked({
      address: cfg.policyAddress,
      event: allowlistUpdatedEvent,
      args: { agentId: BigInt(agentId) },
      fromBlock,
      toBlock: latest,
    });

    const state = new Map();
    for (const log of logs) {
      const merchant = log.args.merchant.toLowerCase();
      state.set(merchant, { merchant, label: '', allowed: log.args.allowed ? 1 : 0 });
    }
    return [...state.values()];
  });
}

/** Check chain connectivity. */
export async function pingChain() {
  try {
    const block = await publicClient.getBlockNumber();
    return { ok: true, block: Number(block) };
  } catch (e) {
    return { ok: false, error: e?.message?.slice(0, 100) || 'rpc failed' };
  }
}
