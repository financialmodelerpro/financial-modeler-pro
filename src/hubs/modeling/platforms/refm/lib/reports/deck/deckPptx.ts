/**
 * deckPptx.ts (REFM Module 7, IC Presentation Builder: the PowerPoint exporter)
 *
 * Turns the slide document into a genuinely EDITABLE .pptx. Every object lands as
 * a native PowerPoint shape, table, chart or text box at the exact position the
 * user dragged it to, because the deck's 1280 x 720 logical canvas is precisely
 * pptxgenjs's LAYOUT_WIDE (13.333in x 7.5in), so a single divide by 96 places it.
 * A reviewer opens the file and can restyle it, not just view a picture.
 *
 * It reads the SAME resolved model the canvas and the PDF exporter read
 * (resolveDeckExport), so the three surfaces cannot disagree. A binding with no
 * data becomes a visible dashed "not available" frame, never a fabricated number.
 *
 * Generated SERVER-SIDE: pptxgenjs imports node built-ins that cannot bundle for
 * the browser. The route hands us the already-assembled ICReportModel (no
 * recompute) and the money scale, exactly like the legacy report-pptx route.
 *
 * No em dashes in this file.
 */

import PptxGenJS from 'pptxgenjs';
import type { ICReportModel } from '../icReport';
import type { DeckFmt, ChartData } from './bindings';
import type { Deck, TextStyle, ShapeKind } from './types';
import { DECK_THEME, noHash, fontFor } from './theme';
import {
  resolveDeckExport, pxToInch, type ExportDeck, type ExportObject, type ExportSlide,
  type ExportPaint, type GanttPaint, type HeatmapPaint, type KpiPaint,
} from './exportModel';

const AMBER = '#B98A2E';
const AMBER_TEXT = '#8A6520';

/** px on the canvas -> points, for font sizes (LAYOUT_WIDE is 7.5in = 720px). */
const fs = (px: number): number => Math.max(6, Math.round(px * 0.75));
const inX = (px: number): number => pxToInch(px);

type Slide = PptxGenJS.Slide;

// ── Text helpers ─────────────────────────────────────────────────────────────

const alignOf = (a: TextStyle['align']): PptxGenJS.HAlign => a;
const valignOf = (v: TextStyle['valign']): PptxGenJS.VAlign => (v === 'middle' ? 'middle' : v === 'bottom' ? 'bottom' : 'top');

function textOpts(o: ExportObject, style: TextStyle, deck: ExportDeck): PptxGenJS.TextPropsOptions {
  const face = style.fontFamily ?? (style.fontRole === 'heading' ? deck.fontHeading : deck.fontBody);
  return {
    x: inX(o.x), y: inX(o.y), w: inX(o.w), h: inX(o.h),
    fontFace: face, fontSize: fs(style.size),
    bold: !!style.bold, italic: !!style.italic, underline: style.underline ? { style: 'sng' } : undefined,
    color: noHash(style.color), align: alignOf(style.align), valign: valignOf(style.valign),
    charSpacing: style.letterSpacing ? style.letterSpacing : undefined,
    lineSpacingMultiple: style.lineHeight ?? 1.3,
    margin: 0,
    isTextBox: true,
  };
}

// ── Shapes ───────────────────────────────────────────────────────────────────

function shapeTypeOf(pptx: PptxGenJS, kind: ShapeKind, hasRadius: boolean): PptxGenJS.SHAPE_NAME {
  switch (kind) {
    case 'ellipse':  return pptx.ShapeType.ellipse;
    case 'line':     return pptx.ShapeType.line;
    case 'triangle': return pptx.ShapeType.triangle;
    case 'chevron':  return pptx.ShapeType.chevron;
    default:         return hasRadius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
  }
}

// ── Chart mapping ────────────────────────────────────────────────────────────

function chartTypeOf(pptx: PptxGenJS, kind: ChartData['kind']): PptxGenJS.CHART_NAME {
  switch (kind) {
    case 'doughnut': return pptx.ChartType.doughnut;
    case 'line':     return pptx.ChartType.line;
    default:         return pptx.ChartType.bar; // column + bar + stacked + waterfall approx
  }
}

