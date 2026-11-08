import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import {
  isTeamsConfigured, resolveOnlineMeetingIdByJoinUrl, readMeetingSettings, listAttendanceReports,
  getAttendanceRecords, readClientSecretExpiry, applyMeetingSettings, TeamsIntegrationError,
} from '@/src/integrations/teams/teamsMeetings';

export const dynamic = 'force-dynamic';

/**
 * Admin diagnostics for the Teams integration, run on the server with the
 * production credentials. Read only unless ?apply=1 (re-applies the lobby
 * setting to the session's meeting). Never returns a join link or a secret.
 *   GET ?sessionId=<live_sessions.id>  meeting settings + attendance reports
 *   GET (no session)                   client secret expiry only
 */
async function checkAdmin() {
  try {
    const session = await getServerSession(authOptions);
    return !!(session?.user && (session.user as { role?: string }).role === 'admin');
  } catch { return false; }
}

const POLICY_MISSING = /No application access policy found/i;

function failure(step: string, e: unknown) {
  const err = e as TeamsIntegrationError;
  const text = `${err.message ?? String(e)}${err.detail ? `: ${err.detail}` : ''}`;
  return { step, ok: false, status: err.status ?? null, error: text, accessPolicyMissing: POLICY_MISSING.test(text) };
}

export async function GET(req: Request) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!isTeamsConfigured()) return NextResponse.json({ configured: false });
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');
  const out: Record<string, unknown> = { configured: true, secretExpiry: await readClientSecretExpiry() };
  if (!sessionId) return NextResponse.json(out);

  const sb = getServerClient();
  const { data: s } = await sb.from('live_sessions').select('id, title, live_url, scheduled_datetime').eq('id', sessionId).maybeSingle();
  if (!s) return NextResponse.json({ ...out, error: 'Session not found.' }, { status: 404 });
  out.session = { id: s.id, title: s.title, scheduled: s.scheduled_datetime, hasTeamsLink: !!s.live_url };
  if (!s.live_url) return NextResponse.json(out);

  let meetingId: string;
  try { meetingId = await resolveOnlineMeetingIdByJoinUrl(s.live_url as string); out.resolve = { ok: true }; }
  catch (e) { out.resolve = failure('resolve meeting from join link', e); return NextResponse.json(out); }

  if (url.searchParams.get('apply') === '1') out.apply = await applyMeetingSettings(s.live_url as string);
  try { out.settings = await readMeetingSettings(meetingId); } catch (e) { out.settings = failure('read meeting', e); }

  try {
    const reports = await listAttendanceReports(meetingId);
    out.reports = { ok: true, count: reports.length, list: reports.map((r) => ({ start: r.meetingStartDateTime, end: r.meetingEndDateTime, participants: r.totalParticipantCount ?? null })) };
    const latest = [...reports].sort((a, b) => String(b.meetingEndDateTime).localeCompare(String(a.meetingEndDateTime)))[0];
    if (latest) {
      const recs = await getAttendanceRecords(meetingId, latest.id);
      out.latestRecords = recs.map((r) => ({
        name: r.identity?.displayName ?? null,
        email: r.emailAddress ?? null,
        role: r.role ?? null,
        minutes: Math.round((r.totalAttendanceInSeconds ?? 0) / 6) / 10,
        intervals: r.attendanceIntervals?.length ?? 0,
      }));
    }
  } catch (e) { out.reports = failure('attendance reports', e); }
  return NextResponse.json(out);
}
