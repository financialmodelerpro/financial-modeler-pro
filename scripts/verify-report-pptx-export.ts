/**
 * verify-report-pptx-export.ts (REFM Module 7 Reports, Phase 3a)
 *
 * Generates the IC / Lender / One-Pager .pptx from mock report models, unzips the
 * result (a .pptx is a zip of XML) and asserts the deck STRUCTURE: slide count,
 * cover + ToC + per-section divider/content layout, section titles, key snapshot
 * values, ToC internal slide links, divider "Back to contents" links, the applied
 * fonts, and header/footer text. Also asserts show/hide + reorder are respected.
 *
 * The REAL canonical numbers (GDV 14,055 / IRR 11.9% / Equity IRR 8.3% / MOIC
 * 2.40x / peak debt 2,834.1m) were separately confirmed by generating the decks
 * from FMP RE HUB's live snapshot. Ahmad opens the decks in PowerPoint to eyeball
 * layout + edit-ability (the point of PPT-as-master).
 *
 * No em dashes in this file.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import JSZip from 'jszip';
import { buildICReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import { buildLenderReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/lenderReport';
import { buildOnePagerReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/onePagerReport';
import { buildReportPptx } from '../src/hubs/modeling/platforms/refm/lib/pptx/buildReportPptx';
import { defaultReportInputs, type ReportInputs } from '../src/hubs/modeling/platforms/refm/lib/reportInputs';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean): void => { if (cond) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}`); } };

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

// ── Mock snapshot (sentinels chosen to format to known strings) ──
const rs: any = {
  result: {
    fcff: { irr: 0.119, moic: 2.52 }, fcfe: { irr: 0.083, moic: 2.26 }, dividends: { irr: 0.081 },
    realEstate: { equityMultiple: 2.40, dscrPerPeriod: [0, 1.5, 1.5], icrPerPeriod: [0, 3, 3], ltvAtExit: 0.1 },
  },
  noiPerPeriod: [0, 100, 100],
  developmentEconomics: { gdv: 14055, totalDevelopmentCost: 9000, totalFinancingCost: 500, profitBeforeFinancing: 5055, profitAfterFinancing: 4555, developmentMargin: 0.324, costToValue: 0.64 },
  sourcesUses: { existingEquity: 0, newEquityCash: 300, inKindEquity: 0, existingDebt: 0, newDebt: 600, customerCollections: 100, operatingCash: 0, land: 200, construction: 700, idc: 100, reservesDistributions: 0, totalSources: 1000, totalUses: 1000 },
  fundingMix: { debtPct: 0.6, cashEquityPct: 0.3, inKindEquityPct: 0, customerFundingPct: 0.1 },
  debtAnalytics: { peakDebt: 2834065875, remainingDebtAtExit: 0, tenorYears: 5 },
  equityExposure: { equityAtRisk: 300 },
  totalEquityInvested: 300,
  yearLabels: [2024, 2025, 2026], exitYearLabel: 2026,
};
const snap: any = {
  projectStartYear: 2024,
  bs: { debtOutstandingPerPeriod: [600, 300, 0] },
  directCF: { debtDrawdownPerPeriod: [600, 0, 0], interestPaidPerPeriod: [0, -38, -19], debtRepaymentPerPeriod: [0, -300, -300], cashFromOperationsPerPeriod: [0, 100, 100], cashFromInvestmentPerPeriod: [-900, 0, 0], cashFromFinancingPerPeriod: [600, -338, -319], closingCashPerPeriod: [0, 50, 80] },
  cashSweep: { totalSweepPerPeriod: [0, 100, 50] },
};
const project: any = { name: 'Test Project', location: 'Riyadh', country: 'KSA', covenants: [{ id: 'd', metric: 'dscr', operator: 'min', threshold: 1.2, label: 'DSCR' }, { id: 'l', metric: 'ltv', operator: 'max', threshold: 0.6, label: 'LTV' }, { id: 'y', metric: 'debt_yield', operator: 'min', threshold: 0.5, label: 'Debt Yield' }] };
const tranches: any = [{ name: 'Senior', interestRatePct: 6.3, ltvPct: 60, facilitySharePct: 100, sweepRatio: 100 }];
const assets: any = [{ name: 'Hotel', strategy: 'Operate', visible: true }];
const phases: any = [{ name: 'P1' }, { name: 'P2' }];
const parties: any = [{ id: '1', name: 'PaceMakers', identifier: null, roles: ['Sponsor', 'Prepared-by', 'Contact'] }];

const asOf = '2026-07-09';
function makeInputs(): ReportInputs {
  const d = defaultReportInputs();
  return { ...d, executiveSummary: 'Prime asset with strong yield.', securityCollateral: 'First-ranking mortgage.', covenantCommentary: 'Headroom on LTV.', thesisLine: 'Buy: yield beats cost of debt.', recommendation: 'Approve the investment.', disclaimers: 'Model outputs only.', headerText: 'TEST HEADER BAND', footerText: 'TEST FOOTER LINE', fontBody: 'Verdana', fontHeading: 'Georgia' };
}

const ic = buildICReportModel({ project, phases, assets, rs, snap, parties, asOf, scenarios: null, cases: [{ id: 'base' } as any] });
const lender = buildLenderReportModel({ project, financingTranches: tranches, rs, snap, parties, asOf });
const onePager = buildOnePagerReportModel({ project, phases, assets, rs, snap, parties, thesisLine: 'Buy: yield beats cost of debt.', asOf });

async function unzip(buf: Buffer): Promise<{ slideCount: number; allXml: string; tocRels: string }> {
  const z = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(z.files).filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f));
  const xmlFiles = Object.keys(z.files).filter((f) => /ppt\/.*\.xml$/.test(f));
  const parts = await Promise.all(xmlFiles.map((f) => z.file(f)!.async('string')));
  const tocRelsFile = z.file('ppt/slides/_rels/slide2.xml.rels');
  const tocRels = tocRelsFile ? await tocRelsFile.async('string') : '';
  return { slideCount: slideFiles.length, allXml: parts.join('\n'), tocRels };
}
const slideRelCount = (rels: string): number => (rels.match(/relationships\/slide"/g) ?? []).length;
const occ = (hay: string, needle: string): number => hay.split(needle).length - 1;

async function main() {
  const inputs = makeInputs();

  // ── IC ── (9 sections, cover excluded from nav => nav 8 => 2 + 16 = 18 slides)
  {
    const pptx = buildReportPptx({ reportType: 'ic', projectName: project.name, inputs, fmt, currency: 'SAR', asOf, ic, scenarios: null });
    const { slideCount, allXml, tocRels } = await unzip(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
    check('IC slide count = 18 (cover + ToC + 8 sections x 2)', slideCount === 18);
    check('IC section titles present (Headline Returns, Development Economics, Capital Structure)', allXml.includes('Headline Returns') && allXml.includes('Development Economics') && allXml.includes('Capital Structure'));
    check('IC key values present (11.9% / 8.3% / 2.40x / 14,055)', allXml.includes('11.9%') && allXml.includes('8.3%') && allXml.includes('2.40x') && allXml.includes('14,055'));
    check('IC ToC has >= 8 internal slide links', slideRelCount(tocRels) >= 8);
    check('IC divider "Back to contents" present for each section (>= 8)', occ(allXml, 'Back to contents') >= 8);
    check('IC applied fonts present (Verdana body + Georgia heading)', allXml.includes('Verdana') && allXml.includes('Georgia'));
    check('IC header + footer text applied', allXml.includes('TEST HEADER BAND') && allXml.includes('TEST FOOTER LINE'));
    check('IC narrative from form present (recommendation text)', allXml.includes('Approve the investment.'));
  }

  // ── Lender ── (11 sections, cover excluded => nav 10 => 2 + 20 = 22 slides)
  {
    const pptx = buildReportPptx({ reportType: 'lender', projectName: project.name, inputs, fmt, currency: 'SAR', asOf, lender });
    const { slideCount, allXml, tocRels } = await unzip(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
    check('Lender slide count = 22 (cover + ToC + 10 sections x 2)', slideCount === 22);
    check('Lender section titles present (Facility Terms, Covenant Analysis, Repayment)', allXml.includes('Facility Terms') && allXml.includes('Covenant Analysis') && allXml.includes('Repayment'));
    check('Lender peak debt present (2,834,065,875)', allXml.includes('2,834,065,875'));
    check('Lender facility rate present (6.30%)', allXml.includes('6.30%'));
    check('Lender covenant verdicts present (PASS + FAIL)', allXml.includes('PASS') && allXml.includes('FAIL'));
    check('Lender narrative from form present (security + covenant commentary)', allXml.includes('First-ranking mortgage.') && allXml.includes('Headroom on LTV.'));
    check('Lender ToC has >= 10 internal slide links', slideRelCount(tocRels) >= 10);
  }

  // ── One-Pager ── (6 sections, no cover => nav 6 => 2 + 12 = 14 slides)
  {
    const pptx = buildReportPptx({ reportType: 'onepager', projectName: project.name, inputs, fmt, currency: 'SAR', asOf, onePager });
    const { slideCount, allXml, tocRels } = await unzip(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
    check('One-Pager slide count = 14 (cover + ToC + 6 sections x 2)', slideCount === 14);
    check('One-Pager sections present (Deal at a Glance, Capital Ask, Timeline)', allXml.includes('Deal at a Glance') && allXml.includes('Capital Ask') && allXml.includes('Timeline'));
    check('One-Pager headline values present (11.9% / 2.40x)', allXml.includes('11.9%') && allXml.includes('2.40x'));
    check('One-Pager thesis line present', allXml.includes('Buy: yield beats cost of debt.'));
    check('One-Pager ToC has >= 6 internal slide links', slideRelCount(tocRels) >= 6);
  }

  // ── show/hide + reorder respected (IC) ──
  {
    const inp = makeInputs();
    const icCfg = inp.sectionConfig.ic.map((x) => ({ ...x }));
    // Hide disclaimers; move recommendation to the front.
    for (const x of icCfg) { if (x.key === 'disclaimers') x.visible = false; if (x.key === 'recommendation') x.order = -1; }
    inp.sectionConfig = { ...inp.sectionConfig, ic: icCfg };
    const pptx = buildReportPptx({ reportType: 'ic', projectName: project.name, inputs: inp, fmt, currency: 'SAR', asOf, ic, scenarios: null });
    const { slideCount, allXml } = await unzip(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
    check('hide: disclaimers removed drops 2 slides (18 -> 16)', slideCount === 16);
    check('hide: "Disclaimers" title no longer in deck', !allXml.includes('Disclaimers'));
    // ToC (slide2) lists Recommendation before Headline Returns after the reorder.
    const toc = allXml.slice(allXml.indexOf('Contents'));
    check('reorder: Recommendation appears before Headline Returns in ToC', toc.indexOf('Recommendation') >= 0 && toc.indexOf('Recommendation') < toc.indexOf('Headline Returns'));
  }

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
