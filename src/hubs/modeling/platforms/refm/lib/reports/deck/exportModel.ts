/**
 * exportModel.ts (REFM Module 7, IC Presentation Builder: the export contract)
 *
 * The one place a deck of BOUND objects becomes a deck of RESOLVED objects, ready
 * to hand to a file exporter. The PPTX exporter (pptxgenjs) and the PDF exporter
 * (pdf-lib) both consume this, so the two file formats can never disagree about
 * what a slide says, and neither can drift from the on-screen canvas: all three
 * resolve their bindings through the SAME registry (resolveMetric / resolveChart
 * / resolveTable / resolveText).
 *
 * The rules the canvas holds are preserved here exactly:
 *
 *  - A binding that cannot resolve becomes an `unlinked` paint carrying its human
 *    reason, never a fabricated number. "No broken links" = live or loudly absent,
 *    in a .pptx and a .pdf just as on screen.
 *  - Geometry stays in LOGICAL pixels on the 1280 x 720 canvas. Each exporter
 *    converts to its own unit (PowerPoint inches, PDF points) with the single
 *    helpers here, so what the user dragged is what the file receives.
 *  - Hidden slides and hidden objects are dropped. Slide numbers count only the
 *    visible slides, matching the navigator's own numbering.
 *
 * This module is PURE and browser-safe. It imports no exporter library, so the
 * verifier and the client can both build the resolved model without pulling in
 * node-only pptxgenjs / pdf-lib.
 *
 * No em dashes in this file.
 */

import type { ICReportModel } from '../icReport';
import type {
  ChartData, DeckFmt, TableData,
} from './bindings';
import { resolveChart, resolveMetric, resolveTable, resolveText } from './bindings';
import { isPlaceholderText } from './placeholders';
import type {
  BoxStyle, ChartKind, Deck, DeckObject, KpiVariant, RiskMatrixRow, ShapeKind, Slide, TextStyle,
} from './types';
import { PX_PER_IN, SLIDE_W, SLIDE_H } from './types';
import { DECK_THEME, brandPrimary, fontFor } from './theme';
import type { ICProgrammeLane } from '../icReport';

// ── Unit conversion ─────────────────────────────────────────────────────────
// One divide, no reflow. 1280px / 96 = 13.333in = LAYOUT_WIDE.

/** Logical px to PowerPoint inches. */
export const pxToInch = (px: number): number => px / PX_PER_IN;
/** PDF points (72 per inch). 1280px maps to 960pt, 720px to 540pt. */
export const PDF_PT_PER_PX = 72 / PX_PER_IN; // 0.75
export const pxToPt = (px: number): number => px * PDF_PT_PER_PX;

export const EXPORT_IN_W = SLIDE_W / PX_PER_IN; // 13.333
export const EXPORT_IN_H = SLIDE_H / PX_PER_IN; // 7.5
export const EXPORT_PT_W = SLIDE_W * PDF_PT_PER_PX; // 960
export const EXPORT_PT_H = SLIDE_H * PDF_PT_PER_PX; // 540

// ── Resolved paints (a discriminated union over object type) ─────────────────

export interface KpiPaint {
  kind: 'kpi';
  label: string;
  value: string;
  sub: string;
  variant: KpiVariant;
  /** Resolved fill for the tile ('' = transparent / plain). */
  fill: string;
  valueColor: string;
  labelColor: string;
  subColor: string;
  onDark: boolean;
}

export interface HeatmapCell { text: string; fill: string; textColor: string }
export interface HeatmapPaint {
  kind: 'heatmap';
  title: string;
  subtitle: string;
  xHeaders: string[];
  yHeaders: string[];
  cells: HeatmapCell[][];
}

export interface GanttPaint {
  kind: 'gantt';
  startYear: number;
  exitYear: number;
  debtRepaidYear: number | null;
  lanes: ICProgrammeLane[];
}

export type ExportPaint =
  | { kind: 'text'; text: string; style: TextStyle; box?: BoxStyle }
  | { kind: 'bullets'; items: string[]; numbered: boolean; markerColor: string; style: TextStyle; box?: BoxStyle }
  | KpiPaint
  | { kind: 'chart'; data: ChartData; chartKind: ChartKind; title: string | null; showLegend: boolean; showValues: boolean; box?: BoxStyle }
  | { kind: 'table'; data: TableData; title: string | null; striped: boolean; fontSize: number; box?: BoxStyle }
  | { kind: 'image'; url: string | null; fit: 'cover' | 'contain' | 'fill'; alt: string; box?: BoxStyle }
  | { kind: 'shape'; shape: ShapeKind; box?: BoxStyle; text: string; style?: TextStyle }
  | { kind: 'divider'; color: string; thickness: number }
  | GanttPaint
  | HeatmapPaint
  | { kind: 'riskMatrix'; rows: RiskMatrixRow[] }
  | { kind: 'unlinked'; label: string; reason: string };

export interface ExportObject {
  id: string;
  /** Logical px on the 1280 x 720 canvas, top-left origin. */
  x: number; y: number; w: number; h: number;
  rot: number;
  paint: ExportPaint;
}

