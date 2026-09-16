/* eslint-disable no-console */
/**
 * verify-terminal-disposal.ts (2026-09-14)
 *
 * The exit is a disposal, as the reference model books it:
 *   A  the pure rules: which year is capitalised, and a series written off
 *   B  the statements: proceeds in investing, a gain between interest and zakat,
 *      the held assets at zero from the exit, debt repaid, the balance sheet
 *      and both cash flow methods still closing
 *   C  the settings: zakat on the gain (off by default), the basis, method none
 *   D  Returns: one terminal value, no double count in any stream
 *   E  an exit before the last year
 *   F  the statement rows and the screens
 *
 * Offline: a synthetic hotel project with debt and dividends.
 */
import { readFileSync } from 'node:fs';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { terminalMetricIndex, valueAtExit, writeOffAtExit, stopAfterExit } from '../src/core/calculations/returns/disposal';
import { scheduleWithDisposal, idcWithDisposal, disposalContextOf } from '../src/hubs/modeling/platforms/refm/lib/reports/disposalSchedules';
import { buildDisposalWorking } from '../src/hubs/modeling/platforms/refm/lib/reports/disposalReport';
import { makeDefaultPhase, makeDefaultProject, makeDefaultCostLines, makeDefaultFinancingTranche } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };
const near = (a: number, b: number, tol = 0.01): boolean => Math.abs(a - b) <= tol || Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1) <= 1e-9;
const maxAbs = (a: number[]): number => Math.max(0, ...a.map((v) => Math.abs(v ?? 0)));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildState(returns?: any, tax?: any): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const project: any = makeDefaultProject();
  project.startDate = '2026-01-01';
  project.operatingAr = { dsoDays: 30, daysPerYear: 365 };
  project.tax = { rate: 0.15, ...(tax ?? {}) };
  project.returns = { terminalMethod: 'cap_rate', capRate: 0.08, capRateOverride: true, ...(returns ?? {}) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p1: any = { ...makeDefaultPhase(), id: 'p1', name: 'P1', startDate: '2026-01-01', constructionPeriods: 2, operationsPeriods: 8, overlapPeriods: 0,
    dividendPolicy: { enabled: true, priority: 'before_sweep', startingYear: 2029, payoutRatio: 0.5, mode: 'cash_above_min' } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hotel: any = {
    id: 'H1', phaseId: 'p1', name: 'Hotel', type: '', strategy: 'Operate', visible: true,
    gfaSqm: 0, buaSqm: 30000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 20,
    revenue: { operate: { assetId: 'H1', daysPerYear: 365, startingADR: 900, adrIndexation: { method: 'yoy_compound', rate: 0.03 }, occupancyPerPeriodByPhase: Array(11).fill(0.75), guestsPerOccupiedRoom: 1.5, fb: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(11).fill(0), indexation: { method: 'none' } }, otherRevenue: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(11).fill(0), indexation: { method: 'none' } } } },
    opex: { defaultIndexation: { method: 'yoy_compound', rate: 0.03 }, lines: [{ id: 'o1', name: 'Rooms cost', category: 'direct_rooms', mode: 'fixed_baseline', value: 12_000_000, indexation: { method: 'yoy_compound', rate: 0.03 }, useAssetDefault: true, rateMode: 'single' }] },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const su: any = { id: 'su1', assetId: 'H1', name: 'Keys', category: 'Operable', metric: 'units', metricValue: 200, unitArea: 0, unitPrice: 900, startingAdr: 900 };
  const cl = makeDefaultCostLines('p1', 2);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parcel: any = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };
  const tr = makeDefaultFinancingTranche('t1', 'p1');
  return { project, phases: [p1], assets: [hotel], subUnits: [su], parcels: [parcel], costLines: cl, costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [tr], equityContributions: [] };
}

