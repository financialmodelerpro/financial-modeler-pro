/**
 * trialConfig.ts
 *
 * Trial duration is config-driven from a SINGLE source: the Trial plan's
 * `trial_days` in entitlement_plans (mig 165), edited in the Plan Builder.
 * DEFAULT_TRIAL_DAYS is the fallback when the value is missing.
 *
 * Every consumer reads this one value: trial approval (trial_ends_at via
 * setUserPlan), the entitlements GET that displays the trial length, and the
 * marketing + in-app pricing pages (via loadPricingCatalog). The old
 * platform_pricing.trial_days is no longer read (platform_pricing is deprecated,
 * not dropped).
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Fallback trial length when no configured value is found. */
export const DEFAULT_TRIAL_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Compute an ISO trial-end timestamp `days` days after `startMs`. */
export function trialEndsAtIso(startMs: number, days: number): string {
  return new Date(startMs + days * DAY_MS).toISOString();
}

/**
 * Inject the single-source trial length into CTA / marketing copy so there is no
 * hardcoded number. Pure. Two substitutions:
 *   - a `{trialDays}` token is always replaced with the live value;
 *   - inside any string that mentions "trial", a legacy "NN-day" / "NN day"
 *     literal is normalized to the live value, so old copy self-heals.
 * Anything without a token or a trial context is returned unchanged.
 */
export function withTrialDays(text: string, trialDays: number): string {
  if (!text) return text;
  let out = text.replace(/\{\s*trialDays\s*\}/gi, String(trialDays));
  if (/trial/i.test(out)) {
    out = out.replace(/\b\d+\s*-?\s*(day)\b/gi, (_m, day: string) => `${trialDays}-${day}`);
  }
  return out;
}

/**
 * Resolve the configured trial length (in days) for a platform from the Trial
 * plan in entitlement_plans. Falls back to DEFAULT_TRIAL_DAYS if the row, the
 * value, or the column (pre-mig-165) is missing. Never throws.
 */
export async function resolveTrialDays(sb: SupabaseClient, platformSlug: string): Promise<number> {
  try {
    const { data, error } = await sb
      .from('entitlement_plans')
      .select('trial_days')
      .eq('platform_slug', platformSlug)
      .eq('plan_key', 'trial')
      .maybeSingle();
    if (error) return DEFAULT_TRIAL_DAYS;
    const days = (data as { trial_days?: number | null } | null)?.trial_days;
    return typeof days === 'number' && days > 0 ? days : DEFAULT_TRIAL_DAYS;
  } catch {
    return DEFAULT_TRIAL_DAYS;
  }
}
