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

  check('streams truncated to exit+1 length', rs.fcffPerPeriod.length === exit + 1 && rs.fcfePerPeriod.length === exit + 1 && rs.dividendStreamPerPeriod.length === exit + 1);

  // Terminal EV = stabilised NOI x 8 (exit_multiple default).
  check('terminal EV = stabilisedNOI x exitMultiple', near(rs.terminalEnterpriseValue, rs.stabilisedNOI * 8), `tv=${rs.terminalEnterpriseValue} noi=${rs.stabilisedNOI}`);
  check('stabilised NOI > 0 (hotel produces income)', rs.stabilisedNOI > 0);

  // FCFF at exit = pre-exit FCFF + terminal EV.
  const preExitFcff = (snap.directCF.cashFromOperationsPerPeriod[exit] ?? 0) + (snap.directCF.cashFromInvestmentPerPeriod[exit] ?? 0) - (snap.directCF.equityInKindDrawdownPerPeriod[exit] ?? 0);
  check('FCFF[exit] = pre-exit FCFF + terminal EV', near(rs.fcffPerPeriod[exit], preExitFcff + rs.terminalEnterpriseValue));

  // FCFE at exit includes terminal equity value.
  check('terminal equity value = EV - debt + cash (>=0)', rs.terminalEquityValue >= 0);
  check('FCFE[exit] includes terminal equity', rs.fcfePerPeriod[exit] > rs.fcfePerPeriod[exit - 1] || rs.terminalEquityValue === 0);

  // Construction years are cash-negative for all three streams (capex/equity out).
  check('FCFF year 0 is negative (capex outflow)', rs.fcffPerPeriod[0] < 0);
  check('dividend stream year 0 is negative (equity in)', rs.dividendStreamPerPeriod[0] <= 0);

  // Engine results present + sane.
  check('FCFF IRR computed (number or null)', rs.result.fcff.irr === null || Number.isFinite(rs.result.fcff.irr));
  check('FCFF MOIC > 0', rs.result.fcff.moic > 0);
  check('equity multiple >= 0', rs.result.realEstate.equityMultiple >= 0);
  check('yieldOnCost present', rs.result.realEstate.yieldOnCost !== null && rs.result.realEstate.yieldOnCost! > 0);
  check('cap rate at exit = 1/multiple', rs.result.realEstate.capRateAtExit !== null && near(rs.result.realEstate.capRateAtExit!, rs.exitNOI / rs.terminalEnterpriseValue, 1e-4));
  check('dscr series length = N', rs.result.realEstate.dscrPerPeriod.length === N);
  check('LTV at exit in [0,2]', rs.result.realEstate.ltvAtExit === null || (rs.result.realEstate.ltvAtExit! >= 0 && rs.result.realEstate.ltvAtExit! < 2));
  check('total development cost > 0', rs.totalDevelopmentCost > 0);
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
  const exitFcff = (snapP.directCF.cashFromOperationsPerPeriod[exit] ?? 0) + (snapP.directCF.cashFromInvestmentPerPeriod[exit] ?? 0) - (snapP.directCF.equityInKindDrawdownPerPeriod[exit] ?? 0);
  const expectedTv = terminalEnterpriseValue({ method: 'perpetuity', exitMetric: exitFcff, perpetuityGrowth: 0.02, discountRate: 0.10 });
  check('perpetuity TV = exitFCFF x (1+g)/(r-g)', near(rsP.terminalEnterpriseValue, expectedTv), `got ${rsP.terminalEnterpriseValue} exp ${expectedTv}`);
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(fail > 0 ? 1 : 0);
