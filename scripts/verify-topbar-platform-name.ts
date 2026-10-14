/**
 * verify-topbar-platform-name.ts (2026-10-14)
 *
 * A PLATFORM'S HEADER NAMES THE PLATFORM, NOT THE COMPANY, AND CARRIES NO ICON.
 *
 * The top left of the workspace header read "Financial Modeler Pro" with an
 * icon beside it on every screen of a selected platform (Portfolio Dashboard
 * included). It now reads the selected platform's own name through ONE rule,
 * `resolvePlatformDisplayName`, taken from where the platform is already
 * defined, so a new platform needs no header change. This pins:
 *   A  the rule: the live catalog row wins, the configured name is the
 *      fallback, a slug neither knows reads as the hub, never the company
 *   B  the header: reads that rule for the slug it is given, renders no icon,
 *      names no platform itself, and is rendered once by the shell on every
 *      screen (not only inside a project)
 *   C  live: every catalog platform resolves to its own catalog name
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-topbar-platform-name.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  PLATFORMS,
  PLATFORM_NAME_FALLBACK,
  resolvePlatformDisplayName,
} from '../src/hubs/modeling/config/platforms';
import { DEFAULT_BRANDING } from '../src/core/branding';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };

const COMPANY = DEFAULT_BRANDING.platformName;

async function main(): Promise<void> {
  // ── A. the rule ───────────────────────────────────────────────────────────
  section('A. catalog wins, config falls back, unknown reads as the hub');
  {
    check('A0 there are configured platforms to test', PLATFORMS.length > 0);
    for (const p of PLATFORMS) {
      const got = resolvePlatformDisplayName(p.slug);
      check(`A1 ${p.slug}: no catalog -> its configured name`, got === p.name, got);
      check(`A2 ${p.slug}: never the company name`, got !== COMPANY, got);
    }
    const slug = PLATFORMS[0].slug;
    const renamed = `${PLATFORMS[0].name} (renamed in catalog)`;
    check('A3 a catalog row OUTRANKS the config',
      resolvePlatformDisplayName(slug, [{ slug, name: renamed }]) === renamed);
    check('A4 a catalog row for ANOTHER slug is not read',
      resolvePlatformDisplayName(slug, [{ slug: 'something-else', name: renamed }]) === PLATFORMS[0].name);
    check('A5 a blank catalog name is absent, not a name',
      resolvePlatformDisplayName(slug, [{ slug, name: '   ' }]) === PLATFORMS[0].name);
    check('A6 a null catalog name is absent',
      resolvePlatformDisplayName(slug, [{ slug, name: null }]) === PLATFORMS[0].name);
    check('A7 a slug only the catalog knows (a new platform) takes the catalog name',
      resolvePlatformDisplayName('brand-new', [{ slug: 'brand-new', name: 'Brand New Platform' }]) === 'Brand New Platform');
    const unknown = resolvePlatformDisplayName('no-such-platform', []);
    check('A8 an unknown slug reads as the hub', unknown === PLATFORM_NAME_FALLBACK, unknown);
    check('A9 the fallback is not the company name', PLATFORM_NAME_FALLBACK !== COMPANY);
  }

  // ── B. the header ─────────────────────────────────────────────────────────
  section('B. the header reads the rule, shows no icon, is on every screen');
  {
    const topbar = readFileSync('src/hubs/modeling/platforms/refm/components/Topbar.tsx', 'utf8');
    const shell = readFileSync('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx', 'utf8');
    const hook = readFileSync('src/hubs/modeling/lib/usePlatformDisplayName.ts', 'utf8');

    check('B1 the header name comes from usePlatformDisplayName(platformSlug)',
      /const displayName = usePlatformDisplayName\(platformSlug\)/.test(topbar));
    check('B2 the hook resolves through the one rule',
      /return resolvePlatformDisplayName\(slug, catalog\)/.test(hook) && !/\.name\s*\?\?/.test(hook));
    check('B3 the header no longer reads the company branding name',
      !/branding\.platformName/.test(topbar));
    const brandStart = topbar.indexOf('className="pm-brand"');
    const brandEnd = topbar.indexOf('<div className="pm-divider"', brandStart);
    const brand = brandStart >= 0 && brandEnd > brandStart ? topbar.slice(brandStart, brandEnd) : '';
    check('B4 the brand block is found', brand.length > 0);
    check('B5 the brand block renders no image and no icon',
      brand.length > 0 && !/<img|getPlatformLogo|displayLogo|🏗️/.test(brand));
    check('B6 the brand block renders the resolved name', /\{displayName\}/.test(brand));
    const named = PLATFORMS.filter((p) => topbar.includes(`'${p.name}'`) || topbar.includes(`"${p.name}"`) || topbar.includes(`>${p.name}<`));
    check('B7 the header hardcodes no platform name', named.length === 0, named.map((p) => p.slug).join(', '));
    check('B8 the header hardcodes no company name', !topbar.includes(COMPANY));
    const renders = shell.match(/<Topbar\b/g) ?? [];
    check('B9 the shell renders the header exactly once', renders.length === 1, String(renders.length));
    check('B10 the shell passes the selected platform slug',
      /<Topbar\s+platformSlug=\{REFM_PLATFORM_SLUG\}/.test(shell));
    // On every screen: the header sits at the top of the shell's return, before
    // the sidebar, so no project or module condition can wrap it.
    const topbarAt = shell.indexOf('<Topbar');
    const sidebarAt = shell.indexOf('<Sidebar', topbarAt);
    const between = shell.slice(shell.lastIndexOf('return (', topbarAt), topbarAt);
    check('B11 the header is unconditional (no project or module gate before it)',
      sidebarAt > topbarAt && !/&&\s*\(?\s*$|\?\s*\(?\s*$/.test(between.trimEnd()) && !/activeProjectId\s*&&|activeModule\s*===/.test(between));
  }

  // ── C. live catalog ───────────────────────────────────────────────────────
  section('C. every live catalog platform resolves to its own catalog name');
  {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    check('C0 credentials loaded', Boolean(url && key));
    if (url && key) {
      const sb = createClient(url, key);
      const { data, error } = await sb.from('modules').select('slug, name');
      check('C1 catalog readable', !error && Array.isArray(data) && data.length > 0, error?.message ?? '');
      const rows = (data ?? []) as { slug: string; name: string | null }[];
      for (const r of rows) {
        const got = resolvePlatformDisplayName(r.slug, rows);
        const want = (r.name ?? '').trim() || resolvePlatformDisplayName(r.slug);
        check(`C2 ${r.slug} -> ${got}`, got === want && got !== COMPANY, `want ${want}`);
      }
      const refm = rows.find((r) => r.slug === 'real-estate');
      check('C3 the Real Estate platform has a catalog name', Boolean(refm?.name?.trim()));
    }
  }

  console.log(`\nverify-topbar-platform-name: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
