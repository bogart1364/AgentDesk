export const fmtUsd = (micro) => {
  if (micro == null) return '—';
  const n = Number(micro) / 1e6;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
};

export const short = (addr, n = 6) =>
  addr ? `${addr.slice(0, n)}…${addr.slice(-4)}` : '—';

export const timeAgo = (ts) => {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
