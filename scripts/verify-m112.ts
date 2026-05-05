/**
 * scripts/verify-m112.ts
 *
 * End-to-end verification that Phase M1.12 (Land tab elimination + tab
 * consolidation 5→4) is correctly deployed.
 *
 * QUICK START:
 *   npx tsx --env-file=.env.local scripts/verify-m112.ts
 *
 * Sections (standing 5-section template):
 *   1. Database / persistence  - wizard snapshot with parcels round-trips
 *   2. Route smoke tests       - M1.12 adds no new routes
 *   3. Calculation correctness - 3 snapshot diffs bit-identical
 *   4. State integrity         - M1.12 markers verified statically
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
const TEST_USER_EMAIL = `m112-verify+${Date.now()}@test.invalid`;
const TEST_USER_NAME  = 'M1.12 Verification Fixture';
const NAME_PREFIX     = 'M112-VERIFY-';
const DEV_SERVER_URL  = process.env.M112_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR  = resolve(process.cwd(), 'tests/screenshots/M1.12');

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
    password_hash: 'M112_VERIFY_NOT_USABLE',
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

  // Build a wizard draft with a non-default 2-parcel land plan and confirm
  // the snapshot retains both rows after round-trip through Supabase.
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
    record('Wizard snapshot includes parcels[]', 'fail',
      `expected 2 parcels, got ${built.snapshot.landParcels?.length ?? 'undefined'}`);
    return;
  }
  const totalArea = built.snapshot.landParcels.reduce((s, p) => s + p.area, 0);
  record('Wizard snapshot includes parcels[]', totalArea === 120000 ? 'pass' : 'fail',
    `totalArea=${totalArea} (expected 120000)`);

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
    snapshot: built.snapshot, label: 'M1.12 verify',
  }).select('id, snapshot').maybeSingle();

  if (verInsert.error || !verInsert.data) {
    record('Insert refm_project_versions', 'fail', verInsert.error?.message ?? 'no data');
    await sb.from('refm_projects').delete().eq('id', projectId);
    return;
  }
  const stored = (verInsert.data as { snapshot: { landParcels: Array<{ id: number }> } }).snapshot;
  const rtOk = Array.isArray(stored.landParcels) && stored.landParcels.length === 2;
  record('Round-trip refm_project_versions parcels[]', rtOk ? 'pass' : 'fail',
    rtOk ? `${stored.landParcels.length} parcels round-tripped` : 'parcels lost');
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
  section('4. State integrity (M1.12 markers)');

  function readSrc(rel: string): string {
    return readFileSync(resolve(process.cwd(), rel), 'utf-8');
  }

  // F1: m1Tabs collapsed to 4 entries (Schedule / Build Program / Costs / Financing)
  try {
    const rep = readSrc('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx');
    const tabsBlock = rep.match(/export const m1Tabs = \[([\s\S]*?)\];/)?.[1] ?? '';
    const hasArea = /key:\s*'area'/.test(tabsBlock);
    const has4Tabs =
      /key:\s*'timeline'/.test(tabsBlock) &&
      /key:\s*'area-program'/.test(tabsBlock) &&
      /key:\s*'costs'/.test(tabsBlock) &&
      /key:\s*'financing'/.test(tabsBlock);
    record('F1: m1Tabs has 4 entries (no area/Land)',
      !hasArea && has4Tabs ? 'pass' : 'fail',
      !hasArea && has4Tabs ? '4-tab tab row confirmed' : `area=${hasArea}, 4tabs=${has4Tabs}`);
  } catch (e) {
    record('F1: m1Tabs collapsed', 'fail', e instanceof Error ? e.message : String(e));
  }

  // F2: Module1Area no longer mounted by RealEstatePlatform
  try {
    const rep = readSrc('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx');
    const stillImports = /^import Module1Area from/m.test(rep);
    const stillMounts = /<Module1Area\s/.test(rep);
    record('F2: Module1Area unmounted',
      !stillImports && !stillMounts ? 'pass' : 'fail',
      !stillImports && !stillMounts ? 'no import + no JSX mount' : `import=${stillImports}, mount=${stillMounts}`);
  } catch (e) {
    record('F2: Module1Area unmounted', 'fail', e instanceof Error ? e.message : String(e));
  }

  // F3: Land tab labels renumbered: '2. Build Program' / '3. Dev Costs' / '4. Financing'
  try {
    const rep = readSrc('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx');
    const ok =
      rep.includes("'1. Schedule'") &&
      rep.includes("'2. Build Program'") &&
      rep.includes("'3. Dev Costs'") &&
      rep.includes("'4. Financing'");
    record('F3: tab labels renumbered to 1-4',
      ok ? 'pass' : 'fail',
      ok ? '1.Schedule / 2.Build / 3.Costs / 4.Financing' : 'label set mismatch');
  } catch (e) {
    record('F3: tab labels renumbered', 'fail', e instanceof Error ? e.message : String(e));
  }

  // P1: Wizard draft seed exposes parcels with default values
  try {
    const wiz = readSrc('src/hubs/modeling/platforms/refm/components/modals/ProjectWizard.tsx');
    const ok =
      wiz.includes('export interface WizardDraftParcel') &&
      wiz.includes('parcels:             WizardDraftParcel[]') &&
      wiz.includes("name: 'Land 1'") &&
      wiz.includes('area: 100000') &&
      wiz.includes('rate: 500') &&
      wiz.includes('cashPct: 60');
    record('P1: WizardDraft.parcels seeded with default 100k @ 500',
      ok ? 'pass' : 'fail',
      ok ? 'default parcel matches DEFAULT_MODULE1_STATE' : 'seed missing or off');
  } catch (e) {
    record('P1: wizard parcel seed', 'fail', e instanceof Error ? e.message : String(e));
  }

  // P2: Step2LandParcels component + add/remove handlers + totals row
  try {
    const wiz = readSrc('src/hubs/modeling/platforms/refm/components/modals/ProjectWizard.tsx');
    const ok =
      wiz.includes('function Step2LandParcels(') &&
      wiz.includes('data-testid="wizard-parcels-section"') &&
      wiz.includes('data-testid="wizard-add-parcel"') &&
      wiz.includes('data-testid="wizard-parcels-totals"');
    record('P2: Step 2 renders Land Parcels block',
      ok ? 'pass' : 'fail',
      ok ? 'Step2LandParcels mounted with totals row' : 'parcel UI markers missing');
  } catch (e) {
    record('P2: wizard parcel UI', 'fail', e instanceof Error ? e.message : String(e));
  }

  // P3: buildWizardSnapshot writes draft.parcels into snapshot.landParcels
  try {
    const bws = readSrc('src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot.ts');
    const ok =
      bws.includes('const wizardParcels: LandParcel[]') &&
      bws.includes('landParcels:  wizardParcels');
    record('P3: buildWizardSnapshot writes parcels',
      ok ? 'pass' : 'fail',
      ok ? 'wizardParcels mapped into snapshot' : 'parcel mapping not present');
  } catch (e) {
    record('P3: buildWizardSnapshot parcels', 'fail', e instanceof Error ? e.message : String(e));
  }

  // B1: Build Program mounts LandParcelsBlock with the right test-id
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const ok =
      ap.includes('function LandParcelsBlock(') &&
      ap.includes('data-testid="build-program-land-parcels"') &&
      ap.includes('<LandParcelsBlock landParcels={landParcels}');
    record('B1: Build Program mounts LandParcelsBlock',
      ok ? 'pass' : 'fail',
      ok ? 'parcel block + JSX mount + test-id present' : 'block markers missing');
  } catch (e) {
    record('B1: Build Program parcel block', 'fail', e instanceof Error ? e.message : String(e));
  }

  // B2: parcel header style uses navy bg + white text (FAST contrast)
  try {
    const ap = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1AreaProgram.tsx');
    const ok =
      ap.includes('parcelHeaderStyle') &&
      ap.includes('parcelHeaderLabelStyle') &&
      ap.includes("color: 'var(--color-on-primary-navy)'");
    record('B2: parcel header uses FAST contrast',
      ok ? 'pass' : 'fail',
      ok ? 'navy bg + on-primary-navy text' : 'contrast tokens missing');
  } catch (e) {
    record('B2: parcel header contrast', 'fail', e instanceof Error ? e.message : String(e));
  }

  // C1: Module1Costs <th> InputLabel uses tableHeaderLabelStyle
  try {
    const cs = readSrc('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx');
    const ok =
      cs.includes('const tableHeaderLabelStyle:') &&
      cs.includes("color: 'var(--color-on-primary-navy)'") &&
      cs.includes('textStyle={tableHeaderLabelStyle}');
    record('C1: Costs table <th> InputLabel uses white-on-navy',
      ok ? 'pass' : 'fail',
      ok ? 'tableHeaderLabelStyle threaded through' : 'header label style missing');
  } catch (e) {
    record('C1: Costs header label style', 'fail', e instanceof Error ? e.message : String(e));
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
  console.log(`\nM1.12 verification, target: ${SUPABASE_URL}\n`);
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
