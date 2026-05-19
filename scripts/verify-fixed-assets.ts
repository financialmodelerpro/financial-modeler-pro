/**
 * Module 4 Pass 1 — Fixed Assets + Depreciation verifier.
 *
 * Anchors:
 *   - Reference Excel v7.0 methodology: per-period opening + addition −
 *     depreciation = closing roll-forward, straight-line over per-line
 *     useful life, Land excluded (life=0).
 *   - FMP conventions: project axis arr[0] = first active year;
 *     Hospitality default 20 yrs / Lease 25 yrs via
 *     resolveUsefulLifeYears + DEFAULT_USEFUL_LIFE_YEARS.
 *
 * Sections:
 *   A — pure SL allocator unit tests
 *   B — single-asset Hospitality fresh capex roll-forward
 *   C — Land additions excluded from depreciation base
 *   D — Existing operations opening NBV roll-forward
 *   E — Vintage handling: additions after handover depreciate from
 *       their own spend year
 *   F — Identity: closing[t] = opening[t] + additions[t] − dep[t]
 *   G — Sell-only project produces empty snapshot
 *   H — Project totals = sum across per-asset arrays
 */

import {
  buildStraightLine,
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

console.log('=== Module 4 Pass 1 Fixed Assets + Depreciation verifier ===');

// ─────────────────────────────────────────────────────────────────────
// A — Pure SL allocator
// ─────────────────────────────────────────────────────────────────────
console.log('\n[A] Straight-line allocator');
{
  // A1: base 1000, life 10, start 0, N=15 → 100/yr for 10 yrs, then 0
  const sl = buildStraightLine(1000, 10, 0, 15);
  assertNear('A1: SL year 0 = base/life', sl[0], 100);
  assertNear('A1: SL year 9 = base/life', sl[9], 100);
  assertNear('A1: SL year 10 = 0 (life exhausted)', sl[10], 0);
  assertNear('A1: SL sum = base', sl.reduce((s, v) => s + v, 0), 1000);
}
{
  // A2: base 1000, life 10, start 5, N=10 → only 5 yrs of depreciation
  // (life extends past axisLength; residual NBV stays at exit per the
  // reference model's net-worth exit method).
  const sl = buildStraightLine(1000, 10, 5, 10);
  assertNear('A2: SL year 4 = 0 (pre-start)', sl[4], 0);
  assertNear('A2: SL year 5 = 100', sl[5], 100);
  assertNear('A2: SL year 9 = 100', sl[9], 100);
  assertNear('A2: SL sum = 500 (5 of 10 years on axis)', sl.reduce((s, v) => s + v, 0), 500);
}
{
  // A3: life=0 (Land) → all zeros
  const sl = buildStraightLine(1000, 0, 0, 5);
  assertNear('A3: life=0 returns all zeros', sl.reduce((s, v) => s + v, 0), 0);
}
{
  // A4: base=0 → all zeros
  const sl = buildStraightLine(0, 10, 0, 5);
  assertNear('A4: base=0 returns all zeros', sl.reduce((s, v) => s + v, 0), 0);
}

// ─────────────────────────────────────────────────────────────────────
// B — Fresh Hospitality asset, single addition at handover
// 250M capex (depreciable), 25 yrs SL, N=30, handoverIdx=4
// ─────────────────────────────────────────────────────────────────────
console.log('\n[B] Single-asset fresh Hospitality capex (25-yr SL)');
{
  const N = 30;
  const handover = 4;
  // Even capex of 50M over construction years 0..4 (5 years × 50M = 250M)
  const additions = zeros(N);
  for (let t = 0; t <= handover; t++) additions[t] = 50_000_000;
  const land = zeros(N); // pure depreciable
  const r = computeAssetFixedAssets({
    assetId: 'h1',
    axisLength: N,
    startIdx: handover,
    additionsPerPeriod: additions,
    additionsLandPerPeriod: land,
    usefulLifeYears: 25,
  });
  // At handover (t=4) every prior addition starts depreciating. Five
  // 50M vintages each contribute 50M/25 = 2M/yr from t=4 → 10M/yr total
  // through year handover + 25 − 1 = 28.
  assertNear('B1: dep at handover = 250M / 25 = 10M', r.depreciationPerPeriod[handover], 10_000_000);
  assertNear('B2: dep at t=20 (still in life) = 10M', r.depreciationPerPeriod[20], 10_000_000);
  assertNear('B3: dep at t=29 (after life) = 0', r.depreciationPerPeriod[29], 0);
  assertNear('B4: total dep across axis = 250M (full base recovered)',
    r.totalDepreciation, 250_000_000);
  // Closing NBV at handover = sum of additions − that year's dep.
  // Opening was 50×4 = 200M (4 prior years' WIP). Year 4 adds 50M and
  // takes 10M dep → 200 + 50 − 10 = 240M.
  assertNear('B5: closing NBV at handover = opening + add − dep', r.closingNBVPerPeriod[handover], 240_000_000);
  // Final closing = 0 (full base depreciated within axis).
  assertNear('B6: closing NBV at end of axis = 0', r.closingNBVPerPeriod[N - 1], 0);
}

// ─────────────────────────────────────────────────────────────────────
// C — Land additions excluded from depreciation base
// 100M land + 200M building in year 0; life 20, handoverIdx=0
// ─────────────────────────────────────────────────────────────────────
console.log('\n[C] Land excluded from depreciation');
{
  const N = 25;
  const additions = zeros(N);
  const land = zeros(N);
  additions[0] = 300_000_000;
  land[0] = 100_000_000;
  const r = computeAssetFixedAssets({
    assetId: 'h2',
    axisLength: N,
    startIdx: 0,
    additionsPerPeriod: additions,
    additionsLandPerPeriod: land,
    usefulLifeYears: 20,
  });
  // Only 200M depreciates over 20 years → 10M/yr; Land 100M stays as NBV.
  assertNear('C1: dep year 0 = 200M / 20 = 10M', r.depreciationPerPeriod[0], 10_000_000);
  assertNear('C2: dep year 19 = 10M', r.depreciationPerPeriod[19], 10_000_000);
  assertNear('C3: dep year 20 = 0 (life exhausted)', r.depreciationPerPeriod[20], 0);
  assertNear('C4: total dep = 200M (Land never depreciates)', r.totalDepreciation, 200_000_000);
  // Closing NBV at end of axis = Land 100M + residual building 0 = 100M
  assertNear('C5: closing NBV at end = land 100M', r.closingNBVPerPeriod[N - 1], 100_000_000);
}

// ─────────────────────────────────────────────────────────────────────
// D — Existing operations opening NBV (no new additions)
// Opening NBV 100M, life 20, N=25, startIdx=0
// ─────────────────────────────────────────────────────────────────────
console.log('\n[D] Existing operations opening NBV');
{
  const N = 25;
  const r = computeAssetFixedAssets({
    assetId: 'eo1',
    axisLength: N,
    startIdx: 0,
    additionsPerPeriod: zeros(N),
    additionsLandPerPeriod: zeros(N),
    usefulLifeYears: 20,
    openingNBV: 100_000_000,
  });
  assertNear('D1: opening NBV at idx 0 = 100M', r.openingNBVPerPeriod[0], 100_000_000);
  assertNear('D2: dep year 0 = 100M / 20 = 5M', r.depreciationPerPeriod[0], 5_000_000);
  assertNear('D3: dep year 19 = 5M', r.depreciationPerPeriod[19], 5_000_000);
  assertNear('D4: dep year 20 = 0 (life exhausted)', r.depreciationPerPeriod[20], 0);
  assertNear('D5: closing year 19 = 0 (fully depreciated)', r.closingNBVPerPeriod[19], 0);
  assertNear('D6: total dep = 100M', r.totalDepreciation, 100_000_000);
}

// ─────────────────────────────────────────────────────────────────────
// E — Vintage handling: post-handover capex depreciates from spend year
// Year 4 handover, 100M base addition at year 0, then 50M refurb at
// year 10. Life 25.
// ─────────────────────────────────────────────────────────────────────
console.log('\n[E] Vintage handling: refurb addition after handover');
{
  const N = 35;
  const additions = zeros(N);
  additions[0] = 100_000_000;
  additions[10] = 50_000_000;
  const land = zeros(N);
  const r = computeAssetFixedAssets({
    assetId: 'h3',
    axisLength: N,
    startIdx: 4,
    additionsPerPeriod: additions,
    additionsLandPerPeriod: land,
    usefulLifeYears: 25,
  });
  // Year 4: base vintage (100M) starts → 100M/25 = 4M; refurb not yet.
  assertNear('E1: dep year 4 = base vintage only (4M)', r.depreciationPerPeriod[4], 4_000_000);
  // Year 9: still base only (4M).
  assertNear('E2: dep year 9 = base only (4M)', r.depreciationPerPeriod[9], 4_000_000);
  // Year 10: refurb vintage starts (50M/25 = 2M) → total 6M.
  assertNear('E3: dep year 10 = base + refurb = 6M', r.depreciationPerPeriod[10], 6_000_000);
  // Year 28: base vintage ran out at year 4+25-1 = 28; year 28 still in
  // base life (year 4..28 = 25 years inclusive). Year 29 base = 0.
  assertNear('E4: dep year 29 = refurb only (2M)', r.depreciationPerPeriod[29], 2_000_000);
  // Year 34: refurb ran out at year 10+25-1 = 34. So year 34 = 2M.
  assertNear('E5: dep year 34 = refurb final year (2M)', r.depreciationPerPeriod[34], 2_000_000);
  // Total dep = 100M + 50M = 150M.
  assertNear('E6: total dep = 100M + 50M', r.totalDepreciation, 150_000_000);
}

// ─────────────────────────────────────────────────────────────────────
// F — Roll-forward identity: closing = opening + additions − dep
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
    additionsLandPerPeriod: zeros(N),
    usefulLifeYears: 15,
  });
  for (let t = 0; t < N; t++) {
    const expected = (r.openingNBVPerPeriod[t] ?? 0)
      + (r.additionsPerPeriod[t] ?? 0)
      - (r.depreciationPerPeriod[t] ?? 0);
    assertNear(`F${t + 1}: closing[${t}] = opening + add − dep`,
      r.closingNBVPerPeriod[t], Math.max(0, expected));
  }
}