// ── A ───────────────────────────────────────────────────────────────────────
section('A. the pure rules');
{
  check('A1 prior year capitalises the year before the exit', terminalMetricIndex(9, 'prior_year') === 8 && terminalMetricIndex(9, undefined) === 8);
  check('A2 exit year capitalises the exit year; a first-year exit has no prior year', terminalMetricIndex(9, 'exit_year') === 9 && terminalMetricIndex(0, 'prior_year') === 0);
  const v = valueAtExit({ exitIdx: 3, method: 'cap_rate', capRate: 0.08, noiPerPeriod: [0, 50, 80, 100] });
  check('A3 cap rate on the prior year: 80 / 8% = 1,000', v.metricIdx === 2 && v.exitMetric === 80 && near(v.enterpriseValue, 1000));
  const w = writeOffAtExit([100, 90, 80, 70, 60], [0, 10, 10, 10, 10], 2, 5);
  check('A4 written off at the exit and after it, untouched before it', w.adjustedPerPeriod.join(',') === '100,90,0,0,0' && w.disposedAtExit === 80);
  check('A5 no depreciation is charged after the exit on what was sold', w.depreciationRemovedPerPeriod.join(',') === '0,0,0,10,10');
  const addAfter = writeOffAtExit([100, 90, 80, 120, 110], [0, 10, 10, 10, 10], 2, 5);
  check('A6 an addition after the exit stays on the balance sheet, undepreciated', addAfter.adjustedPerPeriod.join(',') === '100,90,0,50,50', addAfter.adjustedPerPeriod.join(','));
}

// ── B ───────────────────────────────────────────────────────────────────────
section('B. the statements book the disposal');
const state = buildState();
const snap = computeFinancialsSnapshot(state);
const N = snap.axisLength;
const X = snap.disposal.exitIdx;
{
  const d = snap.disposal;
  const nbvEngine = (snap.fixedAssets.projectTotals.depreciable.closingNBVPerPeriod[X] ?? 0)
    + (snap.fixedAssets.projectTotals.land.closingPerPeriod[X] ?? 0) + (snap.idc.idcNbvPerPeriod[X] ?? 0);
  const noi = (t: number): number => (snap.pl.hospitalityRevenuePerPeriod[t] ?? 0) + (snap.pl.retailRevenuePerPeriod[t] ?? 0)
    - (snap.pl.hospitalityOpexPerPeriod[t] ?? 0) - (snap.pl.retailOpexPerPeriod[t] ?? 0);
  check('B1 the disposal is booked at the exit, the last axis year by default', d.booked && X === N - 1);
  check('B2 proceeds = prior year NOI / cap rate', near(d.proceeds, noi(X - 1) / 0.08), `${d.proceeds} vs ${noi(X - 1) / 0.08}`);
  check('B3 the net book value disposed is building + land + capitalised interest at the exit', near(d.netBookValue.total, nbvEngine) && nbvEngine > 0);
  check('B4 gain = proceeds less net book value, on the P&L in the exit year only',
    near(d.gain, d.proceeds - nbvEngine) && near(snap.pl.gainOnDisposalPerPeriod[X], d.gain) && snap.pl.gainOnDisposalPerPeriod.slice(0, X).every((v) => v === 0));
  check('B5 profit before tax carries the gain below interest',
    near(snap.pl.pbtPerPeriod[X], snap.pl.ebitPerPeriod[X] - snap.pl.interestExpensePerPeriod[X] + d.gain));
  check('B6 proceeds sit inside cash from investment in the exit year',
    near(snap.directCF.proceedsFromDisposalPerPeriod[X], d.proceeds)
    && near(snap.directCF.cashFromInvestmentPerPeriod[X], -(snap.financing.capex.perPeriod.exclLandInKind[X] ?? 0) + d.proceeds));
  check('B7 the fixed assets are zero from the exit', maxAbs(snap.bs.totalFixedAssetsPerPeriod.slice(X)) < 0.01, String(snap.bs.totalFixedAssetsPerPeriod[X]));
  check('B8 the fixed assets before the exit are untouched', near(snap.bs.totalFixedAssetsPerPeriod[X - 1],
    (snap.fixedAssets.projectTotals.depreciable.closingNBVPerPeriod[X - 1] ?? 0) + (snap.fixedAssets.projectTotals.land.closingPerPeriod[X - 1] ?? 0) + (snap.idc.idcNbvPerPeriod[X - 1] ?? 0)));
  check('B9 the balance sheet balances every period', maxAbs(snap.bs.bsDifferencePerPeriod) < 0.01, String(maxAbs(snap.bs.bsDifferencePerPeriod)));
  check('B10 every movement is bridged', maxAbs(snap.bsReconciliation.unexplainedPerPeriod) < 0.01, String(maxAbs(snap.bsReconciliation.unexplainedPerPeriod)));
  check('B11 the direct and indirect cash flows close at the same cash every period',
    snap.directCF.closingCashPerPeriod.every((v, t) => near(v, snap.indirectCF.closingCashPerPeriod[t] ?? 0)));
  check('B12 the indirect method backs the non-cash gain out of operations', near(snap.indirectCF.gainOnDisposalPerPeriod[X], -d.gain));
  const debtBefore = [...snap.financing.facilities.values()].reduce((s, f) => s + Math.max(0, f.outstanding[X] ?? 0), 0);
  check('B13 debt outstanding at the exit is repaid out of the proceeds', near(d.debtRepaidPerPeriod[X], debtBefore) && snap.bs.debtOutstandingPerPeriod[X] === 0);
  check('B14 the per-asset split foots to the disposed balance',
    near(d.byAsset.reduce((s, a) => s + a.building + a.land + a.capitalisedInterest, 0), d.netBookValue.total));
}

