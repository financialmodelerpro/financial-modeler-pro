'use client';

/**
 * Module10Collaborate.tsx
 *
 * MODULE 10 GETS A SCREEN (2026-09-04). Until now everything real about
 * Collaborate lived elsewhere (membership on the hub Team tab, comments and
 * the change log in the Version modal, the lock on the topbar, delete
 * requests on the card) and the sidebar row opened a placeholder. This is
 * the ONE place, per project: who has access and their roles, who is editing
 * right now, the comment threads, and the activity log.
 *
 * REUSE, NOT SECOND VERSIONS. The Comments and Activity panels are the SAME
 * components the Version modal renders (components/collab/CollabPanels.tsx)
 * fed by the SAME fetch discipline (useCollabData.ts): one implementation,
 * two doors. The lock state arrives as props from the platform, the same
 * object the topbar banner reads. The members list is the one genuinely new
 * read (GET /api/refm/projects/{id}/members, served to any member).
 *
 * THIS SCREEN READS. Membership writes stay on the admin member route and
 * the holder team engine; a holder sees a pointer to their Team access tab,
 * not a second write path.
 *
 * VISIBLE TO ALL FOUR ROLES, deliberately: comments, activity and the member
 * list are exactly the surfaces every member reads the same way, so the
 * module key is left OUT of REFM_MODULE_VISIBILITY (unknown keys are visible
 * to every known role, hiding is opt-in per module).
 *
 * No em dashes in this file.
 */

import React, { useEffect, useState } from 'react';
import * as pclient from '../../lib/persistence/client';
import type { RefmProjectVersionListItem, ProjectMemberDTO } from '../../lib/persistence/types';
import { PROJECT_ROLE_META, type ProjectRole } from '@/src/core/collab/projectRoles';
import { ActivityPanel, CommentsPanel } from '../collab/CollabPanels';
import { useProjectChanges, useProjectComments } from '../collab/useCollabData';

/**
 * THE FOUR SUB-TABS (2026-09-22), declared once so the bar and the gates read
 * the same list. Overview leads because the screen's job is to answer "what do
 * I need to look at now" before it offers anywhere to browse.
 */
const COLLAB_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'comments', label: 'Comments' },
  { key: 'activity', label: 'Activity' },
  { key: 'access',   label: 'Access' },
] as const;
type CollabTab = typeof COLLAB_TABS[number]['key'];

interface Module10CollaborateProps {
  projectId: string;
  projectName: string | null;
  /** The viewer's resolved role on this project (server-resolved, step 4). */
  role: string | null;
  /** Same rule the Version modal gets: whether the composer renders. */
  canComment: boolean;
  activeVersionId: string | null;
  /** True when the viewer is this account's holder: shows the pointer to the
   *  Team access tab where membership is MANAGED. */
  isHolderOrAdmin: boolean;
  /** The edit lock, the same object the topbar banner reads. */
  lock: { lockingAvailable: boolean; holderName: string | null; isMine: boolean };
}

