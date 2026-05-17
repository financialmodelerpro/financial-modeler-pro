'use client';

/**
 * Module2Schedules.tsx (M2 Pass 7, Tab 4 of Module 2)
 *
 * Working-capital schedules for the Sell-strategy stream:
 *   1. Accounts Receivable  = max(0, cum recognition - cum cash)
 *   2. Unearned Revenue     = max(0, cum cash - cum recognition)
 *   3. Escrow Balance       (already computed by the revenue engine)
 *   4. Net Cash to Project  = cash collected - escrow held + escrow released
 *
 * AR and Unearned are mirrors: at most one is non-zero in any given
 * period. The split aligns with the balance-sheet convention used in
 * the MAAD model (AR for under-collected revenue, Unearned for over-
 * collected cash).
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeAllSellResults } from '../../lib/revenue-resolvers';
import { buildAccountsReceivable, buildUnearnedRevenue } from '@/src/core/calculations/revenue';
import { formatAccounting } from '@/src/core/formatters';
import {
  CELL_HEADER,
  CELL_HEADER_TOTAL,
  COLUMN_WIDTHS,
  ROW_DATA,
  ROW_GRAND_TOTAL,
  TABLE_TITLE,
  nonLabelColumnPct,
} from './_shared/tableStyles';

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '-';
  if (Math.abs(v) < 0.5) return '-';
  return formatAccounting(v, 'full', 0);
}

interface Row { label: string; values: number[]; isTotal?: boolean }

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
              <th style={CELL_HEADER}>Asset</th>
              <th style={CELL_HEADER_TOTAL}>Latest</th>
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

  const arPerAsset: Row[] = [];
  const unearnedPerAsset: Row[] = [];
  const escrowPerAsset: Row[] = [];
  const netCashPerAsset: Row[] = [];

  const projAR = new Array<number>(N).fill(0);
  const projUR = new Array<number>(N).fill(0);
  const projEscrow = new Array<number>(N).fill(0);
  const projNetCash = new Array<number>(N).fill(0);

  for (const a of sellAssets) {
    const r = snap.bySellAsset.get(a.id);
    if (!r) continue;
    const ar = buildAccountsReceivable(r.recognitionPerPeriod, r.cashCollectedPerPeriod, N);
    const ur = buildUnearnedRevenue(r.recognitionPerPeriod, r.cashCollectedPerPeriod, N);
    arPerAsset.push({ label: a.name, values: ar.perPeriod });
    unearnedPerAsset.push({ label: a.name, values: ur.perPeriod });
    escrowPerAsset.push({ label: a.name, values: r.escrowBalancePerPeriod });
    netCashPerAsset.push({ label: a.name, values: r.netCashAvailablePerPeriod });
    for (let i = 0; i < N; i++) {
      projAR[i] += ar.perPeriod[i] ?? 0;
      projUR[i] += ur.perPeriod[i] ?? 0;
      projEscrow[i] += r.escrowBalancePerPeriod[i] ?? 0;
      projNetCash[i] += r.netCashAvailablePerPeriod[i] ?? 0;
    }
  }
  arPerAsset.push({ label: 'Project AR (closing)', values: projAR, isTotal: true });
  unearnedPerAsset.push({ label: 'Project Unearned (closing)', values: projUR, isTotal: true });
  escrowPerAsset.push({ label: 'Project Escrow Balance', values: projEscrow, isTotal: true });
  netCashPerAsset.push({ label: 'Project Net Cash to Developer', values: projNetCash, isTotal: true });

  return (
    <div data-testid="m2-schedules" style={{ padding: 'var(--sp-3)' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Schedules</h1>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)', maxWidth: 800 }}>
          Working-capital schedules driven by the recognition vs cash mismatch. AR rises when recognition outpaces cash; Unearned rises when cash outpaces recognition. Escrow + net-cash track the cash actually freed to the developer.
        </p>
      </div>

      <PeriodTable
        title="1. Accounts Receivable (closing balance per period)"
        caption="AR = max(0, cumulative recognition - cumulative cash collected). Falls when cash catches up."
        yearLabels={snap.yearLabels}
        rows={arPerAsset}
        currency={currency}
      />

      <PeriodTable
        title="2. Unearned Revenue (closing balance per period)"
        caption="Unearned = max(0, cumulative cash - cumulative recognition). Mirror of AR; both never simultaneously non-zero."
        yearLabels={snap.yearLabels}
        rows={unearnedPerAsset}
        currency={currency}
      />

      <PeriodTable
        title="3. Escrow Balance (closing)"
        caption="Cash held in escrow per the Wafi-style release schedule. Released into Net Cash on the configured release year."
        yearLabels={snap.yearLabels}
        rows={escrowPerAsset}
        currency={currency}
      />

      <PeriodTable
        title="4. Net Cash to Developer"
        caption="Cash collected - escrow held + escrow released. The actual operating cash flow from sales available to the project."
        yearLabels={snap.yearLabels}
        rows={netCashPerAsset}
        currency={currency}
      />
    </div>
  );
}
