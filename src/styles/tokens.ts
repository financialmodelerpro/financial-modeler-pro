/**
 * Design Tokens — Financial Modeler Pro
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all brand colors, typography, spacing, and
 * component-level semantic mappings.
 *
 * RULES:
 *  1. In React components, always prefer CSS custom properties (var(--token))
 *     for inline styles — they respond to light/dark mode and theming.
 *  2. Use these JS constants ONLY where CSS vars cannot be used:
 *       - Recharts / chart library props
 *       - @react-pdf/renderer (PDF export)
 *       - Computed rgba() tints (e.g. `rgba(${hex2rgb(COLOR.navy)}, 0.08)`)
 *       - Design documentation and Storybook
 *  3. Never hardcode hex values anywhere else. If a token is missing, ADD IT
 *     here AND in app/globals.css — keep both files in sync.
 *  4. Asset differentiation: navy shades ONLY. Never use green/purple/burgundy
 *     for asset tabs, accents, or KPI badges.
 *  5. Green = positive / equity ONLY. Red = negative / debt ONLY.
 *     Gold-dark = pre-construction (P0), land rows, finance cost.
 *
 * Tagline: Structured Modeling. Real-World Finance.
 */

// ── Brand Palette ─────────────────────────────────────────────────────────────

export const COLOR = {

  // Navy — primary brand, all UI structure, asset differentiation
  navyDarkest: '#0D2E5A',   // sidebar bg ONLY — never use in table headers or content areas
  navyDark:    '#1B3A6B',   // retail accent, stage 3, secondary header
  navy:        '#1B4F8A',   // primary action, residential accent, stage 1
  navyMid:     '#2D6BA8',   // hospitality accent, stage 2, secondary elements
  navyLight:   '#E8F0FB',   // hover bg, active state tint
  navyPale:    '#F4F7FC',   // page bg, card bg, table row alt

  // Green — positive values, equity, operations phase ONLY
  greenDark:  '#1A7A30',    // equity schedule title, positive text
  green:      '#2EAA4A',    // positive indicator, operations bar
  greenLight: '#E8F7EC',    // positive bg tint, equity badge bg

  // Gold / Amber — pre-construction (P0), land rows, finance cost, interest rate
  goldDark:   '#92400E',    // P0 column text, land row text/border, interest cost text
  gold:       '#C9A84C',    // rate highlight, interest rate KPI accent
  goldLight:  '#FDF6E3',    // P0 column bg tint, warning alert bg

  // Input fields (assumption cells — yellow background rule)
  inputBg:     '#FFFBEB',   // all .input-assumption yellow bg
  inputBorder: '#F59E0B',   // assumption input border

  // Semantic
  negative:   '#DC2626',    // debt values, losses, errors, red indicators
  positive:   '#2EAA4A',    // equity values, gains, success (alias of green)

  // Grey scale
  greyDark:   '#374151',    // body text, normal cell text
  greyMid:    '#6B7280',    // meta text, muted labels, empty cells
  greyLight:  '#D1D5DB',    // borders, dividers
  greyPale:   '#F5F7FA',    // table alt row, section bg
  greyWhite:  '#FFFFFF',    // card bg, input bg (non-assumption)

} as const;

export type ColorKey = keyof typeof COLOR;

// ── Asset color mapping ───────────────────────────────────────────────────────
// Navy shades ONLY — never purple, burgundy, or green for asset differentiation

export const ASSET_COLOR: Record<string, string> = {
  residential: COLOR.navy,      // primary navy
  hospitality: COLOR.navyMid,   // mid navy
  retail:      COLOR.navyDark,  // dark navy
};

export const ASSET_BG: Record<string, string> = {
  residential: COLOR.navyPale,
  hospitality: COLOR.navyPale,
  retail:      COLOR.navyPale,
};

export const ASSET_LABEL: Record<string, string> = {
  residential: 'Residential',
  hospitality: 'Hospitality',
  retail:      'Retail',
};

// ── Stage color mapping ───────────────────────────────────────────────────────
// Development cost stages — navy shades only

