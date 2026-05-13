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
export const ROW_DATA = {
  name: { ...CELL_BASE, textAlign: 'left' as const, fontWeight: 400 },
  num: { ...CELL_BASE, textAlign: 'right' as const, fontWeight: 400, whiteSpace: 'nowrap' as const },
};

export const ROW_ASSET_HEADING = {
  name: { ...CELL_BASE, textAlign: 'left' as const, fontWeight: 700, fontSize: 12 },
  num: { ...CELL_BASE, textAlign: 'right' as const, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' as const },
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
};

// Universal column widths for every period-axis results table.
//
// M2.0 Pass 14 (2026-05-13) rule: percentage-based widths that
// re-balance automatically when the period count changes. Label
// column is fixed at 22% of table width; the remaining 78% is split
// EQUALLY across the Total column + every period column. So a table
// with 1 Total + N period cols gives each non-label column
// `78 / (1 + N) %`, and all non-label columns are the same width.
//
// Why this shape:
//   - Tables on the same page share column widths column-for-column
//     because every consumer derives the same percentage from the
//     same axis count.
//   - Extend a phase's operating periods, every non-label column
//     shrinks proportionally and the label stays at 22%.
//   - No horizontal scroll needed at typical project durations
//     (10-25 years). On extreme projects (40+ years) columns get
//     narrow, which is expected and acceptable since annual projects
//     rarely run that long.
//
// Render pattern:
//   const nonLabelPct = nonLabelColumnPct(axis.count);
//   <div style={{ overflowX: 'auto' }}>
//     <table style={{ width: '100%', tableLayout: 'fixed',
//                     borderCollapse: 'collapse' }}>
//       <colgroup>
//         <col style={{ width: COLUMN_WIDTHS.label }} />   // label
//         <col style={{ width: nonLabelPct }} />            // total
//         {axis.labels.map(() => <col style={{ width: nonLabelPct }} />)}
//       </colgroup>
//       ...
//     </table>
//   </div>
export const COLUMN_WIDTHS = {
  /** Label column: 22% of table width. */
  label: '22%',
} as const;

/**
 * Equal-width percentage applied to the Total column AND every period
 * column. `nonLabelColumnCount` = 1 (Total) + axis.count (prior +
 * active period columns). Splits the remaining 78% evenly so all
 * non-label cells render at the same width.
 */
export function nonLabelColumnPct(nonLabelColumnCount: number): string {
  const denom = Math.max(1, nonLabelColumnCount);
  return `${(78 / denom).toFixed(4)}%`;
}
