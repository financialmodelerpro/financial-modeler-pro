/**
 * SaleCohortGridTable.tsx (2026-08-20, restructure Step 4)
 *
 * THE SALE COHORT GRID on screen. Rows are sale years, columns are the years
 * that cohort pays.
 *
 * Renders from `buildSaleCohortGrid` in lib/reports/saleCohortReports.ts, which
 * both PDFs and the workbook also render from, so the three surfaces cannot
 * drift. This file owns FORMATTING only: it computes nothing.
 *
 * Palette is the locked one (lib/excel/styles.ts is the source of truth):
 * navy #1B4F8A section header, pale #E8EEF7 sub-header and zebra, #F1F3F5
 * period header row, slate #5A6675 secondary text, ink #2A3440 body.
 *
 * No em dashes in this file.
 */

import React from 'react';
import type { SaleCohortGrid, SaleCohortGridRow } from '../../../lib/reports/saleCohortReports';

const NAVY = '#1B4F8A';
const PALE = '#E8EEF7';
const PERIOD_HEAD = '#F1F3F5';
const SLATE = '#5A6675';
const INK = '#2A3440';
const GOOD = '#2E7D52';
const WARN = '#92400E';

const LABEL_W = 92;
const NUM_W = 96;

const th: React.CSSProperties = {
  padding: '5px 8px', fontSize: 10, fontWeight: 700, color: INK,
  background: PERIOD_HEAD, borderBottom: `1px solid ${PALE}`, whiteSpace: 'nowrap',
  textAlign: 'right', position: 'sticky', top: 0,
};
const thLeft: React.CSSProperties = { ...th, textAlign: 'left' };
const td: React.CSSProperties = {
  padding: '4px 8px', fontSize: 11, color: INK, textAlign: 'right',
  whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
};
const tdLeft: React.CSSProperties = { ...td, textAlign: 'left' };

/** Where the downpayment came from, in one short token. A cohort that pays in
 *  full does not consult it, so it shows a dash rather than a value that is
 *  not being used, which would be a number on screen the model ignores. */
function sourceToken(r: SaleCohortGridRow): { text: string; colour: string } {
  if (r.paysInFull) return { text: 'not used', colour: SLATE };
  switch (r.downpaymentSource) {
    case 'set': return { text: 'set', colour: GOOD };
    case 'carried': return { text: 'carried', colour: SLATE };
    case 'project_default': return { text: 'project default', colour: SLATE };
    default: return { text: 'not set', colour: WARN };
  }
}

export default function SaleCohortGridTable({ grid, title, currency, fmt }: {
  grid: SaleCohortGrid;
  title: string;
  currency: string;
  fmt: (v: number) => string;
}): React.JSX.Element {
  const dash = (v: number): string => (Math.abs(v) < 0.005 ? '-' : fmt(v));
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }} data-testid={`m2-cohort-grid-${grid.assetId}`}>
      <div style={{
        background: NAVY, color: '#fff', padding: '6px 10px', fontSize: 12, fontWeight: 700,
        borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
        display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }}>
        <span>{title}</span>
        <span style={{ fontWeight: 600, fontSize: 11 }}>
          {grid.ok ? 'Every row foots to its own sale value' : 'A row does not foot, see the Check column'}
        </span>
      </div>
      <div style={{ overflowX: 'auto', border: `1px solid ${PALE}`, borderTop: 'none' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', background: '#fff' }}>
          <thead>
            <tr>
              <th style={{ ...thLeft, minWidth: LABEL_W }}>Sale year</th>
              <th style={{ ...th, minWidth: 64 }}>Down %</th>
              <th style={{ ...thLeft, minWidth: 104 }}>In force from</th>
              <th style={{ ...th, minWidth: NUM_W }}>Sale value</th>
              {grid.yearLabels.map((y) => (
                <th key={y} style={{ ...th, minWidth: NUM_W, background: y === grid.handoverYear ? PALE : PERIOD_HEAD }}>
                  {y}{y === grid.handoverYear ? ' *' : ''}
                </th>
              ))}
              <th style={{ ...th, minWidth: NUM_W, background: PALE }}>Total</th>
              <th style={{ ...th, minWidth: 76, background: PALE }}>Check</th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r, i) => {
              const src = sourceToken(r);
              const zebra = i % 2 === 1 ? PALE : '#fff';
              return (
                <tr key={r.saleYear} style={{ background: zebra }}>
                  <td style={{ ...tdLeft, fontWeight: 700 }}>
                    {r.saleYear}
                    {r.paysInFull && (
                      <span style={{ color: SLATE, fontWeight: 500, fontSize: 9 }}> at/after handover</span>
                    )}
                  </td>
                  <td style={td}>{r.paysInFull ? '100%' : `${(r.downpayment * 100).toFixed(2)}%`}</td>
                  <td style={{ ...tdLeft, color: src.colour, fontSize: 9, fontWeight: 700 }}>{src.text}</td>
                  <td style={td}>{fmt(r.gdv)}</td>
                  {r.cells.map((c, k) => (
                    <td key={k} style={{ ...td, color: Math.abs(c) < 0.005 ? SLATE : INK }}>{dash(c)}</td>
                  ))}
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(r.rowTotal)}</td>
                  <td style={{ ...td, fontWeight: 700, color: r.ok ? GOOD : WARN }}>
                    {r.ok ? '0.00' : r.checkResidue.toFixed(2)}
                  </td>
                </tr>
              );
            })}
            <tr style={{ background: PALE, borderTop: `2px solid ${NAVY}` }}>
              <td style={{ ...tdLeft, fontWeight: 700 }}>Total</td>
              <td style={td} />
              <td style={tdLeft} />
              <td style={{ ...td, fontWeight: 700 }}>{fmt(grid.gdvTotal)}</td>
              {grid.columnTotals.map((c, k) => (
                <td key={k} style={{ ...td, fontWeight: 700 }}>{dash(c)}</td>
              ))}
              <td style={{ ...td, fontWeight: 700 }}>{fmt(grid.collectedTotal)}</td>
              <td style={{ ...td, fontWeight: 700, color: grid.ok ? GOOD : WARN }}>
                {grid.ok ? '0.00' : (grid.collectedTotal - grid.gdvTotal).toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10, color: SLATE, marginTop: 4, lineHeight: 1.5 }}>
        All figures in {currency}. Column totals are cash collected per year from every cohort, which is the
        collections series the model uses. <strong>*</strong> marks handover ({grid.handoverYear}).
      </div>
    </div>
  );
}
