/**
 * pricingDisplay.ts
 *
 * Pure display helpers for the in-app REFM pricing page. Kept out of the page
 * component so they are unit-testable (verify-pricing-display.ts) and shared by
 * the screenshot proof. No data fetching, no React.
 *
 * No em dashes in this file.
 */
import { formatLimit } from './moduleCatalog';

export interface PricedPlan {
  plan_key: string;
  label: string;
  price_monthly: number | null;
  price_annual: number | null;
  currency: string | null;
  contact_sales: boolean;
}

export type BillingInterval = 'monthly' | 'annual';

/** Headline + sub-label for a plan card at a billing interval. contact_sales
 *  wins over any number; 0 = Free; null = unpriced. */
export function formatPlanPrice(plan: PricedPlan, interval: BillingInterval): { big: string; sub: string } {
  if (plan.contact_sales) return { big: 'Contact sales', sub: 'Custom pricing' };
  const v = interval === 'monthly' ? plan.price_monthly : plan.price_annual;
  if (v === null || v === undefined) return { big: 'Not priced', sub: '' };
  if (v === 0) return { big: 'Free', sub: '' };
  const cur = plan.currency || 'SAR';
  return { big: `${cur} ${v.toLocaleString()}`, sub: interval === 'monthly' ? 'per month' : 'per year' };
}

/** Comparison-table cell text for a feature under a plan. Gate -> check/dash;
 *  limit -> the cap (Unlimited for -1) when included, else dash. */
export function comparisonCellText(
  featureType: 'gate' | 'limit' | 'metered',
  included: boolean,
  limitValue: number | null,
): string {
  if (featureType === 'limit') {
    return included && limitValue !== null ? formatLimit(limitValue) : '–';
  }
  return included ? '✓' : '–';
}
