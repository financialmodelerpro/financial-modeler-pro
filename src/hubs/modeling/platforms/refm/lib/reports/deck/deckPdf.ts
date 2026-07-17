/**
 * deckPdf.ts (REFM Module 7, IC Presentation Builder: the PDF exporter)
 *
 * Renders the slide document to a shareable landscape PDF, one page per slide, at
 * the deck's true aspect ratio (13.333in x 7.5in = 960pt x 540pt). Every object
 * is drawn at the exact spot it sits on the 1280 x 720 canvas: logical px scale to
 * points by a single factor (72 / 96 = 0.75), with a y-flip because PDF space
 * originates bottom-left.
 *
 * It reads the SAME resolved model as the canvas and the PPTX exporter
 * (resolveDeckExport), so a figure in the PDF can never disagree with a figure on
 * screen or in the .pptx, and an unresolved binding paints the same visible amber
 * "not available" frame rather than a fabricated number.
 *
 * pdf-lib has no LibreOffice dependency (a literal PPTX-to-PDF is not possible on
 * Vercel), so this is a same-model renderer, not a conversion. It uses the built
 * -in StandardFonts, so there is no font file to embed and no subsetting to trip
 * over: brand fonts map to a serif (Times) or sans (Helvetica) face by family.
 *
 * No em dashes in this file.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import type { ICReportModel } from '../icReport';
import type { DeckFmt, ChartData } from './bindings';
import type { Deck } from './types';
import { DECK_THEME } from './theme';
import {
  resolveDeckExport, type ExportDeck, type ExportObject, type ExportSlide,
  type GanttPaint, type HeatmapPaint, type KpiPaint,
} from './exportModel';

// ── Geometry ─────────────────────────────────────────────────────────────────

const S = 72 / 96;            // pt per logical px = 0.75
const PAGE_W = 1280 * S;      // 960
const PAGE_H = 720 * S;       // 540
const px = (v: number): number => v * S;

const AMBER = rgb(0.72, 0.54, 0.18);
const AMBER_BG = rgb(0.984, 0.965, 0.925);
const AMBER_TEXT = rgb(0.54, 0.4, 0.13);

// ── Colour ───────────────────────────────────────────────────────────────────

function hex(h: string): RGB {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

// ── Fonts ────────────────────────────────────────────────────────────────────

interface Fonts {
  sans: PDFFont; sansB: PDFFont; sansI: PDFFont; sansBI: PDFFont;
  serif: PDFFont; serifB: PDFFont; serifI: PDFFont; serifBI: PDFFont;
}

const SERIF = /cambria|georgia|times|garamond|serif|book antiqua|palatino/i;

/** Pick the embedded face for a family + weight, mapping the brand family to a
 *  serif or sans standard face. Exact brand fonts (Calibri/Cambria) are kept in
 *  the .pptx; the PDF uses their nearest standard cousin. */
function pick(f: Fonts, family: string, bold: boolean, italic: boolean): PDFFont {
  const serif = SERIF.test(family);
  if (serif) return bold && italic ? f.serifBI : bold ? f.serifB : italic ? f.serifI : f.serif;
  return bold && italic ? f.sansBI : bold ? f.sansB : italic ? f.sansI : f.sans;
}

// ── Text ─────────────────────────────────────────────────────────────────────

/** The StandardFonts encode WinAnsi only, so any glyph outside it (Arabic names,
 *  exotic punctuation) would throw at draw time. Normalize the common typographic
 *  characters and replace anything still unencodable with '?', so a project name
 *  can never crash the render. */
function sane(s: string): string {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/…/g, '...')
    .replace(/[×]/g, 'x')
    .replace(/[^\t\n\r\x20-\x7E -ÿ•€]/g, '?');
}

interface DrawTextOpts {
  size: number; font: PDFFont; color: RGB;
  align?: 'left' | 'center' | 'right';
  maxWidth?: number; // pt
}

/** Draw a single line of text with a top-left anchor in logical px. Returns the
 *  drawn width in pt. Truncates with an ellipsis when it would overflow. */
