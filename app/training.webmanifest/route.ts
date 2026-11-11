/**
 * GET /training.webmanifest (2026-11-11), the Training Hub's installed-app
 * manifest. Linked only by InstallAppHead, and only for a signed-in student on
 * a dashboard page (installApps.offersInstall). Everything it says is stated in
 * `buildTrainingAppManifest`; its icons are the Modeling Hub app's icon files
 * drawn on the Training Hub's green tile (/app-icon/training-<file>), versioned
 * by the favicon the same way.
 *
 * No em dashes in this file.
 */
import { getServerClient } from '@/src/core/db/supabase';
import { readSiteFaviconUrl } from '@/src/shared/cms/siteFavicon';
import { buildTrainingAppManifest } from '@/src/shared/pwa/trainingAppManifest';
import { trainingManifestIcons } from './icons';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  let favicon = '';
  try { favicon = await readSiteFaviconUrl(getServerClient()); } catch { /* default icons */ }
  return new Response(JSON.stringify(buildTrainingAppManifest(trainingManifestIcons(favicon)), null, 2), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
