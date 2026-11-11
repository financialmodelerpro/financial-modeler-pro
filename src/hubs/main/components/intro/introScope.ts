/**
 * The logo intro: where and when it shows, and the tiny inline script that
 * decides it BEFORE first paint. Pure (no React, no DB).
 *
 * Two sites, each with its own admin switch (training_settings):
 *   main  financialmodelerpro.com     `site_intro_animation`      absent = On
 *   app   app.financialmodelerpro.com `modeling_intro_animation`  absent = Off
 * The server picks the site from the request host (introSiteForHost) and
 * renders nothing when that site's switch is Off; the learn. subdomain never
 * gets the intro.
 *
 * Shows when ALL hold:
 *   - the page is in the site's scope:
 *       main: a public marketing page (marketingScope.ts, shared with the promo popup);
 *       app:  the hub home `/` or a public platform page `/modeling/<platform>`
 *             (an ALLOW list: admin, API and auth callbacks, exports, sign-in,
 *             register, dashboard, pricing, choose-plan, /refm and settings are
 *             all outside it);
 *   - not yet shown in this browser session (sessionStorage);
 *   - the visitor does not prefer reduced motion.
 *
 * The script sets `data-fmp-intro="1"` on <html>, and `data-fmp-intro-orient`
 * to portrait or landscape (matchMedia orientation) so the overlay plays the
 * matching video and poster. CSS keyed on them shows the overlay, its poster
 * and locks scroll, so a visitor who does not get the intro never sees a flash
 * of it, and one who does never sees the page flash first.
 *
 * Two safety nets live in the script, so they work even before (or without)
 * the page's JavaScript: Skip clears the intro, and it clears itself shortly
 * after the 6 s limit.
 */
import { NON_MARKETING_PREFIXES } from '../marketingScope';

export type IntroSite = 'main' | 'app';
export type IntroOrientation = 'portrait' | 'landscape';

export const INTRO_SETTING_KEYS: Record<IntroSite, { key: string; defaultOn: boolean }> = {
  main: { key: 'site_intro_animation', defaultOn: true },
  app: { key: 'modeling_intro_animation', defaultOn: false },
};
/** Kept for the main site's existing readers. */
export const INTRO_SETTING_KEY = INTRO_SETTING_KEYS.main.key;
export const INTRO_SESSION_KEY = 'fmp_intro_seen';
export const INTRO_HTML_ATTR = 'data-fmp-intro';
export const INTRO_ORIENT_ATTR = 'data-fmp-intro-orient';
export const INTRO_OVERLAY_ID = 'fmp-intro';
export const INTRO_BG = '#0E3F86';
export const INTRO_FADE_MS = 400;
/** Dismiss after this long whatever happens (the clip is 4.6 s). */
export const INTRO_MAX_MS = 6000;
/** Dismiss this long after the video turns out unplayable. */
export const INTRO_FAIL_MS = 1500;
/** Marks the Skip button, which works before the page's JavaScript has loaded. */
export const INTRO_SKIP_ATTR = 'data-fmp-intro-skip';
/**
 * The script's decision, also kept on window: when a page's hydration fails,
 * React re-renders from scratch and resets <html>, wiping the attributes; the
 * overlay restores them from here before paint (unless Skip or the safety
 * clear already ended the intro: done). Once the overlay is running (live),
 * the script's own Skip listener stands down, so Skip fades as designed.
 */
export const INTRO_GLOBAL = '__fmpIntro';

export const INTRO_VIDEO_SETS: Record<IntroOrientation, { webm: string; mp4: string; poster: string }> = {
  landscape: {
    webm: '/brand/intro/fmp-logo-intro.webm',
    mp4: '/brand/intro/fmp-logo-intro.mp4',
    poster: '/brand/intro/fmp-logo-intro-poster.jpg',
  },
  portrait: {
    webm: '/brand/intro/fmp-logo-intro-portrait.webm',
    mp4: '/brand/intro/fmp-logo-intro-portrait.mp4',
    poster: '/brand/intro/fmp-logo-intro-portrait-poster.jpg',
  },
};
/** The landscape set (the main site's original files). */
export const INTRO_ASSETS = INTRO_VIDEO_SETS.landscape;

