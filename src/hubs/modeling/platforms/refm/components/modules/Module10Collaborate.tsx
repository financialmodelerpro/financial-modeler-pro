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

      {/* ── Who is editing right now (the same lock the topbar shows) ───── */}
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

      {/* ── Who has access (read only; managed on the Team access tab) ──── */}
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

      {/* ── Comments: the same panel as the Version modal ────────────────── */}
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

      {/* ── Activity: the same panel as the Version modal ────────────────── */}
      <div style={card} data-testid="module10-activity">
        <h3 style={sectionTitle}>Activity</h3>
        <ActivityPanel
          changes={changesData.rows}
          available={changesData.available}
          loading={!changesData.ready}
          versions={versions}
        />
      </div>
    </div>
  );
}