function addChart(slide: Slide, pptx: PptxGenJS, o: ExportObject, data: ChartData, kind: ChartData['kind'], title: string | null, showLegend: boolean): void {
  const box = { x: inX(o.x), y: inX(o.y), w: inX(o.w), h: inX(o.h) };
  const labels = data.labels.map(String);

  if (kind === 'doughnut') {
    const values = data.series[0]?.values.map((v) => Number(v ?? 0)) ?? [];
    slide.addChart(pptx.ChartType.doughnut, [{ name: data.series[0]?.name ?? 'Series', labels, values }], {
      ...box, holeSize: 55, showLegend, legendPos: 'b', legendFontSize: 8,
      showValue: false, dataBorder: { pt: 1, color: 'FFFFFF' },
      chartColors: (data.pointColors ?? data.series.map(() => DECK_THEME.navy)).map(noHash),
      showTitle: !!title, title: title ?? undefined, titleFontSize: 10, titleColor: noHash(DECK_THEME.slate),
    });
    return;
  }

  const chartData = data.series.map((s) => ({ name: s.name, labels, values: s.values.map((v) => Number(v ?? 0)) }));
  const single = data.series.length === 1;
  const colors = single
    ? (data.pointColors ?? [data.series[0]?.color ?? DECK_THEME.navy])
    : data.series.map((s) => s.color ?? DECK_THEME.navy);

  slide.addChart(chartTypeOf(pptx, kind), chartData, {
    ...box,
    barDir: kind === 'bar' ? 'bar' : 'col',
    barGrouping: kind === 'stackedColumn' ? 'stacked' : 'clustered',
    chartColors: colors.map(noHash),
    showLegend: showLegend && !single, legendPos: 'b', legendFontSize: 8,
    showValue: false,
    showTitle: !!title, title: title ?? undefined, titleFontSize: 10, titleColor: noHash(DECK_THEME.slate),
    catAxisLabelFontSize: 8, valAxisLabelFontSize: 8,
    catAxisLabelColor: noHash(DECK_THEME.slate), valAxisLabelColor: noHash(DECK_THEME.slate),
    valGridLine: { style: 'none' },
    valAxisLabelFormatCode: data.pctAxis ? '0%' : '#,##0',
  });
}

// ── Table mapping ────────────────────────────────────────────────────────────

function addTable(slide: Slide, o: ExportObject, deck: ExportDeck, paint: Extract<ExportPaint, { kind: 'table' }>): void {
  const d = paint.data;
  let y = o.y;
  if (paint.title) {
    slide.addText(paint.title.toUpperCase(), {
      x: inX(o.x), y: inX(o.y), w: inX(o.w), h: inX(18),
      fontFace: deck.fontBody, fontSize: fs(13), bold: true, color: noHash(DECK_THEME.slate), charSpacing: 1, margin: 0, isTextBox: true,
    });
    y += 22;
  }
  const cell = (text: string, opts: PptxGenJS.TableCellProps): PptxGenJS.TableCell => ({ text, options: opts });
  const header: PptxGenJS.TableRow = d.headers.map((hc) =>
    cell(hc.text, { fill: { color: noHash(DECK_THEME.navy) }, color: 'FFFFFF', bold: true, align: hc.align, fontSize: fs(10), valign: 'middle' }));
  const body: PptxGenJS.TableRow[] = d.rows.map((row) => row.cells.map((c) => cell(c.text, {
    color: noHash(c.color ?? (row.emphasis ? DECK_THEME.green : DECK_THEME.ink)),
    bold: !!c.bold || !!row.emphasis, align: c.align, fontSize: fs(paint.fontSize),
    fill: row.shaded ? { color: noHash(DECK_THEME.paleWash) } : row.emphasis ? { color: 'EEF3F9' } : paint.striped ? { color: 'FAFBFD' } : undefined,
    valign: 'middle',
  })));
  slide.addTable([header, ...body], {
    x: inX(o.x), y: inX(y), w: inX(o.w),
    fontFace: deck.fontBody, border: { type: 'solid', color: noHash(DECK_THEME.rule), pt: 0.5 },
    autoPage: false, valign: 'middle',
  });
}

// ── KPI tile ─────────────────────────────────────────────────────────────────

