/**
 * types.ts (REFM Module 7, IC Presentation Builder: the deck document model)
 *
 * The slide-object document that the presentation builder edits, persists and
 * exports. This is a PURE data model: no React, no engine, no formatting. It is
 * the single contract shared by the canvas (DOM), the PPTX exporter (pptxgenjs),
 * the PDF exporter (pdf-lib) and the image exporter (satori).
 *
 * Two ideas carry the whole design:
 *
 * 1. EVERY object is positioned in LOGICAL PIXELS on a fixed 1280 x 720 canvas.
 *    1280 x 720 is exactly 13.333in x 7.5in at 96 dpi, which is pptxgenjs's
 *    LAYOUT_WIDE. So an object's box converts to PowerPoint inches by a single
 *    divide by PX_PER_IN, with no layout re-flow and no drift. What the user
 *    drags is literally what PowerPoint receives.
 *
 * 2. Data-driven objects hold a BINDING KEY, never a copied number. A KPI stores
 *    'headline.projectIrr', not "11.9%". Resolution happens at render time
 *    against the live ICReportModel, so when Modules 1-6 change, every slide
 *    follows. A binding that cannot resolve renders a visible unlinked state
 *    (see bindings.ts) rather than a stale figure: "broken links are never
 *    allowed" means never silently wrong, not never absent.
 *
 * No em dashes in this file.
 */

import type { ChartBindingKey, MetricBindingKey, TableBindingKey, TextBindingKey } from './bindings';

/** Logical canvas. 16:9. Matches pptxgenjs LAYOUT_WIDE (13.333in x 7.5in @ 96dpi). */
export const SLIDE_W = 1280;
export const SLIDE_H = 720;
/** Logical px per inch. SLIDE_W / PX_PER_IN = 13.333in exactly. */
export const PX_PER_IN = 96;
/** Snap grid. Objects land on multiples of this so a dragged deck stays aligned. */
export const GRID = 8;
/** The institutional margin. Content lives inside this on every template. */
export const MARGIN = 48;
/** Usable content width between margins. */
export const CONTENT_W = SLIDE_W - MARGIN * 2;

export const pxToIn = (px: number): number => px / PX_PER_IN;

// ── Shared style primitives ─────────────────────────────────────────────────

/** Which theme font role to use. Resolved to a real family by the theme, so a
 *  font swap in Brand Controls re-fonts the whole deck with no per-object edit. */
export type FontRole = 'heading' | 'body';

export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

export interface TextStyle {
  fontRole: FontRole;
  /** Explicit family overrides fontRole when the user picks one per object. */
  fontFamily?: string | null;
  size: number;          // logical px
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color: string;         // '#RRGGBB'
  align: TextAlign;
  valign: VerticalAlign;
  lineHeight?: number;   // multiplier, default 1.3
  letterSpacing?: number;// logical px
  uppercase?: boolean;
}

export interface BoxStyle {
  fill?: string | null;                                  // '#RRGGBB' or null
  border?: { color: string; width: number } | null;
  radius?: number;                                       // logical px
  opacity?: number;                                      // 0..1
  padding?: number;                                      // logical px
  shadow?: boolean;
}

// ── Objects ─────────────────────────────────────────────────────────────────

export type DeckObjectType =
  | 'text' | 'bullets' | 'kpi' | 'chart' | 'table'
  | 'image' | 'shape' | 'divider' | 'gantt' | 'heatmap' | 'riskMatrix';

export interface BaseObject {
  id: string;
  type: DeckObjectType;
  /** Shown in the layers list. Falls back to a type label when absent. */
  name?: string;
  x: number; y: number; w: number; h: number;  // logical px, top-left origin
  rot: number;                                  // degrees, clockwise
  locked?: boolean;
  hidden?: boolean;
  /** Group membership. Objects sharing a groupId move and resize together. */
  groupId?: string | null;
  box?: BoxStyle;
}

/** A single text run. `binding` makes it dynamic (e.g. the project name); when
 *  set, `text` holds the last resolved value purely as an export/offline
 *  fallback and is never authoritative on screen. */
export interface TextObject extends BaseObject {
  type: 'text';
  text: string;
  binding?: TextBindingKey | null;
  style: TextStyle;
}

export interface BulletsObject extends BaseObject {
  type: 'bullets';
  items: string[];
  numbered?: boolean;
  /** Bullet glyph colour; the text colour comes from `style`. */
  markerColor?: string;
  style: TextStyle;
}

export type KpiVariant = 'pale' | 'navy' | 'green' | 'plain';

/** A headline metric tile. The number is ALWAYS resolved from `metric`. */
export interface KpiObject extends BaseObject {
  type: 'kpi';
  metric: MetricBindingKey;
  /** Override the registry's default label. null = use the registry label. */
  labelOverride?: string | null;
  subOverride?: string | null;
  variant: KpiVariant;
  /** Colour the value green when positive / red when negative. */
  signColor?: boolean;
}

export type ChartKind = 'column' | 'stackedColumn' | 'bar' | 'line' | 'doughnut' | 'waterfall';

export interface ChartObject extends BaseObject {
  type: 'chart';
  chart: ChartBindingKey;
  /** The registry supplies a natural default; this overrides it. */
  kindOverride?: ChartKind | null;
  title?: string | null;
  showLegend?: boolean;
  showValues?: boolean;
}

