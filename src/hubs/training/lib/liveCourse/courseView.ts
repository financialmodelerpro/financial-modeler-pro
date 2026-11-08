/**
 * What the student's course page shows, assembled in ONE place on the server
 * so the page, the dashboard card and the verifier read the same answer.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getLiveCourseSettings, isLiveCourseRow, listCourseSessions, studentCanOpen,
  type LiveCourseSettings, type CourseSession,
} from './courseSettings';
import { isEnrolled } from './enrolment';
import { joinStatusFrom } from './sessionAccess';
import { effectiveSessionType } from './joinWindow';
import { computeEligibility, loadProgressMaps, type Eligibility } from './eligibility';
import { loadCourseInstructors, type CourseInstructor } from './courseInstructors';
import { listMaterials, materialsReleased, materialPath } from './materials';

export interface CourseSessionView extends CourseSession {
  state: 'upcoming' | 'live' | 'recorded';
  /** Materials: listed always, downloadable once released (after the session's current end). */
  materials: { id: string; fileName: string; sizeBytes: number | null; url: string | null }[];
  materialsReleased: boolean;
  /** Logged join route, or null (not enrolled, or no meeting link yet). */
  joinUrl: string | null;
  joinOpensAt: string | null;
  joinClosesAt: string | null;
}

export interface CourseView {
  course: LiveCourseSettings;
  sessions: CourseSessionView[];
  enrolled: boolean;
  /** Per-session progress and whether submission is unlocked (eligibility.ts). */
  eligibility: Eligibility;
  /** The course's instructors, read live from their profiles. */
  instructors: CourseInstructor[];
  /** Printed on the session achievement cards. */
  student: { name: string; registrationId: string };
  /** The issued certificate, once the model is approved. */
  certificate: { certificateId: string; certPdfUrl: string | null; verificationUrl: string | null } | null;
}

export async function loadCourseView(
  sb: SupabaseClient,
  student: { email: string; registrationId: string },
  courseCode: string,
  now: number = Date.now(),
): Promise<CourseView | null> {
  const course = await getLiveCourseSettings(sb, courseCode);
  if (!isLiveCourseRow(course)) return null;
  const [sessions, enrolled] = await Promise.all([
    listCourseSessions(sb, course.courseCode),
    isEnrolled(sb, student.registrationId, course.courseCode),
  ]);
  // Enrolled students keep access in every status (draft, archived);
  // anyone else only while the course is published.
  if (!studentCanOpen(course, enrolled)) return null;

  // Which sessions have a meeting link (read server-side, never returned).
  const ids = sessions.map((s) => s.id);
  const links = new Map<string, string | null>();
  if (ids.length) {
    const { data } = await sb.from('live_sessions').select('id, live_url').in('id', ids);
    for (const r of data ?? []) links.set(r.id as string, (r.live_url as string | null) ?? null);
  }

  const lower = student.email.trim().toLowerCase();
  const maps = await loadProgressMaps(sb, ids, [...new Set([lower, student.email.trim()])]);
  const eligibility = computeEligibility(course, sessions, maps.attendance.get(lower) ?? new Map(), maps.watch.get(lower) ?? new Map(), now);

  const instructors = await loadCourseInstructors(sb, course.instructorIds);
  const mats = enrolled ? await listMaterials(sb, ids) : [];
  const { data: meta } = await sb.from('training_registrations_meta').select('name').eq('registration_id', student.registrationId).maybeSingle();
  const { data: cert } = await sb
    .from('student_certificates')
    .select('certificate_id, cert_pdf_url, verification_url, cert_status')
    .ilike('email', lower)
    .eq('course_code', course.courseCode)
    .maybeSingle();
  const certificate = cert?.certificate_id && cert.cert_status === 'Issued'
    ? { certificateId: cert.certificate_id as string, certPdfUrl: (cert.cert_pdf_url as string | null) ?? null, verificationUrl: (cert.verification_url as string | null) ?? null }
    : null;

  return {
    course,
    enrolled,
    eligibility,
    instructors,
    student: { name: (meta?.name as string | null) ?? '', registrationId: student.registrationId },
    certificate,
    sessions: sessions.map((s) => {
      const st = joinStatusFrom(enrolled, { ...s, live_url: links.get(s.id) ?? null }, course.joinOpensMinutesBefore, now);
      const released = materialsReleased(s, now);
      return {
        ...s,
        materialsReleased: released,
        // The link exists only once released; before that the name shows as "after the session".
        materials: mats.filter((m) => m.session_id === s.id).map((m) => ({ id: m.id, fileName: m.file_name, sizeBytes: m.size_bytes, url: released ? materialPath(s.id, m.id) : null })),
        state: effectiveSessionType(s, now),
        joinUrl: st.joinUrl,
        joinOpensAt: st.window?.opensAt ?? null,
        joinClosesAt: st.window?.closesAt ?? null,
      };
    }),
  };
}
