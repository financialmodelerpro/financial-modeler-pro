/**
 * Store a session's attendance (from Graph or a CSV) and match it to students.
 *
 * - Matching: the Teams email against platform student emails, then remembered
 *   aliases (student_email_aliases, which also hold a guest's display name as
 *   "noemail:<name>"), then, for a guest with no email, the display name
 *   against the students who clicked Join for that session (nameMatch.ts: one
 *   clear match only). Anything else is UNMATCHED and listed for the admin
 *   with the likely students suggested, never guessed.
 * - A row an admin set by hand (source 'manual', or matched_by 'manual') is
 *   never overwritten by a later sync: the admin's answer stands.
 * - Graph is injected, so the whole path runs in the verifier on a sample
 *   report with no Microsoft tenant.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAttendanceRows, matchStudent, rawFromGraph, type AttendanceRow, type RawAttendee } from './attendance';
import { DEFAULT_DURATION_MINUTES } from './joinWindow';
import { matchByName, excludedReason, type NameCandidate } from './nameMatch';
import type { GraphAttendanceRecord, GraphAttendanceReport } from '@/src/integrations/teams/teamsMeetings';

export interface GraphDeps {
  resolveMeetingId(joinUrl: string): Promise<string>;
  listReports(meetingId: string): Promise<GraphAttendanceReport[]>;
  getRecords(meetingId: string, reportId: string): Promise<GraphAttendanceRecord[]>;
}

export interface SessionRowForSync {
  id: string;
  live_url: string | null;
  scheduled_datetime: string | null;
  duration_minutes: number | null;
  graph_online_meeting_id: string | null;
  course_code: string | null;
}

export const SYNC_SESSION_COLUMNS = 'id, live_url, scheduled_datetime, duration_minutes, graph_online_meeting_id, course_code';

export interface ApplyResult {
  saved: number; matched: number; unmatched: number; keptManual: number;
  /** Linked by display name (a guest with no email). */
  byName: number;
  /** Name matches left unmatched because mig 254 (matched_by 'name') is not applied yet. */
  nameMatchesHeld: number;
  /** The host and bots / assistants (not students, not on the unmatched list). */
  excluded: number;
}

/** Platform student emails among a set of attendee keys, plus aliases (email or "noemail:<name>" keys). */
async function loadMatchers(sb: SupabaseClient, keys: string[]): Promise<{ students: Set<string>; aliases: Map<string, string> }> {
  const real = keys.filter((e) => e.includes('@'));
  const aliasKeys = keys.filter((k) => k.includes('@') || (k.startsWith('noemail:') && k !== 'noemail:unknown'));
  const students = new Set<string>();
  const aliases = new Map<string, string>();
  for (let i = 0; i < real.length; i += 200) {
    const { data: metas } = await sb.from('training_registrations_meta').select('email').in('email', real.slice(i, i + 200));
    for (const m of metas ?? []) if (m.email) students.add(String(m.email).toLowerCase());
  }
  for (let i = 0; i < aliasKeys.length; i += 200) {
    const { data: al } = await sb.from('student_email_aliases').select('alias_email, student_email').in('alias_email', aliasKeys.slice(i, i + 200));
    for (const a of al ?? []) aliases.set(a.alias_email as string, a.student_email as string);
  }
  return { students, aliases };
}

/**
 * The students who clicked Join for this session (the logged join route), with
 * their registered names: the only candidates for a name match.
 */
export async function loadSessionJoiners(sb: SupabaseClient, sessionId: string): Promise<NameCandidate[]> {
  const { data: clicks } = await sb.from('live_session_join_clicks').select('student_email').eq('session_id', sessionId);
  const emails = [...new Set((clicks ?? []).map((c) => String(c.student_email ?? '').toLowerCase()).filter(Boolean))];
  const out: NameCandidate[] = [];
  for (let i = 0; i < emails.length; i += 200) {
    const { data: metas } = await sb.from('training_registrations_meta').select('email, name').in('email', emails.slice(i, i + 200));
    for (const m of metas ?? []) if (m.email && m.name) out.push({ email: String(m.email).toLowerCase(), name: String(m.name) });
  }
  return out;
}