export default function Module10Collaborate({
  projectId, projectName, role, canComment, activeVersionId, isHolderOrAdmin, lock,
}: Module10CollaborateProps): React.JSX.Element {
  // Members: the one new read. Same keyed-state discipline as the collab
  // hooks: the answer we hold is either for this project or it is not.
  const [membersState, setMembersState] = useState<
    { key: string; rows: ProjectMemberDTO[]; available: boolean } | null
  >(null);
  const membersReady = membersState !== null && membersState.key === projectId;

  // Versions, for the same id-to-label rendering the modal panels do.
  const [versions, setVersions] = useState<RefmProjectVersionListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [commentBusy, setCommentBusy] = useState(false);

  const changesData = useProjectChanges(projectId, true);
  const commentsData = useProjectComments(projectId, true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [m, v] = await Promise.all([
        pclient.listProjectMembers(projectId),
        pclient.listVersions(projectId),
      ]);
      if (cancelled) return;
      if (m.error) setError(m.error);
      setMembersState({
        key: projectId,
        rows: m.data?.members ?? [],
        available: m.data?.available ?? false,
      });
      if (!v.error) setVersions(v.data?.versions ?? []);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const members = membersReady ? membersState.rows : [];
  const roleMeta = role ? PROJECT_ROLE_META[role as ProjectRole] : undefined;

  // ── SUB-TABS (2026-09-22) ────────────────────────────────────────────────
  // This was one scrolling page of four stacked cards, so a reviewer looking
  // for an open comment scrolled past the member list to find it, and nothing
  // answered "what do I need to look at now". The panels are unchanged: they
  // move into tabs and gain an Overview above them.
  const [tab, setTab] = useState<CollabTab>('overview');

  // ARRIVING FROM A FIELD (2026-09-23). `commentOnField` on another screen
  // dispatches this, the shell flips to Module 10, and the screen must then
  // land on Comments rather than on its Overview: the person clicked "comment
  // on this field", so showing them a summary first is an extra click to get
  // back to what they asked for. The composer itself picks up the same event
  // and holds the path (CommentsPanel), which is why this handler only moves
  // the tab: one event, one listener each for the two things it has to do.
  useEffect(() => {
    const onCommentOn = (): void => setTab('comments');
    window.addEventListener('fmp:comment-on', onCommentOn);
    return () => window.removeEventListener('fmp:comment-on', onCommentOn);
  }, []);

  // WHAT THE OVERVIEW COUNTS. Open means a ROOT comment (a reply is part of a
  // thread, not a thread of its own), not deleted, not resolved. Computed from
  // data already loaded; nothing here costs a read.
  const openThreads = commentsData.rows.filter(
    (c) => c.parentId === null && !c.deleted && c.resolvedAt === null,
  );
  const latestChange = changesData.rows[0] ?? null;

  // ── THE UNREAD MARKER (2026-09-22, migration 246) ───────────────────────
  // Held as of the moment the screen opened and NOT moved while it is open:
  // marking as the reader watches would make the badge vanish under them.
  // Stamped once, after the answer exists, for exactly the reason the route
  // is two calls (see last-seen/route.ts).
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const [seenReady, setSeenReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSeenReady(false);
    void (async () => {
      const res = await pclient.getLastSeen(projectId);
      if (cancelled) return;
      setLastSeenAt(res.data?.lastSeenAt ?? null);
      setSeenReady(true);
      // Stamped AFTER the read has landed, so this visit's answer is computed
      // against the PREVIOUS visit. A failure here is silent by design: the
      // marker is a convenience and losing it costs a stale badge, not work.
      void pclient.markProjectSeen(projectId);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // What is new, measured against the marker held above. A reader with NO
  // marker (their first visit) has nothing "new": everything is, which is the
  // same as nothing being worth flagging, and flagging the entire history
  // would make the feature noise on the one visit it cannot help.
  const isNew = (iso: string): boolean => lastSeenAt !== null && iso > lastSeenAt;
  const newChanges = seenReady ? changesData.rows.filter((c) => isNew(c.createdAt)) : [];
  const newComments = seenReady ? commentsData.rows.filter((c) => !c.deleted && isNew(c.createdAt)) : [];

  const sectionTitle: React.CSSProperties = {
    fontSize: 'var(--font-h3, 15px)', fontWeight: 700, color: 'var(--color-heading)',
    margin: '0 0 6px',
  };
  const card: React.CSSProperties = {
    background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md, 10px)', padding: 'var(--sp-2) var(--sp-3)',
    marginBottom: 'var(--sp-3)',
  };

  return (
    <div style={{ padding: 'var(--sp-3)', maxWidth: 980 }} data-testid="module10-collaborate">
      <div style={{ marginBottom: 'var(--sp-3)', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 'var(--font-h2, 18px)', fontWeight: 800, color: 'var(--color-heading)', margin: 0 }}>
          Collaborate
        </h2>
        <span style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>
          {projectName ?? 'This project'}
          {roleMeta ? ` · your role: ${roleMeta.label}` : ''}
        </span>
      </div>
      {error && <div className="alert-info" data-testid="module10-error">{error}</div>}

      {/* ── The four sub-tabs ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--sp-3)' }}>
        {COLLAB_TABS.map((t) => {
          const active = tab === t.key;
          // The count rides on the tab so an open thread is visible without
          // opening Comments, which is the whole point of a tab bar here.
          const badge = t.key === 'comments' && openThreads.length > 0 ? openThreads.length
            : t.key === 'activity' && newChanges.length > 0 ? newChanges.length
            : null;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              data-testid={`module10-tab-${t.key}`}
              aria-current={active ? 'page' : undefined}
              style={{
                padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 13, fontFamily: 'inherit',
                fontWeight: active ? 700 : 500,
                color: active ? 'var(--color-primary)' : 'var(--color-meta)',
                borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {t.label}
              {badge !== null && (
                <span style={{
                  marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 6px',
                  borderRadius: 20, background: '#fef3c7', color: '#92400e',
                }}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── OVERVIEW: what a person needs to know before anything else ──── */}
      {tab === 'overview' && (
        <div data-testid="module10-overview">
          {/* ── Since you last looked ──────────────────────────────────── */}
          <div style={card} data-testid="module10-since-last-seen">
            <h3 style={sectionTitle}>Since you last looked</h3>
            {!seenReady || !changesData.ready ? (
              <p style={{ fontSize: 12.5, color: 'var(--color-muted)', margin: 0 }}>Checking...</p>
            ) : lastSeenAt === null ? (
              <p style={{ fontSize: 12.5, color: 'var(--color-muted)', margin: 0 }}>
                This is your first visit to this project, so nothing is marked as new.
                Changes from here on will be.
              </p>
            ) : newChanges.length === 0 && newComments.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--color-muted)', margin: 0 }}>
                Nothing has changed since {new Date(lastSeenAt).toLocaleString()}.
              </p>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--color-body)', margin: 0 }}>
                <strong>{newChanges.length}</strong> {newChanges.length === 1 ? 'change' : 'changes'}
                {newComments.length > 0 && (
                  <> and <strong>{newComments.length}</strong> new {newComments.length === 1 ? 'comment' : 'comments'}</>
                )}
                {' since '}{new Date(lastSeenAt).toLocaleString()}
                {changesData.truncated && (
                  <span style={{ color: 'var(--color-muted)' }}>
                    {' (counted over the entries loaded, which do not reach the whole history)'}
                  </span>
                )}
                .
              </p>
            )}
          </div>

          <div style={card} data-testid="module10-open-comments">
            <h3 style={sectionTitle}>Open comments</h3>
            {!commentsData.ready ? (
              <p style={{ fontSize: 12.5, color: 'var(--color-muted)', margin: 0 }}>Loading comments...</p>
            ) : openThreads.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--color-muted)', margin: 0 }}>
                Nothing open. Every comment on this project has been resolved.
              </p>
            ) : (
              <>
                <p style={{ fontSize: 13, color: 'var(--color-body)', margin: '0 0 6px' }}>
                  <strong>{openThreads.length}</strong> unresolved {openThreads.length === 1 ? 'thread' : 'threads'}.
                </p>
                {/* The three most recent, so the card answers rather than
                    merely counts. The rest are one click away. */}
                {openThreads.slice(0, 3).map((c) => (
                  <div key={c.id} style={{ fontSize: 12.5, color: 'var(--color-body)', padding: '3px 0' }}>
                    <span style={{ color: 'var(--color-muted)' }}>{c.userName ?? 'Unknown'}: </span>
                    {(c.body ?? '').slice(0, 110)}{(c.body ?? '').length > 110 ? '...' : ''}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setTab('comments')}
                  data-testid="module10-goto-comments"
                  style={{
                    marginTop: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    color: 'var(--color-primary)', fontWeight: 600, fontSize: 12.5, fontFamily: 'inherit',
                  }}
                >
                  Open comments
                </button>
              </>
            )}
          </div>

          <div style={card} data-testid="module10-recent-activity">
            <h3 style={sectionTitle}>Latest change</h3>
            {!changesData.ready ? (
              <p style={{ fontSize: 12.5, color: 'var(--color-muted)', margin: 0 }}>Loading activity...</p>
            ) : latestChange === null ? (
              <p style={{ fontSize: 12.5, color: 'var(--color-muted)', margin: 0 }}>
                No activity recorded yet for this project.
              </p>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--color-body)', margin: 0 }}>
                <strong>{latestChange.userName ?? 'Unknown user'}</strong>
                {', '}
                {new Date(latestChange.createdAt).toLocaleString()}
                {(latestChange.label ?? latestChange.path)
                  ? <span style={{ color: 'var(--color-muted)' }}>{' · '}{latestChange.label ?? latestChange.path}</span>
                  : null}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Who is editing right now (the same lock the topbar shows) ───── */}
      {tab === 'overview' && (
      <div style={card} data-testid="module10-editing-now">
        <h3 style={sectionTitle}>Editing now</h3>
        {!lock.lockingAvailable ? (
          <p style={{ fontSize: 12.5, color: 'var(--color-muted)', margin: 0 }}>
            Edit locking is not enabled on this database yet.
          </p>
        ) : lock.holderName ? (
          <p style={{ fontSize: 13, color: 'var(--color-body)', margin: 0 }}>
            <strong>{lock.isMine ? 'You are' : `${lock.holderName} is`}</strong> editing this project right now.
            {!lock.isMine && ' The model is read-only for everyone else until they finish.'}
          </p>
        ) : (
          <p style={{ fontSize: 12.5, color: 'var(--color-muted)', margin: 0 }}>
            Nobody is editing right now. One person edits at a time; everyone else reads.
          </p>
        )}
      </div>
      )}

      {/* ── Who has access (read only; managed on the Team access tab) ──── */}
      {tab === 'access' && (
      <div style={card} data-testid="module10-team">
        <h3 style={sectionTitle}>Who has access</h3>
        {!membersReady ? (
          <p style={{ fontSize: 12.5, color: 'var(--color-muted)', margin: 0 }}>Loading members...</p>
        ) : membersState.available === false ? (
          <p style={{ fontSize: 12.5, color: 'var(--color-muted)', margin: 0 }}>
            Membership is not enabled on this database yet.
          </p>
        ) : (
          <>
            {members.map((m) => (
              <div key={m.userId} data-testid={`module10-member-${m.userId}`}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: '1px dashed var(--color-border)' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--color-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.userName ?? m.userEmail ?? m.userId}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {PROJECT_ROLE_META[m.role as ProjectRole]?.label ?? m.role}
                </span>
                {m.isOwner && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: '#fef3c7', color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Owner
                  </span>
                )}
              </div>
            ))}
            {members.length === 0 && (
              <p style={{ fontSize: 12.5, color: 'var(--color-muted)', margin: 0 }}>
                No membership recorded for this project yet.
              </p>
            )}
            {/* A POINTER, not a second write path: membership is managed on
                the hub Team access tab (holders) and the admin panel. */}
            {isHolderOrAdmin && (
              <p style={{ fontSize: 12, color: 'var(--color-meta)', margin: '8px 0 0' }} data-testid="module10-manage-hint">
                Manage your team and project access from the{' '}
                <a href="/dashboard" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>hub dashboard</a>, on its Team access tab.
              </p>
            )}
          </>
        )}
      </div>
      )}

      {/* ── Comments: the same panel as the Version modal ────────────────── */}
      {tab === 'comments' && (
      <div style={card} data-testid="module10-comments">
        <h3 style={sectionTitle}>Comments</h3>
        <CommentsPanel
          projectId={projectId}
          comments={commentsData.rows}
          available={commentsData.available}
          loading={!commentsData.ready}
          viewerId={commentsData.viewerId}
          versions={versions}
          activeVersionId={activeVersionId}
          canComment={canComment}
          busy={commentBusy}
          setBusy={setCommentBusy}
          onChanged={commentsData.refresh}
          onError={setError}
        />
      </div>
      )}

      {/* ── Activity: the same panel as the Version modal ────────────────── */}
      {tab === 'activity' && (
      <div style={card} data-testid="module10-activity">
        <h3 style={sectionTitle}>Activity</h3>
        <ActivityPanel
          changes={changesData.rows}
          available={changesData.available}
          loading={!changesData.ready}
          versions={versions}
          truncated={changesData.truncated}
          limit={changesData.limit}
        />
      </div>
      )}
    </div>
  );
}
