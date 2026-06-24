import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { setUserPlan } from '@/src/shared/entitlements/setUserPlan';
import {
  loadPaymentSettings, providerConfigFrom, mapProviderPriceIdToPlan, BASELINE_PLAN_KEY,
  wasWebhookEventProcessed, recordWebhookEvent,
} from '@/src/shared/payments/config';
import { getAdapter } from '@/src/shared/payments/registry';
import type { PaymentProvider } from '@/src/shared/payments/types';

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

export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: providerRaw } = await ctx.params;
  const provider = providerRaw as PaymentProvider;
  if (!VALID.includes(provider)) {
    return NextResponse.json({ ok: false, reason: 'unknown_provider' }, { status: 404 });
  }

  // Read the RAW body once (signature must be computed over the exact bytes).
  const rawBody = await req.text();
  const signature =
    req.headers.get('paddle-signature') ??
    req.headers.get('x-paypro-signature') ??
    req.headers.get('x-signature') ??
    null;

  const sb = getServerClient();
  const settings = await loadPaymentSettings(sb, PLATFORM);
  const cfg = providerConfigFrom(settings, provider);

  // Only the active, fully-configured provider processes webhooks.
  if (settings.active_provider !== provider || !cfg.webhookSecret) {
    return NextResponse.json({ ok: false, reason: 'provider_not_active' });
  }

  const adapter = getAdapter(provider);

  // 2. Signature verification against the stored webhook secret.
  const verify = adapter.verifyWebhook(rawBody, signature, cfg);
  if (!verify.valid) {
    return NextResponse.json({ ok: false, reason: verify.reason ?? 'invalid_signature' }, { status: 401 });
  }

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

  // 5. Map the provider price id back to an internal plan; fall back to the
  //    plan_key carried in custom_data when the price id is not recognised.
  const mapped = await mapProviderPriceIdToPlan(sb, provider, event.providerPriceOrProductId, PLATFORM);
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
  if (!userId) {
    // Not recorded: a later redelivery (after the user exists) can still apply.
    return NextResponse.json({ ok: false, reason: 'user_not_found' });
  }

  // 7. Apply via the SHARED plan-setting function (the SAME path admin screens
  //    use), so entitlements re-resolve exactly like an admin change. Record the
  //    event id only on success so a failed apply can be retried by redelivery.
  if (event.type === 'activated' || event.type === 'updated') {
    if (!planKey) return NextResponse.json({ ok: false, reason: 'plan_not_mapped' });
    const res = await setUserPlan(sb, userId, planKey, { platform: PLATFORM });
    if (!res.ok) return NextResponse.json({ ok: false, reason: res.error }, { status: res.status ?? 500 });
    await recordWebhookEvent(sb, provider, event.eventId, { eventType: event.type, planKey: res.planKey, userId, status: res.subscriptionStatus });
    return NextResponse.json({ ok: true, planKey: res.planKey, subscriptionStatus: res.subscriptionStatus });
  }

  if (event.type === 'cancelled') {
    // Drop to the baseline plan; re-resolution is automatic (same function).
    const res = await setUserPlan(sb, userId, BASELINE_PLAN_KEY, { platform: PLATFORM });
    if (!res.ok) return NextResponse.json({ ok: false, reason: res.error }, { status: res.status ?? 500 });
    await recordWebhookEvent(sb, provider, event.eventId, { eventType: event.type, planKey: res.planKey, userId, status: res.subscriptionStatus });
    return NextResponse.json({ ok: true, planKey: res.planKey, subscriptionStatus: res.subscriptionStatus });
  }

  return NextResponse.json({ ok: false, reason: 'unhandled_event_type' });
}
