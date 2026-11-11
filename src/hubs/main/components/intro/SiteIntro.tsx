/**
 * Mounted first in <body> by the root layout, for every host. Picks the site
 * from the request host (main site or Modeling Hub; the Training Hub gets
 * none) and renders nothing when that site's switch is Off or unreadable;
 * otherwise the pre-paint decision script, its CSS and the overlay. The page
 * itself is untouched.
 */
import { headers } from 'next/headers';
import { IntroOverlay } from './IntroOverlay';
import { introCss, introDecisionScript, introSiteForHost } from './introScope';
import { getIntroEnabledCached } from './introSetting';

export async function SiteIntro() {
  let site: ReturnType<typeof introSiteForHost> = null;
  let enabled = false;
  try {
    const h = await headers();
    site = introSiteForHost(h.get('x-forwarded-host') ?? h.get('host'));
    // INTRO_LOCAL_PREVIEW=1 previews the intro on a LOCAL server without
    // touching the shared switch; it is ignored on Vercel, so it can never
    // change what the live site shows.
    const localPreview = process.env.INTRO_LOCAL_PREVIEW === '1' && !process.env.VERCEL;
    if (site) enabled = localPreview || await getIntroEnabledCached(site);
  } catch { enabled = false; }
  if (!site || !enabled) return null;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: introCss() }} />
      <script dangerouslySetInnerHTML={{ __html: introDecisionScript(site) }} />
      <IntroOverlay />
    </>
  );
}
