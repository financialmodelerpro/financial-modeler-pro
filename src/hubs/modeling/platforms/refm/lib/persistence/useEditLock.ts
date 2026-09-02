'use client';

/**
 * useEditLock.ts
 *
 * THE CLIENT HALF OF THE EDIT LOCK. Module 10 Collaboration, step 5.
 *
 * Acquires the lock when a project is being edited, heartbeats while it is,
 * and releases it when editing stops. Also surfaces who is editing when the
 * lock belongs to someone else, and carries the request / accept / decline
 * exchange.
 *
 * ── THE HEARTBEAT IS THE MECHANISM, NOT A BACKUP ──────────────────────────
 *
 * There is a `beforeunload` release below, and NOTHING depends on it. It does
 * not fire on a crash, a killed tab, a closed laptop or a dropped network, so
 * a design that relied on it would leak locks in exactly the cases that matter
 * most. It is sent because it makes the common case instant, and the heartbeat
 * expiry is what actually guarantees release.
 *
 * ── EVERY BEAT IS A RE-ACQUIRE ────────────────────────────────────────────
 *
 * The same endpoint acquires and refreshes. If the lock was stolen while this
 * tab was asleep or offline, the next beat says so and the UI can stop the
 * user before they keep editing against a lock they no longer hold.
 *
 * No em dashes in this file.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface EditLockState {
  /** Null when nobody holds it, or when the platform has no lock table. */
  holderName: string | null;
  holderUserId: string | null;
  isMine: boolean;
  /** Someone has asked ME to release. Null when nobody has. */
  releaseRequestedByName: string | null;
  /** False on a pre-233 database: there is no locking, and the UI says nothing
   *  about it rather than claiming a lock that does not exist. */
  lockingAvailable: boolean;
  /** Set when an acquire was refused because someone else is editing. */
  blockedBy: string | null;
}

const EMPTY: EditLockState = {
  holderName: null, holderUserId: null, isMine: false,
  releaseRequestedByName: null, lockingAvailable: true, blockedBy: null,
};

interface LockDto {
  holderName: string | null;
  holderUserId: string;
  isMine: boolean;
  releaseRequestedByName: string | null;
}

/**
 * @param projectId  the open project, or null when none is open
 * @param editing    whether this user is in edit mode. Acquiring and
 *                   heartbeating happen ONLY while true; a reader never takes
 *                   a lock, so simply opening a project does not block anyone.
 */
export function useEditLock(projectId: string | null, editing: boolean): EditLockState & {
  requestRelease: () => Promise<void>;
  decline: () => Promise<void>;
  release: () => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<EditLockState>(EMPTY);
  // The interval, held in a ref so an effect re-run does not stack timers.
  const beatRef = useRef<number>(0);
  const heartbeatSecondsRef = useRef<number>(30);

  const apply = useCallback((json: Record<string, unknown>, blocked: string | null): void => {
    const lock = (json.lock ?? null) as LockDto | null;
    setState({
      holderName: lock?.holderName ?? null,
      holderUserId: lock?.holderUserId ?? null,
      isMine: lock?.isMine === true,
      releaseRequestedByName: lock?.isMine ? (lock.releaseRequestedByName ?? null) : null,
      lockingAvailable: json.lockingAvailable !== false,
      blockedBy: blocked,
    });
  }, []);

  const read = useCallback(async (): Promise<void> => {
    if (!projectId) { setState(EMPTY); return; }
    try {
      const r = await fetch(`/api/refm/projects/${encodeURIComponent(projectId)}/lock`, { credentials: 'include' });
      if (!r.ok) return;
      const j = await r.json();
      if (typeof j.heartbeatSeconds === 'number') heartbeatSecondsRef.current = j.heartbeatSeconds;
      apply(j, null);
    } catch { /* a lock read must never break the page */ }
  }, [projectId, apply]);

  const beat = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    try {
      const r = await fetch(`/api/refm/projects/${encodeURIComponent(projectId)}/lock`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'acquire' }),
      });
      const j = await r.json();
      if (r.status === 409) {
        // Someone else holds it. Say who, and stop claiming it is ours.
        apply(j, (j.lock?.holderName as string) ?? 'Someone else');
        return;
      }
      if (!r.ok) return;
      apply(j, null);
    } catch { /* the next beat tries again */ }
  }, [projectId, apply]);

  // Read the holder whenever the project changes, so a reader sees who is
  // editing without taking anything.
  //
  // The lint rule cannot see through an async call: `read` awaits a fetch, so
  // its setState runs in a later microtask and is exactly the "setState in a
  // callback when external state changes" the rule permits, not a synchronous
  // cascade. Disabled narrowly rather than contorted, and the same rule already
  // fires on equivalent code elsewhere in this repo.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void read(); }, [read]);

  // Acquire + heartbeat, only while editing.
  //
  // Same rule, same reason: `beat` awaits a fetch before it touches state.
  useEffect(() => {
    if (!projectId || !editing) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void beat();
    const ms = Math.max(5, heartbeatSecondsRef.current) * 1000;
    beatRef.current = window.setInterval(() => { void beat(); }, ms);
    return () => {
      if (beatRef.current) { window.clearInterval(beatRef.current); beatRef.current = 0; }
    };
  }, [projectId, editing, beat]);

  // Release when editing stops, and on unload as a COURTESY only. Nothing
  // depends on either arriving: the heartbeat expiry is the guarantee.
  useEffect(() => {
    if (!projectId) return;
    const url = `/api/refm/projects/${encodeURIComponent(projectId)}/lock`;
    const onUnload = (): void => {
      // sendBeacon survives the page going away, where fetch may not. It
      // cannot send DELETE, so this posts a release marker the route reads as
      // one. If it never arrives, the lock ages out.
      try { navigator.sendBeacon?.(`${url}?release=1`, new Blob([], { type: 'text/plain' })); } catch { /* ignore */ }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('beforeunload', onUnload); };
  }, [projectId]);

  const release = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    try {
      await fetch(`/api/refm/projects/${encodeURIComponent(projectId)}/lock`,
        { method: 'DELETE', credentials: 'include' });
      await read();
    } catch { /* the lock ages out regardless */ }
  }, [projectId, read]);

  const act = useCallback(async (action: 'request-release' | 'decline'): Promise<void> => {
    if (!projectId) return;
    try {
      const r = await fetch(`/api/refm/projects/${encodeURIComponent(projectId)}/lock`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (r.ok) apply(await r.json(), state.blockedBy);
    } catch { /* nothing changes */ }
  }, [projectId, apply, state.blockedBy]);

  return {
    ...state,
    requestRelease: () => act('request-release'),
    decline: () => act('decline'),
    release,
    refresh: read,
  };
}
