/**
 * GET /app.webmanifest (2026-09-26), the Modeling Hub's installed-app manifest.
 *
 * Served by a route rather than a static file so its icons follow the site
 * favicon set in header settings. Everything it says is stated in
 * `buildAppManifest` (src/hubs/modeling/lib/pwa/appManifest.ts). Linked ONLY
 * from the Modeling Hub layouts.
 *
 * No em dashes in this file.
 */
import { getServerClient } from '@/src/core/db/supabase';
import { readSiteFaviconUrl } from '@/src/shared/cms/siteFavicon';
import { buildAppManifest } from '@/src/hubs/modeling/lib/pwa/appManifest';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  let favicon = '';
  try { favicon = await readSiteFaviconUrl(getServerClient()); } catch { /* default icons */ }
  return new Response(JSON.stringify(buildAppManifest(favicon), null, 2), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
