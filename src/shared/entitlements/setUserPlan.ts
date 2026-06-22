/**
 * setUserPlan.ts (server)
 *
 * THE single shared plan-setting function. Both /admin/users (inline plan
 * control) and /admin/access (plan selector + trial approval) call this, so a
 * plan change writes the users row the same way regardless of which screen made
 * it, and entitlements re-resolve identically afterward.
 *
 * Rules:
 *   - plan_key must be a real entitlement plan for the platform (data-driven;
 *     never a legacy name). Unknown keys are rejected.
 *   - Trial: subscription_status = 'trial', trial_ends_at = now + configured
 *     trial days (from config, never hardcoded).
 *   - Any paid plan: subscription_status = 'active', trial_ends_at cleared.
 *
 * Display/enforcement are untouched: this only writes subscription_plan /
 * subscription_status / trial_ends_at; resolveUserGate reads them live.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveTrialDays, trialEndsAtIso } from './trialConfig';
import { writeAuditLog } from '@/src/shared/audit';

export interface SetUserPlanResult {
  ok: boolean;
  error?: string;
  status?: number;
  planKey?: string;
  subscriptionStatus?: string;
  trialEndsAt?: string | null;
}

export async function setUserPlan(
  sb: SupabaseClient,
  userId: string,
  planKeyRaw: string,
  opts?: { platform?: string; adminId?: string | null },
): Promise<SetUserPlanResult> {
  const platform = opts?.platform ?? 'real-estate';
  const planKey = String(planKeyRaw ?? '').trim().toLowerCase();
  if (!userId) return { ok: false, error: 'user_id required', status: 400 };
  if (!planKey) return { ok: false, error: 'plan_key required', status: 400 };

  // Validate against the live plan catalog (data-driven, so only real plans are
  // ever written, never legacy free/professional/enterprise).
  const { data: plan, error: planErr } = await sb
    .from('entitlement_plans')
    .select('plan_key')
    .eq('platform_slug', platform)
    .eq('plan_key', planKey)
    .maybeSingle();
  if (planErr) return { ok: false, error: planErr.message, status: 500 };
  if (!plan) return { ok: false, error: `Unknown plan "${planKey}" for ${platform}`, status: 400 };

  const { data: current, error: curErr } = await sb
    .from('users')
    .select('subscription_plan, subscription_status, trial_ends_at')
    .eq('id', userId)
    .single();
  if (curErr || !current) return { ok: false, error: 'User not found', status: 404 };

  const isTrial = planKey === 'trial';
  let trialEndsAt: string | null = null;
  let status: string;
  if (isTrial) {
    const days = await resolveTrialDays(sb, platform);
    trialEndsAt = trialEndsAtIso(Date.now(), days);
    status = 'trial';
  } else {
    // Paid plan: clear the trial window and mark active.
    trialEndsAt = null;
    status = 'active';
  }

  const { error: updErr } = await sb.from('users').update({
    subscription_plan: planKey,
    subscription_status: status,
    trial_ends_at: trialEndsAt,
    updated_at: new Date().toISOString(),
  }).eq('id', userId);
  if (updErr) return { ok: false, error: updErr.message, status: 500 };

  if (opts?.adminId) {
    await writeAuditLog({
      adminId: opts.adminId,
      action: 'plan_assignment',
      targetUserId: userId,
      beforeValue: { plan: current.subscription_plan, status: current.subscription_status, trial_ends_at: current.trial_ends_at },
      afterValue: { plan: planKey, status, trial_ends_at: trialEndsAt },
    });
  }

  return { ok: true, planKey, subscriptionStatus: status, trialEndsAt };
}
