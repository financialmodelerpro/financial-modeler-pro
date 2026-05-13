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
import { CELL_HEADER, TABLE_TITLE, COLUMN_WIDTHS, nonLabelColumnPct, ROW_DATA, ROW_GRAND_TOTAL } from './_shared/tableStyles';
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
    updateFinancingTranche, removeFinancingTranche,
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
          <section style={sectionStyle}>
            <div style={sectionTitle}>1. Project Financing Settings</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Minimum Cash Reserve</label>
              <div style={{ width: 180 }}>
                <AccountingNumberInput
                  value={financingConfig.minimumCashReserve ?? 0}
                  onChange={(v) => setFinancingConfigPatch({ minimumCashReserve: v })}
                />
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <div style={sectionTitle}>2. Funding Method</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
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
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Equity %</label>
                  <PercentageInput
                    value={financingConfig.fixedRatio?.equityPct ?? 30}
                    onChange={(v) => setFinancingConfigPatch({
                      fixedRatio: { equityPct: v, debtPct: Math.max(0, 100 - v) },
                    })}
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

          {(() => {
            const totalCapex = result.capex.totals.exclLandInKind;
            const fundingNeed = result.funding.selected;
            const drawdownBasis = FUNDING_METHOD_DESCRIPTIONS[financingConfig.fundingMethod];
            const totalDebt   = result.debtEquitySplit.debt.reduce((s, v) => s + v, 0);
            const totalEquity = result.debtEquitySplit.equity.reduce((s, v) => s + v, 0);
            const sources = totalDebt + totalEquity;
            const sourcesUsesOk = Math.abs(sources - totalCapex) < 1;
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
                      : `Sources vs Uses: Gap ${fmt(sources - totalCapex)}`}
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
                            onChange={(v) => setParcelFundingPatch(p.id, { debtPct: v, equityPct: Math.max(0, 100 - v) })}
                          />
                        </td>
                        <td style={ROW_DATA.num}>
                          <PercentageInput
                            value={equityPct}
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
            onAdd={() => {
              const id = `fin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
              const newT = makeDefaultFinancingTranche(id, phases[0]?.id ?? '');
              addFinancingTranche(newT);
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
  phases: Array<{ id: string; name: string }>;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<FinancingTranche>) => void;
  onRemove: (id: string) => void;
  onSet: (tranches: FinancingTranche[]) => void;
}

function FacilitiesSection(props: FacilitiesSectionProps): React.JSX.Element {
  const { tranches, shares, phases, onAdd, onUpdate, onRemove, onSet } = props;
  const handleShareChange = (id: string, raw: number) => {
    const next = tranches.map((t) => (t.id === id ? { ...t, facilitySharePct: raw } : t));
    onSet(next);
  };
  return (
    <section style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={sectionTitle}>5. Debt Facilities</div>
        <button
          type="button"
          onClick={onAdd}
          style={{
            padding: '4px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-navy)',
            color: 'var(--color-on-primary-navy)',
            border: 'none',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          + Add Facility
        </button>
      </div>
      {tranches.length === 0 && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 8 }}>
          No facilities yet. Add one to begin.
        </div>
      )}
      {tranches.map((t) => {
        const normalisedShare = shares.get(t.id) ?? 0;
        const isExisting = t.origin === 'existing';
        return (
          <div
            key={t.id}
            style={{
              border: isExisting ? '1px solid var(--color-warning, #92400e)' : '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--sp-2)',
              marginTop: 'var(--sp-1)',
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 1fr) auto',
              gap: 8,
              alignItems: 'end',
              background: isExisting ? 'color-mix(in srgb, var(--color-warning, #92400e) 6%, transparent)' : undefined,
            }}
          >
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Name</label>
              <input
                type="text"
                value={t.name}
                onChange={(e) => onUpdate(t.id, { name: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Origin</label>
              <select
                value={t.origin ?? 'new'}
                onChange={(e) => onUpdate(t.id, { origin: e.target.value as 'new' | 'existing' })}
                style={inputStyle}
              >
                <option value="new">New</option>
                <option value="existing">Existing</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Phase</label>
              <select
                value={t.phaseId}
                onChange={(e) => onUpdate(t.id, { phaseId: e.target.value })}
                style={inputStyle}
              >
                {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Interest Rate %</label>
              <PercentageInput
                value={t.interestRatePct}
                onChange={(v) => onUpdate(t.id, { interestRatePct: v })}
              />
            </div>
            {isExisting ? (
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Opening Balance</label>
                <AccountingNumberInput
                  value={t.openingBalance ?? 0}
                  onChange={(v) => onUpdate(t.id, { openingBalance: Math.max(0, v) })}
                />
              </div>
            ) : (
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Share %</label>
                <PercentageInput
                  value={t.facilitySharePct ?? normalisedShare}
                  onChange={(v) => handleShareChange(t.id, v)}
                />
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  Normalised: {normalisedShare.toFixed(2)}%
                </div>
              </div>
            )}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Repayment</label>
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {!isExisting && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Grace</label>
                  <input
                    type="number"
                    value={t.gracePeriods ?? 0}
                    onChange={(e) => onUpdate(t.id, { gracePeriods: Math.max(0, Number(e.target.value) || 0) })}
                    style={inputStyle}
                  />
                </div>
              )}
              <div style={{ gridColumn: isExisting ? 'span 2' : undefined }}>
                <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  {isExisting ? 'Remaining Repay Periods' : 'Repay Periods'}
                </label>
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
        );
      })}
    </section>
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
              <th style={CELL_HEADER}>Total</th>
              {p.axis.activeLabels.map((l) => <th key={l} style={CELL_HEADER}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={ROW_DATA.name}>Capex (excluding Land)</td>
              <td style={ROW_DATA.num}>{p.fmt(p.capex.totals.exclAllLand)}</td>
              {exclLand.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={ROW_DATA.name}>Land Cash Value</td>
              <td style={ROW_DATA.num}>{p.fmt(p.capex.totals.exclLandInKind - p.capex.totals.exclAllLand)}</td>
              {landCash.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={ROW_GRAND_TOTAL.name}>Total Capex Incl Cash Land</td>
              <td style={ROW_GRAND_TOTAL.num}>{p.fmt(p.capex.totals.exclLandInKind)}</td>
              {totalIncl.map((v, i) => <td key={i} style={ROW_GRAND_TOTAL.num}>{p.fmt(v)}</td>)}
            </tr>
            {p.existingPreCapex > 0 && (
              <tr>
                <td style={ROW_DATA.name}>Pre-Capex (existing operations)</td>
                <td style={ROW_DATA.num}>{p.fmt(p.existingPreCapex)}</td>
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
              <th style={CELL_HEADER}>Total</th>
              {p.axis.activeLabels.map((l) => <th key={l} style={CELL_HEADER}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={ROW_DATA.name}>Method 1, Fixed Debt-to-Equity Ratio</td>
              <td style={ROW_DATA.num}>{p.fmt(p.funding.method1)}</td>
              {m1PerPeriod.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={{ ...ROW_DATA.name, color: 'var(--color-text-muted)' }}>Method 2, Net Funding Requirement</td>
              <td style={{ ...ROW_DATA.num, color: 'var(--color-text-muted)' }}>,</td>
              {blanks.map((_, i) => <td key={i} style={{ ...ROW_DATA.num, color: 'var(--color-text-muted)' }}>,</td>)}
            </tr>
            <tr>
              <td style={{ ...ROW_DATA.name, color: 'var(--color-text-muted)' }}>Method 3, Cash Deficit Funding</td>
              <td style={{ ...ROW_DATA.num, color: 'var(--color-text-muted)' }}>,</td>
              {blanks.map((_, i) => <td key={i} style={{ ...ROW_DATA.num, color: 'var(--color-text-muted)' }}>,</td>)}
            </tr>
            <tr>
              <td style={ROW_GRAND_TOTAL.name}>Selected (Method {selectedMethodId})</td>
              <td style={ROW_GRAND_TOTAL.num}>{p.fmt(p.funding.selected)}</td>
              {(selectedMethodId === 1 ? m1PerPeriod : blanks).map((v, i) => (
                <td key={i} style={ROW_GRAND_TOTAL.num}>{selectedMethodId === 1 ? p.fmt(v) : ','}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 'var(--sp-1)' }}>
        Methods 2 and 3 land once Module 2 Revenue and Module 4 Financial Statements ship.
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
  const totalNewDebtByPeriod = p.cropProject(p.split.debt);
  const totalNewDebt = totalNewDebtByPeriod.reduce((s, v) => s + v, 0);
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
              <th style={CELL_HEADER}>Total</th>
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
                  <td style={ROW_DATA.num}>{p.fmt(total)}</td>
                  {series.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
                </tr>
              );
            })}
            <tr>
              <td style={ROW_GRAND_TOTAL.name}>Total Debt Required</td>
              <td style={ROW_GRAND_TOTAL.num}>{p.fmt(totalNewDebt)}</td>
              {totalNewDebtByPeriod.map((v, i) => <td key={i} style={ROW_GRAND_TOTAL.num}>{p.fmt(v)}</td>)}
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
              <th style={CELL_HEADER}>Total</th>
              {p.axis.activeLabels.map((l) => <th key={l} style={CELL_HEADER}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {p.equity.totalExisting > 0 && (
              <tr>
                <td style={ROW_DATA.name}>Existing Equity (operational phases)</td>
                <td style={ROW_DATA.num}>{p.fmt(p.equity.totalExisting)}</td>
                {existing.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
              </tr>
            )}
            <tr>
              <td style={ROW_DATA.name}>Cash Equity</td>
              <td style={ROW_DATA.num}>{p.fmt(p.equity.totalCash)}</td>
              {cash.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={ROW_DATA.name}>In-Kind Equity</td>
              <td style={ROW_DATA.num}>{p.fmt(p.equity.totalInKind)}</td>
              {inKind.map((v, i) => <td key={i} style={ROW_DATA.num}>{p.fmt(v)}</td>)}
            </tr>
            <tr>
              <td style={ROW_GRAND_TOTAL.name}>Total Equity Required</td>
              <td style={ROW_GRAND_TOTAL.num}>{p.fmt(p.equity.grandTotal)}</td>
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
        <th style={CELL_HEADER}>Total</th>
        {p.axis.activeLabels.map((l) => <th key={l} style={CELL_HEADER}>{l}</th>)}
      </tr>
    </thead>
  );

  // Flow row (additive, total = sum of all periods).
  const renderFlowRow = (label: string, arr: number[], opts?: { bold?: boolean }) => {
    const cropped = p.cropProject(arr);
    const total = cropped.reduce((s, v) => s + v, 0);
    const nameStyle = opts?.bold ? ROW_GRAND_TOTAL.name : ROW_DATA.name;
    const numStyle  = opts?.bold ? ROW_GRAND_TOTAL.num  : ROW_DATA.num;
    return (
      <tr>
        <td style={nameStyle}>{label}</td>
        <td style={numStyle}>{p.fmt(total)}</td>
        {cropped.map((v, i) => <td key={i} style={numStyle}>{p.fmt(v)}</td>)}
      </tr>
    );
  };

  // State row (point-in-time, no Total).
  const renderStateRow = (label: string, arr: number[], opts?: { bold?: boolean }) => {
    const cropped = p.cropProject(arr);
    const nameStyle = opts?.bold ? ROW_GRAND_TOTAL.name : ROW_DATA.name;
    const numStyle  = opts?.bold ? ROW_GRAND_TOTAL.num  : ROW_DATA.num;
    return (
      <tr>
        <td style={nameStyle}>{label}</td>
        <td style={numStyle}>{p.fmt(cropped[N - 1] ?? 0)}</td>
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

  const existingTranches = p.tranches.filter((t) => t.origin === 'existing');
  const newTranches      = p.tranches.filter((t) => t.origin !== 'existing');

  return (
    <>
      {existingTranches.map((t) => {
        const r = p.result.facilities.get(t.id);
        if (!r) return null;
        const opening = openingSeries(r.outstanding, Math.max(0, t.openingBalance ?? 0));
        return (
          <section key={`ex_${t.id}`} style={{ ...sectionStyle, borderColor: 'var(--color-warning, #92400e)' }}>
            <div style={TABLE_TITLE}>Existing Debt Movement, {t.name}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                {colgroup}
                {headerRow}
                <tbody>
                  {renderStateRow('Opening', opening)}
                  {renderFlowRow('Drawdown', r.drawSchedule)}
                  {renderFlowRow('Interest Capitalized', r.interestCapitalized)}
                  {renderFlowRow('Principal Repaid', r.principalRepaid)}
                  {renderStateRow('Closing', r.outstanding, { bold: true })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {newTranches.map((t) => {
        const r = p.result.facilities.get(t.id);
        if (!r) return null;
        const opening = openingSeries(r.outstanding, 0);
        return (
          <section key={t.id} style={sectionStyle}>
            <div style={TABLE_TITLE}>New Debt Movement, {t.name}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                {colgroup}
                {headerRow}
                <tbody>
                  {renderStateRow('Opening', opening)}
                  {renderFlowRow('Drawdown', r.drawSchedule)}
                  {renderFlowRow('Interest Capitalized', r.interestCapitalized)}
                  {renderFlowRow('Principal Repaid', r.principalRepaid)}
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
              {renderFlowRow('Total Drawdown', p.result.combined.totalDrawdown)}
              {renderFlowRow('Total Interest Accrued', p.result.combined.totalInterestAccrued)}
              {renderFlowRow('Total Interest Capitalized', p.result.combined.totalInterestCapitalized)}
              {renderFlowRow('Total Interest Expensed', p.result.combined.totalInterestExpensed)}
              {renderFlowRow('Total Principal Repaid', p.result.combined.totalPrincipalRepaid)}
              {renderFlowRow('Total Debt Service (Cash)', p.result.combined.debtServiceCash, { bold: true })}
            </tbody>
          </table>
        </div>
      </section>

      {p.tranches.map((t) => {
        const r = p.result.facilities.get(t.id);
        if (!r) return null;
        const isEx = t.origin === 'existing';
        const paidArr = r.interestPaid.map((v, i) => v + (r.interestCapitalized[i] ?? 0));
        return (
          <section key={`fc_${t.id}`} style={sectionStyle}>
            <div style={TABLE_TITLE}>Finance Cost, {t.name} ({isEx ? 'existing' : 'new'})</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                {colgroup}
                {headerRow}
                <tbody>
                  {renderFlowRow('Charge (Accrued)', r.interestAccrued)}
                  {renderFlowRow('Capitalized', r.interestCapitalized)}
                  {renderFlowRow('Expensed', r.interestPaid)}
                  {renderFlowRow('Paid (Capitalized + Expensed)', paidArr, { bold: true })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

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
              let grandCap = 0, grandExp = 0;
              const rows = p.tranches.map((t) => {
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
