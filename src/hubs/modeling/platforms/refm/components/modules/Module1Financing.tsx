'use client';

/**
 * Module1Financing.tsx (v8 schema, M2.0L rebuild, 2026-05-11)
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
  // P2-Fix 3: FacilityType import dropped (UI no longer renders dropdown).
  // Schema field stays via FinancingTranche['facilityType'] when read.
  type InterestRateType,
  type BaseRate,
  type IDCTreatment,
  type FeeTreatment,
  type OutputGranularity,
  type FundingMethodId,
  type ParcelFundingType,
  type ParcelFundingConfig,
  type ProjectFinancingConfig,
  DRAWDOWN_METHODS,
  DRAWDOWN_METHOD_LABELS,
  REPAYMENT_METHODS_USER,
  REPAYMENT_METHOD_LABELS,
  EQUAL_REPAYMENT_SUB_METHODS,
  EQUAL_REPAYMENT_SUB_METHOD_LABELS,
  type EqualRepaymentSubMethod,
  EQUITY_TIMINGS,
  EQUITY_TRANCHE_TYPES,
  EQUITY_TRANCHE_TYPE_LABELS,
  // P2-Fix 3: FACILITY_TYPES + FACILITY_TYPE_LABELS imports dropped.
  BASE_RATES,
  BASE_RATE_LABELS,
  // P2-Fix 7: IDC_TREATMENTS dropped (only Capitalize/Expense rendered).
  IDC_TREATMENT_LABELS,
  FEE_TREATMENTS,
  FEE_TREATMENT_LABELS,
  OUTPUT_GRANULARITIES,
  OUTPUT_GRANULARITY_LABELS,
  FUNDING_METHOD_IDS,
  FUNDING_METHOD_LABELS,
  FUNDING_METHOD_DESCRIPTIONS,
  PARCEL_FUNDING_TYPES,
  PARCEL_FUNDING_TYPE_LABELS,
  DEFAULT_PROJECT_FINANCING_CONFIG,
  PHASE_FILTER_ALL,
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
import { currencyHeaderLine, formatScaled, formatScaledForExport, type DisplayDecimals as DisplayDecimalsT } from '@/src/core/formatters';
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

// M2.0M: pill toggle styling shared by view-mode + (future) filter toggles.
// P2-Fix 5 (2026-05-11): translate legacy stored method to one of the 3
// user-facing methods at display time. The persistence layer's
// migrateM20mPass2Financing handles the eventual overwrite; this helper
// catches the transient case where a snapshot is loaded mid-render.
function mapLegacyRepayment(m: RepaymentMethod): RepaymentMethod {
  if (m === 'straight_line' || m === 'equal_periodic_amortization' || m === 'bullet') return 'equal_repayment';
  if (m === 'cashsweep_continuous' || m === 'cashsweep_from_period' || m === 'cashsweep_min_cash') return 'cash_sweep';
  if (m === 'manual' || m === 'balloon' || m === 'custom_schedule') return 'year_on_year_pct';
  return m;
}

const pillStyle = (active: boolean): React.CSSProperties => ({
  fontSize: 11,
  fontWeight: 700,
  padding: '4px 10px',
  borderRadius: 999,
  border: active ? 'none' : '1px solid var(--color-border)',
  background: active ? 'var(--color-navy)' : 'var(--color-surface)',
  color: active ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
  cursor: 'pointer',
});

// M2.0M: per-method input panel. Renders the conditional inputs for the
// currently-selected funding method directly below its radio entry.
function renderMethodInputs(
  id: FundingMethodId,
  cfg: ProjectFinancingConfig,
  patch: (next: Partial<ProjectFinancingConfig>) => void,
): React.JSX.Element {
  const numStyle: React.CSSProperties = { ...inputStyle, width: 90 };
  if (id === 1) {
    const m = cfg.fixedRatio ?? { debtPct: 70, equityPct: 30 };
    return (
      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }} data-testid="funding-method-1-inputs">
        <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
          Debt %:
          <input
            type="number" min={0} max={100}
            data-testid="m1-debt-pct"
            value={m.debtPct}
            onChange={(e) => patch({ fixedRatio: { debtPct: parseFloat(e.target.value) || 0, equityPct: 100 - (parseFloat(e.target.value) || 0) } })}
            style={numStyle}
          />
        </label>
        <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
          Equity %:
          <input
            type="number" min={0} max={100}
            data-testid="m1-equity-pct"
            value={m.equityPct}
            onChange={(e) => patch({ fixedRatio: { equityPct: parseFloat(e.target.value) || 0, debtPct: 100 - (parseFloat(e.target.value) || 0) } })}
            style={numStyle}
          />
        </label>
      </div>
    );
  }
  if (id === 2) {
    return (
      <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 6 }} data-testid="funding-method-2-inputs">
        Per-line debt% / equity% configured under each cost row in Tab 3 (next sub-pass).
        Per-asset override via the existing inheritance toggle.
      </div>
    );
  }
  if (id === 3) {
    const m = cfg.netFundingConfig ?? { existingCash: 0, debtPct: 70, equityPct: 30 };
    return (
      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }} data-testid="funding-method-3-inputs">
        <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
          Existing Cash:
          <input
            type="number" min={0}
            data-testid="m3-existing-cash"
            value={m.existingCash}
            onChange={(e) => patch({ netFundingConfig: { ...m, existingCash: parseFloat(e.target.value) || 0 } })}
            style={{ ...numStyle, width: 120 }}
          />
        </label>
        <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
          Debt %:
          <input
            type="number" min={0} max={100}
            data-testid="m3-debt-pct"
            value={m.debtPct}
            onChange={(e) => patch({ netFundingConfig: { ...m, debtPct: parseFloat(e.target.value) || 0, equityPct: 100 - (parseFloat(e.target.value) || 0) } })}
            style={numStyle}
          />
        </label>
        <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
          Equity %:
          <input
            type="number" min={0} max={100}
            data-testid="m3-equity-pct"
            value={m.equityPct}
            onChange={(e) => patch({ netFundingConfig: { ...m, equityPct: parseFloat(e.target.value) || 0, debtPct: 100 - (parseFloat(e.target.value) || 0) } })}
            style={numStyle}
          />
        </label>
      </div>
    );
  }
  // id === 4
  const m = cfg.cashDeficitConfig ?? { initialCash: 0, minimumCashReserve: 0, debtPct: 70, equityPct: 30 };
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }} data-testid="funding-method-4-inputs">
      <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
        Initial Cash:
        <input
          type="number" min={0}
          data-testid="m4-initial-cash"
          value={m.initialCash}
          onChange={(e) => patch({ cashDeficitConfig: { ...m, initialCash: parseFloat(e.target.value) || 0 } })}
          style={{ ...numStyle, width: 120 }}
        />
      </label>
      {/* P2-Fix 6 (2026-05-11): Method 4's min-cash input is gone from
          here; the project-level Minimum Cash Reserve (top of Inputs)
          now feeds Method 4. cashDeficitConfig.minimumCashReserve stays
          on the schema for legacy snapshots. */}
      <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
        Debt %:
        <input
          type="number" min={0} max={100}
          data-testid="m4-debt-pct"
          value={m.debtPct}
          onChange={(e) => patch({ cashDeficitConfig: { ...m, debtPct: parseFloat(e.target.value) || 0, equityPct: 100 - (parseFloat(e.target.value) || 0) } })}
          style={numStyle}
        />
      </label>
      <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
        Equity %:
        <input
          type="number" min={0} max={100}
          data-testid="m4-equity-pct"
          value={m.equityPct}
          onChange={(e) => patch({ cashDeficitConfig: { ...m, equityPct: parseFloat(e.target.value) || 0, debtPct: 100 - (parseFloat(e.target.value) || 0) } })}
          style={numStyle}
        />
      </label>
    </div>
  );
}

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
}

