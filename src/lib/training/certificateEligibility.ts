/**
 * Native-Supabase certificate eligibility.
 *
 * Decides whether a student has earned a cert for a course using ONLY the
 * Supabase tables. Invariant: we never trust Apps Script's pending flag to
 * determine eligibility — that was the source of the missed-certificate bug.
 *
 * Rules:
 *   1. Every non-final session in COURSES[courseId].sessions must have a
 *      `passed = true` row in `training_assessment_results`.
 *   2. The final session (isFinal = true) must also have a passed row.
 *   3. Watch threshold must be met for every required session (unless global
 *      enforcement is off, or the session has an explicit bypass set in
 *      training_settings). Grandfathering: a session with no watch_history
 *      row, or one where total_seconds = 0 AND watch_seconds = 0, is
 *      considered grandfathered (pre-migration-103) and waived.
 */

import { COURSES } from '@/src/config/courses';
import { getServerClient } from '@/src/lib/shared/supabase';

export interface EligibilityResult {
  eligible: boolean;
  course: string;                         // course code, e.g. "3SFM"
  email: string;
  passedSessions: string[];              // tab_keys that are passed
  missingSessions: Array<{ tabKey: string; title: string }>;
  watchThresholdMet: boolean;
  watchDetails: Record<string, { pct: number; bypassed: boolean; grandfathered: boolean }>;
  finalScore: number | null;
  avgScore: number | null;
  reason?: string;
}

interface WatchEnforcement { enabled: boolean; threshold: number; bypass: Record<string, boolean> }

async function getSettings(keys: string[]): Promise<Record<string, string>> {
  const sb = getServerClient();
  const { data } = await sb.from('training_settings').select('key, value').in('key', keys);
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { key: string; value: string }[]) out[r.key] = r.value;
  return out;
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

async function loadWatchEnforcement(tabKeys: string[]): Promise<WatchEnforcement> {
  const bypassKeys = tabKeys.map(tk => `watch_enforcement_bypass_${tk}`);
  const s = await getSettings(['watch_enforcement_enabled', 'watch_enforcement_threshold', ...bypassKeys]);
  const bypass: Record<string, boolean> = {};
  for (const tk of tabKeys) bypass[tk] = s[`watch_enforcement_bypass_${tk}`] === 'true';
  return {
    enabled: s.watch_enforcement_enabled !== 'false',
    threshold: Math.max(0, Math.min(100, parseInt(s.watch_enforcement_threshold ?? '70', 10) || 70)),
    bypass,
  };
}

export async function checkEligibility(
  email: string,
  courseId: string,
  options: { bypassWatch?: boolean } = {},
): Promise<EligibilityResult> {
  const normalizedEmail = email.toLowerCase();
  const code = courseId.toUpperCase();
  const { regular, final, labels } = courseTabKeys(courseId);

  const empty: EligibilityResult = {
    eligible: false, course: code, email: normalizedEmail,
    passedSessions: [], missingSessions: [], watchThresholdMet: false,
    watchDetails: {}, finalScore: null, avgScore: null,
  };
  if (!regular.length || !final) {
    return { ...empty, reason: 'Course not found' };
  }

  const allTabKeys = [...regular, final];
  const sb = getServerClient();

  // 1. Session passes from training_assessment_results.
  const { data: attempts } = await sb
    .from('training_assessment_results')
    .select('tab_key, passed, score, is_final')
    .eq('email', normalizedEmail)
    .in('tab_key', allTabKeys);

  const passed = new Set<string>();
  let finalScore: number | null = null;
  const scores: number[] = [];
  for (const a of (attempts ?? []) as { tab_key: string; passed: boolean; score: number | null; is_final: boolean | null }[]) {
    if (!a.passed) continue;
    passed.add(a.tab_key);
    if (a.tab_key === final) finalScore = typeof a.score === 'number' ? a.score : finalScore;
    else if (typeof a.score === 'number') scores.push(a.score);
  }
  const passedSessions = [...passed];
  const missing = allTabKeys.filter(tk => !passed.has(tk)).map(tk => ({ tabKey: tk, title: labels[tk] ?? tk }));
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  if (missing.length > 0) {
    return {
      ...empty,
      passedSessions,
      missingSessions: missing,
      finalScore,
      avgScore,
      reason: `Missing ${missing.length} session${missing.length === 1 ? '' : 's'}`,
    };
  }

  // 2. Watch threshold (with grandfathering + per-session bypass).
  const watchDetails: Record<string, { pct: number; bypassed: boolean; grandfathered: boolean }> = {};
  let watchMet = true;

  if (!options.bypassWatch) {
    const enforce = await loadWatchEnforcement(allTabKeys);
    if (enforce.enabled) {
      const { data: watchRows } = await sb
        .from('certification_watch_history')
        .select('tab_key, watch_percentage, total_seconds, watch_seconds')
        .eq('student_email', normalizedEmail)
        .in('tab_key', allTabKeys);
      const watchMap = new Map((watchRows ?? []).map(r => [r.tab_key as string, r]));

      for (const tk of allTabKeys) {
        const row = watchMap.get(tk);
        const pct = Number(row?.watch_percentage ?? 0);
        const totalSec = Number(row?.total_seconds ?? 0);
        const watchSec = Number(row?.watch_seconds ?? 0);
        // Grandfather: either no row at all, or row exists with no tracking data
        // captured (predates migration 103).
        const grandfathered = !row || (totalSec === 0 && watchSec === 0);
        const bypassed = enforce.bypass[tk] === true;
        watchDetails[tk] = { pct, bypassed, grandfathered };
        if (!bypassed && !grandfathered && pct < enforce.threshold) watchMet = false;
      }
    }
  }

  if (!watchMet) {
    const failed = Object.entries(watchDetails)
      .filter(([, d]) => !d.bypassed && !d.grandfathered && d.pct < 0) // placeholder
      .map(([tk]) => tk);
    return {
      ...empty,
      passedSessions,
      watchThresholdMet: false,
      watchDetails,
      finalScore,
      avgScore,
      reason: `Watch threshold not met on ${failed.length || 'one or more'} session${failed.length === 1 ? '' : 's'}`,
    };
  }

  return {
    eligible: true,
    course: code,
    email: normalizedEmail,
    passedSessions,
    missingSessions: [],
    watchThresholdMet: true,
    watchDetails,
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
