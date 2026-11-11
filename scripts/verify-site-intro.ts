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
function decide(script: string, o: { host?: string; path?: string; seen?: boolean; reduced?: boolean; storageThrows?: boolean }) {
  const attrs: Record<string, string> = {};
  const store: Record<string, string> = o.seen ? { fmp_intro_seen: '1' } : {};
  const sessionStorage = {
    getItem: (k: string) => { if (o.storageThrows) throw new Error('blocked'); return store[k] ?? null; },
    setItem: (k: string, v: string) => { if (o.storageThrows) throw new Error('blocked'); store[k] = v; },
  };
  const ctx = {
    location: { hostname: o.host ?? 'financialmodelerpro.com', pathname: o.path ?? '/' },
    window: { matchMedia: (q: string) => ({ matches: !!o.reduced && q.includes('reduce') }) },
    sessionStorage,
    document: { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } },
  };
  vm.runInNewContext(script, ctx);
  return { shown: attrs['data-fmp-intro'] === '1', stored: store.fmp_intro_seen === '1' };
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
  check('U2.1 video: autoplay, muted, playsInline, poster, object-fit cover, on #0E3F86', ['autoPlay', 'muted', 'playsInline', 'poster={INTRO_ASSETS.poster}', "objectFit: 'cover'"].every((t) => overlay.includes(t)) && S.INTRO_BG === '#0E3F86');
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
  check('U3.2 nothing rendered when the switch is Off or unreadable', site.includes('if (!enabled) return null;') && site.includes('catch { enabled = false; }'));
  const promo = readFileSync('src/hubs/main/components/pricing/PromoPopup.tsx', 'utf8');
  check('U3.3 the promo popup and the intro read ONE page list (marketingScope.ts)', promo.includes('!isMarketingPath(path)') && !promo.includes('HIDE_ON_PREFIXES') && script.includes(JSON.stringify(M.NON_MARKETING_PREFIXES)));
  const setting = readFileSync('src/hubs/main/components/intro/introSetting.ts', 'utf8');
  check('U3.4 switch: training_settings site_intro_animation, absent = On, cache cleared on change', S.INTRO_SETTING_KEY === 'site_intro_animation' && setting.includes("(data?.value ?? 'true') !== 'false'") && readFileSync('app/api/admin/intro-animation/route.ts', 'utf8').includes('invalidateIntroSetting();'));
  check('U3.5 the admin card sits on Launch Settings (/admin/modules)', readFileSync('app/admin/modules/page.tsx', 'utf8').includes('<IntroAnimationCard onMessage={showToast} />'));

  const assetsPresent = Object.values(S.INTRO_ASSETS).every((a) => existsSync(join('public', a)));
  if (hasCreds()) {
    const { getServerClient } = await import('../src/core/db/supabase');
    const { data } = await getServerClient().from('training_settings').select('value').eq('key', S.INTRO_SETTING_KEY).maybeSingle();
    const on = (data?.value ?? 'true') !== 'false';
    check('U4.1 live: the switch is never On while the intro video files are missing from public/brand/intro', !on || assetsPresent, `switch ${on ? 'On' : 'Off'}, files ${assetsPresent ? 'present' : 'missing'}`);
  } else {
    console.log('  [SKIP] U4.1 live switch check (no credentials)');
  }
  console.log(`\n  intro files in public/brand/intro: ${assetsPresent ? 'present' : 'MISSING'}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