export const STAGE_COLOR: Record<number, string> = {
  1: COLOR.navy,      // Stage 1 — Direct Costs
  2: COLOR.navyMid,   // Stage 2 — Shared / Allocated Costs
  3: COLOR.navyDark,  // Stage 3 — Derived / Calculated Costs
};

// Translucent stage bg tints — pre-computed for inline styles
export const STAGE_BG_RGBA: Record<number, string> = {
  1: 'rgba(27,79,138,0.07)',    // navy at 7%
  2: 'rgba(45,107,168,0.07)',   // navyMid at 7%
  3: 'rgba(27,58,107,0.07)',    // navyDark at 7%
};

// ── Period phase colors ───────────────────────────────────────────────────────
// Used in schedule/timeline column headers

export const PHASE_COLOR = {
  pre:          COLOR.goldDark,                 // P0 — pre-construction text
  preBg:        'rgba(201,168,76,0.12)',         // P0 column bg tint
  construction: COLOR.navy,                     // construction phase text
  constructionBg: 'rgba(27,79,138,0.08)',        // construction column bg tint
  operations:   COLOR.greenDark,                // operations phase text
  operationsBg: 'rgba(26,122,48,0.08)',          // operations column bg tint
} as const;

// ── Schedule table header fills ───────────────────────────────────────────────

export const SCHEDULE_TITLE_BG = {
  debt:   `var(--color-primary-dark, ${COLOR.navy})`,   // Debt schedule title
  equity: `var(--color-green-dark)`,                    // Equity schedule title
} as const;

// ── Typography ────────────────────────────────────────────────────────────────

export const FONT = {
  family:     "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  familyMono: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",

  // Size scale (mirrors --font-* tokens in globals.css)
  h1:    '24px',
  h2:    '18px',
  h3:    '15px',
  body:  '13px',
  meta:  '11px',
  micro: '10px',

  // Weight
  regular:   400,
  medium:    500,
  semibold:  600,
  bold:      700,
  extrabold: 800,
} as const;

// ── Spacing (8px grid) ────────────────────────────────────────────────────────

export const SPACING = {
  1: '8px',
  2: '16px',
  3: '24px',
  4: '32px',
  5: '48px',
} as const;

// ── Border radius ─────────────────────────────────────────────────────────────

export const RADIUS = {
  sm:   '4px',
  md:   '8px',
  lg:   '12px',
  xl:   '16px',
  full: '9999px',
} as const;

// ── Shadows ───────────────────────────────────────────────────────────────────

export const SHADOW = {
  1: '0 1px 3px rgba(0,0,0,0.07)',
  2: '0 2px 8px rgba(0,0,0,0.10)',
  3: '0 4px 16px rgba(0,0,0,0.12)',
} as const;

// ── Layout ────────────────────────────────────────────────────────────────────

export const LAYOUT = {
  sidebarExpanded:  240,
  sidebarCollapsed: 52,
  topbarHeight:     52,
} as const;

// ── Plan / subscription badges ────────────────────────────────────────────────

export const PLAN_COLOR: Record<string, { bg: string; color: string }> = {
  free:         { bg: COLOR.greyPale,   color: COLOR.greyMid },
  professional: { bg: COLOR.navyPale,   color: COLOR.navy },
  enterprise:   { bg: '#F3E8FF',        color: '#7C3AED' },  // purple intentional for enterprise tier
};

export const STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  active:    { bg: COLOR.greenLight,  color: COLOR.greenDark },
  trial:     { bg: COLOR.goldLight,   color: COLOR.goldDark },
  expired:   { bg: '#FEE2E2',         color: COLOR.negative },
  cancelled: { bg: COLOR.greyPale,    color: COLOR.greyMid },
};

// ── KPI accent palette ────────────────────────────────────────────────────────
// Used for .kpi-card__accent strips — only navy shades and semantic colors

export const KPI_ACCENT = {
  totalCapex:     COLOR.navy,
  totalDebt:      COLOR.negative,
  totalEquity:    COLOR.greenDark,
  totalInterest:  COLOR.goldDark,
  ltv:            COLOR.navy,
  interestRate:   COLOR.gold,
  residential:    COLOR.navy,
  hospitality:    COLOR.navyMid,
  retail:         COLOR.navyDark,
} as const;
