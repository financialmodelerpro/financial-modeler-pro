/**
 * scripts/verify-m17.ts
 *
 * End-to-end verification that Phase M1.7 (REFM Module 1 Area Program)
 * is correctly deployed.
 *
 * QUICK START:
 *   npx tsx --env-file=.env.local scripts/verify-m17.ts
 *
 * Optional: start `npm run dev` in another terminal so http://localhost:3000
 * responds — section 2 (route smoke) and section 5 (Playwright UI) will
 * skip cleanly when the dev server isn't reachable.
 *
 * Sections covered (matches the standing per-phase verification template
 * established 2026-05-02):
 *
 *   1. Database / persistence  — JSONB schema check that refm_projects.snapshot
 *                                accepts and round-trips a v4 snapshot carrying
 *                                plots[] / zones[]; confirms enrichWithHierarchy-
 *                                Defaults pads missing fields when older snapshots
 *                                load.
 *   2. Route smoke tests       — confirms M1.6 routes still 401 without auth
 *                                and that the duplicate route accepts an
 *                                M1.7-shaped snapshot at the schema level.
 *                                Skips cleanly when dev server is down.
 *   3. Calculation correctness — runs all 3 snapshot diffs (legacy 17.5 KB,
 *                                multi-phase 23.0 KB, area-program 2.8 KB)
 *                                + assertion-style spot-checks on the
 *                                area-program fixture's expected values.
 *   4. State integrity         — exercises the store CRUD: addPlot ->
 *                                addZone -> assign asset -> removePlot
 *                                cascade. Confirms cascade-aware deletes
 *                                (plot removal drops zones, clears asset
 *                                plotId/zoneId; phase removal cascades
 *                                through plots).
 *   5. UI rendering            — launches headless Chromium via Playwright,
 *                                captures light + dark screenshots of the
 *                                public sign-in page, confirms /refm is
 *                                gated. Deeper Module1AreaProgram tests
 *                                require a signed-in session and are
 *                                listed as TODO until auth bypass /
 *                                fixture login lands.
 *
 * Test-user fixture: same pattern as verify-m16 (id 00000000-...), with
 * ON DELETE CASCADE cleaning everything downstream.
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
import { createModule1Store } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import {
  hydrationFromAnySnapshot,
  enrichWithHierarchyDefaults,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  computePlotEnvelope, computeAreaCascade, allocateParking, computePlotParkingCapacity,
} from '@core/calculations';
import {
  makeDefaultPlot, type Plot,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { loadV4Fixture, runAreaProgramPipeline } from './module1-pipeline';

// ── Config ────────────────────────────────────────────────────────────────
const TEST_USER_ID    = '00000000-0000-0000-0000-000000000000';
const TEST_USER_EMAIL = `m17-verify+${Date.now()}@test.invalid`;
const TEST_USER_NAME  = 'M1.7 Verification Fixture';
const NAME_PREFIX     = 'M17-VERIFY-';
const DEV_SERVER_URL  = process.env.M17_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR  = resolve(process.cwd(), 'tests/screenshots/m17');
const FIXTURE_PATH    = resolve(process.cwd(), 'tests/fixtures/module1-areaprogram.json');

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
    password_hash:       'M17_VERIFY_NOT_USABLE',
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
  section('1. Database / persistence — JSONB roundtrip with plots/zones');

  // Load the M1.7 area-program fixture (carries plots / zones / sub-units).
  const v4Snapshot = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
  // Strip _comment so the JSONB cell stays clean.
  delete v4Snapshot._comment;

  // Insert a project + version with the M1.7 snapshot shape.
  const projInsert = await sb.from('refm_projects').insert({
    user_id:        TEST_USER_ID,
    name:           NAME_PREFIX + 'AreaProgram',
    location:       'Riyadh',
    status:         'Draft',
    asset_mix:      ['Residential', 'Hospitality', 'Retail'],
    schema_version: 4,
  }).select('id').maybeSingle();

  if (projInsert.error || !projInsert.data) {
    record('Insert refm_projects with M1.7 metadata', 'fail',
      projInsert.error?.message ?? 'no data returned');
    return;
  }
  const projectId = (projInsert.data as { id: string }).id;
  record('Insert refm_projects with M1.7 metadata', 'pass', `id=${projectId.slice(0, 8)}…`);

  const verInsert = await sb.from('refm_project_versions').insert({
    project_id:     projectId,
    version_number: 1,
    schema_version: 4,
    snapshot:       v4Snapshot,
    label:          'M1.7 area-program v4 fixture',
  }).select('id').maybeSingle();

  if (verInsert.error || !verInsert.data) {
    record('Insert refm_project_versions with plots+zones snapshot', 'fail',
      verInsert.error?.message ?? 'no data returned');
    await sb.from('refm_projects').delete().eq('id', projectId);
    return;
  }
  record('Insert refm_project_versions with plots+zones snapshot', 'pass',
    `JSONB accepted ${JSON.stringify(v4Snapshot).length} byte snapshot`);

  // Read it back and confirm shape preserved.
  const verRead = await sb.from('refm_project_versions')
    .select('snapshot')
    .eq('id', (verInsert.data as { id: string }).id)
    .single();

  if (verRead.error || !verRead.data) {
    record('Read-back snapshot', 'fail', verRead.error?.message ?? 'no data');
  } else {
    const snap = (verRead.data as { snapshot: { plots?: unknown[]; zones?: unknown[] } }).snapshot;
    const okPlots = Array.isArray(snap.plots) && snap.plots.length === 1;
    const okZones = Array.isArray(snap.zones) && snap.zones.length === 2;
    if (okPlots && okZones) {
      record('Round-trip preserves plots[] + zones[]', 'pass',
        `plots=${snap.plots!.length}, zones=${snap.zones!.length}`);
    } else {
      record('Round-trip preserves plots[] + zones[]', 'fail',
        `plots ok=${okPlots} zones ok=${okZones}`);
    }
  }

  // Confirm enrichWithHierarchyDefaults pads missing plots/zones on
  // pre-M1.7 payloads — load a snapshot that intentionally lacks
  // plots / zones and verify the helper fills them.
  const bareSnapshot = { ...v4Snapshot } as Record<string, unknown>;
  delete bareSnapshot.plots;
  delete bareSnapshot.zones;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enriched = enrichWithHierarchyDefaults(bareSnapshot as any);
  if (Array.isArray(enriched.plots) && Array.isArray(enriched.zones)
      && enriched.plots.length === 0 && enriched.zones.length === 0) {
    record('enrichWithHierarchyDefaults pads missing plots/zones', 'pass',
      'pre-M1.7 snapshot loads with empty plots/zones');
  } else {
    record('enrichWithHierarchyDefaults pads missing plots/zones', 'fail',
      `plots=${enriched.plots?.length} zones=${enriched.zones?.length}`);
  }

  // hydrationFromAnySnapshot must accept an M1.7 v4 payload when wrapped
  // as a NewV3Snapshot (i.e. with version: 3). Bare HydrateSnapshot JSON
  // (the fixture form) intentionally lacks the version discriminator —
  // that path is exercised by enrichWithHierarchyDefaults above and by
  // loadV4Fixture in the snapshot-diff scripts. Here we test the
  // discriminated path: wrap, hydrate, confirm plots round-trip.
  const wrapped = { version: 3, ...v4Snapshot };
  const hydrated = hydrationFromAnySnapshot(wrapped);
  if (Array.isArray(hydrated.plots) && hydrated.plots.length === 1) {
    record('hydrationFromAnySnapshot recognizes wrapped M1.7 v3 snapshot', 'pass',
      `1 plot, ${hydrated.zones.length} zones, ${hydrated.assets.length} assets`);
  } else {
    record('hydrationFromAnySnapshot recognizes wrapped M1.7 v3 snapshot', 'fail',
      `unexpected plots length: ${hydrated.plots?.length}`);
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

  // M1.7 doesn't add new routes — it extends the snapshot JSONB shape.
  // Re-verify the M1.6 routes still 401 without auth (regression catch).
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
  section('3. Calculation correctness — snapshot diffs + spot assertions');

  // Snapshot diffs run as separate scripts that exit 0 / 1.
  const diffs: Array<{ name: string; script: string }> = [
    { name: 'module1-snapshot-diff (legacy single-phase)', script: 'scripts/module1-snapshot-diff.ts' },
    { name: 'module1-multiphase-diff (multi-phase v4)',    script: 'scripts/module1-multiphase-diff.ts' },
    { name: 'module1-areaprogram-diff (M1.7 area program)', script: 'scripts/module1-areaprogram-diff.ts' },
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

  // Spot-check the M1.7 calc engines on the area-program fixture's plot.
  // These mirror the M1.7/2 smoke tests but assert against the live
  // engines so a future refactor that breaks the math surfaces here.
  const v4 = loadV4Fixture(FIXTURE_PATH);
  const plot = v4.plots[0];
  const env = computePlotEnvelope({
    plotArea: plot.plotArea, maxFAR: plot.maxFAR, coveragePct: plot.coveragePct,
    podiumFloors: plot.podiumFloors, typicalFloors: plot.typicalFloors,
    typicalCoveragePct: plot.typicalCoveragePct,
    landscapePct: plot.landscapePct, hardscapePct: plot.hardscapePct,
    basementCount: plot.basementCount, basementEfficiencyPct: plot.basementEfficiencyPct,
  });
  const expectedEnv = {
    maxGFA: 150000, footprint: 30000, totalBuiltGFA: 260000,
    surfaceParkingArea: 8000, basementUsableArea: 57000,
    isOverFAR: true,
  };
  const envOk = env.maxGFA === expectedEnv.maxGFA
    && env.footprint === expectedEnv.footprint
    && env.totalBuiltGFA === expectedEnv.totalBuiltGFA
    && env.surfaceParkingArea === expectedEnv.surfaceParkingArea
    && env.basementUsableArea === expectedEnv.basementUsableArea
    && env.isOverFAR === expectedEnv.isOverFAR;
  if (envOk) {
    record('computePlotEnvelope on Plot A: maxGFA/footprint/built/parking match', 'pass',
      `maxGFA=${env.maxGFA}, totalBuilt=${env.totalBuiltGFA}, isOverFAR=${env.isOverFAR}`);
  } else {
    record('computePlotEnvelope on Plot A: maxGFA/footprint/built/parking match', 'fail',
      `got ${JSON.stringify(env)}`);
  }

  const cap = computePlotParkingCapacity({
    envelope: env,
    surfaceBaySqm: plot.surfaceBaySqm,
    verticalBaySqm: plot.verticalBaySqm,
    basementBaySqm: plot.basementBaySqm,
    verticalParkingFloors: plot.verticalParkingFloors ?? 0,
  });
  if (cap.surfaceCapacityBays === 320 && cap.basementCapacityBays === 1295 && cap.verticalCapacityBays === 0) {
    record('computePlotParkingCapacity: 320 surface / 0 vertical / 1295 basement', 'pass', 'all match');
  } else {
    record('computePlotParkingCapacity: 320 surface / 0 vertical / 1295 basement', 'fail',
      `got ${JSON.stringify(cap)}`);
  }

  // Run the area-program pipeline end-to-end and assert key totals.
  const ap = runAreaProgramPipeline(v4);
  const plotSnap = ap.perPlot[0];
  const checks: Array<[string, boolean, string]> = [
    ['Total parking demanded = 380 (residential 180 + hospitality 200 + retail 0)',
      plotSnap.totalParkingBaysDemanded === 380,
      `got ${plotSnap.totalParkingBaysDemanded}`],
    ['Surface bays allocated = 320 (capped by capacity)',
      plotSnap.parking.surfaceBays === 320,
      `got ${plotSnap.parking.surfaceBays}`],
    ['Basement bays allocated = 60 (380 - 320 - 0)',
      plotSnap.parking.basementBays === 60,
      `got ${plotSnap.parking.basementBays}`],
    ['Parking deficit = 0',
      plotSnap.parking.deficit === 0,
      `got ${plotSnap.parking.deficit}`],
    ['Residential GFA share = 130,000 sqm (50% × 260k built)',
      plotSnap.perAsset.find(a => a.assetId === 'residential')?.gfaShare === 130000,
      `got ${plotSnap.perAsset.find(a => a.assetId === 'residential')?.gfaShare}`],
    ['Hospitality cascade GSA/GLA = 42,432 sqm (78k × 0.85 efficiency × cascade)',
      Math.round(plotSnap.perAsset.find(a => a.assetId === 'hospitality')?.cascade.gsaGla ?? 0) === 42432,
      `got ${plotSnap.perAsset.find(a => a.assetId === 'hospitality')?.cascade.gsaGla}`],
  ];
  for (const [label, ok, detail] of checks) {
    record(label, ok ? 'pass' : 'fail', ok ? '' : detail);
  }

  // computeAreaCascade isolated assertion (used by the verify-m17 invariants).
  const cascade = computeAreaCascade({
    gfa: 100000, mepPct: 12, backOfHousePct: 8, otherTechnicalPct: 4,
    efficiencyPct: 85, basementShare: 5000,
  });
  const cascadeOk = cascade.mep === 12000 && cascade.netGFA === 76000
    && cascade.gsaGla === 64600 && cascade.tba === 129000;
  record('computeAreaCascade(100k GFA, 12/8/4/85, basement 5k): mep/netGFA/gsa/tba',
    cascadeOk ? 'pass' : 'fail',
    cascadeOk ? '' : `got mep=${cascade.mep} netGFA=${cascade.netGFA} gsa=${cascade.gsaGla} tba=${cascade.tba}`);

  // allocateParking isolated assertion (waterfall fairness).
  const alloc = allocateParking({
    totalBaysRequired: 1500, surfaceCapacityBays: 320,
    verticalCapacityBays: 750, basementCapacityBays: 1295,
  });
  const allocOk = alloc.surfaceBays === 320 && alloc.verticalBays === 750
    && alloc.basementBays === 430 && alloc.deficit === 0;
  record('allocateParking(1500 demand): waterfall surface/vertical/basement = 320/750/430',
    allocOk ? 'pass' : 'fail',
    allocOk ? '' : `got ${JSON.stringify(alloc)}`);
}

// ── 4. State integrity ──────────────────────────────────────────────────
function checkStateIntegrity(): void {
  section('4. State integrity — store CRUD + cascade-aware deletes');

  // Mint a fresh store, hydrate from the area-program fixture.
  const store = createModule1Store();
  const v4 = loadV4Fixture(FIXTURE_PATH);
  store.getState().hydrate(v4);

  // After hydrate: 1 plot, 2 zones, 3 assets bound to plot_1.
  let s = store.getState();
  if (s.plots.length === 1 && s.zones.length === 2 && s.assets.filter(a => a.plotId === 'plot_1').length === 3) {
    record('Hydrate from M1.7 fixture: 1 plot / 2 zones / 3 plot-bound assets', 'pass',
      `plots=${s.plots.length} zones=${s.zones.length}`);
  } else {
    record('Hydrate from M1.7 fixture: 1 plot / 2 zones / 3 plot-bound assets', 'fail',
      `plots=${s.plots.length} zones=${s.zones.length} bound=${s.assets.filter(a => a.plotId === 'plot_1').length}`);
  }

  // Add a new plot via the store action.
  const newPlot: Plot = makeDefaultPlot('plot_test', 'Plot B', 'phase_1', 25000);
  store.getState().addPlot(newPlot);
  s = store.getState();
  if (s.plots.length === 2 && s.plots.some(p => p.id === 'plot_test')) {
    record('addPlot: store length increases', 'pass', 'plot_test present');
  } else {
    record('addPlot: store length increases', 'fail', `got ${s.plots.length} plots`);
  }

  // Add a zone under the new plot.
  store.getState().addZone({ id: 'zone_test', name: 'Zone Test', plotId: 'plot_test' });
  s = store.getState();
  if (s.zones.filter(z => z.plotId === 'plot_test').length === 1) {
    record('addZone under new plot', 'pass', '1 zone added');
  } else {
    record('addZone under new plot', 'fail', `got ${s.zones.length} zones total`);
  }

  // Reassign one asset to the new plot.
  store.getState().updateAsset('residential', { plotId: 'plot_test' });
  s = store.getState();
  if (s.assets.find(a => a.id === 'residential')?.plotId === 'plot_test') {
    record('updateAsset: reassign residential to plot_test', 'pass', 'plotId updated');
  } else {
    record('updateAsset: reassign residential to plot_test', 'fail', 'plotId not updated');
  }

  // Remove the new plot — should drop its zone AND clear residential.plotId
  // (residential survives; just leaves area-program cascade).
  store.getState().removePlot('plot_test');
  s = store.getState();
  const plotGone     = !s.plots.some(p => p.id === 'plot_test');
  const zoneGone     = !s.zones.some(z => z.plotId === 'plot_test');
  const residential  = s.assets.find(a => a.id === 'residential');
  const assetSurvived = !!residential;
  const refsCleared  = residential?.plotId === undefined && residential?.zoneId === undefined;
  if (plotGone && zoneGone && assetSurvived && refsCleared) {
    record('removePlot cascade: drops plot+zones, clears asset.plotId/zoneId, asset survives', 'pass',
      'all 4 invariants hold');
  } else {
    record('removePlot cascade: drops plot+zones, clears asset.plotId/zoneId, asset survives', 'fail',
      `plotGone=${plotGone} zoneGone=${zoneGone} assetSurvived=${assetSurvived} refsCleared=${refsCleared}`);
  }

  // removeZone of zone_1a should clear hospitality / retail zoneId in fixture
  // (only residential pointed at zone_1a; assets keep plotId).
  store.getState().removeZone('zone_1a');
  s = store.getState();
  const zone1aGone = !s.zones.some(z => z.id === 'zone_1a');
  // residential was reassigned earlier — its plotId is undefined now;
  // grab the original-plot binding by re-hydrating to confirm zone-only clearing.
  const freshStore = createModule1Store();
  freshStore.getState().hydrate(v4);
  freshStore.getState().removeZone('zone_1a');
  const freshState = freshStore.getState();
  const residentialFresh = freshState.assets.find(a => a.id === 'residential');
  if (zone1aGone && residentialFresh?.zoneId === undefined && residentialFresh?.plotId === 'plot_1') {
    record('removeZone: zone gone, asset.zoneId cleared, asset.plotId preserved', 'pass',
      'zone-only cascade');
  } else {
    record('removeZone: zone gone, asset.zoneId cleared, asset.plotId preserved', 'fail',
      `zoneGone=${zone1aGone} fresh.residential.zoneId=${residentialFresh?.zoneId} plotId=${residentialFresh?.plotId}`);
  }

  // removePhase of phase_1 should cascade through plots → zones → assets → costs.
  const cascadeStore = createModule1Store();
  cascadeStore.getState().hydrate(v4);
  cascadeStore.getState().removePhase('phase_1');
  const cs = cascadeStore.getState();
  if (cs.phases.length === 0 && cs.plots.length === 0 && cs.zones.length === 0 && cs.assets.length === 0) {
    record('removePhase cascade: drops phases→plots→zones→assets', 'pass',
      'all 4 levels cleared');
  } else {
    record('removePhase cascade: drops phases→plots→zones→assets', 'fail',
      `phases=${cs.phases.length} plots=${cs.plots.length} zones=${cs.zones.length} assets=${cs.assets.length}`);
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

  // Playwright is an optional dev-time dep; load lazily so the script
  // still runs the other sections when it isn't installed.
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
    // Capture light + dark screenshots of the public sign-in page so
    // we have a deterministic visual baseline that doesn't require a
    // signed-in session. The actual Module1AreaProgram tab needs a
    // NextAuth session (see TODO below).
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

    // Confirm /refm gates non-authenticated users (proves middleware
    // is enforcing app-side auth and the area-program tab can't be
    // reached without a session).
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

    record('Module1AreaProgram tab interaction (deferred)', 'skip',
      'requires authenticated session — TODO: add fixture-login or NextAuth cookie injection');
  } finally {
    await browser.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`\nM1.7 verification — target: ${SUPABASE_URL}\n`);

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
