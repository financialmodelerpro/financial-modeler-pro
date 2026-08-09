/**
 * LaunchCountdownBanner.tsx (server component)
 *
 * Reads the launch settings LIVE from the existing admin store
 * (`training_settings`, edited on /admin/modules) and renders the launch banner
 * in one of three states: counting down to the date, announcing the launch once
 * the date has passed, or nothing at all when the banner is switched off or
 * there is no usable date. Only the OFF state is stored; countdown versus
 * launched is derived from the date, so it cannot disagree with the clock.
 *
 * Nothing is hardcoded: both sets of copy, the call to action and which platform
 * the launch is for all come from settings, so they change without a deploy
 * (every host page is revalidate=0 except the two /modeling-hub pages, which are
 * revalidate=60).
 *
 * The platform NAME is deliberately not stored. Settings hold the platform SLUG,
 * and both the name and the default call-to-action destination are derived from
 * it here, so renaming or re-slugging a platform in one place carries through.
 *
 * A settings read that throws is swallowed for the same reason PromoBanner
 * swallows its Paddle call: a banner lookup must never take a page down.
 *
 * No em dashes in this file.
 */
import { getServerClient } from '@/src/core/db/supabase';
import { PLATFORMS, getPlatform } from '@/src/hubs/modeling/config/platforms';
import {
  LAUNCH_SETTING_KEYS, LAUNCH_DATE_KEY, LAUNCH_HEADLINE_KEY, LAUNCH_SUBLINE_KEY, LAUNCH_PLATFORM_KEY,
  LAUNCH_BANNER_ENABLED_KEY, LAUNCHED_HEADLINE_KEY, LAUNCHED_SUBLINE_KEY,
  LAUNCHED_CTA_LABEL_KEY, LAUNCHED_CTA_HREF_KEY,
  resolveLaunchState, resolveLaunchCopy, resolveLaunchedCopy,
} from './launchCountdown';
import LaunchCountdownPopup from './LaunchCountdownPopup';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

/**
 * The platform the launch is for. An explicitly chosen slug wins; otherwise the
 * first LIVE platform in the config, which is the one actually launching. Never
 * a hardcoded product name: the config is the single source, so each platform's
 * display name exists in exactly one place in the repo and a rename there
 * carries into the banner. The verifier asserts this file contains no product
 * name literal, which is why even this comment does not spell one.
 */
function resolvePlatform(slug: string) {
  return (slug ? getPlatform(slug) : undefined)
    ?? PLATFORMS.find((p) => p.status === 'live')
    ?? PLATFORMS[0];
}

/** The default call-to-action destination: the platform's own page, built from
 *  its slug. ABSOLUTE on the app subdomain, because the banner also renders on
 *  the apex marketing pages and a relative path would resolve against whichever
 *  domain the visitor happens to be on. */
function platformHref(slug: string): string {
  return slug ? `${APP_URL}/modeling/${slug}` : APP_URL;
}

export default async function LaunchCountdownBanner(): Promise<React.JSX.Element | null> {
  let settings = new Map<string, string>();
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('key, value')
      .in('key', LAUNCH_SETTING_KEYS as unknown as string[]);
    settings = new Map(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  } catch {
    return null; // never break a page for a launch-settings lookup
  }

  const decision = resolveLaunchState({
    launchDate: settings.get(LAUNCH_DATE_KEY),
    nowMs: Date.now(),
    // Absent means ON, so only an explicit 'false' retires the banner.
    bannerEnabled: settings.get(LAUNCH_BANNER_ENABLED_KEY) !== 'false',
  });
  if (decision.mode === 'hidden') return null;

  const platform = resolvePlatform((settings.get(LAUNCH_PLATFORM_KEY) ?? '').trim());
  const platformName = platform?.name ?? '';

  // BOTH sets of copy are sent, not just the current one, so a visitor sitting
  // on the page when the countdown reaches zero switches straight to the launch
  // announcement instead of the banner disappearing under them.
  const countdownCopy = resolveLaunchCopy({
    headline: settings.get(LAUNCH_HEADLINE_KEY),
    subline: settings.get(LAUNCH_SUBLINE_KEY),
    platformName,
  });
  const launchedCopy = resolveLaunchedCopy({
    headline: settings.get(LAUNCHED_HEADLINE_KEY),
    subline: settings.get(LAUNCHED_SUBLINE_KEY),
    ctaLabel: settings.get(LAUNCHED_CTA_LABEL_KEY),
    ctaHref: settings.get(LAUNCHED_CTA_HREF_KEY),
    platformName,
    platformHref: platformHref(platform?.slug ?? ''),
  });

  return (
    <LaunchCountdownPopup
      targetIso={decision.targetIso}
      mode={decision.mode}
      countdown={countdownCopy}
      launched={launchedCopy}
    />
  );
}
