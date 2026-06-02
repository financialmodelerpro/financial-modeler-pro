/**
 * generateProjectPdf.ts
 *
 * Full-project PDF export for the REFM platform. Renders a single document
 * covering the selected modules (1..5 today, driven by the module registry),
 * styled with the platform navy headers + accounting number format. No new
 * calculations: it reads the same snapshots the UI reads
 * (computeFinancialsSnapshot + computeReturnsSnapshot) and renders them.
 *
 * Structure:
 *   - Cover page: project name, version, date, summary KPIs.
 *   - Per module: a navy header, then the module's tables in tab order.
 *   - Footer on every page: page number + project name + version.
 *
 * Wide period tables (many year columns) are split across pages: the label +
 * Total columns and the header row repeat on each column-chunk, and rows that
 * overflow the page height continue on a new page with the header repeated.
 * Pages are landscape A4 so a chunk of ~10 year columns fits per page.
 *
 * The renderer is pure (state in, bytes out) so the verifier can exercise it
 * headless. pdf-lib is the only dependency (already in package.json).
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatAccounting, type DisplayScale } from '@/src/core/formatters';
import {
  computeFinancialsSnapshot,
  type ProjectFinancialsSnapshot,
  type FinancialsResolverState,
} from '../financials-resolvers';
import { computeReturnsSnapshot, type ReturnsSnapshot } from '../returns-resolvers';
import { MODULES } from '../modules-config';

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
}

export interface PdfModuleSection {
  num: number;
  key: string;
  title: string;
  tables: PdfTable[];
}

export interface GenerateProjectPdfOptions {
  state: FinancialsResolverState;
  projectName: string;
  versionLabel?: string | null;
  /** Caller-supplied date string (the engine never reads the clock). */
  dateLabel: string;
  /** Module keys to include (e.g. ['module1','module4']). */
  selectedModuleKeys: string[];
}

// ── Colors / layout ─────────────────────────────────────────────────────────
const NAVY = rgb(0x1b / 255, 0x4f / 255, 0x8a / 255);        // --color-navy
const NAVY_DARK = rgb(0x1b / 255, 0x3a / 255, 0x6b / 255);   // --color-navy-dark
const WHITE = rgb(1, 1, 1);
const TEXT = rgb(0.12, 0.16, 0.22);
const MUTED = rgb(0.42, 0.46, 0.52);
const SUBTOTAL_FILL = rgb(0.90, 0.93, 0.97);                 // navy ~12% mix
const BORDER = rgb(0.82, 0.85, 0.89);

const PAGE_W = 841.89; // A4 landscape
const PAGE_H = 595.28;
const MARGIN = 34;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const HEADER_BAND_H = 30;
const FOOTER_H = 22;
const CONTENT_TOP = PAGE_H - MARGIN - HEADER_BAND_H - 6;
const CONTENT_BOTTOM = MARGIN + FOOTER_H;

const LABEL_COL_W = 200;
const TOTAL_COL_W = 66;
const PERIOD_COL_W = 50;
const ROW_H = 14;
const HEADER_ROW_H = 16;
const TITLE_H = 18;
const SECTION_GAP = 10;
const PERIODS_PER_PAGE = Math.max(
  1,
  Math.floor((CONTENT_W - LABEL_COL_W - TOTAL_COL_W) / PERIOD_COL_W),
);

// ── Internal render context ─────────────────────────────────────────────────
interface Ctx {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  pages: PDFPage[];
  page: PDFPage;
  y: number;
  projectName: string;
  versionLabel: string;
}

function newPage(ctx: Ctx, headerTitle?: string): void {
  const page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pages.push(page);
  ctx.page = page;
  ctx.y = CONTENT_TOP;
  if (headerTitle) drawHeaderBand(ctx, headerTitle);
}

