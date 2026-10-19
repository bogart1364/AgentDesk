// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentRegistry
/// @notice Registers AI agents linked to a verified human identity.
/// @dev Uses Base Verify identityHash for sybil resistance (one human → max N agents).
contract AgentRegistry {
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
    constructor(uint256 _maxAgentsPerIdentity) {
        owner = msg.sender;
        maxAgentsPerIdentity = _maxAgentsPerIdentity;
        nextAgentId = 1;
    }

    // ─────────────────────────────────────────────
    // External writes
    // ─────────────────────────────────────────────

    /// @notice Create a new agent bound to the caller's verified identity.
    /// @param identityHash Base Verify identityHash proving unique human
    /// @param name Human-readable agent name
    /// @param metadataURI Optional off-chain metadata (IPFS/HTTP JSON)
    function createAgent(
        bytes32 identityHash,
        string calldata name,
        string calldata metadataURI
    ) external returns (uint256 agentId) {
        if (bytes(name).length == 0) revert EmptyName();

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
