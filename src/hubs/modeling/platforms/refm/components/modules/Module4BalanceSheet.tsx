'use client';

/**
 * Module4BalanceSheet.tsx (M4 Pass 2e, 2026-05-20)
 *
 * Project Balance Sheet composed from every feeder schedule. Mirrors
 * the reference v1.16 BS Plan layout:
 *
 *   ASSETS
 *     Fixed Assets   (NBV + Land)
 *     Current Assets (Cash + AR + Residential Receivables + Inventory)
 *     TOTAL ASSETS
 *
 *   LIABILITIES & EQUITY
 *     Current Liabilities (AP + Unearned + Escrow lock)
 *     Non-current Liabilities (Debt outstanding)
 *     Shareholders' Equity (Share Capital + Statutory Reserve + Retained
 *       Earnings)
 *     TOTAL LIABILITIES + EQUITY
 *
 *   BS Check Flag + BS Difference (Assets − Liabilities − Equity)
 *
 * Statutory reserve is configurable (rate + cap % of Share Capital);
 * default off (0). When enabled it transfers each year's PAT into the
 * reserve, capped at the configured % of Share Capital (Saudi Companies
 * Law default = 10% transfer, 30% of SC cap).
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { PhaseSection } from './_shared/PhaseSection';
import { M4PeriodTable, type M4Row } from './_shared/m4Table';

const FAST_INPUT: React.CSSProperties = {
  width: '100%',
  padding: '4px 6px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-navy-pale, color-mix(in srgb, var(--color-navy) 8%, white))',
  color: 'var(--color-navy)',
  fontSize: 12,
};

export default function Module4BalanceSheet(): React.JSX.Element {
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
      setProject: s.setProject,
    })),
  );

  const snap = useMemo(() => computeFinancialsSnapshot(state), [state]);
  const project = state.project;
  const scale: DisplayScale = (project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(project.currency ?? 'SAR', scale);
  const yearLabels = snap.yearLabels;
  const N = snap.axisLength;
  const bs = snap.bs;

  const transferRatePct = (project.statutoryReserve?.transferRate ?? 0) * 100;
  const capPct = (project.statutoryReserve?.capOfShareCapital ?? 0) * 100;
  const setTransferRate = (pct: number): void => {
    state.setProject({
      statutoryReserve: { ...(project.statutoryReserve ?? {}), transferRate: Math.max(0, pct / 100) },
    });
  };
  const setCapPct = (pct: number): void => {
    state.setProject({
      statutoryReserve: { ...(project.statutoryReserve ?? {}), capOfShareCapital: Math.max(0, pct / 100) },
    });
  };
  const setShareCapital = (v: number | undefined): void => {
    state.setProject({ shareCapital: v });
  };

  const rows: M4Row[] = [];
  rows.push({ label: 'ASSETS', values: [], isSection: true });

  rows.push({ label: 'Fixed Assets', values: [], isSection: true });
  rows.push({ label: 'Land', values: bs.landPerPeriod, indent: 1, totalOverride: fmt(bs.landPerPeriod[N - 1] ?? 0) });
  rows.push({ label: 'WIP / Fixed Assets (NBV)', values: bs.nbvPerPeriod, indent: 1, totalOverride: fmt(bs.nbvPerPeriod[N - 1] ?? 0) });
  // M4 Pass 2f: IDC NBV is the capitalised-interest portion of Fixed Assets
  // (Operate / Lease assets only — Sell IDC flows through Inventory and CoS).
  if (snap.idc.idcNbvPerPeriod.some((v) => v !== 0)) {
    rows.push({
      label: 'Capitalised Interest (IDC) NBV',
      values: snap.idc.idcNbvPerPeriod,
      indent: 1,
      totalOverride: fmt(snap.idc.idcNbvPerPeriod[N - 1] ?? 0),
    });
  }
  rows.push({ label: 'Total Fixed Assets', values: bs.totalFixedAssetsPerPeriod, isSubtotal: true, totalOverride: fmt(bs.totalFixedAssetsPerPeriod[N - 1] ?? 0) });

  rows.push({ label: 'Current Assets', values: [], isSection: true });
  rows.push({ label: 'Cash', values: bs.cashPerPeriod, indent: 1, totalOverride: fmt(bs.cashPerPeriod[N - 1] ?? 0) });
  rows.push({ label: 'Residential Sales Receivables', values: bs.residentialReceivablesPerPeriod, indent: 1, totalOverride: fmt(bs.residentialReceivablesPerPeriod[N - 1] ?? 0) });
  rows.push({ label: 'Inventory (Residential WIP)', values: bs.inventoryPerPeriod, indent: 1, totalOverride: fmt(bs.inventoryPerPeriod[N - 1] ?? 0) });
  rows.push({ label: 'Total Current Assets', values: bs.totalCurrentAssetsPerPeriod, isSubtotal: true, totalOverride: fmt(bs.totalCurrentAssetsPerPeriod[N - 1] ?? 0) });

  rows.push({ label: 'TOTAL ASSETS', values: bs.totalAssetsPerPeriod, isTotal: true, totalOverride: fmt(bs.totalAssetsPerPeriod[N - 1] ?? 0) });

  rows.push({ label: 'LIABILITIES', values: [], isSection: true });
  rows.push({ label: 'Current Liabilities', values: [], isSection: true });
  rows.push({ label: 'Accounts Payable', values: bs.apPerPeriod, indent: 1, totalOverride: fmt(bs.apPerPeriod[N - 1] ?? 0) });
  rows.push({ label: 'Unearned Revenue (Off-plan advances)', values: bs.unearnedRevenuePerPeriod, indent: 1, totalOverride: fmt(bs.unearnedRevenuePerPeriod[N - 1] ?? 0) });
  rows.push({ label: 'Escrow Locked Funds', values: bs.escrowLiabilityPerPeriod, indent: 1, totalOverride: fmt(bs.escrowLiabilityPerPeriod[N - 1] ?? 0) });
  rows.push({ label: 'Total Current Liabilities', values: bs.totalCurrentLiabilitiesPerPeriod, isSubtotal: true, totalOverride: fmt(bs.totalCurrentLiabilitiesPerPeriod[N - 1] ?? 0) });

  rows.push({ label: 'Non-current Liabilities', values: [], isSection: true });
  rows.push({ label: 'Debt (long-term)', values: bs.debtOutstandingPerPeriod, indent: 1, totalOverride: fmt(bs.debtOutstandingPerPeriod[N - 1] ?? 0) });
  rows.push({ label: 'TOTAL LIABILITIES', values: bs.totalLiabilitiesPerPeriod, isTotal: true, totalOverride: fmt(bs.totalLiabilitiesPerPeriod[N - 1] ?? 0) });

  rows.push({ label: 'SHAREHOLDERS EQUITY', values: [], isSection: true });
  rows.push({ label: 'Share Capital', values: bs.shareCapitalPerPeriod, indent: 1, totalOverride: fmt(bs.shareCapitalPerPeriod[N - 1] ?? 0) });
  rows.push({ label: 'Statutory Reserve', values: bs.statutoryReservePerPeriod, indent: 1, totalOverride: fmt(bs.statutoryReservePerPeriod[N - 1] ?? 0) });
  rows.push({ label: 'Retained Earnings', values: bs.retainedEarningsPerPeriod, indent: 1, totalOverride: fmt(bs.retainedEarningsPerPeriod[N - 1] ?? 0) });
  rows.push({ label: 'Total Equity', values: bs.totalEquityPerPeriod, isSubtotal: true, totalOverride: fmt(bs.totalEquityPerPeriod[N - 1] ?? 0) });

  rows.push({ label: 'TOTAL LIABILITIES + EQUITY', values: bs.totalLiabilitiesAndEquityPerPeriod, isTotal: true, totalOverride: fmt(bs.totalLiabilitiesAndEquityPerPeriod[N - 1] ?? 0) });

  // BS Check
  const maxAbsDiff = Math.max(...bs.bsDifferencePerPeriod.map((v) => Math.abs(v)));
  const balances = maxAbsDiff < 0.5;
  rows.push({ label: balances ? 'BS Check: BALANCED' : 'BS Check: OUT OF BALANCE', values: bs.bsDifferencePerPeriod, isTotal: true, totalOverride: fmt(maxAbsDiff) });

  return (
    <div data-testid="module4-balancesheet" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 4 · Balance Sheet</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>{currency}</div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)' }}>
          Composed from every feeder schedule (AR + Inventory + AP + Unearned + Escrow + Fixed Assets + Debt
          + Equity). Cash is the plug from the Direct Cash Flow Statement. BS Check at the bottom should be
          ~0 each period; if it drifts, a working-capital line is missing on one side of the bridge.
        </p>
      </div>

      <PhaseSection
        phaseId="m4-bs-inputs"
        title="Equity Inputs"
        meta="Statutory reserve + explicit Share Capital override"
        storageKey="fmp:m4:bs:inputs:collapsed"
      >
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(200px, 1fr))',
          gap: 'var(--sp-2)',
          padding: 'var(--sp-2)',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: 'var(--sp-3)',
        }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'block', marginBottom: 4 }}>
              Statutory Reserve Transfer Rate (% of PAT)
            </label>
            <input
              type="number"
              value={transferRatePct}
              min={0}
              max={100}
              step={0.01}
              onChange={(e) => setTransferRate(Number(e.target.value) || 0)}
              style={FAST_INPUT}
              data-testid="m4-bs-reserve-rate"
            />
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
              Saudi Companies Law default: 10%. 0 = disabled (PAT flows entirely to Retained Earnings).
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'block', marginBottom: 4 }}>
              Reserve Cap (% of Share Capital)
            </label>
            <input
              type="number"
              value={capPct}
              min={0}
              max={100}
              step={0.01}
              onChange={(e) => setCapPct(Number(e.target.value) || 0)}
              style={FAST_INPUT}
              data-testid="m4-bs-reserve-cap"
            />
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
              Saudi default: 30%. Once the reserve hits this fraction of Share Capital, further transfers stop.
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'block', marginBottom: 4 }}>
              Share Capital (optional override)
            </label>
            <input
              type="number"
              value={project.shareCapital ?? ''}
              min={0}
              placeholder="auto: cumulative equity drawdowns"
              onChange={(e) => {
                const v = e.target.value;
                setShareCapital(v === '' ? undefined : Math.max(0, Number(v)));
              }}
              style={FAST_INPUT}
              data-testid="m4-bs-share-capital"
            />
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
              Blank = use cumulative equity drawdowns from M1. Set explicitly to pin a constant Share Capital line.
            </div>
          </div>
        </div>
      </PhaseSection>

      <M4PeriodTable
        title="Balance Sheet — Project"
        yearLabels={yearLabels}
        currency={currency}
        fmt={fmt}
        rows={rows}
      />

      {!balances && (
        <div style={{
          marginTop: 'var(--sp-2)',
          padding: '8px 12px',
          background: 'color-mix(in srgb, var(--color-warning, #92400e) 12%, transparent)',
          color: 'var(--color-warning, #92400e)',
          border: '1px solid var(--color-warning, #92400e)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 12,
        }}>
          <strong>BS does not balance.</strong> Max absolute Assets − (Liabilities + Equity) across the axis ={' '}
          {fmt(maxAbsDiff)}. Common causes: tax accrual not yet wired into BS, capitalised IDC missing from
          Fixed Assets, dividends not modelled. This is acceptable in early Pass 2e while the bridge is tuned.
        </div>
      )}
    </div>
  );
}
