/**
 * verify-report-models-phase2.ts (REFM Module 7 Reports, Phase 2)
 *
 * Pins the Lender Package + Investor One-Pager assembler wiring WITHOUT the
 * engine: the builders must map each snapshot field to the right model field
 * (never a placeholder), the Lender covenant rows must come from the SAME pure
 * evaluateCovenant (pass/fail per threshold, per period), and the per-report-type
 * section config must normalize (legacy array -> ic, object shape, additive).
 * The real numbers were separately confirmed against FMP RE HUB's live snapshot
 * (peak debt 2,834.1m; One-Pager 11.9% / 8.3% / 2.40x).
 *
 * No em dashes in this file.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildLenderReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/lenderReport';
import { buildOnePagerReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/onePagerReport';
import { normalizeAllSectionConfigs, normalizeSectionConfig, LENDER_SECTIONS, ONEPAGER_SECTIONS, IC_SECTIONS } from '../src/hubs/modeling/platforms/refm/lib/reportInputs';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean): void => { if (cond) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}`); } };
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

// ── Mock snapshot (sentinels) ──
const rs: any = {
  result: {
    fcff: { irr: 0.119, moic: 2.52 },
    fcfe: { irr: 0.083, moic: 2.26 },
    dividends: { irr: 0.081 },
    realEstate: { equityMultiple: 2.40, dscrPerPeriod: [0, 1.5, 1.5], icrPerPeriod: [0, 3, 3], ltvAtExit: 0.1 },
  },
  noiPerPeriod: [0, 100, 100],
  developmentEconomics: { gdv: 1000 },
  sourcesUses: { existingEquity: 0, newEquityCash: 300, inKindEquity: 0, existingDebt: 0, newDebt: 600, customerCollections: 100, operatingCash: 0, land: 200, construction: 700, idc: 100, reservesDistributions: 0, totalSources: 1000, totalUses: 1000 },
  fundingMix: { debtPct: 0.6, cashEquityPct: 0.3, inKindEquityPct: 0, customerFundingPct: 0.1 },
  debtAnalytics: { peakDebt: 600, remainingDebtAtExit: 0, tenorYears: 5 },
  equityExposure: { equityAtRisk: 300 },
  totalEquityInvested: 300,
  yearLabels: [2024, 2025, 2026],
  exitYearLabel: 2026,
};
const snap: any = {
  projectStartYear: 2024,
  bs: { debtOutstandingPerPeriod: [600, 300, 0] },
  directCF: {
    debtDrawdownPerPeriod: [600, 0, 0], interestPaidPerPeriod: [0, -38, -19], debtRepaymentPerPeriod: [0, -300, -300],
    cashFromOperationsPerPeriod: [0, 100, 100], cashFromInvestmentPerPeriod: [-900, 0, 0], cashFromFinancingPerPeriod: [600, -338, -319], closingCashPerPeriod: [0, 50, 80],
  },
  cashSweep: { totalSweepPerPeriod: [0, 100, 50] },
};
const project: any = {
  name: 'Test', location: 'Riyadh', country: 'KSA',
  covenants: [
    { id: 'd', metric: 'dscr', operator: 'min', threshold: 1.2, label: 'DSCR' },
    { id: 'l', metric: 'ltv', operator: 'max', threshold: 0.6, label: 'LTV' },
    { id: 'y', metric: 'debt_yield', operator: 'min', threshold: 0.5, label: 'Debt Yield' },
  ],
};
const tranches: any = [{ name: 'Senior', interestRatePct: 6.3, ltvPct: 60, facilitySharePct: 100, sweepRatio: 100 }];
const assets: any = [{ name: 'Hotel', strategy: 'Operate', visible: true }, { name: 'Hidden', strategy: 'Sell', visible: false }];
const phases: any = [{ name: 'P1' }, { name: 'P2' }];

// ── Lender ──
const lm = buildLenderReportModel({ project, financingTranches: tranches, rs, snap, parties: [], asOf: '2026-07-09' });
check('lender facility maps name + rate', lm.facilities.length === 1 && lm.facilities[0].name === 'Senior' && near(lm.facilities[0].interestRatePct, 6.3));
check('lender peak debt = rs.debtAnalytics.peakDebt', near(lm.capital.peakDebt, 600));
check('lender debt % = rs.fundingMix.debtPct', near(lm.capital.debtPct!, 0.6));
check('lender sources & uses reconcile (1000 == 1000)', near(lm.sourcesUses.totalSources, 1000) && near(lm.sourcesUses.totalUses, 1000));
check('lender repayment debt outstanding = snap.bs series', lm.repayment.debtOutstanding.join(',') === '600,300,0');
check('lender repayment sweep = snap.cashSweep.totalSweepPerPeriod', lm.repayment.sweep.join(',') === '0,100,50');
check('lender key cash flows CFO = snap.directCF.cashFromOperationsPerPeriod', lm.keyCashFlows.cfo.join(',') === '0,100,100');

const dscrRow = lm.covenants.find((c) => c.metric === 'dscr')!;
const ltvRow = lm.covenants.find((c) => c.metric === 'ltv')!;
const dyRow = lm.covenants.find((c) => c.metric === 'debt_yield')!;
check('covenant DSCR worst = 1.5 (min over debt-service periods)', near(dscrRow.worst!, 1.5));
check('covenant DSCR passes (1.5 >= 1.2)', dscrRow.pass === true);
check('covenant DSCR period-0 is null (no debt service)', dscrRow.seriesPerPeriod[0] === null);
check('covenant LTV worst = 0.6 (peak debt / GDV) and passes (<= 0.6)', near(ltvRow.worst!, 0.6) && ltvRow.pass === true && ltvRow.basisLabel === 'peak debt / GDV');
check('covenant Debt Yield worst = 0.333 (NOI 100 / debt 300 at the income period) and FAILS (< 0.5)', near(dyRow.worst!, 100 / 300) && dyRow.pass === false);
check('covenant unit: dscr = x, ltv = pct', dscrRow.unit === 'x' && ltvRow.unit === 'pct');

// ── One-Pager ──
const op = buildOnePagerReportModel({ project, phases, assets, rs, snap, parties: [{ id: '1', name: 'Analyst', identifier: 'a@x', roles: ['Prepared-by', 'Contact'] } as any], thesisLine: 'Prime asset, strong yield.', asOf: '2026-07-09' });
check('one-pager Project IRR = rs.result.fcff.irr', near(op.headline.projectIrr!, 0.119));
check('one-pager Equity IRR = rs.result.fcfe.irr', near(op.headline.equityIrr!, 0.083));
check('one-pager MOIC = rs.result.realEstate.equityMultiple', near(op.headline.equityMultiple, 2.40));
check('one-pager capital ask peak debt = rs.debtAnalytics.peakDebt', near(op.capitalAsk.peakDebt, 600));
check('one-pager timeline 2024 to 2026 (3 yrs)', op.timeline.startYear === 2024 && op.timeline.exitYear === 2026 && op.timeline.durationYears === 3);
check('one-pager asset mix excludes hidden assets', op.assetMix.length === 1 && op.assetMix[0].name === 'Hotel');
check('one-pager thesis line passthrough', op.thesisLine === 'Prime asset, strong yield.');
check('one-pager prepared-by + contact resolve by role', op.preparedBy[0]?.name === 'Analyst' && op.contacts[0]?.name === 'Analyst');

// ── Section config (per report type) ──
const all = normalizeAllSectionConfigs({});
check('lender section config = all lender sections in order', all.lender.length === LENDER_SECTIONS.length && all.lender.every((s, i) => s.key === LENDER_SECTIONS[i].key));
check('onepager section config = all one-pager sections in order', all.onepager.length === ONEPAGER_SECTIONS.length && all.onepager.every((s, i) => s.key === ONEPAGER_SECTIONS[i].key));
const legacy = normalizeAllSectionConfigs([{ key: 'executive_summary', visible: false, order: 0 }]);
check('legacy bare array migrates to ic (executive_summary hidden)', legacy.ic.find((s) => s.key === 'executive_summary')!.visible === false && legacy.lender.length === LENDER_SECTIONS.length);
const lenderReorder = normalizeSectionConfig([{ key: 'covenant_analysis', visible: true, order: 0 }], 'lender');
check('lender reorder honored (covenant_analysis first)', lenderReorder[0].key === 'covenant_analysis' && lenderReorder.length === LENDER_SECTIONS.length);
check('ic section set is the full A+B structure (21 sections)', IC_SECTIONS.length === 21);

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
