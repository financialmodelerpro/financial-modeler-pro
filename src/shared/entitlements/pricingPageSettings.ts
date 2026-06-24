/**
 * pricingPageSettings.ts (pure, client-safe)
 *
 * Constants for pricing-page-level text settings that are editable in the Plan
 * Builder and rendered on BOTH the public and in-app pricing pages. Kept free of
 * any server-only imports so the admin client component can import the default
 * without bundling the service-role pricing loader.
 *
 * Storage: a single cms_content row (section + key). When NO row exists the
 * pages fall back to the default below; when the row is present but blank the
 * band renders nothing (admin deliberately cleared it).
 *
 * No em dashes in this file.
 */
export const CREDIBILITY_SECTION = 'pricing';
export const CREDIBILITY_KEY = 'credibility_line';
export const DEFAULT_CREDIBILITY_LINE =
  'Built by Ahmad Din, 12+ years in corporate finance and transaction advisory. A PaceMakers Business Consultants Platform.';