function line(page: PDFPage, tx: number, ty: number, text: string, o: DrawTextOpts): void {
  let str = sane(text);
  const wOf = (s: string): number => o.font.widthOfTextAtSize(s, o.size);
  if (o.maxWidth && wOf(str) > o.maxWidth) {
    while (str.length > 1 && wOf(str + '...') > o.maxWidth) str = str.slice(0, -1);
    str = str + '...';
  }
  const w = wOf(str);
  let x = px(tx);
  if (o.align === 'center' && o.maxWidth) x = px(tx) + (o.maxWidth - w) / 2;
  else if (o.align === 'right' && o.maxWidth) x = px(tx) + (o.maxWidth - w);
  const y = PAGE_H - px(ty) - o.size;
  page.drawText(str, { x, y, size: o.size, font: o.font, color: o.color });
}

/** Word-wrap paragraph text inside a logical box (top-left px). */
function paragraph(page: PDFPage, tx: number, ty: number, boxW: number, boxH: number, text: string, o: DrawTextOpts): void {
  const maxW = px(boxW);
  const lh = o.size * 1.32;
  const words = sane(text).split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const trial = cur ? `${cur} ${word}` : word;
    if (o.font.widthOfTextAtSize(trial, o.size) > maxW && cur) { lines.push(cur); cur = word; }
    else cur = trial;
  }
  if (cur) lines.push(cur);
  const maxLines = Math.max(1, Math.floor(px(boxH) / lh));
  lines.slice(0, maxLines).forEach((ln, i) => {
    const y = PAGE_H - px(ty) - o.size - i * lh;
    let x = px(tx);
    const w = o.font.widthOfTextAtSize(ln, o.size);
    if (o.align === 'center') x = px(tx) + (maxW - w) / 2;
    else if (o.align === 'right') x = px(tx) + (maxW - w);
    page.drawText(ln, { x, y, size: o.size, font: o.font, color: o.color });
  });
}

// ── Rect / line ──────────────────────────────────────────────────────────────

function rect(page: PDFPage, x: number, y: number, w: number, h: number, opt: { fill?: RGB; border?: RGB; borderW?: number }): void {
  page.drawRectangle({
    x: px(x), y: PAGE_H - px(y + h), width: px(w), height: px(h),
    color: opt.fill, borderColor: opt.border, borderWidth: opt.borderW ?? (opt.border ? 0.75 : 0),
  });
}

function hline(page: PDFPage, x: number, y: number, w: number, color: RGB, thickness = 0.75): void {
  page.drawLine({ start: { x: px(x), y: PAGE_H - px(y) }, end: { x: px(x + w), y: PAGE_H - px(y) }, thickness, color });
}
function vline(page: PDFPage, x: number, y0: number, y1: number, color: RGB, thickness = 0.75): void {
  page.drawLine({ start: { x: px(x), y: PAGE_H - px(y0) }, end: { x: px(x), y: PAGE_H - px(y1) }, thickness, color });
}

// ── Charts ───────────────────────────────────────────────────────────────────

const CHART_PAD = { top: 18, right: 8, bottom: 18, left: 34 };

