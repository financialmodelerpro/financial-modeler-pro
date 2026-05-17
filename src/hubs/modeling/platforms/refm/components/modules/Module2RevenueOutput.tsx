'use client';

/**
 * Module2RevenueOutput.tsx (M2 Pass 7, Tab 2 of Module 2)
 *
 * Read-only output surface for the Sell-strategy revenue engine.
 * Reads Asset.revenue.sell + M1 store via computeAllSellResults and
 * renders project-axis tables:
 *   1. Pre-Sales Revenue per asset + project total
 *   2. Post-Sales Revenue per asset + project total
 *   3. Recognition stream (P&L) per asset + project total
 *   4. Cash Collected per asset + project total
 *
 * Uses the universal table tokens (CELL_HEADER / ROW_DATA /
 * ROW_SUBTOTAL / ROW_GRAND_TOTAL / COLUMN_WIDTHS) and the FAST blue
 * calc-output styling, so it visually matches the M1 results tables.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeAllSellResults } from '../../lib/revenue-resolvers';
import type { SellAssetResult } from '@/src/core/calculations/revenue';
import { formatAccounting } from '@/src/core/formatters';
import {
  CELL_HEADER,
  CELL_HEADER_TOTAL,
  COLUMN_WIDTHS,
  ROW_DATA,
  ROW_GRAND_TOTAL,
  ROW_SUBTOTAL,
  TABLE_TITLE,
  nonLabelColumnPct,
} from './_shared/tableStyles';

interface PeriodTableProps {
  title: string;
  caption?: string;
  yearLabels: number[];
  rows: Array<{ label: string; values: number[]; isTotal?: boolean }>;
  currency: string;
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '-';
  if (Math.abs(v) < 0.5) return '-';
  return formatAccounting(v, 'full', 0);
}

function PeriodTable({ title, caption, yearLabels, rows, currency }: PeriodTableProps): React.JSX.Element {
  const nonLabelCount = 1 + yearLabels.length;
  const nonLabelPct = nonLabelColumnPct(nonLabelCount);

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
            {yearLabels.map((y) => (<col key={y} style={{ width: nonLabelPct }} />))}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Asset</th>
              <th style={CELL_HEADER_TOTAL}>Total</th>
              {yearLabels.map((y) => (
                <th key={y} style={CELL_HEADER}>{y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const tokens = r.isTotal ? ROW_GRAND_TOTAL : (idx === rows.length - 2 ? ROW_SUBTOTAL : ROW_DATA);
              const total = r.values.reduce((s, v) => s + v, 0);
              return (
                <tr key={r.label + idx}>
                  <td style={tokens.name}>{r.label}</td>
                  <td style={tokens.numTotal}>{fmt(total)}</td>
                  {r.values.map((v, j) => (
                    <td key={j} style={tokens.num}>{fmt(v)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Module2RevenueOutput(): React.JSX.Element {
  const { project, phases, assets, subUnits } = useModule1Store(
    useShallow((s) => ({ project: s.project, phases: s.phases, assets: s.assets, subUnits: s.subUnits })),
  );

  const snap = useMemo(
    () => computeAllSellResults({ project, phases, assets, subUnits }),
    [project, phases, assets, subUnits],
  );
  const currency = project.currency || '';
  const visibleSellAssets = assets.filter((a) => a.visible !== false && a.isCompanion !== true && a.strategy === 'Sell');

  if (visibleSellAssets.length === 0) {
    return (
      <div data-testid="m2-revenue-output" style={{ padding: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Revenue (Output)</h1>
        <div style={{
          marginTop: 'var(--sp-3)',
          padding: 'var(--sp-3)',
          background: 'var(--color-surface)',
          border: '1px dashed var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-muted)',
          fontSize: 'var(--font-small)',
        }}>
          No Sell-strategy assets configured. Add Sell assets in Module 1 Tab 2 and enter revenue inputs in Module 2 Tab 1, then return here.
        </div>
      </div>
    );
  }

  const assetLabel = (id: string): string => assets.find((a) => a.id === id)?.name ?? id;

  const buildRows = (pick: (r: SellAssetResult) => number[], totalLabel: string) => {
    const dataRows = visibleSellAssets.map((a) => {
      const r = snap.bySellAsset.get(a.id);
      const values = r ? pick(r) : new Array<number>(snap.axisLength).fill(0);
      return { label: assetLabel(a.id), values };
    });
    const totalValues = pick(snap.projectTotals);
    return [
      ...dataRows,
      { label: totalLabel, values: totalValues, isTotal: true },
    ];
  };

  return (
    <div data-testid="m2-revenue-output" style={{ padding: 'var(--sp-3)' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Revenue (Output)</h1>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)', maxWidth: 800 }}>
          Per-asset revenue streams from the inputs in Module 2 Tab 1. All figures are project-axis-indexed and shown in the project currency.
        </p>
      </div>

      <PeriodTable
        title="1. Pre-Sales Revenue"
        caption="Sales during construction: velocity % × sub-unit area × indexed rate, summed per period."
        yearLabels={snap.yearLabels}
        rows={buildRows((r) => r.presalesRevenuePerPeriod, 'Project Total Pre-Sales')}
        currency={currency}
      />

      <PeriodTable
        title="2. Post-Sales Revenue (Sales During Operation)"
        caption="Residual unsold units sold during operation. Recognized + collected in the same year (point-in-time)."
        yearLabels={snap.yearLabels}
        rows={buildRows((r) => r.postSalesRevenuePerPeriod, 'Project Total Post-Sales')}
        currency={currency}
      />

      <PeriodTable
        title="3. Revenue Recognition (P&L)"
        caption="Per-asset revenue recognition stream. Point-in-Time lumps at handover or sale year; Over-Time uses the configured profile with absolute-year + catchup."
        yearLabels={snap.yearLabels}
        rows={buildRows((r) => r.recognitionPerPeriod, 'Project Total Recognition')}
        currency={currency}
      />

      <PeriodTable
        title="4. Cash Collected"
        caption="Per-asset cash collection from pre-sales milestones + post-sales same-year cash."
        yearLabels={snap.yearLabels}
        rows={buildRows((r) => r.cashCollectedPerPeriod, 'Project Total Cash')}
        currency={currency}
      />
    </div>
  );
}
