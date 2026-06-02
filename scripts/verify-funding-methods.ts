/**
 * verify-funding-methods.ts
 *
 * Pins the 2026-06-01 funding-method fix:
 *   - Methods 2 (Net Funding Requirement) + 3 (Cash Deficit Funding) now
 *     CALCULATE from the per-period gap series (no longer stubbed to 0).
 *   - Each method reads its OWN debt / equity ratio (Method 1 fixedRatio,
 *     Method 2 netFundingConfig, Method 3 cashDeficitConfig, Method 4
 *     derived from amounts).
 *   - A selected Method 2 / 3 sizes external funding to its gap via the
 *     custom-curve path (customDebtByPeriod / customEquityByPeriod).
 *   - Method 3 does NOT double-add the minimum cash reserve.
 *   - Backward compatible: no gapInputs => Methods 2 + 3 fall back to 0.
 *
 * Run: npx tsx scripts/verify-funding-methods.ts
 */
import { computeFundingRequirement, type FundingGapInputs } from '../src/core/calculations/financing/funding';
import type { CapexAggregate } from '../src/core/calculations/financing/types';
import type { ProjectFinancingConfig } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { computeFinancialsSnapshot, computeFundingGap } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { makeDefaultPhase, makeDefaultProject, makeDefaultCostLines, makeDefaultFinancingTranche } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}
const approx = (a: number, b: number, tol = 0.001) => Math.abs(a - b) <= tol;

// Minimal 4-period capex fixture: 1000 of non-land capex spread evenly.
const capex: CapexAggregate = {
  totals: { exclAllLand: 1000, exclLandInKind: 1000, inclAllLand: 1000 },
  perPeriod: {
    exclAllLand:    [250, 250, 250, 250],
    exclLandInKind: [250, 250, 250, 250],
    inclAllLand:    [250, 250, 250, 250],
    landCash:       [0, 0, 0, 0],
    landInKind:     [0, 0, 0, 0],
    nonLand:        [250, 250, 250, 250],
  },
};

const gap: FundingGapInputs = {
  // Net Funding Requirement (capex less pre-sales): 600 total.
  method2PerPeriod: [200, 150, 150, 100],
  // Cash Deficit (to maintain min cash): 400 total.
  method3PerPeriod: [100, 100, 120, 80],
};

function cfg(method: 1 | 2 | 3 | 4, extra: Partial<ProjectFinancingConfig> = {}): ProjectFinancingConfig {
  return {
    fundingMethod: method,
    parcelFunding: [],
    viewMode: 'combined',
    ...extra,
  } as ProjectFinancingConfig;
}

// ── Backward compat: no gap inputs => Methods 2 + 3 are 0 ──────────────
{
  const r = computeFundingRequirement(capex, cfg(1));
  check('no gap: method1 = capex total (1000)', approx(r.method1, 1000));
  check('no gap: method2 = 0', approx(r.method2, 0));
  check('no gap: method3 = 0', approx(r.method3, 0));
}

// ── Methods 2 + 3 now calculate from the gap series ───────────────────
{
  const r = computeFundingRequirement(capex, cfg(2, { netFundingConfig: { existingCash: 0, debtPct: 60, equityPct: 40 } }), gap);
  check('method2 total = sum(gap.method2PerPeriod) = 600', approx(r.method2, 600), `got ${r.method2}`);
  check('method3 total = sum(gap.method3PerPeriod) = 400', approx(r.method3, 400), `got ${r.method3}`);
  check('method1 still = capex total (1000)', approx(r.method1, 1000));
}

