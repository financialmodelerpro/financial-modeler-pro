/**
 * buildReportPptx.ts (REFM Module 7 Reports, Phase 3a)
 *
 * ONE PPT exporter for all three report types (IC / Lender / One-Pager). It
 * renders from the SAME (report model + ReportInputs + ordered sections) pair the
 * on-screen preview uses, so the deck mirrors the preview exactly: same visible
 * sections in the same order (show/hide + reorder respected), same snapshot
 * numbers, narrative from the form. Snapshot read-only: no engine call here.
 *
 * The deck is a 16:9 editable master: a navy header band, a Table of Contents
 * slide with clickable internal links to each section, a divider slide before
 * each section, KPI tiles, and the Lender covenant heatmap (green pass / red
 * fail per period). The editable header/footer text and the chosen fonts are
 * applied. Fonts are written as NAMED faces (pptxgenjs does not embed font
 * files): PowerPoint substitutes a default face if the viewer lacks the named
 * font, so the layout is preserved and only the glyphs change.
 *
 * Returns the pptxgen instance (caller decides output: browser -> write blob,
 * Node/verifier -> write nodebuffer).
 *
 * No em dashes in this file.
 */

import PptxGenJS from 'pptxgenjs';
import { SECTIONS, icMoneyScaleSpec, type ReportType, type ReportInputs, type ICSectionKey } from '../reportInputs';
import { icSectionOmitted, icScenarioChartRows, icFindingLine, type ICReportModel } from '../reports/icReport';
import type { LenderReportModel, LenderCovenantRow } from '../reports/lenderReport';
import type { OnePagerReportModel } from '../reports/onePagerReport';
import type { CaseComparisonReport } from '../reports/caseComparisonReport';

// Brand hex WITHOUT '#', as pptxgenjs expects.
const B = { navy: '1B4F8A', white: 'FFFFFF', slate: '5A6675', pale: 'DDE7F3', mid: '7FA8D9', green: '2E7D52', red: 'DC2626', negRed: 'B23A3A', border: 'C9D8EC', ink: '1A2230', paleBg: 'EEF3FA' };
// Doughnut slice palette (brand-first, then neutral extenders).
const SLICE_COLORS = [B.navy, B.mid, B.green, B.negRed, 'B9C7DD', '3E6FA8'];

const REPORT_LABEL: Record<ReportType, string> = { ic: 'Investment Committee Report', lender: 'Lender Package', onepager: 'Investor One-Pager' };

