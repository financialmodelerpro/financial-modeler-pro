/**
 * tableStyles.ts
 *
 * Universal results-table style tokens. Applies to ALL platform module
 * results tables (Tab 1 Project Phases, Tab 2 Land, Tab 3 Costs, Tab 4
 * Financing, and every future module). Row treatments:
 *
 *   CELL_HEADER       - every <th> in a results table. Header-blue fill,
 *                       white uppercase bold text, centered horizontally
 *                       and vertically. Use for label and number columns
 *                       alike (universal alignment standard).
 *   ROW_ASSET_HEADING - group label inside a table. No fill, bold, no border.
 *   ROW_DATA          - individual data line. No fill, regular weight, no
 *                       border (explicitly overrides the project-wide
 *                       `td { border-bottom: 1px solid var(--color-border) }`
 *                       global, see app/globals.css line 319).
 *   ROW_SUBTOTAL      - per-asset subtotal. Light gray fill (navy 12% mix),
 *                       bold, top + bottom border in header-blue.
 *   ROW_GRAND_TOTAL   - final total row. Header-blue fill, white bold text,
 *                       top + bottom border in header-blue.
 *
 * Header blue == --color-navy (the navy used for table <th> backgrounds).
 * On-header text == --color-on-primary-navy (used for <th> text).
 * Subtotal light fill == navy 12% mix in srgb (consistent with the
 *   pre-Pass-11-Fix-16 subtotal background used across Module 1).
 *
 * Every cell token sets `verticalAlign: 'middle'` so labels + numbers
 * stay vertically centered regardless of row height. Horizontal
 * alignment is per-token: CELL_HEADER is centered; ROW_* `.name` is
 * left-aligned (labels), `.num` is right-aligned (numerics).
 *
 * Helpers return cell-level style objects since the table layer composes
 * styles per-<td> (a row-level style alone does not paint background on
 * individual cells reliably across all browsers / table modes).
 */

import type { CSSProperties } from 'react';

export const TABLE_HEADER_BLUE = 'var(--color-navy)';
export const TABLE_HEADER_TEXT = 'var(--color-on-primary-navy)';
export const ROW_SUBTOTAL_FILL = 'color-mix(in srgb, var(--color-navy) 12%, transparent)';

// Base cell padding + typography shared across all row types. Tables can
// override (e.g. label cells get textAlign:left, number cells right).
// `verticalAlign: 'middle'` keeps cells vertically centered regardless
// of row height (universal alignment standard). `borderTop: 'none' /
// borderBottom: 'none'` overrides the project-wide
// `td { border-bottom: 1px solid var(--color-border) }` in globals.css;
// row tokens that want a border re-declare it below.
const CELL_BASE: CSSProperties = {
  padding: '4px 6px',
  fontSize: 11,
  verticalAlign: 'middle',
  borderTop: 'none',
  borderBottom: 'none',
};

// Universal table title (caption rendered above a table). Every
// caption above a results table - "Table 1 - Construction Cost Schedule
// by Period", "1. Capital Stack Summary", "Land Funding (per parcel)",
// etc. - should route through this token so the bold treatment is
// explicit (does not rely on <strong>/<h3> default browser semantics)
// and stays consistent across modules. Renders as a block element with
// a small bottom margin so the table sits flush below.
export const TABLE_TITLE: CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 'var(--sp-1)',
  color: 'var(--color-heading)',
};

// Universal table header cell. Every results-table <th> should use this
// token so all platform tables share the same header treatment: navy
// fill, white uppercase bold text, horizontally + vertically centered.
// Applies to BOTH the first label column ("ASSET / COST LINE", "PARCEL
// NAME", etc.) and the number columns ("TOTAL", period labels).
export const CELL_HEADER: CSSProperties = {
  background: TABLE_HEADER_BLUE,
  color: TABLE_HEADER_TEXT,
  padding: '6px',
  textAlign: 'center',
  verticalAlign: 'middle',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
  borderTop: 'none',
  borderBottom: `1px solid var(--color-navy-dark, ${TABLE_HEADER_BLUE})`,
};

