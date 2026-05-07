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
  type OutputGranularity,
  type SubUnit,
  COST_METHODS,
  COST_METHOD_LABELS,
  COST_PHASINGS,
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
  classifyAssetCapex,
  computeCashFlowImpact,
  resolveUsefulLifeYears,
  deriveCostStage,
  distributeAnnualToPeriods,
  generatePeriodLabels,
  type AssetCostBreakdown,
} from '@/src/core/calculations';
import { currencyHeaderLine, formatScaled, formatScaledCurrency } from '@/src/core/formatters';

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
              {COST_PHASINGS.map((p) => (
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
  // M2.0g Addendum 2: caller supplies a period -> label resolver so
  // Start / End columns display "Dec 25" alongside the integer input.
  periodLabel: (idx: number) => string;
  // M2.0g Addendum 1: phase construction periods so Manual % phasing
  // can render per-period % inputs.
  constructionPeriods: number;
  // M2.0h Fix 5 (2026-05-07): sub-units for the per-sub-unit custom
  // rates sub-row (rendered when method = 'per_sub_unit_custom_rates').
  subUnits: SubUnit[];
}

function CostRow({
  asset, line, override, total, isLocked,
  onUpdateLine, onUpdateOverride, onRemoveOverride, onRemoveLine,
  currency, scale, periodLabel, constructionPeriods, subUnits,
}: CostRowProps): React.JSX.Element {
  // M2.0g Fix 6: Stage label still drives the row background + summary
  // tables, but the Direct/Indirect label is dropped (per-asset cost
  // segregation makes everything direct by definition).
  const stage = deriveCostStage(line);
  const isCustom = line.targetAssetId === asset.id;
  // M2.0g Addendum 2: resolved period labels for the row's start / end.
  const periodStartLabel = periodLabel(line.startPeriod);
  const periodEndLabel   = periodLabel(line.endPeriod);
  const isProjectWide = !line.targetAssetId;
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
        <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2 }}>
          {COST_STAGE_LABELS[stage]}{isCustom ? ' · custom' : ''}
        </div>
      </td>
      <td style={{ padding: '4px', minWidth: 160 }}>
        <select
          value={effMethod}
          onChange={(e) => writeMethod(e.target.value as CostMethod)}
          disabled={isLocked}
          style={{ ...inputStyle, fontSize: 11 }}
          data-testid={`cost-${asset.id}-${line.id}-method`}
        >
          {COST_METHODS.map((m) => (
            <option key={m} value={m}>{COST_METHOD_LABELS[m]}</option>
          ))}
        </select>
      </td>
      <td style={{ padding: '4px', width: 96 }}>
        <input
          type="number"
          value={effValue}
          onChange={(e) => writeValue(parseFloat(e.target.value) || 0)}
          disabled={isLocked}
          style={inputStyle}
          data-testid={`cost-${asset.id}-${line.id}-value`}
        />
      </td>
      <td style={{ padding: '4px', width: 70 }}>
        <input
          type="number"
          min={0}
          value={line.startPeriod}
          onChange={(e) => writeStartPeriod(parseInt(e.target.value) || 0)}
          disabled={isLocked}
          style={inputStyle}
          data-testid={`cost-${asset.id}-${line.id}-start`}
        />
        <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2, textAlign: 'center' }} data-testid={`cost-${asset.id}-${line.id}-start-label`}>
          {periodStartLabel}
        </div>
      </td>
      <td style={{ padding: '4px', width: 70 }}>
        <input
          type="number"
          min={0}
          value={line.endPeriod}
          onChange={(e) => writeEndPeriod(parseInt(e.target.value) || 0)}
          disabled={isLocked}
          style={inputStyle}
          data-testid={`cost-${asset.id}-${line.id}-end`}
        />
        <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2, textAlign: 'center' }} data-testid={`cost-${asset.id}-${line.id}-end-label`}>
          {periodEndLabel}
        </div>
      </td>
      <td style={{ padding: '4px', minWidth: 110 }}>
        <select
          value={effPhasing}
          onChange={(e) => writePhasing(e.target.value as CostPhasing)}
          disabled={isLocked}
          style={{ ...inputStyle, fontSize: 11 }}
          data-testid={`cost-${asset.id}-${line.id}-phasing`}
        >
          {COST_PHASINGS.map((p) => (
            <option key={p} value={p}>{PHASING_LABELS[p]}</option>
          ))}
        </select>
      </td>
      <td style={{ padding: '4px', minWidth: 110, textAlign: 'right' }}>
        <div style={calcOutputStyle} data-testid={`cost-${asset.id}-${line.id}-total`}>
          {formatScaled(total, scale)}
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
        {isCustom && (
          <button
            type="button"
            onClick={onRemoveLine}
            style={{
              ...inputStyle, background: 'transparent', cursor: 'pointer',
              fontSize: 10, marginTop: 2, color: 'var(--color-negative)',
              padding: '2px 4px',
            }}
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
        button on the right. */}
    {effPhasing === 'manual' && (() => {
      const periods = Math.max(1, line.endPeriod - line.startPeriod + 1);
      const sumOk = Math.abs(distSum - 100) < 0.5;
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
          </td>
        </tr>
      );
    })()}
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
                      {formatScaled(r.total, scale)}
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
                    {formatScaled(breakdown.totalCost, scale)}
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

