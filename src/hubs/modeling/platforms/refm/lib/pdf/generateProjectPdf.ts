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
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
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
import { buildPLRows, buildDirectCFRows, buildIndirectCFRows, buildBSRows } from '../reports/m4Reports';
import { buildOpexReport } from '../reports/opexReports';
import { buildCapexReport } from '../reports/capexReports';
import { buildFinancingScheduleTables, buildCashSweepTables } from '../reports/financingReports';
import { buildCostOfSalesReport } from '../reports/cosReports';
import type { M4Row } from '../../components/modules/_shared/m4Table';
import { MODULES } from '../modules-config';

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
  /** Display scale for the PDF (overrides the project setting). Default millions. */
  displayScale?: DisplayScale;
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

function makeFmt(scale: DisplayScale): Fmt {
  const dec = scale === 'full' ? 0 : scale === 'millions' ? 1 : 0;
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

function drawPartHeader(ctx: Ctx, label: string): void {
  ensureSpace(ctx, PART_H + 4);
  ctx.y -= PART_H;
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: CONTENT_W, height: PART_H, color: PART_FILL });
  drawCell(ctx, label, MARGIN, CONTENT_W, ctx.y + 2, { font: ctx.bold, size: 10, color: NAVY_DARK });
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

function drawGridTable(ctx: Ctx, table: PdfTable, fmt: Fmt): void {
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
    r.cells.forEach((cell, i) => {
      const align: 'left' | 'right' = i === 0 ? 'left' : dataAlign ? 'right' : 'left';
      drawCell(ctx, fmt.cell(cell), colX(i), colW(i), ctx.y, { align, font: st.bold ? ctx.bold : ctx.font, size: 8, color: st.color });
    });
  }
  ctx.y -= SECTION_GAP;
}

function drawPeriodTable(ctx: Ctx, table: PdfTable, fmt: Fmt): void {
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
      cells.forEach((cell, k) => drawCell(ctx, fmt.cell(cell ?? null), colX(k), colW(k), ctx.y, { align: k === 0 ? 'left' : 'right', font: st.bold ? ctx.bold : ctx.font, size: 8, color: st.color }));
    }
    ctx.y -= SECTION_GAP;
  });
}