function addKpi(slide: Slide, pptx: PptxGenJS, o: ExportObject, deck: ExportDeck, k: KpiPaint): void {
  const box = { x: inX(o.x), y: inX(o.y), w: inX(o.w), h: inX(o.h) };
  if (k.fill) {
    slide.addShape(pptx.ShapeType.roundRect, { ...box, fill: { color: noHash(k.fill) }, rectRadius: 0.04, line: { type: 'none' } });
  } else {
    slide.addShape(pptx.ShapeType.roundRect, { ...box, fill: { type: 'none' }, line: { color: noHash(DECK_THEME.rule), width: 0.75 }, rectRadius: 0.04 });
  }
  const pad = 12;
  slide.addText(k.label.toUpperCase(), {
    x: inX(o.x + pad), y: inX(o.y + pad), w: inX(o.w - pad * 2), h: inX(16),
    fontFace: deck.fontBody, fontSize: fs(10), bold: true, color: noHash(k.labelColor), charSpacing: 1, valign: 'top', margin: 0, isTextBox: true,
  });
  slide.addText(k.value, {
    x: inX(o.x + pad), y: inX(o.y + pad + 18), w: inX(o.w - pad * 2), h: inX(Math.max(20, o.h - pad * 2 - 18 - (k.sub ? 14 : 0))),
    fontFace: deck.fontHeading, fontSize: fs(Math.min(30, Math.max(16, o.h * 0.34))), bold: true, color: noHash(k.valueColor), valign: 'middle', margin: 0, isTextBox: true,
  });
  if (k.sub) {
    slide.addText(k.sub, {
      x: inX(o.x + pad), y: inX(o.y + o.h - pad - 12), w: inX(o.w - pad * 2), h: inX(14),
      fontFace: deck.fontBody, fontSize: fs(10), color: noHash(k.subColor), valign: 'bottom', margin: 0, isTextBox: true,
    });
  }
}

// ── Gantt ────────────────────────────────────────────────────────────────────

function addGantt(slide: Slide, pptx: PptxGenJS, o: ExportObject, deck: ExportDeck, g: GanttPaint): void {
  const y0 = g.startYear, y1 = g.exitYear;
  const span = Math.max(1, y1 - y0);
  const labelW = 132;
  const trackW = o.w - labelW - 8;
  const xOf = (year: number): number => o.x + labelW + ((year - y0) / span) * trackW;
  const laneH = Math.min(38, Math.max(20, (o.h - 40) / Math.max(1, g.lanes.length)));
  const step = span > 14 ? 3 : span > 8 ? 2 : 1;

  for (let y = y0; y <= y1; y += step) {
    slide.addShape(pptx.ShapeType.line, { x: inX(xOf(y)), y: inX(o.y), w: 0, h: inX(o.h - 22), line: { color: noHash(DECK_THEME.rule), width: 0.5 } });
    slide.addText(String(y), { x: inX(xOf(y) - 14), y: inX(o.y - 2), w: inX(28), h: inX(12), fontFace: deck.fontBody, fontSize: fs(9), align: 'center', color: noHash(DECK_THEME.slate), margin: 0, isTextBox: true });
  }
  g.lanes.forEach((lane, i) => {
    const top = o.y + 20 + i * laneH;
    slide.addText(lane.name, { x: inX(o.x), y: inX(top), w: inX(labelW - 8), h: inX(14), fontFace: deck.fontBody, fontSize: fs(10), bold: true, color: noHash(DECK_THEME.ink), margin: 0, isTextBox: true });
    slide.addText(lane.strategies, { x: inX(o.x), y: inX(top + 13), w: inX(labelW - 8), h: inX(12), fontFace: deck.fontBody, fontSize: fs(8), color: noHash(DECK_THEME.slateLight), margin: 0, isTextBox: true });
    const cs = xOf(lane.constructionStart), ce = xOf(lane.constructionEnd + 1);
    slide.addShape(pptx.ShapeType.roundRect, { x: inX(cs), y: inX(top + 2), w: inX(Math.max(3, ce - cs)), h: inX(laneH - 14), fill: { color: noHash(DECK_THEME.navy) }, rectRadius: 0.01, line: { type: 'none' } });
    if (lane.operationsStart !== null && lane.operationsEnd !== null) {
      const os = xOf(lane.operationsStart), oe = xOf(lane.operationsEnd + 1);
      slide.addShape(pptx.ShapeType.roundRect, { x: inX(os), y: inX(top + 2), w: inX(Math.max(3, oe - os)), h: inX(laneH - 14), fill: { color: noHash(DECK_THEME.navyLight) }, rectRadius: 0.01, line: { type: 'none' } });
    }
  });
  if (g.debtRepaidYear) {
    slide.addShape(pptx.ShapeType.line, { x: inX(xOf(g.debtRepaidYear)), y: inX(o.y + 14), w: 0, h: inX(o.h - 36), line: { color: noHash(DECK_THEME.green), width: 1.5 } });
  }
  const exitX = Math.min(xOf(g.exitYear), o.x + labelW + trackW - 1);
  slide.addShape(pptx.ShapeType.line, { x: inX(exitX), y: inX(o.y + 14), w: 0, h: inX(o.h - 36), line: { color: noHash(DECK_THEME.red), width: 1.5 } });
}

