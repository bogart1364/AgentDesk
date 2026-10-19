import React, { useEffect, useRef } from 'react';
import { useConnect, useSwitchChain } from 'wagmi';
import { IconWallet, IconShield, IconArrowRight, IconLogoMark } from './Icons.jsx';
import { Spinner } from './ui.jsx';
import { CHAIN_NAME, CHAIN_ID, PRIVY_ENABLED } from '../wagmi.js';

/**
 * Sign-in panel.
 * Privy mode: one button opens the Privy modal (email / social / wallet incl. Coinbase).
 * SIWE fallback: 1. connect  2. sign message  3. enter console
 */
export default function ConnectPanel({ auth, onStart, bare }) {
  if (PRIVY_ENABLED) return <PrivyPanel auth={auth} onStart={onStart} bare={bare} />;

  const { isConnected, authed, status, error, login, logout, address, chain } = auth;
  const { connect, connectors, isPending: connecting, error: connectError } = useConnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const wantLogin = useRef(false);
  const pendingConnector = useRef(null);

  const wrongChain = isConnected && chain && chain.id !== CHAIN_ID;

  // auto sign-in after connect if user started from "connect & sign in"
  useEffect(() => {
    if (wantLogin.current && isConnected && !wrongChain && !authed && status !== 'signing') {
      wantLogin.current = false;
      login().catch(() => {});
    }
  }, [isConnected, wrongChain, authed, status, login]);

  const coinbase = connectors.find((c) => c.id === 'coinbaseWalletSDK');
  const injected =
    connectors.find((c) => c.id === 'injected') ||
    connectors.find((c) => c.id !== 'coinbaseWalletSDK');

  const handleConnect = (connector) => {
    if (!connector || connecting) return;
    wantLogin.current = true;
    pendingConnector.current = connector.id;
    connect({ connector });
  };

  const busyId = connecting ? pendingConnector.current : null;
  const allErrors = [error, connectError?.message].filter(Boolean).join(' — ');

  return (
    <div className={bare ? 'w-full' : 'panel p-6 max-w-md w-full'}>
      <div className="section-tag mb-4">Wallet Access</div>

      {!isConnected ? (
        <div className="space-y-4">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ad-muted)' }}>
            Connect your wallet on <span className="text-white font-medium">{CHAIN_NAME}</span> to
            sign in. Passwordless — your wallet signature is the login.
          </p>

          {/* Primary: Coinbase Wallet */}
          {coinbase && (
            <button
              onClick={() => handleConnect(coinbase)}
              disabled={connecting}
              className="btn-primary w-full justify-center"
            >
              <IconLogoMark size={16} />
              {busyId === 'coinbaseWalletSDK' ? <Spinner size={14} /> : null}
              Continue with Coinbase Wallet
            </button>
          )}

          {/* Fallback: injected browser wallet */}
          {injected && (
            <button
              onClick={() => handleConnect(injected)}
              disabled={connecting}
              className="btn-ghost w-full justify-center"
            >
              <IconWallet size={15} />
              {busyId === 'injected' ? <Spinner size={14} /> : null}
              Browser Wallet
            </button>
          )}

          <p className="font-mono text-[9px] tracking-wider text-center" style={{ color: 'var(--ad-line2)' }}>
            COINBASE · METAMASK · RABBY · RAINBOW
          </p>
        </div>
      ) : wrongChain ? (
        <div className="space-y-3">
          <div className="text-xs" style={{ color: '#fbbf24' }}>
            Wrong network — switch to {CHAIN_NAME} (chain {CHAIN_ID}).
          </div>
          <button onClick={() => switchChain({ chainId: CHAIN_ID })} disabled={switching} className="btn-primary w-full text-xs">
            {switching ? <Spinner size={14} /> : `Switch to ${CHAIN_NAME}`}
          </button>
          <button onClick={logout} className="btn-ghost w-full text-xs">Disconnect</button>
        </div>
      ) : !authed ? (
        <div className="space-y-4">
          <div className="font-mono text-xs text-white break-all">{address}</div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ad-muted)' }}>
            Sign a message to verify ownership. No transaction, no gas.
          </p>
          <button onClick={() => login().catch(() => {})} className="btn-primary w-full" disabled={status === 'signing'}>
            {status === 'signing' ? <><Spinner size={14} /> Waiting for signature…</> : <><IconShield size={15} /> Sign In</>}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="dot dot-live" />
            <div className="flex-1 min-w-0">
              <div className="font-mono text-xs text-white truncate">{auth.authAddress}</div>
              <div className="font-mono text-[9px] mt-0.5" style={{ color: '#34d399' }}>
                AUTHENTICATED · SIWE
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={onStart} className="btn-primary flex-1 text-xs">
              Enter Console <IconArrowRight size={14} />
            </button>
            <button onClick={logout} className="btn-ghost text-xs">Sign Out</button>
          </div>
        </div>
      )}

      {allErrors && (
        <div className="mt-4 text-[11px] leading-relaxed" style={{ color: '#f87171' }}>
          {allErrors}
        </div>
      )}
    </div>
  );
}

