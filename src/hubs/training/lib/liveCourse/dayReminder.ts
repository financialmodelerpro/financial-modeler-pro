/**
 * Same-day reminder for live-course sessions (replaces the 1-hour reminder
 * for these courses: crons run once a day, at 06:00 UTC = 9:00 AM KSA).
 *
 * A session qualifies when it is published, belongs to an active live course
 * with the reminder on, starts later TODAY in KSA, and has no
 * day_reminder_sent_at yet. The stamp is written before sending, so a re-run
 * of the cron can never send twice.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getLiveCourseSettings, isLiveCourseRow } from './courseSettings';
import { listEnrolledStudents } from './enrolledStudents';
import { formatSessionTime, zonedDate, KSA_TZ } from './time';
import { courseEmailUrl } from './paths';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

export interface DayReminderSend { to: string; subject: string; html: string; text: string }

export interface DayReminderResult { sessions: number; sent: number; failed: number }

/** Is this instant later today, in KSA, than `now`? */
export function startsLaterToday(scheduledIso: string, now: Date): boolean {
  const t = new Date(scheduledIso);
  return t.getTime() > now.getTime() && zonedDate(t, KSA_TZ) === zonedDate(now, KSA_TZ);
}

export async function sendSessionDayReminders(
  sb: SupabaseClient,
  now: Date,
  send: (items: DayReminderSend[]) => Promise<{ ok: boolean }[]>,
): Promise<DayReminderResult> {
  // Candidates: course sessions starting within the next 24 hours.
  const { data } = await sb
    .from('live_sessions')
    .select('id, title, scheduled_datetime, course_code, course_session_no, is_published, session_type, day_reminder_sent_at')
    .not('course_code', 'is', null)
    .eq('is_published', true)
    .is('day_reminder_sent_at', null)
    .gte('scheduled_datetime', now.toISOString())
    .lte('scheduled_datetime', new Date(now.getTime() + 24 * 3600_000).toISOString());

  const res: DayReminderResult = { sessions: 0, sent: 0, failed: 0 };
  const { liveCourseDayReminderTemplate } = await import('@/src/shared/email/templates/liveCourseDayReminder');

  for (const s of data ?? []) {
    if (!s.scheduled_datetime || s.session_type === 'recorded') continue;
    if (!startsLaterToday(s.scheduled_datetime as string, now)) continue;
    const course = await getLiveCourseSettings(sb, s.course_code as string);
    if (!isLiveCourseRow(course) || !course.isActive || !course.sessionDayReminder) continue;

    // Claim the session first: a second run finds it stamped and skips it.
    const { data: claimed } = await sb
      .from('live_sessions')
      .update({ day_reminder_sent_at: now.toISOString() })
      .eq('id', s.id)
      .is('day_reminder_sent_at', null)
      .select('id');
    if (!claimed || claimed.length === 0) continue;
    res.sessions++;

    const students = await listEnrolledStudents(sb, course.courseCode);
    const items: DayReminderSend[] = [];
    for (const st of students) {
      const mail = await liveCourseDayReminderTemplate({
        name: st.name,
        courseTitle: course.title,
        sessionTitle: s.title as string,
        sessionNo: (s.course_session_no as number | null) ?? null,
        when: formatSessionTime(s.scheduled_datetime as string),
        courseUrl: courseEmailUrl(LEARN_URL, course.courseCode),
        joinOpensMinutesBefore: course.joinOpensMinutesBefore,
      });
      items.push({ to: st.email, subject: mail.subject, html: mail.html, text: mail.text });
    }
    if (items.length) {
      const outcomes = await send(items);
      res.sent += outcomes.filter((o) => o.ok).length;
      res.failed += outcomes.filter((o) => !o.ok).length;
    }
  }
  return res;
}
