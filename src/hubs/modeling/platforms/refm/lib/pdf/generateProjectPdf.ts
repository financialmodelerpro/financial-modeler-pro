/**
 * generateProjectPdf.ts
 *
 * Full-project PDF report for the REFM platform. Renders ONE document that
 * walks every selected module in platform tab order, covering inputs, outputs
 * and schedules, styled with the platform navy headers + accounting number
 * format. No new calculations: it reads the same snapshots the UI reads
 * (computeFinancialsSnapshot + computeReturnsSnapshot) and renders them.
 *
 * Structure:
 *   - Cover page (portrait): project name, version + comment, date, location /
 *     currency / scale / horizon, headline KPIs, subtle FMP branding.
 *   - Project Description page (portrait): project metadata, phases table,
 *     assets grouped by phase. The "About the Project" page.
 *   - Per module (landscape), each starting on a new page: a navy header, then
 *     the module's Inputs / Outputs / Schedules sub-sections in tab order.
 *   - Footer on every page: page number + project name + version.
 *
 * Each module returns a ModuleContent { inputs, outputs, schedules }; the caller
 * picks which modules + which of the three parts to include (moduleSections).
 * Wide period tables split across pages: the label + Total columns and the
 * header row repeat on each column-chunk, and rows overflowing the page height
 * continue on a new page with the header repeated. Module pages are landscape
 * A4; the cover + description are portrait A4.
 *
 * The renderer is pure (state in, bytes out) so the verifier can exercise it
 * headless. pdf-lib is the only dependency (already in package.json).
 */
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  formatAccounting,
  formatArea,
  formatInteger,
  type DisplayScale,
} from '@/src/core/formatters';
import { computeSubUnitArea } from '@/src/core/calculations';
import INTER_REGULAR_B64 from './fonts/interRegular';
import INTER_BOLD_B64 from './fonts/interBold';
import {
  computeFinancialsSnapshot,
  type ProjectFinancialsSnapshot,
  type FinancialsResolverState,
} from '../financials-resolvers';
import { computeReturnsSnapshot, type ReturnsSnapshot } from '../returns-resolvers';
import { MODULES } from '../modules-config';

// Decode a base64 string to bytes in both Node (Buffer) and the browser (atob).
function b64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Table model ───────────────────────────────────────────────────────────
export type RowEmphasis = 'data' | 'subtotal' | 'total' | 'heading';

export interface PdfTableRow {
  cells: Array<string | number | null>;
  emphasis?: RowEmphasis;
}

export interface PdfTable {
  title: string;
  /** 'period': cells = [label, Total, ...periodValues] with column splitting.
   *  'grid': arbitrary columns, no splitting (used for KV + small lists). */
  kind: 'period' | 'grid';
  /** Column headers. For 'period': ['', 'Total', y1, y2, ...]. */
  columns: string[];
  rows: PdfTableRow[];
  /** Grid alignment: 'kv' keeps the value column left-aligned (label/value
   *  lists); 'data' right-aligns every column after the first (number grids). */
  align?: 'kv' | 'data';
}

/** A module's content, split into the three selectable parts. */
export interface ModuleContent {
  inputs: PdfTable[];
  outputs: PdfTable[];
  schedules: PdfTable[];
}

/** Per-module part selection (missing flags default to true / included). */
export interface ModuleSectionSelection {
  inputs?: boolean;
  outputs?: boolean;
  schedules?: boolean;
}

export interface GenerateProjectPdfOptions {
  state: FinancialsResolverState;
  projectName: string;
  versionLabel?: string | null;
  /** Optional version comment, printed under the version on the cover. */
  versionComment?: string | null;
  /** Caller-supplied date string (the engine never reads the clock). */
  dateLabel: string;
  /** Module keys to include (e.g. ['module1','module4']). */
  selectedModuleKeys: string[];
  /** Per-module Inputs / Outputs / Schedules toggles. Missing module or
   *  missing flag => that part is included. */
  moduleSections?: Record<string, ModuleSectionSelection>;
}

// ── Colors / layout ─────────────────────────────────────────────────────────
const NAVY = rgb(0x1b / 255, 0x4f / 255, 0x8a / 255);        // --color-navy
const NAVY_DARK = rgb(0x1b / 255, 0x3a / 255, 0x6b / 255);   // --color-navy-dark
const WHITE = rgb(1, 1, 1);
const TEXT = rgb(0.12, 0.16, 0.22);
const MUTED = rgb(0.42, 0.46, 0.52);
const SUBTOTAL_FILL = rgb(0.90, 0.93, 0.97);                 // navy ~12% mix
const PART_FILL = rgb(0.84, 0.89, 0.96);                     // sub-section band
const BORDER = rgb(0.82, 0.85, 0.89);

const PAGE_W_L = 841.89; // A4 landscape
const PAGE_H_L = 595.28;
const PAGE_W_P = 595.28; // A4 portrait
const PAGE_H_P = 841.89;
const MARGIN = 34;
const HEADER_BAND_H = 30;
const FOOTER_H = 22;
const CONTENT_BOTTOM = MARGIN + FOOTER_H;

const LABEL_COL_W = 200;
const TOTAL_COL_W = 66;
const PERIOD_COL_W = 50;
const ROW_H = 14;
const HEADER_ROW_H = 16;
const TITLE_H = 18;
const PART_H = 20;
const SECTION_GAP = 10;
// Period tables only render on landscape pages, so size the chunk to the
// landscape content width.
const PERIODS_PER_PAGE = Math.max(
  1,
  Math.floor((PAGE_W_L - 2 * MARGIN - LABEL_COL_W - TOTAL_COL_W) / PERIOD_COL_W),
);

// ── Internal render context ─────────────────────────────────────────────────
interface Ctx {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  pages: PDFPage[];
  page: PDFPage;
  y: number;
  pageW: number;
  pageH: number;
  landscape: boolean;
  projectName: string;
  versionLabel: string;
  currentModuleHeader?: string;
}

const contentW = (ctx: Ctx): number => ctx.pageW - 2 * MARGIN;

function newPage(ctx: Ctx, opts: { landscape: boolean; headerTitle?: string }): void {
  ctx.landscape = opts.landscape;
  ctx.pageW = opts.landscape ? PAGE_W_L : PAGE_W_P;
  ctx.pageH = opts.landscape ? PAGE_H_L : PAGE_H_P;
  const page = ctx.doc.addPage([ctx.pageW, ctx.pageH]);
  ctx.pages.push(page);
  ctx.page = page;
  if (opts.headerTitle) {
    drawHeaderBand(ctx, opts.headerTitle);
    ctx.y = ctx.pageH - HEADER_BAND_H - 8;
  } else {
    ctx.y = ctx.pageH - MARGIN;
  }
}

function drawHeaderBand(ctx: Ctx, title: string): void {
  const { page, bold } = ctx;
  page.drawRectangle({ x: 0, y: ctx.pageH - HEADER_BAND_H, width: ctx.pageW, height: HEADER_BAND_H, color: NAVY });
  page.drawText(fitText(title, bold, 13, ctx.pageW - 2 * MARGIN), {
    x: MARGIN, y: ctx.pageH - HEADER_BAND_H + 9, size: 13, font: bold, color: WHITE,
  });
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
  opts: { align?: 'left' | 'right'; font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> },
): void {
  const font = opts.font ?? ctx.font;
  const size = opts.size ?? 8;
  const color = opts.color ?? TEXT;
  const pad = 4;
  const fitted = fitText(text, font, size, w - 2 * pad);
  const tw = font.widthOfTextAtSize(fitted, size);
  const tx = opts.align === 'right' ? x + w - pad - tw : x + pad;
  ctx.page.drawText(fitted, { x: tx, y: y + 4, size, font, color });
}

// ── Number formatting bundle ────────────────────────────────────────────────
interface Fmt {
  scale: DisplayScale;
  dec: number;
  /** Period-table passthrough: number → accounting, string → as-is. */
  cell: (v: string | number | null) => string;
  /** Currency (scaled accounting). */
  money: (v: number | null | undefined) => string;
  /** Area (sqm, never scaled). */
  area: (v: number | null | undefined) => string;
  /** Integer count (never scaled). */
  int: (v: number | null | undefined) => string;
  /** Decimal fraction → percent (0.184 → "18.4%"). */
  pct: (v: number | null | undefined, d?: number) => string;
  /** Already-in-percent-units value → percent string (12.34 → "12.34%"). */
  pctRaw: (v: number | null | undefined, d?: number) => string;
  /** Multiple (1.85 → "1.85x"). */
  mult: (v: number | null | undefined) => string;
}

