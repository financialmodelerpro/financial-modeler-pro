import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadUserPaddleContext, DEFAULT_PAYMENTS_PLATFORM } from '@/src/shared/payments/subscriptionContext';
import { getSubscription, previewSubscriptionChange } from '@/src/shared/payments/paddleApi';
import { loadPlatformPlanOptions, planProviderPriceId, classifyPlanOrIntervalChange } from '@/src/shared/payments/config';
import { loadPlanFeatureList } from '@/src/shared/entitlements/pricingCatalog';
import { resolveDiscountForChange } from '@/src/shared/payments/coupons';
import type { BillingInterval } from '@/src/shared/payments/types';

// POST /api/payments/subscription/preview-change
// body: { platform, plan_key, interval? }
// PREVIEW ONLY (no charge): returns the target plan's full feature list + the
// prorated differential (charge or credit) Paddle would apply if the user
// confirmed. Used to populate the switch confirmation. interval (monthly/annual)
// lets the preview cover an interval change too; it defaults to the
// subscription's current interval. All Paddle calls are server-side.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? '';
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let platform = DEFAULT_PAYMENTS_PLATFORM;
  let planKey = '';
  let interval: BillingInterval | null = null;
  let couponCode = '';
  try {
    const body = await req.json() as { platform?: string; plan_key?: string; interval?: string; coupon_code?: string };
    platform = (body.platform ?? '').trim().toLowerCase() || DEFAULT_PAYMENTS_PLATFORM;
    planKey = String(body.plan_key ?? '').trim().toLowerCase();
    if (body.interval === 'annual' || body.interval === 'monthly') interval = body.interval;
    couponCode = String(body.coupon_code ?? '').trim();
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_body' }, { status: 400 });
  }
  if (!planKey) return NextResponse.json({ ok: false, reason: 'plan_key_required' }, { status: 400 });

  const sb = getServerClient();
  const ctx = await loadUserPaddleContext(sb, userId, platform);
  if (ctx.state !== 'ok' || !ctx.subscriptionId) {
    return NextResponse.json({ ok: false, reason: ctx.state }, { status: 400 });
  }

  const current = await getSubscription(ctx.cfg, ctx.subscriptionId);
  if (!current.ok) return NextResponse.json({ ok: false, reason: current.error }, { status: 502 });
  const targetInterval: BillingInterval = interval ?? current.data.billingInterval ?? 'monthly';

  // The target plan's full feature list (catalog), shown before confirming.
  const featureList = await loadPlanFeatureList(sb, platform, planKey);

  // Resolve the target price id for the chosen plan + interval.
  const plans = await loadPlatformPlanOptions(sb, platform);
  const target = plans.find((p) => p.plan_key === planKey);
  if (!target) return NextResponse.json({ ok: false, reason: 'unknown_plan' }, { status: 400 });
  const targetPriceId = planProviderPriceId(target, 'paddle', targetInterval);
  if (!targetPriceId) {
    return NextResponse.json({ ok: false, reason: 'plan_has_no_price_for_interval', interval: targetInterval, targetLabel: featureList.label, targetFeatures: featureList.features }, { status: 200 });
  }

  // Same price as today: no charge, just confirm the (unchanged) feature list.
  if (targetPriceId === current.data.currentPriceId) {
    return NextResponse.json({
      ok: true, sameAsCurrent: true, changeType: 'lateral', interval: targetInterval,
      targetLabel: featureList.label, targetFeatures: featureList.features, differential: null,
    });
  }

  // Classify the change. A same-plan interval change is 'interval' (NOT a tier
  // downgrade); tier upgrade/downgrade is compared at a single interval so the
  // annual discount never masquerades as a downgrade (bug b fix).
  const currentPlan = plans.find((p) => p.plan_key === (ctx.planKey ?? ''));
  const currentInterval: BillingInterval = current.data.billingInterval ?? 'monthly';
  const changeType = classifyPlanOrIntervalChange(ctx.planKey, currentInterval, planKey, targetInterval, plans);

  // The target plan's recurring price for the chosen interval (for the copy).
  const newPriceAmount = targetInterval === 'annual' ? target.price_annual : target.price_monthly;
  const newPrice = (newPriceAmount !== null && newPriceAmount !== undefined)
    ? { amount: Number(newPriceAmount), currency: target.currency ?? null, interval: targetInterval }
    : null;
  const currentLabel = currentPlan?.label ?? ctx.planKey ?? 'your current plan';

  // DOWNGRADE: deferred to the next billing cycle. No charge now; nothing changes
  // today. The confirm copy states the effective date + the new price from then.
  if (changeType === 'downgrade') {
    const effectiveAt = current.data.currentPeriodEndsAt ?? current.data.nextBilledAt ?? null;
    return NextResponse.json({
      ok: true, sameAsCurrent: false, changeType: 'downgrade', interval: targetInterval,
      targetLabel: featureList.label, targetFeatures: featureList.features,
      differential: null,            // no immediate charge or credit
      effectiveAt, currentLabel, newPrice,
    });
  }

  // Resolve the discount the change would apply (typed coupon wins, else active
  // public promo), so the previewed proration matches what will be charged. An
  // invalid typed code is surfaced (couponError) and the preview runs WITHOUT a
  // discount so the user still sees the (undiscounted) amount.
  const discount = await resolveDiscountForChange(sb, { code: couponCode, platform });
  const couponError = couponCode && discount.error ? discount.error : null;

  // UPGRADE / LATERAL / INTERVAL: immediate, prorated. Preview the proration with
  // the discount applied (no charge yet). On a preview error still return the
  // feature list so confirm works.
  const preview = await previewSubscriptionChange(ctx.cfg, ctx.subscriptionId, targetPriceId, 'prorated_immediately', discount.discountId);
  return NextResponse.json({
    ok: true, sameAsCurrent: false, changeType, interval: targetInterval,
    targetLabel: featureList.label, targetFeatures: featureList.features,
    differential: preview.ok ? preview.data : null,
    previewError: preview.ok ? null : preview.error,
    currentLabel, newPrice,
    discountLabel: discount.label, couponError,
  });
}
