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
import { sendManualPlanWelcomeEmail, issueManualInvoice } from '@/src/shared/email/subscriptionEmails';

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

    // The LIVE Paddle state (source of truth). A subscription that is already
    // canceled / has no active billing period reports canceled=true and no
    // current period (paid-through reads as "n/a"). Canceling it AGAIN returns
    // Paddle's subscription_update_when_canceled, so we must NOT try: we assign
    // the manual plan directly instead.
    const det = await getSubscription(cfg, row.paddle_subscription_id);
    const paidThrough = det.ok ? det.data.currentPeriodEndsAt : null;
    const alreadyInactive = !det.ok
      || det.data.canceled
      || (det.data.currentPeriodEndsAt == null && det.data.nextBilledAt == null);
    const adminId = (session.user as { id?: string }).id ?? null;
    const startedAt = new Date().toISOString();

    // Shared "assign the manual plan now" path: setUserPlan(source 'manual') is the
    // single write path, so it converges store A (users) + store B (source='manual',
    // plan_key set, Paddle ids CLEARED via upsertManualSubscription) with no stale
    // Paddle row. Also logs revenue + issues the branded receipt + welcome email.
    async function assignManualNow(): Promise<NextResponse> {
      const res = await setUserPlan(sb, user_id, plan_key, {
        platform, adminId,
        subscription: { source: 'manual', startedAt, expiresAt: body.expires_at ?? null, amountMinor: body.amount_minor ?? null, currency: body.currency ?? null, note: body.note ?? null },
      });
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status ?? 500 });
      if (body.amount_minor && body.amount_minor > 0) {
        await recordPaymentTransaction(sb, { source: 'manual', externalId: null, userId: user_id, platform, planKey: plan_key, amountMinor: body.amount_minor, currency: body.currency ?? null, status: 'manual', billedAt: startedAt });
        await issueManualInvoice(sb, { userId: user_id, platform, planKey: plan_key, amountMinor: body.amount_minor, currency: body.currency ?? null, issuedAt: startedAt, periodEnd: body.expires_at ?? null });
      }
      await sendManualPlanWelcomeEmail(sb, {
        userId: user_id, platform, planKey: res.planKey ?? plan_key,
        startedAt, expiresAt: body.expires_at ?? null,
      });
      return NextResponse.json({ ok: true, when: 'immediate', converted: 'already_canceled', paidThrough: null, planKey: res.planKey });
    }

    // A cancel error that means "already canceled" (Paddle's
    // subscription_update_when_canceled): recover by assigning directly rather than
    // surfacing a 502 (handles a race between the read and the cancel). Deliberately
    // narrow so a genuine cancel failure (auth / network) still 502s.
    const isAlreadyCanceledError = (e: string | undefined): boolean =>
      !!e && /when[_ ]?canceled|already[_ ]?canceled/i.test(e);

    // Already canceled / no active period: skip Paddle entirely, assign directly.
    if (alreadyInactive) {
      return await assignManualNow();
    }

    if (when === 'period_end') {
      // Live sub: stop Paddle billing at period end; schedule the manual plan then.
      const cancel = await cancelSubscriptionAtPeriodEnd(cfg, row.paddle_subscription_id);
      if (!cancel.ok) {
        if (isAlreadyCanceledError(cancel.error)) return await assignManualNow();
        return NextResponse.json({ error: cancel.error, code: 'cancel_failed' }, { status: 502 });
      }
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

    // Immediate on a live sub: cancel Paddle now, then start the manual plan now.
    const cancel = await cancelSubscriptionNow(cfg, row.paddle_subscription_id);
    if (!cancel.ok) {
      if (isAlreadyCanceledError(cancel.error)) return await assignManualNow();
      return NextResponse.json({ error: cancel.error, code: 'cancel_failed' }, { status: 502 });
    }
    return await assignManualNow();
  } catch {
    return NextResponse.json({ error: 'Failed to convert subscription' }, { status: 500 });
  }
}
