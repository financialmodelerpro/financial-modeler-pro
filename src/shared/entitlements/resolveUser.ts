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

    const trialEndsAt = (user.trial_ends_at as string | null) ?? null;
    const trialExpired = planKey === 'trial' && !!trialEndsAt && Date.parse(trialEndsAt) < Date.now();

    // Additive: a manual plan (mig 179) can carry an expires_at the gate honors
    // like a trial. Separate, schema-tolerant query so a pre-migration DB (or no
    // row) simply yields no expiry. Does not change the plan input (still
    // users.subscription_plan); only adds the expiry check.
    let planExpired = false;
    try {
      const { data: subRow } = await sb
        .from('user_platform_subscriptions')
        .select('expires_at')
        .eq('user_id', userId)
        .eq('platform_slug', platform)
        .maybeSingle();
      const exp = (subRow as { expires_at?: string | null } | null)?.expires_at ?? null;
      planExpired = !!exp && Date.parse(exp) < Date.now();
    } catch {
      // table/column absent pre-migration: no manual expiry.
    }

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
      features,
      planCells,
      overrides,
      nowMs: Date.now(),
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
      error: false,
    };
  } catch (e) {
    console.error('[entitlements] resolveUserGate threw, failing closed', {
      userId, error: e instanceof Error ? e.message : String(e),
    });
    return deniedGate(userId, sessionIsAdmin);
  }
}
