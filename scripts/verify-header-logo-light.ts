/**
 * verify-header-logo-light.ts (2026-10-14)
 *
 * A DARK HEADER SHOWS THE LIGHT LOGO, AND THE HUB HOME HAS A 12PX TEXT FLOOR.
 *
 * The standard logo's dark blue lettering does not read on navy at any size,
 * so a light version lives beside it (`header_settings.logo_light_url`) and
 * every navy header shows it through ONE rule, `logoForDarkHeader`. This pins:
 *   A  the rule: light wins, the standard logo is the fallback, blank is absent
 *   B  the readers: the four navy headers go through the rule and fetch the
 *      key, a light surface (the welcome modal) does not, the admin edits it
 *   C  the hub home: no text under 12px, no CSS zoom or scale standing in for
 *      real sizes, the light logo has its own (smaller) cap
 *   D  live: the light logo is set, serves an image, and shares the standard
 *      logo's canvas, so the one height setting gives both the same size
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-header-logo-light.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { logoForDarkHeader, LOGO_LIGHT_KEY } from '../src/shared/cms/headerLogo';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };
const read = (f: string): string => readFileSync(f, 'utf8');

async function main(): Promise<void> {
  section('A. the rule');
  check('A1 light wins', logoForDarkHeader({ light: 'L', standard: 'S' }) === 'L');
  check('A2 no light: the standard logo', logoForDarkHeader({ light: '', standard: 'S' }) === 'S');
  check('A3 blank light is absent', logoForDarkHeader({ light: '   ', standard: 'S' }) === 'S');
  check('A4 null light is absent', logoForDarkHeader({ light: null, standard: 'S' }) === 'S');
  check('A5 neither: empty, so the caller keeps its own fallback', logoForDarkHeader({}) === '');
  check('A6 the key is logo_light_url', LOGO_LIGHT_KEY === 'logo_light_url');

  section('B. the readers');
  const DARK_HEADERS = [
    'src/shared/components/layout/NavbarServer.tsx',
    'src/hubs/training/components/TrainingShell.tsx',
    'app/training/dashboard/page.tsx',
    'app/modeling/dashboard/page.tsx',
  ];
  for (const f of DARK_HEADERS) {
    const s = read(f);
    check(`B1 ${f} goes through logoForDarkHeader`, /logoForDarkHeader\(/.test(s));
    check(`B2 ${f} reads the light key`, /logo_light_url|LOGO_LIGHT_KEY/.test(s));
  }
  check('B3 the white welcome modal keeps the standard logo',
    !/logoForDarkHeader|logo_light_url/.test(read('src/hubs/training/components/WelcomeModal.tsx')));
  const admin = read('app/admin/header-settings/page.tsx');
  check('B4 the admin page saves the key', /'logo_light_url'/.test(admin.slice(admin.indexOf('const KEYS'), admin.indexOf('] as const'))));
  check('B5 the admin page offers an upload for it', /onSelect=\{url => set\('logo_light_url', url\)\}/.test(admin));

  section('C. the hub home');
  const hub = read('app/modeling/dashboard/page.tsx');
  const sizes = [...hub.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)\b/g)].map((m) => Number(m[1]));
  const small = sizes.filter((n) => n < 12);
  check('C0 font sizes found', sizes.length > 20, String(sizes.length));
  check('C1 no text under 12px', small.length === 0, small.join(', '));
  check('C2 no CSS zoom or scale stands in for real sizes', !/\bzoom\s*:|scale\(/.test(hub));
  const cap = Number(/const HUB_LOGO_LIGHT_MAX_H = (\d+);/.exec(hub)?.[1]);
  const capStd = Number(/const HUB_LOGO_MAX_H = (\d+);/.exec(hub)?.[1]);
  check('C3 the light logo has its own cap, below the standard one', cap > 0 && cap < capStd, `${cap} vs ${capStd}`);
  check('C4 the cap is chosen by which logo is shown', /const cap = light \? HUB_LOGO_LIGHT_MAX_H : HUB_LOGO_MAX_H;/.test(hub));

  section('D. live');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  check('D0 credentials loaded', Boolean(url && key));
  if (url && key) {
    const sb = createClient(url, key);
    const { data } = await sb.from('cms_content').select('key, value').eq('section', 'header_settings').in('key', ['logo_url', LOGO_LIGHT_KEY]);
    const map = Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    check('D1 the light logo is set', Boolean(map[LOGO_LIGHT_KEY]?.trim()));
    if (map[LOGO_LIGHT_KEY] && map.logo_url) {
      const [l, s] = await Promise.all([map[LOGO_LIGHT_KEY], map.logo_url].map(async (u) => {
        const r = await fetch(u);
        return { ok: r.ok, type: r.headers.get('content-type') ?? '', meta: r.ok ? await sharp(Buffer.from(await r.arrayBuffer())).metadata() : null };
      }));
      check('D2 the light logo serves an image', l.ok && l.type.startsWith('image/'), l.type);
      check('D3 it shares the standard logo canvas', l.meta?.width === s.meta?.width && l.meta?.height === s.meta?.height,
        `${l.meta?.width}x${l.meta?.height} vs ${s.meta?.width}x${s.meta?.height}`);
      check('D4 it has transparency (sits on any dark header)', Boolean(l.meta?.hasAlpha));
    }
  }

  console.log(`\nverify-header-logo-light: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
