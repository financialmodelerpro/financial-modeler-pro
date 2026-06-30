/**
 * resolveUser.ts (server)
 *
 * The single server-side entry point that turns a signed-in user id into a
 * resolved gate (featureMap + projectLimit + archiveAllowed). It reads the
 * LIVE users row (subscription_plan / subscription_status / trial_ends_at /
 * role), NOT the JWT, because the session does not carry trial_ends_at and the
 * admin can change a plan mid-session.
 *
 * It REUSES the Phase C resolver (via computeGate -> resolveEffectiveFeatures)
 * and loadMergedFeatures. It adds the live facts the pure gate needs:
 *   - admin bypass (role === 'admin')
 *   - trial expiry (planKey 'trial' AND trial_ends_at in the past)
 *   - safety net: an unknown plan key resolves to full access and is LOGGED
 *     (user id + the unknown value), never a silent lockout.
 *
 * Fail-closed: any DB / resolution error returns a denied gate (every feature
 * false, no project slots, no archive) and is logged, but it never throws and
 * an admin still bypasses (fullAccess survives the error path).
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerClient } from '@/src/core/db/supabase';
import { loadMergedFeatures } from './serverCatalog';
import {
  computeGate,
  computeLapseState,
  resolveLapseAnchorMs,
  isKnownPlanKey,
  isNonePlan,
  type GateResult,
  type GateInput,
} from './gate';
import type { PlanCell, UserOverride, ResolveFeature } from './resolveOverrides';

export interface ResolvedUserGate extends GateResult {
  userId: string;
  role: string;
  isAdmin: boolean;
  planKey: string;
  knownPlan: boolean;
  trialEndsAt: string | null;
  activeProjectCount: number;
  /** The plan's access-expiry anchor (ISO): trial_ends_at for a trial, a manual
   *  plan's expires_at, or a canceled Paddle sub's current_period_end. Null when
   *  the plan does not expire (active / renewing). Drives the lapse state + the
   *  admin expiry column. */
  accessExpiresAt: string | null;
  /** The end of the 1-month read-only grace window (ISO), accessExpiresAt + 1
   *  month. Null when the plan does not expire. Shown in the renew banner. */
  graceEndsAt: string | null;
  /** True when resolution failed and the gate is the fail-closed default. */
  error: boolean;
}

function deniedGate(userId: string, isAdmin: boolean): ResolvedUserGate {
  // Admin keeps full access even when resolution fails (never blocked).
  return {
    userId,
    role: isAdmin ? 'admin' : 'unknown',
    isAdmin,
    planKey: '',
    knownPlan: false,
    trialEndsAt: null,
    activeProjectCount: 0,
    featureMap: {},
    projectLimit: isAdmin ? -1 : 0,
    archiveAllowed: isAdmin,
    fullAccess: isAdmin,
    trialExpired: false,
    lapseState: 'active',
    readOnly: false,
    accessExpiresAt: null,
    graceEndsAt: null,
    error: true,
  };
}

/** Count the user's ACTIVE (non-archived) projects. Tolerates a DB without the
 *  archived column (pre-migration-161) by falling back to counting all rows. */
export async function countActiveProjects(sb: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await sb
    .from('refm_projects')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('archived', false);
  if (!error) return count ?? 0;
  // archived column not present yet: count all rows so the cap still works
  // (every project counts as active until the migration lands).
  const { count: allCount } = await sb
    .from('refm_projects')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  return allCount ?? 0;
}

/**
 * Resolve the full gate for a user. `sessionIsAdmin` is passed from the route's
 * session so admin bypass holds even if the DB read fails.
 */
