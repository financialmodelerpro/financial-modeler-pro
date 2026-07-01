import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadUserPaddleContext, DEFAULT_PAYMENTS_PLATFORM } from '@/src/shared/payments/subscriptionContext';
import { cancelSubscriptionAtPeriodEnd } from '@/src/shared/payments/paddleApi';
import { loadPlatformSubscriptionRow } from '@/src/shared/payments/config';
import { sendSubscriptionCanceledEmail } from '@/src/shared/email/subscriptionEmails';

// POST /api/payments/subscription/cancel
// Cancels the signed-in user's subscription AT PERIOD END via Paddle's API (the
// user keeps access until the period they paid for ends). This route does NOT
// change the user's plan or entitlements: access continues until period end,
// then Paddle sends subscription.canceled and the existing webhook drops the
// user to the baseline plan (the single enforcement path, unchanged). The Paddle
// API key is used server-side only.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? '';
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const platform = req.nextUrl.searchParams.get('platform') || DEFAULT_PAYMENTS_PLATFORM;
  const sb = getServerClient();
  const ctx = await loadUserPaddleContext(sb, userId, platform);
  if (ctx.state !== 'ok' || !ctx.subscriptionId) {
    return NextResponse.json({ ok: false, reason: ctx.state }, { status: 400 });
  }

  const res = await cancelSubscriptionAtPeriodEnd(ctx.cfg, ctx.subscriptionId);
  if (!res.ok) {
    return NextResponse.json({ ok: false, reason: res.error }, { status: res.status >= 500 ? 502 : 400 });
  }
  // Confirmation email: cancellation acknowledged + the date access continues
  // until (self-contained, never throws). Uses the period-end from the refreshed
  // Paddle summary; plan label from the stored per-platform row.
  const row = await loadPlatformSubscriptionRow(sb, userId, platform);
  await sendSubscriptionCanceledEmail(sb, {
    userId, platform, planKey: row?.plan_key ?? '',
    accessUntil: res.data.scheduledCancelAt ?? res.data.currentPeriodEndsAt ?? null,
  });

  // Return the refreshed summary so the panel can reflect canceled-at-period-end
  // and the date access ends, without stripping access now.
  return NextResponse.json({ ok: true, subscription: res.data });
}
