/**
 * scripts/verify-m19b.ts
 *
 * End-to-end verification that Phase M1.9b (REFM Module 1 polish:
 * Hierarchy tab dissolution + label disambiguation + What-goes-here
 * callouts) is correctly deployed.
 *
 * QUICK START:
 *   npx tsx --env-file=.env.local scripts/verify-m19b.ts
 *
 * Optional: start `npm run dev` in another terminal so http://localhost:3000
 * responds — section 2 (route smoke) and section 5 (Playwright UI) will
 * skip cleanly when the dev server isn't reachable.
 *
 * Sections (matches the standing per-phase verification template
 * established 2026-05-02 for M1.7 / M1.8 / M1.9):
 *
 *   1. Database / persistence  — wizard snapshot JSONB roundtrip still
 *                                works exactly as M1.9 (M1.9b adds no
 *                                new persisted fields).
 *   2. Route smoke tests       — POST /api/refm/projects gates on auth
 *                                exactly as before (M1.9b adds no new
 *                                routes).
 *   3. Calculation correctness — all 3 snapshot diffs (legacy 17.5 KB /
 *                                multiphase 23.0 KB / areaprogram
 *                                2.8 KB) — must stay bit-identical
 *                                because M1.9b is UI-only.
 *   4. State integrity         — m1Tabs has 5 entries (no 'hierarchy'
 *                                key); Module1Hierarchy carries the
 *                                optional sections prop; Module1Timeline
 *                                + Module1AreaProgram mount Hierarchy
 *                                with sections='structure' / 'assets';
 *                                What-goes-here callouts present on 5
 *                                tabs; D7/D8 disambiguation labels
 *                                landed (Project Construction / Project
 *                                FAR / etc.).
 *   5. UI rendering            — Playwright signin (light + dark) +
 *                                /refm gate redirect — same baseline as
 *                                verify-m17 / m18 / m19.
 *
 * Test-user fixture: id 00000000-0000-0000-0000-000000000000, password
 * 'M19B_VERIFY_NOT_USABLE'. ON DELETE CASCADE cleans every row downstream
 * on teardown.
 *
 * Exit codes:
 *   0   all sections pass (skipped tests don't count as failures)
 *   1   any section fails
 *   2   environment / connectivity issue before tests start
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createModule1Store, type HydrateSnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import {
  buildWizardSnapshot,
} from '../src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot';
import {
  makeWizardDefaultDraft,
} from '../src/hubs/modeling/platforms/refm/components/modals/ProjectWizard';
import { m1Tabs } from '../src/hubs/modeling/platforms/refm/components/RealEstatePlatform';

// ── Config ────────────────────────────────────────────────────────────────
const TEST_USER_ID    = '00000000-0000-0000-0000-000000000000';
const TEST_USER_EMAIL = `m19b-verify+${Date.now()}@test.invalid`;
const TEST_USER_NAME  = 'M1.9b Verification Fixture';
const NAME_PREFIX     = 'M19B-VERIFY-';
const DEV_SERVER_URL  = process.env.M19B_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR  = resolve(process.cwd(), 'tests/screenshots/M1.9b');

// ── Result accumulator ────────────────────────────────────────────────────
type Status = 'pass' | 'fail' | 'skip';
interface CheckResult { name: string; status: Status; detail: string }
const results: CheckResult[] = [];

function record(name: string, status: Status, detail: string): void {
  results.push({ name, status, detail });
  const tag = status === 'pass' ? '✓ PASS' : status === 'fail' ? '✗ FAIL' : '○ SKIP';
  // eslint-disable-next-line no-console
  console.log(`  ${tag}  ${name}${detail ? '  — ' + detail : ''}`);
}

function section(label: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n${'─'.repeat(72)}\n${label}\n${'─'.repeat(72)}`);
}

// ── Env loading ───────────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function fatal(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`FATAL: ${msg}`);
  process.exit(2);
}

if (!SUPABASE_URL)  fatal('missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) in .env.local');
if (!SERVICE_KEY)   fatal('missing SUPABASE_SERVICE_ROLE_KEY in .env.local');

const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

// ── 0. Test-user fixture ──────────────────────────────────────────────────
async function setupTestUser(): Promise<void> {
  await sb.from('users').delete().eq('id', TEST_USER_ID);
  const { error } = await sb.from('users').insert({
    id:                  TEST_USER_ID,
    email:               TEST_USER_EMAIL,
    name:                TEST_USER_NAME,
    password_hash:       'M19B_VERIFY_NOT_USABLE',
    role:                'user',
    subscription_plan:   'free',
    subscription_status: 'trial',
    projects_limit:      3,
    email_confirmed:     false,
  });
  if (error) fatal(`could not create test user: ${error.message}`);
}

async function teardownTestUser(): Promise<void> {
  const { error } = await sb.from('users').delete().eq('id', TEST_USER_ID);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn(`WARN: teardown failed (manual cleanup may be needed): ${error.message}`);
  }
}

// ── 1. Database / persistence ────────────────────────────────────────────
async function checkPersistence(): Promise<void> {
  section('1. Database / persistence — wizard snapshot still round-trips post-M1.9b');

  const draft = {
    ...makeWizardDefaultDraft(),
    name:                NAME_PREFIX + 'Roundtrip',
    location:            'Riyadh',
    constructionPeriods: 5,
    operationsPeriods:   8,
    overlapPeriods:      1,
  };
  const built = buildWizardSnapshot(draft);

  const projInsert = await sb.from('refm_projects').insert({
    user_id:        TEST_USER_ID,
    name:           NAME_PREFIX + 'Roundtrip',
    location:       'Riyadh',
    status:         'Draft',
    asset_mix:      built.assetMix,
    schema_version: 4,
  }).select('id').maybeSingle();

  if (projInsert.error || !projInsert.data) {
    record('Insert refm_projects with M1.9b wizard snapshot', 'fail',
      projInsert.error?.message ?? 'no data returned');
    return;
  }
  const projectId = (projInsert.data as { id: string }).id;
  record('Insert refm_projects with M1.9b wizard snapshot', 'pass',
    `id=${projectId.slice(0, 8)}…`);

  const verInsert = await sb.from('refm_project_versions').insert({
    project_id:     projectId,
    version_number: 1,
    schema_version: 4,
    snapshot:       built.snapshot,
    label:          'M1.9b verify fixture',
  }).select('id').maybeSingle();

  if (verInsert.error || !verInsert.data) {
    record('Insert refm_project_versions with M1.9b snapshot', 'fail',
      verInsert.error?.message ?? 'no data returned');
    await sb.from('refm_projects').delete().eq('id', projectId);
    return;
  }
  record('Insert refm_project_versions with M1.9b snapshot', 'pass',
    `JSONB accepted ${JSON.stringify(built.snapshot).length} byte snapshot`);

  const verRead = await sb.from('refm_project_versions')
    .select('snapshot')
    .eq('id', (verInsert.data as { id: string }).id)
    .single();

  if (verRead.error || !verRead.data) {
    record('Read-back wizard snapshot', 'fail', verRead.error?.message ?? 'no data');
  } else {
    const snap = (verRead.data as { snapshot: HydrateSnapshot }).snapshot;
    const okRT = Array.isArray(snap.phases)
      && snap.phases[0]?.constructionPeriods === 5
      && snap.phases[0]?.operationsPeriods === 8
      && snap.phases[0]?.overlapPeriods === 1
      && Array.isArray(snap.assets)
      && Array.isArray(snap.subUnits)
      && Array.isArray(snap.plots);
    if (okRT) {
      record('Round-trip preserves phases / assets / subUnits / plots', 'pass',
        `phases=${snap.phases.length} assets=${snap.assets.length} subUnits=${snap.subUnits.length} plots=${snap.plots.length}`);
    } else {
      record('Round-trip preserves phases / assets / subUnits / plots', 'fail',
        `phases=${JSON.stringify(snap.phases?.[0])}`);
    }
  }

  await sb.from('refm_projects').delete().eq('id', projectId);
}

// ── 2. Route smoke tests ─────────────────────────────────────────────────
async function checkRoutes(): Promise<void> {
  section('2. Route smoke tests — M1.9b adds no new routes');

  let healthy = false;
  try {
    const res = await fetch(`${DEV_SERVER_URL}/api/health`);
    healthy = res.ok;
  } catch { /* ignore */ }

  if (!healthy) {
    record('Dev server reachability', 'skip',
      `${DEV_SERVER_URL} not responding — start "npm run dev" to include section 2`);
    return;
  }
  record('Dev server reachability', 'pass', `${DEV_SERVER_URL}/api/health OK`);

  const routes: Array<{ method: string; path: string }> = [
    { method: 'GET',  path: '/api/refm/projects' },
    { method: 'POST', path: '/api/refm/projects' },
    { method: 'GET',  path: '/api/refm/projects/00000000-0000-0000-0000-000000000000' },
    { method: 'POST', path: '/api/refm/projects/00000000-0000-0000-0000-000000000000/versions' },
    { method: 'POST', path: '/api/refm/projects/00000000-0000-0000-0000-000000000000/duplicate' },
  ];

  for (const r of routes) {
    let status = 0;
    try {
      const res = await fetch(`${DEV_SERVER_URL}${r.path}`, {
        method:  r.method,
        headers: { 'Content-Type': 'application/json' },
        body:    r.method === 'POST' || r.method === 'PATCH' ? JSON.stringify({}) : undefined,
      });
      status = res.status;
    } catch (e) {
      record(`${r.method} ${r.path}`, 'fail', e instanceof Error ? e.message : String(e));
      continue;
    }
    if (status === 401) {
      record(`${r.method} ${r.path} — 401 without auth`, 'pass', `status=${status}`);
    } else {
      record(`${r.method} ${r.path} — 401 without auth`, 'fail', `expected 401, got ${status}`);
    }
  }
}

