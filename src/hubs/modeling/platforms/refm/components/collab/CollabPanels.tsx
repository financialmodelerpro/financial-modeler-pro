'use client';

/**
 * CollabPanels.tsx
 *
 * THE Activity and Comments panels, ONE implementation behind TWO doors:
 * the Version modal's Activity / Comments tabs (where people reach them from
 * the version manager) and the Module 10 Collaborate screen. Lifted VERBATIM
 * out of VersionModal.tsx on 2026-09-04 when the module screen was built;
 * behaviour, testids and copy are unchanged, so `verify-change-log` and
 * `verify-comments` re-aimed their pinned paths here deliberately.
 *
 * The panels are PRESENTATIONAL: data and refresh live with the caller
 * (both callers share the fetch discipline in useCollabData.ts). Nothing in
 * this file fetches.
 *
 * No em dashes in this file.
 */

import React, { useState } from 'react';
import * as pclient from '../../lib/persistence/client';
import type { RefmProjectVersionListItem, ProjectChangeDTO, ProjectCommentDTO } from '../../lib/persistence/types';
import { ScreenBadge, takePendingAnchor } from './ScreenBadge';
import { screenForPath } from '../../lib/collab/pathScreen';
import { useModule1Store } from '../../lib/state/module1-store';
import { namingContext, recordsFromChanges, presentChanges } from '../../lib/persistence/changeLabel';
import { sameValue } from '../../lib/persistence/snapshot-diff';

