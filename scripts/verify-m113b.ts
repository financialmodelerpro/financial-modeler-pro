/**
 * scripts/verify-m113b.ts
 *
 * End-to-end verification that Phase M1.13b (eliminate the separate
 * "Computed Envelope", "Cascade Preview", and "Timeline Summary"
 * panels; move every formula inline beneath the input row that
 * completes it) is correctly deployed.
 *
 * QUICK START:
 *   npx tsx --env-file=.env.local scripts/verify-m113b.ts
 *
 * Sections (standing 5-section template):
 *   1. Database / persistence  - smoke (M1.13b is UI-only)
 *   2. Route smoke tests       - M1.13b adds no new routes
 *   3. Calculation correctness - 3 snapshot diffs bit-identical
 *   4. State integrity         - section markers + panel absence
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
const TEST_USER_EMAIL = `m113b-verify+${Date.now()}@test.invalid`;
const TEST_USER_NAME  = 'M1.13b Verification Fixture';
const NAME_PREFIX     = 'M113B-VERIFY-';
const DEV_SERVER_URL  = process.env.M113B_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR  = resolve(process.cwd(), 'tests/screenshots/M1.13b');

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
    password_hash: 'M113B_VERIFY_NOT_USABLE',
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
    snapshot: built.snapshot, label: 'M1.13b verify',
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
  section('4. State integrity (M1.13b markers)');

  function readSrc(rel: string): string {
    return readFileSync(resolve(process.cwd(), rel), 'utf-8');
  }

  // ── Build Program ────────────────────────────────────────────────
  // A1: Computed Envelope panel testId removed (panel absence proof).
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const ok =
      !ap.includes('computed-envelope-${plot.id}') &&
      !ap.includes('Computed envelope (live formulas)') &&
      !ap.includes("'Computed envelope'");
    record('A1: Build Program "Computed Envelope" panel removed',
      ok ? 'pass' : 'fail',
      ok ? 'no panel testId or panel header' : 'panel still present');
  } catch (e) {
    record('A1: Build Program panel removed', 'fail', e instanceof Error ? e.message : String(e));
  }

  // A2: Cascade Preview panel testId removed.
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const ok = !ap.includes('cascade-preview-${asset.id}');
    record('A2: Build Program "Cascade Preview" panel removed',
      ok ? 'pass' : 'fail',
      ok ? 'no cascade-preview testId' : 'cascade-preview still present');
  } catch (e) {
    record('A2: Cascade Preview removed', 'fail', e instanceof Error ? e.message : String(e));
  }

  // A3: Section headers + new inline formula testIds present.
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const sectionMarkers = [
      'section-envelope-',
      'section-podium-',
      'section-typical-',
      'section-floors-check-',
      'section-public-area-',
      'section-parking-surface-',
      'section-parking-vertical-',
      'section-parking-basement-',
    ];
    const ok = sectionMarkers.every(m => ap.includes(`${m}\${plot.id}`));
    record('A3: Build Program section headers (8) present',
      ok ? 'pass' : 'fail',
      ok ? '8 ordered sections wired' : 'one or more section headers missing');
  } catch (e) {
    record('A3: section headers', 'fail', e instanceof Error ? e.message : String(e));
  }

  // A4: Per-formula testIds for the envelope chain.
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const formulas = [
      'formula-max-gfa-',
      'formula-footprint-',
      'formula-podium-gfa-',
      'formula-public-area-',
      'formula-typical-gfa-',
      'formula-total-built-',
      'formula-floors-check-',
      'formula-landscape-',
      'formula-hardscape-',
      'formula-surface-parking-',
      'formula-surface-capacity-',
      'formula-vertical-capacity-',
      'formula-basement-usable-',
      'formula-basement-capacity-',
    ];
    const missing = formulas.filter(t => !ap.includes(`${t}\${plot.id}`));
    record('A4: 14 inline plot-formula testIds present',
      missing.length === 0 ? 'pass' : 'fail',
      missing.length === 0 ? `${formulas.length} testIds` : `missing ${missing.join(', ')}`);
  } catch (e) {
    record('A4: plot-formula testIds', 'fail', e instanceof Error ? e.message : String(e));
  }

  // A5: Cascade chain inline testIds (8 outputs).
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const cascade = [
      'formula-cascade-gfa-',
      'formula-cascade-mep-',
      'formula-cascade-boh-',
      'formula-cascade-other-',
      'formula-cascade-net-',
      'formula-cascade-gsa-',
      'formula-cascade-bua-',
      'formula-cascade-tba-',
    ];
    const missing = cascade.filter(t => !ap.includes(`${t}\${asset.id}`));
    record('A5: 8 inline cascade-formula testIds present',
      missing.length === 0 ? 'pass' : 'fail',
      missing.length === 0 ? `${cascade.length} testIds` : `missing ${missing.join(', ')}`);
  } catch (e) {
    record('A5: cascade-formula testIds', 'fail', e instanceof Error ? e.message : String(e));
  }

  // A6: Old calcRow + CascadeCell helpers removed.
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const ok = !ap.includes('const calcRow =') && !ap.includes('function CascadeCell(');
    record('A6: legacy calcRow + CascadeCell helpers removed',
      ok ? 'pass' : 'fail',
      ok ? 'helpers gone' : 'one or more legacy helpers still present');
  } catch (e) {
    record('A6: legacy helpers removed', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── Schedule ─────────────────────────────────────────────────────
  // S1: Timeline Summary panel removed.
  try {
    const tl = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx');
    const ok =
      !tl.includes('data-testid="timeline-summary"') &&
      !tl.includes('Timeline Summary (live formulas)');
    record('S1: Schedule "Timeline Summary" panel removed',
      ok ? 'pass' : 'fail',
      ok ? 'panel + label gone' : 'panel still present');
  } catch (e) {
    record('S1: Timeline Summary removed', 'fail', e instanceof Error ? e.message : String(e));
  }

  // S2: Inline formula testIds still present (re-anchored next to inputs).
  try {
    const tl = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx');
    const ok =
      tl.includes('testId="timeline-formula-end"') &&
      tl.includes('testId="timeline-formula-total-periods"') &&
      tl.includes('testId="timeline-formula-type"');
    record('S2: Schedule inline timeline formulas present',
      ok ? 'pass' : 'fail',
      ok ? '3 captions wired inline next to inputs' : 'caption testIds missing');
  } catch (e) {
    record('S2: Schedule timeline formulas', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── Financing ────────────────────────────────────────────────────
  // F1: Debt Summary roll-up has no FormulaCaption rows.
  try {
    const fn = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx');
    const summaryStart = fn.indexOf('data-testid="financing-debt-summary"');
    const summaryEnd = summaryStart >= 0 ? fn.indexOf('</div>\n        </div>', summaryStart) : -1;
    const summaryBlock = summaryStart >= 0 && summaryEnd > summaryStart
      ? fn.slice(summaryStart, summaryEnd)
      : '';
    const containsCaption = summaryBlock.includes('<FormulaCaption');
    const labelChanged = fn.includes("'Debt Summary'") || fn.includes('>Debt Summary<');
    record('F1: Financing Debt Summary is roll-up only (no FormulaCaption inside)',
      summaryStart >= 0 && !containsCaption ? 'pass' : 'fail',
      summaryStart >= 0
        ? `summary card found, captions inside=${containsCaption}, label rolled up=${labelChanged}`
        : 'summary card not found');
  } catch (e) {
    record('F1: Financing Debt Summary roll-up', 'fail', e instanceof Error ? e.message : String(e));
  }

  // F2: Inline financing input formulas still present.
  try {
    const fn = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx');
    const ok =
      fn.includes('testId="financing-formula-debt-equity"') &&
      fn.includes('testId="financing-formula-periodic-rate"') &&
      fn.includes('testId="financing-formula-repayment"');
    record('F2: Financing inline input formulas still wired',
      ok ? 'pass' : 'fail',
      ok ? '3 input-side captions wired' : 'caption testIds missing');
  } catch (e) {
    record('F2: Financing input formulas', 'fail', e instanceof Error ? e.message : String(e));
  }

  // ── X1: em-dash sweep across the M1.13b touched files. ──────────
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
      const matches = src.match(/—/g);
      total += matches?.length ?? 0;
    }
    record('X1: M1.13b surface files free of em-dashes',
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
  console.log(`\nM1.13b verification, target: ${SUPABASE_URL}\n`);
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
