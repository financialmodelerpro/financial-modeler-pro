/**
 * installedWindow.ts (moved here 2026-11-11 from the Modeling Hub's
 * appManifest.ts, so the Modeling Hub app and the Training Hub app read ONE
 * rule; appManifest.ts re-exports every name, so nothing that imported it
 * moved).
 *
 * HOW THE INSTALLED WINDOW IS DETECTED, the ONE rule, used by the CSS that
 * hides the website's chrome and by the client scripts alike:
 *   - the CSS media feature `display-mode` is one of these, which is what the
 *     browser reports for a window opened from an installed app and never for
 *     a browser tab (a tab reports "browser"); it applies before any script
 *     runs, so nothing flashes;
 *   - OR, for an iPhone home-screen app, `navigator.standalone === true`,
 *     which the client turns into the `data-installed-app` attribute on
 *     <html>, so the same CSS applies there too.
 * In a browser tab neither is true, so nothing is hidden and nothing changes.
 *
 * Pure apart from `isInstalledWindow`, which reads the browser and answers
 * false on the server.
 *
 * No em dashes in this file.
 */

export const INSTALLED_DISPLAY_MODES = ['standalone', 'minimal-ui', 'window-controls-overlay', 'fullscreen'] as const;
export const INSTALLED_MEDIA_QUERY = INSTALLED_DISPLAY_MODES.map((m) => `(display-mode: ${m})`).join(', ');
export const INSTALLED_ATTR = 'data-installed-app';

/**
 * What the installed window hides: the website's header (`nav[data-fmp-nav]`,
 * with Home, the hubs, Pricing, Articles, Contact and the Sign In menu) and
 * anything a page marks `data-pwa-hide` (the OTHER hub's sign-in and signup,
 * "Back to Home", the install entry points). Only inside the installed-window
 * conditions above.
 */
export const INSTALLED_HIDDEN_SELECTORS = ['nav[data-fmp-nav]', '[data-pwa-hide]'] as const;

/**
 * What ONLY the installed window shows (2026-09-26): the app footer. Hidden
 * everywhere by default, shown under the same installed-window rule, so a
 * browser tab never sees it.
 */
export const INSTALLED_ONLY_SELECTOR = '[data-installed-only]';

/** The footer's height; a full-window screen (the REFM workspace) gives up
 * exactly this much in the installed window, and nothing in a tab. */
export const INSTALLED_FOOTER_PX = 28;
export const INSTALLED_FOOTER_VAR = '--installed-footer-h';

export function installedAppCss(): string {
  const hide = INSTALLED_HIDDEN_SELECTORS.join(', ');
  const byAttr = INSTALLED_HIDDEN_SELECTORS.map((s) => `html[${INSTALLED_ATTR}] ${s}`).join(', ');
  const show = `${INSTALLED_ONLY_SELECTOR} { display: flex !important; } :root { ${INSTALLED_FOOTER_VAR}: ${INSTALLED_FOOTER_PX}px; }`;
  return `${INSTALLED_ONLY_SELECTOR} { display: none !important; } `
    + `@media ${INSTALLED_MEDIA_QUERY} { ${hide} { display: none !important; } ${show} } `
    + `${byAttr} { display: none !important; } `
    + `html[${INSTALLED_ATTR}] ${INSTALLED_ONLY_SELECTOR} { display: flex !important; } html[${INSTALLED_ATTR}] { ${INSTALLED_FOOTER_VAR}: ${INSTALLED_FOOTER_PX}px; }`;
}

/** True when this page is running as an installed app, not in a browser tab. */
export function isInstalledWindow(): boolean {
  if (typeof window === 'undefined') return false;
  if (INSTALLED_DISPLAY_MODES.some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches)) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
