import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  keccak256,
  toHex,
  parseEventLogs,
  formatEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const envPath = path.join(ROOT, '.env');
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
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

const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const pub = createPublicClient({ chain, transport: http(env.RPC_URL) });
const wallet = createWalletClient({ account, chain, transport: http(env.RPC_URL) });

const abiDir = path.join(ROOT, 'web', 'src', 'abi') + path.sep;
const registryAbi = JSON.parse(fs.readFileSync(abiDir + 'AgentRegistry.json', 'utf8'));
const policyAbi = JSON.parse(fs.readFileSync(abiDir + 'PolicyEngine.json', 'utf8'));

const registry = env.AGENT_REGISTRY_ADDRESS;
const policyEngine = env.POLICY_ENGINE_ADDRESS;
const identityHash = keccak256(toHex(account.address.toLowerCase()));

const out = { owner: account.address, registry, policyEngine, identityHash, txs: {} };

out.balanceBefore = formatEther(await pub.getBalance({ address: account.address }));

const next = await pub.readContract({ address: registry, abi: registryAbi, functionName: 'nextAgentId' });
let agentId;
if (next > 1n) {
  const candidate = next - 1n;
  const a = await pub.readContract({ address: registry, abi: registryAbi, functionName: 'getAgent', args: [candidate] });
  if (a.owner.toLowerCase() === account.address.toLowerCase()) {
    agentId = candidate;
    out.reusedAgentId = agentId.toString();
  }
}

if (agentId === undefined) {
  const h1 = await wallet.writeContract({
    address: registry,
    abi: registryAbi,
    functionName: 'createAgent',
    args: [identityHash, 'Chain Smoke Agent', 'agentdesk://smoke'],
  });
  const r1 = await pub.waitForTransactionReceipt({ hash: h1 });
  out.txs.createAgent = { hash: h1, status: r1.status, gasUsed: r1.gasUsed.toString() };
  const created = parseEventLogs({ abi: registryAbi, logs: r1.logs, eventName: 'AgentCreated' });
  agentId = created[0].args.agentId;
}
out.agentId = agentId.toString();

const h2 = await wallet.writeContract({
  address: policyEngine,
  abi: policyAbi,
  functionName: 'setPolicy',
  args: [agentId, 5_000_000n, 50_000_000n, 500_000_000n],
});
const r2 = await pub.waitForTransactionReceipt({ hash: h2 });
out.txs.setPolicy = { hash: h2, status: r2.status, gasUsed: r2.gasUsed.toString() };

let spendOk = null;
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    const h3 = await wallet.writeContract({
      address: policyEngine,
      abi: policyAbi,
      functionName: 'recordSpend',
      args: [agentId, '0x00000000000000000000000000000000000000A1', 1_500_000n, 0n],
    });
    const r3 = await pub.waitForTransactionReceipt({ hash: h3 });
    spendOk = { hash: h3, status: r3.status, gasUsed: r3.gasUsed.toString(), attempt };
    break;
  } catch (e) {
    out[`recordSpendAttempt${attempt}Error`] = (e.shortMessage || e.message || '').slice(0, 160);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
out.txs.recordSpend = spendOk;

try {
  const h4 = await wallet.writeContract({
    address: policyEngine,
    abi: policyAbi,
    functionName: 'setMerchantAllowed',
    args: [agentId, '0x00000000000000000000000000000000000000A1', true, 'smoke-merchant'],
  });
  const r4 = await pub.waitForTransactionReceipt({ hash: h4 });
  out.txs.setMerchantAllowed = { hash: h4, status: r4.status, gasUsed: r4.gasUsed.toString() };
} catch (e) {
  out.setMerchantAllowedError = (e.shortMessage || e.message || '').slice(0, 200);
}

out.balanceAfter = formatEther(await pub.getBalance({ address: account.address }));
out.agentOnChain = await pub.readContract({
  address: registry,
  abi: registryAbi,
  functionName: 'getAgent',
  args: [agentId],
});
out.policyOnChain = await pub.readContract({
  address: policyEngine,
  abi: policyAbi,
  functionName: 'getPolicy',
  args: [agentId],
});

console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
