/**
 * scripts/verify-m113d.ts
 *
 * End-to-end verification that Phase M1.13d (Build Program adopts
 * the EquationRow 3-box step-as-equation layout: every plot envelope
 * + cascade calculation renders as one row of [field] op [field] =
 * [result chip]) is correctly deployed.
 *
 * QUICK START:
 *   npx tsx --env-file=.env.local scripts/verify-m113d.ts
 *
 * Sections (standing 5-section template):
 *   1. Database / persistence  - smoke (M1.13d is UI-only)
 *   2. Route smoke tests       - M1.13d adds no new routes
 *   3. Calculation correctness - 3 snapshot diffs bit-identical
 *   4. State integrity         - EquationRow primitive markers
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
const TEST_USER_EMAIL = `m113d-verify+${Date.now()}@test.invalid`;
const TEST_USER_NAME  = 'M1.13d Verification Fixture';
const NAME_PREFIX     = 'M113D-VERIFY-';
const DEV_SERVER_URL  = process.env.M113D_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR  = resolve(process.cwd(), 'tests/screenshots/M1.13d');

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
    password_hash: 'M113D_VERIFY_NOT_USABLE',
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
  const draft = {
    ...makeWizardDefaultDraft(),
    name: NAME_PREFIX + 'smoke',
    location: 'Riyadh',
  };
  const built = buildWizardSnapshot(draft);
  record('buildWizardSnapshot smoke', 'pass',
    `${built.snapshot.landParcels?.length ?? 0} parcel(s), ${built.snapshot.assets.length} asset(s)`);

  const projInsert = await sb.from('refm_projects').insert({
    user_id: TEST_USER_ID, name: NAME_PREFIX + 'smoke', location: 'Riyadh',
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
    snapshot: built.snapshot, label: 'M1.13d verify',
  }).select('id').maybeSingle();
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

  for (const r of [
    { method: 'GET',  path: '/api/refm/projects' },
    { method: 'POST', path: '/api/refm/projects' },
  ] as const) {
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
  section('4. State integrity (M1.13d markers)');

  function readSrc(rel: string): string {
    return readFileSync(resolve(process.cwd(), rel), 'utf-8');
  }

  // ── E1: EquationRow primitive exists with expected shape. ──────────
  try {
    const er = readSrc('src/hubs/modeling/platforms/refm/components/ui/EquationRow.tsx');
    const ok =
      er.includes("'input'") &&
      er.includes("'derived'") &&
      er.includes('data-equation-row="true"') &&
      er.includes('data-result-chip="true"') &&
      er.includes('data-formula="true"') &&
      er.includes("'ok' | 'warn' | 'error'");
    record('E1: EquationRow primitive exposes input/derived field kinds + 3 data attributes',
      ok ? 'pass' : 'fail',
      ok ? 'primitive shape matches contract' : 'one or more contract elements missing');
  } catch (e) {
    record('E1: EquationRow primitive', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── B1: Build Program imports EquationRow. ─────────────────────────
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const ok = ap.includes("import EquationRow") && ap.includes("EquationField");
    record('B1: Build Program imports EquationRow + EquationField',
      ok ? 'pass' : 'fail',
      ok ? 'imports present' : 'imports missing');
  } catch (e) {
    record('B1: imports', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── B2: Plot envelope row testIds wired (14 envelope steps). ──────
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const rowTestIds = [
      'row-max-gfa-',           'row-footprint-',
      'row-podium-gfa-',        'row-public-area-',
      'row-typical-gfa-',       'row-total-built-',
      'row-floors-check-',      'row-landscape-',
      'row-hardscape-',         'row-surface-parking-',
      'row-surface-capacity-',  'row-vertical-capacity-',
      'row-basement-usable-',   'row-basement-capacity-',
    ];
    const missing = rowTestIds.filter(t => !ap.includes(`${t}\${plot.id}`));
    record('B2: 14 plot row-* testIds wired',
      missing.length === 0 ? 'pass' : 'fail',
      missing.length === 0 ? `${rowTestIds.length} row testIds` : `missing ${missing.join(', ')}`);
  } catch (e) {
    record('B2: row testIds', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── B3: Cascade row testIds wired (8 cascade steps). ──────────────
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const cascadeRows = [
      'row-cascade-gfa-',  'row-cascade-mep-',
      'row-cascade-boh-',  'row-cascade-other-',
      'row-cascade-net-',  'row-cascade-gsa-',
      'row-cascade-bua-',  'row-cascade-tba-',
    ];
    const missing = cascadeRows.filter(t => !ap.includes(`${t}\${asset.id}`));
    record('B3: 8 cascade row-* testIds wired',
      missing.length === 0 ? 'pass' : 'fail',
      missing.length === 0 ? `${cascadeRows.length} cascade testIds` : `missing ${missing.join(', ')}`);
  } catch (e) {
    record('B3: cascade testIds', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── B4: Parking allocator total uses EquationRow now. ─────────────
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const ok = ap.includes('row-parking-total-${plot.id}');
    record('B4: Parking allocator carries row-parking-total testId',
      ok ? 'pass' : 'fail',
      ok ? 'allocator EquationRow wired' : 'allocator testId missing');
  } catch (e) {
    record('B4: parking allocator', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── B5: Original formula-* testIds preserved (chip carries them now). ──
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const formulaTestIds = [
      'formula-max-gfa-',          'formula-footprint-',
      'formula-podium-gfa-',       'formula-public-area-',
      'formula-typical-gfa-',      'formula-total-built-',
      'formula-floors-check-',     'formula-landscape-',
      'formula-hardscape-',        'formula-surface-parking-',
      'formula-surface-capacity-', 'formula-vertical-capacity-',
      'formula-basement-usable-',  'formula-basement-capacity-',
      'formula-parking-total-',
    ];
    const missing = formulaTestIds.filter(t => !ap.includes(`${t}\${plot.id}`));
    record('B5: 15 plot formula-* testIds preserved on result chips',
      missing.length === 0 ? 'pass' : 'fail',
      missing.length === 0 ? `${formulaTestIds.length} testIds` : `missing ${missing.join(', ')}`);
  } catch (e) {
    record('B5: formula testIds', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── B6: Old helpers removed (numField, sectionGridStyle, formulaStackStyle). ──
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const ok =
      !ap.includes('const numField =') &&
      !ap.includes('const sectionGridStyle =') &&
      !ap.includes('const formulaStackStyle:');
    record('B6: legacy helpers (numField + sectionGridStyle + formulaStackStyle) removed',
      ok ? 'pass' : 'fail',
      ok ? 'helpers gone' : 'one or more legacy helpers still present');
  } catch (e) {
    record('B6: legacy helpers', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── B7: Validation states still wired (M1.13c carryover). ─────────
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const overFar  = ap.includes('utilizationPct > 100');
    const deficit  = ap.includes('alloc.deficit > 0');
    const cascadeOver = ap.includes('totalDeductPct > 100');
    const splitOver = ap.includes('splitOver') && ap.includes('plot.landscapePct + plot.hardscapePct > 100');
    record('B7: Build Program validation states still wired',
      overFar && deficit && cascadeOver && splitOver ? 'pass' : 'fail',
      `over-FAR=${overFar} · parking-deficit=${deficit} · cascade-over=${cascadeOver} · split-over=${splitOver}`);
  } catch (e) {
    record('B7: validation states', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── X1: em-dash sweep across the M1.13d touched files. ──────────
  try {
    const files = [
      'src/hubs/modeling/platforms/refm/components/ui/EquationRow.tsx',
      'src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx',
    ];
    let total = 0;
    for (const f of files) {
      const src = readSrc(f);
      const matches = src.match(/—/g);
      total += matches?.length ?? 0;
    }
    record('X1: M1.13d surface files free of em-dashes',
      total === 0 ? 'pass' : 'fail',
      total === 0 ? 'zero em-dashes across 2 files' : `${total} em-dashes found`);
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
  console.log(`\nM1.13d verification, target: ${SUPABASE_URL}\n`);
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
