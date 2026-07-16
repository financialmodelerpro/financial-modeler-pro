/**
 * layout.ts (REFM Module 7, IC Presentation Builder: composition primitives)
 *
 * The factories templates build slides from. Every institutional deck is a small
 * vocabulary of blocks repeated with discipline; this file is that vocabulary.
 * Templates never hand-write an object literal, so a change to (say) the KPI tile
 * restyles all eighteen slides at once, and every tile row is mathematically even
 * rather than hand-nudged.
 *
 * The grid these agree on:
 *
 *   y=0    ┌──────────────────────────────────────┐
 *          │ header chrome (band text + rule)     │  HEADER_H
 *   y=44   │ 07 │ Section Title                   │  TITLE_H
 *   y=82   │    italic finding line               │
 *   y=112  ├──────────────────────────────────────┤  rule
 *   y=128  │                                      │
 *          │ CONTENT (CONTENT_H tall)             │
 *   y=664  ├──────────────────────────────────────┤
 *   y=676  │ footer chrome                        │
 *   y=720  └──────────────────────────────────────┘
 *
 * No em dashes in this file.
 */

import {
  MARGIN, CONTENT_W, SLIDE_W, SLIDE_H, deckId, rowSlots,
  type BulletsObject, type ChartObject, type DeckObject, type DividerObject, type GanttObject,
  type HeatmapObject, type ImageObject, type KpiObject, type KpiVariant, type RiskMatrixObject,
  type ShapeObject, type TableObject, type TextObject, type TextStyle, type BoxStyle,
} from './types';
import { DECK_THEME, TYPE_SCALE, textStyles } from './theme';
import type { ChartBindingKey, MetricBindingKey, TableBindingKey, TextBindingKey } from './bindings';

export const HEADER_H = 30;
export const TITLE_Y = 44;
export const TITLE_H = 34;
export const FINDING_Y = 82;
export const RULE_Y = 112;
export const CONTENT_Y = 128;
export const CONTENT_BOTTOM = 664;
export const CONTENT_H = CONTENT_BOTTOM - CONTENT_Y;
export const FOOTER_Y = 676;
/** Standard gap between sibling blocks. A multiple of GRID so drags stay aligned. */
export const GAP = 16;

export type Box = { x: number; y: number; w: number; h: number };

// ── Object factories ────────────────────────────────────────────────────────

export const text = (b: Box, content: string, style: TextStyle, extra: Partial<TextObject> = {}): TextObject => ({
  id: deckId('txt'), type: 'text', rot: 0, ...b, text: content, style, ...extra,
});

/** Text whose content comes from the model. `text` holds the label only as an
 *  offline fallback; the canvas always shows the resolved value. */
export const boundText = (b: Box, binding: TextBindingKey, style: TextStyle, fallback = '', extra: Partial<TextObject> = {}): TextObject =>
  text(b, fallback, style, { binding, ...extra });

export const bullets = (b: Box, items: string[], style: TextStyle, extra: Partial<BulletsObject> = {}): BulletsObject => ({
  id: deckId('bul'), type: 'bullets', rot: 0, ...b, items, style, markerColor: DECK_THEME.navy, ...extra,
});

export const kpi = (b: Box, metric: MetricBindingKey, variant: KpiVariant = 'pale', extra: Partial<KpiObject> = {}): KpiObject => ({
  id: deckId('kpi'), type: 'kpi', rot: 0, ...b, metric, variant, ...extra,
});

export const chart = (b: Box, key: ChartBindingKey, extra: Partial<ChartObject> = {}): ChartObject => ({
  id: deckId('cht'), type: 'chart', rot: 0, ...b, chart: key, showLegend: true, ...extra,
});

export const table = (b: Box, key: TableBindingKey, extra: Partial<TableObject> = {}): TableObject => ({
  id: deckId('tbl'), type: 'table', rot: 0, ...b, table: key, striped: true, ...extra,
});

