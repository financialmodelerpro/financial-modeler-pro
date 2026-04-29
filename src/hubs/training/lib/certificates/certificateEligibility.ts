/**
 * Native-Supabase certificate eligibility.
 *
 * Decides whether a student has earned a cert for a course using ONLY the
 * Supabase tables.
 *
 * Rules:
 *   1. Every non-final session in COURSES[courseId].sessions must have a
 *      `passed = true` row in `training_assessment_results`.
 *   2. The final session (isFinal = true) must also have a passed row.
 */

import { COURSES } from '@/src/hubs/training/config/courses';
import { getServerClient } from '@/src/core/db/supabase';
import { getStudentProgressFromSupabase as getStudentProgress } from '@/src/hubs/training/lib/progress/progressFromSupabase';

export interface EligibilityResult {
  eligible: boolean;
  course: string;                         // course code, e.g. "3SFM"
  email: string;
  passedSessions: string[];              // tab_keys that are passed
  missingSessions: Array<{ tabKey: string; title: string }>;
  finalScore: number | null;
  avgScore: number | null;
  reason?: string;
}

/** Build tab_keys for a course in the same format `training_assessment_results` stores them. */
function courseTabKeys(courseId: string): { regular: string[]; final: string | null; labels: Record<string, string> } {
  const course = COURSES[courseId] ?? COURSES[courseId.toLowerCase()];
  if (!course) return { regular: [], final: null, labels: {} };
  const short = course.shortTitle.toUpperCase();
  const regular: string[] = [];
  const labels: Record<string, string> = {};
  let final: string | null = null;
  for (const s of course.sessions) {
    const tk = s.isFinal ? `${short}_Final` : `${short}_${s.id}`;
    labels[tk] = s.title;
    if (s.isFinal) final = tk;
    else regular.push(tk);
  }
  return { regular, final, labels };
}

