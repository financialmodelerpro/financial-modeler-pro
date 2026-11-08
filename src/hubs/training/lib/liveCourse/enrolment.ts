/**
 * Live-course enrolment: the ONE rule every entry point calls (public-page
 * registration after email confirmation, the dashboard Enrol button, and a
 * returning student signing in from the public page).
 *
 * Enrolment is a `training_enrollments` row, idempotent on
 * (registration_id, course_code), so a second click or a re-sent confirmation
 * can never create a duplicate. The confirmation email is sent once, stamped by
 * `confirmation_sent_at`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getLiveCourseSettings, isLiveCourseRow, canRegister, listCourseSessions, normaliseCourseCode } from './courseSettings';
import { formatSessionTime } from './time';
import { buildCourseIcs, icsAttachment } from './calendar';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

export type EnrolSource = 'public_page' | 'dashboard' | 'admin';

/** The student's course page (progress, sessions, recordings, submission). */
export function coursePagePath(courseCode: string): string {
  return `/training/live-course/${encodeURIComponent(courseCode)}`;
}

/** Sign-in that lands on the course page and enrols on arrival. */
export function courseSigninUrl(courseCode: string): string {
  return `/signin?redirect=${encodeURIComponent(`${coursePagePath(courseCode)}?enrol=1`)}`;
}

export interface EnrolResult {
  ok: boolean;
  enrolled: boolean;
  alreadyEnrolled: boolean;
  emailSent: boolean;
  error?: string;
}

export async function isEnrolled(sb: SupabaseClient, registrationId: string, courseCode: string): Promise<boolean> {
  const code = normaliseCourseCode(courseCode);
  if (!code || !registrationId) return false;
  const { data } = await sb
    .from('training_enrollments')
    .select('id')
    .eq('registration_id', registrationId)
    .eq('course_code', code)
    .maybeSingle();
  return !!data;
}

/**
 * Enrol a confirmed student in a live course and send the confirmation once.
 * Refuses an exam course or an inactive one: enrolment there is not this rule's.
 */
export async function enrolInLiveCourse(
  sb: SupabaseClient,
  p: { registrationId: string; email: string; name?: string | null; courseCode: string; source: EnrolSource },
  deps: { send?: (to: string, subject: string, html: string, text: string, attachments?: { name: string; content: string }[]) => Promise<void> } = {},
): Promise<EnrolResult> {
  const settings = await getLiveCourseSettings(sb, p.courseCode);
  if (!isLiveCourseRow(settings)) {
    return { ok: false, enrolled: false, alreadyEnrolled: false, emailSent: false, error: 'This course is not open for enrolment.' };
  }
  if (!p.registrationId) {
    return { ok: false, enrolled: false, alreadyEnrolled: false, emailSent: false, error: 'Registration ID is missing.' };
  }

  const { data: existing } = await sb
    .from('training_enrollments')
    .select('id, confirmation_sent_at')
    .eq('registration_id', p.registrationId)
    .eq('course_code', settings.courseCode)
    .maybeSingle();

  // A NEW enrolment needs a published course with enrolment open (status
  // rule, mig 249); an existing one is idempotent in any status.
  if (!existing && !canRegister(settings)) {
    return {
      ok: false, enrolled: false, alreadyEnrolled: false, emailSent: false,
      error: settings.status === 'published' ? 'Enrolment for this course is closed.' : 'This course is not open for enrolment.',
    };
  }

  let enrolmentId = existing?.id as string | undefined;
  if (!existing) {
    const { data: inserted, error } = await sb
      .from('training_enrollments')
      .upsert(
        { registration_id: p.registrationId, course_code: settings.courseCode, source: p.source },
        { onConflict: 'registration_id,course_code', ignoreDuplicates: true },
      )
      .select('id, confirmation_sent_at')
      .maybeSingle();
    if (error) {
      console.error('[liveCourse/enrol] insert failed', { code: settings.courseCode, error: error.message });
      return { ok: false, enrolled: false, alreadyEnrolled: false, emailSent: false, error: 'Enrolment failed. Please try again.' };
    }
    enrolmentId = inserted?.id as string | undefined;
  }

  let emailSent = false;
  if (!existing?.confirmation_sent_at) {
    try {
      const sessions = await listCourseSessions(sb, settings.courseCode);
      const { courseEnrolmentConfirmationTemplate } = await import('@/src/shared/email/templates/courseEnrolmentConfirmation');
      const mail = await courseEnrolmentConfirmationTemplate({
        name: p.name ?? '',
        courseTitle: settings.title,
        sessions: sessions.map((s) => ({ no: s.course_session_no, title: s.title, when: formatSessionTime(s.scheduled_datetime) })),
        courseUrl: `${LEARN_URL}${coursePagePath(settings.courseCode)}`,
        joinOpensMinutesBefore: settings.joinOpensMinutesBefore,
      });
      // Every course session as a calendar file (stable event IDs: a later
      // reschedule email's file moves these events instead of adding copies).
      const ics = icsAttachment(buildCourseIcs(settings, sessions), settings.courseCode);
      if (deps.send) {
        await deps.send(p.email, mail.subject, mail.html, mail.text, [ics]);
      } else {
        const { sendEmail, FROM } = await import('@/src/shared/email/sendEmail');
        await sendEmail({ to: p.email, subject: mail.subject, html: mail.html, text: mail.text, attachments: [ics], from: FROM.training });
      }
      emailSent = true;
      if (enrolmentId) {
        await sb.from('training_enrollments').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', enrolmentId);
      }
    } catch (e) {
      // The enrolment stands; a failed email is reported, not fatal.
      console.error('[liveCourse/enrol] confirmation email failed', { code: settings.courseCode, error: String(e) });
    }
  }

  return { ok: true, enrolled: true, alreadyEnrolled: !!existing, emailSent };
}
