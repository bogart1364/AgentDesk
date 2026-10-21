// Probes eth_getLogs range limits on the configured RPC so chain.js chunking stays inside them.
// Usage: node tools/chain/rpc-probe.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const RPC = env.RPC_URL || 'https://sepolia.base.org';
const ADDR = env.AGENT_REGISTRY_ADDRESS || '0x4b9F26A00C0c5Cd940221d6A44326F203aa59Be5';

const call = async (method, params) => {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return res.json();
};

const { result: latestHex } = await call('eth_blockNumber', []);
const latest = BigInt(latestHex);
console.log('rpc:', RPC, '| latest block:', latest.toString());

for (const span of [200, 1000, 2000, 5000, 10000, 50000]) {
  const from = latest - BigInt(span);
  const started = Date.now();
  const r = await call('eth_getLogs', [
    { address: ADDR, fromBlock: '0x' + from.toString(16), toBlock: '0x' + latest.toString(16) },
  ]);
  const ms = Date.now() - started;
  if (r.error) console.log(`  span ${span.toString().padStart(6)}  ERR  ${JSON.stringify(r.error).slice(0, 100)} (${ms}ms)`);
  else console.log(`  span ${span.toString().padStart(6)}  OK   logs=${r.result.length} (${ms}ms)`);
}

