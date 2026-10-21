/**
 * Base Verify adapter — follows docs.base.org/sdks/base-verify.
 *
 * Two documented integrations:
 *
 *  1) Verify Social Accounts  (backend-enforced, needs a secret key)
 *     POST {BASE_VERIFY_API_URL}/base_verify_token   { message, signature }
 *       → 200 { token, action, wallet }              (token = deterministic Sybil key)
 *       → 404 verification_not_found                 (user must verify at verify.base.dev)
 *       → 400 verification_traits_not_satisfied      (verified, but below our bar)
 *       → 401 unauthorized                           (our key is wrong)
 *     provider / traits / action are carried in the SIWE message `Resources`
 *     (`urn:verify:provider:x`, `urn:verify:provider:x:verified:eq:true`,
 *      `urn:verify:action:create_agent`). The backend MUST re-validate them.
 *
 *  2) Verify Users Onchain  (contract-enforced, no secret key)
 *     POST {BASE_VERIFY_API_URL}/onchain_verifications { message, signature }
 *       → 200 { identityHash, expiration, signature } → pass to the consumer contract
 *     The SIWE message must use the exact statement below and name the consumer
 *     contract in `Resources` as `eip155:<chainId>:<contract>`.
 *
 * Docs: https://docs.base.org/sdks/base-verify/verify-social-accounts
 *       https://docs.base.org/sdks/base-verify/verify-users-onchain
 */
import crypto from 'node:crypto';
import { verifyMessage, getAddress } from 'viem';
import { cfg } from '../config.js';

const BASE_VERIFY_API_URL = (process.env.BASE_VERIFY_API_URL || 'https://verify.base.dev/v1').replace(/\/+$/, '');
const BASE_VERIFY_APP_URL = (process.env.BASE_VERIFY_APP_URL || 'https://verify.base.dev').replace(/\/+$/, '');
const ONCHAIN_STATEMENT = 'Claim eligibility for a Base Verify onchain benefit.';
const VERIFY_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;

/** Secret key: `BASE_VERIFY_SECRET_KEY` (documented name); legacy alias kept. */
const secretKey = () => process.env.BASE_VERIFY_SECRET_KEY || process.env.BASE_VERIFY_API_KEY || '';
export const verifyConfigured = () => Boolean(secretKey());
export const onchainVerifyConfigured = () => /^0x[a-fA-F0-9]{40}$/.test(String(process.env.AGENT_REGISTRY_ADDRESS || ''));

/**
 * Our eligibility policy per provider. Trait keys/operators come from the docs'
 * trait catalog. The action is part of the Sybil token: never rename it after launch.
 */
export const VERIFY_POLICY = {
  x: { traits: { verified: 'eq:true' }, action: 'create_agent' },
  coinbase: { traits: { coinbase_one_active: 'eq:true' }, action: 'create_agent' },
  instagram: { traits: { followers_count: 'gte:100' }, action: 'create_agent' },
  tiktok: { traits: { follower_count: 'gte:100' }, action: 'create_agent' },
};

const providerUrn = (provider) => `urn:verify:provider:${provider}`;
const traitUrn = (provider, name, spec) => {
  const [op, value] = String(spec).split(/:(.+)/);
  return `urn:verify:provider:${provider}:${name}:${op}:${value}`;
};
const actionUrn = (action) => `urn:verify:action:${action}`;

// ── in-memory verify challenges (nonce + exact message we asked the user to sign) ──
const challenges = new Map();

function prune() {
  for (const [k, v] of challenges) if (v.expiresAt < Date.now()) challenges.delete(k);
}

/**
 * Build the SIWE message the frontend must sign, with the provider/traits/action
 * resources Base Verify reads. Server-side so the client cannot weaken traits.
 */
