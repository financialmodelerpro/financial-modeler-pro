'use client';

/**
 * ProjectModal.tsx (M2.0b restored brand-styled project picker)
 *
 * Phase M2.0b (2026-05-06): brings back the FMP brand modal chrome
 * (pm-modal-overlay + pm-modal), navy-gradient header + close
 * button + search + per-project list with active highlight.
 *
 * Adapted to v5: still a project picker (the create/edit flow lives
 * in ProjectWizard + ProjectsScreen). Renders via createPortal to
 * document.body so the overlay clears any ancestor stacking-context.
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { StorageShape } from '../RealEstatePlatform';

interface ProjectModalProps {
  open: boolean;
  onClose: () => void;
  storage: StorageShape;
  onSelectProject: (id: string) => void;
  /** Archive frees an active slot; unarchive requires a free slot (cap). When
   *  absent, the archive controls are hidden (e.g. for plans without archive). */
  onArchiveProject?: (id: string, archived: boolean) => void;
  /** False for plans that cannot archive at all (trial). */
  archiveAllowed?: boolean;
}

export default function ProjectModal({
  open,
  onClose,
  storage,
  onSelectProject,
  onArchiveProject,
  archiveAllowed = true,
}: ProjectModalProps): React.JSX.Element | null {
  const [search, setSearch] = useState('');

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const projects = Object.entries(storage.projects);
  const filtered = projects.filter(([, p]) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.location ?? '').toLowerCase().includes(q);
  });

  const content = (
    <div className="pm-modal-overlay" onClick={onClose} data-testid="project-modal">
      <div className="pm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pm-modal-header">
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700 }}>🏗️ Open Project</div>
            <div
              style={{
                fontSize: '11px',
                color: 'color-mix(in srgb, var(--color-on-primary-navy) 50%, transparent)',
                marginTop: '2px',
              }}
            >
              Select a project to open, or create a new one from the dashboard
            </div>
          </div>
          <button
            onClick={onClose}
            data-testid="project-modal-close"
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

        <div className="pm-modal-body">
          <input
            autoFocus
            type="text"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="project-modal-search"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--font-body)',
              fontFamily: 'Inter, sans-serif',
              marginBottom: 'var(--sp-2)',
            }}
          />

          {filtered.length === 0 ? (
            <div className="state-empty" data-testid="project-modal-empty">
              {projects.length === 0
                ? 'No projects yet. Create one from the Dashboard.'
                : 'No projects match your search.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '50vh', overflow: 'auto' }}>
              {filtered.map(([id, p]) => {
                const isActive = storage.activeProjectId === id;
                const isArchived = p.archived === true;
                return (
                  <div
                    key={id}
                    data-testid={`project-modal-row-${id}`}
                    data-archived={isArchived ? 'true' : 'false'}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '10px 12px',
                      border: isActive
                        ? '1px solid color-mix(in srgb, var(--color-primary) 40%, transparent)'
                        : '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      background: isArchived
                        ? 'color-mix(in srgb, var(--color-muted) 8%, transparent)'
                        : isActive ? 'color-mix(in srgb, var(--color-primary) 6%, transparent)' : 'transparent',
                      opacity: isArchived ? 0.72 : 1,
                      fontFamily: 'Inter, sans-serif',
                    }}
                  >
                    <button
                      type="button"
                      data-testid={`project-modal-${id}`}
                      onClick={() => { onSelectProject(id); onClose(); }}
                      style={{ flex: 1, textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                    >
                      <div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--color-heading)', fontSize: 'var(--font-body)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {p.name}
                        {isArchived && (
                          <span data-testid={`project-viewonly-${id}`} style={{ fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: 'color-mix(in srgb, var(--color-muted) 20%, transparent)', color: 'var(--color-muted)' }}>
                            ARCHIVED · VIEW ONLY
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-muted)' }}>
                        {p.location || 'No location'} · {p.status}
                      </div>
                    </button>
                    {isActive && !isArchived && (
                      <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 7px', borderRadius: '20px', background: 'color-mix(in srgb, var(--color-success) 15%, transparent)', color: 'var(--color-success)' }}>
                        ACTIVE
                      </span>
                    )}
                    {onArchiveProject && (isArchived || archiveAllowed) && (
                      <button
                        type="button"
                        data-testid={`project-archive-toggle-${id}`}
                        onClick={() => onArchiveProject(id, !isArchived)}
                        title={isArchived ? 'Unarchive (uses an active slot)' : 'Archive (frees an active slot, makes view-only)'}
                        style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-heading)', cursor: 'pointer', flexShrink: 0 }}
                      >
                        {isArchived ? 'Unarchive' : 'Archive'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="pm-modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
