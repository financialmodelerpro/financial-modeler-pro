import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { adminEmail } from '@/src/hubs/training/lib/liveCourse/adminGuard';
import { getLiveCourseSettings, isLiveCourseRow } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { DEFAULT_DURATION_MINUTES } from '@/src/hubs/training/lib/liveCourse/joinWindow';
import { KSA_TZ } from '@/src/hubs/training/lib/liveCourse/time';
import { createCalendarEventWithMeeting, isTeamsConfigured, TeamsIntegrationError } from '@/src/integrations/teams/teamsMeetings';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/admin/live-course/[code]/teams-meetings
 * Creates a Teams meeting (the existing auto-generate integration, the same
 * calendar-event call the session editor uses) for every upcoming session of
 * the course that has no join link yet. Writes the link straight to the row:
 * no newsletter, no announcement, no student email.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!isTeamsConfigured()) return NextResponse.json({ error: 'Microsoft Teams is not configured on the server (AZURE_* env vars).' }, { status: 400 });
  const { code } = await params;
  const sb = getServerClient();
  const course = await getLiveCourseSettings(sb, code);
  if (!isLiveCourseRow(course)) return NextResponse.json({ error: 'Not a live course' }, { status: 404 });

  const { data: sessions } = await sb.from('live_sessions')
    .select('id, title, course_session_no, scheduled_datetime, duration_minutes, live_url')
    .eq('course_code', course.courseCode)
    .order('course_session_no');
  const now = Date.now();
  const todo = (sessions ?? []).filter((s) => !((s.live_url as string | null) ?? '').trim()
    && s.scheduled_datetime && new Date(s.scheduled_datetime as string).getTime() > now);
  const created: number[] = [];
  const failed: string[] = [];
  for (const s of todo) {
    const start = s.scheduled_datetime as string;
    const end = new Date(new Date(start).getTime() + ((s.duration_minutes as number) || DEFAULT_DURATION_MINUTES) * 60_000).toISOString();
    try {
      const mtg = await createCalendarEventWithMeeting({
        courseMeeting: true,
        subject: `${course.title}: Session ${s.course_session_no ?? ''} ${s.title}`.trim(),
        startDateTime: start, endDateTime: end, timezone: KSA_TZ,
      });
      const { error } = await sb.from('live_sessions').update({
        live_url: mtg.joinUrl, teams_meeting_id: mtg.meetingId, teams_dial_in: mtg.dialIn, meeting_provider: 'teams',
        updated_at: new Date().toISOString(),
      }).eq('id', s.id);
      if (error) throw new Error(error.message);
      created.push(s.course_session_no as number);
    } catch (e) {
      failed.push(`Session ${s.course_session_no}: ${e instanceof TeamsIntegrationError ? `${e.message} ${e.detail ?? ''}`.trim() : String(e)}`);
    }
  }
  return NextResponse.json({ ok: failed.length === 0, created, failed, skipped: (sessions ?? []).length - todo.length });
}
