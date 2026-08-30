'use client';

/**
 * DeleteProjectModal - THE confirmation for a user deleting their own project.
 *
 * Replaces the two `window.confirm` calls that used to guard this (the
 * dashboard card and the projects screen), which stated different things: one
 * mentioned the versions, the other said only "cannot be undone", and after
 * mig 224 BOTH were wrong, since a user delete is now recoverable.
 *
 * It is rendered ONCE, by RealEstatePlatform, which owns the delete call; the
 * two lists just ask their parent to delete and the parent asks here. One
 * dialog, one wording, one place to change it.
 *
 * The dialog states, in the user's words: what is going (named, with its
 * version count), that it leaves their dashboard and frees a project slot,
 * that it is recoverable for the retention window and BY WHOM, and what
 * archiving would do instead, since archive is the reversible action they may
 * actually have wanted.
 *
 * No em dashes in this file.
 */
import React from 'react';

interface DeleteProjectModalProps {
  projectName: string;
  versionCount: number;
  retentionDays: number;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function DeleteProjectModal({
  projectName,
  versionCount,
  retentionDays,
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: DeleteProjectModalProps): React.JSX.Element {
  return (
    <div
      data-testid="delete-project-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Delete project"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(13,46,90,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div
        style={{
          background: 'var(--color-grey-white)', borderRadius: 14,
          width: 'min(520px, 100%)', padding: '26px 28px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--color-negative)', marginBottom: 10 }}>
          Delete this project?
        </div>

        <p style={{ fontSize: 13.5, color: 'var(--color-body)', lineHeight: 1.65, margin: '0 0 12px' }}>
          <strong>{projectName}</strong> and its{' '}
          <strong>{versionCount} saved version{versionCount === 1 ? '' : 's'}</strong> will be removed
          from your dashboard, and the project will stop counting towards your project limit.
        </p>

        <div
          data-testid="delete-project-recovery"
          style={{
            background: 'var(--color-navy-pale, #E8F0FB)', borderRadius: 9,
            padding: '11px 14px', marginBottom: 14,
            fontSize: 12.5, color: 'var(--color-heading)', lineHeight: 1.6,
          }}
        >
          Recoverable for <strong>{retentionDays} days</strong>: nothing is erased yet, and our team
          can put it back for you if you ask within that window. After {retentionDays} days it is
          deleted permanently, with every version, and cannot be recovered by anyone.
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--color-meta)', lineHeight: 1.6, margin: '0 0 18px' }}>
          Want to keep it but clear the space? <strong>Archive</strong> instead: an archived project
          stays in your list, is view-only, frees a project slot, and you can unarchive it yourself
          at any time.
        </p>

        {error && (
          <div data-testid="delete-project-error" style={{ fontSize: 12.5, color: 'var(--color-negative)', fontWeight: 600, marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            data-testid="delete-project-cancel"
            className="btn-secondary"
            style={{ padding: '9px 18px', fontSize: 13, fontWeight: 600 }}
          >
            Keep project
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-testid="delete-project-confirm"
            className="btn-danger"
            style={{ padding: '9px 18px', fontSize: 13, fontWeight: 800 }}
          >
            {busy ? 'Deleting…' : 'Delete project'}
          </button>
        </div>
      </div>
    </div>
  );
}
