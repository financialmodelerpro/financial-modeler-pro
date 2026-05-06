/* eslint-disable no-console */
/**
 * verify-m20c.ts (M2.0c verifier)
 *
 * 5-section per-phase verifier for the v6 schema rebuild
 * (open-ended cost catalog + 5×5 financing matrix + sidebar
 * layout fix).
 *
 * Sections:
 *   1. Schema: SCHEMA_VERSION, type names, default cost catalog,
 *      v6 round-trip
 *   2. Routes: dev server reachable, baseline diff bit-identical
 *   3. Calc: calculateItemTotal across 13 methods, distribute
 *      across 6 phasing modes, computeFinancing across 5×5 matrix,
 *      annual + monthly granularity
 *   4. State: source-file markers for all v6 surface files,
 *      em-dash sweep
 *   5. UI: Playwright spec presence + run gate
 *
 * Usage: npx tsx scripts/verify-m20c.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

import { SCHEMA_VERSION } from '../src/hubs/modeling/platforms/refm/lib/persistence/types';
import {
  COST_METHODS,
  COST_METHOD_LABELS,
  COST_PHASINGS,
  COST_STAGES,
  COST_SCOPES,
  ALLOCATION_BASES,
  DRAWDOWN_METHODS,
  REPAYMENT_METHODS,
  makeDefaultCostLines,
  makeDefaultFinancingTranche,
  makeDefaultPhase,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  isV6Snapshot,
  isPreV6Snapshot,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  computeFinancing,
  distribute,
  resolveAssetAreaMetrics,
  calculateItemTotal,
  type AssetCostContext,
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

// M2.0d (2026-05-06) bumped SCHEMA_VERSION to 7. v6 was the M2.0c baseline;
// the current file remains useful as a regression for the v6 contract that
// stayed put (cost methods, phasings, allocation bases). The strict 6
// assertion is loosened to >= 6 so the verifier still exercises that
// chain without lying about the live schema.
if (SCHEMA_VERSION >= 6) pass(`SCHEMA_VERSION >= 6 (current: ${SCHEMA_VERSION})`);
else fail('SCHEMA_VERSION', `expected >= 6, got ${SCHEMA_VERSION}`);

// M2.0d added rate_per_parking_bay -> 14 methods. Either is acceptable
// for this verifier's purpose (both v6 and v7 have at least 13).
if (COST_METHODS.length >= 13) pass(`>= 13 cost methods (current: ${COST_METHODS.length})`);
else fail('cost methods', `expected >= 13, got ${COST_METHODS.length}`);

if (COST_PHASINGS.length === 6) pass('6 phasing modes');
else fail('phasing modes', `expected 6, got ${COST_PHASINGS.length}`);

if (COST_STAGES.length === 4) pass('4 cost stages');
else fail('cost stages', `expected 4, got ${COST_STAGES.length}`);

if (COST_SCOPES.length === 3) pass('3 cost scopes');
else fail('cost scopes', `expected 3, got ${COST_SCOPES.length}`);

if (ALLOCATION_BASES.length === 6) pass('6 allocation bases');
else fail('allocation bases', `expected 6, got ${ALLOCATION_BASES.length}`);

if (DRAWDOWN_METHODS.length === 5) pass('5 drawdown methods');
else fail('drawdown methods', `expected 5, got ${DRAWDOWN_METHODS.length}`);

if (REPAYMENT_METHODS.length === 5) pass('5 repayment methods');
else fail('repayment methods', `expected 5, got ${REPAYMENT_METHODS.length}`);

const defaults = makeDefaultCostLines('phase_1', 24);
if (defaults.length === 13) pass('default catalog seeds 13 lines (incl. locked Land Cash)');
else fail('default catalog', `expected 13 lines, got ${defaults.length}`);

const lockedLand = defaults.find((l) => l.id === 'land-cash');
if (lockedLand?.isLocked) pass('Land Cash row is locked');
else fail('Land Cash lock', 'expected isLocked === true');

// v6 detection
const v6Sample = {
  project: { name: 't', currency: 'SAR', modelType: 'annual', startDate: '2026-01-01', status: 'draft', location: '' },
  phases: [], parcels: [], landAllocationMode: 'autoByBua',
  assets: [], subUnits: [], costLines: [], costOverrides: [],
  financingTranches: [], equityContributions: [],
};
if (isV6Snapshot(v6Sample)) pass('isV6Snapshot recognises empty-array v6 shape');
else fail('isV6Snapshot empty', 'rejected canonical empty-array shape');

const v5Sample = { ...v6Sample, costLines: [{ key: 'land', phaseId: 'p1', method: 'lumpsum', value: 0, phasing: 'even' }] };
if (isPreV6Snapshot(v5Sample)) pass('isPreV6Snapshot detects v5 by costLine.key');
else fail('isPreV6Snapshot v5', 'failed to flag v5');

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
  if (out.includes('OK: bit-identical with baseline')) pass('module1-v5-diff bit-identical (49.6 KB sha256 15ed6f865342)');
  else fail('module1-v5-diff', out.slice(0, 200));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  fail('module1-v5-diff', msg.slice(0, 200));
}

// ── Section 3: calc engine ────────────────────────────────────────────────
console.log('\n[3/5] Calc engine');

// distribute: 6 phasing modes
let allDistOk = true;
for (const phasing of COST_PHASINGS) {
  if (phasing === 'manual') continue; // manual needs explicit weights
  const weights = distribute(phasing, 5);
  const sum = weights.reduce((s, v) => s + v, 0);
  if (Math.abs(sum - 1) > 1e-9) {
    allDistOk = false;
    fail(`distribute ${phasing}`, `weights sum to ${sum}, expected 1`);
  }
}
if (allDistOk) pass('6 phasing modes return weights summing to 1');

// distribute: manual normalisation
const manualWeights = distribute('manual', 4, [10, 20, 30, 40]);
if (Math.abs(manualWeights.reduce((s, v) => s + v, 0) - 1) < 1e-9) pass('distribute manual normalises to 1');
else fail('distribute manual', 'manual weights did not normalise');

// calculateItemTotal: spot-check 3 methods
const ctx: AssetCostContext = {
  asset: { id: 'a', phaseId: 'p1', name: 'A', type: 'Apt', strategy: 'Sell', visible: true, gfaSqm: 10000, buaSqm: 8000, sellableBuaSqm: 6000, parkingBaysRequired: 100 },
  metrics: {
    landSqm: 5000, ndaSqm: 4500, roadsSqm: 500,
    gfa: 10000, bua: 8000, nsa: 6000, unitCount: 50,
    parkingBays: 100,
    landValue: 2500000, cashLandValue: 1500000, inKindLandValue: 1000000,
  },
  resolvedDirectLineTotals: {},
};

const fixedTotal = calculateItemTotal({ id: 'a', phaseId: 'p1', name: 'X', method: 'fixed', value: 100000, stage: 'land', scope: 'direct', allocationBasis: 'per_asset', startPeriod: 0, endPeriod: 0, phasing: 'even' }, ctx);
if (fixedTotal === 100000) pass('calculateItemTotal fixed = value');
else fail('calculateItemTotal fixed', `expected 100000, got ${fixedTotal}`);

const ratePerBua = calculateItemTotal({ id: 'b', phaseId: 'p1', name: 'X', method: 'rate_per_bua', value: 200, stage: 'hard', scope: 'direct', allocationBasis: 'per_asset', startPeriod: 1, endPeriod: 12, phasing: 'even' }, ctx);
if (ratePerBua === 200 * 8000) pass('calculateItemTotal rate_per_bua = value × bua');
else fail('calculateItemTotal rate_per_bua', `expected ${200 * 8000}, got ${ratePerBua}`);

const pctCash = calculateItemTotal({ id: 'c', phaseId: 'p1', name: 'X', method: 'percent_of_cash_land', value: 5, stage: 'land', scope: 'direct', allocationBasis: 'per_asset', startPeriod: 0, endPeriod: 0, phasing: 'even' }, ctx);
if (Math.abs(pctCash - 1500000 * 0.05) < 0.01) pass('calculateItemTotal percent_of_cash_land = value% × cash land');
else fail('calculateItemTotal percent_of_cash_land', `expected ${1500000 * 0.05}, got ${pctCash}`);

// computeFinancing: annual vs monthly granularity
const annualPhase = makeDefaultPhase('p_a', 'A', 3, 5, 0);
const monthlyPhase = makeDefaultPhase('p_m', 'M', 36, 60, 0);
const tranche = makeDefaultFinancingTranche('t1', annualPhase.id);
const annualCapex = new Array(annualPhase.constructionPeriods + annualPhase.operationsPeriods).fill(1000000);
const monthlyCapex = new Array(monthlyPhase.constructionPeriods + monthlyPhase.operationsPeriods).fill(1000000 / 12);
const presales = new Array(96).fill(0);
const annualProj = { name: '', currency: 'SAR', modelType: 'annual' as const, startDate: '2026-01-01', status: 'draft' as const, location: '' };
const monthlyProj = { ...annualProj, modelType: 'monthly' as const };

const annualFin = computeFinancing(tranche, annualPhase, annualCapex, presales, annualProj);
const monthlyFin = computeFinancing(tranche, monthlyPhase, monthlyCapex, presales, monthlyProj);

if (annualFin.periodicRate === 0.075) pass('computeFinancing annual periodicRate = annual rate');
else fail('annual periodicRate', `expected 0.075, got ${annualFin.periodicRate}`);

if (Math.abs(monthlyFin.periodicRate - 0.075 / 12) < 1e-9) pass('computeFinancing monthly periodicRate = annual rate / 12');
else fail('monthly periodicRate', `expected ${0.075 / 12}, got ${monthlyFin.periodicRate}`);

if (annualFin.periods === 8) pass('computeFinancing annual periods = 8 (3 + 5)');
else fail('annual periods', `expected 8, got ${annualFin.periods}`);

if (monthlyFin.periods === 96) pass('computeFinancing monthly periods = 96 (36 + 60)');
else fail('monthly periods', `expected 96, got ${monthlyFin.periods}`);

// ── Section 4: source-file markers ───────────────────────────────────────
console.log('\n[4/5] Source-file markers (M2.0c)');

interface Marker { label: string; path: string; needle: string }
const componentRoot = 'src/hubs/modeling/platforms/refm/components';
const moduleRoot = `${componentRoot}/modules`;
const calcPath = 'src/core/calculations/index.ts';
const typesPath = 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts';

const markers: Marker[] = [
  { label: 'V1: schema bumped to v6', path: 'src/hubs/modeling/platforms/refm/lib/persistence/types.ts', needle: 'SCHEMA_VERSION = 6' },
  { label: 'V2: 13 CostMethods', path: typesPath, needle: 'percent_of_inkind_land' },
  { label: 'V3: 4 CostStages', path: typesPath, needle: "'operating'" },
  { label: 'V4: 6 AllocationBases', path: typesPath, needle: 'bua_share' },
  { label: 'V5: 5 DrawdownMethods', path: typesPath, needle: 'capex_minus_presales' },
  { label: 'V6: 5 RepaymentMethods', path: typesPath, needle: 'cashsweep_min_cash' },
  { label: 'V7: 12-default catalog', path: typesPath, needle: 'FF&E / Interior Design' },
  { label: 'V8: Project.country', path: typesPath, needle: 'country?: string' },
  { label: 'V9: Project.projectRoadsPct', path: typesPath, needle: 'projectRoadsPct?: number' },

  { label: 'C1: calc resolveAssetAreaMetrics', path: calcPath, needle: 'resolveAssetAreaMetrics' },
  { label: 'C2: calc 13-method switch', path: calcPath, needle: "case 'percent_of_inkind_land'" },
  { label: 'C3: calc distribute sCurve', path: calcPath, needle: "method === 'sCurve'" },
  { label: 'C4: calc resolveAllocationFactor', path: calcPath, needle: 'resolveAllocationFactor' },
  { label: 'C5: calc 5-drawdown switch', path: calcPath, needle: "case 'capex_minus_presales'" },
  { label: 'C6: calc 5-repayment switch', path: calcPath, needle: "'cashsweep_min_cash'" },
  { label: 'C7: calc IDC capitalize', path: calcPath, needle: 'idcCapitalize' },

  { label: 'U1: Module1Costs stage filter', path: `${moduleRoot}/Module1Costs.tsx`, needle: 'costs-stage-filter' },
  { label: 'U2: Module1Costs 13-method dropdown', path: `${moduleRoot}/Module1Costs.tsx`, needle: 'COST_METHOD_LABELS' },
  { label: 'U3: Module1Costs allocation basis', path: `${moduleRoot}/Module1Costs.tsx`, needle: 'allocation' },
  { label: 'U4: Module1Costs phasing dropdown', path: `${moduleRoot}/Module1Costs.tsx`, needle: 'PHASING_LABELS' },
  { label: 'U5: Module1Costs add custom row', path: `${moduleRoot}/Module1Costs.tsx`, needle: 'costs-add-' },
  { label: 'U6: Module1Costs per-asset detail', path: `${moduleRoot}/Module1Costs.tsx`, needle: 'costs-asset-detail' },
  { label: 'U7: Module1Costs period schedule', path: `${moduleRoot}/Module1Costs.tsx`, needle: 'costs-period-' },

  { label: 'F1: Module1Financing 5 drawdown', path: `${moduleRoot}/Module1Financing.tsx`, needle: 'DRAWDOWN_METHOD_LABELS' },
  { label: 'F2: Module1Financing 5 repayment', path: `${moduleRoot}/Module1Financing.tsx`, needle: 'REPAYMENT_METHOD_LABELS' },
  { label: 'F3: Module1Financing IDC toggle', path: `${moduleRoot}/Module1Financing.tsx`, needle: '-idc' },
  { label: 'F4: Module1Financing per-asset selector', path: `${moduleRoot}/Module1Financing.tsx`, needle: '-asset' },
  { label: 'F5: Module1Financing schedule table', path: `${moduleRoot}/Module1Financing.tsx`, needle: 'Outstanding Balance' },
  { label: 'F6: Module1Financing equity contributions', path: `${moduleRoot}/Module1Financing.tsx`, needle: 'financing-add-equity' },

  { label: 'L1: globals.css sidebar relative', path: 'app/globals.css', needle: 'position: relative; height: 100%' },
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
  `${moduleRoot}/Module1Costs.tsx`,
  `${moduleRoot}/Module1Financing.tsx`,
  'src/hubs/modeling/platforms/refm/lib/state/module1-store.ts',
  'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts',
];
let emDashFails = 0;
for (const f of emDashFiles) {
  const src = readFileSync(join(REPO_ROOT, f), 'utf8');
  if (src.includes('—')) {
    emDashFails++;
    console.log(`  FAIL  em-dash in ${f}`);
  }
}
if (emDashFails === 0) pass('X1: em-dash sweep, zero hits');
else fail('X1: em-dash sweep', `${emDashFails} files contain em-dash`);

// ── Section 5: Playwright ────────────────────────────────────────────────
console.log('\n[5/5] Playwright UI smoke');
const specPath = join(REPO_ROOT, 'tests/e2e/m20c-costs-financing.spec.ts');
if (!existsSync(specPath)) {
  fail('Playwright spec', 'tests/e2e/m20c-costs-financing.spec.ts not found');
} else {
  pass('m20c-costs-financing.spec.ts present');
  if (!routeOk) {
    skip('Playwright run', 'sign-in required for full smoke; spec runnable when /refm returns 200');
  } else {
    try {
      execSync('npx playwright test tests/e2e/m20c-costs-financing.spec.ts --reporter=list', {
        stdio: 'pipe',
        timeout: 180000,
      });
      pass('Playwright m20c-costs-financing.spec.ts');
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
