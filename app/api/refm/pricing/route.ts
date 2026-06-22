/**
 * GET /api/refm/pricing
 *
 * Read-only pricing data for the LOGGED-IN in-app REFM pricing page. Renders
 * from the LIVE entitlement tables (entitlement_plans + prices from mig 162,
 * plan_permissions coverage) and the merged catalog (serverCatalog), NOT the
 * marketing platform_pricing table (that stays the source for the public
 * marketing page only).
 *
 * Returns:
 *   plans      active entitlement_plans (with prices) in display order
 *   features   merged module + catalog feature list (same as Plan Builder)
 *   coverage   plan_permissions rows for the active plans (comparison table)
 * No per-user data and no gate decision: this is plan catalog + price display.
 *
 * No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadMergedFeatures } from '@/src/shared/entitlements/serverCatalog';

export async function GET(req: NextRequest) {
  // Logged-in view only (the public marketing page is a separate route).
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const platform = req.nextUrl.searchParams.get('platform') || 'real-estate';
  const sb = getServerClient();

  const catalog = await loadMergedFeatures(sb, platform);
  if (!catalog.migrationApplied) {
    return NextResponse.json({ migrationApplied: false, plans: [], features: [], coverage: [] }, { status: 200 });
  }

  // Active plans with prices (mig-162 tolerant: fall back to base cols + nulls).
  let plans: Record<string, unknown>[];
  const full = await sb
    .from('entitlement_plans')
    .select('id, plan_key, label, display_order, active, price_monthly, price_annual, currency, contact_sales')
    .eq('platform_slug', platform).eq('active', true).order('display_order');
  if (!full.error) {
    plans = (full.data ?? []) as Record<string, unknown>[];
  } else {
    const base = await sb
      .from('entitlement_plans')
      .select('id, plan_key, label, display_order, active')
      .eq('platform_slug', platform).eq('active', true).order('display_order');
    plans = (base.data ?? []).map((p: Record<string, unknown>) => ({
      ...p, price_monthly: null, price_annual: null, currency: 'SAR', contact_sales: false,
    }));
  }

  const planKeys = plans.map((p) => p.plan_key as string);
  const { data: coverage } = planKeys.length
    ? await sb.from('plan_permissions').select('plan_key, feature_key, included, limit_value').in('plan_key', planKeys)
    : { data: [] as unknown[] };

  return NextResponse.json({
    migrationApplied: true,
    plans,
    features: catalog.features,
    coverage: coverage ?? [],
  });
}