/** /modeling/<x> pages on the app host that are NOT public platform pages. */
export const APP_NON_PLATFORM_SEGMENTS = ['signin', 'register', 'dashboard', 'pricing', 'choose-plan', 'confirm-email', 'submit-testimonial'] as const;

/** Which site's intro a request host gets, or null (the Training Hub never gets one). */
export function introSiteForHost(host: string | null | undefined): IntroSite | null {
  const h = String(host ?? '').toLowerCase().split(':')[0];
  if (h.startsWith('learn.')) return null;
  if (h.startsWith('app.')) return 'app';
  return 'main';
}

/** Kept for the main site: true for a host whose intro is the main one. */
export function isIntroHost(hostname: string): boolean {
  return introSiteForHost(hostname) === 'main';
}

/** Is this path inside the app site's scope (hub home or a public platform page)? */
export function isAppIntroPath(pathname: string | null | undefined): boolean {
  const p = (pathname || '/').replace(/\/+$/, '') || '/';
  if (p === '/') return true;
  const m = /^\/modeling\/([^/]+)$/.exec(p);
  return !!m && !(APP_NON_PLATFORM_SEGMENTS as readonly string[]).includes(m[1].toLowerCase());
}

/** The pre-paint decision as a self-contained script (no imports at runtime). */
export function introDecisionScript(site: IntroSite = 'main'): string {
  const scope = site === 'app'
    ? `var p=(location.pathname||'/').replace(/\\/+$/,'')||'/';if(p!=='/'){var m=/^\\/modeling\\/([^/]+)$/.exec(p);if(!m||${JSON.stringify(APP_NON_PLATFORM_SEGMENTS)}.indexOf(m[1].toLowerCase())>=0)return;}`
    : `var p=location.pathname||'/',x=${JSON.stringify(NON_MARKETING_PREFIXES)};for(var i=0;i<x.length;i++){if(p===x[i]||p.indexOf(x[i]+'/')===0)return;}`;
  const host = site === 'app'
    ? `if(h.indexOf('app.')!==0)return;`
    : `if(h.indexOf('learn.')===0||h.indexOf('app.')===0)return;`;
  return `(function(){try{
var h=location.hostname.toLowerCase();${host}
${scope}
if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
try{if(sessionStorage.getItem('${INTRO_SESSION_KEY}')==='1')return;sessionStorage.setItem('${INTRO_SESSION_KEY}','1');}catch(e){}
var d=document.documentElement,o=(window.matchMedia&&window.matchMedia('(orientation: portrait)').matches)?'portrait':'landscape';
window.${INTRO_GLOBAL}={orient:o,done:false};
d.setAttribute('${INTRO_ORIENT_ATTR}',o);
d.setAttribute('${INTRO_HTML_ATTR}','1');
var off=function(){window.${INTRO_GLOBAL}.done=true;d.removeAttribute('${INTRO_HTML_ATTR}');};
document.addEventListener('click',function(e){if(window.${INTRO_GLOBAL}.live)return;var t=e.target;if(t&&t.closest&&t.closest('[${INTRO_SKIP_ATTR}]'))off();},true);
setTimeout(off,${INTRO_MAX_MS + INTRO_FADE_MS + 1000});
}catch(e){}})();`;
}

/** The orientation the script chose (landscape when absent). */
export function chosenOrientation(attr: string | null | undefined): IntroOrientation {
  return attr === 'portrait' ? 'portrait' : 'landscape';
}

/**
 * Overlay hidden unless the script chose it; its poster matches the chosen
 * orientation from first paint (fetched only when the intro shows); scroll
 * locked while it shows.
 */
export function introCss(): string {
  const on = `html[${INTRO_HTML_ATTR}="1"]`;
  const poster = (o: IntroOrientation) => `${on}[${INTRO_ORIENT_ATTR}="${o}"] #${INTRO_OVERLAY_ID}{background:${INTRO_BG} url(${INTRO_VIDEO_SETS[o].poster}) center/cover no-repeat}`;
  return `#${INTRO_OVERLAY_ID}{display:none}
${on} #${INTRO_OVERLAY_ID}{display:block}
${poster('landscape')}
${poster('portrait')}
${on},${on} body{overflow:hidden}`;
}
