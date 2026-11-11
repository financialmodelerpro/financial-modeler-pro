/**
 * The admin On/Off switches for the logo intro, one per site (introScope
 * INTRO_SETTING_KEYS): training_settings 'true' / 'false', and an ABSENT key
 * takes the site's default (main On, Modeling Hub Off). Read through a short
 * cache (the root layout asks on every page); the admin route clears it on a
 * change. Server only.
 */
import { unstable_cache, revalidateTag } from 'next/cache';
import { getServerClient } from '@/src/core/db/supabase';
import { INTRO_SETTING_KEYS, type IntroSite } from './introScope';

export const INTRO_CACHE_TAG = 'site-intro';

export async function readIntroEnabled(site: IntroSite = 'main'): Promise<boolean> {
  const { key, defaultOn } = INTRO_SETTING_KEYS[site];
  const { data } = await getServerClient().from('training_settings').select('value').eq('key', key).maybeSingle();
  if (data?.value == null) return defaultOn;
  return data.value !== 'false';
}

export const getIntroEnabledCached = unstable_cache(
  async (site: IntroSite) => readIntroEnabled(site),
  ['site-intro-enabled'],
  { tags: [INTRO_CACHE_TAG], revalidate: 300 },
);

export function invalidateIntroSetting(): void {
  try { revalidateTag(INTRO_CACHE_TAG, { expire: 0 }); } catch (e) { console.warn('[site-intro] cache invalidation failed', String(e)); }
}
