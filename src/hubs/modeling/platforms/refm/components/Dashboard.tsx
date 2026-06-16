'use client';

/**
 * Dashboard.tsx (2026-06-16 rebuild)
 *
 * The all-projects HUB and the platform landing view. Project-AGNOSTIC: it does
 * NOT read the open-project store and is identical whether or not a project is
 * open. Distinct from Overview (the investor summary of the single open
 * project, in Overview.tsx).
 *
 * Sections: portfolio stat tiles (counts across all projects), recent activity
 * (recently updated projects), and the projects list (open / create). Deeper
 * cross-project financial roll-up is the Portfolio module's territory; the
 * per-project summaries here carry no computed financials.
 */

import React from 'react';
import type { PermissionMap } from '@/src/core/types/settings.types';
import type { StorageShape, StorageProject } from './RealEstatePlatform';

interface DashboardProps {
  storage: StorageShape;
  activeProjectId: string | null;
  activeVersionId: string | null;
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
  onSelectModule: (m: string) => void;
  onSelectTab: (t: string) => void;
  onSaveVersion: () => void;
  onLoadVersion: (projectId: string, versionId: string) => void;
  can: (permission: keyof PermissionMap) => boolean;
}

// ── Relative-time helper ───────────────────────────────────────────────────
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon} month${mon === 1 ? '' : 's'} ago`;
  const yr = Math.floor(day / 365);
  return `${yr} year${yr === 1 ? '' : 's'} ago`;
}

const STATUS_COLOR: Record<StorageProject['status'], { bg: string; fg: string }> = {
  Draft:       { bg: 'color-mix(in srgb, var(--color-meta) 14%, transparent)',    fg: 'var(--color-meta)' },
  Active:      { bg: 'color-mix(in srgb, var(--color-success) 16%, transparent)', fg: 'var(--color-success)' },
  'IC Review': { bg: 'color-mix(in srgb, var(--color-navy) 14%, transparent)',    fg: 'var(--color-navy)' },
  Approved:    { bg: 'color-mix(in srgb, var(--color-primary) 14%, transparent)', fg: 'var(--color-primary, #1d4ed8)' },
  Archived:    { bg: 'color-mix(in srgb, var(--color-warning) 16%, transparent)', fg: 'var(--color-warning)' },
};

function StatusBadge({ status }: { status: StorageProject['status'] }): React.JSX.Element {
  const c = STATUS_COLOR[status] ?? STATUS_COLOR.Draft;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20, background: c.bg, color: c.fg }}>
      {status}
    </span>
  );
}

const card: React.CSSProperties = { border: '1px solid var(--color-border)', borderRadius: 10, background: 'var(--color-surface, #fff)' };
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-meta)', margin: '0 0 10px' };

function StatTile({ label, value }: { label: string; value: string | number }): React.JSX.Element {
  return (
    <div style={{ ...card, padding: 'var(--sp-2)' }}>
      <div style={{ fontSize: 11, color: 'var(--color-meta)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-heading)', lineHeight: 1 }}>{value}</div>
    </div>
  );
}

export default function Dashboard({
  storage,
  onCreateProject,
  onSelectProject,
}: DashboardProps): React.JSX.Element {
  const projects = Object.entries(storage.projects).map(([id, p]) => ({ id, ...p }));
  const total = projects.length;
  const byStatus = (s: StorageProject['status']): number => projects.filter((p) => p.status === s).length;
  const totalVersions = projects.reduce((acc, p) => acc + (p.versionCount ?? 0), 0);
  const recent = [...projects]
    .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
    .slice(0, 5);

  return (
    <div style={{ padding: 'var(--sp-3)', width: '100%' }} data-testid="dashboard">
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 'var(--sp-3)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--font-h1)', fontWeight: 800, color: 'var(--color-heading)', margin: 0, letterSpacing: '-0.02em' }}>Dashboard</h1>
          <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-small)', marginTop: 6, marginBottom: 0 }}>
            All your projects. Open one to unlock its modules and Overview.
          </p>
        </div>
        <button type="button" onClick={onCreateProject} className="btn-primary" style={{ padding: 'var(--sp-1) var(--sp-2)' }} data-testid="dashboard-create">
          + New Project
        </button>
      </div>

      {total === 0 ? (
        <div style={{ ...card, padding: 'var(--sp-4)', textAlign: 'center', border: '1px dashed var(--color-border)' }} data-testid="dashboard-empty">
          <div style={{ fontSize: '2.5rem', marginBottom: 'var(--sp-1)' }}>🏗️</div>
          <div style={{ fontWeight: 700, color: 'var(--color-heading)', marginBottom: 6 }}>No projects yet</div>
          <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)', marginBottom: 'var(--sp-2)' }}>
            Create your first model to get started.
          </div>
          <button type="button" onClick={onCreateProject} className="btn-primary" style={{ padding: 'var(--sp-1) var(--sp-2)' }}>+ New Project</button>
        </div>
      ) : (
        <>
          {/* ── Portfolio stats ── */}
          <div style={sectionTitle}>Portfolio</div>
          <div style={{ display: 'grid', gap: 'var(--sp-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 'var(--sp-3)' }}>
            <StatTile label="Projects" value={total} />
            <StatTile label="Active" value={byStatus('Active')} />
            <StatTile label="Draft" value={byStatus('Draft')} />
            <StatTile label="Approved" value={byStatus('Approved')} />
            <StatTile label="Saved versions" value={totalVersions} />
          </div>

          {/* ── Recent activity ── */}
          <div style={sectionTitle}>Recent activity</div>
          <div style={{ ...card, marginBottom: 'var(--sp-3)' }} data-testid="dashboard-recent">
            {recent.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectProject(p.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 14px', background: 'transparent', border: 'none', borderTop: i === 0 ? 'none' : '1px solid var(--color-border)', cursor: 'pointer' }}
              >
                <span style={{ fontWeight: 600, color: 'var(--color-heading)', fontSize: 13 }}>{p.name}</span>
                <StatusBadge status={p.status} />
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: 'var(--color-meta)' }}>{relativeTime(p.lastModified)}</span>
              </button>
            ))}
          </div>

          {/* ── Projects list ── */}
          <div style={sectionTitle}>All projects</div>
          <div style={{ display: 'grid', gap: 'var(--sp-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }} data-testid="dashboard-projects">
            {projects.map((p) => (
              <div key={p.id} style={{ ...card, padding: 'var(--sp-2)', display: 'flex', flexDirection: 'column', gap: 8 }} data-testid={`dashboard-project-${p.id}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, color: 'var(--color-heading)', fontSize: 14, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <StatusBadge status={p.status} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-meta)' }}>
                  {p.location || 'No location'}{p.assetMix.length > 0 ? ` · ${p.assetMix.slice(0, 3).join(', ')}` : ''}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--color-meta)', flex: 1 }}>
                    {(p.versionCount ?? 0)} version{(p.versionCount ?? 0) === 1 ? '' : 's'} · {relativeTime(p.lastModified)}
                  </span>
                  <button type="button" onClick={() => onSelectProject(p.id)} className="btn-secondary" style={{ padding: '4px 12px', fontSize: 12 }} data-testid={`dashboard-open-${p.id}`}>
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
