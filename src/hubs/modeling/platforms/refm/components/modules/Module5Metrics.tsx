'use client';

/**
 * Module5Metrics.tsx (M5 Returns, 2026-06-01)
 *
 * Real-estate metric surface: Yield on Cost, Profit Margin, Cap Rate,
 * Cash-on-Cash, DSCR, LTV at Exit, Equity Multiple, Debt Yield, ICR,
 * Development Spread, plus the per-period coverage ratios.
 *
 * All math lives in returns-resolvers.ts -> core/calculations/returns.
 */
import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { computeReturnsSnapshot } from '../../lib/returns-resolvers';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { M4PeriodTable, type M4Row } from './_shared/m4Table';
import { MetricCard, MetricGrid, fmtPct, fmtX } from './Module5Shared';

const ratioFmt = (v: number): string => (Math.abs(v) < 1e-9 ? '-' : `${v.toFixed(2)}x`);
const pctRowFmt = (v: number): string => (Math.abs(v) < 1e-9 ? '-' : `${(v * 100).toFixed(1)}%`);

export default function Module5Metrics(): React.JSX.Element {
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

  const snap = useMemo(() => computeFinancialsSnapshot(state), [state]);
  const project = state.project;
  const rs = useMemo(() => computeReturnsSnapshot(snap, project), [snap, project]);

  const scale: DisplayScale = (project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(project.currency ?? 'SAR', scale);
  const m = rs.result.realEstate;

  const dscrTone = m.dscrMin === null ? 'neutral' : m.dscrMin >= 1.2 ? 'good' : 'bad';
  const ltvTone = m.ltvAtExit === null ? 'neutral' : m.ltvAtExit <= 0.6 ? 'good' : 'bad';

  const ratioRows: M4Row[] = [
    { label: 'DSCR (CFADS / debt service)', values: m.dscrPerPeriod, rowFmt: ratioFmt, totalOverride: `avg ${fmtX(m.dscrAvg)}`, isSubtotal: true },
    { label: 'Interest Coverage (EBITDA / interest)', values: m.icrPerPeriod, rowFmt: ratioFmt, totalOverride: `min ${fmtX(m.icrMin)}` },
    { label: 'Cash-on-Cash (distribution / equity)', values: m.cashOnCashPerPeriod, rowFmt: pctRowFmt, totalOverride: `avg ${fmtPct(m.cashOnCashAvg)}` },
  ];

  return (
    <div data-testid="module5-metrics" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <p style={{ color: 'var(--color-meta)', marginTop: 0, marginBottom: 'var(--sp-3)', fontSize: 'var(--font-small)' }}>
        Real-estate return + leverage metrics. Exit-based metrics (Cap Rate, LTV, Debt Yield) use the terminal value
        from the Returns tab. Coverage ratios are shown per period below; the Total column carries the average / min.
      </p>

      {/* Profitability + yield KPIs */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', marginBottom: 'var(--sp-1)' }}>
        Profitability and Yield
      </div>
      <MetricGrid min={150}>
        <MetricCard label="Yield on Cost" value={fmtPct(m.yieldOnCost)} sub="stabilised NOI / cost" tone="neutral" />
        <MetricCard label="Cap Rate at Exit" value={fmtPct(m.capRateAtExit)} sub="exit NOI / exit value" />
        <MetricCard label="Development Spread" value={fmtPct(m.developmentSpread)} sub="yield on cost less cap rate" tone={m.developmentSpread !== null && m.developmentSpread > 0 ? 'good' : 'neutral'} />
        <MetricCard label="Profit on Cost" value={fmtPct(m.profitOnCost)} sub="(revenue - cost) / cost" />
        <MetricCard label="Profit Margin" value={fmtPct(m.profitMargin)} sub="PAT / revenue" />
        <MetricCard label="Equity Multiple" value={fmtX(m.equityMultiple)} sub="distributions / invested" />
      </MetricGrid>

      {/* Leverage + coverage KPIs */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', marginBottom: 'var(--sp-1)' }}>
        Leverage and Coverage
      </div>
      <MetricGrid min={150}>
        <MetricCard label="LTV at Exit" value={fmtPct(m.ltvAtExit)} sub="debt / exit value" tone={ltvTone} />
        <MetricCard label="Debt Yield" value={fmtPct(m.debtYield)} sub="NOI / debt" />
        <MetricCard label="Min DSCR" value={fmtX(m.dscrMin)} sub="worst coverage period" tone={dscrTone} />
        <MetricCard label="Avg DSCR" value={fmtX(m.dscrAvg)} sub="mean over debt years" />
        <MetricCard label="Min Interest Cover" value={fmtX(m.icrMin)} sub="EBITDA / interest" />
        <MetricCard label="Avg Cash-on-Cash" value={fmtPct(m.cashOnCashAvg)} sub="cash yield on equity" />
        <MetricCard label="Peak Equity" value={fmt(m.peakEquity)} sub={currency} />
      </MetricGrid>

      {/* Per-period coverage ratios */}
      <M4PeriodTable
        title="Coverage and Cash Ratios by Year"
        caption="DSCR = cash available for debt service / debt service (periods with no debt service show a dash). Interest cover = EBITDA / interest. Cash-on-Cash = distributions / cumulative equity. The Total column shows the average (DSCR, Cash-on-Cash) or minimum (Interest cover)."
        yearLabels={rs.yearLabels}
        rows={ratioRows}
        currency={currency}
        fmt={fmt}
        priorYearLabel={snap.projectStartYear - 1}
      />

      {/* ── M5 Pass 2: Per-Asset breakdown (grouped by phase) ── */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', margin: 'var(--sp-3) 0 var(--sp-1)' }}>
        Per-Asset Economics
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 'var(--sp-1)' }}>
        Unlevered drivers per asset. Asset-level IRR is not shown: financing (debt, dividends, terminal value) is project-level and cannot be cleanly isolated per asset, so this shows revenue, cost, profit, margin and (income assets only) yield on cost. Grouped by phase.
      </div>
      {(() => {
        const phaseOf = new Map<string, string>();
        for (const a of state.assets) phaseOf.set(a.id, a.phaseId);
        const phaseLabel = new Map<string, string>();
        for (const ph of state.phases) phaseLabel.set(ph.id, ph.name);
        const groups = new Map<string, typeof rs.perAsset.rows>();
        for (const row of rs.perAsset.rows) {
          const pid = phaseOf.get(row.assetId) ?? '__none__';
          if (!groups.has(pid)) groups.set(pid, []);
          groups.get(pid)!.push(row);
        }
        const th: React.CSSProperties = { textAlign: 'right', padding: '5px 10px' };
        const thL: React.CSSProperties = { ...th, textAlign: 'left' };
        const td: React.CSSProperties = { textAlign: 'right', padding: '5px 10px', borderBottom: '1px solid var(--color-border)' };
        const tdL: React.CSSProperties = { ...td, textAlign: 'left' };
        return (
          <div style={{ overflowX: 'auto', marginBottom: 'var(--sp-3)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 760 }}>
              <thead>
                <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                  <th style={thL}>Asset</th>
                  <th style={thL}>Strategy</th>
                  <th style={th}>Revenue</th>
                  <th style={th}>Cost (capex)</th>
                  <th style={th}>Profit</th>
                  <th style={th}>Margin</th>
                  <th style={th}>Yield on Cost</th>
                </tr>
              </thead>
              <tbody>
                {[...groups.entries()].map(([pid, gRows]) => (
                  <React.Fragment key={pid}>
                    <tr style={{ background: 'var(--color-grey-pale, #f3f4f6)' }}>
                      <td colSpan={7} style={{ ...tdL, fontWeight: 800, color: 'var(--color-heading)' }}>{phaseLabel.get(pid) ?? 'Unassigned'}</td>
                    </tr>
                    {gRows.map((r) => (
                      <tr key={r.assetId}>
                        <td style={tdL}>{r.assetName}</td>
                        <td style={tdL}>{r.strategy}</td>
                        <td style={td}>{fmt(r.totalRevenue)}</td>
                        <td style={td}>{fmt(r.totalCost)}</td>
                        <td style={{ ...td, fontWeight: 600, color: r.profit >= 0 ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)' }}>{fmt(r.profit)}</td>
                        <td style={td}>{fmtPct(r.profitMargin)}</td>
                        <td style={td}>{r.isIncomeAsset ? fmtPct(r.yieldOnCost) : 'n/a'}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)', fontWeight: 800 }}>
                  <td style={{ ...tdL, color: 'var(--color-on-primary-navy)' }} colSpan={2}>Project Total</td>
                  <td style={th}>{fmt(rs.perAsset.totalRevenue)}</td>
                  <td style={th}>{fmt(rs.perAsset.totalCost)}</td>
                  <td style={th}>{fmt(rs.perAsset.totalProfit)}</td>
                  <td style={th}>{fmtPct(rs.perAsset.totalRevenue > 0 ? rs.perAsset.totalProfit / rs.perAsset.totalRevenue : null)}</td>
                  <td style={th}></td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })()}
    </div>
  );
}
