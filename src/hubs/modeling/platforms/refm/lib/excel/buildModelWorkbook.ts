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
import { buildSaleCohortTermsBlock, saleCohortRuleText, CASH_PROFILE_SUPERSEDED_LABEL, buildSaleCohortGrid, saleCohortGridCaption } from '../reports/saleCohortReports';
import JSZip from 'jszip';
import { computeFinancialsSnapshot, computeFundingGap, type FinancialsResolverState } from '../financials-resolvers';
import { buildCapexReport, type CapexReport } from '../reports/capexReports';
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
import { resolveAssetAreaMetrics, computePhaseTimeline, computeProjectTimeline, type AssetAreaMetrics } from '@/src/core/calculations';
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
  const refs = addAssumptions(wb, snap, opts, capex);
  addTimeline(wb, snap, refs, opts.state);
  const landAddrs = addLandArea(wb, opts.state, refs);
  const capexAddrs = addCapex(wb, snap, capex, refs, landAddrs);

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
  const seriesByName = (title: string): Map<string, number[]> => {
    const m = new Map<string, number[]>();
    for (const rw of capex.results.find((t) => t.title === title)?.rows ?? []) if (!rw.isTotal) m.set(rw.label, rw.values.slice());
    return m;
  };
  const inclByName = seriesByName('Total Capex (incl. all land)');
  const exclInKindByName = seriesByName('Capex excl. Land In-Kind (cash-impact schedule)');
  const exclAllByName = seriesByName('Capex excl. Total Land (pure development cost)');

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
    const inclPer = padN(inclByName.get(a.name));
    const exclInKindPer = padN(exclInKindByName.get(a.name));
    const exclAllPer = padN(exclAllByName.get(a.name));
    const gdv = m?.totalRevenue ?? 0;
    const subs = state.subUnits.filter((s) => s.assetId === a.id);
    const annualBase = subs.reduce((s, su) => {
      const val = su.metricValue ?? 0; const price = su.startingAdr ?? su.unitPrice ?? 0;
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
  // Net Developable Area (NDA) deduction: roads + parks carved out of gross land
  // before capacity calcs. Project-level here; per-asset values live on the
  // Assets table when the scope is 'asset'.
  addKV('NDA deduction enabled (1 = yes)', p.projectNdaEnabled ? 1 : 0, NUMFMT.int);
  addKV('NDA scope (project / asset)', String(p.projectNdaScope ?? 'project'), '@');
  addKV('Project roads % (of total land)', (p.projectRoadsPct ?? 0) / 100, NUMFMT.pct);
  addKV('Project parks % (of total land)', (p.projectParksPct ?? 0) / 100, NUMFMT.pct);
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
    ['Parcel', 'Area (sqm)', 'Rate /sqm', 'Cash %', 'In-kind %', 'Roads %', 'Parks %', 'Debt %', 'Equity %'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
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
      setInput(ws.getCell(`F${r}`), (pa.roadsPct ?? 0) / 100, NUMFMT.pct);
      setInput(ws.getCell(`G${r}`), (pa.parksPct ?? 0) / 100, NUMFMT.pct);
      const pf = parcelFunding.find((x) => x.parcelId === pa.id);
      const pDebt = pf?.debtPct ?? 0;
      setInput(ws.getCell(`H${r}`), pDebt / 100, NUMFMT.pct);
      setInput(ws.getCell(`I${r}`), (pf?.equityPct ?? (100 - pDebt)) / 100, NUMFMT.pct);
      parcelRefs.push({ id: pa.id, area: addr('B', r), rate: addr('C', r), cashPct: addr('D', r), inKindPct: addr('E', r) });
      r += 1;
    }
    r += 1;
  }

  // Assets (area schedule + depreciation).
  const visibleAssets = opts.state.assets.filter((a) => a.visible !== false);
  if (visibleAssets.length) {
    setSectionHeader(ws.getRow(r), 'Assets', 14); r += 1;
    ['Asset', 'Strategy', 'BUA (sqm)', 'NSA (sqm)', 'GFA (sqm)', 'Support (sqm)', 'Parking (sqm)', 'Parking bays', 'Land (sqm)', 'Land rate /sqm', 'Useful life (yrs)', 'Roads % (asset)', 'Parks % (asset)', 'NDA on (asset)'].forEach((h, i) => setColHeader(ws.getCell(r, i + 1), h, i === 0 ? 'left' : 'right'));
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
      // Per-asset NDA deduction (consumed when project NDA scope = 'asset').
      setInput(ws.getCell(`L${r}`), (a.assetRoadsPct ?? 0) / 100, NUMFMT.pct);
      setInput(ws.getCell(`M${r}`), (a.assetParksPct ?? 0) / 100, NUMFMT.pct);
      setInput(ws.getCell(`N${r}`), a.assetNdaEnabled ? 1 : 0, NUMFMT.int);
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
      setInput(ws.getCell(`G${r}`), u.startingAdr ?? u.unitPrice ?? 0, NUMFMT.rate); // price / ADR per unit, unscaled
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
  addKV('Exit multiple (x stabilised NOI)', cfg?.exitMultiple ?? 8, NUMFMT.mult, 'ExitMultiple');
  addKV('Perpetuity growth', cfg?.perpetuityGrowth ?? 0.02, NUMFMT.pct, 'PerpetuityGrowth');
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
  for (const a of visibleAssets) {
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
    const cashPct = s.cashPaymentProfile?.percentages ?? [];
    const recogPct = s.recognitionProfile?.percentages ?? [];
    let n = 0; for (let i = 0; i < Math.max(cashPct.length, recogPct.length); i++) if ((cashPct[i] ?? 0) !== 0 || (recogPct[i] ?? 0) !== 0) n = i + 1;
    if (!n) continue;
    setSectionHeader(ws.getRow(r), `Cash & recognition profile, ${a.name} (% by year from sale)`, n + 1); r += 1;
    setColHeader(ws.getCell(r, 1), 'Profile', 'left'); for (let i = 0; i < n; i++) setColHeader(ws.getCell(r, 2 + i), `Yr ${i + 1}`, 'right'); r += 1;
    setLabel(ws.getCell(`A${r}`), CASH_PROFILE_SUPERSEDED_LABEL); for (let i = 0; i < n; i++) setInput(ws.getCell(r, 2 + i), cashPct[i] ?? 0, NUMFMT.pct); r += 1;
    if (recogPct.length) { setLabel(ws.getCell(`A${r}`), 'Recognition %'); for (let i = 0; i < n; i++) setInput(ws.getCell(r, 2 + i), recogPct[i] ?? 0, NUMFMT.pct); r += 1; }
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
  for (const a of visibleAssets) {
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
    refs.capex.filter((a) => a.lines.some((l) => /revenue/.test(l.method))).map((a) => a.assetId),
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
  const seriesByName = (title: string): Map<string, number[]> => {
    const m = new Map<string, number[]>();
    for (const rw of capex.results.find((t) => t.title === title)?.rows ?? []) if (!rw.isTotal) m.set(rw.label, rw.values.slice());
    return m;
  };
  const inclByName = seriesByName('Total Capex (incl. all land)');
  const exclInKindByName = seriesByName('Capex excl. Land In-Kind (cash-impact schedule)');
  const exclAllByName = seriesByName('Capex excl. Total Land (pure development cost)');
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
    const m = inclByName.get(a.name) ?? inclYear;
    assetMeta.push({
      assetId: a.assetId, name: a.name, category: cat(a.assetId), inclRow, landRows, nonLandRows,
      exclAll: exclAllByName.get(a.name) ?? exclYear, exclInKind: exclInKindByName.get(a.name) ?? exclYear, incl: m,
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
      const lnd = landAddrs.get(refs.capex.find((a) => a.name === m.name)?.assetId ?? '');
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
function makeEmitters(ws: ExcelJS.Worksheet, N: number, start = 5): {
  section: (text: string) => void; groupBand: (text: string) => void; subTitle: (text: string) => void;
  moneyRow: (label: string, series: number[] | undefined, opts?: { style?: RowStyle; indent?: number; basis?: string; prior?: number; totalLast?: boolean; totalValue?: number; noTotal?: boolean }) => number;
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
  const moneyRow = (label: string, series: number[] | undefined, opts: { style?: RowStyle; indent?: number; basis?: string; prior?: number; totalLast?: boolean; totalValue?: number; noTotal?: boolean } = {}): number => {
    const used = r;
    const style = opts.style ?? 'plain';
    setLabel(ws.getCell(r, LBL_COL), label, { indent: opts.indent, bold: style !== 'plain' });
    if (opts.basis) setBasis(ws.getCell(r, META_B), opts.basis);
    const vals = (series ?? []).slice(0, N);
    const put = (c: number, v: number): void => { const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
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
    const style: RowStyle = row.isTotal ? 'total' : row.isSubtotal ? 'subtotal' : 'plain';
    const tv = row.totalOverride !== undefined ? Number(row.totalOverride) : undefined;
    return moneyRow(row.label, row.values, { style, indent: row.indent, prior: row.priorValue, totalValue: tv !== undefined && Number.isFinite(tv) ? tv : undefined });
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
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;
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
      rows.push({ label: 'Closing AR by asset', values: [], isSection: true });
      for (const [assetId, bundle] of sellEntries) rows.push({ label: assetName(assetId), values: bundle.ar.perPeriod.slice(0, N), indent: 1, totalOverride: fmt(bundle.ar.perPeriod[N - 1] ?? 0) });
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
      rows.push({ label: 'Closing unearned revenue by asset', values: [], isSection: true });
      for (const [assetId, bundle] of sellEntries) rows.push({ label: assetName(assetId), values: bundle.unearned.perPeriod.slice(0, N), indent: 1, totalOverride: fmt(bundle.unearned.perPeriod[N - 1] ?? 0) });
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

// ── Revenue (full mirror of the platform Module 2: all 5 sub-tabs in sequence) ─
// One sheet reproducing every Module 2 surface as a divided section, the same
// way the Financing tab mirrors Module 1's four financing sub-tabs: 1. Inputs,
// 2. Output, 3. Cost of Sales, 4. Schedules, 5. Escrow. Every figure is the
// platform snapshot value (hardcoded). Returns the Revenue + Cost-of-Sales row
// registries the downstream tabs link to.
function addRevenue(ctx: EmitCtx): { revLinks: RevLinks; cosLinks: CosLinks } {
  const { wb, snap, state } = ctx;
  const N = snap.axisLength;
  const yl = snap.yearLabels;
  const ws = wb.addWorksheet(SHEETS.revenue, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Revenue', 'Full step-by-step mirror of the platform Revenue module, all five sub-tabs in sequence: 1. Inputs (revenue config + cash / recognition profiles), 2. Output (per-asset narrative + vintage matrices), 3. Cost of Sales, 4. Schedules (AR + unearned), 5. Escrow.', { label: 'Line', feeds: 'Sourced from Inputs (sub-unit prices / areas, recognition + cash profiles) and the platform revenue engine. Feeds P&L, the Balance Sheet (inventory, AR, unearned) and Returns.' });
  let r = 5;
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;
  const A = (a: number[] | undefined): number[] => (a ?? []).slice(0, N);
  const anyNonZero = (a: number[] | undefined): boolean => (a ?? []).some((v) => (v ?? 0) !== 0);
  const metricOf = (units: Array<{ metric: 'units' | 'area' }>): 'units' | 'area' => (units.length && units.every((u) => u.metric === units[0].metric) ? units[0].metric : 'area');
  const idxLabel = (ix?: { method?: string; rate?: number }): string => {
    if (!ix || !ix.method || ix.method === 'none') return 'None';
    const m = ix.method === 'single_rate' ? 'Flat' : ix.method === 'yoy_compound' ? 'Compound' : ix.method === 'yoy_per_period' ? 'Per-Year' : ix.method === 'step' ? 'Step' : ix.method;
    return ix.rate != null ? `${m} ${(ix.rate * 100).toFixed(1)}%` : m;
  };

  // ── local emit helpers (mirror the Financing tab) ──
  const section = (text: string): void => { setSectionHeader(ws.getRow(r), text, lastActiveCol(N), ARGB.accent); r += 1; };
  const subTitle = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.subtotal);
    for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    r += 1;
  };
  type RowStyle = 'plain' | 'subtotal' | 'total';
  // One money row from a snapshot array. style: plain / subtotal (grey-bold) /
  // total (navy band). totalLast => Total = last value (balances); noTotal =>
  // no Total cell (opening rows). Returns the row used.
  const moneyRow = (label: string, series: number[] | undefined, opts: { style?: RowStyle; indent?: number; basis?: string; prior?: number; totalLast?: boolean; noTotal?: boolean } = {}): number => {
    const used = r;
    const style = opts.style ?? 'plain';
    setLabel(ws.getCell(r, LBL_COL), label, { indent: opts.indent, bold: style !== 'plain' });
    if (opts.basis) setBasis(ws.getCell(r, META_B), opts.basis);
    const vals = A(series);
    const put = (c: number, v: number): void => { const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
    put(OPEN_COL, opts.prior ?? 0);
    for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    if (!opts.noTotal) put(TOTAL_COL, opts.totalLast ? (vals[N - 1] ?? 0) : vals.reduce((s, v) => s + (v ?? 0), 0) + (opts.prior ?? 0));
    if (style === 'total') { fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.navy); for (let c = 1; c <= lastActiveCol(N); c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white }, italic: c === META_B }; } }
    else if (style === 'subtotal') { for (let c = 1; c <= lastActiveCol(N); c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark }, italic: c === META_B }; } }
    r += 1;
    return used;
  };
  // A non-money statistic row (units / sqm / occupancy / ADR), custom format, no Total.
  const statRow = (label: string, series: number[] | undefined, numFmt: string): void => {
    setLabel(ws.getCell(r, LBL_COL), label, { indent: 1 });
    const vals = A(series);
    for (let t = 0; t < N; t++) { const cell = ws.getCell(r, pcol(t)); cell.value = vals[t] ?? 0; cell.numFmt = numFmt; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; }
    r += 1;
  };
  // An M4Row from a shared report builder (Cost of Sales). Returns the row used.
  const emitM4 = (row: M4Row): number => {
    if (row.isSection) { subTitle(row.label); return r - 1; }
    const style: RowStyle = row.isTotal ? 'total' : row.isSubtotal ? 'subtotal' : 'plain';
    return moneyRow(row.label, row.values, { style, indent: row.indent, prior: row.priorValue, totalLast: row.totalOverride !== undefined });
  };
  // A vintage matrix (cohort-year rows + a column-sum Total), non-zero cohorts only.
  const vintage = (title: string, matrix: number[][]): void => {
    const rows = matrix.map((m, i) => ({ label: `FY ${yl[i] ?? i}`, vals: A(m) })).filter((rr) => anyNonZero(rr.vals));
    if (!rows.length) return;
    subTitle(title);
    for (const rr of rows) moneyRow(rr.label, rr.vals, { indent: 1 });
    const totals = new Array<number>(N).fill(0);
    for (const m of matrix) for (let i = 0; i < N; i++) totals[i] += m[i] ?? 0;
    moneyRow('Total', totals, { style: 'total' });
    r += 1;
  };

  // ── 1. Revenue Inputs ────────────────────────────────────────────────────────
  section('1. Revenue Inputs (raw inputs are on the Inputs tab under REVENUE INPUTS; echoed here)');
  subTitle('Revenue Configuration by Asset');
  ['Asset', '', '', 'Strategy', 'Key driver', 'Indexation'].forEach((h, i) => { if (h) setColHeader(ws.getCell(r, i === 0 ? LBL_COL : OPEN_COL + (i - 3)), h, i === 0 ? 'left' : 'left'); });
  r += 1;
  for (const a of state.assets.filter((x) => x.visible !== false)) {
    const rc = a.revenue ?? {};
    let strategy = a.strategy; let driver = ''; let indexation = '';
    if (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') {
      const s = rc.sell;
      const recog = s?.recognitionProfile?.method === 'point_in_time' ? `PIT (${s?.recognitionProfile?.pointInTimeYear ?? 'handover'})` : 'Over time';
      driver = `Recognition: ${recog}`; indexation = idxLabel(s?.indexation);
    } else if (a.strategy === 'Operate') { driver = `Starting ADR ${Math.round(rc.operate?.startingADR ?? 0)}`; indexation = idxLabel(rc.operate?.adrIndexation); }
    else { strategy = 'Lease'; driver = `Base rate ${Math.round(rc.lease?.baseRate ?? 0)}`; indexation = idxLabel(rc.lease?.rentIndexation); }
    setLabel(ws.getCell(r, LBL_COL), a.name, { indent: 1 });
    setLabel(ws.getCell(r, OPEN_COL), strategy); setLabel(ws.getCell(r, OPEN_COL + 1), driver); setLabel(ws.getCell(r, OPEN_COL + 2), indexation);
    r += 1;
  }
  r += 1;
  // Per-asset cash + recognition profiles (relative to the sale year: the first
  // period column is Year 1 from sale, not the absolute axis year).
  for (const a of state.assets) {
    const s = a.revenue?.sell; if (!s) continue;
    const cashPct = s.cashPaymentProfile?.percentages ?? [];
    const recogPct = s.recognitionProfile?.percentages ?? [];
    if (!anyNonZero(cashPct) && !anyNonZero(recogPct)) continue;
    subTitle(`Cash & Recognition Profile, ${a.name} (% relative to sale year; first period column = Year 1)`);
    statRow(CASH_PROFILE_SUPERSEDED_LABEL, cashPct.map((v) => v ?? 0), NUMFMT.pct);
    if (recogPct.length) statRow('Recognition %', recogPct.map((v) => v ?? 0), NUMFMT.pct);
    r += 1;
  }

  // ── 2. Revenue Output ────────────────────────────────────────────────────────
  section('2. Revenue Output (project summary, then per-asset narrative + vintage matrices)');
  const pl = snap.pl;
  subTitle('Project Revenue Summary');
  const residentialRow = moneyRow('Residential revenue', pl.residentialRevenuePerPeriod, { style: 'subtotal', basis: 'Sum of Residential / Sell recognised revenue' });
  const hospitalityRow = moneyRow('Hospitality revenue', pl.hospitalityRevenuePerPeriod, { style: 'subtotal', basis: 'Sum of Hospitality / Operate revenue' });
  const retailRow = moneyRow('Retail revenue', pl.retailRevenuePerPeriod, { style: 'subtotal', basis: 'Sum of Retail / Lease revenue' });
  const totalRow = moneyRow('Total revenue', pl.totalRevenuePerPeriod, { style: 'total', basis: 'Residential + Hospitality + Retail' });
  r += 1;
  const byAssetRow = new Map<string, number>();
  for (const [id, rr] of snap.revenue.bySellAsset) {
    if (!anyNonZero(rr.presalesRevenuePerPeriod) && !anyNonZero(rr.postSalesRevenuePerPeriod)) continue;
    const totalSaleValue = A(rr.presalesRevenuePerPeriod).map((v, i) => v + (rr.postSalesRevenuePerPeriod[i] ?? 0));
    const useUnits = metricOf(state.subUnits.filter((u) => u.assetId === id)) === 'units';
    const preVol = useUnits ? rr.presalesUnitsPerPeriod : rr.presalesAreaPerPeriod;
    const postVol = useUnits ? rr.postSalesUnitsPerPeriod : rr.postSalesAreaPerPeriod;
    const volSuffix = useUnits ? 'units' : 'sqm';
    subTitle(`Residential (Sell), ${assetName(id)}`);
    statRow(`Pre-sales ${volSuffix}`, preVol, NUMFMT.int);
    statRow(`Post-sales ${volSuffix}`, postVol, NUMFMT.int);
    moneyRow('Pre-sales revenue (sale value)', rr.presalesRevenuePerPeriod, { indent: 1 });
    moneyRow('Post-sales revenue (sale value)', rr.postSalesRevenuePerPeriod, { indent: 1 });
    moneyRow('Total sale value', totalSaleValue, { style: 'subtotal' });
    moneyRow('Pre-sales cash collected', rr.presalesCashPerPeriod, { indent: 1 });
    moneyRow('Post-sales cash collected', rr.postSalesCashPerPeriod, { indent: 1 });
    moneyRow('Total cash collected', rr.cashCollectedPerPeriod, { style: 'subtotal' });
    moneyRow('Pre-sales recognised', rr.presalesRecognitionPerPeriod, { indent: 1 });
    moneyRow('Post-sales recognised', rr.postSalesRecognitionPerPeriod, { indent: 1 });
    byAssetRow.set(id, moneyRow('Total revenue recognised', rr.recognitionPerPeriod, { style: 'total' }));
    r += 1;
    // THE SALE COHORT GRID (2026-08-20, restructure Step 4), from the SHARED
    // builder the Module 2 screen and both PDFs also render, so the row set and
    // the check cannot drift. Falls back to the plain vintage matrix only when
    // the builder has nothing to say (no sell config resolved).
    {
      const ca = state.assets.find((x) => x.id === id);
      const grid = ca
        ? buildSaleCohortGrid(ca, state.phases.find((ph) => ph.id === ca.phaseId),
          Number(yl[0]) || 0, yl, state.project.saleCohortDefaults?.downpayment, rr)
        : null;
      if (grid && grid.rows.length) {
        subTitle(`Sale Cohort Grid, ${assetName(id)} (handover ${grid.handoverYear})`);
        for (const cr of grid.rows) {
          moneyRow(
            cr.paysInFull
              ? `${cr.saleYear} sale, paid in full`
              : `${cr.saleYear} sale, ${(cr.downpayment * 100).toFixed(2)}% down`,
            A(cr.cells), { indent: 1 },
          );
        }
        moneyRow('Total collected', A(grid.columnTotals), { style: 'total' });
        r += 1;
        // The check, as its own small block: the period grid has one Total
        // column and cannot carry a per-row sale value beside it.
        subTitle(`Sale Cohort Grid check, ${assetName(id)}`);
        setColHeader(ws.getCell(r, 1), 'Sale year', 'left');
        setColHeader(ws.getCell(r, 2), 'Down %', 'right');
        setColHeader(ws.getCell(r, 3), 'In force from', 'left');
        setColHeader(ws.getCell(r, 4), 'Sale value', 'right');
        setColHeader(ws.getCell(r, 5), 'Collected', 'right');
        setColHeader(ws.getCell(r, 6), 'Check', 'right');
        r += 1;
        for (const cr of grid.rows) {
          setLabel(ws.getCell(`A${r}`), String(cr.saleYear));
          const dp = ws.getCell(r, 2); dp.value = cr.paysInFull ? 1 : cr.downpayment; dp.numFmt = NUMFMT.pct;
          setLabel(ws.getCell(r, 3), cr.paysInFull ? 'not used' : cr.downpaymentSource.replace('_', ' '));
          const gv = ws.getCell(r, 4); gv.value = cr.gdv; gv.numFmt = NUMFMT.money;
          const cv = ws.getCell(r, 5); cv.value = cr.rowTotal; cv.numFmt = NUMFMT.money;
          const ck = ws.getCell(r, 6); ck.value = cr.checkResidue; ck.numFmt = NUMFMT.money;
          ck.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: cr.ok ? ARGB.good : ARGB.bad } };
          r += 1;
        }
        setLabel(ws.getCell(`A${r}`), saleCohortGridCaption(grid));
        r += 2;
      } else {
        vintage(`Cash Vintage Matrix, ${assetName(id)}`, rr.cashVintageMatrix);
      }
    }
    vintage(`Recognition Vintage Matrix, ${assetName(id)}`, rr.recognitionVintageMatrix);
  }
  for (const [id, rr] of snap.revenue.byHospitalityAsset) {
    if (!anyNonZero(rr.totalRevenuePerPeriod)) continue;
    subTitle(`Hospitality, ${assetName(id)}`);
    statRow('Available room nights', rr.availableRoomNightsPerPeriod, NUMFMT.int);
    statRow('Occupied room nights', rr.occupiedRoomNightsPerPeriod, NUMFMT.int);
    statRow('Occupancy %', rr.occupancyPerPeriod, NUMFMT.pct);
    statRow('ADR', rr.adrPerPeriod, NUMFMT.rate);
    moneyRow('Rooms revenue', rr.roomsRevenuePerPeriod, { indent: 1 });
    moneyRow('F&B revenue', rr.fbRevenuePerPeriod, { indent: 1 });
    moneyRow('Other revenue', rr.otherRevenuePerPeriod, { indent: 1 });
    moneyRow('Total revenue', rr.totalRevenuePerPeriod, { style: 'total' });
    r += 1;
  }
  for (const [id, rr] of snap.revenue.byLeaseAsset) {
    if (!anyNonZero(rr.totalRevenuePerPeriod)) continue;
    subTitle(`Lease, ${assetName(id)}`);
    statRow('Occupied area (sqm)', rr.occupiedAreaPerPeriod, NUMFMT.int);
    statRow('Occupancy %', rr.occupancyPerPeriod, NUMFMT.pct);
    statRow('Indexed rate', rr.indexedRatePerPeriod, NUMFMT.rate);
    moneyRow('Total revenue', rr.totalRevenuePerPeriod, { style: 'total' });
    r += 1;
  }

  // ── 3. Cost of Sales ─────────────────────────────────────────────────────────
  section('3. Cost of Sales (per-asset capex driver, vintage matrix, summary, inventory roll-forward, project totals)');
  const cosByAssetRow = new Map<string, number>();
  let cosTotalRow = r;
  for (const t of buildCostOfSalesReport(snap, state, (v) => String(v))) {
    subTitle(t.title);
    for (const row of t.rows) { const used = emitM4(row); if (t.title === 'Project Total Cost of Sales' && row.isTotal) cosTotalRow = used; }
    r += 1;
  }

  // ── 4. Schedules (Accounts Receivable + Unearned revenue roll-forward) ───────
  section('4. Schedules (Accounts Receivable + Unearned revenue roll-forward, per asset)');
  for (const [id, b] of snap.byAssetSchedules) {
    if (!anyNonZero(b.ar.perPeriod) && !anyNonZero(b.unearned.perPeriod)) continue;
    // FULL ROLL-FORWARDS from the shared builders (2026-08-20, Step 5). This
    // used to print opening / change / closing only, which is a balance moving
    // with no statement of why, and no check row.
    {
      const sr = snap.revenue.bySellAsset.get(id);
      const tables = [
        buildReceivablesRollForward(b.ar, sr?.presalesRevenuePerPeriod ?? [], sr?.presalesCashPerPeriod ?? [], N, b.ar.changePerPeriod),
        buildUnearnedRollForward(b.unearned, sr?.presalesRevenuePerPeriod ?? [], sr?.presalesRecognitionPerPeriod ?? [], N, b.unearned.changePerPeriod),
      ];
      for (const t of tables) {
        subTitle(`${t.title}, ${assetName(id)}`);
        for (const rw of t.rows) {
          moneyRow(rw.label, A(rw.values), {
            indent: rw.isTotal ? 0 : 1,
            style: rw.isTotal ? 'subtotal' : undefined,
            totalLast: rw.totalIsBalance === true,
            noTotal: rw.totalIsBalance === true && !rw.isTotal && rw.label.startsWith('Opening'),
          });
        }
        setLabel(ws.getCell(`A${r}`), t.caption);
        r += 2;
      }
    }
  }

  // ── 5. Escrow (only when pre-sales escrow is active) ─────────────────────────
  const esc = snap.escrow.projectTotals;
  if (anyNonZero(esc.heldPerPeriod) || anyNonZero(esc.releasePerPeriod)) {
    section('5. Escrow (pre-sales cash subject to escrow, balance roll-forward, cash flow impact)');
    const escAssets = [...snap.escrow.byAsset.entries()].filter(([, a]) => anyNonZero(a.preSalesCashPerPeriod));
    subTitle('A. Pre-Sales Cash by Asset (subject to escrow)');
    for (const [id, a] of escAssets) moneyRow(assetName(id), a.preSalesCashPerPeriod, { indent: 1 });
    moneyRow('Total Pre-Sales Cash (all assets)', esc.preSalesCashPerPeriod, { style: 'total' });
    r += 1;
    subTitle('B. Escrow Balance Roll-Forward');
    const opening = new Array<number>(N).fill(0);
    for (let t = 1; t < N; t++) opening[t] = esc.cumulativeBalancePerPeriod[t - 1] ?? 0;
    moneyRow('Opening Balance', opening, { style: 'subtotal', noTotal: true });
    setLabel(ws.getCell(r, LBL_COL), 'Additions:', { bold: true }); r += 1;
    for (const [id, a] of escAssets) moneyRow(assetName(id), a.result.heldPerPeriod, { indent: 2 });
    moneyRow('Total Additions', esc.heldPerPeriod, { style: 'subtotal' });
    moneyRow('Less: Release of Locked Funds', A(esc.releasePerPeriod).map((v) => -v), { indent: 1 });
    moneyRow('Closing Balance', esc.cumulativeBalancePerPeriod, { style: 'total', totalLast: true });
    r += 1;
    subTitle('C. Cash Flow Impact (project totals)');
    moneyRow('Less: Inaccessible Funds Locked', A(esc.heldPerPeriod).map((v) => -v), { indent: 1 });
    moneyRow('Add: Release of Inaccessible Funds', esc.releasePerPeriod, { indent: 1 });
    moneyRow('Net Cash Flow Adjustment (to M4)', esc.cashFlowAdjustmentPerPeriod, { style: 'total' });
  }

  return {
    revLinks: { byAssetRow, residentialRow, hospitalityRow, retailRow, totalRow },
    cosLinks: { byAssetRow: cosByAssetRow, totalRow: cosTotalRow },
  };
}

// ── Opex (full mirror of the platform Module 3: all 3 sub-tabs in sequence) ───
// One sheet reproducing every Module 3 surface as a divided section, the same
// way Revenue mirrors Module 2: 1. Inputs (per-asset + HQ opex lines), 2. Output
// (revenue breakdown + per-category cost tables + project rollup, via the shared
// buildOpexReport), 3. Schedules (accounts payable roll-forward). Every figure is
// the platform snapshot value (hardcoded). Returns the Opex row registry.
function addOpex(ctx: EmitCtx): OpexLinks {
  const { wb, snap, state } = ctx;
  const N = snap.axisLength;
  const ws = wb.addWorksheet(SHEETS.opex, { properties: { tabColor: { argb: ARGB.navy } } });
  writeSheetHeader(ws, snap, N, 'Operating Expenses', 'Full step-by-step mirror of the platform Opex module, all three sub-tabs in sequence: 1. Inputs (per-asset + HQ opex lines), 2. Output (revenue breakdown + per-category cost tables + project rollup), 3. Schedules (accounts payable roll-forward).', { label: 'Line', feeds: 'Sourced from Inputs (opex lines) and Revenue (operating revenue). Feeds P&L, Cash Flow (opex paid) and the Returns NOI.' });
  let r = 5;
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;
  const anyNonZero = (a: number[] | undefined): boolean => (a ?? []).some((v) => (v ?? 0) !== 0);
  const idxLabel = (ix?: { method?: string; rate?: number }): string => {
    if (!ix || !ix.method || ix.method === 'none') return 'None';
    const m = ix.method === 'single_rate' ? 'Flat' : ix.method === 'yoy_compound' ? 'Compound' : ix.method === 'yoy_per_period' ? 'Per-Year' : ix.method === 'step' ? 'Step' : ix.method;
    return ix.rate != null ? `${m} ${(ix.rate * 100).toFixed(1)}%` : m;
  };

  // ── local emit helpers (mirror the Revenue / Financing tabs) ──
  const section = (text: string): void => { setSectionHeader(ws.getRow(r), text, lastActiveCol(N), ARGB.accent); r += 1; };
  const subTitle = (text: string): void => {
    setLabel(ws.getCell(r, LBL_COL), text, { bold: true });
    fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.subtotal);
    for (let c = 1; c <= lastActiveCol(N); c++) ws.getCell(r, c).font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark } };
    r += 1;
  };
  type RowStyle = 'plain' | 'subtotal' | 'total';
  const moneyRow = (label: string, series: number[] | undefined, opts: { style?: RowStyle; indent?: number; basis?: string; prior?: number; totalLast?: boolean; noTotal?: boolean } = {}): number => {
    const used = r;
    const style = opts.style ?? 'plain';
    setLabel(ws.getCell(r, LBL_COL), label, { indent: opts.indent, bold: style !== 'plain' });
    if (opts.basis) setBasis(ws.getCell(r, META_B), opts.basis);
    const vals = (series ?? []).slice(0, N);
    const put = (c: number, v: number): void => { const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = NUMFMT.money; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };
    put(OPEN_COL, opts.prior ?? 0);
    for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    if (!opts.noTotal) put(TOTAL_COL, opts.totalLast ? (vals[N - 1] ?? 0) : vals.reduce((s, v) => s + (v ?? 0), 0) + (opts.prior ?? 0));
    if (style === 'total') { fillRange(ws, r, 1, r, lastActiveCol(N), ARGB.navy); for (let c = 1; c <= lastActiveCol(N); c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.white }, italic: c === META_B }; } }
    else if (style === 'subtotal') { for (let c = 1; c <= lastActiveCol(N); c++) { const cell = ws.getCell(r, c); cell.font = { name: 'Calibri', size: BODY_SIZE, bold: true, color: { argb: ARGB.navyDark }, italic: c === META_B }; } }
    r += 1;
    return used;
  };
  const emitM4 = (row: M4Row): number => {
    if (row.isSection) { subTitle(row.label); return r - 1; }
    const style: RowStyle = row.isTotal ? 'total' : row.isSubtotal ? 'subtotal' : 'plain';
    return moneyRow(row.label, row.values, { style, indent: row.indent, prior: row.priorValue, totalLast: row.totalOverride !== undefined });
  };
  // A read-only text/value cell on the inputs grid (black, not an editable cell).
  const txt = (c: number, v: string | number, numFmt = '@'): void => { const cell = ws.getCell(r, c); cell.value = v; cell.numFmt = numFmt; cell.font = { name: 'Calibri', size: BODY_SIZE, color: { argb: ARGB.formula } }; };

  // ── 1. Opex Inputs ───────────────────────────────────────────────────────────
  section('1. Opex Inputs (raw inputs are on the Inputs tab under OPEX INPUTS; echoed here)');
  const valueFmt = (mode: string): string => mode === 'fixed_baseline' ? NUMFMT.money : mode.startsWith('per_') ? NUMFMT.rate : NUMFMT.pct;
  for (const a of state.assets) {
    const lines = (a.opex?.lines ?? []).filter((l) => !l.disabled);
    if (!lines.length) continue;
    subTitle(`Opex Inputs, ${a.name}`);
    ['Line', '', '', 'Category', 'Mode', 'Value', 'Indexation', 'Rate mode'].forEach((h, i) => { if (h) setColHeader(ws.getCell(r, i === 0 ? LBL_COL : OPEN_COL + (i - 3)), h, 'left'); });
    r += 1;
    for (const l of lines) {
      setLabel(ws.getCell(r, LBL_COL), l.name, { indent: 1 });
      txt(OPEN_COL, String(l.category)); txt(OPEN_COL + 1, String(l.mode));
      txt(OPEN_COL + 2, l.value, valueFmt(String(l.mode)));
      txt(OPEN_COL + 3, l.useAssetDefault ? `(default) ${idxLabel(a.opex?.defaultIndexation)}` : idxLabel(l.indexation));
      txt(OPEN_COL + 4, l.rateMode === 'yoy' ? 'YoY' : 'Single');
      r += 1;
    }
    r += 1;
  }
  const hqLines = (state.project.hqOpex?.lines ?? []).filter((l) => !l.disabled);
  if (hqLines.length) {
    subTitle('HQ / Corporate Opex Inputs');
    ['Line', '', '', 'Category', 'Mode', 'Value', 'Indexation'].forEach((h, i) => { if (h) setColHeader(ws.getCell(r, i === 0 ? LBL_COL : OPEN_COL + (i - 3)), h, 'left'); });
    r += 1;
    for (const l of hqLines) {
      setLabel(ws.getCell(r, LBL_COL), l.name, { indent: 1 });
      txt(OPEN_COL, String(l.category)); txt(OPEN_COL + 1, String(l.mode));
      txt(OPEN_COL + 2, l.value, valueFmt(String(l.mode)));
      txt(OPEN_COL + 3, idxLabel(l.indexation));
      r += 1;
    }
    r += 1;
  }

  // ── 2. Opex Output ───────────────────────────────────────────────────────────
  section('2. Opex Output (per-asset revenue breakdown + cost categories, then project rollup)');
  let totalRow = r; let hqRow = -1;
  for (const t of buildOpexReport(snap, state)) {
    subTitle(t.title);
    for (const row of t.rows) {
      const used = emitM4(row);
      if (t.title === 'Project Total Opex') { if (row.isTotal) totalRow = used; else if (row.label === 'HQ overheads') hqRow = used; }
    }
    r += 1;
  }
  // hospRow / retailRow have no per-strategy rollup row in the platform Output;
  // they feed only discarded static-mode formula strings (the Returns NOI value
  // is the snapshot constant), so they point at the project total.
  const hospRow = totalRow; const retailRow = totalRow;

  // ── 3. Schedules (Accounts Payable roll-forward) ─────────────────────────────
  section('3. Schedules (Accounts Payable roll-forward, per asset + project total)');
  for (const [id, apr] of snap.ap.byAsset) {
    if (!anyNonZero(apr.opexIncurredPerPeriod)) continue;
    subTitle(`Accounts Payable, ${assetName(id)} (DPO ${apr.effectiveApDays})`);
    moneyRow('Opex incurred', apr.opexIncurredPerPeriod, { indent: 1 });
    moneyRow('Opening AP', apr.result.openingPerPeriod, { indent: 1, noTotal: true });
    moneyRow('Closing AP', apr.result.perPeriod, { style: 'subtotal', totalLast: true });
    moneyRow('Cash paid', apr.result.cashPaidPerPeriod, { indent: 1 });
    r += 1;
  }
  const apt = snap.ap.projectTotals;
  subTitle('Accounts Payable (project total)');
  moneyRow('Opex incurred', apt.opexIncurredPerPeriod, { indent: 1 });
  moneyRow('Opening AP', apt.openingApPerPeriod, { indent: 1, noTotal: true });
  moneyRow('Change in AP', apt.changeApPerPeriod, { indent: 1 });
  moneyRow('Closing AP', apt.closingApPerPeriod, { style: 'subtotal', totalLast: true });
  moneyRow('Cash paid', apt.cashPaidPerPeriod, { style: 'total' });

  return { hospRow, retailRow, hqRow, totalRow };
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
  const emitM4 = (row: M4Row, basis: string, opts: { stateRow?: boolean } = {}): void => {
    const isBalance = row.totalOverride !== undefined || opts.stateRow === true;
    const strong = !!(row.isTotal || row.isSubtotal);
    setLabel(ws.getCell(r, LBL_COL), row.label, { indent: row.indent, bold: strong });
    if (basis) setBasis(ws.getCell(r, META_B), basis);
    const vals = row.values ?? [];
    const put = (c: number, v: number): void => constCell(ws.getCell(r, c), v, NUMFMT.money);
    put(OPEN_COL, row.priorValue ?? 0);
    for (let t = 0; t < N; t++) put(pcol(t), vals[t] ?? 0);
    const total = isBalance ? (vals[N - 1] ?? 0) : vals.reduce((s, v) => s + (v ?? 0), 0) + (row.priorValue ?? 0);
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
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;
  const nz = (a?: number[]): boolean => (a ?? []).some((v) => (v ?? 0) !== 0);

  // ── 1. Fixed Assets & D&A ────────────────────────────────────────────────────
  E.section('1. Fixed Assets & D&A (land + depreciable NBV roll-forward, per asset + project total)');
  const fa = snap.fixedAssets;
  for (const [id, ra] of fa.byAsset) {
    const dep = ra.depreciable;
    if (!nz(dep.closingNBVPerPeriod) && !nz(ra.land.closingPerPeriod)) continue;
    E.subTitle(`Fixed Assets, ${assetName(id)}`);
    E.moneyRow('Land opening', ra.land.openingPerPeriod, { indent: 1, prior: ra.land.openingAtAxisStart, noTotal: true });
    E.moneyRow('Land additions', ra.land.additionsPerPeriod, { indent: 1 });
    E.moneyRow('Land closing', ra.land.closingPerPeriod, { style: 'subtotal', totalLast: true });
    E.moneyRow('Depreciable opening NBV', dep.openingNBVPerPeriod, { indent: 1, noTotal: true });
    E.moneyRow('Additions', dep.additionsPerPeriod, { indent: 1 });
    E.moneyRow('Depreciation', dep.depreciationPerPeriod, { indent: 1 });
    E.moneyRow('Depreciable closing NBV', dep.closingNBVPerPeriod, { style: 'subtotal', totalLast: true });
    E.moneyRow('Combined closing (Land + NBV)', ra.combinedClosingPerPeriod, { style: 'total', totalLast: true });
    E.gap();
  }
  const fpt = fa.projectTotals;
  E.subTitle('Fixed Assets (project total)');
  E.moneyRow('Land closing', fpt.land.closingPerPeriod, { indent: 1, totalLast: true });
  E.moneyRow('Depreciation', fpt.depreciable.depreciationPerPeriod, { indent: 1 });
  E.moneyRow('Depreciable closing NBV', fpt.depreciable.closingNBVPerPeriod, { style: 'subtotal', totalLast: true });
  E.moneyRow('Combined closing', fpt.combinedClosingPerPeriod, { style: 'total', totalLast: true });
  // IDC pool (capitalised construction interest depreciates through D&A).
  const idc = snap.idc;
  if (nz(idc.totalIdcPerPeriod) || nz(idc.idcNbvPerPeriod)) {
    E.gap();
    E.subTitle('IDC Pool (capitalised construction interest)');
    E.moneyRow('Construction interest', idc.totalConstructionInterestPerPeriod, { indent: 1 });
    E.moneyRow('Capitalised to assets', idc.totalIdcPerPeriod, { indent: 1 });
    E.moneyRow('IDC depreciation', idc.idcDepreciationPerPeriod, { indent: 1 });
    E.moneyRow('IDC NBV closing', idc.idcNbvPerPeriod, { style: 'total', totalLast: true });
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
    scalarRow('Exit multiple (x stabilised NOI)', rs.config.exitMultiple, NUMFMT.mult);
    scalarRow('Perpetuity growth', rs.config.perpetuityGrowth, NUMFMT.pct2);
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
      gridTable('Per-Asset Economics', ['Asset', 'Strategy', 'Revenue', 'Cost', 'Profit', 'Margin', 'Yield on Cost'],
        rs.perAsset.rows.map((a) => {
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
      cols.map((c) => [c.name, c.role === 'base' ? 'Management (base)' : 'Scenario', c.isActive ? 'Yes' : '', c.role === 'base' ? '-' : String(c.overrideCount)]));
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
  for (const a of buildRevenueBasisAdvisoriesFor(ctx.state.assets, ctx.state.subUnits, snap.revenue)) {
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
  for (const a of buildSaleCohortAdvisories(ctx.state.assets, ctx.state.project.saleCohortDefaults?.downpayment, snap.revenue)) {
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
