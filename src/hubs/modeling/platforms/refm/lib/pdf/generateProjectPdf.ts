/**
 * generateProjectPdf.ts
 *
 * Full-project PDF report for the REFM platform. ONE landscape document that
 * walks every selected module in platform tab order, covering inputs, outputs
 * and schedules, styled with the platform navy headers + Inter font +
 * accounting number format. No new calculations: it reads the same snapshots
 * the UI reads (computeFinancialsSnapshot + computeReturnsSnapshot).
 *
 * Structure (all pages landscape A4):
 *   - Page 1: clean Cover (project name + subtitle + date).
 *   - Page 2: Executive Summary (auto narrative + KPI cards + composition +
 *     financial structure).
 *   - Then one page per module TAB / sub-tab (each starts a new page), header =
 *     "Module N: Name  ·  Tab  ·  Sub-tab"; within a tab, Inputs then Outputs
 *     then Schedules bands.
 *   - Footer on every page: page number + project + FMP branding tagline.
 *
 * Period tables lead with the prior-year column (projectStartYear − 1) then the
 * project years, matching the platform axis everywhere. Wide tables split
 * across pages (label + Total repeat per chunk). Numbers are scaled (Millions
 * by default, user-selectable in the Export modal) so large figures stay
 * readable. The renderer is pure (state in, bytes out).
 */
import { resolveSubUnitAdr, resolveAssetAreaMetrics, computeAssetLandBreakdown } from '@/src/core/calculations';

/**
 * AREA AND LAND COME FROM THE PLATFORM'S RULES, NEVER FROM THIS FILE (2026-09-16).
 *
 * The report used to compute both itself: built area as "the sub-units, else the
 * typed BUA", and land as the raw stored allocation. Both predate the Module 1
 * restructure, so a plot whose area the chain derives read ZERO (Land 2: 0
 * against 11,329) and every host kept the gross plot its retail strip had
 * carved from, while the strips themselves read no land at all. The land TOTAL
 * still footed at 37,000, which is what hid it: each row was wrong and the
 * column added up (TRAPS 7.52).
 *
 * `resolveAssetAreaMetrics` and `computeAssetLandBreakdown` are the same two the
 * Assets tab and the workbook's Land & Area sheet call, with the same argument
 * list, so the three cannot disagree.
 */
const pdfAreaOf = (
  a: Asset,
  state: Pick<FinancialsResolverState, 'project' | 'parcels' | 'assets' | 'subUnits' | 'landAllocationMode'>,
): { bua: number; land: number } => {
  const visible = state.assets.filter((x) => x.visible !== false);
  const inPhase = visible.filter((x) => x.phaseId === a.phaseId);
  const m = resolveAssetAreaMetrics(a, state.project, state.parcels, inPhase, state.subUnits, state.landAllocationMode);
  const bd = computeAssetLandBreakdown(a, state.parcels, visible, state.subUnits, state.landAllocationMode);
  return { bua: m.bua, land: bd.landSqm };
};
import { buildReceivablesRollForward, buildUnearnedRollForward } from '../reports/saleRollForwardReports';
import { applyExportWatermark } from './drawWatermark';
import type { WatermarkSpec } from '@/src/shared/entitlements/exportWatermark';
import { PDFDocument, PDFName, PDFHexString, rgb, type PDFFont, type PDFPage, type PDFRef, type PDFObject } from 'pdf-lib';
import { buildSaleCohortTermsBlock, saleCohortRuleText, buildSaleCohortGrid, saleCohortGridCaption } from '../reports/saleCohortReports';
import fontkit from '@pdf-lib/fontkit';
import { formatAccounting, formatArea, formatInteger, type DisplayScale } from '@/src/core/formatters';
import { computeSubUnitArea, computePhaseTimeline, computeProjectTimeline } from '@/src/core/calculations';
import {
  FUNDING_METHOD_LABELS, FUNDING_METHOD_DESCRIPTIONS, REPAYMENT_METHOD_LABELS, PHASE_STATUS_LABELS,
  DEFAULT_COVENANTS, type FundingMethodId, type Asset,
} from '../state/module1-types';
import {
  resolveFundTerms, FUND_FEE_SPECS, FEE_TIMING_LABELS, FEE_BASE_LABELS, isFundManagerRow,
  DEFAULT_FUND_MANAGER_NAME,
} from '../fundTerms';
import {
  isFundActive, hasFundFeeIncome, buildFundWaterfallRows, buildFundFeeIncomeRows,
  buildFundGrossNetRows, buildFundEarnerRows, buildFundHeadlineCards, buildFundTermsPairs,
  fundGrossNetNote, fundWaterfallTotalsNote, fundHeadlineRestatementNote,
  FUND_GROSS_NET_COLUMNS, FUND_EARNER_COLUMNS, type FundReportCtx, type FundFmt,
} from '../reports/fundReports';
import { buildAssetNotes, structuralZeroCell, type AssetStructuralZero } from '../reports/assetNotes';
import INTER_REGULAR_B64 from './fonts/interRegular';
import INTER_BOLD_B64 from './fonts/interBold';
import {
  computeFinancialsSnapshot,
  computeFundingGap,
  type ProjectFinancialsSnapshot,
  type FinancialsResolverState,
} from '../financials-resolvers';
import { computeReturnsSnapshot, computeReturnsSensitivity, type ReturnsSnapshot } from '../returns-resolvers';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { buildPLRows, buildDirectCFRows, buildIndirectCFRows, buildBSRows, buildBsFeederTables, buildBsReconciliationRows, buildFundFeeBasisRows, buildFundCapitalRows, fundFeeBasisText, totalColumnHeading, totalColumnNote, resolveTotalColumnKind, TOTAL_COLUMN_HEADINGS, FUND_CAPITAL_BASES_TITLE, FUND_CAPITAL_BASES_NOTE, type M4FeederCtx } from '../reports/m4Reports';
import { buildOpexReport } from '../reports/opexReports';
import { buildFcffBuildup, buildFcfeBuildup, buildDividendBuildup } from '../reports/streamReports';
import { buildIntegrityChecks, checkDetail, buildRevenueBasisAdvisoriesFor, revenueBasisAdvisoryText, buildSaleCohortAdvisories, saleCohortAdvisoryText } from '../reports/checksReport';
import { evaluateCovenant, type CovenantInputs } from '../covenants';
import { buildCapexReport, CAPEX_CATEGORIES, type CapexResultTable } from '../reports/capexReports';
import { buildPartiesTable, PARTIES_TITLE, PARTIES_EMPTY_TEXT } from '../reports/partiesReport';
import {
  buildStandardsView, buildAssetAreaTables, buildAssetLandView, buildSubUnitLines,
  type InputsViewState, type ViewCell, type CostStandardView,
} from '../../components/modules/_shared/assetInputsView';
import { computeFundingBasis } from '../reports/fundingBasis';
import { countryLabel } from '@/src/core/countries';
import { deriveCostStage, isLandValueLine } from '@/src/core/calculations';
import { buildFinancingScheduleTables, buildCashSweepTables, buildIdcAllocationTables } from '../reports/financingReports';
import { buildCostOfSalesReport } from '../reports/cosReports';
import { buildCaseComparisonReport, type CaseComparisonInput, type CaseComparisonReport } from '../reports/caseComparisonReport';
import { poolMapByLine, poolCapexByLine, poolReturnRows, lineHosts, fixHospitalityRates, fixLeaseRates, poolRevenueBasisByLine, poolSaleCohortByLine, type PooledCapexInputLine } from '../reports/lineRows';
import { revenueBySection } from '../reports/revenueSections';
import { idcWithDisposal, disposalContextOf } from '../reports/disposalSchedules';
import { buildCaseYoYReport, type CaseYoYReport } from '../reports/caseYoYReport';
import { formatAssumptionValue } from '../cases/assumptionGrid';
import type { M4Row } from '../../components/modules/_shared/m4Table';
import { MODULES, type ModuleConfig } from '../modules-config';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import type { Party } from '../parties';
import { buildFixedAssetReport, type FixedAssetTable } from '../reports/fixedAssetReports';
import { BS_FEEDER_SECTIONS, BS_RECONCILIATION_CAPTION, FUND_FEE_BASIS_TITLE, FUND_FEE_BASIS_CAPTION } from '../reports/m4Reports';

function b64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Table / item model ───────────────────────────────────────────────────────
export type RowEmphasis = 'data' | 'subtotal' | 'total' | 'heading';
export type PartKind = 'inputs' | 'outputs' | 'schedules';

export interface PdfTableRow {
  cells: Array<string | number | null>;
  emphasis?: RowEmphasis;
  /** True when this row's leading cell is a point-in-time balance rather than
   *  a lifetime sum. `periodTable` derives the column heading from it, so a
   *  hand-built table cannot label a closing balance "Total". */
  totalIsBalance?: boolean;
}

export interface PdfTable {
  title: string;
  kind: 'period' | 'grid';
  /** period: ['', 'Total', priorYear, y1, y2, ...]; grid: arbitrary columns. */
  columns: string[];
  rows: PdfTableRow[];
  align?: 'kv' | 'data';
}

export interface PdfCard { label: string; value: string; sub?: string }

export type PdfItem =
  | { type: 'table'; table: PdfTable }
  | { type: 'cards'; title: string; cards: PdfCard[] }
  | { type: 'paragraph'; title?: string; text: string };

/** A table/cards/paragraph tagged with the tab it belongs to + its part. */
export interface TaggedItem { tab: string; part: PartKind; item: PdfItem }

/** Module content: a flat tagged list; the assembler groups by tab. */
export type ModuleContent = TaggedItem[];

export interface ModuleSectionSelection { inputs?: boolean; outputs?: boolean; schedules?: boolean }

export interface GenerateProjectPdfOptions {
  state: FinancialsResolverState;
  projectName: string;
  versionLabel?: string | null;
  versionComment?: string | null;
  dateLabel: string;
  selectedModuleKeys: string[];
  moduleSections?: Record<string, ModuleSectionSelection>;
  /** Per-module tab selection. When a module key is present, only its listed
   *  tab names render (matched against the builder's tab labels); when absent,
   *  all of that module's tabs render. Lets the user drill below part level. */
  moduleTabs?: Record<string, string[]>;
  /** Display scale for the PDF (overrides the project setting). Default millions. */
  displayScale?: DisplayScale;
  /** Decimal places for scaled figures. Defaults to scale-appropriate (0 for
   *  thousands/full, 1 for millions) when omitted. */
  displayDecimals?: number;
  /** When provided, Module 5 renders a Case Comparison table across every case
   *  (Management base + scenarios). Assembled by the caller (it owns the store /
   *  version snapshot); the PDF computes the report from it. */
  caseComparison?: CaseComparisonInput;
  /** Include the two-way sensitivity grid. Sensitivity is an entitlement-gated
   *  feature, so this defaults to FALSE and the caller passes the live gate;
   *  an export must not contain what the plan cannot open on screen. */
  includeSensitivity?: boolean;
  /** Module 1 tab 2. Parties are stored outside the version snapshot, so the
   *  caller (ExportModal) loads them and hands them in. Omitted = none entered. */
  parties?: Party[];
  /** Trial watermark, RESOLVED BY THE SERVER from the caller's plan. The
   *  builder never decides this: it is handed a spec or null, so there is no
   *  plan logic in the PDF layer to get out of step with the gate. Absent is
   *  the paid path and produces a byte-identical document. */
  watermark?: WatermarkSpec | null;
}

// ── Colors / layout ─────────────────────────────────────────────────────────
const NAVY = rgb(0x1b / 255, 0x4f / 255, 0x8a / 255);
const NAVY_DARK = rgb(0x1b / 255, 0x3a / 255, 0x6b / 255);
const WHITE = rgb(1, 1, 1);
const TEXT = rgb(0.12, 0.16, 0.22);
const MUTED = rgb(0.42, 0.46, 0.52);
const SUBTOTAL_FILL = rgb(0.90, 0.93, 0.97);
const PART_FILL = rgb(0.84, 0.89, 0.96);
const CARD_FILL = rgb(0.97, 0.98, 1);
const BORDER = rgb(0.82, 0.85, 0.89);
// FAST input cells: mirror the on-screen FAST_INPUT style (navy-pale fill +
// navy text) so assumption / input cells read as editable inputs in the PDF,
// exactly as they do in the platform UI. Slightly stronger than the 8% UI tint
// so the shading survives print. Applied to the value columns of input-part
// tables (the label column stays plain, matching the UI where only the field
// editor is shaded).
const FAST_FILL = rgb(0.886, 0.917, 0.957);
const FAST_TEXT = NAVY_DARK;
const FAST_BORDER = rgb(0.74, 0.80, 0.89);

const PAGE_W = 841.89; // A4 landscape only
const PAGE_H = 595.28;
const MARGIN = 34;
const HEADER_BAND_H = 30;
const FOOTER_H = 24;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const CONTENT_BOTTOM = MARGIN + FOOTER_H;

// COLUMN GEOMETRY IS SIZED TO THE DOCUMENT, not fixed (2026-08-12).
//
// These were constants tuned for a millions export. At `thousands` the period
// column was 3pt too narrow and at `full` it was 20pt too narrow, so pdf-lib's
// fitText ellipsised the numbers: 43 truncated cells at thousands and 3,867 at
// full in a real 14-year report, i.e. the export offered a scale whose output
// could not be read. The widths below are MINIMA; `resolveMetrics` grows the
// period and Total columns to whatever the widest cell in THIS document
// actually needs, then re-derives how many periods fit on a page. Wider numbers
// therefore cost pages, never digits.
const LABEL_COL_W_MIN = 230;   // was 188; see the label-truncation note on fitText
const LABEL_COL_W_MAX = 320;   // past this the label shrinks instead of the table growing
const TOTAL_COL_W_MIN = 72;
const PERIOD_COL_W_MIN = 52;
const CELL_PAD_W = 8;          // drawCell pads 4pt each side
const ROW_H = 14;
const HEADER_ROW_H = 16;
const TITLE_H = 18;
const PART_H = 20;
const SECTION_GAP = 10;

/** Resolved per-document table geometry. */
interface TableMetrics { labelW: number; totalW: number; periodW: number; periodsPerPage: number }

function makeMetrics(labelW: number, totalW: number, periodW: number): TableMetrics {
  const usable = CONTENT_W - labelW - totalW;
  return { labelW, totalW, periodW, periodsPerPage: Math.max(1, Math.floor(usable / periodW)) };
}

/**
 * Widen the numeric columns until the widest cell this document will draw fits.
 * Measured with the SAME font and size the cells are drawn at, so it is the
 * real rendered width and not a digit-count guess.
 */
function resolveMetrics(items: readonly PdfItem[], fmt: Fmt, font: PDFFont, bold: PDFFont): TableMetrics {
  let widestPeriod = 0, widestTotal = 0, widestLabel = 0;
  const w = (s: string): number => Math.max(font.widthOfTextAtSize(s, 8), bold.widthOfTextAtSize(s, 8));
  for (const item of items) {
    if (item.type !== 'table' || item.table.kind !== 'period') continue;
    // The leading column's HEADING is part of its content. It used to be the
    // literal 'Total' on every period table, so measuring only the cells was
    // safe; it now reads 'Closing' or 'Total / Closing' depending on the rows,
    // and an unmeasured caption would be shrunk to fit instead of given room.
    {
      const heading = item.table.columns[1] ?? '';
      const hw = w(heading);
      if (hw > widestTotal) widestTotal = hw;
    }
    for (const r of item.table.rows) {
      // cells = [label, Total, prior, ...periods].
      r.cells.forEach((c, k) => {
        const s = fmt.cell(c ?? null);
        if (!s) return;
        const width = w(s);
        if (k === 0) { if (width > widestLabel) widestLabel = width; }
        else if (k === 1) { if (width > widestTotal) widestTotal = width; }
        else if (width > widestPeriod) widestPeriod = width;
      });
    }
  }
  return makeMetrics(
    // The label column grows too, up to a cap: at `full` scale the inline fund
    // fee labels carry a 13-digit base ("0.50% of Total equity 2,550,682,386,
    // 14 periods") and no sane fixed width holds them. Past the cap the label
    // shrinks a point or two rather than the table eating the whole page.
    Math.min(LABEL_COL_W_MAX, Math.max(LABEL_COL_W_MIN, Math.ceil(widestLabel + CELL_PAD_W))),
    Math.max(TOTAL_COL_W_MIN, Math.ceil(widestTotal + CELL_PAD_W)),
    Math.max(PERIOD_COL_W_MIN, Math.ceil(widestPeriod + CELL_PAD_W)),
  );
}

const PART_LABEL: Record<PartKind, string> = { inputs: 'Inputs', outputs: 'Outputs', schedules: 'Schedules' };

// ── Navigation model (ToC / section breaks / outline; full report only) ────────
// A GoTo target: the destination page ref + a top-of-page y. Refs are position
// independent, so anchors survive the ToC pages being inserted at the front.
interface NavTarget { ref: PDFRef; y: number }
interface TabNav { tab: string; target: NavTarget }
interface ModuleNav { key: string; num: number; label: string; target: NavTarget | null; tabs: TabNav[]; breakPage: PDFPage | null }
interface NavState {
  enabled: boolean;
  modules: ModuleNav[];      // rendered modules, in report order
  current: ModuleNav | null; // module whose content is being rendered (for tab anchors)
  anchors: Map<string, NavTarget>; // 'exec' | 'mod:<key>' | 'tab:<key>::<tab>'
  execTarget: NavTarget | null;
}
function disabledNav(): NavState {
  return { enabled: false, modules: [], current: null, anchors: new Map(), execTarget: null };
}

// ── Render context ────────────────────────────────────────────────────────────
interface Ctx {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  pages: PDFPage[];
  page: PDFPage;
  y: number;
  projectName: string;
  unitLabel: string;
  currentHeader?: string;
  nav: NavState;
  /** Model version, printed on the cover and in every footer (H1). */
  versionLabel?: string | null;
  /** Table geometry, resolved once per document from the widest cell it draws. */
  metrics: TableMetrics;
}

function newPage(ctx: Ctx, headerTitle?: string): void {
  const page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pages.push(page);
  ctx.page = page;
  if (headerTitle) {
    drawHeaderBand(ctx, headerTitle);
    ctx.y = PAGE_H - HEADER_BAND_H - 10;
  } else {
    ctx.y = PAGE_H - MARGIN;
  }
}

function drawHeaderBand(ctx: Ctx, title: string): void {
  ctx.page.drawRectangle({ x: 0, y: PAGE_H - HEADER_BAND_H, width: PAGE_W, height: HEADER_BAND_H, color: NAVY });
  ctx.page.drawText(fitText(title, ctx.bold, 12, CONTENT_W - 180), { x: MARGIN, y: PAGE_H - HEADER_BAND_H + 10, size: 12, font: ctx.bold, color: WHITE });
  // Unit note on the right of the header band.
  const u = ctx.unitLabel;
  const uw = ctx.font.widthOfTextAtSize(u, 8);
  ctx.page.drawText(u, { x: PAGE_W - MARGIN - uw, y: PAGE_H - HEADER_BAND_H + 11, size: 8, font: ctx.font, color: rgb(0.85, 0.9, 0.97) });
}

function fitText(text: string, font: PDFFont, size: number, maxW: number): string {
  const t = text ?? '';
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  let lo = 0, hi = t.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(t.slice(0, mid) + '…', size) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return t.slice(0, lo) + '…';
}

/**
 * The smallest size in `[minSize, size]` at which `text` fits `maxW` whole,
 * or `minSize` if it never does. Used for LABEL cells only: a truncated label
 * loses the very thing it was added to say (the fund fee labels were cut at
 * "Fund structure fee (0.50% of Fund size 5,3...", hiding the base amount the
 * columnar block exists to disclose), whereas a label one point smaller than
 * its neighbours is merely tighter. Numeric cells never shrink: they must stay
 * uniform down a column, which is what the widening in `resolveMetrics` is for.
 */
function fitSize(text: string, font: PDFFont, size: number, minSize: number, maxW: number): number {
  if (font.widthOfTextAtSize(text, size) <= maxW) return size;
  for (let s = size - 0.25; s >= minSize; s -= 0.25) {
    if (font.widthOfTextAtSize(text, s) <= maxW) return s;
  }
  return minSize;
}

const LABEL_MIN_SIZE = 6.5;

function drawCell(
  ctx: Ctx, text: string, x: number, w: number, y: number,
  opts: { align?: 'left' | 'right' | 'center'; font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; shrinkToFit?: boolean },
): void {
  const font = opts.font ?? ctx.font;
  const baseSize = opts.size ?? 8;
  const color = opts.color ?? TEXT;
  const pad = 4;
  const maxW = w - 2 * pad;
  const size = opts.shrinkToFit ? fitSize(text ?? '', font, baseSize, Math.min(LABEL_MIN_SIZE, baseSize), maxW) : baseSize;
  const fitted = fitText(text, font, size, maxW);
  const tw = font.widthOfTextAtSize(fitted, size);
  const tx = opts.align === 'right' ? x + w - pad - tw : opts.align === 'center' ? x + (w - tw) / 2 : x + pad;
  // Keep the baseline where an 8pt cell would sit so a shrunk label still lines
  // up with the numbers on its own row.
  ctx.page.drawText(fitted, { x: tx, y: y + 4 + (baseSize - size) * 0.3, size, font, color });
}

// ── Number formatting ─────────────────────────────────────────────────────────
interface Fmt {
  scale: DisplayScale;
  dec: number;
  cell: (v: string | number | null) => string;
  money: (v: number | null | undefined) => string;
  area: (v: number | null | undefined) => string;
  int: (v: number | null | undefined) => string;
  pct: (v: number | null | undefined, d?: number) => string;
  pctRaw: (v: number | null | undefined, d?: number) => string;
  mult: (v: number | null | undefined) => string;
}

function makeFmt(scale: DisplayScale, decimals?: number): Fmt {
  const dec = decimals !== undefined ? decimals : scale === 'full' ? 0 : scale === 'millions' ? 1 : 0;
  const money = (v: number | null | undefined): string =>
    v === null || v === undefined || !Number.isFinite(v) ? '' : formatAccounting(v, scale, dec);
  const finite = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);
  return {
    scale, dec, money,
    cell: (v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : !Number.isFinite(v) ? '' : formatAccounting(v, scale, dec)),
    area: (v) => formatArea(v ?? 0, 0),
    int: (v) => formatInteger(v ?? 0),
    pct: (v, d = 1) => (finite(v) ? `${(v * 100).toFixed(d)}%` : 'n/a'),
    pctRaw: (v, d = 2) => (finite(v) ? `${v.toFixed(d)}%` : 'n/a'),
    mult: (v) => (finite(v) ? `${v.toFixed(2)}x` : 'n/a'),
  };
}

/**
 * Suffix for a column of PER-UNIT rates (a unit sale price, an ADR, a rate per
 * sqm). These are the one class of money in the report that does NOT follow the
 * export scale, and deliberately: an ADR of 268 becomes "0.0" in a millions
 * export, which destroys the figure rather than scaling it. Leaving them raw is
 * right; leaving them raw AND unlabelled, under a header band that says "All
 * figures in SAR millions", is what read as broken. So they carry their unit.
 */
function rateUnit(currency: string, per = 'unit'): string {
  return `(${currency}/${per})`;
}

function unitLabel(currency: string, scale: DisplayScale): string {
  if (scale === 'thousands') return `All figures in ${currency} '000`;
  if (scale === 'millions') return `All figures in ${currency} millions`;
  return `All figures in ${currency}`;
}

// ── Drawing primitives ──────────────────────────────────────────────────────
function chunkRanges(nPeriods: number, PERIODS_PER_PAGE: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let s = 0; s < Math.max(1, nPeriods); s += PERIODS_PER_PAGE) out.push([s, Math.min(nPeriods, s + PERIODS_PER_PAGE)]);
  return out.length ? out : [[0, 0]];
}

function emphasisStyle(em: RowEmphasis | undefined): { fill?: ReturnType<typeof rgb>; color: ReturnType<typeof rgb>; bold: boolean } {
  switch (em) {
    case 'total': return { fill: NAVY, color: WHITE, bold: true };
    case 'subtotal': return { fill: SUBTOTAL_FILL, color: TEXT, bold: true };
    case 'heading': return { color: NAVY_DARK, bold: true };
    default: return { color: TEXT, bold: false };
  }
}

function ensureSpace(ctx: Ctx, need: number): void {
  if (ctx.y - need < CONTENT_BOTTOM) newPage(ctx, ctx.currentHeader);
}

function drawTitle(ctx: Ctx, title: string): void {
  ensureSpace(ctx, TITLE_H);
  ctx.y -= TITLE_H;
  drawCell(ctx, title, MARGIN, CONTENT_W, ctx.y, { font: ctx.bold, size: 10, color: NAVY_DARK });
}

function drawPartHeader(ctx: Ctx, label: string, hint?: string): void {
  ensureSpace(ctx, PART_H + 4);
  ctx.y -= PART_H;
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: CONTENT_W, height: PART_H, color: PART_FILL });
  drawCell(ctx, label, MARGIN, CONTENT_W, ctx.y + 2, { font: ctx.bold, size: 10, color: NAVY_DARK });
  if (hint) {
    // Right-aligned legend swatch + note (used on the Inputs band to explain the
    // navy-pale input shading).
    const noteW = ctx.font.widthOfTextAtSize(hint, 7);
    const swX = MARGIN + CONTENT_W - noteW - 14;
    ctx.page.drawRectangle({ x: swX, y: ctx.y + 6, width: 8, height: 8, color: FAST_FILL, borderColor: FAST_BORDER, borderWidth: 0.5 });
    // + 2 * pad, because drawCell subtracts 4pt of padding from EACH side of the
    // width it is handed. Passing the bare text width made the box 6pt too
    // narrow, so this legend was ellipsised ("... model inputs / assumpt...") on
    // every Inputs page in the report, every time.
    drawCell(ctx, hint, swX + 12, noteW + 2 + 8, ctx.y + 2, { size: 7, color: MUTED });
  }
  ctx.y -= 4;
}

function drawParagraph(ctx: Ctx, text: string, size = 9): void {
  // Wrap against the width drawCell will ACTUALLY have after its 4pt-a-side
  // padding. Wrapping to CONTENT_W - 4 while drawing into CONTENT_W - 8 let a
  // full line overflow by up to 4pt and get ellipsised, which is how the
  // executive summary narrative lost its last few words on some projects.
  const maxW = CONTENT_W - 2 * 4;
  const words = text.split(' ');
  let line = '';
  const flush = (): void => {
    if (!line) return;
    ensureSpace(ctx, 13);
    ctx.y -= 13;
    drawCell(ctx, line, MARGIN, CONTENT_W, ctx.y, { size, color: TEXT });
    line = '';
  };
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.font.widthOfTextAtSize(test, size) > maxW) { flush(); line = w; } else line = test;
  }
  flush();
  ctx.y -= 4;
}

function drawCards(ctx: Ctx, title: string, cards: PdfCard[]): void {
  if (title) drawTitle(ctx, title);
  const perRow = 4, gap = 8, ch = 44;
  const cw = (CONTENT_W - (perRow - 1) * gap) / perRow;
  for (let i = 0; i < cards.length; i += perRow) {
    ensureSpace(ctx, ch + 6);
    ctx.y -= ch;
    cards.slice(i, i + perRow).forEach((cd, j) => {
      const x = MARGIN + j * (cw + gap);
      ctx.page.drawRectangle({ x, y: ctx.y, width: cw, height: ch, borderColor: BORDER, borderWidth: 1, color: CARD_FILL });
      drawCell(ctx, cd.label.toUpperCase(), x + 8, cw - 12, ctx.y + ch - 14, { size: 7, font: ctx.bold, color: MUTED });
      drawCell(ctx, cd.value, x + 8, cw - 12, ctx.y + ch - 31, { size: 13, font: ctx.bold, color: NAVY_DARK });
      if (cd.sub) drawCell(ctx, cd.sub, x + 8, cw - 12, ctx.y + 1, { size: 6.5, color: MUTED });
    });
    ctx.y -= 6;
  }
  ctx.y -= SECTION_GAP - 4;
}

function drawGridTable(ctx: Ctx, table: PdfTable, fmt: Fmt, isInput = false): void {
  drawTitle(ctx, table.title);
  const nCols = table.columns.length;
  const dataAlign = table.align !== 'kv';
  // COLUMN WIDTHS FOLLOW THE CONTENT. These used to be a fixed split (a 28%
  // first column, the rest shared equally), which truncated whichever column
  // happened to hold the long strings: at `full` scale the percent-line basis
  // cells read "93,250,000 of selected li..." and a longer header could not fit
  // at all. Each column now asks for what its widest cell needs; if the asks fit
  // the page the slack is shared, and if they do not, every column is scaled
  // down together and `shrinkToFit` takes up the remainder. Nothing is cut.
  const bandRow = (r: PdfTableRow): boolean => r.emphasis === 'heading'
    && r.cells.length > 1
    && r.cells.slice(1).every((c) => c === '' || c === null || c === undefined);
  const widest = (i: number): number => {
    let w = ctx.bold.widthOfTextAtSize(table.columns[i] ?? '', 8);
    for (const r of table.rows) {
      if (i === 0 && bandRow(r)) continue;
      const s = fmt.cell(r.cells[i] ?? null);
      if (!s) continue;
      const cw = Math.max(ctx.font.widthOfTextAtSize(s, 8), ctx.bold.widthOfTextAtSize(s, 8));
      if (cw > w) w = cw;
    }
    return w + CELL_PAD_W;
  };
  const asks = table.columns.map((_, i) => widest(i));
  const totalAsk = asks.reduce((s, v) => s + v, 0);
  const widths = totalAsk <= CONTENT_W
    // Everything fits: share the slack, weighted, so the table still fills the
    // page instead of huddling on the left.
    ? asks.map((a) => a + (CONTENT_W - totalAsk) * (a / totalAsk))
    // Over budget: scale proportionally. A minimum keeps a narrow column
    // (a "Yes" flag) from collapsing to nothing when a neighbour is huge.
    : (() => {
      const floor = Math.min(36, CONTENT_W / nCols);
      const fixed = asks.map((a) => Math.min(a, floor));
      const fixedSum = fixed.reduce((s, v) => s + v, 0);
      const flex = asks.map((a, i) => a - fixed[i]);
      const flexSum = flex.reduce((s, v) => s + v, 0) || 1;
      const room = Math.max(0, CONTENT_W - fixedSum);
      return asks.map((_, i) => fixed[i] + room * (flex[i] / flexSum));
    })();
  const offsets = widths.reduce<number[]>((acc, w, i) => { acc[i + 1] = acc[i] + w; return acc; }, [0]);
  const colX = (i: number): number => MARGIN + offsets[i];
  const colW = (i: number): number => widths[i];
  const drawHeader = (): void => {
    ensureSpace(ctx, HEADER_ROW_H);
    ctx.y -= HEADER_ROW_H;
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: CONTENT_W, height: HEADER_ROW_H, color: NAVY });
    table.columns.forEach((c, i) => drawCell(ctx, c, colX(i), colW(i), ctx.y, { align: i === 0 || !dataAlign ? 'left' : 'right', font: ctx.bold, size: 8, color: WHITE, shrinkToFit: true }));
  };
  drawHeader();
  for (const r of table.rows) {
    if (ctx.y - ROW_H < CONTENT_BOTTOM) { newPage(ctx, ctx.currentHeader); drawHeader(); }
    ctx.y -= ROW_H;
    const st = emphasisStyle(r.emphasis);
    if (st.fill) ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: CONTENT_W, height: ROW_H, color: st.fill });
    // FAST input shading: on plain data rows of an input table, the value
    // columns (everything past the label) get the navy-pale input fill so they
    // read as assumptions, just like the on-screen FAST_INPUT cells.
    const shadeInputs = isInput && !st.fill && (!r.emphasis || r.emphasis === 'data');
    if (shadeInputs) {
      for (let i = 1; i < nCols; i++) {
        ctx.page.drawRectangle({ x: colX(i), y: ctx.y, width: colW(i), height: ROW_H, color: FAST_FILL, borderColor: FAST_BORDER, borderWidth: 0.5 });
      }
    }
    const isBand = r.emphasis === 'heading'
      && r.cells.length > 1
      && r.cells.slice(1).every((c) => c === '' || c === null || c === undefined);
    if (isBand) {
      drawCell(ctx, fmt.cell(r.cells[0]), colX(0), CONTENT_W, ctx.y, { align: 'left', font: ctx.bold, size: 8, color: st.color, shrinkToFit: true });
    } else {
      r.cells.forEach((cell, i) => {
        const align: 'left' | 'right' = i === 0 ? 'left' : dataAlign ? 'right' : 'left';
        const color = shadeInputs && i >= 1 ? FAST_TEXT : st.color;
        drawCell(ctx, fmt.cell(cell), colX(i), colW(i), ctx.y, { align, font: st.bold ? ctx.bold : ctx.font, size: 8, color, shrinkToFit: true });
      });
    }
  }
  ctx.y -= SECTION_GAP;
}

