/**
 * Mounted first in <body> by the root layout. Renders nothing when the admin
 * switch is Off (or the setting cannot be read); otherwise the pre-paint
 * decision script, its CSS and the overlay. The page itself is untouched.
 */
import { IntroOverlay } from './IntroOverlay';
import { introCss, introDecisionScript } from './introScope';
import { getIntroEnabledCached } from './introSetting';

export async function SiteIntro() {
  let enabled = false;
  try { enabled = await getIntroEnabledCached(); } catch { enabled = false; }
  if (!enabled) return null;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: introCss() }} />
      <script dangerouslySetInnerHTML={{ __html: introDecisionScript() }} />
      <IntroOverlay />
    </>
  );
}
