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

import React, { useState } from 'react';
import PortfolioSummary from './PortfolioSummary';
import type { PermissionMap } from '@/src/core/types/settings.types';
import type { StorageShape, StorageProject } from './RealEstatePlatform';
import {
  PROJECT_STATUSES, groupProjectCards, reorderWithinGroup, type ProjectStatus,
} from '@/src/shared/admin/projectStatus';

interface DashboardProps {
  storage: StorageShape;
  activeProjectId: string | null;
  activeVersionId: string | null;
  onCreateProject: () => void;
  onSelectProject: (id: string) => void;
  /** Absent in read-only grace, which hides the Delete control entirely
   *  rather than accepting a click and discarding it. */
  onDeleteProject?: (id: string) => void;
  /** PER CARD, because a role is per project. Without this the Delete link
   *  rendered on every card and a Reviewer got a 404 from the server, which
   *  was right; the screen was not. */
  canDeleteCard?: (id: string) => boolean;
  /** An Editor cannot delete but may ASK an admin (mig 238). */
  canRequestDeleteCard?: (id: string) => boolean;
  /** The open or declined delete request on a card, if any. A LOOKUP rather
   *  than a field, because these cards are built from local storage and this
   *  state lives on the server list. */
  deleteRequestFor?: (id: string) => { status: 'pending' | 'declined'; declineReason: string | null } | null;
  onRequestDelete?: (id: string) => void;
  /** Archive / unarchive. Absent in read-only grace (the control is withheld
   *  rather than accepting a click and discarding it). */
  onArchiveProject?: (id: string, archived: boolean) => void;
  /** Set the lifecycle status from the card, without opening the project.
   *  Absent in read-only grace, like every other mutating control here. */
  onSetProjectStatus?: (id: string, status: ProjectStatus) => void;
  /** Toggle the urgent flag. */
  onSetProjectPriority?: (id: string, priority: boolean) => void;
  /** Persist a manual order. Receives the WHOLE group's new positions, not a
   *  single moved card: a dense reassignment cannot drift out of step with
   *  what the user sees, whereas patching one card leaves the rest to be
   *  inferred identically on both sides, which is where orders diverge. */
  onReorderProjects?: (order: Array<{ id: string; sortOrder: number }>) => void;
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

// Status -> brand accent + badge tint. LOCKED PALETTE ONLY: every value here
// is an existing token (navy / green / gold / grey / negative). Live states
// carry colour and terminal states go quiet, so the page reads at a glance
// without the reader knowing the group order by heart.
const STATUS_META: Record<ProjectStatus, { accent: string; bg: string; fg: string }> = {
  Construction: { accent: 'var(--color-gold)',       bg: 'var(--color-gold-light)',  fg: 'var(--color-gold-dark)' },
  Operation:    { accent: 'var(--color-green)',      bg: 'var(--color-green-light)', fg: 'var(--color-green-dark)' },
  Funded:       { accent: 'var(--color-navy)',       bg: 'var(--color-navy-light)',  fg: 'var(--color-navy)' },
  Draft:        { accent: 'var(--color-grey-light)', bg: 'var(--color-grey-pale)',   fg: 'var(--color-grey-mid)' },
  Completed:    { accent: 'var(--color-navy-mid)',   bg: 'var(--color-navy-pale)',   fg: 'var(--color-navy-dark)' },
  Closed:       { accent: 'var(--color-grey-mid)',   bg: 'var(--color-grey-pale)',   fg: 'var(--color-grey-dark)' },
  Dropped:      { accent: 'var(--color-negative)',   bg: 'var(--color-grey-pale)',   fg: 'var(--color-negative)' },
};

// What each group heading says, so the order is explained on the page rather
// than learned. The group order itself is NOT restated here: it comes from
// STATUS_GROUP_ORDER via groupProjectCards.
const STATUS_HINT: Record<ProjectStatus, string> = {
  Construction: 'Building now',
  Operation:    'Operating and earning',
  Funded:       'Capital committed, not yet on site',
  Draft:        'Not started',
  Completed:    'Delivered',
  Closed:       'Wound up',
  Dropped:      'Not proceeding',
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
  canDeleteCard,
  canRequestDeleteCard,
  deleteRequestFor,
  onRequestDelete,
  onArchiveProject,
  onSetProjectStatus,
  onSetProjectPriority,
  onReorderProjects,
}: DashboardProps): React.JSX.Element {
  // The card currently being dragged, and the card it is hovering over. Held
  // as state rather than in a ref so the drop target renders its insertion
  // hint; cleared on dragend, which fires even when the drop is cancelled or
  // happens outside a target, so no listener is left armed.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
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

          {/* ── Projects, grouped by status ──
              Ordering is NOT done here. `groupProjectCards` applies the one
              shared rule (status group, then priority within the group, then
              manual order within the group, then recency) so the server, this
              grid and the verifier cannot disagree. Sorting by last-modified
              alone is what made any write reorder the page. */}
          <div style={sectionLabel}>All projects</div>
          {groupProjectCards(projects).map((group) => {
            const gm = STATUS_META[group.status];
            const groupIds = group.cards.map((c) => c.id);
            // Reordering is WITHIN A GROUP ONLY: a drop is ignored unless both
            // cards are in this group, so a card can never change status by
            // being dragged. Status is set from the dropdown, deliberately.
            const canDrag = !!onReorderProjects && group.cards.length > 1;
            const moveTo = (movedId: string, toIndex: number): void => {
              if (!onReorderProjects) return;
              onReorderProjects(reorderWithinGroup(groupIds, movedId, toIndex));
            };
            const dropOn = (targetId: string): void => {
              if (!dragId || dragId === targetId) return;
              if (!groupIds.includes(dragId)) return; // a different group: ignore
              moveTo(dragId, groupIds.indexOf(targetId));
            };
            return (
            <div key={group.status} data-testid={`dashboard-group-${group.status}`} style={{ marginBottom: 'var(--sp-3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 var(--sp-2)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: gm.accent, flexShrink: 0 }} />
                <span style={{ fontSize: 'var(--font-meta)', fontWeight: 700, color: 'var(--color-heading)' }}>{group.status}</span>
                <span style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>{STATUS_HINT[group.status]}</span>
                <span style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>· {group.cards.length}</span>
              </div>
          <div style={{ display: 'grid', gap: 'var(--sp-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }} data-testid="dashboard-projects">
            {group.cards.map((p, idx) => {
              const m = STATUS_META[p.status] ?? STATUS_META.Draft;
              // Six chips before the overflow marker (was four, which made a
              // four-asset project read as "+4" on a 300px card).
              const tags = p.assetMix.slice(0, 6);
              const hidden = p.assetMix.slice(tags.length);
              const isArchived = p.archived === true;
              const isUrgent = p.priority === true;
              const isDragging = dragId === p.id;
              const isOver = overId === p.id && dragId !== null && dragId !== p.id && groupIds.includes(dragId);
              return (
                <div
                  key={p.id}
                  className="card"
                  draggable={canDrag}
                  onDragStart={canDrag ? (e) => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
                  onDragOver={canDrag ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverId(p.id); } : undefined}
                  onDragLeave={canDrag ? () => setOverId((cur) => (cur === p.id ? null : cur)) : undefined}
                  onDrop={canDrag ? (e) => { e.preventDefault(); dropOn(p.id); setDragId(null); setOverId(null); } : undefined}
                  onDragEnd={canDrag ? () => { setDragId(null); setOverId(null); } : undefined}
                  style={{
                    overflow: 'hidden', display: 'flex', flexDirection: 'column',
                    opacity: isDragging ? 0.45 : 1,
                    outline: isOver ? '2px solid var(--color-gold)' : 'none',
                    outlineOffset: isOver ? '-2px' : undefined,
                  }}
                  data-testid={`dashboard-project-${p.id}`}
                >
                  {/* The URGENT rail replaces the status accent when a project
                      is flagged, so the flag is visible without opening or
                      reading the card. */}
                  <div style={{ height: 4, background: isUrgent ? 'var(--color-negative)' : m.accent }} />
                  <div style={{ padding: 'var(--sp-3)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {canDrag && (
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`Reorder ${p.name} within ${group.status}. Use the arrow keys.`}
                          title="Drag to reorder within this status, or focus and use the arrow keys"
                          data-testid={`dashboard-drag-${p.id}`}
                          // Keyboard reordering, because a drag-only control is
                          // unusable without a mouse. Same one shared function
                          // the drop path calls, so the two cannot disagree.
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveTo(p.id, Math.max(0, idx - 1)); }
                            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveTo(p.id, Math.min(groupIds.length - 1, idx + 1)); }
                          }}
                          style={{ cursor: 'grab', color: 'var(--color-meta)', fontSize: 'var(--font-meta)', lineHeight: 1, userSelect: 'none', flexShrink: 0 }}
                        >
                          ⠿
                        </span>
                      )}
                      {isUrgent && (
                        <span
                          title="Flagged urgent"
                          data-testid={`dashboard-urgent-${p.id}`}
                          style={{ fontSize: 'var(--font-micro)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 'var(--radius-pill)', background: 'var(--color-warning-bg)', color: 'var(--color-negative)', flexShrink: 0 }}
                        >
                          Urgent
                        </span>
                      )}
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
                      {/* ── Status + urgent, set from the card ──
                          Both are BLOCKED while a project is archived, because
                          an archived project is view-only and the PATCH route
                          rejects a metadata edit on one with a 403. The control
                          is disabled and says why, rather than accepting a
                          click and silently discarding it (which is what a
                          plain enabled control would do here). */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--sp-1)' }}>
                        {onSetProjectStatus && (
                          <select
                            value={p.status}
                            disabled={isArchived}
                            onChange={(e) => onSetProjectStatus(p.id, e.target.value as ProjectStatus)}
                            title={isArchived
                              ? 'This project is archived and view-only. Unarchive it to change its status.'
                              : 'Set the project status. A label only: it does not archive, delete, or unlock anything.'}
                            data-testid={`dashboard-status-${p.id}`}
                            style={{
                              padding: '5px 8px', fontSize: 'var(--font-micro)', fontWeight: 600,
                              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
                              background: isArchived ? 'var(--color-grey-pale)' : 'var(--color-grey-white)',
                              color: isArchived ? 'var(--color-meta)' : 'var(--color-heading)',
                              cursor: isArchived ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        )}
                        {onSetProjectPriority && (
                          <button
                            type="button"
                            disabled={isArchived}
                            aria-pressed={isUrgent}
                            onClick={() => onSetProjectPriority(p.id, !isUrgent)}
                            title={isArchived
                              ? 'This project is archived and view-only. Unarchive it to flag it.'
                              : isUrgent
                                ? 'Remove the urgent flag'
                                : 'Flag this project urgent. It sorts to the top of its status group.'}
                            data-testid={`dashboard-priority-${p.id}`}
                            style={{
                              padding: '5px 10px', fontSize: 'var(--font-micro)', fontWeight: 700,
                              border: `1px solid ${isUrgent ? 'var(--color-negative)' : 'var(--color-border)'}`,
                              borderRadius: 'var(--radius-sm)',
                              background: isUrgent ? 'var(--color-warning-bg)' : 'var(--color-grey-white)',
                              color: isArchived ? 'var(--color-meta)' : isUrgent ? 'var(--color-negative)' : 'var(--color-heading)',
                              cursor: isArchived ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {isUrgent ? '★ Urgent' : '☆ Urgent'}
                          </button>
                        )}
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
                        {/* THE STATE OF A REQUEST WINS over any control: a
                            project already waiting on an admin must not offer
                            the button that got it there. This is also the only
                            way a requester learns the outcome, since nothing
                            notifies them. */}
                        {deleteRequestFor?.(p.id)?.status === 'pending' && (
                          <span
                            data-testid={`dashboard-delete-pending-${p.id}`}
                            title="An admin has been asked to delete this project."
                            style={{ padding: '6px 10px', fontSize: 'var(--font-micro)', fontWeight: 700, color: 'var(--color-warning, #92400e)' }}
                          >
                            Delete requested, awaiting approval
                          </span>
                        )}
                        {deleteRequestFor?.(p.id)?.status === 'declined' && (
                          <span
                            data-testid={`dashboard-delete-declined-${p.id}`}
                            title={deleteRequestFor?.(p.id)?.declineReason ?? undefined}
                            style={{ padding: '6px 10px', fontSize: 'var(--font-micro)', fontWeight: 700, color: 'var(--color-danger, #dc2626)' }}
                          >
                            Delete declined{deleteRequestFor?.(p.id)?.declineReason ? `: ${deleteRequestFor?.(p.id)?.declineReason}` : ''}
                          </span>
                        )}
                        {onRequestDelete && !deleteRequestFor?.(p.id) && canRequestDeleteCard?.(p.id) && (
                          <button
                            type="button"
                            onClick={() => onRequestDelete(p.id)}
                            title="You cannot delete this project yourself. This asks an admin to do it."
                            data-testid={`dashboard-request-delete-${p.id}`}
                            style={{ padding: '6px 10px', fontSize: 'var(--font-micro)', fontWeight: 600, border: 'none', background: 'transparent', color: 'var(--color-meta)', textDecoration: 'underline', cursor: 'pointer' }}
                          >
                            Request delete
                          </button>
                        )}
                        {onDeleteProject && !deleteRequestFor?.(p.id) && (canDeleteCard?.(p.id) ?? true) && (
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
            </div>
            );
          })}
        </>
      )}
    </div>
  );
}
