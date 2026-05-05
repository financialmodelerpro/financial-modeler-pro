'use client';

/**
 * VersionModal.tsx (M2.0b restored brand-styled version manager)
 *
 * Phase M2.0b (2026-05-06): brings back the FMP brand modal chrome
 * + tabbed Save / History layout. The slim M2.0 stub was history-
 * only.
 *
 * Adapted to v5: history reads from /api/refm/projects/{id}/versions
 * via pclient.listVersions; save fires via the onSave prop (the
 * v5-aware shell calls pclient.saveVersion with the current store
 * snapshot). Auto-save (M1.6) continues to write its own snapshots
 * in the background.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import * as pclient from '../../lib/persistence/client';
import type { RefmProjectVersionListItem } from '../../lib/persistence/types';

interface VersionModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  projectName?: string | null;
  activeVersionId?: string | null;
  onSave?: (versionName: string) => void;
  onLoadVersion: (versionId: string) => void;
}

export default function VersionModal({
  open,
  onClose,
  projectId,
  projectName,
  activeVersionId,
  onSave,
  onLoadVersion,
}: VersionModalProps): React.JSX.Element | null {
  const [versions, setVersions] = useState<RefmProjectVersionListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [versionName, setVersionName] = useState('');
  const [tab, setTab] = useState<'save' | 'history'>(onSave ? 'save' : 'history');

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

  const handleSave = (): void => {
    if (!onSave) return;
    const name = versionName.trim() || `Version ${versions.length + 1}`;
    onSave(name);
    setVersionName('');
    onClose();
  };

  const content = (
    <div className="pm-modal-overlay" onClick={onClose} data-testid="version-modal">
      <div className="pm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pm-modal-header">
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700 }}>📌 Version Management</div>
            <div
              style={{
                fontSize: '11px',
                color: 'color-mix(in srgb, var(--color-on-primary-navy) 50%, transparent)',
                marginTop: '2px',
              }}
            >
              {projectName ?? 'No project selected'}
            </div>
          </div>
          <button
            onClick={onClose}
            data-testid="version-modal-close"
            style={{
              background: 'color-mix(in srgb, var(--color-on-primary-navy) 10%, transparent)',
              border: 'none',
              borderRadius: '6px',
              width: '28px',
              height: '28px',
              cursor: 'pointer',
              color: 'var(--color-on-primary-navy)',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-row-alt)',
          }}
        >
          {(['save', 'history'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              data-testid={`version-tab-${t}`}
              disabled={t === 'save' && !onSave}
              style={{
                flex: 1,
                padding: '10px',
                border: 'none',
                borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
                background: 'none',
                cursor: t === 'save' && !onSave ? 'not-allowed' : 'pointer',
                fontWeight: tab === t ? 'var(--fw-semibold)' : 'var(--fw-normal)',
                color: tab === t ? 'var(--color-primary)' : 'var(--color-meta)',
                fontSize: 'var(--font-body)',
                fontFamily: 'Inter, sans-serif',
                opacity: t === 'save' && !onSave ? 0.5 : 1,
              }}
            >
              {t === 'save' ? 'Save Version' : `History (${versions.length})`}
            </button>
          ))}
        </div>

        <div className="pm-modal-body">
          {error && (
            <div className="alert-info" style={{ marginBottom: 'var(--sp-2)' }}>
              {error}
            </div>
          )}

          {!projectId ? (
            <div className="alert-info">No project selected. Create or select a project first.</div>
          ) : tab === 'save' && onSave ? (
            <div>
              <div style={{ marginBottom: 'var(--sp-2)' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 'var(--font-meta)',
                    fontWeight: 'var(--fw-semibold)',
                    color: 'var(--color-body)',
                    marginBottom: '6px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Version Name
                </label>
                <input
                  autoFocus
                  type="text"
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave();
                    if (e.key === 'Escape') onClose();
                  }}
                  placeholder={`Version ${versions.length + 1} (default)`}
                  data-testid="version-modal-name-input"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 12px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--font-body)',
                    fontFamily: 'Inter, sans-serif',
                  }}
                />
                <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginTop: '4px' }}>
                  Leave blank to auto-name as &quot;Version {versions.length + 1}&quot;
                </div>
              </div>

              <div
                style={{
                  background: 'var(--color-green-light)',
                  border: '1px solid var(--color-green)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 12px',
                  fontSize: '12px',
                  color: 'var(--color-green-dark)',
                }}
              >
                ✓ The current model state (all v5 inputs) will be saved as a snapshot. You can restore
                it at any time from version history.
              </div>
            </div>
          ) : (
            <div>
              {versions.length === 0 ? (
                <div className="state-empty" data-testid="version-modal-empty">
                  No saved versions yet. Save a version to start tracking changes.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {versions.map((v) => {
                    const isActive = v.id === activeVersionId;
                    return (
                      <div
                        key={v.id}
                        data-testid={`version-${v.id}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: isActive
                            ? '1px solid color-mix(in srgb, var(--color-success) 40%, transparent)'
                            : '1px solid var(--color-border)',
                          background: isActive
                            ? 'color-mix(in srgb, var(--color-success) 6%, transparent)'
                            : 'transparent',
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontWeight: 'var(--fw-semibold)',
                              color: 'var(--color-heading)',
                              fontSize: 'var(--font-body)',
                              marginBottom: '2px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                          >
                            {v.label || 'Auto-save'}
                            {isActive && (
                              <span
                                style={{
                                  fontSize: '9px',
                                  fontWeight: 700,
                                  padding: '1px 7px',
                                  borderRadius: '20px',
                                  background: 'color-mix(in srgb, var(--color-success) 15%, transparent)',
                                  color: 'var(--color-success)',
                                }}
                              >
                                LOADED
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-muted)' }}>
                            {new Date(v.created_at).toLocaleString()}
                          </div>
                        </div>
                        {!isActive && (
                          <button
                            className="btn-secondary"
                            data-testid={`version-${v.id}-load`}
                            style={{ fontSize: '12px', padding: '5px 12px' }}
                            onClick={() => {
                              onLoadVersion(v.id);
                              onClose();
                            }}
                          >
                            Load
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="pm-modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {tab === 'save' && projectId && onSave && (
            <button className="btn-primary" onClick={handleSave} data-testid="version-modal-save">
              Save Version
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
