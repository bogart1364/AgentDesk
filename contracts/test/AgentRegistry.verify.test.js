const { expect } = require('chai');
const hre = require('hardhat');

/**
 * Base Verify Onchain compliance tests.
 *
 * Proves that AgentRegistry.createAgent only accepts a verification that is
 * (a) unexpired, (b) signed by an allowlisted Base Verify signer, and
 * (c) bound to this contract's policy + chain (policyHash recomputed on-chain),
 * and that the deterministic identityHash is deduped / capped per identity.
 */
describe('AgentRegistry Â· Base Verify onchain', function () {
  const POLICY_TYPES = {
    Verification: [
      { name: 'user', type: 'address' },
      { name: 'identityHash', type: 'bytes32' },
      { name: 'policyHash', type: 'bytes32' },
      { name: 'expiration', type: 'uint40' },
    ],
  };

  let registry;
  let mockRegistry;
  let deployer;
  let signerWallet;
  let user;
  let policyHash;
  let domain;
  let CHAIN_NOW; // chain clock, not wall clock (Hardhat's clock can lag behind Date.now())

  async function signVerification({ user: u, identityHash, expiration, policyHashOverride }) {
    return signerWallet.signTypedData(domain, POLICY_TYPES, {
      user: u,
      identityHash,
      policyHash: policyHashOverride || policyHash,
      expiration,
    });
  }

  before(async () => {
    [deployer, user] = await hre.ethers.getSigners();
    signerWallet = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
    await deployer.sendTransaction({ to: signerWallet.address, value: hre.ethers.parseEther('1') });

    const Mock = await hre.ethers.getContractFactory('MockSignerRegistry');
    mockRegistry = await Mock.deploy();
    await mockRegistry.waitForDeployment();
    await (await mockRegistry.addSigner(signerWallet.address)).wait();

    const Registry = await hre.ethers.getContractFactory('AgentRegistry');
    registry = await Registry.deploy(5, await mockRegistry.getAddress());
    await registry.waitForDeployment();

    const chainId = (await hre.ethers.provider.getNetwork()).chainId;
    domain = {
      name: 'BaseVerify',
      version: '1',
      chainId,
      verifyingContract: await mockRegistry.getAddress(),
    };

    // policyHash exactly as SignerRegistry computes it
    const conditions = await registry.conditions();
    policyHash = hre.ethers.keccak256(
      hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'address', 'string', 'tuple(string,string,string)[]'],
        [chainId, await registry.getAddress(), await registry.provider(), conditions]
      )
    );

    CHAIN_NOW = Number((await hre.ethers.provider.getBlock('latest')).timestamp);
  });

  it('declares an immutable coinbase Â· coinbase_one_active policy', async () => {
    expect(await registry.provider()).to.equal('coinbase');
    const c = await registry.conditions();
    expect(c.length).to.equal(1);
    expect([c[0].name, c[0].op, c[0].value]).to.deep.equal(['coinbase_one_active', 'eq', 'true']);
    expect(await registry.cutoffBlock()).to.equal(1n);
    expect(await registry.REGISTRY()).to.equal(await mockRegistry.getAddress());
  });

  it('creates an agent with a valid verification and dedupes the identityHash', async () => {
    const identityHash = hre.ethers.id('identity:test-human');
    const expiration = CHAIN_NOW + 300;
    const signature = await signVerification({ user: user.address, identityHash, expiration });

    await expect(registry.connect(user).createAgent(identityHash, expiration, signature, 'Scout', 'ipfs://meta'))
      .to.emit(registry, 'AgentCreated')
      .withArgs(1n, user.address, identityHash, 'Scout');

    const agent = await registry.getAgent(1);
    expect(agent.identityHash).to.equal(identityHash);
    expect(agent.active).to.equal(true);

    // same identity again â†’ the proof is valid, so this is dedupe/cap behaviour, not a signature failure
    const signature2 = await signVerification({ user: user.address, identityHash, expiration });
    await expect(
      registry.connect(user).createAgent(identityHash, expiration, signature2, 'Scout 2', '')
    ).to.not.be.reverted; // 5 per identity, id 2
    expect((await registry.agentsByIdentity(identityHash)).length).to.equal(2);
  });

  it('rejects an expired verification', async () => {
    const identityHash = hre.ethers.id('identity:expired');
    const expiration = CHAIN_NOW - 10;
    const signature = await signVerification({ user: user.address, identityHash, expiration });
    await expect(
      registry.connect(user).createAgent(identityHash, expiration, signature, 'Late', '')
    ).to.be.revertedWithCustomError(mockRegistry, 'VerificationExpired');
  });

  it('rejects a verification signed by an unknown signer', async () => {
    const rogue = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
    const identityHash = hre.ethers.id('identity:rogue');
    const expiration = CHAIN_NOW + 300;
    const signature = await rogue.signTypedData(domain, POLICY_TYPES, {
      user: user.address,
      identityHash,
      policyHash,
      expiration,
    });
    await expect(
      registry.connect(user).createAgent(identityHash, expiration, signature, 'Rogue', '')
    ).to.be.revertedWithCustomError(mockRegistry, 'NotSigner');
  });

  it('rejects a verification bound to a different policy', async () => {
    const identityHash = hre.ethers.id('identity:wrong-policy');
    const expiration = CHAIN_NOW + 300;
    const signature = await signVerification({
      user: user.address,
      identityHash,
      expiration,
      policyHashOverride: hre.ethers.id('some-other-policy'),
    });
    await expect(
      registry.connect(user).createAgent(identityHash, expiration, signature, 'Foreign', '')
    ).to.be.revertedWithCustomError(mockRegistry, 'NotSigner');
  });

  it('rejects a verification minted for another wallet', async () => {
    const [, , other] = await hre.ethers.getSigners();
    const identityHash = hre.ethers.id('identity:other-user');
    const expiration = CHAIN_NOW + 300;
    const signature = await signVerification({ user: other.address, identityHash, expiration });
    await expect(
      registry.connect(user).createAgent(identityHash, expiration, signature, 'Stolen', '')
    ).to.be.revertedWithCustomError(mockRegistry, 'NotSigner');
  });

  it('enforces the per-identity cap and empty-input guards', async () => {
    const identityHash = hre.ethers.id('identity:cap');
    const expiration = CHAIN_NOW + 300;
    for (let i = 0; i < 5; i++) {
      const signature = await signVerification({ user: user.address, identityHash, expiration });
      await (await registry.connect(user).createAgent(identityHash, expiration, signature, `Cap ${i}`, '')).wait();
    }
    const signature = await signVerification({ user: user.address, identityHash, expiration });
    await expect(
      registry.connect(user).createAgent(identityHash, expiration, signature, 'Cap 6', '')
    ).to.be.revertedWithCustomError(registry, 'AgentLimitReached');

    const ok = await signVerification({ user: user.address, identityHash: hre.ethers.id('identity:ok'), expiration });
    await expect(
      registry.connect(user).createAgent(hre.ethers.id('identity:ok'), expiration, ok, '', '')
    ).to.be.revertedWithCustomError(registry, 'EmptyName');
    await expect(
      registry.connect(user).createAgent(hre.ethers.ZeroHash, expiration, ok, 'Zero', '')
    ).to.be.revertedWithCustomError(registry, 'EmptyIdentity');
  });
});

