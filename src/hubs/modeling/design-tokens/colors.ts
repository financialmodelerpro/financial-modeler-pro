/**
 * Modeling Hub — Color Tokens (Phase 1)
 *
 * Single source of truth for every color used across the Modeling Hub:
 * web UI (REFM today; BVM/FP&A/ERM/PFM/LBO/CFM/EUM/SVM/BCM tomorrow), the
 * Excel exporter, and the PDF exporter. All consumers import from here.
 *
 * Two palettes:
 *   chromeColors — corporate chrome (top bar, sidebar, table chrome, section
 *   bands, borders, surfaces). Anchored on the CMS-driven brand navy
 *   (`DEFAULT_BRANDING.primaryColor` in `src/core/branding/index.ts`). For
 *   Phase 1 the brand anchor is baked in as a TypeScript hex literal mirroring
 *   the CMS default; the live web UI also has a CSS-var override channel via
 *   `globals.css --color-primary` for runtime brand-color changes from CMS.
 *
 *   fastColors — FAST cell convention (Input blue / Formula black / Linked
 *   green / External red / Assumption yellow). Same hex values across web,
 *   Excel, and PDF so a model that opens with blue inputs and black formulas
 *   in the browser also opens that way in Excel and prints that way in PDF.
 *
 * Both palettes ship with `light` and `dark` variants. Web UI can switch via
 * a React theme provider or class-strategy `dark` ancestor; Excel and PDF
 * render in `light` regardless of browser theme since printed/saved
 * deliverables stay on the canonical FAST palette.
 */

// ── Brand anchor ─────────────────────────────────────────────────────────────
// Mirrors `DEFAULT_BRANDING.primaryColor` from `src/core/branding/index.ts:13`.
// Updating that file should also update this constant. The CMS admin can
// override `--color-primary` at runtime (see globals.css line 65) — that
// override flows through to the live web UI but does not affect Excel/PDF
// exports, which always use this baked-in literal.
export const BRAND_NAVY = '#1E3A8A' as const;

// ── 11-stop navy scale ───────────────────────────────────────────────────────
// Hand-picked rather than algorithmically derived, so the scale aligns with
// the existing globals.css custom properties (navy-darkest #0D2E5A through
// navy-pale #F4F7FC) and Tailwind's own colour intuitions. The brand anchor
// sits at the 800 stop.
export const navyScale = {
  50:  '#F0F4FA',
  100: '#DBE5F4',
  200: '#B7CBE9',
  300: '#93B0DD',
  400: '#6F95D2',
  500: '#4A7AC6',
  600: '#2D6BA8',  // matches existing --color-navy-mid
  700: '#1E5594',
  800: BRAND_NAVY, // ← brand anchor
  900: '#14306E',
  950: '#0D2E5A',  // matches existing --color-navy-darkest
} as const;

// ── 11-stop neutral grey scale ───────────────────────────────────────────────
// Aligned with Tailwind's `gray` palette so anyone eyeballing the modeling
// hub against a Tailwind reference picks up identical neutrals.
export const greyScale = {
  50:  '#F9FAFB',
  100: '#F3F4F6',
  200: '#E5E7EB',
  300: '#D1D5DB',
  400: '#9CA3AF',
  500: '#6B7280',
  600: '#4B5563',
  700: '#374151',
  800: '#1F2937',
  900: '#111827',
  950: '#030712',
} as const;

// ── Chrome (corporate skeleton) ──────────────────────────────────────────────
export interface ChromePalette {
  pageBg:            string;  // app body background
  surface:           string;  // card / panel background
  surfaceMuted:      string;  // secondary surface (zebra rows, panels)
  border:            string;  // 1px borders
  borderStrong:      string;  // emphasis borders
  divider:           string;  // hairline rules

  text:              string;  // primary body text
  textHeading:       string;  // section / page headings
  textMuted:         string;  // secondary / meta text
  textInverse:       string;  // text on dark chrome (white on navy)

  topBar:            string;  // top toolbar background
  topBarText:        string;
  sidebar:           string;  // left sidebar background
  sidebarText:       string;
  sidebarActive:     string;  // active sidebar item background
  sidebarActiveText: string;

  tableHeader:       string;  // <thead> background
  tableHeaderText:   string;
  tableRowAlt:       string;  // zebra alt row
  tableRowHover:     string;
  tableTotal:        string;  // total row band

  sectionHeader:     string;  // section title strip
  sectionHeaderText: string;

  // Asset sub-section accent (Residential / Hospitality / Retail bands).
  // Distinct from the canonical navy chrome so an asset sub-table reads as
  // a child of the parent module section.
  assetAccent:       string;
  assetAccentText:   string;

  // Timeline period tints — for tables whose columns map to periods on the
  // construction → operations axis. Used by Module 1 Costs / Financing in
  // both the web UI (Phase 4) and the Excel exporter (Phase 2).
  timelineConstrBg:    string;  // construction period column tint (zebra base)
  timelineConstrBgAlt: string;  // construction period zebra alt
  timelineConstrText:  string;  // text colour on construction period header
  timelineOpsBg:       string;  // operations period column tint (zebra base)
  timelineOpsBgAlt:    string;  // operations period zebra alt
  timelineOpsText:     string;  // text colour on operations period header
}

