/**
 * The main-site logo intro: when it shows, and the tiny inline script that
 * decides it BEFORE first paint. Pure (no React, no DB).
 *
 * Shows when ALL hold:
 *   - the admin switch is On (`site_intro_animation` in training_settings;
 *     absent = On), checked on the server, which renders nothing when Off;
 *   - the main site (not the learn. or app. subdomains, whose root paths are
 *     rewritten and would otherwise look like the marketing home);
 *   - a public marketing page (marketingScope.ts, shared with the promo popup);
 *   - not yet shown in this browser session (sessionStorage);
 *   - the visitor does not prefer reduced motion.
 *
 * Two safety nets live in the script, so they work even before (or without)
 * the page's JavaScript: Skip clears the intro, and it clears itself shortly
 * after the 6 s limit. The script sets `data-fmp-intro="1"` on <html>; CSS keyed on it shows the
 * overlay and locks scroll, so a visitor who does not get the intro never sees
 * a flash of it, and one who does never sees the page flash first.
 */
import { NON_MARKETING_PREFIXES } from '../marketingScope';

export const INTRO_SETTING_KEY = 'site_intro_animation';
export const INTRO_SESSION_KEY = 'fmp_intro_seen';
export const INTRO_HTML_ATTR = 'data-fmp-intro';
export const INTRO_OVERLAY_ID = 'fmp-intro';
export const INTRO_BG = '#0E3F86';
export const INTRO_FADE_MS = 400;
/** Dismiss after this long whatever happens (the clip is 4.6 s). */
export const INTRO_MAX_MS = 6000;
/** Dismiss this long after the video turns out unplayable. */
export const INTRO_FAIL_MS = 1500;
/** Marks the Skip button, which works before the page's JavaScript has loaded. */
export const INTRO_SKIP_ATTR = 'data-fmp-intro-skip';

export const INTRO_ASSETS = {
  webm: '/brand/intro/fmp-logo-intro.webm',
  mp4: '/brand/intro/fmp-logo-intro.mp4',
  poster: '/brand/intro/fmp-logo-intro-poster.jpg',
} as const;

/** Hosts the intro never shows on: the Training Hub and Modeling Hub subdomains. */
export function isIntroHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return !h.startsWith('learn.') && !h.startsWith('app.');
}

/** The pre-paint decision as a self-contained script (no imports at runtime). */
export function introDecisionScript(): string {
  const prefixes = JSON.stringify(NON_MARKETING_PREFIXES);
  return `(function(){try{
var h=location.hostname.toLowerCase();if(h.indexOf('learn.')===0||h.indexOf('app.')===0)return;
var p=location.pathname||'/',x=${prefixes};for(var i=0;i<x.length;i++){if(p===x[i]||p.indexOf(x[i]+'/')===0)return;}
if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
try{if(sessionStorage.getItem('${INTRO_SESSION_KEY}')==='1')return;sessionStorage.setItem('${INTRO_SESSION_KEY}','1');}catch(e){}
var d=document.documentElement;d.setAttribute('${INTRO_HTML_ATTR}','1');
var off=function(){d.removeAttribute('${INTRO_HTML_ATTR}');};
document.addEventListener('click',function(e){var t=e.target;if(t&&t.closest&&t.closest('[${INTRO_SKIP_ATTR}]'))off();},true);
setTimeout(off,${INTRO_MAX_MS + INTRO_FADE_MS + 1000});
}catch(e){}})();`;
}

/** Overlay hidden unless the script chose it; scroll locked while it shows. */
export function introCss(): string {
  return `#${INTRO_OVERLAY_ID}{display:none}
html[${INTRO_HTML_ATTR}="1"] #${INTRO_OVERLAY_ID}{display:block}
html[${INTRO_HTML_ATTR}="1"],html[${INTRO_HTML_ATTR}="1"] body{overflow:hidden}`;
}
