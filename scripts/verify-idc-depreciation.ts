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

function runFacility(idcConfig: Project['idcConfig']): ReturnType<typeof computeFacilitySchedule> {
  const f = makeFixture(idcConfig);
  const axis = buildProjectAxis(f.project, f.phases);
  return computeFacilitySchedule(f.tranche, f.project, f.phases, axis, f.debtPerPeriod, 100);
}

console.log('\n[G] Capitalize × Funding mode quadrants (single 1000 draw at t=0, 10% annual)');
{
  // Cap=Y, Fund=Debt (default): interest grows debt and goes to asset basis.
  const r1 = runFacility({ capitalize: true, fundingMode: 'debt_drawdown' });
  // Construction periods 0..2 (3 years). With straight-line repay starting at
  // t=3, balance grows by interest during 0..2 then amortises.
  // t=0: bal opens at 0, draw 1000 → bal=1000, interest=100, IDC adds → bal=1100.
  assertNear('G1a Cap=Y Fund=Debt: interestCapitalized[0]', r1.interestCapitalized[0], 100);
  assertNear('G1b Cap=Y Fund=Debt: interestForAssetBasis[0]', r1.interestForAssetBasis[0], 100);
  assertNear('G1c Cap=Y Fund=Debt: interestPaid[0] = 0', r1.interestPaid[0], 0);
  assertNear('G1d Cap=Y Fund=Debt: outstanding[0] = 1100', r1.outstanding[0], 1100);
  assertNear('G1e Cap=Y Fund=Debt: interestDuringConstruction[0] = 100', r1.interestDuringConstruction[0], 100);

  // Cap=Y, Fund=Cash: interest goes to asset basis, paid in cash, balance unchanged.
  const r2 = runFacility({ capitalize: true, fundingMode: 'cash' });
  assertNear('G2a Cap=Y Fund=Cash: interestCapitalized[0] = 0', r2.interestCapitalized[0], 0);
  assertNear('G2b Cap=Y Fund=Cash: interestForAssetBasis[0] = 100', r2.interestForAssetBasis[0], 100);
  assertNear('G2c Cap=Y Fund=Cash: interestPaid[0] = 100', r2.interestPaid[0], 100);
  assertNear('G2d Cap=Y Fund=Cash: outstanding[0] = 1000 (no debt growth)', r2.outstanding[0], 1000);

  // Cap=N, Fund=Debt: interest hits P&L (interestForAssetBasis=0), balance grows.
  const r3 = runFacility({ capitalize: false, fundingMode: 'debt_drawdown' });
  assertNear('G3a Cap=N Fund=Debt: interestCapitalized[0] = 100', r3.interestCapitalized[0], 100);
  assertNear('G3b Cap=N Fund=Debt: interestForAssetBasis[0] = 0', r3.interestForAssetBasis[0], 0);
  assertNear('G3c Cap=N Fund=Debt: interestPaid[0] = 0 (no cash out)', r3.interestPaid[0], 0);
  assertNear('G3d Cap=N Fund=Debt: outstanding[0] = 1100 (debt still grows)', r3.outstanding[0], 1100);
  assertNear('G3e Cap=N Fund=Debt: interestDuringConstruction[0] = 100', r3.interestDuringConstruction[0], 100);

  // Cap=N, Fund=Cash: interest hits P&L, paid in cash, balance unchanged.
  const r4 = runFacility({ capitalize: false, fundingMode: 'cash' });
  assertNear('G4a Cap=N Fund=Cash: interestCapitalized[0] = 0', r4.interestCapitalized[0], 0);
  assertNear('G4b Cap=N Fund=Cash: interestForAssetBasis[0] = 0', r4.interestForAssetBasis[0], 0);
  assertNear('G4c Cap=N Fund=Cash: interestPaid[0] = 100', r4.interestPaid[0], 100);
  assertNear('G4d Cap=N Fund=Cash: outstanding[0] = 1000', r4.outstanding[0], 1000);

  // Identity per period: accrued = capitalized + paid (no double-count).
  for (const [name, r] of [['G5a Cap=Y/Debt', r1], ['G5b Cap=Y/Cash', r2], ['G5c Cap=N/Debt', r3], ['G5d Cap=N/Cash', r4]] as const) {
    for (let t = 0; t < r.interestAccrued.length; t++) {
      const sum = (r.interestCapitalized[t] ?? 0) + (r.interestPaid[t] ?? 0);
      assertNear(`${name}: interestAccrued[${t}] = capitalized + paid`, r.interestAccrued[t], sum);
    }
  }
}