function drawPeriodTable(ctx: Ctx, table: PdfTable, fmt: Fmt, isInput = false): void {
  const periodHeaders = table.columns.slice(2); // [priorYear, ...years]
  const { labelW, totalW, periodW, periodsPerPage } = ctx.metrics;
  const ranges = chunkRanges(periodHeaders.length, periodsPerPage);
  ranges.forEach(([from, to], ci) => {
    const chunkCount = to - from;
    const totalRowW = labelW + totalW + chunkCount * periodW;
    const colX = (k: number): number => k === 0 ? MARGIN : k === 1 ? MARGIN + labelW : MARGIN + labelW + totalW + (k - 2) * periodW;
    const colW = (k: number): number => (k === 0 ? labelW : k === 1 ? totalW : periodW);
    // The leading column's caption comes from the TABLE, not a literal: it is
    // 'Closing' on the balance sheet and 'Total / Closing' on a cash flow
    // statement. Hardcoding 'Total' here is what kept the balance sheet
    // labelled as a lifetime sum even after the builders started saying
    // otherwise.
    const headerLabels = ['', table.columns[1] ?? TOTAL_COLUMN_HEADINGS.sum, ...periodHeaders.slice(from, to)];
    drawTitle(ctx, ci === 0 ? table.title : `${table.title} (continued)`);
    const drawHeader = (): void => {
      ensureSpace(ctx, HEADER_ROW_H);
      ctx.y -= HEADER_ROW_H;
      ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: totalRowW, height: HEADER_ROW_H, color: NAVY });
      headerLabels.forEach((c, k) => drawCell(ctx, c, colX(k), colW(k), ctx.y, { align: k === 0 ? 'left' : 'right', font: ctx.bold, size: 8, color: WHITE, shrinkToFit: true }));
    };
    drawHeader();
    for (const r of table.rows) {
      if (ctx.y - ROW_H < CONTENT_BOTTOM) { newPage(ctx, ctx.currentHeader); drawHeader(); }
      ctx.y -= ROW_H;
      const st = emphasisStyle(r.emphasis);
      if (st.fill) ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: totalRowW, height: ROW_H, color: st.fill });
      const cells = [r.cells[0], r.cells[1], ...r.cells.slice(2 + from, 2 + to)];
      const shadeInputs = isInput && !st.fill && (!r.emphasis || r.emphasis === 'data');
      if (shadeInputs) {
        for (let k = 1; k < cells.length; k++) {
          ctx.page.drawRectangle({ x: colX(k), y: ctx.y, width: colW(k), height: ROW_H, color: FAST_FILL, borderColor: FAST_BORDER, borderWidth: 0.5 });
        }
      }
      cells.forEach((cell, k) => drawCell(ctx, fmt.cell(cell ?? null), colX(k), colW(k), ctx.y, { align: k === 0 ? 'left' : 'right', font: st.bold ? ctx.bold : ctx.font, size: 8, color: shadeInputs && k >= 1 ? FAST_TEXT : st.color, shrinkToFit: k === 0 }));
    }
    ctx.y -= SECTION_GAP;
  });
}

function drawItem(ctx: Ctx, item: PdfItem, fmt: Fmt, isInput = false): void {
  if (item.type === 'table') { item.table.kind === 'period' ? drawPeriodTable(ctx, item.table, fmt, isInput) : drawGridTable(ctx, item.table, fmt, isInput); }
  else if (item.type === 'cards') drawCards(ctx, item.title, item.cards);
  else { if (item.title) drawTitle(ctx, item.title); drawParagraph(ctx, item.text); }
}

// ── Cover + footer ────────────────────────────────────────────────────────────
function drawCover(ctx: Ctx, projectName: string, subtitle: string, dateLabel: string, versionLabel?: string | null, versionComment?: string | null): void {
  newPage(ctx);
  ctx.page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: NAVY });
  const cy = PAGE_H / 2 + 30;
  drawCell(ctx, projectName || 'Untitled Project', MARGIN, CONTENT_W, cy, { align: 'center', font: ctx.bold, size: 30, color: NAVY_DARK });
  drawCell(ctx, subtitle, MARGIN, CONTENT_W, cy - 40, { align: 'center', size: 13, color: MUTED });
  ctx.page.drawRectangle({ x: PAGE_W / 2 - 60, y: cy - 56, width: 120, height: 2, color: NAVY });
  drawCell(ctx, dateLabel, MARGIN, CONTENT_W, cy - 84, { align: 'center', size: 10, color: TEXT });
  if (versionLabel) {
    drawCell(ctx, `Model version ${versionLabel}`, MARGIN, CONTENT_W, cy - 104, { align: 'center', font: ctx.bold, size: 10, color: NAVY_DARK });
    if (versionComment) drawCell(ctx, versionComment, MARGIN, CONTENT_W, cy - 120, { align: 'center', size: 8, color: MUTED });
  }
  drawCell(ctx, 'Financial Modeler Pro', MARGIN, CONTENT_W, MARGIN + 56, { align: 'center', font: ctx.bold, size: 11, color: NAVY });
  drawCell(ctx, 'Institutional-grade real estate financial modeling & feasibility', MARGIN, CONTENT_W, MARGIN + 40, { align: 'center', size: 8, color: MUTED });
}

function drawFooters(ctx: Ctx): void {
  // Iterate the document's TRUE page order (not ctx.pages) so numbering stays
  // sequential after ToC pages are inserted at the front. Identical to ctx.pages
  // order when no insertion happened (nav off / empty selection).
  const pages = ctx.doc.getPages();
  const total = pages.length;
  const barH = 18;
  const barY = 12;
  pages.forEach((page, i) => {
    // Navy footer bar matching the header band; text sits inside it.
    page.drawRectangle({ x: 0, y: barY, width: PAGE_W, height: barH, color: NAVY });
    const left = `Page ${i + 1} of ${total}   ·   ${ctx.projectName}${ctx.versionLabel ? `   ·   ${ctx.versionLabel}` : ''}   ·   ${ctx.unitLabel}`;
    page.drawText(fitText(left, ctx.font, 8, PAGE_W * 0.62), { x: MARGIN, y: barY + 6, size: 8, font: ctx.font, color: WHITE });
    const tag = 'Financial Modeler Pro · financialmodelerpro.com';
    const tw = ctx.bold.widthOfTextAtSize(tag, 8);
    page.drawText(tag, { x: PAGE_W - MARGIN - tw, y: barY + 6, size: 8, font: ctx.bold, color: WHITE });
  });
}

// ── Builder helpers ───────────────────────────────────────────────────────────
const sum = (a: number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);
const last = (a: number[]): number => a[a.length - 1] ?? 0;
const anyNonZero = (a: number[] | undefined): boolean => !!a && a.some((v) => (v ?? 0) !== 0);

function row(cells: Array<string | number | null>, emphasis?: RowEmphasis): PdfTableRow { return { cells, emphasis }; }

/** Period row: leads with [label, total, prior, ...values]. */
function periodRow(label: string, values: number[], total: 'sum' | 'last' | 'none', emphasis?: RowEmphasis, prior: number | null = 0): PdfTableRow {
  const t = total === 'sum' ? sum(values) : total === 'last' ? last(values) : null;
  // 'last' means the leading cell is the CLOSING figure, which is the whole
  // reason the heading cannot always read "Total".
  return { cells: [label, t, prior, ...values], emphasis, ...(total === 'last' ? { totalIsBalance: true } : {}) };
}
function strPeriodRow(label: string, strs: string[], total: string | number | null = '', emphasis?: RowEmphasis, prior: string | number | null = ''): PdfTableRow {
  return { cells: [label, total, prior, ...strs], emphasis };
}
function periodTable(title: string, priorYear: number, yearLabels: number[], rows: PdfTableRow[]): PdfTable {
  return { title, kind: 'period', columns: ['', pdfTotalHeading(rows), String(priorYear), ...yearLabels.map(String)], rows };
}
/**
 * Heading for a hand-built period table's leading column.
 *
 * The summary PDF's statements are hand-built PdfTableRows rather than shared
 * M4Rows, so they cannot go through `totalColumnHeading` directly. They go
 * through the SAME classifier underneath it instead of re-deriving the
 * three-way rule, which is the difference between one rule and two copies that
 * happen to agree today.
 */
function pdfTotalHeading(rows: readonly PdfTableRow[]): string {
  return TOTAL_COLUMN_HEADINGS[resolveTotalColumnKind(rows.map((r) => ({
    occupiesTotalColumn: r.cells[1] !== null && r.cells[1] !== '',
    isBalance: r.totalIsBalance === true,
  })))];
}
/**
 * Convert the platform's shared statement row model (M4Row[]) into a PDF period
 * table, so the PDF mirrors the on-screen Module 4 statements exactly (and stays
 * in sync automatically: both render from lib/reports/m4Reports.ts). Collapsible
 * groups are always rendered expanded (print has no interactivity).
 */
/** Percentage rendering for an M4Row flagged `isPercent`. The scale argument is
 *  irrelevant to `pct` (a ratio is not money), so any Fmt serves; taking it from
 *  makeFmt keeps the one percentage rule rather than spelling out a second. */
const M4_PCT = makeFmt('full');

function m4RowsToPeriodTable(title: string, priorYear: number, yearLabels: number[], rows: M4Row[]): PdfTable {
  const N = yearLabels.length;
  const indentLabel = (r: M4Row): string => {
    const pad = '   '.repeat(r.indent ?? 0);
    const phase = r.phaseLabel ? `  [P${r.phaseLabel}]` : '';
    return `${pad}${r.label}${phase}`;
  };
  const pdfRows: PdfTableRow[] = rows.map((r): PdfTableRow => {
    const emphasis: RowEmphasis | undefined = r.isTotal
      ? 'total'
      : (r.isSubtotal || r.collapseRole === 'header') ? 'subtotal'
        : r.isSection ? 'heading' : undefined;
    if (r.isSection && r.values.length === 0) {
      return { cells: [indentLabel(r), null, null, ...new Array<null>(N).fill(null)], emphasis: 'heading' };
    }
    const total: string | number | null = r.totalOverride !== undefined
      ? r.totalOverride
      : r.values.reduce((s, v) => s + (v ?? 0), 0);
    const prior: number | null = r.priorValue ?? null;
    const values = r.values.slice(0, N);
    // A ratio row is rendered here, as strings, because the period renderer
    // formats every numeric cell as money.
    if (r.isPercent) {
      const strs: Array<string | null> = values.map((v) => M4_PCT.pct(v, 1));
      while (strs.length < N) strs.push(null);
      return {
        cells: [
          indentLabel(r),
          // A ratio's lifetime figure is stated by the builder where a sum would
          // be wrong (an occupancy, a margin), 2026-09-14.
          r.totalOverride !== undefined ? r.totalOverride : M4_PCT.pct(r.totalValue !== undefined ? r.totalValue : values.reduce((s, v) => s + (v ?? 0), 0), 1),
          prior === null ? null : M4_PCT.pct(prior, 1),
          ...strs,
        ],
        emphasis,
      };
    }
    // A COUNT OR A RATE (2026-09-14): keys, room nights, ADR, RevPAR. Full
    // scale, as strings, for the same reason as a ratio: the period renderer
    // scales every numeric cell as money, so 850 a night printed as "1" at
    // thousands. The lifetime figure is the builder's where a sum is wrong.
    if (r.valueKind === 'count' || r.valueKind === 'rate') {
      const dp = r.valueKind === 'count' ? 0 : 2;
      const f = (v: number): string => formatAccounting(v, 'full', dp);
      const strs: Array<string | null> = values.map(f);
      while (strs.length < N) strs.push(null);
      return {
        cells: [
          indentLabel(r),
          r.totalOverride !== undefined ? r.totalOverride : f(r.totalValue !== undefined ? r.totalValue : values.reduce((s, v) => s + (v ?? 0), 0)),
          prior === null ? null : f(prior),
          ...strs,
        ],
        emphasis,
      };
    }
    const padded = values.length < N ? [...values, ...new Array<null>(N - values.length).fill(null)] : values;
    return { cells: [indentLabel(r), total, prior, ...padded], emphasis };
  });
  // The leading column's heading is DERIVED from the rows: 'Closing' on the
  // balance sheet, 'Total / Closing' on a cash flow statement that carries
  // both, 'Total' on the P&L. It used to read 'Total' on all three, so TOTAL
  // ASSETS printed the closing figure under a heading claiming a lifetime sum.
  return { title, kind: 'period', columns: ['', totalColumnHeading(rows), String(priorYear), ...yearLabels.map(String)], rows: pdfRows };
}
function kvTable(title: string, pairs: Array<[string, string]>): PdfTable {
  return { title, kind: 'grid', columns: ['Field', 'Value'], align: 'kv', rows: pairs.map(([a, b]) => row([a, b])) };
}
/** Two key/value pairs per row (4 columns), so a short settings list stays
 *  compact (used to keep the Executive Summary to a single page). */
function kv2Table(title: string, pairs: Array<[string, string]>): PdfTable {
  const rows: PdfTableRow[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i];
    const b = pairs[i + 1];
    rows.push(row([a[0], a[1], b?.[0] ?? '', b?.[1] ?? '']));
  }
  return { title, kind: 'grid', columns: ['Field', 'Value', 'Field', 'Value'], align: 'kv', rows };
}
/** Tagged-item helpers. */
const tItem = (tab: string, part: PartKind, item: PdfItem): TaggedItem => ({ tab, part, item });
const tTable = (tab: string, part: PartKind, table: PdfTable): TaggedItem => tItem(tab, part, { type: 'table', table });
const tCards = (tab: string, part: PartKind, title: string, cards: PdfCard[]): TaggedItem => tItem(tab, part, { type: 'cards', title, cards });

// ── Fund layer: ONE definition of the PDF fund block ────────────────────────
//
// Both PDFs render this: the full report puts it in Module 5, the summary PDF
// on its own page. The ROWS come from the shared lib/reports/fundReports
// builders (the same ones the M5 screen and the Excel workbook use), so this
// only decides PDF layout, never content or row order.
//
// Returns an empty list on a standalone project, so a caller can splice it in
// unconditionally and nothing appears when the fund toggle is off.

// ── Headline returns: ONE name per metric, and every one states its basis ─────
//
// The report used to print two different cards both captioned "Equity Multiple"
// (2.10x on FCFE and 2.22x on distributions), the second with no basis at all;
// it called the same metric "Dividend IRR" on one page and "Distributed Equity
// IRR" on the next; and on a fund project every headline was the GROSS figure
// while the Fund Layer page two pages later showed the net one, with nothing
// saying which was which. All three are the same failure: a number without its
// basis. So the basis is part of the definition here, once.
//
// On a fund project with a performance fee the distribution cards show NET and
// name the gross beside them, because net is what the equity actually receives.
function headlineReturnCards(returns: ReturnsSnapshot, fmt: Fmt, opts: { omitDistribution?: boolean } = {}): PdfCard[] {
  const r = returns.result;
  const fundOn = isFundActive(returns);
  const net = fundOn ? returns.resultNetDividends : null;
  const hasFee = !!net && (returns.waterfall?.totalPerformanceFee ?? 0) > 0;
  const dist = hasFee && net ? net : r.dividends;
  const basis = hasFee ? 'net of performance fee' : 'on distributions';
  // The distribution pair is OMITTED on a page that has already printed it a
  // page or two earlier. In the concise summary the executive summary and the
  // returns page carried byte-identical card sets, so Distributed Equity IRR
  // and MOIC appeared three times in ten pages (the third being the fund
  // layer's gross-vs-net split, which is the only one that adds anything).
  const distribution: PdfCard[] = opts.omitDistribution ? [] : [
    { label: 'Distributed Equity IRR', value: fmt.pct(dist.irr, 1), sub: basis },
    { label: 'Distributed Equity MOIC', value: fmt.mult(dist.moic), sub: hasFee ? `net; gross ${fmt.mult(r.dividends.moic)}` : 'distributions / invested' },
  ];
  return [
    { label: 'Project IRR', value: fmt.pct(r.fcff.irr, 1), sub: 'unlevered, FCFF' },
    { label: 'Equity IRR', value: fmt.pct(r.fcfe.irr, 1), sub: 'levered, FCFE' },
    { label: 'Equity Multiple (FCFE)', value: fmt.mult(r.fcfe.moic), sub: 'levered cash flow' },
    ...distribution,
    { label: 'Terminal Equity Value', value: fmt.money(returns.terminalEquityValue), sub: `exit ${returns.exitYearLabel}` },
  ];
}

/** Where the omitted distribution pair was reported instead. */
function distributionPointerNote(returns: ReturnsSnapshot, fmt: Fmt): string {
  const fundOn = isFundActive(returns);
  const net = fundOn ? returns.resultNetDividends : null;
  const hasFee = !!net && (returns.waterfall?.totalPerformanceFee ?? 0) > 0;
  const dist = hasFee && net ? net : returns.result.dividends;
  const where = fundOn ? 'the Executive Summary, and split gross against net in the Fund Layer section' : 'the Executive Summary';
  return `Distributed Equity IRR ${fmt.pct(dist.irr, 1)} and MOIC ${fmt.mult(dist.moic)} are reported in ${where}, and are not repeated here.`;
}

/** The one-line note that names the basis of the distribution cards above. */
function headlineBasisNote(returns: ReturnsSnapshot, fmt: Fmt): string {
  if (!isFundActive(returns)) return '';
  const fee = returns.waterfall?.totalPerformanceFee ?? 0;
  if (fee <= 0) return 'This is a fund project. No performance fee arises, so distributed-equity returns are the same gross and net; see the Fund Layer section.';
  return `This is a fund project. The distributed-equity figures above are NET of a performance fee of ${fmt.money(fee)}; the gross figures and the full waterfall are in the Fund Layer section.`;
}

/**
 * Model integrity checks, from the SHARED builder that also drives the
 * workbook's Checks tab. Neither PDF had these: the full report carried a
 * single 'BS Check: BALANCED' row buried inside the balance sheet, and the
 * summary had no balance check at all, so a reader had no way to tell whether
 * the statements reconciled. Tolerance is relative and anchored on the PEAK
 * magnitude, never an absolute band and never the final period.
 */
function checksTable(
  snap: ProjectFinancialsSnapshot,
  fmt: Fmt,
  state?: FinancialsResolverState,
): PdfTable {
  const checks = buildIntegrityChecks(snap);
  // 2026-08-16: cash-basis advisories ride in the same table but as NOTE, never
  // OK or CHECK. They are not identities: a gap between cash collected and
  // gross sale value is legitimate model state, so failing the model over it
  // would cry wolf. They appear here because this is where a reader looks for
  // model caveats, and only when a divergence actually exists.
  const advisories = state
    ? poolRevenueBasisByLine(buildRevenueBasisAdvisoriesFor(state.assets, state.subUnits, snap.revenue), state)
    : [];
  // Option B Step 3 (2026-08-20): a sell asset with no downpayment on itself
  // and no project default to fall back on. Same NOTE treatment and the same
  // reasoning: a missing input is not a broken identity, so it must not be
  // coloured as a failed check, but it must be visible where the number is
  // read and not only where it is entered.
  const cohortAdvisories = state
    ? poolSaleCohortByLine(buildSaleCohortAdvisories(state.assets, state.project.saleCohortDefaults?.downpayment, snap.revenue), state)
    : [];
  return {
    title: 'Model Integrity Checks', kind: 'grid', align: 'data',
    columns: ['Check', 'Status', 'Residue', 'Detail'],
    rows: [
      ...checks.map((c) => row(
        [c.label, c.ok ? 'OK' : 'CHECK', fmt.money(c.residue), checkDetail(c, snap.yearLabels, fmt.money)],
        c.ok ? undefined : 'subtotal',
      )),
      ...advisories.map((a) => row(
        ['Revenue basis, ' + a.assetName, 'NOTE', fmt.money(a.collections - a.gross),
          revenueBasisAdvisoryText(a, fmt.money)],
      )),
      ...cohortAdvisories.map((a) => row(
        ['Downpayment not stated, ' + a.assetName, 'NOTE', fmt.money(a.saleValue),
          saleCohortAdvisoryText(a, fmt.money)],
      )),
    ],
  };
}

/** The formatters the shared fund builders want, from the PDF's Fmt. */
function fundFmtFrom(fmt: Fmt): FundFmt {
  return {
    money: (v: number) => fmt.money(v),
    pct: (v, d = 1) => fmt.pct(v ?? null, d),
    mult: (v) => fmt.mult(v ?? null),
  };
}

/** One piece of the PDF fund block. Exactly one of `table` / `cards` / `note`
 *  is set; `note` is a short explanatory paragraph (see fundGrossNetNote). */
interface FundBlockPiece { title: string; table: PdfTable | null; cards: PdfCard[] | null; note?: string }

function buildFundBlock(
  snap: ProjectFinancialsSnapshot,
  returns: ReturnsSnapshot | null,
  state: FinancialsResolverState,
  fmt: Fmt,
  py: number,
): FundBlockPiece[] {
  if (!returns || !isFundActive(returns)) return [];
  const yl = snap.yearLabels;
  const streamPrior = returns.streamYearLabels[0] ?? py;
  const streamYears = returns.streamYearLabels.slice(1);
  const ctx: FundReportCtx = { snap, returns, fmt: fundFmtFrom(fmt) };
  const out: FundBlockPiece[] = [];

  out.push({ title: 'Fund Returns, Gross vs Net', table: null, cards: buildFundHeadlineCards(ctx).map((c) => ({ label: c.label, value: c.value, sub: c.sub })) });
  // This block restates the headline Distributed Equity pair, split either side
  // of the performance fee. Saying so is what stops it reading as a third copy
  // of the same two numbers, which is exactly how it read when no fee arose.
  {
    const restated = fundHeadlineRestatementNote(ctx);
    if (restated) out.push({ title: 'Fund Returns, Gross vs Net', table: null, cards: null, note: restated });
  }
  out.push({
    title: 'Fund Terms Applied', cards: null,
    table: kvTable('Fund Terms Applied', buildFundTermsPairs(ctx, resolveFundTerms(state.project).fundManagerName)),
  });
  out.push({
    title: 'Distributed Equity, Gross vs Net', cards: null,
    table: {
      title: 'Distributed Equity, Gross vs Net of Performance Fee', kind: 'grid', align: 'data',
      columns: [...FUND_GROSS_NET_COLUMNS],
      rows: buildFundGrossNetRows(ctx).map((g) => row(g.cells, g.emphasis)),
    },
  });
  // Why the two rows are identical, when they are. Empty (and skipped) as soon
  // as a performance fee arises, so a cleared hurdle carries no stray note.
  {
    const note = fundGrossNetNote(ctx);
    if (note) out.push({ title: 'Gross vs Net', table: null, cards: null, note });
  }
  // The waterfall is a stream-basis period table: index 0 is the inception
  // period, which is why it uses the stream year labels and not the axis ones.
  out.push({
    title: 'Distribution Waterfall', cards: null,
    table: m4RowsToPeriodTable(`Distribution Waterfall (hold to ${returns.exitYearLabel})`, streamPrior, streamYears, buildFundWaterfallRows(ctx)),
  });
  // Which rows in that Total column are lifetime flows and which are balances.
  // Without it, Hurdle Paid's lifetime total sits under an untotalled Total
  // Hurdle Owed and reads as more paid than was ever owed.
  {
    const totalsNote = fundWaterfallTotalsNote(ctx);
    if (totalsNote) out.push({ title: 'Distribution Waterfall', table: null, cards: null, note: totalsNote });
  }
  if (hasFundFeeIncome(returns)) {
    out.push({
      title: 'Fund Fee Income by Earner', cards: null,
      table: {
        title: 'Fund Fee Income by Earner', kind: 'grid', align: 'data',
        columns: [...FUND_EARNER_COLUMNS],
        rows: buildFundEarnerRows(ctx).map((g) => row(g.cells, g.emphasis)),
      },
    });
    const basis = buildFundFeeBasisRows(snap);
    if (basis.length > 0) {
      // The three capital bases are their OWN table, above the fee rows. They
      // are quantities of capital, not fees, and sharing a table with the fee
      // rows left them reading as charges with Timing, Rate and Fee charged all
      // blank.
      const capital = buildFundCapitalRows(snap);
      if (capital.length > 0) {
        out.push({
          title: 'Capital Bases', cards: null,
          table: {
            title: FUND_CAPITAL_BASES_TITLE, kind: 'grid', align: 'data',
            columns: ['Capital base', 'Amount', 'How it is resolved'],
            rows: capital.map((c) => row([c.isTotal ? `= ${c.label}` : c.label, fmt.money(c.amount), c.note], c.isTotal ? 'subtotal' : undefined)),
          },
        });
        out.push({ title: 'Capital Bases', table: null, cards: null, note: FUND_CAPITAL_BASES_NOTE });
      }
      out.push({
        title: 'Fund Fee Basis', cards: null,
        table: {
          title: 'Fund Fee Basis (what each fee is charged on)', kind: 'grid', align: 'data',
          columns: ['Fee', 'Timing', 'Base', 'Rate', 'Basis charged on', 'Fee charged'],
          rows: [
          // Basis via the shared text helper: a constant base prints as the
          // CONSTANT plus its period count, never as a lifetime sum (which read
          // 36,858.3m against a 5,466.8m fund).
          ...basis.map((b) => row([b.label, b.timing, b.base, b.rate, fundFeeBasisText(b, fmt.money), fmt.money(b.charged)])),
        ],
        },
      });
    }
    out.push({
      title: 'Fee Income by Period', cards: null,
      table: m4RowsToPeriodTable('Fee Income by Period', streamPrior, streamYears, buildFundFeeIncomeRows(ctx)),
    });
  }
  void yl;
  return out;
}

/** Shared case-comparison matrix: headline KPIs across every case, each scenario
 *  showing its delta vs the base in-cell. Feeds BOTH Module 5 (Tab 3) and Module
 *  6 (Scenario Comparison) from the same shared builder. Null when there are fewer
 *  than two cases to compare. */
function buildCaseComparisonMatrix(caseReport: CaseComparisonReport, fmt: Fmt): PdfTable | null {
  if (caseReport.columns.length <= 1) return null;
  const baseCol = caseReport.columns.find((c) => c.id === caseReport.baseId) ?? caseReport.columns[0];
  const fmtVal = (v: number | null, kind: 'pct' | 'money' | 'mult'): string => {
    if (v === null || !Number.isFinite(v)) return 'n/a';
    return kind === 'pct' ? fmt.pct(v, 1) : kind === 'mult' ? fmt.mult(v) : fmt.money(v);
  };
  const fmtDelta = (v: number | null, base: number | null, kind: 'pct' | 'money' | 'mult'): string => {
    if (v === null || base === null || !Number.isFinite(v) || !Number.isFinite(base)) return '';
    const d = v - base;
    if (Math.abs(d) < 1e-9) return '0';
    const sign = d > 0 ? '+' : '';
    return kind === 'pct' ? `${sign}${(d * 100).toFixed(1)} pp` : kind === 'mult' ? `${sign}${d.toFixed(2)}x` : `${sign}${fmt.money(d)}`;
  };
  const header = ['Metric', ...caseReport.columns.map((c) => `${c.role === 'base' ? '★ ' : ''}${c.name}`)];
  const rows: PdfTableRow[] = caseReport.kpis.map((k) => {
    const cells: Array<string | number | null> = [k.sub ? `${k.label} (${k.sub})` : k.label];
    for (const col of caseReport.columns) {
      const v = col.values[k.label] ?? null;
      let s = fmtVal(v, k.kind);
      if (col.id !== caseReport.baseId) {
        const d = fmtDelta(v, baseCol.values[k.label] ?? null, k.kind);
        if (d) s += ` (${d})`;
      }
      cells.push(s);
    }
    return row(cells);
  });
  return { title: 'Case Comparison, headline KPIs (delta vs Management Case)', kind: 'grid', align: 'data', columns: header, rows };
}

// ── Executive summary ─────────────────────────────────────────────────────────
function buildExecSummary(ctx: Ctx, snap: ProjectFinancialsSnapshot, returns: ReturnsSnapshot | null, state: FinancialsResolverState, fmt: Fmt, caseReport: CaseComparisonReport | null): void {
  const p = state.project;
  const startYear = snap.projectStartYear;
  const endYear = startYear + snap.axisLength - 1;
  const fin = snap.financing;
  const assets = state.assets.filter((a) => a.visible !== false);
  // The parcels ARE the project's land, so their sum leads; the per-asset
  // fallback goes through the platform's land rule rather than the raw stored
  // field, so a project with no parcels still reads what the Assets tab shows.
  const landSqm = state.parcels.length
    ? state.parcels.reduce((s, pa) => s + (pa.area ?? 0), 0)
    : assets.reduce((s, a) => s + pdfAreaOf(a, state).land, 0);
  const byStrategy = new Map<string, number>();
  for (const a of assets) byStrategy.set(a.strategy, (byStrategy.get(a.strategy) ?? 0) + 1);
  const compStr = [...byStrategy.entries()].map(([s, n]) => `${n} ${s}`).join(', ');
  const landCost = Math.max(0, fin.capex.totals.inclAllLand - fin.capex.totals.exclAllLand);
  const totalDebtRaised = sum(fin.combined.totalDrawdown) + sum(fin.combined.totalInterestCapitalized);
  const constructionCost = fin.capex.totals.exclAllLand;
  const gdv = sum(snap.pl.totalRevenuePerPeriod);

  drawCell(ctx, 'Executive Summary', MARGIN, CONTENT_W, ctx.y - 15, { font: ctx.bold, size: 15, color: NAVY_DARK });
  ctx.y -= 22;

  const loc = [p.location, p.country].filter(Boolean).join(', ') || 'the project location';
  const narrative =
    `${p.name || 'This project'} is a ${String(p.projectType ?? 'mixed-use')} real estate development in ${loc}, ` +
    `developed on ${fmt.area(landSqm)} sqm of land across ${state.phases.length} ` +
    `${state.phases.length === 1 ? 'phase' : 'phases'}, comprising ${assets.length} ` +
    `${assets.length === 1 ? 'asset' : 'assets'}${compStr ? ` (${compStr})` : ''}. ` +
    `The model spans ${snap.axisLength} years (${startYear} to ${endYear}). ` +
    `Total development cost is ${fmt.money(fin.capex.totals.inclAllLand)} ` +
    `(${fmt.money(landCost)} land + ${fmt.money(constructionCost)} construction), funded ` +
    `with new funding drawn ${fmt.pctRaw(fin.funding.debtPct, 0)} debt / ${fmt.pctRaw(fin.funding.equityPct, 0)} equity. ` +
    `Across the whole capital structure the project draws ${fmt.money(totalDebtRaised)} of debt (incl. capitalised interest) against ` +
    `${fmt.money(fin.equity.grandTotal)} of equity (cash, in-kind and existing). ` +
    (snap.fundFees.active ? `This is a FUND project: ${fmt.money(sum(snap.fundFees.totalPerPeriod))} of fund management and other expenses are charged over the hold, and EBITDA is struck after them. ` : '') +
    `Projected gross development value is ${fmt.money(gdv)}` +
    (returns ? `, yielding a project IRR of ${fmt.pct(returns.result.fcff.irr, 1)} and an equity IRR of ${fmt.pct(returns.result.fcfe.irr, 1)}.` : '.');
  drawParagraph(ctx, narrative, 9);
  ctx.y -= 4;

  // KPI cards (incl. Dividend IRR / MOIC, Land + Construction split).
  const cards: PdfCard[] = [];
  if (returns) {
    const r = returns.result;
    for (const c of headlineReturnCards(returns, fmt)) {
      if (c.label !== 'Terminal Equity Value') cards.push(c);
    }
  }
  cards.push({ label: 'Total Dev Cost', value: fmt.money(fin.capex.totals.inclAllLand), sub: 'incl. land' });
  cards.push({ label: 'Land Cost', value: fmt.money(landCost), sub: 'land only' });
  cards.push({ label: 'Construction Cost', value: fmt.money(constructionCost), sub: 'excl. land' });
  cards.push({ label: 'Total Revenue (GDV)', value: fmt.money(gdv), sub: 'over the hold' });
  cards.push({ label: 'Peak Debt', value: fmt.money(Math.max(0, ...snap.bs.debtOutstandingPerPeriod)), sub: 'max outstanding' });
  if (snap.fundFees.active) {
    cards.push({ label: 'Fund Fees', value: fmt.money(sum(snap.fundFees.totalPerPeriod)), sub: 'over the hold, EBITDA is after' });
  }
  drawCards(ctx, 'Headline KPIs', cards);

  // Asset composition. A BUA of zero is marked and footnoted when it is
  // structural (an existing operational asset with no new build, or a companion
  // whose area sits on its parent), so it does not read as missing data beside
  // six assets reporting real areas.
  const notes = buildAssetNotes(state, fmt.money);
  drawGridTable(ctx, {
    title: 'Asset Composition', kind: 'grid', align: 'data',
    columns: ['Phase', 'Asset', 'Strategy', 'BUA (sqm)', 'Sub-units'],
    rows: assets.map((a) => {
      const ph = state.phases.find((x) => x.id === a.phaseId);
      const su = state.subUnits.filter((u) => u.assetId === a.id);
      const bua = pdfAreaOf(a, state).bua;
      const z = notes.hasBuaNote(a.id, bua);
      return row([ph?.name ?? '-', a.name, a.strategy, z ? structuralZeroCell(z) : fmt.area(bua), fmt.int(su.length)]);
    }),
  }, fmt);
  for (const fn of notes.takeFootnotes()) drawParagraph(ctx, fn.text, 7.5);

  // Financial structure as two columns (key/value pairs side by side) so the
  // Executive Summary stays on a single page.
  drawGridTable(ctx, kv2Table('Financial Structure', [
    ['Funding method', FUNDING_METHOD_LABELS[(p.financing?.fundingMethod ?? 1) as FundingMethodId]],
    ['Debt / Equity split', `${fmt.pctRaw(fin.funding.debtPct, 0)} / ${fmt.pctRaw(fin.funding.equityPct, 0)}`],
    // Total new debt RAISED = cash drawdown + interest capitalised to the loan.
    // The same definition Module 5's Sources & Uses uses, and the only one that
    // reconciles: existing debt + this = peak debt outstanding. The cash-only
    // drawdown (which this row used to print) is a different, smaller number and
    // reading it beside a Sources & Uses figure under the same name was the
    // contradiction. The FCFE build-up keeps the cash-only figure, labelled as
    // such, because capitalised interest is not a cash flow.
    ['Total new debt (incl. capitalised interest)',
      fmt.money(sum(snap.financing.combined.totalDrawdown) + sum(snap.financing.combined.totalInterestCapitalized))],
    ['Total equity (cash + in-kind + existing)', fmt.money(fin.equity.grandTotal)],
    ['Minimum cash reserve', fmt.money(p.financing?.minimumCashReserve ?? fin.funding.minCashReserve ?? 0)],
  ]), fmt);

  // Scenario summary (high level): headline outcomes per case, so the executive
  // reader sees the range across scenarios at a glance. Only when scenario cases
  // exist beyond the Management base (extends the summary past one page then). The
  // detailed scenario matrix + year-on-year impact live in Module 6.
  if (caseReport && caseReport.columns.length > 1) {
    const scenarioCount = caseReport.columns.filter((c) => c.role !== 'base').length;
    const pick = ['Equity IRR (FCFE)', 'Project IRR (FCFF)', 'NPV (FCFF)', 'Development Margin'];
    const kpis = caseReport.kpis.filter((k) => pick.includes(k.label));
    const fmtVal = (v: number | null, kind: 'pct' | 'money' | 'mult'): string =>
      v === null || !Number.isFinite(v) ? 'n/a' : kind === 'pct' ? fmt.pct(v, 1) : kind === 'mult' ? fmt.mult(v) : fmt.money(v);
    ctx.y -= 4;
    drawParagraph(ctx, `${scenarioCount} scenario ${scenarioCount === 1 ? 'case is' : 'cases are'} modeled alongside the Management Case. Headline outcomes by case:`, 9);
    drawGridTable(ctx, {
      title: 'Scenario Summary', kind: 'grid', align: 'data',
      columns: ['Case', ...kpis.map((k) => k.label)],
      rows: caseReport.columns.map((c) => row(
        [`${c.role === 'base' ? '★ ' : ''}${c.name}`, ...kpis.map((k) => fmtVal(c.values[k.label] ?? null, k.kind))],
        c.role === 'base' ? 'subtotal' : undefined,
      )),
    }, fmt);
  }
}