// ── Heatmap ──────────────────────────────────────────────────────────────────

function addHeatmap(slide: Slide, o: ExportObject, deck: ExportDeck, hm: HeatmapPaint): void {
  slide.addText([
    { text: hm.title, options: { bold: true, color: noHash(DECK_THEME.slate) } },
  ], { x: inX(o.x), y: inX(o.y), w: inX(o.w), h: inX(16), fontFace: deck.fontBody, fontSize: fs(10), charSpacing: 1, margin: 0, isTextBox: true });

  const rows: PptxGenJS.TableRow[] = [];
  const head: PptxGenJS.TableRow = [{ text: '', options: { fill: { color: noHash(DECK_THEME.navy) } } },
    ...hm.xHeaders.map((x) => ({ text: x, options: { fill: { color: noHash(DECK_THEME.navy) }, color: 'FFFFFF', bold: true, align: 'center' as const, fontSize: fs(9) } }))];
  rows.push(head);
  hm.cells.forEach((row, ri) => {
    rows.push([
      { text: hm.yHeaders[ri] ?? '', options: { fill: { color: noHash(DECK_THEME.navy) }, color: 'FFFFFF', bold: true, align: 'right', fontSize: fs(9), valign: 'middle' } },
      ...row.map((cell) => ({ text: cell.text, options: { fill: { color: noHash(cell.fill) }, color: noHash(cell.textColor), align: 'center' as const, bold: true, fontSize: fs(9), valign: 'middle' as const } })),
    ]);
  });
  slide.addTable(rows, { x: inX(o.x), y: inX(o.y + 22), w: inX(o.w), h: inX(o.h - 26), fontFace: deck.fontBody, border: { type: 'solid', color: 'FFFFFF', pt: 1 }, autoPage: false, valign: 'middle' });
}

// ── Risk matrix ──────────────────────────────────────────────────────────────

const RISK_TONE: Record<string, string> = { Low: DECK_THEME.green, Medium: '#B98A2E', High: DECK_THEME.red };

function addRiskMatrix(slide: Slide, o: ExportObject, deck: ExportDeck, rows: { risk: string; likelihood: string; impact: string; mitigation: string }[]): void {
  const head: PptxGenJS.TableRow = ['Risk', 'Likelihood', 'Impact', 'Mitigation'].map((t) =>
    ({ text: t, options: { fill: { color: noHash(DECK_THEME.navy) }, color: 'FFFFFF', bold: true, align: 'left' as const, fontSize: fs(9) } }));
  const body: PptxGenJS.TableRow[] = rows.map((r, i) => ([
    { text: r.risk, options: { bold: true, color: noHash(DECK_THEME.ink), fontSize: fs(11), valign: 'top' as const, fill: i % 2 ? { color: 'F4F5F7' } : undefined } },
    { text: r.likelihood, options: { color: noHash(RISK_TONE[r.likelihood] ?? DECK_THEME.slate), bold: true, fontSize: fs(9), valign: 'top' as const, fill: i % 2 ? { color: 'F4F5F7' } : undefined } },
    { text: r.impact, options: { color: noHash(RISK_TONE[r.impact] ?? DECK_THEME.slate), bold: true, fontSize: fs(9), valign: 'top' as const, fill: i % 2 ? { color: 'F4F5F7' } : undefined } },
    { text: r.mitigation, options: { color: noHash(DECK_THEME.slate), fontSize: fs(11), valign: 'top' as const, fill: i % 2 ? { color: 'F4F5F7' } : undefined } },
  ]));
  slide.addTable([head, ...body], {
    x: inX(o.x), y: inX(o.y), w: inX(o.w),
    colW: [inX(o.w) * 0.30, inX(o.w) * 0.14, inX(o.w) * 0.14, inX(o.w) * 0.42],
    fontFace: deck.fontBody, border: { type: 'solid', color: noHash(DECK_THEME.rule), pt: 0.5 }, autoPage: false,
  });
}

