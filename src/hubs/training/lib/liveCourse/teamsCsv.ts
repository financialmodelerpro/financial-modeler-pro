/**
 * Parse a downloaded Microsoft Teams attendance report (the admin's fallback
 * when Graph is not available). Pure.
 *
 * Teams exports a tab-separated file (often UTF-16; the browser decodes it
 * before upload) in sections:
 *   "1. Summary"                (Start time, End time, Meeting duration)
 *   "2. Participants"           (Name, First Join, Last Leave, In-Meeting Duration, Email, ...)
 *   "3. In-Meeting Activities"  (Name, Join Time, Leave Time, Duration, Email, Role)
 * Every join/leave pair in section 3 is an interval. When section 3 is
 * missing, section 2 gives one interval per person (first join to last leave)
 * capped by their in-meeting duration. The older single-table format
 * ("Full Name / User Action / Timestamp") is read as Joined/Left pairs.
 *
 * Teams writes times in the ORGANIZER's local time with no zone, so the
 * caller passes the zone (KSA by default) and the date order (M/D or D/M,
 * detected when a day above 12 appears).
 */
import { zonedWallTimeToUtc, KSA_TZ } from './time';
import type { RawAttendee, Interval } from './attendance';

export interface ParsedTeamsReport {
  attendees: RawAttendee[];
  meetingStart: number | null;
  meetingEnd: number | null;
  format: 'activities' | 'participants' | 'legacy';
  warnings: string[];
}

const splitRow = (line: string, delim: string): string[] => {
  if (delim === '\t') return line.split('\t').map((c) => c.trim().replace(/^"|"$/g, ''));
  // Comma CSV with quotes.
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
};

/** "2h 30m 52s", "45m 3s", "52s", "01:02:03" to seconds. */
export function parseDurationSeconds(s: string): number {
  const t = (s ?? '').trim();
  const hms = /^(\d+):(\d{2}):(\d{2})$/.exec(t);
  if (hms) return +hms[1] * 3600 + +hms[2] * 60 + +hms[3];
  let total = 0; let hit = false;
  for (const m of t.matchAll(/(\d+)\s*(h|m|s)/gi)) {
    hit = true;
    total += +m[1] * (m[2].toLowerCase() === 'h' ? 3600 : m[2].toLowerCase() === 'm' ? 60 : 1);
  }
  return hit ? total : 0;
}

/** A Teams timestamp ("11/8/26, 7:00:12 PM", "2026-11-08 19:00:12", ISO) to epoch ms. */
export function parseTeamsTime(raw: string, timeZone: string, order: 'MDY' | 'DMY'): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) { const t = Date.parse(s); return Number.isFinite(t) ? t : null; }
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  let y: number, mo: number, d: number, h: number, mi: number, sec: number;
  if (iso) {
    [y, mo, d, h, mi, sec] = [+iso[1], +iso[2], +iso[3], +iso[4], +iso[5], +(iso[6] ?? 0)];
  } else {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(s);
    if (!m) return null;
    const a = +m[1], b = +m[2];
    [mo, d] = order === 'DMY' ? [b, a] : [a, b];
    y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    h = +m[4]; mi = +m[5]; sec = +(m[6] ?? 0);
    const ap = m[7]?.toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const utc = zonedWallTimeToUtc(`${y}-${pad(mo)}-${pad(d)}`, `${pad(h)}:${pad(mi)}`, timeZone);
  return utc ? Date.parse(utc) + sec * 1000 : null;
}

/** M/D unless a first number above 12 proves D/M. */
function detectOrder(lines: string[]): 'MDY' | 'DMY' {
  for (const l of lines) {
    for (const m of l.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)) {
      if (+m[1] > 12) return 'DMY';
      if (+m[2] > 12) return 'MDY';
    }
  }
  return 'MDY';
}