// ── Module 1: Setup, Assets, Capex and Financing ────────────────────────────
//
// THE REPORT PRINTS THE PLATFORM'S SEVEN TABS, IN THEIR ORDER AND WORDS
// (2026-09-21). Module 1 printed four tabs of its own design: Parties and Asset
// Types & Standards were missing altogether (the PDF already ACCEPTED a
// `parties` option and never printed it), the fund terms sat inside Project
// Setup and vanished entirely with the layer off, the assets tab was two
// tables where the screen has five, the capex tables were unnumbered and in
// another order than the screen's six, and Financing printed Funding Gap
// before Schedules, which is not the screen's order either.
//
// The workbook was rebuilt against these same screens on 2026-09-17 through
// `_shared/assetInputsView.ts` (the ONE reading of tabs 4 and 5: standards,
// plot entry, the chain per plot and per line, the land per asset and the
// sub-units), `reports/partiesReport.ts`, `fundTerms.ts` (the registry the
// screen itself renders from), `reports/fundingBasis.ts`, `capexReports.ts`
// and `financingReports.ts`. This section reads the SAME builders, so the two
// exports cannot re-word or re-order a table, and nothing here computes a
// model value.
const M1_TABS = {
  project: 'Tab 1: Project & Phases',
  parties: 'Tab 2: Parties',
  fund: 'Tab 3: Fund Terms',
  standards: 'Tab 4: Asset Types & Standards',
  assets: 'Tab 5: Assets & Sub-units',
  capex: 'Tab 6: Capex',
  finInputs: 'Tab 7: Financing / Inputs',
  finSchedules: 'Tab 7: Financing / Schedules',
  finGap: 'Tab 7: Financing / Funding Gap',
  finSweep: 'Tab 7: Financing / Cash Sweep',
} as const;

/** The twenty derived-area columns of Assets tables 3 and 4, split in two so
 *  each half is readable on a landscape page. The names and the order are the
 *  workbook's `CHAIN_HEADS`, which are the screen's own column headings. */
const CHAIN_AREA_HEADS = [
  'Plot Area', 'Net Developable', 'Footprint', 'Landscape %', 'Landscape Area',
  'Retail GFA', 'Lobby GFA', 'Total GFA', 'Main Asset GFA', 'NSA or GLA',
];
const CHAIN_UNIT_HEADS = [
  'Unit Size', 'Units or Keys', 'Parking Ratio', 'Slots', 'Retail Slots', 'Total Slots',
  'Parking Area', 'Retail Parking', 'Total Parking', 'Total BUA',
];
/** Said once under each chain table, so the columns can carry the figure. */
const CHAIN_UNITS_NOTE = 'All areas in sqm. Net developable is the plot after utilisation; landscape is a share of it; total GFA is the utilised land at the FAR; the main asset GFA is what is left after retail, lobby and service.';

/** A dash, never a zero: a step the chain could not derive has no value. */
type ChainCells = Record<string, number | undefined>;
function chainAreaCells(
  fmt: Fmt, landSqm: number, g: ChainCells, landscapePct: number | undefined,
): string[] {
  const a = (v: number | undefined): string => (v === undefined ? '-' : fmt.area(v));
  return [
    a(landSqm), a(g.landUtilisedSqm), a(g.footprintSqm),
    landscapePct === undefined ? '-' : fmt.pctRaw(landscapePct, 2),
    a(g.landscapeSqm), a(g.retailGfaSqm), a(g.lobbyGfaSqm), a(g.totalGfaSqm), a(g.mainAssetGfaSqm),
    a(g.netSaleableSqm),
  ];
}
function chainUnitCells(
  fmt: Fmt, g: ChainCells, unitSize: number | undefined, slotRatio: number | undefined,
): string[] {
  const a = (v: number | undefined): string => (v === undefined ? '-' : fmt.area(v));
  const n = (v: number | undefined): string => (v === undefined ? '-' : fmt.int(v));
  return [
    unitSize === undefined ? '-' : fmt.int(unitSize), n(g.units),
    slotRatio === undefined ? '-' : String(slotRatio), n(g.parkingSlots), n(g.retailParkingSlots),
    n(g.totalParkingSlots), a(g.parkingAreaSqm), a(g.retailParkingAreaSqm), a(g.totalParkingAreaSqm),
    a(g.totalBuaSqm),
  ];
}

/** The pooled totals rule states its landscape share as a QUOTIENT of the
 *  row's own sums, where the chain states its own as a percent. One column,
 *  so the quotient is converted once, here. */
const pooledLandscapePct = (v: number | undefined): number | undefined => (v === undefined ? undefined : v * 100);

/** A view cell as the screen shows it: the figure, with what it came from when
 *  the user did not type it (inherited from the type, derived from a share). */
function viewText(c: ViewCell, fmtValue: (v: number) => string): string {
  if (c.value === undefined) return c.note ? SHORT_NOTES[c.note] ?? c.note : '-';
  const s = fmtValue(c.value);
  return c.typed || !c.note ? s : `${s} ${SHORT_NOTES[c.note] ?? `(${c.note})`}`;
}
/** A cell has room for a mark, not for a sentence: the sentence is said under
 *  the table instead. The view model's own wording is the key, so a new note
 *  falls through as itself rather than silently losing its meaning. */
const SHORT_NOTES: Record<string, string> = {
  'from the type': '(type)',
  'blank, draws the whole plot': '(whole plot)',
};

