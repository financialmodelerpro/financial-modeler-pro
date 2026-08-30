'use client';

/**
 * Dashboard.tsx (2026-06-16 rebuild; visual design pass 2026-06-16b)
 *
 * The all-projects HUB and the platform landing view. Project-AGNOSTIC: it does
 * NOT read the open-project store and is identical whether or not a project is
 * open. Distinct from Overview (the investor summary of the single open
 * project, in Overview.tsx).
 *
 * Styling matches the platform design system (navy / gold palette, kpi-card
 * pattern, section labels, card hover-lift). Portfolio KPIs + project cards use
 * the per-project SUMMARY fields that are loaded here (status, market, asset
 * mix, versions, last edited). Cross-project FINANCIAL roll-up (aggregate GDV /
 * dev cost / funding, per-card IRR) is intentionally NOT shown: those require
 * loading + computing every project's snapshot, which is a data/logic step the
 * "visual only" scope of this pass excludes. That belongs with the Portfolio
 * module.
 */

import React from 'react';
import PortfolioSummary from './PortfolioSummary';
import type { PermissionMap } from '@/src/core/types/settings.types';
import type { StorageShape, StorageProject } from './RealEstatePlatform';

interface DashboardProps {
  storage: StorageShape;
  activeProjectId: string | null;
  activeVersionId: string | null;
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
  /** Absent in read-only grace, which hides the Delete control entirely
   *  rather than accepting a click and discarding it. */
  onDeleteProject?: (id: string) => void;
  /** Archive / unarchive. Absent in read-only grace (the control is withheld
   *  rather than accepting a click and discarding it). */
  onArchiveProject?: (id: string, archived: boolean) => void;
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

// Status -> brand accent + badge tint (navy / green / gold from the palette).
const STATUS_META: Record<StorageProject['status'], { accent: string; bg: string; fg: string }> = {
  Draft:       { accent: 'var(--color-grey-light)', bg: 'var(--color-grey-pale)',   fg: 'var(--color-grey-mid)' },
  Active:      { accent: 'var(--color-green)',       bg: 'var(--color-green-light)', fg: 'var(--color-green-dark)' },
  'IC Review': { accent: 'var(--color-gold)',        bg: 'var(--color-gold-light)',  fg: 'var(--color-gold-dark)' },
  Approved:    { accent: 'var(--color-navy)',        bg: 'var(--color-navy-light)',  fg: 'var(--color-navy)' },
};

function StatusBadge({ status }: { status: StorageProject['status'] }): React.JSX.Element {
  const m = STATUS_META[status] ?? STATUS_META.Draft;
  return (
    <span style={{ fontSize: 'var(--font-micro)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: m.bg, color: m.fg }}>
      {status}
    </span>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 'var(--font-micro)', fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--color-meta)', margin: '0 0 var(--sp-2)',
};

export default function Dashboard({
  storage,
  onCreateProject,
  onSelectProject,
  onDeleteProject,
  onArchiveProject,
}: DashboardProps): React.JSX.Element {
  // Confirmation lives in DeleteProjectModal, rendered once by the parent:
  // the dialog states the version count, the recovery window and who can
  // restore it, none of which a window.confirm could say honestly.
  const projects = Object.entries(storage.projects).map(([id, p]) => ({ id, ...p }));
  const total = projects.length;
  const markets = new Set(projects.map((p) => (p.location || '').trim()).filter(Boolean)).size;
  const recent = [...projects]
    .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
    .slice(0, 5);

  return (
    <div style={{ padding: 'var(--sp-3)', width: '100%' }} data-testid="dashboard">
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 'var(--sp-3)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--font-h1)', fontWeight: 700, color: 'var(--color-heading)', margin: 0, letterSpacing: '-0.02em' }}>Portfolio Dashboard</h1>
          <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-meta)', marginTop: 6, marginBottom: 0 }}>
            Your project portfolio. Open a project to unlock its modules and Overview.
          </p>
        </div>
        <button type="button" onClick={onCreateProject} className="btn-primary" style={{ padding: 'var(--sp-1) var(--sp-3)', fontWeight: 700 }} data-testid="dashboard-create">
          + New Project
        </button>
      </div>

      {total === 0 ? (
        <div className="card" style={{ padding: 'var(--sp-5)', textAlign: 'center', border: '1px dashed var(--color-border)', background: 'var(--color-navy-pale)' }} data-testid="dashboard-empty">
          <div style={{ fontSize: '2.75rem', marginBottom: 'var(--sp-1)' }}>🏗️</div>
          <div style={{ fontWeight: 700, fontSize: 'var(--font-section)', color: 'var(--color-heading)', marginBottom: 6 }}>Start your first model</div>
          <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)', marginBottom: 'var(--sp-3)', maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
            Create a project to build its feasibility model, then return here to compare your whole portfolio at a glance.
          </div>
          <button type="button" onClick={onCreateProject} className="btn-primary" style={{ padding: 'var(--sp-1) var(--sp-3)', fontWeight: 700 }}>+ New Project</button>
        </div>
      ) : (
        <>
          {/* ── Portfolio figures ──────────────────────────────────────────
              The five count tiles are gone. Three of them (Active / In Review /
              Approved) counted a workflow status NOTHING in the product ever
              sets, so they were permanently zero, and the other two were counts
              rather than insight. Real money now, from the engine, per
              currency, base case, archived excluded. Projects and Markets
              survive as the small secondary counts inside PortfolioSummary. */}
          <div style={sectionLabel}>Portfolio</div>
          <div style={{ marginBottom: 'var(--sp-3)' }}>
            <PortfolioSummary projectCount={total} markets={markets} />
          </div>

          {/* ── Recent activity ── */}
          <div style={sectionLabel}>Recent activity</div>
          <div className="card" style={{ marginBottom: 'var(--sp-3)', overflow: 'hidden' }} data-testid="dashboard-recent">
            {recent.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectProject(p.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '11px 16px', background: 'transparent', border: 'none', borderTop: i === 0 ? 'none' : '1px solid var(--color-border-light)', cursor: 'pointer' }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: (STATUS_META[p.status] ?? STATUS_META.Draft).accent, flexShrink: 0 }} />
                <span style={{ fontWeight: 600, color: 'var(--color-heading)', fontSize: 'var(--font-body)' }}>{p.name}</span>
                <StatusBadge status={p.status} />
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>{relativeTime(p.lastModified)}</span>
              </button>
            ))}
          </div>

          {/* ── Projects ── */}
          <div style={sectionLabel}>All projects</div>
          <div style={{ display: 'grid', gap: 'var(--sp-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }} data-testid="dashboard-projects">
            {projects.map((p) => {
              const m = STATUS_META[p.status] ?? STATUS_META.Draft;
              // Six chips before the overflow marker (was four, which made a
              // four-asset project read as "+4" on a 300px card).
              const tags = p.assetMix.slice(0, 6);
              const hidden = p.assetMix.slice(tags.length);
              const isArchived = p.archived === true;
              return (
                <div key={p.id} className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }} data-testid={`dashboard-project-${p.id}`}>
                  <div style={{ height: 4, background: m.accent }} />
                  <div style={{ padding: 'var(--sp-3)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, color: 'var(--color-heading)', fontSize: 'var(--font-body)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>📍</span>{p.location || 'No market set'}
                    </div>
                    {tags.length > 0 && (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 2 }}>
                        {tags.map((t) => (
                          <span key={t} style={{ fontSize: 'var(--font-micro)', color: 'var(--color-navy)', background: 'var(--color-navy-light)', padding: '2px 8px', borderRadius: 'var(--radius-pill)' }}>{t}</span>
                        ))}
                        {hidden.length > 0 && (
                          <span title={hidden.join(', ')} style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)', cursor: 'help' }}>
                            +{hidden.length} more
                          </span>
                        )}
                      </div>
                    )}
                    <div style={{ flex: 1 }} />
                    <div style={{ marginTop: 'var(--sp-1)', paddingTop: 'var(--sp-2)', borderTop: '1px solid var(--color-border-light)' }}>
                      <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)', marginBottom: 'var(--sp-1)' }}>
                        {(p.versionCount ?? 0)} version{(p.versionCount ?? 0) === 1 ? '' : 's'} · {relativeTime(p.lastModified)}
                        {isArchived && ' · archived (view-only)'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {/* Archive is the SAFE shelf and reads first: reversible,
                            view-only, frees a project slot, never expires. Delete
                            follows it, deliberately quieter. */}
                        {onArchiveProject && (
                          <button
                            type="button"
                            onClick={() => onArchiveProject(p.id, !isArchived)}
                            title={isArchived
                              ? 'Return this project to your active list'
                              : 'Shelve this project: view-only, frees a project slot, reversible at any time'}
                            data-testid={`dashboard-archive-${p.id}`}
                            style={{ padding: '6px 12px', fontSize: 'var(--font-meta)', fontWeight: 600, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-grey-white)', color: 'var(--color-heading)', cursor: 'pointer' }}
                          >
                            {isArchived ? 'Unarchive' : 'Archive'}
                          </button>
                        )}
                        {onDeleteProject && (
                          <button
                            type="button"
                            onClick={() => onDeleteProject(p.id)}
                            title="Delete project (recoverable for a limited time, then permanent)"
                            data-testid={`dashboard-delete-${p.id}`}
                            style={{ padding: '6px 10px', fontSize: 'var(--font-micro)', fontWeight: 600, border: 'none', background: 'transparent', color: 'var(--color-meta)', textDecoration: 'underline', cursor: 'pointer' }}
                          >
                            Delete
                          </button>
                        )}
                        <div style={{ flex: 1 }} />
                        <button type="button" onClick={() => onSelectProject(p.id)} className="btn-primary" style={{ padding: '6px 18px', fontSize: 'var(--font-meta)', fontWeight: 700 }} data-testid={`dashboard-open-${p.id}`}>
                          Open
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
