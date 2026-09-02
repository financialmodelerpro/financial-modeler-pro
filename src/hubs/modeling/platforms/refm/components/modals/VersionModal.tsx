'use client';

/**
 * VersionModal.tsx (M2.0b restored brand-styled version manager)
 *
 * Phase M2.0b (2026-05-06): brings back the FMP brand modal chrome
 * + tabbed Save / History layout. The slim M2.0 stub was history-
 * only.
 *
 * Adapted to v5: history reads from /api/refm/projects/{id}/versions
 * via pclient.listVersions; save fires via the onSave prop (the
 * v5-aware shell calls pclient.saveVersion with the current store
 * snapshot). Auto-save (M1.6) continues to write its own snapshots
 * in the background.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import * as pclient from '../../lib/persistence/client';
import type { RefmProjectVersionListItem, ChangeLogEntryDTO, ProjectChangeDTO } from '../../lib/persistence/types';

interface VersionModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  projectName?: string | null;
  activeVersionId?: string | null;
  /** Opens the rich create flow (auto-name + Task + Comment). When omitted,
   *  the modal is history-only. Replaces the old generic "Version N" save. */
  onCreateVersion?: () => void;
  onLoadVersion: (versionId: string) => void;
  /** Tab to open on. Defaults to 'save' when create is available, else 'history'.
   *  The "edit a different version" flow forces 'history'. */
  initialTab?: 'save' | 'history' | 'activity';
  /** Label for the per-version action button (default 'Load'). The "edit a
   *  different version" flow passes 'Edit this version'. */
  loadActionLabel?: string;
}

