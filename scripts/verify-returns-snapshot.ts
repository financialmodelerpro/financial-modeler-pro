/* eslint-disable no-console */
/**
 * verify-returns-snapshot.ts
 *
 * Integration test: builds a real M4 financials snapshot (hotel + cost
 * lines + senior debt + dividends) and checks computeReturnsSnapshot wires
 * the three streams, terminal value, config, and RE metrics correctly.
 *
 * Run: npx tsx scripts/verify-returns-snapshot.ts
 */
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot, resolveReturnsConfig } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { terminalEnterpriseValue } from '../src/core/calculations/returns';
import { makeDefaultPhase, makeDefaultProject, makeDefaultCostLines, makeDefaultFinancingTranche } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}
const near = (a: number, b: number, tol = 1e-2) => Math.abs(a - b) <= tol || Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1) <= 1e-6;

function buildState(returns?: any): any {
  const project: any = makeDefaultProject();
  project.startDate = '2026-01-01';
  project.operatingAr = { dsoDays: 30, daysPerYear: 365 };
  project.tax = { rate: 0.15 };
  if (returns) project.returns = returns;
  // A phase paying dividends so the dividend stream is non-trivial.
  const p1: any = { ...makeDefaultPhase(), id: 'p1', name: 'P1', startDate: '2026-01-01', constructionPeriods: 2, operationsPeriods: 8, overlapPeriods: 0,
    dividendPolicy: { enabled: true, priority: 'before_sweep', startingYear: 2029, payoutRatio: 0.5, mode: 'cash_above_min' } };
  const hotel: any = {
    id: 'H1', phaseId: 'p1', name: 'Hotel', type: '', strategy: 'Operate', visible: true,
    gfaSqm: 0, buaSqm: 30000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 20,
    revenue: { operate: { assetId: 'H1', daysPerYear: 365, startingADR: 900, adrIndexation: { method: 'yoy_compound', rate: 0.03 }, occupancyPerPeriodByPhase: Array(11).fill(0.75), guestsPerOccupiedRoom: 1.5, fb: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(11).fill(0), indexation: { method: 'none' } }, otherRevenue: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(11).fill(0), indexation: { method: 'none' } } } },
    opex: { defaultIndexation: { method: 'yoy_compound', rate: 0.03 }, lines: [{ id: 'o1', name: 'Rooms cost', category: 'direct_rooms', mode: 'fixed_baseline', value: 12_000_000, indexation: { method: 'yoy_compound', rate: 0.03 }, useAssetDefault: true, rateMode: 'single' }] },
  };
  const su: any = { id: 'su1', assetId: 'H1', name: 'Keys', category: 'Operable', metric: 'units', metricValue: 200, unitArea: 0, unitPrice: 900, startingAdr: 900 };
  const cl = makeDefaultCostLines('p1', 2);
  const parcel: any = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };
  const tr = makeDefaultFinancingTranche('t1', 'p1');
  return { project, phases: [p1], assets: [hotel], subUnits: [su], parcels: [parcel], costLines: cl, costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [tr], equityContributions: [] };
}

console.log('=== M5 Returns snapshot integration ===');

// ── Config resolution + defaults ──────────────────────────────────────
{
  const snap = computeFinancialsSnapshot(buildState());
  const cfg = resolveReturnsConfig(buildState().project, snap.axisLength);
  check('default discountRate = 10%', near(cfg.discountRate, 0.10));
  check('default terminalMethod = exit_multiple', cfg.terminalMethod === 'exit_multiple');
  check('default exitMultiple = 8', cfg.exitMultiple === 8);
  check('default exit = last axis year', cfg.exitYearOffset === snap.axisLength - 1);
}

