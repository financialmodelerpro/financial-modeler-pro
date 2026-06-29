import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadUserPaddleContext, DEFAULT_PAYMENTS_PLATFORM } from '@/src/shared/payments/subscriptionContext';
import { getSubscription, changeSubscriptionPlan } from '@/src/shared/payments/paddleApi';
import {
  loadPlatformPlanOptions, planProviderPriceId, effectiveMonthlyPrice, classifyPlanChange,
  storeScheduledChange, clearScheduledChange,
} from '@/src/shared/payments/config';
import type { BillingInterval } from '@/src/shared/payments/types';

// POST /api/payments/subscription/change-plan
// body: { platform, plan_key, interval? }
// Upgrades / downgrades the signed-in user's subscription FOR ONE PLATFORM to a
// target plan (and optionally a different billing interval) by swapping the
// Paddle subscription's item to that plan's price id. interval defaults to the
// subscription's current interval, so a plan-only switch keeps the interval and
// an interval-only change keeps the plan. Server-side only; the API key never
// reaches the client. This route does NOT write the user's plan: Paddle applies
// the change and the existing subscription.updated webhook syncs the app plan
// (the single enforcement path), unchanged.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? '';
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let platform = DEFAULT_PAYMENTS_PLATFORM;
  let planKey = '';
  let interval: BillingInterval | null = null;
  try {
    const body = await req.json() as { platform?: string; plan_key?: string; interval?: string };
    platform = (body.platform ?? '').trim().toLowerCase() || DEFAULT_PAYMENTS_PLATFORM;
    planKey = String(body.plan_key ?? '').trim().toLowerCase();
    if (body.interval === 'annual' || body.interval === 'monthly') interval = body.interval;
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_body' }, { status: 400 });
  }
  if (!planKey) return NextResponse.json({ ok: false, reason: 'plan_key_required' }, { status: 400 });

  const sb = getServerClient();
  const ctx = await loadUserPaddleContext(sb, userId, platform);
  if (ctx.state !== 'ok' || !ctx.subscriptionId) {
    return NextResponse.json({ ok: false, reason: ctx.state }, { status: 400 });
  }

  // Read the current subscription to learn its billing interval (the fallback
  // when none is requested) and detect a no-op.
  const current = await getSubscription(ctx.cfg, ctx.subscriptionId);
  if (!current.ok) return NextResponse.json({ ok: false, reason: current.error }, { status: 502 });
  const targetInterval: BillingInterval = interval ?? current.data.billingInterval ?? 'monthly';

  // Resolve the target plan's Paddle price id for this platform + interval.
  const plans = await loadPlatformPlanOptions(sb, platform);
  const target = plans.find((p) => p.plan_key === planKey);
  if (!target) return NextResponse.json({ ok: false, reason: 'unknown_plan' }, { status: 400 });
  const targetPriceId = planProviderPriceId(target, 'paddle', targetInterval);
  if (!targetPriceId) {
    return NextResponse.json({ ok: false, reason: 'plan_has_no_price_for_interval' }, { status: 400 });
  }
  if (targetPriceId === current.data.currentPriceId) {
    return NextResponse.json({ ok: false, reason: 'already_on_plan' }, { status: 400 });
  }

  // Classify by monthly-equivalent effective price (same basis for interval
  // changes). Upgrade / lateral -> apply now; downgrade -> defer to next cycle.
  const currentPlan = plans.find((p) => p.plan_key === (ctx.planKey ?? ''));
  const currentInterval: BillingInterval = current.data.billingInterval ?? 'monthly';
  const currentEff = currentPlan ? effectiveMonthlyPrice(currentPlan, currentInterval) : null;
  const targetEff = effectiveMonthlyPrice(target, targetInterval);
  const changeType = classifyPlanChange(currentEff, targetEff);

  // DOWNGRADE: schedule for the next billing cycle. Do NOT touch Paddle now (no
  // charge, the user keeps their current higher plan). The apply-scheduled-changes
  // worker performs the swap at effectiveAt; the subscription.updated webhook then
  // syncs the app plan. Storing the schedule does not change the gate's inputs.
  if (changeType === 'downgrade') {
    const effectiveAt = current.data.currentPeriodEndsAt ?? current.data.nextBilledAt ?? null;
    await storeScheduledChange(sb, userId, platform, { planKey, interval: targetInterval, priceId: targetPriceId, effectiveAt });
    return NextResponse.json({
      ok: true, applied: 'scheduled', planKey,
      scheduledChange: { planKey, interval: targetInterval, effectiveAt },
    });
  }

  // UPGRADE / LATERAL: apply immediately with proration. Clear any pending
  // downgrade it supersedes.
  const res = await changeSubscriptionPlan(ctx.cfg, ctx.subscriptionId, targetPriceId);
  if (!res.ok) {
    return NextResponse.json({ ok: false, reason: res.error }, { status: res.status >= 500 ? 502 : 400 });
  }
  await clearScheduledChange(sb, userId, platform);
  // Return the refreshed summary; the webhook keeps the app plan in sync.
  return NextResponse.json({ ok: true, applied: 'immediate', subscription: res.data, planKey });
}
