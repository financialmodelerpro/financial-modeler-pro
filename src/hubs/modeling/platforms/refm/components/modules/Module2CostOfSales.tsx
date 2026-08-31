'use client';

/**
 * Module2CostOfSales.tsx, the Module 2 Cost of Sales tab.
 *
 * This screen COMPUTES NOTHING. It renders `buildCostOfSalesReport`, the shared
 * shaper over `snap.byAssetCostOfSales`, which is the one cost-of-sales result
 * the Module 2 layer (lib/costOfSales) builds and the P&L and the balance sheet
 * are built from. Both PDFs and the workbook render the same tables from the
 * same builder, so the displayed figure and the model figure cannot drift.
 *
 * WHAT THIS FILE USED TO DO (2026-08-30). It assembled its OWN capex base
 * (computeAssetCost projected by a hand-rolled Y0 rule, plus IDC) and ran a
 * SECOND engine over it, `buildCostOfSalesV2`. The P&L ran a different engine on
 * a different base, and on the live projects the two disagreed by up to
 * 407,131,731 in one year and 62,936,759 over a lifetime. The screen's own
 * inventory roll-forward sat on a base 62,936,759 smaller than the balance
 * sheet's. All of that is gone: one computation, upstream, read here.
 *
 * The basis is stated on each asset's first table, including the capitalised
 * IDC inside it, the way a marketing cost line states what it is charged on.
 *
 * Universal UI rules per [[feedback_ui_universal_defaults]]:
 * navy headers white text, phase-then-asset, collapsible, project-setup formatting.
 *
 * No em dashes in this file.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { buildCostOfSalesReport } from '../../lib/reports/cosReports';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import {
  CELL_HEADER,
  CELL_HEADER_TOTAL,
  COLUMN_WIDTHS,
  ROW_DATA,
  ROW_GRAND_TOTAL,
  TABLE_TITLE,
  nonLabelColumnPct,
  periodTableStyle,
  PERIOD_LABEL_PX, STICKY_DATA_BG, freezeCol,
} from './_shared/tableStyles';
import { ScrollableTable } from './_shared/ScrollableTable';
import { PhaseSection } from './_shared/PhaseSection';
import { AssetQuickNav } from './_shared/AssetQuickNav';
import { makeFmt, makePctFmt } from './_shared/numberFmt';
import type { M4Row } from './_shared/m4Table';

function PeriodTable({ title, caption, yearLabels, rows, currency, fmt, pctFmt }: {
  title: string; caption?: string; yearLabels: number[]; rows: M4Row[]; currency: string;
  fmt: (v: number) => string; pctFmt: (v: number) => string;
}): React.JSX.Element {
  // Universal prior-year column: leads with the year before project
  // start so the year axis aligns column-for-column across the platform.
  const resolvedPriorYear = yearLabels.length > 0 ? yearLabels[0] - 1 : undefined;
  const hasPrior = resolvedPriorYear !== undefined;
  const nonLabelPct = nonLabelColumnPct(1 + (hasPrior ? 1 : 0) + yearLabels.length);
  const priorCellStyle: React.CSSProperties = { color: 'var(--color-meta)', fontStyle: 'italic' };
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <span style={TABLE_TITLE}>{title} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-meta)' }}>({currency})</span></span>
      {caption && (
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, fontStyle: 'italic' }}>{caption}</div>
      )}
      <ScrollableTable>
        <table style={periodTableStyle(1 + (hasPrior ? 1 : 0) + yearLabels.length)}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            {hasPrior && (<col style={{ width: nonLabelPct }} />)}
            {yearLabels.map((y) => (<col key={y} style={{ width: nonLabelPct }} />))}
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...CELL_HEADER, ...freezeCol(0) }}>Line</th>
              <th style={{ ...CELL_HEADER_TOTAL, ...freezeCol(PERIOD_LABEL_PX) }}>Total</th>
              {hasPrior && (<th style={{ ...CELL_HEADER, fontStyle: 'italic', color: 'var(--color-meta)' }}>{resolvedPriorYear}</th>)}
              {yearLabels.map((y) => (<th key={y} style={CELL_HEADER}>{y}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              if (r.isSection) {
                return (
                  <tr key={r.label + idx}>
                    <td
                      colSpan={2 + (hasPrior ? 1 : 0) + yearLabels.length}
                      style={{
                        ...ROW_DATA.name,
                        fontWeight: 700,
                        color: 'var(--color-navy)',
                        background: 'var(--color-navy-light)',
                        fontSize: 11,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {r.label}
                    </td>
                  </tr>
                );
              }
              const tokens = r.isTotal ? ROW_GRAND_TOTAL : ROW_DATA;
              const stickyBg = r.isTotal ? undefined : STICKY_DATA_BG;
              const cellFmt = r.rowFmt ?? (r.isPercent ? pctFmt : fmt);
              const total = r.values.reduce((s, v) => s + v, 0);
              const totalDisplay = r.totalOverride ?? cellFmt(total);
              const indentPx = Math.max(0, r.indent ?? 0) * 14;
              const labelStyle = indentPx > 0
                ? { ...tokens.name, paddingLeft: `calc(${tokens.name.paddingLeft ?? 'var(--sp-2)'} + ${indentPx}px)` }
                : tokens.name;
              return (
                <tr key={r.label + idx}>
                  <td style={{ ...labelStyle, ...freezeCol(0, stickyBg) }}>{r.label}</td>
                  <td style={{ ...tokens.numTotal, ...freezeCol(PERIOD_LABEL_PX, stickyBg) }}>{totalDisplay}</td>
                  {hasPrior && (<td style={{ ...tokens.num, ...priorCellStyle }}>{cellFmt(0)}</td>)}
                  {r.values.map((v, j) => (<td key={j} style={tokens.num}>{cellFmt(v)}</td>))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollableTable>
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
      financingTranches: s.financingTranches,
      equityContributions: s.equityContributions,
    })),
  );

  const scale: DisplayScale = (state.project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (state.project.displayDecimals ?? 1) as DisplayDecimals;
  const currency = state.project.currency ?? 'SAR';
  const fmt = useMemo(() => makeFmt(scale, decimals), [scale, decimals]);
  // Ratio rows (the recognition share the base is spread on) follow
  // project.displayDecimals like every other percentage on the platform.
  const pctFmt = useMemo(() => makePctFmt(decimals), [decimals]);

  // The ONE snapshot. Cost of sales is already computed inside it, by the
  // Module 2 layer, on the same base the P&L and the balance sheet use.
  const finSnap = useMemo(() => {
    try { return computeFinancialsSnapshot(state); } catch { return null; }
  }, [state]);

  const tables = useMemo(
    () => (finSnap ? buildCostOfSalesReport(finSnap, state, fmt) : []),
    [finSnap, state, fmt],
  );

  if (tables.length === 0) {
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

  const yearLabels = finSnap?.yearLabels ?? [];

  return (
    <div data-testid="m2-cost-of-sales" style={{ padding: 'var(--sp-3)' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Cost of Sales</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>
          {currencyHeaderLine(currency, scale)} ({decimals} dp)
        </div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)', maxWidth: 860 }}>
          Cost of sales is the asset capex, including the IDC capitalised into it, released across the
          periods in which the revenue is recognised. Each asset states its basis on the first table below.
          These are the same figures the P&amp;L charges and the balance sheet carries as inventory.
        </p>
      </div>

      <AssetQuickNav assets={state.assets} idPrefix="m2-cos-asset" testidPrefix="m2-cos-nav" />

      <PhaseSection
        phaseId="strategy-sell-cos"
        title="Residential / Sell"
      >
        {tables.map((t) => (
          <PeriodTable
            key={t.title}
            title={t.title}
            yearLabels={yearLabels}
            rows={t.rows}
            currency={currencyHeaderLine(currency, scale)}
            fmt={fmt}
            pctFmt={pctFmt}
          />
        ))}
      </PhaseSection>
    </div>
  );
}