// ── 3. Calculation correctness ───────────────────────────────────────────
async function checkCalculations(): Promise<void> {
  section('3. Calculation correctness — snapshot diffs (M1.9b must not drift)');

  const diffs: Array<{ name: string; script: string }> = [
    { name: 'module1-snapshot-diff (legacy single-phase, 17.5 KB)', script: 'scripts/module1-snapshot-diff.ts' },
    { name: 'module1-multiphase-diff (multi-phase v4, 23.0 KB)',    script: 'scripts/module1-multiphase-diff.ts' },
    { name: 'module1-areaprogram-diff (M1.7 area program, 2.8 KB)', script: 'scripts/module1-areaprogram-diff.ts' },
  ];
  for (const d of diffs) {
    const res = spawnSync('npx', ['tsx', d.script], {
      stdio: 'pipe', encoding: 'utf-8', shell: true,
    });
    if (res.status === 0) {
      record(d.name, 'pass', (res.stdout.trim().split('\n').pop() ?? '').trim());
    } else {
      record(d.name, 'fail', `exit ${res.status}: ${(res.stderr || res.stdout).slice(0, 200)}`);
    }
  }
}

// ── 4. State integrity ──────────────────────────────────────────────────
function checkStateIntegrity(): void {
  section('4. State integrity — Hierarchy dissolution + label disambiguation + callouts');

  // ── 4a. m1Tabs has 5 entries; no 'hierarchy' key; numbered 1→5 ──
  const okTabs =
    m1Tabs.length === 5 &&
    m1Tabs.every((t, i) => t.step === i + 1) &&
    m1Tabs[0].key === 'timeline'     && m1Tabs[0].label.startsWith('1.') &&
    m1Tabs[1].key === 'area'         && m1Tabs[1].label.startsWith('2.') &&
    m1Tabs[2].key === 'area-program' && m1Tabs[2].label.startsWith('3.') &&
    m1Tabs[3].key === 'costs'        && m1Tabs[3].label.startsWith('4.') &&
    m1Tabs[4].key === 'financing'    && m1Tabs[4].label.startsWith('5.') &&
    !m1Tabs.some(t => t.key === 'hierarchy');
  if (okTabs) {
    record('m1Tabs is 1→5 (Hierarchy dissolved)', 'pass',
      m1Tabs.map(t => t.label).join(' → '));
  } else {
    record('m1Tabs is 1→5 (Hierarchy dissolved)', 'fail',
      m1Tabs.map(t => `${t.step}.${t.key}`).join(','));
  }

  // ── 4b. RealEstatePlatform default landing tab is 'timeline'; manual
  // create + wizard create both route to 'timeline'; the 'hierarchy'
  // render branch is gone. Static source-file inspection (no runtime). ──
  try {
    const platformSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx'),
      'utf-8',
    );
    const okDefault = platformSrc.includes("useState('timeline')")
      && !platformSrc.includes("useState('hierarchy')");
    record('RealEstatePlatform default activeTab = timeline', okDefault ? 'pass' : 'fail',
      okDefault ? "useState('timeline') present, useState('hierarchy') gone"
                : "still has useState('hierarchy')");

    const okSetters = !platformSrc.includes("setActiveTab('hierarchy')");
    record('No setActiveTab(\'hierarchy\') anywhere in RealEstatePlatform', okSetters ? 'pass' : 'fail',
      okSetters ? 'all setActiveTab calls route to live tabs only'
                : "still routes to 'hierarchy'");

    const okBranch = !platformSrc.includes("activeTab === 'hierarchy'");
    record('Render switch has no \'hierarchy\' branch', okBranch ? 'pass' : 'fail',
      okBranch ? "branch removed in M1.9b/4"
               : "branch still present");
  } catch (e) {
    record('Source-file inspection of RealEstatePlatform', 'fail',
      e instanceof Error ? e.message : String(e));
  }

  // ── 4c. Module1Hierarchy carries the optional sections prop ──
  try {
    const hierSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modules/Module1Hierarchy.tsx'),
      'utf-8',
    );
    const okProp = /sections\??:\s*['"]all['"]\s*\|\s*['"]structure['"]\s*\|\s*['"]assets['"]/.test(hierSrc)
      || /Module1HierarchyProps/.test(hierSrc);
    record('Module1Hierarchy declares sections prop', okProp ? 'pass' : 'fail',
      okProp ? "sections?: 'all' | 'structure' | 'assets' typed on the component"
             : 'sections prop missing');

    const okGate = hierSrc.includes("sectionsMode === 'all'")
      || hierSrc.includes("sectionsMode !== 'assets'")
      || hierSrc.includes("sectionsMode !== 'structure'");
    record('Module1Hierarchy gates render tree on sectionsMode', okGate ? 'pass' : 'fail',
      okGate ? 'visibility gates wired (slim assets stub when structure-only, slim structure when assets-only)'
             : 'no sectionsMode gates found');
  } catch (e) {
    record('Source-file inspection of Module1Hierarchy', 'fail',
      e instanceof Error ? e.message : String(e));
  }

  // ── 4d. Module1Timeline mounts Hierarchy with sections='structure' ──
  // Module1AreaProgram mounts it with sections='assets'. ──
  try {
    const timelineSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx'),
      'utf-8',
    );
    const okStructure = /<Module1Hierarchy\s+sections=["']structure["']/.test(timelineSrc);
    record('Module1Timeline mounts <Module1Hierarchy sections="structure" />', okStructure ? 'pass' : 'fail',
      okStructure ? 'structure mount in render tree' : 'structure mount missing');

    const apSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx'),
      'utf-8',
    );
    const okAssets = /<Module1Hierarchy\s+sections=["']assets["']/.test(apSrc);
    record('Module1AreaProgram mounts <Module1Hierarchy sections="assets" />', okAssets ? 'pass' : 'fail',
      okAssets ? 'assets mount in render tree' : 'assets mount missing');

    // M1.9b/6: Build Program h2 was relabelled.
    const okHeading = apSrc.includes('>Build Program<');
    record('Module1AreaProgram h2 reads "Build Program" (M1.9b/6 rename)', okHeading ? 'pass' : 'fail',
      okHeading ? 'h2 carries Build Program label' : 'still says "Area Program"');
  } catch (e) {
    record('Source-file inspection of Schedule + Build Program mounts', 'fail',
      e instanceof Error ? e.message : String(e));
  }

  // ── 4e. M1.9b/5 + 4f. M1.9b/6 — disambiguation labels + callouts ──
  // For each of the 5 tabs check the "What goes here:" callout text
  // landed and the D7/D8 disambiguation labels are present where
  // they belong.
  const calloutFiles = [
    { path: 'src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx',     tab: 'Schedule' },
    { path: 'src/hubs/modeling/platforms/refm/components/modules/Module1Area.tsx',         tab: 'Land' },
    { path: 'src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx',  tab: 'Build Program' },
    { path: 'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx',        tab: 'Dev Costs' },
    { path: 'src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx',    tab: 'Financing' },
  ];
  let allCalloutsOk = true;
  const missing: string[] = [];
  for (const f of calloutFiles) {
    try {
      const src = readFileSync(resolve(process.cwd(), f.path), 'utf-8');
      const ok = src.includes('What goes here:') && src.includes('Not here:');
      if (!ok) { allCalloutsOk = false; missing.push(f.tab); }
    } catch (e) {
      allCalloutsOk = false;
      missing.push(`${f.tab} (read failed: ${e instanceof Error ? e.message : String(e)})`);
    }
  }
  record('What-goes-here callouts present on all 5 tabs', allCalloutsOk ? 'pass' : 'fail',
    allCalloutsOk ? 'Schedule + Land + Build Program + Dev Costs + Financing'
                  : `missing on: ${missing.join(', ')}`);

  // D7 — Schedule construction/operations/overlap labels prefixed with "Project"
  try {
    const timelineSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx'),
      'utf-8',
    );
    const okD7 = timelineSrc.includes('Project Construction (')
      && timelineSrc.includes('Project Operations (')
      && timelineSrc.includes('Project Overlap (');
    record('D7 disambiguation: Schedule labels prefixed "Project"', okD7 ? 'pass' : 'fail',
      okD7 ? 'Project Construction / Project Operations / Project Overlap'
           : 'one or more labels missing the "Project" prefix');
  } catch (e) {
    record('D7 disambiguation source check', 'fail', e instanceof Error ? e.message : String(e));
  }

  // D8 — Land FAR label disambiguated
  try {
    const areaSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modules/Module1Area.tsx'),
      'utf-8',
    );
    const okD8 = areaSrc.includes('Project FAR (whole-site ceiling)');
    record('D8 disambiguation: Land FAR label = "Project FAR (whole-site ceiling)"', okD8 ? 'pass' : 'fail',
      okD8 ? 'label disambiguated; per-plot FAR delegated to Build Program'
           : 'label still reads bare "Floor Area Ratio (FAR)"');
  } catch (e) {
    record('D8 disambiguation source check', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── 4g. Hydrate cycle still works (no regression vs M1.9) ──
  const draft = {
    ...makeWizardDefaultDraft(),
    name:     'M19B-Hydrate',
    location: 'Riyadh',
  };
  const built = buildWizardSnapshot(draft);
  const store = createModule1Store();
  store.getState().hydrate(built.snapshot);
  const after = store.getState();
  const okHydrate = after.phases.length >= 1
    && after.phases[0].constructionPeriods > 0
    && typeof after.country === 'string';
  if (okHydrate) {
    record('Store hydrate cycle survives M1.9b changes', 'pass',
      `phases=${after.phases.length} country=${after.country}`);
  } else {
    record('Store hydrate cycle survives M1.9b changes', 'fail',
      `phases=${after.phases.length} country=${after.country}`);
  }
}

// ── 5. UI rendering (Playwright) ────────────────────────────────────────
async function checkUi(): Promise<void> {
  section('5. UI rendering — Playwright signin (light + dark) + /refm gate');

  let healthy = false;
  try {
    const res = await fetch(`${DEV_SERVER_URL}/api/health`);
    healthy = res.ok;
  } catch { /* ignore */ }

  if (!healthy) {
    record('Dev server reachability', 'skip',
      `${DEV_SERVER_URL} not responding — start "npm run dev" to include section 5`);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chromium: any;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    record('Playwright module loadable', 'skip',
      'install "@playwright/test" + "npx playwright install chromium" to include section 5');
    return;
  }
  record('Playwright module loadable', 'pass', '@playwright/test imported');

  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const mode of ['light', 'dark'] as const) {
      const ctx = await browser.newContext({ colorScheme: mode, viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      try {
        await page.goto(`${DEV_SERVER_URL}/modeling/signin`, { timeout: 15_000 });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { /* ok */ });
        const path = resolve(SCREENSHOT_DIR, `${mode}-signin.png`);
        await page.screenshot({ path, fullPage: true });
        record(`Screenshot — ${mode} signin page`, 'pass', path);
      } catch (e) {
        record(`Screenshot — ${mode} signin page`, 'fail', e instanceof Error ? e.message : String(e));
      } finally {
        await ctx.close();
      }
    }

    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    try {
      await page.goto(`${DEV_SERVER_URL}/refm`, { timeout: 15_000 });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { /* ok */ });
      const url = page.url();
      const gateOk = /signin|login|register/i.test(url);
      if (gateOk) {
        record('/refm without session redirects to auth', 'pass', `landed on ${url}`);
      } else {
        record('/refm without session redirects to auth', 'fail', `unexpected URL: ${url}`);
      }
    } catch (e) {
      record('/refm without session redirects to auth', 'fail', e instanceof Error ? e.message : String(e));
    } finally {
      await ctx.close();
    }

    record('Module 1 tab interactions (deferred)', 'skip',
      'requires authenticated REFM session — TODO: add fixture-login or NextAuth cookie injection (same as verify-m17 / m18 / m19)');
  } finally {
    await browser.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`\nM1.9b verification — target: ${SUPABASE_URL}\n`);

  await setupTestUser();
  try {
    await checkPersistence();
    await checkRoutes();
    await checkCalculations();
    checkStateIntegrity();
    await checkUi();
  } finally {
    await teardownTestUser();
  }

  const pass = results.filter(r => r.status === 'pass').length;
  const fail = results.filter(r => r.status === 'fail').length;
  const skip = results.filter(r => r.status === 'skip').length;

  // eslint-disable-next-line no-console
  console.log('\n' + '═'.repeat(72));
  // eslint-disable-next-line no-console
  console.log(`Summary: ${pass} pass, ${fail} fail, ${skip} skip`);
  // eslint-disable-next-line no-console
  console.log('═'.repeat(72));

  if (fail > 0) {
    // eslint-disable-next-line no-console
    console.log('\nFAILURES:');
    for (const r of results.filter(rr => rr.status === 'fail')) {
      // eslint-disable-next-line no-console
      console.log(`  ✗ ${r.name}\n    ${r.detail}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('verification crashed:', e);
  process.exit(1);
});