// ── C ───────────────────────────────────────────────────────────────────────
section('C. the settings');
{
  const d = snap.disposal;
  const excluded = Math.max(0, snap.pl.pbtPerPeriod[X] - d.gain) * 0.15;
  check('C1 by default zakat excludes the gain', !d.gainTaxed && near(snap.pl.taxPerPeriod[X], excluded) && snap.disposal.taxOnGainPerPeriod[X] === 0);
  const taxed = computeFinancialsSnapshot(buildState(undefined, { applyToDisposalGain: true }));
  check('C2 with the setting on, zakat is charged on profit including the gain',
    taxed.disposal.gainTaxed && near(taxed.pl.taxPerPeriod[X], Math.max(0, taxed.pl.pbtPerPeriod[X]) * 0.15)
    && near(taxed.disposal.taxOnGainPerPeriod[X], taxed.pl.taxPerPeriod[X] - Math.max(0, taxed.pl.pbtPerPeriod[X] - taxed.disposal.gain) * 0.15));
  check('C3 the gain itself does not depend on the zakat setting', near(taxed.disposal.gain, d.gain));
  const exitYear = computeFinancialsSnapshot(buildState({ terminalValueBasis: 'exit_year' }));
  const noiX = (exitYear.pl.hospitalityRevenuePerPeriod[X] ?? 0) - (exitYear.pl.hospitalityOpexPerPeriod[X] ?? 0);
  check('C4 the exit-year basis capitalises the exit year', exitYear.disposal.metricIdx === X && near(exitYear.disposal.proceeds, noiX / 0.08));
  const none = computeFinancialsSnapshot(buildState({ terminalMethod: 'none' }));
  check('C5 with no terminal value nothing is sold or written off',
    !none.disposal.booked && none.pl.gainOnDisposalPerPeriod.every((v) => v === 0) && (none.bs.totalFixedAssetsPerPeriod[X] ?? 0) > 0
    && none.directCF.proceedsFromDisposalPerPeriod.every((v) => v === 0));
  check('C6 and its balance sheet still balances', maxAbs(none.bs.bsDifferencePerPeriod) < 0.01);
}

