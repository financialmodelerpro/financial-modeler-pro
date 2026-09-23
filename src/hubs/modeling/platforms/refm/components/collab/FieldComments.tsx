/**
 * FieldComments.tsx (2026-09-23)
 *
 * COMMENT WHERE YOU ARE, AND SEE IT WHERE IT IS.
 *
 * Module 10 gave the platform comments and put them on one screen, so a
 * reviewer had to leave the number they were questioning in order to ask about
 * it, and an editor had to go looking to find out anything had been asked. This
 * is the piece that closes that: a marker beside any input, a banner on any
 * tab, and the SAME thread in both places.
 *
 * WHAT IS SHARED AND WHY:
 *
 *   - ONE FETCH. The provider mounts once, inside the project, and every
 *     marker on every tab reads from it. A per-field fetch would be hundreds
 *     of requests on the Capex screen alone.
 *   - ONE THREAD RENDERER. The popover renders `CommentThread` out of
 *     CollabPanels, the very component the Collaborate tab uses, so reply,
 *     resolve, reopen, edit and delete behave identically in both places and
 *     cannot drift. That is the whole reason it was exported rather than
 *     copied.
 *   - ONE FILING RULE. Which tab a comment belongs to comes from
 *     `lib/collab/pathScreen.ts` through `commentAnchors.ts`, and a comment
 *     the map cannot place is NOT filed on a guess.
 *
 * WHAT A MARKER DOES NOT DO: it never blocks the input it sits beside, and it
 * renders nothing at all when the provider is absent (the Wizard, a modal, a
 * surface with no project), so a screen can carry markers unconditionally.
 *
 * No em dashes in this file.
 */
'use client';

import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import * as pclient from '../../lib/persistence/client';
import type { ProjectCommentDTO } from '../../lib/persistence/types';
import { CommentThread } from './CollabPanels';
import { screenAnchor, screenForPath } from '../../lib/collab/pathScreen';
import {
  openThreadsForPath, threadsForPath, countsByScreen, openThreadsForScreen,
  type AnchoredThread,
} from '../../lib/collab/commentAnchors';

interface FieldCommentsValue {
  projectId: string;
  comments: ProjectCommentDTO[];
  viewerId: string;
  canComment: boolean;
  available: boolean | undefined;
  activeVersionId: string | null;
  refresh: () => Promise<void>;
  busy: boolean;
  setBusy: (b: boolean) => void;
  error: string | null;
  setError: (m: string | null) => void;
}

const Ctx = createContext<FieldCommentsValue | null>(null);

/**
 * Mounted once, by the shell, around the module screens. Takes the data rather
 * than fetching it, because the Collaborate screen and the version modal
 * already load comments through `useCollabData` and a second fetcher would be
 * a second answer to "what are the comments".
 */