export const chromeColors: { light: ChromePalette; dark: ChromePalette } = {
  light: {
    pageBg:            greyScale[50],
    surface:           '#FFFFFF',
    surfaceMuted:      greyScale[100],
    border:            greyScale[200],
    borderStrong:      greyScale[300],
    divider:           greyScale[200],

    text:              greyScale[700],
    textHeading:       navyScale[950],
    textMuted:         greyScale[500],
    textInverse:       '#FFFFFF',

    topBar:            navyScale[950],
    topBarText:        '#FFFFFF',
    sidebar:           navyScale[950],
    sidebarText:       greyScale[200],
    sidebarActive:     navyScale[800],
    sidebarActiveText: '#FFFFFF',

    tableHeader:       navyScale[800],
    tableHeaderText:   '#FFFFFF',
    tableRowAlt:       navyScale[50],
    tableRowHover:     navyScale[100],
    tableTotal:        navyScale[900],

    sectionHeader:     navyScale[800],
    sectionHeaderText: '#FFFFFF',

    assetAccent:       '#1B6E50',  // forest green
    assetAccentText:   '#FFFFFF',

    timelineConstrBg:    '#FFF9E6',  // cream
    timelineConstrBgAlt: '#FFF2CC',  // stronger cream for zebra
    timelineConstrText:  '#78350F',  // gold-dark
    timelineOpsBg:       '#E8F5FF',  // pale blue
    timelineOpsBgAlt:    '#DAE8FC',  // stronger pale blue for zebra
    timelineOpsText:     navyScale[800],
  },
  dark: {
    pageBg:            greyScale[950],
    surface:           greyScale[900],
    surfaceMuted:      greyScale[800],
    border:            greyScale[700],
    borderStrong:      greyScale[600],
    divider:           greyScale[800],

    text:              greyScale[100],
    textHeading:       '#FFFFFF',
    textMuted:         greyScale[400],
    textInverse:       navyScale[950],

    topBar:            '#000000',
    topBarText:        '#FFFFFF',
    sidebar:           '#000000',
    sidebarText:       greyScale[300],
    sidebarActive:     navyScale[700],
    sidebarActiveText: '#FFFFFF',

    tableHeader:       navyScale[700],
    tableHeaderText:   '#FFFFFF',
    tableRowAlt:       greyScale[800],
    tableRowHover:     navyScale[900],
    tableTotal:        navyScale[800],

    sectionHeader:     navyScale[700],
    sectionHeaderText: '#FFFFFF',

    assetAccent:       '#22C55E',  // brighter green for dark-mode contrast
    assetAccentText:   '#FFFFFF',

    timelineConstrBg:    '#3F2E0A',  // muted dark amber
    timelineConstrBgAlt: '#5C4D00',
    timelineConstrText:  '#F2C088',
    timelineOpsBg:       '#1E3A5F',
    timelineOpsBgAlt:    '#22466F',
    timelineOpsText:     '#DBE5F4',
  },
};

// ── FAST cell convention ─────────────────────────────────────────────────────
// Canonical FAST palette as practised across institutional financial modeling
// (Macabacus, Marquee, F.A.S.T. Standard). Excel-canonical hex values are
// retained for `light` so a pasted Macabacus model lands on identical cells.
// Dark variants are perceptually balanced equivalents readable against a
// near-black background.
export interface FastPalette {
  inputText:       string;
  inputBg:         string;
  formulaText:     string;
  formulaBg:       string;
  linkedText:      string;
  linkedBg:        string;
  externalText:    string;
  externalBg:      string;
  assumptionText:  string;
  assumptionBg:    string;
  headerText:      string;
  headerBg:        string;
}

export const fastColors: { light: FastPalette; dark: FastPalette } = {
  light: {
    // Input — hardcoded user inputs. Excel-canonical FAST blue.
    inputText:      '#0070C0',
    inputBg:        '#FFFFFF',
    // Formula — calculated values. Black on light grey.
    formulaText:    '#000000',
    formulaBg:      greyScale[100],
    // Linked — cross-module pulled values. Excel-canonical FAST green.
    linkedText:     '#00B050',
    linkedBg:       '#FFFFFF',
    // External — references that point outside the model (e.g. to another
    // workbook, to a hardcoded value pasted from a research source).
    externalText:   '#FF0000',
    externalBg:     '#FFFFFF',
    // Assumption — the small set of inputs that drive the model. Yellow
    // background plus blue text (it is still an input).
    assumptionText: '#0070C0',
    assumptionBg:   '#FFFF99',
    // Header — section header band.
    headerText:     '#FFFFFF',
    headerBg:       navyScale[800],
  },
  dark: {
    inputText:      '#4FC3F7',
    inputBg:        greyScale[900],
    formulaText:    greyScale[100],
    formulaBg:      greyScale[800],
    linkedText:     '#66BB6A',
    linkedBg:       greyScale[900],
    externalText:   '#EF5350',
    externalBg:     greyScale[900],
    assumptionText: '#4FC3F7',
    assumptionBg:   '#5C4D00',
    headerText:     '#FFFFFF',
    headerBg:       navyScale[700],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a 6-char `#RRGGBB` hex to an 8-char `FFRRGGBB` ARGB string.
 * ExcelJS fill/font color expects ARGB with `FF` as the full-alpha prefix.
 * Falls back to `FF000000` (opaque black) on malformed input rather than
 * throwing, so the exporter degrades visibly rather than crashing.
 */
export function toArgb(hex: string): string {
  if (typeof hex !== 'string' || hex.length !== 7 || hex[0] !== '#') return 'FF000000';
  return `FF${hex.slice(1).toUpperCase()}`;
}

/**
 * Convert a 6-char hex to a `{ r, g, b }` triple in 0..1 normalized floats.
 * @react-pdf/renderer accepts CSS-style hex directly, but a few of its lower
 * level helpers prefer normalized floats — this converter handles both.
 */
export function toRgbTriple(hex: string): { r: number; g: number; b: number } {
  if (typeof hex !== 'string' || hex.length !== 7 || hex[0] !== '#') return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  };
}
