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
  COST_METHODS,
  COST_METHOD_LABELS,
  COST_PHASING_OPTIONS,
  COST_STAGES,
  COST_STAGE_LABELS,
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
import { currencyHeaderLine, formatScaled, formatScaledCurrency } from '@/src/core/formatters';
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
    onSave({
      id,
      phaseId,
      name: name.trim() || 'Custom Cost',
      method,
      value: Math.max(0, value),
      stage,
      scope: 'direct',
      allocationBasis: 'per_asset',
      startPeriod: 1,
      endPeriod: Math.max(1, constructionPeriods),
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

  // Stage tooltip text (M2.0g Fix 6: scope label removed)
  const stageTooltip = `Stage: ${COST_STAGE_LABELS[stage]} (auto-derived).`;

  return (
    <>
    <tr
      data-testid={`cost-row-${asset.id}-${line.id}`}
      style={{
        background: STAGE_BG[stage],
        opacity: effDisabled ? 0.45 : 1,
      }}
      title={stageTooltip}
    >
      <td style={{ padding: '4px', minWidth: 180 }}>
        <input
          type="text"
          value={line.name}
          onChange={(e) => writeName(e.target.value)}
          disabled={isLocked}
          style={inputStyle}
          data-testid={`cost-${asset.id}-${line.id}-name`}
        />
        {/* M2.0j Fix 13 (2026-05-07): Stage label dropped from cost
            line UI. Stage info still drives summary tables internally
            (auto-derived via deriveCostStage); just not displayed in
            Inputs anymore. The 'custom' marker stays so the user can
            tell at a glance which lines are theirs vs. seed lines. */}
        {isCustom && (
          <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2 }}>custom</div>
        )}
      </td>
      <td style={{ padding: '4px', minWidth: 160 }}>
        <select
          value={effMethod}
          onChange={(e) => writeMethod(e.target.value as CostMethod)}
          disabled={isLocked}
          style={{ ...inputStyle, fontSize: 11 }}
          data-testid={`cost-${asset.id}-${line.id}-method`}
        >
          {/* M2.0i Fix 5 (2026-05-07): rate_per_parking_bay filtered
              from the user-selectable list. Existing snapshots that
              still carry the value continue to compute, but new lines
              cannot pick it. Use rate_x_parking_area instead. */}
          {COST_METHODS.filter((m) => m !== 'rate_per_parking_bay').map((m) => (
            <option key={m} value={m}>{COST_METHOD_LABELS[m]}</option>
          ))}
        </select>
      </td>
      <td style={{ padding: '4px', width: 96 }}>
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
      <td style={{ padding: '4px', width: 90, textAlign: 'right' }}>
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
        {/* M2.0L Pass2 Fix 8 (2026-05-11): delete button on EVERY non-
            locked cost line (not just custom). Locked seed lines (Land
            Cash / Land In-Kind / auto-IDC) keep the button hidden so
            the user can't break auto-generated rows. Confirm dialog
            before remove. */}
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
              ...inputStyle, background: 'transparent', cursor: 'pointer',
              fontSize: 10, marginTop: 2, color: 'var(--color-negative)',
              padding: '2px 4px',
            }}
            title={isCustom ? 'Delete custom cost line' : 'Delete cost line'}
            data-testid={`cost-${asset.id}-${line.id}-remove`}
          >
            ✕ delete
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
          <td colSpan={8} style={{ padding: '8px 12px' }}>
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
          <td colSpan={8} style={{ padding: '2px 12px 6px' }}>
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
          <td colSpan={8} style={{ padding: '8px 12px' }}>
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
  const costLines = useModule1Store(useShallow((s) => s.costLines));
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
  return (
    <tr data-testid={`cost-row-${asset.id}-${line.id}-pct-picker`} style={{ background: 'var(--color-grey-pale)' }}>
      <td colSpan={8} style={{ padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
          <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>
            Apply to lines (base for the %)
          </strong>
          <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>
            {selected.size === 0 ? 'No base selected, totalling 0' : `${selected.size} line${selected.size === 1 ? '' : 's'} selected`}
          </span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 4,
            maxHeight: 160,
            overflowY: 'auto',
            border: '1px solid var(--color-border)',
            padding: 6,
            background: 'var(--color-surface)',
            borderRadius: 4,
          }}
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
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  cursor: isLocked ? 'not-allowed' : 'pointer',
                  padding: '2px 4px',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{asset.name}</span>
          <span style={strategyBadgeStyle(asset.strategy)} data-testid={`asset-section-${asset.id}-strategy`}>
            {asset.strategy}
          </span>
          <span
            style={{ fontSize: 10, color: 'var(--color-meta)', maxWidth: 480 }}
            data-testid={`asset-section-${asset.id}-destination`}
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                <th style={{ padding: '6px', textAlign: 'left' }}>Cost Line</th>
                <th style={{ padding: '6px', textAlign: 'left' }}>Method</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>Value</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>Start</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>End</th>
                <th style={{ padding: '6px', textAlign: 'left' }}>Phasing</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>Total</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>Toggle</th>
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
                <td></td>
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
  const fmt = (v: number): string => formatScaled(v, scale, decimals);
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
        <strong style={{ fontSize: 13, display: 'block', marginBottom: 'var(--sp-1)' }}>1. Capex by Period (per cost line)</strong>
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

        return (
          <>
            {renderSummary('CAPEX Summary - Excluding All Land', 'exclAll', 'excl-all-land')}
            {renderSummary('CAPEX Summary - Excluding Land In-Kind', 'exclInKind', 'excl-land-inkind')}
            {renderSummary('CAPEX Summary - Including All Land Incl. In-Kind', 'inclAll', 'incl-all-land')}
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
}

function SameModeCostTable({
  phaseId, phaseName, constructionPeriods, phaseAssets,
  lines, costOverrides, breakdowns, currency, scale, decimals, periodLabel,
  subUnits, metricsByAsset, onUpdateLine, onRemoveLine, onAddCustom,
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }} data-testid={`costs-same-phase-${phaseId}-master-table`}>
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

          {/* M2.0L Pass2 Fix 10: per-asset read-only replicas */}
          <div style={{ marginTop: 'var(--sp-3)' }} data-testid={`costs-same-phase-${phaseId}-replicas`}>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 var(--sp-1) 0' }}>
              Per-asset breakdown (read-only)
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
                        <th style={{ padding: '4px', textAlign: 'right' }}>Value</th>
                        <th style={{ padding: '4px', textAlign: 'right' }}>Multiplier (this asset)</th>
                        <th style={{ padding: '4px', textAlign: 'right' }}>Total (this asset)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => {
                        const lineTotal = bd.byLineId[line.id] ?? 0;
                        const cap = costLineCaption({
                          line,
                          asset: a,
                          metrics: m,
                          parkingBays: a.parkingBaysRequired ?? 0,
                          resolvedTotal: lineTotal,
                        });
                        return (
                          <tr key={line.id} data-testid={`costs-same-replica-${a.id}-row-${line.id}`}>
                            <td style={{ padding: '4px', textAlign: 'left' }}>{line.name}</td>
                            <td style={{ padding: '4px', textAlign: 'left', color: 'var(--color-meta)', fontSize: 10 }}>{COST_METHOD_LABELS[line.method]}</td>
                            <td style={{ padding: '4px', textAlign: 'right' }}>{line.value}</td>
                            <td style={{ padding: '4px', textAlign: 'right', fontSize: 10, color: 'var(--color-meta)' }} title={cap}>{cap}</td>
                            <td style={{ padding: '4px', textAlign: 'right', fontWeight: 600 }}>{formatScaled(lineTotal, scale, decimals)}</td>
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
  // M2.0L Fix 2 (2026-05-11): cost input mode chooser state. The modal
  // is open ONLY when project.costInputMode is undefined (first open on
  // this project). The toggle at the top of Tab 3 calls handleSwitchMode
  // afterwards.
  const costInputMode: CostInputMode | undefined = project.costInputMode;
  const showModeChooser = costInputMode === undefined;
  const removeAllCostOverrides = useModule1Store((s) => s.costOverrides);
  void removeAllCostOverrides;
  const setCostOverrideAction = useModule1Store((s) => s.setCostOverride);
  void setCostOverrideAction;
  const handleSwitchMode = (next: CostInputMode): void => {
    if (next === costInputMode) return;
    // M2.0L: Individual -> Same clears per-asset overrides so the user
    // sees a clean single-table experience. Confirm first since this
    // is destructive of user input.
    if (costInputMode === 'individual' && next === 'same' && costOverrides.length > 0) {
      const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(
            `Switching to Same-for-All clears ${costOverrides.length} per-asset cost override${costOverrides.length === 1 ? '' : 's'}. Continue?`,
          )
        : true;
      if (!ok) return;
      // Drop every override via the store action.
      const overridesNow = useModule1Store.getState().costOverrides;
      for (const o of overridesNow) {
        useModule1Store.getState().removeCostOverride(o.assetId, o.lineId);
      }
    }
    setProject({ costInputMode: next });
  };
  // M2.0g Fix 7: sub-tab state. 'inputs' shows the per-asset cost
  // tables (editable surface). 'results' shows the 4 capex summary
  // tables (read-only).
  const [subTab, setSubTab] = useState<'inputs' | 'results'>('inputs');
  // M2.0j Fix 16 (2026-05-07): per-asset cost selector. null = "All
  // Assets" view (default). Picking a specific asset filters the
  // per-asset sections to just that one and reflects its 3 summary
  // cards (Excl. Land / Excl. Land In-Kind / Incl. Land In-Kind).
  const [selectedCostAssetId, setSelectedCostAssetId] = useState<string | null>(null);
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

  // Total construction periods across all phases (for summary tables column count)
  const totalConstructionPeriods = phases.reduce((s, p) => Math.max(s, p.constructionStart - 1 + p.constructionPeriods), 0);

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
          {/* M2.0L Fix 2 (2026-05-11): cost input mode toggle. Always
              visible at the top of Tab 3 so the user can switch between
              Same / Individual after the initial chooser. */}
          {costInputMode && (
            <div
              style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}
              data-testid="cost-input-mode-toggle"
            >
              {(['same', 'individual'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleSwitchMode(m)}
                  data-testid={`cost-input-mode-toggle-${m}`}
                  style={{
                    padding: '4px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    border: 'none',
                    background: costInputMode === m ? 'var(--color-navy)' : 'var(--color-surface)',
                    color: costInputMode === m ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
                    cursor: 'pointer',
                  }}
                >
                  {m === 'same' ? 'Same for All' : 'Individual'}
                </button>
              ))}
            </div>
          )}
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

      {/* M2.0L Fix 2: Same-mode rendering replaces the per-asset
          selector + sections with one cost table per phase. */}
      {subTab === 'inputs' && costInputMode === 'same' && (
        <>
          {perPhaseBreakdowns.map((pb) => {
            const phaseObj = phases.find((ph) => ph.id === pb.phaseId);
            const phaseStart = phaseObj?.startDate && phaseObj.startDate.length === 10
              ? phaseObj.startDate
              : project.startDate;
            const phaseScopedPeriodLabel = (idx: number): string =>
              getPeriodLabel(idx, phaseStart, project.modelType);
            // Project-wide lines only (drop any per-asset custom-tagged lines
            // since Same mode doesn't expose them).
            const sameModeLines = costLines
              .filter((c) => c.phaseId === pb.phaseId)
              .filter((c) => !c.targetAssetId)
              .filter((c) => stageFilter === 'all' || deriveCostStage(c) === stageFilter)
              .filter((c) => !c.requiresCountry || c.requiresCountry === project.country);
            return (
              <SameModeCostTable
                key={pb.phaseId}
                phaseId={pb.phaseId}
                phaseName={pb.phaseName}
                constructionPeriods={pb.cp}
                phaseAssets={pb.phaseAssets}
                lines={sameModeLines}
                costOverrides={costOverrides}
                breakdowns={pb.assetTotals}
                currency={project.currency}
                scale={scale}
                decimals={decimals}
                periodLabel={phaseScopedPeriodLabel}
                subUnits={subUnits}
                metricsByAsset={metricsByAsset}
                onUpdateLine={(lineId, patch) => updateCostLine(lineId, patch)}
                onRemoveLine={removeCostLine}
                onAddCustom={() => {
                  // In Same mode there is no per-asset target. Open the
                  // custom popup against the first visible asset; the
                  // resulting custom line is targeted but still rendered
                  // in Individual mode. For Same mode, we instead seed
                  // a project-wide custom line directly via the store.
                  const id = `custom-${Date.now()}`;
                  addCostLine({
                    id,
                    phaseId: pb.phaseId,
                    name: 'Custom Cost',
                    method: 'fixed',
                    value: 0,
                    stage: 'soft',
                    scope: 'direct',
                    allocationBasis: 'bua_share',
                    startPeriod: 1,
                    endPeriod: Math.max(1, pb.cp),
                    phasing: 'even',
                  });
                }}
              />
            );
          })}
        </>
      )}

      {subTab === 'inputs' && costInputMode === 'individual' && (
        <>
          {/* M2.0j Fix 16 (2026-05-07): asset selector bar. "All Assets"
              shows every asset section concatenated; picking a specific
              asset filters the cost sections + the summary cards below
              to only that asset. */}
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
              data-testid="costs-asset-selector"
            >
              <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)', marginRight: 'var(--sp-1)' }}>Show:</strong>
              <button
                type="button"
                onClick={() => setSelectedCostAssetId(null)}
                data-testid="costs-asset-selector-all"
                style={{
                  fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 6,
                  border: selectedCostAssetId === null ? 'none' : '1px solid var(--color-border)',
                  background: selectedCostAssetId === null ? 'var(--color-navy)' : 'var(--color-surface)',
                  color: selectedCostAssetId === null ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
                  cursor: 'pointer',
                }}
              >
                All Assets
              </button>
              {allVisibleAssets.map((a) => {
                const isActive = selectedCostAssetId === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelectedCostAssetId(a.id)}
                    data-testid={`costs-asset-selector-${a.id}`}
                    style={{
                      fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 6,
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

          {/* Per-phase, per-asset sections */}
          {perPhaseBreakdowns.map((pb) => {
            // M2.0j Fix 16: filter to selected asset (or show all).
            const filteredPhaseAssets = selectedCostAssetId
              ? pb.phaseAssets.filter((a) => a.id === selectedCostAssetId)
              : pb.phaseAssets;
            if (filteredPhaseAssets.length === 0) return null;
            return (
              <div key={pb.phaseId} data-testid={`costs-phase-${pb.phaseId}`}>
                <div style={phaseHeaderStyle}>{pb.phaseName} · {filteredPhaseAssets.length} asset{filteredPhaseAssets.length === 1 ? '' : 's'}</div>
                {(() => {
                  // M2.0j Fix 10: cost line periods reference PHASE start
                  // date, not project. periodLabelFn becomes phase-scoped
                  // here so Y1 on Phase 2 (starts 2026) renders "Dec 2026"
                  // not "Dec 2025".
                  const phaseObj = phases.find((ph) => ph.id === pb.phaseId);
                  const phaseStart = phaseObj?.startDate && phaseObj.startDate.length === 10
                    ? phaseObj.startDate
                    : project.startDate;
                  const phaseScopedPeriodLabel = (idx: number): string =>
                    getPeriodLabel(idx, phaseStart, project.modelType);
                  return filteredPhaseAssets.map((a) => {
                    const assetLines = linesForAsset(a, pb.phaseId);
                    const breakdown = pb.assetTotals[a.id]!;
                    const assetMetrics = metricsByAsset.get(a.id);
                    if (!assetMetrics) return null;
                    return (
                      <AssetCostSection
                        key={a.id}
                        asset={a}
                        lines={assetLines}
                        costOverrides={costOverrides}
                        breakdown={breakdown}
                        currency={project.currency}
                        scale={scale}
                        decimals={decimals}
                        periodLabel={phaseScopedPeriodLabel}
                        constructionPeriods={pb.cp}
                        subUnits={subUnits}
                        metrics={assetMetrics}
                        onUpdateLine={(lineId, patch) => updateCostLine(lineId, patch)}
                        onUpdateOverride={setCostOverride}
                        onRemoveOverride={removeCostOverride}
                        onRemoveLine={removeCostLine}
                        onAddCustom={() => handleAddCustom(a.id)}
                      />
                    );
                  });
                })()}
              </div>
            );
          })}

          {/* M2.0j Fix 16: 3 summary cards beneath the cost lines. When
              "All Assets" is selected, cards aggregate across every
              visible asset; when a single asset is selected, cards
              reflect just that asset. */}
          {allVisibleAssets.length > 0 && (() => {
            const targetAssets = selectedCostAssetId
              ? allVisibleAssets.filter((a) => a.id === selectedCostAssetId)
              : allVisibleAssets;
            const totals = { exclLand: 0, exclLandInKind: 0, inclLandInKind: 0 };
            for (const a of targetAssets) {
              const m = metricsByAsset.get(a.id);
              if (!m) continue;
              const byStage = { land: 0, hard: 0, soft: 0, operating: 0 } as Record<CostStage, number>;
              for (const pb of perPhaseBreakdowns) {
                const bd = pb.assetTotals[a.id];
                if (!bd) continue;
                byStage.land += bd.byStage.land;
                byStage.hard += bd.byStage.hard;
                byStage.soft += bd.byStage.soft;
                byStage.operating += bd.byStage.operating;
              }
              const t = computeAssetCostSummaryFromBreakdown(byStage, m.cashLandValue, m.inKindLandValue);
              totals.exclLand += t.exclLand;
              totals.exclLandInKind += t.exclLandInKind;
              totals.inclLandInKind += t.inclLandInKind;
            }
            const card: React.CSSProperties = {
              flex: 1, minWidth: 220,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--sp-2)',
            };
            return (
              <div
                style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)', flexWrap: 'wrap' }}
                data-testid="costs-asset-summary-cards"
              >
                <div style={card} data-testid="costs-summary-excl-land">
                  <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Excl. Land</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-heading)', marginTop: 4 }}>{formatScaled(totals.exclLand, scale, decimals)}</div>
                  <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>construction + soft + operating</div>
                </div>
                <div style={card} data-testid="costs-summary-excl-land-inkind">
                  <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Excl. Land In-Kind</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-heading)', marginTop: 4 }}>{formatScaled(totals.exclLandInKind, scale, decimals)}</div>
                  <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>above + cash land (developer cash needed)</div>
                </div>
                <div style={card} data-testid="costs-summary-incl-land-inkind">
                  <div style={{ fontSize: 10, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Incl. Land In-Kind</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-heading)', marginTop: 4 }}>{formatScaled(totals.inclLandInKind, scale, decimals)}</div>
                  <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>above + in-kind land (total cost basis)</div>
                </div>
              </div>
            );
          })()}

          {allVisibleAssets.length === 0 && (
            <div style={{ ...sectionCardStyle, textAlign: 'center', color: 'var(--color-meta)', padding: 'var(--sp-3)' }} data-testid="costs-no-assets">
              No visible assets yet. Add at least one asset (Tab 2) to configure costs.
            </div>
          )}
        </>
      )}

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
          constructionPeriods={currentPhase.constructionPeriods}
          onClose={() => setPopupAssetId(null)}
          onSave={handleCustomSave}
        />
      )}
      {/* M2.0L Fix 2: first-open chooser modal. Persists the pick via
          Project.costInputMode, then never reopens for this project. */}
      {showModeChooser && (
        <CostInputModeModal onPick={(mode) => setProject({ costInputMode: mode })} />
      )}
    </div>
  );
}
