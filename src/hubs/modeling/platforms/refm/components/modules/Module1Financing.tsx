'use client';

/**
 * Module1Financing.tsx, Tab 4 Financing (rebuild 2026-05-14).
 *
 * Consumes the new src/core/calculations/financing/ engine. One
 * source of truth per number; no local re-derivation. Two sub-tabs:
 *
 *   Inputs:
 *     1. Project Financing Settings (Minimum Cash Reserve)
 *     2. Funding Method (3 horizontal radio cards)
 *     3. Funding Basis (3 cols + match chip)
 *     4. Land Funding per parcel (project-wide, no phase filter)
 *     5. Debt Facilities list
 *     6. Capex Breakdown (3 rows)
 *     7. Funding Requirement (4 rows: Method 1 / 2 / 3 / Selected)
 *     8. Total Debt Required (per-facility + grand total)
 *     9. Total Equity Required (Cash + In-Kind + Total)
 *
 *   Schedules:
 *     1. Debt Movement per facility
 *     2. Combined Debt Service
 *     3. Finance Cost per facility
 *     4. IDC Summary
 *     5. Equity Movement
 *
 * Method 2 + 3 rows render blank pending M2 Revenue + M4 FS. Schema
 * v8 (module1-types.ts) preserved verbatim, all deprecated fields
 * retained for snapshot back-compat.
 */

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import {
  type FinancingTranche,
  type ProjectFinancingConfig,
  type FundingMethodId,
  type ParcelFundingConfig,
  FUNDING_METHOD_IDS,
  FUNDING_METHOD_LABELS,
  FUNDING_METHOD_DESCRIPTIONS,
  DEFAULT_PROJECT_FINANCING_CONFIG,
  REPAYMENT_METHODS_USER,
  REPAYMENT_METHOD_LABELS,
  makeDefaultFinancingTranche,
} from '../../lib/state/module1-types';
import { computeFinancingResult } from '@/src/core/calculations/financing';
import { currencyHeaderLine, formatAccounting } from '@/src/core/formatters';
import { AccountingNumberInput } from '../ui/AccountingNumberInput';
import { PercentageInput } from '../ui/PercentageInput';
import { CELL_HEADER, CELL_HEADER_TOTAL, TABLE_TITLE, COLUMN_WIDTHS, nonLabelColumnPct, ROW_DATA, ROW_SUBTOTAL, ROW_GRAND_TOTAL } from './_shared/tableStyles';
import { buildResultsPeriodAxis } from './_shared/periodAxis';

const inputStyle: React.CSSProperties = {
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 6px',
  fontSize: 12,
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'Inter, sans-serif',
  fontWeight: 600,
};

const sectionStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: 'var(--sp-2)',
  marginBottom: 'var(--sp-2)',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 'var(--sp-1)',
  color: 'var(--color-heading)',
};

function ensureConfig(cfg: ProjectFinancingConfig | undefined): ProjectFinancingConfig {
  return cfg ?? { ...DEFAULT_PROJECT_FINANCING_CONFIG, parcelFunding: [] };
}

