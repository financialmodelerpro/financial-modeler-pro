import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { setUserPlan } from '@/src/shared/entitlements/setUserPlan';
import {
  loadPaymentSettings, providerConfigFrom, loadPlatformSubscriptionRow, isLivePaddleSubscription,
  storeScheduledManualConversion, recordPaymentTransaction,
} from '@/src/shared/payments/config';
import { getSubscription, cancelSubscriptionAtPeriodEnd, cancelSubscriptionNow } from '@/src/shared/payments/paddleApi';

// POST /api/admin/subscription/convert-to-manual
// body: { user_id, platform?, when: 'period_end'|'immediate', plan_key, expires_at?, amount_minor?, currency?, note? }
//
// The SAFE convert action for a Paddle-billed user (distinct from the blocked
// silent plan change). Default 'period_end': cancel Paddle at the period end and
// SCHEDULE the manual plan to begin then (no wasted prepaid time); the user keeps
// Paddle access until then, then the subscription.canceled webhook applies the
// manual plan. 'immediate': cancel Paddle now and start the manual plan now
// (the UI warns about unused prepaid time). Reuses the existing cancel +
// setUserPlan + scheduled-change mechanisms; all Paddle calls server-side.

async function checkAdminSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') return null;
  return session;
}

export async function POST(req: NextRequest) {
  const session = await checkAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json() as {
      user_id: string; platform?: string; when?: 'period_end' | 'immediate'; plan_key: string;
      expires_at?: string | null; amount_minor?: number | null; currency?: string | null; note?: string | null;
    };
    const { user_id, plan_key } = body;
    const platform = body.platform ?? 'real-estate';
    const when = body.when === 'immediate' ? 'immediate' : 'period_end';
    if (!user_id || !plan_key) return NextResponse.json({ error: 'user_id and plan_key required' }, { status: 400 });

    const sb = getServerClient();
    const row = await loadPlatformSubscriptionRow(sb, user_id, platform);
    if (!isLivePaddleSubscription(row) || !row?.paddle_subscription_id) {
      return NextResponse.json({ error: 'This user does not have a live Paddle subscription to convert. Assign a manual plan directly instead.', code: 'not_paddle' }, { status: 400 });
    }

    const settings = await loadPaymentSettings(sb, platform);
    const cfg = providerConfigFrom(settings, 'paddle');
    if (settings.active_provider !== 'paddle' || !cfg.apiKey) {
      return NextResponse.json({ error: 'Paddle is not configured (no API key). Cannot cancel the Paddle subscription.', code: 'not_configured' }, { status: 400 });
    }

    // The paid-through date (Paddle current period end), shown in the flow + used
    // as the scheduled conversion date.
    const det = await getSubscription(cfg, row.paddle_subscription_id);
    const paidThrough = det.ok ? det.data.currentPeriodEndsAt : null;
    const adminId = (session.user as { id?: string }).id ?? null;

    if (when === 'period_end') {
      // Stop Paddle billing at period end; schedule the manual plan to begin then.
      const cancel = await cancelSubscriptionAtPeriodEnd(cfg, row.paddle_subscription_id);
      if (!cancel.ok) return NextResponse.json({ error: cancel.error, code: 'cancel_failed' }, { status: 502 });
      await storeScheduledManualConversion(sb, user_id, platform, {
        planKey: plan_key,
        expiresAt: body.expires_at ?? null,
        amountMinor: body.amount_minor ?? null,
        currency: body.currency ?? null,
        note: body.note ?? null,
        effectiveAt: paidThrough ?? cancel.data.scheduledCancelAt ?? null,
      });
      return NextResponse.json({ ok: true, when: 'period_end', paidThrough: paidThrough ?? cancel.data.scheduledCancelAt ?? null });
    }

    // Immediate: cancel Paddle now and start the manual plan now.
    const cancel = await cancelSubscriptionNow(cfg, row.paddle_subscription_id);
    if (!cancel.ok) return NextResponse.json({ error: cancel.error, code: 'cancel_failed' }, { status: 502 });
    const startedAt = new Date().toISOString();
    const res = await setUserPlan(sb, user_id, plan_key, {
      platform, adminId,
      subscription: { source: 'manual', startedAt, expiresAt: body.expires_at ?? null, amountMinor: body.amount_minor ?? null, currency: body.currency ?? null, note: body.note ?? null },
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status ?? 500 });
    if (body.amount_minor && body.amount_minor > 0) {
      await recordPaymentTransaction(sb, { source: 'manual', externalId: null, userId: user_id, platform, planKey: plan_key, amountMinor: body.amount_minor, currency: body.currency ?? null, status: 'manual', billedAt: startedAt });
    }
    return NextResponse.json({ ok: true, when: 'immediate', paidThrough, planKey: res.planKey });
  } catch {
    return NextResponse.json({ error: 'Failed to convert subscription' }, { status: 500 });
  }
}