// ── Method 2 selected WITH gap: GAP-SIZED custom curve at own ratio ───
// Gap-sized drawdown (2026-06-01): when the per-period gap is fed (the
// snapshot's 2nd pass + Module 1), Methods 2/3 size debt/equity to the net
// requirement via the custom path. When NO gap is fed (1st pass / direct),
// they fall back to capex sizing (no custom arrays) so funding is never
// zeroed (the regression). See the "no-gap fallback" block below.
{
  const r = computeFundingRequirement(capex, cfg(2, { netFundingConfig: { existingCash: 0, debtPct: 60, equityPct: 40 } }), gap);
  check('M2 selected: selected = 600 (gap total)', approx(r.selected, 600), `got ${r.selected}`);
  check('M2 selected: debtPct = 60 (netFundingConfig)', approx(r.debtPct, 60), `got ${r.debtPct}`);
  check('M2 selected: equityPct = 40', approx(r.equityPct, 40), `got ${r.equityPct}`);
  check('M2 selected: selectedByPeriod mirrors gap', JSON.stringify(r.selectedByPeriod) === JSON.stringify(gap.method2PerPeriod));
  check('M2 gap-sized: custom debt = gap * 0.6', !!r.customDebtByPeriod && approx(r.customDebtByPeriod[0], 120));
  check('M2 gap-sized: custom equity = gap * 0.4', !!r.customEquityByPeriod && approx(r.customEquityByPeriod[0], 80));
}

// ── Method 3 selected WITH gap: GAP-SIZED, min-cash NOT double-added ──
{
  const r = computeFundingRequirement(
    capex,
    cfg(3, {
      cashDeficitConfig: { initialCash: 0, minimumCashReserve: 0, debtPct: 75, equityPct: 25 },
      minimumCashReserve: 500, // gap already nets min-cash; must NOT add again
    }),
    gap,
  );
  check('M3 selected: selected = 400 (gap total)', approx(r.selected, 400), `got ${r.selected}`);
  check('M3 selected: debtPct = 75 (cashDeficitConfig)', approx(r.debtPct, 75), `got ${r.debtPct}`);
  check('M3 selected: equityPct = 25', approx(r.equityPct, 25), `got ${r.equityPct}`);
  check('M3 gap-sized: custom debt = gap * 0.75', !!r.customDebtByPeriod && approx(r.customDebtByPeriod[0], 75));
  check('M3 gap-sized: custom equity = gap * 0.25', !!r.customEquityByPeriod && approx(r.customEquityByPeriod[0], 25));
  check('M3 gap-sized: min-cash NOT double-added (buffer 0)', r.minCashByPeriod.every((v) => v === 0));
}

// ── No-gap fallback: Methods 2/3 size from capex (snapshot pass 1) ────
// REGRESSION GUARD: no custom arrays without a gap, so debtEquity.ts uses
// the capex split and the statements are never left unfunded.
{
  const r2 = computeFundingRequirement(capex, cfg(2, { netFundingConfig: { existingCash: 0, debtPct: 60, equityPct: 40 }, minimumCashReserve: 500 }));
  const r3 = computeFundingRequirement(capex, cfg(3, { cashDeficitConfig: { initialCash: 0, minimumCashReserve: 0, debtPct: 75, equityPct: 25 }, minimumCashReserve: 500 }));
  check('M2 no-gap: NO custom arrays => capex split draws funding', r2.customDebtByPeriod === undefined && r2.customEquityByPeriod === undefined);
  check('M3 no-gap: NO custom arrays => capex split draws funding', r3.customDebtByPeriod === undefined && r3.customEquityByPeriod === undefined);
  check('M2 no-gap: selectedByPeriod falls back to capex curve', JSON.stringify(r2.selectedByPeriod) === JSON.stringify(capex.perPeriod.exclLandInKind));
  check('M3 no-gap: min-cash buffer placed (capex sizing, sum 500)', approx(r3.minCashByPeriod.reduce((s, v) => s + v, 0), 500));
}

// ── Method 1 still adds the min-cash buffer (regression guard) ─────────
{
  const r = computeFundingRequirement(capex, cfg(1, { fixedRatio: { debtPct: 70, equityPct: 30 }, minimumCashReserve: 500 }), gap);
  check('M1 selected: debtPct = 70 (fixedRatio)', approx(r.debtPct, 70));
  check('M1 selected: min-cash buffer placed (sum 500)', approx(r.minCashByPeriod.reduce((s, v) => s + v, 0), 500));
}

// ── Method 4 unchanged: derived ratio from amounts ────────────────────
{
  const r = computeFundingRequirement(
    capex,
    cfg(4, { fixedAmountConfig: { debtAmount: 800, equityAmount: 200, yoySchedule: [25, 25, 25, 25] } }),
    gap,
  );
  check('M4 selected: selected = debt + equity (1000)', approx(r.selected, 1000), `got ${r.selected}`);
  check('M4 selected: debtPct = 80 (derived)', approx(r.debtPct, 80), `got ${r.debtPct}`);
  check('M4 selected: equityPct = 20 (derived)', approx(r.equityPct, 20), `got ${r.equityPct}`);
}

