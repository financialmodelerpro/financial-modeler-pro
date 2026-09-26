/**
 * verify-pwa.ts (2026-09-24)
 *
 * Pins the Modeling Hub's installable app to the founder's rules:
 *
 *   A. It INSTALLS: a manifest with a name, icons (any + maskable, files that
 *      exist at the stated sizes), standalone display, and a scope that keeps
 *      the app window on the app host; linked ONLY from the Modeling Hub
 *      layouts.
 *   B. The service worker caches the SHELL ONLY and NEVER an API response.
 *      Measured by RUNNING public/sw.js in a sandbox with a fake `caches` and
 *      `fetch`, not by reading its text: every request kind is fired at the
 *      real handler and what it answered, and what it wrote to a cache, is
 *      recorded.
 *   C. OFFLINE: a failed navigation gets the offline page, which asks the user
 *      to check their connection and has NO sign-in and no figures; the guards
 *      never send an offline user to sign in.
 *   E. IT IS THE MODELING HUB (2026-09-26, founder: "the installed app opens
 *      the whole website"): named Modeling Hub, opens on the dashboard (sign-in
 *      when signed out, with Create Account on that page), and a link that
 *      leaves the app (another origin, or the app host's own marketing pages)
 *      opens in a browser tab; landing on a marketing page goes to the
 *      dashboard. The rule is RUN on real URLs, and the list of app pages is
 *      proved equal to the folders under app/modeling.
 *   F. ITS ICON IS THE SITE FAVICON: one favicon rule, read by the root layout
 *      and by the icon route; every icon is DRAWN by the real renderer at its
 *      stated size; the static fallback copies exist at their sizes.
 *   H. THE INSTALLED WINDOW IS NOT THE WEBSITE (2026-09-26): the website's
 *      header, another hub's sign-in and "Back to Home" are hidden ONLY under
 *      the installed-window rule (display-mode, or the iPhone attribute), the
 *      window is titled "Modeling Hub", and a browser tab is untouched: every
 *      hiding rule sits inside that media query or behind that attribute.
 *   J. THE MODELING HUB CONFIRMATION EMAIL SAYS THE APP EXISTS, and the
 *      Training Hub one does not; it never calls it a download. RENDERED.
 *   D. AUTH STAYS IN THE APP WINDOW: every Modeling Hub sign-out asks for
 *      /signin. Asking for "/" is resolved by the NextAuth redirect rule to
 *      /admin/dashboard, which the app host sends to the MAIN domain, leaving
 *      the installed app's window (measured live 2026-09-24: 307 to
 *      financialmodelerpro.com/admin/dashboard).
 *
 * Run: npx tsx scripts/verify-pwa.ts
 *
 * No em dashes in this file.
 */
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import sharp from 'sharp';
import { readdirSync, statSync } from 'node:fs';
import { buildAppManifest, isMarketingPath, linkTarget, MODELING_APP_PAGES, APP_ICON_FILES, type AppIconFile, iconVersion,
  installedAppCss, INSTALLED_DISPLAY_MODES, INSTALLED_ATTR, INSTALLED_HIDDEN_SELECTORS, APP_NAME,
  INSTALLED_ONLY_SELECTOR, INSTALLED_FOOTER_VAR }
  from '../src/hubs/modeling/lib/pwa/appManifest';
import { renderAppIcon } from '../src/hubs/modeling/lib/pwa/appIcon';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const src = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

