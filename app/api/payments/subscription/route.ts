import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadUserPaddleContext, DEFAULT_PAYMENTS_PLATFORM } from '@/src/shared/payments/subscriptionContext';
import { getSubscription } from '@/src/shared/payments/paddleApi';
import { loadPlatformPlanOptions } from '@/src/shared/payments/config';

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
  const planOptions = (await loadPlatformPlanOptions(sb, platform)).map((p) => ({ plan_key: p.plan_key, label: p.label }));

  if (ctx.state !== 'ok' || !ctx.subscriptionId) {
    return NextResponse.json({ subscription: null, reason: ctx.state, platform, planOptions, currentPlanKey: ctx.planKey });
  }

  const res = await getSubscription(ctx.cfg, ctx.subscriptionId);
  if (!res.ok) {
    return NextResponse.json({ subscription: null, reason: res.error, platform, planOptions, currentPlanKey: ctx.planKey }, { status: res.status >= 500 ? 502 : 200 });
  }
  return NextResponse.json({ subscription: res.data, platform, planOptions, currentPlanKey: ctx.planKey });
}
