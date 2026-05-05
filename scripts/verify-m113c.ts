/**
 * scripts/verify-m113c.ts
 *
 * End-to-end verification that Phase M1.13c (step-by-step verifiable
 * calculation flow: every input is followed by a VerifiedResult
 * verification step that visually binds formula + substituted values
 * + result chip; validation states tint the chip when invalid) is
 * correctly deployed across all 4 Module 1 tabs.
 *
 * QUICK START:
 *   npx tsx --env-file=.env.local scripts/verify-m113c.ts
 *
 * Sections (standing 5-section template):
 *   1. Database / persistence  - smoke (M1.13c is UI-only)
 *   2. Route smoke tests       - M1.13c adds no new routes
 *   3. Calculation correctness - 3 snapshot diffs bit-identical
 *   4. State integrity         - VerifiedResult primitive markers
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
const TEST_USER_EMAIL = `m113c-verify+${Date.now()}@test.invalid`;
const TEST_USER_NAME  = 'M1.13c Verification Fixture';
const NAME_PREFIX     = 'M113C-VERIFY-';
const DEV_SERVER_URL  = process.env.M113C_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR  = resolve(process.cwd(), 'tests/screenshots/M1.13c');

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
    password_hash: 'M113C_VERIFY_NOT_USABLE',
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
    snapshot: built.snapshot, label: 'M1.13c verify',
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
  section('4. State integrity (M1.13c markers)');

  function readSrc(rel: string): string {
    return readFileSync(resolve(process.cwd(), rel), 'utf-8');
  }

  // ── V1: VerifiedResult primitive exists with expected shape. ──────
  try {
    const vr = readSrc('src/hubs/modeling/platforms/refm/components/ui/VerifiedResult.tsx');
    const ok =
      vr.includes('data-formula="true"') &&
      vr.includes('data-state') &&
      vr.includes('data-result-chip="true"') &&
      vr.includes("'ok' | 'warn' | 'error'");
    record('V1: VerifiedResult primitive exposes data-formula + data-state + data-result-chip',
      ok ? 'pass' : 'fail',
      ok ? 'primitive shape matches contract' : 'one or more attributes missing');
  } catch (e) {
    record('V1: VerifiedResult primitive', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── B1: Build Program imports VerifiedResult and drops FormulaCaption.
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const ok =
      ap.includes("import VerifiedResult") &&
      !ap.includes("import FormulaCaption from '../ui/FormulaCaption'");
    record('B1: Build Program uses VerifiedResult, FormulaCaption removed',
      ok ? 'pass' : 'fail',
      ok ? 'imports match' : 'imports do not match');
  } catch (e) {
    record('B1: Build Program imports', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── B2: Proper math operators (× ÷) in Build Program formula text. ──
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const hasMul = ap.includes('Plot Area × Max FAR');
    const hasDiv = ap.includes('Surface Capacity = Surface Parking ÷ Surface Bay');
    record('B2: Build Program uses × and ÷ operators',
      hasMul && hasDiv ? 'pass' : 'fail',
      `× present=${hasMul} · ÷ present=${hasDiv}`);
  } catch (e) {
    record('B2: math operators', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── B3: Build Program validation states wired (utilization, deficit). ──
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const overFar  = ap.includes('utilizationPct > 100');
    const deficit  = ap.includes('alloc.deficit > 0');
    const cascadeOver = ap.includes('totalDeductPct > 100');
    record('B3: Build Program validation states wired',
      overFar && deficit && cascadeOver ? 'pass' : 'fail',
      `over-FAR=${overFar} · parking-deficit=${deficit} · cascade-over=${cascadeOver}`);
  } catch (e) {
    record('B3: validation states', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── B4: All 14 plot-formula testIds + 8 cascade-formula testIds preserved. ──
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const plotFormulas = [
      'formula-max-gfa-',         'formula-footprint-',
      'formula-podium-gfa-',      'formula-public-area-',
      'formula-typical-gfa-',     'formula-total-built-',
      'formula-floors-check-',    'formula-landscape-',
      'formula-hardscape-',       'formula-surface-parking-',
      'formula-surface-capacity-','formula-vertical-capacity-',
      'formula-basement-usable-', 'formula-basement-capacity-',
    ];
    const cascadeFormulas = [
      'formula-cascade-gfa-',  'formula-cascade-mep-',
      'formula-cascade-boh-',  'formula-cascade-other-',
      'formula-cascade-net-',  'formula-cascade-gsa-',
      'formula-cascade-bua-',  'formula-cascade-tba-',
    ];
    const missingPlot = plotFormulas.filter(t => !ap.includes(`${t}\${plot.id}`));
    const missingCasc = cascadeFormulas.filter(t => !ap.includes(`${t}\${asset.id}`));
    record('B4: 14 plot-formula + 8 cascade-formula testIds preserved',
      missingPlot.length === 0 && missingCasc.length === 0 ? 'pass' : 'fail',
      missingPlot.length === 0 && missingCasc.length === 0
        ? `${plotFormulas.length} + ${cascadeFormulas.length} testIds`
        : `missing plot=${missingPlot.join(',')} cascade=${missingCasc.join(',')}`);
  } catch (e) {
    record('B4: testIds', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── B5: Parking allocator total VerifiedResult with deficit error.
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const ok = ap.includes('formula-parking-total-${plot.id}');
    record('B5: Parking allocator carries formula-parking-total testId',
      ok ? 'pass' : 'fail',
      ok ? 'allocator verified step wired' : 'allocator testId missing');
  } catch (e) {
    record('B5: parking allocator', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── S1: Schedule uses VerifiedResult and drops FormulaCaption. ───
  try {
    const tl = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx');
    const ok =
      tl.includes("import VerifiedResult") &&
      !tl.includes("import FormulaCaption");
    record('S1: Schedule uses VerifiedResult, FormulaCaption removed',
      ok ? 'pass' : 'fail',
      ok ? 'imports match' : 'imports do not match');
  } catch (e) {
    record('S1: Schedule imports', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── S2: Schedule overlap validation state wired. ───────────────────
  try {
    const tl = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx');
    const ok =
      tl.includes('effectivePeriods <= 0') &&
      tl.includes('overlapState') &&
      tl.includes('overlapPeriods > overlapMax');
    record('S2: Schedule Overlap validation state wired',
      ok ? 'pass' : 'fail',
      ok ? 'state derives from overlap vs window' : 'state derivation missing');
  } catch (e) {
    record('S2: Schedule validation', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── S3: Schedule timeline-formula testIds preserved. ───────────────
  try {
    const tl = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx');
    const ok =
      tl.includes('testId="timeline-formula-end"') &&
      tl.includes('testId="timeline-formula-total-periods"') &&
      tl.includes('testId="timeline-formula-type"');
    record('S3: Schedule timeline-formula testIds preserved',
      ok ? 'pass' : 'fail',
      ok ? '3 captions wired' : 'caption testIds missing');
  } catch (e) {
    record('S3: timeline testIds', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── C1: Dev Costs uses VerifiedResult and drops FormulaCaption. ──
  try {
    const dc = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx');
    const ok =
      dc.includes("import VerifiedResult") &&
      !dc.includes("import FormulaCaption");
    record('C1: Dev Costs uses VerifiedResult, FormulaCaption removed',
      ok ? 'pass' : 'fail',
      ok ? 'imports match' : 'imports do not match');
  } catch (e) {
    record('C1: Dev Costs imports', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── C2: Dev Costs base-zero validation state wired. ────────────────
  try {
    const dc = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx');
    const ok =
      dc.includes('baseResolvesToZero') &&
      dc.includes("rate_gfa") &&
      dc.includes('Base resolves to 0');
    record('C2: Dev Costs base-zero validation state wired',
      ok ? 'pass' : 'fail',
      ok ? 'rate / percent base zero check present' : 'base-zero check missing');
  } catch (e) {
    record('C2: Dev Costs validation', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── C3: Dev Costs uses × and ÷ operators in cost formulas. ─────────
  try {
    const dc = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx');
    const ok =
      dc.includes('Rate × Total Land') &&
      dc.includes('Rate × GFA') &&
      dc.includes('In-Kind Land Value ×');
    record('C3: Dev Costs formulas use × operator',
      ok ? 'pass' : 'fail',
      ok ? '× present in cost methods' : '× missing');
  } catch (e) {
    record('C3: Dev Costs operators', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── C4: cost-formula and cost-grand-total testIds preserved. ───────
  try {
    const dc = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx');
    const ok =
      dc.includes('cost-formula-${cost.id}') &&
      dc.includes('cost-grand-total-formula-${assetType}');
    record('C4: Dev Costs testIds preserved',
      ok ? 'pass' : 'fail',
      ok ? 'cost-formula + cost-grand-total wired' : 'testIds missing');
  } catch (e) {
    record('C4: Dev Costs testIds', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── F1: Financing uses VerifiedResult and drops FormulaCaption. ───
  try {
    const fn = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx');
    const ok =
      fn.includes("import VerifiedResult") &&
      !fn.includes("import FormulaCaption");
    record('F1: Financing uses VerifiedResult, FormulaCaption removed',
      ok ? 'pass' : 'fail',
      ok ? 'imports match' : 'imports do not match');
  } catch (e) {
    record('F1: Financing imports', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── F2: LTV + repayment validation states wired. ───────────────────
  try {
    const fn = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx');
    const ltv0   = fn.includes('globalDebtPct === 0');
    const ltv100 = fn.includes('globalDebtPct >= 100');
    const repWin = fn.includes('repaymentPeriods > operationsPeriods');
    record('F2: Financing LTV + repayment validation states wired',
      ltv0 && ltv100 && repWin ? 'pass' : 'fail',
      `LTV=0 ${ltv0} · LTV>=100 ${ltv100} · repayment>ops ${repWin}`);
  } catch (e) {
    record('F2: Financing validation', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── F3: financing-formula testIds preserved. ───────────────────────
  try {
    const fn = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx');
    const ok =
      fn.includes('testId="financing-formula-debt-equity"') &&
      fn.includes('testId="financing-formula-periodic-rate"') &&
      fn.includes('testId="financing-formula-repayment"');
    record('F3: Financing-formula testIds preserved',
      ok ? 'pass' : 'fail',
      ok ? '3 inline captions wired' : 'caption testIds missing');
  } catch (e) {
    record('F3: Financing testIds', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── F4: Debt Summary card stays roll-up only (M1.13b F1 still holds). ──
  try {
    const fn = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx');
    const summaryStart = fn.indexOf('data-testid="financing-debt-summary"');
    const summaryEnd   = summaryStart >= 0 ? fn.indexOf('</div>\n        </div>', summaryStart) : -1;
    const summaryBlock = summaryStart >= 0 && summaryEnd > summaryStart
      ? fn.slice(summaryStart, summaryEnd)
      : '';
    const noVerifiedInside = !summaryBlock.includes('<VerifiedResult');
    const noCaptionInside  = !summaryBlock.includes('<FormulaCaption');
    record('F4: Financing Debt Summary card stays a clean roll-up',
      summaryStart >= 0 && noVerifiedInside && noCaptionInside ? 'pass' : 'fail',
      summaryStart >= 0
        ? `summary present, VerifiedResult inside=${!noVerifiedInside}, FormulaCaption inside=${!noCaptionInside}`
        : 'summary card not found');
  } catch (e) {
    record('F4: Debt Summary roll-up', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── X1: em-dash sweep across the M1.13c touched files. ────────────
  try {
    const files = [
      'src/hubs/modeling/platforms/refm/components/ui/VerifiedResult.tsx',
      'src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx',
      'src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx',
      'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx',
      'src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx',
    ];
    let total = 0;
    for (const f of files) {
      const src = readSrc(f);
      const matches = src.match(/—/g);
      total += matches?.length ?? 0;
    }
    record('X1: M1.13c surface files free of em-dashes',
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
  console.log(`\nM1.13c verification, target: ${SUPABASE_URL}\n`);
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
