import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { setUserPlan } from '@/src/shared/entitlements/setUserPlan';
import { loadPlatformSubscriptionRow, isLivePaddleSubscription, recordPaymentTransaction, PADDLE_BILLED_BLOCK_MESSAGE } from '@/src/shared/payments/config';
import { sendManualPlanWelcomeEmail, issueManualInvoice, sendPlanEndedEmail, sendTrialStartedEmail } from '@/src/shared/email/subscriptionEmails';

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
    // One concrete started_at for this assignment: it is the per-EVENT dedupe token
    // shared by the welcome + receipt emails (so a genuine repeat with a new
    // started_at emails, while a double-click on the same assignment does not).
    // When the admin UI does not send an explicit start date, fall back to a
    // DATE-ONLY stamp (not a per-millisecond timestamp): a rapid double-submit then
    // resolves to the SAME token and dedupes to one welcome + one receipt, instead
    // of two distinct timestamps that would each send.
    const startedAt = body.started_at ?? new Date().toISOString().slice(0, 10);
    const newPlan = (res.planKey ?? plan_key ?? '').toLowerCase();
    const prevPlan = (row?.plan_key ?? '').toLowerCase();

    if (newPlan === 'none') {
      // Plan removed: send the manual user a cancellation confirmation (the
      // Paddle-only cancel route never fires for them). Only when they HAD a real
      // plan (not none/trial), so a no-op none->none does not email.
      if (prevPlan && prevPlan !== 'none' && prevPlan !== 'trial') {
        await sendPlanEndedEmail(sb, { userId: user_id, platform, planKey: prevPlan });
      }
    } else if (newPlan === 'trial') {
      // Trial assignment: sendManualPlanWelcomeEmail intentionally skips trial, so
      // send the dedicated trial-started email here (the same one the trial approval
      // + self-serve paths send). Deduped per-event on the trial end date, so a
      // genuine new grant sends and a re-assignment of the same trial does not.
      await sendTrialStartedEmail(sb, { userId: user_id, platform, trialEndsAt: res.trialEndsAt ?? null });
    } else {
      // Log the manual payment to the revenue ledger (counts toward admin revenue)
      // and issue an FMP-branded receipt (PDF stored + emailed + listed in billing).
      if (body.amount_minor && body.amount_minor > 0) {
        await recordPaymentTransaction(sb, {
          source: 'manual', externalId: null, userId: user_id, platform, planKey: res.planKey ?? plan_key,
          amountMinor: body.amount_minor, currency: body.currency ?? null, status: 'manual',
          billedAt: startedAt,
        });
        await issueManualInvoice(sb, {
          userId: user_id, platform, planKey: res.planKey ?? plan_key,
          amountMinor: body.amount_minor, currency: body.currency ?? null, issuedAt: startedAt,
          periodEnd: body.expires_at ?? null,
        });
      }
      // Welcome / plan-active email for a manual (offline) paid plan (self-contained;
      // skips 'none' and 'trial' internally). Team-managed, so no invoice.
      await sendManualPlanWelcomeEmail(sb, {
        userId: user_id, platform, planKey: res.planKey ?? plan_key,
        startedAt, expiresAt: body.expires_at ?? null,
      });
    }
    return NextResponse.json({ ok: true, planKey: res.planKey, subscriptionStatus: res.subscriptionStatus, trialEndsAt: res.trialEndsAt, source: 'manual' });
  } catch {
    return NextResponse.json({ error: 'Failed to set plan' }, { status: 500 });
  }
}
