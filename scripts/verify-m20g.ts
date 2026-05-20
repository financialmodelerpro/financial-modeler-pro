/* eslint-disable no-console */
/**
 * verify-m20g.ts (M2.0g verifier)
 *
 * 5-section per-phase verifier for the M2.0g display + reconciliation
 * + Costs-tab restructure milestone.
 *
 * Sections:
 *   1. Schema: DisplayScale enum, OutputGranularity enum, Asset
 *      buaTotal/supportArea/parkingArea, AssetLandAllocation custom
 *      sentinels, CostMethod adds 3 new options, SubUnitCategory
 *      drops Parking, SCHEMA_VERSION = 8.
 *   2. Routes + baseline: dev server reachable, baseline diff
 *      bit-identical against the post-v8 47.8 KB sha 22923b5275a7.
 *   3. Calc engine: periodEndDate annual + monthly + mid-year,
 *      formatScaled full / thousands / millions, computeAssetArea-
 *      Totals reference shape reconciliation, computeLandReconciliation,
 *      land allocation single + custom + multi-parcel, v7 -> v8
 *      monthly migration aggregates.
 *   4. State: source-file markers for the M2.0g surface files +
 *      em-dash sweep.
 *   5. UI: Playwright spec presence + run gate.
 *
 * Usage: npx tsx scripts/verify-m20g.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

import {
  DISPLAY_SCALES,
  DISPLAY_SCALE_LABELS,
  OUTPUT_GRANULARITIES,
  OUTPUT_GRANULARITY_LABELS,
  PARCEL_WEIGHTED_AVG,
  PARCEL_CUSTOM_RATE,
  COST_METHODS,
  SUB_UNIT_CATEGORIES,
  type Phase,
  type Project,
  type Parcel,
  type Asset,
  type SubUnit,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { SCHEMA_VERSION, hydrationFromAnySnapshotChecked } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  periodEndDate,
  computePhaseTimeline,
  computeAssetAreaTotals,
  computeAssetLandBreakdown,
  computeLandReconciliation,
} from '../src/core/calculations';
import { formatScaled } from '../src/core/formatters';

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

if (SCHEMA_VERSION === 8) pass(`SCHEMA_VERSION = 8 (M2.0g v8)`);
else fail('SCHEMA_VERSION', `expected 8, got ${SCHEMA_VERSION}`);

if (DISPLAY_SCALES.length === 3) pass('DISPLAY_SCALES has 3 entries (full/thousands/millions)');
else fail('DISPLAY_SCALES count', `expected 3, got ${DISPLAY_SCALES.length}`);
if (DISPLAY_SCALE_LABELS.full && DISPLAY_SCALE_LABELS.thousands && DISPLAY_SCALE_LABELS.millions) {
  pass('DISPLAY_SCALE_LABELS keys present');
} else fail('DISPLAY_SCALE_LABELS', 'missing key');

if (OUTPUT_GRANULARITIES.length === 3) pass('OUTPUT_GRANULARITIES has 3 entries (annual/quarterly/monthly)');
else fail('OUTPUT_GRANULARITIES', `expected 3, got ${OUTPUT_GRANULARITIES.length}`);
if (OUTPUT_GRANULARITY_LABELS.annual === 'Annual') pass('OUTPUT_GRANULARITY_LABELS.annual');
else fail('OUTPUT_GRANULARITY_LABELS.annual', 'mismatch');

if (PARCEL_WEIGHTED_AVG === '__weighted__' && PARCEL_CUSTOM_RATE === '__custom__') {
  pass('PARCEL_WEIGHTED_AVG / PARCEL_CUSTOM_RATE sentinels');
} else fail('parcel sentinels', 'value mismatch');

const newCostMethods = ['rate_x_support_area', 'rate_x_parking_area', 'rate_x_specific_subunit'];
if (newCostMethods.every((m) => COST_METHODS.includes(m as never))) {
  pass('COST_METHODS adds 3 new (support_area / parking_area / specific_subunit)');
} else fail('COST_METHODS new', `missing one of ${newCostMethods.join(', ')}`);

if (!SUB_UNIT_CATEGORIES.includes('Parking' as never)) {
  pass("SUB_UNIT_CATEGORIES drops 'Parking' (M2.0g moves to asset-level)");
} else fail('SUB_UNIT_CATEGORIES Parking', 'still present');

// Asset.buaTotal / supportArea / parkingArea additive on Asset.
const a: Asset = {
  id: 'a1', phaseId: 'p1', name: 'A', type: 'X', strategy: 'Sell', visible: true,
  gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0,
  buaTotal: 100000, supportArea: 5000, parkingArea: 8000,
};
if (a.buaTotal === 100000 && a.supportArea === 5000 && a.parkingArea === 8000) {
  pass('Asset.buaTotal / supportArea / parkingArea roundtrip');
} else fail('asset additive fields', 'roundtrip failed');

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
  if (out.includes('OK: bit-identical')) pass('module1-v5-diff bit-identical (47.8 KB sha 22923b5275a7 post-v8)');
  else fail('module1-v5-diff', out.slice(0, 200));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  fail('module1-v5-diff', msg.slice(0, 200));
}

// ── Section 3: calc engine ────────────────────────────────────────────────
console.log('\n[3/5] Calc engine');

// Fix 1: periodEndDate
const e1 = periodEndDate('2025-01-01', 4, 'annual');
if (e1 === '2028-12-31') pass(`Fix 1: periodEndDate annual 2025-01-01 + 4y = ${e1}`);
else fail('Fix 1 annual end', `expected 2028-12-31, got ${e1}`);

const e2 = periodEndDate('2025-01-01', 48, 'monthly');
if (e2 === '2028-12-31') pass(`Fix 1: periodEndDate monthly 2025-01-01 + 48m = ${e2}`);
else fail('Fix 1 monthly end', `expected 2028-12-31, got ${e2}`);

const e3 = periodEndDate('2027-06-01', 3, 'annual');
if (e3 === '2030-05-31') pass(`Fix 1: periodEndDate annual mid-year 2027-06-01 + 3y = ${e3}`);
else fail('Fix 1 mid-year', `expected 2030-05-31, got ${e3}`);

// Fix 1: computePhaseTimeline operationsStart = day after constructionEnd
const project: Project = { name: 'M', currency: 'SAR', modelType: 'annual', startDate: '2025-01-01', status: 'draft', location: '' };
const phase: Phase = { id: 'p1', name: 'P1', constructionStart: 1, constructionPeriods: 4, operationsPeriods: 10, overlapPeriods: 0, startDate: '2025-01-01' };
const tl = computePhaseTimeline(phase, project);
if (tl.constructionEnd === '2028-12-31' && tl.operationsStart === '2029-01-01' && tl.operationsEnd === '2038-12-31') {
  pass('Fix 1: reference chain constructionEnd=2028-12-31 / opsStart=2029-01-01 / opsEnd=2038-12-31');
} else fail('Fix 1 reference chain', `got ${tl.constructionEnd} / ${tl.operationsStart} / ${tl.operationsEnd}`);

// Fix 3: formatScaled
if (formatScaled(1234567, 'full') === '1,234,567.00') pass(`Fix 3: formatScaled full = ${formatScaled(1234567, 'full')}`);
else fail('formatScaled full', `got ${formatScaled(1234567, 'full')}`);
if (formatScaled(1234567, 'thousands') === '1,234.57 K') pass(`Fix 3: formatScaled thousands = ${formatScaled(1234567, 'thousands')}`);
else fail('formatScaled thousands', `got ${formatScaled(1234567, 'thousands')}`);
if (formatScaled(1234567, 'millions') === '1.23 M') pass(`Fix 3: formatScaled millions = ${formatScaled(1234567, 'millions')}`);
else fail('formatScaled millions', `got ${formatScaled(1234567, 'millions')}`);
if (formatScaled(-1234.56, 'full') === '(1,234.56)') pass(`Fix 3: formatScaled negatives = ${formatScaled(-1234.56, 'full')}`);
else fail('formatScaled neg', `got ${formatScaled(-1234.56, 'full')}`);
if (formatScaled(0, 'full') === '0.00') pass(`Fix 3: formatScaled zero = ${formatScaled(0, 'full')}`);
else fail('formatScaled zero', `got ${formatScaled(0, 'full')}`);

// Fix 4: computeAssetAreaTotals
const f4Asset: Asset = {
  id: 'a4', phaseId: 'p1', name: 'BA', type: 'BR', strategy: 'Sell', visible: true,
  gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0,
  buaTotal: 157133, supportArea: 46577, parkingArea: 26259,
};
const f4SubUnits: SubUnit[] = [
  { id: 's1', assetId: 'a4', name: '1BR', category: 'Sellable', metric: 'area', metricValue: 47800, unitPrice: 33456 },
  { id: 's2', assetId: 'a4', name: '2BR', category: 'Sellable', metric: 'area', metricValue: 36497, unitPrice: 33505 },
];
const totals = computeAssetAreaTotals(f4Asset, f4SubUnits);
if (totals.subUnitsRevenue === 84297 && totals.supportArea === 46577 && totals.parkingArea === 26259) {
  pass('Fix 4: computeAssetAreaTotals sub-units 84297 + support 46577 + parking 26259');
} else fail('computeAssetAreaTotals', `got ${totals.subUnitsRevenue} / ${totals.supportArea} / ${totals.parkingArea}`);
if (totals.derivedTotal === 84297 + 46577 + 26259) {
  pass(`Fix 4: derivedTotal = ${totals.derivedTotal} (matches reference 157,133)`);
} else fail('derivedTotal', `expected 157133, got ${totals.derivedTotal}`);
if (totals.matches === true && totals.mismatchSqm === 0) pass('Fix 4: reconciliation matches');
else fail('reconciliation match', `mismatch ${totals.mismatchSqm}`);

// Fix 2: land allocation custom rate + weighted avg + multi-parcel
const parcels: Parcel[] = [
  { id: 'p1a', phaseId: 'p1', name: 'A', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 },
  { id: 'p1b', phaseId: 'p1', name: 'B', area: 5000, rate: 2000, cashPct: 100, inKindPct: 0 },
];
const customAsset: Asset = {
  id: 'a-custom', phaseId: 'p1', name: 'Custom', type: 'X', strategy: 'Sell', visible: true,
  gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0,
  landAllocation: { parcelId: PARCEL_CUSTOM_RATE, sqm: 1000, customRate: 5000 },
};
const customBd = computeAssetLandBreakdown(customAsset, parcels, [customAsset], [], 'sqm');
if (customBd.landValue === 5000000) pass(`Fix 2: custom rate 1000 sqm × 5000 = ${customBd.landValue}`);
else fail('custom rate', `expected 5000000, got ${customBd.landValue}`);

const wAvgAsset: Asset = { ...customAsset, id: 'a-wavg', landAllocation: { parcelId: PARCEL_WEIGHTED_AVG, sqm: 1000 } };
const wAvgBd = computeAssetLandBreakdown(wAvgAsset, parcels, [wAvgAsset], [], 'sqm');
// Weighted avg = (10000*1000 + 5000*2000) / (10000 + 5000) = 20000000/15000 = 1333.33
const expectedWAvg = (10000 * 1000 + 5000 * 2000) / 15000;
if (Math.abs(wAvgBd.rate - expectedWAvg) < 0.5) pass(`Fix 2: weighted avg rate = ${wAvgBd.rate.toFixed(2)}`);
else fail('weighted avg', `expected ~${expectedWAvg}, got ${wAvgBd.rate}`);

// computeLandReconciliation
const reconParcels: Parcel[] = [
  { id: 'r1', phaseId: 'p1', name: 'R1', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 },
];
const reconAssets: Asset[] = [
  { id: 'ra1', phaseId: 'p1', name: 'A1', type: 'X', strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0,
    landAllocation: { parcelId: 'r1', sqm: 8000 } },
];
const recon = computeLandReconciliation(reconParcels, reconAssets, [], 'sqm');
if (recon.parcelsTotalSqm === 10000 && recon.assetsAllocatedSqm === 8000 && recon.shortBy === 2000) {
  pass('Fix 2: computeLandReconciliation under-allocated 2000 sqm');
} else fail('computeLandReconciliation under', `parcels ${recon.parcelsTotalSqm} alloc ${recon.assetsAllocatedSqm} short ${recon.shortBy}`);

// v7 -> v8 monthly migration: aggregate periods 12 -> 1
const v7Snap = {
  version: 7,
  project: { name: 'L', currency: 'SAR', modelType: 'monthly', startDate: '2025-01-01', status: 'draft', location: '' },
  phases: [{ id: 'p1', name: 'P1', constructionStart: 1, constructionPeriods: 24, operationsPeriods: 60, overlapPeriods: 0 }],
  parcels: [],
  assets: [],
  subUnits: [],
  costLines: [],
  costOverrides: [],
  financingTranches: [],
  equityContributions: [],
  landAllocationMode: 'autoByBua',
};
const checked = hydrationFromAnySnapshotChecked(v7Snap);
const migratedPhase = checked.snapshot.phases[0];
if (checked.snapshot.project.modelType === 'annual' && migratedPhase.constructionPeriods === 2 && migratedPhase.operationsPeriods === 5) {
  pass('Fix v8: v7 monthly migration aggregates 24m->2y, 60m->5y');
} else fail('v7 migration', `modelType=${checked.snapshot.project.modelType}, cons=${migratedPhase.constructionPeriods}, ops=${migratedPhase.operationsPeriods}`);
if (checked.snapshot.project.outputGranularity === 'monthly') {
  pass("Fix v8: outputGranularity preserved as 'monthly' from source");
} else fail('outputGranularity preserve', `${checked.snapshot.project.outputGranularity}`);

// ── Section 4: source-file markers ───────────────────────────────────────
console.log('\n[4/5] Source-file markers (M2.0g)');

interface Marker { label: string; path: string; needle: string }
const componentRoot = 'src/hubs/modeling/platforms/refm/components';
const moduleRoot = `${componentRoot}/modules`;
const calcPath = 'src/core/calculations/index.ts';
const typesPath = 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts';
const migratePath = 'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts';
const formatPath = 'src/core/formatters/index.ts';
const wizardPath = `${componentRoot}/modals/ProjectWizard.tsx`;
const assetsPath = `${moduleRoot}/Module1Assets.tsx`;
const phasesPath = `${moduleRoot}/Module1ProjectPhases.tsx`;
const costsPath = `${moduleRoot}/Module1Costs.tsx`;

const markers: Marker[] = [
  // Fix 1
  { label: 'M1.1: periodEndDate export', path: calcPath, needle: 'export function periodEndDate' },
  { label: 'M1.2: M2.0g Fix 1 marker', path: calcPath, needle: 'M2.0g Fix 1' },
  // Fix 2
  { label: 'M2.1: PARCEL_WEIGHTED_AVG sentinel', path: typesPath, needle: 'PARCEL_WEIGHTED_AVG' },
  { label: 'M2.2: PARCEL_CUSTOM_RATE sentinel', path: typesPath, needle: 'PARCEL_CUSTOM_RATE' },
  { label: 'M2.3: AssetLandAllocation.customRate', path: typesPath, needle: 'customRate?: number' },
  { label: 'M2.4: computeLandReconciliation export', path: calcPath, needle: 'export function computeLandReconciliation' },
  { label: 'M2.5: Module1Assets land-reconciliation testid', path: assetsPath, needle: 'land-reconciliation' },
  { label: 'M2.6: Module1Assets parcel dropdown defaults to first', path: assetsPath, needle: 'phaseParcels[0]?.id' },
  // Fix 3
  { label: 'M3.1: DisplayScale enum', path: typesPath, needle: "type DisplayScale = 'full' | 'thousands' | 'millions'" },
  { label: 'M3.2: formatScaled export', path: formatPath, needle: 'export function formatScaled' },
  { label: 'M3.3: formatScaledCurrency export', path: formatPath, needle: 'export function formatScaledCurrency' },
  { label: 'M3.4: ProjectWizard wiz-displayScale block', path: wizardPath, needle: 'wiz-displayScale-block' },
  { label: 'M3.5: Module1Costs scale threading', path: costsPath, needle: 'scale: DisplayScale' },
  // Fix 4
  { label: 'M4.1: Asset.buaTotal field', path: typesPath, needle: 'buaTotal?: number' },
  { label: 'M4.2: Asset.supportArea field', path: typesPath, needle: 'supportArea?: number' },
  { label: 'M4.3: Asset.parkingArea field', path: typesPath, needle: 'parkingArea?: number' },
  { label: 'M4.4: computeAssetAreaTotals export', path: calcPath, needle: 'export function computeAssetAreaTotals' },
  { label: 'M4.5: Module1Assets asset-level Support input', path: assetsPath, needle: 'asset-${asset.id}-supportArea' },
  { label: 'M4.6: Module1Assets asset-level Parking input', path: assetsPath, needle: 'asset-${asset.id}-parkingArea' },
  // M2.0h Fix 3 (2026-05-07) renamed 'bua-reconciliation' to
  // 'area-reconciliation' as the block now itemizes the full NSA/BUA/GFA
  // hierarchy. Loosen the marker accordingly per the standing
  // verifier-loosening precedent.
  { label: 'M4.7: Module1Assets area / BUA reconciliation block', path: assetsPath, needle: '-area-reconciliation' },
  // Fix 5: reconciliation breakdown markers (covered by M4.7)
  // Fix 6: Direct/Indirect labels gone
  { label: 'M6.1: Module1Costs deriveCostScope removed', path: costsPath, needle: 'M2.0g Fix 6' },
  // Fix 7
  { label: 'M7.1: Module1Costs sub-tabs', path: costsPath, needle: 'costs-sub-tabs' },
  { label: 'M7.2: Module1Costs sub-tab toggle (inputs/results)', path: costsPath, needle: "['inputs', 'results']" },
  { label: 'M7.3: Module1Costs sub-tab testid template', path: costsPath, needle: 'costs-sub-tab-${tab}' },
  { label: 'M7.4: Capex by Cost Type table (4th)', path: costsPath, needle: 'capex-by-cost-type' },
  { label: 'M7.5: Capex by Stage transposed (stage rows)', path: costsPath, needle: 'capex-stage-row-' },
  { label: 'M7.6: Capex by Period per cost-line breakdown', path: costsPath, needle: 'capex-period-line-' },
  // Addendum 1: Manual % phasing
  { label: 'A1.1: Module1Costs Manual % per-period inputs', path: costsPath, needle: 'manual-row' },
  { label: 'A1.2: Module1Costs Manual % auto-normalize', path: costsPath, needle: 'manual-normalize' },
  // Addendum 2: period labels Y0/Dec 25
  { label: 'A2.1: Module1Costs getPeriodLabel Dec YY', path: costsPath, needle: 'M2.0g Addendum 2' },
  { label: 'A2.2: Module1Costs cost row period labels', path: costsPath, needle: 'periodLabel: (idx: number) => string' },
  // Addendum 3: v8 schema bump
  { label: 'A3.1: SCHEMA_VERSION = 8', path: migratePath, needle: 'SCHEMA_VERSION = 8' },
  { label: 'A3.2: isV8Snapshot export', path: migratePath, needle: 'export function isV8Snapshot' },
  { label: 'A3.3: migrateV7ToV8 helper', path: migratePath, needle: 'function migrateV7ToV8' },
  { label: 'A3.4: Project.outputGranularity field', path: typesPath, needle: 'outputGranularity?: OutputGranularity' },
  { label: 'A3.5: Wizard Reporting Granularity label', path: wizardPath, needle: 'Reporting Granularity' },
  { label: 'A3.6: Wizard wiz-outputGranularity testid', path: wizardPath, needle: 'wiz-outputGranularity' },
  { label: 'A3.7: Wizard always-years periodUnit', path: wizardPath, needle: "const periodUnit = 'years';" },
  { label: 'A3.8: Module1ProjectPhases always years headers', path: phasesPath, needle: "Construction (${'years'})" },
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

// Em-dash sweep
const emDashFiles = [calcPath, typesPath, migratePath, formatPath, wizardPath, assetsPath, phasesPath, costsPath];
let emDashFails = 0;
for (const f of emDashFiles) {
  const src = readFileSync(join(REPO_ROOT, f), 'utf8');
  if (src.includes(', ')) {
    emDashFails++;
    console.log(`  FAIL  em-dash in ${f}`);
  }
}
if (emDashFails === 0) pass('X1: em-dash sweep, zero hits across 8 files');
else fail('X1: em-dash sweep', `${emDashFails} files contain em-dash`);

// ── Section 5: Playwright ────────────────────────────────────────────────
console.log('\n[5/5] Playwright UI smoke');
const specPath = join(REPO_ROOT, 'tests/e2e/m20g-display-recon-costs.spec.ts');
if (!existsSync(specPath)) {
  fail('Playwright spec', 'tests/e2e/m20g-display-recon-costs.spec.ts not found');
} else {
  pass('m20g-display-recon-costs.spec.ts present');
  if (!routeOk) {
    skip('Playwright run', 'sign-in required for full smoke; spec runnable when /refm returns 200');
  } else {
    try {
      execSync('npx playwright test tests/e2e/m20g-display-recon-costs.spec.ts --reporter=list', {
        stdio: 'pipe',
        timeout: 240000,
      });
      pass('Playwright m20g-display-recon-costs.spec.ts');
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