export interface ExportChrome {
  /** Header band left text (empty on cover / blank slides). */
  headerLeft: string;
  headerRight: string;
  footerLeft: string;
  /** Page number, or null when slide numbers are off or the slide has no chrome. */
  pageNumber: number | null;
  show: boolean;
}

export interface ExportSlide {
  id: string;
  title: string;
  chrome: Slide['chrome'];
  background: string;
  objects: ExportObject[];
  notes: string;
  chromeInfo: ExportChrome;
}

export interface ExportDeck {
  title: string;
  primary: string;
  fontHeading: string;
  fontBody: string;
  slides: ExportSlide[];
}

// ── KPI presentation (mirrors KpiView, kept in lockstep) ─────────────────────

function kpiColors(variant: KpiVariant, signColor: boolean, raw: number | null): {
  fill: string; valueColor: string; labelColor: string; subColor: string; onDark: boolean;
} {
  const onDark = variant === 'navy' || variant === 'green';
  const fill = variant === 'navy' ? DECK_THEME.navy
    : variant === 'green' ? DECK_THEME.green
    : variant === 'pale' ? DECK_THEME.paleWash
    : ''; // plain: transparent, bordered
  const valueColor = signColor && raw !== null
    ? (raw < 0 ? DECK_THEME.red : DECK_THEME.green)
    : onDark ? DECK_THEME.white : DECK_THEME.navy;
  return {
    fill, valueColor,
    labelColor: onDark ? DECK_THEME.pale : DECK_THEME.slate,
    subColor: onDark ? DECK_THEME.pale : DECK_THEME.slateLight,
    onDark,
  };
}

// ── Per-object resolution ────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  text: 'Text', bullets: 'Text', kpi: 'Metric', chart: 'Chart', table: 'Table',
  gantt: 'Programme', heatmap: 'Sensitivity', riskMatrix: 'Risk matrix',
};

/** Resolve one object's bindings into a concrete paint. Never returns a stale or
 *  invented figure: a DATA object that cannot resolve becomes an `unlinked` paint.
 *  A TEXT object omits (returns null) when its binding is empty or when it still
 *  holds an editor-only placeholder, so no bracketed prompt and no
 *  "TEXT NOT AVAILABLE" ever reaches the export. */
export function resolveObjectPaint(o: DeckObject, model: ICReportModel, fmt: DeckFmt): ExportPaint | null {
  switch (o.type) {
    case 'text': {
      if (o.binding) {
        const r = resolveText(o.binding, model, fmt);
        // Empty FORM/model text field: omit the line entirely (never amber
        // "TEXT NOT AVAILABLE"). e.g. cover "Prepared by" with no Parties set.
        if (!r.available) return null;
        return { kind: 'text', text: r.value, style: o.style, box: o.box };
      }
      // Unbound narrative still holding an editor placeholder: editor-only, omit.
      if (isPlaceholderText(o.text)) return null;
      return { kind: 'text', text: o.text, style: o.style, box: o.box };
    }
    case 'bullets': {
      // Drop any placeholder bullet lines; omit the block if none survive.
      const items = o.items.filter((it) => !isPlaceholderText(it));
      if (!items.length) return null;
      return { kind: 'bullets', items, numbered: !!o.numbered, markerColor: o.markerColor ?? DECK_THEME.navy, style: o.style, box: o.box };
    }
    case 'kpi': {
      const r = resolveMetric(o.metric, model, fmt);
      if (!r.available) return { kind: 'unlinked', label: 'Metric', reason: r.reason };
      const cols = kpiColors(o.variant, !!o.signColor, r.value.raw);
      return {
        kind: 'kpi',
        label: o.labelOverride ?? r.value.label,
        value: r.value.value,
        sub: o.subOverride ?? r.value.sub,
        variant: o.variant, ...cols,
      };
    }
    case 'chart': {
      const r = resolveChart(o.chart, model, fmt);
      if (!r.available) return { kind: 'unlinked', label: 'Chart', reason: r.reason };
      return { kind: 'chart', data: r.value, chartKind: o.kindOverride ?? r.value.kind, title: o.title ?? null, showLegend: o.showLegend !== false, showValues: !!o.showValues, box: o.box };
    }
    case 'table': {
      const r = resolveTable(o.table, model, fmt);
      if (!r.available) return { kind: 'unlinked', label: 'Table', reason: r.reason };
      return { kind: 'table', data: r.value, title: o.title ?? null, striped: !!o.striped, fontSize: o.fontSize ?? 11, box: o.box };
    }
    case 'image':
      return { kind: 'image', url: o.url, fit: o.fit, alt: o.alt ?? '', box: o.box };
    case 'shape': {
      // Keep the shape, but never let an editor placeholder ride in as its text.
      const text = o.text && !isPlaceholderText(o.text) ? o.text : '';
      return { kind: 'shape', shape: o.shape, box: o.box, text, style: o.style };
    }
    case 'divider':
      return { kind: 'divider', color: o.color, thickness: o.thickness };
    case 'gantt': {
      const p = model.programme;
      if (!p.lanes.length) return { kind: 'unlinked', label: 'Programme', reason: 'No phases are defined in this model' };
      return { kind: 'gantt', startYear: p.startYear, exitYear: p.exitYear, debtRepaidYear: p.debtRepaidYear, lanes: p.lanes };
    }
    case 'heatmap': {
      const s = model.sensitivity;
      if (!s.hasData) return { kind: 'unlinked', label: 'Sensitivity', reason: 'No sensitivity grid is configured for this model' };
      return heatmapPaint(o.title ?? 'Equity IRR', s, fmt);
    }
    case 'riskMatrix': {
      // Drop placeholder risk rows; blank a placeholder mitigant on a kept row.
      // An all-placeholder matrix (empty FORM) omits entirely.
      const rows = o.rows
        .filter((r) => !isPlaceholderText(r.risk))
        .map((r) => (isPlaceholderText(r.mitigation) ? { ...r, mitigation: '' } : r));
      if (!rows.length) return null;
      return { kind: 'riskMatrix', rows };
    }
    default:
      return { kind: 'unlinked', label: TYPE_LABEL[(o as DeckObject).type] ?? 'Object', reason: 'Unsupported object' };
  }
}

