/**
 * theme.ts (REFM Module 7, IC Presentation Builder: the brand system)
 *
 * The single source of truth for every colour, font and type step the deck can
 * paint. Canvas, PPTX, PDF and PNG all read from here, so a change lands on all
 * four surfaces at once.
 *
 * The palette is taken verbatim from the "REFM Report Color Coding" reference
 * slide, which specifies:
 *
 *   #B9C9DC / #6E9BCB / #4E7CB0 / #1B4F8A   the four-step graph ramp (light to dark)
 *   #D9D9D9                                  table rows
 *   #2E7D52                                  totals and main bold
 *   #B23A3A                                  outliers and red flags
 *
 * plus the header band navy (#1B4F8A), the slate header/footer text (#5A6675 /
 * #8898AA) and the body ink (#2A3440) read off the same slide's own chrome.
 *
 * The ramp is ordered light-to-dark deliberately. Categorical series read best
 * when the darkest step carries the most important category, so CHART_SERIES
 * hands out `navy` first and steps lighter, while SEQUENTIAL keeps the light-to
 * -dark order for a magnitude scale.
 *
 * Hex is stored WITH the leading '#', because that is what CSS and Recharts
 * want. pptxgenjs wants it without, so the exporter strips it in one place
 * (`noHash`) rather than every surface keeping a parallel copy, which is how the
 * old renderer let its two palettes drift.
 *
 * No em dashes in this file.
 */

import type { DeckBranding, TextStyle } from './types';

export const DECK_THEME = {
  /** The four-step graph ramp from the reference slide, light to dark. */
  ramp: ['#B9C9DC', '#6E9BCB', '#4E7CB0', '#1B4F8A'] as const,

  navy: '#1B4F8A',        // primary brand + header band
  navyDeep: '#0D2E5A',    // cover wash, emphasis blocks
  navyMid: '#4E7CB0',     // ramp step 3
  navyLight: '#6E9BCB',   // ramp step 2
  pale: '#B9C9DC',        // ramp step 1
  paleWash: '#DDE7F3',    // tile fills, subtle bands

  green: '#2E7D52',       // totals, main bold, positive
  red: '#B23A3A',         // outlier, red flag, negative

  rowGrey: '#D9D9D9',     // table rows
  ink: '#2A3440',         // body text
  slate: '#5A6675',       // secondary text, findings
  slateLight: '#8898AA',  // footer text, captions
  rule: '#DCE3EC',        // hairlines
  white: '#FFFFFF',
  canvas: '#FFFFFF',
  offWhite: '#F7F9FC',    // the editor's very light grey backdrop
} as const;

/** Categorical series colours, most-important first. */
export const CHART_SERIES: readonly string[] = [
  DECK_THEME.navy, DECK_THEME.navyLight, DECK_THEME.navyMid, DECK_THEME.pale, DECK_THEME.green, DECK_THEME.slateLight,
];

/** Magnitude ramp, low to high. */
export const SEQUENTIAL: readonly string[] = DECK_THEME.ramp;

/** Positive / negative semantics, used by waterfalls and sign-coloured KPIs. */
export const signColor = (v: number): string => (v < 0 ? DECK_THEME.red : DECK_THEME.green);

/** pptxgenjs wants bare hex. One conversion point for the whole exporter. */
export const noHash = (hex: string): string => hex.replace('#', '').toUpperCase();