export async function resolveUserGate(
  userId: string,
  opts?: { platform?: string; sessionIsAdmin?: boolean },
): Promise<ResolvedUserGate> {
  const platform = opts?.platform ?? 'real-estate';
  const sessionIsAdmin = opts?.sessionIsAdmin ?? false;
  try {
    const sb = getServerClient();

    const { data: user, error: uErr } = await sb
      .from('users')
      .select('id, role, subscription_plan, subscription_status, trial_ends_at')
      .eq('id', userId)
      .single();
    if (uErr || !user) {
      console.error('[entitlements] resolveUserGate: user load failed', { userId, error: uErr?.message });
      return deniedGate(userId, sessionIsAdmin);
    }

    const role = (user.role as string) ?? 'user';
    const isAdmin = role === 'admin' || sessionIsAdmin;
    const planKey = (user.subscription_plan as string) ?? '';
    const knownPlan = isKnownPlanKey(planKey);

    // 'none' is the deliberate no-access state, NOT an unknown plan: do not warn
    // and do not grant the safety-net access. computeGate denies it explicitly.
    // Safety net: an unknown plan (neither known nor 'none') is never locked out.
    if (!isAdmin && !knownPlan && !isNonePlan(planKey)) {
      console.warn('[entitlements] unknown plan key, granting access-preserving default', {
        userId, subscription_plan: planKey,
      });
    }

    const nowMs = Date.now();
    const trialEndsAt = (user.trial_ends_at as string | null) ?? null;
    const trialEndsMs = trialEndsAt ? Date.parse(trialEndsAt) : null;
    const trialExpired = planKey === 'trial' && trialEndsMs != null && trialEndsMs < nowMs;

    // Resolve the per-platform subscription expiry anchor (mig 179). The anchor is
    // the date at which access lapses, and it drives the three-state model
    // (active -> read-only grace -> lapsed). Schema-tolerant: a pre-migration DB
    // (or no row) simply yields no anchor, so the plan never lapses on dates.
    //   - manual plan (source 'manual'): expires_at is the access-until date.
    //   - canceled / expired Paddle sub: current_period_end is the final paid date.
    //   - active / renewing Paddle sub: no past anchor, stays active.
    // The plan input is unchanged (still users.subscription_plan); this only adds
    // the lapse anchor the gate honors (additive, mirrors the old trial check).
    let subExpiresAtMs: number | null = null;
    let subPeriodEndMs: number | null = null;
    let subStatus: string | null = null;
    try {
      const { data: subRow } = await sb
        .from('user_platform_subscriptions')
        .select('expires_at, current_period_end, status, source')
        .eq('user_id', userId)
        .eq('platform_slug', platform)
        .maybeSingle();
      const row = subRow as {
        expires_at?: string | null;
        current_period_end?: string | null;
        status?: string | null;
        source?: string | null;
      } | null;
      if (row) {
        subExpiresAtMs = row.expires_at ? Date.parse(row.expires_at) : null;
        subPeriodEndMs = row.current_period_end ? Date.parse(row.current_period_end) : null;
        subStatus = row.status ?? null;
      }
    } catch {
      // table/columns absent pre-migration: no subscription anchor.
    }

    // The single access-expiry anchor (trial_ends_at for a trial, else the
    // subscription's manual expiry or a non-renewing sub's period end). Pure,
    // shared with the admin user list so both compute the same expiry + status.
    const accessExpiresMs = resolveLapseAnchorMs({
      planKey, trialEndsAtMs: trialEndsMs, subExpiresAtMs, subPeriodEndMs, subStatus,
    });
    const accessExpiresAt = accessExpiresMs != null ? new Date(accessExpiresMs).toISOString() : null;
    const { state: lapseState, graceEndsAtMs } = computeLapseState(accessExpiresMs, nowMs);
    const graceEndsAt = graceEndsAtMs != null ? new Date(graceEndsAtMs).toISOString() : null;
    // Kept for the legacy GateInput fallback + the "trial expired" message echo.
    const planExpired = lapseState !== 'active';

    const catalog = await loadMergedFeatures(sb, platform);
    const features = catalog.features as unknown as ResolveFeature[];

    // Plan coverage + overrides. Skip when full access (admin/unknown) since
    // computeGate ignores them in that path anyway.
    const planCells = new Map<string, PlanCell>();
    const overrides: UserOverride[] = [];
    if (knownPlan && !isAdmin) {
      const { data: perms } = await sb
        .from('plan_permissions')
        .select('feature_key, included, limit_value')
        .eq('plan_key', planKey);
      for (const p of (perms ?? []) as { feature_key: string; included: boolean; limit_value: number | null }[]) {
        planCells.set(p.feature_key, { included: p.included, limit_value: p.limit_value });
      }
      const { data: ovs } = await sb
        .from('user_permissions')
        .select('feature_key, mode, override_value, reason, expires_at')
        .eq('user_id', userId);
      for (const o of (ovs ?? []) as UserOverride[]) overrides.push(o);
    }

    const gateInput: GateInput = {
      isAdmin,
      planKey,
      knownPlan,
      trialExpired,
      planExpired,
      lapseState,
      features,
      planCells,
      overrides,
      nowMs,
    };
    const gate = computeGate(gateInput);
    const activeProjectCount = await countActiveProjects(sb, userId);

    return {
      ...gate,
      userId,
      role,
      isAdmin,
      planKey,
      knownPlan,
      trialEndsAt,
      activeProjectCount,
      accessExpiresAt,
      graceEndsAt,
      error: false,
    };
  } catch (e) {
    console.error('[entitlements] resolveUserGate threw, failing closed', {
      userId, error: e instanceof Error ? e.message : String(e),
    });
    return deniedGate(userId, sessionIsAdmin);
  }
}