function buildModule1(
  snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: Fmt, py: number,
  parties?: readonly Party[],
): ModuleContent {
  const p = state.project;
  const fin = snap.financing;
  const yl = snap.yearLabels;
  const cur = p.currency ?? 'SAR';
  const items: ModuleContent = [];
  const assetNotes = buildAssetNotes(state, fmt.money);
  const multiPhase = state.phases.length > 1;
  const viewState: InputsViewState = {
    project: p, phases: state.phases, parcels: state.parcels, assets: state.assets,
    subUnits: state.subUnits, costLines: state.costLines, landAllocationMode: state.landAllocationMode,
  };

  // ── TAB 1: PROJECT & PHASES ───────────────────────────────────────────────
  items.push(tTable(M1_TABS.project, 'inputs', kvTable('Project', [
    ['Project Name', p.name || '(unnamed)'],
    ['Currency', cur],
    ['Project Start Date', p.startDate ?? '-'],
    ['Project Status', String(p.status ?? 'draft')],
    ['Location', p.location || '-'],
    ['Country', p.country ? countryLabel(p.country) : 'Not set'],
    ['Model axis start year (derived)', String(snap.projectStartYear)],
  ])));
  // ONE PHASES TABLE, the screen's: what is typed (start, the two lengths, the
  // status) beside the windows the platform derives from them. The report used
  // to print these as two tables, one of them called "Timeline", which is a
  // workbook tab and not a Module 1 table.
  {
    const pt = computeProjectTimeline(p, state.phases);
    items.push(tTable(M1_TABS.project, 'inputs', {
      title: 'Phases', kind: 'grid', align: 'data',
      columns: ['Phase Name', 'Phase Start Date', 'Construction (years)', 'Operations (years)',
        'Construction End', 'Operations Start', 'Operations End', 'Status'],
      rows: [
        ...state.phases.map((ph) => {
          const t = computePhaseTimeline(ph, p);
          return row([
            ph.name,
            ph.startDate && ph.startDate.length === 10 ? ph.startDate : (p.startDate ?? '-'),
            fmt.int(ph.constructionPeriods ?? 0), fmt.int(ph.operationsPeriods ?? 0),
            (ph.constructionPeriods ?? 0) === 0 ? 'Operational from start' : t.constructionEnd,
            t.operationsStart, t.operationsEnd,
            PHASE_STATUS_LABELS[(ph.status ?? 'planning') as keyof typeof PHASE_STATUS_LABELS] ?? String(ph.status),
          ]);
        }),
        row(['Project envelope', pt.start, '', '', '', '', pt.end, `${pt.spanPeriods} periods`], 'total'),
      ],
    }));
  }
  // Existing Operations (historical baseline), from the engine's own
  // existing-operations aggregate, never the deprecated phase fields.
  {
    const ex = fin.existing;
    const opPhases = state.phases.filter((ph) => ph.status === 'operational');
    const metricDefs: Array<[string, (ph: typeof opPhases[number]) => number]> = [
      ['Pre-capex incurred (Land + Building)', (ph) => ex.preCapexByPhase.get(ph.id) ?? 0],
      ['Existing equity contributed', (ph) => ex.equityByPhase.get(ph.id) ?? 0],
      ['Existing debt outstanding', (ph) => ex.debtByPhase.get(ph.id) ?? 0],
      ['Net book value (fixed assets)', (ph) => ph.historicalBaseline?.netBookValueFixedAssets ?? 0],
      ['Opening cash', (ph) => ph.historicalBaseline?.historicalOpeningCash ?? 0],
    ];
    const baselineRows = metricDefs.map(([label, pick]) => ({ label, vals: opPhases.map(pick) }));
    if (opPhases.length && baselineRows.some((r) => r.vals.some((v) => v !== 0))) {
      items.push(tTable(M1_TABS.project, 'inputs', {
        title: 'Existing Operations (historical baseline)', kind: 'grid', align: 'data',
        columns: ['Metric', ...opPhases.map((ph) => ph.name), 'Total'],
        rows: baselineRows.map((r) => row([r.label, ...r.vals.map((v) => fmt.money(v)), fmt.money(r.vals.reduce((s, v) => s + v, 0))])),
      }));
    }
  }

  // ── TAB 2: PARTIES ────────────────────────────────────────────────────────
  // Parties live outside the version snapshot (their own table), so the caller
  // hands them in; ONE builder with the workbook. The engine never reads them.
  {
    const pt = buildPartiesTable(parties);
    items.push(tTable(M1_TABS.parties, 'inputs', {
      title: PARTIES_TITLE, kind: 'grid', align: 'data',
      columns: pt.columns,
      rows: pt.rows.map((r) => row(r)),
    }));
    if (pt.rows.length === 0) {
      items.push(tItem(M1_TABS.parties, 'inputs', { type: 'paragraph', text: PARTIES_EMPTY_TEXT }));
    }
    items.push(tItem(M1_TABS.parties, 'inputs', {
      type: 'paragraph',
      text: 'Identity only: parties name who is related to the project and are used in no calculation. On a fund project, the Fund Terms tab shares its earner rows with this list.',
    }));
  }

  // ── TAB 3: FUND TERMS ─────────────────────────────────────────────────────
  // THE TAB EXISTS ON EVERY PROJECT. With the layer off the screen shows the
  // toggle and nothing else, so the report says exactly that rather than
  // printing nothing at all (which reads as a missing section).
  {
    const ft = resolveFundTerms(p);
    if (!ft.enabled) {
      items.push(tTable(M1_TABS.fund, 'inputs', kvTable('Fund terms', [
        ['Fund layer enabled', 'No'],
      ])));
      items.push(tItem(M1_TABS.fund, 'inputs', {
        type: 'paragraph',
        text: 'Off: the project is modelled with no fund layer, so it carries no management fee, no preferred return and no performance fee. Turning the layer on adds all three.',
      }));
    } else {
      // The five management fees, from the SAME registry the screen renders:
      // label, when it is charged and what it is charged on all come from
      // FUND_FEE_SPECS, so a fee added there appears here with no edit.
      const rateOf = (spec: typeof FUND_FEE_SPECS[number]): string => {
        const v = ft[spec.key] as number;
        return spec.kind === 'amount' ? `${fmt.money(v)} per annum` : fmt.pctRaw(v, 2);
      };
      items.push(tTable(M1_TABS.fund, 'inputs', {
        title: 'Fund management fees', kind: 'grid', align: 'data',
        columns: ['Fee', 'When', 'Charged on', 'Rate'],
        rows: FUND_FEE_SPECS.map((spec) => row([
          spec.label, FEE_TIMING_LABELS[spec.timing], FEE_BASE_LABELS[spec.base], rateOf(spec),
        ])),
      }));
      items.push(tTable(M1_TABS.fund, 'inputs', kvTable('Fund structure, fee bases and the performance fee', [
        ['Fund layer enabled', 'Yes'],
        ['Fund Manager', ft.fundManagerName || DEFAULT_FUND_MANAGER_NAME],
        ['Hurdle rate (preferred return)', fmt.pctRaw(ft.hurdleRatePct, 2)],
        ['Performance fee on the excess', fmt.pctRaw(ft.performanceFeePct, 2)],
        ['Fund size', ft.fundSizeOverride ? `${fmt.money(ft.fundSize)} (typed target)` : `${fmt.money(ft.fundSize)} (resolved from the model: total equity plus the debt facility)`],
        ['Facility limit', ft.facilityLimitOverride ? `${fmt.money(ft.facilityLimit)} (typed limit)` : `${fmt.money(ft.facilityLimit)} (resolved from the model)`],
        ['How the management fee is funded', ft.managementFeeFunding === 'equity'
          ? '100% equity (its own dedicated equity draw, outside the debt / equity ratio)'
          : 'Cash deficit funding (inside the requirement, at the project debt / equity ratio)'],
      ])));
      // The resolved bases, through the one builder every fund surface reads.
      const capRows = buildFundCapitalRows(snap);
      if (capRows.length) {
        items.push(tTable(M1_TABS.fund, 'inputs', {
          title: FUND_CAPITAL_BASES_TITLE, kind: 'grid', align: 'data',
          columns: ['Base', 'Amount', 'How it is resolved'],
          rows: capRows.map((cr) => row(
            [cr.isTotal ? `= ${cr.label}` : cr.label, fmt.money(cr.amount), cr.note],
            cr.isTotal ? 'total' : undefined,
          )),
        }));
        items.push(tItem(M1_TABS.fund, 'inputs', { type: 'paragraph', text: FUND_CAPITAL_BASES_NOTE }));
      }
      // The distribution matrix, in the screen's columns, with the screen's
      // total row. SHARES ARE NEVER NORMALISED, so the total is stated as it
      // falls and a column that does not reach 100% says so.
      const matrix = ft.feeDistribution ?? [];
      if (matrix.length) {
        const colTotal = (pick: (d: typeof matrix[number]) => number | undefined): number =>
          matrix.reduce((s, d) => s + (pick(d) ?? 0), 0);
        const totalCell = (v: number): string => `${fmt.pctRaw(v, 2)}${Math.abs(v - 100) < 0.01 ? '' : ' (not 100%)'}`;
        items.push(tTable(M1_TABS.fund, 'inputs', {
          title: 'Fee distribution (shares are not normalised)', kind: 'grid', align: 'data',
          columns: ['Earns', 'Performance Fee', 'Developer Fee', 'Commission'],
          rows: [
            ...matrix.map((d) => row([
              isFundManagerRow(d) ? `${d.partyName || DEFAULT_FUND_MANAGER_NAME} (fund manager, also earns 100% of the management fees)` : (d.partyName ?? d.partyId),
              fmt.pctRaw(d.performanceFeePct ?? 0, 2), fmt.pctRaw(d.developerFeePct ?? 0, 2), fmt.pctRaw(d.commissionPct ?? 0, 2),
            ])),
            row(['Total', totalCell(colTotal((d) => d.performanceFeePct)),
              totalCell(colTotal((d) => d.developerFeePct)), totalCell(colTotal((d) => d.commissionPct))], 'total'),
          ],
        }));
      }
    }
  }

  // ── TAB 4: ASSET TYPES & STANDARDS ────────────────────────────────────────
  {
    const v = buildStandardsView(viewState);
    if (v.types.length === 0) {
      items.push(tItem(M1_TABS.standards, 'inputs', { type: 'paragraph', text: 'No asset types in this project.' }));
    } else {
      const cell = (n: number | undefined, f: (x: number) => string): string => (n === undefined ? '' : f(n));
      items.push(tTable(M1_TABS.standards, 'inputs', {
        title: 'Asset types and values', kind: 'grid', align: 'data',
        columns: ['Asset type', 'Category', 'Strategy for new assets', 'Avg unit size (sqm)', 'Parking ratio',
          'Ratio basis', 'Utilisation %', 'Coverage %', 'FAR', 'Service %'],
        rows: v.types.map((t) => row([
          t.label, t.category || '-', t.strategy ?? '',
          cell(t.unitSizeSqm, (x) => fmt.int(x)), cell(t.ratio, (x) => String(x)),
          t.ratioBasis ?? t.ratioBasisDefault,
          cell(t.utilisationPct, (x) => fmt.pctRaw(x, 2)), cell(t.coveragePct, (x) => fmt.pctRaw(x, 2)),
          cell(t.far, (x) => String(x)), cell(t.servicePct, (x) => fmt.pctRaw(x, 2)),
        ])),
      }));
      items.push(tItem(M1_TABS.standards, 'inputs', {
        type: 'paragraph',
        text: 'A blank value is not set, never zero. Utilisation, coverage, FAR and service are defaults a plot inherits where it states none on Table 2 of the assets tab.',
      }));
    }
    items.push(tTable(M1_TABS.standards, 'inputs', kvTable('Parking and cost escalation', [
      ['Parking area per slot (sqm) for this project', v.slotAreaSqm === undefined ? 'Not set' : fmt.int(v.slotAreaSqm)],
      [`Construction cost escalation (% a year, from ${v.baseYear})`,
        v.escalationPct === undefined ? 'Not set: rates are not escalated.' : fmt.pctRaw(v.escalationPct, 2)],
    ])));
    const phaseText = (r: CostStandardView): string => (multiPhase && r.byPhase.length > 0
      ? r.byPhase.map((b) => `${b.phaseName} ${r.isPercent ? `${b.rate}%` : b.rate.toLocaleString('en-US')}`).join('; ')
      : '');
    const rateText = (r: CostStandardView): string =>
      (r.rate === undefined ? '' : r.isPercent ? fmt.pctRaw(r.rate, 2) : fmt.int(r.rate));
    const priceText = (pr: { value?: number; unit: string } | null | undefined): string => {
      if (pr === null) return '-';
      if (pr === undefined) return '';
      return `${pr.value === undefined ? '' : fmt.int(pr.value)}${pr.value === undefined ? pr.unit : ` ${pr.unit}`}${cur ? ` (${cur})` : ''}`;
    };
    if (v.construction.length) {
      items.push(tTable(M1_TABS.standards, 'inputs', {
        title: 'Cost standards: construction cost, sale price and ADR', kind: 'grid', align: 'data',
        columns: ['Item', 'Applies to', 'Basis', `Rate (${v.baseYear} money)`,
          ...(multiPhase ? ['By phase'] : []), 'Price per unit', 'Price per sqm'],
        rows: v.construction.map((r) => row([
          r.label, r.appliesTo, r.basis, rateText(r),
          ...(multiPhase ? [phaseText(r)] : []),
          priceText(r.pricePerUnit), priceText(r.pricePerSqm),
        ])),
      }));
    }
    if (v.soft.length) {
      items.push(tTable(M1_TABS.standards, 'inputs', {
        title: 'Cost standards: soft costs', kind: 'grid', align: 'data',
        columns: ['Item', 'Basis', `Rate (${v.baseYear} money)`, ...(multiPhase ? ['By phase'] : [])],
        rows: v.soft.map((r) => row([r.label, r.basis, rateText(r), ...(multiPhase ? [phaseText(r)] : [])])),
      }));
    }
    if (v.construction.length || v.soft.length) {
      items.push(tItem(M1_TABS.standards, 'inputs', {
        type: 'paragraph',
        text: 'Defaults only: a rate typed on a Capex phase line wins, a phase rate here wins over the row rate in that phase, and a type price applies to every Table 5 row of that type with no price of its own.',
      }));
    }
  }

  // ── TAB 5: ASSETS & SUB-UNITS (the screen's five tables) ──────────────────
  const areaTables = buildAssetAreaTables(viewState);
  // Table 1: the plots.
  if (state.parcels.length) {
    let area = 0; let value = 0; let cash = 0; let inKind = 0;
    const rows = state.parcels.map((pa) => {
      const a = Math.max(0, pa.area ?? 0); const rate = Math.max(0, pa.rate ?? 0);
      const lv = a * rate;
      const cv = lv * (Math.max(0, pa.cashPct ?? 0) / 100);
      const iv = lv * (Math.max(0, pa.inKindPct ?? 0) / 100);
      area += a; value += lv; cash += cv; inKind += iv;
      return row([pa.name, state.phases.find((ph) => ph.id === pa.phaseId)?.name ?? '-', fmt.area(a),
        fmt.int(rate), fmt.pctRaw(pa.cashPct ?? 0, 0), fmt.pctRaw(pa.inKindPct ?? 0, 0),
        fmt.money(lv), fmt.money(cv), fmt.money(iv)]);
    });
    rows.push(row(['Totals', '', fmt.area(area), fmt.int(area > 0 ? value / area : 0), '', '',
      fmt.money(value), fmt.money(cash), fmt.money(inKind)], 'total'));
    items.push(tTable(M1_TABS.assets, 'inputs', {
      title: 'Table 1 - Plots, the land', kind: 'grid', align: 'data',
      columns: ['Plot', 'Phase', 'Area (sqm)', `${cur}/sqm`, 'Cash %', 'In-Kind %', 'Land Value', 'Cash Value', 'In-Kind Value'],
      rows,
    }));
    items.push(tItem(M1_TABS.assets, 'inputs', {
      type: 'paragraph',
      text: 'Land is allocated by sqm only: each asset draws from its plot on Table 2. The debt / equity split of the land cash is on the Financing tab (Land Funding).',
    }));
  }
  // Table 2: what you enter, per plot.
  {
    const rows: PdfTableRow[] = [];
    let inherited = false; let whole = false;
    for (const g of areaTables.plots) {
      rows.push(row([`${g.plotLabel}${g.phaseName ? `, ${g.phaseName}` : ''}. ${g.check}`, '', '', '', '', '', '', '', ''], 'heading'));
      if (g.entries.length === 0) { rows.push(row(['No assets drawing from this plot yet.', '', '', '', '', '', '', '', ''])); continue; }
      for (const e of g.entries) {
        if ([e.utilisationPct, e.coveragePct, e.far, e.servicePct].some((x) => x.note === 'from the type')) inherited = true;
        if (e.plotAreaSqm.note) whole = true;
        rows.push(row([
          e.typeLabel, e.strategy,
          viewText(e.plotAreaSqm, (x) => fmt.area(x)),
          viewText(e.utilisationPct, (x) => fmt.pctRaw(x, 2)),
          viewText(e.coveragePct, (x) => fmt.pctRaw(x, 2)),
          viewText(e.far, (x) => String(x)),
          viewText(e.maxFloors, (x) => fmt.int(x)),
          viewText(e.retailPct, (x) => fmt.pctRaw(x, 2)),
          viewText(e.servicePct, (x) => fmt.pctRaw(x, 2)),
        ]));
      }
    }
    if (rows.length) {
      items.push(tItem(M1_TABS.assets, 'inputs', {
        type: 'paragraph',
        text: 'Utilisation is the screen\'s Land Utilisation %, Coverage its Ground Coverage %, and Retail % the ground-floor retail share.',
      }));
      items.push(tTable(M1_TABS.assets, 'inputs', {
        title: 'Table 2 - Assets by plot, what you enter', kind: 'grid', align: 'data',
        columns: ['Type', 'Strategy', 'Plot Area (sqm)', 'Utilisation %', 'Coverage %', 'FAR',
          'Max Floors', 'Retail %', 'Service %'],
        rows,
      }));
      if (inherited) {
        items.push(tItem(M1_TABS.assets, 'inputs', {
          type: 'paragraph',
          text: 'A figure marked "from the type" is inherited from the asset type on Asset Types & Standards; the plot states none of its own.',
        }));
      }
      if (whole) {
        items.push(tItem(M1_TABS.assets, 'inputs', {
          type: 'paragraph',
          text: 'A Plot Area shown as "blank, draws the whole plot" is a blank on the platform: the asset takes the whole plot.',
        }));
      }
      if (areaTables.companions.length > 0) {
        items.push(tItem(M1_TABS.assets, 'inputs', {
          type: 'paragraph',
          text: `Ground-floor retail strips (${areaTables.companions.map((x) => x.name).join('; ')}) are derived from the retail share above, not typed: their areas and the land they carve from their hosts are on Tables 3 and 4.`,
        }));
      }
    }
  }
  // Tables 3 and 4: the chain per plot, then the same rows merged by line. Each
  // is split into an AREA half and a UNITS AND PARKING half so the twenty
  // columns the screen scrolls through stay readable on a landscape page.
  {
    const areaRows: PdfTableRow[] = [];
    const unitRows: PdfTableRow[] = [];
    for (const g of areaTables.plots) {
      const head = `${g.plotLabel}${g.phaseName ? `, ${g.phaseName}` : ''}`;
      areaRows.push(row([head, ...CHAIN_AREA_HEADS.map(() => '')], 'heading'));
      unitRows.push(row([head, ...CHAIN_UNIT_HEADS.map(() => '')], 'heading'));
      for (const r of g.chains) {
        const ch = r.chain as unknown as ChainCells;
        areaRows.push(row([r.label, ...chainAreaCells(fmt, r.landSqm, ch, r.chain.landscapePct)]));
        unitRows.push(row([r.label, ...chainUnitCells(fmt, ch, r.unitSizeSqm, r.ratio)]));
      }
      for (const piece of g.retailPieces) {
        areaRows.push(row([`${piece.name} (carved from its hosts)`, fmt.area(piece.sqm),
          ...CHAIN_AREA_HEADS.slice(1).map(() => '-')]));
      }
    }
    const pt = areaTables.plotTotal;
    areaRows.push(row(['TOTAL, all plots', ...chainAreaCells(fmt, pt.landSqm, pt.pooled, pooledLandscapePct(pt.landscapePct))], 'total'));
    unitRows.push(row(['TOTAL, all plots', ...chainUnitCells(fmt, pt.pooled, pt.avgUnitSize, pt.slotsPerUnit)], 'total'));
    items.push(tTable(M1_TABS.assets, 'inputs', {
      title: 'Table 3 - Derived areas by plot (land x utilisation x coverage / FAR)', kind: 'grid', align: 'data',
      columns: ['Asset', ...CHAIN_AREA_HEADS], rows: areaRows,
    }));
    items.push(tItem(M1_TABS.assets, 'inputs', { type: 'paragraph', text: CHAIN_UNITS_NOTE }));
    items.push(tTable(M1_TABS.assets, 'inputs', {
      title: 'Table 3 - Derived units and parking by plot', kind: 'grid', align: 'data',
      columns: ['Asset', ...CHAIN_UNIT_HEADS], rows: unitRows,
    }));
    items.push(tItem(M1_TABS.assets, 'inputs', {
      type: 'paragraph',
      text: `Plots hold ${fmt.area(areaTables.parcelsTotalSqm)} sqm; the Plot Area column totals ${fmt.area(pt.landSqm)} sqm including the land the retail strips carved from their hosts. A dash means a step could not be derived, which is not zero.`,
    }));

    const lineAreaRows: PdfTableRow[] = [];
    const lineUnitRows: PdfTableRow[] = [];
    for (const l of areaTables.lines) {
      const head = [l.typeLabel, l.phaseName, l.strategy, fmt.int(l.plots)];
      lineAreaRows.push(row([...head, ...chainAreaCells(fmt, l.landSqm, l.pooled, pooledLandscapePct(l.landscapePct))]));
      lineUnitRows.push(row([...head, ...chainUnitCells(fmt, l.pooled, l.avgUnitSize, l.slotsPerUnit)]));
    }
    for (const s of areaTables.companions) {
      const g: ChainCells = {
        retailGfaSqm: s.retailGfaSqm, totalGfaSqm: s.retailGfaSqm, netSaleableSqm: s.retailGfaSqm,
        retailParkingSlots: s.slots, retailParkingAreaSqm: s.parkingAreaSqm,
        totalParkingAreaSqm: s.parkingAreaSqm, totalBuaSqm: s.totalBuaSqm,
      };
      const head = [s.name, s.phaseName, s.strategy, fmt.int(s.hosts)];
      lineAreaRows.push(row([...head, ...chainAreaCells(fmt, s.landSqm, g, undefined)]));
      lineUnitRows.push(row([...head, ...chainUnitCells(fmt, g, undefined, undefined)]));
    }
    const lt = areaTables.lineTotal;
    lineAreaRows.push(row(['TOTAL, all lines', '', '', '', ...chainAreaCells(fmt, lt.landSqm, lt.pooled, pooledLandscapePct(lt.landscapePct))], 'total'));
    lineUnitRows.push(row(['TOTAL, all lines', '', '', '', ...chainUnitCells(fmt, lt.pooled, lt.avgUnitSize, lt.slotsPerUnit)], 'total'));
    const lineHead = ['Type', 'Phase', 'Strategy', 'Plots'];
    items.push(tTable(M1_TABS.assets, 'inputs', {
      title: 'Table 4 - Merged by line, derived areas', kind: 'grid', align: 'data',
      columns: [...lineHead, ...CHAIN_AREA_HEADS], rows: lineAreaRows,
    }));
    items.push(tTable(M1_TABS.assets, 'inputs', {
      title: 'Table 4 - Merged by line, units and parking', kind: 'grid', align: 'data',
      columns: [...lineHead, ...CHAIN_UNIT_HEADS], rows: lineUnitRows,
    }));
    if (areaTables.companions.length > 0) {
      items.push(tItem(M1_TABS.assets, 'inputs', {
        type: 'paragraph',
        text: 'Retail companions are held on Lease. Their floor area is already inside the Retail GFA above and their land is the land their hosts gave up, so nothing is counted twice. The two tables group the same rows differently, so their totals must agree.',
      }));
    }
  }
  // Table 5: the sub-units under the merged line.
  {
    const lines = buildSubUnitLines(viewState);
    for (const line of lines) {
      items.push(tTable(M1_TABS.assets, 'inputs', {
        title: `Table 5 - Sub-units, ${line.title}`, kind: 'grid', align: 'data',
        columns: ['Sub-unit', 'Category', 'NSA Share %', 'Area (sqm)', 'Unit Size (sqm)',
          'Units or Keys', `Unit price / ADR ${rateUnit(cur)}`, 'Rate Basis', 'Rate, other basis'],
        rows: [
          ...line.rows.map((u) => row([
            u.plot ? `${u.name} (${u.plot})` : u.name, u.category,
            viewText(u.sharePct, (x) => fmt.pctRaw(x, 2)),
            viewText(u.areaSqm, (x) => fmt.area(x)),
            u.unitSizeSqm === undefined ? '' : fmt.int(u.unitSizeSqm),
            viewText(u.units, (x) => fmt.int(x)),
            fmt.int(u.rate), u.rateBasis,
            u.otherRate
              ? `${u.otherRate.value === undefined ? '' : fmt.int(u.otherRate.value)} ${u.otherRate.basis}`.trim()
              : (u.otherNote ?? ''),
          ])),
          row([line.title === 'Not on a line' ? 'Total, not on a line' : 'Line total', '',
            line.nsaSqm > 0 ? fmt.pctRaw((line.areaSqm / line.nsaSqm) * 100, 2) : '',
            fmt.area(line.areaSqm), '', '', '', '', ''], 'total'),
        ],
      }));
      items.push(tItem(M1_TABS.assets, 'inputs', { type: 'paragraph', text: line.check }));
    }
    if (lines.length) {
      items.push(tItem(M1_TABS.assets, 'inputs', {
        type: 'paragraph',
        text: 'Share and area are one pair: whichever the user typed is the statement and the other follows the line\'s NSA. In count mode the count is typed and the area follows.',
      }));
    }
  }
  // Land by asset: what Capex charges and the Balance Sheet holds, filed under
  // the capex category rule, through the same view the workbook reads.
  {
    const land = buildAssetLandView(viewState);
    if (land.length) {
      const rows: PdfTableRow[] = [];
      const tot = { sqm: 0, value: 0, cash: 0, inKind: 0 };
      for (const cat of CAPEX_CATEGORIES) {
        const mine = land.filter((l) => l.category === cat);
        if (!mine.length) continue;
        rows.push(row([cat, '', '', '', '', ''], 'heading'));
        const sub = { sqm: 0, value: 0, cash: 0, inKind: 0 };
        for (const l of mine) {
          rows.push(row([l.name, fmt.area(l.landSqm), fmt.int(l.landRate),
            fmt.money(l.landValue), fmt.money(l.cashLandValue), fmt.money(l.inKindLandValue)]));
          sub.sqm += l.landSqm; sub.value += l.landValue; sub.cash += l.cashLandValue; sub.inKind += l.inKindLandValue;
        }
        rows.push(row([`Total ${cat}`, fmt.area(sub.sqm), '', fmt.money(sub.value), fmt.money(sub.cash), fmt.money(sub.inKind)], 'subtotal'));
        tot.sqm += sub.sqm; tot.value += sub.value; tot.cash += sub.cash; tot.inKind += sub.inKind;
      }
      rows.push(row(['TOTAL, all assets', fmt.area(tot.sqm), '', fmt.money(tot.value), fmt.money(tot.cash), fmt.money(tot.inKind)], 'total'));
      items.push(tTable(M1_TABS.assets, 'inputs', {
        title: 'Land by asset (what Capex charges and the Balance Sheet holds)', kind: 'grid', align: 'data',
        columns: ['Asset', 'Land (sqm)', `Land rate ${rateUnit(cur, 'sqm')}`, 'Land value', 'Cash land', 'In-kind land'],
        rows,
      }));
      // The nil built-up area block, as the workbook's Land & Area sheet has
      // it: which asset reports no area and WHY, so a zero is never read as a
      // missing input.
      const nil = land
        .map((l) => ({ name: l.name, z: assetNotes.hasBuaNote(l.assetId, l.builtAreaSqm) }))
        .filter((x): x is { name: string; z: AssetStructuralZero } => x.z !== null);
      if (nil.length) {
        // THE REASON IS A SENTENCE, SO IT IS A FOOTNOTE, NOT A COLUMN. Put in
        // a cell it was ellipsised at about a third of its length, which is a
        // note that explains nothing.
        items.push(tTable(M1_TABS.assets, 'inputs', {
          title: 'Assets reporting nil built-up area (and why)', kind: 'grid', align: 'data',
          columns: ['Asset', 'Built area (sqm)'],
          rows: nil.map((x) => row([x.name, structuralZeroCell(x.z)])),
        }));
        for (const fn of assetNotes.takeFootnotes()) {
          items.push(tItem(M1_TABS.assets, 'inputs', { type: 'paragraph', text: fn.text }));
        }
      }
    }
  }

  // ── TAB 6: CAPEX (the screen's inputs, then its six tables) ───────────────
  const capexReport = buildCapexReport(snap, state);
  // The "Quantity / Basis" column shows what each line's rate or percentage
  // multiplies to produce the Amount: a physical quantity (BUA/NSA/land sqm,
  // units, bays) for rate lines, or the reference amount (revenue, land value,
  // construction or selected-lines total) for percent lines; a fixed lump shows
  // "-". So rate x quantity = amount, and percentage x basis = amount.
  const basisCell = (l: typeof capexReport.inputAssets[number]['lines'][number]): string => {
    if (l.metricKind === 'none' || l.metricValue === null) return '-';
    if (l.metricKind === 'area') return `${fmt.area(l.metricValue)} ${l.metricLabel}`;
    if (l.metricKind === 'count') return `${fmt.int(l.metricValue)} ${l.metricLabel}`;
    return `${fmt.money(l.metricValue)} ${l.metricLabel}`; // money basis (percent lines)
  };
  const rateCell = (l: typeof capexReport.inputAssets[number]['lines'][number]): string =>
    (l as PooledCapexInputLine).rateVaries ? 'varies by plot'
      : l.isFixed ? fmt.money(l.rate) : l.isPercent ? `${l.rate}%` : fmt.int(l.rate);
  // ONE COST LINE TABLE PER CONSOLIDATED LINE (2026-09-15), its plots pooled.
  for (const ia of poolCapexByLine(capexReport, state).report.inputAssets) {
    items.push(tTable(M1_TABS.capex, 'inputs', {
      title: `Inputs - Cost Lines, ${ia.assetName} (${ia.phaseName})`, kind: 'grid', align: 'data',
      columns: ['Cost line', 'Stage', 'Basis (multiplier)', `Rate / Value ${rateUnit(cur)}`, 'Quantity / Basis',
        'Start period', 'End period', 'Phasing', 'Amount'],
      rows: ia.lines.map((l) => row([l.name, l.stage, l.basis, rateCell(l), basisCell(l),
        fmt.int(l.startPeriod), fmt.int(l.endPeriod), l.phasing, fmt.money(l.amount)]))
        .concat(
          ([
            ['Hard costs', ia.subtotals.hard],
            ['Soft costs', ia.subtotals.soft],
            ['Operating', ia.subtotals.operating],
            ['Marketing', ia.subtotals.marketing],
            ['Land', ia.subtotals.land],
          ] as Array<[string, number]>)
            .filter(([, v]) => v !== 0)
            .map(([label, v]) => row([label, '', '', '', '', '', '', '', fmt.money(v)], 'subtotal')),
        )
        .concat(
          // Named for what it is now that marketing is out of it, and only
          // worth printing when something is actually being excluded.
          ia.subtotals.exclLand !== 0 && (ia.subtotals.land !== 0 || ia.subtotals.marketing !== 0)
            ? [row([
                ia.subtotals.marketing !== 0
                  ? 'Construction cost (excl. land and marketing)'
                  : 'Construction cost (excl. land)',
                '', '', '', '', '', '', '', fmt.money(ia.subtotals.exclLand)], 'subtotal')]
            : [],
        )
        .concat([row([`Total, ${ia.assetName}`, '', '', '', '', '', '', '', fmt.money(ia.total)], 'total')]),
    }));
  }
  // TABLES 1 TO 6, in the screen's order and under the screen's numbers. The
  // builder returns them by the titles the screen gives them, so they are
  // looked up by name rather than re-titled here.
  const resultByTitle = (title: string): CapexResultTable | undefined => capexReport.results.find((t) => t.title === title);
  const numbered: Array<[string, string]> = [
    ['Capex Schedule by Period (per cost line, by line)', 'Table 1 - Construction Cost Schedule by Period (per cost line, by line)'],
    ['Total Capex (incl. all land)', 'Table 2 - Total Capex Including Land Value'],
    ['Capex excl. Land In-Kind (cash-impact schedule)', 'Table 3 - Capex Excluding Land In-Kind (cash-impact schedule)'],
    ['Capex excl. Total Land (pure development cost)', 'Table 4 - Capex Excluding Total Land (pure development cost)'],
  ];
  for (const [title, numberedTitle] of numbered) {
    const t = resultByTitle(title);
    if (t) items.push(tTable(M1_TABS.capex, 'outputs', m4RowsToPeriodTable(numberedTitle, py, yl, t.rows)));
  }
  // TABLE 5: the land cash and in-kind the Financing tab funds, per phase, from
  // the engine's own per-phase series, with the land-stage memo the screen
  // carries (RETT and the like: land value + memo = the land stage total).
  {
    const blocks = (fin.capex.landByPhase ?? [])
      .map((lp) => ({ ...lp, cash: lp.landCash.slice(0, yl.length), inKind: lp.landInKind.slice(0, yl.length) }))
      .filter((b) => Math.abs(sum(b.cash) + sum(b.inKind)) > 0.5);
    const rows: PdfTableRow[] = [];
    if (blocks.length === 0) {
      items.push(tItem(M1_TABS.capex, 'outputs', { type: 'paragraph', text: 'Table 5 - Land: Cash and In-Kind. No land value in this view.' }));
    } else {
      const zeros = (): number[] => new Array<number>(yl.length).fill(0);
      const gCash = zeros(); const gInKind = zeros();
      const addInto = (acc: number[], src: number[] | undefined): void => { for (let i = 0; i < acc.length; i++) acc[i] += src?.[i] ?? 0; };
      for (const b of blocks) {
        rows.push(periodRow(`${b.phaseName}, Land, cash`, b.cash, 'sum'));
        rows.push(periodRow(`${b.phaseName}, Land, in-kind`, b.inKind, 'sum'));
        if (multiPhase) rows.push(periodRow(`Subtotal, ${b.phaseName}`, b.cash.map((v, t) => v + (b.inKind[t] ?? 0)), 'sum', 'subtotal'));
        addInto(gCash, b.cash); addInto(gInKind, b.inKind);
      }
      rows.push(periodRow('Total land, cash', gCash, 'sum', 'subtotal'));
      rows.push(periodRow('Total land, in-kind', gInKind, 'sum', 'subtotal'));
      const gLand = gCash.map((v, t) => v + (gInKind[t] ?? 0));
      rows.push(periodRow('Total land', gLand, 'sum', 'total'));
      // The memo: every line in the land STAGE that is not land VALUE, by
      // phase, from the report's own per-line schedules.
      const memoLines = state.costLines.filter((c) => deriveCostStage(c) === 'land' && !isLandValueLine(c));
      const memoIds = new Set(memoLines.map((c) => c.id));
      const memoLabel = memoLines.length > 0
        ? `Memo: ${[...new Set(memoLines.map((c) => c.name))].join(', ')} (land stage, not land value)`
        : 'Memo: land-stage costs not in land value';
      const phaseOf = new Map(state.assets.map((a) => [a.id, a.phaseId] as const));
      const gMemo = zeros();
      for (const b of blocks) {
        const memo = zeros();
        for (const ia of capexReport.inputAssets) {
          if (phaseOf.get(ia.assetId) !== b.phaseId) continue;
          for (const ln of ia.lines) if (memoIds.has(ln.id)) addInto(memo, ln.perPeriod);
        }
        if (Math.abs(sum(memo)) <= 0.5) continue;
        rows.push(periodRow(`${b.phaseName}, ${memoLabel}`, memo, 'sum'));
        addInto(gMemo, memo);
      }
      if (Math.abs(sum(gMemo)) > 0.5) {
        rows.push(periodRow(`${memoLabel}, total`, gMemo, 'sum', 'subtotal'));
        rows.push(periodRow('Land stage total (land value + memo, as the tiles show)', gLand.map((v, t) => v + (gMemo[t] ?? 0)), 'sum', 'total'));
      }
      items.push(tTable(M1_TABS.capex, 'outputs', periodTable('Table 5 - Land: Cash and In-Kind (what Financing funds)', py, yl, rows)));
      items.push(tItem(M1_TABS.capex, 'outputs', {
        type: 'paragraph',
        text: 'The land inside Table 2, split into the cash the project pays and the value contributed in kind, per phase. Cash + in-kind = Table 2 less Table 4, and equals the land value on the assets tab. The Financing tab reads these phase figures.',
      }));
    }
  }
  // TABLE 6: by category, both readings, each block footing to Table 2 and Table 4.
  {
    const catRows: PdfTableRow[] = [];
    for (const [title, label] of [
      ['Capex by Category (incl. all land)', 'Including all land'],
      ['Capex by Category (excl. total land)', 'Excluding total land'],
    ] as Array<[string, string]>) {
      const t = resultByTitle(title);
      if (!t) continue;
      catRows.push(row([label, ...new Array<string>(yl.length + 2).fill('')], 'heading'));
      const total = new Array<number>(yl.length).fill(0);
      for (const r of t.rows) {
        if (r.isTotal) continue;
        catRows.push(periodRow(r.label, r.values.slice(0, yl.length), 'sum'));
        for (let i = 0; i < total.length; i++) total[i] += r.values[i] ?? 0;
      }
      catRows.push(periodRow(`${label}, total`, total, 'sum', 'total'));
    }
    if (catRows.length) {
      items.push(tTable(M1_TABS.capex, 'outputs', periodTable('Table 6 - Capex by Category (Residential, Hospitality, Retail)', py, yl, catRows)));
      items.push(tItem(M1_TABS.capex, 'outputs', {
        type: 'paragraph',
        text: 'Every line filed under its asset type\'s category; a retail strip files under Retail. The first block foots to Table 2, the second to Table 4.',
      }));
    }
  }
  // The per-stage reading the Capex tiles show, kept as a memo beneath the six.
  {
    const ps = fin.capex.perStagePerPeriod;
    const cap = fin.capex.perPeriod;
    if (ps) {
      const stageDefs: Array<[string, string]> = [
        ['land', 'Land'], ['hard', 'Hard (construction)'], ['soft', 'Soft costs'],
        ['marketing', 'Marketing'], ['operating', 'Operating (capitalised)'],
      ];
      const stageRows = stageDefs
        .filter(([key]) => anyNonZero(ps[key] ?? []))
        .map(([key, label]) => periodRow(label, (ps[key] ?? []).slice(0, yl.length), 'sum'));
      if (stageRows.length) {
        items.push(tTable(M1_TABS.capex, 'outputs', periodTable('Capex by stage (the tab\'s tiles)', py, yl,
          stageRows.concat([periodRow('Total capex (incl. all land)', cap.inclAllLand.slice(0, yl.length), 'sum', 'total')]))));
      }
    }
  }

  // ── TAB 7: FINANCING ──────────────────────────────────────────────────────
  // The screen's four sub-tabs IN ITS OWN ORDER: Inputs, Schedules, Funding
  // Gap, Cash Sweep. The report printed Funding Gap second, under a comment
  // claiming that was the platform order. It is not, and the workbook (which
  // was checked against the screen) has it right.
  const cfg = p.financing;
  const selId = (cfg?.fundingMethod ?? 1) as FundingMethodId;
  const fnd = fin.funding;
  const gap = computeFundingGap(snap);
  const w = gap.method3Waterfall;
  const sl = (a: number[] | undefined): number[] => (a ?? []).slice(0, yl.length);

  // 1. Project Financing Settings + 1b. IDC policy.
  items.push(tTable(M1_TABS.finInputs, 'inputs', kvTable('1. Project Financing Settings', [
    ['Minimum Cash Reserve', fmt.money(cfg?.minimumCashReserve ?? fnd.minCashReserve ?? 0)],
  ])));
  items.push(tTable(M1_TABS.finInputs, 'inputs', kvTable('1b. IDC (Interest During Construction) Policy', [
    ['Allocation Basis', (p.idcConfig?.allocationBasis ?? 'land') === 'bua' ? 'Total BUA' : 'Land Area'],
    ['Treatment', 'Capitalised into asset cost, paid when it arises'],
  ])));
  // 2. Funding method + 2a. its configuration.
  {
    const ft = resolveFundTerms(p);
    items.push(tTable(M1_TABS.finInputs, 'inputs', kvTable('2. Funding Method', [
      ['Selected method', `Method ${selId}, ${FUNDING_METHOD_LABELS[selId]}`],
      ['What it funds', FUNDING_METHOD_DESCRIPTIONS[selId]],
      ...(ft.enabled ? [['Fund management fee, funded by', ft.managementFeeFunding === 'equity'
        ? '100% equity (drawn from equity directly, outside the ratio)'
        : 'Cash deficit funding (inside the requirement, at the debt / equity ratio)'] as [string, string]] : []),
    ])));
    const pairs: Array<[string, string]> = [];
    if (selId === 4) {
      const m4 = cfg?.fixedAmountConfig;
      pairs.push(['Total Debt Amount', fmt.money(m4?.debtAmount ?? 0)]);
      pairs.push(['Total Equity Amount', fmt.money(m4?.equityAmount ?? 0)]);
      const yoy = m4?.yoySchedule ?? [];
      pairs.push(['Year-on-Year % schedule', yoy.length ? `${yoy.map((v) => `${v}%`).join(', ')} (sums to 100)` : 'Not set']);
    } else {
      const pair = selId === 1 ? cfg?.fixedRatio : selId === 2 ? cfg?.netFundingConfig : cfg?.cashDeficitConfig;
      const d = pair?.debtPct ?? 70; const e = pair?.equityPct ?? 30;
      pairs.push(['Debt %', fmt.pctRaw(d, 2)]);
      pairs.push(['Equity %', fmt.pctRaw(e, 2)]);
      pairs.push(['Match', Math.abs(d + e - 100) < 0.01 ? '100%' : `${(d + e).toFixed(2)}%`]);
    }
    items.push(tTable(M1_TABS.finInputs, 'inputs', kvTable(`2a. Method ${selId} Configuration`, pairs)));
  }
  // 3. Funding Basis, through the shared builder both exports read, so the
  // Sources vs Uses answer cannot differ between them (TRAPS 7.53).
  {
    const fb = computeFundingBasis(fin);
    items.push(tTable(M1_TABS.finInputs, 'outputs', kvTable('3. Funding Basis', [
      ['Drawdown Basis', FUNDING_METHOD_DESCRIPTIONS[selId]],
      ['Total Capex (excl Land In-Kind)', fmt.money(fb.capexExclInKind)],
      ['Total Funding Need', fmt.money(fb.fundingNeed)],
      ['Funded from Project Cash', fmt.money(fb.fundedFromProjectCash)],
      ['Sources vs Uses', fb.ok ? `Match (${fmt.money(fb.sources)})` : `Gap ${fmt.money(fb.gap)}`],
    ])));
  }
  // 4. Land funding per phase, the engine's own per-phase series plus the split.
  {
    const landByPhase = fin.capex.landByPhase ?? [];
    if (landByPhase.length === 0) {
      items.push(tItem(M1_TABS.finInputs, 'inputs', { type: 'paragraph', text: '4. Land Funding: no phases with land yet.' }));
    } else {
      const rows: PdfTableRow[] = [];
      for (const lp of landByPhase) {
        const phaseParcels = state.parcels.filter((x) => x.phaseId === lp.phaseId);
        const cfgs = phaseParcels.map((x) => (cfg?.parcelFunding ?? []).find((y) => y.parcelId === x.id));
        const debts = cfgs.map((c) => c?.debtPct ?? 0);
        const equities = cfgs.map((c, i) => c?.equityPct ?? (100 - debts[i]));
        const mixed = debts.some((d) => d !== debts[0]) || equities.some((e) => e !== equities[0]);
        const debtPct = debts[0] ?? 0; const equityPct = equities[0] ?? (100 - debtPct);
        rows.push(periodRow(`${lp.phaseName}, Land Cash (Capex Table 5)`, sl(lp.landCash), 'sum'));
        rows.push(periodRow(`${lp.phaseName}, Land In-Kind (Capex Table 5)`, sl(lp.landInKind), 'sum'));
        rows.push(strPeriodRow(`${lp.phaseName}, Debt % / Equity %`, new Array<string>(yl.length).fill(''),
          `${fmt.pctRaw(debtPct, 2)} / ${fmt.pctRaw(equityPct, 2)}${mixed ? ' (mixed across its plots)' : ''}`));
      }
      const zeros = new Array<number>(yl.length).fill(0);
      rows.push(periodRow('Total, Land Cash', landByPhase.reduce((acc, lp) => acc.map((v, t) => v + (lp.landCash[t] ?? 0)), [...zeros]), 'sum', 'subtotal'));
      rows.push(periodRow('Total, Land In-Kind', landByPhase.reduce((acc, lp) => acc.map((v, t) => v + (lp.landInKind[t] ?? 0)), [...zeros]), 'sum', 'subtotal'));
      items.push(tTable(M1_TABS.finInputs, 'inputs', periodTable('4. Land Funding (per phase, from the Capex results)', py, yl, rows)));
    }
  }
  // 5. Debt facilities, every term the facility card holds.
  if (state.financingTranches.length === 0) {
    items.push(tItem(M1_TABS.finInputs, 'inputs', { type: 'paragraph', text: '5. Debt Facilities: no facilities yet.' }));
  } else {
    const newTranches = state.financingTranches.filter((t) => t.origin !== 'existing');
    const shareSum = [...fin.shares.values()].reduce((s, v) => s + v, 0);
    const maxCp = state.phases.reduce((m, ph) => Math.max(m, ph.constructionPeriods ?? 0), 0);
    const operationsEndYear = snap.projectStartYear + Math.max(0, fin.axis.totalPeriods - 1);
    const defaultRepayStartYear = Math.min(operationsEndYear, snap.projectStartYear + Math.max(1, maxCp));
    items.push(tTable(M1_TABS.finInputs, 'inputs', {
      title: '5. Debt Facilities', kind: 'grid', align: 'data',
      columns: ['Facility', 'Origin', 'Lender', 'Opening balance', 'Interbank %', 'Spread %',
        'Rate %', 'Upfront %', 'Commitment %', 'Repayment method', 'Repay start',
        'Periods', 'Share %'],
      rows: state.financingTranches.map((t) => {
        const isExisting = t.origin === 'existing';
        const hasComponents = t.interbankRatePct !== undefined || t.creditSpreadPct !== undefined;
        const interbank = t.interbankRatePct ?? 0; const spread = t.creditSpreadPct ?? 0;
        const repayStart = t.repaymentStartYear ?? (isExisting ? snap.projectStartYear : defaultRepayStartYear);
        return row([
          t.name, isExisting ? 'Existing' : 'New', t.lender ?? '',
          fmt.money(t.openingBalance ?? 0), fmt.pctRaw(interbank, 2), fmt.pctRaw(spread, 2),
          fmt.pctRaw(hasComponents ? interbank + spread : (t.interestRatePct ?? 0), 2),
          fmt.pctRaw(t.upfrontFeePct ?? 0, 2), fmt.pctRaw(t.commitmentFeePct ?? 0, 2),
          (REPAYMENT_METHOD_LABELS as Record<string, string>)[t.repaymentMethod] ?? String(t.repaymentMethod),
          String(repayStart),
          t.repaymentMethod === 'year_on_year_pct' ? 'schedule'
            : fmt.int(isExisting ? (t.remainingRepaymentPeriods ?? 0) : (t.repaymentPeriods ?? 0)),
          newTranches.length > 1 && !isExisting ? fmt.pctRaw(t.facilitySharePct ?? fin.shares.get(t.id) ?? 0, 2) : '',
        ]);
      }),
    }));
    if (newTranches.length > 1 && Math.abs(shareSum - 100) >= 0.01) {
      items.push(tItem(M1_TABS.finInputs, 'inputs', {
        type: 'paragraph',
        text: `Facility shares total ${shareSum.toFixed(2)}%, not 100%. Shares are used exactly as typed, so the facilities together draw ${shareSum.toFixed(2)}% of the project debt requirement.`,
      }));
    }
  }
  // 6. Capex Breakdown, 7. Funding Requirement, 8. Total Debt, 9. Total Equity.
  {
    const cx = fin.capex;
    items.push(tTable(M1_TABS.finInputs, 'outputs', periodTable('6. Capex Breakdown', py, yl, [
      periodRow('Capex (excluding Land)', sl(cx.perPeriod.exclAllLand), 'sum'),
      periodRow('Land Cash Value', sl(cx.perPeriod.landCash), 'sum'),
      periodRow('Total Capex Incl Cash Land', sl(cx.perPeriod.exclLandInKind), 'sum', 'total'),
      ...(fin.existing.preCapexTotal > 0
        ? [periodRow('Pre-Capex (existing operations)', new Array<number>(yl.length).fill(0), 'none', undefined, fin.existing.preCapexTotal)]
        : []),
    ])));
    const reqRows: PdfTableRow[] = [
      periodRow('Method 1, Fixed Debt-to-Equity Ratio', sl(cx.perPeriod.exclLandInKind), 'sum'),
      periodRow('Method 2, Net Funding Requirement', sl(gap.methodAGapPerPeriod), 'sum'),
      periodRow('Method 3, Cash Deficit Funding', sl(w.netCashRequiredPerPeriod), 'sum'),
      periodRow('Method 4, Specified Debt + Equity (manual)', selId === 4 ? sl(fnd.selectedByPeriod) : new Array<number>(yl.length).fill(0), 'sum'),
      periodRow(`Selected (Method ${selId})`, sl(fnd.selectedByPeriod), 'sum', 'subtotal'),
    ];
    if ((fnd.minCashReserve ?? 0) > 0 && selId !== 3) {
      reqRows.push(periodRow('+ Minimum Cash Reserve', sl(fnd.minCashByPeriod), 'sum'));
      reqRows.push(periodRow('Total Funding Need', sl(fnd.totalFundingNeedByPeriod), 'sum', 'total'));
    }
    items.push(tTable(M1_TABS.finInputs, 'outputs', periodTable('7. Funding Requirement', py, yl, reqRows)));
    if ((fnd.minCashReserve ?? 0) > 0 && selId === 3) {
      items.push(tItem(M1_TABS.finInputs, 'outputs', {
        type: 'paragraph',
        text: 'Method 3 absorbs the Minimum Cash Reserve implicitly via the deficit calculation.',
      }));
    }
    const newTranches = state.financingTranches.filter((t) => t.origin !== 'existing');
    const existingOpeningTotal = state.financingTranches
      .filter((t) => t.origin === 'existing')
      .reduce((s, t) => s + Math.max(0, t.openingBalance ?? 0), 0);
    const idcNew = new Array<number>(yl.length).fill(0);
    const debtRows: PdfTableRow[] = [];
    if (existingOpeningTotal > 0) {
      debtRows.push(periodRow('Existing Debt (opening balance, pre-axis)', new Array<number>(yl.length).fill(0), 'none', undefined, existingOpeningTotal));
    }
    for (const t of newTranches) {
      const f = fin.facilities.get(t.id);
      debtRows.push(periodRow(t.name, sl(f?.drawSchedule), 'sum'));
      for (let i = 0; i < idcNew.length; i++) idcNew[i] += f?.interestCapitalized[i] ?? 0;
    }
    const capexDraw = sl(fin.debtEquitySplit.debt);
    debtRows.push(periodRow('Capex Drawdown Subtotal', capexDraw, 'sum', 'subtotal'));
    debtRows.push(periodRow('IDC Drawdown (capitalized interest)', idcNew, 'sum'));
    debtRows.push(periodRow('Total Debt Required (new draws + IDC)', capexDraw.map((v, i) => v + (idcNew[i] ?? 0)), 'sum', 'total'));
    items.push(tTable(M1_TABS.finInputs, 'outputs', periodTable('8. Total Debt Required', py, yl, debtRows)));
    const eqI = fin.equity;
    items.push(tTable(M1_TABS.finInputs, 'outputs', periodTable('9. Total Equity Required', py, yl, [
      periodRow('Cash equity', sl(eqI.cashPerPeriod), 'sum'),
      periodRow('In-kind equity', sl(eqI.inKindPerPeriod), 'sum'),
      periodRow('Existing equity', sl(eqI.existingEquityPerPeriod), 'sum', undefined, fin.existing.equityTotal),
      periodRow('Total equity', sl(eqI.totalPerPeriod), 'sum', 'total'),
    ])));
  }

  // Financing / Schedules: the platform's own tables through the shared
  // builder, plus the IDC allocation by line and the IDC summary.
  const fmtFn = (v: number): string => fmt.money(v);
  for (const t of buildFinancingScheduleTables(snap, state, fmtFn)) {
    items.push(tTable(M1_TABS.finSchedules, 'schedules', m4RowsToPeriodTable(t.title, py, yl, t.rows)));
  }
  for (const t of buildIdcAllocationTables(snap, state, fmtFn)) {
    items.push(tTable(M1_TABS.finSchedules, 'schedules', m4RowsToPeriodTable(t.title, py, yl, t.rows)));
  }
  {
    const idc = snap.idc;
    const withDisposal = idcWithDisposal(idc, disposalContextOf(snap));
    items.push(tTable(M1_TABS.finSchedules, 'schedules', periodTable('IDC Summary', py, yl, [
      periodRow('Construction interest', sl(idc.totalConstructionInterestPerPeriod), 'sum'),
      periodRow('IDC capitalised to assets', sl(idc.totalIdcPerPeriod), 'sum'),
      periodRow('IDC depreciation', sl(withDisposal.depreciationPerPeriod), 'sum'),
      ...(withDisposal.disposed
        ? [periodRow('Disposed at exit (capitalised interest)', sl(withDisposal.disposalPerPeriod).map((v) => -v), 'sum')]
        : []),
      periodRow('IDC NBV (closing)', sl(withDisposal.closingPerPeriod), 'last', 'total'),
    ])));
  }

  // Financing / Funding Gap: the two sizing waterfalls, then the side by side.
  items.push(tTable(M1_TABS.finGap, 'outputs', periodTable('Method 2: Net Funding Requirement (Capex vs Pre-Sales)', py, yl, [
    periodRow('Total project capex (excl. in-kind land)', sl(gap.capexPerPeriod), 'sum', 'subtotal'),
    periodRow('Advance received from customer (gross)', sl(gap.preSalesGrossPerPeriod), 'sum'),
    periodRow('Less: escrow held', sl(gap.escrowHeldPerPeriod).map((v) => -v), 'sum'),
    periodRow('Add: escrow released', sl(gap.escrowReleasePerPeriod), 'sum'),
    periodRow('Advance received (net)', sl(gap.preSalesNetPerPeriod), 'sum', 'subtotal'),
    periodRow('Funding gap = MAX(capex - pre-sales(t-1), 0)', sl(gap.methodAGapPerPeriod), 'sum', 'total'),
  ])));
  items.push(tTable(M1_TABS.finGap, 'outputs', periodTable('Method 3: Cash Deficit Funding', py, yl, [
    periodRow('Opening cash', sl(w.openingCashPerPeriod), 'none'),
    periodRow('Cash from operations', sl(w.cashFromOpsPerPeriod), 'sum'),
    periodRow('Cash from investing (capex)', sl(w.cashFromInvPerPeriod), 'sum'),
    periodRow('Finance cost paid', sl(w.financeCostPaidPerPeriod), 'sum'),
    periodRow('Cash available (before new funding)', sl(w.cashAvailableBeforeNewDebtPerPeriod), 'none', 'subtotal'),
    periodRow('Net cash required (= funding drawn)', sl(w.netCashRequiredPerPeriod), 'sum', 'total'),
  ])));
  items.push(tTable(M1_TABS.finGap, 'outputs', periodTable('Funding Requirement by Method (year-on-year)', py, yl, [
    periodRow('Method 1: Fund full capex', sl(gap.capexPerPeriod), 'sum'),
    periodRow('Method 2: Net funding gap (capex vs pre-sales)', sl(gap.methodAGapPerPeriod), 'sum'),
    periodRow('Method 3: Cash deficit (full waterfall)', sl(w.netCashRequiredPerPeriod), 'sum'),
  ])));

  // Financing / Cash Sweep: the sweep and dividend settings the tab carries,
  // then the waterfall and the per-facility sweep through the shared builder.
  {
    const sweep = cfg?.cashSweep;
    const div = p.dividendPolicy;
    items.push(tTable(M1_TABS.finSweep, 'inputs', kvTable('Cash sweep and dividend settings', [
      ['Cash sweep starting year', sweep?.startingYear ? String(sweep.startingYear) : 'Auto (the first post-capex year)'],
      ['Sweep ratio (% of surplus)', fmt.pctRaw(sweep?.sweepRatioPct ?? 100, 2)],
      ['Dividends enabled', div?.enabled ? 'Yes' : 'No'],
      ['Dividend payout ratio', fmt.pctRaw(div?.payoutRatio ?? 0, 2)],
      ['Dividend start year', p.dividendStartYear ? String(p.dividendStartYear) : 'Auto'],
    ])));
  }
  for (const t of buildCashSweepTables(snap, state, fmtFn)) {
    items.push(tTable(M1_TABS.finSweep, 'schedules', m4RowsToPeriodTable(t.title, py, yl, t.rows)));
  }

  return items;
}

// ── Module 2: Revenue ────────────────────────────────────────────────────────
// ── Module 2 and Module 3: a copy of the platform screens (2026-09-17) ───────
//
// THE REPORT PRINTS WHAT THE SCREENS SHOW, IN THEIR ORDER AND WORDS. Module 2
// used to print a four-column "configuration" summary (a starting ADR of 0, no
// pace, no prices), per-line output tables of its own design, a cash vintage
// matrix no screen shows, and no Schedules feeds at all; Module 3 printed the
// stored opex codes (`indirect_ga`, `pct_of_lease_rev`) and a third "Schedules"
// tab the platform does not have. The workbook was rebuilt against the screens
// the same day through shared builders, and this section reads the SAME
// builders (revenueOutputReports, opexInputLabels, saleCohortReports,
// saleRollForwardReports, cosReports, opexReports), so the three surfaces
// cannot re-word or re-order a table. Nothing here computes a model value.
import { planRevenueLines, groupRevenueLines, lineForAsset, REVENUE_SECTIONS, REVENUE_SECTION_META, type RevenueLine } from '../revenueLines';
import { lineRevenueResults, resolveRowVelocity, expandIndexationToAxis, resolveSellConfig, resolveHospitalityConfig, resolveLeaseConfig, resolveAssetKeys } from '../revenue-resolvers';
import { revenueLineName, buildProjectRevenueGroupedRows, PROJECT_REVENUE_TABLES, buildShareSoldRows, buildPrePostRows, buildRevenueScheduleFeeds } from '../reports/revenueOutputReports';
import { buildInventoryRollForward } from '../reports/saleRollForwardReports';
import { OPEX_CATEGORY_LABELS, OPEX_MODE_LABELS, isFixedCostOpexMode, summarizeOpexIndexation, opexLineInflationText } from '../reports/opexInputLabels';
import { resolveAssetDownpaymentSource } from '../state/saleCohortResolution';
import { resolveAvgUnitSize } from '../state/assetTypeStandards';
import { priceKeyFor, hasDualPrice } from '../state/subUnitPrices';
import type { Phase, SubUnit } from '../state/module1-types';
import { resolveSubUnitMetric, keysFromArea } from '@/src/core/calculations';
import { applyIndexation, buildAccountsReceivable, buildUnearnedRevenue } from '@/src/core/calculations/revenue';
import { defaultHQOpexLines, normalizeOpexIndexation, type OpexLine } from '@/src/core/calculations/opex';
import type { IndexationConfig } from '@/src/core/calculations/revenue/types';
import { assetPlotLabel } from '@/src/core/calculations/assetName';
import { poolResults, planReportLines, lineTitle } from '../reports/lineRows';

/** A builder row, with the two number kinds M4Row has no word for. */
type ScreenRow = M4Row & { fmt?: 'factor' | 'dec2' };
type ScreenKind = 'money' | 'pct' | 'count' | 'rate' | 'factor' | 'dec2';

const RATE_STR = (v: number): string => formatAccounting(v, 'full', 2);
const COUNT_STR = (v: number): string => formatAccounting(v, 'full', 0);

function screenCell(kind: ScreenKind, v: number): string | number {
  if (kind === 'money') return v;
  if (kind === 'pct') return M4_PCT.pct(v, 1);
  if (kind === 'count') return COUNT_STR(v);
  if (kind === 'rate') return RATE_STR(v);
  if (kind === 'factor') return Number.isFinite(v) ? v.toFixed(4) : '';
  return Number.isFinite(v) ? v.toFixed(2) : '';
}

