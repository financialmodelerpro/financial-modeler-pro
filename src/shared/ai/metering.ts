/**
 * shared/ai/metering.ts (SERVER ONLY)
 *
 * Server-side enforcement of the per-feature, per-plan AI caps.
 *
 * This is the half that was missing. Migration 203 stored the caps and the
 * admin panel edited them, but nothing read them at call time, so a cap was a
 * number on a screen. checkAndConsume closes that: it reads the cap from
 * ai_feature_caps (the same rows /admin/ai-features writes), claims one
 * generation atomically, and denies once the cap is reached.
 *
 * THE CAP COMES FROM THE DATABASE, ALWAYS. There is no hardcoded enforcement
 * value anywhere in this file. DEFAULT_AI_MONTHLY_CAPS in registryTypes is a
 * SEEDING default used at registration time; once a row exists the row wins,
 * and editing it in the panel changes what is enforced on the very next call
 * (the registry reads with no cache in front of it).
 *
 * FAIL CLOSED, EVERY TIME. Every uncertain path denies:
 *   - feature not registered      -> deny
 *   - feature disabled            -> deny
 *   - no cap row for the plan     -> deny
 *   - cap of zero                 -> deny
 *   - registry or counter store unreachable -> deny
 * A metering layer that opens the gate when its own storage fails is not a
 * metering layer. The cost of a false deny is a support message; the cost of a
 * false allow is an unbounded bill on someone else's API.
 *
 * NO ADMIN BYPASS, DELIBERATELY. The entitlement gate bypasses admins so
 * support can never be locked out of a feature. A cap is not an entitlement, it
 * is a spend control, and the account most able to run up a bill is the admin.
 * Admins are metered on their own plan's cap and can raise it in the panel,
 * where the change is visible and auditable.
 *
 * ATOMICITY. Read-compare-increment in application code is a race: two
 * concurrent generations can both see "4 of 5" and both proceed. The decision
 * is made inside ai_usage_consume (migration 205) in one statement, and it
 * increments only when the call is allowed, so a blocked attempt does not
 * inflate the usage the admin sees.
 *
 * No em dashes in this file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerClient } from '@/src/core/db/supabase';
import { getAiFeature } from './registry';
import { resolveAiCap } from './registryTypes';

/** Why a generation was refused. Callers map these to user-facing copy. */
export type MeterDenyReason =
  /** No such feature in the registry for this platform. */
  | 'not_registered'
  /** Registered but switched off in the admin panel. */
  | 'disabled'
  /** No cap configured for this user's plan. Denied on purpose: an AI feature
   *  with no ceiling is an uncapped bill, and the panel makes it a quick fix. */
  | 'no_cap'
  /** The plan's cap is reached for this period, or the cap is zero. */
  | 'cap_reached'
  /** The user has no resolvable plan. */
  | 'no_plan'
  /** Registry or counter storage was unreachable. Fail closed. */
  | 'unavailable';

export type MeterDecision =
  | { allowed: true; used: number; cap: number; remaining: number; planKey: string; periodStart: string }
  | { allowed: false; reason: MeterDenyReason; message: string; cap: number | null; planKey: string | null };

/** First day of the current calendar month, UTC, as YYYY-MM-DD. The period key
 *  and therefore the monthly reset: a new month is simply a new counter row. */
export function currentPeriodStart(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

function isMissing(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST202' || err.code === 'PGRST205' || err.code === 'PGRST106') return true;
  return /does not exist|could not find|schema cache/i.test(err.message ?? '');
}

/**
 * The plan key a user is metered on. Read from the LIVE users row, matching how
 * the entitlement gate resolves a plan (never from the JWT, which can be stale).
 */
export async function resolveUserPlanKey(
  userId: string,
  sb: SupabaseClient = getServerClient(),
): Promise<string | null> {
  const res = await sb.from('users').select('subscription_plan').eq('id', userId).maybeSingle();
  if (res.error || !res.data) return null;
  const plan = (res.data as { subscription_plan?: string }).subscription_plan;
  return typeof plan === 'string' && plan.trim() ? plan.trim() : null;
}

export interface ConsumeInput {
  userId: string;
  featureId: string;
  platformSlug: string;
  /** Pre-resolved plan key. Omit and it is read from the users row. */
  planKey?: string;
  now?: Date;
  sb?: SupabaseClient;
}

/**
 * Claim one generation for a user against their plan's cap.
 *
 * Call this BEFORE runAi. An allowed decision has already consumed the credit,
 * so a caller that then fails to make the request has burned one; that is the
 * safe direction, since the alternative (consume after a successful call) lets
 * concurrent requests all pass the check first.
 *
 * Never throws.
 */
export async function checkAndConsume(input: ConsumeInput): Promise<MeterDecision> {
  const sb = input.sb ?? getServerClient();
  const periodStart = currentPeriodStart(input.now);

  const deny = (reason: MeterDenyReason, message: string, cap: number | null, planKey: string | null): MeterDecision =>
    ({ allowed: false, reason, message, cap, planKey });

  // 1. The feature must exist and be switched on.
  let feature;
  try {
    feature = await getAiFeature(input.featureId, input.platformSlug, sb);
  } catch {
    return deny('unavailable', 'The AI feature registry could not be read.', null, null);
  }
  if (!feature) {
    return deny('not_registered', `The AI feature "${input.featureId}" is not registered for this platform.`, null, null);
  }
  if (!feature.enabled) {
    return deny('disabled', `${feature.name} is switched off.`, null, null);
  }

  // 2. The user's plan.
  const planKey = input.planKey ?? await resolveUserPlanKey(input.userId, sb);
  if (!planKey) {
    return deny('no_plan', 'No plan could be resolved for this account, so no AI cap applies.', null, null);
  }

  // 3. The cap, straight from ai_feature_caps via the registry. This is the
  //    value the admin panel writes, so an edit there lands here immediately.
  const cap = resolveAiCap(feature, planKey);
  if (cap === null) {
    return deny('no_cap',
      `No monthly AI limit is configured for the ${planKey} plan on ${feature.name}. Set one in the AI Control Panel.`,
      null, planKey);
  }
  if (cap <= 0) {
    return deny('cap_reached', `${feature.name} is not included in the ${planKey} plan.`, cap, planKey);
  }

  // 4. Claim the credit atomically.
  const res = await sb.rpc('ai_usage_consume', {
    p_user: input.userId,
    p_feature: feature.id,
    p_period: periodStart,
    p_cap: cap,
  });

  if (res.error) {
    // Includes the pre-migration case: no counter table or function yet. Deny,
    // because the alternative is an unmetered call.
    const detail = isMissing(res.error) ? 'AI usage metering is not installed.' : 'The AI usage counter could not be updated.';
    console.error('[ai-metering] consume failed, denying:', { featureId: input.featureId, code: res.error.code, message: res.error.message });
    return deny('unavailable', detail, cap, planKey);
  }

  const used = typeof res.data === 'number' ? res.data : null;
  if (used === null) {
    return deny('cap_reached',
      `Monthly AI limit reached for ${feature.name} on the ${planKey} plan (${cap} this month).`,
      cap, planKey);
  }

  return { allowed: true, used, cap, remaining: Math.max(0, cap - used), planKey, periodStart };
}

/** HTTP status for a denial. 402 marks "upgrade to continue", which is what a
 *  cap actually means, and separates it from a permission error. */
export function meterDenyStatus(reason: MeterDenyReason): number {
  switch (reason) {
    case 'cap_reached': return 402;
    case 'disabled':
    case 'not_registered': return 404;
    case 'no_cap':
    case 'no_plan':
    case 'unavailable': return 503;
  }
}