function drawItem(ctx: Ctx, item: PdfItem, fmt: Fmt): void {
  if (item.type === 'table') { item.table.kind === 'period' ? drawPeriodTable(ctx, item.table, fmt) : drawGridTable(ctx, item.table, fmt); }
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
  const total = ctx.pages.length;
  const barH = 18;
  const barY = 12;
  ctx.pages.forEach((page, i) => {
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

// ── Executive summary ─────────────────────────────────────────────────────────
function buildExecSummary(ctx: Ctx, snap: ProjectFinancialsSnapshot, returns: ReturnsSnapshot | null, state: FinancialsResolverState, fmt: Fmt): void {
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
function buildModule5(returns: ReturnsSnapshot, state: FinancialsResolverState, fmt: Fmt, py: number): ModuleContent {
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

  // Tab 3: Cash Flow Streams.
  const bu = returns.buildup;
  items.push(tTable('Tab 3: Cash Flow Streams', 'schedules', periodTable('Sponsor Cash-Flow Streams', streamPrior, streamYears, [
    periodRow('FCFF (unlevered)', returns.fcffPerPeriod.slice(1), 'sum', undefined, returns.fcffPerPeriod[0] ?? 0),
    periodRow('FCFE (levered)', returns.fcfePerPeriod.slice(1), 'sum', undefined, returns.fcfePerPeriod[0] ?? 0),
    periodRow('Distributed equity', returns.dividendStreamPerPeriod.slice(1), 'sum', undefined, returns.dividendStreamPerPeriod[0] ?? 0),
  ])));
  items.push(tTable('Tab 3: Cash Flow Streams', 'schedules', periodTable('FCFF Build-up', streamPrior, streamYears, [
    periodRow('(-) Existing pre-capex', bu.existingPreCapexPerPeriod.slice(1), 'sum', undefined, bu.existingPreCapexPerPeriod[0] ?? 0),
    periodRow('(+) Cash from operations', bu.cfoPerPeriod.slice(1), 'sum', undefined, bu.cfoPerPeriod[0] ?? 0),
    periodRow('(+) Cash from investing', bu.cfiPerPeriod.slice(1), 'sum', undefined, bu.cfiPerPeriod[0] ?? 0),
    periodRow('(+) Terminal enterprise value', bu.terminalEnterprisePerPeriod.slice(1), 'sum', undefined, bu.terminalEnterprisePerPeriod[0] ?? 0),
    periodRow('= FCFF', returns.fcffPerPeriod.slice(1), 'sum', 'total', returns.fcffPerPeriod[0] ?? 0),
  ])));
  items.push(tTable('Tab 3: Cash Flow Streams', 'schedules', periodTable('FCFE Build-up', streamPrior, streamYears, [
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

// ── Assembly ──────────────────────────────────────────────────────────────────
function includePart(flag: boolean | undefined): boolean { return flag !== false; }

function renderModule(ctx: Ctx, moduleLabel: string, items: ModuleContent, sel: ModuleSectionSelection, fmt: Fmt): void {
  // Group by tab (stable order), keeping only selected parts.
  const order: string[] = [];
  const byTab = new Map<string, TaggedItem[]>();
  for (const it of items) {
    if (!includePart(sel[it.part])) continue;
    if (!byTab.has(it.tab)) { byTab.set(it.tab, []); order.push(it.tab); }
    byTab.get(it.tab)!.push(it);
  }
  for (const tab of order) {
    const tabItems = byTab.get(tab)!;
    const header = `${moduleLabel}  ·  ${tab}`;
    newPage(ctx, header);
    ctx.currentHeader = header;
    let curPart: PartKind | null = null;
    for (const part of ['inputs', 'outputs', 'schedules'] as PartKind[]) {
      const partItems = tabItems.filter((i) => i.part === part);
      for (const ti of partItems) {
        if (ti.part !== curPart) { drawPartHeader(ctx, PART_LABEL[part]); curPart = ti.part; }
        drawItem(ctx, ti.item, fmt);
      }
    }
  }
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
  const fmt = makeFmt(scale);
  const ctx: Ctx = {
    doc, font, bold, pages: [], page: null as unknown as PDFPage, y: 0,
    projectName: opts.projectName || 'Untitled Project',
    unitLabel: unitLabel(p.currency ?? 'SAR', scale),
  };

  // Page 1: clean cover.
  drawCover(ctx, opts.projectName, 'Real Estate Financial Model / Feasibility Study', opts.dateLabel);

  // Page 2: executive summary.
  newPage(ctx, 'Executive Summary');
  ctx.currentHeader = 'Executive Summary';
  buildExecSummary(ctx, snap, returns, opts.state, fmt);

  // Modules.
  const py = snap.projectStartYear - 1;
  const sel = opts.moduleSections ?? {};
  const selectedKeys = new Set(opts.selectedModuleKeys);
  for (const m of MODULES) {
    if (!selectedKeys.has(m.key)) continue;
    let content: ModuleContent | null = null;
    if (m.key === 'module1') content = buildModule1(snap, opts.state, fmt, py);
    else if (m.key === 'module2') content = buildModule2(snap, opts.state, fmt, py);
    else if (m.key === 'module3') content = buildModule3(snap, opts.state, fmt, py);
    else if (m.key === 'module4') content = buildModule4(snap, opts.state, fmt, py);
    else if (m.key === 'module5') content = returns ? buildModule5(returns, opts.state, fmt, py) : null;
    else continue;
    if (!content || !content.length) continue;
    renderModule(ctx, `Module ${m.num}: ${m.longLabel}`, content, sel[m.key] ?? {}, fmt);
  }

  drawFooters(ctx);
  return doc.save();
}
