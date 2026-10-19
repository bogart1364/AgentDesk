import React from 'react';
import { IconLogoMark, IconGrid, IconAgent, IconPlus, IconPulse, IconShield, IconWallet, IconArrowRight } from './Icons.jsx';
import { short } from '../lib/format.js';
import { PRIVY_ENABLED } from '../wagmi.js';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: IconGrid, tag: '01' },
  { id: 'agents', label: 'Agents', icon: IconAgent, tag: '02' },
  { id: 'create', label: 'Create Agent', icon: IconPlus, tag: '03' },
  { id: 'feed', label: 'Live Feed', icon: IconPulse, tag: '04' },
];

export default function Sidebar({ page, setPage, me, agents, openAgent, health, auth }) {
  return (
    <aside
      className="fixed left-0 top-0 bottom-0 w-64 flex flex-col z-40 border-r"
      style={{ background: 'var(--ad-panel)', borderColor: 'var(--ad-line)' }}
    >
      {/* brand */}
      <div className="px-5 py-6 border-b" style={{ borderColor: 'var(--ad-line)' }}>
        <button onClick={() => setPage('dashboard')} className="flex items-center gap-3 group text-left w-full">
          <IconLogoMark size={34} />
          <div>
            <div className="font-bold text-white text-[15px] leading-tight group-hover:text-[var(--ad-blue-l)] transition-colors">
              AgentDesk
            </div>
            <div className="font-mono text-[9px] tracking-[0.18em] mt-0.5" style={{ color: 'var(--ad-muted)' }}>
              CONTROL PLANE
            </div>
          </div>
        </button>
      </div>

      {/* nav */}
      <nav className="px-3 py-4 space-y-0.5 flex-1 overflow-y-auto">
        <div className="section-tag px-3 mb-3">Navigate</div>
        {NAV.map((n) => {
          const Icon = n.icon;
          const active = page === n.id || (page === 'agent-detail' && n.id === 'agents');
          return (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm font-medium transition-all duration-150"
              style={
                active
                  ? { background: 'rgba(11,19,250,0.1)', color: '#fff', border: '1px solid rgba(11,19,250,0.3)' }
                  : { color: 'var(--ad-muted)', border: '1px solid transparent' }
              }
            >
              <Icon size={16} style={active ? { color: 'var(--ad-blue-l)' } : undefined} />
              <span className="flex-1 text-left">{n.label}</span>
              <span className="font-mono text-[9px]" style={{ color: active ? 'var(--ad-blue-l)' : 'var(--ad-line2)' }}>
                {n.tag}
              </span>
            </button>
          );
        })}

        <button
          onClick={() => setPage('landing')}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm font-medium transition-all duration-150 mt-4"
          style={{ color: 'var(--ad-muted)', border: '1px solid transparent' }}
        >
          <IconArrowRight size={16} />
          <span className="flex-1 text-left">Home</span>
          <span className="font-mono text-[9px]" style={{ color: 'var(--ad-line2)' }}>00</span>
        </button>
      </nav>

      {/* agents quick list */}
      <div className="px-3 pb-2 border-t pt-3" style={{ borderColor: 'var(--ad-line)' }}>
        <div className="section-tag px-3 mb-2">Agents · {agents.length}</div>
        <div className="space-y-0.5 max-h-40 overflow-y-auto">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => openAgent(a.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded text-xs text-left transition-colors hover:bg-white/[0.03]"
              style={{ color: 'var(--ad-muted)' }}
            >
              <span
                className="dot"
                style={{
                  background:
                    a.status === 'active' ? '#34d399' : a.status === 'paused' ? '#fbbf24' : '#f87171',
                }}
              />
              <span className="truncate">{a.name}</span>
            </button>
          ))}
          {agents.length === 0 && (
            <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--ad-line2)' }}>
              No agents
            </div>
          )}
        </div>
      </div>

      {/* wallet + health */}
      <div className="p-4 border-t" style={{ borderColor: 'var(--ad-line)', background: 'var(--ad-panel2)' }}>
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-8 h-8 flex items-center justify-center rounded"
            style={{ background: 'rgba(11,19,250,0.15)', border: '1px solid rgba(11,19,250,0.3)', color: 'var(--ad-blue-l)' }}
          >
            {me?.human?.verified ? <IconShield size={14} /> : <IconWallet size={14} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-white truncate mono">
              {short(auth?.authAddress || me?.human?.address || '0x0')}
            </div>
            <div className="font-mono text-[9px] tracking-wider" style={{ color: '#34d399' }}>
              {PRIVY_ENABLED ? 'PRIVY AUTHENTICATED' : 'SIWE AUTHENTICATED'}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between font-mono text-[9px] tracking-wider" style={{ color: 'var(--ad-muted)' }}>
          <span className="flex items-center gap-1.5">
            <span className="dot" style={{ background: health?.ok ? '#34d399' : '#f87171' }} />
            {health?.ok ? `${String(health.mode || 'local').toUpperCase()} MODE` : 'API OFFLINE'}
          </span>
          <span>CHAIN {health?.chainId || '—'}</span>
        </div>
        {auth && (
          <button onClick={auth.logout} className="btn-ghost w-full mt-3 text-[11px] py-1.5">
            Sign Out
          </button>
        )}
      </div>
    </aside>
  );
}