/** Colour-grade the sensitivity grid exactly as HeatmapView does. */
function heatmapPaint(title: string, s: ICReportModel['sensitivity'], fmt: DeckFmt): HeatmapPaint {
  const flat = s.irr.flat().filter((v): v is number => v !== null && Number.isFinite(v));
  const lo = flat.length ? Math.min(...flat) : 0;
  const hi = flat.length ? Math.max(...flat) : 0;
  const cells: HeatmapCell[][] = s.yValues.map((_y, ri) =>
    s.xValues.map((_x, ci) => {
      const v = s.irr[ri]?.[ci] ?? null;
      if (v === null || hi === lo) return { text: v === null ? 'n/a' : fmt.pct(v), fill: DECK_THEME.white, textColor: DECK_THEME.ink };
      const t = (v - lo) / (hi - lo);
      return { text: fmt.pct(v), fill: blendHex(DECK_THEME.pale, DECK_THEME.navy, t), textColor: t > 0.55 ? DECK_THEME.white : DECK_THEME.ink };
    }),
  );
  return {
    kind: 'heatmap', title,
    subtitle: `${s.yVariable} (rows) vs ${s.xVariable} (columns)`,
    xHeaders: s.xValues.map((x) => fmt.pct(x)),
    yHeaders: s.yValues.map((y) => fmt.pct(y)),
    cells,
  };
}

/** Local blend so this module needs no import from theme's blend (same math). */
function blendHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const k = Math.max(0, Math.min(1, t));
  const ch = (sh: number): number => {
    const va = (pa >> sh) & 0xff, vb = (pb >> sh) & 0xff;
    return Math.round(va + (vb - va) * k);
  };
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1).toUpperCase()}`;
}

// ── Deck resolution ──────────────────────────────────────────────────────────

/** Resolve the whole deck for export: drop hidden slides / objects, paint every
 *  binding, and precompute chrome text + visible page numbers. */
export function resolveDeckExport(deck: Deck, model: ICReportModel, fmt: DeckFmt): ExportDeck {
  const b = deck.branding;
  const visible = deck.slides.filter((sl) => !sl.hidden);
  const slides: ExportSlide[] = visible.map((sl, i) => {
    const hasChrome = sl.chrome !== 'cover' && sl.chrome !== 'blank';
    // ONE header band: the editable header text, right-aligned. The section
    // number chip + title live on the slide itself (titleBlock), so the band
    // never doubles up. headerLeft is intentionally empty.
    const chromeInfo: ExportChrome = {
      headerLeft: '',
      headerRight: b.whiteLabel ? b.companyName : b.headerText,
      footerLeft: b.footerText,
      pageNumber: hasChrome && b.showSlideNumbers ? i + 1 : null,
      show: hasChrome,
    };
    const objects: ExportObject[] = [];
    for (const o of sl.objects) {
      if (o.hidden) continue;
      const paint = resolveObjectPaint(o, model, fmt);
      if (paint === null) continue; // omitted (placeholder / empty text)
      objects.push({ id: o.id, x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot, paint });
    }
    return {
      id: sl.id, title: sl.title, chrome: sl.chrome,
      background: sl.background ?? DECK_THEME.canvas,
      objects, notes: sl.notes ?? '', chromeInfo,
    };
  });
  return {
    title: deck.title,
    primary: brandPrimary(b),
    fontHeading: b.fontHeading,
    fontBody: b.fontBody,
    slides,
  };
}

/** Resolve a font family name to a heading / body face for exporters that only
 *  know a fixed font set (the PDF renderer). Mirrors fontFor's role split. */
export const resolvedFont = (deck: ExportDeck, role: 'heading' | 'body'): string =>
  role === 'heading' ? deck.fontHeading : deck.fontBody;

/** Re-export so exporters share the theme's font role resolver for object styles. */
export { fontFor };
