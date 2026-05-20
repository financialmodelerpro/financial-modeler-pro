'use client';

/**
 * Module4CashFlow.tsx (M4 Pass 2d, 2026-05-20)
 *
 * Cash Flow surface with Direct + Indirect view toggle and an asset
 * filter dropdown (asset filter applies to the Direct view only;
 * the Indirect view is project-level because the working-capital
 * bridge composes across assets).
 *
 * Direct (matches the reference v1.16 CF layout):
 *   Revenue Received  −  Escrow adj  −  Opex Paid  −  Tax Paid
 *     = Cash from Operations
 *   −  Capex
 *     = Cash from Investment
 *   +  Equity drawdown  +  Debt drawdown  −  Debt repayment
 *     −  Interest paid
 *     = Cash from Financing
 *   = Net Cash Flow  →  Opening + Closing cash
 *
 * Indirect: PAT + D&A + Interest Expense − ΔWC = Cash from Operations,
 * then Investment + Financing as in Direct.
 */

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { M4PeriodTable, type M4Row } from './_shared/m4Table';

const SELECT_STYLE: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  fontSize: 12,
  minWidth: 220,
};

type CFView = 'direct' | 'indirect';

export default function Module4CashFlow(): React.JSX.Element {
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
  const scale: DisplayScale = (project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(project.currency ?? 'SAR', scale);
  const yearLabels = snap.yearLabels;
  const N = snap.axisLength;

  const terminology = project.financialTerminology ?? defaultTerminologyForCountry(project.country);
  const labels = getFinancialLabels(terminology);

  const [view, setView] = useState<CFView>('direct');
  const [filterAssetId, setFilterAssetId] = useState<string>('__project__');
  const visibleAssets = state.assets.filter((a) => a.visible !== false);

  // Direct CF rows, project totals
  const buildDirectProjectRows = (): M4Row[] => {
    const d = snap.directCF;
    const rows: M4Row[] = [];
    rows.push({ label: 'CASH FROM OPERATIONS', values: [], isSection: true });
    rows.push({ label: 'Revenue received', values: d.revenueReceivedPerPeriod, indent: 1 });
    if (d.escrowHeldPerPeriod.some((v) => v !== 0) || d.escrowReleasePerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Less: Inaccessible Funds Locked', values: d.escrowHeldPerPeriod, indent: 1 });
      rows.push({ label: 'Add: Release of Inaccessible Funds', values: d.escrowReleasePerPeriod, indent: 1 });
    }
    rows.push({ label: 'Operating expenses paid', values: d.opexPaidPerPeriod, indent: 1 });
    if (d.hqOpexPaidPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'HQ expenses paid', values: d.hqOpexPaidPerPeriod, indent: 1 });
    }
    if (d.taxPaidPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: `${labels.taxPaid}`, values: d.taxPaidPerPeriod, indent: 1 });
    }
    rows.push({ label: 'Cash Flow from Operations', values: d.cashFromOperationsPerPeriod, isSubtotal: true });

    rows.push({ label: 'CASH FROM INVESTMENT', values: [], isSection: true });
    rows.push({ label: 'Capital expenditure', values: d.capexPerPeriod, indent: 1 });
    rows.push({ label: 'Cash Flow from Investment', values: d.cashFromInvestmentPerPeriod, isSubtotal: true });

    rows.push({ label: 'CASH FROM FINANCING', values: [], isSection: true });
    if (d.equityDrawdownPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Equity drawdown', values: d.equityDrawdownPerPeriod, indent: 1 });
    }
    if (d.debtDrawdownPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Debt drawdown', values: d.debtDrawdownPerPeriod, indent: 1 });
    }
    if (d.debtRepaymentPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Debt repayment', values: d.debtRepaymentPerPeriod, indent: 1 });
    }
    if (d.interestPaidPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Finance cost paid', values: d.interestPaidPerPeriod, indent: 1 });
    }
    rows.push({ label: 'Cash Flow from Financing', values: d.cashFromFinancingPerPeriod, isSubtotal: true });

    rows.push({ label: 'Net Cash Flow', values: d.netCashFlowPerPeriod, isTotal: true });
    rows.push({ label: 'Opening cash', values: d.openingCashPerPeriod, indent: 1, totalOverride: fmt(d.openingCashPerPeriod[0] ?? 0) });
    rows.push({ label: 'Closing cash', values: d.closingCashPerPeriod, isSubtotal: true, totalOverride: fmt(d.closingCashPerPeriod[N - 1] ?? 0) });
    return rows;
  };

  // Direct CF rows, asset filtered (Operations only; Investment + Financing stay project-level)
  const buildDirectAssetRows = (assetId: string): M4Row[] => {
    const cf = snap.perAssetCF.get(assetId);
    if (!cf) return [];
    const rows: M4Row[] = [];
    rows.push({ label: 'CASH FROM OPERATIONS', values: [], isSection: true });
    rows.push({ label: 'Revenue received', values: cf.revenueReceivedPerPeriod, indent: 1 });
    rows.push({ label: 'Operating expenses paid', values: cf.opexPaidPerPeriod.map((v) => -v), indent: 1 });
    const opCash = cf.revenueReceivedPerPeriod.map((v, i) => v - (cf.opexPaidPerPeriod[i] ?? 0));
    rows.push({ label: 'Cash from operations (asset)', values: opCash, isSubtotal: true });

    rows.push({ label: 'CASH FROM INVESTMENT (asset)', values: [], isSection: true });
    rows.push({ label: 'Capital expenditure', values: cf.capexPerPeriod.map((v) => -v), indent: 1 });
    const invCash = cf.capexPerPeriod.map((v) => -v);
    rows.push({ label: 'Cash from investment (asset)', values: invCash, isSubtotal: true });

    const net = opCash.map((v, i) => v + invCash[i]);
    rows.push({ label: 'Asset Net Cash Flow (excl. financing)', values: net, isTotal: true });
    rows.push({ label: 'Note: Tax, escrow, financing flows are project-level only', values: new Array<number>(N).fill(0), isSection: true });
    return rows;
  };

  // Indirect CF rows, project level only
  const buildIndirectRows = (): M4Row[] => {
    const ic = snap.indirectCF;
    const rows: M4Row[] = [];
    rows.push({ label: 'CASH FROM OPERATIONS (INDIRECT)', values: [], isSection: true });
    rows.push({ label: labels.pat, values: ic.patPerPeriod, indent: 1 });
    rows.push({ label: '(+) Depreciation & Amortization', values: ic.daPerPeriod, indent: 1 });
    rows.push({ label: '(+) Interest expense (add back)', values: ic.interestExpensePerPeriod, indent: 1 });
    rows.push({ label: '(−) Change in AR', values: ic.changeInArPerPeriod, indent: 1 });
    rows.push({ label: '(−) Change in Inventory', values: ic.changeInInventoryPerPeriod, indent: 1 });
    rows.push({ label: '(+) Change in AP', values: ic.changeInApPerPeriod, indent: 1 });
    rows.push({ label: '(+) Change in Unearned Revenue', values: ic.changeInUnearnedPerPeriod, indent: 1 });
    rows.push({ label: '(+) Change in Escrow balance', values: ic.changeInEscrowPerPeriod, indent: 1 });
    rows.push({ label: '(−) Cash interest paid', values: ic.interestPaidPerPeriod, indent: 1 });
    rows.push({ label: 'Cash Flow from Operations', values: ic.cashFromOperationsPerPeriod, isSubtotal: true });

    rows.push({ label: 'CASH FROM INVESTMENT', values: [], isSection: true });
    rows.push({ label: 'Capital expenditure', values: ic.capexPerPeriod, indent: 1 });
    rows.push({ label: 'Cash Flow from Investment', values: ic.cashFromInvestmentPerPeriod, isSubtotal: true });

    rows.push({ label: 'CASH FROM FINANCING', values: [], isSection: true });
    if (ic.equityDrawdownPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Equity drawdown', values: ic.equityDrawdownPerPeriod, indent: 1 });
    }
    if (ic.debtDrawdownPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Debt drawdown', values: ic.debtDrawdownPerPeriod, indent: 1 });
    }
    if (ic.debtRepaymentPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Debt repayment', values: ic.debtRepaymentPerPeriod, indent: 1 });
    }
    if (ic.interestPaidPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Finance cost paid', values: ic.interestPaidPerPeriod, indent: 1 });
    }
    rows.push({ label: 'Cash Flow from Financing', values: ic.cashFromFinancingPerPeriod, isSubtotal: true });
    rows.push({ label: 'Net Cash Flow', values: ic.netCashFlowPerPeriod, isTotal: true });
    return rows;
  };

  const rows = view === 'direct'
    ? (filterAssetId === '__project__' ? buildDirectProjectRows() : buildDirectAssetRows(filterAssetId))
    : buildIndirectRows();

  return (
    <div data-testid="module4-cashflow" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 4 · Cash Flow Statement</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>{currency}</div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)' }}>
          Direct CF mirrors the reference v1.16 layout (literal cash in/out). Indirect CF reconstructs cash from
          {' '}{labels.pat} via D&A and working-capital changes. Both views end with the same Net Cash Flow per
          period, if they diverge there's a working-capital line missing in the bridge.
        </p>
      </div>

      {/* View toggle + asset filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--color-meta)', fontWeight: 600 }}>Method:</label>
        <div style={{ display: 'inline-flex', gap: 4 }}>
          {(['direct', 'indirect'] as const).map((m) => {
            const active = view === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setView(m)}
                style={{
                  fontSize: 11,
                  padding: '6px 12px',
                  background: active ? 'var(--color-navy)' : 'var(--color-surface)',
                  color: active ? 'var(--color-on-primary-navy)' : 'var(--color-navy)',
                  border: '1px solid var(--color-navy)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
                data-testid={`m4-cf-view-${m}`}
              >
                {m === 'direct' ? 'Direct' : 'Indirect'}
              </button>
            );
          })}
        </div>
        {view === 'direct' && (
          <>
            <label style={{ fontSize: 12, color: 'var(--color-meta)', fontWeight: 600, marginLeft: 16 }}>View:</label>
            <select
              value={filterAssetId}
              onChange={(e) => setFilterAssetId(e.target.value)}
              style={SELECT_STYLE}
              data-testid="m4-cf-asset-filter"
            >
              <option value="__project__">Project (all assets + financing)</option>
              {visibleAssets.map((a) => (
                <option key={a.id} value={a.id}>{a.name}, {a.strategy}</option>
              ))}
            </select>
          </>
        )}
      </div>

      <M4PeriodTable
        title={view === 'direct'
          ? (filterAssetId === '__project__' ? 'Cash Flow, Direct Method (project)' : `Cash Flow, Direct Method (${state.assets.find((a) => a.id === filterAssetId)?.name ?? ''})`)
          : 'Cash Flow, Indirect Method (project)'}
        yearLabels={yearLabels}
        currency={currency}
        fmt={fmt}
        rows={rows.length > 0 ? rows : [{ label: 'No data', values: new Array<number>(N).fill(0) }]}
      />
    </div>
  );
}