// ── D ───────────────────────────────────────────────────────────────────────
section('D. Returns reads one terminal value and counts it once');
{
  const rs = computeReturnsSnapshot(snap, state.project);
  const xi = X + 1;
  check('D1 the Returns terminal value IS the proceeds booked', near(rs.terminalEnterpriseValue, snap.disposal.proceeds));
  check('D2 stabilised NOI is the income capitalised, so the implied cap rate is the one used',
    near(rs.stabilisedNOI, snap.disposal.exitMetric) && rs.result.realEstate.capRateAtExit !== null && near(rs.result.realEstate.capRateAtExit!, 0.08, 1e-9));
  const cfoX = snap.directCF.cashFromOperationsPerPeriod[X] ?? 0;
  const cfiPre = (snap.directCF.cashFromInvestmentPerPeriod[X] ?? 0) - (snap.directCF.proceedsFromDisposalPerPeriod[X] ?? 0);
  check('D3 FCFF at exit = CFO + capex + terminal value, the proceeds not read twice', near(rs.fcffPerPeriod[xi], cfoX + cfiPre + rs.terminalEnterpriseValue));
  const eqIn = (snap.financing.equity.cashPerPeriod[X] ?? 0) + (snap.financing.equity.inKindPerPeriod[X] ?? 0);
  const divX = snap.dividends.totalDividendsPerPeriod[X] ?? 0;
  check('D4 dividends are on, so the exit payout carries the proceeds and the distributed stream adds nothing on top',
    snap.dividends.enabled && divX >= snap.disposal.proceeds - snap.disposal.debtRepaidPerPeriod[X] - 0.01
    && near(rs.dividendStreamPerPeriod[xi], -eqIn + divX), `stream ${rs.dividendStreamPerPeriod[xi]} vs ${-eqIn + divX}`);
  const exitRow = rs.exitYears.find((r) => r.isSelected);
  check('D5 the exit-year analysis values the selected exit at the same terminal value', !!exitRow && near(exitRow.enterpriseValue, rs.terminalEnterpriseValue));
}

