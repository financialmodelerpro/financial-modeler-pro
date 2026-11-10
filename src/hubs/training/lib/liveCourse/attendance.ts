/**
 * Attendance arithmetic for live sessions. Pure: no database, no Graph.
 *
 * Rules (founder decisions 2026-11-08):
 *   - a person who joins and leaves several times is credited the SUM of their
 *     intervals, with overlaps merged (two devices at once count once);
 *   - intervals are clipped to the meeting window, so time in the lobby before
 *     the start or after the end never inflates the share;
 *   - the share is attended seconds over the session length: the ACTUAL
 *     meeting length from the report, falling back to the scheduled length,
 *     capped at 100%;
 *   - the same person under one email across several reports (a meeting that
 *     was restarted) is one row.
 */

export type Interval = [number, number]; // epoch ms, start < end

export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function clipIntervals(list: Interval[], from: number | null, to: number | null): Interval[] {
  return list
    .map(([a, b]) => [from != null ? Math.max(a, from) : a, to != null ? Math.min(b, to) : b] as Interval)
    .filter(([a, b]) => b > a);
}

export const totalSeconds = (list: Interval[]): number =>
  Math.round(list.reduce((s, [a, b]) => s + (b - a), 0) / 1000);

export function attendedPct(attendedSeconds: number, sessionSeconds: number): number {
  if (!(sessionSeconds > 0)) return 0;
  return Math.min(100, Math.round((attendedSeconds / sessionSeconds) * 10000) / 100);
}

/** One attendee as a report source describes them (Graph or CSV). */
export interface RawAttendee {
  email: string | null;
  name: string | null;
  role?: string | null;
  intervals: Interval[];
  /** Used only when a source gives a duration without join/leave times. */
  fallbackSeconds?: number;
}

export interface AttendanceRow {
  attendee_email: string;
  attendee_name: string | null;
  role: string | null;
  intervals: [string, string][];
  attended_seconds: number;
  session_seconds: number;
  attended_pct: number;
}

/** Key for an attendee: the email, or a name-based key when Teams gave none. */
export function attendeeKey(email: string | null | undefined, name: string | null | undefined): string {
  const e = (email ?? '').trim().toLowerCase();
  if (e.includes('@')) return e;
  const n = (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `noemail:${n || 'unknown'}`;
}

export function buildAttendanceRows(
  raw: RawAttendee[],
  window: { start: number | null; end: number | null },
  sessionSeconds: number,
): AttendanceRow[] {
  const byKey = new Map<string, { name: string | null; role: string | null; iv: Interval[]; fallback: number }>();
  for (const a of raw) {
    const key = attendeeKey(a.email, a.name);
    const cur = byKey.get(key) ?? { name: a.name ?? null, role: a.role ?? null, iv: [], fallback: 0 };
    cur.iv.push(...a.intervals);
    cur.fallback += a.fallbackSeconds ?? 0;
    if (!cur.name && a.name) cur.name = a.name;
    // Organizer and co-organizer outrank presenter; presenter outranks attendee.
    if (a.role && /organi[sz]er/i.test(a.role)) cur.role = a.role;
    else if (a.role === 'Presenter' && !(cur.role && /organi[sz]er/i.test(cur.role))) cur.role = a.role;
    byKey.set(key, cur);
  }
  const rows: AttendanceRow[] = [];
  for (const [key, v] of byKey) {
    const merged = mergeIntervals(clipIntervals(v.iv, window.start, window.end));
    let seconds = totalSeconds(merged);
    if (seconds === 0 && v.iv.length === 0 && v.fallback > 0) seconds = Math.min(v.fallback, sessionSeconds);
    rows.push({
      attendee_email: key,
      attendee_name: v.name,
      role: v.role,
      intervals: merged.map(([a, b]) => [new Date(a).toISOString(), new Date(b).toISOString()]),
      attended_seconds: seconds,
      session_seconds: sessionSeconds,
      attended_pct: attendedPct(seconds, sessionSeconds),
    });
  }
  return rows.sort((x, y) => y.attended_seconds - x.attended_seconds);
}

/** Graph records to raw attendees. */
export function rawFromGraph(records: {
  emailAddress?: string | null;
  identity?: { displayName?: string | null } | null;
  role?: string | null;
  totalAttendanceInSeconds: number;
  attendanceIntervals: { joinDateTime: string | null; leaveDateTime: string | null; durationInSeconds: number }[];
}[]): RawAttendee[] {
  return records.map((r) => {
    const intervals: Interval[] = [];
    for (const i of r.attendanceIntervals ?? []) {
      if (!i.joinDateTime) continue;
      const a = new Date(i.joinDateTime).getTime();
      const b = i.leaveDateTime ? new Date(i.leaveDateTime).getTime() : a + (i.durationInSeconds ?? 0) * 1000;
      intervals.push([a, b]);
    }
    return {
      email: r.emailAddress ?? null,
      name: r.identity?.displayName ?? null,
      role: r.role ?? null,
      intervals,
      fallbackSeconds: intervals.length ? 0 : r.totalAttendanceInSeconds ?? 0,
    };
  });
}

/** Match a Teams email to a platform student: exact email first, then a remembered alias. */
export function matchStudent(
  attendeeEmail: string,
  studentEmails: Set<string>,
  aliases: Map<string, string>,
): { studentEmail: string | null; matchedBy: 'email' | 'alias' | null } {
  if (studentEmails.has(attendeeEmail)) return { studentEmail: attendeeEmail, matchedBy: 'email' };
  const alias = aliases.get(attendeeEmail);
  if (alias) return { studentEmail: alias, matchedBy: 'alias' };
  return { studentEmail: null, matchedBy: null };
}
