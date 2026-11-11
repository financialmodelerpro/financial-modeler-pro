/**
 * verify-site-intro: the main-site logo intro (src/hubs/main/components/intro/).
 *
 * Runs the real pre-paint script against simulated pages (host, path, session,
 * reduced motion) and checks the overlay's rules, the shared page scoping with
 * the promo popup, the admin switch and, live, that the switch is never On
 * while the video files are missing.
 *
 *   npx tsx --env-file=.env.local scripts/verify-site-intro.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const hasCreds = () => !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);

/** Run the decision script on a fake page; returns whether it chose the intro and what it stored. */
function decide(script: string, o: { host?: string; path?: string; seen?: boolean; reduced?: boolean; storageThrows?: boolean; portrait?: boolean }) {
  const attrs: Record<string, string> = {};
  const store: Record<string, string> = o.seen ? { fmp_intro_seen: '1' } : {};
  const sessionStorage = {
    getItem: (k: string) => { if (o.storageThrows) throw new Error('blocked'); return store[k] ?? null; },
    setItem: (k: string, v: string) => { if (o.storageThrows) throw new Error('blocked'); store[k] = v; },
  };
  const ctx = {
    location: { hostname: o.host ?? 'financialmodelerpro.com', pathname: o.path ?? '/' },
    window: { matchMedia: (q: string) => ({ matches: (!!o.reduced && q.includes('reduce')) || (!!o.portrait && q.includes('orientation: portrait')) }) },
    sessionStorage,
    document: { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } },
  };
  vm.runInNewContext(script, ctx);
  return { shown: attrs['data-fmp-intro'] === '1', stored: store.fmp_intro_seen === '1', orient: attrs['data-fmp-intro-orient'] ?? null };
}

