/**
 * verify-ic-report.ts (REFM Module 7 Reports, Phase 1)
 *
 * Pins the IC report assembler wiring WITHOUT the engine: buildICReportModel must
 * map each snapshot field to the right IC model field (never invent a placeholder),
 * resolve parties by role, and the section config must normalize (default order,
 * additive, drop unknowns, preserve reorder). The real numbers were separately
 * confirmed end to end against FMP RE HUB's live snapshot (GDV 14,055M, Project
 * IRR 11.9%, Equity IRR 8.3%, MOIC / equity multiple 2.40x).
 *
 * No em dashes in this file.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildICReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import { normalizeSectionConfig, IC_SECTIONS, defaultReportInputs } from '../src/hubs/modeling/platforms/refm/lib/reportInputs';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean): void => { if (cond) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}`); } };
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

// ── Mock snapshot with sentinel values, one per IC field ──
const rs: any = {
  result: {
    fcff: { irr: 0.119, moic: 2.52 },
    fcfe: { irr: 0.083, moic: 2.26 },
    dividends: { irr: 0.081 },
    realEstate: { equityMultiple: 2.404 },
  },
  developmentEconomics: {
    gdv: 14055, totalDevelopmentCost: 9000, totalFinancingCost: 500,
    profitBeforeFinancing: 5055, profitAfterFinancing: 4555, developmentMargin: 0.324, costToValue: 0.64,
  },
  sourcesUses: { totalSources: 12000, totalUses: 12000, land: 1000, construction: 8000 },
  fundingMix: { debtPct: 0.5, cashEquityPct: 0.3, inKindEquityPct: 0.1, customerFundingPct: 0.1 },
  equityExposure: { equityAtRisk: 3200 },
  debtAnalytics: { peakDebt: 6000, remainingDebtAtExit: 0 },
  totalEquityInvested: 3000,
  yearLabels: [2024, 2025, 2026, 2027, 2028],
  exitYearLabel: 2028,
};
const snap: any = { projectStartYear: 2024 };
const project: any = { name: 'Test Project', location: 'Riyadh', country: 'KSA' };
const phases: any = [{ name: 'Phase 1' }, { name: 'Phase 2' }];
const assets: any = [{ name: 'Hotel', strategy: 'Operate', visible: true }, { name: 'Retail', strategy: 'Lease', visible: true }, { name: 'Hidden', strategy: 'Sell', visible: false }];
const parties: any = [
  { id: '1', name: 'PaceMakers', identifier: null, roles: ['Sponsor', 'Developer'] },
  { id: '2', name: 'JV Investor Co', identifier: 'reg-1', roles: ['Investor/Equity Partner'] },
  { id: '3', name: 'Analyst', identifier: null, roles: ['Prepared-by', 'Contact'] },
  { id: '4', name: 'Bank', identifier: null, roles: ['Lender'] },
];

const m = buildICReportModel({ project, phases, assets, rs, snap, parties, asOf: '2026-07-09', cases: [{ id: 'base' } as any] });

// Headline maps to the exact snapshot fields (no placeholders).
check('headline Project IRR = rs.result.fcff.irr', near(m.headline.projectIrr!, 0.119));
check('headline Equity IRR = rs.result.fcfe.irr', near(m.headline.equityIrr!, 0.083));
check('headline equity multiple = rs.result.realEstate.equityMultiple (the 2.40x MOIC)', near(m.headline.equityMultiple, 2.404));
check('headline Project MOIC = rs.result.fcff.moic', near(m.headline.projectMoic, 2.52));
check('headline Distributed-Equity IRR = rs.result.dividends.irr', near(m.headline.distributedEquityIrr!, 0.081));

// Development economics.
check('dev-econ GDV = rs.developmentEconomics.gdv', near(m.devEconomics.gdv, 14055));
check('dev-econ TDC = rs.developmentEconomics.totalDevelopmentCost', near(m.devEconomics.tdc, 9000));
check('dev-econ margin = rs.developmentEconomics.developmentMargin', near(m.devEconomics.developmentMargin!, 0.324));

// Capital structure.
check('capital debt % = rs.fundingMix.debtPct', near(m.capital.debtPct!, 0.5));
check('capital peak equity = rs.equityExposure.equityAtRisk', near(m.capital.peakEquity, 3200));
check('capital total equity = rs.totalEquityInvested', near(m.capital.totalEquity, 3000));
check('capital peak debt = rs.debtAnalytics.peakDebt', near(m.capital.peakDebt, 6000));

// Overview: timeline, phases, visible-only asset mix.
check('overview start year = yearLabels[0]', m.overview.startYear === 2024);
check('overview exit year = exitYearLabel', m.overview.exitYear === 2028);
check('overview duration = 5 yrs', m.overview.durationYears === 5);
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

// Section config normalization.
const def = normalizeSectionConfig(defaultReportInputs().sectionConfig.ic, 'ic');
check('default section config = all sections, canonical order', def.length === IC_SECTIONS.length && def.every((s, i) => s.key === IC_SECTIONS[i].key && s.visible));
const reordered = normalizeSectionConfig([{ key: 'recommendation', visible: true, order: 0 }, { key: 'cover', visible: false, order: 1 }]);
check('reorder preserved (recommendation first)', reordered[0].key === 'recommendation');
check('hidden flag preserved (cover hidden)', reordered.find((s) => s.key === 'cover')!.visible === false);
check('missing sections added back (additive)', reordered.length === IC_SECTIONS.length);
const withUnknown = normalizeSectionConfig([{ key: 'not_a_section', visible: true, order: 0 }]);
check('unknown section keys dropped', withUnknown.every((s) => IC_SECTIONS.some((x) => x.key === s.key)));

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
