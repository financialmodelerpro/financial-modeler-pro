/**
 * appManifest.ts (2026-09-26)
 *
 * What the Modeling Hub's installed app IS: its name, where it opens, what it
 * keeps inside its window, and its icons. Pure, so a verifier runs the real
 * thing rather than reading a file.
 *
 *   NAME: the Modeling Hub, not the company site.
 *   START: the dashboard. Signed in, that is where a user works; signed out,
 *     the dashboard sends them to /signin, where Sign In and Create Account
 *     are both one click away. So the app never opens on a marketing page.
 *   SCOPE: the app host's origin. The main site and the Training Hub are
 *     OTHER origins, so they are out of scope by construction; the app host's
 *     own marketing pages (the hub landing and the platform pages) are kept
 *     out of the window by `isMarketingPath`, which the client applies (a
 *     manifest scope is a path prefix and cannot exclude "/" while keeping
 *     /signin).
 *   ICONS: the site favicon from header settings, rendered to each size by
 *     /app-icon/<file>. The `v` query changes when the favicon does, so an
 *     installed app picks up a new mark on its next manifest check instead of
 *     keeping the old one for ever.
 *
 * No em dashes in this file.
 */

/** Every icon file the installed app uses, and how it is drawn. */
export const APP_ICON_FILES = {
  'icon-192.png':          { size: 192, purpose: 'any' as const },
  'icon-512.png':          { size: 512, purpose: 'any' as const },
  'icon-maskable-512.png': { size: 512, purpose: 'maskable' as const },
  // iOS reads its home-screen icon from a <link>, never the manifest.
  'apple-touch-icon.png':  { size: 180, purpose: 'apple' as const },
};
export type AppIconFile = keyof typeof APP_ICON_FILES;
export const isAppIconFile = (f: string): f is AppIconFile => Object.prototype.hasOwnProperty.call(APP_ICON_FILES, f);

export const APP_NAME = 'FMP Modeling Hub';
export const APP_SHORT_NAME = 'Modeling Hub';
export const APP_START_URL = '/dashboard?source=pwa';
/** Kept from the first release so an app already installed UPDATES rather than
 * appearing as a second, different app. */
export const APP_ID = '/dashboard';

/** A short stable version for an icon source, so the icon URLs change exactly
 * when the favicon does. */
export function iconVersion(faviconUrl: string): string {
  let h = 5381;
  for (let i = 0; i < faviconUrl.length; i++) h = ((h * 33) ^ faviconUrl.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export const appIconHref = (file: AppIconFile, faviconUrl: string): string =>
  `/app-icon/${file}?v=${iconVersion(faviconUrl)}`;

export function buildAppManifest(faviconUrl: string): Record<string, unknown> {
  const icons = (Object.keys(APP_ICON_FILES) as AppIconFile[])
    .filter((f) => APP_ICON_FILES[f].purpose !== 'apple')
    .map((f) => ({
      src: appIconHref(f, faviconUrl),
      sizes: `${APP_ICON_FILES[f].size}x${APP_ICON_FILES[f].size}`,
      type: 'image/png',
      purpose: APP_ICON_FILES[f].purpose,
    }));
  return {
    id: APP_ID,
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: 'Financial Modeler Pro Modeling Hub: sign in and work on your models.',
    start_url: APP_START_URL,
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#FFFFFF',
    theme_color: '#0D2E5A',
    categories: ['finance', 'business', 'productivity'],
    icons,
  };
}

/**
 * The Modeling Hub folders that are APP pages. Every other page on the app
 * host is marketing: the hub landing ("/", served from /modeling) and each
 * platform page (/modeling/<platform>). Kept equal to the folders under
 * app/modeling by verify-pwa, so a new app page cannot be mistaken for a
 * marketing one without a failing check.
 */
export const MODELING_APP_PAGES = [
  'choose-plan', 'confirm-email', 'dashboard', 'pricing', 'register', 'signin', 'submit-testimonial',
] as const;

/** True for a page on the app host that belongs in a browser tab, not the app. */
export function isMarketingPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/modeling') return true;
  const m = /^\/modeling\/([^/]+)$/.exec(p);
  return !!m && !(MODELING_APP_PAGES as readonly string[]).includes(m[1]);
}

/**
 * Where a link clicked INSIDE the installed window should go: 'app' keeps it in
 * the window, 'browser' opens a normal browser tab. Another origin (the main
 * site, the Training Hub, anything external) and the app host's own marketing
 * pages go to the browser.
 */
export function linkTarget(href: URL, appOrigin: string): 'app' | 'browser' {
  if (href.protocol !== 'http:' && href.protocol !== 'https:') return 'app';
  if (href.origin !== appOrigin) return 'browser';
  return isMarketingPath(href.pathname) ? 'browser' : 'app';
}
