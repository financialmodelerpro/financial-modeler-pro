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
import { visibleForCustomers, trialDaysFromPlans, comparisonCellText } from './pricingDisplay';
import { DEFAULT_TRIAL_DAYS } from './trialConfig';
import { CREDIBILITY_SECTION, CREDIBILITY_KEY, DEFAULT_CREDIBILITY_LINE } from './pricingPageSettings';
import { loadActivePublicPromo, type PublicPromo } from '@/src/shared/payments/coupons';

export type { PublicPromo };

// Re-export so existing server callers (marketing page, refm/pricing) keep
// importing it from pricingCatalog. Pure impl lives in pricingDisplay.
export { visibleForCustomers };

// ── Pricing-page credibility band (editable in the Plan Builder) ─────────────
// Stored as a single cms_content row so it can be changed anytime without code.
// Keys + default live in pricingPageSettings (pure, also imported by the admin
// client). When NO row exists the page shows the default; when the row is
// present but blank, the band renders nothing (admin cleared it).
export { CREDIBILITY_SECTION, CREDIBILITY_KEY, DEFAULT_CREDIBILITY_LINE };

/** Read the pricing-page credibility line (cms_content). Row absent -> default;
 *  row present (even blank) -> verbatim, so an admin can blank the band. */
export async function loadCredibilityLine(sb: SupabaseClient): Promise<string> {
  try {
    const { data } = await sb
      .from('cms_content')
      .select('value')
      .eq('section', CREDIBILITY_SECTION)
      .eq('key', CREDIBILITY_KEY)
      .maybeSingle();
    if (!data) return DEFAULT_CREDIBILITY_LINE;
    return (data as { value: string | null }).value ?? '';
  } catch {
    return DEFAULT_CREDIBILITY_LINE;
  }
}

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
  trial_days: number | null;
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
  /** The single-source trial length (Trial plan trial_days, fallback default). */
  trialDays: number;
  /** Pricing-page credibility band text (cms_content; blank = render nothing). */
  credibilityLine: string;
  /** Active PUBLIC auto-apply promo for this platform (Model 1: references a real
   *  Paddle discount), or null. Only a promo with a Paddle discount id appears, so
   *  the displayed "X% off" always matches what actually applies at checkout. */
  promo: PublicPromo | null;
}

export async function loadPricingCatalog(sb: SupabaseClient, platform: string): Promise<PricingCatalog> {
  const [catalog, credibilityLine, promo] = await Promise.all([
    loadMergedFeatures(sb, platform),
    loadCredibilityLine(sb),
    loadActivePublicPromo(sb, platform),
  ]);
  if (!catalog.migrationApplied) {
    return { migrationApplied: false, plans: [], features: [], coverage: [], trialDays: DEFAULT_TRIAL_DAYS, credibilityLine, promo };
  }

  // Active plans with prices + popular/badge + trial_days (mig 162/163/165
  // tolerant fallback).
  let plans: PricingPlan[];
  const full = await sb
    .from('entitlement_plans')
    .select('id, plan_key, label, display_order, active, price_monthly, price_annual, currency, contact_sales, popular, badge_text, trial_days')
    .eq('platform_slug', platform).eq('active', true).order('display_order');
  if (!full.error) {
    plans = (full.data ?? []) as PricingPlan[];
  } else {
    const base = await sb
      .from('entitlement_plans')
      .select('id, plan_key, label, display_order, active, price_monthly, price_annual, currency, contact_sales')
      .eq('platform_slug', platform).eq('active', true).order('display_order');
    plans = (base.data ?? []).map((p: Record<string, unknown>) => ({
      ...(p as object), popular: false, badge_text: null, trial_days: null,
    })) as PricingPlan[];
  }

  const planKeys = plans.map((p) => p.plan_key);
  const { data: coverage } = planKeys.length
    ? await sb.from('plan_permissions').select('plan_key, feature_key, included, limit_value').in('plan_key', planKeys)
    : { data: [] as PricingCoverage[] };

  // Single-source trial length: the Trial plan's trial_days (fallback default).
  const trialDays = trialDaysFromPlans(plans, DEFAULT_TRIAL_DAYS);

  return {
    migrationApplied: true,
    plans,
    features: catalog.features,
    coverage: (coverage ?? []) as PricingCoverage[],
    trialDays,
    credibilityLine,
    promo,
  };
}

/** One line of a plan's feature list: the feature label, plus a `detail` for
 *  limit features (the numeric cap, formatted like the comparison table). */
export interface PlanFeatureLine {
  feature_key: string;
  label: string;
  detail: string | null;
}

/**
 * The full, customer-facing feature list a plan INCLUDES, built from the SAME
 * catalog the pricing comparison uses (visible features + plan_permissions
 * coverage). Used by the billing tab's switch-confirmation so the user sees what
 * they will have on the target plan. Returns the plan label + its included
 * features in display order. Empty when the catalog is not available.
 */
export async function loadPlanFeatureList(
  sb: SupabaseClient, platform: string, planKey: string,
): Promise<{ label: string; features: PlanFeatureLine[] }> {
  const catalog = await loadPricingCatalog(sb, platform);
  const label = catalog.plans.find((p) => p.plan_key === planKey)?.label ?? planKey;
  if (!catalog.migrationApplied) return { label, features: [] };

  // Coverage for THIS plan, keyed by feature.
  const cov = new Map<string, PricingCoverage>();
  for (const c of catalog.coverage) if (c.plan_key === planKey) cov.set(c.feature_key, c);

  const features = visibleForCustomers(catalog.features)
    .filter((f) => cov.get(f.feature_key)?.included)
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .map((f) => {
      const c = cov.get(f.feature_key);
      // For a limit feature show the cap (e.g. "25 projects"); gate -> no detail.
      const detail = f.feature_type === 'limit'
        ? comparisonCellText('limit', true, c?.limit_value ?? null)
        : null;
      return { feature_key: f.feature_key, label: f.label, detail };
    });

  return { label, features };
}
