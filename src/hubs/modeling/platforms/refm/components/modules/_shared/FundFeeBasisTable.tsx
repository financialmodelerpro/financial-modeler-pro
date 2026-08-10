'use client';

/**
 * FundFeeBasisTable.tsx (fund layer, 2026-08-05)
 *
 * Shows what every fund fee is charged ON, beside the rate applied.
 *
 * The problem it exists to fix: a fee could read zero on the statement with
 * nothing on screen to say whether the RATE was zero or the BASE was empty.
 * The fund structure fee did exactly that, and there was no way to tell from
 * the P&L which of the two it was.
 *
 * Rows come from the SHARED builder `buildFundFeeBasisRows` in
 * lib/reports/m4Reports.ts, the same one the Excel export reads, so the M4
 * statement, the M5 fee income section and the workbook cannot drift.
 *
 * Renders nothing when the fund layer is off (the builder returns no rows), so
 * a caller can mount it unconditionally and a standalone project is unchanged.
 *
 * No em dashes in this file.
 */
import React from 'react';
import type { FundFeeBasisRow, FundCapitalRow } from '../../../lib/reports/m4Reports';

export function FundFeeBasisTable({ rows, capital = [], currency, fmt, title, caption }: {
  rows: FundFeeBasisRow[];
  /** The three capital bases, so a reader can add equity and debt and land on
   *  the fund size. Empty when the fund size was overridden with a typed
   *  target, because then the total is not the sum of the parts. */
  capital?: FundCapitalRow[];
  currency: string;
  fmt: (v: number) => string;
  title?: string;
  caption?: string;
}): React.JSX.Element {
  if (rows.length === 0) return <></>;

  const th: React.CSSProperties = { textAlign: 'right', padding: '5px 8px', fontSize: 11 };
  const thL: React.CSSProperties = { ...th, textAlign: 'left' };
  const td: React.CSSProperties = { textAlign: 'right', padding: '4px 8px', fontSize: 11, borderBottom: '1px solid var(--color-border)' };
  const tdL: React.CSSProperties = { ...td, textAlign: 'left' };

  const totalCharged = rows.reduce((s, r) => s + r.charged, 0);

  return (
    <section style={{ marginBottom: 'var(--sp-3)' }} data-testid="fund-fee-basis">
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', marginBottom: 4 }}>
        {title ?? 'Fund Fee Basis'}{' '}
        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-meta)' }}>({currency})</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, fontStyle: 'italic' }}>
        {caption ?? 'What each fee is charged on, and the rate applied. Basis is the amount the rate was applied to over the life of the fund, so basis x rate equals the fee charged. A fee reading zero means an empty basis, not a missing rate.'}
      </div>
      {/* The three capital bases, stated before the fees that charge on them.
          The fees use three different quantities (equity alone, debt alone,
          and the two together), and without this the relationship between them
          is left implicit and a reader cannot check it. */}
      {capital.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 'var(--sp-2)' }} data-testid="fund-capital-bases">
          <table style={{ borderCollapse: 'collapse', minWidth: 320 }}>
            <tbody>
              {capital.map((c) => (
                <tr key={c.label} style={c.isTotal ? { borderTop: '2px solid var(--color-navy)' } : undefined}>
                  <td style={{ ...tdL, fontWeight: c.isTotal ? 800 : 600, borderBottom: c.isTotal ? 'none' : td.borderBottom }} title={c.note}>
                    {c.isTotal ? '= ' : ''}{c.label}
                  </td>
                  <td style={{ ...td, fontWeight: c.isTotal ? 800 : 600, borderBottom: c.isTotal ? 'none' : td.borderBottom }}>
                    {fmt(c.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={thL}>Fee</th>
              <th style={thL}>Timing</th>
              <th style={thL}>Base</th>
              <th style={th}>Rate</th>
              <th style={th}>Basis</th>
              <th style={th}>Fee Charged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td style={{ ...tdL, fontWeight: 600 }} title={r.note}>{r.label}</td>
                <td style={{ ...tdL, color: 'var(--color-meta)' }}>{r.timing}</td>
                <td style={tdL} title={r.note}>{r.base}</td>
                <td style={td}>{r.rate}</td>
                {/* A zero basis is the whole reason this table exists, so it is
                    called out rather than left as a quiet 0 among the others. */}
                <td style={{ ...td, ...(r.basis === 0 ? { color: 'var(--color-warning-fg, #92400E)', fontWeight: 700 } : {}) }}
                    title={r.basis === 0 ? 'This fee has no basis to charge on, which is why it is zero.' : r.note}>
                  {fmt(r.basis)}
                </td>
                <td style={{ ...td, fontWeight: 700 }}>{fmt(r.charged)}</td>
              </tr>
            ))}
            <tr style={{ background: 'var(--color-grey-pale, #f3f4f6)' }}>
              <td style={{ ...tdL, fontWeight: 800 }}>Total</td>
              <td style={tdL} />
              <td style={tdL} />
              <td style={td} />
              <td style={td} />
              <td style={{ ...td, fontWeight: 800 }}>{fmt(totalCharged)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {/* The resolved bases carry an explanation of WHERE the number came from.
          Shown rather than hidden in a tooltip, because the fund size is now
          derived from the model and a reader should not have to hover to learn
          that. */}
      {/* One line per model-resolved BASE, not per fee, so two fees sharing a
          base do not repeat its explanation. */}
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 10, color: 'var(--color-meta)' }}>
        {rows
          .filter((r) => r.note && r.base !== 'Flat amount')
          .filter((r, i, all) => all.findIndex((x) => x.base === r.base) === i)
          .map((r) => (
            <li key={r.base}><strong>{r.base}:</strong> {r.note}</li>
          ))}
      </ul>
    </section>
  );
}
