'use client';

/**
 * Module4PL.tsx (M4 Pass 2c, 2026-05-20)
 *
 * Profit & Loss surface. Mirrors the reference v1.16 P&L layout
 * (Revenue → CoS → Opex → EBITDA → D&A → EBIT → Interest → PBT
 * → Tax → PAT) with an asset-filter dropdown at the top so the
 * user can see either project totals or one asset's contribution.
 *
 * Terminology is driven by Project.financialTerminology, Saudi
 * mode renders EBIZDA/EBIZ/PBZ/PAZ/Zakat; standard mode renders
 * EBITDA/EBIT/PBT/PAT/Tax.
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

  const [filterAssetId, setFilterAssetId] = useState<string>('__project__');
  const visibleAssets = state.assets.filter((a) => a.visible !== false);

  // Tax rate (configurable, default 0). The label is currency-agnostic
  // ("Tax Rate" / "Zakat Rate" via the terminology helper).
  const taxRatePct = (project.tax?.rate ?? 0) * 100;
  const setTaxRate = (pct: number): void => {
    state.setProject({ tax: { ...(project.tax ?? {}), rate: Math.max(0, pct / 100) } });
  };
  const setTerminology = (mode: 'standard' | 'saudi'): void => {
    state.setProject({ financialTerminology: mode });
  };

  // Project P&L rows
  const buildProjectPLRows = (): M4Row[] => {
    const p = snap.pl;
    const rows: M4Row[] = [];
    rows.push({ label: 'REVENUE', values: [], isSection: true });
    if (p.residentialRevenuePerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Residential Revenue', values: p.residentialRevenuePerPeriod, indent: 1 });
    }
    if (p.hospitalityRevenuePerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Hospitality Revenue', values: p.hospitalityRevenuePerPeriod, indent: 1 });
    }
    if (p.retailRevenuePerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Retail Revenue', values: p.retailRevenuePerPeriod, indent: 1 });
    }
    rows.push({ label: 'Total Revenue', values: p.totalRevenuePerPeriod, isSubtotal: true });

    rows.push({ label: 'COST OF SALES', values: [], isSection: true });
    rows.push({ label: 'Cost of Sales', values: p.cosPerPeriod.map((v) => -v), indent: 1 });
    rows.push({ label: 'Total Cost of Sales', values: p.cosPerPeriod.map((v) => -v), isSubtotal: true });

    rows.push({ label: 'OPERATING EXPENSES', values: [], isSection: true });
    if (p.hospitalityOpexPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Hospitality operating expenses', values: p.hospitalityOpexPerPeriod.map((v) => -v), indent: 1 });
    }
    if (p.retailOpexPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Retail operating expenses', values: p.retailOpexPerPeriod.map((v) => -v), indent: 1 });
    }
    if (p.hqOpexPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'HQ Expenses', values: p.hqOpexPerPeriod.map((v) => -v), indent: 1 });
    }
    rows.push({ label: 'Total Operating Expenses', values: p.totalOpexPerPeriod.map((v) => -v), isSubtotal: true });

    rows.push({ label: labels.ebitda, values: p.ebitdaPerPeriod, isTotal: true });
    rows.push({ label: 'Depreciation & Amortization', values: p.daPerPeriod.map((v) => -v), indent: 1 });
    rows.push({ label: labels.ebit, values: p.ebitPerPeriod, isSubtotal: true });

    rows.push({ label: 'Interest & financing cost', values: p.interestExpensePerPeriod.map((v) => -v), indent: 1 });
    if (p.interestIncomePerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Interest income / other', values: p.interestIncomePerPeriod, indent: 1 });
    }
    rows.push({ label: labels.pbt, values: p.pbtPerPeriod, isSubtotal: true });

    rows.push({ label: `${labels.tax} (${(p.taxRate * 100).toFixed(2)}%)`, values: p.taxPerPeriod.map((v) => -v), indent: 1 });
    rows.push({ label: labels.pat, values: p.patPerPeriod, isTotal: true });

    return rows;
  };

  // Asset P&L rows (filtered view)
  const buildAssetPLRows = (assetId: string): M4Row[] => {
    const pl = snap.perAssetPL.get(assetId);
    if (!pl) return [];
    const rows: M4Row[] = [];
    rows.push({ label: 'REVENUE', values: [], isSection: true });
    rows.push({ label: 'Revenue', values: pl.revenuePerPeriod, indent: 1 });

    if (pl.cosPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'COST OF SALES', values: [], isSection: true });
      rows.push({ label: 'Cost of Sales', values: pl.cosPerPeriod.map((v) => -v), indent: 1 });
    }
    if (pl.opexPerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'OPERATING EXPENSES', values: [], isSection: true });
      rows.push({ label: 'Operating Expenses', values: pl.opexPerPeriod.map((v) => -v), indent: 1 });
    }
    rows.push({ label: labels.ebitda, values: pl.ebitdaPerPeriod, isTotal: true });
    rows.push({ label: 'Depreciation & Amortization', values: pl.daPerPeriod.map((v) => -v), indent: 1 });
    rows.push({ label: labels.ebit, values: pl.ebitPerPeriod, isSubtotal: true });
    return rows;
  };

  const filteredRows = filterAssetId === '__project__'
    ? buildProjectPLRows()
    : buildAssetPLRows(filterAssetId);

  return (
    <div data-testid="module4-pl" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 4 · {labels.incomeStatementTitle}</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>{currency}</div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)' }}>
          Strategy-grouped P&L composed from Module 2 Revenue + CoS, Module 3 Opex, M4 Pass 1 D&A and Module 1
          financing interest. Asset filter at the top right shows either project totals or one asset's stand-alone
          contribution (revenue − CoS − opex − D&A; interest + tax stay at project level).
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
              <option value="saudi">Saudi (EBIZDA / EBIZ / Zakat)</option>
            </select>
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
              Drives row labels across P&L, CF and BS.
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'block', marginBottom: 4 }}>
              {labels.taxRate} (%)
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

      {/* Asset filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--sp-2)' }}>
        <label style={{ fontSize: 12, color: 'var(--color-meta)', fontWeight: 600 }}>View:</label>
        <select
          value={filterAssetId}
          onChange={(e) => setFilterAssetId(e.target.value)}
          style={SELECT_STYLE}
          data-testid="m4-pl-asset-filter"
        >
          <option value="__project__">Project (all assets)</option>
          {visibleAssets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}, {a.strategy}
            </option>
          ))}
        </select>
      </div>

      <M4PeriodTable
        title={filterAssetId === '__project__' ? `${labels.incomeStatementTitle}: Project` : `${labels.incomeStatementTitle}: ${state.assets.find((a) => a.id === filterAssetId)?.name ?? ''}`}
        yearLabels={yearLabels}
        currency={currency}
        fmt={fmt}
        priorYearLabel={snap.projectStartYear - 1}
        rows={filteredRows.length > 0 ? filteredRows : [{ label: 'No data for this selection', values: new Array<number>(N).fill(0) }]}
      />
    </div>
  );
}
