'use client';

/**
 * EditLockBanner.tsx
 *
 * WHO IS EDITING, and the request / accept / decline exchange.
 * Module 10 Collaboration, step 5.
 *
 * Three states, and it renders nothing in any other:
 *
 *   1. SOMEONE ELSE IS EDITING. Names them, and offers to ask them to save and
 *      release. The button becomes "Requested" once asked, so a waiter cannot
 *      spam and can see that their request landed.
 *   2. I HOLD IT AND SOMEONE HAS ASKED. Names the asker, and offers Save and
 *      release, or Keep editing. Accepting is releasing, which is why the
 *      button says what it does rather than "Accept".
 *   3. LOCKING IS UNAVAILABLE (a pre-233 database). Renders NOTHING, because
 *      claiming a lock that does not exist would be worse than silence.
 *
 * It never renders for the ordinary case of holding your own lock with nobody
 * waiting: that is just editing, and a banner saying so would be noise on
 * every single-user session.
 *
 * Locked palette only. No em dashes.
 */

import React from 'react';

export interface EditLockBannerProps {
  lockingAvailable: boolean;
  holderName: string | null;
  isMine: boolean;
  releaseRequestedByName: string | null;
  /** Present only when this user tried to edit and was refused. */
  blockedBy: string | null;
  onRequestRelease: () => void;
  onRelease: () => void;
  onDecline: () => void;
  /** True once this user has asked, so the button can stop inviting a repeat. */
  requested?: boolean;
}

const wrap: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
  padding: '8px 14px', borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-meta)', marginBottom: 'var(--sp-2)',
};

const btn: React.CSSProperties = {
  padding: '5px 12px', fontSize: 'var(--font-micro)', fontWeight: 700,
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
  background: 'var(--color-grey-white)', color: 'var(--color-heading)', cursor: 'pointer',
};

export default function EditLockBanner({
  lockingAvailable, holderName, isMine, releaseRequestedByName, blockedBy,
  onRequestRelease, onRelease, onDecline, requested = false,
}: EditLockBannerProps): React.JSX.Element | null {
  // Nothing to say on a database with no lock table.
  if (!lockingAvailable) return null;

  // 2. I hold it and someone is waiting.
  if (isMine && releaseRequestedByName) {
    return (
      <div
        data-testid="editlock-request"
        style={{ ...wrap, background: 'var(--color-gold-light)', border: '1px solid var(--color-gold)', color: 'var(--color-gold-dark)' }}
      >
        <span style={{ fontWeight: 700 }}>{releaseRequestedByName} is waiting to edit.</span>
        <span style={{ color: 'var(--color-heading)' }}>
          They have asked you to save and release the project.
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onRelease} data-testid="editlock-accept"
          style={{ ...btn, background: 'var(--color-navy)', color: '#fff', border: 'none' }}>
          Save and release
        </button>
        <button type="button" onClick={onDecline} data-testid="editlock-decline" style={btn}>
          Keep editing
        </button>
      </div>
    );
  }

  // 1. Someone else is editing.
  const other = holderName ?? blockedBy;
  if (other && !isMine) {
    return (
      <div
        data-testid="editlock-held"
        style={{ ...wrap, background: 'var(--color-grey-pale)', border: '1px solid var(--color-border)', color: 'var(--color-heading)' }}
      >
        <span style={{ fontWeight: 700 }}>{other} is editing this project.</span>
        <span style={{ color: 'var(--color-meta)' }}>
          You can look around, and your changes will not be saved while they hold it.
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button" onClick={onRequestRelease} disabled={requested}
          data-testid="editlock-request-release"
          title={requested
            ? 'They have been asked. They can save and release, or keep editing.'
            : 'Ask them to save and hand the project over'}
          style={{ ...btn, cursor: requested ? 'default' : 'pointer', color: requested ? 'var(--color-meta)' : 'var(--color-heading)' }}
        >
          {requested ? 'Requested' : 'Ask them to release'}
        </button>
      </div>
    );
  }

  // Holding my own lock with nobody waiting is just editing.
  return null;
}
