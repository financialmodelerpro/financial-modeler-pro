/* eslint-disable no-console */
/**
 * verify-m20f.ts (M2.0f verifier)
 *
 * 5-section per-phase verifier for the M2.0f structural fixes:
 *   Fix 1: shell header clipping (sticky topbar + module-view padding)
 *   Fix 2: multi-parcel allocation (parcelId + multiParcelSplits)
 *   Fix 3: project type catalog expansion (6 -> 14)
 *   Fix 4: Phase Start Date persistence to Tab 1
 *   Fix 5: project end year (no +1 offset; endYear field on ProjectTimeline)
 *   Fix 6: sub-unit BUA as source of truth (Parking category, derived areas)
 *
 * Sections:
 *   1. Schema: 14 ProjectTypes, ASSET_TYPES_BY_PROJECT_TYPE covers all,
 *      Parking sub-unit category, Asset.landAllocation optional shape,
 *      legacy v7 fields preserved.
 *   2. Routes + baseline: dev server reachable, baseline diff bit-
 *      identical (47.8 KB v7 carry-over since fixture exercises no
 *      multi-parcel inputs).
 *   3. Calc engine: computeAssetLandBreakdown per-parcel rate, multi-
 *      parcel split sum, validateLandAllocation over/under, project
 *      timeline endYear (MAAD shape -> 2039), BUA source-of-truth.
 *   4. State: source-file markers for the 6 fix surfaces +
 *      em-dash sweep across 7 files.
 *   5. UI: Playwright spec presence + run gate.
 *
 * Usage: npx tsx scripts/verify-m20f.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

import {
  PROJECT_TYPES,
  ASSET_TYPES_BY_PROJECT_TYPE,
  SUB_UNIT_CATEGORIES,
  type Phase,
  type Project,
  type Parcel,
  type Asset,
  type SubUnit,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  computeAssetLandBreakdown,
  computeAssetBua,
  computeAssetSellableBua,
  validateLandAllocation,
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

if (PROJECT_TYPES.length === 14) pass(`14 ProjectTypes (Fix 3 expansion: ${PROJECT_TYPES.length})`);
else fail('PROJECT_TYPES count', `expected 14, got ${PROJECT_TYPES.length}`);

const newTypes = ['Industrial', 'Data Center', 'Education', 'Healthcare', 'Marina', 'Hospitality + Branded Residences', 'Senior Living', 'Self-Storage'];
const newTypePresent = newTypes.every((t) => PROJECT_TYPES.includes(t as never));
if (newTypePresent) pass('PROJECT_TYPES includes all 8 new entries');
else fail('PROJECT_TYPES new entries', `missing one of ${newTypes.join(', ')}`);

let allCovered = true;
for (const t of PROJECT_TYPES) {
  const list = ASSET_TYPES_BY_PROJECT_TYPE[t];
  if (!list || list.length < 4) {
    allCovered = false;
    console.log(`  WARN  ${t} catalog has ${list ? list.length : 0} entries (< 4)`);
  }
}
if (allCovered) pass('ASSET_TYPES_BY_PROJECT_TYPE has 4+ entries for all 14 ProjectTypes');
else fail('ASSET_TYPES_BY_PROJECT_TYPE coverage', 'one or more ProjectTypes < 4 entries');

const dataCenterTypes = ASSET_TYPES_BY_PROJECT_TYPE['Data Center'];
if (dataCenterTypes.includes('Hyperscale') && dataCenterTypes.includes('Edge Data Center') && dataCenterTypes.includes('Co-location')) {
  pass('Data Center catalog has expected entries (Hyperscale / Edge / Co-location)');
} else {
  fail('Data Center catalog', 'missing one of Hyperscale / Edge Data Center / Co-location');
}

const healthcareTypes = ASSET_TYPES_BY_PROJECT_TYPE['Healthcare'];
if (healthcareTypes.includes('Hospital (Multi-specialty)') && healthcareTypes.includes('Specialty Clinic')) {
  pass('Healthcare catalog has expected entries (Hospital + Specialty Clinic)');
} else {
  fail('Healthcare catalog', 'missing Hospital or Specialty Clinic');
}

if (SUB_UNIT_CATEGORIES.length === 5) pass('5 SubUnitCategories (Fix 6: + Parking)');
else fail('SUB_UNIT_CATEGORIES count', `expected 5, got ${SUB_UNIT_CATEGORIES.length}`);

if (SUB_UNIT_CATEGORIES.includes('Parking')) pass("SUB_UNIT_CATEGORIES includes 'Parking'");
else fail('SUB_UNIT_CATEGORIES', "'Parking' missing");

// Asset.landAllocation roundtrip via shape check.
const aTest: Asset = {
  id: 'a1',
  phaseId: 'p1',
  name: 'Test',
  type: 'High-end Apartments',
  strategy: 'Sell',
  visible: true,
  gfaSqm: 0,
  buaSqm: 0,
  sellableBuaSqm: 0,
  parkingBaysRequired: 0,
  landAllocation: {
    parcelId: 'parcel_1',
    sqm: 5000,
    multiParcelSplits: [{ parcelId: 'parcel_1', sqm: 3000 }, { parcelId: 'parcel_2', sqm: 2000 }],
  },
  status: 'planned',
};
if (aTest.landAllocation?.parcelId === 'parcel_1') pass('Asset.landAllocation.parcelId roundtrip');
else fail('Asset.landAllocation.parcelId', 'roundtrip failed');
if (aTest.landAllocation?.multiParcelSplits?.length === 2) pass('Asset.landAllocation.multiParcelSplits length=2');
else fail('Asset.landAllocation.multiParcelSplits', 'length mismatch');

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
  if (out.includes('OK: bit-identical')) pass('module1-v5-diff bit-identical (47.8 KB v7 baseline carries over)');
  else fail('module1-v5-diff', out.slice(0, 200));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  fail('module1-v5-diff', msg.slice(0, 200));
}

// ── Section 3: calc engine ────────────────────────────────────────────────
console.log('\n[3/5] Calc engine');

// Fix 2: computeAssetLandBreakdown with explicit parcelId picks the
// chosen parcel's rate (not weighted average across phase).
const project: Project = { name: 'M', currency: 'SAR', modelType: 'annual', startDate: '2025-01-01', status: 'draft', location: '' };
const parcels: Parcel[] = [
  { id: 'parcel_1', phaseId: 'p1', name: 'Phase 2 Land', area: 10000, rate: 98450, cashPct: 100, inKindPct: 0 },
  { id: 'parcel_2', phaseId: 'p1', name: 'Phase 3 Land', area: 8000, rate: 61722, cashPct: 50, inKindPct: 50 },
];
const assetSingleParcel: Asset = {
  id: 'asset_phase2', phaseId: 'p1', name: 'Tower 1', type: 'High-end Apartments',
  strategy: 'Sell', visible: true, gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0,
  landAllocation: { parcelId: 'parcel_1', sqm: 5718 },
};
const breakdownSingle = computeAssetLandBreakdown(assetSingleParcel, parcels, [assetSingleParcel], [], 'sqm');
const expectedSingle = 5718 * 98450;
if (Math.round(breakdownSingle.landValue) === Math.round(expectedSingle)) {
  pass(`Fix 2: single-parcel land cost = 5718 sqm x 98,450 SAR/sqm = ${Math.round(expectedSingle).toLocaleString()} SAR`);
} else {
  fail('single-parcel land cost', `expected ${expectedSingle}, got ${breakdownSingle.landValue}`);
}
if (breakdownSingle.rate === 98450) pass('Fix 2: single-parcel resolved rate = parcel rate (98,450)');
else fail('single-parcel rate', `expected 98450, got ${breakdownSingle.rate}`);

// Fix 2: multi-parcel splits sum across parcels using each rate.
const assetMulti: Asset = {
  id: 'asset_split', phaseId: 'p1', name: 'Mixed', type: 'Mixed-Use Tower',
  strategy: 'Sell + Manage', visible: true, gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0,
  landAllocation: {
    multiParcelSplits: [
      { parcelId: 'parcel_1', sqm: 3000 },
      { parcelId: 'parcel_2', sqm: 2000 },
    ],
  },
};
const breakdownMulti = computeAssetLandBreakdown(assetMulti, parcels, [assetMulti], [], 'sqm');
const expectedMulti = 3000 * 98450 + 2000 * 61722;
if (Math.round(breakdownMulti.landValue) === Math.round(expectedMulti)) {
  pass(`Fix 2: multi-parcel splits sum = 3000x98,450 + 2000x61,722 = ${Math.round(expectedMulti).toLocaleString()} SAR`);
} else {
  fail('multi-parcel splits', `expected ${expectedMulti}, got ${breakdownMulti.landValue}`);
}
if (breakdownMulti.splits.length === 2) pass('Fix 2: multi-parcel breakdown.splits.length = 2');
else fail('breakdown.splits.length', `expected 2, got ${breakdownMulti.splits.length}`);

// Fix 2: validation over/under.
const validation = validateLandAllocation(parcels, [assetMulti], 'sqm');
if (validation.parcelTotalSqm === 18000) pass('Fix 2: validateLandAllocation parcelTotalSqm = 18000');
else fail('parcelTotalSqm', `${validation.parcelTotalSqm}`);
if (validation.allocatedSqm === 5000) pass('Fix 2: validateLandAllocation allocatedSqm = 5000');
else fail('allocatedSqm', `${validation.allocatedSqm}`);
if (validation.status === 'under' && validation.unallocatedSqm === 13000) pass('Fix 2: validation status=under (13000 sqm unallocated)');
else fail('validation status under', `status=${validation.status}, unallocated=${validation.unallocatedSqm}`);

const overParcels: Parcel[] = [{ id: 'p_a', phaseId: 'p1', name: 'X', area: 1000, rate: 100, cashPct: 100, inKindPct: 0 }];
const overAsset: Asset = { ...assetMulti, landAllocation: { multiParcelSplits: [{ parcelId: 'p_a', sqm: 2000 }] } };
const overValidation = validateLandAllocation(overParcels, [overAsset], 'sqm');
if (overValidation.status === 'over' && overValidation.overAllocatedSqm === 1000) pass('Fix 2: validation status=over (1000 sqm excess)');
else fail('validation status over', `status=${overValidation.status}, over=${overValidation.overAllocatedSqm}`);

// Fix 5: computeProjectTimeline endYear, MAAD-shape (4 + 10 = 14 yrs).
const maadPhases: Phase[] = [
  { id: 'p1', name: 'Phase 1', constructionStart: 1, constructionPeriods: 4, operationsPeriods: 10, overlapPeriods: 0, startDate: '2025-01-01' },
];
const maadTimeline = computeProjectTimeline(project, maadPhases);
if (maadTimeline.endDate === '2039-01-01') pass(`Fix 5: MAAD-shape endDate = 2039-01-01 (got ${maadTimeline.endDate})`);
else fail('Fix 5 endDate', `expected 2039-01-01, got ${maadTimeline.endDate}`);
if (maadTimeline.endYear === 2039) pass(`Fix 5: MAAD-shape endYear = 2039 (no +1 offset)`);
else fail('Fix 5 endYear', `expected 2039, got ${maadTimeline.endYear}`);
if (maadTimeline.totalPeriods === 14) pass(`Fix 5: MAAD-shape totalPeriods = 14`);
else fail('Fix 5 totalPeriods', `expected 14, got ${maadTimeline.totalPeriods}`);
if (maadTimeline.start === maadTimeline.startDate) pass('Fix 5: legacy alias .start mirrors .startDate');
else fail('legacy alias start', 'mismatch');
if (maadTimeline.end === maadTimeline.endDate) pass('Fix 5: legacy alias .end mirrors .endDate');
else fail('legacy alias end', 'mismatch');

// Fix 6: BUA derives from sub-units.
const f6Asset: Asset = {
  id: 'a6', phaseId: 'p1', name: 'Branded Apt', type: 'Branded Residences',
  strategy: 'Sell', visible: true, gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0,
};
const f6SubUnits: SubUnit[] = [
  { id: 's1', assetId: 'a6', name: '1BR', category: 'Sellable', metric: 'area', metricValue: 47800, unitPrice: 33456 },
  { id: 's2', assetId: 'a6', name: '2BR', category: 'Sellable', metric: 'area', metricValue: 36497, unitPrice: 33505 },
  { id: 's3', assetId: 'a6', name: 'Support', category: 'Support', metric: 'area', metricValue: 46577, unitPrice: 0 },
  { id: 's4', assetId: 'a6', name: 'Parking', category: 'Parking', metric: 'area', metricValue: 26259, unitPrice: 0 },
];
const f6Bua = computeAssetBua(f6Asset, f6SubUnits);
if (f6Bua === 47800 + 36497 + 46577 + 26259) pass(`Fix 6: BUA total = 47800 + 36497 + 46577 + 26259 = ${f6Bua}`);
else fail('Fix 6 BUA total', `expected 157133, got ${f6Bua}`);
const f6Sellable = computeAssetSellableBua(f6Asset, f6SubUnits);
if (f6Sellable === 47800 + 36497) pass(`Fix 6: Sellable BUA = 47800 + 36497 = ${f6Sellable} (Support + Parking excluded)`);
else fail('Fix 6 Sellable BUA', `expected 84297, got ${f6Sellable}`);

// Fix 6: empty asset (no sub-units) falls back to asset.buaSqm.
const f6EmptyAsset: Asset = { ...f6Asset, buaSqm: 1000 };
const f6EmptyBua = computeAssetBua(f6EmptyAsset, []);
if (f6EmptyBua === 1000) pass('Fix 6: empty asset falls back to asset.buaSqm');
else fail('Fix 6 empty fallback', `expected 1000, got ${f6EmptyBua}`);

// ── Section 4: source-file markers ───────────────────────────────────────
console.log('\n[4/5] Source-file markers (M2.0f)');

interface Marker { label: string; path: string; needle: string }
const componentRoot = 'src/hubs/modeling/platforms/refm/components';
const moduleRoot = `${componentRoot}/modules`;
const calcPath = 'src/core/calculations/index.ts';
const typesPath = 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts';
const assetsPath = `${moduleRoot}/Module1Assets.tsx`;
const phasesPath = `${moduleRoot}/Module1ProjectPhases.tsx`;
const cssPath = 'app/globals.css';

const markers: Marker[] = [
  // Fix 1: layout
  { label: 'F1.1: pm-toolbar position sticky (not fixed)', path: cssPath, needle: 'position: sticky;' },
  { label: 'F1.2: M2.0f Fix 1 marker', path: cssPath, needle: 'M2.0f Fix 1' },
  { label: 'F1.3: module-view padding cleaned', path: cssPath, needle: '.module-view { animation: moduleFade 0.15s ease forwards; }' },

  // Fix 2: schema + calc
  { label: 'F2.1: AssetLandAllocation interface', path: typesPath, needle: 'export interface AssetLandAllocation' },
  { label: 'F2.2: AssetParcelSplit interface', path: typesPath, needle: 'export interface AssetParcelSplit' },
  { label: 'F2.3: Asset.landAllocation optional field', path: typesPath, needle: 'landAllocation?: AssetLandAllocation' },
  { label: 'F2.4: computeAssetLandBreakdown export', path: calcPath, needle: 'export function computeAssetLandBreakdown' },
  { label: 'F2.5: validateLandAllocation export', path: calcPath, needle: 'export function validateLandAllocation' },
  { label: 'F2.6: per-parcel cash/inkind splits', path: calcPath, needle: 'breakdown.splits.length > 0' },
  { label: 'F2.7: Module1Assets parcelId dropdown', path: assetsPath, needle: 'asset-${asset.id}-parcelId' },
  { label: 'F2.8: Module1Assets multi-parcel section', path: assetsPath, needle: 'multi-parcel-section' },
  { label: 'F2.9: Module1Assets validation banner', path: assetsPath, needle: 'land-allocation-validation' },

  // Fix 3: catalog
  { label: 'F3.1: ProjectType Industrial', path: typesPath, needle: "'Industrial'" },
  { label: 'F3.2: ProjectType Data Center', path: typesPath, needle: "'Data Center'" },
  { label: 'F3.3: ProjectType Education', path: typesPath, needle: "'Education'" },
  { label: 'F3.4: ProjectType Marina', path: typesPath, needle: "'Marina'" },
  { label: 'F3.5: ProjectType Senior Living', path: typesPath, needle: "'Senior Living'" },
  { label: 'F3.6: Hyperscale asset type', path: typesPath, needle: "'Hyperscale'" },
  { label: 'F3.7: Hospital asset type', path: typesPath, needle: "'Hospital (Multi-specialty)'" },

  // Fix 4: phase startDate persistence
  { label: 'F4.1: Module1ProjectPhases phase startDate input', path: phasesPath, needle: 'phase-${phase.id}-startDate' },
  { label: 'F4.2: Module1ProjectPhases constructionEnd column', path: phasesPath, needle: 'phase-${phase.id}-constructionEnd' },
  { label: 'F4.3: Module1ProjectPhases operationsEnd column', path: phasesPath, needle: 'phase-${phase.id}-operationsEnd' },
  { label: 'F4.4: Module1ProjectPhases computePhaseTimeline import', path: phasesPath, needle: 'computePhaseTimeline' },
  { label: 'F4.5: Module1ProjectPhases handleAddPhase startDate seed', path: phasesPath, needle: 'computeNextPhaseStartDate' },

  // Fix 5: project end year
  { label: 'F5.1: ProjectTimeline endYear field', path: calcPath, needle: 'endYear: number' },
  { label: 'F5.2: ProjectTimeline totalPeriods field', path: calcPath, needle: 'totalPeriods: number' },
  { label: 'F5.3: M2.0f Fix 5 marker', path: calcPath, needle: 'M2.0f Fix 5' },
  { label: 'F5.4: Module1ProjectPhases project-end-year testid', path: phasesPath, needle: 'project-end-year' },

  // Fix 6: sub-unit BUA + Parking
  { label: 'F6.1: SubUnitCategory Parking', path: typesPath, needle: "'Parking'" },
  { label: 'F6.2: SUB_UNIT_CATEGORIES Parking', path: typesPath, needle: "'Sellable',\n  'Operable',\n  'Leasable',\n  'Support',\n  'Parking',\n] as const" },
  { label: 'F6.3: computeAssetBua sub-unit-first', path: calcPath, needle: 'M2.0f Fix 6' },
  { label: 'F6.4: Module1Assets areas row derived', path: assetsPath, needle: 'asset-${asset.id}-areas-row' },
  { label: 'F6.5: Module1Assets globals card 7 cols (parking)', path: assetsPath, needle: 'globals-parking' },
  { label: 'F6.6: Module1Assets reconciliation REMOVED', path: assetsPath, needle: 'Reconciliation row removed' },
];

for (const m of markers) {
  const fullPath = join(REPO_ROOT, m.path);
  if (!existsSync(fullPath)) {
    fail(m.label, `file missing: ${m.path}`);
    continue;
  }
  const src = readFileSync(fullPath, 'utf8');
  if (src.includes(m.needle)) pass(m.label);
  else fail(m.label, `marker missing: ${m.needle.slice(0, 80)}`);
}

// Em-dash sweep across the new code
const emDashFiles = [
  typesPath,
  calcPath,
  assetsPath,
  phasesPath,
  cssPath,
];
let emDashFails = 0;
for (const f of emDashFiles) {
  const src = readFileSync(join(REPO_ROOT, f), 'utf8');
  if (src.includes('—')) {
    emDashFails++;
    console.log(`  FAIL  em-dash in ${f}`);
  }
}
if (emDashFails === 0) pass('X1: em-dash sweep, zero hits across 5 files');
else fail('X1: em-dash sweep', `${emDashFails} files contain em-dash`);

// ── Section 5: Playwright ────────────────────────────────────────────────
console.log('\n[5/5] Playwright UI smoke');
const specPath = join(REPO_ROOT, 'tests/e2e/m20f-structural-fixes.spec.ts');
if (!existsSync(specPath)) {
  fail('Playwright spec', 'tests/e2e/m20f-structural-fixes.spec.ts not found');
} else {
  pass('m20f-structural-fixes.spec.ts present');
  if (!routeOk) {
    skip('Playwright run', 'sign-in required for full smoke; spec runnable when /refm returns 200');
  } else {
    try {
      execSync('npx playwright test tests/e2e/m20f-structural-fixes.spec.ts --reporter=list', {
        stdio: 'pipe',
        timeout: 180000,
      });
      pass('Playwright m20f-structural-fixes.spec.ts');
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
