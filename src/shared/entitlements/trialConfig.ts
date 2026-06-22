/**
 * trialConfig.ts
 *
 * Trial duration is config-driven, never hardcoded inline at the call site.
 * DEFAULT_TRIAL_DAYS is the fallback constant; the server prefers a value read
 * from platform_pricing.trial_days for the platform (resolveTrialDays), so an
 * admin editing the trial length in the Pricing editor changes trial approval
 * here too.
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
 * Resolve the configured trial length (in days) for a platform. Reads the
 * first active platform_pricing plan that defines a positive trial_days,
 * falling back to DEFAULT_TRIAL_DAYS. Never throws: any DB error yields the
 * default so trial approval still works.
 */
export async function resolveTrialDays(sb: SupabaseClient, platformSlug: string): Promise<number> {
  try {
    const { data } = await sb
      .from('platform_pricing')
      .select('trial_days, display_order, is_active')
      .eq('platform_slug', platformSlug)
      .order('display_order');
    const row = (data ?? []).find(
      (r: { trial_days: number | null; is_active?: boolean }) =>
        (r.is_active ?? true) && (r.trial_days ?? 0) > 0,
    );
    const days = row?.trial_days;
    return typeof days === 'number' && days > 0 ? days : DEFAULT_TRIAL_DAYS;
  } catch {
    return DEFAULT_TRIAL_DAYS;
  }
}