function makeFmt(state: FinancialsResolverState): Fmt {
  const scale: DisplayScale = state.project.displayScale ?? 'full';
  const dec = state.project.displayDecimals ?? 0;
  const money = (v: number | null | undefined): string =>
    v === null || v === undefined || !Number.isFinite(v) ? '' : formatAccounting(v, scale, dec);
  const finite = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);
  return {
    scale, dec, money,
    cell: (v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : !Number.isFinite(v) ? '' : formatAccounting(v, scale, dec)),
    area: (v) => formatArea(v ?? 0, (dec as 0 | 1 | 2 | 3)),
    int: (v) => formatInteger(v ?? 0),
    pct: (v, d = 1) => (finite(v) ? `${(v * 100).toFixed(d)}%` : 'n/a'),
    pctRaw: (v, d = 2) => (finite(v) ? `${v.toFixed(d)}%` : 'n/a'),
    mult: (v) => (finite(v) ? `${v.toFixed(2)}x` : 'n/a'),
  };
}

// ── Period-table column layout ───────────────────────────────────────────────
function chunkRanges(nPeriods: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let s = 0; s < Math.max(1, nPeriods); s += PERIODS_PER_PAGE) {
    out.push([s, Math.min(nPeriods, s + PERIODS_PER_PAGE)]);
  }
  return out.length ? out : [[0, 0]];
}

function emphasisStyle(em: RowEmphasis | undefined): {
  fill?: ReturnType<typeof rgb>; color: ReturnType<typeof rgb>; bold: boolean;
} {
  switch (em) {
    case 'total': return { fill: NAVY, color: WHITE, bold: true };
    case 'subtotal': return { fill: SUBTOTAL_FILL, color: TEXT, bold: true };
    case 'heading': return { color: NAVY_DARK, bold: true };
    default: return { color: TEXT, bold: false };
  }
}

function ensureSpace(ctx: Ctx, need: number): void {
  if (ctx.y - need < CONTENT_BOTTOM) newPage(ctx, { landscape: ctx.landscape, headerTitle: ctx.currentModuleHeader });
}

function drawTitle(ctx: Ctx, title: string): void {
  ensureSpace(ctx, TITLE_H);
  ctx.y -= TITLE_H;
  drawCell(ctx, title, MARGIN, contentW(ctx), ctx.y, { font: ctx.bold, size: 10, color: NAVY_DARK });
}

function drawPartHeader(ctx: Ctx, label: string): void {
  ensureSpace(ctx, PART_H + 4);
  ctx.y -= PART_H;
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: contentW(ctx), height: PART_H, color: PART_FILL });
  drawCell(ctx, label, MARGIN, contentW(ctx), ctx.y + 2, { font: ctx.bold, size: 10, color: NAVY_DARK });
  ctx.y -= 4;
}

function drawGridTable(ctx: Ctx, table: PdfTable, fmt: Fmt): void {
  drawTitle(ctx, table.title);
  const nCols = table.columns.length;
  const dataAlign = table.align !== 'kv';
  const firstW = Math.min(280, contentW(ctx) * 0.42);
  const restW = (contentW(ctx) - firstW) / Math.max(1, nCols - 1);
  const colX = (i: number): number => MARGIN + (i === 0 ? 0 : firstW + (i - 1) * restW);
  const colW = (i: number): number => (i === 0 ? firstW : restW);
  const drawHeader = (): void => {
    ensureSpace(ctx, HEADER_ROW_H);
    ctx.y -= HEADER_ROW_H;
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: contentW(ctx), height: HEADER_ROW_H, color: NAVY });
    table.columns.forEach((c, i) =>
      drawCell(ctx, c, colX(i), colW(i), ctx.y, { align: i === 0 || !dataAlign ? 'left' : 'right', font: ctx.bold, size: 8, color: WHITE }));
  };
  drawHeader();
  for (const r of table.rows) {
    if (ctx.y - ROW_H < CONTENT_BOTTOM) { newPage(ctx, { landscape: ctx.landscape, headerTitle: ctx.currentModuleHeader }); drawHeader(); }
    ctx.y -= ROW_H;
    const st = emphasisStyle(r.emphasis);
    if (st.fill) ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: contentW(ctx), height: ROW_H, color: st.fill });
    r.cells.forEach((cell, i) => {
      const align: 'left' | 'right' = i === 0 ? 'left' : dataAlign ? 'right' : 'left';
      drawCell(ctx, fmt.cell(cell), colX(i), colW(i), ctx.y, {
        align, font: st.bold ? ctx.bold : ctx.font, size: 8, color: st.color,
      });
    });
  }
  ctx.y -= SECTION_GAP;
}

function drawPeriodTable(ctx: Ctx, table: PdfTable, fmt: Fmt): void {
  const periodHeaders = table.columns.slice(2);
  const ranges = chunkRanges(periodHeaders.length);
  ranges.forEach(([from, to], ci) => {
    const chunkCount = to - from;
    const totalRowW = LABEL_COL_W + TOTAL_COL_W + chunkCount * PERIOD_COL_W;
    const colX = (k: number): number =>
      k === 0 ? MARGIN
        : k === 1 ? MARGIN + LABEL_COL_W
          : MARGIN + LABEL_COL_W + TOTAL_COL_W + (k - 2) * PERIOD_COL_W;
    const colW = (k: number): number => (k === 0 ? LABEL_COL_W : k === 1 ? TOTAL_COL_W : PERIOD_COL_W);
    const headerLabels = ['', 'Total', ...periodHeaders.slice(from, to)];
    drawTitle(ctx, ci === 0 ? table.title : `${table.title} (continued)`);
    const drawHeader = (): void => {
      ensureSpace(ctx, HEADER_ROW_H);
      ctx.y -= HEADER_ROW_H;
      ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: totalRowW, height: HEADER_ROW_H, color: NAVY });
      headerLabels.forEach((c, k) =>
        drawCell(ctx, c, colX(k), colW(k), ctx.y, { align: k === 0 ? 'left' : 'right', font: ctx.bold, size: 8, color: WHITE }));
    };
    drawHeader();
    for (const r of table.rows) {
      if (ctx.y - ROW_H < CONTENT_BOTTOM) { newPage(ctx, { landscape: ctx.landscape, headerTitle: ctx.currentModuleHeader }); drawHeader(); }
      ctx.y -= ROW_H;
      const st = emphasisStyle(r.emphasis);
      if (st.fill) ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: totalRowW, height: ROW_H, color: st.fill });
      const cells = [r.cells[0], r.cells[1], ...r.cells.slice(2 + from, 2 + to)];
      cells.forEach((cell, k) =>
        drawCell(ctx, fmt.cell(cell ?? null), colX(k), colW(k), ctx.y, {
          align: k === 0 ? 'left' : 'right', font: st.bold ? ctx.bold : ctx.font, size: 8, color: st.color,
        }));
    }
    ctx.y -= SECTION_GAP;
  });
}

// ── Cover page ──────────────────────────────────────────────────────────────
function drawCover(ctx: Ctx, opts: GenerateProjectPdfOptions, kpis: Array<[string, string]>, metaLines: string[]): void {
  newPage(ctx, { landscape: false });
  const { page, bold, font } = ctx;
  const W = ctx.pageW, H = ctx.pageH;
  page.drawRectangle({ x: 0, y: H - 190, width: W, height: 190, color: NAVY });
  page.drawText('Project Financial Report', { x: MARGIN, y: H - 70, size: 24, font: bold, color: WHITE });
  page.drawText(fitText(opts.projectName || 'Untitled Project', bold, 18, W - 2 * MARGIN), {
    x: MARGIN, y: H - 104, size: 18, font: bold, color: WHITE,
  });
  let vy = H - 130;
  if (opts.versionLabel) {
    page.drawText(fitText(opts.versionLabel, font, 11, W - 2 * MARGIN), { x: MARGIN, y: vy, size: 11, font, color: WHITE });
    vy -= 16;
  }
  if (opts.versionComment) {
    page.drawText(fitText(opts.versionComment, font, 9, W - 2 * MARGIN), { x: MARGIN, y: vy, size: 9, font, color: rgb(0.85, 0.9, 0.97) });
    vy -= 14;
  }
  page.drawText(opts.dateLabel, { x: MARGIN, y: vy, size: 9, font, color: rgb(0.85, 0.9, 0.97) });

  // Meta lines (location / currency / scale / horizon)
  let my = H - 230;
  for (const line of metaLines) {
    page.drawText(fitText(line, font, 10, W - 2 * MARGIN), { x: MARGIN, y: my, size: 10, font, color: TEXT });
    my -= 16;
  }

  // KPI grid (rows of 2)
  const cols = 2;
  const gap = 12;
  const boxW = (W - 2 * MARGIN - (cols - 1) * gap) / cols;
  const boxH = 64;
  const yTop = my - 16;
  kpis.forEach(([label, value], i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = MARGIN + c * (boxW + gap);
    const y = yTop - r * (boxH + gap);
    page.drawRectangle({ x, y: y - boxH, width: boxW, height: boxH, borderColor: BORDER, borderWidth: 1, color: rgb(0.98, 0.99, 1) });
    page.drawText(fitText(label.toUpperCase(), bold, 8, boxW - 16), { x: x + 10, y: y - 20, size: 8, font: bold, color: MUTED });
    page.drawText(fitText(value, bold, 17, boxW - 16), { x: x + 10, y: y - 46, size: 17, font: bold, color: NAVY_DARK });
  });

  // Subtle FMP branding at the foot of the cover.
  page.drawText('Financial Modeler Pro', { x: MARGIN, y: MARGIN + 4, size: 9, font: bold, color: MUTED });
}