// ── Unlinked placeholder ─────────────────────────────────────────────────────

function addUnlinked(slide: Slide, pptx: PptxGenJS, o: ExportObject, deck: ExportDeck, label: string, reason: string): void {
  const box = { x: inX(o.x), y: inX(o.y), w: inX(o.w), h: inX(o.h) };
  slide.addShape(pptx.ShapeType.roundRect, { ...box, fill: { color: 'FBF6EC' }, line: { color: noHash(AMBER), width: 1, dashType: 'dash' }, rectRadius: 0.03 });
  slide.addText([
    { text: `${label.toUpperCase()} NOT AVAILABLE\n`, options: { bold: true, fontSize: fs(10), color: noHash(AMBER_TEXT) } },
    { text: reason, options: { fontSize: fs(10), color: noHash(AMBER_TEXT) } },
  ], { ...box, fontFace: deck.fontBody, align: 'center', valign: 'middle', margin: 4, isTextBox: true });
}

// ── Object dispatch ──────────────────────────────────────────────────────────

function addObject(slide: Slide, pptx: PptxGenJS, o: ExportObject, deck: ExportDeck): void {
  const p = o.paint;
  const box = { x: inX(o.x), y: inX(o.y), w: inX(o.w), h: inX(o.h) };
  switch (p.kind) {
    case 'text': {
      if (p.box?.fill || p.box?.border) {
        slide.addShape(pptx.ShapeType.rect, { ...box, fill: p.box.fill ? { color: noHash(p.box.fill) } : { type: 'none' }, line: p.box.border ? { color: noHash(p.box.border.color), width: p.box.border.width } : { type: 'none' } });
      }
      slide.addText(p.text, textOpts(o, p.style, deck));
      break;
    }
    case 'bullets': {
      const face = p.style.fontFamily ?? (p.style.fontRole === 'heading' ? deck.fontHeading : deck.fontBody);
      const runs: PptxGenJS.TextProps[] = p.items.map((it, i) => ({
        text: it,
        options: { bullet: p.numbered ? { type: 'number' } : { code: '2022' }, color: noHash(p.style.color), breakLine: true, paraSpaceAfter: 6, ...(i === 0 ? {} : {}) },
      }));
      slide.addText(runs, { ...box, fontFace: face, fontSize: fs(p.style.size), align: alignOf(p.style.align), valign: 'top', color: noHash(p.style.color), lineSpacingMultiple: p.style.lineHeight ?? 1.4, margin: 0, isTextBox: true });
      break;
    }
    case 'kpi':      addKpi(slide, pptx, o, deck, p); break;
    case 'chart':    addChart(slide, pptx, o, p.data, p.chartKind, p.title, p.showLegend); break;
    case 'table':    addTable(slide, o, deck, p); break;
    case 'gantt':    addGantt(slide, pptx, o, deck, p); break;
    case 'heatmap':  addHeatmap(slide, o, deck, p); break;
    case 'riskMatrix': addRiskMatrix(slide, o, deck, p.rows); break;
    case 'divider':  slide.addShape(pptx.ShapeType.rect, { x: inX(o.x), y: inX(o.y), w: inX(o.w), h: Math.max(0.01, inX(p.thickness)), fill: { color: noHash(p.color) }, line: { type: 'none' } }); break;
    case 'shape': {
      const hasRadius = !!(p.box?.radius);
      const type = shapeTypeOf(pptx, p.shape, hasRadius);
      const fill = p.box?.fill ? { color: noHash(p.box.fill) } : { type: 'none' as const };
      const line = p.box?.border ? { color: noHash(p.box.border.color), width: p.box.border.width } : (p.shape === 'line' ? { color: noHash(p.box?.fill ?? DECK_THEME.rule), width: 1 } : { type: 'none' as const });
      slide.addShape(type, { ...box, fill, line, rectRadius: hasRadius ? Math.min(0.2, (p.box?.radius ?? 0) / 96) : undefined });
      if (p.text && p.style) slide.addText(p.text, { ...box, fontFace: p.style.fontFamily ?? (p.style.fontRole === 'heading' ? deck.fontHeading : deck.fontBody), fontSize: fs(p.style.size), bold: !!p.style.bold, color: noHash(p.style.color), align: alignOf(p.style.align), valign: valignOf(p.style.valign), margin: 2, isTextBox: true });
      break;
    }
    case 'image': {
      if (p.url) {
        try { slide.addImage({ ...box, path: p.url, sizing: { type: p.fit === 'contain' ? 'contain' : p.fit === 'fill' ? 'crop' : 'cover', w: inX(o.w), h: inX(o.h) } }); }
        catch { addUnlinked(slide, pptx, o, deck, 'Image', 'Image could not be embedded'); }
      } else {
        slide.addShape(pptx.ShapeType.roundRect, { ...box, fill: { color: 'F7F9FC' }, line: { color: noHash(DECK_THEME.navyLight), width: 1, dashType: 'dash' }, rectRadius: 0.03 });
        slide.addText(p.alt || 'Image', { ...box, fontFace: deck.fontBody, fontSize: fs(11), color: noHash(DECK_THEME.slateLight), align: 'center', valign: 'middle', margin: 0, isTextBox: true });
      }
      break;
    }
    case 'unlinked': addUnlinked(slide, pptx, o, deck, p.label, p.reason); break;
    default: break;
  }
}