export function buildVerifyMessage(address, provider = 'x', nonce) {
  // Base Verify rejects SIWE messages whose address is not EIP-55 checksummed
  const addr = getAddress(String(address));
  const key = addr.toLowerCase();
  const p = String(provider).toLowerCase();
  const policy = VERIFY_POLICY[p];
  if (!policy) throw new Error(`unsupported_provider:${provider}`);

  const n = nonce || crypto.randomBytes(16).toString('hex');
  const issuedAt = new Date().toISOString();
  const expiresAt = Date.now() + VERIFY_TTL_MS;

  const resources = [
    providerUrn(p),
    ...Object.entries(policy.traits).map(([name, spec]) => traitUrn(p, name, spec)),
    actionUrn(policy.action),
  ];

  const message = [
    `${cfg.appDomain} wants you to sign in with your Ethereum account:`,
    addr,
    '',
    'Verify your account to unlock the verified-agent tier.',
    '',
    `URI: https://${cfg.appDomain}`,
    'Version: 1',
    `Chain ID: ${cfg.chainId}`,
    `Nonce: ${n}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${new Date(expiresAt).toISOString()}`,
    'Resources:',
    ...resources.map((r) => `- ${r}`),
  ].join('\n');

  challenges.set(`${key}:${n}`, { provider: p, message, expiresAt, resources });
  prune();
  return { message, nonce: n, provider: p, action: policy.action, traits: policy.traits, expiresAt };
}

/** Resources lines out of a SIWE message, e.g. ['urn:verify:provider:x', ...]. */
export function parseResources(message) {
  const lines = String(message || '').split(/\r?\n/);
  const idx = lines.findIndex((l) => /^Resources:\s*$/.test(l));
  if (idx < 0) return [];
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s*(\S+)\s*$/);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

/**
 * MANDATORY backend check (docs "Validate Trait Requirements"): the message must
 * request exactly the traits our policy requires — no missing, no extra, no weaker.
 * @returns {{valid: boolean, error?: string}}
 */
export function validateVerifyTraits(message, provider, policy = VERIFY_POLICY) {
  const p = String(provider || '').toLowerCase();
  const expectedPolicy = policy[p];
  if (!expectedPolicy) return { valid: false, error: 'unsupported_provider' };

  const resources = parseResources(message);
  if (!resources.length) return { valid: false, error: 'missing_resources' };

  const providers = resources.filter((r) => r.startsWith('urn:verify:provider:'));
  const base = providerUrn(p);
  const requested = new Set(providers);
  const required = new Set([base, ...Object.entries(expectedPolicy.traits).map(([n, spec]) => traitUrn(p, n, spec))]);

  // every requested trait urn must be one we expect (blocks weaker/extra traits)
  for (const r of requested) {
    if (!r.startsWith(base)) return { valid: false, error: 'provider_mismatch' };
    if (!required.has(r)) return { valid: false, error: `unexpected_trait:${r}` };
  }
  for (const r of required) {
    if (!requested.has(r)) return { valid: false, error: `missing_trait:${r}` };
  }

  const actions = resources.filter((r) => r.startsWith('urn:verify:action:'));
  if (actions.length !== 1) return { valid: false, error: 'invalid_action_count' };
  if (actions[0] !== actionUrn(expectedPolicy.action)) return { valid: false, error: 'action_mismatch' };

  // statement / chain binding
  if (!/^Chain ID: \d+$/m.test(message)) return { valid: false, error: 'missing_chain_id' };
  if (!new RegExp(`^Chain ID: ${cfg.chainId}$`, 'm').test(message)) return { valid: false, error: 'chain_id_mismatch' };

  return { valid: true };
}

/** Where to send a user who has never verified a provider (docs: redirect, do not retry). */
export function verificationRedirectUrl(provider = 'x') {
  const params = new URLSearchParams({ redirect_uri: `https://${cfg.appDomain}`, providers: provider });
  return `${BASE_VERIFY_APP_URL}?${params.toString()}`;
}