// ─────────────────────────────────────────────────────────────────────
// G — Project resolver: Sell-only project → empty snapshot
// ─────────────────────────────────────────────────────────────────────
console.log('\n[G] Sell-only project produces empty fixed-asset snapshot');
{
  const state = buildSellOnlyState();
  const snap = computeAllFixedAssetResults(state);
  assertEqInt('G1: byAsset is empty', snap.byAsset.size, 0);
  // Project totals exist but every cell is zero.
  const totalDep = snap.projectTotals.depreciationPerPeriod.reduce((s, v) => s + v, 0);
  assertNear('G2: project totals depreciation = 0', totalDep, 0);
}

// ─────────────────────────────────────────────────────────────────────
// H — Project resolver: per-asset sum = project totals
// ─────────────────────────────────────────────────────────────────────
console.log('\n[H] Project totals = sum across per-asset arrays');
{
  const state = buildTwoHospitalityAssetsState();
  const snap = computeAllFixedAssetResults(state);
  assertEqInt('H1: byAsset has 2 entries', snap.byAsset.size, 2);
  // Sum per-asset dep across both, compare to project totals.
  const summed = new Array<number>(snap.axisLength).fill(0);
  for (const r of snap.byAsset.values()) {
    for (let t = 0; t < snap.axisLength; t++) summed[t] += r.depreciationPerPeriod[t] ?? 0;
  }
  let maxDelta = 0;
  for (let t = 0; t < snap.axisLength; t++) {
    const d = Math.abs(summed[t] - (snap.projectTotals.depreciationPerPeriod[t] ?? 0));
    if (d > maxDelta) maxDelta = d;
  }
  assertNear('H2: max |perAssetSum − projectTotal| over axis', maxDelta, 0);
  // Cumulative accumDep at end of axis = sum of totals.
  const cumExpected = snap.projectTotals.depreciationPerPeriod.reduce((s, v) => s + v, 0);
  assertNear('H3: project accumDep end = cum sum of dep stream',
    snap.projectTotals.accumDepPerPeriod[snap.axisLength - 1] ?? 0, cumExpected);
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

console.log(`\n--- Fixed Asset verifier: ${pass} pass / ${fail} fail / ${pass + fail} total ---`);
if (fail > 0) {
  console.error('\nFAILURES:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
