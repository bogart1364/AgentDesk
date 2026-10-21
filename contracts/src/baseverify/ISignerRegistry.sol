// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ISignerRegistry
/// @notice Minimal interface for Base's deployed SignerRegistry
///         (Base Sepolia proxy: 0x4f15593fbF7e3491d15080e1610E7AF8deBA1a02).
/// @dev Vendored view of the official SignerRegistry's external surface. The full contract is
///      proxy-upgradeable (UUPS + OpenZeppelin) and is deployed by Base, so this repo only needs
///      the functions a consumer calls. `verifyVerification` reverts with `VerificationExpired`,
///      `InvalidSignature` or `NotSigner`, exactly as documented at
///      https://docs.base.org/sdks/base-verify/verify-users-onchain
interface ISignerRegistry {
    function verifyVerification(
        address user,
        bytes32 identityHash,
        uint40 expiration,
        bytes calldata signature
    ) external view;

    function isValidVerification(
        address consumer,
        address user,
        bytes32 identityHash,
        uint40 expiration,
        bytes calldata signature
    ) external view returns (bool);
}