function PrivyPanel({ auth, onStart, bare }) {
  const { authed, status, error, login, logout, authAddress, address, chain, needsWallet, connectWallet } = auth;
  const { switchChain, isPending: switching } = useSwitchChain();

  const wrongChain = !!address && !!chain && chain.id !== CHAIN_ID;
  const signing = status === 'signing';

  return (
    <div className={bare ? 'w-full' : 'panel p-6 max-w-md w-full'}>
      <div className="section-tag mb-4">Wallet Access</div>

      {wrongChain ? (
        <div className="space-y-3">
          <div className="text-xs" style={{ color: '#fbbf24' }}>
            Wrong network — switch to {CHAIN_NAME} (chain {CHAIN_ID}).
          </div>
          <button onClick={() => switchChain({ chainId: CHAIN_ID })} disabled={switching} className="btn-primary w-full text-xs">
            {switching ? <Spinner size={14} /> : `Switch to ${CHAIN_NAME}`}
          </button>
          <button onClick={logout} className="btn-ghost w-full text-xs">Sign Out</button>
        </div>
      ) : authed ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="dot dot-live" />
            <div className="flex-1 min-w-0">
              <div className="font-mono text-xs text-white truncate">{authAddress}</div>
              <div className="font-mono text-[9px] mt-0.5" style={{ color: '#34d399' }}>
                AUTHENTICATED · PRIVY
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={onStart} className="btn-primary flex-1 text-xs">
              Enter Console <IconArrowRight size={14} />
            </button>
            <button onClick={logout} className="btn-ghost text-xs">Sign Out</button>
          </div>
        </div>
      ) : needsWallet ? (
        <div className="space-y-4">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ad-muted)' }}>
            This account needs a wallet to continue. Connect one — Coinbase Wallet, MetaMask, or a
            new in-app wallet.
          </p>
          <button onClick={() => connectWallet && connectWallet()} className="btn-primary w-full justify-center" disabled={signing}>
            <IconWallet size={15} /> Connect a Wallet
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ad-muted)' }}>
            Sign in on <span className="text-white font-medium">{CHAIN_NAME}</span> with email,
            social, or wallet — including <span className="text-white font-medium">Coinbase Wallet</span>.
            Passwordless, no gas.
          </p>
          <button onClick={login} disabled={signing} className="btn-primary w-full justify-center">
            <IconLogoMark size={16} />
            {signing ? <Spinner size={14} /> : null}
            {signing ? 'Securing session…' : 'Sign In'}
          </button>
          <p className="font-mono text-[9px] tracking-wider text-center" style={{ color: 'var(--ad-line2)' }}>
            COINBASE · METAMASK · EMAIL · SOCIAL
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 text-[11px] leading-relaxed" style={{ color: '#f87171' }}>
          {error}
        </div>
      )}
    </div>
  );
}
