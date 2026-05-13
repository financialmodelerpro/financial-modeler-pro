'use client';

/**
 * Module1Financing.tsx (v8 schema, M2.0L rebuild, 2026-05-11)
 *
 * Two sub-tabs: Inputs + Schedules.
 *
 *   Inputs:
 *     - Capital Structure Overview cards (sources / uses / debt% / match)
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
  type FundingMethodId,
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
  IDC_TREATMENTS,
  IDC_TREATMENT_LABELS,
  FEE_TREATMENTS,
  FEE_TREATMENT_LABELS,
  FUNDING_METHOD_IDS,
  FUNDING_METHOD_LABELS,
  FUNDING_METHOD_DESCRIPTIONS,
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
  computeFunding,
  computeEquity,
  computeAssetCost,
  computeProjectTimeline,
  costLineProjectPeriodIndex,
  type FinancingResult,
  type FundingResult,
} from '@/src/core/calculations';
import { currencyHeaderLine, formatScaled, formatScaledForExport, formatAccounting, type DisplayDecimals as DisplayDecimalsT } from '@/src/core/formatters';
import { AccountingNumberInput } from '../ui/AccountingNumberInput';
import { PercentageInput } from '../ui/PercentageInput';
import type { DisplayScale } from '../../lib/state/module1-types';
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
// Method 2 (Line-Item Based Financing) removed 2026-05-13.
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
          <PercentageInput
            min={0} max={100}
            data-testid="m1-debt-pct"
            value={m.debtPct}
            onChange={(n) => patch({ fixedRatio: { debtPct: n, equityPct: 100 - n } })}
            style={numStyle}
          />
        </label>
        <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
          Equity %:
          <PercentageInput
            min={0} max={100}
            data-testid="m1-equity-pct"
            value={m.equityPct}
            onChange={(n) => patch({ fixedRatio: { equityPct: n, debtPct: 100 - n } })}
            style={numStyle}
          />
        </label>
      </div>
    );
  }
  if (id === 2) {
    const m = cfg.netFundingConfig ?? { existingCash: 0, debtPct: 70, equityPct: 30 };
    return (
      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }} data-testid="funding-method-2-inputs">
        <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
          Existing Cash:
          {/* P10-Fix 8 (2026-05-12): accounting format on blur. */}
          <AccountingNumberInput
            value={m.existingCash}
            onChange={(n) => patch({ netFundingConfig: { ...m, existingCash: Math.max(0, n) } })}
            scale="full"
            decimals={0}
            min={0}
            style={{ ...numStyle, width: 120 }}
            data-testid="m2-existing-cash"
          />
        </label>
        <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
          Debt %:
          <PercentageInput
            min={0} max={100}
            data-testid="m2-debt-pct"
            value={m.debtPct}
            onChange={(n) => patch({ netFundingConfig: { ...m, debtPct: n, equityPct: 100 - n } })}
            style={numStyle}
          />
        </label>
        <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
          Equity %:
          <PercentageInput
            min={0} max={100}
            data-testid="m2-equity-pct"
            value={m.equityPct}
            onChange={(n) => patch({ netFundingConfig: { ...m, equityPct: n, debtPct: 100 - n } })}
            style={numStyle}
          />
        </label>
      </div>
    );
  }
  // id === 3 (was Method 4 pre-Pass-17)
  const m = cfg.cashDeficitConfig ?? { initialCash: 0, minimumCashReserve: 0, debtPct: 70, equityPct: 30 };
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }} data-testid="funding-method-3-inputs">
      <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
        Initial Cash:
        <AccountingNumberInput
          min={0}
          data-testid="m4-initial-cash"
          value={m.initialCash}
          onChange={(n) => patch({ cashDeficitConfig: { ...m, initialCash: n } })}
          style={{ ...numStyle, width: 120 }}
        />
      </label>
      {/* P2-Fix 6 (2026-05-11): Method 4's min-cash input is gone from
          here; the project-level Minimum Cash Reserve (top of Inputs)
          now feeds Method 4. cashDeficitConfig.minimumCashReserve stays
          on the schema for legacy snapshots. */}
      <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
        Debt %:
        <PercentageInput
          min={0} max={100}
          data-testid="m3-debt-pct"
          value={m.debtPct}
          onChange={(n) => patch({ cashDeficitConfig: { ...m, debtPct: n, equityPct: 100 - n } })}
          style={numStyle}
        />
      </label>
      <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
        Equity %:
        <PercentageInput
          min={0} max={100}
          data-testid="m3-equity-pct"
          value={m.equityPct}
          onChange={(n) => patch({ cashDeficitConfig: { ...m, equityPct: n, debtPct: 100 - n } })}
          style={numStyle}
        />
      </label>
    </div>
  );
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
  // Facility Origination (2026-05-13): 'new' = drawdown in model;
  // 'existing' = pre-existing facility with an opening balance at
  // project Y0. Existing facilities hide tenor / availability / grace /
  // IDC / fees and reveal Opening Balance + Remaining Tenor +
  // Remaining Repayment Periods. Legacy snapshots without `origin`
  // default to 'new'.
  const origin: 'new' | 'existing' = tranche.origin ?? 'new';
  const isExistingFacility = origin === 'existing';
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

      {/* Facility Origination (2026-05-13): new vs existing toggle.
          Sits above all other facility inputs so the user picks the
          model first, then sees the relevant fields. */}
      <div style={{ marginBottom: 8 }} data-testid={`tranche-${tranche.id}-origination`}>
        <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Facility Origination</label>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name={`tranche-${tranche.id}-origin`}
              checked={origin === 'new'}
              onChange={() => onUpdate({ origin: 'new' })}
              data-testid={`tranche-${tranche.id}-origin-new`}
            />
            New (drawdown in model)
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name={`tranche-${tranche.id}-origin`}
              checked={origin === 'existing'}
              onChange={() => onUpdate({ origin: 'existing' })}
              data-testid={`tranche-${tranche.id}-origin-existing`}
            />
            Existing (opening balance Y0)
          </label>
        </div>
      </div>

      {/* Existing facility inputs: Opening Balance + Remaining Tenor +
          Remaining Repayment Periods. Replace the standard tenor /
          availability / grace block below when origin === 'existing'. */}
      {isExistingFacility && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }} data-testid={`tranche-${tranche.id}-existing-fields`}>
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Opening Balance (Y0)</label>
            <AccountingNumberInput
              min={0}
              value={tranche.openingBalance ?? 0}
              onChange={(n) => onUpdate({ openingBalance: Math.max(0, n) })}
              style={inputStyle}
              data-testid={`tranche-${tranche.id}-opening-balance`}
            />
          </div>
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Remaining Tenor (periods)</label>
            <AccountingNumberInput
              min={0}
              decimals={0}
              value={tranche.remainingTenorPeriods ?? 0}
              onChange={(n) => onUpdate({ remainingTenorPeriods: Math.max(0, Math.round(n)) })}
              style={inputStyle}
              data-testid={`tranche-${tranche.id}-remaining-tenor`}
            />
          </div>
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Remaining Repayment (periods)</label>
            <AccountingNumberInput
              min={0}
              decimals={0}
              value={tranche.remainingRepaymentPeriods ?? 0}
              onChange={(n) => onUpdate({ remainingRepaymentPeriods: Math.max(0, Math.round(n)) })}
              style={inputStyle}
              data-testid={`tranche-${tranche.id}-remaining-repayment`}
            />
          </div>
        </div>
      )}
      {/* M2.0 Pass 15 (2026-05-13): Grace Interest Treatment also
          rendered for existing facilities. Existing facilities have no
          construction grace today (engine forces graceEndIdx=0 when
          origin==='existing'), but the dropdown is visible per spec so
          the schema choice carries through to M2.1 when interest-only /
          payment-holiday periods on existing facilities ship. */}
      {isExistingFacility && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Grace Interest Treatment</label>
          <select
            value={tranche.graceInterestTreatment ?? 'capitalize'}
            onChange={(e) => onUpdate({ graceInterestTreatment: e.target.value as 'capitalize' | 'raise_via_funding' | 'raise_as_debt' | 'pay_from_ocf' })}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-grace-treatment`}
          >
            <option value="capitalize">Capitalize (add to balance)</option>
            <option value="raise_via_funding">Raise via funding method</option>
            <option value="raise_as_debt">Raise as new debt</option>
            <option value="pay_from_ocf">Pay from operating cash flow</option>
          </select>
        </div>
      )}

      {/* P3-Fix 3 (2026-05-12): per-facility Debt % + Principal inputs
          dropped. Facility principal auto-derives from chosen funding
          method (Method 1: total capex x debt%; Method 3: net funding
          x debt%; Method 4: cash deficit x debt%). Multi-facility split
          uses the new Facility Share % field below. ltvPct + principal
          stay on schema for back-compat; calc engine ignores them when
          ProjectFinancingConfig is set. */}
      <div style={{ display: 'grid', gridTemplateColumns: facilityCount > 1 ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)', gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Interest %</label>
          <PercentageInput
            value={tranche.interestRatePct}
            onChange={(n) => onUpdate({ interestRatePct: n })}
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
            <PercentageInput
              min={0} max={100}
              value={tranche.facilitySharePct ?? Math.round(100 / facilityCount)}
              onChange={(n) => onUpdate({ facilitySharePct: Math.max(0, Math.min(100, n)) })}
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
            <AccountingNumberInput
              min={0}
              value={tranche.spreadBps ?? 0}
              onChange={(n) => onUpdate({ spreadBps: n })}
              style={inputStyle}
              data-testid={`tranche-${tranche.id}-spread`}
            />
          </div>
        </div>
      )}

      {/* P4-Fix 4 (2026-05-12): compact field layout - 2 rows of 2 fields
          instead of 1 row of 4, easier to scan on narrower screens.
          Existing facilities hide this block; Opening Balance +
          Remaining Tenor + Remaining Repayment Periods above take its
          place. */}
      {!isExistingFacility && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 8 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Tenor (periods)</label>
              <AccountingNumberInput min={0} decimals={0} value={tranche.tenorPeriods ?? 0} onChange={(n) => onUpdate({ tenorPeriods: Math.round(n) })} style={inputStyle} data-testid={`tranche-${tranche.id}-tenor`} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Availability</label>
              <AccountingNumberInput min={0} decimals={0} value={tranche.availabilityPeriods ?? 0} onChange={(n) => onUpdate({ availabilityPeriods: Math.round(n) })} style={inputStyle} data-testid={`tranche-${tranche.id}-availability`} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Grace</label>
              <AccountingNumberInput min={0} decimals={0} value={tranche.gracePeriods ?? 0} onChange={(n) => onUpdate({ gracePeriods: Math.round(n) })} style={inputStyle} data-testid={`tranche-${tranche.id}-grace`} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Grace Interest Treatment</label>
              <select
                value={tranche.graceInterestTreatment ?? 'capitalize'}
                onChange={(e) => onUpdate({ graceInterestTreatment: e.target.value as 'capitalize' | 'raise_via_funding' | 'raise_as_debt' | 'pay_from_ocf' })}
                style={inputStyle}
                data-testid={`tranche-${tranche.id}-grace-treatment`}
              >
                <option value="capitalize">Capitalize (add to balance)</option>
                <option value="raise_via_funding">Raise via funding method</option>
                <option value="raise_as_debt">Raise as new debt</option>
                <option value="pay_from_ocf">Pay from operating cash flow</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Repayment Periods</label>
              <AccountingNumberInput
                min={0}
                decimals={0}
                value={tranche.repaymentPeriods}
                onChange={(n) => onUpdate({ repaymentPeriods: Math.round(n) })}
                style={inputStyle}
                data-testid={`tranche-${tranche.id}-rep-periods`}
              />
            </div>
          </div>
        </>
      )}

      {/* P3-Fix 5 (2026-05-12): per-facility Drawdown Method dropdown
          dropped. Drawdown timing auto-derives from the chosen funding
          method (Method 1: matches capex weighted by debt%; Method 3:
          matches net funding requirement schedule; Method 4: drawdown
          when cash deficit appears). Schema fields drawdownMethod /
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
              <AccountingNumberInput
                min={1}
                decimals={0}
                placeholder="Starting Year"
                value={tranche.cashSweepConfig?.startingYear ?? 1}
                onChange={(n) => onUpdate({ cashSweepConfig: { startingYear: Math.max(1, Math.round(n)), sweepRatio: 100 } })}
                style={inputStyle}
                data-testid={`tranche-${tranche.id}-sweep-start-year`}
              />
              <div style={{ fontSize: 9, color: 'var(--color-meta)' }}>
                Sweep ratio defaults to 100% of excess cash above project minimum cash reserve.
              </div>
            </div>
          )}
          {mapLegacyRepayment(tranche.repaymentMethod) === 'year_on_year_pct' && (() => {
            // Year-on-Year % per-period editor (2026-05-13). Pattern
            // matches the Prepayments mini-table below. Period count =
            // remainingRepaymentPeriods (existing) or repaymentPeriods
            // (new). Sum chip recomputes live; engine auto-normalises
            // to 100 on the calc side so the model always reconciles.
            //
            // M2.0 Pass 18 (2026-05-13): when neither field is set the
            // editor falls back to phase.constructionPeriods (capex
            // window) instead of showing a placeholder. Hard 60-period
            // cap removed entirely.
            const userPeriods = isExistingFacility
              ? (tranche.remainingRepaymentPeriods ?? 0)
              : (tranche.repaymentPeriods ?? 0);
            const totalPeriods = userPeriods > 0
              ? userPeriods
              : Math.max(0, phase.constructionPeriods);
            const raw = tranche.yearOnYearPctSchedule ?? [];
            const sched: number[] = new Array(totalPeriods).fill(0).map((_, i) => raw[i] ?? 0);
            const sum = sched.reduce((s, v) => s + v, 0);
            const sumOk = Math.abs(sum - 100) < 0.01;
            const updateAt = (idx: number, n: number): void => {
              const next = [...sched];
              next[idx] = Math.max(0, n);
              onUpdate({ yearOnYearPctSchedule: next });
            };
            if (totalPeriods <= 0) {
              return (
                <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
                  Set Repayment Periods above to configure the Year-on-Year % schedule.
                </div>
              );
            }
            return (
              <div style={{ marginTop: 6 }} data-testid={`tranche-${tranche.id}-yoy-editor`}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: 4 }}>
                  {sched.map((v, i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 9, color: 'var(--color-meta)' }}>P{i + 1}</span>
                      <PercentageInput
                        min={0}
                        value={v}
                        onChange={(n) => updateAt(i, n)}
                        style={{ ...inputStyle, fontSize: 11, width: '100%' }}
                        data-testid={`tranche-${tranche.id}-yoy-${i}`}
                      />
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: 6, fontSize: 11, fontWeight: 700, display: 'inline-block',
                    padding: '2px 8px', borderRadius: 4,
                    background: sumOk ? 'color-mix(in srgb, var(--color-success) 16%, transparent)' : 'color-mix(in srgb, var(--color-accent-warm) 16%, transparent)',
                    color: sumOk ? 'var(--color-success)' : 'var(--color-accent-warm)',
                  }}
                  data-testid={`tranche-${tranche.id}-yoy-sum`}
                >
                  {sumOk ? `Sums to ${sum.toFixed(2)}%` : `Sum: ${sum.toFixed(2)}%, will auto-normalise to 100% on save`}
                </div>
              </div>
            );
          })()}
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
        {/* IDC + Auto IDC cells hidden for existing facilities (they
            never accrue IDC; engine force-expenses regardless of stored
            setting). */}
        {!isExistingFacility && (
          <div>
            {/* IDC Treatment selector (2026-05-13): Mixed option now
                exposed alongside Capitalize / Expense. When Mixed is
                selected, an inclusive split-period input appears below
                writing to tranche.idcMixedSplitPeriod (engine reads
                this; default = constructionPeriods). idcCapitalize
                legacy boolean is set to true for capitalize, false
                otherwise. */}
            <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>IDC Treatment</label>
            <select
              value={idcTreatment}
              onChange={(e) => {
                const next = e.target.value as IDCTreatment;
                onUpdate({ idcTreatment: next, idcCapitalize: next === 'capitalize' });
              }}
              style={inputStyle}
              data-testid={`tranche-${tranche.id}-idc-treatment`}
            >
              {IDC_TREATMENTS.map((t) => (
                <option key={t} value={t}>{IDC_TREATMENT_LABELS[t]}</option>
              ))}
            </select>
            {idcTreatment === 'mixed' && (
              <div style={{ marginTop: 4 }} data-testid={`tranche-${tranche.id}-idc-mixed-split-wrap`}>
                <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Capitalize through period (inclusive)</label>
                <AccountingNumberInput
                  min={0}
                  max={Math.max(0, phase.constructionPeriods + phase.operationsPeriods - 1)}
                  decimals={0}
                  value={tranche.idcMixedSplitPeriod ?? phase.constructionPeriods}
                  onChange={(n) => onUpdate({ idcMixedSplitPeriod: Math.max(0, Math.round(n)) })}
                  style={inputStyle}
                  data-testid={`tranche-${tranche.id}-idc-mixed-split`}
                />
                <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2 }}>
                  Interest capitalised through period {tranche.idcMixedSplitPeriod ?? phase.constructionPeriods} inclusive; expensed afterwards.
                </div>
              </div>
            )}
          </div>
        )}
        {!isExistingFacility && (
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
        )}
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
              excess cash above project minimum cash reserve. Upfront +
              Commitment fees hidden for existing facilities (they apply
              to origination only). */}
          {!isExistingFacility && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Upfront Fee %</label>
                <PercentageInput min={0} value={tranche.upfrontFeePct ?? 0} onChange={(n) => onUpdate({ upfrontFeePct: n })} style={inputStyle} data-testid={`tranche-${tranche.id}-upfront-fee`} />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Upfront Fee Treatment</label>
                <select value={tranche.upfrontFeeTreatment ?? 'capitalize'} onChange={(e) => onUpdate({ upfrontFeeTreatment: e.target.value as FeeTreatment })} style={inputStyle} data-testid={`tranche-${tranche.id}-upfront-fee-treatment`}>
                  {FEE_TREATMENTS.map((t) => (<option key={t} value={t}>{FEE_TREATMENT_LABELS[t]}</option>))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Commitment Fee % p.a.</label>
                <PercentageInput min={0} value={tranche.commitmentFeePct ?? 0} onChange={(n) => onUpdate({ commitmentFeePct: n })} style={inputStyle} data-testid={`tranche-${tranche.id}-commitment-fee`} />
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>DSCR Covenant</label>
              <AccountingNumberInput min={0} value={tranche.dscrCovenant ?? 0} onChange={(n) => onUpdate({ dscrCovenant: n })} style={inputStyle} data-testid={`tranche-${tranche.id}-dscr-cov`} />
              <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2 }}>Breach alerts in M5.</div>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Max Debt %</label>
              <PercentageInput min={0} max={100} value={tranche.ltvCovenant ?? 0} onChange={(n) => onUpdate({ ltvCovenant: n })} style={inputStyle} data-testid={`tranche-${tranche.id}-ltv-cov`} />
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
  title, labels, rows, dataTestid,
}: {
  title: string;
  /** Full period axis including the prior calendar period at index 0
   *  (built via buildResultsPeriodAxis). */
  labels: string[];
  rows: Array<{ label: string; values: number[] | string[]; bold?: boolean; total?: number | string }>;
  dataTestid: string;
}): React.JSX.Element {
  // 1 Total + N period columns -> equal-width percentage applied to all.
  const nonLabelPct = nonLabelColumnPct(1 + labels.length);
  return (
    <div style={sectionCardStyle} data-testid={dataTestid}>
      <strong style={TABLE_TITLE}>{title}</strong>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            {labels.map((_, i) => (<col key={i} style={{ width: nonLabelPct }} />))}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Description</th>
              <th style={CELL_HEADER}>Total</th>
              {labels.map((c, i) => (<th key={i} style={CELL_HEADER}>{c}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} style={{ fontWeight: r.bold ? 700 : 400, background: r.bold ? 'var(--color-grey-pale)' : 'transparent' }}>
                <td style={{ padding: '4px 6px', verticalAlign: 'middle' }}>{r.label}</td>
                <td
                  style={{ padding: '4px 6px', textAlign: 'right', verticalAlign: 'middle', fontWeight: 700, whiteSpace: 'nowrap', color: r.total === '-' ? 'var(--color-meta)' : undefined }}
                  data-testid={`${dataTestid}-row-${ri}-total`}
                >
                  {r.total ?? '-'}
                </td>
                {/* Universal prior-period column: zero for flow rows
                    (matches accounting dash via formatter), dash for
                    balance rows. */}
                <td
                  style={{ padding: '4px 6px', textAlign: 'right', verticalAlign: 'middle', whiteSpace: 'nowrap', color: 'var(--color-meta)' }}
                  data-testid={`${dataTestid}-row-${ri}-prior`}
                >
                  -
                </td>
                {r.values.map((v, vi) => (<td key={vi} style={{ padding: '4px 6px', textAlign: 'right', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{v}</td>))}
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

  // P10-Fix 6 (2026-05-12): Inputs Summary Tables default-collapsed was
  // removed in M2.0 Pass 13 (2026-05-13) when the 3 Funding / Debt /
  // Equity Summary tables were replaced with the always-visible Total
  // Debt Required + Total Equity Required tables. localStorage key
  // 'm20-financing-summary-collapsed' is no longer read or written.

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
      : [...financingConfig.parcelFunding, { parcelId, debtPct: 0, equityPct: 100, ...patch }];
    setFinancingConfig({ parcelFunding: next });
  };

  // Land In-Kind auto-detection (2026-05-13 rewrite):
  // Identify in-kind cost lines for this phase by their method
  // (`percent_of_inkind_land`) rather than by hardcoded baseId. This
  // matches both the default seed (makeDefaultCostLines) and any
  // user-added custom line that uses the same method. When at least
  // one active in-kind cost line exists, ensure an EquityContribution
  // mirrors the parcel-derived inKindLandValue. sourceCostLineId is
  // stamped with the actual composed id of the matched line (not a
  // bare baseId), so the link survives future id schemes.
  useEffect(() => {
    if (!phase) return;
    const inKindLines = costLines.filter(
      (l) => l.phaseId === phase.id && l.method === 'percent_of_inkind_land' && l.disabled !== true,
    );
    const hasInKindLine = inKindLines.length > 0;
    const phaseAssetsLocal = assets.filter((a) => a.phaseId === phase.id && a.visible);
    const totalInKind = hasInKindLine
      ? phaseAssetsLocal.reduce((s, a) => {
          const m = resolveAssetAreaMetrics(a, project, parcels, phaseAssetsLocal, subUnits, landAllocationMode);
          return s + Math.max(0, m.inKindLandValue);
        }, 0)
      : 0;
    const expectedId = `equity-auto-inkind-${phase.id}`;
    const existing = equityContributions.find((e) => e.id === expectedId);
    if (hasInKindLine && totalInKind > 0 && !existing) {
      addEquityContribution({
        id: expectedId,
        phaseId: phase.id,
        name: 'Land In-Kind Contribution (auto)',
        amount: totalInKind,
        timing: 'upfront',
        type: 'in_kind',
        source: 'Landowner',
        autoDetectedFromCostLine: true,
        // First matched in-kind line (the default seed when present;
        // user-added custom lines fall in here if they share the same
        // method and the default has been removed).
        sourceCostLineId: inKindLines[0].id,
      });
    } else if (hasInKindLine && totalInKind > 0 && existing) {
      const needsAmountUpdate = Math.abs(existing.amount - totalInKind) > 1;
      const needsSourceUpdate = existing.sourceCostLineId !== inKindLines[0].id;
      if (needsAmountUpdate || needsSourceUpdate) {
        updateEquityContribution(expectedId, {
          amount: totalInKind,
          sourceCostLineId: inKindLines[0].id,
        });
      }
    } else if ((!hasInKindLine || totalInKind <= 0) && existing && existing.autoDetectedFromCostLine) {
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

  // M2.0 Pass 18 (2026-05-13): resultsMap + idcSummary + combined moved
  // BELOW the `funding` memo because per-facility drawdown now derives
  // from funding.debtEquitySplit.debt[i] x facilitySharePct / 100 (the
  // only allocation rule). See the new definitions after `equity`.

  // P3-Fix 8 (2026-05-12): per-asset capex project-wide for the Inputs
  // Summary Tables. Excludes Land In-Kind (non-cash equity) so the
  // funding need matches what the Financing engine actually has to size.
  // Aggregates across ALL phases (Tab 4 Inputs is now Combined-only).
  const inputsSummary = useMemo(() => {
    const timeline = computeProjectTimeline(project, phases);
    const totalPeriods = Math.max(0, timeline.totalPeriods);
    // M2.0 Pass 15 (2026-05-13): the project-duration `labels` array
    // that this memo used to expose is gone. Tab 4 Inputs tables now
    // route through `inputsAxis` which crops to the actual capex extent
    // plus one trailing year, so a full-duration label list would only
    // re-introduce the empty trailing columns Fix 2 removed.
    const perAsset = new Map<string, { id: string; name: string; perPeriod: number[]; total: number }>();
    const totals = new Array<number>(totalPeriods).fill(0);
    // M2.0 Pass 13 (2026-05-13): land cash schedule per project period,
    // sliced out of perLinePerPeriod for any cost line with
    // method === 'percent_of_cash_land'. Drives the new Capex Breakdown
    // table (row 2 = Land Cash; row 1 = totals - landCash) AND the new
    // Debt + Equity Required tables (Land Cash routed per parcel
    // funding type instead of via the project-wide Method 1 ratio).
    const landCashPerPeriod = new Array<number>(totalPeriods).fill(0);
    // Per-parcel land cash series. Each parcel's contribution to Land
    // Cash is derived as: line value (which on a percent_of_cash_land
    // line is the full parcel cash sum across that line's phase) split
    // pro rata by parcel.cashLandValue. Land-Cash cost-line values are
    // pre-scaled by line.value / 100 (the % of cash land basis).
    const parcelCashPerPeriod = new Map<string, number[]>();
    for (const p of parcels) parcelCashPerPeriod.set(p.id, new Array<number>(totalPeriods).fill(0));
    for (const ph of phases) {
      const phaseAssetsLocal = assets.filter((a) => a.phaseId === ph.id && a.visible);
      for (const a of phaseAssetsLocal) {
        const breakdown = computeAssetCost(a, project, ph, parcels, assets, subUnits, costLines, costOverrides, landAllocationMode, financingConfig.parcelFunding);
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
        // Slice Land Cash per period from perLinePerPeriod, and split
        // pro rata across the PHASE's parcels by each parcel's cash
        // value (area * rate * cashPct / 100). Parcels with zero cash
        // contribute nothing. Used by the new Capex Breakdown row 2
        // AND by the new Debt/Equity Required tables to route Land
        // Cash via parcel funding type.
        const perLine = breakdown.perLinePerPeriod ?? {};
        const phaseParcels = parcels.filter((p) => p.phaseId === ph.id);
        const parcelCashValueOf = (p: typeof parcels[number]): number =>
          Math.max(0, (p.area ?? 0) * (p.rate ?? 0) * Math.max(0, p.cashPct ?? 0) / 100);
        const phaseCashTotal = phaseParcels.reduce((s, p) => s + parcelCashValueOf(p), 0);
        for (const [lineId, localSeries] of Object.entries(perLine)) {
          if (!Array.isArray(localSeries)) continue;
          const line = costLines.find((c) => c.id === lineId);
          if (!line || line.method !== 'percent_of_cash_land') continue;
          for (let lp = 0; lp < localSeries.length; lp++) {
            const pp = costLineProjectPeriodIndex(project, ph, lp);
            if (pp < 0 || pp >= totalPeriods) continue;
            const v = localSeries[lp] ?? 0;
            landCashPerPeriod[pp] += v;
            if (phaseCashTotal > 0) {
              for (const p of phaseParcels) {
                const w = parcelCashValueOf(p) / phaseCashTotal;
                const ser = parcelCashPerPeriod.get(p.id);
                if (ser) ser[pp] += v * w;
              }
            }
          }
        }
      }
    }
    const ratio = (() => {
      const f = financingConfig;
      if (f.fundingMethod === 1) return { debt: f.fixedRatio?.debtPct ?? 70, equity: f.fixedRatio?.equityPct ?? 30 };
      if (f.fundingMethod === 2) return { debt: f.netFundingConfig?.debtPct ?? 70, equity: f.netFundingConfig?.equityPct ?? 30 };
      return { debt: f.cashDeficitConfig?.debtPct ?? 70, equity: f.cashDeficitConfig?.equityPct ?? 30 };
    })();
    const debtPct = ratio.debt / (ratio.debt + ratio.equity || 1);
    const equityPct = ratio.equity / (ratio.debt + ratio.equity || 1);
    return {
      perAsset: Array.from(perAsset.values()),
      totals,
      debtPct,
      equityPct,
      totalPeriods,
      landCashPerPeriod,
      parcelCashPerPeriod: Array.from(parcelCashPerPeriod.entries()).map(([parcelId, perPeriod]) => ({ parcelId, perPeriod })),
    };
  }, [project, phases, assets, parcels, subUnits, costLines, costOverrides, landAllocationMode, financingConfig]);
  // M2.0 Pass 15 (2026-05-13): per-asset historical baselines aggregate
  // to project prior-column totals. Pre-capex flows into Tab 4 Capex
  // Breakdown's prior cell; existing debt flows into Total Debt
  // Required's prior cell; existing equity flows into Equity Required
  // Cash row's prior cell. Operational-phase assets only (the brief
  // scopes pre-capex to operational phases). Asset.visible respected.
  const historicalPriorTotals = useMemo(() => {
    let preCapex = 0;
    let debt = 0;
    let equity = 0;
    for (const ph of phases) {
      if ((ph.status ?? 'planning') !== 'operational') continue;
      const phaseAssetsLocal = assets.filter((a) => a.phaseId === ph.id && a.visible);
      for (const a of phaseAssetsLocal) {
        preCapex += Math.max(0, a.historicalPreCapex ?? 0);
        debt += Math.max(0, a.historicalDebtAmount ?? 0);
        equity += Math.max(0, a.historicalEquityAmount ?? 0);
      }
    }
    return { preCapex, debt, equity };
  }, [phases, assets]);

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

  // M2.0 Pass 15 (2026-05-13): Tab 4 Inputs sub-tab period axis. Matches
  // Tab 3 Costs Results data-extent crop (first / last column with
  // non-zero capex) plus ONE trailing year so the Inputs tables show the
  // capex window cleanly without padding to the full project horizon.
  //
  // M2.0 Pass 19 (2026-05-13): aligned column-for-column with Tab 3.
  // The bug fixed here: Tab 4 used to walk `inputsSummary.totals[i]` for
  // i >= 0 and treat each totals-index as a column index, but
  // `totals[0]` is the Y0 lump (= `phase.perPeriod[0]` for Phase 1) that
  // Tab 3 explicitly drops (Module1Costs.tsx:1652 walks `bd.perPeriod[i]`
  // for `i >= 1` and maps to `col = offset + i - 1`). The off-by-one
  // pushed every data value one column to the right on Tab 4 (e.g.
  // 1,031,493 showed at "Dec 27" instead of "Dec 26"). The Y0 in-kind
  // anchor compounded the shift on the left (priorLabel = "Dec 24"
  // instead of "Dec 25").
  //
  // Fix: walk `totals[i]` for `i >= 1` and map `col = i - 1`, mirroring
  // Tab 3's logic. cropRow now offsets the array read by `+1` so the
  // Y0 lump never enters the rendered grid. The Y0 in-kind anchor is
  // dropped; Total Equity Required's In-Kind row places its lump at the
  // first active column (= `inputsAxis.first + 1` in totals indexing).
  //
  // The axis is shared by Capex Breakdown + Funding Requirement +
  // Total Debt Required + Total Equity Required tables. Schedules
  // sub-tab axis is independent and still uses the full project +
  // debt-service horizon.
  const inputsAxis = useMemo(() => {
    const totals = inputsSummary.totals;
    let firstCol = -1;
    let lastCol = -1;
    // Walk totals[1..] (skip Y0 lump). col = i - 1 to match Tab 3.
    for (let i = 1; i < totals.length; i++) {
      if (Math.abs(totals[i] ?? 0) > 0.5) {
        const col = i - 1;
        if (firstCol < 0) firstCol = col;
        lastCol = col;
      }
    }
    const hasData = firstCol >= 0;
    const first = hasData ? firstCol : 0;
    const last = hasData ? lastCol : 0;
    const activeCount = last - first + 1 + 1; // +1 trailing year
    const axis = buildResultsPeriodAxis({
      startIso: project.startDate,
      numAnnualPeriods: activeCount,
      cropAnnualOffset: first,
    });
    // cropRow maps active column i to totals-index `first + 1 + i`
    // (the +1 skips the Y0 lump, matching Tab 3's i-1 col mapping).
    const cropRow = (arr: number[]): number[] => {
      const out = new Array<number>(activeCount).fill(0);
      for (let i = 0; i < activeCount; i++) {
        out[i] = arr[first + 1 + i] ?? 0;
      }
      return out;
    };
    return { axis, cropRow, activeCount, first };
  }, [inputsSummary, project.startDate]);

  // M2.0 Pass 20 (2026-05-13): per-period grace interest add-on for the
  // 'raise_via_funding' treatment (Pass 15 'add_to_funding_need'
  // renamed). For each tranche flagged
  // graceInterestTreatment === 'raise_via_funding', compute its
  // estimated grace-period interest accrual and add it to a copy of
  // capexPerPeriod. Approximation:
  //   principal ~= tranche.principal ?? totalCapex × ltvPct × shareSharePct
  //   gracePerPeriodInterest = principal × interestRatePct / 100
  //   distributed evenly across [availabilityPeriods .. +gracePeriods)
  //
  // Routes through whichever funding method is active (Method 1/2/3);
  // the resulting debt/equity split picks it up via the funding memo.
  const graceFundingCapexAdd = useMemo(() => {
    const out = new Array<number>(inputsSummary.totals.length).fill(0);
    if (!financingTranches || financingTranches.length === 0) return out;
    const totalCapex = inputsSummary.totals.reduce((s, v) => s + v, 0);
    for (const t of financingTranches) {
      if (t.graceInterestTreatment !== 'raise_via_funding') continue;
      const grace = Math.max(0, t.gracePeriods ?? 0);
      if (grace <= 0) continue;
      const rate = Math.max(0, t.interestRatePct ?? 0) / 100;
      if (rate <= 0) continue;
      const ltvFrac = Math.max(0, t.ltvPct ?? 0) / 100;
      const shareFrac = Math.max(0, t.facilitySharePct ?? 100) / 100;
      const principal = t.principal ?? totalCapex * ltvFrac * shareFrac;
      if (principal <= 0) continue;
      const interestPerPeriod = principal * rate;
      const availEnd = Math.max(0, t.availabilityPeriods ?? 0);
      for (let i = 0; i < grace; i++) {
        const idx = availEnd + i;
        if (idx < 0 || idx >= out.length) continue;
        out[idx] += interestPerPeriod;
      }
    }
    return out;
  }, [financingTranches, inputsSummary.totals]);

  // P4-Fix 10 (2026-05-12): funding routed off project-wide capex
  // (inputsSummary.totals) so Capital Structure Overview + schedules
  // see all phases' capex. Was single-phase pre-Pass-4 which rendered
  // zero whenever activePhaseId did not match the phase carrying the
  // cost lines.
  const funding = useMemo(() => {
    // Pass 20 (2026-05-13): grace funding add applies regardless of
    // the active funding method (Method 1/2/3 all consume the boosted
    // capex when at least one tranche selects 'raise_via_funding').
    const capex = graceFundingCapexAdd.some((v) => v > 0)
      ? inputsSummary.totals.map((v, i) => v + (graceFundingCapexAdd[i] ?? 0))
      : inputsSummary.totals;
    return computeFunding({
      method: financingConfig.fundingMethod,
      financing: financingConfig,
      capexPerPeriod: capex,
      // M2.0 Pass 13 (2026-05-13): Method 1 two-rule split inputs.
      // Land Cash routes via parcel funding type; non-land via Method
      // 1 ratio. Other methods ignore these arrays.
      landCashPerPeriod: inputsSummary.landCashPerPeriod,
      parcelCashPerPeriod: inputsSummary.parcelCashPerPeriod,
    });
  }, [financingConfig, inputsSummary.totals, inputsSummary.landCashPerPeriod, inputsSummary.parcelCashPerPeriod, graceFundingCapexAdd]);
  const equity = useMemo(
    () => computeEquity(financingConfig, funding, projectInKindLandValue),
    [financingConfig, funding, projectInKindLandValue],
  );

  // M2.0 Pass 18 (2026-05-13): per-facility schedules computed AFTER
  // `funding` so the drawdown series for each new facility = the active
  // method's debt[period] x facilitySharePct/100. Existing facilities
  // (origin === 'existing') skip the precomputed arg and amortise from
  // openingBalance. Mapping from project-period -> facility-local uses
  // costLineProjectPeriodIndex with offset = 0 (facility-local i maps
  // to project period `phaseStartYear - projectStartYear + i`).
  const resultsMap = useMemo(() => {
    const map = new Map<string, FinancingResult>();
    const projectDebt = funding.debtEquitySplit.debt;
    for (const t of phaseTranches) {
      const facilityPhase = phases.find((p) => p.id === t.phaseId) ?? phase;
      const facilityCost = computePhaseCost(
        facilityPhase, project, costLines, costOverrides, parcels, assets, subUnits, landAllocationMode,
      );
      const facilityCapex = facilityCost.perPeriod;
      const facilityPresales = new Array<number>(facilityCapex.length).fill(0);
      let precomputedDraw: number[] | undefined;
      if (t.origin !== 'existing') {
        const sharePct = Math.max(0, t.facilitySharePct ?? 100) / 100;
        precomputedDraw = new Array<number>(facilityCapex.length).fill(0);
        const offset = costLineProjectPeriodIndex(project, facilityPhase, 0);
        for (let i = 0; i < facilityCapex.length; i++) {
          const pp = offset + i;
          if (pp < 0 || pp >= projectDebt.length) continue;
          precomputedDraw[i] = (projectDebt[pp] ?? 0) * sharePct;
        }
      }
      map.set(t.id, computeFinancing(t, facilityPhase, facilityCapex, facilityPresales, project, precomputedDraw));
    }
    return map;
  }, [phaseTranches, phase, phases, project, costLines, costOverrides, parcels, assets, subUnits, landAllocationMode, funding]);

  const idcSummary = useMemo(
    () => computeIdcSummary(phaseTranches, resultsMap),
    [phaseTranches, resultsMap],
  );
  const combined = useMemo(
    () => computeCombinedDebtService(resultsMap),
    [resultsMap],
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
  // M2.0 Pass 21 (2026-05-13): Schedules sub-tab axis. Rebuilt to match
  // inputsAxis column-for-column (so Inputs + Schedules sub-tabs render
  // the same Dec 26..Dec NN cols), with last extended to project
  // operation end + facility data extent. Cropping mirrors Pass 19's
  // inputsAxis pattern: source arrays are walked from index 1 (Y0 lump
  // at index 0 is dropped); active col c reads `arr[first + 1 + c]`.
  // Out-of-range reads return 0 so the operation-end floor never
  // crashes on shorter facility arrays.
  const schedulesAxis = useMemo(() => {
    const totals = inputsSummary.totals;
    let firstCol = -1;
    let dataLastCol = -1;
    // First/last non-zero col from project-aligned totals (skip Y0 lump).
    for (let i = 1; i < totals.length; i++) {
      if (Math.abs(totals[i] ?? 0) > 0.5) {
        const col = i - 1;
        if (firstCol < 0) firstCol = col;
        dataLastCol = col;
      }
    }
    // Extend dataLastCol from per-facility schedules. Facility-local
    // index i maps to project col `phaseOffset + i - 1` (same off-by-one
    // as Tab 3 + Tab 4 Inputs: drop facility-local index 0 = Y0 lump
    // position).
    for (const t of phaseTranches) {
      const r = resultsMap.get(t.id);
      if (!r) continue;
      const facilityPhase = phases.find((p) => p.id === t.phaseId) ?? phase;
      const phaseOffset = costLineProjectPeriodIndex(project, facilityPhase, 0);
      const probe = (arr: number[]): void => {
        for (let i = 1; i < arr.length; i++) {
          if (Math.abs(arr[i] ?? 0) > 0.5) {
            const col = phaseOffset + i - 1;
            if (firstCol < 0 || col < firstCol) firstCol = col;
            if (col > dataLastCol) dataLastCol = col;
          }
        }
      };
      probe(r.drawSchedule);
      probe(r.outstandingBalance);
      probe(r.principalRepaid);
      probe(r.interestAccrued);
    }
    const hasData = firstCol >= 0;
    const first = hasData ? Math.max(0, firstCol) : 0;
    // last = max(data extent, project operation end). Operation end is
    // (totalPeriods - 1) because totalPeriods = endYear - startYear,
    // and project col 0 = first construction year.
    const operationEndCol = Math.max(0, inputsSummary.totalPeriods - 1);
    const last = Math.max(hasData ? dataLastCol : 0, operationEndCol);
    const activeCount = Math.max(1, last - first + 1);
    const axis = buildResultsPeriodAxis({
      startIso: project.startDate,
      numAnnualPeriods: activeCount,
      cropAnnualOffset: first,
    });
    // Project-aligned series (funding.*, equity.*, combined.* for
    // single-phase projects) have Y0 lump at array index 0. Active col c
    // reads `arr[first + 1 + c]`. Out-of-range returns 0.
    const cropProject = (arr: number[]): number[] => {
      const out = new Array<number>(activeCount).fill(0);
      for (let c = 0; c < activeCount; c++) {
        const idx = first + 1 + c;
        out[c] = (idx >= 0 && idx < arr.length) ? (arr[idx] ?? 0) : 0;
      }
      return out;
    };
    // Facility-local series (r.drawSchedule etc.) are indexed from the
    // facility's phase start, with index 0 = phase Y0 lump position.
    // Facility-local i maps to project-totals-index `phaseOffset + i`,
    // so active col c (= project-totals-index `first + 1 + c`) reads
    // facility-local i = `first + 1 + c - phaseOffset`.
    const cropFacility = (arr: number[], phaseOffset: number): number[] => {
      const out = new Array<number>(activeCount).fill(0);
      for (let c = 0; c < activeCount; c++) {
        const facLocal = first + 1 + c - phaseOffset;
        if (facLocal < 0 || facLocal >= arr.length) continue;
        out[c] = arr[facLocal] ?? 0;
      }
      return out;
    };
    return { axis, cropProject, cropFacility, activeCount, first, last, operationEndCol };
  }, [inputsSummary, phaseTranches, resultsMap, phases, phase, project]);

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
        {/* Asset Filter dropdown removed (2026-05-13): Tab 4 is
            project-wide only. The schema fields (assetFilter,
            selectedAssetId, viewMode) remain on ProjectFinancingConfig
            for snapshot back-compat but are no longer consumed. */}
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
            <strong style={TABLE_TITLE}>Project Financing Settings</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, color: 'var(--color-meta)' }}>Minimum Cash Reserve:</label>
              <AccountingNumberInput
                value={financingConfig.minimumCashReserve ?? 0}
                onChange={(n) => setFinancingConfig({ minimumCashReserve: Math.max(0, n) })}
                scale="full"
                decimals={0}
                min={0}
                style={{ ...inputStyle, maxWidth: 200 }}
                data-testid="financing-min-cash-reserve"
              />
              <span style={{ fontSize: 11, color: 'var(--color-meta)', flex: 1, minWidth: 220 }}>
                Applies to all funding methods and repayment schedules. No drawdown or repayment will let closing cash fall below this floor.
              </span>
            </div>
          </div>

          {/* P3-Fix 1 (2026-05-12): view toggle (Combined / Single Asset)
              dropped. Tab 4 Inputs always operates on Combined Project
              basis; asset-level segregation surfaces in the Inputs
              Summary Tables (Fix 8) and in Schedules. Schema field
              viewMode + selectedAssetId stay for back-compat; migration
              flips single_asset -> combined. */}

          {/* M2.0M: Funding Method radio. Pass 15 (2026-05-13): three
              horizontal cards (equal thirds) instead of vertical stack.
              Active card shows its inputs inline; unselected cards just
              show title + description. */}
          <div style={sectionCardStyle} data-testid="financing-funding-method">
            <strong style={TABLE_TITLE}>Funding Method</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
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

          {/* P4-Fix 2 (2026-05-12): Funding Basis block. Read-only summary
              of what feeds the drawdown curve given the selected method.
              Method 1 + 2: full capex (excl Land In-Kind). Method 3: capex
              net of pre-sales + OCF + existing cash. Method 4: period-by-
              period cash deficit. Lets the user verify the basis number
              matches Tab 3 Inputs Summary before sizing facilities. */}
          <div style={sectionCardStyle} data-testid="financing-funding-basis">
            <strong style={TABLE_TITLE}>Funding Basis</strong>
            {(() => {
              const m = financingConfig.fundingMethod;
              const basisLabel =
                m === 1 ? 'Total Capex (excl Land In-Kind)' :
                m === 2 ? 'Net Funding (Capex - Pre-Sales - OCF - Existing Cash)' :
                'Cash Deficit (period-by-period fill to minimum cash reserve)';
              const totalCapex = inputsSummary.totals.reduce((s, v) => s + v, 0);
              // M2.0 Pass 16 (2026-05-13): Sources vs Uses match chip
              // moved here from the (removed) Capital Structure Overview.
              // Green Match when totalSources ~= totalUses; amber Gap
              // otherwise. Tooltip carries the exact diff.
              const gap = stack.totalSources - stack.totalUses;
              const matches = Math.abs(gap) < 1;
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--sp-2)', fontSize: 11 }}>
                  <div data-testid="funding-basis-source">
                    <div style={{ color: 'var(--color-meta)' }}>Drawdown Basis</div>
                    <div style={{ fontWeight: 700 }}>{basisLabel}</div>
                  </div>
                  <div data-testid="funding-basis-capex" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ color: 'var(--color-meta)' }}>Total Capex (excl Land In-Kind)</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700 }}>{formatAccounting(totalCapex, scale, decimals)}</span>
                      <span
                        data-testid="funding-basis-match-chip"
                        title={
                          matches
                            ? `Sources ${formatAccounting(stack.totalSources, scale, decimals)} match Uses ${formatAccounting(stack.totalUses, scale, decimals)}.`
                            : `Sources ${formatAccounting(stack.totalSources, scale, decimals)} vs Uses ${formatAccounting(stack.totalUses, scale, decimals)}. Gap ${formatAccounting(gap, scale, decimals)}.`
                        }
                        style={{
                          padding: '2px 6px',
                          borderRadius: 3,
                          fontWeight: 700,
                          fontSize: 10,
                          background: matches
                            ? 'color-mix(in srgb, var(--color-success) 16%, transparent)'
                            : 'color-mix(in srgb, var(--color-accent-warm) 16%, transparent)',
                          color: matches ? 'var(--color-success)' : 'var(--color-accent-warm)',
                        }}
                      >
                        {matches ? '✓ Match' : `Gap: ${formatAccounting(gap, scale, decimals)}`}
                      </span>
                    </div>
                  </div>
                  <div data-testid="funding-basis-need">
                    <div style={{ color: 'var(--color-meta)' }}>Total Funding Need</div>
                    <div style={{ fontWeight: 700 }}>{formatAccounting(funding.totalNeed, scale, decimals)}</div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* M2.0M: Land Funding (per parcel). M2.0 Pass 16 (2026-05-13):
              dropdown + custom-split + deferred editor collapsed to a
              single direct Debt% / Equity% pair per parcel. The two
              inputs auto-pair (sum = 100) so editing one updates the
              other. In-Kind is auto-detected from Tab 2 parcel inKindPct
              (still flows via Land In-Kind cost line; no UI here).
              Deferred Payment dropped from UI (helper retained for
              snapshot back-compat; treated as 100% equity). */}
          <div style={sectionCardStyle} data-testid="financing-land-funding">
            <strong style={TABLE_TITLE}>Land Funding (per parcel)</strong>
            {parcels.filter((p) => p.phaseId === phase.id).length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--color-meta)' }}>No parcels in this phase. Configure in Tab 1.</div>
            )}
            {parcels.filter((p) => p.phaseId === phase.id).map((parcel) => {
              const cfg = financingConfig.parcelFunding.find((pf) => pf.parcelId === parcel.id);
              // M2.0 Pass 18 (2026-05-13) Fix 8 audit: render the
              // paired equity as 100 - debt so the on-screen display
              // always reconciles to 100, even if the stored snapshot
              // ever drifts. setDebt / setEquity already write both
              // sides; this is the belt-and-braces render guard.
              const debtPct = Math.max(0, Math.min(100, cfg?.debtPct ?? 0));
              const equityPct = 100 - debtPct;
              const setDebt = (n: number): void => {
                const d = Math.max(0, Math.min(100, n));
                upsertParcelFunding(parcel.id, { debtPct: d, equityPct: 100 - d });
              };
              const setEquity = (n: number): void => {
                const e = Math.max(0, Math.min(100, n));
                upsertParcelFunding(parcel.id, { equityPct: e, debtPct: 100 - e });
              };
              return (
                <div key={parcel.id} data-testid={`land-funding-${parcel.id}`} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 'var(--sp-1)', marginBottom: 8, padding: 8, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 12 }}>{parcel.name}</strong>
                    <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>{parcel.area.toLocaleString()} sqm</span>
                  </div>
                  <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    Debt %:
                    <PercentageInput
                      min={0} max={100}
                      data-testid={`land-funding-${parcel.id}-debt-pct`}
                      value={debtPct}
                      onChange={setDebt}
                      style={{ ...inputStyle, width: 80 }}
                    />
                  </label>
                  <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    Equity %:
                    <PercentageInput
                      min={0} max={100}
                      data-testid={`land-funding-${parcel.id}-equity-pct`}
                      value={equityPct}
                      onChange={setEquity}
                      style={{ ...inputStyle, width: 80 }}
                    />
                  </label>
                </div>
              );
            })}
          </div>

          {/* M2.0 Pass 16 (2026-05-13): Capital Structure Overview removed.
              All previously surfaced values (Total Funding, Total Debt,
              Equity Cash, Equity In-Kind, Total Capex, Debt %) live in
              the downstream Funding Requirement + Debt Required + Equity
              Required tables. The Sources vs Uses Match check now sits
              inline on the Funding Basis row above (next to Total Capex). */}

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

          {/* M2.0 Pass 13 (2026-05-13): Capex Breakdown table. Three
              rows (Capex excl Land / Land Cash Value / Total Capex Incl
              Cash Land), driven by inputsSummary. Row 3 =
              inputsSummary.totals (cash capex incl Land Cash, excl Land
              In-Kind), row 2 = Land Cash slice, row 1 = row 3 - row 2.
              Pass 14 (2026-05-13): annual-only basis. Pass 15
              (2026-05-13): moved below Debt Facilities so all input
              controls live above the computed tables. */}
          {(() => {
            const rowTotal = [...inputsSummary.totals];
            const rowLandCash = [...inputsSummary.landCashPerPeriod];
            const rowExclLand = rowTotal.map((v, i) => v - (rowLandCash[i] ?? 0));
            const sum = (arr: number[]): number => arr.reduce((s, v) => s + v, 0);
            const capexAxis = inputsAxis.axis;
            const capexNonLabelPct = nonLabelColumnPct(1 + capexAxis.count);
            const cropTotal = inputsAxis.cropRow(rowTotal);
            const cropLandCash = inputsAxis.cropRow(rowLandCash);
            const cropExclLand = inputsAxis.cropRow(rowExclLand);
            const fmtCell = (v: number): string => formatAccounting(v, scale, decimals);
            return (
              <div style={sectionCardStyle} data-testid="capex-breakdown">
                <strong style={TABLE_TITLE}>Capex Breakdown</strong>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
                    <colgroup>
                      <col style={{ width: COLUMN_WIDTHS.label }} />
                      <col style={{ width: capexNonLabelPct }} />
                      {capexAxis.labels.map((_, i) => (<col key={i} style={{ width: capexNonLabelPct }} />))}
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={CELL_HEADER}>Description</th>
                        <th style={CELL_HEADER}>Total</th>
                        {capexAxis.labels.map((label, i) => (<th key={i} style={CELL_HEADER}>{label}</th>))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr data-testid="capex-breakdown-excl-land">
                        <td style={ROW_DATA.name}>Capex (excluding Land)</td>
                        <td style={ROW_DATA.num} data-testid="capex-breakdown-excl-land-total">{fmtCell(sum(rowExclLand))}</td>
                        <td style={ROW_DATA.num} data-testid="capex-breakdown-excl-land-prior">{fmtCell(historicalPriorTotals.preCapex)}</td>
                        {cropExclLand.map((v, i) => (<td key={i} style={ROW_DATA.num}>{fmtCell(v)}</td>))}
                      </tr>
                      <tr data-testid="capex-breakdown-land-cash">
                        <td style={ROW_DATA.name}>Land Cash Value</td>
                        <td style={ROW_DATA.num} data-testid="capex-breakdown-land-cash-total">{fmtCell(sum(rowLandCash))}</td>
                        <td style={ROW_DATA.num} data-testid="capex-breakdown-land-cash-prior">{fmtCell(0)}</td>
                        {cropLandCash.map((v, i) => (<td key={i} style={ROW_DATA.num}>{fmtCell(v)}</td>))}
                      </tr>
                      <tr data-testid="capex-breakdown-total">
                        <td style={ROW_GRAND_TOTAL.name}>Total Capex Incl Cash Land</td>
                        <td style={ROW_GRAND_TOTAL.num} data-testid="capex-breakdown-total-amount">{fmtCell(sum(rowTotal))}</td>
                        <td style={ROW_GRAND_TOTAL.num} data-testid="capex-breakdown-total-prior">{fmtCell(historicalPriorTotals.preCapex)}</td>
                        {cropTotal.map((v, i) => (<td key={i} style={ROW_GRAND_TOTAL.num}>{fmtCell(v)}</td>))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 6 }}>
                  Row 3 (Total Capex Incl Cash Land) reconciles to Tab 3 Costs Results Table 2 (Total Capex Including Land Value) minus the project's Land In-Kind value.
                </div>
              </div>
            );
          })()}

          {/* M2.0 Pass 15 (2026-05-13): Funding Requirement table.
              Three method rows computed in parallel + a Selected row
              that mirrors the active method. The Selected row's data
              IS what flows into Total Debt + Equity Required below
              (via the `funding` memo, which is already routed off the
              same active method). Method 3 + 4 today consume stubbed
              presales / OCF (zeros) until M2 Revenue + M4 FS land. */}
          {(() => {
            // M2.0 Pass 15 (2026-05-13): Method 3 row consumes the same
            // grace-adjusted capex as the main funding memo, so the
            // Selected row mirrors funding.periodArray when method=3.
            const m3Capex = inputsSummary.totals.map((v, i) => v + (graceFundingCapexAdd[i] ?? 0));
            const baseCtx = {
              financing: financingConfig,
              capexPerPeriod: inputsSummary.totals,
              landCashPerPeriod: inputsSummary.landCashPerPeriod,
              parcelCashPerPeriod: inputsSummary.parcelCashPerPeriod,
            };
            const results: Record<FundingMethodId, FundingResult> = {
              1: computeFunding({ ...baseCtx, method: 1 }),
              2: computeFunding({ ...baseCtx, method: 2, capexPerPeriod: m3Capex }),
              3: computeFunding({ ...baseCtx, method: 3 }),
            };
            const activeMethod = financingConfig.fundingMethod;
            const fundAxis = inputsAxis.axis;
            const fundNonLabelPct = nonLabelColumnPct(1 + fundAxis.count);
            const sum = (arr: number[]): number => arr.reduce((s, v) => s + v, 0);
            const fmtCell = (v: number): string => formatAccounting(v, scale, decimals);
            // M2.0 Pass 18 (2026-05-13) Fix 9: Methods 2 + 3 depend on
            // presales + OCF data that ships with M2 Revenue + M4 FS.
            // Until those engines land, the computed numbers use stubbed
            // zeros and are misleading. Render dashes for those rows
            // (and for the Selected row when the active method is 2/3)
            // until the dependency lands. Switch back to numbers by
            // returning false from this guard.
            const isMethodStubbed = (m: FundingMethodId): boolean => m === 2 || m === 3;
            const DASH = '-';
            const renderRow = (m: FundingMethodId, isSelected: boolean): React.JSX.Element => {
              const row = results[m].periodArray;
              const cropped = inputsAxis.cropRow(row);
              const nameStyle = isSelected ? ROW_GRAND_TOTAL.name : ROW_DATA.name;
              const numStyle = isSelected ? ROW_GRAND_TOTAL.num : ROW_DATA.num;
              const label = isSelected
                ? `Selected: Method ${m} ${FUNDING_METHOD_LABELS[m]}`
                : `Method ${m}: ${FUNDING_METHOD_LABELS[m]}`;
              const testid = isSelected ? 'funding-req-selected' : `funding-req-method-${m}`;
              const stub = isMethodStubbed(m);
              return (
                <tr data-testid={testid} key={isSelected ? 'sel' : `m${m}`}>
                  <td style={nameStyle}>{label}</td>
                  <td style={numStyle}>{stub ? DASH : fmtCell(sum(row))}</td>
                  <td style={numStyle}>{stub ? DASH : fmtCell(0)}</td>
                  {cropped.map((v, i) => (
                    <td key={i} style={numStyle}>{stub ? DASH : fmtCell(v)}</td>
                  ))}
                </tr>
              );
            };
            return (
              <div style={sectionCardStyle} data-testid="funding-requirement">
                <strong style={TABLE_TITLE}>Funding Requirement</strong>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
                    <colgroup>
                      <col style={{ width: COLUMN_WIDTHS.label }} />
                      <col style={{ width: fundNonLabelPct }} />
                      {fundAxis.labels.map((_, i) => (<col key={i} style={{ width: fundNonLabelPct }} />))}
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={CELL_HEADER}>Description</th>
                        <th style={CELL_HEADER}>Total</th>
                        {fundAxis.labels.map((label, i) => (<th key={i} style={CELL_HEADER}>{label}</th>))}
                      </tr>
                    </thead>
                    <tbody>
                      {FUNDING_METHOD_IDS.map((m) => renderRow(m, false))}
                      {renderRow(activeMethod, true)}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 6 }}>
                  Methods 2 and 3 use stubbed presales and operating cash flow until M2 Revenue and M4 Financial Statements modules ship. Their numbers will refine then.
                </div>
              </div>
            );
          })()}

          {/* M2.0 Pass 13 (2026-05-13): Total Debt Required + Total
              Equity Required tables. Replaces the old 3 Inputs Summary
              tables (Funding / Debt / Equity). Always visible (not
              collapsible) since these ARE the funding view now.
              Engine's two-rule Method 1 split (Land Cash routed per
              parcel funding type, non-land routed via Method 1 ratio)
              is already baked into funding.debtEquitySplit; the tables
              read directly off that. */}
          {(() => {
            // Pass 14 (2026-05-13): annual-only basis.
            // M2.0 Pass 20 Fix (2026-05-13): cash equity is the funding
            // split's equity slice DIRECTLY, never reduced by the
            // in-kind lump. In-kind is additive memo (separate row,
            // additive to the grand total). Pre-Pass-20 the subtraction
            // zeroed Dec 26 cash equity whenever the in-kind lump
            // exceeded that period's cash share.
            const debtRow = [...funding.debtEquitySplit.debt];
            const cashEquityRow = [...funding.debtEquitySplit.equity];
            // M2.0 Pass 19 (2026-05-13): the in-kind lump lands at the
            // first ACTIVE column (= the first construction year), not
            // at totals-index 0 (which is the Y0 lump position that
            // Tab 3 + Tab 4 axis both drop). cropRow reads from
            // `first + 1 + i`, so placing the lump at `first + 1` makes
            // it render at active col 0.
            const inKindRow = new Array<number>(cashEquityRow.length).fill(0);
            const inKindIdx = inputsAxis.first + 1;
            if (inKindRow.length > inKindIdx) inKindRow[inKindIdx] = projectInKindLandValue;
            const sum = (arr: number[]): number => arr.reduce((s, v) => s + v, 0);
            const debtTotal = sum(debtRow);
            const inKindTotal = sum(inKindRow);
            const cashEquityTotal = sum(cashEquityRow);
            const equityTotal = cashEquityTotal + inKindTotal;
            const reqAxis = inputsAxis.axis;
            const reqNonLabelPct = nonLabelColumnPct(1 + reqAxis.count);
            const cropDebt = inputsAxis.cropRow(debtRow);
            const cropCashEquity = inputsAxis.cropRow(cashEquityRow);
            const cropInKind = inputsAxis.cropRow(inKindRow);
            const fmtCell = (v: number): string => formatAccounting(v, scale, decimals);
            return (
              <>
                {/* Table A: Total Debt Required */}
                <div style={sectionCardStyle} data-testid="total-debt-required">
                  <strong style={TABLE_TITLE}>Total Debt Required</strong>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: COLUMN_WIDTHS.label }} />
                        <col style={{ width: reqNonLabelPct }} />
                        {reqAxis.labels.map((_, i) => (<col key={i} style={{ width: reqNonLabelPct }} />))}
                      </colgroup>
                      <thead>
                        <tr>
                          <th style={CELL_HEADER}>Description</th>
                          <th style={CELL_HEADER}>Total</th>
                          {reqAxis.labels.map((label, i) => (<th key={i} style={CELL_HEADER}>{label}</th>))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr data-testid="total-debt-required-row">
                          <td style={ROW_GRAND_TOTAL.name}>Total Debt Required</td>
                          <td style={ROW_GRAND_TOTAL.num} data-testid="total-debt-required-total">{fmtCell(debtTotal)}</td>
                          <td style={ROW_GRAND_TOTAL.num} data-testid="total-debt-required-prior">{fmtCell(historicalPriorTotals.debt)}</td>
                          {cropDebt.map((v, i) => (<td key={i} style={ROW_GRAND_TOTAL.num}>{fmtCell(v)}</td>))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 6 }}>
                    Capex excl Land x Method 1 debt %, plus Land Cash x parcel-derived debt share.
                  </div>
                </div>

                {/* Table B: Total Equity Required (3 rows) */}
                <div style={sectionCardStyle} data-testid="total-equity-required">
                  <strong style={TABLE_TITLE}>Total Equity Required</strong>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: COLUMN_WIDTHS.label }} />
                        <col style={{ width: reqNonLabelPct }} />
                        {reqAxis.labels.map((_, i) => (<col key={i} style={{ width: reqNonLabelPct }} />))}
                      </colgroup>
                      <thead>
                        <tr>
                          <th style={CELL_HEADER}>Description</th>
                          <th style={CELL_HEADER}>Total</th>
                          {reqAxis.labels.map((label, i) => (<th key={i} style={CELL_HEADER}>{label}</th>))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr data-testid="total-equity-required-cash">
                          <td style={ROW_DATA.name}>Equity (Cash)</td>
                          <td style={ROW_DATA.num} data-testid="total-equity-required-cash-total">{fmtCell(cashEquityTotal)}</td>
                          <td style={ROW_DATA.num} data-testid="total-equity-required-cash-prior">{fmtCell(historicalPriorTotals.equity)}</td>
                          {cropCashEquity.map((v, i) => (<td key={i} style={ROW_DATA.num}>{fmtCell(v)}</td>))}
                        </tr>
                        <tr data-testid="total-equity-required-inkind">
                          <td style={ROW_DATA.name}>Equity (In-Kind)</td>
                          <td style={ROW_DATA.num} data-testid="total-equity-required-inkind-total">{fmtCell(inKindTotal)}</td>
                          <td style={ROW_DATA.num} data-testid="total-equity-required-inkind-prior">{fmtCell(0)}</td>
                          {cropInKind.map((v, i) => (<td key={i} style={ROW_DATA.num}>{fmtCell(v)}</td>))}
                        </tr>
                        <tr data-testid="total-equity-required-row">
                          <td style={ROW_GRAND_TOTAL.name}>Total Equity Required</td>
                          <td style={ROW_GRAND_TOTAL.num} data-testid="total-equity-required-total">{fmtCell(equityTotal)}</td>
                          <td style={ROW_GRAND_TOTAL.num} data-testid="total-equity-required-prior">{fmtCell(historicalPriorTotals.equity)}</td>
                          {cropCashEquity.map((_, i) => (
                            <td key={i} style={ROW_GRAND_TOTAL.num}>{fmtCell((cropCashEquity[i] ?? 0) + (cropInKind[i] ?? 0))}</td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 6 }}>
                    Equity (Cash) = Capex excl Land x Method 1 equity %, plus Land Cash x parcel-derived equity share. Equity (In-Kind) = Land In-Kind value (lump at first period).
                  </div>
                </div>
              </>
            );
          })()}
        </>
      )}

      {/* ── Schedules sub-tab ──────────────────────────────────────────
          M2.0 Pass 21 (2026-05-13): wiped + rebuilt clean. 5 tables in
          fixed order with the universal tableStyles tokens. Axis
          aligned column-for-column with Tab 4 Inputs (same off-by-one
          cropping; same Dec NN labels), extended to project operation
          end and to facility data extent. Equity Movement places the
          Land In-Kind lump at the first active col directly (so the
          lump renders on screen instead of being cropped out with the
          engine's Y0-anchored inKindPerPeriod[0]). */}
      {subTab === 'schedules' && (() => {
        const labels = schedulesAxis.axis.labels;
        const { cropProject, cropFacility, activeCount } = schedulesAxis;
        const filteredFacilities = phaseTranches.filter(
          (t) => !scheduleFilter || t.id === scheduleFilter,
        );
        const sumActive = (arr: number[]): string => fmt(arr.reduce((s, v) => s + v, 0));
        const buildOpening = (closing: number[]): number[] => {
          const out = new Array<number>(closing.length).fill(0);
          for (let i = 1; i < closing.length; i++) out[i] = closing[i - 1] ?? 0;
          return out;
        };
        return (
          <>
            {/* Filter pill bar */}
            <div
              style={{
                display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'center',
                padding: 'var(--sp-1) var(--sp-2)', marginBottom: 'var(--sp-2)',
                background: 'var(--color-grey-pale)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
              }}
              data-testid="financing-schedules-controls"
            >
              <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>Filter:</strong>
              <button type="button" onClick={() => setScheduleFilter(null)} data-testid="financing-filter-combined" style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, border: scheduleFilter === null ? 'none' : '1px solid var(--color-border)', background: scheduleFilter === null ? 'var(--color-navy)' : 'var(--color-surface)', color: scheduleFilter === null ? 'var(--color-on-primary-navy)' : 'var(--color-body)', cursor: 'pointer' }}>Combined</button>
              {phaseTranches.map((t) => {
                const active = scheduleFilter === t.id;
                return (
                  <button key={t.id} type="button" onClick={() => setScheduleFilter(t.id)} data-testid={`financing-filter-${t.id}`} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, border: active ? 'none' : '1px solid var(--color-border)', background: active ? 'var(--color-navy)' : 'var(--color-surface)', color: active ? 'var(--color-on-primary-navy)' : 'var(--color-body)', cursor: 'pointer' }}>{t.name}</button>
                );
              })}
            </div>

            {/* Schedule 1: Debt Movement per facility */}
            {filteredFacilities.map((t) => {
              const r = resultsMap.get(t.id);
              if (!r) return null;
              const facilityPhase = phases.find((p) => p.id === t.phaseId) ?? phase;
              const phaseOffset = costLineProjectPeriodIndex(project, facilityPhase, 0);
              const closing = cropFacility(r.outstandingBalance, phaseOffset);
              const opening = buildOpening(closing);
              const draw = cropFacility(r.drawSchedule, phaseOffset);
              const intCap = cropFacility(r.interestCapitalized, phaseOffset);
              const principal = cropFacility(r.principalRepaid, phaseOffset);
              return (
                <ScheduleTable
                  key={`debt-movement-${t.id}`}
                  title={`1. Debt Movement, ${t.name}`}
                  dataTestid={`debt-movement-${t.id}`}
                  labels={labels}
                  rows={[
                    { label: 'Opening Balance', values: opening.map(fmt) as unknown as number[], total: '-' },
                    { label: 'Drawdown', values: draw.map(fmt) as unknown as number[], total: sumActive(draw) },
                    { label: 'Interest Capitalized', values: intCap.map(fmt) as unknown as number[], total: sumActive(intCap) },
                    { label: 'Principal Repaid', values: principal.map(fmt) as unknown as number[], total: sumActive(principal) },
                    { label: 'Closing Balance', values: closing.map(fmt) as unknown as number[], bold: true, total: '-' },
                  ]}
                />
              );
            })}

            {/* Schedule 2: Combined Debt Service.
                combined.* arrays sum facility-local series at the same
                indices, so for single-phase projects they share the
                Y0-lump-at-0 shape; cropProject lines them up with the
                same Dec NN columns Inputs uses. Multi-phase combined
                is a known pre-existing limitation; prefer the per-
                facility tables above for multi-phase reads. */}
            {(() => {
              const totalInterest = cropProject(combined.totalInterest);
              const totalPrincipal = cropProject(combined.totalPrincipal);
              const totalDS = cropProject(combined.totalDebtService);
              return (
                <ScheduleTable
                  title="2. Combined Debt Service"
                  dataTestid="combined-debt-service"
                  labels={labels}
                  rows={[
                    { label: 'Total Interest', values: totalInterest.map(fmt) as unknown as number[], total: sumActive(totalInterest) },
                    { label: 'Total Principal', values: totalPrincipal.map(fmt) as unknown as number[], total: sumActive(totalPrincipal) },
                    { label: 'Total Debt Service', values: totalDS.map(fmt) as unknown as number[], bold: true, total: sumActive(totalDS) },
                  ]}
                />
              );
            })()}

            {/* Schedule 3: Finance Cost per facility */}
            {filteredFacilities.map((t) => {
              const r = resultsMap.get(t.id);
              if (!r) return null;
              const facilityPhase = phases.find((p) => p.id === t.phaseId) ?? phase;
              const phaseOffset = costLineProjectPeriodIndex(project, facilityPhase, 0);
              const accrued = cropFacility(r.interestAccrued, phaseOffset);
              const cap = cropFacility(r.interestCapitalized, phaseOffset);
              const expensed = accrued.map((a, i) => Math.max(0, a - (cap[i] ?? 0)));
              return (
                <ScheduleTable
                  key={`finance-cost-${t.id}`}
                  title={`3. Finance Cost, ${t.name}`}
                  dataTestid={`finance-cost-${t.id}`}
                  labels={labels}
                  rows={[
                    { label: 'Interest Accrued', values: accrued.map(fmt) as unknown as number[], total: sumActive(accrued) },
                    { label: 'Interest Capitalized', values: cap.map(fmt) as unknown as number[], total: sumActive(cap) },
                    { label: 'Interest Expensed', values: expensed.map(fmt) as unknown as number[], bold: true, total: sumActive(expensed) },
                  ]}
                />
              );
            })}

            {/* Schedule 4: IDC Summary */}
            <div style={sectionCardStyle} data-testid="idc-summary">
              <strong style={TABLE_TITLE}>4. IDC Summary</strong>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
                <colgroup>
                  <col />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 110 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={CELL_HEADER}>Facility</th>
                    <th style={CELL_HEADER}>Capitalised IDC</th>
                    <th style={CELL_HEADER}>Expensed Interest</th>
                    <th style={CELL_HEADER}>Total</th>
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
                Capitalised IDC flows to Tab 3 Costs as a read-only auto-generated line per asset (when "Auto cost line in Tab 3" is enabled on the facility). Expensed interest appears as a Finance Cost in M5 P&L.
              </div>
            </div>

            {/* Schedule 5: Equity Movement.
                Pass 21: in-kind lump rendered at active col 0 directly
                (the engine's inKindPerPeriod[0] is the Y0-anchor that
                cropProject drops). Closing walk is computed locally
                from cropped cash + the placed in-kind lump so it
                matches what the user sees. */}
            {(() => {
              const cash = cropProject(equity.cashPerPeriod);
              const inKind = new Array<number>(activeCount).fill(0);
              if (activeCount > 0) inKind[0] = projectInKindLandValue;
              const closing = new Array<number>(activeCount).fill(0);
              let running = 0;
              for (let i = 0; i < activeCount; i++) {
                running += (cash[i] ?? 0) + (inKind[i] ?? 0);
                closing[i] = running;
              }
              const opening = buildOpening(closing);
              return (
                <ScheduleTable
                  title="5. Equity Movement"
                  dataTestid="equity-movement"
                  labels={labels}
                  rows={[
                    { label: 'Opening Equity', values: opening.map(fmt) as unknown as number[], total: '-' },
                    { label: 'Cash Contributions', values: cash.map(fmt) as unknown as number[], total: sumActive(cash) },
                    { label: 'In-Kind Contributions', values: inKind.map(fmt) as unknown as number[], total: sumActive(inKind) },
                    { label: 'Closing Equity', values: closing.map(fmt) as unknown as number[], bold: true, total: '-' },
                  ]}
                />
              );
            })()}
          </>
        );
      })()}
    </div>
  );
}
