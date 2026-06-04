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

  // M4 Pass 2L (2026-05-20): phase filter replaces asset filter per
  // Ahmad. Buttons not dropdown.
  const [filterPhaseId, setFilterPhaseId] = useState<string>('__all__');
  const visibleAssets = state.assets.filter((a) => a.visible !== false);
  const phaseById = new Map(state.phases.map((p) => [p.id, p] as const));
  const phaseLabelFor = (phaseId: string): string => phaseById.get(phaseId)?.name ?? '';
  const phaseShort = (phaseId: string): string => {
    const name = phaseLabelFor(phaseId);
    const m = name.match(/(\d+)/);
    return m ? m[1] : name.slice(0, 4);
  };

  // Tax rate (configurable, default 0). The label is currency-agnostic
  // ("Tax Rate" / "Zakat Rate" via the terminology helper).
  const taxRatePct = (project.tax?.rate ?? 0) * 100;
  const setTaxRate = (pct: number): void => {
    state.setProject({ tax: { ...(project.tax ?? {}), rate: Math.max(0, pct / 100) } });
  };
  const setTerminology = (mode: 'standard' | 'saudi'): void => {
    state.setProject({ financialTerminology: mode });
  };

  // Project P&L rows, detailed per-asset (M4 Pass 2k + 2L + 2M-Fix
  // 2026-05-20). Mirrors the reference v1.16 layout: each strategy
  // block lists its asset rows, then a strategy subtotal. Strategy
  // groups are collapsible (totals visible by default). Each row
  // carries its phaseLabel for the Phase column.
  //
  // Pass 2M-Fix (2026-05-20): when phase filter is active, every
  // subtotal + finance cost + D&A + tax line recomputes from the
  // FILTERED slices so an existing-operations Phase 1 loan doesn't
  // bleed into Phase 2's P&L view. Tranches filter by tranche.phaseId.
  // HQ Opex stays project-level (no phase ownership) and is tagged
  // (project) when filtered.
  const buildProjectPLRows = (): M4Row[] => {
    const p = snap.pl;
    const rows: M4Row[] = [];
    const negArr = (arr: number[]): number[] => arr.map((v) => -v);
    const matchesPhase = (a: { phaseId: string }): boolean =>
      filterPhaseId === '__all__' || a.phaseId === filterPhaseId;
    const residentialAssets = visibleAssets.filter((a) => (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && matchesPhase(a));
    const hospitalityAssets = visibleAssets.filter((a) => (a.strategy === 'Operate' || a.isCompanion === true) && matchesPhase(a));
    const retailAssets = visibleAssets.filter((a) => a.strategy === 'Lease' && matchesPhase(a));
    const phaseFiltered = filterPhaseId !== '__all__';
    const projTag = phaseFiltered ? ' (project)' : '';

    // Helpers to sum per-asset slices.
    const zerosN = (): number[] => new Array<number>(N).fill(0);
    const sumAssetsSeries = (
      assets: Array<{ id: string }>,
      key: 'revenuePerPeriod' | 'cosPerPeriod' | 'opexPerPeriod',
    ): number[] => {
      const out = zerosN();
      for (const a of assets) {
        const pl = snap.perAssetPL.get(a.id);
        if (!pl) continue;
        for (let t = 0; t < N; t++) out[t] += pl[key][t] ?? 0;
      }
      return out;
    };

    // Per-strategy revenue, CoS, Opex subtotals. When unfiltered these
    // equal p.residentialRevenuePerPeriod etc.; under filter they
    // re-sum the visible assets.
    const resRev = phaseFiltered ? sumAssetsSeries(residentialAssets, 'revenuePerPeriod') : p.residentialRevenuePerPeriod;
    const hospRev = phaseFiltered ? sumAssetsSeries(hospitalityAssets, 'revenuePerPeriod') : p.hospitalityRevenuePerPeriod;
    const retailRev = phaseFiltered ? sumAssetsSeries(retailAssets, 'revenuePerPeriod') : p.retailRevenuePerPeriod;
    const totalRev = phaseFiltered
      ? resRev.map((v, i) => v + hospRev[i] + retailRev[i])
      : p.totalRevenuePerPeriod;
    const cosTotal = phaseFiltered ? sumAssetsSeries(residentialAssets, 'cosPerPeriod') : p.cosPerPeriod;
    const hospOpex = phaseFiltered ? sumAssetsSeries(hospitalityAssets, 'opexPerPeriod') : p.hospitalityOpexPerPeriod;
    const retailOpex = phaseFiltered ? sumAssetsSeries(retailAssets, 'opexPerPeriod') : p.retailOpexPerPeriod;
    // HQ Opex: project-only, no phase ownership.
    const hqOpex = p.hqOpexPerPeriod;
    const totalOpex = hospOpex.map((v, i) => v + retailOpex[i] + hqOpex[i]);

    // D&A: per-asset depreciation + IDC NBV depreciation. IDC dep is
    // project-only; under filter allocate by phase land-sqm share
    // (mirrors composer's IDC allocation rule, same approach as the
    // BS phase filter).
    const daAssets = zerosN();
    if (phaseFiltered) {
      const phaseAssetIds = new Set(
        [...residentialAssets, ...hospitalityAssets, ...retailAssets].map((a) => a.id),
      );
      for (const id of phaseAssetIds) {
        const fa = snap.fixedAssets.byAsset.get(id);
        if (!fa) continue;
        const dep = fa.depreciable.depreciationPerPeriod;
        for (let t = 0; t < N; t++) daAssets[t] += dep[t] ?? 0;
      }
      // IDC dep share.
      const totalLandSqm = Math.max(0, snap.idc.totalLandSqm);
      let phaseLandSqm = 0;
      for (const id of phaseAssetIds) phaseLandSqm += snap.idc.byAsset.get(id)?.landSqm ?? 0;
      const idcShare = totalLandSqm > 0 ? phaseLandSqm / totalLandSqm : 0;
      const idcDep = snap.idc.idcDepreciationPerPeriod;
      for (let t = 0; t < N; t++) daAssets[t] += (idcDep[t] ?? 0) * idcShare;
    }
    const da = phaseFiltered ? daAssets : p.daPerPeriod;

    // Interest expense: filter facilities by tranche.phaseId. Engine
    // emits `interestAccrued` (total) and `interestCapitalized` (IDC
    // capitalised portion, doesn't hit P&L). Expense = accrued -
    // capitalised. Existing-phase loans no longer bleed into other
    // phases under filter.
    const interestExpense = zerosN();
    if (phaseFiltered) {
      const trancheIds = new Set(
        state.financingTranches.filter((t) => t.phaseId === filterPhaseId).map((t) => t.id),
      );
      for (const id of trancheIds) {
        const fac = snap.financing.facilities.get(id);
        if (!fac) continue;
        for (let t = 0; t < N; t++) {
          const accrued = fac.interestAccrued[t + 1] ?? 0;
          const capitalised = fac.interestCapitalized[t + 1] ?? 0;
          interestExpense[t] += Math.max(0, accrued - capitalised);
        }
      }
    } else {
      for (let t = 0; t < N; t++) interestExpense[t] = p.interestExpensePerPeriod[t] ?? 0;
    }

    // Recompute EBITDA / EBIT / PBT / Tax / PAT from the filtered lines.
    const ebitda = totalRev.map((v, i) => v - (cosTotal[i] ?? 0) - (totalOpex[i] ?? 0));
    const ebit = ebitda.map((v, i) => v - (da[i] ?? 0));
    const pbt = ebit.map((v, i) => v - (interestExpense[i] ?? 0));
    const taxArr = pbt.map((v) => Math.max(0, v) * p.taxRate);
    const pat = pbt.map((v, i) => v - (taxArr[i] ?? 0));

    // ── REVENUE ────────────────────────────────────────────────────
    rows.push({ label: 'REVENUE', values: [], isSection: true });
    const pushAssetPL = (a: { id: string; name: string; phaseId: string }, key: 'revenuePerPeriod' | 'cosPerPeriod' | 'opexPerPeriod', group: string, sign = 1): void => {
      const pl = snap.perAssetPL.get(a.id);
      if (!pl) return;
      const series = pl[key];
      if (series.every((v) => v === 0)) return;
      rows.push({
        label: a.name,
        values: sign === 1 ? series : negArr(series),
        indent: 2,
        phaseLabel: phaseShort(a.phaseId),
        collapseGroup: group,
        collapseRole: 'member',
      });
    };

    // M4 Pass 2N (2026-05-21): strategy buckets now surface the subtotal
    // inline on the collapsible header row (no separate "Total X" row
    // below). Sections default-open; user can collapse to hide per-asset
    // detail. Members render indented below when expanded.
    if (residentialAssets.length > 0 && resRev.some((v) => v !== 0)) {
      rows.push({ label: 'Residential Revenue', values: resRev, isSection: true, collapseGroup: 'pl-rev-res', collapseRole: 'header', defaultCollapsed: false });
      for (const a of residentialAssets) pushAssetPL(a, 'revenuePerPeriod', 'pl-rev-res');
    }
    if (hospitalityAssets.length > 0 && hospRev.some((v) => v !== 0)) {
      rows.push({ label: 'Hospitality Revenue', values: hospRev, isSection: true, collapseGroup: 'pl-rev-hosp', collapseRole: 'header', defaultCollapsed: false });
      for (const a of hospitalityAssets) pushAssetPL(a, 'revenuePerPeriod', 'pl-rev-hosp');
    }
    if (retailAssets.length > 0 && retailRev.some((v) => v !== 0)) {
      rows.push({ label: 'Retail Revenue', values: retailRev, isSection: true, collapseGroup: 'pl-rev-ret', collapseRole: 'header', defaultCollapsed: false });
      for (const a of retailAssets) pushAssetPL(a, 'revenuePerPeriod', 'pl-rev-ret');
    }
    rows.push({ label: 'Total Revenue', values: totalRev, isTotal: true });

    // ── COST OF SALES ─────────────────────────────────────────────
    if (cosTotal.some((v) => v !== 0)) {
      rows.push({ label: 'COST OF SALES', values: [], isSection: true });
      rows.push({ label: 'Residential cost of sales', values: negArr(cosTotal), isSection: true, collapseGroup: 'pl-cos', collapseRole: 'header', defaultCollapsed: false });
      for (const a of residentialAssets) pushAssetPL(a, 'cosPerPeriod', 'pl-cos', -1);
    }

    // ── OPERATING EXPENSES ────────────────────────────────────────
    rows.push({ label: 'OPERATING EXPENSES', values: [], isSection: true });
    if (hospitalityAssets.length > 0 && hospOpex.some((v) => v !== 0)) {
      rows.push({ label: 'Hospitality operating expenses', values: negArr(hospOpex), isSection: true, collapseGroup: 'pl-opex-hosp', collapseRole: 'header', defaultCollapsed: false });
      for (const a of hospitalityAssets) pushAssetPL(a, 'opexPerPeriod', 'pl-opex-hosp', -1);
    }
    if (retailAssets.length > 0 && retailOpex.some((v) => v !== 0)) {
      rows.push({ label: 'Retail operating expenses', values: negArr(retailOpex), isSection: true, collapseGroup: 'pl-opex-ret', collapseRole: 'header', defaultCollapsed: false });
      for (const a of retailAssets) pushAssetPL(a, 'opexPerPeriod', 'pl-opex-ret', -1);
    }
    if (hqOpex.some((v) => v !== 0)) {
      rows.push({ label: `HQ Expenses${projTag}`, values: negArr(hqOpex), indent: 1 });
    }
    rows.push({ label: 'Total Operating Expenses', values: negArr(totalOpex), isSubtotal: true });

    rows.push({ label: labels.ebitda, values: ebitda, isTotal: true });

    // Phase-level P&L stops at EBITDA / EBIZDA (per Ahmad 2026-06-04): D&A,
    // interest, tax and the below-the-line items are project-level (financing +
    // depreciation are not cleanly attributable to a single phase), so a
    // phase-filtered view shows the operating result only. The consolidated
    // ("All") view carries the full statement down to PAT.
    if (phaseFiltered) return rows;

    rows.push({ label: 'Depreciation & Amortization', values: negArr(da), indent: 1 });
    rows.push({ label: labels.ebit, values: ebit, isSubtotal: true });

    rows.push({ label: 'Interest & financing cost', values: negArr(interestExpense), indent: 1 });
    if (p.interestIncomePerPeriod.some((v) => v !== 0)) {
      rows.push({ label: 'Interest income / other', values: p.interestIncomePerPeriod, indent: 1 });
    }
    rows.push({ label: labels.pbt, values: pbt, isSubtotal: true });

    rows.push({ label: `${labels.tax} (${(p.taxRate * 100).toFixed(2)}%)`, values: negArr(taxArr), indent: 1 });
    rows.push({ label: labels.pat, values: pat, isTotal: true });

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

  // M4 Pass 2L: phase filter narrows asset rows; project totals stay.
  const filteredRows = buildProjectPLRows();
  // Asset-filtered view is reserved for a future drill-down per asset;
  // the function stays here for back-compat and tests.
  void buildAssetPLRows;

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