(async () => {
  console.log('=== A. It installs, and only from the Modeling Hub ===');
  const FAV = 'https://example.test/favicon.png';
  const manifest = buildAppManifest(FAV) as {
    name?: string; short_name?: string; display?: string; scope?: string; start_url?: string; id?: string;
    icons?: Array<{ src: string; sizes: string; purpose?: string }>;
  };
  const manifestRoute = src('app/app.webmanifest/route.ts');
  check('A0 the manifest is SERVED by the route (no static public/app.webmanifest to shadow it)',
    !existsSync('public/app.webmanifest') && /buildAppManifest\(favicon\)/.test(manifestRoute)
    && /application\/manifest\+json/.test(manifestRoute));
  check('A1 name and short name', !!manifest.name && !!manifest.short_name);
  check('A2 opens in its own window (standalone)', manifest.display === 'standalone');
  check('A3 scope and start URL are on the app origin (relative, inside the scope)',
    manifest.scope === '/' && !!manifest.start_url?.startsWith('/') && !!manifest.id?.startsWith('/'));
  const icons = manifest.icons ?? [];
  check('A4 a 192 and a 512 "any" icon and a maskable one',
    icons.some((i) => i.sizes === '192x192') && icons.some((i) => i.sizes === '512x512' && (i.purpose ?? 'any') === 'any')
    && icons.some((i) => i.purpose === 'maskable'));
  check('A5 every manifest icon is served by /app-icon/, versioned by the favicon',
    icons.length > 0 && icons.every((i) => i.src.startsWith('/app-icon/') && i.src.endsWith(`?v=${iconVersion(FAV)}`)));
  check('A5b a different favicon gives different icon URLs, so an installed app picks the new mark up',
    iconVersion(FAV) !== iconVersion('https://example.test/other.png'));
  for (const f of Object.keys(APP_ICON_FILES) as AppIconFile[]) {
    const file = `public/pwa/${f}`;
    const meta = existsSync(file) ? await sharp(file).metadata() : null;
    const size = APP_ICON_FILES[f].size;
    check(`A6 static fallback ${file} exists at ${size}x${size}`, !!meta && meta.width === size && meta.height === size,
      meta ? `${meta.width}x${meta.height}` : 'missing');
  }
  const modelingLayout = src('app/modeling/layout.tsx');
  const refmLayout = src('app/refm/layout.tsx');
  for (const [name, l] of [['app/modeling/layout.tsx', modelingLayout], ['app/refm/layout.tsx', refmLayout]] as const) {
    check(`A7 ${name} links the manifest, the touch icon and mounts the client`,
      /manifest: '\/app\.webmanifest'/.test(l) && /rel="apple-touch-icon" href="\/app-icon\/apple-touch-icon\.png"/.test(l)
      && /<PwaClient \/>/.test(l) && /appleWebApp: \{ capable: true, title: 'Modeling Hub'/.test(l));
  }
  check('A8 the ROOT layout links no manifest, so the main site and Training Hub never offer an install',
    !/webmanifest|PwaClient/.test(src('app/layout.tsx')) && !/webmanifest|PwaClient/.test(src('app/training/layout.tsx')));
  const client = src('src/hubs/modeling/components/pwa/PwaClient.tsx');
  check('A9 the worker registers only on the app host or a local dev host',
    /host === APP_HOST \|\| host === 'localhost'/.test(client) && /APP_HOST = 'app\.financialmodelerpro\.com'/.test(client));

  console.log('\n=== B. The worker, RUN: shell only, never an API response ===');
  type Handler = (e: unknown) => void;
  const handlers: Record<string, Handler> = {};
  const writes: string[] = [];              // every URL put into ANY cache
  const store = new Map<string, Response>();
  let networkUp = true;
  const fetched: string[] = [];
  const fakeCache = {
    addAll: async (reqs: Array<Request | string>) => {
      for (const r of reqs) { const u = new URL(typeof r === 'string' ? r : r.url, 'https://app.example').pathname; writes.push(u); store.set(u, new Response(`shell:${u}`)); }
    },
    put: async (r: Request | string) => { writes.push(String(typeof r === 'string' ? r : r.url)); },
    add: async (r: Request | string) => { writes.push(String(typeof r === 'string' ? r : r.url)); },
  };
  const sandbox: Record<string, unknown> = {
    self: {
      location: { origin: 'https://app.example' },
      addEventListener: (t: string, h: Handler) => { handlers[t] = h; },
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined },
    },
    caches: {
      open: async () => fakeCache,
      keys: async () => ['fmp-shell-v0', 'fmp-shell-v1'],
      delete: async () => true,
      match: async (r: Request | string) => store.get(new URL(typeof r === 'string' ? r : r.url, 'https://app.example').pathname),
    },
    fetch: async (r: Request) => {
      fetched.push(r.url);
      if (!networkUp) throw new TypeError('Failed to fetch');
      return new Response(`network:${new URL(r.url).pathname}`);
    },
    // A worker resolves a relative URL against its own origin; Node's Request
    // does not, so the sandbox's does what the browser's does.
    Request: class extends Request {
      constructor(input: string | Request, init?: RequestInit) {
        super(typeof input === 'string' ? new URL(input, 'https://app.example').href : input, init);
      }
    },
    Response, URL, Promise, console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src('public/sw.js'), sandbox);
  check('B1 the worker registers install, activate and fetch handlers', !!handlers.install && !!handlers.activate && !!handlers.fetch);

  let pending: Promise<unknown> | undefined;
  handlers.install({ waitUntil: (p: Promise<unknown>) => { pending = p; } });
  await pending;
  check('B2 install caches the SHELL ONLY (offline page and icons)',
    writes.length > 0 && writes.every((w) => w === '/offline.html' || w.startsWith('/pwa/')) && writes.includes('/offline.html'), writes.join(', '));
  const afterInstall = writes.length;

  /** Fire one request at the REAL fetch handler; returns what it answered with, or 'passthrough'. */
  async function fire(url: string, init: { mode?: string; method?: string } = {}): Promise<string> {
    let answered: Promise<Response> | undefined;
    const request = { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' } as unknown as Request;
    handlers.fetch({ request, respondWith: (p: Promise<Response>) => { answered = p; } });
    if (!answered) return 'passthrough';
    const res = await answered;
    return await res.text();
  }

  const api = await fire('https://app.example/api/refm/projects/p1/versions');
  const apiNav = await fire('https://app.example/api/auth/session', { mode: 'navigate' });
  check('B3 an API request is NEVER answered by the worker (the network gets it untouched)', api === 'passthrough' && apiNav === 'passthrough');
  networkUp = false;
  const apiOffline = await fire('https://app.example/api/refm/projects/p1/versions');
  check('B4 even offline, an API request is not answered from anything cached', apiOffline === 'passthrough');
  networkUp = true;
  check('B5 scripts, styles and data fetches pass through, never cached',
    (await fire('https://app.example/_next/static/chunks/app.js')) === 'passthrough'
    && (await fire('https://app.example/dashboard?_rsc=1')) === 'passthrough');
  check('B6 a write (POST) is never touched', (await fire('https://app.example/api/x', { method: 'POST' })) === 'passthrough');
  check('B7 another origin is never touched', (await fire('https://cdn.other.com/x.js')) === 'passthrough');
  const navOnline = await fire('https://app.example/dashboard', { mode: 'navigate' });
  check('B8 online, a page navigation is the NETWORK\'s page, never a cached one', navOnline === 'network:/dashboard', navOnline);
  check('B9 and nothing, of any kind, was written to a cache after install', writes.length === afterInstall, writes.slice(afterInstall).join(', '));
  const sw = src('public/sw.js');
  check('B10 the file has no runtime cache write at all (no put, no add outside the shell addAll)',
    !/\.put\(/.test(sw) && !/cache\.add\(/.test(sw));

  console.log('\n=== C. Offline: a clear message, no sign-in ===');
  networkUp = false;
  const navOffline = await fire('https://app.example/refm?project=1', { mode: 'navigate' });
  check('C1 offline, a navigation gets the OFFLINE PAGE', navOffline === 'shell:/offline.html', navOffline);
  const offline = src('public/offline.html');
  check('C2 the offline page asks them to check their connection and offers a retry',
    /check your internet connection/i.test(offline) && /location\.reload\(\)/.test(offline));
  check('C3 it attempts no sign-in and shows no figures (no form, no password, no sign-in link, no script beyond retry)',
    !/<form|type="password"|signin|sign in|<script/i.test(offline));
  for (const [f, re] of [
    ['src/shared/hooks/useRequireAuth.ts', /if \(isOffline\(\)\) return;/],
    ['app/modeling/dashboard/page.tsx', /status === 'unauthenticated' && !isOffline\(\)/],
    ['app/modeling/choose-plan/page.tsx', /status === 'unauthenticated' && !isOffline\(\)/],
  ] as const) {
    check(`C4 ${f} never sends an OFFLINE user to sign in`, re.test(src(f)));
  }
  check('C5 an open page says so when the connection drops, and never signs out',
    /data-testid="pwa-offline-notice"/.test(client) && /check your internet connection/i.test(client) && !/signOut|\/signin/.test(client));

  console.log('\n=== E. It is the Modeling Hub, and its window stays inside it ===');
  check('E1 named Modeling Hub, never the company site alone',
    /Modeling Hub/.test(String(manifest.name)) && manifest.short_name === 'Modeling Hub');
  check('E2 it opens on the dashboard, and keeps the id of the first release (an update, not a second app)',
    new URL(String(manifest.start_url), 'https://app.example').pathname === '/dashboard' && manifest.id === '/dashboard');
  check('E3 signed out, the dashboard sends the window to /signin, which offers Sign In AND Create Account',
    /router\.replace\('\/signin\?bypass=true'\)/.test(src('app/modeling/dashboard/page.tsx'))
    && /'Sign In' : 'Create Account'/.test(src('app/modeling/signin/SignInForm.tsx')));
  const ORIGIN = 'https://app.financialmodelerpro.com';
  const at = (u: string): 'app' | 'browser' => linkTarget(new URL(u, ORIGIN), ORIGIN);
  const inApp = ['/signin', '/register', '/dashboard', '/dashboard?source=pwa', '/refm?project=1', '/settings', '/pricing',
    '/choose-plan', '/modeling/signin', '/modeling/confirm-email', '/api/auth/session'];
  const toBrowser = ['/', '/modeling', '/modeling/', '/modeling/real-estate', 'https://www.financialmodelerpro.com/',
    'https://www.financialmodelerpro.com/articles', 'https://www.financialmodelerpro.com/forgot-password',
    'https://learn.financialmodelerpro.com/signin', 'https://example.com/x'];
  const wrongApp = inApp.filter((u) => at(u) !== 'app');
  const wrongBrowser = toBrowser.filter((u) => at(u) !== 'browser');
  check('E4 app pages stay in the window', wrongApp.length === 0, wrongApp.join(', '));
  check('E5 the main site, the Training Hub, anything external and the hub marketing pages open in a browser tab',
    wrongBrowser.length === 0, wrongBrowser.join(', '));
  check('E6 a mailto or tel link is left to the device', at('mailto:a@b.c') === 'app' && at('tel:123') === 'app');
  const folders = readdirSync('app/modeling').filter((d) => statSync(`app/modeling/${d}`).isDirectory() && !d.startsWith('['));
  const listed = [...MODELING_APP_PAGES].sort().join(',');
  check('E7 the app-page list IS the folders under app/modeling, so a new app page is never read as marketing',
    folders.sort().join(',') === listed, `folders: ${folders.join(',')} | listed: ${listed}`);
  check('E8 every platform page is marketing, every app page is not',
    MODELING_APP_PAGES.every((f) => !isMarketingPath(`/modeling/${f}`)) && isMarketingPath('/modeling/business-valuation'));
  check('E9 the client acts ONLY in the installed window, through the one rule, before a Next <Link> can navigate',
    /if \(!isInstalledWindow\(\)\) return;/.test(client) && /linkTarget\(url, window\.location\.origin\)/.test(client)
    && /isInstalledWindow\(\) && isMarketingPath\(window\.location\.pathname\)/.test(client)
    && /document\.addEventListener\('click', onClick, true\)/.test(client) && /window\.open\(url\.href, '_blank'/.test(client));
  check('E10 account settings, an app page outside the hub layouts, mounts the same client',
    /<PwaClient \/>/.test(src('app/settings/layout.tsx')));

  console.log('\n=== F. Its icon is the site favicon ===');
  const rootLayout = src('app/layout.tsx');
  const iconRoute = src('app/app-icon/[file]/route.ts');
  const oneRule = /readSiteFaviconUrl\(getServerClient\(\)\)/;
  check('F1 the root layout (browser tab), the manifest and the icon route read the favicon through the ONE rule',
    oneRule.test(rootLayout) && oneRule.test(iconRoute) && oneRule.test(manifestRoute));
  const readers = ['app/layout.tsx', 'app/app-icon/[file]/route.ts', 'app/app.webmanifest/route.ts',
    'src/hubs/modeling/components/pwa/PwaClient.tsx', 'scripts/generate-pwa-icons.ts'].filter((f) => /icon_as_favicon/.test(src(f)));
  check('F2 no reader restates the favicon rule for itself', readers.length === 0, readers.join(', '));
  check('F3 the route draws with the real renderer and falls back to the static copy, never a blank',
    /renderAppIcon\(/.test(iconRoute) && /\/pwa\/\$\{file\}/.test(iconRoute) && /isAppIconFile\(file\)/.test(iconRoute));
  const gen = src('scripts/generate-pwa-icons.ts');
  check('F4 the static fallback is drawn from the favicon by the same rule and renderer, never a second mark',
    /readSiteFaviconUrl\(/.test(gen) && /renderAppIcon\(/.test(gen) && !/<svg/.test(gen));
  // RUN the renderer on a non-square opaque source (the favicon is 256 x 266).
  const probe = await sharp({ create: { width: 256, height: 266, channels: 4, background: { r: 20, g: 60, b: 160, alpha: 1 } } }).png().toBuffer();
  for (const f of Object.keys(APP_ICON_FILES) as AppIconFile[]) {
    const out = await sharp(await renderAppIcon(probe, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = out.info;
    const px = (x: number, y: number): number[] => { const o = (y * width + x) * 4; return [...out.data.subarray(o, o + 4)]; };
    const size = APP_ICON_FILES[f].size;
    const corner = px(0, 0);
    const centre = px(Math.floor(width / 2), Math.floor(height / 2));
    const purpose = APP_ICON_FILES[f].purpose;
    const cornerOk = purpose === 'any' ? corner[3] === 0 : corner[3] === 255 && corner[0] === 255;
    check(`F5 ${f}: ${size}x${size}, the mark at the centre, corner ${purpose === 'any' ? 'transparent' : 'opaque white'}`,
      width === size && height === size && centre[2] > 100 && centre[3] === 255 && cornerOk,
      `${width}x${height} corner ${corner} centre ${centre}`);
  }
  {
    const out = await sharp(await renderAppIcon(probe, 'icon-maskable-512.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width } = out.info; const r = width * 0.4; let outside = 0; let inside = 0;
    for (let y = 0; y < width; y += 4) for (let x = 0; x < width; x += 4) {
      const o = (y * width + x) * 4;
      if (out.data[o] < 200) { if (Math.hypot(x - width / 2, y - width / 2) > r) outside++; else inside++; }
    }
    check('F6 the maskable icon keeps the whole mark inside the 80% safe zone (and the mark is there)',
      outside === 0 && inside > 0, `${outside} outside, ${inside} inside`);
  }

  console.log('\n=== H. The installed window is not the website, and a tab is untouched ===');
  const css = installedAppCss();
  // Strip the two guarded forms; nothing may remain that hides anything.
  // Split the CSS into its rules; every rule is either the one unguarded
  // DEFAULT (the installed-only footer hidden) or guarded by the installed
  // media query or the installed attribute.
  const defaultRule = `${INSTALLED_ONLY_SELECTOR} { display: none !important; }`;
  const mediaBlock = css.match(/@media ([^{]+)\{ (.+?) \} \} /);
  const outside = css.replace(defaultRule, '').replace(mediaBlock?.[0] ?? '', '').trim();
  const outsideRules = outside.match(/[^{}]+\{[^{}]*\}/g) ?? [];
  const byAttrOk = outsideRules.length > 0 && outsideRules.every((r) => r.trim().split(', ').every((sel) => sel.trim().startsWith(`html[${INSTALLED_ATTR}]`)));
  check('H1 every hiding or showing rule is inside the installed-window media query or behind the installed attribute; the only unguarded rule HIDES the footer (a tab matches neither)',
    css.startsWith(defaultRule) && !!mediaBlock && byAttrOk && !/\bbrowser\b/.test(css), css);
  check('H2 the media query lists exactly the installed display modes the script also tests, never "browser"',
    mediaBlock?.[1].trim() === INSTALLED_DISPLAY_MODES.map((m) => `(display-mode: ${m})`).join(', ')
    && !(INSTALLED_DISPLAY_MODES as readonly string[]).includes('browser')
    && /INSTALLED_DISPLAY_MODES\.some\(\(m\) => window\.matchMedia/.test(client));
  check('H3 it hides the website header (the navbar root carries the attribute it targets) and whatever a page marks',
    (INSTALLED_HIDDEN_SELECTORS as readonly string[]).includes('nav[data-fmp-nav]')
    && /<nav\s+data-fmp-nav/.test(src('src/shared/components/layout/Navbar.tsx'))
    && (INSTALLED_HIDDEN_SELECTORS as readonly string[]).includes('[data-pwa-hide]'));
  const signin = src('app/modeling/signin/SignInForm.tsx');
  const register = src('app/modeling/register/RegisterForm.tsx');
  const unmarked = (file: string, text: string, re: RegExp): string[] => {
    const lines = text.split('\n'); const bad: string[] = [];
    lines.forEach((l, i) => {
      if (!re.test(l)) return;
      const window = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
      if (!/data-pwa-hide/.test(window)) bad.push(`${file}:${i + 1}`);
    });
    return bad;
  };
  const badTraining = [...unmarked('SignInForm', signin, /training hub|LEARN_URL/i), ...unmarked('RegisterForm', register, /training hub|LEARN_URL/i)];
  check('H4 every Training Hub sign-in link and the "separate from training hub" line sit inside a hidden wrapper',
    badTraining.length === 0 && /separate from training hub/.test(signin), badTraining.join(', '));
  const badHome = [...unmarked('SignInForm', signin, /Back to Home/), ...unmarked('RegisterForm', register, /Back to Home/)];
  check('H5 "Back to Home" (the website) is hidden in the installed window too', badHome.length === 0, badHome.join(', '));
  check('H6 the hiding rule is rendered with the page (server HTML), so the header never shows for a frame',
    /<style data-installed-app-css dangerouslySetInnerHTML=\{\{ __html: installedAppCss\(\) \}\} \/>/.test(client)
    && /if \(!offline\) return installedStyle;/.test(client));
  check('H7 the window title is exactly the app name (FMP Modeling Hub; short name Modeling Hub, 12 characters, for icon labels), set ONLY in the installed window and re-asserted when Next retitles',
    APP_NAME === 'FMP Modeling Hub' && manifest.name === APP_NAME && manifest.short_name === 'Modeling Hub' && String(manifest.short_name).length <= 12
    && /if \(!isInstalledWindow\(\)\) return;\s*document\.documentElement\.setAttribute\(INSTALLED_ATTR, ''\);/.test(client)
    && /document\.title = APP_NAME/.test(client) && /new MutationObserver\(setTitle\)/.test(client));
  check('H8 the iPhone home-screen app gets the same treatment (navigator.standalone sets the attribute)',
    /navigator as Navigator & \{ standalone\?: boolean \}\)\.standalone === true/.test(client));

  const footer = src('src/hubs/modeling/components/pwa/InstalledAppFooter.tsx');
  check('H9 the app footer carries the SAME attribution as the exports and emails (imported, never retyped) and the deployed build',
    /import \{ FMP_FOOTER_BASE \} from '@\/src\/shared\/email\/templates\/_base'/.test(footer) && /\{FMP_FOOTER_BASE\}/.test(footer)
    && /VERCEL_GIT_COMMIT_SHA/.test(footer) && !/PaceMakers/.test(footer));
  check('H10 it is installed-only: marked for the installed rule, and it sets no display of its own that could show it in a tab',
    /data-installed-only/.test(footer) && !/display:\s*'/.test(footer) && css.includes(`${INSTALLED_ONLY_SELECTOR} { display: flex !important; }`));
  const layouts = ['app/modeling/layout.tsx', 'app/refm/layout.tsx', 'app/settings/layout.tsx'];
  const missing = layouts.filter((l) => !/<InstalledAppFooter \/>/.test(src(l)));
  check('H11 it is on every page of the installed app (every installed-app layout mounts it)', missing.length === 0, missing.join(', '));
  check('H12 the full-window REFM workspace gives up the footer\'s height ONLY in the installed window (the variable is unset in a tab)',
    src('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx').includes(`height: 'calc((100vh - var(${INSTALLED_FOOTER_VAR}, 0px)) / 0.8)'`)
    && !css.replace(/@media[^{]+\{ (.+?) \} \} /, '').replace(/html\[data-installed-app\][^}]*\}/g, '').includes(INSTALLED_FOOTER_VAR));

  console.log('\n=== J. The Modeling Hub confirmation email says the app exists ===');
  const { confirmEmailTemplate, MODELING_APP_SIGNIN_URL } = await import('../src/shared/email/templates/confirmEmail');
  const modelingMail = await confirmEmailTemplate({ confirmUrl: 'https://app.example/confirm?t=x', hub: 'modeling' });
  const trainingMail = await confirmEmailTemplate({ confirmUrl: 'https://learn.example/confirm?t=x', hub: 'training' });
  const m = modelingMail.html;
  check('J1 the Modeling Hub confirmation says it can be installed as an app from the browser',
    /install the Modeling Hub as an app from your browser/.test(m));
  check('J2 with the short version for Chrome on a computer, Android and iPhone',
    /install icon in the address bar/.test(m) && /Install app/.test(m) && /Share, then Add to Home Screen/.test(m));
  check('J3 it links the Modeling Hub SIGN-IN page, where the install option appears',
    MODELING_APP_SIGNIN_URL.endsWith('/signin') && m.includes(`href="${MODELING_APP_SIGNIN_URL}"`));
  check('J4 it never calls it a download', !/download/i.test(m.replace(/<[^>]+>/g, ' ')));
  check('J5 the Training Hub confirmation has none of it', !/as an app|Add to Home Screen|install/i.test(trainingMail.html));
  check('J6 the confirmation itself is unchanged: the confirm button still comes first',
    m.indexOf('https://app.example/confirm?t=x') > 0 && m.indexOf('https://app.example/confirm?t=x') < m.indexOf('as an app'));

  console.log('\n=== D. Auth stays inside the app window ===');
  const signOutFiles = ['app/modeling/dashboard/page.tsx', 'app/modeling/choose-plan/page.tsx', 'app/settings/page.tsx',
    'src/hubs/modeling/platforms/refm/components/Topbar.tsx'];
  for (const f of signOutFiles) {
    const s = src(f);
    check(`D1 ${f}: every sign-out asks for /signin, none for "/"`,
      /signOut\(\{ callbackUrl: '\/signin' \}\)/.test(s) && !/signOut\(\{ callbackUrl: '\/' \}\)/.test(s));
  }
  check('D2 the sign-in page returns to a same-origin path (router.push, redirect: false)',
    /signIn\('credentials', \{ email, password, redirect: false \}\)/.test(src('app/modeling/signin/SignInForm.tsx'))
    && /router\.push\(callbackUrl\)/.test(src('app/modeling/signin/SignInForm.tsx')));
  check('D3 the server guard redirects to a RELATIVE sign-in path', /redirect\('\/signin\?bypass=true'\)/.test(refmLayout));

  console.log('\n=== G. House rules ===');
  for (const f of ['public/sw.js', 'public/offline.html', 'app/app.webmanifest/route.ts', 'app/app-icon/[file]/route.ts',
    'src/hubs/modeling/lib/pwa/appManifest.ts', 'src/hubs/modeling/lib/pwa/appIcon.ts', 'src/shared/cms/siteFavicon.ts',
    'app/settings/layout.tsx', 'src/hubs/modeling/components/pwa/PwaClient.tsx', 'src/shared/email/templates/confirmEmail.ts',
    'src/shared/utils/connection.ts', 'scripts/generate-pwa-icons.ts']) {
    check(`G ${f} has no em dashes`, !src(f).includes('—'));
  }

  console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
  if (failed) { console.log(fails.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
})();
