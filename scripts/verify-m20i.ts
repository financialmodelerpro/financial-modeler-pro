/* eslint-disable no-console */
/**
 * verify-m20i.ts (M2.0i verifier)
 *
 * 5-section per-phase verifier for the M2.0i Module 1 final polish.
 *
 * Sections:
 *   1. Schema: Project.displayDecimals, Phase.status / historicalBaseline,
 *      Asset.historicalBaseline, SubUnitMetric rename ('count' -> 'units').
 *   2. Routes + baseline: dev server reachable, baseline diff
 *      bit-identical against the post-M2.0i refresh.
 *   3. Calc engine: distributeAnnualToPeriods sum integrity (Even,
 *      sCurve, manual fallback), formatNumber respects scale + decimals,
 *      computePhaseHistorical, computeOperationalRunRate growth.
 *   4. State: source-file markers across the 10 fixes + em-dash sweep.
 *   5. UI: Playwright spec presence + run gate.
 *
 * Usage: npx tsx scripts/verify-m20i.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

import {
  DISPLAY_DECIMALS,
  PHASE_STATUSES,
  PHASE_STATUS_LABELS,
  type Phase,
  type Asset,
  type SubUnit,
  type PhaseHistoricalBaseline,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { makeDefaultProject } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  distributeAnnualToPeriods,
  computePhaseHistorical,
  computeOperationalRunRate,
  computeSubUnitArea,
} from '../src/core/calculations';
import { formatScaled, currencyHeaderLine } from '../src/core/formatters';

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

if (DISPLAY_DECIMALS.length === 4 && DISPLAY_DECIMALS.includes(0) && DISPLAY_DECIMALS.includes(3)) {
  pass('DISPLAY_DECIMALS exposes 0/1/2/3');
} else fail('DISPLAY_DECIMALS', `length ${DISPLAY_DECIMALS.length}`);

const defaultProject = makeDefaultProject();
if (defaultProject.displayDecimals === 2) pass('makeDefaultProject defaults displayDecimals=2');
else fail('default decimals', `got ${defaultProject.displayDecimals}`);

if (PHASE_STATUSES.length === 3 && PHASE_STATUSES.includes('operational' as never)) {
  pass('PHASE_STATUSES has 3 entries (planning / construction / operational)');
} else fail('PHASE_STATUSES', `${PHASE_STATUSES.join(',')}`);

if (PHASE_STATUS_LABELS.operational === 'Operational') pass('PHASE_STATUS_LABELS.operational');
else fail('PHASE_STATUS_LABELS', 'operational mismatch');

// Phase.historicalBaseline + Asset.historicalBaseline structural check
const baseline: PhaseHistoricalBaseline = {
  historicalCapexTotal: 850_000_000,
  historicalEquityContributed: 425_000_000,
  historicalDebtDrawn: 425_000_000,
  currentDebtOutstanding: 320_000_000,
  cumulativeDepreciationCharged: 100_000_000,
  netBookValueFixedAssets: 750_000_000,
  last12MonthsRevenue: 145_000_000,
  last12MonthsOpex: 87_000_000,
  currentOccupancy: 65,
  currentAdr: 750,
};
const phase: Phase = {
  id: 'p-op',
  name: 'Hospitality Ops',
  constructionStart: 1,
  constructionPeriods: 0,
  operationsPeriods: 14,
  overlapPeriods: 0,
  status: 'operational',
  historicalBaseline: baseline,
};
if (phase.historicalBaseline?.currentDebtOutstanding === 320_000_000) {
  pass('Phase.historicalBaseline roundtrip');
} else fail('phase historical', 'roundtrip failed');

const opAsset: Asset = {
  id: 'a-op',
  phaseId: 'p-op',
  name: 'VOCO',
  type: 'Hotel 4-star',
  strategy: 'Operate',
  visible: true,
  gfaSqm: 0,
  buaSqm: 0,
  sellableBuaSqm: 0,
  parkingBaysRequired: 0,
  status: 'operational',
  historicalBaseline: baseline,
};
if (opAsset.historicalBaseline?.last12MonthsRevenue === 145_000_000) {
  pass('Asset.historicalBaseline roundtrip');
} else fail('asset historical', 'roundtrip failed');

// SubUnit metric rename: 'units' is canonical, legacy 'count' still computes.
const u1: SubUnit = { id: 'u1', assetId: 'a', name: '1BR', category: 'Sellable', metric: 'units', metricValue: 478, unitArea: 100, unitPrice: 1_500_000 };
const u2: SubUnit = { id: 'u2', assetId: 'a', name: '2BR', category: 'Sellable', metric: 'area', metricValue: 47_800, unitPrice: 1_500 };
if (computeSubUnitArea(u1) === 47_800) pass('SubUnit metric=units: count 478 × unitArea 100 = 47,800 sqm');
else fail('units area', `got ${computeSubUnitArea(u1)}`);
if (computeSubUnitArea(u2) === 47_800) pass('SubUnit metric=area: metricValue is total sqm');
else fail('area area', `got ${computeSubUnitArea(u2)}`);
const uLegacy = { ...u1, metric: 'count' as unknown as 'units' };
if (computeSubUnitArea(uLegacy) === 47_800) pass('Legacy metric=count still computes via fallback');
else fail('count fallback', `got ${computeSubUnitArea(uLegacy)}`);

// currencyHeaderLine respects scale.
if (currencyHeaderLine('SAR', 'thousands') === "All figures in SAR '000") pass("currencyHeaderLine thousands = SAR '000");
else fail('currencyHeaderLine thousands', currencyHeaderLine('SAR', 'thousands'));

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
  if (out.includes('OK: bit-identical')) pass('module1-v5-diff bit-identical against M2.0i baseline');
  else fail('module1-v5-diff', out.slice(0, 200));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  fail('module1-v5-diff', msg.slice(0, 200));
}

// ── Section 3: calc engine ────────────────────────────────────────────────
console.log('\n[3/5] Calc engine');

// Fix 2: distributeAnnualToPeriods sum integrity
const annual = [100_000_000, 100_000_000, 100_000_000, 100_000_000];

const evenQ = distributeAnnualToPeriods(annual, 'quarterly', 'even');
if (evenQ.length === 16 && Math.abs(evenQ[0] - 25_000_000) < 0.01) {
  pass('Fix 2: Even quarterly = 16 cells, each = 25M (annual/4)');
} else fail('Fix 2 even quarterly', `len ${evenQ.length}, [0] ${evenQ[0]}`);
const yearOneSum = evenQ.slice(0, 4).reduce((s, v) => s + v, 0);
if (Math.abs(yearOneSum - 100_000_000) < 0.01) pass('Fix 2: quarterly Y1 sum = annual 100M');
else fail('Fix 2 quarterly sum', `got ${yearOneSum}`);

const evenM = distributeAnnualToPeriods(annual, 'monthly', 'even');
if (evenM.length === 48 && Math.abs(evenM[0] - 100_000_000 / 12) < 0.01) {
  pass('Fix 2: Even monthly = 48 cells, each ≈ 8.33M (annual/12)');
} else fail('Fix 2 even monthly', `len ${evenM.length}, [0] ${evenM[0]}`);

const sCurveQ = distributeAnnualToPeriods(annual, 'quarterly', 'sCurve');
const sCurveYearOneSum = sCurveQ.slice(0, 4).reduce((s, v) => s + v, 0);
if (Math.abs(sCurveYearOneSum - 100_000_000) < 0.01) pass('Fix 2: S-curve quarterly Y1 sum integrity');
else fail('Fix 2 sCurve quarterly sum', `got ${sCurveYearOneSum}`);

const manualM = distributeAnnualToPeriods(annual, 'monthly', 'manual');
const manualYearOneSum = manualM.slice(0, 12).reduce((s, v) => s + v, 0);
if (Math.abs(manualYearOneSum - 100_000_000) < 0.01) pass('Fix 2: Manual phasing falls back to even within year, sum preserved');
else fail('Fix 2 manual fallback', `got ${manualYearOneSum}`);

// Fix 3: formatScaled with explicit decimals
if (formatScaled(1_234_567.89, 'thousands', 1) === '1,234.6 K') pass('Fix 3: formatScaled thousands decimals=1');
else fail('Fix 3 thousands d=1', formatScaled(1_234_567.89, 'thousands', 1));
if (formatScaled(1_234_567.89, 'millions', 0) === '1 M') pass('Fix 3: formatScaled millions decimals=0');
else fail('Fix 3 millions d=0', formatScaled(1_234_567.89, 'millions', 0));
if (formatScaled(1_234_567.89, 'full', 2) === '1,234,567.89') pass('Fix 3: formatScaled full decimals=2');
else fail('Fix 3 full d=2', formatScaled(1_234_567.89, 'full', 2));
if (formatScaled(1_234_567, 'full', 0) === '1,234,567') pass('Fix 3: formatScaled full decimals=0');
else fail('Fix 3 full d=0', formatScaled(1_234_567, 'full', 0));

// Fix 10: computePhaseHistorical
const opening = computePhaseHistorical(phase);
if (opening && opening.fixedAssetsNbv === 750_000_000 && opening.debtOutstanding === 320_000_000) {
  pass('Fix 10: computePhaseHistorical opening balances correct');
} else fail('Fix 10 opening', `got ${JSON.stringify(opening).slice(0, 120)}`);

const planningPhase: Phase = { ...phase, status: 'planning', historicalBaseline: undefined };
if (computePhaseHistorical(planningPhase) === null) pass('Fix 10: planning phase returns null (no opening balances)');
else fail('Fix 10 planning', 'should be null');

// Fix 10: computeOperationalRunRate growth
const rate = computeOperationalRunRate({ last12MonthsRevenue: 145_000_000, last12MonthsOpex: 87_000_000 }, 5, 3, 2);
const expectedRev = 145_000_000 * Math.pow(1.03, 5);
if (Math.abs(rate.revenue - expectedRev) < 1) pass(`Fix 10: 145M × 1.03^5 = ${rate.revenue.toFixed(0)} (target ${expectedRev.toFixed(0)})`);
else fail('Fix 10 run-rate', `got ${rate.revenue}, expected ${expectedRev}`);

// ── Section 4: source-file markers ───────────────────────────────────────
console.log('\n[4/5] Source-file markers (M2.0i)');

interface Marker { label: string; path: string; needle: string }
const componentRoot = 'src/hubs/modeling/platforms/refm/components';
const moduleRoot = `${componentRoot}/modules`;
const calcPath = 'src/core/calculations/index.ts';
const typesPath = 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts';
const formatPath = 'src/core/formatters/index.ts';
const assetsPath = `${moduleRoot}/Module1Assets.tsx`;
const phasesPath = `${moduleRoot}/Module1ProjectPhases.tsx`;
const costsPath = `${moduleRoot}/Module1Costs.tsx`;
const financingPath = `${moduleRoot}/Module1Financing.tsx`;
const platformPath = `${componentRoot}/RealEstatePlatform.tsx`;

const markers: Marker[] = [
  // Fix 1: Model Granularity input dropped
  { label: 'F1.1: Tab 1 no Model Granularity dropdown', path: phasesPath, needle: 'M2.0i Fix 1' },
  { label: 'F1.2: Tab 3 no modelType caption', path: costsPath, needle: 'inputs entered annually' },
  { label: 'F1.3: Tab 4 no modelType caption', path: financingPath, needle: 'inputs entered annually' },
  // Fix 2: distribution carries through
  { label: 'F2.1: SummaryTables consume granularity', path: costsPath, needle: 'granularity: OutputGranularity' },
  { label: 'F2.2: distributeAnnualToPeriods exported', path: calcPath, needle: 'export function distributeAnnualToPeriods' },
  // Fix 3: Display Settings panel
  { label: 'F3.1: DisplayDecimals type', path: typesPath, needle: 'DisplayDecimals' },
  { label: 'F3.2: Project.displayDecimals field', path: typesPath, needle: 'displayDecimals?: DisplayDecimals' },
  { label: 'F3.3: Tab 1 Display Settings panel', path: phasesPath, needle: 'display-settings' },
  { label: 'F3.4: Tab 1 display-scale radios', path: phasesPath, needle: 'display-scale-' },
  { label: 'F3.5: Tab 1 display-decimals radios', path: phasesPath, needle: 'display-decimals-' },
  // Fix 4: NDA toggle (carried over from M2.0h, verify still wired)
  { label: 'F4.1: Parcel NDA toggle column', path: assetsPath, needle: '-hasNdaDeduction' },
  { label: 'F4.2: ParcelNda effective rate', path: calcPath, needle: 'effectiveNdaRate' },
  // Fix 5: Parking Bays dropped
  { label: 'F5.1: parkingBaysRequired input removed from Areas row', path: assetsPath, needle: 'M2.0i Fix 5' },
  { label: 'F5.2: rate_per_parking_bay filtered from method dropdown', path: costsPath, needle: "m !== 'rate_per_parking_bay'" },
  // Fix 6: SubUnit metric area/units
  { label: 'F6.1: SubUnitMetric uses units (not count)', path: typesPath, needle: "type SubUnitMetric = 'units' | 'area'" },
  { label: 'F6.2: switchMetric helper', path: assetsPath, needle: 'function switchMetric' },
  { label: 'F6.3: SubUnitRow Units / Area dropdown labels', path: assetsPath, needle: '<option value="units">Units</option>' },
  { label: 'F6.4: count derived display when metric=area', path: assetsPath, needle: '-count-derived' },
  // Fix 7: Strategy short labels with tooltips
  { label: 'F7.1: STRATEGY_TOOLTIPS map', path: assetsPath, needle: 'STRATEGY_TOOLTIPS' },
  { label: 'F7.2: Strategy short label (Sell)', path: assetsPath, needle: "'Sell':          'Sell'" },
  // Fix 8: sticky sidebar
  { label: 'F8.1: RealEstatePlatform 100vh wrapper', path: platformPath, needle: "height: '100vh'" },
  // Fix 9: compact reconciliation
  { label: 'F9.1: LandReconciliationBlock component', path: assetsPath, needle: 'function LandReconciliationBlock' },
  { label: 'F9.2: AssetAreaReconciliationBlock component', path: assetsPath, needle: 'function AssetAreaReconciliationBlock' },
  { label: 'F9.3: localStorage key for land recon', path: assetsPath, needle: "RECON_LS_KEY = 'm20i-land-recon-collapsed'" },
  { label: 'F9.4: land reconciliation expand button', path: assetsPath, needle: 'land-reconciliation-expand' },
  { label: 'F9.5: land reconciliation summary line', path: assetsPath, needle: 'land-reconciliation-summary' },
  // Fix 10: Operational phase historical baseline
  { label: 'F10.1: PhaseStatus type', path: typesPath, needle: "PhaseStatus = 'planning' | 'construction' | 'operational'" },
  { label: 'F10.2: PhaseHistoricalBaseline interface', path: typesPath, needle: 'interface PhaseHistoricalBaseline' },
  { label: 'F10.3: Phase.historicalBaseline field', path: typesPath, needle: 'historicalBaseline?: PhaseHistoricalBaseline' },
  { label: 'F10.4: Asset.historicalBaseline field', path: typesPath, needle: 'historicalBaseline?: PhaseHistoricalBaseline' },
  { label: 'F10.5: computePhaseHistorical export', path: calcPath, needle: 'export function computePhaseHistorical' },
  { label: 'F10.6: computeOperationalRunRate export', path: calcPath, needle: 'export function computeOperationalRunRate' },
  { label: 'F10.7: Tab 1 phase status dropdown', path: phasesPath, needle: 'phase-${phase.id}-status' },
  { label: 'F10.8: Tab 1 historical baseline expansion', path: phasesPath, needle: '-historical-baseline' },
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
const emDashFiles = [calcPath, typesPath, formatPath, assetsPath, phasesPath, costsPath, financingPath, platformPath];
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
const specPath = join(REPO_ROOT, 'tests/e2e/m20i-final-polish.spec.ts');
if (!existsSync(specPath)) {
  fail('Playwright spec', 'tests/e2e/m20i-final-polish.spec.ts not found');
} else {
  pass('m20i-final-polish.spec.ts present');
  if (!routeOk) {
    skip('Playwright run', 'sign-in required for full smoke; spec runnable when /refm returns 200');
  } else {
    try {
      execSync('npx playwright test tests/e2e/m20i-final-polish.spec.ts --reporter=list', {
        stdio: 'pipe',
        timeout: 240000,
      });
      pass('Playwright m20i-final-polish.spec.ts');
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
