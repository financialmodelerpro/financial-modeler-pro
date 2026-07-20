/**
 * blockLibrary.ts (REFM Module 7, IC Presentation Builder: the data-block picker)
 *
 * The catalogue of self-contained model-data blocks a user can drop into any
 * slide: KPI tiles, charts, tables, the programme Gantt, the sensitivity
 * heatmap. Each block is already wired to the snapshot through a binding key,
 * so an added block renders in the canvas AND exports through the same registry
 * the rest of the deck uses, with no per-block plumbing.
 *
 * Auto-omit at the LIBRARY level: `availableBlocks` offers a block only when its
 * binding actually resolves against THIS project's model, so a pure-Sell / no-
 * debt / single-case project is never offered an empty block. The picker cannot
 * add a broken block.
 *
 * Pure + browser-safe. No em dashes.
 */

import type { ICReportModel } from '../icReport';
import type { DeckObject } from './types';
import { MARGIN, SLIDE_W, clampToCanvas, GRID } from './types';
import { CONTENT_Y, kpi, chart, table, gantt, heatmap, type Box } from './layout';
import {
  METRIC_BINDINGS, METRIC_KEYS, resolveMetric,
  CHART_BINDINGS, CHART_KEYS, resolveChart,
  TABLE_BINDINGS, TABLE_KEYS, resolveTable,
  type DeckFmt, type MetricBindingKey, type ChartBindingKey, type TableBindingKey,
} from './bindings';

export type BlockKind = 'kpi' | 'chart' | 'table' | 'gantt' | 'heatmap';

export interface BlockSpec {
  /** Unique catalogue key: the binding key, or 'gantt' / 'heatmap'. */
  key: string;
  kind: BlockKind;
  /** Human label shown in the picker. */
  label: string;
  /** Registry group, for sub-grouping inside a picker section. */
  group: string;
  /** The binding key for data blocks (absent for gantt / heatmap). */
  bindingKey?: MetricBindingKey | ChartBindingKey | TableBindingKey;
}

/** Top-level picker sections in display order. */
export const BLOCK_SECTIONS: Array<{ id: string; title: string; kinds: BlockKind[] }> = [
  { id: 'kpi',   title: 'KPI tiles', kinds: ['kpi'] },
  { id: 'chart', title: 'Charts',    kinds: ['chart'] },
  { id: 'table', title: 'Tables',    kinds: ['table'] },
  { id: 'model', title: 'Programme & sensitivity', kinds: ['gantt', 'heatmap'] },
];

/**
 * Every model-data block THIS project can actually produce, in catalogue order.
 * A block appears only when its binding resolves (data exists), so the picker is
 * self-omitting: no empty blocks in the library for a given project.
 */
export function availableBlocks(model: ICReportModel, fmt: DeckFmt): BlockSpec[] {
  const out: BlockSpec[] = [];
  for (const key of METRIC_KEYS) {
    if (resolveMetric(key, model, fmt).available) {
      const d = METRIC_BINDINGS[key];
      out.push({ key, kind: 'kpi', label: d.label, group: d.group, bindingKey: key });
    }
  }
  for (const key of CHART_KEYS) {
    if (resolveChart(key, model, fmt).available) {
      const d = CHART_BINDINGS[key];
      out.push({ key, kind: 'chart', label: d.label, group: d.group, bindingKey: key });
    }
  }
  for (const key of TABLE_KEYS) {
    if (resolveTable(key, model, fmt).available) {
      const d = TABLE_BINDINGS[key];
      out.push({ key, kind: 'table', label: d.label, group: d.group, bindingKey: key });
    }
  }
  if (model.programme.lanes.length) {
    out.push({ key: 'gantt', kind: 'gantt', label: 'Development programme (Gantt)', group: 'Programme' });
  }
  if (model.sensitivity.hasData) {
    out.push({ key: 'heatmap', kind: 'heatmap', label: 'Sensitivity heatmap', group: 'Scenarios' });
  }
  return out;
}

/** Default on-canvas size per block kind. Each block carries its own layout so
 *  dropping one never breaks the slide. */
const DEFAULT_SIZE: Record<BlockKind, { w: number; h: number }> = {
  kpi:     { w: 240, h: 100 },
  chart:   { w: 560, h: 300 },
  table:   { w: 560, h: 320 },
  gantt:   { w: SLIDE_W - MARGIN * 2, h: 280 },
  heatmap: { w: 560, h: 320 },
};

/** A landing box for a freshly inserted block: default size for its kind, dropped
 *  into the content band with a small per-insert offset so repeated inserts do
 *  not stack exactly, clamped to the canvas. */
export function blockLandingBox(kind: BlockKind, index: number): Box {
  const size = DEFAULT_SIZE[kind];
  const step = (index % 6) * GRID;
  return clampToCanvas({ x: MARGIN + step, y: CONTENT_Y + step, w: size.w, h: size.h });
}

/** Build the DeckObject for a block. Pure: stores the binding key, never a
 *  number. The id is a placeholder; the insert mutation assigns a
 *  collision-safe runtime id. */
export function buildBlockObject(spec: BlockSpec, box: Box): DeckObject {
  switch (spec.kind) {
    case 'chart':   return chart(box, spec.bindingKey as ChartBindingKey);
    case 'table':   return table(box, spec.bindingKey as TableBindingKey);
    case 'gantt':   return gantt(box);
    case 'heatmap': return heatmap(box);
    case 'kpi':
    default:        return kpi(box, spec.bindingKey as MetricBindingKey, 'pale');
  }
}
