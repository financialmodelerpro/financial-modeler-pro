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
import { poolMapByLine, poolCapexByLine, poolResults, lineHosts, fixHospitalityRates, fixLeaseRates, poolRevenueBasisByLine, poolSaleCohortByLine, planReportLines, lineTitle } from '../reports/lineRows';
import { buildDisposalWorking } from '../reports/disposalReport';
import { buildOverviewReport, distributedReturnPair } from '../reports/overviewReport';
import { buildOperatingKpis } from '../reports/operatingKpis';
import { fundingChartPoints } from '../portfolio/fundingSeries';
import { evaluateCovenant, covenantUnit, covenantSeries, reduceWorst, reduceAvg, COVENANT_METRIC_LABELS, type CovenantInputs } from '../covenants';
import { DEFAULT_COVENANTS } from '../state/module1-types';
import { enumerateOverridableFields, getByPath } from '../cases/applyOverrides';
import type { SensitivityVariable } from '@/src/core/calculations/returns';
import { countryLabel } from '@/src/core/countries';
import { revenueBySection } from '../reports/revenueSections';
import { scheduleWithDisposal, idcWithDisposal, disposalContextOf } from '../reports/disposalSchedules';
import { buildFinancingScheduleTables, buildCashSweepTables, type ReportTable } from '../reports/financingReports';
import { buildFcffBuildup, buildFcfeBuildup, buildDividendBuildup, m4StreamRow } from '../reports/streamReports';
import { buildIntegrityChecks, checkDetail, relativeCheckOk, worstDivergence, buildRevenueBasisAdvisoriesFor, revenueBasisAdvisoryText, buildSaleCohortAdvisories, saleCohortAdvisoryText } from '../reports/checksReport';
import { buildCostOfSalesReport } from '../reports/cosReports';
import { buildOpexReport } from '../reports/opexReports';
import { buildPLRows, buildDirectCFRows, buildIndirectCFRows, buildBSRows, buildBsReconciliationRows, buildBsFeederTables, BS_FEEDER_SECTIONS, BS_RECONCILIATION_CAPTION, buildFundFeeBasisRows, buildFundCapitalRows, fundFeeBasisBaseCell, totalColumnHeading, totalColumnNote, TOTAL_COLUMN_HEADINGS, TOTAL_COLUMN_NOTES, FUND_CAPITAL_BASES_TITLE, FUND_CAPITAL_BASES_NOTE, FUND_CAPITAL_BASE_TAG, type M4ReportCtx, type FundFeeBasisRow } from '../reports/m4Reports';
import { buildFixedAssetReport, type FixedAssetTable } from '../reports/fixedAssetReports';
import { buildCaseComparisonReport, caseOverridesNote, type CaseComparisonInput, type CaseComparisonReport, type CaseKpiKind } from '../reports/caseComparisonReport';
import { buildCaseYoYReport, type CaseYoYReport } from '../reports/caseYoYReport';
import { formatAssumptionValue, assumptionUnitSuffix, curatedDefaultFields, inactiveLeverReason, nonEconomicLeverReason, isPerPeriodLever, isAppliedValue, assumptionFor, buildGridContext, groupAssumptionRows, leverNote, type GridRowLite } from '../cases/assumptionGrid';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { computeReturnsSnapshot, computeReturnsSensitivity, type ReturnsSnapshot } from '../returns-resolvers';
import type { M4Row } from '../../components/modules/_shared/m4Table';
import { resolveAssetAreaMetrics, computePhaseTimeline, computeProjectTimeline, resolveSubUnitAdr, type AssetAreaMetrics } from '@/src/core/calculations';
import { FUNDING_METHOD_LABELS, COST_METHOD_LABELS, type FundingMethodId } from '../state/module1-types';
import { CAPEX_SECTIONS } from '../reports/capexReports';
import { TERMINAL_METHOD_LABELS } from '../state/module1-types';
import { buildConsolidatedReport, perAssetCostsFromTreatment } from '../reports/consolidatedReport';
import { buildSellingCostReport, SELLING_COSTS_CAPTION, SELLING_COSTS_YOY_CAPTION } from '../reports/sellingCostReports';
import {
  emitProjectSection, emitPhasesSection, emitStandardsSection, emitPlotsSection, emitAssetEntrySection, emitSubUnitSection,
  emitRevenueInputs, emitEscrowInputs, emitOpexInputs, emitStatementInputsSection, emitDepreciationSection, emitReturnsSection,
  emitLandTables, LAND_CHAIN_COLS, utcMonthYear, utcYear, phaseStatusLabel, type SheetCursor,
} from './inputsSheetSections';
import { buildAssetAreaTables, buildAssetLandView } from '../../components/modules/_shared/assetInputsView';
import { resolveFundTerms } from '../fundTerms';
import {
  isFundActive, hasFundFeeIncome, buildFundWaterfallRows, buildFundFeeIncomeRows, buildDdmPostFeeRows,
  buildFundGrossNetRows, buildFundEarnerRows, buildFundHeadlineCards, fundGrossNetNote,
  fundWaterfallTotalsNote,
  FUND_GROSS_NET_COLUMNS, FUND_EARNER_COLUMNS, type FundReportCtx,
} from '../reports/fundReports';
import { buildAssetNotes } from '../reports/assetNotes';
import { formatAccounting } from '@/src/core/formatters';
import { computeLiveModel, type LiveAssetInput, type LiveModel, type LiveGroup } from './liveModel';
import {
  ARGB, NUMFMT, BODY_SIZE, fcell, setInput, markInput, setFormula, setLabel, setTitle, setSectionHeader, setColHeader, colLetter,
  fillCell, fillRange, boxBorder, sheetRef, scaleMoneyFormats, scaleNote, defaultDecimals, setStaticMode, setNote, setBasis, setSectionSink, insertRowsAt, type DisplayScale, type DisplayDecimals,
} from './styles';
import { withResolvedAssetNames, assetLabel } from '@/src/core/calculations/assetName';
// Module 2 and Module 3 mirror (addRevenue / addOpex).
import { planRevenueLines, groupRevenueLines, lineForAsset, REVENUE_SECTIONS, REVENUE_SECTION_META, type RevenueLine } from '../revenueLines';
import { lineRevenueResults, resolveRowVelocity, expandIndexationToAxis, resolveSellConfig, resolveHospitalityConfig, resolveLeaseConfig, resolveAssetKeys } from '../revenue-resolvers';
import { revenueLineName, buildProjectRevenueGroupedRows, PROJECT_REVENUE_TABLES, buildShareSoldRows, buildPrePostRows, buildRevenueScheduleFeeds } from '../reports/revenueOutputReports';
import { buildInventoryRollForward } from '../reports/saleRollForwardReports';
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
import { deriveCostStage, isLandValueLine } from '@/src/core/calculations';
import { CAPEX_PHASING_SOURCE_LABELS, FUNDING_METHOD_DESCRIPTIONS, REPAYMENT_METHOD_LABELS, DEFAULT_PROJECT_FINANCING_CONFIG } from '../state/module1-types';
import { buildIdcAllocationTables } from '../reports/financingReports';
import { computeFundingBasis } from '../reports/fundingBasis';
import { buildPartiesTable, PARTIES_TITLE, PARTIES_EMPTY_TEXT } from '../reports/partiesReport';
import type { Party } from '../parties';
import { projectLocationLabel } from '@/src/core/countries';

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
  /** Module 1 tab 2. Parties are stored outside the version snapshot, so the
   *  caller (ExportModal) loads them and hands them in. Omitted = none entered. */
  parties?: Party[];
  /** The LIVE sensitivity entitlement (`allows('sensitivity')`), exactly as the
   *  PDF takes it. The two-way Equity IRR grid is printed only when true; false
   *  or omitted prints nothing for it, not a placeholder. Defaults to false, the
   *  same as the PDF, so a caller that forgets the gate cannot leak the grid. */
  includeSensitivity?: boolean;
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
  const capexAddrs = addCapex(wb, snap, capexByLine.report, refs, lineLandAddrs, opts.state);

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
  const ctx: EmitCtx = { wb, snap, state: opts.state, refs, lm, proj, assets: liveAssets, landAddrs, capexAddrs, revBaseFormula, currency: opts.state.project.currency ?? 'SAR', labelMoney: makeLabelMoney(opts.displayScale ?? 'full', opts.displayDecimals ?? defaultDecimals(opts.displayScale ?? 'full')), caseComparison: opts.caseComparison, includeSensitivity: opts.includeSensitivity === true };
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
  /** The sensitivity entitlement (BuildModelOptions.includeSensitivity). */
  includeSensitivity: boolean;
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
//
// THE PLATFORM'S INPUT SCREENS, IN THE PLATFORM'S ORDER (2026-09-17). Module 1
// (Project & Phases, Fund Terms, Asset Types & Standards, Assets & Sub-units,
// Capex, Financing), then Module 2 (Revenue, Escrow), Module 3 (Opex), Module 4
// (P&L and depreciation inputs) and Module 5 (Returns). A value a user types
// on the platform is input-shaded; a value the platform derives, inherits or
// defaults is written formula-black. The section layouts live in
// inputsSheetSections.ts; this function orders them and keeps the capex and
// financing blocks the rest of the workbook links to.
function addAssumptions(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, opts: BuildModelOptions, capex: CapexReport): AssumptionRefs {
  const ws = wb.addWorksheet(SHEETS.assumptions, { properties: { tabColor: { argb: ARGB.navy } } });
  ws.getColumn(1).width = 40;
  ws.getColumn(2).width = 22;
  for (let c = 3; c <= 14; c++) ws.getColumn(c).width = 15;
  const state = opts.state;
  const p = state.project;
  const fin = snap.financing;
  const subUnitRefs: SubUnitInputRef[] = [];
  const trancheRefs: TrancheInputRef[] = [];
  const equityRefs: EquityInputRef[] = [];
  const existingEquityRefs: ExistingEquityRef[] = [];
  const addr = (col: string, row: number): string => sheetRef(SHEETS.assumptions, `$${col}$${row}`);
  let r = 1;
  // Sections written through a cursor share this function's row counter.
  const section = (emit: (c: SheetCursor) => void): void => {
    const cur: SheetCursor = { wb, ws, sheetName: SHEETS.assumptions, r };
    emit(cur);
    r = cur.r;
  };
  setTitle(ws.getCell(`A${r}`), 'Inputs (all model assumptions)', 16); r += 1;
  setLabel(ws.getCell(`A${r}`), 'Every input screen of the platform, in module order. Shaded cells are what a user types on the platform; unshaded figures beside them are derived, inherited from an asset type or defaulted, exactly as the screens show them. This is a hardcoded snapshot: editing here does NOT recalculate the other tabs; change inputs in the platform and re-export.', { }); r += 2;

  const addKV = (label: string, value: number | string, numFmt: string, name?: string): number => {
    setLabel(ws.getCell(`A${r}`), label);
    setInput(ws.getCell(`B${r}`), value, numFmt);
    if (name) wb.definedNames.add(`${SHEETS.assumptions}!$B$${r}`, name);
    const row = r; r += 1; return row;
  };
  const financingScalars: FinancingScalarRefs = {
    dividendEnabled: '', dividendPayout: '', dividendStart: '', sweepStart: '', sweepRatio: '',
  };
  // Full-width domain divider band between input domains.
  const inputDivider = (text: string): void => {
    r += 1;
    for (let c = 1; c <= 8; c++) fillCell(ws.getCell(r, c), ARGB.sectionDark);
    const cell = ws.getCell(`A${r}`); cell.value = text;
    cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: ARGB.white } };
    cell.alignment = { vertical: 'middle' };
    ws.getRow(r).height = 18;
    r += 2;
  };

  // ── Module 1, tab 1: Project & Phases ──────────────────────────────────────
  section((c) => emitProjectSection(c, state));
  section((c) => emitPhasesSection(c, state, snap));

  // ── Module 1, tab 2: Parties (2026-09-17) ──────────────────────────────────
  // Parties live outside the snapshot, so the caller hands them in; one builder
  // with the PDF (lib/reports/partiesReport.ts). The engine never reads them.
  inputDivider('PARTIES');
  {
    const pt = buildPartiesTable(opts.parties);
    setSectionHeader(ws.getRow(r), PARTIES_TITLE, 4); r += 1;
    if (pt.rows.length === 0) {
      setLabel(ws.getCell(`A${r}`), PARTIES_EMPTY_TEXT); r += 1;
    } else {
      pt.columns.forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, 'left')); r += 1;
      for (const row of pt.rows) {
        row.forEach((v, i) => setInput(ws.getCell(r, i + 1), v, '@'));
        r += 1;
      }
    }
    r += 1;
  }

  // ── Module 1, tab 3: Fund Terms (2026-08-11) ───────────────────────────────
  //
  // Gated on the toggle, so a standalone project is untouched. Every cell is an
  // INPUT except the resolved bases, which are model-derived and written as
  // computed. See docs/FUND_LAYER_GUIDELINE.md on why fund size is resolved.
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
    // THE SAME TOGGLE FUND TERMS AND FINANCING BOTH SHOW, one field, with the screen's words.
    termRow('How the management fee is funded', fundTerms.managementFeeFunding === 'equity'
      ? '100% equity (dedicated equity draw)'
      : 'Cash deficit funding (project debt / equity ratio)', '@', '',
      fundTerms.managementFeeFunding === 'equity'
        ? 'The fee is its own equity draw, outside the debt / equity ratio.'
        : 'The fee joins the funding deficit and is split at the project debt / equity ratio.');
    termRow('Fund size override', fundTerms.fundSizeOverride ? 'Yes' : 'No', '@', '', fundTerms.fundSizeOverride ? `Typed target ${formatAccounting(fundTerms.fundSize, 'millions', 1)} m pins the fund size instead of the model-resolved figure.` : 'Off: fund size is resolved from the model (total equity plus the debt facility).');
    termRow('Facility limit override', fundTerms.facilityLimitOverride ? 'Yes' : 'No', '@', '', fundTerms.facilityLimitOverride ? `Typed limit ${formatAccounting(fundTerms.facilityLimit, 'millions', 1)} m.` : 'Off: the debt facility is resolved from the model.');
    r += 1;

    const capRows = buildFundCapitalRows(snap);
    if (capRows.length) {
      setSectionHeader(ws.getRow(r), 'Resolved capital bases (computed from the model, not typed)', 4); r += 1;
      ['Base', 'Amount', '', 'How it is resolved'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 1 ? 'right' : 'left')); r += 1;
      for (const cr of capRows) {
        setLabel(ws.getCell(`A${r}`), cr.isTotal ? `= ${cr.label}` : cr.label, { bold: cr.isTotal });
        const vc = ws.getCell(`B${r}`); vc.value = cr.amount; vc.numFmt = NUMFMT.money; vc.font = { name: 'Calibri', size: BODY_SIZE, bold: cr.isTotal, color: { argb: ARGB.formula } };
        setLabel(ws.getCell(`D${r}`), cr.note);
        r += 1;
      }
      r += 1;
    }

    // The distribution matrix. Shares are NEVER normalised.
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
  } else {
    // The Fund Terms tab exists on every project; with the layer off it shows the
    // toggle and nothing else, so the workbook says the same.
    inputDivider('FUND INPUTS');
    setSectionHeader(ws.getRow(r), 'Fund terms', 4); r += 1;
    setLabel(ws.getCell(`A${r}`), 'Fund layer enabled');
    setInput(ws.getCell(`B${r}`), 'No', '@');
    setLabel(ws.getCell(`D${r}`), 'Off: the project is modelled without fund fees, hurdle or performance fee.');
    r += 2;
  }

  // ── Module 1, tab 4: Asset Types & Standards ───────────────────────────────
  inputDivider('ASSET TYPES & STANDARDS');
  section((c) => emitStandardsSection(c, state));

  // ── Module 1, tab 5: Assets & Sub-units (Tables 1, 2 and 5; 3 and 4 are on Land & Area) ──
  inputDivider('ASSETS & SUB-UNITS');
  section((c) => emitPlotsSection(c, state));
  const areaTables = buildAssetAreaTables(state);
  section((c) => emitAssetEntrySection(c, areaTables));
  section((c) => emitSubUnitSection(c, state));
  // The link registry the downstream tabs key on (formulas are not live in the
  // hardcoded workbook, so the addresses are placeholders; ids and strategies
  // are what the other tabs read).
  const visibleAssets = state.assets.filter((a) => a.visible !== false);
  const assetRefs: AssetInputRef[] = visibleAssets.map((a) => ({
    id: a.id, name: a.name, phaseId: a.phaseId, strategy: a.strategy,
    bua: '0', nsa: '0', gfa: '0', support: '0', parking: '0', parkingBays: '0', landSqm: '0', landRate: '0', usefulLife: '0',
  }));
  for (const u of state.subUnits) {
    subUnitRefs.push({ id: u.id, assetId: u.assetId, category: '""', metric: '""', value: '0', unitArea: '0', price: '0' });
  }

  // ── Module 1, tab 6: Capex cost lines ──────────────────────────────────────
  // Rates, stages and phasing windows are inputs. The QUANTITY each rate
  // multiplies and the stage subtotals are the engine's results, written as
  // computed, never shaded (the platform derives both).
  inputDivider('CAPEX INPUTS');
  setSectionHeader(ws.getRow(r), 'Capex cost lines (inputs: method, rate / %, quantity, stage, phasing window)', 9); r += 1;
  ['Line / Cost line', 'Method', 'Rate / %', 'Quantity (derived)', 'Stage', 'Start period', 'End period', 'Phasing', 'Amount (derived)'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
  r += 1;
  const methodLabel = (method: string, basis: string): string =>
    basis && basis !== method ? basis : ((COST_METHOD_LABELS as Record<string, string>)[method] ?? basis);
  const capexRefs: CapexAssetRef[] = [];
  for (const ia of capex.inputAssets) {
    // The pooled line's title already names its phase on a multi-phase project.
    setLabel(ws.getCell(`A${r}`), ia.assetName, { bold: true });
    fillRange(ws, r, 1, r, 9, ARGB.subtotal);
    r += 1;
    const lineRefs: CapexLineRef[] = [];
    for (const ln of ia.lines) {
      setLabel(ws.getCell(`A${r}`), ln.name, { indent: 1 });
      setLabel(ws.getCell(`B${r}`), methodLabel(ln.method, ln.basis));
      if (ln.isPercent) setInput(ws.getCell(`C${r}`), ln.rate / 100, NUMFMT.pct2);
      else setInput(ws.getCell(`C${r}`), ln.rate, NUMFMT.rate);
      setInput(ws.getCell(`E${r}`), ln.stage, '@');
      setInput(ws.getCell(`F${r}`), ln.startPeriod, NUMFMT.int);
      setInput(ws.getCell(`G${r}`), ln.endPeriod, NUMFMT.int);
      setInput(ws.getCell(`H${r}`), ln.phasing, '@');
      const hasQty = !ln.isFixed && ln.metricValue !== null && (ln.metricKind === 'area' || ln.method === 'rate_per_parking_bay');
      // The EFFECTIVE driver quantity (amount / rate), which is this line's share
      // where the engine allocates a line across assets.
      if (hasQty) setFormula(ws.getCell(`D${r}`), fcell('0', ln.rate ? ln.amount / ln.rate : (ln.metricValue as number)), NUMFMT.int);
      setFormula(ws.getCell(`I${r}`), fcell('0', ln.amount), NUMFMT.money);
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
      if (ln.perSubUnitRates && Object.keys(ln.perSubUnitRates).length) {
        for (const [key, rate] of Object.entries(ln.perSubUnitRates)) {
          const subName = key === '__support__' ? 'Support' : key === '__parking__' ? 'Parking' : (state.subUnits.find((s) => s.id === key)?.name ?? key);
          setLabel(ws.getCell(`A${r}`), `${subName} rate`, { indent: 2 });
          setInput(ws.getCell(`C${r}`), rate, NUMFMT.rate);
          r += 1;
        }
      }
    }
    for (const [label, amount] of ([
      ['Hard costs', ia.subtotals.hard],
      ['Soft costs', ia.subtotals.soft],
      ['Operating', ia.subtotals.operating],
      ['Marketing', ia.subtotals.marketing],
      ['Land', ia.subtotals.land],
    ] as Array<[string, number]>)) {
      if (amount === 0) continue;
      setLabel(ws.getCell(`A${r}`), label, { indent: 1, bold: true });
      setFormula(ws.getCell(`I${r}`), fcell('0', amount), NUMFMT.money);
      r += 1;
    }
    if (ia.subtotals.exclLand !== 0 && (ia.subtotals.land !== 0 || ia.subtotals.marketing !== 0)) {
      setLabel(ws.getCell(`A${r}`), ia.subtotals.marketing !== 0
        ? 'Construction cost (excl. land and marketing)'
        : 'Construction cost (excl. land)', { indent: 1, bold: true });
      setFormula(ws.getCell(`I${r}`), fcell('0', ia.subtotals.exclLand), NUMFMT.money);
      r += 1;
    }
    capexRefs.push({ assetId: ia.assetId, name: ia.assetName, phaseName: ia.phaseName, total: ia.total, lines: lineRefs });
  }
  r += 1;

  // ── Module 1, tab 7: Financing ─────────────────────────────────────────────
  inputDivider('FINANCING INPUTS');
  setSectionHeader(ws.getRow(r), 'Financing settings', 5); r += 1;
  setLabel(ws.getCell(`A${r}`), 'Funding method'); setInput(ws.getCell(`B${r}`), FUNDING_METHOD_LABELS[(p.financing?.fundingMethod ?? 1) as FundingMethodId], '@'); r += 1;
  addKV('Debt share', fin.funding.debtPct / 100, NUMFMT.pct, 'DebtPct');
  addKV('Equity share', fin.funding.equityPct / 100, NUMFMT.pct, 'EquityPct');
  addKV('Minimum cash reserve', p.financing?.minimumCashReserve ?? fin.funding.minCashReserve ?? 0, NUMFMT.money, 'MinCashReserve');
  addKV('IDC allocation basis', (p.idcConfig?.allocationBasis ?? 'land') === 'bua' ? 'Total BUA' : 'Land Area', '@');
  addKV('Dividends enabled (1 = yes)', p.dividendPolicy?.enabled ? 1 : 0, NUMFMT.int);
  addKV('Dividend payout ratio %', (p.dividendPolicy?.payoutRatio ?? 0) / 100, NUMFMT.pct);
  addKV('Dividend start year (0 = auto)', p.dividendStartYear ?? 0, NUMFMT.year);
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

  // LAND FUNDING, PER PHASE, as Financing section 4 shows it: the land cash and
  // in-kind the capex engine priced (derived), and the debt / equity split
  // stored per plot. A phase whose plots store no split shows the screen's
  // default (0% debt, 100% equity) as derived, not as a typed input.
  const landByPhase = fin.capex.landByPhase ?? [];
  if (landByPhase.length) {
    setSectionHeader(ws.getRow(r), 'Land Funding (per phase, from the Capex results)', 5); r += 1;
    ['Phase', 'Land Cash (Capex Table 5)', 'Land In-Kind (Capex Table 5)', 'Debt %', 'Equity %'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
    r += 1;
    const parcelFunding = p.financing?.parcelFunding ?? [];
    for (const lp of landByPhase) {
      const cfgs = state.parcels.filter((pa) => pa.phaseId === lp.phaseId).map((pa) => parcelFunding.find((x) => x.parcelId === pa.id));
      const storedCfg = cfgs.find((x) => x !== undefined);
      const debts = cfgs.map((x) => x?.debtPct ?? 0);
      const mixed = debts.some((d) => d !== debts[0]);
      const debtPct = debts[0] ?? 0;
      const equityPct = cfgs[0]?.equityPct ?? (100 - debtPct);
      setLabel(ws.getCell(`A${r}`), `${lp.phaseName}${mixed ? ' (mixed split across its plots)' : ''}`);
      setFormula(ws.getCell(`B${r}`), fcell('0', lp.landCashTotal), NUMFMT.money);
      setFormula(ws.getCell(`C${r}`), fcell('0', lp.landInKindTotal), NUMFMT.money);
      if (storedCfg) {
        setInput(ws.getCell(`D${r}`), debtPct / 100, NUMFMT.pct);
        setInput(ws.getCell(`E${r}`), equityPct / 100, NUMFMT.pct);
      } else {
        setFormula(ws.getCell(`D${r}`), fcell('0', 0), NUMFMT.pct);
        setFormula(ws.getCell(`E${r}`), fcell('1', 1), NUMFMT.pct);
        setLabel(ws.getCell(`F${r}`), 'Not set: the default split applies.');
      }
      r += 1;
    }
    r += 1;
  }

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
  if (state.financingTranches.length) {
    setSectionHeader(ws.getRow(r), 'Financing facilities (debt)', 12); r += 1;
    ['Facility', 'Origin', 'Opening balance', 'Interest rate %', 'Drawdown method', 'Repayment method', 'Repay periods', 'IDC capitalize', 'Repay start year', 'Interest start year', 'Origination year', 'Facility share %'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
    r += 1;
    for (const t of state.financingTranches) {
      const rate = t.interestRatePct ?? ((t.interbankRatePct ?? 0) + (t.creditSpreadPct ?? 0));
      setLabel(ws.getCell(`A${r}`), t.name);
      setInput(ws.getCell(`B${r}`), String(t.origin ?? 'new'), '@');
      setInput(ws.getCell(`C${r}`), t.openingBalance ?? 0, NUMFMT.money);
      setInput(ws.getCell(`D${r}`), rate / 100, NUMFMT.pct2);
      setInput(ws.getCell(`E${r}`), String(t.drawdownMethod ?? '-'), '@');
      setInput(ws.getCell(`F${r}`), String(t.repaymentMethod ?? '-'), '@');
      setInput(ws.getCell(`G${r}`), t.repaymentPeriods ?? 0, NUMFMT.int);
      setInput(ws.getCell(`H${r}`), t.idcCapitalize ? 1 : 0, NUMFMT.int);
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
  if (state.equityContributions.length) {
    setSectionHeader(ws.getRow(r), 'Equity contributions', 4); r += 1;
    ['Contribution', 'Amount', 'Timing', 'Type'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
    r += 1;
    for (const e of state.equityContributions) {
      setLabel(ws.getCell(`A${r}`), e.name);
      setInput(ws.getCell(`B${r}`), e.amount ?? 0, NUMFMT.money);
      setInput(ws.getCell(`C${r}`), String(e.timing ?? 'upfront'), '@');
      setInput(ws.getCell(`D${r}`), String(e.type ?? 'cash'), '@');
      equityRefs.push({ id: e.id, name: e.name, amount: addr('B', r) });
      r += 1;
    }
    r += 1;
  }

  // Existing operations equity (historical), on operational-phase assets.
  const opPhaseIds = new Set(state.phases.filter((ph) => ph.status === 'operational').map((ph) => ph.id));
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

  // ── Module 2: Revenue inputs per line, then Escrow ─────────────────────────
  inputDivider('REVENUE INPUTS');
  section((c) => emitRevenueInputs(c, state, snap));
  section((c) => emitEscrowInputs(c, state, snap));

  // ── Module 3: Opex inputs per line and accounts payable ────────────────────
  inputDivider('OPEX INPUTS');
  section((c) => emitOpexInputs(c, state));

  // ── Module 4: P&L inputs and depreciation inputs ───────────────────────────
  inputDivider('FINANCIAL STATEMENT INPUTS');
  section((c) => emitStatementInputsSection(c, state));
  section((c) => emitDepreciationSection(c, state, snap));

  // ── Module 5: Returns assumptions ──────────────────────────────────────────
  inputDivider('RETURNS INPUTS');
  section((c) => emitReturnsSection(c, state, snap));

  ws.views = [{ state: 'frozen', ySplit: 2, showGridLines: false }];
  return {
    startYearName: 'ProjectStartYear', axisLength: snap.axisLength, capex: capexRefs,
    assets: assetRefs, subUnits: subUnitRefs, parcels: [], tranches: trancheRefs, equity: equityRefs,
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
  // UTC READS (2026-09-17). The export runs in the browser, and a local-time
  // read of "2027-01-01" is December 2026 anywhere west of UTC, which moved the
  // dated schedule and every Gantt bar a year.
  const yr = (d: string): number => utcYear(d, snap.projectStartYear);
  const fmtDate = (d: string): string => utcMonthYear(d);

  const lines = phases.map((p) => ({ phase: p, tl: computePhaseTimeline(p, project) }));
  const projTl = computeProjectTimeline(project, phases);

  // ── 1. Phase schedule (real dates) ──────────────────────────────────────────
  setSectionHeader(ws.getRow(r), 'Phase schedule (dated)', last, ARGB.sectionDark); r += 1;
  const HEADS = ['Phase', 'Status', 'Construction start', 'Construction end', 'Operations start', 'Operations end', 'Construction (yrs)', 'Operations (yrs)'];
  HEADS.forEach((h, i) => setColHeader(ws.getCell(r, 1 + i), h, i === 0 || i === 1 ? 'left' : 'right'));
  r += 1;
  for (const { phase, tl } of lines) {
    setLabel(ws.getCell(r, 1), phase.name);
    setLabel(ws.getCell(r, 2), phaseStatusLabel(phase.status));
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
  note.value = 'Dates are the model\'s own phase timeline (phase start date, construction periods and operations periods). Operations start the period after construction ends; a legacy overlap on an older project pulls them forward, and operations then shade over construction in that year.';
  note.font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
}

// Strategy -> display group, shared by the Land & Area and Capex groupings.
function strategyGroup(strategy: string): 'Residential' | 'Hospitality' | 'Retail' | 'Other' {
  if (strategy === 'Operate') return 'Hospitality';
  if (strategy === 'Lease') return 'Retail';
  if (strategy === 'Sell' || strategy === 'Sell + Manage') return 'Residential';
  return 'Other';
}

// ── Land & Area (Module 1 tab 5, Tables 3 and 4, and land by asset) ───────────
//
// THE TOP-DOWN CHAIN, AS THE ASSETS TAB DERIVES IT (2026-09-17). Each plot's
// land x utilisation gives the net developable area, x coverage the footprint,
// x FAR the total GFA; the retail share of the footprint is ground-floor retail
// (its own leased strip, which carves its land out of its hosts), the rest of
// the footprint is lobby, and service comes off the main asset GFA to leave the
// NSA; units, parking slots and parking areas follow, and Total BUA is Total
// GFA plus parking. Table 3 runs it per plot, Table 4 adds the same rows per
// line. The land block below is what capex charges and the balance sheet
// holds, by sqm only, through the platform's own land rule. Every figure is
// read from the function the screen calls (assetInputsView.ts); nothing here
// recomputes a rule.
function addLandArea(wb: ExcelJS.Workbook, state: FinancialsResolverState, refs: AssumptionRefs): Map<string, LandAreaAssetAddrs> {
  const ws = wb.addWorksheet(SHEETS.landArea, { properties: { tabColor: { argb: ARGB.navy } } });
  ws.getColumn(1).width = 34;
  for (let c = 2; c <= LAND_CHAIN_COLS + 3; c++) ws.getColumn(c).width = 14;
  setTitle(ws.getCell('A1'), 'Land & Area', 16);
  setNote(ws.getCell('A1'), `${SNAPSHOT_NOTE}\n\nSourced from Inputs (plots, Table 2 massing, asset type values). Feeds the Capex quantity bases (Main Asset GFA, Parking Area, Landscape Area, Plot Area, Retail GFA, Retail Parking Area) and the Balance Sheet land.`);
  setLabel(ws.getCell('A2'), 'The Assets tab\'s derived areas, top-down per plot (land x utilisation x coverage / FAR), merged by line, then the land each asset holds by sqm (a retail strip\'s land is carved from its hosts). The per-column Basis / Calculation is in the legend below the tables.');

  const cursor: SheetCursor = { wb, ws, sheetName: SHEETS.landArea, r: 4 };
  const tables = buildAssetAreaTables(state);
  emitLandTables(cursor, tables);

  // LAND BY ASSET, filed by the capex category rule (a strip always Retail).
  const LAND_HEADS = ['Asset', 'Land (sqm)', 'Land rate', 'Land value', 'Cash land', 'In-kind land'];
  const land = buildAssetLandView(state);
  let r = cursor.r;
  setSectionHeader(ws.getRow(r), 'Land by asset (what Capex charges and the Balance Sheet holds)', LAND_HEADS.length); r += 1;
  LAND_HEADS.forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right')); r += 1;
  const landAddrsByAsset = new Map<string, LandAreaAssetAddrs>();
  const firstBodyRow = r;
  for (const cat of CAPEX_SECTIONS) {
    const rows = land.filter((x) => x.category === cat);
    if (rows.length === 0) continue;
    setLabel(ws.getCell(r, 1), cat, { bold: true }); fillRange(ws, r, 1, r, LAND_HEADS.length, ARGB.subtotal); r += 1;
    for (const a of rows) {
      setLabel(ws.getCell(r, 1), a.name, { indent: 1 });
      setFormula(ws.getCell(r, 2), fcell('0', a.landSqm), NUMFMT.int);
      setFormula(ws.getCell(r, 3), fcell('0', a.landRate), NUMFMT.rate);
      setFormula(ws.getCell(r, 4), fcell('0', a.landValue), NUMFMT.money);
      setFormula(ws.getCell(r, 5), fcell('0', a.cashLandValue), NUMFMT.money);
      setFormula(ws.getCell(r, 6), fcell('0', a.inKindLandValue), NUMFMT.money);
      landAddrsByAsset.set(a.assetId, {
        landValue: sheetRef(SHEETS.landArea, `$D$${r}`),
        cashLand: sheetRef(SHEETS.landArea, `$E$${r}`),
        inKindLand: sheetRef(SHEETS.landArea, `$F$${r}`),
        unitCount: '0',
        revenue: '0',
      });
      r += 1;
    }
    setLabel(ws.getCell(r, 1), `Total ${cat}`, { bold: true });
    const sum = (pick: (x: typeof rows[number]) => number): number => rows.reduce((s, x) => s + pick(x), 0);
    setFormula(ws.getCell(r, 2), fcell('0', sum((x) => x.landSqm)), NUMFMT.int);
    setFormula(ws.getCell(r, 4), fcell('0', sum((x) => x.landValue)), NUMFMT.money);
    setFormula(ws.getCell(r, 5), fcell('0', sum((x) => x.cashLandValue)), NUMFMT.money);
    setFormula(ws.getCell(r, 6), fcell('0', sum((x) => x.inKindLandValue)), NUMFMT.money);
    fillRange(ws, r, 1, r, LAND_HEADS.length, ARGB.navy);
    for (let c = 1; c <= LAND_HEADS.length; c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } };
    r += 1;
  }
  setLabel(ws.getCell(r, 1), 'TOTAL, all assets', { bold: true });
  setFormula(ws.getCell(r, 2), fcell('0', land.reduce((s, x) => s + x.landSqm, 0)), NUMFMT.int);
  setFormula(ws.getCell(r, 4), fcell('0', land.reduce((s, x) => s + x.landValue, 0)), NUMFMT.money);
  setFormula(ws.getCell(r, 5), fcell('0', land.reduce((s, x) => s + x.cashLandValue, 0)), NUMFMT.money);
  setFormula(ws.getCell(r, 6), fcell('0', land.reduce((s, x) => s + x.inKindLandValue, 0)), NUMFMT.money);
  fillRange(ws, r, 1, r, LAND_HEADS.length, ARGB.subtotal);
  r += 1;
  void firstBodyRow; void refs;

  // ── Basis / Calculation legend (per column) ────────────────────────────────
  let lr = r + 1;
  setSectionHeader(ws.getRow(lr), 'Basis / Calculation (per column)', 8); lr += 1;
  const COL_BASIS: Array<[string, string]> = [
    ['Plot Area (sqm)', 'The sqm the asset draws from its plot on Table 2 (a blank draws the whole plot). A retail strip\'s share is carved from its hosts: retail GFA over the host\'s total GFA, at that plot\'s rate.'],
    ['Net Developable Area', 'Plot Area x Land Utilisation %'],
    ['Building Footprint', 'Net Developable Area x Ground Coverage %'],
    ['Landscape %', '1 - Ground Coverage %'],
    ['Landscape and Open Area', 'Net Developable Area x Landscape %'],
    ['Retail GFA', 'Building Footprint x Retail % (ground floor). Carried by the line\'s retail strip, not its host'],
    ['Lobby and Circulation GFA', 'Building Footprint - Retail GFA (none when there is no retail)'],
    ['Total GFA', 'Net Developable Area x FAR (a host excludes the retail GFA its strip carries)'],
    ['Main Asset GFA', 'Total GFA - Retail GFA - Lobby and Circulation GFA; the whole Total GFA when there is no retail'],
    ['NSA or GLA', 'Main Asset GFA x (1 - Service %)'],
    ['Average Unit Size', 'Sub-unit unit sizes first, the asset type\'s size as the fallback'],
    ['Units or Keys', 'NSA / Average Unit Size, rounded to whole units (a sub-unit count wins)'],
    ['Parking Ratio', 'The asset type\'s ratio: slots per unit, or sqm of GFA per slot'],
    ['Parking Slots', 'Units x ratio (slots per unit) or Main Asset GFA / ratio (sqm per slot), whole slots'],
    ['Retail Parking Slots', 'Retail GFA / the retail type\'s sqm per slot, whole slots'],
    ['Parking Area', 'Parking Slots x Parking area per slot (Asset Types & Standards)'],
    ['Retail Parking Area', 'Retail Parking Slots x Parking area per slot'],
    ['Total BUA', 'Total GFA + Total Parking Area, everything built'],
    ['Land value', 'Land (sqm) x the plot\'s rate; land is allocated by sqm only'],
    ['Cash land / In-kind land', 'Land value x the plot\'s Cash % / In-Kind %'],
  ];
  for (const [colName, basisText] of COL_BASIS) {
    setLabel(ws.getCell(lr, 1), colName, { bold: true });
    const bc = ws.getCell(lr, 2); bc.value = basisText; bc.font = { name: 'Calibri', size: BODY_SIZE, italic: true, color: { argb: ARGB.navyDark } };
    lr += 1;
  }

  // ── Structural zeros ────────────────────────────────────────────────────────
  // An existing operational asset has no new build, and a companion's area sits
  // on its hosts. Beside assets reporting real areas a bare 0 reads as missing
  // data, so the reasons are named as a footnote.
  {
    const notes = buildAssetNotes(state, (v) => `${formatAccounting(v, 'millions', 1)} m`);
    const nilRows = land.filter((a) => notes.hasBuaNote(a.assetId, a.builtAreaSqm) !== null);
    const raised = notes.takeFootnotes();
    if (nilRows.length > 0 && raised.length > 0) {
      lr += 1;
      setSectionHeader(ws.getRow(lr), 'Assets reporting nil built-up area (and why)', 8); lr += 1;
      for (const a of nilRows) {
        const z = notes.byAssetId.get(a.assetId);
        setLabel(ws.getCell(lr, 1), `${a.name} ${z ? z.marker : ''}`, { bold: true });
        lr += 1;
      }
      for (const fn of raised) {
        const fc = ws.getCell(lr, 1); fc.value = fn.text;
        fc.font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
        lr += 1;
      }
    }
  }

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2, showGridLines: false }];
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

function addCapex(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, capex: CapexReport, refs: AssumptionRefs, landAddrs: Map<string, LandAreaAssetAddrs>, state: FinancialsResolverState): CapexAddrs {
  void landAddrs;
  const ws = wb.addWorksheet(SHEETS.capex, { properties: { tabColor: { argb: ARGB.navy } } });
  const N = refs.axisLength;
  // Capex-LOCAL geometry (the other period sheets keep the shared geometry): one
  // extra metadata column, so A = Cost line / Line, B = Method / Phase, C = Rate,
  // D = Quantity / Rate source, E = Total, F = Prior (opening), G.. = active years.
  const C_LBL = 1, C_UOM = 2, C_RATE = 3, C_QTY = 4, C_TOT = 5, C_OPEN = 6;
  const cP = (t: number): number => C_OPEN + 1 + t;   // G.. active period t
  const cLast = C_OPEN + N;                            // last active column
  const cChk = cLast + 1;
  const cSrc = cLast + 2;                              // phasing source (inputs only)
  const TOL = 0.0001;
  const TITLE = 'Capex';
  const SUB = 'Development cost by line, as on the platform Capex tab. Inputs: each line\'s method, rate, rate source and phasing source, with the allocation profile the engine resolved. Results: the consolidated preview by type, Table 1 the schedule by cost line, Tables 2 to 4 the line summaries by phase (incl. all land, excl. land in-kind, excl. total land), Table 5 land cash and in-kind per phase, Table 6 capex by category. Platform values, hardcoded.';

  // ── Capex-local frozen 4-row header (rows 3 dates / 4 index; freeze A-E) ──
  ws.getColumn(C_LBL).width = 40; ws.getColumn(C_UOM).width = 30; ws.getColumn(C_RATE).width = 12; ws.getColumn(C_QTY).width = 19; ws.getColumn(C_TOT).width = 15;
  for (let c = C_OPEN; c <= cLast; c++) ws.getColumn(c).width = 12;
  // Never exactly 9: ExcelJS drops a width equal to its default (TRAPS 3.1).
  ws.getColumn(cChk).width = 10;
  ws.getColumn(cSrc).width = 44;
  setTitle(ws.getCell('A1'), TITLE, 16);
  setNote(ws.getCell('A1'), `${SNAPSHOT_NOTE}\n\nSourced from the Capex cost lines and the Assets tab areas. Feeds Cost of Sales, Financing, Schedules and the Balance Sheet.`);
  setLabel(ws.getCell('A2'), SUB);
  setColHeader(ws.getCell(4, C_LBL), 'Cost line', 'left');
  setColHeader(ws.getCell(4, C_UOM), 'Method', 'left');
  setColHeader(ws.getCell(4, C_RATE), 'Rate', 'right');
  setColHeader(ws.getCell(4, C_QTY), 'Quantity', 'right');
  setColHeader(ws.getCell(4, C_TOT), 'Total', 'right');
  setColHeader(ws.getCell(4, cChk), 'Check', 'center');
  for (let c = C_OPEN; c <= cLast; c++) {
    // The Capex opening column is F, one column right of the shared geometry
    // (the extra Quantity column), so its year is read one column to the left.
    const cl = colLetter(c - 1);
    const d = ws.getCell(3, c);
    setFormula(d, fcell(sheetRef(SHEETS.timeline, `${cl}3`), colYear(snap, c - 1)), NUMFMT.date, true);
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

  // ── Helpers ────────────────────────────────────────────────────────────────
  const put = (rr: number, c: number, v: number, fmt: string = NUMFMT.money): void => {
    const cell = ws.getCell(rr, c); cell.value = v; cell.numFmt = fmt; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
  };
  const sumN = (a: number[]): number => a.slice(0, N).reduce((s, v) => s + (v ?? 0), 0);
  const addInto = (acc: number[], a: readonly number[] | undefined): void => { for (let t = 0; t < N; t++) acc[t] += a?.[t] ?? 0; };
  const zeros = (): number[] => new Array<number>(N).fill(0);
  /** One money row: label, optional B text, Total (E), Prior (F = 0), periods. */
  const moneyRow = (rr: number, label: string, series: readonly number[], opts: { b?: string; style?: 'plain' | 'subtotal' | 'navy'; indent?: number; total?: number } = {}): void => {
    const style = opts.style ?? 'plain';
    setLabel(ws.getCell(rr, C_LBL), label, { indent: opts.indent, bold: style !== 'plain' });
    if (opts.b !== undefined) setLabel(ws.getCell(rr, C_UOM), opts.b);
    put(rr, C_OPEN, 0);
    for (let t = 0; t < N; t++) put(rr, cP(t), series[t] ?? 0);
    put(rr, C_TOT, opts.total ?? sumN([...series]));
    if (style !== 'plain') {
      const fill = style === 'navy' ? ARGB.navy : ARGB.subtotal; const fg = style === 'navy' ? ARGB.white : ARGB.navyDark;
      fillRange(ws, rr, 1, rr, cLast, fill);
      for (let c = 1; c <= cLast; c++) ws.getCell(rr, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: fg } };
    }
  };
  const band = (rr: number, text: string): void => {
    setLabel(ws.getCell(rr, C_LBL), text, { bold: true }); fillRange(ws, rr, 1, rr, cLast, ARGB.subtotal);
    for (let c = 1; c <= cLast; c++) ws.getCell(rr, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
  };
  const subHeader = (rr: number, heads: Array<[number, string, 'left' | 'right' | 'center']>): void => {
    for (const [c, text, align] of heads) setColHeader(ws.getCell(rr, c), text, align);
  };
  const note = (rr: number, text: string): void => {
    setLabel(ws.getCell(rr, C_LBL), text);
    ws.getCell(rr, C_LBL).font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
  };

  // ── THE LINES, AS THE SCREEN NAMES THEM (2026-09-17) ───────────────────────
  // refs.capex is the report pooled BY LINE (one block per consolidated line,
  // in the planner's order). The line's phase, type label and plots come from
  // the SAME planner the screen's Table 1 uses, so the heading reads
  // "Phase 1: Branded Villas (Land 1 + Land 2)" here as it does there.
  const multiPhase = state.phases.length > 1;
  const members = (hostId: string): string[] => {
    for (const [, ids] of refs.capexMembers ?? new Map<string, string[]>()) if (ids.includes(hostId)) return ids;
    return [hostId];
  };
  const withCapex = new Set<string>(refs.capex.flatMap((a) => members(a.assetId)));
  const plannedLines = planReportLines(state, (a) => withCapex.has(a.id));
  const lineOf = (hostId: string) => plannedLines.find((l) => l.assetIds.includes(hostId));
  const ctxNames = { parcels: state.parcels, phases: state.phases };
  const inputById = new Map(capex.inputAssets.map((ia) => [ia.assetId, ia] as const));
  const seriesById = new Map(capex.assetSeries.map((s) => [s.assetId, s] as const));
  const costLineById = new Map(state.costLines.map((c) => [c.id, c] as const));
  interface LineMeta { hostId: string; heading: string; label: string; phaseId: string; phaseName: string; ref: CapexAssetRef; incl: number[]; exclInKind: number[]; exclAll: number[] }
  const lines: LineMeta[] = refs.capex.map((a) => {
    const ln = lineOf(a.assetId);
    const phaseName = ln?.phaseName ?? a.phaseName;
    const label = ln?.label ?? a.name;
    const plots = (ln?.assetIds ?? [a.assetId])
      .map((id) => state.assets.find((x) => x.id === id))
      .map((x) => (x ? assetPlotLabel(x, ctxNames) : undefined))
      .filter((p): p is string => !!p);
    const heading = `${multiPhase && phaseName ? `${phaseName}: ${label}` : label}${plots.length > 0 ? ` (${plots.join(' + ')})` : ''}`;
    const ser = seriesById.get(a.assetId);
    return {
      hostId: a.assetId, heading, label, phaseId: ln?.phaseId ?? ser?.phaseId ?? '', phaseName, ref: a,
      incl: ser?.inclAll ?? zeros(), exclInKind: ser?.exclInKind ?? zeros(), exclAll: ser?.exclAll ?? zeros(),
    };
  });
  const inputLine = (hostId: string, lineId: string) => inputById.get(hostId)?.lines.find((l) => l.id === lineId);
  const methodLabel = (method: string, basis: string): string => (COST_METHOD_LABELS as Record<string, string>)[method] ?? basis;

  let r = 5;

  // ── INPUTS: the cost lines by line ─────────────────────────────────────────
  setSectionHeader(ws.getRow(r), 'Inputs - Cost lines by line (method, rate, rate source, phasing source) and the allocation profile the engine resolved', cLast); r += 1;
  // CONSTRUCTION COST ESCALATION (2026-09-16): one project rate, set on the
  // Types and Standards tab, applied to every cost RATE into the years its line
  // spends. Stated here because every total below already includes it.
  const escPct = state.project.costEscalationPct ?? 0;
  setLabel(ws.getCell(r, C_LBL), `Construction cost escalation (% a year, from ${snap.projectStartYear}, set on Types and Standards)`, { bold: true });
  setInput(ws.getCell(r, C_RATE), escPct / 100, NUMFMT.pct2);
  setLabel(ws.getCell(r, C_QTY), escPct === 0 ? 'Off' : 'Applied');
  r += 1;
  note(r, escPct === 0
    ? 'Escalation is off, so every total is rate x quantity at base-year money.'
    : 'Every rate is base-year money and escalates into the years its line spends; a lump sum, the land value lines and anything charged on land or revenue do not escalate. A percentage line charges on the escalated base, so Quantity below reads the escalated base.');
  r += 2;
  subHeader(r, [[C_LBL, 'Cost line', 'left'], [C_UOM, 'Method', 'left'], [C_RATE, 'Rate', 'right'], [C_QTY, 'Rate source', 'left'], [C_TOT, 'Total %', 'right'], [cChk, 'Check', 'center'], [cSrc, 'Phasing source (engine-resolved window)', 'left']]);
  r += 1;
  for (const m of lines) {
    band(r, m.heading); r += 1;
    for (const ln of m.ref.lines) {
      const src = inputLine(m.hostId, ln.id);
      const total = ln.amount;
      const pp = src?.perPeriod ?? [];
      setLabel(ws.getCell(r, C_LBL), ln.name, { indent: 1 });
      setLabel(ws.getCell(r, C_UOM), methodLabel(ln.method, ln.basis));
      put(r, C_RATE, ln.isPercent ? ln.rate / 100 : ln.rate, ln.isPercent ? NUMFMT.pct2 : NUMFMT.rate);
      setLabel(ws.getCell(r, C_QTY), src?.rateFromStandards ? 'Types and Standards' : 'Capex line');
      // The allocation profile is ENGINE OUTPUT (the line's resolved spend over
      // its total), so it is formula-black, never input-shaded.
      let pctSum = 0;
      put(r, C_OPEN, 0, NUMFMT.pct2);
      for (let t = 0; t < N; t++) {
        const pct = total ? (pp[t] ?? 0) / total : 0;
        put(r, cP(t), pct, NUMFMT.pct2);
        pctSum += pct;
      }
      put(r, C_TOT, pctSum, NUMFMT.pct2);
      const ok = Math.abs(pctSum - (total ? 1 : 0)) <= TOL;
      const chk = ws.getCell(r, cChk); chk.value = ok ? 'OK' : 'CHECK'; chk.alignment = { horizontal: 'center' };
      chk.font = { name: 'Calibri', size: BODY_SIZE, bold: !ok, color: { argb: ok ? ARGB.navy : ARGB.bad } };
      const cl = costLineById.get(ln.id);
      const win = src?.resolvedWindow;
      const srcId = win?.source ?? src?.phasingSource ?? 'inherit';
      const srcText = cl && isLandValueLine(cl)
        ? 'Parcel payment schedule'
        : `${(CAPEX_PHASING_SOURCE_LABELS as Record<string, string>)[srcId] ?? srcId}${win ? `, periods ${win.startPeriod} to ${win.endPeriod}` : ''}${win?.degraded ? ' (source empty, own window used)' : ''}`;
      setLabel(ws.getCell(r, cSrc), srcText);
      r += 1;
    }
  }
  r += 1;

  // ── Consolidated by type, what a grouped schedule would show ───────────────
  // The Capex Results tab's first table, from the SAME rows and the SAME
  // builder: the report's treatment rows (`capexTreatmentRows`) through
  // `perAssetCostsFromTreatment` into `buildConsolidatedReport`, with its own
  // reconciliation against the per-asset total stated beneath it, as on screen.
  {
    const treatIds = new Set(capex.treatment.map((t) => t.id));
    const previewAssets = state.assets.filter((a) => treatIds.has(a.id));
    const cons = buildConsolidatedReport(previewAssets, state.phases, perAssetCostsFromTreatment(capex.treatment));
    const [cPhase, cType, cStrat, cCount, cLand, cHard, cSoft, cOp, cTotal] = [C_LBL, C_UOM, C_RATE, C_QTY, C_TOT, C_OPEN, C_OPEN + 1, C_OPEN + 2, C_OPEN + 3];
    setSectionHeader(ws.getRow(r), 'Consolidated by type, what a grouped schedule would show', cLast); r += 1;
    note(r, `Grouped by phase, asset type and strategy. Preview only: every schedule below is still per line. ${cons.isRelabellingOnly
      ? 'Nothing merges on this project, so each row is one asset under a different label.'
      : `${cons.mergedRows.length} row${cons.mergedRows.length === 1 ? '' : 's'} merge more than one asset.`}`);
    r += 2;
    subHeader(r, [[cPhase, 'Phase', 'left'], [cType, 'Type', 'left'], [cStrat, 'Strategy', 'left'], [cCount, 'Assets', 'right'], [cLand, 'Land', 'right'], [cHard, 'Hard', 'right'], [cSoft, 'Soft', 'right'], [cOp, 'Operating', 'right'], [cTotal, 'Total', 'right']]);
    r += 1;
    const moneyCells = (rr: number, v: { land: number; hard: number; soft: number; operating: number; total: number }): void => {
      put(rr, cLand, v.land); put(rr, cHard, v.hard); put(rr, cSoft, v.soft); put(rr, cOp, v.operating); put(rr, cTotal, v.total);
    };
    for (const row of cons.rows) {
      setLabel(ws.getCell(r, cPhase), row.phaseName, { indent: 1 });
      setLabel(ws.getCell(r, cType), row.typed ? row.typeLabel : `${row.typeLabel} (untyped, so it groups alone)`);
      setLabel(ws.getCell(r, cStrat), row.strategy);
      put(r, cCount, row.assetCount, NUMFMT.int);
      moneyCells(r, row);
      r += 1;
    }
    setLabel(ws.getCell(r, cPhase), 'Total', { bold: true });
    put(r, cCount, cons.rows.reduce((n, x) => n + x.assetCount, 0), NUMFMT.int);
    moneyCells(r, cons.totals);
    fillRange(ws, r, 1, r, cTotal, ARGB.subtotal);
    for (let c = 1; c <= cTotal; c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    r += 1;
    const ties = Math.abs(cons.difference) < 0.005;
    const fmtMoney = (v: number): string => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    setLabel(ws.getCell(r, cPhase), ties
      ? `Ties to the per-asset total: ${fmtMoney(cons.perAssetTotal)}.`
      : `Does NOT tie to the per-asset total (${fmtMoney(cons.perAssetTotal)}), out by ${fmtMoney(cons.difference)}. Treat the per-asset tables as authoritative.`);
    ws.getCell(r, cPhase).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ties ? ARGB.good : ARGB.bad } };
    r += 2;
  }

  // ── Table 1: the schedule by cost line, one block per line ─────────────────
  setSectionHeader(ws.getRow(r), 'Table 1 - Construction Cost Schedule by Period (per cost line, by line)', cLast); r += 1;
  subHeader(r, [[C_LBL, 'Line / Cost line', 'left'], [C_UOM, 'Method', 'left'], [C_RATE, 'Rate', 'right'], [C_QTY, 'Quantity', 'right'], [C_TOT, 'Total', 'right']]);
  r += 1;
  const moneyBasis = new Set(['percent_of_inkind_land', 'percent_of_cash_land', 'percent_of_total_land', 'percent_of_total_revenue', 'percent_of_revenue_cash', 'percent_of_revenue_sale', 'percent_of_selected', 'percent_of_construction']);
  const subtotalRows: number[] = [];
  const allLineTotals: number[] = [];
  const perAssetCapex = new Map<string, { inclRow: number; exclInKindRow: number; exclAllRow: number }>();
  for (const m of lines) {
    band(r, m.heading); r += 1;
    for (const ln of m.ref.lines) {
      const src = inputLine(m.hostId, ln.id);
      setLabel(ws.getCell(r, C_LBL), ln.name, { indent: 1 });
      setLabel(ws.getCell(r, C_UOM), methodLabel(ln.method, ln.basis));
      const rateDec = ln.isPercent ? ln.rate / 100 : ln.rate;
      put(r, C_RATE, rateDec, ln.isPercent ? NUMFMT.pct2 : NUMFMT.rate);
      // Quantity = the base the rate multiplies, read back from the engine's own
      // amount (a lump sum is 1), so Rate x Quantity = Total always reads true.
      put(r, C_QTY, ln.method === 'fixed' ? 1 : (rateDec !== 0 ? ln.amount / rateDec : 0), moneyBasis.has(ln.method) ? NUMFMT.money : NUMFMT.int);
      const pp = src?.perPeriod ?? zeros();
      put(r, C_OPEN, 0);
      for (let t = 0; t < N; t++) put(r, cP(t), pp[t] ?? 0);
      put(r, C_TOT, ln.amount);
      allLineTotals.push(ln.amount);
      r += 1;
    }
    moneyRow(r, `Subtotal - ${multiPhase && m.phaseName ? `${m.phaseName}: ${m.label}` : m.label}`, m.incl, { style: 'subtotal', total: m.ref.total });
    subtotalRows.push(r);
    perAssetCapex.set(m.hostId, { inclRow: r, exclInKindRow: r, exclAllRow: r });
    r += 1;
  }
  const grandIncl = snap.financing.capex.perPeriod.inclAllLand.slice(0, N);
  const projTotalRow = r;
  moneyRow(r, 'Project Total', grandIncl, { style: 'navy', total: sumN(grandIncl) });
  r += 2;

  // ── Tables 2 to 4: one row per line, the phase in its own column ──────────
  // Screen order and labels: Line | Phase | Total | Prior | periods, a subtotal
  // under each phase where the project has more than one, then Total.
  const summaryTable = (title: string, pick: (m: LineMeta) => number[], key: 'exclInKindRow' | 'exclAllRow' | null): number => {
    setSectionHeader(ws.getRow(r), title, cLast); r += 1;
    subHeader(r, [[C_LBL, 'Line', 'left'], [C_UOM, 'Phase', 'left'], [C_TOT, 'Total', 'right']]);
    r += 1;
    const grand = zeros();
    let block: { phaseId: string; phaseName: string; series: number[] } | null = null;
    const closeBlock = (): void => {
      if (!block || !multiPhase) return;
      moneyRow(r, `Subtotal, ${block.phaseName}`, block.series, { style: 'subtotal' }); r += 1;
    };
    for (const m of lines) {
      const series = pick(m);
      if (Math.abs(sumN(series)) <= 0.5) continue;
      if (block && block.phaseId !== m.phaseId) { closeBlock(); block = null; }
      if (!block) block = { phaseId: m.phaseId, phaseName: m.phaseName, series: zeros() };
      moneyRow(r, m.label, series, { b: m.phaseName, indent: 1 });
      const reg = key ? perAssetCapex.get(m.hostId) : undefined; if (reg && key) reg[key] = r;
      addInto(block.series, series); addInto(grand, series);
      r += 1;
    }
    closeBlock();
    const totalRow = r;
    moneyRow(r, 'Total', grand, { style: 'navy' }); r += 2;
    return totalRow;
  };
  summaryTable('Table 2 - Total Capex Including Land Value', (m) => m.incl, null);
  const exclInKindTotalRow = summaryTable('Table 3 - Capex Excluding Land In-Kind (cash-impact schedule)', (m) => m.exclInKind, 'exclInKindRow');
  const exclAllTotalRow = summaryTable('Table 4 - Capex Excluding Total Land (pure development cost)', (m) => m.exclAll, 'exclAllRow');

  // ── Table 5: land cash and in-kind, per phase (what Financing funds) ──────
  // The engine's own per-phase series (CapexAggregate.landByPhase), the figures
  // the Financing tab's land funding block reads.
  setSectionHeader(ws.getRow(r), 'Table 5 - Land: Cash and In-Kind (what Financing funds)', cLast); r += 1;
  note(r, 'The land inside Table 2, split into the cash the project pays and the value contributed in kind, per phase. Cash + in-kind = Table 2 less Table 4. The memo lists what else sits in the land stage, so land value + memo = the land stage total.');
  r += 2;
  subHeader(r, [[C_LBL, 'Land', 'left'], [C_UOM, 'Phase', 'left'], [C_TOT, 'Total', 'right']]);
  r += 1;
  const landBlocks = (snap.financing.capex.landByPhase ?? [])
    .map((lp) => ({ ...lp, cash: lp.landCash.slice(0, N), inKind: lp.landInKind.slice(0, N) }))
    .filter((b) => Math.abs(sumN(b.cash) + sumN(b.inKind)) > 0.5);
  const gCash = zeros(); const gInKind = zeros();
  if (landBlocks.length === 0) { note(r, 'No land value in this view.'); r += 1; }
  for (const b of landBlocks) {
    moneyRow(r, 'Land, cash', b.cash, { b: b.phaseName, indent: 1 }); r += 1;
    moneyRow(r, 'Land, in-kind', b.inKind, { b: b.phaseName, indent: 1 }); r += 1;
    if (multiPhase) { moneyRow(r, `Subtotal, ${b.phaseName}`, b.cash.map((v, t) => v + (b.inKind[t] ?? 0)), { style: 'subtotal' }); r += 1; }
    addInto(gCash, b.cash); addInto(gInKind, b.inKind);
  }
  if (landBlocks.length > 0) {
    moneyRow(r, 'Total land, cash', gCash, { style: 'navy' }); r += 1;
    moneyRow(r, 'Total land, in-kind', gInKind, { style: 'navy' }); r += 1;
    const gLand = gCash.map((v, t) => v + (gInKind[t] ?? 0));
    moneyRow(r, 'Total land', gLand, { style: 'navy' }); r += 1;
    // THE MEMO: every line in the land STAGE that is not land VALUE (RETT, a
    // transfer fee), per phase, from the engine's own per-line schedules.
    const memoLines = state.costLines.filter((c) => deriveCostStage(c) === 'land' && !isLandValueLine(c));
    const memoIds = new Set(memoLines.map((c) => c.id));
    const memoLabel = memoLines.length > 0
      ? `Memo: ${[...new Set(memoLines.map((c) => c.name))].join(', ')} (land stage, not land value)`
      : 'Memo: land-stage costs not in land value';
    const gMemo = zeros();
    for (const b of landBlocks) {
      const memo = zeros();
      for (const m of lines) {
        if (m.phaseId !== b.phaseId) continue;
        for (const ln of m.ref.lines) if (memoIds.has(ln.id)) addInto(memo, inputLine(m.hostId, ln.id)?.perPeriod);
      }
      if (Math.abs(sumN(memo)) <= 0.5) continue;
      moneyRow(r, memoLabel, memo, { b: b.phaseName, indent: 1 }); r += 1;
      addInto(gMemo, memo);
    }
    if (Math.abs(sumN(gMemo)) > 0.5) {
      moneyRow(r, `${memoLabel}, total`, gMemo, { style: 'subtotal' }); r += 1;
      moneyRow(r, 'Land stage total (land value + memo, as the tiles show)', gLand.map((v, t) => v + (gMemo[t] ?? 0)), { style: 'navy' }); r += 1;
    }
  }
  r += 1;

  // ── Table 6: capex by category, both readings ─────────────────────────────
  // The report builder's category tables, filed per ASSET by assetCapexCategory
  // (a retail strip under Retail), each block footing to Table 2 and Table 4.
  setSectionHeader(ws.getRow(r), 'Table 6 - Capex by Category (Residential, Hospitality, Retail)', cLast); r += 1;
  note(r, 'Every line filed under its asset type\'s category; a retail strip files under Retail. The first block foots to Table 2, the second to Table 4.');
  r += 2;
  subHeader(r, [[C_LBL, 'Category', 'left'], [C_TOT, 'Total', 'right']]);
  r += 1;
  const catTables: Array<[string, string]> = [['Capex by Category (incl. all land)', 'Including all land'], ['Capex by Category (excl. total land)', 'Excluding total land']];
  for (const [title, label] of catTables) {
    const t = capex.results.find((x) => x.title === title);
    if (!t) continue;
    band(r, label); r += 1;
    const total = zeros();
    for (const row of t.rows) {
      if (row.isTotal) continue;
      moneyRow(r, row.label, row.values, { indent: 1 }); r += 1;
      addInto(total, row.values);
    }
    moneyRow(r, `${label}, total`, total, { style: 'navy' }); r += 1;
  }
  r += 1;

  // Build-up vs phased reconciliation, read by the Checks tab: every cost line's
  // total summed must equal Table 1's Project Total.
  setLabel(ws.getCell(r, C_LBL), 'Check: every cost line total summed (ties to Table 1 Project Total)', { bold: true });
  put(r, C_TOT, allLineTotals.reduce((s, v) => s + v, 0));
  const buildupTotalAddr = sheetRef(SHEETS.capex, `$E$${r}`);
  const scheduleTotalAddr = sheetRef(SHEETS.capex, `$E$${projTotalRow}`);
  void subtotalRows;

  return {
    scheduleTotalAddr, buildupTotalAddr,
    inclTotalRow: projTotalRow, exclInKindTotalRow, exclAllTotalRow,
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
  moneyRow: (label: string, series: number[] | undefined, opts?: { style?: RowStyle; indent?: number; basis?: string; prior?: number; totalLast?: boolean; totalValue?: number; noTotal?: boolean; noPeriods?: boolean; numFmt?: string }) => number;
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
  const moneyRow = (label: string, series: number[] | undefined, opts: { style?: RowStyle; indent?: number; basis?: string; prior?: number; totalLast?: boolean; totalValue?: number; noTotal?: boolean; noPeriods?: boolean; numFmt?: string } = {}): number => {
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
    // A row with no period series (a capital base, a column caption) writes no
    // period cells at all. Writing zeros there printed 0 in every year column
    // beside a figure that is a single amount, not a flow (2026-09-17).
    if (!opts.noPeriods) {
      put(OPEN_COL, opts.prior ?? 0);
      for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    }
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
  //
  // A GROUP HEADING THAT CARRIES VALUES IS A SUBTOTAL ROW, as the screen renders
  // it (m4Table: only a heading with no values is a banner). Printing every
  // heading as a blank band dropped the Residential / Hospitality / Retail
  // revenue totals, the cost of sales total and the opex group totals from the
  // P&L and the Cash Flow (2026-09-17).
  //
  // THE PHASE A ROW BELONGS TO goes in the Basis column, as the screen's Phase
  // column and the PDF's [P1] tag carry it, so two lines of the same type in
  // different phases ("Standalone Commercial" twice) can be told apart.
  const emitM4 = (row: M4Row): number => {
    if (row.isSection && (row.collapseRole !== 'header' || row.values.length === 0)) { subTitle(row.label); return r - 1; }
    const opts = m4RowOpts(row);
    const used = moneyRow(row.label, row.values, row.isSection ? { ...opts, style: 'subtotal' } : opts);
    if (row.phaseLabel) setBasis(ws.getCell(used, META_B), /^\d+$/.test(row.phaseLabel) ? `Phase ${row.phaseLabel}` : row.phaseLabel);
    return used;
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
interface RetLinks { rs: ReturnsSnapshot | null }

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
  // SELLING COSTS FIRST, as the Output screen leads with them: the rows are the
  // shared builder's (`buildSellingCostReport`), the same per-line rows, notes,
  // counts and year-on-year schedule the screen renders.
  {
    const sc = buildSellingCostReport({
      revenue: snap.revenue, assets: state.assets, phases: state.phases, costLines: state.costLines,
      costOverrides: state.costOverrides, parcels: state.parcels, landAllocationMode: state.landAllocationMode,
      project: state.project, subUnits: state.subUnits, yearLabels: yl, projectStartYear: psy,
    });
    if (sc) {
      em.groupBand(`Selling Costs (${cur})`);
      em.headNote(SELLING_COSTS_CAPTION);
      em.colHeaders([[1, 'Asset', 'left'], [2, 'Phase', 'left'], [3, 'Strategy', 'left'], [4, 'Line', 'left'], [5, 'Rate', 'right'], [6, 'Basis', 'left'], [7, 'Basis amount', 'right'], [8, 'Cost', 'right']]);
      for (const row of sc.display) {
        em.cellsRow([
          [1, row.label, '@'], [2, row.phaseName, '@'], [3, row.strategy, '@'], [4, row.lineName, '@'],
          [5, row.ratePct / 100, NUMFMT.pct2], [6, row.basisLabel, '@'], [7, row.basisAmount, NUMFMT.money], [8, row.amount, NUMFMT.money],
        ]);
      }
      for (const n of sc.zeroNotes) em.headNote(`${n.label} / ${n.lineName}: ${n.note}`);
      {
        const tr = em.cursor();
        setLabel(ws.getCell(tr, 1), 'Total selling costs', { bold: true });
        const tc = ws.getCell(tr, 8); tc.value = sc.result.total; tc.numFmt = NUMFMT.money;
        fillRange(ws, tr, 1, tr, 8, ARGB.subtotal);
        for (let c = 1; c <= 8; c++) ws.getCell(tr, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
        em.gap();
      }
      em.headNote(sc.footnote);
      em.gap();
      if (sc.schedule) {
        em.tableTitle(`Selling Costs, Year on Year (${cur})`, SELLING_COSTS_YOY_CAPTION);
        em.colHeaders([[1, 'Asset', 'left'], [2, 'Line', 'left'], [TOTAL_COL, 'Total', 'right']]);
        for (const row of sc.schedule.rows) em.moneyRow(row.assetName, row.values, { indent: 1, basis: row.lineName });
        em.moneyRow('Total selling costs', sc.schedule.totals, { style: 'total' });
        em.headNote(sc.schedule.checkText(ctx.labelMoney));
      }
      em.gap();
    }
  }
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
// the same shared report builders the on-screen tabs + PDF use, with the
// screen's section numbers, table titles and row labels. Nothing is shown that
// the platform does not show. In STATIC mode the FinLinks rows are referenced only inside
// discarded formula strings on the downstream tabs (their values come from the
// real snapshot model), so a stub registry is returned.
function addFinancing(ctx: EmitCtx): FinLinks {
  const { wb, snap, state } = ctx;
  const N = snap.axisLength;
  const fin = snap.financing;
  const ws = wb.addWorksheet(SHEETS.financing, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Financing', 'The platform Financing tab, all four sub-tabs in order: 1. Inputs (settings, funding method, land funding, debt facilities, capex breakdown, funding requirement, debt and equity required), 2. Schedules (debt movement, combined debt service, finance cost, IDC allocation, equity movement), 3. Funding Gap (Method 2 and Method 3), 4. Cash Sweep (settings, dividend policy, cash waterfall, per-facility sweep). Platform values, hardcoded.', { label: 'Line', feeds: 'Sourced from Capex, Revenue (collections), Opex and the financing inputs. Feeds the P&L, Cash Flow, Balance Sheet and Returns.' });
  const fmtNum = (v: number): string => String(v);
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const sl = (a: readonly number[] | undefined): number[] => (a ?? []).slice(0, N) as number[];
  const neg = (a: readonly number[]): number[] => a.map((v) => -(v ?? 0));
  const sum = (a: readonly number[] | undefined): number => sl(a).reduce((s, v) => s + (v ?? 0), 0);
  const nz = (a: readonly number[] | undefined): boolean => sl(a).some((v) => Math.abs(v ?? 0) > 0.005);
  const last = lastActiveCol(N);
  let r = 5;

  // ── Cell writers ───────────────────────────────────────────────────────────
  const constCell = (cell: ExcelJS.Cell, v: number | string, numFmt: string): void => {
    cell.value = v; cell.numFmt = numFmt; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
  };
  /** A scalar in the Total column. `input` shades it: a value the user types on
   *  the platform. Derived figures stay formula-black. */
  const scalar = (label: string, value: number | string, numFmt: string, basis: string, input = false, indent?: number): void => {
    setLabel(ws.getCell(r, LBL_COL), label, { indent });
    if (basis) setBasis(ws.getCell(r, META_B), basis);
    const cell = ws.getCell(r, TOTAL_COL);
    if (input) setInput(cell, value, numFmt); else constCell(cell, value, numFmt);
    r += 1;
  };
  const note = (text: string): void => {
    if (!text) return;
    setLabel(ws.getCell(r, LBL_COL), text);
    ws.getCell(r, LBL_COL).font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
    r += 1;
  };
  const subTitle = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, last, ARGB.subtotal);
    for (let c = 1; c <= last; c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    r += 1;
  };
  const groupBand = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, last, ARGB.navy);
    for (let c = 1; c <= last; c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } };
    r += 1;
  };
  /**
   * One period row from an M4Row. THE OVERRIDE IS A VALUE (2026-09-01): a
   * stated `totalOverride` is printed as the Total. A BLANK override is the
   * "no total, use the state rule" sentinel. A state row with no override prints
   * its LAST period, never a sum of a balance (item 5 of the 2026-09-17 review).
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
        : vals.slice(0, N).reduce((s, v) => s + (v ?? 0), 0) + (row.priorValue ?? 0);
    put(TOTAL_COL, total);
    if (row.isTotal) {
      fillRange(ws, r, 1, r, last, ARGB.navy);
      for (let c = 1; c <= last; c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white }, italic: c === META_B }; }
    } else if (row.isSubtotal) {
      for (let c = 1; c <= last; c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark }, italic: c === META_B }; }
    }
    r += 1;
  };
  /** A per-period INPUT row (a schedule the user types, one cell per year). */
  const inputSeries = (label: string, values: number[], numFmt: string, basis: string): void => {
    setLabel(ws.getCell(r, LBL_COL), label, { indent: 1 });
    if (basis) setBasis(ws.getCell(r, META_B), basis);
    for (let t = 0; t < N; t++) setInput(ws.getCell(r, pcol(t)), values[t] ?? 0, numFmt);
    constCell(ws.getCell(r, TOTAL_COL), values.slice(0, N).reduce((s, v) => s + (v ?? 0), 0), numFmt);
    r += 1;
  };

  // ── BASIS TEXT, BY EXACT LABEL (item 20) ───────────────────────────────────
  // It matched substrings in a fixed order, so every "Closing" row (a finance
  // cost ledger, the equity roll-forward, closing cash) read the DEBT rule.
  // Each row now says what IT is, keyed on its own label and its table.
  const basisFor = (label: string, table: string): string => {
    const t = table.toLowerCase();
    const exact: Record<string, string> = {
      'Capex Drawdown': 'Debt share of the development funding need',
      'IDC Drawdown (capitalized interest)': 'IDC the pre-interest cash cannot cover, drawn as debt',
      'Total Drawdown': 'Capex drawdown + IDC drawdown',
      'Principal Repaid': 'Scheduled principal repaid',
      'Principal Repaid (incl. cash sweep)': 'Scheduled + cash-swept principal',
      'Total Capex Drawdown': 'Sum of the facilities\' capex drawdowns',
      'Total IDC Drawdown': 'Sum of the facilities\' IDC drawdowns',
      'Total Drawdown (Capex + IDC)': 'Capex drawdown + IDC drawdown',
      'Interest Expensed - Existing': 'Existing facilities, interest charged to the P&L',
      'Interest Expensed - New': 'New facilities, interest charged to the P&L',
      'Total Interest Expensed': 'Interest charged to the P&L once construction stops',
      'Principal Repaid - Existing': 'Existing facilities, principal repaid',
      'Principal Repaid - Existing (incl. sweep)': 'Existing facilities, principal repaid incl. sweep',
      'Principal Repaid - New': 'New facilities, principal repaid',
      'Principal Repaid - New (incl. sweep)': 'New facilities, principal repaid incl. sweep',
      'Total Principal Repaid': 'Scheduled + cash-swept principal, all facilities',
      'Debt Service - Existing': 'Existing facilities, interest paid + principal',
      'Debt Service - New': 'New facilities, interest paid + principal',
      'Total Debt Service (Cash)': 'Interest paid + principal repaid',
      'Charge (Accrued)': 'Facility rate x outstanding balance',
      'Charge (Accrued, all debts)': 'Sum of the facilities\' charges',
      'Capitalized': 'Interest drawn as debt (IDC drawdown)',
      'Paid': 'Interest paid in cash; IDC is paid when it arises',
      '(memo) of which funded by drawing debt': 'Part of the payment funded by the IDC drawdown',
      'Opening (incl. existing carry-forward)': 'Prior period closing (existing equity in the prior column)',
      'Cash Contribution': 'Equity drawn in cash',
      'Cash Contribution, development': 'Equity share of the development funding need',
      'Cash Contribution, fund management fee': 'Fund management fee drawn from equity directly',
      'In-Kind Contribution': 'In-kind land contributed as equity',
      'Existing Equity (pre-axis carry-forward)': 'Existing operations equity (prior column)',
      'Closing (cumulative equity)': 'Opening + cash + in-kind contributions',
      'Opening Cash': 'Prior period closing cash',
      '(+) Cash from Operations': 'Cash Flow, operating activities',
      '(-) Cash from Investing (capex)': 'Cash Flow, investing activities: capex, and the exit proceeds in the exit year',
      '(+) Equity Drawdown (Cash)': 'Cash equity drawn',
      '(+) Equity In-Kind (memo, non-cash)': 'In-kind land, not a cash inflow',
      '(+) Debt Drawdown (incl. additional to maintain min cash)': 'Cash debt drawn (capitalised IDC is non-cash)',
      '(-) Interest Paid': 'Cash interest paid',
      '= Cash Available': 'Opening + operations + investing + equity + debt - interest',
      '(memo) Minimum Cash Requirement (reserved, not spent)': 'Minimum cash reserve, held and never spent',
      '(memo) Headroom above the minimum reserve': 'Cash available - minimum reserve',
      '(-) Debt Paid (total principal incl. sweep)': 'Principal repaid, scheduled + sweep',
      '= Cash Available for Dividend': 'Cash available - debt paid',
      '(-) Dividend Paid (per policy, EBITDA-capped)': 'Distribution per the dividend policy',
      '= Closing Cash (ties to Cash Flow tab + Balance Sheet)': 'Cash available for dividend - dividend paid',
      'Project total debt outstanding (post-sweep)': 'Sum of the facilities\' post-sweep balances',
      'Total IDC (allocated to assets)': 'Capitalised construction interest, all lines',
      'Memo: Total construction interest (accrual)': 'Interest accrued while construction spends',
      'Subtotal: Sell IDC to CoS': 'Released through cost of sales as units are recognised',
      'Subtotal: Operate/Lease IDC to Fixed Assets': 'Added to the depreciable basis at handover',
      'Operate/Lease IDC Depreciation (charge to D&A)': 'Straight line over the useful life',
      'Disposed at Exit (capitalised interest sold with the asset)': 'Written off with the asset at the exit',
      'Operate/Lease IDC NBV (closing, sits on BS Fixed Assets)': 'Additions - depreciation - disposal',
    };
    if (label === 'Opening') return t.startsWith('finance cost') || t.startsWith('combined finance cost') ? 'Prior period closing (interest payable)' : 'Prior period closing';
    if (label === 'Closing') return t.startsWith('finance cost') || t.startsWith('combined finance cost') ? 'Opening + charge - paid' : 'Opening + total drawdown - principal repaid';
    if (exact[label]) return exact[label];
    if (label.startsWith('(-) Debt Paid: ')) return 'Principal repaid on this facility';
    if (label.endsWith(', Opening (pre-sweep)')) return 'Balance before this period\'s sweep';
    if (label.includes(', Sweep Applied (')) return 'Surplus swept to this facility';
    if (label.endsWith(', Closing (post-sweep)')) return 'Opening (pre-sweep) - sweep applied';
    if (label.endsWith(' (Additions)')) return 'Line share of IDC added to fixed assets';
    if (t.startsWith('idc allocation')) return 'Line share of the project IDC';
    if (t.startsWith('routed to cos')) return 'Line share of IDC in its capex basis';
    return '';
  };
  const emitTable = (table: ReportTable): void => {
    subTitle(table.title);
    for (const row of table.rows) emitM4(row, basisFor(row.label, table.title));
  };

  const gap = computeFundingGap(snap);
  const w = gap.method3Waterfall;
  const cfg = state.project.financing ?? DEFAULT_PROJECT_FINANCING_CONFIG;
  const fnd = fin.funding;
  const selId = (fnd.selectedMethodId ?? cfg.fundingMethod ?? 1) as FundingMethodId;
  const fundTerms = resolveFundTerms(state.project);
  const projectStartYear = snap.projectStartYear;
  const operationsEndYear = projectStartYear + Math.max(0, fin.axis.totalPeriods - 1);
  const pctFmt = NUMFMT.pct2;

  // ══ 1. INPUTS ══════════════════════════════════════════════════════════════
  setSectionHeader(ws.getRow(r), '1. Inputs (settings, funding method, land funding, debt facilities, capex breakdown, funding requirement, debt and equity required)', last, ARGB.accent); r += 1;
  note('Shaded cells are the values typed on the platform Financing Inputs tab; everything else is computed. Change an input on the platform and re-export.');

  // The KPI tiles that open the Inputs tab.
  const totalDebtSized = sum(fin.debtEquitySplit.debt);
  const totalEquitySized = sum(fin.debtEquitySplit.equity);
  let financeCostExisting = 0; let financeCostNew = 0;
  for (const t of state.financingTranches) {
    const f = fin.facilities.get(t.id); if (!f) continue;
    const s = f.interestPaid.reduce((a, v) => a + (v ?? 0), 0);
    if (t.origin === 'existing') financeCostExisting += s; else financeCostNew += s;
  }
  const hasExistingTile = state.financingTranches.some((t) => t.origin === 'existing' && ((t.openingBalance ?? 0) > 0 || financeCostExisting > 0));
  subTitle('Summary');
  scalar('Total Funding', totalDebtSized + totalEquitySized, NUMFMT.money, 'Debt + Equity');
  scalar('Total Debt', totalDebtSized, NUMFMT.money, 'Capex + IDC funded');
  scalar('Total Equity', totalEquitySized, NUMFMT.money, 'Cash + In-kind');
  scalar('IDC (Construction)', sum(fin.combined.totalInterestCapitalized), NUMFMT.money, 'Interest capitalized');
  scalar('Finance Cost (New)', financeCostNew, NUMFMT.money, 'New facility interest paid');
  if (hasExistingTile) scalar('Finance Cost (Existing)', financeCostExisting, NUMFMT.money, 'Existing facility interest paid');
  r += 1;

  subTitle('1. Project Financing Settings');
  scalar('Minimum Cash Reserve', cfg.minimumCashReserve ?? 0, NUMFMT.money, 'Cash the project keeps on hand; a funding need only in periods with construction spend', true);
  r += 1;

  subTitle('1b. IDC (Interest During Construction) Policy');
  const idcBasis = state.project.idcConfig?.allocationBasis ?? 'land';
  scalar('Allocation Basis', idcBasis === 'bua' ? 'Total BUA' : 'Land Area', '@', 'How project IDC is split across non-companion assets', true);
  scalar('Treatment', 'Capitalised into asset cost, paid when it arises', '@', 'One treatment: IDC is paid in the period it arises, and debt is drawn only for the part cash cannot cover');
  r += 1;

  subTitle('2. Funding Method');
  scalar('Selected method', `Method ${selId}, ${FUNDING_METHOD_LABELS[selId]}`, '@', FUNDING_METHOD_DESCRIPTIONS[selId], true);
  if (fundTerms.enabled) {
    scalar('Fund management fee, funded by', fundTerms.managementFeeFunding === 'equity'
      ? '100% equity (drawn from equity directly, outside the ratio)'
      : 'Cash deficit funding (inside the requirement, at the debt / equity ratio)', '@', 'The same field as the Fund Terms tab', true);
  }
  r += 1;

  subTitle(`2a. Method ${selId} Configuration`);
  const matchNote = (d: number, e: number): string => (Math.abs(d + e - 100) < 0.01 ? 'Match: 100%' : `Match: ${(d + e).toFixed(2)}%`);
  if (selId === 4) {
    const m4 = cfg.fixedAmountConfig;
    scalar('Total Debt Amount', m4?.debtAmount ?? 0, NUMFMT.money, '', true);
    scalar('Total Equity Amount', m4?.equityAmount ?? 0, NUMFMT.money, '', true);
    const yoy = m4?.yoySchedule ?? [];
    inputSeries('Year-on-Year % schedule', Array.from({ length: N }, (_, t) => (yoy[t] ?? 0) / 100), pctFmt, `${projectStartYear} to ${operationsEndYear}, sums to 100`);
  } else {
    const pair = selId === 1 ? cfg.fixedRatio : selId === 2 ? cfg.netFundingConfig : cfg.cashDeficitConfig;
    const d = pair?.debtPct ?? 70; const e = pair?.equityPct ?? 30;
    scalar('Debt %', d / 100, pctFmt, matchNote(d, e), true);
    scalar('Equity %', e / 100, pctFmt, '', true);
  }
  r += 1;

  subTitle('3. Funding Basis');
  const fb = computeFundingBasis(fin);
  scalar('Drawdown Basis', FUNDING_METHOD_DESCRIPTIONS[selId], '@', '');
  scalar('Total Capex (excl Land In-Kind)', fb.capexExclInKind, NUMFMT.money, 'Capex Table 3 total');
  scalar('Total Funding Need', fb.fundingNeed, NUMFMT.money, 'Selected method + minimum cash');
  scalar('Funded from Project Cash', fb.fundedFromProjectCash, NUMFMT.money, 'Capex (excl. land in-kind) + minimum cash - funding need: pre-sales and operating cash');
  scalar('Sources vs Uses', fb.ok ? `Match (${Math.round(fb.sources).toLocaleString('en-US')})` : `Gap ${Math.round(fb.gap).toLocaleString('en-US')}`, '@', 'Debt + equity against the funding need of the selected method');
  r += 1;

  // 4. Land funding, per phase, from the capex engine's own per-phase series.
  subTitle('4. Land Funding (per phase, from the Capex results)');
  const landByPhase = fin.capex.landByPhase ?? [];
  if (landByPhase.length === 0) note('No phases with land yet.');
  for (const lp of landByPhase) {
    const phaseParcels = state.parcels.filter((p) => p.phaseId === lp.phaseId);
    const cfgs = phaseParcels.map((p) => (cfg.parcelFunding ?? []).find((x) => x.parcelId === p.id));
    const debts = cfgs.map((c) => c?.debtPct ?? 0);
    const equities = cfgs.map((c, i) => c?.equityPct ?? (100 - debts[i]));
    const mixed = debts.some((d) => d !== debts[0]) || equities.some((e) => e !== equities[0]);
    const debtPct = debts[0] ?? 0; const equityPct = equities[0] ?? (100 - debtPct);
    emitM4({ label: `${lp.phaseName}, Land Cash (Capex Table 5)`, values: sl(lp.landCash) }, 'Capex Table 5, land cash');
    emitM4({ label: `${lp.phaseName}, Land In-Kind (Capex Table 5)`, values: sl(lp.landInKind) }, 'Capex Table 5, land in-kind');
    scalar(`${lp.phaseName}, Debt %`, debtPct / 100, pctFmt, mixed ? 'Mixed split across its plots; retype to unify' : 'Share of the phase land funded by debt', true, 1);
    scalar(`${lp.phaseName}, Equity %`, equityPct / 100, pctFmt, '', true, 1);
  }
  if (landByPhase.length > 0) {
    emitM4({ label: 'Total, Land Cash', values: landByPhase.reduce((acc, lp) => acc.map((v, t) => v + (lp.landCash[t] ?? 0)), zeros()), isSubtotal: true }, 'All phases');
    emitM4({ label: 'Total, Land In-Kind', values: landByPhase.reduce((acc, lp) => acc.map((v, t) => v + (lp.landInKind[t] ?? 0)), zeros()), isSubtotal: true }, 'All phases');
  }
  r += 1;

  // 5. Debt facilities, every term the facility card holds.
  subTitle('5. Debt Facilities');
  const newTranches = state.financingTranches.filter((t) => t.origin !== 'existing');
  const shareSum = [...fin.shares.values()].reduce((s, v) => s + v, 0);
  if (state.financingTranches.length === 0) note('No facilities yet.');
  if (newTranches.length > 1 && Math.abs(shareSum - 100) >= 0.01) {
    note(`Facility shares total ${shareSum.toFixed(2)}%, not 100%. Shares are used exactly as typed, so the facilities together draw ${shareSum.toFixed(2)}% of the project debt requirement.`);
  }
  const maxCp = state.phases.reduce((m, p) => Math.max(m, p.constructionPeriods ?? 0), 0);
  const defaultRepayStartYear = Math.min(operationsEndYear, projectStartYear + Math.max(1, maxCp));
  for (const t of state.financingTranches) {
    const isExisting = t.origin === 'existing';
    groupBand(`${t.name} (${isExisting ? 'existing' : 'new'} facility)`);
    scalar('Name', t.name, '@', '', true, 1);
    scalar('Lender', t.lender ?? '', '@', 'Bank / institution name', true, 1);
    scalar('Facility Origination', isExisting ? 'Existing' : 'New', '@', '', true, 1);
    const phase = state.phases.find((p) => p.id === t.phaseId);
    if (isExisting) {
      scalar('Phase', phase?.name ?? '', '@', '', true, 1);
      const phaseAssets = state.assets.filter((a) => a.phaseId === t.phaseId);
      const synced = phase?.status === 'operational' && phaseAssets.length > 0;
      scalar('Opening Balance', t.openingBalance ?? 0, NUMFMT.money, synced ? 'Auto-synced from per-asset Existing Debt' : 'Outstanding loan balance at project Y0', !synced, 1);
      scalar('Origination Year', t.originationYear ?? (projectStartYear - 1), NUMFMT.year, (t.originationYear ?? (projectStartYear - 1)) >= projectStartYear ? 'Draws as cash inflow that year' : 'Pre-project balance carries at Y0', true, 1);
      scalar('Interest Start Year', t.interestStartYear ?? projectStartYear, NUMFMT.year, '', true, 1);
    }
    const hasComponents = t.interbankRatePct !== undefined || t.creditSpreadPct !== undefined;
    const interbank = t.interbankRatePct ?? 0; const spread = t.creditSpreadPct ?? 0;
    scalar('Interbank Rate %', interbank / 100, pctFmt, '', true, 1);
    scalar('Credit Spread %', spread / 100, pctFmt, '', true, 1);
    scalar('Interest Rate %', (hasComponents ? interbank + spread : (t.interestRatePct ?? 0)) / 100, pctFmt, 'Interbank rate + credit spread', false, 1);
    scalar('Upfront Fee %', (t.upfrontFeePct ?? 0) / 100, pctFmt, '', true, 1);
    scalar('Commitment Fee %', (t.commitmentFeePct ?? 0) / 100, pctFmt, '', true, 1);
    scalar('Repayment Method', (REPAYMENT_METHOD_LABELS as Record<string, string>)[t.repaymentMethod] ?? String(t.repaymentMethod), '@', '', true, 1);
    const repayStart = t.repaymentStartYear ?? (isExisting ? projectStartYear : defaultRepayStartYear);
    scalar('Repayment Start Year', repayStart, NUMFMT.year, '', true, 1);
    if (t.repaymentMethod !== 'year_on_year_pct') {
      scalar('Repayment Periods', isExisting ? (t.remainingRepaymentPeriods ?? 0) : (t.repaymentPeriods ?? 0), NUMFMT.int, '', true, 1);
    } else {
      const sched = t.yearOnYearPctSchedule ?? [];
      inputSeries('Year-on-Year % Schedule', Array.from({ length: N }, (_, i) => {
        const k = projectStartYear + i - repayStart;
        return k >= 0 ? (sched[k] ?? 0) / 100 : 0;
      }), pctFmt, `From ${repayStart}, sums to 100`);
    }
    if (!isExisting && newTranches.length > 1) {
      scalar('Facility Share %', (t.facilitySharePct ?? fin.shares.get(t.id) ?? 0) / 100, pctFmt, 'of the project debt requirement', true, 1);
    }
    if (t.repaymentMethod === 'cash_sweep' || t.cashSweepConfig?.enabled === true || t.repaymentMethod === 'cashsweep_from_period' || t.repaymentMethod === 'cashsweep_min_cash') {
      note('Cash sweep starting year and ratio are set once for all loans under 4. Cash Sweep (Cash Sweep Settings). Loans are repaid existing-first, then in the order listed.');
    }
    if (isExisting && phase?.status === 'operational') {
      const b = phase.historicalBaseline;
      subTitle(`Existing Operations for ${phase.name}`);
      scalar('Cumulative Depreciation', b?.cumulativeDepreciationCharged ?? 0, NUMFMT.money, '', true, 1);
      scalar('Net Book Value (Fixed Assets)', b?.netBookValueFixedAssets ?? 0, NUMFMT.money, '', true, 1);
      scalar('Existing Retained Earnings', b?.existingRetainedEarnings ?? 0, NUMFMT.money, '', true, 1);
      scalar('Opening Cash (Y0)', b?.historicalOpeningCash ?? 0, NUMFMT.money, '', true, 1);
      for (const a of state.assets.filter((x) => x.phaseId === phase.id)) {
        scalar(`${a.name}, Pre-Capex Land Value`, Math.max(0, a.historicalPreCapexLand ?? 0), NUMFMT.money, 'Land does not depreciate', true, 1);
        scalar(`${a.name}, Pre-Capex Building / Infra`, Math.max(0, a.historicalPreCapexBuilding ?? 0), NUMFMT.money, '', true, 1);
        scalar(`${a.name}, Existing Debt`, Math.max(0, a.historicalDebtAmount ?? 0), NUMFMT.money, 'Flows into the facility Opening Balance', true, 1);
        scalar(`${a.name}, Existing Equity`, Math.max(0, a.historicalEquityAmount ?? 0), NUMFMT.money, '', true, 1);
      }
    }
  }
  r += 1;

  // 6. Capex Breakdown.
  subTitle('6. Capex Breakdown');
  const cx = fin.capex;
  emitM4({ label: 'Capex (excluding Land)', values: sl(cx.perPeriod.exclAllLand), totalOverride: fmtNum(cx.totals.exclAllLand) }, 'Capex Table 4');
  emitM4({ label: 'Land Cash Value', values: sl(cx.perPeriod.landCash), totalOverride: fmtNum(cx.totals.exclLandInKind - cx.totals.exclAllLand) }, 'Capex Table 5, land cash');
  emitM4({ label: 'Total Capex Incl Cash Land', values: sl(cx.perPeriod.exclLandInKind), isTotal: true, totalOverride: fmtNum(cx.totals.exclLandInKind) }, 'Capex Table 3');
  if (fin.existing.preCapexTotal > 0) emitM4({ label: 'Pre-Capex (existing operations)', values: zeros(), priorValue: fin.existing.preCapexTotal }, 'Existing operations, prior column');
  r += 1;

  // 7. Funding Requirement.
  subTitle('7. Funding Requirement');
  emitM4({ label: 'Method 1, Fixed Debt-to-Equity Ratio', values: sl(cx.perPeriod.exclLandInKind), totalOverride: fmtNum(fnd.method1) }, 'Total capex (excl. land in-kind)');
  emitM4({ label: 'Method 2, Net Funding Requirement', values: sl(gap.methodAGapPerPeriod) }, 'MAX(0, capex - prior-year net pre-sales)');
  emitM4({ label: 'Method 3, Cash Deficit Funding', values: sl(w.netCashRequiredPerPeriod) }, 'Development funding need (see 3. Funding Gap)');
  emitM4({ label: 'Method 4, Specified Debt + Equity (manual)', values: selId === 4 ? sl(fnd.selectedByPeriod) : zeros(), totalOverride: fmtNum(fnd.method4) }, 'Manually specified (per period only when selected)');
  emitM4({ label: `Selected (Method ${selId})`, values: sl(fnd.selectedByPeriod), isSubtotal: true, totalOverride: fmtNum(fnd.selected) }, 'The active method, drawn down in the Schedules');
  if ((fnd.minCashReserve ?? 0) > 0 && selId !== 3) {
    emitM4({ label: '+ Minimum Cash Reserve', values: sl(fnd.minCashByPeriod), totalOverride: fmtNum(fnd.minCashReserve) }, 'Minimum cash buffer added to the requirement');
    emitM4({ label: 'Total Funding Need', values: sl(fnd.totalFundingNeedByPeriod), isTotal: true, totalOverride: fmtNum(fnd.selectedWithMinCash) }, 'Selected requirement + minimum cash');
  }
  if ((fnd.minCashReserve ?? 0) > 0 && selId === 3) note('Method 3 absorbs the Minimum Cash Reserve implicitly via the deficit calculation.');
  r += 1;

  // 8. Total Debt Required.
  subTitle('8. Total Debt Required');
  const existingOpeningTotal = state.financingTranches.filter((t) => t.origin === 'existing').reduce((s, t) => s + Math.max(0, t.openingBalance ?? 0), 0);
  if (existingOpeningTotal > 0) emitM4({ label: 'Existing Debt (opening balance, pre-axis)', values: zeros(), priorValue: existingOpeningTotal }, 'Existing facilities, prior column');
  const idcNew = zeros();
  for (const t of newTranches) {
    const f = fin.facilities.get(t.id);
    emitM4({ label: t.name, values: sl(f?.drawSchedule) }, 'Facility share x the debt requirement');
    for (let i = 0; i < N; i++) idcNew[i] += f?.interestCapitalized[i] ?? 0;
  }
  const capexDraw = sl(fin.debtEquitySplit.debt);
  emitM4({ label: 'Capex Drawdown Subtotal', values: capexDraw, isSubtotal: true }, 'Debt share of the funding requirement');
  emitM4({ label: 'IDC Drawdown (capitalized interest)', values: idcNew }, 'IDC the pre-interest cash cannot cover');
  emitM4({ label: 'Total Debt Required (new draws + IDC)', values: capexDraw.map((v, i) => v + (idcNew[i] ?? 0)), isTotal: true }, 'Capex drawdown + IDC drawdown');
  r += 1;

  // 9. Total Equity Required.
  subTitle('9. Total Equity Required');
  const eq = fin.equity;
  const hasFeeEq = eq.totalManagementFee > 0.005;
  if (eq.totalExisting > 0) emitM4({ label: 'Existing Equity (pre-axis carry-forward)', values: zeros(), priorValue: eq.totalExisting }, 'Existing operations, prior column');
  emitM4({ label: hasFeeEq ? 'Cash Equity, development (equity share of the requirement)' : 'Cash Equity', values: sl(eq.developmentPerPeriod), totalOverride: fmtNum(eq.totalDevelopment) }, 'Equity share of the funding requirement');
  emitM4({ label: 'In-Kind Equity', values: sl(eq.inKindPerPeriod), totalOverride: fmtNum(eq.totalInKind) }, 'In-kind land contributed as equity');
  if (hasFeeEq) emitM4({ label: 'Cash Equity, fund management fee (drawn from equity directly)', values: sl(eq.managementFeePerPeriod), totalOverride: fmtNum(eq.totalManagementFee) }, 'Outside the debt / equity ratio');
  emitM4({ label: 'Total Equity Required', values: sl(eq.totalPerPeriod).map((v, i) => (i === 0 ? v - eq.totalExisting : v)), priorValue: eq.totalExisting, isTotal: true, totalOverride: fmtNum(eq.grandTotal) }, 'Existing + cash + in-kind');
  if (!fin.reconciliation.ok) {
    r += 1;
    subTitle(`Reconciliation Warnings (${fin.reconciliation.issues.length})`);
    for (const issue of fin.reconciliation.issues.slice(0, 8)) note(issue);
  }
  r += 1;

  // ══ 2. SCHEDULES ═══════════════════════════════════════════════════════════
  setSectionHeader(ws.getRow(r), '2. Schedules (debt movement, combined debt service, finance cost, IDC allocation by line, equity movement)', last, ARGB.accent); r += 1;
  const schedTables = buildFinancingScheduleTables(snap, state, fmtNum);
  const idcTables = buildIdcAllocationTables(snap, state, fmtNum);
  let group: string | undefined;
  for (const table of schedTables) {
    if (table.title === 'Equity Movement') {
      for (const it of idcTables) { emitTable(it); r += 1; }
      note(`Grand total ${Math.round(sum(snap.idc.totalIdcPerPeriod)).toLocaleString('en-US')} allocated by ${snap.idc.allocationBasis === 'bua' ? 'BUA share' : 'land share'}. Construction-active assets drive the per-period weights.`);
      group = undefined;
    }
    if (table.group && table.group !== group) groupBand(table.group);
    group = table.group;
    emitTable(table);
    r += 1;
  }

  // ══ 3. FUNDING GAP ═════════════════════════════════════════════════════════
  setSectionHeader(ws.getRow(r), '3. Funding Gap (Method 2 Net Funding Requirement, Method 3 Cash Deficit Funding)', last, ARGB.accent); r += 1;
  note('Method 2 sizes funding to the gap between capex and last year\'s net pre-sales. Method 3 sizes the new debt and equity each period to keep the minimum cash. Repayments, the sweep and dividends are under 4. Cash Sweep.');
  subTitle('Method 2, Net Funding Requirement (Capex vs Pre-Sales)');
  emitM4({ label: 'Total project capex (excl land in-kind)', values: sl(gap.capexPerPeriod), isSubtotal: true }, 'Capex Table 3 (cash capex)');
  emitM4({ label: 'Advance received from customer (gross)', values: sl(gap.preSalesGrossPerPeriod) }, 'Pre-sales cash collected (gross)');
  emitM4({ label: 'Less: Inaccessible funds locked (escrow held)', values: neg(sl(gap.escrowHeldPerPeriod)), indent: 1 }, 'Escrow held back from pre-sales');
  emitM4({ label: 'Add: Release of inaccessible funds (escrow release)', values: sl(gap.escrowReleasePerPeriod), indent: 1 }, 'Escrow released back to the project');
  emitM4({ label: 'Advance received from customer (net)', values: sl(gap.preSalesNetPerPeriod), isSubtotal: true }, 'Gross - escrow held + escrow release');
  emitM4({ label: 'Funding requirement fulfilled by pre-sales (LAST year, capped at capex)', values: sl(gap.fulfilledByPreSalesPerPeriod) }, 'Prior-year net pre-sales, capped at capex');
  emitM4({ label: 'Funding gap = MAX(Capex_t - Pre-Sales net_{t-1}, 0)', values: sl(gap.methodAGapPerPeriod), isTotal: true }, 'MAX(0, capex - prior-year net pre-sales)');
  emitM4({ label: 'Cumulative Funding Gap (A)', values: sl(gap.methodAGapCumulative), isSubtotal: true }, 'Running total of the funding gap', { stateRow: true });
  note(`Grand total gap (A): ${Math.round(gap.methodATotalGap).toLocaleString('en-US')}`);
  r += 1;

  // METHOD 3 ON THE SCREEN'S OWN SERIES (item 4): cash capex, the operating
  // inflows by asset class, the pre-financing net cash, the minimum, the opening,
  // the development funding need split at the ratio, the debt and equity
  // drawdowns, and the closing cash the engine carries. No finance cost and no
  // dividend is in the sizing.
  const debtPct = (fnd.debtPct ?? 0) / 100;
  const equityPct = (fnd.equityPct ?? 0) / 100;
  const debtSplit = sl(w.netCashRequiredPerPeriod).map((v) => v * debtPct);
  const equitySplit = sl(w.netCashRequiredPerPeriod).map((v) => v * equityPct);
  const idcAdd = sl(w.idcDrawdownPerPeriod);
  const totalNewDebt = debtSplit.map((v, i) => v + (idcAdd[i] ?? 0));
  const minCash = w.minCashReserve;
  const visibleAssets = state.assets.filter((a) => a.visible !== false);
  const classSeries = (pick: (a: (typeof visibleAssets)[number]) => boolean): number[] => {
    const out = zeros();
    for (const a of visibleAssets) {
      if (!pick(a)) continue;
      const cf = snap.perAssetCF.get(a.id);
      if (!cf) continue;
      for (let t = 0; t < N; t++) out[t] += (cf.revenueReceivedPerPeriod[t] ?? 0) - (cf.opexPaidPerPeriod[t] ?? 0);
    }
    return out;
  };
  const resColl = classSeries((a) => a.strategy === 'Sell' || a.strategy === 'Sell + Manage');
  const hospEbitda = classSeries((a) => a.strategy === 'Operate' || a.isCompanion === true);
  const retailNoi = classSeries((a) => a.strategy === 'Lease');
  const feeInSizing = w.feeFundedByEquity ? zeros() : sl(w.fundFeesPerPeriod).map((v) => -v);
  const opIn = sl(w.operatingInflowsPerPeriod);
  const otherOps = opIn.map((v, t) => v - (resColl[t] ?? 0) - (hospEbitda[t] ?? 0) - (retailNoi[t] ?? 0) - (feeInSizing[t] ?? 0));
  const feeDraw = sl(w.managementFeeEquityDrawPerPeriod);
  const hasFeeDraw = feeDraw.some((v) => v > 0.005);
  const totalEquityDraw = equitySplit.map((v, i) => v + (feeDraw[i] ?? 0));
  const feePaidFromCash = w.feeFundedByEquity ? sl(w.fundFeesPerPeriod).map((v, i) => -(v - (feeDraw[i] ?? 0))) : zeros();
  const existingDebtOpening = [...fin.facilities.values()].reduce((s, f) => s + Math.max(0, f.openingBalance ?? 0), 0);
  subTitle('Method 3, Cash Deficit Funding (Drawdown Sizing)');
  emitM4({ label: 'Cash Capex (construction, land cash, RETT)', values: sl(w.cashFromInvPerPeriod).map((v) => -v), isSubtotal: true, priorValue: fin.existing.preCapexTotal }, 'Capex Table 3 paid in cash');
  note('Operating inflows');
  if (nz(resColl)) emitM4({ label: 'Residential cash collection', values: resColl, indent: 1, priorValue: 0 }, 'Sell lines: collections less opex paid');
  if (nz(hospEbitda)) emitM4({ label: 'Hospitality EBITDA', values: hospEbitda, indent: 1, priorValue: 0 }, 'Operate lines: revenue received less opex paid');
  if (nz(retailNoi)) emitM4({ label: 'Retail NOI', values: retailNoi, indent: 1, priorValue: 0 }, 'Lease lines: rent received less opex paid');
  if (nz(feeInSizing)) emitM4({ label: '(-) Fund management fee', values: feeInSizing, indent: 1, priorValue: 0 }, 'Inside the deficit, funded at the ratio');
  if (otherOps.some((v) => Math.abs(v) > 0.005)) emitM4({ label: 'Other operating cash (HQ, tax, escrow movements)', values: otherOps, indent: 1, priorValue: 0 }, 'Total operating inflows less the classes above');
  emitM4({ label: '= Total operating inflows', values: opIn, isSubtotal: true, priorValue: 0 }, 'Sum of the operating inflows');
  emitM4({ label: '= Pre-financing net cash (inflows less cash capex)', values: sl(w.preFinancingNetCashPerPeriod), isTotal: true, priorValue: -fin.existing.preCapexTotal }, 'Total operating inflows - cash capex');
  emitM4({ label: 'Minimum cash target', values: new Array<number>(N).fill(minCash) }, 'Minimum cash reserve (a balance)', { stateRow: true });
  emitM4({ label: 'Opening cash', values: sl(w.openingCashPerPeriod), priorValue: snap.bs.historicalOpeningCashTotal }, 'Prior period closing cash', { stateRow: true });
  emitM4({ label: '(+) Existing equity opening', values: zeros(), indent: 1, priorValue: fin.existing.equityTotal }, 'Existing equity (prior column)');
  emitM4({ label: '(+) Existing debt opening balance', values: zeros(), indent: 1, priorValue: existingDebtOpening }, 'Existing debt (prior column)');
  emitM4({ label: '= Cash before financing', values: sl(w.cashAvailableBeforeNewDebtPerPeriod), isSubtotal: true }, 'Opening cash + pre-financing net cash', { stateRow: true });
  emitM4({ label: 'Development funding need = IF(cash capex > 0, MAX(0, minimum - cash before financing), 0)', values: sl(w.netCashRequiredPerPeriod), isTotal: true, priorValue: 0 }, 'Only in periods with construction spend');
  emitM4({ label: `Debt draw, base (${(debtPct * 100).toFixed(0)}%)`, values: debtSplit, indent: 2, priorValue: 0 }, 'Funding need x debt %');
  emitM4({ label: `Equity draw, base (${(equityPct * 100).toFixed(0)}%)`, values: equitySplit, indent: 2, priorValue: 0 }, 'Funding need x equity %');
  note('Debt drawdown');
  emitM4({ label: 'Debt Drawdown, capex', values: debtSplit, indent: 1, priorValue: 0 }, 'Debt draw, base');
  emitM4({ label: 'Debt Drawdown, IDC (the IDC the pre-interest cash cannot cover)', values: idcAdd, indent: 1, priorValue: 0 }, 'IDC less the headroom above the minimum');
  emitM4({ label: '= Total Debt Drawdown', values: totalNewDebt, isTotal: true, priorValue: 0 }, 'Capex + IDC drawdown');
  note('Equity drawdown');
  emitM4({ label: 'Equity Drawdown, development', values: equitySplit, indent: 1, priorValue: 0 }, 'Equity draw, base');
  if (w.feeFundedByEquity || hasFeeDraw) emitM4({ label: 'Equity Drawdown, fund management fee (direct, outside the ratio)', values: feeDraw, indent: 1, priorValue: 0 }, 'Only while construction spends, as far as keeps cash at the minimum');
  emitM4({ label: '= Total Equity Drawdown', values: totalEquityDraw, isTotal: true, priorValue: 0 }, 'Development + fund management fee');
  if (w.feeFundedByEquity && feePaidFromCash.some((v) => v !== 0)) emitM4({ label: '(-) Fund management fee paid from cash (not drawn)', values: feePaidFromCash, indent: 1, priorValue: 0 }, 'Fee not drawn from equity');
  emitM4({ label: 'Closing cash (after funding, before finance cost, sweep and dividends)', values: sl(w.closingCashAfterFundingPerPeriod), isTotal: true, priorValue: snap.bs.historicalOpeningCashTotal }, 'Engine closing cash after the drawdowns', { stateRow: true });
  note(`Lifetime: development funding need ${Math.round(w.totalNetCashRequired).toLocaleString('en-US')}; debt drawn ${Math.round(totalNewDebt.reduce((a, v) => a + v, 0)).toLocaleString('en-US')} (capex + IDC); equity drawn ${Math.round(totalEquityDraw.reduce((a, v) => a + v, 0)).toLocaleString('en-US')}${hasFeeDraw ? ` (of which fund management fee ${Math.round(feeDraw.reduce((a, v) => a + v, 0)).toLocaleString('en-US')})` : ''}. These are the figures in 8 and 9 above.`);
  r += 1;

  // ══ 4. CASH SWEEP ══════════════════════════════════════════════════════════
  setSectionHeader(ws.getRow(r), '4. Cash Sweep (sweep settings, dividend policy, cash waterfall, per-facility sweep and outstanding)', last, ARGB.accent); r += 1;
  const hasSweepLoan = state.financingTranches.some((t) => t.repaymentMethod === 'cash_sweep' || t.repaymentMethod === 'cashsweep_from_period' || t.repaymentMethod === 'cashsweep_min_cash' || t.cashSweepConfig?.enabled === true);
  if (hasSweepLoan) {
    // The start year shown is the one the model USES: the stored year, else the
    // default the screen resolves (after the last construction period).
    const defaultSweepStartYear = Math.max(projectStartYear, ...state.phases.map((ph) => {
      const sy = ph.startDate ? new Date(ph.startDate).getUTCFullYear() : projectStartYear;
      return ph.status === 'operational' ? sy : sy + Math.max(0, ph.constructionPeriods ?? 0);
    }));
    const cs = (state.project.financing?.cashSweep ?? {}) as { startingYear?: number; sweepRatioPct?: number };
    subTitle('Cash Sweep Settings');
    note('Applies to every loan whose repayment method is Cash Sweep. Loans are repaid existing-first, then in the order listed, from each period\'s surplus cash above the minimum reserve.');
    scalar('Sweep Starting Year (calendar)', cs.startingYear ?? defaultSweepStartYear, NUMFMT.year, `Default ${defaultSweepStartYear} (after capex)`, true);
    scalar('Sweep Ratio (% of excess cash)', (cs.sweepRatioPct ?? 100) / 100, pctFmt, 'Share of each period\'s surplus applied to debt', true);
    r += 1;
  }
  {
    const defaultDivStart = Math.max(projectStartYear, ...state.phases.map((ph) => {
      const psy = ph.startDate ? new Date(ph.startDate).getUTCFullYear() : projectStartYear;
      return ph.status === 'operational' ? projectStartYear : psy + Math.max(0, ph.constructionPeriods ?? 0);
    }));
    const dp = state.project.dividendPolicy;
    const legacyPhase = state.phases.find((ph) => ph.dividendPolicy?.enabled === true);
    const enabled = dp?.enabled ?? state.phases.some((ph) => ph.dividendPolicy?.enabled === true);
    const payout = dp?.payoutRatio ?? legacyPhase?.dividendPolicy?.payoutRatio ?? 0;
    const mode = dp?.mode ?? legacyPhase?.dividendPolicy?.mode ?? 'cash_above_min';
    subTitle('Dividend Policy');
    note('Dividends are paid after debt: the sweep repays debt first, then surplus cash above the minimum reserve is distributed per this policy. In the exit year 100% is paid to shareholders.');
    scalar('Pay Dividends', enabled ? 'On' : 'Off', '@', '', true);
    scalar('Payout Ratio', payout / 100, pctFmt, '', true);
    scalar('Basis', mode === 'pct_of_ebitda' ? '% of EBITDA' : 'Cash above min', '@', mode === 'pct_of_ebitda' ? 'Payout % of EBITDA (gated by cash)' : 'Payout % of cash above the minimum reserve', true);
    scalar('Start Year', state.project.dividendStartYear ?? defaultDivStart, NUMFMT.year, `Default ${defaultDivStart} (after the last construction period)`, true);
    r += 1;
  }
  const sweepTables = buildCashSweepTables(snap, state, fmtNum);
  for (const table of sweepTables) {
    emitTable(table);
    if (table.title.startsWith('Cash Waterfall')) {
      const idcCash = sl(w.idcCashPaidPerPeriod);
      if (nz(idcCash)) {
        note('Memo: IDC funding split, paid in cash where there is surplus, capitalised to debt otherwise');
        emitM4({ label: '(memo) IDC paid in cash', values: idcCash, indent: 1, priorValue: 0 }, 'IDC paid from surplus cash');
        if (nz(idcAdd)) emitM4({ label: '(memo) IDC capitalised to debt', values: idcAdd, indent: 1, priorValue: 0 }, 'IDC drawn as debt');
      }
      const sweepSnap = snap.cashSweep; const div = snap.dividends;
      const debtPaidLife = -sum(snap.directCF.debtRepaymentPerPeriod);
      note(`Lifetime: debt paid ${Math.round(debtPaidLife).toLocaleString('en-US')}${sweepSnap.enabled ? ` (of which cash sweep ${Math.round(sweepSnap.totalSweep).toLocaleString('en-US')})` : ''}${div.enabled ? `; dividends ${Math.round(div.totalDividends).toLocaleString('en-US')}` : ''}. Funding ratio ${(fnd.debtPct ?? 0).toFixed(0)}% debt / ${(fnd.equityPct ?? 0).toFixed(0)}% equity.`);
    }
    r += 1;
  }

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
  // as the Balance Sheet and Cash Flow tabs.
  writeSheetHeader(ws, snap, N, 'Schedules', 'Full mirror of the platform Module 4 Schedules, both sub-tabs in sequence: 1. Fixed Assets & D&A (depreciation inputs, land and depreciable roll-forwards per line with capitalised interest, project totals, IDC pool), 2. BS Schedules (balance-sheet feeder roll-forwards ordered ASSETS / LIABILITIES / EQUITY).', { label: 'Line', totalLabel: TOTAL_COLUMN_HEADINGS.mixed, feeds: `Sourced from Capex, depreciation, Modules 1-3 and the financing recurrence. Supports the Balance Sheet. ${TOTAL_COLUMN_NOTES.mixed}` });
  const E = makeEmitters(ws, N);

  // A fixed asset table from the shared builder: a balance row's Total column
  // holds its last period, a flow row's the sum, exactly as the screen prints.
  const emitFaTable = (t: FixedAssetTable): void => {
    E.subTitle(t.title);
    for (const row of t.rows) {
      E.moneyRow(row.label, row.values, {
        style: row.isTotal ? 'total' : row.isSubtotal ? 'subtotal' : 'plain',
        indent: row.indent,
        prior: row.priorValue,
        totalLast: row.aggregation === 'last',
        // The screen's Total ignores the prior-year cell; a summed row here must too.
        totalValue: row.aggregation === 'last' ? undefined : row.values.slice(0, N).reduce((s, v) => s + (v ?? 0), 0),
      });
    }
    E.note(t.caption);
  };

  // ── 1. Fixed Assets & D&A ────────────────────────────────────────────────────
  // THE SCREEN'S OWN TABLES (2026-09-17): `buildFixedAssetReport` is what the
  // Module 4 Fixed Assets & D&A sub-tab renders, so the inputs, the strategy
  // groups, the per line tables (capitalised interest inside the depreciable
  // roll-forward), the project tables and the IDC pool are the same rows here.
  E.section('1. Fixed Assets & D&A (land + depreciable NBV roll-forward, per line + project total)');
  const report = buildFixedAssetReport({ fa: snap.fixedAssets, idc: snap.idc, state, dCtx: disposalContextOf(snap) });
  if (report.inputs.length === 0) {
    E.note('No depreciable assets in this project. Sell-only projects route capex through Cost of Sales (Module 2 Tab 3) instead.');
  } else {
    E.groupBand('Depreciation Inputs (all assets)');
    const hr = E.cursor();
    setColHeader(ws.getCell(hr, LBL_COL), 'Asset', 'left');
    setColHeader(ws.getCell(hr, META_B), 'Strategy / Method', 'left');
    setColHeader(ws.getCell(hr, TOTAL_COL), 'Useful Life (yrs)', 'right');
    setColHeader(ws.getCell(hr, OPEN_COL), 'Rate', 'right');
    setColHeader(ws.getCell(hr, pcol(0)), 'Opening Land', 'right');
    setColHeader(ws.getCell(hr, pcol(1)), 'Opening Bldg NBV', 'right');
    E.gap();
    for (const i of report.inputs) {
      const rr = E.cursor();
      setLabel(ws.getCell(rr, LBL_COL), i.title, { indent: 1 });
      setBasis(ws.getCell(rr, META_B), `${i.strategyLabel}; ${i.method === 'reducing_balance' ? 'Reducing Balance (WDV)' : 'Straight Line (SL)'}`);
      // The life the engine uses, marked as an input. A blank stored life
      // inherits the category default, and the cell says so in its comment.
      const life = ws.getCell(rr, TOTAL_COL);
      life.value = i.lifeEffective; life.numFmt = NUMFMT.int; markInput(life);
      if (i.inheritsLife) setNote(life, `Blank on the platform: inherits the ${i.strategyLabel} category default of ${i.lifeEffective} years.`);
      const rate = ws.getCell(rr, OPEN_COL);
      rate.value = i.rateEffective; rate.numFmt = NUMFMT.pct;
      if (i.method === 'reducing_balance') markInput(rate);
      else rate.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
      const put = (c: number, v: number): void => { const cell = ws.getCell(rr, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
      put(pcol(0), i.openingLand);
      put(pcol(1), i.openingBuilding);
      E.gap();
    }
    E.note(report.inputsCaption);
  }
  for (const g of report.groups) {
    E.groupBand(`${g.title} (${g.lines.length} asset${g.lines.length === 1 ? '' : 's'})`);
    if (g.lines.length === 0) { E.note(g.emptyText); continue; }
    for (const l of g.lines) {
      emitFaTable(l.land);
      emitFaTable(l.depreciable);
      emitFaTable(l.total);
    }
  }
  E.groupBand('Project Total');
  emitFaTable(report.project.land);
  emitFaTable(report.project.depreciable);
  emitFaTable(report.project.total);
  if (report.project.idcPool) emitFaTable(report.project.idcPool);

  // ── 2. BS Schedules ──────────────────────────────────────────────────────────
  // The shared feeder tables, with their captions, grouped by section as the
  // screen groups them. This was a hand copy of the builder until 2026-09-17.
  E.section('2. BS Schedules (balance-sheet feeder roll-forwards, ordered ASSETS / LIABILITIES / EQUITY)');
  const feeders = buildBsFeederTables({ snap, state, fmt: (v: number) => String(v) });
  for (const sec of BS_FEEDER_SECTIONS) {
    const tables = feeders.filter((t) => t.section === sec.section);
    if (tables.length === 0) continue;
    E.groupBand(sec.section);
    for (const tbl of tables) { E.subTitle(tbl.title); E.emitTable(tbl.rows); E.note(tbl.caption); }
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
      E.moneyRow(c.isTotal ? `= ${c.label}` : c.label, undefined, { style: c.isTotal ? 'subtotal' : 'plain', totalValue: c.amount, basis: FUND_CAPITAL_BASE_TAG, noPeriods: true });
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
    E.moneyRow('What each fee is charged on', undefined, { style: 'subtotal', noTotal: true, noPeriods: true });
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
  writeSheetHeader(ws, snap, N, 'Balance Sheet', 'Full detailed mirror of the platform Module 4 balance sheet (consolidated), then the reconciliation bridge. Cash is the plug from the Direct Cash Flow Statement; the BS Check row reads 0 in every period when the statement balances.', { label: 'Line', totalLabel: totalColumnHeading(bsRows), feeds: `The platform balance sheet. Cash comes from the Direct Cash Flow; the bridge localises any difference to one line. ${totalColumnNote(bsRows)}` });
  const E = makeEmitters(ws, N);
  E.section('Balance Sheet: Project');
  E.emitTable(bsRows);
  // THE RECONCILIATION BRIDGE THE SCREEN SHOWS BENEATH THE STATEMENT (2026-09-17),
  // from the same shared builder, with the screen's caption.
  E.gap();
  E.section('Balance Check, Reconciliation Bridge (per period)');
  // The bridge is read PER PERIOD. Its leading cell is left blank rather than
  // summed, because this sheet's leading column is headed Closing and a lifetime
  // sum of period movements under that heading would read as a balance.
  for (const row of buildBsReconciliationRows({ snap, state, fmt: (v: number) => String(v) })) {
    if (row.isSection) { E.subTitle(row.label); continue; }
    E.moneyRow(row.label, row.values, { style: row.isTotal ? 'total' : row.isSubtotal ? 'subtotal' : 'plain', indent: row.indent, noTotal: true });
  }
  E.note(BS_RECONCILIATION_CAPTION);
}

// ── Case reports, built once per export ───────────────────────────────────────
// The Module 5 Case Comparison sub-tab and the Module 6 Comparison both read the
// same report, and every case is a full engine run, so it is computed once per
// bundle and shared by the two tabs.
const CASE_REPORT_CACHE = new WeakMap<CaseComparisonInput, CaseComparisonReport | null>();
function caseReportOf(input: CaseComparisonInput | undefined): CaseComparisonReport | null {
  if (!input) return null;
  if (CASE_REPORT_CACHE.has(input)) return CASE_REPORT_CACHE.get(input) ?? null;
  let rep: CaseComparisonReport | null = null;
  try { rep = buildCaseComparisonReport(input); } catch { rep = null; }
  CASE_REPORT_CACHE.set(input, rep);
  return rep;
}

// Display formatters shared by the Returns, Scenarios and Checks tabs. Strings,
// so the display-scale sweep leaves them alone; money is fixed in millions.
const retPct = (v: number | null | undefined, d = 1): string => (v != null && Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : 'n/a');
const retMult = (v: number | null | undefined): string => (v != null && Number.isFinite(v) ? `${v.toFixed(2)}x` : 'n/a');
const retMoney = (currency: string) => (v: number | null | undefined): string => `${currency} ${formatAccounting(v ?? 0, 'millions', 1)} m`;

/** The sensitivity variable names, as the Returns tab's selectors show them. */
const SENS_LABELS: Record<SensitivityVariable, { label: string; kind: 'rate' | 'shock' }> = {
  exit_cap_rate: { label: 'Exit Cap Rate', kind: 'rate' },
  discount_rate: { label: 'Discount Rate', kind: 'rate' },
  sales_price_pct: { label: 'Sales Price', kind: 'shock' },
  adr_pct: { label: 'ADR', kind: 'shock' },
  construction_cost_pct: { label: 'Construction Cost', kind: 'shock' },
};
const sensValueLabel = (v: SensitivityVariable, x: number): string =>
  SENS_LABELS[v].kind === 'rate' ? `${(x * 100).toFixed(1)}%` : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;

// ── Returns (mirror of Module 5: 1. Returns, 2. RE Metrics, 3. Case Comparison) ─
/** Module 5 in the order of its three sub-tabs, each section in the order its
 *  screen renders it, from the SAME builders the screens call (returns snapshot,
 *  stream / fund / disposal builders, the covenant reducers, the operating KPI
 *  builder, the case comparison report). Nothing the screens do not show is
 *  printed here, and nothing they show is left out. */
function addReturns(ctx: EmitCtx, revLinks: RevLinks, opexLinks: OpexLinks, fin: FinLinks): RetLinks {
  void revLinks; void opexLinks; void fin;
  const { wb, snap, lm, state, currency } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.returns, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Returns', 'Mirror of the platform Module 5 (Returns and Valuation), in the order of its three sub-tabs: 1. Returns, 2. RE Metrics, 3. Case Comparison.', { label: 'Line', feeds: 'Sourced from the Module 4 statements and the returns engine, on the case selected at export (Case Comparison computes every case).' });
  let r = 5;
  let rs: ReturnsSnapshot | null = null;
  try { rs = computeReturnsSnapshot(snap, state.project); } catch { rs = null; }

  const cPct = retPct, cMult = retMult, cMoney = retMoney(currency);

  // ── local emitters ──
  const section = (text: string): void => { setSectionHeader(ws.getRow(r), text, lastActiveCol(N), ARGB.accent); r += 1; };
  /** A short explanatory sentence (a screen caption). No-op on an empty string. */
  const note = (text: string): void => {
    if (!text) return;
    setLabel(ws.getCell(r, LBL_COL), text);
    ws.getCell(r, LBL_COL).font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
    r += 2;
  };
  /** A bold line of text (a screen heading that is not a table title, or a
   *  metric read-out like "DDM IRR 18.4% · MOIC 2.96x"). */
  const textLine = (text: string, bold = true): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold });
    r += 1;
  };
  const subTitle = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.subtotal);
    for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    r += 1;
  };
  // KPI card strip: a row of bordered tiles (label / value / sub), 2 columns
  // each, wrapping when the period axis runs out. The title is optional because
  // several of the screen's card grids have no heading of their own.
  const kpiStrip = (title: string, cards: Array<{ label: string; value: string; sub?: string; tone?: 'bad' | 'good' }>): void => {
    if (title) subTitle(title);
    const firstCol = OPEN_COL, lastCol = lastActiveCol(N), perCard = 2;
    const hasSub = cards.some((c) => c.sub);
    const h = hasSub ? 3 : 2;
    let col = firstCol;
    for (const card of cards) {
      if (col + perCard - 1 > lastCol) { col = firstCol; r += h + 1; }
      const c2 = col + perCard - 1;
      for (let rr = 0; rr < h; rr++) ws.mergeCells(r + rr, col, r + rr, c2);
      const lc = ws.getCell(r, col); lc.value = card.label; lc.font = { name: 'Calibri', size: 9, bold: true, color: { argb: ARGB.navyDark } }; lc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; fillCell(lc, ARGB.grey);
      const vc = ws.getCell(r + 1, col); vc.value = card.value; vc.font = { name: 'Calibri', size: 12, bold: true, color: { argb: card.tone === 'bad' ? ARGB.bad : card.tone === 'good' ? ARGB.good : ARGB.navy } }; vc.alignment = { horizontal: 'center', vertical: 'middle' };
      if (hasSub) { const sc = ws.getCell(r + 2, col); sc.value = card.sub ?? ''; sc.font = { name: 'Calibri', size: 8, italic: true, color: { argb: ARGB.navyDark } }; sc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; }
      boxBorder(ws, r, col, r + h - 1, c2);
      col = c2 + 1;
    }
    r += h + 1;
  };
  // Scalar row: label in A, value in the Total column (D). `input` shades it as
  // an assumption the user edits on the platform.
  const scalarRow = (label: string, value: number | string, numFmt: string, opts: { bold?: boolean; input?: boolean; basis?: string } = {}): void => {
    setLabel(ws.getCell(r, LBL_COL), label, { bold: opts.bold });
    const c = ws.getCell(r, TOTAL_COL); c.value = value; c.numFmt = numFmt;
    c.font = { name: 'Calibri', size: BODY_SIZE, bold: opts.bold, color: { argb: opts.bold ? ARGB.navy : ARGB.formula } };
    if (typeof value === 'string') c.alignment = { horizontal: 'right' };
    if (opts.input) markInput(c);
    if (opts.basis) setBasis(ws.getCell(r, META_B), opts.basis);
    r += 1;
  };
  // A grid of cells: header[0] and each row's label in A, the rest across from
  // the opening column (E). A cell is a string (display text), a number with its
  // format, or null (blank). `input` shades a cell as an assumption.
  type GridCell = string | null | { v: number | string; fmt?: string; input?: boolean; bold?: boolean; tone?: 'good' | 'bad'; fill?: string };
  const grid = (title: string, headers: string[], rows: Array<{ label: string; cells: GridCell[]; bold?: boolean; input?: boolean; indent?: number }>): void => {
    if (title) subTitle(title);
    setColHeader(ws.getCell(r, LBL_COL), headers[0], 'left');
    for (let i = 1; i < headers.length; i++) setColHeader(ws.getCell(r, OPEN_COL + i - 1), headers[i], 'right');
    r += 1;
    for (const row of rows) {
      const lc = ws.getCell(r, LBL_COL);
      setLabel(lc, row.label, { bold: row.bold, indent: row.indent });
      if (row.input) markInput(lc);
      row.cells.forEach((cell, i) => {
        if (cell == null) return;
        const c = ws.getCell(r, OPEN_COL + i);
        const o = typeof cell === 'string' ? { v: cell } : cell;
        c.value = o.v;
        c.numFmt = typeof o.v === 'number' ? (o.fmt ?? NUMFMT.money) : '@';
        c.alignment = { horizontal: 'right' };
        c.font = { name: 'Calibri', size: BODY_SIZE, bold: !!(o.bold || row.bold), color: { argb: o.tone === 'bad' ? ARGB.bad : o.tone === 'good' ? ARGB.good : ARGB.formula } };
        if (o.fill) fillCell(c, o.fill);
        if (o.input) markInput(c);
      });
      r += 1;
    }
    r += 1;
  };
  // A money row from an array (label + opening + per-period + Total).
  const moneyRow = (label: string, series: number[] | undefined, opts: { style?: 'plain' | 'subtotal' | 'total'; prior?: number; indent?: number; basis?: string } = {}): number => {
    const used = r;
    const vals = (series ?? []).slice(0, N);
    setLabel(ws.getCell(r, LBL_COL), label, { bold: !!(opts.style && opts.style !== 'plain'), indent: opts.indent });
    const put = (c: number, v: number): void => { const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
    put(OPEN_COL, opts.prior ?? 0);
    for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    put(TOTAL_COL, (opts.prior ?? 0) + vals.reduce((s, v) => s + (v ?? 0), 0));
    if (opts.style === 'total') { fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.navy); for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } }; }
    else if (opts.style === 'subtotal') { for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } }; }
    if (opts.basis) setBasis(ws.getCell(r, META_B), opts.basis);
    r += 1;
    return used;
  };
  // Fund layer: render one M4Row from the SHARED fund builders, whose series are
  // already on the stream basis (index 0 = inception, the opening column E) and
  // whose balance rows carry an empty totalOverride meaning "no lifetime total".
  const emitFundM4 = (row: M4Row): number => {
    const used = r;
    const vals = row.values.slice(0, N);
    const prior = row.priorValue ?? 0;
    const style: 'plain' | 'subtotal' | 'total' = row.isTotal ? 'total' : row.isSubtotal ? 'subtotal' : 'plain';
    setLabel(ws.getCell(r, LBL_COL), row.label, { indent: row.indent, bold: style !== 'plain' });
    const put = (c: number, v: number): void => { const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
    put(OPEN_COL, prior);
    for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    if (row.totalOverride !== '') {
      const tv = row.totalOverride !== undefined ? Number(row.totalOverride) : prior + vals.reduce((a, v) => a + (v ?? 0), 0);
      put(TOTAL_COL, Number.isFinite(tv) ? tv : 0);
    }
    if (style === 'total') { fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.navy); for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } }; }
    else if (style === 'subtotal') { for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } }; }
    r += 1;
    return used;
  };

  // ═══ 1. Returns (Module5Returns, top to bottom) ═══════════════════════════════
  section('1. Returns');
  if (!rs) {
    note('The returns engine could not compute on this model, so only the signed streams are shown.');
    moneyRow('FCFF (project)', lm.fcff, { style: 'total' });
    moneyRow('FCFE (equity)', lm.fcfe, { style: 'total' });
    return { rs: null };
  }
  const rsx = rs;
  const rr = rs.result, de = rs.developmentEconomics, su = rs.sourcesUses, cfg = rs.config;
  // Signed stream placement: index 0 = inception (opening col), 1..E -> axis.
  const place = (stream: number[] | undefined): { prior: number; vals: number[] } => {
    const s = stream ?? []; const prior = s[0] ?? 0; const vals = new Array<number>(N).fill(0);
    for (let i = 1; i < s.length && i - 1 < N; i++) vals[i - 1] = s[i] ?? 0;
    return { prior, vals };
  };
  const streamRow = (label: string, stream: number[] | undefined, opts: { style?: 'plain' | 'subtotal' | 'total'; indent?: number; basis?: string } = {}): number => { const p = place(stream); return moneyRow(label, p.vals, { ...opts, prior: p.prior }); };

  note('Returns on three cash-flow bases: FCFF (unlevered, to all capital providers), FCFE (levered, free cash to equity after debt service), and Distributed Equity (IRR on the actual cash distributions to equity investors). Terminal value is added in the exit year per the assumptions below. NPV is intentionally omitted; IRR / MOIC plus a tight Development Economics are the focus. Exit-year, funding-mix and equity-exposure analytics live on the RE Metrics tab.');

  // ── Returns Assumptions (the panel's inputs, under the panel's labels) ──
  subTitle('Returns Assumptions');
  scalarRow('Discount Rate (%)', cfg.discountRate, NUMFMT.pct2, { input: true });
  scalarRow('Exit Year', rs.exitYearLabel, NUMFMT.year, { input: true });
  scalarRow('Terminal Value Method', TERMINAL_METHOD_LABELS[cfg.terminalMethod] ?? String(cfg.terminalMethod), '@', { input: true });
  if (cfg.terminalMethod === 'exit_multiple') scalarRow('Exit Multiple (x stabilised NOI)', cfg.exitMultiple, NUMFMT.mult, { input: true });
  if (cfg.terminalMethod === 'perpetuity' || cfg.terminalMethod === 'cap_rate') scalarRow('Growth g (%)', cfg.perpetuityGrowth, NUMFMT.pct2, { input: true });
  if (cfg.terminalMethod !== 'none') {
    const exitBasis = cfg.terminalValueBasis === 'exit_year';
    scalarRow('Terminal value basis', exitBasis ? 'Exit year' : 'Year before exit', '@', {
      input: true,
      basis: exitBasis ? 'Capitalises the exit year income. Booked as proceeds from disposal in the exit year.' : 'Capitalises the income of the year before the exit. Booked as proceeds from disposal in the exit year.',
    });
  }
  if (cfg.terminalMethod === 'cap_rate') {
    const manual = cfg.capRateSource === 'manual';
    scalarRow('Exit Cap Rate (%)', manual ? cfg.capRate : cfg.capRateDerived, NUMFMT.pct2, {
      input: true,
      basis: manual
        ? `Set by you (WACC less growth would be ${(cfg.capRateDerived * 100).toFixed(2)}%).`
        : `WACC less growth: ${(cfg.discountRate * 100).toFixed(2)}% - ${(cfg.perpetuityGrowth * 100).toFixed(2)}% = ${(cfg.capRateDerived * 100).toFixed(2)}%.`,
    });
  }
  if (cfg.terminalMethod !== 'none') {
    scalarRow('Terminal metric', cfg.applyGrowthToTerminal ? 'Grown by (1 + g)' : 'Exit year as is', '@', {
      input: true,
      basis: cfg.applyGrowthToTerminal ? `Capitalises forward income: exit metric x (1 + ${(cfg.perpetuityGrowth * 100).toFixed(2)}%).` : 'Capitalises the exit year figure itself.',
    });
  }
  r += 1;

  // ── Headline returns ──
  const irrTone = (irr: number | null): 'good' | 'bad' | undefined => (irr === null ? undefined : irr >= cfg.discountRate ? 'good' : 'bad');
  kpiStrip('Headline Returns', [
    { label: 'Project IRR (FCFF)', value: cPct(rr.fcff.irr), sub: `MOIC ${cMult(rr.fcff.moic)}`, tone: irrTone(rr.fcff.irr) },
    { label: 'Equity IRR (FCFE)', value: cPct(rr.fcfe.irr), sub: `MOIC ${cMult(rr.fcfe.moic)}`, tone: irrTone(rr.fcfe.irr) },
    // NET LEADS, GROSS BESIDE (2026-09-21, the dashboard rule): what equity
    // receives is after the performance fee. This tile printed GROSS with no
    // qualifier while the Summary tab, built from the same dashboard builder,
    // printed net, so one workbook contradicted itself.
    ...(() => {
      const d = distributedReturnPair(rs);
      const gross = d.preFeeIrr != null;
      return [{
        label: gross ? 'Distributed Equity IRR (net of performance fee)' : 'Distributed Equity IRR',
        value: cPct(d.irr),
        sub: gross ? `MOIC ${cMult(d.moic)} · gross ${cPct(d.preFeeIrr)} / MOIC ${cMult(d.preFeeMoic)}` : `MOIC ${cMult(d.moic)}`,
        tone: irrTone(d.irr),
      }];
    })(),
    { label: 'Equity Multiple (distributions)', value: cMult(rr.realEstate.equityMultiple), sub: 'distributions / invested' },
  ]);

  // ── Development Economics ──
  kpiStrip('Development Economics', [
    { label: 'Total Development Cost', value: cMoney(de.totalDevelopmentCost), sub: 'incl. land' },
    { label: 'Total Financing Cost', value: cMoney(de.totalFinancingCost), sub: 'all interest over the hold' },
    { label: 'Profit Before Financing', value: cMoney(de.profitBeforeFinancing), sub: 'GDV - dev cost', tone: de.profitBeforeFinancing >= 0 ? 'good' : 'bad' },
    { label: 'Profit After Financing', value: cMoney(de.profitAfterFinancing), sub: '- financing cost', tone: de.profitAfterFinancing >= 0 ? 'good' : 'bad' },
    { label: 'Development Margin', value: cPct(de.developmentMargin), sub: 'profit / GDV', tone: de.developmentMargin == null ? undefined : de.developmentMargin >= 0 ? 'good' : 'bad' },
  ]);

  // ── Equity Partners (allocation grid, per-partner returns, streams) ──
  {
    const ps = rs.partners;
    const rows = ps.partners;
    const stored = state.project.partners ?? [];
    // The screen's default: one Sponsor holding 100% of every type until a
    // partner is added (the engine synthesises the same default).
    const effective = stored.length ? stored : [{ id: 'sponsor', name: 'Sponsor', cashPct: 100, inKindPct: 100, existingPct: 100 }];
    const pctOf = (p: { cashPct?: number; inKindPct?: number; existingPct?: number }, key: 'cashPct' | 'inKindPct' | 'existingPct'): number => (Number.isFinite(p[key]) ? (p[key] as number) : 0);
    subTitle('Equity Partners');
    note('Each equity type shows its project total split across partners as both an amount and a %. Shareholding (the dividend / terminal share) is each partner\'s total equity over the project total, and each partner\'s IRR is a yearly equity IRR on the same basis as the project FCFE / Distributed-Equity stream.');
    const types: Array<{ label: string; key: 'cashPct' | 'inKindPct' | 'existingPct'; total: number }> = [
      { label: 'New Cash Equity', key: 'cashPct', total: ps.totalCash },
      { label: 'In-Kind Equity (land)', key: 'inKindPct', total: ps.totalInKind },
      { label: 'Existing Equity', key: 'existingPct', total: ps.totalExisting },
    ];
    const allocRows: Array<{ label: string; cells: GridCell[]; bold?: boolean; indent?: number }> = [];
    for (const t of types) {
      allocRows.push({ label: t.label, cells: [{ v: t.total, bold: true }, ...effective.map((p) => ({ v: (t.total * pctOf(p, t.key)) / 100, input: true }))] });
      allocRows.push({ label: '% share', indent: 1, cells: [null, ...effective.map((p) => ({ v: pctOf(p, t.key) / 100, fmt: NUMFMT.pct2, input: true }))] });
    }
    allocRows.push({ label: 'Total Invested', bold: true, cells: [{ v: ps.totalProjectEquity }, ...effective.map((_p, i) => ({ v: rows[i]?.totalEquityInvested ?? 0 }))] });
    allocRows.push({ label: 'Weighted-Avg %', cells: [{ v: ps.weightedAvgSum, fmt: NUMFMT.pct2 }, ...effective.map((_p, i) => ({ v: rows[i]?.weightedAvgShareholdingPct ?? 0, fmt: NUMFMT.pct2 }))] });
    allocRows.push({ label: 'Agreed % (override)', cells: [{ v: ps.shareholdingSum, fmt: NUMFMT.pct2, tone: ps.shareholdingReconciles ? 'good' : 'bad' }, ...effective.map((_p, i) => (rows[i]?.shareholdingIsManual ? { v: rows[i].shareholdingPct, fmt: NUMFMT.pct2, input: true } : { v: '', input: true }))] });
    grid('', ['Equity Type', 'Project Total', ...effective.map((p) => p.name)], allocRows);
    note(`Agreed shares total ${cPct(ps.shareholdingSum)}${ps.shareholdingReconciles ? '' : ` (${ps.shareholdingDelta >= 0 ? '+' : ''}${cPct(ps.shareholdingDelta)} vs 100%)`}. A blank Agreed % uses the computed weighted average.`);
    grid('', ['Partner', 'Invested', 'Agreed %', 'FCFE IRR', 'FCFE MOIC', 'FCFE Eq. Mult.', 'DDM IRR', 'Distributions'],
      rows.map((p) => ({ label: p.name, cells: [
        { v: p.totalEquityInvested }, { v: p.shareholdingPct, fmt: NUMFMT.pct2 }, cPct(p.fcfeIrr), cMult(p.fcfeMoic), cMult(p.fcfeEquityMultiple), cPct(p.irr), { v: p.totalCashReturned },
      ] })));
    const partnerStreams = (title: string, caption: string, pick: (p: typeof rows[number]) => number[], total: number[], irrOf: (p: typeof rows[number]) => number | null, consolidatedIrr: number | null): void => {
      subTitle(title);
      note(caption);
      for (const p of rows) streamRow(p.name, pick(p), { basis: `IRR ${cPct(irrOf(p))}` });
      streamRow('Total', total, { style: 'subtotal', basis: `IRR ${cPct(consolidatedIrr)}` });
      r += 1;
    };
    partnerStreams('FCFE Streams by Partner',
      'Each partner\'s agreed share of the consolidated FCFE (levered free cash flow) each period. Negative = capital in, positive = cash out. The Total reconciles to the consolidated FCFE. The partner\'s IRR is stated in the Basis column.',
      (p) => p.fcfeStream, ps.totalFcfeStream, (p) => p.fcfeIrr, rr.fcfe.irr);
    partnerStreams('Distributed-Equity (DDM) Streams by Partner',
      'Each partner\'s agreed share of dividends distributed (plus terminal equity at exit), less equity contributed at its timing. The Total reconciles to the consolidated Distributed-Equity stream.',
      (p) => p.cashFlowStream, ps.totalStream, (p) => p.irr, rr.dividends.irr);
  }

  // ── Fund Fee Income (who EARNS the fees, beside the equity partners) ──
  // Two formatting contexts: period rows round-trip `totalOverride` back to a
  // number (money formatter String), the string grids use the display formatters.
  const rowsCtx: FundReportCtx = { snap, returns: rs, fmt: { money: (v) => String(v), pct: cPct, mult: cMult } };
  const textCtx: FundReportCtx = { snap, returns: rs, fmt: { money: cMoney, pct: cPct, mult: cMult } };
  if (hasFundFeeIncome(rs)) {
    const fe = rs.feeEarners;
    subTitle('Fund Fee Income');
    note('Who earns the fund\'s fees, as distinct from who owns its equity. The Fund Manager takes 100% of the five management fees plus its share of the performance fee from the Module 1 distribution matrix; project parties take only their matrix share. Fee earners hold no equity, so nothing here is part of the equity split above.');
    // A string grid on its own title: the fund verifiers find the earner rows
    // under this caption.
    grid('Fund Fee Income by Earner', [...FUND_EARNER_COLUMNS], buildFundEarnerRows(textCtx).map((g) => ({ label: g.cells[0], bold: g.emphasis === 'total', cells: g.cells.slice(1) })));
    note(fe.noneAllocated
      ? 'Performance fee not allocated yet.'
      : `Performance fee shares total ${cPct(fe.performanceFeeShareSum)}${fe.performanceFeeReconciles ? '' : ` (${fe.performanceFeeShareDelta >= 0 ? '+' : ''}${cPct(fe.performanceFeeShareDelta)} vs 100%)`}.`);

    const basis = buildFundFeeBasisRows(snap);
    if (basis.length > 0) {
      // The capital bases are quantities fees are charged ON, not fees, so they
      // sit in their own captioned block above the fee basis rows.
      subTitle(FUND_CAPITAL_BASES_TITLE);
      // A capital base is ONE amount, so it is written once, in the Total
      // column, with nothing across the period columns.
      for (const c of buildFundCapitalRows(snap)) {
        const rc = r;
        scalarRow(c.isTotal ? `= ${c.label}` : c.label, c.amount, NUMFMT.money, { bold: c.isTotal, basis: FUND_CAPITAL_BASE_TAG });
        if (!c.isTotal) ws.getCell(rc, LBL_COL).alignment = { indent: 1 };
      }
      note(FUND_CAPITAL_BASES_NOTE);
      subTitle('Fund Fee Basis (what each fee is charged on)');
      ws.getCell(r - 1, META_B).value = 'Base';
      ws.getCell(r - 1, META_C).value = 'Rate';
      // Not 9: ExcelJS drops a column whose width equals DEFAULT_COLUMN_WIDTH.
      ws.getColumn(META_C).width = Math.max(ws.getColumn(META_C).width ?? 0, 10);
      for (let i = 0; i < basis.length; i++) {
        const b = basis[i], line = snap.fundFees.lines[i];
        if (!b.hasRate) {
          const rFlat = moneyRow(fundFeeChargedLabel(b), line?.amountPerPeriod, { indent: 1 });
          setBasis(ws.getCell(rFlat, META_B), fundFeeBasisBaseCell(b));
          setBasis(ws.getCell(rFlat, META_C), b.rate);
          continue;
        }
        const rB = moneyRow(fundFeeBasisLabel(b), line?.basisPerPeriod, { indent: 1 });
        ws.getCell(rB, TOTAL_COL).value = b.basisDisplay;
        setBasis(ws.getCell(rB, META_B), fundFeeBasisBaseCell(b));
        setBasis(ws.getCell(rB, META_C), b.rate);
        const rF = moneyRow(fundFeeChargedLabel(b), line?.amountPerPeriod, { indent: 2 });
        setBasis(ws.getCell(rF, META_B), b.timing);
      }
      r += 1;
    }
    subTitle('Fee Income by Period');
    note('The five management fees as charged in Module 4, plus the performance fee from the waterfall below. Management fees are charged on the project axis, so the inception column is zero. These are fee entitlements, not equity distributions.');
    for (const row of buildFundFeeIncomeRows(rowsCtx)) emitFundM4(row);
    r += 1;
  }

  // ── Sources & Uses of Capital ──
  subTitle('Sources & Uses of Capital');
  textLine('Sources');
  scalarRow('Existing Equity', su.existingEquity, NUMFMT.money);
  scalarRow('New Equity (cash)', su.newEquityCash, NUMFMT.money);
  scalarRow('In-Kind Equity (land)', su.inKindEquity, NUMFMT.money);
  scalarRow('Existing Debt', su.existingDebt, NUMFMT.money);
  scalarRow('New Debt (incl. capitalised IDC)', su.newDebt, NUMFMT.money);
  scalarRow('Customer Collections / Pre-Sales', su.customerCollections, NUMFMT.money);
  scalarRow('Operating Cash Generated', su.operatingCash, NUMFMT.money);
  scalarRow('Total Sources', su.totalSources, NUMFMT.money, { bold: true });
  textLine('Uses');
  scalarRow('Land', su.land, NUMFMT.money);
  scalarRow('Construction & Infrastructure', su.construction, NUMFMT.money);
  scalarRow('IDC Capitalized During Construction', su.idc, NUMFMT.money);
  scalarRow('Reserves / Distributions', su.reservesDistributions, NUMFMT.money);
  scalarRow('Total Uses', su.totalUses, NUMFMT.money, { bold: true });
  r += 1;

  // ── Returns by Cash-Flow Basis ──
  grid('Returns by Cash-Flow Basis', ['Basis', 'IRR', 'MOIC', 'Invested', 'Returned', 'Net Profit'], [
    { label: 'FCFF (unlevered project)', cells: [cPct(rr.fcff.irr), cMult(rr.fcff.moic), { v: rr.fcff.totalOutflow }, { v: rr.fcff.totalInflow }, { v: rr.fcff.netProfit, bold: true }] },
    { label: 'FCFE (levered equity)', cells: [cPct(rr.fcfe.irr), cMult(rr.fcfe.moic), { v: rr.fcfe.totalOutflow }, { v: rr.fcfe.totalInflow }, { v: rr.fcfe.netProfit, bold: true }] },
    { label: 'Distributed Equity (realized distributions)', cells: [cPct(rr.dividends.irr), cMult(rr.dividends.moic), { v: rr.dividends.totalOutflow }, { v: rr.dividends.totalInflow }, { v: rr.dividends.netProfit, bold: true }] },
  ]);

  // ── Return Cash-Flow Streams ──
  subTitle(`Return Cash-Flow Streams (hold to ${rs.exitYearLabel})`);
  note('Signed cash flows: negative = invested, positive = returned. Terminal value is included in the exit-year FCFF (enterprise) and FCFE / Distributed Equity (equity) cells. NOI is the recurring hospitality + lease income net of operating cost. The opening column is the inception period.');
  streamRow('FCFF, unlevered project', rs.fcffPerPeriod, { style: 'subtotal' });
  streamRow('FCFE, levered equity', rs.fcfePerPeriod, { style: 'subtotal' });
  streamRow('Distributed Equity (realized distributions)', rs.dividendStreamPerPeriod, { style: 'subtotal' });
  // NOI is on the PROJECT axis (index 0 = first project year), the streams on the
  // stream basis (index 0 = inception), so it is lifted by one leading zero, as
  // the screen does. Without it every NOI figure sat a year early and the exit
  // year's NOI fell off the end.
  streamRow('Memo: NOI (recurring)', [0, ...rs.noiPerPeriod.slice(0, Math.max(0, rs.fcffPerPeriod.length - 1))], { indent: 1 });
  r += 1;

  // ── Step-by-step build-ups (row lists from the shared builder) ──
  textLine('Step-by-Step Build-Up');
  const emitBuildup = (title: string, caption: string, rows: Array<{ label: string; values: number[]; indent?: number; isTotal?: boolean }>): void => {
    subTitle(title);
    note(caption);
    for (const row of rows) streamRow(row.label, row.values, row.isTotal ? { style: 'total' } : { indent: row.indent });
    r += 1;
  };
  emitBuildup('FCFF Build-Up (unlevered, to all capital providers)',
    'Free Cash Flow to Firm = Cash from Operations (pre-interest) less the FULL COST of building, which is the cash capex plus the land contributed in-kind plus the interest capitalised during construction, plus the terminal enterprise value at exit. Pre-financing: debt drawdowns, principal and the operating finance cost are excluded and appear in FCFE below.',
    buildFcffBuildup(rs, m4StreamRow));
  emitBuildup('FCFE Build-Up (levered, free cash to equity)',
    'Free Cash Flow to Equity builds from FCFF above: FCFF, then the debt drawn for capex and the debt drawn for IDC, less principal repaid and the OPERATING finance cost, with the terminal enterprise value swapped for terminal value less closing debt. The in-kind land and the IDC are already inside FCFF and are not repeated here. The NEGATIVE periods are the NEW cash equity the sponsor must inject.',
    buildFcfeBuildup(rs, m4StreamRow));
  emitBuildup(rs.waterfall.active ? 'Dividend Discount Model (DDM), before performance fee' : 'Distributed Equity Build-Up (Dividend Discount Model)',
    'Equity investment (existing + new cash + in-kind) out, dividends and return of capital distributed by the cash-sweep waterfall in, plus the terminal equity value at exit. This is the basis for the Distributed Equity IRR. Dividends are sized in the Financial Statements (Cash Sweep + Dividend policy), not in the funding gap.',
    buildDividendBuildup(rs, m4StreamRow));
  textLine(`DDM IRR${rs.waterfall.active ? ' (before performance fee)' : ''} ${cPct(rr.dividends.irr)} · MOIC ${cMult(rr.dividends.moic)}`);
  r += 1;

  // ── Performance Fee (hurdle waterfall) and DDM after fee ──
  if (isFundActive(rs)) {
    const w = rs.waterfall;
    subTitle('Performance Fee (hurdle waterfall) and DDM after fee');
    note(`Equity drawn folds into a single unpaid hurdle balance, which accrues at the hurdle rate and is settled by one Hurdle Paid line. Anything distributed above it is excess, and the performance fee is a flat percentage of that excess. Hurdle ${cPct(w.hurdleRate)}, performance fee ${cPct(w.performanceFeePct)}. The distributions net of that fee, against the same equity investment, give the DDM after fee below.`);
    // The terms the waterfall was run on, shaded as the inputs they are.
    textLine('Fund Terms Applied');
    scalarRow('Hurdle rate (preferred return)', w.hurdleRate, NUMFMT.pct2, { input: true });
    scalarRow('Performance fee on the excess', w.performanceFeePct, NUMFMT.pct2, { input: true });
    scalarRow('Fund Manager', resolveFundTerms(state.project).fundManagerName, '@', { input: true });
    r += 1;
    kpiStrip('Fund Returns, Gross vs Net', buildFundHeadlineCards(textCtx).map((c) => ({ ...c, tone: c.label === 'Unpaid Hurdle at Exit' ? (w.hurdleShortfall > 0 ? 'bad' as const : 'good' as const) : undefined })));
    grid('', [...FUND_GROSS_NET_COLUMNS], buildFundGrossNetRows(textCtx).map((g) => ({ label: g.cells[0], bold: g.emphasis === 'total', cells: g.cells.slice(1) })));
    // Written into the blank separator row the grid just left, so the note sits
    // directly under the table.
    { const gn = fundGrossNetNote(textCtx); if (gn) { r -= 1; note(gn); } }

    subTitle(`Performance Fee (hold to ${rs.exitYearLabel})`);
    note('Each line feeds the next, in the order shown. The balance lines (BoP, Total Hurdle Owed, EoP) carry no lifetime total, and neither does Hurdle Accrued, an accrual charged on that compounding balance. The opening column is the inception period. Gross distributions are shown as a memo below the sequence.');
    for (const row of buildFundWaterfallRows(rowsCtx)) emitFundM4(row);
    note(fundWaterfallTotalsNote(textCtx));

    subTitle('Dividend Discount Model (DDM), after performance fee');
    note('The same equity investment as the DDM above, with the distributions net of the performance fee. The IRR and MOIC below are the post-fee return to the equity holders.');
    for (const row of buildDdmPostFeeRows(rowsCtx)) emitFundM4(row);
    textLine(`DDM IRR (after performance fee) ${cPct(rs.resultNetDividends.irr)} · MOIC ${cMult(rs.resultNetDividends.moic)}`);
    r += 1;
  }

  // ── Exit: terminal value and gain on disposal ──
  {
    const vis = state.assets;
    const lineState = { assets: vis, phases: state.phases, parcels: state.parcels };
    const lines = planReportLines(lineState);
    const labelOf = (id: string): string => {
      const a = vis.find((x) => x.id === id);
      return a ? assetLabel(a, { parcels: state.parcels, phases: state.phases }) : id;
    };
    const groupOf = (assetId: string): { key: string; label: string } | undefined => {
      const line = lines.find((l) => l.assetIds.includes(assetId));
      return line ? { key: line.key, label: lineTitle(line, lineState) } : undefined;
    };
    const working = buildDisposalWorking(snap, rs, labelOf, groupOf);
    subTitle('Exit: terminal value and gain on disposal');
    note('The held assets are sold at the exit for the terminal value. Each figure below is the one booked in the P&L, the cash flow, the balance sheet and the Returns streams, so changing the basis, the method or the cap rate moves all of them together.');
    for (const row of working.rows) {
      if (row.kind === 'section') { textLine(row.label); continue; }
      const strong = row.kind === 'total' || row.kind === 'subtotal';
      setLabel(ws.getCell(r, LBL_COL), row.label, { bold: strong, indent: row.indent });
      const c = ws.getCell(r, TOTAL_COL);
      if (row.format === 'text' || row.value === undefined) { c.value = row.text ?? ''; c.numFmt = '@'; c.alignment = { horizontal: 'right' }; }
      else { c.value = row.value; c.numFmt = row.format === 'pct' ? NUMFMT.pct2 : row.format === 'mult' ? NUMFMT.mult : NUMFMT.money; }
      c.font = { name: 'Calibri', size: BODY_SIZE, bold: strong, italic: row.kind === 'check', color: { argb: strong ? ARGB.navy : ARGB.formula } };
      r += 1;
    }
    r += 1;
    if (working.byAsset.length > 0) {
      const sumOf = (k: 'building' | 'land' | 'capitalisedInterest' | 'total'): number => working.byAsset.reduce((s, a) => s + a[k], 0);
      grid('', ['Held line sold', 'Building', 'Land', 'Capitalised interest', 'Net book value'], [
        ...working.byAsset.map((a) => ({ label: a.label, cells: [{ v: a.building }, { v: a.land }, { v: a.capitalisedInterest }, { v: a.total, bold: true }] as GridCell[] })),
        { label: 'Total', bold: true, cells: [{ v: sumOf('building') }, { v: sumOf('land') }, { v: sumOf('capitalisedInterest') }, { v: sumOf('total') }] },
      ]);
    }
  }

  // ── Sensitivity, Equity IRR (FCFE), on the screen's default axes ──
  // GATED ON THE ENTITLEMENT, as the PDF is: a plan without sensitivity gets
  // nothing here, not a heading that claims a grid exists.
  if (ctx.includeSensitivity) {
    const xVar: SensitivityVariable = 'exit_cap_rate', yVar: SensitivityVariable = 'sales_price_pct';
    let sens: ReturnType<typeof computeReturnsSensitivity> | null = null;
    try { sens = computeReturnsSensitivity(snap, state.project, xVar, yVar); } catch { sens = null; }
    subTitle('Sensitivity, Equity IRR (FCFE)');
    if (sens) {
      const base = sens.baseEquityIrr;
      note(`Equity IRR across combinations. Exit Cap Rate and Discount Rate are exact; Sales Price, ADR and Construction Cost are proportional cash-flow shocks (approximate, not a full re-forecast). Columns: ${SENS_LABELS[xVar].label}; rows: ${SENS_LABELS[yVar].label} (the platform's default axes; the platform lets either be changed). Bold green = at or above the base-case Equity IRR (${cPct(base)}), shaded = below.`);
      grid('', [`${SENS_LABELS[yVar].label} \\ ${SENS_LABELS[xVar].label}`, ...sens.xValues.map((xv) => sensValueLabel(xVar, xv))],
        sens.yValues.map((yv, yi) => ({
          label: sensValueLabel(yVar, yv), bold: true,
          cells: sens!.xValues.map((_x, xi) => {
            const v = sens!.irr[yi][xi];
            if (v == null || !Number.isFinite(v)) return 'n/a';
            const above = base != null && v >= base;
            return { v, fmt: NUMFMT.pct2, tone: above ? 'good' as const : undefined, fill: base != null && !above ? ARGB.warnBg : undefined };
          }),
        })));
    } else {
      note('The sensitivity grid could not be computed on this model.');
    }
  }

  // ═══ 2. RE Metrics (Module5Metrics, top to bottom) ════════════════════════════
  section('2. RE Metrics');
  note('Real-estate decision view. The hero metrics below are the deal-deciders; Lender Covenants and Exit-Year Analysis are the analytical centrepieces; supporting detail is grouped underneath. Every coverage / leverage headline (Min DSCR, Debt Yield, peak LTV) is derived from the per-period series shown in the covenant heatmap, so a headline always equals the row it summarises.');
  {
    const m = rs.result.realEstate, ee = rs.equityExposure, fm = rs.fundingMix;
    // THE SAME INPUTS AND REDUCERS AS THE SCREEN (lib/covenants.ts), so a card
    // here can never disagree with the covenant row it summarises. LTV is at
    // PEAK DEBT (debt / GDV); LTV at exit is 0% once debt is repaid.
    const covenantInputs: CovenantInputs = {
      dscrPerPeriod: m.dscrPerPeriod,
      icrPerPeriod: m.icrPerPeriod,
      noiPerPeriod: rs.noiPerPeriod, debtOutstandingPerPeriod: snap.bs.debtOutstandingPerPeriod,
      gdvValue: de.gdv, ltvAtExit: m.ltvAtExit,
    };
    const covenants = state.project.covenants ?? DEFAULT_COVENANTS;
    const minDSCR = reduceWorst(covenantSeries('dscr', covenantInputs), 'min');
    const avgDSCR = reduceAvg(covenantSeries('dscr', covenantInputs));
    const minICR = reduceWorst(covenantSeries('icr', covenantInputs), 'min');
    const debtYieldWorst = reduceWorst(covenantSeries('debt_yield', covenantInputs), 'min');
    const ltvPeak = reduceWorst(covenantSeries('ltv', covenantInputs), 'max');
    const ltvHero = ltvPeak != null ? ltvPeak : m.ltvAtExit;
    const dscrThreshold = covenants.find((c) => c.metric === 'dscr')?.threshold ?? 1.20;
    const ltvThreshold = covenants.find((c) => c.metric === 'ltv')?.threshold ?? 0.60;
    const dscrPass = minDSCR == null ? null : minDSCR >= dscrThreshold;
    const ltvPass = ltvHero == null ? null : ltvHero <= ltvThreshold;
    const badge = (pass: boolean | null): string => (pass == null ? '' : pass ? ' · Pass' : ' · Breach');
    const tone = (pass: boolean | null): 'good' | 'bad' | undefined => (pass == null ? undefined : pass ? 'good' : 'bad');

    kpiStrip('', [
      { label: 'Equity Multiple (FCFE)', value: cMult(rr.fcfe.moic), sub: 'equity out / equity in, at the selected exit' },
      { label: 'Yield on Cost', value: cPct(m.yieldOnCost), sub: 'stabilised NOI / total cost' },
      { label: 'Profit Margin', value: cPct(m.profitMargin), sub: 'PAT / revenue' },
      { label: 'Min DSCR', value: cMult(minDSCR), sub: `worst debt-service yr · vs ${cMult(dscrThreshold)}${badge(dscrPass)}`, tone: tone(dscrPass) },
      { label: 'Peak Equity', value: cMoney(m.peakEquity), sub: `max equity at risk · ${currency}` },
      { label: ltvPeak != null ? 'LTV (peak debt)' : 'LTV at Exit', value: cPct(ltvHero), sub: `${ltvPeak != null ? 'peak debt / GDV' : 'debt / exit value'} · vs ${cPct(ltvThreshold, 0)}${badge(ltvPass)}`, tone: tone(ltvPass) },
    ]);

    // ── Lender Covenants ──
    subTitle('Lender Covenants');
    note('Standard covenants vs editable thresholds (saved with the project). Worst = the binding period (min for DSCR / ICR / Debt Yield, max for LTV); Pass / Breach compares the worst to the threshold. DSCR and Interest Cover come from the snapshot; Debt Yield = NOI / debt; LTV is measured at peak debt (peak debt outstanding / Gross Development Value), since LTV at exit is ~0% once debt is repaid. Where there is no value basis it falls back to LTV at exit (labelled as such). Thresholds are in x for DSCR / ICR and % for LTV / Debt Yield.');
    const evals = covenants.map((cov) => ({ cov, ev: evaluateCovenant(cov, covenantInputs) }));
    const covFmt = (unit: 'x' | 'pct'): string => (unit === 'pct' ? NUMFMT.pct2 : NUMFMT.mult);
    const metricName = (metric: string): string => COVENANT_METRIC_LABELS.find((o) => o.v === metric)?.label ?? metric;
    grid('', ['Covenant', 'Metric', 'Test', 'Threshold', 'Worst', 'Avg', 'Status'], evals.map(({ cov, ev }) => {
      const unit = covenantUnit(cov.metric);
      return {
        label: cov.label, input: true,
        cells: [
          { v: `${metricName(cov.metric)}${ev.basisLabel ? ` (${ev.basisLabel})` : ''}`, input: true },
          { v: cov.operator === 'min' ? 'min ≥' : 'max ≤', input: true },
          { v: cov.threshold, fmt: covFmt(unit), input: true },
          ev.worst == null ? '-' : { v: ev.worst, fmt: covFmt(unit), bold: true },
          ev.avg == null ? '-' : { v: ev.avg, fmt: covFmt(unit) },
          { v: ev.pass == null ? 'n/a' : ev.pass ? 'Pass' : 'Breach', bold: true, tone: ev.pass == null ? undefined : ev.pass ? 'good' : 'bad' },
        ],
      };
    }));
    // Covenant by year: a row per metric-backed covenant with a real series. A
    // pass reads in green, a breach in red on the warning shade.
    const perPeriod = evals.filter(({ ev, cov }) => !ev.exitOnly && cov.metric !== 'custom' && ev.seriesPerPeriod.some((v) => v != null));
    if (perPeriod.length > 0) {
      subTitle('Covenant by year');
      for (const { cov, ev } of perPeriod) {
        setLabel(ws.getCell(r, LBL_COL), cov.label, { bold: true });
        setBasis(ws.getCell(r, META_B), `${cov.operator === 'min' ? 'min ≥' : 'max ≤'} ${ev.unit === 'pct' ? cPct(cov.threshold) : cMult(cov.threshold)}`);
        for (let t = 0; t < N; t++) {
          const v = ev.seriesPerPeriod[t] ?? null;
          const c = ws.getCell(r, pcol(t));
          if (v == null) { c.value = '-'; c.numFmt = '@'; c.alignment = { horizontal: 'right' }; c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; continue; }
          const pass = cov.operator === 'min' ? v >= cov.threshold : v <= cov.threshold;
          c.value = v; c.numFmt = covFmt(ev.unit);
          c.font = { name: 'Calibri', size: BODY_SIZE, bold: !pass, color: { argb: pass ? ARGB.good : ARGB.bad } };
          if (!pass) fillCell(c, ARGB.warnBg);
        }
        r += 1;
      }
      r += 1;
    }

    // ── Exit-Year Analysis ──
    subTitle('Exit-Year Analysis (hold vs sell timing)');
    note('Project IRR (FCFF) and Equity IRR (FCFE) if the asset is sold at the end of each year, using that year\'s terminal value. The marked row is the selected Exit Year; its Equity MOIC is the Equity Multiple (FCFE) above.');
    grid('', ['Exit Year', 'Enterprise Value', 'Equity Value', 'Project IRR', 'Equity IRR', 'Equity MOIC'],
      rs.exitYears.map((x) => ({ label: `${x.exitYearLabel}${x.isSelected ? '  ◀ selected' : ''}`, bold: x.isSelected, cells: [{ v: x.enterpriseValue }, { v: x.equityValue }, cPct(x.fcffIrr), cPct(x.fcfeIrr), cMult(x.equityMoic)] })));

    kpiStrip('Coverage and profitability detail', [
      { label: 'Avg DSCR', value: cMult(avgDSCR), sub: 'mean over debt-service years' },
      { label: 'Min Interest Cover', value: cMult(minICR), sub: 'worst yr · EBITDA / interest' },
      { label: 'Debt Yield', value: cPct(debtYieldWorst), sub: 'worst operating yr · NOI / debt' },
      { label: 'Avg Cash-on-Cash', value: cPct(m.cashOnCashAvg), sub: 'cash yield on equity' },
      { label: 'Cap Rate at Exit', value: cPct(m.capRateAtExit), sub: 'exit NOI / exit value' },
      { label: 'Profit on Cost', value: cPct(m.profitOnCost), sub: '(revenue - cost) / cost' },
      { label: 'Development Spread', value: cPct(m.developmentSpread), sub: 'yield on cost - exit cap rate' },
      { label: 'Max Negative Cash Flow', value: cMoney(ee.maxNegativeCumulativeCF), sub: 'peak FCFE outflow', tone: 'bad' },
    ]);
    kpiStrip('Development economics', [
      { label: 'Gross Development Value', value: cMoney(de.gdv), sub: 'GDV' },
      { label: 'Total Development Cost', value: cMoney(de.totalDevelopmentCost) },
      { label: 'Total Financing Cost', value: cMoney(de.totalFinancingCost) },
      { label: 'Profit before Financing', value: cMoney(de.profitBeforeFinancing), sub: 'GDV less cost', tone: de.profitBeforeFinancing >= 0 ? 'good' : 'bad' },
      { label: 'Profit after Financing', value: cMoney(de.profitAfterFinancing), sub: 'less financing cost', tone: de.profitAfterFinancing >= 0 ? 'good' : 'bad' },
      { label: 'Development Margin', value: cPct(de.developmentMargin), sub: 'profit / GDV', tone: de.developmentMargin !== null && de.developmentMargin > 0 ? 'good' : undefined },
      { label: 'Cost to Value', value: cPct(de.costToValue), sub: 'dev cost / GDV' },
    ]);
    kpiStrip('Income and exit profile', [
      { label: 'Stabilised NOI', value: cMoney(rs.stabilisedNOI) },
      { label: 'Exit NOI', value: cMoney(rs.exitNOI), sub: `year ${rs.exitYearLabel}` },
      { label: 'Stabilisation Year', value: rs.stabilization.stabilizationYear != null ? String(rs.stabilization.stabilizationYear) : 'n/a', sub: 'NOI reaches 95% of stable' },
      { label: 'Stabilised Yield on Cost', value: cPct(rs.stabilization.stabilisedYieldOnCost), sub: 'stabilised NOI / dev cost' },
      { label: 'Exit Cap Rate', value: cPct(m.capRateAtExit), sub: 'exit NOI / exit value' },
      { label: 'Terminal Enterprise Value', value: cMoney(rs.terminalEnterpriseValue) },
      { label: 'Terminal Equity Value', value: cMoney(rs.terminalEquityValue), sub: 'EV less debt + cash' },
    ]);
    kpiStrip('Funding mix', [
      { label: 'Debt', value: cPct(fm.debtPct), sub: '% of total sources' },
      { label: 'Cash Equity', value: cPct(fm.cashEquityPct), sub: 'existing + new cash' },
      { label: 'In-Kind Equity', value: cPct(fm.inKindEquityPct), sub: 'contributed land' },
      { label: 'Customer Funding', value: cPct(fm.customerFundingPct), sub: 'pre-sales collections' },
    ]);

    // ── Operating KPIs (shared builder; only the blocks the project carries) ──
    const ok = buildOperatingKpis(snap, state.assets);
    if (ok.hospitality || ok.residential || ok.lease) {
      subTitle('Operating KPIs (hospitality / residential / lease)');
      const unitRate = (v: number | null): string => (v == null ? 'n/a' : Math.round(v).toLocaleString('en-US'));
      const intFmt = (v: number): string => Math.round(v).toLocaleString('en-US');
      if (ok.hospitality) {
        const h = ok.hospitality;
        textLine('Hospitality Operations');
        note(`Blended across all hospitality (Operate) assets over the hold. ADR and RevPAR are per-night rates in ${currency} (not scaled); occupancy is occupied / available room nights.`);
        kpiStrip('', [
          { label: 'Occupancy', value: cPct(h.occupancy), sub: 'occupied / available nights' },
          { label: 'ADR', value: unitRate(h.adr), sub: `${currency} / occupied night` },
          { label: 'RevPAR', value: unitRate(h.revpar), sub: `${currency} / available night` },
          { label: 'Rooms Revenue', value: cMoney(h.roomsRevenue) },
          { label: 'F&B Revenue', value: cMoney(h.fbRevenue) },
          { label: 'Other Revenue', value: cMoney(h.otherRevenue) },
          { label: 'Total Hospitality Revenue', value: cMoney(h.totalRevenue) },
          { label: 'Available Room Nights', value: intFmt(h.availableRoomNights), sub: 'capacity over hold' },
        ]);
      }
      if (ok.residential) {
        const s = ok.residential;
        textLine('Residential (For-Sale)');
        note(`Blended across all Sell / Sell+Manage assets over the hold. Prices are sale value; per-unit and per-sqm rates are in ${currency} (not scaled).`);
        kpiStrip('', [
          { label: 'Residential GDV', value: cMoney(s.saleValue), sub: 'sale value' },
          { label: 'Units Sold', value: intFmt(s.unitsSold), sub: 'pre + post sales' },
          { label: 'Avg Sale Price / Unit', value: unitRate(s.pricePerUnit), sub: `${currency} / unit` },
          { label: 'Avg Sale Price / sqm', value: unitRate(s.pricePerSqm), sub: `${currency} / sellable sqm` },
          { label: 'Pre-Sales %', value: cPct(s.preSalesPct), sub: 'pre-sales / residential GDV' },
          { label: 'Sales Velocity', value: unitRate(s.velocity), sub: 'units / yr (active years)' },
        ]);
      }
      if (ok.lease) {
        const l = ok.lease;
        textLine('Lease / Income (Retail, Office)');
        note(`Blended across all Lease assets over the hold. Rent is achieved rent per occupied sqm per year in ${currency} (not scaled); occupancy is occupied area / GLA over operating periods.`);
        kpiStrip('', [
          { label: 'Total GLA', value: intFmt(l.gla), sub: 'sqm leasable' },
          { label: 'Avg Occupancy', value: cPct(l.avgOccupancy), sub: 'occupied / GLA over ops' },
          { label: 'Rent per Leased sqm', value: unitRate(l.rentPerSqm), sub: `${currency} / occupied sqm / yr` },
          { label: 'Total Lease Revenue', value: cMoney(l.totalRevenue) },
        ]);
      }
    }
  }

  // ═══ 3. Case Comparison (Module5CaseComparison) ═══════════════════════════════
  section('3. Case Comparison');
  emitCaseComparison({ ws, N, row: () => r, setRow: (x) => { r = x; }, subTitle, note, report: caseReportOf(ctx.caseComparison), currency,
    intro: 'Every case computed through the full model. The Management Case is the base; each scenario applies its own input overrides. Money figures in millions. The figure in brackets under each scenario is the delta vs the Management Case.' });

  return { rs: rsx };
}