(async () => {
  console.log('\n=== Site intro: when it shows ===\n');
  const S = await import('../src/hubs/main/components/intro/introScope');
  const M = await import('../src/hubs/main/components/marketingScope');
  const script = S.introDecisionScript();

  check('U1.1 the marketing home on the main site shows it, and marks the session', decide(script, {}).shown && decide(script, {}).stored);
  check('U1.2 other public marketing pages show it (articles, about, contact)', ['/articles', '/articles/some-post', '/about', '/contact'].every((path) => decide(script, { path }).shown));
  const blocked = ['/pricing', '/pricing/real-estate', '/admin', '/admin/modules', '/dashboard', '/refm', '/modeling', '/modeling-hub', '/training', '/training/REFM', '/settings', '/account', '/signin', '/register', '/login', '/forgot', '/set-password', '/confirm-email', '/verify', '/verify/abc'];
  const leaked = blocked.filter((path) => decide(script, { path }).shown);
  check('U1.3 never on app, admin, training, dashboard, auth, verify or pricing pages', leaked.length === 0, leaked.join(', '));
  check('U1.4 never on the learn. or app. subdomains (their "/" is the hub home)', !decide(script, { host: 'learn.financialmodelerpro.com' }).shown && !decide(script, { host: 'app.financialmodelerpro.com' }).shown && !decide(script, { host: 'APP.financialmodelerpro.com', path: '/about' }).shown);
  check('U1.5 www and the apex both count as the main site', decide(script, { host: 'www.financialmodelerpro.com' }).shown && S.isIntroHost('financialmodelerpro.com') && !S.isIntroHost('learn.financialmodelerpro.com'));
  check('U1.6 once per browser session: a second page in the same session does not show it', !decide(script, { seen: true }).shown);
  check('U1.7 skipped entirely for prefers-reduced-motion (and the session is not marked)', !decide(script, { reduced: true }).shown && !decide(script, { reduced: true }).stored);
  check('U1.8 blocked storage does not break the page (shows, nothing thrown)', decide(script, { storageThrows: true }).shown);
  check('U1.9 a path that merely starts like a blocked one is still marketing (/pricingguide is not /pricing)', M.isMarketingPath('/pricingguide') && !M.isMarketingPath('/pricing'));

  console.log('\n=== Site intro: the overlay ===\n');
  const overlay = readFileSync('src/hubs/main/components/intro/IntroOverlay.tsx', 'utf8');
  check('U2.1 video: autoplay, muted, playsInline, poster, object-fit cover, on #0E3F86', ['autoPlay', 'muted', 'playsInline', 'poster={INTRO_VIDEO_SETS[orient].poster}', "objectFit: 'cover'"].every((t) => overlay.includes(t)) && S.INTRO_BG === '#0E3F86');
  const iW = overlay.indexOf('type="video/webm"'), iM = overlay.indexOf('type="video/mp4"');
  check('U2.2 sources: webm first, then mp4', iW > 0 && iM > iW);
  check('U2.3 fades out over 400 ms when the video ends', S.INTRO_FADE_MS === 400 && overlay.includes('onEnded={dismiss}') && overlay.includes('transition: `opacity ${INTRO_FADE_MS}ms'));
  check('U2.4 a Skip button, bottom-right', /aria-label="Skip intro"[^]*?right:[^]*?bottom:/.test(overlay) && overlay.includes('onClick={dismiss}'));
  check('U2.5 fallbacks: 6 s from first paint whatever happens; 1.5 s when the video cannot play (source error, video error or refused play)', S.INTRO_MAX_MS === 6000 && S.INTRO_FAIL_MS === 1500 && overlay.includes('setTimeout(dismiss, Math.max(0, INTRO_MAX_MS - performance.now()))') && overlay.includes('onError={failSoon}') && overlay.includes('p.catch(failSoon)'));
  check('U2.6 the video is added only when the intro is showing (no other visitor downloads it)', /\{active && \(/.test(overlay) && overlay.includes("getAttribute(INTRO_HTML_ATTR) !== '1'"));
  check('U2.8 before the page JavaScript loads: Skip is in the server HTML and the pre-paint script honours it, and clears the intro itself after 6 s + fade + 1 s', overlay.includes("{...{ [INTRO_SKIP_ATTR]: '' }}") && overlay.indexOf('aria-label="Skip intro"') > overlay.indexOf('</video>') && overlay.indexOf('</>') < overlay.indexOf('aria-label="Skip intro"') &&script.includes("closest('[data-fmp-intro-skip]')") && script.includes('setTimeout(off,7400)'));
  const css = S.introCss();
  check('U2.7 hidden unless chosen, page scroll locked while showing, released on dismiss', css.includes('#fmp-intro{display:none}') && css.includes('html[data-fmp-intro="1"] #fmp-intro{display:block}') && css.includes('overflow:hidden') && overlay.includes('removeAttribute(INTRO_HTML_ATTR)'));

  console.log('\n=== Site intro: page, scoping and switch ===\n');
  const layout = readFileSync('app/layout.tsx', 'utf8');
  check('U3.1 mounted first in <body>, beside the page (children untouched)', /<body[^>]*>\s*\{\/\*[^]*?\*\/\}\s*<SiteIntro \/>/.test(layout) && layout.includes('{children}'));
  const site = readFileSync('src/hubs/main/components/intro/SiteIntro.tsx', 'utf8');
  check('U3.2 nothing rendered when the switch is Off or unreadable', site.includes('if (!site || !enabled) return null;') && site.includes('catch { enabled = false; }'));
  const promo = readFileSync('src/hubs/main/components/pricing/PromoPopup.tsx', 'utf8');
  check('U3.3 the promo popup and the intro read ONE page list (marketingScope.ts)', promo.includes('!isMarketingPath(path)') && !promo.includes('HIDE_ON_PREFIXES') && script.includes(JSON.stringify(M.NON_MARKETING_PREFIXES)));
  const setting = readFileSync('src/hubs/main/components/intro/introSetting.ts', 'utf8');
  check('U3.4 switch: training_settings site_intro_animation, absent = On, cache cleared on change', S.INTRO_SETTING_KEY === 'site_intro_animation' && S.INTRO_SETTING_KEYS.main.defaultOn === true && setting.includes('if (data?.value == null) return defaultOn;') && readFileSync('app/api/admin/intro-animation/route.ts', 'utf8').includes('invalidateIntroSetting();'));
  check('U3.5 the admin card sits on Launch Settings (/admin/modules)', readFileSync('app/admin/modules/page.tsx', 'utf8').includes('<IntroAnimationCard onMessage={showToast} />'));

  console.log('\n=== Site intro: portrait and landscape ===\n');
  const land = decide(script, {}), port = decide(script, { portrait: true });
  check('U5.1 before paint, a portrait viewport gets the portrait set, otherwise landscape', land.orient === 'landscape' && port.orient === 'portrait' && port.shown);
  check('U5.2 the portrait set is its own three files (webm, mp4, poster)', S.INTRO_VIDEO_SETS.portrait.webm === '/brand/intro/fmp-logo-intro-portrait.webm' && S.INTRO_VIDEO_SETS.portrait.mp4 === '/brand/intro/fmp-logo-intro-portrait.mp4' && S.INTRO_VIDEO_SETS.portrait.poster === '/brand/intro/fmp-logo-intro-portrait-poster.jpg');
  check('U5.3 the overlay plays the chosen set (sources and poster), object-fit cover for both', overlay.includes('setOrient(chosenOrientation(document.documentElement.getAttribute(INTRO_ORIENT_ATTR)))') && overlay.includes('src={INTRO_VIDEO_SETS[orient].webm}') && overlay.includes('src={INTRO_VIDEO_SETS[orient].mp4}') && overlay.includes("objectFit: 'cover'") && S.chosenOrientation('portrait') === 'portrait' && S.chosenOrientation(null) === 'landscape');
  check('U5.4 the poster matches the orientation from first paint (CSS on the chosen attribute)', css.includes('[data-fmp-intro-orient="portrait"] #fmp-intro{background:#0E3F86 url(/brand/intro/fmp-logo-intro-portrait-poster.jpg) center/cover') && css.includes('[data-fmp-intro-orient="landscape"] #fmp-intro{background:#0E3F86 url(/brand/intro/fmp-logo-intro-poster.jpg) center/cover') && !/background: INTRO_BG/.test(overlay));

  check('U5.5 a page whose hydration fails (React resets <html>) keeps its intro: the script records its decision on window and the overlay restores it before paint, unless Skip or the safety clear ended it', script.includes('window.__fmpIntro={orient:o,done:false};') && script.includes('window.__fmpIntro.done=true;') && overlay.includes('useLayoutEffect(() => {') && overlay.includes("if (g && !g.done && d.getAttribute(INTRO_HTML_ATTR) !== '1')") && overlay.includes('if (g) g.done = true;'));
  check('U5.6 once the overlay is running, Skip fades (the script\'s pre-load Skip listener stands down)', script.includes('if(window.__fmpIntro.live)return;') && overlay.includes('if (g) g.live = true;'));

  console.log('\n=== Site intro: the Modeling Hub (app.) ===\n');
  const app = S.introDecisionScript('app');
  const APP = 'app.financialmodelerpro.com';
  check('U6.1 the server picks the site from the host: app. gets the Modeling Hub intro, learn. none, anything else the main one', S.introSiteForHost(APP) === 'app' && S.introSiteForHost('app.financialmodelerpro.com:443') === 'app' && S.introSiteForHost('learn.financialmodelerpro.com') === null && S.introSiteForHost('www.financialmodelerpro.com') === 'main' && S.introSiteForHost(null) === 'main');
  check('U6.2 shows on the hub home and on public platform pages', decide(app, { host: APP }).shown && decide(app, { host: APP, path: '/modeling/real-estate' }).shown && decide(app, { host: APP, path: '/modeling/real-estate/' }).shown);
  const appBlocked = ['/admin', '/admin/modules', '/api/auth/callback/credentials', '/api/refm/projects/x/export', '/signin', '/register', '/dashboard', '/pricing', '/choose-plan', '/refm', '/refm/abc', '/settings', '/account', '/forgot-password', '/reset-password', '/portal', '/modeling/signin', '/modeling/register', '/modeling/dashboard', '/modeling/pricing', '/modeling/choose-plan', '/modeling/confirm-email', '/modeling/submit-testimonial', '/modeling/real-estate/print', '/training'];
  const appLeaked = appBlocked.filter((path) => decide(app, { host: APP, path }).shown);
  check('U6.3 never on admin, API (auth callbacks, exports), sign-in, register, dashboard, pricing, platforms, settings or any nested view', appLeaked.length === 0, appLeaked.join(', '));
  check('U6.4 same behaviour: once per session, reduced-motion skip, portrait choice, Skip and the safety clear', !decide(app, { host: APP, seen: true }).shown && !decide(app, { host: APP, reduced: true }).shown && decide(app, { host: APP, portrait: true }).orient === 'portrait' && app.includes("closest('[data-fmp-intro-skip]')") && app.includes('setTimeout(off,7400)'));
  check('U6.5 the Modeling Hub script never runs on another host, and the main one never on app.', !decide(app, { host: 'www.financialmodelerpro.com' }).shown && !decide(script, { host: APP }).shown);
  check('U6.6 separate switch: modeling_intro_animation, absent = Off; admin route ?site=app; card beside the main one', S.INTRO_SETTING_KEYS.app.key === 'modeling_intro_animation' && S.INTRO_SETTING_KEYS.app.defaultOn === false && readFileSync('app/api/admin/intro-animation/route.ts', 'utf8').includes("searchParams.get('site') === 'app'") && /<IntroAnimationCard onMessage=\{showToast\} \/>\s*<IntroAnimationCard onMessage=\{showToast\} site="app" \/>/.test(readFileSync('app/admin/modules/page.tsx', 'utf8')));
  check('U6.7 the mount reads the host and renders the chosen site\'s script', site.includes('introSiteForHost(h.get(\'x-forwarded-host\') ?? h.get(\'host\'))') && site.includes('introDecisionScript(site)'));

  const assetsPresent = (['landscape', 'portrait'] as const).every((o) => Object.values(S.INTRO_VIDEO_SETS[o]).every((a) => existsSync(join('public', a))));
  if (hasCreds()) {
    const { getServerClient } = await import('../src/core/db/supabase');
    for (const siteKey of ['main', 'app'] as const) {
      const { key, defaultOn } = S.INTRO_SETTING_KEYS[siteKey];
      const { data } = await getServerClient().from('training_settings').select('value').eq('key', key).maybeSingle();
      const on = data?.value == null ? defaultOn : data.value !== 'false';
      check(`U4.1 live (${siteKey}): the switch is never On while any intro file (both orientations) is missing`, !on || assetsPresent, `switch ${on ? 'On' : 'Off'}, files ${assetsPresent ? 'present' : 'missing'}`);
    }
  } else {
    console.log('  [SKIP] U4.1 live switch check (no credentials)');
  }
  console.log(`\n  intro files in public/brand/intro (landscape + portrait): ${assetsPresent ? 'present' : 'MISSING'}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
