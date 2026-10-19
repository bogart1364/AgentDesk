import React, { useState } from 'react';
import Footer from '../components/Footer.jsx';
import ConnectPanel from '../components/ConnectPanel.jsx';
import Modal from '../components/Modal.jsx';
import { PRIVY_ENABLED } from '../wagmi.js';
import {
  IconLogoMark, IconShield, IconBolt, IconFingerprint,
  IconArrowRight, IconExternal, IconLayers, IconTerminal, IconLink, IconWallet,
} from '../components/Icons.jsx';

const FEATURES = [
  {
    tag: '01',
    icon: IconShield,
    title: 'On-chain spend policies',
    body: 'Per-tx caps, daily & monthly budgets, merchant allowlists, and time windows — enforced by PolicyEngine.sol. The LLM cannot override.',
  },
  {
    tag: '02',
    icon: IconBolt,
    title: 'x402 native payments',
    body: 'Agents pay USDC for APIs via the HTTP 402 handshake. Every settled payment is a Base transaction with full audit trail.',
  },
  {
    tag: '03',
    icon: IconFingerprint,
    title: 'Base Verify identity',
    body: 'One verified human maps to a limited set of agents via identityHash. Sybil-resistant by construction.',
  },
];

const STACK = [
  { layer: 'L4', name: 'Dashboard', tech: 'React · Vite · Tailwind' },
  { layer: 'L3', name: 'API Server', tech: 'Node · Express · zod' },
  { layer: 'L2', name: 'x402 Middleware', tech: '402 handshake · USDC EIP-3009' },
  { layer: 'L1', name: 'PolicyEngine.sol', tech: 'Solidity 0.8.24 · Base 8453' },
  { layer: 'L0', name: 'Base Network', tech: 'USDC · Verify · Builder Codes' },
];

