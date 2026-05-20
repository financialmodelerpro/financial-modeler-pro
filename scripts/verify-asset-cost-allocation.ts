/**
 * M4 Pass 2M-C3 (2026-05-20): computeAssetCost allocation verifier.
 *
 * Focused tests on the M1 cost engine's tax / soft-cost allocation
 * paths, which the M4 P&L and CF surfaces rely on through the
 * capex projection. Builds minimal Project / Phase / Asset / CostLine
 * fixtures and checks that:
 *
 *   A: Fixed lump 'fixed' line distributes by allocationBasis (BUA)
 *      across assets in the phase
 *   B: percent_of_construction soft line picks up its base correctly
 *      (cumulative direct construction cost in the phase)
 *   C: rate_per_bua direct line uses the per-asset BUA, not project total
 *   D: Multi-stage line totals roll into byStage buckets correctly
 *   E: perPeriod sums to byLineId total for an asset
 *   F: Disabled line zeroes out in totals but stays in resolved set
 */

import {
  type Asset,
  type CostLine,
  type Phase,
  type Parcel,
  type SubUnit,
  type Project,
  makeDefaultPhase,
  makeDefaultProject,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { computeAssetCost } from '../src/core/calculations';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function assertNear(name: string, actual: number, expected: number, tol = 1): void {
  const delta = actual - expected;
  if (Math.abs(delta) <= tol) {
    pass++;
    console.log(`  [PASS] ${name}: actual=${actual.toFixed(2)} vs expected=${expected.toFixed(2)} (delta=${delta.toFixed(2)})`);
  } else {
    fail++;
    failures.push(`${name}: actual=${actual.toFixed(2)} vs expected=${expected.toFixed(2)} (delta=${delta.toFixed(2)})`);
    console.log(`  [FAIL] ${name}: actual=${actual.toFixed(2)} vs expected=${expected.toFixed(2)} (delta=${delta.toFixed(2)})`);
  }
}

console.log('=== M4 Pass 2M-C3 computeAssetCost allocation verifier ===');

// ──────────────────────────────────────────────────────────────────
// Fixture builder: 2 assets in 1 phase, no parcels (no land math)
// ──────────────────────────────────────────────────────────────────
function buildFixture(): {
  project: Project; phase: Phase; assets: Asset[]; parcels: Parcel[]; subUnits: SubUnit[];
} {
  const project: Project = makeDefaultProject();
  const phase: Phase = { ...makeDefaultPhase(), id: 'p1', startDate: '2026-01-01', constructionPeriods: 4, operationsPeriods: 0, overlapPeriods: 0 };
  const assetA: Asset = {
    id: 'aA', phaseId: phase.id, name: 'Asset A', type: '',
    strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 60000, sellableBuaSqm: 60000, parkingBaysRequired: 0,
  };
  const assetB: Asset = {
    id: 'aB', phaseId: phase.id, name: 'Asset B', type: '',
    strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 40000, sellableBuaSqm: 40000, parkingBaysRequired: 0,
  };
  return { project, phase, assets: [assetA, assetB], parcels: [], subUnits: [] };
}

// ──────────────────────────────────────────────────────────────────
// A: Fixed lump distributes by BUA share
// ──────────────────────────────────────────────────────────────────
console.log('\n[A] Fixed lump distribution by BUA');
{
  const { project, phase, assets, parcels, subUnits } = buildFixture();
  const fixedLine: CostLine = {
    id: 'lp1', phaseId: phase.id, name: 'Master plan fee',
    method: 'fixed', value: 1_000_000,
    stage: 'soft', scope: 'direct', allocationBasis: 'bua_share',
    startPeriod: 0, endPeriod: 3, phasing: 'even',
  };
  const bA = computeAssetCost(assets[0], project, phase, parcels, assets, subUnits, [fixedLine], [], 'autoByBua');
  const bB = computeAssetCost(assets[1], project, phase, parcels, assets, subUnits, [fixedLine], [], 'autoByBua');
  // Asset A = 60% of 1M = 600,000; Asset B = 40%.
  assertNear('A1: A by BUA share = 600,000', bA.byLineId['lp1'] ?? 0, 600_000);
  assertNear('A2: B by BUA share = 400,000', bB.byLineId['lp1'] ?? 0, 400_000);
  assertNear('A3: A+B sum = 1,000,000', (bA.byLineId['lp1'] ?? 0) + (bB.byLineId['lp1'] ?? 0), 1_000_000);
}

// ──────────────────────────────────────────────────────────────────
// B: percent_of_construction picks up construction base
// ──────────────────────────────────────────────────────────────────
console.log('\n[B] percent_of_construction picks up construction base');
{
  const { project, phase, assets, parcels, subUnits } = buildFixture();
  // Hard line on A: 1000 SAR/sqm BUA × 60,000 = 60,000,000
  const hardLine: CostLine = {
    id: 'hl1', phaseId: phase.id, name: 'Construction',
    method: 'rate_per_bua', value: 1000,
    stage: 'hard', scope: 'direct', allocationBasis: 'bua_share',
    startPeriod: 0, endPeriod: 3, phasing: 'even',
  };
  // Soft line: 5% of construction
  const softLine: CostLine = {
    id: 'sl1', phaseId: phase.id, name: 'Soft cost',
    method: 'percent_of_construction', value: 5,
    stage: 'soft', scope: 'direct', allocationBasis: 'bua_share',
    startPeriod: 0, endPeriod: 3, phasing: 'even',
  };
  const bA = computeAssetCost(assets[0], project, phase, parcels, assets, subUnits, [hardLine, softLine], [], 'autoByBua');
  // Expected: hard = 60M, soft = 3M
  assertNear('B1: hard rate_per_bua = 60M for A', bA.byLineId['hl1'] ?? 0, 60_000_000);
  assertNear('B2: soft = 5% of 60M = 3M for A', bA.byLineId['sl1'] ?? 0, 3_000_000);
}

// ──────────────────────────────────────────────────────────────────
// C: rate_per_bua uses per-asset BUA, not project total
// ──────────────────────────────────────────────────────────────────
console.log('\n[C] rate_per_bua uses per-asset BUA');
{
  const { project, phase, assets, parcels, subUnits } = buildFixture();
  const rateLine: CostLine = {
    id: 'rate1', phaseId: phase.id, name: 'BUA fee',
    method: 'rate_per_bua', value: 100,
    stage: 'hard', scope: 'direct', allocationBasis: 'bua_share',
    startPeriod: 0, endPeriod: 3, phasing: 'even',
  };
  const bA = computeAssetCost(assets[0], project, phase, parcels, assets, subUnits, [rateLine], [], 'autoByBua');
  const bB = computeAssetCost(assets[1], project, phase, parcels, assets, subUnits, [rateLine], [], 'autoByBua');
  assertNear('C1: A = 60,000 × 100 = 6,000,000', bA.byLineId['rate1'] ?? 0, 6_000_000);
  assertNear('C2: B = 40,000 × 100 = 4,000,000', bB.byLineId['rate1'] ?? 0, 4_000_000);
}

// ──────────────────────────────────────────────────────────────────
// D: byStage rollup
// ──────────────────────────────────────────────────────────────────
console.log('\n[D] byStage bucket rollup');
{
  const { project, phase, assets, parcels, subUnits } = buildFixture();
  const lines: CostLine[] = [
    { id: 'h1', phaseId: phase.id, name: 'Hard', method: 'rate_per_bua', value: 1000,
      stage: 'hard', scope: 'direct', allocationBasis: 'bua_share', startPeriod: 0, endPeriod: 3, phasing: 'even' },
    { id: 's1', phaseId: phase.id, name: 'Soft', method: 'percent_of_construction', value: 10,
      stage: 'soft', scope: 'direct', allocationBasis: 'bua_share', startPeriod: 0, endPeriod: 3, phasing: 'even' },
  ];
  const b = computeAssetCost(assets[0], project, phase, parcels, assets, subUnits, lines, [], 'autoByBua');
  // hard = 60M; soft = 10% of 60M = 6M.
  assertNear('D1: byStage.hard = 60M', b.byStage.hard, 60_000_000);
  assertNear('D2: byStage.soft = 6M', b.byStage.soft, 6_000_000);
  assertNear('D3: total = 66M', b.total, 66_000_000);
}

// ──────────────────────────────────────────────────────────────────
// E: perPeriod sums match byLineId total
// ──────────────────────────────────────────────────────────────────
console.log('\n[E] perPeriod sum identity');
{
  const { project, phase, assets, parcels, subUnits } = buildFixture();
  const line: CostLine = {
    id: 'l1', phaseId: phase.id, name: 'Spread cost',
    method: 'rate_per_bua', value: 1000,
    stage: 'hard', scope: 'direct', allocationBasis: 'bua_share',
    startPeriod: 0, endPeriod: 3, phasing: 'even',
  };
  const b = computeAssetCost(assets[0], project, phase, parcels, assets, subUnits, [line], [], 'autoByBua');
  const perPeriodSum = b.perPeriod.reduce((s, v) => s + v, 0);
  assertNear('E1: sum(perPeriod) = byLineId[l1] (60M)', perPeriodSum, b.byLineId['l1'] ?? 0);
  // perLinePerPeriod should also match.
  const perLineSum = (b.perLinePerPeriod['l1'] ?? []).reduce((s, v) => s + v, 0);
  assertNear('E2: sum(perLinePerPeriod[l1]) = byLineId[l1]', perLineSum, b.byLineId['l1'] ?? 0);
}

// ──────────────────────────────────────────────────────────────────
// F: Disabled line zeroes out
// ──────────────────────────────────────────────────────────────────
console.log('\n[F] disabled cost line zeroes out');
{
  const { project, phase, assets, parcels, subUnits } = buildFixture();
  const line: CostLine = {
    id: 'lZ', phaseId: phase.id, name: 'Disabled',
    method: 'rate_per_bua', value: 1000, disabled: true,
    stage: 'hard', scope: 'direct', allocationBasis: 'bua_share',
    startPeriod: 0, endPeriod: 3, phasing: 'even',
  };
  const b = computeAssetCost(assets[0], project, phase, parcels, assets, subUnits, [line], [], 'autoByBua');
  assertNear('F1: disabled line total = 0', b.byLineId['lZ'] ?? 0, 0);
  assertNear('F2: disabled line perPeriod sum = 0', b.perPeriod.reduce((s, v) => s + v, 0), 0);
}

// ──────────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────────
console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
