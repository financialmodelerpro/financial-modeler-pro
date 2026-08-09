/**
 * LaunchCountdownBanner.tsx (server component)
 *
 * Reads the hub launch date LIVE from the existing admin settings
 * (`training_settings.modeling_hub_launch_date`, edited on /admin/modules) and,
 * when that date is still in the future, renders it as a centred, dismissible
 * countdown popup. Nothing about the date is hardcoded here: change it in admin
 * and the banner follows on the next request (every host page is revalidate=0).
 *
 * Renders NOTHING when the date is unset, unparseable, or past, so it is safe to
 * mount unconditionally in the root layout. A settings read that throws is
 * swallowed for the same reason PromoBanner swallows its Paddle call: a banner
 * lookup must never take a page down.
 *
 * Only the resolved ISO instant reaches the client. The client component then
 * decides whether the CURRENT path is one of the five target pages, which is why
 * this can live in the layout without leaking onto the workspace or admin.
 *
 * No em dashes in this file.
 */
import { getServerClient } from '@/src/core/db/supabase';
import { LAUNCH_DATE_KEY, resolveLaunchCountdown } from './launchCountdown';
import LaunchCountdownPopup from './LaunchCountdownPopup';

export default async function LaunchCountdownBanner(): Promise<React.JSX.Element | null> {
  let launchDate = '';
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('value')
      .eq('key', LAUNCH_DATE_KEY)
      .maybeSingle();
    launchDate = (data as { value?: string | null } | null)?.value ?? '';
  } catch {
    return null; // never break a page for a launch-date lookup
  }

  const decision = resolveLaunchCountdown({ launchDate, nowMs: Date.now() });
  if (!decision.show) return null;

  return <LaunchCountdownPopup targetIso={decision.targetIso} />;
}
