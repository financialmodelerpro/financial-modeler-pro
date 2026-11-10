import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { adminEmail } from '@/src/hubs/training/lib/liveCourse/adminGuard';
import { applyReschedule } from '@/src/hubs/training/lib/liveCourse/rescheduleApply';
import { zonedWallTimeToUtc, KSA_TZ } from '@/src/hubs/training/lib/liveCourse/time';
import { isTeamsConfigured, updateMeetingOrEvent } from '@/src/integrations/teams/teamsMeetings';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import { invalidateLiveCourseCache } from '@/src/hubs/training/lib/liveCourse/cachedReads';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/admin/live-sessions/[id]/reschedule  { date: 'YYYY-MM-DD', time: 'HH:mm', mode: 'single' | 'following' }
 * The new date and time are KSA wall clock. A course session is never
 * cancelled: it moves. Teams follows (same join link where Graph keeps it),
 * and every enrolled student is emailed the old and new time with an updated
 * calendar file.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const by = await adminEmail();
  if (!by) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { date?: string; time?: string; mode?: string };
  const newStartIso = zonedWallTimeToUtc(body.date ?? '', body.time ?? '', KSA_TZ);
  if (!newStartIso) return NextResponse.json({ error: 'Pick a valid new date and time (KSA).' }, { status: 400 });
  const mode = body.mode === 'following' ? 'following' : 'single';

  const result = await applyReschedule(getServerClient(), { sessionId: id, newStartIso, mode, by }, {
    teamsUpdate: isTeamsConfigured()
      ? async (meetingId, start, end) => {
          await updateMeetingOrEvent(meetingId, { startDateTime: start, endDateTime: end, timezone: KSA_TZ });
          return null; // the calendar event keeps its join link
        }
      : undefined,
    send: async (items) => {
      const out: { ok: boolean }[] = [];
      for (const it of items) {
        try {
          await sendEmail({ to: it.to, subject: it.subject, html: it.html, text: it.text, attachments: it.attachments, from: FROM.training });
          out.push({ ok: true });
        } catch (e) {
          console.error('[reschedule] email failed', { to: it.to, error: String(e) });
          out.push({ ok: false });
        }
      }
      return out;
    },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  invalidateLiveCourseCache();
  return NextResponse.json({ ...result, teamsConfigured: isTeamsConfigured() });
}