console.log('\n[H] combineDebtService: totalInterestExpensed = accrued − forAssetBasis');
{
  // Build a combined snapshot for each quadrant and verify the aggregated
  // P&L identity. Construction-window interest at t=0 for Cap=Y must
  // produce 0 P&L expense (everything sits on asset basis); for Cap=N it
  // must produce the full interest as P&L expense regardless of funding.
  const axis = buildProjectAxis(makeFixture({}).project, makeFixture({}).phases);
  for (const [name, cfg, expExpensedT0] of [
    ['H1 Cap=Y Fund=Debt', { capitalize: true, fundingMode: 'debt_drawdown' as const }, 0],
    ['H2 Cap=Y Fund=Cash', { capitalize: true, fundingMode: 'cash' as const }, 0],
    ['H3 Cap=N Fund=Debt', { capitalize: false, fundingMode: 'debt_drawdown' as const }, 100],
    ['H4 Cap=N Fund=Cash', { capitalize: false, fundingMode: 'cash' as const }, 100],
  ] as const) {
    const r = runFacility(cfg);
    const facMap = new Map([[r.trancheId, r]]);
    const f = makeFixture(cfg);
    const combined = combineDebtService(facMap, axis, [f.tranche]);
    assertNear(`${name}: totalInterestExpensed[0]`, combined.totalInterestExpensed[0], expExpensedT0);
    // Sanity: accrual identity holds, expensed = accrued − forAssetBasis.
    for (let t = 0; t < axis.totalPeriods; t++) {
      const acc = combined.totalInterestAccrued[t] ?? 0;
      const ab = combined.totalInterestForAssetBasis[t] ?? 0;
      const exp = combined.totalInterestExpensed[t] ?? 0;
      assertNear(`${name}: accrued − assetBasis = expensed at t=${t}`, acc - ab, exp);
    }
  }
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
// J: Conditional IDC (2026-06-02). fundingMode = 'conditional' pays
// construction interest in cash up to the per-period surplus-cash budget
// (remainingIdcBudget), capitalising the shortfall to debt. Interest is
// still routed to the asset basis. Uses the same 1000-draw, 10% fixture
// (interest = 100 at t=0).
//   J1: full budget (>=100) => all paid in cash, debt does NOT grow.
//   J2: partial budget (40) => 40 cash, 60 capitalised; debt grows 60.
//   J3: zero/absent budget => behaves like debt_drawdown (all capitalised).
//   J4: identity capitalized + cashPaid = forAssetBasis (during construction).
//   J5: budget is decremented (consumed) by the cash paid.
//   J6: combineDebtService surfaces totalInterestCapitalizedCashPaid and
//       totalInterestCapitalized + ...CashPaid = totalInterestForAssetBasis.
// ──────────────────────────────────────────────────────────────────
console.log('\n[J] Conditional IDC: cash up to budget, capitalise shortfall');
{
  const runWithBudget = (budget: number[]) => {
    const f = makeFixture({ capitalize: true, fundingMode: 'conditional' });
    const axis = buildProjectAxis(f.project, f.phases);
    const remaining = budget.slice();
    const r = computeFacilitySchedule(f.tranche, f.project, f.phases, axis, f.debtPerPeriod, 100, remaining);
    return { r, remaining, tranche: f.tranche, axis };
  };

  // J1: full budget at t=0 (interest=100).
  {
    const { r } = runWithBudget([100, 0, 0, 0, 0, 0, 0, 0]);
    assertNear('J1a full budget: interestPaid[0] = 100 (cash)', r.interestPaid[0], 100);
    assertNear('J1b full budget: interestCapitalized[0] = 0 (no debt growth)', r.interestCapitalized[0], 0);
    assertNear('J1c full budget: interestCapitalizedCashPaid[0] = 100', r.interestCapitalizedCashPaid[0], 100);
    assertNear('J1d full budget: interestForAssetBasis[0] = 100 (asset still built)', r.interestForAssetBasis[0], 100);
    assertNear('J1e full budget: outstanding[0] = 1000 (no IDC drawdown)', r.outstanding[0], 1000);
  }

  // J2: partial budget (40) at t=0.
  {
    const { r } = runWithBudget([40, 0, 0, 0, 0, 0, 0, 0]);
    assertNear('J2a partial: interestPaid[0] = 40 (cash)', r.interestPaid[0], 40);
    assertNear('J2b partial: interestCapitalized[0] = 60 (debt)', r.interestCapitalized[0], 60);
    assertNear('J2c partial: interestCapitalizedCashPaid[0] = 40', r.interestCapitalizedCashPaid[0], 40);
    assertNear('J2d partial: interestForAssetBasis[0] = 100', r.interestForAssetBasis[0], 100);
    assertNear('J2e partial: outstanding[0] = 1060 (1000 + 60 IDC)', r.outstanding[0], 1060);
  }

  // J3: zero budget => same as debt_drawdown.
  {
    const { r } = runWithBudget([0, 0, 0, 0, 0, 0, 0, 0]);
    assertNear('J3a zero budget: interestCapitalized[0] = 100 (all debt)', r.interestCapitalized[0], 100);
    assertNear('J3b zero budget: interestPaid[0] = 0', r.interestPaid[0], 0);
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