export async function applyAttendanceRows(
  sb: SupabaseClient,
  sessionId: string,
  rows: AttendanceRow[],
  source: 'graph' | 'csv',
  meta: { reportId?: string | null; by?: string | null } = {},
): Promise<ApplyResult> {
  const res: ApplyResult = { saved: 0, matched: 0, unmatched: 0, keptManual: 0, byName: 0, nameMatchesHeld: 0, excluded: 0 };
  if (!rows.length) return res;
  const { students, aliases } = await loadMatchers(sb, rows.map((r) => r.attendee_email));
  const { data: existing } = await sb
    .from('live_session_attendance')
    .select('attendee_email, source, matched_by, student_email')
    .eq('session_id', sessionId);
  const prior = new Map((existing ?? []).map((e) => [e.attendee_email as string, e]));
  // Loaded only when a guest with no email needs it.
  let joiners: NameCandidate[] | null = null;

  for (const r of rows) {
    const before = prior.get(r.attendee_email);
    if (before && (before.source === 'manual')) { res.keptManual++; continue; }
    // A manual MATCH survives a re-sync: refresh the minutes, keep the student.
    const keepMatch = before && before.matched_by === 'manual' && before.student_email;
    // The host (organizer, co-organizer, the host account) and bots or
    // assistants are never students: no email, alias or name match, and never
    // on the unmatched list (the admin shows them apart).
    const notStudent = excludedReason({ role: r.role, email: r.attendee_email, name: r.attendee_name }, process.env.TEAMS_HOST_USER_EMAIL ?? null);
    let m: { studentEmail: string | null; matchedBy: 'email' | 'alias' | 'name' | 'manual' | null } = keepMatch
      ? { studentEmail: before!.student_email as string, matchedBy: 'manual' as const }
      : notStudent ? { studentEmail: null, matchedBy: null } : matchStudent(r.attendee_email, students, aliases);
    if (!notStudent && !m.studentEmail && r.attendee_email.startsWith('noemail:')) {
      joiners ??= await loadSessionJoiners(sb, sessionId);
      const byName = matchByName(r.attendee_name, joiners);
      if (byName.studentEmail) m = { studentEmail: byName.studentEmail, matchedBy: 'name' };
    }
    const write = (mm: typeof m) => sb.from('live_session_attendance').upsert({
      session_id: sessionId,
      attendee_email: r.attendee_email,
      attendee_name: r.attendee_name,
      student_email: mm.studentEmail,
      matched_by: mm.matchedBy,
      intervals: r.intervals,
      attended_seconds: r.attended_seconds,
      session_seconds: r.session_seconds,
      attended_pct: r.attended_pct,
      source,
      role: r.role,
      report_id: meta.reportId ?? null,
      synced_at: new Date().toISOString(),
      updated_by: meta.by ?? null,
    }, { onConflict: 'session_id,attendee_email' });
    let { error } = await write(m);
    // Before mig 254 the column refuses 'name': keep the record UNMATCHED (the
    // admin sees the student suggested) rather than fail the whole sync.
    if (error && m.matchedBy === 'name' && /matched_by_check|check constraint/i.test(error.message)) {
      res.nameMatchesHeld++;
      m = { studentEmail: null, matchedBy: null };
      ({ error } = await write(m));
    }
    if (error) throw new Error(`saving attendance failed: ${error.message}`);
    res.saved++;
    if (m.matchedBy === 'name') res.byName++;
    if (m.studentEmail) res.matched++; else if (notStudent) res.excluded++; else res.unmatched++;
  }
  return res;
}

/** The scheduled length in seconds (the fallback denominator). */
export function scheduledSeconds(s: { duration_minutes: number | null }): number {
  return (s.duration_minutes && s.duration_minutes > 0 ? s.duration_minutes : DEFAULT_DURATION_MINUTES) * 60;
}

/**
 * Reports that belong to THIS session: started within six hours of the
 * scheduled start (a reused meeting link would otherwise pull other weeks).
 */
export function reportsForSession(reports: GraphAttendanceReport[], scheduledIso: string | null): GraphAttendanceReport[] {
  if (!scheduledIso) return reports;
  const t = new Date(scheduledIso).getTime();
  return reports.filter((r) => {
    if (!r.meetingStartDateTime) return false;
    return Math.abs(new Date(r.meetingStartDateTime).getTime() - t) <= 6 * 3600_000;
  });
}

export interface SyncResult extends ApplyResult { reports: number; sessionSeconds: number }

