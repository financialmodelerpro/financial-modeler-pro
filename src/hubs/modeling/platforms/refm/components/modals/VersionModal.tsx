'use client';

import React, { useState } from 'react';
import type { StorageShape } from '../RealEstatePlatform';

interface VersionModalProps {
  storageData: StorageShape;
  activeProjectId: string | null;
  activeVersionId: string | null;
  onSave: (versionName: string) => void;
  onLoad: (pid: string, vid: string) => void;
  onClose: () => void;
}

export default function VersionModal({
  storageData, activeProjectId, activeVersionId,
  onSave, onLoad, onClose,
}: VersionModalProps) {
  const [versionName, setVersionName] = useState('');
  const [tab, setTab] = useState<'save' | 'history'>('save');

  const proj = activeProjectId ? storageData.projects[activeProjectId] : null;
  const versions = proj ? Object.entries(proj.versions || {}) : [];

  const handleSave = () => {
    const name = versionName.trim() || `Version ${versions.length + 1}`;
    onSave(name);
    onClose();
  };

  return (
    <div className="pm-modal-overlay" onClick={onClose}>
      <div className="pm-modal" onClick={e => e.stopPropagation()}>
        <div className="pm-modal-header">
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700 }}>📌 Version Management</div>
            <div style={{ fontSize: '11px', color: 'color-mix(in srgb, var(--color-on-primary-navy) 50%, transparent)', marginTop: '2px' }}>
              {proj?.name ?? 'No project selected'}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'color-mix(in srgb, var(--color-on-primary-navy) 10%, transparent)', border: 'none', borderRadius: '6px',
              width: '28px', height: '28px', cursor: 'pointer', color: 'var(--color-on-primary-navy)', fontSize: '14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-row-alt)',
        }}>
          {(['save', 'history'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, padding: '10px', border: 'none',
                borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
                background: 'none', cursor: 'pointer',
                fontWeight: tab === t ? 'var(--fw-semibold)' : 'var(--fw-normal)',
                color: tab === t ? 'var(--color-primary)' : 'var(--color-meta)',
                fontSize: 'var(--font-body)', fontFamily: 'Inter, sans-serif',
              }}
            >
              {t === 'save' ? '💾 Save Version' : `📋 History (${versions.length})`}
            </button>
          ))}
        </div>

        <div className="pm-modal-body">
          {!activeProjectId ? (
            <div className="alert-info">
              No project selected. Create or select a project first.
            </div>
          ) : tab === 'save' ? (
            <div>
              <div style={{ marginBottom: 'var(--sp-2)' }}>
                <label style={{
                  display: 'block', fontSize: 'var(--font-meta)', fontWeight: 'var(--fw-semibold)',
                  color: 'var(--color-body)', marginBottom: '6px',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  Version Name
                </label>
                <input
                  autoFocus
                  type="text"
                  value={versionName}
                  onChange={e => setVersionName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose(); }}
                  placeholder={`Version ${versions.length + 1} (default)`}
                  style={{
                    width: '100%', boxSizing: 'border-box',
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

              <div style={{
                background: 'var(--color-green-light)', border: '1px solid var(--color-green)',
                borderRadius: 'var(--radius-sm)', padding: '10px 12px',
                fontSize: '12px', color: 'var(--color-green-dark)',
              }}>
                ✓ The current model state (all inputs) will be saved as a snapshot.
                You can restore it at any time from version history.
              </div>
            </div>
          ) : (
            <div>
              {versions.length === 0 ? (
                <div className="state-empty">
                  No saved versions yet. Save a version to start tracking changes.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[...versions].reverse().map(([vid, ver]) => {
                    const isActive = vid === activeVersionId;
                    return (
                      <div
                        key={vid}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                          border: isActive ? '1px solid color-mix(in srgb, var(--color-success) 40%, transparent)' : '1px solid var(--color-border)',
                          background: isActive ? 'color-mix(in srgb, var(--color-success) 6%, transparent)' : 'transparent',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--color-heading)', fontSize: 'var(--font-body)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {ver.name}
                            {isActive && (
                              <span style={{
                                fontSize: '9px', fontWeight: 700, padding: '1px 7px',
                                borderRadius: '20px', background: 'color-mix(in srgb, var(--color-success) 15%, transparent)', color: 'var(--color-success)',
                              }}>LOADED</span>
                            )}
                          </div>
                          <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-muted)' }}>
                            {new Date(ver.createdAt).toLocaleString()}
                          </div>
                        </div>
                        {!isActive && activeProjectId && (
                          <button
                            className="btn-secondary"
                            style={{ fontSize: '12px', padding: '5px 12px' }}
                            onClick={() => {
                              onLoad(activeProjectId, vid);
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
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          {tab === 'save' && activeProjectId && (
            <button className="btn-primary" onClick={handleSave}>
              💾 Save Version
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
