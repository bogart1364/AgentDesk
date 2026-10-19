import React, { useEffect } from 'react';
import { IconX, IconAlert, IconCheck } from './Icons.jsx';

/**
 * Architectural modal — corner ticks, mono labels, ESC + overlay close.
 */
export default function Modal({ open, onClose, title, tag, children, footer, danger }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {/* header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b" style={{ borderColor: 'var(--ad-line)' }}>
          <div>
            {tag && <div className="section-tag mb-2" style={danger ? { color: '#f87171' } : undefined}>{tag}</div>}
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              {danger && <IconAlert size={18} className="text-red-400" />}
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded transition-colors hover:bg-white/5"
            style={{ color: 'var(--ad-muted)' }}
            aria-label="Close"
          >
            <IconX size={16} />
          </button>
        </div>

        {/* body */}
        <div className="px-6 py-5">{children}</div>

        {/* footer */}
        {footer && (
          <div
            className="px-6 py-4 border-t flex items-center justify-end gap-3"
            style={{ borderColor: 'var(--ad-line)', background: 'var(--ad-panel2)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmModal({ open, onClose, onConfirm, title, tag, message, confirmLabel, danger, busy }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      tag={tag}
      danger={danger}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost" disabled={busy}>Cancel</button>
          <button
            onClick={onConfirm}
            className={danger ? 'btn-danger' : 'btn-primary'}
            disabled={busy}
          >
            {busy ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processing…
              </>
            ) : (
              confirmLabel || 'Confirm'
            )}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed" style={{ color: 'var(--ad-muted)' }}>
        {message}
      </p>
    </Modal>
  );
}

export function InfoRow({ label, value, mono }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--ad-muted)' }}>
        {label}
      </span>
      <span className={`text-sm text-white ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  );
}