// ── E ───────────────────────────────────────────────────────────────────────
section('E. an exit before the last year');
{
  const early = buildState({ exitYearOffset: 7 });
  const s = computeFinancialsSnapshot(early);
  check('E1 the exit is booked at the chosen year', s.disposal.booked && s.disposal.exitIdx === 7 && s.pl.gainOnDisposalPerPeriod[7] !== 0);
  check('E2 fixed assets are zero from that year to the end', maxAbs(s.bs.totalFixedAssetsPerPeriod.slice(7)) < 0.01);
  const heldDep = (t: number): number => (s.fixedAssets.projectTotals.depreciable.depreciationPerPeriod[t] ?? 0) + (s.idc.idcDepreciationPerPeriod[t] ?? 0);
  check('E3 no depreciation after it on what was sold', s.pl.daPerPeriod.slice(8).every((v, i) => near(v, 0) || heldDep(8 + i) === 0), s.pl.daPerPeriod.slice(8).join(','));
  check('E4 the balance sheet balances and every movement is bridged',
    maxAbs(s.bs.bsDifferencePerPeriod) < 0.01 && maxAbs(s.bsReconciliation.unexplainedPerPeriod) < 0.01);
  check('E5 no debt after the exit', s.bs.debtOutstandingPerPeriod.slice(7).every((v) => v === 0));

  // A SOLD ASSET STOPS TRADING AFTER THE EXIT (2026-09-15, step 7).
  const full = computeFinancialsSnapshot(buildState({ exitYearOffset: 9 }));
  const after = (a: number[]): number => maxAbs(a.slice(8));
  check('E6 no revenue after the exit', after(s.pl.totalRevenuePerPeriod) === 0 && after(s.pl.hospitalityRevenuePerPeriod) === 0, s.pl.totalRevenuePerPeriod.slice(8).join(','));
  check('E7 no opex after the exit', after(s.pl.totalOpexPerPeriod) === 0 && after(s.opex.byAsset.get('H1')!.totalOpexPerPeriod) === 0);
  check('E8 no interest charged or paid after the exit on the debt repaid at it',
    after(s.pl.interestExpensePerPeriod) === 0 && after(s.directCF.interestPaidPerPeriod) === 0 && after(full.pl.interestExpensePerPeriod) > 0);
  check('E9 the asset row depreciates nothing after the exit either', after(s.perAssetPL.get('H1')!.daPerPeriod) === 0);
  check('E10 no profit after the exit', after(s.pl.patPerPeriod) < 0.01, s.pl.patPerPeriod.slice(8).join(','));
  check('E11 the exit year trades in full', near(s.pl.totalRevenuePerPeriod[7], full.pl.totalRevenuePerPeriod[7]) && near(s.pl.totalOpexPerPeriod[7], full.pl.totalOpexPerPeriod[7]));
  check('E12 the direct and indirect cash flows still close at the same cash',
    maxAbs(s.directCF.closingCashPerPeriod.map((c, i) => c - s.indirectCF.closingCashPerPeriod[i])) < 0.01);
  check('E13 a last-year exit is untouched: the series are the engine\'s own', after(full.pl.totalRevenuePerPeriod) > 0);
  // THE FUND STOPS CHARGING AT THE EXIT (2026-09-15).
  const withFund = (st: any): any => ({ ...st, project: { ...st.project, fundTerms: { enabled: true, fundManagementFeePct: 0.02, otherExpensesPerAnnum: 1_500_000 } } });
  const fundEarly = computeFinancialsSnapshot(withFund(buildState({ exitYearOffset: 7 })));
  const fundFull = computeFinancialsSnapshot(withFund(buildState({ exitYearOffset: 9 })));
  check('E16 a fund charges no fee after the exit, on every fee line and in the P&L',
    after(fundEarly.fundFees.totalPerPeriod) === 0 && after(fundEarly.pl.fundFeesPerPeriod) === 0
    && fundEarly.fundFees.lines.every((l) => after(l.amountPerPeriod) === 0), fundEarly.fundFees.totalPerPeriod.join(','));
  check('E17 and charges through the exit year, while a last-year exit charges in every year',
    fundEarly.fundFees.totalPerPeriod[7] > 0 && after(fundFull.fundFees.totalPerPeriod) > 0);
  check('E18 the fund project with an early exit ends with no negative cash from post-exit fees and still balances',
    fundEarly.bs.cashPerPeriod[9] >= fundEarly.bs.cashPerPeriod[7] - 0.01 && maxAbs(fundEarly.bs.bsDifferencePerPeriod) < 0.01,
    `${fundEarly.bs.cashPerPeriod.slice(7).join(',')}`);
  const rsEarly = computeReturnsSnapshot(s, early.project);
  check('E15 the exit-year analysis offers candidates only up to the chosen exit',
    rsEarly.exitYears.length > 0 && rsEarly.exitYears.every((row) => row.exitIdx <= 7) && rsEarly.exitYears.some((row) => row.isSelected && row.exitIdx === 7));
  // THE SCHEDULES SHOW THE DISPOSAL (2026-09-16, step 10).
  const ctx = disposalContextOf(s);
  const fpt = s.fixedAssets.projectTotals;
  const landS = scheduleWithDisposal({ ...fpt.land }, ctx);
  const depS = scheduleWithDisposal({ openingPerPeriod: fpt.depreciable.openingNBVPerPeriod, additionsPerPeriod: fpt.depreciable.additionsPerPeriod, depreciationPerPeriod: fpt.depreciable.depreciationPerPeriod, closingPerPeriod: fpt.depreciable.closingNBVPerPeriod, accumDepPerPeriod: fpt.depreciable.accumDepPerPeriod }, ctx);
  const idcS = idcWithDisposal(s.idc, ctx);
  const foots = (x: { openingPerPeriod: number[]; additionsPerPeriod: number[]; depreciationPerPeriod: number[]; disposalPerPeriod: number[]; closingPerPeriod: number[] }): boolean =>
    x.closingPerPeriod.every((c, t) => near(c, (x.openingPerPeriod[t] ?? 0) + (x.additionsPerPeriod[t] ?? 0) - (x.depreciationPerPeriod[t] ?? 0) - (x.disposalPerPeriod[t] ?? 0)));
  check('E19 every schedule foots: closing = opening + additions - depreciation - disposal', foots(landS) && foots(depS) && foots(idcS));
  check('E20 the disposal is the exit year balance, and only the exit year', landS.disposalPerPeriod.filter((v) => v !== 0).length <= 1 && depS.disposalPerPeriod[7] > 0
    && near(depS.disposalPerPeriod[7] + landS.disposalPerPeriod[7] + idcS.disposalPerPeriod[7], s.disposal.netBookValue.total), `${depS.disposalPerPeriod[7] + landS.disposalPerPeriod[7] + idcS.disposalPerPeriod[7]} vs ${s.disposal.netBookValue.total}`);
  check('E21 the schedules close where the balance sheet does, from the exit on',
    landS.closingPerPeriod.slice(7).every((v, i) => near(v + (depS.closingPerPeriod[7 + i] ?? 0) + (idcS.closingPerPeriod[7 + i] ?? 0), s.bs.totalFixedAssetsPerPeriod[7 + i] ?? 0)),
    `${landS.closingPerPeriod[7]} + ${depS.closingPerPeriod[7]} + ${idcS.closingPerPeriod[7]} vs ${s.bs.totalFixedAssetsPerPeriod[7]}`);
  check('E22 no depreciation on what was sold after the exit, and the memo accumulated depreciation goes with it',
    depS.depreciationPerPeriod.slice(8).every((v) => near(v, 0)) && idcS.depreciationPerPeriod.slice(8).every((v) => near(v, 0)) && depS.accumDepPerPeriod.slice(7).every((v) => v === 0));
  const noneSnap = computeFinancialsSnapshot(buildState({ terminalMethod: 'none' }));
  const noneDep = scheduleWithDisposal({ openingPerPeriod: noneSnap.fixedAssets.projectTotals.depreciable.openingNBVPerPeriod, additionsPerPeriod: noneSnap.fixedAssets.projectTotals.depreciable.additionsPerPeriod, depreciationPerPeriod: noneSnap.fixedAssets.projectTotals.depreciable.depreciationPerPeriod, closingPerPeriod: noneSnap.fixedAssets.projectTotals.depreciable.closingNBVPerPeriod }, disposalContextOf(noneSnap));
  check('E23 with no terminal value the schedule is the engine\'s own and the disposal row is empty',
    !noneDep.disposed && noneDep.closingPerPeriod.join(',') === noneSnap.fixedAssets.projectTotals.depreciable.closingNBVPerPeriod.join(',') && noneDep.disposalPerPeriod.every((v) => v === 0));
  const screens = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module4FixedAssets.tsx', 'utf8');
  const fin = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx', 'utf8');
  const xl = readFileSync('src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook.ts', 'utf8');
  const pdfSrc = readFileSync('src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf.ts', 'utf8');
  check('E24 every schedule surface reads the shared builder, so none can drift from the balance sheet',
    /scheduleWithDisposal\(/.test(screens) && /Disposed at Exit/.test(screens) && /idcWithDisposal\(/.test(fin)
    && /scheduleWithDisposal\(/.test(xl) && /Disposed at exit/.test(xl) && /scheduleWithDisposal\(/.test(pdfSrc) && /Disposed at exit/.test(pdfSrc));

  const obj = { a: [1, 2, 3], m: [[1, 1, 1], [2, 2, 2]], k: 'x', short: [5, 6] };
  const cut = stopAfterExit(obj, 0, 3);
  check('E14 the pure cut zeroes axis series and matrix rows after the exit only, and returns the input for a last-year exit',
    cut.a.join(',') === '1,0,0' && cut.m[1].join(',') === '2,0,0' && cut.short.join(',') === '5,6' && obj.a.join(',') === '1,2,3' && stopAfterExit(obj, 2, 3) === obj);
}

// ── F ───────────────────────────────────────────────────────────────────────
section('F. the rows and the screens');
{
  const m4 = readFileSync('src/hubs/modeling/platforms/refm/lib/reports/m4Reports.ts', 'utf8');
  check('F1 the P&L row sits after interest and before profit before tax',
    m4.indexOf("'Gain on Disposal of Operating Assets'") > m4.indexOf("label: 'Interest & financing cost'")
    && m4.indexOf("'Gain on Disposal of Operating Assets'") < m4.indexOf('rows.push({ label: labels.pbt'));
  check('F2 the cash flow shows the proceeds in investing and backs the gain out of operations',
    m4.includes("'Proceeds from Disposal of Operating Assets'") && m4.includes('Gain on disposal (non-cash; proceeds in investing)'));
  const pl = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module4PL.tsx', 'utf8');
  check('F3 the P&L inputs carry the zakat-on-gain setting', pl.includes('m4-pl-tax-on-disposal-gain') && pl.includes('applyToDisposalGain'));
  const shared = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module5Shared.tsx', 'utf8');
  check('F4 the Returns assumptions carry the terminal value basis', shared.includes('returns-terminal-basis') && shared.includes("value=\"prior_year\""));
}

// ── G ───────────────────────────────────────────────────────────────────────
section('G. the Returns working reads the booked disposal');
{
  const rs = computeReturnsSnapshot(snap, state.project);
  const w = buildDisposalWorking(snap, rs, (id) => id);
  const val = (label: string): number | undefined => w.rows.find((r) => r.label === label)?.value;
  check('G1 the terminal value row is the proceeds booked', w.booked && val('Terminal value, booked as proceeds from disposal') === snap.disposal.proceeds);
  check('G2 the income capitalised is the basis year income', val('Income capitalised') === snap.disposal.exitMetric);
  check('G3 gain = proceeds less net book value, as the P&L books it',
    val('Gain on disposal') === snap.disposal.gain && val('P&L: Gain on Disposal of Operating Assets') === snap.pl.gainOnDisposalPerPeriod[X]);
  check('G4 every booking ties to the working', (w.rows.find((r) => r.kind === 'check')?.value ?? 1) < 0.01);
  check('G5 the per-asset split foots to the net book value',
    Math.abs(w.byAsset.reduce((s, a) => s + a.total, 0) - snap.disposal.netBookValue.total) < 0.01);
  const exitBasis = buildState({ terminalValueBasis: 'exit_year' });
  const snapE = computeFinancialsSnapshot(exitBasis);
  const wE = buildDisposalWorking(snapE, computeReturnsSnapshot(snapE, exitBasis.project), (id) => id);
  check('G6 the working follows the basis setting', /Exit year income/.test(wE.rows.find((r) => r.label === 'Basis')?.text ?? ''));
  const none = computeFinancialsSnapshot(buildState({ terminalMethod: 'none' }));
  check('G7 with no terminal value the working says nothing is sold', !buildDisposalWorking(none, computeReturnsSnapshot(none, buildState({ terminalMethod: 'none' }).project), (id) => id).booked);
  const tab = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module5Returns.tsx', 'utf8');
  check('G8 the Returns tab renders the working before the sensitivity section',
    tab.indexOf('<DisposalWorkingSection') > 0 && tab.indexOf('<DisposalWorkingSection') < tab.indexOf('<SensitivitySection'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
