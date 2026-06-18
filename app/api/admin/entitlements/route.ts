import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

// Admin plan builder data source. Reads the LIVE entitlement tables from
// Phase A (features_registry, plan_permissions) plus plan metadata
// (entitlement_plans, mig 159). This is separate from the marketing pricing
// tables (platform_pricing / plan_feature_access) edited by /admin/pricing.

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
    features: features ?? [],
    plans: plans ?? [],
    permissions: permissions ?? [],
  });
}
