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
import { PDFDocument, PDFName, PDFHexString, rgb, type PDFFont, type PDFPage, type PDFRef, type PDFObject } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { formatAccounting, formatArea, formatInteger, type DisplayScale } from '@/src/core/formatters';
import { computeSubUnitArea } from '@/src/core/calculations';
import { FUNDING_METHOD_LABELS, type FundingMethodId } from '../state/module1-types';
import INTER_REGULAR_B64 from './fonts/interRegular';
import INTER_BOLD_B64 from './fonts/interBold';
import {
  computeFinancialsSnapshot,
  computeFundingGap,
  type ProjectFinancialsSnapshot,
  type FinancialsResolverState,
} from '../financials-resolvers';
import { computeReturnsSnapshot, type ReturnsSnapshot } from '../returns-resolvers';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { buildPLRows, buildDirectCFRows, buildIndirectCFRows, buildBSRows, buildBsFeederTables, buildBsReconciliationRows, type M4FeederCtx } from '../reports/m4Reports';
import { buildOpexReport } from '../reports/opexReports';
import { buildCapexReport } from '../reports/capexReports';
import { buildFinancingScheduleTables, buildCashSweepTables } from '../reports/financingReports';
import { buildCostOfSalesReport } from '../reports/cosReports';
import { buildCaseComparisonReport, type CaseComparisonInput, type CaseComparisonReport } from '../reports/caseComparisonReport';
import { buildCaseYoYReport, type CaseYoYReport } from '../reports/caseYoYReport';
import { formatAssumptionValue } from '../cases/assumptionGrid';
import type { M4Row } from '../../components/modules/_shared/m4Table';
import { MODULES, type ModuleConfig } from '../modules-config';

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

const LABEL_COL_W = 188;
const TOTAL_COL_W = 72;
const PERIOD_COL_W = 52;
const ROW_H = 14;
const HEADER_ROW_H = 16;
const TITLE_H = 18;
const PART_H = 20;
const SECTION_GAP = 10;
const PERIODS_PER_PAGE = Math.max(1, Math.floor((CONTENT_W - LABEL_COL_W - TOTAL_COL_W) / PERIOD_COL_W));

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

function drawCell(
  ctx: Ctx, text: string, x: number, w: number, y: number,
  opts: { align?: 'left' | 'right' | 'center'; font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> },
): void {
  const font = opts.font ?? ctx.font;
  const size = opts.size ?? 8;
  const color = opts.color ?? TEXT;
  const pad = 4;
  const fitted = fitText(text, font, size, w - 2 * pad);
  const tw = font.widthOfTextAtSize(fitted, size);
  const tx = opts.align === 'right' ? x + w - pad - tw : opts.align === 'center' ? x + (w - tw) / 2 : x + pad;
  ctx.page.drawText(fitted, { x: tx, y: y + 4, size, font, color });
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

function unitLabel(currency: string, scale: DisplayScale): string {
  if (scale === 'thousands') return `All figures in ${currency} '000`;
  if (scale === 'millions') return `All figures in ${currency} millions`;
  return `All figures in ${currency}`;
}

// ── Drawing primitives ──────────────────────────────────────────────────────
function chunkRanges(nPeriods: number): Array<[number, number]> {
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
    drawCell(ctx, hint, swX + 12, noteW + 2, ctx.y + 2, { size: 7, color: MUTED });
  }
  ctx.y -= 4;
}

function drawParagraph(ctx: Ctx, text: string, size = 9): void {
  const maxW = CONTENT_W - 4;
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
  // Multi-column data grids get a narrower label column so the number columns
  // are wide enough to show scaled figures without truncation (fixes the
  // "36,820,510,001,…" overflow). KV (2-col) keeps a wide value column.
  const firstW = nCols <= 2 ? Math.min(320, CONTENT_W * 0.45) : Math.min(220, CONTENT_W * 0.28);
  const restW = (CONTENT_W - firstW) / Math.max(1, nCols - 1);
  const colX = (i: number): number => MARGIN + (i === 0 ? 0 : firstW + (i - 1) * restW);
  const colW = (i: number): number => (i === 0 ? firstW : restW);
  const drawHeader = (): void => {
    ensureSpace(ctx, HEADER_ROW_H);
    ctx.y -= HEADER_ROW_H;
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: CONTENT_W, height: HEADER_ROW_H, color: NAVY });
    table.columns.forEach((c, i) => drawCell(ctx, c, colX(i), colW(i), ctx.y, { align: i === 0 || !dataAlign ? 'left' : 'right', font: ctx.bold, size: 8, color: WHITE }));
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
    r.cells.forEach((cell, i) => {
      const align: 'left' | 'right' = i === 0 ? 'left' : dataAlign ? 'right' : 'left';
      const color = shadeInputs && i >= 1 ? FAST_TEXT : st.color;
      drawCell(ctx, fmt.cell(cell), colX(i), colW(i), ctx.y, { align, font: st.bold ? ctx.bold : ctx.font, size: 8, color });
    });
  }
  ctx.y -= SECTION_GAP;
}