/** The case comparison matrix, shared by the Module 5 Case Comparison section
 *  and the Module 6 Comparison section (both screens render the same table from
 *  the same report). Header: each case with its overrides note; body: CASE_KPIS
 *  with the delta vs Management in brackets under every scenario. */
function emitCaseComparison(a: {
  ws: ExcelJS.Worksheet; N: number; row: () => number; setRow: (r: number) => void;
  subTitle: (t: string) => void; note: (t: string) => void;
  report: CaseComparisonReport | null; currency: string; intro: string; title?: string;
}): void {
  const { ws, report } = a;
  if (!report || report.columns.length === 0) {
    a.note('No cases are defined for this project, so there is nothing to compare. Cases are added in Module 6 (Scenario Analysis).');
    return;
  }
  a.note(a.intro);
  const cols = report.columns;
  const baseCol = cols.find((c) => c.id === report.baseId) ?? cols[0];
  const cPct = retPct, cMult = retMult, cMoney = retMoney(a.currency);
  const fmtKpi = (v: number | null, kind: CaseKpiKind, nullLabel?: string): string => (v == null || !Number.isFinite(v) ? (nullLabel ?? 'n/a') : kind === 'pct' ? cPct(v) : kind === 'mult' ? cMult(v) : cMoney(v));
  const fmtDelta = (v: number | null, base: number | null, kind: CaseKpiKind): string => {
    if (v == null || base == null || !Number.isFinite(v) || !Number.isFinite(base)) return '';
    const d = v - base; if (Math.abs(d) < 1e-9) return '0';
    const sign = d > 0 ? '+' : '';
    return kind === 'pct' ? `${sign}${(d * 100).toFixed(1)} pp` : kind === 'mult' ? `${sign}${d.toFixed(2)}x` : `${sign}${cMoney(d)}`;
  };
  a.subTitle(a.title ?? 'Case Comparison, headline KPIs (delta vs Management base)');
  let r = a.row();
  setColHeader(ws.getCell(r, LBL_COL), 'Metric', 'left');
  cols.forEach((c, i) => setColHeader(ws.getCell(r, OPEN_COL + i), `${c.role === 'base' ? '★' : '◆'} ${c.name}${c.isActive ? ' (active)' : ''}`, 'right'));
  r += 1;
  setLabel(ws.getCell(r, LBL_COL), '');
  cols.forEach((c, i) => { const cell = ws.getCell(r, OPEN_COL + i); cell.value = caseOverridesNote(c); cell.numFmt = '@'; cell.alignment = { horizontal: 'right' }; cell.font = { name: 'Calibri', size: 8, italic: true, color: { argb: ARGB.navyDark } }; });
  r += 1;
  for (const k of report.kpis) {
    setLabel(ws.getCell(r, LBL_COL), k.sub ? `${k.label} (${k.sub})` : k.label);
    cols.forEach((col, i) => {
      const v = col.values[k.label] ?? null;
      let s = fmtKpi(v, k.kind, k.nullLabel);
      if (col.id !== report.baseId) { const d = fmtDelta(v, baseCol.values[k.label] ?? null, k.kind); if (d) s += ` (${d})`; }
      const cell = ws.getCell(r, OPEN_COL + i); cell.value = s; cell.numFmt = '@'; cell.alignment = { horizontal: 'right' };
      cell.font = { name: 'Calibri', size: BODY_SIZE, bold: col.isActive, color: { argb: ARGB.formula } };
    });
    r += 1;
  }
  a.setRow(r + 1);
}