// ── Stream construction + terminal value ──────────────────────────────
{
  const state = buildState();
  const snap = computeFinancialsSnapshot(state);
  const rs = computeReturnsSnapshot(snap, state.project);
  const N = snap.axisLength;
  const exit = rs.config.exitYearOffset;

  // Sponsor-IRR view: streams lead with an inception period (index 0), so
  // length is exit + 2 (inception + axis 0..exit). Axis index t -> stream
  // index t+1; exit -> stream index exit+1.
  const xi = exit + 1; // exit position within the inception-prefixed stream
  check('streams length = exit + 2 (inception + axis)', rs.fcffPerPeriod.length === exit + 2 && rs.fcfePerPeriod.length === exit + 2 && rs.dividendStreamPerPeriod.length === exit + 2);
  check('streamYearLabels[0] = inception (projectStartYear - 1)', rs.streamYearLabels[0] === snap.projectStartYear - 1);

  // Terminal EV = stabilised NOI x 8 (exit_multiple default).
  check('terminal EV = stabilisedNOI x exitMultiple', near(rs.terminalEnterpriseValue, rs.stabilisedNOI * 8), `tv=${rs.terminalEnterpriseValue} noi=${rs.stabilisedNOI}`);
  check('stabilised NOI > 0 (hotel produces income)', rs.stabilisedNOI > 0);

  // FCFF at exit = CFO + CFI (no in-kind) + terminal EV.
  const preExitFcff = (snap.directCF.cashFromOperationsPerPeriod[exit] ?? 0) + (snap.directCF.cashFromInvestmentPerPeriod[exit] ?? 0);
  check('FCFF[exit] = CFO + CFI + terminal EV (no in-kind)', near(rs.fcffPerPeriod[xi], preExitFcff + rs.terminalEnterpriseValue));

  // FCFE at exit includes terminal equity value.
  check('terminal equity value = EV - debt + cash (>=0)', rs.terminalEquityValue >= 0);
  check('FCFE[exit] includes terminal equity', rs.fcfePerPeriod[xi] > rs.fcfePerPeriod[xi - 1] || rs.terminalEquityValue === 0);

  // First construction axis year (stream index 1) is cash-negative (capex out).
  check('FCFF first axis year is negative (capex outflow)', rs.fcffPerPeriod[1] < 0);

  // Engine results present + sane.
  check('FCFF IRR computed (number or null)', rs.result.fcff.irr === null || Number.isFinite(rs.result.fcff.irr));
  check('FCFF MOIC > 0', rs.result.fcff.moic > 0);
  check('equity multiple >= 0', rs.result.realEstate.equityMultiple >= 0);
  check('yieldOnCost present', rs.result.realEstate.yieldOnCost !== null && rs.result.realEstate.yieldOnCost! > 0);
  check('cap rate at exit = 1/multiple', rs.result.realEstate.capRateAtExit !== null && near(rs.result.realEstate.capRateAtExit!, rs.exitNOI / rs.terminalEnterpriseValue, 1e-4));
  check('dscr series length = N', rs.result.realEstate.dscrPerPeriod.length === N);
  check('LTV at exit in [0,2]', rs.result.realEstate.ltvAtExit === null || (rs.result.realEstate.ltvAtExit! >= 0 && rs.result.realEstate.ltvAtExit! < 2));
  check('total development cost > 0', rs.totalDevelopmentCost > 0);

  // ── Build-up identities: components must reconstruct each stream ─────
  // (sponsor-IRR component set, including the inception lines)
  const bld = rs.buildup;
  const len = rs.fcffPerPeriod.length;
  check('buildup arrays length = exit + 2', bld.cfoPerPeriod.length === len && bld.existingPreCapexPerPeriod.length === len);
  let fcffOk = true, fcfeOk = true, divOk = true;
  for (let t = 0; t < len; t++) {
    const fcffSum = bld.existingPreCapexPerPeriod[t] + bld.cfoPerPeriod[t] + bld.cfiPerPeriod[t] + bld.terminalEnterprisePerPeriod[t];
    if (Math.abs(fcffSum - rs.fcffPerPeriod[t]) > 0.01) fcffOk = false;
    const fcfeSum = bld.existingPreCapexPerPeriod[t] + bld.existingDebtOpeningPerPeriod[t]
      + bld.cfoPerPeriod[t] + bld.cfiPerPeriod[t] + bld.inKindLandPerPeriod[t]
      + bld.debtDrawPerPeriod[t] + bld.principalRepayPerPeriod[t] + bld.interestPaidPerPeriod[t] + bld.terminalEquityPerPeriod[t];
    if (Math.abs(fcfeSum - rs.fcfePerPeriod[t]) > 0.01) fcfeOk = false;
    const divSum = bld.existingEquityPerPeriod[t] + bld.equityCashPerPeriod[t] + bld.equityInKindPerPeriod[t] + bld.dividendsDistributedPerPeriod[t] + bld.terminalEquityPerPeriod[t];
    if (Math.abs(divSum - rs.dividendStreamPerPeriod[t]) > 0.01) divOk = false;
  }
  check('FCFF build-up components sum to FCFF every period', fcffOk);
  check('FCFE build-up components sum to FCFE every period', fcfeOk);
  check('Dividend build-up components sum to the dividend stream every period', divOk);
  check('dividends distributed flow into Returns (>= 0, present)', bld.dividendsDistributedPerPeriod.every((v) => v >= 0) && rs.totalDividendsDistributed >= 0);
}

