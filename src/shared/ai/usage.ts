/**
 * shared/ai/usage.ts (SERVER ONLY)
 *
 * Per-feature usage for the AI admin panel, read from the metering counters.
 *
 * Aggregates ai_usage_counters (migration 205) for the CURRENT calendar month
 * and maps each counter back to its code-level feature id, since counters are
 * keyed by the feature's row uuid so a rename cannot orphan them.
 *
 * THE UNAVAILABLE PATH IS STILL LOAD-BEARING. When the registry or the counter
 * table cannot be read (before migration 205 is applied, or if the store is
 * down) this returns `{available:false, reason}` and the panel renders that
 * reason rather than zeroes. "0 calls this month" and "nothing is being
 * measured" look identical to an admin, and only one of them is true. Same rule
 * as the deck's amber unlinked state and grounding's "not available".
 *
 * A feature with a counter row but no matching registry row is dropped rather
 * than shown under an unknown id. A feature with NO counter row simply does not
 * appear here, and the panel renders 0 for it, which is correct once the report
 * is available: the store is readable and that feature genuinely has no calls.
 *
 * No em dashes in this file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerClient } from '@/src/core/db/supabase';
import { listAiFeatures } from './registry';
import { currentPeriodStart } from './metering';

/** Usage for one registered feature, in the current metering period. */
export interface AiUsageRow {
  /** Matches AiFeature.featureId. */
  featureId: string;
  platformSlug: string;
  /** Generations counted in the current period. */
  calls: number;
  /** Distinct users who generated. Null when the store does not track it. */
  users: number | null;
  /** Per-plan breakdown, plan_key -> calls. Empty when not tracked. */
  byPlan: Record<string, number>;
}

export type AiUsageReport =
  | {
      available: true;
      /** Human label for the window the numbers cover, e.g. "July 2026". */
      periodLabel: string;
      rows: AiUsageRow[];
    }
  | {
      available: false;
      /** Shown verbatim in the panel. Must explain WHY there are no numbers,
       *  never imply the numbers are zero. */
      reason: string;
    };

/**
 * The reason the panel currently shows in place of usage.
 *
 * Exported so the verifier can assert the panel renders THIS rather than a
 * zero, and so the string lives in one place when Unit 3 removes it.
 */
export const USAGE_UNAVAILABLE_REASON =
  'Usage cannot be read right now, so no figures are shown. This is not a count of zero. If migration 205 has not been applied yet, the usage counters do not exist and nothing is being recorded.';

/**
 * Load per-feature usage for the current period.
 *
 * Returns unavailable until the metering layer exists. Takes the Supabase
 * client it will need so the signature does not change when Unit 3 fills it in.
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** Human label for a YYYY-MM-DD period start. */
function periodLabel(periodStart: string): string {
  const [y, m] = periodStart.split('-');
  const idx = Number(m) - 1;
  return MONTHS[idx] ? `${MONTHS[idx]} ${y}` : periodStart;
}

export async function loadAiUsage(
  platformSlug?: string,
  client?: SupabaseClient,
): Promise<AiUsageReport> {
  // Never throws. getServerClient() throws when the Supabase env is absent, and
  // this is a DISPLAY path: an admin panel must render "cannot read usage"
  // rather than 500 because a counter query failed.
  let sb: SupabaseClient;
  try {
    sb = client ?? getServerClient();
  } catch {
    return { available: false, reason: USAGE_UNAVAILABLE_REASON };
  }

  const period = currentPeriodStart();

  // Counters are keyed by the feature ROW id, so the features are needed to map
  // back to the code-level ids the panel renders.
  const snapshot = await listAiFeatures(platformSlug, sb);
  if (!snapshot.migrationApplied) {
    return { available: false, reason: USAGE_UNAVAILABLE_REASON };
  }
  const byRowId = new Map(snapshot.features.map((f) => [f.id, f]));

  const res = await sb
    .from('ai_usage_counters')
    .select('ai_feature_id, user_id, used')
    .eq('period_start', period)
    .range(0, 999);

  if (res.error) {
    // Pre-migration, or the table is unreachable. Report the gap rather than
    // rendering zeroes, for the same reason as before: an admin cannot tell a
    // zero from an absence.
    return { available: false, reason: USAGE_UNAVAILABLE_REASON };
  }

  const agg = new Map<string, { calls: number; users: Set<string> }>();
  for (const row of (res.data ?? []) as Array<Record<string, unknown>>) {
    const fid = typeof row.ai_feature_id === 'string' ? row.ai_feature_id : null;
    const uid = typeof row.user_id === 'string' ? row.user_id : null;
    const used = typeof row.used === 'number' ? row.used : 0;
    if (!fid) continue;
    const bucket = agg.get(fid) ?? { calls: 0, users: new Set<string>() };
    bucket.calls += used;
    if (uid) bucket.users.add(uid);
    agg.set(fid, bucket);
  }

  const rows: AiUsageRow[] = [];
  for (const [rowId, bucket] of agg) {
    const f = byRowId.get(rowId);
    if (!f) continue; // a counter for a feature this platform filter excludes
    rows.push({ featureId: f.featureId, platformSlug: f.platformSlug, calls: bucket.calls, users: bucket.users.size, byPlan: {} });
  }

  return { available: true, periodLabel: periodLabel(period), rows };
}

/** Convenience lookup used by the panel to attach a row to a feature. Returns
 *  null when usage is unavailable OR the feature has no recorded activity, and
 *  the panel distinguishes those two cases from the report itself. */
export function usageFor(report: AiUsageReport, featureId: string, platformSlug: string): AiUsageRow | null {
  if (!report.available) return null;
  return report.rows.find((r) => r.featureId === featureId && r.platformSlug === platformSlug) ?? null;
}