function drawChart(page: PDFPage, f: Fonts, deck: ExportDeck, o: ExportObject, data: ChartData, kind: ChartData['kind'], title: string | null): void {
  let top = o.y;
  if (title) {
    line(page, o.x, top, title.toUpperCase(), { size: 8, font: f.sansB, color: hex(DECK_THEME.slate), maxWidth: px(o.w * 0.7), align: 'left' });
    line(page, o.x, top, data.axisUnit, { size: 8, font: f.sans, color: hex(DECK_THEME.slateLight), maxWidth: px(o.w), align: 'right' });
    top += 16;
  }
  const plot = { x: o.x + CHART_PAD.left, y: top + CHART_PAD.top, w: o.w - CHART_PAD.left - CHART_PAD.right, h: (o.y + o.h) - (top + CHART_PAD.top) - CHART_PAD.bottom };
  if (plot.w <= 4 || plot.h <= 4) return;

  if (kind === 'doughnut') { drawDoughnut(page, f, o, top, data); return; }
  if (kind === 'line') { drawLineChart(page, f, plot, data); return; }
  drawBars(page, f, plot, data, kind);
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function axisFmt(v: number, pct: boolean): string {
  if (pct) return `${Math.round(v * 100)}%`;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(v);
}

function drawBars(page: PDFPage, f: Fonts, plot: { x: number; y: number; w: number; h: number }, data: ChartData, kind: ChartData['kind']): void {
  const stacked = kind === 'stackedColumn';
  const horizontal = kind === 'bar';
  const nCat = data.labels.length || 1;
  const allVals = data.series.flatMap((s) => s.values.map((v) => Number(v ?? 0)));
  const stackVals = stacked ? data.labels.map((_l, i) => data.series.reduce((sum, s) => sum + Math.max(0, Number(s.values[i] ?? 0)), 0)) : allVals;
  const max = niceMax(Math.max(1, ...stackVals.map((v) => Math.abs(v))));

  // axis frame
  hline(page, plot.x, plot.y + plot.h, plot.w, hex(DECK_THEME.rule), 0.75);
  vline(page, plot.x, plot.y, plot.y + plot.h, hex(DECK_THEME.rule), 0.75);
  // y gridlines + labels (3 steps)
  for (let g = 0; g <= 3; g++) {
    const val = (max / 3) * g;
    const gy = plot.y + plot.h - (val / max) * plot.h;
    if (g > 0) hline(page, plot.x, gy, plot.w, hex(DECK_THEME.rule), 0.4);
    line(page, plot.x - CHART_PAD.left, gy - 3, axisFmt(val, !!data.pctAxis), { size: 7, font: f.sans, color: hex(DECK_THEME.slate), maxWidth: px(CHART_PAD.left - 3), align: 'right' });
  }

  const slot = plot.w / nCat;
  data.labels.forEach((label, i) => {
    const cx = plot.x + i * slot;
    if (stacked) {
      let acc = 0;
      data.series.forEach((s, si) => {
        const v = Math.max(0, Number(s.values[i] ?? 0));
        const bh = (v / max) * plot.h;
        const bw = slot * 0.62;
        rect(page, cx + (slot - bw) / 2, plot.y + plot.h - acc - bh, bw, bh, { fill: hex(s.color ?? seriesColor(si)) });
        acc += bh;
      });
    } else {
      const bw = (slot * 0.7) / data.series.length;
      data.series.forEach((s, si) => {
        const v = Number(s.values[i] ?? 0);
        const bh = (Math.abs(v) / max) * plot.h;
        const color = data.series.length === 1 ? hex(data.pointColors?.[i] ?? s.color ?? DECK_THEME.navy) : hex(s.color ?? seriesColor(si));
        const bx = cx + slot * 0.15 + si * bw;
        rect(page, bx, plot.y + plot.h - bh, bw * 0.86, bh, { fill: color });
      });
    }
    line(page, cx, plot.y + plot.h + 3, label, { size: 7, font: f.sans, color: hex(DECK_THEME.slate), maxWidth: px(slot), align: 'center' });
  });
  void horizontal; // horizontal bar falls back to columns in the PDF renderer
}

function seriesColor(i: number): string {
  const ramp = [DECK_THEME.navy, DECK_THEME.navyLight, DECK_THEME.navyMid, DECK_THEME.pale, DECK_THEME.green, DECK_THEME.slateLight];
  return ramp[i % ramp.length];
}

function drawLineChart(page: PDFPage, f: Fonts, plot: { x: number; y: number; w: number; h: number }, data: ChartData): void {
  const vals = data.series.flatMap((s) => s.values.map((v) => Number(v ?? 0)));
  const max = niceMax(Math.max(1, ...vals));
  hline(page, plot.x, plot.y + plot.h, plot.w, hex(DECK_THEME.rule), 0.75);
  vline(page, plot.x, plot.y, plot.y + plot.h, hex(DECK_THEME.rule), 0.75);
  for (let g = 0; g <= 3; g++) {
    const val = (max / 3) * g;
    const gy = plot.y + plot.h - (val / max) * plot.h;
    if (g > 0) hline(page, plot.x, gy, plot.w, hex(DECK_THEME.rule), 0.4);
    line(page, plot.x - CHART_PAD.left, gy - 3, axisFmt(val, !!data.pctAxis), { size: 7, font: f.sans, color: hex(DECK_THEME.slate), maxWidth: px(CHART_PAD.left - 3), align: 'right' });
  }
  const n = Math.max(1, data.labels.length - 1);
  const xOf = (i: number): number => plot.x + (i / n) * plot.w;
  const yOf = (v: number): number => plot.y + plot.h - (v / max) * plot.h;
  data.series.forEach((s, si) => {
    const color = hex(s.color ?? seriesColor(si));
    for (let i = 1; i < s.values.length; i++) {
      const a = Number(s.values[i - 1] ?? 0), b = Number(s.values[i] ?? 0);
      page.drawLine({ start: { x: px(xOf(i - 1)), y: PAGE_H - px(yOf(a)) }, end: { x: px(xOf(i)), y: PAGE_H - px(yOf(b)) }, thickness: 1.5, color });
    }
  });
  data.labels.forEach((label, i) => line(page, xOf(i) - 14, plot.y + plot.h + 3, label, { size: 7, font: f.sans, color: hex(DECK_THEME.slate), maxWidth: px(28), align: 'center' }));
}

/** Pie / doughnut via filled polygon slices (arc approximated by segments), so it
 *  needs no arc primitive. Drawn in the left square of the plot box. */
function drawDoughnut(page: PDFPage, f: Fonts, o: ExportObject, top: number, data: ChartData): void {
  const vals = (data.series[0]?.values ?? []).map((v) => Math.max(0, Number(v ?? 0)));
  const total = vals.reduce((a, b) => a + b, 0);
  if (total <= 0) return;
  const size = Math.min(o.w * 0.5, (o.y + o.h) - top - 8);
  const cx = o.x + size / 2 + 6;
  const cy = top + size / 2 + 4;
  const R = size / 2 - 2;
  const rInner = R * 0.55;
  const cxp = px(cx), cyp = PAGE_H - px(cy);
  let a0 = -Math.PI / 2;
  vals.forEach((v, i) => {
    const a1 = a0 + (v / total) * Math.PI * 2;
    const steps = Math.max(2, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 60));
    const pts: Array<[number, number]> = [];
    for (let sIdx = 0; sIdx <= steps; sIdx++) { const a = a0 + ((a1 - a0) * sIdx) / steps; pts.push([cxp + px(R) * Math.cos(a), cyp + px(R) * Math.sin(a)]); }
    for (let sIdx = steps; sIdx >= 0; sIdx--) { const a = a0 + ((a1 - a0) * sIdx) / steps; pts.push([cxp + px(rInner) * Math.cos(a), cyp + px(rInner) * Math.sin(a)]); }
    // drawSvgPath maps (svgX, svgY) to page (opt.x + svgX, opt.y - svgY). Points
    // are built in page coords (y up); express svgY as PAGE_H - pageY and anchor
    // opt at (0, PAGE_H) so the slice lands exactly where computed.
    const dPath = `M ${pts.map(([x, y]) => `${x.toFixed(2)} ${(PAGE_H - y).toFixed(2)}`).join(' L ')} Z`;
    page.drawSvgPath(dPath, { x: 0, y: PAGE_H, color: hex(data.pointColors?.[i] ?? seriesColor(i)), borderColor: rgb(1, 1, 1), borderWidth: 0.75 });
    a0 = a1;
  });
  // legend to the right of the ring
  const lx = o.x + size + 16;
  data.labels.forEach((label, i) => {
    const ly = top + 6 + i * 15;
    rect(page, lx, ly, 9, 9, { fill: hex(data.pointColors?.[i] ?? seriesColor(i)) });
    line(page, lx + 13, ly - 1, label, { size: 8, font: f.sans, color: hex(DECK_THEME.ink), maxWidth: px(o.w - size - 34), align: 'left' });
  });
}

