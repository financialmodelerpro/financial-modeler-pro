'use client';

/**
 * Module2Schedules.tsx (M2 Pass 7b, phase-wise + collapsible)
 *
 * Working-capital schedules for the Sell-strategy stream:
 *   1. Accounts Receivable  = max(0, cum recognition - cum cash)
 *   2. Unearned Revenue     = max(0, cum cash - cum recognition)
 *   3. Escrow Balance       (already computed by the revenue engine)
 *   4. Net Cash to Project  = cash collected - escrow held + escrow released
 *
 * Universal UI rules per [[feedback_ui_universal_defaults]].
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeAllSellResults } from '../../lib/revenue-resolvers';
import { buildAccountsReceivable, buildUnearnedRevenue } from '@/src/core/calculations/revenue';
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

function PeriodTable({ title, caption, yearLabels, rows, currency, latestLabel = 'Latest', fmt }: {
  title: string; caption?: string; yearLabels: number[]; rows: Row[]; currency: string; latestLabel?: string; fmt: (v: number) => string;
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
              <th style={CELL_HEADER_TOTAL}>{latestLabel}</th>
              {yearLabels.map((y) => (<th key={y} style={CELL_HEADER}>{y}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const tokens = r.isTotal ? ROW_GRAND_TOTAL : ROW_DATA;
              const latest = r.values[r.values.length - 1] ?? 0;
              return (
                <tr key={r.label + idx}>
                  <td style={tokens.name}>{r.label}</td>
                  <td style={tokens.numTotal}>{fmt(latest)}</td>
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

export default function Module2Schedules(): React.JSX.Element {
  const { project, phases, assets, subUnits } = useModule1Store(
    useShallow((s) => ({ project: s.project, phases: s.phases, assets: s.assets, subUnits: s.subUnits })),
  );

  const snap = useMemo(
    () => computeAllSellResults({ project, phases, assets, subUnits }),
    [project, phases, assets, subUnits],
  );
  const currency = project.currency || '';
  const scale: DisplayScale = project.displayScale ?? 'full';
  const decimals: DisplayDecimals = project.displayDecimals ?? 2;
  const fmt = useMemo(() => makeFmt(scale, decimals), [scale, decimals]);
  const sellAssets = assets.filter((a) => a.visible !== false && a.isCompanion !== true && a.strategy === 'Sell');

  if (sellAssets.length === 0) {
    return (
      <div data-testid="m2-schedules" style={{ padding: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Schedules</h1>
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

  const N = snap.axisLength;
  const projAR = new Array<number>(N).fill(0);
  const projUR = new Array<number>(N).fill(0);
  const projEscrow = new Array<number>(N).fill(0);
  const projNetCash = new Array<number>(N).fill(0);

  for (const a of sellAssets) {
    const r = snap.bySellAsset.get(a.id);
    if (!r) continue;
    const ar = buildAccountsReceivable(r.recognitionPerPeriod, r.cashCollectedPerPeriod, N);
    const ur = buildUnearnedRevenue(r.recognitionPerPeriod, r.cashCollectedPerPeriod, N);
    for (let i = 0; i < N; i++) {
      projAR[i] += ar.perPeriod[i] ?? 0;
      projUR[i] += ur.perPeriod[i] ?? 0;
      projEscrow[i] += r.escrowBalancePerPeriod[i] ?? 0;
      projNetCash[i] += r.netCashAvailablePerPeriod[i] ?? 0;
    }
  }

  return (
    <div data-testid="m2-schedules" style={{ padding: 'var(--sp-3)' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Schedules</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>
          {currencyHeaderLine(currency, scale)} ({decimals} dp)
        </div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)', maxWidth: 800 }}>
          Working-capital schedules per phase / per asset. AR + Unearned are mirrors (at most one non-zero per period). Escrow holds + releases per the Wafi-style schedule.
        </p>
      </div>

      {phases.map((p) => {
        const phaseAssets = sellAssets.filter((a) => a.phaseId === p.id);
        if (phaseAssets.length === 0) return null;
        return (
          <PhaseSection
            key={p.id}
            phaseId={p.id}
            title={p.name}
            meta={`${p.status ?? 'planning'}`}
            countLabel={`${phaseAssets.length} Sell asset${phaseAssets.length === 1 ? '' : 's'}`}
            storageKey={`fmp:m2:schedules:phase:${p.id}:collapsed`}
          >
            {phaseAssets.map((a) => {
              const r = snap.bySellAsset.get(a.id);
              if (!r) return null;
              const ar = buildAccountsReceivable(r.recognitionPerPeriod, r.cashCollectedPerPeriod, N);
              const ur = buildUnearnedRevenue(r.recognitionPerPeriod, r.cashCollectedPerPeriod, N);
              return (
                <AssetSection
                  key={a.id}
                  assetId={a.id}
                  title={a.name}
                  meta={a.type}
                  storageKey={`fmp:m2:schedules:asset:${a.id}:collapsed`}
                >
                  <PeriodTable
                    title="AR / Unearned / Escrow / Net Cash"
                    yearLabels={snap.yearLabels}
                    rows={[
                      { label: 'Accounts Receivable (closing)', values: ar.perPeriod },
                      { label: 'Unearned Revenue (closing)', values: ur.perPeriod },
                      { label: 'Escrow Balance (closing)', values: r.escrowBalancePerPeriod },
                      { label: 'Net Cash to Developer', values: r.netCashAvailablePerPeriod },
                    ]}
                    currency={currency}
                    latestLabel="Closing"
                    fmt={fmt}
                  />
                </AssetSection>
              );
            })}
          </PhaseSection>
        );
      })}

      <PhaseSection
        phaseId="__project__"
        title="Project Total"
        meta="all phases combined"
        storageKey="fmp:m2:schedules:phase:__project__:collapsed"
      >
        <PeriodTable
          title="Project Working-Capital Schedules"
          yearLabels={snap.yearLabels}
          rows={[
            { label: 'Project AR (closing)', values: projAR, isTotal: true },
            { label: 'Project Unearned (closing)', values: projUR, isTotal: true },
            { label: 'Project Escrow Balance', values: projEscrow, isTotal: true },
            { label: 'Project Net Cash to Developer', values: projNetCash, isTotal: true },
          ]}
          currency={currency}
          latestLabel="Closing"
          fmt={fmt}
        />
      </PhaseSection>
    </div>
  );
}