// ── Config overrides flow through ─────────────────────────────────────
{
  const state = buildState({ discountRate: 0.15, exitMultiple: 10, terminalMethod: 'exit_multiple' });
  const snap = computeFinancialsSnapshot(state);
  const rs = computeReturnsSnapshot(snap, state.project);
  check('override discountRate = 15%', near(rs.config.discountRate, 0.15));
  check('override exitMultiple = 10 reflected in TV', near(rs.terminalEnterpriseValue, rs.stabilisedNOI * 10));
  check('discount rate flows into NPV discount', near(rs.result.fcff.discountRate, 0.15));
}

// ── Terminal method: none + perpetuity ────────────────────────────────
{
  const stateNone = buildState({ terminalMethod: 'none' });
  const snapNone = computeFinancialsSnapshot(stateNone);
  const rsNone = computeReturnsSnapshot(snapNone, stateNone.project);
  check('terminalMethod none => TV = 0', rsNone.terminalEnterpriseValue === 0 && rsNone.terminalEquityValue === 0);

  const stateP = buildState({ terminalMethod: 'perpetuity', perpetuityGrowth: 0.02, discountRate: 0.10 });
  const snapP = computeFinancialsSnapshot(stateP);
  const rsP = computeReturnsSnapshot(snapP, stateP.project);
  const exit = rsP.config.exitYearOffset;
  const exitFcff = (snapP.directCF.cashFromOperationsPerPeriod[exit] ?? 0) + (snapP.directCF.cashFromInvestmentPerPeriod[exit] ?? 0);
  const expectedTv = terminalEnterpriseValue({ method: 'perpetuity', exitMetric: exitFcff, perpetuityGrowth: 0.02, discountRate: 0.10 });
  check('perpetuity TV = exitFCFF x (1+g)/(r-g)', near(rsP.terminalEnterpriseValue, expectedTv), `got ${rsP.terminalEnterpriseValue} exp ${expectedTv}`);
}

