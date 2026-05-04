/**
 * scripts/verify-m19.ts
 *
 * End-to-end verification that Phase M1.9 (REFM Module 1 UX redesign:
 * wizard expansion + duplicate-input strip + numbered tab sequence) is
 * correctly deployed.
 *
 * QUICK START:
 *   npx tsx --env-file=.env.local scripts/verify-m19.ts
 *
 * Optional: start `npm run dev` in another terminal so http://localhost:3000
 * responds — section 2 (route smoke) and section 5 (Playwright UI) will
 * skip cleanly when the dev server isn't reachable.
 *
 * Sections (matches the standing per-phase verification template
 * established 2026-05-02 for M1.7 / M1.8):
 *
 *   1. Database / persistence  — wizard snapshot JSONB roundtrip with
 *                                M1.9 additions: country + per-phase
 *                                timing carried over from the wizard
 *                                draft.
 *   2. Route smoke tests       — POST /api/refm/projects gates on auth
 *                                exactly as before (M1.9 adds no new
 *                                routes).
 *   3. Calculation correctness — all 3 snapshot diffs (legacy 17.5 KB /
 *                                multiphase 23.0 KB / areaprogram
 *                                2.8 KB) — must stay bit-identical
 *                                because M1.9 is UX-only, not calc.
 *   4. State integrity         — WizardDraft carries the 4 new fields
 *                                (country + 3 timing periods);
 *                                buildWizardSnapshot wires
 *                                wizardConstruction / wizardOperations /
 *                                wizardOverlap into every minted phase;
 *                                snapshot.country = draft.country;
 *                                m1Tabs labels carry the "1. … 6." prefix.
 *   5. UI rendering            — Playwright signin (light + dark) +
 *                                /refm gate redirect — same baseline as
 *                                verify-m18.ts.
 *
 * Test-user fixture: id 00000000-0000-0000-0000-000000000000, password
 * 'M19_VERIFY_NOT_USABLE'. ON DELETE CASCADE cleans every row downstream
 * on teardown.
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
import { createModule1Store, type HydrateSnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import {
  buildWizardSnapshot, mapWizardToProjectType,
} from '../src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot';
import {
  makeWizardDefaultDraft,
  type WizardDraft,
} from '../src/hubs/modeling/platforms/refm/components/modals/ProjectWizard';
import { m1Tabs } from '../src/hubs/modeling/platforms/refm/components/RealEstatePlatform';

// ── Config ────────────────────────────────────────────────────────────────
const TEST_USER_ID    = '00000000-0000-0000-0000-000000000000';
const TEST_USER_EMAIL = `m19-verify+${Date.now()}@test.invalid`;
const TEST_USER_NAME  = 'M1.9 Verification Fixture';
const NAME_PREFIX     = 'M19-VERIFY-';
const DEV_SERVER_URL  = process.env.M19_DEV_SERVER_URL ?? 'http://localhost:3000';
const SCREENSHOT_DIR  = resolve(process.cwd(), 'tests/screenshots/M1.9');

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
// Build a draft that exercises the 4 new M1.9 wizard fields:
// country='United Arab Emirates' (currency auto-derives to AED),
// 8 / 12 / 1 timing window (different from the legacy 4 / 5 / 0 default
// so we can prove the wizard's values land in every minted phase).
function makeM19TimingDraft(name: string): WizardDraft {
  return {
    ...makeWizardDefaultDraft(),
    name,
    location:            'Dubai, United Arab Emirates',
    country:             'United Arab Emirates',
    currency:            'AED',
    constructionPeriods: 8,
    operationsPeriods:   12,
    overlapPeriods:      1,
  };
}

// ── 0. Test-user fixture ──────────────────────────────────────────────────
async function setupTestUser(): Promise<void> {
  await sb.from('users').delete().eq('id', TEST_USER_ID);
  const { error } = await sb.from('users').insert({
    id:                  TEST_USER_ID,
    email:               TEST_USER_EMAIL,
    name:                TEST_USER_NAME,
    password_hash:       'M19_VERIFY_NOT_USABLE',
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
  section('1. Database / persistence — M1.9 wizard fields round-trip');

  const draft = makeM19TimingDraft(NAME_PREFIX + 'Timing');
  const built = buildWizardSnapshot(draft);

  // Pre-flight: prove the build helper writes the user's country +
  // timing into the snapshot (no DB needed for this).
  const okCountry = built.snapshot.country === 'United Arab Emirates';
  const okPhase   = built.snapshot.phases.length === 1
    && built.snapshot.phases[0].constructionPeriods === 8
    && built.snapshot.phases[0].operationsPeriods === 12
    && built.snapshot.phases[0].overlapPeriods === 1
    // operationsStart = construction - overlap + 1 = 8 - 1 + 1 = 8
    && built.snapshot.phases[0].operationsStart === 8;
  if (okCountry && okPhase) {
    record('buildWizardSnapshot writes country + per-phase timing', 'pass',
      `country=${built.snapshot.country} phase=[${built.snapshot.phases[0].constructionPeriods}/${built.snapshot.phases[0].operationsPeriods}/${built.snapshot.phases[0].overlapPeriods} ops=${built.snapshot.phases[0].operationsStart}]`);
  } else {
    record('buildWizardSnapshot writes country + per-phase timing', 'fail',
      `country=${built.snapshot.country} phase[0]=${JSON.stringify(built.snapshot.phases[0])}`);
  }

  const projInsert = await sb.from('refm_projects').insert({
    user_id:        TEST_USER_ID,
    name:           NAME_PREFIX + 'Timing',
    location:       'Dubai',
    status:         'Draft',
    asset_mix:      built.assetMix,
    schema_version: 4,
  }).select('id').maybeSingle();

  if (projInsert.error || !projInsert.data) {
    record('Insert refm_projects with M1.9 wizard snapshot', 'fail',
      projInsert.error?.message ?? 'no data returned');
    return;
  }
  const projectId = (projInsert.data as { id: string }).id;
  record('Insert refm_projects with M1.9 wizard snapshot', 'pass',
    `id=${projectId.slice(0, 8)}…`);

  const verInsert = await sb.from('refm_project_versions').insert({
    project_id:     projectId,
    version_number: 1,
    schema_version: 4,
    snapshot:       built.snapshot,
    label:          'M1.9 verify fixture',
  }).select('id').maybeSingle();

  if (verInsert.error || !verInsert.data) {
    record('Insert refm_project_versions with M1.9 snapshot', 'fail',
      verInsert.error?.message ?? 'no data returned');
    await sb.from('refm_projects').delete().eq('id', projectId);
    return;
  }
  record('Insert refm_project_versions with M1.9 snapshot', 'pass',
    `JSONB accepted ${JSON.stringify(built.snapshot).length} byte snapshot`);

  // Read back: confirm country + per-phase timing survive a JSONB round-trip.
  const verRead = await sb.from('refm_project_versions')
    .select('snapshot')
    .eq('id', (verInsert.data as { id: string }).id)
    .single();

  if (verRead.error || !verRead.data) {
    record('Read-back wizard snapshot', 'fail', verRead.error?.message ?? 'no data');
  } else {
    const snap = (verRead.data as { snapshot: HydrateSnapshot }).snapshot;
    const okCountryRT = snap.country === 'United Arab Emirates';
    const okPhaseRT = Array.isArray(snap.phases)
      && snap.phases[0]?.constructionPeriods === 8
      && snap.phases[0]?.operationsPeriods === 12
      && snap.phases[0]?.overlapPeriods === 1;
    if (okCountryRT && okPhaseRT) {
      record('Round-trip preserves country + per-phase timing', 'pass',
        `country=${snap.country} timing=[${snap.phases[0].constructionPeriods}/${snap.phases[0].operationsPeriods}/${snap.phases[0].overlapPeriods}]`);
    } else {
      record('Round-trip preserves country + per-phase timing', 'fail',
        `country=${snap.country} timing=${JSON.stringify(snap.phases?.[0])}`);
    }
  }

  // Cleanup project (cascades to version).
  await sb.from('refm_projects').delete().eq('id', projectId);
}

// ── 2. Route smoke tests ─────────────────────────────────────────────────
async function checkRoutes(): Promise<void> {
  section('2. Route smoke tests — M1.9 adds no new routes');

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

  // Re-verify the existing routes still 401 without auth (M1.9 must
  // not regress the gates). Same set as verify-m18.
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
  section('3. Calculation correctness — snapshot diffs (M1.9 must not drift)');

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
  section('4. State integrity — wizard expansion + tab metadata');

  // ── 4a. WizardDraft default ships with the M1.9 fields populated ──
  const def = makeWizardDefaultDraft();
  const okDefaults =
    typeof def.country === 'string' && def.country.length > 0 &&
    typeof def.constructionPeriods === 'number' && def.constructionPeriods > 0 &&
    typeof def.operationsPeriods === 'number' && def.operationsPeriods > 0 &&
    typeof def.overlapPeriods === 'number' && def.overlapPeriods >= 0;
  if (okDefaults) {
    record('makeWizardDefaultDraft seeds country + 3 timing periods', 'pass',
      `country=${def.country} timing=[${def.constructionPeriods}/${def.operationsPeriods}/${def.overlapPeriods}]`);
  } else {
    record('makeWizardDefaultDraft seeds country + 3 timing periods', 'fail',
      `country=${def.country} timing=[${def.constructionPeriods}/${def.operationsPeriods}/${def.overlapPeriods}]`);
  }

  // ── 4b. Country + currency are linked: the default country resolves
  // to a real entry in COUNTRY_DATA and matches the default currency ──
  // (Indirect — we just check that the SAR / Saudi Arabia pair the
  // default ships with is internally consistent.)
  const okPair = (def.country === 'Saudi Arabia' && def.currency === 'SAR');
  if (okPair) {
    record('Default country / currency pair consistent', 'pass',
      `${def.country} / ${def.currency}`);
  } else {
    record('Default country / currency pair consistent', 'fail',
      `${def.country} / ${def.currency}`);
  }

  // ── 4c. buildWizardSnapshot writes wizard timing into every phase ──
  const draft: WizardDraft = {
    ...def,
    name:                'M19-Multi',
    location:            'Riyadh',
    phaseCount:          3,
    constructionPeriods: 6,
    operationsPeriods:   10,
    overlapPeriods:      2,
  };
  const built = buildWizardSnapshot(draft);
  const okEveryPhase = built.snapshot.phases.length === 3 &&
    built.snapshot.phases.every(p =>
      p.constructionPeriods === 6 && p.operationsPeriods === 10 && p.overlapPeriods === 2,
    );
  if (okEveryPhase) {
    record('Multi-phase wizard mints 3 phases sharing 6/10/2 timing', 'pass',
      `phases.length=${built.snapshot.phases.length} all share construction/operations/overlap`);
  } else {
    record('Multi-phase wizard mints 3 phases sharing 6/10/2 timing', 'fail',
      built.snapshot.phases.map(p => `${p.constructionPeriods}/${p.operationsPeriods}/${p.overlapPeriods}`).join(','));
  }

  // ── 4d. Overlap clamps to construction (overlap > construction is illegal) ──
  const draftClamp: WizardDraft = {
    ...def,
    name:                'M19-Clamp',
    location:            'Riyadh',
    constructionPeriods: 4,
    operationsPeriods:   5,
    overlapPeriods:      99, // intentionally too big
  };
  const builtClamp = buildWizardSnapshot(draftClamp);
  const okClamp = builtClamp.snapshot.phases[0].overlapPeriods === 4;
  if (okClamp) {
    record('Overlap > construction clamps to construction', 'pass',
      `requested 99 → clamped to ${builtClamp.snapshot.phases[0].overlapPeriods}`);
  } else {
    record('Overlap > construction clamps to construction', 'fail',
      `requested 99 → got ${builtClamp.snapshot.phases[0].overlapPeriods}`);
  }

  // ── 4e. mapWizardToProjectType regression check ──
  // Existing M1.8 collapse rules must still hold under M1.9.
  const collapse = [
    ['Residential',  'residential'] as const,
    ['Hospitality',  'hospitality'] as const,
    ['Retail',       'mixed-use']   as const,
    ['Office',       'mixed-use']   as const,
    ['Mixed-Use',    'mixed-use']   as const,
    ['Custom',       'mixed-use']   as const,
  ];
  let collapseOk = true;
  for (const [wt, expected] of collapse) {
    if (mapWizardToProjectType(wt) !== expected) collapseOk = false;
  }
  record('mapWizardToProjectType collapse table unchanged from M1.8', collapseOk ? 'pass' : 'fail',
    collapseOk ? '6/6 mappings correct' : 'collapse table drifted');

  // ── 4f. m1Tabs labels carry the numeric prefix + Hierarchy is step 6 ──
  const okSteps =
    m1Tabs.length === 6 &&
    m1Tabs[0].key === 'timeline'     && m1Tabs[0].step === 1 && m1Tabs[0].label.startsWith('1.') &&
    m1Tabs[1].key === 'area'         && m1Tabs[1].step === 2 &&
    m1Tabs[2].key === 'area-program' && m1Tabs[2].step === 3 &&
    m1Tabs[3].key === 'costs'        && m1Tabs[3].step === 4 &&
    m1Tabs[4].key === 'financing'    && m1Tabs[4].step === 5 &&
    m1Tabs[5].key === 'hierarchy'    && m1Tabs[5].step === 6;
  if (okSteps) {
    record('m1Tabs row reads as numbered 1→6 sequence (Schedule first, Hierarchy last)', 'pass',
      m1Tabs.map(t => t.label).join(' → '));
  } else {
    record('m1Tabs row reads as numbered 1→6 sequence (Schedule first, Hierarchy last)', 'fail',
      m1Tabs.map(t => `${t.step}.${t.key}`).join(','));
  }

  // ── 4g. Hydrate cycle keeps M1.9-flavored snapshots intact ──
  const store = createModule1Store();
  store.getState().hydrate(built.snapshot);
  const after = store.getState();
  const okHydrate = after.phases.length === 3 &&
    after.phases[0].constructionPeriods === 6 &&
    after.country === built.snapshot.country;
  if (okHydrate) {
    record('Store hydrate preserves M1.9 fields', 'pass',
      `phases=${after.phases.length} country=${after.country}`);
  } else {
    record('Store hydrate preserves M1.9 fields', 'fail',
      `phases=${after.phases.length} country=${after.country}`);
  }

  // ── 4h. Module1Timeline + Module1Area no longer host duplicate inputs ──
  // Statically inspect the source files for the JSX text-content strings
  // the legacy duplicate-input panels rendered. Match `>Project
  // Identity<` etc. (with surrounding tag delimiters) rather than the
  // bare substring so docstrings / commit-style comments referencing the
  // removed panels don't trigger false positives.
  try {
    const timelineSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modules/Module1Timeline.tsx'),
      'utf-8',
    );
    const banished = ['>Project Identity<', '>Project Type<', 'placeholder="e.g. SAR"'];
    const stillThere = banished.filter(s => timelineSrc.includes(s));
    if (stillThere.length === 0) {
      record('Module1Timeline drops Project Identity card (M1.9 strip holds)', 'pass',
        'no Project Identity / Project Type / Currency input JSX in render tree');
    } else {
      record('Module1Timeline drops Project Identity card (M1.9 strip holds)', 'fail',
        `still references: ${stillThere.join(', ')}`);
    }

    const areaSrc = readFileSync(
      resolve(process.cwd(), 'src/hubs/modeling/platforms/refm/components/modules/Module1Area.tsx'),
      'utf-8',
    );
    // Asset Mix + Deduction & Efficiency had these h3 headings; check
    // for them only as JSX text content (between tags).
    const banishedArea = ['>Asset Mix<', '>Deduction &amp; Efficiency Factors<', '🏠 Residential %', '🏨 Hospitality %', '🏪 Retail %'];
    const stillThereArea = banishedArea.filter(s => areaSrc.includes(s));
    if (stillThereArea.length === 0) {
      record('Module1Area drops Asset Mix + Deduct/Efficiency panels (M1.9 strip holds)', 'pass',
        'no per-category mix / deduct / efficiency UI in render tree');
    } else {
      record('Module1Area drops Asset Mix + Deduct/Efficiency panels (M1.9 strip holds)', 'fail',
        `still references: ${stillThereArea.join(', ')}`);
    }
  } catch (e) {
    record('Source-file inspection for duplicate-input strip', 'fail',
      e instanceof Error ? e.message : String(e));
  }
}

// ── 5. UI rendering (Playwright) ────────────────────────────────────────
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
      'requires authenticated REFM session — TODO: add fixture-login or NextAuth cookie injection (same as verify-m17 / verify-m18)');
  } finally {
    await browser.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`\nM1.9 verification — target: ${SUPABASE_URL}\n`);

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