function drawHeaderBand(ctx: Ctx, title: string): void {
  const { page, bold } = ctx;
  page.drawRectangle({ x: 0, y: PAGE_H - HEADER_BAND_H, width: PAGE_W, height: HEADER_BAND_H, color: NAVY });
  page.drawText(fitText(title, bold, 13, PAGE_W - 2 * MARGIN), {
    x: MARGIN, y: PAGE_H - HEADER_BAND_H + 9, size: 13, font: bold, color: WHITE,
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

// ── Number formatting ─────────────────────────────────────────────────────
function makeFmt(state: FinancialsResolverState): (v: string | number | null) => string {
  const scale: DisplayScale = state.project.displayScale ?? 'full';
  return (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (!Number.isFinite(v)) return '';
    return formatAccounting(v, scale, 0);
  };
}

// ── Period-table column layout for a chunk of period columns ────────────────
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
    case 'heading': return { color: TEXT, bold: true };
    default: return { color: TEXT, bold: false };
  }
}

function drawTitle(ctx: Ctx, title: string): void {
  if (ctx.y - TITLE_H < CONTENT_BOTTOM) newPage(ctx, ctx.currentModuleHeader);
  ctx.y -= TITLE_H;
  drawCell(ctx, title, MARGIN, CONTENT_W, ctx.y, { font: ctx.bold, size: 10, color: NAVY_DARK });
}

function drawGridTable(ctx: Ctx, table: PdfTable, fmt: (v: string | number | null) => string): void {
  drawTitle(ctx, table.title);
  const nCols = table.columns.length;
  // First column wide, the rest share the remainder.
  const firstW = Math.min(260, CONTENT_W * 0.4);
  const restW = (CONTENT_W - firstW) / Math.max(1, nCols - 1);
  const colX = (i: number) => MARGIN + (i === 0 ? 0 : firstW + (i - 1) * restW);
  const colW = (i: number) => (i === 0 ? firstW : restW);
  const drawHeader = (): void => {
    if (ctx.y - HEADER_ROW_H < CONTENT_BOTTOM) newPage(ctx, ctx.currentModuleHeader);
    ctx.y -= HEADER_ROW_H;
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: CONTENT_W, height: HEADER_ROW_H, color: NAVY });
    table.columns.forEach((c, i) =>
      drawCell(ctx, c, colX(i), colW(i), ctx.y, { align: i === 0 ? 'left' : 'right', font: ctx.bold, size: 8, color: WHITE }));
  };
  drawHeader();
  for (const row of table.rows) {
    if (ctx.y - ROW_H < CONTENT_BOTTOM) { newPage(ctx, ctx.currentModuleHeader); drawHeader(); }
    ctx.y -= ROW_H;
    const st = emphasisStyle(row.emphasis);
    if (st.fill) ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: CONTENT_W, height: ROW_H, color: st.fill });
    row.cells.forEach((cell, i) => {
      const isNum = typeof cell === 'number';
      drawCell(ctx, fmt(cell), colX(i), colW(i), ctx.y, {
        align: i === 0 || !isNum ? 'left' : 'right',
        font: st.bold ? ctx.bold : ctx.font, size: 8, color: st.color,
      });
    });
  }
  ctx.y -= SECTION_GAP;
}

function drawPeriodTable(ctx: Ctx, table: PdfTable, fmt: (v: string | number | null) => string): void {
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
      if (ctx.y - HEADER_ROW_H < CONTENT_BOTTOM) newPage(ctx, ctx.currentModuleHeader);
      ctx.y -= HEADER_ROW_H;
      ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: totalRowW, height: HEADER_ROW_H, color: NAVY });
      headerLabels.forEach((c, k) =>
        drawCell(ctx, c, colX(k), colW(k), ctx.y, { align: k === 0 ? 'left' : 'right', font: ctx.bold, size: 8, color: WHITE }));
    };
    drawHeader();
    for (const row of table.rows) {
      if (ctx.y - ROW_H < CONTENT_BOTTOM) { newPage(ctx, ctx.currentModuleHeader); drawHeader(); }
      ctx.y -= ROW_H;
      const st = emphasisStyle(row.emphasis);
      if (st.fill) ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: totalRowW, height: ROW_H, color: st.fill });
      const cells = [row.cells[0], row.cells[1], ...row.cells.slice(2 + from, 2 + to)];
      cells.forEach((cell, k) =>
        drawCell(ctx, fmt(cell ?? null), colX(k), colW(k), ctx.y, {
          align: k === 0 ? 'left' : 'right', font: st.bold ? ctx.bold : ctx.font, size: 8, color: st.color,
        }));
    }
    ctx.y -= SECTION_GAP;
  });
}

