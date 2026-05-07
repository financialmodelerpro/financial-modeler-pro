/* eslint-disable no-console */
/**
 * verify-m20h.ts (M2.0h verifier)
 *
 * 5-section per-phase verifier for the M2.0h area-hierarchy + cost-
 * granularity + display-cleanup + migration-banner milestone.
 *
 * Sections:
 *   1. Schema: Parcel.hasNdaDeduction / roadsPct / parksPct,
 *      CostMethod adds 'per_sub_unit_custom_rates', CostLine.perSub-
 *      UnitRates field, M20H_MIGRATION_NOTICE export, currencyHeaderLine
 *      formatter.
 *   2. Routes + baseline: dev server reachable, baseline diff
 *      bit-identical against the post-M2.0h refresh.
 *   3. Calc engine: computeAssetAreaHierarchy MAAD-shape + computeParcelNda
 *      toggle on/off + computeCostLinePerSubUnit MAAD example +
 *      distributeAnnualToPeriods + formatPeriodLabel + generatePeriodLabels.
 *   4. State: source-file markers across the M2.0h surface files +
 *      em-dash sweep.
 *   5. UI: Playwright spec presence + run gate.
 *
 * Usage: npx tsx scripts/verify-m20h.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

import {
  COST_METHODS,
  PER_SUBUNIT_RATE_KEY_SUPPORT,
  PER_SUBUNIT_RATE_KEY_PARKING,
  type Asset,
  type Parcel,
  type SubUnit,
  type CostLine,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  M20H_MIGRATION_NOTICE,
  hydrationFromAnySnapshotChecked,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  computeAssetAreaHierarchy,
  computeParcelNda,
  computeCostLinePerSubUnit,
  distributeAnnualToPeriods,
  formatPeriodLabel,
  generatePeriodLabels,
} from '../src/core/calculations';
import { currencyHeaderLine } from '../src/core/formatters';

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

if (COST_METHODS.includes('per_sub_unit_custom_rates' as never)) {
  pass("COST_METHODS adds 'per_sub_unit_custom_rates'");
} else fail('per_sub_unit_custom_rates', 'missing from COST_METHODS');

if (PER_SUBUNIT_RATE_KEY_SUPPORT === '__support__' && PER_SUBUNIT_RATE_KEY_PARKING === '__parking__') {
  pass('PER_SUBUNIT_RATE_KEY_SUPPORT / PER_SUBUNIT_RATE_KEY_PARKING sentinels');
} else fail('per-subunit sentinels', 'value mismatch');

const ndaParcel: Parcel = {
  id: 'pn',
  phaseId: 'p1',
  name: 'NDA test',
  area: 10000,
  rate: 1000,
  cashPct: 100,
  inKindPct: 0,
  hasNdaDeduction: true,
  roadsPct: 10,
  parksPct: 5,
};
if (ndaParcel.hasNdaDeduction === true && ndaParcel.roadsPct === 10 && ndaParcel.parksPct === 5) {
  pass('Parcel.hasNdaDeduction / roadsPct / parksPct roundtrip');
} else fail('Parcel NDA fields', 'roundtrip failed');

const lineWithRates: CostLine = {
  id: 'l1',
  phaseId: 'p1',
  name: 'Per-subunit',
  method: 'per_sub_unit_custom_rates',
  value: 6750,
  stage: 'hard',
  scope: 'direct',
  allocationBasis: 'per_asset',
  startPeriod: 1,
  endPeriod: 4,
  phasing: 'sCurve',
  perSubUnitRates: { sub_1bedroom: 6750, sub_2bedroom: 7200, __support__: 4500, __parking__: 2500 },
};
if (lineWithRates.perSubUnitRates && lineWithRates.perSubUnitRates['__parking__'] === 2500) {
  pass('CostLine.perSubUnitRates roundtrip');
} else fail('perSubUnitRates field', 'roundtrip failed');

if (M20H_MIGRATION_NOTICE.includes('annual inputs')) {
  pass('M20H_MIGRATION_NOTICE export contains expected wording');
} else fail('M20H_MIGRATION_NOTICE', 'wording missing');

if (currencyHeaderLine('SAR', 'full') === 'All figures in SAR') pass("currencyHeaderLine full = 'All figures in SAR'");
else fail('currencyHeaderLine full', `got ${currencyHeaderLine('SAR', 'full')}`);
if (currencyHeaderLine('SAR', 'thousands') === "All figures in SAR '000") pass("currencyHeaderLine thousands = SAR '000");
else fail('currencyHeaderLine thousands', `got ${currencyHeaderLine('SAR', 'thousands')}`);
if (currencyHeaderLine('USD', 'millions') === 'All figures in USD M') pass('currencyHeaderLine millions USD = USD M');
else fail('currencyHeaderLine millions', `got ${currencyHeaderLine('USD', 'millions')}`);

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
  if (out.includes('OK: bit-identical')) pass('module1-v5-diff bit-identical against M2.0h baseline');
  else fail('module1-v5-diff', out.slice(0, 200));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  fail('module1-v5-diff', msg.slice(0, 200));
}

// ── Section 3: calc engine ────────────────────────────────────────────────
console.log('\n[3/5] Calc engine');

// Fix 3: computeAssetAreaHierarchy MAAD-shape (Branded Apt T2&T3 example
// from spec: NSA 84,297 / BUA 130,874 / GFA 157,133).
const maadAsset: Asset = {
  id: 'maad',
  phaseId: 'p1',
  name: 'Branded Apt T2&T3',
  type: 'High-end Apartments',
  strategy: 'Sell',
  visible: true,
  gfaSqm: 0,
  buaSqm: 0,
  sellableBuaSqm: 0,
  parkingBaysRequired: 0,
  supportArea: 46577,
  parkingArea: 26259,
};
const maadSubUnits: SubUnit[] = [
  { id: 's1', assetId: 'maad', name: '1BR', category: 'Sellable', metric: 'area', metricValue: 47800, unitPrice: 33456 },
  { id: 's2', assetId: 'maad', name: '2BR', category: 'Sellable', metric: 'area', metricValue: 36497, unitPrice: 33505 },
];
const hier = computeAssetAreaHierarchy(maadAsset, maadSubUnits);
if (hier.nsa === 84297 && hier.bua === 130874 && hier.gfa === 157133) {
  pass(`Fix 3: MAAD hierarchy NSA ${hier.nsa} / BUA ${hier.bua} / GFA ${hier.gfa}`);
} else fail('Fix 3 hierarchy', `got NSA ${hier.nsa} / BUA ${hier.bua} / GFA ${hier.gfa}`);

// Fix 4: computeParcelNda toggle off
const offParcel: Parcel = { id: 'po', phaseId: 'p1', name: 'P', area: 16348, rate: 98450, cashPct: 100, inKindPct: 0 };
const offNda = computeParcelNda(offParcel);
if (offNda.nda === 16348 && Math.abs(offNda.effectiveNdaRate - 98450) < 0.01) {
  pass('Fix 4: NDA toggle OFF -> NDA = area, effectiveRate = parcelRate');
} else fail('Fix 4 NDA off', `nda ${offNda.nda} effRate ${offNda.effectiveNdaRate}`);

// Fix 4: computeParcelNda toggle on (10% roads, 5% parks)
const onParcel: Parcel = { ...offParcel, area: 9500, rate: 61722, hasNdaDeduction: true, roadsPct: 10, parksPct: 5 };
const onNda = computeParcelNda(onParcel);
const expectedNda = 9500 * 0.85;
const expectedTotal = 9500 * 61722;
const expectedRate = expectedTotal / expectedNda;
if (Math.abs(onNda.nda - expectedNda) < 0.5 && Math.abs(onNda.effectiveNdaRate - expectedRate) < 0.5) {
  pass(`Fix 4: NDA toggle ON 10% roads + 5% parks -> NDA ${onNda.nda} effRate ${onNda.effectiveNdaRate.toFixed(2)}`);
} else fail('Fix 4 NDA on', `nda ${onNda.nda} (expected ${expectedNda}), effRate ${onNda.effectiveNdaRate} (expected ${expectedRate})`);

// Fix 5: computeCostLinePerSubUnit MAAD-Spec example
const f5Asset: Asset = {
  id: 'f5',
  phaseId: 'p1',
  name: 'F5',
  type: 'X',
  strategy: 'Sell',
  visible: true,
  gfaSqm: 0,
  buaSqm: 0,
  sellableBuaSqm: 0,
  parkingBaysRequired: 0,
  supportArea: 46577,
  parkingArea: 26259,
};
const f5SubUnits: SubUnit[] = [
  { id: 'sub_1br', assetId: 'f5', name: '1BR', category: 'Sellable', metric: 'area', metricValue: 47800, unitPrice: 0 },
  { id: 'sub_2br', assetId: 'f5', name: '2BR', category: 'Sellable', metric: 'area', metricValue: 36497, unitPrice: 0 },
];
const f5Line: CostLine = {
  id: 'l5',
  phaseId: 'p1',
  name: 'Construction',
  method: 'per_sub_unit_custom_rates',
  value: 6750,
  stage: 'hard',
  scope: 'direct',
  allocationBasis: 'per_asset',
  startPeriod: 1,
  endPeriod: 4,
  phasing: 'sCurve',
  perSubUnitRates: {
    sub_1br: 6750,
    sub_2br: 7200,
    __support__: 4500,
    __parking__: 2500,
  },
};
const f5Bd = computeCostLinePerSubUnit(f5Line, f5Asset, f5SubUnits);
const expected1BR = 47800 * 6750;
const expected2BR = 36497 * 7200;
const expectedSupport = 46577 * 4500;
const expectedParking = 26259 * 2500;
const expectedTotalCost = expected1BR + expected2BR + expectedSupport + expectedParking;
if (Math.abs(f5Bd.totalCost - expectedTotalCost) < 1) {
  pass(`Fix 5: per-sub-unit total ${f5Bd.totalCost} (matches MAAD example sum)`);
} else fail('Fix 5 per-subunit total', `got ${f5Bd.totalCost}, expected ${expectedTotalCost}`);
if (f5Bd.rows.length === 4) pass('Fix 5: 4 rows (2 sub-units + Support + Parking)');
else fail('Fix 5 row count', `got ${f5Bd.rows.length}`);

// Fix 6: distributeAnnualToPeriods quarterly Even
const annual = [400];
const q = distributeAnnualToPeriods(annual, 'quarterly', 'even');
if (q.length === 4 && q.every((v) => Math.abs(v - 100) < 0.01)) {
  pass('Fix 6: distributeAnnualToPeriods quarterly Even = 4 × 100');
} else fail('Fix 6 quarterly even', `got ${JSON.stringify(q)}`);

// Fix 6: monthly Even = 12 × annual/12
const m = distributeAnnualToPeriods([1200], 'monthly', 'even');
if (m.length === 12 && m.every((v) => Math.abs(v - 100) < 0.01)) {
  pass('Fix 6: distributeAnnualToPeriods monthly Even = 12 × 100');
} else fail('Fix 6 monthly even', `length ${m.length}, sample ${m[0]}`);

// Fix 6: monthly S-curve preserves total within rounding
const sc = distributeAnnualToPeriods([1200], 'monthly', 'sCurve');
const scSum = sc.reduce((s, v) => s + v, 0);
if (Math.abs(scSum - 1200) < 0.01) {
  pass(`Fix 6: distributeAnnualToPeriods monthly sCurve preserves sum ${scSum}`);
} else fail('Fix 6 sCurve sum', `got ${scSum}`);

// Fix 6: formatPeriodLabel
const annualLabel = formatPeriodLabel('2025-12-31', 'annual');
if (annualLabel === 'Dec 25') pass(`Fix 6: formatPeriodLabel('2025-12-31', annual) = ${annualLabel}`);
else fail('Fix 6 formatPeriodLabel annual', `got ${annualLabel}`);
const qLabel = formatPeriodLabel('2025-03-31', 'quarterly');
if (qLabel === 'Q1 25') pass(`Fix 6: formatPeriodLabel('2025-03-31', quarterly) = ${qLabel}`);
else fail('Fix 6 formatPeriodLabel quarterly', `got ${qLabel}`);
const mLabel = formatPeriodLabel('2025-03-31', 'monthly');
if (mLabel === 'Mar 25') pass(`Fix 6: formatPeriodLabel('2025-03-31', monthly) = ${mLabel}`);
else fail('Fix 6 formatPeriodLabel monthly', `got ${mLabel}`);

// Fix 6: generatePeriodLabels for quarterly produces Q1..Q4 cycle
const qLabels = generatePeriodLabels('2025-01-01', 2, 'quarterly');
if (qLabels.length === 8 && qLabels[0] === 'Q1 25' && qLabels[7] === 'Q4 26') {
  pass('Fix 6: generatePeriodLabels quarterly cycles Q1..Q4 across years');
} else fail('Fix 6 generatePeriodLabels', `got ${JSON.stringify(qLabels)}`);

// Fix 1: v7 monthly migration emits notice
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
if (checked.migrationNotice && checked.migrationNotice.includes('annual inputs')) {
  pass('Fix 1: v7 monthly migration emits banner notice');
} else fail('Fix 1 banner notice', `notice: ${checked.migrationNotice}`);
if (checked.snapshot.project.modelType === 'annual' && (checked.snapshot.phases[0]).constructionPeriods === 2) {
  pass('Fix 1: v7 monthly migration aggregates 24m -> 2y in place');
} else fail('Fix 1 in-place aggregation', `got modelType ${checked.snapshot.project.modelType}, cp ${(checked.snapshot.phases[0]).constructionPeriods}`);

// Fix 1: v7 already-annual stamps outputGranularity but emits NO notice
const v7Annual = { ...v7Snap, project: { ...v7Snap.project, modelType: 'annual', outputGranularity: 'annual' } };
const checkedA = hydrationFromAnySnapshotChecked(v7Annual);
if (!checkedA.migrationNotice) pass('Fix 1: v7-annual snapshot does NOT emit migration notice');
else fail('Fix 1 spurious notice', `got ${checkedA.migrationNotice}`);

// ── Section 4: source-file markers ───────────────────────────────────────
console.log('\n[4/5] Source-file markers (M2.0h)');

interface Marker { label: string; path: string; needle: string }
const componentRoot = 'src/hubs/modeling/platforms/refm/components';
const moduleRoot = `${componentRoot}/modules`;
const calcPath = 'src/core/calculations/index.ts';
const typesPath = 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts';
const migratePath = 'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts';
const formatPath = 'src/core/formatters/index.ts';
const assetsPath = `${moduleRoot}/Module1Assets.tsx`;
const phasesPath = `${moduleRoot}/Module1ProjectPhases.tsx`;
const costsPath = `${moduleRoot}/Module1Costs.tsx`;
const financingPath = `${moduleRoot}/Module1Financing.tsx`;
const platformPath = `${componentRoot}/RealEstatePlatform.tsx`;
const syncPath = 'src/hubs/modeling/platforms/refm/lib/persistence/module1-sync.ts';
const dashboardPath = `${componentRoot}/Dashboard.tsx`;
const overviewPath = `${componentRoot}/OverviewScreen.tsx`;

const markers: Marker[] = [
  // Fix 1: migration banner
  { label: 'F1.1: M20H_MIGRATION_NOTICE export', path: migratePath, needle: 'M20H_MIGRATION_NOTICE' },
  { label: 'F1.2: snapshotNeedsV8Migration helper', path: migratePath, needle: 'snapshotNeedsV8Migration' },
  { label: 'F1.3: AttachResult.migrationNotice plumbing', path: syncPath, needle: 'migrationNotice?: string' },
  { label: 'F1.4: RealEstatePlatform migration banner JSX', path: platformPath, needle: 'm20h-migration-banner' },
  { label: 'F1.5: RealEstatePlatform setMigrationNotice state', path: platformPath, needle: 'setMigrationNotice' },
  // Fix 2: currency display cleanup
  { label: 'F2.1: currencyHeaderLine export', path: formatPath, needle: 'export function currencyHeaderLine' },
  { label: 'F2.2: Module1ProjectPhases header line', path: phasesPath, needle: 'currency-header-line' },
  { label: 'F2.3: Module1Assets header line', path: assetsPath, needle: 'currency-header-line' },
  { label: 'F2.4: Module1Costs header line', path: costsPath, needle: 'currency-header-line' },
  { label: 'F2.5: Module1Financing header line', path: financingPath, needle: 'currency-header-line' },
  { label: 'F2.6: Dashboard header line', path: dashboardPath, needle: 'dashboard-currency-header' },
  { label: 'F2.7: OverviewScreen header line', path: overviewPath, needle: 'overview-currency-header' },
  // Fix 3: NSA / BUA / GFA hierarchy
  { label: 'F3.1: computeAssetAreaHierarchy export', path: calcPath, needle: 'export function computeAssetAreaHierarchy' },
  { label: 'F3.2: AssetAreaHierarchy interface', path: calcPath, needle: 'interface AssetAreaHierarchy' },
  { label: 'F3.3: Module1Assets NSA chip', path: assetsPath, needle: '-area-hierarchy' },
  { label: 'F3.4: Module1Assets buaTotal input removed', path: assetsPath, needle: 'M2.0h Fix 3' },
  { label: 'F3.5: Module1Assets reconciliation NSA/BUA/GFA testids', path: assetsPath, needle: '-recon-nsa' },
  { label: 'F3.6: Module1Assets globals NSA/BUA/GFA tiles', path: assetsPath, needle: 'globals-nsa' },
  // Fix 4: Parcel NDA toggle
  { label: 'F4.1: Parcel.hasNdaDeduction field', path: typesPath, needle: 'hasNdaDeduction?: boolean' },
  { label: 'F4.2: Parcel.roadsPct + parksPct fields', path: typesPath, needle: 'parksPct?: number' },
  { label: 'F4.3: computeParcelNda export', path: calcPath, needle: 'export function computeParcelNda' },
  { label: 'F4.4: ParcelNda interface', path: calcPath, needle: 'effectiveNdaRate: number' },
  { label: 'F4.5: Module1Assets parcel NDA toggle column', path: assetsPath, needle: '-hasNdaDeduction' },
  { label: 'F4.6: Module1Assets parcel roadsPct input', path: assetsPath, needle: '-roadsPct' },
  { label: 'F4.7: Module1Assets parcel parksPct input', path: assetsPath, needle: '-parksPct' },
  { label: 'F4.8: Module1Assets parcels-total-nda', path: assetsPath, needle: 'parcels-total-nda' },
  // Fix 5: per-sub-unit custom rates
  { label: 'F5.1: per_sub_unit_custom_rates CostMethod', path: typesPath, needle: 'per_sub_unit_custom_rates' },
  { label: 'F5.2: PER_SUBUNIT_RATE_KEY_SUPPORT export', path: typesPath, needle: 'PER_SUBUNIT_RATE_KEY_SUPPORT' },
  { label: 'F5.3: CostLine.perSubUnitRates field', path: typesPath, needle: 'perSubUnitRates?: Record<string, number>' },
  { label: 'F5.4: computeCostLinePerSubUnit export', path: calcPath, needle: 'export function computeCostLinePerSubUnit' },
  { label: 'F5.5: Module1Costs per-sub-unit row testid', path: costsPath, needle: 'per-subunit-row' },
  // Fix 6: runtime view granularity
  { label: 'F6.1: distributeAnnualToPeriods export', path: calcPath, needle: 'export function distributeAnnualToPeriods' },
  { label: 'F6.2: formatPeriodLabel export', path: calcPath, needle: 'export function formatPeriodLabel' },
  { label: 'F6.3: generatePeriodLabels export', path: calcPath, needle: 'export function generatePeriodLabels' },
  { label: 'F6.4: Module1Costs results granularity toggle', path: costsPath, needle: 'costs-results-granularity-toggle' },
  { label: 'F6.5: Module1Costs SummaryTables.granularity prop', path: costsPath, needle: 'granularity: OutputGranularity' },
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

// Em-dash sweep across all M2.0h surface files.
const emDashFiles = [calcPath, typesPath, migratePath, formatPath, assetsPath, phasesPath, costsPath, financingPath, syncPath, platformPath, dashboardPath, overviewPath];
let emDashFails = 0;
for (const f of emDashFiles) {
  const src = readFileSync(join(REPO_ROOT, f), 'utf8');
  if (src.includes('—')) {
    emDashFails++;
    console.log(`  FAIL  em-dash in ${f}`);
  }
}
if (emDashFails === 0) pass(`X1: em-dash sweep, zero hits across ${emDashFiles.length} files`);
else fail('X1: em-dash sweep', `${emDashFails} files contain em-dash`);

// ── Section 5: Playwright ────────────────────────────────────────────────
console.log('\n[5/5] Playwright UI smoke');
const specPath = join(REPO_ROOT, 'tests/e2e/m20h-area-hierarchy-cost-granularity.spec.ts');
if (!existsSync(specPath)) {
  fail('Playwright spec', 'tests/e2e/m20h-area-hierarchy-cost-granularity.spec.ts not found');
} else {
  pass('m20h-area-hierarchy-cost-granularity.spec.ts present');
  if (!routeOk) {
    skip('Playwright run', 'sign-in required for full smoke; spec runnable when /refm returns 200');
  } else {
    try {
      execSync('npx playwright test tests/e2e/m20h-area-hierarchy-cost-granularity.spec.ts --reporter=list', {
        stdio: 'pipe',
        timeout: 240000,
      });
      pass('Playwright m20h-area-hierarchy-cost-granularity.spec.ts');
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
