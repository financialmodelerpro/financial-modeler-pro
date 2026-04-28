import { getServerClient } from '@/src/core/db/supabase';
import { COURSES } from '@/src/hubs/training/config/courses';

/**
 * Verify that a student met the watch threshold for every session in a course
 * before a certificate is issued. Belt-and-suspenders: Mark Complete is also
 * gated by the same threshold on the client, but this is the server-side
 * fallback that blocks certs for records that slipped through pre-enforcement.
 *
 * Precedence (matches watch page enforcement):
 *   1. Global `watch_enforcement_enabled='false'` → everyone allowed
 *   2. Per-session bypass (`watch_enforcement_bypass_{TABKEY}='true'`) → allowed
 *   3. Session has NO watch_history row, OR row has watch_percentage = 0 AND
 *      total_seconds = 0 → treat as grandfathered (pre-migration-103 record).
 *      This avoids retroactively blocking historical cert issuance.
 *   4. Otherwise require watch_percentage >= threshold
 *
 * Returns a list of tab_keys that failed (empty = all good).
 */
export async function verifyWatchThresholdMet(
  email: string,
  courseCode: string,
): Promise<{ ok: boolean; failed: { tabKey: string; pct: number }[] }> {
  const sb = getServerClient();

  // Find the course config by code (case-insensitive shortTitle match)
  const course = Object.values(COURSES).find(c => c.shortTitle.toUpperCase() === courseCode.toUpperCase());
  if (!course) return { ok: true, failed: [] }; // unknown course — let the legacy Apps Script gate handle it

  // 1. Pull enforcement settings
  const bypassKeys = course.sessions.map(s => {
    const tk = s.isFinal
      ? `${course.shortTitle.toUpperCase()}_Final`
      : `${course.shortTitle.toUpperCase()}_${s.id}`;
    return `watch_enforcement_bypass_${tk}`;
  });
  const { data: settingsRows } = await sb
    .from('training_settings')
    .select('key, value')
    .in('key', ['watch_enforcement_enabled', 'watch_enforcement_threshold', ...bypassKeys]);

  const settings: Record<string, string> = {};
  for (const r of (settingsRows ?? []) as { key: string; value: string }[]) settings[r.key] = r.value;

  // Global toggle OFF → nothing to enforce
  if (settings.watch_enforcement_enabled === 'false') return { ok: true, failed: [] };

  const threshold = Math.max(0, Math.min(100, parseInt(settings.watch_enforcement_threshold || '70', 10) || 70));

  // 2. Pull the student's watch history rows for all tab_keys in this course
  const tabKeys = course.sessions.map(s => (s.isFinal
    ? `${course.shortTitle.toUpperCase()}_Final`
    : `${course.shortTitle.toUpperCase()}_${s.id}`));
  const { data: historyRows } = await sb
    .from('certification_watch_history')
    .select('tab_key, watch_percentage, total_seconds')
    .eq('student_email', email.toLowerCase())
    .in('tab_key', tabKeys);

  const byTk = new Map<string, { watch_percentage: number | null; total_seconds: number | null }>();
  for (const r of (historyRows ?? []) as { tab_key: string; watch_percentage: number | null; total_seconds: number | null }[]) {
    byTk.set(r.tab_key, r);
  }

  // 3. Evaluate each required session
  const failed: { tabKey: string; pct: number }[] = [];
  for (const tk of tabKeys) {
    if (settings[`watch_enforcement_bypass_${tk}`] === 'true') continue; // per-session bypass

    const row = byTk.get(tk);

    // Grandfather: no row OR row that predates tracking (pct=0 + total=0).
    // We only block when we actually have watch data AND it's below threshold.
    if (!row) continue;
    if ((row.watch_percentage ?? 0) === 0 && (row.total_seconds ?? 0) === 0) continue;

    const pct = row.watch_percentage ?? 0;
    if (pct < threshold) failed.push({ tabKey: tk, pct });
  }

  return { ok: failed.length === 0, failed };
}