export async function syncSessionFromGraph(
  sb: SupabaseClient,
  sessionId: string,
  graph: GraphDeps,
  by: string | null = null,
): Promise<SyncResult> {
  const { data } = await sb.from('live_sessions').select(SYNC_SESSION_COLUMNS).eq('id', sessionId).maybeSingle();
  const s = data as SessionRowForSync | null;
  if (!s) throw new Error('Session not found.');
  try {
    if (!s.live_url) throw new Error('This session has no Teams link to read attendance from.');
    let meetingId = s.graph_online_meeting_id;
    if (!meetingId) {
      meetingId = await graph.resolveMeetingId(s.live_url);
      await sb.from('live_sessions').update({ graph_online_meeting_id: meetingId }).eq('id', sessionId);
    }
    const reports = reportsForSession(await graph.listReports(meetingId), s.scheduled_datetime);
    if (!reports.length) throw new Error('Teams has no attendance report for this session yet (reports appear a few minutes after the meeting ends, and only if attendance reports are on).');

    const raw: RawAttendee[] = [];
    for (const rep of reports) raw.push(...rawFromGraph(await graph.getRecords(meetingId, rep.id)));
    const starts = reports.map((r) => r.meetingStartDateTime).filter(Boolean).map((x) => new Date(x as string).getTime());
    const ends = reports.map((r) => r.meetingEndDateTime).filter(Boolean).map((x) => new Date(x as string).getTime());
    const actualStart = starts.length ? Math.min(...starts) : null;
    const actualEnd = ends.length ? Math.max(...ends) : null;
    const sessionSeconds = actualStart != null && actualEnd != null && actualEnd > actualStart
      ? Math.round((actualEnd - actualStart) / 1000)
      : scheduledSeconds(s);

    const rows = buildAttendanceRows(raw, { start: actualStart, end: actualEnd }, sessionSeconds);
    const applied = await applyAttendanceRows(sb, sessionId, rows, 'graph', { reportId: reports.map((r) => r.id).join(','), by });
    await sb.from('live_sessions').update({
      attendance_synced_at: new Date().toISOString(),
      attendance_sync_error: null,
      actual_start_at: actualStart != null ? new Date(actualStart).toISOString() : null,
      actual_end_at: actualEnd != null ? new Date(actualEnd).toISOString() : null,
    }).eq('id', sessionId);
    return { ...applied, reports: reports.length, sessionSeconds };
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}${(e as { detail?: string }).detail ? ` (${(e as { detail?: string }).detail})` : ''}` : String(e);
    await sb.from('live_sessions').update({ attendance_sync_error: msg.slice(0, 1000) }).eq('id', sessionId);
    throw e;
  }
}

/**
 * CSV fallback: rows from a parsed Teams report. The denominator is the
 * report's own meeting window when it has one, else the scheduled length.
 */
export async function importSessionCsv(
  sb: SupabaseClient,
  sessionId: string,
  parsed: { attendees: RawAttendee[]; meetingStart: number | null; meetingEnd: number | null },
  by: string | null,
): Promise<SyncResult> {
  const { data } = await sb.from('live_sessions').select(SYNC_SESSION_COLUMNS).eq('id', sessionId).maybeSingle();
  const s = data as SessionRowForSync | null;
  if (!s) throw new Error('Session not found.');
  const hasWindow = parsed.meetingStart != null && parsed.meetingEnd != null && parsed.meetingEnd > parsed.meetingStart;
  const sessionSeconds = hasWindow ? Math.round((parsed.meetingEnd! - parsed.meetingStart!) / 1000) : scheduledSeconds(s);
  const rows = buildAttendanceRows(parsed.attendees, { start: hasWindow ? parsed.meetingStart : null, end: hasWindow ? parsed.meetingEnd : null }, sessionSeconds);
  const applied = await applyAttendanceRows(sb, sessionId, rows, 'csv', { by });
  await sb.from('live_sessions').update({
    attendance_synced_at: new Date().toISOString(),
    attendance_sync_error: null,
    ...(hasWindow ? { actual_start_at: new Date(parsed.meetingStart!).toISOString(), actual_end_at: new Date(parsed.meetingEnd!).toISOString() } : {}),
  }).eq('id', sessionId);
  return { ...applied, reports: 1, sessionSeconds };
}

/**
 * Manual match of an unmatched attendee. With `remember`, the alias is saved
 * and every other unmatched row with that Teams email is matched too.
 */
export async function matchAttendee(
  sb: SupabaseClient,
  p: { sessionId: string; attendeeEmail: string; studentEmail: string; remember: boolean; by: string | null },
): Promise<{ updated: number }> {
  const student = p.studentEmail.trim().toLowerCase();
  const { data: meta } = await sb.from('training_registrations_meta').select('email').eq('email', student).maybeSingle();
  if (!meta) throw new Error('No Training Hub student has that email.');
  let updated = 0;
  const { data: one } = await sb.from('live_session_attendance')
    .update({ student_email: student, matched_by: 'manual', updated_by: p.by })
    .eq('session_id', p.sessionId).eq('attendee_email', p.attendeeEmail).select('id');
  updated += one?.length ?? 0;
  // A guest's display name key ("noemail:<name>") is remembered too, so the same name matches in later sessions.
  const rememberable = p.attendeeEmail.includes('@') || (p.attendeeEmail.startsWith('noemail:') && p.attendeeEmail !== 'noemail:unknown');
  if (p.remember && rememberable && p.attendeeEmail !== student) {
    await sb.from('student_email_aliases').upsert({ alias_email: p.attendeeEmail, student_email: student, created_by: p.by }, { onConflict: 'alias_email' });
    const { data: others } = await sb.from('live_session_attendance')
      .update({ student_email: student, matched_by: 'alias', updated_by: p.by })
      .eq('attendee_email', p.attendeeEmail).is('student_email', null).select('id');
    updated += others?.length ?? 0;
  }
  return { updated };
}

/** Admin's own figure for a student (e.g. joined by phone). Never overwritten by a sync. */
export async function setManualAttendance(
  sb: SupabaseClient,
  p: { sessionId: string; studentEmail: string; attendedPct: number; by: string | null },
): Promise<void> {
  const student = p.studentEmail.trim().toLowerCase();
  const pct = Math.max(0, Math.min(100, Math.round(p.attendedPct * 100) / 100));
  const { data } = await sb.from('live_sessions').select(SYNC_SESSION_COLUMNS).eq('id', p.sessionId).maybeSingle();
  const s = data as SessionRowForSync | null;
  if (!s) throw new Error('Session not found.');
  const sessionSeconds = scheduledSeconds(s);
  const { error } = await sb.from('live_session_attendance').upsert({
    session_id: p.sessionId,
    attendee_email: student,
    student_email: student,
    matched_by: 'manual',
    intervals: [],
    attended_seconds: Math.round((pct / 100) * sessionSeconds),
    session_seconds: sessionSeconds,
    attended_pct: pct,
    source: 'manual',
    synced_at: new Date().toISOString(),
    updated_by: p.by,
  }, { onConflict: 'session_id,attendee_email' });
  if (error) throw new Error(`saving failed: ${error.message}`);
}

/**
 * The automatic pull, run by the daily cron: course sessions that ended at
 * least 30 minutes ago, within the last 7 days, never synced, with a Teams link.
 */
export async function autoSyncEndedSessions(
  sb: SupabaseClient,
  now: Date,
  graph: GraphDeps,
): Promise<{ tried: number; ok: number; failed: number }> {
  const { data } = await sb
    .from('live_sessions')
    .select(`${SYNC_SESSION_COLUMNS}, attendance_synced_at`)
    .not('course_code', 'is', null)
    .is('attendance_synced_at', null)
    .gte('scheduled_datetime', new Date(now.getTime() - 7 * 86400_000).toISOString())
    .lte('scheduled_datetime', now.toISOString());
  const out = { tried: 0, ok: 0, failed: 0 };
  for (const s of (data ?? []) as SessionRowForSync[]) {
    if (!s.live_url || !s.scheduled_datetime) continue;
    const endedAt = new Date(s.scheduled_datetime).getTime() + scheduledSeconds(s) * 1000;
    if (now.getTime() < endedAt + 30 * 60_000) continue;
    out.tried++;
    try { await syncSessionFromGraph(sb, s.id, graph, 'cron'); out.ok++; }
    catch (e) { out.failed++; console.error('[liveCourse/attendance] auto sync failed', { id: s.id, error: String(e) }); }
  }
  return out;
}

/** The real Graph, from the Teams integration. */
export async function realGraph(): Promise<GraphDeps> {
  const t = await import('@/src/integrations/teams/teamsMeetings');
  return { resolveMeetingId: t.resolveOnlineMeetingIdByJoinUrl, listReports: t.listAttendanceReports, getRecords: t.getAttendanceRecords };
}
