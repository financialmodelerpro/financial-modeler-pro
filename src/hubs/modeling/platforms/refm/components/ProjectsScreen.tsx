'use client';

/**
 * ProjectsScreen.tsx (v5 schema, M2.0 stub)
 *
 * Project list with create + open + close actions.
 */

import React from 'react';
import type { StorageShape } from './RealEstatePlatform';

interface ProjectsScreenProps {
  storage: StorageShape;
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
  onCloseProject: () => void;
}

export default function ProjectsScreen({
  storage,
  onCreateProject,
  onSelectProject,
  onCloseProject,
}: ProjectsScreenProps): React.JSX.Element {
  const projects = Object.entries(storage.projects);
  return (
    <div data-testid="projects-screen">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <h2 style={{ margin: 0 }}>Projects</h2>
        <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
          <button
            type="button"
            onClick={onCreateProject}
            className="btn-primary"
            style={{ padding: 'var(--sp-1) var(--sp-2)' }}
            data-testid="projects-create"
          >
            + New Project
          </button>
          {storage.activeProjectId && (
            <button
              type="button"
              onClick={onCloseProject}
              style={{ padding: 'var(--sp-1) var(--sp-2)', border: '1px solid var(--color-border)', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)' }}
              data-testid="projects-close-active"
            >
              Close active
            </button>
          )}
        </div>
      </div>
      {projects.length === 0 && (
        <div style={{ padding: 'var(--sp-3)', textAlign: 'center', color: 'var(--color-meta)' }} data-testid="projects-empty">
          No projects yet. Click <strong>+ New Project</strong> to start.
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--color-grey-pale)' }}>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }}>Name</th>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }}>Location</th>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }}>Status</th>
            <th style={{ textAlign: 'left', padding: 'var(--sp-1)' }}>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {projects.map(([id, p]) => (
            <tr key={id} data-testid={`projects-row-${id}`} style={{ borderTop: '1px solid var(--color-border)' }}>
              <td style={{ padding: 'var(--sp-1)' }}>{p.name}</td>
              <td style={{ padding: 'var(--sp-1)' }}>{p.location || '-'}</td>
              <td style={{ padding: 'var(--sp-1)' }}>{p.status}</td>
              <td style={{ padding: 'var(--sp-1)' }}>{new Date(p.lastModified).toLocaleDateString()}</td>
              <td style={{ padding: 'var(--sp-1)', textAlign: 'right' }}>
                <button
                  type="button"
                  onClick={() => onSelectProject(id)}
                  data-testid={`projects-open-${id}`}
                  className="btn-primary"
                  style={{ padding: '2px 8px', fontSize: 'var(--font-small)' }}
                >
                  Open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
