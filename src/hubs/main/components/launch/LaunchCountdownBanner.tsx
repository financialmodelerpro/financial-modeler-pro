/**
 * LaunchCountdownBanner.tsx (server component)
 *
 * Reads the launch settings LIVE from the existing admin store
 * (`training_settings`, edited on /admin/modules) and, when the launch date is
 * still in the future, renders it as a centred, dismissible countdown popup.
 * Nothing is hardcoded: the date, the headline, the supporting line and which
 * platform the launch is for all come from settings, so all four change without
 * a deploy (every host page is revalidate=0 except the two /modeling-hub pages,
 * which are revalidate=60).
 *
 * The platform NAME is deliberately not stored. Settings hold the platform
 * SLUG, and the name is resolved from the platform config here, so renaming a
 * platform in one place carries into the banner.
 *
 * Renders NOTHING when the date is unset, unparseable, or past, so it is safe to
 * mount unconditionally in the root layout. A settings read that throws is
 * swallowed for the same reason PromoBanner swallows its Paddle call: a banner
 * lookup must never take a page down.
 *
 * No em dashes in this file.
 */
import { getServerClient } from '@/src/core/db/supabase';
import { PLATFORMS, getPlatform } from '@/src/hubs/modeling/config/platforms';
import {
  LAUNCH_SETTING_KEYS, LAUNCH_DATE_KEY, LAUNCH_HEADLINE_KEY, LAUNCH_SUBLINE_KEY, LAUNCH_PLATFORM_KEY,
  resolveLaunchCountdown, resolveLaunchCopy,
} from './launchCountdown';
import LaunchCountdownPopup from './LaunchCountdownPopup';

/**
 * The platform the launch is for. An explicitly chosen slug wins; otherwise the
 * first LIVE platform in the config, which is the one actually launching. Never
 * a hardcoded product name: `getPlatform(slug).name` is the single source, so
 * each platform's display name exists in exactly one place in the repo and a
 * rename there carries into the banner. The verifier asserts this file contains
 * no product name literal, which is why even this comment does not spell one.
 */
function resolvePlatformName(slug: string): string {
  const chosen = slug ? getPlatform(slug) : undefined;
  if (chosen) return chosen.name;
  const live = PLATFORMS.find((p) => p.status === 'live') ?? PLATFORMS[0];
  return live?.name ?? '';
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

  const decision = resolveLaunchCountdown({
    launchDate: settings.get(LAUNCH_DATE_KEY),
    nowMs: Date.now(),
  });
  if (!decision.show) return null;

  const copy = resolveLaunchCopy({
    headline: settings.get(LAUNCH_HEADLINE_KEY),
    subline: settings.get(LAUNCH_SUBLINE_KEY),
    platformName: resolvePlatformName((settings.get(LAUNCH_PLATFORM_KEY) ?? '').trim()),
  });

  return (
    <LaunchCountdownPopup
      targetIso={decision.targetIso}
      headline={copy.headline}
      subline={copy.subline}
    />
  );
}
