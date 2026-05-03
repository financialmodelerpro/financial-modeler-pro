/**
 * scripts/verify-m18.ts
 *
 * End-to-end verification that Phase M1.8 (REFM Smart Project Creation
 * Wizard + Hierarchy progressive disclosure + action buttons) is correctly
 * deployed.
 *
 * QUICK START:
 *   npx tsx --env-file=.env.local scripts/verify-m18.ts
 *
 * Optional: start `npm run dev` in another terminal so http://localhost:3000
 * responds — section 2 (route smoke) and section 5 (Playwright UI) will
 * skip cleanly when the dev server isn't reachable.
 *
 * Sections covered (matches the standing per-phase verification template
 * established 2026-05-02):
 *
 *   1. Database / persistence  — JSONB roundtrip carrying the new
 *                                hierarchyDisclosure field; verify
 *                                enrichWithHierarchyDefaults pads
 *                                pre-M1.8 snapshots to 'manual'.
 *   2. Route smoke tests       — POST /api/refm/projects with a
 *                                wizard-built snapshot still 401s
 *                                without auth (no new routes; M1.8
 *                                rides existing M1.6 endpoints).
 *   3. Calculation correctness — runs all 3 snapshot diffs (legacy,
 *                                multiphase, areaprogram) — must all
 *                                stay exit 0 since M1.8 is structural,
 *                                not calc.
 *   4. State integrity         — buildWizardSnapshot fixture inputs →
 *                                expected entity counts; map-wizard-to-
 *                                project-type collapse rules; sub-unit
 *                                placeholder per category; MH enabled
 *                                only when toggle ON; hydrate cycle
 *                                preserves hierarchyDisclosure across
 *                                project switches.
 *   5. UI rendering            — Playwright headless screenshots of
 *                                public sign-in (light + dark) — same
 *                                pattern as verify-m17; deeper wizard
 *                                interactions are gated behind auth
 *                                and listed as TODO until fixture-
 *                                login lands.
 *
 * Test-user fixture: same pattern as verify-m17 (id 00000000-...), with
 * ON DELETE CASCADE cleaning everything downstream.
 *
 * Exit codes:
 *   0   all sections pass (skipped tests don't count as failures)
 *   1   any section fails
 *   2   environment / connectivity issue before tests start
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createModule1Store, type HydrateSnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { enrichWithHierarchyDefaults } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  buildWizardSnapshot, mapWizardToProjectType,
} from '../src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot';
import {
  makeWizardDefaultDraft, seedAssetsForType,
  type WizardDraft, type WizardProjectType,
} from '../src/hubs/modeling/platforms/refm/components/modals/ProjectWizard';

// ── Config ────────────────────────────────────────────────────────────────
const TEST_USER_ID    = '00000000-0000-0000-0000-000000000000';
const TEST_USER_EMAIL = `m18-verify+${Date.now()}@test.invalid`;
const TEST_USER_NAME  = 'M1.8 Verification Fixture';
const NAME_PREFIX     = 'M18-VERIFY-';
const DEV_SERVER_URL  = process.env.M18_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR  = resolve(process.cwd(), 'tests/screenshots/m18');

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

// ── Helpers ────────────────────────────────────────────────────────────────
function makeMixedUseDraft(name: string): WizardDraft {
  // Use the canonical default so we exercise the seedAssetsForType
  // ('Mixed-Use') path that ships in the wizard.
  return {
    ...makeWizardDefaultDraft(),
    name,
    location: 'Riyadh, Saudi Arabia',
  };
}

// ── 0. Test-user fixture ──────────────────────────────────────────────────
async function setupTestUser(): Promise<void> {
  await sb.from('users').delete().eq('id', TEST_USER_ID);
  const { error } = await sb.from('users').insert({
    id:                  TEST_USER_ID,
    email:               TEST_USER_EMAIL,
    name:                TEST_USER_NAME,
    password_hash:       'M18_VERIFY_NOT_USABLE',
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
  section('1. Database / persistence — wizard snapshot JSONB roundtrip');

  // Build a wizard snapshot via the same pure helper the UI uses.
  const draft = makeMixedUseDraft(NAME_PREFIX + 'Mixed');
  const built = buildWizardSnapshot(draft);

  // Insert a project + version with the wizard snapshot shape.
  const projInsert = await sb.from('refm_projects').insert({
    user_id:        TEST_USER_ID,
    name:           NAME_PREFIX + 'Mixed',
    location:       'Riyadh',
    status:         'Draft',
    asset_mix:      built.assetMix,
    schema_version: 4,
  }).select('id').maybeSingle();

  if (projInsert.error || !projInsert.data) {
    record('Insert refm_projects with wizard snapshot metadata', 'fail',
      projInsert.error?.message ?? 'no data returned');
    return;
  }
  const projectId = (projInsert.data as { id: string }).id;
  record('Insert refm_projects with wizard snapshot metadata', 'pass',
    `id=${projectId.slice(0, 8)}…`);

  const verInsert = await sb.from('refm_project_versions').insert({
    project_id:     projectId,
    version_number: 1,
    schema_version: 4,
    snapshot:       built.snapshot,
    label:          'M1.8 wizard fixture',
  }).select('id').maybeSingle();

  if (verInsert.error || !verInsert.data) {
    record('Insert refm_project_versions with wizard snapshot', 'fail',
      verInsert.error?.message ?? 'no data returned');
    await sb.from('refm_projects').delete().eq('id', projectId);
    return;
  }
  record('Insert refm_project_versions with wizard snapshot', 'pass',
    `JSONB accepted ${JSON.stringify(built.snapshot).length} byte snapshot`);

  // Read back and confirm hierarchyDisclosure round-trips.
  const verRead = await sb.from('refm_project_versions')
    .select('snapshot')
    .eq('id', (verInsert.data as { id: string }).id)
    .single();

  if (verRead.error || !verRead.data) {
    record('Read-back wizard snapshot', 'fail', verRead.error?.message ?? 'no data');
  } else {
    const snap = (verRead.data as { snapshot: HydrateSnapshot & { hierarchyDisclosure?: string } }).snapshot;
    const okDisclosure = snap.hierarchyDisclosure === 'progressive';
    const okPlots      = Array.isArray(snap.plots) && snap.plots.length === 1;
    const okAssets     = Array.isArray(snap.assets) && snap.assets.length === 3;
    const okSubUnits   = Array.isArray(snap.subUnits) && snap.subUnits.length === 3;
    const okPhases     = Array.isArray(snap.phases) && snap.phases.length === 1;
    if (okDisclosure && okPlots && okAssets && okSubUnits && okPhases) {
      record('Round-trip preserves hierarchyDisclosure + wizard structure', 'pass',
        `disclosure=${snap.hierarchyDisclosure} phases=${snap.phases.length} plots=${snap.plots!.length} assets=${snap.assets!.length} subUnits=${snap.subUnits!.length}`);
    } else {
      record('Round-trip preserves hierarchyDisclosure + wizard structure', 'fail',
        `disclosure=${snap.hierarchyDisclosure} phases=${snap.phases?.length} plots=${snap.plots?.length} assets=${snap.assets?.length} subUnits=${snap.subUnits?.length}`);
    }
  }

  // Confirm enrichWithHierarchyDefaults pads missing hierarchyDisclosure on
  // pre-M1.8 payloads — load a snapshot that intentionally lacks the
  // field and verify the helper fills it with 'manual'.
  const bareSnapshot = { ...built.snapshot } as Partial<HydrateSnapshot>;
  delete bareSnapshot.hierarchyDisclosure;
  const enriched = enrichWithHierarchyDefaults(bareSnapshot as HydrateSnapshot);
  if (enriched.hierarchyDisclosure === 'manual') {
    record('enrichWithHierarchyDefaults pads missing hierarchyDisclosure → manual', 'pass',
      'pre-M1.8 snapshots load with manual disclosure (legacy behavior)');
  } else {
    record('enrichWithHierarchyDefaults pads missing hierarchyDisclosure → manual', 'fail',
      `expected "manual", got "${enriched.hierarchyDisclosure}"`);
  }

  // Cleanup project (cascades to version).
  await sb.from('refm_projects').delete().eq('id', projectId);
}

// ── 2. Route smoke tests ─────────────────────────────────────────────────
async function checkRoutes(): Promise<void> {
  section('2. Route smoke tests');

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

  // M1.8 doesn't add new routes — it rides the M1.6 endpoints with a
  // larger snapshot payload. Re-verify the existing routes still 401
  // without auth (regression catch).
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
  section('3. Calculation correctness — snapshot diffs (M1.8 must not drift)');

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
  section('4. State integrity — wizard build helper + store hydration');

  // ── 4a. Project-type collapse rules ──
  // The wizard exposes 6 display values; the snapshot uses 3.
  const collapseChecks: Array<[WizardProjectType, ReturnType<typeof mapWizardToProjectType>]> = [
    ['Residential',  'residential'],
    ['Hospitality',  'hospitality'],
    ['Retail',       'mixed-use'],
    ['Office',       'mixed-use'],
    ['Mixed-Use',    'mixed-use'],
    ['Custom',       'mixed-use'],
  ];
  let collapseOk = true;
  for (const [wt, expected] of collapseChecks) {
    const got = mapWizardToProjectType(wt);
    if (got !== expected) collapseOk = false;
  }
  record('mapWizardToProjectType collapses 6 display types → 3 store types', collapseOk ? 'pass' : 'fail',
    collapseOk ? '6/6 mappings correct' : 'mismatch in collapse table');

  // ── 4b. Mixed-Use seed produces 3 assets / 3 sub-units / 1 plot / 1 phase / MH disabled ──
  const mixDraft = makeMixedUseDraft('M18-Mixed-State');
  const mixBuilt = buildWizardSnapshot(mixDraft);
  const okMix = mixBuilt.snapshot.assets.length === 3
    && mixBuilt.snapshot.subUnits.length === 3
    && mixBuilt.snapshot.plots.length === 1
    && mixBuilt.snapshot.phases.length === 1
    && mixBuilt.snapshot.subProjects.length === 1
    && mixBuilt.snapshot.masterHolding.enabled === false
    && mixBuilt.snapshot.hierarchyDisclosure === 'progressive';
  if (okMix) {
    record('Mixed-Use seed: 3 assets / 3 sub-units / 1 plot / 1 phase / MH off / progressive', 'pass',
      `assetMix=[${mixBuilt.assetMix.join(', ')}]`);
  } else {
    record('Mixed-Use seed: 3 assets / 3 sub-units / 1 plot / 1 phase / MH off / progressive', 'fail',
      `assets=${mixBuilt.snapshot.assets.length} subUnits=${mixBuilt.snapshot.subUnits.length} plots=${mixBuilt.snapshot.plots.length} mh=${mixBuilt.snapshot.masterHolding.enabled} disc=${mixBuilt.snapshot.hierarchyDisclosure}`);
  }

  // ── 4c. Multi-phase + multi-plot draft yields the right counts ──
  const bigDraft: WizardDraft = {
    ...makeMixedUseDraft('M18-Big-State'),
    enableMasterHolding: true,
    phaseCount: 4,
    plotCount: 5,
  };
  const bigBuilt = buildWizardSnapshot(bigDraft);
  const okBig = bigBuilt.snapshot.phases.length === 4
    && bigBuilt.snapshot.plots.length === 5
    && bigBuilt.snapshot.masterHolding.enabled === true
    && bigBuilt.snapshot.subProjects[0].masterHoldingId === 'mh_1';
  if (okBig) {
    record('phaseCount=4, plotCount=5, MH on → 4 phases / 5 plots / MH-roll-up wired', 'pass',
      `phases=${bigBuilt.snapshot.phases.map(p => p.name).join(',')}, plots=${bigBuilt.snapshot.plots.map(p => p.name).join(',')}`);
  } else {
    record('phaseCount=4, plotCount=5, MH on → 4 phases / 5 plots / MH-roll-up wired', 'fail',
      `phases=${bigBuilt.snapshot.phases.length} plots=${bigBuilt.snapshot.plots.length} mh=${bigBuilt.snapshot.masterHolding.enabled} mhRollup=${bigBuilt.snapshot.subProjects[0].masterHoldingId}`);
  }

  // ── 4d. Sub-unit metric per category ──
  // Sell → count, Operate → count, Lease → area
  const wantsByCategory: Record<string, 'count' | 'area'> = {
    'Sell': 'count', 'Operate': 'count', 'Lease': 'area',
  };
  let metricOk = true;
  for (const sub of mixBuilt.snapshot.subUnits) {
    const owningAsset = mixBuilt.snapshot.assets.find(a => a.id === sub.assetId)!;
    const expected = wantsByCategory[owningAsset.category];
    if (sub.metric !== expected) metricOk = false;
  }
  if (metricOk) {
    record('Sub-unit metric matches category (Sell/Operate→count, Lease→area)', 'pass',
      `${mixBuilt.snapshot.subUnits.length} sub-units verified`);
  } else {
    record('Sub-unit metric matches category (Sell/Operate→count, Lease→area)', 'fail',
      mixBuilt.snapshot.subUnits.map(u => `${u.name}=${u.metric}`).join(', '));
  }

  // ── 4e. Per-type asset seed counts ──
  // Spot-check that every wizard project type seeds the count the brief
  // promises (residential 1, hospitality 1, retail 1, office 1, mixed
  // 3, custom 0).
  const seedCounts: Array<[WizardProjectType, number]> = [
    ['Residential', 1], ['Hospitality', 1], ['Retail', 1], ['Office', 1], ['Mixed-Use', 3], ['Custom', 0],
  ];
  let seedOk = true;
  for (const [t, want] of seedCounts) {
    const seeded = seedAssetsForType(t);
    if (seeded.length !== want) seedOk = false;
  }
  record('seedAssetsForType counts match brief matrix (1/1/1/1/3/0)', seedOk ? 'pass' : 'fail',
    seedOk ? '6/6 types correct' : 'count mismatch');

  // ── 4f. Hydrate cycle preserves hierarchyDisclosure across project switches ──
  // Wizard project A (progressive) → hydrate B (manual via enrich) → store
  // must reflect 'manual' (not stale 'progressive').
  const store = createModule1Store();
  store.getState().hydrate(mixBuilt.snapshot);   // A: progressive
  if (store.getState().hierarchyDisclosure !== 'progressive') {
    record('Hydrate cycle: project A loads with progressive', 'fail',
      `got ${store.getState().hierarchyDisclosure}`);
    return;
  }
  // Now load a "legacy" snapshot that lacks the field; enrich pads to 'manual'.
  const legacySnap = { ...mixBuilt.snapshot } as Partial<HydrateSnapshot>;
  delete legacySnap.hierarchyDisclosure;
  store.getState().hydrate(enrichWithHierarchyDefaults(legacySnap as HydrateSnapshot));
  if (store.getState().hierarchyDisclosure === 'manual') {
    record('Hydrate cycle: switching to enriched legacy snapshot resets disclosure to manual', 'pass',
      'no stale carry-over from prior project');
  } else {
    record('Hydrate cycle: switching to enriched legacy snapshot resets disclosure to manual', 'fail',
      `expected manual, got ${store.getState().hierarchyDisclosure}`);
  }
}

// ── 5. UI rendering (Playwright) ────────────────────────────────────────
async function checkUi(): Promise<void> {
  section('5. UI rendering — Playwright headless light + dark screenshots');

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
    // Capture light + dark screenshots of the public sign-in page so we
    // have a deterministic visual baseline that doesn't require a
    // signed-in session. Wizard interactions need an authed REFM
    // session; same TODO as M1.7.
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

    // Confirm /refm gates non-authenticated users (proves middleware is
    // enforcing app-side auth and the wizard can't be reached without a
    // session).
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

    record('ProjectWizard interaction (deferred)', 'skip',
      'requires authenticated REFM session — TODO: add fixture-login or NextAuth cookie injection (same as verify-m17)');
  } finally {
    await browser.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`\nM1.8 verification — target: ${SUPABASE_URL}\n`);

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