/**
 * A screen table as a PDF period table. Differs from `m4RowsToPeriodTable` on
 * exactly the points a Module 2 or 3 table needs: a balance row's Total is its
 * closing figure (`totalValue` or the last period, never the sum), an opening
 * balance states no Total, and a factor or a count prints at full scale. A
 * check row's Total is the builder's own string.
 */
function screenTable(title: string, py: number, yl: number[], rows: readonly ScreenRow[], kindAll?: 'count'): PdfTable {
  const N = yl.length;
  const out: PdfTableRow[] = rows.map((r): PdfTableRow => {
    if (r.isSection && r.values.length === 0) {
      return { cells: [r.label, null, null, ...new Array<null>(N).fill(null)], emphasis: 'heading' };
    }
    const emphasis: RowEmphasis | undefined = r.isTotal ? 'total' : (r.isSubtotal || r.isSection) ? 'subtotal' : undefined;
    const kind: ScreenKind = r.isPercent ? 'pct' : r.fmt ?? r.valueKind ?? kindAll ?? 'money';
    const values = r.values.slice(0, N);
    const opening = r.totalIsBalance === true && /^Opening/.test(r.label);
    let total: string | number | null;
    if (r.totalOverride !== undefined) total = r.totalOverride;
    else if (opening) total = null;
    else if (r.totalValue !== undefined) total = screenCell(kind, r.totalValue);
    else if (r.totalIsBalance) total = screenCell(kind, values[N - 1] ?? 0);
    else if (kind === 'rate' || kind === 'factor' || kind === 'dec2' || kind === 'pct') total = null;
    else total = screenCell(kind, values.reduce((s, v) => s + (v ?? 0), 0));
    const cells: Array<string | number | null> = [
      `${'   '.repeat(r.indent ?? 0)}${r.label}`,
      total,
      r.priorValue !== undefined ? screenCell(kind, r.priorValue) : null,
      ...values.map((v) => screenCell(kind, v ?? 0)),
    ];
    while (cells.length < N + 3) cells.push(null);
    return { cells, emphasis, ...(r.totalIsBalance && !opening && r.totalOverride === undefined ? { totalIsBalance: true } : {}) };
  });
  return { title, kind: 'period', columns: ['', pdfTotalHeading(out), String(py), ...yl.map(String)], rows: out };
}

/** An input strip: the entered value in the years it applies, blank elsewhere. */
function windowRow(label: string, axis: readonly number[], window: readonly number[], N: number, kind: ScreenKind, total: string | number | null = null): PdfTableRow {
  const inWin = new Set(window);
  const cells: Array<string | number | null> = [label, total, null];
  for (let t = 0; t < N; t++) cells.push(inWin.has(t) ? screenCell(kind, axis[t] ?? 0) : null);
  return { cells };
}

const tPara = (tab: string, part: PartKind, title: string, text: string): TaggedItem => tItem(tab, part, { type: 'paragraph', title, text });
const gridTable = (title: string, columns: string[], rows: PdfTableRow[], align: 'kv' | 'data' = 'data'): PdfTable => ({ title, kind: 'grid', align, columns, rows });

/** The Module 2 inflation / indexation setting, as the card's pills read. */
function m2IndexationText(ix: { method?: string; rate?: number; startYear?: number; steps?: Array<{ year: number; factor: number }> } | undefined, startYearDefault: number, projectStartYear: number): string {
  const method = ix?.method ?? 'none';
  if (method === 'none') return 'None';
  const from = projectStartYear + (ix?.startYear ?? startYearDefault);
  if (method === 'yoy_compound') return `YoY Compound, rate ${((ix?.rate ?? 0) * 100).toFixed(2)}%, start year ${from}`;
  if (method === 'single_rate') return `Single rate ${((ix?.rate ?? 0) * 100).toFixed(2)}%, start year ${from}`;
  if (method === 'yoy_per_period') return `Per-Year growth from start year ${from}`;
  if (method === 'step') return `Step, ${(ix?.steps ?? []).length} step${(ix?.steps ?? []).length === 1 ? '' : 's'}`;
  return method;
}

const sqmStr = (v: number): string => `${Math.round(Math.max(0, v)).toLocaleString('en-US')} sqm`;
const intStr = (v: number): string => Math.round(Math.max(0, v)).toLocaleString('en-US');

const M2_TAB = { inputs: 'Tab 1: Inputs', revenue: 'Tab 2: Revenue', cos: 'Tab 3: Cost of Sales', schedules: 'Tab 4: Schedules', escrow: 'Tab 5: Escrow' } as const;
const M3_TAB = { inputs: 'Tab 1: Inputs', output: 'Tab 2: Opex Output' } as const;

function buildModule2(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: Fmt, py: number): ModuleContent {
  const yl = snap.yearLabels;
  const N = yl.length;
  const psy = snap.revenue.projectStartYear;
  const cur = state.project.currency ?? 'SAR';
  const items: ModuleContent = [];
  const phaseById = new Map(state.phases.map((p) => [p.id, p] as const));
  const lines = planRevenueLines(state.assets, state.subUnits, state.phases, state.project);
  const groups = groupRevenueLines(lines);
  const labelCtx = { parcels: state.parcels, phases: state.phases };
  const range = (from: number, to: number): number[] => (to < from ? [] : Array.from({ length: to - from + 1 }, (_, k) => from + k));
  const span = (w: readonly number[]): string => (w.length ? `${yl[w[0]]} to ${yl[w[w.length - 1]]}` : '');
  const padded = (arr: readonly number[] | undefined): number[] => Array.from({ length: N }, (_, i) => arr?.[i] ?? 0);
  const axisFromPhase = (arr: readonly number[] | undefined, offset: number): number[] => {
    const out = new Array<number>(N).fill(0);
    (arr ?? []).forEach((v, i) => { if (offset + i >= 0 && offset + i < N) out[offset + i] = v ?? 0; });
    return out;
  };
  const plotsOf = (line: RevenueLine): string => (line.isStrip || line.isOperateCompanion)
    ? '' : line.members.map((m) => assetPlotLabel(m, labelCtx)).filter((x): x is string => !!x).join(' + ');

  // THE PHASE WINDOWS a card draws its strips on, by the rule the Inputs screen
  // and the resolvers apply (handover = last construction year).
  const windowsOf = (line: RevenueLine, phase: Phase) => {
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
      opsStartIdx, defaultOpsStartIdx,
    };
  };

  // ── Tab 1: Inputs, one card per line, filed by section ──────────────────────
  const T1 = M2_TAB.inputs;
  {
    const dp = state.project.saleCohortDefaults?.downpayment;
    items.push(tTable(T1, 'inputs', gridTable('Project Sale Cohort Default', ['Field', 'Value'], [
      row(['Project default downpayment', dp === undefined ? 'not set' : fmt.pct(dp, 2)]),
    ], 'kv')));
  }
  for (const g of groups) {
    items.push(tPara(T1, 'inputs', g.section, REVENUE_SECTION_META[g.section]));
    for (const line of g.lines) {
      const phase = phaseById.get(line.phaseId);
      if (!phase) continue;
      const a = line.host;
      const ln = revenueLineName(line);
      const memberById = new Map(line.members.map((m) => [m.id, m] as const));
      const ownerOf = (u: SubUnit) => memberById.get(u.assetId) ?? a;
      const w = windowsOf(line, phase);
      const parent = line.isOperateCompanion && line.parentLineKey ? lines.find((l) => l.key === line.parentLineKey) : undefined;
      const units = line.subUnits;
      const count = units.filter((u) => resolveSubUnitMetric(u, ownerOf(u)) === 'units').reduce((s, u) => s + Math.max(0, u.metricValue), 0);
      const area = units.reduce((s, u) => s + computeSubUnitArea(u, ownerOf(u)), 0);
      const summary = units.length === 0 ? 'No sub-units yet' : [count > 0 ? `${intStr(count)} units` : '', area > 0 ? sqmStr(area) : ''].filter(Boolean).join(', ') || 'No measurements';
      const head = [line.strategy, plotsOf(line), summary].filter(Boolean).join(', ') + (parent ? `; Manage / Operate, linked to ${revenueLineName(parent)}` : '');

      // Sub-units (from Module 1 Table 5), priced as the strategy reads them.
      if (units.length > 0) {
        const typeValues = a.assetTypeId ? state.project.assetTypeValues?.[a.assetTypeId] : undefined;
        const unitSize = resolveAvgUnitSize(units.map((u) => u.unitArea), typeValues).value;
        if (line.form === 'sell') {
          items.push(tTable(T1, 'inputs', gridTable(`${ln}: Sub-units (${head})`,
            ['Sub-unit (from Module 1)', 'Quantity', 'Sells per', `Price per sqm ${rateUnit(cur, 'sqm')}`, `Price per unit ${rateUnit(cur)}`],
            units.map((su) => {
              const owner = ownerOf(su);
              const metric = resolveSubUnitMetric(su, owner);
              const suArea = computeSubUnitArea(su, owner);
              const active = priceKeyFor(su.category, metric);
              const priceOf = (k: 'pricePerSqm' | 'pricePerUnit'): number => (k === active ? Math.max(0, su.unitPrice ?? 0) : Math.max(0, su[k] ?? 0));
              const size = metric === 'units' ? `${intStr(su.metricValue)} units, ${sqmStr(suArea)}` : sqmStr(suArea);
              return row([su.name || 'sub-unit', size, active === 'pricePerUnit' ? 'unit' : 'sqm', RATE_STR(priceOf('pricePerSqm')), hasDualPrice(su) ? RATE_STR(priceOf('pricePerUnit')) : '']);
            }))));
        } else if (line.form === 'operate') {
          items.push(tTable(T1, 'inputs', gridTable(`${ln}: Sub-units (${head})`,
            ['Sub-unit (from Module 1)', 'Keys', 'Area', `ADR, per room night ${rateUnit(cur, 'night')}`],
            units.map((su) => {
              const owner = ownerOf(su);
              const suArea = computeSubUnitArea(su, owner);
              // THE RESOLVED ADR, by the one rule the engine applies: the row's
              // own ADR where positive, else the line's stored starting ADR.
              const adr = resolveSubUnitAdr(su) > 0 ? resolveSubUnitAdr(su) : (a.revenue?.operate?.startingADR ?? 0);
              const keys = resolveSubUnitMetric(su, owner) === 'units' ? Math.max(0, Math.round(su.metricValue)) : keysFromArea(suArea, unitSize);
              return row([su.name || 'sub-unit', intStr(keys), sqmStr(suArea), RATE_STR(adr)]);
            }))));
        } else {
          items.push(tTable(T1, 'inputs', gridTable(`${ln}: Sub-units (${head})`,
            ['Sub-unit (from Module 1)', 'Gross lease area', `Rent, per sqm per year ${rateUnit(cur, 'sqm')}`],
            units.map((su) => {
              const suArea = computeSubUnitArea(su, ownerOf(su));
              // THE RESOLVED RENT: the row's price where positive, else the line's base rate.
              const rent = (su.unitPrice ?? 0) > 0 ? (su.unitPrice ?? 0) : (a.revenue?.lease?.baseRate ?? 0);
              return row([su.name || 'sub-unit', sqmStr(suArea), RATE_STR(rent)]);
            }))));
        }
      }

      if (line.form === 'sell') {
        const sell = a.revenue?.sell;
        if (units.length === 0) { items.push(tPara(T1, 'inputs', `${ln} (${head})`, 'Add sub-units on the Assets tab to enter sales velocity here.')); continue; }
        // THE PACE, read the way the engine reads each row: its own entry, else
        // the line default, else nothing.
        const split = sell !== undefined && sell.velocityDefault === undefined && (sell.subUnits?.length ?? 0) > 0;
        const axisOf = (suId: string, kind: 'pre' | 'post'): { axis: number[]; source: string } => {
          const v = resolveRowVelocity(sell, suId);
          const byPhase = kind === 'pre' ? v.pre : v.post;
          const legacy = kind === 'pre' ? v.preLegacy : v.postLegacy;
          return { axis: byPhase !== undefined ? axisFromPhase(byPhase, w.phaseOffset) : padded(legacy), source: v.source };
        };
        const paceRows = (kind: 'pre' | 'post', window: number[]): PdfTableRow[] => {
          const sumOver = (axis: number[]): string => M4_PCT.pct(window.reduce((s, t) => s + (axis[t] ?? 0), 0), 1);
          if (split || units.length === 1) {
            return units.map((su) => {
              const { axis, source } = axisOf(su.id, kind);
              const note = source === 'default' ? ' (line pace)' : source === 'none' ? ' (NO VELOCITY: sells nothing)' : '';
              return windowRow(`${su.name || 'sub-unit'}${note}`, axis, window, N, 'pct', sumOver(axis));
            });
          }
          const dflt = sell?.velocityDefault;
          const axis = dflt ? axisFromPhase(kind === 'pre' ? dflt.preSalesVelocityByPhase : dflt.postSalesVelocityByPhase, w.phaseOffset) : axisOf(units[0].id, kind).axis;
          return [windowRow(`All sub-units, lockstep (${units.length})`, axis, window, N, 'pct', sumOver(axis))];
        };
        if (w.construction.length > 0) {
          items.push(tTable(T1, 'inputs', periodTable(`${ln}: Pre-Sales velocity, Construction ${span(w.construction)}`, py, yl, paceRows('pre', w.construction))));
        }
        if (w.operations.length > 0) {
          items.push(tTable(T1, 'inputs', periodTable(`${ln}: Sales During Operation, ${span(w.operations)}`, py, yl, paceRows('post', w.operations))));
        }
        const idx = sell?.indexation ?? { method: 'none' as const };
        const idxAxis = expandIndexationToAxis(idx, sell?.indexation?.growthPerPeriodByPhase, w.phaseOffset, N);
        if (idx.method === 'step') {
          items.push(tTable(T1, 'inputs', gridTable(`${ln}: Price Indexation (${m2IndexationText(idx, 0, psy)})`, ['Step', 'From', 'Factor', 'Uplift'],
            (idx.steps ?? []).map((st, i) => row([`Step ${i + 1}`, String(psy + st.year), st.factor.toFixed(4), `${((Math.max(1, st.factor) - 1) * 100).toFixed(2)}%`])))));
        }
        if (w.cash.length > 0) {
          const priceRows: PdfTableRow[] = [];
          if (idx.method === 'yoy_per_period') priceRows.push(windowRow('YoY growth', padded(idxAxis.growthPerPeriod), w.cash, N, 'pct'));
          priceRows.push(windowRow('Indexation factor', Array.from({ length: N }, (_, t) => applyIndexation(1, t, idxAxis)), w.cash, N, 'factor'));
          for (const su of units) {
            const perUnit = resolveSubUnitMetric(su, ownerOf(su)) === 'units';
            const base = Math.max(0, su.unitPrice ?? 0);
            priceRows.push(windowRow(`${su.name || 'sub-unit'} (${cur} ${RATE_STR(base)} / ${perUnit ? 'unit' : 'sqm'})`,
              Array.from({ length: N }, (_, t) => (base > 0 ? applyIndexation(base, t, idxAxis) : 0)), w.cash, N, 'rate'));
          }
          items.push(tTable(T1, 'inputs', periodTable(`${ln}: Sale price per year, after indexation (${m2IndexationText(idx, 0, psy)})`, py, yl, priceRows)));
        }
        const rec = sell?.recognitionProfile;
        if (rec?.method === 'over_time') {
          const pcts = padded(rec.percentages);
          items.push(tTable(T1, 'inputs', periodTable(`${ln}: Revenue Recognition, Over-Time (percent of each cohort per project year)`, py, yl, [
            windowRow('Recognition %', pcts, w.cash, N, 'pct', M4_PCT.pct(w.cash.reduce((s, t) => s + (pcts[t] ?? 0), 0), 1)),
          ])));
        } else {
          const anchor = rec?.pointInTimeYear ?? 'handover';
          items.push(tPara(T1, 'inputs', `${ln}: Revenue Recognition`, anchor === 'handover'
            ? `Point-in-Time, at handover (${yl[w.handoverIdx]}): every pre-sales cohort recognises in full at handover; sales during operation recognise in their own sale year.`
            : anchor === 'sale_year' ? 'Point-in-Time, at sale year: each cohort recognises in full in the year it is sold.'
              : `Point-in-Time, at custom year ${rec?.pointInTimeCustomYear ?? yl[w.handoverIdx]}: every pre-sales cohort recognises in full in that year.`));
        }
        // SALE COHORT TERMS on every Sell line, whatever the recognition method:
        // they drive collections, not recognition, so handover recognition hides nothing.
        const block = buildSaleCohortTermsBlock(a, phase, psy);
        if (block) {
          const source = resolveAssetDownpaymentSource(sell?.downpaymentByPhase, state.project.saleCohortDefaults?.downpayment);
          items.push(tTable(T1, 'inputs', gridTable(`${ln}: Sale cohort terms`, ['Term', 'Value'], [
            row(['Max instalment years after sale', String(block.instalmentYears)]),
            row(['Instalments', block.stopAtHandover ? `Must finish by handover (${block.handoverYear})` : 'May run past handover']),
          ], 'kv')));
          if (block.downpayments.length > 0) {
            items.push(tTable(T1, 'inputs', {
              title: `${ln}: Downpayment % by sale year (% of the sale value of that year)`, kind: 'grid', align: 'data',
              columns: ['Term', ...block.downpayments.map((d) => String(d.year))],
              rows: [row(['Downpayment %', ...block.downpayments.map((d) => (d.source === 'unset' ? 'not set' : fmt.pctRaw(d.value * 100, 2)))])],
            }));
          }
          items.push(tPara(T1, 'inputs', '', `${saleCohortRuleText(block)} ${source.reason}`));
        }
        continue;
      }

      if (line.form === 'operate') {
        const cfg = a.revenue?.operate;
        const typeValues = a.assetTypeId ? state.project.assetTypeValues?.[a.assetTypeId] : undefined;
        const keys = line.members.reduce((s, m) => s + resolveAssetKeys(m, state.subUnits, typeValues).keys, 0);
        if (!cfg) { items.push(tPara(T1, 'inputs', `${ln} (${head})`, 'No operate config yet.')); continue; }
        if (w.operations.length === 0) { items.push(tPara(T1, 'inputs', `${ln} (${head})`, 'Phase has no operations periods. Set them on Project & Phases.')); continue; }
        const resolved = resolveHospitalityConfig(a, phase, state.subUnits, psy, N, typeValues);
        const ops = w.operations;
        const kv: PdfTableRow[] = [
          row(['Keys the engine counts', intStr(keys)]),
          row(['ADR indexation', m2IndexationText(cfg.adrIndexation, w.opsStartIdx, psy)]),
          row(['Operations start year', `${psy + w.opsStartIdx} (default after handover: ${psy + w.defaultOpsStartIdx})`]),
          row(['Average guests per occupied room night', (cfg.guestsPerOccupiedRoom ?? 1.5).toFixed(2)]),
        ];
        const strips: PdfTableRow[] = [];
        const occ = padded(resolved?.occupancyPerPeriod);
        const occVisible = ops.map((t) => occ[t] ?? 0);
        strips.push(windowRow('Occupancy ramp (Total = average)', occ, ops, N, 'pct', M4_PCT.pct(occVisible.length ? occVisible.reduce((s, v) => s + v, 0) / occVisible.length : 0, 1)));
        if (cfg.adrIndexation?.method === 'yoy_per_period') strips.push(windowRow('ADR YoY growth', padded(resolved?.adrIndexation.growthPerPeriod), ops, N, 'pct'));
        const ancillary = (title: string, pctLabel: string, anc: { mode?: string } | undefined, res: { percentOfRooms?: number | number[]; ratePerGuest?: number | number[]; fixedAmountPerPeriod?: number | number[] } | undefined): void => {
          const mode = anc?.mode ?? 'percent_of_rooms';
          const modeLabel = mode === 'percent_of_rooms' ? '% of Rooms' : mode === 'per_guest' ? 'Per Guest' : 'Baseline + Growth';
          const raw = mode === 'percent_of_rooms' ? res?.percentOfRooms : mode === 'per_guest' ? res?.ratePerGuest : res?.fixedAmountPerPeriod;
          const kind: ScreenKind = mode === 'percent_of_rooms' ? 'pct' : mode === 'per_guest' ? 'rate' : 'money';
          const label = mode === 'percent_of_rooms' ? pctLabel : mode === 'per_guest' ? `Rate per guest ${rateUnit(cur, 'guest')}` : `Baseline amount (${cur})`;
          if (Array.isArray(raw)) {
            kv.push(row([`${title} mode`, `${modeLabel}, per year below`]));
            strips.push(windowRow(`${title}, ${label}`, padded(raw), ops, N, kind));
          } else {
            const v = Math.max(0, raw ?? 0);
            kv.push(row([`${title}, ${label}`, `${kind === 'pct' ? M4_PCT.pct(v, 2) : kind === 'rate' ? RATE_STR(v) : fmt.money(v)} (${modeLabel})`]));
          }
        };
        ancillary('F&B Revenue', 'F&B %', cfg.fb, resolved?.fb);
        ancillary('Other Revenue', 'Other %', cfg.otherRevenue, resolved?.otherRevenue);
        if (a.isCompanion === true && resolved?.keysParticipationPerPeriod) {
          strips.push(windowRow('Rental pool enrollment (Sell + Manage)', padded(resolved.keysParticipationPerPeriod), ops, N, 'pct'));
        }
        kv.push(row(['Accounts Receivable Days', `${cfg.dso ?? 30} days`]));
        items.push(tTable(T1, 'inputs', gridTable(`${ln}: Operating inputs (${head})`, ['Field', 'Value'], kv, 'kv')));
        items.push(tTable(T1, 'inputs', periodTable(`${ln}: Per-year inputs, Operations ${span(ops)}`, py, yl, strips)));
        continue;
      }

      // Lease
      const cfg = a.revenue?.lease;
      if (!cfg) { items.push(tPara(T1, 'inputs', `${ln} (${head})`, 'No lease config yet.')); continue; }
      if (w.operations.length === 0) { items.push(tPara(T1, 'inputs', `${ln} (${head})`, 'Phase has no operations periods. Set them on Project & Phases.')); continue; }
      const resolved = resolveLeaseConfig(a, phase, state.subUnits, psy, N);
      const ops = w.operations;
      items.push(tTable(T1, 'inputs', gridTable(`${ln}: Lease inputs (${head})`, ['Field', 'Value'], [
        row(['Rent indexation', m2IndexationText(cfg.rentIndexation, w.opsStartIdx, psy)]),
        row(['Operations start year', `${psy + w.opsStartIdx} (default after handover: ${psy + w.defaultOpsStartIdx})`]),
        row(['Accounts Receivable Days', `${cfg.arDays ?? 30} days`]),
      ], 'kv')));
      const occ = padded(resolved?.occupancyPerPeriod);
      const occVisible = ops.map((t) => occ[t] ?? 0);
      const strips: PdfTableRow[] = [windowRow('Occupancy ramp (Total = average)', occ, ops, N, 'pct', M4_PCT.pct(occVisible.length ? occVisible.reduce((s, v) => s + v, 0) / occVisible.length : 0, 1))];
      if (cfg.rentIndexation?.method === 'yoy_per_period') strips.push(windowRow('Rent YoY growth', padded(resolved?.rentIndexation.growthPerPeriod), ops, N, 'pct'));
      items.push(tTable(T1, 'inputs', periodTable(`${ln}: Per-year inputs, Operations ${span(ops)}`, py, yl, strips)));
    }
  }

  // ── Tab 2: Revenue, per line in screen order, then the project total ────────
  const T2 = M2_TAB.revenue;
  const lineResults = new Map(lines.map((l) => [l.key, lineRevenueResults(l.members.map((m) => m.id), snap.revenue, l.key)] as const));
  const lastPos = (x: readonly number[]): number => { for (let i = x.length - 1; i >= 0; i--) if (x[i] > 0) return x[i]; return 0; };
  for (const g of groups) {
    const sectionItems: ModuleContent = [];
    for (const p of state.phases) {
      for (const line of g.lines.filter((l) => l.phaseId === p.id)) {
        const a = line.host;
        const ln = revenueLineName(line);
        const res = lineResults.get(line.key);
        const memberById = new Map(line.members.map((m) => [m.id, m] as const));
        const ownerOf = (u: SubUnit) => memberById.get(u.assetId) ?? a;
        const w = windowsOf(line, p);
        const put = (title: string, rows: readonly ScreenRow[], kindAll?: 'count'): void => {
          if (rows.length) sectionItems.push(tTable(T2, 'outputs', screenTable(`${ln}: ${title}`, py, yl, rows, kindAll)));
        };

        if (line.form === 'sell') {
          const r = res?.sell;
          if (!r) {
            if (a.strategy === 'Sell + Manage') sectionItems.push(tPara(T2, 'outputs', ln, 'No Sell-side revenue config yet.'));
            continue;
          }
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
          put('1a. Share of inventory sold per year (per sub-unit)', buildShareSoldRows(units, denomPerSU, preSU, postSU, denom, N));
          put(`1b. ${invLabel} Sold (per sub-unit, pre-sales and sales during operation)`, buildPrePostRows(units, preSU, postSU, preTot, postTot, N, { preLabel: `Total pre-sales ${invLower}`, postLabel: `Total sales during operation ${invLower}`, grandLabel: `Asset Total ${invLabel} Sold` }, 'count'));
          put(`1c. Closing Inventory (unsold ${invLower})`, buildInventoryRollForward(denom, preTot.map((v, i) => v + (postTot[i] ?? 0)), N, invLower).rows, 'count');
          put('2a. Sale price per year, after indexation (per sub-unit)', [
            { label: 'Indexation factor', values: Array.from({ length: N }, (_, t) => applyIndexation(1, t, idxAxis)), fmt: 'factor' },
            ...units.map((su): ScreenRow => {
              const perUnit = resolveSubUnitMetric(su, ownerOf(su)) === 'units';
              const base = Math.max(0, su.unitPrice ?? 0);
              return { label: `${su.name || 'sub-unit'} (${cur} ${RATE_STR(base)} / ${perUnit ? 'unit' : 'sqm'})`, values: Array.from({ length: N }, (_, t) => (base > 0 ? applyIndexation(base, t, idxAxis) : 0)), valueKind: 'rate' };
            }),
          ]);
          put('2b. Revenue (per sub-unit, pre-sales and sales during operation)', buildPrePostRows(units, r.presalesRevenuePerPeriodPerSubUnit, r.postSalesRevenuePerPeriodPerSubUnit, r.presalesRevenuePerPeriod, r.postSalesRevenuePerPeriod, N, { preLabel: 'Total pre-sales revenue', postLabel: 'Total sales during operation revenue', grandLabel: 'Asset Total Revenue' }));
          {
            const m = r.recognitionVintageMatrix;
            const active = range(0, N - 1).filter((i) => (m[i] ?? []).reduce((s, v) => s + (v ?? 0), 0) > 0.5);
            const totals = new Array<number>(N).fill(0);
            for (const mr of m) for (let t = 0; t < N; t++) totals[t] += mr?.[t] ?? 0;
            put(`3a. Pre-Sales Recognition Vintage Matrix (handover ${yl[w.handoverIdx] ?? '?'})`, [
              ...active.map((i): ScreenRow => ({ label: `Sold in ${yl[i]}`, values: (m[i] ?? []).slice(0, N), indent: 1 })),
              { label: 'Year Total', values: totals, isTotal: true },
            ]);
          }
          put('3b. Recognition Summary (per period)', [
            { label: 'Pre-Sales Recognised', values: r.presalesRecognitionPerPeriod },
            { label: 'Sales During Operation Recognised', values: r.postSalesRecognitionPerPeriod },
            { label: 'Total Revenue Recognised', values: r.recognitionPerPeriod, isTotal: true },
          ]);
          // 4a. THE SALE COHORT GRID, from the shared builder the screen and the
          // workbook render; the plain cash vintage matrix only where it has none.
          const grid = buildSaleCohortGrid(a, p, psy, yl, state.project.saleCohortDefaults?.downpayment, r);
          if (grid && grid.rows.length) {
            put(`4a. Sale Cohort Grid (pre-sales cash, handover ${grid.handoverYear})`, [
              ...grid.rows.map((cr): ScreenRow => ({ label: cr.paysInFull ? `${cr.saleYear} sale, paid in full` : `${cr.saleYear} sale, ${(cr.downpayment * 100).toFixed(2)}% down`, values: cr.cells.slice(0, N), indent: 1 })),
              { label: 'Total collected', values: grid.columnTotals.slice(0, N), isTotal: true },
            ]);
            sectionItems.push(tTable(T2, 'outputs', gridTable(`${ln}: 4a. Sale Cohort Grid check`,
              ['Sale year', 'Down %', 'In force from', 'Sale value', 'Collected', 'Check'], [
                ...grid.rows.map((cr) => row([
                  String(cr.saleYear),
                  cr.paysInFull ? '100%' : `${(cr.downpayment * 100).toFixed(2)}%`,
                  cr.paysInFull ? 'not used' : cr.downpaymentSource.replace('_', ' '),
                  fmt.money(cr.gdv), fmt.money(cr.rowTotal),
                  cr.ok ? '0.00' : cr.checkResidue.toFixed(2),
                ])),
                row(['Total', '', '', fmt.money(grid.gdvTotal), fmt.money(grid.collectedTotal),
                  grid.ok ? '0.00' : (grid.collectedTotal - grid.gdvTotal).toFixed(2)], 'subtotal'),
              ])));
          } else {
            const m = r.cashVintageMatrix;
            const totals = new Array<number>(N).fill(0);
            for (const mr of m) for (let t = 0; t < N; t++) totals[t] += mr?.[t] ?? 0;
            put('4a. Pre-Sales Cash Vintage Matrix', [
              ...range(0, N - 1).filter((k) => (m[k] ?? []).reduce((s, v) => s + (v ?? 0), 0) > 0.5)
                .map((i): ScreenRow => ({ label: `Sold in ${yl[i]}`, values: (m[i] ?? []).slice(0, N), indent: 1 })),
              { label: 'Year Total', values: totals, isTotal: true },
            ]);
          }
          put('4b. Cash Summary (per period)', [
            { label: 'Pre-Sales Cash', values: r.presalesCashPerPeriod },
            { label: 'Sales During Operation Cash', values: r.postSalesCashPerPeriod },
            { label: 'Total Cash Collected', values: r.cashCollectedPerPeriod, isTotal: true },
          ]);
          const ar = buildAccountsReceivable(r.presalesRevenuePerPeriod, r.presalesCashPerPeriod, N);
          const ur = buildUnearnedRevenue(r.presalesRecognitionPerPeriod, r.presalesRevenuePerPeriod, N);
          put('5. Accounts Receivable (Sales Receivable roll-forward)', buildReceivablesRollForward(ar, r.presalesRevenuePerPeriod, r.presalesCashPerPeriod, N, ar.changePerPeriod).rows);
          put('6. Unearned Revenue (Contract Liability roll-forward)', buildUnearnedRollForward(ur, r.presalesRevenuePerPeriod, r.presalesRecognitionPerPeriod, N, ur.changePerPeriod).rows);
          continue;
        }

        if (line.form === 'operate') {
          const r = res?.hospitality;
          if (!r) { sectionItems.push(tPara(T2, 'outputs', ln, 'No operate config yet.')); continue; }
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
          const occNZ = r.occupancyPerPeriod.filter((v) => v > 0);
          const occAvg = occNZ.length ? occNZ.reduce((s, v) => s + v, 0) / occNZ.length : 0;
          const keyed = line.subUnits.filter((u) => (r.perSubUnit?.[u.id]?.keys ?? 0) > 0);
          const perSu = keyed.length > 1;
          put('1. Drivers + Calculations', [
            { label: 'Drivers', values: [], isSection: true },
            { label: 'Total Rooms (Keys)', values: broadcast(keys), valueKind: 'count', totalValue: keys, indent: 1 },
            { label: 'Days per Year', values: broadcast(days), valueKind: 'count', totalValue: days, indent: 1 },
            ...((a.isCompanion === true && opCfg?.keysParticipationProfile && opCfg.keysParticipationProfile.length > 0) ? [
              { label: 'Rental Pool Participation %', values: r.keysParticipationPerPeriod, isPercent: true, totalValue: r.keysParticipationPerPeriod[N - 1] ?? 0, indent: 1 },
              { label: 'Effective Rental Pool Keys (Total Keys x Pool %)', values: r.effectiveKeysPerPeriod, valueKind: 'count' as const, totalValue: r.effectiveKeysPerPeriod[N - 1] ?? 0, indent: 1 },
            ] : []),
            { label: 'Occupancy %', values: r.occupancyPerPeriod, isPercent: true, totalValue: occAvg, indent: 1 },
            { label: 'ADR Indexation Factor', values: r.adrIndexationFactorPerPeriod, fmt: 'factor', totalValue: lastPos(r.adrIndexationFactorPerPeriod), indent: 1 },
            { label: perSu ? `ADR (keys-weighted avg, ${cur} per occupied room night)` : `ADR (${cur} per occupied room night)`, values: r.adrPerPeriod, valueKind: 'rate', totalValue: lastPos(r.adrPerPeriod), indent: 1 },
            ...(perSu ? keyed.map((u): ScreenRow => ({ label: `${u.name} ADR (${intStr(r.perSubUnit[u.id].keys)} keys)`, values: r.perSubUnit[u.id].adrPerPeriod, valueKind: 'rate', totalValue: lastPos(r.perSubUnit[u.id].adrPerPeriod), indent: 2 })) : []),
            ...((fbMode === 'per_guest' || otherMode === 'per_guest') ? [{ label: 'Guests per Occupied Room', values: broadcast(guests), fmt: 'dec2' as const, totalValue: guests, indent: 1 }] : []),
            ...(fbMode === 'percent_of_rooms' ? [{ label: 'F&B % of Rooms Revenue', values: arr(opCfg?.fb?.percentOfRooms), isPercent: true, totalValue: scalar(opCfg?.fb?.percentOfRooms), indent: 1 }] : []),
            ...(fbMode === 'per_guest' ? [{ label: `F&B Rate per Guest (${cur})`, values: arr(opCfg?.fb?.ratePerGuest), valueKind: 'rate' as const, totalValue: scalar(opCfg?.fb?.ratePerGuest), indent: 1 }] : []),
            ...(fbMode === 'fixed_amount' ? [{ label: `F&B Fixed Amount per Year (${cur})`, values: arr(opCfg?.fb?.fixedAmountPerPeriod), indent: 1 }] : []),
            ...(otherMode === 'percent_of_rooms' ? [{ label: 'Other % of Rooms Revenue', values: arr(opCfg?.otherRevenue?.percentOfRooms), isPercent: true, totalValue: scalar(opCfg?.otherRevenue?.percentOfRooms), indent: 1 }] : []),
            ...(otherMode === 'per_guest' ? [{ label: `Other Rate per Guest (${cur})`, values: arr(opCfg?.otherRevenue?.ratePerGuest), valueKind: 'rate' as const, totalValue: scalar(opCfg?.otherRevenue?.ratePerGuest), indent: 1 }] : []),
            ...(otherMode === 'fixed_amount' ? [{ label: `Other Fixed Amount per Year (${cur})`, values: arr(opCfg?.otherRevenue?.fixedAmountPerPeriod), indent: 1 }] : []),
            { label: 'Calculations', values: [], isSection: true },
            ...(perSu ? keyed.map((u): ScreenRow => ({ label: `${u.name} ARN (${intStr(r.perSubUnit[u.id].keys)} keys x Days)`, values: r.perSubUnit[u.id].availableRoomNightsPerPeriod, valueKind: 'count', indent: 2 })) : []),
            { label: perSu ? 'Total Available Room Nights' : 'Available Room Nights', values: r.availableRoomNightsPerPeriod, valueKind: 'count', isSubtotal: perSu, indent: 1 },
            ...(perSu ? keyed.map((u): ScreenRow => ({ label: `${u.name} ORN (ARN x Occupancy)`, values: r.perSubUnit[u.id].occupiedRoomNightsPerPeriod, valueKind: 'count', indent: 2 })) : []),
            { label: perSu ? 'Total Occupied Room Nights' : 'Occupied Room Nights', values: r.occupiedRoomNightsPerPeriod, valueKind: 'count', isSubtotal: perSu, indent: 1 },
            { label: `Guests per Year (x ${guests.toFixed(2)} guests / ORN)`, values: r.guestsPerPeriod, valueKind: 'count', isSubtotal: true, indent: 1 },
          ]);
          put('2. Rooms + F&B + Other + Total Hospitality Revenue', [
            ...(perSu ? keyed.map((u): ScreenRow => ({ label: `${u.name} Rooms Revenue`, values: r.perSubUnit[u.id].roomsRevenuePerPeriod, indent: 1 })) : []),
            { label: perSu ? 'Total Rooms Revenue' : 'Rooms Revenue', values: r.roomsRevenuePerPeriod, isSubtotal: perSu },
            { label: 'F&B Revenue', values: r.fbRevenuePerPeriod },
            { label: 'Other Revenue', values: r.otherRevenuePerPeriod },
            { label: 'Total Hospitality Revenue', values: r.totalRevenuePerPeriod, isTotal: true },
          ]);
          continue;
        }

        // Lease
        const r = res?.lease;
        if (!r) { sectionItems.push(tPara(T2, 'outputs', ln, 'No lease config yet.')); continue; }
        const gla = line.subUnits.reduce((s, u) => s + Math.max(0, computeSubUnitArea(u, ownerOf(u))), 0);
        const occNZ = r.occupancyPerPeriod.filter((v) => v > 0);
        const zones = line.subUnits.filter((u) => r.perSubUnit?.[u.id]);
        put('1. Drivers + Calculations', [
          { label: 'Drivers', values: [], isSection: true },
          { label: 'Total Gross Lease Area (sqm)', values: r.occupiedAreaPerPeriod.slice(0, N).map((v) => (v > 0 ? gla : 0)), valueKind: 'count', totalValue: gla, indent: 1 },
          { label: 'Occupancy %', values: r.occupancyPerPeriod, isPercent: true, totalValue: occNZ.length ? occNZ.reduce((s, v) => s + v, 0) / occNZ.length : 0, indent: 1 },
          { label: 'Rent Indexation Factor', values: r.rentIndexationFactorPerPeriod, fmt: 'factor', totalValue: lastPos(r.rentIndexationFactorPerPeriod), indent: 1 },
          { label: line.subUnits.length > 1 ? `Indexed Rate (GLA-weighted avg, ${cur} per sqm/yr)` : `Indexed Rate (${cur} per sqm/yr)`, values: r.indexedRatePerPeriod, valueKind: 'rate', totalValue: lastPos(r.indexedRatePerPeriod), indent: 1 },
          ...zones.map((u): ScreenRow => ({ label: `${u.name} Indexed Rate (${sqmStr(r.perSubUnit[u.id].gla)} GLA)`, values: r.perSubUnit[u.id].indexedRatePerPeriod, valueKind: 'rate', totalValue: lastPos(r.perSubUnit[u.id].indexedRatePerPeriod), indent: 2 })),
          { label: 'Calculations', values: [], isSection: true },
          ...zones.map((u): ScreenRow => ({ label: `${u.name} Occupied Area (sqm)`, values: r.perSubUnit[u.id].occupiedAreaPerPeriod, valueKind: 'count', indent: 2 })),
          { label: 'Total Occupied Lease Area (sqm)', values: r.occupiedAreaPerPeriod, valueKind: 'count', isSubtotal: zones.length > 0, indent: 1 },
        ]);
        put('2. Per-Sub-Unit + Total Lease Revenue', [
          ...zones.map((u): ScreenRow => ({ label: `${u.name} Rent Revenue`, values: r.perSubUnit[u.id].revenuePerPeriod, indent: 1 })),
          { label: 'Total Lease Revenue', values: r.totalRevenuePerPeriod, isTotal: true },
        ]);
      }
    }
    if (sectionItems.length > 0) {
      items.push(tPara(T2, 'outputs', g.section, REVENUE_SECTION_META[g.section]));
      items.push(...sectionItems);
    }
  }
  // THE PROJECT TOTAL: three tables grouped by section, from the shared builder.
  for (const t of PROJECT_REVENUE_TABLES) {
    items.push(tTable(T2, 'outputs', screenTable(`Project Total: ${t.title}`, py, yl, buildProjectRevenueGroupedRows(t.view, lines, lineResults, N))));
  }

  // ── Tab 3: Cost of Sales, per line filed by section (the build first) ───────
  const T3 = M2_TAB.cos;
  const cosFmtFn = (v: number): string => fmt.money(v);
  {
    const cosTables = buildCostOfSalesReport(snap, state, cosFmtFn);
    for (const section of REVENUE_SECTIONS) {
      const inSection = cosTables.filter((t) => t.lineKey && t.section === section);
      if (inSection.length === 0) continue;
      items.push(tPara(T3, 'outputs', section, REVENUE_SECTION_META[section]));
      for (const t of inSection) items.push(tTable(T3, 'outputs', m4RowsToPeriodTable(t.title, py, yl, t.rows)));
    }
    for (const t of cosTables.filter((x) => !x.lineKey)) items.push(tTable(T3, 'outputs', m4RowsToPeriodTable(t.title, py, yl, t.rows)));
  }

  // ── Tab 4: Schedules, the three feeds ──────────────────────────────────────
  const T4 = M2_TAB.schedules;
  for (const feed of buildRevenueScheduleFeeds(snap.revenue, lines, snap.byAssetCostOfSales)) {
    items.push(tPara(T4, 'schedules', feed.group, feed.meta));
    for (const t of feed.tables) {
      if (t.rows.length) items.push(tTable(T4, 'schedules', screenTable(t.title, py, yl, t.rows)));
    }
  }

  // ── Tab 5: Escrow, whenever a Sell line has pre-sales cash ──────────────────
  const T5 = M2_TAB.escrow;
  const lineState = { assets: state.assets, phases: state.phases, parcels: state.parcels };
  const escrowLines = planReportLines(lineState, (a) => snap.escrow.byAsset.has(a.id));
  if (escrowLines.length > 0) {
    const esc = snap.escrow.projectTotals;
    const rows = escrowLines.map((line) => {
      const members = line.assetIds.map((id) => snap.escrow.byAsset.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
      const host = members[0];
      const rl = lineForAsset(lines, host.assetId);
      return { ...poolResults(members), assetId: host.assetId, name: rl ? revenueLineName(rl) : lineTitle(line, lineState), effectiveHeldPct: host.effectiveHeldPct, effectiveHeldUntilYear: host.effectiveHeldUntilYear, effectiveReleaseYear: host.effectiveReleaseYear };
    });
    const pe = state.project.escrow;
    items.push(tTable(T5, 'inputs', gridTable('1. Escrow Inputs (project)', ['Field', 'Value'], [
      row(['Project Held % (regulator-locked)', fmt.pct(pe?.heldPct ?? 0, 2)]),
      row(['Default Held Until Year (optional)', pe?.defaultHeldUntilYear !== undefined && pe?.defaultHeldUntilYear !== null ? String(pe.defaultHeldUntilYear) : 'auto: handover year']),
      row(['Default Release Year (optional)', pe?.defaultReleaseYear !== undefined && pe?.defaultReleaseYear !== null ? String(pe.defaultReleaseYear) : 'auto: handover year + 1']),
    ], 'kv')));
    items.push(tTable(T5, 'inputs', gridTable('1. Escrow Inputs (per line overrides)',
      ['Line', 'Effective Held %', 'Held % Override', 'Effective Held Until', 'Held Until Override', 'Effective Release Year', 'Release Year Override'],
      rows.map((rw) => {
        const ov = state.assets.find((x) => x.id === rw.assetId)?.revenue?.sell?.escrow;
        return row([
          rw.name, fmt.pct(rw.effectiveHeldPct, 2), ov?.heldPctOverride !== undefined && ov?.heldPctOverride !== null ? fmt.pct(ov.heldPctOverride, 2) : 'inherit',
          String(rw.effectiveHeldUntilYear), ov?.heldUntilYearOverride != null ? String(ov.heldUntilYearOverride) : 'auto',
          String(rw.effectiveReleaseYear), ov?.releaseYearOverride != null ? String(ov.releaseYearOverride) : 'auto',
        ]);
      }))));
    items.push(tTable(T5, 'schedules', periodTable('2. A. Pre-Sales Cash by Asset (subject to escrow)', py, yl, [
      ...rows.map((rw) => periodRow(`   ${rw.name}`, rw.preSalesCashPerPeriod.slice(0, N), 'sum')),
      periodRow('Total Pre-Sales Cash (all assets)', esc.preSalesCashPerPeriod.slice(0, N), 'sum', 'total'),
    ])));
    const opening = new Array<number>(N).fill(0);
    for (let t = 1; t < N; t++) opening[t] = esc.cumulativeBalancePerPeriod[t - 1] ?? 0;
    items.push(tTable(T5, 'schedules', periodTable('2. B. Escrow Balance Roll-Forward', py, yl, [
      { ...periodRow('Opening Balance', opening, 'none', 'subtotal') },
      row(['Additions:', null, null, ...new Array<null>(N).fill(null)], 'heading'),
      ...rows.map((rw) => periodRow(`   ${rw.name}`, rw.result.heldPerPeriod.slice(0, N), 'sum')),
      periodRow('Total Additions', esc.heldPerPeriod.slice(0, N), 'sum', 'subtotal'),
      periodRow('Less: Release of Locked Funds', esc.releasePerPeriod.slice(0, N).map((v) => -v), 'sum', 'subtotal'),
      periodRow('Closing Balance', esc.cumulativeBalancePerPeriod.slice(0, N), 'last', 'total'),
    ])));
    items.push(tTable(T5, 'schedules', periodTable('2. C. Cash Flow Impact (project totals)', py, yl, [
      periodRow('   Less: Inaccessible Funds Locked', esc.heldPerPeriod.slice(0, N).map((v) => -v), 'sum'),
      periodRow('   Add: Release of Inaccessible Funds', esc.releasePerPeriod.slice(0, N), 'sum'),
      periodRow('Net Cash Flow Adjustment (to M4)', esc.cashFlowAdjustmentPerPeriod.slice(0, N), 'sum', 'total'),
    ])));
  }

  return items;
}

