/**
 * The Training Hub app's manifest icons (2026-11-11): the Modeling Hub app's
 * icon files under the Training Hub's own URLs (/app-icon/training-<file>),
 * versioned by the favicon the same way. Its own file because a route file may
 * export only its handlers.
 *
 * No em dashes in this file.
 */
import { APP_ICON_FILES, iconVersion, type AppIconFile } from '@/src/hubs/modeling/lib/pwa/appManifest';
import { TRAINING_ICON_PREFIX } from '@/src/hubs/modeling/lib/pwa/appIcon';
import type { ManifestIcon } from '@/src/shared/pwa/trainingAppManifest';

/** The Training Hub app's icons, from the shared icon list. */
export function trainingManifestIcons(faviconUrl: string): ManifestIcon[] {
  return (Object.keys(APP_ICON_FILES) as AppIconFile[])
    .filter((f) => APP_ICON_FILES[f].purpose !== 'apple')
    .map((f) => ({
      src: `/app-icon/${TRAINING_ICON_PREFIX}${f}?v=${iconVersion(faviconUrl)}`,
      sizes: `${APP_ICON_FILES[f].size}x${APP_ICON_FILES[f].size}`,
      type: 'image/png',
      purpose: APP_ICON_FILES[f].purpose,
    }));
}

