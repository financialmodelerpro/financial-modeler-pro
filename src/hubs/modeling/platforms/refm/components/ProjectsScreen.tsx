'use client';

/**
 * ProjectsScreen.tsx (M2.0b restored brand-styled projects list)
 *
 * Phase M2.0b (2026-05-06): brings back the FMP brand projects
 * surface, search + filter + status pills + per-project card layout
 * with Open / Edit / Delete actions.
 *
 * Adapted to v5: edit / delete handlers wired via props from the
 * v5-aware shell. Active-project highlight reads activeProjectId
 * from props.
 */

import React, { useState } from 'react';
import type { PermissionMap } from '@/src/core/types/settings.types';
import type { StorageShape } from './RealEstatePlatform';

interface ProjectsScreenProps {
  storage: StorageShape;
  activeProjectId: string | null;
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
  onCloseProject: () => void;
  onEditProject?: (id: string) => void;
  onDeleteProject?: (id: string) => void;
  setActiveModule: (m: string) => void;
  can: (permission: keyof PermissionMap) => boolean;
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  Draft: {
    bg: 'color-mix(in srgb, var(--color-grey-mid) 12%, transparent)',
    color: 'var(--color-grey-mid)',
  },
  Active: {
    bg: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
    color: 'var(--color-success)',
  },
  'IC Review': {
    bg: 'color-mix(in srgb, var(--color-input-border) 12%, transparent)',
    color: 'var(--color-gold-dark)',
  },
  Approved: {
    bg: 'color-mix(in srgb, var(--color-primary) 12%, transparent)',
    color: 'var(--color-primary)',
  },
  Archived: {
    bg: 'color-mix(in srgb, var(--color-negative) 10%, transparent)',
    color: 'var(--color-negative)',
  },
};

export default function ProjectsScreen({
  storage,
  activeProjectId,
  onCreateProject,
  onSelectProject,
  onCloseProject,
  onEditProject,
  onDeleteProject,
  setActiveModule,
  can,
}: ProjectsScreenProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const projects = Object.entries(storage.projects);
  const filtered = projects.filter(([, p]) => {
    const matchSearch =
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.location?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || p.status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <div className="module-view" data-testid="projects-screen">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 'var(--font-h1)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-heading)',
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Projects
          </h1>
          <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-body)', marginTop: '4px' }}>
            {projects.length} project{projects.length !== 1 ? 's' : ''} in portfolio
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
          {can('canCreateProject') && (
            <button className="btn-primary" onClick={onCreateProject} data-testid="projects-create">
              + New Project
            </button>
          )}
          {activeProjectId && (
            <button
              type="button"
              onClick={onCloseProject}
              style={{
                padding: 'var(--sp-1) var(--sp-2)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-grey-white)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
              data-testid="projects-close-active"
            >
              Close active
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--sp-1)', marginBottom: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="projects-search"
          style={{
            padding: '8px 12px',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-body)',
            background: 'var(--color-surface)',
            flex: '1',
            minWidth: '200px',
          }}
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          data-testid="projects-filter-status"
          style={{
            padding: '8px 12px',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-body)',
            background: 'var(--color-surface)',
          }}
        >
          <option value="all">All Statuses</option>
          <option value="Draft">Draft</option>
          <option value="Active">Active</option>
          <option value="IC Review">IC Review</option>
          <option value="Approved">Approved</option>
          <option value="Archived">Archived</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="state-empty" data-testid="projects-empty">
          {projects.length === 0
            ? '📁 No projects yet. Create your first project to get started.'
            : '🔍 No projects match your search.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
          {filtered.map(([pid, proj]) => {
            const isActive = pid === activeProjectId;
            const statusStyle = STATUS_COLORS[proj.status] ?? STATUS_COLORS.Draft;
            const versionCount = proj.versionCount ?? Object.keys(proj.versions || {}).length;

            return (
              <div
                key={pid}
                className={`pm-project-card${isActive ? ' active-project' : ''}`}
                data-testid={`projects-card-${pid}`}
                onClick={() => {
                  onSelectProject(pid);
                  setActiveModule('overview');
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                    <span
                      style={{
                        fontSize: 'var(--font-body)',
                        fontWeight: 'var(--fw-semibold)',
                        color: 'var(--color-heading)',
                      }}
                    >
                      {proj.name}
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '20px',
                        background: statusStyle.bg,
                        color: statusStyle.color,
                      }}
                    >
                      {proj.status}
                    </span>
                    {isActive && (
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '20px',
                          background: 'color-mix(in srgb, var(--color-success) 15%, transparent)',
                          color: 'var(--color-success)',
                          border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)',
                        }}
                      >
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                    {proj.location && (
                      <span style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)' }}>
                        📍 {proj.location}
                      </span>
                    )}
                    <span style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)' }}>
                      📅 {new Date(proj.createdAt).toLocaleDateString()}
                    </span>
                    <span style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)' }}>
                      📌 {versionCount} version{versionCount !== 1 ? 's' : ''}
                    </span>
                    {proj.assetMix && proj.assetMix.length > 0 && (
                      <span style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)' }}>
                        🏢 {proj.assetMix.join(', ')}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: '12px', padding: '5px 12px' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectProject(pid);
                      setActiveModule('overview');
                    }}
                    data-testid={`projects-open-${pid}`}
                  >
                    Open
                  </button>
                  {can('canEditProject') && onEditProject && (
                    <button
                      className="btn-secondary"
                      style={{ fontSize: '12px', padding: '5px 10px' }}
                      title="Edit project name and location"
                      aria-label="Edit project name and location"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditProject(pid);
                      }}
                    >
                      ✏️
                    </button>
                  )}
                  {can('canDeleteProject') && onDeleteProject && (
                    <button
                      className="btn-danger"
                      style={{ fontSize: '12px', padding: '5px 10px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Delete "${proj.name}"? This cannot be undone.`)) {
                          onDeleteProject(pid);
                        }
                      }}
                    >
                      🗑
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