// ── Scenarios (Module 6: 1. Cases, 2. Assumptions by case, 3. Comparison, 4. YoY) ─
/** Mirror of the platform Module 6 (Scenario Analysis) in its own section order,
 *  from the same shared builders its screen reads: the case list, the
 *  assumptions grid (`curatedDefaultFields`, `inactiveLeverReason`,
 *  `isAppliedValue`, `groupAssumptionRows`, so the curated key drivers show with
 *  their Management values even when no case overrides anything), the comparison
 *  report and the year-on-year report. The statement tabs render the SELECTED
 *  case; this tab always compares ALL cases. */
function addScenarios(ctx: EmitCtx): void {
  const { wb, snap, currency } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.scenarios, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Scenarios', 'Mirror of the platform Module 6 (Scenario Analysis): 1. Cases, 2. Assumptions by case, 3. Comparison, 4. Year-on-Year Impact. The statement tabs render the selected case; this tab always compares ALL cases.', { label: 'Line', feeds: 'Every case is computed through the same engine as the platform (overrides applied to the Management base, then the financials and returns). The Management base is the reference column.' });
  let r = 5;

  const section = (text: string): void => { setSectionHeader(ws.getRow(r), text, lastActiveCol(N), ARGB.accent); r += 1; };
  const subTitle = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.subtotal);
    for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    r += 1;
  };
  const note = (text: string): void => {
    if (!text) return;
    setLabel(ws.getCell(r, LBL_COL), text);
    ws.getCell(r, LBL_COL).font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
    r += 2;
  };
  // A per-period money row (label + opening E + F.. + Total D). A running
  // balance ('stock') leaves the Total BLANK, as the screen does: a balance
  // summed over periods is not a number.
  const periodRow = (label: string, values: number[], prior: number, kind: 'flow' | 'stock', style: 'plain' | 'bold' | 'delta' = 'plain'): void => {
    const vals = values.slice(0, N);
    setLabel(ws.getCell(r, LBL_COL), label, { bold: style === 'bold' });
    const font = { name: 'Calibri', size: BODY_SIZE, bold: style === 'bold', italic: style === 'delta', color: { argb: style === 'delta' ? ARGB.navyDark : ARGB.formula } };
    if (style === 'delta') ws.getCell(r, LBL_COL).font = font;
    const put = (c: number, v: number): void => { const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = font; };
    put(OPEN_COL, prior);
    for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    if (kind === 'flow') put(TOTAL_COL, vals.reduce((s, v) => s + (v ?? 0), 0));
    r += 1;
  };

  const input = ctx.caseComparison;
  const report = caseReportOf(input);
  const useScenarios = (input?.baseModel?.project?.useScenarios ?? ctx.state.project.useScenarios) ?? true;

  // ── "Use scenarios?" ──
  setLabel(ws.getCell(r, LBL_COL), 'Use scenarios?', { bold: true });
  { const c = ws.getCell(r, TOTAL_COL); c.value = useScenarios ? 'Yes' : 'No'; c.numFmt = '@'; c.alignment = { horizontal: 'right' }; markInput(c); }
  r += 1;
  note(useScenarios
    ? 'A scenario is the Management (base) case plus a few input overrides. The active case drives every module and the Returns tabs. The base model is never changed.'
    : 'Scenarios are off. The platform computes on the Management Case, and the assumptions grid and case comparison are hidden. The cases and overrides are saved, not deleted.');

  // ── 1. Cases ──
  section('1. Cases');
  if (!input || !report || report.columns.length === 0) {
    note('No scenario cases are defined for this project. Add scenario cases in Module 6 (Scenario Analysis) on the platform to compare assumptions and outcomes here, then re-export.');
    return;
  }
  const cols = report.columns;
  {
    setColHeader(ws.getCell(r, LBL_COL), 'Case', 'left');
    ['Type', 'Active', 'Overrides'].forEach((h, i) => setColHeader(ws.getCell(r, OPEN_COL + i), h, 'right'));
    r += 1;
    for (const c of cols) {
      setLabel(ws.getCell(r, LBL_COL), `${c.role === 'base' ? '★' : '◆'} ${c.name}`, { bold: c.isActive });
      [c.role === 'base' ? 'Management (base)' : 'Scenario', c.isActive ? 'ACTIVE' : '', c.role === 'base' ? 'base' : `${c.overrideCount} override${c.overrideCount === 1 ? '' : 's'}`].forEach((v, i) => {
        const cell = ws.getCell(r, OPEN_COL + i); cell.value = v; cell.numFmt = '@'; cell.alignment = { horizontal: 'right' }; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
      });
      r += 1;
    }
    r += 1;
  }
  if (!useScenarios) return;

  // ── 2. Assumptions by case ──
  section('2. Assumptions by case');
  note('Each row is an assumption, each column a case. A scenario value that differs from the Management Case is bold. Key drivers show by default, then every field any case overrides; a lever that cannot move results under the current settings is marked so.');
  {
    const base = input.baseModel;
    const gridCtx = buildGridContext(base);
    const fields = enumerateOverridableFields(base).filter((f) => !isPerPeriodLever(f.field) && !nonEconomicLeverReason(f.path, f.field));
    const fieldByPath = new Map(fields.map((f) => [f.path, f]));
    const overridesOf = (id: string): Record<string, unknown> => input.cases.find((c) => c.id === id)?.overrides ?? {};
    const allOverridePaths = new Set<string>();
    for (const c of input.cases) if (c.role !== 'base') Object.keys(c.overrides ?? {}).forEach((p) => allOverridePaths.add(p));
    const rowPaths: string[] = [];
    const seen = new Set<string>();
    const add = (p: string): void => { if (!seen.has(p)) { seen.add(p); rowPaths.push(p); } };
    curatedDefaultFields(base).forEach((f) => { if (!inactiveLeverReason(f.path, base)) add(f.path); });
    allOverridePaths.forEach(add);
    const built: GridRowLite[] = [];
    for (const path of rowPaths) {
      const baseVal = getByPath(base, path);
      if (!allOverridePaths.has(path) && !isAppliedValue(baseVal)) continue;
      built.push({ path, descriptor: assumptionFor(path, fieldByPath.get(path), baseVal, gridCtx) });
    }
    const groups = groupAssumptionRows(built);
    if (groups.length === 0) {
      note('No assumptions yet. Add one on the platform to start comparing values across cases.');
    } else {
      setColHeader(ws.getCell(r, LBL_COL), 'Assumption', 'left');
      setColHeader(ws.getCell(r, META_B), 'Note', 'left');
      cols.forEach((c, i) => setColHeader(ws.getCell(r, OPEN_COL + i), `${c.role === 'base' ? '★' : '◆'} ${c.name}`, 'right'));
      r += 1;
      for (const g of groups) {
        subTitle(g.label);
        for (const item of g.items) {
          if (item.grouped) { setLabel(ws.getCell(r, LBL_COL), item.label, { bold: true, indent: 1 }); r += 1; }
          for (const row of item.rows) {
            const p = row.path;
            const baseValue = getByPath(base, p);
            setLabel(ws.getCell(r, LBL_COL), item.grouped ? (row.descriptor.context || row.descriptor.label) : row.descriptor.label, { indent: item.grouped ? 2 : 0 });
            const notes = [inactiveLeverReason(p, base) ? 'not used under current settings' : '', leverNote(p) ?? ''].filter(Boolean).join('. ');
            if (notes) setBasis(ws.getCell(r, META_B), notes);
            cols.forEach((c, i) => {
              const ov = c.role === 'base' ? {} : overridesOf(c.id);
              const has = Object.prototype.hasOwnProperty.call(ov, p);
              const value = has ? ov[p] : baseValue;
              const cell = ws.getCell(r, OPEN_COL + i);
              cell.value = `${formatAssumptionValue(value, row.descriptor.format)}${assumptionUnitSuffix(row.descriptor.format)}`;
              cell.numFmt = '@'; cell.alignment = { horizontal: 'right' };
              markInput(cell);
              if (has && c.role !== 'base') cell.font = { ...(cell.font as object), bold: true };
            });
            r += 1;
          }
        }
      }
      r += 1;
    }
  }

  // ── 3. Comparison ──
  section('3. Comparison');
  emitCaseComparison({ ws, N, row: () => r, setRow: (x) => { r = x; }, subTitle, note, report, currency, title: 'Comparison',
    intro: 'Every case computed through the full model. Money figures in millions. The figure in brackets under each scenario is the delta vs the Management Case.' });

  // ── 4. Year-on-Year Impact ──
  section('4. Year-on-Year Impact');
  let yoy: CaseYoYReport | null = null;
  try { yoy = buildCaseYoYReport(input); } catch { yoy = null; }
  note(`One block per input a scenario changes: the input value per case, then every per-period output that input drives (Management and each scenario), with each scenario's delta vs Management below the actuals. The Total column sums flows and is blank for running balances. The opening column${yoy ? ` (${yoy.priorYearLabel})` : ''} is the opening / inception period.`);
  if (!yoy || yoy.blocks.length === 0) {
    note('No year-on-year impact yet. Override an input that drives a per-period output (for example debt %, an interest rate, a price / ADR, opex, or a construction cost) in a scenario to see how it diverges from Management over time.');
    return;
  }
  for (const b of yoy.blocks) {
    subTitle(b.inputLabel);
    for (const line of b.inputs) {
      const parts = line.byCase.map((iv) => `${iv.role === 'base' ? '★' : '◆'} ${iv.name}: ${formatAssumptionValue(iv.value, line.format)}${assumptionUnitSuffix(line.format)}`);
      setLabel(ws.getCell(r, LBL_COL), `${line.label}:  ${parts.join('   ')}`, { bold: true });
      r += 1;
    }
    for (const o of b.outputs) {
      setLabel(ws.getCell(r, LBL_COL), `${o.label}${o.kind === 'stock' ? ' (balance)' : ''}`, { bold: true });
      fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.grey);
      r += 1;
      periodRow(`★ ${o.base.name}`, o.base.values, o.base.prior, o.kind, 'bold');
      for (const sc of o.scenarios) periodRow(`◆ ${sc.name}`, sc.values, sc.prior, o.kind);
      for (const d of o.deltas) periodRow(`${d.name} delta vs Management`, d.values, d.prior, o.kind, 'delta');
      r += 1;
    }
  }
}