function drawPeriodTable(ctx: Ctx, table: PdfTable, fmt: Fmt, isInput = false): void {
  const periodHeaders = table.columns.slice(2); // [priorYear, ...years]
  const ranges = chunkRanges(periodHeaders.length);
  ranges.forEach(([from, to], ci) => {
    const chunkCount = to - from;
    const totalRowW = LABEL_COL_W + TOTAL_COL_W + chunkCount * PERIOD_COL_W;
    const colX = (k: number): number => k === 0 ? MARGIN : k === 1 ? MARGIN + LABEL_COL_W : MARGIN + LABEL_COL_W + TOTAL_COL_W + (k - 2) * PERIOD_COL_W;
    const colW = (k: number): number => (k === 0 ? LABEL_COL_W : k === 1 ? TOTAL_COL_W : PERIOD_COL_W);
    const headerLabels = ['', 'Total', ...periodHeaders.slice(from, to)];
    drawTitle(ctx, ci === 0 ? table.title : `${table.title} (continued)`);
    const drawHeader = (): void => {
      ensureSpace(ctx, HEADER_ROW_H);
      ctx.y -= HEADER_ROW_H;
      ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: totalRowW, height: HEADER_ROW_H, color: NAVY });
      headerLabels.forEach((c, k) => drawCell(ctx, c, colX(k), colW(k), ctx.y, { align: k === 0 ? 'left' : 'right', font: ctx.bold, size: 8, color: WHITE }));
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
      cells.forEach((cell, k) => drawCell(ctx, fmt.cell(cell ?? null), colX(k), colW(k), ctx.y, { align: k === 0 ? 'left' : 'right', font: st.bold ? ctx.bold : ctx.font, size: 8, color: shadeInputs && k >= 1 ? FAST_TEXT : st.color }));
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
function drawCover(ctx: Ctx, projectName: string, subtitle: string, dateLabel: string): void {
  newPage(ctx);
  ctx.page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: NAVY });
  const cy = PAGE_H / 2 + 30;
  drawCell(ctx, projectName || 'Untitled Project', MARGIN, CONTENT_W, cy, { align: 'center', font: ctx.bold, size: 30, color: NAVY_DARK });
  drawCell(ctx, subtitle, MARGIN, CONTENT_W, cy - 40, { align: 'center', size: 13, color: MUTED });
  ctx.page.drawRectangle({ x: PAGE_W / 2 - 60, y: cy - 56, width: 120, height: 2, color: NAVY });
  drawCell(ctx, dateLabel, MARGIN, CONTENT_W, cy - 84, { align: 'center', size: 10, color: TEXT });
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
    const left = `Page ${i + 1} of ${total}   ·   ${ctx.projectName}   ·   ${ctx.unitLabel}`;
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

/** Asset's native metric: 'units' only when every sub-unit is units, else
 *  'area' (mirrors resolveAssetMetric in Module2RevenueOutput). Drives whether
 *  a Sell asset's volume rows show unit counts or sqm. */
function assetMetricOf(units: Array<{ metric: 'units' | 'area' }>): 'units' | 'area' {
  if (units.length === 0) return 'area';
  const first = units[0].metric;
  return units.every((u) => u.metric === first) ? first : 'area';
}
/** Append a "Total" column-sum row to a vintage matrix (per-period totals down
 *  each year column), matching the platform VintageMatrix Total row. */
function vintageTotalRow(matrix: number[][], nPeriods: number): PdfTableRow {
  const totals = new Array<number>(nPeriods).fill(0);
  for (const cohort of matrix) for (let i = 0; i < nPeriods; i++) totals[i] += cohort[i] ?? 0;
  return periodRow('Total', totals, 'sum', 'total');
}

function row(cells: Array<string | number | null>, emphasis?: RowEmphasis): PdfTableRow { return { cells, emphasis }; }

/** Period row: leads with [label, total, prior, ...values]. */
function periodRow(label: string, values: number[], total: 'sum' | 'last' | 'none', emphasis?: RowEmphasis, prior: number | null = 0): PdfTableRow {
  const t = total === 'sum' ? sum(values) : total === 'last' ? last(values) : null;
  return { cells: [label, t, prior, ...values], emphasis };
}
function strPeriodRow(label: string, strs: string[], total: string | number | null = '', emphasis?: RowEmphasis, prior: string | number | null = ''): PdfTableRow {
  return { cells: [label, total, prior, ...strs], emphasis };
}
function periodTable(title: string, priorYear: number, yearLabels: number[], rows: PdfTableRow[]): PdfTable {
  return { title, kind: 'period', columns: ['', 'Total', String(priorYear), ...yearLabels.map(String)], rows };
}
/**
 * Convert the platform's shared statement row model (M4Row[]) into a PDF period
 * table, so the PDF mirrors the on-screen Module 4 statements exactly (and stays
 * in sync automatically: both render from lib/reports/m4Reports.ts). Collapsible
 * groups are always rendered expanded (print has no interactivity).
 */
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
    const padded = values.length < N ? [...values, ...new Array<null>(N - values.length).fill(null)] : values;
    return { cells: [indentLabel(r), total, prior, ...padded], emphasis };
  });
  return { title, kind: 'period', columns: ['', 'Total', String(priorYear), ...yearLabels.map(String)], rows: pdfRows };
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
const indexLabel = (ix?: { method?: string; rate?: number }): string => {
  if (!ix || !ix.method || ix.method === 'none') return 'None';
  const m = ix.method === 'single_rate' ? 'Flat' : ix.method === 'yoy_compound' ? 'Compound' : ix.method === 'yoy_per_period' ? 'Per-Year' : ix.method === 'step' ? 'Step' : ix.method;
  return ix.rate !== undefined && ix.rate !== null ? `${m} ${(ix.rate * 100).toFixed(1)}%` : m;
};
/** Tagged-item helpers. */
const tItem = (tab: string, part: PartKind, item: PdfItem): TaggedItem => ({ tab, part, item });
const tTable = (tab: string, part: PartKind, table: PdfTable): TaggedItem => tItem(tab, part, { type: 'table', table });
const tCards = (tab: string, part: PartKind, title: string, cards: PdfCard[]): TaggedItem => tItem(tab, part, { type: 'cards', title, cards });

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
  const landSqm = state.parcels.length
    ? state.parcels.reduce((s, pa) => s + (pa.area ?? 0), 0)
    : assets.reduce((s, a) => s + (a.landAllocation?.sqm ?? a.landAreaSqm ?? 0), 0);
  const byStrategy = new Map<string, number>();
  for (const a of assets) byStrategy.set(a.strategy, (byStrategy.get(a.strategy) ?? 0) + 1);
  const compStr = [...byStrategy.entries()].map(([s, n]) => `${n} ${s}`).join(', ');
  const landCost = Math.max(0, fin.capex.totals.inclAllLand - fin.capex.totals.exclAllLand);
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
    `${fmt.pctRaw(fin.funding.debtPct, 0)} debt / ${fmt.pctRaw(fin.funding.equityPct, 0)} equity. ` +
    `Projected gross development value is ${fmt.money(gdv)}` +
    (returns ? `, yielding a project IRR of ${fmt.pct(returns.result.fcff.irr, 1)} and an equity IRR of ${fmt.pct(returns.result.fcfe.irr, 1)}.` : '.');
  drawParagraph(ctx, narrative, 9);
  ctx.y -= 4;

  // KPI cards (incl. Dividend IRR / MOIC, Land + Construction split).
  const cards: PdfCard[] = [];
  if (returns) {
    const r = returns.result;
    cards.push({ label: 'Project IRR', value: fmt.pct(r.fcff.irr, 1), sub: 'unlevered (FCFF)' });
    cards.push({ label: 'Equity IRR', value: fmt.pct(r.fcfe.irr, 1), sub: 'levered (FCFE)' });
    cards.push({ label: 'Equity Multiple', value: fmt.mult(r.fcfe.moic), sub: 'FCFE' });
    cards.push({ label: 'Dividend IRR', value: fmt.pct(r.dividends.irr, 1), sub: 'distributed equity' });
    cards.push({ label: 'Dividend MOIC', value: fmt.mult(r.dividends.moic), sub: 'distributions / invested' });
  }
  cards.push({ label: 'Total Dev Cost', value: fmt.money(fin.capex.totals.inclAllLand), sub: 'incl. land' });
  cards.push({ label: 'Land Cost', value: fmt.money(landCost), sub: 'land only' });
  cards.push({ label: 'Construction Cost', value: fmt.money(constructionCost), sub: 'excl. land' });
  cards.push({ label: 'Total Revenue (GDV)', value: fmt.money(gdv), sub: 'over the hold' });
  cards.push({ label: 'Peak Debt', value: fmt.money(Math.max(0, ...snap.bs.debtOutstandingPerPeriod)), sub: 'max outstanding' });
  drawCards(ctx, 'Headline KPIs', cards);

  // Asset composition.
  drawGridTable(ctx, {
    title: 'Asset Composition', kind: 'grid', align: 'data',
    columns: ['Phase', 'Asset', 'Strategy', 'BUA (sqm)', 'Sub-units'],
    rows: assets.map((a) => {
      const ph = state.phases.find((x) => x.id === a.phaseId);
      const su = state.subUnits.filter((u) => u.assetId === a.id);
      const bua = su.length ? su.reduce((s, u) => s + computeSubUnitArea(u), 0) : (a.buaSqm ?? 0);
      return row([ph?.name ?? '-', a.name, a.strategy, fmt.area(bua), fmt.int(su.length)]);
    }),
  }, fmt);

  // Financial structure as two columns (key/value pairs side by side) so the
  // Executive Summary stays on a single page.
  drawGridTable(ctx, kv2Table('Financial Structure', [
    ['Funding method', FUNDING_METHOD_LABELS[(p.financing?.fundingMethod ?? 1) as FundingMethodId]],
    ['Debt / Equity split', `${fmt.pctRaw(fin.funding.debtPct, 0)} / ${fmt.pctRaw(fin.funding.equityPct, 0)}`],
    ['Total new debt', fmt.money(sum(snap.directCF.debtDrawdownPerPeriod))],
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

// ── Module 1: Setup & Financial Structure ───────────────────────────────────
function buildModule1(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: Fmt, py: number): ModuleContent {
  const p = state.project;
  const fin = snap.financing;
  const yl = snap.yearLabels;
  const trName = (id: string): string => state.financingTranches.find((t) => t.id === id)?.name ?? id;
  const items: ModuleContent = [];

  // Tab 1: Project Setup.
  items.push(tTable('Tab 1: Project Setup', 'inputs', kvTable('Project Identity', [
    ['Project name', p.name || '(unnamed)'],
    ['Currency', p.currency],
    ['Location', [p.location, p.country].filter(Boolean).join(', ') || '-'],
    ['Start date', p.startDate ?? '-'],
    ['Status', String(p.status ?? '-')],
    ['Tax rate', fmt.pct(p.tax?.rate ?? 0, 1)],
  ])));
  items.push(tTable('Tab 1: Project Setup', 'inputs', {
    title: 'Phases', kind: 'grid', align: 'data',
    columns: ['Phase', 'Status', 'Start', 'Constr. yrs', 'Ops yrs'],
    rows: state.phases.map((ph) => {
      const sy = ph.startDate ? new Date(ph.startDate).getUTCFullYear() : snap.projectStartYear;
      return row([ph.name, String(ph.status ?? 'planning'), String(sy), fmt.int(ph.constructionPeriods ?? 0), fmt.int(ph.operationsPeriods ?? 0)]);
    }),
  }));
  // Existing Operations (historical baseline). REBUILT to read the engine's
  // existing-operations aggregate (snap.financing.existing) instead of the
  // DEPRECATED phase fields historicalCapexTotal / historicalEquityContributed /
  // historicalDebtDrawn (no longer read by the engine, see existing.ts; they can
  // carry stale/garbage legacy data). Pre-capex / equity / debt are derived per
  // phase from per-asset pre-capex (Land + Building), historicalEquityAmount, and
  // existing facilities' opening balances; NBV + opening cash come from the
  // still-used baseline inputs. One column per operational phase + a Total.
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
  const baselineHasData = baselineRows.some((r) => r.vals.some((v) => v !== 0));
  if (opPhases.length && baselineHasData) {
    items.push(tTable('Tab 1: Project Setup', 'inputs', {
      title: 'Existing Operations (historical baseline)', kind: 'grid', align: 'data',
      columns: ['Metric', ...opPhases.map((ph) => ph.name), 'Total'],
      rows: baselineRows.map((r) => row([r.label, ...r.vals.map((v) => fmt.money(v)), fmt.money(r.vals.reduce((s, v) => s + v, 0))])),
    }));
  }

  // Tab 2: Assets & Sub-units.
  for (const ph of state.phases) {
    const assets = state.assets.filter((a) => a.phaseId === ph.id && a.visible !== false);
    if (!assets.length) continue;
    items.push(tTable('Tab 2: Assets & Sub-units', 'inputs', {
      title: `Assets, ${ph.name}`, kind: 'grid', align: 'data',
      columns: ['Asset', 'Strategy', 'Type', 'BUA (sqm)', 'Land (sqm)'],
      rows: assets.map((a) => {
        const su = state.subUnits.filter((u) => u.assetId === a.id);
        const bua = su.length ? su.reduce((s, u) => s + computeSubUnitArea(u), 0) : (a.buaSqm ?? 0);
        return row([a.name, a.strategy, a.type || '-', fmt.area(bua), fmt.area(a.landAllocation?.sqm ?? a.landAreaSqm ?? 0)]);
      }),
    }));
    for (const a of assets) {
      const su = state.subUnits.filter((u) => u.assetId === a.id);
      if (!su.length) continue;
      items.push(tTable('Tab 2: Assets & Sub-units', 'inputs', {
        title: `Sub-units, ${a.name}`, kind: 'grid', align: 'data',
        columns: ['Sub-unit', 'Category', 'Metric', 'Qty', 'Unit price / ADR'],
        rows: su.map((u) => row([u.name, u.category, u.metric, u.metric === 'area' ? fmt.area(u.metricValue) : fmt.int(u.metricValue), fmt.int(u.startingAdr ?? u.unitPrice ?? 0)])),
      }));
    }
  }

  // Tab 3: Capex. Cost-line INPUT is asset-wise (each contributing line shows
  // its Quantity = the BUA/NSA/land sqm or unit count the rate multiplies, and
  // the engine Amount). OUTPUT mirrors the platform Capex Results tab. Both come
  // from the shared builder (lib/reports/capexReports.ts).
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
    l.isFixed ? fmt.money(l.rate) : l.isPercent ? `${l.rate}%` : fmt.int(l.rate);
  for (const ia of capexReport.inputAssets) {
    items.push(tTable('Tab 3: Capex', 'inputs', {
      title: `Cost Lines, ${ia.assetName} (${ia.phaseName})`, kind: 'grid', align: 'data',
      columns: ['Cost line', 'Stage', 'Basis (multiplier)', 'Rate / Value', 'Quantity / Basis', 'Amount'],
      rows: ia.lines.map((l) => row([l.name, l.stage, l.basis, rateCell(l), basisCell(l), fmt.money(l.amount)]))
        .concat([row([`Total, ${ia.assetName}`, '', '', '', '', fmt.money(ia.total)], 'subtotal')]),
    }));
  }
  // Capex Breakdown by Year (land split summary), then the per-stage + the
  // per-asset Results tables (incl all land / excl in-kind / excl all land).
  const cap = fin.capex.perPeriod;
  items.push(tTable('Tab 3: Capex', 'outputs', periodTable('Capex Breakdown by Year', py, yl, [
    periodRow('Land (cash)', cap.landCash, 'sum'),
    periodRow('Land (in-kind)', cap.landInKind, 'sum'),
    periodRow('Construction & soft (non-land)', cap.nonLand, 'sum'),
    periodRow('Total capex (excl. in-kind land)', cap.exclLandInKind, 'sum', 'subtotal'),
    periodRow('Total capex (incl. all land)', cap.inclAllLand, 'sum', 'total'),
  ])));
  const ps = fin.capex.perStagePerPeriod;
  if (ps) {
    const stageDefs: Array<[string, string]> = [
      ['land', 'Land'], ['hard', 'Hard (construction)'], ['soft', 'Soft costs'], ['operating', 'Operating (capitalised)'],
    ];
    const stageRows = stageDefs
      .filter(([key]) => anyNonZero(ps[key] ?? []))
      .map(([key, label]) => periodRow(label, (ps[key] ?? []).slice(0, yl.length), 'sum'));
    if (stageRows.length) {
      items.push(tTable('Tab 3: Capex', 'outputs', periodTable('Capex Results by Stage', py, yl,
        stageRows.concat([periodRow('Total capex (incl. all land)', cap.inclAllLand.slice(0, yl.length), 'sum', 'total')]))));
    }
  }
  for (const t of capexReport.results) {
    items.push(tTable('Tab 3: Capex', 'outputs', m4RowsToPeriodTable(t.title, py, yl, t.rows)));
  }

  // Tab 4: Financing / Inputs.
  items.push(tTable('Tab 4: Financing / Inputs', 'inputs', kvTable('Project Financing Settings', [
    ['Funding method', FUNDING_METHOD_LABELS[(p.financing?.fundingMethod ?? 1) as FundingMethodId]],
    ['Debt share', fmt.pctRaw(fin.funding.debtPct, 0)],
    ['Equity share', fmt.pctRaw(fin.funding.equityPct, 0)],
    ['Minimum cash reserve', fmt.money(p.financing?.minimumCashReserve ?? fin.funding.minCashReserve ?? 0)],
  ])));
  if (state.parcels.length) {
    items.push(tTable('Tab 4: Financing / Inputs', 'inputs', {
      title: 'Land Funding per Parcel', kind: 'grid', align: 'data',
      columns: ['Parcel', 'Area (sqm)', 'Rate', 'Cash %', 'In-kind %', 'Cash value'],
      rows: state.parcels.map((pa) => row([pa.name, fmt.area(pa.area), fmt.int(pa.rate), fmt.pctRaw(pa.cashPct, 0), fmt.pctRaw(pa.inKindPct, 0), fmt.money(pa.area * pa.rate * (pa.cashPct / 100))])),
    }));
  }
  if (state.financingTranches.length) {
    items.push(tTable('Tab 4: Financing / Inputs', 'inputs', {
      title: 'Debt Facilities', kind: 'grid', align: 'data',
      columns: ['Tranche', 'Origin', 'Opening bal.', 'Rate %', 'Repayment', 'Drawdown'],
      rows: state.financingTranches.map((t) => {
        const rate = t.interestRatePct ?? ((t.interbankRatePct ?? 0) + (t.creditSpreadPct ?? 0));
        return row([t.name, t.origin === 'existing' ? 'existing' : 'new', fmt.money(t.openingBalance ?? 0), fmt.pctRaw(rate, 2), String(t.repaymentMethod ?? '-'), String(t.drawdownMethod ?? '-')]);
      }),
    }));
  }
  // Funding requirement, named methods + selected by year.
  items.push(tTable('Tab 4: Financing / Inputs', 'outputs', kvTable('Funding Requirement by Method', [
    [`Method 1 (${FUNDING_METHOD_LABELS[1]})`, fmt.money(fin.funding.method1)],
    [`Method 2 (${FUNDING_METHOD_LABELS[2]})`, fmt.money(fin.funding.method2)],
    [`Method 3 (${FUNDING_METHOD_LABELS[3]})`, fmt.money(fin.funding.method3)],
    [`Method 4 (${FUNDING_METHOD_LABELS[4]})`, fmt.money(fin.funding.method4)],
    [`Selected (${FUNDING_METHOD_LABELS[fin.funding.selectedMethodId]})`, fmt.money(fin.funding.selected)],
  ])));
  items.push(tTable('Tab 4: Financing / Inputs', 'outputs', periodTable(`Selected Funding Requirement by Year (${FUNDING_METHOD_LABELS[fin.funding.selectedMethodId]})`, py, yl, [
    periodRow('Funding need (capex)', fin.funding.selectedByPeriod.slice(0, yl.length), 'sum'),
    periodRow('Min cash reserve add-on', fin.funding.minCashByPeriod.slice(0, yl.length), 'sum'),
    periodRow('Total funding need', fin.funding.totalFundingNeedByPeriod.slice(0, yl.length), 'sum', 'total'),
  ])));
  // Total Equity Required, as a year-on-year table (matching the platform's
  // Equity Movement), with the type totals summarised on the prior column.
  const eqI = fin.equity;
  items.push(tTable('Tab 4: Financing / Inputs', 'outputs', periodTable('Total Equity Required (by year)', py, yl, [
    periodRow('Cash equity', eqI.cashPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('In-kind equity', eqI.inKindPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Existing equity', eqI.existingEquityPerPeriod.slice(0, yl.length), 'sum', undefined, fin.existing.equityTotal),
    periodRow('Total equity', eqI.totalPerPeriod.slice(0, yl.length), 'sum', 'total'),
  ])));

  // Tab 4: Financing / Funding Gap (BEFORE Schedules, matching the platform
  // tab order). Method 2 (Net Funding) + Method 3 (Cash Deficit) waterfalls.
  const gap = computeFundingGap(snap);
  items.push(tTable('Tab 4: Financing / Funding Gap', 'outputs', periodTable('Method 2: Net Funding Requirement (Capex vs Pre-Sales)', py, yl, [
    periodRow('Total project capex (excl. in-kind land)', gap.capexPerPeriod.slice(0, yl.length), 'sum', 'subtotal'),
    periodRow('Advance received from customer (gross)', gap.preSalesGrossPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Less: escrow held', gap.escrowHeldPerPeriod.slice(0, yl.length).map((v) => -v), 'sum'),
    periodRow('Add: escrow released', gap.escrowReleasePerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Advance received (net)', gap.preSalesNetPerPeriod.slice(0, yl.length), 'sum', 'subtotal'),
    periodRow('Funding gap = MAX(capex - pre-sales(t-1), 0)', gap.methodAGapPerPeriod.slice(0, yl.length), 'sum', 'total'),
  ])));
  const m3 = gap.method3Waterfall;
  items.push(tTable('Tab 4: Financing / Funding Gap', 'outputs', periodTable('Method 3: Cash Deficit Funding', py, yl, [
    periodRow('Opening cash', m3.openingCashPerPeriod.slice(0, yl.length), 'none'),
    periodRow('Cash from operations', m3.cashFromOpsPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Cash from investing (capex)', m3.cashFromInvPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Finance cost paid', m3.financeCostPaidPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Cash available (before new funding)', m3.cashAvailableBeforeNewDebtPerPeriod.slice(0, yl.length), 'none', 'subtotal'),
    periodRow('Net cash required (= funding drawn)', m3.netCashRequiredPerPeriod.slice(0, yl.length), 'sum', 'total'),
  ])));
  // Side-by-side comparison: what each funding method would require per year,
  // regardless of which one is currently selected (matching the platform's
  // method picker preview).
  items.push(tTable('Tab 4: Financing / Funding Gap', 'outputs', periodTable('Funding Requirement by Method (year-on-year)', py, yl, [
    periodRow('Method 1: Fund full capex', gap.capexPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Method 2: Net funding gap (capex vs pre-sales)', gap.methodAGapPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Method 3: Cash deficit (full waterfall)', m3.netCashRequiredPerPeriod.slice(0, yl.length), 'sum'),
  ])));

  // Tab 4: Financing / Schedules. Mirrors the platform via the shared builder
  // (per-facility Debt Movement + Finance Cost ledger, Combined Debt Service,
  // Equity Movement), plus the IDC summary.
  const fmtFn = (v: number): string => fmt.money(v);
  for (const t of buildFinancingScheduleTables(snap, state, fmtFn)) {
    items.push(tTable('Tab 4: Financing / Schedules', 'schedules', m4RowsToPeriodTable(t.title, py, yl, t.rows)));
  }
  const idc = snap.idc;
  items.push(tTable('Tab 4: Financing / Schedules', 'schedules', periodTable('IDC Summary', py, yl, [
    periodRow('Construction interest', idc.totalConstructionInterestPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('IDC capitalised to assets', idc.totalIdcPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('IDC depreciation', idc.idcDepreciationPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('IDC NBV (closing)', idc.idcNbvPerPeriod.slice(0, yl.length), 'last', 'total'),
  ])));

  // Tab 4: Financing / Cash Sweep. Mirrors the platform Cash Sweep tab (full
  // waterfall with the min-cash floor + per-tranche Debt Paid + Sweep & Outstanding).
  for (const t of buildCashSweepTables(snap, state, fmtFn)) {
    items.push(tTable('Tab 4: Financing / Cash Sweep', 'schedules', m4RowsToPeriodTable(t.title, py, yl, t.rows)));
  }

  return items;
}

// ── Module 2: Revenue ────────────────────────────────────────────────────────
function buildModule2(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: Fmt, py: number): ModuleContent {
  const yl = snap.yearLabels;
  const rev = snap.revenue;
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;
  const items: ModuleContent = [];

  // Tab 1: Revenue Inputs.
  items.push(tTable('Tab 1: Revenue Inputs', 'inputs', {
    title: 'Revenue Configuration by Asset', kind: 'grid', align: 'data',
    columns: ['Asset', 'Strategy', 'Key driver', 'Indexation'],
    rows: state.assets.filter((a) => a.visible !== false).map((a) => {
      const r = a.revenue ?? {};
      if (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') {
        const s = r.sell;
        const recog = s?.recognitionProfile?.method === 'point_in_time' ? `PIT (${s?.recognitionProfile?.pointInTimeYear ?? 'handover'})` : 'Over time';
        return row([a.name, a.strategy, `Recognition: ${recog}`, indexLabel(s?.indexation)]);
      }
      if (a.strategy === 'Operate') return row([a.name, a.strategy, `Starting ADR ${fmt.int(a.revenue?.operate?.startingADR ?? 0)}`, indexLabel(a.revenue?.operate?.adrIndexation)]);
      return row([a.name, 'Lease', `Base rate ${fmt.int(a.revenue?.lease?.baseRate ?? 0)}`, indexLabel(a.revenue?.lease?.rentIndexation)]);
    }),
  }));
  for (const a of state.assets) {
    const s = a.revenue?.sell;
    if (!s) continue;
    const cashPct = s.cashPaymentProfile?.percentages ?? [];
    const recogPct = s.recognitionProfile?.percentages ?? [];
    if (!cashPct.length && !recogPct.length) continue;
    // Only show the columns that actually carry a non-zero % (trailing zeros
    // padded out to year 14/15 are noise). n = last index with any value + 1.
    let n = 0;
    for (let i = 0; i < Math.max(cashPct.length, recogPct.length); i++) {
      if ((cashPct[i] ?? 0) !== 0 || (recogPct[i] ?? 0) !== 0) n = i + 1;
    }
    if (n === 0) continue;
    const cols = Array.from({ length: n }, (_, i) => `Yr ${i + 1}`);
    items.push(tTable('Tab 1: Revenue Inputs', 'inputs', {
      title: `Cash & Recognition Profile, ${a.name} (relative to sale year)`, kind: 'grid', align: 'data',
      columns: ['Profile', ...cols],
      rows: [
        row(['Cash payment %', ...Array.from({ length: n }, (_, i) => fmt.pctRaw((cashPct[i] ?? 0) * 100, 1))]),
        ...(recogPct.length ? [row(['Recognition %', ...Array.from({ length: n }, (_, i) => fmt.pctRaw((recogPct[i] ?? 0) * 100, 1))])] : []),
      ],
    }));
  }

  // Tab 2: Revenue Output.
  const pl = snap.pl;
  items.push(tTable('Tab 2: Revenue Output', 'outputs', periodTable('Project Revenue Summary', py, yl, [
    periodRow('Residential revenue', pl.residentialRevenuePerPeriod, 'sum'),
    periodRow('Hospitality revenue', pl.hospitalityRevenuePerPeriod, 'sum'),
    periodRow('Retail revenue', pl.retailRevenuePerPeriod, 'sum'),
    periodRow('Total revenue', pl.totalRevenuePerPeriod, 'sum', 'total'),
  ])));
  for (const [id, r] of rev.bySellAsset) {
    if (!anyNonZero(r.presalesRevenuePerPeriod) && !anyNonZero(r.postSalesRevenuePerPeriod)) continue;
    const totalSaleValue = r.presalesRevenuePerPeriod.map((v, i) => v + (r.postSalesRevenuePerPeriod[i] ?? 0));
    // Volume row respects the asset's native metric: unit counts for
    // units-metric assets (apartments / villas), sqm for area-metric assets.
    // Always reading units made sqm-metric assets show 0 (the reported bug).
    const metric = assetMetricOf(state.subUnits.filter((u) => u.assetId === id));
    const useUnits = metric === 'units';
    const preVol = useUnits ? r.presalesUnitsPerPeriod : r.presalesAreaPerPeriod;
    const postVol = useUnits ? r.postSalesUnitsPerPeriod : r.postSalesAreaPerPeriod;
    const volFmt = useUnits ? (v: number) => fmt.int(v) : (v: number) => fmt.area(v);
    const volSuffix = useUnits ? 'units' : 'sqm';
    items.push(tTable('Tab 2: Revenue Output', 'outputs', periodTable(`Residential (Sell), ${assetName(id)}`, py, yl, [
      strPeriodRow(`Pre-sales ${volSuffix}`, preVol.map(volFmt)),
      strPeriodRow(`Post-sales ${volSuffix}`, postVol.map(volFmt)),
      periodRow('Pre-sales revenue (sale value)', r.presalesRevenuePerPeriod, 'sum'),
      periodRow('Post-sales revenue (sale value)', r.postSalesRevenuePerPeriod, 'sum'),
      periodRow('Total sale value', totalSaleValue, 'sum', 'subtotal'),
      periodRow('Pre-sales cash collected', r.presalesCashPerPeriod, 'sum'),
      periodRow('Post-sales cash collected', r.postSalesCashPerPeriod, 'sum'),
      periodRow('Total cash collected', r.cashCollectedPerPeriod, 'sum', 'subtotal'),
      periodRow('Pre-sales recognised', r.presalesRecognitionPerPeriod, 'sum'),
      periodRow('Post-sales recognised', r.postSalesRecognitionPerPeriod, 'sum'),
      periodRow('Total revenue recognised', r.recognitionPerPeriod, 'sum', 'total'),
    ])));
    // Vintage matrices, with a Total row matching the platform VintageMatrix.
    const cashRows = r.cashVintageMatrix.map((m, i) => periodRow(`FY ${yl[i] ?? i}`, m, 'sum')).filter((rr) => (rr.cells[1] as number) !== 0);
    if (cashRows.length) items.push(tTable('Tab 2: Revenue Output', 'outputs', periodTable(`Cash Vintage Matrix, ${assetName(id)}`, py, yl, [...cashRows, vintageTotalRow(r.cashVintageMatrix, yl.length)])));
    const recRows = r.recognitionVintageMatrix.map((m, i) => periodRow(`FY ${yl[i] ?? i}`, m, 'sum')).filter((rr) => (rr.cells[1] as number) !== 0);
    if (recRows.length) items.push(tTable('Tab 2: Revenue Output', 'outputs', periodTable(`Recognition Vintage Matrix, ${assetName(id)}`, py, yl, [...recRows, vintageTotalRow(r.recognitionVintageMatrix, yl.length)])));
  }
  for (const [id, r] of rev.byHospitalityAsset) {
    if (!anyNonZero(r.totalRevenuePerPeriod)) continue;
    items.push(tTable('Tab 2: Revenue Output', 'outputs', periodTable(`Hospitality, ${assetName(id)}`, py, yl, [
      strPeriodRow('Available room nights', r.availableRoomNightsPerPeriod.map((v) => fmt.int(v))),
      strPeriodRow('Occupied room nights', r.occupiedRoomNightsPerPeriod.map((v) => fmt.int(v))),
      strPeriodRow('Occupancy %', r.occupancyPerPeriod.map((v) => fmt.pct(v, 1))),
      strPeriodRow('ADR', r.adrPerPeriod.map((v) => fmt.int(v))),
      periodRow('Rooms revenue', r.roomsRevenuePerPeriod, 'sum'),
      periodRow('F&B revenue', r.fbRevenuePerPeriod, 'sum'),
      periodRow('Other revenue', r.otherRevenuePerPeriod, 'sum'),
      periodRow('Total revenue', r.totalRevenuePerPeriod, 'sum', 'total'),
    ])));
  }
  for (const [id, r] of rev.byLeaseAsset) {
    if (!anyNonZero(r.totalRevenuePerPeriod)) continue;
    items.push(tTable('Tab 2: Revenue Output', 'outputs', periodTable(`Lease, ${assetName(id)}`, py, yl, [
      strPeriodRow('Occupied area (sqm)', r.occupiedAreaPerPeriod.map((v) => fmt.area(v))),
      strPeriodRow('Occupancy %', r.occupancyPerPeriod.map((v) => fmt.pct(v, 1))),
      strPeriodRow('Indexed rate', r.indexedRatePerPeriod.map((v) => fmt.int(v))),
      periodRow('Total revenue', r.totalRevenuePerPeriod, 'sum', 'total'),
    ])));
  }

  // Tab 3: Cost of Sales. Mirrors the platform CoS tab via the shared builder
  // (per-asset Capex driver + Vintage Matrix with a Total row + Summary +
  // Inventory roll-forward, then the project totals).
  const cosFmtFn = (v: number): string => fmt.money(v);
  for (const t of buildCostOfSalesReport(snap, state, cosFmtFn)) {
    items.push(tTable('Tab 3: Cost of Sales', 'outputs', m4RowsToPeriodTable(t.title, py, yl, t.rows)));
  }

  // Tab 4: Schedules (AR / Unearned / Escrow).
  for (const [id, b] of snap.byAssetSchedules) {
    if (!anyNonZero(b.ar.perPeriod) && !anyNonZero(b.unearned.perPeriod)) continue;
    items.push(tTable('Tab 4: Schedules', 'schedules', periodTable(`Accounts Receivable & Unearned, ${assetName(id)}`, py, yl, [
      periodRow('AR opening', b.ar.openingPerPeriod.slice(0, yl.length), 'none'),
      periodRow('AR change', b.ar.changePerPeriod.slice(0, yl.length), 'sum'),
      periodRow('AR closing', b.ar.perPeriod.slice(0, yl.length), 'last', 'subtotal'),
      periodRow('Unearned opening', b.unearned.openingPerPeriod.slice(0, yl.length), 'none'),
      periodRow('Unearned change', b.unearned.changePerPeriod.slice(0, yl.length), 'sum'),
      periodRow('Unearned closing', b.unearned.perPeriod.slice(0, yl.length), 'last', 'subtotal'),
    ])));
  }
  // Tab 5: Escrow. Mirrors the platform Escrow tab's three output tables
  // (A: Pre-Sales Cash by Asset / B: Balance Roll-Forward / C: Cash Flow Impact).
  const esc = snap.escrow.projectTotals;
  if (anyNonZero(esc.heldPerPeriod) || anyNonZero(esc.releasePerPeriod)) {
    const escAssets = [...snap.escrow.byAsset.entries()].filter(([, a]) => anyNonZero(a.preSalesCashPerPeriod));
    // A. Pre-Sales Cash by Asset.
    items.push(tTable('Tab 5: Escrow', 'schedules', periodTable('A. Pre-Sales Cash by Asset (subject to escrow)', py, yl,
      escAssets.map(([id, a]) => periodRow(assetName(id), a.preSalesCashPerPeriod.slice(0, yl.length), 'sum'))
        .concat([periodRow('Total Pre-Sales Cash (all assets)', esc.preSalesCashPerPeriod.slice(0, yl.length), 'sum', 'total')]))));
    // B. Escrow Balance Roll-Forward (opening + per-asset additions + total / release / closing).
    const N = yl.length;
    const opening = new Array<number>(N).fill(0);
    for (let t = 1; t < N; t++) opening[t] = esc.cumulativeBalancePerPeriod[t - 1] ?? 0;
    const rollRows: PdfTableRow[] = [periodRow('Opening Balance', opening, 'none', 'subtotal')];
    rollRows.push(row(['Additions:', null, null, ...new Array<null>(N).fill(null)], 'heading'));
    for (const [id, a] of escAssets) rollRows.push(periodRow(`   ${assetName(id)}`, a.result.heldPerPeriod.slice(0, N), 'sum'));
    rollRows.push(periodRow('Total Additions', esc.heldPerPeriod.slice(0, N), 'sum', 'subtotal'));
    rollRows.push(periodRow('Less: Release of Locked Funds', esc.releasePerPeriod.slice(0, N).map((v) => -v), 'sum'));
    rollRows.push(periodRow('Closing Balance', esc.cumulativeBalancePerPeriod.slice(0, N), 'last', 'total'));
    items.push(tTable('Tab 5: Escrow', 'schedules', periodTable('B. Escrow Balance Roll-Forward', py, yl, rollRows)));
    // C. Cash Flow Impact (project totals).
    items.push(tTable('Tab 5: Escrow', 'schedules', periodTable('C. Cash Flow Impact (project totals)', py, yl, [
      periodRow('Less: Inaccessible Funds Locked', esc.heldPerPeriod.slice(0, N).map((v) => -v), 'sum'),
      periodRow('Add: Release of Inaccessible Funds', esc.releasePerPeriod.slice(0, N), 'sum'),
      periodRow('Net Cash Flow Adjustment (to M4)', esc.cashFlowAdjustmentPerPeriod.slice(0, N), 'sum', 'total'),
    ])));
  }

  return items;
}

// ── Module 3: Operating Expenses ─────────────────────────────────────────────
const opexValueDisplay = (mode: string, value: number, fmt: Fmt): string =>
  // Fixed / per-unit modes are currency; everything else is a % stored as a
  // DECIMAL (0.25 = 25%), so multiply by 100 (fmt.pct), never show the raw 0.25.
  mode === 'fixed_baseline' || mode.startsWith('per_') ? fmt.money(value) : fmt.pct(value, 2);

function buildModule3(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: Fmt, py: number): ModuleContent {
  const yl = snap.yearLabels;
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;
  const items: ModuleContent = [];

  // Tab 1: Opex Inputs.
  for (const a of state.assets) {
    const lines = a.opex?.lines ?? [];
    if (!lines.length) continue;
    items.push(tTable('Tab 1: Opex Inputs', 'inputs', {
      title: `Opex Inputs, ${a.name}`, kind: 'grid', align: 'data',
      columns: ['Line', 'Category', 'Mode', 'Value', 'Indexation', 'Rate mode'],
      rows: lines.filter((l) => !l.disabled).map((l) => row([
        l.name, String(l.category), String(l.mode), opexValueDisplay(l.mode, l.value, fmt),
        l.useAssetDefault ? `(default) ${indexLabel(a.opex?.defaultIndexation)}` : indexLabel(l.indexation),
        l.rateMode === 'yoy' ? 'YoY' : 'Single',
      ])),
    }));
  }
  const hqLines = state.project.hqOpex?.lines ?? [];
  if (hqLines.length) {
    items.push(tTable('Tab 1: Opex Inputs', 'inputs', {
      title: 'HQ / Corporate Opex Inputs', kind: 'grid', align: 'data',
      columns: ['Line', 'Category', 'Mode', 'Value', 'Indexation'],
      rows: hqLines.filter((l) => !l.disabled).map((l) => row([l.name, String(l.category), String(l.mode), opexValueDisplay(l.mode, l.value, fmt), indexLabel(l.indexation)])),
    }));
  }

  // Tab 2: Opex Output. Mirrors the on-screen Opex tab via the shared builder
  // (lib/reports/opexReports.ts): a Revenue Breakdown + per-category cost tables
  // per operating asset, then the project rollup.
  for (const t of buildOpexReport(snap, state)) {
    items.push(tTable('Tab 2: Opex Output', 'outputs', m4RowsToPeriodTable(t.title, py, yl, t.rows)));
  }

  // Tab 3: AP Schedules.
  const ap = snap.ap;
  for (const [id, r] of ap.byAsset) {
    if (!anyNonZero(r.opexIncurredPerPeriod)) continue;
    items.push(tTable('Tab 3: Schedules', 'schedules', periodTable(`Accounts Payable, ${assetName(id)} (DPO ${r.effectiveApDays})`, py, yl, [
      periodRow('Opex incurred', r.opexIncurredPerPeriod.slice(0, yl.length), 'sum'),
      periodRow('Opening AP', r.result.openingPerPeriod.slice(0, yl.length), 'none'),
      periodRow('Closing AP', r.result.perPeriod.slice(0, yl.length), 'last', 'subtotal'),
      periodRow('Cash paid', r.result.cashPaidPerPeriod.slice(0, yl.length), 'sum'),
    ])));
  }
  const apt = ap.projectTotals;
  items.push(tTable('Tab 3: Schedules', 'schedules', periodTable('Accounts Payable (project total)', py, yl, [
    periodRow('Opex incurred', apt.opexIncurredPerPeriod, 'sum'),
    periodRow('Opening AP', apt.openingApPerPeriod, 'none'),
    periodRow('Change in AP', apt.changeApPerPeriod, 'sum'),
    periodRow('Closing AP', apt.closingApPerPeriod, 'last', 'subtotal'),
    periodRow('Cash paid', apt.cashPaidPerPeriod, 'sum', 'total'),
  ])));

  return items;
}

// ── Module 4: Financial Statements ───────────────────────────────────────────
function buildModule4(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: Fmt, py: number): ModuleContent {
  const yl = snap.yearLabels;
  const { bs, fixedAssets: fa } = snap;
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;
  const items: ModuleContent = [];

  // P&L / CF / BS render from the SHARED platform row-builders
  // (lib/reports/m4Reports.ts), so the PDF mirrors the on-screen statements
  // exactly and stays in sync as rows are added / removed on the platform.
  const labels = getFinancialLabels(state.project.financialTerminology ?? defaultTerminologyForCountry(state.project.country));
  const fmtFn = (v: number): string => fmt.money(v);
  const m4ctx = (filterPhaseId: string): { snap: ProjectFinancialsSnapshot; state: FinancialsResolverState; labels: ReturnType<typeof getFinancialLabels>; filterPhaseId: string; fmt: (v: number) => string } =>
    ({ snap, state, labels, filterPhaseId, fmt: fmtFn });
  const hasData = (rows: M4Row[]): boolean => rows.some((r) => r.values.some((v) => v !== 0));

  // Tab 1: Schedules (IDC pool + working capital).
  const idc = snap.idc;
  items.push(tTable('Tab 1: Schedules', 'schedules', periodTable('IDC Pool', py, yl, [
    periodRow('Construction interest', idc.totalConstructionInterestPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Capitalised to assets', idc.totalIdcPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('IDC depreciation', idc.idcDepreciationPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('IDC NBV closing', idc.idcNbvPerPeriod.slice(0, yl.length), 'last', 'total'),
  ])));
  const apt = snap.ap.projectTotals;
  items.push(tTable('Tab 1: Schedules', 'schedules', periodTable('Working Capital', py, yl, [
    periodRow('Accounts receivable (closing)', bs.arPerPeriod.slice(0, yl.length), 'last'),
    periodRow('Residential receivables (closing)', bs.residentialReceivablesPerPeriod.slice(0, yl.length), 'last'),
    periodRow('Inventory / WIP (closing)', bs.inventoryPerPeriod.slice(0, yl.length), 'last'),
    periodRow('Accounts payable (closing)', apt.closingApPerPeriod.slice(0, yl.length), 'last'),
    periodRow('Unearned revenue (closing)', bs.unearnedRevenuePerPeriod.slice(0, yl.length), 'last'),
  ])));
  // Full BS feeder schedules (A1-E2) + the reconciliation bridge, from the SAME
  // shared builders the on-screen Module 4 Schedules / Balance Sheet tabs use, so
  // the PDF mirrors the platform (previously these were missing from the PDF).
  const feederCtx: M4FeederCtx = { snap, state, fmt: fmtFn };
  for (const f of buildBsFeederTables(feederCtx)) {
    items.push(tTable('Tab 1: Schedules', 'schedules', m4RowsToPeriodTable(f.title, py, yl, f.rows)));
  }
  items.push(tTable('Tab 1: Schedules', 'schedules', m4RowsToPeriodTable('Balance Check, Reconciliation Bridge (per period)', py, yl, buildBsReconciliationRows(feederCtx))));

  // Tab 2: Fixed Assets.
  for (const [id, r] of fa.byAsset) {
    const dep = r.depreciable;
    if (!anyNonZero(dep.closingNBVPerPeriod) && !anyNonZero(r.land.closingPerPeriod)) continue;
    items.push(tTable('Tab 2: Fixed Assets', 'outputs', periodTable(`Fixed Assets, ${assetName(id)}`, py, yl, [
      periodRow('Land opening', r.land.openingPerPeriod.slice(0, yl.length), 'none', undefined, r.land.openingAtAxisStart),
      periodRow('Land additions', r.land.additionsPerPeriod.slice(0, yl.length), 'sum'),
      periodRow('Land closing', r.land.closingPerPeriod.slice(0, yl.length), 'last', 'subtotal'),
      periodRow('Depreciable opening NBV', dep.openingNBVPerPeriod.slice(0, yl.length), 'none'),
      periodRow('Additions', dep.additionsPerPeriod.slice(0, yl.length), 'sum'),
      periodRow('Depreciation', dep.depreciationPerPeriod.slice(0, yl.length), 'sum'),
      periodRow('Depreciable closing NBV', dep.closingNBVPerPeriod.slice(0, yl.length), 'last', 'subtotal'),
      periodRow('Combined closing (Land + NBV)', r.combinedClosingPerPeriod.slice(0, yl.length), 'last', 'total'),
    ])));
  }
  const fpt = fa.projectTotals;
  items.push(tTable('Tab 2: Fixed Assets', 'outputs', periodTable('Fixed Assets (project total)', py, yl, [
    periodRow('Land closing', fpt.land.closingPerPeriod, 'last'),
    periodRow('Depreciation', fpt.depreciable.depreciationPerPeriod, 'sum'),
    periodRow('Depreciable closing NBV', fpt.depreciable.closingNBVPerPeriod, 'last', 'subtotal'),
    periodRow('Combined closing', fpt.combinedClosingPerPeriod, 'last', 'total'),
  ])));

  // Tab 3: P&L. Full consolidated statement (exact mirror, down to PAT) then a
  // short per-phase P&L (truncated at EBITDA inside the shared builder).
  items.push(tTable('Tab 3: P&L', 'outputs', m4RowsToPeriodTable(`${labels.incomeStatementTitle}: Project`, py, yl, buildPLRows(m4ctx('__all__')))));
  for (const ph of state.phases) {
    const rows = buildPLRows(m4ctx(ph.id));
    if (hasData(rows)) {
      items.push(tTable('Tab 3: P&L', 'outputs', m4RowsToPeriodTable(`${labels.incomeStatementTitle}: ${ph.name} (to ${labels.ebitda})`, py, yl, rows)));
    }
  }

  // Tab 4: Cash Flow. Full consolidated Direct + Indirect (exact mirror) then a
  // per-phase view (Operations + Investing only) from the shared builder.
  items.push(tTable('Tab 4: Cash Flow', 'outputs', m4RowsToPeriodTable('Cash Flow, Direct Method: Project', py, yl, buildDirectCFRows(m4ctx('__all__')))));
  items.push(tTable('Tab 4: Cash Flow', 'outputs', m4RowsToPeriodTable('Cash Flow, Indirect Method: Project', py, yl, buildIndirectCFRows(m4ctx('__all__')))));
  for (const ph of state.phases) {
    const rows = buildDirectCFRows(m4ctx(ph.id));
    if (hasData(rows)) {
      items.push(tTable('Tab 4: Cash Flow', 'outputs', m4RowsToPeriodTable(`Cash Flow: ${ph.name} (Operations + Investing)`, py, yl, rows)));
    }
  }

  // Tab 5: Balance Sheet. Consolidated only (exact mirror).
  items.push(tTable('Tab 5: Balance Sheet', 'outputs', m4RowsToPeriodTable('Balance Sheet: Project', py, yl, buildBSRows(m4ctx('__all__')).rows)));

  return items;
}

// ── Module 5: Returns & Valuation ────────────────────────────────────────────
function buildModule5(returns: ReturnsSnapshot, state: FinancialsResolverState, fmt: Fmt, py: number, caseReport: CaseComparisonReport | null): ModuleContent {
  const r = returns.result;
  const re = r.realEstate;
  const cfg = returns.config;
  const syl = returns.streamYearLabels;
  const yl = returns.yearLabels;
  const items: ModuleContent = [];
  const streamPrior = syl[0] ?? py;
  const streamYears = syl.slice(1);

  // Tab 1: Returns (KPI cards + tables).
  items.push(tTable('Tab 1: Returns', 'inputs', kvTable('Returns Assumptions', [
    ['Discount rate', fmt.pct(cfg.discountRate, 2)],
    ['Exit year', String(returns.exitYearLabel)],
    ['Terminal value method', String(cfg.terminalMethod)],
    ['Exit multiple', `${(cfg.exitMultiple ?? 0).toFixed(2)}x`],
    ['Perpetuity growth', fmt.pct(cfg.perpetuityGrowth, 2)],
  ])));
  items.push(tCards('Tab 1: Returns', 'outputs', 'Headline Returns', [
    { label: 'Project IRR (FCFF)', value: fmt.pct(r.fcff.irr, 1), sub: 'unlevered' },
    { label: 'Equity IRR (FCFE)', value: fmt.pct(r.fcfe.irr, 1), sub: 'levered' },
    { label: 'Distributed Equity IRR', value: fmt.pct(r.dividends.irr, 1), sub: 'on distributions' },
    { label: 'Equity Multiple', value: fmt.mult(r.fcfe.moic), sub: 'FCFE' },
    { label: 'Dividend MOIC', value: fmt.mult(r.dividends.moic), sub: 'distributed equity' },
    { label: 'Terminal Equity Value', value: fmt.money(returns.terminalEquityValue), sub: `exit ${returns.exitYearLabel}` },
  ]));
  const de = returns.developmentEconomics;
  items.push(tCards('Tab 1: Returns', 'outputs', 'Development Economics', [
    { label: 'GDV', value: fmt.money(de.gdv) },
    { label: 'Total Dev Cost', value: fmt.money(de.totalDevelopmentCost) },
    { label: 'Financing Cost', value: fmt.money(de.totalFinancingCost) },
    { label: 'Profit Before Fin.', value: fmt.money(de.profitBeforeFinancing) },
    { label: 'Profit After Fin.', value: fmt.money(de.profitAfterFinancing) },
    { label: 'Development Margin', value: fmt.pct(de.developmentMargin, 1) },
  ]));
  const ex = returns.exitAnalysis;
  items.push(tCards('Tab 1: Returns', 'outputs', `Exit Analysis (${ex.exitYearLabel})`, [
    { label: 'Exit NOI', value: fmt.money(ex.exitNOI) },
    { label: 'Exit EBITDA', value: fmt.money(ex.exitEBITDA) },
    { label: 'Enterprise Value', value: fmt.money(ex.exitEnterpriseValue) },
    { label: 'Equity Value', value: fmt.money(ex.exitEquityValue) },
    { label: 'Debt at Exit', value: fmt.money(ex.exitDebt) },
    { label: 'LTV at Exit', value: fmt.pct(ex.ltvAtExit, 1) },
  ]));
  const su = returns.sourcesUses;
  items.push(tTable('Tab 1: Returns', 'outputs', {
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
  items.push(tCards('Tab 1: Returns', 'outputs', 'Equity Exposure & Debt Analytics', [
    { label: 'Total Equity Required', value: fmt.money(ee.totalEquityRequired) },
    { label: 'Avg Equity Invested', value: fmt.money(ee.averageEquityInvested) },
    { label: 'Equity at Risk', value: fmt.money(ee.equityAtRisk) },
    { label: 'Peak Debt', value: fmt.money(da.peakDebt) },
    { label: 'Debt Paydown', value: fmt.pct(da.paydownPct, 1) },
    { label: 'Debt Tenor', value: da.tenorYears === null ? 'n/a' : `${da.tenorYears.toFixed(0)} yrs` },
  ]));
  // Exit-year analysis (Pass 2) as a table.
  if (returns.exitYears?.length) {
    items.push(tTable('Tab 1: Returns', 'outputs', {
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
    items.push(tTable('Tab 1: Returns', 'outputs', {
      title: 'Equity Partners', kind: 'grid', align: 'data',
      columns: ['Partner', 'Invested', 'Share %', 'Dividends', 'Terminal', 'IRR', 'MOIC'],
      rows: returns.partners.partners.map((pn) => row([pn.name, fmt.money(pn.totalEquityInvested), fmt.pct(pn.shareholdingPct, 1), fmt.money(pn.dividendsReceived), fmt.money(pn.terminalDistribution), fmt.pct(pn.irr, 1), fmt.mult(pn.moic)])),
    }));
  }

  // Tab 2: RE Metrics (cards + coverage + per-asset).
  items.push(tCards('Tab 2: RE Metrics', 'outputs', 'Profitability & Yield', [
    { label: 'Yield on Cost', value: fmt.pct(re.yieldOnCost, 2) },
    { label: 'Cap Rate at Exit', value: fmt.pct(re.capRateAtExit, 2) },
    { label: 'Development Spread', value: fmt.pct(re.developmentSpread, 2) },
    { label: 'Profit on Cost', value: fmt.pct(re.profitOnCost, 1) },
    { label: 'Profit Margin', value: fmt.pct(re.profitMargin, 1) },
    { label: 'Equity Multiple', value: fmt.mult(re.equityMultiple) },
  ]));
  items.push(tCards('Tab 2: RE Metrics', 'outputs', 'Leverage & Coverage', [
    { label: 'LTV at Exit', value: fmt.pct(re.ltvAtExit, 1) },
    { label: 'Debt Yield', value: fmt.pct(re.debtYield, 1) },
    { label: 'Min DSCR', value: fmt.mult(re.dscrMin) },
    { label: 'Avg DSCR', value: fmt.mult(re.dscrAvg) },
    { label: 'Min Interest Cover', value: fmt.mult(re.icrMin) },
    { label: 'Avg Cash-on-Cash', value: fmt.pct(re.cashOnCashAvg, 1) },
  ]));
  if (anyNonZero(re.dscrPerPeriod) || anyNonZero(re.icrPerPeriod)) {
    items.push(tTable('Tab 2: RE Metrics', 'outputs', periodTable('Coverage Ratios by Year', py, yl, [
      strPeriodRow('DSCR', re.dscrPerPeriod.map((v) => (v ? v.toFixed(2) : '-'))),
      strPeriodRow('Interest cover', re.icrPerPeriod.map((v) => (v ? v.toFixed(2) : '-'))),
      strPeriodRow('Cash-on-cash %', re.cashOnCashPerPeriod.map((v) => (v ? fmt.pct(v, 1) : '-'))),
    ])));
  }
  if (returns.perAsset?.rows.length) {
    items.push(tTable('Tab 2: RE Metrics', 'outputs', {
      title: 'Per-Asset Economics', kind: 'grid', align: 'data',
      columns: ['Asset', 'Strategy', 'Revenue', 'Cost', 'Profit', 'Margin', 'Yield on Cost'],
      rows: returns.perAsset.rows.map((a) => row([a.assetName, a.strategy, fmt.money(a.totalRevenue), fmt.money(a.totalCost), fmt.money(a.profit), fmt.pct(a.profitMargin, 1), a.isIncomeAsset ? fmt.pct(a.yieldOnCost, 1) : 'n/a'])),
    }));
  }

  // Tab 3: Case Comparison. Headline KPIs across every case (Management base +
  // scenarios), with each scenario's delta vs the base in the same cell. Reads
  // the SHARED builder (lib/reports/caseComparisonReport.ts) that also feeds the
  // on-screen Case Comparison tab. Only rendered when there is more than one
  // case to compare.
  const m5Matrix = caseReport ? buildCaseComparisonMatrix(caseReport, fmt) : null;
  if (m5Matrix) items.push(tTable('Tab 3: Case Comparison', 'outputs', m5Matrix));

  // Tab 4: Cash Flow Streams.
  const bu = returns.buildup;
  items.push(tTable('Tab 4: Cash Flow Streams', 'schedules', periodTable('Sponsor Cash-Flow Streams', streamPrior, streamYears, [
    periodRow('FCFF (unlevered)', returns.fcffPerPeriod.slice(1), 'sum', undefined, returns.fcffPerPeriod[0] ?? 0),
    periodRow('FCFE (levered)', returns.fcfePerPeriod.slice(1), 'sum', undefined, returns.fcfePerPeriod[0] ?? 0),
    periodRow('Distributed equity', returns.dividendStreamPerPeriod.slice(1), 'sum', undefined, returns.dividendStreamPerPeriod[0] ?? 0),
  ])));
  items.push(tTable('Tab 4: Cash Flow Streams', 'schedules', periodTable('FCFF Build-up', streamPrior, streamYears, [
    periodRow('(-) Existing pre-capex', bu.existingPreCapexPerPeriod.slice(1), 'sum', undefined, bu.existingPreCapexPerPeriod[0] ?? 0),
    periodRow('(+) Cash from operations', bu.cfoPerPeriod.slice(1), 'sum', undefined, bu.cfoPerPeriod[0] ?? 0),
    periodRow('(+) Cash from investing', bu.cfiPerPeriod.slice(1), 'sum', undefined, bu.cfiPerPeriod[0] ?? 0),
    periodRow('(+) Terminal enterprise value', bu.terminalEnterprisePerPeriod.slice(1), 'sum', undefined, bu.terminalEnterprisePerPeriod[0] ?? 0),
    periodRow('= FCFF', returns.fcffPerPeriod.slice(1), 'sum', 'total', returns.fcffPerPeriod[0] ?? 0),
  ])));
  items.push(tTable('Tab 4: Cash Flow Streams', 'schedules', periodTable('FCFE Build-up', streamPrior, streamYears, [
    periodRow('FCFF', returns.fcffPerPeriod.slice(1), 'sum', undefined, returns.fcffPerPeriod[0] ?? 0),
    periodRow('(+) Existing debt opening', bu.existingDebtOpeningPerPeriod.slice(1), 'sum', undefined, bu.existingDebtOpeningPerPeriod[0] ?? 0),
    periodRow('(+) Debt drawdown', bu.debtDrawPerPeriod.slice(1), 'sum', undefined, bu.debtDrawPerPeriod[0] ?? 0),
    periodRow('(-) Principal repaid', bu.principalRepayPerPeriod.slice(1), 'sum', undefined, bu.principalRepayPerPeriod[0] ?? 0),
    periodRow('(-) Interest paid', bu.interestPaidPerPeriod.slice(1), 'sum', undefined, bu.interestPaidPerPeriod[0] ?? 0),
    periodRow('(-) In-kind land', bu.inKindLandPerPeriod.slice(1), 'sum', undefined, bu.inKindLandPerPeriod[0] ?? 0),
    periodRow('(+) Terminal equity value', bu.terminalEquityPerPeriod.slice(1), 'sum', undefined, bu.terminalEquityPerPeriod[0] ?? 0),
    periodRow('= FCFE', returns.fcfePerPeriod.slice(1), 'sum', 'total', returns.fcfePerPeriod[0] ?? 0),
  ])));

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
        [c.name, c.role === 'base' ? 'Management (base)' : 'Scenario', c.isActive ? 'Yes' : '', c.role === 'base' ? '-' : fmt.int(c.overrideCount)],
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
function renderableContent(content: ModuleContent, sel: ModuleSectionSelection, selectedTabs?: string[]): ModuleContent {
  return content.filter((it) => includePart(sel[it.part]) && (!selectedTabs || selectedTabs.includes(it.tab)));
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
    if (selectedTabs && !selectedTabs.includes(it.tab)) continue;
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
  drawCover(ctx, opts.projectName, 'Real Estate Financial Model / Feasibility Study', opts.dateLabel);

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
  for (const m of MODULES) {
    if (!selectedKeys.has(m.key)) continue;
    if (!BUILT.has(m.key)) { beginModule(m); renderPlaceholderModule(ctx, m); ctx.nav.current = null; continue; }
    let content: ModuleContent | null = null;
    if (m.key === 'module1') content = buildModule1(snap, opts.state, fmt, py);
    else if (m.key === 'module2') content = buildModule2(snap, opts.state, fmt, py);
    else if (m.key === 'module3') content = buildModule3(snap, opts.state, fmt, py);
    else if (m.key === 'module4') content = buildModule4(snap, opts.state, fmt, py);
    else if (m.key === 'module5') content = returns ? buildModule5(returns, opts.state, fmt, py, caseReport) : null;
    else if (m.key === 'module6') content = buildModule6(caseReport, caseYoY, fmt);
    else continue;
    if (!content) continue;
    content = dropEmptyItems(content); // suppress genuinely-empty items (header, no body)
    // Skip a module ENTIRELY (no section-break / ToC / outline node) when the
    // Inputs/Schedules/Outputs filter + per-tab selection leave it with nothing to
    // render, so nav lists only included content with no dangling links.
    if (!renderableContent(content, sel[m.key] ?? {}, opts.moduleTabs?.[m.key]).length) continue;
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
  if (returns) out.module5 = distinct(buildModule5(returns, state, fmt, py, caseReport));
  return out;
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
    module5: returns ? buildModule5(returns, state, fmt, py, caseReport) : [],
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
  };

  // Scenario summary is shown in the exec summary when the caller supplies the
  // case bundle (so the standalone Executive Summary PDF also covers scenarios).
  let caseReport: CaseComparisonReport | null = null;
  if (opts.caseComparison) {
    try { caseReport = buildCaseComparisonReport(opts.caseComparison); } catch { caseReport = null; }
  }

  // Cover + executive summary (narrative + KPI cards + composition + structure).
  drawCover(ctx, opts.projectName, 'Real Estate Financial Model / Executive Summary', opts.dateLabel);
  newPage(ctx, 'Executive Summary');
  ctx.currentHeader = 'Executive Summary';
  buildExecSummary(ctx, snap, returns, opts.state, fmt, caseReport);

  const py = snap.projectStartYear - 1;
  const yl = snap.yearLabels;
  const { pl, directCF: cf, bs } = snap;

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
  drawItem(ctx, { type: 'table', table: periodTable('Profit & Loss (summary)', py, yl, [
    periodRow('Total revenue', pl.totalRevenuePerPeriod, 'sum'),
    periodRow('Cost of sales', pl.cosPerPeriod, 'sum'),
    periodRow('Operating expenses', pl.totalOpexPerPeriod, 'sum'),
    periodRow('EBITDA', pl.ebitdaPerPeriod, 'sum', 'subtotal'),
    periodRow('Depreciation & amortization', pl.daPerPeriod, 'sum'),
    periodRow('EBIT', pl.ebitPerPeriod, 'sum', 'subtotal'),
    periodRow('Interest expense', pl.interestExpensePerPeriod, 'sum'),
    periodRow('Profit before tax', pl.pbtPerPeriod, 'sum', 'subtotal'),
    periodRow('Tax / Zakat', pl.taxPerPeriod, 'sum'),
    periodRow('Profit after tax', pl.patPerPeriod, 'sum', 'total'),
  ]) }, fmt);
  drawItem(ctx, { type: 'table', table: periodTable('Cash Flow (summary)', py, yl, [
    periodRow('Cash from operations', cf.cashFromOperationsPerPeriod, 'sum', 'subtotal'),
    periodRow('Cash from investing', cf.cashFromInvestmentPerPeriod, 'sum', 'subtotal'),
    periodRow('Cash from financing', cf.cashFromFinancingPerPeriod, 'sum', 'subtotal'),
    periodRow('Net cash flow', cf.netCashFlowPerPeriod, 'sum'),
    periodRow('Closing cash', cf.closingCashPerPeriod, 'last', 'total'),
  ]) }, fmt);
  drawItem(ctx, { type: 'table', table: periodTable('Balance Sheet (summary)', py, yl, [
    periodRow('Cash', bs.cashPerPeriod, 'last', undefined, bs.historicalOpeningCashTotal),
    periodRow('Total assets', bs.totalAssetsPerPeriod, 'last', 'subtotal'),
    periodRow('Debt outstanding', bs.debtOutstandingPerPeriod, 'last', undefined, snap.financing.existing.debtOutstandingTotal),
    periodRow('Total liabilities', bs.totalLiabilitiesPerPeriod, 'last', 'subtotal'),
    periodRow('Total equity', bs.totalEquityPerPeriod, 'last', 'subtotal'),
    periodRow('Liabilities + equity', bs.totalLiabilitiesAndEquityPerPeriod, 'last', 'total'),
  ]) }, fmt);

  // Returns & valuation (KPI cards).
  if (returns) {
    newPage(ctx, 'Returns & Valuation');
    ctx.currentHeader = 'Returns & Valuation';
    const r = returns.result;
    const re = r.realEstate;
    const de = returns.developmentEconomics;
    const exa = returns.exitAnalysis;
    drawCards(ctx, 'Headline Returns', [
      { label: 'Project IRR', value: fmt.pct(r.fcff.irr, 1), sub: 'unlevered (FCFF)' },
      { label: 'Equity IRR', value: fmt.pct(r.fcfe.irr, 1), sub: 'levered (FCFE)' },
      { label: 'Equity Multiple', value: fmt.mult(r.fcfe.moic), sub: 'FCFE' },
      { label: 'Distributed Equity IRR', value: fmt.pct(r.dividends.irr, 1), sub: 'on distributions' },
      { label: 'Distributed MOIC', value: fmt.mult(r.dividends.moic), sub: 'distributions / invested' },
      { label: 'Terminal Equity Value', value: fmt.money(returns.terminalEquityValue), sub: `exit ${returns.exitYearLabel}` },
    ]);
    drawCards(ctx, 'Development Economics', [
      { label: 'GDV', value: fmt.money(de.gdv) },
      { label: 'Total Dev Cost', value: fmt.money(de.totalDevelopmentCost) },
      { label: 'Profit After Financing', value: fmt.money(de.profitAfterFinancing) },
      { label: 'Development Margin', value: fmt.pct(de.developmentMargin, 1) },
      { label: 'Yield on Cost', value: fmt.pct(re.yieldOnCost, 2) },
      { label: 'Cap Rate at Exit', value: fmt.pct(re.capRateAtExit, 2) },
    ]);
    drawCards(ctx, `Exit & Leverage (${exa.exitYearLabel})`, [
      { label: 'Exit Equity Value', value: fmt.money(exa.exitEquityValue) },
      { label: 'LTV at Exit', value: fmt.pct(re.ltvAtExit, 1) },
      { label: 'Min DSCR', value: fmt.mult(re.dscrMin) },
      { label: 'Peak Debt', value: fmt.money(Math.max(0, ...bs.debtOutstandingPerPeriod)) },
      { label: 'Profit Margin', value: fmt.pct(re.profitMargin, 1) },
      { label: 'Equity Multiple', value: fmt.mult(re.equityMultiple) },
    ]);
  }

  drawFooters(ctx);
  return doc.save();
}
