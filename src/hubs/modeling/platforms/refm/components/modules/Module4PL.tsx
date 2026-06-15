'use client';

/**
 * Module4PL.tsx (M4 Pass 2c, 2026-05-20)
 *
 * Profit & Loss surface. Mirrors the reference v1.16 P&L layout
 * (Revenue → CoS → Opex → EBITDA → D&A → EBIT → Interest → PBT
 * → Tax → PAT) with an asset-filter dropdown at the top so the
 * user can see either project totals or one asset's contribution.
 *
 * Terminology is driven by Project.financialTerminology. Saudi mode
 * keeps EBITDA/EBIT (universal) and renders Zakat / Profit before Zakat
 * / Profit after Zakat; standard mode renders EBITDA/EBIT/PBT/PAT/Tax.
 *
 * Tax line: configurable rate (Project.tax.rate, default 0) applied
 * to max(PBT, 0). PAT = PBT − Tax.
 *
 * All math lives in financials-resolvers.ts.
 */

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { PhaseSection } from './_shared/PhaseSection';
import { M4PeriodTable } from './_shared/m4Table';
import { buildPLRows } from '../../lib/reports/m4Reports';
import { OverrideBadge } from './_shared/OverrideBadge';

const SELECT_STYLE: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  fontSize: 12,
  minWidth: 220,
};

export default function Module4PL(): React.JSX.Element {
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

  const terminology = project.financialTerminology ?? defaultTerminologyForCountry(project.country);
  const labels = getFinancialLabels(terminology);

  // M4 Pass 2L (2026-05-20): phase filter replaces asset filter per
  // Ahmad. Buttons not dropdown.
  const [filterPhaseId, setFilterPhaseId] = useState<string>('__all__');
  const phaseById = new Map(state.phases.map((p) => [p.id, p] as const));
  const phaseLabelFor = (phaseId: string): string => phaseById.get(phaseId)?.name ?? '';

  // Tax rate (configurable, default 0). The label is currency-agnostic
  // ("Tax Rate" / "Zakat Rate" via the terminology helper).
  const taxRatePct = (project.tax?.rate ?? 0) * 100;
  const setTaxRate = (pct: number): void => {
    state.setProject({ tax: { ...(project.tax ?? {}), rate: Math.max(0, pct / 100) } });
  };
  const setTerminology = (mode: 'standard' | 'saudi'): void => {
    state.setProject({ financialTerminology: mode });
  };

  // P&L rows come from the shared pure builder (lib/reports/m4Reports.ts),
  // the single source of truth this tab and the PDF export both render from.
  // A phase-filtered view truncates at EBITDA inside the builder.
  const filteredRows = buildPLRows({ snap, state, labels, filterPhaseId, fmt });

  return (
    <div data-testid="module4-pl" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 4 · {labels.incomeStatementTitle}</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>{currency}</div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)' }}>
          Strategy-grouped P&L composed from Module 2 Revenue + CoS, Module 3 Opex, M4 Pass 1 D&A and Module 1
          financing interest. The phase filter shows either the consolidated project statement (full P&L down to
          {' '}{labels.pat}) or a single phase, which stops at {labels.ebitda} since D&A, interest and tax are
          project-level (not cleanly attributable to one phase).
        </p>
      </div>

      {/* Inputs panel: terminology + tax rate */}
      <PhaseSection
        phaseId="m4-pl-inputs"
        title="P&L Inputs"
        meta="Terminology + tax rate"
        storageKey="fmp:m4:pl:inputs:collapsed"
      >
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(200px, 1fr))',
          gap: 'var(--sp-2)',
          padding: 'var(--sp-2)',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: 'var(--sp-2)',
        }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'block', marginBottom: 4 }}>
              Terminology mode
            </label>
            <select
              value={terminology}
              onChange={(e) => setTerminology(e.target.value as 'standard' | 'saudi')}
              style={SELECT_STYLE}
              data-testid="m4-pl-terminology"
            >
              <option value="standard">Standard (EBITDA / EBIT / Tax)</option>
              <option value="saudi">Saudi (EBITDA / EBIT / Zakat)</option>
            </select>
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
              Drives row labels across P&L, CF and BS.
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'block', marginBottom: 4 }}>
              {labels.taxRate} (%)<OverrideBadge path="project.tax.rate" />
            </label>
            <input
              type="number"
              value={taxRatePct}
              min={0}
              max={100}
              step={0.01}
              onChange={(e) => setTaxRate(Number(e.target.value) || 0)}
              style={{ ...SELECT_STYLE, minWidth: 0, textAlign: 'right' }}
              data-testid="m4-pl-tax-rate"
            />
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
              Applied to max({labels.pbt}, 0) each period. 0 = no tax.
            </div>
          </div>
        </div>
      </PhaseSection>

      {/* M4 Pass 2L: phase filter buttons (replacing the asset dropdown). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--color-meta)', fontWeight: 600 }}>Phase:</label>
        <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }} data-testid="m4-pl-phase-filter">
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
                data-testid={`m4-pl-phase-filter-${opt.id}`}
              >
                {opt.name}
              </button>
            );
          })}
        </div>
      </div>

      <M4PeriodTable
        title={filterPhaseId === '__all__'
          ? `${labels.incomeStatementTitle}: Project`
          : `${labels.incomeStatementTitle}: ${phaseLabelFor(filterPhaseId)}`}
        yearLabels={yearLabels}
        currency={currency}
        fmt={fmt}
        priorYearLabel={snap.projectStartYear - 1}
        showPhaseColumn
        rows={filteredRows.length > 0 ? filteredRows : [{ label: 'No data for this selection', values: new Array<number>(N).fill(0) }]}
      />
    </div>
  );
}
