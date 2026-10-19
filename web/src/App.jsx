import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar.jsx';
import ConnectPanel from './components/ConnectPanel.jsx';
import Landing from './pages/Landing.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Agents from './pages/Agents.jsx';
import AgentDetail from './pages/AgentDetail.jsx';
import CreateAgent from './pages/CreateAgent.jsx';
import Feed from './pages/Feed.jsx';
import { useAuth, authFetch } from './auth.jsx';
import { IconCheck, IconAlert } from './components/Icons.jsx';
import { CHAIN_MODE, PRIVY_ENABLED } from './wagmi.js';

export default function App() {
  const auth = useAuth();
  const [page, setPage] = useState('landing');
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [me, setMe] = useState(null);
  const [agents, setAgents] = useState([]);
  const [feed, setFeed] = useState([]);
  const [health, setHealth] = useState(null);
  const [toast, setToast] = useState(null);
  const [apiError, setApiError] = useState(null);

  // hard gate: console only after sign-in
  const authed = auth.authed;
  const address = auth.authAddress || auth.address;

  const refresh = useCallback(async () => {
    if (!authed || !address) return;
    try {
      const [meData, agentsData, feedData, h] = await Promise.all([
        authFetch(`/me?address=${address}`),
        authFetch(`/agents?address=${address}`),
        authFetch('/feed?limit=40'),
        authFetch('/health'),
      ]);
      setMe(meData);
      setAgents(Array.isArray(agentsData) ? agentsData : agentsData.agents || []);
      setFeed(feedData);
      setHealth(h);
      setApiError(null);
    } catch (e) {
      console.error(e);
      setApiError(
        e.status === 0 || e.message?.includes('Failed to fetch')
          ? 'Cannot reach AgentDesk API.'
          : `API error: ${e.message}`
      );
    }
  }, [authed, address]);

  useEffect(() => {
    refresh();
    if (!authed) return;
    const t = setInterval(() => {
      authFetch('/feed?limit=40').then(setFeed).catch(() => {});
    }, 6000);
    return () => clearInterval(t);
  }, [refresh, authed]);

  const toastTimer = useRef(null);
  const showToast = useCallback((type, msg) => {
    const id = Date.now();
    setToast({ type, msg, id });
    // visible for exactly 3s, then dismissed (replaces any pending timer)
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToast((t) => (t && t.id === id ? null : t));
      toastTimer.current = null;
    }, 3000);
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const openAgent = (id) => {
    setSelectedAgent(id);
    setPage('agent-detail');
  };

  // ── Landing (public) ──
  if (page === 'landing') {
    return (
      <>
        <Landing auth={auth} onStart={() => (auth.authed ? setPage('dashboard') : null)} />
        {toast && <Toast toast={toast} />}
      </>
    );
  }

  // ── Console gate: require auth ──
  if (!authed) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bp-grid p-6"
        style={{ background: 'var(--ad-ink)' }}
      >
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="section-tag justify-center mb-3" style={{ display: 'inline-flex' }}>
              AgentDesk Console
            </div>
            <h1 className="text-2xl font-bold text-white">Authentication required</h1>
            <p className="mt-2 text-sm" style={{ color: 'var(--ad-muted)' }}>
              {PRIVY_ENABLED
                ? 'Sign in with email, social, or wallet to access the control plane.'
                : 'Sign in with your wallet to access the control plane.'}
            </p>
          </div>
          <ConnectPanel auth={auth} onStart={() => setPage('dashboard')} />
          <button
            onClick={() => setPage('landing')}
            className="mt-6 mx-auto block font-mono text-[10px] tracking-wider hover:text-white transition-colors"
            style={{ color: 'var(--ad-muted)' }}
          >
            BACK TO HOME
          </button>
        </div>
        {toast && <Toast toast={toast} />}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--ad-ink)' }}>
      <Sidebar
        page={page}
        setPage={setPage}
        me={me}
        agents={agents}
        openAgent={openAgent}
        health={health}
        auth={auth}
      />

      <div className="flex-1 ml-64 flex flex-col min-h-screen">
        <main className="flex-1 p-8 overflow-y-auto bp-grid">
          <div className="max-w-6xl mx-auto">
            {/* mode banner: chain vs local */}
            {health && (
              <div
                className="flex items-center gap-3 px-4 py-2.5 rounded mb-6 font-mono text-[10px] tracking-wider"
                style={
                  health.mode === 'chain'
                    ? { background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.25)', color: '#34d399' }
                    : { background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.25)', color: '#fbbf24' }
                }
              >
                <span className="dot" style={{ background: health.mode === 'chain' ? '#34d399' : '#fbbf24' }} />
                {health.mode === 'chain'
                  ? `CHAIN MODE · BASE ${health.chainId} · REGISTRY ${String(health.contracts?.registry).slice(0, 10)}…`
                  : 'LOCAL DEMO MODE · SET AGENT_REGISTRY_ADDRESS + POLICY_ENGINE_ADDRESS FOR ON-CHAIN'}
              </div>
            )}

            {apiError && (
              <div
                className="flex items-center gap-3 px-5 py-4 rounded mb-6"
                style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}
              >
                <IconAlert size={16} className="text-red-400" />
                <span className="text-sm text-red-200 flex-1">{apiError}</span>
                <button onClick={refresh} className="font-mono text-[10px] text-red-400 hover:text-red-300 tracking-wider">
                  RETRY
                </button>
              </div>
            )}

            {page === 'dashboard' && (
              <Dashboard me={me} agents={agents} feed={feed} openAgent={openAgent} refresh={refresh} setPage={setPage} />
            )}
            {page === 'agents' && (
              <Agents agents={agents} openAgent={openAgent} setPage={setPage} refresh={refresh} />
            )}
            {page === 'agent-detail' && (
              <AgentDetail agentId={selectedAgent} onBack={() => setPage('agents')} refresh={refresh} showToast={showToast} />
            )}
            {page === 'create' && (
              <CreateAgent
                auth={auth}
                onCreated={(id) => {
                  refresh();
                  openAgent(id);
                  showToast('success', 'Agent deployed');
                }}
                setPage={setPage}
                showToast={showToast}
              />
            )}
            {page === 'feed' && <Feed feed={feed} refresh={refresh} />}
          </div>
        </main>
      </div>

      {toast && <Toast toast={toast} />}
    </div>
  );
}

function Toast({ toast }) {
  const isError = toast.type === 'error';
  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded animate-up"
      style={{
        background: 'var(--ad-panel)',
        border: `1px solid ${isError ? 'rgba(239,68,68,0.4)' : 'rgba(11,19,250,0.45)'}`,
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      }}
    >
      {isError ? (
        <IconAlert size={16} className="text-red-400" />
      ) : (
        <IconCheck size={16} style={{ color: 'var(--ad-blue-l)' }} />
      )}
      <span className="text-sm text-white">{toast.msg}</span>
    </div>
  );
}
