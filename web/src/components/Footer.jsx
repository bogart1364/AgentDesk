import React from 'react';
import { IconLogoMark, IconGithub, IconDoc, IconLink, IconExternal } from './Icons.jsx';

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer
      className="mt-20 border-t"
      style={{ borderColor: 'var(--ad-line)', background: 'var(--ad-panel)' }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-10 sm:py-12">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-12 lg:gap-8">
          {/* brand */}
          <div className="col-span-2 lg:col-span-4">
            <div className="flex items-center gap-3 mb-4">
              <IconLogoMark size={28} />
              <div className="min-w-0">
                <div className="font-semibold text-white text-sm">AgentDesk</div>
                <div className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--ad-muted)' }}>
                  AI AGENT COMMERCE CONTROL PLANE
                </div>
              </div>
            </div>
            <p className="text-xs leading-relaxed max-w-sm lg:max-w-xs" style={{ color: 'var(--ad-muted)' }}>
              On-chain spend policies for autonomous agents. Built on Base with x402
              payments and Base Verify identity.
            </p>
          </div>

          {/* product */}
          <div className="lg:col-span-2">
            <div className="section-tag mb-4">Product</div>
            <ul className="space-y-2.5 text-xs" style={{ color: 'var(--ad-muted)' }}>
              <li><a href="#dashboard" className="hover:text-white transition-colors">Dashboard</a></li>
              <li><a href="#agents" className="hover:text-white transition-colors">Agents</a></li>
              <li><a href="#feed" className="hover:text-white transition-colors">Live Feed</a></li>
              <li><a href="#policies" className="hover:text-white transition-colors">Policies</a></li>
            </ul>
          </div>

          {/* network */}
          <div className="lg:col-span-3">
            <div className="section-tag mb-4">Network</div>
            <ul className="space-y-2.5 text-xs" style={{ color: 'var(--ad-muted)' }}>
              <li>
                <a
                  href="https://docs.base.org/build-on-base/accept-payments/charge-for-an-api"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-white transition-colors inline-flex items-center gap-1.5"
                >
                  x402 Payments <IconExternal size={11} />
                </a>
              </li>
              <li>
                <a
                  href="https://docs.base.org/sdks/base-verify/overview"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-white transition-colors inline-flex items-center gap-1.5"
                >
                  Base Verify <IconExternal size={11} />
                </a>
              </li>
              <li>
                <a
                  href="https://docs.base.org"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-white transition-colors inline-flex items-center gap-1.5"
                >
                  Base Docs <IconExternal size={11} />
                </a>
              </li>
              <li className="flex items-center gap-1.5">
                <span
                  className="dot"
                  style={{ background: '#34d399' }}
                />
                Base Mainnet · 8453
              </li>
            </ul>
          </div>

          {/* contracts */}
          <div className="lg:col-span-3">
            <div className="section-tag mb-4">Contracts</div>
            <ul className="space-y-2.5 text-xs" style={{ color: 'var(--ad-muted)' }}>
              <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span style={{ color: 'var(--ad-blue-l)' }}>AgentRegistry</span>
                <span className="mono text-[10px]">v0.1.0</span>
              </li>
              <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span style={{ color: 'var(--ad-blue-l)' }}>PolicyEngine</span>
                <span className="mono text-[10px]">v0.1.0</span>
              </li>
              <li className="pt-1">
                <a
                  href="https://github.com/base-org"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-white transition-colors inline-flex items-center gap-1.5"
                >
                  <IconGithub size={12} /> Source
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* bottom bar */}
        <div
          className="mt-8 sm:mt-10 pt-6 border-t flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-[11px]"
          style={{ borderColor: 'var(--ad-line)', color: 'var(--ad-muted)' }}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="mono">© {year} AgentDesk</span>
            <span className="hidden sm:inline">Built for Base Grant Program</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <a href="#privacy" className="hover:text-white transition-colors">Privacy</a>
            <a href="#terms" className="hover:text-white transition-colors">Terms</a>
            <span className="mono" style={{ color: 'var(--ad-blue-l)' }}>MIT License</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
