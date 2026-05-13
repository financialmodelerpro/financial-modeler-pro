/**
 * tableStyles.ts
 *
 * Universal results-table row-style tokens. Applies to ALL platform module
 * results tables (Tab 1 Project Phases, Tab 2 Land, Tab 3 Costs, Tab 4
 * Financing, and every future module). Row treatments:
 *
 *   ROW_ASSET_HEADING - group label inside a table. No fill, bold, no border.
 *   ROW_DATA          - individual data line. No fill, regular weight, no border.
 *   ROW_SUBTOTAL      - per-asset subtotal. No fill, bold, top border in
 *                       header-blue.
 *   ROW_GRAND_TOTAL   - final total row. Header-blue fill, white bold text,
 *                       top + bottom border in header-blue.
 *
 * Header blue == --color-navy (the navy used for table <th> backgrounds).
 * On-header text == --color-on-primary-navy (used for <th> text).
 *
 * Helpers return cell-level style objects since the table layer composes
 * styles per-<td> (a row-level style alone does not paint background on
 * individual cells reliably across all browsers / table modes).
 */

import type { CSSProperties } from 'react';

export const TABLE_HEADER_BLUE = 'var(--color-navy)';
export const TABLE_HEADER_TEXT = 'var(--color-on-primary-navy)';

// Base cell padding + typography shared across all row types. Tables can
// override (e.g. label cells get textAlign:left, number cells right).
const CELL_BASE: CSSProperties = {
  padding: '4px 6px',
  fontSize: 11,
};

export const ROW_DATA = {
  name: { ...CELL_BASE, textAlign: 'left' as const, fontWeight: 400 },
  num: { ...CELL_BASE, textAlign: 'right' as const, fontWeight: 400 },
};

export const ROW_ASSET_HEADING = {
  name: { ...CELL_BASE, textAlign: 'left' as const, fontWeight: 700, fontSize: 12 },
  num: { ...CELL_BASE, textAlign: 'right' as const, fontWeight: 700, fontSize: 12 },
};

export const ROW_SUBTOTAL = {
  name: {
    ...CELL_BASE,
    textAlign: 'left' as const,
    fontWeight: 700,
    borderTop: `1px solid ${TABLE_HEADER_BLUE}`,
  },
  num: {
    ...CELL_BASE,
    textAlign: 'right' as const,
    fontWeight: 700,
    borderTop: `1px solid ${TABLE_HEADER_BLUE}`,
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
    background: TABLE_HEADER_BLUE,
    color: TABLE_HEADER_TEXT,
    borderTop: `1px solid ${TABLE_HEADER_BLUE}`,
    borderBottom: `1px solid ${TABLE_HEADER_BLUE}`,
  },
};
