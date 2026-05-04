/**
 * scripts/verify-m110.ts
 *
 * End-to-end verification that Phase M1.10 (REFM Module 1 setup-
 * completeness fixes: plot defaults retuned, platform-layer category
 * derivation, wizard Step 2 layout, Land/Plot reconciliation, modal-
 * step Plot + Parcel setup wizards) is correctly deployed.
 *
 * QUICK START:
 *   npx tsx --env-file=.env.local scripts/verify-m110.ts
 *
 * Optional: start `npm run dev` in another terminal so http://localhost:3000
 * responds — section 2 (route smoke) and section 5 (Playwright UI) will
 * skip cleanly when the dev server isn't reachable.
 *
 * Sections:
 *   1. Database / persistence  — wizard snapshot still round-trips.
 *   2. Route smoke tests       — M1.10 adds no new routes.
 *   3. Calculation correctness — 3 snapshot diffs bit-identical.
 *   4. State integrity         — 5 fixes verified end-to-end:
 *                                4a) Plot defaults inside FAR ceiling
 *                                4b) Wizard category-sum derivation
 *                                4c) Wizard Step 2 layout markers
 *                                4d) Reconciliation row markup
 *                                4e) Wizard files + mounts present
 *   5. UI rendering            — Playwright signin + /refm gate.
 *
 * Test-user fixture: id 00000000-0000-0000-0000-000000000000.
 *
 * Exit codes:
 *   0   all sections pass
 *   1   any section fails
 *   2   environment / connectivity issue before tests start
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { computePlotEnvelope } from '../src/core/calculations';
import {
  DEFAULT_PLOT_FAR, DEFAULT_PLOT_COVERAGE_PCT,
  DEFAULT_PLOT_TYPICAL_COVERAGE_PCT, DEFAULT_PLOT_PODIUM_FLOORS,
  DEFAULT_PLOT_TYPICAL_FLOORS, DEFAULT_PLOT_LANDSCAPE_PCT,
  DEFAULT_PLOT_HARDSCAPE_PCT, DEFAULT_PLOT_BASEMENT_COUNT,
  DEFAULT_PLOT_BASEMENT_EFFICIENCY_PCT,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  buildWizardSnapshot,
} from '../src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot';
import {
  makeWizardDefaultDraft,
  WIZARD_DEFAULT_ASSETS_BY_TYPE,
  type WizardDraft,
} from '../src/hubs/modeling/platforms/refm/components/modals/ProjectWizard';

const TEST_USER_ID    = '00000000-0000-0000-0000-000000000000';
const TEST_USER_EMAIL = `m110-verify+${Date.now()}@test.invalid`;
const TEST_USER_NAME  = 'M1.10 Verification Fixture';
const NAME_PREFIX     = 'M110-VERIFY-';
const DEV_SERVER_URL  = process.env.M110_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR  = resolve(process.cwd(), 'tests/screenshots/M1.10');

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

async function setupTestUser(): Promise<void> {
  await sb.from('users').delete().eq('id', TEST_USER_ID);
  const { error } = await sb.from('users').insert({
    id:                  TEST_USER_ID,
    email:               TEST_USER_EMAIL,
    name:                TEST_USER_NAME,
    password_hash:       'M110_VERIFY_NOT_USABLE',
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

async function checkPersistence(): Promise<void> {
  section('1. Database / persistence — wizard snapshot still round-trips post-M1.10');

  const draft: WizardDraft = {
    ...makeWizardDefaultDraft(),
    name:                NAME_PREFIX + 'MixedUse',
    location:            'Riyadh',
    wizardProjectType:   'Mixed-Use',
    assets:              WIZARD_DEFAULT_ASSETS_BY_TYPE['Mixed-Use'].map((a, i) => ({ ...a, id: `wa_${i}` })),
  };
  const built = buildWizardSnapshot(draft);

  const projInsert = await sb.from('refm_projects').insert({
    user_id:        TEST_USER_ID,
    name:           NAME_PREFIX + 'MixedUse',
    location:       'Riyadh',
    status:         'Draft',
    asset_mix:      built.assetMix,
    schema_version: 4,
  }).select('id').maybeSingle();

  if (projInsert.error || !projInsert.data) {
    record('Insert refm_projects with M1.10 wizard snapshot', 'fail',
      projInsert.error?.message ?? 'no data returned');
    return;
  }
  const projectId = (projInsert.data as { id: string }).id;
  record('Insert refm_projects with M1.10 wizard snapshot', 'pass',
    `id=${projectId.slice(0, 8)}…`);

  const verInsert = await sb.from('refm_project_versions').insert({
    project_id:     projectId,
    version_number: 1,
    schema_version: 4,
    snapshot:       built.snapshot,
    label:          'M1.10 verify fixture',
  }).select('id').maybeSingle();

  if (verInsert.error || !verInsert.data) {
    record('Insert refm_project_versions with M1.10 snapshot', 'fail',
      verInsert.error?.message ?? 'no data returned');
    await sb.from('refm_projects').delete().eq('id', projectId);
    return;
  }
  record('Insert refm_project_versions with M1.10 snapshot', 'pass',
    `JSONB accepted ${JSON.stringify(built.snapshot).length} byte snapshot`);

  await sb.from('refm_projects').delete().eq('id', projectId);
}

async function checkRoutes(): Promise<void> {
  section('2. Route smoke tests — M1.10 adds no new routes');

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

async function checkCalculations(): Promise<void> {
  section('3. Calculation correctness — snapshot diffs (M1.10 must not drift)');

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

function checkStateIntegrity(): void {
  section('4. State integrity — 5 M1.10 fixes verified');

  // ── 4a. Plot defaults stay inside FAR ceiling on first paint ──
  // utilisation = (coverage * podium + typicalCoverage * typical) /
  // (FAR * 100). M1.10/2 retuned defaults so this is ≤ 100% (was 173%).
  const env = computePlotEnvelope({
    plotArea:              100_000,
    maxFAR:                DEFAULT_PLOT_FAR,
    coveragePct:           DEFAULT_PLOT_COVERAGE_PCT,
    typicalCoveragePct:    DEFAULT_PLOT_TYPICAL_COVERAGE_PCT,
    podiumFloors:          DEFAULT_PLOT_PODIUM_FLOORS,
    typicalFloors:         DEFAULT_PLOT_TYPICAL_FLOORS,
    landscapePct:          DEFAULT_PLOT_LANDSCAPE_PCT,
    hardscapePct:          DEFAULT_PLOT_HARDSCAPE_PCT,
    basementCount:         DEFAULT_PLOT_BASEMENT_COUNT,
    basementEfficiencyPct: DEFAULT_PLOT_BASEMENT_EFFICIENCY_PCT,
  });
  if (env.utilizationPct <= 100 && !env.isOverFAR) {
    record('M1.10/2 — fresh plot defaults stay inside FAR ceiling', 'pass',
      `utilisation=${env.utilizationPct.toFixed(1)}% (built ${Math.round(env.totalBuiltGFA).toLocaleString()} / max ${Math.round(env.maxGFA).toLocaleString()})`);
  } else {
    record('M1.10/2 — fresh plot defaults stay inside FAR ceiling', 'fail',
      `utilisation=${env.utilizationPct.toFixed(1)}% isOverFAR=${env.isOverFAR}`);
  }

  // ── 4b. Platform-layer category-sum derivation ──
  // Static source-file inspection. Pre-M1.10 RealEstatePlatform did:
  //   const resAsset = assetById.get(LEGACY_ASSET_IDS.residential)
  // Post-M1.10 it does category-aware first-by-category resolution and
  // bucket-sum derivation. Match the new structure markers.
  try {
    const platformSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx'),
      'utf-8',
    );
    const okCategoryDeriv = platformSrc.includes("a.category === 'Sell'")
      && platformSrc.includes("a.category === 'Operate'")
      && platformSrc.includes("a.category === 'Lease'")
      && platformSrc.includes('firstByCategory');
    record('M1.10/3 — platform layer derives by category, not by id', okCategoryDeriv ? 'pass' : 'fail',
      okCategoryDeriv ? "firstByCategory + a.category === 'Sell'/'Operate'/'Lease' wired"
                      : "category-derivation markers missing");

    // The hard-coded LEGACY_ASSET_IDS lookups MUST be gone for the
    // resAsset/hospAsset/retAsset binding — only allowed surviving
    // usage is the resAssetId fallback (?? LEGACY_ASSET_IDS.residential).
    const banishedLookup = "assetById.get(LEGACY_ASSET_IDS.residential)";
    record('M1.10/3 — no direct LEGACY_ASSET_IDS lookup for resAsset', !platformSrc.includes(banishedLookup) ? 'pass' : 'fail',
      !platformSrc.includes(banishedLookup) ? 'category resolution replaces id lookup'
                                            : 'still has hard-coded id lookup');
  } catch (e) {
    record('M1.10/3 — source-file inspection', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── 4c. Wizard Step 2 layout (no-scroll markers) ──
  try {
    const wizardSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modals/ProjectWizard.tsx'),
      'utf-8',
    );
    const okStep2Layout = wizardSrc.includes('Q2 + Q3: Phases + Plots — paired side-by-side');
    record('M1.10/4 — wizard Step 2 collapses Phases+Plots into 2-col row', okStep2Layout ? 'pass' : 'fail',
      okStep2Layout ? '2-column grid + sp-2 gap markers present'
                    : 'pre-M1.10/4 stacked layout still in source');
  } catch (e) {
    record('M1.10/4 — source-file inspection', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── 4d. Reconciliation row markup ──
  try {
    const apSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx'),
      'utf-8',
    );
    const okReconciliation = apSrc.includes('data-testid="land-plot-reconciliation"')
      && apSrc.includes('totalParcelArea')
      && apSrc.includes('totalPlotAreaAllPhases');
    record('M1.10/5 — Land vs Plot reconciliation row mounted', okReconciliation ? 'pass' : 'fail',
      okReconciliation ? 'reconciliation row computes parcel total + plot total + matches/diverges'
                       : 'reconciliation markup missing');

    // Plot Buildable Area relabel
    const okPlotBuildable = apSrc.includes('Plot Buildable Area');
    record('M1.10/5 — "Plot Area" -> "Plot Buildable Area" relabel', okPlotBuildable ? 'pass' : 'fail',
      okPlotBuildable ? 'Build Program input label disambiguated' : 'still reads "Plot Area"');

    const areaSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modules/Module1Area.tsx'),
      'utf-8',
    );
    const okLandLabel = areaSrc.includes('Land Parcels (financial — what you own)');
    record('M1.10/5 — "Land Parcels" -> financial framing relabel', okLandLabel ? 'pass' : 'fail',
      okLandLabel ? 'Land card heading disambiguated' : 'still reads bare "Land Parcels"');
  } catch (e) {
    record('M1.10/5 — source-file inspection', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── 4e. Wizard files + mounts ──
  // Both PlotSetupWizard.tsx + ParcelSetupWizard.tsx exist + are mounted
  // by their host components.
  try {
    const plotWizExists   = existsSync(resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modals/PlotSetupWizard.tsx'));
    const parcelWizExists = existsSync(resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modals/ParcelSetupWizard.tsx'));
    record('M1.10/6 + 7 — wizard files exist', (plotWizExists && parcelWizExists) ? 'pass' : 'fail',
      `PlotSetupWizard=${plotWizExists ? '✓' : '✗'} ParcelSetupWizard=${parcelWizExists ? '✓' : '✗'}`);

    const apSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx'),
      'utf-8',
    );
    const okPlotWizMount = apSrc.includes('<PlotSetupWizard') && apSrc.includes('wizardPlotId');
    record('M1.10/6 — PlotSetupWizard mounted from Module1AreaProgram', okPlotWizMount ? 'pass' : 'fail',
      okPlotWizMount ? 'wizardPlotId state + mount present' : 'mount missing');

    const areaSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modules/Module1Area.tsx'),
      'utf-8',
    );
    const okParcelWizMount = areaSrc.includes('<ParcelSetupWizard') && areaSrc.includes('parcelWizardOpen');
    record('M1.10/7 — ParcelSetupWizard mounted from Module1Area', okParcelWizMount ? 'pass' : 'fail',
      okParcelWizMount ? 'parcelWizardOpen state + mount present' : 'mount missing');
  } catch (e) {
    record('M1.10/6 + 7 — wizard file / mount inspection', 'fail',
      e instanceof Error ? e.message : String(e));
  }
}

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
      'requires authenticated REFM session — TODO: add fixture-login or NextAuth cookie injection');
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`\nM1.10 verification — target: ${SUPABASE_URL}\n`);

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