// ── Module 3: Operating Expenses (both sub-tabs, as the screens read) ─────────
function buildModule3(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: Fmt, py: number): ModuleContent {
  const yl = snap.yearLabels;
  const N = yl.length;
  const psy = snap.revenue.projectStartYear;
  const cur = state.project.currency ?? 'SAR';
  const items: ModuleContent = [];
  const lineState = { assets: state.assets, phases: state.phases, parcels: state.parcels };
  const revLines = planRevenueLines(state.assets, state.subUnits, state.phases, state.project);
  const nameOf = (assetId: string, fallback: string): string => { const l = lineForAsset(revLines, assetId); return l ? revenueLineName(l) : fallback; };
  const padded = (arr: readonly number[] | undefined): number[] => Array.from({ length: N }, (_, i) => arr?.[i] ?? 0);

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

  // ONE CARD: the line table in the screen's columns and words, then any
  // per-year strips it carries (a Per-Year inflation, YoY rates).
  const T1 = M3_TAB.inputs;
  const card = (title: string, inflationLabel: string, lines: readonly OpexLine[], defaultIndexation: IndexationConfig, years: number[]): void => {
    items.push(tTable(T1, 'inputs', gridTable(`${title} (${inflationLabel}: ${summarizeOpexIndexation(defaultIndexation)})`,
      ['Line item', 'Category', 'Mode', 'Rate', 'Value', 'Inflation', 'On'],
      lines.map((l) => {
        const isPct = String(l.mode).startsWith('pct_');
        const value = l.rateMode === 'yoy' ? 'year-by-year'
          : isPct ? M4_PCT.pct(Math.max(0, l.value), 2)
            : l.mode === 'fixed_baseline' ? formatAccounting(Math.max(0, l.value), fmt.scale, fmt.dec)
              : `${RATE_STR(Math.max(0, l.value))} ${l.mode === 'per_room_year' ? rateUnit(cur, 'key/yr') : rateUnit(cur, 'sqm/yr')}`;
        return row([
          l.name, OPEX_CATEGORY_LABELS[l.category] ?? String(l.category), OPEX_MODE_LABELS[l.mode] ?? String(l.mode),
          l.rateMode === 'yoy' ? 'YoY' : 'Single', value, opexLineInflationText(l, defaultIndexation), l.disabled ? 'Off' : 'On',
        ]);
      }))));
    const strips: PdfTableRow[] = [];
    if (defaultIndexation.method === 'yoy_per_period') strips.push(windowRow(`${inflationLabel}, Growth %`, padded(defaultIndexation.growthPerPeriod), years, N, 'pct'));
    for (const l of lines) {
      const isPct = String(l.mode).startsWith('pct_');
      if (isFixedCostOpexMode(l.mode) && l.useAssetDefault === false && l.rateMode !== 'yoy' && l.indexation?.method === 'yoy_per_period') {
        strips.push(windowRow(`${l.name}, override inflation Growth %`, padded(l.indexation.growthPerPeriod), years, N, 'pct'));
      }
      if (l.rateMode === 'yoy' && years.length > 0) {
        strips.push(windowRow(`${l.name}, per-year ${isPct ? 'rates' : l.mode === 'fixed_baseline' ? `values (${cur} / year)` : l.mode === 'per_room_year' ? `values (${cur} per key per year)` : `values (${cur} per sqm per year)`}`,
          padded(l.yoyRates), years, N, isPct ? 'pct' : l.mode === 'fixed_baseline' ? 'money' : 'rate'));
      }
    }
    if (strips.length) items.push(tTable(T1, 'inputs', periodTable(`${title}: per-year inputs`, py, yl, strips)));
  };

  // ── Tab 1: Inputs. HQ, the payables card, then one card per line ────────────
  {
    const hqLines = state.project.hqOpex?.lines && state.project.hqOpex.lines.length > 0 ? state.project.hqOpex.lines : defaultHQOpexLines();
    const hqDefault = normalizeOpexIndexation(state.project.hqOpex?.defaultIndexation);
    card('HQ & Corporate Overheads (project-wide)', 'HQ Inflation', hqLines, hqDefault, Array.from({ length: N }, (_, i) => i));
  }
  const opexLines = planReportLines(lineState, (a) => a.strategy === 'Operate' || a.strategy === 'Lease');
  const hosts = opexLines.map((line) => {
    const host = state.assets.find((a) => a.id === line.assetIds[0])!;
    return { host, name: nameOf(host.id, lineTitle(line, lineState)) };
  });
  const hospitality = hosts.filter((h) => h.host.strategy === 'Operate');
  const lease = hosts.filter((h) => h.host.strategy === 'Lease');
  {
    const dflt = state.project.opexAp?.defaultApDays;
    const projectDefault = Math.max(0, dflt ?? 0);
    items.push(tTable(T1, 'inputs', gridTable('Accounts Payable (DPO), project-wide', ['Field', 'Value'], [
      row(['Project Default DPO (days)', dflt !== undefined ? String(dflt) : '0 (cash basis)']),
      row(['Days basis', String(state.project.opexAp?.daysPerYear ?? 365)]),
    ], 'kv')));
    if (hosts.length > 0) {
      items.push(tTable(T1, 'inputs', gridTable('Accounts Payable (DPO), per line', ['Line', 'Effective DPO (days)', 'DPO Override'],
        [...hospitality, ...lease].map(({ host, name }) => {
          const ov = host.opex?.apDaysOverride;
          return row([name, String(ov !== undefined && ov >= 0 ? ov : projectDefault), ov !== undefined ? String(ov) : 'inherit']);
        }))));
    }
  }
  const lineCard = ({ host, name }: { host: Asset; name: string }): void => {
    const badge = host.strategy === 'Lease' ? 'Retail / Lease' : host.isCompanion === true ? 'Hospitality (Manage side)' : 'Hospitality';
    const phaseName = state.phases.find((p) => p.id === host.phaseId)?.name ?? '';
    const parent = host.isCompanion === true && host.parentAssetId ? state.assets.find((x) => x.id === host.parentAssetId) : undefined;
    const title = name;
    const lines = host.opex?.lines ?? [];
    if (lines.length === 0) {
      items.push(tPara(T1, 'inputs', title, `${[badge, phaseName, parent ? `Manage / Operate, linked to ${nameOf(parent.id, parent.name)}` : ''].filter(Boolean).join(', ')}. No opex configured yet for this asset.`));
      return;
    }
    card(title, 'Asset Inflation', lines, normalizeOpexIndexation(host.opex?.defaultIndexation), opsYears(host));
  };
  if (hospitality.length > 0) { items.push(tPara(T1, 'inputs', 'Hospitality', 'One card per Operate line.')); hospitality.forEach(lineCard); }
  if (lease.length > 0) { items.push(tPara(T1, 'inputs', 'Retail / Lease', 'One card per Lease line.')); lease.forEach(lineCard); }

  // ── Tab 2: Opex Output. Statements by section, the project total, AP ───────
  const T2 = M3_TAB.output;
  const tables = buildOpexReport(snap, state);
  for (const section of REVENUE_SECTIONS) {
    const sectionTables = tables.filter((t) => t.lineKey && t.section === section);
    if (sectionTables.length === 0) continue;
    items.push(tPara(T2, 'outputs', section, REVENUE_SECTION_META[section]));
    for (const t of sectionTables) items.push(tTable(T2, 'outputs', m4RowsToPeriodTable(t.title, py, yl, t.rows)));
  }
  for (const t of tables.filter((x) => !x.lineKey)) items.push(tTable(T2, 'outputs', m4RowsToPeriodTable(`Project Total: ${t.title}`, py, yl, t.rows)));

  // THE ACCOUNTS PAYABLE ROLL-FORWARDS, in the screen's row order: opening,
  // opex incurred, less cash paid, closing; one per line, then HQ, then the project.
  const apRoll = (title: string, opening: number[], incurredLabel: string, incurred: number[], cashPaid: number[], closing: number[]): void => {
    items.push(tTable(T2, 'schedules', periodTable(title, py, yl, [
      { cells: ['Opening AP', opening[0] ?? 0, 0, ...opening.slice(0, N)], emphasis: 'subtotal' },
      periodRow(`   ${incurredLabel}`, incurred.slice(0, N), 'sum'),
      periodRow('   Less: Cash Paid', cashPaid.slice(0, N).map((v) => -v), 'sum'),
      periodRow('Closing AP', closing.slice(0, N), 'last', 'total'),
    ])));
  };
  for (const line of planReportLines(lineState, (a) => snap.ap.byAsset.has(a.id))) {
    const members = line.assetIds.map((id) => snap.ap.byAsset.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
    const pooled = poolResults(members);
    const name = nameOf(members[0].assetId, lineTitle(line, lineState));
    apRoll(`Accounts Payable (Opex): ${name}, AP Roll-Forward (DPO ${members[0].effectiveApDays} days)`, pooled.result.openingPerPeriod, 'Opex Incurred', pooled.opexIncurredPerPeriod, pooled.result.cashPaidPerPeriod, pooled.result.perPeriod);
  }
  apRoll(`Accounts Payable (Opex): HQ, AP Roll-Forward (DPO ${snap.ap.hq.apDays} days)`, snap.ap.hq.result.openingPerPeriod, 'HQ Opex Incurred', snap.ap.hq.opexIncurredPerPeriod, snap.ap.hq.result.cashPaidPerPeriod, snap.ap.hq.result.perPeriod);
  const apt = snap.ap.projectTotals;
  apRoll('Accounts Payable (Opex): Project Total, AP Roll-Forward', apt.openingApPerPeriod, 'Opex Incurred', apt.opexIncurredPerPeriod, apt.cashPaidPerPeriod, apt.closingApPerPeriod);

  return items;
}

// ── Module 4: Financial Statements ───────────────────────────────────────────
//
// A COPY OF THE PLATFORM'S MODULE 4, TAB BY TAB (2026-09-17). The screen has four
// tabs: 1. Schedules (sub-tabs Fixed Assets & D&A, BS Schedules), 2. P&L,
// 3. Cash Flow, 4. Balance Sheet. Every table here comes from the builder the
// screen renders (`buildFixedAssetReport`, `buildBsFeederTables`, `buildPLRows`,
// `buildDirectCFRows`, `buildIndirectCFRows`, `buildBSRows`,
// `buildBsReconciliationRows`), with the screen's titles and captions, so no
// table exists here that the platform does not show. The report used to carry
// its own IDC pool and a Working Capital table no screen has, and put the
// integrity checks and the reconciliation bridge on the Schedules tab.

/** The Module 4 tab labels, in the screen's order and with its names. */
const M4_TAB = {
  fixedAssets: 'Tab 1: Schedules / Fixed Assets & D&A',
  bsSchedules: 'Tab 1: Schedules / BS Schedules',
  pl: 'Tab 2: P&L',
  cashFlow: 'Tab 3: Cash Flow',
  balanceSheet: 'Tab 4: Balance Sheet',
} as const;

/** A fixed asset table from the shared builder as a PDF period table. A balance
 *  row's leading cell is its last period and a flow row's the sum, exactly as
 *  the screen prints them; the prior-year cell is blank where the builder gives
 *  none. */
function fixedAssetPdfTable(t: FixedAssetTable, py: number, yl: number[]): PdfTable {
  const N = yl.length;
  const rows: PdfTableRow[] = t.rows.map((r) => {
    const values = r.values.slice(0, N);
    const isLast = r.aggregation === 'last';
    const total = isLast ? (values[values.length - 1] ?? 0) : values.reduce((s, v) => s + (v ?? 0), 0);
    return {
      cells: [`${'   '.repeat(r.indent ?? 0)}${r.label}`, total, r.priorValue ?? null, ...values],
      emphasis: r.isTotal ? 'total' : r.isSubtotal ? 'subtotal' : undefined,
      ...(isLast ? { totalIsBalance: true } : {}),
    };
  });
  return periodTable(t.title, py, yl, rows);
}

function buildModule4(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: Fmt, py: number): ModuleContent {
  const yl = snap.yearLabels;
  const items: ModuleContent = [];
  const project = state.project;
  const labels = getFinancialLabels(project.financialTerminology ?? defaultTerminologyForCountry(project.country));
  const fmtFn = (v: number): string => fmt.money(v);
  const m4ctx = (filterPhaseId: string): { snap: ProjectFinancialsSnapshot; state: FinancialsResolverState; labels: ReturnType<typeof getFinancialLabels>; filterPhaseId: string; fmt: (v: number) => string } =>
    ({ snap, state, labels, filterPhaseId, fmt: fmtFn });
  const hasData = (rows: M4Row[]): boolean => rows.some((r) => r.values.some((v) => v !== 0));
  const caption = (tab: string, part: PartKind, text: string): void => { items.push(tItem(tab, part, { type: 'paragraph', text })); };

  // ── Tab 1: Schedules / Fixed Assets & D&A ──────────────────────────────────
  // The screen's own tables: depreciation inputs, Hospitality / Operations then
  // Retail / Lease (a line in exactly one), each line's Land, Depreciable (with
  // its capitalised interest) and Total Fixed Assets, then the project tables and
  // the IDC pool split between held assets and Sell inventory.
  {
    const tab = M4_TAB.fixedAssets;
    const report = buildFixedAssetReport({ fa: snap.fixedAssets, idc: snap.idc, state, dCtx: disposalContextOf(snap) });
    if (report.inputs.length === 0) {
      items.push(tItem(tab, 'schedules', { type: 'paragraph', text: 'No depreciable assets in this project. Sell-only projects route capex through Cost of Sales (Module 2 Tab 3) instead.' }));
    } else {
      items.push(tTable(tab, 'inputs', {
        title: 'Depreciation Inputs (all assets)', kind: 'grid', align: 'data',
        columns: ['Asset', 'Strategy', 'Method', 'Useful Life (yrs)', 'Rate', 'Opening Land', 'Opening Bldg NBV'],
        rows: report.inputs.map((i) => row([
          i.title,
          i.strategyLabel,
          i.method === 'reducing_balance' ? 'Reducing Balance (WDV)' : 'Straight Line (SL)',
          i.inheritsLife ? `auto: ${i.lifeEffective}` : String(i.lifeStored),
          i.method === 'reducing_balance' ? fmt.pct(i.rateEffective, 2) : (i.lifeEffective > 0 ? `${fmt.pct(i.rateEffective, 2)} / yr` : '-'),
          i.openingLand > 0 ? fmt.money(i.openingLand) : '-',
          i.openingBuilding > 0 ? fmt.money(i.openingBuilding) : '-',
        ])),
      }));
      caption(tab, 'inputs', report.inputsCaption);
    }
    for (const g of report.groups) {
      items.push(tItem(tab, 'schedules', { type: 'paragraph', title: `${g.title} (${g.lines.length} asset${g.lines.length === 1 ? '' : 's'})`, text: g.lines.length === 0 ? g.emptyText : g.meta }));
      for (const l of g.lines) {
        for (const t of [l.land, l.depreciable, l.total]) {
          items.push(tTable(tab, 'schedules', fixedAssetPdfTable(t, py, yl)));
          caption(tab, 'schedules', t.caption);
        }
      }
    }
    items.push(tItem(tab, 'schedules', { type: 'paragraph', title: 'Project Total', text: 'all assets combined' }));
    const proj = report.project;
    for (const t of [proj.land, proj.depreciable, proj.total, ...(proj.idcPool ? [proj.idcPool] : [])]) {
      items.push(tTable(tab, 'schedules', fixedAssetPdfTable(t, py, yl)));
      caption(tab, 'schedules', t.caption);
    }
  }

  // ── Tab 1: Schedules / BS Schedules ────────────────────────────────────────
  // Every schedule that feeds the balance sheet, grouped ASSETS / LIABILITIES /
  // EQUITY as the screen groups them, each with the screen's caption.
  {
    const tab = M4_TAB.bsSchedules;
    const feederCtx: M4FeederCtx = { snap, state, fmt: fmtFn };
    const feeders = buildBsFeederTables(feederCtx);
    for (const sec of BS_FEEDER_SECTIONS) {
      const tables = feeders.filter((t) => t.section === sec.section);
      if (tables.length === 0) continue;
      items.push(tItem(tab, 'schedules', { type: 'paragraph', title: sec.section, text: sec.meta }));
      for (const f of tables) {
        items.push(tTable(tab, 'schedules', m4RowsToPeriodTable(f.title, py, yl, f.rows)));
        caption(tab, 'schedules', f.caption);
      }
    }
  }

  // ── Tab 2: P&L ─────────────────────────────────────────────────────────────
  {
    const tab = M4_TAB.pl;
    items.push(tTable(tab, 'inputs', kvTable('P&L Inputs', [
      ['Terminology mode', (project.financialTerminology ?? defaultTerminologyForCountry(project.country)) === 'saudi' ? 'Saudi (EBITDA / EBIT / Zakat)' : 'Standard (EBITDA / EBIT / Tax)'],
      [`${labels.taxRate} (%)`, fmt.pct(project.tax?.rate ?? 0, 2)],
      [`${labels.tax} on the disposal gain`, project.tax?.applyToDisposalGain === true ? 'Charged on the gain at exit' : 'Not charged (default)'],
    ])));
    caption(tab, 'outputs', `Strategy-grouped P&L composed from Module 2 Revenue and Cost of Sales, Module 3 Opex, depreciation and Module 1 financing interest. The project statement runs down to ${labels.pat}; a single phase stops at ${labels.ebitda}, since D&A, interest and tax are project level.`);
    items.push(tTable(tab, 'outputs', m4RowsToPeriodTable(`${labels.incomeStatementTitle}: Project`, py, yl, buildPLRows(m4ctx('__all__')))));
    // Fund Fee Basis, beneath the consolidated statement only (the fees are
    // project level), with the screen's title, caption, capital bases, columns
    // and Total row. A grid, never a period table: a base is a stock.
    const basis = buildFundFeeBasisRows(snap);
    if (basis.length > 0) {
      const capital = buildFundCapitalRows(snap);
      if (capital.length > 0) {
        items.push(tTable(tab, 'outputs', {
          title: FUND_CAPITAL_BASES_TITLE, kind: 'grid', align: 'data',
          columns: ['Capital base', 'Amount', 'How it is resolved'],
          rows: capital.map((c) => row([c.isTotal ? `= ${c.label}` : c.label, fmt.money(c.amount), c.note], c.isTotal ? 'subtotal' : undefined)),
        }));
        caption(tab, 'outputs', FUND_CAPITAL_BASES_NOTE);
      }
      items.push(tTable(tab, 'outputs', {
        title: FUND_FEE_BASIS_TITLE, kind: 'grid', align: 'data',
        columns: ['Fee', 'Timing', 'Base', 'Rate', 'Basis', 'Fee Charged'],
        rows: [
          ...basis.map((b) => row([b.label, b.timing, b.base, b.rate, fundFeeBasisText(b, fmt.money), fmt.money(b.charged)])),
          row(['Total', '', '', '', '', fmt.money(basis.reduce((s, b) => s + b.charged, 0))], 'total'),
        ],
      }));
      caption(tab, 'outputs', FUND_FEE_BASIS_CAPTION);
      const notes = basis
        .filter((b) => b.note && b.base !== 'Flat amount')
        .filter((b, i, all) => all.findIndex((x) => x.base === b.base) === i);
      for (const b of notes) caption(tab, 'outputs', `${b.base}: ${b.note}`);
    }
    for (const ph of state.phases) {
      const rows = buildPLRows(m4ctx(ph.id));
      if (hasData(rows)) items.push(tTable(tab, 'outputs', m4RowsToPeriodTable(`${labels.incomeStatementTitle}: ${ph.name}`, py, yl, rows)));
    }
  }

  // ── Tab 3: Cash Flow ───────────────────────────────────────────────────────
  // Both methods for the project, then every phase's Operations + Investing from
  // the phase's own rows (financing is raised and serviced at the project level).
  {
    const tab = M4_TAB.cashFlow;
    caption(tab, 'outputs', `The Direct method is literal cash in and out; the Indirect method reconstructs cash from ${labels.pat} through D&A and working capital changes. The project statement runs Operations, Investing and Financing and both methods end on the same Net Cash Flow; a single phase shows its Operating and Investing activities only.`);
    items.push(tTable(tab, 'outputs', m4RowsToPeriodTable('Cash Flow, Direct Method (project)', py, yl, buildDirectCFRows(m4ctx('__all__')))));
    items.push(tTable(tab, 'outputs', m4RowsToPeriodTable('Cash Flow, Indirect Method (project)', py, yl, buildIndirectCFRows(m4ctx('__all__')))));
    // A phase prints the DIRECT method only. The screen's per-phase Indirect view
    // starts from the PROJECT profit (its rows say "(project)") and adds the
    // phase's own working capital to it, so its Cash Flow from Operations is not
    // the phase's (FMP - MARINA GATE Phase 1: 1,456.0m against 1,080.5m direct).
    // Printing it would put a wrong subtotal in a document; the workbook makes the
    // same choice.
    for (const ph of state.phases) {
      const direct = buildDirectCFRows(m4ctx(ph.id));
      if (!hasData(direct)) continue;
      items.push(tTable(tab, 'outputs', m4RowsToPeriodTable(`Cash Flow, Direct Method (${ph.name})`, py, yl, direct)));
    }
  }

  // ── Tab 4: Balance Sheet ───────────────────────────────────────────────────
  {
    const tab = M4_TAB.balanceSheet;
    const dso = project.operatingAr?.dsoDays;
    items.push(tTable(tab, 'inputs', kvTable('Working Capital Inputs', [
      ['Operating AR Days (DSO)', dso === undefined ? '0 (cash basis)' : String(dso)],
    ])));
    items.push(tTable(tab, 'inputs', kvTable('Equity Inputs', [
      ['Statutory Reserve Transfer Rate (% of PAT)', fmt.pct(project.statutoryReserve?.transferRate ?? 0, 2)],
      ['Reserve Cap (% of Share Capital)', fmt.pct(project.statutoryReserve?.capOfShareCapital ?? 0, 2)],
      ['Share Capital (optional override)', project.shareCapital === undefined ? 'auto: cumulative equity drawdowns' : fmt.money(project.shareCapital)],
    ])));
    caption(tab, 'outputs', 'Composed from every feeder schedule (AR, Inventory, AP, Unearned, Escrow, Fixed Assets, Debt and Equity). Cash is the plug from the Direct Cash Flow Statement. The BS Check at the bottom reads 0 in every period when the statement balances.');
    items.push(tTable(tab, 'outputs', m4RowsToPeriodTable('Balance Sheet: Project', py, yl, buildBSRows(m4ctx('__all__')).rows)));
    // The balance check: the three model identities, beside the statement they test.
    items.push(tTable(tab, 'outputs', checksTable(snap, fmt, state)));
    items.push(tTable(tab, 'outputs', m4RowsToPeriodTable('Balance Check, Reconciliation Bridge (per period)', py, yl, buildBsReconciliationRows({ snap, state, fmt: fmtFn }))));
    caption(tab, 'outputs', BS_RECONCILIATION_CAPTION);
  }

  return items;
}

// ── Module 5: Returns & Valuation ────────────────────────────────────────────
function buildModule5(returns: ReturnsSnapshot, snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: Fmt, py: number, caseReport: CaseComparisonReport | null, includeSensitivity = false): ModuleContent {
  const r = returns.result;
  const re = r.realEstate;
  const cfg = returns.config;
  const syl = returns.streamYearLabels;
  const yl = returns.yearLabels;
  const items: ModuleContent = [];
  const assetNotes = buildAssetNotes(state, fmt.money);

  // TAB NUMBERS ARE DERIVED, not written down. Case Comparison only exists when
  // there are at least two cases, and with the numbers hardcoded every project
  // without scenarios (the default) printed running headers and a table of
  // contents reading "Tab 1, Tab 2, Tab 4, Tab 5", which reads as a missing
  // section rather than an absent one.
  const m5Present: string[] = ['Returns', 'RE Metrics'];
  const hasCaseComparison = !!caseReport && caseReport.columns.length > 1;
  if (hasCaseComparison) m5Present.push('Case Comparison');
  m5Present.push('Cash Flow Streams');
  if (isFundActive(returns)) m5Present.push('Fund Layer');
  const m5Tab = (name: string): string => {
    const i = m5Present.indexOf(name);
    return i < 0 ? name : `Tab ${i + 1}: ${name}`;
  };
  const streamPrior = syl[0] ?? py;
  const streamYears = syl.slice(1);

  // Tab 1: Returns (KPI cards + tables).
  // TERMINAL VALUE: show only the parameter the method uses (2026-09-15). This
  // tested "perpetuity or not", so a cap rate method printed "Exit multiple" with
  // the exit multiple "applied", which is not what struck the terminal value.
  const tm = String(cfg.terminalMethod);
  const capCfg = cfg as { capRate?: number; capRateDerived?: number; capRateSource?: string };
  const capDerived = capCfg.capRateSource === 'derived';
  const methodRows: Array<[string, string]> = tm === 'perpetuity'
    ? [['Terminal value method', 'Perpetuity growth (Gordon)'], ['Perpetuity growth', fmt.pct(cfg.perpetuityGrowth, 2)]]
    : tm === 'cap_rate'
      ? [['Terminal value method', 'Cap rate on stabilised NOI'],
        [capDerived ? 'Cap rate (derived from the model)' : 'Cap rate (typed)', fmt.pct((capDerived ? capCfg.capRateDerived : capCfg.capRate) ?? 0, 2)]]
      : tm === 'none'
        ? [['Terminal value method', 'None']]
        : [['Terminal value method', 'Exit multiple'], ['Exit multiple', `${(cfg.exitMultiple ?? 0).toFixed(2)}x`]];
  items.push(tTable(m5Tab('Returns'), 'inputs', kvTable('Returns Assumptions', [
    ['Discount rate', fmt.pct(cfg.discountRate, 2)],
    ['Exit year', String(returns.exitYearLabel)],
    ...methodRows,
  ])));

  items.push(tCards(m5Tab('Returns'), 'outputs', 'Headline Returns', headlineReturnCards(returns, fmt)));
  {
    const note = headlineBasisNote(returns, fmt);
    if (note) items.push(tItem(m5Tab('Returns'), 'outputs', { type: 'paragraph', text: note }));
  }

  const de = returns.developmentEconomics;
  items.push(tCards(m5Tab('Returns'), 'outputs', 'Development Economics (appraisal basis)', [
    { label: 'GDV', value: fmt.money(de.gdv), sub: 'gross development value' },
    { label: 'Total Dev Cost', value: fmt.money(de.totalDevelopmentCost), sub: 'incl. land' },
    { label: 'Financing Cost', value: fmt.money(de.totalFinancingCost), sub: 'interest + fees' },
    { label: 'Profit Before Fin.', value: fmt.money(de.profitBeforeFinancing), sub: 'GDV less dev cost' },
    { label: 'Profit After Fin.', value: fmt.money(de.profitAfterFinancing), sub: 'less financing cost' },
    { label: 'Development Margin', value: fmt.pct(de.developmentMargin, 1), sub: 'profit after fin. / GDV' },
  ]));
  // A development APPRAISAL and an accounting P&L answer different questions,
  // and the report printed both without saying so: profit after financing and
  // profit after tax sat 3.6x apart on adjacent pages with nothing between
  // them. This states the bridge.
  items.push(tItem(m5Tab('Returns'), 'outputs', { type: 'paragraph', text:
    `Appraisal basis, not the P&L. Profit after financing (${fmt.money(de.profitAfterFinancing)}) is GDV less development cost less financing cost, `
    + `and it excludes operating expenses, depreciation and tax. The P&L's profit after tax over the same horizon is `
    + `${fmt.money(sum(snap.pl.patPerPeriod))}; the difference is operating expenses (${fmt.money(sum(snap.pl.totalOpexPerPeriod))}), `
    + `depreciation (${fmt.money(sum(snap.pl.daPerPeriod))}) and tax (${fmt.money(sum(snap.pl.taxPerPeriod))}), which an appraisal does not deduct. `
    + `Development Margin is measured on GDV; Profit Margin on the RE Metrics page is profit after tax over total revenue.` }));

  const ex = returns.exitAnalysis;
  items.push(tCards(m5Tab('Returns'), 'outputs', `Exit Analysis (${ex.exitYearLabel})`, [
    { label: 'Exit NOI', value: fmt.money(ex.exitNOI) },
    { label: 'Exit EBITDA', value: fmt.money(ex.exitEBITDA) },
    { label: 'Enterprise Value', value: fmt.money(ex.exitEnterpriseValue) },
    { label: 'Equity Value', value: fmt.money(ex.exitEquityValue) },
    { label: 'Debt at Exit', value: fmt.money(ex.exitDebt) },
    { label: 'LTV at Exit', value: fmt.pct(ex.ltvAtExit, 1) },
  ]));
  const su = returns.sourcesUses;
  items.push(tTable(m5Tab('Returns'), 'outputs', {
    title: 'Sources & Uses', kind: 'grid', align: 'data', columns: ['Sources', 'Amount', 'Uses', 'Amount'],
    rows: [
      row(['Existing equity', fmt.money(su.existingEquity), 'Land', fmt.money(su.land)]),
      row(['New equity (cash)', fmt.money(su.newEquityCash), 'Construction', fmt.money(su.construction)]),
      row(['In-kind equity', fmt.money(su.inKindEquity), 'IDC', fmt.money(su.idc)]),
      row(['Existing debt', fmt.money(su.existingDebt), 'Reserves / distributions', fmt.money(su.reservesDistributions)]),
      row(['New debt', fmt.money(su.newDebt), '', '']),
      row(['Customer collections', fmt.money(su.customerCollections), '', '']),
      row(['Operating cash', fmt.money(su.operatingCash), '', '']),
      row(['Total sources', fmt.money(su.totalSources), 'Total uses', fmt.money(su.totalUses)], 'total'),
    ],
  }));
  const ee = returns.equityExposure;
  const da = returns.debtAnalytics;
  items.push(tCards(m5Tab('Returns'), 'outputs', 'Equity Exposure & Debt Analytics', [
    { label: 'Total Equity Required', value: fmt.money(ee.totalEquityRequired) },
    { label: 'Avg Equity Invested', value: fmt.money(ee.averageEquityInvested) },
    { label: 'Equity at Risk', value: fmt.money(ee.equityAtRisk) },
    { label: 'Peak Debt', value: fmt.money(da.peakDebt) },
    { label: 'Debt Paydown', value: fmt.pct(da.paydownPct, 1) },
    { label: 'Debt Tenor', value: da.tenorYears === null ? 'n/a' : `${da.tenorYears.toFixed(0)} yrs` },
  ]));
  // Exit-year analysis (Pass 2) as a table.
  if (returns.exitYears?.length) {
    items.push(tTable(m5Tab('Returns'), 'outputs', {
      title: 'Exit-Year Analysis (hold vs sell)', kind: 'grid', align: 'data',
      columns: ['Exit Year', 'Enterprise Value', 'Equity Value', 'Project IRR', 'Equity IRR', 'Equity MOIC'],
      rows: returns.exitYears.map((x) => row([
        `${x.exitYearLabel}${x.isSelected ? ' (selected)' : ''}`, fmt.money(x.enterpriseValue), fmt.money(x.equityValue),
        fmt.pct(x.fcffIrr, 1), fmt.pct(x.fcfeIrr, 1), fmt.mult(x.equityMoic),
      ], x.isSelected ? 'subtotal' : undefined)),
    }));
  }
  // Partners (Pass 2) if present.
  if (returns.partners?.partners.length) {
    items.push(tTable(m5Tab('Returns'), 'outputs', {
      title: 'Equity Partners', kind: 'grid', align: 'data',
      columns: ['Partner', 'Invested', 'Share %', 'Dividends', 'Terminal', 'IRR', 'MOIC'],
      rows: returns.partners.partners.map((pn) => row([pn.name, fmt.money(pn.totalEquityInvested), fmt.pct(pn.shareholdingPct, 1), fmt.money(pn.dividendsReceived), fmt.money(pn.terminalDistribution), fmt.pct(pn.irr, 1), fmt.mult(pn.moic)])),
    }));
  }

  // Tab 2: RE Metrics (cards + coverage + per-asset).
  items.push(tCards(m5Tab('RE Metrics'), 'outputs', 'Profitability & Yield', [
    { label: 'Yield on Cost', value: fmt.pct(re.yieldOnCost, 2), sub: 'stabilised NOI / total cost' },
    { label: 'Cap Rate at Exit', value: fmt.pct(re.capRateAtExit, 2), sub: 'exit NOI / exit value' },
    { label: 'Development Spread', value: fmt.pct(re.developmentSpread, 2), sub: 'yield on cost less exit cap' },
    { label: 'Profit on Cost', value: fmt.pct(re.profitOnCost, 1), sub: 'appraisal profit / dev cost' },
    { label: 'Profit Margin', value: fmt.pct(re.profitMargin, 1), sub: 'profit after tax / revenue' },
    { label: 'Equity Multiple (distributions)', value: fmt.mult(re.equityMultiple), sub: 'distributions / invested' },
  ]));

  const dscrYears = re.dscrPerPeriod.filter((v) => v > 0);
  const dscrBelow = dscrYears.filter((v) => v < 1).length;
  items.push(tCards(m5Tab('RE Metrics'), 'outputs', 'Leverage & Coverage', [
    { label: 'LTV at Exit', value: fmt.pct(re.ltvAtExit, 1), sub: 'debt / value at exit' },
    { label: 'Debt Yield', value: fmt.pct(re.debtYield, 1), sub: 'NOI / debt' },
    { label: 'Min DSCR', value: fmt.mult(re.dscrMin), sub: dscrBelow > 0 ? `below 1.00x in ${dscrBelow} of ${dscrYears.length} yrs` : 'worst debt-service year' },
    { label: 'Avg DSCR', value: fmt.mult(re.dscrAvg), sub: 'mean over debt-service years' },
    { label: 'Min Interest Cover', value: fmt.mult(re.icrMin), sub: 'EBITDA / interest' },
    { label: 'Avg Cash-on-Cash', value: fmt.pct(re.cashOnCashAvg, 1), sub: 'distributions / equity' },
  ]));
  // A sub-1.00x DSCR is a COVENANT READING, not one more metric in the column.
  // The workbook paints it in the check red and says so; the PDF said nothing.
  if (dscrBelow > 0) {
    items.push(tItem(m5Tab('RE Metrics'), 'outputs', { type: 'paragraph', text:
      `Debt service is not covered from operations in ${dscrBelow} of ${dscrYears.length} debt-service years `
      + `(minimum ${fmt.mult(re.dscrMin)}). Typical for a development funded from drawdowns, but it is a covenant `
      + `reading, not a neutral metric. Interest cover over the same years runs ${fmt.mult(re.icrMin)} to ${fmt.mult(Math.max(...re.icrPerPeriod))}, `
      + `so interest is covered and the amortisation is not.` }));
  }

  if (anyNonZero(re.dscrPerPeriod) || anyNonZero(re.icrPerPeriod)) {
    items.push(tTable(m5Tab('RE Metrics'), 'outputs', periodTable('Coverage Ratios by Year', py, yl, [
      strPeriodRow('DSCR', re.dscrPerPeriod.map((v) => (v ? v.toFixed(2) : '-'))),
      strPeriodRow('Interest cover', re.icrPerPeriod.map((v) => (v ? v.toFixed(2) : '-'))),
      strPeriodRow('Cash-on-cash %', re.cashOnCashPerPeriod.map((v) => (v ? fmt.pct(v, 1) : '-'))),
    ])));
  }
  // Lender Covenants: the SAME pure evaluator the M5 screen and the workbook
  // use (lib/covenants.ts), so a threshold cannot mean one thing on screen and
  // another in the file. Seeded defaults when the project has none.
  {
    const covInputs: CovenantInputs = {
      dscrPerPeriod: re.dscrPerPeriod,
      icrPerPeriod: re.icrPerPeriod,
      noiPerPeriod: returns.noiPerPeriod,
      debtOutstandingPerPeriod: snap.bs.debtOutstandingPerPeriod,
      gdvValue: de.gdv,
      ltvAtExit: re.ltvAtExit,
    };
    const covs = state.project.covenants ?? DEFAULT_COVENANTS;
    const evals = covs.map((c) => ({ c, ev: evaluateCovenant(c, covInputs) }));
    const shown = evals.filter(({ ev }) => ev.pass !== null);
    if (shown.length) {
      const val = (v: number | null, unit: 'x' | 'pct'): string =>
        v === null ? 'n/a' : unit === 'x' ? fmt.mult(v) : fmt.pct(v, 1);
      items.push(tTable(m5Tab('RE Metrics'), 'outputs', {
        title: 'Lender Covenants (threshold vs modelled)', kind: 'grid', align: 'data',
        columns: ['Covenant', 'Test', 'Threshold', 'Modelled (binding)', 'Average', 'Status'],
        rows: shown.map(({ c, ev }) => row([
          c.label,
          c.operator === 'min' ? 'minimum' : 'maximum',
          val(c.threshold, ev.unit),
          val(ev.worst, ev.unit),
          val(ev.avg, ev.unit),
          ev.pass ? 'Pass' : 'BREACH',
        ], ev.pass ? undefined : 'subtotal')),
      }));
      const breached = shown.filter(({ ev }) => ev.pass === false);
      if (breached.length) {
        items.push(tItem(m5Tab('RE Metrics'), 'outputs', { type: 'paragraph', text:
          `${breached.length} of ${shown.length} covenants ${breached.length === 1 ? 'is' : 'are'} breached on the modelled case: `
          + `${breached.map(({ c, ev }) => `${c.label} (${val(ev.worst, ev.unit)} against a ${c.operator === 'min' ? 'minimum' : 'maximum'} of ${val(c.threshold, ev.unit)})`).join(', ')}.` }));
      }
    }
  }
  if (returns.perAsset?.rows.length) {
    // A zero cost with a 100% margin is not an error on an existing operational
    // asset (its cost was spent before the model starts) or on a companion (the
    // cost sits on the parent). Same markers and footnotes as the composition
    // table, so a reader who met "[a]" on page 2 does not have to relearn it.
    items.push(tTable(m5Tab('RE Metrics'), 'outputs', {
      title: 'Per-Line Economics', kind: 'grid', align: 'data',
      columns: ['Line', 'Strategy', 'Revenue', 'Cost', 'Profit', 'Margin', 'Yield on Cost'],
      rows: poolReturnRows(returns.perAsset.rows, state).map((a) => {
        const z = assetNotes.hasCostNote(a.assetId, a.totalCost);
        const nil = z ? structuralZeroCell(z) : null;
        return row([
          a.assetName, a.strategy, fmt.money(a.totalRevenue),
          nil ?? fmt.money(a.totalCost),
          fmt.money(a.profit),
          nil ?? fmt.pct(a.profitMargin, 1),
          nil ?? (a.isIncomeAsset ? fmt.pct(a.yieldOnCost, 1) : 'n/a'),
        ]);
      }),
    }));
    for (const fn of assetNotes.takeFootnotes()) items.push(tItem(m5Tab('RE Metrics'), 'outputs', { type: 'paragraph', text: fn.text }));
  }

  // SENSITIVITY. On the M5 Returns tab and in NEITHER export. Gated, because
  // sensitivity is an entitlement feature: an export must not carry what the
  // plan cannot open on screen.
  if (includeSensitivity) {
    try {
      const grid = computeReturnsSensitivity(snap, state.project, 'exit_cap_rate', 'sales_price_pct');
      const pctLabel = (v: number): string => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
      items.push(tTable(m5Tab('Returns'), 'outputs', {
        title: 'Two-Way Sensitivity, Equity IRR (FCFE): sales price vs exit cap rate',
        kind: 'grid', align: 'data',
        columns: ['Sales price \ Exit cap', ...grid.xValues.map((x) => fmt.pct(x, 2))],
        rows: grid.yValues.map((y, yi) => row([
          pctLabel(y),
          ...grid.xValues.map((_, xi) => fmt.pct(grid.irr[yi]?.[xi] ?? null, 1)),
        ])),
      }));
      items.push(tItem(m5Tab('Returns'), 'outputs', { type: 'paragraph', text:
        `Base Equity IRR ${fmt.pct(grid.baseEquityIrr, 1)} at the implied exit cap rate of ${fmt.pct(grid.impliedExitCapRate, 2)}. `
        + 'Each cell re-runs the model with both shocks applied.' }));
    } catch { /* sensitivity is optional; never block the report */ }
  }

  // Tab 3: Case Comparison. Headline KPIs across every case (Management base +
  // scenarios), with each scenario's delta vs the base in the same cell. Reads
  // the SHARED builder (lib/reports/caseComparisonReport.ts) that also feeds the
  // on-screen Case Comparison tab. Only rendered when there is more than one
  // case to compare.
  const m5Matrix = caseReport ? buildCaseComparisonMatrix(caseReport, fmt) : null;
  if (m5Matrix) items.push(tTable(m5Tab('Case Comparison'), 'outputs', m5Matrix));

  // Tab 4: Cash Flow Streams.
  const bu = returns.buildup;
  items.push(tTable(m5Tab('Cash Flow Streams'), 'schedules', periodTable('Sponsor Cash-Flow Streams', streamPrior, streamYears, [
    periodRow('FCFF (unlevered)', returns.fcffPerPeriod.slice(1), 'sum', undefined, returns.fcffPerPeriod[0] ?? 0),
    periodRow('FCFE (levered)', returns.fcfePerPeriod.slice(1), 'sum', undefined, returns.fcfePerPeriod[0] ?? 0),
    periodRow('Distributed equity', returns.dividendStreamPerPeriod.slice(1), 'sum', undefined, returns.dividendStreamPerPeriod[0] ?? 0),
  ])));
  // BUILD-UP ROWS COME FROM THE SHARED BUILDER (lib/reports/streamReports.ts).
  // This file used to carry a fourth hand-maintained copy, and it was the one
  // that drifted: it started from FCFF, which already contains the terminal
  // ENTERPRISE value, then added the terminal EQUITY value on top, so the
  // column was short by the terminal value in every period it appeared.
  const pdfStreamRow = (label: string, series: number[], opts: { indent?: number; isTotal?: boolean }): M4Row =>
    ({ label, values: series.slice(1), priorValue: series[0] ?? 0, indent: opts.indent, isTotal: opts.isTotal });
  items.push(tTable(m5Tab('Cash Flow Streams'), 'schedules',
    m4RowsToPeriodTable('FCFF Build-up', streamPrior, streamYears, buildFcffBuildup(returns, pdfStreamRow))));
  items.push(tTable(m5Tab('Cash Flow Streams'), 'schedules',
    m4RowsToPeriodTable('FCFE Build-up', streamPrior, streamYears, buildFcfeBuildup(returns, pdfStreamRow))));
  items.push(tTable(m5Tab('Cash Flow Streams'), 'schedules',
    m4RowsToPeriodTable('Distributed Equity Build-up', streamPrior, streamYears, buildDividendBuildup(returns, pdfStreamRow))));

  // Tab 5: Fund Layer. Renders ONLY when the fund toggle is on, so a standalone
  // project produces exactly the tabs it did before. Every row comes from the
  // shared fundReports builders, the same ones the M5 screen and the Excel
  // workbook use, so the reference row order has one definition.
  for (const piece of buildFundBlock(snap, returns, state, fmt, py)) {
    if (piece.cards) items.push(tCards(m5Tab('Fund Layer'), 'outputs', piece.title, piece.cards));
    else if (piece.table) items.push(tTable(m5Tab('Fund Layer'), 'outputs', piece.table));
    else if (piece.note) items.push(tItem(m5Tab('Fund Layer'), 'outputs', { type: 'paragraph', text: piece.note }));
  }

  return items;
}

// ── Module 6: Scenario Analysis ─────────────────────────────────────────────
/** Module 6 (Scenarios) PDF content, built from the SAME shared case report
 *  builders that feed the on-screen Module 6 (comparison matrix + year-on-year
 *  impact). Renders three tabs: Cases & Assumptions (inputs), Scenario Comparison
 *  (outputs), Year-on-Year Impact (schedules). Degrades to a short note when the
 *  project has no scenario cases, so a selected Module 6 page is never blank. */
function buildModule6(caseReport: CaseComparisonReport | null, caseYoY: CaseYoYReport | null, fmt: Fmt): ModuleContent {
  const items: ModuleContent = [];
  const cols = caseReport?.columns ?? [];
  const hasScenarios = cols.length > 1;

  // Tab 1: Cases & Assumptions.
  if (cols.length) {
    items.push(tTable('Tab 1: Cases & Assumptions', 'inputs', {
      title: 'Cases', kind: 'grid', align: 'data',
      columns: ['Case', 'Type', 'Active', 'Overrides'],
      rows: cols.map((c) => row(
        [c.name, c.role === 'base' ? 'Management (base)' : 'Scenario', c.isActive ? 'Yes' : '', c.role === 'base' ? '-' : (c.overrideCount === 0 ? '0 (same as Management)' : fmt.int(c.overrideCount))],
        c.role === 'base' ? 'subtotal' : undefined,
      )),
    }));
  }
  // Assumptions that differ across cases, one row per diverging lever (drawn from
  // the shared year-on-year report's input blocks, so it matches Module 6).
  if (caseYoY && caseYoY.blocks.length) {
    const order = caseYoY.blocks[0].inputs[0]?.byCase.map((v) => ({ id: v.id, name: v.name })) ?? [];
    if (order.length) {
      const rows: PdfTableRow[] = [];
      for (const b of caseYoY.blocks) {
        for (const line of b.inputs) {
          const byId = new Map(line.byCase.map((v) => [v.id, v.value] as const));
          rows.push(row([line.label, ...order.map((o) => formatAssumptionValue(byId.get(o.id) ?? null, line.format))]));
        }
      }
      if (rows.length) {
        items.push(tTable('Tab 1: Cases & Assumptions', 'inputs', {
          title: 'Assumptions that differ across scenarios', kind: 'grid', align: 'data',
          columns: ['Assumption', ...order.map((o) => o.name)], rows,
        }));
      }
    }
  }

  // Tab 2: Scenario Comparison (headline KPI matrix, delta vs base).
  const matrix = caseReport ? buildCaseComparisonMatrix(caseReport, fmt) : null;
  if (matrix) items.push(tTable('Tab 2: Scenario Comparison', 'outputs', matrix));

  // Tab 3: Year-on-Year Impact: for each driven output, the base series and each
  // scenario's per-period delta vs base.
  if (caseYoY && caseYoY.blocks.length && hasScenarios) {
    const yPrior = caseYoY.priorYearLabel;
    const yl = caseYoY.yearLabels;
    for (const b of caseYoY.blocks) {
      for (const o of b.outputs) {
        const total = o.kind === 'flow' ? 'sum' : 'last';
        const rows: PdfTableRow[] = [periodRow(`${o.base.name} (base)`, o.base.values, total, 'subtotal', o.base.prior)];
        for (const d of o.deltas) rows.push(periodRow(`change, ${d.name}`, d.values, total, undefined, d.prior));
        items.push(tTable('Tab 3: Year-on-Year Impact', 'schedules', periodTable(`${b.inputLabel}, ${o.label}`, yPrior, yl, rows)));
      }
    }
  }

  // No scenarios defined: a short note so the page is never blank when selected.
  if (!items.length) {
    items.push(tTable('Tab 1: Cases & Assumptions', 'inputs', kvTable('Scenario Analysis', [
      ['Scenarios defined', 'None'],
      ['Note', 'Add scenario cases in Module 6 to compare assumptions and outcomes here.'],
    ])));
  }
  return items;
}

// ── Assembly ──────────────────────────────────────────────────────────────────
function includePart(flag: boolean | undefined): boolean { return flag !== false; }

/** Whether an item has renderable data, so genuinely-empty items (a header with
 *  no body) are suppressed. Deliberately MINIMAL so it can never mask a mis-wired
 *  data source: a table is dropped ONLY when it has zero rows, and cards only when
 *  every value is blank / n/a. A table that has rows but blank cells still renders
 *  (a mis-wired feeder that returns rows-of-blanks stays VISIBLE, so the bug is
 *  surfaced, not hidden). Paragraphs always render. */
function hasItemData(item: PdfItem): boolean {
  if (item.type === 'table') return item.table.rows.length > 0;
  if (item.type === 'cards') return item.cards.some((c) => !!c.value && c.value.trim() !== '' && c.value.trim().toLowerCase() !== 'n/a');
  return true;
}
/** Drop genuinely-empty items from a module's content (see hasItemData). */
function dropEmptyItems(content: ModuleContent): ModuleContent { return content.filter((ti) => hasItemData(ti.item)); }

/** The subset of a module's content that will actually render given the part
 *  selection (Inputs/Schedules/Outputs) + the per-tab selection. Mirrors the
 *  filters in renderModule, so the caller can tell whether a module renders
 *  anything at all (and therefore whether to give it a nav entry). */
/**
 * A tab's IDENTITY is its name; the leading "Tab N: " is presentation and is
 * now derived (Module 5 renumbers when Case Comparison or Fund Layer is
 * absent). Comparing the full numbered label against the static picker
 * manifest would silently DROP a tab whose number moved, so both sides are
 * compared on the name.
 */
export function pdfTabKey(label: string): string {
  return label.replace(/^Tab \d+:\s*/, '').trim();
}

function renderableContent(content: ModuleContent, sel: ModuleSectionSelection, selectedTabs?: string[]): ModuleContent {
  const wanted = selectedTabs ? new Set(selectedTabs.map(pdfTabKey)) : null;
  return content.filter((it) => includePart(sel[it.part]) && (!wanted || wanted.has(pdfTabKey(it.tab))));
}

/** Placeholder page for a module that is on the roadmap but not built yet, so
 *  the exported report covers the whole platform. Lists the planned content from
 *  the registry; fills in with real content automatically once the module ships. */
function renderPlaceholderModule(ctx: Ctx, m: ModuleConfig): void {
  const header = `Module ${m.num}: ${m.longLabel}`;
  newPage(ctx, header);
  ctx.currentHeader = header;
  ctx.y -= 36;
  drawCell(ctx, m.longLabel, MARGIN, CONTENT_W, ctx.y, { font: ctx.bold, size: 20, color: NAVY_DARK });
  ctx.y -= 24;
  // Status pill (Coming soon / Requires Professional / Enterprise).
  const status = m.disabledReason ?? 'In development';
  const pillW = ctx.bold.widthOfTextAtSize(status, 9) + 16;
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 2, width: pillW, height: 16, color: PART_FILL });
  drawCell(ctx, status, MARGIN, pillW, ctx.y, { font: ctx.bold, size: 9, color: NAVY_DARK });
  ctx.y -= 28;
  drawParagraph(ctx, 'This module is on the platform roadmap. Its inputs, outputs and schedules will appear here automatically once it ships, so this report always reflects the full platform.', 10);
  ctx.y -= 6;
  if (m.plannedContent?.length) {
    drawCell(ctx, 'Planned content', MARGIN, CONTENT_W, ctx.y, { font: ctx.bold, size: 11, color: NAVY_DARK });
    ctx.y -= 18;
    for (const b of m.plannedContent) {
      ensureSpace(ctx, 16);
      drawCell(ctx, `•  ${b}`, MARGIN + 10, CONTENT_W - 10, ctx.y, { size: 10, color: TEXT });
      ctx.y -= 16;
    }
  }
}

