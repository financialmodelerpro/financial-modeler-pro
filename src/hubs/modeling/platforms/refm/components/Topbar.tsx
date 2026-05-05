'use client';

/**
 * Topbar.tsx (v5 schema, M2.0 stub)
 *
 * Minimal top bar with project name + action buttons.
 */

import React from 'react';
import type { Role } from '@/src/core/types/settings.types';
import type { StorageProject } from './RealEstatePlatform';

interface TopbarProps {
  activeProjectId: string | null;
  activeProject: StorageProject | null;
  onOpenProject: () => void;
  onOpenVersion: () => void;
  onOpenExport: () => void;
  onOpenRbac: () => void;
  onCloseProject: () => void;
  currentUserRole: Role;
}

export default function Topbar({
  activeProjectId,
  activeProject,
  onOpenProject,
  onOpenVersion,
  onOpenExport,
  onOpenRbac,
  onCloseProject,
  currentUserRole,
}: TopbarProps): React.JSX.Element {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--sp-1) var(--sp-2)',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
      }}
      data-testid="topbar"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--font-small)' }}>
        <strong>{activeProject?.name ?? 'No project'}</strong>
        {activeProject && <span style={{ color: 'var(--color-meta)' }}>{activeProject.location || ''}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button type="button" onClick={onOpenProject} style={btnStyle} data-testid="topbar-open-project">
          Projects
        </button>
        <button type="button" onClick={onOpenVersion} style={btnStyle} disabled={!activeProjectId} data-testid="topbar-open-version">
          Versions
        </button>
        <button type="button" onClick={onOpenExport} style={btnStyle} data-testid="topbar-open-export">
          Export
        </button>
        <button type="button" onClick={onOpenRbac} style={btnStyle} data-testid="topbar-open-rbac">
          {currentUserRole}
        </button>
        {activeProjectId && (
          <button type="button" onClick={onCloseProject} style={btnStyle} data-testid="topbar-close-project">
            Close
          </button>
        )}
      </div>
    </header>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 'var(--font-small)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
};