// Numeric cells set `whiteSpace: 'nowrap'` so fixed-layout result tables
// (see COLUMN_WIDTHS + colgroup pattern below) keep numbers on a single
// line even when the column is sized to a smaller width than the value
// would naturally take. Label cells stay wrappable so long row labels
// don't blow out the layout.
//
// Pass 35 (2026-05-14): every row token now exposes a `numTotal`
// variant that's identical to `num` but adds a 1px right border in
// `--color-border-strong` (or border fallback). Used for the Total
// column (the second cell of every results row) so it visually
// separates from the period columns. Header cells get the same
// treatment via CELL_HEADER_TOTAL.
const TOTAL_COL_BORDER = `1px dashed var(--color-border-strong, var(--color-border))`;
const TOTAL_COL_BORDER_ON_NAVY = `1px dashed color-mix(in srgb, var(--color-on-primary-navy) 50%, transparent)`;

export const CELL_HEADER_TOTAL: CSSProperties = {
  ...CELL_HEADER,
  borderRight: TOTAL_COL_BORDER_ON_NAVY,
};

export const ROW_DATA = {
  name: { ...CELL_BASE, textAlign: 'left' as const, fontWeight: 400 },
  num: { ...CELL_BASE, textAlign: 'right' as const, fontWeight: 400, whiteSpace: 'nowrap' as const },
  numTotal: {
    ...CELL_BASE,
    textAlign: 'right' as const,
    fontWeight: 400,
    whiteSpace: 'nowrap' as const,
    borderRight: TOTAL_COL_BORDER,
  },
};