// Extend Ctx with the running module header so continuation pages re-draw it.
interface Ctx { currentModuleHeader?: string }

// ── Cover page ──────────────────────────────────────────────────────────────
function drawCover(ctx: Ctx, opts: GenerateProjectPdfOptions, kpis: Array<[string, string]>, currency: string): void {
  newPage(ctx);
  const { page, bold, font } = ctx;
  page.drawRectangle({ x: 0, y: PAGE_H - 150, width: PAGE_W, height: 150, color: NAVY });
  page.drawText('Project Financial Report', { x: MARGIN, y: PAGE_H - 70, size: 26, font: bold, color: WHITE });
  page.drawText(fitText(opts.projectName || 'Untitled Project', bold, 18, CONTENT_W), {
    x: MARGIN, y: PAGE_H - 104, size: 18, font: bold, color: WHITE,
  });
  const meta = `${opts.versionLabel ? opts.versionLabel + '  ·  ' : ''}${opts.dateLabel}  ·  All figures in ${currency}`;
  page.drawText(meta, { x: MARGIN, y: PAGE_H - 128, size: 10, font, color: WHITE });

  // KPI grid (2 rows x 3 cols)
  const cols = 3;
  const boxW = (CONTENT_W - (cols - 1) * 12) / cols;
  const boxH = 70;
  let yTop = PAGE_H - 200;
  kpis.forEach(([label, value], i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = MARGIN + c * (boxW + 12);
    const y = yTop - r * (boxH + 12);
    page.drawRectangle({ x, y: y - boxH, width: boxW, height: boxH, borderColor: BORDER, borderWidth: 1, color: rgb(0.98, 0.99, 1) });
    page.drawText(fitText(label.toUpperCase(), bold, 8, boxW - 16), { x: x + 10, y: y - 20, size: 8, font: bold, color: MUTED });
    page.drawText(fitText(value, bold, 18, boxW - 16), { x: x + 10, y: y - 48, size: 18, font: bold, color: NAVY_DARK });
  });
}

// ── Footers (page numbers, drawn after all content) ─────────────────────────
function drawFooters(ctx: Ctx): void {
  const total = ctx.pages.length;
  ctx.pages.forEach((page, i) => {
    const text = `Page ${i + 1} of ${total}   ·   ${ctx.projectName}${ctx.versionLabel ? '  ·  ' + ctx.versionLabel : ''}`;
    page.drawText(fitText(text, ctx.font, 8, CONTENT_W), { x: MARGIN, y: MARGIN, size: 8, font: ctx.font, color: MUTED });
  });
}

// ── Section builders (state → tables) ───────────────────────────────────────
const sum = (a: number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);
const last = (a: number[]): number => a[a.length - 1] ?? 0;

function periodRow(label: string, values: number[], total: 'sum' | 'last' | 'none', emphasis?: RowEmphasis): PdfTableRow {
  const t = total === 'sum' ? sum(values) : total === 'last' ? last(values) : null;
  return { cells: [label, t, ...values], emphasis };
}

