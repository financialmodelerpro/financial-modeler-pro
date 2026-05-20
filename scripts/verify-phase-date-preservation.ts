/**
 * M4 Pass 2h verifier: phase-date change preserves the year intent
 * of every per-period input.
 *
 * Scenario from Period_Data_Shift_Bug_Fix.md:
 *   Project starts 2026, Phase 1 = 2026, Phase 2 = 2026 (cp = 4).
 *   User enters Phase 2 Pre-Sales Velocity at axis indices 0-3:
 *     [0.05, 0.30, 0.30, 0.25]  (calendar years 2026..2029).
 *   User changes Phase 1 startDate to 2025.
 *   Project axis origin moves to 2025.
 *   Phase 2 still starts in 2026, now at axis idx 1.
 *
 * Expected after the M4 Pass 2h hybrid storage:
 *   - The phase-local ByPhase array stays anchored to Phase 2's
 *     calendar years. The values produced by the revenue engine for
 *     2026, 2027, 2028, 2029 must equal what the user entered there.
 *   - The legacy axis-indexed array is irrelevant (engine reads new
 *     field via the resolver's expand step).
 *
 * Sections:
 *   A: Storage shape sanity:preSalesVelocityByPhase carries the
 *      user's intent verbatim regardless of project axis origin.
 *   B: Engine read end-to-end:computeAllSellResults produces the
 *      same pre-sales revenue per calendar year before and after the
 *      project axis shifts.
 *   C: Year-keyed financing tranche distribution (sanity that the
 *      year-map expansion produces the same engine input regardless
 *      of axis origin).
 */

