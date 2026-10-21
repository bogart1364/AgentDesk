import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, defineChain } from 'viem';

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

const chain = defineChain({
  id: Number(env.CHAIN_ID || 84532),
  name: 'Base Sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [env.RPC_URL] } },
});
const pub = createPublicClient({ chain, transport: http(env.RPC_URL) });
const abiDir = path.join(ROOT, 'web', 'src', 'abi') + path.sep;
const registryAbi = JSON.parse(fs.readFileSync(abiDir + 'AgentRegistry.json', 'utf8'));
const policyAbi = JSON.parse(fs.readFileSync(abiDir + 'PolicyEngine.json', 'utf8'));
const registry = env.AGENT_REGISTRY_ADDRESS;
const policyEngine = env.POLICY_ENGINE_ADDRESS;

const j = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x));

console.log('registry', registry);
console.log('policyEngine', policyEngine);

// ── Base Verify policy (read live from the contract, as the backend does) ──
try {
  console.log('baseVerify.REGISTRY  =', await pub.readContract({ address: registry, abi: registryAbi, functionName: 'REGISTRY' }));
  console.log('baseVerify.provider  =', await pub.readContract({ address: registry, abi: registryAbi, functionName: 'provider' }));
  console.log('baseVerify.conditions=', j(await pub.readContract({ address: registry, abi: registryAbi, functionName: 'conditions' })));
  console.log('baseVerify.cutoff    =', (await pub.readContract({ address: registry, abi: registryAbi, functionName: 'cutoffBlock' })).toString());
  const isSigner = await pub.readContract({
    address: await pub.readContract({ address: registry, abi: registryAbi, functionName: 'REGISTRY' }),
    abi: [{ type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }],
    functionName: 'owner',
  });
  console.log('baseVerify.registryOwner =', isSigner);
} catch (e) {
  console.log('Base Verify policy read failed:', e.shortMessage || e.message);
}

try {
  const next = await pub.readContract({ address: registry, abi: registryAbi, functionName: 'nextAgentId' });
  console.log('nextAgentId =', next.toString());
} catch (e) {
  console.log('nextAgentId read failed:', e.shortMessage || e.message);
}

for (const id of [1n, 2n]) {
  try {
    const a = await pub.readContract({ address: registry, abi: registryAbi, functionName: 'getAgent', args: [id] });
    console.log(`getAgent(${id}) =`, j(a));
  } catch (e) {
    console.log(`getAgent(${id}) failed:`, e.shortMessage || e.message);
  }
  try {
    const p = await pub.readContract({ address: policyEngine, abi: policyAbi, functionName: 'getPolicy', args: [id] });
    console.log(`getPolicy(${id}) =`, j(p));
  } catch (e) {
    console.log(`getPolicy(${id}) failed:`, e.shortMessage || e.message);
  }
}

try {
  const from = BigInt(env.DEPLOY_BLOCK || '0');
  const logs = await pub.getLogs({ address: policyEngine, fromBlock: from, toBlock: 'latest' });
  console.log('policyEngine logs =', logs.length);
  for (const l of logs) console.log('  log', l.transactionHash, 'topics0', l.topics[0]);
} catch (e) {
  console.log('getLogs failed:', e.shortMessage || e.message);
}

try {
  const c = await pub.readContract({ address: policyEngine, abi: policyAbi, functionName: 'registry' });
  console.log('policyEngine.registry() =', c);
} catch (e) {
  console.log('registry() read failed:', e.shortMessage || e.message);
}