export async function checkEligibility(
  email: string,
  courseId: string,
): Promise<EligibilityResult> {
  const normalizedEmail = email.toLowerCase();
  const code = courseId.toUpperCase();
  const { regular, final, labels } = courseTabKeys(courseId);

  const empty: EligibilityResult = {
    eligible: false, course: code, email: normalizedEmail,
    passedSessions: [], missingSessions: [],
    finalScore: null, avgScore: null,
  };
  if (!regular.length || !final) {
    return { ...empty, reason: 'Course not found' };
  }

  const sb = getServerClient();
  const course = COURSES[courseId] ?? COURSES[courseId.toLowerCase()]!;
  const finalSessionId = course.sessions.find(s => s.isFinal)?.id ?? '';

  /**
   * We match on canonical **session IDs** (e.g. `S1`, `S18`, `L7`) not raw
   * `tab_key` strings. That's because:
   *   - Supabase may store the final as `{COURSE}_Final` OR `{COURSE}_{finalId}`
   *     depending on when the row was written.
   *   - Early-era sessions may pre-date the Supabase dual-write — so they
   *     only exist in Apps Script and must be merged in from there.
   *
   * Build a set of sessionIds that are known-passed from EITHER source.
   */
  const passedIds = new Set<string>();
  const scoreById = new Map<string, number>();

  // Source 1: Supabase — strip the COURSE_ prefix + rewrite `Final` → finalSessionId.
  const { data: attempts } = await sb
    .from('training_assessment_results')
    .select('tab_key, passed, score, is_final')
    .eq('email', normalizedEmail);
  for (const a of (attempts ?? []) as { tab_key: string; passed: boolean; score: number | null; is_final: boolean | null }[]) {
    if (!a.passed) continue;
    const sep = a.tab_key.indexOf('_');
    const raw = sep >= 0 ? a.tab_key.slice(sep + 1) : a.tab_key;
    const sid = raw.toLowerCase() === 'final' ? finalSessionId : raw;
    passedIds.add(sid);
    if (typeof a.score === 'number') scoreById.set(sid, a.score);
  }

  // Source 2: Apps Script progress merge — catches pre-dual-write history.
  // Best-effort: a failure here must not block a student who has everything
  // in Supabase already.
  try {
    const { data: reg } = await sb
      .from('training_registrations_meta')
      .select('registration_id')
      .eq('email', normalizedEmail)
      .maybeSingle();
    if (reg?.registration_id) {
      const progress = await getStudentProgress(normalizedEmail, reg.registration_id);
      if (progress.success && progress.data?.sessions) {
        for (const s of progress.data.sessions) {
          if (s.passed) {
            passedIds.add(s.sessionId);
            if (typeof s.score === 'number' && !scoreById.has(s.sessionId)) scoreById.set(s.sessionId, s.score);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[certEligibility] Apps Script progress fetch failed, using Supabase only:', e);
  }

  // Resolve required sessions against the merged pass set.
  const requiredIds = course.sessions.map(s => s.id);
  const missingIds = requiredIds.filter(id => !passedIds.has(id));
  const passedSessions = requiredIds.filter(id => passedIds.has(id))
    .map(id => course.sessions.find(s => s.id === id)?.isFinal ? `${code}_Final` : `${code}_${id}`);

  const finalScore = finalSessionId ? (scoreById.get(finalSessionId) ?? null) : null;
  const regularScores = course.sessions.filter(s => !s.isFinal && passedIds.has(s.id))
    .map(s => scoreById.get(s.id))
    .filter((n): n is number => typeof n === 'number');
  const avgScore = regularScores.length ? Math.round(regularScores.reduce((a, b) => a + b, 0) / regularScores.length) : null;

  if (missingIds.length > 0) {
    const missing = missingIds.map(id => {
      const s = course.sessions.find(x => x.id === id);
      const tk = s?.isFinal ? `${code}_Final` : `${code}_${id}`;
      return { tabKey: tk, title: labels[tk] ?? s?.title ?? tk };
    });
    return {
      ...empty,
      passedSessions,
      missingSessions: missing,
      finalScore,
      avgScore,
      reason: `Missing ${missing.length} session${missing.length === 1 ? '' : 's'}`,
    };
  }

  return {
    eligible: true,
    course: code,
    email: normalizedEmail,
    passedSessions,
    missingSessions: [],
    finalScore,
    avgScore,
  };
}

/**
 * Scans Supabase for every (email, course) that has passed all required
 * sessions + final and does NOT yet have an Issued row in
 * `student_certificates`. Returns a list the cron can iterate.
 *
 * Cheap enough to run on every cron tick: one view query + one join per
 * course code present. Admin never waits on this path.
 */
export async function findAllEligibleFromSupabase(): Promise<Array<EligibilityResult>> {
  const sb = getServerClient();

  // candidates from the view — must have final_passed = true
  const { data: raws } = await sb
    .from('certificate_eligibility_raw')
    .select('email, course_code, final_passed')
    .eq('final_passed', true);

  if (!raws || raws.length === 0) return [];

  // existing issued certs → skip
  const { data: existing } = await sb
    .from('student_certificates')
    .select('email, course_code, cert_status');
  const alreadyIssued = new Set<string>();
  for (const r of existing ?? []) {
    if (r.cert_status === 'Issued' || r.cert_status === 'Forced') {
      alreadyIssued.add(`${(r.email as string).toLowerCase()}|${(r.course_code as string).toUpperCase()}`);
    }
  }

  const results: EligibilityResult[] = [];
  for (const r of raws as Array<{ email: string; course_code: string; final_passed: boolean }>) {
    const key = `${r.email.toLowerCase()}|${r.course_code.toUpperCase()}`;
    if (alreadyIssued.has(key)) continue;
    // Only process course codes we have config for.
    const knownCourse = Object.values(COURSES).find(c => c.shortTitle.toUpperCase() === r.course_code.toUpperCase());
    if (!knownCourse) continue;
    const check = await checkEligibility(r.email, knownCourse.id);
    results.push(check);
  }
  return results;
}
