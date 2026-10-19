// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentRegistry {
    function isActiveAgent(uint256 agentId) external view returns (bool);
    function agents(uint256 agentId) external view returns (
        address owner,
        bytes32 identityHash,
        string memory name,
        string memory metadataURI,
        uint64 createdAt,
        bool active,
        uint8 version
    );
}

/// @title PolicyEngine
/// @notice On-chain spend policies for AI agents: per-tx caps, daily/monthly budgets,
///         merchant allowlists, time windows, and a kill-switch.
/// @dev Amounts are in USDC (6 decimals). Integrates with x402 facilitator flow:
///      server checks canSpend() before signing EIP-3009, then records after settle.
contract PolicyEngine {
    // ─────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────
    uint256 public constant DAY    = 86400;
    uint256 public constant MONTH  = 30 * DAY;
    uint64  public constant USDC_DECIMALS = 6;

    // ─────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────
    struct Policy {
        uint256 agentId;
        uint256 perTxCap;        // max USDC (6dec) per single payment
        uint256 dailyBudget;     // max USDC per UTC day (0 = unlimited)
        uint256 monthlyBudget;   // max USDC per calendar month (0 = unlimited)
        uint64  dayStart;        // UTC day start timestamp for current window
        uint64  monthStart;      // UTC month start for current window
        uint256 spentToday;
        uint256 spentThisMonth;
        bool    paused;          // kill-switch
        bool    exists;
    }

    struct AllowlistEntry {
        address merchant;
        bool    allowed;
        string  label;
    }

    // ─────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────
    IAgentRegistry public immutable registry;
    address public owner;

    mapping(uint256 => Policy) public policies; // agentId => Policy

    // agentId => merchant => allowed
    mapping(uint256 => mapping(address => bool)) public merchantAllowed;
    // agentId => list of allowlist entries (for UI)
    mapping(uint256 => AllowlistEntry[]) public allowlist;

    // if useAllowlist[agentId] is true, ONLY allowlisted merchants can be paid
    mapping(uint256 => bool) public useAllowlist;

    // time window: if activeHours[agentId].enabled, only allow within [startHour, endHour) UTC
    struct TimeWindow {
        bool enabled;
        uint8 startHour; // 0-23
        uint8 endHour;   // 0-23
    }
    mapping(uint256 => TimeWindow) public timeWindow;

    // ─────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────
    event PolicyCreated(uint256 indexed agentId, uint256 perTxCap, uint256 dailyBudget, uint256 monthlyBudget);
    event PolicyUpdated(uint256 indexed agentId);
    event PolicyPaused(uint256 indexed agentId);
    event PolicyResumed(uint256 indexed agentId);
    event AllowlistUpdated(uint256 indexed agentId, address merchant, bool allowed);
    event TimeWindowUpdated(uint256 indexed agentId, bool enabled, uint8 startHour, uint8 endHour);
    event SpendRecorded(uint256 indexed agentId, address indexed merchant, uint256 amount, uint256 txHashHint);
    event BudgetReset(uint256 indexed agentId, uint8 windowType); // 0=day 1=month

    // ─────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────
    error NotAdmin();
    error NotAgentOwner(uint256 agentId);
    error PolicyAlreadyExists(uint256 agentId);
    error PolicyNotFound(uint256 agentId);
    error AgentInactive(uint256 agentId);
    error SpendPaused(uint256 agentId);
    error ExceedsPerTxCap(uint256 amount, uint256 cap);
    error ExceedsDailyBudget(uint256 spentToday, uint256 budget);
    error ExceedsMonthlyBudget(uint256 spentThisMonth, uint256 budget);
    error MerchantNotAllowed(address merchant);
    error OutsideTimeWindow(uint8 currentHour);
    error ZeroAmount();

    // ─────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────
    modifier onlyAdmin() {
        if (msg.sender != owner) revert NotAdmin();
        _;
    }

    modifier onlyAgentOwner(uint256 agentId) {
        (address agentOwner,,,,,,) = registry.agents(agentId);
        if (msg.sender != agentOwner) revert NotAgentOwner(agentId);
        _;
    }

    modifier policyExists(uint256 agentId) {
        if (!policies[agentId].exists) revert PolicyNotFound(agentId);
        _;
    }

    // ─────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────
    constructor(address _registry) {
        registry = IAgentRegistry(_registry);
        owner = msg.sender;
    }

    // ─────────────────────────────────────────────
    // Policy lifecycle
    // ─────────────────────────────────────────────

    /// @notice Create or replace spend policy for an agent.
    function setPolicy(
        uint256 agentId,
        uint256 perTxCap,
        uint256 dailyBudget,
        uint256 monthlyBudget
    ) external onlyAgentOwner(agentId) {
        Policy storage p = policies[agentId];
        p.agentId       = agentId;
        p.perTxCap      = perTxCap;
        p.dailyBudget   = dailyBudget;
        p.monthlyBudget = monthlyBudget;
        p.paused        = false;
        p.exists        = true;

        // initialize windows on first create
        if (p.dayStart == 0) {
            p.dayStart  = uint64(_utcDayStart(block.timestamp));
            p.monthStart = uint64(_utcMonthStart(block.timestamp));
        }

        emit PolicyCreated(agentId, perTxCap, dailyBudget, monthlyBudget);
    }

    /// @notice Update budgets / cap (keeps spend counters).
    function updatePolicy(
        uint256 agentId,
        uint256 perTxCap,
        uint256 dailyBudget,
        uint256 monthlyBudget
    ) external onlyAgentOwner(agentId) policyExists(agentId) {
        Policy storage p = policies[agentId];
        p.perTxCap      = perTxCap;
        p.dailyBudget   = dailyBudget;
        p.monthlyBudget = monthlyBudget;
        emit PolicyUpdated(agentId);
    }

    /// @notice Kill-switch: pause all spending for this agent.
    function pausePolicy(uint256 agentId) external onlyAgentOwner(agentId) policyExists(agentId) {
        policies[agentId].paused = true;
        emit PolicyPaused(agentId);
    }

    function resumePolicy(uint256 agentId) external onlyAgentOwner(agentId) policyExists(agentId) {
        policies[agentId].paused = false;
        emit PolicyResumed(agentId);
    }

    // ─────────────────────────────────────────────
    // Allowlist management
    // ─────────────────────────────────────────────

    function setUseAllowlist(uint256 agentId, bool enabled) external onlyAgentOwner(agentId) policyExists(agentId) {
        useAllowlist[agentId] = enabled;
        emit PolicyUpdated(agentId);
    }

    function setMerchantAllowed(
        uint256 agentId,
        address merchant,
        bool allowed,
        string calldata label
    ) external onlyAgentOwner(agentId) policyExists(agentId) {
        merchantAllowed[agentId][merchant] = allowed;

        // maintain list for UI (simple: push if not present)
        AllowlistEntry[] storage list = allowlist[agentId];
        bool found = false;
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i].merchant == merchant) {
                list[i].allowed = allowed;
                list[i].label   = label;
                found = true;
                break;
            }
        }
        if (!found) {
            list.push(AllowlistEntry({merchant: merchant, allowed: allowed, label: label}));
        }

        emit AllowlistUpdated(agentId, merchant, allowed);
    }

    // ─────────────────────────────────────────────
    // Time window
    // ─────────────────────────────────────────────

    function setTimeWindow(
        uint256 agentId,
        bool enabled,
        uint8 startHour,
        uint8 endHour
    ) external onlyAgentOwner(agentId) policyExists(agentId) {
        timeWindow[agentId] = TimeWindow({enabled: enabled, startHour: startHour, endHour: endHour});
        emit TimeWindowUpdated(agentId, enabled, startHour, endHour);
    }

    // ─────────────────────────────────────────────
    // Core: spend check + record (called by facilitator / server)
    // ─────────────────────────────────────────────

    /// @notice Dry-run check: can this agent spend `amount` to `merchant` right now?
    /// @dev View function — server calls via eth_call before signing x402 payment.
    function canSpend(
        uint256 agentId,
        address merchant,
        uint256 amount
    ) external view returns (bool allowed, string memory reason) {
        // agent active?
        if (!registry.isActiveAgent(agentId)) return (false, "agent_inactive");

        Policy memory p = policies[agentId];
        if (!p.exists) return (false, "no_policy");
        if (p.paused) return (false, "paused");
        if (amount == 0) return (false, "zero_amount");

        // refresh windows
        uint256 spentToday   = p.spentToday;
        uint256 spentMonth   = p.spentThisMonth;
        if (block.timestamp >= uint256(p.dayStart) + DAY) spentToday = 0;
        if (block.timestamp >= uint256(p.monthStart) + MONTH) spentMonth = 0;

        // per-tx
        if (p.perTxCap > 0 && amount > p.perTxCap) {
            return (false, "exceeds_per_tx_cap");
        }
        // daily
        if (p.dailyBudget > 0 && spentToday + amount > p.dailyBudget) {
            return (false, "exceeds_daily_budget");
        }
        // monthly
        if (p.monthlyBudget > 0 && spentMonth + amount > p.monthlyBudget) {
            return (false, "exceeds_monthly_budget");
        }
        // allowlist
        if (useAllowlist[agentId] && !merchantAllowed[agentId][merchant]) {
            return (false, "merchant_not_allowed");
        }
        // time window
        TimeWindow memory tw = timeWindow[agentId];
        if (tw.enabled) {
            uint8 h = uint8((block.timestamp % DAY) / 3600);
            if (tw.startHour <= tw.endHour) {
                if (h < tw.startHour || h >= tw.endHour) return (false, "outside_time_window");
            } else {
                // overnight window e.g. 22-6
                if (h < tw.startHour && h >= tw.endHour) return (false, "outside_time_window");
            }
        }

        return (true, "");
    }

    /// @notice Record a successful spend. Called once after x402 settle.
    /// @dev In production this should be called by a trusted settler address.
    function recordSpend(
        uint256 agentId,
        address merchant,
        uint256 amount,
        uint256 txHashHint
    ) external {
        // in production: onlyAllow settler. For MVP open for demo.
        Policy storage p = policies[agentId];
        if (!p.exists) revert PolicyNotFound(agentId);

        // roll windows
        if (block.timestamp >= uint256(p.dayStart) + DAY) {
            p.spentToday = 0;
            p.dayStart   = uint64(_utcDayStart(block.timestamp));
            emit BudgetReset(agentId, 0);
        }
        if (block.timestamp >= uint256(p.monthStart) + MONTH) {
            p.spentThisMonth = 0;
            p.monthStart     = uint64(_utcMonthStart(block.timestamp));
            emit BudgetReset(agentId, 1);
        }

        p.spentToday   += amount;
        p.spentThisMonth += amount;

        emit SpendRecorded(agentId, merchant, amount, txHashHint);
    }

    // ─────────────────────────────────────────────
    // Views for dashboard
    // ─────────────────────────────────────────────

    function getPolicy(uint256 agentId) external view returns (Policy memory) {
        return policies[agentId];
    }

    /// @notice Current usage snapshot for UI.
    function getUsage(uint256 agentId)
        external
        view
        returns (
            uint256 spentToday,
            uint256 spentThisMonth,
            uint256 dailyRemaining,
            uint256 monthlyRemaining,
            uint256 daySecondsLeft,
            uint256 monthSecondsLeft
        )
    {
        Policy memory p = policies[agentId];
        if (!p.exists) revert PolicyNotFound(agentId);

        // roll windows in memory
        if (block.timestamp >= uint256(p.dayStart) + DAY) spentToday = 0;
        else spentToday = p.spentToday;

        if (block.timestamp >= uint256(p.monthStart) + MONTH) spentThisMonth = 0;
        else spentThisMonth = p.spentThisMonth;

        dailyRemaining   = p.dailyBudget > 0 ? (p.dailyBudget > spentToday ? p.dailyBudget - spentToday : 0) : type(uint256).max;
        monthlyRemaining = p.monthlyBudget > 0 ? (p.monthlyBudget > spentThisMonth ? p.monthlyBudget - spentThisMonth : 0) : type(uint256).max;

        daySecondsLeft  = uint256(p.dayStart) + DAY - block.timestamp;
        monthSecondsLeft = uint256(p.monthStart) + MONTH - block.timestamp;
    }

    function getAllowlist(uint256 agentId) external view returns (AllowlistEntry[] memory) {
        return allowlist[agentId];
    }

    // ─────────────────────────────────────────────
    // Internal time helpers
    // ─────────────────────────────────────────────
    function _utcDayStart(uint256 t) internal pure returns (uint256) {
        return t - (t % DAY);
    }

    function _utcMonthStart(uint256 t) internal pure returns (uint256) {
        // approximate 30-day months for budget windows (simple, documented)
        return t - (t % MONTH);
    }
}
