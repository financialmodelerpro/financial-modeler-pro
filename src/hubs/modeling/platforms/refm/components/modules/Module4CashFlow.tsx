'use client';

/**
 * Module4CashFlow.tsx (M4 Pass 2d, 2026-05-20; shared-builder refactor 2026-06-04)
 *
 * Cash Flow surface with Direct + Indirect view toggle and a phase filter.
 * The row model is built by the shared pure builders in
 * lib/reports/m4Reports.ts (buildDirectCFRows / buildIndirectCFRows), the
 * single source of truth this tab and the PDF export both render from.
 *
 * Direct (matches the reference v1.16 CF layout):
 *   Revenue Received  −  Escrow adj  −  Opex Paid  −  Tax Paid
 *     = Cash from Operations
 *   −  Capex  = Cash from Investment
 *   +  Equity / Debt drawdown  −  Debt repayment  −  Interest paid
 *     = Cash from Financing  →  Net Cash Flow  →  Opening + Closing cash
 *
 * Indirect: PAT + D&A + Interest Expense − ΔWC = Cash from Operations, then
 * Investment + Financing as in Direct.
 *
 * A phase-filtered view shows Operating + Investing activities only (financing
 * is raised / serviced at the project level).
 */

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { M4PeriodTable } from './_shared/m4Table';
import { buildDirectCFRows, buildIndirectCFRows } from '../../lib/reports/m4Reports';

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
  // Phase filter buttons; values are phase ids or '__all__'.
  const [filterPhaseId, setFilterPhaseId] = useState<string>('__all__');
  const phaseById = new Map(state.phases.map((p) => [p.id, p] as const));
  const phaseLabelFor = (phaseId: string): string => phaseById.get(phaseId)?.name ?? '';

  const ctx = { snap, state, labels, filterPhaseId, fmt };
  const rows = view === 'direct' ? buildDirectCFRows(ctx) : buildIndirectCFRows(ctx);

  return (
    <div data-testid="module4-cashflow" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 4 · Cash Flow Statement</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>{currency}</div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)' }}>
          Direct CF mirrors the reference v1.16 layout (literal cash in/out). Indirect CF reconstructs cash from
          {' '}{labels.pat} via D&A and working-capital changes. The consolidated ("All") view runs the full
          statement (Operations + Investing + Financing) and both methods end on the same Net Cash Flow; a single
          phase shows its Operating + Investing activities only, since financing is raised and serviced at the
          project level.
        </p>
      </div>

      {/* View toggle + phase filter */}
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
        <label style={{ fontSize: 12, color: 'var(--color-meta)', fontWeight: 600, marginLeft: 16 }}>Phase:</label>
        <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }} data-testid="m4-cf-phase-filter">
          {[{ id: '__all__', name: 'All' } as const, ...state.phases.map((p) => ({ id: p.id, name: p.name }))].map((opt) => {
            const active = filterPhaseId === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilterPhaseId(opt.id)}
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
                data-testid={`m4-cf-phase-filter-${opt.id}`}
              >
                {opt.name}
              </button>
            );
          })}
        </div>
      </div>

      <M4PeriodTable
        title={view === 'direct'
          ? (filterPhaseId === '__all__' ? 'Cash Flow, Direct Method (project)' : `Cash Flow, Direct Method (${phaseLabelFor(filterPhaseId)})`)
          : (filterPhaseId === '__all__' ? 'Cash Flow, Indirect Method (project)' : `Cash Flow, Indirect Method (${phaseLabelFor(filterPhaseId)})`)}
        yearLabels={yearLabels}
        currency={currency}
        fmt={fmt}
        priorYearLabel={snap.projectStartYear - 1}
        showPhaseColumn={view === 'direct'}
        rows={rows.length > 0 ? rows : [{ label: 'No data', values: new Array<number>(N).fill(0) }]}
      />
    </div>
  );
}
