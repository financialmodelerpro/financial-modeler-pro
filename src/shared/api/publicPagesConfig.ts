/**
 * publicPagesConfig.ts
 *
 * The shared shape of the public partner page feed: which slugs it serves, what
 * the key grants, and where the endpoint lives.
 *
 * WHY THIS IS NOT IN THE ROUTE FILE ANY MORE. The admin API Keys view has to
 * tell an admin exactly what the key unlocks, which means listing the same
 * slugs the route serves. Two copies of that list would drift the first time a
 * page is opted in, and the admin screen would then confidently describe an
 * endpoint that behaves differently. One constant, two importers.
 *
 * Adding a page to the public feed is still a deliberate, reviewable edit to
 * SLUG_WHITELIST, and now it updates the admin screen for free.
 *
 * No em dashes in this file.
 */

/**
 * The only slugs the public endpoint will serve, mapped to their CMS page slug.
 * Anything not in this object is a 404, including a real CMS page that simply
 * has not been opted in.
 *
 * THE PUBLIC SLUG IS NOT THE INTERNAL SLUG. These three are a stable public
 * vocabulary chosen for the consumer, mapped onto whatever the CMS happens to
 * call the page today, so a CMS rename cannot break a partner's site.
 */
export const SLUG_WHITELIST: Readonly<Record<string, string>> = {
  'modeling-hub': 'modeling',
  'refm': 'modeling-real-estate',
  'training-hub': 'training',
};

/** The public slugs, in a stable order, for display. */
export const PUBLIC_PAGE_SLUGS: readonly string[] = Object.keys(SLUG_WHITELIST);

/** Path of the public feed, with `{slug}` left as a placeholder. */
export const PUBLIC_PAGES_PATH = '/api/public/pages/{slug}';

/**
 * What the key actually grants, in the terms an admin needs to decide whether
 * handing it to someone is acceptable. Kept beside the whitelist so a change in
 * scope and the sentence describing it move together.
 */
export const PUBLIC_API_KEY_GRANTS: readonly string[] = [
  'Read-only. There are no write methods on this endpoint at all.',
  'Only the whitelisted slugs below. Any other page, including a real CMS page that has not been opted in, returns 404.',
  'Published pages only, so a draft cannot be probed.',
  'Page metadata plus its visible sections in display order. Internal columns (row id, is_system, the visible flag, created_at) are never in the response.',
  'Rate limited to 60 requests per minute per IP, per serverless instance.',
];

/**
 * The one caveat a consumer has to be told about, because the platform cannot
 * enforce it for them.
 */
export const PUBLIC_API_KEY_CAVEAT =
  'Section content is passed through verbatim as jsonb, including any nested items marked visible:false that the FMP renderer would hide. A consumer has to respect those itself.';
