// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseVerifyConsumer} from "./baseverify/BaseVerifyConsumer.sol";

/// @title AgentRegistry
/// @notice Registers AI agents linked to a Base Verify-verified human identity.
/// @dev Extends BaseVerifyConsumer, so `createAgent` only accepts a short-lived verification
///      signed by Base Verify's SignerRegistry and recomputes the policy hash from this
///      contract's own `provider()` / `conditions()`. Sybil resistance: the deterministic
///      `identityHash` is deduped here and capped per identity.
///      Docs: https://docs.base.org/sdks/base-verify/verify-users-onchain
contract AgentRegistry is BaseVerifyConsumer {
    // ─────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────
    struct Agent {
        address owner;          // human controller
        bytes32 identityHash;   // Base Verify identityHash of owner
        string  name;
        string  metadataURI;    // optional JSON descriptor
        uint64  createdAt;
        bool    active;
        uint8   version;        // bump on metadata update
    }

    // ─────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────
    address public owner; // deployer / protocol admin
    uint256 public maxAgentsPerIdentity;

    mapping(bytes32 => uint256[]) private _agentsByIdentity; // identityHash => agentIds
    mapping(uint256 => Agent)    public  agents;           // agentId => Agent
    mapping(address => uint256)  public  agentCountByOwner;

    uint256 public nextAgentId;

    // ─────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────
    event AgentCreated(
        uint256 indexed agentId,
        address indexed owner,
        bytes32 indexed identityHash,
        string  name
    );
    event AgentUpdated(uint256 indexed agentId, string name, string metadataURI);
    event AgentDeactivated(uint256 indexed agentId);
    event AgentReactivated(uint256 indexed agentId);
    event MaxAgentsUpdated(uint256 newMax);

    // ─────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────
    error NotAdmin();
    error AgentLimitReached();
    error AgentNotFound(uint256 agentId);
    error NotAgentOwner(uint256 agentId);
    error EmptyName();
    error EmptyIdentity();

    // ─────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────
    modifier onlyAdmin() {
        if (msg.sender != owner) revert NotAdmin();
        _;
    }

    modifier onlyAgentOwner(uint256 agentId) {
        if (agents[agentId].owner != msg.sender) revert NotAgentOwner(agentId);
        _;
    }

    // ─────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────
    /// @param _maxAgentsPerIdentity agent cap for one verified identity
    /// @param verifyRegistry Base Verify SignerRegistry for this chain
    ///        (Base Sepolia: 0x4f15593fbF7e3491d15080e1610E7AF8deBA1a02)
    constructor(uint256 _maxAgentsPerIdentity, address verifyRegistry) BaseVerifyConsumer(verifyRegistry) {
        owner = msg.sender;
        maxAgentsPerIdentity = _maxAgentsPerIdentity;
        nextAgentId = 1;
    }

    // ─────────────────────────────────────────────
    // Base Verify policy (MUST stay immutable)
    // ─────────────────────────────────────────────

    /// @notice Identity provider this registry gates on.
    function provider() external pure override returns (string memory) {
        return "coinbase";
    }

    /// @notice Eligibility: an active Coinbase One subscription.
    function conditions() external pure override returns (Condition[] memory) {
        Condition[] memory c = new Condition[](1);
        c[0] = Condition({name: "coinbase_one_active", op: "eq", value: "true"});
        return c;
    }

    /// @notice Credentials older than this block are refused by the Base Verify backend.
    function cutoffBlock() public pure override returns (uint256) {
        return 1;
    }

    // ─────────────────────────────────────────────
    // External writes
    // ─────────────────────────────────────────────

    /// @notice Create a new agent bound to the caller's verified identity.
    /// @dev Reverts with the SignerRegistry's `VerificationExpired` / `InvalidSignature` /
    ///      `NotSigner` when the Base Verify proof is invalid, and with `AgentLimitReached`
    ///      when this identity already holds `maxAgentsPerIdentity` agents.
    /// @param identityHash Base Verify identityHash (dedupe key, per contract)
    /// @param expiration Unix seconds after which the verification is invalid
    /// @param signature EIP-712 verification signature from Base Verify
    /// @param name Human-readable agent name
    /// @param metadataURI Optional off-chain metadata (IPFS/HTTP JSON)
    function createAgent(
        bytes32 identityHash,
        uint40 expiration,
        bytes calldata signature,
        string calldata name,
        string calldata metadataURI
    ) external returns (uint256 agentId) {
        if (bytes(name).length == 0) revert EmptyName();
        if (identityHash == bytes32(0)) revert EmptyIdentity();
        if (_agentsByIdentity[identityHash].length >= maxAgentsPerIdentity) revert AgentLimitReached();

        // checks the signature, the expiry and that it is bound to THIS contract's policy
        _verify(identityHash, expiration, signature);

        Agent storage a = agents[nextAgentId];
        a.owner         = msg.sender;
        a.identityHash  = identityHash;
        a.name          = name;
        a.metadataURI   = metadataURI;
        a.createdAt     = uint64(block.timestamp);
        a.active        = true;
        a.version       = 1;

        _agentsByIdentity[identityHash].push(nextAgentId);
        agentCountByOwner[msg.sender]++;

        agentId = nextAgentId;
        nextAgentId++;

        emit AgentCreated(agentId, msg.sender, identityHash, name);
    }

    /// @notice Update agent name / metadata (owner only).
    function updateAgent(
        uint256 agentId,
        string calldata name,
        string calldata metadataURI
    ) external onlyAgentOwner(agentId) {
        Agent storage a = agents[agentId];
        a.name        = name;
        a.metadataURI = metadataURI;
        a.version++;
        emit AgentUpdated(agentId, name, metadataURI);
    }

    /// @notice Deactivate an agent (soft-disable, keeps history).
    function deactivateAgent(uint256 agentId) external onlyAgentOwner(agentId) {
        agents[agentId].active = false;
        emit AgentDeactivated(agentId);
    }

    /// @notice Reactivate a previously deactivated agent.
    function reactivateAgent(uint256 agentId) external onlyAgentOwner(agentId) {
        agents[agentId].active = true;
        emit AgentReactivated(agentId);
    }

    /// @notice Admin: adjust per-identity agent cap.
    function setMaxAgentsPerIdentity(uint256 _max) external onlyAdmin {
        maxAgentsPerIdentity = _max;
        emit MaxAgentsUpdated(_max);
    }

    // ─────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────

    /// @notice Check if caller's identity can create another agent.
    function canCreateAgent(bytes32 identityHash) external view returns (bool) {
        return _agentsByIdentity[identityHash].length < maxAgentsPerIdentity;
    }

    /// @notice List all agent IDs for an identity.
    function agentsByIdentity(bytes32 identityHash) external view returns (uint256[] memory) {
        return _agentsByIdentity[identityHash];
    }

    /// @notice Full agent struct.
    function getAgent(uint256 agentId) external view returns (Agent memory) {
        if (agents[agentId].createdAt == 0) revert AgentNotFound(agentId);
        return agents[agentId];
    }

    /// @notice Quick active check used by PolicyEngine.
    function isActiveAgent(uint256 agentId) external view returns (bool) {
        return agents[agentId].active && agents[agentId].createdAt != 0;
    }
}
