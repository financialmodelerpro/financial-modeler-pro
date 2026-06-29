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
import { NONE_PLAN_KEY } from './gate';
import { upsertManualSubscription } from '@/src/shared/payments/config';

export interface SetUserPlanResult {
  ok: boolean;
  error?: string;
  status?: number;
  planKey?: string;
  subscriptionStatus?: string;
  trialEndsAt?: string | null;
}

/** Manual (admin-assigned, offline-paid) subscription details. When provided,
 *  setUserPlan ALSO upserts the per-platform row (source 'manual') so the gate
 *  and the billing panel read consistent plan data, with a start + expiry the
 *  gate honors and an amount for revenue. Omitted on the webhook path (which
 *  writes the per-platform row itself with source 'paddle'). */
export interface ManualSubscriptionInput {
  source: 'manual';
  startedAt?: string | null;
  currentPeriodEnd?: string | null;
  expiresAt?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  note?: string | null;
}

export async function setUserPlan(
  sb: SupabaseClient,
  userId: string,
  planKeyRaw: string,
  opts?: { platform?: string; adminId?: string | null; subscription?: ManualSubscriptionInput },
): Promise<SetUserPlanResult> {
  const platform = opts?.platform ?? 'real-estate';
  const planKey = String(planKeyRaw ?? '').trim().toLowerCase();
  if (!userId) return { ok: false, error: 'user_id required', status: 400 };
  if (!planKey) return { ok: false, error: 'plan_key required', status: 400 };

  // 'none' is the deliberate NO-ACCESS state (foundation). It is a first-class
  // value here (the ONE write path), but it is NOT an entitlement_plans row, so
  // it bypasses the catalog validation. status uses an allowed value ('expired'
  // = no active subscription); the resolver treats subscription_plan='none' as
  // zero access. This is NOT a legacy write (legacy free/professional/enterprise
  // are still rejected below).
  const isNone = planKey === NONE_PLAN_KEY;
  if (!isNone) {
    // Validate against the live plan catalog (data-driven, so only real plans
    // are ever written, never legacy free/professional/enterprise).
    const { data: plan, error: planErr } = await sb
      .from('entitlement_plans')
      .select('plan_key')
      .eq('platform_slug', platform)
      .eq('plan_key', planKey)
      .maybeSingle();
    if (planErr) return { ok: false, error: planErr.message, status: 500 };
    if (!plan) return { ok: false, error: `Unknown plan "${planKey}" for ${platform}`, status: 400 };
  }

  const { data: current, error: curErr } = await sb
    .from('users')
    .select('subscription_plan, subscription_status, trial_ends_at')
    .eq('id', userId)
    .single();
  if (curErr || !current) return { ok: false, error: 'User not found', status: 404 };

  const isTrial = planKey === 'trial';
  let trialEndsAt: string | null = null;
  let status: string;
  if (isNone) {
    // No-access: no trial window, status reads as no active subscription.
    trialEndsAt = null;
    status = 'expired';
  } else if (isTrial) {
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

  // Converge the per-platform row (store B) so the billing panel reads the SAME
  // plan as the gate (fixes the admin/user divergence). Only on the manual path;
  // the webhook writes store B itself with source 'paddle'.
  if (opts?.subscription?.source === 'manual') {
    await upsertManualSubscription(sb, userId, platform, {
      planKey,
      status,
      startedAt: opts.subscription.startedAt ?? new Date().toISOString(),
      currentPeriodEnd: opts.subscription.currentPeriodEnd ?? null,
      expiresAt: opts.subscription.expiresAt ?? trialEndsAt,
      amountMinor: opts.subscription.amountMinor ?? null,
      currency: opts.subscription.currency ?? null,
      note: opts.subscription.note ?? null,
    });
  }

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
