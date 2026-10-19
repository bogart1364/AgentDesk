/**
 * Base Verify adapter
 * Production: call Base Verify REST API with SIWE signature.
 * Docs: https://docs.base.org/sdks/base-verify/overview

 *
 * Flow:
 *  1. Client signs SIWE message
 *  2. POST /verify → we forward to Base Verify API
 *  3. Return identityHash + traits
 */

const BASE_VERIFY_API = process.env.BASE_VERIFY_API || 'https://verify.base.org/api';

/**
 * Verify a wallet + social account via Base Verify.
 * @param {string} address - wallet address
 * @param {string} siweMessage - SIWE message the wallet signed
 * @param {string} signature - hex signature
 * @param {string} provider - 'x' | 'coinbase' | 'instagram' | 'tiktok'
 * @returns {Promise<{identityHash: string, verified: boolean, provider: string}>}
 */
export async function verifySocialAccount(address, siweMessage, signature, provider = 'x') {
  // ── Demo mode: no Base Verify key configured → deterministic mock ──
  if (!process.env.BASE_VERIFY_API_KEY) {
    const identityHash = '0x' + Buffer.from(`agentdesk:${address.toLowerCase()}:${provider}`)
      .toString('hex')
      .padEnd(64, '0')
      .slice(0, 64);
    return {
      identityHash,
      verified: true,
      provider,
      demo: true,
    };
  }

  // ── Production path ──
  const res = await fetch(`${BASE_VERIFY_API}/verify-social-accounts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.BASE_VERIFY_API_KEY}`,
    },
    body: JSON.stringify({
      address,
      message: siweMessage,
      signature,
      provider,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Base Verify failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return {
    identityHash: data.identityHash,
    verified: true,
    provider,
    traits: data.traits || {},
    demo: false,
  };
}

/**
 * Generate a SIWE-ready noncemessage for the client to sign.
 */
export function createSiweMessage(address, nonce, chainId = 8453) {
  const domain = process.env.APP_DOMAIN || 'agentdesk.xyz';
  const issuedAt = new Date().toISOString();
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    `Sign in to AgentDesk (Base chain ${chainId}).`,
    '',
    `URI: https://${domain}`,
    `Version: 1`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}
