'use client';

/**
 * VersionModal.tsx (v5 schema, M2.0 stub)
 *
 * Lists historical versions for the active project and lets the user
 * jump to any one. Auto-save (M1.6) is the writer; this modal is read-only.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import * as pclient from '../../lib/persistence/client';
import type { RefmProjectVersionListItem } from '../../lib/persistence/types';

interface VersionModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  onLoadVersion: (versionId: string) => void;
}

export default function VersionModal({
  open,
  onClose,
  projectId,
  onLoadVersion,
}: VersionModalProps): React.JSX.Element | null {
  const [versions, setVersions] = useState<RefmProjectVersionListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    void (async () => {
      const res = await pclient.listVersions(projectId);
      if (cancelled) return;
      if (res.error) setError(res.error);
      setVersions(res.data?.versions ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="version-modal"
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
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius)',
          padding: 'var(--sp-3)',
          maxWidth: 600,
          width: '90vw',
          maxHeight: '80vh',
          overflow: 'auto',
        }}
      >
        <h3 style={{ marginTop: 0 }}>Version history</h3>
        {error && <div style={{ color: 'var(--color-warning)' }}>{error}</div>}
        {versions.length === 0 && <div style={{ color: 'var(--color-meta)' }}>No versions yet.</div>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {versions.map((v) => (
            <li
              key={v.id}
              data-testid={`version-${v.id}`}
              style={{
                padding: 'var(--sp-1)',
                borderBottom: '1px solid var(--color-border)',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>
                <strong>{v.label || 'Auto-save'}</strong>{' '}
                <span style={{ color: 'var(--color-meta)', fontSize: 'var(--font-small)' }}>
                  {new Date(v.created_at).toLocaleString()}
                </span>
              </span>
              <button type="button" onClick={() => onLoadVersion(v.id)} data-testid={`version-${v.id}-load`}>
                Load
              </button>
            </li>
          ))}
        </ul>
        <div style={{ textAlign: 'right', marginTop: 'var(--sp-2)' }}>
          <button type="button" onClick={onClose} data-testid="version-modal-close">
            Close
          </button>
        </div>
      </div>
    </div>
  );
  return createPortal(content, document.body);
}
