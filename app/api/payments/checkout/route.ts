import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadPaymentSettings, providerConfigFrom, planProviderPriceId, type PlanProviderIds } from '@/src/shared/payments/config';
import { getAdapter } from '@/src/shared/payments/registry';
import type { BillingInterval, CheckoutResult } from '@/src/shared/payments/types';

// Checkout handler. Routes a selected plan to the ACTIVE provider's adapter.
//
//  - Active provider 'none'  -> 'placeholder' result (no behavior change from
//    today: the UI shows the "checkout coming soon" placeholder).
//  - Active provider set     -> reads the plan's provider price id from the plan
//    record and calls that adapter's createCheckout. Both adapters are stubs, so
//    the result is 'not_configured' (no fake checkout, no charge).
//
// This route only READS config + plan data and never sets a plan; plan changes
// happen exclusively via the webhook (which reuses setUserPlan).

const PLATFORM = 'real-estate';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? '';
  const userEmail = session.user.email ?? null;

  let plan_key = '';
  let interval: BillingInterval = 'monthly';
  try {
    const body = await req.json() as { plan_key?: string; interval?: BillingInterval };
    plan_key = String(body.plan_key ?? '').trim().toLowerCase();
    if (body.interval === 'annual') interval = 'annual';
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!plan_key) return NextResponse.json({ error: 'plan_key required' }, { status: 400 });

  const sb = getServerClient();
  const settings = await loadPaymentSettings(sb, PLATFORM);

  // No active provider: checkout is a placeholder (unchanged from today).
  if (settings.active_provider === 'none') {
    const result: CheckoutResult = {
      ok: false,
      status: 'placeholder',
      message: 'Online payment is not enabled yet (no provider activated). No charge has been made and no checkout has started. An admin can set your plan directly until checkout is live.',
    };
    return NextResponse.json(result);
  }

  const provider = settings.active_provider;

  // Read the plan's provider price/product id from the plan record (mig 166).
  const { data: planRow } = await sb
    .from('entitlement_plans')
    .select('plan_key, paddle_price_id_monthly, paddle_price_id_annual, paypro_product_id')
    .eq('platform_slug', PLATFORM)
    .eq('plan_key', plan_key)
    .maybeSingle();
  if (!planRow) return NextResponse.json({ error: `Unknown plan "${plan_key}"` }, { status: 400 });

  const providerPriceId = planProviderPriceId(planRow as PlanProviderIds, provider, interval);
  const adapter = getAdapter(provider);
  const result = await adapter.createCheckout(
    { planKey: plan_key, interval, providerPriceId, userId, userEmail },
    providerConfigFrom(settings, provider),
  );

  return NextResponse.json(result);
}
