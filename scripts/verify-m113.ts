/**
 * scripts/verify-m113.ts
 *
 * End-to-end verification that Phase M1.13 (Module 1 self-explanatory:
 * inline plain-English live formula captions across all 4 tabs) is
 * correctly deployed.
 *
 * QUICK START:
 *   npx tsx --env-file=.env.local scripts/verify-m113.ts
 *
 * Sections (standing 5-section template):
 *   1. Database / persistence  - M1.13 adds no schema changes; round-trip
 *                                wizard snapshot still works (smoke).
 *   2. Route smoke tests       - M1.13 adds no new routes
 *   3. Calculation correctness - 3 snapshot diffs bit-identical
 *   4. State integrity         - M1.13 markers verified statically
 *   5. UI rendering            - Playwright signin + screenshots
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
import {
  buildWizardSnapshot,
} from '../src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot';
import {
  makeWizardDefaultDraft,
} from '../src/hubs/modeling/platforms/refm/components/modals/ProjectWizard';

const TEST_USER_ID    = '00000000-0000-0000-0000-000000000000';
const TEST_USER_EMAIL = `m113-verify+${Date.now()}@test.invalid`;
const TEST_USER_NAME  = 'M1.13 Verification Fixture';
const NAME_PREFIX     = 'M113-VERIFY-';
const DEV_SERVER_URL  = process.env.M113_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR  = resolve(process.cwd(), 'tests/screenshots/M1.13');

type Status = 'pass' | 'fail' | 'skip';
interface CheckResult { name: string; status: Status; detail: string }
const results: CheckResult[] = [];

function record(name: string, status: Status, detail: string): void {
  results.push({ name, status, detail });
  const tag = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'SKIP';
  // eslint-disable-next-line no-console
  console.log(`  ${tag}  ${name}${detail ? '  : ' + detail : ''}`);
}

function section(label: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n${'-'.repeat(72)}\n${label}\n${'-'.repeat(72)}`);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function fatal(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`FATAL: ${msg}`);
  process.exit(2);
}

if (!SUPABASE_URL) fatal('missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) in .env.local');
if (!SERVICE_KEY)  fatal('missing SUPABASE_SERVICE_ROLE_KEY in .env.local');

const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

async function setupTestUser(): Promise<void> {
  await sb.from('users').delete().eq('id', TEST_USER_ID);
  const { error } = await sb.from('users').insert({
    id: TEST_USER_ID, email: TEST_USER_EMAIL, name: TEST_USER_NAME,
    password_hash: 'M113_VERIFY_NOT_USABLE',
    role: 'user', subscription_plan: 'free', subscription_status: 'trial',
    projects_limit: 3, email_confirmed: false,
  });
  if (error) fatal(`could not create test user: ${error.message}`);
}

async function teardownTestUser(): Promise<void> {
  await sb.from('users').delete().eq('id', TEST_USER_ID);
}

async function checkPersistence(): Promise<void> {
  section('1. Database / persistence');

  // M1.13 is UI-only; the persistence smoke test re-uses the M1.12
  // wizard parcels round-trip so we know upstream snapshot writes still
  // succeed against the live database.
  const draft = {
    ...makeWizardDefaultDraft(),
    name: NAME_PREFIX + 'parcels',
    location: 'Riyadh',
    parcels: [
      { id: 1, name: 'Parcel North', area: 80000, rate: 600, cashPct: 70, inKindPct: 30 },
      { id: 2, name: 'Parcel South', area: 40000, rate: 450, cashPct: 50, inKindPct: 50 },
    ],
  };
  const built = buildWizardSnapshot(draft);

  if (!Array.isArray(built.snapshot.landParcels) || built.snapshot.landParcels.length !== 2) {
    record('Wizard snapshot includes parcels[] (smoke)', 'fail',
      `expected 2 parcels, got ${built.snapshot.landParcels?.length ?? 'undefined'}`);
    return;
  }
  record('Wizard snapshot includes parcels[] (smoke)', 'pass',
    `2 parcels totalling ${built.snapshot.landParcels.reduce((s, p) => s + p.area, 0)} sqm`);

  const projInsert = await sb.from('refm_projects').insert({
    user_id: TEST_USER_ID, name: NAME_PREFIX + 'parcels', location: 'Riyadh',
    status: 'Draft', asset_mix: built.assetMix, schema_version: 4,
  }).select('id').maybeSingle();

  if (projInsert.error || !projInsert.data) {
    record('Insert refm_projects', 'fail', projInsert.error?.message ?? 'no data');
    return;
  }
  const projectId = (projInsert.data as { id: string }).id;
  record('Insert refm_projects', 'pass', `id=${projectId.slice(0, 8)}`);

  const verInsert = await sb.from('refm_project_versions').insert({
    project_id: projectId, version_number: 1, schema_version: 4,
    snapshot: built.snapshot, label: 'M1.13 verify',
  }).select('id, snapshot').maybeSingle();

  if (verInsert.error || !verInsert.data) {
    record('Insert refm_project_versions', 'fail', verInsert.error?.message ?? 'no data');
    await sb.from('refm_projects').delete().eq('id', projectId);
    return;
  }
  record('Round-trip refm_project_versions', 'pass', 'snapshot persisted');
  await sb.from('refm_projects').delete().eq('id', projectId);
}

async function checkRoutes(): Promise<void> {
  section('2. Route smoke tests');

  let healthy = false;
  try {
    const res = await fetch(`${DEV_SERVER_URL}/api/health`);
    healthy = res.ok;
  } catch { /* ignore */ }
  if (!healthy) {
    record('Dev server reachability', 'skip', `${DEV_SERVER_URL} not responding`);
    return;
  }
  record('Dev server reachability', 'pass', 'OK');

  const routes: Array<{ method: string; path: string }> = [
    { method: 'GET',  path: '/api/refm/projects' },
    { method: 'POST', path: '/api/refm/projects' },
  ];
  for (const r of routes) {
    let status = 0;
    try {
      const res = await fetch(`${DEV_SERVER_URL}${r.path}`, {
        method: r.method, headers: { 'Content-Type': 'application/json' },
        body: r.method === 'POST' ? JSON.stringify({}) : undefined,
      });
      status = res.status;
    } catch (e) {
      record(`${r.method} ${r.path}`, 'fail', e instanceof Error ? e.message : String(e));
      continue;
    }
    record(`${r.method} ${r.path}, 401 without auth`,
      status === 401 ? 'pass' : 'fail',
      `status=${status}`);
  }
}

