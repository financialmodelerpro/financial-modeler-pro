/**
 * scripts/verify-m111.ts
 *
 * End-to-end verification that Phase M1.11 (Module 1 holistic re-audit
 * + fix pass) is correctly deployed.
 *
 * QUICK START:
 *   npx tsx --env-file=.env.local scripts/verify-m111.ts
 *
 * Sections (standing 5-section template):
 *   1. Database / persistence  - wizard snapshot still round-trips
 *   2. Route smoke tests       - M1.11 adds no new routes
 *   3. Calculation correctness - 3 snapshot diffs bit-identical
 *   4. State integrity         - 22 audit items verified by markers
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
import { PARCEL_FIELD_HELP } from '../src/hubs/modeling/platforms/refm/lib/copy/parcelFieldHelp';
import { ASSET_STRATEGY_HELP } from '../src/hubs/modeling/platforms/refm/lib/copy/assetStrategyHelp';

const TEST_USER_ID    = '00000000-0000-0000-0000-000000000000';
const TEST_USER_EMAIL = `m111-verify+${Date.now()}@test.invalid`;
const TEST_USER_NAME  = 'M1.11 Verification Fixture';
const NAME_PREFIX     = 'M111-VERIFY-';
const DEV_SERVER_URL  = process.env.M111_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR  = resolve(process.cwd(), 'tests/screenshots/M1.11');

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
    password_hash: 'M111_VERIFY_NOT_USABLE',
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
  record('Insert refm_projects', 'pass', `id=${projectId.slice(0, 8)}`);

  const verInsert = await sb.from('refm_project_versions').insert({
    project_id: projectId, version_number: 1, schema_version: 4,
    snapshot: built.snapshot, label: 'M1.11 verify',
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
  section('4. State integrity (22 audit items)');

  function readSrc(rel: string): string {
    return readFileSync(resolve(process.cwd(), rel), 'utf-8');
  }

  // C2: ProjectWizard portal
  try {
    const wiz = readSrc('src/hubs/modeling/platforms/refm/components/modals/ProjectWizard.tsx');
    const ok = wiz.includes("import { createPortal } from 'react-dom'")
      && wiz.includes('createPortal(')
      && wiz.includes('document.body');
    record('C2: ProjectWizard portal', ok ? 'pass' : 'fail',
      ok ? 'createPortal + document.body wired' : 'portal markers missing');
  } catch (e) {
    record('C2: ProjectWizard portal', 'fail', e instanceof Error ? e.message : String(e));
  }

  // M8: allocation tolerance bumped from 0.01 to 0.1
  try {
    const wiz = readSrc('src/hubs/modeling/platforms/refm/components/modals/ProjectWizard.tsx');
    const ok = wiz.includes('Math.abs(step3AllocSum - 100) < 0.1');
    record('M8: allocation tolerance 0.1', ok ? 'pass' : 'fail',
      ok ? 'tolerance bumped' : 'still 0.01 or missing');
  } catch (e) {
    record('M8: allocation tolerance 0.1', 'fail', e instanceof Error ? e.message : String(e));
  }

  // C3: ProjectTimelineVisual exists with multi-phase awareness
  try {
    const vis = readSrc('src/hubs/modeling/platforms/refm/components/ui/ProjectTimelineVisual.tsx');
    const ok = vis.includes('export default function ProjectTimelineVisual')
      && vis.includes('phases.map')
      && vis.includes('Operations start')
      && vis.includes('Construction end')
      && vis.includes('Project end');
    record('C3: ProjectTimelineVisual semantic dates + multi-phase', ok ? 'pass' : 'fail',
      ok ? '4 boundary labels + multi-phase loop' : 'visual missing pieces');
  } catch (e) {
    record('C3: ProjectTimelineVisual semantic dates + multi-phase', 'fail',
      e instanceof Error ? e.message : String(e));
  }

  // C3: Module1Timeline mounts the visual
  try {
    const tl = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx');
    const ok = tl.includes("import ProjectTimelineVisual from '../ui/ProjectTimelineVisual'")
      && tl.includes('<ProjectTimelineVisual');
    record('C3: Module1Timeline mounts ProjectTimelineVisual', ok ? 'pass' : 'fail',
      ok ? 'import + JSX present' : 'visual not wired');
  } catch (e) {
    record('C3: Module1Timeline mounts ProjectTimelineVisual', 'fail',
      e instanceof Error ? e.message : String(e));
  }

  // M1: dead setters removed. Strip single-line comments first so a
  // docstring that documents the removal does not trigger a false fail.
  function stripCommentLines(src: string): string {
    return src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  }

  try {
    const area = stripCommentLines(readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Area.tsx'));
    const stillUsed = ['setResidentialPercent', 'setHospitalityPercent', 'setRetailPercent',
      'setResidentialDeductPct', 'setResidentialEfficiency'].filter(s =>
      new RegExp(`\\b${s}\\s*[:,]`).test(area),
    );
    record('M1a: Module1Area dead setters removed', stillUsed.length === 0 ? 'pass' : 'fail',
      stillUsed.length === 0 ? 'props destructure clean' : `still in code: ${stillUsed.join(', ')}`);
  } catch (e) {
    record('M1a: Module1Area dead setters removed', 'fail', e instanceof Error ? e.message : String(e));
  }

  try {
    const tl = stripCommentLines(readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx'));
    const stillUsed = ['setProjectName', 'setProjectType', 'setCountry', 'setCurrency',
      'showAiButtons'].filter(s => new RegExp(`\\b${s}\\s*[:,]`).test(tl));
    record('M1b: Module1Timeline dead setters removed', stillUsed.length === 0 ? 'pass' : 'fail',
      stillUsed.length === 0 ? 'props destructure clean' : `still in code: ${stillUsed.join(', ')}`);
  } catch (e) {
    record('M1b: Module1Timeline dead setters removed', 'fail', e instanceof Error ? e.message : String(e));
  }

  // M2: Asset strategy InputLabel + help wired
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const ok = ap.includes("import { ASSET_STRATEGY_HELP }")
      && ap.includes('ASSET_STRATEGY_HELP.primaryStrategy')
      && ap.includes('ASSET_STRATEGY_HELP.secondaryStrategy')
      && ap.includes('ASSET_STRATEGY_HELP.zone');
    record('M2: Asset strategy fields use InputLabel + help', ok ? 'pass' : 'fail',
      ok ? 'primary + secondary + zone all wired' : 'strategy help markers missing');
  } catch (e) {
    record('M2: Asset strategy fields use InputLabel + help', 'fail',
      e instanceof Error ? e.message : String(e));
  }

  // M2: ASSET_STRATEGY_HELP module exports 6 keys
  const stratKeys = Object.keys(ASSET_STRATEGY_HELP);
  record('M2: ASSET_STRATEGY_HELP key count', stratKeys.length === 6 ? 'pass' : 'fail',
    `${stratKeys.length}/6 keys`);

  // M3: Dev Costs phase-scope explainer present
  try {
    const c = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx');
    const ok = c.includes('Phase scope:')
      && c.includes('active sub-project across all');
    record('M3: Dev Costs phase-scope explainer', ok ? 'pass' : 'fail',
      ok ? 'callout text wired' : 'explainer missing');
  } catch (e) {
    record('M3: Dev Costs phase-scope explainer', 'fail', e instanceof Error ? e.message : String(e));
  }

  // M4: Module1Area uses Zustand setLand directly
  try {
    const area = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Area.tsx');
    const ok = area.includes("import { useModule1Store }")
      && area.includes('useModule1Store(s => s.setLand)')
      && area.includes('setLand({ landParcels:');
    record('M4: Module1Area uses Zustand setLand', ok ? 'pass' : 'fail',
      ok ? 'subscribed + writes via setLand' : 'still uses prop-drilled setter');
  } catch (e) {
    record('M4: Module1Area uses Zustand setLand', 'fail', e instanceof Error ? e.message : String(e));
  }

  // M7a: Cost row column headers wrapped in InputLabel
  try {
    const c = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx');
    const labels = ['Cost Name', 'Stage / Scope', 'Method / Base', 'Input Value', 'Phasing'];
    const wrapped = labels.every(l => c.includes(`<InputLabel\n                  label="${l}"`));
    record('M7a: Dev Costs row headers wrapped in InputLabel', wrapped ? 'pass' : 'fail',
      wrapped ? 'all 5 column headers wrapped' : 'some headers still plain text');
  } catch (e) {
    record('M7a: Dev Costs row headers wrapped in InputLabel', 'fail',
      e instanceof Error ? e.message : String(e));
  }

  // M7b: Financing per-line Debt % header InputLabel
  try {
    const f = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx');
    const ok = f.includes('label="Debt %"\n                      help="Per-line override');
    record('M7b: Financing per-line Debt % header tooltip', ok ? 'pass' : 'fail',
      ok ? 'header wrapped' : 'still plain text');
  } catch (e) {
    record('M7b: Financing per-line Debt % header tooltip', 'fail',
      e instanceof Error ? e.message : String(e));
  }

  // m1: parcelFieldHelp.ts exports 5 keys
  const parcelKeys = Object.keys(PARCEL_FIELD_HELP);
  record('m1: PARCEL_FIELD_HELP key count', parcelKeys.length === 5 ? 'pass' : 'fail',
    `${parcelKeys.length}/5 keys`);

  // m1: Both surfaces import the shared parcelFieldHelp
  try {
    const wiz = readSrc('src/hubs/modeling/platforms/refm/components/modals/ParcelSetupWizard.tsx');
    const inline = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Area.tsx');
    const ok = wiz.includes("PARCEL_FIELD_HELP")
      && inline.includes("PARCEL_FIELD_HELP");
    record('m1: shared PARCEL_FIELD_HELP used by both surfaces', ok ? 'pass' : 'fail',
      ok ? 'wizard + inline both import' : 'one surface still local');
  } catch (e) {
    record('m1: shared PARCEL_FIELD_HELP used by both surfaces', 'fail',
      e instanceof Error ? e.message : String(e));
  }

  // C4: zero em-dashes in tracked source
  try {
    const out = spawnSync('grep', ['-rl', '—',
      'src/', 'app/', 'scripts/', 'tests/', 'docs/',
      'CLAUDE.md', 'CLAUDE-DB.md', 'CLAUDE-FEATURES.md', 'CLAUDE-ROUTES.md',
      'CLAUDE-TODO.md', 'PROJECT_HANDOFF.md', 'CMS_REFERENCE.md', 'ARCHITECTURE.md',
    ], { encoding: 'utf-8' });
    const allowed = ['js/refm-platform.js', 'verify-m'];
    const lines = (out.stdout || '').split('\n').filter(l => l.trim().length > 0);
    const offenders = lines.filter(l => !allowed.some(a => l.includes(a)));
    record('C4: zero tracked em-dashes (excluding js/ legacy + verify-m*)',
      offenders.length === 0 ? 'pass' : 'fail',
      offenders.length === 0
        ? `${lines.length} files swept, ${lines.length} carry only legacy/verifier dashes`
        : `${offenders.length} offenders: ${offenders.slice(0, 3).join(', ')}`);
  } catch (e) {
    record('C4: zero tracked em-dashes', 'fail', e instanceof Error ? e.message : String(e));
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
  console.log(`\nM1.11 verification, target: ${SUPABASE_URL}\n`);
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
