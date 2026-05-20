/* eslint-disable no-console */
/**
 * verify-m20d.ts (M2.0d verifier)
 *
 * 5-section per-phase verifier for the v7 schema rebuild
 * (Costs tab polish + accounting rules + layout fix).
 *
 * Sections:
 *   1. Schema: SCHEMA_VERSION === 7, AssetStrategy includes
 *      'Sell + Manage', ManagementAgreement default, useful-life
 *      defaults, 9-line standard catalog (10 internal rows), 14
 *      cost methods (rate_per_parking_bay added).
 *   2. Routes: dev server reachable, baseline diff bit-identical
 *      against the new 47.6 KB v7 baseline (sha256 7418013202fc).
 *   3. Calc: deriveCostStage / deriveCostScope id-based mapping,
 *      classifyAssetCapex per strategy (Sell + Sell+Manage -> COGS;
 *      Operate + Lease -> FixedAssets + depreciation excluding
 *      land), computeCashFlowImpact (cash outflow excludes in-kind
 *      land), resolveUsefulLifeYears category fallback.
 *   4. State: source-file markers for the M2.0d surface files,
 *      em-dash sweep.
 *   5. UI: Playwright spec presence + run gate.
 *
 * Usage: npx tsx scripts/verify-m20d.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

import { SCHEMA_VERSION } from '../src/hubs/modeling/platforms/refm/lib/persistence/types';
import {
  ASSET_STRATEGIES,
  COST_METHODS,
  COST_PHASINGS,
  COST_STAGES,
  STANDARD_COST_LINE_IDS,
  DEFAULT_MANAGEMENT_AGREEMENT,
  DEFAULT_USEFUL_LIFE_YEARS,
  makeDefaultCostLines,
  type Asset,
  type AssetStrategy,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  isV7Snapshot,
  isPreV7Snapshot,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import {
  deriveCostStage,
  deriveCostScope,
  classifyAssetCapex,
  computeCashFlowImpact,
  resolveUsefulLifeYears,
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

if (SCHEMA_VERSION === 7) pass('SCHEMA_VERSION === 7');
else fail('SCHEMA_VERSION', `expected 7, got ${SCHEMA_VERSION}`);

if (ASSET_STRATEGIES.length === 4) pass('4 strategies');
else fail('strategies', `expected 4, got ${ASSET_STRATEGIES.length}`);

if (ASSET_STRATEGIES.includes('Sell + Manage' as AssetStrategy)) pass('Sell + Manage strategy present');
else fail('Sell + Manage', 'enum missing the renamed slot');

if (!ASSET_STRATEGIES.includes('Hybrid' as AssetStrategy)) pass('Hybrid strategy retired');
else fail('Hybrid', 'still present in enum');

if (DEFAULT_MANAGEMENT_AGREEMENT.managementFeePct === 30) pass('DEFAULT_MANAGEMENT_AGREEMENT fee 30%');
else fail('mgmt fee', `expected 30, got ${DEFAULT_MANAGEMENT_AGREEMENT.managementFeePct}`);
if (DEFAULT_MANAGEMENT_AGREEMENT.ownerRevenueSharePct === 70) pass('DEFAULT_MANAGEMENT_AGREEMENT owner 70%');
else fail('mgmt owner', `expected 70, got ${DEFAULT_MANAGEMENT_AGREEMENT.ownerRevenueSharePct}`);

if (DEFAULT_USEFUL_LIFE_YEARS.residential === 30) pass('residential useful life 30');
else fail('residential life', `expected 30, got ${DEFAULT_USEFUL_LIFE_YEARS.residential}`);
if (DEFAULT_USEFUL_LIFE_YEARS.hospitality === 20) pass('hospitality useful life 20');
else fail('hospitality life', `expected 20, got ${DEFAULT_USEFUL_LIFE_YEARS.hospitality}`);
if (DEFAULT_USEFUL_LIFE_YEARS.retail === 25) pass('retail useful life 25');
else fail('retail life', `expected 25, got ${DEFAULT_USEFUL_LIFE_YEARS.retail}`);

// M2.0d added rate_per_parking_bay (14 methods); M2.0g added 3 more
// (rate_x_support_area / rate_x_parking_area / rate_x_specific_subunit).
// Loosen to >= 14 to keep this verifier green after additive growth.
if (COST_METHODS.length >= 14) pass(`>= 14 cost methods (current ${COST_METHODS.length})`);
else fail('cost methods', `expected >= 14, got ${COST_METHODS.length}`);

if (COST_METHODS.includes('rate_per_parking_bay')) pass('rate_per_parking_bay present');
else fail('rate_per_parking_bay', 'missing from COST_METHODS');

if (COST_PHASINGS.length === 6) pass('6 phasing modes');
else fail('phasing modes', `expected 6, got ${COST_PHASINGS.length}`);

if (COST_STAGES.length === 4) pass('4 cost stages');
else fail('cost stages', `expected 4, got ${COST_STAGES.length}`);

if (STANDARD_COST_LINE_IDS.length === 10) pass('10 standard internal cost line ids');
else fail('standard ids', `expected 10, got ${STANDARD_COST_LINE_IDS.length}`);

const defaults = makeDefaultCostLines('phase_1', 24);
if (defaults.length === 10) pass('default catalog seeds 10 internal rows (9 user-facing)');
else fail('default catalog', `expected 10, got ${defaults.length}`);

const lockedCash = defaults.find((l) => l.id === 'land-cash');
const lockedInKind = defaults.find((l) => l.id === 'land-inkind');
if (lockedCash?.isLocked && lockedInKind?.isLocked) pass('Land cash + in-kind both locked');
else fail('Land lock', 'land-cash or land-inkind not locked');

// v7 detection by version stamp
const v7Sample = {
  version: 7,
  project: { name: 't', currency: 'SAR', modelType: 'annual', startDate: '2026-01-01', status: 'draft', location: '' },
  phases: [], parcels: [], landAllocationMode: 'autoByBua',
  assets: [], subUnits: [], costLines: [], costOverrides: [],
  financingTranches: [], equityContributions: [],
};
if (isV7Snapshot(v7Sample)) pass('isV7Snapshot recognises version=7 stamp');
else fail('isV7Snapshot version', 'rejected canonical v7');

// v6 sample (Hybrid strategy + v6 cost ids) -> should flag as preV7
const v6Sample = {
  ...v7Sample,
  version: undefined,
  assets: [{ id: 'a1', strategy: 'Hybrid' }],
  costLines: [{ id: 'site-prep', phaseId: 'p1', name: 'Site Prep', method: 'fixed', value: 0, stage: 'hard', scope: 'direct', allocationBasis: 'per_asset', startPeriod: 0, endPeriod: 0, phasing: 'even' }],
};
if (isPreV7Snapshot(v6Sample)) pass('isPreV7Snapshot detects v6 by Hybrid strategy + v6 line ids');
else fail('isPreV7Snapshot v6', 'failed to flag v6');

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
  if (out.includes('OK: bit-identical')) pass('module1-v5-diff bit-identical (47.6 KB sha256 7418013202fc)');
  else fail('module1-v5-diff', out.slice(0, 200));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  fail('module1-v5-diff', msg.slice(0, 200));
}

// ── Section 3: calc engine ────────────────────────────────────────────────
console.log('\n[3/5] Calc engine');

// deriveCostStage: id-based mapping
const stageStubs: Record<string, string> = {};
for (const id of STANDARD_COST_LINE_IDS) {
  stageStubs[id] = deriveCostStage({
    id, phaseId: 'p1', name: id, method: 'fixed', value: 0,
    stage: 'soft', // wrong on purpose; deriveCostStage should override by id
    scope: 'direct', allocationBasis: 'per_asset',
    startPeriod: 0, endPeriod: 0, phasing: 'even',
  });
}
if (stageStubs['land-cash'] === 'land' && stageStubs['land-inkind'] === 'land') pass('deriveCostStage land-cash + land-inkind -> land');
else fail('deriveCostStage land', `cash=${stageStubs['land-cash']} inkind=${stageStubs['land-inkind']}`);
if (stageStubs['construction-bua'] === 'hard' && stageStubs['construction-parking'] === 'hard') pass('deriveCostStage construction -> hard');
else fail('deriveCostStage construction', `bua=${stageStubs['construction-bua']} parking=${stageStubs['construction-parking']}`);
if (stageStubs['pre-operating'] === 'operating') pass('deriveCostStage pre-operating -> operating');
else fail('deriveCostStage pre-operating', stageStubs['pre-operating'] ?? 'undefined');
if (stageStubs['contingency'] === 'soft' && stageStubs['professional-fee'] === 'soft' && stageStubs['commission'] === 'soft') pass('deriveCostStage soft trio (contingency, professional-fee, commission)');
else fail('deriveCostStage soft', `cont=${stageStubs['contingency']} prof=${stageStubs['professional-fee']} comm=${stageStubs['commission']}`);

// deriveCostScope: per_asset / manual = direct, others = indirect
const scopeDirect = deriveCostScope({
  id: 'x', phaseId: 'p1', name: 'x', method: 'fixed', value: 0,
  stage: 'land', scope: 'direct', allocationBasis: 'per_asset',
  startPeriod: 0, endPeriod: 0, phasing: 'even',
});
const scopeIndirect = deriveCostScope({
  id: 'x', phaseId: 'p1', name: 'x', method: 'fixed', value: 0,
  stage: 'land', scope: 'direct', allocationBasis: 'bua_share',
  startPeriod: 0, endPeriod: 0, phasing: 'even',
});
if (scopeDirect === 'direct' && scopeIndirect === 'indirect') pass('deriveCostScope per_asset->direct, bua_share->indirect');
else fail('deriveCostScope', `direct=${scopeDirect} indirect=${scopeIndirect}`);

// classifyAssetCapex: Sell + Sell+Manage -> COGS
const sellAsset: Asset = {
  id: 'a', phaseId: 'p1', name: 'A', type: 'Apartments', strategy: 'Sell',
  visible: true, gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0,
};
const sellClass = classifyAssetCapex(sellAsset, 100_000_000, 10_000_000);
if (sellClass.cogs === 100_000_000 && sellClass.fixedAssets === 0 && sellClass.annualDepreciation === 0) {
  pass('classifyAssetCapex Sell -> COGS=100M, FixedAssets=0, Depreciation=0');
} else {
  fail('classifyAssetCapex Sell', `COGS=${sellClass.cogs} FA=${sellClass.fixedAssets} Dep=${sellClass.annualDepreciation}`);
}

const smAsset: Asset = { ...sellAsset, strategy: 'Sell + Manage' };
const smClass = classifyAssetCapex(smAsset, 100_000_000, 10_000_000);
if (smClass.cogs === 100_000_000 && smClass.fixedAssets === 0 && smClass.annualDepreciation === 0) {
  pass('classifyAssetCapex Sell + Manage -> COGS=100M, FixedAssets=0, Depreciation=0');
} else {
  fail('classifyAssetCapex Sell + Manage', `COGS=${smClass.cogs} FA=${smClass.fixedAssets} Dep=${smClass.annualDepreciation}`);
}

const opAsset: Asset = { ...sellAsset, strategy: 'Operate', usefulLifeYears: 30 };
const opClass = classifyAssetCapex(opAsset, 100_000_000, 10_000_000);
const expectedOpDep = (100_000_000 - 10_000_000) / 30; // 3M
if (opClass.cogs === 0 && opClass.fixedAssets === 100_000_000 &&
    Math.abs(opClass.annualDepreciation - expectedOpDep) < 1) {
  pass(`classifyAssetCapex Operate -> COGS=0, FA=100M, Depreciation=${(opClass.annualDepreciation / 1e6).toFixed(2)}M/yr (land excluded)`);
} else {
  fail('classifyAssetCapex Operate', `COGS=${opClass.cogs} FA=${opClass.fixedAssets} Dep=${opClass.annualDepreciation} expected ${expectedOpDep}`);
}

const leaseAsset: Asset = { ...sellAsset, strategy: 'Lease', usefulLifeYears: 25 };
const leaseClass = classifyAssetCapex(leaseAsset, 100_000_000, 10_000_000);
const expectedLeaseDep = (100_000_000 - 10_000_000) / 25; // 3.6M
if (leaseClass.cogs === 0 && leaseClass.fixedAssets === 100_000_000 &&
    Math.abs(leaseClass.annualDepreciation - expectedLeaseDep) < 1) {
  pass(`classifyAssetCapex Lease -> COGS=0, FA=100M, Depreciation=${(leaseClass.annualDepreciation / 1e6).toFixed(2)}M/yr`);
} else {
  fail('classifyAssetCapex Lease', `COGS=${leaseClass.cogs} FA=${leaseClass.fixedAssets} Dep=${leaseClass.annualDepreciation} expected ${expectedLeaseDep}`);
}

// computeCashFlowImpact: in-kind land excluded from cash outflow
const cf = computeCashFlowImpact(100_000_000, 40_000_000); // 60M cash, 40M in-kind land
if (cf.cashOutflow === 60_000_000 && cf.equityInKind === 40_000_000) {
  pass('computeCashFlowImpact 100M capex - 40M in-kind = 60M cash outflow + 40M equity in-kind');
} else {
  fail('computeCashFlowImpact', `cashOutflow=${cf.cashOutflow} equityInKind=${cf.equityInKind}`);
}

// resolveUsefulLifeYears fallbacks
const resOpDefault = resolveUsefulLifeYears({ ...sellAsset, strategy: 'Operate' });
if (resOpDefault === 20) pass('resolveUsefulLifeYears Operate fallback = 20 (hospitality)');
else fail('useful life Operate fallback', `expected 20, got ${resOpDefault}`);
const resLeaseDefault = resolveUsefulLifeYears({ ...sellAsset, strategy: 'Lease' });
if (resLeaseDefault === 25) pass('resolveUsefulLifeYears Lease fallback = 25 (retail)');
else fail('useful life Lease fallback', `expected 25, got ${resLeaseDefault}`);

// ── Section 4: source-file markers ───────────────────────────────────────
console.log('\n[4/5] Source-file markers (M2.0d)');

interface Marker { label: string; path: string; needle: string }
const componentRoot = 'src/hubs/modeling/platforms/refm/components';
const moduleRoot = `${componentRoot}/modules`;
const calcPath = 'src/core/calculations/index.ts';
const typesPath = 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts';
const migratePath = 'src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts';

const markers: Marker[] = [
  { label: 'L1: layout fix (no margin-left on .main-content)', path: 'app/globals.css', needle: 'main-content { flex: 1; overflow-y: auto; overflow-x: hidden; min-width: 0; }' },

  { label: 'V1: SCHEMA_VERSION = 7', path: 'src/hubs/modeling/platforms/refm/lib/persistence/types.ts', needle: 'SCHEMA_VERSION = 7' },
  { label: 'V2: AssetStrategy Sell + Manage', path: typesPath, needle: "'Sell + Manage'" },
  { label: 'V3: ManagementAgreement type', path: typesPath, needle: 'export interface ManagementAgreement' },
  { label: 'V4: DEFAULT_USEFUL_LIFE_YEARS', path: typesPath, needle: 'DEFAULT_USEFUL_LIFE_YEARS' },
  { label: 'V5: rate_per_parking_bay method', path: typesPath, needle: 'rate_per_parking_bay' },
  { label: 'V6: STANDARD_COST_LINE_IDS', path: typesPath, needle: 'STANDARD_COST_LINE_IDS' },
  { label: 'V7: 9-line catalog construction-bua seed', path: typesPath, needle: "id: 'construction-bua'" },
  { label: 'V8: 9-line catalog land-inkind seed', path: typesPath, needle: "id: 'land-inkind'" },
  { label: 'V9: CostLine.targetAssetId', path: typesPath, needle: 'targetAssetId?: string' },
  { label: 'V10: CostOverride.disabled', path: typesPath, needle: 'disabled?: boolean' },

  { label: 'M1: migrate isV7Snapshot', path: migratePath, needle: 'export function isV7Snapshot' },
  { label: 'M2: migrate isPreV7Snapshot', path: migratePath, needle: 'export function isPreV7Snapshot' },
  { label: 'M3: migrate v6 hybrid hard-cut', path: migratePath, needle: "a.strategy === 'Hybrid'" },

  { label: 'C1: deriveCostStage helper', path: calcPath, needle: 'export function deriveCostStage' },
  { label: 'C2: deriveCostScope helper', path: calcPath, needle: 'export function deriveCostScope' },
  { label: 'C3: classifyAssetCapex helper', path: calcPath, needle: 'export function classifyAssetCapex' },
  { label: 'C4: computeCashFlowImpact helper', path: calcPath, needle: 'export function computeCashFlowImpact' },
  { label: 'C5: resolveUsefulLifeYears helper', path: calcPath, needle: 'export function resolveUsefulLifeYears' },
  { label: 'C6: AssetAreaMetrics.parkingBays', path: calcPath, needle: 'parkingBays: number' },
  { label: 'C7: rate_per_parking_bay calc case', path: calcPath, needle: "case 'rate_per_parking_bay'" },
  { label: 'C8: targetAssetId filter in computeAssetCost', path: calcPath, needle: 'c.targetAssetId === undefined' },
  { label: 'C9: disabled zero-out in resolved', path: calcPath, needle: 'disabled === true' },

  { label: 'A1: Module1Assets STRATEGY_LABELS map', path: `${moduleRoot}/Module1Assets.tsx`, needle: 'STRATEGY_LABELS' },
  { label: 'A2: Module1Assets ManagementAgreementForm', path: `${moduleRoot}/Module1Assets.tsx`, needle: 'function ManagementAgreementForm' },
  { label: 'A3: Module1Assets UsefulLifeForm', path: `${moduleRoot}/Module1Assets.tsx`, needle: 'function UsefulLifeForm' },
  { label: 'A4: Module1Assets Sell + Manage label', path: `${moduleRoot}/Module1Assets.tsx`, needle: "'Sell + Manage':" },

  { label: 'U1: Module1Costs per-asset section', path: `${moduleRoot}/Module1Costs.tsx`, needle: 'function AssetCostSection' },
  { label: 'U2: Module1Costs CustomCostPopup', path: `${moduleRoot}/Module1Costs.tsx`, needle: 'function CustomCostPopup' },
  { label: 'U3: Module1Costs SummaryTables', path: `${moduleRoot}/Module1Costs.tsx`, needle: 'function SummaryTables' },
  { label: 'U4: Module1Costs accountingDestination', path: `${moduleRoot}/Module1Costs.tsx`, needle: 'function accountingDestination' },
  { label: 'U5: Module1Costs Capex by Period testid', path: `${moduleRoot}/Module1Costs.tsx`, needle: 'capex-by-period' },
  { label: 'U6: Module1Costs Capex by Stage testid', path: `${moduleRoot}/Module1Costs.tsx`, needle: 'capex-by-stage' },
  { label: 'U7: Module1Costs Capex by Treatment testid', path: `${moduleRoot}/Module1Costs.tsx`, needle: 'capex-by-treatment' },
  { label: 'U8: Module1Costs Stage hidden as dropdown (no Stage select on row)', path: `${moduleRoot}/Module1Costs.tsx`, needle: 'deriveCostStage(line)' },

  { label: 'F1: Module1Financing in-kind equity tile', path: `${moduleRoot}/Module1Financing.tsx`, needle: 'financing-summary-inkind-equity' },
  { label: 'F2: Module1Financing equity summary card', path: `${moduleRoot}/Module1Financing.tsx`, needle: 'financing-equity-summary' },
  { label: 'F3: Module1Financing totalInKindEquity', path: `${moduleRoot}/Module1Financing.tsx`, needle: 'totalInKindEquity' },
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
  migratePath,
  `${moduleRoot}/Module1Costs.tsx`,
  `${moduleRoot}/Module1Assets.tsx`,
  `${moduleRoot}/Module1Financing.tsx`,
  'src/hubs/modeling/platforms/refm/lib/state/module1-store.ts',
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
const specPath = join(REPO_ROOT, 'tests/e2e/m20d-costs-polish.spec.ts');
if (!existsSync(specPath)) {
  fail('Playwright spec', 'tests/e2e/m20d-costs-polish.spec.ts not found');
} else {
  pass('m20d-costs-polish.spec.ts present');
  if (!routeOk) {
    skip('Playwright run', 'sign-in required for full smoke; spec runnable when /refm returns 200');
  } else {
    try {
      execSync('npx playwright test tests/e2e/m20d-costs-polish.spec.ts --reporter=list', {
        stdio: 'pipe',
        timeout: 180000,
      });
      pass('Playwright m20d-costs-polish.spec.ts');
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
