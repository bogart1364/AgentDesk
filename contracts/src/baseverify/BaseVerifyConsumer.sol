// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISignerRegistry} from "./ISignerRegistry.sol";

/// @title BaseVerifyConsumer
///
/// @author Coinbase
///
/// @notice Implemented by consumer contracts so their eligibility policy is readable on-chain by
///         the SignerRegistry and off-chain by the Base Verify backend. This is the single source
///         of truth for a contract's policy.
///
/// @dev `provider` and `conditions` MUST be immutable (return constants). The SignerRegistry cannot
///      enforce this; a mutable policy changes `policyHash`, which breaks outstanding verifications
///      and lets one identity re-claim under a new hash.
///
/// @dev Vendored copy of Base's BaseVerifyConsumer.sol (pragma 0.8.28), retrieved from the verified
///      source of the Base Sepolia SignerRegistry implementation 0x16617468cd2c249a85db54ee06b9f2df7771b384.
///      The only change: `REGISTRY` is typed as the minimal `ISignerRegistry` interface instead of the
///      full proxy-upgradeable SignerRegistry implementation, which this repo never deploys.
///      External behaviour and `policyHash` inputs are identical to the original.
abstract contract BaseVerifyConsumer {
    /// @notice One eligibility condition in a consumer's policy, e.g. `followers gte 1000`.
    struct Condition {
        string name; // e.g. "followers"
        string op; // eq | gt | gte | lt | lte | in
        string value; // e.g. "1000"
    }

    /// @notice The SignerRegistry this consumer verifies its policy against.
    ISignerRegistry public immutable REGISTRY;

    // ================================ FUNCTIONS ================================

    constructor(address registry_) {
        REGISTRY = ISignerRegistry(registry_);
    }

    // ================================ VIEW FUNCTIONS ================================

    /// @notice The identity provider this contract gates on, e.g. "x".
    ///
    /// @return The provider identifier.
    function provider() external view virtual returns (string memory);

    /// @notice The eligibility conditions a credential must satisfy.
    ///
    /// @return The list of conditions that make up this contract's policy.
    function conditions() external view virtual returns (Condition[] memory);

    /// @notice The block a verification must be no older than. The Base Verify backend refuses to
    ///         sign for a user who last authenticated before this block's timestamp, returning
    ///         `needs_reauth`. Read off-chain by the backend; not enforced on-chain.
    ///
    /// @dev Unlike `provider` and `conditions`, this is not part of `policyHash`, so it may
    ///      change without breaking outstanding verifications. Return 0 for no cutoff.
    ///
    /// @return The cutoff block number, or 0 for no cutoff.
    function cutoffBlock() external view virtual returns (uint256) {
        return 0;
    }

    // ================================ INTERNAL FUNCTIONS ================================

    /// @dev Pass the real caller as `user` so a verification can only be spent by its wallet (stops front-running).
    function _verify(bytes32 identityHash, uint40 expiration, bytes calldata signature) internal view {
        REGISTRY.verifyVerification(msg.sender, identityHash, expiration, signature);
    }
}