async function postJson(path, body, { authed = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authed) headers.Authorization = `Bearer ${secretKey()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_VERIFY_API_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* empty / non-JSON body */
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check a social-account verification (integration 1).
 * @returns {{status: number, body: object}}
 */
export async function checkSocialVerification({ address, message, signature, provider }) {
  const addr = String(address || '').toLowerCase();
  const p = String(provider || '').toLowerCase();

  const traitCheck = validateVerifyTraits(message, p);
  if (!traitCheck.valid) return { status: 400, body: { error: 'invalid_trait_requirements', detail: traitCheck.error } };

  if (!String(message).toLowerCase().includes(addr)) {
    return { status: 400, body: { error: 'address_mismatch' } };
  }

  // nonce we issued for this address must be the one signed (single use)
  const nonceMatch = String(message).match(/Nonce: ([a-fA-F0-9]{8,})/);
  if (!nonceMatch) return { status: 400, body: { error: 'missing_nonce' } };
  const key = `${addr}:${nonceMatch[1]}`;
  const challenge = challenges.get(key);
  if (!challenge) return { status: 400, body: { error: 'unknown_or_expired_challenge' } };
  if (challenge.provider !== p) return { status: 400, body: { error: 'provider_mismatch' } };
  challenges.delete(key);

  // local signature check is a fast-fail for EOA wallets; smart-wallet
  // (ERC-1271/6492) signatures are still validated by Base Verify itself.
  try {
    const ok = await verifyMessage({
      address: `0x${addr.replace(/^0x/, '')}`,
      message,
      signature: `0x${String(signature).replace(/^0x/, '')}`,
    });
    if (!ok) return { status: 401, body: { error: 'invalid_signature' } };
  } catch {
    /* fall through to Base Verify */
  }

  // ── demo mode (local/dev only, no key) → deterministic token, clearly flagged ──
  if (!verifyConfigured()) {
    if (cfg.isProd) return { status: 501, body: { error: 'verify_not_configured' } };
    const token = '0x' + crypto.createHash('sha256').update(`agentdesk:demo:${p}:${addr}`).digest('hex');
    return {
      status: 200,
      body: { verified: true, token, identityHash: token, action: VERIFY_POLICY[p].action, wallet: addr, provider: p, demo: true },
    };
  }

  let upstream;
  try {
    upstream = await postJson('/base_verify_token', { message, signature }, { authed: true });
  } catch (e) {
    console.error('[base-verify] request failed:', e?.message);
    return { status: 502, body: { error: 'verify_upstream_unreachable' } };
  }

  if (upstream.status === 200 && upstream.data?.token) {
    return {
      status: 200,
      body: {
        verified: true,
        token: upstream.data.token,
        identityHash: upstream.data.token,
        action: upstream.data.action || VERIFY_POLICY[p].action,
        wallet: upstream.data.wallet || addr,
        provider: p,
        demo: false,
      },
    };
  }

  if (upstream.status === 404) {
    // never retry a 404 — the user simply has not verified this provider yet
    return { status: 404, body: { verified: false, needsVerification: true, redirectUrl: verificationRedirectUrl(p) } };
  }

  if (upstream.status === 400) {
    const reason = upstream.data?.message || upstream.data?.error || 'verification_traits_not_satisfied';
    return { status: 400, body: { verified: false, traitsNotMet: reason === 'verification_traits_not_satisfied', reason } };
  }

  if (upstream.status === 401) {
    console.error('[base-verify] upstream rejected our secret key (401)');
    return { status: 503, body: { error: 'verify_upstream_auth_failed' } };
  }

  console.error('[base-verify] unexpected upstream status', upstream.status);
  return { status: 502, body: { error: 'verify_upstream_error' } };
}

/** Build the SIWE message for the onchain flow (exact statement + contract resource). */
export function buildOnchainVerifyMessage(address, contractAddress = process.env.AGENT_REGISTRY_ADDRESS, nonce) {
  const addr = getAddress(String(address));
  const contract = String(contractAddress || '');
  const n = nonce || crypto.randomBytes(16).toString('hex');
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + VERIFY_TTL_MS).toISOString();
  const message = [
    `${cfg.appDomain} wants you to sign in with your Ethereum account:`,
    addr,
    '',
    ONCHAIN_STATEMENT,
    '',
    `URI: https://${cfg.appDomain}`,
    'Version: 1',
    `Chain ID: ${cfg.chainId}`,
    `Nonce: ${n}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expiresAt}`,
    'Resources:',
    `- eip155:${cfg.chainId}:${contract}`,
  ].join('\n');
  return { message, nonce: n, contract, resource: `eip155:${cfg.chainId}:${contract}`, expiresAt };
}