const pct = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const mult = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? 'n/a' : `${v.toFixed(2)}x`);
const covFmt = (v: number | null, unit: 'x' | 'pct'): string => (v == null || !Number.isFinite(v) ? 'n/a' : unit === 'pct' ? pct(v) : mult(v));
// Linear blend between two 6-hex colours (t: 0 -> a, 1 -> b). Used for the
// sensitivity heatmap (red -> green through the mid).
const blend = (a: string, b: string, t: number): string => {
  const cl = Math.max(0, Math.min(1, t));
  const ai = parseInt(a, 16), bi = parseInt(b, 16);
  const mix = (sh: number): number => {
    const av = (ai >> sh) & 0xff, bv = (bi >> sh) & 0xff;
    return Math.round(av + (bv - av) * cl);
  };
  return [mix(16), mix(8), mix(0)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
};

export interface BuildReportPptxInput {
  reportType: ReportType;
  projectName: string;
  inputs: ReportInputs;
  fmt: (n: number) => string;
  currency: string;
  asOf: string;
  ic?: ICReportModel;
  lender?: LenderReportModel;
  onePager?: OnePagerReportModel;
  scenarios?: CaseComparisonReport | null;
}

const MASTER = 'FMP_MASTER';
// LAYOUT_WIDE = 13.33 x 7.5 in.
const PW = 13.33, PH = 7.5, MX = 0.5, CONTENT_Y = 1.0, CONTENT_W = PW - MX * 2;

export function buildReportPptx(input: BuildReportPptxInput): PptxGenJS {
  const { reportType, projectName, inputs, fmt, currency, asOf } = input;
  const fontBody = inputs.fontBody || 'Calibri';
  const fontHeading = inputs.fontHeading || 'Cambria';
  const reportLabel = REPORT_LABEL[reportType];

  // ── Money presentation. The snapshot holds RAW currency; the IC surfaces
  // present money at the user-selected scale (millions by default, or thousands)
  // with a single unit note, and every money CHART plots the same scale (fixes
  // the old raw "3,000,000,000" axes). Lender / One-Pager keep the passed `fmt`. ──
  const ccy = currency.match(/\b([A-Z]{3})\b/)?.[1] ?? 'SAR';
  const { divisor: MONEY_DIV, decimals: MONEY_DEC, unit: moneyUnit } = icMoneyScaleSpec(inputs.icMoneyScale, ccy);
  const MONEY_SNAP = MONEY_DEC > 0 ? 0.05 : 0.5;
  const fmtM = (v: number | null | undefined): string => {
    if (v == null || !Number.isFinite(v)) return 'n/a';
    const m = (v as number) / MONEY_DIV;
    if (Math.abs(m) < MONEY_SNAP) return (0).toFixed(MONEY_DEC);
    const s = Math.abs(m).toLocaleString('en-US', { minimumFractionDigits: MONEY_DEC, maximumFractionDigits: MONEY_DEC });
    return m < 0 ? `(${s})` : s;
  };
  // Signed money for bridge rows: negatives already carry the sign via parens.
  const sbridgeM = (v: number): string => fmtM(v);
  // Money -> scaled numeric for chart series (never raw currency on an axis).
  const toM = (arr: number[]): number[] => arr.map((v) => (Number.isFinite(v) ? v / MONEY_DIV : 0));

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Financial Modeler Pro';
  pptx.company = 'Financial Modeler Pro';
  pptx.title = `${projectName} - ${reportLabel}`;

  const headerLeft = inputs.headerText.trim() || 'Financial Modeler Pro · Strictly Private & Confidential';
  const headerRight = `${projectName} · ${reportLabel}`;
  const footerText = inputs.footerText.trim() || 'Strictly Private & Confidential';

  pptx.defineSlideMaster({
    title: MASTER,
    background: { color: B.white },
    objects: [
      { rect: { x: 0, y: 0, w: PW, h: 0.5, fill: { color: B.navy } } },
      { text: { text: headerLeft, options: { x: 0.3, y: 0, w: 8.2, h: 0.5, color: B.white, fontSize: 9, fontFace: fontBody, valign: 'middle' } } },
      { text: { text: headerRight, options: { x: 8.3, y: 0, w: 4.7, h: 0.5, color: B.white, fontSize: 9, fontFace: fontBody, align: 'right', valign: 'middle' } } },
      { line: { x: MX, y: PH - 0.35, w: CONTENT_W, h: 0, line: { color: B.border, width: 0.75 } } },
      { text: { text: footerText, options: { x: MX, y: PH - 0.33, w: 9, h: 0.3, color: B.slate, fontSize: 8, fontFace: fontBody, valign: 'middle' } } },
    ],
    slideNumber: { x: PW - 0.9, y: PH - 0.33, w: 0.6, h: 0.3, color: B.slate, fontSize: 8, fontFace: fontBody, align: 'right' },
  });

  // Ordered, visible sections; the 'cover' section (if any) is consumed by the
  // deck cover slide, so nav = everything else.
  const ordered = [...(inputs.sectionConfig[reportType] ?? [])].sort((a, b) => a.order - b.order).filter((s) => s.visible);
  const labelFor = (key: string): string => SECTIONS[reportType].find((s) => s.key === key)?.label ?? key;
  // AUTO-OMIT: for IC, drop sections whose model data is absent / trivial or whose
  // FORM field is empty (shared predicate with the preview), so the deck never
  // carries an empty tile / blank narrative slide. Filter BEFORE numbering so the
  // TOC links + dividerSlideOf indices stay consistent.
  const nav = ordered
    .filter((s) => s.key !== 'cover')
    .filter((s) => !(reportType === 'ic' && input.ic && icSectionOmitted(s.key as ICSectionKey, input.ic, inputs)));
  // Slide plan: cover=1, toc=2, then ONE content slide per nav section (no
  // standalone number-divider slides; the section number is a header chip).
  const contentSlideOf = (i: number): number => 3 + i;

  // ── heading + text helpers ──
  const heading = (slide: PptxGenJS.Slide, text: string, sub?: string): void => {
    slide.addText(text, { x: MX, y: 0.62, w: CONTENT_W, h: 0.45, fontFace: fontHeading, fontSize: 22, bold: true, color: B.navy });
    slide.addShape(pptx.ShapeType.line, { x: MX, y: 1.06, w: CONTENT_W, h: 0, line: { color: B.pale, width: 1.5 } });
    if (sub) slide.addText(sub, { x: MX, y: 0.7, w: CONTENT_W, h: 0.3, fontFace: fontBody, fontSize: 10, color: B.slate, align: 'right' });
  };
  const narrative = (slide: PptxGenJS.Slide, text: string, empty: string): void => {
    slide.addText(text.trim() || empty, { x: MX, y: CONTENT_Y + 0.3, w: CONTENT_W, h: 4.5, fontFace: fontBody, fontSize: 13, color: text.trim() ? B.ink : B.slate, italic: !text.trim(), valign: 'top', lineSpacingMultiple: 1.3 });
  };
  // KPI tiles, up to `perRow` per row, starting at (x,y) within width `w`.
  const kpiTiles = (slide: PptxGenJS.Slide, tiles: Array<{ label: string; value: string; sub?: string; good?: boolean }>, y: number, perRow = 4, x0 = MX, w0 = CONTENT_W, h = 1.05, valueFs = 20): void => {
    const gap = 0.18, w = (w0 - gap * (perRow - 1)) / perRow;
    tiles.forEach((t, i) => {
      const col = i % perRow, row = Math.floor(i / perRow);
      const x = x0 + col * (w + gap), ty = y + row * (h + gap);
      slide.addShape(pptx.ShapeType.roundRect, { x, y: ty, w, h, fill: { color: B.pale }, line: { color: B.border, width: 0.75 }, rectRadius: 0.06 });
      slide.addText(t.label.toUpperCase(), { x: x + 0.12, y: ty + 0.1, w: w - 0.24, h: 0.24, fontFace: fontBody, fontSize: h < 0.9 ? 7 : 8, bold: true, color: B.slate });
      slide.addText(t.value, { x: x + 0.12, y: ty + (h < 0.9 ? 0.3 : 0.34), w: w - 0.24, h: 0.42, fontFace: fontHeading, fontSize: valueFs, bold: true, color: t.good ? B.green : B.navy });
      if (t.sub) slide.addText(t.sub, { x: x + 0.12, y: ty + h - 0.26, w: w - 0.24, h: 0.22, fontFace: fontBody, fontSize: 7.5, color: B.slate });
    });
  };
  const factGrid = (slide: PptxGenJS.Slide, facts: Array<{ label: string; value: string }>, y: number): void => {
    const perRow = 3, gap = 0.2, w = (CONTENT_W - gap * (perRow - 1)) / perRow, h = 0.7;
    facts.forEach((f, i) => {
      const col = i % perRow, row = Math.floor(i / perRow);
      const x = MX + col * (w + gap), ty = y + row * (h + gap);
      slide.addText(f.label.toUpperCase(), { x, y: ty, w, h: 0.25, fontFace: fontBody, fontSize: 8, bold: true, color: B.slate });
      slide.addText(f.value, { x, y: ty + 0.24, w, h: 0.4, fontFace: fontBody, fontSize: 12, color: B.ink, valign: 'top' });
    });
  };
  // Period table (years as columns).
  const periodTable = (slide: PptxGenJS.Slide, yearLabels: number[], rows: Array<{ label: string; values: number[] }>, y: number): void => {
    const header = [{ text: 'Line', options: { fill: { color: B.navy }, color: B.white, bold: true, align: 'left', fontSize: 8 } },
      ...yearLabels.map((yl) => ({ text: String(yl), options: { fill: { color: B.navy }, color: B.white, bold: true, align: 'right', fontSize: 8 } }))];
    const body = rows.map((r) => [{ text: r.label, options: { align: 'left', fontSize: 8, color: B.ink } },
      ...yearLabels.map((_, i) => ({ text: fmt(r.values[i] ?? 0), options: { align: 'right', fontSize: 8, color: B.ink } }))]);
    slide.addTable([header, ...body] as PptxGenJS.TableRow[], { x: MX, y, w: CONTENT_W, border: { type: 'solid', color: B.border, pt: 0.5 }, fontFace: fontBody, autoPage: false });
  };
  // Generic data table: first header cell left-aligned, rest right; first body
  // column left, rest right. `emphasis` rows (by index) render bold navy.
  const dataTable = (slide: PptxGenJS.Slide, headers: string[], rows: string[][], y: number, emphasis: Set<number> = new Set(), fs = 9, x = MX, w = CONTENT_W, shade: Set<number> = new Set()): void => {
    const header = headers.map((t, i) => ({ text: t, options: { fill: { color: B.navy }, color: B.white, bold: true, align: (i === 0 ? 'left' : 'right') as 'left' | 'right', fontSize: fs } }));
    const body = rows.map((r, ri) => r.map((cell, ci) => ({ text: cell, options: { align: (ci === 0 ? 'left' : 'right') as 'left' | 'right', fontSize: fs, bold: emphasis.has(ri), color: emphasis.has(ri) ? B.navy : B.ink, ...(shade.has(ri) ? { fill: { color: B.paleBg } } : {}) } })));
    slide.addTable([header, ...body] as PptxGenJS.TableRow[], { x, y, w, border: { type: 'solid', color: B.border, pt: 0.5 }, fontFace: fontBody, autoPage: false });
  };
  // Bulleted / numbered narrative text block.
  const bulletList = (slide: PptxGenJS.Slide, lines: string[], y: number, numbered = false, x = MX, w = CONTENT_W, h = 4.5, fs = 12): void => {
    const runs = lines.map((t) => ({ text: t, options: { bullet: numbered ? { type: 'number' as const } : true, fontSize: fs, color: B.ink, paraSpaceAfter: 6 } }));
    slide.addText(runs as PptxGenJS.TextProps[], { x, y, w, h, fontFace: fontBody, valign: 'top', lineSpacingMultiple: 1.15 });
  };
  const sensVarLabel = (v: string): string => ({ exit_cap_rate: 'Exit cap rate', discount_rate: 'Discount rate', sales_price_pct: 'Sales price', adr_pct: 'ADR', construction_cost_pct: 'Construction cost' }[v] ?? v);
  const sensVal = (variable: string, v: number): string => (variable === 'exit_cap_rate' || variable === 'discount_rate') ? pct(v) : `${v > 0 ? '+' : ''}${pct(v)}`;

  // ── Native (editable) Office charts (Phase C). Same series + brand palette as
  // the Recharts preview. Each renders only when its section data exists. ──
  const chartAxisFont = { catAxisLabelFontFace: fontBody, catAxisLabelFontSize: 9, catAxisLabelColor: B.slate, valAxisLabelFontFace: fontBody, valAxisLabelFontSize: 9, valAxisLabelColor: B.slate };
  // BUA-by-strategy doughnut.
  const doughnutChart = (slide: PptxGenJS.Slide, rows: Array<{ strategy: string; bua: number; pct: number }>, x: number, y: number, w: number, h: number): void => {
    if (rows.length === 0) return;
    const data = [{ name: 'BUA', labels: rows.map((r) => r.strategy), values: rows.map((r) => Math.round(r.bua)) }];
    slide.addChart(pptx.ChartType.doughnut, data, {
      x, y, w, h, holeSize: 55, chartColors: SLICE_COLORS, showTitle: false,
      showLegend: true, legendPos: 'r', legendFontFace: fontBody, legendFontSize: 9,
      showValue: false, showPercent: true, dataLabelColor: B.white, dataLabelFontFace: fontBody, dataLabelFontSize: 9,
    });
  };
  // Column chart. series: one bar series each (clustered) or stacked; pctAxis
  // renders values already scaled to whole percents.
  const columnChart = (
    slide: PptxGenJS.Slide, labels: string[], series: Array<{ name: string; color: string; values: number[] }>,
    x: number, y: number, w: number, h: number, o?: { stacked?: boolean; pctAxis?: boolean; showValue?: boolean; perPointColors?: string[] },
  ): void => {
    if (labels.length === 0 || series.length === 0) return;
    const data = series.map((s) => ({ name: s.name, labels, values: s.values }));
    slide.addChart(pptx.ChartType.bar, data, {
      x, y, w, h, barDir: 'col', barGrouping: o?.stacked ? 'stacked' : 'clustered',
      chartColors: o?.perPointColors ?? series.map((s) => s.color), showTitle: false, ...chartAxisFont,
      showLegend: series.length > 1, legendPos: 'b', legendFontFace: fontBody, legendFontSize: 9,
      valAxisLabelFormatCode: o?.pctAxis ? '0"%"' : '#,##0',
      showValue: !!o?.showValue, dataLabelFontFace: fontBody, dataLabelFontSize: 8, dataLabelColor: B.ink,
      dataLabelFormatCode: o?.pctAxis ? '0.0"%"' : '#,##0',
    });
  };
  // Line chart (single series).
  const lineChart = (slide: PptxGenJS.Slide, labels: string[], name: string, values: number[], x: number, y: number, w: number, h: number, formatCode: string): void => {
    if (labels.length === 0) return;
    slide.addChart(pptx.ChartType.line, [{ name, labels, values }], {
      x, y, w, h, chartColors: [B.navy], lineSize: 2, lineSmooth: false, showTitle: false, showLegend: false, ...chartAxisFont,
      valAxisLabelFormatCode: formatCode, showValue: true, dataLabelFontFace: fontBody, dataLabelFontSize: 8, dataLabelColor: B.navy, dataLabelFormatCode: formatCode, dataLabelPosition: 't',
    });
  };
  // Development-programme Gantt via positioned rectangles (not a native chart type).
  const programmeGantt = (slide: PptxGenJS.Slide, prog: ICReportModel['programme'], x: number, y: number, w: number, h: number): void => {
    const { startYear, exitYear, lanes, debtRepaidYear } = prog;
    if (lanes.length === 0 || exitYear < startYear) return;
    const years: number[] = [];
    for (let yr = startYear; yr <= exitYear; yr++) years.push(yr);
    const nY = years.length;
    const labelW = 1.6, gridX = x + labelW, gridW = w - labelW, colW = gridW / nY;
    const headerH = 0.24, rowH = Math.min(0.3, (h - headerH) / Math.max(1, lanes.length));
    // Year headers + markers.
    years.forEach((yr, i) => {
      const mk = yr === exitYear ? 'exit' : yr === debtRepaidYear ? 'debt' : null;
      slide.addText(String(yr), { x: gridX + i * colW, y, w: colW, h: headerH, align: 'center', fontFace: fontBody, fontSize: 8, bold: !!mk, color: mk === 'exit' ? B.green : mk === 'debt' ? B.navy : B.slate });
    });
    lanes.forEach((lane, li) => {
      const ry = y + headerH + li * rowH;
      slide.addText(lane.name, { x, y: ry, w: labelW - 0.05, h: rowH, fontFace: fontBody, fontSize: 8, bold: true, color: B.navy, valign: 'middle' });
      years.forEach((yr, i) => {
        const inC = yr >= lane.constructionStart && yr <= lane.constructionEnd;
        const inO = lane.operationsStart != null && yr >= lane.operationsStart && yr <= (lane.operationsEnd ?? exitYear);
        const fill = inC ? B.navy : inO ? B.green : B.paleBg;
        slide.addShape(pptx.ShapeType.roundRect, { x: gridX + i * colW + 0.02, y: ry + 0.03, w: colW - 0.04, h: rowH - 0.06, fill: { color: fill }, line: { color: B.white, width: 0.5 }, rectRadius: 0.02 });
      });
    });
    // Legend.
    const ly = y + headerH + lanes.length * rowH + 0.08;
    slide.addShape(pptx.ShapeType.rect, { x, y: ly + 0.02, w: 0.16, h: 0.12, fill: { color: B.navy } });
    slide.addText('Construction', { x: x + 0.2, y: ly, w: 1.5, h: 0.18, fontFace: fontBody, fontSize: 8, color: B.slate });
    slide.addShape(pptx.ShapeType.rect, { x: x + 1.7, y: ly + 0.02, w: 0.16, h: 0.12, fill: { color: B.green } });
    slide.addText('Operations', { x: x + 1.9, y: ly, w: 1.4, h: 0.18, fontFace: fontBody, fontSize: 8, color: B.slate });
    const markerNote = [debtRepaidYear != null ? `Debt repaid ${debtRepaidYear}` : '', `Exit ${exitYear}`].filter(Boolean).join('   ');
    slide.addText(markerNote, { x: x + 3.3, y: ly, w: w - 3.3, h: 0.18, fontFace: fontBody, fontSize: 8, bold: true, color: B.navy });
  };

  // ── Composition primitives (spec: build once, reuse across every section) ──
  const CH_TOP = CONTENT_Y + 0.35; // first content baseline, below the section header.
  // Section header: navy number chip + Cambria title + italic finding subtitle.
  const sectionHeader = (slide: PptxGenJS.Slide, num: string, title: string, finding: string, unitNote?: string): void => {
    slide.addShape(pptx.ShapeType.roundRect, { x: MX, y: 0.62, w: 0.5, h: 0.5, fill: { color: B.navy }, rectRadius: 0.05 });
    slide.addText(num, { x: MX, y: 0.62, w: 0.5, h: 0.5, align: 'center', valign: 'middle', fontFace: fontHeading, fontSize: 16, bold: true, color: B.white });
    slide.addText(title, { x: MX + 0.65, y: 0.58, w: CONTENT_W - 0.65, h: 0.36, fontFace: fontHeading, fontSize: 20, bold: true, color: B.navy });
    if (finding) slide.addText(finding, { x: MX + 0.65, y: 0.95, w: CONTENT_W - 0.65 - (unitNote ? 1.8 : 0), h: 0.28, fontFace: fontBody, fontSize: 10.5, italic: true, color: B.slate, valign: 'top' });
    if (unitNote) slide.addText(unitNote, { x: PW - MX - 1.7, y: 0.95, w: 1.7, h: 0.24, fontFace: fontBody, fontSize: 8, color: B.slate, align: 'right' });
    slide.addShape(pptx.ShapeType.line, { x: MX, y: 1.28, w: CONTENT_W, h: 0, line: { color: B.pale, width: 1.25 } });
  };
  // Reading / caption block: small uppercase heading + body (pale by default).
  const captionBlock = (slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number, headingText: string, body: string, opt?: { variant?: 'pale' | 'navy' | 'green'; fill?: boolean }): void => {
    const variant = opt?.variant ?? 'pale';
    const filled = opt?.fill ?? (variant !== 'pale');
    const bg = variant === 'navy' ? B.navy : variant === 'green' ? B.green : B.paleBg;
    const headColor = variant === 'pale' ? B.slate : B.white;
    const bodyColor = variant === 'pale' ? B.ink : B.white;
    if (filled || variant === 'pale') slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, fill: { color: bg }, line: { color: variant === 'pale' ? B.border : bg, width: 0.75 }, rectRadius: 0.05 });
    if (headingText) slide.addText(headingText.toUpperCase(), { x: x + 0.16, y: y + 0.12, w: w - 0.32, h: 0.24, fontFace: fontBody, fontSize: 8.5, bold: true, color: variant === 'pale' ? B.slate : headColor, charSpacing: 1 });
    slide.addText(body, { x: x + 0.16, y: y + (headingText ? 0.4 : 0.14), w: w - 0.32, h: h - (headingText ? 0.5 : 0.24), fontFace: fontBody, fontSize: 10.5, color: bodyColor, valign: 'top', lineSpacingMultiple: 1.2 });
  };
  // Callout box: bold lead line + body, navy / green / pale.
  const calloutBox = (slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number, lead: string, body: string, variant: 'navy' | 'green' | 'pale' = 'navy'): void => {
    const bg = variant === 'navy' ? B.navy : variant === 'green' ? B.green : B.paleBg;
    const fg = variant === 'pale' ? B.navy : B.white;
    const bodyFg = variant === 'pale' ? B.ink : B.white;
    slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, fill: { color: bg }, line: { color: bg, width: 0.5 }, rectRadius: 0.06 });
    slide.addText(lead, { x: x + 0.2, y: y + 0.14, w: w - 0.4, h: 0.3, fontFace: fontHeading, fontSize: 13, bold: true, color: fg });
    if (body) slide.addText(body, { x: x + 0.2, y: y + 0.5, w: w - 0.4, h: h - 0.62, fontFace: fontBody, fontSize: 10.5, color: bodyFg, valign: 'top', lineSpacingMultiple: 1.2 });
  };
  // Phase card: navy header (name + window) + asset bullets + pale footer tile.
  const phaseCard = (slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number, name: string, window: string, assetNames: string[], footLabel: string, footValue: string): void => {
    slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, fill: { color: B.white }, line: { color: B.border, width: 1 }, rectRadius: 0.05 });
    slide.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.62, fill: { color: B.navy } });
    slide.addText(name, { x: x + 0.14, y: y + 0.06, w: w - 0.28, h: 0.3, fontFace: fontHeading, fontSize: 13, bold: true, color: B.white });
    slide.addText(window, { x: x + 0.14, y: y + 0.35, w: w - 0.28, h: 0.24, fontFace: fontBody, fontSize: 8.5, color: B.pale });
    const bullets = assetNames.slice(0, 6).map((n) => ({ text: n, options: { bullet: true, fontSize: 9.5, color: B.ink, paraSpaceAfter: 3 } }));
    if (bullets.length) slide.addText(bullets as PptxGenJS.TextProps[], { x: x + 0.18, y: y + 0.72, w: w - 0.32, h: h - 1.5, fontFace: fontBody, valign: 'top' });
    slide.addShape(pptx.ShapeType.rect, { x: x + 0.12, y: y + h - 0.66, w: w - 0.24, h: 0.54, fill: { color: B.paleBg } });
    slide.addText(footLabel.toUpperCase(), { x: x + 0.2, y: y + h - 0.62, w: w - 0.4, h: 0.2, fontFace: fontBody, fontSize: 7.5, bold: true, color: B.slate });
    slide.addText(footValue, { x: x + 0.2, y: y + h - 0.42, w: w - 0.4, h: 0.3, fontFace: fontHeading, fontSize: 13, bold: true, color: B.navy });
  };
  // Risk card: numbered navy badge + Cambria title + green "Mitigant:" line.
  const riskCard = (slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number, n: number, title: string, mitigant: string): void => {
    slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, fill: { color: B.white }, line: { color: B.border, width: 1 }, rectRadius: 0.05 });
    slide.addShape(pptx.ShapeType.roundRect, { x: x + 0.14, y: y + 0.14, w: 0.34, h: 0.34, fill: { color: B.navy }, rectRadius: 0.04 });
    slide.addText(String(n), { x: x + 0.14, y: y + 0.14, w: 0.34, h: 0.34, align: 'center', valign: 'middle', fontFace: fontHeading, fontSize: 12, bold: true, color: B.white });
    slide.addText(title, { x: x + 0.58, y: y + 0.14, w: w - 0.72, h: 0.5, fontFace: fontHeading, fontSize: 11.5, bold: true, color: B.navy, valign: 'top' });
    if (mitigant) slide.addText([{ text: 'Mitigant: ', options: { bold: true, color: B.green } }, { text: mitigant, options: { color: B.ink } }] as PptxGenJS.TextProps[], { x: x + 0.18, y: y + 0.66, w: w - 0.36, h: h - 0.78, fontFace: fontBody, fontSize: 9.5, valign: 'top', lineSpacingMultiple: 1.15 });
  };
  // ── Cover slide (deck level) ──
  const cover = pptx.addSlide();
  cover.background = { color: B.navy };
  const coverLoc = reportType === 'onepager' ? (input.onePager?.dealAtAGlance.location ?? '') : reportType === 'lender' ? (input.lender?.cover.location ?? '') : (input.ic?.cover.location ?? '');
  if (reportType === 'ic' && input.ic) {
    // Transaction-summary cover: KPI wall of returns + economics.
    const m = input.ic;
    const darkTile = '0D2E5A';
    // Cover KPI tile on the navy field.
    const coverTile = (x: number, y: number, w: number, label: string, value: string, good?: boolean): void => {
      cover.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 1.0, fill: { color: darkTile }, line: { color: '1E4A82', width: 0.75 }, rectRadius: 0.06 });
      cover.addText(label.toUpperCase(), { x: x + 0.12, y: y + 0.12, w: w - 0.24, h: 0.22, fontFace: fontBody, fontSize: 7.5, bold: true, color: B.mid, charSpacing: 1 });
      cover.addText(value, { x: x + 0.12, y: y + 0.36, w: w - 0.24, h: 0.5, fontFace: fontHeading, fontSize: 21, bold: true, color: good ? '7FD1A3' : B.white });
    };
    cover.addText(reportLabel.toUpperCase(), { x: 0.7, y: 0.55, w: 11.9, h: 0.35, fontFace: fontBody, fontSize: 12, color: B.mid, charSpacing: 3 });
    cover.addText(projectName || 'Untitled Project', { x: 0.7, y: 0.95, w: 11.9, h: 0.9, fontFace: fontHeading, fontSize: 34, bold: true, color: B.white });
    cover.addText(coverLoc || 'Location not set', { x: 0.7, y: 1.82, w: 11.9, h: 0.35, fontFace: fontBody, fontSize: 14, color: B.pale });
    const o = m.overview;
    cover.addText(`${o.phaseCount} ${o.phaseCount === 1 ? 'phase' : 'phases'}  ·  ${o.strategyMix || 'mixed-use'}  ·  ${o.startYear} to ${o.exitYear} (${o.durationYears}-yr hold)  ·  ${o.fundingMethodLabel}`,
      { x: 0.7, y: 2.2, w: 11.9, h: 0.32, fontFace: fontBody, fontSize: 11, color: B.mid });
    // Row 1: 5 return tiles.
    const h = m.headline;
    const r1 = [
      { label: 'Project IRR', value: pct(h.projectIrr), good: true }, { label: 'Equity IRR', value: pct(h.equityIrr), good: true },
      { label: 'Distributed IRR', value: pct(h.distributedEquityIrr) }, { label: 'Equity Multiple', value: mult(h.equityMultiple) }, { label: 'Equity MOIC', value: mult(h.equityMoic) },
    ];
    const gap = 0.22, w5 = (11.93 - gap * 4) / 5;
    r1.forEach((t, i) => coverTile(0.7 + i * (w5 + gap), 2.72, w5, t.label, t.value, t.good));
    // Row 2: 4 economics tiles.
    const d = m.devEconomics;
    const r2 = [
      { label: `GDV (${moneyUnit})`, value: fmtM(d.gdv) }, { label: `Total Dev Cost (${moneyUnit})`, value: fmtM(d.tdc) },
      { label: `Peak Debt (${moneyUnit})`, value: fmtM(m.capital.peakDebt) }, { label: 'Development Margin', value: pct(d.developmentMargin), good: (d.developmentMargin ?? 0) >= 0 },
    ];
    const w4 = (11.93 - gap * 3) / 4;
    r2.forEach((t, i) => coverTile(0.7 + i * (w4 + gap), 3.9, w4, t.label, t.value, t.good));
    // Recommendation strip (green accent).
    const recLead = inputs.recommendation.trim().split(/(?<=\.)\s/)[0] || 'Recommendation: proceed to approval.';
    cover.addShape(pptx.ShapeType.rect, { x: 0.7, y: 5.2, w: 11.93, h: 0.7, fill: { color: B.green } });
    cover.addText(recLead, { x: 0.9, y: 5.2, w: 11.5, h: 0.7, fontFace: fontHeading, fontSize: 15, bold: true, color: B.white, valign: 'middle' });
    // Prepared-for + confidentiality.
    const prep = m.cover.preparedBy.length ? `Prepared by ${m.cover.preparedBy.map((p) => p.name).join(', ')}` : '';
    cover.addText([prep, `As of ${asOf}`].filter(Boolean).join('   ·   '), { x: 0.7, y: 6.15, w: 11.9, h: 0.3, fontFace: fontBody, fontSize: 10, color: B.pale });
    cover.addText('Strictly Private & Confidential. For the intended recipient only.', { x: 0.7, y: 6.95, w: 11.9, h: 0.3, fontFace: fontBody, fontSize: 9, color: B.mid });
  } else {
    cover.addText(reportLabel.toUpperCase(), { x: 0.7, y: 1.6, w: 11.9, h: 0.4, fontFace: fontBody, fontSize: 13, color: B.mid, charSpacing: 3 });
    cover.addText(projectName || 'Untitled Project', { x: 0.7, y: 2.1, w: 11.9, h: 1.1, fontFace: fontHeading, fontSize: 40, bold: true, color: B.white });
    cover.addText(coverLoc || 'Location not set', { x: 0.7, y: 3.2, w: 11.9, h: 0.5, fontFace: fontBody, fontSize: 16, color: B.pale });
    cover.addText(`As of ${asOf}`, { x: 0.7, y: 4.0, w: 6, h: 0.4, fontFace: fontBody, fontSize: 12, color: B.pale });
    cover.addText('Strictly Private & Confidential. For the intended recipient only.', { x: 0.7, y: 6.5, w: 11.9, h: 0.4, fontFace: fontBody, fontSize: 10, color: B.mid });
  }

  // Scenario KPI matrix helper (shared by the cases + economics IC sections).
  // Declared before the render loop so it is initialized when renderIC runs.
  const scenarioTable = (c: PptxGenJS.Slide, labels: string[], y: number, x = MX, w = CONTENT_W, fs = 9): void => {
    const sc = input.scenarios;
    if (!sc) return;
    const kdef = (label: string) => sc.kpis.find((k) => k.label === label);
    const fk = (v: number | null | undefined, kind?: string): string => (v == null || !Number.isFinite(v)) ? 'n/a' : kind === 'pct' ? pct(v) : kind === 'mult' ? mult(v) : fmtM(v);
    const headers = ['Metric', ...sc.columns.map((col) => `${col.role === 'base' ? '★ ' : ''}${col.name}`)];
    const rows = labels.map((label) => [label, ...sc.columns.map((col) => fk(col.values[label], kdef(label)?.kind))]);
    // Shade the base (Management) column? Table cell shading is per-row; instead
    // mark the base with a star in the header (above) and shade nothing here.
    dataTable(c, headers, rows, y, new Set(), fs, x, w);
  };
  // "What drives each case": union of override labels across non-base columns.
  const buildDriverRows = (sc: CaseComparisonReport): { headers: string[]; rows: string[][] } => {
    const base = sc.columns.find((col) => col.role === 'base');
    const nonBase = sc.columns.filter((col) => col.role !== 'base');
    const labels: string[] = [];
    for (const col of nonBase) for (const dr of col.drivers) if (!labels.includes(dr.label)) labels.push(dr.label);
    if (labels.length === 0) return { headers: [], rows: [] };
    const headers = ['Assumption', base ? base.name : 'Base', ...nonBase.map((col) => col.name)];
    const rows = labels.map((label) => {
      const baseVal = nonBase.map((col) => col.drivers.find((dr) => dr.label === label)?.base).find((v) => v != null) ?? '-';
      return [label, baseVal, ...nonBase.map((col) => col.drivers.find((dr) => dr.label === label)?.value ?? '-')];
    });
    return { headers, rows };
  };

  // ── Table of Contents (clickable internal links) ──
  const toc = pptx.addSlide({ masterName: MASTER });
  heading(toc, 'Contents');
  nav.forEach((sec, i) => {
    const y = CONTENT_Y + 0.3 + i * 0.5;
    const num = String(i + 1).padStart(2, '0');
    const link = { slide: contentSlideOf(i), tooltip: labelFor(sec.key) };
    // The hyperlink must sit on the text RUNS (not the box options) for pptxgenjs
    // to emit the internal slide relationship, so both runs carry it.
    toc.addText(
      [{ text: `${num}   `, options: { color: B.mid, bold: true, hyperlink: link } }, { text: labelFor(sec.key), options: { color: B.navy, hyperlink: link } }],
      { x: MX, y, w: CONTENT_W, h: 0.42, fontFace: fontBody, fontSize: 14, valign: 'middle' },
    );
  });

  // ── Content slides (one per section; no divider slides) ──
  nav.forEach((sec, i) => {
    const num = String(i + 1).padStart(2, '0');
    const c = pptx.addSlide({ masterName: MASTER });
    if (reportType === 'ic') renderIC(c, sec.key, num);
    else if (reportType === 'lender') { heading(c, `${num}  ${labelFor(sec.key)}`); renderLender(c, sec.key); }
    else { heading(c, `${num}  ${labelFor(sec.key)}`); renderOnePager(c, sec.key); }
  });

  // ── IC content (composed IC-grade layout, spec-driven) ──
  function renderIC(c: PptxGenJS.Slide, key: string, num: string): void {
    const m = input.ic!;
    const o = m.overview, h = m.headline, d = m.devEconomics;
    const title = labelFor(key);
    const finding = icFindingLine(key as ICSectionKey, m, inputs, { money: fmtM, pct, mult });
    const H = (unit?: string): void => sectionHeader(c, num, title, finding, unit);
    const unitM = `All figures in ${moneyUnit}`;
    const Y = CH_TOP; // first content baseline (1.35)

    switch (key as ICSectionKey) {
      case 'executive_summary': {
        const finding = `Prime ${o.strategyMix || 'mixed-use'} development; ${pct(h.equityIrr)} equity IRR and ${mult(h.equityMultiple)} equity multiple over a ${o.durationYears}-year hold.`;
        H();
        const points = inputs.execPoints.length
          ? inputs.execPoints.map((p) => (p.title ? `${p.title}. ${p.body}` : p.body))
          : (inputs.executiveSummary.trim() ? inputs.executiveSummary.split(/(?<=\.)\s+/).filter(Boolean) : [finding]);
        bulletList(c, points, Y + 0.1, true, MX, 7.1, 5.4, 12.5);
        const rx = MX + 7.5, rw = CONTENT_W - 7.5;
        kpiTiles(c, [
          { label: 'Project IRR', value: pct(h.projectIrr), good: true }, { label: 'Equity IRR', value: pct(h.equityIrr), good: true },
          { label: 'Distributed IRR', value: pct(h.distributedEquityIrr) }, { label: 'Equity Multiple', value: mult(h.equityMultiple) },
          { label: 'Yield on Cost', value: pct(m.reMetrics.yieldOnCost) }, { label: 'Cap Rate at Exit', value: pct(m.reMetrics.capRateAtExit) },
        ], Y + 0.1, 2, rx, rw, 0.78, 15);
        const ecoY = Y + 0.1 + 3 * (0.78 + 0.18) + 0.05;
        calloutBox(c, rx, ecoY, rw, 1.5, `Development Economics (${moneyUnit})`,
          `GDV ${fmtM(d.gdv)}    ·    TDC ${fmtM(d.tdc)}\nProfit after financing ${fmtM(d.profitAfterFinancing)}\nDevelopment margin ${pct(d.developmentMargin)}`, 'navy');
        break;
      }
      case 'investment_recommendation': {
        const a = m.ask;
        H(unitM);
        kpiTiles(c, [
          { label: 'Equity Commitment', value: fmtM(a.equityCommitment), sub: `existing ${fmtM(a.existingEquity)} + in-kind ${fmtM(a.inKindEquity)}` },
          { label: 'Senior Debt (peak)', value: a.peakDebt > 0.5 ? fmtM(a.peakDebt) : 'None', sub: a.peakDebt > 0.5 ? `existing ${fmtM(a.existingDebt)} + new ${fmtM(a.newDebt)}` : 'ungeared' },
          { label: 'Target Returns', value: `${pct(a.projectIrr)} / ${pct(a.equityIrr)}`, sub: `Project / Equity IRR · ${mult(a.equityMoic)} MOIC`, good: true },
        ], Y + 0.1, 3);
        const recFull = inputs.recommendation.trim();
        const lead = recFull ? recFull.split(/(?<=\.)\s/)[0] : 'Proceed to approval.';
        const body = recFull ? recFull.slice(lead.length).trim() : `The transaction meets the fund's return threshold with a robust downside. Management recommends the Committee approve the equity commitment and senior debt facility as set out above.`;
        calloutBox(c, MX, Y + 1.5, CONTENT_W, 2.4, lead, body, 'green');
        break;
      }
      case 'project_overview': {
        H();
        kpiTiles(c, [
          { label: 'Location', value: [o.location, o.country].filter(Boolean).join(', ') || 'n/a' },
          { label: 'Land area', value: o.landAreaSqm > 0 ? `${o.landAreaSqm.toLocaleString()} sqm` : 'n/a' },
          { label: 'Built-up area', value: o.totalBua > 0 ? `${Math.round(o.totalBua).toLocaleString()} sqm` : 'n/a' },
          { label: 'Strategy mix', value: o.strategyMix || 'n/a' },
          { label: 'Model horizon', value: `${o.startYear} to ${o.exitYear} (${o.durationYears} yrs)` },
          { label: 'Funding', value: o.fundingMethodLabel },
        ], Y + 0.1, 3, MX, CONTENT_W, 0.95, 12);
        if (inputs.developmentConcept.trim()) calloutBox(c, MX, Y + 2.35, CONTENT_W, 2.35, 'Development Concept', inputs.developmentConcept.trim(), 'navy');
        else {
          const lines = [o.sponsors.length ? `Sponsor: ${o.sponsors.map((p) => p.name).join(', ')}` : '', o.developers.length ? `Developer: ${o.developers.map((p) => p.name).join(', ')}` : '', o.investors.length ? `Investors: ${o.investors.map((p) => p.name).join(', ')}` : ''].filter(Boolean);
          if (lines.length) captionBlock(c, MX, Y + 2.35, CONTENT_W, 1.1, 'Parties', lines.join('     ·     '));
        }
        break;
      }
      case 'master_plan': {
        H(unitM);
        const ph = m.phasing.slice(0, 4), n = ph.length || 1, gap = 0.25, cw = (CONTENT_W - gap * (n - 1)) / n;
        ph.forEach((p, i) => phaseCard(c, MX + i * (cw + gap), Y + 0.1, cw, 4.55, p.name,
          p.startYear ? `From ${p.startYear}${p.strategies ? ` · ${p.strategies}` : ''}` : (p.strategies || ''), p.assetNames, `Phase capex (${moneyUnit})`, fmtM(p.capex)));
        break;
      }
      case 'asset_mix': {
        H();
        dataTable(c, ['Asset', 'Strategy', 'Phase', 'BUA', 'Units'],
          [...m.assetMix.rows.map((r) => [r.name, r.strategy, r.phaseName || '-', r.bua > 0 ? Math.round(r.bua).toLocaleString() : '-', r.units > 0 ? String(r.units) : '-']),
            ['Total', '', '', Math.round(m.assetMix.totalBua).toLocaleString(), String(m.assetMix.totalUnits)]],
          Y + 0.1, new Set([m.assetMix.rows.length]), 9, MX, 6.7);
        doughnutChart(c, m.assetMix.byStrategy, MX + 7.0, Y + 0.1, 5.3, 2.7);
        captionBlock(c, MX + 7.0, Y + 2.95, 5.3, 1.8, 'Reading the mix',
          `${m.assetMix.byStrategy.map((s) => `${s.strategy} ${pct(s.pct)}`).join(', ')}. The blend balances near-term sales cash against recurring operating income.`);
        break;
      }
      case 'market_context': {
        const mc = inputs.marketContext;
        H();
        if (mc.points.length) bulletList(c, mc.points.map((p) => (p.title ? `${p.title}. ${p.body}` : p.body)), Y + 0.1, true, MX, 7.3, 4.9, 12.5);
        if (mc.stats.length) kpiTiles(c, mc.stats.map((s) => ({ label: s.label, value: s.value })), Y + 0.1, 1, MX + 7.7, CONTENT_W - 7.7, 1.25, 17);
        if (mc.sourcesNote.trim()) c.addText(mc.sourcesNote, { x: MX, y: PH - 0.7, w: CONTENT_W, h: 0.3, fontFace: fontBody, fontSize: 8.5, italic: true, color: B.slate });
        break;
      }
      case 'development_programme': {
        H();
        programmeGantt(c, m.programme, MX, Y + 0.2, CONTENT_W, 3.1);
        if (inputs.keyGates.trim()) captionBlock(c, MX, PH - 1.85, CONTENT_W, 1.55, 'Key gates', inputs.keyGates.trim());
        else captionBlock(c, MX, PH - 1.55, CONTENT_W, 1.2, 'Reading the timeline',
          `Phases overlap so operating cash from early assets funds later construction; debt is retired ${m.programme.debtRepaidYear ? `by ${m.programme.debtRepaidYear}` : 'over the hold'} ahead of the ${o.exitYear} exit.`);
        break;
      }
      case 'development_costs': {
        const cs = m.charts.costStack;
        H(unitM);
        columnChart(c, ['Development cost', 'Financing'],
          [{ name: 'Land', color: B.mid, values: toM([cs.land, 0]) }, { name: 'Construction', color: B.navy, values: toM([cs.construction, 0]) }, { name: 'Financing', color: B.negRed, values: toM([0, cs.financing]) }],
          MX, Y + 0.2, 6.0, 4.3, { stacked: true });
        dataTable(c, ['Cost stack', moneyUnit], m.costStack.map((r) => [r.label, sbridgeM(r.value)]), Y + 0.1, new Set(m.costStack.map((r, i) => (r.emphasis ? i : -1)).filter((i) => i >= 0)), 10, MX + 6.4, 5.9);
        calloutBox(c, MX + 6.4, Y + 2.7, 5.9, 1.9, 'Cost efficiency',
          `Profit on cost of ${pct(m.reMetrics.profitOnCost)}${d.costToValue != null ? ` and a cost-to-value ratio of ${pct(d.costToValue)}` : ''} leaves headroom against construction inflation.`, 'navy');
        break;
      }
      case 'value_economics': {
        H(unitM);
        kpiTiles(c, [
          { label: 'GDV', value: fmtM(d.gdv) }, { label: 'Profit before Fin.', value: fmtM(d.profitBeforeFinancing), good: d.profitBeforeFinancing >= 0 },
          { label: 'Profit after Fin.', value: fmtM(d.profitAfterFinancing), good: d.profitAfterFinancing >= 0 }, { label: 'Dev Margin', value: pct(d.developmentMargin), good: (d.developmentMargin ?? 0) >= 0 },
          { label: 'Profit on Cost', value: pct(m.reMetrics.profitOnCost) },
        ], Y + 0.1, 5, MX, CONTENT_W, 0.95, 16);
        dataTable(c, ['Value bridge', moneyUnit], m.valueBridge.map((r) => [r.label, sbridgeM(r.value)]), Y + 1.25, new Set(m.valueBridge.map((r, i) => (r.emphasis ? i : -1)).filter((i) => i >= 0)), 9, MX, 6.0);
        const rr = m.charts.revenueRecognition;
        if (rr.hasData) {
          columnChart(c, rr.yearLabels.map(String),
            [{ name: 'Sales', color: B.navy, values: toM(rr.sales) }, { name: 'Hospitality', color: B.mid, values: toM(rr.hospitality) }, { name: 'Retail', color: B.green, values: toM(rr.retail) }],
            MX + 6.4, Y + 1.25, 5.9, 3.0, { stacked: true });
          captionBlock(c, MX + 6.4, Y + 4.35, 5.9, 1.0, 'Revenue recognition',
            'Sales cash front-loads the plan while hospitality and retail build a recurring income base toward exit.');
        } else {
          captionBlock(c, MX + 6.4, Y + 1.25, 5.9, 2.0, 'Reading the bridge',
            `Development profit of ${fmtM(d.profitAfterFinancing)} ${moneyUnit} survives financing costs of ${fmtM(d.financingCost)}.`);
        }
        break;
      }
      case 'sources_uses': {
        const su = m.sourcesUses;
        H(unitM);
        const srcRows = su.sources.filter((r) => Math.abs(r.value) > 0.5).map((r) => [r.label, fmtM(r.value)]);
        srcRows.push(['Total sources', fmtM(su.totalSources)]);
        const useRows = su.uses.filter((r) => Math.abs(r.value) > 0.5).map((r) => [r.label, fmtM(r.value)]);
        useRows.push(['Total uses', fmtM(su.totalUses)]);
        dataTable(c, ['Sources', moneyUnit], srcRows, Y + 0.1, new Set([srcRows.length - 1]), 10, MX, 5.9);
        dataTable(c, ['Uses', moneyUnit], useRows, Y + 0.1, new Set([useRows.length - 1]), 10, MX + 6.4, 5.9);
        calloutBox(c, MX, PH - 1.75, CONTENT_W, 1.4, 'How the funding works',
          `Equity and senior debt fund the peak cash deficit; customer collections and operating cash progressively refill the balance, so senior debt draws stay within the ${fmtM(m.financing.peakDebt)} ${moneyUnit} peak.`, 'pale');
        break;
      }
      case 'financing_structure': {
        const f = m.financing;
        H(unitM);
        const db = m.charts.debtBalance;
        if (db.hasData) columnChart(c, db.yearLabels.map(String), [{ name: 'Debt outstanding', color: B.navy, values: toM(db.values) }], MX, Y + 0.2, 6.0, 4.2);
        kpiTiles(c, [
          { label: 'Funding method', value: f.fundingMethodLabel }, { label: 'Existing debt', value: fmtM(f.existingDebt) },
          { label: 'New debt', value: fmtM(f.newDebt) }, { label: 'Peak debt', value: fmtM(f.peakDebt) },
          { label: 'Tenor', value: f.tenorYears == null ? 'n/a' : `${f.tenorYears} yrs` }, { label: 'Debt at exit', value: fmtM(f.remainingDebtAtExit) },
        ], Y + 0.1, 2, MX + 6.4, 5.9, 0.85, 13);
        calloutBox(c, MX + 6.4, Y + 3.05, 5.9, 1.55, 'De-levering profile',
          `The facility amortises from cash sweep${f.paydownPct != null ? `, retiring ${pct(f.paydownPct)} of peak debt before exit` : ' across the hold'} and lifting equity returns.`, 'navy');
        break;
      }
      case 'returns_analysis': {
        const re = m.reMetrics;
        H();
        kpiTiles(c, [
          { label: 'Project IRR', value: pct(h.projectIrr), sub: 'unlevered', good: true }, { label: 'Equity IRR', value: pct(h.equityIrr), sub: 'levered', good: true },
          { label: 'Distributed IRR', value: pct(h.distributedEquityIrr), sub: 'dividends' }, { label: 'Equity Multiple', value: mult(h.equityMultiple), sub: 'dist / invested' },
          { label: 'Equity MOIC', value: mult(h.equityMoic), sub: 'FCFE' }, { label: 'Terminal Equity', value: fmtM(h.terminalEquity), sub: `exit ${o.exitYear}` },
        ], Y + 0.1, 6, MX, CONTENT_W, 1.05, 15);
        kpiTiles(c, [
          { label: 'Yield on Cost', value: pct(re.yieldOnCost) }, { label: 'Cap Rate at Exit', value: pct(re.capRateAtExit) },
          { label: 'Profit on Cost', value: pct(re.profitOnCost) }, { label: 'Avg Cash-on-Cash', value: pct(re.cashOnCashAvg) },
        ], Y + 1.35, 4, MX, CONTENT_W, 0.9, 16);
        captionBlock(c, MX, Y + 2.5, CONTENT_W, 1.5, 'Reading the returns',
          inputs.returnsCommentary.trim() || `Leverage lifts the ${pct(h.projectIrr)} unlevered return to a ${pct(h.equityIrr)} equity IRR; a ${mult(h.equityMultiple)} multiple returns capital plus a full turn over the hold.`);
        break;
      }
      case 'exit_optionality': {
        H(unitM);
        const selIdx = new Set(m.exitYears.map((r, i) => (r.selected ? i : -1)).filter((i) => i >= 0));
        dataTable(c, ['Exit year', 'Equity value', 'Proj IRR', 'Eq IRR', 'MOIC'],
          m.exitYears.map((r) => [`${r.year}${r.selected ? ' *' : ''}`, fmtM(r.equityValue), pct(r.projectIrr), pct(r.equityIrr), mult(r.equityMoic)]),
          Y + 0.1, selIdx, 9, MX, 6.7, selIdx);
        const em = m.charts.exitMoic;
        if (em.hasData) lineChart(c, em.years.map(String), 'Equity MOIC', em.moic, MX + 7.0, Y + 0.1, 5.3, 3.0, '0.00"x"');
        captionBlock(c, MX, PH - 1.55, CONTENT_W, 1.2, 'Timing is optionality',
          inputs.exitCommentary.trim() || `Holding to ${o.exitYear} maximises the equity multiple; earlier exits trade upside for a shorter duration.`);
        break;
      }
      case 'scenario_cases': {
        if (!input.scenarios) break;
        const rows2 = icScenarioChartRows(input.scenarios);
        H();
        const drivers = buildDriverRows(input.scenarios);
        let leftY = Y + 0.1;
        if (drivers.headers.length > 1 && drivers.rows.length) { dataTable(c, drivers.headers, drivers.rows, leftY, new Set(), 8, MX, 6.3); leftY += 0.32 + drivers.rows.length * 0.3 + 0.3; }
        scenarioTable(c, ['Equity IRR (FCFE)', 'Project IRR (FCFF)', 'Equity MOIC', 'Development Margin'], leftY, MX, 6.3, 9);
        columnChart(c, rows2.map((r) => r.name),
          [{ name: 'Project IRR', color: B.navy, values: rows2.map((r) => (r.projectIrr == null ? 0 : r.projectIrr * 100)) }, { name: 'Equity IRR', color: B.mid, values: rows2.map((r) => (r.equityIrr == null ? 0 : r.equityIrr * 100)) }],
          MX + 6.7, Y + 0.2, 5.6, 4.2, { pctAxis: true, showValue: true });
        break;
      }
      case 'scenario_economics': {
        if (!input.scenarios) break;
        H(unitM);
        scenarioTable(c, ['NPV (FCFF)', 'Gross Development Value', 'Total Development Cost', 'Profit after Financing', 'Development Margin', 'Equity IRR (FCFE)'], Y + 0.1, MX, 6.3, 9);
        const rows2 = icScenarioChartRows(input.scenarios);
        columnChart(c, rows2.map((r) => r.name), [{ name: 'NPV', color: B.navy, values: rows2.map((r) => (r.npv == null ? 0 : r.npv / MONEY_DIV)) }],
          MX + 6.7, Y + 0.2, 5.6, 3.0, { showValue: true, perPointColors: rows2.map((r) => ((r.npv ?? 0) >= 0 ? B.green : B.negRed)) });
        captionBlock(c, MX + 6.7, Y + 3.4, 5.6, 1.5, 'Takeaway',
          inputs.scenarioTakeaway.trim() || 'Only the downside turns NPV negative; the base and upside comfortably clear the hurdle.');
        break;
      }
      case 'sensitivity': {
        const s = m.sensitivity;
        const flat = s.irr.flat().filter((v): v is number => v != null && Number.isFinite(v));
        const mn = flat.length ? Math.min(...flat) : 0, mx = flat.length ? Math.max(...flat) : 1;
        H();
        const heat = (v: number): string => blend(B.negRed, B.green, mx > mn ? (v - mn) / (mx - mn) : 0.5);
        const header = [{ text: `${sensVarLabel(s.yVariable)} \\ ${sensVarLabel(s.xVariable)}`, options: { fill: { color: B.navy }, color: B.white, bold: true, fontSize: 8, align: 'left' as const } },
          ...s.xValues.map((xv) => ({ text: sensVal(s.xVariable, xv), options: { fill: { color: B.navy }, color: B.white, bold: true, fontSize: 8, align: 'center' as const } }))];
        const body = s.yValues.map((yv, yi) => [{ text: sensVal(s.yVariable, yv), options: { fill: { color: B.paleBg }, bold: true, color: B.navy, fontSize: 8, align: 'left' as const } },
          ...s.xValues.map((_, xi) => { const v = s.irr[yi]?.[xi]; const ok = v != null && Number.isFinite(v); return { text: ok ? pct(v as number) : 'n/a', options: { fill: { color: ok ? heat(v as number) : 'FFFFFF' }, color: B.white, fontSize: 8, align: 'center' as const } }; })]);
        c.addTable([header, ...body] as PptxGenJS.TableRow[], { x: MX, y: Y + 0.1, w: 8.4, border: { type: 'solid', color: B.border, pt: 0.5 }, fontFace: fontBody, autoPage: false });
        captionBlock(c, MX + 8.7, Y + 0.1, CONTENT_W - 8.7, 3.6, 'Reading the sensitivity',
          `Equity IRR spans ${pct(mn)} to ${pct(mx)} across exit cap rate and sales price.${s.baseEquityIrr != null ? ` The base case sits at ${pct(s.baseEquityIrr)}.` : ''} The plan stays return-accretive through the tested band.`);
        break;
      }
      case 'risk_assessment': {
        H();
        const risks = inputs.risks.length ? inputs.risks : (inputs.keyRisks.trim() ? inputs.keyRisks.split(/\n+/).filter(Boolean).map((r) => ({ risk: r, mitigant: '' })) : []);
        const cols = 2, gap = 0.25, cw = (CONTENT_W - gap) / cols, chh = 1.6;
        risks.slice(0, 6).forEach((r, i) => riskCard(c, MX + (i % cols) * (cw + gap), Y + 0.1 + Math.floor(i / cols) * (chh + 0.2), cw, chh, i + 1, r.risk, r.mitigant));
        break;
      }
      case 'regulatory_tax': {
        H();
        const cols = 2, gap = 0.25, cw = (CONTENT_W - gap) / cols;
        inputs.regulatoryTax.slice(0, 8).forEach((r, i) => captionBlock(c, MX + (i % cols) * (cw + gap), Y + 0.1 + Math.floor(i / cols) * 1.2, cw, 1.05, r.label, r.body || ''));
        break;
      }
      case 'recommendation_approvals': {
        const a = m.ask;
        H();
        const asks = [
          `Total equity commitment of ${fmtM(a.equityCommitment)} ${moneyUnit} (existing ${fmtM(a.existingEquity)}; in-kind land ${fmtM(a.inKindEquity)})`,
          ...(a.peakDebt > 0.5 ? [`Senior debt facility supporting peak drawn debt of ${fmtM(a.peakDebt)} ${moneyUnit}`] : []),
          `Target returns of ${pct(a.projectIrr)} project IRR, ${pct(a.equityIrr)} equity IRR, ${mult(a.equityMoic)} equity multiple`,
        ];
        c.addShape(pptx.ShapeType.roundRect, { x: MX, y: Y + 0.1, w: 7.2, h: 4.7, fill: { color: B.navy }, rectRadius: 0.05 });
        c.addText('THE COMMITTEE IS ASKED TO APPROVE', { x: MX + 0.3, y: Y + 0.32, w: 6.6, h: 0.3, fontFace: fontBody, fontSize: 10, bold: true, color: B.mid, charSpacing: 1 });
        c.addText(asks.map((t) => ({ text: t, options: { bullet: { code: '2713' }, color: B.white, fontSize: 12, paraSpaceAfter: 10 } })) as PptxGenJS.TextProps[], { x: MX + 0.35, y: Y + 0.72, w: 6.5, h: 3.8, fontFace: fontBody, valign: 'top', lineSpacingMultiple: 1.15 });
        c.addShape(pptx.ShapeType.roundRect, { x: MX + 7.5, y: Y + 0.1, w: CONTENT_W - 7.5, h: 4.7, fill: { color: B.paleBg }, line: { color: B.border, width: 0.75 }, rectRadius: 0.05 });
        const rx = MX + 7.75, rw = CONTENT_W - 7.5 - 0.5;
        if (inputs.conditionsPrecedent.length) {
          c.addText('CONDITIONS PRECEDENT', { x: rx, y: Y + 0.32, w: rw, h: 0.3, fontFace: fontBody, fontSize: 9, bold: true, color: B.slate });
          bulletList(c, inputs.conditionsPrecedent, Y + 0.68, true, rx, rw, 2.5, 10.5);
        }
        if (inputs.nextSteps.trim()) {
          c.addText('NEXT STEPS', { x: rx, y: Y + 3.4, w: rw, h: 0.3, fontFace: fontBody, fontSize: 9, bold: true, color: B.slate });
          c.addText(inputs.nextSteps.trim(), { x: rx, y: Y + 3.72, w: rw, h: 1.0, fontFace: fontBody, fontSize: 10.5, color: B.ink, valign: 'top', lineSpacingMultiple: 1.15 });
        }
        if (!inputs.conditionsPrecedent.length && !inputs.nextSteps.trim())
          c.addText(inputs.recommendation.trim() || 'Subject to final due diligence and definitive documentation.', { x: rx, y: Y + 0.68, w: rw, h: 3.5, fontFace: fontBody, fontSize: 11, color: B.ink, valign: 'top', lineSpacingMultiple: 1.2 });
        break;
      }
      case 'disclaimers':
        H();
        c.addText(inputs.disclaimers.trim() || 'This document is strictly private and confidential and is intended solely for the recipient. Figures are model outputs and not a guarantee of future performance. This is not an offer or a solicitation to invest.',
          { x: MX, y: Y + 0.3, w: CONTENT_W, h: 4.8, fontFace: fontBody, fontSize: 11, color: B.slate, valign: 'top', lineSpacingMultiple: 1.4 });
        break;
      default: break;
    }
  }

  // ── Lender content ──
  function renderLender(c: PptxGenJS.Slide, key: string): void {
    const m = input.lender!;
    switch (key) {
      case 'executive_summary': narrative(c, inputs.executiveSummary, 'No executive summary provided.'); break;
      case 'facility_terms': {
        if (m.facilities.length === 0) { narrative(c, '', 'No debt facilities configured.'); break; }
        const header = ['Facility', 'Rate', 'LTV', 'Share', 'Cash Sweep'].map((t, i) => ({ text: t, options: { fill: { color: B.navy }, color: B.white, bold: true, align: i === 0 ? 'left' : 'right', fontSize: 10 } }));
        const body = m.facilities.map((f) => [
          { text: f.name, options: { align: 'left', fontSize: 10, color: B.ink } },
          { text: `${f.interestRatePct.toFixed(2)}%`, options: { align: 'right', fontSize: 10, color: B.ink } },
          { text: `${f.ltvPct.toFixed(0)}%`, options: { align: 'right', fontSize: 10, color: B.ink } },
          { text: f.facilitySharePct == null ? 'n/a' : `${f.facilitySharePct.toFixed(0)}%`, options: { align: 'right', fontSize: 10, color: B.ink } },
          { text: f.sweepRatioPct == null ? 'none' : `${f.sweepRatioPct.toFixed(0)}%`, options: { align: 'right', fontSize: 10, color: B.ink } },
        ]);
        c.addTable([header, ...body] as PptxGenJS.TableRow[], { x: MX, y: CONTENT_Y + 0.3, w: CONTENT_W, border: { type: 'solid', color: B.border, pt: 0.5 }, fontFace: fontBody, autoPage: false });
        break;
      }
      case 'capital_structure': {
        const cap = m.capital;
        kpiTiles(c, [
          { label: 'Debt', value: pct(cap.debtPct), sub: 'of sources' },
          { label: 'Cash Equity', value: pct(cap.cashEquityPct), sub: 'of sources' },
          { label: 'Peak Debt', value: fmt(cap.peakDebt) },
          { label: 'Debt at Exit', value: fmt(cap.remainingDebtAtExit) },
          { label: 'Debt Tenor', value: cap.tenorYears == null ? 'n/a' : `${cap.tenorYears} yrs` },
          { label: 'Peak Equity', value: fmt(cap.peakEquity), sub: 'equity at risk' },
        ], CONTENT_Y + 0.3);
        break;
      }
      case 'sources_uses': {
        c.addText(`Figures in ${currency}`, { x: MX, y: CONTENT_Y + 0.05, w: CONTENT_W, h: 0.25, fontFace: fontBody, fontSize: 9, color: B.slate });
        const mk = (title: string, rows: Array<{ label: string; value: number }>, total: number, x: number): void => {
          c.addText(title, { x, y: CONTENT_Y + 0.35, w: CONTENT_W / 2 - 0.2, h: 0.3, fontFace: fontBody, fontSize: 11, bold: true, color: B.navy });
          const shown = rows.filter((r) => Math.abs(r.value) > 0.5);
          shown.forEach((r, i) => {
            const y = CONTENT_Y + 0.7 + i * 0.32;
            c.addText(r.label, { x, y, w: 3.2, h: 0.3, fontFace: fontBody, fontSize: 10, color: B.slate });
            c.addText(fmt(r.value), { x: x + 2.5, y, w: 2.5, h: 0.3, fontFace: fontBody, fontSize: 10, color: B.ink, align: 'right' });
          });
          const yt = CONTENT_Y + 0.7 + shown.length * 0.32 + 0.05;
          c.addText(`Total ${title}`, { x, y: yt, w: 3.2, h: 0.3, fontFace: fontBody, fontSize: 10, bold: true, color: B.navy });
          c.addText(fmt(total), { x: x + 2.5, y: yt, w: 2.5, h: 0.3, fontFace: fontBody, fontSize: 10, bold: true, color: B.navy, align: 'right' });
        };
        mk('Sources', m.sourcesUses.sources, m.sourcesUses.totalSources, MX);
        mk('Uses', m.sourcesUses.uses, m.sourcesUses.totalUses, MX + CONTENT_W / 2 + 0.2);
        break;
      }
      case 'repayment_schedule':
        c.addText(`Figures in ${currency}`, { x: MX, y: CONTENT_Y + 0.05, w: CONTENT_W, h: 0.25, fontFace: fontBody, fontSize: 9, color: B.slate });
        periodTable(c, m.yearLabels, [
          { label: 'Debt Drawdown', values: m.repayment.drawdown },
          { label: 'Interest Paid', values: m.repayment.interest },
          { label: 'Principal (incl. sweep)', values: m.repayment.principal },
          { label: 'Cash Sweep', values: m.repayment.sweep },
          { label: 'Debt Outstanding', values: m.repayment.debtOutstanding },
        ], CONTENT_Y + 0.35);
        break;
      case 'covenant_analysis': covenantTable(c, m.covenants, m.yearLabels); break;
      case 'key_cash_flows':
        c.addText(`Figures in ${currency}`, { x: MX, y: CONTENT_Y + 0.05, w: CONTENT_W, h: 0.25, fontFace: fontBody, fontSize: 9, color: B.slate });
        periodTable(c, m.yearLabels, [
          { label: 'Operating Cash Flow', values: m.keyCashFlows.cfo },
          { label: 'Investing Cash Flow', values: m.keyCashFlows.cfi },
          { label: 'Financing Cash Flow', values: m.keyCashFlows.cff },
          { label: 'Closing Cash', values: m.keyCashFlows.closing },
        ], CONTENT_Y + 0.35);
        break;
      case 'security_collateral': narrative(c, inputs.securityCollateral, 'No security / collateral notes provided.'); break;
      case 'covenant_commentary': narrative(c, inputs.covenantCommentary, 'No covenant commentary provided.'); break;
      case 'disclaimers': narrative(c, inputs.disclaimers, 'No disclaimers provided.'); break;
      default: break;
    }
  }

  function covenantTable(c: PptxGenJS.Slide, covenants: LenderCovenantRow[], yearLabels: number[]): void {
    if (covenants.length === 0) { narrative(c, '', 'No covenants configured (see the RE Metrics tab).'); return; }
    const cellPass = (row: LenderCovenantRow, v: number): boolean => (row.operator === 'min' ? v >= row.threshold : v <= row.threshold);
    const hOpt = { fill: { color: B.navy }, color: B.white, bold: true, fontSize: 7, align: 'right' as const };
    const header = [{ text: 'Covenant', options: { ...hOpt, align: 'left' as const } }, { text: 'Thresh.', options: hOpt }, { text: 'Worst', options: hOpt }, { text: 'Result', options: hOpt },
      ...yearLabels.map((y) => ({ text: String(y), options: hOpt }))];
    const body = covenants.map((row) => {
      const cells: PptxGenJS.TableCell[] = [
        { text: `${row.label} (${row.operator})`, options: { align: 'left', fontSize: 7, color: B.ink } },
        { text: covFmt(row.threshold, row.unit), options: { align: 'right', fontSize: 7, color: B.slate } },
        { text: covFmt(row.worst, row.unit), options: { align: 'right', fontSize: 7, bold: true, color: B.ink } },
        { text: row.pass == null ? 'n/a' : row.pass ? 'PASS' : 'FAIL', options: { align: 'right', fontSize: 7, bold: true, color: row.pass == null ? B.slate : row.pass ? B.green : B.red } },
      ];
      for (let i = 0; i < yearLabels.length; i++) {
        if (row.exitOnly) { cells.push({ text: i === yearLabels.length - 1 ? covFmt(row.worst, row.unit) : '', options: { align: 'right', fontSize: 7, color: B.slate } }); continue; }
        const v = row.seriesPerPeriod[i];
        const has = v != null && Number.isFinite(v);
        const ok = has ? cellPass(row, v as number) : null;
        cells.push({ text: has ? covFmt(v as number, row.unit) : '', options: { align: 'right', fontSize: 7, color: ok == null ? B.slate : ok ? B.green : B.red, fill: { color: ok == null ? B.white : ok ? 'DDEEE3' : 'F6DBDB' } } });
      }
      return cells;
    });
    c.addTable([header, ...body] as PptxGenJS.TableRow[], { x: MX, y: CONTENT_Y + 0.3, w: CONTENT_W, border: { type: 'solid', color: B.border, pt: 0.5 }, fontFace: fontBody, autoPage: false });
  }

  // ── One-Pager content ──
  function renderOnePager(c: PptxGenJS.Slide, key: string): void {
    const m = input.onePager!;
    switch (key) {
      case 'deal_at_a_glance': {
        const d = m.dealAtAGlance;
        factGrid(c, [
          { label: 'Project', value: d.projectName || 'Untitled' },
          { label: 'Location', value: d.location || 'n/a' },
          { label: 'Phases', value: String(d.phaseCount) },
          { label: 'Asset mix', value: d.assetMix.map((a) => a.name).join(', ') || 'n/a' },
        ], CONTENT_Y + 0.3);
        break;
      }
      case 'headline_returns': {
        const h = m.headline;
        kpiTiles(c, [
          { label: 'Project IRR', value: pct(h.projectIrr), good: true },
          { label: 'Equity IRR', value: pct(h.equityIrr), good: true },
          { label: 'MOIC', value: mult(h.equityMultiple) },
          { label: 'Project MOIC', value: mult(h.projectMoic) },
        ], CONTENT_Y + 0.3);
        break;
      }
      case 'capital_ask': {
        const cap = m.capitalAsk;
        c.addText(`Figures in ${currency}`, { x: MX, y: CONTENT_Y + 0.05, w: CONTENT_W, h: 0.25, fontFace: fontBody, fontSize: 9, color: B.slate });
        kpiTiles(c, [
          { label: 'Total Equity', value: fmt(cap.totalEquity) },
          { label: 'Peak Equity', value: fmt(cap.peakEquity) },
          { label: 'Peak Debt', value: fmt(cap.peakDebt) },
          { label: 'Debt / Equity', value: `${pct(cap.debtPct)} / ${pct(cap.equityPct)}` },
        ], CONTENT_Y + 0.5);
        break;
      }
      case 'timeline':
        c.addText(`${m.timeline.startYear} to ${m.timeline.exitYear}  (${m.timeline.durationYears} year hold)`, { x: MX, y: CONTENT_Y + 0.4, w: CONTENT_W, h: 0.5, fontFace: fontBody, fontSize: 16, color: B.ink });
        break;
      case 'asset_mix':
        c.addText(m.assetMix.map((a) => `${a.name} (${a.strategy})`).join('    ') || 'No assets', { x: MX, y: CONTENT_Y + 0.4, w: CONTENT_W, h: 1.5, fontFace: fontBody, fontSize: 13, color: B.navy, valign: 'top', lineSpacingMultiple: 1.4 });
        break;
      case 'thesis_contact': {
        c.addText(m.thesisLine.trim() ? `“${m.thesisLine}”` : 'No thesis line provided.', { x: MX, y: CONTENT_Y + 0.3, w: CONTENT_W, h: 1.0, fontFace: fontBody, fontSize: 15, italic: true, color: m.thesisLine.trim() ? B.ink : B.slate, valign: 'top' });
        const contactLines: string[] = [];
        if (m.preparedBy.length) contactLines.push(`Prepared by ${m.preparedBy.map((p) => p.name).join(', ')}`);
        if (m.contacts.length) contactLines.push(`Contact: ${m.contacts.map((p) => `${p.name}${p.identifier ? ` (${p.identifier})` : ''}`).join(', ')}`);
        if (contactLines.length) c.addText(contactLines.join('\n'), { x: MX, y: CONTENT_Y + 1.5, w: CONTENT_W, h: 1.0, fontFace: fontBody, fontSize: 11, color: B.slate, valign: 'top', lineSpacingMultiple: 1.3 });
        break;
      }
      default: break;
    }
  }

  return pptx;
}
