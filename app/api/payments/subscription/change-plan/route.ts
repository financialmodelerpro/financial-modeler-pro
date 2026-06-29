import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadUserPaddleContext, DEFAULT_PAYMENTS_PLATFORM } from '@/src/shared/payments/subscriptionContext';
import { getSubscription, changeSubscriptionPlan } from '@/src/shared/payments/paddleApi';
import { loadPlatformPlanOptions, planProviderPriceId } from '@/src/shared/payments/config';

// POST /api/payments/subscription/change-plan
// body: { platform, plan_key }
// Upgrades / downgrades the signed-in user's subscription FOR ONE PLATFORM to a
// target plan by swapping the Paddle subscription's item to that plan's price id
// (matched to the subscription's current interval). Server-side only; the API
// key never reaches the client. This route does NOT write the user's plan:
// Paddle applies the change and the existing subscription.updated webhook syncs
// the app plan (the single enforcement path), unchanged.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? '';
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let platform = DEFAULT_PAYMENTS_PLATFORM;
  let planKey = '';
  try {
    const body = await req.json() as { platform?: string; plan_key?: string };
    platform = (body.platform ?? '').trim().toLowerCase() || DEFAULT_PAYMENTS_PLATFORM;
    planKey = String(body.plan_key ?? '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_body' }, { status: 400 });
  }
  if (!planKey) return NextResponse.json({ ok: false, reason: 'plan_key_required' }, { status: 400 });

  const sb = getServerClient();
  const ctx = await loadUserPaddleContext(sb, userId, platform);
  if (ctx.state !== 'ok' || !ctx.subscriptionId) {
    return NextResponse.json({ ok: false, reason: ctx.state }, { status: 400 });
  }

  // Read the current subscription to learn its billing interval (so we move to
  // the matching monthly/annual price of the target plan) and detect a no-op.
  const current = await getSubscription(ctx.cfg, ctx.subscriptionId);
  if (!current.ok) return NextResponse.json({ ok: false, reason: current.error }, { status: 502 });
  const interval = current.data.billingInterval ?? 'monthly';

  // Resolve the target plan's Paddle price id for this platform + interval.
  const plans = await loadPlatformPlanOptions(sb, platform);
  const target = plans.find((p) => p.plan_key === planKey);
  if (!target) return NextResponse.json({ ok: false, reason: 'unknown_plan' }, { status: 400 });
  const targetPriceId = planProviderPriceId(target, 'paddle', interval);
  if (!targetPriceId) {
    return NextResponse.json({ ok: false, reason: 'plan_has_no_price_for_interval' }, { status: 400 });
  }
  if (targetPriceId === current.data.currentPriceId) {
    return NextResponse.json({ ok: false, reason: 'already_on_plan' }, { status: 400 });
  }

  const res = await changeSubscriptionPlan(ctx.cfg, ctx.subscriptionId, targetPriceId);
  if (!res.ok) {
    return NextResponse.json({ ok: false, reason: res.error }, { status: res.status >= 500 ? 502 : 400 });
  }
  // Return the refreshed summary; the webhook keeps the app plan in sync.
  return NextResponse.json({ ok: true, subscription: res.data, planKey });
}
