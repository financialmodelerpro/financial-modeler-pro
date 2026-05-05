'use client';

/**
 * ExportModal.tsx (v5 schema, M2.0 stub)
 *
 * Excel + PDF export entry point. Real export pipelines (lib/export/*)
 * still consume the legacy v3/v4 hierarchy; M2.0 ships them as no-op
 * stubs that surface a "rebuilding in M2.1" message.
 */

import React from 'react';
import { createPortal } from 'react-dom';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
}

export default function ExportModal({ open, onClose }: ExportModalProps): React.JSX.Element | null {
  if (!open) return null;
  if (typeof document === 'undefined') return null;
  const content = (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="export-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius)', padding: 'var(--sp-3)', maxWidth: 480, width: '90vw' }}
      >
        <h3 style={{ marginTop: 0 }}>Export</h3>
        <div style={{ color: 'var(--color-meta)', marginBottom: 'var(--sp-2)' }}>
          Excel + PDF exports are being rebuilt against the v5 schema.
          They return in M2.1 once Modules 2-5 supply revenue / opex /
          returns / statements outputs to feed them.
        </div>
        <div style={{ textAlign: 'right' }}>
          <button type="button" onClick={onClose} data-testid="export-modal-close">
            Close
          </button>
        </div>
      </div>
    </div>
  );
  return createPortal(content, document.body);
}
