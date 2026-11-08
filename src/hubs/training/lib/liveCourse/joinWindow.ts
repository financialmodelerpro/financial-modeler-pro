/**
 * THE join window and THE session state, for every live session.
 *
 * Before this there were two Join rules (open from registration on the
 * detail page, open from 30 minutes before to 3 hours after on the dashboard
 * cards) and a session state that turned an upcoming session into "recorded"
 * the moment it STARTED, which hid the Join card exactly when people needed it.
 * Now: Join is open from `opensMinutesBefore` before the start until the
 * scheduled end, and a session is live from its start to its end.
 */

export const DEFAULT_DURATION_MINUTES = 90;
export const DEFAULT_OPENS_MINUTES_BEFORE = 30;

export interface JoinTiming {
  scheduled_datetime?: string | null;
  duration_minutes?: number | null;
}

export interface JoinWindow { opensAt: string; closesAt: string; startsAt: string }

/** The window, or null when the session has no valid start time. */
export function joinWindowFor(s: JoinTiming, opensMinutesBefore: number): JoinWindow | null {
  if (!s.scheduled_datetime) return null;
  const start = new Date(s.scheduled_datetime).getTime();
  if (!Number.isFinite(start)) return null;
  const dur = s.duration_minutes && s.duration_minutes > 0 ? s.duration_minutes : DEFAULT_DURATION_MINUTES;
  const before = Math.max(0, opensMinutesBefore);
  return {
    opensAt:  new Date(start - before * 60_000).toISOString(),
    startsAt: new Date(start).toISOString(),
    closesAt: new Date(start + dur * 60_000).toISOString(),
  };
}

export type JoinState = 'no-time' | 'before' | 'open' | 'ended';

export function joinStateAt(now: Date | number, w: JoinWindow | null): JoinState {
  if (!w) return 'no-time';
  const t = typeof now === 'number' ? now : now.getTime();
  if (t < new Date(w.opensAt).getTime()) return 'before';
  if (t <= new Date(w.closesAt).getTime()) return 'open';
  return 'ended';
}

/**
 * The state a student sees. An admin's 'recorded' always wins; otherwise
 * upcoming until the start, live until the scheduled end, recorded after.
 */
export function effectiveSessionType(
  s: JoinTiming & { session_type?: string | null },
  now: Date | number = Date.now(),
): 'upcoming' | 'live' | 'recorded' {
  if (s.session_type === 'recorded') return 'recorded';
  const w = joinWindowFor(s, 0);
  if (!w) return s.session_type === 'live' ? 'live' : 'upcoming';
  const t = typeof now === 'number' ? now : now.getTime();
  if (t < new Date(w.startsAt).getTime()) return s.session_type === 'live' ? 'live' : 'upcoming';
  if (t <= new Date(w.closesAt).getTime()) return 'live';
  return 'recorded';
}