// ── SNAPSHOT REGRESSION GUARD ─────────────────────────────────────────
// The 2026-06-01 regression: with Method 2 or 3 selected, the Cash Flow
// drew ZERO new debt + equity because computeFinancialsSnapshot does not
// feed the per-period gap, so the (removed) custom-zero arrays zeroed all
// funding. This guard builds a REAL snapshot per method and asserts every
// method draws debt + equity and the BS balances.
function buildSnapState(method: 1 | 2 | 3 | 4): Parameters<typeof computeFinancialsSnapshot>[0] {
  const project = makeDefaultProject();
  project.startDate = '2026-01-01';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (project as any).financing = { ...((project as any).financing ?? {}), fundingMethod: method, parcelFunding: [],
    netFundingConfig: { existingCash: 0, debtPct: 60, equityPct: 40 },
    cashDeficitConfig: { initialCash: 0, minimumCashReserve: 0, debtPct: 75, equityPct: 25 },
    fixedAmountConfig: { debtAmount: 500_000, equityAmount: 300_000, yoySchedule: [50, 50] } };
  const p1 = { ...makeDefaultPhase(), id: 'p1', name: 'P1', startDate: '2026-01-01', constructionPeriods: 2, operationsPeriods: 6, overlapPeriods: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sell: any = { id: 'a1', phaseId: 'p1', name: 'Tower', type: '', strategy: 'Sell', visible: true, gfaSqm: 50000, buaSqm: 50000, sellableBuaSqm: 50000, parkingBaysRequired: 0,
    revenue: { sell: { assetId: 'a1', subUnits: [{ subUnitId: 'su1', preSalesVelocity: [], postSalesVelocity: [], preSalesVelocityByPhase: [0.5, 0.5, 0, 0, 0, 0, 0, 0], postSalesVelocityByPhase: [] }], cashPaymentProfile: { percentages: [], profileMode: 'relative_to_sale', percentagesByPhase: [1], positionsByPhase: [0] }, recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' }, indexation: { method: 'none' } } } };
  const su = { id: 'su1', assetId: 'a1', name: '2BR', category: 'Sellable', metric: 'area', metricValue: 50000, unitPrice: 5000 };
  const parcel = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { project, phases: [p1], assets: [sell], subUnits: [su], parcels: [parcel], costLines: makeDefaultCostLines('p1', 2), costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [makeDefaultFinancingTranche('t1', 'p1')], equityContributions: [] } as any;
}
let m1Funding = 0;
for (const method of [1, 2, 3, 4] as const) {
  const snap = computeFinancialsSnapshot(buildSnapState(method));
  const debt = snap.directCF.debtDrawdownPerPeriod.reduce((s, v) => s + v, 0);
  const equity = snap.directCF.equityDrawdownPerPeriod.reduce((s, v) => s + v, 0);
  const bsMax = Math.max(...snap.bs.bsDifferencePerPeriod.map((v) => Math.abs(v)));
  const cfTie = Math.max(...snap.directCF.closingCashPerPeriod.map((v, i) => Math.abs(v - (snap.indirectCF.closingCashPerPeriod[i] ?? 0))));
  check(`SNAPSHOT Method ${method}: new debt > 0 in Cash Flow`, debt > 0, `debt=${Math.round(debt)}`);
  check(`SNAPSHOT Method ${method}: equity > 0 in Cash Flow`, equity > 0, `equity=${Math.round(equity)}`);
  check(`SNAPSHOT Method ${method}: BS balances`, bsMax < 1, `maxBSdiff=${Math.round(bsMax)}`);
  check(`SNAPSHOT Method ${method}: Direct CF == Indirect CF (2-pass stable)`, cfTie < 1, `tie=${Math.round(cfTie)}`);
  // 2026-06-02 audit: the financing reconcile identity must hold for the
  // gap-sized methods too (it previously expected full capex and raised a
  // false "Debt+CashEquity vs Funding" warning on Methods 2/3).
  check(`SNAPSHOT Method ${method}: financing reconciliation ok`, snap.financing.reconciliation.ok, `issues=${snap.financing.reconciliation.issues.join('; ')}`);
  if (method === 1) m1Funding = debt + equity;
  // Gap-sized drawdown: Methods 2/3 fund the NET requirement, so total
  // funding is <= Method 1 (full capex). (Equal only if the gap = capex.)
  if (method === 2 || method === 3) {
    check(`SNAPSHOT Method ${method}: gap-sized funding <= Method 1 (capex)`, debt + equity <= m1Funding + 1, `m${method}=${Math.round(debt + equity)} m1=${Math.round(m1Funding)}`);
  }
}

// ── CONDITIONAL IDC (2026-06-02): full engine integration ─────────────
// Reuses the capex + new-debt + pre-sales fixture. The pre-sales cash
// collected during construction creates surplus above the minimum cash
// reserve, so under fundingMode='conditional' the construction interest is
// paid in cash (not capitalised to debt) up to that surplus. Pins: the
// statements still balance + tie, debt is lower than the all-capitalised
// case, the IDC split identity holds, and the two-pass (gap-sizing +
// IDC budget) is stable.
function buildIdcState(mode: 'debt_drawdown' | 'conditional', method: 1 | 3 = 1): Parameters<typeof computeFinancialsSnapshot>[0] {
  const s = buildSnapState(method);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (s.project as any).financing.minimumCashReserve = 100_000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (s.project as any).idcConfig = { allocationBasis: 'land', capitalize: true, fundingMode: mode };
  return s;
}
console.log('\n[IDC] Conditional IDC: full engine integration');
{
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const baseline = computeFinancialsSnapshot(buildIdcState('debt_drawdown'));
  const cond = computeFinancialsSnapshot(buildIdcState('conditional'));

  // Non-vacuous: the baseline fixture must actually produce construction IDC.
  const idcBaseline = sum(baseline.financing.combined.totalInterestCapitalized);
  check('IDC: baseline fixture produces construction IDC (non-vacuous)', idcBaseline > 0, `idc=${Math.round(idcBaseline)}`);

  // T3 / T4: statements still balance + tie under conditional IDC.
  const bsMax = Math.max(...cond.bs.bsDifferencePerPeriod.map((v) => Math.abs(v)));
  const cfTie = Math.max(...cond.directCF.closingCashPerPeriod.map((v, i) => Math.abs(v - (cond.indirectCF.closingCashPerPeriod[i] ?? 0))));
  check('IDC conditional: BS balances', bsMax < 1, `maxBSdiff=${Math.round(bsMax)}`);
  check('IDC conditional: Direct CF == Indirect CF (2-pass stable)', cfTie < 1, `tie=${Math.round(cfTie)}`);

  // T6: BS reconciliation bridge exact.
  const reco = Math.max(...cond.bsReconciliation.unexplainedPerPeriod.map((v) => Math.abs(v)));
  check('IDC conditional: BS reconciliation bridge exact', reco < 1, `maxUnexplained=${Math.round(reco)}`);

  // Feature works: some construction interest is paid in cash.
  const cashIdc = sum(cond.financing.combined.totalInterestCapitalizedCashPaid);
  check('IDC conditional: construction interest paid in cash > 0 (surplus diverted)', cashIdc > 0, `cashIdc=${Math.round(cashIdc)}`);

  // T2: debt is lower (paying interest in cash avoids both the IDC drawdown
  // AND the compounding it would cause).
  const debtBase = sum(baseline.bs.debtOutstandingPerPeriod);
  const debtCond = sum(cond.bs.debtOutstandingPerPeriod);
  check('IDC conditional: total debt outstanding <= debt_drawdown', debtCond <= debtBase + 1, `cond=${Math.round(debtCond)} base=${Math.round(debtBase)}`);
  check('IDC conditional: capitalised IDC <= baseline (some paid in cash)', sum(cond.financing.combined.totalInterestCapitalized) <= idcBaseline + 1);

  // T1: per-period identity capitalised + cash-paid = asset-basis interest.
  let identityOk = true;
  for (let t = 0; t < cond.axisLength; t++) {
    const lhs = (cond.financing.combined.totalInterestCapitalized[t] ?? 0) + (cond.financing.combined.totalInterestCapitalizedCashPaid[t] ?? 0);
    if (!approx(lhs, cond.financing.combined.totalInterestForAssetBasis[t] ?? 0, 1)) { identityOk = false; break; }
  }
  check('IDC conditional: capitalised + cash-paid = asset-basis interest (every period)', identityOk);

  // T7: cash-paid IDC never exceeds the construction-window asset-basis interest.
  check('IDC conditional: cash-paid IDC <= total construction interest', cashIdc <= sum(cond.financing.combined.totalInterestForAssetBasis) + 1);

  // Method 3 + conditional IDC together (gap-sizing + IDC budget in one re-run).
  const condM3 = computeFinancialsSnapshot(buildIdcState('conditional', 3));
  const bsMaxM3 = Math.max(...condM3.bs.bsDifferencePerPeriod.map((v) => Math.abs(v)));
  const cfTieM3 = Math.max(...condM3.directCF.closingCashPerPeriod.map((v, i) => Math.abs(v - (condM3.indirectCF.closingCashPerPeriod[i] ?? 0))));
  check('IDC conditional + Method 3: BS balances (combined two-pass)', bsMaxM3 < 1, `maxBSdiff=${Math.round(bsMaxM3)}`);
  check('IDC conditional + Method 3: Direct == Indirect (combined two-pass)', cfTieM3 < 1, `tie=${Math.round(cfTieM3)}`);
}

// ── CONVERGENCE: the iterative solver reaches a FIXED POINT ────────────
// The conditional-IDC / gap-sizing circularity (drawdown -> finance cost ->
// balance -> drawdown) is resolved by iterating to convergence, like Excel
// with iterative calc enabled. This pins that the converged snapshot IS a
// fixed point: re-deriving its own gap + IDC budget and applying one more
// explicit pass reproduces the same debt + closing cash (no drift).
console.log('\n[CONV] Iterative solver converges to a fixed point');
{
  const state = buildIdcState('conditional', 3);
  const snapA = computeFinancialsSnapshot(state);
  const N = snapA.axisLength;
  const gap = computeFundingGap(snapA);
  const w = gap.method3Waterfall;
  const minCash = w.minCashReserve;
  const cap = snapA.financing.combined.totalInterestCapitalized;
  const capCash = snapA.financing.combined.totalInterestCapitalizedCashPaid;
  const budget = Array.from({ length: N }, (_, t) =>
    ((cap[t] ?? 0) + (capCash[t] ?? 0)) > 0
      ? Math.max(0, (w.cashAvailableBeforeNewDebtPerPeriod[t] ?? 0) - minCash)
      : 0);
  const fundingGap: FundingGapInputs = { method2PerPeriod: gap.methodAGapPerPeriod, method3PerPeriod: w.netCashRequiredPerPeriod };
  // One explicit pass with snapA's OWN derived inputs.
  const snapB = computeFinancialsSnapshot(state, { fundingGap, idcCashBudget: budget });
  const debtDelta = Math.max(...snapA.bs.debtOutstandingPerPeriod.map((v, i) => Math.abs(v - (snapB.bs.debtOutstandingPerPeriod[i] ?? 0))));
  const cashDelta = Math.max(...snapA.directCF.closingCashPerPeriod.map((v, i) => Math.abs(v - (snapB.directCF.closingCashPerPeriod[i] ?? 0))));
  const idcDelta = Math.abs(
    snapA.financing.combined.totalInterestCapitalizedCashPaid.reduce((s, v) => s + v, 0)
    - snapB.financing.combined.totalInterestCapitalizedCashPaid.reduce((s, v) => s + v, 0));
  check('CONV: debt outstanding is a fixed point (re-applying derived inputs is stable)', debtDelta < 5, `debtDelta=${Math.round(debtDelta)}`);
  check('CONV: closing cash is a fixed point', cashDelta < 5, `cashDelta=${Math.round(cashDelta)}`);
  check('CONV: cash-paid IDC is a fixed point', idcDelta < 5, `idcDelta=${Math.round(idcDelta)}`);
}

// ── CONDITIONAL IDC: per-period (cash-short years capitalise, surplus years
// pay cash) ───────────────────────────────────────────────────────────
// Pins the user's 2026-06-02 case: with conditional IDC, an EARLY cash-short
// construction year still capitalises IDC to debt, while a LATER construction
// year that has surplus cash above the minimum reserve pays its IDC in cash
// (no drawdown). Sales (and their cash) land in the last construction year,
// so the early years are cash-negative and the last is cash-positive.
console.log('\n[IDC-LATE] Conditional IDC is decided PER PERIOD (capitalise when short, cash when surplus)');
{
  const buildLate = (mode: 'debt_drawdown' | 'conditional'): Parameters<typeof computeFinancialsSnapshot>[0] => {
    const project = makeDefaultProject();
    project.startDate = '2026-01-01';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (project as any).financing = { fundingMethod: 1, parcelFunding: [], fixedRatio: { debtPct: 100, equityPct: 0 }, minimumCashReserve: 50_000 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (project as any).idcConfig = { allocationBasis: 'land', capitalize: true, fundingMode: mode };
    const p1 = { ...makeDefaultPhase(), id: 'p1', name: 'P1', startDate: '2026-01-01', constructionPeriods: 3, operationsPeriods: 6, overlapPeriods: 0 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sell: any = { id: 'a1', phaseId: 'p1', name: 'Tower', type: '', strategy: 'Sell', visible: true, gfaSqm: 50000, buaSqm: 50000, sellableBuaSqm: 50000, parkingBaysRequired: 0,
      revenue: { sell: { assetId: 'a1', subUnits: [{ subUnitId: 'su1', preSalesVelocity: [], postSalesVelocity: [], preSalesVelocityByPhase: [0, 0, 1, 0, 0, 0, 0, 0], postSalesVelocityByPhase: [] }], cashPaymentProfile: { percentages: [], profileMode: 'relative_to_sale', percentagesByPhase: [1], positionsByPhase: [0] }, recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' }, indexation: { method: 'none' } } } };
    const su = { id: 'su1', assetId: 'a1', name: '2BR', category: 'Sellable', metric: 'area', metricValue: 50000, unitPrice: 5000 };
    const parcel = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { project, phases: [p1], assets: [sell], subUnits: [su], parcels: [parcel], costLines: makeDefaultCostLines('p1', 3), costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [makeDefaultFinancingTranche('t1', 'p1')], equityContributions: [] } as any;
  };
  const base = computeFinancialsSnapshot(buildLate('debt_drawdown'));
  const cond = computeFinancialsSnapshot(buildLate('conditional'));
  const capB = base.financing.combined.totalInterestCapitalized;
  const capC = cond.financing.combined.totalInterestCapitalized;
  const cashC = cond.financing.combined.totalInterestCapitalizedCashPaid;
  // Baseline (debt_drawdown): every construction year capitalises, none cash.
  check('IDC-LATE baseline: early construction year capitalises (idx 0)', (capB[0] ?? 0) > 0);
  check('IDC-LATE baseline: late construction year capitalises (idx 2)', (capB[2] ?? 0) > 0);
  // Conditional: cash-short early years STILL capitalise; the surplus late
  // year pays IDC in cash (no drawdown).
  check('IDC-LATE conditional: cash-short early year still capitalises (idx 0)', (capC[0] ?? 0) > 0 && (cashC[0] ?? 0) === 0, `cap0=${Math.round(capC[0] ?? 0)} cash0=${Math.round(cashC[0] ?? 0)}`);
  check('IDC-LATE conditional: surplus late year pays IDC in cash, not debt (idx 2)', (cashC[2] ?? 0) > 0 && (capC[2] ?? 0) < (capB[2] ?? 0), `cash2=${Math.round(cashC[2] ?? 0)} capC2=${Math.round(capC[2] ?? 0)} capB2=${Math.round(capB[2] ?? 0)}`);
  // Whole-project: conditional draws less debt than always-capitalise.
  const debtB = base.bs.debtOutstandingPerPeriod.reduce((s, v) => s + v, 0);
  const debtC = cond.bs.debtOutstandingPerPeriod.reduce((s, v) => s + v, 0);
  check('IDC-LATE conditional: total debt outstanding < always-capitalise', debtC < debtB, `cond=${Math.round(debtC)} base=${Math.round(debtB)}`);
  check('IDC-LATE conditional: BS balances', Math.max(...cond.bs.bsDifferencePerPeriod.map((v) => Math.abs(v))) < 1);
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
