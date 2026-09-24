'use client';

/**
 * CostPerSqmTables.tsx (2026-09-24)
 *
 * Table 7 of the Capex results: cost per sqm, per line, and for Sell lines what
 * a sqm sells for against what it cost. A RENDERER ONLY: the report is
 * `buildCostPerSqmReport` (which reads the Capex report, the IDC schedule and
 * the engine's Sell results and computes none of them again) and the TABLES,
 * titles, captions, columns and rows, are `costPerSqmTables`, the same rows the
 * PDF and the workbook print, so the three cannot word or order Table 7
 * differently. It moves no existing number; it divides existing numbers.
 *
 * Per-sqm figures print at FULL scale with no decimals, the way a price per sqm
 * is quoted. AMOUNTS follow the project's display scale and decimals like
 * every other amount on the tab (founder, 2026-09-24).
 *
 * No em dashes in this file.
 */
import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { formatAccounting, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { useModule1Store } from '../../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../../lib/financials-resolvers';
import { buildCostPerSqmReport, costPerSqmTables, amountUnit, type CostPerSqmCell } from '../../../lib/reports/costPerSqmReport';
import { CELL_HEADER, TABLE_TITLE, ROW_DATA, ROW_ASSET_HEADING, ROW_SUBTOTAL } from './tableStyles';

const card: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)', padding: 'var(--sp-2)', marginBottom: 'var(--sp-2)',
};
const note: React.CSSProperties = { fontSize: 11, color: 'var(--color-meta)', margin: '4px 0 6px', lineHeight: 1.5 };
const ROW_STYLE = { heading: ROW_ASSET_HEADING, data: ROW_DATA, subtotal: ROW_SUBTOTAL } as const;

export default function CostPerSqmTables({ assetIds }: {
  /** The assets the Results view is showing, so a phase filter applies here too. */
  assetIds: readonly string[];
}): React.JSX.Element | null {
  const state = useModule1Store(useShallow((s) => ({
    project: s.project, phases: s.phases, assets: s.assets, subUnits: s.subUnits, parcels: s.parcels,
    costLines: s.costLines, costOverrides: s.costOverrides, landAllocationMode: s.landAllocationMode,
    financingTranches: s.financingTranches, equityContributions: s.equityContributions,
  })));
  const report = useMemo(() => {
    try { return buildCostPerSqmReport(computeFinancialsSnapshot(state), state); } catch { return null; }
  }, [state]);

  const currency = state.project.currency ?? 'SAR';
  const scale: DisplayScale = state.project.displayScale ?? 'thousands';
  const decimals: DisplayDecimals = (state.project.displayDecimals ?? 1) as DisplayDecimals;
  const phaseCount = state.phases.length;
  const tables = useMemo(() => {
    const ids = new Set(assetIds);
    // A line is shown when the view shows any plot of it. The line's figures
    // are still the whole line's: a per-sqm reading of half a line would be a
    // number no other surface states.
    const lines = (report?.lines ?? []).filter((l) => l.memberIds.some((id) => ids.has(id)));
    return costPerSqmTables(lines, { currency, scaleTag: amountUnit(currency, scale), multiPhase: phaseCount > 1 });
  }, [report, assetIds, currency, scale, phaseCount]);

  if (tables.length === 0) return null;
  const text = (c: CostPerSqmCell): string => {
    if (typeof c === 'string') return c;
    if (c.n === null) return 'n/a';
    if (c.as === 'amount') return formatAccounting(c.n, scale, decimals);
    if (c.as === 'area') return `${formatAccounting(c.n, 'full', 0)} sqm`;
    return formatAccounting(c.n, 'full', 0);
  };

  return (
    <>
      {tables.map((t, ti) => (
        <div key={t.title} style={card} data-testid={ti === 0 ? 'capex-cost-per-sqm' : 'capex-sale-per-sqm'}>
          <h3 style={{ ...TABLE_TITLE, margin: 0 }}>{t.title}</h3>
          <div style={note}>{t.caption}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  {t.columns.map((c, i) => <th key={c} style={i === 0 ? { ...CELL_HEADER, textAlign: 'left' } : CELL_HEADER}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r, ri) => {
                  const st = ROW_STYLE[r.kind];
                  return (
                    <tr key={ri}>
                      {r.cells.map((c, ci) => (
                        <td key={ci} style={ci === 0
                          ? { ...st.name, paddingLeft: r.kind === 'heading' ? undefined : 18 }
                          : { ...st.num, fontWeight: r.kind === 'heading' ? 400 : undefined }}>
                          {text(c)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}
