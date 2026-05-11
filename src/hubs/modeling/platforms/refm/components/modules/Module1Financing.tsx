'use client';

/**
 * Module1Financing.tsx (v8 schema, M2.0L rebuild — 2026-05-11)
 *
 * Two sub-tabs: Inputs + Schedules.
 *
 *   Inputs:
 *     - Capital Structure Overview cards (sources / uses / LTV / match)
 *     - Equity Tranches section (cash / in-kind / JV + IRR hurdle +
 *       preferred return + auto-detect-from-Land-In-Kind)
 *     - Debt Facilities section (multi-facility, 9 drawdown methods, 9
 *       repayment methods, 3 IDC treatments, fees, covenants,
 *       prepayments, PIK)
 *
 *   Schedules:
 *     - Filter pill bar: Combined + per-facility
 *     - Granularity toggle: Annual / Quarterly / Monthly
 *     - 6 tables: Capital Stack Summary, Drawdown per facility,
 *       Repayment per facility, Combined Debt Service, IDC Summary,
 *       Capital Stack Movement
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import {
  type FinancingTranche,
  type DrawdownMethod,
  type RepaymentMethod,
  type EquityContribution,
  type EquityTrancheType,
  type FacilityType,
  type InterestRateType,
  type BaseRate,
  type IDCTreatment,
  type FeeTreatment,
  type OutputGranularity,
  DRAWDOWN_METHODS,
  DRAWDOWN_METHOD_LABELS,
  REPAYMENT_METHODS,
  REPAYMENT_METHOD_LABELS,
  EQUITY_TIMINGS,
  EQUITY_TRANCHE_TYPES,
  EQUITY_TRANCHE_TYPE_LABELS,
  FACILITY_TYPES,
  FACILITY_TYPE_LABELS,
  BASE_RATES,
  BASE_RATE_LABELS,
  IDC_TREATMENTS,
  IDC_TREATMENT_LABELS,
  FEE_TREATMENTS,
  FEE_TREATMENT_LABELS,
  OUTPUT_GRANULARITIES,
  OUTPUT_GRANULARITY_LABELS,
  makeDefaultFinancingTranche,
} from '../../lib/state/module1-types';
import {
  computePhaseCost,
  computeFinancing,
  resolveAssetAreaMetrics,
  computeCapitalStack,
  computeIdcSummary,
  computeCombinedDebtService,
  applyIdcToCapex,
  distributeAnnualToPeriods,
  type FinancingResult,
} from '@/src/core/calculations';
import { currencyHeaderLine, formatScaled, type DisplayDecimals as DisplayDecimalsT } from '@/src/core/formatters';
import type { DisplayScale } from '../../lib/state/module1-types';

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

const calcOutputStyle: React.CSSProperties = {
  background: 'var(--color-grey-pale)',
  color: 'var(--color-heading)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 6px',
  fontSize: 12,
  fontWeight: 600,
};

const sectionCardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: 'var(--sp-2)',
  marginBottom: 'var(--sp-2)',
};

function getPeriodLabel(idx: number, projectStart: string, modelType: 'monthly' | 'annual'): string {
  if (idx === 0) return 'Y0';
  const d = new Date(projectStart);
  if (Number.isNaN(d.getTime())) return modelType === 'annual' ? `Y${idx}` : `M${idx}`;
  if (modelType === 'annual') {
    const year = d.getUTCFullYear() + idx - 1;
    return `Dec ${String(year).slice(-2)}`;
  }
  const startMonthIdx = d.getUTCFullYear() * 12 + d.getUTCMonth();
  const targetMonthIdx = startMonthIdx + (idx - 1);
  const targetDate = new Date(Date.UTC(Math.floor(targetMonthIdx / 12), targetMonthIdx % 12, 1));
  return targetDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

// ── Tranche editor (Inputs sub-tab) ───────────────────────────────────────
interface TrancheCardProps {
  tranche: FinancingTranche;
  phase: { id: string; name: string; constructionPeriods: number; operationsPeriods: number; overlapPeriods: number; constructionStart: number };
  capexPerPeriod: number[];
  presalesPerPeriod: number[];
  project: Parameters<typeof computeFinancing>[4];
  scale: DisplayScale;
  decimals: DisplayDecimalsT;
  onUpdate: (patch: Partial<FinancingTranche>) => void;
  onRemove: () => void;
  assets: Array<{ id: string; name: string }>;
}

function TrancheCard({
  tranche, phase, capexPerPeriod, presalesPerPeriod, project, scale, decimals,
  onUpdate, onRemove, assets,
}: TrancheCardProps): React.JSX.Element {
  const fmt = (n: number): string => formatScaled(n, scale, decimals);
  const result = useMemo(
    () => computeFinancing(tranche, phase, capexPerPeriod, presalesPerPeriod, project),
    [tranche, phase, capexPerPeriod, presalesPerPeriod, project],
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const idcTreatment: IDCTreatment = tranche.idcTreatment ?? (tranche.idcCapitalize ? 'capitalize' : 'expense');
  const interestRateType: InterestRateType = tranche.interestRateType ?? 'fixed';
  const facilityType: FacilityType = tranche.facilityType ?? 'senior_construction';

  return (
    <div style={sectionCardStyle} data-testid={`tranche-${tranche.id}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
          <input
            type="text"
            value={tranche.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            style={{ ...inputStyle, fontSize: 14, fontWeight: 700, maxWidth: 260 }}
            data-testid={`tranche-${tranche.id}-name`}
          />
          <select
            value={facilityType}
            onChange={(e) => onUpdate({ facilityType: e.target.value as FacilityType })}
            style={{ ...inputStyle, maxWidth: 220 }}
            data-testid={`tranche-${tranche.id}-facility-type`}
          >
            {FACILITY_TYPES.map((f) => (<option key={f} value={f}>{FACILITY_TYPE_LABELS[f]}</option>))}
          </select>
          <input
            type="text"
            placeholder="Lender (optional)"
            value={tranche.lender ?? ''}
            onChange={(e) => onUpdate({ lender: e.target.value || undefined })}
            style={{ ...inputStyle, maxWidth: 200 }}
            data-testid={`tranche-${tranche.id}-lender`}
          />
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={onRemove}
          style={{ fontSize: 11, padding: '4px 10px', color: 'var(--color-negative)' }}
          data-testid={`tranche-${tranche.id}-remove`}
        >
          Remove
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>LTV %</label>
          <input
            type="number" min={0} max={100}
            value={tranche.ltvPct}
            onChange={(e) => onUpdate({ ltvPct: parseFloat(e.target.value) || 0 })}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-ltv`}
          />
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Principal (abs.)</label>
          <input
            type="number" min={0}
            placeholder="0 = use LTV"
            value={tranche.principal ?? 0}
            onChange={(e) => {
              const v = parseFloat(e.target.value) || 0;
              onUpdate({ principal: v > 0 ? v : undefined });
            }}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-principal`}
          />
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Interest %</label>
          <input
            type="number" step={0.1}
            value={tranche.interestRatePct}
            onChange={(e) => onUpdate({ interestRatePct: parseFloat(e.target.value) || 0 })}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-rate`}
          />
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Rate Type</label>
          <select
            value={interestRateType}
            onChange={(e) => onUpdate({ interestRateType: e.target.value as InterestRateType })}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-rate-type`}
          >
            <option value="fixed">Fixed</option>
            <option value="floating">Floating</option>
          </select>
        </div>
      </div>

      {interestRateType === 'floating' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Base Rate</label>
            <select
              value={tranche.baseRate ?? 'saibor_3m'}
              onChange={(e) => onUpdate({ baseRate: e.target.value as BaseRate })}
              style={inputStyle}
              data-testid={`tranche-${tranche.id}-base-rate`}
            >
              {BASE_RATES.map((b) => (<option key={b} value={b}>{BASE_RATE_LABELS[b]}</option>))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Spread (bps)</label>
            <input
              type="number" min={0}
              value={tranche.spreadBps ?? 0}
              onChange={(e) => onUpdate({ spreadBps: parseFloat(e.target.value) || 0 })}
              style={inputStyle}
              data-testid={`tranche-${tranche.id}-spread`}
            />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Tenor (periods)</label>
          <input type="number" min={0} value={tranche.tenorPeriods ?? 0} onChange={(e) => onUpdate({ tenorPeriods: parseInt(e.target.value) || 0 })} style={inputStyle} data-testid={`tranche-${tranche.id}-tenor`} />
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Availability</label>
          <input type="number" min={0} value={tranche.availabilityPeriods ?? 0} onChange={(e) => onUpdate({ availabilityPeriods: parseInt(e.target.value) || 0 })} style={inputStyle} data-testid={`tranche-${tranche.id}-availability`} />
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Grace</label>
          <input type="number" min={0} value={tranche.gracePeriods ?? 0} onChange={(e) => onUpdate({ gracePeriods: parseInt(e.target.value) || 0 })} style={inputStyle} data-testid={`tranche-${tranche.id}-grace`} />
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Repayment Periods</label>
          <input
            type="number" min={0}
            value={tranche.repaymentPeriods}
            onChange={(e) => onUpdate({ repaymentPeriods: parseInt(e.target.value) || 0 })}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-rep-periods`}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Drawdown Method</label>
          <select
            value={tranche.drawdownMethod}
            onChange={(e) => onUpdate({ drawdownMethod: e.target.value as DrawdownMethod })}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-drawdown`}
          >
            {DRAWDOWN_METHODS.map((m) => (
              <option key={m} value={m}>{DRAWDOWN_METHOD_LABELS[m]}</option>
            ))}
          </select>
          {tranche.drawdownMethod === 'capex_minus_presales' && (
            <label style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <input
                type="checkbox"
                checked={tranche.drawdownIncludeLand !== false}
                onChange={(e) => onUpdate({ drawdownIncludeLand: e.target.checked })}
                data-testid={`tranche-${tranche.id}-include-land`}
              />
              Include land in capex base
            </label>
          )}
          {tranche.drawdownMethod === 'min_cash_floor' && (
            <input
              type="number" min={0}
              placeholder="Cash floor"
              value={tranche.drawdownMinCashFloor ?? 0}
              onChange={(e) => onUpdate({ drawdownMinCashFloor: parseFloat(e.target.value) || 0 })}
              style={{ ...inputStyle, marginTop: 4 }}
              data-testid={`tranche-${tranche.id}-cash-floor-drawdown`}
            />
          )}
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Repayment Method</label>
          <select
            value={tranche.repaymentMethod}
            onChange={(e) => onUpdate({ repaymentMethod: e.target.value as RepaymentMethod })}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-repayment`}
          >
            {REPAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{REPAYMENT_METHOD_LABELS[m]}</option>
            ))}
          </select>
          {tranche.repaymentMethod === 'cashsweep_from_period' && (
            <input
              type="number" min={0}
              placeholder="Sweep start period"
              value={tranche.sweepStartPeriod ?? 0}
              onChange={(e) => onUpdate({ sweepStartPeriod: parseInt(e.target.value) || 0 })}
              style={{ ...inputStyle, marginTop: 4 }}
              data-testid={`tranche-${tranche.id}-sweep-start`}
            />
          )}
          {tranche.repaymentMethod === 'cashsweep_min_cash' && (
            <input
              type="number" min={0}
              placeholder="Min cash floor"
              value={tranche.sweepMinCashFloor ?? 0}
              onChange={(e) => onUpdate({ sweepMinCashFloor: parseFloat(e.target.value) || 0 })}
              style={{ ...inputStyle, marginTop: 4 }}
              data-testid={`tranche-${tranche.id}-sweep-floor`}
            />
          )}
          {tranche.repaymentMethod === 'balloon' && (
            <input
              type="number" min={0} max={100}
              placeholder="Balloon % at maturity"
              value={tranche.balloonPct ?? 30}
              onChange={(e) => onUpdate({ balloonPct: parseFloat(e.target.value) || 0 })}
              style={{ ...inputStyle, marginTop: 4 }}
              data-testid={`tranche-${tranche.id}-balloon-pct`}
            />
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>IDC Treatment</label>
          <select
            value={idcTreatment}
            onChange={(e) => onUpdate({ idcTreatment: e.target.value as IDCTreatment, idcCapitalize: e.target.value === 'capitalize' })}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-idc-treatment`}
          >
            {IDC_TREATMENTS.map((t) => (<option key={t} value={t}>{IDC_TREATMENT_LABELS[t]}</option>))}
          </select>
          {idcTreatment === 'mixed' && (
            <input
              type="number" min={0}
              placeholder="Split period (last cap period)"
              value={tranche.idcMixedSplitPeriod ?? phase.constructionPeriods}
              onChange={(e) => onUpdate({ idcMixedSplitPeriod: parseInt(e.target.value) || 0 })}
              style={{ ...inputStyle, marginTop: 4 }}
              data-testid={`tranche-${tranche.id}-idc-mixed-split`}
            />
          )}
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Per-Asset Scope</label>
          <select
            value={tranche.assetId ?? ''}
            onChange={(e) => onUpdate({ assetId: e.target.value || undefined })}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-asset`}
          >
            <option value="">Phase-wide</option>
            {assets.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
            <input
              type="checkbox"
              checked={tranche.autoGenerateIdcCostLine !== false}
              onChange={(e) => onUpdate({ autoGenerateIdcCostLine: e.target.checked })}
              data-testid={`tranche-${tranche.id}-auto-idc`}
              style={{ marginRight: 6 }}
            />
            Auto cost line in Tab 3
          </label>
          <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2 }}>
            Generates read-only IDC capex line per asset (capitalize/mixed only).
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setAdvancedOpen((v) => !v)}
        data-testid={`tranche-${tranche.id}-advanced-toggle`}
        style={{
          fontSize: 11, padding: '4px 10px', background: 'transparent',
          color: 'var(--color-navy)', border: '1px dashed var(--color-border)',
          borderRadius: 4, cursor: 'pointer', marginBottom: 8,
        }}
      >
        {advancedOpen ? '▼ Hide advanced' : '▶ Advanced (fees, covenants, prepayments, PIK)'}
      </button>

      {advancedOpen && (
        <div style={{ background: 'var(--color-grey-pale)', padding: 8, borderRadius: 4, marginBottom: 8 }} data-testid={`tranche-${tranche.id}-advanced`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Upfront Fee %</label>
              <input type="number" step={0.1} min={0} value={tranche.upfrontFeePct ?? 0} onChange={(e) => onUpdate({ upfrontFeePct: parseFloat(e.target.value) || 0 })} style={inputStyle} data-testid={`tranche-${tranche.id}-upfront-fee`} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Upfront Fee Treatment</label>
              <select value={tranche.upfrontFeeTreatment ?? 'capitalize'} onChange={(e) => onUpdate({ upfrontFeeTreatment: e.target.value as FeeTreatment })} style={inputStyle} data-testid={`tranche-${tranche.id}-upfront-fee-treatment`}>
                {FEE_TREATMENTS.map((t) => (<option key={t} value={t}>{FEE_TREATMENT_LABELS[t]}</option>))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Commitment Fee % p.a.</label>
              <input type="number" step={0.01} min={0} value={tranche.commitmentFeePct ?? 0} onChange={(e) => onUpdate({ commitmentFeePct: parseFloat(e.target.value) || 0 })} style={inputStyle} data-testid={`tranche-${tranche.id}-commitment-fee`} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Sweep Ratio %</label>
              <input type="number" min={0} max={100} value={tranche.sweepRatio ?? 75} onChange={(e) => onUpdate({ sweepRatio: parseFloat(e.target.value) || 0 })} style={inputStyle} data-testid={`tranche-${tranche.id}-sweep-ratio`} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>DSCR Covenant</label>
              <input type="number" step={0.05} min={0} value={tranche.dscrCovenant ?? 0} onChange={(e) => onUpdate({ dscrCovenant: parseFloat(e.target.value) || 0 })} style={inputStyle} data-testid={`tranche-${tranche.id}-dscr-cov`} />
              <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2 }}>Breach alerts in M5.</div>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>LTV Covenant %</label>
              <input type="number" step={0.5} min={0} max={100} value={tranche.ltvCovenant ?? 0} onChange={(e) => onUpdate({ ltvCovenant: parseFloat(e.target.value) || 0 })} style={inputStyle} data-testid={`tranche-${tranche.id}-ltv-cov`} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
                <input type="checkbox" checked={tranche.pikEnabled === true} onChange={(e) => onUpdate({ pikEnabled: e.target.checked })} data-testid={`tranche-${tranche.id}-pik`} style={{ marginRight: 6 }} />
                PIK enabled (mezz)
              </label>
              <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2 }}>Payment-in-kind capitalised interest.</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
        <div style={calcOutputStyle}>
          <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>Total Debt Drawn</div>
          <div style={{ fontSize: 14, fontWeight: 700 }} data-testid={`tranche-${tranche.id}-total-debt`}>
            {fmt(result.totalDebt)}
          </div>
        </div>
        <div style={calcOutputStyle}>
          <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>Total Interest</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {fmt(result.totalInterest)}
          </div>
        </div>
        <div style={calcOutputStyle}>
          <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>Total Repayment</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {fmt(result.totalRepayment)}
          </div>
        </div>
        <div style={calcOutputStyle}>
          <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>Periodic Rate</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {(result.periodicRate * 100).toFixed(4)}%
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Schedules sub-tab table helper ────────────────────────────────────────
function ScheduleTable({
  title, columns, rows, dataTestid,
}: {
  title: string;
  columns: string[];
  rows: Array<{ label: string; values: number[]; bold?: boolean }>;
  dataTestid: string;
}): React.JSX.Element {
  return (
    <div style={sectionCardStyle} data-testid={dataTestid}>
      <strong style={{ fontSize: 13, display: 'block', marginBottom: 'var(--sp-1)' }}>{title}</strong>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={{ padding: '4px 6px', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description</th>
              {columns.map((c, i) => (<th key={i} style={{ padding: '4px 6px', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} style={{ fontWeight: r.bold ? 700 : 400, background: r.bold ? 'var(--color-grey-pale)' : 'transparent' }}>
                <td style={{ padding: '4px 6px' }}>{r.label}</td>
                {r.values.map((v, vi) => (<td key={vi} style={{ padding: '4px 6px', textAlign: 'right' }}>{v}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Module1Financing(): React.JSX.Element {
  const {
    project, phases, parcels, assets, subUnits,
    costLines, costOverrides,
    landAllocationMode,
    financingTranches, equityContributions,
    activePhaseId,
  } = useModule1Store(useShallow((s) => ({
    project: s.project,
    phases: s.phases,
    parcels: s.parcels,
    assets: s.assets,
    subUnits: s.subUnits,
    costLines: s.costLines,
    costOverrides: s.costOverrides,
    landAllocationMode: s.landAllocationMode,
    financingTranches: s.financingTranches,
    equityContributions: s.equityContributions,
    activePhaseId: s.activePhaseId,
  })));

  const setActivePhaseId = useModule1Store((s) => s.setActivePhaseId);
  const setProject = useModule1Store((s) => s.setProject);
  const addFinancingTranche = useModule1Store((s) => s.addFinancingTranche);
  const updateFinancingTranche = useModule1Store((s) => s.updateFinancingTranche);
  const removeFinancingTranche = useModule1Store((s) => s.removeFinancingTranche);
  const addEquityContribution = useModule1Store((s) => s.addEquityContribution);
  const updateEquityContribution = useModule1Store((s) => s.updateEquityContribution);
  const removeEquityContribution = useModule1Store((s) => s.removeEquityContribution);
  const addCostLine = useModule1Store((s) => s.addCostLine);
  const updateCostLine = useModule1Store((s) => s.updateCostLine);
  const removeCostLine = useModule1Store((s) => s.removeCostLine);

  // M2.0L: sub-tab state (Inputs / Schedules).
  const [subTab, setSubTab] = useState<'inputs' | 'schedules'>('inputs');
  // M2.0L: filter pill (Schedules sub-tab). null = Combined.
  const [scheduleFilter, setScheduleFilter] = useState<string | null>(null);

  const phase = phases.find((p) => p.id === activePhaseId) ?? phases[0];
  const phaseAssets = useMemo(
    () => assets.filter((a) => a.phaseId === phase?.id && a.visible),
    [assets, phase?.id],
  );

  // M2.0L: cross-tab integration — Land In-Kind auto-detection.
  // For every Land (In-Kind) cost line in this phase, ensure there's
  // a matching equity contribution (autoDetectedFromCostLine=true,
  // sourceCostLineId=line.id). Idempotent; removed when the cost line
  // is gone. Runs only on schema'd change in costLines + parcels.
  useEffect(() => {
    if (!phase) return;
    const phaseAssetsLocal = assets.filter((a) => a.phaseId === phase.id && a.visible);
    const totalInKind = phaseAssetsLocal.reduce((s, a) => {
      const m = resolveAssetAreaMetrics(a, project, parcels, phaseAssetsLocal, subUnits, landAllocationMode);
      return s + Math.max(0, m.inKindLandValue);
    }, 0);
    const expectedId = `equity-auto-inkind-${phase.id}`;
    const existing = equityContributions.find((e) => e.id === expectedId);
    if (totalInKind > 0 && !existing) {
      addEquityContribution({
        id: expectedId,
        phaseId: phase.id,
        name: 'Land In-Kind Contribution (auto)',
        amount: totalInKind,
        timing: 'upfront',
        type: 'in_kind',
        source: 'Landowner',
        autoDetectedFromCostLine: true,
        sourceCostLineId: 'land-inkind',
      });
    } else if (totalInKind > 0 && existing && Math.abs(existing.amount - totalInKind) > 1) {
      updateEquityContribution(expectedId, { amount: totalInKind });
    } else if (totalInKind <= 0 && existing && existing.autoDetectedFromCostLine) {
      removeEquityContribution(expectedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase?.id, parcels, costLines]);

  if (!phase) {
    return (
      <div style={{ padding: 'var(--sp-3)' }} data-testid="financing-empty">
        Add a phase first (Tab 1) before configuring financing.
      </div>
    );
  }

  const phaseCost = computePhaseCost(
    phase, project, costLines, costOverrides, parcels, assets, subUnits, landAllocationMode,
  );
  const capexPerPeriod = phaseCost.perPeriod;
  const presalesPerPeriod = new Array<number>(phase.constructionPeriods + phase.operationsPeriods - phase.overlapPeriods).fill(0);

  const phaseTranches = financingTranches.filter((t) => t.phaseId === phase.id);
  const phaseEquity = equityContributions.filter((e) => e.phaseId === phase.id);

  // Compute every facility's schedule once.
  const resultsMap = useMemo(() => {
    const map = new Map<string, FinancingResult>();
    for (const t of phaseTranches) {
      map.set(t.id, computeFinancing(t, phase, capexPerPeriod, presalesPerPeriod, project));
    }
    return map;
  }, [phaseTranches, phase, capexPerPeriod, presalesPerPeriod, project]);

  const stack = useMemo(
    () => computeCapitalStack(phaseTranches, phaseEquity, phaseCost.total),
    [phaseTranches, phaseEquity, phaseCost.total],
  );
  const idcSummary = useMemo(
    () => computeIdcSummary(phaseTranches, resultsMap),
    [phaseTranches, resultsMap],
  );
  const combined = useMemo(
    () => computeCombinedDebtService(resultsMap),
    [resultsMap],
  );

  // M2.0L: cross-tab IDC -> Tab 3 Costs auto-line sync. For every
  // facility with idcTreatment != 'expense' AND autoGenerateIdcCostLine
  // !== false, ensure a read-only cost line exists per asset for the
  // capitalised IDC. Removes orphans when facility is deleted or IDC
  // treatment changes to 'expense'.
  const phaseAssetsForIdc = useMemo(
    () => assets.filter((a) => a.phaseId === phase.id && a.visible),
    [assets, phase.id],
  );
  useEffect(() => {
    const seeds = applyIdcToCapex(phaseTranches, resultsMap, phaseAssetsForIdc, subUnits, phases);
    const desiredIds = new Set<string>();
    for (const seed of seeds) {
      for (const slice of seed.perAsset) {
        const lineId = `auto-idc__${seed.facilityId}__${slice.assetId}`;
        desiredIds.add(lineId);
        const existing = costLines.find((c) => c.id === lineId);
        if (!existing) {
          addCostLine({
            id: lineId,
            phaseId: seed.phaseId,
            name: `Auto: IDC from ${seed.facilityName}`,
            method: 'fixed',
            value: slice.amount,
            stage: 'soft',
            scope: 'indirect',
            allocationBasis: 'per_asset',
            startPeriod: slice.startPeriod,
            endPeriod: slice.endPeriod,
            phasing: 'even',
            isLocked: true,
            targetAssetId: slice.assetId,
          });
        } else if (Math.abs((existing.value ?? 0) - slice.amount) > 1) {
          updateCostLine(lineId, { value: slice.amount, name: `Auto: IDC from ${seed.facilityName}`, endPeriod: slice.endPeriod });
        }
      }
    }
    // Orphans: cost lines starting with `auto-idc__` whose facility no
    // longer matches a desired id => remove.
    for (const c of costLines) {
      if (!c.id.startsWith('auto-idc__')) continue;
      if (c.phaseId !== phase.id) continue;
      if (!desiredIds.has(c.id)) {
        removeCostLine(c.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.id, phaseTranches, resultsMap]);

  const scale: DisplayScale = project.displayScale ?? 'full';
  const decimals: DisplayDecimalsT = project.displayDecimals ?? 2;
  const fmt = (n: number): string => formatScaled(n, scale, decimals);
  const granularity: OutputGranularity = project.outputGranularity ?? 'annual';

  const periodCount = Math.min(combined.periods, 24);
  const subPerYear = granularity === 'annual' ? 1 : granularity === 'quarterly' ? 4 : 12;
  const expandedPeriodCount = Math.min(periodCount * subPerYear, 96);
  const periodLabels = Array.from({ length: expandedPeriodCount }, (_, i) => getPeriodLabel(i + 1, project.startDate, granularity === 'monthly' ? 'monthly' : 'annual'));
  const transform = (annual: number[]): number[] =>
    granularity === 'annual' ? annual.slice(0, periodCount) : distributeAnnualToPeriods(annual.slice(0, periodCount), granularity, 'even');

  const handleAddTranche = (): void => {
    const id = `tranche-${Date.now()}`;
    const t = makeDefaultFinancingTranche(id, phase.id);
    t.repaymentPeriods = Math.max(1, phase.operationsPeriods);
    t.facilityType = 'senior_construction';
    t.idcTreatment = 'capitalize';
    t.autoGenerateIdcCostLine = true;
    t.tenorPeriods = phase.constructionPeriods + phase.operationsPeriods;
    t.availabilityPeriods = phase.constructionPeriods;
    t.gracePeriods = 0;
    addFinancingTranche(t);
  };

  const handleAddEquity = (): void => {
    const c: EquityContribution = {
      id: `equity-${Date.now()}`,
      phaseId: phase.id,
      name: 'Sponsor Equity',
      amount: 0,
      timing: 'upfront',
      type: 'cash',
      source: 'Sponsor',
    };
    addEquityContribution(c);
  };

  return (
    <div data-testid="module1-financing">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 'var(--sp-2)', flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--font-h2)', fontWeight: 'var(--fw-bold)' }}>4. Financing</h2>
          <div style={{ color: 'var(--color-meta)', fontSize: 12 }}>
            Total span: {phase.constructionPeriods + phase.operationsPeriods - phase.overlapPeriods} periods · inputs entered annually
          </div>
          <div
            style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', fontStyle: 'italic', marginTop: 4 }}
            data-testid="currency-header-line"
          >
            {currencyHeaderLine(project.currency, project.displayScale ?? 'full')}
          </div>
        </div>
        <select
          value={phase.id}
          onChange={(e) => setActivePhaseId(e.target.value)}
          style={inputStyle}
          data-testid="financing-phase-select"
        >
          {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Sub-tab switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 'var(--sp-2)', borderBottom: '1px solid var(--color-border)' }} data-testid="financing-sub-tabs">
        {(['inputs', 'schedules'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setSubTab(t)}
            data-testid={`financing-sub-tab-${t}`}
            style={{
              padding: '8px 16px',
              background: subTab === t ? 'var(--color-navy)' : 'transparent',
              color: subTab === t ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Inputs sub-tab ──────────────────────────────────────────── */}
      {subTab === 'inputs' && (
        <>
          {/* Capital Structure Overview */}
          <div style={sectionCardStyle} data-testid="financing-capital-stack">
            <strong style={{ fontSize: 13, display: 'block', marginBottom: 'var(--sp-1)' }}>Capital Structure Overview</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-1)' }}>
              <div style={{ ...calcOutputStyle, padding: 8 }} data-testid="cap-stack-equity">
                <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Total Equity</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(stack.totalEquity)}</div>
                <div style={{ fontSize: 9, color: 'var(--color-meta)' }}>{stack.totalSources > 0 ? ((stack.totalEquity / stack.totalSources) * 100).toFixed(1) : '0.0'}% of stack</div>
              </div>
              <div style={{ ...calcOutputStyle, padding: 8 }} data-testid="cap-stack-debt">
                <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Total Debt</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(stack.totalDebt)}</div>
                <div style={{ fontSize: 9, color: 'var(--color-meta)' }}>{stack.totalSources > 0 ? ((stack.totalDebt / stack.totalSources) * 100).toFixed(1) : '0.0'}% of stack</div>
              </div>
              <div style={{ ...calcOutputStyle, padding: 8 }} data-testid="cap-stack-sources">
                <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Total Sources</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(stack.totalSources)}</div>
              </div>
              <div style={{ ...calcOutputStyle, padding: 8 }} data-testid="cap-stack-uses">
                <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Total Uses (CapEx)</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(stack.totalUses)}</div>
              </div>
              <div style={{ ...calcOutputStyle, padding: 8 }} data-testid="cap-stack-ltv">
                <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase' }}>LTV (Senior / Total)</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{stack.ltvSenior.toFixed(1)}% / {stack.ltvTotal.toFixed(1)}%</div>
              </div>
              <div
                style={{
                  ...calcOutputStyle, padding: 8,
                  background: Math.abs(stack.gap) < 1
                    ? 'color-mix(in srgb, var(--color-success) 16%, transparent)'
                    : 'color-mix(in srgb, var(--color-accent-warm) 16%, transparent)',
                  color: Math.abs(stack.gap) < 1 ? 'var(--color-success)' : 'var(--color-accent-warm)',
                }}
                data-testid="cap-stack-match-chip"
              >
                <div style={{ fontSize: 10, textTransform: 'uppercase' }}>Sources vs Uses</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {Math.abs(stack.gap) < 1 ? '✓ Match' : (stack.gap > 0 ? `+${fmt(stack.gap)} surplus` : `${fmt(-stack.gap)} gap`)}
                </div>
              </div>
            </div>
          </div>

          {/* Debt Tranches */}
          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>Debt Facilities ({phaseTranches.length})</strong>
              <button type="button" className="btn-primary" onClick={handleAddTranche} style={{ fontSize: 11, padding: '4px 10px' }} data-testid="financing-add-tranche">
                + Add Facility
              </button>
            </div>
            {phaseTranches.length === 0 && (
              <div style={{ ...sectionCardStyle, color: 'var(--color-meta)', textAlign: 'center' }}>
                No facilities yet. Add one to size debt.
              </div>
            )}
            {phaseTranches.map((t) => (
              <TrancheCard
                key={t.id}
                tranche={t}
                phase={phase}
                capexPerPeriod={capexPerPeriod}
                presalesPerPeriod={presalesPerPeriod}
                project={project}
                scale={scale}
                decimals={decimals}
                onUpdate={(patch) => updateFinancingTranche(t.id, patch)}
                onRemove={() => removeFinancingTranche(t.id)}
                assets={phaseAssets.map((a) => ({ id: a.id, name: a.name }))}
              />
            ))}
          </div>

          {/* Equity Tranches */}
          <div style={sectionCardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>Equity Tranches ({phaseEquity.length})</strong>
              <button type="button" className="btn-secondary" onClick={handleAddEquity} style={{ fontSize: 11, padding: '4px 10px' }} data-testid="financing-add-equity">
                + Add Equity Tranche
              </button>
            </div>
            {phaseEquity.length === 0 && (
              <div style={{ color: 'var(--color-meta)', fontSize: 12 }}>No equity contributions defined.</div>
            )}
            {phaseEquity.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                    <th style={{ padding: '4px 6px', textAlign: 'left' }}>Name</th>
                    <th style={{ padding: '4px 6px', textAlign: 'left' }}>Type</th>
                    <th style={{ padding: '4px 6px', textAlign: 'left' }}>Source</th>
                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '4px 6px', textAlign: 'left' }}>Timing</th>
                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>IRR Hurdle %</th>
                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>Pref. Return %</th>
                    <th style={{ padding: '4px 6px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {phaseEquity.map((e) => {
                    const isAuto = e.autoDetectedFromCostLine === true;
                    return (
                      <tr key={e.id} data-testid={`equity-${e.id}`}>
                        <td style={{ padding: '4px' }}>
                          <input type="text" value={e.name} disabled={isAuto} onChange={(ev) => updateEquityContribution(e.id, { name: ev.target.value })} style={{ ...inputStyle, opacity: isAuto ? 0.6 : 1 }} title={isAuto ? 'Auto-synced from Land In-Kind cost line' : undefined} />
                        </td>
                        <td style={{ padding: '4px' }}>
                          <select value={e.type ?? 'cash'} disabled={isAuto} onChange={(ev) => updateEquityContribution(e.id, { type: ev.target.value as EquityTrancheType })} style={inputStyle}>
                            {EQUITY_TRANCHE_TYPES.map((t) => (<option key={t} value={t}>{EQUITY_TRANCHE_TYPE_LABELS[t]}</option>))}
                          </select>
                        </td>
                        <td style={{ padding: '4px' }}>
                          <input type="text" value={e.source ?? ''} placeholder="Sponsor / LP / Landowner" onChange={(ev) => updateEquityContribution(e.id, { source: ev.target.value || undefined })} style={inputStyle} />
                        </td>
                        <td style={{ padding: '4px' }}>
                          <input type="number" min={0} value={e.amount} disabled={isAuto} onChange={(ev) => updateEquityContribution(e.id, { amount: parseFloat(ev.target.value) || 0 })} style={{ ...inputStyle, opacity: isAuto ? 0.6 : 1 }} />
                        </td>
                        <td style={{ padding: '4px' }}>
                          <select value={e.timing} onChange={(ev) => updateEquityContribution(e.id, { timing: ev.target.value as EquityContribution['timing'] })} style={inputStyle}>
                            {EQUITY_TIMINGS.map((t) => (<option key={t} value={t}>{t}</option>))}
                          </select>
                        </td>
                        <td style={{ padding: '4px' }}>
                          <input type="number" step={0.5} min={0} value={e.irrHurdle ?? 0} onChange={(ev) => updateEquityContribution(e.id, { irrHurdle: parseFloat(ev.target.value) || 0 })} style={{ ...inputStyle, textAlign: 'right' }} />
                        </td>
                        <td style={{ padding: '4px' }}>
                          <input type="number" step={0.5} min={0} value={e.preferredReturn ?? 0} onChange={(ev) => updateEquityContribution(e.id, { preferredReturn: parseFloat(ev.target.value) || 0 })} style={{ ...inputStyle, textAlign: 'right' }} />
                        </td>
                        <td style={{ padding: '4px', width: 60 }}>
                          {!isAuto && (
                            <button type="button" onClick={() => removeEquityContribution(e.id)} style={{ ...inputStyle, background: 'transparent', cursor: 'pointer', color: 'var(--color-negative)' }}>✕</button>
                          )}
                          {isAuto && <span style={{ fontSize: 9, color: 'var(--color-meta)' }}>auto</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── Schedules sub-tab ───────────────────────────────────────── */}
      {subTab === 'schedules' && (
        <>
          {/* Granularity + filter pill bar */}
          <div
            style={{
              display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'center',
              padding: 'var(--sp-1) var(--sp-2)', marginBottom: 'var(--sp-2)',
              background: 'var(--color-grey-pale)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
            }}
            data-testid="financing-schedules-controls"
          >
            <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>View:</strong>
            {OUTPUT_GRANULARITIES.map((g) => (
              <label key={g} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11 }} data-testid={`financing-granularity-${g}`}>
                <input type="radio" name="financing-granularity" value={g} checked={granularity === g} onChange={() => setProject({ outputGranularity: g })} />
                {OUTPUT_GRANULARITY_LABELS[g]}
              </label>
            ))}
            <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)', marginLeft: 'var(--sp-1)' }}>Filter:</strong>
            <button type="button" onClick={() => setScheduleFilter(null)} data-testid="financing-filter-combined" style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, border: scheduleFilter === null ? 'none' : '1px solid var(--color-border)', background: scheduleFilter === null ? 'var(--color-navy)' : 'var(--color-surface)', color: scheduleFilter === null ? 'var(--color-on-primary-navy)' : 'var(--color-body)', cursor: 'pointer' }}>Combined</button>
            {phaseTranches.map((t) => {
              const active = scheduleFilter === t.id;
              return (
                <button key={t.id} type="button" onClick={() => setScheduleFilter(t.id)} data-testid={`financing-filter-${t.id}`} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, border: active ? 'none' : '1px solid var(--color-border)', background: active ? 'var(--color-navy)' : 'var(--color-surface)', color: active ? 'var(--color-on-primary-navy)' : 'var(--color-body)', cursor: 'pointer' }}>{t.name}</button>
              );
            })}
          </div>

          {/* Schedule 1: Capital Stack Summary */}
          <div style={sectionCardStyle} data-testid="capital-stack-summary">
            <strong style={{ fontSize: 13, display: 'block', marginBottom: 'var(--sp-1)' }}>1. Capital Stack Summary</strong>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                  <th style={{ padding: '4px 6px', textAlign: 'left' }}>Source</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>Amount</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>% of Total</th>
                  <th style={{ padding: '4px 6px', textAlign: 'left' }}>Category</th>
                </tr>
              </thead>
              <tbody>
                {[...stack.equityBreakdown, ...stack.debtBreakdown].map((e) => (
                  <tr key={e.id} data-testid={`stack-row-${e.id}`}>
                    <td style={{ padding: '4px 6px' }}>{e.name}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>{fmt(e.amount)}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>{e.pct.toFixed(1)}%</td>
                    <td style={{ padding: '4px 6px', color: 'var(--color-meta)', fontSize: 10 }}>{e.category}</td>
                  </tr>
                ))}
                <tr style={{ background: 'var(--color-grey-pale)', fontWeight: 700 }}>
                  <td style={{ padding: '4px 6px' }}>Total Sources</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }} data-testid="stack-total-sources">{fmt(stack.totalSources)}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>100.0%</td>
                  <td></td>
                </tr>
                <tr style={{ background: 'var(--color-grey-pale)', fontWeight: 700 }}>
                  <td style={{ padding: '4px 6px' }}>Total Uses (CapEx)</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>{fmt(stack.totalUses)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Schedule 2: Drawdown per facility (filtered) */}
          {phaseTranches.filter((t) => !scheduleFilter || t.id === scheduleFilter).map((t) => {
            const r = resultsMap.get(t.id);
            if (!r) return null;
            const drawAnnual = r.drawSchedule.slice(0, periodCount);
            const cumAnnual = drawAnnual.reduce<number[]>((acc, v) => {
              acc.push((acc[acc.length - 1] ?? 0) + v);
              return acc;
            }, []);
            return (
              <ScheduleTable
                key={`draw-${t.id}`}
                title={`2. Drawdown Schedule — ${t.name}`}
                dataTestid={`draw-${t.id}`}
                columns={periodLabels.slice(0, expandedPeriodCount)}
                rows={[
                  { label: 'Drawdown', values: transform(drawAnnual).map(fmt) as unknown as number[] },
                  { label: 'Cumulative Drawn', values: transform(cumAnnual).map(fmt) as unknown as number[] },
                ]}
              />
            );
          })}

          {/* Schedule 3: Repayment per facility (filtered) */}
          {phaseTranches.filter((t) => !scheduleFilter || t.id === scheduleFilter).map((t) => {
            const r = resultsMap.get(t.id);
            if (!r) return null;
            return (
              <ScheduleTable
                key={`repay-${t.id}`}
                title={`3. Repayment Schedule — ${t.name}`}
                dataTestid={`repay-${t.id}`}
                columns={periodLabels.slice(0, expandedPeriodCount)}
                rows={[
                  { label: 'Interest Accrued', values: transform(r.interestAccrued.slice(0, periodCount)).map(fmt) as unknown as number[] },
                  { label: 'Interest Paid', values: transform(r.interestPaid.slice(0, periodCount)).map(fmt) as unknown as number[] },
                  { label: 'IDC Capitalized', values: transform(r.interestCapitalized.slice(0, periodCount)).map(fmt) as unknown as number[] },
                  { label: 'Principal Repaid', values: transform(r.principalRepaid.slice(0, periodCount)).map(fmt) as unknown as number[] },
                  { label: 'Outstanding Balance', values: transform(r.outstandingBalance.slice(0, periodCount)).map(fmt) as unknown as number[], bold: true },
                ]}
              />
            );
          })}

          {/* Schedule 4: Combined Debt Service */}
          <ScheduleTable
            title="4. Combined Debt Service"
            dataTestid="combined-debt-service"
            columns={periodLabels.slice(0, expandedPeriodCount)}
            rows={[
              { label: 'Total Interest', values: transform(combined.totalInterest.slice(0, periodCount)).map(fmt) as unknown as number[] },
              { label: 'Total Principal', values: transform(combined.totalPrincipal.slice(0, periodCount)).map(fmt) as unknown as number[] },
              { label: 'Total Debt Service', values: transform(combined.totalDebtService.slice(0, periodCount)).map(fmt) as unknown as number[], bold: true },
            ]}
          />

          {/* Schedule 5: IDC Summary */}
          <div style={sectionCardStyle} data-testid="idc-summary">
            <strong style={{ fontSize: 13, display: 'block', marginBottom: 'var(--sp-1)' }}>5. IDC Summary</strong>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                  <th style={{ padding: '4px 6px', textAlign: 'left' }}>Facility</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>Capitalised IDC</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>Expensed Interest</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {idcSummary.byFacility.map((f) => (
                  <tr key={f.id} data-testid={`idc-row-${f.id}`}>
                    <td style={{ padding: '4px 6px' }}>{f.name}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>{fmt(f.capitalized)}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>{fmt(f.expensed)}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>{fmt(f.capitalized + f.expensed)}</td>
                  </tr>
                ))}
                <tr style={{ background: 'var(--color-grey-pale)', fontWeight: 700 }}>
                  <td style={{ padding: '4px 6px' }}>Total</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }} data-testid="idc-total-capitalized">{fmt(idcSummary.totalCapitalized)}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }} data-testid="idc-total-expensed">{fmt(idcSummary.totalExpensed)}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>{fmt(idcSummary.totalCapitalized + idcSummary.totalExpensed)}</td>
                </tr>
              </tbody>
            </table>
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 6 }}>
              Capitalised IDC flows to Tab 3 Costs as a read-only auto-generated line per asset (when "Auto cost line in Tab 3" is enabled on the facility). Expensed interest will appear as a Finance Cost in M5 P&L.
            </div>
          </div>

          {/* Schedule 6: Capital Stack Movement */}
          <ScheduleTable
            title="6. Capital Stack Movement (Outstanding Balance, Combined)"
            dataTestid="stack-movement"
            columns={periodLabels.slice(0, expandedPeriodCount)}
            rows={[
              { label: 'Drawdown', values: transform(combined.totalDrawdown.slice(0, periodCount)).map(fmt) as unknown as number[] },
              { label: 'Outstanding Balance', values: transform(combined.outstandingBalance.slice(0, periodCount)).map(fmt) as unknown as number[], bold: true },
            ]}
          />
        </>
      )}
    </div>
  );
}
