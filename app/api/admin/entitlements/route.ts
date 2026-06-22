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

  const { data: plans } = await sb
    .from('entitlement_plans')
    .select('id, platform_slug, plan_key, label, display_order, active')
    .eq('platform_slug', platform)
    .order('display_order');

  const planKeys = (plans ?? []).map((p: { plan_key: string }) => p.plan_key);
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
