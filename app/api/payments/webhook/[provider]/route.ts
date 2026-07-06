import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { setUserPlan } from '@/src/shared/entitlements/setUserPlan';
import {
  loadPaymentSettings, providerConfigFrom, mapProviderPriceIdToPlan, BASELINE_PLAN_KEY,
  wasWebhookEventProcessed, recordWebhookEvent, storeUserSubscriptionIds, storeUserPlatformSubscription,
  recordPaymentTransaction, loadScheduledManualConversion, clearPaddleSubscriptionIds,
  markSubscriptionCanceling,
} from '@/src/shared/payments/config';
import { applyScheduledManualConversion } from '@/src/shared/payments/manualConversion';
import { getAdapter } from '@/src/shared/payments/registry';
import type { PaymentProvider } from '@/src/shared/payments/types';
import {
  sendSubscriptionActivePaddleEmail, sendRenewalReceiptEmail,
  sendPaymentFailedEmail, sendSubscriptionCanceledEmail,
} from '@/src/shared/email/subscriptionEmails';

// Provider webhook endpoint: /api/payments/webhook/paddle | /api/payments/webhook/paypro
//
// Flow (the full structure is in place; adapters are stubbed so live events are
// not processed yet):
//   1. Resolve the provider from the path + the active provider from config.
//   2. Verify the signature against the STORED webhook secret (real HMAC).
//   3. Parse the event into a provider-neutral shape (stub returns 'unknown').
//   4. Map the provider price/product id back to the internal plan_key.
//   5. Set the user's plan via the SHARED setUserPlan (the SAME function admin
//      screens use), so a webhook plan change re-resolves entitlements exactly
//      like an admin change. created/activated/upgraded/downgraded -> set plan;
//      cancelled/expired -> drop to the baseline plan.
//
// While adapters are stubs, step 3 returns 'unknown' and the route stops with an
// explicit stub response AFTER verifying the signature, so no live plan write
// happens yet. The plan-setting path below is real and reached once an adapter
// returns a concrete event.

const PLATFORM = 'real-estate';
const VALID: PaymentProvider[] = ['paddle', 'paypro'];