const FILTER_STYLE: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: 'var(--color-heading)',
  border: '1px solid var(--color-border)', borderRadius: 6, padding: '3px 7px',
  background: 'var(--color-surface)', cursor: 'pointer', fontFamily: 'inherit',
};

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
export function ActivityPanel({
  changes, available, loading, versions, truncated = false, limit = 0,
}: {
  changes: ProjectChangeDTO[];
  available: boolean | undefined;
  loading: boolean;
  versions: RefmProjectVersionListItem[];
  /** The server returned a full page, so older activity exists that this list
   *  does not hold. Saying so is the difference between a log that ENDS and a
   *  log that merely STOPS. */
  truncated?: boolean;
  limit?: number;
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

  // Which days the reader has toggled. Absent means "use the default", which is
  // open for the newest day and closed for the rest, so a toggle is remembered
  // without freezing the default for days that arrive later.
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  // FILTERS (2026-09-22). Client-side over the page already loaded: the log is
  // read whole up to the server's limit, so filtering here needs no round trip
  // and cannot disagree with what the list shows. When the page is truncated
  // the notice says so, and a filter over a truncated page is stated as such
  // rather than implying it searched the whole history.
  const [whoFilter, setWhoFilter] = useState<string>('');
  const [versionFilter, setVersionFilter] = useState<string>('');

  // EVERY ROW READS AS A SENTENCE, INCLUDING THE ONES NOBODY LABELLED
  // (2026-09-24). A stored label wins; a row with none is labelled here from
  // its path by `labelForChange`, the SAME function the differ now labels with,
  // naming things from the loaded model and, for anything since deleted, from
  // the records the log itself carries. A leaf "remove" is shown as the clear
  // it was, and a row that records no change is counted rather than shown.
  const phases = useModule1Store((s) => s.phases);
  const parcels = useModule1Store((s) => s.parcels);
  const assets = useModule1Store((s) => s.assets);
  const subUnits = useModule1Store((s) => s.subUnits);
  const costLines = useModule1Store((s) => s.costLines);
  const financingTranches = useModule1Store((s) => s.financingTranches);
  const equityContributions = useModule1Store((s) => s.equityContributions);
  const cases = useModule1Store((s) => s.cases);
  const project = useModule1Store((s) => s.project);
  const presented = React.useMemo(() => {
    const ctx = namingContext(
      { phases, parcels, assets, subUnits, costLines, financingTranches, equityContributions, cases, project },
      recordsFromChanges(changes),
    );
    return presentChanges(changes, ctx, sameValue);
  }, [changes, phases, parcels, assets, subUnits, costLines, financingTranches, equityContributions, cases, project]);

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

  // The people and versions PRESENT IN THIS PAGE, so the dropdowns offer only
  // what can actually be selected. Offering a name with no rows behind it is a
  // filter that returns nothing and looks broken.
  const shown = presented.rows;
  const people = [...new Set(shown.map((c) => c.userName).filter((n): n is string => !!n))].sort();
  const versionIds = [...new Set(shown.map((c) => c.versionId).filter((v): v is string => !!v))];

  const filtered = shown.filter(
    (c) => (whoFilter === '' || c.userName === whoFilter)
      && (versionFilter === '' || c.versionId === versionFilter),
  );
  const filtering = whoFilter !== '' || versionFilter !== '';

  // Grouped by calendar day, newest first. The server already returns newest
  // first, so grouping preserves that order rather than re-sorting.
  const days: Array<{ day: string; rows: ProjectChangeDTO[] }> = [];
  for (const c of filtered) {
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
      {/* A LOG THAT STOPS IS NOT A LOG THAT ENDS (2026-09-22). The route has
          always returned `truncated` and nothing read it, so on a busy project
          the list simply ran out and the screen implied that was everything. */}
      {truncated && (
        <div className="alert-info" data-testid="activity-truncated" style={{ marginBottom: 'var(--sp-2)' }}>
          Showing the most recent {limit > 0 ? limit.toLocaleString() : changes.length.toLocaleString()} entries.
          This project has older activity that is not listed here
          {filtering ? ', and these filters search only the entries shown' : ''}.
        </div>
      )}

      {/* A ROW THAT RECORDS NOTHING IS NOT SHOWN AS A CHANGE, AND IS NOT HIDDEN
          SILENTLY EITHER: the log is append only, so the reader is told these
          rows exist, how many, and why they say nothing. */}
      {presented.noChange > 0 && (
        <div data-testid="activity-no-change" style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', marginBottom: 'var(--sp-2)' }}>
          {presented.noChange.toLocaleString()} older {presented.noChange === 1 ? 'entry records' : 'entries record'} no
          change and {presented.noChange === 1 ? 'is' : 'are'} not listed: before 23 Sep 2026 a save that only
          reordered stored fields was logged as an edit.
        </div>
      )}

      {/* ── Filters, over the page that is loaded ─────────────────────────── */}
      {(people.length > 1 || versionIds.length > 1) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 'var(--sp-2)' }}>
          {people.length > 1 && (
            <select
              value={whoFilter}
              onChange={(e) => setWhoFilter(e.target.value)}
              data-testid="activity-filter-person"
              style={FILTER_STYLE}
            >
              <option value="">Everyone</option>
              {people.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {versionIds.length > 1 && (
            <select
              value={versionFilter}
              onChange={(e) => setVersionFilter(e.target.value)}
              data-testid="activity-filter-version"
              style={FILTER_STYLE}
            >
              <option value="">Every version</option>
              {versionIds.map((v) => (
                <option key={v} value={v}>{versionLabel.get(v) ?? 'Version no longer saved'}</option>
              ))}
            </select>
          )}
          {filtering && (
            <>
              <span style={{ fontSize: 11.5, color: 'var(--color-meta)' }} data-testid="activity-filter-count">
                {filtered.length} of {shown.length} shown
              </span>
              <button
                type="button"
                onClick={() => { setWhoFilter(''); setVersionFilter(''); }}
                data-testid="activity-filter-clear"
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  color: 'var(--color-primary)', fontWeight: 600, fontSize: 11.5, fontFamily: 'inherit',
                }}
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

      {/* A filter that matches nothing must SAY so, or the screen looks broken
          in exactly the way an empty log does. */}
      {filtering && filtered.length === 0 && (
        <div className="alert-info" data-testid="activity-filter-empty">
          No activity matches these filters
          {truncated ? ' in the entries loaded so far' : ''}.
        </div>
      )}
      {days.map(({ day, rows }, dayIdx) => {
        // DAYS COLLAPSE, THE MOST RECENT OPEN (2026-09-22). A log of any age is
        // mostly history a reader is not looking at; leaving every day expanded
        // made the newest entries the hardest to reach.
        const open = openDays[day] ?? dayIdx === 0;
        const saves = groupBySave(rows);
        return (
        <div key={day} style={{ marginBottom: 'var(--sp-2)' }}>
          <button
            type="button"
            onClick={() => setOpenDays((p) => ({ ...p, [day]: !open }))}
            data-testid={`activity-day-${open ? 'open' : 'closed'}`}
            aria-expanded={open}
            style={{
              width: '100%', textAlign: 'left', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.05em', color: 'var(--color-meta)',
              padding: '6px 0', borderBottom: '1px solid var(--color-border)',
              background: 'none', border: 'none', borderBottomWidth: 1,
              borderBottomStyle: 'solid', borderBottomColor: 'var(--color-border)',
              fontFamily: 'inherit',
            }}
          >
            <span style={{ width: 10, display: 'inline-block' }}>{open ? '▾' : '▸'}</span>
            <span>{day}</span>
            <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
              {saves.length} {saves.length === 1 ? 'save' : 'saves'}
            </span>
          </button>
          {open && saves.map((s, i) => {
            // A VERSION BOUNDARY IS A LINE, NOT A REPEATED SUFFIX (2026-09-22).
            // Drawn BETWEEN SAVES rather than between rows, because a save
            // belongs to one version and a per-row test would draw the line
            // inside an expanded group. Newest-first, so the boundary appears
            // when this save's version differs from the one ABOVE it, and the
            // label names the version the saves BELOW it belong to.
            const vid = s.rows[0].versionId;
            const boundary = i > 0 && saves[i - 1].rows[0].versionId !== vid;
            const name = vid ? versionLabel.get(vid) : undefined;
            return (
              <React.Fragment key={s.key}>
                {boundary && (
                  <div
                    data-testid={`activity-version-boundary-${vid ?? 'none'}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      margin: '8px 0 4px', fontSize: 10.5, fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      color: 'var(--color-meta)',
                    }}
                  >
                    <span style={{ flex: '0 0 auto' }}>
                      {name ?? (vid ? 'Version no longer saved' : 'No version')}
                    </span>
                    <span style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
                  </div>
                )}
                <SaveGroup rows={s.rows} versionLabel={versionLabel} />
              </React.Fragment>
            );
          })}
        </div>
        );
      })}
    </div>
  );
}

/**
 * ONE SAVE IS ONE ENTRY (2026-09-22). A save that touched forty fields wrote
 * forty rows and the screen rendered forty rows, so a single edit buried a
 * day's log. Rows are grouped by `save_id` (migration 245), which is minted per
 * save by the appender.
 *
 * CONSECUTIVE rows only, and the list is already newest-first by time, so a
 * group is a contiguous run and the order of the log is preserved exactly.
 *
 * A row with NO save_id belongs to a save nobody recorded (written before 245),
 * so it is its own group rather than being lumped with its neighbours, which
 * would invent a grouping the data does not support.
 */
export function groupBySave(rows: ProjectChangeDTO[]): Array<{ key: string; rows: ProjectChangeDTO[] }> {
  const out: Array<{ key: string; rows: ProjectChangeDTO[] }> = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last !== undefined && r.saveId !== null && last.rows[0].saveId === r.saveId) {
      last.rows.push(r);
    } else {
      out.push({ key: r.saveId ?? `solo:${r.id}`, rows: [r] });
    }
  }
  return out;
}

function SaveGroup({
  rows, versionLabel,
}: {
  rows: ProjectChangeDTO[];
  versionLabel: Map<string, string>;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  // A save of ONE change is not worth a disclosure: it would hide the thing
  // the reader came for behind a click.
  if (rows.length === 1) {
    return <ActivityRow change={rows[0]} versionLabel={versionLabel} />;
  }
  const head = rows[0];
  const time = new Date(head.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return (
    <div data-testid={`activity-save-${head.saveId ?? head.id}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{
          display: 'grid', gridTemplateColumns: '58px 84px 1fr', gap: 8,
          width: '100%', textAlign: 'left', alignItems: 'baseline',
          padding: '6px 0', borderBottom: '1px dashed var(--color-border)',
          fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', color: 'inherit',
        }}
      >
        <span style={{ color: 'var(--color-muted)', fontFamily: 'monospace' }}>{time}</span>
        <span style={{
          fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: 20,
          background: '#ede9fe', color: '#5b21b6', width: 'max-content',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {open ? '▾' : '▸'} Save
        </span>
        <span style={{ color: 'var(--color-heading)' }}>
          <strong>{head.userName ?? 'Unknown user'}</strong>
          <span style={{ color: 'var(--color-muted)' }}>
            {' changed '}{rows.length}{' fields in one save'}
          </span>
        </span>
      </button>
      {open && (
        <div style={{ paddingLeft: 'var(--sp-3)', borderLeft: '2px solid var(--color-border)', marginLeft: 4 }}>
          {rows.map((c) => <ActivityRow key={c.id} change={c} versionLabel={versionLabel} />)}
        </div>
      )}
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
        {/* THE SENTENCE LEADS, THE PATH IS THE FOOTNOTE (2026-09-22). This
            screen is client-facing and a raw snapshot path reads like a
            debugger. Where the differ labelled the change, that is what shows,
            with the path on hover for anyone who wants the exact field; where
            it did not, the path still shows rather than nothing, so no entry
            can become less informative than it was. */}
        {change.label ? (
          <div title={change.path ?? undefined} style={{ color: 'var(--color-body)' }}>
            {change.label}
          </div>
        ) : change.path ? (
          <div style={{ fontFamily: 'monospace', color: 'var(--color-body)', wordBreak: 'break-all' }}>
            {change.path}
          </div>
        ) : null}
        {/* AND WHERE TO GO AND CHANGE IT. The sentence above says what moved;
            this says which tab it is typed on, as a link. */}
        <ScreenBadge path={change.path} testid={`change-${change.id}`} />
        {bulk?.changedPaths !== undefined && (
          <div style={{ color: 'var(--color-muted)' }}>
            {bulk.changedPaths.toLocaleString()} fields changed in one save
          </div>
        )}
        {(change.action === 'update' || change.action === 'add' || change.action === 'remove' || change.action === 'clear') && (
          <div style={{ marginTop: 2, color: 'var(--color-muted)' }}>
            <ValueChip raw={change.before} kind="before" counterpart={change.after} />
            <span style={{ margin: '0 6px' }}>&rarr;</span>
            <ValueChip raw={change.after} kind="after" counterpart={change.before} />
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
    // Amber, not red: a cleared value is an edit, not a deletion.
    case 'clear':           return { label: 'Cleared', bg: '#fef3c7', fg: '#92400e' };
    case 'update':          return { label: 'Updated', bg: '#e0f2fe', fg: '#0c4a6e' };
    case 'bulk-change':     return { label: 'Bulk',    bg: '#ede9fe', fg: '#5b21b6' };
    case 'version.created': return { label: 'Version', bg: '#fef3c7', fg: '#92400e' };
    default:                return { label: action,    bg: 'var(--color-row-alt)', fg: 'var(--color-body)' };
  }
}

/** Shared value chip: also used by the Version modal's per-version change-log
 *  rows, which stayed behind in VersionModal.tsx. */
/**
 * AN ARRAY IS SUMMARISED AGAINST ITS COUNTERPART (2026-09-22), not on its own.
 *
 * `formatLogValue` reported an array as `[N items]`, which is the only thing it
 * knew. So a list whose CONTENTS changed while its length did not printed
 * "3 items" on both sides: a row that exists precisely because something
 * changed, saying nothing changed. Two of the most common edits on this
 * platform do exactly that, retyping a velocity curve and repricing a set of
 * sub-units.
 *
 * Given both sides, the count of elements that actually differ can be stated,
 * which is the thing a reader wants. Falls back to the plain count when the
 * counterpart is not an array, so an array replaced by a scalar still reads
 * honestly rather than claiming a comparison it cannot make.
 */
export function summariseArray(mine: unknown[], other: unknown): string {
  if (!Array.isArray(other)) return `[${mine.length} items]`;
  if (mine.length !== other.length) return `[${mine.length} items]`;
  let changed = 0;
  for (let i = 0; i < mine.length; i++) {
    if (!sameValue(mine[i], other[i])) changed += 1;
  }
  if (changed === 0) return `[${mine.length} items, unchanged]`;
  return `[${mine.length} items, ${changed} changed]`;
}

export function ValueChip({ raw, kind, counterpart }: {
  raw: unknown;
  kind: 'before' | 'after';
  /** The other side of the change, so a same-length array can say what moved
   *  instead of printing its length twice. */
  counterpart?: unknown;
}): React.JSX.Element {
  const display = Array.isArray(raw) && counterpart !== undefined
    ? summariseArray(raw, counterpart)
    : formatLogValue(raw);
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

// ── Comments: threads on the project, a version, or a field (step 7) ───────
/**
 * WHAT THIS IS, AND WHAT ACTIVITY IS NOT. Activity is what the system
 * observed: appended by the save path, immutable, one row per changed field.
 * Comments are what PEOPLE said: written, edited, withdrawn and resolved by
 * hand. They sit next to each other because a reviewer reads both, and they
 * are separate tables because nothing about them is the same.
 *
 * EVERY MEMBER READS; OWNER, EDITOR AND REVIEWER WRITE. `canComment` only
 * decides whether the composer and the controls render. The server checks
 * `canAddComments` again on every write, which is the boundary that counts.
 *
 * THREADS ARE ONE LEVEL, and the database enforces it, so this component can
 * render a flat root-plus-replies list with no recursion and no depth to get
 * wrong.
 *
 * NO JUMP-TO-FIELD. A path renders as text. Nothing maps a snapshot path to a
 * module or a tab in this platform, and inventing that mapping is not part of
 * this step.
 */
export function CommentsPanel({
  projectId, comments, available, loading, viewerId, versions,
  activeVersionId, canComment, busy, setBusy, onChanged, onError,
}: {
  projectId: string;
  comments: ProjectCommentDTO[];
  available: boolean | undefined;
  loading: boolean;
  viewerId: string;
  versions: RefmProjectVersionListItem[];
  activeVersionId: string | null;
  canComment: boolean;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [screenFilter, setScreenFilter] = useState<string>('');
  /**
   * THE FIELD THIS COMMENT IS ABOUT, when there is one (2026-09-23).
   *
   * Set by any screen dispatching `fmp:comment-on` with a snapshot path, which
   * is how a comment gets raised WHERE THE NUMBER IS rather than by describing
   * it from memory on a project-wide thread. The path grammar is the
   * snapshot-diff one, the same vocabulary the change log and the overrides
   * use, so nothing here invents a second way to name a field.
   *
   * Cleared after a successful post: the next comment is project-wide again
   * unless the user asks otherwise, because a sticky anchor would silently
   * file unrelated remarks against one field.
   */
  const [anchorPath, setAnchorPath] = useState<string | null>(null);
  React.useEffect(() => {
    // THE LATCH FIRST, because this panel usually mounts AFTER the click that
    // set the anchor: the user was on another module entirely. The event below
    // covers the other case, a panel already open when the anchor arrives.
    const latched = takePendingAnchor();
    if (latched) setAnchorPath(latched);
    const onAnchor = (e: Event): void => {
      const d = (e as CustomEvent<{ path?: string }>).detail;
      if (d?.path) setAnchorPath(d.path);
    };
    window.addEventListener('fmp:comment-on', onAnchor);
    return () => window.removeEventListener('fmp:comment-on', onAnchor);
  }, []);

  const versionLabel = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const v of versions) {
      m.set(v.id, v.version_label ?? v.label ?? `Version ${v.version_number}`);
    }
    return m;
  }, [versions]);

  // Roots and their replies. The database guarantees one level, so a reply
  // whose parent is missing (its root hard deleted with the project, which
  // cannot happen while the project is open) is simply not shown rather than
  // being promoted to a root it never was.
  const threads = React.useMemo(() => {
    const roots = comments.filter((c) => c.parentId === null);
    const repliesByRoot = new Map<string, ProjectCommentDTO[]>();
    for (const c of comments) {
      if (!c.parentId) continue;
      const list = repliesByRoot.get(c.parentId) ?? [];
      list.push(c);
      repliesByRoot.set(c.parentId, list);
    }
    return roots.map((root) => ({ root, replies: repliesByRoot.get(root.id) ?? [] }));
  }, [comments]);

  const post = async (body: string, parentId: string | null): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    const res = await pclient.createComment(projectId, {
      body,
      parentId,
      // A ROOT is anchored to the version being looked at, so a reader later
      // knows what it was written against. A REPLY takes its thread's anchor;
      // the server drops any sent with one.
      versionId: parentId ? null : activeVersionId,
      // AND, SINCE 2026-09-23, TO A FIELD. `path` has been accepted by the
      // route and the client since comments shipped, and nothing ever sent
      // one, so every comment on this platform was project-wide. A reply takes
      // its thread's anchor, exactly as the version does.
      path: parentId ? null : anchorPath,
    });
    setBusy(false);
    if (res.error) { onError(res.error); return false; }
    await onChanged();
    return true;
  };

  if (loading) {
    return <div className="alert-info" data-testid="comments-loading">Loading comments...</div>;
  }
  // "Not enabled" and "nobody has said anything" are different statements, and
  // saying the wrong one would be a false claim about the project.
  if (available === false) {
    return (
      <div className="alert-info" data-testid="comments-unavailable">
        Comments are not enabled on this database yet.
      </div>
    );
  }

  // ── FILTER BY SCREEN (2026-09-23) ──────────────────────────────────────
  //
  // THE COLLABORATE TAB REMAINS THE WHOLE PICTURE: everything raised in
  // context appears here too, so nothing exists in only one place. Filing a
  // thread to a screen uses the SAME rule the markers and the sidebar counts
  // use (pathScreen, through commentAnchors), so the three cannot disagree
  // about where a comment belongs.
  //
  // THREE CHOICES THAT ARE NOT SCREENS, and each is a real answer rather than
  // a bucket: the project-wide comments, which belong to no screen by
  // definition; and the ones carrying a path the map CANNOT place, which are
  // listed rather than hidden, because a comment nobody can find is worse than
  // one filed oddly.
  const screenOf = (t: { root: ProjectCommentDTO }): string[] => {
    if (!t.root.path) return ['__project'];
    const found = screenForPath(t.root.path);
    if (!found || found.screens.length === 0) return ['__unplaceable'];
    return found.screens.map((s) => s.key);
  };
  const screenOptions = (() => {
    const seen = new Map<string, string>();
    for (const t of threads) {
      for (const k of screenOf(t)) {
        if (k === '__project' || k === '__unplaceable') continue;
        if (!seen.has(k)) seen.set(k, screenForPath(t.root.path)?.screens.find((s) => s.key === k)?.label ?? k);
      }
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  })();
  const hasProjectWide = threads.some((t) => !t.root.path);
  const hasUnplaceable = threads.some((t) => screenOf(t).includes('__unplaceable'));

  const byScreen = screenFilter === ''
    ? threads
    : threads.filter((t) => screenOf(t).includes(screenFilter));

  const open = byScreen.filter((t) => !t.root.resolvedAt);
  const resolved = byScreen.filter((t) => t.root.resolvedAt);
  const shown = showResolved ? [...open, ...resolved] : open;

  return (
    <div data-testid="comments-list">
      <p style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', marginBottom: 'var(--sp-2)' }}>
        Comments on this project. Everyone with access reads the same thread;
        Owners, Editors and Reviewers can write and resolve. A comment stays
        here after a newer version is saved, showing the version it was
        written against.
      </p>

      {/* The screen filter, beside the resolved toggle the panel already had.
          Offered only when there is more than one thing to choose between, the
          same rule the Activity filters follow. */}
      {(screenOptions.length > 1 || (screenOptions.length === 1 && hasProjectWide)) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 'var(--sp-2)' }}>
          <select
            value={screenFilter}
            onChange={(e) => setScreenFilter(e.target.value)}
            data-testid="comments-filter-screen"
            style={FILTER_STYLE}
          >
            <option value="">Every screen</option>
            {hasProjectWide && <option value="__project">On the project</option>}
            {screenOptions.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            {hasUnplaceable && <option value="__unplaceable">On a field we cannot place</option>}
          </select>
          {screenFilter === '__unplaceable' && (
            <span style={{ fontSize: 11, color: 'var(--color-meta)' }}>
              These carry a field the platform cannot match to a screen, so they are listed here rather than filed by guess.
            </span>
          )}
        </div>
      )}

      {canComment ? (
        <>
          {/* WHAT THIS COMMENT WILL BE FILED AGAINST, shown before it is sent
              rather than discovered afterwards, and CLEARABLE: a user who
              arrived here from a field may well want to say something about
              the project instead. */}
          {anchorPath && (
            <div
              data-testid="comment-anchor"
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 'var(--sp-1)',
                padding: '6px 8px', borderRadius: 6, background: 'var(--color-surface-2, #f1f5f9)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--color-meta)' }}>On this field</div>
                <div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{anchorPath}</div>
                <ScreenBadge path={anchorPath} testid="comment-anchor" />
              </div>
              <button
                type="button"
                data-testid="comment-anchor-clear"
                onClick={() => setAnchorPath(null)}
                title="Comment on the project instead"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: 16, lineHeight: 1 }}
              >
                &times;
              </button>
            </div>
          )}
          <Composer
            value={draft}
            onChange={setDraft}
            busy={busy}
            placeholder={anchorPath
              ? 'Comment on this field.'
              : activeVersionId
                ? 'Comment on this project. It will be tagged with the open version.'
                : 'Comment on this project.'}
            submitLabel="Comment"
            testid="comment-new"
            onSubmit={async () => { if (await post(draft, null)) { setDraft(''); setAnchorPath(null); } }}
          />
        </>
      ) : (
        <div className="alert-info" data-testid="comments-read-only" style={{ marginBottom: 'var(--sp-2)' }}>
          Your role on this project is read-only, so you can read comments but not add one.
        </div>
      )}

      {resolved.length > 0 && (
        <button
          type="button"
          onClick={() => setShowResolved((v) => !v)}
          data-testid="comments-toggle-resolved"
          style={{
            border: 'none', background: 'none', padding: '4px 0', cursor: 'pointer',
            fontSize: 12, color: 'var(--color-primary)', fontWeight: 600,
          }}
        >
          {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved thread{resolved.length === 1 ? '' : 's'}
        </button>
      )}

      {shown.length === 0 ? (
        <div className="alert-info" data-testid="comments-empty">
          No comments yet on this project.
        </div>
      ) : (
        shown.map(({ root, replies }) => (
          <CommentThread
            key={root.id}
            projectId={projectId}
            root={root}
            replies={replies}
            viewerId={viewerId}
            canComment={canComment}
            versionLabel={versionLabel}
            busy={busy}
            setBusy={setBusy}
            onChanged={onChanged}
            onError={onError}
          />
        ))
      )}
    </div>
  );
}

/** One thread: a root and its replies, with the reply box under them. */
export function CommentThread({
  projectId, root, replies, viewerId, canComment, versionLabel, busy, setBusy, onChanged, onError,
}: {
  projectId: string;
  root: ProjectCommentDTO;
  replies: ProjectCommentDTO[];
  viewerId: string;
  canComment: boolean;
  versionLabel: Map<string, string>;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}): React.JSX.Element | null {
  const [replyDraft, setReplyDraft] = useState('');
  const [replying, setReplying] = useState(false);

  const liveReplies = replies.filter((r) => !r.deleted);
  // A deleted root with nothing under it is simply gone. A deleted root that
  // still has replies stays as a TOMBSTONE, because removing it would orphan
  // words that are still there and still someone's.
  if (root.deleted && liveReplies.length === 0) return null;

  const resolved = !!root.resolvedAt;

  const toggleResolved = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const res = await pclient.setCommentResolved(projectId, root.id, !resolved);
    setBusy(false);
    if (res.error) { onError(res.error); return; }
    await onChanged();
  };

  return (
    <div
      data-testid={`comment-thread-${root.id}`}
      style={{
        border: '1px solid var(--color-border)',
        borderLeft: `3px solid ${resolved ? 'var(--color-green, #16a34a)' : 'var(--color-primary)'}`,
        borderRadius: 'var(--radius-sm)',
        padding: '10px 12px',
        marginBottom: 'var(--sp-2)',
        background: resolved ? 'var(--color-row-alt)' : 'transparent',
        opacity: resolved ? 0.75 : 1,
      }}
    >
      <CommentRow
        projectId={projectId}
        comment={root}
        viewerId={viewerId}
        canComment={canComment}
        versionLabel={versionLabel}
        isRoot
        resolved={resolved}
        onToggleResolved={toggleResolved}
        busy={busy}
        setBusy={setBusy}
        onChanged={onChanged}
        onError={onError}
      />

      {liveReplies.length > 0 && (
        <div style={{ marginTop: 8, paddingLeft: 14, borderLeft: '2px solid var(--color-border)' }}>
          {liveReplies.map((r) => (
            <CommentRow
              key={r.id}
              projectId={projectId}
              comment={r}
              viewerId={viewerId}
              canComment={canComment}
              versionLabel={versionLabel}
              isRoot={false}
              resolved={false}
              onToggleResolved={undefined}
              busy={busy}
              setBusy={setBusy}
              onChanged={onChanged}
              onError={onError}
            />
          ))}
        </div>
      )}

      {canComment && !root.deleted && (
        replying ? (
          <div style={{ marginTop: 8, paddingLeft: 14 }}>
            <Composer
              value={replyDraft}
              onChange={setReplyDraft}
              busy={busy}
              placeholder="Reply..."
              submitLabel="Reply"
              testid={`comment-reply-${root.id}`}
              onCancel={() => { setReplying(false); setReplyDraft(''); }}
              onSubmit={async () => {
                if (busy) return;
                setBusy(true);
                const res = await pclient.createComment(projectId, { body: replyDraft, parentId: root.id });
                setBusy(false);
                if (res.error) { onError(res.error); return; }
                setReplyDraft('');
                setReplying(false);
                await onChanged();
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setReplying(true)}
            data-testid={`comment-reply-open-${root.id}`}
            style={{
              marginTop: 6, marginLeft: 14, border: 'none', background: 'none',
              padding: 0, cursor: 'pointer', fontSize: 12, color: 'var(--color-primary)', fontWeight: 600,
            }}
          >
            Reply
          </button>
        )
      )}
    </div>
  );
}

/** One comment: the author, when, what it is about, and the controls its
 *  own author gets. */
function CommentRow({
  projectId, comment, viewerId, canComment, versionLabel, isRoot, resolved,
  onToggleResolved, busy, setBusy, onChanged, onError,
}: {
  projectId: string;
  comment: ProjectCommentDTO;
  viewerId: string;
  canComment: boolean;
  versionLabel: Map<string, string>;
  isRoot: boolean;
  resolved: boolean;
  onToggleResolved?: () => Promise<void>;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(comment.body ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // AUTHORSHIP, not role: only the person who wrote a sentence may change what
  // it says. The server enforces the same rule in the WHERE clause of the
  // update, so this is a courtesy, not the boundary.
  const isAuthor = !!comment.userId && comment.userId === viewerId;
  const when = new Date(comment.createdAt).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  if (comment.deleted) {
    return (
      <div data-testid={`comment-${comment.id}-tombstone`}
        style={{ fontSize: 12, color: 'var(--color-muted)', fontStyle: 'italic', padding: '4px 0' }}>
        This comment was deleted. Its replies are kept below.
      </div>
    );
  }

  return (
    <div data-testid={`comment-${comment.id}`} style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12, color: 'var(--color-heading)' }}>
          {comment.userName ?? 'Unknown user'}
        </strong>
        <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>{when}</span>
        {comment.edited && (
          <span style={{ fontSize: 10, color: 'var(--color-muted)' }} data-testid={`comment-${comment.id}-edited`}>
            edited
          </span>
        )}
        {isRoot && comment.versionId && (
          <span style={{ fontSize: 10, color: 'var(--color-meta)' }} data-testid={`comment-${comment.id}-version`}>
            on {versionLabel.get(comment.versionId) ?? 'a version since deleted'}
          </span>
        )}
        {isRoot && !comment.versionId && (
          <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>on the project</span>
        )}
        {resolved && (
          <span
            data-testid={`comment-${comment.id}-resolved`}
            style={{
              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 20,
              background: '#d1fae5', color: '#065f46', textTransform: 'uppercase', letterSpacing: '0.05em',
            }}
          >
            Resolved{comment.resolvedByName ? ` by ${comment.resolvedByName}` : ''}
          </span>
        )}
      </div>

      {comment.path && (
        // THE PATH IS STILL HERE, and now it is followed by where to go.
        // Until 2026-09-23 this was the whole answer, with a note saying
        // nothing mapped a path to a screen. `lib/collab/pathScreen.ts` does,
        // and ScreenBadge renders it: a clickable tab name where the field is
        // editable, a plain sentence where it deliberately is not, and nothing
        // at all where the map does not know, so the path below never becomes
        // the lesser answer it used to be.
        <>
          <div
            data-testid={`comment-${comment.id}-path`}
            style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--color-body)', wordBreak: 'break-all', marginTop: 2 }}
          >
            {comment.path}
          </div>
          <ScreenBadge path={comment.path} testid={`comment-${comment.id}`} />
        </>
      )}

      {editing ? (
        <div style={{ marginTop: 4 }}>
          <Composer
            value={editDraft}
            onChange={setEditDraft}
            busy={busy}
            placeholder="Edit your comment..."
            submitLabel="Save"
            testid={`comment-edit-${comment.id}`}
            onCancel={() => { setEditing(false); setEditDraft(comment.body ?? ''); }}
            onSubmit={async () => {
              if (busy) return;
              setBusy(true);
              const res = await pclient.editComment(projectId, comment.id, editDraft);
              setBusy(false);
              if (res.error) { onError(res.error); return; }
              setEditing(false);
              await onChanged();
            }}
          />
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--color-body)', whiteSpace: 'pre-wrap', marginTop: 2 }}>
          {comment.body}
        </div>
      )}

      {!editing && (
        <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {isAuthor && (
            <button type="button" onClick={() => { setEditing(true); setEditDraft(comment.body ?? ''); }}
              data-testid={`comment-${comment.id}-edit`}
              style={linkBtn}>Edit</button>
          )}
          {isAuthor && !confirmDelete && (
            <button type="button" onClick={() => setConfirmDelete(true)}
              data-testid={`comment-${comment.id}-delete`}
              style={{ ...linkBtn, color: 'var(--color-danger, #dc2626)' }}>Delete</button>
          )}
          {isAuthor && confirmDelete && (
            <>
              <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>Delete this comment?</span>
              <button type="button" disabled={busy}
                data-testid={`comment-${comment.id}-delete-confirm`}
                onClick={async () => {
                  setBusy(true);
                  const res = await pclient.deleteComment(projectId, comment.id);
                  setBusy(false);
                  setConfirmDelete(false);
                  if (res.error) { onError(res.error); return; }
                  await onChanged();
                }}
                style={{ ...linkBtn, color: 'var(--color-danger, #dc2626)', fontWeight: 700 }}>Yes, delete</button>
              <button type="button" onClick={() => setConfirmDelete(false)} style={linkBtn}>Cancel</button>
            </>
          )}
          {/* Resolving is NOT authorship: a reviewer raises a point and an
              editor closes it, so anyone who may comment may close a thread. */}
          {isRoot && canComment && onToggleResolved && (
            <button type="button" disabled={busy} onClick={onToggleResolved}
              data-testid={`comment-${comment.id}-resolve`}
              style={linkBtn}>{resolved ? 'Reopen' : 'Resolve'}</button>
          )}
        </div>
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  border: 'none', background: 'none', padding: 0, cursor: 'pointer',
  fontSize: 11, color: 'var(--color-primary)', fontWeight: 600,
};

/** One textarea plus its buttons. Shared by the new-comment box, the reply box
 *  and the edit box, so all three enforce the same non-empty rule and the same
 *  disabled-while-busy behaviour. */
function Composer({
  value, onChange, onSubmit, onCancel, busy, placeholder, submitLabel, testid,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => Promise<void>;
  onCancel?: () => void;
  busy: boolean;
  placeholder: string;
  submitLabel: string;
  testid: string;
}): React.JSX.Element {
  const empty = value.trim().length === 0;
  return (
    <div style={{ marginBottom: 'var(--sp-2)' }}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-testid={`${testid}-input`}
        maxLength={4000}
        style={{
          width: '100%', minHeight: 60, resize: 'vertical', padding: '6px 8px',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
          fontFamily: 'Inter, sans-serif', fontSize: 13,
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
        <button
          type="button"
          className="btn-primary"
          disabled={empty || busy}
          onClick={() => { void onSubmit(); }}
          data-testid={`${testid}-submit`}
          style={{ fontSize: 12, padding: '5px 14px', opacity: empty || busy ? 0.5 : 1 }}
        >
          {busy ? 'Saving...' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} style={linkBtn} data-testid={`${testid}-cancel`}>
            Cancel
          </button>
        )}
        <span style={{ fontSize: 11, color: 'var(--color-muted)', marginLeft: 'auto' }}>
          {value.length}/4000
        </span>
      </div>
    </div>
  );
}
