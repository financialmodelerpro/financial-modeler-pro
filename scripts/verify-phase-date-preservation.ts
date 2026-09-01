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

/** A boolean assertion, for the cohort checks that compare shapes rather than
 *  magnitudes (which calendar years collect, how many years a cohort pays in). */
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass++;
    console.log(`  [PASS] ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? `: ${detail}` : ''}`);
    console.log(`  [FAIL] ${name}${detail ? `: ${detail}` : ''}`);
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
// ══════════════════════════════════════════════════════════════════════════
// D. THE CASH SCHEDULE STILL KEEPS ITS CALENDAR-YEAR INTENT WHEN A PHASE MOVES
//
// Sections D to G used to pin `cashPaymentProfile.percentagesByPhase`: a single
// per-period schedule shared by every sale year, with tests for a profile that
// outran the phase, a truncated one, and a legacy array merged on top.
//
// THAT MECHANISM IS GONE (2026-08-19). `buildSaleCohortProfile` replaced it:
// EVERY SALE YEAR IS ITS OWN COHORT, paying a downpayment in the year it sells
// and the balance in equal instalments over the years that follow, cut short by
// handover, because a buyer's payment plan ends when they get the keys. The old
// profile was one schedule forced on every cohort, which is why it went. The
// stored field is deprecated, not deleted, and nothing reads it.
//
// So the old assertions could not pass and should not: they described a
// mechanism the model no longer has. What they were REALLY protecting is this
// file's subject, and that subject is unchanged and still worth pinning:
//
//     moving a phase must not move the CALENDAR YEARS a cohort collects in.
//
// D to G below ask exactly that question of the rule that exists now.
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[D] Cohort cash keeps its calendar years when Phase 1 moves');
{
  const mk = (phase1Start: string) => {
    const project = {
      name: 'cohort-anchor', currency: 'SAR', modelType: 'annual' as const,
      startDate: phase1Start, status: 'Draft' as const, location: '', country: 'Saudi Arabia',
      saleCohortDefaults: { downpayment: 0.2 },
    } as unknown as Project;
    // Phase 2 is FIXED at 2030 and never moves. Phase 1's start is the variable.
    const p1: Phase = { id: 'p1', name: 'P1', startDate: phase1Start, constructionPeriods: 2, operationsPeriods: 4, overlapPeriods: 0, status: 'planning' } as unknown as Phase;
    const p2: Phase = { id: 'p2', name: 'P2', startDate: '2030-01-01', constructionPeriods: 3, operationsPeriods: 4, overlapPeriods: 0, status: 'planning' } as unknown as Phase;
    const asset: Asset = {
      id: 'a2', phaseId: 'p2', name: 'Phase 2 tower', type: 'Residential', strategy: 'Sell', visible: true,
      gfaSqm: 10000, buaSqm: 10000, sellableBuaSqm: 10000,
      revenue: { sell: {
        assetId: 'a2',
        subUnits: [{ subUnitId: 'su2', preSalesVelocityByPhase: [1.0, 0, 0], postSalesVelocityByPhase: [], preSalesVelocity: [], postSalesVelocity: [] }],
        recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
        indexation: { method: 'none' },
      } },
    } as unknown as Asset;
    const subUnit: SubUnit = { id: 'su2', assetId: 'a2', name: 'Apartments', category: 'Sellable', metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_000_000 } as unknown as SubUnit;
    const res = computeAllSellResults({ project, phases: [p1, p2], assets: [asset], subUnits: [subUnit] });
    return { res, sell: res.bySellAsset.get('a2'), startYear: new Date(phase1Start).getUTCFullYear() };
  };

  // Same project, twice, with Phase 1 starting a year earlier the second time.
  // The project axis origin moves; Phase 2 does not.
  const a = mk('2026-01-01');
  const b = mk('2025-01-01');

  if (!a.sell || !b.sell) {
    fail++; failures.push('D-pre: no sell result'); console.log('  [FAIL] D-pre: no sell result');
  } else {
    // Cash keyed by ABSOLUTE calendar year, which is what must not move.
    const byYear = (r: { cashCollectedPerPeriod: number[] }, origin: number): Map<number, number> => {
      const m = new Map<number, number>();
      r.cashCollectedPerPeriod.forEach((v, i) => { if (Math.abs(v) > 0.5) m.set(origin + i, v); });
      return m;
    };
    const ya = byYear(a.sell, a.startYear);
    const yb = byYear(b.sell, b.startYear);

    assertNear('D1: the cohort collects something at all', [...ya.values()].reduce((s, v) => s + v, 0), 100_000_000, 100);
    check('D2: the SAME calendar years collect before and after Phase 1 moves',
      [...ya.keys()].sort().join(',') === [...yb.keys()].sort().join(','),
      `before=[${[...ya.keys()].sort().join(',')}] after=[${[...yb.keys()].sort().join(',')}]`);
    let sameAmounts = true;
    for (const [yr, v] of ya) if (Math.abs((yb.get(yr) ?? 0) - v) > 1) sameAmounts = false;
    check('D3: and the SAME amount lands in each of those years', sameAmounts,
      `before=${JSON.stringify([...ya])} after=${JSON.stringify([...yb])}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[E] The cohort rule itself: deposit in the sale year, balance to handover');
{
  const project = {
    name: 'cohort-shape', currency: 'SAR', modelType: 'annual' as const,
    startDate: '2026-01-01', status: 'Draft' as const, location: '', country: 'Saudi Arabia',
    saleCohortDefaults: { downpayment: 0.25 },
  } as unknown as Project;
  // Construction 4 years: handover is 2029 (phaseStart + cp - 1).
  const phase: Phase = { id: 'p1', name: 'P1', startDate: '2026-01-01', constructionPeriods: 4, operationsPeriods: 4, overlapPeriods: 0, status: 'planning' } as unknown as Phase;
  const asset: Asset = {
    id: 'a1', phaseId: 'p1', name: 'Tower', type: 'Residential', strategy: 'Sell', visible: true,
    gfaSqm: 10000, buaSqm: 10000, sellableBuaSqm: 10000,
    revenue: { sell: {
      assetId: 'a1',
      // Everything sells in the FIRST year, so one cohort's shape is visible.
      subUnits: [{ subUnitId: 'su1', preSalesVelocityByPhase: [1.0, 0, 0, 0], postSalesVelocityByPhase: [], preSalesVelocity: [], postSalesVelocity: [] }],
      recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
      indexation: { method: 'none' },
    } },
  } as unknown as Asset;
  const subUnit: SubUnit = { id: 'su1', assetId: 'a1', name: 'Apartments', category: 'Sellable', metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_000_000 } as unknown as SubUnit;
  const res = computeAllSellResults({ project, phases: [phase], assets: [asset], subUnits: [subUnit] });
  const sell = res.bySellAsset.get('a1');
  if (!sell) {
    fail++; failures.push('E-pre: no sell result'); console.log('  [FAIL] E-pre: no sell result');
  } else {
    const cash = sell.cashCollectedPerPeriod;
    const total = cash.reduce((s, v) => s + v, 0);
    assertNear('E1: the WHOLE contract is collected, nothing is dropped', total, 100_000_000, 100);
    assertNear('E2: the deposit lands in the SALE year (25% of 100M)', cash[0] ?? 0, 25_000_000, 100);
    // Sale year 0, handover year 3 -> three instalment slots, 75M split equally.
    for (const t of [1, 2, 3]) {
      assertNear(`E3[t=${t}]: an equal instalment of the balance`, cash[t] ?? 0, 25_000_000, 100);
    }
    const afterHandover = cash.slice(4).reduce((s, v) => s + v, 0);
    assertNear('E4: NOTHING is collected after handover, the plan ends with the keys', afterHandover, 0, 1);
  }

  // THE CAP MUST BIND, and above it does not: DEFAULT_INSTALMENT_YEARS is 3 and
  // that fixture leaves exactly 3 slots before handover, so min(3, 3) is 3
  // whether or not the cap exists. Sabotaging the cap changed nothing and E4
  // still passed, which makes E4 a check that cannot fail for the reason it
  // names. A SHORTER build is what pins it: 3 construction years leave only 2
  // slots, so the default of 3 has to be cut down to 2.
  {
    const shortPhase: Phase = { id: 'p1', name: 'P1', startDate: '2026-01-01', constructionPeriods: 3, operationsPeriods: 5, overlapPeriods: 0, status: 'planning' } as unknown as Phase;
    const res2 = computeAllSellResults({ project, phases: [shortPhase], assets: [asset], subUnits: [subUnit] });
    const c2 = res2.bySellAsset.get('a1')?.cashCollectedPerPeriod ?? [];
    // Handover is year 2. Deposit 25M in year 0, then 75M over TWO years.
    assertNear('E5: the deposit is unchanged by the shorter build', c2[0] ?? 0, 25_000_000, 100);
    assertNear('E6: the balance is cut into TWO instalments, not the default three', c2[1] ?? 0, 37_500_000, 100);
    assertNear('E7: the second and last instalment lands ON handover', c2[2] ?? 0, 37_500_000, 100);
    assertNear('E8: and nothing at all after it', c2.slice(3).reduce((s, v) => s + v, 0), 0, 1);
    assertNear('E9: the whole contract is still collected', c2.reduce((s, v) => s + v, 0), 100_000_000, 100);
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[F] A cohort selling AT or AFTER handover pays in full, in its own year');
{
  const project = {
    name: 'cohort-late', currency: 'SAR', modelType: 'annual' as const,
    startDate: '2026-01-01', status: 'Draft' as const, location: '', country: 'Saudi Arabia',
    saleCohortDefaults: { downpayment: 0.25 },
  } as unknown as Project;
  const phase: Phase = { id: 'p1', name: 'P1', startDate: '2026-01-01', constructionPeriods: 2, operationsPeriods: 5, overlapPeriods: 0, status: 'planning' } as unknown as Phase;
  const asset: Asset = {
    id: 'a1', phaseId: 'p1', name: 'Tower', type: 'Residential', strategy: 'Sell', visible: true,
    gfaSqm: 10000, buaSqm: 10000, sellableBuaSqm: 10000,
    revenue: { sell: {
      assetId: 'a1',
      // Handover is year 1 (cp = 2). Selling entirely POST-handover.
      subUnits: [{ subUnitId: 'su1', preSalesVelocityByPhase: [], postSalesVelocityByPhase: [0, 0, 1.0, 0], preSalesVelocity: [], postSalesVelocity: [] }],
      recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
      indexation: { method: 'none' },
    } },
  } as unknown as Asset;
  const subUnit: SubUnit = { id: 'su1', assetId: 'a1', name: 'Apartments', category: 'Sellable', metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_000_000 } as unknown as SubUnit;
  const res = computeAllSellResults({ project, phases: [phase], assets: [asset], subUnits: [subUnit] });
  const sell = res.bySellAsset.get('a1');
  if (!sell) {
    fail++; failures.push('F-pre: no sell result'); console.log('  [FAIL] F-pre: no sell result');
  } else {
    const cash = sell.cashCollectedPerPeriod;
    assertNear('F1: the whole contract is still collected', cash.reduce((s, v) => s + v, 0), 100_000_000, 100);
    check('F2: a post-handover cohort collects in ONE year, not on a payment plan',
      cash.filter((v) => Math.abs(v) > 0.5).length === 1,
      `non-zero years: ${cash.map((v, i) => (Math.abs(v) > 0.5 ? i : -1)).filter((i) => i >= 0).join(',')}`);
    assertNear('F3: and nothing is collected before the sale', cash.slice(0, 2).reduce((s, v) => s + v, 0), 0, 1);
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[G] The retired per-period profile is IGNORED, not half-read');
{
  const project = {
    name: 'retired-profile', currency: 'SAR', modelType: 'annual' as const,
    startDate: '2026-01-01', status: 'Draft' as const, location: '', country: 'Saudi Arabia',
    saleCohortDefaults: { downpayment: 0.25 },
  } as unknown as Project;
  const phase: Phase = { id: 'p1', name: 'P1', startDate: '2026-01-01', constructionPeriods: 4, operationsPeriods: 4, overlapPeriods: 0, status: 'planning' } as unknown as Phase;
  const mk = (withProfile: boolean): Asset => ({
    id: 'a1', phaseId: 'p1', name: 'Tower', type: 'Residential', strategy: 'Sell', visible: true,
    gfaSqm: 10000, buaSqm: 10000, sellableBuaSqm: 10000,
    revenue: { sell: {
      assetId: 'a1',
      subUnits: [{ subUnitId: 'su1', preSalesVelocityByPhase: [1.0, 0, 0, 0], postSalesVelocityByPhase: [], preSalesVelocity: [], postSalesVelocity: [] }],
      ...(withProfile
        ? { cashPaymentProfile: { percentages: [], profileMode: 'absolute_with_catchup', percentagesByPhase: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1] } }
        : {}),
      recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
      indexation: { method: 'none' },
    } },
  } as unknown as Asset);
  const subUnit: SubUnit = { id: 'su1', assetId: 'a1', name: 'Apartments', category: 'Sellable', metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_000_000 } as unknown as SubUnit;
  const run = (withProfile: boolean): number[] => {
    const res = computeAllSellResults({ project, phases: [phase], assets: [mk(withProfile)], subUnits: [subUnit] });
    return res.bySellAsset.get('a1')?.cashCollectedPerPeriod ?? [];
  };
  const without = run(false);
  const withIt = run(true);

  // THE POINT: a saved project carrying the deprecated schedule must compute
  // IDENTICALLY to one without it. Deprecated means "kept so no saved data is
  // destroyed", and a field that is kept but half-read is worse than one that
  // is deleted, because the model quietly depends on it.
  check('G1: a deprecated cashPaymentProfile changes NOTHING, period for period',
    without.length === withIt.length && without.every((v, i) => Math.abs(v - (withIt[i] ?? 0)) < 1),
    `without=${without.map((v) => Math.round(v / 1e6)).join(',')} with=${withIt.map((v) => Math.round(v / 1e6)).join(',')}`);
  assertNear('G2: and the contract is fully collected either way', withIt.reduce((s, v) => s + v, 0), 100_000_000, 100);
}


console.log('\n[H] expandPhaseLocalToAxis legacy fills byPhase tail');
{
  // Axis = 5 (project 2026..2030). byPhase has only 3 entries.
  // Legacy carries the missing tail (year 2029, year 2030).
  const v = expandPhaseLocalToAxis([0.5, 0.6, 0.7], [0.5, 0.6, 0.7, 0.8, 0.9], 0, 5);
  assertEq('H1: byPhase covers idx 0-2, legacy fills idx 3-4', v, [0.5, 0.6, 0.7, 0.8, 0.9]);
  // Phase offset case: byPhase covers axis idx 2-4, legacy fills 0-1.
  const v2 = expandPhaseLocalToAxis([0.1, 0.2, 0.3], [0.7, 0.8, 0.9, 0.0, 0.0], 2, 5);
  assertEq('H2: phaseOffset=2 + byPhase covers idx 2-4', v2, [0.7, 0.8, 0.1, 0.2, 0.3]);
}

console.log(`\n--- Phase-date preservation: ${pass} pass / ${fail} fail / ${pass + fail} total ---`);
if (fail > 0) {
  console.error('\nFAILURES:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