// ── Table ────────────────────────────────────────────────────────────────────

function drawTable(page: PDFPage, f: Fonts, deck: ExportDeck, o: ExportObject, paint: { data: import('./bindings').TableData; title: string | null; striped: boolean; fontSize: number }): void {
  const d = paint.data;
  let y = o.y;
  if (paint.title) {
    line(page, o.x, y, paint.title.toUpperCase(), { size: 8, font: f.sansB, color: hex(DECK_THEME.slate), maxWidth: px(o.w), align: 'left' });
    y += 20;
  }
  const nCols = d.headers.length;
  const widths = nCols === 2 ? [0.62, 0.38] : Array.from({ length: nCols }, () => 1 / nCols);
  const colX = (i: number): number => o.x + widths.slice(0, i).reduce((a, b) => a + b, 0) * o.w;
  const colW = (i: number): number => widths[i] * o.w;
  const fsz = Math.max(6.5, paint.fontSize * S);
  const headH = 18, rowH = Math.max(13, fsz + 7);
  const avail = (o.y + o.h) - y;
  const maxRows = Math.max(0, Math.floor((avail - headH) / rowH));

  // header
  rect(page, o.x, y, o.w, headH, { fill: hex(DECK_THEME.navy) });
  d.headers.forEach((hc, i) => line(page, colX(i) + 6, y + 5, hc.text.toUpperCase(), { size: Math.max(6, fsz - 1), font: f.sansB, color: rgb(1, 1, 1), maxWidth: px(colW(i) - 12), align: hc.align }));
  y += headH;

  d.rows.slice(0, maxRows).forEach((row, ri) => {
    const fill = row.shaded ? hex(DECK_THEME.paleWash) : row.emphasis ? hex('#EEF3F9') : (paint.striped && ri % 2 === 1) ? hex('#FAFBFD') : undefined;
    if (fill) rect(page, o.x, y, o.w, rowH, { fill });
    hline(page, o.x, y, o.w, hex(row.emphasis ? DECK_THEME.navy : DECK_THEME.rule), row.emphasis ? 1.2 : 0.4);
    row.cells.forEach((c, i) => {
      const bold = !!c.bold || !!row.emphasis;
      const color = c.color ? hex(c.color) : row.emphasis ? hex(DECK_THEME.green) : hex(DECK_THEME.ink);
      line(page, colX(i) + 6, y + (rowH - fsz) / 2, c.text, { size: fsz, font: bold ? f.sansB : f.sans, color, maxWidth: px(colW(i) - 12), align: c.align });
    });
    y += rowH;
  });
  if (d.rows.length > maxRows) line(page, o.x, y + 1, `+${d.rows.length - maxRows} more rows`, { size: 6.5, font: f.sansI, color: hex(DECK_THEME.slateLight), maxWidth: px(o.w), align: 'right' });
}