export default function VersionModal({
  open,
  onClose,
  projectId,
  projectName,
  activeVersionId,
  onCreateVersion,
  onLoadVersion,
  initialTab,
  loadActionLabel,
}: VersionModalProps): React.JSX.Element | null {
  const [versions, setVersions] = useState<RefmProjectVersionListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'save' | 'history' | 'activity'>(initialTab ?? (onCreateVersion ? 'save' : 'history'));
  // ACTIVITY (Module 10 step 6): the append-only change log. Separate state
  // from `versions` because it is a different question: History asks what the
  // saved versions are, Activity asks who changed what and when.
  //
  // ONE piece of state, KEYED BY PROJECT, rather than a rows / available /
  // loading trio. Two reasons. A separate loading flag has to be set
  // synchronously in the effect body, which causes a cascading render; and
  // three independent flags can disagree, which is how a previous project's log
  // ends up on screen under a new project's heading. Loading is DERIVED: the
  // answer we hold is either for this project or it is not.
  //
  // `available: false` means this database has no change log (pre-234). It is
  // deliberately distinct from an EMPTY log, which is a real answer meaning
  // nothing has been recorded, and must never read as "unavailable".
  const [changesState, setChangesState] = useState<
    { key: string; rows: ProjectChangeDTO[]; available: boolean } | null
  >(null);
  const changesReady = changesState !== null && changesState.key === projectId;
  // Phase M-Versioning (2026-05-31): which version's change log is
  // currently expanded in the history list. null = none expanded.
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  // 2026-05-31 hotfix: histories grow large (legacy M1.6 auto-save
  // could produce 1000+ rows per project in a few days). Date filter
  // + label search make finding a specific historic version
  // tractable. Empty values mean "no filter".
  const [filterFrom, setFilterFrom] = useState<string>('');   // YYYY-MM-DD
  const [filterTo, setFilterTo]     = useState<string>('');   // YYYY-MM-DD
  const [labelSearch, setLabelSearch] = useState<string>('');
  const [maxToRender, setMaxToRender] = useState<number>(50); // progressive load

  // Initial tab is set from initialTab in useState; the parent keys this modal
  // on the pick intent, so switching to the "edit a different version" flow
  // remounts it on History without a resetting effect.
  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    void (async () => {
      const res = await pclient.listVersions(projectId);
      if (cancelled) return;
      if (res.error) setError(res.error);
      setVersions(res.data?.versions ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  // Loaded lazily, when the tab is actually opened: this is the largest read
  // in the modal and most opens never reach it. Re-runs on tab change rather
  // than caching, so a log opened twice in one session is current the second
  // time, which matters when someone else is editing.
  useEffect(() => {
    if (!open || !projectId || tab !== 'activity') return;
    let cancelled = false;
    void (async () => {
      const res = await pclient.listChanges(projectId);
      if (cancelled) return;
      if (res.error) setError(res.error);
      // Stamped with the project it answers for, so a slow response that lands
      // after the user has switched projects is ignored rather than rendered
      // under the wrong name.
      setChangesState({
        key: projectId,
        rows: res.data?.changes ?? [],
        available: res.data?.available ?? false,
      });
    })();
    return () => { cancelled = true; };
  }, [open, projectId, tab]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const handleCreate = (): void => {
    if (!onCreateVersion) return;
    onClose();
    onCreateVersion();
  };

  const content = (
    <div className="pm-modal-overlay" onClick={onClose} data-testid="version-modal">
      <div className="pm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pm-modal-header">
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700 }}>📌 Version Management</div>
            <div
              style={{
                fontSize: '11px',
                color: 'color-mix(in srgb, var(--color-on-primary-navy) 50%, transparent)',
                marginTop: '2px',
              }}
            >
              {projectName ?? 'No project selected'}
            </div>
          </div>
          <button
            onClick={onClose}
            data-testid="version-modal-close"
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

        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-row-alt)',
          }}
        >
          {(['save', 'history', 'activity'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              data-testid={`version-tab-${t}`}
              disabled={t === 'save' && !onCreateVersion}
              style={{
                flex: 1,
                padding: '10px',
                border: 'none',
                borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
                background: 'none',
                cursor: t === 'save' && !onCreateVersion ? 'not-allowed' : 'pointer',
                fontWeight: tab === t ? 'var(--fw-semibold)' : 'var(--fw-normal)',
                color: tab === t ? 'var(--color-primary)' : 'var(--color-meta)',
                fontSize: 'var(--font-body)',
                fontFamily: 'Inter, sans-serif',
                opacity: t === 'save' && !onCreateVersion ? 0.5 : 1,
              }}
            >
              {t === 'save' ? 'Save Version'
                : t === 'history' ? `History (${versions.length})`
                : 'Activity'}
            </button>
          ))}
        </div>

        <div className="pm-modal-body">
          {error && (
            <div className="alert-info" style={{ marginBottom: 'var(--sp-2)' }}>
              {error}
            </div>
          )}

          {!projectId ? (
            <div className="alert-info">No project selected. Create or select a project first.</div>
          ) : tab === 'save' && onCreateVersion ? (
            <div>
              <p style={{ fontSize: 'var(--font-small)', color: 'var(--color-body)', lineHeight: 1.5, marginBottom: 'var(--sp-2)' }}>
                Saving creates a named version of the current model state. The
                name is auto-generated as{' '}
                <span style={{ fontFamily: 'ui-monospace, monospace' }}>
                  {(projectName ?? 'Project')}_v1.x_MMDDYYYY_TaskName
                </span>{' '}
                and you add a short task name plus a comment describing what
                changed. You can restore any version later from the history.
              </p>
              <button
                type="button"
                className="btn-primary"
                onClick={handleCreate}
                data-testid="version-modal-create"
                style={{ width: '100%' }}
              >
                Create named version
              </button>

              <div
                style={{
                  background: 'var(--color-green-light)',
                  border: '1px solid var(--color-green)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 12px',
                  fontSize: '12px',
                  color: 'var(--color-green-dark)',
                  marginTop: 'var(--sp-2)',
                }}
              >
                ✓ The current model state (all v5 inputs) will be saved as a snapshot. You can restore
                it at any time from version history.
              </div>
            </div>
          ) : (
            <div>
              {versions.length === 0 ? (
                <div className="state-empty" data-testid="version-modal-empty">
                  No saved versions yet. Save a version to start tracking changes.
                </div>
              ) : (() => {
                // Apply the date + label filters to the version list,
                // then progressively reveal `maxToRender` rows so a
                // 1000+-row history doesn't lag the modal.
                const fromMs = filterFrom ? new Date(filterFrom + 'T00:00:00').getTime() : -Infinity;
                const toMs   = filterTo   ? new Date(filterTo   + 'T23:59:59').getTime() :  Infinity;
                const q      = labelSearch.trim().toLowerCase();
                const filtered = versions.filter((v) => {
                  const ts = new Date(v.created_at).getTime();
                  if (ts < fromMs || ts > toMs) return false;
                  if (q && !(v.label ?? '').toLowerCase().includes(q)) return false;
                  return true;
                });
                const visible = filtered.slice(0, maxToRender);
                const hiddenCount = filtered.length - visible.length;
                return (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        marginBottom: 10,
                        padding: '8px 10px',
                        background: 'var(--color-row-alt)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 12,
                      }}
                      data-testid="version-modal-filter-bar"
                    >
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        From
                        <input
                          type="date"
                          value={filterFrom}
                          onChange={(e) => setFilterFrom(e.target.value)}
                          data-testid="version-filter-from"
                          style={{
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '3px 6px',
                            fontSize: 12,
                          }}
                        />
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        To
                        <input
                          type="date"
                          value={filterTo}
                          onChange={(e) => setFilterTo(e.target.value)}
                          data-testid="version-filter-to"
                          style={{
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '3px 6px',
                            fontSize: 12,
                          }}
                        />
                      </label>
                      <input
                        type="text"
                        value={labelSearch}
                        onChange={(e) => setLabelSearch(e.target.value)}
                        placeholder="Search label..."
                        data-testid="version-filter-search"
                        style={{
                          flex: 1,
                          minWidth: 100,
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '3px 8px',
                          fontSize: 12,
                        }}
                      />
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setFilterFrom('');
                          setFilterTo('2026-05-29');
                          setLabelSearch('');
                          setMaxToRender(50);
                        }}
                        data-testid="version-filter-pre-may30"
                        style={{ fontSize: 11, padding: '3px 8px' }}
                        title="Show only versions saved on or before 2026-05-29 (pre-bug window)"
                      >
                        Pre-May 30
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setFilterFrom('');
                          setFilterTo('');
                          setLabelSearch('');
                          setMaxToRender(50);
                        }}
                        data-testid="version-filter-clear"
                        style={{ fontSize: 11, padding: '3px 8px' }}
                      >
                        Clear
                      </button>
                      <span style={{ color: 'var(--color-muted)', marginLeft: 'auto' }}>
                        {filtered.length === versions.length
                          ? `${versions.length} versions`
                          : `${filtered.length} of ${versions.length}`}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {filtered.length === 0 && (
                        <div
                          style={{
                            padding: '12px',
                            textAlign: 'center',
                            color: 'var(--color-muted)',
                            fontStyle: 'italic',
                            fontSize: 12,
                          }}
                        >
                          No versions match the current filter.
                        </div>
                      )}
                      {visible.map((v) => {
                    const isActive = v.id === activeVersionId;
                    const isExpanded = expandedVersionId === v.id;
                    const log = (v.change_log ?? []) as ChangeLogEntryDTO[];
                    const logCount = log.length;
                    return (
                      <div
                        key={v.id}
                        data-testid={`version-${v.id}`}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: isActive
                            ? '1px solid color-mix(in srgb, var(--color-success) 40%, transparent)'
                            : '1px solid var(--color-border)',
                          background: isActive
                            ? 'color-mix(in srgb, var(--color-success) 6%, transparent)'
                            : 'transparent',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontWeight: 'var(--fw-semibold)',
                                color: 'var(--color-heading)',
                                fontSize: 'var(--font-body)',
                                marginBottom: '2px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                              }}
                            >
                              {v.label || `Version ${v.version_number}`}
                              {isActive && (
                                <span
                                  style={{
                                    fontSize: '9px',
                                    fontWeight: 700,
                                    padding: '1px 7px',
                                    borderRadius: '20px',
                                    background: 'color-mix(in srgb, var(--color-success) 15%, transparent)',
                                    color: 'var(--color-success)',
                                  }}
                                >
                                  LOADED
                                </span>
                              )}
                              <span
                                style={{
                                  fontSize: '10px',
                                  color: 'var(--color-muted)',
                                  fontWeight: 'var(--fw-normal)',
                                }}
                              >
                                #{v.version_number}
                              </span>
                            </div>
                            {v.comment && (
                              <div
                                title={v.comment}
                                data-testid="version-comment"
                                style={{ fontSize: 'var(--font-meta)', color: 'var(--color-body)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '420px' }}
                              >
                                💬 {v.comment}
                              </div>
                            )}
                            <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-muted)' }}>
                              {new Date(v.created_at).toLocaleString()}
                              {/* WHO SAVED IT (mig 230). Rendered only when
                                  known: an unknown author shows nothing rather
                                  than "Unknown", which would add a word to
                                  every pre-230 row without adding a fact. */}
                              {(v as { author?: string | null }).author && (
                                <span data-testid="version-author">
                                  {' · '}
                                  {(v as { author?: string | null }).author}
                                </span>
                              )}
                              {logCount > 0 && (
                                <>
                                  {' · '}
                                  {logCount} {logCount === 1 ? 'change' : 'changes'}
                                </>
                              )}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              className="btn-secondary"
                              data-testid={`version-${v.id}-toggle-log`}
                              style={{ fontSize: '12px', padding: '5px 10px' }}
                              onClick={() => setExpandedVersionId(isExpanded ? null : v.id)}
                              disabled={logCount === 0 && !v.base_version_id}
                              title={
                                logCount === 0 && !v.base_version_id
                                  ? 'No change log (initial version)'
                                  : isExpanded
                                    ? 'Hide change log'
                                    : 'View change log'
                              }
                            >
                              {isExpanded ? 'Hide log' : `View log (${logCount})`}
                            </button>
                            {!isActive && (
                              <button
                                className="btn-secondary"
                                data-testid={`version-${v.id}-load`}
                                style={{ fontSize: '12px', padding: '5px 12px' }}
                                onClick={() => {
                                  onLoadVersion(v.id);
                                  onClose();
                                }}
                              >
                                {loadActionLabel ?? 'Load'}
                              </button>
                            )}
                          </div>
                        </div>
                        {isExpanded && (
                          <div style={{ marginTop: 10 }}>
                            <ChangeLogList entries={log} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                      {hiddenCount > 0 && (
                        <button
                          type="button"
                          className="btn-secondary"
                          data-testid="version-modal-load-more"
                          onClick={() => setMaxToRender((n) => n + 100)}
                          style={{ fontSize: 12, padding: '6px 12px', marginTop: 6 }}
                        >
                          Show {Math.min(100, hiddenCount)} more ({hiddenCount} remaining)
                        </button>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {tab === 'activity' && projectId && (
            <ActivityPanel
              changes={changesReady ? changesState.rows : []}
              available={changesReady ? changesState.available : undefined}
              loading={!changesReady}
              versions={versions}
            />
          )}
        </div>

        <div className="pm-modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {tab === 'save' && projectId && onCreateVersion && (
            <button className="btn-primary" onClick={handleCreate} data-testid="version-modal-save">
              Create named version
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

// ── Change log renderer ────────────────────────────────────────────────────
/**
 * Renders the list of ChangeLogEntry records stored on a version
 * row. Each entry shows path, kind, and before/after values. Long
 * value strings are truncated with a hover-revealable full text via
 * `title`. Empty arrays render the explicit "No changes recorded"
 * message rather than a blank block.
 */
function ChangeLogList({ entries }: { entries: ChangeLogEntryDTO[] }): React.JSX.Element {
  if (!entries || entries.length === 0) {
    return (
      <div
        style={{
          fontSize: '12px',
          color: 'var(--color-muted)',
          fontStyle: 'italic',
          padding: '8px 10px',
          background: 'var(--color-row-alt)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        No changes recorded for this version.
      </div>
    );
  }
  return (
    <div
      style={{
        background: 'var(--color-row-alt)',
        borderRadius: 'var(--radius-sm)',
        padding: '8px 10px',
        maxHeight: 240,
        overflowY: 'auto',
        fontSize: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
      data-testid="change-log-list"
    >
      {entries.map((entry, idx) => (
        <ChangeLogRow key={`${entry.path}-${idx}`} entry={entry} />
      ))}
    </div>
  );
}

function ChangeLogRow({ entry }: { entry: ChangeLogEntryDTO }): React.JSX.Element {
  const kindBadge =
    entry.kind === 'add' ? { label: 'Added', bg: '#d1fae5', fg: '#065f46' } :
    entry.kind === 'remove' ? { label: 'Removed', bg: '#fee2e2', fg: '#991b1b' } :
    { label: 'Updated', bg: '#e0f2fe', fg: '#0c4a6e' };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '70px 1fr',
        gap: 8,
        alignItems: 'baseline',
        padding: '4px 0',
        borderBottom: '1px dashed var(--color-border)',
      }}
    >
      <span
        style={{
          fontSize: '10px',
          fontWeight: 700,
          padding: '1px 6px',
          borderRadius: '20px',
          background: kindBadge.bg,
          color: kindBadge.fg,
          width: 'max-content',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {kindBadge.label}
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'monospace',
            color: 'var(--color-heading)',
            wordBreak: 'break-all',
          }}
        >
          {entry.label ?? entry.path}
        </div>
        {entry.kind === 'update' && (
          <div style={{ marginTop: 2, color: 'var(--color-muted)' }}>
            <ValueChip raw={entry.before} kind="before" />
            <span style={{ margin: '0 6px' }}>→</span>
            <ValueChip raw={entry.after} kind="after" />
          </div>
        )}
      </div>
    </div>
  );
}

function ValueChip({ raw, kind }: { raw: unknown; kind: 'before' | 'after' }): React.JSX.Element {
  const display = formatLogValue(raw);
  return (
    <span
      title={display.length > 60 ? display : undefined}
      style={{
        fontFamily: 'monospace',
        background: kind === 'before' ? '#fef3c7' : '#dcfce7',
        padding: '0 5px',
        borderRadius: 4,
        color: 'var(--color-heading)',
        maxWidth: 240,
        display: 'inline-block',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        verticalAlign: 'bottom',
      }}
    >
      {display.length > 60 ? `${display.slice(0, 57)}...` : display}
    </span>
  );
}

function formatLogValue(raw: unknown): string {
  if (raw === undefined) return '∅';
  if (raw === null) return 'null';
  if (typeof raw === 'string') return JSON.stringify(raw);
  if (typeof raw === 'number') return raw.toLocaleString();
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  if (Array.isArray(raw)) return `[${raw.length} items]`;
  if (typeof raw === 'object') {
    try { return JSON.stringify(raw); } catch { return '[object]'; }
  }
  return String(raw);
}

// ── Activity: the append-only change log (Module 10 step 6) ────────────────
/**
 * WHO changed WHAT, and WHEN. Reads /api/refm/projects/{id}/changes, which is
 * fed by the save path and can never be written by a client.
 *
 * DELIBERATELY NOT THE SAME THING AS THE HISTORY TAB. History lists the saved
 * versions of the model and, per version, a recomputed diff against its base.
 * Activity is a ledger: one row per recorded change, in the order it happened,
 * with an author and a timestamp that nothing recomputes. A version edited by
 * three people over an afternoon is ONE row in History and many rows here.
 *
 * EVERY MEMBER SEES THE SAME ROWS. There is no per-role filtering in this
 * component and none on the server: a Viewer's log is an Owner's log. An admin
 * sees no more on a project they can open than a member does.
 */
function ActivityPanel({
  changes, available, loading, versions,
}: {
  changes: ProjectChangeDTO[];
  available: boolean | undefined;
  loading: boolean;
  versions: RefmProjectVersionListItem[];
}): React.JSX.Element {
  // Version id to a human label, so a row says which version a change landed in
  // rather than showing a uuid. A version deleted since (FK SET NULL) has no
  // label here, which reads as unknown rather than as some other version.
  const versionLabel = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const v of versions) {
      m.set(v.id, v.version_label ?? v.label ?? `Version ${v.version_number}`);
    }
    return m;
  }, [versions]);

  if (loading) {
    return <div className="alert-info" data-testid="activity-loading">Loading activity...</div>;
  }
  // "Not recorded" and "nothing happened" are different statements, and saying
  // the wrong one would be a false claim about the project.
  if (available === false) {
    return (
      <div className="alert-info" data-testid="activity-unavailable">
        Activity tracking is not enabled on this database yet. Changes from here on will be recorded.
      </div>
    );
  }
  if (changes.length === 0) {
    return (
      <div className="alert-info" data-testid="activity-empty">
        No activity recorded yet for this project. Edits are logged from the next save onwards.
      </div>
    );
  }

  // Grouped by calendar day, newest first. The server already returns newest
  // first, so grouping preserves that order rather than re-sorting.
  const days: Array<{ day: string; rows: ProjectChangeDTO[] }> = [];
  for (const c of changes) {
    const day = new Date(c.createdAt).toLocaleDateString(undefined, {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    });
    const last = days[days.length - 1];
    if (last && last.day === day) last.rows.push(c);
    else days.push({ day, rows: [c] });
  }

  return (
    <div data-testid="activity-list">
      <p style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', marginBottom: 'var(--sp-2)' }}>
        Who changed what, and when. This record is append only: it is never
        rewritten or recalculated, and everyone with access to the project sees
        the same entries.
      </p>
      {days.map(({ day, rows }) => (
        <div key={day} style={{ marginBottom: 'var(--sp-2)' }}>
          <div
            style={{
              fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.05em', color: 'var(--color-meta)',
              padding: '6px 0', borderBottom: '1px solid var(--color-border)',
            }}
          >
            {day}
          </div>
          {rows.map((c) => (
            <ActivityRow key={c.id} change={c} versionLabel={versionLabel} />
          ))}
        </div>
      ))}
    </div>
  );
}

function ActivityRow({
  change, versionLabel,
}: {
  change: ProjectChangeDTO;
  versionLabel: Map<string, string>;
}): React.JSX.Element {
  const time = new Date(change.createdAt).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });
  const badge = activityBadge(change.action);
  const bulk = change.action === 'bulk-change'
    ? (change.after as { changedPaths?: number } | null)
    : null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '58px 84px 1fr',
        gap: 8,
        alignItems: 'baseline',
        padding: '6px 0',
        borderBottom: '1px dashed var(--color-border)',
        fontSize: '12px',
      }}
    >
      <span style={{ color: 'var(--color-muted)', fontFamily: 'monospace' }}>{time}</span>
      <span
        style={{
          fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: 20,
          background: badge.bg, color: badge.fg, width: 'max-content',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}
      >
        {badge.label}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: 'var(--color-heading)' }}>
          <strong>{change.userName ?? 'Unknown user'}</strong>
          {change.versionId && versionLabel.get(change.versionId) && (
            <span style={{ color: 'var(--color-muted)' }}>
              {' in '}{versionLabel.get(change.versionId)}
            </span>
          )}
        </div>
        {change.path && (
          <div style={{ fontFamily: 'monospace', color: 'var(--color-body)', wordBreak: 'break-all' }}>
            {change.path}
          </div>
        )}
        {bulk?.changedPaths !== undefined && (
          <div style={{ color: 'var(--color-muted)' }}>
            {bulk.changedPaths.toLocaleString()} fields changed in one save
          </div>
        )}
        {(change.action === 'update' || change.action === 'add' || change.action === 'remove') && (
          <div style={{ marginTop: 2, color: 'var(--color-muted)' }}>
            <ValueChip raw={change.before} kind="before" />
            <span style={{ margin: '0 6px' }}>&rarr;</span>
            <ValueChip raw={change.after} kind="after" />
          </div>
        )}
      </div>
    </div>
  );
}

/** Free-text action to a badge. An UNRECOGNISED action renders as ITSELF
 *  rather than being dropped or forced into a default: the column is free text
 *  precisely so a new action needs no migration, and swallowing one here would
 *  make it invisible in the one place it is meant to be seen. */
function activityBadge(action: string): { label: string; bg: string; fg: string } {
  switch (action) {
    case 'add':             return { label: 'Added',   bg: '#d1fae5', fg: '#065f46' };
    case 'remove':          return { label: 'Removed', bg: '#fee2e2', fg: '#991b1b' };
    case 'update':          return { label: 'Updated', bg: '#e0f2fe', fg: '#0c4a6e' };
    case 'bulk-change':     return { label: 'Bulk',    bg: '#ede9fe', fg: '#5b21b6' };
    case 'version.created': return { label: 'Version', bg: '#fef3c7', fg: '#92400e' };
    default:                return { label: action,    bg: 'var(--color-row-alt)', fg: 'var(--color-body)' };
  }
}
