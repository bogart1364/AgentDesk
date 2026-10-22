import React from 'react';
import { IconAlert, IconCheck } from './Icons.jsx';

export function StatCard({ label, value, sub, accent = false, tag }) {
  return (
    <div className="panel p-4 sm:p-5 min-w-0" style={accent ? { borderColor: 'rgba(11,19,250,0.5)', boxShadow: '0 0 24px rgba(11,19,250,0.12)' } : undefined}>
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <span className="section-tag truncate">{tag || label}</span>
      </div>
      <div className="stat-value truncate" style={accent ? { color: 'var(--ad-blue-l)' } : undefined}>
        {value}
      </div>
      {sub && (
        <div className="mt-2 font-mono text-[10px] tracking-wide truncate" style={{ color: 'var(--ad-muted)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ status }) {
  const map = {
    active: { color: '#34d399', bg: 'rgba(52,211,153,0.08)', border: 'rgba(52,211,153,0.25)', label: 'Active' },
    paused: { color: '#fbbf24', bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.25)', label: 'Paused' },
    revoked: { color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.25)', label: 'Revoked' },
  };
  const s = map[status] || map.active;
  return (
    <span className="badge" style={{ color: s.color, background: s.bg, borderColor: s.border }}>
      <span className="dot" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}

export function Progress({ pct, color }) {
  const clamped = Math.min(100, Math.max(0, pct || 0));
  return (
    <div className="track">
      <div
        className="track-fill"
        style={{ width: `${clamped}%`, background: color || 'var(--ad-blue)' }}
      />
    </div>
  );
}

export function EmptyState({ title, sub, action, icon }) {
  return (
    <div className="panel-plain p-14 text-center">
      <div className="mx-auto mb-5 w-12 h-12 flex items-center justify-center rounded" style={{ background: 'rgba(11,19,250,0.08)', border: '1px solid rgba(11,19,250,0.2)', color: 'var(--ad-blue-l)' }}>
        {icon}
      </div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--ad-muted)' }}>
        {sub}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }) {
  return (
    <div
      className="flex items-start gap-3 px-5 py-4 rounded mb-6"
      style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}
    >
      <IconAlert size={18} className="text-red-400 mt-0.5 shrink-0" />
      <div className="flex-1 text-sm text-red-200">{message}</div>
      {onDismiss && (
        <button onClick={onDismiss} className="text-red-400/60 hover:text-red-300 text-xs font-mono">
          DISMISS
        </button>
      )}
    </div>
  );
}

export function SuccessBanner({ message }) {
  return (
    <div
      className="flex items-center gap-3 px-5 py-4 rounded mb-6"
      style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.25)' }}
    >
      <IconCheck size={18} className="text-emerald-400" />
      <div className="text-sm text-emerald-200">{message}</div>
    </div>
  );
}

export function SectionHeader({ tag, title, right }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6 sm:mb-8">
      <div className="min-w-0">
        <div className="section-tag mb-2 sm:mb-3">{tag}</div>
        <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{title}</h1>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function Field({ label, error, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className={error ? 'input-error-wrap' : ''}>{children}</div>
      {error && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px]" style={{ color: '#f87171' }}>
          <IconAlert size={12} /> {error}
        </div>
      )}
    </div>
  );
}

export function Spinner({ size = 16 }) {
  return (
    <span
      className="inline-block rounded-full animate-spin"
      style={{
        width: size,
        height: size,
        border: '2px solid rgba(255,255,255,0.2)',
        borderTopColor: '#fff',
      }}
    />
  );
}
