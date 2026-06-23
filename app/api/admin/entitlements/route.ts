import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadMergedFeatures } from '@/src/shared/entitlements/serverCatalog';

// Admin plan builder data source. Reads the LIVE entitlement tables from
// Phase A (features_registry, plan_permissions) plus plan metadata
// (entitlement_plans, mig 159). This is separate from the marketing pricing
// tables (platform_pricing / plan_feature_access) edited by /admin/pricing.
//
// Module rows are derived LIVE from the platform_modules registry (the modules
// tab) at request time, not from the frozen status in features_registry: only
// non-hidden modules appear, in the platform's order, each carrying its live
// status. Non-module features stay owned by features_registry. plan_permissions
// is keyed by feature_key, so assignments survive a module being hidden or
// reordered (the row is retained in data, just not rendered).

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return session?.user && (session.user as { role?: string }).role === 'admin';
}

export async function GET(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const platform = req.nextUrl.searchParams.get('platform') || 'real-estate';
  const sb = getServerClient();

  // Module rows come LIVE from the registry; non-module rows from the catalog.
  // Shared with the per-user override screen so both show the same module list.
  const catalog = await loadMergedFeatures(sb, platform);
  if (!catalog.migrationApplied) {
    return NextResponse.json(
      { error: catalog.error, migrationApplied: false, features: [], plans: [], permissions: [] },
      { status: 200 },
    );
  }
  if (catalog.error) {
    return NextResponse.json(
      { error: catalog.error, migrationApplied: true, features: [], plans: [], permissions: [] },
      { status: 500 },
    );
  }
  const mergedFeatures = catalog.features;

  // Try with the mig-162 price columns; fall back to the base columns +
  // null-decorated prices if 162 is not applied yet, so the builder still loads.
  let plans: Record<string, unknown>[] | null;
  const plansFull = await sb
    .from('entitlement_plans')
    .select('id, platform_slug, plan_key, label, display_order, active, price_monthly, price_annual, currency, contact_sales, popular, badge_text, trial_days, paddle_price_id_monthly, paddle_price_id_annual, paypro_product_id')
    .eq('platform_slug', platform)
    .order('display_order');
  if (!plansFull.error) {
    plans = plansFull.data as Record<string, unknown>[];
  } else {
    const plansBase = await sb
      .from('entitlement_plans')
      .select('id, platform_slug, plan_key, label, display_order, active')
      .eq('platform_slug', platform)
      .order('display_order');
    plans = (plansBase.data ?? []).map((p: Record<string, unknown>) => ({
      ...p, price_monthly: null, price_annual: null, currency: 'SAR', contact_sales: false, popular: false, badge_text: null, trial_days: null,
      paddle_price_id_monthly: null, paddle_price_id_annual: null, paypro_product_id: null,
    }));
  }

  const planKeys = (plans ?? []).map((p) => p.plan_key as string);
  const { data: permissions } = planKeys.length
    ? await sb.from('plan_permissions').select('plan_key, feature_key, included, limit_value').in('plan_key', planKeys)
    : { data: [] as unknown[] };

  return NextResponse.json({
    migrationApplied: true,
    features: mergedFeatures,
    plans: plans ?? [],
    permissions: permissions ?? [],
  });
}
