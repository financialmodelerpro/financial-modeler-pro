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
import { currencyHeaderLine, formatScaled, formatScaledCurrency, formatScaledForExport } from '@/src/core/formatters';
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
  const writeMethod = (method: CostMethod): void => {
    if (isProjectWide) {
      // Per-asset override carries method when user diverges.
      onUpdateOverride({ assetId: asset.id, lineId: line.id, method, value: effValue, phasing: effPhasing, distribution: override?.distribution, disabled: override?.disabled });
    } else {
      onUpdateLine({ method });
    }
  };
  const writeValue = (value: number): void => {
    if (isProjectWide) {
      onUpdateOverride({ assetId: asset.id, lineId: line.id, method: effMethod, value, phasing: effPhasing, distribution: override?.distribution, disabled: override?.disabled });
    } else {
      onUpdateLine({ value });
    }
  };
  const writePhasing = (phasing: CostPhasing): void => {
    if (isProjectWide) {
      onUpdateOverride({ assetId: asset.id, lineId: line.id, method: effMethod, value: effValue, phasing, distribution: override?.distribution, disabled: override?.disabled });
    } else {
      onUpdateLine({ phasing });
    }
  };
  const writeStartPeriod = (n: number): void => {
    onUpdateLine({ startPeriod: n });
  };
  const writeEndPeriod = (n: number): void => {
    onUpdateLine({ endPeriod: n });
  };
  const toggleDisabled = (disabled: boolean): void => {
    if (isProjectWide) {
      onUpdateOverride({ assetId: asset.id, lineId: line.id, method: effMethod, value: effValue, phasing: effPhasing, distribution: override?.distribution, disabled });
    } else {
      onUpdateLine({ disabled });
    }
  };
  const reset = (): void => {
    if (override) onRemoveOverride();
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
          disabled={isLocked}
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
          disabled={isLocked}
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
      <td style={{ padding: '4px', overflow: 'hidden' }}>
        {/* M2.0L Pass2 Fix 6 (2026-05-11): inputs always render at full
            scale regardless of project.displayScale. The Display Scale
            setting applies only to computed/result cells (Total column,
            summary cards, summary tables). User types a rate as
            4,500 / 4,500.00, never as "4.50 K". */}
        <AccountingNumberInput
          value={effValue}
          onChange={writeValue}
          scale="full"
          decimals={decimals}
          disabled={isLocked}
          style={inputStyle}
          data-testid={`cost-${asset.id}-${line.id}-value`}
        />
        {/* M2.0L Pass2 Fix 5 (2026-05-11): unit hint reactive to method. */}
        <div
          style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2, textAlign: 'right', fontStyle: 'italic' }}
          data-testid={`cost-${asset.id}-${line.id}-unit-hint`}
        >
          {valueUnitHint(effMethod, currency)}
        </div>
        {/* M2.0j Fix 8 (2026-05-07): inline formula caption showing the
            multiplier value AND the result. Helps the user verify math
            at a glance without leaving Tab 3. Hidden when value is 0
            and result is 0 (no useful info). */}
        {(effValue !== 0 || total !== 0) && (
          <div
            style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            data-testid={`cost-${asset.id}-${line.id}-caption`}
            title={costLineCaption({ line, override, asset, metrics, parkingBays: asset.parkingBaysRequired ?? 0, resolvedTotal: total })}
          >
            {costLineCaption({ line, override, asset, metrics, parkingBays: asset.parkingBaysRequired ?? 0, resolvedTotal: total })}
          </div>
        )}
      </td>
      <td style={{ padding: '4px', width: 70 }}>
        <input
          type="number"
          min={0}
          max={constructionPeriods}
          value={line.startPeriod}
          onChange={(e) => {
            const next = parseInt(e.target.value) || 0;
            writeStartPeriod(Math.min(Math.max(0, next), constructionPeriods));
          }}
          disabled={isLocked}
          style={inputStyle}
          data-testid={`cost-${asset.id}-${line.id}-start`}
          title={`Max = ${constructionPeriods}`}
        />
        <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2, textAlign: 'center' }} data-testid={`cost-${asset.id}-${line.id}-start-label`}>
          {periodStartLabel}
        </div>
      </td>
      <td style={{ padding: '4px', width: 70 }}>
        {/* M2.0L Pass3 Fix 7 (2026-05-11): max bound = phase
            constructionPeriods + hard auto-clamp on edit so users
            can't push End past the construction window. HTML's max
            attribute is advisory only; the onChange handler now
            actively clamps. A "Clamp" button appears when an
            existing line carries a value that exceeds the current
            phase cp (e.g. legacy snapshot with cp=24 reduced to
            cp=4). One click resets endPeriod to constructionPeriods. */}
        <input
          type="number"
          min={0}
          max={constructionPeriods}
          value={line.endPeriod}
          onChange={(e) => {
            const next = parseInt(e.target.value) || 0;
            const clamped = Math.min(Math.max(0, next), constructionPeriods);
            writeEndPeriod(clamped);
          }}
          disabled={isLocked}
          style={inputStyle}
          data-testid={`cost-${asset.id}-${line.id}-end`}
          aria-invalid={line.endPeriod > constructionPeriods}
          title={line.endPeriod > constructionPeriods ? `End exceeds construction window (${constructionPeriods}). Click Clamp to reset.` : `Max = ${constructionPeriods}`}
        />
        <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2, textAlign: 'center' }} data-testid={`cost-${asset.id}-${line.id}-end-label`}>
          {periodEndLabel}
        </div>
        {line.endPeriod > constructionPeriods && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, marginTop: 2 }}>
            <div style={{ fontSize: 9, color: 'var(--color-warning)' }} data-testid={`cost-${asset.id}-${line.id}-end-warning`}>
              exceeds cp ({constructionPeriods})
            </div>
            {!isLocked && (
              <button
                type="button"
                onClick={() => writeEndPeriod(constructionPeriods)}
                style={{ fontSize: 9, padding: '1px 6px', background: 'var(--color-warning-bg)', color: 'var(--color-warning)', border: '1px solid var(--color-warning)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                data-testid={`cost-${asset.id}-${line.id}-end-clamp`}
              >
                Clamp
              </button>
            )}
          </div>
        )}
      </td>
      <td style={{ padding: '4px', minWidth: 110 }}>
        <select
          value={effPhasing}
          onChange={(e) => writePhasing(e.target.value as CostPhasing)}
          disabled={isLocked}
          style={{ ...inputStyle, fontSize: 11 }}
          data-testid={`cost-${asset.id}-${line.id}-phasing`}
        >
          {/* M2.0j Fix 9: dropdown shows only Even + Manual %.  Legacy
              values (sCurve / front-loaded / back-loaded / phase_aligned)
              still load + render correctly via PHASING_LABELS but are
              not user-pickable; opening the dropdown silently normalises
              to Even on next save (handled by migrateM20jPhasing). */}
          {COST_PHASING_OPTIONS.map((p) => (
            <option key={p} value={p}>{PHASING_LABELS[p]}</option>
          ))}
        </select>
      </td>
      <td style={{ padding: '4px', minWidth: 110, textAlign: 'right' }}>
        <div style={calcOutputStyle} data-testid={`cost-${asset.id}-${line.id}-total`}>
          {formatScaled(total, scale, decimals)}
        </div>
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
                    title={`${periodLabel(periodIdx)}: ${formatScaled(money, scale, decimals)}`}
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
                    <span>{formatScaled(money, scale, decimals)}</span>
                  </span>
                );
              })}
            </div>
          </td>
        </tr>
      );
    })()}
    {/* M2.0L (2026-05-11): always-visible per-row period chip strip
        (also renders when phasing != manual). Visual scan of cash
        deployment without leaving the row. Skipped when line is
        upfront (startPeriod=0, endPeriod=0) and total=0. */}
    {!effDisabled && total > 0 && line.endPeriod > 0 && (() => {
      // Distribute the resolved total across [startPeriod, endPeriod]
      // using the same phasing the calc engine will use. Skip the
      // upfront slot (index 0); these rows live in the construction
      // window.
      const cp = constructionPeriods;
      const perPeriod = distributeItemCost(
        { ...line, phasing: effPhasing, distribution: effDistribution },
        total,
        cp,
      );
      // Build chips ONLY for the span (startPeriod..endPeriod), keep
      // the upfront lump if startPeriod===0.
      const start = Math.min(line.startPeriod, cp);
      const end = Math.min(line.endPeriod, cp);
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
                    title={`${periodLabel(idx)}: ${formatScaled(amount, scale, decimals)}`}
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
                    <span>{formatScaled(amount, scale, decimals)}</span>
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
                      {formatScaled(r.total, scale, decimals)}
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
                    {formatScaled(breakdown.totalCost, scale, decimals)}
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
            {formatScaled(subtotal, scale, decimals)}
          </strong>
          <span style={{ fontSize: 14, color: 'var(--color-meta)' }}>{collapsed ? '▶' : '▼'}</span>
        </div>
      </div>
      {!collapsed && (
        <>
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
                  {formatScaled(subtotal, scale, decimals)}
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
  // M2.0M Pass 6 Fix 9 (2026-05-11): Results cells use formatScaledForExport
  // (no K / M suffix per cell). The Results sub-tab still has the
  // header-line "All figures in SAR '000" via currencyHeaderLine; cells
  // stay clean and tabular.
  const fmt = (v: number): string => formatScaledForExport(v, scale, decimals);
  // M2.0h Fix 6: at annual granularity, 1 column per construction year
  // (capped at 24 for layout). At quarterly: 4× columns. Monthly: 12×.
  const annualPeriodCount = Math.min(totalConstructionPeriods, 24);
  const subPerYear = granularity === 'annual' ? 1 : granularity === 'quarterly' ? 4 : 12;
  const periodCount = annualPeriodCount * subPerYear;
  // Period labels respect granularity: 'Dec 25' / 'Q1 25' / 'Jan 25'.
  const periodLabels = generatePeriodLabels(project.startDate, annualPeriodCount, granularity);

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
  const periodTable = phaseAssets.map((a) => {
    const annualRow = new Array<number>(annualPeriodCount).fill(0);
    for (const pb of perPhaseBreakdowns) {
      const bd = pb.assetTotals[a.id];
      if (!bd) continue;
      for (let i = 0; i < annualPeriodCount; i++) {
        annualRow[i] += bd.perPeriod[i + 1] ?? 0; // +1 because perPeriod[0] is upfront
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
                {periodLabels.map((p, i) => (<th key={i} style={headStyle}>{p}</th>))}
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
                  for (let i = 0; i < pb.cp; i++) {
                    const dest = offset + i;
                    if (dest >= 0 && dest < annualPeriodCount) {
                      assetRowAnnual[dest] += bd.perPeriod[i + 1] ?? 0;
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
                      {assetRow.map((v, i) => (<td key={i} style={cellNum} data-testid={`capex-period-${a.id}-${i + 1}`}>{fmt(v)}</td>))}
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
                        // Approximate per-period split: distribute t across
                        // perPeriod proportional to overall asset perPeriod.
                        const assetPP = bd.perPeriod;
                        const assetPPTotal = assetPP.reduce((s, v) => s + v, 0);
                        if (assetPPTotal > 0) {
                          for (let i = 0; i < annualPeriodCount; i++) {
                            const share = (assetPP[i + 1] ?? 0) / assetPPTotal;
                            linePerPeriodAnnual[i] += t * share;
                          }
                        }
                      }
                      if (lineTotal === 0) return null;
                      const linePerPeriod = transformAnnualSeries(linePerPeriodAnnual);
                      return (
                        <tr key={`${a.id}-${line.id}`} data-testid={`capex-period-line-${a.id}-${line.id}`}>
                          <td style={{ ...cellName, paddingLeft: 24, fontWeight: 400, color: 'var(--color-meta)' }}>{line.name}</td>
                          <td style={cellNum}>{fmt(lineTotal)}</td>
                          {linePerPeriod.map((v, i) => (<td key={i} style={cellNum}>{fmt(v)}</td>))}
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
                {periodTotals.map((v, i) => (<td key={i} style={cellNum} data-testid={`capex-period-total-${i + 1}`}>{fmt(v)}</td>))}
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
            for (let i = 0; i < pb.cp; i++) {
              const dest = offset + i;
              if (dest < 0 || dest >= annualPeriodCount) continue;
              const tot = bd.perPeriod[i + 1] ?? 0;
              const landAll = bd.perPeriodLandTotal[i + 1] ?? 0;
              const landInKind = bd.perPeriodLandInKind[i + 1] ?? 0;
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
                      {periodLabels.map((p, i) => (<th key={i} style={headStyle}>{p}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td style={cellName} colSpan={2 + periodCount}>No non-zero values for this view.</td></tr>
                    ) : rows.map((r) => (
                      <tr key={r.asset.id} data-testid={`capex-summary-${testidKey}-${r.asset.id}`}>
                        <td style={cellName}>{r.asset.name}</td>
                        <td style={cellNum} data-testid={`capex-summary-${testidKey}-${r.asset.id}-total`}>{fmt(r.total)}</td>
                        {r.row.map((v, i) => (<td key={i} style={cellNum}>{fmt(v)}</td>))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--color-grey-pale)', fontWeight: 700 }}>
                      <td style={cellName}>Project Total</td>
                      <td style={cellNum} data-testid={`capex-summary-${testidKey}-grand-total`}>{fmt(projTotal)}</td>
                      {periodTotalsLocal.map((v, i) => (<td key={i} style={cellNum}>{fmt(v)}</td>))}
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
            {formatScaled(phaseSubtotal, scale, decimals)}
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
                  {formatScaled(phaseSubtotal, scale, decimals)}
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
                      {formatScaled(assetSubtotal, scale, decimals)}
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
                            <td style={{ padding: '4px', textAlign: 'right', fontWeight: 600 }}>{formatScaled(lineTotal, scale, decimals)}</td>
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
  // P7-Fix 5b (2026-05-11): phase filter for the asset pill bar. '__all__'
  // shows every visible asset; a phase id narrows to that phase's assets.
  const [inputsPhaseFilter, setInputsPhaseFilter] = useState<string>('__all__');
  // M2.0L (2026-05-11): Results sub-tab filter pill bar. null = Combined
  // (all assets in the Capex by Period table). Specific asset id filters
  // the table rows to that asset only.
  const [resultsAssetFilter, setResultsAssetFilter] = useState<string | null>(null);
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
          {/* M2.0L Pass 4 (2026-05-11): cost-input-mode toggle removed.
              Tab 3 now renders the parent/child inheritance surface
              unconditionally (master template + per-asset replicas). */}
          <select
            value={currentPhase.id}
            onChange={(e) => setActivePhaseId(e.target.value)}
            style={inputStyle}
            data-testid="costs-phase-select"
          >
            {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
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
              {formatScaled(stageTotals[s], scale, decimals)}
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
        // inputsPhaseFilter: '__all__' or specific phaseId. Narrows the
        // asset pill bar. Default '__all__'.
        const pf = inputsPhaseFilter;
        const visiblePillAssets = allVisibleAssets.filter((a) => pf === '__all__' ? true : a.phaseId === pf);
        const activeAsset = visiblePillAssets.find((a) => a.id === selectedCostAssetId)
          ?? visiblePillAssets[0];
        if (!activeAsset) {
          return (
            <div style={{ ...sectionCardStyle, textAlign: 'center', color: 'var(--color-meta)', padding: 'var(--sp-3)' }} data-testid="costs-inputs-empty">
              No visible assets in the selected phase. Add an asset in Tab 2.
            </div>
          );
        }
        const assetPhase = phases.find((p) => p.id === activeAsset.phaseId);
        const phaseStart = assetPhase?.startDate && assetPhase.startDate.length === 10
          ? assetPhase.startDate
          : project.startDate;
        const phaseScopedPeriodLabel = (idx: number): string =>
          getPeriodLabel(idx, phaseStart, project.modelType);
        const assetLines = costLines
          .filter((c) => c.targetAssetId === activeAsset.id)
          .filter((c) => stageFilter === 'all' || deriveCostStage(c) === stageFilter)
          .filter((c) => !c.requiresCountry || c.requiresCountry === project.country);
        const assetBreakdown = perPhaseBreakdowns
          .find((pb) => pb.phaseId === activeAsset.phaseId)
          ?.assetTotals[activeAsset.id];
        const assetMetrics = metricsByAsset.get(activeAsset.id);

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

        return (
          <>
            {/* P7-Fix 5b: phase filter + asset pill bar */}
            <div style={{ ...sectionCardStyle, padding: 'var(--sp-1) var(--sp-2)' }} data-testid="costs-inputs-asset-nav">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', flexWrap: 'wrap', marginBottom: 6 }}>
                <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>Phase Filter:</strong>
                <select
                  value={inputsPhaseFilter}
                  onChange={(e) => setInputsPhaseFilter(e.target.value)}
                  style={{ ...inputStyle, width: 'auto', minWidth: 160 }}
                  data-testid="costs-inputs-phase-filter"
                >
                  <option value="__all__">All Phases</option>
                  {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', flexWrap: 'wrap' }} data-testid="costs-inputs-asset-pills">
                <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>Asset:</strong>
                {visiblePillAssets.map((a) => {
                  const ph = phases.find((p) => p.id === a.phaseId);
                  const isActive = a.id === activeAsset.id;
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
                })}
              </div>
            </div>

            {/* P7-Fix 5b: stats summary line for the selected asset */}
            {assetMetrics && (
              <div style={{ ...sectionCardStyle, padding: 'var(--sp-1) var(--sp-2)', fontSize: 11, color: 'var(--color-meta)', display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }} data-testid={`costs-inputs-asset-stats-${activeAsset.id}`}>
                <span><strong>{activeAsset.name}</strong> · {assetPhase?.name ?? ''} · {activeAsset.strategy}</span>
                <span>BUA: <strong>{Math.round(assetMetrics.bua).toLocaleString()}</strong> sqm</span>
                <span>NSA: <strong>{Math.round(assetMetrics.nsa).toLocaleString()}</strong> sqm</span>
                <span>Land: <strong>{Math.round(assetMetrics.landSqm).toLocaleString()}</strong> sqm</span>
                <span>Land Cost: <strong>{formatScaled(assetMetrics.landValue, scale, decimals)}</strong></span>
              </div>
            )}

            {/* Single editable table for the selected asset */}
            {assetBreakdown && assetMetrics && (
              <AssetCostSection
                key={activeAsset.id}
                asset={activeAsset}
                lines={assetLines}
                costOverrides={[]}
                breakdown={assetBreakdown}
                currency={project.currency}
                scale={scale}
                decimals={decimals}
                periodLabel={phaseScopedPeriodLabel}
                constructionPeriods={assetPhase?.constructionPeriods ?? 1}
                subUnits={subUnits}
                metrics={assetMetrics}
                onUpdateLine={(lineId, patch) => updateCostLine(lineId, patch)}
                onUpdateOverride={() => { /* Pass 7: override surface removed */ }}
                onRemoveOverride={() => { /* Pass 7: override surface removed */ }}
                onRemoveLine={(lineId) => {
                  const line = costLines.find((c) => c.id === lineId);
                  const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
                    ? window.confirm(`Remove '${line?.name ?? 'cost line'}' from ${activeAsset.name}?`)
                    : true;
                  if (!ok) return;
                  removeCostLine(lineId);
                }}
                onAddCustom={() => {
                  const id = `custom-${Date.now()}__${activeAsset.phaseId}__${activeAsset.id}`;
                  // P8-Fix 5 (2026-05-12): defaults Start=0, End=maxCp+1.
                  // maxCp = max constructionPeriods across all phases so a
                  // multi-phase project gets the longest construction window
                  // plus a 1-period buffer.
                  const maxCp = phases.reduce((m, p) => Math.max(m, p.constructionPeriods), 0);
                  addCostLine({
                    id,
                    phaseId: activeAsset.phaseId,
                    targetAssetId: activeAsset.id,
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
          {/* M2.0L (2026-05-11): Results filter pill bar. Combined +
              one pill per visible asset. Picking an asset narrows the
              Capex by Period table to that asset only. */}
          {allVisibleAssets.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 'var(--sp-1)',
                flexWrap: 'wrap',
                padding: 'var(--sp-1) var(--sp-2)',
                marginBottom: 'var(--sp-2)',
                background: 'var(--color-grey-pale)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                alignItems: 'center',
              }}
              data-testid="costs-results-asset-filter"
            >
              <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)', marginRight: 'var(--sp-1)' }}>Filter:</strong>
              <button
                type="button"
                onClick={() => setResultsAssetFilter(null)}
                data-testid="costs-results-filter-combined"
                style={{
                  fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 999,
                  border: resultsAssetFilter === null ? 'none' : '1px solid var(--color-border)',
                  background: resultsAssetFilter === null ? 'var(--color-navy)' : 'var(--color-surface)',
                  color: resultsAssetFilter === null ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
                  cursor: 'pointer',
                }}
              >
                Combined
              </button>
              {allVisibleAssets.map((a) => {
                const isActive = resultsAssetFilter === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setResultsAssetFilter(a.id)}
                    data-testid={`costs-results-filter-${a.id}`}
                    style={{
                      fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 999,
                      border: isActive ? 'none' : '1px solid var(--color-border)',
                      background: isActive ? 'var(--color-navy)' : 'var(--color-surface)',
                      color: isActive ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
                      cursor: 'pointer',
                    }}
                  >
                    {a.name}
                  </button>
                );
              })}
            </div>
          )}
          {/* M2.0j Fix 11: key forces a remount on granularity change so
              the per-period table refreshes immediately. */}
          <SummaryTables
            key={`summary-${granularity}-${resultsAssetFilter ?? 'all'}`}
            phaseAssets={resultsAssetFilter ? allVisibleAssets.filter((a) => a.id === resultsAssetFilter) : allVisibleAssets}
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
        <strong style={{ fontSize: 18 }}>{formatScaled(projectTotal, scale, decimals)}</strong>
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
