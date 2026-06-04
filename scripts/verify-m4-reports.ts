/**
 * verify-m4-reports.ts
 *
 * Locks the shared Module 4 statement row-builders (lib/reports/m4Reports.ts)
 * that BOTH the on-screen tabs and the PDF export render from (the single
 * source of truth behind the "PDF mirrors the platform + auto-syncs" feature).
 *
 * Pins:
 *  - Consolidated P&L runs the full statement down to PAT; a phase-filtered P&L
 *    stops at EBITDA (no D&A / EBIT / PBT / Tax / PAT below it).
 *  - Consolidated Direct + Indirect CF carry Financing + Net Cash Flow + closing
 *    cash; a phase-filtered CF stops at "Cash Flow from Investment" (no Financing
 *    / Net Cash Flow rows).
 *  - The Balance Sheet builder reports balances by construction and its TOTAL
 *    ASSETS ties to TOTAL LIABILITIES + EQUITY each period.
 *  - The consolidated rows MIRROR the snapshot totals (auto-sync proxy): the
 *    P&L Total Revenue row equals snap.pl.totalRevenuePerPeriod.
 */
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { buildPLRows, buildDirectCFRows, buildIndirectCFRows, buildBSRows } from '../src/hubs/modeling/platforms/refm/lib/reports/m4Reports';
import { getFinancialLabels, defaultTerminologyForCountry } from '../src/core/calculations/financials';
import { makeDefaultPhase, makeDefaultProject, makeDefaultCostLines, makeDefaultFinancingTranche } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}

const A = (n: number, fill = 0): number[] => Array(n).fill(fill);

function buildState(): any {
  const project: any = makeDefaultProject();
  project.name = 'Riverside Mixed-Use';
  project.startDate = '2026-01-01';
  project.operatingAr = { dsoDays: 30, daysPerYear: 365 };
  project.tax = { rate: 0.15 };
  project.escrow = { heldPct: 0.2 };
  project.dividendPolicy = { enabled: true, payoutRatio: 100, mode: 'cash_above_min' };
  const p1: any = { ...makeDefaultPhase(), id: 'p1', name: 'Phase 1', startDate: '2026-01-01', constructionPeriods: 2, operationsPeriods: 8, overlapPeriods: 0 };
  const p2: any = { ...makeDefaultPhase(), id: 'p2', name: 'Phase 2', startDate: '2028-01-01', constructionPeriods: 2, operationsPeriods: 6, overlapPeriods: 0 };

  const hotel: any = {
    id: 'H1', phaseId: 'p1', name: 'Hotel', type: '', strategy: 'Operate', visible: true,
    gfaSqm: 0, buaSqm: 30000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 20,
    revenue: { operate: { assetId: 'H1', daysPerYear: 365, startingADR: 900, adrIndexation: { method: 'yoy_compound', rate: 0.03 }, occupancyPerPeriodByPhase: A(11, 0.75), guestsPerOccupiedRoom: 1.5, fb: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: A(11), indexation: { method: 'none' } }, otherRevenue: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: A(11), indexation: { method: 'none' } } } },
    opex: { defaultIndexation: { method: 'yoy_compound', rate: 0.03 }, lines: [{ id: 'o1', name: 'Rooms cost', category: 'direct_rooms', mode: 'fixed_baseline', value: 12_000_000, indexation: { method: 'yoy_compound', rate: 0.03 }, useAssetDefault: true, rateMode: 'single' }] },
  };
  const suH: any = { id: 'su1', assetId: 'H1', name: 'Keys', category: 'Operable', metric: 'units', metricValue: 200, unitArea: 0, unitPrice: 900, startingAdr: 900 };

  const resi: any = {
    id: 'R1', phaseId: 'p1', name: 'Residences', type: '', strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 20000, sellableBuaSqm: 20000, parkingBaysRequired: 0,
    revenue: { sell: { assetId: 'R1', subUnits: [{ subUnitId: 'rsu1', preSalesVelocityByPhase: [30, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0], postSalesVelocityByPhase: [0, 0, 10, 10, 10, 10, 0, 0, 0, 0, 0] }], cashPaymentProfile: { percentages: [0.5, 0.5] }, recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' }, indexation: { method: 'none' } } },
  };
  const suR: any = { id: 'rsu1', assetId: 'R1', name: 'Apartments', category: 'Sellable', metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_000_000 };

  // A second-phase retail asset so the phase filter has distinct content.
  const retail: any = {
    id: 'L1', phaseId: 'p2', name: 'Retail', type: '', strategy: 'Lease', visible: true,
    gfaSqm: 0, buaSqm: 5000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 25,
    revenue: { lease: { assetId: 'L1', baseRate: 1200, rentIndexation: { method: 'yoy_compound', rate: 0.03 }, occupancyPerPeriodByPhase: A(8, 0.9), arDays: 60 } },
    opex: { defaultIndexation: { method: 'yoy_compound', rate: 0.03 }, lines: [{ id: 'lo1', name: 'Property mgmt', category: 'mgmt_base', mode: 'pct_of_lease_rev', value: 5, indexation: { method: 'none' }, useAssetDefault: false, rateMode: 'single' }] },
  };
  const suL: any = { id: 'lsu1', assetId: 'L1', name: 'Shops', category: 'Leasable', metric: 'area', metricValue: 5000, unitArea: 0, unitPrice: 1200 };

  const cl = [...makeDefaultCostLines('p1', 2), ...makeDefaultCostLines('p2', 2)];
  const parcel: any = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };
  const tr1 = makeDefaultFinancingTranche('t1', 'p1');
  const tr2 = makeDefaultFinancingTranche('t2', 'p2');
  return { project, phases: [p1, p2], assets: [hotel, resi, retail], subUnits: [suH, suR, suL], parcels: [parcel], costLines: cl, costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [tr1, tr2], equityContributions: [] };
}

