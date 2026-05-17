'use client';

/**
 * Module2CostOfSales.tsx (M2 Pass 7, Tab 3 of Module 2)
 *
 * Read-only output surface for Cost of Sales matched to the revenue
 * recognition profile. Identity (per period i):
 *   CoS[i] = totalCapex * (recognition[i] / totalRecognition)
 *   cumulative CoS at end of project = totalCapex
 *
 * Tables (one per asset + project total):
 *   1. Capex baseline + recognition share + period CoS
 *   2. Gross margin = recognition - CoS per period (cumulative below)
 *
 * Reads M1 capex via computeAssetCapex(state, assetId) (consumes
 * computeAssetCost under the hood) so the CoS basis stays in sync with
 * any Tab 3 edits the user makes upstream.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeAllSellResults, computeAssetCapex } from '../../lib/revenue-resolvers';
import { buildCostOfSales, type CostOfSalesResult, type SellAssetResult } from '@/src/core/calculations/revenue';
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

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '-';
  if (Math.abs(v) < 0.5) return '-';
  return formatAccounting(v, 'full', 0);
}

interface Row { label: string; values: number[]; isTotal?: boolean; isSubtotal?: boolean }

function PeriodTable({ title, caption, yearLabels, rows, currency }: {
  title: string; caption?: string; yearLabels: number[]; rows: Row[]; currency: string;
}): React.JSX.Element {
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
              <th style={CELL_HEADER}>Line</th>
              <th style={CELL_HEADER_TOTAL}>Total</th>
              {yearLabels.map((y) => (<th key={y} style={CELL_HEADER}>{y}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const tokens = r.isTotal ? ROW_GRAND_TOTAL : (r.isSubtotal ? ROW_SUBTOTAL : ROW_DATA);
              const total = r.values.reduce((s, v) => s + v, 0);
              return (
                <tr key={r.label + idx}>
                  <td style={tokens.name}>{r.label}</td>
                  <td style={tokens.numTotal}>{fmt(total)}</td>
                  {r.values.map((v, j) => (<td key={j} style={tokens.num}>{fmt(v)}</td>))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Module2CostOfSales(): React.JSX.Element {
  const state = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      assets: s.assets,
      subUnits: s.subUnits,
      parcels: s.parcels,
      costLines: s.costLines,
      costOverrides: s.costOverrides,
      landAllocationMode: s.landAllocationMode,
    })),
  );

  const snap = useMemo(
    () => computeAllSellResults({
      project: state.project, phases: state.phases, assets: state.assets, subUnits: state.subUnits,
    }),
    [state.project, state.phases, state.assets, state.subUnits],
  );

  const sellAssets = state.assets.filter((a) => a.visible !== false && a.isCompanion !== true && a.strategy === 'Sell');
  const currency = state.project.currency || '';

  const perAsset = useMemo(() => {
    return sellAssets.map((a) => {
      const r = snap.bySellAsset.get(a.id);
      const capex = computeAssetCapex(state, a.id);
      const cos: CostOfSalesResult = r
        ? buildCostOfSales(r.recognitionPerPeriod, capex, snap.axisLength)
        : buildCostOfSales(new Array<number>(snap.axisLength).fill(0), capex, snap.axisLength);
      return { asset: a, sell: r, capex, cos };
    });
  }, [sellAssets, snap, state]);

  // Project totals
  const projTotals = useMemo(() => {
    const N = snap.axisLength;
    const cos = new Array<number>(N).fill(0);
    const cum = new Array<number>(N).fill(0);
    const gm = new Array<number>(N).fill(0);
    let totalCapex = 0;
    let totalRec = 0;
    for (const row of perAsset) {
      totalCapex += row.cos.totalCapex;
      totalRec += row.cos.totalRecognition;
      for (let i = 0; i < N; i++) {
        cos[i] += row.cos.perPeriod[i] ?? 0;
        gm[i] += row.cos.grossMarginPerPeriod[i] ?? 0;
      }
    }
    let running = 0;
    for (let i = 0; i < N; i++) { running += cos[i]; cum[i] = running; }
    return { perPeriod: cos, cumulative: cum, grossMargin: gm, totalCapex, totalRecognition: totalRec };
  }, [perAsset, snap.axisLength]);

  if (sellAssets.length === 0) {
    return (
      <div data-testid="m2-cost-of-sales" style={{ padding: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Cost of Sales</h1>
        <div style={{
          marginTop: 'var(--sp-3)', padding: 'var(--sp-3)', background: 'var(--color-surface)',
          border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-muted)', fontSize: 'var(--font-small)',
        }}>
          No Sell-strategy assets configured. CoS unlocks once Sell assets are configured in Module 2 Tab 1.
        </div>
      </div>
    );
  }

  const cosRows: Row[] = [
    ...perAsset.map((row) => ({ label: row.asset.name, values: row.cos.perPeriod })),
    { label: 'Project Total Cost of Sales', values: projTotals.perPeriod, isTotal: true },
  ];

  const cumRows: Row[] = [
    ...perAsset.map((row) => ({ label: `${row.asset.name} (cum)`, values: row.cos.cumulativePerPeriod })),
    { label: 'Project Cumulative CoS (= total capex at end)', values: projTotals.cumulative, isTotal: true },
  ];

  const gmRows: Row[] = [
    ...perAsset.map((row) => ({ label: row.asset.name, values: row.cos.grossMarginPerPeriod })),
    { label: 'Project Gross Margin', values: projTotals.grossMargin, isTotal: true },
  ];

  return (
    <div data-testid="m2-cost-of-sales" style={{ padding: 'var(--sp-3)' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Cost of Sales</h1>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)', maxWidth: 800 }}>
          Cost of Sales is recognised in step with revenue recognition (matching principle). Per period:
          CoS = total capex × (period recognition / total recognition). Cumulative CoS at project end equals total capex.
        </p>
      </div>

      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <span style={TABLE_TITLE}>Asset Capex Basis</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--sp-1)' }}>
          {perAsset.map((row) => (
            <div key={row.asset.id} style={{
              padding: 'var(--sp-1) var(--sp-2)',
              background: 'var(--color-grey-pale)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
            }}>
              <div style={{ fontSize: 11, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{row.asset.name}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)' }}>
                {currency} {fmt(row.capex)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>
                Recognition: {currency} {fmt(row.cos.totalRecognition)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <PeriodTable
        title="1. Cost of Sales per Period"
        caption="CoS slice released into P&L each year, proportional to that year's revenue recognition."
        yearLabels={snap.yearLabels}
        rows={cosRows}
        currency={currency}
      />

      <PeriodTable
        title="2. Cumulative Cost of Sales"
        caption="Running total. Reaches total capex by the end of recognition (matching principle)."
        yearLabels={snap.yearLabels}
        rows={cumRows}
        currency={currency}
      />

      <PeriodTable
        title="3. Gross Margin (Recognition - CoS)"
        caption="Period gross margin. Negative readings indicate periods where recognition outpaces matched capex (usually pre-handover Over-Time profiles)."
        yearLabels={snap.yearLabels}
        rows={gmRows}
        currency={currency}
      />
    </div>
  );
}
