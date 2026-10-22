import React, { useState } from 'react';
import { useSignMessage } from 'wagmi';
import { StatCard, StatusBadge, Progress, EmptyState, SectionHeader } from '../components/ui.jsx';
import { IconPlus, IconPulse, IconAgent, IconArrowRight } from '../components/Icons.jsx';
import { fmtUsd, short, timeAgo } from '../lib/format.js';

const VERIFY_PROVIDERS = ['x', 'coinbase', 'instagram', 'tiktok'];

/** Base Verify deep link when running inside Coinbase Wallet / Base app. */
function openVerify(redirectUrl) {
  const inBaseApp = typeof window !== 'undefined' && (window.ethereum?.isCoinbaseWallet || /CoinbaseWallet|BaseApp/i.test(navigator.userAgent || ''));
  if (inBaseApp) {
    window.open(`cbwallet://miniapp?url=${encodeURIComponent(redirectUrl)}`, '_blank');
  } else {
    window.open(redirectUrl, '_blank');
  }
}

export default function Dashboard({ me, agents, feed, openAgent, setPage }) {
  const activeAgents = agents.filter((a) => a.status === 'active').length;
  const totalSpendToday = feed.reduce((s, r) => s + (r.status === 'settled' ? r.amount : 0), 0);
  const verified = me?.human?.verified;
  const { signMessageAsync } = useSignMessage();
  const [provider, setProvider] = useState('x');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  async function runVerify() {
    setBusy(true);
    setNote(null);
    try {
      const { authFetch } = await import('../auth.jsx');
      // 1. server builds the SIWE message carrying urn:verify provider/traits/action resources
      const payload = await authFetch(`/verify/payload?provider=${provider}`);
      if (payload.isProd && !payload.configured) {
        setNote('Base Verify is not configured on this deployment (BASE_VERIFY_SECRET_KEY is missing).');
        return;
      }
      // 2. the user signs it
      const signature = await signMessageAsync({ message: payload.message });
      // 3. backend validates traits + calls Base Verify, stores the Sybil token
      const res = await authFetch('/verify/social', {
        method: 'POST',
        body: JSON.stringify({ message: payload.message, signature, provider }),
      });
      setNote(res.demo ? 'Demo verification (no BASE_VERIFY_SECRET_KEY set on the server).' : 'Verified.');
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      const data = e.data || {};
      if (e.status === 404 && data.redirectUrl) {
        openVerify(data.redirectUrl);
        setNote('Finish OAuth at Base Verify, then click Verify again.');
      } else if (e.status === 409) {
        setNote('This identity is already linked to another wallet.');
      } else if (e.status === 501) {
        setNote('Base Verify is not configured on this deployment.');
      } else if (data.error === 'unknown_or_expired_challenge') {
        setNote('This verification request expired. Click Verify again.');
      } else if (data.traitsNotMet) {
        setNote('Your account does not meet the required traits.');
      } else {
        setNote(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-in">
      <SectionHeader
        tag="01 / Overview"
        title="Dashboard"
        right={
          <button onClick={() => setPage('create')} className="btn-primary text-xs">
            <IconPlus size={14} /> New Agent
          </button>
        }
      />

      {/* stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
        <StatCard tag="Active Agents" value={String(activeAgents)} sub={`${agents.length} TOTAL`} accent />
        <StatCard tag="Spend · 24H" value={fmtUsd(totalSpendToday)} sub="FROM FEED LOG" />
        <StatCard tag="Identity" value={verified ? 'Verified' : 'Unverified'} sub={me?.human?.verify_provider?.toUpperCase() || '—'} />
        <StatCard tag="Network" value="Base" sub="CHAIN ID 8453" />
      </div>

      {/* verify banner */}
      {!verified && me && (
        <div
          className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5 px-4 sm:px-6 py-4 sm:py-5 rounded mb-8"
          style={{ background: 'rgba(251,191,36,0.04)', border: '1px solid rgba(251,191,36,0.2)' }}
        >
          <div
            className="w-10 h-10 flex items-center justify-center rounded shrink-0"
            style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24' }}
          >
            <IconAgent size={18} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-white text-sm">Base Verify required</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--ad-muted)' }}>
              Unverified: 1 agent max. Verified: 5 agents + full policy features.
            </div>
            {note && (
              <div className="text-xs mt-1.5" style={{ color: '#fbbf24' }}>
                {note}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="input text-xs flex-1 sm:flex-none"
              style={{ width: 116 }}
              disabled={busy}
            >
              {VERIFY_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p.toUpperCase()}
                </option>
              ))}
            </select>
            <button onClick={runVerify} className="btn-ghost text-xs flex-1 sm:flex-none whitespace-nowrap" disabled={busy}>
              {busy ? 'Signing…' : `Verify via ${provider.toUpperCase()}`}
            </button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-5 gap-6">
        {/* agents */}
        <div className="md:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <div className="section-tag">Your Agents</div>
            <button onClick={() => setPage('agents')} className="font-mono text-[10px] tracking-wider hover:text-white transition-colors flex items-center gap-1" style={{ color: 'var(--ad-muted)' }}>
              VIEW ALL <IconArrowRight size={11} />
            </button>
          </div>

          {agents.length === 0 ? (
            <EmptyState
              icon={<IconAgent size={22} />}
              title="No agents deployed"
              sub="Create your first AI agent with an on-chain spend policy."
              action={
                <button onClick={() => setPage('create')} className="btn-primary text-xs">
                  <IconPlus size={14} /> Create Agent
                </button>
              }
            />
          ) : (
            <div className="space-y-3">
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => openAgent(a.id)}
                  className="panel panel-hover w-full p-5 text-left block"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="w-11 h-11 flex items-center justify-center rounded font-bold text-sm"
                      style={{ background: 'rgba(11,19,250,0.12)', border: '1px solid rgba(11,19,250,0.25)', color: 'var(--ad-blue-l)' }}
                    >
                      {a.name[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className="font-semibold text-white truncate text-sm">{a.name}</span>
                        <StatusBadge status={a.status} />
                      </div>
                      <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--ad-muted)' }}>
                        {a.description}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-[9px] tracking-wider" style={{ color: 'var(--ad-muted)' }}>TODAY</div>
                      <div className="mono text-sm font-semibold text-white mt-0.5">
                        {fmtUsd(a.policy?.spentToday || 0)}
                      </div>
                    </div>
                  </div>
                  {a.policy && (
                    <div className="mt-4">
                      <div className="flex justify-between font-mono text-[9px] tracking-wider mb-1.5" style={{ color: 'var(--ad-muted)' }}>
                        <span>DAILY BUDGET</span>
                        <span>
                          {fmtUsd(a.policy.spentToday)} / {a.policy.daily_budget > 0 ? fmtUsd(a.policy.daily_budget) : '∞'}
                        </span>
                      </div>
                      <Progress
                        pct={a.policy.daily_budget > 0 ? (a.policy.spentToday / a.policy.daily_budget) * 100 : 0}
                        color={
                          a.policy.daily_budget > 0 && a.policy.spentToday / a.policy.daily_budget > 0.8
                            ? '#fbbf24'
                            : 'var(--ad-blue)'
                        }
                      />
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* live feed */}
        <div className="md:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="section-tag flex items-center gap-2">
              <span className="dot dot-live" /> Live Feed
            </div>
            <button onClick={() => setPage('feed')} className="font-mono text-[10px] tracking-wider hover:text-white transition-colors flex items-center gap-1" style={{ color: 'var(--ad-muted)' }}>
              ALL <IconArrowRight size={11} />
            </button>
          </div>
          <div className="panel-plain divide-y" style={{ borderColor: 'var(--ad-line)', maxHeight: 480, overflowY: 'auto' }}>
            {feed.slice(0, 12).map((r) => (
              <div key={r.id} className="p-3.5 flex items-center gap-3" style={{ borderColor: 'var(--ad-line)' }}>
                <span className="dot" style={{ background: '#34d399' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white font-medium truncate">
                    Agent #{r.agent_id} to <span className="mono">{short(r.merchant, 4)}</span>
                  </div>
                  <div className="font-mono text-[9px] mt-0.5 truncate" style={{ color: 'var(--ad-muted)' }}>
                    {r.endpoint} · {timeAgo(r.created_at)}
                  </div>
                </div>
                <div className="mono text-xs font-semibold shrink-0" style={{ color: '#34d399' }}>
                  +{r.amountDisplay}
                </div>
              </div>
            ))}
            {feed.length === 0 && (
              <div className="p-10 text-center text-sm" style={{ color: 'var(--ad-muted)' }}>
                No spend recorded yet
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