export const image = (b: Box, url: string | null = null, extra: Partial<ImageObject> = {}): ImageObject => ({
  id: deckId('img'), type: 'image', rot: 0, ...b, url, fit: 'cover', ...extra,
});

export const shape = (b: Box, kind: ShapeObject['shape'] = 'rect', box: BoxStyle = {}, extra: Partial<ShapeObject> = {}): ShapeObject => ({
  id: deckId('shp'), type: 'shape', rot: 0, ...b, shape: kind, box, ...extra,
});

export const divider = (b: Box, color: string = DECK_THEME.rule, thickness = 1): DividerObject => ({
  id: deckId('div'), type: 'divider', rot: 0, ...b, color, thickness,
});

export const gantt = (b: Box, extra: Partial<GanttObject> = {}): GanttObject => ({
  id: deckId('gnt'), type: 'gantt', rot: 0, ...b, showMarkers: true, ...extra,
});

export const heatmap = (b: Box, extra: Partial<HeatmapObject> = {}): HeatmapObject => ({
  id: deckId('hmp'), type: 'heatmap', rot: 0, ...b, ...extra,
});

export const riskMatrix = (b: Box, rows: RiskMatrixObject['rows'] = []): RiskMatrixObject => ({
  id: deckId('rsk'), type: 'riskMatrix', rot: 0, ...b, rows,
});

// ── Composite blocks ────────────────────────────────────────────────────────

/** The section-number chip + title + italic finding. The number is a chip on the
 *  content slide, never a slide of its own. `finding` empty means the canvas
 *  fills it from icFindingLine at render time. */
export function titleBlock(num: string, title: string, finding = ''): DeckObject[] {
  const out: DeckObject[] = [];
  let tx = MARGIN;
  if (num) {
    out.push(shape({ x: MARGIN, y: TITLE_Y + 2, w: 34, h: 30 }, 'rect', { fill: DECK_THEME.navy, radius: 3 }, {
      text: num, style: { ...textStyles.kpiValue(), size: TYPE_SCALE.sectionNum, color: DECK_THEME.white, align: 'center', valign: 'middle' },
      name: 'Section number',
    }));
    tx = MARGIN + 34 + 12;
  }
  out.push(text({ x: tx, y: TITLE_Y, w: CONTENT_W - (tx - MARGIN), h: TITLE_H }, title, textStyles.slideTitle(), { name: 'Slide title' }));
  out.push(text({ x: tx, y: FINDING_Y, w: CONTENT_W - (tx - MARGIN), h: 20 }, finding, textStyles.finding(), { name: 'Finding' }));
  out.push(divider({ x: MARGIN, y: RULE_Y, w: CONTENT_W, h: 1 }, DECK_THEME.navy, 2));
  return out;
}

/** A row of KPI tiles, exactly even across `w`. The workhorse of the deck. */
export function kpiRow(metrics: MetricBindingKey[], y: number, opt: { x?: number; w?: number; h?: number; variant?: KpiVariant; perRow?: number } = {}): DeckObject[] {
  const x = opt.x ?? MARGIN;
  const w = opt.w ?? CONTENT_W;
  const h = opt.h ?? 92;
  const perRow = opt.perRow ?? metrics.length;
  const out: DeckObject[] = [];
  for (let i = 0; i < metrics.length; i += perRow) {
    const chunk = metrics.slice(i, i + perRow);
    const slots = rowSlots(x, w, chunk.length, GAP);
    const rowY = y + (i / perRow) * (h + GAP);
    chunk.forEach((m, j) => out.push(kpi({ x: slots[j].x, y: rowY, w: slots[j].w, h }, m, opt.variant ?? 'pale')));
  }
  return out;
}

export type CaptionVariant = 'pale' | 'navy' | 'green' | 'plain';

const captionFill = (v: CaptionVariant): BoxStyle => {
  switch (v) {
    case 'navy':  return { fill: DECK_THEME.navy, radius: 4 };
    case 'green': return { fill: DECK_THEME.green, radius: 4 };
    case 'pale':  return { fill: DECK_THEME.paleWash, radius: 4 };
    default:      return { fill: null, border: { color: DECK_THEME.rule, width: 1 }, radius: 4 };
  }
};

