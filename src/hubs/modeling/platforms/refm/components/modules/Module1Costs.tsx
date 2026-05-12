'use client';

/**
 * Module1Costs.tsx (v7 schema, M2.0d rebuild)
 *
 * Per-asset cost segregation with the M2.0d standard 9-line catalog +
 * "+ Add Custom Cost" popup + 3 capex summary tables.
 *
 * Layout:
 *   1. Top bar: phase selector + stage filter
 *   2. Stage summary tile bar (4 tiles: Land / Hard / Soft / Operating)
 *   3. Per-phase, per-asset sections (collapsible, default expanded):
 *      a. Asset header (name + strategy + accounting destination)
 *      b. Cost lines table (9 standard + asset-targeted custom)
 *      c. + Add Custom Cost button (opens popup)
 *      d. Asset subtotal
 *   4. 3 summary tables:
 *      a. Capex by Period (rows: assets + total, cols: periods)
 *      b. Capex by Stage (rows: periods + total, cols: stages)
 *      c. Capex Summary by Treatment (rows: assets, cols: treatment)
 *   5. Project total (footer)
 *
 * Per the M2.0d brief Stage / Scope dropdowns are NOT user-editable; the
 * calc engine derives them from the line id (deriveCostStage) and the
 * allocationBasis (deriveCostScope). Each row shows the resolved Stage as
 * a small label and the accounting destination as a hover tooltip.
 *
 * The Custom Cost popup REQUIRES the user to pick a stage at create time
 * because the calc engine doesn't know the role of an arbitrary user line.
 */

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import {
  type Asset,
  type AssetStrategy,
  type CostLine,
  type CostMethod,
  type CostPhasing,
  type CostStage,
  type CostOverride,
  type DisplayScale,
  type DisplayDecimals,
  type OutputGranularity,
  type Phase,
  type SubUnit,
  type CostInputMode,
  type CostCategory,
  type CostDriver,
  COST_METHODS,
  COST_METHOD_LABELS,
  COST_PHASING_OPTIONS,
  COST_STAGES,
  COST_STAGE_LABELS,
  COST_CATEGORIES,
  COST_CATEGORY_LABELS,
  COST_DRIVERS,
  COST_DRIVER_LABELS,
  PER_SUBUNIT_RATE_KEY_SUPPORT,
  PER_SUBUNIT_RATE_KEY_PARKING,
  OUTPUT_GRANULARITIES,
  OUTPUT_GRANULARITY_LABELS,
  deriveLineBaseId,
} from '../../lib/state/module1-types';
import {
  computePhaseCost,
  computeAssetCost,
  computeCostLinePerSubUnit,
  resolveAssetAreaMetrics,
  aggregatePhaseMetrics,
  classifyAssetCapex,
  computeCashFlowImpact,
  resolveUsefulLifeYears,
  deriveCostStage,
  distribute,
  distributeAnnualToPeriods,
  distributeItemCost,
  generatePeriodLabels,
  costLineCaption,
  costLineProjectPeriodIndex,
  computeAssetCostSummaryFromBreakdown,
  type AssetCostBreakdown,
  type AssetCostSummaryTotals,
} from '@/src/core/calculations';
import { currencyHeaderLine, formatScaled, formatScaledCurrency, formatScaledForExport, formatAccounting } from '@/src/core/formatters';
import { AccountingNumberInput } from '../ui/AccountingNumberInput';

// ── Styles ─────────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 6px',
  fontSize: '12px',
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
  fontSize: '12px',
  fontWeight: 600,
};

const sectionCardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: 'var(--sp-2)',
  marginBottom: 'var(--sp-2)',
};

const phaseHeaderStyle: React.CSSProperties = {
  background: 'var(--color-navy)',
  color: 'var(--color-on-primary-navy)',
  padding: 'var(--sp-1) var(--sp-2)',
  fontSize: 13,
  fontWeight: 700,
  borderRadius: 'var(--radius-sm)',
  marginBottom: 'var(--sp-2)',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
};

const assetSectionStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  borderLeft: '4px solid var(--color-navy)',
  borderRadius: 'var(--radius)',
  padding: 'var(--sp-2)',
  marginBottom: 'var(--sp-2)',
  background: 'var(--color-surface)',
};

const PHASING_LABELS: Record<CostPhasing, string> = {
  even:          'Even',
  frontloaded:   'Front-loaded',
  backloaded:    'Back-loaded',
  sCurve:        'S-curve',
  manual:        'Manual %',
  phase_aligned: 'Phase-aligned',
};

// M2.0L Pass2 Fix 5 (2026-05-11): per-row unit hint for the Value cell.
// Reactive to method dropdown changes. Renders next to the value input
// so user immediately sees what they're entering (SAR/sqm vs SAR/unit
// vs % vs flat amount).
function valueUnitHint(method: CostMethod, currency: string): string {
  switch (method) {
    case 'fixed':
      return currency;
    case 'rate_per_land':
    case 'rate_per_nda':
    case 'rate_per_roads':
    case 'rate_per_gfa':
    case 'rate_per_bua':
    case 'rate_per_nsa':
    case 'rate_x_support_area':
    case 'rate_x_parking_area':
      return `${currency}/sqm`;
    case 'rate_per_unit':
      return `${currency}/unit`;
    case 'rate_per_parking_bay':
      return `${currency}/bay`;
    case 'rate_x_specific_subunit':
      return `${currency}/sqm or unit`;
    case 'per_sub_unit_custom_rates':
      return 'Multiple rates';
    case 'percent_of_selected':
    case 'percent_of_construction':
    case 'percent_of_total_land':
    case 'percent_of_cash_land':
    case 'percent_of_inkind_land':
      return '%';
    default:
      return '';
  }
}

const STAGE_BG: Record<CostStage, string> = {
  land:      'color-mix(in srgb, var(--color-navy) 12%, transparent)',
  hard:      'color-mix(in srgb, var(--color-success) 12%, transparent)',
  soft:      'color-mix(in srgb, var(--color-accent-warm) 12%, transparent)',
  operating: 'color-mix(in srgb, var(--color-grey-mid) 12%, transparent)',
};

// M2.0g Addendum 2 (2026-05-06): period labels reflect modelType +
// projectStart. Annual: "Dec 25" (end-of-year). Monthly: "Mar 25".
// idx=0 means pre-project (Y0). Inputs always annual on v8 so this
// function is mostly used by the schedule columns that render at
// outputGranularity granularity (annual default; quarterly + monthly
// transformed at display time).
function getPeriodLabel(idx: number, projectStart: string, modelType: 'monthly' | 'annual'): string {
  if (idx === 0) return 'Y0';
  const d = new Date(projectStart);
  if (Number.isNaN(d.getTime())) return modelType === 'annual' ? `Y${idx}` : `M${idx}`;
  if (modelType === 'annual') {
    // End-of-year of the period: startYear + idx - 1.
    const year = d.getUTCFullYear() + idx - 1;
    return `Dec ${String(year).slice(-2)}`;
  }
  // monthly: project start month + (idx - 1).
  const startMonthIdx = d.getUTCFullYear() * 12 + d.getUTCMonth();
  const targetMonthIdx = startMonthIdx + (idx - 1);
  const targetDate = new Date(Date.UTC(Math.floor(targetMonthIdx / 12), targetMonthIdx % 12, 1));
  return targetDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

// Accounting destination string per strategy. Shown as hover tooltip on
// each asset section header so users see where capex lands.
function accountingDestination(asset: Asset): string {
  const useful = resolveUsefulLifeYears(asset);
  switch (asset.strategy) {
    case 'Sell':
      return 'Capitalises to this asset, expensed as COGS when units sell.';
    case 'Operate':
      return `Capitalises as Fixed Asset, depreciated over ${useful} years (land never depreciates).`;
    case 'Lease':
      return `Capitalises as Fixed Asset, depreciated over ${useful} years (land never depreciates).`;
    case 'Sell + Manage':
      return 'Capitalises to this asset, expensed as COGS when units sell. No depreciation (developer does not own units post-sale).';
  }
}

// Strategy badge color
function strategyBadgeStyle(strategy: AssetStrategy): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '2px 8px',
    borderRadius: 12,
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };
  switch (strategy) {
    case 'Sell':
      return { ...base, background: 'color-mix(in srgb, var(--color-success) 18%, transparent)', color: 'var(--color-success)' };
    case 'Operate':
      return { ...base, background: 'color-mix(in srgb, var(--color-navy) 18%, transparent)', color: 'var(--color-navy)' };
    case 'Lease':
      return { ...base, background: 'color-mix(in srgb, var(--color-accent-warm) 18%, transparent)', color: 'var(--color-accent-warm)' };
    case 'Sell + Manage':
      return { ...base, background: 'color-mix(in srgb, var(--color-gold) 22%, transparent)', color: 'var(--color-heading)' };
  }
}

// ── Custom cost popup ─────────────────────────────────────────────────────
interface CustomCostPopupProps {
  phaseId: string;
  assetId: string;
  constructionPeriods: number;
  onClose: () => void;
  onSave: (line: CostLine) => void;
}