/** Server-side check of the onchain-flow message (docs: exact statement + contract resource). */
export function validateOnchainMessage(message, contractAddress = process.env.AGENT_REGISTRY_ADDRESS) {
  if (!String(message).includes(ONCHAIN_STATEMENT)) return { valid: false, error: 'wrong_statement' };
  const resource = `eip155:${cfg.chainId}:${String(contractAddress || '').toLowerCase()}`;
  const resources = parseResources(message).map((r) => r.toLowerCase());
  if (!resources.includes(resource)) return { valid: false, error: 'missing_contract_resource' };
  if (!new RegExp(`^Chain ID: ${cfg.chainId}$`, 'm').test(message)) return { valid: false, error: 'chain_id_mismatch' };
  // Base Verify requires an expiration on the onchain flow; reject stale ones ourselves too
  const exp = String(message).match(/^Expiration Time: (.+)$/m);
  if (!exp) return { valid: false, error: 'missing_expiration' };
  const expMs = Date.parse(exp[1].trim());
  if (Number.isNaN(expMs)) return { valid: false, error: 'invalid_expiration' };
  if (expMs < Date.now() - 30_000) return { valid: false, error: 'expired_message' };
  if (expMs > Date.now() + VERIFY_TTL_MS + 30_000) return { valid: false, error: 'expiration_too_far' };
  return { valid: true };
}

/**
 * Fetch a short-lived onchain verification (integration 2, no API key).
 * @returns {{status: number, body: object}}
 */
export async function fetchOnchainVerification({ address, message, signature }) {
  if (!onchainVerifyConfigured()) return { status: 501, body: { error: 'onchain_verify_not_configured' } };

  const check = validateOnchainMessage(message);
  if (!check.valid) return { status: 400, body: { error: check.error } };
  if (!String(message).toLowerCase().includes(String(address).toLowerCase())) {
    return { status: 400, body: { error: 'address_mismatch' } };
  }

  let upstream;
  try {
    upstream = await postJson('/onchain_verifications', { message, signature });
  } catch (e) {
    console.error('[base-verify] onchain request failed:', e?.message);
    return { status: 502, body: { error: 'verify_upstream_unreachable' } };
  }

  if (upstream.status === 200 && upstream.data?.identityHash && upstream.data?.signature) {
    return {
      status: 200,
      body: {
        identityHash: upstream.data.identityHash,
        expiration: upstream.data.expiration,
        signature: upstream.data.signature,
      },
    };
  }

  const code = upstream.data?.error || upstream.data?.message;
  if (upstream.status === 404) {
    return {
      status: 404,
      body: {
        error: code || 'verification_not_found',
        needsVerification: code !== 'contract_not_found',
        redirectUrl: code === 'contract_not_found' ? null : verificationRedirectUrl('coinbase'),
      },
    };
  }
  if (upstream.status === 400) {
    return { status: 400, body: { error: code || 'conditions_not_satisfied', conditionsNotSatisfied: code === 'conditions_not_satisfied' } };
  }
  if (upstream.status === 401) {
    console.error('[base-verify] onchain verification rejected (401)');
    return { status: 503, body: { error: 'verify_upstream_auth_failed' } };
  }
  return { status: 502, body: { error: 'verify_upstream_error' } };
}

/** Provider/traits/action we ask for, for the UI to display. */
export function verifyPolicySummary(provider = 'x') {
  const p = String(provider).toLowerCase();
  const policy = VERIFY_POLICY[p];
  if (!policy) return null;
  return { provider: p, action: policy.action, traits: policy.traits, configured: verifyConfigured(), isProd: cfg.isProd };
}
