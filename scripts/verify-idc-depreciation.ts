/**
 * M4 Pass 2M-C2 (2026-05-20): IDC depreciation on Operate/Lease.
 *
 * The composer feeds capitalised IDC interest into computeAssetFixedAssets
 * as a per-period addition stream so the IDC amounts depreciate over the
 * asset's useful life. This verifier exercises that surface with
 * deterministic fixtures.
 *
 * Sections:
 *   A: Single-period IDC addition, straight-line useful life
 *   B: Multi-period IDC additions (construction window)
 *   C: IDC addition + opening NBV vintage interact correctly
 *   D: Wash identity: sum(depreciation) = sum(additions) when run long
 *   E: Reducing-balance IDC depreciation
 *   F: startIdx defers depreciation for early additions
 */

import { computeAssetFixedAssets } from '@/src/core/calculations/depreciation';

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

console.log('=== M4 Pass 2M-C2 IDC depreciation verifier ===');

// ──────────────────────────────────────────────────────────────────
// A: Single-period IDC addition
// ──────────────────────────────────────────────────────────────────
console.log('\n[A] Single-period IDC addition, straight-line 10y');
{
  const additions = [0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = computeAssetFixedAssets({
    assetId: 'A',
    axisLength: 11,
    startIdx: 0,
    additionsPerPeriod: additions,
    usefulLifeYears: 10,
  });
  assertNear('A1: depreciation[1] = 100 / 10 = 10', r.depreciationPerPeriod[1], 10);
  assertNear('A2: depreciation[10] = 10', r.depreciationPerPeriod[10], 10);
  assertNear('A3: closing NBV[10] = 0 (fully depreciated)', r.closingNBVPerPeriod[10], 0);
  assertNear('A4: sum(depreciation) = 100', r.depreciationPerPeriod.reduce((s, v) => s + v, 0), 100);
}

// ──────────────────────────────────────────────────────────────────
// B: Multi-period IDC additions during construction
// ──────────────────────────────────────────────────────────────────
console.log('\n[B] Multi-period IDC additions during construction');
{
  // IDC pattern: 3-year construction with capitalised interest
  const additions = [0, 50, 60, 70, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = computeAssetFixedAssets({
    assetId: 'A',
    axisLength: 13,
    startIdx: 0,
    additionsPerPeriod: additions,
    usefulLifeYears: 10,
  });
  // Year 1: 50 over 10y = 5/yr starting year 1
  // Year 2: 60 over 10y = 6/yr starting year 2; total = 5 + 6 = 11
  // Year 3: 70 over 10y = 7/yr starting year 3; total = 5 + 6 + 7 = 18
  assertNear('B1: dep[1] = 5 (50/10)', r.depreciationPerPeriod[1], 5);
  assertNear('B2: dep[2] = 11 (5 + 6)', r.depreciationPerPeriod[2], 11);
  assertNear('B3: dep[3] = 18 (5 + 6 + 7)', r.depreciationPerPeriod[3], 18);
  assertNear('B4: dep[4] = 18 (same three vintages still active)', r.depreciationPerPeriod[4], 18);
  assertNear('B5: cum dep at end approximately = total additions', r.depreciationPerPeriod.reduce((s, v) => s + v, 0), 180);
}

// ──────────────────────────────────────────────────────────────────
// C: IDC addition layered on opening NBV
// ──────────────────────────────────────────────────────────────────
console.log('\n[C] Opening NBV + IDC additions');
{
  // Existing asset with 200 NBV over 5y remaining + new IDC 100 at year 1
  const additions = [0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = computeAssetFixedAssets({
    assetId: 'A',
    axisLength: 12,
    startIdx: 0,
    additionsPerPeriod: additions,
    usefulLifeYears: 10,
    openingNBV: 200,
    openingRemainingLife: 5,
  });
  // Year 0: 200 / 5 = 40 (opening NBV vintage)
  assertNear('C1: dep[0] = 40 (opening NBV over 5y)', r.depreciationPerPeriod[0], 40);
  // Year 1: 40 (opening) + 10 (new 100 over 10y) = 50
  assertNear('C2: dep[1] = 50 (opening 40 + new 10)', r.depreciationPerPeriod[1], 50);
  // Year 5: opening NBV fully depreciated, new vintage still depreciating at 10/yr
  assertNear('C3: dep[5] = 10 (opening done; new vintage only)', r.depreciationPerPeriod[5], 10);
  // Wash: sum(depreciation) = 200 + 100 (opening + addition) once both fully depreciated.
  assertNear('C4: closing NBV[10] = 0 (opening 5y + new 10y both done by year 10)', r.closingNBVPerPeriod[10], 0);
}

// ──────────────────────────────────────────────────────────────────
// D: Wash identity over a sufficiently long axis
// ──────────────────────────────────────────────────────────────────
console.log('\n[D] Wash identity: sum(dep) = sum(additions) when axis fully covers all vintages');
{
  const additions = [0, 30, 40, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = computeAssetFixedAssets({
    assetId: 'A',
    axisLength: 14,
    startIdx: 0,
    additionsPerPeriod: additions,
    usefulLifeYears: 10,
  });
  const totalAdditions = additions.reduce((s, v) => s + v, 0);
  const totalDep = r.depreciationPerPeriod.reduce((s, v) => s + v, 0);
  assertNear('D1: sum(dep) = sum(additions)', totalDep, totalAdditions);
}

// ──────────────────────────────────────────────────────────────────
// E: Reducing-balance method
// ──────────────────────────────────────────────────────────────────
console.log('\n[E] Reducing-balance IDC depreciation');
{
  const additions = [0, 100, 0, 0, 0];
  const r = computeAssetFixedAssets({
    assetId: 'A',
    axisLength: 5,
    startIdx: 0,
    additionsPerPeriod: additions,
    usefulLifeYears: 10,
    method: 'reducing_balance',
    reducingBalanceRate: 0.20,
  });
  // Year 1: 100 × 20% = 20
  // Year 2: 80 × 20% = 16
  // Year 3: 64 × 20% = 12.8
  // Year 4: 51.2 × 20% = 10.24
  assertNear('E1: dep[1] = 20', r.depreciationPerPeriod[1], 20);
  assertNear('E2: dep[2] = 16', r.depreciationPerPeriod[2], 16);
  assertNear('E3: dep[3] = 12.8', r.depreciationPerPeriod[3], 12.8);
  assertNear('E4: closing NBV[4] = 100 - cumulative dep', r.closingNBVPerPeriod[4], 100 - 20 - 16 - 12.8 - 10.24);
}

// ──────────────────────────────────────────────────────────────────
// F: startIdx defers early additions
// ──────────────────────────────────────────────────────────────────
console.log('\n[F] startIdx defers depreciation for early additions');
{
  // Addition at t=1, but startIdx = 3 → depreciation begins at year 3.
  const additions = [0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = computeAssetFixedAssets({
    assetId: 'A',
    axisLength: 13,
    startIdx: 3,
    additionsPerPeriod: additions,
    usefulLifeYears: 10,
  });
  assertNear('F1: dep[1] = 0 (deferred)', r.depreciationPerPeriod[1], 0);
  assertNear('F2: dep[2] = 0 (still deferred)', r.depreciationPerPeriod[2], 0);
  assertNear('F3: dep[3] = 10 (starts at startIdx)', r.depreciationPerPeriod[3], 10);
  assertNear('F4: dep[12] = 10 (last full year)', r.depreciationPerPeriod[12], 10);
}

// ──────────────────────────────────────────────────────────────────
// G + H: M4 Pass 2O (2026-05-24), capitalize toggle + funding mode
// ──────────────────────────────────────────────────────────────────
import { computeFacilitySchedule, combineDebtService } from '@/src/core/calculations/financing/schedule';
import { buildProjectAxis } from '@/src/core/calculations/financing/axis';
import type { Project, Phase, FinancingTranche } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

function makeFixture(idcConfig: Project['idcConfig']): {
  project: Project;
  phases: Phase[];
  tranche: FinancingTranche;
  debtPerPeriod: number[];
} {
  const project = {
    name: 'IDC Test',
    currency: 'SAR',
    modelType: 'annual' as const,
    startDate: '2025-01-01',
    status: 'planning' as const,
    location: '',
    residentialDeductPct: 0,
    residentialEfficiency: 0,
    hospitalityDeductPct: 0,
    hospitalityEfficiency: 0,
    retailDeductPct: 0,
    retailEfficiency: 0,
    residentialCosts: [],
    hospitalityCosts: [],
    retailCosts: [],
    nextCostId: 1,
    interestRate: 0,
    financingMode: 'global' as const,
    globalDebtPct: 70,
    capitalizeInterest: true,
    repaymentPeriods: 0,
    repaymentMethod: 'manual' as const,
    lineRatios: {},
    idcConfig,
  } as unknown as Project;
  const phases: Phase[] = [{
    id: 'ph1',
    name: 'P1',
    constructionStart: 1,
    constructionPeriods: 3,
    operationsPeriods: 5,
    overlapPeriods: 0,
    startDate: '2025-01-01',
    status: 'planning',
  } as unknown as Phase];
  const tranche: FinancingTranche = {
    id: 'tr1',
    name: 'NewDebt',
    origin: 'new',
    phaseId: 'ph1',
    interestRatePct: 10,
    repaymentPeriods: 5,
    repaymentMethod: 'straight_line',
    capexAllocationPct: 100,
  } as unknown as FinancingTranche;
  // 1000 of debt drawn evenly over construction periods 0..2.
  const debtPerPeriod = [1000, 0, 0, 0, 0, 0, 0, 0];
  return { project, phases, tranche, debtPerPeriod };
}

/** Run the fixture facility.
 *
 *  `constructionSpend` IS THE ARGUMENT THAT DECIDES WHETHER THERE IS ANY IDC
 *  AT ALL (2026-08-18), and it is the 9th parameter. This helper used to pass
 *  six, so `constructionSpendByPeriod` was undefined, `constructionRunning`
 *  was false in every period, and no IDC classification fired anywhere in
 *  sections G, H or J. Twenty-four checks failed for that one reason and
 *  several others PASSED for it, asserting a zero the engine produced because
 *  it had been told nothing was being built. Pass it explicitly, always.
 */
function runFacility(
  idcConfig: Project['idcConfig'],
  constructionSpend: number[] = CONSTRUCTION_SPEND,
  budget?: number[],
): ReturnType<typeof computeFacilitySchedule> {
  const f = makeFixture(idcConfig);
  const axis = buildProjectAxis(f.project, f.phases);
  return computeFacilitySchedule(
    f.tranche, f.project, f.phases, axis, f.debtPerPeriod, 100, budget, undefined, constructionSpend,
  );
}

/** Construction runs in periods 0..2, matching the fixture's 3 construction
 *  periods. Spend, not a date window, is what makes a period an IDC period. */
const CONSTRUCTION_SPEND = [500, 500, 500, 0, 0, 0, 0, 0];
const NO_CONSTRUCTION = [0, 0, 0, 0, 0, 0, 0, 0];

console.log('\n[G] ONE IDC treatment: construction SPEND decides, not a flag (1000 draw at t=0, 10%)');
{
  // THE QUADRANTS ARE GONE. `idcConfig.capitalize` and `idcConfig.fundingMode`
  // were retired on 2026-08-18: there is one treatment, so two projects cannot
  // behave differently. Sections G and H used to assert four different
  // behaviours across those two flags. What is pinned now is the ONE rule, plus
  // the fact that the retired flags are inert.
  const r = runFacility({ capitalize: true, fundingMode: 'debt_drawdown' });

  // t=0: draw 1000, interest 100, construction is running, so the whole charge
  // is IDC and lands on the asset basis.
  assertNear('G1a interest during construction goes to the asset basis', r.interestForAssetBasis[0], 100);
  assertNear('G1b and is reported as interest during construction', r.interestDuringConstruction[0], 100);
  assertNear('G1c the FULL charge is paid in the period it arises', r.interestPaid[0], 100);
  // No IDC cash budget was supplied, so every currency unit of it is funded by
  // a drawdown, which is what grows the balance.
  assertNear('G1d with no IDC cash budget the whole charge is funded by drawdown', r.interestCapitalized[0], 100);
  assertNear('G1e and the balance grows by exactly that drawdown', r.outstanding[0], 1100);

  // NO SPEND, NO IDC. The same facility in a period with nothing being built
  // carries an ordinary operating finance cost.
  const idle = runFacility({ capitalize: true, fundingMode: 'debt_drawdown' }, NO_CONSTRUCTION);
  assertNear('G2a a period with no construction spend books NO asset-basis interest', idle.interestForAssetBasis[0], 0);
  assertNear('G2b and no interest during construction', idle.interestDuringConstruction[0], 0);
  assertNear('G2c the charge is still accrued', idle.interestAccrued[0], 100);
  assertNear('G2d and still paid', idle.interestPaid[0], 100);
  assertNear('G2e nothing is drawn to fund it, so the balance is unchanged', idle.outstanding[0], 1000);

  // OMITTING the argument must behave exactly like no spend. This is what the
  // old six-argument call was silently doing, and nothing said so.
  const omitted = (() => {
    const f = makeFixture({ capitalize: true, fundingMode: 'debt_drawdown' });
    const axis = buildProjectAxis(f.project, f.phases);
    return computeFacilitySchedule(f.tranche, f.project, f.phases, axis, f.debtPerPeriod, 100);
  })();
  assertNear('G3 omitting constructionSpendByPeriod is the same as no construction', omitted.interestForAssetBasis[0], 0);

  // THE RETIRED FLAGS ARE INERT. If either is ever read again, these fail.
  const quadrants = [
    ['Cap=Y Fund=Debt', { capitalize: true, fundingMode: 'debt_drawdown' as const }],
    ['Cap=Y Fund=Cash', { capitalize: true, fundingMode: 'cash' as const }],
    ['Cap=N Fund=Debt', { capitalize: false, fundingMode: 'debt_drawdown' as const }],
    ['Cap=N Fund=Cash', { capitalize: false, fundingMode: 'cash' as const }],
  ] as const;
  for (const [name, cfg] of quadrants) {
    const q = runFacility(cfg);
    for (const [field, series] of [
      ['interestForAssetBasis', q.interestForAssetBasis],
      ['interestCapitalized', q.interestCapitalized],
      ['interestPaid', q.interestPaid],
      ['outstanding', q.outstanding],
    ] as const) {
      const base = (r as unknown as Record<string, number[]>)[field];
      assertNear(`G4 ${name}: ${field}[0] is identical (capitalize / fundingMode are RETIRED)`, series[0] ?? 0, base[0] ?? 0);
    }
  }

  // THE PER-PERIOD IDENTITY, restated for the current engine.
  //
  // It used to read `accrued = capitalized + paid`, which was true only while a
  // capitalised charge was one that never got paid. Since 2026-08-18c the full
  // charge is paid every period and the capitalised figure is the DRAWDOWN that
  // funds the part cash could not, so that sum double-counts. The identity that
  // holds now is that the funding splits the charge: what came from the cash
  // budget plus what was drawn equals the charge routed to the asset basis.
  for (const [name, rr] of [['G5a with construction', r], ['G5b idle', idle]] as const) {
    for (let t = 0; t < rr.interestAccrued.length; t++) {
      assertNear(`${name}: paid[${t}] = accrued (the full charge settles each period)`,
        rr.interestPaid[t] ?? 0, rr.interestAccrued[t] ?? 0);
      const funded = (rr.interestCapitalized[t] ?? 0) + (rr.interestCapitalizedCashPaid[t] ?? 0);
      assertNear(`${name}: drawn + fromCash = asset basis at t=${t}`, funded, rr.interestForAssetBasis[t] ?? 0);
    }
  }
}

console.log('\n[H] combineDebtService: totalInterestExpensed = accrued − forAssetBasis');
{
  // ONE treatment, so there is one expected answer, not four. During
  // construction the whole charge sits on the asset basis and the P&L line is
  // 0; outside construction the whole charge is an operating finance cost.
  const axis = buildProjectAxis(makeFixture({}).project, makeFixture({}).phases);
  for (const [name, spend, expExpensedT0] of [
    ['H1 construction running', CONSTRUCTION_SPEND, 0],
    ['H2 no construction', NO_CONSTRUCTION, 100],
  ] as const) {
    const r = runFacility({ capitalize: true, fundingMode: 'debt_drawdown' }, spend);
    const facMap = new Map([[r.trancheId, r]]);
    const f = makeFixture({ capitalize: true, fundingMode: 'debt_drawdown' });
    const combined = combineDebtService(facMap, axis, [f.tranche]);
    assertNear(`${name}: totalInterestExpensed[0]`, combined.totalInterestExpensed[0], expExpensedT0);
    // The identity itself, every period.
    for (let t = 0; t < axis.totalPeriods; t++) {
      const acc = combined.totalInterestAccrued[t] ?? 0;
      const ab = combined.totalInterestForAssetBasis[t] ?? 0;
      const exp = combined.totalInterestExpensed[t] ?? 0;
      assertNear(`${name}: accrued − assetBasis = expensed at t=${t}`, acc - ab, exp);
    }
  }
  // And the retired flags cannot change the P&L either.
  const capN = runFacility({ capitalize: false, fundingMode: 'cash' });
  const capY = runFacility({ capitalize: true, fundingMode: 'debt_drawdown' });
  const f0 = makeFixture({});
  const expN = combineDebtService(new Map([[capN.trancheId, capN]]), axis, [f0.tranche]).totalInterestExpensed[0];
  const expY = combineDebtService(new Map([[capY.trancheId, capY]]), axis, [f0.tranche]).totalInterestExpensed[0];
  assertNear('H3 capitalize=false no longer expenses construction interest (flag RETIRED)', expN, expY);
}

// ──────────────────────────────────────────────────────────────────
// I: M4 Pass 2Q (2026-05-24), integrated FA roll-forward identity
// per-asset Operate/Lease: combined closing NBV = combined opening
//                          + (capex add + IDC add) − combined dep
// where combined opening at t = capexOpening[t] + IDC closing at t-1.
// Engine + composer math should self-prove via the existing G/A-F
// cases plus the additive nature of two parallel SL streams. This
// section pins the integration arithmetic the UI relies on.
// ──────────────────────────────────────────────────────────────────
console.log('\n[I] Pass 2Q: integrated Capex + IDC FA roll-forward identity');
{
  // Build two parallel SL streams (capex + IDC) and confirm:
  //   combinedClosing[t] = combinedOpening[t] + capexAdd[t] + idcAdd[t]
  //                        - capexDep[t] - idcDep[t]
  const N = 6;
  const capexAdditions = [100, 0, 0, 0, 0, 0];
  const idcAdditions = [0, 20, 30, 0, 0, 0];
  const capex = computeAssetFixedAssets({
    assetId: 'cap',
    axisLength: N,
    startIdx: 0,
    additionsPerPeriod: capexAdditions,
    usefulLifeYears: 10,
  });
  const idc = computeAssetFixedAssets({
    assetId: 'idc',
    axisLength: N,
    startIdx: 0,
    additionsPerPeriod: idcAdditions,
    usefulLifeYears: 10,
  });
  for (let t = 0; t < N; t++) {
    const capexOpening = capex.openingNBVPerPeriod[t] ?? 0;
    const idcOpeningPrev = t === 0 ? 0 : (idc.closingNBVPerPeriod[t - 1] ?? 0);
    const combinedOpening = capexOpening + idcOpeningPrev;
    const combinedClosing = (capex.closingNBVPerPeriod[t] ?? 0) + (idc.closingNBVPerPeriod[t] ?? 0);
    const expected = combinedOpening
      + (capexAdditions[t] ?? 0)
      + (idcAdditions[t] ?? 0)
      - (capex.depreciationPerPeriod[t] ?? 0)
      - (idc.depreciationPerPeriod[t] ?? 0);
    assertNear(
      `I[t=${t}]: combinedClosing = combinedOpening + capexAdd + idcAdd − combinedDep`,
      combinedClosing,
      expected,
    );
  }
}

// ──────────────────────────────────────────────────────────────────
// J: The IDC cash budget (2026-06-02, restated 2026-08-31). Construction
// interest is PAID IN FULL in the period it arises; the per-period surplus-cash
// budget (remainingIdcBudget) funds as much of it as it can and debt is drawn
// for the shortfall. Interest is routed to the asset basis either way. Same
// 1000-draw, 10% fixture (interest = 100 at t=0), now with construction spend
// supplied, without which none of this fires at all.
//   J1: full budget (>=100) => wholly funded from cash, debt does NOT grow.
//   J2: partial budget (40)  => 40 from cash, 60 drawn; debt grows 60.
//   J3: zero/absent budget   => the whole charge is funded by drawdown.
//   J4: identity capitalized + cashPaid = forAssetBasis (during construction).
//   J5: budget is decremented (consumed) by the cash it funded.
//   J6: combineDebtService surfaces totalInterestCapitalizedCashPaid and
//       totalInterestCapitalized + ...CashPaid = totalInterestForAssetBasis.
//
// WHAT CHANGED IN THE EXPECTATIONS, and why it is not a regression: this
// section read interestPaid as "the cash slice only", so J2 expected 40 and J3
// expected 0. Since 2026-08-18c the full charge settles every period and the
// capitalised figure is the DRAWDOWN that funds part of it, not a second
// settlement. interestPaid is therefore 100 in all three cases, and the split
// to read is capitalized vs capitalizedCashPaid.
// ──────────────────────────────────────────────────────────────────
console.log('\n[J] Conditional IDC: cash up to budget, capitalise shortfall');
{
  const runWithBudget = (budget: number[]) => {
    const f = makeFixture({ capitalize: true, fundingMode: 'conditional' });
    const axis = buildProjectAxis(f.project, f.phases);
    const remaining = budget.slice();
    const r = computeFacilitySchedule(
      f.tranche, f.project, f.phases, axis, f.debtPerPeriod, 100,
      remaining, undefined, CONSTRUCTION_SPEND,
    );
    return { r, remaining, tranche: f.tranche, axis };
  };

  // J1: full budget at t=0 (interest=100).
  {
    const { r } = runWithBudget([100, 0, 0, 0, 0, 0, 0, 0]);
    assertNear('J1a full budget: interestPaid[0] = 100 (the full charge settles)', r.interestPaid[0], 100);
    assertNear('J1b full budget: interestCapitalized[0] = 0 (nothing drawn)', r.interestCapitalized[0], 0);
    assertNear('J1c full budget: interestCapitalizedCashPaid[0] = 100', r.interestCapitalizedCashPaid[0], 100);
    assertNear('J1d full budget: interestForAssetBasis[0] = 100 (asset still built)', r.interestForAssetBasis[0], 100);
    assertNear('J1e full budget: outstanding[0] = 1000 (no IDC drawdown)', r.outstanding[0], 1000);
  }

  // J2: partial budget (40) at t=0.
  {
    const { r } = runWithBudget([40, 0, 0, 0, 0, 0, 0, 0]);
    // 100 leaves the bank; 40 of it came from the budget and 60 from a drawdown.
    assertNear('J2a partial: interestPaid[0] = 100 (the full charge settles)', r.interestPaid[0], 100);
    assertNear('J2b partial: interestCapitalized[0] = 60 (drawn for the shortfall)', r.interestCapitalized[0], 60);
    assertNear('J2c partial: interestCapitalizedCashPaid[0] = 40', r.interestCapitalizedCashPaid[0], 40);
    assertNear('J2d partial: interestForAssetBasis[0] = 100', r.interestForAssetBasis[0], 100);
    assertNear('J2e partial: outstanding[0] = 1060 (1000 + 60 IDC)', r.outstanding[0], 1060);
  }

  // J3: zero budget => same as debt_drawdown.
  {
    const { r } = runWithBudget([0, 0, 0, 0, 0, 0, 0, 0]);
    assertNear('J3a zero budget: interestCapitalized[0] = 100 (wholly drawn)', r.interestCapitalized[0], 100);
    assertNear('J3b zero budget: interestPaid[0] = 100 (still settles, funded by the drawdown)', r.interestPaid[0], 100);
    assertNear('J3c zero budget: outstanding[0] = 1100', r.outstanding[0], 1100);
  }

  // J4: identity capitalized + cashPaid = forAssetBasis during construction.
  {
    const { r } = runWithBudget([40, 0, 0, 0, 0, 0, 0, 0]);
    for (let t = 0; t < 3; t++) { // construction periods 0..2
      const sum = (r.interestCapitalized[t] ?? 0) + (r.interestCapitalizedCashPaid[t] ?? 0);
      assertNear(`J4[t=${t}]: capitalized + cashPaid = forAssetBasis`, sum, r.interestForAssetBasis[t] ?? 0);
    }
  }

  // J5: budget consumed by the cash paid.
  {
    const { remaining } = runWithBudget([40, 0, 0, 0, 0, 0, 0, 0]);
    assertNear('J5: remaining budget at t=0 decremented to 0', remaining[0], 0);
  }

  // J6: combineDebtService surfaces the cash-paid total + asset-basis identity.
  {
    const { r, tranche, axis } = runWithBudget([40, 0, 0, 0, 0, 0, 0, 0]);
    const combined = combineDebtService(new Map([[r.trancheId, r]]), axis, [tranche]);
    assertNear('J6a combined: totalInterestCapitalizedCashPaid[0] = 40', combined.totalInterestCapitalizedCashPaid[0], 40);
    for (let t = 0; t < 3; t++) {
      const lhs = (combined.totalInterestCapitalized[t] ?? 0) + (combined.totalInterestCapitalizedCashPaid[t] ?? 0);
      assertNear(`J6b[t=${t}]: totalCapitalized + totalCashPaid = totalForAssetBasis`, lhs, combined.totalInterestForAssetBasis[t] ?? 0);
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// K: Annuity repayment books principal = PMT − interest, NOT the whole PMT
// (2026-06-02 audit). Prior bug deducted the level payment (P+I) entirely
// as principal, over-amortizing and closing the loan a period early.
// ──────────────────────────────────────────────────────────────────
console.log('\n[K] Annuity (equal_total) books principal = PMT − interest');
{
  const project = makeFixture({}).project;
  const phases = [{ id: 'ph1', name: 'P1', constructionStart: 1, constructionPeriods: 0, operationsPeriods: 8, overlapPeriods: 0, startDate: '2025-01-01', status: 'operational' } as unknown as Phase];
  const axis = buildProjectAxis(project, phases);
  const tranche = { id: 'an', name: 'Annuity', origin: 'new', phaseId: 'ph1', interestRatePct: 10, repaymentMethod: 'equal_repayment', equalRepaymentSubMethod: 'equal_total', repaymentPeriods: 5, repaymentStartYear: 2026, capexAllocationPct: 100 } as unknown as FinancingTranche;
  const debtPerPeriod = [1000, 0, 0, 0, 0, 0, 0, 0]; // drawn at t=0; repay from 2026 (idx1)
  const r = computeFacilitySchedule(tranche, project, phases, axis, debtPerPeriod, 100);
  const pmt = 1000 * (0.1 * Math.pow(1.1, 5)) / (Math.pow(1.1, 5) - 1); // 263.797
  assertNear('K1 principal[1] = PMT − interest (≈163.8, NOT the full PMT)', r.principalRepaid[1], pmt - 100, 0.5);
  assertNear('K2 outstanding[1] = 1000 − (PMT − 100)', r.outstanding[1], 1000 - (pmt - 100), 0.5);
  assertNear('K3 NOT repaid early: outstanding[4] > 0', r.outstanding[4] > 0 ? 1 : 0, 1);
  assertNear('K4 fully repaid at maturity: outstanding[5] = 0', r.outstanding[5], 0, 1);
  assertNear('K5 total principal repaid = drawn (1000)', r.totalPrincipal, 1000, 1);
  // equal_principal sub-method stays straight-line (principal = 200/yr).
  const slTranche = { ...tranche, equalRepaymentSubMethod: 'equal_principal' } as unknown as FinancingTranche;
  const rsl = computeFacilitySchedule(slTranche, project, phases, axis, debtPerPeriod, 100);
  assertNear('K6 equal_principal principal[1] = 200 (straight-line)', rsl.principalRepaid[1], 200, 0.5);
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