// ── KPI ──────────────────────────────────────────────────────────────────────

function drawKpi(page: PDFPage, f: Fonts, o: ExportObject, k: KpiPaint): void {
  if (k.fill) rect(page, o.x, o.y, o.w, o.h, { fill: hex(k.fill) });
  else rect(page, o.x, o.y, o.w, o.h, { border: hex(DECK_THEME.rule), borderW: 0.75 });
  const pad = 12;
  line(page, o.x + pad, o.y + pad, k.label.toUpperCase(), { size: 7.5, font: f.sansB, color: hex(k.labelColor), maxWidth: px(o.w - pad * 2), align: 'left' });
  const valSize = Math.min(22, Math.max(12, o.h * 0.34 * S));
  line(page, o.x + pad, o.y + pad + 16, k.value, { size: valSize, font: f.serifB, color: hex(k.valueColor), maxWidth: px(o.w - pad * 2), align: 'left' });
  if (k.sub) line(page, o.x + pad, o.y + o.h - pad - 9, k.sub, { size: 7.5, font: f.sans, color: hex(k.subColor), maxWidth: px(o.w - pad * 2), align: 'left' });
}

// ── Gantt ────────────────────────────────────────────────────────────────────

function drawGantt(page: PDFPage, f: Fonts, o: ExportObject, g: GanttPaint): void {
  const y0 = g.startYear, y1 = g.exitYear;
  const span = Math.max(1, y1 - y0);
  const labelW = 132;
  const trackW = o.w - labelW - 8;
  const xOf = (year: number): number => o.x + labelW + ((year - y0) / span) * trackW;
  const laneH = Math.min(38, Math.max(20, (o.h - 40) / Math.max(1, g.lanes.length)));
  const step = span > 14 ? 3 : span > 8 ? 2 : 1;
  for (let y = y0; y <= y1; y += step) {
    vline(page, xOf(y), o.y, o.y + o.h - 22, hex(DECK_THEME.rule), 0.4);
    line(page, xOf(y) - 14, o.y, String(y), { size: 7, font: f.sans, color: hex(DECK_THEME.slate), maxWidth: px(28), align: 'center' });
  }
  g.lanes.forEach((lane, i) => {
    const top = o.y + 20 + i * laneH;
    line(page, o.x, top, lane.name, { size: 8, font: f.sansB, color: hex(DECK_THEME.ink), maxWidth: px(labelW - 8), align: 'left' });
    line(page, o.x, top + 12, lane.strategies, { size: 6.5, font: f.sans, color: hex(DECK_THEME.slateLight), maxWidth: px(labelW - 8), align: 'left' });
    const cs = xOf(lane.constructionStart), ce = xOf(lane.constructionEnd + 1);
    rect(page, cs, top + 2, Math.max(3, ce - cs), laneH - 14, { fill: hex(DECK_THEME.navy) });
    if (lane.operationsStart !== null && lane.operationsEnd !== null) {
      const os = xOf(lane.operationsStart), oe = xOf(lane.operationsEnd + 1);
      rect(page, os, top + 2, Math.max(3, oe - os), laneH - 14, { fill: hex(DECK_THEME.navyLight) });
    }
  });
  if (g.debtRepaidYear) vline(page, xOf(g.debtRepaidYear), o.y + 14, o.y + o.h - 22, hex(DECK_THEME.green), 1.4);
  vline(page, Math.min(xOf(g.exitYear), o.x + labelW + trackW - 1), o.y + 14, o.y + o.h - 22, hex(DECK_THEME.red), 1.4);
}