/** A captioned finding block: heading + a short reading. Every chart pairs with
 *  one of these; that pairing is the single biggest thing separating an IC deck
 *  from a chart dump. */
export function captionBlock(b: Box, heading: string, body: string, variant: CaptionVariant = 'pale'): DeckObject[] {
  const onDark = variant === 'navy' || variant === 'green';
  const pad = 14;
  return [
    shape(b, 'rect', captionFill(variant), { name: `Caption: ${heading}` }),
    text({ x: b.x + pad, y: b.y + pad, w: b.w - pad * 2, h: 20 }, heading,
      { ...textStyles.captionHead(), color: onDark ? DECK_THEME.white : DECK_THEME.navy }),
    text({ x: b.x + pad, y: b.y + pad + 24, w: b.w - pad * 2, h: b.h - pad * 2 - 24 }, body,
      { ...textStyles.caption(), color: onDark ? DECK_THEME.pale : DECK_THEME.slate }),
  ];
}

/** A chart with its caption beside it. `split` is the chart's share of the width. */
export function chartWithCaption(
  b: Box, key: ChartBindingKey, heading: string, body: string,
  opt: { split?: number; variant?: CaptionVariant; chartTitle?: string | null } = {},
): DeckObject[] {
  const split = opt.split ?? 0.58;
  const cw = Math.round((b.w - GAP) * split);
  return [
    chart({ x: b.x, y: b.y, w: cw, h: b.h }, key, { title: opt.chartTitle ?? null }),
    ...captionBlock({ x: b.x + cw + GAP, y: b.y, w: b.w - cw - GAP, h: b.h }, heading, body, opt.variant ?? 'pale'),
  ];
}

/** A titled panel: a small navy label above a block. Used to head tables. */
export function panelLabel(b: Box, label: string): DeckObject {
  return text(b, label, { ...textStyles.kpiLabel(), color: DECK_THEME.navy, size: 11 });
}

/** The full-bleed navy cover wash. */
export function coverWash(): DeckObject {
  return shape({ x: 0, y: 0, w: SLIDE_W, h: SLIDE_H }, 'rect', { fill: DECK_THEME.navyDeep }, { name: 'Cover background', locked: true });
}

/** A phase card: navy header, asset list, pale value footer. */
export function phaseCard(b: Box, name: string, window: string, assets: string[], footLabel: string, footValue: string): DeckObject[] {
  const headH = 44, footH = 46;
  return [
    shape(b, 'rect', { fill: DECK_THEME.white, border: { color: DECK_THEME.rule, width: 1 }, radius: 4 }),
    shape({ x: b.x, y: b.y, w: b.w, h: headH }, 'rect', { fill: DECK_THEME.navy, radius: 4 }),
    text({ x: b.x + 12, y: b.y + 6, w: b.w - 24, h: 16 }, name, { ...textStyles.kpiLabel(), color: DECK_THEME.white, size: 11 }),
    text({ x: b.x + 12, y: b.y + 22, w: b.w - 24, h: 16 }, window, { ...textStyles.kpiSub(), color: DECK_THEME.pale }),
    bullets({ x: b.x + 12, y: b.y + headH + 10, w: b.w - 24, h: b.h - headH - footH - 20 }, assets, { ...textStyles.caption(), size: 11 }),
    shape({ x: b.x + 1, y: b.y + b.h - footH, w: b.w - 2, h: footH - 1 }, 'rect', { fill: DECK_THEME.paleWash }),
    text({ x: b.x + 12, y: b.y + b.h - footH + 7, w: b.w - 24, h: 12 }, footLabel, { ...textStyles.kpiLabel(), size: 9 }),
    text({ x: b.x + 12, y: b.y + b.h - footH + 20, w: b.w - 24, h: 20 }, footValue, { ...textStyles.kpiValue(), size: 16 }),
  ];
}
