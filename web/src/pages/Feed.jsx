import React from 'react';
import { fmtUsd, short, timeAgo } from '../lib/format.js';
import { SectionHeader } from '../components/ui.jsx';
import { IconRefresh, IconPulse, IconTerminal } from '../components/Icons.jsx';

export default function Feed({ feed, refresh }) {
  const total = feed.reduce((s, r) => s + (r.status === 'settled' ? r.amount : 0), 0);

  return (
    <div className="animate-in">
      <SectionHeader
        tag="04 / Settlement Log"
        title="Live Feed"
        right={
          <div className="flex items-center gap-5">
            <div className="text-right">
              <div className="font-mono text-[10px] tracking-wider" style={{ color: 'var(--ad-muted)' }}>
                {feed.length} PAYMENTS · <span style={{ color: '#34d399' }}>{fmtUsd(total)}</span>
              </div>
            </div>
            <button onClick={refresh} className="btn-ghost text-xs">
              <IconRefresh size={13} /> Refresh
            </button>
          </div>
        }
      />

      <div className="panel-plain overflow-hidden">
        {/* table header */}
        <div
          className="px-5 py-3 flex items-center gap-4 thead border-b"
          style={{ borderColor: 'var(--ad-line)', background: 'var(--ad-panel2)' }}
        >
          <span className="w-16">Status</span>
          <span className="flex-1">Agent / Merchant</span>
          <span className="w-48">Endpoint</span>
          <span className="w-24 text-right">Time</span>
          <span className="w-28 text-right">Amount</span>
        </div>

        {/* rows */}
        <div className="divide-y" style={{ borderColor: 'var(--ad-line)' }}>
          {feed.map((r) => (
            <div
              key={r.id}
              className="px-5 py-3.5 flex items-center gap-4 transition-colors hover:bg-white/[0.015]"
              style={{ borderColor: 'var(--ad-line)' }}
            >
              <div className="w-16 flex items-center gap-2">
                <span
                  className="dot"
                  style={{
                    background:
                      r.status === 'settled' ? '#34d399' : r.status === 'pending' ? '#fbbf24' : '#f87171',
                  }}
                />
                <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: 'var(--ad-muted)' }}>
                  {r.status}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm text-white flex items-center gap-1.5">
                  <span className="mono" style={{ color: 'var(--ad-blue-l)' }}>#{r.agent_id}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--ad-muted)', flexShrink: 0 }}><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                  <span className="mono text-xs">{short(r.merchant, 10)}</span>
                </div>
                <div className="font-mono text-[9px] mt-0.5 truncate" style={{ color: 'var(--ad-muted)' }}>
                  TX {r.tx_hash ? short(r.tx_hash, 12) : '—'} · {r.policy_checked}
                </div>
              </div>

              <div className="w-48 font-mono text-[10px] truncate" style={{ color: 'var(--ad-muted)' }}>
                {r.endpoint || '—'}
              </div>
              <div className="w-24 text-right font-mono text-[10px]" style={{ color: 'var(--ad-muted)' }}>
                {timeAgo(r.created_at)}
              </div>
              <div className="w-28 text-right mono text-sm font-semibold" style={{ color: '#34d399' }}>
                +{r.amountDisplay}
              </div>
            </div>
          ))}
        </div>

        {feed.length === 0 && (
          <div className="p-16 text-center">
            <IconPulse size={28} className="mx-auto mb-4" style={{ color: 'var(--ad-line2)' }} />
            <div className="text-sm" style={{ color: 'var(--ad-muted)' }}>
              No payments recorded — test the x402 flow from any agent detail page.
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3 font-mono text-[10px] tracking-wider" style={{ color: 'var(--ad-muted)' }}>
        <IconTerminal size={12} />
        EACH SETTLED PAYMENT EMITS SPENDRECORDED ON-CHAIN VIA POLICYENGINE · AMOUNTS IN USDC (6 DECIMALS)
      </div>
    </div>
  );
}
