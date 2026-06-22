/**
 * pricingCatalog.ts (server)
 *
 * THE single pricing data source for BOTH the public marketing pricing page
 * and the in-app pricing page. Reads the live entitlement tables
 * (entitlement_plans + prices/popular/badge, plan_permissions coverage) and the
 * merged catalog (serverCatalog), so the two surfaces never drift.
 *
 * Runs server-side with the service-role client, so it works for an
 * UNAUTHENTICATED visitor (the public page) as well as logged-in users.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadMergedFeatures, type MergedFeatureRow } from './serverCatalog';
import { visibleForCustomers } from './pricingDisplay';

// Re-export so existing server callers (marketing page, refm/pricing) keep
// importing it from pricingCatalog. Pure impl lives in pricingDisplay.
export { visibleForCustomers };

export interface PricingPlan {
  id: string;
  plan_key: string;
  label: string;
  display_order: number;
  active: boolean;
  price_monthly: number | null;
  price_annual: number | null;
  currency: string | null;
  contact_sales: boolean;
  popular: boolean;
  badge_text: string | null;
}

export interface PricingCoverage {
  plan_key: string;
  feature_key: string;
  included: boolean;
  limit_value: number | null;
}

export interface PricingCatalog {
  migrationApplied: boolean;
  plans: PricingPlan[];
  /** ALL features (module + non-module), each carrying `visible`. Customer
   *  surfaces should filter with visibleForCustomers(). */
  features: MergedFeatureRow[];
  coverage: PricingCoverage[];
}

export async function loadPricingCatalog(sb: SupabaseClient, platform: string): Promise<PricingCatalog> {
  const catalog = await loadMergedFeatures(sb, platform);
  if (!catalog.migrationApplied) {
    return { migrationApplied: false, plans: [], features: [], coverage: [] };
  }

  // Active plans with prices + popular/badge (mig 162/163 tolerant fallback).
  let plans: PricingPlan[];
  const full = await sb
    .from('entitlement_plans')
    .select('id, plan_key, label, display_order, active, price_monthly, price_annual, currency, contact_sales, popular, badge_text')
    .eq('platform_slug', platform).eq('active', true).order('display_order');
  if (!full.error) {
    plans = (full.data ?? []) as PricingPlan[];
  } else {
    const base = await sb
      .from('entitlement_plans')
      .select('id, plan_key, label, display_order, active, price_monthly, price_annual, currency, contact_sales')
      .eq('platform_slug', platform).eq('active', true).order('display_order');
    plans = (base.data ?? []).map((p: Record<string, unknown>) => ({
      ...(p as object), popular: false, badge_text: null,
    })) as PricingPlan[];
  }

  const planKeys = plans.map((p) => p.plan_key);
  const { data: coverage } = planKeys.length
    ? await sb.from('plan_permissions').select('plan_key, feature_key, included, limit_value').in('plan_key', planKeys)
    : { data: [] as PricingCoverage[] };

  return {
    migrationApplied: true,
    plans,
    features: catalog.features,
    coverage: (coverage ?? []) as PricingCoverage[],
  };
}
