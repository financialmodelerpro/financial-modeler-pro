/**
 * buildModelWorkbook.ts
 *
 * Formula-driven Excel model export (PHASE 1: foundation). Builds an ExcelJS
 * workbook from the live project: a Cover/Index, a centralised Assumptions
 * (Inputs) sheet, a formula-driven Timeline, and a Checks/legend sheet. Later
 * phases add the calculation + statement + returns sheets, each formula-linked
 * to the Assumptions and reconciled to the platform snapshot via the
 * { formula, result } cache pattern (see styles.fcell).
 *
 * Conventions: blue inputs, black formulas, green cross-sheet links (FAST).
 * Separation of Inputs (Assumptions) / Calculations / Outputs is structural:
 * inputs live only on Assumptions; every other sheet references them by name or
 * cell, so nothing is hardcoded in the calculations.
 *
 * Pure: reads computeFinancialsSnapshot + state, returns a workbook.
 */
import { buildReceivablesRollForward, buildUnearnedRollForward } from '../reports/saleRollForwardReports';
import ExcelJS from 'exceljs';
import { buildSaleCohortTermsBlock, saleCohortRuleText, buildSaleCohortGrid, saleCohortGridCaption } from '../reports/saleCohortReports';
import JSZip from 'jszip';
import { computeFinancialsSnapshot, computeFundingGap, type FinancialsResolverState } from '../financials-resolvers';
import { buildCapexReport, type CapexReport } from '../reports/capexReports';
import { poolMapByLine, poolCapexByLine, poolReturnRows, poolResults, lineHosts, fixHospitalityRates, fixLeaseRates, poolRevenueBasisByLine, poolSaleCohortByLine } from '../reports/lineRows';
import { revenueBySection } from '../reports/revenueSections';
import { scheduleWithDisposal, idcWithDisposal, disposalContextOf } from '../reports/disposalSchedules';
import { buildFinancingScheduleTables, buildCashSweepTables, type ReportTable } from '../reports/financingReports';
import { buildFcffBuildup, buildFcfeBuildup, buildDividendBuildup, m4StreamRow } from '../reports/streamReports';
import { buildIntegrityChecks, checkDetail, buildRevenueBasisAdvisoriesFor, revenueBasisAdvisoryText, buildSaleCohortAdvisories, saleCohortAdvisoryText } from '../reports/checksReport';
import { buildCostOfSalesReport } from '../reports/cosReports';
import { buildOpexReport } from '../reports/opexReports';
import { buildPLRows, buildDirectCFRows, buildIndirectCFRows, buildBSRows, buildFundFeeBasisRows, buildFundCapitalRows, fundFeeBasisBaseCell, totalColumnHeading, totalColumnNote, TOTAL_COLUMN_HEADINGS, TOTAL_COLUMN_NOTES, FUND_CAPITAL_BASES_TITLE, FUND_CAPITAL_BASES_NOTE, FUND_CAPITAL_BASE_TAG, type M4ReportCtx, type FundFeeBasisRow } from '../reports/m4Reports';
import { buildCaseComparisonReport, type CaseComparisonInput, type CaseComparisonReport, type CaseKpiKind } from '../reports/caseComparisonReport';
import { buildCaseYoYReport, type CaseYoYReport } from '../reports/caseYoYReport';
import { formatAssumptionValue } from '../cases/assumptionGrid';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { computeReturnsSnapshot, type ReturnsSnapshot } from '../returns-resolvers';
import type { M4Row } from '../../components/modules/_shared/m4Table';
import { resolveAssetAreaMetrics, computePhaseTimeline, computeProjectTimeline, resolveSubUnitAdr, type AssetAreaMetrics } from '@/src/core/calculations';
import { FUNDING_METHOD_LABELS, type FundingMethodId } from '../state/module1-types';
import { resolveFundTerms } from '../fundTerms';
import {
  isFundActive, hasFundFeeIncome, buildFundWaterfallRows, buildFundFeeIncomeRows,
  buildFundGrossNetRows, buildFundEarnerRows, buildFundHeadlineCards, fundGrossNetNote,
  fundWaterfallTotalsNote, fundHeadlineRestatementNote,
  FUND_GROSS_NET_COLUMNS, FUND_EARNER_COLUMNS, type FundReportCtx,
} from '../reports/fundReports';
import { buildAssetNotes, structuralZeroCell } from '../reports/assetNotes';
import { formatAccounting } from '@/src/core/formatters';
import { computeLiveModel, type LiveAssetInput, type LiveModel, type LiveGroup } from './liveModel';
import {
  ARGB, NUMFMT, BODY_SIZE, fcell, setInput, markInput, setFormula, setLabel, setTitle, setSectionHeader, setColHeader, colLetter,
  fillCell, fillRange, boxBorder, sheetRef, scaleMoneyFormats, scaleNote, defaultDecimals, setStaticMode, setNote, setBasis, setSectionSink, insertRowsAt, type DisplayScale, type DisplayDecimals,
} from './styles';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
// Module 2 and Module 3 mirror (addRevenue / addOpex).
import { planRevenueLines, groupRevenueLines, lineForAsset, REVENUE_SECTIONS, REVENUE_SECTION_META, type RevenueLine } from '../revenueLines';
import { lineRevenueResults, resolveRowVelocity, expandIndexationToAxis, resolveSellConfig, resolveHospitalityConfig, resolveLeaseConfig, resolveAssetKeys } from '../revenue-resolvers';
import { revenueLineName, buildProjectRevenueGroupedRows, PROJECT_REVENUE_TABLES, buildShareSoldRows, buildPrePostRows, buildRevenueScheduleFeeds } from '../reports/revenueOutputReports';
import { buildInventoryRollForward } from '../reports/saleRollForwardReports';
import { planReportLines, lineTitle } from '../reports/lineRows';
import { OPEX_CATEGORY_LABELS, OPEX_MODE_LABELS, isFixedCostOpexMode, summarizeOpexIndexation, opexLineInflationText } from '../reports/opexInputLabels';
import { resolveCohortDownpayment, resolveAssetDownpaymentSource } from '../state/saleCohortResolution';
import { resolveAvgUnitSize } from '../state/assetTypeStandards';
import { priceKeyFor, hasDualPrice } from '../state/subUnitPrices';
import type { Asset, Phase, SubUnit } from '../state/module1-types';
import { computeSubUnitArea, resolveSubUnitMetric, keysFromArea } from '@/src/core/calculations';
import { applyIndexation, buildAccountsReceivable, buildUnearnedRevenue } from '@/src/core/calculations/revenue';
import { defaultHQOpexLines, normalizeOpexIndexation, type OpexLine } from '@/src/core/calculations/opex';
import type { IndexationConfig } from '@/src/core/calculations/revenue/types';
import { assetPlotLabel } from '@/src/core/calculations/assetName';

export interface BuildModelOptions {
  state: FinancialsResolverState;
  projectName: string;
  dateLabel: string;
  /** Workbook-wide DISPLAY scale (cosmetic number format only; stored values +
   *  formulas stay in full units). Defaults to 'full'. */
  displayScale?: DisplayScale;
  /** Money decimal places (display only). Defaults per scale: 0 for full /
   *  thousands, 1 for millions. Percentages are always 2dp regardless. */
  displayDecimals?: DisplayDecimals;
  /** Content-type filter, mirroring the PDF export's Inputs / Schedules / Outputs
   *  checkboxes. A false flag HIDES that category's sheets (the model is
   *  formula-linked across sheets, so hiding keeps every formula intact while
   *  showing only the selected categories; omitting sheets would break refs).
   *  Undefined / omitted = every sheet visible (backward compatible). */
  parts?: ExcelPartSelection;
  /** Scenario cases (Module 6). When supplied, a Scenarios sheet is emitted that
   *  compares EVERY case (Management base + each scenario) through the same
   *  engine the platform uses: a cases + differing-assumptions grid, a headline
   *  KPI comparison matrix (delta vs base) and the per-period year-on-year
   *  impact. The `state` above still drives the statement tabs (the selected
   *  case); this bundle always compares all cases. Omitted = the Scenarios sheet
   *  shows a short "no scenarios" note. */
  caseComparison?: CaseComparisonInput;
}

export interface ExcelPartSelection { inputs?: boolean; outputs?: boolean; schedules?: boolean }

// Which content category each sheet belongs to. Cover + Checks are ALWAYS shown
// (title + validation). Inputs = pure assumptions; Schedules = the domain
// build-ups + BS feeders; Outputs = the statements + returns. Mirrors the PDF's
// Inputs / Schedules / Outputs parts.
type SheetPart = 'inputs' | 'schedules' | 'outputs' | 'always';

const SHEETS = { cover: 'Cover', guide: 'Guide', summary: 'Summary', assumptions: 'Inputs', timeline: 'Timeline', landArea: 'Land & Area', capex: 'Capex', revenue: 'Revenue', opex: 'Opex', financing: 'Financing', schedules: 'Schedules', pl: 'P&L', cashflow: 'Cash Flow', balsheet: 'Balance Sheet', returns: 'Returns', scenarios: 'Scenarios', checks: 'Checks' };

/** Row count above which the Summary tab can no longer honestly claim to be one
 *  page. The designed canvas (facts, tiles, two highlight tables, footer) lands
 *  comfortably under this; only the appended fund block pushes past it. */
const SUMMARY_ONE_PAGE_ROWS = 60;

const SHEET_PART: Record<string, SheetPart> = {
  [SHEETS.cover]: 'always',
  [SHEETS.summary]: 'always',
  [SHEETS.assumptions]: 'inputs',
  [SHEETS.timeline]: 'inputs',
  [SHEETS.landArea]: 'inputs',
  [SHEETS.capex]: 'schedules',
  [SHEETS.financing]: 'schedules',
  [SHEETS.revenue]: 'schedules',
  [SHEETS.opex]: 'schedules',
  [SHEETS.schedules]: 'schedules',
  [SHEETS.pl]: 'outputs',
  [SHEETS.cashflow]: 'outputs',
  [SHEETS.balsheet]: 'outputs',
  [SHEETS.returns]: 'outputs',
  [SHEETS.scenarios]: 'outputs',
  [SHEETS.checks]: 'always',
};

/** Honor the Inputs / Schedules / Outputs filter by HIDING the sheets of any
 *  unticked category (formulas stay intact; only visibility changes). No-op when
 *  parts is undefined. Cover + Checks always stay visible, so Excel always has at
 *  least one visible sheet. */
function applyPartVisibility(wb: ExcelJS.Workbook, parts?: ExcelPartSelection): void {
  if (!parts) return;
  const on = (p: SheetPart): boolean =>
    p === 'always' ? true : p === 'inputs' ? parts.inputs !== false : p === 'schedules' ? parts.schedules !== false : parts.outputs !== false;
  for (const [name, part] of Object.entries(SHEET_PART)) {
    if (on(part)) continue;
    const ws = wb.getWorksheet(name);
    if (ws) ws.state = 'hidden';
  }
}

export function buildModelWorkbook(opts: BuildModelOptions): ExcelJS.Workbook {
  // HARDCODED platform mirror: every computed cell is written as the platform
  // snapshot value (a constant), not a live formula. The workbook lets a user
  // read all results and run their own scenarios manually; editing a cell does
  // NOT recalculate, the user re-exports from the platform after changing inputs.
  setStaticMode(true);
  // ASSET NAMES ARE RESOLVED AT THE FRONT DOOR. This file reads an asset name
  // in 26 places and several are MAP KEYS, not labels, so resolving the labels
  // only would file a row under one name and look it up under another. Doing it
  // once here keeps every key and every label the same string by construction,
  // and an asset with no name is written out under its type.
  opts = { ...opts, state: { ...opts.state, assets: withResolvedAssetNames(opts.state.assets, { parcels: opts.state.parcels, phases: opts.state.phases }) } };
  const snap = computeFinancialsSnapshot(opts.state);
  const capex = buildCapexReport(snap, opts.state);
  // The pure twin gives the row STRUCTURE + the few fields the snapshot does not
  // expose directly; buildRealModel then overrides every displayed figure with
  // the real platform snapshot value, so the statements tie exactly to the
  // platform (Capex + Land already use the real engine reports/metrics).
  const { assets: liveAssets, proj } = prepareLiveModel(snap, opts.state, capex);
  const twin = computeLiveModel(liveAssets, proj);
  const lm = buildRealModel(twin, snap, liveAssets);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Financial Modeler Pro';
  wb.created = new Date(0); // deterministic (avoid clock for reproducible output)
  wb.calcProperties.fullCalcOnLoad = true;

  // Section registry: every navy section header (via setSectionHeader) records
  // its sheet + title + row, so the Cover can build a second-level Table of
  // Contents that jumps INTO each section, and each tab can list what it covers.
  const sectionReg = new Map<string, Array<{ title: string; row: number }>>();
  setSectionSink((sheet, title, row) => { const l = sectionReg.get(sheet) ?? []; l.push({ title, row }); sectionReg.set(sheet, l); });

  // The Cover + Guide are created FIRST (so they stay tabs 1-2) but written LAST,
  // once every section row across the workbook is known.
  const coverWs = wb.addWorksheet(SHEETS.cover, { properties: { tabColor: { argb: ARGB.navy } }, views: [{ showGridLines: false }] });
  const guideWs = wb.addWorksheet(SHEETS.guide, { properties: { tabColor: { argb: ARGB.navy } }, views: [{ showGridLines: false }] });
  addSummary(wb, snap, opts, lm); // third tab; one-page executive summary
  // THE CAPEX INPUTS AND SCHEDULE BY CONSOLIDATED LINE (2026-09-15): a line's
  // plots pool into one block; each pooled line's bases sum its plots' Land &
  // Area cells. The live twin above keeps the per-asset report.
  const capexByLine = poolCapexByLine(capex, opts.state);
  const refs = addAssumptions(wb, snap, opts, capexByLine.report);
  refs.capexMembers = capexByLine.members;
  addTimeline(wb, snap, refs, opts.state);
  const landAddrs = addLandArea(wb, opts.state, refs);
  const lineLandAddrs = new Map(landAddrs);
  for (const [host, ids] of capexByLine.members) {
    const parts = ids.map((id) => landAddrs.get(id)).filter((x): x is LandAreaAssetAddrs => !!x);
    if (parts.length < 2) continue;
    const join = (k: keyof LandAreaAssetAddrs): string => `(${parts.map((x) => x[k]).join('+')})`;
    lineLandAddrs.set(host, { landValue: join('landValue'), cashLand: join('cashLand'), inKindLand: join('inKindLand'), unitCount: join('unitCount'), revenue: join('revenue') });
  }
  const capexAddrs = addCapex(wb, snap, capexByLine.report, refs, lineLandAddrs);

  // Excel base-cell formula per asset: Sell links the Land & Area GDV cell;
  // Operate / Lease build the stabilised annual revenue from the sub-unit inputs.
  const revBaseFormula = new Map<string, string>();
  for (const a of liveAssets) {
    if (a.revKind === 'gdv') { revBaseFormula.set(a.id, landAddrs.get(a.id)?.revenue ?? '0'); continue; }
    const subs = refs.subUnits.filter((s) => s.assetId === a.id);
    const parts = subs.map((s) => {
      const su = opts.state.subUnits.find((x) => x.id === s.id);
      return su?.metric === 'units' ? `${s.value}*${s.price}*365` : `${s.value}*${s.price}`;
    });
    revBaseFormula.set(a.id, parts.length ? parts.join('+') : '0');
  }

  // Tab sequence follows the platform module order. Financing is Module 1
  // (Tab 4), so its sheet is created here, right after Capex, keeping all of
  // Module 1 (Inputs, Timeline, Land & Area, Capex, Financing) together, then
  // Module 2 (Revenue, Cost of Sales), Module 3 (Opex), Module 4 (P&L, Cash
  // Flow, Balance Sheet) and Module 5 (Returns). Financing owns the
  // computational recurrence (depreciation, interest, tax, debt / equity / cash
  // flow) read straight from the snapshot, so it does NOT depend on the
  // downstream Revenue / CoS / Opex link registries; P&L / Cash Flow / Balance
  // Sheet / Returns are link-and-assemble presentation tabs. Each emitter
  // returns the row registry the next links to.
  const ctx: EmitCtx = { wb, snap, state: opts.state, refs, lm, proj, assets: liveAssets, landAddrs, capexAddrs, revBaseFormula, currency: opts.state.project.currency ?? 'SAR', labelMoney: makeLabelMoney(opts.displayScale ?? 'full', opts.displayDecimals ?? defaultDecimals(opts.displayScale ?? 'full')), caseComparison: opts.caseComparison };
  const finLinks = addFinancing(ctx);
  const { revLinks } = addRevenue(ctx);
  const opexLinks = addOpex(ctx);
  addSchedules(ctx);
  addProfitLoss(ctx);
  addCashFlow(ctx);
  addBalanceSheet(ctx);
  const retLinks = addReturns(ctx, revLinks, opexLinks, finLinks);
  // Module 6 (Scenario Analysis): compares every case. Placed after Returns
  // (Module 5), before Checks, so the tab sequence keeps the platform module
  // order. Always emitted (shows a note when no scenarios are defined).
  addScenarios(ctx);
  addChecks(ctx, capexAddrs, retLinks);

  // Stop capturing sections (the guideline blocks below must not register), then
  // add the navigation + guidance layer: the Cover Table of Contents with
  // clickable second-level section links, a per-tab "Covers" line, and a
  // "How this tab is calculated" guideline block appended to every tab. All of
  // this is additive / appended, so the frozen headers, the label-based
  // reconciliation and the locked palette + tab order are untouched.
  // ORDER MATTERS. The guide blocks append at the bottom (so they need the final
  // row count), the sub-TOC then inserts rows at the TOP of each tab, which
  // shifts every section row and the guide row down. Both re-base `sectionReg`
  // as they go, so the Cover and Guide, built last, link to the corrected rows.
  setSectionSink(null);
  const guideRows = applyTabGuides(wb, sectionReg);
  applyTabSubToc(wb, sectionReg, guideRows);
  buildCoverContent(coverWs, snap, opts, sectionReg);
  buildGuideContent(guideWs, snap, opts, sectionReg);

  // Workbook-wide DISPLAY scale: re-format magnitude money cells (display only;
  // stored values + formulas stay in full units). Applied last so every sheet's
  // cells are set.
  const scale = opts.displayScale ?? 'full';
  const decimals = opts.displayDecimals ?? defaultDecimals(scale);
  scaleMoneyFormats(wb, scale, decimals);
  const note = scaleNote(scale, opts.state.project.currency ?? 'SAR');
  if (note) {
    for (const name of [SHEETS.landArea, SHEETS.capex, SHEETS.revenue, SHEETS.opex, SHEETS.financing, SHEETS.schedules, SHEETS.pl, SHEETS.cashflow, SHEETS.balsheet, SHEETS.scenarios]) {
      const ws = wb.getWorksheet(name); if (!ws) continue;
      const a2 = ws.getCell('A2'); const cur = typeof a2.value === 'string' ? a2.value : '';
      setLabel(a2, cur ? `${cur}  (${note})` : note);
    }
  }
  // Print setup: a professional, print-ready page layout on every sheet (fit to
  // width, repeated header rows, centred cover / summary, page-numbered footer).
  applyPrintSetup(wb);
  // Apply the Inputs / Schedules / Outputs filter LAST (hide unticked categories).
  applyPartVisibility(wb, opts.parts);
  return wb;
}

// Sheets that carry the shared 4-row frozen header (writeSheetHeader): repeat
// rows 1-4 on every printed page so the period axis is never orphaned.
const HEADER4_SHEETS = new Set<string>([
  SHEETS.revenue, SHEETS.opex, SHEETS.financing, SHEETS.schedules,
  SHEETS.pl, SHEETS.cashflow, SHEETS.balsheet, SHEETS.returns, SHEETS.scenarios,
]);

/** Give every sheet a print-ready page layout: A4, tight margins, fit-to-width,
 *  landscape for the wide period tables (repeating the header rows) and a centred
 *  single portrait page for the Cover + Summary. Cosmetic only (no cell change),
 *  so the reconciliation + palette locks are untouched. */
function applyPrintSetup(wb: ExcelJS.Workbook): void {
  for (const ws of wb.worksheets) {
    const name = ws.name;
    // The Summary is a one-page canvas by design, but the fund block appended
    // to it makes that impossible to honour: forcing fit-to-height 1 would
    // shrink the whole page to unreadable. So on a FUND project the Summary
    // flows to a second page instead (fitToHeight 0), and on a standalone
    // project it is exactly the one-page sheet it has always been.
    const summaryHasFund = name === SHEETS.summary && (ws.rowCount ?? 0) > SUMMARY_ONE_PAGE_ROWS;
    const portraitOnePage = name === SHEETS.cover || (name === SHEETS.summary && !summaryHasFund);
    const narrow = name === SHEETS.checks || name === SHEETS.guide || summaryHasFund; // portrait, flowing to multiple pages
    ws.pageSetup = {
      paperSize: 9, // A4
      orientation: portraitOnePage || narrow ? 'portrait' : 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: portraitOnePage ? 1 : 0,
      horizontalCentered: portraitOnePage,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
      printTitlesRow: HEADER4_SHEETS.has(name) ? '1:4' : name === SHEETS.assumptions ? '1:2' : undefined,
    };
    // Page-numbered footer with the platform brand; sheet name centred.
    ws.headerFooter = {
      oddFooter: '&L&"Calibri"&8&K1B3A6B Financial Modeler Pro&C&"Calibri"&8&K1B3A6B &A&R&"Calibri"&8&K1B3A6B Page &P of &N',
    };
  }
}

// Shared context threaded through every downstream emitter.
interface EmitCtx {
  wb: ExcelJS.Workbook;
  snap: ReturnType<typeof computeFinancialsSnapshot>;
  state: FinancialsResolverState;
  refs: AssumptionRefs;
  lm: LiveModel;
  proj: import('./liveModel').LiveProjectInput;
  assets: LiveAssetInput[];
  landAddrs: Map<string, LandAreaAssetAddrs>;
  capexAddrs: CapexAddrs;
  revBaseFormula: Map<string, string>;
  currency: string;
  /** Money as it reads INSIDE a row label, already following the workbook
   *  display scale (see makeLabelMoney: value cells are rescaled at the end of
   *  the build, label text is not, so the scale has to travel with the ctx). */
  labelMoney: (v: number) => string;
  /** Scenario cases (Module 6). Feeds the Scenarios sheet; undefined = no cases. */
  caseComparison?: CaseComparisonInput;
}

// ── Pure live-model inputs (cached values + scalars) from the snapshot ─────────
function prepareLiveModel(snap: ReturnType<typeof computeFinancialsSnapshot>, state: FinancialsResolverState, capex: CapexReport): { assets: LiveAssetInput[]; proj: import('./liveModel').LiveProjectInput } {
  const N = snap.axisLength;
  const padN = (a: number[] | undefined): number[] => { const o = (a ?? []).slice(0, N); while (o.length < N) o.push(0); return o; };
  const sum = (a: number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);
  // BY ASSET ID, NOT BY DISPLAY LABEL (2026-09-10). This dug the per-asset
  // series out of a summary table by matching the row label to `asset.name`;
  // the summary tables now consolidate by phase and type, and a label was never
  // an identity in the first place. `assetSeries` is the report's own per-asset
  // output, keyed by id.
  const capexById = new Map(capex.assetSeries.map((x) => [x.assetId, x] as const));

  const metricsById = new Map<string, AssetAreaMetrics>();
  for (const a of state.assets.filter((x) => x.visible !== false)) {
    const inPhase = state.assets.filter((x) => x.phaseId === a.phaseId);
    metricsById.set(a.id, resolveAssetAreaMetrics(a, state.project, state.parcels, inPhase, state.subUnits, state.landAllocationMode));
  }

  const assets: LiveAssetInput[] = [];
  for (const a of state.assets.filter((x) => x.visible !== false)) {
    const group = strategyGroup(a.strategy);
    const phase = state.phases.find((p) => p.id === a.phaseId);
    const phaseStartYear = phase?.startDate ? new Date(phase.startDate).getUTCFullYear() : snap.projectStartYear;
    const offset = Math.max(0, phaseStartYear - snap.projectStartYear);
    const m = metricsById.get(a.id);
    const cx = capexById.get(a.id);
    const inclPer = padN(cx?.inclAll);
    const exclInKindPer = padN(cx?.exclInKind);
    const exclAllPer = padN(cx?.exclAll);
    const gdv = m?.totalRevenue ?? 0;
    const subs = state.subUnits.filter((s) => s.assetId === a.id);
    const annualBase = subs.reduce((s, su) => {
      const val = su.metricValue ?? 0; const price = resolveSubUnitAdr(su);
      return s + (su.metric === 'units' ? val * price * 365 : val * price);
    }, 0);
    const revKind: 'gdv' | 'annual' = group === 'Residential' ? 'gdv' : 'annual';
    const revBaseCached = revKind === 'gdv' ? gdv : annualBase;
    const engRev = padN(
      group === 'Residential' ? snap.revenue.bySellAsset.get(a.id)?.recognitionPerPeriod
        : group === 'Hospitality' ? snap.revenue.byHospitalityAsset.get(a.id)?.totalRevenuePerPeriod
          : group === 'Retail' ? snap.revenue.byLeaseAsset.get(a.id)?.totalRevenuePerPeriod : [],
    );
    const revProfile = engRev.map((v) => (revBaseCached > 0 ? v / revBaseCached : 0));
    const engOpex = padN(snap.opex.byAsset.get(a.id)?.totalOpexPerPeriod);
    const revTot = sum(engRev); const opexTot = sum(engOpex);
    const opexMargin = group !== 'Residential' && revTot > 0 ? Math.min(1, Math.max(0, 1 - opexTot / revTot)) : 0;
    const inclTotal = sum(inclPer);
    assets.push({
      id: a.id, name: a.name, strategy: a.strategy, group,
      offset, cp: phase?.constructionPeriods ?? 0, op: phase?.operationsPeriods ?? 0,
      usefulLife: a.usefulLifeYears ?? 0,
      revBaseCached, revKind, revProfile,
      inclPerPeriod: inclPer, exclInKindPerPeriod: exclInKindPer, exclAllPerPeriod: exclAllPer,
      inclTotal, exclInKindTotal: sum(exclInKindPer), exclAllTotal: sum(exclAllPer),
      landCashTotal: m?.cashLandValue ?? 0, landInKindTotal: m?.inKindLandValue ?? 0,
      cosRatioCached: group === 'Residential' && gdv > 0 ? inclTotal / gdv : 0,
      opexMargin,
    });
  }

  const p = state.project;
  const fin = snap.financing;
  const trancheRates = state.financingTranches.map((t) => (t.interestRatePct ?? ((t.interbankRatePct ?? 0) + (t.creditSpreadPct ?? 0))) / 100).filter((r) => r > 0);
  const debtRate = trancheRates.length ? trancheRates.reduce((s, r) => s + r, 0) / trancheRates.length : 0;
  const proj: import('./liveModel').LiveProjectInput = {
    N,
    taxRate: Math.max(0, p.tax?.rate ?? 0),
    debtPct: (fin.funding.debtPct ?? 0) / 100,
    equityPct: (fin.funding.equityPct ?? 0) / 100,
    debtRate,
    minCash: p.financing?.minimumCashReserve ?? fin.funding.minCashReserve ?? 0,
    dsoDays: p.operatingAr?.dsoDays ?? 0,
    dpoDays: p.opexAp?.defaultApDays ?? 0,
    discountRate: p.returns?.discountRate ?? 0.1,
    exitOffset: p.returns?.exitYearOffset ?? (N - 1),
    exitMultiple: p.returns?.exitMultiple ?? 8,
    terminalMethod: String(p.returns?.terminalMethod ?? 'exit_multiple'),
    perpetuityGrowth: p.returns?.perpetuityGrowth ?? 0.02,
    hqOpexCached: padN(snap.opex.hq.totalOpexPerPeriod),
  };
  return { assets, proj };
}

/**
 * Override the twin's DISPLAYED series with the real platform snapshot values,
 * so the hardcoded workbook ties exactly to the platform (P&L, Cash Flow,
 * Balance Sheet, Revenue, Opex, Financing). The twin still supplies the row
 * structure plus the handful of internal fields the snapshot does not expose
 * (sellIncl / operateConstruction / operateLand / arDelta / apDelta) and the
 * Returns block (computed from the same drivers). Capex + Land & Area already
 * render the real engine report / metrics, so they are untouched here.
 */
function buildRealModel(twin: LiveModel, snap: ReturnType<typeof computeFinancialsSnapshot>, assets: LiveAssetInput[]): LiveModel {
  const N = snap.axisLength;
  const pad = (a: number[] | undefined): number[] => { const o = (a ?? []).slice(0, N); while (o.length < N) o.push(0); return o; };
  const diff = (a: number[], b: number[]): number[] => Array.from({ length: N }, (_, t) => (a[t] ?? 0) - (b[t] ?? 0));
  const sumBy = (pick: (id: string) => number[] | undefined, keep: (g: LiveGroup) => boolean): number[] => {
    const o = new Array<number>(N).fill(0);
    for (const a of assets) { if (!keep(a.group)) continue; const s = pad(pick(a.id)); for (let t = 0; t < N; t++) o[t] += s[t]; }
    return o;
  };
  const pl = snap.pl, cf = snap.directCF, bs = snap.bs;
  const revByAsset = new Map<string, number[]>();
  const cosByAsset = new Map<string, number[]>();
  const opexByAsset = new Map<string, number[]>();
  const daByAsset = new Map<string, number[]>();
  for (const a of assets) {
    const ap = snap.perAssetPL.get(a.id);
    revByAsset.set(a.id, pad(ap?.revenuePerPeriod));
    cosByAsset.set(a.id, pad(ap?.cosPerPeriod));
    opexByAsset.set(a.id, pad(ap?.opexPerPeriod));
    daByAsset.set(a.id, pad(ap?.daPerPeriod));
  }
  const patReal = pad(pl.patPerPeriod);
  const pbtReal = pad(pl.pbtPerPeriod);
  const debtClose = pad(bs.debtOutstandingPerPeriod);
  const debtOpen = Array.from({ length: N }, (_, t) => (t === 0 ? 0 : debtClose[t - 1]));
  const arReal = Array.from({ length: N }, (_, t) => (pad(bs.arPerPeriod)[t] + pad(bs.residentialReceivablesPerPeriod)[t]));
  return {
    ...twin,
    // Revenue
    revByAsset,
    residentialRev: sumBy((id) => revByAsset.get(id), (g) => g === 'Residential'),
    hospitalityRev: sumBy((id) => revByAsset.get(id), (g) => g === 'Hospitality' || g === 'Other'),
    retailRev: sumBy((id) => revByAsset.get(id), (g) => g === 'Retail'),
    totalRev: pad(pl.totalRevenuePerPeriod),
    // Cost of sales
    cosByAsset, cosTotal: pad(pl.cosPerPeriod),
    // Opex
    opexByAsset,
    hospitalityOpex: sumBy((id) => opexByAsset.get(id), (g) => g === 'Hospitality' || g === 'Other'),
    retailOpex: sumBy((id) => opexByAsset.get(id), (g) => g === 'Retail'),
    hqOpex: pad(snap.opex.hq.totalOpexPerPeriod),
    totalOpex: pad(pl.totalOpexPerPeriod),
    // P&L
    ebitda: pad(pl.ebitdaPerPeriod), daByAsset, da: pad(pl.daPerPeriod), ebit: pad(pl.ebitPerPeriod),
    interest: pad(pl.interestExpensePerPeriod), pbt: pbtReal, tax: diff(pbtReal, patReal), pat: patReal,
    // Capex cash basis (CFI) + in-kind land (= in-kind equity)
    capexCash: pad(cf.capexPerPeriod), inKind: pad(cf.equityInKindDrawdownPerPeriod),
    // Debt / equity schedule
    debtOpen, debtDraw: pad(cf.debtDrawdownPerPeriod), principal: pad(cf.debtRepaymentPerPeriod), debtClose,
    equityCash: pad(cf.equityDrawdownPerPeriod), equityInKind: pad(cf.equityInKindDrawdownPerPeriod),
    // Working capital + direct cash flow
    ar: arReal, ap: pad(bs.apPerPeriod),
    revReceived: pad(cf.revenueReceivedPerPeriod), opexPaid: pad(cf.opexPaidPerPeriod), taxPaid: pad(cf.taxPaidPerPeriod),
    cfo: pad(cf.cashFromOperationsPerPeriod), cfi: pad(cf.cashFromInvestmentPerPeriod), cff: pad(cf.cashFromFinancingPerPeriod),
    netCf: pad(cf.netCashFlowPerPeriod), openCash: pad(cf.openingCashPerPeriod), closeCash: pad(cf.closingCashPerPeriod),
    // Balance sheet
    inventory: pad(bs.inventoryPerPeriod), nbv: pad(bs.nbvPerPeriod), land: pad(bs.landPerPeriod),
    totalFA: pad(bs.totalFixedAssetsPerPeriod), totalCA: pad(bs.totalCurrentAssetsPerPeriod), totalAssets: pad(bs.totalAssetsPerPeriod),
    totalLiab: pad(bs.totalLiabilitiesPerPeriod), shareCapital: pad(bs.shareCapitalPerPeriod), retained: pad(bs.retainedEarningsPerPeriod),
    totalEquity: pad(bs.totalEquityPerPeriod), totalLE: pad(bs.totalLiabilitiesAndEquityPerPeriod), bsDiff: pad(bs.bsDifferencePerPeriod),
  };
}

export async function generateModelWorkbookBuffer(opts: BuildModelOptions): Promise<ArrayBuffer> {
  const wb = buildModelWorkbook(opts);
  const buf = await wb.xlsx.writeBuffer();
  return enableIterativeCalc(buf);
}

/**
 * ExcelJS hardcodes <calcPr> and cannot emit the iterative-calculation flags the
 * model needs (the debt / IDC / cash-sweep / funding formulas are circular).
 * Post-process the .xlsx zip to add iterate / iterateCount / iterateDelta to
 * xl/workbook.xml so Excel converges the circular formulas on open.
 */
async function enableIterativeCalc(buf: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const f = zip.file('xl/workbook.xml');
    if (!f) return buf;
    let xml = await f.async('string');
    const ITER = 'iterate="1" iterateCount="100" iterateDelta="0.001"';
    if (/<calcPr\b/.test(xml)) {
      xml = xml.replace(/<calcPr\b([^>]*?)\/>/, (_m, attrs: string) => {
        const cleaned = attrs.replace(/\s+iterate(Count|Delta)?="[^"]*"/g, '');
        return `<calcPr${cleaned} ${ITER}/>`;
      });
    } else {
      xml = xml.replace('</workbook>', `<calcPr calcId="171027" ${ITER}/></workbook>`);
    }
    zip.file('xl/workbook.xml', xml);
    return await zip.generateAsync({ type: 'arraybuffer' });
  } catch {
    return buf; // never block the export on the calc-flag tweak
  }
}

// Cell references the rest of the model links to (defined-name targets).
interface CapexLineRef {
  /** Cost-line id (phase-scoped), so percent_of_selected can find sibling rows. */
  id: string;
  /** Raw cost method, so the build-up picks the right live-basis source. */
  method: string;
  /** Sibling line ids summed as the base for percent_of_selected. */
  selectedLineIds: string[];
  /** Cost stage ('hard' etc.); percent_of_construction sums the 'hard' lines. */
  stage: string;
  /** Raw rate / percent the user entered (percent as 0..100), for reconciliation. */
  rate: number;
  /** True when the rate is a percentage (drives the UOM + Rate cell format). */
  isPercent: boolean;
  /** Human basis / unit-of-measure label (capexReports basisLabel), e.g.
   *  'per BUA sqm' / '% of In-kind land' / 'Fixed (lump sum)'. The Capex UOM col. */
  basis: string;
  name: string;
  /** Absolute cross-sheet address of the rate / % input cell on Assumptions. */
  rateAddr: string;
  /** Absolute address of the physical-quantity input cell on Assumptions, kept
   *  only for rate-x-area methods (metricKind 'area'); null otherwise. Derived
   *  money / count bases are computed live on the calc sheets, not stored here. */
  qtyAddr: string | null;
  /** Basis source for non-area methods, so the build-up can link live. */
  metricKind: 'area' | 'count' | 'money' | 'none';
  amount: number;
}
interface CapexAssetRef { assetId: string; name: string; phaseName: string; total: number; lines: CapexLineRef[] }

// Live-basis addresses captured on the Land & Area calc sheet, keyed by asset.
interface LandAreaAssetAddrs { landValue: string; cashLand: string; inKindLand: string; unitCount: string; revenue: string }

// Absolute cell addresses on the Assumptions sheet, captured as inputs are
// written, so the calc sheets reference inputs by cell (nothing hardcoded).
interface AssetInputRef {
  id: string; name: string; phaseId: string; strategy: string;
  bua: string; nsa: string; gfa: string; support: string; parking: string;
  parkingBays: string; usefulLife: string; landSqm: string; landRate: string;
}
interface SubUnitInputRef { id: string; assetId: string; category: string; metric: string; value: string; unitArea: string; price: string }
interface ParcelInputRef { id: string; area: string; rate: string; cashPct: string; inKindPct: string }
interface TrancheInputRef { id: string; name: string; openingBalance: string; rate: string; periods: string }
interface EquityInputRef { id: string; name: string; amount: string }
interface ExistingEquityRef { assetId: string; name: string; amount: string }
// Financing-policy scalar inputs (absolute Assumptions addresses), so the
// Financing tab's local Inputs block can link them in once and every formula on
// the tab references the LOCAL cell, not a long cross-sheet path.
interface FinancingScalarRefs { dividendEnabled: string; dividendPayout: string; dividendStart: string; sweepStart: string; sweepRatio: string }

interface AssumptionRefs {
  startYearName: string;
  axisLength: number;
  capex: CapexAssetRef[];
  /** A pooled capex line's plots, by its first plot's id (2026-09-15). */
  capexMembers?: Map<string, string[]>;
  assets: AssetInputRef[];
  subUnits: SubUnitInputRef[];
  parcels: ParcelInputRef[];
  tranches: TrancheInputRef[];
  equity: EquityInputRef[];
  /** Per-asset historical equity inputs (operational-phase assets), source of
   *  the Financing sheet's Existing-equity row. */
  existingEquity: ExistingEquityRef[];
  /** Financing-policy scalar input addresses (dividends + cash sweep), linked
   *  once into the Financing tab's local Inputs block. */
  financingScalars: FinancingScalarRefs;
}

// ── Assumptions (Inputs) ──────────────────────────────────────────────────────
function addAssumptions(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, opts: BuildModelOptions, capex: CapexReport): AssumptionRefs {
  const ws = wb.addWorksheet(SHEETS.assumptions, { properties: { tabColor: { argb: ARGB.navy } } });
  ws.getColumn(1).width = 36;
  ws.getColumn(2).width = 22;
  for (let c = 3; c <= 12; c++) ws.getColumn(c).width = 14;
  const p = opts.state.project;
  const fin = snap.financing;
  const assetRefs: AssetInputRef[] = [];
  const subUnitRefs: SubUnitInputRef[] = [];
  const parcelRefs: ParcelInputRef[] = [];
  const trancheRefs: TrancheInputRef[] = [];
  const equityRefs: EquityInputRef[] = [];
  const existingEquityRefs: ExistingEquityRef[] = [];
  const addr = (col: string, row: number): string => sheetRef(SHEETS.assumptions, `$${col}$${row}`);
  let r = 1;
  setTitle(ws.getCell(`A${r}`), 'Inputs (all model assumptions)', 16); r += 1;
  setLabel(ws.getCell(`A${r}`), 'Every model input, consolidated and grouped by type. Shaded cells are the inputs a user edits before re-exporting. This is a hardcoded snapshot: editing here does NOT recalculate the other tabs; change inputs in the platform and re-export.', { }); r += 2;

  // Project section.
  setSectionHeader(ws.getRow(r), 'Project', 5); r += 1;
  const addKV = (label: string, value: number | string, numFmt: string, name?: string): number => {
    setLabel(ws.getCell(`A${r}`), label);
    setInput(ws.getCell(`B${r}`), value, numFmt);
    if (name) wb.definedNames.add(`${SHEETS.assumptions}!$B$${r}`, name);
    const row = r; r += 1; return row;
  };
  addKV('Project name', p.name || '(unnamed)', '@');
  addKV('Currency', p.currency ?? 'SAR', '@');
  addKV('Location', [p.location, p.country].filter(Boolean).join(', ') || '-', '@');
  const taxRow = addKV('Tax / Zakat rate', p.tax?.rate ?? 0, NUMFMT.pct2, 'TaxRate');
  addKV('Country', p.country ?? '-', '@');
  addKV('Financial terminology', String(p.financialTerminology ?? 'standard'), '@');
  addKV('Tax / Zakat payment (days)', p.tax?.paymentDays ?? 0, NUMFMT.int);
  addKV('Statutory reserve transfer (% of PAT)', p.statutoryReserve?.transferRate ?? 0, NUMFMT.pct);
  addKV('Statutory reserve cap (% share capital)', p.statutoryReserve?.capOfShareCapital ?? 0, NUMFMT.pct);
  addKV('Share capital (explicit, 0 = auto)', p.shareCapital ?? 0, NUMFMT.money);
  addKV('Operating receivables, DSO (days)', p.operatingAr?.dsoDays ?? 0, NUMFMT.int, 'DsoDays');
  addKV('Opex payables, DPO (days)', p.opexAp?.defaultApDays ?? 0, NUMFMT.int, 'DpoDays');
  addKV('Pre-sales escrow held %', p.escrow?.heldPct ?? 0, NUMFMT.pct);
  // The roads and parks deduction is retired (2026-09-08); nothing to emit.
  // before capacity calcs. Project-level here; per-asset values live on the
  // Assets table when the scope is 'asset'.
  void taxRow;
  // Financing raw inputs (funding method, debt/equity, min cash, IDC policy,
  // dividends) are grouped under the Financing divider below, not here, so the
  // Assumptions tab holds every input once under its type divider. This dead
  // registry is retained only for the AssumptionRefs shape.
  const financingScalars: FinancingScalarRefs = {
    dividendEnabled: '', dividendPayout: '', dividendStart: '', sweepStart: '', sweepRatio: '',
  };
  r += 1;

  // Phases section.
  setSectionHeader(ws.getRow(r), 'Phases', 5); r += 1;
  ['Phase', 'Start year', 'Construction yrs', 'Operations yrs', 'Status'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
  r += 1;
  const phaseStartCells: string[] = [];
  for (const ph of opts.state.phases) {
    const sy = ph.startDate ? new Date(ph.startDate).getUTCFullYear() : snap.projectStartYear;
    setLabel(ws.getCell(`A${r}`), ph.name);
    setInput(ws.getCell(`B${r}`), sy, NUMFMT.year);
    setInput(ws.getCell(`C${r}`), ph.constructionPeriods ?? 0, NUMFMT.int);
    setInput(ws.getCell(`D${r}`), ph.operationsPeriods ?? 0, NUMFMT.int);
    setInput(ws.getCell(`E${r}`), String(ph.status ?? 'planning'), '@');
    phaseStartCells.push(`$B$${r}`);
    r += 1;
  }
  // Project start year = MIN(phase start years): a formula over the inputs.
  setLabel(ws.getCell(`A${r}`), 'Project start year (model axis origin)', { bold: true });
  setFormula(ws.getCell(`B${r}`), fcell(`MIN(${phaseStartCells.join(',')})`, snap.projectStartYear), NUMFMT.year);
  wb.definedNames.add(`${SHEETS.assumptions}!$B$${r}`, 'ProjectStartYear');
  r += 2;

  // Land parcels.
  if (opts.state.parcels.length) {
    setSectionHeader(ws.getRow(r), 'Land parcels', 9); r += 1;
    ['Parcel', 'Area (sqm)', 'Rate /sqm', 'Cash %', 'In-kind %', 'Debt %', 'Equity %'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
    r += 1;
    // Per-parcel land funding split (Financing Tab 4 "Land Funding" card): the
    // debt / equity share applied to the cash-funded slice of each parcel.
    const parcelFunding = opts.state.project.financing?.parcelFunding ?? [];
    for (const pa of opts.state.parcels) {
      setLabel(ws.getCell(`A${r}`), pa.name);
      setInput(ws.getCell(`B${r}`), pa.area ?? 0, NUMFMT.int);
      setInput(ws.getCell(`C${r}`), pa.rate ?? 0, NUMFMT.rate); // /sqm rate, unscaled
      setInput(ws.getCell(`D${r}`), (pa.cashPct ?? 0) / 100, NUMFMT.pct);
      setInput(ws.getCell(`E${r}`), (pa.inKindPct ?? 0) / 100, NUMFMT.pct);
      // Roads % and Parks % used to sit in F and G; with the deduction retired
      // the columns are gone and Debt / Equity move left to close the gap.
      const pf = parcelFunding.find((x) => x.parcelId === pa.id);
      const pDebt = pf?.debtPct ?? 0;
      setInput(ws.getCell(`F${r}`), pDebt / 100, NUMFMT.pct);
      setInput(ws.getCell(`G${r}`), (pf?.equityPct ?? (100 - pDebt)) / 100, NUMFMT.pct);
      parcelRefs.push({ id: pa.id, area: addr('B', r), rate: addr('C', r), cashPct: addr('D', r), inKindPct: addr('E', r) });
      r += 1;
    }
    r += 1;
  }

  // Assets (area schedule + depreciation).
  const visibleAssets = opts.state.assets.filter((a) => a.visible !== false);
  if (visibleAssets.length) {
    setSectionHeader(ws.getRow(r), 'Assets', 14); r += 1;
    ['Asset', 'Strategy', 'BUA (sqm)', 'NSA (sqm)', 'GFA (sqm)', 'Support (sqm)', 'Parking (sqm)', 'Parking bays', 'Land (sqm)', 'Land rate /sqm', 'Useful life (yrs)'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
    r += 1;
    for (const a of visibleAssets) {
      setLabel(ws.getCell(`A${r}`), a.name);
      setInput(ws.getCell(`B${r}`), a.strategy, '@');
      setInput(ws.getCell(`C${r}`), a.buaSqm ?? 0, NUMFMT.int);
      setInput(ws.getCell(`D${r}`), a.sellableBuaSqm ?? 0, NUMFMT.int);
      setInput(ws.getCell(`E${r}`), a.gfaSqm ?? 0, NUMFMT.int);
      setInput(ws.getCell(`F${r}`), a.supportArea ?? 0, NUMFMT.int);
      setInput(ws.getCell(`G${r}`), a.parkingArea ?? 0, NUMFMT.int);
      setInput(ws.getCell(`H${r}`), a.parkingBaysRequired ?? 0, NUMFMT.int);
      setInput(ws.getCell(`I${r}`), a.landAllocation?.sqm ?? a.landAreaSqm ?? 0, NUMFMT.int);
      setInput(ws.getCell(`J${r}`), a.landAllocation?.customRate ?? 0, NUMFMT.rate); // /sqm rate, unscaled
      setInput(ws.getCell(`K${r}`), a.usefulLifeYears ?? 0, NUMFMT.int);
      assetRefs.push({
        id: a.id, name: a.name, phaseId: a.phaseId, strategy: a.strategy,
        bua: addr('C', r), nsa: addr('D', r), gfa: addr('E', r), support: addr('F', r), parking: addr('G', r),
        parkingBays: addr('H', r), landSqm: addr('I', r), landRate: addr('J', r), usefulLife: addr('K', r),
      });
      r += 1;
    }
    r += 1;
    // Multi-parcel land splits: when an asset draws land from more than one
    // parcel, the single Land (sqm) above is the aggregate. List the per-parcel
    // sqm so the parcel-level attribution is not lost.
    const splitAssets = visibleAssets.filter((a) => (a.landAllocation?.multiParcelSplits?.length ?? 0) > 0);
    if (splitAssets.length) {
      setSectionHeader(ws.getRow(r), 'Asset land splits (per parcel)', 3); r += 1;
      ['Asset', 'Parcel', 'Land (sqm)'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
      r += 1;
      for (const a of splitAssets) {
        for (const sp of a.landAllocation!.multiParcelSplits!) {
          const parcelName = opts.state.parcels.find((pa) => pa.id === sp.parcelId)?.name ?? sp.parcelId;
          setLabel(ws.getCell(`A${r}`), a.name);
          setLabel(ws.getCell(`B${r}`), parcelName);
          setInput(ws.getCell(`C${r}`), sp.sqm ?? 0, NUMFMT.int);
          r += 1;
        }
      }
      r += 1;
    }
  }

  // Sub-units (revenue / area drivers).
  if (opts.state.subUnits.length) {
    setSectionHeader(ws.getRow(r), 'Sub-units', 9); r += 1;
    ['Sub-unit', 'Asset', 'Category', 'Metric', 'Quantity', 'Unit area (sqm)', 'Price / ADR', 'Occupancy %', 'Margin %'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
    r += 1;
    for (const u of opts.state.subUnits) {
      const aName = opts.state.assets.find((a) => a.id === u.assetId)?.name ?? u.assetId;
      setLabel(ws.getCell(`A${r}`), u.name, { indent: 1 });
      setLabel(ws.getCell(`B${r}`), aName);
      setInput(ws.getCell(`C${r}`), String(u.category), '@');
      setInput(ws.getCell(`D${r}`), String(u.metric), '@');
      setInput(ws.getCell(`E${r}`), u.metricValue ?? 0, NUMFMT.int);
      setInput(ws.getCell(`F${r}`), u.unitArea ?? 0, NUMFMT.int);
      setInput(ws.getCell(`G${r}`), resolveSubUnitAdr(u), NUMFMT.rate); // price / ADR per unit, unscaled
      setInput(ws.getCell(`H${r}`), (u.occupancyPct ?? 0) / 100, NUMFMT.pct);
      setInput(ws.getCell(`I${r}`), (u.operatingMargin ?? 0) / 100, NUMFMT.pct);
      subUnitRefs.push({ id: u.id, assetId: u.assetId, category: addr('C', r), metric: addr('D', r), value: addr('E', r), unitArea: addr('F', r), price: addr('G', r) });
      r += 1;
    }
    r += 1;
  }

  // Returns config section.
  setSectionHeader(ws.getRow(r), 'Returns & Valuation assumptions', 5); r += 1;
  const cfg = opts.state.project.returns;
  addKV('Discount rate', cfg?.discountRate ?? 0.1, NUMFMT.pct, 'DiscountRate');
  addKV('Exit year (offset from start, 0-based)', cfg?.exitYearOffset ?? (snap.axisLength - 1), NUMFMT.int, 'ExitYearOffset');
  setLabel(ws.getCell(`A${r}`), 'Terminal value method'); setInput(ws.getCell(`B${r}`), String(cfg?.terminalMethod ?? 'exit_multiple'), '@'); r += 1;
  // ONLY THE INPUT THE METHOD USES (2026-09-15): an exit multiple printed beside
  // a cap rate method reads as the figure the terminal value was struck on.
  {
    const tmIn = String(cfg?.terminalMethod ?? 'exit_multiple');
    const rc = cfg as { capRate?: number; capRateSource?: string } | undefined;
    if (tmIn === 'exit_multiple') addKV('Exit multiple (x stabilised NOI)', cfg?.exitMultiple ?? 8, NUMFMT.mult, 'ExitMultiple');
    if (tmIn === 'perpetuity') addKV('Perpetuity growth', cfg?.perpetuityGrowth ?? 0.02, NUMFMT.pct, 'PerpetuityGrowth');
    if (tmIn === 'cap_rate') addKV(`Cap rate (${rc?.capRateSource === 'manual' ? 'typed' : 'derived from the model; the typed rate if set'})`, rc?.capRate ?? 0.08, NUMFMT.pct, 'CapRate');
  }
  r += 1;

  // Capex cost lines: PURE INPUTS only (method + rate / %, plus a physical
  // quantity for rate-x-area methods). Derived bases stay OFF this sheet: an
  // in-kind / cash / total land value, a revenue basis, a sum-of-selected-lines
  // and a derived unit count are all calculated results, so they are computed
  // live on the calc sheets (Land & Area, Capex itself) instead of being stored
  // here as constants. Percent rates are decimals (0.10); a fixed lump = rate.
  setSectionHeader(ws.getRow(r), 'Capex cost lines (inputs: method, rate / %, quantity, stage, phasing window)', 8); r += 1;
  ['Asset / Cost line', 'Method', 'Rate / %', 'Quantity (rate-x-area only)', 'Stage', 'Start period', 'End period', 'Phasing'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
  r += 1;
  const capexRefs: CapexAssetRef[] = [];
  for (const ia of capex.inputAssets) {
    setLabel(ws.getCell(`A${r}`), `${ia.assetName}  (${ia.phaseName})`, { bold: true });
    fillRange(ws, r, 1, r, 8, ARGB.subtotal);
    r += 1;
    const lineRefs: CapexLineRef[] = [];
    for (const ln of ia.lines) {
      setLabel(ws.getCell(`A${r}`), ln.name, { indent: 1 });
      setLabel(ws.getCell(`B${r}`), ln.basis);
      // Rate input: percent as a decimal (pct2), money rate as an unscaled
      // per-unit rate (NUMFMT.rate) so the workbook display-scale leaves it alone.
      if (ln.isPercent) setInput(ws.getCell(`C${r}`), ln.rate / 100, NUMFMT.pct2);
      else setInput(ws.getCell(`C${r}`), ln.rate, NUMFMT.rate);
      // Stage (land / hard / soft) + the phasing window (start / end period,
      // even vs manual) that drives this line's per-period spend.
      setInput(ws.getCell(`E${r}`), ln.stage, '@');
      setInput(ws.getCell(`F${r}`), ln.startPeriod, NUMFMT.int);
      setInput(ws.getCell(`G${r}`), ln.endPeriod, NUMFMT.int);
      setInput(ws.getCell(`H${r}`), ln.phasing, '@');
      // Keep column D as an input ONLY for a genuine physical quantity: rate-x-
      // area (BUA / NSA / GFA / NDA / roads / land sqm) and rate-per-parking-bay
      // (basisFor tags bays as 'count', but a bay is a physical input). A derived
      // unit count and every money basis (land value / revenue / selected lines)
      // are left blank here and built live on the calc sheets from the real source.
      const hasQty = !ln.isFixed && ln.metricValue !== null && (ln.metricKind === 'area' || ln.method === 'rate_per_parking_bay');
      // Store the EFFECTIVE driver quantity (amount / rate), not the raw area
      // metric. They are equal when no allocation applies; when the engine
      // allocates a line's cost across assets (e.g. bua_share), the effective
      // quantity is this asset's share, so rate x quantity reconciles to the
      // engine amount on recalculation rather than drifting.
      if (hasQty) setInput(ws.getCell(`D${r}`), ln.rate ? ln.amount / ln.rate : (ln.metricValue as number), NUMFMT.int);
      lineRefs.push({
        id: ln.id,
        method: ln.method,
        selectedLineIds: ln.selectedLineIds,
        stage: ln.stage,
        rate: ln.rate,
        isPercent: ln.isPercent,
        basis: ln.basis,
        name: ln.name,
        rateAddr: sheetRef(SHEETS.assumptions, `$C$${r}`),
        qtyAddr: hasQty ? sheetRef(SHEETS.assumptions, `$D$${r}`) : null,
        metricKind: ln.metricKind,
        amount: ln.amount,
      });
      r += 1;
      // Per-sub-unit custom rates (method 'per_sub_unit_custom_rates'): the Rate
      // cell above is only the fallback default, so expand the real rate sheet as
      // indented sub-rows (sub-unit name + rate), incl. the Support / Parking rows.
      if (ln.perSubUnitRates && Object.keys(ln.perSubUnitRates).length) {
        for (const [key, rate] of Object.entries(ln.perSubUnitRates)) {
          const subName = key === '__support__' ? 'Support' : key === '__parking__' ? 'Parking' : (opts.state.subUnits.find((s) => s.id === key)?.name ?? key);
          setLabel(ws.getCell(`A${r}`), `${subName} rate`, { indent: 2 });
          setInput(ws.getCell(`C${r}`), rate, NUMFMT.rate);
          r += 1;
        }
      }
    }
    // 2026-08-15: hard / soft subtotals per asset. The Stage column above has
    // always been here, but nothing added it up, so no export could answer
    // "what is the hard cost" without the reader doing it by hand. Emitted only
    // where there is a figure, so a land-only asset gains no empty rows.
    for (const [label, amount] of ([
      ['Hard costs', ia.subtotals.hard],
      ['Soft costs', ia.subtotals.soft],
      ['Operating', ia.subtotals.operating],
      ['Marketing', ia.subtotals.marketing],
      ['Land', ia.subtotals.land],
    ] as Array<[string, number]>)) {
      if (amount === 0) continue;
      setLabel(ws.getCell(`A${r}`), label, { indent: 1, bold: true });
      setInput(ws.getCell(`I${r}`), amount, NUMFMT.money);
      r += 1;
    }
    if (ia.subtotals.exclLand !== 0 && (ia.subtotals.land !== 0 || ia.subtotals.marketing !== 0)) {
      setLabel(ws.getCell(`A${r}`), ia.subtotals.marketing !== 0
        ? 'Construction cost (excl. land and marketing)'
        : 'Construction cost (excl. land)', { indent: 1, bold: true });
      setInput(ws.getCell(`I${r}`), ia.subtotals.exclLand, NUMFMT.money);
      r += 1;
    }
    capexRefs.push({ assetId: ia.assetId, name: ia.assetName, phaseName: ia.phaseName, total: ia.total, lines: lineRefs });
  }
  r += 1;

  // Full-width domain divider band between input domains (Capex / Revenue / Opex
  // / Financing), so each reads as a distinct block. Every model input lives on
  // this Inputs tab; the module output tabs echo their own slice marked "from
  // the Inputs tab".
  const inputDivider = (text: string): void => {
    r += 1;
    for (let c = 1; c <= 8; c++) fillCell(ws.getCell(r, c), ARGB.sectionDark);
    const cell = ws.getCell(`A${r}`); cell.value = text;
    cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: ARGB.white } };
    cell.alignment = { vertical: 'middle' };
    ws.getRow(r).height = 18;
    r += 2;
  };
  const idxLabel = (ix?: { method?: string; rate?: number }): string => {
    if (!ix || !ix.method || ix.method === 'none') return 'None';
    const m = ix.method === 'single_rate' ? 'Flat' : ix.method === 'yoy_compound' ? 'Compound' : ix.method === 'yoy_per_period' ? 'Per-Year' : ix.method === 'step' ? 'Step' : ix.method;
    return ix.rate != null ? `${m} ${(ix.rate * 100).toFixed(1)}%` : m;
  };
  const opexValFmt = (mode: string): string => mode === 'fixed_baseline' ? NUMFMT.money : mode.startsWith('per_') ? NUMFMT.rate : NUMFMT.pct;

  // ── Financing inputs (Module 1, right after Capex; Revenue + Opex follow) ───
  inputDivider('FINANCING INPUTS');

  // Financing settings (the raw financing scalars, grouped under the Financing
  // divider as the single source of truth; the Financing output tab echoes
  // these inline marked "from Assumptions").
  setSectionHeader(ws.getRow(r), 'Financing settings', 5); r += 1;
  setLabel(ws.getCell(`A${r}`), 'Funding method'); setInput(ws.getCell(`B${r}`), FUNDING_METHOD_LABELS[(p.financing?.fundingMethod ?? 1) as FundingMethodId], '@'); r += 1;
  addKV('Debt share', fin.funding.debtPct / 100, NUMFMT.pct, 'DebtPct');
  addKV('Equity share', fin.funding.equityPct / 100, NUMFMT.pct, 'EquityPct');
  addKV('Minimum cash reserve', p.financing?.minimumCashReserve ?? fin.funding.minCashReserve ?? 0, NUMFMT.money, 'MinCashReserve');
  addKV('IDC treatment', 'Capitalised into asset cost; paid when it arises', '@');
  addKV('IDC allocation basis', String(p.idcConfig?.allocationBasis ?? 'land'), '@');
  addKV('IDC funding', 'Cash first, debt drawn only for the shortfall', '@');
  addKV('Dividends enabled (1 = yes)', p.dividendPolicy?.enabled ? 1 : 0, NUMFMT.int);
  addKV('Dividend payout ratio %', (p.dividendPolicy?.payoutRatio ?? 0) / 100, NUMFMT.pct);
  addKV('Dividend start year (0 = auto)', p.dividendStartYear ?? 0, NUMFMT.year);
  // Selected funding-method configuration: the method-specific inputs that size
  // the requirement beyond the resolved Debt / Equity share above (existing /
  // initial cash, Method 4 specified amounts). Only the active method's block is
  // emitted, mirroring the platform's "2a. Method N Configuration" panel.
  const fcfg = p.financing;
  const fmId = (fcfg?.fundingMethod ?? 1) as FundingMethodId;
  if (fmId === 2 && fcfg?.netFundingConfig) {
    const mc = fcfg.netFundingConfig;
    addKV('Method 2: Existing cash', mc.existingCash ?? 0, NUMFMT.money);
    addKV('Method 2: Debt %', (mc.debtPct ?? 0) / 100, NUMFMT.pct);
    addKV('Method 2: Equity %', (mc.equityPct ?? 0) / 100, NUMFMT.pct);
  } else if (fmId === 3 && fcfg?.cashDeficitConfig) {
    const mc = fcfg.cashDeficitConfig;
    const minCash = Array.isArray(mc.minimumCashReserve) ? (mc.minimumCashReserve[0] ?? 0) : (mc.minimumCashReserve ?? 0);
    addKV('Method 3: Initial cash', mc.initialCash ?? 0, NUMFMT.money);
    addKV('Method 3: Minimum cash reserve', minCash, NUMFMT.money);
    addKV('Method 3: Debt %', (mc.debtPct ?? 0) / 100, NUMFMT.pct);
    addKV('Method 3: Equity %', (mc.equityPct ?? 0) / 100, NUMFMT.pct);
  } else if (fmId === 4 && fcfg?.fixedAmountConfig) {
    const mc = fcfg.fixedAmountConfig;
    addKV('Method 4: Specified debt amount', mc.debtAmount ?? 0, NUMFMT.money);
    addKV('Method 4: Specified equity amount', mc.equityAmount ?? 0, NUMFMT.money);
  }
  r += 1;

  // Cash sweep settings (project-wide; the Financing tab links these in).
  const sweepCfg = (p.financing as { cashSweep?: { startingYear?: number; sweepRatioPct?: number } } | undefined)?.cashSweep ?? {};
  setSectionHeader(ws.getRow(r), 'Cash sweep settings', 2); r += 1;
  ['Setting', 'Value'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
  r += 1;
  setLabel(ws.getCell(`A${r}`), 'Sweep starting year (0 = auto)');
  setInput(ws.getCell(`B${r}`), sweepCfg.startingYear ?? 0, NUMFMT.year);
  financingScalars.sweepStart = addr('B', r); r += 1;
  setLabel(ws.getCell(`A${r}`), 'Sweep ratio (% of surplus)');
  setInput(ws.getCell(`B${r}`), (sweepCfg.sweepRatioPct ?? 100) / 100, NUMFMT.pct);
  financingScalars.sweepRatio = addr('B', r); r += 2;

  // Financing facilities (debt).
  if (opts.state.financingTranches.length) {
    setSectionHeader(ws.getRow(r), 'Financing facilities (debt)', 12); r += 1;
    ['Facility', 'Origin', 'Opening balance', 'Interest rate %', 'Drawdown method', 'Repayment method', 'Repay periods', 'IDC capitalize', 'Repay start year', 'Interest start year', 'Origination year', 'Facility share %'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
    r += 1;
    for (const t of opts.state.financingTranches) {
      const rate = t.interestRatePct ?? ((t.interbankRatePct ?? 0) + (t.creditSpreadPct ?? 0));
      setLabel(ws.getCell(`A${r}`), t.name);
      setInput(ws.getCell(`B${r}`), String(t.origin ?? 'new'), '@');
      setInput(ws.getCell(`C${r}`), t.openingBalance ?? 0, NUMFMT.money);
      setInput(ws.getCell(`D${r}`), rate / 100, NUMFMT.pct2);
      setInput(ws.getCell(`E${r}`), String(t.drawdownMethod ?? '-'), '@');
      setInput(ws.getCell(`F${r}`), String(t.repaymentMethod ?? '-'), '@');
      setInput(ws.getCell(`G${r}`), t.repaymentPeriods ?? 0, NUMFMT.int);
      setInput(ws.getCell(`H${r}`), t.idcCapitalize ? 1 : 0, NUMFMT.int);
      // Timing inputs (0 = auto / not set, rendered as a dash): when the facility
      // starts repaying, when interest begins accruing, the origination year, and
      // its share of a multi-facility new-debt drawdown.
      setInput(ws.getCell(`I${r}`), t.repaymentStartYear ?? 0, NUMFMT.year);
      setInput(ws.getCell(`J${r}`), t.interestStartYear ?? 0, NUMFMT.year);
      setInput(ws.getCell(`K${r}`), t.originationYear ?? 0, NUMFMT.year);
      setInput(ws.getCell(`L${r}`), (t.facilitySharePct ?? 0) / 100, NUMFMT.pct);
      trancheRefs.push({ id: t.id, name: t.name, openingBalance: addr('C', r), rate: addr('D', r), periods: addr('G', r) });
      r += 1;
    }
    r += 1;
  }

  // Equity contributions.
  if (opts.state.equityContributions.length) {
    setSectionHeader(ws.getRow(r), 'Equity contributions', 4); r += 1;
    ['Contribution', 'Amount', 'Timing', 'Type'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
    r += 1;
    for (const e of opts.state.equityContributions) {
      setLabel(ws.getCell(`A${r}`), e.name);
      setInput(ws.getCell(`B${r}`), e.amount ?? 0, NUMFMT.money);
      setInput(ws.getCell(`C${r}`), String(e.timing ?? 'upfront'), '@');
      setInput(ws.getCell(`D${r}`), String(e.type ?? 'cash'), '@');
      equityRefs.push({ id: e.id, name: e.name, amount: addr('B', r) });
      r += 1;
    }
    r += 1;
  }

  // Existing operations equity (historical). Opening-balance equity on
  // operational-phase assets (asset.historicalEquityAmount), the source the
  // Financing sheet's Existing-equity row links to. Input cells (editable).
  const opPhaseIds = new Set(opts.state.phases.filter((ph) => ph.status === 'operational').map((ph) => ph.id));
  const existingEqAssets = visibleAssets.filter((a) => opPhaseIds.has(a.phaseId) && Math.max(0, a.historicalEquityAmount ?? 0) > 0);
  if (existingEqAssets.length) {
    setSectionHeader(ws.getRow(r), 'Existing operations equity (historical)', 2); r += 1;
    ['Asset', 'Equity contributed'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
    r += 1;
    for (const a of existingEqAssets) {
      setLabel(ws.getCell(`A${r}`), a.name);
      setInput(ws.getCell(`B${r}`), Math.max(0, a.historicalEquityAmount ?? 0), NUMFMT.money);
      existingEquityRefs.push({ assetId: a.id, name: a.name, amount: addr('B', r) });
      r += 1;
    }
    r += 1;
  }

  // ── Revenue inputs (recognition + indexation + cash / recognition profiles;
  // unit prices / ADR + occupancy are in the Sub-units table above). ──────────
  inputDivider('REVENUE INPUTS');
  setSectionHeader(ws.getRow(r), 'Revenue configuration by asset (unit prices / ADR + occupancy are in the Sub-units table above)', 7); r += 1;
  ['Asset', 'Strategy', 'Recognition', 'PIT year', 'ADR / Base rate', 'Indexation', 'Index rate %'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right')); r += 1;
  // One row per consolidated line (2026-09-15): a line's terms are written to every plot on it.
  for (const a of lineHosts({ assets: visibleAssets, phases: opts.state.phases, parcels: opts.state.parcels })) {
    const rc = a.revenue ?? {};
    setLabel(ws.getCell(`A${r}`), a.name);
    setInput(ws.getCell(`B${r}`), a.strategy, '@');
    if (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') {
      const s = rc.sell;
      setInput(ws.getCell(`C${r}`), String(s?.recognitionProfile?.method ?? 'over_time'), '@');
      setInput(ws.getCell(`D${r}`), s?.recognitionProfile?.pointInTimeYear ?? 0, NUMFMT.year);
      setInput(ws.getCell(`F${r}`), String(s?.indexation?.method ?? 'none'), '@');
      setInput(ws.getCell(`G${r}`), s?.indexation?.rate ?? 0, NUMFMT.pct2);
    } else if (a.strategy === 'Operate') {
      setInput(ws.getCell(`E${r}`), rc.operate?.startingADR ?? 0, NUMFMT.rate);
      setInput(ws.getCell(`F${r}`), String(rc.operate?.adrIndexation?.method ?? 'none'), '@');
      setInput(ws.getCell(`G${r}`), rc.operate?.adrIndexation?.rate ?? 0, NUMFMT.pct2);
    } else {
      setInput(ws.getCell(`E${r}`), rc.lease?.baseRate ?? 0, NUMFMT.rate);
      setInput(ws.getCell(`F${r}`), String(rc.lease?.rentIndexation?.method ?? 'none'), '@');
      setInput(ws.getCell(`G${r}`), rc.lease?.rentIndexation?.rate ?? 0, NUMFMT.pct2);
    }
    r += 1;
  }
  r += 1;
  // Per-asset cash + recognition profiles (% by year from the sale year).
  for (const a of visibleAssets) {
    const s = a.revenue?.sell; if (!s) continue;
    // RECOGNITION ONLY (2026-08-20). The cash payment profile row was removed
    // once the cohort rule was verified: it drives nothing, so printing it in
    // an inputs table presented a dead field as a live one. The field itself
    // is deprecated in storage, not deleted, so no entered schedule is lost.
    const recogPct = s.recognitionProfile?.percentages ?? [];
    let n = 0; for (let i = 0; i < recogPct.length; i++) if ((recogPct[i] ?? 0) !== 0) n = i + 1;
    if (!n) continue;
    setSectionHeader(ws.getRow(r), `Recognition profile, ${a.name} (% by year from sale)`, n + 1); r += 1;
    setColHeader(ws.getCell(r, 1), 'Profile', 'left'); for (let i = 0; i < n; i++) setColHeader(ws.getCell(r, 2 + i), `Yr ${i + 1}`, 'right'); r += 1;
    setLabel(ws.getCell(`A${r}`), 'Recognition %'); for (let i = 0; i < n; i++) setInput(ws.getCell(r, 2 + i), recogPct[i] ?? 0, NUMFMT.pct); r += 1;
    // Sale cohort terms: what actually drives collections. Shared builder, so
    // this and the PDF cannot drift.
    {
      const block = buildSaleCohortTermsBlock(a, opts.state.phases.find((ph) => ph.id === a.phaseId), Number(snap.yearLabels[0]) || 0);
      if (block && block.downpayments.length) {
        r += 1;
        setSectionHeader(ws.getRow(r), `Sale cohort terms, ${a.name}`, block.downpayments.length + 1); r += 1;
        setColHeader(ws.getCell(r, 1), 'Term', 'left');
        for (let i = 0; i < block.downpayments.length; i++) setColHeader(ws.getCell(r, 2 + i), String(block.downpayments[i].year), 'right'); r += 1;
        setLabel(ws.getCell(`A${r}`), 'Downpayment % by sale year');
        for (let i = 0; i < block.downpayments.length; i++) setInput(ws.getCell(r, 2 + i), block.downpayments[i].value, NUMFMT.pct); r += 1;
        setLabel(ws.getCell(`A${r}`), 'Max instalment years'); setInput(ws.getCell(r, 2), block.instalmentYears); r += 1;
        setLabel(ws.getCell(`A${r}`), 'Instalments stop at handover'); setInput(ws.getCell(r, 2), block.stopAtHandover ? 'Yes' : 'No'); r += 1;
        setLabel(ws.getCell(`A${r}`), saleCohortRuleText(block)); r += 1;
      }
    }
    r += 1;
  }

  // ── Opex inputs (per-asset opex lines + HQ; operating margins are in the
  // Sub-units table above). ──────────────────────────────────────────────────
  inputDivider('OPEX INPUTS');
  let anyOpex = false;
  for (const a of lineHosts({ assets: visibleAssets, phases: opts.state.phases, parcels: opts.state.parcels })) {
    const lines = (a.opex?.lines ?? []).filter((l) => !l.disabled);
    if (!lines.length) continue;
    anyOpex = true;
    setSectionHeader(ws.getRow(r), `Opex lines, ${a.name}`, 6); r += 1;
    ['Line', 'Category', 'Mode', 'Value', 'Indexation', 'Rate mode'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right')); r += 1;
    for (const l of lines) {
      setLabel(ws.getCell(`A${r}`), l.name);
      setInput(ws.getCell(`B${r}`), String(l.category), '@');
      setInput(ws.getCell(`C${r}`), String(l.mode), '@');
      setInput(ws.getCell(`D${r}`), l.value, opexValFmt(String(l.mode)));
      setInput(ws.getCell(`E${r}`), l.useAssetDefault ? `(default) ${idxLabel(a.opex?.defaultIndexation)}` : idxLabel(l.indexation), '@');
      setInput(ws.getCell(`F${r}`), l.rateMode === 'yoy' ? 'YoY' : 'Single', '@');
      r += 1;
    }
    r += 1;
  }
  const hqOpexLines = (p.hqOpex?.lines ?? []).filter((l) => !l.disabled);
  if (hqOpexLines.length) {
    anyOpex = true;
    setSectionHeader(ws.getRow(r), 'HQ / Corporate opex lines', 5); r += 1;
    ['Line', 'Category', 'Mode', 'Value', 'Indexation'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right')); r += 1;
    for (const l of hqOpexLines) {
      setLabel(ws.getCell(`A${r}`), l.name);
      setInput(ws.getCell(`B${r}`), String(l.category), '@');
      setInput(ws.getCell(`C${r}`), String(l.mode), '@');
      setInput(ws.getCell(`D${r}`), l.value, opexValFmt(String(l.mode)));
      setInput(ws.getCell(`E${r}`), idxLabel(l.indexation), '@');
      r += 1;
    }
    r += 1;
  }
  if (!anyOpex) { setLabel(ws.getCell(`A${r}`), 'No per-line opex configured; operating costs are driven by the operating margins in the Sub-units table above.'); r += 2; }

  // ── FUND INPUTS (2026-08-11) ───────────────────────────────────────────────
  //
  // The workbook's own rule is that inputs live on this tab, and the fund layer
  // broke it completely: the toggle, the five rates, the hurdle, the
  // performance fee, the Fund Manager and the distribution matrix appeared
  // NOWHERE in the file. A reader could see 359.9m of fees charged on the P&L
  // with no way to find the rate that produced them.
  //
  // Gated on the toggle, so a standalone project is untouched. Every cell is an
  // INPUT (navy-pale FAST shading) except the two resolved bases, which are
  // model-derived and are marked as computed so nobody edits them expecting a
  // recalculation. See docs/FUND_LAYER_GUIDELINE.md on why fund size is
  // resolved rather than typed.
  const fundTerms = resolveFundTerms(p);
  if (fundTerms.enabled) {
    inputDivider('FUND INPUTS');
    setSectionHeader(ws.getRow(r), 'Fund terms', 4); r += 1;
    ['Term', 'Value', 'Unit', 'Note'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : i === 1 ? 'right' : 'left')); r += 1;
    const termRow = (label: string, value: number | string, numFmt: string, unit: string, note: string): void => {
      setLabel(ws.getCell(`A${r}`), label);
      setInput(ws.getCell(`B${r}`), value, numFmt);
      setLabel(ws.getCell(`C${r}`), unit);
      setLabel(ws.getCell(`D${r}`), note);
      r += 1;
    };
    termRow('Fund layer enabled', 'Yes', '@', '', 'When off, every fund figure disappears from the model and this band is not written.');
    termRow('Fund structure fee', fundTerms.fundStructureFeePct, NUMFMT.pct2, 'of fund size', 'One time, charged on the fee-free fund size.');
    termRow('Fund management fee', fundTerms.fundManagementFeePct, NUMFMT.pct2, 'of total equity pa', 'Annual, charged on total equity in every period.');
    termRow('Custody and admin fee', fundTerms.custodyAdminFeePct, NUMFMT.pct2, 'of total equity pa', 'Annual, charged on total equity in every period.');
    termRow('Debt arranging fee', fundTerms.debtArrangingFeePct, NUMFMT.pct2, 'of debt facility', 'One time, charged on debt actually raised, NOT on the facility limit.');
    termRow('Other expenses', fundTerms.otherExpensesPerAnnum, NUMFMT.money, 'per annum', 'A flat amount each period; no rate applies.');
    termRow('Hurdle rate (preferred return)', fundTerms.hurdleRatePct, NUMFMT.pct2, 'per annum', 'Accrues on the unpaid hurdle balance plus the same-period equity draw, and compounds.');
    termRow('Performance fee on the excess', fundTerms.performanceFeePct, NUMFMT.pct2, 'of excess', 'Flat on distributions above the hurdle owed. No catch-up, no residual split.');
    termRow('Fund Manager', fundTerms.fundManagerName || 'Fund Manager', '@', '', 'Takes 100% of the management fees plus its matrix share of the performance fee.');
    termRow('Fund size override', fundTerms.fundSizeOverride ? 'Yes' : 'No', '@', '', fundTerms.fundSizeOverride ? `Typed target ${formatAccounting(fundTerms.fundSize, 'millions', 1)} m pins the fund size instead of the model-resolved figure.` : 'Off: fund size is resolved from the model (total equity plus the debt facility).');
    termRow('Facility limit override', fundTerms.facilityLimitOverride ? 'Yes' : 'No', '@', '', fundTerms.facilityLimitOverride ? `Typed limit ${formatAccounting(fundTerms.facilityLimit, 'millions', 1)} m.` : 'Off: the debt facility is resolved from the model.');
    r += 1;

    // The three resolved capital bases. COMPUTED, not input: they come from the
    // fee-free pass and are frozen before the solver, which is what stops the
    // fees from raising the funding that raises the fees.
    const capRows = buildFundCapitalRows(snap);
    if (capRows.length) {
      setSectionHeader(ws.getRow(r), 'Resolved capital bases (computed from the model, not typed)', 4); r += 1;
      ['Base', 'Amount', '', 'How it is resolved'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 1 ? 'right' : 'left')); r += 1;
      for (const c of capRows) {
        setLabel(ws.getCell(`A${r}`), c.isTotal ? `= ${c.label}` : c.label, { bold: c.isTotal });
        const vc = ws.getCell(`B${r}`); vc.value = c.amount; vc.numFmt = NUMFMT.money; vc.font = { name: 'Calibri', size: BODY_SIZE, bold: c.isTotal, color: { argb: ARGB.formula } };
        setLabel(ws.getCell(`D${r}`), c.note);
        r += 1;
      }
      r += 1;
    }

    // The distribution matrix. Shares are NEVER normalised: a matrix summing to
    // 80% allocates 80% and the remainder is reported as unallocated, so the
    // raw entries are what has to be shown here.
    const matrix = fundTerms.feeDistribution ?? [];
    if (matrix.length) {
      setSectionHeader(ws.getRow(r), 'Fee distribution matrix (shares are not normalised)', 4); r += 1;
      ['Party', 'Commission %', 'Developer fee %', 'Performance fee %'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right')); r += 1;
      for (const m of matrix) {
        setLabel(ws.getCell(`A${r}`), m.partyName || m.partyId);
        setInput(ws.getCell(`B${r}`), m.commissionPct ?? 0, NUMFMT.pct2);
        setInput(ws.getCell(`C${r}`), m.developerFeePct ?? 0, NUMFMT.pct2);
        setInput(ws.getCell(`D${r}`), m.performanceFeePct ?? 0, NUMFMT.pct2);
        r += 1;
      }
      r += 1;
    }
  }

  ws.views = [{ state: 'frozen', ySplit: 2, showGridLines: false }];
  return {
    startYearName: 'ProjectStartYear', axisLength: snap.axisLength, capex: capexRefs,
    assets: assetRefs, subUnits: subUnitRefs, parcels: parcelRefs, tranches: trancheRefs, equity: equityRefs,
    existingEquity: existingEquityRefs, financingScalars,
  };
}

// ── Timeline (formula-driven period axis; the canonical date / index source) ───
function addTimeline(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, refs: AssumptionRefs, state: FinancialsResolverState): void {
  const ws = wb.addWorksheet(SHEETS.timeline, { properties: { tabColor: { argb: ARGB.navy } } });
  ws.getColumn(1).width = 28;
  ws.getColumn(META_B).width = 3; ws.getColumn(META_C).width = 3; ws.getColumn(TOTAL_COL).width = 3;
  setTitle(ws.getCell('A1'), 'Timeline', 16);
  setLabel(ws.getCell('A2'), 'The model period axis. Period 0 is the opening (Dec of the year before start); periods 1..N are the active years. Every schedule links its frozen header dates and index here.');

  const N = refs.axisLength;
  setColHeader(ws.getCell(3, 1), 'Period ending', 'left');
  setColHeader(ws.getCell(4, 1), 'Period index', 'left');
  // Period columns from E: E = Period 0 / Dec(startYear - 1), F.. = active years.
  const hdr = (cell: ExcelJS.Cell): void => {
    cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.grey } };
    cell.alignment = { horizontal: 'right' };
  };
  for (let c = OPEN_COL; c <= lastActiveCol(N); c++) {
    ws.getColumn(c).width = 12;
    const prev = colLetter(c - 1);
    // Date row (3): E = ProjectStartYear - 1, then +1; stored year, shown "Dec YYYY".
    const dCell = ws.getCell(3, c);
    setFormula(dCell, fcell(c === OPEN_COL ? 'ProjectStartYear-1' : `${prev}3+1`, colYear(snap, c)), NUMFMT.date, true);
    hdr(dCell);
    // Index row (4): E = 0, then +1.
    const iCell = ws.getCell(4, c);
    setFormula(iCell, fcell(c === OPEN_COL ? '0' : `${prev}4+1`, c - OPEN_COL), NUMFMT.year);
    hdr(iCell);
  }
  ws.views = [FROZEN_VIEW()];
  addPhaseTimeline(ws, snap, state, N);
}

/**
 * Phase-wise dated timeline + Gantt, appended under the period axis.
 *
 * Dates are the model's own: `computePhaseTimeline` is the same pure function the
 * platform UI and the engine use, so the construction / operations windows here
 * are the real ones (it honours a phase's explicit startDate, the end-of-period
 * convention, and pulls operations forward by any overlap periods), not a
 * re-derivation. `computeProjectTimeline` gives the project envelope.
 *
 * The chart is a CELL-BASED Gantt rather than a native Excel chart: exceljs 4.4
 * exposes no chart API at all (there is no `worksheet.addChart`), so a real chart
 * is not available in this writer. Colouring the existing year grid is also the
 * better result here, because the bars line up exactly with the period columns
 * every other tab is keyed to.
 */
function addPhaseTimeline(ws: ExcelJS.Worksheet, snap: ReturnType<typeof computeFinancialsSnapshot>, state: FinancialsResolverState, N: number): void {
  const phases = state.phases;
  const project = state.project;
  const last = lastActiveCol(N);
  let r = 6;

  // The period-sheet layout leaves B / C / D as 3-char spacers (they carry UOM /
  // Rate / Total elsewhere). The Timeline has no such columns, and the dated
  // phase schedule below needs real width, so reclaim them here. Columns E and
  // beyond are the period axis and keep their width.
  ws.getColumn(2).width = 13;
  ws.getColumn(3).width = 17;
  ws.getColumn(4).width = 17;

  const yearOfCol = (c: number): number => colYear(snap, c);
  const iso = (d: string): Date => new Date(d);
  const yr = (d: string): number => iso(d).getFullYear();
  const fmtDate = (d: string): string => {
    const dt = iso(d);
    return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getMonth()]} ${dt.getFullYear()}`;
  };

  const lines = phases.map((p) => ({ phase: p, tl: computePhaseTimeline(p, project) }));
  const projTl = computeProjectTimeline(project, phases);

  // ── 1. Phase schedule (real dates) ──────────────────────────────────────────
  setSectionHeader(ws.getRow(r), 'Phase schedule (dated)', last, ARGB.sectionDark); r += 1;
  const HEADS = ['Phase', 'Status', 'Construction start', 'Construction end', 'Operations start', 'Operations end', 'Construction (yrs)', 'Operations (yrs)'];
  HEADS.forEach((h, i) => setColHeader(ws.getCell(r, 1 + i), h, i === 0 || i === 1 ? 'left' : 'right'));
  r += 1;
  for (const { phase, tl } of lines) {
    setLabel(ws.getCell(r, 1), phase.name);
    setLabel(ws.getCell(r, 2), phase.status === 'operational' ? 'Operational' : 'Planning');
    const cells: Array<[number, string | number]> = [
      [3, fmtDate(tl.constructionStart)], [4, fmtDate(tl.constructionEnd)],
      [5, fmtDate(tl.operationsStart)], [6, fmtDate(tl.operationsEnd)],
    ];
    for (const [c, v] of cells) {
      const cell = ws.getCell(r, c); cell.value = v;
      cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
      cell.alignment = { horizontal: 'right' };
    }
    setFormula(ws.getCell(r, 7), fcell(String(phase.constructionPeriods), phase.constructionPeriods), NUMFMT.int);
    setFormula(ws.getCell(r, 8), fcell(String(phase.operationsPeriods), phase.operationsPeriods), NUMFMT.int);
    r += 1;
  }
  // Project envelope.
  setLabel(ws.getCell(r, 1), 'Project', { bold: true });
  setLabel(ws.getCell(r, 2), `${phases.length} phase${phases.length === 1 ? '' : 's'}`);
  const envelope: Array<[number, string]> = [[3, fmtDate(projTl.startDate)], [6, fmtDate(projTl.endDate)]];
  for (const [c, v] of envelope) {
    const cell = ws.getCell(r, c); cell.value = v;
    cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.formula } };
    cell.alignment = { horizontal: 'right' };
  }
  for (let c = 1; c <= 8; c++) fillCell(ws.getCell(r, c), ARGB.subtotal);
  r += 2;

  // ── 2. Cell-based Gantt across the period grid ──────────────────────────────
  setSectionHeader(ws.getRow(r), 'Development programme (Gantt)', last, ARGB.sectionDark); r += 1;
  // Year ruler over the period columns, so a bar can be read off a year.
  setColHeader(ws.getCell(r, 1), 'Phase', 'left');
  for (let c = OPEN_COL; c <= last; c++) setColHeader(ws.getCell(r, c), yearOfCol(c), 'right');
  r += 1;

  const bar = (cell: ExcelJS.Cell, argb: string, label = ''): void => {
    fillCell(cell, argb);
    if (label) {
      cell.value = label;
      cell.font = { name: 'Calibri', size: 8, bold: true, color: { argb: ARGB.white } };
      cell.alignment = { horizontal: 'center' };
    }
  };
  for (const { phase, tl } of lines) {
    setLabel(ws.getCell(r, 1), phase.name);
    const cs = yr(tl.constructionStart), ce = yr(tl.constructionEnd);
    const os = yr(tl.operationsStart), oe = yr(tl.operationsEnd);
    const hasOps = phase.operationsPeriods > 0;
    for (let c = OPEN_COL; c <= last; c++) {
      const y = yearOfCol(c);
      // Operations paint over construction in an overlap year, because that is
      // the year the asset starts earning; the overlap is visible in the dated
      // table above rather than being fudged into a half-filled cell.
      if (hasOps && y >= os && y <= oe) bar(ws.getCell(r, c), ARGB.good);
      else if (phase.constructionPeriods > 0 && y >= cs && y <= ce) bar(ws.getCell(r, c), ARGB.navy);
      else fillCell(ws.getCell(r, c), ARGB.grey);
    }
    r += 1;
  }
  // Project end marker row.
  setLabel(ws.getCell(r, 1), 'Project end', { bold: true });
  for (let c = OPEN_COL; c <= last; c++) {
    const cell = ws.getCell(r, c);
    if (yearOfCol(c) === projTl.endYear) bar(cell, ARGB.sectionDark, 'END');
    else fillCell(cell, ARGB.grey);
  }
  r += 2;

  // ── 3. Legend ───────────────────────────────────────────────────────────────
  setLabel(ws.getCell(r, 1), 'Legend:', { bold: true });
  const swatch = (col: number, argb: string, text: string): void => {
    const c = ws.getCell(r, col); c.value = text; fillCell(c, argb);
    c.font = { name: 'Calibri', size: 8.5, bold: true, color: { argb: ARGB.white } };
    c.alignment = { horizontal: 'center' };
  };
  swatch(2, ARGB.navy, 'Construction');
  swatch(3, ARGB.good, 'Operations');
  swatch(4, ARGB.sectionDark, 'Project end');
  r += 1;
  const note = ws.getCell(r, 1);
  note.value = 'Dates are the model\'s own phase timeline (phase start date, construction periods, operations periods and overlap). Operations shade over construction in an overlap year.';
  note.font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
}

// Strategy -> display group, shared by the Land & Area and Capex groupings.
function strategyGroup(strategy: string): 'Residential' | 'Hospitality' | 'Retail' | 'Other' {
  if (strategy === 'Operate') return 'Hospitality';
  if (strategy === 'Lease') return 'Retail';
  if (strategy === 'Sell' || strategy === 'Sell + Manage') return 'Residential';
  return 'Other';
}

// ── Land & Area (formula area hierarchy + land value, links to Assumptions) ────
// Asset-wise (no sub-unit rows): each asset's NSA / Support / BUA / GFA, land
// value (cash + in-kind split), unit count and GDV, grouped by strategy
// (Residential -> Hospitality -> Retail) with a total per group. Sub-unit areas
// are folded directly into each asset's formula (summed off the Assumptions
// sub-unit inputs) so the tab reads at the asset level. GDV is a residential
// (for-sale) concept, so it is shown only for Residential assets (and for any
// asset that drives a percent-of-revenue capex line, which needs the basis).
function addLandArea(wb: ExcelJS.Workbook, state: FinancialsResolverState, refs: AssumptionRefs): Map<string, LandAreaAssetAddrs> {
  const ws = wb.addWorksheet(SHEETS.landArea, { properties: { tabColor: { argb: ARGB.navy } } });
  ws.getColumn(1).width = 30;
  for (let c = 2; c <= 14; c++) ws.getColumn(c).width = 13;
  setTitle(ws.getCell('A1'), 'Land & Area', 16);
  setNote(ws.getCell('A1'), `${SNAPSHOT_NOTE}\n\nSourced from Inputs (parcels, asset areas, sub-units). Feeds the Capex build-up (percent / unit cost bases) and the Balance Sheet land.`);
  setLabel(ws.getCell('A2'), 'Area hierarchy (NSA -> BUA -> GFA), land value and unit count per asset, grouped by strategy. GDV is shown for residential (for-sale) assets. This tab is a metric grid (one column per metric), so the per-column Basis / Calculation is given in the legend below the table rather than as a row column.');

  // Engine metrics per asset, cached so the formulas reconcile to the platform.
  const metricsById = new Map<string, AssetAreaMetrics>();
  for (const a of state.assets.filter((x) => x.visible !== false)) {
    const inPhase = state.assets.filter((x) => x.phaseId === a.phaseId);
    metricsById.set(a.id, resolveAssetAreaMetrics(a, state.project, state.parcels, inPhase, state.subUnits, state.landAllocationMode));
  }

  const catOf = strategyGroup; // strategy -> display group (shared helper)
  // GDV is shown for residential assets; also kept for any asset whose capex has a
  // percent-of-revenue line (the build-up base links to the GDV cell).
  const revenueLinked = new Set(
    refs.capex.filter((a) => a.lines.some((l) => /revenue/.test(l.method))).flatMap((a) => refs.capexMembers?.get(a.assetId) ?? [a.assetId]),
  );
  const needsGdv = (ar: AssetInputRef): boolean => catOf(ar.strategy) === 'Residential' || revenueLinked.has(ar.id);

  // Inline sub-unit expressions (summed off the Assumptions sub-unit inputs), so
  // the asset rows carry the NSA / support / unit / GDV contributions directly.
  const subOf = (assetId: string): SubUnitInputRef[] => refs.subUnits.filter((s) => s.assetId === assetId);
  const areaExpr = (s: SubUnitInputRef): string => `IF(${s.metric}="area",${s.value},${s.value}*${s.unitArea})`;
  const isNsaCat = (s: SubUnitInputRef): string => `OR(${s.category}="Sellable",${s.category}="Operable",${s.category}="Leasable")`;
  const nsaExpr = (s: SubUnitInputRef): string => `IF(${isNsaCat(s)},${areaExpr(s)},0)`;
  const supExpr = (s: SubUnitInputRef): string => `IF(${s.category}="Support",${areaExpr(s)},0)`;
  const unitsExpr = (s: SubUnitInputRef): string => `IF(OR(${s.metric}="units",${s.metric}="count"),${s.value},0)`;
  const gdvExpr = (s: SubUnitInputRef): string => `IF(${isNsaCat(s)},${s.value}*${s.price},0)`;
  const joinOr0 = (parts: string[]): string => (parts.length ? parts.join('+') : '0');

  // Column header set (A label + B..N metrics). Land rate (I) is per-sqm so it is
  // never summed into a group total.
  const HEADERS = ['Asset', 'NSA', 'Support', 'BUA', 'Parking', 'GFA', 'Parking bays', 'Land (sqm)', 'Land rate', 'Land value', 'Cash land', 'In-kind land', 'Units', 'GDV'];
  const LASTCOL = HEADERS.length; // 14 (col N)

  let r = 4;
  setSectionHeader(ws.getRow(r), 'Asset area & land', LASTCOL); r += 1;
  HEADERS.forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right')); r += 1;

  const groupOrder: Array<'Residential' | 'Hospitality' | 'Retail' | 'Other'> = ['Residential', 'Hospitality', 'Retail', 'Other'];
  interface ARow { ref: AssetInputRef; row: number }
  interface GBlock { label: string; aRows: ARow[]; subtotalRow: number }
  const allARows: ARow[] = [];
  const blocks: GBlock[] = [];

  // Layout + hierarchy (B..G) pass: a group label row, asset hierarchy rows, then
  // a reserved subtotal row per group.
  for (const cat of groupOrder) {
    const inGroup = refs.assets.filter((a) => catOf(a.strategy) === cat);
    if (!inGroup.length) continue;
    setLabel(ws.getCell(r, 1), cat, { bold: true }); fillRange(ws, r, 1, r, LASTCOL, ARGB.subtotal); r += 1;
    const grp: ARow[] = [];
    for (const ar of inGroup) {
      const m = metricsById.get(ar.id);
      const subs = subOf(ar.id);
      const nsaSub = joinOr0(subs.map(nsaExpr));
      const supSub = joinOr0(subs.map(supExpr));
      setLabel(ws.getCell(`A${r}`), ar.name, { indent: 1 });
      setFormula(ws.getCell(`B${r}`), fcell(`MAX(${ar.nsa},${nsaSub})`, m?.nsa ?? 0), NUMFMT.int, true);
      setFormula(ws.getCell(`C${r}`), fcell(`${ar.support}+(${supSub})`, m?.supportArea ?? 0), NUMFMT.int, true);
      setFormula(ws.getCell(`D${r}`), fcell(`MAX(${ar.bua},B${r}+C${r})`, m?.bua ?? 0), NUMFMT.int, true);
      setFormula(ws.getCell(`E${r}`), fcell(ar.parking, m?.parkingArea ?? 0), NUMFMT.int, true);
      setFormula(ws.getCell(`F${r}`), fcell(`MAX(${ar.gfa},D${r}+E${r})`, m?.gfa ?? 0), NUMFMT.int, true);
      setFormula(ws.getCell(`G${r}`), fcell(ar.parkingBays, m?.parkingBays ?? 0), NUMFMT.int, true);
      const aRow: ARow = { ref: ar, row: r };
      grp.push(aRow); allARows.push(aRow);
      r += 1;
    }
    blocks.push({ label: cat, aRows: grp, subtotalRow: r }); r += 1;
  }

  // Land columns (H..N) pass: need every asset BUA cell for the auto-by-BUA land
  // share, so this runs after the full layout.
  const parcelPhase = new Map(state.parcels.map((p) => [p.id, p.phaseId] as const));
  const parcelsInPhase = (phaseId: string): ParcelInputRef[] => refs.parcels.filter((p) => parcelPhase.get(p.id) === phaseId);
  const landAddrsByAsset = new Map<string, LandAreaAssetAddrs>();
  for (const { ref: ar, row } of allARows) {
    const m = metricsById.get(ar.id);
    const ph = ar.phaseId;
    const pcs = parcelsInPhase(ph);
    const landTotal = pcs.length ? pcs.map((p) => p.area).join('+') : '0';
    const landValueF = pcs.length ? pcs.map((p) => `${p.area}*${p.rate}`).join('+') : '0';
    const cashValueF = pcs.length ? pcs.map((p) => `${p.area}*${p.rate}*${p.cashPct}`).join('+') : '0';
    const phaseBua = allARows.filter((x) => x.ref.phaseId === ph).map((x) => `D${x.row}`).join('+') || '0';
    setFormula(ws.getCell(`H${row}`), fcell(`IF(${ar.landSqm}>0,${ar.landSqm},IFERROR((${landTotal})*D${row}/(${phaseBua}),0))`, m?.landSqm ?? 0), NUMFMT.int, true);
    setFormula(ws.getCell(`I${row}`), fcell(`IF(${ar.landRate}>0,${ar.landRate},IFERROR((${landValueF})/(${landTotal}),0))`, (m && m.landSqm > 0) ? m.landValue / m.landSqm : 0), NUMFMT.rate, true);
    setFormula(ws.getCell(`J${row}`), fcell(`H${row}*I${row}`, m?.landValue ?? 0), NUMFMT.money);
    setFormula(ws.getCell(`K${row}`), fcell(`J${row}*IFERROR((${cashValueF})/(${landValueF}),0)`, m?.cashLandValue ?? 0), NUMFMT.money);
    setFormula(ws.getCell(`L${row}`), fcell(`J${row}-K${row}`, m?.inKindLandValue ?? 0), NUMFMT.money);
    const subs = subOf(ar.id);
    setFormula(ws.getCell(`M${row}`), fcell(joinOr0(subs.map(unitsExpr)), m?.unitCount ?? 0), NUMFMT.int);
    // GDV: residential (for-sale) assets + any revenue-linked asset; blank else.
    if (needsGdv(ar)) setFormula(ws.getCell(`N${row}`), fcell(joinOr0(subs.map(gdvExpr)), m?.totalRevenue ?? 0), NUMFMT.money);
    landAddrsByAsset.set(ar.id, {
      landValue: sheetRef(SHEETS.landArea, `$J$${row}`),
      cashLand: sheetRef(SHEETS.landArea, `$K$${row}`),
      inKindLand: sheetRef(SHEETS.landArea, `$L$${row}`),
      unitCount: sheetRef(SHEETS.landArea, `$M$${row}`),
      revenue: sheetRef(SHEETS.landArea, `$N$${row}`),
    });
  }

  // Group total rows: SUM the group's asset rows per column (skip the per-sqm rate
  // col I; GDV col N only where the group carries it).
  const sumSpec: Array<{ col: number; pick: (m: AssetAreaMetrics) => number; fmt: string }> = [
    { col: 2, pick: (m) => m.nsa, fmt: NUMFMT.int },
    { col: 3, pick: (m) => m.supportArea, fmt: NUMFMT.int },
    { col: 4, pick: (m) => m.bua, fmt: NUMFMT.int },
    { col: 5, pick: (m) => m.parkingArea, fmt: NUMFMT.int },
    { col: 6, pick: (m) => m.gfa, fmt: NUMFMT.int },
    { col: 7, pick: (m) => m.parkingBays, fmt: NUMFMT.int },
    { col: 8, pick: (m) => m.landSqm, fmt: NUMFMT.int },
    { col: 10, pick: (m) => m.landValue, fmt: NUMFMT.money },
    { col: 11, pick: (m) => m.cashLandValue, fmt: NUMFMT.money },
    { col: 12, pick: (m) => m.inKindLandValue, fmt: NUMFMT.money },
    { col: 13, pick: (m) => m.unitCount, fmt: NUMFMT.int },
  ];
  for (const b of blocks) {
    const rr = b.subtotalRow;
    setLabel(ws.getCell(rr, 1), `Total ${b.label}`, { bold: true });
    const rowsWithM = b.aRows.map((a) => ({ row: a.row, m: metricsById.get(a.ref.id) })).filter((x) => x.m) as Array<{ row: number; m: AssetAreaMetrics }>;
    for (const sp of sumSpec) {
      const f = colSum(colLetter(sp.col), rowsWithM.map((x) => x.row));
      const cached = rowsWithM.reduce((s, x) => s + sp.pick(x.m), 0);
      setFormula(ws.getCell(rr, sp.col), fcell(f, cached), sp.fmt);
    }
    // GDV total only if any asset in the group carries it.
    const gdvRows = b.aRows.filter((a) => needsGdv(a.ref)).map((a) => ({ row: a.row, m: metricsById.get(a.ref.id) })).filter((x) => x.m) as Array<{ row: number; m: AssetAreaMetrics }>;
    if (gdvRows.length) {
      setFormula(ws.getCell(rr, LASTCOL), fcell(colSum('N', gdvRows.map((x) => x.row)), gdvRows.reduce((s, x) => s + x.m.totalRevenue, 0)), NUMFMT.money);
    }
    fillRange(ws, rr, 1, rr, LASTCOL, ARGB.navy);
    for (let c = 1; c <= LASTCOL; c++) ws.getCell(rr, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } };
  }

  // ── Basis / Calculation legend (per-column derivations) ─────────────────────
  // Land & Area is a metric grid (one column per metric), so the guidance can
  // not sit in a per-row column like the other tabs. It is given here as a
  // clearly-labelled per-column legend so the tab is not silently missing it.
  let lr = (blocks.length ? Math.max(...blocks.map((b) => b.subtotalRow)) : 5) + 2;
  setSectionHeader(ws.getRow(lr), 'Basis / Calculation (per column)', LASTCOL); lr += 1;
  const COL_BASIS: Array<[string, string]> = [
    ['NSA', 'Sum of Sellable / Operable / Leasable sub-unit areas'],
    ['Support', 'Sum of Support sub-unit areas'],
    ['BUA', 'max(asset BUA, NSA + Support)'],
    ['Parking', 'Asset parking area'],
    ['GFA', 'max(asset GFA, BUA + Parking)'],
    ['Parking bays', 'Asset parking bays required'],
    ['Land (sqm)', 'Asset land sqm, or parcel area x BUA share'],
    ['Land rate', 'Asset land rate, or parcel land value / area'],
    ['Land value', 'Land (sqm) x Land rate'],
    ['Cash land', 'Land value x parcel cash %'],
    ['In-kind land', 'Land value - Cash land'],
    ['Units', 'Sum of units / count sub-units'],
    ['GDV', 'Sum of sub-unit units x price (for-sale assets)'],
  ];
  for (const [colName, basisText] of COL_BASIS) {
    setLabel(ws.getCell(lr, 1), colName, { bold: true });
    const bc = ws.getCell(lr, 2); bc.value = basisText; bc.font = { name: 'Calibri', size: BODY_SIZE, italic: true, color: { argb: ARGB.navyDark } };
    lr += 1;
  }

  // ── Structural zeros ────────────────────────────────────────────────────────
  // An asset can legitimately report nil area here: an existing operational
  // asset has no new build, and a companion's area sits on its parent. Beside
  // assets reporting real areas a bare 0 reads as missing data, so the reasons
  // are named. The CELLS keep their formulas (the group subtotals reference
  // column D, and a text marker there would break them), so the explanation is
  // given as a footnote instead of in the cell.
  {
    const notes = buildAssetNotes(state, (v) => `${formatAccounting(v, 'millions', 1)} m`);
    const nilRows = allARows.filter(({ ref }) => {
      const m = metricsById.get(ref.id);
      return notes.hasBuaNote(ref.id, m?.bua ?? 0) !== null;
    });
    const raised = notes.takeFootnotes();
    if (nilRows.length > 0 && raised.length > 0) {
      lr += 1;
      setSectionHeader(ws.getRow(lr), 'Assets reporting nil built-up area (and why)', LASTCOL); lr += 1;
      for (const { ref } of nilRows) {
        const z = notes.byAssetId.get(ref.id);
        setLabel(ws.getCell(lr, 1), `${ref.name} ${z ? z.marker : ''}`, { bold: true });
        lr += 1;
      }
      for (const fn of raised) {
        const fc = ws.getCell(lr, 1); fc.value = fn.text;
        fc.font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
        lr += 1;
      }
    }
  }

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 5, showGridLines: false }];
  return landAddrsByAsset;
}

// ── Capex (cost build-up + phased schedule) ───────────────────────────────────
// scheduleTotalAddr / buildupTotalAddr feed the Checks reconciliation. The row
// registry + period-column function let the downstream tabs (Cost of Sales,
// Balance Sheet) reference the Capex schedule live by cell.
interface CapexAddrs {
  scheduleTotalAddr: string;
  buildupTotalAddr: string;
  inclTotalRow: number;        // Table 1 'Project Total (incl. all land)'
  exclInKindTotalRow: number;  // Table 3 'Total Capex (excl. land in-kind)' = CFI cash
  exclAllTotalRow: number;     // Table 4 'Total Capex (excl. all land)'
  perAsset: Map<string, { inclRow: number; exclInKindRow: number; exclAllRow: number }>;
  /** Capex-local period column index for axis period t (its geometry differs). */
  periodCol: (t: number) => number;
}

function addCapex(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, capex: CapexReport, refs: AssumptionRefs, landAddrs: Map<string, LandAreaAssetAddrs>): CapexAddrs {
  const ws = wb.addWorksheet(SHEETS.capex, { properties: { tabColor: { argb: ARGB.navy } } });
  const N = refs.axisLength;
  // Capex-LOCAL geometry (the other period sheets keep the shared geometry): one
  // extra metadata column for Quantity, so A = Cost line, B = UOM, C = Rate,
  // D = Quantity, E = Total, F = Period 0 (opening), G.. = active years.
  const C_LBL = 1, C_UOM = 2, C_RATE = 3, C_QTY = 4, C_TOT = 5, C_OPEN = 6;
  const cP = (t: number): number => C_OPEN + 1 + t;   // G.. active period t
  const cLast = C_OPEN + N;                            // last active column
  const cChk = cLast + 1;
  const cRange = (rr: number): string => `${colLetter(cP(0))}${rr}:${colLetter(cLast)}${rr}`;
  const TOL = 0.0001;
  const TITLE = 'Capex';
  const SUB = 'Development cost, fully live. Each line: Total = Rate x Quantity (the live basis). INPUTS (top): allocation % per period. OUTPUTS: Table 1 the per-line schedule (period = Total x allocation %), then Tables 2-4 the asset-wise incl-land / excl-in-kind / excl-total-land summaries. All tie by construction.';

  // ── Capex-local frozen 4-row header (rows 3 dates / 4 index; freeze A-E) ──
  ws.getColumn(C_LBL).width = 34; ws.getColumn(C_UOM).width = 16; ws.getColumn(C_RATE).width = 12; ws.getColumn(C_QTY).width = 15; ws.getColumn(C_TOT).width = 15;
  for (let c = C_OPEN; c <= cLast; c++) ws.getColumn(c).width = 12;
  ws.getColumn(cChk).width = 9;
  setTitle(ws.getCell('A1'), TITLE, 16);
  setNote(ws.getCell('A1'), `${SNAPSHOT_NOTE}\n\nSourced from Inputs (cost lines) and Land & Area (cost bases). Feeds Cost of Sales, Financing and the Balance Sheet. UOM column = each line's basis; Total = Rate x Quantity.`);
  setLabel(ws.getCell('A2'), SUB);
  setColHeader(ws.getCell(4, C_LBL), 'Cost line', 'left');
  setColHeader(ws.getCell(4, C_UOM), 'UOM', 'left');
  setColHeader(ws.getCell(4, C_RATE), 'Rate', 'right');
  setColHeader(ws.getCell(4, C_QTY), 'Quantity', 'right');
  setColHeader(ws.getCell(4, C_TOT), 'Total', 'right');
  setColHeader(ws.getCell(4, cChk), 'Check', 'center');
  for (let c = C_OPEN; c <= cLast; c++) {
    const cl = colLetter(c);
    const d = ws.getCell(3, c);
    setFormula(d, fcell(sheetRef(SHEETS.timeline, `${cl}3`), colYear(snap, c)), NUMFMT.date, true);
    d.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    d.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.grey } };
    d.alignment = { horizontal: 'right' };
    const ix = ws.getCell(4, c);
    setFormula(ix, fcell(sheetRef(SHEETS.timeline, `${cl}4`), c - C_OPEN), NUMFMT.year, true);
    ix.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    ix.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.grey } };
    ix.alignment = { horizontal: 'right' };
  }
  ws.views = [{ state: 'frozen', xSplit: C_TOT, ySplit: 4, showGridLines: false }];

  const cat = (assetId: string): string => strategyGroup(refs.assets.find((x) => x.id === assetId)?.strategy ?? '');
  // Cached engine series (per asset name) for the 4 result tables.
  // BY ASSET ID, NOT BY DISPLAY LABEL (2026-09-10). This dug the per-asset
  // series out of a summary table by matching the row label to `asset.name`;
  // the summary tables now consolidate by phase and type, and a label was never
  // an identity in the first place. `assetSeries` is the report's own per-asset
  // output, keyed by id.
  const capexById = new Map(capex.assetSeries.map((x) => [x.assetId, x] as const));
  const perPeriodByLine = new Map<string, number[]>();
  for (const ia of capex.inputAssets) for (const ln of ia.lines) perPeriodByLine.set(`${ia.assetId}|${ln.id}`, ln.perPeriod ?? []);

  // A navy / grey total row over the Capex geometry (Total in E = SUM of periods).
  const cSum = (rr: number, label: string, srcRows: number[], cachedPer: number[], style: 'navy' | 'subtotal', cachedOpen = 0): void => {
    setLabel(ws.getCell(rr, C_LBL), label, { bold: true });
    const put = (c: number, cached: number): void => setFormula(ws.getCell(rr, c), fcell(colSum(colLetter(c), srcRows), cached), NUMFMT.money);
    put(C_OPEN, cachedOpen);
    for (let t = 0; t < N; t++) put(cP(t), cachedPer[t] ?? 0);
    setFormula(ws.getCell(rr, C_TOT), fcell(`SUM(${cRange(rr)})`, cachedPer.slice(0, N).reduce((s, v) => s + (v ?? 0), 0)), NUMFMT.money);
    const fill = style === 'navy' ? ARGB.navy : ARGB.subtotal; const fg = style === 'navy' ? ARGB.white : ARGB.navyDark;
    fillRange(ws, rr, 1, rr, cLast, fill);
    for (let c = 1; c <= cLast; c++) ws.getCell(rr, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: fg } };
  };

  // Money-basis methods (Quantity scales with the workbook); everything else is a
  // count / area (sqm, bays, units, lump) and stays unscaled like a rate.
  const moneyBasis = new Set(['percent_of_inkind_land', 'percent_of_cash_land', 'percent_of_total_land', 'percent_of_total_revenue', 'percent_of_revenue_cash', 'percent_of_revenue_sale', 'percent_of_selected', 'percent_of_construction']);

  let r = 5;

  // ── INPUTS: all assets' allocation % tables, in sequence ─────────────────────
  setSectionHeader(ws.getRow(r), 'INPUTS - Allocation profile per cost line (% of each line\'s total, per period)', cLast); r += 1;
  // line key -> per-period allocation % cell address [Period0, active0, active1, ...].
  const allocCells = new Map<string, string[]>();
  for (const a of refs.capex) {
    setLabel(ws.getCell(r, C_LBL), `${a.name} (${a.phaseName})`, { bold: true }); fillRange(ws, r, 1, r, cLast, ARGB.subtotal); r += 1;
    for (const ln of a.lines) {
      const total = ln.amount;
      const pp = perPeriodByLine.get(`${a.assetId}|${ln.id}`) ?? [];
      setLabel(ws.getCell(r, C_LBL), ln.name, { indent: 1 });
      setLabel(ws.getCell(r, C_UOM), ln.basis);
      setFormula(ws.getCell(r, C_RATE), fcell(ln.rateAddr, ln.isPercent ? ln.rate / 100 : ln.rate), ln.isPercent ? NUMFMT.pct2 : NUMFMT.rate, true);
      const cells: string[] = [];
      let pctSum = 0;
      setInput(ws.getCell(r, C_OPEN), 0, NUMFMT.pct2); cells.push(`$${colLetter(C_OPEN)}$${r}`); // Period 0: no capex
      for (let t = 0; t < N; t++) {
        const c = cP(t);
        const pct = total ? (pp[t] ?? 0) / total : 0; // guard: zero total -> 0
        setInput(ws.getCell(r, c), pct, NUMFMT.pct2);
        cells.push(`$${colLetter(c)}$${r}`);
        pctSum += pct;
      }
      // Total (E) = sum of the period %s (should be 100%); Check flags drift.
      setFormula(ws.getCell(r, C_TOT), fcell(`SUM(${cRange(r)})`, pctSum), NUMFMT.pct2);
      const ok = Math.abs(pctSum - (total ? 1 : 0)) <= TOL;
      setFormula(ws.getCell(r, cChk), fcell(`IF(ABS(${colLetter(C_TOT)}${r}-${total ? 1 : 0})<=${TOL},"OK","CHECK")`, ok ? 'OK' : 'CHECK'), '@');
      ws.getCell(r, cChk).alignment = { horizontal: 'center' };
      ws.getCell(r, cChk).font = { name: 'Calibri', size: BODY_SIZE, bold: !ok, color: { argb: ok ? ARGB.navy : ARGB.bad } };
      allocCells.set(`${a.assetId}|${ln.id}`, cells);
      r += 1;
    }
  }
  r += 1;

  // ── Table 1: per-asset cost-line schedule (single block per asset) ───────────
  // Cost line, UOM, Rate, Quantity (the live basis), Total = Rate x Quantity, then
  // the period amounts (= Total x allocation %). The build-up is merged here, so
  // there is no separate build-up block. Subtotal rows feed Tables 2-4.
  setSectionHeader(ws.getRow(r), 'Table 1 - Construction Cost Schedule by Period (per cost line, per asset)', cLast); r += 1;
  interface AssetMeta { assetId: string; name: string; category: string; inclRow: number; landRows: number[]; nonLandRows: number[]; exclAll: number[]; exclInKind: number[]; incl: number[] }
  const assetMeta: AssetMeta[] = [];
  const assetInclRows: number[] = [];
  const allLineTotCells: string[] = []; // every line's Total (E) cell, for the build-up grand
  const grandCapex = refs.capex.reduce((s, a) => s + a.total, 0);

  for (const a of refs.capex) {
    const land = landAddrs.get(a.assetId);
    setLabel(ws.getCell(r, C_LBL), `${a.name} (${a.phaseName})`, { bold: true }); fillRange(ws, r, 1, r, cLast, ARGB.subtotal); r += 1;
    // Pre-assign line rows so percent-of-selected can reference sibling Total (E) cells.
    const totRowOf = new Map<string, number>();
    a.lines.forEach((ln, i) => totRowOf.set(ln.id, r + i));
    const eCellOf = (id: string): string | null => { const rr = totRowOf.get(id); return rr != null ? `$E$${rr}` : null; };
    const sumE = (ids: string[], own: string): string | null => {
      const cells = ids.map(eCellOf).filter((c): c is string => !!c && c !== own);
      return cells.length ? `(${cells.join('+')})` : null;
    };
    // The live Quantity basis (the value the Rate multiplies) for a line.
    const qtyExprOf = (ln: CapexLineRef, own: string): string | null => {
      if (ln.qtyAddr) return ln.qtyAddr;                      // area / bays (Assumptions stored qty)
      switch (ln.method) {
        case 'rate_per_unit': return land?.unitCount ?? null;
        case 'percent_of_inkind_land': return land?.inKindLand ?? null;
        case 'percent_of_cash_land': return land?.cashLand ?? null;
        case 'percent_of_total_land': return land?.landValue ?? null;
        case 'percent_of_total_revenue':
        case 'percent_of_revenue_cash':
        case 'percent_of_revenue_sale': return land?.revenue ?? null;
        case 'percent_of_selected': return sumE(ln.selectedLineIds, own);
        case 'percent_of_construction': return sumE(a.lines.filter((s) => s.stage === 'hard' && s.id !== ln.id).map((s) => s.id), own);
        default: return null;
      }
    };
    const sumAmt = (ids: string[]): number => ids.reduce((s, id) => s + (a.lines.find((l) => l.id === id)?.amount ?? 0), 0);
    const predictedLive = (ln: CapexLineRef): number | null => {
      switch (ln.method) {
        case 'fixed': return ln.rate;
        case 'percent_of_selected': return (ln.rate / 100) * sumAmt(ln.selectedLineIds.filter((id) => id !== ln.id));
        case 'percent_of_construction': return (ln.rate / 100) * sumAmt(a.lines.filter((s) => s.stage === 'hard' && s.id !== ln.id).map((s) => s.id));
        default: return null;
      }
    };
    const lineRows: number[] = []; const landRows: number[] = []; const nonLandRows: number[] = [];
    const inclYear = new Array<number>(N).fill(0); const exclYear = new Array<number>(N).fill(0);
    for (const ln of a.lines) {
      const myRow = totRowOf.get(ln.id)!;
      const isLand = ln.stage === 'land';
      const own = `$E$${myRow}`;
      setLabel(ws.getCell(myRow, C_LBL), ln.name, { indent: 1 });
      setLabel(ws.getCell(myRow, C_UOM), ln.basis);
      setFormula(ws.getCell(myRow, C_RATE), fcell(ln.rateAddr, ln.isPercent ? ln.rate / 100 : ln.rate), ln.isPercent ? NUMFMT.pct2 : NUMFMT.rate, true);
      const rateDec = ln.isPercent ? ln.rate / 100 : ln.rate;
      const qtyCached = rateDec !== 0 ? ln.amount / rateDec : 0; // fixed -> amount/rate = 1
      const qtyFmt = moneyBasis.has(ln.method) ? NUMFMT.money : NUMFMT.int;
      const qtyCell = `$D$${myRow}`;
      // Quantity (D) + Total (E = Rate x Quantity). Cross-asset-allocated lines and
      // bases with no reproducible cell fall back to the cached engine value.
      const totCell = `$C$${myRow}*${qtyCell}`; // Total = Rate (C) x Quantity (D)
      if (ln.method === 'fixed') {
        // Lump sum: Quantity = 1, Total = Rate x 1.
        const c = ws.getCell(myRow, C_QTY); c.value = 1; c.numFmt = NUMFMT.int; c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
        setFormula(ws.getCell(myRow, C_TOT), fcell(totCell, ln.amount), NUMFMT.money);
      } else {
        const qExpr = qtyExprOf(ln, own);
        const predicted = predictedLive(ln);
        const reconciles = predicted === null || Math.abs(predicted - ln.amount) <= Math.max(1, Math.abs(ln.amount) * 1e-6);
        if (qExpr && reconciles) {
          setFormula(ws.getCell(myRow, C_QTY), fcell(qExpr, qtyCached), qtyFmt, /!/.test(qExpr));
          setFormula(ws.getCell(myRow, C_TOT), fcell(totCell, ln.amount), NUMFMT.money);
        } else {
          // Engine-sourced (cross-asset allocation / no reproducible basis): cache both.
          const dq = ws.getCell(myRow, C_QTY); dq.value = qtyCached; dq.numFmt = qtyFmt; dq.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
          const de = ws.getCell(myRow, C_TOT); de.value = ln.amount; de.numFmt = NUMFMT.money; de.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
        }
      }
      const eCell = `$E$${myRow}`;
      const pcts = allocCells.get(`${a.assetId}|${ln.id}`) ?? [];
      const pp = perPeriodByLine.get(`${a.assetId}|${ln.id}`) ?? [];
      const money0 = (c: number, v: number): void => { const cell = ws.getCell(myRow, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
      money0(C_OPEN, 0); // Period 0: no capex
      for (let t = 0; t < N; t++) {
        const v = pp[t] ?? 0;
        setFormula(ws.getCell(myRow, cP(t)), fcell(`${eCell}*${pcts[t + 1]}`, v), NUMFMT.money);
        inclYear[t] += v; if (!isLand) exclYear[t] += v;
      }
      allLineTotCells.push(eCell);
      lineRows.push(myRow); if (isLand) landRows.push(myRow); else nonLandRows.push(myRow);
      r += 1;
    }
    // Subtotal, {asset} (incl. all land) = SUM of the line rows per column.
    const inclRow = r;
    setLabel(ws.getCell(inclRow, C_LBL), `Subtotal, ${a.name}`, { bold: true });
    setFormula(ws.getCell(inclRow, C_TOT), fcell(colSum('E', lineRows), a.total), NUMFMT.money);
    setFormula(ws.getCell(inclRow, C_OPEN), fcell(colSum(colLetter(C_OPEN), lineRows), 0), NUMFMT.money);
    for (let t = 0; t < N; t++) setFormula(ws.getCell(inclRow, cP(t)), fcell(colSum(colLetter(cP(t)), lineRows), inclYear[t]), NUMFMT.money);
    fillRange(ws, inclRow, 1, inclRow, cLast, ARGB.subtotal);
    for (let c = 1; c <= cLast; c++) ws.getCell(inclRow, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    assetInclRows.push(inclRow);
    const cx = capexById.get(a.assetId);
    const m = cx?.inclAll ?? inclYear;
    assetMeta.push({
      assetId: a.assetId, name: a.name, category: cat(a.assetId), inclRow, landRows, nonLandRows,
      exclAll: cx?.exclAll ?? exclYear, exclInKind: cx?.exclInKind ?? exclYear, incl: m,
    });
    r += 1;
  }
  // Project Total (incl. all land) = the Total Capex (4,912,199,956 on the live project).
  cSum(r, 'Project Total (incl. all land)', assetInclRows, sumSeries(assetMeta.map((m) => m.incl), N), 'navy');
  const projTotalRow = r; r += 2;

  // ── OUTPUT Tables 2-4: asset-wise summaries (reference Table 1) ───────────────
  // Each per-asset row is live off Table 1: incl = the asset subtotal; excl-total-
  // land = the asset's non-land lines; excl-in-kind = incl - in-kind land.
  const summaryTable = (title: string, totalLabel: string, perAsset: (m: AssetMeta) => { f: (col: string) => string; cached: number[]; predicted?: number[] }, totalCached: number[]): { rowsByAsset: Map<string, number>; totalRow: number } => {
    setSectionHeader(ws.getRow(r), title, cLast); r += 1;
    const rows: number[] = [];
    const rowsByAsset = new Map<string, number>();
    for (const m of assetMeta) {
      const { f, cached, predicted } = perAsset(m);
      setLabel(ws.getCell(r, C_LBL), m.name, { indent: 1 });
      setFormula(ws.getCell(r, C_OPEN), fcell(f(colLetter(C_OPEN)), 0), NUMFMT.money);
      for (let t = 0; t < N; t++) {
        const v = cached[t] ?? 0;
        // Verify-and-fallback: if the live formula would drift from the engine
        // value, store the cached constant so the table opens AND recalculates right.
        const drift = predicted ? Math.abs((predicted[t] ?? 0) - v) > Math.max(1, Math.abs(v) * 1e-6) : false;
        if (drift) { const cell = ws.getCell(r, cP(t)); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
        else setFormula(ws.getCell(r, cP(t)), fcell(f(colLetter(cP(t))), v), NUMFMT.money);
      }
      setFormula(ws.getCell(r, C_TOT), fcell(`SUM(${cRange(r)})`, cached.slice(0, N).reduce((s, v) => s + (v ?? 0), 0)), NUMFMT.money);
      rowsByAsset.set(m.assetId, r); rows.push(r); r += 1;
    }
    const totalRow = r;
    cSum(r, totalLabel, rows, totalCached, 'navy'); r += 2;
    return { rowsByAsset, totalRow };
  };

  summaryTable('Table 2 - Total Capex Including Land Value', 'Total Capex (incl. all land)',
    (m) => ({ f: (col) => `${col}${m.inclRow}`, cached: m.incl }), sumSeries(assetMeta.map((m) => m.incl), N));
  const t3 = summaryTable('Table 3 - Capex Excluding Land In-Kind (cash-impact schedule)', 'Total Capex (excl. land in-kind)',
    (m) => {
      const lnd = landAddrs.get(m.assetId);
      const frac = lnd ? `IFERROR(${lnd.inKindLand}/${lnd.landValue},0)` : '0';
      const landSum = (col: string): string => (m.landRows.length ? colSum(col, m.landRows) : '0');
      const landTot = m.incl.map((v, t) => v - (m.exclAll[t] ?? 0));
      const inKindTot = m.incl.map((v, t) => v - (m.exclInKind[t] ?? 0));
      const Ld = landTot.reduce((s, v) => s + v, 0); const Ik = inKindTot.reduce((s, v) => s + v, 0);
      const fr = Ld > 0 ? Ik / Ld : 0;
      const predicted = m.incl.map((v, t) => v - (landTot[t] ?? 0) * fr);
      return { f: (col) => `${col}${m.inclRow}-(${landSum(col)})*${frac}`, cached: m.exclInKind, predicted };
    }, sumSeries(assetMeta.map((m) => m.exclInKind), N));
  const t4 = summaryTable('Table 4 - Capex Excluding Total Land (pure development cost)', 'Total Capex (excl. all land)',
    (m) => ({ f: (col) => (m.nonLandRows.length ? colSum(col, m.nonLandRows) : '0'), cached: m.exclAll }), sumSeries(assetMeta.map((m) => m.exclAll), N));
  // Per-asset row registry for the downstream tabs (Cost of Sales / Balance
  // Sheet read the Capex schedule live): Table-1 incl subtotal, Table-3 cash
  // (excl in-kind), Table-4 construction (excl all land). Period column for axis
  // t is C_OPEN + 1 + t (Capex's local geometry).
  const perAssetCapex = new Map<string, { inclRow: number; exclInKindRow: number; exclAllRow: number }>();
  for (const m of assetMeta) perAssetCapex.set(m.assetId, { inclRow: m.inclRow, exclInKindRow: t3.rowsByAsset.get(m.assetId) ?? m.inclRow, exclAllRow: t4.rowsByAsset.get(m.assetId) ?? m.inclRow });

  // Build-up vs phased reconciliation. Build-up grand = sum of every line Total (E);
  // phased grand = Table 1 Project Total. The Checks sheet asserts they tie.
  setLabel(ws.getCell(r, C_LBL), 'Grand build-up (sum of line Totals)', { bold: true });
  setFormula(ws.getCell(r, C_TOT), fcell(allLineTotCells.length ? allLineTotCells.join('+') : '0', grandCapex), NUMFMT.money);
  const buildupTotalAddr = sheetRef(SHEETS.capex, `$E$${r}`);
  const scheduleTotalAddr = sheetRef(SHEETS.capex, `$E$${projTotalRow}`);

  return {
    scheduleTotalAddr, buildupTotalAddr,
    inclTotalRow: projTotalRow, exclInKindTotalRow: t3.totalRow, exclAllTotalRow: t4.totalRow,
    perAsset: perAssetCapex, periodCol: (t: number) => C_OPEN + 1 + t,
  };
}

/** Element-wise sum of equal-length series (padded to N). */
function sumSeries(series: number[][], N: number): number[] {
  const o = new Array<number>(N).fill(0);
  for (const s of series) for (let t = 0; t < N; t++) o[t] += s[t] ?? 0;
  return o;
}


// ── Shared period-sheet geometry + frozen 4-row header ────────────────────────
// Universal column geometry. Columns A-D are a frozen label / metadata block;
// the period columns start at E. The opening column (E) is Period 0 / Dec(start
// year - 1) (flows are 0 here, balances carry their opening). Active period t is
// at col 6 + t (year = projectStartYear + t). The Total column (D) sits inside
// the frozen block so it stays visible, and SUMs the active periods (F..last).
const LBL_COL = 1;            // A  row label
const META_B = 2, META_C = 3; // B, C  (Capex: UOM, Rate; period sheets: spacers)
const TOTAL_COL = 4;          // D  Total
const OPEN_COL = 5;           // E  Opening / Period 0 / Dec(startYear - 1)
const pcol = (t: number): number => OPEN_COL + 1 + t;        // F.. active period t
const lastActiveCol = (N: number): number => OPEN_COL + N;   // last active column
const activeRange = (N: number, r: number): string => `${colLetter(pcol(0))}${r}:${colLetter(lastActiveCol(N))}${r}`;
// Display year / period index for a 1-based column (E = startYear-1 / index 0).
const colYear = (snap: ReturnType<typeof computeFinancialsSnapshot>, c: number): number => snap.projectStartYear + (c - 6);
const FROZEN_VIEW = (): { state: 'frozen'; xSplit: number; ySplit: number; showGridLines: boolean } => ({ state: 'frozen', xSplit: TOTAL_COL, ySplit: 4, showGridLines: false });

/** A column's additive formula over the given rows: a SUM(range) when the rows
 *  are contiguous (the requested convention), else an explicit '+' join. */
function colSum(col: string, rows: number[]): string {
  if (!rows.length) return '0';
  const contiguous = rows.every((v, i) => i === 0 || v === rows[i - 1] + 1);
  return contiguous && rows.length > 1 ? `SUM(${col}${rows[0]}:${col}${rows[rows.length - 1]})` : rows.map((rr) => `${col}${rr}`).join('+');
}

// Snapshot disclaimer attached (as a non-row-consuming cell comment) to the
// title of every output tab: these are platform-computed values frozen at
// export; editing a cell does NOT recalculate; re-export after changing inputs.
const SNAPSHOT_NOTE = 'Figures are platform-computed values as of export. This is a hardcoded snapshot: editing a cell will NOT recalculate anything. To run a different scenario, change the inputs in the platform and re-export.';

/** Title + subtitle + the frozen 4-row header (row 3 = period-end dates, row 4 =
 *  period index), the period columns carrying the snapshot period-end years. Sets
 *  widths + the freeze (rows 1-4, columns A-D). `meta` adds the Capex B / C column
 *  labels. `feeds` is a short cross-tab provenance note ("Sourced from X; feeds
 *  Y") attached as a comment so it does not consume a row. */
function writeSheetHeader(ws: ExcelJS.Worksheet, snap: ReturnType<typeof computeFinancialsSnapshot>, N: number, title: string, subtitle: string, opts: { label?: string; meta?: [string, string]; feeds?: string; totalLabel?: string } = {}): void {
  ws.getColumn(LBL_COL).width = 34;
  // Column B is the "Basis / Calculation" guidance column (plain descriptive
  // text, not a live formula); C is a thin spacer. Both sit in the frozen pane.
  ws.getColumn(META_B).width = 30;
  ws.getColumn(META_C).width = 2;
  ws.getColumn(TOTAL_COL).width = 15;
  for (let c = OPEN_COL; c <= lastActiveCol(N); c++) ws.getColumn(c).width = 12;
  setTitle(ws.getCell('A1'), title, 16);
  setNote(ws.getCell('A1'), opts.feeds ? `${SNAPSHOT_NOTE}\n\n${opts.feeds}` : SNAPSHOT_NOTE);
  setLabel(ws.getCell('A2'), subtitle);
  if (opts.label) setColHeader(ws.getCell(4, LBL_COL), opts.label, 'left');
  setColHeader(ws.getCell(4, META_B), 'Basis / Calculation', 'left');
  // The leading column does NOT always hold a lifetime sum. On the balance
  // sheet every figure in it is the closing balance, and on the cash flow tab
  // it is both at once (summed flows plus closing cash), which is how TOTAL
  // ASSETS came to print the at-exit figure under a heading saying "Total".
  // The caller supplies the honest heading, derived from the same shared rule
  // the screen and the PDFs use (lib/reports/m4Reports.totalColumnHeading).
  setColHeader(ws.getCell(4, TOTAL_COL), opts.totalLabel ?? 'Total', 'right');
  for (let c = OPEN_COL; c <= lastActiveCol(N); c++) {
    const cl = colLetter(c);
    const d = ws.getCell(3, c); // period-end date (linked to Timeline date row)
    setFormula(d, fcell(sheetRef(SHEETS.timeline, `${cl}3`), colYear(snap, c)), NUMFMT.date, true);
    d.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    d.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.grey } };
    d.alignment = { horizontal: 'right' };
    const ix = ws.getCell(4, c); // period index (linked to Timeline index row)
    setFormula(ix, fcell(sheetRef(SHEETS.timeline, `${cl}4`), c - OPEN_COL), NUMFMT.year, true);
    ix.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    ix.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.grey } };
    ix.alignment = { horizontal: 'right' };
  }
  ws.views = [FROZEN_VIEW()];
}


/** A total row whose opening (E) + period (F..) cells SUM the given source rows
 *  (SUM(range) when contiguous), platform values cached. style 'navy' = grand
 *  total; 'subtotal' = grey. */
function navySumRow(ws: ExcelJS.Worksheet, r: number, N: number, label: string, sourceRows: number[], cachedPerPeriod: number[], style: 'navy' | 'subtotal' = 'navy', openingCached = 0, basis = ''): void {
  setLabel(ws.getCell(r, LBL_COL), label, { bold: true });
  const sumCol = (c: number, cached: number): void => {
    setFormula(ws.getCell(r, c), fcell(colSum(colLetter(c), sourceRows), cached), NUMFMT.money);
  };
  sumCol(OPEN_COL, openingCached);
  for (let t = 0; t < N; t++) sumCol(pcol(t), cachedPerPeriod[t] ?? 0);
  setFormula(ws.getCell(r, TOTAL_COL), fcell(`SUM(${activeRange(N, r)})`, cachedPerPeriod.slice(0, N).reduce((s, v) => s + (v ?? 0), 0)), NUMFMT.money);
  const lastCol = lastActiveCol(N);
  const fill = style === 'navy' ? ARGB.navy : ARGB.subtotal;
  const fg = style === 'navy' ? ARGB.white : ARGB.navyDark;
  fillRange(ws, r, 1, r, lastCol, fill);
  for (let c = 1; c <= lastCol; c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: fg } };
  if (basis) { const bc = ws.getCell(r, META_B); bc.value = basis.replace(/^=+/, ''); bc.font = { name: 'Calibri', size: BODY_SIZE, italic: true, color: { argb: fg } }; bc.alignment = { horizontal: 'left' }; }
}


// ── Downstream live emitters (Revenue → CoS → Opex → Financing → P&L → CF → BS → Returns) ─
// All use the shared geometry: A label, D Total, E Period 0 / opening, F.. active.
// xc(sheet,row,t) = the period-t cell on a shared-geometry sheet; the Financing
// engine owns the recurrence and every other statement links to it.
const lcol = (t: number): string => colLetter(pcol(t));
const prevCol = (t: number): string => colLetter(pcol(t - 1));
const xc = (sheet: string, row: number, t: number): string => sheetRef(sheet, `${colLetter(pcol(t))}${row}`);
// A Capex-sheet cell for axis period t (its period geometry differs from the
// shared one); used by the tabs that read the Capex schedule live.
const capexPeriodCell = (capexAddrs: CapexAddrs, row: number, t: number): string => sheetRef(SHEETS.capex, `${colLetter(capexAddrs.periodCol(t))}${row}`);

interface RowOpts { open?: { f?: string; v: number }; total?: 'sum' | 'last' | 'none'; indent?: number; bold?: boolean; fmt?: string; basis?: string }
/** Write one period row (label + Basis/Calculation text + opening E + per-period
 *  F.. + Total D). The basis is plain descriptive text, never a live formula. */
function emitRow(ws: ExcelJS.Worksheet, r: number, N: number, label: string, per: (t: number) => { f?: string; v: number }, opts: RowOpts = {}): number {
  const fmt = opts.fmt ?? NUMFMT.money;
  setLabel(ws.getCell(r, LBL_COL), label, { indent: opts.indent, bold: opts.bold });
  if (opts.basis) setBasis(ws.getCell(r, META_B), opts.basis);
  const put = (c: number, x: { f?: string; v: number }): void => {
    if (x.f) setFormula(ws.getCell(r, c), fcell(x.f, x.v), fmt);
    else { const cell = ws.getCell(r, c); cell.value = x.v; cell.numFmt = fmt; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
  };
  put(OPEN_COL, opts.open ?? { v: 0 });
  const cached: number[] = [];
  for (let t = 0; t < N; t++) { const x = per(t); put(pcol(t), x); cached.push(x.v); }
  if (opts.total !== 'none') {
    const last = opts.total === 'last';
    const f = last ? `${colLetter(lastActiveCol(N))}${r}` : `SUM(${activeRange(N, r)})`;
    const v = last ? (cached[N - 1] ?? 0) : cached.reduce((s, x) => s + x, 0);
    setFormula(ws.getCell(r, TOTAL_COL), fcell(f, v), fmt);
  }
  if (opts.bold) for (let c = 1; c <= lastActiveCol(N); c++) { const cell = ws.getCell(r, c); cell.font = { ...(cell.font as object), bold: true }; }
  return r;
}

/** A label + a scalar value in the Total (D) column: a linked formula (when
 *  `link` is set), a numeric input cell, or a literal string. Returns the
 *  absolute address of the value cell so callers can reference it in formulas.
 *  The caller owns the row cursor (increment after the call). */
function scalarCell(ws: ExcelJS.Worksheet, r: number, label: string, link: string, cached: number | string, fmt: string): string {
  setLabel(ws.getCell(r, LBL_COL), label);
  const cell = ws.getCell(r, TOTAL_COL);
  if (typeof cached === 'string') { cell.value = cached; cell.numFmt = fmt; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
  else if (link) setFormula(cell, fcell(link, cached), fmt, true);
  else { cell.value = cached; cell.numFmt = fmt; markInput(cell); }
  return `$${colLetter(TOTAL_COL)}$${r}`;
}

// Shared section emitters for the consolidated module tabs (Revenue / Opex /
// Schedules / P&L / Cash Flow / Balance Sheet). Manages its own row cursor and
// renders the standard navy hierarchy: deep-navy section bands, pale sub-table
// titles, navy totals, navy-dark subtotals. emitM4 renders a shared-builder
// M4Row (the on-screen statement model) exactly.
type RowStyle = 'plain' | 'subtotal' | 'total';

/** Options a money row takes from an M4Row. The three parts a renderer cannot
 *  guess are all here, in ONE place, because they were guessed differently in
 *  two: the Revenue tab's own emitter read `totalOverride` as "this row is a
 *  balance, so print the LAST period" instead of "print THIS value". On the
 *  Module 2 Cost of Sales section that silently printed 0 in the Total column
 *  of every scalar row the screen and the PDF filled in, and it would have
 *  printed the last period of the build's check row rather than the footing.
 *  Both emitters now map a row the same way. */
interface M4RowOpts { style: RowStyle; indent?: number; prior?: number; totalValue?: number; numFmt?: string }
function m4RowOpts(row: M4Row): M4RowOpts {
  // A BLANK override is a deliberate "print no total" sentinel, not a zero.
  // m4Reports says so (`isRealTotal` is `r.totalOverride !== ''`) and the
  // Financing tab passes `totalOverride: ''` on its state rows. Number('') is 0
  // AND finite, so reading it as a value would print 0.00 where the builder
  // asked for the closing balance.
  const blank = row.totalOverride === undefined || String(row.totalOverride).trim() === '';
  const tv = blank ? undefined : Number(row.totalOverride);
  return {
    style: row.isTotal ? 'total' : row.isSubtotal ? 'subtotal' : 'plain',
    indent: row.indent,
    prior: row.priorValue,
    // The builders are handed String as their formatter on this surface, so an
    // override parses back to its exact number. A non-numeric one (a label, a
    // dash) falls through to the summed Total rather than writing NaN.
    // A builder-stated lifetime figure (an occupancy, an ADR, a key count) wins
    // over the summed Total, since a sum of those is not a number (2026-09-14).
    totalValue: row.totalValue !== undefined ? row.totalValue : (tv !== undefined && Number.isFinite(tv) ? tv : undefined),
    // Counts and rates never take the display scale: `int` and `rate` are left
    // alone by scaleMoneyFormats, which sweeps money formats only.
    numFmt: row.isPercent ? NUMFMT.pct : row.valueKind === 'count' ? NUMFMT.int : row.valueKind === 'rate' ? NUMFMT.rate : undefined,
  };
}

function makeEmitters(ws: ExcelJS.Worksheet, N: number, start = 5): {
  section: (text: string) => void; groupBand: (text: string) => void; subTitle: (text: string) => void;
  moneyRow: (label: string, series: number[] | undefined, opts?: { style?: RowStyle; indent?: number; basis?: string; prior?: number; totalLast?: boolean; totalValue?: number; noTotal?: boolean; numFmt?: string }) => number;
  statRow: (label: string, series: number[] | undefined, numFmt: string, indent?: number) => void;
  emitM4: (row: M4Row) => number; emitTable: (rows: M4Row[]) => void; note: (text: string) => void;
  gap: () => void; cursor: () => number;
} {
  let r = start;
  const section = (text: string): void => { setSectionHeader(ws.getRow(r), text, lastActiveCol(N), ARGB.accent); r += 1; };
  // Mid-level group band (navy fill): between a deep-navy section and a pale
  // sub-table title (e.g. ASSETS / LIABILITIES / EQUITY within BS Schedules).
  const groupBand = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.navy);
    for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } };
    r += 1;
  };
  const subTitle = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.subtotal);
    for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    r += 1;
  };
  const moneyRow = (label: string, series: number[] | undefined, opts: { style?: RowStyle; indent?: number; basis?: string; prior?: number; totalLast?: boolean; totalValue?: number; noTotal?: boolean; numFmt?: string } = {}): number => {
    const used = r;
    const style = opts.style ?? 'plain';
    setLabel(ws.getCell(r, LBL_COL), label, { indent: opts.indent, bold: style !== 'plain' });
    if (opts.basis) setBasis(ws.getCell(r, META_B), opts.basis);
    const vals = (series ?? []).slice(0, N);
    // numFmt is an override, not a new styling path: a ratio row (a recognition
    // share) is the same row in every other respect, and must NOT be swept by
    // scaleMoneyFormats, which only touches money / money1.
    const nf = opts.numFmt ?? NUMFMT.money;
    const put = (c: number, v: number): void => { const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = nf; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
    put(OPEN_COL, opts.prior ?? 0);
    for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    if (!opts.noTotal) put(TOTAL_COL, opts.totalValue !== undefined ? opts.totalValue : opts.totalLast ? (vals[N - 1] ?? 0) : vals.reduce((s, v) => s + (v ?? 0), 0) + (opts.prior ?? 0));
    if (style === 'total') { fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.navy); for (let c = 1; c <= lastActiveCol(N); c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white }, italic: c === META_B }; } }
    else if (style === 'subtotal') { for (let c = 1; c <= lastActiveCol(N); c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark }, italic: c === META_B }; } }
    r += 1;
    return used;
  };
  const statRow = (label: string, series: number[] | undefined, numFmt: string, indent = 1): void => {
    setLabel(ws.getCell(r, LBL_COL), label, { indent });
    const vals = (series ?? []).slice(0, N);
    for (let t = 0; t < N; t++) { const cell = ws.getCell(r, pcol(t)); cell.value = vals[t] ?? 0; cell.numFmt = numFmt; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
    r += 1;
  };
  // Render a shared-builder M4Row: section header -> pale band; total / subtotal
  // -> styled bands; totalOverride (a numeric string when fmt = String) -> the
  // exact platform Total; priorValue -> the opening (E) column.
  const emitM4 = (row: M4Row): number => {
    if (row.isSection) { subTitle(row.label); return r - 1; }
    return moneyRow(row.label, row.values, m4RowOpts(row));
  };
  const emitTable = (rows: M4Row[]): void => { for (const row of rows) emitM4(row); };
  // A short explanatory sentence under whatever was just emitted. Its own
  // emitter rather than a moneyRow with noTotal, because moneyRow still writes
  // a zero into every period column and a note is not a data row. No-op on an
  // empty string, so callers can pass a builder's output unconditionally.
  const note = (text: string): void => {
    if (!text) return;
    setLabel(ws.getCell(r, LBL_COL), text);
    ws.getCell(r, LBL_COL).font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
    r += 2;
  };
  const gap = (): void => { r += 1; };
  const cursor = (): number => r;
  return { section, groupBand, subTitle, moneyRow, statRow, emitM4, emitTable, note, gap, cursor };
}

// Balance-sheet feeder roll-forwards (the platform Module 4 Schedules "BS
// Schedules" sub-tab), ordered by balance-sheet sequence: ASSETS (receivables,
// inventory, restricted cash), LIABILITIES (AP, unearned, debt), EQUITY (equity
// roll-forward, retained earnings). Mirrors Module4BSFeeders row-for-row; fmt =
// String so each totalOverride round-trips back to a number in emitM4.
function buildBSFeederGroups(snap: ReturnType<typeof computeFinancialsSnapshot>, state: FinancialsResolverState): Array<{ group: string; tables: ReportTable[] }> {
  const N = snap.axisLength;
  const fmt = (v: number): string => String(v);
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const sellEntries = Array.from(snap.byAssetSchedules.entries()).filter(([id]) => snap.revenue.bySellAsset.has(id));

  // A1. Residential Sales Receivables.
  const a1Rows: M4Row[] = (() => {
    const opening = zeros(), saleValue = zeros(), cashCollected = zeros(), closing = zeros();
    for (const [assetId, bundle] of sellEntries) {
      const sell = snap.revenue.bySellAsset.get(assetId)!;
      for (let t = 0; t < N; t++) {
        opening[t] += bundle.ar.openingPerPeriod[t] ?? 0;
        saleValue[t] += sell.presalesSalesValuePerPeriod[t] ?? 0;
        cashCollected[t] += sell.presalesCashPerPeriod[t] ?? 0;
        closing[t] += bundle.ar.perPeriod[t] ?? 0;
      }
    }
    const rows: M4Row[] = [
      { label: 'Opening AR (project)', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
      { label: '(+) Pre-Sales Sale Value', values: saleValue, indent: 1 },
      { label: '(-) Pre-Sales Cash Collected', values: cashCollected.map((v) => -v), indent: 1 },
      { label: 'Closing AR (project total)', values: closing, isSubtotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
    ];
    if (sellEntries.length) {
      rows.push({ label: 'Closing AR by line', values: [], isSection: true });
      for (const [, bundle, lineName] of poolMapByLine(new Map(sellEntries), state)) rows.push({ label: lineName, values: bundle.ar.perPeriod.slice(0, N), indent: 1, totalOverride: fmt(bundle.ar.perPeriod[N - 1] ?? 0) });
      rows.push({ label: 'Total Closing AR', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) });
    }
    return rows;
  })();

  // A2. Operating Receivables (DSO).
  const a2Rows: M4Row[] = (() => {
    const operatingRev = snap.pl.hospitalityRevenuePerPeriod.map((v, i) => v + (snap.pl.retailRevenuePerPeriod[i] ?? 0));
    const closing = snap.bs.arPerPeriod;
    const opening = zeros();
    for (let t = 1; t < N; t++) opening[t] = closing[t - 1] ?? 0;
    const change = closing.map((v, i) => v - (opening[i] ?? 0));
    const cash = operatingRev.map((v, i) => v - (change[i] ?? 0));
    return [
      { label: 'Opening AR', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
      { label: '(+) Operating revenue billed', values: operatingRev, indent: 1 },
      { label: '(-) Cash collected', values: cash.map((v) => -v), indent: 1 },
      { label: 'Closing AR', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
    ];
  })();

  // A3. Inventory (Residential WIP).
  const a3Rows: M4Row[] = (() => {
    const closing = zeros();
    for (const cf of snap.perAssetCF.values()) for (let t = 0; t < N; t++) closing[t] += cf.inventoryPerPeriod[t] ?? 0;
    const opening = zeros();
    for (let t = 1; t < N; t++) opening[t] = closing[t - 1] ?? 0;
    const cosTotal = snap.pl.cosPerPeriod;
    const capexCapitalized = closing.map((v, t) => (v - (opening[t] ?? 0)) + (cosTotal[t] ?? 0));
    return [
      { label: 'Opening inventory', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
      { label: '(+) Capex capitalized', values: capexCapitalized, indent: 1 },
      { label: '(-) Released to Cost of Sales', values: cosTotal.map((v) => -v), indent: 1 },
      { label: 'Closing inventory', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
    ];
  })();

  // A4. Restricted Cash (Escrow).
  const a4Rows: M4Row[] = (() => {
    const closing = snap.escrow.projectTotals.cumulativeBalancePerPeriod.slice(0, N);
    const opening = zeros();
    for (let t = 1; t < N; t++) opening[t] = closing[t - 1] ?? 0;
    return [
      { label: 'Opening Balance', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
      { label: '(+) Held this period', values: snap.escrow.projectTotals.heldPerPeriod, indent: 1 },
      { label: '(-) Release', values: snap.escrow.projectTotals.releasePerPeriod.map((v) => -v), indent: 1 },
      { label: 'Closing Balance', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
    ];
  })();

  // L1. Accounts Payable.
  const apt = snap.ap.projectTotals;
  const l1Rows: M4Row[] = [
    { label: 'Opening AP', values: apt.openingApPerPeriod, isSubtotal: true, totalOverride: fmt(apt.openingApPerPeriod[0] ?? 0) },
    { label: '(+) Opex incurred', values: apt.opexIncurredPerPeriod, indent: 1 },
    { label: '(-) Cash paid', values: apt.cashPaidPerPeriod.map((v) => -v), indent: 1 },
    { label: 'Closing AP', values: apt.closingApPerPeriod, isTotal: true, totalOverride: fmt(apt.closingApPerPeriod[N - 1] ?? 0) },
  ];

  // L2. Unearned Revenue.
  const l2Rows: M4Row[] = (() => {
    const opening = zeros(), saleValue = zeros(), recognized = zeros(), closing = zeros();
    for (const [assetId, bundle] of sellEntries) {
      const sell = snap.revenue.bySellAsset.get(assetId)!;
      for (let t = 0; t < N; t++) {
        opening[t] += bundle.unearned.openingPerPeriod[t] ?? 0;
        saleValue[t] += sell.presalesSalesValuePerPeriod[t] ?? 0;
        recognized[t] += sell.presalesRecognitionPerPeriod[t] ?? 0;
        closing[t] += bundle.unearned.perPeriod[t] ?? 0;
      }
    }
    const rows: M4Row[] = [
      { label: 'Opening unearned revenue (project)', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
      { label: '(+) Pre-sales contracts signed (sale value)', values: saleValue, indent: 1 },
      { label: '(-) Revenue recognized (at handover)', values: recognized.map((v) => -v), indent: 1 },
      { label: 'Closing unearned revenue (project total)', values: closing, isSubtotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
    ];
    if (sellEntries.length) {
      rows.push({ label: 'Closing unearned revenue by line', values: [], isSection: true });
      for (const [, bundle, lineName] of poolMapByLine(new Map(sellEntries), state)) rows.push({ label: lineName, values: bundle.unearned.perPeriod.slice(0, N), indent: 1, totalOverride: fmt(bundle.unearned.perPeriod[N - 1] ?? 0) });
      rows.push({ label: 'Total Closing Unearned Revenue', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) });
    }
    return rows;
  })();

  // L3. Debt Outstanding by Tranche.
  const l3Rows: M4Row[] = (() => {
    const rows: M4Row[] = [];
    const totalOut = zeros();
    let totalPrior = 0;
    for (const t of state.financingTranches) {
      const f = snap.financing.facilities.get(t.id);
      if (!f) continue;
      const outRow = f.outstanding.slice(0, N);
      while (outRow.length < N) outRow.push(0);
      const facPrior = f.openingBalance ?? 0;
      rows.push({ label: t.name, values: outRow, indent: 1, totalOverride: fmt(outRow[N - 1] ?? 0), priorValue: facPrior });
      for (let i = 0; i < N; i++) totalOut[i] += outRow[i] ?? 0;
      totalPrior += facPrior;
    }
    rows.push({ label: 'Total Debt Outstanding', values: totalOut, isTotal: true, totalOverride: fmt(totalOut[N - 1] ?? 0), priorValue: totalPrior });
    return rows;
  })();

  // E1. Equity Cumulative Roll-Forward (split by type).
  const e1Rows: M4Row[] = (() => {
    const cashDraws = snap.financing.equity.cashPerPeriod.slice(0, N);
    const inKindDraws = snap.financing.equity.inKindPerPeriod.slice(0, N);
    const existingDrawsRaw = snap.financing.equity.existingEquityPerPeriod.slice(0, N);
    while (cashDraws.length < N) cashDraws.push(0);
    while (inKindDraws.length < N) inKindDraws.push(0);
    while (existingDrawsRaw.length < N) existingDrawsRaw.push(0);
    const priorExisting = existingDrawsRaw.reduce((s, v) => s + v, 0);
    const opening = zeros(), closing = zeros();
    let running = priorExisting;
    for (let t = 0; t < N; t++) { opening[t] = running; running += (cashDraws[t] ?? 0) + (inKindDraws[t] ?? 0); closing[t] = running; }
    const rows: M4Row[] = [
      { label: 'Opening equity', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0), priorValue: 0 },
      { label: '(+) Cash equity drawdown', values: cashDraws, indent: 1 },
      { label: '(+) In-Kind equity (land in-kind, non-cash)', values: inKindDraws, indent: 1 },
    ];
    if (Math.abs(priorExisting) > 0.5) rows.push({ label: '(+) Existing equity (pre-axis carry-forward)', values: zeros(), indent: 1, priorValue: priorExisting });
    rows.push({ label: 'Closing equity (cumulative)', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0), priorValue: priorExisting });
    return rows;
  })();

  // E2. Retained Earnings Roll-Forward.
  const e2Rows: M4Row[] = (() => {
    const pat = snap.pl.patPerPeriod.slice(0, N);
    const reserveTransfer = snap.bs.statutoryReserveTransferPerPeriod.slice(0, N);
    const dividends = snap.bs.dividendsPerPeriod.slice(0, N);
    const closing = snap.bs.retainedEarningsPerPeriod.slice(0, N);
    const pad = (a: number[]): void => { while (a.length < N) a.push(0); };
    pad(pat); pad(reserveTransfer); pad(dividends); pad(closing);
    const opening = zeros();
    for (let t = 0; t < N; t++) opening[t] = t === 0 ? 0 : (closing[t - 1] ?? 0);
    return [
      { label: 'Opening retained earnings', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
      { label: '(+) PAT for the period', values: pat, indent: 1 },
      { label: '(-) Transfer to statutory reserve', values: reserveTransfer.map((v) => -v), indent: 1 },
      { label: '(-) Dividends declared', values: dividends.map((v) => -v), indent: 1 },
      { label: 'Closing retained earnings', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
    ];
  })();

  return [
    { group: 'ASSETS', tables: [
      { title: 'A1. Residential Sales Receivables: Roll-Forward (project)', rows: a1Rows },
      { title: 'A2. Operating Receivables: Roll-Forward (project)', rows: a2Rows },
      { title: 'A3. Inventory (Residential WIP): Roll-Forward (project)', rows: a3Rows },
      { title: 'A4. Restricted Cash (Escrow): Roll-Forward (project)', rows: a4Rows },
    ] },
    { group: 'LIABILITIES', tables: [
      { title: 'L1. Accounts Payable: Roll-Forward (project)', rows: l1Rows },
      { title: 'L2. Unearned Revenue (Off-plan advances): Roll-Forward (project)', rows: l2Rows },
      { title: 'L3. Debt Outstanding by Tranche (project)', rows: l3Rows },
    ] },
    { group: 'EQUITY', tables: [
      { title: 'E1. Equity Cumulative Roll-Forward (project, split by type)', rows: e1Rows },
      { title: 'E2. Retained Earnings Roll-Forward (project)', rows: e2Rows },
    ] },
  ];
}

interface RevLinks { byAssetRow: Map<string, number>; residentialRow: number; hospitalityRow: number; retailRow: number; totalRow: number }
interface CosLinks { byAssetRow: Map<string, number>; totalRow: number }
interface OpexLinks { hospRow: number; retailRow: number; hqRow: number; totalRow: number }
interface FinLinks {
  daRow: number; ebitdaRow: number; ebitRow: number; interestRow: number; pbtRow: number; taxRow: number; patRow: number;
  arRow: number; apRow: number; capexCashRow: number; inKindRow: number; revReceivedRow: number; opexPaidRow: number;
  cfoRow: number; cfiRow: number; debtOpenRow: number; debtDrawRow: number; principalRow: number; debtCloseRow: number;
  equityCashRow: number; equityInKindRow: number; cffRow: number; netCfRow: number; openCashRow: number; closeCashRow: number;
}
/** Cell addresses of the Returns tab's headline IRRs, plus the VALUES behind
 *  them, so the Checks tab's cached formula results come from the same engine
 *  the Returns tab printed rather than from a second model. */
interface RetLinks { fcffIrrCell: string; fcfeIrrCell: string; fcffIrr: number | null; fcfeIrr: number | null }

// ── Revenue (a mirror of the platform Module 2, all five sub-tabs in order) ───
// One sheet reproducing every Module 2 screen as a divided section, in the
// sidebar's order: 1. Inputs (one card per line, as displayed), 2. Revenue
// Output (per line, filed by section and phase, then the project total), 3. Cost
// of Sales (the build of the base first), 4. Schedules (the three feeds) and 5.
// Escrow. Lines file by CATEGORY (`revenueSection`), never by strategy, and
// every line is named the one way the Module 2 and 3 builders name it
// (`revenueLineName`). Every figure is the platform snapshot value (hardcoded).
// The link registries it returns are read by nothing downstream (addReturns
// voids them), so they carry the project rows only.

/** Four-decimal multiplier, as the screens print an indexation factor. */
const FACTOR_FMT = '0.0000"x"';
/** Two-decimal plain number (guests per room night). */
const DEC2_FMT = '0.00';

/** The Module 2 / Module 3 emitters every card and table on the two tabs uses:
 *  the shared makeEmitters plus the table title, scalar, period-input and
 *  small column-table rows those screens need. */
function makeRevOpexEmitters(ws: ExcelJS.Worksheet, N: number): ReturnType<typeof makeEmitters> & {
  tableTitle: (text: string, caption?: string) => void;
  headNote: (text: string) => void;
  scalarRow: (label: string, value: number | string | undefined, fmt: string, opts?: { basis?: string; input?: boolean; indent?: number }) => number;
  periodRow: (label: string, axis: readonly number[], window: readonly number[], fmt: string, opts?: { basis?: string; input?: boolean; indent?: number; total?: number; bold?: boolean }) => number;
  colHeaders: (cols: Array<[number, string, 'left' | 'right']>) => void;
  cellsRow: (cells: Array<[number, number | string, string, boolean?]>) => void;
  emitRows: (rows: readonly (M4Row & { fmt?: string })[]) => void;
  emitRoll: (rows: readonly M4Row[], numFmt?: string) => void;
} {
  const em = makeEmitters(ws, N);
  const font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
  const put = (r: number, c: number, v: number | string, fmt: string, input: boolean): void => {
    const cell = ws.getCell(r, c);
    if (input) { setInput(cell, v, fmt); return; }
    cell.value = v; cell.numFmt = fmt; cell.font = { ...font };
  };
  const tableTitle = (text: string, caption = ''): void => {
    const r = em.cursor();
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    ws.getCell(r, LBL_COL).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    if (caption) setBasis(ws.getCell(r, META_B), caption);
    em.gap();
  };
  const headNote = (text: string): void => {
    if (!text) return;
    const r = em.cursor();
    setLabel(ws.getCell(r, LBL_COL), text);
    ws.getCell(r, LBL_COL).font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
    em.gap();
  };
  const scalarRow = (label: string, value: number | string | undefined, fmt: string, opts: { basis?: string; input?: boolean; indent?: number } = {}): number => {
    const r = em.cursor();
    setLabel(ws.getCell(r, LBL_COL), label, { indent: opts.indent ?? 1 });
    if (opts.basis) setBasis(ws.getCell(r, META_B), opts.basis);
    if (value !== undefined) put(r, TOTAL_COL, value, typeof value === 'string' ? '@' : fmt, opts.input === true);
    em.gap();
    return r;
  };
  const periodRow = (label: string, axis: readonly number[], window: readonly number[], fmt: string, opts: { basis?: string; input?: boolean; indent?: number; total?: number; bold?: boolean } = {}): number => {
    const r = em.cursor();
    setLabel(ws.getCell(r, LBL_COL), label, { indent: opts.indent ?? 1, bold: opts.bold });
    if (opts.basis) setBasis(ws.getCell(r, META_B), opts.basis);
    for (const t of window) if (t >= 0 && t < N) put(r, pcol(t), axis[t] ?? 0, fmt, opts.input === true);
    if (opts.total !== undefined) put(r, TOTAL_COL, opts.total, fmt, false);
    em.gap();
    return r;
  };
  const colHeaders = (cols: Array<[number, string, 'left' | 'right']>): void => {
    const r = em.cursor();
    for (const [c, text, align] of cols) setColHeader(ws.getCell(r, c), text, align);
    em.gap();
  };
  const cellsRow = (cells: Array<[number, number | string, string, boolean?]>): void => {
    const r = em.cursor();
    for (const [c, v, fmt, input] of cells) {
      if (c === LBL_COL && typeof v === 'string' && !input) { setLabel(ws.getCell(r, c), v, { indent: 1 }); continue; }
      if (c === META_B && typeof v === 'string' && !input) { setBasis(ws.getCell(r, c), v); continue; }
      put(r, c, v, typeof v === 'string' ? '@' : fmt, input === true);
      if (typeof v === 'string') ws.getCell(r, c).alignment = { shrinkToFit: true };
    }
    em.gap();
  };
  // A builder row carries its own number format where m4RowOpts has no kind
  // for it (an indexation factor, an area).
  const emitRows = (rows: readonly (M4Row & { fmt?: string })[]): void => {
    for (const row of rows) {
      if (row.isSection) { em.subTitle(row.label); continue; }
      const o = m4RowOpts(row);
      em.moneyRow(row.label, row.values, { ...o, numFmt: row.fmt ?? o.numFmt });
    }
  };
  // A roll-forward: an opening balance states no Total, a closing balance its
  // last period, a flow its sum, and the check row its stated residue.
  const emitRoll = (rows: readonly M4Row[], numFmt?: string): void => {
    for (const row of rows) {
      const o = m4RowOpts(row);
      const opening = row.totalIsBalance === true && /^Opening/.test(row.label);
      const closing = row.totalIsBalance === true && !opening && row.totalOverride === undefined;
      const isCheck = row.totalOverride !== undefined;
      em.moneyRow(row.label, row.values, {
        ...o,
        indent: row.isTotal || row.isSubtotal ? 0 : 1,
        numFmt: isCheck ? undefined : (numFmt ?? o.numFmt),
        noTotal: opening,
        totalLast: closing,
        totalValue: closing ? undefined : o.totalValue,
      });
    }
  };
  return { ...em, tableTitle, headNote, scalarRow, periodRow, colHeaders, cellsRow, emitRows, emitRoll };
}

/** The Module 2 inflation / indexation setting, as the card's pills read. */
function indexationText(ix: { method?: string; rate?: number; startYear?: number; steps?: Array<{ year: number; factor: number }> } | undefined, startYearDefault: number, projectStartYear: number): string {
  const method = ix?.method ?? 'none';
  if (method === 'none') return 'None';
  const from = projectStartYear + (ix?.startYear ?? startYearDefault);
  if (method === 'yoy_compound') return `YoY Compound, rate ${((ix?.rate ?? 0) * 100).toFixed(2)}%, start year ${from}`;
  if (method === 'single_rate') return `Single rate ${((ix?.rate ?? 0) * 100).toFixed(2)}%, start year ${from}`;
  if (method === 'yoy_per_period') return `Per-Year growth from start year ${from}`;
  if (method === 'step') return `Step, ${(ix?.steps ?? []).length} step${(ix?.steps ?? []).length === 1 ? '' : 's'}`;
  return method;
}

const sqmText = (v: number): string => `${Math.round(Math.max(0, v)).toLocaleString('en-US')} sqm`;
const intText = (v: number): string => Math.round(Math.max(0, v)).toLocaleString('en-US');

function addRevenue(ctx: EmitCtx): { revLinks: RevLinks; cosLinks: CosLinks } {
  const { wb, snap, state } = ctx;
  const N = snap.axisLength;
  const yl = snap.yearLabels;
  const psy = snap.revenue.projectStartYear;
  const cur = ctx.currency;
  const ws = wb.addWorksheet(SHEETS.revenue, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Revenue', 'A mirror of the platform Revenue module, its five sub-tabs in order: 1. Revenue Inputs (one card per line, as the screen shows it), 2. Revenue Output (per line, then the project total), 3. Cost of Sales (the build of the base first), 4. Schedules (the income statement, balance sheet and cash flow feeds), 5. Escrow.', { label: 'Line', feeds: 'Sourced from the Assets tab (sub-units, areas and prices) and the Module 2 line inputs. Feeds the P&L (revenue and cost of sales), the Balance Sheet (inventory, receivables, unearned revenue) and the Cash Flow (collections, escrow).' });
  const em = makeRevOpexEmitters(ws, N);
  const phaseById = new Map(state.phases.map((p) => [p.id, p] as const));
  const lines = planRevenueLines(state.assets, state.subUnits, state.phases, state.project);
  const groups = groupRevenueLines(lines);
  const labelCtx = { parcels: state.parcels, phases: state.phases };
  const lastOf = (x: readonly number[]): number => x[N - 1] ?? 0;
  const range = (from: number, to: number): number[] => (to < from ? [] : Array.from({ length: to - from + 1 }, (_, k) => from + k));

  // THE PHASE WINDOWS a card draws its strips on: the same rule the Module 2
  // Inputs screen and the resolvers apply (handover = last construction year).
  const windowsOf = (line: RevenueLine, phase: Phase): { phaseOffset: number; handoverIdx: number; construction: number[]; operations: number[]; cash: number[]; opsStartIdx: number; defaultOpsStartIdx: number; opsOverride?: number } => {
    const a = line.host;
    const phaseStartYear = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : psy;
    const cp = Math.max(0, phase.constructionPeriods ?? 0);
    const op = Math.max(0, phase.operationsPeriods ?? 0);
    const overlap = Math.max(0, phase.overlapPeriods ?? 0);
    const csi = Math.max(0, Math.min(N - 1, phaseStartYear - psy));
    const handoverIdx = Math.max(csi, Math.min(N - 1, csi + cp - 1));
    const defaultOpsStartIdx = Math.max(csi, Math.min(N - 1, handoverIdx + 1 - overlap));
    const opsOverride = a.strategy === 'Lease' ? a.revenue?.lease?.operationsStartYearOverride : a.revenue?.operate?.operationsStartYearOverride;
    const opsStartIdx = opsOverride != null ? Math.max(csi, Math.min(N - 1, opsOverride - psy)) : defaultOpsStartIdx;
    const opsEndIdx = Math.max(opsStartIdx, Math.min(N - 1, defaultOpsStartIdx + op - 1));
    return {
      phaseOffset: Math.max(0, phaseStartYear - psy), handoverIdx,
      construction: cp > 0 ? range(csi, handoverIdx) : [],
      operations: op > 0 ? range(opsStartIdx, opsEndIdx) : [],
      cash: range(csi, op > 0 ? opsEndIdx : handoverIdx),
      opsStartIdx, defaultOpsStartIdx, opsOverride: opsOverride ?? undefined,
    };
  };
  const span = (w: readonly number[]): string => (w.length ? `${yl[w[0]]} to ${yl[w[w.length - 1]]}` : '');
  const axisFromPhase = (arr: readonly number[] | undefined, offset: number): number[] => {
    const out = new Array<number>(N).fill(0);
    (arr ?? []).forEach((v, i) => { if (offset + i >= 0 && offset + i < N) out[offset + i] = v ?? 0; });
    return out;
  };
  const padded = (arr: readonly number[] | undefined): number[] => Array.from({ length: N }, (_, i) => arr?.[i] ?? 0);
  const plotsOf = (line: RevenueLine): string => (line.isStrip || line.isOperateCompanion)
    ? '' : line.members.map((m) => assetPlotLabel(m, labelCtx)).filter((x): x is string => !!x).join(' + ');

  // ── 1. Revenue Inputs ────────────────────────────────────────────────────────
  em.section('1. Revenue Inputs (one card per line, filed by section: sub-units, pace, prices, terms and recognition)');
  {
    const dp = state.project.saleCohortDefaults?.downpayment;
    em.scalarRow('Project default downpayment', dp === undefined ? 'not set' : dp, NUMFMT.pct, {
      input: dp !== undefined, indent: 0,
      basis: 'Stands in for a Sell line with no downpayment of its own. Not set is not the same as zero.',
    });
    em.gap();
  }
  for (const g of groups) {
    em.groupBand(`${g.section}: ${REVENUE_SECTION_META[g.section]}`);
    for (const line of g.lines) {
      const phase = phaseById.get(line.phaseId);
      if (!phase) continue;
      const a = line.host;
      const memberById = new Map(line.members.map((m) => [m.id, m] as const));
      const ownerOf = (u: SubUnit): Asset | undefined => memberById.get(u.assetId) ?? a;
      const w = windowsOf(line, phase);
      const parent = line.isOperateCompanion && line.parentLineKey ? lines.find((l) => l.key === line.parentLineKey) : undefined;
      em.subTitle(revenueLineName(line));
      {
        const units = line.subUnits;
        const count = units.filter((u) => resolveSubUnitMetric(u, ownerOf(u)) === 'units').reduce((s, u) => s + Math.max(0, u.metricValue), 0);
        const area = units.reduce((s, u) => s + computeSubUnitArea(u, ownerOf(u)), 0);
        const summary = units.length === 0 ? 'No sub-units yet' : [count > 0 ? `${intText(count)} units` : '', area > 0 ? sqmText(area) : ''].filter(Boolean).join(', ') || 'No measurements';
        const plots = plotsOf(line);
        setBasis(ws.getCell(em.cursor() - 1, META_B), [line.strategy, phase.name, plots, summary].filter(Boolean).join(', ')
          + (parent ? `. Manage / Operate, linked to ${revenueLineName(parent)} (Sell side in ${parent.section})` : ''));
      }

      // Sub-units (from Module 1 Table 5), priced as the strategy reads them.
      if (line.subUnits.length > 0) {
        const form = line.form;
        const typeValues = a.assetTypeId ? state.project.assetTypeValues?.[a.assetTypeId] : undefined;
        const unitSize = resolveAvgUnitSize(line.subUnits.map((u) => u.unitArea), typeValues).value;
        if (form === 'sell') em.colHeaders([[LBL_COL, 'Sub-unit (from Module 1)', 'left'], [META_B, 'Quantity', 'left'], [TOTAL_COL, `Price per sqm`, 'right'], [OPEN_COL, 'Price per unit', 'right']]);
        else if (form === 'operate') em.colHeaders([[LBL_COL, 'Sub-unit (from Module 1)', 'left'], [META_B, 'Keys', 'left'], [TOTAL_COL, 'ADR, per room night', 'right']]);
        else em.colHeaders([[LBL_COL, 'Sub-unit (from Module 1)', 'left'], [META_B, 'Gross lease area', 'left'], [TOTAL_COL, 'Rent, per sqm per year', 'right']]);
        for (const su of line.subUnits) {
          const owner = ownerOf(su);
          const metric = resolveSubUnitMetric(su, owner);
          const suArea = computeSubUnitArea(su, owner);
          const share = typeof su.nsaSharePct === 'number' && Number.isFinite(su.nsaSharePct) ? ` (${Math.round(su.nsaSharePct * 100) / 100}% of line NSA)` : '';
          if (form === 'sell') {
            const active = priceKeyFor(su.category, metric);
            const priceOf = (k: 'pricePerSqm' | 'pricePerUnit'): number => (k === active ? Math.max(0, su.unitPrice ?? 0) : Math.max(0, su[k] ?? 0));
            const size = metric === 'units' ? `${intText(su.metricValue)} units, ${sqmText(suArea)}${share}` : `${sqmText(suArea)}${share}`;
            em.cellsRow([
              [LBL_COL, su.name || 'sub-unit', '@'],
              [META_B, `${size}; sells per ${active === 'pricePerUnit' ? 'unit' : 'sqm'}`, '@'],
              [TOTAL_COL, priceOf('pricePerSqm'), NUMFMT.rate, true],
              ...(hasDualPrice(su) ? [[OPEN_COL, priceOf('pricePerUnit'), NUMFMT.rate, true] as [number, number, string, boolean]] : []),
            ]);
          } else if (form === 'operate') {
            // THE RESOLVED ADR, by the one rule the engine applies: the row's
            // own ADR where positive, else the line's stored starting ADR.
            const adr = resolveSubUnitAdr(su) > 0 ? resolveSubUnitAdr(su) : (a.revenue?.operate?.startingADR ?? 0);
            const keys = metric === 'units' ? Math.max(0, Math.round(su.metricValue)) : keysFromArea(suArea, unitSize);
            em.cellsRow([[LBL_COL, su.name || 'sub-unit', '@'], [META_B, `${intText(keys)} keys, ${sqmText(suArea)}${share}`, '@'], [TOTAL_COL, adr, NUMFMT.rate, true]]);
          } else {
            // THE RESOLVED RENT: the row's price where positive, else the line's base rate.
            const rent = (su.unitPrice ?? 0) > 0 ? su.unitPrice : (a.revenue?.lease?.baseRate ?? 0);
            em.cellsRow([[LBL_COL, su.name || 'sub-unit', '@'], [META_B, `${sqmText(suArea)}${share}`, '@'], [TOTAL_COL, rent, NUMFMT.rate, true]]);
          }
        }
      }

      if (line.form === 'sell') {
        const sell = a.revenue?.sell;
        if (line.subUnits.length === 0) { em.headNote('Add sub-units on the Assets tab to enter sales velocity here.'); em.gap(); continue; }
        // THE PACE, read the way the engine reads each row: its own entry, else
        // the line default, else nothing.
        const split = sell !== undefined && sell.velocityDefault === undefined && (sell.subUnits?.length ?? 0) > 0;
        const axisOf = (suId: string, kind: 'pre' | 'post'): { axis: number[]; source: string } => {
          const v = resolveRowVelocity(sell, suId);
          const byPhase = kind === 'pre' ? v.pre : v.post;
          const legacy = kind === 'pre' ? v.preLegacy : v.postLegacy;
          return { axis: byPhase !== undefined ? axisFromPhase(byPhase, w.phaseOffset) : padded(legacy), source: v.source };
        };
        const paceRows = (kind: 'pre' | 'post', window: number[]): void => {
          const sumOver = (axis: number[]): number => window.reduce((s, t) => s + (axis[t] ?? 0), 0);
          if (split || line.subUnits.length === 1) {
            for (const su of line.subUnits) {
              const { axis, source } = axisOf(su.id, kind);
              em.periodRow(su.name || 'sub-unit', axis, window, NUMFMT.pct, {
                input: true, total: sumOver(axis),
                basis: `${su.category}${source === 'default' ? ', at the line pace' : source === 'none' ? ', NO VELOCITY: sells nothing until one is typed' : ''}`,
              });
            }
          } else {
            const dflt = sell?.velocityDefault;
            const axis = dflt ? axisFromPhase(kind === 'pre' ? dflt.preSalesVelocityByPhase : dflt.postSalesVelocityByPhase, w.phaseOffset) : axisOf(line.subUnits[0].id, kind).axis;
            em.periodRow('All sub-units', axis, window, NUMFMT.pct, { input: true, total: sumOver(axis), basis: `Lockstep across every sub-unit (${line.subUnits.length})` });
          }
        };
        if (w.construction.length > 0) {
          em.tableTitle(`Pre-Sales velocity, Construction ${span(w.construction)}`, 'Pre-sales run during construction; the handover year is the last construction year.');
          paceRows('pre', w.construction);
        }
        if (w.operations.length > 0) {
          em.tableTitle(`Sales During Operation, ${span(w.operations)}`, 'Sales during operation apply to units left after pre-sales, collected and recognised in the same year.');
          paceRows('post', w.operations);
        }
        const idx = sell?.indexation ?? { method: 'none' as const };
        em.tableTitle('Price Indexation', indexationText(idx, 0, psy));
        const idxAxis = expandIndexationToAxis(idx, sell?.indexation?.growthPerPeriodByPhase, w.phaseOffset, N);
        if (idx.method === 'step') {
          (idx.steps ?? []).forEach((st, i) => em.scalarRow(`Step ${i + 1}, from ${psy + st.year}`, st.factor, FACTOR_FMT, { input: true, basis: `Uplift ${((Math.max(1, st.factor) - 1) * 100).toFixed(2)}%` }));
        } else if (idx.method === 'yoy_per_period') {
          em.periodRow('YoY growth', padded(idxAxis.growthPerPeriod), w.cash, NUMFMT.pct, { input: true });
        }
        if (w.cash.length > 0) {
          em.tableTitle('Sale price per year, after indexation', 'Base price per sub-unit (Table 5) x the indexation factor at each year: the rate the engine multiplies the sold area or units by.');
          em.periodRow('Indexation factor', Array.from({ length: N }, (_, t) => applyIndexation(1, t, idxAxis)), w.cash, FACTOR_FMT);
          for (const su of line.subUnits) {
            const perUnit = resolveSubUnitMetric(su, ownerOf(su)) === 'units';
            const base = Math.max(0, su.unitPrice ?? 0);
            em.periodRow(`${su.name || 'sub-unit'} (${cur} ${base.toLocaleString('en-US', { maximumFractionDigits: 2 })} / ${perUnit ? 'unit' : 'sqm'})`,
              Array.from({ length: N }, (_, t) => (base > 0 ? applyIndexation(base, t, idxAxis) : 0)), w.cash, NUMFMT.rate,
              { basis: base > 0 ? '' : 'no price on Table 5' });
          }
        }
        const rec = sell?.recognitionProfile;
        if (rec?.method === 'over_time') {
          em.tableTitle('Revenue Recognition', 'Over-Time: percent of each cohort recognised per project year.');
          const pcts = padded(rec.percentages);
          em.periodRow('Recognition %', pcts, w.cash, NUMFMT.pct, { input: true, total: w.cash.reduce((s, t) => s + (pcts[t] ?? 0), 0) });
        } else {
          const anchor = rec?.pointInTimeYear ?? 'handover';
          em.tableTitle('Revenue Recognition', anchor === 'handover'
            ? `Point-in-Time, at handover (${yl[w.handoverIdx]}): every pre-sales cohort recognises in full at handover; sales during operation recognise in their own sale year.`
            : anchor === 'sale_year' ? 'Point-in-Time, at sale year: each cohort recognises in full in the year it is sold.'
              : `Point-in-Time, at custom year ${rec?.pointInTimeCustomYear ?? yl[w.handoverIdx]}: every pre-sales cohort recognises in full in that year.`);
        }
        // SALE COHORT TERMS, whatever the recognition method: they drive
        // collections, not recognition, so handover recognition hides nothing.
        const block = buildSaleCohortTermsBlock(a, phase, psy);
        if (block) {
          em.tableTitle('Sale cohort terms', 'Drives collections: a downpayment in the year a cohort sells, then the balance in equal instalments.');
          em.scalarRow('Max instalment years after sale', block.instalmentYears, NUMFMT.int, { input: true });
          em.scalarRow('Instalments', block.stopAtHandover ? `Must finish by handover (${block.handoverYear})` : 'May run past handover', '@', { input: true });
          const projectDefault = state.project.saleCohortDefaults?.downpayment;
          const source = resolveAssetDownpaymentSource(sell?.downpaymentByPhase, projectDefault);
          const dpAxis = new Array<number>(N).fill(0);
          for (const t of w.construction) dpAxis[t] = resolveCohortDownpayment(sell?.downpaymentByPhase, projectDefault, t - w.phaseOffset).value;
          em.periodRow('Downpayment %', dpAxis, w.construction, NUMFMT.pct, { input: true, basis: 'by sale year, % of that year\'s own sale value' });
          em.headNote(`A cohort selling in year N pays its downpayment in year N and the balance in equal instalments over ${block.stopAtHandover
            ? `the lesser of ${block.instalmentYears} years and the years remaining to handover (${block.handoverYear})`
            : `${block.instalmentYears} years, even where that runs past handover`}; a cohort selling at or after handover pays in full in its own year. ${source.reason}`);
        }
        em.gap();
        continue;
      }

      if (line.form === 'operate') {
        const cfg = a.revenue?.operate;
        const typeValues = a.assetTypeId ? state.project.assetTypeValues?.[a.assetTypeId] : undefined;
        const keys = line.members.reduce((s, m) => s + resolveAssetKeys(m, state.subUnits, typeValues).keys, 0);
        em.scalarRow('Keys the engine counts', keys, NUMFMT.int, { indent: 0 });
        if (!cfg) { em.headNote('No operate config yet.'); em.gap(); continue; }
        if (w.operations.length === 0) { em.headNote('Phase has no operations periods. Set them on Project & Phases.'); em.gap(); continue; }
        const resolved = resolveHospitalityConfig(a, phase, state.subUnits, psy, N, typeValues);
        const ops = w.operations;
        em.tableTitle(`ADR Indexation, Operations ${span(ops)}`, indexationText(cfg.adrIndexation, w.opsStartIdx, psy));
        if (cfg.adrIndexation?.method === 'yoy_per_period') em.periodRow('YoY growth', padded(resolved?.adrIndexation.growthPerPeriod), ops, NUMFMT.pct, { input: true });
        em.scalarRow('Operations start year', psy + w.opsStartIdx, NUMFMT.year, { input: true, indent: 0, basis: `Default (after handover): ${psy + w.defaultOpsStartIdx}` });
        const occ = padded(resolved?.occupancyPerPeriod);
        const occVisible = ops.map((t) => occ[t] ?? 0);
        em.periodRow('Occupancy ramp', occ, ops, NUMFMT.pct, { input: true, indent: 0, total: occVisible.length ? occVisible.reduce((s, v) => s + v, 0) / occVisible.length : 0, basis: `Occupied room nights = keys x 365 x occupancy; peak ${(Math.max(0, ...occVisible) * 100).toFixed(0)}%; Total column = average` });
        em.scalarRow('Average guests per occupied room night', cfg.guestsPerOccupiedRoom ?? 1.5, DEC2_FMT, { input: true, indent: 0 });
        const ancillary = (title: string, pctLabel: string, anc: { mode?: string } | undefined, res: { percentOfRooms?: number | number[]; ratePerGuest?: number | number[]; fixedAmountPerPeriod?: number | number[] } | undefined): void => {
          const mode = anc?.mode ?? 'percent_of_rooms';
          const modeLabel = mode === 'percent_of_rooms' ? '% of Rooms' : mode === 'per_guest' ? 'Per Guest' : 'Baseline + Growth';
          const raw = mode === 'percent_of_rooms' ? res?.percentOfRooms : mode === 'per_guest' ? res?.ratePerGuest : res?.fixedAmountPerPeriod;
          const fmt = mode === 'percent_of_rooms' ? NUMFMT.pct : mode === 'per_guest' ? NUMFMT.rate : NUMFMT.money;
          const label = mode === 'percent_of_rooms' ? pctLabel : mode === 'per_guest' ? `Rate per guest (${cur})` : `Baseline amount (${cur})`;
          if (Array.isArray(raw)) em.periodRow(`${title}, ${label}`, padded(raw), ops, fmt, { input: true, indent: 0, basis: modeLabel });
          else em.scalarRow(`${title}, ${label}`, Math.max(0, raw ?? 0), fmt, { input: true, indent: 0, basis: modeLabel });
        };
        ancillary('F&B Revenue', 'F&B %', cfg.fb, resolved?.fb);
        ancillary('Other Revenue', 'Other %', cfg.otherRevenue, resolved?.otherRevenue);
        if (a.isCompanion === true && resolved?.keysParticipationPerPeriod) {
          em.periodRow('Rental pool enrollment (Sell + Manage)', padded(resolved.keysParticipationPerPeriod), ops, NUMFMT.pct, { input: true, indent: 0, basis: 'Effective keys = total keys x pool %' });
        }
        em.scalarRow('Accounts Receivable Days', cfg.dso ?? 30, NUMFMT.int, { input: true, indent: 0, basis: 'days; drives the receivable on Schedules' });
        em.gap();
        continue;
      }

      // Lease
      const cfg = a.revenue?.lease;
      if (!cfg) { em.headNote('No lease config yet.'); em.gap(); continue; }
      if (w.operations.length === 0) { em.headNote('Phase has no operations periods. Set them on Project & Phases.'); em.gap(); continue; }
      const resolved = resolveLeaseConfig(a, phase, state.subUnits, psy, N);
      const ops = w.operations;
      em.tableTitle(`Rent Indexation, Operations ${span(ops)}`, indexationText(cfg.rentIndexation, w.opsStartIdx, psy));
      if (cfg.rentIndexation?.method === 'yoy_per_period') em.periodRow('YoY growth', padded(resolved?.rentIndexation.growthPerPeriod), ops, NUMFMT.pct, { input: true });
      em.scalarRow('Operations start year', psy + w.opsStartIdx, NUMFMT.year, { input: true, indent: 0, basis: `Default (after handover): ${psy + w.defaultOpsStartIdx}` });
      const occ = padded(resolved?.occupancyPerPeriod);
      const occVisible = ops.map((t) => occ[t] ?? 0);
      em.periodRow('Occupancy ramp', occ, ops, NUMFMT.pct, { input: true, indent: 0, total: occVisible.length ? occVisible.reduce((s, v) => s + v, 0) / occVisible.length : 0, basis: `Occupied lease area = GLA x occupancy; peak ${(Math.max(0, ...occVisible) * 100).toFixed(0)}%; Total column = average` });
      em.scalarRow('Accounts Receivable Days', cfg.arDays ?? 30, NUMFMT.int, { input: true, indent: 0, basis: 'AR days' });
      em.gap();
    }
  }

  // ── 2. Revenue Output ────────────────────────────────────────────────────────
  em.section('2. Revenue Output (per line, filed by section and phase, then the project total)');
  const lineResults = new Map(lines.map((l) => [l.key, lineRevenueResults(l.members.map((m) => m.id), snap.revenue, l.key)] as const));
  const lineMeta = (l: RevenueLine): string => l.isStrip ? 'ground-floor retail strip carved from its hosts'
    : l.isOperateCompanion ? 'Operate companion' : plotsOf(l);
  for (const g of groups) {
    em.groupBand(g.section);
    for (const p of state.phases) {
      const phaseLines = g.lines.filter((l) => l.phaseId === p.id);
      if (phaseLines.length === 0) continue;
      const pw = windowsOf(phaseLines[0], p);
      em.tableTitle(p.name, `${p.status ?? 'planning'}, handover ${yl[pw.handoverIdx] ?? '?'}, ${phaseLines.length} line${phaseLines.length === 1 ? '' : 's'}`);
      for (const line of phaseLines) {
        const a = line.host;
        const res = lineResults.get(line.key);
        const memberById = new Map(line.members.map((m) => [m.id, m] as const));
        const ownerOf = (u: SubUnit): Asset | undefined => memberById.get(u.assetId) ?? a;
        const w = windowsOf(line, p);
        const lineHead = (): void => { em.subTitle(revenueLineName(line)); const meta = lineMeta(line); if (meta) setBasis(ws.getCell(em.cursor() - 1, META_B), meta); };

        if (line.form === 'sell') {
          const r = res?.sell;
          if (!r) {
            if (a.strategy === 'Sell + Manage') { lineHead(); em.headNote('No Sell-side revenue config yet.'); em.gap(); }
            continue;
          }
          lineHead();
          const units = line.subUnits;
          const areaPerSU = units.map((su) => computeSubUnitArea(su, ownerOf(su)));
          const metrics = units.map((su) => resolveSubUnitMetric(su, ownerOf(su)));
          const useUnits = metrics.length > 0 && metrics.every((m) => m === metrics[0]) && metrics[0] === 'units';
          const countPerSU = units.map((su, i) => (metrics[i] === 'units' ? Math.max(0, su.metricValue) : 0));
          const invLabel = useUnits ? 'Units' : 'SQM';
          const invLower = useUnits ? 'units' : 'sqm';
          const preSU = useUnits ? r.presalesUnitsPerPeriodPerSubUnit : r.presalesAreaPerPeriodPerSubUnit;
          const postSU = useUnits ? r.postSalesUnitsPerPeriodPerSubUnit : r.postSalesAreaPerPeriodPerSubUnit;
          const preTot = useUnits ? r.presalesUnitsPerPeriod : r.presalesAreaPerPeriod;
          const postTot = useUnits ? r.postSalesUnitsPerPeriod : r.postSalesAreaPerPeriod;
          const denomPerSU = useUnits ? countPerSU : areaPerSU;
          const denom = denomPerSU.reduce((s, v) => s + v, 0);
          const cfg = resolveSellConfig(a, state.project);
          const idxAxis = expandIndexationToAxis(cfg?.indexation, a.revenue?.sell?.indexation?.growthPerPeriodByPhase, w.phaseOffset, N);
          em.tableTitle('1a. Share of inventory sold per year (per sub-unit)', `Sold over total inventory per row and year, after the cap at what was still unsold and rounding to whole ${invLower}; the Total column is the lifetime share sold.`);
          em.emitRows(buildShareSoldRows(units, denomPerSU, preSU, postSU, denom, N));
          em.tableTitle(`1b. ${invLabel} Sold (per sub-unit, pre-sales and sales during operation)`, `Sold = velocity x sub-unit inventory, capped at what is still unsold; whole ${invLower} per step and the exact remainder on the last.`);
          em.emitRows(buildPrePostRows(units, preSU, postSU, preTot, postTot, N, { preLabel: `Total pre-sales ${invLower}`, postLabel: `Total sales during operation ${invLower}`, grandLabel: `Asset Total ${invLabel} Sold` }, 'count'));
          {
            const t = buildInventoryRollForward(denom, preTot.map((v, i) => v + (postTot[i] ?? 0)), N, invLower);
            em.tableTitle(`1c. Closing Inventory (unsold ${invLower})`, t.caption);
            em.emitRoll(t.rows, NUMFMT.int);
          }
          em.tableTitle('2a. Sale price per year, after indexation (per sub-unit)', 'Price = base price (Table 5) x the indexation factor at each year; units sold x price = revenue. Rates at full scale; a price does not sum.');
          em.periodRow('Indexation factor', Array.from({ length: N }, (_, t) => applyIndexation(1, t, idxAxis)), range(0, N - 1), FACTOR_FMT);
          for (const su of units) {
            const perUnit = resolveSubUnitMetric(su, ownerOf(su)) === 'units';
            const base = Math.max(0, su.unitPrice ?? 0);
            em.periodRow(`${su.name || 'sub-unit'} (${cur} ${base.toLocaleString('en-US', { maximumFractionDigits: 2 })} / ${perUnit ? 'unit' : 'sqm'})`,
              Array.from({ length: N }, (_, t) => (base > 0 ? applyIndexation(base, t, idxAxis) : 0)), range(0, N - 1), NUMFMT.rate);
          }
          em.tableTitle('2b. Revenue (per sub-unit, pre-sales and sales during operation)', `Revenue = ${invLabel.toLowerCase()} sold x base rate x indexation factor at the year.`);
          em.emitRows(buildPrePostRows(units, r.presalesRevenuePerPeriodPerSubUnit, r.postSalesRevenuePerPeriodPerSubUnit, r.presalesRevenuePerPeriod, r.postSalesRevenuePerPeriod, N, { preLabel: 'Total pre-sales revenue', postLabel: 'Total sales during operation revenue', grandLabel: 'Asset Total Revenue' }));
          {
            const m = r.recognitionVintageMatrix;
            const active = range(0, N - 1).filter((i) => (m[i] ?? []).reduce((s, v) => s + (v ?? 0), 0) > 0.5);
            em.tableTitle('3a. Pre-Sales Recognition Vintage Matrix', `Rows = cohort sale year, columns = year recognised; handover resolves to ${yl[w.handoverIdx] ?? '?'}. Row sum = cohort sales value; column sum = recognition per year.`);
            for (const i of active) em.moneyRow(`Sold in ${yl[i]}`, (m[i] ?? []).slice(0, N), { indent: 1 });
            const totals = new Array<number>(N).fill(0);
            for (const row of m) for (let t = 0; t < N; t++) totals[t] += row?.[t] ?? 0;
            em.moneyRow('Year Total', totals, { style: 'total' });
          }
          em.tableTitle('3b. Recognition Summary (per period)', 'Pre-Sales Recognised = column sum of 3a; Sales During Operation recognise in the same period; Total = P&L revenue per year.');
          em.emitRows([
            { label: 'Pre-Sales Recognised', values: r.presalesRecognitionPerPeriod },
            { label: 'Sales During Operation Recognised', values: r.postSalesRecognitionPerPeriod },
            { label: 'Total Revenue Recognised', values: r.recognitionPerPeriod, isTotal: true },
          ]);
          // 4a. THE SALE COHORT GRID, from the shared builder the screen and both
          // PDFs render; the plain cash vintage matrix only where it has nothing.
          const grid = buildSaleCohortGrid(a, p, psy, yl, state.project.saleCohortDefaults?.downpayment, r);
          if (grid && grid.rows.length) {
            em.tableTitle('4a. Sale Cohort Grid (pre-sales cash)', saleCohortGridCaption(grid));
            for (const cr of grid.rows) {
              em.moneyRow(cr.paysInFull ? `${cr.saleYear} sale, paid in full` : `${cr.saleYear} sale, ${(cr.downpayment * 100).toFixed(2)}% down`, cr.cells.slice(0, N), { indent: 1 });
            }
            em.moneyRow('Total collected', grid.columnTotals.slice(0, N), { style: 'total' });
            em.colHeaders([[1, 'Sale year', 'left'], [2, 'Down %', 'right'], [3, 'In force from', 'left'], [4, 'Sale value', 'right'], [5, 'Collected', 'right'], [6, 'Check', 'right']]);
            for (const cr of grid.rows) {
              const row = em.cursor();
              setLabel(ws.getCell(row, 1), String(cr.saleYear));
              const dp = ws.getCell(row, 2); dp.value = cr.paysInFull ? 1 : cr.downpayment; dp.numFmt = NUMFMT.pct;
              setLabel(ws.getCell(row, 3), cr.paysInFull ? 'not used' : cr.downpaymentSource.replace('_', ' '));
              const gv = ws.getCell(row, 4); gv.value = cr.gdv; gv.numFmt = NUMFMT.money;
              const cv = ws.getCell(row, 5); cv.value = cr.rowTotal; cv.numFmt = NUMFMT.money;
              const ck = ws.getCell(row, 6); ck.value = cr.checkResidue; ck.numFmt = NUMFMT.money;
              ck.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: cr.ok ? ARGB.good : ARGB.bad } };
              em.gap();
            }
          } else {
            const m = r.cashVintageMatrix;
            em.tableTitle('4a. Pre-Sales Cash Vintage Matrix', 'Rows are sale years, columns the years that cohort pays.');
            for (const i of range(0, N - 1).filter((k) => (m[k] ?? []).reduce((s, v) => s + (v ?? 0), 0) > 0.5)) em.moneyRow(`Sold in ${yl[i]}`, (m[i] ?? []).slice(0, N), { indent: 1 });
            const totals = new Array<number>(N).fill(0);
            for (const row of m) for (let t = 0; t < N; t++) totals[t] += row?.[t] ?? 0;
            em.moneyRow('Year Total', totals, { style: 'total' });
          }
          em.tableTitle('4b. Cash Summary (per period)', 'Pre-Sales Cash = column sum of 4a; Sales During Operation are collected in the same period; Total = cash from revenue per year.');
          em.emitRows([
            { label: 'Pre-Sales Cash', values: r.presalesCashPerPeriod },
            { label: 'Sales During Operation Cash', values: r.postSalesCashPerPeriod },
            { label: 'Total Cash Collected', values: r.cashCollectedPerPeriod, isTotal: true },
          ]);
          {
            const ar = buildAccountsReceivable(r.presalesRevenuePerPeriod, r.presalesCashPerPeriod, N);
            const ur = buildUnearnedRevenue(r.presalesRecognitionPerPeriod, r.presalesRevenuePerPeriod, N);
            const arRoll = buildReceivablesRollForward(ar, r.presalesRevenuePerPeriod, r.presalesCashPerPeriod, N, ar.changePerPeriod);
            const unRoll = buildUnearnedRollForward(ur, r.presalesRevenuePerPeriod, r.presalesRecognitionPerPeriod, N, ur.changePerPeriod);
            em.tableTitle('5. Accounts Receivable (Sales Receivable roll-forward)', arRoll.caption);
            em.emitRoll(arRoll.rows);
            em.tableTitle('6. Unearned Revenue (Contract Liability roll-forward)', unRoll.caption);
            em.emitRoll(unRoll.rows);
          }
          em.gap();
          continue;
        }

        if (line.form === 'operate') {
          const r = res?.hospitality;
          lineHead();
          if (!r) { em.headNote('No operate config yet.'); em.gap(); continue; }
          const opCfg = a.revenue?.operate;
          const keys = Object.values(r.perSubUnit ?? {}).reduce((s, su) => s + Math.max(0, su.keys), 0);
          const days = opCfg?.daysPerYear ?? 365;
          const guests = opCfg?.guestsPerOccupiedRoom ?? 1.5;
          const fbMode = opCfg?.fb?.mode ?? 'percent_of_rooms';
          const otherMode = opCfg?.otherRevenue?.mode ?? 'percent_of_rooms';
          const opsMask = r.availableRoomNightsPerPeriod.map((arn) => (arn > 0 ? 1 : 0));
          const broadcast = (v: number): number[] => r.availableRoomNightsPerPeriod.slice(0, N).map((arn) => (arn > 0 ? v : 0));
          const arr = (raw: number | number[] | undefined): number[] => Array.from({ length: N }, (_, i) => (Array.isArray(raw) ? Math.max(0, raw[i] ?? 0) : Math.max(0, raw ?? 0)) * (opsMask[i] ?? 0));
          const scalar = (raw: number | number[] | undefined): number | undefined => (Array.isArray(raw) ? undefined : Math.max(0, raw ?? 0));
          const lastPos = (x: readonly number[]): number => { for (let i = x.length - 1; i >= 0; i--) if (x[i] > 0) return x[i]; return 0; };
          const occNZ = r.occupancyPerPeriod.filter((v) => v > 0);
          const occAvg = occNZ.length ? occNZ.reduce((s, v) => s + v, 0) / occNZ.length : 0;
          const keyed = line.subUnits.filter((u) => (r.perSubUnit?.[u.id]?.keys ?? 0) > 0);
          const perSu = keyed.length > 1;
          const rows: Array<M4Row & { fmt?: string }> = [
            { label: 'Drivers', values: [], isSection: true },
            { label: 'Total Rooms (Keys)', values: broadcast(keys), valueKind: 'count', totalValue: keys, indent: 1 },
            { label: 'Days per Year', values: broadcast(days), valueKind: 'count', totalValue: days, indent: 1 },
            ...((a.isCompanion === true && opCfg?.keysParticipationProfile && opCfg.keysParticipationProfile.length > 0) ? [
              { label: 'Rental Pool Participation %', values: r.keysParticipationPerPeriod, isPercent: true, totalValue: lastOf(r.keysParticipationPerPeriod), indent: 1 },
              { label: 'Effective Rental Pool Keys (Total Keys x Pool %)', values: r.effectiveKeysPerPeriod, valueKind: 'count' as const, totalValue: lastOf(r.effectiveKeysPerPeriod), indent: 1 },
            ] : []),
            { label: 'Occupancy %', values: r.occupancyPerPeriod, isPercent: true, totalValue: occAvg, indent: 1 },
            { label: 'ADR Indexation Factor', values: r.adrIndexationFactorPerPeriod, fmt: FACTOR_FMT, totalValue: lastPos(r.adrIndexationFactorPerPeriod), indent: 1 },
            { label: perSu ? `ADR (keys-weighted avg, ${cur} per occupied room night)` : `ADR (${cur} per occupied room night)`, values: r.adrPerPeriod, valueKind: 'rate', totalValue: lastPos(r.adrPerPeriod), indent: 1 },
            ...(perSu ? keyed.map((u) => ({ label: `${u.name} ADR (${intText(r.perSubUnit[u.id].keys)} keys)`, values: r.perSubUnit[u.id].adrPerPeriod, valueKind: 'rate' as const, totalValue: lastPos(r.perSubUnit[u.id].adrPerPeriod), indent: 2 })) : []),
            ...((fbMode === 'per_guest' || otherMode === 'per_guest') ? [{ label: 'Guests per Occupied Room', values: broadcast(guests), fmt: DEC2_FMT, totalValue: guests, indent: 1 }] : []),
            ...(fbMode === 'percent_of_rooms' ? [{ label: 'F&B % of Rooms Revenue', values: arr(opCfg?.fb?.percentOfRooms), isPercent: true, totalValue: scalar(opCfg?.fb?.percentOfRooms), indent: 1 }] : []),
            ...(fbMode === 'per_guest' ? [{ label: `F&B Rate per Guest (${cur})`, values: arr(opCfg?.fb?.ratePerGuest), valueKind: 'rate' as const, totalValue: scalar(opCfg?.fb?.ratePerGuest), indent: 1 }] : []),
            ...(fbMode === 'fixed_amount' ? [{ label: `F&B Fixed Amount per Year (${cur})`, values: arr(opCfg?.fb?.fixedAmountPerPeriod), indent: 1 }] : []),
            ...(otherMode === 'percent_of_rooms' ? [{ label: 'Other % of Rooms Revenue', values: arr(opCfg?.otherRevenue?.percentOfRooms), isPercent: true, totalValue: scalar(opCfg?.otherRevenue?.percentOfRooms), indent: 1 }] : []),
            ...(otherMode === 'per_guest' ? [{ label: `Other Rate per Guest (${cur})`, values: arr(opCfg?.otherRevenue?.ratePerGuest), valueKind: 'rate' as const, totalValue: scalar(opCfg?.otherRevenue?.ratePerGuest), indent: 1 }] : []),
            ...(otherMode === 'fixed_amount' ? [{ label: `Other Fixed Amount per Year (${cur})`, values: arr(opCfg?.otherRevenue?.fixedAmountPerPeriod), indent: 1 }] : []),
            { label: 'Calculations', values: [], isSection: true },
            ...(perSu ? keyed.map((u) => ({ label: `${u.name} ARN (${intText(r.perSubUnit[u.id].keys)} keys x Days)`, values: r.perSubUnit[u.id].availableRoomNightsPerPeriod, valueKind: 'count' as const, indent: 2 })) : []),
            { label: perSu ? 'Total Available Room Nights' : 'Available Room Nights', values: r.availableRoomNightsPerPeriod, valueKind: 'count', isSubtotal: perSu, indent: 1 },
            ...(perSu ? keyed.map((u) => ({ label: `${u.name} ORN (ARN x Occupancy)`, values: r.perSubUnit[u.id].occupiedRoomNightsPerPeriod, valueKind: 'count' as const, indent: 2 })) : []),
            { label: perSu ? 'Total Occupied Room Nights' : 'Occupied Room Nights', values: r.occupiedRoomNightsPerPeriod, valueKind: 'count', isSubtotal: perSu, indent: 1 },
            { label: `Guests per Year (x ${guests.toFixed(2)} guests / ORN)`, values: r.guestsPerPeriod, valueKind: 'count', isSubtotal: true, indent: 1 },
          ];
          em.tableTitle('1. Drivers + Calculations', 'Available Room Nights = Keys x Days/Year; Occupied Room Nights = ARN x Occupancy; Guests = ORN x Guests/Room.');
          em.emitRows(rows);
          em.tableTitle('2. Rooms + F&B + Other + Total Hospitality Revenue', 'Rooms = ORN x ADR (per sub-unit, then summed); F&B and Other follow their mode. Recognition = cash = revenue in the same period.');
          em.emitRows([
            ...(perSu ? keyed.map((u) => ({ label: `${u.name} Rooms Revenue`, values: r.perSubUnit[u.id].roomsRevenuePerPeriod, indent: 1 })) : []),
            { label: perSu ? 'Total Rooms Revenue' : 'Rooms Revenue', values: r.roomsRevenuePerPeriod, isSubtotal: perSu },
            { label: 'F&B Revenue', values: r.fbRevenuePerPeriod },
            { label: 'Other Revenue', values: r.otherRevenuePerPeriod },
            { label: 'Total Hospitality Revenue', values: r.totalRevenuePerPeriod, isTotal: true },
          ]);
          em.gap();
          continue;
        }

        // Lease
        const r = res?.lease;
        lineHead();
        if (!r) { em.headNote('No lease config yet.'); em.gap(); continue; }
        const gla = line.subUnits.reduce((s, u) => s + Math.max(0, computeSubUnitArea(u, ownerOf(u))), 0);
        const lastPos = (x: readonly number[]): number => { for (let i = x.length - 1; i >= 0; i--) if (x[i] > 0) return x[i]; return 0; };
        const occNZ = r.occupancyPerPeriod.filter((v) => v > 0);
        const zones = line.subUnits.filter((u) => r.perSubUnit?.[u.id]);
        em.tableTitle('1. Drivers + Calculations', 'Occupied Lease Area = GLA x Occupancy; Indexed Rate = Base Rate x Rent Indexation Factor; Revenue = Occupied Area x Indexed Rate.');
        em.emitRows([
          { label: 'Drivers', values: [], isSection: true },
          { label: 'Total Gross Lease Area (sqm)', values: r.occupiedAreaPerPeriod.slice(0, N).map((v) => (v > 0 ? gla : 0)), valueKind: 'count', totalValue: gla, indent: 1 },
          { label: 'Occupancy %', values: r.occupancyPerPeriod, isPercent: true, totalValue: occNZ.length ? occNZ.reduce((s, v) => s + v, 0) / occNZ.length : 0, indent: 1 },
          { label: 'Rent Indexation Factor', values: r.rentIndexationFactorPerPeriod, fmt: FACTOR_FMT, totalValue: lastPos(r.rentIndexationFactorPerPeriod), indent: 1 },
          { label: line.subUnits.length > 1 ? `Indexed Rate (GLA-weighted avg, ${cur} per sqm/yr)` : `Indexed Rate (${cur} per sqm/yr)`, values: r.indexedRatePerPeriod, valueKind: 'rate', totalValue: lastPos(r.indexedRatePerPeriod), indent: 1 },
          ...zones.map((u) => ({ label: `${u.name} Indexed Rate (${sqmText(r.perSubUnit[u.id].gla)} GLA)`, values: r.perSubUnit[u.id].indexedRatePerPeriod, valueKind: 'rate' as const, totalValue: lastPos(r.perSubUnit[u.id].indexedRatePerPeriod), indent: 2 })),
          { label: 'Calculations', values: [], isSection: true },
          ...zones.map((u) => ({ label: `${u.name} Occupied Area (sqm)`, values: r.perSubUnit[u.id].occupiedAreaPerPeriod, valueKind: 'count' as const, indent: 2 })),
          { label: 'Total Occupied Lease Area (sqm)', values: r.occupiedAreaPerPeriod, valueKind: 'count', isSubtotal: zones.length > 0, indent: 1 },
        ]);
        em.tableTitle('2. Per-Sub-Unit + Total Lease Revenue', 'Revenue = Occupied Area x Indexed Rate (per zone, then summed). Recognition = cash = revenue in the same period.');
        em.emitRows([
          ...zones.map((u) => ({ label: `${u.name} Rent Revenue`, values: r.perSubUnit[u.id].revenuePerPeriod, indent: 1 })),
          { label: 'Total Lease Revenue', values: r.totalRevenuePerPeriod, isTotal: true },
        ]);
        em.gap();
      }
    }
  }
  // THE PROJECT TOTAL: three tables grouped by section, from the shared builder.
  em.groupBand('Project Total');
  let totalRow = em.cursor();
  for (const t of PROJECT_REVENUE_TABLES) {
    em.tableTitle(t.title, t.caption);
    for (const row of buildProjectRevenueGroupedRows(t.view, lines, lineResults, N)) {
      const used = em.emitM4(row);
      if (t.view === 'recognition' && row.label === 'Total Project') totalRow = used;
    }
    em.gap();
  }

  // ── 3. Cost of Sales ─────────────────────────────────────────────────────────
  em.section('3. Cost of Sales (per line: the build of the base, vintage matrix, summary, inventory; then the project totals)');
  let cosTotalRow = em.cursor();
  {
    // Built twice on purpose: once with String so every Total override parses
    // back to its exact number, once with the label formatter so the basis
    // sentence reads as money ("567,903,574") rather than a raw float.
    const tables = buildCostOfSalesReport(snap, state, (v) => String(v));
    const labelled = buildCostOfSalesReport(snap, state, ctx.labelMoney);
    const emitTable = (t: typeof tables[number], i: number): void => {
      em.tableTitle(t.title);
      t.rows.forEach((row, k) => {
        const shown = row.isSection ? { ...row, label: labelled[i]?.rows[k]?.label ?? row.label } : row;
        const used = em.emitM4(shown);
        if (t.title === 'Project Total Cost of Sales' && row.isTotal) cosTotalRow = used;
      });
      em.gap();
    };
    for (const section of REVENUE_SECTIONS) {
      const idx = tables.map((t, i) => [t, i] as const).filter(([t]) => t.section === section);
      if (idx.length === 0) continue;
      em.groupBand(section);
      for (const [t, i] of idx) emitTable(t, i);
    }
    const project = tables.map((t, i) => [t, i] as const).filter(([t]) => !t.lineKey);
    if (project.length) {
      em.groupBand('Project Total');
      for (const [t, i] of project) emitTable(t, i);
    }
  }

  // ── 4. Schedules (the three feeds) ───────────────────────────────────────────
  em.section('4. Schedules (income statement, balance sheet and cash flow feeds, per line)');
  for (const feed of buildRevenueScheduleFeeds(snap.revenue, lines, snap.byAssetCostOfSales)) {
    em.groupBand(feed.group);
    setBasis(ws.getCell(em.cursor() - 1, META_B), feed.meta);
    for (const t of feed.tables) {
      em.tableTitle(t.title, t.caption ?? '');
      em.emitRows(t.rows);
      em.gap();
    }
  }

  // ── 5. Escrow (whenever a Sell line has pre-sales cash) ──────────────────────
  const escrowLines = planReportLines({ assets: state.assets, phases: state.phases, parcels: state.parcels }, (a) => snap.escrow.byAsset.has(a.id));
  if (escrowLines.length > 0) {
    em.section('5. Escrow (inputs, pre-sales cash subject to escrow, balance roll-forward, cash flow impact)');
    const esc = snap.escrow.projectTotals;
    const rows = escrowLines.map((line) => {
      const members = line.assetIds.map((id) => snap.escrow.byAsset.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
      const host = members[0];
      const rl = lineForAsset(lines, host.assetId);
      return { ...poolResults(members), assetId: host.assetId, name: rl ? revenueLineName(rl) : lineTitle(line, { assets: state.assets, phases: state.phases, parcels: state.parcels }), effectiveHeldPct: host.effectiveHeldPct, effectiveHeldUntilYear: host.effectiveHeldUntilYear, effectiveReleaseYear: host.effectiveReleaseYear };
    });
    em.groupBand('1. Escrow Inputs');
    const pe = state.project.escrow;
    em.scalarRow('Project Held % (regulator-locked)', pe?.heldPct ?? 0, NUMFMT.pct, { input: true, basis: 'Withheld from every pre-sales inflow; a line override wins.' });
    em.scalarRow('Default Held Until Year (optional)', pe?.defaultHeldUntilYear ?? 'auto: handover year', NUMFMT.year, { input: true, basis: 'Blank = withhold only through each line\'s handover year.' });
    em.scalarRow('Default Release Year (optional)', pe?.defaultReleaseYear ?? 'auto: handover year + 1', NUMFMT.year, { input: true, basis: 'Blank = the year after each line\'s handover.' });
    em.colHeaders([[LBL_COL, 'Asset', 'left'], [TOTAL_COL, 'Effective Held %', 'right'], [OPEN_COL, 'Held % Override', 'right'], [OPEN_COL + 1, 'Effective Held Until', 'right'], [OPEN_COL + 2, 'Held Until Override', 'right'], [OPEN_COL + 3, 'Effective Release Year', 'right'], [OPEN_COL + 4, 'Release Year Override', 'right']]);
    for (const row of rows) {
      const ov = state.assets.find((x) => x.id === row.assetId)?.revenue?.sell?.escrow;
      em.cellsRow([
        [LBL_COL, row.name, '@'],
        [TOTAL_COL, row.effectiveHeldPct, NUMFMT.pct],
        [OPEN_COL, ov?.heldPctOverride ?? 'inherit', NUMFMT.pct, true],
        [OPEN_COL + 1, row.effectiveHeldUntilYear, NUMFMT.year],
        [OPEN_COL + 2, ov?.heldUntilYearOverride ?? 'auto', NUMFMT.year, true],
        [OPEN_COL + 3, row.effectiveReleaseYear, NUMFMT.year],
        [OPEN_COL + 4, ov?.releaseYearOverride ?? 'auto', NUMFMT.year, true],
      ]);
    }
    em.gap();
    em.groupBand('2. Escrow Schedules');
    em.tableTitle('A. Pre-Sales Cash by Asset (subject to escrow)', 'Held = pre-sales cash x the effective held %, only through each line\'s held-until year.');
    for (const row of rows) em.moneyRow(row.name, row.preSalesCashPerPeriod, { indent: 1 });
    em.moneyRow('Total Pre-Sales Cash (all assets)', esc.preSalesCashPerPeriod, { style: 'total' });
    em.gap();
    em.tableTitle('B. Escrow Balance Roll-Forward', 'Opening + Additions - Release = Closing; closing returns to zero once every line has released.');
    const opening = new Array<number>(N).fill(0);
    for (let t = 1; t < N; t++) opening[t] = esc.cumulativeBalancePerPeriod[t - 1] ?? 0;
    em.moneyRow('Opening Balance', opening, { style: 'subtotal', noTotal: true });
    em.subTitle('Additions:');
    for (const row of rows) em.moneyRow(row.name, row.result.heldPerPeriod, { indent: 1 });
    em.moneyRow('Total Additions', esc.heldPerPeriod, { style: 'subtotal' });
    em.moneyRow('Less: Release of Locked Funds', esc.releasePerPeriod.slice(0, N).map((v) => -v), { style: 'subtotal' });
    em.moneyRow('Closing Balance', esc.cumulativeBalancePerPeriod, { style: 'total', totalLast: true });
    em.gap();
    em.tableTitle('C. Cash Flow Impact (project totals)', 'What Module 4 deducts (held) and adds back (release); the net sums to zero over the horizon.');
    em.moneyRow('Less: Inaccessible Funds Locked', esc.heldPerPeriod.slice(0, N).map((v) => -v), { indent: 1 });
    em.moneyRow('Add: Release of Inaccessible Funds', esc.releasePerPeriod, { indent: 1 });
    em.moneyRow('Net Cash Flow Adjustment (to M4)', esc.cashFlowAdjustmentPerPeriod, { style: 'total' });
  }

  return {
    revLinks: { byAssetRow: new Map<string, number>(), residentialRow: totalRow, hospitalityRow: totalRow, retailRow: totalRow, totalRow },
    cosLinks: { byAssetRow: new Map<string, number>(), totalRow: cosTotalRow },
  };
}

// ── Opex (a mirror of the platform Module 3, both sub-tabs in order) ──────────
// 1. Opex Inputs as the screen lays them out: the HQ card, the Accounts Payable
// (DPO) card, then one card per line under Hospitality and Retail / Lease, every
// line in the screen's columns and words (Line item, Category, Mode, Rate,
// Value, Inflation, On). 2. Opex Output: the per-line operating statements
// filed by section (the hotel statement, the lease statements), the project
// total, then the Accounts Payable roll-forwards in the screen's row order,
// HQ included. Every figure is the platform snapshot value (hardcoded).
function addOpex(ctx: EmitCtx): OpexLinks {
  const { wb, snap, state } = ctx;
  const N = snap.axisLength;
  const psy = snap.revenue.projectStartYear;
  const ws = wb.addWorksheet(SHEETS.opex, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Operating Expenses', 'A mirror of the platform Opex module, both sub-tabs in order: 1. Opex Inputs (HQ overheads, payables and one card per line), 2. Opex Output (per-line operating statements filed by section, the project total and the accounts payable roll-forwards).', { label: 'Line', feeds: 'Sourced from the Module 3 line inputs and Revenue (the operating revenue percentage lines are charged on). Feeds the P&L (operating expenses), the Balance Sheet (accounts payable) and the Cash Flow (opex paid).' });
  const em = makeRevOpexEmitters(ws, N);
  const lineState = { assets: state.assets, phases: state.phases, parcels: state.parcels };
  const revLines = planRevenueLines(state.assets, state.subUnits, state.phases, state.project);
  const nameOf = (assetId: string, fallback: string): string => { const l = lineForAsset(revLines, assetId); return l ? revenueLineName(l) : fallback; };
  const cur = ctx.currency;

  // The operating window a line's per-year strips run over (the screen's rule).
  const opsYears = (a: Asset): number[] => {
    const phase = state.phases.find((p) => p.id === a.phaseId);
    if (!phase) return [];
    const phStart = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : psy;
    const offset = Math.max(0, phStart - psy);
    const cp = Math.max(0, phase.constructionPeriods ?? 0);
    const op = Math.max(0, phase.operationsPeriods ?? 0);
    const overlap = Math.max(0, phase.overlapPeriods ?? 0);
    const handoverIdx = Math.max(0, offset + cp - 1);
    const defaultOpsStart = Math.max(handoverIdx, handoverIdx + 1 - overlap);
    const override = a.strategy === 'Lease' ? a.revenue?.lease?.operationsStartYearOverride : a.revenue?.operate?.operationsStartYearOverride;
    const start = typeof override === 'number' ? Math.max(handoverIdx, override - psy) : defaultOpsStart;
    const end = Math.min(N - 1, defaultOpsStart + op - 1);
    const out: number[] = [];
    for (let i = start; i <= end; i++) out.push(i);
    return out;
  };
  const padded = (arr: readonly number[] | undefined): number[] => Array.from({ length: N }, (_, i) => arr?.[i] ?? 0);

  const inflationRows = (label: string, cfg: IndexationConfig, years: number[]): void => {
    em.scalarRow(label, summarizeOpexIndexation(cfg), '@', { input: true, indent: 0 });
    if (cfg.method === 'yoy_per_period') em.periodRow('Growth %', padded(cfg.growthPerPeriod), years, NUMFMT.pct, { input: true });
  };
  const lineTable = (lines: readonly OpexLine[], defaultIndexation: IndexationConfig, years: number[]): void => {
    em.colHeaders([[LBL_COL, 'Line item', 'left'], [META_B, 'Category', 'left'], [TOTAL_COL, 'Mode', 'left'], [OPEN_COL, 'Rate', 'left'], [OPEN_COL + 1, 'Value', 'right'], [OPEN_COL + 2, 'Inflation', 'left'], [OPEN_COL + 3, 'On', 'left']]);
    for (const l of lines) {
      const isPct = String(l.mode).startsWith('pct_');
      const valueFmt = isPct ? NUMFMT.pct : l.mode === 'fixed_baseline' ? NUMFMT.money : NUMFMT.rate;
      em.cellsRow([
        [LBL_COL, l.name, '@'],
        [META_B, OPEX_CATEGORY_LABELS[l.category] ?? String(l.category), '@'],
        [TOTAL_COL, OPEX_MODE_LABELS[l.mode] ?? String(l.mode), '@', true],
        [OPEN_COL, l.rateMode === 'yoy' ? 'YoY' : 'Single', '@', true],
        [OPEN_COL + 1, l.rateMode === 'yoy' ? 'year-by-year' : Math.max(0, l.value), valueFmt, true],
        [OPEN_COL + 2, opexLineInflationText(l, defaultIndexation), '@'],
        [OPEN_COL + 3, l.disabled ? 'Off' : 'On', '@', true],
      ]);
      const fixed = isFixedCostOpexMode(l.mode);
      if (fixed && l.useAssetDefault === false && l.rateMode !== 'yoy') {
        em.scalarRow(`Override inflation for ${l.name}`, summarizeOpexIndexation(l.indexation), '@', { input: true, indent: 2 });
        if (l.indexation?.method === 'yoy_per_period') em.periodRow('Growth %', padded(l.indexation.growthPerPeriod), years, NUMFMT.pct, { input: true, indent: 2 });
      }
      if (l.rateMode === 'yoy' && years.length > 0) {
        em.periodRow(`Per-year ${isPct ? 'rates' : 'values'} for ${l.name}`, padded(l.yoyRates), years, valueFmt, {
          input: true, indent: 2,
          basis: isPct ? 'rate %' : l.mode === 'per_room_year' ? `${cur} per key per year` : l.mode === 'per_sqm_year' ? `${cur} per sqm per year` : `${cur} / year`,
        });
      }
    }
  };

  // ── 1. Opex Inputs ───────────────────────────────────────────────────────────
  em.section('1. Opex Inputs (HQ overheads, accounts payable, then one card per line: Hospitality, Retail / Lease)');
  {
    em.subTitle('HQ & Corporate Overheads');
    setBasis(ws.getCell(em.cursor() - 1, META_B), 'project-wide');
    const hqLines = state.project.hqOpex?.lines && state.project.hqOpex.lines.length > 0 ? state.project.hqOpex.lines : defaultHQOpexLines();
    const hqDefault = normalizeOpexIndexation(state.project.hqOpex?.defaultIndexation);
    const fullAxis = Array.from({ length: N }, (_, i) => i);
    inflationRows('HQ Inflation', hqDefault, fullAxis);
    lineTable(hqLines, hqDefault, fullAxis);
    em.gap();
  }
  const opexLines = planReportLines(lineState, (a) => a.strategy === 'Operate' || a.strategy === 'Lease');
  const hosts = opexLines.map((line) => {
    const host = state.assets.find((a) => a.id === line.assetIds[0])!;
    return { host, name: nameOf(host.id, lineTitle(line, lineState)) };
  });
  const hospitality = hosts.filter((h) => h.host.strategy === 'Operate');
  const lease = hosts.filter((h) => h.host.strategy === 'Lease');
  {
    em.subTitle('Accounts Payable (DPO)');
    setBasis(ws.getCell(em.cursor() - 1, META_B), 'project-wide');
    const dflt = state.project.opexAp?.defaultApDays;
    const projectDefault = Math.max(0, dflt ?? 0);
    em.scalarRow('Project Default DPO (days)', dflt ?? '0 (cash basis)', NUMFMT.int, { input: true, basis: 'AP closing = opex x (DPO / days basis); blank or 0 pays on incurrence.' });
    em.scalarRow('Days basis', state.project.opexAp?.daysPerYear ?? 365, NUMFMT.int, { input: true, basis: 'Days per year for the DPO ratio.' });
    if (hosts.length > 0) {
      em.colHeaders([[LBL_COL, 'Asset', 'left'], [TOTAL_COL, 'Effective DPO (days)', 'right'], [OPEN_COL, 'DPO Override', 'right']]);
      for (const { host, name } of [...hospitality, ...lease]) {
        const ov = host.opex?.apDaysOverride;
        em.cellsRow([[LBL_COL, name, '@'], [TOTAL_COL, ov !== undefined && ov >= 0 ? ov : projectDefault, NUMFMT.int], [OPEN_COL, ov ?? 'inherit', NUMFMT.int, true]]);
      }
    }
    em.gap();
  }
  const card = ({ host, name }: { host: Asset; name: string }): void => {
    em.subTitle(name);
    const badge = host.strategy === 'Lease' ? 'Retail / Lease' : host.isCompanion === true ? 'Hospitality (Manage side)' : 'Hospitality';
    const phaseName = state.phases.find((p) => p.id === host.phaseId)?.name ?? '';
    const parent = host.isCompanion === true && host.parentAssetId ? state.assets.find((x) => x.id === host.parentAssetId) : undefined;
    setBasis(ws.getCell(em.cursor() - 1, META_B), [badge, phaseName, parent ? `Manage / Operate, linked to ${nameOf(parent.id, parent.name)}` : ''].filter(Boolean).join(', '));
    const lines = host.opex?.lines ?? [];
    if (lines.length === 0) { em.headNote('No opex configured yet for this asset.'); em.gap(); return; }
    const years = opsYears(host);
    const dflt = normalizeOpexIndexation(host.opex?.defaultIndexation);
    inflationRows('Asset Inflation', dflt, years);
    lineTable(lines, dflt, years);
    em.gap();
  };
  if (hospitality.length > 0) { em.groupBand('Hospitality'); hospitality.forEach(card); }
  if (lease.length > 0) { em.groupBand('Retail / Lease'); lease.forEach(card); }

  // ── 2. Opex Output ───────────────────────────────────────────────────────────
  em.section('2. Opex Output (per-line operating statements by section, the project total, accounts payable)');
  const tables = buildOpexReport(snap, state);
  for (const section of REVENUE_SECTIONS) {
    const sectionTables = tables.filter((t) => t.lineKey && t.section === section);
    if (sectionTables.length === 0) continue;
    em.groupBand(`${section}: ${REVENUE_SECTION_META[section]}`);
    for (const key of Array.from(new Set(sectionTables.map((t) => t.lineKey as string)))) {
      const line = revLines.find((l) => l.key === key);
      em.subTitle(line ? revenueLineName(line) : key);
      for (const t of sectionTables.filter((x) => x.lineKey === key)) {
        em.tableTitle(t.title);
        em.emitTable(t.rows);
        em.gap();
      }
    }
  }
  let totalRow = em.cursor(); let hqRow = -1;
  em.groupBand('Project Total');
  for (const t of tables.filter((x) => !x.lineKey)) {
    em.tableTitle(t.title);
    for (const row of t.rows) {
      const used = em.emitM4(row);
      if (t.title === 'Project Total Opex') { if (row.isTotal) totalRow = used; else if (row.label === 'HQ overheads') hqRow = used; }
    }
    em.gap();
  }

  // THE ACCOUNTS PAYABLE ROLL-FORWARDS, in the screen's row order: opening,
  // opex incurred, less cash paid, closing; one per line, then HQ, then the project.
  em.groupBand('Accounts Payable (Opex)');
  setBasis(ws.getCell(em.cursor() - 1, META_B), 'DPO-driven AP roll-forward; feeds balance sheet current liabilities and cash paid for opex');
  const apRoll = (title: string, meta: string, opening: number[], incurredLabel: string, incurred: number[], cashPaid: number[], closing: number[]): void => {
    em.tableTitle(title, meta);
    em.moneyRow('Opening AP', opening, { style: 'subtotal', totalValue: opening[0] ?? 0 });
    em.moneyRow(incurredLabel, incurred, { indent: 1 });
    em.moneyRow('Less: Cash Paid', cashPaid.slice(0, N).map((v) => -v), { indent: 1 });
    em.moneyRow('Closing AP', closing, { style: 'total', totalLast: true });
    em.gap();
  };
  for (const line of planReportLines(lineState, (a) => snap.ap.byAsset.has(a.id))) {
    const members = line.assetIds.map((id) => snap.ap.byAsset.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
    const pooled = poolResults(members);
    const name = nameOf(members[0].assetId, lineTitle(line, lineState));
    apRoll(`${name}: AP Roll-Forward`, `DPO ${members[0].effectiveApDays} days`, pooled.result.openingPerPeriod, 'Opex Incurred', pooled.opexIncurredPerPeriod, pooled.result.cashPaidPerPeriod, pooled.result.perPeriod);
  }
  apRoll('HQ: AP Roll-Forward', `HQ & Corporate Overheads, DPO ${snap.ap.hq.apDays} days`, snap.ap.hq.result.openingPerPeriod, 'HQ Opex Incurred', snap.ap.hq.opexIncurredPerPeriod, snap.ap.hq.result.cashPaidPerPeriod, snap.ap.hq.result.perPeriod);
  const apt = snap.ap.projectTotals;
  apRoll('Project Total: AP Roll-Forward', 'Sum across every line and HQ. Cash Paid = Opex Incurred less the change in AP.', apt.openingApPerPeriod, 'Opex Incurred', apt.opexIncurredPerPeriod, apt.cashPaidPerPeriod, apt.closingApPerPeriod);

  // hospRow / retailRow have no per-strategy rollup row on the platform; they
  // feed nothing (addReturns voids the registry), so they point at the total.
  return { hospRow: totalRow, retailRow: totalRow, hqRow, totalRow };
}

// ── Financing (full step-by-step mirror of the platform's 4 sub-tabs) ─────────
// The platform Financing module has exactly four sub-tabs: Inputs, Schedules,
// Funding Gap, Cash Sweep. All four are reproduced here in that fixed sequence,
// each at full per-period depth (not a summary), hardcoded from the snapshot via
// the same shared report builders the on-screen tabs + PDF use. Capital Stack +
// movement are synthesised from the debt + equity closings (no standalone
// platform table). In STATIC mode the FinLinks rows are referenced only inside
// discarded formula strings on the downstream tabs (their values come from the
// real snapshot model), so a stub registry is returned.
function addFinancing(ctx: EmitCtx): FinLinks {
  const { wb, snap, state, proj } = ctx;
  const N = snap.axisLength;
  const fin = snap.financing;
  const ws = wb.addWorksheet(SHEETS.financing, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Financing', 'Full step-by-step mirror of the platform Financing module, all four sub-tabs in sequence: 1. Inputs (echoed from Assumptions + derived working), 2. Schedules (per-facility debt roll-forward, finance cost, combined debt service, equity movement, capital stack), 3. Funding Gap (Method 2 + Method 3 per period), 4. Cash Sweep (cash waterfall + per-tranche sweep).', { label: 'Line', feeds: 'Sourced from the Assumptions inputs, Revenue (pre-sales), Capex and Opex. Feeds P&L, Cash Flow, Balance Sheet and Returns.' });
  const fmtNum = (v: number): string => String(v);
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const neg = (a: number[]): number[] => a.map((v) => -(v ?? 0));
  let r = 5;

  // Constant cell in the Total column (a scalar echo), formula-black.
  const constCell = (cell: ExcelJS.Cell, v: number | string, numFmt: string): void => {
    cell.value = v; cell.numFmt = numFmt; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
  };
  const echo = (label: string, value: number | string, numFmt: string, basis: string): void => {
    setLabel(ws.getCell(r, LBL_COL), label);
    setBasis(ws.getCell(r, META_B), basis);
    constCell(ws.getCell(r, TOTAL_COL), value, numFmt);
    r += 1;
  };
  // One per-period schedule row from an M4Row (values are axis-indexed; priorValue
  // -> the opening column E; flow Total = sum + prior, balance/state Total = last).
  /**
   * THE OVERRIDE IS A VALUE, NOT A HINT THAT THE ROW IS A BALANCE (2026-09-01).
   *
   * This read `totalOverride !== undefined` as "this row is a balance, so print
   * the LAST period". That is right only while every override IS the last
   * period, and on this tab five of them are not: financingReports states
   * `priorBal`, a literal 0, `priorExisting`, `opening[0]` and `-minCash`.
   *
   * Measured before the fix, on the export fixture: 9 of 17 override rows on
   * the Financing tab printed a Total the builder never asked for. Every
   * "Opening" row showed a CLOSING figure, so "Opening Cash" read 58,922,877.94
   * where the builder stated 0.00. That is a wrong number in a sheet a user
   * reads, not a latent fragility.
   *
   * A BLANK override stays the "no total, use the state rule" sentinel: the two
   * state rows below pass `totalOverride: ''`, and Number('') is 0 and finite,
   * so reading it as a value would print 0.00 for a closing balance.
   */
  const emitM4 = (row: M4Row, basis: string, opts: { stateRow?: boolean } = {}): void => {
    const blank = row.totalOverride === undefined || String(row.totalOverride).trim() === '';
    const ov = blank ? undefined : Number(row.totalOverride);
    const stated = ov !== undefined && Number.isFinite(ov) ? ov : undefined;
    const strong = !!(row.isTotal || row.isSubtotal);
    setLabel(ws.getCell(r, LBL_COL), row.label, { indent: row.indent, bold: strong });
    if (basis) setBasis(ws.getCell(r, META_B), basis);
    const vals = row.values ?? [];
    const put = (c: number, v: number): void => constCell(ws.getCell(r, c), v, NUMFMT.money);
    put(OPEN_COL, row.priorValue ?? 0);
    for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    const total = stated !== undefined
      ? stated
      : opts.stateRow === true
        ? (vals[N - 1] ?? 0)
        : vals.reduce((s, v) => s + (v ?? 0), 0) + (row.priorValue ?? 0);
    put(TOTAL_COL, total);
    const last = lastActiveCol(N);
    if (row.isTotal) {
      fillRange(ws, r, 1, r, last, ARGB.navy);
      for (let c = 1; c <= last; c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white }, italic: c === META_B }; }
    } else if (row.isSubtotal) {
      for (let c = 1; c <= last; c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark }, italic: c === META_B }; }
    }
    r += 1;
  };
  const subTitle = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.subtotal);
    for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    r += 1;
  };
  // Substring-keyed Basis text so every computed schedule row carries guidance.
  const basisFor = (label: string): string => {
    const l = label.toLowerCase();
    if (l.startsWith('opening')) return 'Prior period closing';
    if (l.includes('capex drawdown')) return 'New debt drawn for capex';
    if (l.includes('idc drawdown')) return 'Construction interest capitalised to debt';
    if (l.includes('total drawdown')) return 'Capex drawdown + IDC drawdown';
    if (l.includes('principal repaid')) return 'Scheduled + cash-swept principal';
    if (l.includes('closing')) return 'Opening + drawdown - principal (- sweep)';
    if (l.includes('charge') || l.includes('accrued')) return 'Blended rate x opening debt';
    if (l.includes('capitalized') || l.includes('capitalised')) return 'Interest added to debt (IDC, non-cash)';
    if (l === 'paid' || l.includes(') paid')) return 'Interest paid in cash';
    if (l.includes('interest expensed')) return 'Interest charged to P&L (not capitalised)';
    if (l.includes('debt service')) return 'Principal + cash interest';
    if (l.includes('cash contribution')) return 'Equity drawn in cash';
    if (l.includes('in-kind')) return 'In-kind land contributed as equity';
    if (l.includes('cumulative equity')) return 'Opening + cash + in-kind';
    if (l.includes('cash from operations')) return 'From Cash Flow (operations)';
    if (l.includes('cash from invest')) return 'Capex paid in cash';
    if (l.includes('equity drawdown')) return 'Cash equity drawn to fund the gap';
    if (l.includes('debt drawdown')) return 'New debt drawn to maintain min cash';
    if (l.includes('interest paid')) return 'Cash interest paid this period';
    if (l.includes('cash available for debt')) return 'Cash available - minimum cash';
    if (l.includes('cash available for dividend')) return 'Cash available - debt paid';
    if (l.includes('cash available')) return 'Opening + operations + financing - interest';
    if (l.includes('minimum cash')) return 'Minimum cash reserve held back';
    if (l.includes('debt paid')) return 'Principal repaid (scheduled + sweep)';
    if (l.includes('dividend')) return 'Distribution per dividend policy';
    if (l.includes('sweep applied')) return 'Surplus swept to this tranche';
    if (l.includes('total debt outstanding')) return 'Sum of post-sweep tranche balances';
    return 'Platform snapshot value';
  };
  const emitTable = (table: ReportTable): void => {
    subTitle(table.title);
    for (const row of table.rows) emitM4(row, basisFor(row.label));
    r += 1;
  };

  // Funding-gap waterfall (Method 2 + Method 3 series). Computed once here so
  // both the Inputs Funding Requirement block (the schedule starting point) and
  // section 3 below read from the same source.
  const gap = computeFundingGap(snap);

  // ── 1. Inputs (raw inputs echoed from Assumptions + derived working) ─────────
  setSectionHeader(ws.getRow(r), '1. Inputs (raw inputs are on the Assumptions tab under the Financing divider; echoed here, plus derived working)', lastActiveCol(N), ARGB.accent); r += 1;
  const idc = state.project.idcConfig ?? {};
  const div = state.project.dividendPolicy;
  const sweepCfg = (state.project.financing?.cashSweep ?? {}) as { startingYear?: number; sweepRatioPct?: number };
  const A = 'From Assumptions, Financing divider (edit there, re-export)';
  echo('Funding method', FUNDING_METHOD_LABELS[(state.project.financing?.fundingMethod ?? 1) as FundingMethodId], '@', A);
  echo('Debt share', proj.debtPct, NUMFMT.pct, A);
  echo('Equity share', proj.equityPct, NUMFMT.pct, A);
  echo('Minimum cash reserve', proj.minCash, NUMFMT.money, A);
  echo('Blended interest rate', proj.debtRate, NUMFMT.pct2, A);
  echo('IDC capitalize', idc.capitalize === false ? 'No' : 'Yes', '@', A);
  echo('IDC allocation basis', String(idc.allocationBasis ?? 'land'), '@', A);
  echo('IDC funding', 'Cash first, debt drawn only for the shortfall', '@', A);
  echo('Dividends enabled', div?.enabled ? 'Yes' : 'No', '@', A);
  echo('Dividend payout ratio', (div?.payoutRatio ?? 0) / 100, NUMFMT.pct, A);
  echo('Dividend start year (0 = auto)', state.project.dividendStartYear ?? 0, NUMFMT.year, A);
  echo('Cash sweep starting year (0 = auto)', sweepCfg.startingYear ?? 0, NUMFMT.year, A);
  echo('Cash sweep ratio (% of surplus)', (sweepCfg.sweepRatioPct ?? 100) / 100, NUMFMT.pct, A);
  // Derived working (computed on this tab from the inputs above + facilities).
  const existingOpening = [...fin.facilities.values()].reduce((s, f) => s + Math.max(0, f.openingBalance ?? 0), 0);
  echo('Number of debt facilities', state.financingTranches.length, NUMFMT.int, 'Derived: count of facilities');
  echo('Total existing debt opening balance', existingOpening, NUMFMT.money, 'Derived: sum of facility opening balances');
  echo('Total existing equity (carry-forward)', fin.existing.equityTotal, NUMFMT.money, 'Derived: existing operations equity');
  echo('Total existing pre-axis capex', fin.existing.preCapexTotal, NUMFMT.money, 'Derived: pre-axis capex on existing assets');
  r += 1;

  // Funding Requirement (the schedule starting point): each method sizes the
  // requirement a different way; the Selected row is what the Schedules below
  // draw down. Mirrors the platform Inputs tab's "7. Funding Requirement" table.
  const fnd = fin.funding;
  const selId = (fnd.selectedMethodId ?? 1) as FundingMethodId;
  const axisN = (a: number[] | undefined): number[] => (a ?? []).slice(0, N);
  subTitle(`Funding Requirement (schedule starting point: requirement by funding method, Method ${selId} selected)`);
  emitM4({ label: 'Method 1, Fixed Debt-to-Equity Ratio', values: axisN(gap.capexPerPeriod) }, 'Total capex (excl. land in-kind), funded by fixed D/E');
  emitM4({ label: 'Method 2, Net Funding Requirement', values: axisN(gap.methodAGapPerPeriod) }, 'max(0, capex - lagged pre-sales)');
  emitM4({ label: 'Method 3, Cash Deficit Funding', values: axisN(gap.method3Waterfall.netCashRequiredPerPeriod) }, 'Shortfall below the minimum cash');
  emitM4({ label: 'Method 4, Specified Debt + Equity (manual)', values: selId === 4 ? axisN(fnd.selectedByPeriod) : zeros() }, 'Manually specified drawdown (active only when selected)');
  emitM4({ label: `Selected (Method ${selId})`, values: axisN(fnd.selectedByPeriod), isSubtotal: true }, 'The active method, drawn down in the Schedules below');
  if ((fnd.minCashReserve ?? 0) > 0 && selId !== 3) {
    emitM4({ label: '(+) Minimum Cash Reserve', values: axisN(fnd.minCashByPeriod), indent: 1 }, 'Minimum cash buffer added to the requirement');
    emitM4({ label: 'Total Funding Need', values: axisN(fnd.totalFundingNeedByPeriod), isTotal: true }, 'Selected requirement + minimum cash');
  }
  r += 1;

  // ── 2. Schedules ─────────────────────────────────────────────────────────────
  setSectionHeader(ws.getRow(r), '2. Schedules (per-facility debt roll-forward, finance cost, combined debt service, equity movement, capital stack)', lastActiveCol(N), ARGB.accent); r += 1;
  const schedTables = buildFinancingScheduleTables(snap, state, fmtNum);
  for (const table of schedTables) emitTable(table);
  // Capital Stack + movement (synthesised from debt + equity closings).
  const debtClosing = (snap.bs.debtOutstandingPerPeriod ?? []).slice(0, N);
  const eqCash = (fin.equity.cashPerPeriod ?? []).slice(0, N);
  const eqInKind = (fin.equity.inKindPerPeriod ?? []).slice(0, N);
  const eqClosing = zeros(); { let acc = fin.existing.equityTotal; for (let t = 0; t < N; t++) { acc += (eqCash[t] ?? 0) + (eqInKind[t] ?? 0); eqClosing[t] = acc; } }
  const capitalTotal = zeros().map((_, t) => (debtClosing[t] ?? 0) + (eqClosing[t] ?? 0));
  const chg = (a: number[]): number[] => a.map((v, t) => (v ?? 0) - (t === 0 ? 0 : (a[t - 1] ?? 0)));
  subTitle('Capital Stack (period-end)');
  emitM4({ label: 'Debt (closing)', values: debtClosing, totalOverride: '' }, 'Debt outstanding, period-end', { stateRow: true });
  emitM4({ label: 'Equity (closing, cumulative)', values: eqClosing, totalOverride: '' }, 'Cumulative equity, period-end', { stateRow: true });
  emitM4({ label: 'Total capital', values: capitalTotal, isTotal: true, totalOverride: '' }, 'Debt + equity', { stateRow: true });
  emitM4({ label: 'Gearing (debt / total capital)', values: capitalTotal.map((c, t) => (c ? (debtClosing[t] ?? 0) / c : 0)), totalOverride: '' }, 'Debt / total capital', { stateRow: true });
  r += 1;
  subTitle('Capital Stack Movement (period change)');
  emitM4({ label: 'Change in debt', values: chg(debtClosing) }, 'Debt closing - prior debt closing');
  emitM4({ label: 'Change in equity', values: chg(eqClosing) }, 'Cash + in-kind contributions');
  emitM4({ label: 'Change in total capital', values: chg(capitalTotal), isSubtotal: true }, 'Change in debt + change in equity');
  r += 1;

  // ── 3. Funding Gap (Method 2 + Method 3 per period) ──────────────────────────
  setSectionHeader(ws.getRow(r), '3. Funding Gap (Method 2 Net Funding Requirement + Method 3 Cash Deficit Funding, per period)', lastActiveCol(N), ARGB.accent); r += 1;
  subTitle('Method 2, Net Funding Requirement (Capex vs Pre-Sales)');
  emitM4({ label: 'Total project capex (excl. land in-kind)', values: gap.capexPerPeriod, isSubtotal: true }, 'Capex Table 3 (cash capex)');
  emitM4({ label: 'Advance received from customer (gross)', values: gap.preSalesGrossPerPeriod }, 'Pre-sales cash collected (gross)');
  emitM4({ label: '  Less: Inaccessible funds locked (escrow held)', values: neg(gap.escrowHeldPerPeriod), indent: 1 }, 'Escrow held back from pre-sales');
  emitM4({ label: '  Add: Release of inaccessible funds (escrow release)', values: gap.escrowReleasePerPeriod, indent: 1 }, 'Escrow released back to project');
  emitM4({ label: 'Advance received from customer (net)', values: gap.preSalesNetPerPeriod, isSubtotal: true }, 'Gross - escrow held + escrow release');
  emitM4({ label: 'Funding fulfilled by pre-sales (last year, capped at capex)', values: gap.fulfilledByPreSalesPerPeriod }, 'Prior-year net pre-sales, capped at capex');
  emitM4({ label: 'Funding gap = MAX(Capex_t - Pre-Sales net_{t-1}, 0)', values: gap.methodAGapPerPeriod, isTotal: true }, 'max(0, capex - lagged pre-sales)');
  emitM4({ label: 'Cumulative Funding Gap (A)', values: gap.methodAGapCumulative, isSubtotal: true, totalOverride: '' }, 'Running total of the funding gap', { stateRow: true });
  r += 1;

  const w = gap.method3Waterfall;
  const debtPct = (fin.funding.debtPct ?? 0) / 100;
  const equityPct = (fin.funding.equityPct ?? 0) / 100;
  const debtSplit = w.netCashRequiredPerPeriod.map((v) => (v ?? 0) * debtPct);
  const equitySplit = w.netCashRequiredPerPeriod.map((v) => (v ?? 0) * equityPct);
  const idcAdd = w.idcDrawdownPerPeriod;
  const idcCash = w.idcCashPaidPerPeriod;
  const totalNewDebt = debtSplit.map((v, t) => v + (idcAdd[t] ?? 0));
  const minCash = w.minCashReserve;
  subTitle('Method 3, Cash Deficit Funding (Drawdown Sizing)');
  emitM4({ label: 'Opening Cash', values: w.openingCashPerPeriod, priorValue: snap.bs.historicalOpeningCashTotal, totalOverride: '' }, 'Prior period closing cash', { stateRow: true });
  emitM4({ label: '(+) Cash from Operations', values: w.cashFromOpsPerPeriod }, 'From Cash Flow (operations)');
  emitM4({ label: '(+) Cash from Investments', values: w.cashFromInvPerPeriod, priorValue: -fin.existing.preCapexTotal }, 'Capex (negative)');
  emitM4({ label: '(+) Existing Equity Opening (memo)', values: zeros(), priorValue: fin.existing.equityTotal }, 'Existing equity carried in (prior column)');
  emitM4({ label: '(+) Existing Debt Opening Balance (memo)', values: zeros(), priorValue: existingOpening }, 'Existing debt carried in (prior column)');
  if (w.financeCostPaidPerPeriod.some((v) => v !== 0)) emitM4({ label: '(-) Finance Cost Paid (cash)', values: w.financeCostPaidPerPeriod, indent: 1 }, 'Cash interest during construction');
  if (w.dividendsBeforeSweepPerPeriod.some((v) => v !== 0)) emitM4({ label: '(-) Operational Dividend (before sweep)', values: w.dividendsBeforeSweepPerPeriod, indent: 1 }, 'Dividend paid before sweep');
  emitM4({ label: 'Cash Available (before new funding)', values: w.cashAvailableBeforeNewDebtPerPeriod, isSubtotal: true }, 'Opening + ops + inv - finance cost');
  if (idcCash.some((v) => v !== 0)) emitM4({ label: '  (memo) IDC paid in cash (surplus)', values: idcCash, indent: 1 }, 'Conditional IDC paid from surplus');
  if (idcAdd.some((v) => v !== 0)) emitM4({ label: '  (memo) IDC capitalised to debt (shortfall)', values: idcAdd, indent: 1 }, 'IDC added to debt where no surplus');
  emitM4({ label: 'Net Cash Required (= max(0, MinCash - Cash Available))', values: w.netCashRequiredPerPeriod, isTotal: true }, 'Shortfall below the minimum cash');
  emitM4({ label: `  of which: New Debt (${(debtPct * 100).toFixed(0)}%)`, values: debtSplit, indent: 2 }, 'Net cash required x debt %');
  emitM4({ label: `  of which: New Equity (${(equityPct * 100).toFixed(0)}%)`, values: equitySplit, indent: 2 }, 'Net cash required x equity %');
  if (idcAdd.some((v) => v !== 0)) emitM4({ label: '(+) IDC capitalised to debt (no cash)', values: idcAdd, indent: 1 }, 'Non-cash IDC added to debt');
  emitM4({ label: 'Total New Debt Required (cash + IDC capitalised)', values: totalNewDebt, isTotal: true }, 'New cash debt + capitalised IDC');
  emitM4({ label: 'Total New Equity Required', values: equitySplit, isTotal: true }, 'New cash equity');
  emitM4({ label: 'Closing Cash (after funding, before sweep & dividends)', values: w.cashAvailableBeforeNewDebtPerPeriod.map((v) => Math.max(minCash, v ?? 0)), priorValue: snap.bs.historicalOpeningCashTotal, isTotal: true, totalOverride: '' }, 'max(minimum cash, cash available)', { stateRow: true });
  r += 1;

  // ── 4. Cash Sweep (cash waterfall + per-tranche sweep) ───────────────────────
  setSectionHeader(ws.getRow(r), '4. Cash Sweep (cash waterfall Operations -> Debt -> Dividend -> Closing, then per-tranche sweep & outstanding)', lastActiveCol(N), ARGB.accent); r += 1;
  const sweepTables = buildCashSweepTables(snap, state, fmtNum);
  for (const table of sweepTables) emitTable(table);

  // Stub registry: in STATIC mode these rows feed only discarded formula strings
  // on the downstream tabs (their values come from the real snapshot model).
  const s = 5;
  return { daRow: s, ebitdaRow: s, ebitRow: s, interestRow: s, pbtRow: s, taxRow: s, patRow: s, arRow: s, apRow: s, capexCashRow: s, inKindRow: s, revReceivedRow: s, opexPaidRow: s, cfoRow: s, cfiRow: s, debtOpenRow: s, debtDrawRow: s, principalRow: s, debtCloseRow: s, equityCashRow: s, equityInKindRow: s, cffRow: s, netCfRow: s, openCashRow: s, closeCashRow: s };
}

// ── Module 4 statement context: terminology-driven labels + a String formatter
// so a row's totalOverride (a formatted Total) round-trips back to a number. ────
function m4Labels(state: FinancialsResolverState): ReturnType<typeof getFinancialLabels> {
  return getFinancialLabels(state.project.financialTerminology ?? defaultTerminologyForCountry(state.project.country));
}

/**
 * Money as it reads inside a row LABEL (never a value cell).
 *
 * FOLLOWS THE WORKBOOK DISPLAY SCALE. It used to be hardcoded to millions,
 * which was invisible on a millions export and wrong on every other one: a
 * full-unit export printed "Fund management fee (0.50% of Total equity 2,632.7
 * m, 14 periods)" beside a value column reading 13,163,667, so the label and
 * the number next to it were in different units. `scaleMoneyFormats` rescales
 * value CELLS at the end of the build but cannot reach text, so the scale has
 * to be threaded down to the label instead.
 */
function makeLabelMoney(scale: DisplayScale, decimals: DisplayDecimals): (v: number) => string {
  const unit = scale === 'millions' ? ' m' : scale === 'thousands' ? ' k' : '';
  const dp = scale === 'full' ? 0 : decimals;
  return (v: number): string => `${formatAccounting(v, scale, dp)}${unit}`;
}

/**
 * Excel row labels for a fee's basis and charge lines.
 *
 * KEPT SHORT DELIBERATELY. The label column is 34 characters wide and the fee
 * names run to 21 ("Custody and admin fee"), so anything descriptive appended
 * here is cut off: "...: basis charged on (per period, 14 periods)" came to 64
 * characters and rendered as "...basis charged on (p", hiding the period count
 * it existed to show. The period count moved to the Base column instead (see
 * fundFeeBasisBaseCell), which is 30 wide and nearly empty.
 *
 * Longest results: "Custody and admin fee: basis" (28) and
 * "Custody and admin fee: charged" (30), both inside 34 with the indent.
 */
function fundFeeBasisLabel(b: FundFeeBasisRow): string {
  return `${b.label}: basis`;
}
function fundFeeChargedLabel(b: FundFeeBasisRow): string {
  return `${b.label}: charged`;
}

// ── Schedules (Module 4 schedules consolidated: Fixed Assets, IDC, Working Cap) ─
function addSchedules(ctx: EmitCtx): void {
  const { wb, snap, state } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.schedules, { properties: { tabColor: { argb: ARGB.navy } } });
  // Roll-forwards: additions and charges sum, opening and closing balances do
  // not. Stated on the sheet rather than left to the reader, on the same rule
  // as the Balance Sheet and Cash Flow tabs. These rows are emitted directly
  // (not through the shared M4Row model), so the heading is named here.
  writeSheetHeader(ws, snap, N, 'Schedules', 'Full mirror of the platform Module 4 Schedules, both sub-tabs in sequence: 1. Fixed Assets & D&A (land + depreciable NBV roll-forward), 2. BS Schedules (balance-sheet feeder roll-forwards ordered ASSETS / LIABILITIES / EQUITY).', { label: 'Line', totalLabel: TOTAL_COLUMN_HEADINGS.mixed, feeds: `Sourced from Capex, depreciation, Modules 1-3 and the financing recurrence. Supports the Balance Sheet. ${TOTAL_COLUMN_NOTES.mixed}` });
  const E = makeEmitters(ws, N);
  const nz = (a?: number[]): boolean => (a ?? []).some((v) => (v ?? 0) !== 0);

  // ── 1. Fixed Assets & D&A ────────────────────────────────────────────────────
  E.section('1. Fixed Assets & D&A (land + depreciable NBV roll-forward, per line + project total)');
  const fa = snap.fixedAssets;
  // THE DISPOSAL THE BALANCE SHEET BOOKED SHOWS IN THE SCHEDULE (2026-09-16, step 10).
  const dCtx = disposalContextOf(snap);
  for (const [, ra, lineName] of poolMapByLine(fa.byAsset, state)) {
    const dep = ra.depreciable;
    if (!nz(dep.closingNBVPerPeriod) && !nz(ra.land.closingPerPeriod)) continue;
    const landD = scheduleWithDisposal({ ...ra.land, closingPerPeriod: ra.land.closingPerPeriod }, dCtx);
    const depD = scheduleWithDisposal({ openingPerPeriod: dep.openingNBVPerPeriod, additionsPerPeriod: dep.additionsPerPeriod, depreciationPerPeriod: dep.depreciationPerPeriod, closingPerPeriod: dep.closingNBVPerPeriod, accumDepPerPeriod: dep.accumDepPerPeriod }, dCtx);
    E.subTitle(`Fixed Assets, ${lineName}`);
    E.moneyRow('Land opening', landD.openingPerPeriod, { indent: 1, prior: ra.land.openingAtAxisStart, noTotal: true });
    E.moneyRow('Land additions', landD.additionsPerPeriod, { indent: 1 });
    if (landD.disposed) E.moneyRow('Land disposed at exit', landD.disposalPerPeriod.map((v) => -v), { indent: 1 });
    E.moneyRow('Land closing', landD.closingPerPeriod, { style: 'subtotal', totalLast: true });
    E.moneyRow('Depreciable opening NBV', depD.openingPerPeriod, { indent: 1, noTotal: true });
    E.moneyRow('Additions', depD.additionsPerPeriod, { indent: 1 });
    E.moneyRow('Depreciation', depD.depreciationPerPeriod, { indent: 1 });
    if (depD.disposed) E.moneyRow('Disposed at exit (net book value)', depD.disposalPerPeriod.map((v) => -v), { indent: 1 });
    E.moneyRow('Depreciable closing NBV', depD.closingPerPeriod, { style: 'subtotal', totalLast: true });
    E.moneyRow('Combined closing (Land + NBV)', landD.closingPerPeriod.map((v, t) => v + (depD.closingPerPeriod[t] ?? 0)), { style: 'total', totalLast: true });
    E.gap();
  }
  const fpt = fa.projectTotals;
  const landTot = scheduleWithDisposal({ ...fpt.land }, dCtx);
  const depTot = scheduleWithDisposal({ openingPerPeriod: fpt.depreciable.openingNBVPerPeriod, additionsPerPeriod: fpt.depreciable.additionsPerPeriod, depreciationPerPeriod: fpt.depreciable.depreciationPerPeriod, closingPerPeriod: fpt.depreciable.closingNBVPerPeriod, accumDepPerPeriod: fpt.depreciable.accumDepPerPeriod }, dCtx);
  E.subTitle('Fixed Assets (project total)');
  E.moneyRow('Land closing', landTot.closingPerPeriod, { indent: 1, totalLast: true });
  E.moneyRow('Depreciation', depTot.depreciationPerPeriod, { indent: 1 });
  if (landTot.disposed || depTot.disposed) E.moneyRow('Disposed at exit (land and net book value)', landTot.disposalPerPeriod.map((v, t) => -(v + (depTot.disposalPerPeriod[t] ?? 0))), { indent: 1 });
  E.moneyRow('Depreciable closing NBV', depTot.closingPerPeriod, { style: 'subtotal', totalLast: true });
  E.moneyRow('Combined closing', landTot.closingPerPeriod.map((v, t) => v + (depTot.closingPerPeriod[t] ?? 0)), { style: 'total', totalLast: true });
  // IDC pool (capitalised construction interest depreciates through D&A).
  const idc = snap.idc;
  if (nz(idc.totalIdcPerPeriod) || nz(idc.idcNbvPerPeriod)) {
    E.gap();
    const idcD = idcWithDisposal(idc, dCtx);
    E.subTitle('IDC Pool (capitalised construction interest)');
    E.moneyRow('Construction interest', idc.totalConstructionInterestPerPeriod, { indent: 1 });
    E.moneyRow('Capitalised to assets', idcD.additionsPerPeriod, { indent: 1 });
    E.moneyRow('IDC depreciation', idcD.depreciationPerPeriod, { indent: 1 });
    if (idcD.disposed) E.moneyRow('Disposed at exit (capitalised interest)', idcD.disposalPerPeriod.map((v) => -v), { indent: 1 });
    E.moneyRow('IDC NBV closing', idcD.closingPerPeriod, { style: 'total', totalLast: true });
  }
  E.gap();

  // ── 2. BS Schedules ──────────────────────────────────────────────────────────
  E.section('2. BS Schedules (balance-sheet feeder roll-forwards, ordered ASSETS / LIABILITIES / EQUITY)');
  for (const grp of buildBSFeederGroups(snap, state)) {
    E.groupBand(grp.group);
    for (const tbl of grp.tables) { E.subTitle(tbl.title); E.emitTable(tbl.rows); E.gap(); }
  }
}

// ── P&L (full detailed mirror via the shared platform row-builder) ────────────
function addProfitLoss(ctx: EmitCtx): void {
  const { wb, snap, state, labelMoney } = ctx;
  const N = snap.axisLength;
  const labels = m4Labels(state);
  // `fmt` stays String so a row's totalOverride round-trips back to a number in
  // emitM4; `labelFmt` is what any figure printed INSIDE a row label uses, so
  // the fund fee rows read "0.50% of Fund size 5,466.8 m" and not a raw float.
  // It follows the workbook display scale, so a full-unit export does not put a
  // millions figure in the label beside a raw figure in the cell.
  const mk = (filterPhaseId: string): M4ReportCtx => ({ snap, state, labels, filterPhaseId, fmt: (v: number) => String(v), labelFmt: labelMoney });
  const ws = wb.addWorksheet(SHEETS.pl, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'P&L', `Full detailed mirror of the platform Module 4 income statement: the consolidated project P&L (to ${labels.pat}), then a per-phase P&L (to ${labels.ebitda}).`, { label: 'Line', feeds: 'The platform income statement (Revenue, Cost of Sales, Opex, depreciation, interest, tax).' });
  const E = makeEmitters(ws, N);
  const hasData = (rows: M4Row[]): boolean => rows.some((rr) => rr.values.some((v) => v !== 0));
  E.section(`${labels.incomeStatementTitle}: Project`);
  E.emitTable(buildPLRows(mk('__all__')));

  // ── Fund Fee Basis (2026-08-05) ────────────────────────────────────────
  //
  // Every fee shows the BASE it is charged on and the RATE applied, so a fee
  // reading zero can be diagnosed instead of guessed at. Columns B and C are
  // the free meta columns on a period sheet, which is what lets this land as
  // a real Base column and Rate column WITHOUT shifting the period axis (it
  // starts at column F and the sub-TOC and print setup depend on that).
  //
  // Rows come from the SAME shared builder the M4 tab and the M5 fee income
  // section render, so the workbook cannot drift from the screen. Empty and
  // skipped entirely when the fund layer is off.
  const basisRows = buildFundFeeBasisRows(snap);
  if (basisRows.length > 0) {
    E.gap();
    E.section('Fund Fee Basis');
    // The three capital bases first, so a reader can add total equity and the
    // debt facility and land on the fund size. The fees below charge on three
    // different quantities, and without this the relationship is implicit.
    //
    // THEY ARE THEIR OWN BLOCK, captioned and tagged. Left unlabelled at the
    // top of the fee table, with Base and Rate empty, their amount sat in the
    // same column that holds a fee charged on the rows below and read as a fee.
    E.subTitle(FUND_CAPITAL_BASES_TITLE);
    for (const c of buildFundCapitalRows(snap)) {
      E.moneyRow(c.isTotal ? `= ${c.label}` : c.label, undefined, { style: c.isTotal ? 'subtotal' : 'plain', totalValue: c.amount, basis: FUND_CAPITAL_BASE_TAG });
    }
    E.note(FUND_CAPITAL_BASES_NOTE);
    // The Rate column was 2 characters wide, so "0.50%" rendered as a sliver
    // and could not overflow (the Total column beside it is never empty). Only
    // widened when the fund block actually renders, so a standalone project
    // keeps its existing geometry.
    //
    // NOT 9. ExcelJS treats 9 as DEFAULT_COLUMN_WIDTH and its isCustomWidth
    // getter is `width !== 9`, so a column set to exactly 9 is dropped from
    // <cols> entirely and the width silently does not apply.
    ws.getColumn(META_C).width = Math.max(ws.getColumn(META_C).width ?? 0, 10);
    setBasis(ws.getCell(E.cursor(), META_B), 'Base');
    setBasis(ws.getCell(E.cursor(), META_C), 'Rate');
    E.moneyRow('What each fee is charged on', undefined, { style: 'subtotal', noTotal: true });
    for (let i = 0; i < basisRows.length; i++) {
      const b = basisRows[i];
      const line = snap.fundFees.lines[i];
      // A base is a STOCK, so the Total column carries the per-period CONSTANT
      // on an annual fee, not the sum of fourteen copies of it (which printed
      // 36,858.3m against a 5,466.8m fund and read as a fault). The basis cell
      // must stay a plain NUMBER for the workbook display scale to reach it,
      // which rules out "2,632.7 x 14" text, so the period count rides on the
      // Base column instead ("Total equity x 14").
      // A FLAT AMOUNT IS ONE ROW. Its basis and its charge are the same
      // quantity (3.0m per period charged on a basis of 3.0m per period), so
      // the pair says the same thing twice. The single row carries the CHARGE,
      // which is the figure that matters, with the base and period count beside
      // it. Rate-based fees keep the pair, where basis and charge differ.
      if (!b.hasRate) {
        const rFlat = E.moneyRow(fundFeeChargedLabel(b), line?.amountPerPeriod, { indent: 1 });
        setBasis(ws.getCell(rFlat, META_B), fundFeeBasisBaseCell(b));
        setBasis(ws.getCell(rFlat, META_C), b.rate);
        continue;
      }
      const rBasis = E.moneyRow(fundFeeBasisLabel(b), line?.basisPerPeriod, { indent: 1, totalValue: b.basisDisplay });
      setBasis(ws.getCell(rBasis, META_B), fundFeeBasisBaseCell(b));
      setBasis(ws.getCell(rBasis, META_C), b.rate);
      const rFee = E.moneyRow(fundFeeChargedLabel(b), line?.amountPerPeriod, { indent: 2 });
      setBasis(ws.getCell(rFee, META_B), b.timing);
    }
    E.moneyRow('Total Fund Management Fee', snap.fundFees.totalPerPeriod, { style: 'total' });
  }

  for (const ph of state.phases) {
    const rows = buildPLRows(mk(ph.id));
    if (!hasData(rows)) continue;
    E.gap(); E.section(`${labels.incomeStatementTitle}: ${ph.name} (to ${labels.ebitda})`);
    E.emitTable(rows);
  }
}

// ── Cash Flow (full detailed mirror: Direct + Indirect + per-phase) ───────────
function addCashFlow(ctx: EmitCtx): void {
  const { wb, snap, state } = ctx;
  const N = snap.axisLength;
  const labels = m4Labels(state);
  const mk = (filterPhaseId: string): M4ReportCtx => ({ snap, state, labels, filterPhaseId, fmt: (v: number) => String(v) });
  const ws = wb.addWorksheet(SHEETS.cashflow, { properties: { tabColor: { argb: ARGB.navy } } });
  // Heading DERIVED from the rows the sheet is about to emit, not typed: the
  // cash flow statement mixes lifetime flows with opening / closing cash, so
  // it resolves to 'Total / Closing'.
  const directRows = buildDirectCFRows(mk('__all__'));
  writeSheetHeader(ws, snap, N, 'Cash Flow', 'Full detailed mirror of the platform Module 4 cash flow: the consolidated Direct and Indirect methods, then a per-phase Direct view (Operations + Investing).', { label: 'Line', totalLabel: totalColumnHeading(directRows), feeds: `The platform cash flow statement. Closing cash reconciles to the Balance Sheet. ${totalColumnNote(directRows)}` });
  const E = makeEmitters(ws, N);
  const hasData = (rows: M4Row[]): boolean => rows.some((rr) => rr.values.some((v) => v !== 0));
  E.section('Cash Flow, Direct Method: Project');
  E.emitTable(directRows);
  E.gap(); E.section('Cash Flow, Indirect Method: Project');
  E.emitTable(buildIndirectCFRows(mk('__all__')));
  for (const ph of state.phases) {
    const rows = buildDirectCFRows(mk(ph.id));
    if (!hasData(rows)) continue;
    E.gap(); E.section(`Cash Flow: ${ph.name} (Operations + Investing)`);
    E.emitTable(rows);
  }
}

// ── Balance Sheet (full detailed mirror; balances by construction) ────────────
function addBalanceSheet(ctx: EmitCtx): void {
  const { wb, snap, state } = ctx;
  const N = snap.axisLength;
  const labels = m4Labels(state);
  const ws = wb.addWorksheet(SHEETS.balsheet, { properties: { tabColor: { argb: ARGB.navy } } });
  // Every row here is a closing balance, so the leading column resolves to
  // 'Closing'. It used to say 'Total', which read as a lifetime sum: TOTAL
  // ASSETS printed the at-exit figure under that heading.
  const bsRows = buildBSRows({ snap, state, labels, filterPhaseId: '__all__', fmt: (v: number) => String(v) }).rows;
  writeSheetHeader(ws, snap, N, 'Balance Sheet', 'Full detailed mirror of the platform Module 4 balance sheet (consolidated). Assets = Liabilities + Equity; the BS-check row is ~0 by construction.', { label: 'Line', totalLabel: totalColumnHeading(bsRows), feeds: `The platform balance sheet. Balances by construction. ${totalColumnNote(bsRows)}` });
  const E = makeEmitters(ws, N);
  E.section('Balance Sheet: Project');
  E.emitTable(bsRows);
}

// ── Returns (NOI, terminal value, FCFF / FCFE, live IRR / NPV / MOIC) ─────────
function addReturns(ctx: EmitCtx, revLinks: RevLinks, opexLinks: OpexLinks, fin: FinLinks): RetLinks {
  void revLinks; void opexLinks; void fin;
  const { wb, snap, lm, state, currency } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.returns, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Returns', 'Full mirror of the platform Module 5 Returns + RE Metrics tabs: 1. Returns (headline IRR / MOIC, development economics, exit analysis, sources & uses, funding mix, equity exposure, debt analytics, returns by basis, cash-flow streams + build-ups), 2. RE Metrics (profitability, leverage, coverage, valuation, per-asset).', { label: 'Line', feeds: 'Sourced from the M4 cash flows + returns engine. The project (FCFF) and equity (FCFE) returns.' });
  let r = 5;
  let rs: ReturnsSnapshot | null = null;
  try { rs = computeReturnsSnapshot(snap, state.project); } catch { rs = null; }

  // ── value formatters (strings, so the display-scale sweep leaves them alone) ──
  const cPct = (v: number | null | undefined, d = 1): string => (v != null && Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : 'n/a');
  const cMoney = (v: number | null | undefined): string => `${currency} ${formatAccounting(v ?? 0, 'millions', 1)} m`;
  const cMult = (v: number | null | undefined): string => (v != null && Number.isFinite(v) ? `${v.toFixed(2)}x` : 'n/a');

  // ── local emitters ──
  const section = (text: string): void => { setSectionHeader(ws.getRow(r), text, lastActiveCol(N), ARGB.accent); r += 1; };
  /** A short explanatory sentence under whatever was just emitted (a footnote,
   *  a basis note). No-op on an empty string, so callers can pass a shared
   *  builder's output straight through without a guard. */
  const note = (text: string): void => {
    if (!text) return;
    setLabel(ws.getCell(r, LBL_COL), text);
    ws.getCell(r, LBL_COL).font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
    r += 2;
  };
  const subTitle = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.subtotal);
    for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    r += 1;
  };
  // KPI card strip: a row of bordered tiles (label over value), 2 columns each,
  // wrapping when the period axis runs out. The headline visual of the platform.
  // `tone: 'bad'` paints the value in the check red. Used for a covenant
  // reading that must not look like one more neutral metric in the strip (a
  // Min DSCR below 1.00x is not covered debt service).
  const kpiStrip = (title: string, cards: Array<{ label: string; value: string; sub?: string; tone?: 'bad' }>): void => {
    subTitle(title);
    const firstCol = OPEN_COL, lastCol = lastActiveCol(N), perCard = 2;
    const hasSub = cards.some((c) => c.sub);
    const h = hasSub ? 3 : 2; // rows per card (label / value [/ sub])
    let col = firstCol;
    for (const card of cards) {
      if (col + perCard - 1 > lastCol) { col = firstCol; r += h + 1; }
      const c2 = col + perCard - 1;
      for (let rr = 0; rr < h; rr++) ws.mergeCells(r + rr, col, r + rr, c2);
      const lc = ws.getCell(r, col); lc.value = card.label; lc.font = { name: 'Calibri', size: 9, bold: true, color: { argb: ARGB.navyDark } }; lc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; fillCell(lc, ARGB.grey);
      const vc = ws.getCell(r + 1, col); vc.value = card.value; vc.font = { name: 'Calibri', size: 12, bold: true, color: { argb: card.tone === 'bad' ? ARGB.bad : ARGB.navy } }; vc.alignment = { horizontal: 'center', vertical: 'middle' };
      if (hasSub) { const sc = ws.getCell(r + 2, col); sc.value = card.sub ?? ''; sc.font = { name: 'Calibri', size: 8, italic: true, color: { argb: ARGB.navyDark } }; sc.alignment = { horizontal: 'center', vertical: 'middle' }; }
      boxBorder(ws, r, col, r + h - 1, c2);
      col = c2 + 1;
    }
    r += h + 1;
  };
  // Scalar money / text row: label in A, value in the Total column (D).
  const scalarRow = (label: string, value: number | string, numFmt: string, bold = false): void => {
    setLabel(ws.getCell(r, LBL_COL), label, { bold });
    const c = ws.getCell(r, TOTAL_COL); c.value = value; c.numFmt = numFmt; c.font = { name: 'Calibri', size: BODY_SIZE, bold, color: { argb: bold ? ARGB.navy : ARGB.formula } };
    r += 1;
  };
  // Generic grid (pre-formatted strings): header[0] + rows[][0] in A, the rest
  // across the period columns from E.
  const gridTable = (title: string, headers: string[], rows: string[][]): void => {
    subTitle(title);
    setColHeader(ws.getCell(r, LBL_COL), headers[0], 'left');
    for (let i = 1; i < headers.length; i++) setColHeader(ws.getCell(r, OPEN_COL + i - 1), headers[i], 'right');
    r += 1;
    for (const cells of rows) {
      setLabel(ws.getCell(r, LBL_COL), cells[0]);
      for (let i = 1; i < cells.length; i++) { const c = ws.getCell(r, OPEN_COL + i - 1); c.value = cells[i]; c.numFmt = '@'; c.alignment = { horizontal: 'right' }; c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
      r += 1;
    }
    r += 1;
  };
  // A money row from an array (label + opening + per-period + Total).
  const moneyRow = (label: string, series: number[] | undefined, opts: { style?: 'plain' | 'subtotal' | 'total'; prior?: number; indent?: number } = {}): void => {
    const vals = (series ?? []).slice(0, N);
    setLabel(ws.getCell(r, LBL_COL), label, { bold: !!(opts.style && opts.style !== 'plain'), indent: opts.indent });
    const put = (c: number, v: number): void => { const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
    put(OPEN_COL, opts.prior ?? 0);
    for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    put(TOTAL_COL, (opts.prior ?? 0) + vals.reduce((s, v) => s + (v ?? 0), 0));
    if (opts.style === 'total') { fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.navy); for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } }; }
    r += 1;
  };
  const statRow = (label: string, cells: string[]): void => {
    setLabel(ws.getCell(r, LBL_COL), label, { indent: 1 });
    for (let t = 0; t < N; t++) { const c = ws.getCell(r, pcol(t)); c.value = cells[t] ?? '-'; c.numFmt = '@'; c.alignment = { horizontal: 'right' }; c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
    r += 1;
  };
  // Fund layer: render one M4Row from the SHARED fund builders. The builders
  // already put every series on the stream basis (index 0 = inception, which
  // lands in the opening column E) and already encode the no-total-on-balances
  // rule as an empty `totalOverride`, so this only has to draw.
  //
  // Deliberately its own emitter rather than an extra branch on `moneyRow`
  // above: that one is shared with the FCFF / FCFE / Distributed Equity stream
  // rows, so widening its style handling would change what a STANDALONE project
  // renders. This is only ever called from the fund block.
  const emitFundM4 = (row: M4Row): number => {
    const used = r;
    const vals = row.values.slice(0, N);
    const prior = row.priorValue ?? 0;
    const style: 'plain' | 'subtotal' | 'total' = row.isTotal ? 'total' : row.isSubtotal ? 'subtotal' : 'plain';
    setLabel(ws.getCell(r, LBL_COL), row.label, { indent: row.indent, bold: style !== 'plain' });
    const put = (c: number, v: number): void => { const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
    put(OPEN_COL, prior);
    for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    // An EMPTY totalOverride means "this is a balance, it has no lifetime
    // total"; anything else round-trips back to a number (the builder's money
    // formatter is String(v) for these rows).
    if (row.totalOverride !== '') {
      const tv = row.totalOverride !== undefined ? Number(row.totalOverride) : prior + vals.reduce((a, v) => a + (v ?? 0), 0);
      put(TOTAL_COL, Number.isFinite(tv) ? tv : 0);
    }
    if (style === 'total') { fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.navy); for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } }; }
    else if (style === 'subtotal') { for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } }; }
    r += 1;
    return used;
  };

  // ── 1. Returns (mirror of the platform Returns tab, in the same order) ───────
  section('1. Returns (IRR / MOIC by basis, dev economics, exit, sources & uses, funding mix, exposure, debt, cash-flow streams)');
  if (rs) {
    const rr = rs.result, de = rs.developmentEconomics, ex = rs.exitAnalysis, su = rs.sourcesUses;
    const ee = rs.equityExposure, da = rs.debtAnalytics, fmx = rs.fundingMix, stb = rs.stabilization, bld = rs.buildup;
    // Signed stream placement: index 0 = inception (opening col), 1..E -> axis.
    const place = (stream: number[] | undefined): { prior: number; vals: number[] } => {
      const s = stream ?? []; const prior = s[0] ?? 0; const vals = new Array<number>(N).fill(0);
      for (let i = 1; i < s.length && i - 1 < N; i++) vals[i - 1] = s[i] ?? 0;
      return { prior, vals };
    };
    const streamRow = (label: string, stream: number[] | undefined, opts: { style?: 'plain' | 'subtotal' | 'total'; indent?: number } = {}): void => { const p = place(stream); moneyRow(label, p.vals, { ...opts, prior: p.prior }); };

    kpiStrip('Headline Returns', [
      { label: 'Project IRR (FCFF)', value: cPct(rr.fcff.irr, 1), sub: `MOIC ${cMult(rr.fcff.moic)}` },
      { label: 'Equity IRR (FCFE)', value: cPct(rr.fcfe.irr, 1), sub: `MOIC ${cMult(rr.fcfe.moic)}` },
      { label: 'Distributed Equity IRR', value: cPct(rr.dividends.irr, 1), sub: `MOIC ${cMult(rr.dividends.moic)}` },
      { label: 'Equity Multiple', value: cMult(rr.realEstate.equityMultiple), sub: 'distributions / invested' },
      { label: 'Total Equity Required', value: cMoney(ee.totalEquityRequired), sub: 'cash + in-kind + existing' },
    ]);
    subTitle('Returns Assumptions');
    scalarRow('Discount rate', rs.config.discountRate, NUMFMT.pct2);
    scalarRow('Exit year', rs.exitYearLabel, NUMFMT.year);
    scalarRow('Terminal value method', String(rs.config.terminalMethod), '@');
    // Only the input the method uses (2026-09-15).
    if (rs.config.terminalMethod === 'exit_multiple') scalarRow('Exit multiple (x stabilised NOI)', rs.config.exitMultiple, NUMFMT.mult);
    if (rs.config.terminalMethod === 'perpetuity') scalarRow('Perpetuity growth', rs.config.perpetuityGrowth, NUMFMT.pct2);
    if (rs.config.terminalMethod === 'cap_rate') {
      const derived = rs.config.capRateSource === 'derived';
      scalarRow(derived ? 'Cap rate (derived from the model)' : 'Cap rate (typed)', derived ? rs.config.capRateDerived : rs.config.capRate, NUMFMT.pct2);
    }
    r += 1;
    kpiStrip('Development Economics', [
      { label: 'Total Development Cost', value: cMoney(de.totalDevelopmentCost), sub: 'incl. land' },
      { label: 'Total Financing Cost', value: cMoney(de.totalFinancingCost), sub: 'all interest over hold' },
      { label: 'Profit Before Financing', value: cMoney(de.profitBeforeFinancing), sub: 'GDV - dev cost' },
      { label: 'Profit After Financing', value: cMoney(de.profitAfterFinancing), sub: '- financing cost' },
    ]);
    kpiStrip(`Exit Analysis (exit ${ex.exitYearLabel})`, [
      { label: 'Exit NOI', value: cMoney(ex.exitNOI) },
      { label: 'Exit EBITDA', value: cMoney(ex.exitEBITDA) },
      { label: 'Debt at Exit', value: cMoney(ex.exitDebt) },
    ]);
    if (rs.exitYears?.length) {
      gridTable('Exit-Year Analysis (hold vs sell timing)', ['Exit Year', 'Enterprise Value', 'Equity Value', 'Project IRR', 'Equity IRR', 'Equity MOIC'],
        rs.exitYears.map((x) => [`${x.exitYearLabel}${x.isSelected ? '  <- selected' : ''}`, cMoney(x.enterpriseValue), cMoney(x.equityValue), cPct(x.fcffIrr, 1), cPct(x.fcfeIrr, 1), cMult(x.equityMoic)]));
    }
    subTitle('Sources & Uses of Capital');
    scalarRow('Sources: Existing Equity', su.existingEquity, NUMFMT.money);
    scalarRow('Sources: New Equity (cash)', su.newEquityCash, NUMFMT.money);
    scalarRow('Sources: In-Kind Equity (land)', su.inKindEquity, NUMFMT.money);
    scalarRow('Sources: Existing Debt', su.existingDebt, NUMFMT.money);
    scalarRow('Sources: New Debt (incl. capitalised IDC)', su.newDebt, NUMFMT.money);
    scalarRow('Sources: Customer Collections / Pre-Sales', su.customerCollections, NUMFMT.money);
    scalarRow('Sources: Operating Cash Generated', su.operatingCash, NUMFMT.money);
    scalarRow('Total Sources', su.totalSources, NUMFMT.money, true);
    scalarRow('Uses: Land', su.land, NUMFMT.money);
    scalarRow('Uses: Construction & Infrastructure', su.construction, NUMFMT.money);
    scalarRow('Uses: IDC Capitalized During Construction', su.idc, NUMFMT.money);
    scalarRow('Uses: Reserves / Distributions', su.reservesDistributions, NUMFMT.money);
    scalarRow('Total Uses', su.totalUses, NUMFMT.money, true);
    r += 1;
    kpiStrip('Funding Mix', [
      { label: 'Debt', value: cPct(fmx.debtPct, 1), sub: '% of total sources' },
      { label: 'Cash Equity', value: cPct(fmx.cashEquityPct, 1), sub: 'existing + new cash' },
      { label: 'In-Kind Equity', value: cPct(fmx.inKindEquityPct, 1), sub: 'contributed land' },
      { label: 'Customer Funding', value: cPct(fmx.customerFundingPct, 1), sub: 'pre-sales collections' },
    ]);
    kpiStrip('Equity Exposure', [
      { label: 'Total Equity Required', value: cMoney(ee.totalEquityRequired) },
      { label: 'Average Equity Invested', value: cMoney(ee.averageEquityInvested) },
      { label: 'Equity at Risk', value: cMoney(ee.equityAtRisk), sub: 'peak cumulative equity' },
      { label: 'Max Negative Cash Flow', value: cMoney(ee.maxNegativeCumulativeCF) },
      { label: 'First Positive CF Year', value: ee.firstPositiveCFYear != null ? String(ee.firstPositiveCFYear) : 'n/a' },
      { label: 'First Dividend Year', value: ee.firstDividendYear != null ? String(ee.firstDividendYear) : 'n/a' },
    ]);
    if (stb.hasIncomeAssets) {
      kpiStrip('Stabilization (income assets)', [
        { label: 'Stabilised NOI', value: cMoney(stb.stabilisedNOI) },
        { label: 'Stabilised Yield on Cost', value: cPct(stb.stabilisedYieldOnCost, 2) },
        { label: 'Stabilization Year', value: stb.stabilizationYear != null ? String(stb.stabilizationYear) : 'n/a' },
      ]);
    }
    kpiStrip('Debt Analytics', [
      { label: 'Peak Debt', value: cMoney(da.peakDebt) },
      { label: 'Average Debt Outstanding', value: cMoney(da.averageDebtOutstanding) },
      { label: 'Remaining Debt at Exit', value: cMoney(da.remainingDebtAtExit) },
      { label: 'Debt Paydown', value: cPct(da.paydownPct, 1) },
      { label: 'Debt Tenor', value: da.tenorYears == null ? 'n/a' : `${da.tenorYears.toFixed(0)} yrs` },
    ]);
    if (rs.partners?.partners.length) {
      gridTable('Equity Partners', ['Partner', 'Invested', 'Share %', 'Dividends', 'Terminal', 'IRR', 'MOIC'],
        rs.partners.partners.map((pn) => [pn.name, cMoney(pn.totalEquityInvested), cPct(pn.shareholdingPct, 1), cMoney(pn.dividendsReceived), cMoney(pn.terminalDistribution), cPct(pn.irr, 1), cMult(pn.moic)]));
    }
    gridTable('Returns by Cash-Flow Basis', ['Basis', 'IRR', 'MOIC', 'Invested', 'Returned', 'Net Profit'], [
      ['FCFF (unlevered project)', cPct(rr.fcff.irr, 1), cMult(rr.fcff.moic), cMoney(rr.fcff.totalOutflow), cMoney(rr.fcff.totalInflow), cMoney(rr.fcff.netProfit)],
      ['FCFE (levered equity)', cPct(rr.fcfe.irr, 1), cMult(rr.fcfe.moic), cMoney(rr.fcfe.totalOutflow), cMoney(rr.fcfe.totalInflow), cMoney(rr.fcfe.netProfit)],
      ['Distributed Equity', cPct(rr.dividends.irr, 1), cMult(rr.dividends.moic), cMoney(rr.dividends.totalOutflow), cMoney(rr.dividends.totalInflow), cMoney(rr.dividends.netProfit)],
    ]);
    subTitle(`Return Cash-Flow Streams (hold to ${rs.exitYearLabel}; inception in the opening column)`);
    streamRow('FCFF (unlevered project)', rs.fcffPerPeriod, { style: 'subtotal' });
    streamRow('FCFE (levered equity)', rs.fcfePerPeriod, { style: 'subtotal' });
    streamRow('Distributed Equity (realized distributions)', rs.dividendStreamPerPeriod, { style: 'subtotal' });
    streamRow('Memo: NOI (recurring)', rs.noiPerPeriod, { indent: 1 });
    r += 1;
    // ROW LISTS COME FROM THE SHARED BUILDER (lib/reports/streamReports.ts),
    // so this tab, the M5 screen, the IC report and the project PDF cannot
    // drift apart again. Style stays local: the total row is a navy band here
    // and a bold row on screen.
    const emitBuildup = (title: string, rows: Array<{ label: string; values: number[]; indent?: number; isTotal?: boolean }>): void => {
      subTitle(title);
      for (const row of rows) streamRow(row.label, row.values, row.isTotal ? { style: 'total' } : { indent: row.indent });
      r += 1;
    };
    emitBuildup('FCFF Build-Up (unlevered, to all capital providers)', buildFcffBuildup(rs, m4StreamRow));
    emitBuildup('FCFE Build-Up (levered, free cash to equity)', buildFcfeBuildup(rs, m4StreamRow));
    emitBuildup('Distributed Equity Build-Up (realized distributions)', buildDividendBuildup(rs, m4StreamRow));
  }
  // Numeric headline metrics (reconcilable constants; feed the Checks tab).
  //
  // THESE READ THE PLATFORM RETURNS ENGINE (`rs`), the same source as the
  // "Returns by Cash-Flow Basis" grid a few rows above. They used to read
  // `lm.*` from liveModel.ts, a second and deliberately simplified model left
  // over from when this workbook emitted live formulas, whose FCFF stream
  // carries no inception outflow and none of the historical development
  // investment. On the reference project that printed Project IRR 177.3% here
  // and 10.9% in the grid overhead, so the tab contradicted itself, and the
  // Summary tab and the Checks tab quoted the wrong one of the two.
  subTitle('Returns Metrics (project + equity)');
  const metricRow = (label: string, v: number, fmt: string): string => {
    setLabel(ws.getCell(r, LBL_COL), label, { bold: true });
    const c = ws.getCell(r, TOTAL_COL); c.value = v; c.numFmt = fmt; c.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navy } };
    const addr = `$${colLetter(TOTAL_COL)}$${r}`; r += 1; return addr;
  };
  const mFcff = rs?.result.fcff, mFcfe = rs?.result.fcfe;
  const fcffIrrCell = metricRow('Project IRR (FCFF, unlevered)', mFcff?.irr ?? 0, NUMFMT.pct2);
  metricRow('Project NPV (FCFF, unlevered)', mFcff?.npv ?? 0, NUMFMT.money);
  metricRow('Project MOIC (FCFF, unlevered)', mFcff?.moic ?? 0, NUMFMT.mult);
  const fcfeIrrCell = metricRow('Equity IRR (FCFE, levered)', mFcfe?.irr ?? 0, NUMFMT.pct2);
  metricRow('Equity NPV (FCFE, levered)', mFcfe?.npv ?? 0, NUMFMT.money);
  metricRow('Equity multiple (FCFE MOIC, levered)', mFcfe?.moic ?? 0, NUMFMT.mult);
  r += 1;

  // ── 2. RE Metrics (mirror of the platform RE Metrics tab) ───────────────────
  if (rs) {
    const re = rs.result.realEstate, de2 = rs.developmentEconomics;
    // How many debt-service years are not covered from operations. A Min DSCR
    // below 1.00x is a covenant reading, so the card carries the count and is
    // painted in the check red rather than sitting neutral beside the IRR.
    const dscrSeries = (re.dscrPerPeriod ?? []).filter((v) => v != null && Number.isFinite(v) && v > 0);
    const dscrDebtYears = dscrSeries.length;
    const dscrUncovered = dscrSeries.filter((v) => v < 1).length;
    section('2. RE Metrics (profitability, yield, leverage, coverage, valuation, per-asset)');
    kpiStrip('Profitability & Yield', [
      { label: 'Yield on Cost', value: cPct(re.yieldOnCost, 2), sub: 'stabilised NOI / cost' },
      { label: 'Cap Rate at Exit', value: cPct(re.capRateAtExit, 2), sub: 'exit NOI / exit value' },
      { label: 'Development Spread', value: cPct(re.developmentSpread, 2), sub: 'yield less cap rate' },
      { label: 'Profit on Cost', value: cPct(re.profitOnCost, 1), sub: '(rev - cost) / cost' },
      { label: 'Profit Margin', value: cPct(re.profitMargin, 1), sub: 'PAT / revenue' },
      { label: 'Equity Multiple', value: cMult(re.equityMultiple), sub: 'distributions / invested' },
    ]);
    kpiStrip('Leverage & Coverage', [
      { label: 'LTV at Exit', value: cPct(re.ltvAtExit, 1), sub: 'debt / exit value' },
      { label: 'Debt Yield', value: cPct(re.debtYield, 1), sub: 'NOI / debt' },
      { label: 'Min DSCR', value: cMult(re.dscrMin), sub: dscrUncovered > 0 ? `${dscrUncovered} of ${dscrDebtYears} yrs below 1.00x` : 'worst period', ...(dscrUncovered > 0 ? { tone: 'bad' as const } : {}) },
      { label: 'Avg DSCR', value: cMult(re.dscrAvg), sub: 'mean over debt years' },
      { label: 'Min Interest Cover', value: cMult(re.icrMin), sub: 'EBITDA / interest' },
      { label: 'Avg Cash-on-Cash', value: cPct(re.cashOnCashAvg, 1), sub: 'cash yield on equity' },
      { label: 'Peak Equity', value: cMoney(re.peakEquity) },
    ]);
    kpiStrip('Development Economics', [
      { label: 'Gross Development Value', value: cMoney(de2.gdv) },
      { label: 'Total Development Cost', value: cMoney(de2.totalDevelopmentCost) },
      { label: 'Total Financing Cost', value: cMoney(de2.totalFinancingCost) },
      { label: 'Profit before Financing', value: cMoney(de2.profitBeforeFinancing) },
      { label: 'Profit after Financing', value: cMoney(de2.profitAfterFinancing) },
      { label: 'Development Margin', value: cPct(de2.developmentMargin, 1), sub: 'profit / GDV' },
      { label: 'Cost to Value', value: cPct(de2.costToValue, 1), sub: 'dev cost / GDV' },
    ]);
    kpiStrip('Valuation & Stabilisation', [
      { label: 'Stabilised NOI', value: cMoney(rs.stabilisedNOI) },
      { label: 'Exit NOI', value: cMoney(rs.exitNOI), sub: `year ${rs.exitYearLabel}` },
      { label: 'Stabilisation Year', value: rs.stabilization.stabilizationYear != null ? String(rs.stabilization.stabilizationYear) : 'n/a' },
      { label: 'Going-in Yield on Cost', value: cPct(re.yieldOnCost, 2) },
      { label: 'Exit Cap Rate', value: cPct(re.capRateAtExit, 2) },
      { label: 'Terminal Enterprise Value', value: cMoney(rs.terminalEnterpriseValue) },
      { label: 'Terminal Equity Value', value: cMoney(rs.terminalEquityValue) },
    ]);
    const nzc = (a?: number[]): boolean => (a ?? []).some((v) => (v ?? 0) !== 0);
    if (nzc(re.dscrPerPeriod) || nzc(re.icrPerPeriod)) {
      subTitle('Coverage Ratios by Year');
      // A year below 1.00x is marked in the cell itself, so the breach is
      // visible in the row a reader actually scans and not only in the tile.
      const dscrRow = r;
      statRow('DSCR', re.dscrPerPeriod.map((v) => (v ? `${v.toFixed(2)}${v < 1 ? ' !' : ''}` : '-')));
      for (let t = 0; t < N; t++) {
        const v = re.dscrPerPeriod[t];
        if (v != null && Number.isFinite(v) && v > 0 && v < 1) {
          ws.getCell(dscrRow, pcol(t)).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.bad } };
        }
      }
      statRow('Interest cover', re.icrPerPeriod.map((v) => (v ? v.toFixed(2) : '-')));
      statRow('Cash-on-cash %', re.cashOnCashPerPeriod.map((v) => (v ? cPct(v, 1) : '-')));
      r += 1;
    }
    if (rs.perAsset?.rows.length) {
      // Zero cost with a 100% margin is structural on an existing operational
      // asset (its cost was spent before the model starts) and on a companion
      // (the cost sits on the parent). Marked and footnoted rather than left as
      // a bare zero, from the SAME shared rule both PDFs use.
      const assetNotes = buildAssetNotes(state, cMoney);
      gridTable('Per-Line Economics', ['Line', 'Strategy', 'Revenue', 'Cost', 'Profit', 'Margin', 'Yield on Cost'],
        poolReturnRows(rs.perAsset.rows, state).map((a) => {
          const z = assetNotes.hasCostNote(a.assetId, a.totalCost);
          const nil = z ? structuralZeroCell(z) : null;
          return [a.assetName, a.strategy, cMoney(a.totalRevenue), nil ?? cMoney(a.totalCost), cMoney(a.profit),
            nil ?? cPct(a.profitMargin, 1), nil ?? (a.isIncomeAsset ? cPct(a.yieldOnCost, 1) : 'n/a')];
        }));
      for (const fn of assetNotes.takeFootnotes()) note(fn.text);
    }
  } else {
    // Fallback when the returns snapshot cannot be computed: keep the signed streams.
    section('2. RE Metrics');
    moneyRow('FCFF (project)', lm.fcff, { style: 'total' });
    moneyRow('FCFE (equity)', lm.fcfe, { style: 'total' });
  }

  // ── 3. Fund Layer (fund layer Step 6, 2026-08-10) ───────────────────────────
  //
  // The M5 fund surface, mirrored: the distribution waterfall in the reference's
  // exact row order, gross vs post-fee returns, and who earns the fees.
  //
  // APPENDED as its own numbered section rather than woven into section 1. The
  // alternative was to interleave it where the screen puts it (waterfall after
  // Development Economics, fee income after Equity Partners), which would mean
  // a section band opening and closing inside "1. Returns" and would renumber
  // RE Metrics on a fund project but not on a standalone one. A trailing
  // section keeps every existing row exactly where it is, and the section sink
  // gives it a Cover ToC entry and a per-tab sub-TOC link for free.
  //
  // The whole block is gated on the snapshot's own `active` flags, so with the
  // fund toggle off nothing here executes and the tab is byte-identical.
  if (rs && isFundActive(rs)) {
    const w = rs.waterfall;
    // TWO contexts, because the two table kinds need different formatting.
    // Period rows go through emitFundM4, which reads `totalOverride` back as a
    // NUMBER, so its money formatter is String(v) (the same round-trip trick
    // the statement tabs use). The string grids and cards are display text, so
    // they get the workbook's scaled formatters.
    const rowsCtx: FundReportCtx = { snap, returns: rs, fmt: { money: (v) => String(v), pct: cPct, mult: cMult } };
    const textCtx: FundReportCtx = { snap, returns: rs, fmt: { money: cMoney, pct: cPct, mult: cMult } };
    section('3. Fund Layer (distribution waterfall, gross vs net returns, fund fee income)');

    kpiStrip('Fund Returns, Gross vs Net', buildFundHeadlineCards(textCtx));
    // These cards restate the headline Distributed Equity pair, split either
    // side of the performance fee. Same shared sentence the PDFs and the M5
    // screen carry, so the three cannot phrase it differently.
    note(fundHeadlineRestatementNote(textCtx));

    // The terms the waterfall was run on. Without them the rows below cannot be
    // checked by eye, and the Inputs tab carries no fund terms.
    subTitle('Fund Terms Applied');
    scalarRow('Hurdle rate (preferred return)', w.hurdleRate, NUMFMT.pct2);
    scalarRow('Performance fee on the excess', w.performanceFeePct, NUMFMT.pct2);
    scalarRow('Fund Manager', resolveFundTerms(state.project).fundManagerName, '@');
    r += 1;

    gridTable('Distributed Equity, Gross vs Net of Performance Fee', [...FUND_GROSS_NET_COLUMNS],
      buildFundGrossNetRows(textCtx).map((g) => g.cells));
    // Two identical rows labelled gross and net read as a copied row rather
    // than as a hurdle that was never cleared, so say which it is. Empty (and
    // therefore skipped) whenever a performance fee actually arises.
    //
    // Written into r-1, the blank separator gridTable just left, so the note
    // sits directly under the table; r += 1 then restores the separator.
    {
      const note = fundGrossNetNote(textCtx);
      if (note) {
        setLabel(ws.getCell(r - 1, LBL_COL), note);
        ws.getCell(r - 1, LBL_COL).font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
        r += 1;
      }
    }

    // The reference row order, from the SHARED builder. The three BALANCE rows
    // carry no lifetime total, which the builder encodes as an empty
    // totalOverride so no surface has to remember the rule.
    subTitle(`Distribution Waterfall (hold to ${rs.exitYearLabel})`);
    for (const row of buildFundWaterfallRows(rowsCtx)) emitFundM4(row);
    // Which of those Total cells are lifetime flows and which are balances.
    // Hurdle Paid's lifetime total sits directly under an untotalled Total
    // Hurdle Owed, so the column reads as more paid than was ever owed.
    note(fundWaterfallTotalsNote(textCtx));
    r += 1;

    // ── Fund Fee Income: who EARNS the fees, beside the equity partners ───────
    if (hasFundFeeIncome(rs)) {
      gridTable('Fund Fee Income by Earner', [...FUND_EARNER_COLUMNS],
        buildFundEarnerRows(textCtx).map((g) => g.cells));

      // What each fee is charged on. SAME shared builder as the P&L tab, the
      // M5 screen and both PDFs, so a reader asking "why is this fee zero"
      // gets one answer wherever they look. Base and Rate use the free meta
      // columns B and C, so the period axis at column F does not shift.
      const basis = buildFundFeeBasisRows(snap);
      if (basis.length > 0) {
        // THE CAPITAL BASES GET THEIR OWN BLOCK. They used to sit at the top of
        // the fee basis table with Base and Rate empty and their amount in the
        // Total column, which on the rows immediately below holds either a
        // basis or a fee charged. Read down the column, "Total equity 2,550.7"
        // then "Fund structure fee: charged 26.9" and the first looks like a
        // fee. They are not fees, they are the quantities the fees are charged
        // on, so they are stated separately and said to be so.
        subTitle(FUND_CAPITAL_BASES_TITLE);
        for (const c of buildFundCapitalRows(snap)) {
          const rc = r;
          moneyRow(c.isTotal ? `= ${c.label}` : c.label, undefined, { indent: c.isTotal ? 0 : 1 });
          ws.getCell(rc, TOTAL_COL).value = c.amount;
          setBasis(ws.getCell(rc, META_B), FUND_CAPITAL_BASE_TAG);
          if (c.isTotal) for (let cc = 1; cc <= lastActiveCol(N); cc++) ws.getCell(rc, cc).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
        }
        note(FUND_CAPITAL_BASES_NOTE);
        subTitle('Fund Fee Basis (what each fee is charged on)');
        // Column captions go on the subtitle band itself, which already carries
        // the bold navy-dark font, so no extra row is spent on a header.
        ws.getCell(r - 1, META_B).value = 'Base';
        ws.getCell(r - 1, META_C).value = 'Rate';
        // Not 9: ExcelJS drops a column whose width equals DEFAULT_COLUMN_WIDTH.
        ws.getColumn(META_C).width = Math.max(ws.getColumn(META_C).width ?? 0, 10);
        for (let i = 0; i < basis.length; i++) {
          const b = basis[i], line = snap.fundFees.lines[i];
          // Same stock-not-flow rule as the P&L block: the Total column holds
          // the per-period CONSTANT on an annual fee, and the period count sits
          // on the Base column because the label column is too narrow for it.
          // A flat amount is ONE row: its basis and its charge are the same
          // quantity. See the P&L block for the reasoning.
          if (!b.hasRate) {
            const rFlat = r; moneyRow(fundFeeChargedLabel(b), line?.amountPerPeriod, { indent: 1 });
            setBasis(ws.getCell(rFlat, META_B), fundFeeBasisBaseCell(b));
            setBasis(ws.getCell(rFlat, META_C), b.rate);
            continue;
          }
          const rB = r; moneyRow(fundFeeBasisLabel(b), line?.basisPerPeriod, { indent: 1 });
          ws.getCell(rB, TOTAL_COL).value = b.basisDisplay;
          setBasis(ws.getCell(rB, META_B), fundFeeBasisBaseCell(b));
          setBasis(ws.getCell(rB, META_C), b.rate);
          const rF = r; moneyRow(fundFeeChargedLabel(b), line?.amountPerPeriod, { indent: 2 });
          setBasis(ws.getCell(rF, META_B), b.timing);
        }
        r += 1;
      }

      subTitle('Fee Income by Period');
      for (const row of buildFundFeeIncomeRows(rowsCtx)) emitFundM4(row);
      r += 1;
    }
  }

  return { fcffIrrCell, fcfeIrrCell, fcffIrr: mFcff?.irr ?? null, fcfeIrr: mFcfe?.irr ?? null };
}

// ── Scenarios (Module 6: case comparison + year-on-year impact) ───────────────
/** Full mirror of the platform Module 6 (Scenario Analysis), built from the SAME
 *  shared case builders that feed the on-screen Module 6 and the PDF export:
 *    1. Cases & Assumptions: every case + the assumptions that differ,
 *    2. Scenario Comparison: headline KPIs per case, delta vs the Management base,
 *    3. Year-on-Year Impact: each changed input and the per-period outputs it
 *       drives, Management vs each scenario.
 *  The statement tabs render the SELECTED case (`ctx.state`); this tab always
 *  compares ALL cases. Every case is computed through the same engine the
 *  platform uses (applyOverrides -> financials -> returns), so it ties exactly.
 *  Degrades to a short note when the project has no scenario cases. */
function addScenarios(ctx: EmitCtx): void {
  const { wb, snap, currency } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.scenarios, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Scenarios', 'Full mirror of the platform Module 6 Scenario Analysis: 1. Cases & Assumptions, 2. Scenario Comparison (headline KPIs per case, delta vs the Management base), 3. Year-on-Year Impact (each changed input and the per-period outputs it drives). The statement tabs render the selected case; this tab always compares ALL cases.', { label: 'Line', feeds: 'Every case is computed through the same engine as the platform (applyOverrides -> financials -> returns). The Management base is the reference column.' });
  let r = 5;

  // Local emitters sharing one row cursor (mirroring the Returns tab).
  const section = (text: string): void => { setSectionHeader(ws.getRow(r), text, lastActiveCol(N), ARGB.accent); r += 1; };
  const subTitle = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.subtotal);
    for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    r += 1;
  };
  // Generic string grid: header[0] + rows[][0] in the label column (A), the rest
  // across from the opening column (E).
  const gridTable = (title: string, headers: string[], rows: string[][]): void => {
    subTitle(title);
    setColHeader(ws.getCell(r, LBL_COL), headers[0], 'left');
    for (let i = 1; i < headers.length; i++) setColHeader(ws.getCell(r, OPEN_COL + i - 1), headers[i], 'right');
    r += 1;
    for (const cells of rows) {
      setLabel(ws.getCell(r, LBL_COL), cells[0]);
      for (let i = 1; i < cells.length; i++) { const c = ws.getCell(r, OPEN_COL + i - 1); c.value = cells[i] ?? ''; c.numFmt = '@'; c.alignment = { horizontal: 'right' }; c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
      r += 1;
    }
    r += 1;
  };
  // A per-period money row (label + opening E + F.. + Total D). kind 'stock' takes
  // the last period as its Total (a running balance); 'flow' sums.
  const periodRow = (label: string, values: number[], prior: number, kind: 'flow' | 'stock', style: 'plain' | 'subtotal' | 'total' = 'plain'): void => {
    const vals = values.slice(0, N);
    setLabel(ws.getCell(r, LBL_COL), label, { bold: style !== 'plain' });
    const put = (c: number, v: number): void => { const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
    put(OPEN_COL, prior);
    for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    put(TOTAL_COL, kind === 'stock' ? (vals[N - 1] ?? 0) : vals.reduce((s, v) => s + (v ?? 0), 0));
    if (style === 'total') { fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.navy); for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } }; }
    else if (style === 'subtotal') { for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } }; }
    r += 1;
  };

  // Build the shared case reports (never throw; degrade to a note).
  let caseReport: CaseComparisonReport | null = null;
  let caseYoY: CaseYoYReport | null = null;
  if (ctx.caseComparison) {
    try { caseReport = buildCaseComparisonReport(ctx.caseComparison); } catch { caseReport = null; }
    try { caseYoY = buildCaseYoYReport(ctx.caseComparison); } catch { caseYoY = null; }
  }
  const cols = caseReport?.columns ?? [];
  const hasScenarios = cols.length > 1;

  // Comparison-matrix value formatters: fixed millions strings, matching the
  // Returns tab (the per-period YoY rows below honour the workbook display scale).
  const cPct = (v: number | null | undefined, d = 1): string => (v != null && Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : 'n/a');
  const cMoney = (v: number | null | undefined): string => `${currency} ${formatAccounting(v ?? 0, 'millions', 1)} m`;
  const cMult = (v: number | null | undefined): string => (v != null && Number.isFinite(v) ? `${v.toFixed(2)}x` : 'n/a');
  const fmtKpi = (v: number | null, kind: CaseKpiKind): string => (v == null || !Number.isFinite(v) ? 'n/a' : kind === 'pct' ? cPct(v, 1) : kind === 'mult' ? cMult(v) : cMoney(v));
  const fmtDelta = (v: number | null, base: number | null, kind: CaseKpiKind): string => {
    if (v == null || base == null || !Number.isFinite(v) || !Number.isFinite(base)) return '';
    const d = v - base; if (Math.abs(d) < 1e-9) return '0';
    const sign = d > 0 ? '+' : '';
    return kind === 'pct' ? `${sign}${(d * 100).toFixed(1)} pp` : kind === 'mult' ? `${sign}${d.toFixed(2)}x` : `${sign}${cMoney(d)}`;
  };

  // ── 1. Cases & Assumptions ───────────────────────────────────────────────────
  section('1. Cases & Assumptions (every case + the assumptions that differ across scenarios)');
  if (cols.length) {
    gridTable('Cases', ['Case', 'Type', 'Active', 'Overrides'],
      cols.map((c) => [c.name, c.role === 'base' ? 'Management (base)' : 'Scenario', c.isActive ? 'Yes' : '', c.role === 'base' ? '-' : (c.overrideCount === 0 ? '0 (same as Management)' : String(c.overrideCount))]));
  }
  if (caseYoY && caseYoY.blocks.length) {
    const order = caseYoY.blocks[0].inputs[0]?.byCase.map((v) => ({ id: v.id, name: v.name })) ?? [];
    if (order.length) {
      const rows: string[][] = [];
      for (const b of caseYoY.blocks) for (const line of b.inputs) {
        const byId = new Map(line.byCase.map((v) => [v.id, v.value] as const));
        rows.push([line.label, ...order.map((o) => formatAssumptionValue(byId.get(o.id) ?? null, line.format))]);
      }
      if (rows.length) gridTable('Assumptions that differ across scenarios', ['Assumption', ...order.map((o) => o.name)], rows);
    }
  }

  // ── 2. Scenario Comparison ──────────────────────────────────────────────────
  if (caseReport && hasScenarios) {
    const rep = caseReport;
    const baseCol = cols.find((c) => c.id === rep.baseId) ?? cols[0];
    section('2. Scenario Comparison (headline KPIs per case, delta vs the Management base)');
    const header = ['Metric', ...cols.map((c) => `${c.role === 'base' ? '* ' : ''}${c.name}`)];
    const rows: string[][] = rep.kpis.map((k) => {
      const cells: string[] = [k.sub ? `${k.label} (${k.sub})` : k.label];
      for (const col of cols) {
        const v = col.values[k.label] ?? null;
        let s = fmtKpi(v, k.kind);
        if (col.id !== rep.baseId) { const d = fmtDelta(v, baseCol.values[k.label] ?? null, k.kind); if (d) s += ` (${d})`; }
        cells.push(s);
      }
      return cells;
    });
    gridTable('Case Comparison, headline KPIs (delta vs Management base)', header, rows);
  }

  // ── 3. Year-on-Year Impact ──────────────────────────────────────────────────
  if (caseYoY && caseYoY.blocks.length && hasScenarios) {
    section('3. Year-on-Year Impact (each changed input and the per-period outputs it drives, Management vs each scenario)');
    for (const b of caseYoY.blocks) {
      for (const o of b.outputs) {
        subTitle(`${b.inputLabel}, ${o.label}`);
        periodRow(`${o.base.name} (base)`, o.base.values, o.base.prior, o.kind, 'subtotal');
        for (const d of o.deltas) periodRow(`change, ${d.name}`, d.values, d.prior, o.kind);
        r += 1;
      }
    }
  }

  // No scenarios defined: a short note so the tab is never blank when present.
  if (!hasScenarios) {
    subTitle('Scenario Analysis');
    setLabel(ws.getCell(r, LBL_COL), 'No scenario cases are defined for this project. Add scenario cases in Module 6 (Scenario Analysis) on the platform to compare assumptions and outcomes here, then re-export.');
    r += 1;
  }
}

// ── Checks / legend ───────────────────────────────────────────────────────────
function addChecks(ctx: EmitCtx, capexAddrs: CapexAddrs, retLinks: RetLinks): void {
  // No `lm`: every check now reconciles the PLATFORM snapshot, which is what
  // this workbook prints. It used to read the liveModel twin, so the tab
  // certified a model the reader never sees.
  const { wb, snap } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.checks, { properties: { tabColor: { argb: ARGB.navy } }, views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 42; ws.getColumn(2).width = 14; ws.getColumn(3).width = 18; ws.getColumn(4).width = 62;
  setTitle(ws.getCell('A1'), 'Checks & Legend', 16);
  let r = 3;
  setSectionHeader(ws.getRow(r), 'Colour legend (FAST)', 4); r += 1;
  { const inp = ws.getCell(`A${r}`); inp.value = 'Input (the assumption a user edits before re-exporting)'; markInput(inp); r += 1; }
  { const fm = ws.getCell(`A${r}`); fm.value = 'Computed value (platform snapshot, hardcoded constant)'; fm.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; r += 1; }
  r += 1;

  setSectionHeader(ws.getRow(r), 'Platform verification snapshot (results as of export)', 4); r += 1;
  ['Check', 'Status', 'Residue', 'Detail'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, 'left')); r += 1;
  // Hardcoded snapshot: each check is the platform's own verification result as
  // of export (a constant), not a live Excel reconciliation.
  //
  // EVERY ROW IS A REAL COMPARISON. Two of the three used to be the string
  // 'OK' with an unrelated magnitude in the note column (closing cash, and
  // total capex printed as though it were a residue, -3,561,517,930 beside a
  // green OK). A check that cannot fail is worse than no check, because it
  // certifies the thing it never looked at.
  //
  // TOLERANCE IS RELATIVE. It was `maxBsDiff < 1`, an absolute one-currency-unit
  // band on a balance sheet of seven billion, i.e. 1.4e-10. No iterative funding
  // solver converges to that, so the workbook reported CHECK on a residue of
  // 5.1e-8 and failed its own integrity test on every real project. `residue`
  // carries the measured gap either way, so a genuine break is still visible
  // and the passing case says how close it actually came.
  const checkRow = (label: string, ok: boolean, residue: number, detail: string): void => {
    setLabel(ws.getCell(`A${r}`), label);
    const s = ws.getCell(`B${r}`); s.value = ok ? 'OK' : 'CHECK'; s.numFmt = '@'; s.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ok ? ARGB.good : ARGB.bad } };
    const c = ws.getCell(`C${r}`); c.value = residue; c.numFmt = NUMFMT.money; c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
    const d = ws.getCell(`D${r}`); d.value = detail; d.numFmt = '@'; d.font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
    r += 1;
  };
  // THE RULE LIVES IN ONE PLACE (lib/reports/checksReport.ts), shared with both
  // PDFs. This tab used to carry its own copy of the tolerance, the worst-
  // divergence scan and the three identities; the PDFs then grew their own,
  // and three copies of a tolerance is how a tolerance drifts.
  //
  // The money formatter stays pinned to millions here so the rendered text is
  // unchanged by this extraction. That pinning is itself inconsistent with the
  // workbook's display scale (a full-unit export prints a residue in units and
  // describes its peak in millions), but changing it is a behaviour change and
  // does not belong in a refactor.
  const checkMoney = (v: number): string => `${formatAccounting(Math.abs(v), 'millions', 1)} m`;
  for (const c of buildIntegrityChecks(snap)) {
    checkRow(c.label, c.ok, c.residue, checkDetail(c, snap.yearLabels, checkMoney));
  }
  // 2026-08-16: cash-basis advisories, as NOTE rather than OK or CHECK. A gap
  // between cash collected and gross sale value is legitimate model state, not
  // a broken identity, so it must not be coloured as a pass or a failure. Only
  // rendered when a divergence exists, which on a fully-collected project is
  // never, so the tab is unchanged for most models.
  for (const a of poolRevenueBasisByLine(buildRevenueBasisAdvisoriesFor(ctx.state.assets, ctx.state.subUnits, snap.revenue), ctx.state)) {
    setLabel(ws.getCell(`A${r}`), `Revenue basis, ${a.assetName}`);
    const s2 = ws.getCell(`B${r}`); s2.value = 'NOTE'; s2.numFmt = '@';
    s2.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    const c2 = ws.getCell(`C${r}`); c2.value = a.collections - a.gross; c2.numFmt = NUMFMT.money;
    c2.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
    const d2 = ws.getCell(`D${r}`); d2.value = revenueBasisAdvisoryText(a, checkMoney); d2.numFmt = '@';
    d2.font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
    r += 1;
  }
  // Option B Step 3 (2026-08-20): a sell asset with no downpayment on itself
  // and no project default. NOTE, not OK or CHECK, for the same reason as the
  // basis advisory above: a missing input is not a broken identity, and a
  // check that cries wolf on correct arithmetic gets ignored.
  for (const a of poolSaleCohortByLine(buildSaleCohortAdvisories(ctx.state.assets, ctx.state.project.saleCohortDefaults?.downpayment, snap.revenue), ctx.state)) {
    setLabel(ws.getCell(`A${r}`), `Downpayment not stated, ${a.assetName}`);
    const s3 = ws.getCell(`B${r}`); s3.value = 'NOTE'; s3.numFmt = '@';
    s3.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    const c3 = ws.getCell(`C${r}`); c3.value = a.saleValue; c3.numFmt = NUMFMT.money;
    c3.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
    const d3 = ws.getCell(`D${r}`); d3.value = saleCohortAdvisoryText(a, checkMoney); d3.numFmt = '@';
    d3.font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
    r += 1;
  }
  r += 1;

  // Linked to the Returns tab cells, with the cached result taken from the SAME
  // engine that wrote them (retLinks carries the value, not just the address),
  // so the link and its cached constant cannot disagree.
  setSectionHeader(ws.getRow(r), 'Headline returns (platform snapshot)', 4); r += 1;
  setLabel(ws.getCell(`A${r}`), 'Project IRR (FCFF, unlevered)');
  setFormula(ws.getCell(`C${r}`), fcell(retLinks.fcffIrrCell, retLinks.fcffIrr ?? 0), NUMFMT.pct2, true); r += 1;
  setLabel(ws.getCell(`A${r}`), 'Equity IRR (FCFE, levered)');
  setFormula(ws.getCell(`C${r}`), fcell(retLinks.fcfeIrrCell, retLinks.fcfeIrr ?? 0), NUMFMT.pct2, true); r += 1;
  r += 1;
  setLabel(ws.getCell(`A${r}`), 'This workbook is a hardcoded mirror of the platform: every figure is the platform-computed snapshot value, written as a constant. The verification results above are the platform\'s own checks as of export, not a live Excel reconciliation. Editing any cell will NOT recalculate; to run a different scenario, change the inputs in the platform and re-export.');
}

// ── Shared cover / summary primitives ─────────────────────────────────────────
// Both front-matter tabs (Cover, Summary) share the same B..G content band on a
// white canvas, a navy banner and navy section bands, so they read as one cover
// set. Column layout: A narrow margin, B..G content, H margin.
function frontMatterCanvas(ws: ExcelJS.Worksheet): void {
  ws.getColumn(1).width = 3;
  for (let c = 2; c <= 7; c++) ws.getColumn(c).width = 17;
  ws.getColumn(8).width = 3;
  fillCell(ws.getCell(1, 1), ARGB.white);
}

/** Navy banner (project name) + a navy-dark sub-band, rows 2-7. Returns the next
 *  free row. */
function frontMatterBanner(ws: ExcelJS.Worksheet, title: string, subtitle: string): number {
  ws.mergeCells('B2:G6');
  const t = ws.getCell('B2');
  t.value = title || 'Untitled Project';
  t.font = { name: 'Calibri', size: 28, bold: true, color: { argb: ARGB.white } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  fillRange(ws, 2, 2, 6, 7, ARGB.navy);
  for (let r = 2; r <= 6; r++) ws.getRow(r).height = 24;
  ws.mergeCells('B7:G7');
  const s = ws.getCell('B7');
  s.value = subtitle;
  s.font = { name: 'Calibri', size: 12, color: { argb: ARGB.white } };
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  fillRange(ws, 7, 2, 7, 7, ARGB.sectionDark);
  ws.getRow(7).height = 22;
  return 9;
}

/** Full-width navy section band across B..G at row r. */
/**
 * A navy band on a front-matter canvas.
 *
 * DELIBERATELY NOT REGISTERED as a section. Registering these was tried and
 * reverted: every section link in the workbook is an `!A<row>` anchor and the
 * invariant is that column A of that row holds the section title, but a
 * front-matter canvas keeps column A as a 3-wide margin and paints its bands
 * across B..G. Registering them therefore produced links landing on a row whose
 * column A is empty, breaking the anchor rule for the whole workbook to gain
 * three Cover entries. The Summary is a one-page executive summary that is read
 * top to bottom, so it loses nothing by not being sub-indexed.
 */
function frontMatterBand(ws: ExcelJS.Worksheet, r: number, text: string): void {
  ws.mergeCells(r, 2, r, 7);
  const c = ws.getCell(r, 2);
  c.value = text;
  c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: ARGB.white } };
  c.alignment = { vertical: 'middle', indent: 1 };
  fillRange(ws, r, 2, r, 7, ARGB.navy);
  ws.getRow(r).height = 18;
}

// ── Cover / Table of Contents ─────────────────────────────────────────────────
/** De-duplicate captured sections by title (keeping the first row), so a repeated
 *  band label (e.g. ASSETS on two schedules) lists once in the ToC. */
function dedupSections(secs: Array<{ title: string; row: number }>): Array<{ title: string; row: number }> {
  const seen = new Set<string>();
  const out: Array<{ title: string; row: number }> = [];
  for (const s of secs) { const key = s.title.trim(); if (key && !seen.has(key)) { seen.add(key); out.push(s); } }
  return out;
}

/** The module-grouped tab list, shared by the Cover ToC and the Guide tab so the
 *  two never drift. Excludes the Cover + Guide themselves. */
type TocEntry = { group: string } | { sheet: string; desc: string };
const MODULE_TOC: TocEntry[] = [
  { sheet: SHEETS.summary, desc: 'One-page executive summary: key facts, headline metrics and financial highlights' },
  { group: 'Module 1  ·  Setup, Costs & Financing' },
  { sheet: SHEETS.assumptions, desc: 'All model inputs, consolidated and grouped by type' },
  { sheet: SHEETS.timeline, desc: 'The model year axis' },
  { sheet: SHEETS.landArea, desc: 'Area hierarchy (NSA / BUA / GFA) and land value' },
  { sheet: SHEETS.capex, desc: 'Development cost build-up and phased schedule' },
  { sheet: SHEETS.financing, desc: 'Depreciation, interest, tax, debt + equity and the cash recurrence' },
  { group: 'Module 2  ·  Revenue & Cost of Sales' },
  { sheet: SHEETS.revenue, desc: 'Inputs, Output, Cost of Sales, Schedules and Escrow' },
  { group: 'Module 3  ·  Operating Expenses' },
  { sheet: SHEETS.opex, desc: 'Operating expenses by asset and category' },
  { group: 'Module 4  ·  Financial Statements' },
  { sheet: SHEETS.schedules, desc: 'Fixed Assets, IDC Pool and Working Capital' },
  { sheet: SHEETS.pl, desc: 'Profit and loss (income statement)' },
  { sheet: SHEETS.cashflow, desc: 'Cash flow statement (Direct + Indirect)' },
  { sheet: SHEETS.balsheet, desc: 'Balance sheet (balances by construction)' },
  { group: 'Module 5  ·  Returns' },
  { sheet: SHEETS.returns, desc: 'IRR, NPV and equity multiple (FCFF / FCFE) + RE metrics' },
  { group: 'Module 6  ·  Scenario Analysis' },
  { sheet: SHEETS.scenarios, desc: 'Case comparison and year-on-year impact' },
  { group: 'Reference' },
  { sheet: SHEETS.checks, desc: 'Integrity checks and colour legend' },
];

function buildCoverContent(ws: ExcelJS.Worksheet, snap: ReturnType<typeof computeFinancialsSnapshot>, opts: BuildModelOptions, sectionReg: Map<string, Array<{ title: string; row: number }>>): void {
  const p = opts.state.project;
  const currency = p.currency ?? 'SAR';
  frontMatterCanvas(ws);
  let r = frontMatterBanner(ws, opts.projectName, 'Real Estate Financial Model  ·  Excel  ·  Hardcoded platform snapshot');

  // Slim identity strip (a single line): date · currency · location · horizon,
  // plus a FUND LAYER marker when the toggle is on. The fund sections were only
  // ever reachable as nested bullets under P&L and Returns, so a reader
  // scanning the numbered tab list had nothing telling them this model carries
  // a fund at all. Absent on a standalone project.
  const identity = [
    opts.dateLabel,
    currency,
    [p.location, p.country].filter(Boolean).join(', ') || null,
    `${snap.axisLength}-year horizon (${snap.projectStartYear} to ${snap.projectStartYear + snap.axisLength - 1})`,
    snap.fundFees.active ? 'Fund layer active' : null,
  ].filter(Boolean).join('   ·   ');
  ws.mergeCells(r, 2, r, 7);
  const idc = ws.getCell(r, 2); idc.value = identity; idc.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.navyDark } }; idc.alignment = { indent: 1 };
  r += 2;

  // Table of contents, grouped by module. Group rows are navy-dark bands; each
  // sheet is a numbered, hyperlinked row with a description. Only sheet rows are
  // numbered, so the count reads as the deliverable page list.
  frontMatterBand(ws, r, 'Table of Contents'); r += 1;
  // Guide leads the list, then the shared module-grouped tabs.
  const toc: TocEntry[] = [
    { sheet: SHEETS.guide, desc: 'How the model works: what each tab covers and how every figure is calculated' },
    ...MODULE_TOC,
  ];
  const tocTop = r;
  let num = 0, zebra = 0;
  for (const e of toc) {
    if ('group' in e) {
      ws.mergeCells(r, 2, r, 7);
      const gc = ws.getCell(r, 2); gc.value = e.group;
      gc.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } };
      gc.alignment = { indent: 1 };
      fillRange(ws, r, 2, r, 7, ARGB.sectionDark);
      zebra = 0; r += 1; continue;
    }
    num += 1;
    const nc = ws.getCell(r, 2);
    nc.value = { text: `${num}.  ${e.sheet}`, hyperlink: `#'${e.sheet}'!A1` };
    nc.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navy }, underline: true };
    nc.alignment = { indent: 1 };
    ws.mergeCells(r, 3, r, 7);
    const dc = ws.getCell(r, 3); dc.value = e.desc; dc.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
    if (zebra % 2 === 1) fillRange(ws, r, 2, r, 7, ARGB.grey);
    zebra += 1; r += 1;
    // Second-level ToC (Option B): every section of this tab, clickable, jumping
    // INTO the section row inside the tab. Capped so a very rich tab stays tidy.
    // Capped so a very rich tab stays tidy, but FUND sections are never the
    // ones dropped: they sit at the end of both the P&L and the Returns tab, so
    // a plain slice would silently push the whole fund layer off the contents
    // of exactly the projects that have one.
    const secs = dedupSections(sectionReg.get(e.sheet) ?? []);
    const isFundSec = (t: string): boolean => /fund/i.test(t);
    const shown = secs.length <= 14 ? secs : [...secs.slice(0, 14), ...secs.slice(14).filter((s) => isFundSec(s.title))];
    for (const sec of shown) {
      const bullet = ws.getCell(r, 2); bullet.value = '›'; bullet.font = { name: 'Calibri', size: 8.5, color: { argb: ARGB.greyMid } }; bullet.alignment = { horizontal: 'right' };
      ws.mergeCells(r, 3, r, 7);
      const sc = ws.getCell(r, 3);
      sc.value = { text: sec.title, hyperlink: `#'${e.sheet}'!A${sec.row}` };
      sc.font = { name: 'Calibri', size: 8.5, color: { argb: ARGB.navy }, underline: true };
      sc.alignment = { indent: 3 };
      r += 1;
    }
    if (secs.length > shown.length) {
      ws.mergeCells(r, 3, r, 7);
      const mc = ws.getCell(r, 3); mc.value = `… and ${secs.length - shown.length} more section${secs.length - shown.length === 1 ? '' : 's'} in this tab`;
      mc.font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } }; mc.alignment = { indent: 3 };
      r += 1;
    }
  }
  boxBorder(ws, tocTop, 2, r - 1, 7);
  r += 1;

  // Colour legend (navy-pale input, black computed, deep-navy section, navy total).
  setLabel(ws.getCell(r, 2), 'Legend:', { bold: true });
  const inputSwatch = ws.getCell(r, 3); inputSwatch.value = 'Input'; markInput(inputSwatch); inputSwatch.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
  const fmSwatch = ws.getCell(r, 4); fmSwatch.value = 'Computed'; fmSwatch.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.formula } };
  const secSwatch = ws.getCell(r, 5); secSwatch.value = 'Section'; fillCell(secSwatch, ARGB.accent); secSwatch.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } };
  const totSwatch = ws.getCell(r, 6); totSwatch.value = 'Total'; fillCell(totSwatch, ARGB.navy); totSwatch.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } };
  r += 2;
  const foot = ws.getCell(r, 2); foot.value = 'Financial Modeler Pro  ·  financialmodelerpro.com'; foot.font = { name: 'Calibri', size: 9, color: { argb: ARGB.navyDark } };
}

// ── Guide tab (a dedicated, consolidated "how the model works" reference) ───────
/** The Guide is tab 2: an at-a-glance, module-grouped reference explaining what
 *  every tab covers and how each figure is calculated. Each tab heading links to
 *  the tab. Content is shared with the per-tab bottom blocks (TAB_GUIDES), so the
 *  two never drift. Built in the post-pass so the "Covers" lines can list the
 *  sections actually captured during the build. */
function buildGuideContent(ws: ExcelJS.Worksheet, snap: ReturnType<typeof computeFinancialsSnapshot>, opts: BuildModelOptions, sectionReg: Map<string, Array<{ title: string; row: number }>>): void {
  void snap;
  frontMatterCanvas(ws);
  let r = frontMatterBanner(ws, 'Model Guide', 'How this model works  ·  what each tab covers  ·  how every figure is calculated');

  ws.mergeCells(r, 2, r, 7);
  const intro = ws.getCell(r, 2);
  intro.value = 'This workbook is a hardcoded snapshot of the platform: every figure is a computed value written as a constant, so editing a cell does NOT recalculate. To run a different scenario, change the inputs in the platform and re-export. Navy-pale cells are inputs; everything else is computed. The tabs follow the platform module order, and each tab also carries this guidance at its foot.';
  intro.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.navyDark } };
  intro.alignment = { wrapText: true, vertical: 'top', indent: 1 };
  ws.getRow(r).height = 56;
  r += 2;

  // Colour legend (matches the Cover).
  setLabel(ws.getCell(r, 2), 'Legend:', { bold: true });
  const inSw = ws.getCell(r, 3); inSw.value = 'Input'; markInput(inSw); inSw.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
  const fmSw = ws.getCell(r, 4); fmSw.value = 'Computed'; fmSw.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.formula } };
  const seSw = ws.getCell(r, 5); seSw.value = 'Section'; fillCell(seSw, ARGB.accent); seSw.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } };
  const toSw = ws.getCell(r, 6); toSw.value = 'Total'; fillCell(toSw, ARGB.navy); toSw.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } };
  r += 2;

  for (const e of MODULE_TOC) {
    if ('group' in e) {
      ws.mergeCells(r, 2, r, 7);
      const gc = ws.getCell(r, 2); gc.value = e.group;
      gc.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } };
      gc.alignment = { indent: 1 };
      fillRange(ws, r, 2, r, 7, ARGB.sectionDark);
      r += 1; continue;
    }
    // Tab heading (hyperlinked to the tab) on a pale band.
    ws.mergeCells(r, 2, r, 7);
    const tc = ws.getCell(r, 2);
    tc.value = { text: e.sheet, hyperlink: `#'${e.sheet}'!A1` };
    tc.font = { name: 'Calibri', size: 11, bold: true, color: { argb: ARGB.navy }, underline: true };
    tc.alignment = { indent: 1 };
    fillRange(ws, r, 2, r, 7, ARGB.subtotal);
    r += 1;
    // Covers line (the tab's sections).
    const secs = dedupSections(sectionReg.get(e.sheet) ?? []);
    if (secs.length) {
      ws.mergeCells(r, 2, r, 7);
      const cc = ws.getCell(r, 2);
      cc.value = `Covers:  ${secs.map((s) => s.title).slice(0, 12).join('  ·  ')}${secs.length > 12 ? '  ·  …' : ''}`;
      cc.font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
      cc.alignment = { wrapText: true, vertical: 'top', indent: 1 };
      ws.getRow(r).height = 24;
      r += 1;
    }
    // Methodology, labelled Inputs / Calculation / Feeds (same content as the
    // per-tab block at the bottom of each sheet, so the two never drift).
    const GLABEL: Record<GuideLine['kind'], string> = { inputs: 'Inputs', logic: 'Calculation', feeds: 'Feeds' };
    for (const line of (TAB_GUIDES[e.sheet] ?? [])) {
      const lc = ws.getCell(r, 2);
      lc.value = GLABEL[line.kind];
      lc.font = { name: 'Calibri', size: 8.5, bold: true, color: { argb: ARGB.sectionDark } };
      lc.alignment = { vertical: 'top', indent: 1 };
      ws.mergeCells(r, 3, r, 7);
      const bc = ws.getCell(r, 3); bc.value = line.text;
      bc.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
      bc.alignment = { wrapText: true, vertical: 'top', indent: 1 };
      ws.getRow(r).height = Math.max(16, Math.ceil(line.text.length / 88) * 14);
      r += 1;
    }
    r += 1; // gap before the next tab
  }
  const foot = ws.getCell(r, 2); foot.value = 'Financial Modeler Pro  ·  financialmodelerpro.com'; foot.font = { name: 'Calibri', size: 9, color: { argb: ARGB.navyDark } };
}

// ── Per-tab guidance: a "Covers" subtitle + a "How this tab is calculated" block ─

/**
 * Plain-language methodology per tab, structured so a reader of the HARDCODED
 * workbook can reconstruct how the model actually works without a live formula:
 *
 *   Inputs   what this tab consumes, and which tab those inputs come from
 *   Logic    the actual formulas / mechanics the engine applies, in order
 *   Feeds    where the tab's outputs land downstream (which statement lines)
 *
 * The per-row "Basis / Calculation" column carries the same intent line by line;
 * this block is the tab-level summary. Content mirrors the real engine, so if the
 * mechanics change, this text changes with them. Keyed by the SHEETS.* tab name.
 */
type GuideLine = { kind: 'inputs' | 'logic' | 'feeds'; text: string };
const G = (kind: GuideLine['kind'], text: string): GuideLine => ({ kind, text });

const TAB_GUIDES: Record<string, GuideLine[]> = {
  [SHEETS.summary]: [
    G('inputs', 'Reads finished figures only, from Returns (IRR / MOIC / equity multiple), Capex (total development cost), Revenue (GDV) and Financing (peak debt, funding mix).'),
    G('logic', 'Nothing is re-derived here. Development margin = profit after financing / GDV; cost to value = total development cost / GDV; the leverage line is peak debt over total sources.'),
    G('feeds', 'Nothing downstream. This is the read-out: the one page to hand over when the detail is not needed.'),
  ],
  [SHEETS.assumptions]: [
    G('inputs', 'This IS the input tab. Every assumption in the model, grouped by domain: project and phases, land and parcels, assets and sub-units, returns, capex lines, financing facilities, revenue and opex.'),
    G('logic', 'Nothing is computed here. Input cells carry the navy-pale FAST shading so an assumption is never mistaken for a result.'),
    G('feeds', 'Every other tab. Each calculated figure in the workbook traces back to a cell on this tab; change one in the platform and re-export to see the effect flow through.'),
  ],
  [SHEETS.timeline]: [
    G('inputs', 'Project start date and model type, plus each phase\'s start date, construction periods, operations periods and overlap periods.'),
    G('logic', 'Period 0 is the opening column (Dec of the year before start); periods 1..N are the active years. Construction runs from the phase start for its construction periods; operations begin the day after construction ends, pulled forward by any overlap periods, and run for the operations periods. Project end is the latest operations end across all phases.'),
    G('feeds', 'Every statement tab keys its period columns to this axis, so all tabs share one timeline and one period index.'),
  ],
  [SHEETS.landArea]: [
    G('inputs', 'Per asset: land area, land rate, the area basis (NSA / BUA / GFA) and the efficiency ratios between them, sale price for for-sale assets, and the sub-unit schedule.'),
    G('logic', 'Area build-up per asset: NSA -> BUA -> GFA applying each asset\'s efficiency ratios. Land value = land area x land rate. GDV (for-sale assets) = saleable area x sale price. Unit counts roll up from the sub-units. The Basis / Calculation legend on the tab gives the exact derivation column by column.'),
    G('feeds', 'BUA / GFA / NSA are the quantity bases for the per-sqm Capex lines; GDV is the revenue base for Sell assets; land value feeds the Capex land line and the Balance Sheet land asset.'),
  ],
  [SHEETS.capex]: [
    G('inputs', 'Cost lines with their rate, method and phasing profile (from Inputs), and the area / unit quantities from Land & Area.'),
    G('logic', 'Each line = Rate x Quantity, where the quantity follows the line\'s method: per sqm (BUA / GFA / NSA), per unit, a percentage (of land, revenue or construction cost), or a lump sum. Percentage-of lines resolve after their base so the order of calculation is stable. Each line is then spread across its construction periods by the S-curve or the manual profile, so the per-period allocation always sums to 100% of the line total.'),
    G('feeds', 'Four cost bases are published (incl. all land, excl. in-kind land, excl. all land) so each downstream tab picks the right one: the funding requirement in Financing, Cost of Sales in Revenue, fixed-asset additions in Schedules, and cash from investing in the Cash Flow.'),
  ],
  [SHEETS.financing]: [
    G('inputs', 'Phased capex from Capex, the collections profile from Revenue, opex from Opex, and per-facility terms from Inputs (limit, rate, tenor, fees, repayment) plus the funding method, equity structure, minimum cash reserve and dividend policy.'),
    G('logic', 'The computational engine of the model. Funding requirement per period = capex + interest during construction (IDC). Debt is drawn to the funding gap each period under the selected funding method; interest accrues on the drawn balance and is capitalised into IDC during construction, then expensed once operations begin. Equity funds the residual requirement. After debt service the cash waterfall runs operations -> debt (sweep) -> dividend -> closing cash, never breaching the minimum cash reserve. Depreciation is straight-line over each asset\'s useful life.'),
    G('feeds', 'Interest expense and depreciation to the P&L; drawdowns, repayments, interest paid and dividends to the Cash Flow financing block; debt outstanding and equity to the Balance Sheet; the debt and equity streams to the FCFE bridge in Returns.'),
  ],
  [SHEETS.revenue]: [
    G('inputs', 'Per asset: strategy (Sell / Operate / Lease), GDV or stabilised rate and quantity from Land & Area, the sales / handover curve, occupancy and ADR ramps, escrow percentage and release trigger, and the DSO collection terms.'),
    G('logic', 'Recognition follows the strategy. For-sale (Sell) recognises GDV on handover along the sales curve, using the cohort (vintage) matrix of sale year against recognition year. Operate / Lease recognise stabilised annual revenue (rate x quantity) ramped by occupancy. Cost of Sales releases the land + construction cost against for-sale recognition on the same cohort basis, so margin is matched period by period. Escrow withholds a percentage of collections until handover and releases it after, which is what separates recognised revenue from cash collected.'),
    G('feeds', 'Revenue and Cost of Sales to the P&L; collections (net of escrow) to the Cash Flow operating block; receivables, inventory, unearned revenue and the escrow balance to the Balance Sheet via the Schedules feeders.'),
  ],
  [SHEETS.opex]: [
    G('inputs', 'Per asset and HQ: opex lines by category with their rate, basis and inflation, plus the driving quantity (area, keys, or revenue) and the operating window from the Timeline.'),
    G('logic', 'Each line = rate x quantity, where the rate is per sqm, per key, or a percentage of revenue, inflated each year from its start year. Lines only run while the asset is operating. Asset opex and head-office / G&A are kept separate so a phase view can show asset-level margin.'),
    G('feeds', 'Total opex is the deduction between revenue and EBITDA in the P&L, and opex paid (after any accrual timing) is the operating outflow in the Cash Flow.'),
  ],
  [SHEETS.schedules]: [
    G('inputs', 'Capex additions, revenue recognition and collections, opex, tax, and the debt / interest schedule from Financing.'),
    G('logic', 'The Module 4 feeder schedules, each a roll-forward of the form opening + movement = closing. Fixed Assets: opening + additions - depreciation = closing net book value, with land held separately (land never depreciates). Working capital: receivables (operating via DSO, residential via the milestone schedule), payables via DPO, inventory (work in progress from Cost of Sales), unearned revenue, and the escrow balance. The IDC pool accumulates capitalised interest during construction and releases it into the asset base.'),
    G('feeds', 'Every closing balance is a Balance Sheet line, and every movement is the corresponding working-capital adjustment in the Indirect Cash Flow.'),
  ],
  [SHEETS.pl]: [
    G('inputs', 'Recognised revenue and Cost of Sales from Revenue, total opex from Opex, depreciation and interest expense from Financing, and the tax rate from Inputs.'),
    G('logic', 'Revenue - Cost of Sales - Operating Expenses = EBITDA. EBITDA - Depreciation and Amortisation = EBIT. EBIT - Interest and financing cost = Profit before Tax. PBT - Tax = PAT (net income). The phase views stop at EBITDA, because depreciation, interest and tax are financed and taxed at project level, not per phase.'),
    G('feeds', 'PAT is the starting line of the Indirect Cash Flow and the movement in Balance Sheet retained earnings; EBITDA feeds the DSCR and debt-yield covenants in Returns.'),
  ],
  [SHEETS.cashflow]: [
    G('inputs', 'Collections and escrow from Revenue, opex paid from Opex, capex from Capex, tax from the P&L, and drawdowns / repayments / interest / dividends from Financing.'),
    G('logic', 'Two methods, both published. Direct: cash collected, less cash paid (opex, head office, tax), = cash from operations; less capex = cash from investing; plus equity and debt drawn, less repayment, interest and dividends = cash from financing. Net change in cash, added to opening, gives closing cash. Indirect: PAT, plus non-cash items (depreciation, interest add-back, Cost of Sales), plus or minus the working-capital movements from Schedules. The two are computed independently and must agree.'),
    G('feeds', 'Closing cash is the Balance Sheet cash line, and is the single source of truth both methods reconcile to. The Checks tab asserts Direct equals Indirect in every period.'),
  ],
  [SHEETS.balsheet]: [
    G('inputs', 'Closing balances from every Schedules feeder, closing cash from the Cash Flow, debt from Financing, and share capital plus retained earnings from the equity roll-forward.'),
    G('logic', 'Assets (cash, escrow restricted cash, receivables, inventory, fixed assets, land) = Liabilities (payables, unearned revenue, debt) + Equity (share capital, statutory reserve, retained earnings). The sheet balances by construction every period, because each side is assembled from the same roll-forwards rather than being plugged.'),
    G('feeds', 'Nothing downstream: this is the closing position. Total equity and debt outstanding feed the leverage and LTV metrics in Returns.'),
  ],
  [SHEETS.returns]: [
    G('inputs', 'The cash-flow streams (cash from operations and investing from the Cash Flow, debt and equity movements from Financing), the terminal-value assumptions, and the discount rate from Inputs.'),
    G('logic', 'Three bases. FCFF (unlevered project) = cash from operations + cash from investing, plus terminal enterprise value at exit. FCFE (levered equity) layers in debt drawn, less interest and principal, plus terminal equity value. Distributed equity (DDM) uses the cash actually paid out under the sweep and dividend policy. Each stream yields IRR (the rate where NPV is zero), MOIC (inflows / outflows) and NPV at the discount rate. Terminal value is exit multiple or perpetuity growth as selected. RE metrics: yield on cost, cap rate at exit, DSCR, debt yield, and LTV at peak debt.'),
    G('feeds', 'The headline metrics on the Summary tab and the KPI matrix on Scenarios.'),
  ],
  [SHEETS.scenarios]: [
    G('inputs', 'The Management base case plus every override case defined in the platform, and the full engine output for each.'),
    G('logic', 'Each case is a complete re-run of the engine with its overrides applied to a copy of the base (the base is never mutated). The comparison matrix shows each case\'s headline KPIs with the delta against base; the year-on-year impact section shows each changed input alongside the per-period outputs it drives.'),
    G('feeds', 'Nothing downstream. The statement tabs in this workbook are the Management base case unless a different case was chosen at export.'),
  ],
  [SHEETS.checks]: [
    G('inputs', 'The assembled statements: Balance Sheet totals, both Cash Flow methods, and the platform snapshot values.'),
    G('logic', 'Integrity assertions, each a difference that must be zero: total assets less total liabilities and equity; Direct closing cash less Indirect closing cash; and each statement total against the platform snapshot it was exported from.'),
    G('feeds', 'Nothing. This tab is the audit trail: if every check reads zero, the workbook is internally consistent and ties to the platform.'),
  ],
};

/** Add the navigation + guidance layer to every data tab: a "Covers" line on the
 *  subtitle row (where the tab has one) and a "How this tab is calculated" block
 *  appended at the BOTTOM (so the frozen header + every data row are untouched).
 *  Runs after the section sink is cleared, so its own header does not register. */
function applyTabGuides(wb: ExcelJS.Workbook, sectionReg: Map<string, Array<{ title: string; row: number }>>): Map<string, number> {
  // Tabs whose row-2 subtitle can safely become a "Covers" line.
  const A2_COVERS = new Set<string>([SHEETS.landArea, SHEETS.capex, SHEETS.financing, SHEETS.revenue, SHEETS.opex, SHEETS.schedules, SHEETS.pl, SHEETS.cashflow, SHEETS.balsheet, SHEETS.returns, SHEETS.scenarios]);
  const LABEL: Record<GuideLine['kind'], string> = { inputs: 'Inputs', logic: 'Calculation', feeds: 'Feeds' };
  /** Row of each tab's guide-block header, so the sub-TOC can link straight to it. */
  const guideRows = new Map<string, number>();

  for (const sheet of Object.keys(TAB_GUIDES)) {
    const ws = wb.getWorksheet(sheet); if (!ws) continue;
    const secs = dedupSections(sectionReg.get(sheet) ?? []);
    const shown = secs.map((s) => s.title).slice(0, 10);
    const coversLine = shown.length ? `Covers: ${shown.join('  ·  ')}${secs.length > shown.length ? '  ·  …' : ''}` : '';

    if (coversLine && A2_COVERS.has(sheet)) setLabel(ws.getCell('A2'), coversLine);

    let r = (ws.rowCount || 1) + 2;
    guideRows.set(sheet, r);
    setSectionHeader(ws.getRow(r), 'How this tab is calculated', 10); r += 1;
    if (coversLine) {
      ws.mergeCells(r, 1, r, 10);
      const cc = ws.getCell(r, 1); cc.value = coversLine;
      cc.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
      cc.alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(r).height = 26; r += 1;
    }
    // Inputs / Calculation / Feeds, each a labelled row: the label column reads
    // as a mini table of the tab's mechanics rather than an undifferentiated
    // bullet list, so a reader can find "what does this feed" at a glance.
    for (const line of TAB_GUIDES[sheet]) {
      const lc = ws.getCell(r, 1);
      lc.value = LABEL[line.kind];
      lc.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } };
      lc.alignment = { vertical: 'top', indent: 1 };
      fillCell(lc, ARGB.navy);
      ws.mergeCells(r, 2, r, 10);
      const c = ws.getCell(r, 2); c.value = line.text;
      c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.navyDark } };
      c.alignment = { wrapText: true, vertical: 'top', indent: 1 };
      fillCell(c, ARGB.subtotal);
      // ~150 chars fit per line across the merged B:J band at this width.
      ws.getRow(r).height = Math.max(16, Math.ceil(line.text.length / 150) * 14 + 4);
      r += 1;
    }
    ws.mergeCells(r, 1, r, 10);
    const note = ws.getCell(r, 1);
    note.value = 'This workbook is a hardcoded snapshot; cells do not recalculate. Change inputs in the platform and re-export to run a scenario.';
    note.font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
    note.alignment = { wrapText: true, vertical: 'top' };
  }
  return guideRows;
}

// ── Per-tab sub-TOC (top-of-tab navigation) ───────────────────────────────────
/**
 * Reserve a compact navigation strip at the top of every data tab: the tab's own
 * sections as internal hyperlinks, a link straight to the "How this tab is
 * calculated" block (which otherwise sits hundreds of rows down), and a
 * "Back to Cover" link.
 *
 * Runs as a POST-PASS over finished sheets and inserts rows via `insertRowsAt`,
 * rather than threading a row offset through fourteen tab builders. Everything
 * below the insert point shifts down, so the caller's section registry + guide
 * rows are re-based here and the Cover (built afterwards) links to the corrected
 * rows. The insert point is just below each tab's frozen header, so the frozen
 * title / period-header rows and every cross-sheet reference into them (the
 * Timeline axis at rows 3-4) are untouched.
 */
function applyTabSubToc(
  wb: ExcelJS.Workbook,
  sectionReg: Map<string, Array<{ title: string; row: number }>>,
  guideRows: Map<string, number>,
): void {
  const LINKS_PER_ROW = 4;
  const SPAN = 10;

  /** Rows covered by an existing merge on this sheet, so nothing is clobbered. */
  const mergedRows = (ws: ExcelJS.Worksheet): Set<number> => {
    const out = new Set<number>();
    for (const range of ((ws as unknown as { model?: { merges?: string[] } }).model?.merges ?? [])) {
      const m = /^\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)$/.exec(range);
      if (!m) continue;
      for (let R = Number(m[1]); R <= Number(m[2]); R++) out.add(R);
    }
    return out;
  };

  for (const sheet of Object.keys(TAB_GUIDES)) {
    const ws = wb.getWorksheet(sheet); if (!ws) continue;
    const secs = dedupSections(sectionReg.get(sheet) ?? []);

    // Entries: every section, then the guide block (the reason for this strip:
    // on a long tab that block sits hundreds of rows down). Capped so a rich tab
    // stays to a couple of rows; the Cover carries the full second-level list.
    const entries: Array<{ label: string; row: number }> = secs.slice(0, 11).map((s) => ({ label: s.title, row: s.row }));
    const guideRow = guideRows.get(sheet);
    if (guideRow) entries.push({ label: 'How this tab is calculated', row: guideRow });

    const linkRows = Math.max(1, Math.ceil(entries.length / LINKS_PER_ROW));
    const need = linkRows + 1; // + the "On this tab" strip carrying Back to Cover

    // WHERE the strip goes. A gridded tab has a frozen header (ySplit >= 2) and a
    // plain data area beneath it, so rows are reserved just below the freeze and
    // the strip reads at the top of the sheet body. A designed one-page canvas
    // (Summary, Checks) has no freeze and merged blocks throughout: inserting
    // there would split a merge and wreck the layout, so the strip is appended at
    // the bottom instead. Either way the tab gets its links and Back to Cover.
    const ySplit = (ws.views?.[0] as { ySplit?: number } | undefined)?.ySplit ?? 0;
    const merged = mergedRows(ws);
    const insertAt = ySplit + 1;
    const canInsert = ySplit >= 2
      // Nothing merged may straddle the insert point, and the reserved band must
      // be clear once shifted (blank rows are inserted, so only a straddle can bite).
      && !merged.has(insertAt) && !merged.has(insertAt - 1);

    let at: number;
    if (canInsert) {
      at = insertAt;
      insertRowsAt(ws, at, need);
      // Everything at or below the insert point moved down by `need`.
      const rebase = (n: number): number => (n >= at ? n + need : n);
      sectionReg.set(sheet, (sectionReg.get(sheet) ?? []).map((s) => ({ ...s, row: rebase(s.row) })));
      if (guideRow) guideRows.set(sheet, rebase(guideRow));
      for (const e of entries) e.row = rebase(e.row);
    } else {
      at = (ws.rowCount || 1) + 2;
    }

    // Strip header: label on the left, Back to Cover on the right.
    fillRange(ws, at, 1, at, SPAN, ARGB.paleBand);
    const hc = ws.getCell(at, 1);
    hc.value = canInsert ? 'On this tab' : 'On this tab (sections above)';
    hc.font = { name: 'Calibri', size: 8.5, bold: true, color: { argb: ARGB.sectionDark } };
    hc.alignment = { indent: 1 };
    const back = ws.getCell(at, SPAN);
    back.value = { text: '↑ Back to Cover', hyperlink: `#'${SHEETS.cover}'!A1` };
    back.font = { name: 'Calibri', size: 8.5, bold: true, color: { argb: ARGB.navy }, underline: true };
    back.alignment = { horizontal: 'right' };
    ws.getRow(at).height = 14;

    // Link rows: up to LINKS_PER_ROW jump links each, spread across A..J. Each
    // label spans two columns; the merge is skipped (not merged) if that band is
    // already occupied, so the link still renders rather than throwing.
    for (let i = 0; i < entries.length; i++) {
      const rowIdx = at + 1 + Math.floor(i / LINKS_PER_ROW);
      const col = 1 + (i % LINKS_PER_ROW) * 2;   // A, C, E, G
      const e = entries[i];
      const right = Math.min(SPAN, col + 1);
      if (right > col) { try { ws.mergeCells(rowIdx, col, rowIdx, right); } catch { /* band occupied */ } }
      const c = ws.getCell(rowIdx, col);
      c.value = { text: `›  ${e.label}`, hyperlink: `#'${sheet}'!A${e.row}` };
      c.font = { name: 'Calibri', size: 8.5, color: { argb: ARGB.navy }, underline: true };
      c.alignment = { indent: 1 };
      ws.getRow(rowIdx).height = 13;
    }
    boxBorder(ws, at, 1, at + linkRows, SPAN, ARGB.greyMid);
  }
}

// ── Summary (one-page executive summary) ──────────────────────────────────────
/** A single-page executive summary: key facts, a headline-metric tile wall, and
 *  two compact financial-highlight tables (development economics + returns /
 *  leverage). Reads the same snapshot + returns engine as the Returns tab, so it
 *  ties exactly; degrades gracefully when the returns snapshot cannot compute. */
function addSummary(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, opts: BuildModelOptions, lm: LiveModel): void {
  const ws = wb.addWorksheet(SHEETS.summary, { properties: { tabColor: { argb: ARGB.navy } }, views: [{ showGridLines: false }] });
  const p = opts.state.project;
  const currency = p.currency ?? 'SAR';
  frontMatterCanvas(ws);
  let r = frontMatterBanner(ws, opts.projectName, `Executive Summary  ·  ${opts.dateLabel}`);

  let rs: ReturnsSnapshot | null = null;
  try { rs = computeReturnsSnapshot(snap, opts.state.project); } catch { rs = null; }
  const de = rs?.developmentEconomics;
  const re = rs?.result.realEstate;
  const m = (v: number | null | undefined): string => `${currency} ${formatAccounting(v ?? 0, 'millions', 1)} m`;
  const pct = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? 'n/a' : `${(v * 100).toFixed(1)}%`);
  const mult = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? 'n/a' : `${v.toFixed(2)}x`);
  const gdv = de?.gdv ?? lm.totalRev.reduce((s, x) => s + x, 0);
  const peakDebt = Math.max(0, ...lm.debtClose);

  // ── Key facts (two facts per row: B:C label / D value, E:F label / G value) ──
  frontMatterBand(ws, r, 'Key facts'); r += 1;
  const facts: Array<[string, string]> = [
    ['Date', opts.dateLabel],
    ['Currency', currency],
    ['Location', [p.location, p.country].filter(Boolean).join(', ') || '-'],
    ['Horizon', `${snap.axisLength} yrs (${snap.projectStartYear} to ${snap.projectStartYear + snap.axisLength - 1})`],
    ['Funding method', FUNDING_METHOD_LABELS[(p.financing?.fundingMethod ?? 1) as FundingMethodId]],
    ['Debt / Equity', `${snap.financing.funding.debtPct.toFixed(0)}% / ${snap.financing.funding.equityPct.toFixed(0)}%`],
  ];
  const factTop = r;
  for (let i = 0; i < facts.length; i += 2) {
    const rr = factTop + i / 2;
    const put = (labelCol: number, valLeft: number, valRight: number, pair?: [string, string]): void => {
      if (!pair) return;
      const kc = ws.getCell(rr, labelCol); kc.value = pair[0]; kc.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
      ws.mergeCells(rr, valLeft, rr, valRight);
      const vc = ws.getCell(rr, valLeft); vc.value = pair[1]; vc.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
    };
    put(2, 3, 4, facts[i]);        // B label, C:D value
    put(5, 6, 7, facts[i + 1]);    // E label, F:G value
    if ((i / 2) % 2 === 1) fillRange(ws, rr, 2, rr, 7, ARGB.grey);
  }
  const factRows = Math.ceil(facts.length / 2);
  boxBorder(ws, factTop, 2, factTop + factRows - 1, 7);
  r = factTop + factRows + 1;

  // ── Headline metric tiles (3 per row, each spanning 2 columns) ───────────────
  frontMatterBand(ws, r, 'Headline metrics'); r += 1;
  // HEADLINE RETURNS COME FROM THE PLATFORM RETURNS ENGINE (`rs`), the same
  // source as the Returns tab. They used to read `lm.*` from liveModel.ts, the
  // simplified twin left over from the formula-driven era, which printed
  // Project IRR 177.3% / Equity IRR 38.3% / multiple 7.31x here against
  // 10.9% / 7.0% / 2.04x on the Returns tab of the same workbook. Each label
  // now names its basis, so "equity multiple" cannot be read as the project
  // one. `n/a` when the returns engine could not run, because a figure from a
  // different model is worse than no figure.
  const tiles: Array<[string, string]> = [
    ['Total development cost', m(snap.financing.capex.totals.inclAllLand)],
    ['Gross development value', m(gdv)],
    ['Profit after financing', m(de?.profitAfterFinancing)],
    ['Project IRR (FCFF, unlevered)', pct(rs?.result.fcff.irr)],
    ['Equity IRR (FCFE, levered)', pct(rs?.result.fcfe.irr)],
    ['Equity MOIC (FCFE, levered)', mult(rs?.result.fcfe.moic)],
    ['Development margin', pct(de?.developmentMargin)],
    ['Peak debt', m(peakDebt)],
    ['Total equity required', m(rs?.equityExposure.totalEquityRequired)],
  ];
  const tileCols: Array<[number, number]> = [[2, 3], [4, 5], [6, 7]];
  const tileTop = r;
  tiles.forEach(([label, value], i) => {
    const rowBlock = Math.floor(i / 3);
    const [c1, c2] = tileCols[i % 3];
    const lr = tileTop + rowBlock * 2, vr = lr + 1;
    ws.mergeCells(lr, c1, lr, c2);
    const lc = ws.getCell(lr, c1); lc.value = label; lc.font = { name: 'Calibri', size: 8, bold: true, color: { argb: ARGB.navyDark } }; lc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; fillCell(lc, ARGB.grey);
    ws.mergeCells(vr, c1, vr, c2);
    const vc = ws.getCell(vr, c1); vc.value = value; vc.font = { name: 'Calibri', size: 13, bold: true, color: { argb: ARGB.navy } }; vc.alignment = { horizontal: 'center', vertical: 'middle' };
    boxBorder(ws, lr, c1, vr, c2);
  });
  const tileRows = Math.ceil(tiles.length / 3) * 2;
  r = tileTop + tileRows + 1;

  // ── Financial highlights: two compact tables side by side ────────────────────
  frontMatterBand(ws, r, 'Financial highlights'); r += 1;
  // Column headers.
  const hdr = (col: number, span: number, text: string): void => {
    ws.mergeCells(r, col, r, col + span - 1);
    const c = ws.getCell(r, col); c.value = text; c.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    fillRange(ws, r, col, r, col + span - 1, ARGB.subtotal);
  };
  hdr(2, 3, 'Development economics'); // B:D
  hdr(5, 3, 'Returns & leverage');    // E:G
  r += 1;
  const leftRows: Array<[string, string]> = [
    ['Gross development value', m(gdv)],
    ['Total development cost', m(de?.totalDevelopmentCost ?? snap.financing.capex.totals.inclAllLand)],
    ['Total financing cost', m(de?.totalFinancingCost)],
    ['Profit before financing', m(de?.profitBeforeFinancing)],
    ['Profit after financing', m(de?.profitAfterFinancing)],
    ['Development margin', pct(de?.developmentMargin)],
  ];
  // Min DSCR below 1.0 means debt service is not covered from operations in at
  // least one year. It printed as a neutral metric beside the IRR, which on the
  // reference project meant 0.43x read as unremarkable. It is flagged below.
  const dscrMin = re?.dscrMin;
  const dscrBreach = dscrMin != null && Number.isFinite(dscrMin) && dscrMin > 0 && dscrMin < 1;
  const dscrYears = (re?.dscrPerPeriod ?? []).filter((v) => v != null && Number.isFinite(v) && v > 0);
  const dscrBelow = dscrYears.filter((v) => v < 1).length;
  const rightRows: Array<[string, string]> = [
    ['Project IRR (FCFF, unlevered)', pct(rs?.result.fcff.irr)],
    ['Equity IRR (FCFE, levered)', pct(rs?.result.fcfe.irr)],
    ['Equity MOIC (FCFE, levered)', mult(rs?.result.fcfe.moic)],
    ['Peak debt', m(peakDebt)],
    ['Peak equity', m(re?.peakEquity)],
    ['Min DSCR', dscrBreach ? `${mult(dscrMin)}  BELOW 1.00x` : mult(dscrMin)],
  ];
  const hlTop = r;
  const rows = Math.max(leftRows.length, rightRows.length);
  for (let i = 0; i < rows; i++) {
    const rr = hlTop + i;
    const putRow = (labelCol: number, valLeft: number, valRight: number, pair?: [string, string]): void => {
      if (!pair) return;
      const kc = ws.getCell(rr, labelCol); kc.value = pair[0]; kc.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
      ws.mergeCells(rr, valLeft, rr, valRight);
      const vc = ws.getCell(rr, valLeft); vc.value = pair[1]; vc.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navy } }; vc.alignment = { horizontal: 'right' };
    };
    putRow(2, 3, 4, leftRows[i]);   // B label, C:D value
    putRow(5, 6, 7, rightRows[i]);  // E label, F:G value
    if (i % 2 === 1) fillRange(ws, rr, 2, rr, 7, ARGB.grey);
  }
  boxBorder(ws, hlTop, 2, hlTop + rows - 1, 4);
  boxBorder(ws, hlTop, 5, hlTop + rows - 1, 7);
  // Paint the Min DSCR value cell in the check red and say what it means, so a
  // covenant breach cannot be skimmed past as one more metric in the column.
  if (dscrBreach) {
    const dscrRow = hlTop + rightRows.length - 1;
    ws.getCell(dscrRow, 6).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.bad } };
    r = hlTop + rows;
    ws.mergeCells(r, 2, r, 7);
    const warn = ws.getCell(r, 2);
    warn.value = `Debt service is not covered from operations in ${dscrBelow} of ${dscrYears.length} debt-service years (minimum ${mult(dscrMin)}). Typical for a development funded from drawdowns, but it is a covenant reading, not a neutral metric.`;
    warn.font = { name: 'Calibri', size: 8, italic: true, color: { argb: ARGB.bad } };
    warn.alignment = { wrapText: true, vertical: 'top', indent: 1 };
    ws.getRow(r).height = 24;
    r += 1;
  }
  r = hlTop + rows + (dscrBreach ? 2 : 1);

  // ── Fund layer (2026-08-10) ─────────────────────────────────────────────────
  //
  // The Summary tab was the last surface showing a fund project's economics
  // with no sign a fund exists: its EBITDA tile is already NET of fund fees and
  // its Distributed Equity figure is the GROSS one, which is the pair most
  // likely to be quoted out of a summary. The block APPENDS below the designed
  // canvas (the same placement the sub-TOC uses on this tab), so every merge
  // above it is untouched.
  //
  // Rows come from the shared fundReports builders. Money is formatted in
  // millions to match the rest of this page.
  if (rs && isFundActive(rs)) {
    const fctx: FundReportCtx = { snap, returns: rs, fmt: { money: m, pct: (v, d = 1) => (v == null || !Number.isFinite(v) ? 'n/a' : `${(v * 100).toFixed(d)}%`), mult } };
    r += 1;
    ws.mergeCells(r, 2, r, 7);
    const band = ws.getCell(r, 2);
    band.value = 'FUND LAYER';
    band.font = { name: 'Calibri', size: 10, bold: true, color: { argb: ARGB.white } };
    band.alignment = { indent: 1, vertical: 'middle' };
    fillRange(ws, r, 2, r, 7, ARGB.navy);
    r += 2;

    // Gross vs net, the pair a summary reader must not confuse.
    const gn = buildFundGrossNetRows(fctx);
    const gnTop = r;
    const hdr = [...FUND_GROSS_NET_COLUMNS];
    for (let c = 0; c < hdr.length; c++) { const cell = ws.getCell(r, 2 + c); cell.value = hdr[c]; cell.font = { name: 'Calibri', size: 8, bold: true, color: { argb: ARGB.navyDark } }; cell.alignment = { horizontal: c === 0 ? 'left' : 'right' }; fillCell(cell, ARGB.subtotal); }
    r += 1;
    for (const g of gn) {
      for (let c = 0; c < g.cells.length; c++) {
        const cell = ws.getCell(r, 2 + c);
        cell.value = g.cells[c];
        cell.font = { name: 'Calibri', size: BODY_SIZE, bold: g.emphasis === 'total', color: { argb: g.emphasis === 'total' ? ARGB.navy : ARGB.formula } };
        cell.alignment = { horizontal: c === 0 ? 'left' : 'right' };
      }
      r += 1;
    }
    boxBorder(ws, gnTop, 2, r - 1, 1 + hdr.length);
    // Why the gross and net rows are identical, when they are: without it the
    // pair reads as a copied row. Shared helper, so this page cannot phrase it
    // differently from the Returns tab or either PDF.
    {
      const note = fundGrossNetNote(fctx);
      if (note) {
        ws.mergeCells(r, 2, r, 7);
        const nc = ws.getCell(r, 2); nc.value = note;
        nc.font = { name: 'Calibri', size: 8, italic: true, color: { argb: ARGB.navyDark } };
        nc.alignment = { wrapText: true, vertical: 'top' };
        ws.getRow(r).height = 24;
        r += 1;
      }
    }
    r += 1;

    // Fund headline figures, as a compact label / value list.
    for (const card of buildFundHeadlineCards(fctx)) {
      const kc = ws.getCell(r, 2); kc.value = card.label; kc.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
      ws.mergeCells(r, 3, r, 4);
      const vc = ws.getCell(r, 3); vc.value = card.value; vc.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navy } }; vc.alignment = { horizontal: 'right' };
      const sc = ws.getCell(r, 5); sc.value = card.sub; sc.font = { name: 'Calibri', size: 8, italic: true, color: { argb: ARGB.navyDark } };
      r += 1;
    }
    r += 1;

    // The full waterfall, in the reference row order. Lifetime totals only:
    // this page is a one-page canvas with no period axis, and the per-period
    // detail lives on the Returns tab. Balance rows carry no total by
    // construction (the builder encodes it), so they show a dash.
    const wfTop = r;
    const wfHdr = ws.getCell(r, 2); wfHdr.value = 'Distribution Waterfall (lifetime)'; wfHdr.font = { name: 'Calibri', size: 8, bold: true, color: { argb: ARGB.navyDark } };
    const wfHdr2 = ws.getCell(r, 5); wfHdr2.value = 'Total'; wfHdr2.font = { name: 'Calibri', size: 8, bold: true, color: { argb: ARGB.navyDark } }; wfHdr2.alignment = { horizontal: 'right' };
    fillRange(ws, r, 2, r, 7, ARGB.subtotal);
    r += 1;
    for (const row of buildFundWaterfallRows(fctx)) {
      const kc = ws.getCell(r, 2);
      kc.value = `${'   '.repeat(row.indent ?? 0)}${row.label}`;
      kc.font = { name: 'Calibri', size: BODY_SIZE, bold: !!(row.isTotal || row.isSubtotal), color: { argb: row.isTotal ? ARGB.navy : ARGB.formula } };
      ws.mergeCells(r, 5, r, 6);
      const vc = ws.getCell(r, 5);
      vc.value = row.totalOverride === '' ? '-' : String(row.totalOverride ?? '');
      vc.font = { name: 'Calibri', size: BODY_SIZE, bold: !!row.isTotal, color: { argb: row.isTotal ? ARGB.navy : ARGB.formula } };
      vc.alignment = { horizontal: 'right' };
      r += 1;
    }
    boxBorder(ws, wfTop, 2, r - 1, 7);
    r += 1;

    // Fee income by earner.
    if (hasFundFeeIncome(rs)) {
      const feTop = r;
      const feHdr = [...FUND_EARNER_COLUMNS];
      for (let c = 0; c < feHdr.length; c++) { const cell = ws.getCell(r, 2 + c); cell.value = feHdr[c]; cell.font = { name: 'Calibri', size: 8, bold: true, color: { argb: ARGB.navyDark } }; cell.alignment = { horizontal: c === 0 ? 'left' : 'right' }; fillCell(cell, ARGB.subtotal); }
      r += 1;
      for (const g of buildFundEarnerRows(fctx)) {
        for (let c = 0; c < g.cells.length; c++) {
          const cell = ws.getCell(r, 2 + c);
          cell.value = g.cells[c];
          cell.font = { name: 'Calibri', size: BODY_SIZE, bold: g.emphasis === 'total', color: { argb: g.emphasis === 'total' ? ARGB.navy : ARGB.formula } };
          cell.alignment = { horizontal: c === 0 ? 'left' : 'right' };
        }
        r += 1;
      }
      boxBorder(ws, feTop, 2, r - 1, 1 + feHdr.length);
      r += 1;
    }
  }

  // Footer note (snapshot disclaimer) + brand.
  ws.mergeCells(r, 2, r, 7);
  const note = ws.getCell(r, 2);
  note.value = 'Figures are platform-computed values as of export (hardcoded snapshot). Money figures shown in millions on this page; see each tab for the full-unit detail. Editing a cell does not recalculate; re-export after changing inputs.';
  note.font = { name: 'Calibri', size: 8, italic: true, color: { argb: ARGB.navyDark } };
  note.alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(r).height = 26;
  r += 2;
  const foot = ws.getCell(r, 2); foot.value = 'Financial Modeler Pro  ·  financialmodelerpro.com'; foot.font = { name: 'Calibri', size: 9, color: { argb: ARGB.navyDark } };
}
