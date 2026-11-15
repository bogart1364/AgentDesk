/**
 * Auth hooks — produces our own HMAC JWT so authFetch / requireAuth stay unchanged.
 *
 * Privy mode (VITE_PRIVY_APP_ID set): Privy modal login (email / social / wallet)
 * → identity token exchange → server verifies + issues JWT.
 * SIWE fallback (no Privy app id): wallet connect → sign message → JWT.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount, useSignMessage, useDisconnect } from 'wagmi';
import { usePrivy, getIdentityToken } from '@privy-io/react-auth';
import { PRIVY_ENABLED } from './wagmi.js';

const TOKEN_KEY = 'agentdesk_token';
const ADDR_KEY = 'agentdesk_address';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

/** Rejects with a readable message instead of hanging forever (mobile popups). */
function withTimeout(promise, ms, message) {
  let id;
  const timer = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(id));
}

const API_TIMEOUT_MSG =
  'Could not reach the AgentDesk API — check your connection and try again.';
const SIGN_TIMEOUT_MSG =
  'The wallet did not respond. A wallet window may have been blocked: allow popups for this site (iPhone: Settings → Safari → Block Pop-ups → off), then tap Sign In again.';

/**
 * SIWE message cache.
 *
 * Mobile browsers only allow window.open() inside the transient user-gesture
 * window, and that window is gone after an await. Coinbase Wallet signs in a
 * keys.coinbase.com popup, so the popup must be opened synchronously from the
 * Sign In tap — never after awaiting a nonce fetch. We therefore warm the
 * message right after connect and sign from cache on tap.
 */
const nonceCache = new Map(); // lowercase address -> { message, at }
const NONCE_FRESH_MS = 4 * 60 * 1000; // server keeps messages valid for 5 min
const NONCE_STORE_KEY = 'agentdesk_nonce';

// Survive a wallet-driven redirect/reload (the message must still be warm when
// the page comes back, otherwise the popup would again open after an await).
try {
  const raw = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(NONCE_STORE_KEY);
  if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) if (v?.message) nonceCache.set(k, v);
} catch {
  /* storage unavailable — cache simply stays in memory */
}

function saveNonceStore() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(NONCE_STORE_KEY, JSON.stringify(Object.fromEntries(nonceCache)));
    }
  } catch {
    /* ignore quota / private mode */
  }
}

function cachedMessage(address) {
  const key = String(address || '').toLowerCase();
  const hit = nonceCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > NONCE_FRESH_MS) {
    nonceCache.delete(key);
    saveNonceStore();
    return null;
  }
  return hit.message;
}

async function fetchNonceMessage(address) {
  const r = await withTimeout(
    fetch(`${API_BASE}/auth/nonce?address=${address}`),
    20000,
    API_TIMEOUT_MSG
  );
  if (!r.ok) throw new Error('Failed to get sign-in message');
  const { message } = await r.json();
  nonceCache.set(String(address).toLowerCase(), { message, at: Date.now() });
  saveNonceStore();
  return message;
}

