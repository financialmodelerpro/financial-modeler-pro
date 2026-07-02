import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadUserPaddleContext, DEFAULT_PAYMENTS_PLATFORM } from '@/src/shared/payments/subscriptionContext';
import { getSubscription } from '@/src/shared/payments/paddleApi';
import { loadPlatformPlanOptions, markSubscriptionCanceling } from '@/src/shared/payments/config';

// GET /api/payments/subscription?platform=<slug>
// Returns the signed-in user's subscription summary FOR ONE PLATFORM, read from
// Paddle's API on the SERVER (the API key never reaches the client), plus the
// platform's plan options (for upgrade/downgrade) and the current plan key. A
// user with no subscription for the platform gets a clean { subscription: null }
// state, not an error, so the billing tab can render an appropriate empty state.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? '';
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const platform = req.nextUrl.searchParams.get('platform') || DEFAULT_PAYMENTS_PLATFORM;
  const sb = getServerClient();
  const ctx = await loadUserPaddleContext(sb, userId, platform);

  // Plan options are platform-scoped and useful even with no subscription (to
  // show what is available); only labels + keys leave the server, no secrets.
  const planOptionRows = await loadPlatformPlanOptions(sb, platform);
  const planOptions = planOptionRows.map((p) => ({ plan_key: p.plan_key, label: p.label }));

  // A pending deferred downgrade (mig 178), with the target plan's label for the
  // panel's "switches to X on [date]" note.
  const scheduledChange = ctx.scheduled
    ? {
        planKey: ctx.scheduled.planKey,
        interval: ctx.scheduled.interval,
        effectiveAt: ctx.scheduled.effectiveAt,
        label: planOptionRows.find((p) => p.plan_key === ctx.scheduled!.planKey)?.label ?? ctx.scheduled.planKey,
      }
    : null;

  // Manual (admin-assigned, offline-paid) plan: render from the local row, no
  // Paddle calls and no Paddle-only actions (cancel/upgrade/update-card).
  if (ctx.state === 'manual' && ctx.manual) {
    const manualSub = {
      source: 'manual' as const,
      planKey: ctx.planKey,
      status: ctx.manual.status ?? 'active',
      startedAt: ctx.manual.startedAt,
      currentPeriodEnd: ctx.manual.currentPeriodEnd,
      expiresAt: ctx.manual.expiresAt,
      amountMinor: ctx.manual.amountMinor,
      currency: ctx.manual.currency,
      note: ctx.manual.note,
    };
    return NextResponse.json({ subscription: manualSub, platform, planOptions, currentPlanKey: ctx.planKey, scheduledChange });
  }

  if (ctx.state !== 'ok' || !ctx.subscriptionId) {
    return NextResponse.json({ subscription: null, reason: ctx.state, platform, planOptions, currentPlanKey: ctx.planKey, scheduledChange });
  }

  const res = await getSubscription(ctx.cfg, ctx.subscriptionId);
  if (!res.ok) {
    return NextResponse.json({ subscription: null, reason: res.error, platform, planOptions, currentPlanKey: ctx.planKey, scheduledChange }, { status: res.status >= 500 ? 502 : 200 });
  }
  // Self-heal the durable cancel marker (mig 183) from the authoritative live
  // state, so the admin list (which reads the durable marker, not a per-user live
  // call) agrees with this live view. null clears it when a cancel was un-scheduled
  // (resume). Best effort; display only, gate inputs untouched.
  await markSubscriptionCanceling(sb, userId, platform, { scheduledCancelAt: res.data.scheduledCancelAt ?? null });
  return NextResponse.json({ subscription: { source: 'paddle' as const, ...res.data }, platform, planOptions, currentPlanKey: ctx.planKey, scheduledChange });
}