function CustomCostPopup({ phaseId, assetId, constructionPeriods, onClose, onSave }: CustomCostPopupProps): React.JSX.Element {
  const [name, setName] = useState('Custom Cost');
  const [stage, setStage] = useState<CostStage>('soft');
  const [method, setMethod] = useState<CostMethod>('fixed');
  const [value, setValue] = useState<number>(0);
  const [phasing, setPhasing] = useState<CostPhasing>('even');

  const handleSave = (): void => {
    const id = `custom-${Date.now()}`;
    // P8-Fix 5 (2026-05-12): defaults Start=0, End=maxCp+1 (1 yr buffer).
    // `constructionPeriods` is wired from the caller as the project-wide
    // max so multi-phase projects get the longest construction window
    // plus a buffer period for end-of-construction wrap-up.
    onSave({
      id,
      phaseId,
      name: name.trim() || 'Custom Cost',
      method,
      value: Math.max(0, value),
      stage,
      scope: 'direct',
      allocationBasis: 'per_asset',
      startPeriod: 0,
      endPeriod: Math.max(1, constructionPeriods + 1),
      phasing,
      targetAssetId: assetId,
    });
    onClose();
  };

  const overlay: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  };
  const modal: React.CSSProperties = {
    background: 'var(--color-surface)',
    color: 'var(--color-heading)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius)',
    padding: 'var(--sp-3)',
    minWidth: 480,
    maxWidth: 560,
    boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  };

  return (
    <div style={overlay} role="dialog" aria-modal="true" data-testid="custom-cost-popup" onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0, marginBottom: 'var(--sp-2)', fontSize: 'var(--font-h3)' }}>Add Custom Cost</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              data-testid="custom-cost-name"
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Stage</label>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as CostStage)}
              style={inputStyle}
              data-testid="custom-cost-stage"
            >
              {COST_STAGES.map((s) => (
                <option key={s} value={s}>{COST_STAGE_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as CostMethod)}
              style={inputStyle}
              data-testid="custom-cost-method"
            >
              {COST_METHODS.map((m) => (
                <option key={m} value={m}>{COST_METHOD_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Value (rate or %)</label>
            <input
              type="number"
              value={value}
              min={0}
              onChange={(e) => setValue(parseFloat(e.target.value) || 0)}
              style={inputStyle}
              data-testid="custom-cost-value"
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Phasing</label>
            <select
              value={phasing}
              onChange={(e) => setPhasing(e.target.value as CostPhasing)}
              style={inputStyle}
              data-testid="custom-cost-phasing"
            >
              {/* M2.0j Fix 9: only Even + Manual % offered to user. */}
              {COST_PHASING_OPTIONS.map((p) => (
                <option key={p} value={p}>{PHASING_LABELS[p]}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-1)' }}>
          <button type="button" className="btn-secondary" onClick={onClose} data-testid="custom-cost-cancel">Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSave} data-testid="custom-cost-save">Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Cost row (per asset section) ──────────────────────────────────────────
interface CostRowProps {
  asset: Asset;
  line: CostLine;
  override: CostOverride | undefined;
  total: number;
  isLocked: boolean;
  onUpdateLine: (patch: Partial<CostLine>) => void;
  onUpdateOverride: (override: CostOverride) => void;
  onRemoveOverride: () => void;
  onRemoveLine: () => void;
  currency: string;
  scale: DisplayScale;
  // M2.0i Fix 3 (2026-05-07): project-level displayDecimals. All
  // formatScaled calls in the row consume both scale + decimals.
  decimals: DisplayDecimals;
  // M2.0g Addendum 2: caller supplies a period -> label resolver so
  // Start / End columns display "Dec 25" alongside the integer input.
  periodLabel: (idx: number) => string;
  // M2.0g Addendum 1: phase construction periods so Manual % phasing
  // can render per-period % inputs.
  constructionPeriods: number;
  // M2.0h Fix 5 (2026-05-07): sub-units for the per-sub-unit custom
  // rates sub-row (rendered when method = 'per_sub_unit_custom_rates').
  subUnits: SubUnit[];
  // M2.0j Fix 8 (2026-05-07): asset's resolved area metrics for the
  // inline formula caption beneath the value cell. Required so the
  // caption can show "x 130,874 sqm BUA = 588,933,000 SAR".
  metrics: import('@/src/core/calculations').AssetAreaMetrics;
  // M2.0L Fix 2 (2026-05-11): when true, edits route to the cost line
  // directly (no per-asset overrides). Used by Same-mode rendering.
  editsGoToLine?: boolean;
}

function CostRow({
  asset, line, override, total, isLocked,
  onUpdateLine, onUpdateOverride, onRemoveOverride, onRemoveLine,
  currency, scale, decimals, periodLabel, constructionPeriods, subUnits,
  metrics, editsGoToLine,
}: CostRowProps): React.JSX.Element {
  // M2.0g Fix 6: Stage label still drives the row background + summary
  // tables, but the Direct/Indirect label is dropped (per-asset cost
  // segregation makes everything direct by definition).
  const stage = deriveCostStage(line);
  const isCustom = line.targetAssetId === asset.id;
  // T3-regr-2 Fix 1 (2026-05-12): split the binary isLocked into two
  // per-field gates. Land Cash + Land In-Kind keep VALUE + METHOD locked
  // (the value flows from Tab 2 parcels x asset land allocation; method
  // is fixed at percent_of_cash_land / percent_of_inkind_land) but the
  // user can still adjust Start / End / Phasing to express cash-flow
  // strategy. Auto-IDC stays fully locked (every field flows from the
  // Tab 4 Financing facility). All non-locked lines remain fully
  // editable.
  const baseId = deriveLineBaseId(line.id);
  const isLand = baseId === 'land-cash' || baseId === 'land-inkind';
  const isAutoIdc = line.id.startsWith('auto-idc__');
  const isValueLocked = isLocked; // master gate: every locked line locks Value + Method.
  const isStartEndLocked = isLocked && !isLand; // Land lines: Start/End stay editable.
  const isPhasingLocked = isLocked && !isLand; // Land lines: Phasing stays editable.
  const isNameLocked = isLocked && !isLand; // Land lines: name stays editable (rename).
  const isFullyLocked = isAutoIdc; // Auto-IDC retains the old binary semantics.
  void isFullyLocked; // exposed for future use (toggle/delete affordances).
  // M2.0g Addendum 2: resolved period labels for the row's start / end.
  const periodStartLabel = periodLabel(line.startPeriod);
  const periodEndLabel   = periodLabel(line.endPeriod);
  // M2.0L Fix 2: in Same-mode, every edit lands on the line itself
  // (no per-asset overrides). Otherwise project-wide lines still
  // surface override entries.
  const isProjectWide = !line.targetAssetId && !editsGoToLine;
  // Effective values: override wins per-asset, line provides default
  const effMethod = override?.method ?? line.method;
  const effValue = override?.value ?? line.value;
  const effPhasing = override?.phasing ?? line.phasing;
  const effDisabled = (line.disabled === true) || (override?.disabled === true);
  // M2.0L Pass 5 (2026-05-11): Category + Driver are master-level only
  // (per-asset override of category doesn't make sense - an Allocated
  // pool can't be Direct for one asset and Allocated for others).
  const effCategory: CostCategory = line.costCategory ?? 'direct';
  const effDriver: CostDriver = line.costDriver ?? 'bua_share';
  const writeCategory = (category: CostCategory): void => {
    onUpdateLine({ costCategory: category });
  };
  const writeDriver = (driver: CostDriver): void => {
    onUpdateLine({ costDriver: driver });
  };

  const writeName = (name: string): void => {
    onUpdateLine({ name });
  };
  // P10-Fix 3 (2026-05-12): hybrid write semantics.
  //   - When `override` exists on this (asset, line): edits route to
  //     the override (asset-specific divergence).
  //   - When no override: edits route to the master line (project-wide
  //     effect; every asset that doesn't override sees the new value).
  //   - For asset-specific custom lines (targetAssetId set, e.g.
  //     companion or 'Custom Cost' before Pass 10 Fix 3): edits route
  //     to the line directly (no override surface).
  // The Override toggle (rendered below) explicitly creates / removes
  // the override entry, giving the user a clear visual cue when a
  // value diverges from the project-wide master.
  const writeMethod = (method: CostMethod): void => {
    if (override) {
      onUpdateOverride({ assetId: asset.id, lineId: line.id, method, value: effValue, phasing: effPhasing, distribution: override.distribution, disabled: override.disabled, overridden: true });
    } else {
      onUpdateLine({ method });
    }
  };
  const writeValue = (value: number): void => {
    if (override) {
      onUpdateOverride({ assetId: asset.id, lineId: line.id, method: effMethod, value, phasing: effPhasing, distribution: override.distribution, disabled: override.disabled, overridden: true });
    } else {
      onUpdateLine({ value });
    }
  };
  const writePhasing = (phasing: CostPhasing): void => {
    if (override) {
      onUpdateOverride({ assetId: asset.id, lineId: line.id, method: effMethod, value: effValue, phasing, distribution: override.distribution, disabled: override.disabled, overridden: true });
    } else {
      onUpdateLine({ phasing });
    }
  };
  const writeStartPeriod = (n: number): void => {
    if (override) {
      onUpdateOverride({ assetId: asset.id, lineId: line.id, method: effMethod, value: effValue, phasing: effPhasing, distribution: override.distribution, disabled: override.disabled, startPeriod: n, endPeriod: override.endPeriod ?? line.endPeriod, overridden: true });
    } else {
      onUpdateLine({ startPeriod: n });
    }
  };
  const writeEndPeriod = (n: number): void => {
    if (override) {
      onUpdateOverride({ assetId: asset.id, lineId: line.id, method: effMethod, value: effValue, phasing: effPhasing, distribution: override.distribution, disabled: override.disabled, startPeriod: override.startPeriod ?? line.startPeriod, endPeriod: n, overridden: true });
    } else {
      onUpdateLine({ endPeriod: n });
    }
  };
  const toggleDisabled = (disabled: boolean): void => {
    if (override) {
      onUpdateOverride({ assetId: asset.id, lineId: line.id, method: effMethod, value: effValue, phasing: effPhasing, distribution: override.distribution, disabled, overridden: true });
    } else {
      onUpdateLine({ disabled });
    }
  };
  const reset = (): void => {
    if (override) onRemoveOverride();
  };
  // P10-Fix 3 (2026-05-12): startOverride seeds a CostOverride entry
  // with the master's current values so the user has a non-zero
  // starting point. Switching back to inherited master is a single
  // click on Revert (drops the override entry).
  const startOverride = (): void => {
    onUpdateOverride({
      assetId: asset.id,
      lineId: line.id,
      method: line.method,
      value: line.value,
      phasing: line.phasing,
      distribution: line.distribution,
      disabled: line.disabled === true ? true : undefined,
      perSubUnitRates: line.perSubUnitRates,
      startPeriod: line.startPeriod,
      endPeriod: line.endPeriod,
      overridden: true,
    });
  };

  // M2.0g Addendum 1: per-period % distribution editor (Manual % phasing).
  // The distribution array sits on either the line OR the per-asset
  // override. writeDistribution merges in place.
  const effDistribution = override?.distribution ?? line.distribution ?? [];
  const writeDistribution = (next: number[]): void => {
    if (isProjectWide) {
      onUpdateOverride({ assetId: asset.id, lineId: line.id, method: effMethod, value: effValue, phasing: effPhasing, distribution: next, disabled: override?.disabled });
    } else {
      onUpdateLine({ distribution: next });
    }
  };
  const updateDistAt = (idx: number, val: number): void => {
    const periods = Math.max(1, line.endPeriod - line.startPeriod + 1);
    const dist = Array.from({ length: periods }, (_, i) => effDistribution[i] ?? 0);
    dist[idx] = Math.max(0, val);
    writeDistribution(dist);
  };
  const autoNormalize = (): void => {
    const periods = Math.max(1, line.endPeriod - line.startPeriod + 1);
    const dist = Array.from({ length: periods }, (_, i) => effDistribution[i] ?? 0);
    const total = dist.reduce((s, v) => s + v, 0);
    if (total === 0) {
      // even spread fallback
      const even = 100 / periods;
      writeDistribution(dist.map(() => even));
      return;
    }
    writeDistribution(dist.map((v) => (v / total) * 100));
  };
  const distSum = effDistribution.reduce((s, v) => s + (v ?? 0), 0);

  // M2.0h Fix 5 (2026-05-07): per-sub-unit rates editor.
  // The line/override carries perSubUnitRates: { [subUnitId | __support__ | __parking__]: rate }.
  // When the user diverges per-asset, we write to the override; for
  // per-asset (custom) lines, we write to the line directly.
  const effPerSubUnitRates = override?.perSubUnitRates ?? line.perSubUnitRates ?? {};
  const writePerSubUnitRates = (next: Record<string, number>): void => {
    if (isProjectWide) {
      onUpdateOverride({
        assetId: asset.id,
        lineId: line.id,
        method: effMethod,
        value: effValue,
        phasing: effPhasing,
        distribution: override?.distribution,
        disabled: override?.disabled,
        perSubUnitRates: next,
      });
    } else {
      onUpdateLine({ perSubUnitRates: next });
    }
  };
  const updateSubUnitRate = (key: string, rate: number): void => {
    writePerSubUnitRates({ ...effPerSubUnitRates, [key]: Math.max(0, rate) });
  };

  // T3-edit-runtime v4 (2026-05-12): per-row collapse state removed
  // entirely. User feedback: "I am still seeing this layer, can you
  // diagnose and remove that layer permanently". The chevron + the
  // collapsed-state static-div branches forced an extra click before
  // any of Value / Start / End / Phasing became editable; removing
  // them makes every input render directly. Pass 9 Fix 6 compaction
  // is dropped to prioritise discoverability.
  // M2.0L Pass3 Fix 13 (2026-05-11): per-row Stage tooltip dropped.
  // Stage classification still drives the row background color (via
  // STAGE_BG[stage]) but no hover hint, no per-row caption. Strategy
  // / accounting destination lives at the asset section header tooltip.
  return (
    <>
    <tr
      data-testid={`cost-row-${asset.id}-${line.id}`}
      style={{
        background: STAGE_BG[stage],
        opacity: effDisabled ? 0.45 : 1,
      }}
    >
      <td style={{ padding: '4px', overflow: 'hidden' }}>
        <input
          type="text"
          value={line.name}
          onChange={(e) => writeName(e.target.value)}
          disabled={isNameLocked}
          style={{ ...inputStyle, width: '100%' }}
          data-testid={`cost-${asset.id}-${line.id}-name`}
          title={line.name}
        />
        {isCustom && (
          <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2 }}>custom</div>
        )}
      </td>
      <td style={{ padding: '4px', overflow: 'hidden' }}>
        <select
          value={effMethod}
          onChange={(e) => writeMethod(e.target.value as CostMethod)}
          disabled={isValueLocked}
          style={{ ...inputStyle, fontSize: 11, width: '100%' }}
          data-testid={`cost-${asset.id}-${line.id}-method`}
          title={COST_METHOD_LABELS[effMethod]}
        >
          {COST_METHODS.filter((m) => m !== 'rate_per_parking_bay').map((m) => (
            <option key={m} value={m}>{COST_METHOD_LABELS[m]}</option>
          ))}
        </select>
      </td>
      {/* P8-Fix 4 (2026-05-12): Category + Driver cells dropped from
          the row. costCategory + costDriver stay on schema for
          back-compat (calc engine treats every line as Direct in the
          Pass 7 per-asset surface). */}
      <td style={{ padding: '4px', overflow: 'hidden' }} data-debug-land-baseid={isLand ? baseId : undefined}>
        {/* T3-edit-runtime v2 (2026-05-12): Land Cash / Land In-Kind
            value cell. Always renders three artifacts so the user
            always has feedback:
              1. The numeric value (or 0) in plain text.
              2. The math caption (asset sqm x rate x cash/inKind%).
              3. A red-orange chip with the actionable next step when
                 the value is zero.
            Rendered in BOTH collapsed and expanded modes; collapsed
            just hides items #2 and #3 behind the chevron click. */}
        {(() => {
          if (!isLand) return null;
          const landDisplayValue = baseId === 'land-cash' ? metrics.cashLandValue : metrics.inKindLandValue;
          const pctKey: 'cashPct' | 'inKindPct' = baseId === 'land-cash' ? 'cashPct' : 'inKindPct';
          const landHasShare = landDisplayValue > 0;
          // Diagnostic explanation when the per-asset land value is 0.
          const zeroReason = (): string => {
            if (metrics.landSqm <= 0) return `Asset has no land allocation in Tab 2 (landSqm = ${metrics.landSqm.toFixed(0)}). Set asset's land sqm or BUA so autoByBua can derive a share.`;
            if (metrics.landValue <= 0) return `Parcel rate is 0; enter SAR/sqm in Tab 2 (landSqm = ${metrics.landSqm.toFixed(0)}, landValue = ${metrics.landValue.toFixed(0)}).`;
            return `Parcel ${pctKey} is 0; check Tab 2 cash / in-kind split (landValue = ${metrics.landValue.toFixed(0)}).`;
          };
          // T3-edit-runtime v6 (2026-05-12): caption matches the user's
          // mental model: asset land value (from Tab 2) split by the
          // parcel's cash / in-kind percentages.
          const splitPct = baseId === 'land-cash'
            ? `${(metrics.landValue > 0 ? (landDisplayValue / metrics.landValue) * 100 : 0).toFixed(0)}% cash`
            : `${(metrics.landValue > 0 ? (landDisplayValue / metrics.landValue) * 100 : 0).toFixed(0)}% in-kind`;
          const mathCaption = `Asset land value ${metrics.landValue.toLocaleString('en-US', { maximumFractionDigits: 0 })} x ${splitPct} = ${landDisplayValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
          return (
            <>
              <div
                style={{
                  fontSize: 12,
                  color: landHasShare ? 'var(--color-body)' : 'var(--color-meta)',
                  textAlign: 'right',
                  fontWeight: 700,
                  cursor: 'help',
                }}
                data-testid={`cost-${asset.id}-${line.id}-value-land`}
                title={landHasShare ? mathCaption : `Auto-derived value is 0. ${zeroReason()}`}
              >
                {landHasShare
                  ? formatAccounting(landDisplayValue, scale, decimals)
                  : (landDisplayValue === 0 ? '0' : formatAccounting(landDisplayValue, scale, decimals))}
              </div>
              <div
                style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2, textAlign: 'right', fontStyle: 'italic' }}
                data-testid={`cost-${asset.id}-${line.id}-unit-hint`}
              >
                auto from Tab 2 (locked)
              </div>
              <div
                style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2, lineHeight: 1.3, whiteSpace: 'normal' }}
                data-testid={`cost-${asset.id}-${line.id}-caption`}
              >
                {mathCaption}
              </div>
              {!landHasShare && (
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--color-on-accent-warm, white)',
                    background: 'var(--color-accent-warm)',
                    marginTop: 4,
                    padding: '3px 6px',
                    borderRadius: 4,
                    lineHeight: 1.3,
                    fontWeight: 600,
                    whiteSpace: 'normal',
                  }}
                  data-testid={`cost-${asset.id}-${line.id}-zero-hint`}
                >
                  Why 0? {zeroReason()}
                </div>
              )}
            </>
          );
        })()}
        {!isLand && (
          <>
            <AccountingNumberInput
              value={effValue}
              onChange={writeValue}
              scale="full"
              decimals={decimals}
              disabled={isValueLocked}
              style={inputStyle}
              data-testid={`cost-${asset.id}-${line.id}-value`}
            />
            <div
              style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2, textAlign: 'right', fontStyle: 'italic' }}
              data-testid={`cost-${asset.id}-${line.id}-unit-hint`}
            >
              {valueUnitHint(effMethod, currency)}
            </div>
            {(effValue !== 0 || total !== 0) && (
              <div
                style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                data-testid={`cost-${asset.id}-${line.id}-caption`}
                title={costLineCaption({ line, override, asset, metrics, parkingBays: asset.parkingBaysRequired ?? 0, resolvedTotal: total })}
              >
                {costLineCaption({ line, override, asset, metrics, parkingBays: asset.parkingBaysRequired ?? 0, resolvedTotal: total })}
              </div>
            )}
          </>
        )}
      </td>
      <td style={{ padding: '4px', width: 70 }}>
        {/* T3-edit-runtime v5 (2026-05-12): no max cap on Start. User
            asked to be able to phase costs after construction (e.g.
            commissioning, post-handover Operate fees). Only floor at
            zero. Out-of-range surfaces an informational chip below. */}
        <input
          type="number"
          min={0}
          value={line.startPeriod}
          onChange={(e) => {
            const next = parseInt(e.target.value) || 0;
            writeStartPeriod(Math.max(0, next));
          }}
          disabled={isStartEndLocked}
          style={inputStyle}
          data-testid={`cost-${asset.id}-${line.id}-start`}
        />
        <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2, textAlign: 'center' }} data-testid={`cost-${asset.id}-${line.id}-start-label`}>
          {periodStartLabel}
        </div>
        {line.startPeriod > constructionPeriods && (
          <div style={{ fontSize: 9, color: 'var(--color-accent-warm)', marginTop: 2, textAlign: 'center' }} data-testid={`cost-${asset.id}-${line.id}-start-warning`}>
            past construction
          </div>
        )}
      </td>
      <td style={{ padding: '4px', width: 70 }}>
        <input
          type="number"
          min={0}
          value={line.endPeriod}
          onChange={(e) => {
            const next = parseInt(e.target.value) || 0;
            writeEndPeriod(Math.max(0, next));
          }}
          disabled={isStartEndLocked}
          style={{
            ...inputStyle,
            ...(line.endPeriod < line.startPeriod ? { borderColor: 'var(--color-negative)' } : {}),
          }}
          data-testid={`cost-${asset.id}-${line.id}-end`}
          aria-invalid={line.endPeriod < line.startPeriod}
          title={line.endPeriod < line.startPeriod ? 'End must be on or after Start.' : ''}
        />
        <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2, textAlign: 'center' }} data-testid={`cost-${asset.id}-${line.id}-end-label`}>
          {periodEndLabel}
        </div>
        {line.endPeriod < line.startPeriod && (
          <div style={{ fontSize: 9, color: 'var(--color-negative)', marginTop: 2 }} data-testid={`cost-${asset.id}-${line.id}-end-error`}>
            End must be on or after Start
          </div>
        )}
        {line.endPeriod >= line.startPeriod && line.endPeriod > constructionPeriods && (
          <div style={{ fontSize: 9, color: 'var(--color-accent-warm)', marginTop: 2 }} data-testid={`cost-${asset.id}-${line.id}-end-warning`}>
            extends into operations period
          </div>
        )}
      </td>
      <td style={{ padding: '4px', minWidth: 110 }}>
        <select
          value={effPhasing}
          onChange={(e) => writePhasing(e.target.value as CostPhasing)}
          disabled={isPhasingLocked}
          style={{ ...inputStyle, fontSize: 11 }}
          data-testid={`cost-${asset.id}-${line.id}-phasing`}
        >
          {COST_PHASING_OPTIONS.map((p) => (
            <option key={p} value={p}>{PHASING_LABELS[p]}</option>
          ))}
        </select>
      </td>
      <td style={{ padding: '4px', minWidth: 110, textAlign: 'right' }}>
        <div style={calcOutputStyle} data-testid={`cost-${asset.id}-${line.id}-total`}>
          {formatAccounting(total, scale, decimals)}
        </div>
        {/* P10-Fix 3 (2026-05-12): per-asset Override toggle.
            Hidden for asset-specific custom lines (isCustom; the line
            already lives only on this asset) and for locked seed
            lines (Land Cash / Land In-Kind / Auto-IDC).
            - No override: shows ✏ "Override for {asset}" button.
              Click creates an override seeded from master.
            - Override active: shows ↺ "Inherit from master" button.
              Click removes the override; cell reverts to master. */}
        {isProjectWide && !isLocked && !isCustom && (
          override ? (
            <button
              type="button"
              onClick={reset}
              data-testid={`cost-${asset.id}-${line.id}-revert`}
              title={`Drop the override and inherit the project-wide value for ${asset.name}.`}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-accent-warm)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 6px',
                marginTop: 4,
                fontSize: 9,
                color: 'var(--color-accent-warm)',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              ↺ Inherit master
            </button>
          ) : (
            <button
              type="button"
              onClick={startOverride}
              data-testid={`cost-${asset.id}-${line.id}-override`}
              title={`Override the project-wide value for this cost line, only on ${asset.name}.`}
              style={{
                background: 'transparent',
                border: '1px dashed var(--color-meta)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 6px',
                marginTop: 4,
                fontSize: 9,
                color: 'var(--color-meta)',
                cursor: 'pointer',
              }}
            >
              ✏ Override
            </button>
          )
        )}
        {isProjectWide && override && (
          <div
            data-testid={`cost-${asset.id}-${line.id}-override-active`}
            style={{ fontSize: 9, color: 'var(--color-accent-warm)', marginTop: 2, fontStyle: 'italic' }}
          >
            asset-specific
          </div>
        )}
      </td>
      {/* P7-Fix 4: Toggle column = On/Off checkbox + (optional) reset. */}
      <td style={{ padding: '4px', textAlign: 'center', overflow: 'hidden' }}>
        <label style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: isLocked ? 'not-allowed' : 'pointer' }}>
          <input
            type="checkbox"
            checked={!effDisabled}
            disabled={isLocked}
            onChange={(e) => toggleDisabled(!e.target.checked)}
            data-testid={`cost-${asset.id}-${line.id}-toggle`}
          />
          On
        </label>
        {override && !isCustom && (
          <button
            type="button"
            onClick={reset}
            style={{
              ...inputStyle, background: 'transparent', cursor: 'pointer',
              fontSize: 9, marginTop: 2, color: 'var(--color-meta)',
              padding: '2px 4px',
            }}
            data-testid={`cost-${asset.id}-${line.id}-reset`}
          >
            reset
          </button>
        )}
      </td>
      {/* P7-Fix 4: Delete column = ✕ button only. Hidden for locked rows
          (Land Cash / Land In-Kind / auto-IDC). */}
      <td style={{ padding: '4px', textAlign: 'center', overflow: 'hidden' }}>
        {!isLocked && (
          <button
            type="button"
            onClick={() => {
              const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
                ? window.confirm(`Delete cost line "${line.name}"?`)
                : true;
              if (ok) onRemoveLine();
            }}
            style={{
              background: 'transparent', border: '1px solid var(--color-border)', cursor: 'pointer',
              fontSize: 12, color: 'var(--color-negative)', borderRadius: 'var(--radius-sm)',
              padding: '2px 6px', lineHeight: 1,
            }}
            title={isCustom ? 'Delete custom cost line' : 'Delete cost line'}
            data-testid={`cost-${asset.id}-${line.id}-remove`}
          >
            ✕
          </button>
        )}
      </td>
    </tr>
    {/* M2.0g Addendum 1: Manual % per-period inputs sub-row.
        Renders only when the effective phasing is 'manual'. The
        period range is [line.startPeriod, line.endPeriod]; one input
        per period in that range. Sum indicator + auto-normalize
        button on the right. M2.0L (2026-05-11) adds the live currency
        chip strip below the % inputs so the user sees the actual
        money distribution as they edit weights. */}
    {effPhasing === 'manual' && (() => {
      const periods = Math.max(1, line.endPeriod - line.startPeriod + 1);
      const sumOk = Math.abs(distSum - 100) < 0.5;
      // Money per period = total × pct/100 when sum~=100; otherwise
      // total × pct/sum (so partial sums still produce sensible chips).
      const sumDenom = distSum > 0 ? distSum : 1;
      return (
        <tr data-testid={`cost-row-${asset.id}-${line.id}-manual-row`} style={{ background: 'var(--color-grey-pale)' }}>
          <td colSpan={9} style={{ padding: '8px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>
                Manual %
              </strong>
              {Array.from({ length: periods }, (_, i) => {
                const periodIdx = line.startPeriod + i;
                return (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={effDistribution[i] ?? 0}
                      onChange={(e) => updateDistAt(i, parseFloat(e.target.value) || 0)}
                      disabled={isLocked}
                      data-testid={`cost-${asset.id}-${line.id}-manual-${i}`}
                      style={{ ...inputStyle, width: 60, fontSize: 11 }}
                    />
                    <span style={{ fontSize: 9, color: 'var(--color-meta)' }}>{periodLabel(periodIdx)}</span>
                  </div>
                );
              })}
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: sumOk ? 'var(--color-success)' : 'var(--color-accent-warm)' }} data-testid={`cost-${asset.id}-${line.id}-manual-sum`}>
                Sum: {distSum.toFixed(1)}% {sumOk ? '✓' : '(need 100%)'}
              </span>
              <button
                type="button"
                onClick={autoNormalize}
                disabled={isLocked}
                data-testid={`cost-${asset.id}-${line.id}-manual-normalize`}
                style={{
                  fontSize: 11,
                  padding: '4px 10px',
                  background: 'var(--color-navy)',
                  color: 'var(--color-on-primary-navy)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: isLocked ? 'not-allowed' : 'pointer',
                }}
              >
                Auto-normalize
              </button>
            </div>
            {/* M2.0L: currency chip strip below the % inputs. Shows
                the live money distribution per period given the
                current weights and the line's total. */}
            <div
              style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, paddingTop: 6, borderTop: '1px dashed var(--color-border)' }}
              data-testid={`cost-${asset.id}-${line.id}-manual-money-chips`}
            >
              <strong style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)', alignSelf: 'center' }}>
                Money {currency}
              </strong>
              {Array.from({ length: periods }, (_, i) => {
                const periodIdx = line.startPeriod + i;
                const pct = effDistribution[i] ?? 0;
                const money = (total * pct) / sumDenom;
                const positive = money > 0;
                return (
                  <span
                    key={i}
                    data-testid={`cost-${asset.id}-${line.id}-money-${i}`}
                    title={`${periodLabel(periodIdx)}: ${formatAccounting(money, scale, decimals)}`}
                    style={{
                      display: 'inline-flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      padding: '3px 6px',
                      minWidth: 64,
                      borderRadius: 4,
                      background: positive
                        ? 'color-mix(in srgb, var(--color-navy) 12%, transparent)'
                        : 'var(--color-grey-pale)',
                      fontSize: 10,
                      fontWeight: positive ? 700 : 400,
                      color: positive ? 'var(--color-heading)' : 'var(--color-meta)',
                    }}
                  >
                    <span style={{ fontSize: 9, color: 'var(--color-meta)', fontWeight: 400 }}>{periodLabel(periodIdx)}</span>
                    <span>{formatAccounting(money, scale, decimals)}</span>
                  </span>
                );
              })}
            </div>
          </td>
        </tr>
      );
    })()}
    {/* T3-edit-runtime v6 (2026-05-12): per-row period chip strip.
        Renders ONLY when phasing != manual; Manual % phasing has its
        own % grid + money chip strip below (so we don't double-render
        and confuse the user). Chips span the line's actual
        [startPeriod, endPeriod] range, including periods past
        construction; distributeItemCost sizes the output array to
        fit endPeriod regardless of cp. */}
    {!effDisabled && total > 0 && line.endPeriod > 0 && effPhasing !== 'manual' && (() => {
      const perPeriod = distributeItemCost(
        { ...line, phasing: effPhasing, distribution: effDistribution },
        total,
        constructionPeriods,
      );
      const start = Math.max(0, line.startPeriod);
      const end = Math.max(start, line.endPeriod);
      const chips: Array<{ idx: number; amount: number }> = [];
      for (let p = start; p <= end; p++) {
        chips.push({ idx: p, amount: perPeriod[p] ?? 0 });
      }
      if (chips.length === 0) return null;
      return (
        <tr data-testid={`cost-row-${asset.id}-${line.id}-chip-strip`} style={{ background: 'transparent' }}>
          <td colSpan={9} style={{ padding: '2px 12px 6px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {chips.map(({ idx, amount }) => {
                const positive = amount > 0;
                return (
                  <span
                    key={idx}
                    data-testid={`cost-${asset.id}-${line.id}-chip-${idx}`}
                    title={`${periodLabel(idx)}: ${formatAccounting(amount, scale, decimals)}`}
                    style={{
                      display: 'inline-flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      padding: '2px 6px',
                      minWidth: 60,
                      borderRadius: 4,
                      background: positive
                        ? 'color-mix(in srgb, var(--color-navy) 8%, transparent)'
                        : 'var(--color-grey-pale)',
                      fontSize: 10,
                      fontWeight: positive ? 600 : 400,
                      color: positive ? 'var(--color-heading)' : 'var(--color-meta)',
                    }}
                  >
                    <span style={{ fontSize: 9, color: 'var(--color-meta)', fontWeight: 400 }}>{periodLabel(idx)}</span>
                    <span>{formatAccounting(amount, scale, decimals)}</span>
                  </span>
                );
              })}
            </div>
          </td>
        </tr>
      );
    })()}
    {/* M2.0L (2026-05-11): % of Selected Lines checkbox picker. Renders
        only when method === 'percent_of_selected'. Lets user toggle
        which sibling lines (same phase + same asset / project-wide)
        compose the base. Was a free-form selectedLineIds array before;
        the picker is the canonical editor now. */}
    {effMethod === 'percent_of_selected' && (
      <PercentOfSelectedPicker
        line={line}
        asset={asset}
        isLocked={isLocked}
        onChangeSelected={(ids) => onUpdateLine({ selectedLineIds: ids })}
      />
    )}
    {/* M2.0h Fix 5 (2026-05-07): Per-sub-unit custom rates sub-row.
        Renders only when effMethod === 'per_sub_unit_custom_rates'.
        Lists each sub-unit + asset-level Support + asset-level Parking
        with an editable rate input and a derived total (area × rate). */}
    {effMethod === 'per_sub_unit_custom_rates' && (() => {
      const breakdown = computeCostLinePerSubUnit(
        { ...line, value: effValue, perSubUnitRates: effPerSubUnitRates },
        asset,
        subUnits,
      );
      return (
        <tr data-testid={`cost-row-${asset.id}-${line.id}-per-subunit-row`} style={{ background: 'var(--color-grey-pale)' }}>
          <td colSpan={9} style={{ padding: '8px 12px' }}>
            <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>Per Sub-unit Custom Rates</strong>
              <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>(default rate {effValue} from Value column when row blank)</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                  <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sub-unit</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Area (sqm)</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rate ({currency}/sqm)</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.rows.map((r) => (
                  <tr key={r.key} data-testid={`cost-${asset.id}-${line.id}-per-subunit-${r.key}`}>
                    <td style={{ padding: '4px 8px' }}>{r.label}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{r.area.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={effPerSubUnitRates[r.key] ?? r.rate}
                        onChange={(e) => updateSubUnitRate(r.key, parseFloat(e.target.value) || 0)}
                        disabled={isLocked}
                        data-testid={`cost-${asset.id}-${line.id}-per-subunit-${r.key}-rate`}
                        style={{ ...inputStyle, width: 110, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }} data-testid={`cost-${asset.id}-${line.id}-per-subunit-${r.key}-total`}>
                      {formatAccounting(r.total, scale, decimals)}
                    </td>
                  </tr>
                ))}
                {breakdown.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: '8px', color: 'var(--color-meta)', textAlign: 'center', fontStyle: 'italic' }}>
                      No sub-units / Support / Parking on this asset. Add them in Tab 2.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{ background: 'color-mix(in srgb, var(--color-navy) 8%, transparent)', fontWeight: 700 }}>
                  <td colSpan={3} style={{ padding: '4px 8px', textAlign: 'right' }}>Sub-row total</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }} data-testid={`cost-${asset.id}-${line.id}-per-subunit-total`}>
                    {formatAccounting(breakdown.totalCost, scale, decimals)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </td>
        </tr>
      );
    })()}
    </>
  );
}

// ── M2.0L: % of Selected Lines checkbox picker ────────────────────────────
// Renders a scrollable list of sibling cost lines (same phase, either
// project-wide or targeted at this asset) with checkboxes for which
// ones compose the percent_of_selected base. The current selection is
// the line.selectedLineIds array.
function PercentOfSelectedPicker({
  line, asset, isLocked, onChangeSelected,
}: {
  line: CostLine;
  asset: Asset;
  isLocked: boolean;
  onChangeSelected: (ids: string[]) => void;
}): React.JSX.Element {
  // M2.0M Pass 6 Fix 6 (2026-05-11): rebuilt as a dropdown button +
  // chip strip. The button shows "{N} lines selected"; clicking opens
  // a popover with the full sibling list as checkboxes (scrolls to
  // 240px). Apply persists; click outside closes. Selected lines also
  // render as small chips beneath the button so the user sees what's
  // chosen without opening the picker.
  const costLines = useModule1Store(useShallow((s) => s.costLines));
  const [open, setOpen] = useState(false);
  // Sibling lines: same phase, NOT this line itself, NOT a
  // percent_of_selected (we don't allow recursive references), and
  // visible to this asset (project-wide OR targeted at this asset).
  const siblings = costLines.filter((c) =>
    c.phaseId === line.phaseId &&
    c.id !== line.id &&
    c.method !== 'percent_of_selected' &&
    (c.targetAssetId === undefined || c.targetAssetId === asset.id),
  );
  const selected = new Set(line.selectedLineIds ?? []);
  const toggle = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChangeSelected(Array.from(next));
  };
  const selectedLines = siblings.filter((s) => selected.has(s.id));

  return (
    <tr data-testid={`cost-row-${asset.id}-${line.id}-pct-picker`} style={{ background: 'var(--color-grey-pale)' }}>
      {/* P8-Fix 6 (2026-05-12): colSpan synced to 9 cols (Pass 8 dropped
          Category + Driver). Previously stale at 11 causing the picker
          to render misaligned and occasionally hidden when the row was
          clipped by overflow:hidden cells. */}
      <td colSpan={9} style={{ padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)', paddingTop: 6 }}>
            Apply to:
          </strong>
          <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
            <button
              type="button"
              disabled={isLocked}
              onClick={() => setOpen((o) => !o)}
              data-testid={`cost-${asset.id}-${line.id}-pct-picker-button`}
              style={{
                fontSize: 11, padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                background: 'var(--color-surface)', color: 'var(--color-body)',
                border: '1px solid var(--color-border)',
                cursor: isLocked ? 'not-allowed' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <span>Select lines</span>
              <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>
                ({selected.size} selected)
              </span>
              <span style={{ fontSize: 9, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
            </button>
            {open && (
              <>
                {/* Click-outside backdrop, transparent. */}
                <div
                  onClick={() => setOpen(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 10 }}
                  data-testid={`cost-${asset.id}-${line.id}-pct-picker-backdrop`}
                />
                <div
                  style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0,
                    minWidth: 320, maxWidth: 480,
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)', boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
                    zIndex: 20, padding: 8,
                  }}
                  data-testid={`cost-${asset.id}-${line.id}-pct-picker-popover`}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <span>Base lines for the %</span>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      data-testid={`cost-${asset.id}-${line.id}-pct-picker-close`}
                      style={{ fontSize: 10, padding: '2px 8px', background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                    >
                      Done
                    </button>
                  </div>
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 4 }}
                    data-testid={`cost-${asset.id}-${line.id}-pct-picker-list`}
                  >
                    {siblings.length === 0 && (
                      <div style={{ fontSize: 11, color: 'var(--color-meta)', fontStyle: 'italic', padding: 6 }}>
                        No eligible sibling lines in this phase. Add construction / soft / land cost lines first.
                      </div>
                    )}
                    {siblings.map((s) => {
                      const checked = selected.has(s.id);
                      return (
                        <label
                          key={s.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            fontSize: 11,
                            cursor: isLocked ? 'not-allowed' : 'pointer',
                            padding: '4px 6px',
                            background: checked ? 'color-mix(in srgb, var(--color-navy) 8%, transparent)' : 'transparent',
                            borderRadius: 3,
                          }}
                          data-testid={`cost-${asset.id}-${line.id}-pct-picker-${s.id}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(s.id)}
                            disabled={isLocked}
                          />
                          <span>{s.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            {/* Chip strip beneath the button. */}
            {selectedLines.length > 0 && (
              <div
                style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}
                data-testid={`cost-${asset.id}-${line.id}-pct-picker-chips`}
              >
                {selectedLines.map((s) => (
                  <span
                    key={s.id}
                    style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 12,
                      background: 'color-mix(in srgb, var(--color-navy) 10%, transparent)',
                      color: 'var(--color-navy)',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}
                    data-testid={`cost-${asset.id}-${line.id}-pct-picker-chip-${s.id}`}
                  >
                    {s.name}
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() => toggle(s.id)}
                        title="Remove from base"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 11, padding: 0, lineHeight: 1 }}
                      >
                        x
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Per-asset section ─────────────────────────────────────────────────────
interface AssetCostSectionProps {
  asset: Asset;
  lines: CostLine[];                  // visible to this asset (project + custom-targeted)
  costOverrides: CostOverride[];
  breakdown: AssetCostBreakdown;
  currency: string;
  scale: DisplayScale;
  decimals: DisplayDecimals;
  periodLabel: (idx: number) => string;
  constructionPeriods: number;
  subUnits: SubUnit[];
  // M2.0j Fix 8: asset's resolved metrics for cost line caption rendering.
  metrics: import('@/src/core/calculations').AssetAreaMetrics;
  onUpdateLine: (lineId: string, patch: Partial<CostLine>) => void;
  onUpdateOverride: (override: CostOverride) => void;
  onRemoveOverride: (assetId: string, lineId: string) => void;
  onRemoveLine: (lineId: string) => void;
  onAddCustom: () => void;
}

function AssetCostSection({
  asset, lines, costOverrides, breakdown, currency, scale, decimals, periodLabel, constructionPeriods, subUnits,
  metrics,
  onUpdateLine, onUpdateOverride, onRemoveOverride, onRemoveLine,
  onAddCustom,
}: AssetCostSectionProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const dest = accountingDestination(asset);
  const subtotal = breakdown.total;

  return (
    <div style={assetSectionStyle} data-testid={`asset-section-${asset.id}`}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: collapsed ? 0 : 'var(--sp-1)',
          cursor: 'pointer',
        }}
        onClick={() => setCollapsed(!collapsed)}
        title={dest}
      >
        {/* M2.0L Pass3 Fix 13 (2026-05-11): the verbose destination
            sentence ("Capitalises to this asset, expensed as COGS when
            units sell...") that used to render inline next to the
            strategy badge has been folded into the section's hover
            title attribute. Header stays compact (asset name + strategy
            badge only); the accounting treatment is one hover away.
            Cost line rows below carry no strategy/destination text. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{asset.name}</span>
          <span style={strategyBadgeStyle(asset.strategy)} data-testid={`asset-section-${asset.id}-strategy`}>
            {asset.strategy}
          </span>
          <span
            data-testid={`asset-section-${asset.id}-destination`}
            style={{ display: 'none' }}
          >
            {dest}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--color-meta)' }}>Subtotal</span>
          <strong style={{ fontSize: 14 }} data-testid={`asset-section-${asset.id}-subtotal`}>
            {formatAccounting(subtotal, scale, decimals)}
          </strong>
          <span style={{ fontSize: 14, color: 'var(--color-meta)' }}>{collapsed ? '▶' : '▼'}</span>
        </div>
      </div>
      {!collapsed && (
        <>
          {/* P11 Fix 3 (2026-05-13): per-section Expand all / Collapse all
              buttons removed. Per-row collapse state was deleted in
              T3-edit-runtime v4 ("remove that layer permanently"), so the
              bulk toggle had no row state to flip; clicks were no-ops. */}
          {/* P8-Fix 4 (2026-05-12): cost table reduced from 11 cols to 9.
              Category + Driver columns dropped (Pass 5 Direct/Allocated
              + per-driver split surface caused confusion; every cost line
              now treated as Direct since Pass 7 architecture is per-asset).
              costCategory + costDriver stay on schema for back-compat;
              calc engine treats every line as Direct. Columns:
              Cost Line 240, Method 220, Value 140, Start 60, End 60,
              Phasing 110, Total 160, Toggle 60, Delete 40. */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 240 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 40 }} />
            </colgroup>
            <thead>
              <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                <th style={{ padding: '6px', textAlign: 'left' }}>Cost Line</th>
                <th style={{ padding: '6px', textAlign: 'left' }}>Method</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>Value</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>Start</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>End</th>
                <th style={{ padding: '6px', textAlign: 'left' }}>Phasing</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>Total</th>
                <th style={{ padding: '6px', textAlign: 'center' }}>Toggle</th>
                <th style={{ padding: '6px', textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const override = costOverrides.find((o) => o.assetId === asset.id && o.lineId === line.id);
                const total = breakdown.byLineId[line.id] ?? 0;
                return (
                  <CostRow
                    key={line.id}
                    asset={asset}
                    line={line}
                    override={override}
                    total={total}
                    isLocked={line.isLocked === true}
                    currency={currency}
                    scale={scale}
                    decimals={decimals}
                    periodLabel={periodLabel}
                    constructionPeriods={constructionPeriods}
                    subUnits={subUnits}
                    metrics={metrics}
                    onUpdateLine={(patch) => onUpdateLine(line.id, patch)}
                    onUpdateOverride={onUpdateOverride}
                    onRemoveOverride={() => onRemoveOverride(asset.id, line.id)}
                    onRemoveLine={() => onRemoveLine(line.id)}
                  />
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--color-grey-pale)' }}>
                <td colSpan={6} style={{ padding: '6px', textAlign: 'right', fontWeight: 700 }}>
                  Asset Subtotal
                </td>
                <td style={{ padding: '6px', textAlign: 'right', fontWeight: 700 }} data-testid={`asset-section-${asset.id}-tfoot-subtotal`}>
                  {formatAccounting(subtotal, scale, decimals)}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--sp-1)' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onAddCustom}
              style={{ fontSize: 11, padding: '4px 10px' }}
              data-testid={`asset-section-${asset.id}-add-custom`}
            >
              + Add Custom Cost
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── 4 Capex summary tables (M2.0g Fix 7) ────────────────────────────────
interface SummaryTablesProps {
  phaseAssets: Asset[];
  perPhaseBreakdowns: Array<{ phaseId: string; cp: number; assetTotals: Record<string, AssetCostBreakdown> }>;
  parcelsByPhase: Map<string, { cashLandValue: number; inKindLandValue: number }>;
  metricsByAsset: Map<string, ReturnType<typeof resolveAssetAreaMetrics>>;
  project: { currency: string; startDate: string; modelType: 'monthly' | 'annual'; displayScale: DisplayScale; displayDecimals: DisplayDecimals };
  totalConstructionPeriods: number;
  // M2.0g Fix 7a: per-cost-line breakdown needs the full line list so
  // each asset's lines can be enumerated under its row.
  costLines: CostLine[];
  // M2.0h Fix 6 (2026-05-07): runtime output granularity. Annual inputs
  // distribute to quarterly (4×) or monthly (12×) using cost line phasing.
  granularity: OutputGranularity;
  // M2.0j Fix 11 (2026-05-07): phase list for phase-start-aware
  // period allocation in Capex by Period.
  phases: Phase[];
}

function SummaryTables({
  phaseAssets, perPhaseBreakdowns, metricsByAsset,
  project, totalConstructionPeriods, costLines, granularity, phases,
}: SummaryTablesProps): React.JSX.Element {
  const scale = project.displayScale;
  const decimals = project.displayDecimals ?? 2;
  // M2.0M Pass 4 Fix 6 (2026-05-12): universal accounting format applied
  // across Module 1. zero -> "-", negative -> parens, null/undef -> blank.
  // Results sub-tab header-line "All figures in SAR '000" via
  // currencyHeaderLine; cells stay clean and tabular.
  const fmt = (v: number): string => formatAccounting(v, scale, decimals);
  // M2.0h Fix 6: at annual granularity, 1 column per construction year
  // (capped at 24 for layout). At quarterly: 4× columns. Monthly: 12×.
  const annualPeriodCount = Math.min(totalConstructionPeriods, 24);
  const subPerYear = granularity === 'annual' ? 1 : granularity === 'quarterly' ? 4 : 12;
  const periodCount = annualPeriodCount * subPerYear;
  // Period labels respect granularity: 'Dec 25' / 'Q1 25' / 'Jan 25'.
  const periodLabels = generatePeriodLabels(project.startDate, annualPeriodCount, granularity);

  // P11 Fix 4 (2026-05-13): crop the rendered column range to the
  // periods where in-scope assets actually have cost activity.
  // Walks every in-scope asset's bd.perPeriod across every phase,
  // applies the same offset = phaseStartYear - projectStartYear shift
  // used by the row builders, and tracks the min / max non-zero
  // annual column. Combined view -> union across phaseAssets; Single
  // Asset view -> just that asset's span (phaseAssets is already
  // filtered upstream when resultsViewMode = 'single_asset'). With a
  // project starting 2025 and the earliest activity in 2026, the
  // leading "Dec 25" column drops out; with the latest activity in
  // 2030, trailing empty columns drop out too.
  const projectStartYearForCrop = new Date(project.startDate).getUTCFullYear();
  let activeFirstAnnual = annualPeriodCount;
  let activeLastAnnual = -1;
  for (const asset of phaseAssets) {
    for (const pb of perPhaseBreakdowns) {
      const bd = pb.assetTotals[asset.id];
      if (!bd) continue;
      const phaseObj = phases.find((p) => p.id === pb.phaseId);
      const phaseStartIso = phaseObj?.startDate && phaseObj.startDate.length === 10
        ? phaseObj.startDate
        : project.startDate;
      const phaseStartYear = new Date(phaseStartIso).getUTCFullYear();
      const offset = Number.isFinite(phaseStartYear - projectStartYearForCrop)
        ? Math.max(0, phaseStartYear - projectStartYearForCrop)
        : 0;
      // perPeriod[0] is the upfront / Y0 lump. For Phase 1 it lives
      // at project Y0 (outside the column grid so not counted as
      // activity here). For later phases it lands at offset - 1.
      if (offset > 0 && offset - 1 >= 0 && offset - 1 < annualPeriodCount) {
        if (Math.abs(bd.perPeriod[0] ?? 0) > 0.5) {
          if (offset - 1 < activeFirstAnnual) activeFirstAnnual = offset - 1;
          if (offset - 1 > activeLastAnnual) activeLastAnnual = offset - 1;
        }
      }
      for (let i = 1; i < bd.perPeriod.length; i++) {
        if (Math.abs(bd.perPeriod[i] ?? 0) <= 0.5) continue;
        const col = offset + i - 1;
        if (col >= 0 && col < annualPeriodCount) {
          if (col < activeFirstAnnual) activeFirstAnnual = col;
          if (col > activeLastAnnual) activeLastAnnual = col;
        }
      }
    }
  }
  if (activeLastAnnual < activeFirstAnnual) {
    // No activity in scope: keep one column so colSpan stays > 0 and
    // empty-state messages render correctly.
    activeFirstAnnual = 0;
    activeLastAnnual = Math.max(0, annualPeriodCount - 1);
  }
  const cropSubFirst = activeFirstAnnual * subPerYear;
  const cropSubCount = (activeLastAnnual - activeFirstAnnual + 1) * subPerYear;
  function cropRow<T>(arr: T[]): T[] {
    return arr.slice(cropSubFirst, cropSubFirst + cropSubCount);
  }
  const croppedPeriodLabels = cropRow(periodLabels);
  const croppedPeriodCount = cropSubCount;

  // M2.0h Fix 6: per-asset per-period at chosen granularity. Annual
  // values from the calc engine (one per year) get distributed to
  // sub-periods using even phasing within each year; the cost-line-
  // level phasing across years is preserved by the calc engine. The
  // upfront perPeriod[0] is a Y0 lump that we keep at year 0 first
  // sub-period.
  const transformAnnualSeries = (annual: number[]): number[] => {
    if (granularity === 'annual') return [...annual];
    // Even-spread within year for now (manual % per-period within year
    // is deferred to advanced).
    return distributeAnnualToPeriods(annual, granularity, 'even');
  };
  // P11 Fix 2 (2026-05-13): apply phase offset when placing per-asset
  // perPeriod values onto the project-wide axis. Previously the loop
  // dropped each bd.perPeriod[i+1] into annualRow[i] regardless of
  // phaseStartYear, which misaligned Phase 2+ assets by their full
  // phase offset (a Phase 2 asset starting 2026 had its Y1 spend
  // posted to the project's 2025 column). The per-asset table rows
  // already corrected for this offset inline; this builder now
  // matches so periodTotals (used by the Project Total footer)
  // agrees with the asset rows it sums.
  const projectStartYearTable = new Date(project.startDate).getUTCFullYear();
  const periodTable = phaseAssets.map((a) => {
    const annualRow = new Array<number>(annualPeriodCount).fill(0);
    for (const pb of perPhaseBreakdowns) {
      const bd = pb.assetTotals[a.id];
      if (!bd) continue;
      const phaseObj = phases.find((p) => p.id === pb.phaseId);
      const phaseStartIso = phaseObj?.startDate && phaseObj.startDate.length === 10
        ? phaseObj.startDate
        : project.startDate;
      const phaseStartYear = new Date(phaseStartIso).getUTCFullYear();
      const offset = Number.isFinite(phaseStartYear - projectStartYearTable)
        ? Math.max(0, phaseStartYear - projectStartYearTable)
        : 0;
      // P11 Fix 6: iterate the full perPeriod length so operating-tail
      // costs (lines with endPeriod > cp) survive into the project axis.
      for (let i = 1; i < bd.perPeriod.length; i++) {
        const v = bd.perPeriod[i] ?? 0;
        if (v === 0) continue;
        const dest = offset + i - 1;
        if (dest >= 0 && dest < annualPeriodCount) {
          annualRow[dest] += v;
        }
      }
      // perPeriod[0] is the upfront / Y0 lump. For Phase 1 it lands at
      // project Y0, which is outside the column grid (grid starts at Y1).
      // For later phases the upfront falls at the phase's first project
      // year minus one (= the year before the phase begins).
      if (offset > 0 && offset - 1 < annualPeriodCount && offset - 1 >= 0) {
        annualRow[offset - 1] += bd.perPeriod[0] ?? 0;
      }
    }
    const row = transformAnnualSeries(annualRow);
    return { id: a.id, name: a.name, row };
  });
  const periodTotals = new Array<number>(periodCount).fill(0);
  for (const r of periodTable) {
    for (let i = 0; i < periodCount; i++) periodTotals[i] += r.row[i] ?? 0;
  }

  // Capex by Stage: rows = period (cap 24), cols = land/hard/soft/operating/total.
  // M2.0h Fix 6: stage rows distributed annually first, then split to
  // sub-periods per granularity.
  const annualStageRows: Array<{ land: number; hard: number; soft: number; operating: number }> = [];
  for (let i = 0; i < annualPeriodCount; i++) {
    let land = 0, hard = 0, soft = 0, operating = 0;
    for (const pb of perPhaseBreakdowns) {
      for (const a of phaseAssets) {
        const bd = pb.assetTotals[a.id];
        if (!bd) continue;
        const periodAmt = bd.perPeriod[i + 1] ?? 0;
        const totalAmt = bd.total;
        if (totalAmt <= 0) continue;
        const share = periodAmt / totalAmt;
        land += bd.byStage.land * share;
        hard += bd.byStage.hard * share;
        soft += bd.byStage.soft * share;
        operating += bd.byStage.operating * share;
      }
    }
    annualStageRows.push({ land, hard, soft, operating });
  }
  const landSeries = transformAnnualSeries(annualStageRows.map((r) => r.land));
  const hardSeries = transformAnnualSeries(annualStageRows.map((r) => r.hard));
  const softSeries = transformAnnualSeries(annualStageRows.map((r) => r.soft));
  const operatingSeries = transformAnnualSeries(annualStageRows.map((r) => r.operating));
  const stageTable = periodLabels.map((p, idx) => ({
    period: p,
    land: landSeries[idx] ?? 0,
    hard: hardSeries[idx] ?? 0,
    soft: softSeries[idx] ?? 0,
    operating: operatingSeries[idx] ?? 0,
    total: (landSeries[idx] ?? 0) + (hardSeries[idx] ?? 0) + (softSeries[idx] ?? 0) + (operatingSeries[idx] ?? 0),
  }));
  const stageTotals = stageTable.reduce(
    (acc, r) => ({
      land: acc.land + r.land,
      hard: acc.hard + r.hard,
      soft: acc.soft + r.soft,
      operating: acc.operating + r.operating,
      total: acc.total + r.total,
    }),
    { land: 0, hard: 0, soft: 0, operating: 0, total: 0 },
  );

  // Capex Summary by Treatment: rows = assets, cols = land cash, land in-kind, hard, soft, operating, total, cash flow impact
  const treatmentTable = phaseAssets.map((a) => {
    const m = metricsByAsset.get(a.id) ?? { cashLandValue: 0, inKindLandValue: 0, landValue: 0 };
    let hard = 0, soft = 0, operating = 0, total = 0;
    for (const pb of perPhaseBreakdowns) {
      const bd = pb.assetTotals[a.id];
      if (!bd) continue;
      hard += bd.byStage.hard;
      soft += bd.byStage.soft;
      operating += bd.byStage.operating;
      total += bd.total;
    }
    const cashFlow = computeCashFlowImpact(total, m.inKindLandValue);
    return {
      id: a.id,
      name: a.name,
      strategy: a.strategy,
      landCash: m.cashLandValue,
      landInKind: m.inKindLandValue,
      hard,
      soft,
      operating,
      total,
      cashOutflow: cashFlow.cashOutflow,
    };
  });
  const treatTotals = treatmentTable.reduce(
    (acc, r) => ({
      landCash: acc.landCash + r.landCash,
      landInKind: acc.landInKind + r.landInKind,
      hard: acc.hard + r.hard,
      soft: acc.soft + r.soft,
      operating: acc.operating + r.operating,
      total: acc.total + r.total,
      cashOutflow: acc.cashOutflow + r.cashOutflow,
    }),
    { landCash: 0, landInKind: 0, hard: 0, soft: 0, operating: 0, total: 0, cashOutflow: 0 },
  );

  const cellNum: React.CSSProperties = { padding: '4px 6px', textAlign: 'right', fontSize: 11 };
  const cellName: React.CSSProperties = { padding: '4px 6px', textAlign: 'left', fontSize: 11, fontWeight: 600 };
  const headStyle: React.CSSProperties = { background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)', padding: '6px', textAlign: 'right', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' };
  const headLeftStyle: React.CSSProperties = { ...headStyle, textAlign: 'left' };

  // M2.0g Fix 7e: 4th summary table - Capex by Cost Type per Asset.
  // Rows = assets, cols = Land Cash / Land In-Kind / Hard / Soft /
  // Operating / Total. Treatment = derived from cost line stage (Land
  // splits into Cash + In-Kind via metricsByAsset).
  const matrixRows = treatmentTable;  // same source as Table 3 minus cashFlow col

  return (
    <>
      {/* M2.0g Fix 7a + 7d: Table 1 - Capex by Period (per cost-line
          breakdown). Asset rows are followed by per-cost-line nested
          rows so the user can audit each line's per-period spend. Total
          column is in the 2nd position. */}
      <div style={sectionCardStyle} data-testid="capex-by-period">
        <strong style={{ fontSize: 13, display: 'block', marginBottom: 'var(--sp-1)' }} data-testid="capex-table-1-title">Table 1 - Construction Cost Schedule by Period (per cost line, per asset)</strong>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={headLeftStyle}>Asset / Cost Line</th>
                <th style={headStyle}>Total</th>
                {croppedPeriodLabels.map((p, i) => (<th key={i} style={headStyle}>{p}</th>))}
              </tr>
            </thead>
            <tbody>
              {phaseAssets.map((a) => {
                // Asset subtotal row + per-line nested rows. M2.0h Fix 6:
                // annual values transformed to display granularity.
                // M2.0j Fix 11 audit: phase perPeriod[i+1] now offsets
                // by (phaseStartYear - projectStartYear) so Phase 2
                // (start 2026) Y1 lands in project column "Dec 26",
                // not "Dec 25".
                const projectStartYear = new Date(project.startDate).getUTCFullYear();
                const assetRowAnnual = new Array<number>(annualPeriodCount).fill(0);
                let assetTotal = 0;
                for (const pb of perPhaseBreakdowns) {
                  const bd = pb.assetTotals[a.id];
                  if (!bd) continue;
                  assetTotal += bd.total;
                  // Determine phase offset from project start.
                  const phaseObj = phases.find((p) => p.id === pb.phaseId);
                  const phaseStartIso = phaseObj?.startDate && phaseObj.startDate.length === 10
                    ? phaseObj.startDate
                    : project.startDate;
                  const phaseStartYear = new Date(phaseStartIso).getUTCFullYear();
                  const offset = Number.isFinite(phaseStartYear - projectStartYear)
                    ? Math.max(0, phaseStartYear - projectStartYear)
                    : 0;
                  // P11 Fix 6: iterate the full perPeriod length so
                  // operating-tail costs (lines with endPeriod > cp)
                  // appear in the project axis.
                  for (let i = 1; i < bd.perPeriod.length; i++) {
                    const v = bd.perPeriod[i] ?? 0;
                    if (v === 0) continue;
                    const dest = offset + i - 1;
                    if (dest >= 0 && dest < annualPeriodCount) {
                      assetRowAnnual[dest] += v;
                    }
                  }
                  // perPeriod[0] is the upfront (Y0 / land cash) lump.
                  // For Phase 1 it lands at project Y0, hidden from the
                  // project-period grid (which starts at Y1). For later
                  // phases the upfront occurs at the phase's first year.
                  if (offset > 0 && offset - 1 < annualPeriodCount && offset - 1 >= 0) {
                    assetRowAnnual[offset - 1] += bd.perPeriod[0] ?? 0;
                  }
                }
                // M2.0j Fix 12: hide zero-value asset rows from Results.
                if (assetTotal === 0) return null;
                const assetRow = transformAnnualSeries(assetRowAnnual);
                // Per-line per-period: distribute each line's total
                // across periods using the line's own phasing curve.
                // M2.0L (2026-05-11): scope by phaseId so multi-phase
                // projects don't render the other phases' lines (which
                // would all fall through to lineTotal=0 + cause React
                // key collisions on legacy snapshots).
                const linesForThisAsset = costLines.filter((c) =>
                  c.phaseId === a.phaseId &&
                  (c.targetAssetId === undefined || c.targetAssetId === a.id)
                );
                return (
                  <React.Fragment key={a.id}>
                    <tr style={{ background: 'color-mix(in srgb, var(--color-navy) 8%, transparent)', fontWeight: 700 }} data-testid={`capex-period-asset-${a.id}`}>
                      <td style={cellName}>{a.name}</td>
                      <td style={cellNum} data-testid={`capex-period-asset-${a.id}-total`}>{fmt(assetTotal)}</td>
                      {cropRow(assetRow).map((v, i) => (<td key={i} style={cellNum} data-testid={`capex-period-${a.id}-${i + 1}`}>{fmt(v)}</td>))}
                    </tr>
                    {linesForThisAsset.map((line) => {
                      let lineTotal = 0;
                      const linePerPeriodAnnual = new Array<number>(annualPeriodCount).fill(0);
                      for (const pb of perPhaseBreakdowns) {
                        const bd = pb.assetTotals[a.id];
                        if (!bd) continue;
                        const t = bd.byLineId[line.id] ?? 0;
                        if (t === 0) continue;
                        lineTotal += t;
                        // P11 Fix 6 (2026-05-13): consume the engine's
                        // exact per-line schedule (perLinePerPeriod[line.id])
                        // instead of smearing the line total proportional
                        // to the asset-wide perPeriod curve. The schedule
                        // is phase-relative (index 0 = Y0 upfront, index 1
                        // = phase Y1, ...) so we apply the same phase
                        // offset used by the asset-row builder to lift it
                        // onto the project axis.
                        const phaseObj2 = phases.find((p) => p.id === pb.phaseId);
                        const phaseStartIso2 = phaseObj2?.startDate && phaseObj2.startDate.length === 10
                          ? phaseObj2.startDate
                          : project.startDate;
                        const phaseStartYear2 = new Date(phaseStartIso2).getUTCFullYear();
                        const offset2 = Number.isFinite(phaseStartYear2 - projectStartYear)
                          ? Math.max(0, phaseStartYear2 - projectStartYear)
                          : 0;
                        const linePP = bd.perLinePerPeriod[line.id] ?? [];
                        for (let i = 1; i < linePP.length; i++) {
                          const v = linePP[i] ?? 0;
                          if (v === 0) continue;
                          const dest = offset2 + i - 1;
                          if (dest >= 0 && dest < annualPeriodCount) {
                            linePerPeriodAnnual[dest] += v;
                          }
                        }
                        // Upfront perPeriod[0] (Phase 2+ only): lands at
                        // offset - 1 (year before the phase starts).
                        if (offset2 > 0 && offset2 - 1 < annualPeriodCount && offset2 - 1 >= 0) {
                          linePerPeriodAnnual[offset2 - 1] += linePP[0] ?? 0;
                        }
                      }
                      if (lineTotal === 0) return null;
                      const linePerPeriod = transformAnnualSeries(linePerPeriodAnnual);
                      return (
                        <tr key={`${a.id}-${line.id}`} data-testid={`capex-period-line-${a.id}-${line.id}`}>
                          <td style={{ ...cellName, paddingLeft: 24, fontWeight: 400, color: 'var(--color-meta)' }}>{line.name}</td>
                          <td style={cellNum}>{fmt(lineTotal)}</td>
                          {cropRow(linePerPeriod).map((v, i) => (<td key={i} style={cellNum}>{fmt(v)}</td>))}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--color-grey-pale)', fontWeight: 700 }}>
                <td style={cellName}>Project Total</td>
                <td style={cellNum} data-testid="capex-period-grand-total">{fmt(periodTotals.reduce((s, v) => s + v, 0))}</td>
                {cropRow(periodTotals).map((v, i) => (<td key={i} style={cellNum} data-testid={`capex-period-total-${i + 1}`}>{fmt(v)}</td>))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* M2.0L Pass2 Fix 9 (2026-05-11): three CAPEX Summary tables
          stacked beneath Capex by Period. Each is per-asset row x
          period column, filtered by land treatment.
          - Excl All Land: assetPP[i+1] - landTotalPP[i+1]
          - Excl Land In-Kind: assetPP[i+1] - landInKindPP[i+1]
          - Incl All Land: assetPP[i+1] (unfiltered)
          All three share the same Combined / per-asset filter pill bar
          + granularity toggle + period labels above. */}
      {(() => {
        // Helper: build per-asset period series + totals for a given
        // land filter ('exclAll' | 'exclInKind' | 'inclAll').
        const buildAssetRow = (asset: Asset, mode: 'exclAll' | 'exclInKind' | 'inclAll'): { row: number[]; total: number } => {
          const projectStartYear = new Date(project.startDate).getUTCFullYear();
          const annualRow = new Array<number>(annualPeriodCount).fill(0);
          let total = 0;
          for (const pb of perPhaseBreakdowns) {
            const bd = pb.assetTotals[asset.id];
            if (!bd) continue;
            const phaseObj = phases.find((p) => p.id === pb.phaseId);
            const phaseStartIso = phaseObj?.startDate && phaseObj.startDate.length === 10 ? phaseObj.startDate : project.startDate;
            const phaseStartYear = new Date(phaseStartIso).getUTCFullYear();
            const offset = Math.max(0, phaseStartYear - projectStartYear);
            // P11 Fix 6: iterate the full perPeriod length so operating-
            // tail entries (lines with endPeriod > cp) reach the axis.
            for (let i = 1; i < bd.perPeriod.length; i++) {
              const dest = offset + i - 1;
              if (dest < 0 || dest >= annualPeriodCount) continue;
              const tot = bd.perPeriod[i] ?? 0;
              const landAll = bd.perPeriodLandTotal[i] ?? 0;
              const landInKind = bd.perPeriodLandInKind[i] ?? 0;
              const v =
                mode === 'exclAll' ? tot - landAll
                : mode === 'exclInKind' ? tot - landInKind
                : tot;
              annualRow[dest] += v;
              total += v;
            }
            // Upfront perPeriod[0] follows the same offset rule.
            if (offset > 0 && offset - 1 < annualPeriodCount && offset - 1 >= 0) {
              const tot = bd.perPeriod[0] ?? 0;
              const landAll = bd.perPeriodLandTotal[0] ?? 0;
              const landInKind = bd.perPeriodLandInKind[0] ?? 0;
              const v =
                mode === 'exclAll' ? tot - landAll
                : mode === 'exclInKind' ? tot - landInKind
                : tot;
              annualRow[offset - 1] += v;
              total += v;
            }
          }
          return { row: transformAnnualSeries(annualRow), total };
        };

        const renderSummary = (
          title: string,
          mode: 'exclAll' | 'exclInKind' | 'inclAll',
          testidKey: string,
        ): React.JSX.Element => {
          const rows = phaseAssets
            .map((a) => ({ asset: a, ...buildAssetRow(a, mode) }))
            // Hide zero rows (brief: hide rows with total = 0).
            .filter((r) => Math.abs(r.total) > 0.5);
          const projTotal = rows.reduce((s, r) => s + r.total, 0);
          const periodTotalsLocal = new Array<number>(periodCount).fill(0);
          for (const r of rows) {
            for (let i = 0; i < periodCount; i++) periodTotalsLocal[i] += r.row[i] ?? 0;
          }
          return (
            <div style={sectionCardStyle} data-testid={`capex-summary-${testidKey}`}>
              <h3 style={{ margin: 0, marginBottom: 'var(--sp-1)', fontSize: 14 }}>{title}</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th style={headLeftStyle}>Asset</th>
                      <th style={headStyle}>Total</th>
                      {croppedPeriodLabels.map((p, i) => (<th key={i} style={headStyle}>{p}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td style={cellName} colSpan={2 + croppedPeriodCount}>No non-zero values for this view.</td></tr>
                    ) : rows.map((r) => (
                      <tr key={r.asset.id} data-testid={`capex-summary-${testidKey}-${r.asset.id}`}>
                        <td style={cellName}>{r.asset.name}</td>
                        <td style={cellNum} data-testid={`capex-summary-${testidKey}-${r.asset.id}-total`}>{fmt(r.total)}</td>
                        {cropRow(r.row).map((v, i) => (<td key={i} style={cellNum}>{fmt(v)}</td>))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--color-grey-pale)', fontWeight: 700 }}>
                      <td style={cellName}>Project Total</td>
                      <td style={cellNum} data-testid={`capex-summary-${testidKey}-grand-total`}>{fmt(projTotal)}</td>
                      {cropRow(periodTotalsLocal).map((v, i) => (<td key={i} style={cellNum}>{fmt(v)}</td>))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          );
        };

        // M2.0L Pass 4 (2026-05-11): Results table order + naming
        // matches the brief's accounting framing.
        //   Table 1 = "Construction Cost Schedule by Period" (per cost
        //             line, per asset; rendered above this block).
        //   Table 2 = Total Capex Including Land Value (basis for
        //             Fixed Assets / Inventory book value).
        //   Table 3 = Capex Excluding Land In-Kind (cash impact; the
        //             schedule that the Financing module's drawdown
        //             curve consumes for debt sizing + equity funding).
        //   Table 4 = Capex Excluding Total Land (pure development
        //             cost / cost-per-sqm benchmarking).
        return (
          <>
            {renderSummary('Table 2 - Total Capex Including Land Value', 'inclAll', 'total-capex-incl-land')}
            {renderSummary('Table 3 - Capex Excluding Land In-Kind (cash-impact schedule)', 'exclInKind', 'capex-excl-land-inkind')}
            {renderSummary('Table 4 - Capex Excluding Total Land (pure development cost)', 'exclAll', 'capex-excl-total-land')}
          </>
        );
      })()}
    </>
  );
}

// ── M2.0L Fix 2: Cost Input Mode chooser modal ───────────────────────────
// Shown the first time the user opens Tab 3 on a project (Project.costInput-
// Mode is undefined). One-shot: closes once the user picks a mode; the
// choice persists on Project.costInputMode and can be switched later via
// the toggle button at the top of Tab 3.
interface CostInputModeModalProps {
  onPick: (mode: CostInputMode) => void;
}

function CostInputModeModal({ onPick }: CostInputModeModalProps): React.JSX.Element {
  const overlay: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  };
  const modal: React.CSSProperties = {
    background: 'var(--color-surface)',
    color: 'var(--color-heading)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius)',
    padding: 'var(--sp-3)',
    minWidth: 480,
    maxWidth: 560,
    boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  };
  const optionCard: React.CSSProperties = {
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: 'var(--sp-2)',
    cursor: 'pointer',
    background: 'var(--color-grey-pale)',
    textAlign: 'left',
  };
  return (
    <div style={overlay} role="dialog" aria-modal="true" data-testid="cost-input-mode-modal">
      <div style={modal}>
        <h3 style={{ margin: 0, marginBottom: 'var(--sp-1)', fontSize: 'var(--font-h3)' }}>How do you want to enter costs?</h3>
        <p style={{ margin: 0, marginBottom: 'var(--sp-2)', fontSize: 'var(--font-small)', color: 'var(--color-meta)' }}>
          Pick the entry style that fits this project. You can switch later from the toggle at the top of Tab 3.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
          <button
            type="button"
            onClick={() => onPick('same')}
            style={optionCard}
            data-testid="cost-input-mode-modal-same"
          >
            <div style={{ fontSize: 13, fontWeight: 700 }}>Same for All Assets</div>
            <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2 }}>
              Single cost table, costs apply uniformly (allocated by BUA share or land area).
            </div>
          </button>
          <button
            type="button"
            onClick={() => onPick('individual')}
            style={optionCard}
            data-testid="cost-input-mode-modal-individual"
          >
            <div style={{ fontSize: 13, fontWeight: 700 }}>Individual per Asset</div>
            <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2 }}>
              Separate input table per asset. Override rates and methods per asset.
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── M2.0L Fix 2: Same-mode cost table ────────────────────────────────────
// Renders ONE cost table per phase that drives every visible asset in
// that phase. Edits land on the cost line itself (no per-asset overrides);
// the calc engine still distributes the line across assets by its
// allocationBasis (bua_share / land_share / per_asset / etc.). The
// caption shows the aggregated multiplier across all visible assets in
// the phase so the user sees the resolved total.
interface SameModeCostTableProps {
  phaseId: string;
  phaseName: string;
  constructionPeriods: number;
  phaseAssets: Asset[];
  lines: CostLine[];
  costOverrides: CostOverride[];
  breakdowns: Record<string, AssetCostBreakdown>;
  currency: string;
  scale: DisplayScale;
  decimals: DisplayDecimals;
  periodLabel: (idx: number) => string;
  subUnits: SubUnit[];
  metricsByAsset: Map<string, import('@/src/core/calculations').AssetAreaMetrics>;
  onUpdateLine: (lineId: string, patch: Partial<CostLine>) => void;
  onRemoveLine: (lineId: string) => void;
  onAddCustom: () => void;
  // M2.0L Pass 4 (2026-05-11): per-asset override controls for the
  // replicas section. Override toggle creates / updates an entry via
  // onUpdateOverride; un-toggle calls onRemoveOverride to drop it
  // (asset reverts to master).
  onUpdateOverride: (override: CostOverride) => void;
  onRemoveOverride: (assetId: string, lineId: string) => void;
}

function SameModeCostTable({
  phaseId, phaseName, constructionPeriods, phaseAssets,
  lines, costOverrides, breakdowns, currency, scale, decimals, periodLabel,
  subUnits, metricsByAsset, onUpdateLine, onRemoveLine, onAddCustom,
  onUpdateOverride, onRemoveOverride,
}: SameModeCostTableProps): React.JSX.Element {
  // M2.0L Pass2 Fix 4 + Fix 10 (2026-05-11): Same mode renders ONE
  // editable master cost table (top) + per-asset read-only replicas
  // (below). Master caption uses AGGREGATED metrics (sum across phase
  // assets) so user sees "x 280,000 sqm BUA aggregated" instead of
  // one asset's slice. Each replica shows the same lines with that
  // asset's own metrics + per-asset subtotal.
  const totalByLineId = (lineId: string): number => {
    let s = 0;
    for (const a of phaseAssets) {
      const bd = breakdowns[a.id];
      if (!bd) continue;
      s += bd.byLineId[lineId] ?? 0;
    }
    return s;
  };
  const phaseSubtotal = lines.reduce((s, l) => s + totalByLineId(l.id), 0);

  // Build a synthetic master "asset" carrying aggregated supportArea /
  // parkingArea so costLineCaption renders the summed footprint. We
  // borrow phaseAssets[0]'s identity fields (phaseId, strategy, etc.)
  // but only the area-related fields are read by the caption.
  const aggregatedMetrics = aggregatePhaseMetrics(phaseAssets, metricsByAsset);
  const refAsset = phaseAssets[0];
  const masterSyntheticAsset: Asset | undefined = refAsset
    ? {
        ...refAsset,
        name: 'All Assets (aggregated)',
        buaSqm: aggregatedMetrics.bua,
        sellableBuaSqm: aggregatedMetrics.nsa,
        gfaSqm: aggregatedMetrics.gfa,
        supportArea: aggregatedMetrics.supportArea,
        parkingArea: aggregatedMetrics.parkingArea,
        parkingBaysRequired: aggregatedMetrics.parkingBays,
      }
    : undefined;

  return (
    <div style={assetSectionStyle} data-testid={`costs-same-phase-${phaseId}`}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--sp-1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{phaseName}</span>
          <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>
            Master cost table - aggregates over {phaseAssets.length} asset{phaseAssets.length === 1 ? '' : 's'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--color-meta)' }}>Phase Subtotal</span>
          <strong style={{ fontSize: 14 }} data-testid={`costs-same-phase-${phaseId}-subtotal`}>
            {formatAccounting(phaseSubtotal, scale, decimals)}
          </strong>
        </div>
      </div>
      {masterSyntheticAsset && refAsset ? (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }} data-testid={`costs-same-phase-${phaseId}-master-table`}>
            {/* M2.0M Pass 6 Fix 4: constrain Method col to 200px; other
                cols flex naturally so the cost-line label has breathing room. */}
            <colgroup>
              <col />
              <col style={{ width: 200 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 100 }} />
            </colgroup>
            <thead>
              <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                <th style={{ padding: '6px', textAlign: 'left' }}>Cost Line</th>
                <th style={{ padding: '6px', textAlign: 'left' }}>Method</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>Value</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>Start</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>End</th>
                <th style={{ padding: '6px', textAlign: 'left' }}>Phasing</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>Total (all assets)</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>Toggle</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const total = totalByLineId(line.id);
                return (
                  <CostRow
                    key={line.id}
                    asset={masterSyntheticAsset}
                    line={line}
                    override={undefined}
                    total={total}
                    isLocked={line.isLocked === true}
                    currency={currency}
                    scale={scale}
                    decimals={decimals}
                    periodLabel={periodLabel}
                    constructionPeriods={constructionPeriods}
                    subUnits={subUnits}
                    metrics={aggregatedMetrics}
                    editsGoToLine
                    onUpdateLine={(patch) => onUpdateLine(line.id, patch)}
                    onUpdateOverride={() => { /* same mode: no overrides */ }}
                    onRemoveOverride={() => { /* same mode: no overrides */ }}
                    onRemoveLine={() => onRemoveLine(line.id)}
                  />
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--color-grey-pale)' }}>
                <td colSpan={6} style={{ padding: '6px', textAlign: 'right', fontWeight: 700 }}>
                  Phase Subtotal
                </td>
                <td style={{ padding: '6px', textAlign: 'right', fontWeight: 700 }}>
                  {formatAccounting(phaseSubtotal, scale, decimals)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          {costOverrides.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4, fontStyle: 'italic' }}>
              Note: {costOverrides.length} per-asset override{costOverrides.length === 1 ? '' : 's'} from a previous Individual session remain in the snapshot; switch to Individual mode to view or clear them.
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--sp-1)' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onAddCustom}
              style={{ fontSize: 11, padding: '4px 10px' }}
              data-testid={`costs-same-phase-${phaseId}-add-custom`}
            >
              + Add Custom Cost
            </button>
          </div>

          {/* M2.0L Pass 4 (2026-05-11): per-asset resolved replicas with
              per-row Override toggle. Each row carries:
                - Cost line name (read-only)
                - Method label (read-only; switches to dropdown when
                  override is on and method override is requested - kept
                  simple for now via the master-only method)
                - Rate input: disabled when inherited; editable when
                  overridden. Reflects master value when inherited.
                - Source badge: "Inherited" (gray) or "Override" (warning).
                - Multiplier caption (asset-specific, costLineCaption).
                - Total: asset's resolved contribution from breakdown.
                - Override toggle: clicking when inherited creates an
                  override entry seeded with the current master values;
                  clicking when overridden removes the entry (revert). */}
          <div style={{ marginTop: 'var(--sp-3)' }} data-testid={`costs-same-phase-${phaseId}-replicas`}>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 var(--sp-1) 0' }}>
              Per-asset resolved
            </h4>
            {phaseAssets.map((a) => {
              const m = metricsByAsset.get(a.id);
              const bd = breakdowns[a.id];
              if (!m || !bd) return null;
              const assetSubtotal = lines.reduce((s, l) => s + (bd.byLineId[l.id] ?? 0), 0);
              return (
                <div
                  key={a.id}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--sp-1)',
                    marginBottom: 'var(--sp-1)',
                    background: 'var(--color-grey-pale)',
                  }}
                  data-testid={`costs-same-replica-${a.id}`}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <strong style={{ fontSize: 12 }}>{a.name}</strong>
                    <span style={{ fontSize: 12, fontWeight: 700 }} data-testid={`costs-same-replica-${a.id}-subtotal`}>
                      {formatAccounting(assetSubtotal, scale, decimals)}
                    </span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: 'var(--color-surface)' }}>
                        <th style={{ padding: '4px', textAlign: 'left' }}>Cost Line</th>
                        <th style={{ padding: '4px', textAlign: 'left' }}>Method</th>
                        <th style={{ padding: '4px', textAlign: 'right' }}>Rate</th>
                        <th style={{ padding: '4px', textAlign: 'center' }}>Source</th>
                        <th style={{ padding: '4px', textAlign: 'right' }}>Multiplier</th>
                        <th style={{ padding: '4px', textAlign: 'right' }}>Total</th>
                        <th style={{ padding: '4px', textAlign: 'center' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => {
                        const lineTotal = bd.byLineId[line.id] ?? 0;
                        const ov = costOverrides.find((o) => o.assetId === a.id && o.lineId === line.id);
                        const isOverridden = ov !== undefined && ov.overridden !== false;
                        const effMethod  = isOverridden ? (ov!.method  ?? line.method)  : line.method;
                        const effValue   = isOverridden ? (ov!.value   ?? line.value)   : line.value;
                        const effPhasing = isOverridden ? (ov!.phasing ?? line.phasing) : line.phasing;
                        const cap = costLineCaption({
                          line,
                          override: isOverridden ? { method: ov!.method, value: ov!.value } : undefined,
                          asset: a,
                          metrics: m,
                          parkingBays: a.parkingBaysRequired ?? 0,
                          resolvedTotal: lineTotal,
                        });
                        // M2.0M Pass 6 Fix 7: locked lines (Land Cash /
                        // Land In-Kind / Auto-IDC) flow from upstream
                        // (parcels in Tab 2 + Financing IDC effects)
                        // and must not be per-asset overrideable from
                        // Tab 3.
                        const isLockedLine = line.isLocked === true;
                        const toggleOverride = (): void => {
                          if (isLockedLine) return;
                          if (isOverridden) {
                            onRemoveOverride(a.id, line.id);
                          } else {
                            onUpdateOverride({
                              assetId: a.id,
                              lineId: line.id,
                              method: line.method,
                              value: line.value,
                              phasing: line.phasing,
                              distribution: line.distribution,
                              overridden: true,
                            });
                          }
                        };
                        const writeOverrideValue = (val: number): void => {
                          onUpdateOverride({
                            assetId: a.id,
                            lineId: line.id,
                            method: effMethod,
                            value: val,
                            phasing: effPhasing,
                            distribution: ov?.distribution,
                            disabled: ov?.disabled,
                            perSubUnitRates: ov?.perSubUnitRates,
                            startPeriod: ov?.startPeriod,
                            endPeriod: ov?.endPeriod,
                            overridden: true,
                          });
                        };
                        return (
                          <tr key={line.id} data-testid={`costs-same-replica-${a.id}-row-${line.id}`} data-overridden={isOverridden} data-category={line.costCategory ?? 'direct'}>
                            <td style={{ padding: '4px', textAlign: 'left' }}>
                              {line.name}
                              {/* M2.0L Pass 5: category badge in replica */}
                              {(line.costCategory ?? 'direct') === 'allocated' && (
                                <span
                                  style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 8, fontSize: 9, fontWeight: 700, background: 'color-mix(in srgb, var(--color-navy) 12%, transparent)', color: 'var(--color-navy)' }}
                                  data-testid={`costs-same-replica-${a.id}-row-${line.id}-category-badge`}
                                  title={`Allocated by ${COST_DRIVER_LABELS[line.costDriver ?? 'bua_share']}`}
                                >
                                  Allocated · {COST_DRIVER_LABELS[line.costDriver ?? 'bua_share']}
                                </span>
                              )}
                            </td>
                            {/* M2.0M Pass 6 Fix 4: ellipsis + hover tooltip when label exceeds 200px. */}
                            <td
                              style={{ padding: '4px', textAlign: 'left', color: 'var(--color-meta)', fontSize: 10, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              title={COST_METHOD_LABELS[effMethod]}
                            >
                              {COST_METHOD_LABELS[effMethod]}
                            </td>
                            <td style={{ padding: '4px', textAlign: 'right' }}>
                              {isOverridden ? (
                                <input
                                  type="number"
                                  min={0}
                                  value={effValue}
                                  onChange={(e) => writeOverrideValue(parseFloat(e.target.value) || 0)}
                                  style={{ ...inputStyle, fontSize: 11, textAlign: 'right' }}
                                  data-testid={`costs-same-replica-${a.id}-row-${line.id}-rate`}
                                />
                              ) : (
                                <span style={{ fontSize: 11, color: 'var(--color-meta)' }} data-testid={`costs-same-replica-${a.id}-row-${line.id}-rate-readonly`}>{effValue}</span>
                              )}
                            </td>
                            <td style={{ padding: '4px', textAlign: 'center' }}>
                              <span
                                style={{
                                  padding: '2px 8px', borderRadius: 12, fontSize: 9, fontWeight: 700,
                                  textTransform: 'uppercase', letterSpacing: '0.05em',
                                  background: isOverridden ? 'color-mix(in srgb, var(--color-warning) 18%, transparent)' : 'color-mix(in srgb, var(--color-meta) 12%, transparent)',
                                  color: isOverridden ? 'var(--color-warning)' : 'var(--color-meta)',
                                }}
                                data-testid={`costs-same-replica-${a.id}-row-${line.id}-source`}
                              >
                                {isOverridden ? 'Override' : 'Inherited'}
                              </span>
                            </td>
                            <td style={{ padding: '4px', textAlign: 'right', fontSize: 10, color: 'var(--color-meta)' }} title={cap}>{cap}</td>
                            <td style={{ padding: '4px', textAlign: 'right', fontWeight: 600 }}>{formatAccounting(lineTotal, scale, decimals)}</td>
                            <td style={{ padding: '4px', textAlign: 'center' }}>
                              {isLockedLine ? (
                                <span
                                  style={{
                                    fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                                    padding: '2px 8px', borderRadius: 12,
                                    background: 'color-mix(in srgb, var(--color-meta) 12%, transparent)',
                                    color: 'var(--color-meta)',
                                  }}
                                  title="Locked. Land cost flows from parcels in Tab 2 (edit parcel rate or asset land allocation there). Auto-IDC flows from Financing in Tab 4."
                                  data-testid={`costs-same-replica-${a.id}-row-${line.id}-locked`}
                                >
                                  Locked
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={toggleOverride}
                                  style={{
                                    fontSize: 10, padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                                    background: isOverridden ? 'var(--color-warning-bg)' : 'transparent',
                                    color: isOverridden ? 'var(--color-warning)' : 'var(--color-body)',
                                    border: '1px solid var(--color-border)', cursor: 'pointer',
                                  }}
                                  title={isOverridden ? 'Click to revert this asset+line to the master template value' : 'Click to break this asset+line from the master and edit independently'}
                                  data-testid={`costs-same-replica-${a.id}-row-${line.id}-toggle`}
                                >
                                  {isOverridden ? '✓ Revert to master' : 'Override'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--color-meta)', padding: 'var(--sp-2)' }}>
          Add an asset in Tab 2 before configuring costs.
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────
export default function Module1Costs(): React.JSX.Element {
  const {
    project, phases, parcels, assets, subUnits,
    costLines, costOverrides,
    landAllocationMode,
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
    activePhaseId: s.activePhaseId,
  })));

  const setActivePhaseId = useModule1Store((s) => s.setActivePhaseId);
  const setProject = useModule1Store((s) => s.setProject);
  const addCostLine = useModule1Store((s) => s.addCostLine);
  const updateCostLine = useModule1Store((s) => s.updateCostLine);
  const removeCostLine = useModule1Store((s) => s.removeCostLine);
  const setCostOverride = useModule1Store((s) => s.setCostOverride);
  const removeCostOverride = useModule1Store((s) => s.removeCostOverride);

  const [stageFilter, setStageFilter] = useState<CostStage | 'all'>('all');
  const [popupAssetId, setPopupAssetId] = useState<string | null>(null);
  // M2.0L Pass 4 (2026-05-11): the Same vs Individual mode toggle is
  // removed. Tab 3 now always renders the inheritance surface (master
  // template on top, per-asset resolved replicas below). The legacy
  // project.costInputMode field is stripped on hydrate; this component
  // no longer reads it.
  // M2.0g Fix 7: sub-tab state. 'inputs' shows the per-asset cost
  // tables (editable surface). 'results' shows the 4 capex summary
  // tables (read-only).
  const [subTab, setSubTab] = useState<'inputs' | 'results'>('inputs');
  // M2.0j Fix 16 (2026-05-07): per-asset cost selector. null = "All
  // Assets" view (default). Picking a specific asset filters the
  // per-asset sections to just that one and reflects its 3 summary
  // cards (Excl. Land / Excl. Land In-Kind / Incl. Land In-Kind).
  const [selectedCostAssetId, setSelectedCostAssetId] = useState<string | null>(null);
  // P11 Fix 1 (2026-05-13): "Copy to other assets" panel state. Lets the
  // user push the active asset's cost configuration (method, value, start,
  // end, phasing, perSubUnitRates, disabled, debt/equity ratios) onto a
  // user-picked subset of peer assets in the same phase. Multi-select to
  // cherry-pick targets instead of a blanket apply-to-all.
  const [copyTargetIds, setCopyTargetIds] = useState<Set<string>>(new Set());
  const [copyPanelOpen, setCopyPanelOpen] = useState<boolean>(false);
  // P11 Fix 5 (2026-05-13): user-selectable source asset for the copy
  // panel. null = fall back to the currently active asset; otherwise
  // a specific asset id from anywhere in the project. Decoupling the
  // source from the active pill lets the user push configuration from
  // any asset without first navigating to it.
  const [copySourceId, setCopySourceId] = useState<string | null>(null);
  // P7-Fix 5b (2026-05-11): phase filter for the asset pill bar. '__all__'
  // shows every visible asset; a phase id narrows to that phase's assets.
  // P8-Fix 7 (2026-05-12): phase filter drops the "All Phases" sentinel.
  // Default is the first phase with at least one visible asset, falling
  // back to the first phase when no phase has assets. Empty-phase state
  // surfaces a helpful message + keeps the filter interactive so the
  // user can switch to a populated phase.
  const [inputsPhaseFilter, setInputsPhaseFilter] = useState<string>('');
  // P8-Fix 8 (2026-05-12): Results filter state replaced by
  // project.resultsViewMode + resultsSelectedAssetId (persisted on
  // the project so the choice survives reload).
  // M2.0h Fix 6: runtime view granularity for Results sub-tab.
  // Defaults to project.outputGranularity ('annual' on new projects).
  // User toggles persist via setProject so the next session opens the
  // same view.
  const granularity: OutputGranularity = project.outputGranularity ?? 'annual';
  const setGranularity = (g: OutputGranularity): void => {
    setProject({ outputGranularity: g });
  };
  // M2.0g: project-wide display scale + M2.0i decimals.
  const scale: DisplayScale = project.displayScale ?? 'full';
  const decimals: DisplayDecimals = project.displayDecimals ?? 2;
  // M2.0g Addendum 2: period -> "Dec 25" label resolver, supplied to
  // every AssetCostSection so cost line Start / End columns show a
  // human-readable date alongside the integer input.
  const periodLabelFn = (idx: number): string => getPeriodLabel(idx, project.startDate, project.modelType);

  const currentPhase = phases.find((p) => p.id === activePhaseId) ?? phases[0];
  if (!currentPhase) {
    return (
      <div style={{ padding: 'var(--sp-3)' }} data-testid="costs-empty">
        Add a phase first (Tab 1) before configuring costs.
      </div>
    );
  }

  // Per-phase pre-compute (one breakdown per (phase, asset))
  const perPhaseBreakdowns = useMemo(() => {
    return phases.map((phase) => {
      const phaseAssets = assets.filter((a) => a.phaseId === phase.id && a.visible);
      const assetTotals: Record<string, AssetCostBreakdown> = {};
      for (const a of phaseAssets) {
        assetTotals[a.id] = computeAssetCost(a, project, phase, parcels, assets, subUnits, costLines, costOverrides, landAllocationMode);
      }
      return { phaseId: phase.id, phaseName: phase.name, cp: phase.constructionPeriods, phaseAssets, assetTotals };
    });
  }, [phases, assets, project, parcels, subUnits, costLines, costOverrides, landAllocationMode]);

  const allVisibleAssets = useMemo(() => assets.filter((a) => a.visible), [assets]);

  // Stage totals across project (for top tile bar)
  const stageTotals = useMemo(() => {
    const acc = { land: 0, hard: 0, soft: 0, operating: 0 };
    for (const pb of perPhaseBreakdowns) {
      for (const a of pb.phaseAssets) {
        const bd = pb.assetTotals[a.id];
        if (!bd) continue;
        acc.land += bd.byStage.land;
        acc.hard += bd.byStage.hard;
        acc.soft += bd.byStage.soft;
        acc.operating += bd.byStage.operating;
      }
    }
    return acc;
  }, [perPhaseBreakdowns]);

  const projectTotal = stageTotals.land + stageTotals.hard + stageTotals.soft + stageTotals.operating;

  // Per-asset metrics map (for treatment table + Fix 8 caption + Fix 16 cards).
  // M2.0j: store the full AssetAreaMetrics shape so CostRow can render
  // the inline formula caption (e.g. "x 130,874 sqm BUA = 588M SAR").
  // M2.0L Pass2 Fix 3 (2026-05-11): scope phaseAssets to the asset's own
  // phase. Before this, every asset was resolved against ALL visible
  // assets across every phase, which broke the autoByBua land allocation
  // share computation (asset's slice became diluted across foreign
  // phases that don't share its parcels).
  const metricsByAsset = useMemo(() => {
    const map = new Map<string, ReturnType<typeof resolveAssetAreaMetrics>>();
    for (const a of allVisibleAssets) {
      const phaseAssets = allVisibleAssets.filter((x) => x.phaseId === a.phaseId);
      const m = resolveAssetAreaMetrics(a, project, parcels, phaseAssets, subUnits, landAllocationMode);
      map.set(a.id, m);
    }
    return map;
  }, [allVisibleAssets, project, parcels, subUnits, landAllocationMode]);

  // M2.0M Pass 6 Fix 8 (2026-05-11): proper project-period reducer.
  // Each phase contributes (phaseStartYear - projectStartYear) + cp,
  // so multi-phase projects render columns out to the latest phase's
  // construction end + 1 year buffer (capped at 24). Previously the
  // reducer only considered constructionStart + cp and the offset was
  // applied at render time, producing column ranges that either fell
  // short or spilled past the actual construction tail.
  const projectStartYear = new Date(project.startDate).getUTCFullYear();
  const totalConstructionPeriods = phases.reduce((max, p) => {
    const phaseStartIso = p.startDate && p.startDate.length === 10 ? p.startDate : project.startDate;
    const phaseStartYear = new Date(phaseStartIso).getUTCFullYear();
    const offset = Number.isFinite(phaseStartYear - projectStartYear)
      ? Math.max(0, phaseStartYear - projectStartYear)
      : 0;
    return Math.max(max, offset + p.constructionPeriods);
  }, 0);

  const handleAddCustom = (assetId: string): void => {
    setPopupAssetId(assetId);
  };

  const handleCustomSave = (line: CostLine): void => {
    addCostLine(line);
  };

  // Lines visible to a given asset, optionally filtered by stage
  function linesForAsset(asset: Asset, phaseId: string): CostLine[] {
    return costLines
      .filter((c) => c.phaseId === phaseId)
      .filter((c) => c.targetAssetId === undefined || c.targetAssetId === asset.id)
      .filter((c) => stageFilter === 'all' || deriveCostStage(c) === stageFilter)
      .filter((c) => !c.requiresCountry || c.requiresCountry === project.country);
  }

  return (
    <div data-testid="module1-costs">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 'var(--sp-2)', flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--font-h2)', fontWeight: 'var(--fw-bold)' }}>3. Development Costs</h2>
          <div style={{ color: 'var(--color-meta)', fontSize: 12 }}>
            {phases.length} phase{phases.length > 1 ? 's' : ''} · {allVisibleAssets.length} active asset{allVisibleAssets.length === 1 ? '' : 's'} · inputs entered annually
          </div>
          {/* M2.0h Fix 2 (2026-05-07): single currency / scale header
              line per tab. Cells stay free of currency suffix.
              M2.0L Pass3 Fix 12: data-currency attribute makes the
              project.currency propagation testable end to end. */}
          <div
            style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', fontStyle: 'italic', marginTop: 4 }}
            data-testid="currency-header-line"
            data-currency={project.currency}
          >
            {currencyHeaderLine(project.currency, scale)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* P8-Fix 3 (2026-05-12): top-right phase dropdown removed.
              Phase filter inside the Inputs sub-tab (above the asset
              pill bar) is the sole navigation; Results sub-tab uses its
              own Combined/Single Asset toggle (P8-Fix 8). Stage filter
              kept for cross-tab stage-based filtering. */}
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as CostStage | 'all')}
            style={inputStyle}
            data-testid="costs-stage-filter"
          >
            <option value="all">All Stages</option>
            {COST_STAGES.map((s) => (<option key={s} value={s}>{COST_STAGE_LABELS[s]}</option>))}
          </select>
        </div>
      </div>

      {/* Stage summary tile bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--sp-1)', marginBottom: 'var(--sp-2)' }} data-testid="costs-summary-tiles">
        {COST_STAGES.map((s) => (
          <div key={s} style={{ ...sectionCardStyle, marginBottom: 0, padding: 12 }} data-testid={`costs-stage-${s}-card`}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>
              {COST_STAGE_LABELS[s]}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
              {formatAccounting(stageTotals[s], scale, decimals)}
            </div>
          </div>
        ))}
      </div>

      {/* M2.0g Fix 7: Inputs / Results sub-tab toggle. */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-1)',
          marginBottom: 'var(--sp-2)',
          borderBottom: '1px solid var(--color-border)',
        }}
        data-testid="costs-sub-tabs"
      >
        {(['inputs', 'results'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSubTab(tab)}
            data-testid={`costs-sub-tab-${tab}`}
            style={{
              padding: 'var(--sp-1) var(--sp-3)',
              background: subTab === tab ? 'var(--color-navy)' : 'transparent',
              color: subTab === tab ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
              border: 'none',
              borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
              cursor: 'pointer',
              fontSize: 'var(--font-small)',
              fontWeight: subTab === tab ? 700 : 500,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {tab === 'inputs' ? '1. Inputs' : '2. Results'}
          </button>
        ))}
      </div>

      {/* M2.0L Pass 4 (2026-05-11): inheritance surface always rendered.
          Master template per phase (editable; project-wide cost lines)
          + per-asset resolved replicas (read-only by default; each row
          carries an Override toggle that activates a CostOverride entry
          for that asset+line). */}
      {subTab === 'inputs' && (() => {
        // P7-Fix 5b + 6 (2026-05-11): per-asset Inputs view.
        // The master + replicas + Override inheritance surface from Pass 4
        // is gone. Each asset owns its own cost lines; user picks an asset
        // via the pill bar, sees ONLY that asset's editable table.
        //
        // P8-Fix 7 (2026-05-12): inputsPhaseFilter holds a specific
        // phaseId. Default = first phase with visible assets, else
        // first phase. P8-Fix 3 (empty-phase state): when the selected
        // phase has no assets, render a helpful message and keep the
        // phase filter dropdown interactive so the user can switch to
        // a populated phase.
        // P9-Fix 7 (2026-05-12): when inputsPhaseFilter holds a phase id
        // that has no visible assets (e.g. user clicks Phase 3 before
        // adding any assets there), we want the filter to RESPECT the
        // user's selection (so the dropdown shows Phase 3 + the empty
        // state renders for Phase 3, not silently jump to Phase 2). The
        // previous fallback `inputsPhaseFilter || firstPhaseWithAssets`
        // worked because empty-phase id is still truthy; activeAsset
        // could then be undefined, and downstream `activeAsset.phaseId`
        // crashed. Below: guard every downstream dereference.
        const firstPhaseWithAssets = phases.find((p) => allVisibleAssets.some((a) => a.phaseId === p.id))?.id;
        const effectivePhaseId = inputsPhaseFilter || firstPhaseWithAssets || phases[0]?.id || '';
        const visiblePillAssets = allVisibleAssets.filter((a) => a.phaseId === effectivePhaseId);
        const activeAsset = visiblePillAssets.find((a) => a.id === selectedCostAssetId)
          ?? visiblePillAssets[0];
        const assetPhase = activeAsset ? phases.find((p) => p.id === activeAsset.phaseId) : undefined;
        const phaseStart = assetPhase?.startDate && assetPhase.startDate.length === 10
          ? assetPhase.startDate
          : project.startDate;
        const phaseScopedPeriodLabel = (idx: number): string =>
          getPeriodLabel(idx, phaseStart, project.modelType);
        // T3-render Fix 1 (2026-05-12): include project-wide master lines
        // (targetAssetId === undefined) plus any per-asset replicas
        // (targetAssetId === activeAsset.id). Pass 10 hybrid stores every
        // line as a master, so the prior strict-equality filter
        // `c.targetAssetId === activeAsset.id` excluded everything and
        // the rendered cost table was empty even though the engine
        // produced correct breakdowns. Matches the engine's filter at
        // calculations/index.ts:1042 + the linesForAsset helper at
        // Module1Costs.tsx:2596.
        const assetLines = activeAsset
          ? costLines
              .filter((c) => c.phaseId === activeAsset.phaseId)
              .filter((c) => c.targetAssetId === undefined || c.targetAssetId === activeAsset.id)
              .filter((c) => stageFilter === 'all' || deriveCostStage(c) === stageFilter)
              .filter((c) => !c.requiresCountry || c.requiresCountry === project.country)
          : [];
        const assetBreakdown = activeAsset
          ? perPhaseBreakdowns
              .find((pb) => pb.phaseId === activeAsset.phaseId)
              ?.assetTotals[activeAsset.id]
          : undefined;
        const assetMetrics = activeAsset ? metricsByAsset.get(activeAsset.id) : undefined;

        const pillStyle = (active: boolean): React.CSSProperties => ({
          fontSize: 11,
          fontWeight: 700,
          padding: '6px 12px',
          borderRadius: 999,
          border: active ? 'none' : '1px solid var(--color-border)',
          background: active ? 'var(--color-navy)' : 'var(--color-surface)',
          color: active ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
          cursor: 'pointer',
        });

        const phaseHasAssets = visiblePillAssets.length > 0;
        return (
          <>
            {/* P11 Fix 3 (2026-05-13): project-level "Apply cost
                configuration to other assets" panel. Sits ABOVE the
                phase filter so it's clearly project-wide, not phase-
                scoped. Source = whichever asset is currently active.
                Target list = every visible non-companion asset across
                EVERY phase except the active one. Cross-phase apply
                matches lines by name because cost line IDs are phase-
                scoped (each phase carries its own master records);
                lines that exist in the source asset's phase but not in
                the target asset's phase are skipped silently. */}
            {activeAsset && (() => {
              const eligibleSources = allVisibleAssets.filter((a) => a.isCompanion !== true);
              if (eligibleSources.length === 0) return null;
              const sourceAsset =
                eligibleSources.find((a) => a.id === copySourceId)
                ?? eligibleSources.find((a) => a.id === activeAsset.id)
                ?? eligibleSources[0];
              const peerAssets = eligibleSources.filter((a) => a.id !== sourceAsset.id);
              if (peerAssets.length === 0) return null;
              const selectedCount = copyTargetIds.size;
              const peersByPhase = phases
                .map((p) => ({ phase: p, assets: peerAssets.filter((a) => a.phaseId === p.id) }))
                .filter((g) => g.assets.length > 0);
              const sourcesByPhase = phases
                .map((p) => ({ phase: p, assets: eligibleSources.filter((a) => a.phaseId === p.id) }))
                .filter((g) => g.assets.length > 0);
              // P11 Fix 5 (2026-05-13): build sourceLines off the chosen
              // source asset (its phase, its visibility) instead of the
              // pill-bar activeAsset, so picking any project asset as
              // source pulls the right master + custom-targeted lines.
              const sourceLines = costLines
                .filter((c) => c.phaseId === sourceAsset.phaseId)
                .filter((c) => c.targetAssetId === undefined || c.targetAssetId === sourceAsset.id)
                .filter((c) => !c.requiresCountry || c.requiresCountry === project.country);
              return (
                <div
                  style={{ ...sectionCardStyle, padding: 'var(--sp-1) var(--sp-2)', borderColor: 'color-mix(in srgb, var(--color-navy) 30%, var(--color-border))' }}
                  data-testid="costs-copy-panel"
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 11, color: 'var(--color-meta)' }}>
                      <strong style={{ color: 'var(--color-body)', fontSize: 12 }}>
                        Copy cost configuration between assets
                      </strong>
                      <span style={{ marginLeft: 8 }}>
                        pick a source asset + one or more targets; copies method, value, start, end, phasing per cost line. Cross-phase targets match lines by name.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCopyPanelOpen((v) => !v)}
                      style={{ fontSize: 11, padding: '4px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                      data-testid="costs-copy-panel-toggle"
                    >
                      {copyPanelOpen ? 'Hide' : 'Open copy panel...'}
                    </button>
                  </div>
                  {copyPanelOpen && (
                    <div style={{ marginTop: 'var(--sp-1)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--sp-1)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', flexWrap: 'wrap', marginBottom: 'var(--sp-1)' }}>
                        <strong style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)', minWidth: 90 }}>
                          Source asset:
                        </strong>
                        <select
                          value={sourceAsset.id}
                          onChange={(e) => {
                            const nextId = e.target.value;
                            setCopySourceId(nextId);
                            // Drop the newly-chosen source from any target
                            // selection so the user doesn't accidentally
                            // overwrite the source onto itself.
                            setCopyTargetIds((prev) => {
                              if (!prev.has(nextId)) return prev;
                              const next = new Set(prev);
                              next.delete(nextId);
                              return next;
                            });
                          }}
                          style={{ ...inputStyle, width: 'auto', minWidth: 240 }}
                          data-testid="costs-copy-panel-source-select"
                        >
                          {sourcesByPhase.map((g) => (
                            <optgroup key={g.phase.id} label={g.phase.name}>
                              {g.assets.map((a) => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>
                          {sourceLines.length} cost line{sourceLines.length === 1 ? '' : 's'} on {phases.find((p) => p.id === sourceAsset.phaseId)?.name ?? 'phase'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', flexWrap: 'wrap', marginBottom: 6 }}>
                        <strong style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)', minWidth: 90 }}>
                          Target assets (all phases):
                        </strong>
                        <button
                          type="button"
                          onClick={() => setCopyTargetIds(new Set(peerAssets.map((a) => a.id)))}
                          style={{ fontSize: 10, padding: '2px 8px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                          data-testid="costs-copy-panel-select-all"
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={() => setCopyTargetIds(new Set())}
                          style={{ fontSize: 10, padding: '2px 8px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                          data-testid="costs-copy-panel-clear"
                        >
                          Clear
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {peersByPhase.map((g) => (
                          <div key={g.phase.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 80 }}>
                              {g.phase.name}
                            </strong>
                            {g.assets.map((a) => {
                              const checked = copyTargetIds.has(a.id);
                              const samePhase = a.phaseId === sourceAsset.phaseId;
                              return (
                                <label
                                  key={a.id}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 11,
                                    padding: '4px 8px',
                                    border: '1px solid var(--color-border)',
                                    borderRadius: 'var(--radius-sm)',
                                    background: checked ? 'color-mix(in srgb, var(--color-navy) 8%, transparent)' : 'var(--color-surface)',
                                    cursor: 'pointer',
                                  }}
                                  data-testid={`costs-copy-panel-target-${a.id}`}
                                  title={samePhase ? 'Same phase as source' : 'Cross-phase target, matched by line name'}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const next = new Set(copyTargetIds);
                                      if (e.target.checked) next.add(a.id);
                                      else next.delete(a.id);
                                      setCopyTargetIds(next);
                                    }}
                                    style={{ cursor: 'pointer' }}
                                  />
                                  {a.name}
                                  {!samePhase && (
                                    <span style={{ fontSize: 9, color: 'var(--color-meta)', fontStyle: 'italic' }}>(cross-phase)</span>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--sp-1)' }}>
                        <button
                          type="button"
                          disabled={selectedCount === 0}
                          onClick={() => {
                            if (selectedCount === 0) return;
                            const targetIds = Array.from(copyTargetIds);
                            const targetNames = peerAssets
                              .filter((a) => copyTargetIds.has(a.id))
                              .map((a) => a.name)
                              .join(', ');
                            const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
                              ? window.confirm(
                                  `Copy ${sourceAsset.name}'s cost configuration (${sourceLines.length} line${sourceLines.length === 1 ? '' : 's'}) to ${targetIds.length} asset${targetIds.length === 1 ? '' : 's'}: ${targetNames}?\n\nCross-phase targets match lines by name. Existing per-asset overrides on the targets will be overwritten.`,
                                )
                              : true;
                            if (!ok) return;
                            for (const line of sourceLines) {
                              const sourceOv = costOverrides.find((o) =>
                                o.assetId === sourceAsset.id && o.lineId === line.id,
                              );
                              for (const tId of targetIds) {
                                const target = peerAssets.find((a) => a.id === tId);
                                if (!target) continue;
                                let targetLineId = line.id;
                                if (target.phaseId !== sourceAsset.phaseId) {
                                  // Cross-phase: line IDs differ, match by name.
                                  const match = costLines.find((c) =>
                                    c.phaseId === target.phaseId &&
                                    (c.targetAssetId === undefined || c.targetAssetId === target.id) &&
                                    c.name.trim().toLowerCase() === line.name.trim().toLowerCase(),
                                  );
                                  if (!match) continue;
                                  targetLineId = match.id;
                                }
                                if (sourceOv && sourceOv.overridden !== false) {
                                  setCostOverride({ ...sourceOv, assetId: tId, lineId: targetLineId });
                                } else {
                                  removeCostOverride(tId, targetLineId);
                                }
                              }
                            }
                            setCopyPanelOpen(false);
                            setCopyTargetIds(new Set());
                          }}
                          style={{
                            fontSize: 11,
                            padding: '6px 14px',
                            background: selectedCount === 0 ? 'var(--color-grey-pale)' : 'var(--color-navy)',
                            color: selectedCount === 0 ? 'var(--color-meta)' : 'var(--color-on-primary-navy)',
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
                            fontWeight: 700,
                          }}
                          data-testid="costs-copy-panel-apply"
                        >
                          Apply {sourceAsset.name} to {selectedCount} asset{selectedCount === 1 ? '' : 's'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* P8-Fix 7 (2026-05-12): Phase filter shows individual phases
                only; no "All Phases" option. P8-Fix 3: empty-phase state
                renders a helpful message but keeps the filter active so
                the user can navigate to a populated phase. */}
            <div style={{ ...sectionCardStyle, padding: 'var(--sp-1) var(--sp-2)' }} data-testid="costs-inputs-asset-nav">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-1)', flexWrap: 'wrap', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>Phase Filter:</strong>
                  <select
                    value={effectivePhaseId}
                    onChange={(e) => setInputsPhaseFilter(e.target.value)}
                    style={{ ...inputStyle, width: 'auto', minWidth: 160 }}
                    data-testid="costs-inputs-phase-filter"
                  >
                    {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                {/* P11 Fix 3 (2026-05-13): top-of-tab Expand all /
                    Collapse all removed. Per-row collapse state was
                    deleted in T3-edit-runtime v4 ("remove that layer
                    permanently"), so the bulk toggle had nothing to
                    flip; clicks were silent no-ops. */}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', flexWrap: 'wrap' }} data-testid="costs-inputs-asset-pills">
                <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>Asset:</strong>
                {phaseHasAssets ? visiblePillAssets.map((a) => {
                  const ph = phases.find((p) => p.id === a.phaseId);
                  const isActive = a.id === activeAsset?.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setSelectedCostAssetId(a.id)}
                      style={pillStyle(isActive)}
                      data-testid={`costs-inputs-asset-pill-${a.id}`}
                    >
                      {a.name}
                      <span style={{ marginLeft: 6, opacity: 0.7, fontSize: 9 }}>{ph?.name ?? ''}</span>
                    </button>
                  );
                }) : (
                  <span style={{ fontSize: 11, color: 'var(--color-meta)', fontStyle: 'italic' }}>(none)</span>
                )}
              </div>
            </div>

            {/* P8-Fix 3 (2026-05-12): empty-phase helpful message. When
                the selected phase has no visible assets, surface a
                message + back-navigation hint instead of a blank page.
                Phase filter dropdown above stays interactive. */}
            {!phaseHasAssets && (
              <div style={{ ...sectionCardStyle, textAlign: 'center', color: 'var(--color-meta)', padding: 'var(--sp-3)' }} data-testid="costs-inputs-empty-phase">
                <strong style={{ fontSize: 14, display: 'block', marginBottom: 6, color: 'var(--color-body)' }}>
                  No assets in {phases.find((p) => p.id === effectivePhaseId)?.name ?? 'this phase'} yet.
                </strong>
                <div style={{ fontSize: 12 }}>
                  Add assets in Tab 2 Assets & Sub-units, or switch to a different phase using the filter above.
                </div>
              </div>
            )}

            {/* P7-Fix 5b: stats summary line for the selected asset */}
            {phaseHasAssets && activeAsset && assetMetrics && (
              <div style={{ ...sectionCardStyle, padding: 'var(--sp-1) var(--sp-2)', fontSize: 11, color: 'var(--color-meta)', display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }} data-testid={`costs-inputs-asset-stats-${activeAsset.id}`}>
                <span><strong>{activeAsset.name}</strong> · {assetPhase?.name ?? ''} · {activeAsset.strategy}</span>
                <span>BUA: <strong>{Math.round(assetMetrics.bua).toLocaleString()}</strong> sqm</span>
                <span>NSA: <strong>{Math.round(assetMetrics.nsa).toLocaleString()}</strong> sqm</span>
                <span>Land: <strong>{Math.round(assetMetrics.landSqm).toLocaleString()}</strong> sqm</span>
                <span>Land Cost: <strong>{formatAccounting(assetMetrics.landValue, scale, decimals)}</strong></span>
              </div>
            )}

            {/* T3-companion Fix 2 (2026-05-12): companion assets carry
                NO cost lines. When the active asset is a companion,
                render an info block instead of the cost-line table.
                The engine has already short-circuited to an empty
                breakdown so Project Total + Asset Subtotal rollups
                exclude the companion's burden. */}
            {phaseHasAssets && activeAsset && activeAsset.isCompanion === true && (() => {
              const parent = assets.find((a) => a.id === activeAsset.parentAssetId);
              const phase = phases.find((p) => p.id === activeAsset.phaseId);
              const opEndYear = phase
                ? (new Date(phase.startDate ?? project.startDate).getUTCFullYear()
                    + Math.max(0, phase.constructionPeriods - (phase.overlapPeriods ?? 0))
                    + Math.max(0, phase.operationsPeriods)
                    - 1)
                : null;
              const opEndLabel = opEndYear !== null && Number.isFinite(opEndYear) ? `Dec ${opEndYear}` : '-';
              const companionSubs = subUnits.filter((u) => u.assetId === activeAsset.id);
              const totalUnits = companionSubs.reduce((s, u) => s + Math.max(0, u.metricValue), 0);
              const adrSum = companionSubs.reduce((s, u) => s + Math.max(0, u.startingAdr ?? u.unitPrice ?? 0), 0);
              const avgAdr = companionSubs.length > 0 ? adrSum / companionSubs.length : 0;
              return (
                <div
                  data-testid={`costs-companion-info-${activeAsset.id}`}
                  style={{
                    ...sectionCardStyle,
                    background: 'color-mix(in srgb, var(--color-navy) 6%, transparent)',
                    border: '1px dashed var(--color-navy)',
                    padding: 'var(--sp-3)',
                  }}
                >
                  <strong style={{ fontSize: 14, display: 'block', marginBottom: 6, color: 'var(--color-navy)' }}>
                    {activeAsset.name} (Companion)
                  </strong>
                  <div style={{ fontSize: 12, color: 'var(--color-body)', marginBottom: 'var(--sp-2)' }}>
                    This asset operates the units sold from <strong>{parent?.name ?? '(parent)'}</strong>. No development costs apply here.
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 'var(--sp-2)', fontStyle: 'italic' }}>
                    Operating revenue inputs (ADR, occupancy, indexation) handled in Revenue module (M2.1).
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--sp-2)', fontSize: 12 }}>
                    <div>
                      <div style={{ color: 'var(--color-meta)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Units</div>
                      <strong data-testid={`costs-companion-info-${activeAsset.id}-units`}>{Math.round(totalUnits).toLocaleString()} (from parent)</strong>
                    </div>
                    <div>
                      <div style={{ color: 'var(--color-meta)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg Starting ADR</div>
                      <strong data-testid={`costs-companion-info-${activeAsset.id}-adr`}>{formatAccounting(avgAdr, scale, decimals)} {project.currency}/night</strong>
                      <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>(set in Tab 2)</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--color-meta)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Operating End</div>
                      <strong data-testid={`costs-companion-info-${activeAsset.id}-end`}>{opEndLabel}</strong>
                      <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>(from {phase?.name ?? 'Phase'} setup)</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Single editable table for the selected asset.
                P10-Fix 3 (2026-05-12): hybrid architecture. The lines
                array now carries project-wide masters (no targetAssetId)
                + companion-specific custom lines. CostOverride[] re-
                introduced for per-asset rate divergence; passed scoped
                to the active asset. AssetCostSection renders the
                Override toggle inline per row when not locked.
                T3-companion Fix 2 (2026-05-12): companion branch
                handled above (info block instead of cost table). */}
            {phaseHasAssets && activeAsset && activeAsset.isCompanion !== true && assetBreakdown && assetMetrics && (
              <AssetCostSection
                key={activeAsset.id}
                asset={activeAsset}
                lines={assetLines}
                costOverrides={costOverrides.filter((o) => o.assetId === activeAsset.id)}
                breakdown={assetBreakdown}
                currency={project.currency}
                scale={scale}
                decimals={decimals}
                periodLabel={phaseScopedPeriodLabel}
                constructionPeriods={assetPhase?.constructionPeriods ?? 1}
                subUnits={subUnits}
                metrics={assetMetrics}
                onUpdateLine={(lineId, patch) => updateCostLine(lineId, patch)}
                onUpdateOverride={(override) => setCostOverride(override)}
                onRemoveOverride={(assetId, lineId) => removeCostOverride(assetId, lineId)}
                onRemoveLine={(lineId) => {
                  const line = costLines.find((c) => c.id === lineId);
                  const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
                    ? window.confirm(`Remove '${line?.name ?? 'cost line'}'?`)
                    : true;
                  if (!ok) return;
                  removeCostLine(lineId);
                }}
                onAddCustom={() => {
                  const id = `custom-${Date.now()}__${activeAsset.phaseId}`;
                  // P8-Fix 5 (2026-05-12): defaults Start=0, End=maxCp+1.
                  // maxCp = max constructionPeriods across all phases so a
                  // multi-phase project gets the longest construction window
                  // plus a 1-period buffer.
                  const maxCp = phases.reduce((m, p) => Math.max(m, p.constructionPeriods), 0);
                  // P10-Fix 3 (2026-05-12): custom cost lines added via
                  // the Add Custom Cost button are PROJECT-WIDE masters
                  // (no targetAssetId). Users override per-asset via the
                  // Override toggle on each row.
                  addCostLine({
                    id,
                    phaseId: activeAsset.phaseId,
                    name: 'Custom Cost',
                    method: 'fixed',
                    value: 0,
                    stage: 'soft',
                    scope: 'direct',
                    allocationBasis: 'per_asset',
                    startPeriod: 0,
                    endPeriod: Math.max(1, maxCp + 1),
                    phasing: 'even',
                    costCategory: 'direct',
                  });
                }}
              />
            )}
          </>
        );
      })()}


      {subTab === 'results' && allVisibleAssets.length > 0 && (
        <>
          {/* M2.0h Fix 6 (2026-05-07): runtime view granularity. Annual
              data on disk, view toggle only. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-2)',
              padding: 'var(--sp-1) var(--sp-2)',
              marginBottom: 'var(--sp-2)',
              background: 'var(--color-grey-pale)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
            }}
            data-testid="costs-results-granularity-toggle"
          >
            <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>View as:</strong>
            {OUTPUT_GRANULARITIES.map((g) => (
              <label key={g} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 'var(--font-small)' }} data-testid={`costs-granularity-${g}`}>
                <input type="radio" name="costs-granularity" value={g} checked={granularity === g} onChange={() => setGranularity(g)} />
                {OUTPUT_GRANULARITY_LABELS[g]}
              </label>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-meta)' }}>
              Inputs are entered annually; sub-period view distributes via cost line phasing.
            </span>
          </div>
          {/* P8-Fix 8 (2026-05-12): Combined / Single Asset toggle.
              Replaces the M2.0L filter pill bar with an explicit radio
              toggle per brief. Combined view shows all visible assets;
              Single Asset surfaces an asset picker dropdown beside the
              radio. State persists to project.resultsViewMode +
              resultsSelectedAssetId so it survives reload. */}
          {(() => {
            const resultsView: 'combined' | 'single_asset' = project.resultsViewMode ?? 'combined';
            const resultsAssetId = project.resultsSelectedAssetId
              ?? (resultsView === 'single_asset' ? allVisibleAssets[0]?.id : undefined);
            const filteredAssets = resultsView === 'single_asset' && resultsAssetId
              ? allVisibleAssets.filter((a) => a.id === resultsAssetId)
              : allVisibleAssets;
            return (
              <>
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    flexWrap: 'wrap',
                    padding: 'var(--sp-1) var(--sp-2)',
                    marginBottom: 'var(--sp-2)',
                    background: 'var(--color-grey-pale)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    alignItems: 'center',
                  }}
                  data-testid="costs-results-view-toggle"
                >
                  <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>View:</strong>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="results-view-mode"
                      value="combined"
                      data-testid="costs-results-view-combined"
                      checked={resultsView === 'combined'}
                      onChange={() => setProject({ resultsViewMode: 'combined', resultsSelectedAssetId: undefined })}
                    />
                    Combined
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="results-view-mode"
                      value="single_asset"
                      data-testid="costs-results-view-single"
                      checked={resultsView === 'single_asset'}
                      onChange={() => setProject({ resultsViewMode: 'single_asset', resultsSelectedAssetId: allVisibleAssets[0]?.id })}
                    />
                    Single Asset
                  </label>
                  {resultsView === 'single_asset' && (
                    <select
                      value={resultsAssetId ?? ''}
                      onChange={(e) => setProject({ resultsSelectedAssetId: e.target.value })}
                      style={{ ...inputStyle, width: 'auto', minWidth: 200 }}
                      data-testid="costs-results-single-asset-select"
                    >
                      {allVisibleAssets.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <SummaryTables
                  key={`summary-${granularity}-${resultsView}-${resultsAssetId ?? 'all'}`}
                  phaseAssets={filteredAssets}
                  perPhaseBreakdowns={perPhaseBreakdowns}
                  parcelsByPhase={new Map()}
                  metricsByAsset={metricsByAsset}
                  project={{ currency: project.currency, startDate: project.startDate, modelType: project.modelType, displayScale: scale, displayDecimals: decimals }}
                  totalConstructionPeriods={totalConstructionPeriods}
                  costLines={costLines}
                  granularity={granularity}
                  phases={phases}
                />
              </>
            );
          })()}
        </>
      )}
      {subTab === 'results' && allVisibleAssets.length === 0 && (
        <div style={{ ...sectionCardStyle, textAlign: 'center', color: 'var(--color-meta)', padding: 'var(--sp-3)' }}>
          No visible assets yet. Switch to the Inputs sub-tab and add an asset to populate the summary tables.
        </div>
      )}

      {/* Project total footer */}
      <div
        style={{
          ...sectionCardStyle,
          background: 'var(--color-navy)',
          color: 'var(--color-on-primary-navy)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 'var(--sp-2) var(--sp-3)',
        }}
        data-testid="costs-project-total"
      >
        <strong style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Project Total</strong>
        <strong style={{ fontSize: 18 }}>{formatAccounting(projectTotal, scale, decimals)}</strong>
      </div>

      {popupAssetId && (
        <CustomCostPopup
          phaseId={currentPhase.id}
          assetId={popupAssetId}
          /* P8-Fix 5: pass project-wide max construction periods so the
             popup's End-period default reflects the longest phase + 1 buffer. */
          constructionPeriods={phases.reduce((m, p) => Math.max(m, p.constructionPeriods), 0)}
          onClose={() => setPopupAssetId(null)}
          onSave={handleCustomSave}
        />
      )}
      {/* M2.0L Pass 4: CostInputModeModal removed. The parent/child
          inheritance surface is always rendered; no first-open chooser. */}
    </div>
  );
}
