'use client';

/**
 * M4 Pass 2 (2026-05-20): shared PeriodTable + Row helper for the
 * Module 4 surfaces (Schedules / P&L / CF / BS). Extracted to one
 * place so the four new module files stay focused on their content
 * rather than re-declaring the same table renderer four times.
 */

import React from 'react';
import {
  CELL_HEADER, CELL_HEADER_TOTAL, COLUMN_WIDTHS,
  ROW_DATA, ROW_GRAND_TOTAL, ROW_SUBTOTAL, TABLE_TITLE,
  nonLabelColumnPct,
} from './tableStyles';

export interface M4Row {
  label: string;
  values: number[];
  isTotal?: boolean;
  isSubtotal?: boolean;
  isSection?: boolean;
  indent?: number;
  totalOverride?: string;
  rowFmt?: (v: number) => string;
  /** M4 Pass 2j (2026-05-20): optional value for the prior-year column
   *  (shown when the table is rendered with priorYearLabel). For stock
   *  lines (cash, AR, NBV, debt, equity), this is the opening balance
   *  at axis start. For flow lines (revenue, opex, capex, draws), this
   *  is 0. */
  priorValue?: number;
}

export function M4PeriodTable({ title, caption, yearLabels, rows, currency, fmt, priorYearLabel }: {
  title: string; caption?: string; yearLabels: number[]; rows: M4Row[]; currency: string;
  fmt: (v: number) => string;
  /** M4 Pass 2j: when set, an extra "Prior" column is rendered between
   *  Total and the first year. Use Row.priorValue to populate per row. */
  priorYearLabel?: number;
}): React.JSX.Element {
  if (rows.length === 0) return <></>;
  const hasPrior = priorYearLabel !== undefined;
  const totalCols = 1 + (hasPrior ? 1 : 0) + yearLabels.length;
  const nonLabelPct = nonLabelColumnPct(totalCols);
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <span style={TABLE_TITLE}>{title} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-meta)' }}>({currency})</span></span>
      {caption && (
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, fontStyle: 'italic' }}>{caption}</div>
      )}
      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            {hasPrior && (<col style={{ width: nonLabelPct }} />)}
            {yearLabels.map((y) => (<col key={y} style={{ width: nonLabelPct }} />))}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Line</th>
              <th style={CELL_HEADER_TOTAL}>Total</th>
              {hasPrior && (<th style={{ ...CELL_HEADER, fontStyle: 'italic', color: 'var(--color-meta)' }}>{priorYearLabel}</th>)}
              {yearLabels.map((y) => (<th key={y} style={CELL_HEADER}>{y}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const colSpan = 2 + (hasPrior ? 1 : 0) + yearLabels.length;
              if (r.isSection) {
                return (
                  <tr key={`section-${idx}`}>
                    <td colSpan={colSpan}
                      style={{
                        padding: '8px 10px 4px',
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: 'var(--color-navy)',
                        background: 'color-mix(in srgb, var(--color-navy) 5%, transparent)',
                        borderTop: idx === 0 ? 'none' : '1px solid var(--color-border)',
                      }}
                    >{r.label}</td>
                  </tr>
                );
              }
              const tokens = r.isTotal ? ROW_GRAND_TOTAL : r.isSubtotal ? ROW_SUBTOTAL : ROW_DATA;
              const indent = r.indent ?? 0;
              const cellFmt = r.rowFmt ?? fmt;
              const total = r.totalOverride ?? cellFmt(r.values.reduce((s, v) => s + (v ?? 0), 0));
              const priorCellStyle = { ...tokens.num, color: 'var(--color-meta)', fontStyle: 'italic' as const };
              return (
                <tr key={r.label + idx}>
                  <td style={{ ...tokens.name, paddingLeft: `${10 + indent * 12}px` }}>{r.label}</td>
                  <td style={tokens.numTotal}>{total}</td>
                  {hasPrior && (<td style={priorCellStyle}>{cellFmt(r.priorValue ?? 0)}</td>)}
                  {r.values.map((v, j) => (<td key={j} style={tokens.num}>{cellFmt(v ?? 0)}</td>))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
