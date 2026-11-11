/**
 * Apply a planned reschedule (reschedule.ts): write each move, move the Teams
 * meeting through Graph (keeping the join link; a new link is stored if Graph
 * returns one), log it, and email EVERY ENROLLED STUDENT the old and new times
 * with the updated course calendar. Teams and email are injected, so the whole
 * path runs in the verifier with no Microsoft tenant and no real mail.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { planReschedule, moveUpdate, type PlannedMove } from './reschedule';
import { getLiveCourseSettings, isLiveCourseRow, listCourseSessions } from './courseSettings';
import { listEnrolledStudents } from './enrolledStudents';
import { buildCourseIcs, icsAttachment } from './calendar';
import { formatSessionTime } from './time';
import { courseEmailUrl } from './paths';
import { DEFAULT_DURATION_MINUTES } from './joinWindow';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

export interface RescheduleDeps {
  /** Move a Teams meeting; returns a new join URL if Graph issued one. */
  teamsUpdate?: (teamsMeetingId: string, startIso: string, endIso: string) => Promise<string | null | void>;
  send: (items: { to: string; subject: string; html: string; text: string; attachments: { name: string; content: string }[] }[]) => Promise<{ ok: boolean }[]>;
}

export interface RescheduleResult {
  ok: boolean;
  error?: string;
  moves: PlannedMove[];
  teamsUpdated: number;
  teamsFailed: string[];
  emailsSent: number;
}

export async function applyReschedule(
  sb: SupabaseClient,
  p: { sessionId: string; newStartIso: string; mode: 'single' | 'following'; by: string | null },
  deps: RescheduleDeps,
  now: Date = new Date(),
): Promise<RescheduleResult> {
  const fail = (error: string): RescheduleResult => ({ ok: false, error, moves: [], teamsUpdated: 0, teamsFailed: [], emailsSent: 0 });
  const { data: target } = await sb.from('live_sessions').select('id, course_code').eq('id', p.sessionId).maybeSingle();
  if (!target) return fail('Session not found.');
  if (!target.course_code) return fail('Only a live-course session is rescheduled here; edit a single session\'s date in its editor.');
  const course = await getLiveCourseSettings(sb, target.course_code as string);
  if (!isLiveCourseRow(course)) return fail('Not a live course.');

  const { data: all } = await sb.from('live_sessions')
    .select('id, title, course_session_no, scheduled_datetime, duration_minutes, ics_sequence, teams_meeting_id, live_url')
    .eq('course_code', course.courseCode);
  const sessions = (all ?? []) as { id: string; title: string; course_session_no: number | null; scheduled_datetime: string | null; duration_minutes: number | null; ics_sequence: number | null; teams_meeting_id: string | null; live_url: string | null }[];
  const plan = planReschedule(sessions, p.sessionId, p.newStartIso, p.mode);
  if (!plan.ok) return fail(plan.error ?? 'Could not plan the move.');

  let teamsUpdated = 0;
  const teamsFailed: string[] = [];
  for (const m of plan.moves) {
    const s = sessions.find((x) => x.id === m.id)!;
    const update: Record<string, unknown> = moveUpdate(m, now);
    if (s.teams_meeting_id && deps.teamsUpdate) {
      const end = new Date(new Date(m.newStart).getTime() + (s.duration_minutes && s.duration_minutes > 0 ? s.duration_minutes : DEFAULT_DURATION_MINUTES) * 60_000).toISOString();
      try {
        const newLink = await deps.teamsUpdate(s.teams_meeting_id, m.newStart, end);
        if (typeof newLink === 'string' && newLink && newLink !== s.live_url) update.live_url = newLink;
        teamsUpdated++;
      } catch (e) {
        teamsFailed.push(`Session ${m.no ?? '?'}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const { error } = await sb.from('live_sessions').update(update).eq('id', m.id);
    if (error) return { ...fail(`Saving session ${m.no ?? '?'} failed: ${error.message}`), moves: plan.moves, teamsUpdated, teamsFailed };
  }

  // Email every enrolled student: old and new times, plus the updated calendar.
  const students = await listEnrolledStudents(sb, course.courseCode);
  const fresh = await listCourseSessions(sb, course.courseCode);
  const ics = icsAttachment(buildCourseIcs(course, fresh, now), course.courseCode);
  const { liveCourseRescheduleTemplate } = await import('@/src/shared/email/templates/liveCourseReschedule');
  const moves = plan.moves.map((m) => {
    const s = sessions.find((x) => x.id === m.id)!;
    return { label: m.no != null ? `Session ${m.no}: ${s.title}` : s.title, oldWhen: formatSessionTime(m.oldStart), newWhen: formatSessionTime(m.newStart) };
  });
  const items = [];
  for (const st of students) {
    const mail = await liveCourseRescheduleTemplate({ name: st.name, courseTitle: course.title, moves, courseUrl: courseEmailUrl(LEARN_URL, course.courseCode) });
    items.push({ to: st.email, subject: mail.subject, html: mail.html, text: mail.text, attachments: [ics] });
  }
  const outcomes = items.length ? await deps.send(items) : [];
  const emailsSent = outcomes.filter((o) => o.ok).length;

  await sb.from('live_session_reschedules').insert({
    session_id: p.sessionId, old_start: plan.moves[0]?.oldStart ?? null, new_start: p.newStartIso,
    mode: p.mode, moved_by: p.by, emails_sent: emailsSent, teams_updated: teamsFailed.length === 0,
  });
  return { ok: true, moves: plan.moves, teamsUpdated, teamsFailed, emailsSent };
}