// ── Heatmap ──────────────────────────────────────────────────────────────────

function drawHeatmap(page: PDFPage, f: Fonts, o: ExportObject, hm: HeatmapPaint): void {
  line(page, o.x, o.y, hm.title, { size: 8, font: f.sansB, color: hex(DECK_THEME.slate), maxWidth: px(o.w * 0.5), align: 'left' });
  line(page, o.x, o.y, hm.subtitle, { size: 7, font: f.sans, color: hex(DECK_THEME.slateLight), maxWidth: px(o.w), align: 'right' });
  const gridY = o.y + 20;
  const nCols = hm.xHeaders.length + 1;
  const nRows = hm.yHeaders.length + 1;
  const cw = o.w / nCols;
  const ch = Math.min(30, (o.y + o.h - gridY) / nRows);
  // header row
  rect(page, o.x, gridY, cw, ch, { fill: hex(DECK_THEME.navy) });
  hm.xHeaders.forEach((x, i) => {
    rect(page, o.x + (i + 1) * cw, gridY, cw, ch, { fill: hex(DECK_THEME.navy), border: rgb(1, 1, 1), borderW: 1 });
    line(page, o.x + (i + 1) * cw, gridY + (ch - 8) / 2, x, { size: 8, font: f.sansB, color: rgb(1, 1, 1), maxWidth: px(cw), align: 'center' });
  });
  hm.cells.forEach((row, ri) => {
    const ry = gridY + (ri + 1) * ch;
    rect(page, o.x, ry, cw, ch, { fill: hex(DECK_THEME.navy), border: rgb(1, 1, 1), borderW: 1 });
    line(page, o.x, ry + (ch - 8) / 2, hm.yHeaders[ri] ?? '', { size: 8, font: f.sansB, color: rgb(1, 1, 1), maxWidth: px(cw - 4), align: 'center' });
    row.forEach((cell, ci) => {
      const cxp = o.x + (ci + 1) * cw;
      rect(page, cxp, ry, cw, ch, { fill: hex(cell.fill), border: rgb(1, 1, 1), borderW: 1 });
      line(page, cxp, ry + (ch - 8) / 2, cell.text, { size: 8, font: f.sansB, color: hex(cell.textColor), maxWidth: px(cw), align: 'center' });
    });
  });
}

// ── Risk matrix ──────────────────────────────────────────────────────────────

const RISK_TONE: Record<string, string> = { Low: DECK_THEME.green, Medium: '#B98A2E', High: DECK_THEME.red };

function drawRiskMatrix(page: PDFPage, f: Fonts, o: ExportObject, rows: { risk: string; likelihood: string; impact: string; mitigation: string }[]): void {
  const cols = [0.30, 0.14, 0.14, 0.42];
  const colX = (i: number): number => o.x + cols.slice(0, i).reduce((a, b) => a + b, 0) * o.w;
  const colW = (i: number): number => cols[i] * o.w;
  const headH = 18;
  rect(page, o.x, o.y, o.w, headH, { fill: hex(DECK_THEME.navy) });
  ['Risk', 'Likelihood', 'Impact', 'Mitigation'].forEach((t, i) => line(page, colX(i) + 6, o.y + 5, t.toUpperCase(), { size: 7, font: f.sansB, color: rgb(1, 1, 1), maxWidth: px(colW(i) - 12), align: 'left' }));
  let y = o.y + headH;
  const rowH = Math.max(20, ((o.y + o.h) - y) / Math.max(1, rows.length));
  rows.forEach((r, i) => {
    if (i % 2) rect(page, o.x, y, o.w, rowH, { fill: hex('#F4F5F7') });
    hline(page, o.x, y, o.w, hex(DECK_THEME.rule), 0.4);
    line(page, colX(0) + 6, y + 5, r.risk, { size: 8, font: f.sansB, color: hex(DECK_THEME.ink), maxWidth: px(colW(0) - 12), align: 'left' });
    line(page, colX(1) + 6, y + 5, r.likelihood, { size: 7.5, font: f.sansB, color: hex(RISK_TONE[r.likelihood] ?? DECK_THEME.slate), maxWidth: px(colW(1) - 12), align: 'left' });
    line(page, colX(2) + 6, y + 5, r.impact, { size: 7.5, font: f.sansB, color: hex(RISK_TONE[r.impact] ?? DECK_THEME.slate), maxWidth: px(colW(2) - 12), align: 'left' });
    paragraph(page, colX(3) + 6, y + 4, colW(3) - 12, rowH - 6, r.mitigation, { size: 7.5, font: f.sans, color: hex(DECK_THEME.slate), align: 'left' });
    y += rowH;
  });
}