function buildModule1(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState): PdfTable[] {
  const p = state.project;
  const fin = snap.financing;
  const tables: PdfTable[] = [];
  // Project overview (KV)
  tables.push({
    title: 'Project Overview', kind: 'grid', columns: ['Field', 'Value'],
    rows: [
      ['Project name', p.name || '(unnamed)'],
      ['Currency', p.currency],
      ['Location', [p.location, p.country].filter(Boolean).join(', ') || '-'],
      ['Project type', String(p.projectType ?? '-')],
      ['Start year', String(snap.projectStartYear)],
      ['Model horizon (years)', String(snap.axisLength)],
      ['Financial terminology', p.financialTerminology ?? 'standard'],
    ].map((c) => ({ cells: c })),
  });
  // Funding & capital stack (KV)
  tables.push({
    title: 'Funding & Capital Stack', kind: 'grid', columns: ['Field', 'Value'],
    rows: [
      { cells: ['Debt share', `${(fin.funding.debtPct ?? 0).toFixed(0)}%`] },
      { cells: ['Equity share', `${(fin.funding.equityPct ?? 0).toFixed(0)}%`] },
      { cells: ['Total new debt', sum(snap.directCF.debtDrawdownPerPeriod)] },
      { cells: ['Total cash equity', sum(snap.directCF.equityDrawdownPerPeriod)] },
      { cells: ['In-kind equity', sum(snap.directCF.equityInKindDrawdownPerPeriod)] },
      { cells: ['Existing pre-capex', fin.existing.preCapexTotal] },
    ],
  });
  // Phases (grid list)
  if (state.phases.length) {
    tables.push({
      title: 'Phases', kind: 'grid', columns: ['Phase', 'Status', 'Start', 'Constr. yrs'],
      rows: state.phases.map((ph) => ({
        cells: [
          ph.name,
          ph.status ?? 'planning',
          ph.startDate ? String(new Date(ph.startDate).getUTCFullYear()) : '-',
          ph.constructionPeriods ?? 0,
        ],
      })),
    });
  }
  // Financing tranches
  if (state.financingTranches.length) {
    tables.push({
      title: 'Financing Tranches', kind: 'grid', columns: ['Tranche', 'Origin', 'Rate %', 'Repayment'],
      rows: state.financingTranches.map((t) => ({
        cells: [
          t.name,
          t.origin === 'existing' ? 'existing' : 'new',
          (t.interestRatePct ?? ((t.interbankRatePct ?? 0) + (t.creditSpreadPct ?? 0))),
          String(t.repaymentMethod ?? '-'),
        ],
      })),
    });
  }
  // Cash waterfall (period)
  const dcf = snap.directCF;
  const yl = snap.yearLabels.map(String);
  tables.push({
    title: 'Cash Waterfall', kind: 'period', columns: ['', 'Total', ...yl],
    rows: [
      periodRow('Opening cash', dcf.openingCashPerPeriod, 'none'),
      periodRow('Cash from operations', dcf.cashFromOperationsPerPeriod, 'sum'),
      periodRow('Cash from investing', dcf.cashFromInvestmentPerPeriod, 'sum'),
      periodRow('Equity drawdown', dcf.equityDrawdownPerPeriod, 'sum'),
      periodRow('Debt drawdown', dcf.debtDrawdownPerPeriod, 'sum'),
      periodRow('Interest paid', dcf.interestPaidPerPeriod, 'sum'),
      periodRow('Debt repaid', dcf.debtRepaymentPerPeriod, 'sum'),
      periodRow('Dividends paid', dcf.dividendsPaidPerPeriod, 'sum'),
      periodRow('Closing cash', dcf.closingCashPerPeriod, 'last', 'total'),
    ],
  });
  return tables;
}

function buildModule2(snap: ProjectFinancialsSnapshot): PdfTable[] {
  const pl = snap.pl;
  const yl = snap.yearLabels.map(String);
  return [{
    title: 'Revenue & Cost of Sales', kind: 'period', columns: ['', 'Total', ...yl],
    rows: [
      periodRow('Residential revenue', pl.residentialRevenuePerPeriod, 'sum'),
      periodRow('Hospitality revenue', pl.hospitalityRevenuePerPeriod, 'sum'),
      periodRow('Retail revenue', pl.retailRevenuePerPeriod, 'sum'),
      periodRow('Total revenue', pl.totalRevenuePerPeriod, 'sum', 'subtotal'),
      periodRow('Cost of sales', pl.cosPerPeriod, 'sum'),
    ],
  }];
}

