'use client';

import React, { useState } from 'react';
import type { PermissionMap } from '@/src/core/types/settings.types';
import type { StorageShape } from './RealEstatePlatform';

interface ProjectsScreenProps {
  storageData: StorageShape;
  activeProjectId: string | null;
  onSelectProject: (pid: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (pid: string) => void;
  setActiveModule: (m: string) => void;
  can: (permission: keyof PermissionMap) => boolean;
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  'Draft':     { bg: 'rgba(107,114,128,0.12)', color: 'var(--color-grey-mid)' },
  'Active':    { bg: 'rgba(22,101,52,0.12)',   color: 'var(--color-green-dark)' },
  'IC Review': { bg: 'rgba(245,158,11,0.12)',  color: '#92400e' },
  'Approved':  { bg: 'rgba(30,58,138,0.12)',   color: 'var(--color-navy)' },
  'Archived':  { bg: 'rgba(153,27,27,0.1)',    color: 'var(--color-negative)' },
};

export default function ProjectsScreen({
  storageData, activeProjectId,
  onSelectProject, onCreateProject, onDeleteProject,
  setActiveModule, can,
}: ProjectsScreenProps) {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const projects = Object.entries(storageData.projects);
  const filtered = projects.filter(([, p]) => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase())
      || p.location?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || p.status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <div className="module-view">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
        <div>
          <h1 style={{
            fontSize: 'var(--font-h1)', fontWeight: 'var(--fw-bold)',
            color: 'var(--color-heading)', margin: 0, letterSpacing: '-0.02em',
          }}>Projects</h1>
          <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-body)', marginTop: '4px' }}>
            {projects.length} project{projects.length !== 1 ? 's' : ''} in portfolio
          </p>
        </div>
        {can('canCreateProject') && (
          <button className="btn-primary" onClick={onCreateProject}>
            + New Project
          </button>
        )}
      </div>

      {/* Search & Filter */}
      <div style={{ display: 'flex', gap: 'var(--sp-1)', marginBottom: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search projects..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '8px 12px', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-body)',
            background: 'var(--color-surface)', flex: '1', minWidth: '200px',
          }}
        />
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{
            padding: '8px 12px', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-body)',
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

      {/* Projects list */}
      {filtered.length === 0 ? (
        <div className="state-empty">
          {projects.length === 0
            ? '📁 No projects yet. Create your first project to get started.'
            : '🔍 No projects match your search.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
          {filtered.map(([pid, proj]) => {
            const isActive = pid === activeProjectId;
            const statusStyle = STATUS_COLORS[proj.status] ?? STATUS_COLORS['Draft'];
            const versionCount = Object.keys(proj.versions || {}).length;

            return (
              <div
                key={pid}
                className={`pm-project-card${isActive ? ' active-project' : ''}`}
                onClick={() => {
                  onSelectProject(pid);
                  setActiveModule('overview');
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                    <span style={{
                      fontSize: 'var(--font-body)', fontWeight: 'var(--fw-semibold)',
                      color: 'var(--color-heading)',
                    }}>
                      {proj.name}
                    </span>
                    <span style={{
                      fontSize: '10px', fontWeight: 700, padding: '2px 8px',
                      borderRadius: '20px',
                      background: statusStyle.bg, color: statusStyle.color,
                    }}>
                      {proj.status}
                    </span>
                    {isActive && (
                      <span style={{
                        fontSize: '10px', fontWeight: 700, padding: '2px 8px',
                        borderRadius: '20px',
                        background: 'rgba(22,101,52,0.15)', color: 'var(--color-green-dark)',
                        border: '1px solid rgba(22,101,52,0.3)',
                      }}>
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
                    onClick={e => {
                      e.stopPropagation();
                      onSelectProject(pid);
                      setActiveModule('overview');
                    }}
                  >
                    Open →
                  </button>
                  {can('canDeleteProject') && (
                    <button
                      className="btn-danger"
                      style={{ fontSize: '12px', padding: '5px 10px' }}
                      onClick={e => {
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