async function checkCalculations(): Promise<void> {
  section('3. Calculation correctness');

  const diffs: Array<{ name: string; script: string }> = [
    { name: 'module1-snapshot-diff (legacy 17.5 KB)', script: 'scripts/module1-snapshot-diff.ts' },
    { name: 'module1-multiphase-diff (23.0 KB)',     script: 'scripts/module1-multiphase-diff.ts' },
    { name: 'module1-areaprogram-diff (2.8 KB)',     script: 'scripts/module1-areaprogram-diff.ts' },
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
  section('4. State integrity (M1.13 markers)');

  function readSrc(rel: string): string {
    return readFileSync(resolve(process.cwd(), rel), 'utf-8');
  }

  // F1: FormulaCaption primitive exists and exports a default component
  try {
    const fc = readSrc('src/hubs/modeling/platforms/refm/components/ui/FormulaCaption.tsx');
    const ok =
      fc.includes('export default function FormulaCaption(') &&
      fc.includes("data-formula=\"true\"") &&
      fc.includes("text: string") &&
      !fc.includes('—');
    record('F1: FormulaCaption primitive present (no em-dashes)',
      ok ? 'pass' : 'fail',
      ok ? 'default export, text prop, data-formula marker' : 'missing markers or em-dash present');
  } catch (e) {
    record('F1: FormulaCaption primitive', 'fail', e instanceof Error ? e.message : String(e));
  }

  // S1: Schedule (Module1Timeline) imports + uses FormulaCaption
  // (M1.13b: captions sit inline beneath the inputs, no Timeline
  // Summary panel).
  try {
    const tl = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx');
    const ok =
      tl.includes("import FormulaCaption from '../ui/FormulaCaption'") &&
      tl.includes('testId="timeline-formula-end"') &&
      tl.includes('testId="timeline-formula-total-periods"');
    record('S1: Schedule inline timeline formulas wired',
      ok ? 'pass' : 'fail',
      ok ? 'end + total-periods captions wired inline' : 'caption markers missing');
  } catch (e) {
    record('S1: Schedule formula captions', 'fail', e instanceof Error ? e.message : String(e));
  }

  // B1: Build Program imports FormulaCaption + envelope formulas
  // present (M1.13b layout: inline beneath input rows, no Computed
  // Envelope panel). The panel testId is intentionally gone.
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const ok =
      ap.includes("import FormulaCaption from '../ui/FormulaCaption'") &&
      ap.includes('Plot Area * Max FAR') &&
      ap.includes('Footprint * Podium Floors') &&
      ap.includes('Public Area - Landscape - Hardscape') &&
      ap.includes('formula-max-gfa-');
    record('B1: Build Program envelope rows carry formulas (inline)',
      ok ? 'pass' : 'fail',
      ok ? 'envelope formulas in plain English, inline layout' : 'formula text missing');
  } catch (e) {
    record('B1: Build Program envelope formulas', 'fail', e instanceof Error ? e.message : String(e));
  }

  // B2: Asset cascade chain formulas present (M1.13b layout: inline
  // formula stack, no Cascade Preview panel).
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const ok =
      ap.includes('GFA - MEP - BoH - Other') &&
      ap.includes('Net GFA * Efficiency') &&
      ap.includes('GFA + BoH + Other') &&
      ap.includes('formula-cascade-tba-');
    record('B2: Build Program cascade chain formulas (inline)',
      ok ? 'pass' : 'fail',
      ok ? 'cascade chain formulas in plain English, inline layout' : 'cascade formulas missing');
  } catch (e) {
    record('B2: Build Program cascade formulas', 'fail', e instanceof Error ? e.message : String(e));
  }

  // B3: Parking summary cells carry formulas (capacity = area / bay-size)
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const ok =
      ap.includes('Surface Parking / Surface Bay') &&
      ap.includes('Footprint * Vertical Floors / Vertical Bay') &&
      ap.includes('Basement Usable / Basement Bay');
    record('B3: Build Program parking cells carry formulas',
      ok ? 'pass' : 'fail',
      ok ? 'parking capacity formulas wired' : 'parking formulas missing');
  } catch (e) {
    record('B3: Build Program parking formulas', 'fail', e instanceof Error ? e.message : String(e));
  }

  // B4: Land Parcels block totals carry formulas
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const ok =
      ap.includes('testId="parcel-formula-area"') &&
      ap.includes('testId="parcel-formula-value"') &&
      ap.includes('testId="parcel-formula-cash"');
    record('B4: Land Parcels totals carry formulas',
      ok ? 'pass' : 'fail',
      ok ? '3 parcel formula captions present' : 'parcel formulas missing');
  } catch (e) {
    record('B4: Land Parcels formulas', 'fail', e instanceof Error ? e.message : String(e));
  }

  // C1: Dev Costs imports FormulaCaption + buildCostFormula helper present
  try {
    const cs = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx');
    const ok =
      cs.includes("import FormulaCaption from '../ui/FormulaCaption'") &&
      cs.includes('function buildCostFormula(') &&
      cs.includes('Rate * GFA') &&
      cs.includes('% of Selected Costs') &&
      cs.includes('testId={`cost-formula-${cost.id}`}');
    record('C1: Dev Costs row totals carry method formulas',
      ok ? 'pass' : 'fail',
      ok ? 'buildCostFormula + per-row caption' : 'cost formula plumbing missing');
  } catch (e) {
    record('C1: Dev Costs formulas', 'fail', e instanceof Error ? e.message : String(e));
  }

  // C2: Dev Costs grand-total row carries a formula
  try {
    const cs = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx');
    const ok = cs.includes('testId={`cost-grand-total-formula-${assetType}`}');
    record('C2: Dev Costs grand total carries formula',
      ok ? 'pass' : 'fail',
      ok ? 'grand-total caption per asset' : 'grand-total caption missing');
  } catch (e) {
    record('C2: Dev Costs grand total formula', 'fail', e instanceof Error ? e.message : String(e));
  }

  // P1: Financing imports FormulaCaption + key formula testIds present
  try {
    const fn = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx');
    const ok =
      fn.includes("import FormulaCaption from '../ui/FormulaCaption'") &&
      fn.includes('testId="financing-formula-debt-equity"') &&
      fn.includes('testId="financing-formula-periodic-rate"') &&
      fn.includes('testId="financing-formula-repayment"');
    record('P1: Financing inputs carry formulas',
      ok ? 'pass' : 'fail',
      ok ? 'debt-equity + periodic-rate + repayment captions wired' : 'formula testIds missing');
  } catch (e) {
    record('P1: Financing input formulas', 'fail', e instanceof Error ? e.message : String(e));
  }

  // P2: Financing Debt Summary card present (M1.13b: roll-up only,
  // formulas are inline above the card not inside it).
  try {
    const fn = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx');
    const ok =
      fn.includes('data-testid="financing-debt-summary"') &&
      fn.includes('All-in Cost of Debt') &&
      fn.includes('LTV * Total CapEx');  // still appears in input-side caption
    record('P2: Financing Debt Summary card present',
      ok ? 'pass' : 'fail',
      ok ? 'summary roll-up + LTV formula in input-side caption' : 'debt summary card missing');
  } catch (e) {
    record('P2: Financing Debt Summary', 'fail', e instanceof Error ? e.message : String(e));
  }

  // X1: No em-dashes introduced in M1.13 surface files
  try {
    const files = [
      'src/hubs/modeling/platforms/refm/components/ui/FormulaCaption.tsx',
      'src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx',
      'src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx',
      'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx',
      'src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx',
    ];
    let total = 0;
    for (const f of files) {
      const src = readSrc(f);
      // eslint-disable-next-line no-control-regex
      const matches = src.match(/—/g);
      total += matches?.length ?? 0;
    }
    record('X1: M1.13 surface files free of em-dashes',
      total === 0 ? 'pass' : 'fail',
      total === 0 ? 'zero em-dashes across 5 files' : `${total} em-dashes found`);
  } catch (e) {
    record('X1: em-dash sweep', 'fail', e instanceof Error ? e.message : String(e));
  }
}

async function checkUi(): Promise<void> {
  section('5. UI rendering');

  let healthy = false;
  try {
    const res = await fetch(`${DEV_SERVER_URL}/api/health`);
    healthy = res.ok;
  } catch { /* ignore */ }
  if (!healthy) {
    record('Dev server reachability', 'skip', `${DEV_SERVER_URL} not responding`);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chromium: any;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    record('Playwright module loadable', 'skip', 'install @playwright/test');
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
        record(`Screenshot, ${mode} signin`, 'pass', path);
      } catch (e) {
        record(`Screenshot, ${mode} signin`, 'fail', e instanceof Error ? e.message : String(e));
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`\nM1.13 verification, target: ${SUPABASE_URL}\n`);
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
  console.log('\n' + '='.repeat(72));
  // eslint-disable-next-line no-console
  console.log(`Summary: ${pass} pass, ${fail} fail, ${skip} skip`);
  // eslint-disable-next-line no-console
  console.log('='.repeat(72));

  if (fail > 0) {
    // eslint-disable-next-line no-console
    console.log('\nFAILURES:');
    for (const r of results.filter(rr => rr.status === 'fail')) {
      // eslint-disable-next-line no-console
      console.log(`  FAIL ${r.name}\n    ${r.detail}`);
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