// ── Per-asset section ─────────────────────────────────────────────────────
interface AssetCostSectionProps {
  asset: Asset;
  lines: CostLine[];                  // visible to this asset (project + custom-targeted)
  costOverrides: CostOverride[];
  breakdown: AssetCostBreakdown;
  currency: string;
  scale: DisplayScale;
  periodLabel: (idx: number) => string;
  constructionPeriods: number;
  subUnits: SubUnit[];
  onUpdateLine: (lineId: string, patch: Partial<CostLine>) => void;
  onUpdateOverride: (override: CostOverride) => void;
  onRemoveOverride: (assetId: string, lineId: string) => void;
  onRemoveLine: (lineId: string) => void;
  onAddCustom: () => void;
}

function AssetCostSection({
  asset, lines, costOverrides, breakdown, currency, scale, periodLabel, constructionPeriods, subUnits,
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
            {formatScaled(subtotal, scale)}
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
                    periodLabel={periodLabel}
                    constructionPeriods={constructionPeriods}
                    subUnits={subUnits}
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
                  {formatScaled(subtotal, scale)}
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
  metricsByAsset: Map<string, { cashLandValue: number; inKindLandValue: number; landValue: number }>;
  project: { currency: string; startDate: string; modelType: 'monthly' | 'annual'; displayScale: DisplayScale };
  totalConstructionPeriods: number;
  // M2.0g Fix 7a: per-cost-line breakdown needs the full line list so
  // each asset's lines can be enumerated under its row.
  costLines: CostLine[];
  // M2.0h Fix 6 (2026-05-07): runtime output granularity. Annual inputs
  // distribute to quarterly (4×) or monthly (12×) using cost line phasing.
  granularity: OutputGranularity;
}

function SummaryTables({
  phaseAssets, perPhaseBreakdowns, metricsByAsset,
  project, totalConstructionPeriods, costLines, granularity,
}: SummaryTablesProps): React.JSX.Element {
  const scale = project.displayScale;
  const fmt = (v: number): string => formatScaled(v, scale);
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
                const assetRowAnnual = new Array<number>(annualPeriodCount).fill(0);
                let assetTotal = 0;
                for (const pb of perPhaseBreakdowns) {
                  const bd = pb.assetTotals[a.id];
                  if (!bd) continue;
                  assetTotal += bd.total;
                  for (let i = 0; i < annualPeriodCount; i++) assetRowAnnual[i] += bd.perPeriod[i + 1] ?? 0;
                }
                const assetRow = transformAnnualSeries(assetRowAnnual);
                // Per-line per-period: distribute each line's total
                // across periods using the line's own phasing curve.
                const linesForThisAsset = costLines.filter((c) => c.targetAssetId === undefined || c.targetAssetId === a.id);
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

      {/* M2.0g Fix 7b + 7d: Table 2 - Capex by Stage (transposed:
          Stage rows x Year cols). Total column in 2nd position. */}
      <div style={sectionCardStyle} data-testid="capex-by-stage">
        <strong style={{ fontSize: 13, display: 'block', marginBottom: 'var(--sp-1)' }}>2. Capex by Stage</strong>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={headLeftStyle}>Stage</th>
                <th style={headStyle}>Total</th>
                {periodLabels.map((p, i) => (<th key={i} style={headStyle}>{p}</th>))}
              </tr>
            </thead>
            <tbody>
              {(['land', 'hard', 'soft', 'operating'] as const).map((stageKey) => {
                const row = stageTable.map((r) => r[stageKey]);
                const total = stageTotals[stageKey];
                return (
                  <tr key={stageKey} data-testid={`capex-stage-row-${stageKey}`}>
                    <td style={cellName}>{COST_STAGE_LABELS[stageKey]}</td>
                    <td style={cellNum} data-testid={`capex-stage-row-${stageKey}-total`}>{fmt(total)}</td>
                    {row.map((v, i) => (<td key={i} style={cellNum}>{fmt(v)}</td>))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--color-grey-pale)', fontWeight: 700 }}>
                <td style={cellName}>Total</td>
                <td style={cellNum} data-testid="capex-stage-grand-total">{fmt(stageTotals.total)}</td>
                {stageTable.map((r, i) => (<td key={i} style={cellNum}>{fmt(r.total)}</td>))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* M2.0g Fix 7d: Table 3 - Capex Summary by Treatment (existing
          M2.0d table). Total column moved to 2nd position. */}
      <div style={sectionCardStyle} data-testid="capex-by-treatment">
        <strong style={{ fontSize: 13, display: 'block', marginBottom: 'var(--sp-1)' }}>3. Capex Summary by Treatment</strong>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={headLeftStyle}>Asset</th>
                <th style={headStyle}>Total Capex</th>
                <th style={headStyle}>Strategy</th>
                <th style={headStyle}>Land Cash</th>
                <th style={headStyle}>Land In-Kind</th>
                <th style={headStyle}>Hard</th>
                <th style={headStyle}>Soft</th>
                <th style={headStyle}>Operating</th>
                <th style={headStyle}>Cash Flow Impact</th>
              </tr>
            </thead>
            <tbody>
              {treatmentTable.map((r) => (
                <tr key={r.id} data-testid={`capex-treatment-${r.id}`}>
                  <td style={cellName}>{r.name}</td>
                  <td style={cellNum}>{fmt(r.total)}</td>
                  <td style={cellNum}>{r.strategy}</td>
                  <td style={cellNum}>{fmt(r.landCash)}</td>
                  <td style={cellNum}>{fmt(r.landInKind)}</td>
                  <td style={cellNum}>{fmt(r.hard)}</td>
                  <td style={cellNum}>{fmt(r.soft)}</td>
                  <td style={cellNum}>{fmt(r.operating)}</td>
                  <td style={cellNum} data-testid={`capex-treatment-${r.id}-cash-flow`}>{fmt(r.cashOutflow)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--color-grey-pale)', fontWeight: 700 }}>
                <td style={cellName}>Project Total</td>
                <td style={cellNum} data-testid="capex-treatment-total-capex">{fmt(treatTotals.total)}</td>
                <td style={cellNum}></td>
                <td style={cellNum} data-testid="capex-treatment-total-land-cash">{fmt(treatTotals.landCash)}</td>
                <td style={cellNum} data-testid="capex-treatment-total-land-inkind">{fmt(treatTotals.landInKind)}</td>
                <td style={cellNum}>{fmt(treatTotals.hard)}</td>
                <td style={cellNum}>{fmt(treatTotals.soft)}</td>
                <td style={cellNum}>{fmt(treatTotals.operating)}</td>
                <td style={cellNum} data-testid="capex-treatment-total-cash-flow">{fmt(treatTotals.cashOutflow)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* M2.0g Fix 7e: Table 4 (NEW) - Capex by Cost Type per Asset.
          Matrix view: Asset rows x [Land Cash, Land In-Kind, Hard,
          Soft, Operating] cols + Total in 2nd col. */}
      <div style={sectionCardStyle} data-testid="capex-by-cost-type">
        <strong style={{ fontSize: 13, display: 'block', marginBottom: 'var(--sp-1)' }}>4. Capex by Cost Type per Asset</strong>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={headLeftStyle}>Asset</th>
                <th style={headStyle}>Total</th>
                <th style={headStyle}>Land Cash</th>
                <th style={headStyle}>Land In-Kind</th>
                <th style={headStyle}>Hard Cost</th>
                <th style={headStyle}>Soft Cost</th>
                <th style={headStyle}>Operating</th>
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((r) => (
                <tr key={r.id} data-testid={`capex-cost-type-${r.id}`}>
                  <td style={cellName}>{r.name}</td>
                  <td style={cellNum}>{fmt(r.total)}</td>
                  <td style={cellNum}>{fmt(r.landCash)}</td>
                  <td style={cellNum}>{fmt(r.landInKind)}</td>
                  <td style={cellNum}>{fmt(r.hard)}</td>
                  <td style={cellNum}>{fmt(r.soft)}</td>
                  <td style={cellNum}>{fmt(r.operating)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--color-grey-pale)', fontWeight: 700 }}>
                <td style={cellName}>Project Total</td>
                <td style={cellNum} data-testid="capex-cost-type-grand-total">{fmt(treatTotals.total)}</td>
                <td style={cellNum}>{fmt(treatTotals.landCash)}</td>
                <td style={cellNum}>{fmt(treatTotals.landInKind)}</td>
                <td style={cellNum}>{fmt(treatTotals.hard)}</td>
                <td style={cellNum}>{fmt(treatTotals.soft)}</td>
                <td style={cellNum}>{fmt(treatTotals.operating)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
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
  // M2.0g Fix 7: sub-tab state. 'inputs' shows the per-asset cost
  // tables (editable surface). 'results' shows the 4 capex summary
  // tables (read-only).
  const [subTab, setSubTab] = useState<'inputs' | 'results'>('inputs');
  // M2.0h Fix 6: runtime view granularity for Results sub-tab.
  // Defaults to project.outputGranularity ('annual' on new projects).
  // User toggles persist via setProject so the next session opens the
  // same view.
  const granularity: OutputGranularity = project.outputGranularity ?? 'annual';
  const setGranularity = (g: OutputGranularity): void => {
    setProject({ outputGranularity: g });
  };
  // M2.0g: project-wide display scale.
  const scale: DisplayScale = project.displayScale ?? 'full';
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

  // Per-asset metrics map (for treatment table)
  const metricsByAsset = useMemo(() => {
    const map = new Map<string, { cashLandValue: number; inKindLandValue: number; landValue: number }>();
    for (const a of allVisibleAssets) {
      const m = resolveAssetAreaMetrics(a, project, parcels, allVisibleAssets, subUnits, landAllocationMode);
      map.set(a.id, { cashLandValue: m.cashLandValue, inKindLandValue: m.inKindLandValue, landValue: m.landValue });
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
              line per tab. Cells stay free of currency suffix. */}
          <div
            style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', fontStyle: 'italic', marginTop: 4 }}
            data-testid="currency-header-line"
          >
            {currencyHeaderLine(project.currency, scale)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
              {formatScaled(stageTotals[s], scale)}
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

      {subTab === 'inputs' && (
        <>
          {/* Per-phase, per-asset sections */}
          {perPhaseBreakdowns.map((pb) => {
            if (pb.phaseAssets.length === 0) return null;
            return (
              <div key={pb.phaseId} data-testid={`costs-phase-${pb.phaseId}`}>
                <div style={phaseHeaderStyle}>{pb.phaseName} · {pb.phaseAssets.length} asset{pb.phaseAssets.length === 1 ? '' : 's'}</div>
                {pb.phaseAssets.map((a) => {
                  const assetLines = linesForAsset(a, pb.phaseId);
                  const breakdown = pb.assetTotals[a.id]!;
                  return (
                    <AssetCostSection
                      key={a.id}
                      asset={a}
                      lines={assetLines}
                      costOverrides={costOverrides}
                      breakdown={breakdown}
                      currency={project.currency}
                      scale={scale}
                      periodLabel={periodLabelFn}
                      constructionPeriods={pb.cp}
                      subUnits={subUnits}
                      onUpdateLine={(lineId, patch) => updateCostLine(lineId, patch)}
                      onUpdateOverride={setCostOverride}
                      onRemoveOverride={removeCostOverride}
                      onRemoveLine={removeCostLine}
                      onAddCustom={() => handleAddCustom(a.id)}
                    />
                  );
                })}
              </div>
            );
          })}

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
          <SummaryTables
            phaseAssets={allVisibleAssets}
            perPhaseBreakdowns={perPhaseBreakdowns}
            parcelsByPhase={new Map()}
            metricsByAsset={metricsByAsset}
            project={{ currency: project.currency, startDate: project.startDate, modelType: project.modelType, displayScale: scale }}
            totalConstructionPeriods={totalConstructionPeriods}
            costLines={costLines}
            granularity={granularity}
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
        <strong style={{ fontSize: 18 }}>{formatScaled(projectTotal, scale)}</strong>
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
    </div>
  );
}
