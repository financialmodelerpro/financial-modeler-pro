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
  type FundingMethod2LineRatio,
  type CostLine,
  deriveLineBaseId,
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
  // P4-Fix 10 (2026-05-12): computeCapitalStack import dropped. Capital
  // Structure Overview now derives directly from funding + equity to
  // avoid the deprecated tranche.ltvPct + tranche.principal code path.
  computeIdcSummary,
  computeCombinedDebtService,
  applyIdcToCapex,
  distributeAnnualToPeriods,
  computeFunding,
  computeEquity,
  computeAssetCost,
  computeProjectTimeline,
  costLineProjectPeriodIndex,
  generatePeriodLabels,
  type FinancingResult,
} from '@/src/core/calculations';
import { currencyHeaderLine, formatScaled, formatScaledForExport, formatAccounting, type DisplayDecimals as DisplayDecimalsT } from '@/src/core/formatters';
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
//
// P4-Fix 1 (2026-05-12): Method 2 now renders a real editable table.
// One row per unique cost-line baseId across the project (deduped by
// stripping the __phaseId__assetId suffix from composed ids). Each row
// holds debt% (editable) + equity% (auto = 100 - debt%). Stored in
// cfg.lineItemRatios.master keyed by baseId.
function renderMethodInputs(
  id: FundingMethodId,
  cfg: ProjectFinancingConfig,
  patch: (next: Partial<ProjectFinancingConfig>) => void,
  costLines: CostLine[] = [],
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
    // P4-Fix 1 (2026-05-12): editable per-cost-line debt/equity table.
    // Build the row set by deduping composed line ids on baseId so the
    // same standard line (e.g. 'construction') under multiple phases
    // collapses to a single editable row. Custom lines (id starts with
    // 'custom-') stay distinct via their unique id.
    const master = cfg.lineItemRatios?.master ?? [];
    const seenBase = new Set<string>();
    const rows: Array<{ baseId: string; label: string }> = [];
    for (const line of costLines) {
      if (line.id.startsWith('auto-idc__')) continue;
      const baseId = deriveLineBaseId(line.id);
      if (seenBase.has(baseId)) continue;
      seenBase.add(baseId);
      rows.push({ baseId, label: line.name || baseId });
    }
    const ratioOf = (baseId: string): FundingMethod2LineRatio =>
      master.find((m) => m.lineId === baseId) ?? { lineId: baseId, debtPct: 70, equityPct: 30 };
    const setRatio = (baseId: string, debtPct: number): void => {
      const clamped = Math.max(0, Math.min(100, debtPct));
      const next: FundingMethod2LineRatio = { lineId: baseId, debtPct: clamped, equityPct: 100 - clamped };
      const existing = master.find((m) => m.lineId === baseId);
      const masterNext = existing
        ? master.map((m) => m.lineId === baseId ? next : m)
        : [...master, next];
      patch({ lineItemRatios: { master: masterNext } });
    };
    if (rows.length === 0) {
      return (
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 6 }} data-testid="funding-method-2-inputs">
          No cost lines defined yet. Add cost lines in Tab 3 to configure per-line debt/equity ratios.
        </div>
      );
    }
    return (
      <div style={{ marginTop: 6 }} data-testid="funding-method-2-inputs">
        <table className="table-standard" style={{ width: '100%', fontSize: 11, tableLayout: 'fixed' }} data-testid="funding-method-2-table">
          <colgroup>
            <col style={{ width: '60%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '20%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 6px' }}>Cost Line</th>
              <th style={{ textAlign: 'right', padding: '4px 6px' }}>Debt %</th>
              <th style={{ textAlign: 'right', padding: '4px 6px' }}>Equity %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ baseId, label }) => {
              const r = ratioOf(baseId);
              return (
                <tr key={baseId} data-testid={`m2-row-${baseId}`}>
                  <td style={{ padding: '4px 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>{label}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                    <input
                      type="number" min={0} max={100}
                      value={r.debtPct}
                      onChange={(e) => setRatio(baseId, parseFloat(e.target.value) || 0)}
                      style={{ ...numStyle, width: 70 }}
                      data-testid={`m2-debt-${baseId}`}
                    />
                  </td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--color-meta)' }} data-testid={`m2-equity-${baseId}`}>
                    {r.equityPct.toFixed(0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
          Equity % auto-derives as 100% - Debt %. Per-asset override is available via the inheritance toggle in Tab 3.
        </div>
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
  // P3-Fix 3 (2026-05-12): number of facilities in this phase. When > 1
  // the Facility Share % input surfaces so the user can split total
  // debt across facilities (e.g., Senior 70%, Mezz 30%).
  facilityCount: number;
  // P3-Fix 4 (2026-05-12): list of assets in the phase, surfaced when
  // scope='asset' so the user can pick which asset the facility funds.
  phaseAssets: Array<{ id: string; name: string }>;
  // P3-Fix 4: list of phases project-wide, surfaced when scope='phase'.
  allPhases: Array<{ id: string; name: string }>;
  onUpdate: (patch: Partial<FinancingTranche>) => void;
  onRemove: () => void;
}

function TrancheCard({
  tranche, phase, capexPerPeriod, presalesPerPeriod, project, scale, decimals,
  facilityCount, phaseAssets, allPhases,
  onUpdate, onRemove,
}: TrancheCardProps): React.JSX.Element {
  // P4-Fix 6 (2026-05-12): universal accounting format. zero -> "-",
  // negative -> parens, positive -> "1,234,567", null/undef -> blank.
  // No K/M suffix per cell; scale indicator stays in page header.
  const fmt = (n: number): string => formatAccounting(n, scale, decimals);
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

      {/* P3-Fix 3 (2026-05-12): per-facility Debt % + Principal inputs
          dropped. Facility principal auto-derives from chosen funding
          method (Method 1: total capex x debt%; Method 2: cost-line
          ratios; Method 3: net funding x debt%; Method 4: cash deficit
          x debt%). Multi-facility split uses the new Facility Share %
          field below. ltvPct + principal stay on schema for back-compat;
          calc engine ignores them when ProjectFinancingConfig is set. */}
      <div style={{ display: 'grid', gridTemplateColumns: facilityCount > 1 ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)', gap: 8, marginBottom: 8 }}>
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
        {facilityCount > 1 && (
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Facility Share %</label>
            <input
              type="number" min={0} max={100}
              value={tranche.facilitySharePct ?? Math.round(100 / facilityCount)}
              onChange={(e) => onUpdate({ facilitySharePct: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
              style={inputStyle}
              data-testid={`tranche-${tranche.id}-facility-share`}
              title="Share of total project debt this facility funds (sums to 100% across facilities)."
            />
          </div>
        )}
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

      {/* P4-Fix 4 (2026-05-12): compact field layout - 2 rows of 2 fields
          instead of 1 row of 4, easier to scan on narrower screens. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Tenor (periods)</label>
          <input type="number" min={0} value={tranche.tenorPeriods ?? 0} onChange={(e) => onUpdate({ tenorPeriods: parseInt(e.target.value) || 0 })} style={inputStyle} data-testid={`tranche-${tranche.id}-tenor`} />
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Availability</label>
          <input type="number" min={0} value={tranche.availabilityPeriods ?? 0} onChange={(e) => onUpdate({ availabilityPeriods: parseInt(e.target.value) || 0 })} style={inputStyle} data-testid={`tranche-${tranche.id}-availability`} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 8 }}>
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

      {/* P3-Fix 5 (2026-05-12): per-facility Drawdown Method dropdown
          dropped. Drawdown timing auto-derives from the chosen funding
          method (Method 1: matches capex weighted by debt%; Method 2:
          matches cost-line phasing x debt%; Method 3: matches net
          funding requirement schedule; Method 4: drawdown when cash
          deficit appears). Schema fields drawdownMethod /
          drawdownDistribution / drawdownIncludeLand /
          drawdownMinCashFloor / drawdownCustomSchedule stay for
          back-compat; calc engine ignores them when
          ProjectFinancingConfig is set. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 1fr)', gap: 8, marginBottom: 8 }}>
        <div>
          {/* P2-Fix 5 (2026-05-11): dropdown shows 3 user-facing methods.
              Legacy values (cashsweep_*, straight_line, bullet, balloon,
              manual, custom_schedule, equal_periodic_amortization)
              migrate at hydrate; users never see them in the picker. */}
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Repayment Method</label>
          {/* P3-Fix 6 (2026-05-12): Equal Total / Equal Principal
              sub-method dropdown dropped. Equal Repayment defaults to
              equal_principal (declining balance, simpler mental model).
              Cash Sweep drops the sweep ratio input (defaults to 100%
              above project minimum cash reserve). equalRepaymentSubMethod
              + cashSweepConfig.sweepRatio stay on schema for back-compat;
              calc engine treats Equal Repayment as equal_principal and
              Cash Sweep as 100% sweep ratio. */}
          <select
            value={mapLegacyRepayment(tranche.repaymentMethod)}
            onChange={(e) => {
              const m = e.target.value as RepaymentMethod;
              const patch: Partial<FinancingTranche> = { repaymentMethod: m };
              if (m === 'cash_sweep' && !tranche.cashSweepConfig) {
                patch.cashSweepConfig = { startingYear: 1, sweepRatio: 100 };
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
          {mapLegacyRepayment(tranche.repaymentMethod) === 'cash_sweep' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4, marginTop: 4 }} data-testid={`tranche-${tranche.id}-cash-sweep-inputs`}>
              <input
                type="number" min={1}
                placeholder="Starting Year"
                value={tranche.cashSweepConfig?.startingYear ?? 1}
                onChange={(e) => onUpdate({ cashSweepConfig: { startingYear: Math.max(1, parseInt(e.target.value) || 1), sweepRatio: 100 } })}
                style={inputStyle}
                data-testid={`tranche-${tranche.id}-sweep-start-year`}
              />
              <div style={{ fontSize: 9, color: 'var(--color-meta)' }}>
                Sweep ratio defaults to 100% of excess cash above project minimum cash reserve.
              </div>
            </div>
          )}
          {mapLegacyRepayment(tranche.repaymentMethod) === 'year_on_year_pct' && (
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
              Configure per-period % via Advanced section (sums to 100).
            </div>
          )}
          {mapLegacyRepayment(tranche.repaymentMethod) === 'equal_repayment' && (
            <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 4, fontStyle: 'italic' }}>
              Defaults to equal-principal (declining balance) over the tenor.
            </div>
          )}
        </div>
      </div>

      {/* P3-Fix 4 (2026-05-12): facility scope dropdown re-exposed with
          3 options (project / phase / asset). Asset-specific opens an
          asset picker. Phase-specific opens a phase picker so a user
          can target a phase other than the page-header's active phase. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Scope</label>
          <select
            value={(tranche.scope as 'project' | 'phase' | 'asset' | undefined) ?? 'phase'}
            onChange={(e) => {
              const nextScope = e.target.value as 'project' | 'phase' | 'asset';
              const patch: Partial<FinancingTranche> = { scope: nextScope };
              if (nextScope === 'project') {
                patch.scopeId = undefined;
                patch.assetId = undefined;
              } else if (nextScope === 'phase') {
                patch.scopeId = tranche.phaseId;
                patch.assetId = undefined;
              } else {
                const firstAsset = phaseAssets[0]?.id;
                patch.scopeId = firstAsset;
                patch.assetId = firstAsset;
              }
              onUpdate(patch);
            }}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-scope`}
          >
            <option value="project">Project-wide</option>
            <option value="phase">Phase-specific</option>
            <option value="asset" disabled={phaseAssets.length === 0}>Asset-specific</option>
          </select>
          {tranche.scope === 'phase' && allPhases.length > 0 && (
            <select
              value={tranche.scopeId ?? tranche.phaseId}
              onChange={(e) => onUpdate({ scopeId: e.target.value })}
              style={{ ...inputStyle, marginTop: 4 }}
              data-testid={`tranche-${tranche.id}-scope-phase`}
            >
              {allPhases.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
          )}
          {tranche.scope === 'asset' && phaseAssets.length > 0 && (
            <select
              value={tranche.scopeId ?? tranche.assetId ?? ''}
              onChange={(e) => onUpdate({ scopeId: e.target.value, assetId: e.target.value })}
              style={{ ...inputStyle, marginTop: 4 }}
              data-testid={`tranche-${tranche.id}-scope-asset`}
            >
              {phaseAssets.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
            </select>
          )}
        </div>
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
          {/* P3-Fix 6 (2026-05-12): legacy Sweep Ratio % input dropped
              from Advanced. Cash Sweep repayment defaults to 100% of
              excess cash above project minimum cash reserve. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
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

      {/* P4-Fix 4 (2026-05-12): compact output cards - 2x2 instead of 1x4. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 8 }}>
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
// P2-Fix 12 (2026-05-11): ScheduleTable renders a Total column in 2nd
// position after Description. Flow rows pass `total: <number>` and the
// row sums (or pre-computed total) renders in the slot. Balance rows
// (running balances / outstanding balances) pass `total: '-'` so the
// slot shows a dash instead of a misleading sum-of-balances.
function ScheduleTable({
  title, columns, rows, dataTestid,
}: {
  title: string;
  columns: string[];
  rows: Array<{ label: string; values: number[] | string[]; bold?: boolean; total?: number | string }>;
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
              <th style={{ padding: '4px 6px', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</th>
              {columns.map((c, i) => (<th key={i} style={{ padding: '4px 6px', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} style={{ fontWeight: r.bold ? 700 : 400, background: r.bold ? 'var(--color-grey-pale)' : 'transparent' }}>
                <td style={{ padding: '4px 6px' }}>{r.label}</td>
                <td
                  style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 700, color: r.total === '-' ? 'var(--color-meta)' : undefined }}
                  data-testid={`${dataTestid}-row-${ri}-total`}
                >
                  {r.total ?? '-'}
                </td>
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
  // P4-Fix 10 (2026-05-12): legacy single-phase capexPerPeriod kept for
  // back-compat with the per-tranche schedule rendering inside TrancheCard
  // (which still consumes a per-phase array for its computeFinancing
  // call). Project-wide capex (across all phases) flows through
  // inputsSummary.totals below; that's what feeds funding / equity /
  // Capital Structure Overview now.
  const capexPerPeriod = phaseCost.perPeriod;
  const presalesPerPeriod = new Array<number>(phase.constructionPeriods + phase.operationsPeriods - phase.overlapPeriods).fill(0);

  // P3-Fix 9 (2026-05-12): All Phases aggregation. When phaseFilter is
  // '__all__', Schedules sub-tab walks ALL facilities project-wide
  // (each computed against its own phase's capex); when a specific
  // phase is picked, schedules narrow to that phase's facilities.
  // Inputs sub-tab is unaffected (Inputs Summary Tables walk all
  // phases via inputsSummary regardless of filter).
  const isAllPhases = (financingConfig.phaseFilter ?? PHASE_FILTER_ALL) === PHASE_FILTER_ALL;
  const phaseTranches = isAllPhases
    ? financingTranches
    : financingTranches.filter((t) => t.phaseId === phase.id);
  const phaseEquity = equityContributions.filter((e) => e.phaseId === phase.id);

  // Compute every facility's schedule once. P3-Fix 9: when aggregating
  // across all phases, each facility must compute against its OWN phase
  // (not the page-header's active phase) so the schedule lines up with
  // each phase's capex curve.
  const resultsMap = useMemo(() => {
    const map = new Map<string, FinancingResult>();
    for (const t of phaseTranches) {
      const facilityPhase = phases.find((p) => p.id === t.phaseId) ?? phase;
      const facilityCost = computePhaseCost(
        facilityPhase, project, costLines, costOverrides, parcels, assets, subUnits, landAllocationMode,
      );
      const facilityCapex = facilityCost.perPeriod;
      const facilityPresales = new Array<number>(facilityCost.perPeriod.length).fill(0);
      map.set(t.id, computeFinancing(t, facilityPhase, facilityCapex, facilityPresales, project));
    }
    return map;
  }, [phaseTranches, phase, phases, project, costLines, costOverrides, parcels, assets, subUnits, landAllocationMode]);

  // P4-Fix 10 (2026-05-12): funding + equity routed off PROJECT-WIDE
  // capex (inputsSummary.totals) instead of the single-phase
  // capexPerPeriod. Pre-Pass-4 this only summed the active phase, so
  // multi-phase projects + the Capital Structure Overview rendered
  // zero when activePhaseId pointed at a phase with no cost lines.
  // Now: funding sees the union of all phase capex excluding Land
  // In-Kind, so totals match the Inputs Summary Tables Total Funding
  // row exactly.
  const idcSummary = useMemo(
    () => computeIdcSummary(phaseTranches, resultsMap),
    [phaseTranches, resultsMap],
  );
  const combined = useMemo(
    () => computeCombinedDebtService(resultsMap),
    [resultsMap],
  );

  // P3-Fix 8 (2026-05-12): per-asset capex project-wide for the Inputs
  // Summary Tables. Excludes Land In-Kind (non-cash equity) so the
  // funding need matches what the Financing engine actually has to size.
  // Aggregates across ALL phases (Tab 4 Inputs is now Combined-only).
  const inputsSummary = useMemo(() => {
    const timeline = computeProjectTimeline(project, phases);
    const totalPeriods = Math.max(0, timeline.totalPeriods);
    const labels = generatePeriodLabels(project.startDate, totalPeriods, 'annual');
    const perAsset = new Map<string, { id: string; name: string; perPeriod: number[]; total: number }>();
    const totals = new Array<number>(totalPeriods).fill(0);
    for (const ph of phases) {
      const phaseAssetsLocal = assets.filter((a) => a.phaseId === ph.id && a.visible);
      for (const a of phaseAssetsLocal) {
        const breakdown = computeAssetCost(a, project, ph, parcels, assets, subUnits, costLines, costOverrides, landAllocationMode);
        const series = new Array<number>(totalPeriods).fill(0);
        const inclSeries = breakdown.perPeriod;
        const inKindSeries = breakdown.perPeriodLandInKind;
        for (let localPeriod = 0; localPeriod < inclSeries.length; localPeriod++) {
          const pp = costLineProjectPeriodIndex(project, ph, localPeriod);
          if (pp < 0 || pp >= totalPeriods) continue;
          const cash = Math.max(0, (inclSeries[localPeriod] ?? 0) - (inKindSeries[localPeriod] ?? 0));
          series[pp] += cash;
          totals[pp] += cash;
        }
        const existing = perAsset.get(a.id);
        const merged = existing ? existing.perPeriod.map((v, i) => v + (series[i] ?? 0)) : series;
        const total = merged.reduce((s, v) => s + v, 0);
        perAsset.set(a.id, { id: a.id, name: a.name, perPeriod: merged, total });
      }
    }
    const ratio = (() => {
      const f = financingConfig;
      if (f.fundingMethod === 1) return { debt: f.fixedRatio?.debtPct ?? 70, equity: f.fixedRatio?.equityPct ?? 30 };
      if (f.fundingMethod === 3) return { debt: f.netFundingConfig?.debtPct ?? 70, equity: f.netFundingConfig?.equityPct ?? 30 };
      if (f.fundingMethod === 4) return { debt: f.cashDeficitConfig?.debtPct ?? 70, equity: f.cashDeficitConfig?.equityPct ?? 30 };
      return { debt: f.fixedRatio?.debtPct ?? 70, equity: f.fixedRatio?.equityPct ?? 30 };
    })();
    const debtPct = ratio.debt / (ratio.debt + ratio.equity || 1);
    const equityPct = ratio.equity / (ratio.debt + ratio.equity || 1);
    return { labels, perAsset: Array.from(perAsset.values()), totals, debtPct, equityPct, totalPeriods };
  }, [project, phases, assets, parcels, subUnits, costLines, costOverrides, landAllocationMode, financingConfig]);
  // Land In-Kind value project-wide (sum across all phases) drives the
  // Equity Total breakdown into Cash + In-Kind sub-rows.
  const projectInKindLandValue = useMemo(() => {
    let total = 0;
    for (const ph of phases) {
      const phaseAssetsLocal = assets.filter((a) => a.phaseId === ph.id && a.visible);
      for (const a of phaseAssetsLocal) {
        const m = resolveAssetAreaMetrics(a, project, parcels, phaseAssetsLocal, subUnits, landAllocationMode);
        total += Math.max(0, m.inKindLandValue);
      }
    }
    return total;
  }, [phases, assets, project, parcels, subUnits, landAllocationMode]);

  // P4-Fix 10 (2026-05-12): funding routed off project-wide capex
  // (inputsSummary.totals) so Capital Structure Overview + schedules
  // see all phases' capex. Was single-phase pre-Pass-4 which rendered
  // zero whenever activePhaseId did not match the phase carrying the
  // cost lines.
  const funding = useMemo(
    () => computeFunding({
      method: financingConfig.fundingMethod,
      financing: financingConfig,
      capexPerPeriod: inputsSummary.totals,
    }),
    [financingConfig, inputsSummary.totals],
  );
  const equity = useMemo(
    () => computeEquity(financingConfig, funding, projectInKindLandValue),
    [financingConfig, funding, projectInKindLandValue],
  );
  // P4-Fix 3 / Fix 10: Capital Structure Overview totals are derived
  // directly from funding + equity now (NOT computeCapitalStack which
  // reads deprecated tranche.ltvPct + tranche.principal fields that
  // Pass 3 hid from the UI). totalDebt = funding.totalNeed - totalEquity.
  const stack = useMemo(() => {
    const totalEquity = equity.cashContribution + equity.inKindContribution;
    const totalDebt = Math.max(0, funding.totalNeed - totalEquity);
    const totalSources = totalEquity + totalDebt;
    const totalUses = funding.totalNeed;
    const gap = totalSources - totalUses;
    const equityBreakdown = [
      { id: 'equity-cash', name: 'Equity (Cash)', amount: equity.cashContribution, pct: totalSources > 0 ? (equity.cashContribution / totalSources) * 100 : 0, category: 'equity:cash' },
      { id: 'equity-inkind', name: 'Equity (In-Kind)', amount: equity.inKindContribution, pct: totalSources > 0 ? (equity.inKindContribution / totalSources) * 100 : 0, category: 'equity:in_kind' },
    ].filter((e) => e.amount > 0);
    const debtBreakdown = phaseTranches.map((t) => {
      const sharePct = t.facilitySharePct ?? (phaseTranches.length > 0 ? 100 / phaseTranches.length : 100);
      const amount = totalDebt * (sharePct / 100);
      return {
        id: t.id,
        name: t.name,
        amount,
        pct: totalSources > 0 ? (amount / totalSources) * 100 : 0,
        category: `debt:${t.facilityType ?? 'senior_construction'}`,
      };
    });
    const seniorDebt = debtBreakdown.reduce((s, d) => d.category.includes('senior') ? s + d.amount : s, 0);
    const ltvSenior = totalUses > 0 ? (seniorDebt / totalUses) * 100 : 0;
    const ltvTotal = totalUses > 0 ? (totalDebt / totalUses) * 100 : 0;
    return { totalEquity, totalDebt, totalSources, totalUses, gap, ltvSenior, ltvTotal, equityBreakdown, debtBreakdown };
  }, [funding, equity, phaseTranches]);

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
  // P4-Fix 6 (2026-05-12): universal accounting format (zero -> "-",
  // negative -> parens, null/undef -> blank). K/M suffix stays in page
  // header only.
  const fmt = (n: number): string => formatAccounting(n, scale, decimals);
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
        {/* P4-Fix 9 (2026-05-12): Asset Filter replaces Phase Filter.
            'Combined' aggregates all assets; specific asset id narrows
            the Inputs Summary tables + Schedules to that asset's
            portion (allocated by capex share within scoped facilities).
            phaseFilter retained on schema; migration converts to
            assetFilter='__combined__'. */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 11, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Asset Filter</label>
          <select
            value={financingConfig.assetFilter ?? '__combined__'}
            onChange={(e) => setFinancingConfig({ assetFilter: e.target.value })}
            style={inputStyle}
            data-testid="financing-asset-filter"
          >
            <option value="__combined__" data-testid="financing-asset-filter-combined">Combined</option>
            {assets.filter((a) => a.visible).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
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

          {/* P3-Fix 1 (2026-05-12): view toggle (Combined / Single Asset)
              dropped. Tab 4 Inputs always operates on Combined Project
              basis; asset-level segregation surfaces in the Inputs
              Summary Tables (Fix 8) and in Schedules. Schema field
              viewMode + selectedAssetId stay for back-compat; migration
              flips single_asset -> combined. */}

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
                      {isActive && renderMethodInputs(id, financingConfig, setFinancingConfig, costLines)}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* P4-Fix 2 (2026-05-12): Funding Basis block. Read-only summary
              of what feeds the drawdown curve given the selected method.
              Method 1 + 2: full capex (excl Land In-Kind). Method 3: capex
              net of pre-sales + OCF + existing cash. Method 4: period-by-
              period cash deficit. Lets the user verify the basis number
              matches Tab 3 Inputs Summary before sizing facilities. */}
          <div style={sectionCardStyle} data-testid="financing-funding-basis">
            <strong style={{ fontSize: 13, display: 'block', marginBottom: 'var(--sp-1)' }}>Funding Basis</strong>
            {(() => {
              const m = financingConfig.fundingMethod;
              const basisLabel =
                m === 1 ? 'Total Capex (excl Land In-Kind)' :
                m === 2 ? 'Total Capex (excl Land In-Kind), allocated per cost-line ratio' :
                m === 3 ? 'Net Funding (Capex - Pre-Sales - OCF - Existing Cash)' :
                'Cash Deficit (period-by-period fill to minimum cash reserve)';
              const totalCapex = inputsSummary.totals.reduce((s, v) => s + v, 0);
              return (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', fontSize: 11 }}>
                  <div data-testid="funding-basis-method">
                    <div style={{ color: 'var(--color-meta)' }}>Method</div>
                    <div style={{ fontWeight: 700 }}>Method {m}: {FUNDING_METHOD_LABELS[m]}</div>
                  </div>
                  <div data-testid="funding-basis-source">
                    <div style={{ color: 'var(--color-meta)' }}>Drawdown Basis</div>
                    <div style={{ fontWeight: 700 }}>{basisLabel}</div>
                  </div>
                  <div data-testid="funding-basis-capex">
                    <div style={{ color: 'var(--color-meta)' }}>Total Capex (excl Land In-Kind)</div>
                    <div style={{ fontWeight: 700 }}>{formatAccounting(totalCapex, scale, decimals)}</div>
                  </div>
                  <div data-testid="funding-basis-need">
                    <div style={{ color: 'var(--color-meta)' }}>Total Funding Need</div>
                    <div style={{ fontWeight: 700 }}>{formatAccounting(funding.totalNeed, scale, decimals)}</div>
                  </div>
                </div>
              );
            })()}
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

          {/* P4-Fix 3 (2026-05-12): Capital Structure Overview restructured.
              Total Funding leads as the headline KPI. Sources block splits
              into Total Debt + Equity Cash + Equity In-Kind sub-cards.
              Uses block shows Total Capex. LTV + match/gap chip in own row. */}
          <div style={sectionCardStyle} data-testid="financing-capital-stack">
            <strong style={{ fontSize: 13, display: 'block', marginBottom: 'var(--sp-1)' }}>Capital Structure Overview</strong>
            <div style={{ ...calcOutputStyle, padding: 12, marginBottom: 'var(--sp-1)' }} data-testid="cap-stack-total-funding">
              <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Total Funding</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{fmt(funding.totalNeed)}</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-meta)', fontWeight: 600, marginBottom: 4 }}>Sources</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-1)', marginBottom: 'var(--sp-1)' }}>
              <div style={{ ...calcOutputStyle, padding: 8 }} data-testid="cap-stack-debt">
                <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Total Debt</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(stack.totalDebt)}</div>
                <div style={{ fontSize: 9, color: 'var(--color-meta)' }}>{stack.totalSources > 0 ? ((stack.totalDebt / stack.totalSources) * 100).toFixed(1) : '0.0'}% of stack</div>
              </div>
              <div style={{ ...calcOutputStyle, padding: 8 }} data-testid="cap-stack-equity-cash">
                <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Equity (Cash)</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(equity.cashContribution)}</div>
                <div style={{ fontSize: 9, color: 'var(--color-meta)' }}>{stack.totalSources > 0 ? ((equity.cashContribution / stack.totalSources) * 100).toFixed(1) : '0.0'}% of stack</div>
              </div>
              <div style={{ ...calcOutputStyle, padding: 8 }} data-testid="cap-stack-equity-inkind">
                <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Equity (In-Kind)</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(equity.inKindContribution)}</div>
                <div style={{ fontSize: 9, color: 'var(--color-meta)' }}>{stack.totalSources > 0 ? ((equity.inKindContribution / stack.totalSources) * 100).toFixed(1) : '0.0'}% of stack</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-meta)', fontWeight: 600, marginBottom: 4 }}>Uses</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-1)', marginBottom: 'var(--sp-1)' }}>
              <div style={{ ...calcOutputStyle, padding: 8 }} data-testid="cap-stack-uses">
                <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Total Capex</div>
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
            {/* P2-Fix 11 (2026-05-11): Capital Stack Sources table.
                Equity Cash + Equity In-Kind from computeEquity, then
                per-facility debt rows. Adds % of Total + auto match row. */}
            <div style={{ marginTop: 'var(--sp-2)', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }} data-testid="cap-stack-sources-table">
                <thead>
                  <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                    <th style={{ padding: '6px', textAlign: 'left' }}>Source</th>
                    <th style={{ padding: '6px', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '6px', textAlign: 'right' }}>% of Total</th>
                    <th style={{ padding: '6px', textAlign: 'left' }}>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const totalAll = equity.cashContribution + equity.inKindContribution + phaseTranches.reduce((s, t) => s + (t.principal ?? (funding.totalNeed * (financingConfig.fixedRatio?.debtPct ?? 70) / 100 / Math.max(1, phaseTranches.length))), 0);
                    const pct = (v: number): string => totalAll > 0 ? ((v / totalAll) * 100).toFixed(1) + '%' : '0.0%';
                    return (
                      <>
                        <tr data-testid="cap-stack-source-equity-cash">
                          <td style={{ padding: '4px 6px' }}>Equity (Cash)</td>
                          <td style={{ padding: '4px 6px', textAlign: 'right' }}>{fmt(equity.cashContribution)}</td>
                          <td style={{ padding: '4px 6px', textAlign: 'right' }}>{pct(equity.cashContribution)}</td>
                          <td style={{ padding: '4px 6px', color: 'var(--color-meta)', fontSize: 10 }}>equity:cash</td>
                        </tr>
                        <tr data-testid="cap-stack-source-equity-inkind">
                          <td style={{ padding: '4px 6px' }}>Equity (In-Kind)</td>
                          <td style={{ padding: '4px 6px', textAlign: 'right' }}>{fmt(equity.inKindContribution)}</td>
                          <td style={{ padding: '4px 6px', textAlign: 'right' }}>{pct(equity.inKindContribution)}</td>
                          <td style={{ padding: '4px 6px', color: 'var(--color-meta)', fontSize: 10 }}>equity:in_kind</td>
                        </tr>
                        {phaseTranches.map((t) => {
                          const principal = t.principal ?? (funding.totalNeed * (financingConfig.fixedRatio?.debtPct ?? 70) / 100 / Math.max(1, phaseTranches.length));
                          return (
                            <tr key={t.id} data-testid={`cap-stack-source-debt-${t.id}`}>
                              <td style={{ padding: '4px 6px' }}>{t.name}</td>
                              <td style={{ padding: '4px 6px', textAlign: 'right' }}>{fmt(principal)}</td>
                              <td style={{ padding: '4px 6px', textAlign: 'right' }}>{pct(principal)}</td>
                              <td style={{ padding: '4px 6px', color: 'var(--color-meta)', fontSize: 10 }}>debt</td>
                            </tr>
                          );
                        })}
                      </>
                    );
                  })()}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--color-grey-pale)', fontWeight: 700 }}>
                    <td style={{ padding: '4px 6px' }}>Total Sources</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right' }} data-testid="cap-stack-sources-total">{fmt(stack.totalSources)}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>100.0%</td>
                    <td></td>
                  </tr>
                  <tr style={{ background: 'var(--color-grey-pale)', fontWeight: 700 }}>
                    <td style={{ padding: '4px 6px' }}>Total Uses (Capex)</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right' }} data-testid="cap-stack-uses-total">{fmt(stack.totalUses)}</td>
                    <td colSpan={2} style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--color-meta)' }}>{Math.abs(stack.gap) < 1 ? 'Sources match Uses' : `Gap ${fmt(stack.gap)}`}</td>
                  </tr>
                </tfoot>
              </table>
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
                facilityCount={phaseTranches.length}
                phaseAssets={phaseAssets.map((a) => ({ id: a.id, name: a.name }))}
                allPhases={phases.map((p) => ({ id: p.id, name: p.name }))}
                onUpdate={(patch) => updateFinancingTranche(t.id, patch)}
                onRemove={() => removeFinancingTranche(t.id)}
              />
            ))}
          </div>

          {/* P3-Fix 7 (2026-05-12): Equity Tranches section dropped.
              Equity auto-computes from chosen funding method. See
              Equity Schedule in Schedules sub-tab for cash + in-kind
              over time. */}

          {/* P3-Fix 8 (2026-05-12): 3 Inputs Summary Tables. Rows are
              project-wide assets (combined view); columns are project
              periods with Total in 2nd position. Funding = capex (excl
              Land In-Kind). Debt = Funding x debt%. Equity = Funding x
              equity%, with Cash + In-Kind sub-rows in the Total row. */}
          <div style={sectionCardStyle} data-testid="inputs-summary-tables">
            <strong style={{ fontSize: 13, display: 'block', marginBottom: 'var(--sp-1)' }}>Inputs Summary (Auto-computed)</strong>
            {(() => {
              const totalsRow = inputsSummary.totals;
              const debtRow = totalsRow.map((v) => v * inputsSummary.debtPct);
              const equityRow = totalsRow.map((v) => v * inputsSummary.equityPct);
              const fmtCell = (v: number): string => formatAccounting(v, scale, decimals);
              // P4-Fix 5 (2026-05-12): drawdown periods only - drop period
              // columns where the funding total is 0 (no draw). Computed
              // once off totalsRow so all 3 sub-tables (Funding/Debt/Equity)
              // share the same active column set.
              const activePeriods: number[] = [];
              for (let i = 0; i < totalsRow.length; i++) {
                if (Math.abs(totalsRow[i]) > 0.5) activePeriods.push(i);
              }
              const renderTable = (
                id: 'funding' | 'debt' | 'equity',
                title: string,
                multiplier: number,
                rowsTotal: number[],
              ): React.JSX.Element => (
                <div style={{ marginBottom: 'var(--sp-2)' }} data-testid={`inputs-summary-${id}`}>
                  <strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{title}</strong>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'auto' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                        <th style={{ padding: '4px 6px', textAlign: 'left' }}>Description</th>
                        <th style={{ padding: '4px 6px', textAlign: 'right' }}>Total</th>
                        {activePeriods.map((pi) => (
                          <th key={pi} style={{ padding: '4px 6px', textAlign: 'right' }}>{inputsSummary.labels[pi]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {inputsSummary.perAsset.map((a) => {
                        const total = a.total * multiplier;
                        if (total <= 0.5) return null;
                        return (
                          <tr key={a.id} data-testid={`inputs-summary-${id}-row-${a.id}`}>
                            <td style={{ padding: '4px 6px' }}>{a.name}</td>
                            <td style={{ padding: '4px 6px', textAlign: 'right' }}>{fmtCell(total)}</td>
                            {activePeriods.map((pi) => (
                              <td key={pi} style={{ padding: '4px 6px', textAlign: 'right' }}>{fmtCell((a.perPeriod[pi] ?? 0) * multiplier)}</td>
                            ))}
                          </tr>
                        );
                      })}
                      {/* P4-Fix 5 (2026-05-12): row label is just "Total"
                          (the column header is already "Total"); was
                          "TOTAL Total Funding Required" which read as
                          duplicated TOTAL Total in the rendered table.
                          Total row styling: bold + grey-pale row fill. */}
                      <tr style={{ background: 'var(--color-grey-pale)', fontWeight: 700 }} data-testid={`inputs-summary-${id}-totals`}>
                        <td style={{ padding: '4px 6px' }}>Total</td>
                        <td style={{ padding: '4px 6px', textAlign: 'right' }}>{fmtCell(rowsTotal.reduce((s, v) => s + v, 0))}</td>
                        {activePeriods.map((pi) => (
                          <td key={pi} style={{ padding: '4px 6px', textAlign: 'right' }}>{fmtCell(rowsTotal[pi])}</td>
                        ))}
                      </tr>
                      {id === 'equity' && (
                        <>
                          <tr style={{ background: 'var(--color-grey-pale)' }} data-testid="inputs-summary-equity-cash">
                            <td style={{ padding: '2px 6px 2px 24px', fontStyle: 'italic' }}>Cash Equity</td>
                            <td style={{ padding: '2px 6px', textAlign: 'right' }}>{fmtCell(Math.max(0, rowsTotal.reduce((s, v) => s + v, 0) - projectInKindLandValue))}</td>
                            {activePeriods.map((pi) => {
                              const inKindShare = pi === 0 ? projectInKindLandValue : 0;
                              const cash = Math.max(0, rowsTotal[pi] - inKindShare);
                              return <td key={pi} style={{ padding: '2px 6px', textAlign: 'right' }}>{fmtCell(cash)}</td>;
                            })}
                          </tr>
                          <tr style={{ background: 'var(--color-grey-pale)' }} data-testid="inputs-summary-equity-inkind">
                            <td style={{ padding: '2px 6px 2px 24px', fontStyle: 'italic' }}>In-Kind Equity</td>
                            <td style={{ padding: '2px 6px', textAlign: 'right' }}>{fmtCell(projectInKindLandValue)}</td>
                            {activePeriods.map((pi) => (
                              <td key={pi} style={{ padding: '2px 6px', textAlign: 'right' }}>{pi === 0 ? fmtCell(projectInKindLandValue) : fmtCell(0)}</td>
                            ))}
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              );
              return (
                <>
                  {renderTable('funding', 'Total Funding Required', 1, totalsRow)}
                  {renderTable('debt', 'Total Debt Required', inputsSummary.debtPct, debtRow)}
                  {renderTable('equity', 'Total Equity Required', inputsSummary.equityPct, equityRow)}
                </>
              );
            })()}
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

          {/* P4-Fix 7 (2026-05-12): Schedules restructure.
              Old standalone Drawdown schedule dropped (rolled into Debt
              Movement). Old Repayment schedule replaced with Debt Movement
              per facility: Opening Balance + Drawdown + Interest Capitalized
              + Principal Repaid + Closing Balance, a single ledger-style
              walk per facility. */}

          {/* Schedule 2: Debt Movement per facility (filtered) */}
          {phaseTranches.filter((t) => !scheduleFilter || t.id === scheduleFilter).map((t) => {
            const r = resultsMap.get(t.id);
            if (!r) return null;
            const sumOf = (arr: number[]): string => fmt(arr.slice(0, periodCount).reduce((s, v) => s + v, 0));
            // Opening balance = previous period's outstanding balance
            // (period 0 opening = 0). Closing balance = outstandingBalance.
            const opening: number[] = new Array(periodCount).fill(0);
            const closing = r.outstandingBalance.slice(0, periodCount);
            for (let i = 1; i < periodCount; i++) opening[i] = closing[i - 1] ?? 0;
            return (
              <ScheduleTable
                key={`debt-movement-${t.id}`}
                title={`2. Debt Movement, ${t.name}`}
                dataTestid={`debt-movement-${t.id}`}
                columns={periodLabels.slice(0, expandedPeriodCount)}
                rows={[
                  { label: 'Opening Balance', values: transform(opening).map(fmt) as unknown as number[], total: '-' },
                  { label: 'Drawdown', values: transform(r.drawSchedule.slice(0, periodCount)).map(fmt) as unknown as number[], total: sumOf(r.drawSchedule) },
                  { label: 'Interest Capitalized', values: transform(r.interestCapitalized.slice(0, periodCount)).map(fmt) as unknown as number[], total: sumOf(r.interestCapitalized) },
                  { label: 'Principal Repaid', values: transform(r.principalRepaid.slice(0, periodCount)).map(fmt) as unknown as number[], total: sumOf(r.principalRepaid) },
                  { label: 'Closing Balance', values: transform(closing).map(fmt) as unknown as number[], bold: true, total: '-' },
                ]}
              />
            );
          })}

          {/* Schedule 3: Combined Debt Service */}
          <ScheduleTable
            title="3. Combined Debt Service"
            dataTestid="combined-debt-service"
            columns={periodLabels.slice(0, expandedPeriodCount)}
            rows={[
              { label: 'Total Interest', values: transform(combined.totalInterest.slice(0, periodCount)).map(fmt) as unknown as number[], total: fmt(combined.totalInterest.slice(0, periodCount).reduce((s, v) => s + v, 0)) },
              { label: 'Total Principal', values: transform(combined.totalPrincipal.slice(0, periodCount)).map(fmt) as unknown as number[], total: fmt(combined.totalPrincipal.slice(0, periodCount).reduce((s, v) => s + v, 0)) },
              { label: 'Total Debt Service', values: transform(combined.totalDebtService.slice(0, periodCount)).map(fmt) as unknown as number[], bold: true, total: fmt(combined.totalDebtService.slice(0, periodCount).reduce((s, v) => s + v, 0)) },
            ]}
          />

          {/* P4-Fix 7 (2026-05-12): Finance Cost per facility (filtered).
              Dual tracking: Interest Accrued + Interest Paid + IDC
              Capitalized + Expensed Interest. Separates the P&L finance
              cost (accrued + expensed) from the cash service line
              (paid + capitalized) - matches how M5 will consume these. */}
          {phaseTranches.filter((t) => !scheduleFilter || t.id === scheduleFilter).map((t) => {
            const r = resultsMap.get(t.id);
            if (!r) return null;
            const sumOf = (arr: number[]): string => fmt(arr.slice(0, periodCount).reduce((s, v) => s + v, 0));
            const expensed = r.interestAccrued.slice(0, periodCount).map((acc, i) => Math.max(0, acc - (r.interestCapitalized[i] ?? 0)));
            return (
              <ScheduleTable
                key={`finance-cost-${t.id}`}
                title={`4. Finance Cost, ${t.name}`}
                dataTestid={`finance-cost-${t.id}`}
                columns={periodLabels.slice(0, expandedPeriodCount)}
                rows={[
                  { label: 'Interest Accrued', values: transform(r.interestAccrued.slice(0, periodCount)).map(fmt) as unknown as number[], total: sumOf(r.interestAccrued) },
                  { label: 'Interest Paid', values: transform(r.interestPaid.slice(0, periodCount)).map(fmt) as unknown as number[], total: sumOf(r.interestPaid) },
                  { label: 'IDC Capitalized', values: transform(r.interestCapitalized.slice(0, periodCount)).map(fmt) as unknown as number[], total: sumOf(r.interestCapitalized) },
                  { label: 'Expensed Interest', values: transform(expensed).map(fmt) as unknown as number[], bold: true, total: fmt(expensed.reduce((s, v) => s + v, 0)) },
                ]}
              />
            );
          })}

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

          {/* P4-Fix 7 + Fix 8 (2026-05-12): Equity Movement (replaces
              Equity Schedule). Ledger-style walk: Opening Equity +
              Cash Contributions + In-Kind Contributions + Closing
              Equity, matching the Debt Movement shape. */}
          {(() => {
            const closing = equity.closingPerPeriod.slice(0, periodCount);
            const opening: number[] = new Array(periodCount).fill(0);
            for (let i = 1; i < periodCount; i++) opening[i] = closing[i - 1] ?? 0;
            const sumOf = (arr: number[]): string => fmt(arr.slice(0, periodCount).reduce((s, v) => s + v, 0));
            return (
              <ScheduleTable
                title="6. Equity Movement"
                dataTestid="equity-movement"
                columns={periodLabels.slice(0, expandedPeriodCount)}
                rows={[
                  { label: 'Opening Equity', values: transform(opening).map(fmt) as unknown as number[], total: '-' },
                  { label: 'Cash Contributions', values: transform(equity.cashPerPeriod.slice(0, periodCount)).map(fmt) as unknown as number[], total: sumOf(equity.cashPerPeriod) },
                  { label: 'In-Kind Contributions', values: transform(equity.inKindPerPeriod.slice(0, periodCount)).map(fmt) as unknown as number[], total: sumOf(equity.inKindPerPeriod) },
                  { label: 'Closing Equity', values: transform(closing).map(fmt) as unknown as number[], bold: true, total: '-' },
                ]}
              />
            );
          })()}

          {/* Schedule 7: Capital Stack Movement */}
          <ScheduleTable
            title="7. Capital Stack Movement (Outstanding Balance, Combined)"
            dataTestid="stack-movement"
            columns={periodLabels.slice(0, expandedPeriodCount)}
            rows={[
              { label: 'Drawdown', values: transform(combined.totalDrawdown.slice(0, periodCount)).map(fmt) as unknown as number[], total: fmt(combined.totalDrawdown.slice(0, periodCount).reduce((s, v) => s + v, 0)) },
              { label: 'Outstanding Balance', values: transform(combined.outstandingBalance.slice(0, periodCount)).map(fmt) as unknown as number[], bold: true, total: '-' },
            ]}
          />
        </>
      )}
    </div>
  );
}