/** Blend two hex colours. Used by the sensitivity heatmap's colour grading. */
export function blend(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const k = Math.max(0, Math.min(1, t));
  const ch = (sh: number): number => {
    const va = (pa >> sh) & 0xff, vb = (pb >> sh) & 0xff;
    return Math.round(va + (vb - va) * k);
  };
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1).toUpperCase()}`;
}

// ── Type scale ──────────────────────────────────────────────────────────────
// Institutional decks use few, large steps. These are the only sizes templates
// reach for; a user can still set any size per object.

export const TYPE_SCALE = {
  coverTitle: 54,
  coverSub: 20,
  slideTitle: 26,
  sectionNum: 15,
  finding: 13,     // the italic slate line under a title
  kpiValue: 30,
  kpiValueSm: 24,
  kpiLabel: 10,    // uppercase, tracked
  kpiSub: 10,
  body: 13,
  bullet: 14,
  table: 11,
  tableHead: 10,
  caption: 11,
  chrome: 9,       // header / footer band text
} as const;

export const DEFAULT_BRANDING: DeckBranding = {
  logoUrl: null,
  companyName: 'Financial Modeler Pro',
  confidentialLabel: 'Strictly Private & Confidential',
  headerText: 'FMP RE HUB  ·  Investment Committee Report',
  footerText: 'Financial Modeler Pro  ·  Strictly Private & Confidential',
  primary: null,
  secondary: null,
  fontHeading: 'Cambria',
  fontBody: 'Calibri',
  showSlideNumbers: true,
  whiteLabel: false,
};

/** Resolve a branding override against the theme default. */
export const brandPrimary = (b: DeckBranding): string => b.primary ?? DECK_THEME.navy;
export const brandSecondary = (b: DeckBranding): string => b.secondary ?? DECK_THEME.green;

export const fontFor = (b: DeckBranding, role: 'heading' | 'body'): string =>
  role === 'heading' ? b.fontHeading : b.fontBody;

/** The CSS stack for a resolved family. The named face comes first so a machine
 *  that has Calibri/Cambria renders exactly what PowerPoint will. */
export const fontStack = (family: string): string =>
  `${family}, "Segoe UI", -apple-system, "Helvetica Neue", Arial, sans-serif`;

// ── Text style factories ────────────────────────────────────────────────────
// Templates build styles from these rather than hand-writing objects, so one
// tweak here re-styles every slide of that kind.

const base = (over: Partial<TextStyle> = {}): TextStyle => ({
  fontRole: 'body',
  size: TYPE_SCALE.body,
  color: DECK_THEME.ink,
  align: 'left',
  valign: 'top',
  lineHeight: 1.35,
  ...over,
});

export const textStyles = {
  coverTitle: (): TextStyle => base({ fontRole: 'heading', size: TYPE_SCALE.coverTitle, color: DECK_THEME.white, bold: true, lineHeight: 1.1 }),
  coverSub: (): TextStyle => base({ size: TYPE_SCALE.coverSub, color: DECK_THEME.pale, lineHeight: 1.3 }),
  slideTitle: (): TextStyle => base({ fontRole: 'heading', size: TYPE_SCALE.slideTitle, color: DECK_THEME.navy, bold: true, valign: 'middle' }),
  finding: (): TextStyle => base({ size: TYPE_SCALE.finding, color: DECK_THEME.slate, italic: true, valign: 'middle' }),
  kpiLabel: (): TextStyle => base({ size: TYPE_SCALE.kpiLabel, color: DECK_THEME.slate, uppercase: true, letterSpacing: 0.6, bold: true }),
  kpiValue: (): TextStyle => base({ fontRole: 'heading', size: TYPE_SCALE.kpiValue, color: DECK_THEME.navy, bold: true }),
  kpiSub: (): TextStyle => base({ size: TYPE_SCALE.kpiSub, color: DECK_THEME.slateLight }),
  body: (): TextStyle => base({}),
  bullet: (): TextStyle => base({ size: TYPE_SCALE.bullet, lineHeight: 1.5 }),
  caption: (): TextStyle => base({ size: TYPE_SCALE.caption, color: DECK_THEME.slate, lineHeight: 1.45 }),
  captionHead: (): TextStyle => base({ fontRole: 'heading', size: TYPE_SCALE.body, color: DECK_THEME.navy, bold: true }),
  onNavy: (): TextStyle => base({ color: DECK_THEME.white, lineHeight: 1.45 }),
  chrome: (): TextStyle => base({ size: TYPE_SCALE.chrome, color: DECK_THEME.slateLight, valign: 'middle' }),
} as const;