export default function Module1Financing(): React.JSX.Element {
  const [subTab, setSubTab] = useState<'inputs' | 'schedules'>('inputs');

  const {
    project, phases, parcels, assets, subUnits,
    costLines, costOverrides, financingTranches,
    equityContributions, landAllocationMode,
    setProject, setFinancingTranches, addFinancingTranche,
    updateFinancingTranche, removeFinancingTranche, updatePhase, updateAsset,
  } = useModule1Store(
    useShallow((s) => ({
      project:                s.project,
      phases:                 s.phases,
      parcels:                s.parcels,
      assets:                 s.assets,
      subUnits:               s.subUnits,
      costLines:              s.costLines,
      costOverrides:          s.costOverrides,
      financingTranches:      s.financingTranches,
      equityContributions:    s.equityContributions,
      landAllocationMode:     s.landAllocationMode,
      setProject:             s.setProject,
      setFinancingTranches:   s.setFinancingTranches,
      addFinancingTranche:    s.addFinancingTranche,
      updateFinancingTranche: s.updateFinancingTranche,
      removeFinancingTranche: s.removeFinancingTranche,
      updatePhase:            s.updatePhase,
      updateAsset:            s.updateAsset,
    })),
  );

  const financingConfig = useMemo(() => ensureConfig(project.financing), [project.financing]);
  const scale = project.displayScale ?? 'full';
  const decimals = project.displayDecimals ?? 0;
  const currency = project.currency || 'SAR';

  const result = useMemo(
    () => computeFinancingResult({
      project, phases, parcels, assets, subUnits,
      costLines, costOverrides,
      landAllocationMode,
      financingConfig,
      tranches:            financingTranches,
      equityContributions,
    }),
    [project, phases, parcels, assets, subUnits, costLines, costOverrides,
     landAllocationMode, financingConfig, financingTranches, equityContributions],
  );

  const setFinancingConfigPatch = (patch: Partial<ProjectFinancingConfig>) => {
    setProject({ financing: { ...financingConfig, ...patch } });
  };

  const setParcelFundingPatch = (parcelId: string, patch: Partial<ParcelFundingConfig>) => {
    const list = financingConfig.parcelFunding ?? [];
    const next = list.some((p) => p.parcelId === parcelId)
      ? list.map((p) => (p.parcelId === parcelId ? { ...p, ...patch } : p))
      : [...list, { parcelId, ...patch } as ParcelFundingConfig];
    setFinancingConfigPatch({ parcelFunding: next });
  };

  const axis = useMemo(() => {
    return buildResultsPeriodAxis({
      startIso: project.startDate,
      numAnnualPeriods: Math.max(1, result.axis.totalPeriods),
    });
  }, [project.startDate, result.axis.totalPeriods]);

  // Pass 24 (2026-05-14): year-domain helpers for the Repayment Start
  // Year picker + YoY editor calendar labels.
  const projectStartYear = useMemo(
    () => new Date(project.startDate).getUTCFullYear(),
    [project.startDate],
  );
  const operationsEndYear = projectStartYear + Math.max(0, result.axis.totalPeriods - 1);
  const defaultRepayStartYear = useMemo(() => {
    const maxCp = phases.reduce((m, p) => Math.max(m, p.constructionPeriods ?? 0), 0);
    return Math.min(operationsEndYear, projectStartYear + Math.max(1, maxCp));
  }, [phases, projectStartYear, operationsEndYear]);

  // Pass 41 (2026-05-14): baselineDebtFromPhases removed. Phase-level
  // currentDebtOutstanding was dropped from Tab 1 to make Existing
  // Facility -> Opening Balance the single source of truth for opening
  // debt.

  // No-prior-column convention (2026-05-14): arr[0] = first active
  // period (e.g., Dec 25 when startDate is 2025-01-01). UI uses
  // axis.activeLabels exclusively; axis.priorLabel/.labels are not
  // rendered by Tab 4.
  const cropProject = (arr: number[]): number[] => {
    const out = new Array<number>(axis.activeLabels.length).fill(0);
    for (let i = 0; i < axis.activeLabels.length; i++) out[i] = arr[i] ?? 0;
    return out;
  };

  const fmt = (n: number) => formatAccounting(n, scale, decimals);

  const matchOk = Math.abs(
    (financingConfig.fixedRatio?.debtPct ?? 0) + (financingConfig.fixedRatio?.equityPct ?? 0) - 100,
  ) < 0.01;

  return (
    <div style={{ padding: 'var(--sp-2)' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--sp-2)' }}>
        {(['inputs', 'schedules'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setSubTab(k)}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              background: subTab === k ? 'var(--color-navy)' : 'var(--color-surface)',
              color: subTab === k ? 'var(--color-on-primary-navy)' : 'var(--color-heading)',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {k}
          </button>
        ))}
      </div>

      {subTab === 'inputs' && (
        <>
          {/* Pass 33 (2026-05-14): KPI tiles at top of Financing inputs.
              Total Funding (= debt + equity sized), Debt, Equity, IDC,
              Finance Cost (cumulative cash interest expensed). Quick
              read on the project's overall capital stack and lifetime
              interest cost without diving into the schedules. */}
          {(() => {
            const totalDebt = result.debtEquitySplit.debt.reduce((s, v) => s + v, 0);
            const totalEquity = result.debtEquitySplit.equity.reduce((s, v) => s + v, 0);
            const totalFunding = totalDebt + totalEquity;
            // Pass 33b (2026-05-14): label clarification - IDC is the
            // interest capitalized DURING CONSTRUCTION (rolled into
            // loan principal), Operating Finance Cost is the cash
            // interest paid AFTER construction (P&L expense). Calling
            // them out explicitly so they don't read as net values.
            const totalIdc = result.combined.totalInterestCapitalized.reduce((s, v) => s + v, 0);
            // Pass 37 (2026-05-14): split Finance Cost (Operating) into
            // Existing vs New cards. Existing facility interest is on
            // pre-existing debt, new facility interest is on debt raised
            // for this project, conflating them hides materiality.
            let financeCostExisting = 0;
            let financeCostNew = 0;
            for (const t of financingTranches) {
              const fr = result.facilities.get(t.id);
              if (!fr) continue;
              const sum = fr.interestPaid.reduce((s, v) => s + v, 0);
              if (t.origin === 'existing') financeCostExisting += sum;
              else financeCostNew += sum;
            }
            // Pass 41 (2026-05-14): only show Finance Cost (Existing)
            // when there's actual activity on an existing facility -
            // either an opening balance > 0 or interest already paid.
            // An empty stub existing tranche should not add a "-" tile.
            const hasExisting = financingTranches.some(
              (t) => t.origin === 'existing' && ((t.openingBalance ?? 0) > 0 || financeCostExisting > 0),
            );
            const tile = (label: string, sublabel: string, value: number, accent?: string): React.JSX.Element => (
              <div
                key={label}
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--sp-1) var(--sp-2)',
                  borderLeft: `3px solid ${accent ?? 'var(--color-navy)'}`,
                }}
              >
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-heading)' }}>{fmt(value)}</div>
                <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: 2, fontStyle: 'italic' }}>{sublabel}</div>
              </div>
            );
            const cols = hasExisting ? 6 : 5;
            return (
              <section style={{ ...sectionStyle, padding: 'var(--sp-1) var(--sp-2)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>
                  {tile('Total Funding', 'Debt + Equity', totalFunding, 'var(--color-navy)')}
                  {tile('Total Debt', 'Capex + IDC funded', totalDebt, 'var(--color-warning, #92400e)')}
                  {tile('Total Equity', 'Cash + In-kind', totalEquity, 'var(--color-success, #166534)')}
                  {tile('IDC (Construction)', 'Interest capitalized', totalIdc, 'var(--color-meta, #6b7280)')}
                  {tile('Finance Cost (New)', 'New facility interest paid', financeCostNew, 'var(--color-danger, #b91c1c)')}
                  {hasExisting && tile('Finance Cost (Existing)', 'Existing facility interest paid', financeCostExisting, 'var(--color-warning, #92400e)')}
                </div>
              </section>
            );
          })()}

          <section style={sectionStyle}>
            <div style={sectionTitle}>1. Project Financing Settings</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Minimum Cash Reserve</label>
              <div style={{ width: 180 }}>
                <AccountingNumberInput
                  value={financingConfig.minimumCashReserve ?? 0}
                  onChange={(v) => setFinancingConfigPatch({ minimumCashReserve: v })}
                  style={inputStyle}
                />
              </div>
            </div>
          </section>

          {/* Pass 44 (2026-05-14): Existing Operations Summary card.
              Pass 48 (2026-05-14): per-asset Pre-Capex / Existing Debt /
              Existing Equity now EDITABLE here (moved from Tab 1) - this
              is the sole entry point. Tab 1 Historical Baseline block
              fully removed. Per-operational-phase opening BS row +
              Existing Retained Earnings still here, single source of
              truth. Renders only when at least one operational phase
              exists. */}
          {(() => {
            const opPhases = phases.filter((ph) => ph.status === 'operational');
            if (opPhases.length === 0) return null;
            const opAssets = assets.filter((a) => opPhases.some((p) => p.id === a.phaseId));
            const totalPreCapex = opAssets.reduce((s, a) => s + Math.max(0, a.historicalPreCapex ?? 0), 0);
            const totalAssetDebt = opAssets.reduce((s, a) => s + Math.max(0, a.historicalDebtAmount ?? 0), 0);
            const totalAssetEquity = opAssets.reduce((s, a) => s + Math.max(0, a.historicalEquityAmount ?? 0), 0);
            const totalExistingFacilityDebt = financingTranches
              .filter((t) => t.origin === 'existing')
              .reduce((s, t) => s + Math.max(0, t.openingBalance ?? 0), 0);
            const totalCumDep = opPhases.reduce((s, p) => s + Math.max(0, p.historicalBaseline?.cumulativeDepreciationCharged ?? 0), 0);
            const totalNbv = opPhases.reduce((s, p) => s + Math.max(0, p.historicalBaseline?.netBookValueFixedAssets ?? 0), 0);
            const totalRetEarn = opPhases.reduce((s, p) => s + Math.max(0, p.historicalBaseline?.existingRetainedEarnings ?? 0), 0);

            const debtMatch = Math.abs(totalAssetDebt - totalExistingFacilityDebt) < 1;
            const balancesOk = Math.abs(totalPreCapex - (totalAssetDebt + totalAssetEquity)) < 1;

            return (
              <section style={sectionStyle}>
                <div style={sectionTitle}>1b. Existing Operations</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 'var(--sp-2)' }}>
                  All inputs for assets that already exist at project Y0. Sole entry point - Tab 1 no longer carries these fields.
                </div>

                {/* Per-asset baseline rows (editable) */}
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--sp-1)' }}>
                  Per-asset Historical Baseline
                </div>
                <div style={{ display: 'grid', gap: 'var(--sp-1)', marginBottom: 'var(--sp-2)' }}>
                  {opAssets.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic', padding: 'var(--sp-1)' }}>
                      No assets in operational phases yet. Add assets on Tab 2 to capture their historical Pre-Capex / Debt / Equity here.
                    </div>
                  )}
                  {opAssets.map((a) => {
                    const pre = Math.max(0, a.historicalPreCapex ?? 0);
                    const dbt = Math.max(0, a.historicalDebtAmount ?? 0);
                    const eq  = Math.max(0, a.historicalEquityAmount ?? 0);
                    const diff = pre - (dbt + eq);
                    const balances = Math.abs(diff) < 1;
                    const equityNeeded = Math.max(0, pre - dbt);
                    return (
                      <div
                        key={a.id}
                        data-testid={`asset-${a.id}-baseline-tab4`}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1.3fr',
                          gap: 8,
                          alignItems: 'end',
                          padding: 'var(--sp-1)',
                          background: 'var(--color-surface)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 11,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Asset</div>
                          <div style={{ fontWeight: 700, color: 'var(--color-heading)' }}>{a.name}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Pre-Capex</div>
                          <AccountingNumberInput
                            value={pre}
                            onChange={(v) => updateAsset(a.id, { historicalPreCapex: Math.max(0, v) })}
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Existing Debt</div>
                          <AccountingNumberInput
                            value={dbt}
                            onChange={(v) => updateAsset(a.id, { historicalDebtAmount: Math.max(0, v) })}
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Existing Equity</div>
                          <AccountingNumberInput
                            value={eq}
                            onChange={(v) => updateAsset(a.id, { historicalEquityAmount: Math.max(0, v) })}
                            style={inputStyle}
                          />
                        </div>
                        <div
                          title={
                            balances
                              ? `Pre-Capex ${fmt(pre)} = Debt ${fmt(dbt)} + Equity ${fmt(eq)}.`
                              : `Pre-Capex ${fmt(pre)} should equal Debt ${fmt(dbt)} + Equity ${fmt(eq)}. Equity should be ${fmt(equityNeeded)} to balance.`
                          }
                          style={{
                            padding: '4px 8px',
                            borderRadius: 'var(--radius-sm)',
                            fontWeight: 700,
                            textAlign: 'center',
                            background: balances
                              ? 'color-mix(in srgb, var(--color-success, #166534) 16%, transparent)'
                              : 'color-mix(in srgb, var(--color-warning, #92400e) 16%, transparent)',
                            color: balances ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)',
                          }}
                        >
                          {balances ? 'Balances' : `Off by ${fmt(Math.abs(diff))}`}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Project-wide totals + facility cross-check */}
                {opAssets.length > 0 && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 'var(--sp-1)' }}>
                      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--sp-1) var(--sp-2)', borderLeft: '3px solid var(--color-navy)' }}>
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Total Pre-Capex</div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-heading)' }}>{fmt(totalPreCapex)}</div>
                      </div>
                      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--sp-1) var(--sp-2)', borderLeft: '3px solid var(--color-warning, #92400e)' }}>
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Total Existing Debt (assets)</div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-heading)' }}>{fmt(totalAssetDebt)}</div>
                      </div>
                      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--sp-1) var(--sp-2)', borderLeft: `3px solid ${debtMatch ? 'var(--color-success, #166534)' : 'var(--color-danger, #b91c1c)'}` }}>
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Existing Debt (facility)</div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-heading)' }}>{fmt(totalExistingFacilityDebt)}</div>
                        <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: 2, fontStyle: 'italic' }}>{debtMatch ? 'matches assets' : 'mismatch vs assets'}</div>
                      </div>
                      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--sp-1) var(--sp-2)', borderLeft: '3px solid var(--color-success, #166534)' }}>
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Total Existing Equity (assets)</div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-heading)' }}>{fmt(totalAssetEquity)}</div>
                      </div>
                    </div>
                    {!balancesOk && (
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-danger, #b91c1c)', background: 'color-mix(in srgb, var(--color-danger, #b91c1c) 10%, transparent)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--sp-1)' }}>
                        Pre-Capex {fmt(totalPreCapex)} != Debt {fmt(totalAssetDebt)} + Equity {fmt(totalAssetEquity)}. Per-asset balances do not reconcile.
                      </div>
                    )}
                  </>
                )}

                {/* Editable opening BS items per operational phase */}
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 'var(--sp-2)', marginBottom: 'var(--sp-1)' }}>
                  Opening Balance Sheet (per operational phase)
                </div>
                <div style={{ display: 'grid', gap: 'var(--sp-1)' }}>
                  {opPhases.map((ph) => {
                    const b = ph.historicalBaseline;
                    return (
                      <div
                        key={ph.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr 1fr 1fr',
                          gap: 8,
                          alignItems: 'end',
                          padding: 'var(--sp-1)',
                          background: 'var(--color-surface)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-sm)',
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-heading)' }}>
                          {ph.name}
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Cumulative Depreciation</div>
                          <AccountingNumberInput
                            value={b?.cumulativeDepreciationCharged ?? 0}
                            onChange={(v) => updatePhase(ph.id, {
                              historicalBaseline: {
                                ...(b ?? {
                                  historicalCapexTotal: 0,
                                  historicalEquityContributed: 0,
                                  historicalDebtDrawn: 0,
                                  currentDebtOutstanding: 0,
                                  cumulativeDepreciationCharged: 0,
                                  netBookValueFixedAssets: 0,
                                  last12MonthsRevenue: 0,
                                  last12MonthsOpex: 0,
                                }),
                                cumulativeDepreciationCharged: Math.max(0, v),
                              },
                            })}
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Net Book Value (Fixed Assets)</div>
                          <AccountingNumberInput
                            value={b?.netBookValueFixedAssets ?? 0}
                            onChange={(v) => updatePhase(ph.id, {
                              historicalBaseline: {
                                ...(b ?? {
                                  historicalCapexTotal: 0,
                                  historicalEquityContributed: 0,
                                  historicalDebtDrawn: 0,
                                  currentDebtOutstanding: 0,
                                  cumulativeDepreciationCharged: 0,
                                  netBookValueFixedAssets: 0,
                                  last12MonthsRevenue: 0,
                                  last12MonthsOpex: 0,
                                }),
                                netBookValueFixedAssets: Math.max(0, v),
                              },
                            })}
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Existing Retained Earnings</div>
                          <AccountingNumberInput
                            value={b?.existingRetainedEarnings ?? 0}
                            onChange={(v) => updatePhase(ph.id, {
                              historicalBaseline: {
                                ...(b ?? {
                                  historicalCapexTotal: 0,
                                  historicalEquityContributed: 0,
                                  historicalDebtDrawn: 0,
                                  currentDebtOutstanding: 0,
                                  cumulativeDepreciationCharged: 0,
                                  netBookValueFixedAssets: 0,
                                  last12MonthsRevenue: 0,
                                  last12MonthsOpex: 0,
                                }),
                                existingRetainedEarnings: Math.max(0, v),
                              },
                            })}
                            style={inputStyle}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {opPhases.length > 1 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 'var(--sp-1)', fontSize: 11, color: 'var(--color-text-muted)' }}>
                    <div>Total Cumulative Depreciation: <strong style={{ color: 'var(--color-heading)' }}>{fmt(totalCumDep)}</strong></div>
                    <div>Total NBV: <strong style={{ color: 'var(--color-heading)' }}>{fmt(totalNbv)}</strong></div>
                    <div>Total Retained Earnings: <strong style={{ color: 'var(--color-heading)' }}>{fmt(totalRetEarn)}</strong></div>
                  </div>
                )}
              </section>
            );
          })()}

          <section style={sectionStyle}>
            <div style={sectionTitle}>2. Funding Method</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {FUNDING_METHOD_IDS.map((id) => {
                const selected = financingConfig.fundingMethod === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFinancingConfigPatch({ fundingMethod: id })}
                    style={{
                      padding: 'var(--sp-2)',
                      borderRadius: 'var(--radius-sm)',
                      border: selected ? '2px solid var(--color-navy)' : '1px solid var(--color-border)',
                      background: selected ? 'var(--color-navy-pale)' : 'var(--color-surface)',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
                      Method {id}, {FUNDING_METHOD_LABELS[id]}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                      {FUNDING_METHOD_DESCRIPTIONS[id]}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {financingConfig.fundingMethod === 1 && (
            <section style={sectionStyle}>
              <div style={sectionTitle}>2a. Method 1 Configuration</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, alignItems: 'end' }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Debt %</label>
                  <PercentageInput
                    value={financingConfig.fixedRatio?.debtPct ?? 70}
                    onChange={(v) => setFinancingConfigPatch({
                      fixedRatio: { debtPct: v, equityPct: Math.max(0, 100 - v) },
                    })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Equity %</label>
                  <PercentageInput
                    value={financingConfig.fixedRatio?.equityPct ?? 30}
                    onChange={(v) => setFinancingConfigPatch({
                      fixedRatio: { equityPct: v, debtPct: Math.max(0, 100 - v) },
                    })}
                    style={inputStyle}
                  />
                </div>
                <div
                  style={{
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: matchOk ? 'color-mix(in srgb, var(--color-success, #166534) 14%, transparent)' : 'color-mix(in srgb, var(--color-warning, #92400e) 14%, transparent)',
                    color: matchOk ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)',
                    border: `1px solid ${matchOk ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)'}`,
                    fontSize: 11,
                    fontWeight: 700,
                    textAlign: 'center',
                  }}
                >
                  {matchOk ? 'Match: 100%' : `Match: ${(((financingConfig.fixedRatio?.debtPct ?? 0) + (financingConfig.fixedRatio?.equityPct ?? 0))).toFixed(2)}%`}
                </div>
              </div>
            </section>
          )}

          {financingConfig.fundingMethod === 4 && (
            <section style={sectionStyle}>
              <div style={sectionTitle}>2a. Method 4 Configuration</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Total Debt Amount</label>
                  <AccountingNumberInput
                    value={financingConfig.fixedAmountConfig?.debtAmount ?? 0}
                    onChange={(v) => setFinancingConfigPatch({
                      fixedAmountConfig: {
                        debtAmount: Math.max(0, v),
                        equityAmount: financingConfig.fixedAmountConfig?.equityAmount ?? 0,
                        yoySchedule: financingConfig.fixedAmountConfig?.yoySchedule ?? [],
                      },
                    })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Total Equity Amount</label>
                  <AccountingNumberInput
                    value={financingConfig.fixedAmountConfig?.equityAmount ?? 0}
                    onChange={(v) => setFinancingConfigPatch({
                      fixedAmountConfig: {
                        debtAmount: financingConfig.fixedAmountConfig?.debtAmount ?? 0,
                        equityAmount: Math.max(0, v),
                        yoySchedule: financingConfig.fixedAmountConfig?.yoySchedule ?? [],
                      },
                    })}
                    style={inputStyle}
                  />
                </div>
              </div>
              <div style={{ marginTop: 'var(--sp-1)' }}>
                <YoYScheduleEditor
                  schedule={financingConfig.fixedAmountConfig?.yoySchedule ?? []}
                  startYear={projectStartYear}
                  endYear={operationsEndYear}
                  onChange={(arr) => setFinancingConfigPatch({
                    fixedAmountConfig: {
                      debtAmount: financingConfig.fixedAmountConfig?.debtAmount ?? 0,
                      equityAmount: financingConfig.fixedAmountConfig?.equityAmount ?? 0,
                      yoySchedule: arr,
                    },
                  })}
                />
              </div>
            </section>
          )}

          {(() => {
            const totalCapex = result.capex.totals.exclLandInKind;
            // Pass 26 (2026-05-14): include Min Cash Reserve in the
            // Sources vs Uses identity since debt + equity now size
            // for capex + min-cash buffer together.
            const fundingNeed = result.funding.selectedWithMinCash;
            const drawdownBasis = FUNDING_METHOD_DESCRIPTIONS[financingConfig.fundingMethod];
            const totalDebt   = result.debtEquitySplit.debt.reduce((s, v) => s + v, 0);
            const totalEquity = result.debtEquitySplit.equity.reduce((s, v) => s + v, 0);
            const sources = totalDebt + totalEquity;
            const usesTarget = totalCapex + (result.funding.minCashReserve ?? 0);
            const sourcesUsesOk = Math.abs(sources - usesTarget) < 1;
            return (
              <section style={sectionStyle}>
                <div style={sectionTitle}>3. Funding Basis</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 'var(--sp-1)' }}>
                  <strong style={{ color: 'var(--color-heading)' }}>Drawdown Basis:</strong> {drawdownBasis}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, alignItems: 'end' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Total Capex (excl Land In-Kind)</div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{fmt(totalCapex)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Total Funding Need</div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{fmt(fundingNeed)}</div>
                  </div>
                  <div
                    style={{
                      padding: '6px 10px',
                      borderRadius: 'var(--radius-sm)',
                      background: sourcesUsesOk ? 'color-mix(in srgb, var(--color-success, #166534) 14%, transparent)' : 'color-mix(in srgb, var(--color-warning, #92400e) 14%, transparent)',
                      color: sourcesUsesOk ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)',
                      border: `1px solid ${sourcesUsesOk ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)'}`,
                      fontSize: 11,
                      fontWeight: 700,
                      textAlign: 'center',
                    }}
                  >
                    {sourcesUsesOk
                      ? `Sources vs Uses: Match (${fmt(sources)})`
                      : `Sources vs Uses: Gap ${fmt(sources - usesTarget)}`}
                  </div>
                </div>
              </section>
            );
          })()}

          <section style={sectionStyle}>
            <div style={sectionTitle}>4. Land Funding (per parcel, project-wide)</div>
            {parcels.length === 0 && (
              <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>No parcels defined yet.</div>
            )}
            {parcels.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '30%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '15%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={CELL_HEADER}>Parcel</th>
                    <th style={CELL_HEADER}>Cash Value</th>
                    <th style={CELL_HEADER}>In-Kind Value</th>
                    <th style={CELL_HEADER}>Debt %</th>
                    <th style={CELL_HEADER}>Equity %</th>
                  </tr>
                </thead>
                <tbody>
                  {parcels.map((p) => {
                    const cfg = (financingConfig.parcelFunding ?? []).find((x) => x.parcelId === p.id);
                    const cashPct = Math.max(0, Math.min(100, p.cashPct ?? 0));
                    const cashValue = p.area * p.rate * (cashPct / 100);
                    const inKindValue = p.area * p.rate * (1 - cashPct / 100);
                    const debtPct = cfg?.debtPct ?? 0;
                    const equityPct = cfg?.equityPct ?? (100 - debtPct);
                    return (
                      <tr key={p.id}>
                        <td style={ROW_DATA.name}>{p.name}</td>
                        <td style={ROW_DATA.num}>{fmt(cashValue)}</td>
                        <td style={ROW_DATA.num}>{fmt(inKindValue)}</td>
                        <td style={ROW_DATA.num}>
                          <PercentageInput
                            value={debtPct}
                            style={{ ...inputStyle, padding: '3px 4px', fontSize: 11, textAlign: 'right' }}
                            onChange={(v) => setParcelFundingPatch(p.id, { debtPct: v, equityPct: Math.max(0, 100 - v) })}
                          />
                        </td>
                        <td style={ROW_DATA.num}>
                          <PercentageInput
                            value={equityPct}
                            style={{ ...inputStyle, padding: '3px 4px', fontSize: 11, textAlign: 'right' }}
                            onChange={(v) => setParcelFundingPatch(p.id, { equityPct: v, debtPct: Math.max(0, 100 - v) })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <FacilitiesSection
            tranches={financingTranches}
            shares={result.shares}
            projectStartYear={projectStartYear}
            operationsEndYear={operationsEndYear}
            defaultRepayStartYear={defaultRepayStartYear}
            onAdd={() => {
              const id = `fin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
              const newT = makeDefaultFinancingTranche(id, phases[0]?.id ?? '');
              newT.repaymentStartYear = defaultRepayStartYear;
              addFinancingTranche(newT);
            }}
            onAddExisting={() => {
              const id = `fin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
              const exT = makeDefaultFinancingTranche(id, phases[0]?.id ?? '');
              exT.origin = 'existing';
              exT.name = 'Existing facility';
              // Pass 41 (2026-05-14): no prefill - opening balance is
              // entered directly on this form, single source of truth.
              exT.openingBalance = 0;
              exT.originationYear = projectStartYear - 1; // pre-project default
              exT.interestStartYear = projectStartYear;
              exT.repaymentStartYear = projectStartYear;
              exT.remainingRepaymentPeriods = 0;
              addFinancingTranche(exT);
            }}
            onUpdate={updateFinancingTranche}
            onRemove={removeFinancingTranche}
            onSet={setFinancingTranches}
          />

          <CapexBreakdownTable
            axis={axis}
            currency={currency}
            fmt={fmt}
            cropProject={cropProject}
            capex={result.capex}
            existingPreCapex={result.existing.preCapexTotal}
          />

          <FundingRequirementTable
            funding={result.funding}
            capex={result.capex}
            currency={currency}
            scale={scale}
            decimals={decimals}
            fmt={fmt}
            axis={axis}
            cropProject={cropProject}
          />

          <DebtRequiredTable
            funding={result.funding}
            facilities={result.facilities}
            tranches={financingTranches}
            shares={result.shares}
            split={result.debtEquitySplit}
            combined={result.combined}
            fmt={fmt}
            currency={currency}
            scale={scale}
            axis={axis}
            cropProject={cropProject}
          />

          <EquityRequiredTable
            equity={result.equity}
            split={result.debtEquitySplit}
            fmt={fmt}
            currency={currency}
            scale={scale}
            axis={axis}
            cropProject={cropProject}
          />

          {!result.reconciliation.ok && (
            <section style={{ ...sectionStyle, borderColor: 'var(--color-danger, #b91c1c)' }}>
              <div style={{ ...sectionTitle, color: 'var(--color-danger, #b91c1c)' }}>
                Reconciliation Warnings ({result.reconciliation.issues.length})
              </div>
              <ul style={{ fontSize: 11, paddingLeft: 18, margin: 0 }}>
                {result.reconciliation.issues.slice(0, 8).map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </section>
          )}
        </>
      )}

      {subTab === 'schedules' && (
        <SchedulesView
          result={result}
          tranches={financingTranches}
          axis={axis}
          fmt={fmt}
          currency={currency}
          cropProject={cropProject}
        />
      )}
    </div>
  );
}

// ── Facilities section ────────────────────────────────────────────────────

interface FacilitiesSectionProps {
  tranches: FinancingTranche[];
  shares: Map<string, number>;
  projectStartYear: number;
  operationsEndYear: number;
  defaultRepayStartYear: number;
  onAdd: () => void;
  onAddExisting: () => void;
  onUpdate: (id: string, patch: Partial<FinancingTranche>) => void;
  onRemove: (id: string) => void;
  onSet: (tranches: FinancingTranche[]) => void;
}

function FacilitiesSection(props: FacilitiesSectionProps): React.JSX.Element {
  const {
    tranches, shares,
    projectStartYear, operationsEndYear, defaultRepayStartYear,
    onAdd, onAddExisting, onUpdate, onRemove, onSet,
  } = props;
  const handleShareChange = (id: string, raw: number) => {
    const next = tranches.map((t) => (t.id === id ? { ...t, facilitySharePct: raw } : t));
    onSet(next);
  };
  const buttonStyle: React.CSSProperties = {
    padding: '4px 12px',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
  };
  return (
    <section style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={sectionTitle}>5. Debt Facilities</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {/* Pass 33 (2026-05-14): explicit button for adding an
              existing facility so users don't have to add a New
              tranche then toggle Origin radio. */}
          <button
            type="button"
            onClick={onAddExisting}
            style={{
              ...buttonStyle,
              background: 'var(--color-warning, #92400e)',
              color: 'var(--color-on-primary-navy)',
            }}
          >
            + Add Existing Facility
          </button>
          <button
            type="button"
            onClick={onAdd}
            style={{
              ...buttonStyle,
              background: 'var(--color-navy)',
              color: 'var(--color-on-primary-navy)',
            }}
          >
            + Add New Facility
          </button>
        </div>
      </div>
      {tranches.length === 0 && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 8 }}>
          No facilities yet. Add one to begin.
        </div>
      )}
      {tranches.map((t) => (
        <TrancheCard
          key={t.id}
          tranche={t}
          normalisedShare={shares.get(t.id) ?? 0}
          showShareField={tranches.filter((x) => x.origin !== 'existing').length > 1}
          projectStartYear={projectStartYear}
          operationsEndYear={operationsEndYear}
          defaultRepayStartYear={defaultRepayStartYear}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onShareChange={(v) => handleShareChange(t.id, v)}
        />
      ))}
    </section>
  );
}

// ── TrancheCard ─────────────────────────────────────────────────────────

interface TrancheCardProps {
  tranche: FinancingTranche;
  normalisedShare: number;
  showShareField: boolean;
  projectStartYear: number;
  operationsEndYear: number;
  defaultRepayStartYear: number;
  onUpdate: (id: string, patch: Partial<FinancingTranche>) => void;
  onRemove: (id: string) => void;
  onShareChange: (v: number) => void;
}

function TrancheCard(p: TrancheCardProps): React.JSX.Element {
  const {
    tranche: t,
    normalisedShare, showShareField,
    projectStartYear, operationsEndYear, defaultRepayStartYear,
    onUpdate, onRemove, onShareChange,
  } = p;
  const isExisting = t.origin === 'existing';

  // Pass 27 (2026-05-14): effective Interest Rate = Interbank + Credit
  // Spread, computed live and surfaced in a read-only field. Legacy
  // snapshots without the components fall back to interestRatePct
  // displayed as the legacy single value (still editable via the
  // component fields below).
  const interbankPct = t.interbankRatePct ?? 0;
  const creditSpreadPct = t.creditSpreadPct ?? 0;
  const hasComponents = t.interbankRatePct !== undefined || t.creditSpreadPct !== undefined;
  const effectiveRatePct = hasComponents ? interbankPct + creditSpreadPct : (t.interestRatePct ?? 0);

  const FieldLabel = ({ children }: { children: React.ReactNode }) => (
    <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4, color: 'var(--color-heading)' }}>
      {children}
    </label>
  );

  return (
    <div
      style={{
        border: isExisting ? '1px solid var(--color-warning, #92400e)' : '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--sp-2)',
        marginTop: 'var(--sp-1)',
        background: isExisting ? 'color-mix(in srgb, var(--color-warning, #92400e) 6%, transparent)' : undefined,
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr auto', gap: 8, alignItems: 'end' }}>
        <div>
          <FieldLabel>Name</FieldLabel>
          <input type="text" value={t.name} onChange={(e) => onUpdate(t.id, { name: e.target.value })} style={inputStyle} />
        </div>
        <div>
          <FieldLabel>Lender</FieldLabel>
          <input type="text" value={t.lender ?? ''} onChange={(e) => onUpdate(t.id, { lender: e.target.value })} style={inputStyle} placeholder="Bank / institution name" />
        </div>
        <button
          type="button"
          onClick={() => onRemove(t.id)}
          style={{
            padding: '4px 10px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-danger, #b91c1c)',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            height: 28,
          }}
        >
          Remove
        </button>
      </div>

      <div style={{ marginTop: 'var(--sp-1)', display: 'flex', gap: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-heading)' }}>Facility Origination:</span>
        {(['new', 'existing'] as const).map((o) => (
          <label key={o} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name={`origin-${t.id}`}
              checked={(t.origin ?? 'new') === o}
              onChange={() => onUpdate(t.id, { origin: o })}
            />
            {o === 'new' ? 'New' : 'Existing'}
          </label>
        ))}
      </div>

      {/* Pass 41 (2026-05-14): existing facility row. Opening Balance
          entered directly on this form (sole entry point per Pass 41).
          Origination Year: if >= projectStartYear, the balance draws as
          cash inflow that period; otherwise the pre-project balance
          carries at Y0. Interest Start Year gates accrual. Remaining
          Tenor field removed - the engine derives runway from
          repaymentStartYear + Repayment Periods directly. The
          method/start-year/periods row below is shared with new debt. */}
      {isExisting && (
        <div style={{ marginTop: 'var(--sp-1)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <div>
            <FieldLabel>Opening Balance</FieldLabel>
            <AccountingNumberInput value={t.openingBalance ?? 0} onChange={(v) => onUpdate(t.id, { openingBalance: Math.max(0, v) })} style={inputStyle} />
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
              Outstanding loan balance at project Y0 (sole entry point).
            </div>
          </div>
          <div>
            <FieldLabel>Origination Year</FieldLabel>
            <input
              type="number"
              value={t.originationYear ?? (projectStartYear - 1)}
              onChange={(e) => {
                const yr = Number(e.target.value);
                if (!Number.isFinite(yr)) return;
                onUpdate(t.id, { originationYear: Math.floor(yr) });
              }}
              style={inputStyle}
            />
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {(t.originationYear ?? (projectStartYear - 1)) >= projectStartYear
                ? 'Draws as cash inflow that year'
                : 'Pre-project balance carries at Y0'}
            </div>
          </div>
          <div>
            <FieldLabel>Interest Start Year</FieldLabel>
            <input
              type="number"
              min={projectStartYear}
              max={operationsEndYear}
              value={t.interestStartYear ?? projectStartYear}
              onChange={(e) => {
                const yr = Number(e.target.value);
                if (!Number.isFinite(yr)) return;
                const clamped = Math.max(projectStartYear, Math.min(operationsEndYear, Math.floor(yr)));
                onUpdate(t.id, { interestStartYear: clamped });
              }}
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {/* Pass 29 (2026-05-14): rate + fee fields collapse into a single
          5-column row for compact entry. */}
      <div style={{ marginTop: 'var(--sp-1)', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        <div>
          <FieldLabel>Interbank Rate %</FieldLabel>
          <PercentageInput
            value={interbankPct}
            onChange={(v) => onUpdate(t.id, {
              interbankRatePct: v,
              interestRatePct: v + creditSpreadPct,
            })}
            style={inputStyle}
          />
        </div>
        <div>
          <FieldLabel>Credit Spread %</FieldLabel>
          <PercentageInput
            value={creditSpreadPct}
            onChange={(v) => onUpdate(t.id, {
              creditSpreadPct: v,
              interestRatePct: interbankPct + v,
            })}
            style={inputStyle}
          />
        </div>
        <div>
          <FieldLabel>Interest Rate %</FieldLabel>
          <PercentageInput
            value={effectiveRatePct}
            onChange={() => { /* read-only: derived from Interbank + Credit Spread */ }}
            disabled
            style={{ ...inputStyle, background: 'var(--color-surface-muted, #f3f4f6)', color: 'var(--color-text-muted, #6b7280)' }}
          />
        </div>
        <div>
          <FieldLabel>Upfront Fee %</FieldLabel>
          <PercentageInput value={t.upfrontFeePct ?? 0} onChange={(v) => onUpdate(t.id, { upfrontFeePct: v })} style={inputStyle} />
        </div>
        <div>
          <FieldLabel>Commitment Fee %</FieldLabel>
          <PercentageInput value={t.commitmentFeePct ?? 0} onChange={(v) => onUpdate(t.id, { commitmentFeePct: v })} style={inputStyle} />
        </div>
      </div>

      {/* Pass 36 (2026-05-14): single shared repayment row for both
          new and existing tranches. Existing maps the Repayment
          Periods field to `remainingRepaymentPeriods` (legacy schema
          field) for back-compat; new uses `repaymentPeriods`. */}
      <div style={{ marginTop: 'var(--sp-1)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        <div>
          <FieldLabel>Repayment Method</FieldLabel>
          <select
            value={t.repaymentMethod}
            onChange={(e) => onUpdate(t.id, { repaymentMethod: e.target.value as FinancingTranche['repaymentMethod'] })}
            style={inputStyle}
          >
            {REPAYMENT_METHODS_USER.map((m) => (
              <option key={m} value={m}>{REPAYMENT_METHOD_LABELS[m]}</option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel>Repayment Start Year</FieldLabel>
          <input
            type="number"
            min={projectStartYear}
            max={operationsEndYear}
            value={t.repaymentStartYear ?? (isExisting ? projectStartYear : defaultRepayStartYear)}
            onChange={(e) => {
              const yr = Number(e.target.value);
              if (!Number.isFinite(yr)) return;
              const clamped = Math.max(projectStartYear, Math.min(operationsEndYear, Math.floor(yr)));
              onUpdate(t.id, { repaymentStartYear: clamped });
            }}
            style={inputStyle}
          />
        </div>
        {t.repaymentMethod !== 'year_on_year_pct' ? (
          <div>
            <FieldLabel>Repayment Periods</FieldLabel>
            <input
              type="number"
              value={isExisting ? (t.remainingRepaymentPeriods ?? 0) : (t.repaymentPeriods ?? 0)}
              onChange={(e) => {
                const n = Math.max(0, Number(e.target.value) || 0);
                onUpdate(t.id, isExisting ? { remainingRepaymentPeriods: n } : { repaymentPeriods: n });
              }}
              style={inputStyle}
            />
          </div>
        ) : (
          <div />
        )}
        {showShareField && !isExisting ? (
          <div>
            <FieldLabel>Facility Share %</FieldLabel>
            <PercentageInput value={t.facilitySharePct ?? normalisedShare} onChange={onShareChange} style={inputStyle} />
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
              Normalised: {normalisedShare.toFixed(2)}%
            </div>
          </div>
        ) : <div />}
      </div>

      {t.repaymentMethod === 'year_on_year_pct' && (
        <YoYScheduleEditor
          schedule={t.yearOnYearPctSchedule ?? []}
          startYear={t.repaymentStartYear ?? (isExisting ? projectStartYear : defaultRepayStartYear)}
          endYear={isExisting
            ? Math.min(operationsEndYear, (t.repaymentStartYear ?? projectStartYear) + Math.max(0, (t.remainingRepaymentPeriods ?? 0) - 1))
            : operationsEndYear}
          onChange={(arr) => onUpdate(t.id, { yearOnYearPctSchedule: arr })}
        />
      )}

      {(t.repaymentMethod === 'cashsweep_from_period' || t.repaymentMethod === 'cashsweep_min_cash') && !isExisting && (
        <CashSweepEditor
          config={t.cashSweepConfig}
          onChange={(cfg) => onUpdate(t.id, { cashSweepConfig: cfg })}
        />
      )}
    </div>
  );
}

// ── YoY % schedule editor ──────────────────────────────────────────────

interface YoYScheduleEditorProps {
  schedule: number[];
  startYear: number;
  endYear: number;
  onChange: (arr: number[]) => void;
}

function YoYScheduleEditor(p: YoYScheduleEditorProps): React.JSX.Element {
  // Pass 24b (2026-05-14): cells span [startYear..endYear] (calendar
  // years from Repayment Start Year through Operations End). Labels
  // show the actual year. Each cell is a fixed 78px column with the
  // percent input forced to width:100% so it fills the cell instead
  // of overflowing into neighbouring columns. Container scrolls
  // horizontally when total width exceeds the panel.
  const n = Math.max(0, p.endYear - p.startYear + 1);
  const cells = new Array<number>(Math.max(1, n)).fill(0).map((_, i) => p.schedule[i] ?? 0);
  const sum = cells.reduce((s, v) => s + v, 0);
  const ok = Math.abs(sum - 100) < 0.01;
  const CELL_WIDTH = 78;
  const cellInputStyle: React.CSSProperties = {
    ...inputStyle,
    padding: '3px 4px',
    fontSize: 11,
    textAlign: 'right',
  };
  return (
    <div style={{ marginTop: 'var(--sp-1)', padding: 'var(--sp-1)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600 }}>
          Year-on-Year % Schedule ({p.startYear}-{p.endYear}, sum to 100)
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: ok ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)' }}>
          Sum: {sum.toFixed(2)}%
        </span>
      </div>
      {n === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          Set Repayment Start Year before editing the schedule.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
          <div style={{ display: 'inline-grid', gridTemplateColumns: `repeat(${cells.length}, ${CELL_WIDTH}px)`, gap: 4 }}>
            {cells.map((_, i) => (
              <div key={`hdr-${i}`} style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'center', padding: '2px 0' }}>
                {p.startYear + i}
              </div>
            ))}
            {cells.map((v, i) => (
              <div key={`cell-${i}`} style={{ width: CELL_WIDTH }}>
                <PercentageInput
                  value={v}
                  style={cellInputStyle}
                  onChange={(nv) => {
                    const next = [...cells];
                    next[i] = nv;
                    p.onChange(next);
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cash Sweep editor ──────────────────────────────────────────────────

interface CashSweepEditorProps {
  config: { startingYear: number; sweepRatio: number } | undefined;
  onChange: (cfg: { startingYear: number; sweepRatio: number }) => void;
}

function CashSweepEditor(p: CashSweepEditorProps): React.JSX.Element {
  const cfg = p.config ?? { startingYear: 1, sweepRatio: 75 };
  return (
    <div style={{ marginTop: 'var(--sp-1)', padding: 'var(--sp-1)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Starting Year</label>
        <input
          type="number"
          value={cfg.startingYear}
          onChange={(e) => p.onChange({ ...cfg, startingYear: Math.max(1, Number(e.target.value) || 1) })}
          style={inputStyle}
        />
      </div>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Sweep Ratio % (excess cash above min reserve)</label>
        <PercentageInput
          value={cfg.sweepRatio}
          onChange={(v) => p.onChange({ ...cfg, sweepRatio: v })}
          style={inputStyle}
        />
      </div>
    </div>
  );
}

// ── Capex Breakdown ─────────────────────────────────────────────────────

interface CapexProps {
  axis: ReturnType<typeof buildResultsPeriodAxis>;
  currency: string;
  fmt: (n: number) => string;
  cropProject: (arr: number[]) => number[];
  capex: ReturnType<typeof computeFinancingResult>['capex'];
  existingPreCapex: number;
}

function CapexBreakdownTable(p: CapexProps): React.JSX.Element {
  const N = p.axis.activeLabels.length;
  const nonLabelPct = nonLabelColumnPct(1 + N);
  const exclLand    = p.cropProject(p.capex.perPeriod.exclAllLand);
  const landCash    = p.cropProject(p.capex.perPeriod.landCash);
  const totalIncl   = p.cropProject(p.capex.perPeriod.exclLandInKind);
  return (
    <section style={sectionStyle}>
      <div style={TABLE_TITLE}>6. Capex Breakdown</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            {p.axis.activeLabels.map((_, i) => <col key={i} style={{ width: nonLabelPct }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Line ({currencyHeaderLine(p.currency, 'full')})</th>
              <th style={CELL_HEADER_TOTAL}>Total</th>
              {p.axis.activeLabels.map((l) => <th key={l} style={CELL_HEADER}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={ROW_DATA.name}>Capex (excluding Land)</td>
              <td style={ROW_DATA.numTotal}>{p.fmt(p.capex.totals.exclAllLand)}</td>
              {exclLand.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={ROW_DATA.name}>Land Cash Value</td>
              <td style={ROW_DATA.numTotal}>{p.fmt(p.capex.totals.exclLandInKind - p.capex.totals.exclAllLand)}</td>
              {landCash.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={ROW_GRAND_TOTAL.name}>Total Capex Incl Cash Land</td>
              <td style={ROW_GRAND_TOTAL.numTotal}>{p.fmt(p.capex.totals.exclLandInKind)}</td>
              {totalIncl.map((v, i) => <td key={i} style={ROW_GRAND_TOTAL.num}>{p.fmt(v)}</td>)}
            </tr>
            {p.existingPreCapex > 0 && (
              <tr>
                <td style={ROW_DATA.name}>Pre-Capex (existing operations)</td>
                <td style={ROW_DATA.numTotal}>{p.fmt(p.existingPreCapex)}</td>
                {p.axis.activeLabels.map((_, i) => (
                  <td key={i} style={ROW_DATA.num}>{p.fmt(i === 0 ? p.existingPreCapex : 0)}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Funding Requirement (per period) ───────────────────────────────────

interface FundingProps {
  funding: ReturnType<typeof computeFinancingResult>['funding'];
  capex: ReturnType<typeof computeFinancingResult>['capex'];
  currency: string;
  scale: 'full' | 'thousands' | 'millions';
  decimals: number;
  fmt: (n: number) => string;
  axis: ReturnType<typeof buildResultsPeriodAxis>;
  cropProject: (arr: number[]) => number[];
}

function FundingRequirementTable(p: FundingProps): React.JSX.Element {
  const N = p.axis.activeLabels.length;
  const nonLabelPct = nonLabelColumnPct(1 + N);
  const m1PerPeriod = p.cropProject(p.capex.perPeriod.exclLandInKind);
  const blanks = new Array<number>(N).fill(0);
  const selectedMethodId = p.funding.selectedMethodId;

  // Pass 26 (2026-05-14): Min Cash Reserve is added on top of Methods
  // 1 + 2; Method 3 (Cash Deficit) absorbs it implicitly. The lump
  // lands at the first non-zero capex period (engine-side).
  const selectedPerPeriod = p.cropProject(p.funding.selectedByPeriod);
  const minCashPerPeriod = p.cropProject(p.funding.minCashByPeriod);
  const totalFundingPerPeriod = p.cropProject(p.funding.totalFundingNeedByPeriod);
  const showMinCashRows = p.funding.minCashReserve > 0 && selectedMethodId !== 3;

  return (
    <section style={sectionStyle}>
      <div style={TABLE_TITLE}>7. Funding Requirement ({currencyHeaderLine(p.currency, p.scale)})</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            {p.axis.activeLabels.map((_, i) => <col key={i} style={{ width: nonLabelPct }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Method</th>
              <th style={CELL_HEADER_TOTAL}>Total</th>
              {p.axis.activeLabels.map((l) => <th key={l} style={CELL_HEADER}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={ROW_DATA.name}>Method 1, Fixed Debt-to-Equity Ratio</td>
              <td style={ROW_DATA.numTotal}>{p.fmt(p.funding.method1)}</td>
              {m1PerPeriod.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={{ ...ROW_DATA.name, color: 'var(--color-text-muted)' }}>Method 2, Net Funding Requirement</td>
              <td style={{ ...ROW_DATA.numTotal, color: 'var(--color-text-muted)' }}>-</td>
              {blanks.map((_, i) => <td key={i} style={{ ...ROW_DATA.num, color: 'var(--color-text-muted)' }}>-</td>)}
            </tr>
            <tr>
              <td style={{ ...ROW_DATA.name, color: 'var(--color-text-muted)' }}>Method 3, Cash Deficit Funding</td>
              <td style={{ ...ROW_DATA.numTotal, color: 'var(--color-text-muted)' }}>-</td>
              {blanks.map((_, i) => <td key={i} style={{ ...ROW_DATA.num, color: 'var(--color-text-muted)' }}>-</td>)}
            </tr>
            <tr>
              <td style={ROW_DATA.name}>Method 4, Specified Debt + Equity (manual)</td>
              <td style={ROW_DATA.numTotal}>{p.fmt(p.funding.method4)}</td>
              {(selectedMethodId === 4 ? selectedPerPeriod : blanks).map((v, i) => (
                <td key={i} style={ROW_DATA.num}>{selectedMethodId === 4 ? p.fmt(v) : '-'}</td>
              ))}
            </tr>
            <tr>
              <td style={ROW_SUBTOTAL.name}>Selected (Method {selectedMethodId})</td>
              <td style={ROW_SUBTOTAL.numTotal}>{p.fmt(p.funding.selected)}</td>
              {(selectedMethodId === 1 || selectedMethodId === 4 ? selectedPerPeriod : blanks).map((v, i) => (
                <td key={i} style={ROW_SUBTOTAL.num}>{selectedMethodId === 1 || selectedMethodId === 4 ? p.fmt(v) : '-'}</td>
              ))}
            </tr>
            {showMinCashRows && (
              <>
                <tr>
                  <td style={ROW_DATA.name}>+ Minimum Cash Reserve</td>
                  <td style={ROW_DATA.numTotal}>{p.fmt(p.funding.minCashReserve)}</td>
                  {minCashPerPeriod.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
                </tr>
                <tr>
                  <td style={ROW_GRAND_TOTAL.name}>Total Funding Need</td>
                  <td style={ROW_GRAND_TOTAL.numTotal}>{p.fmt(p.funding.selectedWithMinCash)}</td>
                  {totalFundingPerPeriod.map((v, i) => <td key={i} style={ROW_GRAND_TOTAL.num}>{p.fmt(v)}</td>)}
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 'var(--sp-1)' }}>
        Methods 2 and 3 land once Module 2 Revenue and Module 4 Financial Statements ship.
        {p.funding.minCashReserve > 0 && selectedMethodId === 3 && ' Method 3 absorbs the Minimum Cash Reserve implicitly via the deficit calc.'}
      </div>
    </section>
  );
}

// ── Total Debt Required (per period) ───────────────────────────────────

interface DebtReqProps {
  funding: ReturnType<typeof computeFinancingResult>['funding'];
  facilities: ReturnType<typeof computeFinancingResult>['facilities'];
  tranches: FinancingTranche[];
  shares: Map<string, number>;
  split: ReturnType<typeof computeFinancingResult>['debtEquitySplit'];
  combined: ReturnType<typeof computeFinancingResult>['combined'];
  fmt: (n: number) => string;
  currency: string;
  scale: 'full' | 'thousands' | 'millions';
  axis: ReturnType<typeof buildResultsPeriodAxis>;
  cropProject: (arr: number[]) => number[];
}

function DebtRequiredTable(p: DebtReqProps): React.JSX.Element {
  const N = p.axis.activeLabels.length;
  const nonLabelPct = nonLabelColumnPct(1 + N);
  const newTranches = p.tranches.filter((t) => t.origin !== 'existing');

  // Pass 25 (2026-05-14): per-facility rows show capex-driven drawdown
  // (the project-axis split allocated to this facility). IDC during
  // construction + grace-capitalize windows is funded by the same
  // facilities but tracked as `interestCapitalized`; we sum it across
  // new tranches to expose a separate IDC Drawdown line so the bank's
  // total advance = Capex Drawdown + IDC Drawdown.
  const totalCapexDrawByPeriod = p.cropProject(p.split.debt);
  const totalCapexDraw = totalCapexDrawByPeriod.reduce((s, v) => s + v, 0);
  const newIdcByPeriodFull = new Array<number>(p.split.debt.length).fill(0);
  for (const t of newTranches) {
    const r = p.facilities.get(t.id);
    if (!r) continue;
    for (let i = 0; i < newIdcByPeriodFull.length; i++) {
      newIdcByPeriodFull[i] += r.interestCapitalized[i] ?? 0;
    }
  }
  const idcDrawByPeriod = p.cropProject(newIdcByPeriodFull);
  const totalIdcDraw = idcDrawByPeriod.reduce((s, v) => s + v, 0);
  const totalDebtByPeriod = totalCapexDrawByPeriod.map((v, i) => v + (idcDrawByPeriod[i] ?? 0));
  const totalDebtRequired = totalCapexDraw + totalIdcDraw;

  return (
    <section style={sectionStyle}>
      <div style={TABLE_TITLE}>8. Total Debt Required ({currencyHeaderLine(p.currency, p.scale)})</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            {p.axis.activeLabels.map((_, i) => <col key={i} style={{ width: nonLabelPct }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Facility</th>
              <th style={CELL_HEADER_TOTAL}>Total</th>
              {p.axis.activeLabels.map((l) => <th key={l} style={CELL_HEADER}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {newTranches.map((t) => {
              const r = p.facilities.get(t.id);
              const series = p.cropProject(r?.drawSchedule ?? []);
              const total = series.reduce((s, v) => s + v, 0);
              return (
                <tr key={t.id}>
                  <td style={ROW_DATA.name}>{t.name}</td>
                  <td style={ROW_DATA.numTotal}>{p.fmt(total)}</td>
                  {series.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
                </tr>
              );
            })}
            <tr>
              <td style={ROW_SUBTOTAL.name}>Capex Drawdown Subtotal</td>
              <td style={ROW_SUBTOTAL.numTotal}>{p.fmt(totalCapexDraw)}</td>
              {totalCapexDrawByPeriod.map((v, i) => <td key={i} style={ROW_SUBTOTAL.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={ROW_DATA.name}>IDC Drawdown (capitalized interest)</td>
              <td style={ROW_DATA.numTotal}>{p.fmt(totalIdcDraw)}</td>
              {idcDrawByPeriod.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={ROW_GRAND_TOTAL.name}>Total Debt Required</td>
              <td style={ROW_GRAND_TOTAL.numTotal}>{p.fmt(totalDebtRequired)}</td>
              {totalDebtByPeriod.map((v, i) => <td key={i} style={ROW_GRAND_TOTAL.num}>{p.fmt(v)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Total Equity Required (per period) ────────────────────────────────

interface EquityReqProps {
  equity: ReturnType<typeof computeFinancingResult>['equity'];
  split: ReturnType<typeof computeFinancingResult>['debtEquitySplit'];
  fmt: (n: number) => string;
  currency: string;
  scale: 'full' | 'thousands' | 'millions';
  axis: ReturnType<typeof buildResultsPeriodAxis>;
  cropProject: (arr: number[]) => number[];
}

function EquityRequiredTable(p: EquityReqProps): React.JSX.Element {
  const N = p.axis.activeLabels.length;
  const nonLabelPct = nonLabelColumnPct(1 + N);
  const cash = p.cropProject(p.equity.cashPerPeriod);
  const inKind = p.cropProject(p.equity.inKindPerPeriod);
  const existing = p.cropProject(p.equity.existingEquityPerPeriod);
  const total = p.cropProject(p.equity.totalPerPeriod);
  return (
    <section style={sectionStyle}>
      <div style={TABLE_TITLE}>9. Total Equity Required ({currencyHeaderLine(p.currency, p.scale)})</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            {p.axis.activeLabels.map((_, i) => <col key={i} style={{ width: nonLabelPct }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Source</th>
              <th style={CELL_HEADER_TOTAL}>Total</th>
              {p.axis.activeLabels.map((l) => <th key={l} style={CELL_HEADER}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {p.equity.totalExisting > 0 && (
              <tr>
                <td style={ROW_DATA.name}>Existing Equity (operational phases)</td>
                <td style={ROW_DATA.numTotal}>{p.fmt(p.equity.totalExisting)}</td>
                {existing.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
              </tr>
            )}
            <tr>
              <td style={ROW_DATA.name}>Cash Equity</td>
              <td style={ROW_DATA.numTotal}>{p.fmt(p.equity.totalCash)}</td>
              {cash.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={ROW_DATA.name}>In-Kind Equity</td>
              <td style={ROW_DATA.numTotal}>{p.fmt(p.equity.totalInKind)}</td>
              {inKind.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={ROW_GRAND_TOTAL.name}>Total Equity Required</td>
              <td style={ROW_GRAND_TOTAL.numTotal}>{p.fmt(p.equity.grandTotal)}</td>
              {total.map((v, i) => <td key={i} style={ROW_GRAND_TOTAL.num}>{p.fmt(v)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Schedules sub-tab ───────────────────────────────────────────────────

interface SchedulesProps {
  result: ReturnType<typeof computeFinancingResult>;
  tranches: FinancingTranche[];
  axis: ReturnType<typeof buildResultsPeriodAxis>;
  fmt: (n: number) => string;
  currency: string;
  cropProject: (arr: number[]) => number[];
}

function SchedulesView(p: SchedulesProps): React.JSX.Element {
  const N = p.axis.activeLabels.length;
  const nonLabelPct = nonLabelColumnPct(1 + N);
  const colgroup = (
    <colgroup>
      <col style={{ width: COLUMN_WIDTHS.label }} />
      <col style={{ width: nonLabelPct }} />
      {p.axis.activeLabels.map((_, i) => <col key={i} style={{ width: nonLabelPct }} />)}
    </colgroup>
  );
  const headerRow = (
    <thead>
      <tr>
        <th style={CELL_HEADER}>Line ({currencyHeaderLine(p.currency, 'full')})</th>
        <th style={CELL_HEADER_TOTAL}>Total</th>
        {p.axis.activeLabels.map((l) => <th key={l} style={CELL_HEADER}>{l}</th>)}
      </tr>
    </thead>
  );

  // Flow row (additive, total = sum of all periods).
  // Pass 24b (2026-05-14): `negative` opt renders the row as accounting-
  // negative (parentheses + red colour) for cash-outflow lines like
  // principal repaid + total debt service.
  // Pass 35 (2026-05-14): Total cell uses the dotted-right-border
  // numTotal variant so it visually separates from the period columns.
  const renderFlowRow = (label: string, arr: number[], opts?: { bold?: boolean; negative?: boolean }) => {
    const cropped = p.cropProject(arr);
    const total = cropped.reduce((s, v) => s + v, 0);
    const nameStyle = opts?.bold ? ROW_GRAND_TOTAL.name : ROW_DATA.name;
    const baseNumStyle = opts?.bold ? ROW_GRAND_TOTAL.num : ROW_DATA.num;
    const baseTotalStyle = opts?.bold ? ROW_GRAND_TOTAL.numTotal : ROW_DATA.numTotal;
    // Pass 30b (2026-05-14): grand-total rows render white-on-navy;
    // recolouring to red would be invisible. Keep the parentheses for
    // the accounting-negative semantic but skip the red on bold rows.
    const applyRed = opts?.negative && !opts?.bold;
    const numStyle: React.CSSProperties = applyRed
      ? { ...baseNumStyle, color: 'var(--color-danger, #b91c1c)' }
      : baseNumStyle;
    const totalStyle: React.CSSProperties = applyRed
      ? { ...baseTotalStyle, color: 'var(--color-danger, #b91c1c)' }
      : baseTotalStyle;
    const renderVal = (v: number): string => {
      if (!opts?.negative) return p.fmt(v);
      const signed = v > 0 ? -v : v;
      return p.fmt(signed);
    };
    return (
      <tr>
        <td style={nameStyle}>{label}</td>
        <td style={totalStyle}>{renderVal(total)}</td>
        {cropped.map((v, i) => <td key={i} style={numStyle}>{renderVal(v)}</td>)}
      </tr>
    );
  };

  // State row (point-in-time, no Total).
  const renderStateRow = (label: string, arr: number[], opts?: { bold?: boolean }) => {
    const cropped = p.cropProject(arr);
    const nameStyle = opts?.bold ? ROW_GRAND_TOTAL.name : ROW_DATA.name;
    const numStyle  = opts?.bold ? ROW_GRAND_TOTAL.num  : ROW_DATA.num;
    const totalStyle = opts?.bold ? ROW_GRAND_TOTAL.numTotal : ROW_DATA.numTotal;
    return (
      <tr>
        <td style={nameStyle}>{label}</td>
        <td style={totalStyle}>{p.fmt(cropped[N - 1] ?? 0)}</td>
        {cropped.map((v, i) => <td key={i} style={numStyle}>{p.fmt(v)}</td>)}
      </tr>
    );
  };

  const openingSeries = (closing: number[], initial: number): number[] => {
    const out = new Array<number>(closing.length).fill(0);
    out[0] = initial;
    for (let i = 1; i < closing.length; i++) out[i] = closing[i - 1] ?? 0;
    return out;
  };

  // Pass 41b (2026-05-14): "active" gate for existing-facility UI.
  // An existing tranche only contributes to the schedules when it has
  // an opening balance > 0 OR any non-zero series in the engine output.
  // Empty stub existing tranches (origin = 'existing' but no data yet)
  // are filtered out so Debt Movement / Combined Debt Service split-by-
  // origin / Finance Cost group headers don't render zero-only rows.
  const sumArr = (a: number[] | undefined): number => (a ?? []).reduce((s, v) => s + Math.abs(v), 0);
  const isActiveExisting = (t: FinancingTranche): boolean => {
    if (t.origin !== 'existing') return false;
    if ((t.openingBalance ?? 0) > 0) return true;
    const r = p.result.facilities.get(t.id);
    if (!r) return false;
    return sumArr(r.drawSchedule) > 0
      || sumArr(r.interestPaid) > 0
      || sumArr(r.interestCapitalized) > 0
      || sumArr(r.principalRepaid) > 0;
  };
  const existingTranches = p.tranches.filter(isActiveExisting);
  const newTranches      = p.tranches.filter((t) => t.origin !== 'existing');
  const hasActiveExisting = existingTranches.length > 0;

  // Pass 31 (2026-05-14): group-header style for the Existing / New
  // section dividers used across Debt Movement + Finance Cost.
  const groupHeaderStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--color-heading)',
    marginTop: 'var(--sp-2)',
    marginBottom: 'var(--sp-1)',
    paddingBottom: 4,
    borderBottom: '1px solid var(--color-border)',
  };

  return (
    <>
      {hasActiveExisting && (
        <div style={groupHeaderStyle}>Debt Movement - Existing Facilities</div>
      )}
      {existingTranches.map((t) => {
        const r = p.result.facilities.get(t.id);
        if (!r) return null;
        const opening = openingSeries(r.outstanding, Math.max(0, t.openingBalance ?? 0));
        const totalDrawdown = r.drawSchedule.map((v, i) => v + (r.interestCapitalized[i] ?? 0));
        return (
          <section key={`ex_${t.id}`} style={{ ...sectionStyle, borderColor: 'var(--color-warning, #92400e)' }}>
            <div style={TABLE_TITLE}>{t.name}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                {colgroup}
                {headerRow}
                <tbody>
                  {renderStateRow('Opening', opening)}
                  {renderFlowRow('Capex Drawdown', r.drawSchedule)}
                  {renderFlowRow('IDC Drawdown (capitalized interest)', r.interestCapitalized)}
                  {renderFlowRow('Total Drawdown', totalDrawdown, { bold: true })}
                  {renderFlowRow('Principal Repaid', r.principalRepaid, { negative: true })}
                  {renderStateRow('Closing', r.outstanding, { bold: true })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {newTranches.length > 0 && (
        <div style={groupHeaderStyle}>Debt Movement - New Facilities</div>
      )}
      {newTranches.map((t) => {
        const r = p.result.facilities.get(t.id);
        if (!r) return null;
        const opening = openingSeries(r.outstanding, 0);
        const totalDrawdown = r.drawSchedule.map((v, i) => v + (r.interestCapitalized[i] ?? 0));
        return (
          <section key={t.id} style={sectionStyle}>
            <div style={TABLE_TITLE}>{t.name}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                {colgroup}
                {headerRow}
                <tbody>
                  {renderStateRow('Opening', opening)}
                  {renderFlowRow('Capex Drawdown', r.drawSchedule)}
                  {renderFlowRow('IDC Drawdown (capitalized interest)', r.interestCapitalized)}
                  {renderFlowRow('Total Drawdown', totalDrawdown, { bold: true })}
                  {renderFlowRow('Principal Repaid', r.principalRepaid, { negative: true })}
                  {renderStateRow('Closing', r.outstanding, { bold: true })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <section style={sectionStyle}>
        <div style={TABLE_TITLE}>Combined Debt Service</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
            {colgroup}
            {headerRow}
            <tbody>
              {renderFlowRow('Total Capex Drawdown', p.result.combined.totalDrawdown)}
              {renderFlowRow('Total IDC Drawdown', p.result.combined.totalInterestCapitalized)}
              {renderFlowRow(
                'Total Drawdown (Capex + IDC)',
                p.result.combined.totalDrawdown.map((v, i) => v + (p.result.combined.totalInterestCapitalized[i] ?? 0)),
                { bold: true },
              )}
              {/* Pass 31 (2026-05-14): split each cash-impact row into
                  Existing + New lines so the user sees how much of the
                  total comes from legacy facilities vs. new draws. */}
              {hasActiveExisting && renderFlowRow('Interest Expensed - Existing', p.result.combined.existingInterestExpensed, { negative: true })}
              {newTranches.length > 0 && renderFlowRow('Interest Expensed - New', p.result.combined.newInterestExpensed, { negative: true })}
              {renderFlowRow('Total Interest Expensed', p.result.combined.totalInterestExpensed, { bold: true, negative: true })}
              {hasActiveExisting && renderFlowRow('Principal Repaid - Existing', p.result.combined.existingPrincipalRepaid, { negative: true })}
              {newTranches.length > 0 && renderFlowRow('Principal Repaid - New', p.result.combined.newPrincipalRepaid, { negative: true })}
              {renderFlowRow('Total Principal Repaid', p.result.combined.totalPrincipalRepaid, { bold: true, negative: true })}
              {hasActiveExisting && renderFlowRow('Debt Service - Existing', p.result.combined.existingDebtServiceCash, { negative: true })}
              {newTranches.length > 0 && renderFlowRow('Debt Service - New', p.result.combined.newDebtServiceCash, { negative: true })}
              {renderFlowRow('Total Debt Service (Cash)', p.result.combined.debtServiceCash, { bold: true, negative: true })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pass 31 (2026-05-14): group per-facility Finance Cost tables
          by origin. Existing facilities first under their own header,
          then new facilities. */}
      {/* Pass 33 (2026-05-14): Finance Cost schedule rebuilt as a
          standard movement ledger - Opening / Charge (Accrued) /
          Capitalized / Paid / Closing. The Closing balance tracks
          accrued interest payable: in our engine accrual = capitalized
          + paid each period so closings are structurally zero, but the
          movement reads like a textbook accrual schedule. */}
      {(() => {
        const buildFinanceCostBalances = (accrued: number[], capitalized: number[], paid: number[]) => {
          const N = Math.max(accrued.length, capitalized.length, paid.length);
          const opening = new Array<number>(N).fill(0);
          const closing = new Array<number>(N).fill(0);
          for (let i = 0; i < N; i++) {
            opening[i] = i === 0 ? 0 : (closing[i - 1] ?? 0);
            closing[i] = opening[i] + (accrued[i] ?? 0) - (capitalized[i] ?? 0) - (paid[i] ?? 0);
          }
          return { opening, closing };
        };
        const renderFinanceCostTable = (t: FinancingTranche) => {
          const r = p.result.facilities.get(t.id);
          if (!r) return null;
          const { opening, closing } = buildFinanceCostBalances(r.interestAccrued, r.interestCapitalized, r.interestPaid);
          return (
            <section key={`fc_${t.id}`} style={sectionStyle}>
              <div style={TABLE_TITLE}>Finance Cost, {t.name}</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                  {colgroup}
                  {headerRow}
                  <tbody>
                    {renderStateRow('Opening', opening)}
                    {renderFlowRow('Charge (Accrued)', r.interestAccrued)}
                    {renderFlowRow('Capitalized', r.interestCapitalized, { negative: true })}
                    {renderFlowRow('Paid', r.interestPaid, { negative: true })}
                    {renderStateRow('Closing', closing, { bold: true })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        };
        const c = p.result.combined;
        const { opening: combOpen, closing: combClose } = buildFinanceCostBalances(c.totalInterestAccrued, c.totalInterestCapitalized, c.totalInterestExpensed);
        return (
          <>
            {hasActiveExisting && (
              <>
                <div style={groupHeaderStyle}>Finance Cost - Existing Facilities</div>
                {existingTranches.map(renderFinanceCostTable)}
              </>
            )}
            {newTranches.length > 0 && (
              <>
                <div style={groupHeaderStyle}>Finance Cost - New Facilities</div>
                {newTranches.map(renderFinanceCostTable)}
              </>
            )}
            {(existingTranches.length + newTranches.length) > 1 && (
              <section style={sectionStyle}>
                <div style={TABLE_TITLE}>Combined Finance Cost (all facilities)</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                    {colgroup}
                    {headerRow}
                    <tbody>
                      {renderStateRow('Opening', combOpen)}
                      {renderFlowRow('Charge (Accrued, all debts)', c.totalInterestAccrued)}
                      {renderFlowRow('Capitalized', c.totalInterestCapitalized, { negative: true })}
                      {renderFlowRow('Paid', c.totalInterestExpensed, { negative: true })}
                      {renderStateRow('Closing', combClose, { bold: true })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        );
      })()}

      <section style={sectionStyle}>
        <div style={TABLE_TITLE}>IDC Summary</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: '40%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '20%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Facility</th>
              <th style={CELL_HEADER}>Capitalised</th>
              <th style={CELL_HEADER}>Expensed</th>
              <th style={CELL_HEADER}>Total</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Pass 41c (2026-05-14): same isActiveExisting gate as
              // Debt Movement / Combined Debt Service / Finance Cost.
              // Empty existing-facility stubs no longer add a zero-only
              // row to IDC Summary.
              const idcTranches = p.tranches.filter((t) =>
                t.origin !== 'existing' || isActiveExisting(t),
              );
              let grandCap = 0, grandExp = 0;
              const rows = idcTranches.map((t) => {
                const r = p.result.facilities.get(t.id);
                if (!r) return null;
                const cap = r.interestCapitalized.reduce((s, v) => s + v, 0);
                const exp = r.interestPaid.reduce((s, v) => s + v, 0);
                grandCap += cap;
                grandExp += exp;
                return (
                  <tr key={`idc_${t.id}`}>
                    <td style={ROW_DATA.name}>{t.name} ({t.origin === 'existing' ? 'existing' : 'new'})</td>
                    <td style={ROW_DATA.num}>{p.fmt(cap)}</td>
                    <td style={ROW_DATA.num}>{p.fmt(exp)}</td>
                    <td style={ROW_DATA.num}>{p.fmt(cap + exp)}</td>
                  </tr>
                );
              });
              return (
                <>
                  {rows}
                  <tr>
                    <td style={ROW_GRAND_TOTAL.name}>Grand Total</td>
                    <td style={ROW_GRAND_TOTAL.num}>{p.fmt(grandCap)}</td>
                    <td style={ROW_GRAND_TOTAL.num}>{p.fmt(grandExp)}</td>
                    <td style={ROW_GRAND_TOTAL.num}>{p.fmt(grandCap + grandExp)}</td>
                  </tr>
                </>
              );
            })()}
          </tbody>
        </table>
      </section>

      <section style={sectionStyle}>
        <div style={TABLE_TITLE}>Equity Movement</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
            {colgroup}
            {headerRow}
            <tbody>
              {(() => {
                const cash   = p.result.equity.cashPerPeriod;
                const inKind = p.result.equity.inKindPerPeriod;
                const existing = p.result.equity.existingEquityPerPeriod;
                const cumulative = new Array<number>(cash.length).fill(0);
                let running = 0;
                for (let i = 0; i < cash.length; i++) {
                  running += (cash[i] ?? 0) + (inKind[i] ?? 0) + (existing[i] ?? 0);
                  cumulative[i] = running;
                }
                const opening = openingSeries(cumulative, 0);
                return (
                  <>
                    {renderStateRow('Opening', opening)}
                    {renderFlowRow('Cash Contribution', cash)}
                    {renderFlowRow('In-Kind Contribution', inKind)}
                    {p.result.equity.totalExisting > 0
                      ? renderFlowRow('Existing Equity (carry-forward)', existing)
                      : null}
                    {renderStateRow('Closing (cumulative equity)', cumulative, { bold: true })}
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
