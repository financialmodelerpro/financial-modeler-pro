/**
 * The admin On/Off switch for the main-site logo intro: training_settings
 * key `site_intro_animation`, 'true' / 'false'; ABSENT means On (the default).
 * Read through a short cache (the root layout asks on every page); the admin
 * route clears it on a change. Server only.
 */
import { unstable_cache, revalidateTag } from 'next/cache';
import { getServerClient } from '@/src/core/db/supabase';
import { INTRO_SETTING_KEY } from './introScope';

export const INTRO_CACHE_TAG = 'site-intro';

export async function readIntroEnabled(): Promise<boolean> {
  const { data } = await getServerClient().from('training_settings').select('value').eq('key', INTRO_SETTING_KEY).maybeSingle();
  return (data?.value ?? 'true') !== 'false';
}

export const getIntroEnabledCached = unstable_cache(readIntroEnabled, ['site-intro-enabled'], { tags: [INTRO_CACHE_TAG], revalidate: 300 });

export function invalidateIntroSetting(): void {
  try { revalidateTag(INTRO_CACHE_TAG, { expire: 0 }); } catch (e) { console.warn('[site-intro] cache invalidation failed', String(e)); }
}