/** Warm the sign-in message ahead of the tap (no-op when already fresh). */
export function prefetchNonce(address) {
  if (!address || cachedMessage(address)) return Promise.resolve();
  return fetchNonceMessage(address).catch(() => {});
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** fetch wrapper that attaches Bearer JWT */
export async function authFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/verify') {
    // token expired → clear
    setToken(null);
    localStorage.removeItem(ADDR_KEY);
  }
  if (!res.ok) {
    const err = new Error(data.error || data.hint || data.detail || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function useSiweAuth() {
  const { address, isConnected, chain } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();

  const [token, setTokenState] = useState(getToken());
  const [authAddress, setAuthAddress] = useState(localStorage.getItem(ADDR_KEY));
  const [status, setStatus] = useState('idle'); // idle | signing | authed | error
  const [error, setError] = useState(null);

  const authed = !!token && !!authAddress && authAddress.toLowerCase() === (address || '').toLowerCase();

  // clear token if wallet address changes
  useEffect(() => {
    if (address && authAddress && address.toLowerCase() !== authAddress.toLowerCase()) {
      setToken(null);
      localStorage.removeItem(ADDR_KEY);
      setTokenState(null);
      setAuthAddress(null);
      setStatus('idle');
    }
  }, [address, authAddress]);

  const login = useCallback(async () => {
    if (!address) throw new Error('Connect wallet first');
    setStatus('signing');
    setError(null);
    try {
      // 1. sign-in message — from cache when warm so step 2 can run inside the
      //    tap gesture (a nonce fetch here would let the wallet popup get blocked)
      const message = cachedMessage(address) || (await fetchNonceMessage(address));

      // 2. wallet signature (Coinbase Wallet opens a popup — must not hang)
      const signature = await withTimeout(signMessageAsync({ message }), 60000, SIGN_TIMEOUT_MSG);

      // 3. verify → JWT
      const v = await withTimeout(
        fetch(`${API_BASE}/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, message, signature }),
        }),
        20000,
        API_TIMEOUT_MSG
      );
      const data = await v.json().catch(() => ({}));
      if (!v.ok) throw new Error(data.error || 'Verification failed');

      setToken(data.token);
      localStorage.setItem(ADDR_KEY, data.address);
      setTokenState(data.token);
      setAuthAddress(data.address);
      setStatus('authed');
      nonceCache.delete(String(address).toLowerCase()); // message is single-use
      saveNonceStore();
      return data;
    } catch (e) {
      setStatus('error');
      setError(e.message);
      throw e;
    }
  }, [address, signMessageAsync]);

  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem(ADDR_KEY);
    setTokenState(null);
    setAuthAddress(null);
    setStatus('idle');
    disconnect();
  }, [disconnect]);

  return {
    address,
    isConnected,
    chain,
    authed,
    status,
    error,
    token,
    authAddress,
    login,
    logout,
    mode: 'siwe',
  };
}

function usePrivyAuth() {
  const { ready, authenticated, login: privyLogin, logout: privyLogout, connectWallet } = usePrivy();
  const { address, isConnected, chain } = useAccount();

  const [token, setTokenState] = useState(getToken());
  const [authAddress, setAuthAddress] = useState(localStorage.getItem(ADDR_KEY));
  const [status, setStatus] = useState('idle'); // idle | signing | authed | error
  const [error, setError] = useState(null);
  const inFlight = useRef(false);

  const authed =
    ready &&
    authenticated &&
    !!token &&
    !!authAddress &&
    authAddress.toLowerCase() === (address || '').toLowerCase();

  // Privy session restored but no wallet on the account (or wallet not yet created)
  const needsWallet = ready && authenticated && !address;

  // clear token if active wallet changed → exchange effect below re-runs
  useEffect(() => {
    if (address && authAddress && address.toLowerCase() !== authAddress.toLowerCase()) {
      setToken(null);
      localStorage.removeItem(ADDR_KEY);
      setTokenState(null);
      setAuthAddress(null);
      setStatus('idle');
    }
  }, [address, authAddress]);

  // Privy identity token → our JWT (server checks the wallet belongs to that user)
  useEffect(() => {
    if (!ready || !authenticated) return;
    if (token && authAddress) return; // already exchanged
    if (!address || inFlight.current) return; // wait for active wallet
    inFlight.current = true;
    setStatus('signing');
    setError(null);
    (async () => {
      try {
        const identityToken = await getIdentityToken();
        if (!identityToken) throw new Error('Session token unavailable — try again');
        const v = await fetch(`${API_BASE}/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ privyIdentityToken: identityToken, address }),
        });
        const data = await v.json();
        if (!v.ok) throw new Error(data.error || 'Verification failed');
        setToken(data.token);
        localStorage.setItem(ADDR_KEY, data.address);
        setTokenState(data.token);
        setAuthAddress(data.address);
        setStatus('authed');
      } catch (e) {
        setStatus('error');
        setError(e.message);
      } finally {
        inFlight.current = false;
      }
    })();
  }, [ready, authenticated, address, token, authAddress]);

  const login = useCallback(() => {
    setError(null);
    privyLogin();
  }, [privyLogin]);

  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem(ADDR_KEY);
    setTokenState(null);
    setAuthAddress(null);
    setStatus('idle');
    inFlight.current = false;
    privyLogout().catch(() => {});
  }, [privyLogout]);

  return {
    address,
    isConnected,
    chain,
    authed,
    status,
    error,
    token,
    authAddress,
    login,
    logout,
    connectWallet,
    needsWallet,
    mode: 'privy',
  };
}

// stable module-level branch — no conditional hook calls across renders
const useAuthImpl = PRIVY_ENABLED ? usePrivyAuth : useSiweAuth;

export function useAuth() {
  return useAuthImpl();
}
