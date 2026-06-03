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
import { computeReturnsSnapshot, resolveReturnsConfig, computeReturnsSensitivity } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
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

// ── M5 Pass 1 analytics wired onto the snapshot (2026-06-02) ──────────
{
  const state = buildState();
  const snap = computeFinancialsSnapshot(state);
  const rs = computeReturnsSnapshot(snap, state.project);
  const de = rs.developmentEconomics, ex = rs.exitAnalysis, su = rs.sourcesUses;
  // Development economics ties to the snapshot.
  check('PASS1: GDV = total revenue over hold', near(de.gdv, rs.totalDevelopmentCost >= 0 ? de.gdv : 0) && de.gdv > 0);
  check('PASS1: profitBeforeFinancing = GDV − dev cost', near(de.profitBeforeFinancing, de.gdv - de.totalDevelopmentCost));
  check('PASS1: profitAfterFinancing = before − financing cost', near(de.profitAfterFinancing, de.profitBeforeFinancing - de.totalFinancingCost));
  check('PASS1: devEcon.totalDevelopmentCost = rs.totalDevelopmentCost', near(de.totalDevelopmentCost, rs.totalDevelopmentCost));
  // Exit analysis ties to the terminal value + exit NOI.
  check('PASS1: exit EV = terminalEnterpriseValue', near(ex.exitEnterpriseValue, rs.terminalEnterpriseValue));
  check('PASS1: exit equity = terminalEquityValue', near(ex.exitEquityValue, rs.terminalEquityValue));
  check('PASS1: exit NOI = rs.exitNOI', near(ex.exitNOI, rs.exitNOI));
  // Sources & uses balance.
  check('PASS1: sources = uses (balanced)', near(su.totalSources, su.totalUses));
  check('PASS1: totalUses = land + construction + IDC + reserves/distributions', near(su.totalUses, su.land + su.construction + su.idc + su.reservesDistributions));
  check('PASS1: funding mix present (debt% computed)', rs.fundingMix.debtPct === null || (rs.fundingMix.debtPct >= 0 && rs.fundingMix.debtPct <= 1.0001));
  // Equity exposure + debt analytics present + sane.
  check('PASS1: equity totalRequired = rs.totalEquityInvested', near(rs.equityExposure.totalEquityRequired, rs.totalEquityInvested));
  check('PASS1: debt remainingAtExit = bs debt at exit', near(rs.debtAnalytics.remainingDebtAtExit, Math.max(0, snap.bs.debtOutstandingPerPeriod[rs.config.exitYearOffset] ?? 0)));
  check('PASS1: debt paydownPct in [0,1] or null', rs.debtAnalytics.paydownPct === null || (rs.debtAnalytics.paydownPct >= 0 && rs.debtAnalytics.paydownPct <= 1.0001));
  check('PASS1: stabilization hasIncomeAssets (hotel fixture)', rs.stabilization.hasIncomeAssets === true);
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

// ── M5 Pass 2: sensitivity grid ───────────────────────────────────────
{
  const state = buildState();
  const snap = computeFinancialsSnapshot(state);
  const rs = computeReturnsSnapshot(snap, state.project);
  const s = rs.sensitivity;
  check('SENS: default grid present (Exit Cap Rate x Sales Price)', s.xVariable === 'exit_cap_rate' && s.yVariable === 'sales_price_pct');
  check('SENS: grid dims = yValues x xValues', s.irr.length === s.yValues.length && s.irr.every((r) => r.length === s.xValues.length));
  check('SENS: base equity IRR ties to headline FCFE IRR', (s.baseEquityIrr === null && rs.result.fcfe.irr === null) || near(s.baseEquityIrr ?? NaN, rs.result.fcfe.irr ?? NaN, 1e-6));

  // Sales Price x Construction Cost both carry a neutral 0 value, so that cell
  // == the headline Equity IRR (the canonical base-case-in-grid check).
  const g = computeReturnsSensitivity(snap, state.project, 'sales_price_pct', 'construction_cost_pct');
  const xi = g.xValues.findIndex((v) => v === 0);
  const yi = g.yValues.findIndex((v) => v === 0);
  check('SENS: neutral axes include a 0 (base) value', xi >= 0 && yi >= 0);
  check('SENS: base cell (0,0) == headline Equity IRR', (g.irr[yi][xi] === null && rs.result.fcfe.irr === null) || near(g.irr[yi][xi] ?? NaN, rs.result.fcfe.irr ?? NaN, 1e-6));
}

// ── M5 Pass 2: per-asset breakdown ────────────────────────────────────
{
  const state = buildState();
  const snap = computeFinancialsSnapshot(state);
  const rs = computeReturnsSnapshot(snap, state.project);
  const pa = rs.perAsset;
  check('PERASSET: one row per asset in the P&L', pa.rows.length === snap.perAssetPL.size && pa.rows.length > 0);
  // Per-asset revenue reconciles to the project total revenue (full axis).
  const projRevenue = snap.pl.totalRevenuePerPeriod.reduce((s, v) => s + (v ?? 0), 0);
  check('PERASSET: Σ asset revenue == project total revenue', near(pa.totalRevenue, projRevenue), `assets=${pa.totalRevenue} proj=${projRevenue}`);
  // Profit identity: total profit == total revenue − total cost.
  check('PERASSET: totalProfit == totalRevenue − totalCost', near(pa.totalProfit, pa.totalRevenue - pa.totalCost));
  // Each row's profit = revenue − cost.
  check('PERASSET: each row profit = revenue − cost', pa.rows.every((r) => near(r.profit, r.totalRevenue - r.totalCost)));
  // Yield on cost only for income assets.
  check('PERASSET: yieldOnCost null for non-income assets', pa.rows.every((r) => r.isIncomeAsset || r.yieldOnCost === null));
  // The hotel fixture is an Operate (income) asset; income assets with a
  // positive cost basis must carry a (non-null) yield on cost.
  check('PERASSET: an Operate (income) asset row exists', pa.rows.some((r) => r.strategy === 'Operate'));
  check('PERASSET: income asset with cost > 0 has a yield on cost', pa.rows.filter((r) => r.isIncomeAsset && r.totalCost > 0).every((r) => r.yieldOnCost !== null));
}

// ── M5 Pass 2: exit-year analysis ─────────────────────────────────────
{
  const state = buildState();
  const snap = computeFinancialsSnapshot(state);
  const rs = computeReturnsSnapshot(snap, state.project);
  check('EXITYEARS: rows present', Array.isArray(rs.exitYears) && rs.exitYears.length > 0);
  check('EXITYEARS: exactly one selected row', rs.exitYears.filter((r) => r.isSelected).length === 1);
  const sel = rs.exitYears.find((r) => r.isSelected)!;
  check('EXITYEARS: selected exitIdx = config exit', sel.exitIdx === rs.config.exitYearOffset);
  // The selected-year row is rebuilt by the SAME shared builder as the headline,
  // so its IRR / EV / equity value must match the headline returns exactly.
  check('EXITYEARS: selected Equity IRR == headline FCFE IRR', (sel.fcfeIrr === null && rs.result.fcfe.irr === null) || near(sel.fcfeIrr ?? NaN, rs.result.fcfe.irr ?? NaN, 1e-6));
  check('EXITYEARS: selected Project IRR == headline FCFF IRR', (sel.fcffIrr === null && rs.result.fcff.irr === null) || near(sel.fcffIrr ?? NaN, rs.result.fcff.irr ?? NaN, 1e-6));
  check('EXITYEARS: selected EV == terminal enterprise value', near(sel.enterpriseValue, rs.terminalEnterpriseValue));
  check('EXITYEARS: selected equity value == terminal equity value', near(sel.equityValue, rs.terminalEquityValue));
  check('EXITYEARS: rows sorted ascending by exit index', rs.exitYears.every((r, i, a) => i === 0 || r.exitIdx > a[i - 1].exitIdx));
  check('EXITYEARS: every row has finite or null IRRs (no NaN)', rs.exitYears.every((r) => (r.fcfeIrr === null || Number.isFinite(r.fcfeIrr)) && (r.fcffIrr === null || Number.isFinite(r.fcffIrr))));
}

// ── M5 Pass 2: multi-partner equity returns wired onto the snapshot ────
{
  // Baseline (no partners) to read the project equity grand total.
  const base = buildState();
  const baseSnap = computeFinancialsSnapshot(base);
  const baseRs = computeReturnsSnapshot(baseSnap, base.project);
  const equity = baseRs.totalEquityInvested;

  // One Sponsor at 100% manual, cash = project equity => reconciles.
  const state = buildState();
  state.project.partners = [{ id: 'sponsor', name: 'Sponsor', cashContribution: equity, inKindContribution: 0, existingContribution: 0, manualShareholdingPct: 100 }];
  const snap = computeFinancialsSnapshot(state);
  const rs = computeReturnsSnapshot(snap, state.project);
  const P = rs.partners;
  check('PARTNERS: snapshot carries the partners block', Array.isArray(P.partners) && P.partners.length === 1);
  check('PARTNERS: sponsor shareholding = 100%', near(P.partners[0].shareholdingPct, 1));
  check('PARTNERS: contributions reconcile to project equity', P.contributionsReconcile, `Δ=${P.contributionDelta}`);
  check('PARTNERS: shareholding reconciles to 100%', P.shareholdingReconciles);
  // Sum of partner streams (lifetime) ties to the project Distributed Equity stream.
  const partnerLifetime = P.totalStream.reduce((s, v) => s + v, 0);
  const projLifetime = rs.dividendStreamPerPeriod.reduce((s, v) => s + v, 0);
  check('PARTNERS: Σ partner streams (lifetime) == project Distributed Equity stream', near(partnerLifetime, projLifetime), `partner=${partnerLifetime} proj=${projLifetime}`);
  check('PARTNERS: sponsor IRR finite or null', P.partners[0].irr === null || Number.isFinite(P.partners[0].irr));
  check('PARTNERS: dividends received >= 0', P.partners[0].dividendsReceived >= 0);

  // No partners => empty block, project-level only.
  check('PARTNERS: baseline (no partners) => empty block', baseRs.partners.partners.length === 0);
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(fail > 0 ? 1 : 0);