// ── Unlinked ─────────────────────────────────────────────────────────────────

function drawUnlinked(page: PDFPage, f: Fonts, o: ExportObject, label: string, reason: string): void {
  rect(page, o.x, o.y, o.w, o.h, { fill: AMBER_BG, border: AMBER, borderW: 1 });
  line(page, o.x, o.y + o.h / 2 - 12, `${label.toUpperCase()} NOT AVAILABLE`, { size: 8, font: f.sansB, color: AMBER_TEXT, maxWidth: px(o.w), align: 'center' });
  paragraph(page, o.x + 8, o.y + o.h / 2, o.w - 16, 24, reason, { size: 8, font: f.sans, color: AMBER_TEXT, align: 'center' });
}

// ── Object dispatch ──────────────────────────────────────────────────────────

function drawObject(page: PDFPage, f: Fonts, deck: ExportDeck, o: ExportObject): void {
  const p = o.paint;
  switch (p.kind) {
    case 'text': {
      if (p.box?.fill || p.box?.border) rect(page, o.x, o.y, o.w, o.h, { fill: p.box.fill ? hex(p.box.fill) : undefined, border: p.box.border ? hex(p.box.border.color) : undefined, borderW: p.box.border?.width });
      const size = p.style.size * S;
      const family = p.style.fontFamily ?? (p.style.fontRole === 'heading' ? deck.fontHeading : deck.fontBody);
      const fnt = pick(f, family, !!p.style.bold, !!p.style.italic);
      const oneLine = !p.text.includes('\n') && fnt.widthOfTextAtSize(p.text, size) <= px(o.w);
      if (oneLine) {
        const yOff = p.style.valign === 'middle' ? (o.h - p.style.size) / 2 : p.style.valign === 'bottom' ? o.h - p.style.size - 2 : 2;
        line(page, o.x, o.y + yOff, p.text, { size, font: fnt, color: hex(p.style.color), maxWidth: px(o.w), align: p.style.align });
      } else {
        p.text.split('\n').forEach((ln, li) => paragraph(page, o.x, o.y + 2 + li * size * 1.32, o.w, o.h - li * size * 1.32, ln, { size, font: fnt, color: hex(p.style.color), align: p.style.align }));
      }
      break;
    }
    case 'bullets': {
      const size = p.style.size * S;
      const fnt = pick(f, p.style.fontFamily ?? deck.fontBody, !!p.style.bold, !!p.style.italic);
      const lh = size * 1.5;
      let cy = o.y + 2;
      p.items.forEach((it, i) => {
        if (cy + size > o.y + o.h) return;
        const marker = p.numbered ? `${i + 1}.` : '•';
        line(page, o.x, cy, marker, { size, font: pick(f, deck.fontBody, true, false), color: hex(p.markerColor), maxWidth: px(18), align: 'left' });
        paragraph(page, o.x + 16, cy, o.w - 16, lh, it, { size, font: fnt, color: hex(p.style.color), align: 'left' });
        // advance by wrapped height
        const words = it.split(/\s+/); let cur = ''; let lines = 1;
        for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (fnt.widthOfTextAtSize(t, size) > px(o.w - 16) && cur) { lines++; cur = w; } else cur = t; }
        cy += Math.max(lh, lines * size * 1.3 + 6);
      });
      break;
    }
    case 'kpi': drawKpi(page, f, o, p); break;
    case 'chart': drawChart(page, f, deck, o, p.data, p.chartKind, p.title); break;
    case 'table': drawTable(page, f, deck, o, p); break;
    case 'gantt': drawGantt(page, f, o, p); break;
    case 'heatmap': drawHeatmap(page, f, o, p); break;
    case 'riskMatrix': drawRiskMatrix(page, f, o, p.rows); break;
    case 'divider': hline(page, o.x, o.y + p.thickness / 2, o.w, hex(p.color), Math.max(0.5, p.thickness * S)); break;
    case 'shape': {
      const rr = p.shape === 'ellipse';
      if (rr) {
        page.drawEllipse({ x: px(o.x + o.w / 2), y: PAGE_H - px(o.y + o.h / 2), xScale: px(o.w / 2), yScale: px(o.h / 2), color: p.box?.fill ? hex(p.box.fill) : undefined, borderColor: p.box?.border ? hex(p.box.border.color) : undefined, borderWidth: p.box?.border?.width ?? 0 });
      } else if (p.shape === 'line') {
        hline(page, o.x, o.y + o.h / 2, o.w, hex(p.box?.fill ?? DECK_THEME.rule), 1);
      } else {
        rect(page, o.x, o.y, o.w, o.h, { fill: p.box?.fill ? hex(p.box.fill) : undefined, border: p.box?.border ? hex(p.box.border.color) : undefined, borderW: p.box?.border?.width });
      }
      if (p.text && p.style) {
        const fnt = pick(f, p.style.fontFamily ?? deck.fontHeading, !!p.style.bold, !!p.style.italic);
        line(page, o.x + 2, o.y + (o.h - p.style.size) / 2, p.text, { size: p.style.size * S, font: fnt, color: hex(p.style.color), maxWidth: px(o.w - 4), align: p.style.align });
      }
      break;
    }
    case 'image': {
      rect(page, o.x, o.y, o.w, o.h, { fill: hex('#F7F9FC'), border: hex(DECK_THEME.navyLight), borderW: 1 });
      line(page, o.x, o.y + o.h / 2 - 5, p.alt || 'Image', { size: 9, font: f.sans, color: hex(DECK_THEME.slateLight), maxWidth: px(o.w), align: 'center' });
      break;
    }
    case 'unlinked': drawUnlinked(page, f, o, p.label, p.reason); break;
    default: break;
  }
}

