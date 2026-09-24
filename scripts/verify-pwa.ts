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

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const src = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

(async () => {
  console.log('=== A. It installs, and only from the Modeling Hub ===');
  const manifest = JSON.parse(src('public/app.webmanifest') || '{}') as {
    name?: string; short_name?: string; display?: string; scope?: string; start_url?: string; id?: string;
    icons?: Array<{ src: string; sizes: string; purpose?: string }>;
  };
  check('A1 name and short name', !!manifest.name && !!manifest.short_name);
  check('A2 opens in its own window (standalone)', manifest.display === 'standalone');
  check('A3 scope and start URL are on the app origin (relative, inside the scope)',
    manifest.scope === '/' && !!manifest.start_url?.startsWith('/') && !!manifest.id?.startsWith('/'));
  const icons = manifest.icons ?? [];
  check('A4 a 192 and a 512 "any" icon and a maskable one',
    icons.some((i) => i.sizes === '192x192') && icons.some((i) => i.sizes === '512x512' && (i.purpose ?? 'any') === 'any')
    && icons.some((i) => i.purpose === 'maskable'));
  for (const i of icons) {
    const file = `public${i.src}`;
    const meta = existsSync(file) ? await sharp(file).metadata() : null;
    check(`A5 ${i.src} exists at its stated size`, !!meta && `${meta.width}x${meta.height}` === i.sizes, meta ? `${meta.width}x${meta.height}` : 'missing');
  }
  check('A6 the iOS touch icon exists', existsSync('public/pwa/apple-touch-icon.png'));
  const modelingLayout = src('app/modeling/layout.tsx');
  const refmLayout = src('app/refm/layout.tsx');
  for (const [name, l] of [['app/modeling/layout.tsx', modelingLayout], ['app/refm/layout.tsx', refmLayout]] as const) {
    check(`A7 ${name} links the manifest, the touch icon and mounts the client`,
      /manifest: '\/app\.webmanifest'/.test(l) && /rel="apple-touch-icon"/.test(l) && /<PwaClient \/>/.test(l));
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
  for (const f of ['public/sw.js', 'public/offline.html', 'public/app.webmanifest', 'src/hubs/modeling/components/pwa/PwaClient.tsx',
    'src/shared/utils/connection.ts', 'scripts/generate-pwa-icons.ts']) {
    check(`G ${f} has no em dashes`, !src(f).includes('—'));
  }

  console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
  if (failed) { console.log(fails.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
})();
