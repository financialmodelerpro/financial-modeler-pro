/**
 * shared/ai/usage.ts (SERVER ONLY)
 *
 * The usage seam for the AI admin panel.
 *
 * WHY THIS IS A STUB, AND WHY IT IS NOT EMPTY
 *
 * The admin panel (Unit 5) is specified to show per-feature usage. Usage is
 * PRODUCED by the metering layer (Unit 3), which does not exist yet: nothing in
 * the codebase records an AI call, and there is no usage table.
 *
 * The panel therefore has three options and only one of them is honest:
 *
 *   1. Omit usage entirely. The admin cannot tell whether the feature is
 *      unused or whether the panel simply does not show it.
 *   2. Render zeroes. "0 calls this month" and "nothing is being measured"
 *      look identical, and the first is a false statement about a live system.
 *   3. Report explicitly that metering is not installed.
 *
 * This module implements 3. It is the same rule the rest of the AI foundation
 * follows: a binding with no data renders a visible unlinked state, an absent
 * grounding fact renders "not available", a pre-migration registry read reports
 * migrationApplied:false. Silence and fabrication are both worse than a stated
 * gap.
 *
 * FOR UNIT 3: this is the ONLY function to implement. Fill in loadAiUsage to
 * query whatever usage store the metering layer creates and return
 * `{ available: true, periodLabel, rows }`. The panel already renders that
 * shape, so no UI change is needed when it lands.
 *
 * No em dashes in this file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

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
  'Usage tracking is not installed yet. It arrives with the metering unit, which is what records each generation. No calls are being counted right now, so this is not a count of zero.';

/**
 * Load per-feature usage for the current period.
 *
 * Returns unavailable until the metering layer exists. Takes the Supabase
 * client it will need so the signature does not change when Unit 3 fills it in.
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- the parameters are
   unused ONLY until the metering unit fills this in. They are declared now so
   that landing Unit 3 does not change the signature and therefore does not
   touch the admin route or the panel. */
export async function loadAiUsage(
  platformSlug?: string,
  sb?: SupabaseClient,
): Promise<AiUsageReport> {
  return { available: false, reason: USAGE_UNAVAILABLE_REASON };
}
/* eslint-enable @typescript-eslint/no-unused-vars */

/** Convenience lookup used by the panel to attach a row to a feature. Returns
 *  null when usage is unavailable OR the feature has no recorded activity, and
 *  the panel distinguishes those two cases from the report itself. */
export function usageFor(report: AiUsageReport, featureId: string, platformSlug: string): AiUsageRow | null {
  if (!report.available) return null;
  return report.rows.find((r) => r.featureId === featureId && r.platformSlug === platformSlug) ?? null;
}