// ── Slide chrome ─────────────────────────────────────────────────────────────

function paintChrome(slide: Slide, pptx: PptxGenJS, deck: ExportDeck, es: ExportSlide): void {
  if (!es.chromeInfo.show) return;
  const c = es.chromeInfo;
  slide.addText(c.headerLeft, { x: inX(48), y: inX(14), w: inX(700), h: inX(14), fontFace: deck.fontBody, fontSize: fs(9), color: noHash(DECK_THEME.slateLight), charSpacing: 0.4, valign: 'middle', margin: 0, isTextBox: true });
  slide.addText(c.headerRight, { x: inX(532), y: inX(14), w: inX(700), h: inX(14), fontFace: deck.fontBody, fontSize: fs(9), color: noHash(DECK_THEME.slateLight), align: 'right', valign: 'middle', margin: 0, isTextBox: true });
  slide.addShape(pptx.ShapeType.line, { x: inX(48), y: inX(666), w: inX(1184), h: 0, line: { color: noHash(DECK_THEME.rule), width: 0.75 } });
  slide.addText(c.footerLeft, { x: inX(48), y: inX(676), w: inX(900), h: inX(14), fontFace: deck.fontBody, fontSize: fs(9), color: noHash(DECK_THEME.slateLight), valign: 'middle', margin: 0, isTextBox: true });
  if (c.pageNumber !== null) {
    slide.addText(String(c.pageNumber), { x: inX(1132), y: inX(676), w: inX(100), h: inX(14), fontFace: deck.fontBody, fontSize: fs(9), color: noHash(DECK_THEME.slateLight), align: 'right', valign: 'middle', margin: 0, isTextBox: true });
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

export interface BuildDeckPptxArgs {
  deck: Deck;
  model: ICReportModel;
  fmt: DeckFmt;
}

/** Build the editable presentation. Returns the pptxgenjs instance so the caller
 *  can stream it (`.write({ outputType: 'nodebuffer' })`). */
export function buildDeckPptx({ deck, model, fmt }: BuildDeckPptxArgs): PptxGenJS {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Financial Modeler Pro';
  pptx.company = 'Financial Modeler Pro';
  pptx.title = deck.title;

  const ex = resolveDeckExport(deck, model, fmt);

  for (const es of ex.slides) {
    const slide = pptx.addSlide();
    if (es.background && es.background !== '#FFFFFF') slide.background = { color: noHash(es.background) };
    paintChrome(slide, pptx, ex, es);
    for (const o of es.objects) addObject(slide, pptx, o, ex);
    if (es.notes) slide.addNotes(es.notes);
  }

  return pptx;
}

/** For code that only wants the resolved structure without building a file. */
export { resolveDeckExport, fontFor };
