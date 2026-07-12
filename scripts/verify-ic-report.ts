/**
 * verify-ic-report.ts (REFM Module 7 Reports, IC rebuild A+B)
 *
 * Pins the IC report assembler wiring WITHOUT the engine: buildICReportModel must
 * map each snapshot field to the right IC model field (never invent a placeholder),
 * resolve parties by role, build every AUTO block (asset mix, phasing + per-phase
 * capex, sources & uses, value bridge, cost stack, financing summary, RE metrics,
 * exit-year table, sensitivity, the ask), and the auto-omit predicate must omit a
 * section only when its data is absent / trivial (or its FORM field empty). The
 * section config must normalize (default order, additive, drop unknowns, reorder).
 * Real numbers were separately confirmed end to end against FMP RE HUB's live
 * snapshot (GDV 14,055M, Project IRR 11.9%, Equity IRR 8.3%, MOIC 2.40x, peak debt
 * 2,834.1M, sources/uses 10,440.0M).
 *
 * No em dashes in this file.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildICReportModel, icSectionOmitted, icVisibleSections } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import { normalizeSectionConfig, IC_SECTIONS, defaultReportInputs } from '../src/hubs/modeling/platforms/refm/lib/reportInputs';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean): void => { if (cond) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}`); } };
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

// ── Mock snapshot with sentinel values, one per IC field ──
const rs: any = {
  result: {
    fcff: { irr: 0.119, moic: 2.52 },
    fcfe: { irr: 0.083, moic: 2.26 },
    dividends: { irr: 0.079 },
    realEstate: { equityMultiple: 2.404, yieldOnCost: 0.064, capRateAtExit: 0.0873, profitOnCost: 1.861, cashOnCashAvg: 0.104, dscrMin: 1.5, ltvAtExit: 0 },
  },
  developmentEconomics: {
    gdv: 14055, totalDevelopmentCost: 4912.2, totalFinancingCost: 820.4,
    profitBeforeFinancing: 9142.8, profitAfterFinancing: 8322.4, developmentMargin: 0.592, costToValue: 0.35,
  },
  sourcesUses: {
    existingEquity: 1282.1, newEquityCash: 0, inKindEquity: 1350.7, existingDebt: 2400, newDebt: 434.1,
    customerCollections: 4973.2, land: 1350.7, construction: 3561.5, idc: 104.4, reservesDistributions: 5423.5,
    totalSources: 10440, totalUses: 10440,
  },
  fundingMix: { debtPct: 0.27, cashEquityPct: 0.12, inKindEquityPct: 0.13, customerFundingPct: 0.48 },
  equityExposure: { equityAtRisk: 2632.7 },
  debtAnalytics: { peakDebt: 2834.1, remainingDebtAtExit: 0, tenorYears: 4, paydownPct: 1.0, averageDebtOutstanding: 1500 },
  totalEquityInvested: 2632.7,
  terminalEquityValue: 3602.8,
  yearLabels: [2026, 2027, 2028, 2029],
  exitYearLabel: 2039,
  exitYears: [
    { exitYearLabel: 2038, equityValue: 3595.7, fcffIrr: 0.120, fcfeIrr: 0.083, equityMoic: 2.16, isSelected: false },
    { exitYearLabel: 2039, equityValue: 3602.8, fcffIrr: 0.119, fcfeIrr: 0.083, equityMoic: 2.26, isSelected: true },
  ],
  sensitivity: {
    xVariable: 'exit_cap_rate', yVariable: 'sales_price_pct',
    xValues: [0.07, 0.08], yValues: [-0.1, 0.1], irr: [[0.10, 0.12], [0.06, 0.08]],
    baseEquityIrr: 0.083, impliedExitCapRate: 0.0873,
  },
};
const snap: any = {
  projectStartYear: 2026,
  perAssetCF: new Map<string, any>([
    ['a1', { capexPerPeriod: [-100, -200] }],
    ['a2', { capexPerPeriod: [-50] }],
  ]),
};
const project: any = { name: 'FMP RE HUB', location: 'Riyadh', country: 'KSA', financing: { fundingMethod: 3, minimumCashReserve: 50 } };
const phases: any = [{ id: 'p1', name: 'Phase 1', startDate: '2026-01-01' }, { id: 'p2', name: 'Phase 2', constructionStart: 1 }];
const assets: any = [
  { id: 'a1', name: 'Hotel', strategy: 'Operate', visible: true, phaseId: 'p1', buaTotal: 12083, landAreaSqm: 5000 },
  { id: 'a2', name: 'Retail', strategy: 'Lease', visible: true, phaseId: 'p2', buaSqm: 2907, landAreaSqm: 3000 },
  { id: 'a3', name: 'Hidden', strategy: 'Sell', visible: false, phaseId: 'p1' },
];
const subUnits: any = [{ assetId: 'a1' }, { assetId: 'a1' }, { assetId: 'a2' }];
const parties: any = [
  { id: '1', name: 'PaceMakers', identifier: null, roles: ['Sponsor', 'Developer'] },
  { id: '2', name: 'JV Investor Co', identifier: 'reg-1', roles: ['Investor/Equity Partner'] },
  { id: '3', name: 'Analyst', identifier: null, roles: ['Prepared-by', 'Contact'] },
  { id: '4', name: 'Bank', identifier: null, roles: ['Lender'] },
];

const m = buildICReportModel({ project, phases, assets, subUnits, rs, snap, parties, asOf: '2026-07-12', cases: [{ id: 'base' } as any] });

// Headline maps to the exact snapshot fields (no placeholders).
check('headline Project IRR = rs.result.fcff.irr', near(m.headline.projectIrr!, 0.119));
check('headline Equity IRR = rs.result.fcfe.irr', near(m.headline.equityIrr!, 0.083));
check('headline equity multiple = rs.result.realEstate.equityMultiple (the 2.40x MOIC)', near(m.headline.equityMultiple, 2.404));
check('headline Project MOIC = rs.result.fcff.moic', near(m.headline.projectMoic, 2.52));
check('headline Distributed-Equity IRR = rs.result.dividends.irr', near(m.headline.distributedEquityIrr!, 0.079));
check('headline terminal equity = rs.terminalEquityValue', near(m.headline.terminalEquity, 3602.8));

// Development economics + value bridge + cost stack.
check('dev-econ GDV = rs.developmentEconomics.gdv', near(m.devEconomics.gdv, 14055));
check('dev-econ TDC = rs.developmentEconomics.totalDevelopmentCost', near(m.devEconomics.tdc, 4912.2));
check('dev-econ margin = rs.developmentEconomics.developmentMargin', near(m.devEconomics.developmentMargin!, 0.592));
check('value bridge leads with GDV', m.valueBridge[0].label.includes('Gross') && near(m.valueBridge[0].value, 14055));
check('value bridge ends with profit after financing (emphasis)', m.valueBridge[m.valueBridge.length - 1].emphasis === true && near(m.valueBridge[m.valueBridge.length - 1].value, 8322.4));
check('cost stack construction + land = TDC', near(m.costStack[0].value + m.costStack[1].value, 4912.2));

// Ask (investment recommendation).
check('ask equity commitment = existing + in-kind', near(m.ask.equityCommitment, 1282.1 + 1350.7));
check('ask peak debt = debtAnalytics.peakDebt', near(m.ask.peakDebt, 2834.1));

// Capital + funding mix.
check('capital debt % = rs.fundingMix.debtPct', near(m.capital.debtPct!, 0.27));
check('capital peak equity = rs.equityExposure.equityAtRisk', near(m.capital.peakEquity, 2632.7));
check('capital total equity = rs.totalEquityInvested', near(m.capital.totalEquity, 2632.7));
check('capital peak debt = rs.debtAnalytics.peakDebt', near(m.capital.peakDebt, 2834.1));

// Sources & uses (balances to 10,440.0).
check('sources total = 10,440', near(m.sourcesUses.totalSources, 10440));
check('uses total = 10,440', near(m.sourcesUses.totalUses, 10440));
check('sources & uses balance', near(m.sourcesUses.totalSources, m.sourcesUses.totalUses));
check('sources include customer collections', m.sourcesUses.sources.some((r) => near(r.value, 4973.2)));
check('uses include IDC', m.sourcesUses.uses.some((r) => r.label.includes('IDC') && near(r.value, 104.4)));

// Financing summary.
check('financing funding method label = Cash Deficit Funding', m.financing.fundingMethodLabel === 'Cash Deficit Funding');
check('financing tenor = 4 yrs', m.financing.tenorYears === 4);
check('financing min cash reserve = 50', near(m.financing.minCashReserve, 50));
check('financing hasDebt true', m.financing.hasDebt === true);

// RE metrics.
check('RE yield on cost = realEstate.yieldOnCost', near(m.reMetrics.yieldOnCost!, 0.064));
check('RE cap rate at exit = realEstate.capRateAtExit', near(m.reMetrics.capRateAtExit!, 0.0873));
check('RE profit on cost = realEstate.profitOnCost', near(m.reMetrics.profitOnCost!, 1.861));

// Asset mix (visible only; BUA + units aggregation).
check('asset mix excludes hidden assets', m.assetMix.rows.length === 2 && m.assetMix.rows.every((r) => r.name !== 'Hidden'));
check('asset mix total BUA = 12083 + 2907', near(m.assetMix.totalBua, 14990));
check('asset mix units summed from sub-units (2 + 1)', m.assetMix.totalUnits === 3);
check('asset mix by-strategy has Operate + Lease shares', m.assetMix.byStrategy.length === 2 && near(m.assetMix.byStrategy.reduce((s, x) => s + x.pct, 0), 1));
check('asset row carries phase name', m.assetMix.rows.find((r) => r.name === 'Hotel')!.phaseName === 'Phase 1');

// Phasing (per-phase capex from per-asset CF, abs cash).
check('phasing has 2 phases', m.phasing.length === 2);
check('phase 1 capex = |−100| + |−200| = 300', near(m.phasing[0].capex, 300));
check('phase 1 start year from startDate', m.phasing[0].startYear === 2026);
check('phase 1 lists its asset', m.phasing[0].assetNames.includes('Hotel'));

// Exit-year optionality.
check('exit years mapped (2 rows)', m.exitYears.length === 2);
check('selected exit year = 2039', m.exitYears.find((r) => r.selected)!.year === 2039);
check('exit row project/equity IRR mapped', near(m.exitYears[1].projectIrr!, 0.119) && near(m.exitYears[1].equityIrr!, 0.083));

// Sensitivity (two-way IRR grid).
check('sensitivity hasData true', m.sensitivity.hasData === true);
check('sensitivity grid cell [0][0]', near(m.sensitivity.irr[0][0]!, 0.10));
check('sensitivity axis variables carried', m.sensitivity.xVariable === 'exit_cap_rate' && m.sensitivity.yVariable === 'sales_price_pct');

// Overview extras.
check('overview strategy mix summarised', m.overview.strategyMix.includes('Operate') && m.overview.strategyMix.includes('Lease'));
check('overview funding method label', m.overview.fundingMethodLabel === 'Cash Deficit Funding');
check('overview total BUA', near(m.overview.totalBua, 14990));
check('overview land area summed (visible)', near(m.overview.landAreaSqm, 8000));

// Overview: timeline, phases, visible-only asset mix.
check('overview start year = yearLabels[0]', m.overview.startYear === 2026);
check('overview exit year = exitYearLabel', m.overview.exitYear === 2039);
check('overview phase count = 2', m.overview.phaseCount === 2);
check('overview asset mix excludes hidden assets', m.overview.assetMix.length === 2 && m.overview.assetMix.every((a) => a.name !== 'Hidden'));

// Parties resolve by role.
check('sponsors resolved by role', m.overview.sponsors.length === 1 && m.overview.sponsors[0].name === 'PaceMakers');
check('developers resolved by role', m.overview.developers.length === 1 && m.overview.developers[0].name === 'PaceMakers');
check('investors resolved by role', m.overview.investors.length === 1 && m.overview.investors[0].name === 'JV Investor Co');
check('prepared-by resolved by role (cover)', m.cover.preparedBy.length === 1 && m.cover.preparedBy[0].name === 'Analyst');
check('lender NOT surfaced as sponsor/developer/investor', !m.overview.sponsors.some((p) => p.name === 'Bank'));

// Scenarios: null with only the base case.
check('scenarios null with a single (base) case', m.scenarios === null);

// ── Auto-omit predicate ──
const emptyInputs = defaultReportInputs();
check('cover never omitted', icSectionOmitted('cover', m, emptyInputs) === false);
check('AUTO returns_analysis never omitted', icSectionOmitted('returns_analysis', m, emptyInputs) === false);
check('financing shown when hasDebt (present)', icSectionOmitted('financing_structure', m, emptyInputs) === false);
check('sources_uses shown when total > 0', icSectionOmitted('sources_uses', m, emptyInputs) === false);
check('exit_optionality shown with > 1 exit row', icSectionOmitted('exit_optionality', m, emptyInputs) === false);
check('sensitivity shown when grid has data', icSectionOmitted('sensitivity', m, emptyInputs) === false);
check('scenario_cases omitted with no scenarios', icSectionOmitted('scenario_cases', m, emptyInputs) === true);
check('scenario_economics omitted with no scenarios', icSectionOmitted('scenario_economics', m, emptyInputs) === true);
check('market_context omitted when form empty', icSectionOmitted('market_context', m, emptyInputs) === true);
check('regulatory_tax omitted when form empty', icSectionOmitted('regulatory_tax', m, emptyInputs) === true);
check('risk_assessment omitted when no risks + no free text', icSectionOmitted('risk_assessment', m, emptyInputs) === true);
check('executive_summary omitted when no points + no free text', icSectionOmitted('executive_summary', m, emptyInputs) === true);

// FORM present => section renders.
const filledInputs = { ...emptyInputs, marketContext: { stats: [{ label: 'x', value: '9.5m' }], points: [], sourcesNote: '' }, regulatoryTax: [{ label: 'RETT', body: '5%' }] };
check('market_context shown when a stat exists', icSectionOmitted('market_context', m, filledInputs as any) === false);
check('regulatory_tax shown when a row exists', icSectionOmitted('regulatory_tax', m, filledInputs as any) === false);

// No-debt model => financing omitted.
const noDebtRs = { ...rs, debtAnalytics: { peakDebt: 0, remainingDebtAtExit: 0, tenorYears: null, paydownPct: null }, sourcesUses: { ...rs.sourcesUses, existingDebt: 0, newDebt: 0 } };
const mNoDebt = buildICReportModel({ project, phases, assets, subUnits, rs: noDebtRs, snap, parties, asOf: '2026-07-12', cases: [{ id: 'base' } as any] });
check('financing omitted when no debt', icSectionOmitted('financing_structure', mNoDebt, emptyInputs) === true);

// Single exit row => exit_optionality omitted.
const oneExitRs = { ...rs, exitYears: [rs.exitYears[1]] };
const mOneExit = buildICReportModel({ project, phases, assets, subUnits, rs: oneExitRs, snap, parties, asOf: '2026-07-12', cases: [{ id: 'base' } as any] });
check('exit_optionality omitted with a single exit row', icSectionOmitted('exit_optionality', mOneExit, emptyInputs) === true);

// icVisibleSections excludes omitted sections but keeps AUTO ones.
const visible = icVisibleSections(m, emptyInputs);
check('icVisibleSections keeps cover + returns, drops empty scenario/market', visible.includes('cover') && visible.includes('returns_analysis') && !visible.includes('scenario_cases') && !visible.includes('market_context'));

// Section config normalization.
const def = normalizeSectionConfig(defaultReportInputs().sectionConfig.ic, 'ic');
check('default section config = all sections, canonical order', def.length === IC_SECTIONS.length && def.every((s, i) => s.key === IC_SECTIONS[i].key && s.visible));
check('IC section set is the full A+B structure (21 sections)', IC_SECTIONS.length === 21);
const reordered = normalizeSectionConfig([{ key: 'investment_recommendation', visible: true, order: 0 }, { key: 'cover', visible: false, order: 1 }]);
check('reorder preserved (investment_recommendation first)', reordered[0].key === 'investment_recommendation');
check('hidden flag preserved (cover hidden)', reordered.find((s) => s.key === 'cover')!.visible === false);
check('missing sections added back (additive)', reordered.length === IC_SECTIONS.length);
const withUnknown = normalizeSectionConfig([{ key: 'not_a_section', visible: true, order: 0 }]);
check('unknown section keys dropped', withUnknown.every((s) => IC_SECTIONS.some((x) => x.key === s.key)));

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