function renderModule(ctx: Ctx, moduleLabel: string, items: ModuleContent, sel: ModuleSectionSelection, fmt: Fmt, selectedTabs?: string[]): void {
  // Group by tab (stable order), keeping only selected parts (and, when given,
  // only the selected tabs).
  const order: string[] = [];
  const byTab = new Map<string, TaggedItem[]>();
  for (const it of items) {
    if (!includePart(sel[it.part])) continue;
    if (selectedTabs && !selectedTabs.map(pdfTabKey).includes(pdfTabKey(it.tab))) continue;
    if (!byTab.has(it.tab)) { byTab.set(it.tab, []); order.push(it.tab); }
    byTab.get(it.tab)!.push(it);
  }
  for (const tab of order) {
    const tabItems = byTab.get(tab)!;
    const header = `${moduleLabel}  ·  ${tab}`;
    newPage(ctx, header);
    ctx.currentHeader = header;
    // Record the FIRST page of this tab as its nav anchor (overflow pages created
    // later by ensureSpace are not re-recorded).
    recordTabAnchor(ctx, tab);
    let curPart: PartKind | null = null;
    for (const part of ['inputs', 'outputs', 'schedules'] as PartKind[]) {
      const partItems = tabItems.filter((i) => i.part === part);
      for (const ti of partItems) {
        if (ti.part !== curPart) { drawPartHeader(ctx, PART_LABEL[part], part === 'inputs' ? 'Shaded cells are model inputs / assumptions' : undefined); curPart = ti.part; }
        drawItem(ctx, ti.item, fmt, ti.part === 'inputs');
      }
    }
  }
}

// ── Navigation aids: ToC + section breaks + PDF outline (full report only) ─────
// pdf-lib has no high-level ToC/outline/link API, so these are built from the
// low-level object model: link annotations (GoTo actions with explicit page
// refs) + a hand-built /Outlines tree. Invisible custom page-dict markers
// (REFMNav / REFMTab) make the structure verifiable without decoding page text
// (the embedded font is drawn as glyph ids, not ASCII). Purely ADDITIVE: content,
// figures, and module/tab numbering are untouched; only nav pages + annotations
// are added (physical footer page numbers renumber sequentially to absorb them).
const REFM_NAV_KEY = PDFName.of('REFMNav');
const REFM_TAB_KEY = PDFName.of('REFMTab');
const NAV_LINK = rgb(0.11, 0.31, 0.54); // navy link text
const NAV_MUTED = rgb(0.42, 0.46, 0.52);

function markPage(page: PDFPage, key: PDFName, value: string): void {
  page.node.set(key, PDFHexString.fromText(value));
}

/** Record the current page as a tab's nav anchor (called by renderModule at each
 *  tab's first page). No-op when nav is disabled. */
function recordTabAnchor(ctx: Ctx, tab: string): void {
  const nav = ctx.nav;
  if (!nav.enabled || !nav.current) return;
  const target: NavTarget = { ref: ctx.page.ref, y: PAGE_H - HEADER_BAND_H };
  nav.current.tabs.push({ tab, target });
  nav.anchors.set(`tab:${nav.current.key}::${tab}`, target);
  markPage(ctx.page, REFM_TAB_KEY, `${nav.current.key}::${tab}`);
}

/** Register a GoTo link annotation over a rect on a page (destination = a page
 *  ref + top y). Called from the paint pass, when every anchor is known. */
function addGoToLink(ctx: Ctx, page: PDFPage, rect: [number, number, number, number], target: NavTarget): void {
  const dict = ctx.doc.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0],
    A: { Type: 'Action', S: 'GoTo', D: [target.ref, 'XYZ', null, target.y, null] },
  } as unknown as Parameters<typeof ctx.doc.context.obj>[0]);
  page.node.addAnnot(ctx.doc.context.register(dict as PDFObject));
}

/** Map every page ref -> its 1-based physical position (for ToC page numbers). */
function pageNumberIndex(ctx: Ctx): Map<string, number> {
  const m = new Map<string, number>();
  ctx.doc.getPages().forEach((p, i) => m.set(p.ref.toString(), i + 1));
  return m;
}

/** Draw a clickable nav row (label + right-aligned target page number) and
 *  register its GoTo link. Returns the y for the next row. */
function drawNavRow(
  ctx: Ctx, page: PDFPage, label: string, x: number, y: number, size: number,
  bold: boolean, target: NavTarget, pageNo: number | undefined, color = NAV_LINK,
): void {
  const font = bold ? ctx.bold : ctx.font;
  const numStr = pageNo ? String(pageNo) : '';
  const numW = numStr ? ctx.font.widthOfTextAtSize(numStr, size) : 0;
  const maxLabelW = CONTENT_W - (x - MARGIN) - numW - 14;
  const text = fitText(label, font, size, maxLabelW);
  page.drawText(text, { x, y, size, font, color });
  const tw = font.widthOfTextAtSize(text, size);
  if (numStr) page.drawText(numStr, { x: PAGE_W - MARGIN - numW, y, size, font: ctx.font, color: NAV_MUTED });
  // Link rect spans the label (and the page number) so the whole row is clickable.
  addGoToLink(ctx, page, [x - 2, y - 3, PAGE_W - MARGIN, y + size + 2], target);
}