export default function Landing({ auth, onStart }) {
  const [loginOpen, setLoginOpen] = useState(false);

  // header button: if already signed in -> console; otherwise open connect/login modal
  const go = () => {
    if (auth?.authed) onStart();
    else setLoginOpen(true);
  };

  const closeAndStart = () => {
    setLoginOpen(false);
    onStart();
  };

  return (
    <div className="min-h-screen bp-grid relative overflow-hidden" style={{ background: 'var(--ad-ink)' }}>
      {/* ambient glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '-15%', left: '25%', width: 700, height: 700,
          background: 'radial-gradient(circle, rgba(11,19,250,0.16) 0%, transparent 65%)',
        }}
      />

      {/* nav */}
      <nav
        className="relative z-10 flex items-center justify-between px-10 py-5 border-b"
        style={{ borderColor: 'var(--ad-line)', background: 'rgba(7,8,13,0.7)', backdropFilter: 'blur(12px)' }}
      >
        <div className="flex items-center gap-3">
          <IconLogoMark size={32} />
          <div>
            <div className="font-bold text-white text-sm leading-tight">AgentDesk</div>
            <div className="font-mono text-[9px] tracking-[0.2em]" style={{ color: 'var(--ad-muted)' }}>
              ON BASE
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://docs.base.org"
            target="_blank"
            rel="noreferrer"
            className="btn-ghost hidden sm:inline-flex text-xs"
          >
            Docs <IconExternal size={12} />
          </a>
          <button onClick={go} className="btn-primary text-xs">
            {auth?.authed ? 'Open Console' : PRIVY_ENABLED ? (<>Sign In <IconShield size={13} /></>) : (<>Connect &amp; Login <IconWallet size={13} /></>)}
            {auth?.authed && <IconArrowRight size={14} />}
          </button>
        </div>
      </nav>

      {/* hero */}
      <div className="relative z-10 max-w-5xl mx-auto px-10 pt-24 pb-20">
        <div className="section-tag mb-6">Agent Commerce Control Plane</div>

        <h1 className="text-5xl md:text-6xl font-extrabold text-white leading-[1.08] tracking-tight max-w-3xl">
          Spend policies for
          <br />
          <span style={{ color: 'var(--ad-blue-l)' }}>autonomous agents</span>
        </h1>

        <p className="mt-8 text-base leading-relaxed max-w-xl" style={{ color: 'var(--ad-muted)' }}>
          Agents can already pay for APIs via <span className="text-white font-medium">x402</span>.
          What's missing is human control — budgets, caps, allowlists, kill-switches.
          AgentDesk makes agent spending <span className="text-white font-medium">on-chain, auditable, and revocable</span>.
        </p>

        <div className="mt-10 flex items-center gap-4">
          <button onClick={go} className="btn-primary text-sm px-8 py-3.5">
            {auth?.authed ? 'Launch Console' : PRIVY_ENABLED ? 'Sign In' : 'Connect & Login'} <IconArrowRight size={16} />
          </button>
          <a
            href="https://docs.base.org/build-on-base/accept-payments/charge-for-an-api"
            target="_blank"
            rel="noreferrer"
            className="btn-ghost text-sm px-8 py-3.5"
          >
            x402 Specification <IconExternal size={14} />
          </a>
        </div>

        {/* features */}
        <div className="mt-24 grid md:grid-cols-3 gap-4">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.tag} className="panel panel-hover p-6">
                <div className="flex items-center justify-between mb-5">
                  <div
                    className="w-10 h-10 flex items-center justify-center rounded"
                    style={{ background: 'rgba(11,19,250,0.1)', border: '1px solid rgba(11,19,250,0.25)', color: 'var(--ad-blue-l)' }}
                  >
                    <Icon size={18} />
                  </div>
                  <span className="font-mono text-[10px]" style={{ color: 'var(--ad-line2)' }}>
                    {f.tag}
                  </span>
                </div>
                <h3 className="font-semibold text-white text-sm">{f.title}</h3>
                <p className="mt-2.5 text-xs leading-relaxed" style={{ color: 'var(--ad-muted)' }}>
                  {f.body}
                </p>
              </div>
            );
          })}
        </div>

        {/* stack diagram */}
        <div className="mt-16 panel p-8">
          <div className="section-tag mb-6">System Architecture</div>
          <div className="space-y-0">
            {STACK.map((s, i) => (
              <div key={s.layer} className="flex items-stretch">
                {/* connector */}
                <div className="w-12 flex flex-col items-center">
                  <div
                    className="w-8 h-8 flex items-center justify-center font-mono text-[10px] font-bold rounded-sm"
                    style={{
                      background: i === 0 ? 'var(--ad-blue)' : 'rgba(11,19,250,0.1)',
                      border: '1px solid rgba(11,19,250,0.3)',
                      color: i === 0 ? '#fff' : 'var(--ad-blue-l)',
                    }}
                  >
                    {s.layer}
                  </div>
                  {i < STACK.length - 1 && (
                    <div className="w-px flex-1 my-1" style={{ background: 'rgba(11,19,250,0.2)' }} />
                  )}
                </div>
                {/* content */}
                <div
                  className="flex-1 flex items-center justify-between px-5 py-3.5 mb-1 rounded-sm"
                  style={{ background: 'var(--ad-panel2)', border: '1px solid var(--ad-line)' }}
                >
                  <div>
                    <div className="text-sm font-medium text-white">{s.name}</div>
                    <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--ad-muted)' }}>
                      {s.tech}
                    </div>
                  </div>
                  {i === 0 && (
                    <span className="badge" style={{ color: '#34d399', borderColor: 'rgba(52,211,153,0.25)', background: 'rgba(52,211,153,0.06)' }}>
                      <span className="dot" style={{ background: '#34d399' }} /> LIVE
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* grant strip */}
        <div className="mt-12 flex flex-wrap items-center justify-between gap-6 panel-plain px-8 py-6">
          <div className="flex items-center gap-4">
            <IconLayers size={20} style={{ color: 'var(--ad-blue-l)' }} />
            <div>
              <div className="text-sm font-semibold text-white">Built for Base Grant Program</div>
              <div className="font-mono text-[10px] tracking-wider mt-0.5" style={{ color: 'var(--ad-muted)' }}>
                CATEGORY: AGENTS — COMMERCE, X402
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6 font-mono text-[10px] tracking-wider" style={{ color: 'var(--ad-muted)' }}>
            <span className="flex items-center gap-1.5"><IconTerminal size={12} /> SOLIDITY 0.8.24</span>
            <span className="flex items-center gap-1.5"><IconLink size={12} /> X402 + VERIFY</span>
          </div>
        </div>
      </div>

      <Footer />

      {/* connect + login modal (header / hero button) */}
      <Modal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        tag="Sign in"
        title="Connect your wallet"
      >
        <div className="min-w-[340px]">
          <ConnectPanel auth={auth} onStart={closeAndStart} bare />
        </div>
      </Modal>
    </div>
  );
}
