/**
 * trainingAppManifest.ts (2026-11-11): what the Training Hub's installed app
 * IS. Pure, so verify-pwa runs the real thing.
 *
 *   NAME: "FMP Training Hub" (also the window title); short "Training Hub".
 *   START: the student dashboard. Signed out, the dashboard sends the student
 *     to sign-in and back to the dashboard.
 *   SCOPE: the learn host's origin. The Modeling Hub and the main site are
 *     OTHER origins, so they are outside it by construction, and its app is a
 *     different app with a different id: installing one never touches the
 *     other.
 *   ICONS: the site favicon, drawn like the Modeling Hub's, rendered by
 *     /app-icon/training-<file> (the caller passes them in, built from the
 *     same icon list and version rule the Modeling Hub app uses).
 *
 * No em dashes in this file.
 */
import { INSTALL_APPS } from './installApps';

export const TRAINING_APP = INSTALL_APPS.training;
export const TRAINING_APP_SHORT_NAME = 'Training Hub';
export const TRAINING_APP_ID = '/training/dashboard';
export const TRAINING_APP_START_URL = '/training/dashboard?source=pwa';
export const TRAINING_THEME_COLOR = '#1B5E20';

export interface ManifestIcon { src: string; sizes: string; type: string; purpose: string }

export function buildTrainingAppManifest(icons: ManifestIcon[]): Record<string, unknown> {
  return {
    id: TRAINING_APP_ID,
    name: TRAINING_APP.name,
    short_name: TRAINING_APP_SHORT_NAME,
    description: 'Financial Modeler Pro Training Hub: your courses, live sessions and certificates.',
    start_url: TRAINING_APP_START_URL,
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#FFFFFF',
    theme_color: TRAINING_THEME_COLOR,
    categories: ['education', 'finance'],
    icons,
  };
}

/**
 * Pages on the learn host that belong in a browser tab, not the app window:
 * the Training Hub home and the public Training Sessions listing. Course and
 * session pages STAY in the window (founder, 2026-11-11: students join live
 * sessions from them).
 */
export function isTrainingMarketingPath(pathname: string): boolean {
  const p = (pathname || '/').replace(/\/+$/, '') || '/';
  return p === '/' || p === '/training' || p === '/training-sessions' || p.startsWith('/training-sessions/');
}

/** Where a link clicked inside the installed Training Hub window goes. */
export function trainingLinkTarget(href: URL, appOrigin: string): 'app' | 'browser' {
  if (href.protocol !== 'http:' && href.protocol !== 'https:') return 'app';
  if (href.origin !== appOrigin) return 'browser';
  return isTrainingMarketingPath(href.pathname) ? 'browser' : 'app';
}