export function FieldCommentsProvider({
  value, children,
}: { value: FieldCommentsValue | null; children: React.ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useFieldComments = (): FieldCommentsValue | null => useContext(Ctx);

/** Open-thread counts per tab, for the sidebar. Null when there is no project. */
export function useScreenCommentCounts(): ReturnType<typeof countsByScreen> | null {
  const ctx = useContext(Ctx);
  return useMemo(() => (ctx ? countsByScreen(ctx.comments) : null), [ctx]);
}

/* ───────────────────────────── the marker ───────────────────────────────── */

const DOT: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  minWidth: 16, height: 16, padding: '0 4px', marginLeft: 4,
  borderRadius: 8, border: 'none', cursor: 'pointer',
  fontSize: 10, fontWeight: 700, lineHeight: 1, verticalAlign: 'middle',
  fontFamily: 'inherit',
};

/**
 * THE MARKER BESIDE A FIELD.
 *
 * With open threads it is filled and carries the count, so an editor cannot
 * miss it. With none it is a quiet outline that appears on hover of its row,
 * so a dense table is not covered in furniture; `alwaysShow` overrides that for
 * a card layout where there is room.
 */
export function FieldComment({
  path, label, alwaysShow = false,
}: { path: string; label?: string; alwaysShow?: boolean }): React.JSX.Element | null {
  const ctx = useContext(Ctx);
  const [open, setOpen] = useState(false);
  const threads = useMemo(() => (ctx ? openThreadsForPath(ctx.comments, path) : []), [ctx, path]);
  if (!ctx || ctx.available === false) return null;

  const count = threads.length;
  const live = count > 0;
  return (
    <span style={{ position: 'relative', whiteSpace: 'nowrap' }} className={live || alwaysShow ? undefined : 'fmp-comment-hover'}>
      <button
        type="button"
        data-testid={`field-comment-${path}`}
        data-field-comment-count={count}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title={live
          ? `${count} open comment${count === 1 ? '' : 's'} on ${label ?? 'this field'}`
          : `Comment on ${label ?? 'this field'}`}
        aria-label={live ? `${count} open comments` : 'Add a comment'}
        style={{
          ...DOT,
          background: live ? 'var(--color-primary, #1d4ed8)' : 'transparent',
          color: live ? '#fff' : 'var(--color-muted)',
          outline: live ? 'none' : '1px solid var(--color-border)',
        }}
      >
        {live ? count : '+'}
      </button>
      {open && (
        <ThreadPopover
          ctx={ctx}
          path={path}
          label={label ?? 'this field'}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

/* ──────────────────────────── the tab banner ────────────────────────────── */

/**
 * WHAT IS OPEN ON THIS TAB, at the top of it, before anyone goes looking.
 *
 * Counts a field comment on a two-home field on BOTH tabs, because the map
 * says either screen can act on it and telling only one half of the people is
 * how a review stalls.
 */
export function TabComments({ tabKey, title }: { tabKey: string; title?: string }): React.JSX.Element | null {
  const ctx = useContext(Ctx);
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const anchor = screenAnchor(tabKey);
  const onTab = useMemo(() => (ctx ? openThreadsForScreen(ctx.comments, tabKey) : []), [ctx, tabKey]);
  if (!ctx || ctx.available === false) return null;

  const n = onTab.length;
  const label = title ?? screenForPath(anchor)?.screens[0]?.label ?? 'this tab';
  return (
    <div
      data-testid={`tab-comments-${tabKey}`}
      data-tab-comment-count={n}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        marginBottom: 'var(--sp-2)', padding: '6px 10px', borderRadius: 6,
        background: n > 0 ? '#fef3c7' : 'var(--color-surface-2, #f1f5f9)',
        border: n > 0 ? '1px solid #fcd34d' : '1px solid var(--color-border)',
        fontSize: 'var(--font-small)',
      }}
    >
      <span style={{ color: n > 0 ? '#92400e' : 'var(--color-meta)', fontWeight: n > 0 ? 700 : 400 }}>
        {n > 0
          ? `${n} open comment${n === 1 ? '' : 's'} on ${label}`
          : `No open comments on ${label}`}
      </span>
      {n > 0 && (
        <button type="button" data-testid={`tab-comments-${tabKey}-toggle`} onClick={() => setOpen((o) => !o)}
          style={linkBtn}>
          {open ? 'Hide' : 'Show'}
        </button>
      )}
      {ctx.canComment && (
        <button type="button" data-testid={`tab-comments-${tabKey}-add`} onClick={() => setComposing((c) => !c)}
          style={linkBtn}>
          Comment on this tab
        </button>
      )}
      {composing && (
        <div style={{ width: '100%' }}>
          <NewComment ctx={ctx} path={anchor} onDone={() => setComposing(false)} placeholder={`Comment on ${label}.`} />
        </div>
      )}
      {open && (
        <div style={{ width: '100%', marginTop: 4 }} data-testid={`tab-comments-${tabKey}-list`}>
          {onTab.map((t) => (
            <ThreadBlock key={t.root.id} ctx={ctx} thread={t} />
          ))}
        </div>
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  font: 'inherit', color: 'var(--color-primary, #1d4ed8)', textDecoration: 'underline',
};

/* ─────────────────────────── shared internals ───────────────────────────── */

function ThreadBlock({ ctx, thread }: { ctx: FieldCommentsValue; thread: AnchoredThread }): React.JSX.Element {
  return (
    <CommentThread
      projectId={ctx.projectId}
      root={thread.root}
      replies={thread.replies}
      viewerId={ctx.viewerId}
      canComment={ctx.canComment}
      // The in-place thread does not carry version labels: the version a
      // comment was written against is shown in the Collaborate tab, which is
      // the whole picture, and repeating it beside an input is noise.
      versionLabel={EMPTY_LABELS}
      busy={ctx.busy}
      setBusy={ctx.setBusy}
      onChanged={ctx.refresh}
      onError={(m) => ctx.setError(m)}
    />
  );
}
const EMPTY_LABELS = new Map<string, string>();

function NewComment({
  ctx, path, onDone, placeholder,
}: { ctx: FieldCommentsValue; path: string; onDone: () => void; placeholder: string }): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const submit = useCallback(async () => {
    const body = draft.trim();
    if (!body || ctx.busy) return;
    ctx.setBusy(true);
    const res = await pclient.createComment(ctx.projectId, {
      body,
      parentId: null,
      // Anchored to the version being looked at, exactly as the Collaborate
      // composer does: one rule for what a root carries.
      versionId: ctx.activeVersionId,
      path,
    });
    ctx.setBusy(false);
    if (res.error) { ctx.setError(res.error); return; }
    setDraft('');
    await ctx.refresh();
    onDone();
  }, [draft, ctx, path, onDone]);

  return (
    <div style={{ marginTop: 4 }}>
      <textarea
        data-testid={`new-comment-${path}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        rows={2}
        style={{
          width: '100%', fontFamily: 'inherit', fontSize: 'var(--font-small)',
          padding: 6, borderRadius: 4, border: '1px solid var(--color-border)', resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          type="button"
          className="btn-primary"
          data-testid={`new-comment-${path}-submit`}
          disabled={ctx.busy || draft.trim() === ''}
          onClick={() => { void submit(); }}
          style={{ fontSize: 'var(--font-small)', padding: '3px 10px' }}
        >
          Comment
        </button>
        <button type="button" onClick={onDone} style={linkBtn}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * The thread, in place. Deliberately a plain absolutely-positioned panel and
 * not a modal: the point of the feature is that the number stays on screen
 * behind it.
 */
function ThreadPopover({
  ctx, path, label, onClose,
}: { ctx: FieldCommentsValue; path: string; label: string; onClose: () => void }): React.JSX.Element {
  // RESOLVED THREADS ARE SHOWN HERE TOO, behind a toggle. The marker counts
  // only open ones, but someone standing on the field asking "was this ever
  // raised" is asking about all of them.
  const [showResolved, setShowResolved] = useState(false);
  const all = threadsForPath(ctx.comments, path);
  const open = all.filter((t) => t.root.resolvedAt === null);
  const shown = showResolved ? all : open;
  const [composing, setComposing] = useState(open.length === 0);

  return (
    <div
      data-testid={`field-comment-popover-${path}`}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', zIndex: 60, top: 22, right: 0, width: 360,
        maxHeight: 420, overflowY: 'auto', textAlign: 'left', whiteSpace: 'normal',
        background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border)',
        borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 10,
        fontSize: 'var(--font-small)', color: 'var(--color-body)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: 'var(--color-heading)' }}>{label}</div>
          <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--color-meta)', wordBreak: 'break-all' }}>
            {path}
          </div>
        </div>
        <button type="button" onClick={onClose} data-testid={`field-comment-close-${path}`}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, color: 'var(--color-muted)' }}>
          &times;
        </button>
      </div>

      {shown.length === 0 && !composing && (
        <div style={{ color: 'var(--color-meta)', marginBottom: 6 }}>Nothing raised on this field yet.</div>
      )}
      {shown.map((t) => <ThreadBlock key={t.root.id} ctx={ctx} thread={t} />)}

      {all.length > open.length && (
        <button type="button" onClick={() => setShowResolved((s) => !s)} style={{ ...linkBtn, marginTop: 4 }}
          data-testid={`field-comment-resolved-${path}`}>
          {showResolved ? 'Hide resolved' : `Show ${all.length - open.length} resolved`}
        </button>
      )}

      {ctx.canComment ? (
        composing
          ? <NewComment ctx={ctx} path={path} onDone={() => setComposing(false)} placeholder={`Comment on ${label}.`} />
          : (
            <button type="button" onClick={() => setComposing(true)} style={{ ...linkBtn, marginTop: 6 }}
              data-testid={`field-comment-add-${path}`}>
              Add a comment
            </button>
          )
      ) : (
        <div style={{ color: 'var(--color-meta)', marginTop: 6 }}>
          Your role on this project is read-only, so you can read comments but not add one.
        </div>
      )}
    </div>
  );
}
