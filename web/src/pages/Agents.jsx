import React from 'react';
import { StatusBadge, EmptyState, SectionHeader } from '../components/ui.jsx';
import { IconPlus, IconAgent, IconArrowRight } from '../components/Icons.jsx';
import { fmtUsd, timeAgo } from '../lib/format.js';

export default function Agents({ agents, openAgent, setPage }) {
  return (
    <div className="animate-in">
      <SectionHeader
        tag="02 / Registry"
        title="Agents"
        right={
          <button onClick={() => setPage('create')} className="btn-primary text-xs">
            <IconPlus size={14} /> Create Agent
          </button>
        }
      />

      {agents.length === 0 ? (
        <EmptyState
          icon={<IconAgent size={22} />}
          title="No agents in registry"
          sub="Deploy an AI agent with an on-chain spend policy to start paying for APIs via x402."
          action={
            <button onClick={() => setPage('create')} className="btn-primary">
              <IconPlus size={14} /> Create Agent
            </button>
          }
        />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => openAgent(a.id)}
              className="panel panel-hover p-6 text-left"
            >
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-4">
                  <div
                    className="w-12 h-12 flex items-center justify-center rounded font-bold text-lg"
                    style={{
                      background: 'linear-gradient(135deg, rgba(11,19,250,0.3), rgba(11,19,250,0.08))',
                      border: '1px solid rgba(11,19,250,0.3)',
                      color: '#fff',
                    }}
                  >
                    {a.name[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-white">{a.name}</div>
                    <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--ad-muted)' }}>
                      {timeAgo(a.created_at)} · ID #{a.id}
                    </div>
                  </div>
                </div>
                <StatusBadge status={a.status} />
              </div>

              <p className="text-xs leading-relaxed mb-5" style={{ color: 'var(--ad-muted)' }}>
                {a.description || 'No description provided.'}
              </p>

              {a.policy ? (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'PER-TX CAP', value: fmtUsd(a.policy.per_tx_cap) },
                    { label: 'DAILY', value: fmtUsd(a.policy.daily_budget) },
                    { label: 'MONTHLY', value: fmtUsd(a.policy.monthly_budget) },
                  ].map((c) => (
                    <div
                      key={c.label}
                      className="rounded-sm px-3 py-2.5 text-center"
                      style={{ background: 'var(--ad-ink)', border: '1px solid var(--ad-line)' }}
                    >
                      <div className="font-mono text-[9px] tracking-wider" style={{ color: 'var(--ad-muted)' }}>
                        {c.label}
                      </div>
                      <div className="mono text-sm font-semibold text-white mt-1">{c.value}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="rounded-sm px-4 py-3 text-xs"
                  style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', color: '#fbbf24' }}
                >
                  No policy configured — spending disabled
                </div>
              )}

              {a.policy?.paused && (
                <div className="mt-3 flex items-center gap-2 font-mono text-[10px] tracking-wider" style={{ color: '#fbbf24' }}>
                  <span className="dot" style={{ background: '#fbbf24' }} /> POLICY PAUSED
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
