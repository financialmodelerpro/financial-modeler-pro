import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { adminEmail } from '@/src/hubs/training/lib/liveCourse/adminGuard';
import {
  syncSessionFromGraph, importSessionCsv, matchAttendee, setManualAttendance, realGraph, loadSessionJoiners,
} from '@/src/hubs/training/lib/liveCourse/attendanceSync';
import { parseTeamsAttendanceCsv } from '@/src/hubs/training/lib/liveCourse/teamsCsv';
import { listEnrolledStudents } from '@/src/hubs/training/lib/liveCourse/enrolledStudents';
import { isTeamsConfigured } from '@/src/integrations/teams/teamsMeetings';
import { matchByName, excludedReason, type NameSuggestion } from '@/src/hubs/training/lib/liveCourse/nameMatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET: the session's attendance rows, unmatched list and enrolled students,
 * plus, for each unmatched guest (no email), the students who clicked Join for
 * this session whose names are likely (nameMatch.ts), best first.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const sb = getServerClient();
  const [{ data: session }, { data: rows }] = await Promise.all([
    sb.from('live_sessions').select('id, title, course_code, course_session_no, scheduled_datetime, duration_minutes, attendance_synced_at, attendance_sync_error, actual_start_at, actual_end_at, graph_online_meeting_id').eq('id', id).maybeSingle(),
    sb.from('live_session_attendance').select('attendee_email, attendee_name, student_email, matched_by, attended_seconds, session_seconds, attended_pct, source, role, synced_at').eq('session_id', id).order('attended_pct', { ascending: false }),
  ]);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const students = session.course_code ? await listEnrolledStudents(sb, session.course_code as string) : [];
  // Host (organizer, co-organizer, the host account) and bots / assistants: flagged, never students.
  const hostEmail = process.env.TEAMS_HOST_USER_EMAIL ?? null;
  const flagged = (rows ?? []).map((r) => ({ ...r, excluded: r.student_email ? null : excludedReason({ role: r.role as string | null, email: r.attendee_email as string, name: r.attendee_name as string | null }, hostEmail) }));
  const guests = flagged.filter((r) => !r.student_email && !r.excluded && String(r.attendee_email).startsWith('noemail:'));
  const suggestions: Record<string, NameSuggestion[]> = {};
  if (guests.length) {
    const joiners = await loadSessionJoiners(sb, id);
    for (const g of guests) suggestions[g.attendee_email as string] = matchByName(g.attendee_name as string | null, joiners).suggestions;
  }
  return NextResponse.json({ session, rows: flagged, students, suggestions, teamsConfigured: isTeamsConfigured() });
}

/**
 * POST { action: 'sync' }                                   pull from Microsoft Graph
 * POST { action: 'csv', text, timeZone?, dateOrder? }       import a Teams report file
 * POST { action: 'match', attendeeEmail, studentEmail, remember }
 * POST { action: 'manual', studentEmail, attendedPct }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const by = await adminEmail();
  if (!by) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const sb = getServerClient();
  try {
    switch (body.action) {
      case 'sync': {
        if (!isTeamsConfigured()) return NextResponse.json({ error: 'Microsoft Teams is not configured on the server (AZURE_* env vars). Use the CSV upload.' }, { status: 400 });
        return NextResponse.json({ ok: true, result: await syncSessionFromGraph(sb, id, await realGraph(), by) });
      }
      case 'csv': {
        const text = typeof body.text === 'string' ? body.text : '';
        if (!text.trim()) return NextResponse.json({ error: 'The file is empty.' }, { status: 400 });
        if (text.length > 5_000_000) return NextResponse.json({ error: 'The file is too large.' }, { status: 400 });
        const parsed = parseTeamsAttendanceCsv(text, {
          timeZone: typeof body.timeZone === 'string' ? body.timeZone : undefined,
          dateOrder: body.dateOrder === 'DMY' || body.dateOrder === 'MDY' ? body.dateOrder : undefined,
        });
        const result = await importSessionCsv(sb, id, parsed, by);
        return NextResponse.json({ ok: true, result, format: parsed.format, warnings: parsed.warnings });
      }
      case 'match': {
        const r = await matchAttendee(sb, {
          sessionId: id,
          attendeeEmail: String(body.attendeeEmail ?? ''),
          studentEmail: String(body.studentEmail ?? ''),
          remember: body.remember === true,
          by,
        });
        return NextResponse.json({ ok: true, ...r });
      }
      case 'manual': {
        const pct = Number(body.attendedPct);
        if (!Number.isFinite(pct)) return NextResponse.json({ error: 'Enter a percentage.' }, { status: 400 });
        await setManualAttendance(sb, { sessionId: id, studentEmail: String(body.studentEmail ?? ''), attendedPct: pct, by });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, detail: (e as { detail?: string }).detail ?? null }, { status: 400 });
  }
}
