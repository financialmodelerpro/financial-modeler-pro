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
  type Phase,
  type Asset,
  type PhaseHistoricalBaseline,
  FUNDING_METHOD_IDS,
  FUNDING_METHOD_LABELS,
  FUNDING_METHOD_DESCRIPTIONS,
  DEFAULT_PROJECT_FINANCING_CONFIG,
  REPAYMENT_METHODS_USER,
  REPAYMENT_METHOD_LABELS,
  makeDefaultFinancingTranche,
  getAssetPreCapexTotal,
} from '../../lib/state/module1-types';
import { computeFinancingResult } from '@/src/core/calculations/financing';
import { computeIdcSnapshot, computeFundingGap, computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { currencyHeaderLine, formatAccounting } from '@/src/core/formatters';
import { AccountingNumberInput } from '../ui/AccountingNumberInput';
import { PercentageInput } from '../ui/PercentageInput';
import { CELL_HEADER, CELL_HEADER_TOTAL, TABLE_TITLE, COLUMN_WIDTHS, nonLabelColumnPct, periodTableStyle, ROW_DATA, ROW_SUBTOTAL, ROW_GRAND_TOTAL } from './_shared/tableStyles';
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
  const [subTab, setSubTab] = useState<'inputs' | 'schedules' | 'fundingGap'>('inputs');

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

  // M4 Pass 2O: IDC snapshot for the Schedules sub-tab. Depends on
  // financing result + project.idcConfig + asset land/BUA + phase windows.
  const idcSnapshot = useMemo(
    () => computeIdcSnapshot(
      { project, phases, assets, subUnits, parcels, landAllocationMode },
      result,
      { axisLength: result.axis.totalPeriods, projectStartYear: new Date(project.startDate).getUTCFullYear() },
    ),
    [project, phases, assets, subUnits, parcels, landAllocationMode, result],
  );

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
        {([
          { key: 'inputs', label: 'Inputs' },
          { key: 'schedules', label: 'Schedules' },
          { key: 'fundingGap', label: 'Funding Gap' },
        ] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSubTab(t.key)}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              background: subTab === t.key ? 'var(--color-navy)' : 'var(--color-surface)',
              color: subTab === t.key ? 'var(--color-on-primary-navy)' : 'var(--color-heading)',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {t.label}
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

          {/* M4 Pass 2O (2026-05-24): IDC (Interest During Construction) policy.
              3 independent decisions: allocation basis, capitalize Y/N,
              funding mode. Lives in Financing because it's a financing
              policy question. Defaults match historical behaviour. */}
          {(() => {
            const idcCfg = project.idcConfig ?? {};
            const basis = idcCfg.allocationBasis ?? 'land';
            const capitalize = idcCfg.capitalize !== false;
            const fundingMode = idcCfg.fundingMode ?? 'debt_drawdown';
            const setIdcCfg = (patch: Partial<NonNullable<typeof project.idcConfig>>) => {
              setProject({ idcConfig: { ...idcCfg, ...patch } });
            };
            const pillBtn = (active: boolean, label: string, onClick: () => void, key: string) => (
              <button
                key={key}
                type="button"
                onClick={onClick}
                style={{
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${active ? 'var(--color-navy)' : 'var(--color-border)'}`,
                  background: active ? 'var(--color-navy)' : 'var(--color-surface)',
                  color: active ? 'var(--color-on-primary-navy)' : 'var(--color-heading)',
                  fontWeight: 600,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            );
            const labelStyle: React.CSSProperties = {
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--color-text-muted)',
              marginBottom: 4,
            };
            const captionStyle: React.CSSProperties = {
              fontSize: 10,
              color: 'var(--color-text-muted)',
              marginTop: 4,
              fontStyle: 'italic',
            };
            return (
              <section style={sectionStyle}>
                <div style={sectionTitle}>1b. IDC (Interest During Construction) Policy</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                  <div>
                    <div style={labelStyle}>Allocation Basis</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {pillBtn(basis === 'land', 'Land Area', () => setIdcCfg({ allocationBasis: 'land' }), 'land')}
                      {pillBtn(basis === 'bua', 'Total BUA', () => setIdcCfg({ allocationBasis: 'bua' }), 'bua')}
                    </div>
                    <div style={captionStyle}>
                      How project IDC is split across non-companion assets. Land = parcel-allocated sqm; BUA = built-up area sqm (sub-units + support).
                    </div>
                  </div>
                  <div>
                    <div style={labelStyle}>Capitalize Interest</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {pillBtn(capitalize, 'Yes (capitalize)', () => setIdcCfg({ capitalize: true }), 'cap-y')}
                      {pillBtn(!capitalize, 'No (expense to P&L)', () => setIdcCfg({ capitalize: false }), 'cap-n')}
                    </div>
                    <div style={captionStyle}>
                      Yes: construction interest goes to asset basis (CoS for Sell; Fixed Assets + D&A for Operate/Lease). No: hits P&L Finance Cost during construction, no allocation to assets.
                    </div>
                  </div>
                  <div>
                    <div style={labelStyle}>Funding Mode (IDC cash)</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {pillBtn(fundingMode === 'debt_drawdown', 'Drawdown via Debt', () => setIdcCfg({ fundingMode: 'debt_drawdown' }), 'fd-debt')}
                      {pillBtn(fundingMode === 'cash', 'Pay from Cash Flow', () => setIdcCfg({ fundingMode: 'cash' }), 'fd-cash')}
                    </div>
                    <div style={captionStyle}>
                      Drawdown: additional debt grows balance to cover interest (no cash impact). Cash: interest paid from operating cash, debt balance unchanged.
                    </div>
                  </div>
                </div>
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
            phases={phases}
            assets={assets}
            updatePhase={updatePhase}
            updateAsset={updateAsset}
            fmt={fmt}
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
          idc={idcSnapshot}
        />
      )}

      {subTab === 'fundingGap' && (
        <FundingGapView
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
  phases: Phase[];
  assets: Asset[];
  updatePhase: (id: string, patch: Partial<Phase>) => void;
  updateAsset: (id: string, patch: Partial<Asset>) => void;
  fmt: (n: number) => string;
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
    phases, assets, updatePhase, updateAsset, fmt,
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
          phases={phases}
          assets={assets}
          updatePhase={updatePhase}
          updateAsset={updateAsset}
          fmt={fmt}
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
  phases: Phase[];
  assets: Asset[];
  updatePhase: (id: string, patch: Partial<Phase>) => void;
  updateAsset: (id: string, patch: Partial<Asset>) => void;
  fmt: (n: number) => string;
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
    phases, assets, updatePhase, updateAsset, fmt,
    projectStartYear, operationsEndYear, defaultRepayStartYear,
    onUpdate, onRemove, onShareChange,
  } = p;
  const isExisting = t.origin === 'existing';
  // Pass 50 (2026-05-14): when this card is an existing facility,
  // resolve its phase + per-phase assets so we can render inline
  // baseline editors below the basic facility row.
  const trancheePhase = isExisting ? phases.find((ph) => ph.id === t.phaseId) : undefined;
  const trancheIsOperational = trancheePhase?.status === 'operational';
  const trancheePhaseAssets = isExisting && trancheePhase ? assets.filter((a) => a.phaseId === trancheePhase.id) : [];

  // Pass 54 (2026-05-14): single source of truth for opening debt.
  // Per-asset Existing Debt is the sole input; tranche.openingBalance
  // is auto-synced to the sum so the user doesn't enter the same
  // number twice. Engine reads `t.openingBalance` so we keep that
  // field on the schema, but the UI surfaces it as a read-only mirror
  // when the facility is the sole existing facility in its phase.
  const phaseExistingDebtTotal = isExisting && trancheePhase
    ? trancheePhaseAssets.reduce((s, a) => s + Math.max(0, a.historicalDebtAmount ?? 0), 0)
    : 0;
  React.useEffect(() => {
    if (!isExisting || !trancheIsOperational) return;
    const target = Math.round(phaseExistingDebtTotal);
    const current = Math.round(t.openingBalance ?? 0);
    if (target !== current) {
      onUpdate(t.id, { openingBalance: target });
    }
    // intentionally not depending on onUpdate / t.id to avoid loops -
    // those are stable enough that the per-render diff catches drift.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseExistingDebtTotal, isExisting, trancheIsOperational]);

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
        <>
          {/* Phase picker + basic facility fields */}
          <div style={{ marginTop: 'var(--sp-1)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <div>
              <FieldLabel>Phase</FieldLabel>
              <select
                value={t.phaseId}
                onChange={(e) => onUpdate(t.id, { phaseId: e.target.value })}
                style={inputStyle}
              >
                {phases.map((ph) => (
                  <option key={ph.id} value={ph.id}>
                    {ph.name}{ph.status === 'operational' ? '' : ` (${ph.status ?? 'planning'})`}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Mark phase Operational on Tab 1 to enable BS + asset entry below.
              </div>
            </div>
            <div>
              <FieldLabel>Opening Balance</FieldLabel>
              {/* Pass 54 (2026-05-14): read-only when phase is operational -
                  auto-synced from sum of per-asset Existing Debt below.
                  Editable only as a fallback when the phase has no assets
                  yet (so the user can sketch out a facility size before
                  detailing per-asset breakdown). */}
              {trancheIsOperational && trancheePhaseAssets.length > 0 ? (
                <>
                  <div style={{
                    ...inputStyle,
                    background: 'var(--color-surface-muted, #f3f4f6)',
                    color: 'var(--color-heading)',
                    cursor: 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                  }}>
                    {fmt(t.openingBalance ?? 0)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    Auto-synced from per-asset Existing Debt below. Edit assets to change.
                  </div>
                </>
              ) : (
                <>
                  <AccountingNumberInput value={t.openingBalance ?? 0} onChange={(v) => onUpdate(t.id, { openingBalance: Math.max(0, v) })} style={inputStyle} />
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    Outstanding loan balance at project Y0. Will auto-sync once you add assets to this phase.
                  </div>
                </>
              )}
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

        </>
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
          /* Pass 55 (2026-05-14): default existing-facility YoY end year
             to operationsEndYear when the user has not yet entered a
             Repayment Periods value. Previously `remainingRepaymentPeriods ?? 0`
             collapsed `max(0, -1)` to 0, making endYear == startYear
             (single-period grid). Now: if periods > 0, end = start +
             periods - 1 (capped at operationsEndYear); otherwise full
             operations horizon. */
          endYear={(() => {
            if (!isExisting) return operationsEndYear;
            const periods = t.remainingRepaymentPeriods ?? 0;
            if (periods <= 0) return operationsEndYear;
            const start = t.repaymentStartYear ?? projectStartYear;
            return Math.min(operationsEndYear, start + periods - 1);
          })()}
          onChange={(arr) => onUpdate(t.id, { yearOnYearPctSchedule: arr })}
        />
      )}

      {/* M4 Pass 2S (2026-05-24): Cash Sweep editor renders whenever the
          tranche's repayment method is cash_sweep OR cashSweepConfig.enabled
          is true (lets sweep stack on top of another scheduled method). */}
      {(t.repaymentMethod === 'cash_sweep' || t.cashSweepConfig?.enabled === true || t.repaymentMethod === 'cashsweep_from_period' || t.repaymentMethod === 'cashsweep_min_cash') && !isExisting && (() => {
        // Default startingYear = construction end + 1 of owning phase.
        const phase = p.phases.find((ph) => ph.id === t.phaseId);
        const phaseStartYear = phase?.startDate
          ? new Date(phase.startDate).getUTCFullYear()
          : p.projectStartYear;
        const cp = Math.max(0, phase?.constructionPeriods ?? 0);
        const defaultStartingYear = phaseStartYear + cp;
        return (
          <CashSweepEditor
            config={t.cashSweepConfig}
            defaultStartingYear={defaultStartingYear}
            onChange={(cfg) => onUpdate(t.id, { cashSweepConfig: cfg })}
          />
        );
      })()}

      {/* Pass 53 (2026-05-14): Existing Operations panel
          relocated BELOW the rate + repayment rows so the user
          completes facility-specific fields first, then enters
          per-phase + per-asset baseline data. Same logic as
          Pass 50, just re-anchored. */}
      {isExisting && (
        <>
          {/* Pass 50 (2026-05-14): inline Existing Operations editor.
              Replaces the Pass 44/48 standalone card at the top of the
              page. The per-phase opening BS items + per-asset baseline
              entries live INSIDE the existing-facility card so the user
              captures everything related to "this existing facility"
              in one place. Renders only when the selected phase is
              operational. */}
          {trancheIsOperational && trancheePhase && (() => {
            const ph = trancheePhase;
            const b = ph.historicalBaseline;
            const seedBaseline = (): PhaseHistoricalBaseline => b ?? {
              historicalCapexTotal: 0,
              historicalEquityContributed: 0,
              historicalDebtDrawn: 0,
              currentDebtOutstanding: 0,
              cumulativeDepreciationCharged: 0,
              netBookValueFixedAssets: 0,
              last12MonthsRevenue: 0,
              last12MonthsOpex: 0,
            };
            const phaseAssetsTotPre = trancheePhaseAssets.reduce((s, a) => s + getAssetPreCapexTotal(a), 0);
            const phaseAssetsTotDebt = trancheePhaseAssets.reduce((s, a) => s + Math.max(0, a.historicalDebtAmount ?? 0), 0);
            const phaseAssetsTotEq = trancheePhaseAssets.reduce((s, a) => s + Math.max(0, a.historicalEquityAmount ?? 0), 0);
            const balancesOk = Math.abs(phaseAssetsTotPre - (phaseAssetsTotDebt + phaseAssetsTotEq)) < 1;
            // M4 Pass 2M-A1: Opening Cash identity at phase level.
            // PreCapex + OpeningCash should equal Debt + Equity. Any
            // excess D+E that does not capitalise into existing assets
            // is captured in Opening Cash so the BS balances at t=0.
            const phaseOpeningCash = Math.max(0, b?.historicalOpeningCash ?? 0);
            const openingDiff = (phaseAssetsTotPre + phaseOpeningCash) - (phaseAssetsTotDebt + phaseAssetsTotEq);
            const openingOk = Math.abs(openingDiff) < 1;
            return (
              <div style={{
                marginTop: 'var(--sp-2)',
                padding: 'var(--sp-2)',
                border: '1px dashed var(--color-warning, #92400e)',
                borderRadius: 'var(--radius-sm)',
                background: 'color-mix(in srgb, var(--color-warning, #92400e) 4%, transparent)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-warning, #92400e)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--sp-1)' }}>
                  Existing Operations for {ph.name}
                </div>

                {/* Per-phase opening BS row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 'var(--sp-2)' }}>
                  <div>
                    <FieldLabel>Cumulative Depreciation</FieldLabel>
                    <AccountingNumberInput
                      value={b?.cumulativeDepreciationCharged ?? 0}
                      onChange={(v) => updatePhase(ph.id, { historicalBaseline: { ...seedBaseline(), cumulativeDepreciationCharged: Math.max(0, v) } })}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <FieldLabel>Net Book Value (Fixed Assets)</FieldLabel>
                    <AccountingNumberInput
                      value={b?.netBookValueFixedAssets ?? 0}
                      onChange={(v) => updatePhase(ph.id, { historicalBaseline: { ...seedBaseline(), netBookValueFixedAssets: Math.max(0, v) } })}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <FieldLabel>Existing Retained Earnings</FieldLabel>
                    <AccountingNumberInput
                      value={b?.existingRetainedEarnings ?? 0}
                      onChange={(v) => updatePhase(ph.id, { historicalBaseline: { ...seedBaseline(), existingRetainedEarnings: Math.max(0, v) } })}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    {/* M4 Pass 2M-A1 (2026-05-20): opening cash balance.
                     *  Closes the BS imbalance at t=0 when the phase
                     *  carries pre-existing debt + equity that exceed
                     *  pre-capex. Flows to BS Cash[0] via the composer. */}
                    <FieldLabel>Opening Cash (Y0)</FieldLabel>
                    <AccountingNumberInput
                      value={b?.historicalOpeningCash ?? 0}
                      onChange={(v) => updatePhase(ph.id, { historicalBaseline: { ...seedBaseline(), historicalOpeningCash: Math.max(0, v) } })}
                      style={inputStyle}
                    />
                  </div>
                </div>

                {/* Per-asset baseline rows */}
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  Per-asset Historical Baseline ({trancheePhaseAssets.length} asset{trancheePhaseAssets.length === 1 ? '' : 's'})
                </div>
                {trancheePhaseAssets.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic', padding: 'var(--sp-1)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
                    No assets in {ph.name} yet. Add assets on Tab 2.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 6, marginBottom: 'var(--sp-1)' }}>
                    {trancheePhaseAssets.map((a) => {
                      // Pass 56: Pre-Capex split into Land + Building/Infra.
                      // Total is derived (no separate input) so future
                      // depreciation can target only the Building portion.
                      const land = Math.max(0, a.historicalPreCapexLand ?? 0);
                      const building = Math.max(0, a.historicalPreCapexBuilding ?? 0);
                      const pre = getAssetPreCapexTotal(a);
                      const dbt = Math.max(0, a.historicalDebtAmount ?? 0);
                      const eq = Math.max(0, a.historicalEquityAmount ?? 0);
                      const diff = pre - (dbt + eq);
                      const aBalances = Math.abs(diff) < 1;
                      const equityNeeded = Math.max(0, pre - dbt);
                      return (
                        <div
                          key={a.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1.4fr 1.4fr 1fr 1fr 1.3fr',
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
                            <FieldLabel>Pre-Capex (Land + Building)</FieldLabel>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                              <div>
                                <div style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>Land Value</div>
                                <AccountingNumberInput value={land} onChange={(v) => updateAsset(a.id, { historicalPreCapexLand: Math.max(0, v) })} style={inputStyle} />
                              </div>
                              <div>
                                <div style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>Building / Infra</div>
                                <AccountingNumberInput value={building} onChange={(v) => updateAsset(a.id, { historicalPreCapexBuilding: Math.max(0, v) })} style={inputStyle} />
                              </div>
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2, fontStyle: 'italic' }}>
                              = {fmt(pre)} total (Land does not depreciate)
                            </div>
                          </div>
                          <div>
                            <FieldLabel>Existing Debt</FieldLabel>
                            <AccountingNumberInput value={dbt} onChange={(v) => updateAsset(a.id, { historicalDebtAmount: Math.max(0, v) })} style={inputStyle} />
                          </div>
                          <div>
                            <FieldLabel>Existing Equity</FieldLabel>
                            <AccountingNumberInput value={eq} onChange={(v) => updateAsset(a.id, { historicalEquityAmount: Math.max(0, v) })} style={inputStyle} />
                          </div>
                          <div
                            title={
                              aBalances
                                ? `Pre-Capex ${fmt(pre)} (Land ${fmt(land)} + Building ${fmt(building)}) = Debt ${fmt(dbt)} + Equity ${fmt(eq)}.`
                                : `Pre-Capex ${fmt(pre)} (Land ${fmt(land)} + Building ${fmt(building)}) should equal Debt ${fmt(dbt)} + Equity ${fmt(eq)}. Equity should be ${fmt(equityNeeded)} to balance.`
                            }
                            style={{
                              padding: '4px 8px',
                              borderRadius: 'var(--radius-sm)',
                              fontWeight: 700,
                              textAlign: 'center',
                              fontSize: 11,
                              background: aBalances ? 'color-mix(in srgb, var(--color-success, #166534) 16%, transparent)' : 'color-mix(in srgb, var(--color-warning, #92400e) 16%, transparent)',
                              color: aBalances ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)',
                            }}
                          >
                            {aBalances ? 'Balances' : `Off ${fmt(Math.abs(diff))}`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Phase-level totals.
                    Pass 54 (2026-05-14): Facility Opening Bal cross-check
                    tile removed - Opening Balance is now auto-synced
                    from the per-asset Existing Debt total, so a
                    mismatch is structurally impossible. */}
                {trancheePhaseAssets.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 'var(--sp-1)', fontSize: 11 }}>
                    <div style={{ padding: '4px 8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
                      <div style={{ fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Pre-Capex</div>
                      <div style={{ fontWeight: 700, color: 'var(--color-heading)' }}>{fmt(phaseAssetsTotPre)}</div>
                    </div>
                    <div style={{ padding: '4px 8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
                      <div style={{ fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Existing Debt</div>
                      <div style={{ fontWeight: 700, color: 'var(--color-heading)' }}>{fmt(phaseAssetsTotDebt)}</div>
                      <div style={{ fontSize: 9, fontStyle: 'italic', color: 'var(--color-text-muted)' }}>flows into Opening Balance</div>
                    </div>
                    <div style={{ padding: '4px 8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
                      <div style={{ fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Existing Equity</div>
                      <div style={{ fontWeight: 700, color: 'var(--color-heading)' }}>{fmt(phaseAssetsTotEq)}</div>
                    </div>
                  </div>
                )}
                {!balancesOk && trancheePhaseAssets.length > 0 && (
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-danger, #b91c1c)', background: 'color-mix(in srgb, var(--color-danger, #b91c1c) 10%, transparent)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', marginTop: 6 }}>
                    Pre-Capex {fmt(phaseAssetsTotPre)} != Debt {fmt(phaseAssetsTotDebt)} + Equity {fmt(phaseAssetsTotEq)}. Per-asset balances do not reconcile.
                  </div>
                )}
                {/* M4 Pass 2M-A1: Opening Cash identity chip. */}
                {trancheePhaseAssets.length > 0 && (
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: openingOk ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)',
                      background: openingOk
                        ? 'color-mix(in srgb, var(--color-success, #166534) 10%, transparent)'
                        : 'color-mix(in srgb, var(--color-warning, #92400e) 12%, transparent)',
                      padding: '6px 10px',
                      borderRadius: 'var(--radius-sm)',
                      marginTop: 6,
                    }}
                    title="Pre-Capex + Opening Cash should equal Debt + Equity. Opening Cash captures excess financing not yet deployed into fixed assets."
                  >
                    Pre-Capex {fmt(phaseAssetsTotPre)} + Opening Cash {fmt(phaseOpeningCash)} = {fmt(phaseAssetsTotPre + phaseOpeningCash)}{' '}
                    {openingOk ? '=' : 'vs'} Debt {fmt(phaseAssetsTotDebt)} + Equity {fmt(phaseAssetsTotEq)} = {fmt(phaseAssetsTotDebt + phaseAssetsTotEq)}
                    {!openingOk && ` (off ${fmt(Math.abs(openingDiff))})`}
                  </div>
                )}
              </div>
            );
          })()}

          {!trancheIsOperational && (
            <div style={{
              marginTop: 'var(--sp-1)',
              padding: '6px 10px',
              border: '1px dashed var(--color-text-muted)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 11,
              color: 'var(--color-text-muted)',
              fontStyle: 'italic',
            }}>
              Mark this phase as Operational on Tab 1 to capture per-asset Pre-Capex / Debt / Equity + opening BS items here.
            </div>
          )}
        </>
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
  config: { enabled?: boolean; priority?: number; startingYear?: number; sweepRatio?: number } | undefined;
  onChange: (cfg: { enabled?: boolean; priority?: number; startingYear?: number; sweepRatio?: number }) => void;
  /** Default starting year suggestion (construction end + 1 of owning phase). */
  defaultStartingYear: number;
}

function CashSweepEditor(p: CashSweepEditorProps): React.JSX.Element {
  const cfg = p.config ?? {};
  const startingYear = cfg.startingYear ?? p.defaultStartingYear;
  const sweepRatio = cfg.sweepRatio ?? 100;
  const priority = cfg.priority ?? 100;
  return (
    <div style={{ marginTop: 'var(--sp-1)', padding: 'var(--sp-1)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Priority (lower = paid first)</label>
        <input
          type="number"
          value={priority}
          onChange={(e) => p.onChange({ ...cfg, priority: Math.max(0, Number(e.target.value) || 0) })}
          style={inputStyle}
        />
      </div>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Starting Year (calendar)</label>
        <input
          type="number"
          value={startingYear}
          onChange={(e) => p.onChange({ ...cfg, startingYear: Math.max(1900, Number(e.target.value) || p.defaultStartingYear) })}
          style={inputStyle}
        />
        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>Default: {p.defaultStartingYear} (construction end + 1)</div>
      </div>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Sweep Ratio % of excess cash</label>
        <PercentageInput
          value={sweepRatio}
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
  // M4 Pass 2V (2026-05-24): add prior-year column. Pre-Capex (existing
  // operations) lives in the prior column instead of Y0.
  const nonLabelPct = nonLabelColumnPct(2 + N);
  const periodTbl = periodTableStyle(2 + N);
  const exclLand    = p.cropProject(p.capex.perPeriod.exclAllLand);
  const landCash    = p.cropProject(p.capex.perPeriod.landCash);
  const totalIncl   = p.cropProject(p.capex.perPeriod.exclLandInKind);
  const priorCell: React.CSSProperties = { ...ROW_DATA.num, fontStyle: 'italic', color: 'var(--color-meta)' };
  const priorTotalCell: React.CSSProperties = { ...ROW_GRAND_TOTAL.num, fontStyle: 'italic', color: 'var(--color-meta)' };
  return (
    <section style={sectionStyle}>
      <div style={TABLE_TITLE}>6. Capex Breakdown</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={periodTbl}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            <col style={{ width: nonLabelPct }} />
            {p.axis.activeLabels.map((_, i) => <col key={i} style={{ width: nonLabelPct }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Line ({currencyHeaderLine(p.currency, 'full')})</th>
              <th style={CELL_HEADER_TOTAL}>Total</th>
              <th style={{ ...CELL_HEADER, fontStyle: 'italic', color: 'var(--color-meta)' }}>{p.axis.priorLabel}</th>
              {p.axis.activeLabels.map((l) => <th key={l} style={CELL_HEADER}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={ROW_DATA.name}>Capex (excluding Land)</td>
              <td style={ROW_DATA.numTotal}>{p.fmt(p.capex.totals.exclAllLand)}</td>
              <td style={priorCell}></td>
              {exclLand.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={ROW_DATA.name}>Land Cash Value</td>
              <td style={ROW_DATA.numTotal}>{p.fmt(p.capex.totals.exclLandInKind - p.capex.totals.exclAllLand)}</td>
              <td style={priorCell}></td>
              {landCash.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={ROW_GRAND_TOTAL.name}>Total Capex Incl Cash Land</td>
              <td style={ROW_GRAND_TOTAL.numTotal}>{p.fmt(p.capex.totals.exclLandInKind)}</td>
              <td style={priorTotalCell}></td>
              {totalIncl.map((v, i) => <td key={i} style={ROW_GRAND_TOTAL.num}>{p.fmt(v)}</td>)}
            </tr>
            {p.existingPreCapex > 0 && (
              <tr>
                <td style={ROW_DATA.name}>Pre-Capex (existing operations)</td>
                <td style={ROW_DATA.numTotal}>{p.fmt(p.existingPreCapex)}</td>
                <td style={priorCell}>{p.fmt(p.existingPreCapex)}</td>
                {p.axis.activeLabels.map((_, i) => (
                  <td key={i} style={ROW_DATA.num}>{p.fmt(0)}</td>
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
  // M4 Pass 2V (2026-05-24): add prior-year column for visual
  // consistency with the rest of the financing tables (blank for
  // in-axis-only Funding Methods).
  const nonLabelPct = nonLabelColumnPct(2 + N);
  const periodTbl = periodTableStyle(2 + N);
  const m1PerPeriod = p.cropProject(p.capex.perPeriod.exclLandInKind);
  const blanks = new Array<number>(N).fill(0);
  const selectedMethodId = p.funding.selectedMethodId;
  const priorCell: React.CSSProperties = { ...ROW_DATA.num, fontStyle: 'italic', color: 'var(--color-meta)' };
  const priorTotalCell: React.CSSProperties = { ...ROW_GRAND_TOTAL.num, fontStyle: 'italic', color: 'var(--color-meta)' };
  const priorSubCell: React.CSSProperties = { ...ROW_SUBTOTAL.num, fontStyle: 'italic', color: 'var(--color-meta)' };

  const selectedPerPeriod = p.cropProject(p.funding.selectedByPeriod);
  const minCashPerPeriod = p.cropProject(p.funding.minCashByPeriod);
  const totalFundingPerPeriod = p.cropProject(p.funding.totalFundingNeedByPeriod);
  const showMinCashRows = p.funding.minCashReserve > 0 && selectedMethodId !== 3;

  return (
    <section style={sectionStyle}>
      <div style={TABLE_TITLE}>7. Funding Requirement ({currencyHeaderLine(p.currency, p.scale)})</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={periodTbl}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            <col style={{ width: nonLabelPct }} />
            {p.axis.activeLabels.map((_, i) => <col key={i} style={{ width: nonLabelPct }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Method</th>
              <th style={CELL_HEADER_TOTAL}>Total</th>
              <th style={{ ...CELL_HEADER, fontStyle: 'italic', color: 'var(--color-meta)' }}>{p.axis.priorLabel}</th>
              {p.axis.activeLabels.map((l) => <th key={l} style={CELL_HEADER}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={ROW_DATA.name}>Method 1, Fixed Debt-to-Equity Ratio</td>
              <td style={ROW_DATA.numTotal}>{p.fmt(p.funding.method1)}</td>
              <td style={priorCell}></td>
              {m1PerPeriod.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={{ ...ROW_DATA.name, color: 'var(--color-text-muted)' }}>Method 2, Net Funding Requirement</td>
              <td style={{ ...ROW_DATA.numTotal, color: 'var(--color-text-muted)' }}>-</td>
              <td style={priorCell}></td>
              {blanks.map((_, i) => <td key={i} style={{ ...ROW_DATA.num, color: 'var(--color-text-muted)' }}>-</td>)}
            </tr>
            <tr>
              <td style={{ ...ROW_DATA.name, color: 'var(--color-text-muted)' }}>Method 3, Cash Deficit Funding</td>
              <td style={{ ...ROW_DATA.numTotal, color: 'var(--color-text-muted)' }}>-</td>
              <td style={priorCell}></td>
              {blanks.map((_, i) => <td key={i} style={{ ...ROW_DATA.num, color: 'var(--color-text-muted)' }}>-</td>)}
            </tr>
            <tr>
              <td style={ROW_DATA.name}>Method 4, Specified Debt + Equity (manual)</td>
              <td style={ROW_DATA.numTotal}>{p.fmt(p.funding.method4)}</td>
              <td style={priorCell}></td>
              {(selectedMethodId === 4 ? selectedPerPeriod : blanks).map((v, i) => (
                <td key={i} style={ROW_DATA.num}>{selectedMethodId === 4 ? p.fmt(v) : '-'}</td>
              ))}
            </tr>
            <tr>
              <td style={ROW_SUBTOTAL.name}>Selected (Method {selectedMethodId})</td>
              <td style={ROW_SUBTOTAL.numTotal}>{p.fmt(p.funding.selected)}</td>
              <td style={priorSubCell}></td>
              {(selectedMethodId === 1 || selectedMethodId === 4 ? selectedPerPeriod : blanks).map((v, i) => (
                <td key={i} style={ROW_SUBTOTAL.num}>{selectedMethodId === 1 || selectedMethodId === 4 ? p.fmt(v) : '-'}</td>
              ))}
            </tr>
            {showMinCashRows && (
              <>
                <tr>
                  <td style={ROW_DATA.name}>+ Minimum Cash Reserve</td>
                  <td style={ROW_DATA.numTotal}>{p.fmt(p.funding.minCashReserve)}</td>
                  <td style={priorCell}></td>
                  {minCashPerPeriod.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
                </tr>
                <tr>
                  <td style={ROW_GRAND_TOTAL.name}>Total Funding Need</td>
                  <td style={ROW_GRAND_TOTAL.numTotal}>{p.fmt(p.funding.selectedWithMinCash)}</td>
                  <td style={priorTotalCell}></td>
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
  // M4 Pass 2V (2026-05-24): add prior-year column for existing debt
  // opening balance (pre-axis carry-forward).
  const nonLabelPct = nonLabelColumnPct(2 + N);
  const periodTbl = periodTableStyle(2 + N);
  const newTranches = p.tranches.filter((t) => t.origin !== 'existing');
  const existingOpeningTotal = (() => {
    let s = 0;
    for (const t of p.tranches) {
      if (t.origin === 'existing') s += Math.max(0, t.openingBalance ?? 0);
    }
    return s;
  })();
  const priorCell: React.CSSProperties = { ...ROW_DATA.num, fontStyle: 'italic', color: 'var(--color-meta)' };
  const priorSubCell: React.CSSProperties = { ...ROW_SUBTOTAL.num, fontStyle: 'italic', color: 'var(--color-meta)' };
  const priorTotalCell: React.CSSProperties = { ...ROW_GRAND_TOTAL.num, fontStyle: 'italic', color: 'var(--color-meta)' };

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
        <table style={periodTbl}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            <col style={{ width: nonLabelPct }} />
            {p.axis.activeLabels.map((_, i) => <col key={i} style={{ width: nonLabelPct }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Facility</th>
              <th style={CELL_HEADER_TOTAL}>Total</th>
              <th style={{ ...CELL_HEADER, fontStyle: 'italic', color: 'var(--color-meta)' }}>{p.axis.priorLabel}</th>
              {p.axis.activeLabels.map((l) => <th key={l} style={CELL_HEADER}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {existingOpeningTotal > 0 && (
              <tr>
                <td style={ROW_DATA.name}>Existing Debt (opening balance, pre-axis)</td>
                <td style={ROW_DATA.numTotal}>{p.fmt(existingOpeningTotal)}</td>
                <td style={priorCell}>{p.fmt(existingOpeningTotal)}</td>
                {p.axis.activeLabels.map((_, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(0)}</td>)}
              </tr>
            )}
            {newTranches.map((t) => {
              const r = p.facilities.get(t.id);
              const series = p.cropProject(r?.drawSchedule ?? []);
              const total = series.reduce((s, v) => s + v, 0);
              return (
                <tr key={t.id}>
                  <td style={ROW_DATA.name}>{t.name}</td>
                  <td style={ROW_DATA.numTotal}>{p.fmt(total)}</td>
                  <td style={priorCell}></td>
                  {series.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
                </tr>
              );
            })}
            <tr>
              <td style={ROW_SUBTOTAL.name}>Capex Drawdown Subtotal</td>
              <td style={ROW_SUBTOTAL.numTotal}>{p.fmt(totalCapexDraw)}</td>
              <td style={priorSubCell}></td>
              {totalCapexDrawByPeriod.map((v, i) => <td key={i} style={ROW_SUBTOTAL.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={ROW_DATA.name}>IDC Drawdown (capitalized interest)</td>
              <td style={ROW_DATA.numTotal}>{p.fmt(totalIdcDraw)}</td>
              <td style={priorCell}></td>
              {idcDrawByPeriod.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={ROW_GRAND_TOTAL.name}>Total Debt Required (new draws + IDC)</td>
              <td style={ROW_GRAND_TOTAL.numTotal}>{p.fmt(totalDebtRequired)}</td>
              <td style={priorTotalCell}></td>
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
  // M4 Pass 2V (2026-05-24): add prior-year column. Existing equity
  // is a PRE-AXIS event — render it in the prior column and zero its
  // axis entries.
  const nonLabelPct = nonLabelColumnPct(2 + N);
  const periodTbl = periodTableStyle(2 + N);
  const cash = p.cropProject(p.equity.cashPerPeriod);
  const inKind = p.cropProject(p.equity.inKindPerPeriod);
  const total = p.cropProject(p.equity.totalPerPeriod);
  const priorCell: React.CSSProperties = { ...ROW_DATA.num, fontStyle: 'italic', color: 'var(--color-meta)' };
  const priorTotalCell: React.CSSProperties = { ...ROW_GRAND_TOTAL.num, fontStyle: 'italic', color: 'var(--color-meta)' };
  return (
    <section style={sectionStyle}>
      <div style={TABLE_TITLE}>9. Total Equity Required ({currencyHeaderLine(p.currency, p.scale)})</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={periodTbl}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            <col style={{ width: nonLabelPct }} />
            {p.axis.activeLabels.map((_, i) => <col key={i} style={{ width: nonLabelPct }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Source</th>
              <th style={CELL_HEADER_TOTAL}>Total</th>
              <th style={{ ...CELL_HEADER, fontStyle: 'italic', color: 'var(--color-meta)' }}>{p.axis.priorLabel}</th>
              {p.axis.activeLabels.map((l) => <th key={l} style={CELL_HEADER}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {p.equity.totalExisting > 0 && (
              <tr>
                <td style={ROW_DATA.name}>Existing Equity (pre-axis carry-forward)</td>
                <td style={ROW_DATA.numTotal}>{p.fmt(p.equity.totalExisting)}</td>
                <td style={priorCell}>{p.fmt(p.equity.totalExisting)}</td>
                {p.axis.activeLabels.map((_, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(0)}</td>)}
              </tr>
            )}
            <tr>
              <td style={ROW_DATA.name}>Cash Equity</td>
              <td style={ROW_DATA.numTotal}>{p.fmt(p.equity.totalCash)}</td>
              <td style={priorCell}></td>
              {cash.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={ROW_DATA.name}>In-Kind Equity</td>
              <td style={ROW_DATA.numTotal}>{p.fmt(p.equity.totalInKind)}</td>
              <td style={priorCell}></td>
              {inKind.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={ROW_GRAND_TOTAL.name}>Total Equity Required</td>
              <td style={ROW_GRAND_TOTAL.numTotal}>{p.fmt(p.equity.grandTotal)}</td>
              <td style={priorTotalCell}>{p.fmt(p.equity.totalExisting)}</td>
              {total.map((v, i) => {
                // Subtract existing equity that was lumped into axis t=0
                // by the financing engine — we've moved it to prior col.
                const axisOnly = i === 0 ? v - p.equity.totalExisting : v;
                return <td key={i} style={ROW_GRAND_TOTAL.num}>{p.fmt(axisOnly)}</td>;
              })}
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
  /** M4 Pass 2O: IDC snapshot computed at parent, drives the per-asset
   *  allocation Summary + routed-to-CoS / routed-to-FA sub-tables. */
  idc: import('../../lib/financials-resolvers').ProjectIDCSnapshot;
}

function SchedulesView(p: SchedulesProps): React.JSX.Element {
  const N = p.axis.activeLabels.length;
  // M4 Pass 2U-Fix #2 (2026-05-24): add prior-year column between
  // Total and the first axis year, consistent with Capex Results and
  // Module 4 surfaces. Pre-axis events (existing equity, existing
  // debt opening, pre-capex) render here instead of inflating Y0.
  const nonLabelPct = nonLabelColumnPct(2 + N);
  const periodTbl = periodTableStyle(2 + N);
  const colgroup = (
    <colgroup>
      <col style={{ width: COLUMN_WIDTHS.label }} />
      <col style={{ width: nonLabelPct }} />
      <col style={{ width: nonLabelPct }} />
      {p.axis.activeLabels.map((_, i) => <col key={i} style={{ width: nonLabelPct }} />)}
    </colgroup>
  );
  const headerRow = (
    <thead>
      <tr>
        <th style={CELL_HEADER}>Line ({currencyHeaderLine(p.currency, 'full')})</th>
        <th style={CELL_HEADER_TOTAL}>Total</th>
        <th style={{ ...CELL_HEADER, fontStyle: 'italic', color: 'var(--color-meta)' }}>{p.axis.priorLabel}</th>
        {p.axis.activeLabels.map((l) => <th key={l} style={CELL_HEADER}>{l}</th>)}
      </tr>
    </thead>
  );

  const renderFlowRow = (label: string, arr: number[], opts?: { bold?: boolean; negative?: boolean; priorValue?: number }) => {
    const cropped = p.cropProject(arr);
    const total = cropped.reduce((s, v) => s + v, 0) + (opts?.priorValue ?? 0);
    const nameStyle = opts?.bold ? ROW_GRAND_TOTAL.name : ROW_DATA.name;
    const baseNumStyle = opts?.bold ? ROW_GRAND_TOTAL.num : ROW_DATA.num;
    const baseTotalStyle = opts?.bold ? ROW_GRAND_TOTAL.numTotal : ROW_DATA.numTotal;
    const applyRed = opts?.negative && !opts?.bold;
    const numStyle: React.CSSProperties = applyRed
      ? { ...baseNumStyle, color: 'var(--color-danger, #b91c1c)' }
      : baseNumStyle;
    const totalStyle: React.CSSProperties = applyRed
      ? { ...baseTotalStyle, color: 'var(--color-danger, #b91c1c)' }
      : baseTotalStyle;
    const priorStyle: React.CSSProperties = { ...numStyle, fontStyle: 'italic', color: applyRed ? 'var(--color-danger, #b91c1c)' : 'var(--color-meta)' };
    const renderVal = (v: number): string => {
      if (!opts?.negative) return p.fmt(v);
      const signed = v > 0 ? -v : v;
      return p.fmt(signed);
    };
    return (
      <tr>
        <td style={nameStyle}>{label}</td>
        <td style={totalStyle}>{renderVal(total)}</td>
        <td style={priorStyle}>{opts?.priorValue !== undefined ? renderVal(opts.priorValue) : ''}</td>
        {cropped.map((v, i) => <td key={i} style={numStyle}>{renderVal(v)}</td>)}
      </tr>
    );
  };

  const renderStateRow = (label: string, arr: number[], opts?: { bold?: boolean; priorValue?: number }) => {
    const cropped = p.cropProject(arr);
    const nameStyle = opts?.bold ? ROW_GRAND_TOTAL.name : ROW_DATA.name;
    const numStyle  = opts?.bold ? ROW_GRAND_TOTAL.num  : ROW_DATA.num;
    const totalStyle = opts?.bold ? ROW_GRAND_TOTAL.numTotal : ROW_DATA.numTotal;
    const priorStyle: React.CSSProperties = { ...numStyle, fontStyle: 'italic', color: 'var(--color-meta)' };
    return (
      <tr>
        <td style={nameStyle}>{label}</td>
        <td style={totalStyle}>{p.fmt(cropped[N - 1] ?? 0)}</td>
        <td style={priorStyle}>{opts?.priorValue !== undefined ? p.fmt(opts.priorValue) : ''}</td>
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
        // M4 Pass 2U-Fix #2 (2026-05-24): existing facility's
        // openingBalance is a PRE-AXIS carry-forward. Show it in the
        // prior-year column on Opening + Closing rows.
        const priorBal = Math.max(0, t.openingBalance ?? 0);
        const opening = openingSeries(r.outstanding, priorBal);
        const totalDrawdown = r.drawSchedule.map((v, i) => v + (r.interestCapitalized[i] ?? 0));
        return (
          <section key={`ex_${t.id}`} style={{ ...sectionStyle, borderColor: 'var(--color-warning, #92400e)' }}>
            <div style={TABLE_TITLE}>{t.name}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={periodTbl}>
                {colgroup}
                {headerRow}
                <tbody>
                  {renderStateRow('Opening', opening, { priorValue: 0 })}
                  {renderFlowRow('Capex Drawdown', r.drawSchedule, { priorValue: 0 })}
                  {renderFlowRow('IDC Drawdown (capitalized interest)', r.interestCapitalized, { priorValue: 0 })}
                  {renderFlowRow('Total Drawdown', totalDrawdown, { bold: true, priorValue: priorBal })}
                  {renderFlowRow('Principal Repaid', r.principalRepaid, { negative: true, priorValue: 0 })}
                  {renderStateRow('Closing', r.outstanding, { bold: true, priorValue: priorBal })}
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
              <table style={periodTbl}>
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
          <table style={periodTbl}>
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
                <table style={periodTbl}>
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
                  <table style={periodTbl}>
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

      {/* M4 Pass 2O (2026-05-24): IDC Allocation — by-asset breakdown.
          Source = financing.totalInterestForAssetBasis, allocated per
          project.idcConfig.allocationBasis. Routed downstream to CoS
          (Sell) or Fixed Assets+D&A (Operate/Lease). */}
      {(() => {
        const idc = p.idc;
        const basisLabel = idc.allocationBasis === 'bua' ? 'BUA share' : 'Land share';
        const policyChips = (
          <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--sp-1)' }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
              background: 'color-mix(in srgb, var(--color-navy) 12%, transparent)',
              color: 'var(--color-navy)', border: '1px solid var(--color-navy)',
            }}>Basis: {idc.allocationBasis === 'bua' ? 'BUA Area' : 'Land Area'}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
              background: idc.capitalize
                ? 'color-mix(in srgb, var(--color-success, #166534) 12%, transparent)'
                : 'color-mix(in srgb, var(--color-warning, #92400e) 12%, transparent)',
              color: idc.capitalize ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)',
              border: `1px solid ${idc.capitalize ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)'}`,
            }}>{idc.capitalize ? 'Capitalize: ON' : 'Capitalize: OFF (P&L)'}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
              background: 'color-mix(in srgb, var(--color-meta, #6b7280) 12%, transparent)',
              color: 'var(--color-meta, #6b7280)', border: '1px solid var(--color-meta, #6b7280)',
            }}>Funding: {idc.fundingMode === 'cash' ? 'Cash (no extra debt)' : 'Drawdown via Debt'}</span>
          </div>
        );

        const assetRows = Array.from(idc.byAsset.values());
        const sellRows = assetRows.filter((r) => r.strategy === 'Sell' || r.strategy === 'Sell + Manage');
        const opLeaseRows = assetRows.filter((r) => r.strategy === 'Operate' || r.strategy === 'Lease');
        const grandTotal = idc.totalIdcPerPeriod.reduce((s, v) => s + v, 0);
        const sumSeries = (rows: typeof assetRows): number[] => {
          const out = new Array<number>(idc.axisLength).fill(0);
          for (const r of rows) for (let t = 0; t < idc.axisLength; t++) out[t] += r.idcPerPeriod[t] ?? 0;
          return out;
        };
        const sellSubtotal = sumSeries(sellRows);
        const opLeaseSubtotal = sumSeries(opLeaseRows);
        const constructionInterest = idc.totalConstructionInterestPerPeriod;

        return (
          <section style={sectionStyle}>
            <div style={TABLE_TITLE}>IDC Allocation — by Asset (YoY + Total)</div>
            {policyChips}

            {/* Summary table: per-asset IDC YoY + Total + share %. Always
                rendered (even when capitalize=OFF, shows zero rows for
                clarity + construction-interest stream below). */}
            <div style={{ overflowX: 'auto' }}>
              <table style={periodTbl}>
                {colgroup}
                {headerRow}
                <tbody>
                  {assetRows.length === 0 ? (
                    <tr><td colSpan={3 + N} style={ROW_DATA.name}>No non-companion assets — IDC allocation has nothing to distribute.</td></tr>
                  ) : (
                    <>
                      {assetRows.map((r) => {
                        const series = p.cropProject(r.idcPerPeriod);
                        const total = series.reduce((s, v) => s + v, 0);
                        const sharePct = (r.shareOfTotalLand * 100).toFixed(2);
                        const sqmFmt = (v: number): string => Math.round(v).toLocaleString();
                        // M4 Pass 2Y-Fix (2026-05-24): inline <tr> rows
                        // must include an EMPTY prior-column cell so they
                        // align with the Pass 2V header (label | total |
                        // prior | y0..yN-1). Without this, axis values
                        // shifted left into the prior column visually.
                        const priorStyle: React.CSSProperties = { ...ROW_DATA.num, fontStyle: 'italic', color: 'var(--color-meta)' };
                        return (
                          <tr key={r.assetId}>
                            <td style={ROW_DATA.name}>
                              {r.assetName}
                              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 6 }}>
                                (Land {sqmFmt(r.physicalLandSqm)} sqm · BUA {sqmFmt(r.physicalBuaSqm)} sqm · {sharePct}% {basisLabel})
                              </span>
                            </td>
                            <td style={ROW_DATA.numTotal}>{p.fmt(total)}</td>
                            <td style={priorStyle}></td>
                            {series.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
                          </tr>
                        );
                      })}
                      {renderFlowRow('Total IDC (allocated to assets)', idc.totalIdcPerPeriod, { bold: true })}
                    </>
                  )}
                  {!idc.capitalize && (
                    <tr>
                      <td colSpan={3 + N} style={{ ...ROW_DATA.name, fontStyle: 'italic', color: 'var(--color-warning, #92400e)' }}>
                        Capitalize=OFF — construction interest below is expensed to P&L Finance Cost instead of allocated to assets.
                      </td>
                    </tr>
                  )}
                  {renderFlowRow(
                    idc.capitalize
                      ? 'Memo: Total construction interest (accrual)'
                      : 'Total construction interest → P&L Finance Cost',
                    constructionInterest,
                  )}
                </tbody>
              </table>
            </div>

            {/* Routing: Sell → CoS via Inventory */}
            {idc.capitalize && sellRows.length > 0 && (
              <div style={{ marginTop: 'var(--sp-2)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', marginBottom: 4 }}>
                  Routed to CoS via Inventory (Sell / Sell+Manage — augments capex basis, unwinds via revenue recognition)
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={periodTbl}>
                    {colgroup}
                    {headerRow}
                    <tbody>
                      {sellRows.map((r) => {
                        const series = p.cropProject(r.idcPerPeriod);
                        const total = series.reduce((s, v) => s + v, 0);
                        const priorStyle: React.CSSProperties = { ...ROW_DATA.num, fontStyle: 'italic', color: 'var(--color-meta)' };
                        return (
                          <tr key={`sell_${r.assetId}`}>
                            <td style={ROW_DATA.name}>{r.assetName}</td>
                            <td style={ROW_DATA.numTotal}>{p.fmt(total)}</td>
                            <td style={priorStyle}></td>
                            {series.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
                          </tr>
                        );
                      })}
                      {renderFlowRow('Subtotal: Sell IDC → CoS', sellSubtotal, { bold: true })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Routing: Operate/Lease → Fixed Assets + D&A */}
            {idc.capitalize && opLeaseRows.length > 0 && (
              <div style={{ marginTop: 'var(--sp-2)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', marginBottom: 4 }}>
                  Routed to Fixed Assets → D&A (Operate / Lease — adds to depreciable basis at handover, straight-line over useful life)
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={periodTbl}>
                    {colgroup}
                    {headerRow}
                    <tbody>
                      {opLeaseRows.map((r) => {
                        const series = p.cropProject(r.idcPerPeriod);
                        const total = series.reduce((s, v) => s + v, 0);
                        const priorStyle: React.CSSProperties = { ...ROW_DATA.num, fontStyle: 'italic', color: 'var(--color-meta)' };
                        return (
                          <tr key={`op_${r.assetId}`}>
                            <td style={ROW_DATA.name}>{r.assetName} (Additions)</td>
                            <td style={ROW_DATA.numTotal}>{p.fmt(total)}</td>
                            <td style={priorStyle}></td>
                            {series.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
                          </tr>
                        );
                      })}
                      {renderFlowRow('Subtotal: Operate/Lease IDC → Fixed Assets', opLeaseSubtotal, { bold: true })}
                      {/* Lifecycle: depreciation per period + closing NBV */}
                      {renderFlowRow(
                        'Operate/Lease IDC Depreciation (charge to D&A)',
                        idc.idcDepreciationPerPeriod.map((v) => -v),
                        { negative: true },
                      )}
                      {renderStateRow(
                        'Operate/Lease IDC NBV (closing, sits on BS Fixed Assets)',
                        idc.idcNbvPerPeriod,
                        { bold: true },
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 'var(--sp-1)', fontStyle: 'italic' }}>
              Grand total {p.fmt(grandTotal)} allocated by {basisLabel.toLowerCase()}. Construction-active set drives per-period weights; stray IDC outside any construction window falls back to total-share split.
            </div>
          </section>
        );
      })()}

      <section style={sectionStyle}>
        <div style={TABLE_TITLE}>Equity Movement</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={periodTbl}>
            {colgroup}
            {headerRow}
            <tbody>
              {(() => {
                // M4 Pass 2U-Fix #2 (2026-05-24): existing equity is a
                // PRE-AXIS event. Move it to the prior-year column and
                // zero its axis entries, consistent with Capex Results
                // and the Module 4 surfaces.
                const cash   = p.result.equity.cashPerPeriod;
                const inKind = p.result.equity.inKindPerPeriod;
                const priorExisting = p.result.equity.totalExisting;
                // Axis cumulative for the equity roll-forward: opens at
                // prior-existing and accumulates only NEW cash + in-kind.
                const cumulative = new Array<number>(cash.length).fill(0);
                let running = priorExisting;
                for (let i = 0; i < cash.length; i++) {
                  running += (cash[i] ?? 0) + (inKind[i] ?? 0);
                  cumulative[i] = running;
                }
                const opening = openingSeries(cumulative, priorExisting);
                return (
                  <>
                    {renderStateRow('Opening (incl. existing carry-forward)', opening, { priorValue: 0 })}
                    {renderFlowRow('Cash Contribution', cash, { priorValue: 0 })}
                    {renderFlowRow('In-Kind Contribution', inKind, { priorValue: 0 })}
                    {priorExisting > 0
                      ? renderFlowRow('Existing Equity (pre-axis carry-forward)', new Array<number>(cash.length).fill(0), { priorValue: priorExisting })
                      : null}
                    {renderStateRow('Closing (cumulative equity)', cumulative, { bold: true, priorValue: priorExisting })}
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

// ── Funding Gap sub-tab (M4 Pass 2R, 2026-05-24) ──────────────────────

interface FundingGapProps {
  axis: ReturnType<typeof buildResultsPeriodAxis>;
  fmt: (n: number) => string;
  currency: string;
  cropProject: (arr: number[]) => number[];
}

function FundingGapView(p: FundingGapProps): React.JSX.Element {
  // Pull everything we need to compose the full financials snapshot,
  // then derive the funding gap. computeFinancialsSnapshot is memoised
  // by React via useMemo so this only re-runs when its inputs change.
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
      updatePhase: s.updatePhase,
    })),
  );
  const snap = useMemo(() => computeFinancialsSnapshot(state), [state]);
  const gap = useMemo(() => computeFundingGap(snap), [snap]);

  const N = p.axis.activeLabels.length;
  // M4 Pass 2U-Fix #2 (2026-05-24): add prior-year column.
  const nonLabelPct = nonLabelColumnPct(2 + N);
  const periodTbl = periodTableStyle(2 + N);
  const colgroup = (
    <colgroup>
      <col style={{ width: COLUMN_WIDTHS.label }} />
      <col style={{ width: nonLabelPct }} />
      <col style={{ width: nonLabelPct }} />
      {p.axis.activeLabels.map((_, i) => <col key={i} style={{ width: nonLabelPct }} />)}
    </colgroup>
  );
  const headerRow = (
    <thead>
      <tr>
        <th style={CELL_HEADER}>Line ({currencyHeaderLine(p.currency, 'full')})</th>
        <th style={CELL_HEADER_TOTAL}>Total</th>
        <th style={{ ...CELL_HEADER, fontStyle: 'italic', color: 'var(--color-meta)' }}>{p.axis.priorLabel}</th>
        {p.axis.activeLabels.map((l) => <th key={l} style={CELL_HEADER}>{l}</th>)}
      </tr>
    </thead>
  );

  const renderFlowRow = (label: string, arr: number[], opts?: { bold?: boolean; negative?: boolean; indent?: number; subtotal?: boolean; priorValue?: number }) => {
    const cropped = p.cropProject(arr);
    const total = cropped.reduce((s, v) => s + v, 0) + (opts?.priorValue ?? 0);
    const isBold = opts?.bold === true;
    const isSub = opts?.subtotal === true;
    const nameStyle: React.CSSProperties = {
      ...(isBold ? ROW_GRAND_TOTAL.name : isSub ? ROW_SUBTOTAL.name : ROW_DATA.name),
      paddingLeft: 8 + (opts?.indent ?? 0) * 12,
    };
    const numStyle = isBold ? ROW_GRAND_TOTAL.num : isSub ? ROW_SUBTOTAL.num : ROW_DATA.num;
    const totalStyle = isBold ? ROW_GRAND_TOTAL.numTotal : isSub ? ROW_SUBTOTAL.numTotal : ROW_DATA.numTotal;
    const applyRed = opts?.negative && !isBold;
    const numApplied: React.CSSProperties = applyRed ? { ...numStyle, color: 'var(--color-danger, #b91c1c)' } : numStyle;
    const totalApplied: React.CSSProperties = applyRed ? { ...totalStyle, color: 'var(--color-danger, #b91c1c)' } : totalStyle;
    const priorStyle: React.CSSProperties = { ...numApplied, fontStyle: 'italic', color: applyRed ? 'var(--color-danger, #b91c1c)' : 'var(--color-meta)' };
    const renderVal = (v: number) => p.fmt(v);
    return (
      <tr>
        <td style={nameStyle}>{label}</td>
        <td style={totalApplied}>{renderVal(total)}</td>
        <td style={priorStyle}>{opts?.priorValue !== undefined ? renderVal(opts.priorValue) : ''}</td>
        {cropped.map((v, i) => <td key={i} style={numApplied}>{renderVal(v)}</td>)}
      </tr>
    );
  };
  const renderStateRow = (label: string, arr: number[], opts?: { bold?: boolean; subtotal?: boolean; priorValue?: number }) => {
    const cropped = p.cropProject(arr);
    const isBold = opts?.bold === true;
    const isSub = opts?.subtotal === true;
    const nameStyle = isBold ? ROW_GRAND_TOTAL.name : isSub ? ROW_SUBTOTAL.name : ROW_DATA.name;
    const numStyle = isBold ? ROW_GRAND_TOTAL.num : isSub ? ROW_SUBTOTAL.num : ROW_DATA.num;
    const totalStyle = isBold ? ROW_GRAND_TOTAL.numTotal : isSub ? ROW_SUBTOTAL.numTotal : ROW_DATA.numTotal;
    const priorStyle: React.CSSProperties = { ...numStyle, fontStyle: 'italic', color: 'var(--color-meta)' };
    return (
      <tr>
        <td style={nameStyle}>{label}</td>
        <td style={totalStyle}>{p.fmt(cropped[N - 1] ?? 0)}</td>
        <td style={priorStyle}>{opts?.priorValue !== undefined ? p.fmt(opts.priorValue) : ''}</td>
        {cropped.map((v, i) => <td key={i} style={numStyle}>{p.fmt(v)}</td>)}
      </tr>
    );
  };

  return (
    <>
      <section style={{ ...sectionStyle, padding: 'var(--sp-1) var(--sp-2)' }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          <strong style={{ color: 'var(--color-heading)' }}>Funding Gap.</strong> Two sizing views aligned with the Funding Method dropdown in Inputs: <strong>Method 2 — Net Funding Requirement</strong> (Capex vs Pre-Sales gross feasibility) and <strong>Method 3 — Cash Deficit Funding</strong> (full per-period waterfall ending with Net Cash Required). Wiring these into actual debt drawdown sizing lands in a follow-up pass.
        </div>
      </section>

      {/* Method 2 — Net Funding Requirement (Capex vs Pre-Sales waterfall) */}
      <section style={sectionStyle}>
        <div style={TABLE_TITLE}>Method 2 — Net Funding Requirement (Capex vs Pre-Sales)</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6, fontStyle: 'italic' }}>
          Gap = MAX(0, Capex<sub>t</sub> − Pre-Sales net<sub>t−1</sub>). Pre-Sales are <strong>lagged one year</strong> — this year's capex is funded from LAST year's collected pre-sales (we don't receive on Day 1 of the year). Pre-Sales net = Gross − Inaccessible funds locked (escrow held) + Release of inaccessible funds. Floored at 0: a surplus in one period doesn't reduce next period's funding line. Surplus carry-over is captured in Method B.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={periodTbl}>
            {colgroup}
            {headerRow}
            <tbody>
              {renderFlowRow('Total project capex (excl land in-kind)', gap.capexPerPeriod, { subtotal: true })}
              {renderFlowRow('Advance received from customer (gross)', gap.preSalesGrossPerPeriod)}
              {renderFlowRow('  Less: Inaccessible funds locked (escrow held)', gap.escrowHeldPerPeriod.map((v) => -v), { negative: true, indent: 1 })}
              {renderFlowRow('  Add: Release of inaccessible funds (escrow release)', gap.escrowReleasePerPeriod, { indent: 1 })}
              {renderFlowRow('Advance received from customer (net)', gap.preSalesNetPerPeriod, { subtotal: true })}
              {renderFlowRow('Funding requirement fulfilled by pre-sales (LAST year, capped at capex)', gap.fulfilledByPreSalesPerPeriod)}
              {renderFlowRow('Funding gap = MAX(Capex_t − Pre-Sales net_{t−1}, 0)', gap.methodAGapPerPeriod, { bold: true })}
              {renderStateRow('Cumulative Funding Gap (A)', gap.methodAGapCumulative, { subtotal: true })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
          Grand total gap (A): <strong style={{ color: 'var(--color-heading)' }}>{p.fmt(gap.methodATotalGap)}</strong>
        </div>
      </section>

      {/* M4 Pass 2V (2026-05-24): consolidated Cash Sweep & Dividend
          Waterfall. Replaces the prior separate Method 3 + Cash Sweep +
          Dividend Schedule tables with one comprehensive waterfall
          matching the user's reference model. Per-tranche post-sweep
          outstanding stays below as a supporting view. */}
      {(() => {
        const w = gap.method3Waterfall;
        const sweep = snap.cashSweep;
        const div = snap.dividends;
        const debtPct = (snap.financing.funding.debtPct ?? 0) / 100;
        const equityPct = (snap.financing.funding.equityPct ?? 0) / 100;
        const idcAdd = w.idcDrawdownPerPeriod;
        const debtSplit = w.netCashRequiredPerPeriod.map((v) => v * debtPct);
        const equitySplit = w.netCashRequiredPerPeriod.map((v) => v * equityPct);
        const totalNewDebt = debtSplit.map((v, i) => v + (idcAdd[i] ?? 0));
        // Post-sweep cash available for dividend = cash sweep's
        // adjustedClosingCash + after-sweep dividends (since those are
        // already taken out in adjusted closing).
        const postSweepCashBeforeAfterDiv = sweep.adjustedClosingCash.map(
          (v, i) => v + div.afterSweepPhases.reduce((s, r) => s + (r.dividendsPerPeriod[i] ?? 0), 0),
        );
        return (
          <section style={sectionStyle}>
            <div style={TABLE_TITLE}>Cash Sweep &amp; Dividend Waterfall (Method 3 + Sweep + Dividend, consolidated)</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6, fontStyle: 'italic' }}>
              Per-period waterfall ending with Closing Cash. Order: Opening + Ops + Inv + financing inflows − financing outflows − Phase-1 (before-sweep) dividends = Cash Available. − Min Cash floor ({p.fmt(w.minCashReserve)}) = Cash for Debt+Dividend. − Cash Sweep on debt = Cash for Dividend. − After-sweep dividends = Closing Cash. Existing equity + existing debt opening are pre-axis (in the prior column), already reflected in opening cash. The Net Cash Required block at the bottom shows what NEW funding is implied if Cash Available was negative before reaching min cash.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={periodTbl}>
                {colgroup}
                {headerRow}
                <tbody>
                  {/* INFLOWS / OUTFLOWS section */}
                  <tr><td colSpan={3 + N} style={{ ...ROW_SUBTOTAL.name, fontStyle: 'italic' }}>Cash Available for Debt Repayment</td></tr>
                  {renderStateRow('Opening Cash', w.openingCashPerPeriod, { priorValue: snap.bs.historicalOpeningCashTotal })}
                  {renderFlowRow('(+) Cash from Operations', w.cashFromOpsPerPeriod, { priorValue: 0 })}
                  {renderFlowRow('(+) Cash from Investments', w.cashFromInvPerPeriod, { negative: true, priorValue: -snap.financing.existing.preCapexTotal })}
                  {renderFlowRow('(+) Equity Drawdown (Cash)', snap.directCF.equityDrawdownPerPeriod, { priorValue: snap.financing.existing.equityTotal })}
                  {(() => {
                    // Existing debt opening shown in prior column; in-axis draws follow.
                    const existingOpening = (() => {
                      let s = 0;
                      for (const fac of snap.financing.facilities.values()) {
                        s += Math.max(0, fac.openingBalance ?? 0);
                      }
                      return s;
                    })();
                    return renderFlowRow('(+) Existing Debt Opening Balance', new Array<number>(N).fill(0), { priorValue: existingOpening });
                  })()}
                  {w.existingDebtRepaymentPerPeriod.some((v) => v !== 0) && renderFlowRow('(−) Existing Debt Repayment', w.existingDebtRepaymentPerPeriod, { negative: true, indent: 1, priorValue: 0 })}
                  {w.financeCostPaidPerPeriod.some((v) => v !== 0) && renderFlowRow('(−) Finance Cost Paid (cash)', w.financeCostPaidPerPeriod, { negative: true, indent: 1, priorValue: 0 })}
                  {w.dividendsBeforeSweepPerPeriod.some((v) => v !== 0) && renderFlowRow('(−) Phase 1 / Operational Dividend (before sweep)', w.dividendsBeforeSweepPerPeriod, { negative: true, indent: 1, priorValue: 0 })}
                  {renderFlowRow('Cash Available', w.cashAvailableBeforeNewDebtPerPeriod, { subtotal: true, priorValue: 0 })}
                  {renderFlowRow('(−) Minimum Cash Requirement', w.cashAvailableBeforeNewDebtPerPeriod.map(() => -w.minCashReserve), { negative: true })}
                  {renderFlowRow('Cash Available for Debt + Dividend Payment', w.cashAvailableBeforeNewDebtPerPeriod.map((v) => v - w.minCashReserve), { subtotal: true, priorValue: 0 })}

                  {/* CASH SWEEP section */}
                  {sweep.enabled && (
                    <>
                      <tr><td colSpan={3 + N} style={{ ...ROW_SUBTOTAL.name, fontStyle: 'italic' }}>Cash Sweep — Debt Repayment Priority</td></tr>
                      {sweep.eligibleTranches.map((row) => renderFlowRow(
                        `  (−) Sweep: ${row.trancheName} (priority ${row.priority}, from ${row.startingYear})`,
                        row.sweepPerPeriod.map((v) => -v),
                        { negative: true, indent: 1, priorValue: 0 },
                      ))}
                      {renderFlowRow('Total Cash Sweep Applied', sweep.totalSweepPerPeriod.map((v) => -v), { negative: true, bold: true, priorValue: 0 })}
                      {renderFlowRow('Cash Available for Dividend (post-sweep)', postSweepCashBeforeAfterDiv, { subtotal: true, priorValue: 0 })}
                    </>
                  )}

                  {/* DIVIDENDS (after sweep) section */}
                  {div.afterSweepPhases.length > 0 && (
                    <>
                      <tr><td colSpan={3 + N} style={{ ...ROW_SUBTOTAL.name, fontStyle: 'italic' }}>Dividends (after sweep, new phases)</td></tr>
                      {div.afterSweepPhases.map((row) => renderFlowRow(
                        `  (−) ${row.phaseName} dividend (${(row.payoutRatio * 100).toFixed(0)}% of cash avail, cap EBITDA ${p.fmt(row.totalPhaseEbitda)})`,
                        row.dividendsPerPeriod.map((v) => -v),
                        { negative: true, indent: 1, priorValue: 0 },
                      ))}
                    </>
                  )}
                  {div.enabled && renderFlowRow('Total Dividend Payment (Phase 1 + new phases)', div.totalDividendsPerPeriod.map((v) => -v), { negative: true, bold: true, priorValue: 0 })}
                  {renderStateRow('Closing Cash', snap.directCF.closingCashPerPeriod, { bold: true, priorValue: snap.bs.historicalOpeningCashTotal })}

                  {/* MEMO + Net Cash Required */}
                  {idcAdd.some((v) => v !== 0) && (
                    <tr><td colSpan={3 + N} style={{ ...ROW_SUBTOTAL.name, fontStyle: 'italic', color: 'var(--color-meta)' }}>Memo — IDC drawdown is debt-only (no cash; grows balance directly)</td></tr>
                  )}
                  {idcAdd.some((v) => v !== 0) && renderFlowRow('  (memo) IDC Drawdown — capitalised interest', idcAdd, { indent: 1, priorValue: 0 })}
                  {/* M4 Pass 2Y (2026-05-24): interest savings from sweep. */}
                  {sweep.enabled && sweep.totalInterestSavings > 0 && (
                    <>
                      <tr><td colSpan={3 + N} style={{ ...ROW_SUBTOTAL.name, fontStyle: 'italic', color: 'var(--color-meta)' }}>Memo — interest savings from cash sweep (paid on reduced post-sweep balance)</td></tr>
                      {renderFlowRow('  (memo) Interest Savings (informational; P&L still uses pre-sweep balance)', sweep.interestSavingsPerPeriod, { indent: 1, priorValue: 0 })}
                    </>
                  )}

                  {w.netCashRequiredPerPeriod.some((v) => v !== 0) && (
                    <>
                      <tr><td colSpan={3 + N} style={{ ...ROW_SUBTOTAL.name, fontStyle: 'italic' }}>Net Cash Required — implied NEW funding needed each period</td></tr>
                      {renderFlowRow('Net Cash Required (= max(0, MinCash − Cash Available))', w.netCashRequiredPerPeriod, { bold: true, priorValue: 0 })}
                      {renderFlowRow(`  of which: New Debt (${(debtPct * 100).toFixed(0)}%)`, debtSplit, { indent: 2, priorValue: 0 })}
                      {renderFlowRow(`  of which: New Equity (${(equityPct * 100).toFixed(0)}%)`, equitySplit, { indent: 2, priorValue: 0 })}
                      {idcAdd.some((v) => v !== 0) && renderFlowRow('(+) IDC Drawdown (debt-only, no cash)', idcAdd, { indent: 1, priorValue: 0 })}
                      {renderFlowRow('Total New Debt Required (cash + IDC)', totalNewDebt, { bold: true, priorValue: 0 })}
                      {renderFlowRow('Total New Equity Required', equitySplit, { bold: true, priorValue: 0 })}
                    </>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
              Lifetime totals: Net Cash Required <strong style={{ color: 'var(--color-heading)' }}>{p.fmt(w.totalNetCashRequired)}</strong>
              {sweep.enabled && <> · Cash Sweep applied <strong style={{ color: 'var(--color-heading)' }}>{p.fmt(sweep.totalSweep)}</strong></>}
              {div.enabled && <> · Dividend paid <strong style={{ color: 'var(--color-heading)' }}>{p.fmt(div.totalDividends)}</strong></>}
              . Funding ratio per project: <strong>{(snap.financing.funding.debtPct ?? 0).toFixed(0)}%</strong> debt / <strong>{(snap.financing.funding.equityPct ?? 0).toFixed(0)}%</strong> equity. IDC drawdown is debt-only.
            </div>
          </section>
        );
      })()}

      {/* Per-tranche outstanding after sweep — supporting detail */}
      {snap.cashSweep.enabled && (
        <section style={sectionStyle}>
          <div style={TABLE_TITLE}>Per-Tranche Outstanding (after sweep)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={periodTbl}>
              {colgroup}
              {headerRow}
              <tbody>
                {snap.cashSweep.eligibleTranches.map((row) => (
                  <React.Fragment key={`bal_${row.trancheId}`}>
                    {renderStateRow(`${row.trancheName} — Pre-sweep closing`, row.preSweepOutstanding, { priorValue: 0 })}
                    {renderStateRow(`${row.trancheName} — Post-sweep closing`, row.postSweepOutstanding, { subtotal: true, priorValue: 0 })}
                  </React.Fragment>
                ))}
                {renderStateRow('Project total debt outstanding (post-sweep)', snap.cashSweep.adjustedDebtOutstanding, { bold: true, priorValue: 0 })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* M4 Pass 2T (2026-05-24): Dividend Policy editor + schedule. */}
      <section style={sectionStyle}>
        <div style={TABLE_TITLE}>Dividend Policy — per Phase</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6, fontStyle: 'italic' }}>
          Dividend waterfall: (1) <strong>Before-sweep</strong> dividends pay first — typical for operational phases (Phase 1) already producing cash. (2) <strong>Cash Sweep</strong> on debt. (3) <strong>After-sweep</strong> dividends — typical for new construction phases (debt repays first). Each step respects the project minimum cash reserve.
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Phase</th>
              <th style={CELL_HEADER}>Status</th>
              <th style={CELL_HEADER}>Waterfall Position</th>
              <th style={CELL_HEADER}>Enable Dividend</th>
              <th style={CELL_HEADER}>Start Year</th>
              <th style={CELL_HEADER}>Payout Ratio</th>
              <th style={CELL_HEADER}>Basis</th>
            </tr>
          </thead>
          <tbody>
            {state.phases.map((ph) => {
              const pol = ph.dividendPolicy ?? {};
              const enabled = pol.enabled === true;
              const projStart = snap.projectStartYear;
              const phaseStartYear = ph.startDate ? new Date(ph.startDate).getUTCFullYear() : projStart;
              const cp = Math.max(0, ph.constructionPeriods ?? 0);
              const defaultStart = ph.status === 'operational' ? projStart : phaseStartYear + cp;
              // Waterfall position is auto-assigned by status (M4 Pass 2U-Fix).
              const waterfallPos = ph.status === 'operational' ? 'Before sweep (Phase 1 first claim)' : 'After sweep (debt repays first)';
              const startingYear = pol.startingYear ?? defaultStart;
              const payoutRatio = pol.payoutRatio ?? 0;
              const updatePolicy = (patch: Partial<NonNullable<typeof ph.dividendPolicy>>) => {
                state.updatePhase(ph.id, { dividendPolicy: { ...(ph.dividendPolicy ?? {}), ...patch } });
              };
              const pillBtn = (active: boolean, label: string, onClick: () => void, key: string) => (
                <button
                  key={key}
                  type="button"
                  onClick={onClick}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${active ? 'var(--color-navy)' : 'var(--color-border)'}`,
                    background: active ? 'var(--color-navy)' : 'var(--color-surface)',
                    color: active ? 'var(--color-on-primary-navy)' : 'var(--color-heading)',
                    fontWeight: 600,
                    fontSize: 10,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              );
              return (
                <tr key={ph.id}>
                  <td style={ROW_DATA.name}>{ph.name}</td>
                  <td style={ROW_DATA.name}>{ph.status ?? 'planning'}</td>
                  <td style={{ ...ROW_DATA.name, fontStyle: 'italic', color: 'var(--color-text-muted)', fontSize: 11 }}>{waterfallPos}</td>
                  <td style={ROW_DATA.name}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {pillBtn(enabled, 'On', () => updatePolicy({ enabled: true }), 'on')}
                      {pillBtn(!enabled, 'Off', () => updatePolicy({ enabled: false }), 'off')}
                    </div>
                  </td>
                  <td style={ROW_DATA.name}>
                    <input
                      type="number"
                      value={startingYear}
                      onChange={(e) => updatePolicy({ startingYear: Math.max(1900, Number(e.target.value) || defaultStart) })}
                      style={{ ...inputStyle, width: 80 }}
                    />
                    <div style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>default {defaultStart}</div>
                  </td>
                  <td style={ROW_DATA.name}>
                    <PercentageInput
                      value={payoutRatio}
                      onChange={(v) => updatePolicy({ payoutRatio: v })}
                      style={{ ...inputStyle, width: 80 }}
                    />
                  </td>
                  <td style={ROW_DATA.name}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {pillBtn((pol.mode ?? 'cash_above_min') === 'cash_above_min', 'Cash above min', () => updatePolicy({ mode: 'cash_above_min' }), 'm-cash')}
                      {pillBtn(pol.mode === 'pct_of_ebitda', '% of EBITDA', () => updatePolicy({ mode: 'pct_of_ebitda' }), 'm-ebitda')}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {(pol.mode ?? 'cash_above_min') === 'pct_of_ebitda' ? 'payout % of EBITDA (gated by cash)' : 'payout % of cash above min reserve'}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Dividend per-phase EBITDA cap detail (supporting view; main
          waterfall already shows the dividend line per phase). */}
      {snap.dividends.enabled && (
        <section style={sectionStyle}>
          <div style={TABLE_TITLE}>Dividend Detail — per Phase EBITDA Cap</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6, fontStyle: 'italic' }}>
            Per phase EBITDA (Revenue − CoS − Opex, before D&A / interest / tax) caps cumulative dividends. Shows the EBITDA budget, cash available at the time of dividend, and resulting dividend per period.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={periodTbl}>
              {colgroup}
              {headerRow}
              <tbody>
                {[...snap.dividends.beforeSweepPhases, ...snap.dividends.afterSweepPhases].map((row) => (
                  <React.Fragment key={`detail_${row.phaseId}`}>
                    <tr><td colSpan={3 + N} style={{ ...ROW_SUBTOTAL.name, fontStyle: 'italic' }}>{row.phaseName} ({row.priority === 'before_sweep' ? 'before sweep' : 'after sweep'})</td></tr>
                    {renderFlowRow(`  ${row.phaseName} EBITDA (cap source, cum. cap ${p.fmt(row.totalPhaseEbitda)})`, row.phaseEbitdaPerPeriod, { indent: 1, subtotal: true, priorValue: 0 })}
                    {renderFlowRow(`  Cash available for dividend (${row.priority === 'before_sweep' ? 'above min reserve' : 'after debt sweep'})`, row.cashAvailableForDividendPerPeriod, { indent: 1, priorValue: 0 })}
                    {renderFlowRow(`  Dividend = MIN(EBITDA budget, ${row.mode === 'pct_of_ebitda' ? `cash, EBITDA × ${(row.payoutRatio * 100).toFixed(0)}%` : `cash × ${(row.payoutRatio * 100).toFixed(0)}%`})`, row.dividendsPerPeriod, { indent: 1, subtotal: true, priorValue: 0 })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
            Grand total dividends: <strong style={{ color: 'var(--color-heading)' }}>{p.fmt(snap.dividends.totalDividends)}</strong>.
          </div>
        </section>
      )}
    </>
  );
}
