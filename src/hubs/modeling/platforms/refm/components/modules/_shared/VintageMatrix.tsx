'use client';

/**
 * VintageMatrix.tsx
 *
 * Renders a 2D cohort matrix per [[feedback_ui_universal_defaults]]
 * rule 5: rows = sale year (cohort), cols = collection / recognition
 * year. Cells show $ collected / recognized from that cohort in that
 * year. Diagonal cells are highlighted (cohort-N catches up at year N).
 * Empty cells render as a dash so the eye reads the schedule shape.
 *
 * The pre-sales schedule visualization mirrors the standard cohort-by-
 * collection-year layout used in residential feasibility models.
 */

import React from 'react';
import { formatAccounting } from '@/src/core/formatters';
import { CELL_HEADER, CELL_HEADER_TOTAL, COLUMN_WIDTHS, ROW_DATA, ROW_GRAND_TOTAL, TABLE_TITLE, nonLabelColumnPct } from './tableStyles';

interface VintageMatrixProps {
  title: string;
  caption?: string;
  yearLabels: number[];
  matrix: number[][]; // matrix[saleYearIdx][collectionYearIdx]
  currency: string;
  handoverYearIdx?: number;
  /**
   * Format helper. Callers MUST pass a formatter wired to the
   * project's displayScale + displayDecimals so the matrix matches
   * the rest of the platform (per [[feedback_ui_universal_defaults]]
   * rule 2). Default formatter falls back to project-agnostic full /
   * 2dp accounting if omitted.
   */
  fmt?: (v: number) => string;
  /**
   * Pass 9g-D-fix4 (2026-05-18): optional row labels for non-sales
   * matrices. CoS vintage matrix uses "Capex spent in" instead of
   * "Sold in", etc. Defaults preserve the original sales-cohort
   * semantics for back-compat.
   */
  rowAxisHeader?: string;     // default: 'Cohort sold in ↓ / Year →'
  rowTotalHeader?: string;    // default: 'Cohort Total'
  rowLabelPrefix?: string;    // default: 'Sold in'
  emptyMessage?: string;      // default: 'No cohorts yet, ...'
}

const defaultFmt = (v: number): string => {
  if (!Number.isFinite(v)) return '-';
  if (v === 0) return '-';
  return formatAccounting(v, 'full', 2);
};

export default function VintageMatrix({
  title,
  caption,
  yearLabels,
  matrix,
  currency,
  handoverYearIdx,
  fmt = defaultFmt,
  rowAxisHeader = 'Cohort sold in ↓ / Year →',
  rowTotalHeader = 'Cohort Total',
  rowLabelPrefix = 'Sold in',
  emptyMessage = 'No cohorts yet, enter pre-sales velocity in Tab 1 Inputs.',
}: VintageMatrixProps): React.JSX.Element {
  const N = yearLabels.length;
  const rowTotals = matrix.map((row) => row.reduce((s, v) => s + (v ?? 0), 0));
  const colTotals = new Array<number>(N).fill(0);
  for (let r = 0; r < matrix.length; r++) for (let c = 0; c < N; c++) colTotals[c] += matrix[r]?.[c] ?? 0;
  const grandTotal = rowTotals.reduce((s, v) => s + v, 0);

  // Only render rows where there is any sales activity (cohort exists)
  const activeRows: number[] = [];
  for (let r = 0; r < N; r++) if (rowTotals[r] > 0.5) activeRows.push(r);

  const nonLabelPct = nonLabelColumnPct(1 + N);

  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <span style={TABLE_TITLE}>{title} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-meta)' }}>({currency})</span></span>
      {caption && (
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, fontStyle: 'italic' }}>{caption}</div>
      )}
      {activeRows.length === 0 ? (
        <div style={{ padding: '8px 12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
          {emptyMessage}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
          <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
            <colgroup>
              <col style={{ width: COLUMN_WIDTHS.label }} />
              <col style={{ width: nonLabelPct }} />
              {yearLabels.map((y) => (<col key={y} style={{ width: nonLabelPct }} />))}
            </colgroup>
            <thead>
              <tr>
                <th style={CELL_HEADER}>{rowAxisHeader}</th>
                <th style={CELL_HEADER_TOTAL}>{rowTotalHeader}</th>
                {yearLabels.map((y) => (
                  <th key={y} style={{ ...CELL_HEADER, ...(handoverYearIdx != null && yearLabels.indexOf(y) === handoverYearIdx ? { borderBottom: '2px solid var(--color-info, #1d4ed8)' } : {}) }}>
                    {y}{handoverYearIdx != null && yearLabels.indexOf(y) === handoverYearIdx ? '*' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeRows.map((r) => (
                <tr key={r}>
                  <td style={ROW_DATA.name}>{rowLabelPrefix} {yearLabels[r]}</td>
                  <td style={ROW_DATA.numTotal}>{fmt(rowTotals[r])}</td>
                  {yearLabels.map((_, c) => {
                    const v = matrix[r]?.[c] ?? 0;
                    const isDiagonal = r === c;
                    const cellStyle: React.CSSProperties = {
                      ...ROW_DATA.num,
                      ...(isDiagonal && v > 0.5 ? { background: 'color-mix(in srgb, var(--color-navy) 6%, transparent)', fontWeight: 600 } : {}),
                    };
                    return (
                      <td key={c} style={cellStyle}>{fmt(v)}</td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td style={ROW_GRAND_TOTAL.name}>Year Total</td>
                <td style={ROW_GRAND_TOTAL.numTotal}>{fmt(grandTotal)}</td>
                {colTotals.map((v, c) => (<td key={c} style={ROW_GRAND_TOTAL.num}>{fmt(v)}</td>))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
