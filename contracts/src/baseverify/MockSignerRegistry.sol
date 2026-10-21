// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {BaseVerifyConsumer} from "./BaseVerifyConsumer.sol";

/// @title MockSignerRegistry
/// @notice TEST ONLY. Local stand-in for Base's deployed SignerRegistry
///         (Base Sepolia proxy 0x4f15593fbF7e3491d15080e1610E7AF8deBA1a02).
/// @dev Replicates the official verification math exactly:
///        policyHash = keccak256(abi.encode(block.chainid, msg.sender, consumer.provider(), consumer.conditions()))
///        digest     = EIP-712 "BaseVerify"/"1" over
///                     Verification(address user, bytes32 identityHash, bytes32 policyHash, uint40 expiration)
///      so tests exercise the same signature/policy binding the real registry enforces.
contract MockSignerRegistry {
    mapping(address signer => bool trusted) public signers;

    bytes32 private constant VERIFICATION_TYPEHASH =
        keccak256("Verification(address user,bytes32 identityHash,bytes32 policyHash,uint40 expiration)");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    event SignerAdded(address indexed signer);

    error VerificationExpired(uint40 expiration);
    error InvalidSignature();
    error NotSigner(address signer);

    function addSigner(address signer) external {
        signers[signer] = true;
        emit SignerAdded(signer);
    }

    function verifyVerification(
        address user,
        bytes32 identityHash,
        uint40 expiration,
        bytes calldata signature
    ) external view {
        if (block.timestamp > expiration) revert VerificationExpired(expiration);

        (address recovered, ECDSA.RecoverError err) = _recover(msg.sender, user, identityHash, expiration, signature);
        if (err != ECDSA.RecoverError.NoError) revert InvalidSignature();
        if (!signers[recovered]) revert NotSigner(recovered);
    }

    function isValidVerification(
        address consumer,
        address user,
        bytes32 identityHash,
        uint40 expiration,
        bytes calldata signature
    ) external view returns (bool) {
        if (block.timestamp > expiration) return false;
        (address recovered, ECDSA.RecoverError err) = _recover(consumer, user, identityHash, expiration, signature);
        return err == ECDSA.RecoverError.NoError && signers[recovered];
    }

    function _recover(
        address consumer,
        address user,
        bytes32 identityHash,
        uint40 expiration,
        bytes calldata signature
    ) private view returns (address, ECDSA.RecoverError) {
        BaseVerifyConsumer c = BaseVerifyConsumer(consumer);
        bytes32 policyHash = keccak256(abi.encode(block.chainid, consumer, c.provider(), c.conditions()));
        bytes32 structHash = keccak256(abi.encode(VERIFICATION_TYPEHASH, user, identityHash, policyHash, expiration));
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(_hashTypedDataV4(structHash), signature);
        return (recovered, err);
    }

    function _hashTypedDataV4(bytes32 structHash) private view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("BaseVerify"), keccak256("1"), block.chainid, address(this))
        );
        return keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));
    }
}