function TrancheCard({
  tranche, phase, capexPerPeriod, presalesPerPeriod, project, scale, decimals,
  onUpdate, onRemove,
}: TrancheCardProps): React.JSX.Element {
  // P2-Fix 9 (2026-05-11): per-tranche schedule cells use the export
  // formatter (no K/M suffix). Scale indicator stays in the page header.
  const fmt = (n: number): string => formatScaledForExport(n, scale, decimals);
  const result = useMemo(
    () => computeFinancing(tranche, phase, capexPerPeriod, presalesPerPeriod, project),
    [tranche, phase, capexPerPeriod, presalesPerPeriod, project],
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const idcTreatment: IDCTreatment = tranche.idcTreatment ?? (tranche.idcCapitalize ? 'capitalize' : 'expense');
  const interestRateType: InterestRateType = tranche.interestRateType ?? 'fixed';
  // P2-Fix 3: facilityType retained on schema for back-compat but not
  // referenced in the rendered UI.

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
          {/* P2-Fix 3 (2026-05-11): facility-type dropdown hidden from
              UI. Schema field still populated (defaulted to
              'senior_construction' on new facilities) for any back-end
              consumer expecting it; users distinguish facilities by
              name + rate + tenor instead. */}
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
          {/* P2-Fix 2 (2026-05-11): label is "Debt %"; schema field stays ltvPct. */}
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Debt %</label>
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
            placeholder="0 = use Debt %"
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
          {/* P2-Fix 5 (2026-05-11): dropdown shows 3 user-facing methods.
              Legacy values (cashsweep_*, straight_line, bullet, balloon,
              manual, custom_schedule, equal_periodic_amortization)
              migrate at hydrate; users never see them in the picker. */}
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Repayment Method</label>
          <select
            value={mapLegacyRepayment(tranche.repaymentMethod)}
            onChange={(e) => {
              const m = e.target.value as RepaymentMethod;
              const patch: Partial<FinancingTranche> = { repaymentMethod: m };
              if (m === 'equal_repayment' && !tranche.equalRepaymentSubMethod) {
                patch.equalRepaymentSubMethod = 'equal_total';
              }
              if (m === 'cash_sweep' && !tranche.cashSweepConfig) {
                patch.cashSweepConfig = { startingYear: 1, sweepRatio: 75 };
              }
              onUpdate(patch);
            }}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-repayment`}
          >
            {REPAYMENT_METHODS_USER.map((m) => (
              <option key={m} value={m}>{REPAYMENT_METHOD_LABELS[m]}</option>
            ))}
          </select>
          {mapLegacyRepayment(tranche.repaymentMethod) === 'equal_repayment' && (
            <select
              value={tranche.equalRepaymentSubMethod ?? 'equal_total'}
              onChange={(e) => onUpdate({ equalRepaymentSubMethod: e.target.value as EqualRepaymentSubMethod })}
              style={{ ...inputStyle, marginTop: 4 }}
              data-testid={`tranche-${tranche.id}-equal-sub`}
            >
              {EQUAL_REPAYMENT_SUB_METHODS.map((s) => (
                <option key={s} value={s}>{EQUAL_REPAYMENT_SUB_METHOD_LABELS[s]}</option>
              ))}
            </select>
          )}
          {mapLegacyRepayment(tranche.repaymentMethod) === 'cash_sweep' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }} data-testid={`tranche-${tranche.id}-cash-sweep-inputs`}>
              <input
                type="number" min={1}
                placeholder="Starting Year"
                value={tranche.cashSweepConfig?.startingYear ?? 1}
                onChange={(e) => onUpdate({ cashSweepConfig: { startingYear: Math.max(1, parseInt(e.target.value) || 1), sweepRatio: tranche.cashSweepConfig?.sweepRatio ?? 75 } })}
                style={inputStyle}
                data-testid={`tranche-${tranche.id}-sweep-start-year`}
              />
              <input
                type="number" min={0} max={100}
                placeholder="Sweep %"
                value={tranche.cashSweepConfig?.sweepRatio ?? 75}
                onChange={(e) => onUpdate({ cashSweepConfig: { startingYear: tranche.cashSweepConfig?.startingYear ?? 1, sweepRatio: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) } })}
                style={inputStyle}
                data-testid={`tranche-${tranche.id}-sweep-ratio`}
              />
            </div>
          )}
          {mapLegacyRepayment(tranche.repaymentMethod) === 'year_on_year_pct' && (
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
              Configure per-period % via Advanced section (sums to 100).
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
        <div>
          {/* P2-Fix 7 (2026-05-11): dropdown shows Capitalize / Expense
              only. Mixed retained on schema for back-compat; migration
              folded existing Mixed -> Capitalize. idcMixedSplitPeriod
              input removed from UI (schema field stays). */}
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>IDC Treatment</label>
          <select
            value={idcTreatment === 'mixed' ? 'capitalize' : idcTreatment}
            onChange={(e) => onUpdate({ idcTreatment: e.target.value as IDCTreatment, idcCapitalize: e.target.value === 'capitalize' })}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-idc-treatment`}
          >
            <option value="capitalize">{IDC_TREATMENT_LABELS.capitalize}</option>
            <option value="expense">{IDC_TREATMENT_LABELS.expense}</option>
          </select>
        </div>
        {/* P2-Fix 8 (2026-05-11): per-asset scope dropdown removed.
            Each facility is phase-scoped (driven by activePhaseId in
            the page header). The brief's "project-wide" view surfaces
            via Tab 4's Phase Filter (All Phases) in the Schedules
            sub-tab. tranche.assetId stays on the schema for legacy
            snapshots; migration converts any scope='asset' to phase. */}
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
            Generates read-only IDC capex line per asset (Capitalize only).
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

  // M2.0M: project-level financing config. Always defined post-migration
  // (migrateM20MFinancing stamps the wrapper); fall back to default for
  // the rare in-memory edge case where a freshly-imported snapshot was
  // not yet round-tripped through hydration.
  const financingConfig: ProjectFinancingConfig = project.financing ?? DEFAULT_PROJECT_FINANCING_CONFIG;
  const setFinancingConfig = (patch: Partial<ProjectFinancingConfig>): void => {
    setProject({ financing: { ...financingConfig, ...patch } });
  };
  const upsertParcelFunding = (parcelId: string, patch: Partial<ParcelFundingConfig>): void => {
    const existing = financingConfig.parcelFunding.find((p) => p.parcelId === parcelId);
    const next: ParcelFundingConfig[] = existing
      ? financingConfig.parcelFunding.map((p) => p.parcelId === parcelId ? { ...p, ...patch } : p)
      : [...financingConfig.parcelFunding, { parcelId, fundingType: '100pct_equity', ...patch }];
    setFinancingConfig({ parcelFunding: next });
  };

  // M2.0L: cross-tab integration, Land In-Kind auto-detection.
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
  // P2-Fix 9 (2026-05-11): schedule cells use the export formatter so
  // K/M suffix is on the page header line only.
  const fmt = (n: number): string => formatScaledForExport(n, scale, decimals);
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
        {/* P2-Fix 10 (2026-05-11): Phase Filter with "All Phases" option.
            When the filter is '__all__' (default), Schedules aggregate
            across phases; when a specific phase is picked, schedules
            narrow to that phase. The Inputs editor still operates on
            activePhaseId (set via the dropdown when not 'all'). */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 11, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Phase Filter</label>
          <select
            value={financingConfig.phaseFilter ?? PHASE_FILTER_ALL}
            onChange={(e) => {
              const v = e.target.value;
              setFinancingConfig({ phaseFilter: v });
              if (v !== PHASE_FILTER_ALL) {
                setActivePhaseId(v);
              }
            }}
            style={inputStyle}
            data-testid="financing-phase-filter"
          >
            <option value={PHASE_FILTER_ALL} data-testid="financing-phase-filter-all">All Phases</option>
            {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
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
          {/* P2-Fix 6 (2026-05-11): project-level cash floor sits ABOVE
              every other Inputs section. Applies across all 4 funding
              methods and the cash-sweep repayment. */}
          <div style={sectionCardStyle} data-testid="financing-min-cash-section">
            <strong style={{ fontSize: 13, display: 'block', marginBottom: 'var(--sp-1)' }}>
              Project Financing Settings
            </strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--sp-2)', alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: 'var(--color-meta)' }}>Minimum Cash Reserve</label>
              <input
                type="number" min={0}
                data-testid="financing-min-cash-reserve"
                value={financingConfig.minimumCashReserve ?? 0}
                onChange={(e) => setFinancingConfig({ minimumCashReserve: Math.max(0, parseFloat(e.target.value) || 0) })}
                style={{ ...inputStyle, maxWidth: 240 }}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 6 }}>
              Applies to all funding methods and repayment schedules. No drawdown or repayment will let closing cash fall below this floor.
            </div>
          </div>

          {/* M2.0M: Asset-level view toggle (Combined / Single Asset) */}
          <div style={sectionCardStyle} data-testid="financing-view-mode">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 12, color: 'var(--color-meta)', textTransform: 'uppercase' }}>View:</strong>
              <button
                type="button"
                data-testid="financing-view-combined"
                onClick={() => setFinancingConfig({ viewMode: 'combined', selectedAssetId: undefined })}
                style={pillStyle(financingConfig.viewMode === 'combined')}
              >
                Combined Project
              </button>
              <button
                type="button"
                data-testid="financing-view-single"
                onClick={() => {
                  const first = phaseAssets[0]?.id;
                  setFinancingConfig({ viewMode: 'single_asset', selectedAssetId: first });
                }}
                style={pillStyle(financingConfig.viewMode === 'single_asset')}
                disabled={phaseAssets.length === 0}
              >
                Single Asset
              </button>
              {financingConfig.viewMode === 'single_asset' && (
                <select
                  data-testid="financing-view-asset-select"
                  value={financingConfig.selectedAssetId ?? ''}
                  onChange={(e) => setFinancingConfig({ selectedAssetId: e.target.value })}
                  style={{ ...inputStyle, width: 'auto', minWidth: 200 }}
                >
                  {phaseAssets.length === 0 && <option value="">No assets</option>}
                  {phaseAssets.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* M2.0M: Funding Method radio */}
          <div style={sectionCardStyle} data-testid="financing-funding-method">
            <strong style={{ fontSize: 13, display: 'block', marginBottom: 'var(--sp-1)' }}>Funding Method</strong>
            <div style={{ display: 'grid', gap: 6 }}>
              {FUNDING_METHOD_IDS.map((id) => {
                const isActive = financingConfig.fundingMethod === id;
                return (
                  <label
                    key={id}
                    data-testid={`funding-method-${id}`}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8, padding: 8,
                      border: `1px solid ${isActive ? 'var(--color-navy)' : 'var(--color-border)'}`,
                      borderRadius: 'var(--radius-sm)',
                      background: isActive ? 'var(--color-navy-pale)' : 'var(--color-surface)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="funding-method"
                      value={id}
                      checked={isActive}
                      onChange={() => setFinancingConfig({ fundingMethod: id })}
                      data-testid={`funding-method-${id}-radio`}
                      style={{ marginTop: 2 }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>
                        Method {id}: {FUNDING_METHOD_LABELS[id]}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2 }}>
                        {FUNDING_METHOD_DESCRIPTIONS[id]}
                      </div>
                      {isActive && renderMethodInputs(id, financingConfig, setFinancingConfig)}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* M2.0M: Land Funding (per parcel) */}
          <div style={sectionCardStyle} data-testid="financing-land-funding">
            <strong style={{ fontSize: 13, display: 'block', marginBottom: 'var(--sp-1)' }}>Land Funding (per parcel)</strong>
            {parcels.filter((p) => p.phaseId === phase.id).length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--color-meta)' }}>No parcels in this phase. Configure in Tab 1.</div>
            )}
            {parcels.filter((p) => p.phaseId === phase.id).map((parcel) => {
              const cfg = financingConfig.parcelFunding.find((pf) => pf.parcelId === parcel.id);
              const fundingType: ParcelFundingType = cfg?.fundingType ?? '100pct_equity';
              return (
                <div key={parcel.id} data-testid={`land-funding-${parcel.id}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-1)', marginBottom: 8, padding: 8, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 12 }}>{parcel.name}</strong>
                    <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>{parcel.area.toLocaleString()} sqm</span>
                  </div>
                  <select
                    data-testid={`land-funding-${parcel.id}-type`}
                    value={fundingType}
                    onChange={(e) => upsertParcelFunding(parcel.id, { fundingType: e.target.value as ParcelFundingType })}
                    style={inputStyle}
                  >
                    {PARCEL_FUNDING_TYPES.map((t) => (
                      <option key={t} value={t}>{PARCEL_FUNDING_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                  {fundingType === 'custom_split' && (
                    <>
                      <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        Debt %:
                        <input
                          type="number" min={0} max={100}
                          data-testid={`land-funding-${parcel.id}-debt-pct`}
                          value={cfg?.customDebtPct ?? 0}
                          onChange={(e) => upsertParcelFunding(parcel.id, { customDebtPct: parseFloat(e.target.value) || 0 })}
                          style={{ ...inputStyle, width: 80 }}
                        />
                      </label>
                      <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        Equity %:
                        <input
                          type="number" min={0} max={100}
                          data-testid={`land-funding-${parcel.id}-equity-pct`}
                          value={cfg?.customEquityPct ?? 0}
                          onChange={(e) => upsertParcelFunding(parcel.id, { customEquityPct: parseFloat(e.target.value) || 0 })}
                          style={{ ...inputStyle, width: 80 }}
                        />
                      </label>
                    </>
                  )}
                  {fundingType === 'deferred_payment' && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--color-meta)' }}>
                      Deferred schedule configured via {parcel.area > 0 ? 'periods 1..constructionEnd' : 'Tab 1 parcel setup'}; full editor in next sub-pass.
                    </div>
                  )}
                  {fundingType === 'in_kind' && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--color-meta)' }}>
                      Auto-detected from Tab 3 Land (In-Kind) cost line. Contributes as equity (no cash draw).
                    </div>
                  )}
                </div>
              );
            })}
          </div>

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
                title={`2. Drawdown Schedule, ${t.name}`}
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
                title={`3. Repayment Schedule, ${t.name}`}
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
