import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { getPlatformModules } from '@/src/shared/cms/platform-modules';
import { deriveModuleFeatureRows, type LiveModuleInput } from '@/src/shared/entitlements/moduleCatalog';

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

const isModuleKey = (k: string): boolean => /^module_\d+$/.test(k);

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return session?.user && (session.user as { role?: string }).role === 'admin';
}

export async function GET(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const platform = req.nextUrl.searchParams.get('platform') || 'real-estate';
  const sb = getServerClient();

  const { data: features, error: fErr } = await sb
    .from('features_registry')
    .select('feature_key, label, category, feature_type, build_status, display_order, active')
    .eq('active', true)
    .order('display_order');

  // Surface "migration not applied" clearly instead of a 500.
  if (fErr) {
    const notApplied = /relation .* does not exist|features_registry/i.test(fErr.message);
    return NextResponse.json(
      { error: fErr.message, migrationApplied: !notApplied, features: [], plans: [], permissions: [] },
      { status: notApplied ? 200 : 500 },
    );
  }

  // Module rows come LIVE from the registry. Non-module catalog features keep
  // their features_registry rows (status owned by the catalog). If the registry
  // table is unavailable (returns nothing), fall back to the catalog's module
  // rows so the matrix is never empty.
  const nonModuleFeatures = (features ?? []).filter((f: { feature_key: string }) => !isModuleKey(f.feature_key));
  const liveModules = await getPlatformModules(platform);
  let moduleRows: unknown[];
  if (liveModules.length > 0) {
    moduleRows = deriveModuleFeatureRows(liveModules as unknown as LiveModuleInput[]);
  } else {
    // Fallback: catalog module rows (keeps display order < non-module rows).
    moduleRows = (features ?? [])
      .filter((f: { feature_key: string }) => isModuleKey(f.feature_key))
      .map((f: Record<string, unknown>) => ({ ...f, category: 'module' }));
  }
  const mergedFeatures = [...moduleRows, ...nonModuleFeatures];

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
