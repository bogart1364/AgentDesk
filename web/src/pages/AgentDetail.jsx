import React, { useEffect, useState, useCallback } from 'react';
import { fmtUsd, short, timeAgo } from '../lib/format.js';
import { authFetch } from '../auth.jsx';
import { CONTRACTS, CHAIN_MODE, CHAIN_ID } from '../wagmi.js';
import { useWriteContract } from 'wagmi';
import { parseUnits } from 'viem';
import policyAbi from '../abi/PolicyEngine.json';
import { StatusBadge, Progress, Field, Spinner } from '../components/ui.jsx';
import Modal, { ConfirmModal, InfoRow } from '../components/Modal.jsx';
import {
  IconArrowLeft, IconPause, IconPlay, IconBolt, IconLock,
  IconCheck, IconAlert, IconTerminal,
} from '../components/Icons.jsx';

const TABS = [
  { id: 'policy', label: 'Policy' },
  { id: 'allowlist', label: 'Allowlist' },
  { id: 'spend', label: 'Spend Log' },
  { id: 'x402', label: 'Test x402' },
];

export default function AgentDetail({ agentId, onBack, refresh, showToast }) {
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState('policy');
  const [policyForm, setPolicyForm] = useState({ perTxCapUsd: 0, dailyBudgetUsd: 0, monthlyBudgetUsd: 0 });
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [merchant, setMerchant] = useState('');
  const [merchantLabel, setMerchantLabel] = useState('');
  const [merchantError, setMerchantError] = useState('');
  const [testingPaid, setTestingPaid] = useState(false);
  const [paidResult, setPaidResult] = useState(null);
  const [pauseModal, setPauseModal] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);

  const { writeContractAsync, isPending: txPending } = useWriteContract();

  const onChain = async (address, abi, functionName, args, okMsg) => {
    const hash = await writeContractAsync({ address, abi, functionName, args, chainId: CHAIN_ID });
    showToast('success', `${functionName} sent — confirming…`);
    const { waitForTransactionReceipt } = await import('wagmi/actions');
    const { wagmiConfig } = await import('../wagmi.js');
    await waitForTransactionReceipt(wagmiConfig, { hash });
    showToast('success', okMsg || `${functionName} confirmed`);
    return hash;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const a = await authFetch(`/agents/${agentId}`);
      setAgent(a);
      if (a.policy) {
        setPolicyForm({
          perTxCapUsd: a.policy.per_tx_cap / 1e6,
          dailyBudgetUsd: a.policy.daily_budget / 1e6,
          monthlyBudgetUsd: a.policy.monthly_budget / 1e6,
        });
      }
    } catch (e) {
      setLoadError(e.status === 404 ? 'Agent not found. It may have been removed.' : e.message);
    }
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 gap-3" style={{ color: 'var(--ad-muted)' }}>
        <Spinner size={18} />
        <span className="font-mono text-xs tracking-wider">LOADING AGENT #{agentId}…</span>
      </div>
    );
  }

  if (loadError || !agent) {
    return (
      <div className="panel-plain p-12 text-center max-w-md mx-auto mt-16">
        <IconAlert size={28} className="text-red-400 mx-auto mb-4" />
        <h3 className="text-base font-semibold text-white">Failed to load agent</h3>
        <p className="mt-2 text-sm" style={{ color: 'var(--ad-muted)' }}>{loadError}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button onClick={onBack} className="btn-ghost text-xs">Back</button>
          <button onClick={load} className="btn-primary text-xs">Retry</button>
        </div>
      </div>
    );
  }

  const p = agent.policy;

  const validatePolicy = () => {
    const errs = {};
    if (policyForm.perTxCapUsd < 0) errs.perTxCapUsd = 'Must be ≥ 0';
    if (policyForm.dailyBudgetUsd < 0) errs.dailyBudgetUsd = 'Must be ≥ 0';
    if (policyForm.monthlyBudgetUsd < 0) errs.monthlyBudgetUsd = 'Must be ≥ 0';
    if (
      policyForm.dailyBudgetUsd > 0 &&
      policyForm.perTxCapUsd > policyForm.dailyBudgetUsd
    ) {
      errs.perTxCapUsd = 'Per-tx cap cannot exceed daily budget';
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const savePolicy = async () => {
    if (!validatePolicy()) return;
    setSaving(true);
    try {
      if (CHAIN_MODE === 'chain') {
        await onChain(
          CONTRACTS.policy,
          policyAbi,
          'setPolicy',
          [
            BigInt(agentId),
            parseUnits(String(policyForm.perTxCapUsd), 6),
            parseUnits(String(policyForm.dailyBudgetUsd), 6),
            parseUnits(String(policyForm.monthlyBudgetUsd), 6),
          ],
          'Policy updated on-chain'
        );
      } else {
        await authFetch(`/agents/${agentId}/policy`, { method: 'PUT', body: JSON.stringify({
          ...policyForm,
          useAllowlist: p?.use_allowlist ? true : false,
        }) });
        showToast('success', 'Policy updated');
      }
      load();
      refresh();
    } catch (e) {
      showToast('error', `Update failed: ${e.shortMessage || e.message}`);
    }
    setSaving(false);
  };

  const togglePause = async () => {
    setPauseBusy(true);
    try {
      const resuming = !!p?.paused;
      if (CHAIN_MODE === 'chain') {
        await onChain(
          CONTRACTS.policy,
          policyAbi,
          resuming ? 'resumePolicy' : 'pausePolicy',
          [BigInt(agentId)],
          resuming ? 'Agent resumed on-chain' : 'Kill-switch engaged on-chain'
        );
      } else if (resuming) {
        await authFetch(`/agents/${agentId}/resume`, { method: 'POST' });
        showToast('success', 'Agent resumed');
      } else {
        await authFetch(`/agents/${agentId}/pause`, { method: 'POST' });
        showToast('success', 'Kill-switch engaged — agent paused');
      }
      setPauseModal(false);
      load();
      refresh();
    } catch (e) {
      showToast('error', `Action failed: ${e.shortMessage || e.message}`);
    }
    setPauseBusy(false);
  };

  const addMerchant = () => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(merchant)) {
      setMerchantError('Invalid address — expecting 0x + 40 hex chars');
      return;
    }
    setMerchantError('');
    const done = () => {
      setMerchant('');
      setMerchantLabel('');
      showToast('success', 'Merchant added to allowlist');
      load();
    };
    const fail = (e) => showToast('error', e.shortMessage || e.message);
    if (CHAIN_MODE === 'chain') {
      onChain(
        CONTRACTS.policy,
        policyAbi,
        'setMerchantAllowed',
        [BigInt(agentId), merchant, true, merchantLabel || ''],
        'Merchant allowlisted on-chain'
      ).then(done).catch(fail);
    } else {
      authFetch(`/agents/${agentId}/allowlist`, { method: 'PUT', body: JSON.stringify({ merchant, label: merchantLabel, allowed: true }) })
        .then(done)
        .catch(fail);
    }
  };

  const testPaid = async () => {
    setTestingPaid(true);
    setPaidResult(null);
    try {
      const res = await authFetch(`/paid/market-data?agentId=${agentId}`);
      setPaidResult({ ok: true, res });
      load();
      refresh();
    } catch (e) {
      setPaidResult({ ok: false, error: e.data || { reason: e.message } });
    }
    setTestingPaid(false);
  };

  return (
    <div className="animate-in">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 text-xs font-mono tracking-wider mb-6 transition-colors hover:text-white"
        style={{ color: 'var(--ad-muted)' }}
      >
        <IconArrowLeft size={13} /> AGENTS
      </button>

      {/* header */}
      <div className="panel p-6 mb-6">
        <div className="flex items-center gap-5">
          <div
            className="w-14 h-14 flex items-center justify-center rounded font-bold text-xl"
            style={{
              background: 'linear-gradient(135deg, rgba(11,19,250,0.35), rgba(11,19,250,0.1))',
              border: '1px solid rgba(11,19,250,0.35)',
              color: '#fff',
            }}
          >
            {agent.name[0]?.toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-white">{agent.name}</h1>
              <StatusBadge status={agent.status} />
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--ad-muted)' }}>{agent.description}</div>
            <div className="font-mono text-[10px] mt-1.5 tracking-wider" style={{ color: 'var(--ad-line2)' }}>
              ID #{agent.id} · OWNER {short(agent.owner_address)} · {timeAgo(agent.created_at)}
            </div>
          </div>
          <button
            onClick={() => setPauseModal(true)}
            className={p?.paused ? 'btn-primary text-xs' : 'btn-danger text-xs'}
          >
            {p?.paused ? <><IconPlay size={13} /> Resume</> : <><IconPause size={13} /> Kill-switch</>}
          </button>
        </div>

        {p && (
          <div className="mt-6 grid grid-cols-4 gap-3">
            <UsageBox label="SPENT TODAY" value={fmtUsd(p.spentToday)} max={p.daily_budget > 0 ? fmtUsd(p.daily_budget) : '∞'} pct={p.daily_budget > 0 ? (p.spentToday / p.daily_budget) * 100 : 0} />
            <UsageBox label="SPENT MONTH" value={fmtUsd(p.spentThisMonth)} max={p.monthly_budget > 0 ? fmtUsd(p.monthly_budget) : '∞'} pct={p.monthly_budget > 0 ? (p.spentThisMonth / p.monthly_budget) * 100 : 0} />
            <MiniStat label="PER-TX CAP" value={fmtUsd(p.per_tx_cap)} />
            <MiniStat label="ALLOWLIST" value={p.use_allowlist ? 'ENFORCED' : 'OFF'} accent={p.use_allowlist} />
          </div>
        )}
      </div>

      {/* tabs */}
      <div className="flex gap-1 mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`tab ${tab === t.id ? 'tab-active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* policy */}
      {tab === 'policy' && p && (
        <div className="panel p-6 max-w-xl">
          <div className="section-tag mb-5">Spend Policy</div>
          <div className="space-y-5">
            <Field label="Per-transaction cap (USDC)" error={formErrors.perTxCapUsd}>
              <input
                type="number" step="0.01" min="0"
                className={`input ${formErrors.perTxCapUsd ? 'input-error' : ''}`}
                value={policyForm.perTxCapUsd}
                onChange={(e) => setPolicyForm({ ...policyForm, perTxCapUsd: parseFloat(e.target.value) || 0 })}
              />
            </Field>
            <Field label="Daily budget (USDC)" error={formErrors.dailyBudgetUsd}>
              <input
                type="number" step="0.01" min="0"
                className={`input ${formErrors.dailyBudgetUsd ? 'input-error' : ''}`}
                value={policyForm.dailyBudgetUsd}
                onChange={(e) => setPolicyForm({ ...policyForm, dailyBudgetUsd: parseFloat(e.target.value) || 0 })}
              />
            </Field>
            <Field label="Monthly budget (USDC)" error={formErrors.monthlyBudgetUsd}>
              <input
                type="number" step="0.01" min="0"
                className={`input ${formErrors.monthlyBudgetUsd ? 'input-error' : ''}`}
                value={policyForm.monthlyBudgetUsd}
                onChange={(e) => setPolicyForm({ ...policyForm, monthlyBudgetUsd: parseFloat(e.target.value) || 0 })}
              />
            </Field>
            <p className="font-mono text-[10px] leading-relaxed" style={{ color: 'var(--ad-muted)' }}>
              ENFORCED ON-CHAIN VIA POLICYENGINE.SOL — AGENT CANNOT EXCEED THESE LIMITS
            </p>
            <button onClick={savePolicy} disabled={saving || txPending} className="btn-primary w-full">
              {saving || txPending ? <><Spinner size={14} /> {CHAIN_MODE === 'chain' ? 'Confirming on Base…' : 'Saving…'}</> : 'Save Policy'}
            </button>
          </div>
        </div>
      )}

      {/* allowlist */}
      {tab === 'allowlist' && (
        <div className="panel p-6 max-w-2xl">
          <div className="section-tag mb-2">Merchant Allowlist</div>
          <p className="text-xs mb-5" style={{ color: 'var(--ad-muted)' }}>
            When enforced, the agent can only pay allowlisted merchant addresses.
          </p>

          <div className="flex items-center gap-3 mb-6">
            <span
              className="badge"
              style={
                p?.use_allowlist
                  ? { color: '#34d399', borderColor: 'rgba(52,211,153,0.25)', background: 'rgba(52,211,153,0.06)' }
                  : { color: 'var(--ad-muted)', borderColor: 'var(--ad-line2)', background: 'var(--ad-ink)' }
              }
            >
              {p?.use_allowlist ? 'ENFORCED' : 'DISABLED'}
            </span>
            <button
              onClick={async () => {
                try {
                  if (CHAIN_MODE === 'chain') {
                    await onChain(
                      CONTRACTS.policy,
                      policyAbi,
                      'setUseAllowlist',
                      [BigInt(agentId), !p?.use_allowlist],
                      `Allowlist ${!p?.use_allowlist ? 'enforced' : 'disabled'} on-chain`
                    );
                  } else {
                    await authFetch(`/agents/${agentId}/policy`, { method: 'PUT', body: JSON.stringify({ useAllowlist: !p?.use_allowlist }) });
                  }
                  load();
                  refresh();
                } catch (e) {
                  showToast('error', e.shortMessage || e.message);
                }
              }}
              disabled={txPending}
              className="btn-ghost text-xs"
            >
              Toggle
            </button>
          </div>

          <div className="flex gap-2 mb-5">
            <div className="flex-1">
              <input
                className={`input ${merchantError ? 'input-error' : ''}`}
                placeholder="Merchant address 0x…"
                value={merchant}
                onChange={(e) => { setMerchant(e.target.value); setMerchantError(''); }}
              />
              {merchantError && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px]" style={{ color: '#f87171' }}>
                  <IconAlert size={11} /> {merchantError}
                </div>
              )}
            </div>
            <input className="input w-36" placeholder="Label" value={merchantLabel} onChange={(e) => setMerchantLabel(e.target.value)} />
            <button onClick={addMerchant} className="btn-primary text-xs px-4">Add</button>
          </div>

          <div className="divide-y" style={{ borderColor: 'var(--ad-line)' }}>
            {(agent.allowlist || []).map((row, i) => (
              <div key={i} className="py-3.5 flex items-center gap-3" style={{ borderColor: 'var(--ad-line)' }}>
                <span className="dot" style={{ background: row.allowed ? '#34d399' : '#f87171' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white mono text-xs">{short(row.merchant, 12)}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--ad-muted)' }}>{row.label || '—'}</div>
                </div>
              </div>
            ))}
            {(agent.allowlist || []).length === 0 && (
              <div className="py-8 text-center text-sm" style={{ color: 'var(--ad-muted)' }}>
                No merchants in allowlist
              </div>
            )}
          </div>
        </div>
      )}

      {/* spend */}
      {tab === 'spend' && (
        <div className="panel-plain divide-y" style={{ borderColor: 'var(--ad-line)' }}>
          {(agent.recentSpend || []).map((r) => (
            <div key={r.id} className="p-4 flex items-center gap-4" style={{ borderColor: 'var(--ad-line)' }}>
              <span className="dot" style={{ background: '#34d399' }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white">{r.endpoint || 'payment'}</div>
                <div className="font-mono text-[10px] mt-0.5" style={{ color: 'var(--ad-muted)' }}>
                  {short(r.merchant, 10)} · {r.tx_hash ? short(r.tx_hash, 10) : '—'} · {timeAgo(r.created_at)}
                </div>
              </div>
              <div className="mono text-sm font-semibold shrink-0" style={{ color: '#34d399' }}>
                +{r.amountDisplay}
              </div>
            </div>
          ))}
          {(agent.recentSpend || []).length === 0 && (
            <div className="p-14 text-center text-sm" style={{ color: 'var(--ad-muted)' }}>
              No spend recorded
            </div>
          )}
        </div>
      )}

      {/* x402 test */}
      {tab === 'x402' && (
        <div className="panel p-6 max-w-xl">
          <div className="section-tag mb-2">x402 Payment Test</div>
          <p className="text-xs mb-5 leading-relaxed" style={{ color: 'var(--ad-muted)' }}>
            Sends <span className="mono text-white">GET /api/paid/market-data?agentId={agent.id}</span>.
            Without payment: <span className="mono" style={{ color: '#fbbf24' }}>402</span>.
            With valid payment + policy pass: <span className="mono" style={{ color: '#34d399' }}>200</span> + settlement proof.
          </p>

          <button
            onClick={testPaid}
            disabled={testingPaid || p?.paused}
            className="btn-primary w-full"
          >
            {testingPaid ? (
              <><Spinner size={14} /> Settling…</>
            ) : p?.paused ? (
              <><IconLock size={14} /> Agent paused — resume first</>
            ) : (
              <><IconBolt size={14} /> Send $0.01 paid request</>
            )}
          </button>

          {paidResult && (
            <div className="mt-5">
              <div className="section-tag mb-2">Response</div>
              <pre
                className="rounded p-4 text-[11px] font-mono overflow-x-auto max-h-72 leading-relaxed"
                style={{ background: 'var(--ad-ink)', border: '1px solid var(--ad-line)', color: paidResult.ok ? '#a7f3d0' : '#fca5a5' }}
              >
                {JSON.stringify(paidResult.ok ? paidResult.res : paidResult.error, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* pause modal */}
      <ConfirmModal
        open={pauseModal}
        onClose={() => setPauseModal(false)}
        onConfirm={togglePause}
        busy={pauseBusy || txPending}
        danger={!p?.paused}
        tag={p?.paused ? 'Resume Agent' : 'Kill-switch'}
        title={p?.paused ? `Resume ${agent.name}?` : `Pause ${agent.name}?`}
        message={
          p?.paused
            ? 'The agent will be able to spend within its on-chain policy limits again.'
            : 'All spending will be immediately blocked. The agent cannot make any x402 payments until resumed. Existing spend history is preserved.'
        }
        confirmLabel={p?.paused ? 'Resume' : 'Pause Agent'}
      />
    </div>
  );
}

function UsageBox({ label, value, max, pct }) {
  const danger = pct > 80;
  return (
    <div className="rounded-sm px-4 py-3.5" style={{ background: 'var(--ad-ink)', border: '1px solid var(--ad-line)' }}>
      <div className="font-mono text-[9px] tracking-wider" style={{ color: 'var(--ad-muted)' }}>{label}</div>
      <div className="mono text-base font-semibold text-white mt-1.5">
        {value} <span className="text-[10px] font-normal" style={{ color: 'var(--ad-muted)' }}>/ {max}</span>
      </div>
      <div className="mt-2.5">
        <Progress pct={pct} color={danger ? '#fbbf24' : 'var(--ad-blue)'} />
      </div>
    </div>
  );
}

function MiniStat({ label, value, accent }) {
  return (
    <div className="rounded-sm px-4 py-3.5" style={{ background: 'var(--ad-ink)', border: '1px solid var(--ad-line)' }}>
      <div className="font-mono text-[9px] tracking-wider" style={{ color: 'var(--ad-muted)' }}>{label}</div>
      <div className="mono text-base font-semibold mt-1.5" style={{ color: accent ? '#34d399' : '#fff' }}>{value}</div>
    </div>
  );
}