// ── Sponsor-IRR / project-inception view (2026-06-02) ─────────────────
// Existing operations at inception (t=0 = projectStartYear − 1), in-kind
// land on FCFE only, and the per-period FCFE = FCFF + financing bridge.
{
  const project: any = makeDefaultProject();
  project.startDate = '2026-01-01';
  project.tax = { rate: 0.15 };
  // Existing operational phase: pre-capex 3,682,051 funded by 2,400,000
  // existing debt + 1,282,051 existing equity.
  const existingPreCapex = 3_682_051, existingDebtOpening = 2_400_000;
  const existingEquity = existingPreCapex - existingDebtOpening; // 1,282,051
  const pOps: any = { ...makeDefaultPhase(), id: 'pOps', name: 'Existing', startDate: '2026-01-01', status: 'operational', constructionPeriods: 0, operationsPeriods: 10, overlapPeriods: 0 };
  const hotel: any = {
    id: 'H1', phaseId: 'pOps', name: 'Existing Hotel', type: '', strategy: 'Operate', visible: true,
    gfaSqm: 0, buaSqm: 20000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 20,
    historicalPreCapex: existingPreCapex, historicalEquityAmount: existingEquity,
    revenue: { operate: { assetId: 'H1', daysPerYear: 365, startingADR: 700, adrIndexation: { method: 'none' }, occupancyPerPeriodByPhase: Array(11).fill(0.7), guestsPerOccupiedRoom: 1.5, fb: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(11).fill(0), indexation: { method: 'none' } }, otherRevenue: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(11).fill(0), indexation: { method: 'none' } } } },
    opex: { defaultIndexation: { method: 'none' }, lines: [{ id: 'o1', name: 'Rooms cost', category: 'direct_rooms', mode: 'fixed_baseline', value: 5_000_000, indexation: { method: 'none' }, useAssetDefault: true, rateMode: 'single' }] },
  };
  const suOps: any = { id: 'suOps', assetId: 'H1', name: 'Keys', category: 'Operable', metric: 'units', metricValue: 120, unitArea: 0, unitPrice: 700, startingAdr: 700 };
  const exTranche: any = { ...makeDefaultFinancingTranche('exDebt', 'pOps'), origin: 'existing', openingBalance: existingDebtOpening, originationYear: 2025, interestRatePct: 5, interbankRatePct: 0, creditSpreadPct: 5, repaymentMethod: 'straight_line', repaymentPeriods: 20 };
  // New development phase with an in-kind land parcel.
  const pDev: any = { ...makeDefaultPhase(), id: 'pDev', name: 'New Dev', startDate: '2027-01-01', status: 'planning', constructionPeriods: 2, operationsPeriods: 6, overlapPeriods: 0 };
  const sell: any = { id: 'S1', phaseId: 'pDev', name: 'Tower', type: '', strategy: 'Sell', visible: true, gfaSqm: 30000, buaSqm: 30000, sellableBuaSqm: 30000, parkingBaysRequired: 0,
    revenue: { sell: { assetId: 'S1', subUnits: [{ subUnitId: 'suS', preSalesVelocity: [], postSalesVelocity: [], preSalesVelocityByPhase: [0.5, 0.5, 0, 0, 0, 0, 0, 0], postSalesVelocityByPhase: [] }], cashPaymentProfile: { percentages: [], profileMode: 'relative_to_sale', percentagesByPhase: [1], positionsByPhase: [0] }, recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' }, indexation: { method: 'none' } } } };
  const suS: any = { id: 'suS', assetId: 'S1', name: '2BR', category: 'Sellable', metric: 'area', metricValue: 30000, unitPrice: 4000 };
  // Parcel contributed 100% in-kind to the dev phase.
  const inKindParcel: any = { id: 'pclK', phaseId: 'pDev', name: 'Donated Plot', area: 10000, rate: 135.0682, cashPct: 0, inKindPct: 100 };
  const devTranche = makeDefaultFinancingTranche('devDebt', 'pDev');
  const state: any = { project, phases: [pOps, pDev], assets: [hotel, sell], subUnits: [suOps, suS], parcels: [inKindParcel], costLines: makeDefaultCostLines('pDev', 2), costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [exTranche, devTranche], equityContributions: [] };

  const snap = computeFinancialsSnapshot(state);
  const rs = computeReturnsSnapshot(snap, state.project);
  const b = rs.buildup;

  // 2025 FCFF = -(existing pre-capex).
  check('SPONSOR: FCFF inception = -(existing pre-capex)', near(rs.fcffPerPeriod[0], -existingPreCapex), `got ${rs.fcffPerPeriod[0]} exp ${-existingPreCapex}`);
  // 2025 FCFE = -(existing equity) = FCFF inception + existing debt opening.
  check('SPONSOR: FCFE inception = -(existing equity)', near(rs.fcfePerPeriod[0], -existingEquity), `got ${rs.fcfePerPeriod[0]} exp ${-existingEquity}`);
  check('SPONSOR: FCFE inception = FCFF inception + existing debt opening', near(rs.fcfePerPeriod[0], rs.fcffPerPeriod[0] + existingDebtOpening));
  check('SPONSOR: dividend inception = -(existing equity)', near(rs.dividendStreamPerPeriod[0], -existingEquity));

  // In-kind land appears on FCFE (build-up), NOT on FCFF.
  const inKindTotal = b.inKindLandPerPeriod.reduce((s, v) => s + v, 0);
  check('SPONSOR: in-kind land contribution present on FCFE (negative)', inKindTotal < 0, `inKindTotal=${inKindTotal}`);
  // FCFF reconstructs WITHOUT any in-kind term (existingPreCapex + cfo + cfi + terminalEV).
  let fcffNoInKind = true;
  for (let t = 0; t < rs.fcffPerPeriod.length; t++) {
    const sum = b.existingPreCapexPerPeriod[t] + b.cfoPerPeriod[t] + b.cfiPerPeriod[t] + b.terminalEnterprisePerPeriod[t];
    if (Math.abs(sum - rs.fcffPerPeriod[t]) > 0.01) fcffNoInKind = false;
  }
  check('SPONSOR: FCFF excludes in-kind land (reconstructs without it)', fcffNoInKind);

  // Per-period bridge: FCFE - FCFF = existing debt opening + debt draw
  //   + principal + interest + in-kind land (neg) + (terminalEquity - terminalEV).
  let bridgeOk = true;
  for (let t = 0; t < rs.fcffPerPeriod.length; t++) {
    const bridge = b.existingDebtOpeningPerPeriod[t] + b.debtDrawPerPeriod[t] + b.principalRepayPerPeriod[t]
      + b.interestPaidPerPeriod[t] + b.inKindLandPerPeriod[t]
      + (b.terminalEquityPerPeriod[t] - b.terminalEnterprisePerPeriod[t]);
    if (Math.abs((rs.fcfePerPeriod[t] - rs.fcffPerPeriod[t]) - bridge) > 0.01) bridgeOk = false;
  }
  check('SPONSOR: per-period bridge FCFE = FCFF + financing + in-kind + terminal-equity adj', bridgeOk);

  // Existing equity is in the equity IRR stream, so it is finite (not infinite).
  check('SPONSOR: FCFE IRR finite or null (equity actually invested)', rs.result.fcfe.irr === null || Number.isFinite(rs.result.fcfe.irr));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(fail > 0 ? 1 : 0);
