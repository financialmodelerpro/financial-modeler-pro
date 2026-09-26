/**
 * generate-pwa-icons.ts (2026-09-24, redrawn 2026-09-26)
 *
 * Writes the STATIC FALLBACK copies of the Modeling Hub's installed-app icons
 * under public/pwa/. The live icons are drawn per request by /app-icon/<file>
 * from the site favicon (header settings, "Use as Favicon"); these copies are
 * what that route falls back to when no favicon is set or it cannot be
 * fetched, and what the offline page shows. Both go through the SAME
 * `readSiteFaviconUrl` and `renderAppIcon`, so the fallback is the favicon too
 * and never a second mark. (Until 2026-09-26 this drew its own shape-only
 * mark, which is why the installed icon did not match the site's.)
 *
 * Re-run after changing the favicon in header settings:
 *   npx tsx --env-file=.env.local scripts/generate-pwa-icons.ts
 *
 * No em dashes in this file.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { readSiteFaviconUrl } from '../src/shared/cms/siteFavicon';
import { APP_ICON_FILES, type AppIconFile } from '../src/hubs/modeling/lib/pwa/appManifest';
import { renderAppIcon } from '../src/hubs/modeling/lib/pwa/appIcon';

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Needs Supabase credentials: run with --env-file=.env.local');
  const favicon = await readSiteFaviconUrl(createClient(url, key));
  if (!favicon) throw new Error('No site favicon is set in header settings ("Use as Favicon"), so there is nothing to draw.');
  const res = await fetch(favicon);
  if (!res.ok) throw new Error(`Could not fetch the favicon (${res.status}): ${favicon}`);
  const source = Buffer.from(await res.arrayBuffer());
  mkdirSync('public/pwa', { recursive: true });
  for (const file of Object.keys(APP_ICON_FILES) as AppIconFile[]) {
    writeFileSync(`public/pwa/${file}`, await renderAppIcon(source, file));
    console.log(`  wrote public/pwa/${file} (${APP_ICON_FILES[file].size}px, ${APP_ICON_FILES[file].purpose})`);
  }
  console.log(`From ${favicon}`);
})().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
