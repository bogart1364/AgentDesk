/**
 * Deploy AgentRegistry + PolicyEngine to Base Sepolia (or Base mainnet).
 * Run: npx hardhat run scripts/deploy.js --network baseSepolia
 *
 * Requires in root .env:
 *   DEPLOYER_PRIVATE_KEY=0x…   (wallet with Sepolia ETH on Base)
 *   BASE_SEPOLIA_RPC=https://sepolia.base.org   (optional, has default)
 */
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deployer:', deployer.address);
  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log('Balance:', hre.ethers.formatEther(bal), 'ETH');

  if (bal === 0n) {
    console.error('Deployer has 0 ETH. Fund it from a Base Sepolia faucet first.');
    process.exit(1);
  }

  const network = hre.network.name;
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;

  // Base Verify SignerRegistry — deployed by Base, per chain
  // Base Sepolia: 0x4f15593fbF7e3491d15080e1610E7AF8deBA1a02
  const verifyRegistry = process.env.BASE_VERIFY_SIGNER_REGISTRY || '0x4f15593fbF7e3491d15080e1610E7AF8deBA1a02';
  if (!/^0x[a-fA-F0-9]{40}$/.test(verifyRegistry)) {
    console.error('BASE_VERIFY_SIGNER_REGISTRY is not a valid address.');
    process.exit(1);
  }
  console.log('Base Verify SignerRegistry:', verifyRegistry);

  // 1. AgentRegistry — max 5 agents per verified identity, gated by Base Verify
  //    (policy: provider "coinbase" + condition coinbase_one_active eq true)
  const Registry = await hre.ethers.getContractFactory('AgentRegistry');
  const registry = await Registry.deploy(5, verifyRegistry);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log('AgentRegistry:', registryAddr);

  // 2. PolicyEngine — bound to registry
  const Policy = await hre.ethers.getContractFactory('PolicyEngine');
  const policy = await Policy.deploy(registryAddr);
  await policy.waitForDeployment();
  const policyAddr = await policy.getAddress();
  console.log('PolicyEngine:', policyAddr);

  // deploy block — DEPLOY_BLOCK makes server event scans instant
  const deployBlock = await hre.ethers.provider.getBlockNumber();
  console.log('Deploy block:', deployBlock);

  // persist deployment artifact
  const out = {
    network,
    chainId: Number(chainId),
    deployer: deployer.address,
    AgentRegistry: registryAddr,
    PolicyEngine: policyAddr,
    baseVerifySignerRegistry: verifyRegistry,
    verifyPolicy: { provider: 'coinbase', conditions: [{ name: 'coinbase_one_active', op: 'eq', value: 'true' }] },
    deployBlock,
    deployedAt: new Date().toISOString(),
  };

  const depDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(depDir, { recursive: true });
  const file = path.join(depDir, `${network}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('Wrote', file);

  // also write a JS-friendly file for server/frontend env generation
  console.log('\n--- Add to .env / Vercel env ---');
  console.log(`AGENT_REGISTRY_ADDRESS=${registryAddr}`);
  console.log(`POLICY_ENGINE_ADDRESS=${policyAddr}`);
  console.log(`BASE_VERIFY_SIGNER_REGISTRY=${verifyRegistry}`);
  console.log(`DEPLOY_BLOCK=${deployBlock}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
