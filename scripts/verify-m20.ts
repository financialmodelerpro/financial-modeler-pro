/* eslint-disable no-console */
/**
 * verify-m20.ts (M2.0 verifier)
 *
 * 5-section per-phase verifier following the M1.7+ template:
 *   1. Schema version + types presence
 *   2. Calc engine (computeAssetBua, computeAssetLandCost,
 *      computePhaseCost, computeFinancing) on a fixture snapshot
 *   3. State integrity (Zustand store hydrate + cascade-delete)
 *   4. v5 source-file markers (4 tabs / shell / wizard / em-dash sweep)
 *   5. Playwright UI smoke (skipped when dev server / playwright down)
 *
 * Usage: npx tsx --env-file=.env.local scripts/verify-m20.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

import {
  type WizardDraft,
  buildWizardSnapshot,
} from '../src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot';
import {
  computeAssetBua,
  computeAssetLandCost,
  computePhaseCost,
  computeFinancing,
  computeLandAggregate,
  distribute,
} from '../src/core/calculations';
import {
  createModule1Store,
  type HydrateSnapshot,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { isV5Snapshot, isPreV5Snapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { SCHEMA_VERSION } from '../src/hubs/modeling/platforms/refm/lib/persistence/types';
// COST_LINE_KEYS removed in M2.0c (open catalog); this script is left
// in place for the M2.0 series block, but its assertions are softened.
const COST_LINE_KEYS: readonly string[] = [];

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

// ── Section 1: schema + types ─────────────────────────────────────────────
console.log('\n[1/5] Schema + types');

// M2.0c bumped to v6, but this verifier is the M2.0 series check; it
// passes when SCHEMA_VERSION is at or above 5.
if ((SCHEMA_VERSION as number) >= 5) pass(`SCHEMA_VERSION >= 5 (current: ${SCHEMA_VERSION})`);
else fail('SCHEMA_VERSION', `expected >= 5, got ${SCHEMA_VERSION}`);

const typesSrc = readFileSync(
  join(REPO_ROOT, 'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts'),
  'utf8',
);
const typeMarkers: [string, string][] = [
  ['Project type', 'export interface Project'],
  ['Phase type', 'export interface Phase'],
  ['Parcel type', 'export interface Parcel'],
  ['Asset type', 'export interface Asset'],
  ['SubUnit type', 'export interface SubUnit'],
  ['CostLine type', 'export interface CostLine'],
  ['CostOverride type', 'export interface CostOverride'],
  ['FinancingTranche type', 'export interface FinancingTranche'],
  ['EquityContribution type', 'export interface EquityContribution'],
  ['LandAllocationMode', 'LAND_ALLOCATION_MODES'],
  ['9 cost line keys', 'commissionFee'],
  ['No MasterHolding', '!MasterHolding'],
  ['No SubProject', '!SubProject'],
  ['No Plot', '!export interface Plot'],
  ['No Zone', '!export interface Zone'],
];
for (const [label, marker] of typeMarkers) {
  const negate = marker.startsWith('!');
  const probe = negate ? marker.slice(1) : marker;
  const present = typesSrc.includes(probe);
  if (negate ? !present : present) pass(label);
  else fail(label, `marker ${negate ? 'still present' : 'missing'}: ${probe}`);
}

// ── Section 2: calc engine ────────────────────────────────────────────────
console.log('\n[2/5] Calc engine');

const fixtureDraft: WizardDraft = {
  projectName: 'Verify M2.0',
  currency: 'SAR',
  modelType: 'monthly',
  startDate: '2026-01-01',
  location: 'Riyadh',
  phases: [{ name: 'Phase 1', startDate: '2026-01-01', constructionPeriods: 24, operationsPeriods: 60, overlapPeriods: 0 }],
  parcels: [{ name: 'Parcel A', area: 100000, rate: 500, cashPct: 60, inKindPct: 40 }],
  landAllocationMode: 'autoByBua',
  projectType: 'Mixed-Use',
  displayScale: 'full',
};
// M2.0e: wizard now mints empty assets[]/subUnits[]; the verifier
// injects two assets post-build to keep the calc-engine assertions
// (computeAssetBua / computeAssetLandCost / computePhaseCost) intact.
const snapshot: HydrateSnapshot = buildWizardSnapshot(fixtureDraft);
const phaseId = snapshot.phases[0].id;
snapshot.assets = [
  {
    id: 'asset_1', phaseId, name: 'Apartments', type: 'High-end Apartments',
    strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 200,
    status: 'planned',
  },
  {
    id: 'asset_2', phaseId, name: 'Hotel', type: 'Hotel 5-star',
    strategy: 'Operate', visible: true,
    gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 80,
    status: 'planned',
  },
];
snapshot.subUnits = [
  { id: 'subunit_1', assetId: 'asset_1', name: '2BR', category: 'Sellable', metric: 'count', metricValue: 100, unitArea: 120, unitPrice: 1500000 },
  { id: 'subunit_2', assetId: 'asset_2', name: 'Hotel Key', category: 'Operable', metric: 'count', metricValue: 200, unitArea: 50, unitPrice: 800, occupancyPct: 65, operatingMargin: 35 },
];

const aBua = computeAssetBua(snapshot.assets[0], snapshot.subUnits);
if (Math.abs(aBua - 100 * 120) < 0.01) pass('computeAssetBua: 100 units * 120 sqm = 12,000 sqm');
else fail('computeAssetBua', `expected 12000, got ${aBua}`);

const hBua = computeAssetBua(snapshot.assets[1], snapshot.subUnits);
if (Math.abs(hBua - 200 * 50) < 0.01) pass('computeAssetBua hotel: 200 keys * 50 sqm = 10,000 sqm');
else fail('computeAssetBua hotel', `expected 10000, got ${hBua}`);

const aLand = computeAssetLandCost(
  snapshot.assets[0],
  snapshot.parcels,
  snapshot.assets,
  snapshot.subUnits,
  'autoByBua',
);
const totalLandValue = 100000 * 500;
const expectedALand = totalLandValue * (12000 / (12000 + 10000));
if (Math.abs(aLand - expectedALand) < 0.5) pass('computeAssetLandCost autoByBua share');
else fail('computeAssetLandCost autoByBua', `expected ${expectedALand}, got ${aLand}`);

const breakdown = computePhaseCost(
  snapshot.phases[0],
  snapshot.project,
  snapshot.costLines,
  snapshot.costOverrides,
  snapshot.parcels,
  snapshot.assets,
  snapshot.subUnits,
  snapshot.landAllocationMode,
);
if (breakdown.byStage.land >= 0) pass('Phase land stage total computed');
else fail('Phase land stage', `got ${breakdown.byStage.land}`);
if (breakdown.byStage.hard > 0) pass('Phase hard cost subtotal > 0');
else fail('Phase hard cost subtotal', `got 0`);

const land = computeLandAggregate(snapshot.parcels);
if (land.totalAreaSqm === 100000) pass('computeLandAggregate area');
else fail('computeLandAggregate area', `expected 100000, got ${land.totalAreaSqm}`);

const tranche = snapshot.financingTranches[0];
const totalSpan = snapshot.phases[0].constructionPeriods + snapshot.phases[0].operationsPeriods - snapshot.phases[0].overlapPeriods;
const capexCurve = new Array(totalSpan).fill(0);
for (let i = 0; i < snapshot.phases[0].constructionPeriods; i++) {
  capexCurve[i] = breakdown.total / snapshot.phases[0].constructionPeriods;
}
const presalesCurve = new Array(totalSpan).fill(0);
const fin = computeFinancing(tranche, snapshot.phases[0], capexCurve, presalesCurve, snapshot.project);
const expectedDebt = breakdown.total * (tranche.ltvPct / 100);
if (Math.abs(fin.totalDebt - expectedDebt) < 1) pass('computeFinancing totalDebt = LTV * capex');
else fail('computeFinancing totalDebt', `expected ${expectedDebt}, got ${fin.totalDebt}`);

const dist = distribute('frontloaded', 12);
const distSum = dist.reduce((s, v) => s + v, 0);
if (Math.abs(distSum - 1) < 1e-6) pass('distribute frontloaded sums to 1');
else fail('distribute frontloaded', `sum ${distSum}`);

// ── Section 3: state integrity ────────────────────────────────────────────
console.log('\n[3/5] State integrity');

const store = createModule1Store();
store.getState().hydrate(snapshot);
const after = store.getState();
if (after.assets.length === 2) pass('hydrate: 2 assets');
else fail('hydrate', `expected 2 assets, got ${after.assets.length}`);

if (after.financingTranches.length === 1) pass('hydrate: 1 tranche');
else fail('hydrate financing', `got ${after.financingTranches.length}`);

// removeAsset cascades sub-units
store.getState().removeAsset(snapshot.assets[0].id);
const afterRemove = store.getState();
if (afterRemove.assets.length === 1) pass('removeAsset: assets reduced');
else fail('removeAsset', `expected 1, got ${afterRemove.assets.length}`);
if (afterRemove.subUnits.every((u) => u.assetId !== snapshot.assets[0].id)) {
  pass('removeAsset: sub-units cascaded');
} else {
  fail('removeAsset cascade', 'orphan sub-unit detected');
}

// removePhase cascades everything
const phaseStore = createModule1Store();
phaseStore.getState().hydrate(snapshot);
phaseStore.getState().addPhase({
  id: 'phase_extra',
  name: 'Extra',
  constructionStart: 30,
  constructionPeriods: 12,
  operationsPeriods: 24,
  overlapPeriods: 0,
});
phaseStore.getState().removePhase(snapshot.phases[0].id);
const afterPhaseRemove = phaseStore.getState();
if (afterPhaseRemove.assets.length === 0) pass('removePhase cascades assets');
else fail('removePhase cascade', `expected 0 assets, got ${afterPhaseRemove.assets.length}`);

// Migrate guard: pre-v5 fails recognition
if (
  isV5Snapshot({
    project: { name: '', currency: '', modelType: 'annual', startDate: '', status: 'draft', location: '' },
    phases: [],
    parcels: [],
    landAllocationMode: 'autoByBua',
    assets: [],
    subUnits: [],
    costLines: [],
    costOverrides: [],
    financingTranches: [],
    equityContributions: [],
  })
) {
  pass('isV5Snapshot recognises v5 shape');
} else fail('isV5Snapshot', 'rejected canonical v5 shape');

if (isPreV5Snapshot({ version: 3, assets: [], phases: [], costs: [] })) {
  pass('isPreV5Snapshot detects v3 by version+arrays');
} else fail('isPreV5Snapshot', 'failed to flag v3');

if (!isV5Snapshot({ version: 4, masterHolding: {}, assets: [], phases: [] })) {
  pass('isV5Snapshot rejects v4');
} else fail('isV5Snapshot', 'accepted v4 shape');

// ── Section 4: source-file markers ────────────────────────────────────────
console.log('\n[4/5] Source-file markers');

interface Marker {
  label: string;
  path: string;
  needle: string;
  negate?: boolean;
}
const markers: Marker[] = [
  { label: 'Tab1 file', path: 'src/hubs/modeling/platforms/refm/components/modules/Module1ProjectPhases.tsx', needle: 'Module1ProjectPhases' },
  { label: 'Tab2 file', path: 'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx', needle: 'Module1Assets' },
  { label: 'Tab3 file', path: 'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx', needle: '3. Costs' },
  { label: 'Tab4 file', path: 'src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx', needle: '4. Financing' },
  { label: 'Shell tabs', path: 'src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx', needle: 'Slim 4-tab shell' },
  { label: 'Wizard 3-step', path: 'src/hubs/modeling/platforms/refm/components/modals/ProjectWizard.tsx', needle: '3-step modal walk' },
  { label: 'Hierarchy tab gone', path: 'src/hubs/modeling/platforms/refm/components/modules', needle: '!Module1Hierarchy.tsx' },
  { label: 'Build Program tab gone', path: 'src/hubs/modeling/platforms/refm/components/modules', needle: '!Module1AreaProgram.tsx' },
  { label: 'PlotSetupWizard gone', path: 'src/hubs/modeling/platforms/refm/components/modals', needle: '!PlotSetupWizard.tsx' },
];
for (const m of markers) {
  const fullPath = join(REPO_ROOT, m.path);
  if (m.needle.startsWith('!')) {
    // file-absence marker
    const file = m.needle.slice(1);
    const exists = existsSync(join(fullPath, file));
    if (!exists) pass(m.label);
    else fail(m.label, `${file} still present`);
  } else {
    if (!existsSync(fullPath)) {
      fail(m.label, `file missing: ${m.path}`);
      continue;
    }
    const src = readFileSync(fullPath, 'utf8');
    if (src.includes(m.needle)) pass(m.label);
    else fail(m.label, `marker missing: ${m.needle}`);
  }
}

// Em-dash sweep across the new code
const emDashFiles = [
  'src/hubs/modeling/platforms/refm/components/modules/Module1ProjectPhases.tsx',
  'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx',
  'src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx',
  'src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx',
  'src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx',
  'src/hubs/modeling/platforms/refm/components/modals/ProjectWizard.tsx',
  'src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot.ts',
  'src/hubs/modeling/platforms/refm/lib/state/module1-types.ts',
  'src/hubs/modeling/platforms/refm/lib/state/module1-store.ts',
  'src/core/calculations/index.ts',
];
let emDashFails = 0;
for (const f of emDashFiles) {
  const src = readFileSync(join(REPO_ROOT, f), 'utf8');
  if (src.includes('—')) {
    emDashFails++;
    console.log(`  FAIL  em-dash in ${f}`);
  }
}
if (emDashFails === 0) pass('em-dash sweep: zero hits across M2.0 files');
else fail('em-dash sweep', `${emDashFails} files contain em-dash (U+2014)`);

// ── Section 5: Playwright (skip when dev server down) ────────────────────
console.log('\n[5/5] Playwright UI smoke');
let serverUp = false;
try {
  execSync('curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/refm', { timeout: 2000 });
  serverUp = true;
} catch {
  // ignore
}
if (!serverUp) skip('Playwright', 'localhost:3000 not reachable');
else {
  try {
    execSync('npx playwright test tests/e2e/m20-full-flow.spec.ts --reporter=list', {
      stdio: 'pipe',
      timeout: 60000,
    });
    pass('Playwright m20-full-flow.spec.ts');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fail('Playwright', msg.slice(0, 200));
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\nResult: ${passed} pass / ${failed} fail / ${skipped} skip`);
if (failed > 0) process.exit(1);
process.exit(0);
