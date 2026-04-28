/**
 * Supabase-native student roster helper.
 *
 * Replaces the Apps-Script-backed `listAllStudents()` call that every
 * /api/admin/training-hub/* route used to hit. All reads come from
 * training_registrations_meta + training_enrollments +
 * training_assessment_results + student_certificates.
 *
 * Output shape is the same StudentSummary the admin UIs expect so the
 * dashboards don't need to change.
 */

import { getServerClient } from '@/src/core/db/supabase';
import { COURSES } from '@/src/config/courses';

export interface StudentSummary {
  registrationId:       string;
  name:                 string;
  email:                string;
  phone:                string | null;          // E.164 (e.g. +923368237747); null for pre-collection legacy rows
  emailConfirmed:       boolean;                // training_registrations_meta.email_confirmed (treats null as confirmed for legacy rows)
  course:               string;                 // '3SFM' | 'BVM' | '3SFM, BVM' | '' if no enrollments
  registeredAt:         string;
  sessionsPassedCount:  number;
  totalSessions:        number;                 // attempts distinct tab_key count as a proxy
  totalCourseSessions:  number;                 // sum of session counts across enrolled COURSES (true denominator for completion %)
  lastActivityAt:       string | null;          // max(completed_at) across training_assessment_results (used by stalled-7-day filter)
  finalPassed:          boolean;
  finalExamStatus:      'not_started' | 'attempted' | 'passed';
  finalScore?:          number;
  certificateIssued:    boolean;
}

interface MetaRow {
  registration_id: string;
  email:           string;
  name:            string | null;
  phone:           string | null;
  created_at:      string | null;
  email_confirmed: boolean | null;
}

interface EnrollmentRow {
  registration_id: string;
  course_code:     string;
}

interface AssessmentRow {
  email:        string;
  tab_key:      string;
  score:        number;
  passed:       boolean;
  is_final:     boolean;
  attempts:     number;
  completed_at: string | null;
}

interface CertRow {
  email:       string;
  cert_status: string;
}

export interface RosterOptions {
  /** When set, only students with an enrollment in this course are returned. */
  course?: '3SFM' | 'BVM';
}

export async function getStudentRoster(opts: RosterOptions = {}): Promise<StudentSummary[]> {
  const sb = getServerClient();

  const [metaRes, enrollRes, assessRes, certRes] = await Promise.all([
    sb.from('training_registrations_meta')
      .select('registration_id, email, name, phone, created_at, email_confirmed'),
    sb.from('training_enrollments')
      .select('registration_id, course_code'),
    sb.from('training_assessment_results')
      .select('email, tab_key, score, passed, is_final, attempts, completed_at'),
    sb.from('student_certificates')
      .select('email, cert_status'),
  ]);

  const metas        = (metaRes.data     ?? []) as MetaRow[];
  const enrollments  = (enrollRes.data   ?? []) as EnrollmentRow[];
  const assessments  = (assessRes.data   ?? []) as AssessmentRow[];
  const certs        = (certRes.data     ?? []) as CertRow[];

  // Index enrollments by registration_id
  const enrollByReg = new Map<string, string[]>();
  for (const e of enrollments) {
    const list = enrollByReg.get(e.registration_id) ?? [];
    list.push((e.course_code ?? '').toUpperCase());
    enrollByReg.set(e.registration_id, list);
  }

  // Index assessments by email
  const assessByEmail = new Map<string, AssessmentRow[]>();
  for (const a of assessments) {
    const key = (a.email ?? '').toLowerCase();
    const list = assessByEmail.get(key) ?? [];
    list.push(a);
    assessByEmail.set(key, list);
  }

  // Index issued certs by email
  const certByEmail = new Map<string, boolean>();
  for (const c of certs) {
    if ((c.cert_status ?? '') === 'Issued') {
      certByEmail.set((c.email ?? '').toLowerCase(), true);
    }
  }

  const out: StudentSummary[] = [];
  for (const m of metas) {
    const emailLower = (m.email ?? '').toLowerCase();
    const courseCodes = enrollByReg.get(m.registration_id) ?? [];

    if (opts.course && !courseCodes.includes(opts.course)) continue;

    const studentAssessments = assessByEmail.get(emailLower) ?? [];
    const passed = studentAssessments.filter(a => a.passed);
    const finalRow = studentAssessments.find(a => a.is_final && a.passed)
      ?? studentAssessments.find(a => a.is_final);
    let finalExamStatus: StudentSummary['finalExamStatus'] = 'not_started';
    if (finalRow?.passed) finalExamStatus = 'passed';
    else if (finalRow)    finalExamStatus = 'attempted';

    // True course-session denominator: sum the session counts of every
    // course the student is enrolled in (3SFM = 18, BVM = 7). The
    // tab_key-attempt-distinct count above is misleading as a "total"
    // because it only reflects what the student has touched.
    let totalCourseSessions = 0;
    for (const code of courseCodes) {
      const cfg = COURSES[code.toLowerCase()];
      if (cfg) totalCourseSessions += cfg.sessions.length;
    }

    let lastActivityAt: string | null = null;
    for (const a of studentAssessments) {
      if (!a.completed_at) continue;
      if (!lastActivityAt || a.completed_at > lastActivityAt) lastActivityAt = a.completed_at;
    }

    out.push({
      registrationId:      m.registration_id,
      name:                m.name ?? '',
      email:               m.email ?? '',
      phone:               m.phone ?? null,
      // Pre-027 students have email_confirmed=null and are treated as
      // confirmed (mirrors `validate/route.ts` rule).
      emailConfirmed:      m.email_confirmed !== false,
      course:              courseCodes.join(', '),
      registeredAt:        m.created_at ?? '',
      sessionsPassedCount: passed.length,
      totalSessions:       studentAssessments.length,
      totalCourseSessions,
      lastActivityAt,
      finalPassed:         Boolean(finalRow?.passed),
      finalExamStatus,
      finalScore:          finalRow?.score,
      certificateIssued:   certByEmail.get(emailLower) ?? false,
    });
  }

  return out;
}