function main(): void {
  console.log('=== M4 shared report-builder test ===');
  const state = buildState();
  const snap = computeFinancialsSnapshot(state);
  const labels = getFinancialLabels(state.project.financialTerminology ?? defaultTerminologyForCountry(state.project.country));
  const fmt = (v: number): string => v.toFixed(0);
  const ctx = (filterPhaseId: string) => ({ snap, state, labels, filterPhaseId, fmt });

  // ── P&L ──────────────────────────────────────────────────────────────────
  const plAll = buildPLRows(ctx('__all__'));
  const plLabels = plAll.map((r) => r.label);
  check('Consolidated P&L ends at PAT', plAll[plAll.length - 1]?.label === labels.pat, `last=${plAll[plAll.length - 1]?.label}`);
  check('Consolidated P&L has EBITDA + EBIT + PBT', plLabels.includes(labels.ebitda) && plLabels.includes(labels.ebit) && plLabels.includes(labels.pbt));
  check('Consolidated P&L has D&A line', plLabels.some((l) => l.startsWith('Depreciation')));

  const plPhase = buildPLRows(ctx('p1'));
  const plPhaseLabels = plPhase.map((r) => r.label);
  check('Phase P&L ends at EBITDA', plPhase[plPhase.length - 1]?.label === labels.ebitda, `last=${plPhase[plPhase.length - 1]?.label}`);
  check('Phase P&L has NO PAT / EBIT / D&A below EBITDA', !plPhaseLabels.includes(labels.pat) && !plPhaseLabels.includes(labels.ebit) && !plPhaseLabels.some((l) => l.startsWith('Depreciation')));

  // Auto-sync proxy: the Total Revenue row mirrors the snapshot total revenue.
  const totalRevRow = plAll.find((r) => r.label === 'Total Revenue');
  const revMirror = !!totalRevRow && totalRevRow.values.every((v, i) => Math.abs(v - (snap.pl.totalRevenuePerPeriod[i] ?? 0)) < 1);
  check('Consolidated P&L Total Revenue mirrors snapshot', revMirror);

  // ── Cash Flow ──────────────────────────────────────────────────────────────
  const cfAll = buildDirectCFRows(ctx('__all__'));
  const cfAllLabels = cfAll.map((r) => r.label);
  check('Consolidated Direct CF has Financing + Net Cash Flow + Closing cash', cfAllLabels.includes('CASH FROM FINANCING') && cfAllLabels.includes('Net Cash Flow') && cfAllLabels.includes('Closing cash'));

  const cfPhase = buildDirectCFRows(ctx('p1'));
  const cfPhaseLabels = cfPhase.map((r) => r.label);
  check('Phase Direct CF stops at Investing (no Financing / Net Cash Flow)', !cfPhaseLabels.includes('CASH FROM FINANCING') && !cfPhaseLabels.includes('Net Cash Flow') && !cfPhaseLabels.includes('Closing cash'));
  check('Phase Direct CF ends at Cash Flow from Investment', cfPhase[cfPhase.length - 1]?.label === 'Cash Flow from Investment', `last=${cfPhase[cfPhase.length - 1]?.label}`);

  const icfAll = buildIndirectCFRows(ctx('__all__'));
  const icfAllLabels = icfAll.map((r) => r.label);
  check('Consolidated Indirect CF has Net Cash Flow + Closing cash', icfAllLabels.includes('Net Cash Flow') && icfAllLabels.includes('Closing cash'));
  const icfPhase = buildIndirectCFRows(ctx('p1'));
  check('Phase Indirect CF stops at Investing', !icfPhase.map((r) => r.label).includes('Net Cash Flow'));

  // ── Balance Sheet ──────────────────────────────────────────────────────────
  const bsRes = buildBSRows(ctx('__all__'));
  check('BS builder reports balanced', bsRes.balances, `maxAbsDiff=${bsRes.maxAbsDiff}`);
  const totalAssets = bsRes.rows.find((r) => r.label === 'TOTAL ASSETS');
  const totalLandE = bsRes.rows.find((r) => r.label === 'TOTAL LIABILITIES + EQUITY');
  const ties = !!totalAssets && !!totalLandE && totalAssets.values.every((v, i) => Math.abs(v - (totalLandE.values[i] ?? 0)) < Math.max(1000, Math.abs(v) * 1e-6));
  check('BS TOTAL ASSETS ties to TOTAL LIABILITIES + EQUITY every period', ties);

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('Failures:', failures.join(', ')); process.exit(1); }
}

main();
