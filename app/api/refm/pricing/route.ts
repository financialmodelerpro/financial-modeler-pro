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
import { loadPricingCatalog, visibleForCustomers } from '@/src/shared/entitlements/pricingCatalog';

export async function GET(req: NextRequest) {
  // Logged-in view only (the public marketing page is a separate route that
  // calls loadPricingCatalog directly for unauthenticated visitors).
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const platform = req.nextUrl.searchParams.get('platform') || 'real-estate';
  const sb = getServerClient();

  // Same single pricing source as the public marketing page.
  const catalog = await loadPricingCatalog(sb, platform);
  if (!catalog.migrationApplied) {
    return NextResponse.json({ migrationApplied: false, plans: [], features: [], coverage: [] }, { status: 200 });
  }

  // Hidden non-module features are excluded from customer-facing surfaces.
  return NextResponse.json({
    migrationApplied: true,
    plans: catalog.plans,
    features: visibleForCustomers(catalog.features),
    coverage: catalog.coverage,
    trialDays: catalog.trialDays,
  });
}