// ── Checks / legend ───────────────────────────────────────────────────────────
function addChecks(ctx: EmitCtx, capexAddrs: CapexAddrs, retLinks: RetLinks): void {
  void capexAddrs;
  // Every check reconciles the PLATFORM snapshot, which is what this workbook
  // prints, through the SAME rules the PDFs use (lib/reports/checksReport.ts).
  const { wb, snap } = ctx;
  const ws = wb.addWorksheet(SHEETS.checks, { properties: { tabColor: { argb: ARGB.navy } }, views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 42; ws.getColumn(2).width = 14; ws.getColumn(3).width = 18; ws.getColumn(4).width = 62;
  setTitle(ws.getCell('A1'), 'Checks & Legend', 16);
  let r = 3;
  // The legend carries the same four swatches as the Cover.
  setSectionHeader(ws.getRow(r), 'Colour legend (FAST)', 4); r += 1;
  { const inp = ws.getCell(`A${r}`); inp.value = 'Input (the assumption a user edits before re-exporting)'; markInput(inp); r += 1; }
  { const fm = ws.getCell(`A${r}`); fm.value = 'Computed value (platform snapshot, hardcoded constant)'; fm.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; r += 1; }
  { const sc = ws.getCell(`A${r}`); sc.value = 'Section (a navy band opening a numbered section)'; fillCell(sc, ARGB.accent); sc.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } }; r += 1; }
  { const tc = ws.getCell(`A${r}`); tc.value = 'Total (a navy row closing a table)'; fillCell(tc, ARGB.navy); tc.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white } }; r += 1; }
  r += 1;

  setSectionHeader(ws.getRow(r), 'Platform verification snapshot (results as of export)', 4); r += 1;
  ['Check', 'Status', 'Residue', 'Detail'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, 'left')); r += 1;
  // TOLERANCE IS RELATIVE (checksReport.CHECK_REL_TOL): a residue is judged
  // against the peak of the quantity it reconciles, so an iterative solver's
  // round-off passes and a genuine break still shows its measured gap.
  const checkRow = (label: string, status: 'OK' | 'CHECK' | 'NOTE', residue: number, detail: string): void => {
    setLabel(ws.getCell(`A${r}`), label);
    const s = ws.getCell(`B${r}`); s.value = status; s.numFmt = '@'; s.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: status === 'OK' ? ARGB.good : status === 'CHECK' ? ARGB.bad : ARGB.navyDark } };
    const c = ws.getCell(`C${r}`); c.value = residue; c.numFmt = NUMFMT.money; c.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
    const d = ws.getCell(`D${r}`); d.value = detail; d.numFmt = '@'; d.font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } }; d.alignment = { wrapText: true, vertical: 'top' };
    r += 1;
  };
  const checkMoney = (v: number): string => `${formatAccounting(Math.abs(v), 'millions', 1)} m`;
  // The three integrity identities, named as the platform names them.
  for (const c of buildIntegrityChecks(snap)) {
    checkRow(c.label, c.ok ? 'OK' : 'CHECK', c.residue, checkDetail(c, snap.yearLabels, checkMoney));
  }
  // The fourth: the Balance Sheet tab's reconciliation bridge must leave nothing
  // unexplained. Same relative tolerance, measured against peak total assets.
  {
    const unexplained = buildBsReconciliationRows({ snap, state: ctx.state, fmt: String }).find((x) => x.label === 'Unexplained (must be 0)')?.values ?? [];
    const w = worstDivergence(unexplained, unexplained.map(() => 0), snap.bs.totalAssetsPerPeriod, snap.axisLength);
    const chk = { label: 'Balance sheet reconciliation bridge, unexplained', ok: relativeCheckOk(w.residue, w.magnitude), residue: w.residue, atIndex: w.atIndex, magnitude: w.magnitude, what: 'unexplained' };
    checkRow(chk.label, chk.ok ? 'OK' : 'CHECK', chk.residue, `${checkDetail(chk, snap.yearLabels, checkMoney)}. The "Unexplained (must be 0)" row of the reconciliation bridge on the Balance Sheet tab.`);
  }
  // Advisories: NOTE, never OK or CHECK. A gap between cash collected and gross
  // sale value, or a sale with no downpayment stated, is legitimate model state,
  // not a broken identity, so the residue beside a NOTE is the size of the gap it
  // describes and is expected to be non-zero.
  for (const a of poolRevenueBasisByLine(buildRevenueBasisAdvisoriesFor(ctx.state.assets, ctx.state.subUnits, snap.revenue), ctx.state)) {
    checkRow(`Revenue basis, ${a.assetName}`, 'NOTE', a.collections - a.gross, `${revenueBasisAdvisoryText(a, checkMoney)} Advisory, not a failure: the residue is the collections less the gross sale value.`);
  }
  for (const a of poolSaleCohortByLine(buildSaleCohortAdvisories(ctx.state.assets, ctx.state.project.saleCohortDefaults?.downpayment, snap.revenue), ctx.state)) {
    checkRow(`Downpayment not stated, ${a.assetName}`, 'NOTE', a.saleValue, `${saleCohortAdvisoryText(a, checkMoney)} Advisory, not a failure: the residue is the sale value the missing input applies to.`);
  }
  setLabel(ws.getCell(`A${r}`), 'OK and CHECK rows are identities that must reconcile to zero within the relative tolerance. NOTE rows are advisories: the model is internally consistent, and the figure beside them measures the situation the note describes.');
  ws.getCell(`A${r}`).font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
  r += 2;

  // Headline returns: the three pairs, each IRR beside its own MOIC, from the
  // same returns engine the Returns tab printed.
  setSectionHeader(ws.getRow(r), 'Headline returns (platform snapshot)', 4); r += 1;
  ['Basis', '', 'IRR', 'MOIC'].forEach((h, i) => { if (h) setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'); }); r += 1;
  const res = retLinks.rs?.result;
  const pairs: Array<[string, number | null | undefined, number | null | undefined]> = [
    ['Project IRR (FCFF)', res?.fcff.irr, res?.fcff.moic],
    ['Equity IRR (FCFE)', res?.fcfe.irr, res?.fcfe.moic],
    // The same rule as every other surface: net leads where a performance fee
    // is charged, and the gross pair is named rather than implied.
    ...(retLinks.rs ? (() => {
      const dp = distributedReturnPair(retLinks.rs);
      const rows: Array<[string, number | null | undefined, number | null | undefined]> = [
        [dp.preFeeIrr != null ? 'Distributed Equity IRR (net of performance fee)' : 'Distributed Equity IRR', dp.irr, dp.moic],
      ];
      if (dp.preFeeIrr != null) rows.push(['Distributed Equity IRR (gross)', dp.preFeeIrr, dp.preFeeMoic]);
      return rows;
    })() : []),
  ];
  for (const [label, irr, moic] of pairs) {
    setLabel(ws.getCell(`A${r}`), label);
    const ic = ws.getCell(`C${r}`); ic.value = irr != null && Number.isFinite(irr) ? irr : 'n/a'; ic.numFmt = typeof ic.value === 'number' ? NUMFMT.pct2 : '@'; ic.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
    const mc = ws.getCell(`D${r}`); mc.value = moic != null && Number.isFinite(moic) ? moic : 'n/a'; mc.numFmt = typeof mc.value === 'number' ? NUMFMT.mult : '@'; mc.alignment = { horizontal: 'left' }; mc.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
    r += 1;
  }
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
  { sheet: SHEETS.summary, desc: 'Project overview: three return pairs, cost per sqm, economics, capital structure, scheme, land and build by type, revenue mix, phases, exit' },
  { group: 'Module 1  ·  Setup, Costs & Financing' },
  { sheet: SHEETS.assumptions, desc: 'Every input screen of the platform in module order, input cells shaded' },
  { sheet: SHEETS.timeline, desc: 'The model year axis and each phase\'s construction and operations windows' },
  { sheet: SHEETS.landArea, desc: 'Derived areas by plot and by line (top-down chain), land by asset' },
  { sheet: SHEETS.capex, desc: 'Capex inputs and results Tables 1 to 6, by line' },
  { sheet: SHEETS.financing, desc: 'Funding method, facilities, debt and equity drawdowns, IDC, the cash sweep and dividends, in the platform\'s four sub-tabs' },
  { group: 'Module 2  ·  Revenue & Cost of Sales' },
  { sheet: SHEETS.revenue, desc: 'Inputs, Output, Cost of Sales, Schedules and Escrow, one card per line by section' },
  { group: 'Module 3  ·  Operating Expenses' },
  { sheet: SHEETS.opex, desc: 'Opex inputs per line, operating statements (hotel and lease) and accounts payable' },
  { group: 'Module 4  ·  Financial Statements' },
  { sheet: SHEETS.schedules, desc: 'Fixed Assets & D&A and the Balance Sheet schedules' },
  { sheet: SHEETS.pl, desc: 'Profit and loss (income statement), project and per phase' },
  { sheet: SHEETS.cashflow, desc: 'Cash flow statement (Direct and Indirect), project and per phase' },
  { sheet: SHEETS.balsheet, desc: 'Balance sheet, balance check and reconciliation bridge' },
  { group: 'Module 5  ·  Returns & RE Metrics' },
  { sheet: SHEETS.returns, desc: 'Returns (IRR and MOIC by basis, partners, fees, streams and build-ups, exit working, sensitivity), RE Metrics (covenants, exit years, detail), Case Comparison' },
  { group: 'Module 6  ·  Scenario Analysis' },
  { sheet: SHEETS.scenarios, desc: 'Cases, assumptions by case, comparison, year-on-year impact' },
  { group: 'Reference' },
  { sheet: SHEETS.checks, desc: 'Integrity checks, advisories, colour legend and headline returns' },
];
/** The tab list as THIS export prints it: the Returns entry names the
 *  sensitivity grid only when the entitlement put one on the tab. */
function moduleTocFor(opts: BuildModelOptions): TocEntry[] {
  if (opts.includeSensitivity === true) return MODULE_TOC;
  return MODULE_TOC.map((e) => ('sheet' in e && e.sheet === SHEETS.returns ? { ...e, desc: e.desc.replace('exit working, sensitivity', 'exit working') } : e));
}

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
    projectLocationLabel(p.location, p.country) || null,
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
    ...moduleTocFor(opts),
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

  for (const e of moduleTocFor(opts)) {
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
    G('inputs', 'Finished figures from the returns engine, the capex report, the area and land rules, the revenue sections and the balance sheet.'),
    G('logic', 'Nothing is re-derived: this is the same overview builder the platform\'s Project Overview uses. Each IRR sits beside its own MOIC; the distributed pair is after the performance fee where a fund exists. Cost per sqm divides development or construction cost by GFA or saleable area. Debt / Equity is each one\'s share of total sources.'),
    G('feeds', 'Nothing downstream. This is the read-out to hand over when the detail is not needed.'),
  ],
  [SHEETS.assumptions]: [
    G('inputs', 'Every input screen of the platform in module order: Project & Phases, Fund Terms, Asset Types & Standards (type values, parking area per slot, cost escalation, cost standards), Plots, Assets by plot (Table 2), Sub-units (Table 5), Capex lines, Financing, Revenue and Escrow per line, Opex per line and DPO, P&L and depreciation inputs, Returns.'),
    G('logic', 'Nothing is computed here. Shaded cells are what a user types on the platform; unshaded figures beside them (derived windows, values inherited from the asset type, capex quantities and subtotals, resolved ADR and rent, default splits) are shown the way the screens show them.'),
    G('feeds', 'Every other tab. Change an input on the platform and re-export to see the effect flow through; editing this workbook does not recalculate it.'),
  ],
  [SHEETS.timeline]: [
    G('inputs', 'Each phase\'s start date, construction periods and operations periods (a legacy overlap on an older project is read, never edited).'),
    G('logic', 'Period 0 is the opening column (the year before the project start); periods 1..N are the active years. Construction runs from the phase start for its construction periods; operations begin the day after construction ends and run for the operations periods. The project ends at the latest operations end across all phases.'),
    G('feeds', 'Every period tab keys its columns to this axis, so all tabs share one timeline and one period index.'),
  ],
  [SHEETS.landArea]: [
    G('inputs', 'Plot area and land rate (Table 1), the Table 2 massing (land utilisation, ground coverage, FAR, retail share, service share), and the asset type values (unit size, parking ratio, parking area per slot). A plot value wins; an absent value inherits from the type; a typed 0 is a real value.'),
    G('logic', 'Top-down per plot: plot area x utilisation = net developable area; x coverage = building footprint; utilised land x FAR = Total GFA. The retail share of the footprint is ground-floor retail, carried by the line\'s retail strip, which carves its land out of its hosts in proportion to retail GFA over each host\'s total GFA. Main Asset GFA less the service share gives net saleable area; units, parking slots and parking areas follow; Total BUA = Total GFA + parking. Table 4 adds the plots of each line. Land is allocated by sqm only: land value = land sqm x the plot\'s rate, split into cash and in-kind by the plot\'s percentages.'),
    G('feeds', 'The Capex quantity bases (Main Asset GFA, Parking Area, Landscape Area, Plot Area, Retail GFA, Retail Parking Area), the land value lines in Capex, and the land on the Balance Sheet.'),
  ],
  [SHEETS.capex]: [
    G('inputs', 'Each cost line, by line: method, rate (base-year money, a Types and Standards default unless typed on the Capex line), the rate source, and the phasing source the engine resolved (the phase curve, the line\'s own curve, follows land cash, follows collections, or the parcel payment schedule); construction cost escalation from Types and Standards.'),
    G('logic', 'Each line = Rate x Quantity on its basis (Main Asset GFA, Parking Area, Landscape, Retail GFA, Retail Parking, Plot Area, units, a percentage of land, of revenue or of the lines selected above it, or a lump sum). When escalation is on, a rate escalates from the project start year into the years its line spends, weighted by the line\'s spend profile; lump sums, the land value lines and anything charged on land or revenue are exempt. The allocation profile is the engine\'s resolved spend as a share of each line\'s total.'),
    G('feeds', 'Table 2 (incl. all land) feeds Cost of Sales and fixed assets; Table 3 (excl. land in-kind) is the cash capex Financing funds; Table 4 (excl. total land) is construction cost; Table 5 gives land cash and in-kind per phase for land funding; Table 6 files the cost by category.'),
  ],
  [SHEETS.financing]: [
    G('inputs', 'Minimum cash, IDC allocation basis, funding method and its debt / equity split, how the fund management fee is funded, the land funding split per phase, and each facility\'s interbank rate, credit spread, fees, repayment method, start year, periods and share.'),
    G('logic', 'The selected method sizes the requirement. Method 3 (cash deficit) draws debt and equity at the ratio only in periods with construction spend, to keep the minimum cash, and its sizing carries no finance cost. IDC is paid in the period it arises, with debt drawn only for what cash cannot cover, and is capitalised into asset cost. A fee funded by equity is drawn directly, outside the ratio. Each finance cost ledger closes Opening + Charge - Paid. The sweep repays debt from surplus above the minimum cash, then dividends follow the policy.'),
    G('feeds', 'Interest to the P&L; drawdowns, repayments, interest paid and dividends to the Cash Flow; debt and equity to the Balance Sheet; FCFE and distributions to Returns.'),
  ],
  [SHEETS.revenue]: [
    G('inputs', 'Per line, filed by section (Residential, Hospitality, Standalone Commercial, Retail Ground Floor): sub-units and prices from the Assets tab (sale price per sqm or per unit, ADR, rent), sales pace by year, price or rent indexation, recognition method, sale cohort terms (downpayment by sale year, instalment years), hotel occupancy, guests, F&B and Other, lease occupancy, receivable days, and the escrow held % and years.'),
    G('logic', 'Sell revenue = area or units sold (pace x inventory, capped at what is unsold) x base price x indexation factor. Pre-sales recognise at handover (the last construction year), or per the recognition profile; sales during operation recognise in their sale year. Collections follow the sale cohort terms: a downpayment in the sale year, then instalments to handover. Hotel revenue = keys x days x occupancy x indexed ADR, plus F&B and Other as a percentage of rooms. Lease revenue = gross lease area x occupancy x indexed rent. Cost of sales = Module 1 capex plus capitalised IDC, released on each line\'s share of lifetime recognised revenue. Escrow locks a share of pre-sales cash and releases it as one sum in the release year.'),
    G('feeds', 'Revenue and Cost of Sales to the P&L; collections (net of escrow) to the Cash Flow operating block; receivables, inventory, unearned revenue and the escrow balance to the Balance Sheet.'),
  ],
  [SHEETS.opex]: [
    G('inputs', 'HQ overheads and the project DPO, then per line: opex items by category and mode (percent of revenue or GOP, per key, per sqm, fixed), the asset inflation and any per-item override or year-by-year rates.'),
    G('logic', 'Fixed, per-key and per-sqm items inflate with the asset (or overriding) inflation; percent-of-revenue and percent-of-GOP items move with revenue and are not indexed. A hotel reads as an operating statement: revenue by department, departmental expenses, undistributed expenses, GOP, management fees, fixed charges and reserves, EBITDA. Lease lines group into property operating costs and other charges down to EBITDA. Accounts payable = opex x DPO / days basis; cash paid = opex less the change in payables.'),
    G('feeds', 'Opex by line to the P&L between revenue and EBITDA (hotel departments and expense groups as members of their headers); opex paid to the Cash Flow; accounts payable to the Balance Sheet.'),
  ],
  [SHEETS.schedules]: [
    G('inputs', 'Capex by line, capitalised interest (IDC) by line, useful life and depreciation method per line, revenue recognition and collections, opex and DPO, and the debt, equity and dividend schedules.'),
    G('logic', 'Fixed Assets & D&A, per held line (Operate and Lease): Land (opening + additions - disposed at exit = closing; land never depreciates) and Depreciable (opening + capex additions + IDC additions - depreciation - disposed at exit = closing). Depreciation starts when the asset is available for use, on capex and IDC alike, and stops at the exit, when the balance is written off as a disposal. IDC on a Sell line is not a fixed asset: it goes to inventory and is released through Cost of Sales. BS Schedules roll each balance forward: receivables, unearned revenue, inventory, payables, escrow, debt, equity and retained earnings.'),
    G('feeds', 'Every closing balance is a Balance Sheet line; every movement is the matching adjustment in the Indirect Cash Flow; depreciation is the D&A line of the P&L.'),
  ],
  [SHEETS.pl]: [
    G('inputs', 'Recognised revenue and Cost of Sales from Revenue, opex from Opex, the fund management fees, D&A from Schedules, interest, the disposal gain, and the zakat or tax rate with its disposal-gain toggle.'),
    G('logic', 'Revenue - Cost of Sales = gross profit; - operating expenses - Total Fund Management Fee = EBITDA (struck after the fund fees). EBITDA - D&A = EBIT; - interest expensed (construction interest is capitalised, not expensed) + gain on disposal = profit before zakat or tax; - zakat or tax (charged excluding the disposal gain unless the toggle includes it) = profit after tax. The subtotals are the engine\'s own figures, never recomputed. A phase view stops at EBITDA before the fund fees, which are project-level, so phase EBITDAs do not add to the project figure.'),
    G('feeds', 'Profit after tax to retained earnings on the Balance Sheet and to the top of the Indirect Cash Flow; EBITDA to the DSCR and ICR covenants in Returns.'),
  ],
  [SHEETS.cashflow]: [
    G('inputs', 'Collections and escrow from Revenue, opex paid from Opex, fund fees, zakat or tax paid, capex and disposal proceeds, and drawdowns, repayments, interest and dividends from Financing.'),
    G('logic', 'Direct: cash collected - opex paid - Fund Management and Other Expenses - zakat or tax = cash flow from operations; - capex paid in cash (in-kind land shown as a matched pair that nets to zero) + disposal proceeds at the exit = cash flow from investing; + equity and debt drawn - principal, interest and dividends = cash flow from financing. Indirect: profit after tax + D&A - gain on disposal +/- working capital movements = the same cash flow from operations. Closing cash = opening + net cash flow, and both methods must agree every period. A phase view shows operations and investing only.'),
    G('feeds', 'Closing cash is the Balance Sheet cash line. The Checks tab asserts Direct equals Indirect and cash ties to the Balance Sheet in every period.'),
  ],
  [SHEETS.balsheet]: [
    G('inputs', 'Closing balances from the Schedules, closing cash from the Direct Cash Flow, and debt and equity from Financing.'),
    G('logic', 'Assets (cash, restricted escrow cash, receivables, inventory, fixed assets including capitalised IDC, land) = Liabilities (payables, unearned revenue, debt) + Equity (share capital, reserves, retained earnings). Cash is carried from the Direct Cash Flow, and the balance check proves the two sides agree; the reconciliation bridge explains every period\'s movement and its Unexplained row must read 0. Held fixed assets and land read zero from the exit, when they are disposed of.'),
    G('feeds', 'Nothing downstream: this is the closing position. Debt outstanding feeds LTV at peak debt in Returns.'),
  ],
  [SHEETS.returns]: [
    G('inputs', 'The Module 4 statements, the returns assumptions (discount rate, exit year, terminal value method, basis, cap rate or multiple, growth), equity partner shares, fund terms and covenant thresholds.'),
    G('logic', 'FCFF is unlevered full cost: operating cash before interest, less cash capex (investing before disposal proceeds), in-kind land and capitalised interest, plus the terminal value. FCFE builds visibly from FCFF before the terminal value: + net debt - finance cost, then the terminal value less closing debt. Distributed equity is equity in against dividends out. The terminal value capitalises the basis year\'s income (the year before exit by default) at the exit cap rate, an exit multiple or perpetuity growth, or is none, and is booked as a disposal. IRR and MOIC per basis; NPV is not presented. RE Metrics: covenants from per-period series (DSCR and ICR worst year, Debt Yield, LTV at peak debt = debt / GDV).'),
    G('feeds', 'The Summary tab and the Scenarios comparison.'),
  ],
  [SHEETS.scenarios]: [
    G('inputs', 'The Management base case and each scenario case\'s overrides.'),
    G('logic', 'Each case re-runs the engine on a copy of the base with its overrides applied and settled (the base is never changed). The assumptions grid shows the key drivers and every overridden field per case; the comparison shows headline KPIs with deltas against Management; the year-on-year impact appears only when an override drives a per-period output.'),
    G('feeds', 'Nothing downstream. The statement tabs in this workbook are the case selected at export.'),
  ],
  [SHEETS.checks]: [
    G('inputs', 'The balance sheet, both cash flow methods, the reconciliation bridge and the revenue advisories.'),
    G('logic', 'Three identities, each within a relative tolerance of its peak: the balance sheet balances, cash flow closing cash equals balance sheet cash, and Direct net cash flow equals Indirect. The reconciliation bridge\'s Unexplained residue is a fourth. NOTE rows are advisories whose figure measures the situation described, not a failure.'),
    G('feeds', 'Nothing. This tab is the audit trail: when every check passes, the workbook is internally consistent and ties to the platform.'),
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

// ── Summary (mirror of the platform Project Overview) ─────────────────────────
/** The platform's Project Overview, section by section, from the ONE builder the
 *  overview screen reads (`buildOverviewReport`): the three return pairs (each
 *  IRR beside its own MOIC), cost per sqm, key economics, cost and capital
 *  structure with the funding requirement by year, timeline and structure, the
 *  scheme, land and build by asset type, the revenue mix, the phases, and the
 *  exit and cash. No DSCR or ICR, as on the screen. Money is in millions on this
 *  page; areas, counts and rates per sqm are in full units. */
function addSummary(wb: ExcelJS.Workbook, snap: ReturnType<typeof computeFinancialsSnapshot>, opts: BuildModelOptions, lm: LiveModel): void {
  void lm;
  const ws = wb.addWorksheet(SHEETS.summary, { properties: { tabColor: { argb: ARGB.navy } }, views: [{ showGridLines: false }] });
  const p = opts.state.project;
  const currency = p.currency ?? 'SAR';
  // A nine-column canvas (B..J): the phases table is nine columns wide, wider
  // than the six-column cover band, so the Summary widens its own band and banner.
  const L = 2, R = 10;
  frontMatterCanvas(ws);
  ws.getColumn(2).width = 22;
  for (let c = 3; c <= R; c++) ws.getColumn(c).width = 13;
  ws.getColumn(R + 1).width = 3;
  let r = frontMatterBanner(ws, opts.projectName, `Project Overview  ·  ${opts.dateLabel}`);
  ws.unMergeCells('B2:G6'); ws.mergeCells(2, L, 6, R); fillRange(ws, 2, L, 6, R, ARGB.navy);
  ws.unMergeCells('B7:G7'); ws.mergeCells(7, L, 7, R); fillRange(ws, 7, L, 7, R, ARGB.sectionDark);

  const band = (text: string): void => {
    ws.mergeCells(r, L, r, R);
    const c = ws.getCell(r, L);
    c.value = text;
    c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: ARGB.white } };
    c.alignment = { vertical: 'middle', indent: 1 };
    fillRange(ws, r, L, r, R, ARGB.navy);
    ws.getRow(r).height = 18;
    r += 1;
  };
  const noteLine = (text: string): void => {
    ws.mergeCells(r, L, r, R);
    const c = ws.getCell(r, L); c.value = text;
    c.font = { name: 'Calibri', size: 8, italic: true, color: { argb: ARGB.navyDark } };
    c.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(r).height = 24;
    r += 1;
  };

  let rs: ReturnsSnapshot | null = null;
  let ov: ReturnType<typeof buildOverviewReport> | null = null;
  try { rs = computeReturnsSnapshot(snap, p); ov = buildOverviewReport(snap, rs, opts.state); } catch { rs = null; ov = null; }

  const m = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? 'n/a' : `${currency} ${formatAccounting(v, 'millions', 1)} m`);
  const pct = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? 'n/a' : `${(v * 100).toFixed(1)}%`);
  const mult = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? 'n/a' : `${v.toFixed(2)}x`);
  const area = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? 'n/a' : Math.round(v).toLocaleString('en-US'));

  // ── Key facts (two facts per row) ──
  band('Key facts');
  {
    const countryName = p.country ? countryLabel(p.country) : '';
    const loc = (p.location ?? '').trim();
    const location = loc && countryName && !loc.toLowerCase().includes(countryName.toLowerCase()) ? `${loc}, ${countryName}` : (loc || countryName || '-');
    const facts: Array<[string, string]> = [
      ['Date', opts.dateLabel],
      ['Currency', currency],
      ['Location', location],
      ['Horizon', `${snap.axisLength} yrs (${snap.projectStartYear} to ${snap.projectStartYear + snap.axisLength - 1})`],
      ['Exit year', rs ? String(rs.exitYearLabel) : 'n/a'],
      ['Funding method', FUNDING_METHOD_LABELS[(p.financing?.fundingMethod ?? 1) as FundingMethodId]],
    ];
    const top = r;
    for (let i = 0; i < facts.length; i += 2) {
      const put = (labelCol: number, valL: number, valR: number, pair?: [string, string]): void => {
        if (!pair) return;
        const kc = ws.getCell(r, labelCol); kc.value = pair[0]; kc.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
        ws.mergeCells(r, valL, r, valR);
        const vc = ws.getCell(r, valL); vc.value = pair[1]; vc.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } };
      };
      put(2, 3, 6, facts[i]);
      put(7, 8, 10, facts[i + 1]);
      if (((i / 2) % 2) === 1) fillRange(ws, r, L, r, R, ARGB.grey);
      r += 1;
    }
    boxBorder(ws, top, L, r - 1, R);
    r += 1;
  }

  if (!rs || !ov) {
    noteLine('The project overview will appear once the model has enough inputs to compute returns.');
    return;
  }
  const re = rs.result.realEstate, de = rs.developmentEconomics, mix = rs.fundingMix, su = rs.sourcesUses;

  // A wall of tiles: label over value over sub, `perRow` across, each tile
  // spanning an equal share of the eight columns.
  const tiles = (items: Array<{ label: string; value: string; sub?: string }>, perRow: number): void => {
    const span = Math.floor((R - L + 1) / perRow);
    const hasSub = items.some((t) => t.sub);
    items.forEach((t, i) => {
      const row = Math.floor(i / perRow);
      const c1 = L + (i % perRow) * span, c2 = i % perRow === perRow - 1 ? R : c1 + span - 1; // the last tile in a row takes any spare column
      const lr = r + row * (hasSub ? 3 : 2);
      ws.mergeCells(lr, c1, lr, c2);
      const lc = ws.getCell(lr, c1); lc.value = t.label; lc.font = { name: 'Calibri', size: 8, bold: true, color: { argb: ARGB.navyDark } }; lc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; fillCell(lc, ARGB.grey);
      ws.mergeCells(lr + 1, c1, lr + 1, c2);
      const vc = ws.getCell(lr + 1, c1); vc.value = t.value; vc.font = { name: 'Calibri', size: 13, bold: true, color: { argb: ARGB.navy } }; vc.alignment = { horizontal: 'center', vertical: 'middle' };
      if (hasSub) {
        ws.mergeCells(lr + 2, c1, lr + 2, c2);
        const sc = ws.getCell(lr + 2, c1); sc.value = t.sub ?? ''; sc.font = { name: 'Calibri', size: 8, italic: true, color: { argb: ARGB.navyDark } }; sc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      }
      boxBorder(ws, lr, c1, lr + (hasSub ? 2 : 1), c2);
    });
    r += Math.ceil(items.length / perRow) * (hasSub ? 3 : 2) + 1;
  };
  // A table across the canvas: header row, body rows, optional total row.
  const table = (headers: string[], rows: string[][], total?: string[]): void => {
    const top = r;
    headers.forEach((h, i) => { const c = ws.getCell(r, L + i); c.value = h; c.font = { name: 'Calibri', size: 8, bold: true, color: { argb: ARGB.navyDark } }; c.alignment = { horizontal: i === 0 ? 'left' : 'right', wrapText: true }; fillCell(c, ARGB.subtotal); });
    r += 1;
    const body = total ? [...rows, total] : rows;
    body.forEach((cells, ri) => {
      const isTotal = !!total && ri === body.length - 1;
      cells.forEach((v, i) => { const c = ws.getCell(r, L + i); c.value = v; c.font = { name: 'Calibri', size: BODY_SIZE, bold: isTotal || i === 0, color: { argb: isTotal ? ARGB.navy : ARGB.formula } }; c.alignment = { horizontal: i === 0 ? 'left' : 'right' }; });
      r += 1;
    });
    boxBorder(ws, top, L, r - 1, L + headers.length - 1);
    r += 1;
  };

  // ── Headline returns: three pairs, each IRR beside its own MOIC ──
  band('Headline returns');
  tiles(ov.returns.map((x) => ({
    label: x.label,
    value: `${pct(x.irr)}  ·  ${mult(x.moic)}`,
    sub: x.preFeeIrr !== undefined ? `IRR and MOIC after the performance fee; pre-fee ${pct(x.preFeeIrr)} and ${mult(x.preFeeMoic ?? null)}` : 'IRR and MOIC',
  })), 3);
  noteLine(`Investor summary for the open project. Money in ${currency} millions; exit year ${rs.exitYearLabel}.`);
  r += 1;

  // ── Cost per sqm (full units, the way a developer quotes it) ──
  band('Cost per sqm');
  {
    const c = ov.costPerSqm;
    tiles([
      { label: 'Development cost / GFA', value: area(c.developmentCostPerGfa), sub: `${m(c.totalDevelopmentCost)} over ${area(c.gfaSqm)} sqm` },
      { label: 'Construction cost / GFA', value: area(c.constructionCostPerGfa), sub: 'excludes land' },
      { label: 'Development cost / saleable', value: area(c.developmentCostPerSaleable), sub: `over ${area(c.saleableSqm)} sqm` },
      { label: 'Revenue / saleable', value: area(c.revenuePerSaleable), sub: 'what it sells or lets for' },
    ], 4);
  }

  // ── Key economics ──
  band('Key economics');
  tiles([
    { label: 'Gross Development Value', value: m(de.gdv) },
    { label: 'Total Development Cost', value: m(rs.totalDevelopmentCost), sub: 'land + capex' },
    { label: 'Profit after Financing', value: m(de.profitAfterFinancing) },
    { label: 'Development Margin', value: pct(de.developmentMargin), sub: 'profit / GDV' },
  ], 4);

  // ── Cost & capital structure ──
  band('Cost & capital structure');
  {
    const cashEquityPct = mix.cashEquityPct ?? 0, inKindPct = mix.inKindEquityPct ?? 0, debtPct = mix.debtPct ?? 0;
    tiles([
      { label: 'Land Cost', value: m(su.land) },
      { label: 'Capex (construction)', value: m(su.construction), sub: 'excl. land' },
      { label: 'Debt / Equity (of total sources)', value: `${pct(debtPct)} / ${pct(cashEquityPct + inKindPct)}`, sub: 'the achieved mix, including customer collections and operating cash' },
      { label: 'Peak Equity', value: m(re.peakEquity) },
      { label: 'Total Financing Cost', value: m(de.totalFinancingCost) },
      { label: 'Cap Rate at Exit', value: pct(re.capRateAtExit) },
    ], 3);
    // The capital stack the overview's donut draws: debt, cash equity and
    // in-kind equity normalised to their own sum (customer collections excluded).
    const stack = debtPct + cashEquityPct + inKindPct || 1;
    table(['Capital stack', 'Share of sources', 'Share of stack'], [
      ['Debt', pct(debtPct), pct(debtPct / stack)],
      ['Cash equity', pct(cashEquityPct), pct(cashEquityPct / stack)],
      ['In-kind equity', pct(inKindPct), pct(inKindPct / stack)],
    ]);
    const funding = fundingChartPoints(snap);
    if (funding.some((x) => x.value > 0)) {
      ws.getCell(r, L).value = 'Funding requirement by year';
      ws.getCell(r, L).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
      r += 1;
      noteLine(`Net cash this project must raise in each calendar year, ${currency} millions.`);
      // Years across in rows of eight, each year over its amount.
      for (let i = 0; i < funding.length; i += R - L) {
        const chunk = funding.slice(i, i + (R - L));
        const top = r;
        ws.getCell(r, L).value = 'Year'; ws.getCell(r, L).font = { name: 'Calibri', size: 8, bold: true, color: { argb: ARGB.navyDark } }; fillCell(ws.getCell(r, L), ARGB.subtotal);
        ws.getCell(r + 1, L).value = 'Requirement'; ws.getCell(r + 1, L).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
        chunk.forEach((pt, j) => {
          const yc = ws.getCell(r, L + 1 + j); yc.value = String(pt.year); yc.font = { name: 'Calibri', size: 8, bold: true, color: { argb: ARGB.navyDark } }; yc.alignment = { horizontal: 'right' }; fillCell(yc, ARGB.subtotal);
          const vc = ws.getCell(r + 1, L + 1 + j); vc.value = formatAccounting(pt.value, 'millions', 1); vc.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; vc.alignment = { horizontal: 'right' };
        });
        boxBorder(ws, top, L, r + 1, L + chunk.length);
        r += 2;
      }
      r += 1;
    }
  }

  // ── Timeline & structure ──
  band('Timeline & structure');
  tiles([
    { label: 'Start year', value: rs.yearLabels[0] != null ? String(rs.yearLabels[0]) : 'n/a' },
    { label: 'Model horizon', value: `${rs.yearLabels.length} yr`, sub: `to ${rs.exitYearLabel}` },
    { label: 'Phases', value: String(opts.state.phases.length) },
    { label: 'Lines', value: String(ov.scheme.lines), sub: 'consolidated' },
  ], 4);

  // ── Scheme ──
  band('Scheme');
  tiles([
    { label: 'Total land area', value: `${area(ov.scheme.landSqm)} sqm`, sub: m(ov.scheme.landValue) },
    { label: 'Total GFA', value: `${area(ov.scheme.gfaSqm)} sqm`, sub: `BUA ${area(ov.scheme.buaSqm)}` },
    { label: 'Plot ratio', value: ov.scheme.plotRatio == null ? 'n/a' : `${ov.scheme.plotRatio.toFixed(2)}x`, sub: 'GFA / land' },
    { label: 'Saleable and leasable', value: `${area(ov.scheme.saleableSqm)} sqm`, sub: `${area(ov.scheme.units)} units, ${area(ov.scheme.keys)} keys, ${area(ov.scheme.leasableSqm)} sqm let` },
  ], 4);

  // ── Land and build, by asset type ──
  band('Land and build, by asset type');
  table(['Asset type', 'Land (sqm)', 'Share of land', 'GFA (sqm)', 'Units', 'Keys', 'Leasable (sqm)'],
    ov.byType.map((t) => [t.label, area(t.landSqm), pct(t.landPct), area(t.gfaSqm), t.units > 0 ? area(t.units) : '-', t.keys > 0 ? area(t.keys) : '-', t.leasableSqm > 0 ? area(t.leasableSqm) : '-']),
    ['Total', area(ov.scheme.landSqm), '100.0%', area(ov.scheme.gfaSqm), ov.scheme.units > 0 ? area(ov.scheme.units) : '-', ov.scheme.keys > 0 ? area(ov.scheme.keys) : '-', ov.scheme.leasableSqm > 0 ? area(ov.scheme.leasableSqm) : '-']);

  // ── Revenue mix ──
  if (ov.revenueMix.length > 0) {
    band('Revenue mix');
    table(['Section', 'Revenue', 'Share'], ov.revenueMix.map((x) => [x.label, m(x.value), pct(x.pct)]));
  }

  // ── Phases ──
  band('Phases');
  table(['Phase', 'Construction', 'Operations from', 'Lines', 'Land (sqm)', 'GFA (sqm)', 'Capex', 'Revenue', 'EBITDA'],
    ov.phases.map((ph) => [ph.name, `${ph.startYear ?? 'n/a'} to ${ph.constructionEndYear ?? 'n/a'}`, String(ph.operationsStartYear ?? 'n/a'), String(ph.lines), area(ph.landSqm), area(ph.gfaSqm), m(ph.capex), m(ph.revenue), m(ph.ebitda)]));

  // ── Exit and cash ──
  band('Exit and cash');
  tiles([
    { label: 'Exit year', value: String(ov.exit.year), sub: ov.exit.booked ? 'held assets sold' : 'no terminal value' },
    { label: 'Terminal value', value: m(ov.exit.terminalValue), sub: 'proceeds from disposal' },
    { label: 'Gain on disposal', value: m(ov.exit.gainOnDisposal), sub: 'proceeds less book value' },
    { label: 'Peak debt', value: m(ov.exit.peakDebt) },
    { label: 'Cash low point', value: m(ov.exit.cashLow), sub: ov.exit.cashLowYear == null ? '' : `in ${ov.exit.cashLowYear}` },
  ], 4);

  // Footer note (snapshot disclaimer) + brand.
  noteLine('Figures are platform-computed values as of export (hardcoded snapshot). Money figures shown in millions on this page; areas, counts and rates per sqm in full units; see each tab for the full-unit detail. Editing a cell does not recalculate; re-export after changing inputs.');
  r += 1;
  const foot = ws.getCell(r, L); foot.value = 'Financial Modeler Pro  ·  financialmodelerpro.com'; foot.font = { name: 'Calibri', size: 9, color: { argb: ARGB.navyDark } };
}
