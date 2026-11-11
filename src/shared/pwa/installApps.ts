/**
 * installApps.ts (2026-11-11): the TWO installable apps, and when each one may
 * be installed. Pure, so verify-pwa runs the real rules.
 *
 *   Modeling Hub  app.financialmodelerpro.com    "FMP Modeling Hub"
 *   Training Hub  learn.financialmodelerpro.com  "FMP Training Hub"
 *
 * TWO APPS, NEVER ONE: each lives on its own origin with its own manifest,
 * service worker, icons, start page and scope '/'. A browser keys an installed
 * app and a service worker by origin, so installing one can never install,
 * update or affect the other.
 *
 * INSTALL ONLY WHEN SIGNED IN (founder, 2026-11-11): a page offers an install
 * only when (a) the user is signed in to THAT hub and (b) the page is one of
 * the hub's signed-in pages (`offersInstall`). The manifest link, the iOS
 * home-screen tags and the service worker are added by the client only then
 * (InstallAppHead), never in the server HTML, so a public, marketing,
 * sign-in or register page offers no install, and neither does a signed-out
 * visit to a dashboard before it redirects.
 *
 * An app already installed keeps working whatever page it opens on: the
 * manifest only decides whether a NEW install is offered.
 *
 * No em dashes in this file.
 */

export type InstallAppKey = 'modeling' | 'training';

export interface InstallApp {
  key: InstallAppKey;
  /** "Modeling Hub" / "Training Hub", as the banner and the iOS steps say it. */
  label: string;
  /** The installed app's name, also its window title. */
  name: string;
  host: string;
  manifestHref: string;
  swPath: string;
  offlinePath: string;
  /** Where the app opens; a signed-out user is sent to sign-in and back here. */
  dashboardPath: string;
  /** The iOS home-screen icon (iOS reads a <link>, never the manifest). */
  appleTouchIcon: string;
  /** Path prefixes of the hub's signed-in pages, where an install is offered. */
  installPages: readonly string[];
}

export const INSTALL_APPS: Record<InstallAppKey, InstallApp> = {
  modeling: {
    key: 'modeling',
    label: 'Modeling Hub',
    name: 'FMP Modeling Hub',
    host: 'app.financialmodelerpro.com',
    manifestHref: '/app.webmanifest',
    swPath: '/sw.js',
    offlinePath: '/offline.html',
    dashboardPath: '/dashboard',
    appleTouchIcon: '/app-icon/apple-touch-icon.png',
    // The dashboard (served at /dashboard, from app/modeling/dashboard), the
    // platforms and account settings. Not the hub home, platform marketing
    // pages, pricing, choose-plan, sign-in or register.
    installPages: ['/dashboard', '/modeling/dashboard', '/refm', '/settings'],
  },
  training: {
    key: 'training',
    label: 'Training Hub',
    name: 'FMP Training Hub',
    host: 'learn.financialmodelerpro.com',
    manifestHref: '/training.webmanifest',
    swPath: '/sw-training.js',
    offlinePath: '/offline-training.html',
    dashboardPath: '/training/dashboard',
    appleTouchIcon: '/app-icon/training-apple-touch-icon.png',
    // The student dashboard area. Not the Training Hub home, course landing
    // pages, Training Sessions, sign-in or register.
    installPages: ['/training/dashboard', '/training/watch', '/training/assessment', '/training/material', '/training/certificate', '/training/transcript'],
  },
};

/** Does this path sit at or under one of the prefixes? (`/refmx` is not `/refm`.) */
function underAny(pathname: string, prefixes: readonly string[]): boolean {
  const p = (pathname || '/').split('?')[0].replace(/\/+$/, '') || '/';
  return prefixes.some((x) => p === x || p.startsWith(`${x}/`));
}

/** Is a NEW install offered here? Signed in to this hub AND on one of its signed-in pages. */
export function offersInstall(app: InstallApp, pathname: string, signedIn: boolean): boolean {
  return signedIn && underAny(pathname, app.installPages);
}

/** The service worker registers only on the app's own host or a local dev host. */
export function swHostAllowed(app: InstallApp, hostname: string): boolean {
  return hostname === app.host || hostname === 'localhost' || hostname === '127.0.0.1';
}

/** Where the banner's dismissal is remembered: per app, per user, in this browser. */
export function bannerDismissKey(app: InstallApp, userKey: string): string {
  return `fmp_install_banner_dismissed:${app.key}:${String(userKey || 'anon').toLowerCase()}`;
}

/** iPhone or iPad (an iPad in desktop mode reports MacIntel with touch). */
export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

/** The banner's words. */
export function installBannerText(app: InstallApp): string {
  return `Install the ${app.label} app for quicker access`;
}