function buildModule3(snap: ProjectFinancialsSnapshot): PdfTable[] {
  const pl = snap.pl;
  const yl = snap.yearLabels.map(String);
  return [{
    title: 'Operating Expenses', kind: 'period', columns: ['', 'Total', ...yl],
    rows: [
      periodRow('Hospitality opex', pl.hospitalityOpexPerPeriod, 'sum'),
      periodRow('Retail opex', pl.retailOpexPerPeriod, 'sum'),
      periodRow('HQ / corporate opex', pl.hqOpexPerPeriod, 'sum'),
      periodRow('Total opex', pl.totalOpexPerPeriod, 'sum', 'subtotal'),
    ],
  }];
}

function buildModule4(snap: ProjectFinancialsSnapshot): PdfTable[] {
  const { pl, directCF: cf, bs } = snap;
  const yl = snap.yearLabels.map(String);
  const cols = ['', 'Total', ...yl];
  return [
    {
      title: 'Profit & Loss', kind: 'period', columns: cols,
      rows: [
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
      ],
    },
    {
      title: 'Direct Cash Flow', kind: 'period', columns: cols,
      rows: [
        periodRow('Revenue received', cf.revenueReceivedPerPeriod, 'sum'),
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
      ],
    },
    {
      title: 'Balance Sheet', kind: 'period', columns: cols,
      rows: [
        periodRow('Cash', bs.cashPerPeriod, 'last'),
        periodRow('Receivables (operating)', bs.arPerPeriod, 'last'),
        periodRow('Residential receivables', bs.residentialReceivablesPerPeriod, 'last'),
        periodRow('Inventory (WIP)', bs.inventoryPerPeriod, 'last'),
        periodRow('Net fixed assets', bs.nbvPerPeriod, 'last'),
        periodRow('Land', bs.landPerPeriod, 'last'),
        periodRow('Total assets', bs.totalAssetsPerPeriod, 'last', 'subtotal'),
        periodRow('Accounts payable', bs.apPerPeriod, 'last'),
        periodRow('Unearned revenue', bs.unearnedRevenuePerPeriod, 'last'),
        periodRow('Debt outstanding', bs.debtOutstandingPerPeriod, 'last'),
        periodRow('Total liabilities', bs.totalLiabilitiesPerPeriod, 'last', 'subtotal'),
        periodRow('Share capital', bs.shareCapitalPerPeriod, 'last'),
        periodRow('Retained earnings', bs.retainedEarningsPerPeriod, 'last'),
        periodRow('Total equity', bs.totalEquityPerPeriod, 'last', 'subtotal'),
        periodRow('Liabilities + equity', bs.totalLiabilitiesAndEquityPerPeriod, 'last', 'total'),
      ],
    },
  ];
}