// Diagnostic-only logger. A single greppable prefix so the founder can filter the
// Vercel runtime logs (Project > Logs, filter on "[payments-webhook]") to see
// whether a provider event ARRIVED and, if so, why it was accepted or rejected.
// It logs NO secret values and NO payload body (only its byte length), so a
// silent 401 (signature reject, which records no row) becomes visible.
function logWebhook(stage: string, fields: Record<string, unknown>): void {
  try {
    console.log(`[payments-webhook] ${stage}`, JSON.stringify({ at: new Date().toISOString(), ...fields }));
  } catch {
    console.log(`[payments-webhook] ${stage}`);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: providerRaw } = await ctx.params;
  const provider = providerRaw as PaymentProvider;
  if (!VALID.includes(provider)) {
    logWebhook('arrived', { method: req.method, provider: providerRaw, outcome: 'unknown_provider', status: 404 });
    return NextResponse.json({ ok: false, reason: 'unknown_provider' }, { status: 404 });
  }

  // Read the RAW body once (signature must be computed over the exact bytes).
  const rawBody = await req.text();
  // Which signature header (if any) the provider supplied. We log only WHICH
  // header matched and whether one was present, never the signature value.
  const sigHeaderName =
    (req.headers.get('paddle-signature') !== null && 'paddle-signature') ||
    (req.headers.get('x-paypro-signature') !== null && 'x-paypro-signature') ||
    (req.headers.get('x-signature') !== null && 'x-signature') ||
    null;
  const signature =
    req.headers.get('paddle-signature') ??
    req.headers.get('x-paypro-signature') ??
    req.headers.get('x-signature') ??
    null;

  // A request reached the endpoint. This line ALONE answers the delivery
  // question: if it never appears in the logs, Paddle is not delivering here
  // (fix the destination URL / subscription in Paddle). If it appears, the
  // event arrived and a later line tells you why it passed or failed.
  logWebhook('arrived', {
    method: req.method,
    provider,
    bodyBytes: rawBody.length,
    hasSignature: signature !== null,
    sigHeader: sigHeaderName,
  });

  const sb = getServerClient();
  const settings = await loadPaymentSettings(sb, PLATFORM);
  const cfg = providerConfigFrom(settings, provider);

  // Only the active, fully-configured provider processes webhooks.
  if (settings.active_provider !== provider || !cfg.webhookSecret) {
    logWebhook('rejected', {
      provider,
      outcome: 'provider_not_active',
      activeProvider: settings.active_provider,
      hasWebhookSecret: !!cfg.webhookSecret,
      sandbox: cfg.sandbox,
    });
    return NextResponse.json({ ok: false, reason: 'provider_not_active' });
  }

  const adapter = getAdapter(provider);

  // 2. Signature verification against the stored webhook secret.
  const verify = adapter.verifyWebhook(rawBody, signature, cfg);
  if (!verify.valid) {
    // THE KEY DIAGNOSTIC: the event arrived but the signature did not match the
    // stored webhook secret. This is a 401 that records no row, so without this
    // line it is invisible. Reason tells you why (missing header / wrong secret
    // / tampered body / stale timestamp). Fix = align the secret in Paddle with
    // Admin > Payments. We log the failure reason only, never the secret.
    logWebhook('rejected', {
      provider,
      outcome: 'signature_invalid',
      status: 401,
      reason: verify.reason ?? 'invalid_signature',
      hasSignature: signature !== null,
      sigHeader: sigHeaderName,
      sandbox: cfg.sandbox,
    });
    return NextResponse.json({ ok: false, reason: verify.reason ?? 'invalid_signature' }, { status: 401 });
  }

  // Signature passed: the secret is aligned. Anything after this is parsing /
  // mapping, not a delivery or auth problem.
  logWebhook('verified', { provider, signatureVerified: true, sandbox: cfg.sandbox });

  // 3. Parse to a neutral event. parseEvent never throws (malformed -> unknown).
  const event = adapter.parseEvent(rawBody);

  // Stub guard: a stubbed adapter (or an unrecognised / malformed event) stops
  // here, AFTER a successful signature check, without writing any plan.
  if (!adapter.implemented || event.type === 'unknown') {
    return NextResponse.json({
      ok: false,
      stub: !adapter.implemented,
      reason: adapter.implemented ? 'unrecognised_event' : 'adapter_not_implemented',
      signatureVerified: true,
    });
  }

  // 4. Idempotency: the SAME event id must not be applied twice. A replayed /
  //    redelivered event short-circuits here without re-running setUserPlan.
  if (await wasWebhookEventProcessed(sb, provider, event.eventId)) {
    return NextResponse.json({ ok: true, idempotent: true, skipped: true, eventId: event.eventId });
  }

  // The platform this event is for. Carried in custom_data at checkout so the
  // subscription is keyed PER platform; defaults to the single live platform for
  // any legacy event without it. Used for plan mapping, plan validation, and the
  // per-platform subscription store. The GLOBAL enforcement write (setUserPlan ->
  // users.subscription_plan) is unchanged in shape; only the platform it
  // validates against follows the event (real-estate by default, so REFM is
  // byte-for-byte unchanged).
  const eventPlatform = event.customDataPlatform ?? PLATFORM;

  // 5. Map the provider price id back to an internal plan; fall back to the
  //    plan_key carried in custom_data when the price id is not recognised.
  const mapped = await mapProviderPriceIdToPlan(sb, provider, event.providerPriceOrProductId, eventPlatform);
  const planKey = mapped?.plan_key ?? event.customDataPlanKey ?? null;

  // 6. Resolve the internal user: prefer the custom-data user reference passed at
  //    checkout, then fall back to matching by email.
  let userId: string | null = null;
  if (event.userRef) {
    const { data: byRef } = await sb.from('users').select('id').eq('id', event.userRef).maybeSingle();
    userId = (byRef as { id?: string } | null)?.id ?? null;
  }
  if (!userId && event.customerEmail) {
    const { data: byEmail } = await sb
      .from('users').select('id').eq('email', event.customerEmail.toLowerCase()).maybeSingle();
    userId = (byEmail as { id?: string } | null)?.id ?? null;
  }
  // Fallback: match by the stored Paddle subscription id. Renewal / past_due
  // events may carry thinner custom_data than checkout, so this recovers the user
  // from the per-platform subscription row keyed on the subscription id.
  if (!userId && event.subscriptionId) {
    const { data: bySub } = await sb
      .from('user_platform_subscriptions').select('user_id')
      .eq('paddle_subscription_id', event.subscriptionId).maybeSingle();
    userId = (bySub as { user_id?: string } | null)?.user_id ?? null;
  }
  if (!userId) {
    // Not recorded: a later redelivery (after the user exists) can still apply.
    return NextResponse.json({ ok: false, reason: 'user_not_found' });
  }

  // 7. Apply via the SHARED plan-setting function (the SAME path admin screens
  //    use), so entitlements re-resolve exactly like an admin change. Record the
  //    event id only on success so a failed apply can be retried by redelivery.
  if (event.type === 'activated' || event.type === 'updated') {
    if (!planKey) return NextResponse.json({ ok: false, reason: 'plan_not_mapped' });
    const res = await setUserPlan(sb, userId, planKey, { platform: eventPlatform });
    if (!res.ok) return NextResponse.json({ ok: false, reason: res.error }, { status: res.status ?? 500 });
    // Capture the provider subscription + customer ids so the dashboard can
    // manage this subscription via the provider API. Additive to the user row;
    // does not touch plan/status (the gate's inputs), so enforcement is unchanged.
    await storeUserSubscriptionIds(sb, userId, { subscriptionId: event.subscriptionId, customerId: event.customerId });
    // Per-platform store (mig 177): keyed by (user, platform) so the billing tab
    // renders one subscription per platform. Carries the applied plan key.
    await storeUserPlatformSubscription(sb, userId, eventPlatform, { subscriptionId: event.subscriptionId, customerId: event.customerId, planKey: res.planKey ?? planKey });
    // Revenue ledger: record the completed transaction (reconcilable; idempotent
    // on the Paddle transaction id). Reporting only, does not affect the plan.
    if (event.transactionId && event.transactionAmountMinor !== null) {
      await recordPaymentTransaction(sb, {
        source: 'paddle', externalId: event.transactionId, userId, platform: eventPlatform,
        planKey: res.planKey ?? planKey, amountMinor: event.transactionAmountMinor,
        currency: event.transactionCurrency, status: 'completed', billedAt: new Date().toISOString(),
      });
    }
    // Durable Canceling marker (mig 183): a subscription.updated carrying a
    // scheduled cancel-at-period-end (or its removal via a resume) is the only
    // signal a cancel scheduled directly in Paddle produces. Persist it so the
    // admin views reflect Canceling without a per-user live call; pass null to
    // CLEAR it when no cancel is pending (an un-cancel). Only meaningful on an
    // 'updated' event (an 'activated' already clears it via storeUserPlatformSubscription).
    if (event.type === 'updated') {
      await markSubscriptionCanceling(sb, userId, eventPlatform, { scheduledCancelAt: event.scheduledCancelAt });
      // A cancel initiated DIRECTLY in the Paddle dashboard surfaces only as an
      // 'updated' carrying a scheduled cancel-at-period-end (the in-app cancel
      // route never ran for it). Send the cancellation confirmation so those users
      // still get one. Deduped on evt:{accessUntil} (the SAME key the in-app cancel
      // route uses), so an in-app cancel that already emailed is a no-op here.
      if (event.scheduledCancelAt) {
        await sendSubscriptionCanceledEmail(sb, {
          userId, platform: eventPlatform, planKey: res.planKey ?? planKey ?? '',
          accessUntil: event.scheduledCancelAt,
        });
      }
    }
    await recordWebhookEvent(sb, provider, event.eventId, { eventType: event.type, planKey: res.planKey, userId, status: res.subscriptionStatus });
    // Welcome / subscription-active email on a genuine ACTIVATION only (not every
    // plan 'updated' event). Self-contained + never throws; attaches the invoice.
    if (event.type === 'activated') {
      await sendSubscriptionActivePaddleEmail(sb, {
        userId, platform: eventPlatform, planKey: res.planKey ?? planKey,
        transactionId: event.transactionId, subscriptionId: event.subscriptionId,
      });
    }
    return NextResponse.json({ ok: true, planKey: res.planKey, subscriptionStatus: res.subscriptionStatus, platform: eventPlatform });
  }

  if (event.type === 'cancelled') {
    // CONVERT-TO-MANUAL: if a manual conversion was scheduled for this period end
    // (mig 180), apply it now (the user moves to the manual plan) INSTEAD of the
    // baseline drop. This is the primary trigger; the cron is a backstop.
    const conv = await loadScheduledManualConversion(sb, userId, eventPlatform);
    if (conv) {
      const ok = await applyScheduledManualConversion(sb, userId, eventPlatform, conv);
      await recordWebhookEvent(sb, provider, event.eventId, { eventType: event.type, planKey: conv.planKey, userId, status: ok ? 'manual' : 'convert_failed' });
      return NextResponse.json({ ok, converted: 'manual', planKey: conv.planKey, platform: eventPlatform });
    }

    // Drop to the baseline plan; re-resolution is automatic (same function).
    const res = await setUserPlan(sb, userId, BASELINE_PLAN_KEY, { platform: eventPlatform });
    if (!res.ok) return NextResponse.json({ ok: false, reason: res.error }, { status: res.status ?? 500 });
    // The Paddle subscription is gone, so CLEAR the stored Paddle ids. Keeping them
    // would leave the row looking like a live Paddle subscription (isLivePaddleSubscription
    // true), which mis-renders the billing tab AND wrongly blocks a later manual
    // assignment. A resubscribe creates a NEW subscription that the activated webhook
    // upserts fresh, so nothing is lost. plan_key/status/source were converged by
    // setUserPlan above; this only nulls the dead ids (gate inputs untouched).
    await clearPaddleSubscriptionIds(sb, userId, eventPlatform);
    await recordWebhookEvent(sb, provider, event.eventId, { eventType: event.type, planKey: res.planKey, userId, status: res.subscriptionStatus });
    return NextResponse.json({ ok: true, planKey: res.planKey, subscriptionStatus: res.subscriptionStatus, platform: eventPlatform });
  }

  if (event.type === 'renewed') {
    // A recurring charge succeeded. The plan is unchanged (no setUserPlan, so
    // enforcement/convergence is untouched); record the transaction to the
    // revenue ledger (idempotent on the txn id) and send a RENEWAL RECEIPT (not
    // the welcome copy). The invoice PDF is attached best-effort by the sender.
    if (event.transactionId && event.transactionAmountMinor !== null) {
      await recordPaymentTransaction(sb, {
        source: 'paddle', externalId: event.transactionId, userId, platform: eventPlatform,
        planKey, amountMinor: event.transactionAmountMinor,
        currency: event.transactionCurrency, status: 'completed', billedAt: new Date().toISOString(),
      });
    }
    await recordWebhookEvent(sb, provider, event.eventId, { eventType: event.type, planKey, userId, status: 'renewed' });
    if (planKey) {
      await sendRenewalReceiptEmail(sb, {
        userId, platform: eventPlatform, planKey,
        amountMinor: event.transactionAmountMinor, currency: event.transactionCurrency,
        renewedOn: new Date().toISOString(), nextRenewalOn: event.billingPeriodEnd,
        transactionId: event.transactionId, subscriptionId: event.subscriptionId,
      });
    }
    return NextResponse.json({ ok: true, renewed: true, planKey, platform: eventPlatform });
  }

  if (event.type === 'payment_failed') {
    // A recurring charge failed (past_due). Make NO plan change: Paddle keeps
    // retrying and access continues, so enforcement is unchanged. Send the dunning
    // email (deduped per billing period so the several retry events collapse to
    // one). Record the event id for idempotency.
    await recordWebhookEvent(sb, provider, event.eventId, { eventType: event.type, planKey, userId, status: 'past_due' });
    if (planKey) {
      await sendPaymentFailedEmail(sb, {
        userId, platform: eventPlatform, planKey,
        amountMinor: event.transactionAmountMinor, currency: event.transactionCurrency,
        subscriptionId: event.subscriptionId, billingPeriodEnd: event.billingPeriodEnd,
      });
    }
    return NextResponse.json({ ok: true, paymentFailed: true, planKey, platform: eventPlatform });
  }

  return NextResponse.json({ ok: false, reason: 'unhandled_event_type' });
}
