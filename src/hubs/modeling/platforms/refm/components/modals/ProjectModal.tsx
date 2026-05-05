'use client';

/**
 * ProjectModal.tsx (v5 schema, M2.0 stub)
 *
 * Quick-pick modal for opening an existing project from the topbar.
 * Full edit / rename / delete flows live in ProjectsScreen.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import type { StorageShape } from '../RealEstatePlatform';

interface ProjectModalProps {
  open: boolean;
  onClose: () => void;
  storage: StorageShape;
  onSelectProject: (id: string) => void;
}

export default function ProjectModal({
  open,
  onClose,
  storage,
  onSelectProject,
}: ProjectModalProps): React.JSX.Element | null {
  if (!open) return null;
  if (typeof document === 'undefined') return null;
  const projects = Object.entries(storage.projects);
  const content = (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="project-modal"
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
        <h3 style={{ marginTop: 0 }}>Open Project</h3>
        {projects.length === 0 && <div style={{ color: 'var(--color-meta)' }}>No projects yet.</div>}
        {projects.map(([id, p]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              onSelectProject(id);
              onClose();
            }}
            data-testid={`project-modal-${id}`}
            style={{
              display: 'block',
              width: '100%',
              padding: 'var(--sp-2)',
              marginBottom: 6,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              background: storage.activeProjectId === id ? 'var(--color-navy-pale)' : 'var(--color-bg)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <strong>{p.name}</strong> · <span style={{ color: 'var(--color-meta)' }}>{p.status}</span>
          </button>
        ))}
        <div style={{ textAlign: 'right', marginTop: 'var(--sp-2)' }}>
          <button type="button" onClick={onClose} data-testid="project-modal-close">
            Close
          </button>
        </div>
      </div>
    </div>
  );
  return createPortal(content, document.body);
}
