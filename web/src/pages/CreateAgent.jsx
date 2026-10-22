import React, { useState } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useSignMessage } from 'wagmi';
import { parseUnits, decodeEventLog } from 'viem';
import { SectionHeader, Field, Spinner, ErrorBanner } from '../components/ui.jsx';
import { IconAgent, IconArrowLeft } from '../components/Icons.jsx';
import { authFetch } from '../auth.jsx';
import { CONTRACTS, CHAIN_MODE, CHAIN_ID, TX_ATTRIBUTION } from '../wagmi.js';
import registryAbi from '../abi/AgentRegistry.json';
import policyAbi from '../abi/PolicyEngine.json';

export default function CreateAgent({ auth, onCreated, setPage, showToast }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    perTxCapUsd: 5,
    dailyBudgetUsd: 50,
    monthlyBudgetUsd: 500,
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [apiErr, setApiErr] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const [onChainAgentId, setOnChainAgentId] = useState(null);

  const { writeContractAsync, isPending: writing } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const { data: receipt, isLoading: confirming } = useWaitForTransactionReceipt({ hash: txHash });

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Agent name is required';
    else if (form.name.length > 64) e.name = 'Max 64 characters';
    if (form.perTxCapUsd < 0) e.perTxCapUsd = 'Must be ≥ 0';
    if (form.dailyBudgetUsd < 0) e.dailyBudgetUsd = 'Must be ≥ 0';
    if (form.monthlyBudgetUsd < 0) e.monthlyBudgetUsd = 'Must be ≥ 0';
    if (form.dailyBudgetUsd > 0 && form.perTxCapUsd > form.dailyBudgetUsd) {
      e.perTxCapUsd = 'Cannot exceed daily budget';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // chain mode: Base Verify onchain check + two on-chain txs (createAgent then setPolicy)
  const submitChain = async () => {
    if (!validate()) return;
    setBusy(true);
    setApiErr(null);
    try {
      // 1. server builds the SIWE message that names this AgentRegistry (Resources: eip155:84532:<registry>)
      const payload = await authFetch('/verify/onchain/payload');
      // 2. the wallet signs it — this is the Base Verify credential (no API key)
      const siweSignature = await signMessageAsync({ message: payload.message });
      // 3. Base Verify checks our contract's policy (coinbase_one_active eq true) and signs back
      const verification = await authFetch('/verify/onchain', {
        method: 'POST',
        body: JSON.stringify({ message: payload.message, signature: siweSignature }),
      });

      // 4. createAgent(identityHash, expiration, signature, name, metadataURI) — the registry
      //    re-verifies on-chain through SignerRegistry and dedupes on identityHash
      const hash = await writeContractAsync({
        address: CONTRACTS.registry,
        abi: registryAbi,
        functionName: 'createAgent',
        args: [
          verification.identityHash,
          BigInt(verification.expiration),
          verification.signature,
          form.name.trim(),
          form.description.trim(),
        ],
        chainId: CHAIN_ID,
        ...TX_ATTRIBUTION,
      });
      setTxHash(hash);
      showToast('success', 'Transaction sent — confirming on Base…');

      // wait handled by useEffect on receipt
    } catch (e) {
      const data = e.data || {};
      if (e.status === 404 && data.redirectUrl) {
        window.open(data.redirectUrl, '_blank');
        setApiErr('Base Verify needs a verified account for this wallet — finish the flow, then try again.');
      } else if (data.conditionsNotSatisfied) {
        setApiErr('This contract gates on an active Coinbase One subscription (coinbase_one_active eq true).');
      } else {
        setApiErr(data.error || e.shortMessage || e.message?.slice(0, 200) || 'Transaction rejected');
      }
      setBusy(false);
    }
  };

  // after createAgent receipt: parse agentId, then setPolicy
  React.useEffect(() => {
    if (!receipt || !busy) return;
    (async () => {
      try {
        let agentId = null;
        for (const log of receipt.logs) {
          try {
            const parsed = decodeEventLog({
              abi: registryAbi,
              data: log.data,
              topics: log.topics,
            });
            if (parsed.eventName === 'AgentCreated') {
              agentId = Number(parsed.args.agentId);
              break;
            }
          } catch {
            /* not our event */
          }
        }
        if (agentId == null) {
          throw new Error('AgentCreated event not found in receipt');
        }

        // tx 2: setPolicy
        const hash2 = await writeContractAsync({
          address: CONTRACTS.policy,
          abi: policyAbi,
          functionName: 'setPolicy',
          args: [
            BigInt(agentId),
            parseUnits(String(form.perTxCapUsd), 6),
            parseUnits(String(form.dailyBudgetUsd), 6),
            parseUnits(String(form.monthlyBudgetUsd), 6),
          ],
          chainId: CHAIN_ID,
          ...TX_ATTRIBUTION,
        });

        showToast('success', 'Setting spend policy on-chain…');
        const { waitForTransactionReceipt } = await import('wagmi/actions');
        const { wagmiConfig: cfg2 } = await import('../wagmi.js');
        await waitForTransactionReceipt(cfg2, { hash: hash2 });
        setOnChainAgentId(agentId);
        setBusy(false);
        showToast('success', `Agent #${agentId} deployed on Base Sepolia`);
        onCreated(agentId);
      } catch (e) {
        console.error(e);
        setApiErr(e.shortMessage || e.message?.slice(0, 200) || 'Post-create step failed');
        setBusy(false);
      }
    })();
  }, [receipt, busy]);

  // ── local mode: server CRUD ──
  const submitLocal = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setApiErr(null);
    try {
      const agent = await authFetch('/agents', {
        method: 'POST',
        body: JSON.stringify({
          ownerAddress: auth.authAddress,
          name: form.name.trim(),
          description: form.description.trim(),
        }),
      });
      await authFetch(`/agents/${agent.id}/policy`, {
        method: 'PUT',
        body: JSON.stringify({
          perTxCapUsd: form.perTxCapUsd,
          dailyBudgetUsd: form.dailyBudgetUsd,
          monthlyBudgetUsd: form.monthlyBudgetUsd,
        }),
      });
      onCreated(agent.id);
    } catch (e) {
      setApiErr(e.data?.hint || e.data?.error || e.message);
    }
    setBusy(false);
  };

  const onSubmit = CHAIN_MODE === 'chain' ? (ev) => { ev.preventDefault(); submitChain(); } : submitLocal;

  return (
    <div className="animate-in max-w-xl">
      <SectionHeader
        tag={CHAIN_MODE === 'chain' ? '03 / Deploy · On-chain' : '03 / Deploy · Local'}
        title="Create Agent"
      />

      <button
        onClick={() => setPage('agents')}
        className="inline-flex items-center gap-2 text-xs font-mono tracking-wider mb-6 transition-colors hover:text-white"
        style={{ color: 'var(--ad-muted)' }}
      >
        <IconArrowLeft size={13} /> AGENTS
      </button>

      {CHAIN_MODE === 'chain' && (
        <div
          className="flex items-start gap-3 px-4 py-3 rounded mb-5 text-xs"
          style={{ background: 'rgba(11,19,250,0.06)', border: '1px solid rgba(11,19,250,0.3)', color: 'var(--ad-muted)' }}
        >
          <span className="dot dot-live mt-1" />
          <span>
            <span className="text-white font-medium">Chain mode:</span> Base Verify checks the wallet against
            this contract's policy (<span className="mono">coinbase · coinbase_one_active eq true</span>), then 2
            real transactions run on Base Sepolia — <span className="mono">createAgent(identityHash, expiration,
            signature, …)</span> + <span className="mono">setPolicy</span>. Wallet confirmation required.
          </span>
        </div>
      )}

      {apiErr && <ErrorBanner message={apiErr} onDismiss={() => setApiErr(null)} />}

      <div className="panel p-4 sm:p-6">
        <form onSubmit={onSubmit} className="space-y-5">
          <Field label="Agent Name" error={errors.name}>
            <input
              className={`input ${errors.name ? 'input-error' : ''}`}
              placeholder="e.g. Market Scout"
              value={form.name}
              onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors({ ...errors, name: undefined }); }}
              maxLength={64}
            />
          </Field>

          <Field label="Description">
            <textarea
              className="input min-h-[80px] resize-y"
              placeholder="What does this agent do? Which APIs will it pay for?"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              maxLength={500}
            />
          </Field>

          <div className="pt-2">
            <div className="div-label mb-5">Spend Policy · USDC</div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Per-tx Cap" error={errors.perTxCapUsd}>
                <input
                  type="number" step="0.01" min="0"
                  className={`input ${errors.perTxCapUsd ? 'input-error' : ''}`}
                  value={form.perTxCapUsd}
                  onChange={(e) => setForm({ ...form, perTxCapUsd: parseFloat(e.target.value) || 0 })}
                />
              </Field>
              <Field label="Daily" error={errors.dailyBudgetUsd}>
                <input
                  type="number" step="0.01" min="0"
                  className={`input ${errors.dailyBudgetUsd ? 'input-error' : ''}`}
                  value={form.dailyBudgetUsd}
                  onChange={(e) => setForm({ ...form, dailyBudgetUsd: parseFloat(e.target.value) || 0 })}
                />
              </Field>
              <Field label="Monthly" error={errors.monthlyBudgetUsd}>
                <input
                  type="number" step="0.01" min="0"
                  className={`input ${errors.monthlyBudgetUsd ? 'input-error' : ''}`}
                  value={form.monthlyBudgetUsd}
                  onChange={(e) => setForm({ ...form, monthlyBudgetUsd: parseFloat(e.target.value) || 0 })}
                />
              </Field>
            </div>
            <p className="mt-4 font-mono text-[10px] leading-relaxed" style={{ color: 'var(--ad-muted)' }}>
              {CHAIN_MODE === 'chain'
                ? 'ENFORCED BY POLICYENGINE.SOL ON BASE SEPOLIA — CANSPEND() IS AN ETH_CALL YOUR x402 SERVER MUST PASS'
                : 'ENFORCED BY LOCAL POLICY ENGINE — SET CONTRACT ADDRESSES FOR ON-CHAIN MODE'}
            </p>
          </div>

          <div className="flex gap-3 pt-3">
            <button type="button" onClick={() => setPage('agents')} className="btn-ghost flex-1">
              Cancel
            </button>
            <button type="submit" disabled={busy || writing || confirming || !form.name.trim()} className="btn-primary flex-1 whitespace-nowrap">
              {busy || writing || confirming ? (
                <><Spinner size={14} /> {confirming ? 'Confirming…' : 'Confirm in wallet…'}</>
              ) : (
                <><IconAgent size={14} /> {CHAIN_MODE === 'chain' ? 'Deploy on Base' : 'Deploy Agent'}</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
