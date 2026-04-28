/**
 * Supabase-native equivalent of getStudentProgress() that every admin and
 * student progress page used to pull from Apps Script. Returns the same
 * StudentProgress shape the old Apps Script helper did so call sites can
 * swap imports without restructuring.
 */

import { getServerClient } from '@/src/core/db/supabase';

export interface SessionProgress {
  sessionId:   string;
  passed:      boolean;
  score:       number;
  attempts:    number;
  completedAt: string | null;
}

export interface StudentProgress {
  student: {
    name:           string;
    email:          string;
    registrationId: string;
    course:         string;         // 'both' | 'bvm' | '3sfm'
    registeredAt:   string;
  };
  sessions:          SessionProgress[];
  finalPassed:       boolean;
  certificateIssued: boolean;
}

export async function getStudentProgressFromSupabase(
  email: string,
  regId: string,
): Promise<{ success: boolean; data?: StudentProgress; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanRegId = regId.trim();

  const sb = getServerClient();

  const [metaRes, enrollRes, resultsRes, certsRes] = await Promise.all([
    sb.from('training_registrations_meta')
      .select('registration_id, email, name, created_at')
      .eq('registration_id', cleanRegId)
      .maybeSingle(),
    sb.from('training_enrollments')
      .select('course_code')
      .eq('registration_id', cleanRegId),
    sb.from('training_assessment_results')
      .select('tab_key, score, passed, attempts, is_final, completed_at')
      .eq('email', cleanEmail),
    sb.from('student_certificates')
      .select('cert_status')
      .eq('email', cleanEmail),
  ]);

  const meta        = metaRes.data;
  const enrollments = enrollRes.data ?? [];
  const results     = resultsRes.data ?? [];
  const certs       = certsRes.data ?? [];

  const codes = new Set(enrollments.map(e => (e.course_code ?? '').toUpperCase()));
  const course = codes.has('3SFM') && codes.has('BVM') ? 'both'
    : codes.has('BVM') ? 'bvm'
    : '3sfm';

  const sessions: SessionProgress[] = results.map(r => {
    const sep = r.tab_key.indexOf('_');
    const rawId = sep >= 0 ? r.tab_key.slice(sep + 1) : r.tab_key;
    const isBvm = r.tab_key.toUpperCase().startsWith('BVM');
    const sessionId = rawId === 'Final' ? (isBvm ? 'L7' : 'S18') : rawId;
    return {
      sessionId,
      passed:      Boolean(r.passed),
      score:       Number(r.score ?? 0),
      attempts:    Number(r.attempts ?? 0),
      completedAt: (r.completed_at as string | null) ?? null,
    };
  });

  return {
    success: true,
    data: {
      student: {
        name:           meta?.name ?? '',
        email:          cleanEmail,
        registrationId: cleanRegId,
        course,
        registeredAt:   (meta?.created_at as string | null) ?? '',
      },
      sessions,
      finalPassed:       results.some(r => r.is_final && r.passed),
      certificateIssued: certs.some(c => c.cert_status === 'Issued'),
    },
  };
}
