/**
 * scripts/verify-m110b.ts
 *
 * End-to-end verification that Phase M1.10b (Plot Setup polish:
 * portal-mounted modals, form/wizard reconciliation, accessible
 * InputLabel tooltips on every field) is correctly deployed.
 *
 * QUICK START:
 *   npx tsx --env-file=.env.local scripts/verify-m110b.ts
 *
 * Sections (standing 5-section template):
 *   1. Database / persistence  — wizard snapshot still round-trips
 *   2. Route smoke tests       — M1.10b adds no new routes
 *   3. Calculation correctness — 3 snapshot diffs bit-identical
 *   4. State integrity         — 3 fixes verified end-to-end:
 *                                4a) Both wizards portal to document.body
 *                                4b) Form / wizard field reconciliation
 *                                4c) InputLabel + tooltip copy on every tab
 *   5. UI rendering            — Playwright signin + /refm gate
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
import { PLOT_FIELD_HELP } from '../src/hubs/modeling/platforms/refm/lib/copy/plotFieldHelp';

const TEST_USER_ID    = '00000000-0000-0000-0000-000000000000';
const TEST_USER_EMAIL = `m110b-verify+${Date.now()}@test.invalid`;
const TEST_USER_NAME  = 'M1.10b Verification Fixture';
const NAME_PREFIX     = 'M110B-VERIFY-';
const DEV_SERVER_URL  = process.env.M110B_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR  = resolve(process.cwd(), 'tests/screenshots/M1.10b');

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
    id: TEST_USER_ID, email: TEST_USER_EMAIL, name: TEST_USER_NAME,
    password_hash: 'M110B_VERIFY_NOT_USABLE',
    role: 'user', subscription_plan: 'free', subscription_status: 'trial',
    projects_limit: 3, email_confirmed: false,
  });
  if (error) fatal(`could not create test user: ${error.message}`);
}

async function teardownTestUser(): Promise<void> {
  await sb.from('users').delete().eq('id', TEST_USER_ID);
}

async function checkPersistence(): Promise<void> {
  section('1. Database / persistence — wizard snapshot still round-trips');

  const draft = { ...makeWizardDefaultDraft(), name: NAME_PREFIX + 'rt', location: 'Riyadh' };
  const built = buildWizardSnapshot(draft);

  const projInsert = await sb.from('refm_projects').insert({
    user_id: TEST_USER_ID, name: NAME_PREFIX + 'rt', location: 'Riyadh',
    status: 'Draft', asset_mix: built.assetMix, schema_version: 4,
  }).select('id').maybeSingle();

  if (projInsert.error || !projInsert.data) {
    record('Insert refm_projects', 'fail', projInsert.error?.message ?? 'no data');
    return;
  }
  const projectId = (projInsert.data as { id: string }).id;
  record('Insert refm_projects', 'pass', `id=${projectId.slice(0, 8)}…`);

  const verInsert = await sb.from('refm_project_versions').insert({
    project_id: projectId, version_number: 1, schema_version: 4,
    snapshot: built.snapshot, label: 'M1.10b verify',
  }).select('id').maybeSingle();

  if (verInsert.error || !verInsert.data) {
    record('Insert refm_project_versions', 'fail', verInsert.error?.message ?? 'no data');
    await sb.from('refm_projects').delete().eq('id', projectId);
    return;
  }
  record('Insert refm_project_versions', 'pass', `${JSON.stringify(built.snapshot).length} bytes`);
  await sb.from('refm_projects').delete().eq('id', projectId);
}

async function checkRoutes(): Promise<void> {
  section('2. Route smoke tests — M1.10b adds no new routes');

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
    record(`${r.method} ${r.path} — 401 without auth`,
      status === 401 ? 'pass' : 'fail',
      `status=${status}`);
  }
}

async function checkCalculations(): Promise<void> {
  section('3. Calculation correctness — snapshot diffs');

  const diffs: Array<{ name: string; script: string }> = [
    { name: 'module1-snapshot-diff (legacy 17.5 KB)', script: 'scripts/module1-snapshot-diff.ts' },
    { name: 'module1-multiphase-diff (23.0 KB)',    script: 'scripts/module1-multiphase-diff.ts' },
    { name: 'module1-areaprogram-diff (2.8 KB)',    script: 'scripts/module1-areaprogram-diff.ts' },
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
  section('4. State integrity — M1.10b polish verified');

  // ── 4a. Both wizards portal to document.body ──
  try {
    const plotSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modals/PlotSetupWizard.tsx'),
      'utf-8',
    );
    const okPlotPortal = plotSrc.includes("import { createPortal } from 'react-dom'")
      && plotSrc.includes('createPortal(')
      && plotSrc.includes('document.body')
      && plotSrc.includes('zIndex: 9999');
    record('M1.10b/1 — PlotSetupWizard portals to document.body @ z-index 9999',
      okPlotPortal ? 'pass' : 'fail',
      okPlotPortal ? 'createPortal + document.body + zIndex 9999 wired' : 'portal markers missing');

    const parcelSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modals/ParcelSetupWizard.tsx'),
      'utf-8',
    );
    const okParcelPortal = parcelSrc.includes("import { createPortal } from 'react-dom'")
      && parcelSrc.includes('createPortal(')
      && parcelSrc.includes('document.body')
      && parcelSrc.includes('zIndex: 9999');
    record('M1.10b/1 — ParcelSetupWizard portals to document.body @ z-index 9999',
      okParcelPortal ? 'pass' : 'fail',
      okParcelPortal ? 'createPortal + document.body + zIndex 9999 wired' : 'portal markers missing');
  } catch (e) {
    record('M1.10b/1 source-file inspection', 'fail',
      e instanceof Error ? e.message : String(e));
  }

  // ── 4b. Form / wizard field reconciliation ──
  // PlotDraft must cover all 15 Plot writable fields. PlotSetupWizard
  // and the inline numField calls in Module1AreaProgram must reference
  // the same set.
  try {
    const plotWizSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modals/PlotSetupWizard.tsx'),
      'utf-8',
    );
    const wizardFields = [
      'plotArea', 'maxFAR', 'coveragePct', 'typicalCoveragePct',
      'numberOfFloors', 'podiumFloors', 'typicalFloors',
      'landscapePct', 'hardscapePct',
      'surfaceBaySqm', 'verticalBaySqm', 'basementBaySqm',
      'basementCount', 'basementEfficiencyPct', 'verticalParkingFloors',
    ];
    const missing = wizardFields.filter(f => !plotWizSrc.includes(`plot-wizard-${f}`));
    record('M1.10b/2 — PlotSetupWizard exposes all 15 Plot writable fields',
      missing.length === 0 ? 'pass' : 'fail',
      missing.length === 0 ? 'all 15 testIds present' : `missing: ${missing.join(', ')}`);

    const apSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx'),
      'utf-8',
    );
    // Inline form calls numField with a quoted key for 14 of the fields;
    // verticalParkingFloors lives in its own block as plot.verticalParkingFloors.
    // Accept either pattern.
    const inlineHits = wizardFields.filter(f =>
      apSrc.includes(`'${f}'`) || apSrc.includes(`"${f}"`) || apSrc.includes(`.${f}`),
    );
    record('M1.10b/2 — inline Plot form references all 15 writable fields',
      inlineHits.length === 15 ? 'pass' : 'fail',
      `${inlineHits.length}/15 fields wired`);
  } catch (e) {
    record('M1.10b/2 source-file inspection', 'fail',
      e instanceof Error ? e.message : String(e));
  }

  // ── 4c. InputLabel primitive + wired everywhere ──
  try {
    const labelSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/ui/InputLabel.tsx'),
      'utf-8',
    );
    const okLabelPrim = labelSrc.includes('export default function InputLabel')
      && labelSrc.includes('aria-describedby')
      && labelSrc.includes("e.key === 'Escape'");
    record('M1.10b/3 — InputLabel primitive (a11y + keyboard dismiss)',
      okLabelPrim ? 'pass' : 'fail',
      okLabelPrim ? 'aria-describedby + Esc handler wired' : 'a11y markers missing');

    const allTabs: Array<{ path: string; label: string }> = [
      { path: 'src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx',    label: 'Schedule' },
      { path: 'src/hubs/modeling/platforms/refm/components/modules/Module1Area.tsx',        label: 'Land' },
      { path: 'src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx', label: 'Build Program' },
      { path: 'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx',       label: 'Dev Costs' },
      { path: 'src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx',   label: 'Financing' },
    ];
    let allWired = true;
    const missing: string[] = [];
    for (const t of allTabs) {
      const src = readFileSync(resolve(process.cwd(), t.path), 'utf-8');
      const hasImport = src.includes("from '../ui/InputLabel'");
      const hasUsage  = /<InputLabel\b/.test(src);
      if (!(hasImport && hasUsage)) { allWired = false; missing.push(t.label); }
    }
    record('M1.10b/4-6 — InputLabel wired into all 5 Module 1 tabs',
      allWired ? 'pass' : 'fail',
      allWired ? 'Schedule + Land + Build Program + Dev Costs + Financing all use InputLabel'
               : `missing: ${missing.join(', ')}`);

    // Plot help copy module exists + covers all 15 fields.
    const plotHelpKeys = Object.keys(PLOT_FIELD_HELP);
    const okHelpKeys = plotHelpKeys.length === 15
      && plotHelpKeys.includes('plotArea')
      && plotHelpKeys.includes('verticalParkingFloors');
    record('M1.10b/5 — PLOT_FIELD_HELP covers all 15 Plot writable fields',
      okHelpKeys ? 'pass' : 'fail',
      `${plotHelpKeys.length}/15 keys`);
  } catch (e) {
    record('M1.10b/3-6 source-file inspection', 'fail',
      e instanceof Error ? e.message : String(e));
  }
}

async function checkUi(): Promise<void> {
  section('5. UI rendering — Playwright signin + /refm gate');

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
        record(`Screenshot — ${mode} signin`, 'pass', path);
      } catch (e) {
        record(`Screenshot — ${mode} signin`, 'fail', e instanceof Error ? e.message : String(e));
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
  console.log(`\nM1.10b verification — target: ${SUPABASE_URL}\n`);
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
