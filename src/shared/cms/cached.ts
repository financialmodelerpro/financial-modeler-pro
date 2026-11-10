/**
 * Cached CMS reads (2026-11-10), OPT-IN. The database sits in Tokyo and the
 * server functions in Virginia, so every read costs a Pacific round trip
 * (about 0.2 to 0.3 s); the navbar and footer alone made three on every page.
 * These wrappers share the result across requests for 60 seconds.
 *
 * The plain functions in ./index are unchanged and still used everywhere else;
 * a caller opts in (NavbarServer / SharedFooter `cached`, the live course
 * pages). A CMS edit shows on an opted-in page within 60 seconds, or at once
 * after `invalidateCmsCache()`.
 */
import { unstable_cache, revalidateTag } from 'next/cache';
import { getSitePages, getCmsContent, getFooterLegalLinks, getAllPageSections } from './index';

export const CMS_CACHE_TAG = 'cms';
const OPTS = { revalidate: 60, tags: [CMS_CACHE_TAG] };

export const getSitePagesCached = unstable_cache(async () => getSitePages(), ['cms-site-pages'], OPTS);
export const getCmsContentCached = unstable_cache(async () => getCmsContent(), ['cms-content'], OPTS);
export const getFooterLegalLinksCached = unstable_cache(async () => getFooterLegalLinks(), ['cms-footer-legal'], OPTS);
export const getAllPageSectionsCached = unstable_cache(async (slug: string) => getAllPageSections(slug), ['cms-page-sections'], OPTS);

/** Never throws. */
export function invalidateCmsCache(): void {
  try { revalidateTag(CMS_CACHE_TAG, { expire: 0 }); } catch (e) { console.warn('[cms] cache invalidation failed', String(e)); }
}
