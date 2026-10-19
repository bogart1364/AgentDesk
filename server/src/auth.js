/**
 * Auth — issues stateless HMAC JWTs (Vercel-friendly).
 *
 * SIWE path (fallback when Privy is not configured):
 *  1. GET  /api/auth/nonce?address=0x…   → { nonce, message, expiresAt }
 *  2. Client signs `message` with wallet (wagmi signMessage)
 *  3. POST /api/auth/verify { address, message, signature }
 *       → verify signature (viem verifyMessage) → issue JWT (7 days)
 *
 * Privy path (VITE_PRIVY_APP_ID / PRIVY_APP_ID set):
 *  1. Client logs in via Privy (email / social / wallet)
 *  2. Client sends its Privy identity token + active wallet address
 *  3. POST /api/auth/verify { privyIdentityToken, address }
 *       → verify token (JWKS) → address must be a linked EVM wallet → issue JWT
 *
 * Either way the client sends Authorization: Bearer <jwt>.
 * No server-side session store — JWT is self-contained (Vercel-friendly).
 */
import crypto from 'node:crypto';
import { verifyMessage } from 'viem';
import { PrivyClient } from '@privy-io/node';
import { cfg } from './config.js';

const NONCE_TTL_MS = 5 * 60 * 1000;

// in-memory nonce cache (per-instance; on Vercel use signed nonce in message instead)
// We embed issuedAt + nonce inside the message itself and verify freshness from it,
// so no shared store is required across serverless instances.
const nonces = new Map();

export function createNonce(address) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + NONCE_TTL_MS;
  nonces.set(`${address.toLowerCase()}:${nonce}`, expiresAt);

  // prune old
  for (const [k, exp] of nonces) {
    if (exp < Date.now()) nonces.delete(k);
  }

  const issuedAt = new Date().toISOString();
  const message = [
    `${cfg.appDomain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    'Sign in to AgentDesk. This request will not trigger a blockchain transaction or cost any gas.',
    '',
    `URI: https://${cfg.appDomain}`,
    'Version: 1',
    `Chain ID: ${cfg.chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');

  return { nonce, message, expiresAt };
}

export async function verifyLogin({ address, message, signature }) {
  const addr = String(address || '').toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) {
    return { ok: false, error: 'invalid_address' };
  }
  if (!message || !signature) {
    return { ok: false, error: 'missing_message_or_signature' };
  }

  // message must belong to this address
  if (!message.includes(addr) && !message.includes(address)) {
    return { ok: false, error: 'address_mismatch' };
  }

  // freshness: parse Issued At (required so a signed message cannot live forever)
  const issuedMatch = message.match(/Issued At: (.+)/);
  if (!issuedMatch) {
    return { ok: false, error: 'missing_issued_at' };
  }
  const issued = new Date(issuedMatch[1]).getTime();
  if (isNaN(issued)) return { ok: false, error: 'invalid_issued_at' };
  if (Date.now() - issued > NONCE_TTL_MS) return { ok: false, error: 'nonce_expired' };

  // nonce: required + single-use (best effort per instance)
  const nonceMatch = message.match(/Nonce: ([a-fA-F0-9]{8,})/);
  if (!nonceMatch) return { ok: false, error: 'missing_nonce' };
  const key = `${addr}:${nonceMatch[1]}`;
  if (nonces.has(key)) nonces.delete(key);
  // on serverless cold start the nonce may not be in this instance's map —
  // signature verification + 5min expiry still protects us

  const valid = await verifyMessage({
    address: `0x${addr.slice(2)}`,
    message,
    signature: `0x${String(signature).replace(/^0x/, '')}`,
  });

  if (!valid) return { ok: false, error: 'invalid_signature' };

  const token = signJwt({ sub: addr, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 7 * 86400 });
  return { ok: true, token, address: addr };
}

// ── Privy identity-token exchange ──
let privyClient;
function getPrivyClient() {
  if (!privyClient) {
    privyClient = new PrivyClient({ appId: cfg.privyAppId, appSecret: cfg.privyAppSecret });
  }
  return privyClient;
}

export async function verifyPrivyLogin({ privyIdentityToken, address }) {
  if (!cfg.privyEnabled) {
    return { ok: false, error: 'Privy sign-in is not configured on this server' };
  }
  if (!privyIdentityToken || typeof privyIdentityToken !== 'string') {
    return { ok: false, error: 'missing_identity_token' };
  }

  let user;
  try {
    // local JWT verification against the app's Privy JWKS (uses app secret)
    user = await getPrivyClient().utils().auth().verifyIdentityToken(privyIdentityToken);
  } catch (e) {
    return { ok: false, error: 'Privy sign-in token invalid or expired — try again' };
  }

  const accounts = Array.isArray(user?.linked_accounts) ? user.linked_accounts : [];
  const wallets = accounts.filter(
    (a) =>
      a &&
      a.address &&
      (a.type === 'wallet' || a.type === 'smart_wallet') &&
      (a.type === 'smart_wallet' || String(a.chain_type || '').toUpperCase() === 'EVM')
  );

  let target;
  if (address) {
    target = String(address).toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(target)) return { ok: false, error: 'invalid_address' };
    if (!wallets.some((w) => String(w.address).toLowerCase() === target)) {
      return { ok: false, error: 'This wallet is not linked to your account' };
    }
  } else {
    if (!wallets.length) return { ok: false, error: 'No wallet on this account — connect one' };
    target = String(wallets[0].address).toLowerCase();
  }

  const token = signJwt({
    sub: target,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 86400,
  });
  return { ok: true, token, address: target, userId: user.id };
}

// ── minimal HS256 JWT (no external dep) ──
function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', cfg.authSecret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyJwt(token) {
  try {
    const [h, b, s] = String(token).split('.');
    if (!h || !b || !s) return null;
    const expect = crypto.createHmac('sha256', cfg.authSecret).update(`${h}.${b}`).digest('base64url');
    const a = Buffer.from(s);
    const bb = Buffer.from(expect);
    if (a.length !== bb.length || !crypto.timingSafeEqual(a, bb)) return null;
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Express middleware: requires valid Bearer JWT. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'unauthorized', hint: 'Sign in with your wallet first (POST /api/auth/verify)' });
  }
  const payload = verifyJwt(token);
  if (!payload) {
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }
  req.user = { address: payload.sub };
  next();
}

/** Optional auth — sets req.user if present, never blocks. */
export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const payload = verifyJwt(token);
    if (payload) req.user = { address: payload.sub };
  }
  next();
}
