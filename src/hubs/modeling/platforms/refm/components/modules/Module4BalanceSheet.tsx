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
 *     Current Liabilities (AP + Unearned). Escrow is restricted cash (asset).
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
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { PhaseSection } from './_shared/PhaseSection';
import { M4PeriodTable, type M4Row } from './_shared/m4Table';
import { FAST_INPUT } from './_shared/inputStyles';
import { buildBSRows } from '../../lib/reports/m4Reports';

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
  const labels = getFinancialLabels(project.financialTerminology ?? defaultTerminologyForCountry(project.country));

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

  // M4 Pass 2g: operating DSO control. Drives the AR closing balance
  // for hospitality + lease revenue (residential receivables stay on
  // the M2 milestone path).
  const setOperatingDsoDays = (v: number | undefined): void => {
    state.setProject({
      operatingAr: { ...(project.operatingAr ?? {}), dsoDays: v },
    });
  };

  // BS rows come from the shared pure builder (lib/reports/m4Reports.ts), the
  // single source of truth this tab and the PDF export both render from. The
  // BS is consolidated only (no phase filter).
  const { rows, balances, maxAbsDiff, priorYear, bsDiffPerPeriod } = buildBSRows({
    snap, state, labels, filterPhaseId: '__all__', fmt,
  });

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
        phaseId="m4-bs-wc-inputs"
        title="Working Capital Inputs"
        meta="Operating AR Days (hospitality + lease)"
        storageKey="fmp:m4:bs:wc-inputs:collapsed"
      >
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 1fr)',
          gap: 'var(--sp-2)',
          padding: 'var(--sp-2)',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: 'var(--sp-3)',
        }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'block', marginBottom: 4 }}>
              Operating AR Days (DSO)
            </label>
            <input
              type="number"
              value={project.operatingAr?.dsoDays ?? ''}
              min={0}
              max={365}
              placeholder="0 (cash basis)"
              onChange={(e) => {
                const v = e.target.value;
                setOperatingDsoDays(v === '' ? undefined : Math.max(0, Number(v)));
              }}
              style={FAST_INPUT}
              data-testid="m4-bs-operating-dso"
            />
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
              Days Sales Outstanding for hospitality + lease revenue. Reference v1.16 default is 60 days. Residential
              receivables stay on the M2 milestone-driven path regardless of this input.
            </div>
          </div>
        </div>
      </PhaseSection>

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
        title="Balance Sheet: Project"
        yearLabels={yearLabels}
        currency={currency}
        fmt={fmt}
        rows={rows}
        priorYearLabel={priorYear}
      />

      {!balances && (() => {
        // M4 Pass 2R-Fix (2026-05-24): diagnostic per-period breakdown
        // so users (and developers) can pinpoint where the imbalance
        // first appears + whether it propagates or self-corrects.
        const indexed = bsDiffPerPeriod.map((v, i) => ({ year: yearLabels[i], diff: v, abs: Math.abs(v) }));
        const offenders = indexed
          .filter((r) => r.abs > 0.5)
          .sort((a, b) => b.abs - a.abs)
          .slice(0, 5);
        return (
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
            {fmt(maxAbsDiff)}. Top imbalance years:{' '}
            {offenders.map((r) => `${r.year}: ${fmt(r.diff)}`).join('  ·  ') || 'all small'}.
            <div style={{ marginTop: 6, fontSize: 11 }}>
              Use the <strong>Reconciliation Bridge</strong> below to localize it: the line whose change is not offset by
              its cash-flow / non-cash pair is the leak.
            </div>
          </div>
        );
      })()}

      {/* M4 (2026-05-25): per-line BS reconciliation bridge. Exact identity
       *  Δ(BS diff) = Net CF − Δ(Liab+Equity) + Δ(non-cash Assets). Localizes
       *  which line drives any imbalance (whole-project identity). */}
      {(() => {
        const r = snap.bsReconciliation;
        const neg = (a: number[]): number[] => a.map((v) => -v);
        const recRows: M4Row[] = [
          { label: 'Net cash flow (Direct = Indirect)', values: r.netCashFlowPerPeriod },
          { label: '(−) Δ Liabilities + Equity', values: [], isSection: true },
          { label: 'Δ Debt outstanding', values: neg(r.deltaDebtPerPeriod), indent: 1 },
          { label: 'Δ Share capital', values: neg(r.deltaShareCapitalPerPeriod), indent: 1 },
          { label: 'Δ Reserve + Retained earnings', values: neg(r.deltaReserveRetainedPerPeriod), indent: 1 },
          { label: 'Δ Accounts payable', values: neg(r.deltaApPerPeriod), indent: 1 },
          { label: 'Δ Unearned revenue', values: neg(r.deltaUnearnedPerPeriod), indent: 1 },
          { label: '(+) Δ Non-cash assets', values: [], isSection: true },
          { label: 'Δ Restricted cash (escrow)', values: r.deltaEscrowPerPeriod, indent: 1 },
          { label: 'Δ AR (operating)', values: r.deltaArPerPeriod, indent: 1 },
          { label: 'Δ Receivables (residential)', values: r.deltaResidentialReceivablesPerPeriod, indent: 1 },
          { label: 'Δ Inventory', values: r.deltaInventoryPerPeriod, indent: 1 },
          { label: 'Δ Fixed assets NBV', values: r.deltaNbvPerPeriod, indent: 1 },
          { label: 'Δ Land', values: r.deltaLandPerPeriod, indent: 1 },
          { label: 'Δ Capitalised IDC NBV', values: r.deltaIdcNbvPerPeriod, indent: 1 },
          { label: '= Δ BS difference (this period)', values: r.bsDifferenceChangePerPeriod, isTotal: true },
          { label: 'Unexplained (must be 0)', values: r.unexplainedPerPeriod, isSubtotal: true },
          { label: 'BS difference (cumulative)', values: r.bsDifferencePerPeriod, isSubtotal: true },
        ];
        return (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <M4PeriodTable
              title="Balance Check, Reconciliation Bridge (per period)"
              caption="Δ BS difference = Net cash flow − Δ(Liabilities + Equity) + Δ(non-cash Assets). Exact identity: when the BS balances every line nets to zero each year. When it does not, the line whose change is NOT offset by its cash-flow / non-cash counterpart is the leak. Unexplained must be 0 (else a BS line is missing from the bridge)."
              yearLabels={yearLabels}
              currency={currency}
              fmt={fmt}
              rows={recRows}
              priorYearLabel={priorYear}
            />
          </div>
        );
      })()}
    </div>
  );
}