// ── Chrome ───────────────────────────────────────────────────────────────────

function drawChrome(page: PDFPage, f: Fonts, es: ExportSlide): void {
  if (!es.chromeInfo.show) return;
  const c = es.chromeInfo;
  const grey = hex(DECK_THEME.slateLight);
  line(page, 48, 14, c.headerLeft, { size: 6.75, font: f.sans, color: grey, maxWidth: px(680), align: 'left' });
  line(page, 552, 14, c.headerRight, { size: 6.75, font: f.sans, color: grey, maxWidth: px(680), align: 'right' });
  hline(page, 48, 666, 1184, hex(DECK_THEME.rule), 0.75);
  line(page, 48, 676, c.footerLeft, { size: 6.75, font: f.sans, color: grey, maxWidth: px(900), align: 'left' });
  if (c.pageNumber !== null) line(page, 1132, 676, String(c.pageNumber), { size: 6.75, font: f.sans, color: grey, maxWidth: px(100), align: 'right' });
}

// ── Entry point ──────────────────────────────────────────────────────────────

export interface BuildDeckPdfArgs { deck: Deck; model: ICReportModel; fmt: DeckFmt }

/** Build the shareable PDF. Returns the serialized bytes. */
export async function buildDeckPdf({ deck, model, fmt }: BuildDeckPdfArgs): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f: Fonts = {
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansB: await doc.embedFont(StandardFonts.HelveticaBold),
    sansI: await doc.embedFont(StandardFonts.HelveticaOblique),
    sansBI: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifB: await doc.embedFont(StandardFonts.TimesRomanBold),
    serifI: await doc.embedFont(StandardFonts.TimesRomanItalic),
    serifBI: await doc.embedFont(StandardFonts.TimesRomanBoldItalic),
  };
  const ex = resolveDeckExport(deck, model, fmt);
  doc.setTitle(ex.title);
  doc.setProducer('Financial Modeler Pro');
  doc.setCreator('Financial Modeler Pro');

  for (const es of ex.slides) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    if (es.background && es.background !== '#FFFFFF') page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: hex(es.background) });
    drawChrome(page, f, es);
    for (const o of es.objects) {
      try { drawObject(page, f, ex, o); } catch { /* one bad object never fails the whole file */ }
    }
  }
  return doc.save();
}
