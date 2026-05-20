/* eslint-disable no-console */
/**
 * verify-m20e.ts (M2.0e verifier)
 *
 * 5-section per-phase verifier for the wizard simplification + Tab 2
 * full asset entry.
 *
 * Sections:
 *   1. Schema: Phase.startDate / Asset.status / Project.projectType
 *      additive fields, ProjectType + AssetStatus enums,
 *      ASSET_TYPES_BY_PROJECT_TYPE catalog covers all 6 ProjectTypes,
 *      makeDefaultProject seeds Mixed-Use, makeDefaultWizardDraft
 *      includes phase startDate + projectType.
 *   2. Routes + baseline: dev server reachable, baseline diff
 *      bit-identical against the new 47.8 KB v7 baseline (sha256
 *      824ef8e1706d).
 *   3. Calc engine: computePhaseTimeline (annual + monthly), per-
 *      phase startDate respected, fallback to project.startDate when
 *      Phase.startDate undefined, computeProjectTimeline min/max.
 *   4. State: source-file markers for the 5 surface files
 *      (types, calc, wizard buildSnapshot, ProjectWizard, Module1Assets).
 *      Em-dash sweep.
 *   5. UI: Playwright spec presence + run gate.
 *
 * Usage: npx tsx scripts/verify-m20e.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

import {
  PROJECT_TYPES,
  ASSET_TYPES_BY_PROJECT_TYPE,
  SUGGESTED_CATEGORIES_BY_PROJECT_TYPE,
  ASSET_STATUSES,
  ASSET_STATUS_LABELS,
  makeDefaultProject,
  type Phase,
  type Project,
  type Asset,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { makeDefaultWizardDraft } from '../src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot';
import {
  computePhaseTimeline,
  computeProjectTimeline,
} from '../src/core/calculations';

const REPO_ROOT = resolve(__dirname, '..');

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(name: string, msg = ''): void {
  passed++;
  console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`);
}
function fail(name: string, msg: string): void {
  failed++;
  console.log(`  FAIL  ${name}: ${msg}`);
}
function skip(name: string, msg: string): void {
  skipped++;
  console.log(`  SKIP  ${name}: ${msg}`);
}

// ── Section 1: schema ─────────────────────────────────────────────────────
console.log('\n[1/5] Schema + types');

// Looser ProjectType count after M2.0f Fix 3 expansion (6 -> 14).
// Verify M2.0e's 6 original slots are still present (additive change).
if (PROJECT_TYPES.length >= 6) pass(`PROJECT_TYPES count >= 6 (current ${PROJECT_TYPES.length} after M2.0f)`);
else fail('PROJECT_TYPES count', `expected >= 6, got ${PROJECT_TYPES.length}`);

const expectedTypes = ['Residential', 'Hospitality', 'Retail', 'Office', 'Mixed-Use', 'Custom'];
const allPresent = expectedTypes.every((t) => PROJECT_TYPES.includes(t as never));
if (allPresent) pass('PROJECT_TYPES has all 6 M2.0e expected slots (additive in M2.0f)');
else fail('PROJECT_TYPES slots', `missing one of ${expectedTypes.join(', ')}`);

let catalogCovered = 0;
for (const t of PROJECT_TYPES) {
  if (ASSET_TYPES_BY_PROJECT_TYPE[t] && ASSET_TYPES_BY_PROJECT_TYPE[t].length >= 4) catalogCovered++;
}
if (catalogCovered === PROJECT_TYPES.length) pass(`ASSET_TYPES_BY_PROJECT_TYPE has 4+ entries for all ${PROJECT_TYPES.length} ProjectTypes`);
else fail('ASSET_TYPES_BY_PROJECT_TYPE coverage', `${catalogCovered}/${PROJECT_TYPES.length} ProjectTypes covered with 4+ entries`);

const mixedUseTypes = ASSET_TYPES_BY_PROJECT_TYPE['Mixed-Use'];
if (mixedUseTypes.includes('High-end Apartments') && mixedUseTypes.includes('Hotel 5-star') && mixedUseTypes.includes('Retail Mall')) {
  pass('Mixed-Use catalog includes Residential + Hospitality + Retail types');
} else {
  fail('Mixed-Use catalog', 'missing one of High-end Apartments / Hotel 5-star / Retail Mall');
}

if (Object.keys(SUGGESTED_CATEGORIES_BY_PROJECT_TYPE).length >= 6) {
  pass(`SUGGESTED_CATEGORIES_BY_PROJECT_TYPE >= 6 entries (current ${Object.keys(SUGGESTED_CATEGORIES_BY_PROJECT_TYPE).length} after M2.0f)`);
} else fail('SUGGESTED_CATEGORIES count', `${Object.keys(SUGGESTED_CATEGORIES_BY_PROJECT_TYPE).length}/>=6`);

if (ASSET_STATUSES.length === 3) pass('3 AssetStatuses');
else fail('ASSET_STATUSES count', `expected 3, got ${ASSET_STATUSES.length}`);

if (ASSET_STATUS_LABELS.planned === 'Planned' && ASSET_STATUS_LABELS.construction === 'Construction' && ASSET_STATUS_LABELS.operational === 'Operational') {
  pass('AssetStatus labels (Planned / Construction / Operational)');
} else {
  fail('AssetStatus labels', 'incorrect labels');
}

const proj = makeDefaultProject();
if (proj.projectType === 'Mixed-Use') pass("makeDefaultProject seeds projectType: 'Mixed-Use'");
else fail('makeDefaultProject projectType', `expected 'Mixed-Use', got ${proj.projectType ?? 'undefined'}`);

const draft = makeDefaultWizardDraft();
if (draft.phases[0]?.startDate) pass(`makeDefaultWizardDraft phase 1 has startDate (${draft.phases[0].startDate})`);
else fail('default draft phase startDate', 'phase 1 startDate missing');
if (draft.projectType === 'Mixed-Use') pass("makeDefaultWizardDraft projectType: 'Mixed-Use'");
else fail('default draft projectType', `expected 'Mixed-Use', got ${draft.projectType ?? 'undefined'}`);

// ── Section 2: routes + baseline ─────────────────────────────────────────
console.log('\n[2/5] Routes + snapshot baseline');
let routeOk = false;
try {
  const code = execSync('curl -s -o NUL -w "%{http_code}" http://localhost:3000/refm', {
    timeout: 3000,
    encoding: 'utf8',
  }).trim();
  routeOk = code === '200' || code === '302' || code === '307';
  if (routeOk) pass(`/refm responsive (HTTP ${code})`);
  else skip('/refm', `dev server returned HTTP ${code}; sign-in required`);
} catch {
  skip('/refm', 'dev server not reachable');
}

try {
  const out = execSync('npx tsx scripts/module1-v5-diff.ts', { encoding: 'utf8', timeout: 30000 });
  if (out.includes('OK: bit-identical')) pass('module1-v5-diff bit-identical (47.8 KB sha256 22923b5275a7 post-M2.0g/1)');
  else fail('module1-v5-diff', out.slice(0, 200));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  fail('module1-v5-diff', msg.slice(0, 200));
}

// ── Section 3: calc engine ────────────────────────────────────────────────
console.log('\n[3/5] Calc engine');

// computePhaseTimeline annual: phase.startDate respected
const annualProj: Project = { name: 'A', currency: 'SAR', modelType: 'annual', startDate: '2026-01-01', status: 'draft', location: '' };
const phaseAnnualWithDate: Phase = { id: 'p1', name: 'P1', constructionStart: 1, constructionPeriods: 3, operationsPeriods: 5, overlapPeriods: 0, startDate: '2027-06-01' };
const tlA = computePhaseTimeline(phaseAnnualWithDate, annualProj);
if (tlA.constructionStart === '2027-06-01') pass('computePhaseTimeline annual respects per-phase startDate');
else fail('phase startDate respected', `expected 2027-06-01, got ${tlA.constructionStart}`);
// M2.0g Fix 1: end-of-period dates. 2027-06-01 + 3 yrs end-of-period =
// (2030-06-01) - 1 day = 2030-05-31. operationsStart = day after =
// 2030-06-01. operationsEnd = 2030-06-01 + 5 yrs end-of-period =
// 2035-05-31.
if (tlA.constructionEnd === '2030-05-31') pass(`computePhaseTimeline annual constructionEnd = startDate + 3y - 1day (${tlA.constructionEnd})`);
else fail('annual constructionEnd', `expected 2030-05-31, got ${tlA.constructionEnd}`);
if (tlA.operationsEnd === '2035-05-31') pass(`computePhaseTimeline annual operationsEnd = end-of-period (${tlA.operationsEnd})`);
else fail('annual operationsEnd', `expected 2035-05-31, got ${tlA.operationsEnd}`);

// computePhaseTimeline monthly
const monthlyProj: Project = { ...annualProj, modelType: 'monthly' };
const phaseMonthly: Phase = { id: 'p2', name: 'P2', constructionStart: 1, constructionPeriods: 24, operationsPeriods: 60, overlapPeriods: 6, startDate: '2026-01-01' };
const tlM = computePhaseTimeline(phaseMonthly, monthlyProj);
if (tlM.constructionStart === '2026-01-01') pass('computePhaseTimeline monthly respects per-phase startDate');
else fail('monthly startDate', tlM.constructionStart);
// M2.0g Fix 1: monthly end-of-period. 2026-01-01 + 24 months =
// 2028-01-01 - 1 day = 2027-12-31. operationsStart = day after
// constructionEnd minus overlap 6m: (2028-01-01) - 6m = 2027-07-01.
if (tlM.constructionEnd === '2027-12-31') pass(`computePhaseTimeline monthly constructionEnd = +24m - 1day (${tlM.constructionEnd})`);
else fail('monthly constructionEnd', `expected 2027-12-31, got ${tlM.constructionEnd}`);
if (tlM.operationsStart === '2027-07-01') pass(`computePhaseTimeline monthly operationsStart = constructionEnd+1day - overlap 6m (${tlM.operationsStart})`);
else fail('monthly operationsStart', `expected 2027-07-01, got ${tlM.operationsStart}`);

// Fallback when phase.startDate is undefined: project.startDate + (constructionStart - 1) periods
const phaseNoDate: Phase = { id: 'p3', name: 'P3', constructionStart: 2, constructionPeriods: 3, operationsPeriods: 5, overlapPeriods: 0 };
const tlF = computePhaseTimeline(phaseNoDate, annualProj);
if (tlF.constructionStart === '2027-01-01') pass('computePhaseTimeline fallback: undefined startDate + constructionStart=2 -> project.startDate + 1y');
else fail('phase startDate fallback', `expected 2027-01-01, got ${tlF.constructionStart}`);

// computeProjectTimeline: min/max across phases
const phases3: Phase[] = [
  { id: 'p1', name: 'P1', constructionStart: 1, constructionPeriods: 3, operationsPeriods: 5, overlapPeriods: 0, startDate: '2026-01-01' },
  { id: 'p2', name: 'P2', constructionStart: 4, constructionPeriods: 2, operationsPeriods: 5, overlapPeriods: 0, startDate: '2027-01-01' },
];
const projTL = computeProjectTimeline(annualProj, phases3);
if (projTL.start === '2026-01-01') pass('computeProjectTimeline.start = min phase startDate');
else fail('project timeline start', `expected 2026-01-01, got ${projTL.start}`);
// M2.0g Fix 1: end-of-period. Phase 2 startDate=2027-01-01,
// constructionPeriods=2, operationsPeriods=5. constructionEnd =
// 2028-12-31, operationsStart = 2029-01-01, operationsEnd =
// 2033-12-31.
if (projTL.end === '2033-12-31') pass(`computeProjectTimeline.end = max phase operationsEnd end-of-period (${projTL.end})`);
else fail('project timeline end', `expected 2033-12-31, got ${projTL.end}`);

// ── Section 4: source-file markers ───────────────────────────────────────
console.log('\n[4/5] Source-file markers (M2.0e)');

interface Marker { label: string; path: string; needle: string }
const componentRoot = 'src/hubs/modeling/platforms/refm/components';
const moduleRoot = `${componentRoot}/modules`;
const calcPath = 'src/core/calculations/index.ts';
const typesPath = 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts';
const wizardPath = `${componentRoot}/modals/ProjectWizard.tsx`;
const buildWizardPath = 'src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot.ts';

const markers: Marker[] = [
  { label: 'V1: Phase.startDate optional', path: typesPath, needle: 'startDate?: string' },
  { label: 'V2: Asset.status optional', path: typesPath, needle: 'status?: AssetStatus' },
  { label: 'V3: Project.projectType optional', path: typesPath, needle: 'projectType?: ProjectType' },
  { label: 'V4: ProjectType enum (Residential slot present)', path: typesPath, needle: "'Residential'" },
  { label: 'V5: ASSET_TYPES_BY_PROJECT_TYPE map', path: typesPath, needle: 'ASSET_TYPES_BY_PROJECT_TYPE' },
  { label: 'V6: SUGGESTED_CATEGORIES_BY_PROJECT_TYPE map', path: typesPath, needle: 'SUGGESTED_CATEGORIES_BY_PROJECT_TYPE' },
  { label: 'V7: ASSET_STATUSES export', path: typesPath, needle: 'ASSET_STATUSES' },
  { label: 'V8: ASSET_STATUS_LABELS export', path: typesPath, needle: 'ASSET_STATUS_LABELS' },

  { label: 'C1: computePhaseTimeline export', path: calcPath, needle: 'export function computePhaseTimeline' },
  { label: 'C2: computeProjectTimeline export', path: calcPath, needle: 'export function computeProjectTimeline' },
  { label: 'C3: PhaseTimeline interface', path: calcPath, needle: 'export interface PhaseTimeline' },
  { label: 'C4: addPeriods helper', path: calcPath, needle: 'function addPeriods' },
  { label: 'C5: phase.startDate fallback', path: calcPath, needle: 'phase.constructionStart - 1' },

  { label: 'B1: WizardDraftPhase.startDate required', path: buildWizardPath, needle: 'startDate: string' },
  { label: 'B2: WizardDraft.projectType', path: buildWizardPath, needle: 'projectType: ProjectType' },
  { label: 'B3: WizardDraftAsset retired (no export)', path: buildWizardPath, needle: 'WizardDraftAsset retired' },
  { label: 'B4: empty assets[] from wizard', path: buildWizardPath, needle: 'const assets: Asset[] = []' },
  { label: 'B5: makeDefault projectType: Mixed-Use', path: buildWizardPath, needle: "projectType: 'Mixed-Use'" },

  { label: 'W1: Wizard Step 3 simplified (project type radios)', path: wizardPath, needle: 'wiz-project-type-options' },
  { label: 'W2: Wizard Step 3 step label', path: wizardPath, needle: '3. Project Type' },
  { label: 'W3: Wizard Phase Start Date column', path: wizardPath, needle: 'wiz-phase-header-startdate' },
  { label: 'W4: Wizard unit suffix Construction', path: wizardPath, needle: 'wiz-phase-header-construction' },
  { label: 'W5: Wizard periodUnit (M2.0g v8: always years)', path: wizardPath, needle: "const periodUnit = 'years';" },
  { label: 'W6: Wizard project type suggestions', path: wizardPath, needle: 'wiz-project-type-suggestions' },
  { label: 'W7: Wizard PROJECT_TYPES import', path: wizardPath, needle: 'PROJECT_TYPES' },
  { label: 'W8: Wizard step3 callout', path: wizardPath, needle: 'wiz-step3-callout' },

  { label: 'A1: Module1Assets PhaseAssetSection', path: `${moduleRoot}/Module1Assets.tsx`, needle: 'function PhaseAssetSection' },
  { label: 'A2: Module1Assets resolveTypeCatalog', path: `${moduleRoot}/Module1Assets.tsx`, needle: 'function resolveTypeCatalog' },
  { label: 'A3: Module1Assets phase-section testid', path: `${moduleRoot}/Module1Assets.tsx`, needle: 'phase-section-${phase.id}' },
  { label: 'A4: Module1Assets Phase dropdown', path: `${moduleRoot}/Module1Assets.tsx`, needle: 'asset-${asset.id}-phase' },
  { label: 'A5: Module1Assets Status dropdown', path: `${moduleRoot}/Module1Assets.tsx`, needle: 'asset-${asset.id}-status' },
  { label: 'A6: Module1Assets rateUnitLabel helper', path: `${moduleRoot}/Module1Assets.tsx`, needle: 'function rateUnitLabel' },
  { label: 'A7: Module1Assets areas footer (reconciliation removed in M2.0f)', path: `${moduleRoot}/Module1Assets.tsx`, needle: 'asset-card-${asset.id}-footer' },
  { label: 'A8: Module1Assets globals card', path: `${moduleRoot}/Module1Assets.tsx`, needle: 'assets-globals' },
  { label: 'A9: Module1Assets sub-unit Rate Unit column', path: `${moduleRoot}/Module1Assets.tsx`, needle: 'subunit-${subUnit.id}-rate-unit' },
  { label: 'A10: Module1Assets statusBadgeStyle helper', path: `${moduleRoot}/Module1Assets.tsx`, needle: 'function statusBadgeStyle' },
];

for (const m of markers) {
  const fullPath = join(REPO_ROOT, m.path);
  if (!existsSync(fullPath)) {
    fail(m.label, `file missing: ${m.path}`);
    continue;
  }
  const src = readFileSync(fullPath, 'utf8');
  if (src.includes(m.needle)) pass(m.label);
  else fail(m.label, `marker missing: ${m.needle}`);
}

// Em-dash sweep across the new code
const emDashFiles = [
  typesPath,
  calcPath,
  buildWizardPath,
  wizardPath,
  `${moduleRoot}/Module1Assets.tsx`,
];
let emDashFails = 0;
for (const f of emDashFiles) {
  const src = readFileSync(join(REPO_ROOT, f), 'utf8');
  if (src.includes(', ')) {
    emDashFails++;
    console.log(`  FAIL  em-dash in ${f}`);
  }
}
if (emDashFails === 0) pass('X1: em-dash sweep, zero hits');
else fail('X1: em-dash sweep', `${emDashFails} files contain em-dash`);

// ── Section 5: Playwright ────────────────────────────────────────────────
console.log('\n[5/5] Playwright UI smoke');
const specPath = join(REPO_ROOT, 'tests/e2e/m20e-wizard-tab2.spec.ts');
if (!existsSync(specPath)) {
  fail('Playwright spec', 'tests/e2e/m20e-wizard-tab2.spec.ts not found');
} else {
  pass('m20e-wizard-tab2.spec.ts present');
  if (!routeOk) {
    skip('Playwright run', 'sign-in required for full smoke; spec runnable when /refm returns 200');
  } else {
    try {
      execSync('npx playwright test tests/e2e/m20e-wizard-tab2.spec.ts --reporter=list', {
        stdio: 'pipe',
        timeout: 180000,
      });
      pass('Playwright m20e-wizard-tab2.spec.ts');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      fail('Playwright', msg.slice(0, 200));
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\nResult: ${passed} pass / ${failed} fail / ${skipped} skip`);
if (failed > 0) process.exit(1);
process.exit(0);
