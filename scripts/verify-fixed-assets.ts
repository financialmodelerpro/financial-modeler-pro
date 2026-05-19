/**
 * Module 4 Pass 1b — Fixed Assets + Depreciation verifier (refactor).
 *
 * Engine now handles ONLY depreciable additions / NBV. Land roll-
 * forward is composed in the resolver, so the engine tests dropped
 * the Land sub-stream and added a dedicated H-series for resolver-
 * level Land separation.
 *
 * Sections:
 *   A — pure SL allocator unit tests
 *   B — single-asset fresh capex (depreciable only)
 *   C — life=0 (caller passes Land in usefulLifeYears=0 wouldn't make
 *       sense; this case is now resolver responsibility) — kept as a
 *       defensive engine test for usefulLifeYears = 0 → no dep
 *   D — Existing operations opening NBV roll-forward
 *   E — Vintage handling: additions after handover depreciate from
 *       their own spend year
 *   F — Identity: closing[t] = max(0, opening[t] + additions[t] − dep[t])
 *   G — Sell-only project produces empty snapshot
 *   H — Resolver: per-asset Land roll-forward separate from Depreciable
 *   I — Resolver: project totals (Land + depreciable) = sum across assets
 */

import {
  buildStraightLine,
  buildReducingBalance,
  computeAssetFixedAssets,
} from '@/src/core/calculations/depreciation';
import { computeAllFixedAssetResults } from '@/src/hubs/modeling/platforms/refm/lib/fixed-assets-resolvers';
import type { Module1Store } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-store';
import type { Asset, Phase, Project } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function assertNear(name: string, actual: number, expected: number, tol = 0.01): void {
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

function assertEqInt(name: string, actual: number, expected: number): void {
  if (actual === expected) {
    pass++;
    console.log(`  [PASS] ${name}: ${actual}`);
  } else {
    fail++;
    failures.push(`${name}: actual=${actual} vs expected=${expected}`);
    console.log(`  [FAIL] ${name}: actual=${actual} vs expected=${expected}`);
  }
}

function zeros(n: number): number[] { return new Array<number>(n).fill(0); }

console.log('=== Module 4 Pass 1b Fixed Assets + Depreciation verifier ===');

// ─────────────────────────────────────────────────────────────────────
// A — Pure SL allocator
// ─────────────────────────────────────────────────────────────────────
console.log('\n[A] Straight-line allocator');
{
  const sl = buildStraightLine(1000, 10, 0, 15);
  assertNear('A1: SL year 0 = base/life', sl[0], 100);
  assertNear('A1: SL year 9 = base/life', sl[9], 100);
  assertNear('A1: SL year 10 = 0 (life exhausted)', sl[10], 0);
  assertNear('A1: SL sum = base', sl.reduce((s, v) => s + v, 0), 1000);
}
{
  const sl = buildStraightLine(1000, 10, 5, 10);
  assertNear('A2: SL year 4 = 0 (pre-start)', sl[4], 0);
  assertNear('A2: SL year 5 = 100', sl[5], 100);
  assertNear('A2: SL year 9 = 100', sl[9], 100);
  assertNear('A2: SL sum = 500 (5 of 10 years on axis)', sl.reduce((s, v) => s + v, 0), 500);
}
{
  const sl = buildStraightLine(1000, 0, 0, 5);
  assertNear('A3: life=0 returns all zeros', sl.reduce((s, v) => s + v, 0), 0);
}
{
  const sl = buildStraightLine(0, 10, 0, 5);
  assertNear('A4: base=0 returns all zeros', sl.reduce((s, v) => s + v, 0), 0);
}

// ─────────────────────────────────────────────────────────────────────
// B — Fresh single-asset depreciable capex (250M over 5 years, 25 yrs SL)
// ─────────────────────────────────────────────────────────────────────
console.log('\n[B] Single-asset fresh depreciable capex (25-yr SL)');
{
  const N = 30;
  const handover = 4;
  const additions = zeros(N);
  for (let t = 0; t <= handover; t++) additions[t] = 50_000_000;
  const r = computeAssetFixedAssets({
    assetId: 'h1',
    axisLength: N,
    startIdx: handover,
    additionsPerPeriod: additions,
    usefulLifeYears: 25,
  });
  assertNear('B1: dep at handover = 250M / 25 = 10M', r.depreciationPerPeriod[handover], 10_000_000);
  assertNear('B2: dep at t=20 (still in life) = 10M', r.depreciationPerPeriod[20], 10_000_000);
  assertNear('B3: dep at t=29 (after life) = 0', r.depreciationPerPeriod[29], 0);
  assertNear('B4: total dep across axis = 250M', r.totalDepreciation, 250_000_000);
  assertNear('B5: closing NBV at handover = opening + add − dep', r.closingNBVPerPeriod[handover], 240_000_000);
  assertNear('B6: closing NBV at end of axis = 0', r.closingNBVPerPeriod[N - 1], 0);
}

// ─────────────────────────────────────────────────────────────────────
// C — usefulLifeYears = 0 → no depreciation (defensive)
// ─────────────────────────────────────────────────────────────────────
console.log('\n[C] usefulLifeYears = 0 → no depreciation');
{
  const N = 10;
  const additions = zeros(N);
  additions[0] = 100_000_000;
  const r = computeAssetFixedAssets({
    assetId: 'land-only',
    axisLength: N,
    startIdx: 0,
    additionsPerPeriod: additions,
    usefulLifeYears: 0,
  });
  assertNear('C1: total dep = 0 when life=0', r.totalDepreciation, 0);
  assertNear('C2: closing NBV = opening NBV + additions',
    r.closingNBVPerPeriod[N - 1], 100_000_000);
}

// ─────────────────────────────────────────────────────────────────────
// D — Existing operations opening NBV
// ─────────────────────────────────────────────────────────────────────
console.log('\n[D] Existing operations opening NBV');
{
  const N = 25;
  const r = computeAssetFixedAssets({
    assetId: 'eo1',
    axisLength: N,
    startIdx: 0,
    additionsPerPeriod: zeros(N),
    usefulLifeYears: 20,
    openingNBV: 100_000_000,
  });
  assertNear('D1: opening NBV at idx 0 = 100M', r.openingNBVPerPeriod[0], 100_000_000);
  assertNear('D2: dep year 0 = 100M / 20 = 5M', r.depreciationPerPeriod[0], 5_000_000);
  assertNear('D3: dep year 19 = 5M', r.depreciationPerPeriod[19], 5_000_000);
  assertNear('D4: dep year 20 = 0 (life exhausted)', r.depreciationPerPeriod[20], 0);
  assertNear('D5: closing year 19 = 0', r.closingNBVPerPeriod[19], 0);
  assertNear('D6: total dep = 100M', r.totalDepreciation, 100_000_000);
}

// ─────────────────────────────────────────────────────────────────────
// E — Vintage handling: base + refurb after handover
// ─────────────────────────────────────────────────────────────────────
console.log('\n[E] Vintage handling: refurb addition after handover');
{
  const N = 35;
  const additions = zeros(N);
  additions[0] = 100_000_000;
  additions[10] = 50_000_000;
  const r = computeAssetFixedAssets({
    assetId: 'h3',
    axisLength: N,
    startIdx: 4,
    additionsPerPeriod: additions,
    usefulLifeYears: 25,
  });
  assertNear('E1: dep year 4 = base vintage only (4M)', r.depreciationPerPeriod[4], 4_000_000);
  assertNear('E2: dep year 9 = base only (4M)', r.depreciationPerPeriod[9], 4_000_000);
  assertNear('E3: dep year 10 = base + refurb = 6M', r.depreciationPerPeriod[10], 6_000_000);
  assertNear('E4: dep year 29 = refurb only (2M)', r.depreciationPerPeriod[29], 2_000_000);
  assertNear('E5: dep year 34 = refurb final year (2M)', r.depreciationPerPeriod[34], 2_000_000);
  assertNear('E6: total dep = 100M + 50M', r.totalDepreciation, 150_000_000);
}

// ─────────────────────────────────────────────────────────────────────
// F — Roll-forward identity per period
// ─────────────────────────────────────────────────────────────────────
console.log('\n[F] Roll-forward identity per period');
{
  const N = 20;
  const additions = zeros(N);
  additions[0] = 60_000_000; additions[1] = 60_000_000; additions[2] = 60_000_000;
  const r = computeAssetFixedAssets({
    assetId: 'h4',
    axisLength: N,
    startIdx: 2,
    additionsPerPeriod: additions,
    usefulLifeYears: 15,
  });
  for (let t = 0; t < N; t++) {
    const expected = (r.openingNBVPerPeriod[t] ?? 0)
      + (r.additionsPerPeriod[t] ?? 0)
      - (r.depreciationPerPeriod[t] ?? 0);
    assertNear(`F${t + 1}: closing[${t}] = max(0, opening + add − dep)`,
      r.closingNBVPerPeriod[t], Math.max(0, expected));
  }
}

// ─────────────────────────────────────────────────────────────────────
// G — Resolver: Sell-only project → empty snapshot
// ─────────────────────────────────────────────────────────────────────
console.log('\n[G] Sell-only project produces empty fixed-asset snapshot');
{
  const state = buildSellOnlyState();
  const snap = computeAllFixedAssetResults(state);
  assertEqInt('G1: byAsset is empty', snap.byAsset.size, 0);
  const totalDep = snap.projectTotals.depreciable.depreciationPerPeriod.reduce((s, v) => s + v, 0);
  assertNear('G2: project totals depreciation = 0', totalDep, 0);
  const totalLand = snap.projectTotals.land.totalAdditions;
  assertNear('G3: project Land additions = 0', totalLand, 0);
}

// ─────────────────────────────────────────────────────────────────────
// H — Resolver: per-asset Land roll-forward separate from Depreciable
// ─────────────────────────────────────────────────────────────────────
console.log('\n[H] Resolver: Land separation per asset');
{
  // Existing operations Hotel with Land 80M + Building 50M opening
  // historical basis. Useful life 20 yrs. No new additions. Land sits
  // forever; Building drains to 0 over 20 yrs.
  const state = buildExistingHotelState({
    historicalLand: 80_000_000,
    historicalBuilding: 50_000_000,
    usefulLifeYears: 20,
  });
  const snap = computeAllFixedAssetResults(state);
  const row = snap.byAsset.get('h1');
  if (!row) { fail++; failures.push('H1: row missing'); console.log('  [FAIL] H1: row missing'); }
  else {
    assertNear('H1: Land opening[0] = 80M (historicalPreCapexLand)', row.land.openingPerPeriod[0], 80_000_000);
    assertNear('H2: Land closing[0] = 80M (no additions)', row.land.closingPerPeriod[0], 80_000_000);
    // No additions → Land closing stays 80M forever
    assertNear('H3: Land closing at end of axis = 80M', row.land.closingPerPeriod[row.land.closingPerPeriod.length - 1], 80_000_000);
    // Depreciable opening = 50M Building
    assertNear('H4: Depreciable opening[0] = 50M (historicalPreCapexBuilding)', row.depreciable.openingNBVPerPeriod[0], 50_000_000);
    // 50M / 20 = 2.5M / yr for 20 years; closing at year 19 = 0
    assertNear('H5: depreciable closing year 19 = 0', row.depreciable.closingNBVPerPeriod[19], 0);
    assertNear('H6: total depreciable dep = 50M', row.depreciable.totalDepreciation, 50_000_000);
    // Combined = Land + Depreciable
    const combinedFirst = row.combinedClosingPerPeriod[0];
    const expected = (row.land.closingPerPeriod[0] ?? 0) + (row.depreciable.closingNBVPerPeriod[0] ?? 0);
    assertNear('H7: combined closing[0] = land + depreciable closing', combinedFirst, expected);
    // At end of axis: Land 80M + Depreciable 0 = 80M
    const N = row.combinedClosingPerPeriod.length;
    assertNear('H8: combined closing at end of axis = 80M (Land only)', row.combinedClosingPerPeriod[N - 1], 80_000_000);
  }
}

// ─────────────────────────────────────────────────────────────────────
// I — Resolver: project totals = sum across per-asset rows
// ─────────────────────────────────────────────────────────────────────
console.log('\n[I] Project totals = sum across per-asset arrays');
{
  const state = buildTwoHospitalityAssetsState();
  const snap = computeAllFixedAssetResults(state);
  assertEqInt('I1: byAsset has 2 entries', snap.byAsset.size, 2);
  // Sum per-asset dep across both, compare to project totals.
  const summedDep = new Array<number>(snap.axisLength).fill(0);
  const summedLandClose = new Array<number>(snap.axisLength).fill(0);
  for (const r of snap.byAsset.values()) {
    for (let t = 0; t < snap.axisLength; t++) {
      summedDep[t] += r.depreciable.depreciationPerPeriod[t] ?? 0;
      summedLandClose[t] += r.land.closingPerPeriod[t] ?? 0;
    }
  }
  let maxDepDelta = 0;
  let maxLandDelta = 0;
  for (let t = 0; t < snap.axisLength; t++) {
    const dDep = Math.abs(summedDep[t] - (snap.projectTotals.depreciable.depreciationPerPeriod[t] ?? 0));
    const dLand = Math.abs(summedLandClose[t] - (snap.projectTotals.land.closingPerPeriod[t] ?? 0));
    if (dDep > maxDepDelta) maxDepDelta = dDep;
    if (dLand > maxLandDelta) maxLandDelta = dLand;
  }
  assertNear('I2: max |perAssetSum − projectTotal| depreciation', maxDepDelta, 0);
  assertNear('I3: max |perAssetSum − projectTotal| land closing', maxLandDelta, 0);
}

// ─── Fixtures ────────────────────────────────────────────────────────

function makeBaseProject(): Project {
  return {
    name: 'verifier project',
    startDate: '2026-01-01',
    currency: 'SAR',
    displayScale: 'thousands',
    displayDecimals: 0,
    landAllocationMode: 'auto',
    financing: undefined as never,
  } as unknown as Project;
}

function makePhase(id: string, name: string, startYear: number, cp: number, op: number): Phase {
  return {
    id,
    name,
    constructionStart: 1,
    constructionPeriods: cp,
    operationsPeriods: op,
    overlapPeriods: 0,
    startDate: `${startYear}-01-01`,
    status: 'planning',
  } as unknown as Phase;
}

function makeAsset(overrides: Partial<Asset> & Pick<Asset, 'id' | 'name' | 'phaseId' | 'strategy'>): Asset {
  return {
    visible: true,
    isCompanion: false,
    type: 'Hotel',
    bua: 0,
    nsa: 0,
    gfa: 0,
    parkingArea: 0,
    parkingBaysRequired: 0,
    ...overrides,
  } as unknown as Asset;
}

function buildSellOnlyState(): Module1Store {
  const project = makeBaseProject();
  const phase = makePhase('p1', 'Phase 1', 2026, 4, 20);
  const asset = makeAsset({ id: 'a1', name: 'Tower 1', phaseId: 'p1', strategy: 'Sell', type: 'Residential' });
  return {
    project,
    phases: [phase],
    assets: [asset],
    subUnits: [],
    parcels: [],
    costLines: [],
    costOverrides: [],
    landAllocationMode: 'auto',
  } as unknown as Module1Store;
}

function buildExistingHotelState(opts: {
  historicalLand: number;
  historicalBuilding: number;
  usefulLifeYears: number;
}): Module1Store {
  const project = makeBaseProject();
  const phase = makePhase('p1', 'Phase 1', 2026, 0, 25);
  (phase as unknown as { status: string }).status = 'operational';
  const asset = makeAsset({
    id: 'h1', name: 'Existing Hotel', phaseId: 'p1', strategy: 'Operate',
    historicalPreCapexLand: opts.historicalLand,
    historicalPreCapexBuilding: opts.historicalBuilding,
    usefulLifeYears: opts.usefulLifeYears,
  } as Partial<Asset> & Pick<Asset, 'id' | 'name' | 'phaseId' | 'strategy'>);
  return {
    project,
    phases: [phase],
    assets: [asset],
    subUnits: [],
    parcels: [],
    costLines: [],
    costOverrides: [],
    landAllocationMode: 'auto',
  } as unknown as Module1Store;
}

function buildTwoHospitalityAssetsState(): Module1Store {
  const project = makeBaseProject();
  const phase = makePhase('p1', 'Phase 1', 2026, 4, 25);
  const a1 = makeAsset({
    id: 'h1', name: 'Hotel A', phaseId: 'p1', strategy: 'Operate',
    historicalPreCapexBuilding: 50_000_000,
    usefulLifeYears: 20,
  } as Partial<Asset> & Pick<Asset, 'id' | 'name' | 'phaseId' | 'strategy'>);
  const a2 = makeAsset({
    id: 'h2', name: 'Hotel B', phaseId: 'p1', strategy: 'Operate',
    historicalPreCapexBuilding: 30_000_000,
    usefulLifeYears: 20,
  } as Partial<Asset> & Pick<Asset, 'id' | 'name' | 'phaseId' | 'strategy'>);
  return {
    project,
    phases: [phase],
    assets: [a1, a2],
    subUnits: [],
    parcels: [],
    costLines: [],
    costOverrides: [],
    landAllocationMode: 'auto',
  } as unknown as Module1Store;
}

// ─────────────────────────────────────────────────────────────────────
// J — Reducing balance allocator unit tests
// ─────────────────────────────────────────────────────────────────────
console.log('\n[J] Reducing-balance allocator');
{
  // base 1000, rate 10%, start 0, N=5 -> 100, 90, 81, 72.9, 65.61
  const rb = buildReducingBalance(1000, 0.10, 0, 5);
  assertNear('J1: RB year 0 = 100 (10% of 1000)', rb[0], 100);
  assertNear('J2: RB year 1 = 90 (10% of 900)', rb[1], 90);
  assertNear('J3: RB year 2 = 81', rb[2], 81);
  assertNear('J4: RB year 3 = 72.9', rb[3], 72.9);
  assertNear('J5: RB year 4 = 65.61', rb[4], 65.61);
}
{
  // Bounded by life: stop after `life` periods
  const rb = buildReducingBalance(1000, 0.10, 0, 10, 3);  // life=3
  assertNear('J6: RB year 0 = 100', rb[0], 100);
  assertNear('J7: RB year 2 = 81 (last year of capped life)', rb[2], 81);
  assertNear('J8: RB year 3 = 0 (life exhausted)', rb[3], 0);
}
{
  // Asymptote: never reaches zero
  const rb = buildReducingBalance(1000, 0.50, 0, 20);
  let remaining = 1000;
  for (let t = 0; t < 20; t++) {
    remaining -= rb[t];
  }
  // After 20 periods at 50% RB: NBV remaining = 1000 * 0.5^20 ~ 0.00095
  assertNear('J9: RB never fully writes off (residual NBV > 0)',
    remaining > 0 ? 1 : 0, 1);  // assert truthy
}

// ─────────────────────────────────────────────────────────────────────
// K — Engine: reducing-balance method
// 100M base addition at year 0, handoverIdx=0, life=10, rate=2/10=20% default
// ─────────────────────────────────────────────────────────────────────
console.log('\n[K] Engine reducing-balance with default rate (2/life)');
{
  const N = 15;
  const additions = zeros(N);
  additions[0] = 100_000_000;
  const r = computeAssetFixedAssets({
    assetId: 'rb1',
    axisLength: N,
    startIdx: 0,
    additionsPerPeriod: additions,
    usefulLifeYears: 10,
    method: 'reducing_balance',
    // rate undefined -> defaults to 2/10 = 0.20
  });
  // dep[0] = 100M * 0.20 = 20M
  assertNear('K1: dep year 0 = 20M (default rate 2/10)', r.depreciationPerPeriod[0], 20_000_000);
  // dep[1] = 80M * 0.20 = 16M
  assertNear('K2: dep year 1 = 16M', r.depreciationPerPeriod[1], 16_000_000);
  // dep[2] = 64M * 0.20 = 12.8M
  assertNear('K3: dep year 2 = 12.8M', r.depreciationPerPeriod[2], 12_800_000);
  // Closing NBV after life=10: 100M * 0.8^10 ~ 10.74M; engine caps dep window at life
  // closing[9] = 100M * (0.8^10) ~ 10,737,418
  assertNear('K4: closing NBV after life=10 ~ base × 0.8^10',
    r.closingNBVPerPeriod[9], 100_000_000 * Math.pow(0.8, 10), 1);
  // Year 10 should have 0 dep (life exhausted)
  assertNear('K5: dep year 10 = 0 (life exhausted)', r.depreciationPerPeriod[10], 0);
  // Method echoed
  assertEqInt('K6: result.method = reducing_balance',
    r.method === 'reducing_balance' ? 1 : 0, 1);
}

// ─────────────────────────────────────────────────────────────────────
// L — Engine: reducing-balance with custom rate
// ─────────────────────────────────────────────────────────────────────
console.log('\n[L] Engine reducing-balance with custom rate (15%)');
{
  const N = 10;
  const additions = zeros(N);
  additions[0] = 1_000_000;
  const r = computeAssetFixedAssets({
    assetId: 'rb2',
    axisLength: N,
    startIdx: 0,
    additionsPerPeriod: additions,
    usefulLifeYears: 25,    // life caps the window at 10 (axis end)
    method: 'reducing_balance',
    reducingBalanceRate: 0.15,
  });
  // dep[0] = 1M * 0.15 = 150k
  assertNear('L1: dep year 0 = 150k (custom 15%)', r.depreciationPerPeriod[0], 150_000);
  // dep[1] = 850k * 0.15 = 127.5k
  assertNear('L2: dep year 1 = 127.5k', r.depreciationPerPeriod[1], 127_500);
  // Effective rate echoed
  assertNear('L3: effectiveRate = 0.15', r.effectiveRate ?? 0, 0.15);
}

console.log(`\n--- Fixed Asset verifier: ${pass} pass / ${fail} fail / ${pass + fail} total ---`);
if (fail > 0) {
  console.error('\nFAILURES:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
