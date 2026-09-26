/**
 * siteFavicon.ts (2026-09-26)
 *
 * The ONE rule for the site's favicon: the header settings icon, when "Use as
 * Favicon" is ticked on /admin/header-settings. The root layout reads it for
 * the browser tab and the Modeling Hub's installed app reads it for its icon,
 * so the two can never show different marks.
 *
 * Returns '' when no favicon is set or the settings cannot be read; the caller
 * keeps its own default.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export async function readSiteFaviconUrl(sb: SupabaseClient): Promise<string> {
  try {
    const { data } = await sb
      .from('cms_content')
      .select('key, value')
      .eq('section', 'header_settings')
      .in('key', ['icon_url', 'icon_as_favicon']);
    const map: Record<string, string> = {};
    for (const row of (data ?? []) as { key: string; value: string }[]) map[row.key] = row.value;
    return map.icon_as_favicon === 'true' && map.icon_url ? map.icon_url : '';
  } catch {
    return '';
  }
}