import {
  computeAllSellResults,
  expandPhaseLocalToAxis,
  expandYearKeyedToAxis,
} from '@/src/hubs/modeling/platforms/refm/lib/revenue-resolvers';
import { DEFAULT_PROJECT_FINANCING_CONFIG } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import type {
  Asset,
  Phase,
  Project,
  SubUnit,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function assertEq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  [PASS] ${name}`);
  } else {
    fail++;
    failures.push(`${name}: actual=${a} expected=${e}`);
    console.log(`  [FAIL] ${name}: actual=${a} expected=${e}`);
  }
}

function assertNear(name: string, actual: number, expected: number, tol = 0.5): void {
  const delta = Math.abs(actual - expected);
  if (delta <= tol) {
    pass++;
    console.log(`  [PASS] ${name}: actual=${actual.toFixed(2)} vs expected=${expected.toFixed(2)} (delta=${delta.toFixed(4)})`);
  } else {
    fail++;
    failures.push(`${name}: actual=${actual.toFixed(2)} expected=${expected.toFixed(2)} delta=${delta.toFixed(4)}`);
    console.log(`  [FAIL] ${name}: actual=${actual.toFixed(2)} vs expected=${expected.toFixed(2)} (delta=${delta.toFixed(4)})`);
  }
}

console.log('=== M4 Pass 2h phase-date preservation verifier ===');

// ─────────────────────────────────────────────────────────────────────
// A: expand helpers:phase-local round trip
// ─────────────────────────────────────────────────────────────────────
console.log('\n[A] expandPhaseLocalToAxis preserves intent');
{
  // Phase 2 stored values: [0.05, 0.30, 0.30, 0.25] phase-local.
  const byPhase = [0.05, 0.30, 0.30, 0.25];
  // Project origin = 2026, phase starts 2026 -> phaseOffset = 0.
  const v1 = expandPhaseLocalToAxis(byPhase, undefined, 0, 8);
  assertEq('A1: phaseOffset=0 maps idx->idx', v1, [0.05, 0.30, 0.30, 0.25, 0, 0, 0, 0]);
  // After project origin moves to 2025, phaseOffset = 1.
  const v2 = expandPhaseLocalToAxis(byPhase, undefined, 1, 8);
  assertEq('A2: phaseOffset=1 shifts axis values right by 1', v2, [0, 0.05, 0.30, 0.30, 0.25, 0, 0, 0]);
  // After project origin moves to 2024, phaseOffset = 2.
  const v3 = expandPhaseLocalToAxis(byPhase, undefined, 2, 8);
  assertEq('A3: phaseOffset=2 shifts axis values right by 2', v3, [0, 0, 0.05, 0.30, 0.30, 0.25, 0, 0]);
  // Legacy fallback: when ByPhase is undefined, read legacy axis array.
  const v4 = expandPhaseLocalToAxis(undefined, [0.05, 0.30, 0.30, 0.25], 1, 8);
  assertEq('A4: legacy fallback ignores phaseOffset (back-compat)', v4, [0.05, 0.30, 0.30, 0.25, 0, 0, 0, 0]);
}

// ─────────────────────────────────────────────────────────────────────
// B: end-to-end:engine result for 2026 stays at 0.05 before and after
//    a Phase 1 startDate move to 2025.
// ─────────────────────────────────────────────────────────────────────
console.log('\n[B] Engine result for Phase 2 stays anchored when Phase 1 moves');

function buildScenario(phase1Year: number): {
  project: Project;
  phases: Phase[];
  assets: Asset[];
  subUnits: SubUnit[];
} {
  const project = {
    name: 'phase-date-test',
    currency: 'SAR',
    modelType: 'annual' as const,
    startDate: `${Math.min(phase1Year, 2026)}-01-01`,
    status: 'Draft' as const,
    location: '',
    country: 'Saudi Arabia',
  } as unknown as Project;

  const phase1: Phase = {
    id: 'phase1',
    name: 'Phase 1',
    startDate: `${phase1Year}-01-01`,
    constructionPeriods: 4,
    operationsPeriods: 10,
    overlapPeriods: 0,
    status: 'planning',
  } as unknown as Phase;
  const phase2: Phase = {
    id: 'phase2',
    name: 'Phase 2',
    startDate: '2026-01-01',
    constructionPeriods: 4,
    operationsPeriods: 10,
    overlapPeriods: 0,
    status: 'planning',
  } as unknown as Phase;

  // One Sell asset on Phase 2 with a single sub-unit.
  const asset: Asset = {
    id: 'asset1',
    phaseId: 'phase2',
    name: 'Tower A',
    type: 'Residential',
    strategy: 'Sell',
    visible: true,
    gfaSqm: 10000,
    buaSqm: 8000,
    sellableBuaSqm: 6000,
    revenue: {
      sell: {
        assetId: 'asset1',
        subUnits: [
          {
            subUnitId: 'su1',
            // M4 Pass 2h: store phase-local. The user entered [0.05,
            // 0.30, 0.30, 0.25] for calendar years 2026..2029 which is
            // phase-local indices 0..3 since Phase 2 starts in 2026.
            preSalesVelocityByPhase: [0.05, 0.30, 0.30, 0.25],
            postSalesVelocityByPhase: [],
            // Legacy fields intentionally empty to prove the new field
            // is the canonical source.
            preSalesVelocity: [],
            postSalesVelocity: [],
          },
        ],
        cashPaymentProfile: { percentages: [], profileMode: 'absolute_with_catchup' },
        recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
        indexation: { method: 'none' },
      },
    },
  } as unknown as Asset;

  const subUnit: SubUnit = {
    id: 'su1',
    assetId: 'asset1',
    name: 'Apartments',
    category: 'residential',
    metric: 'units',
    metricValue: 100,
    unitArea: 100,
    unitPrice: 1_000_000,
  } as unknown as SubUnit;

  return { project, phases: [phase1, phase2], assets: [asset], subUnits: [subUnit] };
}

// Snapshot 1: Phase 1 starts 2026, project origin = 2026.
{
  const s = buildScenario(2026);
  const res = computeAllSellResults(s);
  // Phase 2 asset's pre-sales revenue per period should be non-zero
  // at calendar years 2026..2029 (which is project axis idx 0..3
  // since origin = 2026).
  const sell = res.bySellAsset.get('asset1');
  if (!sell) {
    console.log('  [FAIL] B-pre: no sell result');
    fail++;
  } else {
    assertNear('B1: rev[2026] non-zero (idx 0)', sell.presalesRevenuePerPeriod[0] ?? 0, 5_000_000, 1);
    assertNear('B2: rev[2027] (idx 1)', sell.presalesRevenuePerPeriod[1] ?? 0, 30_000_000, 1);
    assertNear('B3: rev[2028] (idx 2)', sell.presalesRevenuePerPeriod[2] ?? 0, 30_000_000, 1);
    assertNear('B4: rev[2029] (idx 3)', sell.presalesRevenuePerPeriod[3] ?? 0, 25_000_000, 1);
  }
}

// Snapshot 2: Phase 1 moved to 2025, project origin = 2025.
{
  const s = buildScenario(2025);
  const res = computeAllSellResults(s);
  const sell = res.bySellAsset.get('asset1');
  if (!sell) {
    console.log('  [FAIL] B-post: no sell result');
    fail++;
  } else {
    // Calendar year 2026 is now project axis idx 1 (origin moved to
    // 2025). Phase 2 still starts in 2026, so phaseOffset = 1.
    // The ByPhase array at index 0 corresponds to calendar year 2026.
    assertNear('B5: rev[2025] = 0 (Phase 2 has no Phase 1-year activity)', sell.presalesRevenuePerPeriod[0] ?? 0, 0, 1);
    assertNear('B6: rev[2026] still 5% (idx 1)', sell.presalesRevenuePerPeriod[1] ?? 0, 5_000_000, 1);
    assertNear('B7: rev[2027] still 30% (idx 2)', sell.presalesRevenuePerPeriod[2] ?? 0, 30_000_000, 1);
    assertNear('B8: rev[2028] still 30% (idx 3)', sell.presalesRevenuePerPeriod[3] ?? 0, 30_000_000, 1);
    assertNear('B9: rev[2029] still 25% (idx 4)', sell.presalesRevenuePerPeriod[4] ?? 0, 25_000_000, 1);
  }
}

// ─────────────────────────────────────────────────────────────────────
// C: year-keyed expansion round trip
// ─────────────────────────────────────────────────────────────────────
console.log('\n[C] expandYearKeyedToAxis maps by absolute year');
{
  const byYear = { '2026': 0.10, '2027': 0.20, '2028': 0.30, '2029': 0.40 };
  // Project starts 2026.
  const v1 = expandYearKeyedToAxis(byYear, undefined, 2026, 8);
  assertEq('C1: project=2026 axis[0]=2026 mapped', v1, [0.10, 0.20, 0.30, 0.40, 0, 0, 0, 0]);
  // Project moves to 2025.
  const v2 = expandYearKeyedToAxis(byYear, undefined, 2025, 8);
  assertEq('C2: project=2025 axis[1]=2026 mapped', v2, [0, 0.10, 0.20, 0.30, 0.40, 0, 0, 0]);
  // Year-keyed orphan handling: year outside axis stays untouched, 2026 still readable.
  const v3 = expandYearKeyedToAxis(byYear, undefined, 2028, 4);
  assertEq('C3: project=2028 only 2028/2029 visible (2026/2027 orphan)', v3, [0.30, 0.40, 0, 0]);
}

// ─────────────────────────────────────────────────────────────────────
// D: cash payment profile phase-offset behaviour (M2 Pass 9k-Fix).
//    percentagesByPhase[k] is phase-LOCAL slot k; the resolver must
//    offset positions by phaseOffset so cohorts pay at the correct
//    absolute project years.
// ─────────────────────────────────────────────────────────────────────
console.log('\n[D] Cash payment profile picks up phaseOffset for Phase 2+');
{
  // Phase 2 starts 2031 (phaseOffset = 5). Phase-local cash slot 1 =
  // year 2032; slot 2 = 2033; slot 3 = 2034. Pre-sale of 100 units at
  // year 2031 (phase-local 0): 50% at booking (slot 0 = 2031), 50% at
  // slot 1 (= 2032).
  const project = {
    name: 'cash-phase-offset',
    currency: 'SAR',
    modelType: 'annual' as const,
    startDate: '2026-01-01',
    status: 'Draft' as const,
    location: '',
    country: 'Saudi Arabia',
  } as unknown as Project;
  const phase1: Phase = { id: 'p1', name: 'P1', startDate: '2026-01-01', constructionPeriods: 5, operationsPeriods: 0, overlapPeriods: 0, status: 'planning' } as unknown as Phase;
  const phase2: Phase = { id: 'p2', name: 'P2', startDate: '2031-01-01', constructionPeriods: 4, operationsPeriods: 4, overlapPeriods: 0, status: 'planning' } as unknown as Phase;
  const asset: Asset = {
    id: 'a1', phaseId: 'p2', name: 'P2 Tower', type: 'Residential', strategy: 'Sell', visible: true,
    gfaSqm: 10000, buaSqm: 10000, sellableBuaSqm: 10000,
    revenue: {
      sell: {
        assetId: 'a1',
        subUnits: [{
          subUnitId: 'su1',
          preSalesVelocityByPhase: [1.0, 0, 0, 0], // sell 100% in phase-local year 0 (2031)
          postSalesVelocityByPhase: [],
          preSalesVelocity: [], postSalesVelocity: [],
        }],
        cashPaymentProfile: {
          percentages: [],
          profileMode: 'absolute_with_catchup',
          // Phase-local cash schedule: 50% slot 0 (2031), 50% slot 1 (2032).
          percentagesByPhase: [0.5, 0.5, 0, 0],
        },
        recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
        indexation: { method: 'none' },
      },
    },
  } as unknown as Asset;
  const subUnit: SubUnit = {
    id: 'su1', assetId: 'a1', name: 'Apartments', category: 'residential',
    metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_000_000,
  } as unknown as SubUnit;
  const res = computeAllSellResults({ project, phases: [phase1, phase2], assets: [asset], subUnits: [subUnit] });
  const sell = res.bySellAsset.get('a1');
  if (!sell) {
    console.log('  [FAIL] D-pre: no sell result');
    fail++;
  } else {
    // Total contract value = 100 × 1M = 100M, all sold in 2031.
    // Cash 50% in 2031 (axis idx 5), 50% in 2032 (axis idx 6).
    assertNear('D1: cash in 2026 (axis 0) = 0 (Phase 1 has no asset)', sell.cashCollectedPerPeriod[0] ?? 0, 0, 1);
    assertNear('D2: cash in 2030 (axis 4) = 0 (before Phase 2)', sell.cashCollectedPerPeriod[4] ?? 0, 0, 1);
    assertNear('D3: cash in 2031 (axis 5) = 50M', sell.cashCollectedPerPeriod[5] ?? 0, 50_000_000, 10);
    assertNear('D4: cash in 2032 (axis 6) = 50M', sell.cashCollectedPerPeriod[6] ?? 0, 50_000_000, 10);
  }
}

// ─────────────────────────────────────────────────────────────────────
// E: cash schedule can extend past phase construction + operations.
//    A long payment plan running into post-phase years should still
//    deliver cash (M2 Pass 9k-Fix removes the aggressive truncation
//    to cp + op - overlap).
// ─────────────────────────────────────────────────────────────────────
console.log('\n[E] Cash schedule extends past phaseLen');
{
  const project = {
    name: 'long-pay-plan',
    currency: 'SAR',
    modelType: 'annual' as const,
    startDate: '2026-01-01',
    status: 'Draft' as const,
    location: '',
    country: 'Saudi Arabia',
  } as unknown as Project;
  // Phase: cp=2, op=2 → phaseLen = 4. A second phase extends the
  // project axis to 10 years so the long pay plan has room to land.
  const phase: Phase = { id: 'p1', name: 'P1', startDate: '2026-01-01', constructionPeriods: 2, operationsPeriods: 2, overlapPeriods: 0, status: 'planning' } as unknown as Phase;
  const phaseExt: Phase = { id: 'p2', name: 'P2', startDate: '2032-01-01', constructionPeriods: 2, operationsPeriods: 2, overlapPeriods: 0, status: 'planning' } as unknown as Phase;
  const asset: Asset = {
    id: 'a1', phaseId: 'p1', name: 'Long-pay tower', type: 'Residential', strategy: 'Sell', visible: true,
    gfaSqm: 10000, buaSqm: 10000, sellableBuaSqm: 10000,
    revenue: {
      sell: {
        assetId: 'a1',
        subUnits: [{
          subUnitId: 'su1',
          preSalesVelocityByPhase: [1.0, 0], // sell 100% in phase-local year 0 (2026)
          postSalesVelocityByPhase: [],
          preSalesVelocity: [], postSalesVelocity: [],
        }],
        cashPaymentProfile: {
          percentages: [],
          profileMode: 'absolute_with_catchup',
          // 10% per phase-local slot for 6 years (extends 2 years past phaseLen).
          percentagesByPhase: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
        },
        recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
        indexation: { method: 'none' },
      },
    },
  } as unknown as Asset;
  const subUnit: SubUnit = {
    id: 'su1', assetId: 'a1', name: 'Apartments', category: 'residential',
    metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_000_000,
  } as unknown as SubUnit;
  // Total inventory present, set project endpoints to keep total revenue at 60M (6 × 10%).
  void subUnit;
  const res = computeAllSellResults({ project, phases: [phase, phaseExt], assets: [asset], subUnits: [subUnit] });
  const sell = res.bySellAsset.get('a1');
  if (!sell) {
    console.log('  [FAIL] E-pre: no sell result');
    fail++;
  } else {
    // Total contract = 100 × 1M = 100M sold in 2026 (axis 0).
    // Cash 10M per year for 6 years (2026..2031), axis 0..5.
    // Cumulative collected = 60M (60% of contract). The remaining 40%
    // stays uncollected since the schedule only sums to 60%.
    assertNear('E1: cash at axis 0 (2026) = 10M', sell.cashCollectedPerPeriod[0] ?? 0, 10_000_000, 100);
    assertNear('E2: cash at axis 3 (2029, still within phaseLen) = 10M', sell.cashCollectedPerPeriod[3] ?? 0, 10_000_000, 100);
    assertNear('E3: cash at axis 4 (2030, post-phaseLen) = 10M', sell.cashCollectedPerPeriod[4] ?? 0, 10_000_000, 100);
    assertNear('E4: cash at axis 5 (2031, post-phaseLen) = 10M', sell.cashCollectedPerPeriod[5] ?? 0, 10_000_000, 100);
    assertNear('E5: cumulative cash through axis 5 = 60M', sell.cashCollectedPerPeriod.slice(0, 6).reduce((s, v) => s + v, 0), 60_000_000, 100);
  }
}

// ─────────────────────────────────────────────────────────────────────
// F: percentagesByPhase longer than project axis must NOT empty the
//    cash vintage matrix. buildCohortMatrix early-returns when pct
//    and pos arrays disagree in length, so the resolver must pass
//    them through in lockstep (don't filter pos, the engine drops
//    out-of-range positions internally).
// ─────────────────────────────────────────────────────────────────────
console.log('\n[F] Long percentagesByPhase does not zero out the matrix (lockstep pct/pos)');
{
  const project = {
    name: 'long-by-phase',
    currency: 'SAR',
    modelType: 'annual' as const,
    startDate: '2026-01-01',
    status: 'Draft' as const,
    location: '',
    country: 'Saudi Arabia',
  } as unknown as Project;
  // Project axis is 5 years (2026..2030) driven by phases.
  const phase: Phase = { id: 'p1', name: 'P1', startDate: '2026-01-01', constructionPeriods: 2, operationsPeriods: 3, overlapPeriods: 0, status: 'planning' } as unknown as Phase;
  const asset: Asset = {
    id: 'a1', phaseId: 'p1', name: 'Tower', type: 'Residential', strategy: 'Sell', visible: true,
    gfaSqm: 10000, buaSqm: 10000, sellableBuaSqm: 10000,
    revenue: {
      sell: {
        assetId: 'a1',
        subUnits: [{
          subUnitId: 'su1',
          preSalesVelocityByPhase: [1.0, 0],
          postSalesVelocityByPhase: [],
          preSalesVelocity: [], postSalesVelocity: [],
        }],
        cashPaymentProfile: {
          percentages: [],
          profileMode: 'absolute_with_catchup',
          // Length 10 (longer than the 5-year axis). The cohort engine
          // must drop positions 5-9 internally without breaking the
          // pct/pos length-equality guard.
          percentagesByPhase: [0.2, 0.2, 0.2, 0.2, 0.2, 0, 0, 0, 0, 0],
        },
        recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
        indexation: { method: 'none' },
      },
    },
  } as unknown as Asset;
  const subUnit: SubUnit = {
    id: 'su1', assetId: 'a1', name: 'Apartments', category: 'residential',
    metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_000_000,
  } as unknown as SubUnit;
  const res = computeAllSellResults({ project, phases: [phase], assets: [asset], subUnits: [subUnit] });
  const sell = res.bySellAsset.get('a1');
  if (!sell) {
    console.log('  [FAIL] F-pre: no sell result');
    fail++;
  } else {
    // Contract value 100M sold in 2026. Cash 20% × 5 years = 100M total.
    assertNear('F1: cash at axis 0 (2026) = 20M', sell.cashCollectedPerPeriod[0] ?? 0, 20_000_000, 10);
    assertNear('F2: cash at axis 2 (2028) = 20M (matrix not empty)', sell.cashCollectedPerPeriod[2] ?? 0, 20_000_000, 10);
    assertNear('F3: cash at axis 4 (2030) = 20M', sell.cashCollectedPerPeriod[4] ?? 0, 20_000_000, 10);
    assertNear('F4: total cash = 100M (all collected within axis)', sell.cashCollectedPerPeriod.reduce((s, v) => s + v, 0), 100_000_000, 10);
    // Vintage matrix must be populated, not zeroed.
    const matrixSum = sell.cashVintageMatrix.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
    assertNear('F5: vintage matrix sum = 100M (NOT empty)', matrixSum, 100_000_000, 10);
  }
}

// ─────────────────────────────────────────────────────────────────────
// G: data recovery when percentagesByPhase was truncated by Pass 9k
//    but legacy percentages still holds the user's original data.
//    The resolver must MERGE both rather than pick one source.
// ─────────────────────────────────────────────────────────────────────
console.log('\n[G] Truncated percentagesByPhase + intact legacy = full schedule recovered');
{
  const project = {
    name: 'data-recovery',
    currency: 'SAR',
    modelType: 'annual' as const,
    startDate: '2026-01-01',
    status: 'Draft' as const,
    location: '',
    country: 'Saudi Arabia',
  } as unknown as Project;
  // Phase: cp=4, op=0 (handover at year 3). Pass 9k truncated
  // percentagesByPhase to length cp + op - overlap = 4. A second
  // phase extends the project axis so the full 8-year schedule
  // has somewhere to land.
  const phase: Phase = { id: 'p1', name: 'P1', startDate: '2026-01-01', constructionPeriods: 4, operationsPeriods: 0, overlapPeriods: 0, status: 'planning' } as unknown as Phase;
  const phaseExt: Phase = { id: 'p2', name: 'P2', startDate: '2031-01-01', constructionPeriods: 2, operationsPeriods: 3, overlapPeriods: 0, status: 'planning' } as unknown as Phase;
  const asset: Asset = {
    id: 'a1', phaseId: 'p1', name: 'Tower', type: 'Residential', strategy: 'Sell', visible: true,
    gfaSqm: 10000, buaSqm: 10000, sellableBuaSqm: 10000,
    revenue: {
      sell: {
        assetId: 'a1',
        subUnits: [{
          subUnitId: 'su1',
          preSalesVelocityByPhase: [1.0, 0, 0, 0],
          postSalesVelocityByPhase: [],
          preSalesVelocity: [], postSalesVelocity: [],
        }],
        cashPaymentProfile: {
          // Legacy: full 8-year schedule (axis 0..7 = 2026..2033).
          // 10% per year, sum = 80%. The remaining 20% sits in the
          // cohort matrix as catchup at sale year.
          percentages: [0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0, 0],
          // ByPhase: truncated to cp+op-overlap = 4 by Pass 9k. The
          // last 4 entries (post-handover) are lost in storage.
          percentagesByPhase: [0.10, 0.10, 0.10, 0.10],
          profileMode: 'absolute_with_catchup',
        },
        recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
        indexation: { method: 'none' },
      },
    },
  } as unknown as Asset;
  const subUnit: SubUnit = {
    id: 'su1', assetId: 'a1', name: 'Apartments', category: 'residential',
    metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_000_000,
  } as unknown as SubUnit;
  const res = computeAllSellResults({ project, phases: [phase, phaseExt], assets: [asset], subUnits: [subUnit] });
  const sell = res.bySellAsset.get('a1');
  if (!sell) {
    console.log('  [FAIL] G-pre: no sell result');
    fail++;
  } else {
    // Cohort sells 100M in 2026. Schedule 10% × 8 years => 10M at each
    // of 2026..2033 (axis 0..7). 80M total collected, 20M unhandled
    // catchup sits at sale year (2026): cohort gets 10M + 20M catchup
    // for the 0..0 catchup = no actually no catchup at sale year since
    // pos 0 == saleYear, just 10M. So 80M total over 8 years.
    assertNear('G1: cash at axis 0 (2026) = 10M', sell.cashCollectedPerPeriod[0] ?? 0, 10_000_000, 10);
    assertNear('G2: cash at axis 3 (2029, last truncated slot) = 10M', sell.cashCollectedPerPeriod[3] ?? 0, 10_000_000, 10);
    assertNear('G3: cash at axis 4 (2030, post-truncation slot from legacy) = 10M', sell.cashCollectedPerPeriod[4] ?? 0, 10_000_000, 10);
    assertNear('G4: cash at axis 7 (2033) = 10M', sell.cashCollectedPerPeriod[7] ?? 0, 10_000_000, 10);
    assertNear('G5: total collected over 8 years = 80M', sell.cashCollectedPerPeriod.slice(0, 8).reduce((s, v) => s + v, 0), 80_000_000, 10);
  }
}

console.log(`\n--- Phase-date preservation: ${pass} pass / ${fail} fail / ${pass + fail} total ---`);
if (fail > 0) {
  console.error('\nFAILURES:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
