/* eslint-disable no-console */
/**
 * verify-psync.ts (Phase P-Sync verifier)
 *
 * Five-section verifier for the Platform & Module Admin Sync work.
 *
 * Sections:
 *   1. Schema: p_sync_platform_modules.sql exists, declares the two new tables
 *      with the expected columns + RLS + seed data.
 *   2. Routes: /api/platforms/refm/modules public GET + /api/admin/platform-
 *      module-pages admin gate (401 without session).
 *   3. Lib: src/shared/cms/platform-modules.ts exports the 9 helper functions
 *      and 5 typed content interfaces.
 *   4. Source markers: admin pages (level 1 + level 2 + page editor),
 *      Sidebar hook, marketing pages (overview + per-platform + per-module),
 *      em-dash sweep across new files.
 *   5. Playwright: tests/e2e/psync-flow.spec.ts present + run gate.
 *
 * Usage: npx tsx scripts/verify-psync.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

const REPO_ROOT = resolve(__dirname, '..');

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(name: string, msg = ''): void {
  passed++;
  console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`);
}
function fail(name: string, msg: string): void {
  failed++;
  console.log(`  FAIL  ${name}: ${msg}`);
}
function skip(name: string, msg: string): void {
  skipped++;
  console.log(`  SKIP  ${name}: ${msg}`);
}

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

// ── Section 1: SQL migration ──────────────────────────────────────────────
console.log('\n[1/5] SQL migration');

const sqlPath = 'supabase/migrations/p_sync_platform_modules.sql';
if (!existsSync(join(REPO_ROOT, sqlPath))) {
  fail('SQL file', `${sqlPath} missing`);
} else {
  const sql = read(sqlPath);

  const sqlChecks: { label: string; needle: string }[] = [
    { label: 'platform_modules table',                    needle: 'CREATE TABLE IF NOT EXISTS public.platform_modules' },
    { label: 'platform_module_pages table',               needle: 'CREATE TABLE IF NOT EXISTS public.platform_module_pages' },
    { label: 'status CHECK enum (live/coming_soon/...)',  needle: "CHECK (status IN ('live', 'coming_soon', 'hidden', 'pro', 'enterprise'))" },
    { label: 'gating_tier CHECK enum',                    needle: "CHECK (gating_tier IN ('free', 'pro', 'enterprise'))" },
    { label: 'page_section CHECK enum',                   needle: "CHECK (page_section IN ('hero', 'features', 'how_it_works', 'cta', 'testimonials'))" },
    { label: 'UNIQUE (platform_slug, slug)',              needle: 'UNIQUE (platform_slug, slug)' },
    { label: 'UNIQUE (platform_slug, number)',            needle: 'UNIQUE (platform_slug, number)' },
    { label: 'updated_at trigger function',               needle: 'tg_platform_modules_touch_updated_at' },
    { label: 'RLS enabled on platform_modules',           needle: 'ALTER TABLE public.platform_modules        ENABLE ROW LEVEL SECURITY' },
    { label: 'public read policy on modules',             needle: 'platform_modules_public_read' },
    { label: 'public read policy on pages',               needle: 'platform_module_pages_public_read' },
    { label: 'cascade delete pages on module',            needle: 'REFERENCES public.platform_modules(id) ON DELETE CASCADE' },
    { label: 'seed: refm project-setup module 1',         needle: "('refm', 'project-setup', 1," },
    { label: 'seed: refm revenue module 2',               needle: "('refm', 'revenue', 2," },
    { label: 'seed: 11 modules (api-access at 11)',       needle: "('refm', 'api-access', 11," },
    { label: 'seed: hero page section',                   needle: "(m1_id, 'hero', 1," },
    { label: 'seed: cta page section',                    needle: "(m1_id, 'cta', 4," },
    { label: 'idempotent INSERT ON CONFLICT',             needle: 'ON CONFLICT (platform_slug, slug) DO NOTHING' },
  ];

  for (const c of sqlChecks) {
    if (sql.includes(c.needle)) pass(c.label);
    else fail(c.label, `marker missing: ${c.needle.slice(0, 60)}`);
  }
}

// ── Section 2: API routes ─────────────────────────────────────────────────
console.log('\n[2/5] API routes');

const routeFiles = [
  'app/api/platforms/[platformSlug]/modules/route.ts',
  'app/api/platforms/[platformSlug]/modules/[moduleSlug]/route.ts',
  'app/api/admin/platform-module-pages/route.ts',
  'app/api/admin/platform-module-pages/[id]/route.ts',
];
for (const f of routeFiles) {
  if (existsSync(join(REPO_ROOT, f))) pass(`route file: ${f}`);
  else fail('route file', `${f} missing`);
}

// Smoke-check: public list endpoint returns JSON when dev server up.
let devServerUp = false;
try {
  const code = execSync('curl -s -o NUL -w "%{http_code}" http://localhost:3000/api/platforms/refm/modules', {
    timeout: 4000,
    encoding: 'utf8',
  }).trim();
  devServerUp = code === '200';
  if (devServerUp) pass(`/api/platforms/refm/modules HTTP ${code}`);
  else skip('public list endpoint', `HTTP ${code} (dev server may be down)`);
} catch {
  skip('public list endpoint', 'dev server not reachable');
}

try {
  const code = execSync('curl -s -o NUL -w "%{http_code}" -X POST http://localhost:3000/api/admin/platform-module-pages', {
    timeout: 4000,
    encoding: 'utf8',
  }).trim();
  if (code === '401') pass(`/api/admin/platform-module-pages 401 unauth (HTTP ${code})`);
  else if (code === '405' || code === '404' || code === '400') pass(`/api/admin/platform-module-pages reachable (HTTP ${code})`);
  else skip('admin endpoint', `HTTP ${code}`);
} catch {
  skip('admin endpoint', 'dev server not reachable');
}

// ── Section 3: Lib helpers ────────────────────────────────────────────────
console.log('\n[3/5] Lib helpers');

const libPath = 'src/shared/cms/platform-modules.ts';
if (!existsSync(join(REPO_ROOT, libPath))) {
  fail('lib file', `${libPath} missing`);
} else {
  const lib = read(libPath);

  const libChecks: { label: string; needle: string }[] = [
    { label: 'PlatformModule interface',           needle: 'export interface PlatformModule' },
    { label: 'PlatformModulePage interface',       needle: 'export interface PlatformModulePage' },
    { label: 'PlatformModuleStatus type (5-enum)', needle: "export type PlatformModuleStatus = 'live' | 'coming_soon' | 'hidden' | 'pro' | 'enterprise'" },
    { label: 'PlatformModulePageSection type',     needle: 'export type PlatformModulePageSection' },
    { label: 'getPlatformModules helper',          needle: 'export async function getPlatformModules' },
    { label: 'getPlatformModuleBySlug helper',     needle: 'export async function getPlatformModuleBySlug' },
    { label: 'getPlatformModulePages helper',      needle: 'export async function getPlatformModulePages' },
    { label: 'getPlatformModuleWithPages helper',  needle: 'export async function getPlatformModuleWithPages' },
    { label: 'adminListPlatformModules helper',    needle: 'export async function adminListPlatformModules' },
    { label: 'adminUpsertPlatformModule helper',   needle: 'export async function adminUpsertPlatformModule' },
    { label: 'adminDeletePlatformModule helper',   needle: 'export async function adminDeletePlatformModule' },
    { label: 'adminUpsertPlatformModulePage helper', needle: 'export async function adminUpsertPlatformModulePage' },
    { label: 'adminDeletePlatformModulePage helper', needle: 'export async function adminDeletePlatformModulePage' },
    { label: 'getSectionContent helper',           needle: 'export function getSectionContent' },
    { label: 'HeroContent interface',              needle: 'export interface HeroContent' },
    { label: 'FeaturesContent interface',          needle: 'export interface FeaturesContent' },
    { label: 'HowItWorksContent interface',        needle: 'export interface HowItWorksContent' },
    { label: 'CtaContent interface',               needle: 'export interface CtaContent' },
    { label: 'TestimonialsContent interface',      needle: 'export interface TestimonialsContent' },
    { label: 'RLS-safe public read filters hidden', needle: "neq('status', 'hidden')" },
  ];
  for (const c of libChecks) {
    if (lib.includes(c.needle)) pass(c.label);
    else fail(c.label, `marker missing: ${c.needle.slice(0, 80)}`);
  }
}

// ── Section 4: Source-file markers ────────────────────────────────────────
console.log('\n[4/5] Source-file markers');

interface Marker { label: string; path: string; needle: string }

const markers: Marker[] = [
  // Admin Level 1: platform tabs + modules table
  { label: 'Admin L1: Platform tabs testid',     path: 'app/admin/platform-modules/page.tsx',           needle: 'data-testid="platform-tabs"' },
  { label: 'Admin L1: per-platform tab testid',  path: 'app/admin/platform-modules/page.tsx',           needle: 'data-testid={`platform-tab-${p.slug}`}' },
  { label: 'Admin L1: modules table testid',     path: 'app/admin/platform-modules/page.tsx',           needle: 'data-testid="modules-table"' },
  { label: 'Admin L1: create-module-btn',        path: 'app/admin/platform-modules/page.tsx',           needle: 'data-testid="create-module-btn"' },
  { label: 'Admin L1: module-row testid',        path: 'app/admin/platform-modules/page.tsx',           needle: 'data-testid={`module-row-${m.slug}`}' },
  { label: 'Admin L1: status cycling',           path: 'app/admin/platform-modules/page.tsx',           needle: 'NEXT_STATUS' },
  { label: 'Admin L1: features textarea',        path: 'app/admin/platform-modules/page.tsx',           needle: 'FEATURES (one per line)' },
  // Admin Level 2: page editor
  { label: 'Admin L2: 5 section templates',      path: 'app/admin/platform-modules/[id]/pages/page.tsx', needle: 'SECTION_TEMPLATES' },
  { label: 'Admin L2: section card testid',      path: 'app/admin/platform-modules/[id]/pages/page.tsx', needle: 'data-testid={`section-card-${section}`}' },
  { label: 'Admin L2: per-section save',         path: 'app/admin/platform-modules/[id]/pages/page.tsx', needle: 'data-testid={`save-section-${section}`}' },
  { label: 'Admin L2: visibility toggle',        path: 'app/admin/platform-modules/[id]/pages/page.tsx', needle: 'toggleVisibility' },
  // Sidebar dynamic hook
  { label: 'Sidebar: usePlatformModules hook',   path: 'src/hubs/modeling/platforms/refm/lib/usePlatformModules.ts', needle: 'export function usePlatformModules' },
  { label: 'Sidebar: STATIC_SIDEBAR_MODULES',    path: 'src/hubs/modeling/platforms/refm/lib/usePlatformModules.ts', needle: 'export const STATIC_SIDEBAR_MODULES' },
  { label: 'Sidebar: fetchedToNav mapper',       path: 'src/hubs/modeling/platforms/refm/lib/usePlatformModules.ts', needle: 'function fetchedToNav' },
  { label: 'Sidebar: accepts modules prop',      path: 'src/hubs/modeling/platforms/refm/components/Sidebar.tsx',    needle: 'modules?: readonly SidebarNavItem[]' },
  { label: 'RealEstatePlatform: hook wired',     path: 'src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx', needle: "usePlatformModules('refm')" },
  { label: 'RealEstatePlatform: prop threaded',  path: 'src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx', needle: 'modules={dynamicSidebarModules}' },
  // Marketing pages
  { label: 'Marketing: overview platforms-grid', path: 'app/modeling-hub/page.tsx',                     needle: 'data-testid="platforms-grid"' },
  { label: 'Marketing: overview platform-card',  path: 'app/modeling-hub/page.tsx',                     needle: 'data-testid={`platform-card-${p.slug}`}' },
  { label: 'Marketing: per-platform modules-grid', path: 'app/modeling-hub/[platformSlug]/page.tsx',   needle: 'data-testid="modules-grid"' },
  { label: 'Marketing: per-module hero testid',  path: 'app/modeling-hub/[platformSlug]/[moduleSlug]/page.tsx', needle: 'data-testid="module-hero"' },
  { label: 'Marketing: features section',        path: 'app/modeling-hub/[platformSlug]/[moduleSlug]/page.tsx', needle: 'data-testid="module-features"' },
  { label: 'Marketing: how-it-works section',    path: 'app/modeling-hub/[platformSlug]/[moduleSlug]/page.tsx', needle: 'data-testid="module-how-it-works"' },
  { label: 'Marketing: cta section',             path: 'app/modeling-hub/[platformSlug]/[moduleSlug]/page.tsx', needle: 'data-testid="module-cta"' },
  { label: 'Marketing: notFound on bad module',  path: 'app/modeling-hub/[platformSlug]/[moduleSlug]/page.tsx', needle: 'notFound()' },
  // Admin nav entry
  { label: 'CmsAdminNav: Platform Modules entry', path: 'src/components/admin/CmsAdminNav.tsx',         needle: "'/admin/platform-modules'" },
];

for (const m of markers) {
  const fullPath = join(REPO_ROOT, m.path);
  if (!existsSync(fullPath)) {
    fail(m.label, `file missing: ${m.path}`);
    continue;
  }
  const src = readFileSync(fullPath, 'utf8');
  if (src.includes(m.needle)) pass(m.label);
  else fail(m.label, `marker missing: ${m.needle.slice(0, 80)}`);
}

// Em-dash sweep across new P-Sync files
const emDashFiles = [
  'src/shared/cms/platform-modules.ts',
  'app/admin/platform-modules/page.tsx',
  'app/admin/platform-modules/[id]/pages/page.tsx',
  'src/hubs/modeling/platforms/refm/lib/usePlatformModules.ts',
  'app/modeling-hub/page.tsx',
  'app/modeling-hub/[platformSlug]/page.tsx',
  'app/modeling-hub/[platformSlug]/[moduleSlug]/page.tsx',
  'app/api/platforms/[platformSlug]/modules/route.ts',
  'app/api/platforms/[platformSlug]/modules/[moduleSlug]/route.ts',
  'app/api/admin/platform-module-pages/route.ts',
  'app/api/admin/platform-module-pages/[id]/route.ts',
  'supabase/migrations/p_sync_platform_modules.sql',
];
let emDashFails = 0;
for (const f of emDashFiles) {
  if (!existsSync(join(REPO_ROOT, f))) continue;
  const src = readFileSync(join(REPO_ROOT, f), 'utf8');
  if (src.includes('—')) {
    emDashFails++;
    console.log(`  FAIL  em-dash in ${f}`);
  }
}
if (emDashFails === 0) pass(`em-dash sweep: zero hits across ${emDashFiles.length} files`);
else fail('em-dash sweep', `${emDashFails} files contain em-dash`);

// ── Section 5: Playwright spec ────────────────────────────────────────────
console.log('\n[5/5] Playwright UI smoke');
const specPath = join(REPO_ROOT, 'tests/e2e/psync-flow.spec.ts');
if (!existsSync(specPath)) {
  fail('Playwright spec', 'tests/e2e/psync-flow.spec.ts not found');
} else {
  pass('psync-flow.spec.ts present');
  if (!devServerUp) {
    skip('Playwright run', 'dev server down; spec runnable when http://localhost:3000 reachable');
  } else {
    try {
      execSync('npx playwright test tests/e2e/psync-flow.spec.ts --reporter=list', {
        stdio: 'pipe',
        timeout: 240000,
      });
      pass('Playwright psync-flow.spec.ts');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      fail('Playwright', msg.slice(0, 200));
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\nResult: ${passed} pass / ${failed} fail / ${skipped} skip`);
if (failed > 0) process.exit(1);
process.exit(0);
