'use client';

/**
 * Dashboard.tsx (v5 schema, M2.0 stub)
 *
 * Minimal home view: a project list grid with create button. The
 * legacy multi-KPI dashboard was tied to the v3/v4 area-cascade
 * outputs that are gone. Returns to a clean home in M2.1+.
 */

import React from 'react';
import type { StorageShape } from './RealEstatePlatform';
import { MODULES } from '../lib/modules-config';

interface DashboardProps {
  storage: StorageShape;
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
  onSelectModule: (m: string) => void;
}

export default function Dashboard({
  storage,
  onCreateProject,
  onSelectProject,
  onSelectModule,
}: DashboardProps): React.JSX.Element {
  const projects = Object.entries(storage.projects);
  return (
    <div data-testid="dashboard">
      <h2 style={{ marginTop: 0 }}>Dashboard</h2>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)' }}>
          {projects.length} project{projects.length === 1 ? '' : 's'}
        </div>
        <button
          type="button"
          onClick={onCreateProject}
          className="btn-primary"
          style={{ padding: 'var(--sp-1) var(--sp-2)' }}
          data-testid="dashboard-create"
        >
          + New Project
        </button>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 'var(--sp-2)',
        }}
      >
        {projects.map(([id, p]) => (
          <button
            key={id}
            type="button"
            onClick={() => onSelectProject(id)}
            data-testid={`dashboard-project-${id}`}
            style={{
              textAlign: 'left',
              padding: 'var(--sp-2)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              cursor: 'pointer',
            }}
          >
            <strong>{p.name}</strong>
            <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)' }}>
              {p.location || 'No location'} • {p.status}
            </div>
            <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)', marginTop: 6 }}>
              Updated {new Date(p.lastModified).toLocaleDateString()}
            </div>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 'var(--sp-4)' }}>
        <h3>Modules</h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 'var(--sp-1)',
            fontSize: 'var(--font-small)',
          }}
        >
          {MODULES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => onSelectModule(m.key)}
              disabled={m.disabled}
              style={{
                padding: 'var(--sp-1)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                cursor: m.disabled ? 'not-allowed' : 'pointer',
                opacity: m.disabled ? 0.6 : 1,
                textAlign: 'left',
              }}
            >
              {m.icon} Module {m.num}: {m.shortLabel}
              {m.status === 'soon' && (
                <span style={{ marginLeft: 6, color: 'var(--color-meta)', fontSize: 'var(--font-micro)' }}>
                  SOON
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