// ── Footers (page numbers, drawn after all content) ─────────────────────────
function drawFooters(ctx: Ctx): void {
  const total = ctx.pages.length;
  ctx.pages.forEach((page, i) => {
    const w = page.getWidth();
    const text = `Page ${i + 1} of ${total}   ·   ${ctx.projectName}${ctx.versionLabel ? '  ·  ' + ctx.versionLabel : ''}`;
    page.drawText(fitText(text, ctx.font, 8, w - 2 * MARGIN), { x: MARGIN, y: MARGIN, size: 8, font: ctx.font, color: MUTED });
  });
}

// ── Builders: shared helpers ─────────────────────────────────────────────────
const sum = (a: number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);
const last = (a: number[]): number => a[a.length - 1] ?? 0;
const anyNonZero = (a: number[] | undefined): boolean => !!a && a.some((v) => (v ?? 0) !== 0);

function row(cells: Array<string | number | null>, emphasis?: RowEmphasis): PdfTableRow {
  return { cells, emphasis };
}

function periodRow(label: string, values: number[], total: 'sum' | 'last' | 'none', emphasis?: RowEmphasis): PdfTableRow {
  const t = total === 'sum' ? sum(values) : total === 'last' ? last(values) : null;
  return { cells: [label, t, ...values], emphasis };
}

/** Period row whose period cells are pre-formatted strings (ratios / %). */
function strPeriodRow(label: string, strs: string[], total: string | number | null = '', emphasis?: RowEmphasis): PdfTableRow {
  return { cells: [label, total, ...strs], emphasis };
}

function periodTable(title: string, yearLabels: number[], rows: PdfTableRow[]): PdfTable {
  return { title, kind: 'period', columns: ['', 'Total', ...yearLabels.map(String)], rows };
}

function kvTable(title: string, pairs: Array<[string, string]>): PdfTable {
  return { title, kind: 'grid', columns: ['Field', 'Value'], align: 'kv', rows: pairs.map(([a, b]) => row([a, b])) };
}

const indexLabel = (ix?: { method?: string; rate?: number }): string => {
  if (!ix || !ix.method || ix.method === 'none') return 'None';
  const m = ix.method === 'single_rate' ? 'Flat' : ix.method === 'yoy_compound' ? 'Compound' : ix.method === 'yoy_per_period' ? 'Per-Year' : ix.method === 'step' ? 'Step' : ix.method;
  return ix.rate !== undefined && ix.rate !== null ? `${m} ${(ix.rate * 100).toFixed(1)}%` : m;
};

// ── Project description (about) page ─────────────────────────────────────────
function buildDescriptionTables(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: Fmt): PdfTable[] {
  const p = state.project;
  const tables: PdfTable[] = [];
  const startYear = snap.projectStartYear;
  const endYear = startYear + snap.axisLength - 1;
  tables.push(kvTable('About the Project', [
    ['Project name', p.name || '(unnamed)'],
    ['Project type', String(p.projectType ?? '-')],
    ['Location', [p.location, p.country].filter(Boolean).join(', ') || '-'],
    ['Currency', p.currency],
    ['Display scale', String(p.displayScale ?? 'full')],
    ['Model horizon', `${snap.axisLength} years (${startYear} to ${endYear})`],
    ['Start date', p.startDate ?? '-'],
    ['Status', String(p.status ?? '-')],
    ['Financial terminology', p.financialTerminology ?? 'standard'],
  ]));

  // Phases summary.
  tables.push({
    title: 'Phases', kind: 'grid', align: 'data',
    columns: ['Phase', 'Status', 'Start', 'Constr. yrs', 'Ops yrs', 'End'],
    rows: state.phases.map((ph) => {
      const sy = ph.startDate ? new Date(ph.startDate).getUTCFullYear() : startYear;
      const cp = ph.constructionPeriods ?? 0;
      const ops = ph.operationsPeriods ?? 0;
      return row([ph.name, String(ph.status ?? 'planning'), String(sy), fmt.int(cp), fmt.int(ops), String(sy + cp + ops - 1)]);
    }),
  });

  // Assets grouped by phase.
  for (const ph of state.phases) {
    const assets = state.assets.filter((a) => a.phaseId === ph.id && a.visible !== false);
    if (!assets.length) continue;
    tables.push({
      title: `Assets, ${ph.name}`, kind: 'grid', align: 'data',
      columns: ['Asset', 'Strategy', 'Type', 'BUA (sqm)', 'Sub-units'],
      rows: assets.map((a) => {
        const su = state.subUnits.filter((u) => u.assetId === a.id);
        const bua = su.length ? su.reduce((s, u) => s + computeSubUnitArea(u), 0) : (a.buaSqm ?? 0);
        return row([a.name, a.strategy, a.type || '-', fmt.area(bua), fmt.int(su.length)]);
      }),
    });
  }
  return tables;
}