function buildModule5(returns: ReturnsSnapshot): PdfTable[] {
  const r = returns.result;
  const pct = (v: number | null): string => (v === null || !Number.isFinite(v) ? 'n/a' : `${(v * 100).toFixed(1)}%`);
  const mult = (v: number | null): string => (v === null || !Number.isFinite(v) ? 'n/a' : `${v.toFixed(2)}x`);
  const yl = returns.streamYearLabels.map(String);
  return [
    {
      title: 'Returns Summary', kind: 'grid', columns: ['Metric', 'Value'],
      rows: [
        { cells: ['Project IRR (FCFF)', pct(r.fcff.irr)] },
        { cells: ['Equity IRR (FCFE)', pct(r.fcfe.irr)] },
        { cells: ['Distributed Equity IRR', pct(r.dividends.irr)] },
        { cells: ['Equity multiple (FCFE)', mult(r.fcfe.moic)] },
        { cells: ['Total development cost', returns.developmentEconomics.totalDevelopmentCost] },
        { cells: ['Total equity invested', returns.totalEquityInvested] },
        { cells: ['Total dividends distributed', returns.totalDividendsDistributed] },
      ],
    },
    {
      title: 'Sponsor Cash-Flow Streams', kind: 'period', columns: ['', 'Total', ...yl],
      rows: [
        periodRow('FCFF (unlevered)', returns.fcffPerPeriod, 'sum'),
        periodRow('FCFE (levered)', returns.fcfePerPeriod, 'sum'),
        periodRow('Distributed equity', returns.dividendStreamPerPeriod, 'sum'),
      ],
    },
  ];
}

function buildSections(
  snap: ProjectFinancialsSnapshot,
  returns: ReturnsSnapshot | null,
  state: FinancialsResolverState,
  selected: Set<string>,
): PdfModuleSection[] {
  const out: PdfModuleSection[] = [];
  for (const m of MODULES) {
    if (!selected.has(m.key)) continue;
    let tables: PdfTable[] = [];
    if (m.key === 'module1') tables = buildModule1(snap, state);
    else if (m.key === 'module2') tables = buildModule2(snap);
    else if (m.key === 'module3') tables = buildModule3(snap);
    else if (m.key === 'module4') tables = buildModule4(snap);
    else if (m.key === 'module5') tables = returns ? buildModule5(returns) : [];
    else continue; // modules 6+ have no exporter yet (driven by registry, auto-skip)
    if (tables.length) out.push({ num: m.num, key: m.key, title: `Module ${m.num} — ${m.longLabel}`, tables });
  }
  return out;
}

// ── Public entry ─────────────────────────────────────────────────────────────
export async function generateProjectPdf(opts: GenerateProjectPdfOptions): Promise<Uint8Array> {
  const snap = computeFinancialsSnapshot(opts.state);
  let returns: ReturnsSnapshot | null = null;
  try { returns = computeReturnsSnapshot(snap, opts.state.project); } catch { returns = null; }

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = {
    doc, font, bold, pages: [], page: null as unknown as PDFPage, y: 0,
    projectName: opts.projectName || 'Untitled Project',
    versionLabel: opts.versionLabel ?? '',
  };
  const fmt = makeFmt(opts.state);

  // KPI summary for the cover.
  const kpis: Array<[string, string]> = [];
  if (returns) {
    const r = returns.result;
    const pct = (v: number | null): string => (v === null || !Number.isFinite(v) ? 'n/a' : `${(v * 100).toFixed(1)}%`);
    kpis.push(['Project IRR', pct(r.fcff.irr)]);
    kpis.push(['Equity IRR', pct(r.fcfe.irr)]);
    kpis.push(['Equity Multiple', r.fcfe.moic && Number.isFinite(r.fcfe.moic) ? `${r.fcfe.moic.toFixed(2)}x` : 'n/a']);
    kpis.push(['Total Dev Cost', fmt(returns.developmentEconomics.totalDevelopmentCost)]);
  }
  kpis.push(['Total Revenue', fmt(sum(snap.pl.totalRevenuePerPeriod))]);
  kpis.push(['Peak Debt', fmt(Math.max(0, ...snap.bs.debtOutstandingPerPeriod))]);

  drawCover(ctx, opts, kpis, opts.state.project.currency);

  const sections = buildSections(snap, returns, opts.state, new Set(opts.selectedModuleKeys));
  for (const section of sections) {
    newPage(ctx, section.title);
    ctx.currentModuleHeader = section.title;
    for (const table of section.tables) {
      if (table.kind === 'period') drawPeriodTable(ctx, table, fmt);
      else drawGridTable(ctx, table, fmt);
    }
  }

  drawFooters(ctx);
  return doc.save();
}