export interface TableObject extends BaseObject {
  type: 'table';
  table: TableBindingKey;
  title?: string | null;
  /** Zebra-stripe body rows with the theme's row grey. */
  striped?: boolean;
  fontSize?: number;
}

export type ImageFit = 'cover' | 'contain' | 'fill';

export interface ImageObject extends BaseObject {
  type: 'image';
  /** Public storage URL, or null for an empty placeholder frame. */
  url: string | null;
  alt?: string;
  fit: ImageFit;
  /** Normalized 0..1 crop rect against the source image. */
  crop?: { x: number; y: number; w: number; h: number } | null;
}

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'triangle' | 'chevron';

export interface ShapeObject extends BaseObject {
  type: 'shape';
  shape: ShapeKind;
  /** Optional centered label inside the shape. */
  text?: string;
  style?: TextStyle;
}

export interface DividerObject extends BaseObject {
  type: 'divider';
  color: string;
  thickness: number;
}

/** The development-programme swimlane Gantt. Fully model-driven: phases,
 *  windows and markers all come from ICReportModel.programme. */
export interface GanttObject extends BaseObject {
  type: 'gantt';
  showMarkers?: boolean;
}

/** The two-way sensitivity grid, colour-graded. Model-driven from
 *  ICReportModel.sensitivity. */
export interface HeatmapObject extends BaseObject {
  type: 'heatmap';
  title?: string | null;
}

export interface RiskMatrixRow {
  risk: string;
  likelihood: 'Low' | 'Medium' | 'High';
  impact: 'Low' | 'Medium' | 'High';
  mitigation: string;
}

/** Editable narrative object (not model-bound): the IC risk register. */
export interface RiskMatrixObject extends BaseObject {
  type: 'riskMatrix';
  rows: RiskMatrixRow[];
}

export type DeckObject =
  | TextObject | BulletsObject | KpiObject | ChartObject | TableObject
  | ImageObject | ShapeObject | DividerObject | GanttObject | HeatmapObject | RiskMatrixObject;

// ── Slides + deck ───────────────────────────────────────────────────────────

/** Which chrome the slide wears. 'cover' and 'section' are full-bleed navy and
 *  intentionally carry no header band. */
export type SlideChrome = 'content' | 'cover' | 'section' | 'blank';

export interface Slide {
  id: string;
  /** Shown in the navigator. */
  title: string;
  chrome: SlideChrome;
  /** The italic finding line under the title. Empty = auto from icFindingLine. */
  finding?: string;
  background?: string | null;
  hidden?: boolean;
  locked?: boolean;
  /** Presenter notes; exported to the PPTX notes pane. */
  notes?: string;
  /** Paint order: index 0 is furthest back. z-order IS array order. */
  objects: DeckObject[];
  /** The template this slide was created from, so "reset to layout" can rebuild
   *  it and an auto-omit rule can tell whether the model still supports it. */
  templateId?: string | null;
}

export interface DeckBranding {
  /** null = use the Financial Modeler Pro default mark. */
  logoUrl: string | null;
  companyName: string;
  confidentialLabel: string;
  headerText: string;
  footerText: string;
  /** Theme colour overrides. null entries fall back to DECK_THEME. */
  primary: string | null;
  secondary: string | null;
  fontHeading: string;
  fontBody: string;
  showSlideNumbers: boolean;
  /** White label strips the FMP mark and uses the client's logo only. */
  whiteLabel: boolean;
}

export type DeckMoneyScale = 'millions' | 'thousands';
export type DeckCase = 'management' | 'active';

export interface DeckSettings {
  /** Which case drives every bound number. Defaults to the Management base so a
   *  deck does not silently change when someone switches the topbar case. */
  deckCase: DeckCase;
  moneyScale: DeckMoneyScale;
  asOf: string; // ISO date
}

export const DECK_SCHEMA_VERSION = 1;

export interface Deck {
  schemaVersion: number;
  projectId: string;
  title: string;
  slides: Slide[];
  branding: DeckBranding;
  settings: DeckSettings;
  /** ISO stamp of the last save, set server-side. */
  updatedAt?: string | null;
}

// ── Geometry helpers (shared by canvas, exporters and templates) ─────────────

export const snap = (v: number, grid: number = GRID): number => Math.round(v / grid) * grid;

export const clampToCanvas = (o: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } => ({
  x: Math.min(Math.max(o.x, -o.w + 16), SLIDE_W - 16),
  y: Math.min(Math.max(o.y, -o.h + 16), SLIDE_H - 16),
  w: Math.max(o.w, 16),
  h: Math.max(o.h, 16),
});

/** Lay `count` boxes across `w` with `gap` between them, returning each x/width.
 *  Templates use this so tile rows are exactly even instead of hand-tuned. */
export function rowSlots(x: number, w: number, count: number, gap = 16): Array<{ x: number; w: number }> {
  if (count <= 0) return [];
  const each = (w - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, i) => ({ x: x + i * (each + gap), w: each }));
}

let idSeq = 0;
/** Deterministic, collision-free within a session. Not crypto, and deliberately
 *  not Date.now()/Math.random() so template output stays diffable in verifiers. */
export const deckId = (prefix: string): string => `${prefix}_${(idSeq++).toString(36)}`;
/** Reset between template builds so a rebuilt deck yields identical ids. */
export const resetDeckIds = (): void => { idSeq = 0; };
