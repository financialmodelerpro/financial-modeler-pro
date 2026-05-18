'use client';

/**
 * Module2CostOfSales.tsx (M2 Pass 7b, phase-wise + collapsible)
 *
 * Cost of Sales matched to recognition. Identity:
 *   CoS[i] = totalCapex × (recognition[i] / totalRecognition)
 *   cumulative CoS at end of recognition = totalCapex
 *
 * Universal UI rules per [[feedback_ui_universal_defaults]]:
 * navy headers white text, phase-then-asset, collapsible, project-setup formatting.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeAllSellResults, computeAssetCapex } from '../../lib/revenue-resolvers';
import { buildCostOfSales, type CostOfSalesResult } from '@/src/core/calculations/revenue';
import { formatAccounting, currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import {
  CELL_HEADER,
  CELL_HEADER_TOTAL,
  COLUMN_WIDTHS,
  ROW_DATA,
  ROW_GRAND_TOTAL,
  TABLE_TITLE,
  nonLabelColumnPct,
} from './_shared/tableStyles';
import { PhaseSection, AssetSection } from './_shared/PhaseSection';

function makeFmt(scale: DisplayScale, decimals: DisplayDecimals): (v: number) => string {
  return (v: number) => {
    if (!Number.isFinite(v)) return '-';
    if (v === 0) return '-';
    return formatAccounting(v, scale, decimals);
  };
}

interface Row { label: string; values: number[]; isTotal?: boolean }

function PeriodTable({ title, caption, yearLabels, rows, currency, fmt }: {
  title: string; caption?: string; yearLabels: number[]; rows: Row[]; currency: string; fmt: (v: number) => string;
}): React.JSX.Element {
  const nonLabelPct = nonLabelColumnPct(1 + yearLabels.length);
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
              const tokens = r.isTotal ? ROW_GRAND_TOTAL : ROW_DATA;
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
    () => computeAllSellResults({ project: state.project, phases: state.phases, assets: state.assets, subUnits: state.subUnits }),
    [state.project, state.phases, state.assets, state.subUnits],
  );

  // Pass 7w (2026-05-18): Sell + Manage parents get the same CoS
  // treatment as pure Sell. Companion-side opex handled in M3.
  const sellAssets = state.assets.filter(
    (a) => a.visible !== false
      && a.isCompanion !== true
      && (a.strategy === 'Sell' || a.strategy === 'Sell + Manage'),
  );
  const currency = state.project.currency || '';
  const scale: DisplayScale = state.project.displayScale ?? 'full';
  const decimals: DisplayDecimals = state.project.displayDecimals ?? 2;
  const fmt = useMemo(() => makeFmt(scale, decimals), [scale, decimals]);

  const perAsset = useMemo(() => sellAssets.map((a) => {
    const r = snap.bySellAsset.get(a.id);
    const capex = computeAssetCapex(state, a.id);
    const cos: CostOfSalesResult = r
      ? buildCostOfSales(r.recognitionPerPeriod, capex, snap.axisLength)
      : buildCostOfSales(new Array<number>(snap.axisLength).fill(0), capex, snap.axisLength);
    return { asset: a, sell: r, capex, cos };
  }), [sellAssets, snap, state]);

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
          No Sell-strategy assets configured.
        </div>
      </div>
    );
  }

  return (
    <div data-testid="m2-cost-of-sales" style={{ padding: 'var(--sp-3)' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Cost of Sales</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>
          {currencyHeaderLine(currency, scale)} ({decimals} dp)
        </div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)', maxWidth: 800 }}>
          Cost of Sales matched to revenue recognition (matching principle).
          CoS = total capex × (period recognition / total recognition). Phases and assets collapse.
        </p>
      </div>

      {state.phases.map((p) => {
        const phaseRows = perAsset.filter((row) => row.asset.phaseId === p.id);
        if (phaseRows.length === 0) return null;
        return (
          <PhaseSection
            key={p.id}
            phaseId={p.id}
            title={p.name}
            meta={`${p.status ?? 'planning'}`}
            countLabel={`${phaseRows.length} Sell asset${phaseRows.length === 1 ? '' : 's'}`}
            storageKey={`fmp:m2:costofsales:phase:${p.id}:collapsed`}
          >
            {phaseRows.map((row) => (
              <AssetSection
                key={row.asset.id}
                assetId={row.asset.id}
                title={row.asset.name}
                meta={`Capex ${currency} ${fmt(row.capex)} · Recognition ${currency} ${fmt(row.cos.totalRecognition)}`}
                storageKey={`fmp:m2:costofsales:asset:${row.asset.id}:collapsed`}
              >
                <PeriodTable
                  title="Cost of Sales (matched to recognition)"
                  yearLabels={snap.yearLabels}
                  rows={[
                    { label: 'Recognition (P&L)', values: row.sell?.recognitionPerPeriod ?? new Array<number>(snap.axisLength).fill(0) },
                    { label: 'Cost of Sales', values: row.cos.perPeriod },
                    { label: 'Gross Margin', values: row.cos.grossMarginPerPeriod },
                    { label: 'Cumulative CoS', values: row.cos.cumulativePerPeriod },
                  ]}
                  currency={currency}
                  fmt={fmt}
                />
              </AssetSection>
            ))}
          </PhaseSection>
        );
      })}

      <PhaseSection
        phaseId="__project__"
        title="Project Total"
        meta={`Total capex ${currency} ${fmt(projTotals.totalCapex)} · Recognition ${currency} ${fmt(projTotals.totalRecognition)}`}
        storageKey="fmp:m2:costofsales:phase:__project__:collapsed"
      >
        <PeriodTable
          title="Project-wide Cost of Sales"
          yearLabels={snap.yearLabels}
          rows={[
            { label: 'Project CoS per period', values: projTotals.perPeriod, isTotal: true },
            { label: 'Project Cumulative CoS', values: projTotals.cumulative, isTotal: true },
            { label: 'Project Gross Margin', values: projTotals.grossMargin, isTotal: true },
          ]}
          currency={currency}
          fmt={fmt}
        />
      </PhaseSection>
    </div>
  );
}