export function parseTeamsAttendanceCsv(
  text: string,
  opts: { timeZone?: string; dateOrder?: 'MDY' | 'DMY' } = {},
): ParsedTeamsReport {
  const tz = opts.timeZone || KSA_TZ;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const delim = lines.some((l) => l.includes('\t')) ? '\t' : ',';
  const order = opts.dateOrder ?? detectOrder(lines);
  const warnings: string[] = [];
  const t = (v: string) => parseTeamsTime(v, tz, order);

  // Summary: meeting start and end.
  let meetingStart: number | null = null, meetingEnd: number | null = null;
  for (const l of lines) {
    const c = splitRow(l, delim);
    const k = (c[0] ?? '').toLowerCase();
    if (k === 'start time' || k === 'meeting start time') meetingStart = t(c[1] ?? '');
    if (k === 'end time' || k === 'meeting end time') meetingEnd = t(c[1] ?? '');
  }

  const findHeader = (pred: (cols: string[]) => boolean): number =>
    lines.findIndex((l) => pred(splitRow(l, delim).map((c) => c.toLowerCase())));
  const col = (cols: string[], ...names: string[]) => cols.findIndex((c) => names.includes(c));
  const readTable = (h: number): string[][] => {
    const out: string[][] = [];
    for (let i = h + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim() || /^\d+\.\s/.test(l.trim())) break;
      out.push(splitRow(l, delim));
    }
    return out;
  };

  // 3. In-Meeting Activities: one row per join/leave.
  const actH = findHeader((c) => c.includes('join time') && c.includes('leave time'));
  if (actH >= 0) {
    const head = splitRow(lines[actH], delim).map((c) => c.toLowerCase());
    const iName = col(head, 'name', 'full name'), iJoin = col(head, 'join time'), iLeave = col(head, 'leave time');
    const iEmail = col(head, 'email', 'participant id (upn)'), iRole = col(head, 'role'), iDur = col(head, 'duration');
    const attendees: RawAttendee[] = [];
    for (const r of readTable(actH)) {
      const a = t(r[iJoin] ?? '');
      let b = t(r[iLeave] ?? '');
      if (a != null && b == null && iDur >= 0) b = a + parseDurationSeconds(r[iDur] ?? '') * 1000;
      if (a == null || b == null) { warnings.push(`Skipped a row with unreadable times: ${r.join(' | ').slice(0, 80)}`); continue; }
      attendees.push({ email: r[iEmail] || null, name: r[iName] || null, role: iRole >= 0 ? r[iRole] : null, intervals: [[a, b] as Interval] });
    }
    return { attendees, meetingStart, meetingEnd, format: 'activities', warnings };
  }

  // 2. Participants: first join to last leave, capped by the in-meeting duration.
  const partH = findHeader((c) => c.includes('first join') && (c.includes('last leave') || c.includes('in-meeting duration')));
  if (partH >= 0) {
    const head = splitRow(lines[partH], delim).map((c) => c.toLowerCase());
    const iName = col(head, 'name', 'full name'), iFirst = col(head, 'first join'), iLast = col(head, 'last leave');
    const iDur = col(head, 'in-meeting duration', 'duration'), iEmail = col(head, 'email', 'participant id (upn)'), iRole = col(head, 'role');
    const attendees: RawAttendee[] = [];
    for (const r of readTable(partH)) {
      const a = t(r[iFirst] ?? '');
      const dur = iDur >= 0 ? parseDurationSeconds(r[iDur] ?? '') : 0;
      const lastLeave = iLast >= 0 ? t(r[iLast] ?? '') : null;
      // Without per-join rows, the duration is the honest figure: a span from
      // first join to last leave would credit time spent away.
      const end = a != null && dur > 0 ? a + dur * 1000 : lastLeave;
      if (a == null || end == null) { warnings.push(`Skipped a row with unreadable times: ${r.join(' | ').slice(0, 80)}`); continue; }
      attendees.push({ email: r[iEmail] || null, name: r[iName] || null, role: iRole >= 0 ? r[iRole] : null, intervals: [[a, end] as Interval] });
    }
    warnings.push('This file has no In-Meeting Activities section, so each person is credited their total in-meeting duration from their first join.');
    return { attendees, meetingStart, meetingEnd, format: 'participants', warnings };
  }

  // Legacy: Full Name / User Action / Timestamp.
  const legH = findHeader((c) => c.includes('user action') && c.includes('timestamp'));
  if (legH >= 0) {
    const head = splitRow(lines[legH], delim).map((c) => c.toLowerCase());
    const iName = col(head, 'full name', 'name'), iAct = col(head, 'user action'), iTs = col(head, 'timestamp');
    const open = new Map<string, number>();
    const byName = new Map<string, Interval[]>();
    let last = 0;
    for (const r of readTable(legH)) {
      const name = r[iName] ?? '';
      const ts = t(r[iTs] ?? '');
      if (ts == null) continue;
      last = Math.max(last, ts);
      if (/join/i.test(r[iAct] ?? '')) open.set(name, ts);
      else if (/left/i.test(r[iAct] ?? '') && open.has(name)) {
        byName.set(name, [...(byName.get(name) ?? []), [open.get(name)!, ts]]);
        open.delete(name);
      }
    }
    for (const [name, a] of open) byName.set(name, [...(byName.get(name) ?? []), [a, meetingEnd ?? last]]);
    warnings.push('This older report format has names but no emails; every row will need a manual match.');
    return {
      attendees: [...byName].map(([name, iv]) => ({ email: null, name, intervals: iv })),
      meetingStart, meetingEnd, format: 'legacy', warnings,
    };
  }

  throw new Error('This does not look like a Teams attendance report (no "Join Time / Leave Time" or "First Join" table found).');
}
