import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { adminEmail } from '@/src/hubs/training/lib/liveCourse/adminGuard';
import { getLiveCourseSettings, isLiveCourseRow } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { applyMeetingSettings, readMeetingSettings, resolveOnlineMeetingIdByJoinUrl, isTeamsConfigured, MEETING_SETTINGS } from '@/src/integrations/teams/teamsMeetings';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Where the last report is kept (training_settings, read by admin and the verifier). */
const reportKey = (code: string) => `teams_settings_report_${code.toLowerCase()}`;

export interface MeetingSettingsRow {
  no: number | null; title: string; applied: boolean; error: string | null;
  lobbyScope: string | null; dialInBypass: boolean | null; presenters: string | null; recordAutomatically: boolean | null;
}

/**
 * POST /api/admin/live-course/[code]/teams-settings
 * Applies the course meeting options (teamsMeetings.MEETING_SETTINGS: lobby
 * bypass Everyone with dial-in, organizer-only presenters, record and
 * transcribe automatically) to EVERY session of the course that has a Teams
 * meeting, then reads each meeting back from Graph and reports what it holds.
 * The report is also saved (training_settings) so it can be re-read. Sends no
 * email. GET returns the last report.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!isTeamsConfigured()) return NextResponse.json({ error: 'Microsoft Teams is not configured on the server (AZURE_* env vars).' }, { status: 400 });
  const { code } = await params;
  const sb = getServerClient();
  const course = await getLiveCourseSettings(sb, code);
  if (!isLiveCourseRow(course)) return NextResponse.json({ error: 'Not a live course' }, { status: 404 });
  const { data: sessions } = await sb.from('live_sessions').select('id, title, course_session_no, live_url').eq('course_code', course.courseCode).order('course_session_no');

  const rows: MeetingSettingsRow[] = [];
  for (const s of sessions ?? []) {
    const url = ((s.live_url as string | null) ?? '').trim();
    const row: MeetingSettingsRow = { no: (s.course_session_no as number | null) ?? null, title: s.title as string, applied: false, error: null, lobbyScope: null, dialInBypass: null, presenters: null, recordAutomatically: null };
    if (!url) { row.error = 'no Teams meeting'; rows.push(row); continue; }
    const applied = await applyMeetingSettings(url);
    row.applied = applied.ok;
    if (!applied.ok) row.error = applied.error;
    try {
      const read = await readMeetingSettings(await resolveOnlineMeetingIdByJoinUrl(url));
      const lobby = read.lobbyBypassSettings as { scope?: string; isDialInBypassEnabled?: boolean } | undefined;
      row.lobbyScope = lobby?.scope ?? null;
      row.dialInBypass = typeof lobby?.isDialInBypassEnabled === 'boolean' ? lobby.isDialInBypassEnabled : null;
      row.presenters = (read.allowedPresenters as string | undefined) ?? null;
      row.recordAutomatically = typeof read.recordAutomatically === 'boolean' ? read.recordAutomatically : null;
    } catch (e) { row.error = [row.error, `read back failed: ${(e as Error).message}`].filter(Boolean).join('; '); }
    rows.push(row);
  }
  const report = { at: new Date().toISOString(), wanted: MEETING_SETTINGS, rows };
  await sb.from('training_settings').upsert({ key: reportKey(course.courseCode), value: JSON.stringify(report) }, { onConflict: 'key' });
  return NextResponse.json(report);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { code } = await params;
  const { data } = await getServerClient().from('training_settings').select('value').eq('key', reportKey(code)).maybeSingle();
  return NextResponse.json(data?.value ? JSON.parse(data.value as string) : { rows: [] });
}