export const ROW_ASSET_HEADING = {
  name: { ...CELL_BASE, textAlign: 'left' as const, fontWeight: 700, fontSize: 12 },
  num: { ...CELL_BASE, textAlign: 'right' as const, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' as const },
  numTotal: {
    ...CELL_BASE,
    textAlign: 'right' as const,
    fontWeight: 700,
    fontSize: 12,
    whiteSpace: 'nowrap' as const,
    borderRight: TOTAL_COL_BORDER,
  },
};

export const ROW_SUBTOTAL = {
  name: {
    ...CELL_BASE,
    textAlign: 'left' as const,
    fontWeight: 700,
    background: ROW_SUBTOTAL_FILL,
    borderTop: `1px solid ${TABLE_HEADER_BLUE}`,
    borderBottom: `1px solid ${TABLE_HEADER_BLUE}`,
  },
  num: {
    ...CELL_BASE,
    textAlign: 'right' as const,
    fontWeight: 700,
    whiteSpace: 'nowrap' as const,
    background: ROW_SUBTOTAL_FILL,
    borderTop: `1px solid ${TABLE_HEADER_BLUE}`,
    borderBottom: `1px solid ${TABLE_HEADER_BLUE}`,
  },
  numTotal: {
    ...CELL_BASE,
    textAlign: 'right' as const,
    fontWeight: 700,
    whiteSpace: 'nowrap' as const,
    background: ROW_SUBTOTAL_FILL,
    borderTop: `1px solid ${TABLE_HEADER_BLUE}`,
    borderBottom: `1px solid ${TABLE_HEADER_BLUE}`,
    borderRight: TOTAL_COL_BORDER,
  },
};

export const ROW_GRAND_TOTAL = {
  name: {
    ...CELL_BASE,
    textAlign: 'left' as const,
    fontWeight: 700,
    background: TABLE_HEADER_BLUE,
    color: TABLE_HEADER_TEXT,
    borderTop: `1px solid ${TABLE_HEADER_BLUE}`,
    borderBottom: `1px solid ${TABLE_HEADER_BLUE}`,
  },
  num: {
    ...CELL_BASE,
    textAlign: 'right' as const,
    fontWeight: 700,
    whiteSpace: 'nowrap' as const,
    background: TABLE_HEADER_BLUE,
    color: TABLE_HEADER_TEXT,
    borderTop: `1px solid ${TABLE_HEADER_BLUE}`,
    borderBottom: `1px solid ${TABLE_HEADER_BLUE}`,
  },
  numTotal: {
    ...CELL_BASE,
    textAlign: 'right' as const,
    fontWeight: 700,
    whiteSpace: 'nowrap' as const,
    background: TABLE_HEADER_BLUE,
    color: TABLE_HEADER_TEXT,
    borderTop: `1px solid ${TABLE_HEADER_BLUE}`,
    borderBottom: `1px solid ${TABLE_HEADER_BLUE}`,
    borderRight: TOTAL_COL_BORDER_ON_NAVY,
  },
};

// Universal column widths for every period-axis results table.
//
// Excel-grid rule (2026-06-01): FIXED PIXEL column widths. The label
// (description) column and every non-label column (Total + prior +
// each period) hold a constant width regardless of how many years the
// project runs. When the period count grows past what the workspace
// can show, the table outgrows its container and the surrounding
// `overflowX: 'auto'` wrapper scrolls horizontally, exactly like
// Excel, instead of compressing the year columns until the numbers
// overlap (the prior percentage-based behaviour).
//
// Why fixed px:
//   - Numbers never overlap: a 96px column always fits a formatted
//     value at the platform's 11px numeric font, no matter the year
//     count.
//   - Tables on the same page still align column-for-column because
//     every consumer derives the same px widths from these constants.
//   - The description column stays put; only the scroll position
//     moves when the user pans across a long horizon.
//
// Render pattern:
//   const nonLabelPct = nonLabelColumnPct(axis.count); // -> fixed px
//   <div style={{ overflowX: 'auto' }}>
//     <table style={periodTableStyle(axis.count)}>
//       <colgroup>
//         <col style={{ width: COLUMN_WIDTHS.label }} />   // label
//         <col style={{ width: nonLabelPct }} />            // total
//         {axis.labels.map(() => <col style={{ width: nonLabelPct }} />)}
//       </colgroup>
//       ...
//     </table>
//   </div>

/** Description / label column width (px). Excel-style: stays constant. */
export const PERIOD_LABEL_PX = 260;
/** Total + prior + each period column width (px). ~Excel column width 13. */
export const PERIOD_COL_PX = 96;
/** Optional Phase column width (px), used by the M4 period table. */
export const PERIOD_PHASE_PX = 60;

export const COLUMN_WIDTHS = {
  /** Label column: fixed px (Excel-style description column). */
  label: `${PERIOD_LABEL_PX}px`,
} as const;

/**
 * Fixed pixel width applied to the Total column AND every period
 * column. The `nonLabelColumnCount` argument is retained for call-site
 * compatibility but no longer affects the width: every non-label
 * column is a constant `PERIOD_COL_PX` so the year axis never
 * compresses (it scrolls instead, see `periodTableStyle`).
 */
export function nonLabelColumnPct(_nonLabelColumnCount?: number): string {
  return `${PERIOD_COL_PX}px`;
}

/**
 * Table-element style for a period-axis results table. Sets an explicit
 * pixel `width` (label + every non-label column) with `minWidth: 100%`
 * so the table fills the workspace when there is room to spare, but
 * grows past the container and triggers the wrapper's horizontal scroll
 * once the year columns no longer fit. `tableLayout: 'fixed'` keeps the
 * colgroup widths authoritative.
 *
 * @param nonLabelColumnCount Total + prior + every period column (i.e.
 *   every column except the label and any Phase column).
 * @param extraPx Width of any additional fixed columns not counted in
 *   `nonLabelColumnCount` (e.g. the M4 Phase column). Defaults to 0.
 */
export function periodTableStyle(nonLabelColumnCount: number, extraPx = 0): CSSProperties {
  const cols = Math.max(1, nonLabelColumnCount);
  const width = PERIOD_LABEL_PX + extraPx + cols * PERIOD_COL_PX;
  return { minWidth: '100%', width, tableLayout: 'fixed', borderCollapse: 'collapse' };
}