// ── Module 1: Setup & Financial Structure ───────────────────────────────────
function buildModule1(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: Fmt): ModuleContent {
  const p = state.project;
  const fin = snap.financing;
  const yl = snap.yearLabels;
  const trName = (id: string): string => state.financingTranches.find((t) => t.id === id)?.name ?? id;

  // ── Inputs ──
  const inputs: PdfTable[] = [];
  inputs.push(kvTable('Tab 1: Project Setup, Project Identity', [
    ['Project name', p.name || '(unnamed)'],
    ['Currency', p.currency],
    ['Location', [p.location, p.country].filter(Boolean).join(', ') || '-'],
    ['Start date', p.startDate ?? '-'],
    ['Status', String(p.status ?? '-')],
    ['Tax rate', fmt.pct(p.tax?.rate ?? 0, 1)],
  ]));
  inputs.push({
    title: 'Tab 1: Phases', kind: 'grid', align: 'data',
    columns: ['Phase', 'Status', 'Start', 'Constr. yrs', 'Ops yrs'],
    rows: state.phases.map((ph) => {
      const sy = ph.startDate ? new Date(ph.startDate).getUTCFullYear() : snap.projectStartYear;
      return row([ph.name, String(ph.status ?? 'planning'), String(sy), fmt.int(ph.constructionPeriods ?? 0), fmt.int(ph.operationsPeriods ?? 0)]);
    }),
  });
  // Historical baseline per operational phase.
  const opPhases = state.phases.filter((ph) => ph.status === 'operational' && ph.historicalBaseline);
  if (opPhases.length) {
    inputs.push({
      title: 'Tab 1: Historical Baseline (operational phases)', kind: 'grid', align: 'data',
      columns: ['Phase', 'Capex', 'Equity', 'Debt drawn', 'Debt o/s', 'NBV', 'Opening cash'],
      rows: opPhases.map((ph) => {
        const b = ph.historicalBaseline!;
        return row([ph.name, fmt.money(b.historicalCapexTotal), fmt.money(b.historicalEquityContributed), fmt.money(b.historicalDebtDrawn), fmt.money(b.currentDebtOutstanding), fmt.money(b.netBookValueFixedAssets), fmt.money(b.historicalOpeningCash ?? 0)]);
      }),
    });
  }
  // Tab 2: assets + sub-units per phase.
  for (const ph of state.phases) {
    const assets = state.assets.filter((a) => a.phaseId === ph.id && a.visible !== false);
    if (!assets.length) continue;
    inputs.push({
      title: `Tab 2: Assets & Sub-units, ${ph.name}`, kind: 'grid', align: 'data',
      columns: ['Asset', 'Strategy', 'Type', 'BUA (sqm)', 'Land (sqm)'],
      rows: assets.map((a) => {
        const su = state.subUnits.filter((u) => u.assetId === a.id);
        const bua = su.length ? su.reduce((s, u) => s + computeSubUnitArea(u), 0) : (a.buaSqm ?? 0);
        const land = a.landAllocation?.sqm ?? a.landAreaSqm ?? 0;
        return row([a.name, a.strategy, a.type || '-', fmt.area(bua), fmt.area(land)]);
      }),
    });
    for (const a of assets) {
      const su = state.subUnits.filter((u) => u.assetId === a.id);
      if (!su.length) continue;
      inputs.push({
        title: `Tab 2: Sub-units, ${a.name}`, kind: 'grid', align: 'data',
        columns: ['Sub-unit', 'Category', 'Metric', 'Qty', 'Unit price / ADR'],
        rows: su.map((u) => row([u.name, u.category, u.metric, u.metric === 'area' ? fmt.area(u.metricValue) : fmt.int(u.metricValue), fmt.int(u.startingAdr ?? u.unitPrice ?? 0)])),
      });
    }
  }
  // Tab 3: cost lines per phase.
  for (const ph of state.phases) {
    const lines = state.costLines.filter((c) => c.phaseId === ph.id && c.targetAssetId === undefined && !c.disabled);
    if (!lines.length) continue;
    inputs.push({
      title: `Tab 3: Costs, ${ph.name}`, kind: 'grid', align: 'data',
      columns: ['Cost line', 'Stage', 'Scope', 'Method', 'Value'],
      rows: lines.map((c) => row([c.name, String(c.stage ?? '-'), String(c.scope ?? '-'), String(c.method ?? '-'), c.method === 'fixed' ? fmt.money(c.value) : fmt.int(c.value)])),
    });
  }
  // Tab 4: financing settings + parcels + tranches.
  inputs.push(kvTable('Tab 4: Project Financing Settings', [
    ['Funding method', String(p.financing?.fundingMethod ?? '-')],
    ['Debt share', fmt.pctRaw(fin.funding.debtPct, 0)],
    ['Equity share', fmt.pctRaw(fin.funding.equityPct, 0)],
    ['Minimum cash reserve', fmt.money(p.financing?.minimumCashReserve ?? fin.funding.minCashReserve ?? 0)],
  ]));
  if (state.parcels.length) {
    inputs.push({
      title: 'Tab 4: Land Funding per Parcel', kind: 'grid', align: 'data',
      columns: ['Parcel', 'Area (sqm)', 'Rate', 'Cash %', 'In-kind %', 'Cash value'],
      rows: state.parcels.map((pa) => row([pa.name, fmt.area(pa.area), fmt.int(pa.rate), fmt.pctRaw(pa.cashPct, 0), fmt.pctRaw(pa.inKindPct, 0), fmt.money(pa.area * pa.rate * (pa.cashPct / 100))])),
    });
  }
  if (state.financingTranches.length) {
    inputs.push({
      title: 'Tab 4: Debt Facilities', kind: 'grid', align: 'data',
      columns: ['Tranche', 'Origin', 'Opening bal.', 'Rate %', 'Repayment', 'Drawdown'],
      rows: state.financingTranches.map((t) => {
        const rate = t.interestRatePct ?? ((t.interbankRatePct ?? 0) + (t.creditSpreadPct ?? 0));
        return row([t.name, t.origin === 'existing' ? 'existing' : 'new', fmt.money(t.openingBalance ?? 0), fmt.pctRaw(rate, 2), String(t.repaymentMethod ?? '-'), String(t.drawdownMethod ?? '-')]);
      }),
    });
  }

  // ── Outputs ──
  const outputs: PdfTable[] = [];
  outputs.push(kvTable('Funding & Capital Stack', [
    ['Debt share', fmt.pctRaw(fin.funding.debtPct, 0)],
    ['Equity share', fmt.pctRaw(fin.funding.equityPct, 0)],
    ['Total new debt', fmt.money(sum(snap.directCF.debtDrawdownPerPeriod))],
    ['Total cash equity', fmt.money(sum(snap.directCF.equityDrawdownPerPeriod))],
    ['In-kind equity', fmt.money(sum(snap.directCF.equityInKindDrawdownPerPeriod))],
    ['Existing pre-capex', fmt.money(fin.existing.preCapexTotal)],
    ['Existing debt opening', fmt.money(fin.existing.debtOutstandingTotal)],
    ['Existing equity', fmt.money(fin.existing.equityTotal)],
  ]));
  outputs.push(kvTable('Funding Requirement (per method)', [
    ['Method 1 (Total Capex)', fmt.money(fin.funding.method1)],
    ['Method 2', fmt.money(fin.funding.method2)],
    ['Method 3 (Cash Deficit)', fmt.money(fin.funding.method3)],
    ['Method 4 (Specified)', fmt.money(fin.funding.method4)],
    ['Selected', fmt.money(fin.funding.selected)],
    ['Selected method', String(fin.funding.selectedMethodId)],
  ]));
  // Capex breakdown (period).
  const cap = fin.capex.perPeriod;
  outputs.push(periodTable('Capex Breakdown', yl, [
    periodRow('Land (cash)', cap.landCash, 'sum'),
    periodRow('Land (in-kind)', cap.landInKind, 'sum'),
    periodRow('Construction & soft (non-land)', cap.nonLand, 'sum'),
    periodRow('Total capex (excl. in-kind land)', cap.exclLandInKind, 'sum', 'subtotal'),
    periodRow('Total capex (incl. all land)', cap.inclAllLand, 'sum', 'total'),
  ]));
  // Debt drawdown by facility.
  if (fin.facilities.size) {
    outputs.push(periodTable('Total Debt Required by Facility', yl,
      [...fin.facilities.entries()]
        .filter(([, f]) => anyNonZero(f.drawSchedule) || anyNonZero(f.interestCapitalized))
        .map(([id, f]) => periodRow(trName(id), f.drawSchedule.slice(0, yl.length), 'sum'))
        .concat([periodRow('Total drawdown', fin.combined.totalDrawdown.slice(0, yl.length), 'sum', 'total')])));
  }
  outputs.push(kvTable('Total Equity Required', [
    ['Cash equity', fmt.money(fin.equity.totalCash)],
    ['In-kind equity', fmt.money(fin.equity.totalInKind)],
    ['Existing equity', fmt.money(fin.equity.totalExisting)],
    ['Grand total equity', fmt.money(fin.equity.grandTotal)],
  ]));

  // ── Schedules ──
  const schedules: PdfTable[] = [];
  for (const [id, f] of fin.facilities) {
    if (!anyNonZero(f.drawSchedule) && !anyNonZero(f.outstanding) && !anyNonZero(f.principalRepaid)) continue;
    schedules.push(periodTable(`Debt Movement, ${trName(id)}`, yl, [
      periodRow('Drawdown', f.drawSchedule.slice(0, yl.length), 'sum'),
      periodRow('Interest accrued', f.interestAccrued.slice(0, yl.length), 'sum'),
      periodRow('Interest capitalised (IDC)', f.interestCapitalized.slice(0, yl.length), 'sum'),
      periodRow('Interest paid', f.interestPaid.slice(0, yl.length), 'sum'),
      periodRow('Principal repaid', f.principalRepaid.slice(0, yl.length), 'sum'),
      periodRow('Sweep repaid', f.sweepRepaid.slice(0, yl.length), 'sum'),
      periodRow('Closing balance', f.outstanding.slice(0, yl.length), 'last', 'total'),
    ]));
  }
  const cds = fin.combined;
  schedules.push(periodTable('Combined Debt Service', yl, [
    periodRow('Total drawdown', cds.totalDrawdown.slice(0, yl.length), 'sum'),
    periodRow('Interest accrued', cds.totalInterestAccrued.slice(0, yl.length), 'sum'),
    periodRow('Interest capitalised', cds.totalInterestCapitalized.slice(0, yl.length), 'sum'),
    periodRow('Interest expensed (P&L)', cds.totalInterestExpensed.slice(0, yl.length), 'sum'),
    periodRow('Principal repaid', cds.totalPrincipalRepaid.slice(0, yl.length), 'sum'),
    periodRow('Debt service (cash)', cds.debtServiceCash.slice(0, yl.length), 'sum', 'subtotal'),
  ]));
  const idc = snap.idc;
  schedules.push(periodTable('IDC Summary', yl, [
    periodRow('Construction interest', idc.totalConstructionInterestPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('IDC capitalised to assets', idc.totalIdcPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('IDC depreciation', idc.idcDepreciationPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('IDC NBV (closing)', idc.idcNbvPerPeriod.slice(0, yl.length), 'last', 'total'),
  ]));
  const eq = fin.equity;
  schedules.push(periodTable('Equity Movement', yl, [
    periodRow('Cash equity', eq.cashPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('In-kind equity', eq.inKindPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Existing equity', eq.existingEquityPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Total equity', eq.totalPerPeriod.slice(0, yl.length), 'sum', 'total'),
  ]));
  const dcf = snap.directCF;
  schedules.push(periodTable('Cash Waterfall (consolidated)', yl, [
    periodRow('Opening cash', dcf.openingCashPerPeriod.slice(0, yl.length), 'none'),
    periodRow('Cash from operations', dcf.cashFromOperationsPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Cash from investing', dcf.cashFromInvestmentPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Equity drawdown', dcf.equityDrawdownPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Debt drawdown', dcf.debtDrawdownPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Interest paid', dcf.interestPaidPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Debt repaid', dcf.debtRepaymentPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Dividends paid', dcf.dividendsPaidPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Closing cash', dcf.closingCashPerPeriod.slice(0, yl.length), 'last', 'total'),
  ]));

  return { inputs, outputs, schedules };
}

// ── Module 2: Revenue ────────────────────────────────────────────────────────
function buildModule2(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: Fmt): ModuleContent {
  const yl = snap.yearLabels;
  const rev = snap.revenue;
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;

  // ── Inputs ──
  const inputs: PdfTable[] = [];
  inputs.push({
    title: 'Tab 1: Revenue Configuration by Asset', kind: 'grid', align: 'data',
    columns: ['Asset', 'Strategy', 'Key driver', 'Indexation'],
    rows: state.assets.filter((a) => a.visible !== false).map((a) => {
      const r = a.revenue ?? {};
      if (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') {
        const s = r.sell;
        const recog = s?.recognitionProfile?.method === 'point_in_time' ? `PIT (${s?.recognitionProfile?.pointInTimeYear ?? 'handover'})` : 'Over time';
        return row([a.name, a.strategy, `Recognition: ${recog}`, indexLabel(s?.indexation)]);
      }
      if (a.strategy === 'Operate') {
        const o = r.operate;
        return row([a.name, a.strategy, `Starting ADR ${fmt.int(o?.startingADR ?? 0)}`, indexLabel(o?.adrIndexation)]);
      }
      const l = r.lease;
      return row([a.name, 'Lease', `Base rate ${fmt.int(l?.baseRate ?? 0)}`, indexLabel(l?.rentIndexation)]);
    }),
  });
  // Cash + recognition profiles for Sell assets.
  for (const a of state.assets) {
    const s = a.revenue?.sell;
    if (!s) continue;
    const cashPct = s.cashPaymentProfile?.percentages ?? [];
    const recogPct = s.recognitionProfile?.percentages ?? [];
    if (!cashPct.length && !recogPct.length) continue;
    const n = Math.max(cashPct.length, recogPct.length);
    const posCols = Array.from({ length: n }, (_, i) => `P${i + 1}`);
    inputs.push({
      title: `Tab 1: Cash & Recognition Profile, ${a.name}`, kind: 'grid', align: 'data',
      columns: ['Profile', ...posCols],
      rows: [
        row(['Cash payment %', ...Array.from({ length: n }, (_, i) => fmt.pctRaw((cashPct[i] ?? 0) * 100, 1))]),
        ...(recogPct.length ? [row(['Recognition %', ...Array.from({ length: n }, (_, i) => fmt.pctRaw((recogPct[i] ?? 0) * 100, 1))])] : []),
      ],
    });
  }

  // ── Outputs ──
  const outputs: PdfTable[] = [];
  const pl = snap.pl;
  outputs.push(periodTable('Project Revenue Summary', yl, [
    periodRow('Residential revenue', pl.residentialRevenuePerPeriod, 'sum'),
    periodRow('Hospitality revenue', pl.hospitalityRevenuePerPeriod, 'sum'),
    periodRow('Retail revenue', pl.retailRevenuePerPeriod, 'sum'),
    periodRow('Total revenue', pl.totalRevenuePerPeriod, 'sum', 'total'),
  ]));
  // Per Sell asset.
  for (const [id, r] of rev.bySellAsset) {
    if (!anyNonZero(r.presalesRevenuePerPeriod) && !anyNonZero(r.postSalesRevenuePerPeriod)) continue;
    outputs.push(periodTable(`Residential (Sell), ${assetName(id)}`, yl, [
      periodRow('Pre-sales revenue', r.presalesRevenuePerPeriod, 'sum'),
      periodRow('Post-sales revenue', r.postSalesRevenuePerPeriod, 'sum'),
      periodRow('Cash collected', r.cashCollectedPerPeriod, 'sum', 'subtotal'),
      periodRow('Revenue recognised', r.recognitionPerPeriod, 'sum', 'subtotal'),
    ]));
    // Vintage matrices (cohort year × year).
    const cashRows = r.cashVintageMatrix.map((m, i) => periodRow(`FY ${yl[i] ?? i}`, m, 'sum')).filter((rr) => (rr.cells[1] as number) !== 0);
    if (cashRows.length) outputs.push(periodTable(`Cash Vintage Matrix, ${assetName(id)}`, yl, cashRows));
    const recRows = r.recognitionVintageMatrix.map((m, i) => periodRow(`FY ${yl[i] ?? i}`, m, 'sum')).filter((rr) => (rr.cells[1] as number) !== 0);
    if (recRows.length) outputs.push(periodTable(`Recognition Vintage Matrix, ${assetName(id)}`, yl, recRows));
  }
  // Per Hospitality asset.
  for (const [id, r] of rev.byHospitalityAsset) {
    if (!anyNonZero(r.totalRevenuePerPeriod)) continue;
    outputs.push(periodTable(`Hospitality, ${assetName(id)}`, yl, [
      strPeriodRow('Available room nights', r.availableRoomNightsPerPeriod.map((v) => fmt.int(v))),
      strPeriodRow('Occupied room nights', r.occupiedRoomNightsPerPeriod.map((v) => fmt.int(v))),
      strPeriodRow('Occupancy %', r.occupancyPerPeriod.map((v) => fmt.pct(v, 1))),
      strPeriodRow('ADR', r.adrPerPeriod.map((v) => fmt.int(v))),
      periodRow('Rooms revenue', r.roomsRevenuePerPeriod, 'sum'),
      periodRow('F&B revenue', r.fbRevenuePerPeriod, 'sum'),
      periodRow('Other revenue', r.otherRevenuePerPeriod, 'sum'),
      periodRow('Total revenue', r.totalRevenuePerPeriod, 'sum', 'total'),
    ]));
  }
  // Per Lease asset.
  for (const [id, r] of rev.byLeaseAsset) {
    if (!anyNonZero(r.totalRevenuePerPeriod)) continue;
    outputs.push(periodTable(`Lease, ${assetName(id)}`, yl, [
      strPeriodRow('Occupied area (sqm)', r.occupiedAreaPerPeriod.map((v) => fmt.area(v))),
      strPeriodRow('Occupancy %', r.occupancyPerPeriod.map((v) => fmt.pct(v, 1))),
      strPeriodRow('Indexed rate', r.indexedRatePerPeriod.map((v) => fmt.int(v))),
      periodRow('Total revenue', r.totalRevenuePerPeriod, 'sum', 'total'),
    ]));
  }
  // Cost of Sales (Tab 3).
  outputs.push(periodTable('Cost of Sales (project total)', yl, [
    periodRow('Cost of sales', pl.cosPerPeriod, 'sum', 'subtotal'),
  ]));
  for (const [id, b] of snap.byAssetSchedules) {
    if (!anyNonZero(b.cos.perPeriod)) continue;
    outputs.push(periodTable(`Cost of Sales, ${assetName(id)}`, yl, [
      periodRow('Cost of sales', b.cos.perPeriod.slice(0, yl.length), 'sum'),
      periodRow('Gross margin', b.cos.grossMarginPerPeriod.slice(0, yl.length), 'sum', 'subtotal'),
      periodRow('Cumulative CoS', b.cos.cumulativePerPeriod.slice(0, yl.length), 'last'),
    ]));
  }

  // ── Schedules (AR / Unearned / Escrow) ──
  const schedules: PdfTable[] = [];
  for (const [id, b] of snap.byAssetSchedules) {
    if (!anyNonZero(b.ar.perPeriod) && !anyNonZero(b.unearned.perPeriod)) continue;
    schedules.push(periodTable(`Accounts Receivable & Unearned, ${assetName(id)}`, yl, [
      periodRow('AR opening', b.ar.openingPerPeriod.slice(0, yl.length), 'none'),
      periodRow('AR change', b.ar.changePerPeriod.slice(0, yl.length), 'sum'),
      periodRow('AR closing', b.ar.perPeriod.slice(0, yl.length), 'last', 'subtotal'),
      periodRow('Unearned opening', b.unearned.openingPerPeriod.slice(0, yl.length), 'none'),
      periodRow('Unearned change', b.unearned.changePerPeriod.slice(0, yl.length), 'sum'),
      periodRow('Unearned closing', b.unearned.perPeriod.slice(0, yl.length), 'last', 'subtotal'),
    ]));
  }
  const esc = snap.escrow.projectTotals;
  if (anyNonZero(esc.heldPerPeriod) || anyNonZero(esc.releasePerPeriod)) {
    schedules.push(periodTable('Escrow Movement (project total)', yl, [
      periodRow('Pre-sales cash', esc.preSalesCashPerPeriod.slice(0, yl.length), 'sum'),
      periodRow('Held', esc.heldPerPeriod.slice(0, yl.length), 'sum'),
      periodRow('Released', esc.releasePerPeriod.slice(0, yl.length), 'sum'),
      periodRow('Net movement', esc.netMovementPerPeriod.slice(0, yl.length), 'sum'),
      periodRow('Cumulative balance', esc.cumulativeBalancePerPeriod.slice(0, yl.length), 'last', 'total'),
    ]));
  }

  return { inputs, outputs, schedules };
}

// ── Module 3: Operating Expenses ─────────────────────────────────────────────
function buildModule3(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: Fmt): ModuleContent {
  const yl = snap.yearLabels;
  const opex = snap.opex;
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;

  // ── Inputs ──
  const inputs: PdfTable[] = [];
  for (const a of state.assets) {
    const lines = a.opex?.lines ?? [];
    if (!lines.length) continue;
    inputs.push({
      title: `Tab 1: Opex Inputs, ${a.name}`, kind: 'grid', align: 'data',
      columns: ['Line', 'Category', 'Mode', 'Value', 'Indexation', 'Rate mode'],
      rows: lines.filter((l) => !l.disabled).map((l) => row([
        l.name, String(l.category), String(l.mode),
        l.mode === 'fixed_baseline' || l.mode.startsWith('per_') ? fmt.money(l.value) : fmt.pctRaw(l.value, 2),
        l.useAssetDefault ? `(default) ${indexLabel(a.opex?.defaultIndexation)}` : indexLabel(l.indexation),
        l.rateMode === 'yoy' ? 'YoY' : 'Single',
      ])),
    });
  }
  const hqLines = state.project.hqOpex?.lines ?? [];
  if (hqLines.length) {
    inputs.push({
      title: 'Tab 1: HQ / Corporate Opex Inputs', kind: 'grid', align: 'data',
      columns: ['Line', 'Category', 'Mode', 'Value', 'Indexation'],
      rows: hqLines.filter((l) => !l.disabled).map((l) => row([l.name, String(l.category), String(l.mode), fmt.money(l.value), indexLabel(l.indexation)])),
    });
  }

  // ── Outputs ──
  const outputs: PdfTable[] = [];
  for (const [id, r] of opex.byAsset) {
    if (!anyNonZero(r.totalOpexPerPeriod)) continue;
    const a = state.assets.find((x) => x.id === id);
    const lineRows: PdfTableRow[] = (r.perLinePerPeriod ?? []).map((arr, i) =>
      periodRow(a?.opex?.lines?.[i]?.name ?? `Line ${i + 1}`, arr.slice(0, yl.length), 'sum'),
    ).filter((rr) => (rr.cells[1] as number) !== 0);
    outputs.push(periodTable(`Opex, ${assetName(id)}`, yl, [
      ...lineRows,
      periodRow('Direct costs', r.directCostsPerPeriod.slice(0, yl.length), 'sum', 'subtotal'),
      periodRow('Indirect costs', r.indirectCostsPerPeriod.slice(0, yl.length), 'sum', 'subtotal'),
      periodRow('Management fees', r.managementFeePerPeriod.slice(0, yl.length), 'sum', 'subtotal'),
      periodRow('Other charges', r.otherOpexPerPeriod.slice(0, yl.length), 'sum', 'subtotal'),
      periodRow('Total opex', r.totalOpexPerPeriod.slice(0, yl.length), 'sum', 'total'),
      periodRow('GOP', r.gopPerPeriod.slice(0, yl.length), 'sum'),
      periodRow('NOI', r.noiPerPeriod.slice(0, yl.length), 'sum'),
    ]));
  }
  const pt = opex.projectTotals;
  outputs.push(periodTable('Project Total Opex', yl, [
    periodRow('Direct costs', pt.directCostsPerPeriod, 'sum'),
    periodRow('Indirect costs', pt.indirectCostsPerPeriod, 'sum'),
    periodRow('Management fees', pt.managementFeePerPeriod, 'sum'),
    periodRow('Other charges', pt.otherOpexPerPeriod, 'sum'),
    periodRow('Asset opex total', pt.totalOpexPerPeriod, 'sum', 'subtotal'),
    periodRow('HQ / corporate opex', opex.hq.totalOpexPerPeriod, 'sum'),
    periodRow('Total opex (incl. HQ)', opex.totalOpexPerPeriodInclHQ, 'sum', 'total'),
  ]));

  // ── Schedules (AP) ──
  const schedules: PdfTable[] = [];
  const ap = snap.ap;
  for (const [id, r] of ap.byAsset) {
    if (!anyNonZero(r.opexIncurredPerPeriod)) continue;
    schedules.push(periodTable(`Accounts Payable, ${assetName(id)} (DPO ${r.effectiveApDays})`, yl, [
      periodRow('Opex incurred', r.opexIncurredPerPeriod.slice(0, yl.length), 'sum'),
      periodRow('Opening AP', r.result.openingPerPeriod.slice(0, yl.length), 'none'),
      periodRow('Closing AP', r.result.perPeriod.slice(0, yl.length), 'last', 'subtotal'),
      periodRow('Cash paid', r.result.cashPaidPerPeriod.slice(0, yl.length), 'sum'),
    ]));
  }
  const apt = ap.projectTotals;
  schedules.push(periodTable('Accounts Payable (project total)', yl, [
    periodRow('Opex incurred', apt.opexIncurredPerPeriod, 'sum'),
    periodRow('Opening AP', apt.openingApPerPeriod, 'none'),
    periodRow('Change in AP', apt.changeApPerPeriod, 'sum'),
    periodRow('Closing AP', apt.closingApPerPeriod, 'last', 'subtotal'),
    periodRow('Cash paid', apt.cashPaidPerPeriod, 'sum', 'total'),
  ]));

  return { inputs, outputs, schedules };
}

// ── Module 4: Financial Statements ───────────────────────────────────────────
function buildModule4(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: Fmt): ModuleContent {
  const yl = snap.yearLabels;
  const { pl, directCF: cf, indirectCF: icf, bs, fixedAssets: fa } = snap;
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;

  // ── Schedules (Tab 1: Fixed Assets + IDC) ──
  const schedules: PdfTable[] = [];
  for (const [id, r] of fa.byAsset) {
    const dep = r.depreciable;
    if (!anyNonZero(dep.closingNBVPerPeriod) && !anyNonZero(r.land.closingPerPeriod)) continue;
    schedules.push(periodTable(`Fixed Assets, ${assetName(id)}`, yl, [
      periodRow('Land opening', r.land.openingPerPeriod.slice(0, yl.length), 'none'),
      periodRow('Land additions', r.land.additionsPerPeriod.slice(0, yl.length), 'sum'),
      periodRow('Land closing', r.land.closingPerPeriod.slice(0, yl.length), 'last', 'subtotal'),
      periodRow('Depreciable opening NBV', dep.openingNBVPerPeriod.slice(0, yl.length), 'none'),
      periodRow('Additions', dep.additionsPerPeriod.slice(0, yl.length), 'sum'),
      periodRow('Depreciation', dep.depreciationPerPeriod.slice(0, yl.length), 'sum'),
      periodRow('Depreciable closing NBV', dep.closingNBVPerPeriod.slice(0, yl.length), 'last', 'subtotal'),
      periodRow('Combined closing (Land + NBV)', r.combinedClosingPerPeriod.slice(0, yl.length), 'last', 'total'),
    ]));
  }
  const fpt = fa.projectTotals;
  schedules.push(periodTable('Fixed Assets (project total)', yl, [
    periodRow('Land closing', fpt.land.closingPerPeriod, 'last'),
    periodRow('Depreciation', fpt.depreciable.depreciationPerPeriod, 'sum'),
    periodRow('Depreciable closing NBV', fpt.depreciable.closingNBVPerPeriod, 'last', 'subtotal'),
    periodRow('Combined closing', fpt.combinedClosingPerPeriod, 'last', 'total'),
  ]));
  const idc = snap.idc;
  schedules.push(periodTable('IDC Pool', yl, [
    periodRow('Construction interest', idc.totalConstructionInterestPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('Capitalised to assets', idc.totalIdcPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('IDC depreciation', idc.idcDepreciationPerPeriod.slice(0, yl.length), 'sum'),
    periodRow('IDC NBV closing', idc.idcNbvPerPeriod.slice(0, yl.length), 'last', 'total'),
  ]));

  // ── Outputs (P&L / CF / BS) ──
  const outputs: PdfTable[] = [];
  outputs.push(periodTable('Profit & Loss', yl, [
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
  ]));
  outputs.push(periodTable('Cash Flow, Direct', yl, [
    periodRow('Revenue received', cf.revenueReceivedPerPeriod, 'sum'),
    periodRow('Escrow held', cf.escrowHeldPerPeriod, 'sum'),
    periodRow('Escrow released', cf.escrowReleasePerPeriod, 'sum'),
    periodRow('Opex paid', cf.opexPaidPerPeriod, 'sum'),
    periodRow('HQ opex paid', cf.hqOpexPaidPerPeriod, 'sum'),
    periodRow('Tax paid', cf.taxPaidPerPeriod, 'sum'),
    periodRow('Cash from operations', cf.cashFromOperationsPerPeriod, 'sum', 'subtotal'),
    periodRow('Capex', cf.capexPerPeriod, 'sum'),
    periodRow('Cash from investing', cf.cashFromInvestmentPerPeriod, 'sum', 'subtotal'),
    periodRow('Equity drawdown', cf.equityDrawdownPerPeriod, 'sum'),
    periodRow('Debt drawdown', cf.debtDrawdownPerPeriod, 'sum'),
    periodRow('Debt repayment', cf.debtRepaymentPerPeriod, 'sum'),
    periodRow('Interest paid', cf.interestPaidPerPeriod, 'sum'),
    periodRow('Dividends paid', cf.dividendsPaidPerPeriod, 'sum'),
    periodRow('Cash from financing', cf.cashFromFinancingPerPeriod, 'sum', 'subtotal'),
    periodRow('Net cash flow', cf.netCashFlowPerPeriod, 'sum'),
    periodRow('Closing cash', cf.closingCashPerPeriod, 'last', 'total'),
  ]));
  outputs.push(periodTable('Cash Flow, Indirect', yl, [
    periodRow('Profit after tax', icf.patPerPeriod, 'sum'),
    periodRow('Depreciation & amortization', icf.daPerPeriod, 'sum'),
    periodRow('Interest expense add-back', icf.interestExpensePerPeriod, 'sum'),
    periodRow('Cost of sales add-back', icf.costOfSalesAddBackPerPeriod, 'sum'),
    periodRow('Change in AR', icf.changeInArPerPeriod, 'sum'),
    periodRow('Change in AP', icf.changeInApPerPeriod, 'sum'),
    periodRow('Change in unearned', icf.changeInUnearnedPerPeriod, 'sum'),
    periodRow('Change in escrow', icf.changeInEscrowPerPeriod, 'sum'),
    periodRow('Cash from operations', icf.cashFromOperationsPerPeriod, 'sum', 'subtotal'),
    periodRow('Cash from investing', icf.cashFromInvestmentPerPeriod, 'sum', 'subtotal'),
    periodRow('Cash from financing', icf.cashFromFinancingPerPeriod, 'sum', 'subtotal'),
    periodRow('Net cash flow', icf.netCashFlowPerPeriod, 'sum'),
    periodRow('Closing cash', icf.closingCashPerPeriod, 'last', 'total'),
  ]));
  outputs.push(periodTable('Balance Sheet', yl, [
    periodRow('Cash', bs.cashPerPeriod, 'last'),
    periodRow('Receivables (operating)', bs.arPerPeriod, 'last'),
    periodRow('Residential receivables', bs.residentialReceivablesPerPeriod, 'last'),
    periodRow('Inventory (WIP)', bs.inventoryPerPeriod, 'last'),
    periodRow('Restricted cash (escrow)', bs.escrowRestrictedCashPerPeriod, 'last'),
    periodRow('Net fixed assets', bs.nbvPerPeriod, 'last'),
    periodRow('Land', bs.landPerPeriod, 'last'),
    periodRow('Total assets', bs.totalAssetsPerPeriod, 'last', 'subtotal'),
    periodRow('Accounts payable', bs.apPerPeriod, 'last'),
    periodRow('Unearned revenue', bs.unearnedRevenuePerPeriod, 'last'),
    periodRow('Debt outstanding', bs.debtOutstandingPerPeriod, 'last'),
    periodRow('Total liabilities', bs.totalLiabilitiesPerPeriod, 'last', 'subtotal'),
    periodRow('Share capital', bs.shareCapitalPerPeriod, 'last'),
    periodRow('Statutory reserve', bs.statutoryReservePerPeriod, 'last'),
    periodRow('Retained earnings', bs.retainedEarningsPerPeriod, 'last'),
    periodRow('Total equity', bs.totalEquityPerPeriod, 'last', 'subtotal'),
    periodRow('Liabilities + equity', bs.totalLiabilitiesAndEquityPerPeriod, 'last', 'total'),
    periodRow('BS check (Δ = Assets − L&E)', bs.bsDifferencePerPeriod, 'last'),
  ]));

  return { inputs: [], outputs, schedules };
}

// ── Module 5: Returns & Valuation ────────────────────────────────────────────
function buildModule5(returns: ReturnsSnapshot, state: FinancialsResolverState, fmt: Fmt): ModuleContent {
  const r = returns.result;
  const re = r.realEstate;
  const cfg = returns.config;
  const syl = returns.streamYearLabels;
  const yl = returns.yearLabels;

  // ── Inputs (assumptions) ──
  const inputs: PdfTable[] = [];
  inputs.push(kvTable('Returns Assumptions', [
    ['Discount rate', fmt.pct(cfg.discountRate, 2)],
    ['Exit year', String(returns.exitYearLabel)],
    ['Terminal value method', String(cfg.terminalMethod)],
    ['Exit multiple', `${(cfg.exitMultiple ?? 0).toFixed(2)}x`],
    ['Perpetuity growth', fmt.pct(cfg.perpetuityGrowth, 2)],
  ]));

  // ── Outputs ──
  const outputs: PdfTable[] = [];
  outputs.push(kvTable('Headline Returns', [
    ['Project IRR (FCFF)', fmt.pct(r.fcff.irr, 1)],
    ['Equity IRR (FCFE)', fmt.pct(r.fcfe.irr, 1)],
    ['Distributed Equity IRR', fmt.pct(r.dividends.irr, 1)],
    ['Equity multiple (FCFE)', fmt.mult(r.fcfe.moic)],
    ['FCFE NPV', fmt.money(r.fcfe.npv)],
    ['FCFE payback (yrs)', r.fcfe.paybackPeriod === null ? 'n/a' : r.fcfe.paybackPeriod.toFixed(1)],
    ['Terminal equity value', fmt.money(returns.terminalEquityValue)],
  ]));
  const de = returns.developmentEconomics;
  outputs.push(kvTable('Development Economics', [
    ['Gross development value (GDV)', fmt.money(de.gdv)],
    ['Total development cost', fmt.money(de.totalDevelopmentCost)],
    ['Total financing cost', fmt.money(de.totalFinancingCost)],
    ['Profit before financing', fmt.money(de.profitBeforeFinancing)],
    ['Profit after financing', fmt.money(de.profitAfterFinancing)],
    ['Development margin', fmt.pct(de.developmentMargin, 1)],
    ['Cost to value', fmt.pct(de.costToValue, 1)],
  ]));
  const ex = returns.exitAnalysis;
  outputs.push(kvTable('Exit Analysis', [
    ['Exit year', String(ex.exitYearLabel)],
    ['Exit NOI', fmt.money(ex.exitNOI)],
    ['Exit EBITDA', fmt.money(ex.exitEBITDA)],
    ['Exit enterprise value', fmt.money(ex.exitEnterpriseValue)],
    ['Exit equity value', fmt.money(ex.exitEquityValue)],
    ['Exit debt', fmt.money(ex.exitDebt)],
    ['LTV at exit', fmt.pct(ex.ltvAtExit, 1)],
    ['Debt yield', fmt.pct(ex.debtYield, 1)],
    ['Cap rate', fmt.pct(ex.capRate, 2)],
  ]));
  const su = returns.sourcesUses;
  outputs.push({
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
  });
  const ee = returns.equityExposure;
  outputs.push(kvTable('Equity Exposure', [
    ['Total equity required', fmt.money(ee.totalEquityRequired)],
    ['Average equity invested', fmt.money(ee.averageEquityInvested)],
    ['Peak equity at risk', fmt.money(ee.equityAtRisk)],
    ['Max negative cumulative CF', fmt.money(ee.maxNegativeCumulativeCF)],
    ['First positive CF year', ee.firstPositiveCFYear === null ? 'n/a' : String(ee.firstPositiveCFYear)],
    ['First dividend year', ee.firstDividendYear === null ? 'n/a' : String(ee.firstDividendYear)],
  ]));
  const sb = returns.stabilization;
  outputs.push(kvTable('Stabilization Metrics', [
    ['Stabilised NOI', fmt.money(sb.stabilisedNOI)],
    ['Stabilised yield on cost', fmt.pct(sb.stabilisedYieldOnCost, 2)],
    ['Stabilization year', sb.stabilizationYear === null ? 'n/a' : String(sb.stabilizationYear)],
    ['Has income assets', sb.hasIncomeAssets ? 'Yes' : 'No'],
  ]));
  const da = returns.debtAnalytics;
  outputs.push(kvTable('Debt Analytics', [
    ['Peak debt', fmt.money(da.peakDebt)],
    ['Average debt outstanding', fmt.money(da.averageDebtOutstanding)],
    ['Remaining debt at exit', fmt.money(da.remainingDebtAtExit)],
    ['Paydown %', fmt.pct(da.paydownPct, 1)],
    ['Tenor (yrs)', da.tenorYears === null ? 'n/a' : da.tenorYears.toFixed(1)],
  ]));
  outputs.push(kvTable('Real Estate Metrics', [
    ['Yield on cost', fmt.pct(re.yieldOnCost, 2)],
    ['Cap rate at exit', fmt.pct(re.capRateAtExit, 2)],
    ['Development spread', fmt.pct(re.developmentSpread, 2)],
    ['Profit on cost', fmt.pct(re.profitOnCost, 1)],
    ['Profit margin', fmt.pct(re.profitMargin, 1)],
    ['Cash-on-cash (avg)', fmt.pct(re.cashOnCashAvg, 1)],
    ['LTV at exit', fmt.pct(re.ltvAtExit, 1)],
    ['Equity multiple', fmt.mult(re.equityMultiple)],
    ['Debt yield', fmt.pct(re.debtYield, 1)],
    ['DSCR (min / avg)', `${re.dscrMin === null ? 'n/a' : re.dscrMin.toFixed(2)} / ${re.dscrAvg === null ? 'n/a' : re.dscrAvg.toFixed(2)}`],
    ['ICR (min)', re.icrMin === null ? 'n/a' : re.icrMin.toFixed(2)],
  ]));
  // Coverage by year (DSCR / ICR / Cash-on-cash).
  if (anyNonZero(re.dscrPerPeriod) || anyNonZero(re.icrPerPeriod)) {
    outputs.push(periodTable('Coverage Ratios by Year', yl, [
      strPeriodRow('DSCR', re.dscrPerPeriod.map((v) => (v ? v.toFixed(2) : '-'))),
      strPeriodRow('ICR', re.icrPerPeriod.map((v) => (v ? v.toFixed(2) : '-'))),
      strPeriodRow('Cash-on-cash %', re.cashOnCashPerPeriod.map((v) => (v ? fmt.pct(v, 1) : '-'))),
    ]));
  }

  // ── Schedules (cash-flow streams + build-ups) ──
  const schedules: PdfTable[] = [];
  schedules.push(periodTable('Sponsor Cash-Flow Streams', syl, [
    periodRow('FCFF (unlevered)', returns.fcffPerPeriod, 'sum'),
    periodRow('FCFE (levered)', returns.fcfePerPeriod, 'sum'),
    periodRow('Distributed equity', returns.dividendStreamPerPeriod, 'sum'),
  ]));
  const bu = returns.buildup;
  schedules.push(periodTable('FCFF Build-up', syl, [
    periodRow('(−) Existing pre-capex', bu.existingPreCapexPerPeriod, 'sum'),
    periodRow('(+) Cash from operations', bu.cfoPerPeriod, 'sum'),
    periodRow('(+) Cash from investing', bu.cfiPerPeriod, 'sum'),
    periodRow('(+) Terminal enterprise value', bu.terminalEnterprisePerPeriod, 'sum'),
    periodRow('= FCFF', returns.fcffPerPeriod, 'sum', 'total'),
  ]));
  schedules.push(periodTable('FCFE Build-up', syl, [
    periodRow('FCFF', returns.fcffPerPeriod, 'sum'),
    periodRow('(+) Existing debt opening', bu.existingDebtOpeningPerPeriod, 'sum'),
    periodRow('(+) Debt drawdown', bu.debtDrawPerPeriod, 'sum'),
    periodRow('(−) Principal repaid', bu.principalRepayPerPeriod, 'sum'),
    periodRow('(−) Interest paid', bu.interestPaidPerPeriod, 'sum'),
    periodRow('(−) In-kind land', bu.inKindLandPerPeriod, 'sum'),
    periodRow('(+) Terminal equity value', bu.terminalEquityPerPeriod, 'sum'),
    periodRow('= FCFE', returns.fcfePerPeriod, 'sum', 'total'),
  ]));
  schedules.push(periodTable('Distributed Equity Build-up', syl, [
    periodRow('(−) Cash equity contributed', bu.equityCashPerPeriod, 'sum'),
    periodRow('(−) In-kind equity contributed', bu.equityInKindPerPeriod, 'sum'),
    periodRow('(+) Dividends distributed', bu.dividendsDistributedPerPeriod, 'sum'),
    periodRow('= Distributed equity', returns.dividendStreamPerPeriod, 'sum', 'total'),
  ]));

  return { inputs, outputs, schedules };
}

// ── Section assembly ─────────────────────────────────────────────────────────
interface BuiltSection {
  title: string;
  content: ModuleContent;
  sel: ModuleSectionSelection;
}

function buildSections(
  snap: ProjectFinancialsSnapshot,
  returns: ReturnsSnapshot | null,
  state: FinancialsResolverState,
  fmt: Fmt,
  selected: Set<string>,
  moduleSections: Record<string, ModuleSectionSelection>,
): BuiltSection[] {
  const out: BuiltSection[] = [];
  for (const m of MODULES) {
    if (!selected.has(m.key)) continue;
    let content: ModuleContent | null = null;
    if (m.key === 'module1') content = buildModule1(snap, state, fmt);
    else if (m.key === 'module2') content = buildModule2(snap, state, fmt);
    else if (m.key === 'module3') content = buildModule3(snap, state, fmt);
    else if (m.key === 'module4') content = buildModule4(snap, state, fmt);
    else if (m.key === 'module5') content = returns ? buildModule5(returns, state, fmt) : null;
    else continue; // modules 6+ have no exporter yet (registry-driven, auto-skip)
    if (!content) continue;
    const sel = moduleSections[m.key] ?? {};
    out.push({ title: `Module ${m.num}, ${m.longLabel}`, content, sel });
  }
  return out;
}

function includePart(flag: boolean | undefined): boolean {
  return flag !== false; // missing => included
}

// ── Public entry ─────────────────────────────────────────────────────────────
export async function generateProjectPdf(opts: GenerateProjectPdfOptions): Promise<Uint8Array> {
  const snap = computeFinancialsSnapshot(opts.state);
  let returns: ReturnsSnapshot | null = null;
  try { returns = computeReturnsSnapshot(snap, opts.state.project); } catch { returns = null; }

  const doc = await PDFDocument.create();
  // Embed Inter (the platform UI font) so the PDF matches the app visually and
  // supports full Unicode. fontkit is required by pdf-lib for any non-standard
  // (custom) font.
  //
  // subset: FALSE on purpose. pdf-lib's fontkit glyph-subsetting emits a subset
  // font program (e.g. "Inter-Bold-3398") that strict readers (Adobe Acrobat,
  // some print pipelines) reject with "cannot extract the embedded font ...,
  // some characters may not display or print correctly", crashing every page
  // that references it. Embedding the FULL, unmodified TTF is the reliable path
  // (the same fonts embed cleanly elsewhere); the file is larger but valid in
  // every viewer.
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(b64ToBytes(INTER_REGULAR_B64), { subset: false });
  const bold = await doc.embedFont(b64ToBytes(INTER_BOLD_B64), { subset: false });
  const ctx: Ctx = {
    doc, font, bold, pages: [], page: null as unknown as PDFPage, y: 0,
    pageW: PAGE_W_P, pageH: PAGE_H_P, landscape: false,
    projectName: opts.projectName || 'Untitled Project',
    versionLabel: opts.versionLabel ?? '',
  };
  const fmt = makeFmt(opts.state);
  const p = opts.state.project;

  // Cover KPIs.
  const kpis: Array<[string, string]> = [];
  if (returns) {
    const r = returns.result;
    kpis.push(['Project IRR', fmt.pct(r.fcff.irr, 1)]);
    kpis.push(['Equity IRR', fmt.pct(r.fcfe.irr, 1)]);
    kpis.push(['Equity Multiple', fmt.mult(r.fcfe.moic)]);
    kpis.push(['Total Dev Cost', fmt.money(returns.developmentEconomics.totalDevelopmentCost)]);
  }
  kpis.push(['Total Revenue', fmt.money(sum(snap.pl.totalRevenuePerPeriod))]);
  kpis.push(['Peak Debt', fmt.money(Math.max(0, ...snap.bs.debtOutstandingPerPeriod))]);

  const startYear = snap.projectStartYear;
  const endYear = startYear + snap.axisLength - 1;
  const scaleLabel = p.displayScale === 'thousands' ? `${p.currency} '000` : p.displayScale === 'millions' ? `${p.currency} M` : p.currency;
  const metaLines = [
    `Location: ${[p.location, p.country].filter(Boolean).join(', ') || '-'}`,
    `Currency / scale: ${scaleLabel}`,
    `Model horizon: ${snap.axisLength} years (${startYear} to ${endYear})`,
    `Project type: ${String(p.projectType ?? '-')}`,
  ];

  drawCover(ctx, opts, kpis, metaLines);

  // Project description page (mandatory).
  newPage(ctx, { landscape: false, headerTitle: 'Project Description' });
  ctx.currentModuleHeader = 'Project Description';
  for (const t of buildDescriptionTables(snap, opts.state, fmt)) {
    if (t.kind === 'period') drawPeriodTable(ctx, t, fmt);
    else drawGridTable(ctx, t, fmt);
  }

  // Module sections.
  const sections = buildSections(snap, returns, opts.state, fmt, new Set(opts.selectedModuleKeys), opts.moduleSections ?? {});
  for (const section of sections) {
    const parts: Array<[string, PdfTable[]]> = [];
    if (includePart(section.sel.inputs) && section.content.inputs.length) parts.push(['Inputs', section.content.inputs]);
    if (includePart(section.sel.outputs) && section.content.outputs.length) parts.push(['Outputs', section.content.outputs]);
    if (includePart(section.sel.schedules) && section.content.schedules.length) parts.push(['Schedules', section.content.schedules]);
    if (!parts.length) continue;
    newPage(ctx, { landscape: true, headerTitle: section.title });
    ctx.currentModuleHeader = section.title;
    for (const [partLabel, tables] of parts) {
      drawPartHeader(ctx, partLabel);
      for (const table of tables) {
        if (table.kind === 'period') drawPeriodTable(ctx, table, fmt);
        else drawGridTable(ctx, table, fmt);
      }
    }
  }

  drawFooters(ctx);
  return doc.save();
}
