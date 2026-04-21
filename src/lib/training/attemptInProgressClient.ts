/**
 * Browser-side client for the in-progress attempt timer routes
 * (`/api/training/assessment/{start,pause,resume,state}`).
 *
 * Both assessment surfaces (3SFM/BVM cert path + live-session quizzes) share
 * this client. Server is the deadline source of truth; the client just
 * mirrors `ServerAttemptState` for display and re-syncs on visibility change.
 */

export interface ServerAttemptState {
  startedAt:               string;
  expiresAt:               string;
  paused:                  boolean;
  pausedAt:                string | null;
  graceSecondsRemaining:   number;
  graceSecondsUsed:        number;
  graceSecondsMax:         number;
  pauseCount:              number;
  maxPauses:               number;
  pauseAllowed:            boolean;
  isFinal:                 boolean;
  secondsRemaining:        number;
}

export interface AttemptIdentifier {
  tabKey?:        string;
  sessionId?:     string;
  attemptNumber:  number;
}

export async function startAttemptApi(
  idn: AttemptIdentifier,
  timerMinutes: number | null,
  isFinal: boolean,
): Promise<ServerAttemptState | null> {
  try {
    const res = await fetch('/api/training/assessment/start', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...idn, timerMinutes, isFinal }),
    });
    if (!res.ok) return null;
    return await res.json() as ServerAttemptState;
  } catch { return null; }
}

export async function pauseAttemptApi(idn: AttemptIdentifier): Promise<{ ok: boolean; state?: ServerAttemptState; code?: string }> {
  try {
    const res = await fetch('/api/training/assessment/pause', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(idn),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, state: j as ServerAttemptState };
    return { ok: false, code: j?.code, state: j?.state ?? undefined };
  } catch { return { ok: false }; }
}

export async function resumeAttemptApi(idn: AttemptIdentifier): Promise<ServerAttemptState | null> {
  try {
    const res = await fetch('/api/training/assessment/resume', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(idn),
    });
    if (!res.ok) return null;
    return await res.json() as ServerAttemptState;
  } catch { return null; }
}

export async function getAttemptStateApi(idn: AttemptIdentifier): Promise<ServerAttemptState | null> {
  try {
    const qs = new URLSearchParams();
    if (idn.tabKey)    qs.set('tabKey',    idn.tabKey);
    if (idn.sessionId) qs.set('sessionId', idn.sessionId);
    qs.set('attemptNumber', String(idn.attemptNumber));
    const res = await fetch(`/api/training/assessment/state?${qs.toString()}`);
    if (!res.ok) return null;
    const j = await res.json() as { exists: boolean } & ServerAttemptState;
    return j.exists ? j : null;
  } catch { return null; }
}

/**
 * Best-effort beforeunload pause. Uses fetch keepalive so the request
 * survives page tear-down. No response handling.
 */
export function firePauseOnUnload(idn: AttemptIdentifier): void {
  try {
    fetch('/api/training/assessment/pause', {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body:      JSON.stringify(idn),
      keepalive: true,
    }).catch(() => { /* ignore */ });
  } catch { /* ignore */ }
}
