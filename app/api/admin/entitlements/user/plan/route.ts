import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { setUserPlan } from '@/src/shared/entitlements/setUserPlan';
import { loadPlatformSubscriptionRow, isLivePaddleSubscription, recordPaymentTransaction, PADDLE_BILLED_BLOCK_MESSAGE } from '@/src/shared/payments/config';

// Assign a user to any entitlement plan (Trial / Solo / Pro / Firm), or a MANUAL
// (bank / offline) plan with a start + expiry. THE single shared plan-setting
// path: both /admin/users (inline) and /admin/access (plan selector) call this,
// which delegates to setUserPlan (one code path), and setUserPlan now ALSO
// upserts the per-platform row (source 'manual') so the gate and the user
// billing panel read consistent plan data.
//
// SAFETY: if the user has a LIVE Paddle subscription, a manual/local plan change
// is BLOCKED (409). Changing such a user's plan must go through the billing flow
// / Paddle, otherwise Paddle would keep billing the old plan while the local
// plan diverged. Manual assignment is for users without a live Paddle sub.

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
      user_id: string; plan_key: string; platform?: string;
      started_at?: string | null; expires_at?: string | null;
      amount_minor?: number | null; currency?: string | null; note?: string | null;
    };
    const { user_id, plan_key } = body;
    const platform = body.platform ?? 'real-estate';
    if (!user_id || !plan_key) return NextResponse.json({ error: 'user_id and plan_key required' }, { status: 400 });

    const sb = getServerClient();

    // Block a local plan change for a Paddle-billed user (no silent divergence).
    const row = await loadPlatformSubscriptionRow(sb, user_id, platform);
    if (isLivePaddleSubscription(row)) {
      return NextResponse.json({ error: PADDLE_BILLED_BLOCK_MESSAGE, code: 'paddle_billed' }, { status: 409 });
    }

    const adminId = (session.user as { id?: string }).id ?? null;
    const res = await setUserPlan(sb, user_id, plan_key, {
      platform, adminId,
      subscription: {
        source: 'manual',
        startedAt: body.started_at ?? null,
        expiresAt: body.expires_at ?? null,
        amountMinor: body.amount_minor ?? null,
        currency: body.currency ?? null,
        note: body.note ?? null,
      },
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status ?? 500 });
    // Log the manual payment to the revenue ledger (counts toward admin revenue).
    if (body.amount_minor && body.amount_minor > 0) {
      await recordPaymentTransaction(sb, {
        source: 'manual', externalId: null, userId: user_id, platform, planKey: res.planKey ?? plan_key,
        amountMinor: body.amount_minor, currency: body.currency ?? null, status: 'manual',
        billedAt: body.started_at ?? new Date().toISOString(),
      });
    }
    return NextResponse.json({ ok: true, planKey: res.planKey, subscriptionStatus: res.subscriptionStatus, trialEndsAt: res.trialEndsAt, source: 'manual' });
  } catch {
    return NextResponse.json({ error: 'Failed to set plan' }, { status: 500 });
  }
}