/** Number of ToC pages needed (computed from the final nav model, so exact). */
function tocPageCount(modules: ModuleNav[], hasExec: boolean): number {
  const rows = (hasExec ? 1 : 0) + modules.reduce((s, m) => s + 1 + m.tabs.length, 0);
  const usable = (PAGE_H - HEADER_BAND_H - 44) - (CONTENT_BOTTOM + 10);
  const rowsPerPage = Math.max(1, Math.floor(usable / 16));
  return Math.max(1, Math.ceil(rows / rowsPerPage));
}

/** Insert `k` blank A4-landscape ToC pages right after the cover (physical index
 *  1..k), marked so the verifier can find them. Anchors already exist, so their
 *  links resolve; footers are drawn last from the true page order. */
function insertTocPages(ctx: Ctx, k: number): PDFPage[] {
  const pages: PDFPage[] = [];
  for (let i = 0; i < k; i++) {
    const p = ctx.doc.insertPage(1 + i, [PAGE_W, PAGE_H]);
    markPage(p, REFM_NAV_KEY, 'toc');
    pages.push(p);
  }
  return pages;
}

/** Paint the reserved ToC pages: title, then Executive Summary + each module
 *  (bold) with its sub-tabs indented, every row a GoTo link with a page number. */
function paintToc(ctx: Ctx, tocPages: PDFPage[], modules: ModuleNav[], execTarget: NavTarget | null): void {
  const nums = pageNumberIndex(ctx);
  const bottom = CONTENT_BOTTOM + 10;
  let pi = 0;
  let page = tocPages[0];
  const startPage = (cont: boolean): void => {
    ctx.page = page;
    drawHeaderBand(ctx, cont ? 'Table of Contents (continued)' : 'Table of Contents');
  };
  startPage(false);
  let y = PAGE_H - HEADER_BAND_H - 34;
  const advance = (rowH: number): void => {
    if (y - rowH < bottom && pi < tocPages.length - 1) {
      pi += 1; page = tocPages[pi]; startPage(true); y = PAGE_H - HEADER_BAND_H - 30;
    }
  };
  const rowFor = (key: string): NavTarget | undefined => ctx.nav.anchors.get(key);
  if (execTarget) {
    advance(20);
    drawNavRow(ctx, page, 'Executive Summary', MARGIN, y, 12, true, execTarget, nums.get(execTarget.ref.toString()), NAVY_DARK);
    y -= 22;
  }
  for (const m of modules) {
    const mt = m.target ?? rowFor(`mod:${m.key}`);
    if (mt) { advance(20); drawNavRow(ctx, page, `Module ${m.num}: ${m.label}`, MARGIN, y, 12, true, mt, nums.get(mt.ref.toString()), NAVY_DARK); y -= 20; }
    for (const t of m.tabs) {
      advance(15);
      drawNavRow(ctx, page, t.tab, MARGIN + 22, y, 10, false, t.target, nums.get(t.target.ref.toString()));
      y -= 15;
    }
    y -= 4;
  }
}

/** Paint each module's section-break page: the module title (already drawn as the
 *  skeleton), a "Sections in this module" list (links to its tabs), and an "All
 *  modules" cross-navigation list (links to every module's break page). */
function paintBreakPages(ctx: Ctx, modules: ModuleNav[], execTarget: NavTarget | null): void {
  const nums = pageNumberIndex(ctx);
  for (const m of modules) {
    if (!m.breakPage || !m.target) continue;
    const page = m.breakPage;
    let y = PAGE_H - HEADER_BAND_H - 120;
    page.drawText('Sections in this module', { x: MARGIN, y, size: 12, font: ctx.bold, color: NAVY_DARK });
    y -= 20;
    if (m.tabs.length === 0) {
      page.drawText('This module has no sub-sections in the current selection.', { x: MARGIN + 4, y, size: 9, font: ctx.font, color: NAV_MUTED });
      y -= 16;
    }
    for (const t of m.tabs) {
      drawNavRow(ctx, page, t.tab, MARGIN + 4, y, 10, false, t.target, nums.get(t.target.ref.toString()));
      y -= 15;
    }
    // Cross-module navigation.
    y -= 18;
    page.drawText('All modules', { x: MARGIN, y, size: 12, font: ctx.bold, color: NAVY_DARK });
    y -= 20;
    if (execTarget) {
      drawNavRow(ctx, page, 'Executive Summary', MARGIN + 4, y, 10, false, execTarget, nums.get(execTarget.ref.toString()), NAV_MUTED);
      y -= 15;
    }
    for (const other of modules) {
      if (!other.target) continue;
      const current = other.key === m.key;
      drawNavRow(ctx, page, `Module ${other.num}: ${other.label}${current ? '  (this module)' : ''}`, MARGIN + 4, y, 10, current, other.target, nums.get(other.target.ref.toString()), current ? NAVY_DARK : NAV_LINK);
      y -= 15;
    }
  }
}

/** Build the /Outlines tree (Executive Summary + modules -> sub-tabs) and attach
 *  it to the catalog, opening the bookmark panel. Dests use explicit page refs. */
function buildOutline(ctx: Ctx, modules: ModuleNav[], execTarget: NavTarget | null): void {
  const context = ctx.doc.context;
  const mods = modules.filter((m) => m.target);
  const topCount = (execTarget ? 1 : 0) + mods.length;
  if (topCount === 0) return;
  const outlinesRef = context.nextRef();
  const dest = (t: NavTarget): unknown[] => [t.ref, 'XYZ', null, t.y, null];
  const obj = (literal: Record<string, unknown>): PDFObject =>
    context.obj(literal as unknown as Parameters<typeof context.obj>[0]) as PDFObject;

  // Top-level item refs, in order: [exec?, module1, module2, ...].
  const topRefs: PDFRef[] = [];
  if (execTarget) topRefs.push(context.nextRef());
  const moduleRefs = mods.map(() => context.nextRef());
  topRefs.push(...moduleRefs);

  let descendants = topRefs.length;

  if (execTarget) {
    const d: Record<string, unknown> = { Title: PDFHexString.fromText('Executive Summary'), Parent: outlinesRef, Dest: dest(execTarget), Next: topRefs[1] };
    context.assign(topRefs[0], obj(d));
  }
  mods.forEach((m, i) => {
    const selfRef = moduleRefs[i];
    const tabRefs = m.tabs.map(() => context.nextRef());
    descendants += tabRefs.length;
    const d: Record<string, unknown> = { Title: PDFHexString.fromText(`Module ${m.num}: ${m.label}`), Parent: outlinesRef, Dest: dest(m.target as NavTarget) };
    const topIdx = (execTarget ? 1 : 0) + i;
    if (topIdx > 0) d.Prev = topRefs[topIdx - 1];
    if (topIdx < topRefs.length - 1) d.Next = topRefs[topIdx + 1];
    if (tabRefs.length) { d.First = tabRefs[0]; d.Last = tabRefs[tabRefs.length - 1]; d.Count = tabRefs.length; }
    context.assign(selfRef, obj(d));
    m.tabs.forEach((t, j) => {
      const td: Record<string, unknown> = { Title: PDFHexString.fromText(t.tab), Parent: selfRef, Dest: dest(t.target) };
      if (j > 0) td.Prev = tabRefs[j - 1];
      if (j < tabRefs.length - 1) td.Next = tabRefs[j + 1];
      context.assign(tabRefs[j], obj(td));
    });
  });

  context.assign(outlinesRef, obj({ Type: 'Outlines', First: topRefs[0], Last: topRefs[topRefs.length - 1], Count: descendants }));
  ctx.doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
  ctx.doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

/** Create + mark a module's section-break page and draw its title. The nav lists
 *  are painted later (paintBreakPages), once every module + tab anchor is known. */
function renderSectionBreak(ctx: Ctx, mod: ModuleNav): void {
  newPage(ctx, `Module ${mod.num}: ${mod.label}`);
  const page = ctx.page;
  markPage(page, REFM_NAV_KEY, `break:${mod.key}`);
  const target: NavTarget = { ref: page.ref, y: PAGE_H - HEADER_BAND_H };
  mod.target = target;
  mod.breakPage = page;
  ctx.nav.anchors.set(`mod:${mod.key}`, target);
  let y = PAGE_H - HEADER_BAND_H - 56;
  drawCell(ctx, `Module ${mod.num}`, MARGIN, CONTENT_W, y, { font: ctx.bold, size: 22, color: NAVY_DARK });
  y -= 30;
  drawCell(ctx, mod.label, MARGIN, CONTENT_W, y, { font: ctx.bold, size: 15, color: NAVY });
}

// ── Public entry ─────────────────────────────────────────────────────────────
export async function generateProjectPdf(opts: GenerateProjectPdfOptions): Promise<Uint8Array> {
  // ASSET NAMES ARE RESOLVED AT THE FRONT DOOR, for the same reason as the
  // workbook: this file reads state.assets from a dozen places rather than one,
  // and a name resolved in some of them and not others is worse than either.
  opts = { ...opts, state: { ...opts.state, assets: withResolvedAssetNames(opts.state.assets, { parcels: opts.state.parcels, phases: opts.state.phases }) } };
  const snap = computeFinancialsSnapshot(opts.state);
  let returns: ReturnsSnapshot | null = null;
  try { returns = computeReturnsSnapshot(snap, opts.state.project); } catch { returns = null; }

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(b64ToBytes(INTER_REGULAR_B64), { subset: false });
  const bold = await doc.embedFont(b64ToBytes(INTER_BOLD_B64), { subset: false });

  const p = opts.state.project;
  const scale: DisplayScale = opts.displayScale ?? 'millions';
  const fmt = makeFmt(scale, opts.displayDecimals);
  const selectedKeys = new Set(opts.selectedModuleKeys);
  const ctx: Ctx = {
    doc, font, bold, pages: [], page: null as unknown as PDFPage, y: 0,
    projectName: opts.projectName || 'Untitled Project',
    unitLabel: unitLabel(p.currency ?? 'SAR', scale),
    // Navigation aids (ToC + section breaks + outline) are additive to the full
    // report; enabled only when at least one module is selected, so the
    // cover-plus-executive-summary (empty selection) output is unchanged.
    nav: { ...disabledNav(), enabled: selectedKeys.size > 0 },
    // Minimum geometry until the modules are built and measured below. The
    // executive summary draws only cards and grid tables, which size their own
    // columns, so nothing before that point depends on this.
    versionLabel: opts.versionLabel ? `Model version ${opts.versionLabel}` : null,
    metrics: makeMetrics(LABEL_COL_W_MIN, TOTAL_COL_W_MIN, PERIOD_COL_W_MIN),
  };

  // Case comparison + year-on-year impact (Modules 5 & 6) are computed once from
  // the caller-supplied bundle and shared across the exec summary + both modules.
  let caseReport: CaseComparisonReport | null = null;
  let caseYoY: CaseYoYReport | null = null;
  if (opts.caseComparison) {
    try { caseReport = buildCaseComparisonReport(opts.caseComparison); } catch { caseReport = null; }
    try { caseYoY = buildCaseYoYReport(opts.caseComparison); } catch { caseYoY = null; }
  }

  // Page 1: clean cover.
  drawCover(ctx, opts.projectName, 'Real Estate Financial Model / Feasibility Study', opts.dateLabel, opts.versionLabel, opts.versionComment);

  // Page 2: executive summary (its first page is a nav anchor).
  newPage(ctx, 'Executive Summary');
  ctx.currentHeader = 'Executive Summary';
  if (ctx.nav.enabled) {
    const execTarget: NavTarget = { ref: ctx.page.ref, y: PAGE_H - HEADER_BAND_H };
    ctx.nav.execTarget = execTarget;
    ctx.nav.anchors.set('exec', execTarget);
  }
  buildExecSummary(ctx, snap, returns, opts.state, fmt, caseReport);

  // Modules. Built modules (1-6) render real content; selected modules that are
  // not built yet render a roadmap placeholder page so the report covers the
  // whole platform. Each rendered module is preceded by a section-break page and
  // registered in the nav model (skipped entirely when it renders no content).
  const py = snap.projectStartYear - 1;
  const sel = opts.moduleSections ?? {};
  const BUILT = new Set(['module1', 'module2', 'module3', 'module4', 'module5', 'module6']);
  const beginModule = (m: ModuleConfig): ModuleNav | null => {
    if (!ctx.nav.enabled) return null;
    const mod: ModuleNav = { key: m.key, num: m.num, label: m.longLabel, target: null, tabs: [], breakPage: null };
    ctx.nav.modules.push(mod);
    ctx.nav.current = mod;
    renderSectionBreak(ctx, mod);
    return mod;
  };
  // BUILD EVERY MODULE FIRST, then size the columns, then render. The builders
  // are pure, so this costs nothing but ordering, and it is what lets the period
  // column be sized to the widest cell the WHOLE document will draw rather than
  // to a constant tuned for one display scale.
  const planned: Array<{ m: ModuleConfig; content: ModuleContent | null }> = [];
  for (const m of MODULES) {
    if (!selectedKeys.has(m.key)) continue;
    if (!BUILT.has(m.key)) { planned.push({ m, content: null }); continue; }
    let content: ModuleContent | null = null;
    if (m.key === 'module1') content = buildModule1(snap, opts.state, fmt, py, opts.parties);
    else if (m.key === 'module2') content = buildModule2(snap, opts.state, fmt, py);
    else if (m.key === 'module3') content = buildModule3(snap, opts.state, fmt, py);
    else if (m.key === 'module4') content = buildModule4(snap, opts.state, fmt, py);
    else if (m.key === 'module5') content = returns ? buildModule5(returns, snap, opts.state, fmt, py, caseReport, opts.includeSensitivity === true) : null;
    else if (m.key === 'module6') content = buildModule6(caseReport, caseYoY, fmt);
    else continue;
    if (!content) continue;
    content = dropEmptyItems(content); // suppress genuinely-empty items (header, no body)
    // Skip a module ENTIRELY (no section-break / ToC / outline node) when the
    // Inputs/Schedules/Outputs filter + per-tab selection leave it with nothing to
    // render, so nav lists only included content with no dangling links.
    if (!renderableContent(content, sel[m.key] ?? {}, opts.moduleTabs?.[m.key]).length) continue;
    planned.push({ m, content });
  }
  // Size from the items that will ACTUALLY render (after the part / tab filter),
  // so a hidden outsized table cannot widen the whole report.
  ctx.metrics = resolveMetrics(
    planned.flatMap(({ m, content }) => content
      ? renderableContent(content, sel[m.key] ?? {}, opts.moduleTabs?.[m.key]).map((t) => t.item)
      : []),
    fmt, font, bold,
  );

  for (const { m, content } of planned) {
    if (!content) { beginModule(m); renderPlaceholderModule(ctx, m); ctx.nav.current = null; continue; }
    beginModule(m);
    renderModule(ctx, `Module ${m.num}: ${m.longLabel}`, content, sel[m.key] ?? {}, fmt, opts.moduleTabs?.[m.key]);
    ctx.nav.current = null;
  }

  // Navigation paint pass: insert the ToC pages at the front, then paint the ToC
  // and each section-break page, and build the outline. Done here (not during
  // render) so every module + tab anchor is already known.
  if (ctx.nav.enabled && ctx.nav.modules.length > 0) {
    const k = tocPageCount(ctx.nav.modules, !!ctx.nav.execTarget);
    const tocPages = insertTocPages(ctx, k);
    paintToc(ctx, tocPages, ctx.nav.modules, ctx.nav.execTarget);
    paintBreakPages(ctx, ctx.nav.modules, ctx.nav.execTarget);
    buildOutline(ctx, ctx.nav.modules, ctx.nav.execTarget);
  }

  drawFooters(ctx);
  // AFTER the footers, so the stamp sits over everything the report drew.
  await applyExportWatermark(doc, opts.watermark ?? null);
  return doc.save();
}

/**
 * Introspection helper: the distinct tab labels each built module emits for a
 * given state (in render order). Used by the per-tab export picker (so it lists
 * only tabs that actually have content for this project) and by the verifier (to
 * keep the static PDF_MODULE_TABS manifest in sync with what the builders emit).
 * Pure: no document is created. Lives here so it shares the exact builders the
 * report uses.
 */
export function collectModuleTabs(state: FinancialsResolverState, caseComparison?: CaseComparisonInput): Record<string, string[]> {
  const snap = computeFinancialsSnapshot(state);
  let returns: ReturnsSnapshot | null = null;
  try { returns = computeReturnsSnapshot(snap, state.project); } catch { returns = null; }
  let caseReport: CaseComparisonReport | null = null;
  let caseYoY: CaseYoYReport | null = null;
  if (caseComparison) {
    try { caseReport = buildCaseComparisonReport(caseComparison); } catch { caseReport = null; }
    try { caseYoY = buildCaseYoYReport(caseComparison); } catch { caseYoY = null; }
  }
  const fmt = makeFmt('millions');
  const py = snap.projectStartYear - 1;
  const distinct = (content: ModuleContent): string[] => {
    const seen: string[] = [];
    // Mirror the report: genuinely-empty items are suppressed, so a tab that has
    // only empty items is not listed in the picker.
    for (const it of dropEmptyItems(content)) if (!seen.includes(it.tab)) seen.push(it.tab);
    return seen;
  };
  const out: Record<string, string[]> = {
    module1: distinct(buildModule1(snap, state, fmt, py)),
    module2: distinct(buildModule2(snap, state, fmt, py)),
    module3: distinct(buildModule3(snap, state, fmt, py)),
    module4: distinct(buildModule4(snap, state, fmt, py)),
    module6: distinct(buildModule6(caseReport, caseYoY, fmt)),
  };
  if (returns) out.module5 = distinct(buildModule5(returns, snap, state, fmt, py, caseReport));
  return out;
}

/** The full tagged content of every module, exactly as the report builds it
 *  (before empty-item suppression), for verifiers and review dumps. Pure. */
export function collectModuleContent(
  state: FinancialsResolverState, caseComparison?: CaseComparisonInput, scale: DisplayScale = 'full',
  // Parties are stored outside the version snapshot, so they arrive from the
  // caller here exactly as they do on the export path (Module 1 tab 2).
  parties?: readonly Party[],
): Record<string, ModuleContent> {
  state = { ...state, assets: withResolvedAssetNames(state.assets, { parcels: state.parcels, phases: state.phases }) };
  const snap = computeFinancialsSnapshot(state);
  let returns: ReturnsSnapshot | null = null;
  try { returns = computeReturnsSnapshot(snap, state.project); } catch { returns = null; }
  let caseReport: CaseComparisonReport | null = null;
  let caseYoY: CaseYoYReport | null = null;
  if (caseComparison) {
    try { caseReport = buildCaseComparisonReport(caseComparison); } catch { caseReport = null; }
    try { caseYoY = buildCaseYoYReport(caseComparison); } catch { caseYoY = null; }
  }
  const fmt = makeFmt(scale);
  const py = snap.projectStartYear - 1;
  return {
    module1: buildModule1(snap, state, fmt, py, parties),
    module2: buildModule2(snap, state, fmt, py),
    module3: buildModule3(snap, state, fmt, py),
    module4: buildModule4(snap, state, fmt, py),
    module5: returns ? buildModule5(returns, snap, state, fmt, py, caseReport, true) : [],
    module6: buildModule6(caseReport, caseYoY, fmt),
  };
}

/** Item-level introspection: every item each module emits with data flags. Pure
 *  (no document). Used by the verifier to assert that (a) previously-blank items
 *  now carry data (e.g. the M4 BS feeders populate), and (b) genuinely-empty
 *  items are suppressed. Returns the RAW items (before suppression) so the caller
 *  can see which items hasData=false (would be dropped). */
export interface ModuleItemInfo { module: string; tab: string; part: PartKind; kind: 'table' | 'cards' | 'paragraph'; title: string; hasData: boolean; populated: boolean }
export function collectModuleItems(state: FinancialsResolverState, caseComparison?: CaseComparisonInput): ModuleItemInfo[] {
  const snap = computeFinancialsSnapshot(state);
  let returns: ReturnsSnapshot | null = null;
  try { returns = computeReturnsSnapshot(snap, state.project); } catch { returns = null; }
  let caseReport: CaseComparisonReport | null = null;
  let caseYoY: CaseYoYReport | null = null;
  if (caseComparison) {
    try { caseReport = buildCaseComparisonReport(caseComparison); } catch { caseReport = null; }
    try { caseYoY = buildCaseYoYReport(caseComparison); } catch { caseYoY = null; }
  }
  const fmt = makeFmt('millions');
  const py = snap.projectStartYear - 1;
  const mods: Record<string, ModuleContent> = {
    module1: buildModule1(snap, state, fmt, py),
    module2: buildModule2(snap, state, fmt, py),
    module3: buildModule3(snap, state, fmt, py),
    module4: buildModule4(snap, state, fmt, py),
    module5: returns ? buildModule5(returns, snap, state, fmt, py, caseReport) : [],
    module6: buildModule6(caseReport, caseYoY, fmt),
  };
  // "populated" = a non-zero value exists (a numeric string with a non-zero digit
  // or a finite non-zero number), so an all-zero table reads as present-but-empty
  // and a mis-wired feeder (all blank/zero) is caught rather than passing.
  const numStrHasNonZero = (s: string): boolean => /[1-9]/.test(s);
  const populatedOf = (item: PdfItem): boolean => {
    if (item.type === 'table') return item.table.rows.some((r) => r.cells.slice(1).some((c) => (typeof c === 'number' && Number.isFinite(c) && c !== 0) || (typeof c === 'string' && numStrHasNonZero(c))));
    if (item.type === 'cards') return item.cards.some((c) => !!c.value && c.value.trim().toLowerCase() !== 'n/a' && numStrHasNonZero(c.value));
    return !!item.text;
  };
  const titleOf = (item: PdfItem): string => item.type === 'table' ? item.table.title : item.type === 'cards' ? item.title : (item.title ?? '');
  const out: ModuleItemInfo[] = [];
  for (const [module, items] of Object.entries(mods)) {
    for (const it of items) out.push({ module, tab: it.tab, part: it.part, kind: it.item.type, title: titleOf(it.item), hasData: hasItemData(it.item), populated: populatedOf(it.item) });
  }
  return out;
}

// ── Public entry: SUMMARY report ──────────────────────────────────────────────
/**
 * A concise, executive summary PDF (not the detailed per-tab report): cover +
 * executive summary, the key inputs (phases) and the headline financial
 * statements (P&L / Cash Flow / Balance Sheet, summary lines only), and a
 * Returns & Valuation page of KPI cards. Reads the same live snapshot as the
 * full report, so the numbers match. No per-asset / per-phase / schedule detail.
 */
export async function generateSummaryPdf(opts: GenerateProjectPdfOptions): Promise<Uint8Array> {
  const snap = computeFinancialsSnapshot(opts.state);
  let returns: ReturnsSnapshot | null = null;
  try { returns = computeReturnsSnapshot(snap, opts.state.project); } catch { returns = null; }

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(b64ToBytes(INTER_REGULAR_B64), { subset: false });
  const bold = await doc.embedFont(b64ToBytes(INTER_BOLD_B64), { subset: false });

  const p = opts.state.project;
  const scale: DisplayScale = opts.displayScale ?? 'millions';
  const fmt = makeFmt(scale, opts.displayDecimals);
  const ctx: Ctx = {
    doc, font, bold, pages: [], page: null as unknown as PDFPage, y: 0,
    projectName: opts.projectName || 'Untitled Project',
    unitLabel: unitLabel(p.currency ?? 'SAR', scale),
    // The concise summary PDF carries no ToC / section breaks / outline (nav
    // aids are scoped to the full report), so nav stays disabled here.
    nav: disabledNav(),
    versionLabel: opts.versionLabel ? `Model version ${opts.versionLabel}` : null,
    metrics: makeMetrics(LABEL_COL_W_MIN, TOTAL_COL_W_MIN, PERIOD_COL_W_MIN),
  };

  // Scenario summary is shown in the exec summary when the caller supplies the
  // case bundle (so the standalone Executive Summary PDF also covers scenarios).
  let caseReport: CaseComparisonReport | null = null;
  if (opts.caseComparison) {
    try { caseReport = buildCaseComparisonReport(opts.caseComparison); } catch { caseReport = null; }
  }

  const py = snap.projectStartYear - 1;
  const yl = snap.yearLabels;
  const { pl, directCF: cf, bs } = snap;

  // Cover + executive summary (narrative + KPI cards + composition + structure).
  drawCover(ctx, opts.projectName, 'Real Estate Financial Model / Executive Summary', opts.dateLabel, opts.versionLabel, opts.versionComment);
  newPage(ctx, 'Executive Summary');
  ctx.currentHeader = 'Executive Summary';
  buildExecSummary(ctx, snap, returns, opts.state, fmt, caseReport);

  // Key inputs + the headline financial statements (summary lines only).
  newPage(ctx, 'Key Inputs & Financial Summary');
  ctx.currentHeader = 'Key Inputs & Financial Summary';
  drawItem(ctx, { type: 'table', table: {
    title: 'Phases', kind: 'grid', align: 'data',
    columns: ['Phase', 'Status', 'Start', 'Constr. yrs', 'Ops yrs'],
    rows: opts.state.phases.map((ph) => {
      const sy = ph.startDate ? new Date(ph.startDate).getUTCFullYear() : snap.projectStartYear;
      return row([ph.name, String(ph.status ?? 'planning'), String(sy), fmt.int(ph.constructionPeriods ?? 0), fmt.int(ph.operationsPeriods ?? 0)]);
    }),
  } }, fmt);
  // SIGNS MATCH THE FULL REPORT. The consolidated P&L renders from the shared
  // builder, which negates every deduction (negArr), so this hand-built summary
  // has to as well. It used to print cost of sales / opex / D&A / interest / tax
  // POSITIVE beside a NEGATIVE fund fee row, so the column could not be added:
  // revenue less the printed deductions missed the printed EBITDA by twice their
  // value, and the one negative row made it look deliberate.
  const negate = (a: number[]): number[] => a.map((v) => -(v ?? 0));
  const plTable = periodTable('Profit & Loss (summary)', py, yl, [
    periodRow('Total revenue', pl.totalRevenuePerPeriod, 'sum'),
    periodRow('Cost of sales', negate(pl.cosPerPeriod), 'sum'),
    periodRow('Operating expenses', negate(pl.totalOpexPerPeriod), 'sum'),
    // Fund fees. WITHOUT this row the summary does not foot on a fund project:
    // `ebitdaPerPeriod` is already NET of the fees (Step 3 struck EBITDA after
    // them), so revenue less cost of sales less opex did not reach the printed
    // EBITDA and the gap was exactly the fee, unexplained. The main statements
    // got this row in August because they render from the shared builder; this
    // page is hand-built and was missed.
    ...(snap.fundFees.active
      ? [periodRow('Total Fund Management Fee', negate(snap.fundFees.totalPerPeriod), 'sum')]
      : []),
    periodRow('EBITDA', pl.ebitdaPerPeriod, 'sum', 'subtotal'),
    periodRow('Depreciation & amortization', negate(pl.daPerPeriod), 'sum'),
    periodRow('EBIT', pl.ebitPerPeriod, 'sum', 'subtotal'),
    periodRow('Interest expense', negate(pl.interestExpensePerPeriod), 'sum'),
    // The exit booked as a disposal (2026-09-14): below interest, above zakat.
    ...((pl.gainOnDisposalPerPeriod ?? []).some((v) => v !== 0)
      ? [periodRow('Gain on disposal of operating assets', pl.gainOnDisposalPerPeriod, 'sum')]
      : []),
    periodRow('Profit before tax', pl.pbtPerPeriod, 'sum', 'subtotal'),
    periodRow('Tax / Zakat', negate(pl.taxPerPeriod), 'sum'),
    periodRow('Profit after tax', pl.patPerPeriod, 'sum', 'total'),
  ]);
  const cfTable = periodTable('Cash Flow (summary)', py, yl, [
    // Same reason as the P&L above: the fee is already inside cash from
    // operations (that is how it reaches the funding requirement), so without
    // its own line the operating figure is right and unexplainable.
    ...(snap.fundFees.active
      ? [periodRow('Fund Management and Other Expenses', cf.fundFeesPaidPerPeriod ?? [], 'sum')]
      : []),
    periodRow('Cash from operations', cf.cashFromOperationsPerPeriod, 'sum', 'subtotal'),
    periodRow('Cash from investing', cf.cashFromInvestmentPerPeriod, 'sum', 'subtotal'),
    periodRow('Cash from financing', cf.cashFromFinancingPerPeriod, 'sum', 'subtotal'),
    periodRow('Net cash flow', cf.netCashFlowPerPeriod, 'sum'),
    periodRow('Closing cash', cf.closingCashPerPeriod, 'last', 'total'),
  ]);
  const bsTable = periodTable('Balance Sheet (summary)', py, yl, [
    periodRow('Cash', bs.cashPerPeriod, 'last', undefined, bs.historicalOpeningCashTotal),
    periodRow('Total assets', bs.totalAssetsPerPeriod, 'last', 'subtotal'),
    periodRow('Debt outstanding', bs.debtOutstandingPerPeriod, 'last', undefined, snap.financing.existing.debtOutstandingTotal),
    periodRow('Total liabilities', bs.totalLiabilitiesPerPeriod, 'last', 'subtotal'),
    periodRow('Total equity', bs.totalEquityPerPeriod, 'last', 'subtotal'),
    periodRow('Liabilities + equity', bs.totalLiabilitiesAndEquityPerPeriod, 'last', 'total'),
  ]);
  // Size the columns to these three statements plus the fund block below, then
  // draw. Same rule as the full report: at `full` scale a 10-digit figure does
  // not fit a 52pt column, and the answer is a wider column, never a shorter
  // number.
  const summaryFundBlock = buildFundBlock(snap, returns, opts.state, fmt, py);
  ctx.metrics = resolveMetrics(
    [plTable, cfTable, bsTable, ...summaryFundBlock.flatMap((b) => (b.table ? [b.table] : []))]
      .map((table) => ({ type: 'table', table } as PdfItem)),
    fmt, font, bold,
  );
  drawItem(ctx, { type: 'table', table: plTable }, fmt);
  drawItem(ctx, { type: 'table', table: cfTable }, fmt);
  drawItem(ctx, { type: 'table', table: bsTable }, fmt);
  // The summary certifies what it prints, from the same shared builder as the
  // full report and the workbook's Checks tab.
  drawItem(ctx, { type: 'table', table: checksTable(snap, fmt, opts.state) }, fmt);

  // Returns & valuation (KPI cards).
  if (returns) {
    newPage(ctx, 'Returns & Valuation');
    ctx.currentHeader = 'Returns & Valuation';
    const r = returns.result;
    const re = r.realEstate;
    const de = returns.developmentEconomics;
    const exa = returns.exitAnalysis;
    // The executive summary two pages back already carried the full card set.
    // Repeating it verbatim is what put Distributed Equity IRR and MOIC on
    // three of ten pages, so this page states where they are instead.
    drawCards(ctx, 'Headline Returns', headlineReturnCards(returns, fmt, { omitDistribution: true }));
    drawParagraph(ctx, distributionPointerNote(returns, fmt), 8);
    {
      const note = headlineBasisNote(returns, fmt);
      if (note) drawParagraph(ctx, note, 8);
    }
    drawCards(ctx, 'Development Economics', [
      { label: 'GDV', value: fmt.money(de.gdv) },
      { label: 'Total Dev Cost', value: fmt.money(de.totalDevelopmentCost) },
      { label: 'Profit After Financing', value: fmt.money(de.profitAfterFinancing) },
      { label: 'Development Margin', value: fmt.pct(de.developmentMargin, 1) },
      { label: 'Yield on Cost', value: fmt.pct(re.yieldOnCost, 2) },
      { label: 'Cap Rate at Exit', value: fmt.pct(re.capRateAtExit, 2) },
    ]);
    const reDscrYears = re.dscrPerPeriod.filter((v) => v > 0).length;
    const reDscrBelow = re.dscrPerPeriod.filter((v) => v > 0 && v < 1).length;
    drawCards(ctx, `Exit & Leverage (${exa.exitYearLabel})`, [
      { label: 'Exit Equity Value', value: fmt.money(exa.exitEquityValue) },
      { label: 'LTV at Exit', value: fmt.pct(re.ltvAtExit, 1) },
      { label: 'Min DSCR', value: fmt.mult(re.dscrMin), sub: reDscrBelow > 0 ? `below 1.00x in ${reDscrBelow} of ${reDscrYears} yrs` : 'worst debt-service year' },
      { label: 'Peak Debt', value: fmt.money(Math.max(0, ...bs.debtOutstandingPerPeriod)) },
      { label: 'Profit Margin', value: fmt.pct(re.profitMargin, 1) },
      { label: 'Equity Multiple (distributions)', value: fmt.mult(re.equityMultiple) },
    ]);
  }

  // Fund layer. Its own page, from the SAME shared block the full report
  // renders, so the summary cannot show a different waterfall from the report
  // it summarises. Nothing renders on a standalone project.
  const fundBlock = summaryFundBlock;
  if (fundBlock.length > 0) {
    newPage(ctx, 'Fund Layer');
    ctx.currentHeader = 'Fund Layer';
    for (const piece of fundBlock) {
      if (piece.cards) drawCards(ctx, piece.title, piece.cards);
      else if (piece.table) drawItem(ctx, { type: 'table', table: piece.table }, fmt);
      else if (piece.note) drawItem(ctx, { type: 'paragraph', text: piece.note }, fmt);
    }
  }

  drawFooters(ctx);
  // AFTER the footers, so the stamp sits over everything the report drew.
  await applyExportWatermark(doc, opts.watermark ?? null);
  return doc.save();
}
