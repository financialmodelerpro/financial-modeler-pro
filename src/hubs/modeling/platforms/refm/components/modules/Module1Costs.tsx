'use client';

/**
 * Module1Costs.tsx (v7 schema, M2.0d rebuild)
 *
 * Per-asset cost segregation with the M2.0d standard 9-line catalog +
 * "+ Add Custom Cost" popup + 3 capex summary tables.
 *
 * Layout:
 *   1. Top bar: phase selector + stage filter
 *   2. Stage summary tile bar (4 tiles: Land / Hard / Soft / Total Capex Excl. Land)
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

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  CAPEX_PHASING_SOURCES,
  CAPEX_PHASING_SOURCE_LABELS,
  type CapexPhasingSource,
  type AssetCapexPhasing,
  deriveLineBaseId,
  deriveCostWindow,
} from '../../lib/state/module1-types';
import { resolvePhasingSource, isParcelDrivenLandLine, collectionsForAsset, collectionsTotalForAsset, phaseLocalToProjectIndex } from '@/src/core/calculations/capexPhasing';
import {
  mergeCatalog,
  resolveCatalogId,
  findCatalogEntry,
  catalogLabelFor,
  stampFromEntry,
  describeCatalogChange,
  mintLineId,
  type AnyCostCatalogEntry,
  type UserCostCatalogEntry,
} from '../../lib/state/costCatalog';
import { planCostCopy } from '../../lib/state/costCopyPlan';
import { computeAllSellResults } from '../../lib/revenue-resolvers';
import { BASIS_DIVERGENCE_TOL } from '../../lib/reports/checksReport';
import { assetVisibleLines, eligibleBaseLines } from '@/src/core/calculations/selectedBase';
import {
  computeAssetCost,
  computeCostLinePerSubUnit,
  resolveAssetAreaMetrics,
  aggregatePhaseMetrics,
  classifyAssetCapex,
  computeCashFlowImpact,
  resolveUsefulLifeYears,
  deriveCostStage,
  distribute,
  distributeItemCost,
  generatePeriodLabels,
  costLineCaption,
  costLineProjectPeriodIndex,
  type AssetCostBreakdown,
} from '@/src/core/calculations';
import { currencyHeaderLine, formatAccounting } from '@/src/core/formatters';
import { AccountingNumberInput } from '../ui/AccountingNumberInput';
import { PercentageInput } from '../ui/PercentageInput';
import {
  CELL_HEADER,
  TABLE_TITLE,
  ROW_ASSET_HEADING,
  ROW_DATA,
  ROW_SUBTOTAL,
  ROW_GRAND_TOTAL,
  COLUMN_WIDTHS,
  nonLabelColumnPct,
  periodTableStyle,
} from './_shared/tableStyles';
import { buildResultsPeriodAxis } from './_shared/periodAxis';

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
  // Distinct from soft, because the whole point of the stage is that a reader
  // can see marketing is not part of the construction cost.
  marketing: 'color-mix(in srgb, var(--color-accent-cool, var(--color-navy)) 8%, transparent)',
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

/**
 * A new user line (2026-08-17).
 *
 * ONE definition for both entry points (the button under the table and the
 * insert-above / insert-below controls on a row), and it takes THIS PHASE's
 * construction length. The old inline version used the longest phase in the
 * project, so a custom line on a short phase was born spanning a window that
 * belonged to a different phase entirely.
 *
 * `windowFollowsConstruction` is set, so it tracks the phase like a catalog
 * line until the user types a window of their own. Stage defaults to soft and
 * is editable on the row.
 */
function makeCustomCostLine(phaseId: string, constructionPeriods: number): CostLine {
  return {
    // P10-Fix 3 (2026-05-12): a custom line added here is a PROJECT-WIDE master
    // (no targetAssetId); the user overrides per asset from the row.
    id: `custom-${Date.now()}__${phaseId}`,
    phaseId,
    name: 'Custom Cost',
    method: 'fixed',
    value: 0,
    stage: 'soft',
    scope: 'direct',
    allocationBasis: 'per_asset',
    ...deriveCostWindow('custom', constructionPeriods),
    windowFollowsConstruction: true,
    phasing: 'even',
    costCategory: 'direct',
  };
}

/**
 * Adding a catalog entry WHERE IT IS USED (2026-08-17).
 *
 * If the entry a user needs is not in the list, they add it here and it joins
 * the list for every future project rather than becoming a one-off custom line.
 *
 * WHOEVER ADDS AN ENTRY SETS ITS BEHAVIOUR. Method and stage are required and
 * the phasing source is explicit, because a name with no behaviour is exactly
 * the problem the catalog exists to solve: it would be a differently-shaped way
 * to end up with a row that looks like one thing and charges like another.
 */
function AddCatalogEntryForm({
  initialLabel, onSave, onCancel, testId,
}: {
  initialLabel: string;
  onSave: (draft: { label: string; method: CostMethod; stage: CostStage; phasingSource: CapexPhasingSource }) => Promise<void>;
  onCancel: () => void;
  testId: string;
}): React.JSX.Element {
  const [label, setLabel] = useState(initialLabel.trim() === 'Custom Cost' ? '' : initialLabel);
  const [method, setMethod] = useState<CostMethod>('percent_of_selected');
  const [stage, setStage] = useState<CostStage>('soft');
  const [source, setSource] = useState<CapexPhasingSource>('inherit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labelStyle: React.CSSProperties = { fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-meta)', display: 'block' };
  const fieldStyle: React.CSSProperties = { ...inputStyle, fontSize: 10, padding: '2px 4px' };
  return (
    <div
      data-testid={testId}
      style={{
        marginTop: 4, padding: 6, borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--color-navy)',
        background: 'color-mix(in srgb, var(--color-navy) 5%, transparent)',
        display: 'grid', gap: 4,
      }}
    >
      <div>
        <span style={labelStyle}>Name</span>
        <input
          type="text" value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Utility connections"
          style={fieldStyle} data-testid={`${testId}-label`}
        />
      </div>
      <div>
        <span style={labelStyle}>Method</span>
        <select value={method} onChange={(e) => setMethod(e.target.value as CostMethod)} style={fieldStyle} data-testid={`${testId}-method`}>
          {COST_METHODS.filter((m) => m !== 'rate_per_parking_bay').map((m) => (
            <option key={m} value={m}>{COST_METHOD_LABELS[m]}</option>
          ))}
        </select>
      </div>
      <div>
        <span style={labelStyle}>Stage</span>
        <select value={stage} onChange={(e) => setStage(e.target.value as CostStage)} style={fieldStyle} data-testid={`${testId}-stage`}>
          {COST_STAGES.map((s) => (<option key={s} value={s}>{COST_STAGE_LABELS[s]}</option>))}
        </select>
      </div>
      <div>
        <span style={labelStyle}>Phasing source</span>
        <select value={source} onChange={(e) => setSource(e.target.value as CapexPhasingSource)} style={fieldStyle} data-testid={`${testId}-source`}>
          {CAPEX_PHASING_SOURCES.map((s) => (<option key={s} value={s}>{CAPEX_PHASING_SOURCE_LABELS[s]}</option>))}
        </select>
      </div>
      {error && <div style={{ fontSize: 9, color: 'var(--color-negative)' }} data-testid={`${testId}-error`}>{error}</div>}
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          disabled={busy || label.trim().length === 0}
          onClick={async () => {
            setBusy(true); setError(null);
            try { await onSave({ label: label.trim(), method, stage, phasingSource: source }); }
            catch (e) { setError(e instanceof Error ? e.message : String(e)); }
            finally { setBusy(false); }
          }}
          data-testid={`${testId}-save`}
          style={{ fontSize: 9, padding: '3px 8px', background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)', border: 'none', borderRadius: 3, cursor: 'pointer' }}
        >
          {busy ? 'Saving...' : 'Add and use'}
        </button>
        <button
          type="button" onClick={onCancel} data-testid={`${testId}-cancel`}
          style={{ fontSize: 9, padding: '3px 8px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 3, cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
      <div style={{ fontSize: 9, color: 'var(--color-meta)', lineHeight: 1.3 }}>
        Saved to your catalog and available on every project.
      </div>
    </div>
  );
}

/** Small square control for the row's position buttons (2026-08-17). */
function orderButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    fontSize: 9,
    lineHeight: 1,
    padding: '2px 4px',
    borderRadius: 3,
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    color: enabled ? 'var(--color-meta)' : 'var(--color-border)',
    cursor: enabled ? 'pointer' : 'not-allowed',
  };
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
            <AccountingNumberInput
              value={value}
              onChange={(n) => setValue(n)}
              min={0}
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
  /** 2026-08-16: total sales cash collected for this asset, so a revenue-based
   *  row can say when the cash basis and the sale basis differ. */
  collectionsTotal?: number;
  /** 2026-08-17: the window the ENGINE spent this line in, and why. The row
   *  renders this rather than the stored window, so a line following a derived
   *  source cannot show one window while the model uses another. */
  resolvedWindow?: import('@/src/core/calculations').ResolvedLineWindow;
  /** 2026-08-17: the base a `percent_of_selected` line charged on, from the
   *  pass that computed it. */
  selectedBase?: number;
  /** 2026-08-17: the per-period money the ENGINE spent on this line
   *  (`perLinePerPeriod`). The row renders this and computes nothing itself. */
  resolvedSchedule?: number[];
  /** 2026-08-17: the catalog entries available to this user (built-ins plus
   *  their own), and the current identity of this row. */
  catalogEntries?: AnyCostCatalogEntry[];
  /** Called when the user adds a new entry from the row's picker. */
  onAddCatalogEntry?: (draft: { label: string; method: CostMethod; stage: CostStage; phasingSource: CapexPhasingSource }) => Promise<void>;
  /** 2026-08-17: every line this asset sees, in DISPLAY ORDER. The row derives
   *  which of them it may charge on with the same shared rule the engine
   *  enforces, so a reorder can say what it changed. */
  visibleLines?: CostLine[];
  /** 2026-08-17: ordering. Absent means the surface does not offer it. */
  onMove?: (direction: 'up' | 'down') => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onInsertNear?: (position: 'above' | 'below') => void;
}

function CostRow({
  asset, line, override, total, isLocked,
  onUpdateLine, onUpdateOverride, onRemoveOverride, onRemoveLine,
  currency, scale, decimals, periodLabel, constructionPeriods, subUnits,
  metrics, editsGoToLine, collectionsTotal,
  resolvedWindow, selectedBase, resolvedSchedule, visibleLines,
  catalogEntries, onAddCatalogEntry,
  onMove, canMoveUp, canMoveDown, onInsertNear,
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
  // strategy.
  // P11 Fix 8 (2026-05-13): Start/End is now universally editable per
  // user spec ("applied universally no restriction to change"). The
  // previous gate (isStartEndLocked = isLocked && !isLand) locked
  // Auto-IDC lines, so any phase that had a financing tranche feeding
  // it (e.g. Phase 3 in the user's report) carried locked Start/End
  // cells while phases without tranches stayed editable. Method +
  // Value remain locked on locked lines (those still flow from the
  // master / financing facility); only the timing fields open up.
  const baseId = deriveLineBaseId(line.id);
  const isLand = baseId === 'land-cash' || baseId === 'land-inkind';
  const isAutoIdc = line.id.startsWith('auto-idc__');
  const isValueLocked = isLocked; // master gate: every locked line locks Value + Method.
  const isStartEndLocked = false; // universally editable; see P11 Fix 8 note.
  const isPhasingLocked = isLocked && !isLand; // Land lines: Phasing stays editable.
  const isNameLocked = isLocked && !isLand; // Land lines: name stays editable (rename).
  const isFullyLocked = isAutoIdc; // Auto-IDC retains the old binary semantics.
  void isFullyLocked; // exposed for future use (toggle/delete affordances).
  // P11 Fix 12 (2026-05-13): effective Start/End mirror effMethod /
  // effValue / effPhasing - read from override when present, fall back
  // to master. Without this the Start/End inputs were displaying the
  // MASTER value while writeStartPeriod/writeEndPeriod wrote to the
  // OVERRIDE, so on every override carrier (which is every asset after
  // the Apply panel writes full overrides per Fix 7) the input visibly
  // snapped back to the master on rerender even though the override had
  // taken the user's value. "Unable to change Start/End for some lines
  // in Phase 3" was this read/write asymmetry, scoped to assets that
  // had any override on the line.
  const effStartPeriod = override?.startPeriod ?? line.startPeriod;
  const effEndPeriod   = override?.endPeriod   ?? line.endPeriod;
  // M2.0g Addendum 2: resolved period labels for the row's start / end.
  const periodStartLabel = periodLabel(effStartPeriod);
  const periodEndLabel   = periodLabel(effEndPeriod);
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
  // ── Stage: the catalog's default, and the user's answer (2026-08-17) ────
  // `catalogStage` is what the line would classify as with no user choice, so
  // picking that value CLEARS the override rather than pinning the current
  // default forever.
  // ── Catalog identity (2026-08-17) ──────────────────────────────────────
  // The row's identity is a SELECTION; the name is a label. `resolveCatalogId`
  // falls back to the line's own base id, so every existing line declares
  // itself with no migration: a row renamed "Permits and approvals" that is the
  // seeded Commission line captions as Commission, which is the mismatch
  // showing itself.
  const catalog = catalogEntries ?? [];
  const currentCatalogId = resolveCatalogId(line);
  const currentEntry = findCatalogEntry(currentCatalogId, catalog.filter((e) => !e.builtIn) as UserCostCatalogEntry[]);
  const catalogLabel = catalogLabelFor(line, catalog.filter((e) => !e.builtIn) as UserCostCatalogEntry[]);
  // THE FLAG FIRES WHEN THE LABEL CLAIMS TO BE A DIFFERENT CATALOG ENTRY, not
  // merely when it differs from this one's label. Comparing against the entry
  // label alone marked every seeded row whose name is a synonym of its entry
  // (measured: "Construction (BUA)" against the entry "Superstructure",
  // "Landscaping" against "Landscape"), which is noise in exactly the place the
  // signal has to be trusted. A row named after ANOTHER entry is the real case:
  // "Project management" on a Professional fee line, "Permits and approvals" on
  // a Commission line. The identity caption is always visible either way.
  const nameClaimsAnotherEntry = catalog.some(
    (e) => e.id !== currentCatalogId && e.label.trim().toLowerCase() === line.name.trim().toLowerCase(),
  );
  const applyCatalogEntry = (entry: AnyCostCatalogEntry): void => {
    // A reassignment CHANGES THE NUMBER when the method changes, so it says
    // what it will change before doing it. A silent reassignment would be the
    // same class of defect the catalog exists to close.
    const changes = describeCatalogChange(line, entry, {
      method: COST_METHOD_LABELS as unknown as Record<string, string>,
      stage: COST_STAGE_LABELS as unknown as Record<string, string>,
      source: CAPEX_PHASING_SOURCE_LABELS as unknown as Record<string, string>,
    });
    if (changes.length > 0 && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const lines = changes.map((c) => `  ${c.field}: ${c.from} -> ${c.to}`).join('\n');
      const ok = window.confirm(
        `Set '${line.name}' to the catalog entry '${entry.label}'?\n\nThis changes:\n${lines}\n\n`
        + 'The name stays as it is. Value, window and selected lines are not touched.',
      );
      if (!ok) return;
    }
    onUpdateLine(stampFromEntry(entry));
  };
  const catalogStage = deriveCostStage({ ...line, stageOverride: undefined });
  const isStageLocked = isLocked && !isCustom && isParcelDrivenLandLine(line);
  const writeStage = (next: CostStage): void => {
    onUpdateLine({ stageOverride: next === catalogStage ? undefined : next });
  };
  // Selected base lines this row still references but may no longer charge on,
  // because they now sit below it. Same shared rule the engine enforces.
  const droppedBaseNames: string[] = (() => {
    if (effMethod !== 'percent_of_selected' || !visibleLines) return [];
    const allowed = new Set(eligibleBaseLines(visibleLines, line.id).map((c) => c.id));
    const selected = line.selectedLineIds ?? [];
    return selected
      .filter((id) => !allowed.has(id))
      .map((id) => visibleLines.find((c) => c.id === id)?.name ?? 'a deleted line');
  })();
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
  // ── Phasing inheritance (2026-08-15) ───────────────────────────────────
  // The row reads its state from the SAME pure resolver the engine uses, so
  // the badge and the number cannot disagree. Nothing here re-derives a rule.
  // Land value lines take no part in phasing: their timing is the parcel
  // schedule. Same predicate the engine uses, so the row and the maths cannot
  // disagree about which lines are exempt.
  const [addingCatalog, setAddingCatalog] = useState(false);
  const isParcelLand = isParcelDrivenLandLine(line);
  const effPhasingSource: CapexPhasingSource = resolvePhasingSource(line, override);
  const assetHasCurve = !!asset.capexPhasing;
  // The line's own curve control is inert when something else is driving:
  // a derived source, or an asset curve the line is inheriting.
  const phasingDrivenElsewhere =
    effPhasingSource === 'land_cash' || effPhasingSource === 'collections'
    || (effPhasingSource === 'inherit' && assetHasCurve);
  const phasingSourceHint =
    'Where this line takes its phasing curve from. Inherit follows the asset curve set above the table; '
    + 'Own keeps this row on its own curve; land cash and collections follow those cash flows.';
  const phasingBadge: { text: string; title: string; warn: boolean } | null = (() => {
    // No badge on a land value line: it is not inheriting because it is not in
    // the scheme at all, and "not inheriting" would read as a choice.
    if (isParcelLand) return null;
    if (effPhasingSource === 'land_cash') {
      return { text: 'follows land cash', warn: false, title: 'Phased on the land cash outflow, including any deferred parcel schedule.' };
    }
    if (effPhasingSource === 'collections') {
      return { text: 'follows collections', warn: false, title: 'Phased on sales cash collected, so it arises when cash arrives rather than across the build.' };
    }
    if (effPhasingSource === 'own') {
      // The break-out state the brief asks to be visible. Only worth saying
      // when there is an asset curve for it to have stopped following.
      return assetHasCurve
        ? { text: 'not inheriting', warn: true, title: 'This line is on its own curve and does not follow the asset curve set above the table.' }
        : null;
    }
    return null;
  })();
  // 2026-08-16: a cash-basis line charges on collections, a sale-basis line on
  // gross list value. They coincide unless cash falls short of the sale value,
  // so this says so only when it actually does, on the row that is affected.
  const basisNote: string | null = (() => {
    if (effMethod !== 'percent_of_revenue_cash' && effMethod !== 'percent_of_revenue_sale') return null;
    const gross = metrics.totalRevenue ?? 0;
    if (gross <= 0 || collectionsTotal === undefined) return null;
    const rel = collectionsTotal / gross - 1;
    if (Math.abs(rel) <= BASIS_DIVERGENCE_TOL) return null;
    const pct = (rel * 100).toFixed(1);
    return effMethod === 'percent_of_revenue_cash'
      ? `charges on cash collected, ${pct}% vs gross sale value`
      : `charges on gross sale value; cash collected is ${pct}% different`;
  })();

  const writePhasingSource = (src: CapexPhasingSource): void => {
    if (override) {
      onUpdateOverride({
        assetId: asset.id, lineId: line.id, method: effMethod, value: effValue,
        phasing: effPhasing, distribution: override.distribution,
        disabled: override.disabled, phasingSource: src, overridden: true,
      });
    } else {
      onUpdateLine({ phasingSource: src });
    }
  };

  // ── The period window: who owns it (2026-08-17) ────────────────────────
  //
  // Three states, and the row must not present them all as two editable boxes:
  //   1. A DERIVED SOURCE (land cash / collections) supplies the window as well
  //      as the shape, so there is no window to edit. The cells are replaced by
  //      what the engine resolved, exactly as the land value rows replaced
  //      their phasing control with "from parcel schedule".
  //   2. FOLLOWING THE CONSTRUCTION WINDOW. Editable, but it tracks the phase
  //      until the user types, and says so.
  //   3. THE LINE'S OWN. Editable, and stays put.
  const windowIsDerived = effPhasingSource === 'land_cash' || effPhasingSource === 'collections';
  const overrideHasWindow = override !== undefined && override.overridden !== false
    && (override.startPeriod !== undefined || override.endPeriod !== undefined);
  const windowFollowsCp = line.windowFollowsConstruction === true && !overrideHasWindow;
  const writeStartPeriod = (n: number): void => {
    if (override) {
      onUpdateOverride({ assetId: asset.id, lineId: line.id, method: effMethod, value: effValue, phasing: effPhasing, distribution: override.distribution, disabled: override.disabled, startPeriod: n, endPeriod: override.endPeriod ?? line.endPeriod, overridden: true });
    } else {
      // Typing a window IS the deliberate act that stops it following the
      // construction length. Nothing else clears the flag.
      onUpdateLine({ startPeriod: n, windowFollowsConstruction: false });
    }
  };
  const writeEndPeriod = (n: number): void => {
    if (override) {
      onUpdateOverride({ assetId: asset.id, lineId: line.id, method: effMethod, value: effValue, phasing: effPhasing, distribution: override.distribution, disabled: override.disabled, startPeriod: override.startPeriod ?? line.startPeriod, endPeriod: n, overridden: true });
    } else {
      onUpdateLine({ endPeriod: n, windowFollowsConstruction: false });
    }
  };
  const followConstructionWindow = (): void => {
    onUpdateLine({
      ...deriveCostWindow(baseId, constructionPeriods),
      windowFollowsConstruction: true,
    });
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
  const storedDistribution = override?.distribution ?? line.distribution ?? [];
  // ── The curve ACTUALLY IN FORCE (2026-08-15b) ──────────────────────────
  //
  // This row used to render the line's STORED weights whatever was driving it,
  // so a line inheriting an asset curve of 0/10/30/40/20 still displayed its
  // own 10/30/40/20 while the engine spent on the inherited one. The row now
  // shows what is in force and makes it read-only when the line is not the
  // thing deciding, because an editable box that does not drive the number is
  // worse than no box.
  //
  // Only the INHERIT case can be resolved here: it is a pure slice of the
  // asset curve. A derived source (land cash / collections) depends on model
  // series this row does not have, so its editor is replaced by a caption
  // naming the source rather than by numbers that might be wrong.
  const inheritsAssetCurve = effPhasingSource === 'inherit' && assetHasCurve && !isParcelLand;
  const inheritedCurve: number[] | null = (() => {
    if (!inheritsAssetCurve) return null;
    const c = asset.capexPhasing;
    if (!c || c.phasing !== 'manual') return null;
    const slice = (c.distribution ?? []).slice(effStartPeriod, effEndPeriod + 1);
    return slice.reduce((s, v) => s + (v ?? 0), 0) > 0 ? slice : null;
  })();
  const effDistribution = inheritedCurve ?? storedDistribution;
  // What the row should RENDER as its phasing mode, as opposed to what is
  // stored on the line.
  const displayPhasing: CostPhasing = isParcelLand
    ? effPhasing
    : inheritsAssetCurve
      ? (asset.capexPhasing?.phasing ?? effPhasing)
      : effPhasing;
  const curveIsReadOnly = inheritedCurve !== null;
  const writeDistribution = (next: number[]): void => {
    if (isProjectWide) {
      onUpdateOverride({ assetId: asset.id, lineId: line.id, method: effMethod, value: effValue, phasing: effPhasing, distribution: next, disabled: override?.disabled });
    } else {
      onUpdateLine({ distribution: next });
    }
  };
  const updateDistAt = (idx: number, val: number): void => {
    const periods = Math.max(1, effEndPeriod - effStartPeriod + 1);
    const dist = Array.from({ length: periods }, (_, i) => effDistribution[i] ?? 0);
    dist[idx] = Math.max(0, val);
    writeDistribution(dist);
  };
  const autoNormalize = (): void => {
    const periods = Math.max(1, effEndPeriod - effStartPeriod + 1);
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
        {/* 2026-08-15: the hard / soft marker, restored. It was dropped on
            2026-05-11 (M2.0L Pass3 Fix 13) leaving only a row background
            colour with no legend, so a line's classification was invisible on
            the row that carries it. The classification itself never went away:
            deriveCostStage, the engine's byStage and the summary tiles have
            had it throughout. A cost table a lender reads has to say which
            costs are hard and which are soft on the line itself. */}
        {/* ── THE ROW'S CATALOG IDENTITY (2026-08-17) ─────────────────────
            One control doing both jobs the brief asks for: it says what this
            line IS, and it is how you change it. Renaming the input above
            changes the label and nothing else, so this caption is the only
            place the behaviour is declared. */}
        {!isParcelLand && catalog.length > 0 && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, color: 'var(--color-meta)' }}>is a</span>
            <select
              value={currentCatalogId ?? '__custom__'}
              disabled={isLocked}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__add__') { setAddingCatalog(true); return; }
                if (v === '__custom__') { onUpdateLine({ catalogId: undefined }); return; }
                const entry = catalog.find((c) => c.id === v);
                if (entry) applyCatalogEntry(entry);
              }}
              data-testid={`cost-${asset.id}-${line.id}-catalog`}
              title={currentEntry?.hint ?? 'Which catalog entry this line is. Selecting one sets the method, stage and phasing source.'}
              style={{
                fontSize: 9, padding: '1px 4px', borderRadius: 3, maxWidth: 150,
                border: '1px solid var(--color-border)',
                background: nameClaimsAnotherEntry ? 'color-mix(in srgb, var(--color-accent-warm) 14%, transparent)' : 'var(--color-surface)',
                color: 'var(--color-meta)', fontStyle: 'italic',
              }}
            >
              {!currentCatalogId && <option value="__custom__">Custom line</option>}
              {catalog.filter((c) => c.selectable !== false).map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
              {currentCatalogId && currentEntry?.selectable === false && (
                <option value={currentCatalogId}>{catalogLabel}</option>
              )}
              {onAddCatalogEntry && <option value="__add__">+ Add to catalog...</option>}
            </select>
            {nameClaimsAnotherEntry && (
              <span
                data-testid={`cost-${asset.id}-${line.id}-catalog-renamed`}
                style={{ fontSize: 9, color: 'var(--color-accent-warm)', fontStyle: 'italic' }}
                title={`This row is labelled "${line.name}", which is the name of a different catalog entry, and it is a ${catalogLabel} line. Rename it or reassign it.`}
              >
                renamed
              </span>
            )}
          </div>
        )}
        {addingCatalog && onAddCatalogEntry && (
          <AddCatalogEntryForm
            initialLabel={line.name}
            onCancel={() => setAddingCatalog(false)}
            onSave={async (draft) => {
              await onAddCatalogEntry(draft);
              setAddingCatalog(false);
            }}
            testId={`cost-${asset.id}-${line.id}-catalog-add`}
          />
        )}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
          {/* 2026-08-17: the classification is a CHOICE, not a label. Rows can
              be added, renamed and deleted, so the catalog's answer is a
              default; the user can say that a line is marketing, or that a
              custom row is hard cost. Locked land rows keep the badge: their
              stage is what they are. */}
          {isStageLocked ? (
            <span
              data-testid={`cost-${asset.id}-${line.id}-stage`}
              title={`${COST_STAGE_LABELS[stage]} cost`}
              style={{
                fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.04em', padding: '1px 5px', borderRadius: 3,
                background: STAGE_BG[stage], border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              {COST_STAGE_LABELS[stage]}
            </span>
          ) : (
            <select
              value={stage}
              onChange={(e) => writeStage(e.target.value as CostStage)}
              data-testid={`cost-${asset.id}-${line.id}-stage`}
              title={line.stageOverride
                ? `Classified as ${COST_STAGE_LABELS[stage]} by you. The catalog default is ${COST_STAGE_LABELS[catalogStage]}.`
                : `${COST_STAGE_LABELS[stage]} cost. Change it to reclassify this line everywhere it is totalled.`}
              style={{
                fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.04em', padding: '1px 4px', borderRadius: 3,
                background: STAGE_BG[stage], border: '1px solid var(--color-border)',
                color: 'var(--color-text)', maxWidth: 104,
              }}
            >
              {COST_STAGES.map((s) => (
                <option key={s} value={s}>{COST_STAGE_LABELS[s]}</option>
              ))}
            </select>
          )}
          {line.stageOverride && (
            <span
              data-testid={`cost-${asset.id}-${line.id}-stage-overridden`}
              style={{ fontSize: 9, color: 'var(--color-navy)', fontStyle: 'italic' }}
              title={`Reset to the catalog default (${COST_STAGE_LABELS[catalogStage]}).`}
              onClick={() => onUpdateLine({ stageOverride: undefined })}
              role="button"
            >
              set by you
            </span>
          )}
          {isCustom && (
            <span style={{ fontSize: 9, color: 'var(--color-meta)' }}>custom</span>
          )}
        </div>
        {/* ── Position (2026-08-17) ────────────────────────────────────────
            Order decides what this line may charge on: a % of selected lines
            may reference anything ABOVE it and nothing below. Until these
            controls existed, position was whatever creation order happened to
            be, so a developer fee added after a contingency could never enter
            its base. */}
        {(onMove || onInsertNear) && (
          <div style={{ display: 'flex', gap: 2, alignItems: 'center', marginTop: 2 }} data-testid={`cost-${asset.id}-${line.id}-order-controls`}>
            {onMove && (
              <>
                <button
                  type="button"
                  onClick={() => onMove('up')}
                  disabled={canMoveUp === false}
                  title="Move up. A line can charge only on the lines above it."
                  data-testid={`cost-${asset.id}-${line.id}-move-up`}
                  style={orderButtonStyle(canMoveUp !== false)}
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => onMove('down')}
                  disabled={canMoveDown === false}
                  title="Move down."
                  data-testid={`cost-${asset.id}-${line.id}-move-down`}
                  style={orderButtonStyle(canMoveDown !== false)}
                >
                  ▼
                </button>
              </>
            )}
            {onInsertNear && (
              <>
                <button
                  type="button"
                  onClick={() => onInsertNear('above')}
                  title="Insert a new cost line directly above this one."
                  data-testid={`cost-${asset.id}-${line.id}-insert-above`}
                  style={orderButtonStyle(true)}
                >
                  +↑
                </button>
                <button
                  type="button"
                  onClick={() => onInsertNear('below')}
                  title="Insert a new cost line directly below this one."
                  data-testid={`cost-${asset.id}-${line.id}-insert-below`}
                  style={orderButtonStyle(true)}
                >
                  +↓
                </button>
              </>
            )}
          </div>
        )}
        {/* A selection this line USED to charge on and no longer may, because
            one of them is now below it. The engine drops those by rule and has
            always done so silently; a reorder is exactly when it happens. */}
        {droppedBaseNames.length > 0 && (
          <div
            data-testid={`cost-${asset.id}-${line.id}-base-dropped`}
            style={{ fontSize: 9, color: 'var(--color-accent-warm)', marginTop: 2, lineHeight: 1.3, whiteSpace: 'normal' }}
            title="A line can charge only on lines above it. These are selected but now sit below, so they are not in the base."
          >
            not in the base any more: {droppedBaseNames.join(', ')}
          </div>
        )}
        {/* 2026-08-16: shown ONLY when the cash and sale bases actually differ,
            which is rare. Silent agreement needs no caption; a material gap is
            the case that would justify a per-period revenue base, so it says so
            on the row it affects rather than only in a verifier. */}
        {basisNote && (
          <div
            data-testid={`cost-${asset.id}-${line.id}-basis-note`}
            style={{ fontSize: 9, color: 'var(--color-accent-warm)', marginTop: 2, fontStyle: 'italic' }}
            title="Cash basis charges on collections; sale basis charges on gross list value. They differ when cash is not all collected inside the hold."
          >
            {basisNote}
          </div>
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
                title={costLineCaption({ line, override, asset, metrics, parkingBays: asset.parkingBaysRequired ?? 0, resolvedTotal: total, selectedTotal: selectedBase })}
              >
                {costLineCaption({ line, override, asset, metrics, parkingBays: asset.parkingBaysRequired ?? 0, resolvedTotal: total, selectedTotal: selectedBase })}
              </div>
            )}
          </>
        )}
      </td>
      {windowIsDerived ? (
        // A followed source supplies the window, so there is nothing here to
        // edit. Rendering the STORED window in two boxes is how a marketing
        // line showed periods 1 to 25 while the engine spent it on collections.
        <td
          colSpan={2}
          style={{ padding: '4px' }}
          data-testid={`cost-${asset.id}-${line.id}-window-derived`}
          data-window-source={effPhasingSource}
          title={resolvedWindow?.reason ?? 'The window comes from the source this line follows.'}
        >
          <div style={{ fontSize: 10, color: 'var(--color-meta)', fontStyle: 'italic', lineHeight: 1.3, textAlign: 'center' }}>
            {resolvedWindow && !resolvedWindow.degraded ? (
              <>
                <div style={{ color: 'var(--color-navy)', fontWeight: 700 }}>
                  {periodLabel(resolvedWindow.startPeriod)}
                  {resolvedWindow.endPeriod !== resolvedWindow.startPeriod ? ` to ${periodLabel(resolvedWindow.endPeriod)}` : ''}
                </div>
                <div>from {effPhasingSource === 'land_cash' ? 'land cash' : 'collections'}</div>
              </>
            ) : (
              <div style={{ color: 'var(--color-accent-warm)' }} data-testid={`cost-${asset.id}-${line.id}-window-degraded`}>
                {effPhasingSource === 'land_cash' ? 'no land cash yet' : 'no collections yet'}
              </div>
            )}
          </div>
        </td>
      ) : (
      <>
      <td style={{ padding: '4px', width: 70 }}>
        {/* T3-edit-runtime v5 (2026-05-12): no max cap on Start. User
            asked to be able to phase costs after construction (e.g.
            commissioning, post-handover Operate fees). Only floor at
            zero. Out-of-range surfaces an informational chip below. */}
        <AccountingNumberInput
          min={0}
          decimals={0}
          value={effStartPeriod}
          onChange={(n) => writeStartPeriod(Math.max(0, Math.round(n)))}
          disabled={isStartEndLocked}
          style={inputStyle}
          data-testid={`cost-${asset.id}-${line.id}-start`}
        />
        <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2, textAlign: 'center' }} data-testid={`cost-${asset.id}-${line.id}-start-label`}>
          {periodStartLabel}
        </div>
        {effStartPeriod > constructionPeriods && (
          <div style={{ fontSize: 9, color: 'var(--color-accent-warm)', marginTop: 2, textAlign: 'center' }} data-testid={`cost-${asset.id}-${line.id}-start-warning`}>
            past construction
          </div>
        )}
      </td>
      <td style={{ padding: '4px', width: 70 }}>
        <AccountingNumberInput
          min={0}
          decimals={0}
          value={effEndPeriod}
          onChange={(n) => writeEndPeriod(Math.max(0, Math.round(n)))}
          disabled={isStartEndLocked}
          style={{
            ...inputStyle,
            ...(effEndPeriod < effStartPeriod ? { borderColor: 'var(--color-negative)' } : {}),
          }}
          data-testid={`cost-${asset.id}-${line.id}-end`}
          aria-invalid={effEndPeriod < effStartPeriod}
          title={effEndPeriod < effStartPeriod ? 'End must be on or after Start.' : ''}
        />
        <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2, textAlign: 'center' }} data-testid={`cost-${asset.id}-${line.id}-end-label`}>
          {periodEndLabel}
        </div>
        {/* Whether this window is the line's own or the phase's, said on the
            row. A derived default that never says it is derived is how a
            three-period phase kept lines running to period 25. */}
        {!isParcelLand && (
          windowFollowsCp ? (
            <div
              style={{ fontSize: 9, color: 'var(--color-navy)', marginTop: 2, fontStyle: 'italic', textAlign: 'center' }}
              data-testid={`cost-${asset.id}-${line.id}-window-follows`}
              title="This window tracks the phase construction length. Typing a start or end period puts the line on its own window."
            >
              follows construction
            </div>
          ) : !overrideHasWindow && (
            <button
              type="button"
              onClick={followConstructionWindow}
              data-testid={`cost-${asset.id}-${line.id}-window-refollow`}
              title="Put this line back on the phase construction window."
              style={{ fontSize: 9, marginTop: 2, background: 'transparent', border: 'none', color: 'var(--color-meta)', cursor: 'pointer', textDecoration: 'underline', padding: 0, width: '100%' }}
            >
              use construction
            </button>
          )
        )}
        {effEndPeriod < effStartPeriod && (
          <div style={{ fontSize: 9, color: 'var(--color-negative)', marginTop: 2 }} data-testid={`cost-${asset.id}-${line.id}-end-error`}>
            End must be on or after Start
          </div>
        )}
        {effEndPeriod >= effStartPeriod && effEndPeriod > constructionPeriods && (
          <div style={{ fontSize: 9, color: 'var(--color-accent-warm)', marginTop: 2 }} data-testid={`cost-${asset.id}-${line.id}-end-warning`}>
            extends into operations period
          </div>
        )}
      </td>
      </>
      )}
      <td style={{ padding: '4px', minWidth: 110 }}>
        {/* Land value lines carry NO phasing control (2026-08-15b). Their cash
            timing is the parcel schedule, so a curve here would present a
            decision the user does not have. This restores the pre-inheritance
            behaviour for these two rows. */}
        {isParcelLand ? (
          <div
            data-testid={`cost-${asset.id}-${line.id}-phasing-parcel`}
            style={{ fontSize: 10, color: 'var(--color-meta)', fontStyle: 'italic', lineHeight: 1.3 }}
            title="Land cash timing follows the payment terms set on the parcel in Tab 2, including any deferred schedule."
          >
            from parcel schedule
          </div>
        ) : (
        <>
        {/* 2026-08-15: WHERE the curve comes from, above the curve itself.
            'Inherit' with no asset curve behaves exactly as before, which is
            what every pre-existing line resolves to. */}
        <select
          value={effPhasingSource}
          onChange={(e) => writePhasingSource(e.target.value as CapexPhasingSource)}
          disabled={isPhasingLocked}
          style={{ ...inputStyle, fontSize: 10, marginBottom: 2 }}
          data-testid={`cost-${asset.id}-${line.id}-phasing-source`}
          title={phasingSourceHint}
        >
          {CAPEX_PHASING_SOURCES.map((s) => (
            <option key={s} value={s}>{CAPEX_PHASING_SOURCE_LABELS[s]}</option>
          ))}
        </select>
        {/* The line's own curve. Only meaningful when the line is on its own
            curve or inheriting from an asset that has none, so it is disabled
            (not hidden) when a source is driving, and the caption says why.
            Hiding it would make the row look like it had lost a control. */}
        <select
          value={effPhasing}
          onChange={(e) => writePhasing(e.target.value as CostPhasing)}
          disabled={isPhasingLocked || phasingDrivenElsewhere}
          style={{ ...inputStyle, fontSize: 11, opacity: phasingDrivenElsewhere ? 0.5 : 1 }}
          data-testid={`cost-${asset.id}-${line.id}-phasing`}
        >
          {COST_PHASING_OPTIONS.map((p) => (
            <option key={p} value={p}>{PHASING_LABELS[p]}</option>
          ))}
        </select>
        {/* A line that has stopped inheriting says so, in the row, rather than
            leaving the user to infer it from a curve that ignores the asset
            control above the table. */}
        {phasingBadge && (
          <div
            data-testid={`cost-${asset.id}-${line.id}-phasing-badge`}
            style={{
              fontSize: 9, marginTop: 2, fontStyle: 'italic',
              color: phasingBadge.warn ? 'var(--color-accent-warm)' : 'var(--color-navy)',
            }}
            title={phasingBadge.title}
          >
            {phasingBadge.text}
          </div>
        )}
        </>
        )}
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
            // 2026-08-17: no confirm. The row is removed and an Undo banner
            // restores it at its index with its overrides. A dialog you learn
            // to dismiss is not a safety net; an undo that works is.
            onClick={onRemoveLine}
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
    {/* A line following a derived source has a curve this row cannot compute
        (it comes from the land cash outflow or the collections profile), so it
        says where the curve comes from instead of showing numbers that might
        not be the ones in force. */}
    {(effPhasingSource === 'land_cash' || effPhasingSource === 'collections') && !isParcelLand && (
      <tr data-testid={`cost-row-${asset.id}-${line.id}-derived-row`} style={{ background: 'var(--color-grey-pale)' }}>
        <td colSpan={9} style={{ padding: '6px 12px', fontSize: 11, color: 'var(--color-meta)', fontStyle: 'italic' }}>
          {effPhasingSource === 'land_cash'
            ? 'Phased on the land cash outflow, including any deferred parcel schedule. There is no curve to set here.'
            : 'Phased on sales cash collected, so it arises when cash arrives rather than across the build. There is no curve to set here.'}
        </td>
      </tr>
    )}
    {displayPhasing === 'manual' && (() => {
      const periods = Math.max(1, effEndPeriod - effStartPeriod + 1);
      const sumOk = Math.abs(distSum - 100) < 0.5;
      // Money per period = total × pct/100 when sum~=100; otherwise
      // total × pct/sum (so partial sums still produce sensible chips).
      const sumDenom = distSum > 0 ? distSum : 1;
      return (
        <tr data-testid={`cost-row-${asset.id}-${line.id}-manual-row`} style={{ background: 'var(--color-grey-pale)' }}>
          <td colSpan={9} style={{ padding: '8px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>
                {curveIsReadOnly ? 'Asset curve %' : 'Manual %'}
              </strong>
              {curveIsReadOnly && (
                <span
                  data-testid={`cost-${asset.id}-${line.id}-curve-source`}
                  style={{ fontSize: 10, color: 'var(--color-navy)', fontStyle: 'italic' }}
                >
                  in force from the asset curve, edit it above the table
                </span>
              )}
              {Array.from({ length: periods }, (_, i) => {
                const periodIdx = effStartPeriod + i;
                return (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <PercentageInput
                      min={0}
                      max={100}
                      value={effDistribution[i] ?? 0}
                      onChange={(n) => updateDistAt(i, n)}
                      disabled={isLocked || curveIsReadOnly}
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
            {/* 2026-08-17: the money chips that used to sit here are gone. This
                block is the WEIGHT editor; the money is rendered once, below,
                from the engine's own schedule. See the money strip. */}
          </td>
        </tr>
      );
    })()}
    {/* ── ONE MONEY STRIP, FROM THE ENGINE (2026-08-17) ────────────────────
        There used to be TWO. The money chips inside the Manual % block were
        guarded on `displayPhasing === 'manual'` (the RESOLVED mode) and the
        strip here on `effPhasing !== 'manual'` (the line's OWN stored mode),
        and those differ for every line inheriting a manual asset curve. So a
        line inheriting a 10/30/40/20 curve rendered the correct amounts and,
        directly beneath, an even spread the model never used: measured on
        Construction (BUA), 11,760 / 35,280 / 47,040 / 23,520 above
        29,400 four times. The comment on the old strip said it rendered only
        when phasing was not manual "so we don't double-render and confuse the
        user", which was the right intent pointed at the wrong variable.

        The row no longer distributes anything. It renders `perLinePerPeriod`,
        the schedule the ENGINE spent, so the screen cannot disagree with the
        model. A line following a derived source now shows its real money too,
        where before it showed a caption and nothing else. */}
    {!effDisabled && (() => {
      const sched = resolvedSchedule ?? [];
      let first = -1;
      let last = -1;
      for (let i = 0; i < sched.length; i += 1) {
        if ((sched[i] ?? 0) !== 0) { if (first < 0) first = i; last = i; }
      }
      if (first < 0) return null;
      const chips: Array<{ idx: number; amount: number }> = [];
      for (let p = first; p <= last; p += 1) chips.push({ idx: p, amount: sched[p] ?? 0 });
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
        selectedBase={selectedBase}
        scale={scale}
        decimals={decimals}
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
                      <AccountingNumberInput
                        min={0}
                        value={effPerSubUnitRates[r.key] ?? r.rate}
                        onChange={(n) => updateSubUnitRate(r.key, n)}
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
  line, asset, isLocked, selectedBase, scale, decimals, onChangeSelected,
}: {
  line: CostLine;
  asset: Asset;
  isLocked: boolean;
  /** 2026-08-17: the amount the percentage is charged on, from the engine. */
  selectedBase?: number;
  scale: DisplayScale;
  decimals: DisplayDecimals;
  onChangeSelected: (ids: string[]) => void;
}): React.JSX.Element {
  // M2.0M Pass 6 Fix 6 (2026-05-11): rebuilt as a dropdown button +
  // chip strip. The button shows "{N} lines selected"; clicking opens
  // a popover with the full sibling list as checkboxes (scrolls to
  // 240px). Apply persists; click outside closes. Selected lines also
  // render as small chips beneath the button so the user sees what's
  // chosen without opening the picker.
  const costLines = useModule1Store(useShallow((s) => s.costLines));
  const projectCountry = useModule1Store((s) => s.project.country);
  const [open, setOpen] = useState(false);
  // EVERY LINE ABOVE THIS ONE ON THIS ASSET, in display order (2026-08-15).
  //
  // This used to exclude every `percent_of_selected` line by method, commented
  // "we don't allow recursive references". That banned a whole method to stop a
  // cycle, and it cost the ordinary chain a budget is built from: a developers
  // fee charged on hard cost plus the soft costs above it, then a contingency
  // charged on everything including that fee. Both are percent_of_selected, so
  // the chain could not be built. It also stopped the standard catalog putting
  // professional fee inside contingency's base.
  //
  // Note the old filter did NOT exclude custom lines (project-wide and
  // asset-targeted lines both passed), and it applied NO ordering at all, so it
  // was simultaneously too strict about method and too loose about position.
  //
  // The positional rule replaces both, and it is the SAME function the engine
  // enforces, so the list offered and the base computed cannot diverge.
  const siblings = eligibleBaseLines(
    assetVisibleLines(costLines, line.phaseId, asset.id, projectCountry),
    line.id,
  );
  const selected = new Set(line.selectedLineIds ?? []);
  const toggle = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChangeSelected(Array.from(next));
  };
  const selectedLines = siblings.filter((s) => selected.has(s.id));

  // OPEN UPWARDS when there is not enough room below. Fixing the stacking trap
  // makes the options paint above the rows beneath them, but a picker on one of
  // the last rows still opens into space below the fold and would have to be
  // scrolled to. Measured against the VIEWPORT rather than the scroll
  // container, because the popover is now free to paint over anything.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [dropUp, setDropUp] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (!el) return;
    const decide = (): void => {
      const r = el.getBoundingClientRect();
      // Popover height: the 240px list cap plus its header and padding, which
      // is its maximum. Using the cap rather than a measured height keeps the
      // decision stable while the list is still rendering.
      const needed = 240 + 56;
      const below = window.innerHeight - r.bottom;
      const above = r.top;
      // Only flip when below genuinely cannot hold it AND above is roomier, so
      // a picker near the top of a short list never flips off the top edge.
      setDropUp(below < needed && above > below);
    };
    decide();
    window.addEventListener('resize', decide);
    // Capture phase: the scroll happens on the module's own container, not on
    // window, so a bubbling listener would never see it.
    window.addEventListener('scroll', decide, true);
    return () => {
      window.removeEventListener('resize', decide);
      window.removeEventListener('scroll', decide, true);
    };
  }, [open]);

  return (
    <tr data-testid={`cost-row-${asset.id}-${line.id}-pct-picker`} style={{ background: 'var(--color-grey-pale)' }}>
      {/* P8-Fix 6 (2026-05-12): colSpan synced to 9 cols (Pass 8 dropped
          Category + Driver). Previously stale at 11 causing the picker
          to render misaligned and occasionally hidden when the row was
          clipped by overflow:hidden cells. */}
      {/* THE POPOVER'S STACKING TRAP LIVED ON THIS CELL (2026-08-13).
          `app/globals.css` styles EVERY `td:first-child` as
          `position: sticky; z-index: 1` with an opaque background, to freeze
          the label column on the wide period tables. This cell is the first
          (and only) cell in its row, so that rule caught it and made it a
          stacking context at level 1, which SCOPED the popover's `z-index: 20`
          inside it. The next cost row's first cell is another sticky level-1
          context, a later sibling at the same level, so it painted on top and
          its opaque background hid the options completely.
          Measured in Chromium: with the global rule applied, a hit test at an
          option's coordinates returned the row BELOW; on the LAST row (no
          later sibling) the same popover was hit-testable, which is exactly
          why the report described it as opening underneath "the cost rows
          beneath it".
          Freezing means nothing on a full-width spanning cell, so this opts
          OUT of the rule rather than escalating z-index: a z-index can never
          escape an ancestor stacking context, so raising it would have looked
          like a fix, changed nothing, and invited the next person to raise it
          again. */}
      <td colSpan={9} style={{ padding: '8px 12px', position: 'static', zIndex: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)', paddingTop: 6 }}>
            Apply to:
          </strong>
          <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
            <button
              ref={triggerRef}
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
              <span style={{ fontSize: 10, color: 'var(--color-meta)' }} data-testid={`cost-${asset.id}-${line.id}-pct-picker-base`}>
                ({selected.size} selected
                {selectedBase !== undefined ? ` · ${formatAccounting(selectedBase, scale, decimals)}` : ''})
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
                    position: 'absolute',
                    ...(dropUp ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
                    left: 0,
                    minWidth: 320, maxWidth: 480,
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)', boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
                    zIndex: 20, padding: 8,
                  }}
                  data-testid={`cost-${asset.id}-${line.id}-pct-picker-popover`}
                  data-placement={dropUp ? 'above' : 'below'}
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

// ── One curve across the asset (2026-08-15) ───────────────────────────────
//
// The group half of the shared inherit-and-override mechanism. Absent means no
// asset curve, and every line keeps its own phasing, so this control is the
// opt-in that makes inheritance bite. Turning it OFF restores per-line phasing
// without discarding anything, because nothing on the lines was rewritten.
interface AssetPhasingControlProps {
  asset: Asset;
  constructionPeriods: number;
  scale: DisplayScale;
  onChange: (p: AssetCapexPhasing | undefined) => void;
}

function AssetPhasingControl({ asset, constructionPeriods, onChange }: AssetPhasingControlProps): React.JSX.Element {
  const curve = asset.capexPhasing;
  const on = !!curve;
  const slots = Math.max(1, constructionPeriods + 1);
  const dist = curve?.distribution ?? [];
  const sum = dist.reduce((s, v) => s + (v ?? 0), 0);

  return (
    <div
      data-testid={`asset-phasing-${asset.id}`}
      style={{
        border: '1px solid var(--color-border)',
        borderLeft: `4px solid ${on ? 'var(--color-navy)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius)',
        padding: 'var(--sp-1) var(--sp-2)',
        marginBottom: 'var(--sp-1)',
        background: on ? 'color-mix(in srgb, var(--color-navy) 5%, transparent)' : 'transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={on}
            data-testid={`asset-phasing-${asset.id}-toggle`}
            onChange={(e) => onChange(e.target.checked ? { phasing: 'even' } : undefined)}
          />
          One phasing curve for this asset
        </label>
        {on && (
          <>
            <select
              value={curve?.phasing ?? 'even'}
              data-testid={`asset-phasing-${asset.id}-mode`}
              onChange={(e) => onChange({ phasing: e.target.value as CostPhasing, distribution: curve?.distribution })}
              style={{ ...inputStyle, width: 130 }}
            >
              {COST_PHASING_OPTIONS.map((p) => (<option key={p} value={p}>{PHASING_LABELS[p]}</option>))}
            </select>
            <span style={{ fontSize: 11, color: 'var(--color-meta)' }}>
              Every cost line on this asset follows it, except lines set to their own curve, land cash or collections.
            </span>
          </>
        )}
        {!on && (
          <span style={{ fontSize: 11, color: 'var(--color-meta)' }}>
            Off: each line keeps the phasing set on its own row.
          </span>
        )}
      </div>
      {on && curve?.phasing === 'manual' && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {Array.from({ length: slots }, (_, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: 9, color: 'var(--color-meta)' }}>P{i}</span>
                <input
                  type="number"
                  value={dist[i] ?? 0}
                  data-testid={`asset-phasing-${asset.id}-w${i}`}
                  onChange={(e) => {
                    const next = Array.from({ length: slots }, (_, k) => dist[k] ?? 0);
                    next[i] = Math.max(0, Number(e.target.value) || 0);
                    onChange({ phasing: 'manual', distribution: next });
                  }}
                  style={{ ...inputStyle, width: 54, textAlign: 'right' }}
                />
              </div>
            ))}
          </div>
          {/* Weights are normalised by the engine, so they need not total 100.
              Saying so avoids the user chasing a rounding remainder. */}
          <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
            Weights total {sum.toFixed(1)}. They are normalised, so they do not have to add to 100.
          </div>
        </div>
      )}
    </div>
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
  /** 2026-08-17: insert a new line directly above / below an existing one. */
  onInsertNear?: (anchorLineId: string, position: 'above' | 'below') => void;
  /** 2026-08-17: move a line within its phase, swapping with the row the user
   *  can see (not the adjacent array element, which a stage filter can hide). */
  onMoveLine?: (lineId: string, direction: 'up' | 'down', neighbourId?: string) => void;
  /** 2026-08-17: built-in catalog entries plus this user's own. */
  catalogEntries?: AnyCostCatalogEntry[];
  onAddCatalogEntry?: (draft: { label: string; method: CostMethod; stage: CostStage; phasingSource: CapexPhasingSource }) => Promise<void>;
  /** 2026-08-15: writes Asset.capexPhasing (the one curve for this asset). */
  onUpdateAsset?: (assetId: string, patch: Partial<Asset>) => void;
  /** 2026-08-16: total sales cash collected for this asset, passed to the row
   *  so a revenue-based line can say when cash and sale bases differ. */
  collectionsTotal?: number;
}

function AssetCostSection({
  asset, lines, costOverrides, breakdown, currency, scale, decimals, periodLabel, constructionPeriods, subUnits,
  metrics,
  onUpdateLine, onUpdateOverride, onRemoveOverride, onRemoveLine,
  onAddCustom, onInsertNear, onMoveLine, onUpdateAsset,
  catalogEntries, onAddCatalogEntry,
}: AssetCostSectionProps): React.JSX.Element {
  const cp = constructionPeriods;
  // Default-collapsed (2026-05-13): every per-asset cost section in
  // Tab 3 Inputs starts closed; user expands when ready to edit. Matches
  // Tab 2's default-collapsed convention. Per-session re-open is the
  // user's normal interaction; no localStorage persistence on this one
  // since the inputs are scoped to the active asset pill.
  const [collapsed, setCollapsed] = useState(true);
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
          {/* ── ONE CURVE ACROSS THE ASSET (2026-08-15) ──────────────────────
              Phasing was set line by line and every line on an asset repeats
              the same curve in practice, so the user typed the same
              percentages five or six times per asset. This sets it once; every
              line inherits unless it is broken out or follows a derived source
              (land cash / collections).

              OFF by default. While it is off, every line keeps its own
              phasing, which is why an existing project is unchanged until the
              user opts in here. */}
          <AssetPhasingControl
            asset={asset}
            constructionPeriods={cp}
            onChange={(capexPhasing) => onUpdateAsset?.(asset.id, { capexPhasing })}
            scale={scale}
          />
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
              {lines.map((line, idx) => {
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
                    resolvedWindow={breakdown.resolvedWindowByLineId[line.id]}
                    selectedBase={breakdown.selectedBaseByLineId[line.id]}
                    resolvedSchedule={breakdown.perLinePerPeriod[line.id]}
                    visibleLines={lines}
                    catalogEntries={catalogEntries}
                    onAddCatalogEntry={onAddCatalogEntry}
                    onMove={onMoveLine
                      ? (direction) => onMoveLine(
                          line.id,
                          direction,
                          (direction === 'up' ? lines[idx - 1] : lines[idx + 1])?.id,
                        )
                      : undefined}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < lines.length - 1}
                    onInsertNear={onInsertNear ? (position) => onInsertNear(line.id, position) : undefined}
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
  // P11 Fix 9 (2026-05-13): view mode. Combined view splits each
  // asset's Table 1 group into a header row (asset name only, full-
  // width highlight, no values) + per-line nested rows + an
  // "Asset Subtotal" row at the bottom. Single Asset view keeps the
  // single-row asset header (name + total + periods on one row).
  resultsView: 'combined' | 'single_asset';
}

function SummaryTables({
  phaseAssets, perPhaseBreakdowns, metricsByAsset,
  project, totalConstructionPeriods, costLines, granularity, phases,
  resultsView,
}: SummaryTablesProps): React.JSX.Element {
  const scale = project.displayScale;
  const decimals = project.displayDecimals ?? 2;
  // M2.0M Pass 4 Fix 6 (2026-05-12): universal accounting format applied
  // across Module 1. zero -> "-", negative -> parens, null/undef -> blank.
  // Results sub-tab header-line "All figures in SAR '000" via
  // currencyHeaderLine; cells stay clean and tabular.
  const fmt = (v: number): string => formatAccounting(v, scale, decimals);
  // M2.0 Pass 14 (2026-05-13): annual-only basis until M5 Financial
  // Statements. subPerYear collapses to 1; granularity prop kept on
  // SummaryTablesProps for forward compatibility but always 'annual'.
  const subPerYear = 1;
  // P11 Fix 13 (2026-05-13): universal period range rule. Scan every
  // in-scope asset's bd.perPeriod across every phase WITHOUT an upper
  // bound, applying the phase offset = phaseStartYear - projectStart
  // shift. Track the min and max non-zero annual columns; the rendered
  // axis covers exactly that range. Previously the scan clamped each
  // candidate column by annualPeriodCount (= min(totalConstructionPeriods,
  // 24)), so cost lines phased past the phase's constructionPeriods
  // (e.g. operations-tail commissioning) were dropped from the axis
  // entirely. The 24-cap also lost projects with a long total horizon.
  // Now: annualPeriodCount is derived FROM the data extent, with the
  // construction window as a floor and a 60-year hard cap for layout
  // safety. Combined view = union across phaseAssets; Single Asset
  // view = that asset's range only (phaseAssets is already filtered
  // upstream by resultsViewMode).
  const projectStartYearForCrop = new Date(project.startDate).getUTCFullYear();
  let dataFirstAnnual = Number.POSITIVE_INFINITY;
  let dataLastAnnual = -1;
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
      // perPeriod[0] is the upfront / Y0 lump: land cash, land in kind, and
      // anything following them. 2026-08-17: placed by the SHARED rule, so the
      // columns this scan decides to show are the columns the money is in.
      if (Math.abs(bd.perPeriod[0] ?? 0) > 0.5) {
        const col = phaseLocalToProjectIndex(0, offset);
        if (col >= 0) {
          if (col < dataFirstAnnual) dataFirstAnnual = col;
          if (col > dataLastAnnual) dataLastAnnual = col;
        }
      }
      // No upper clamp - line endPeriod may exceed phase cp (operations
      // tail) and the engine's perPeriod array is sized to fit, so we
      // walk the whole array.
      for (let i = 1; i < bd.perPeriod.length; i++) {
        if (Math.abs(bd.perPeriod[i] ?? 0) <= 0.5) continue;
        const col = offset + i - 1;
        if (col < 0) continue;
        if (col < dataFirstAnnual) dataFirstAnnual = col;
        if (col > dataLastAnnual) dataLastAnnual = col;
      }
    }
  }
  const hasData = dataLastAnnual >= 0 && Number.isFinite(dataFirstAnnual);
  let activeFirstAnnual: number;
  let activeLastAnnual: number;
  if (hasData) {
    activeFirstAnnual = dataFirstAnnual;
    activeLastAnnual = dataLastAnnual;
  } else {
    // No activity in scope: keep one column so colSpan stays > 0 and
    // empty-state messages render correctly.
    activeFirstAnnual = 0;
    activeLastAnnual = 0;
  }
  // M2.0 Pass 14 (2026-05-13): data-driven axis, no hard cap.
  // annualPeriodCount = max(project duration, latest active column + 1, 1).
  // Project duration = totalConstructionPeriods (max construction + ops
  // offset across all phases, computed upstream in computeProjectTimeline
  // and threaded in via the SummaryTablesProps). 60-year clamp removed.
  const annualPeriodCount = Math.max(totalConstructionPeriods, activeLastAnnual + 1, 1);
  const periodCount = annualPeriodCount * subPerYear;
  // Period labels respect granularity: 'Dec 25' / 'Q1 25' / 'Jan 25'.
  const periodLabels = generatePeriodLabels(project.startDate, annualPeriodCount, granularity);
  const cropSubFirst = activeFirstAnnual * subPerYear;
  const cropSubCount = (activeLastAnnual - activeFirstAnnual + 1) * subPerYear;
  function cropRow<T>(arr: T[]): T[] {
    return arr.slice(cropSubFirst, cropSubFirst + cropSubCount);
  }
  const croppedPeriodLabels = cropRow(periodLabels);
  const croppedPeriodCount = cropSubCount;

  // Universal prior-period column (2026-05-13): every period-axis
  // results table renders one prior calendar period at index 0, then
  // the active columns. Pure layout, no engine / number change. See
  // _shared/periodAxis.ts for the helper that prepends the prior label.
  const periodAxis = buildResultsPeriodAxis({
    startIso: project.startDate,
    numAnnualPeriods: activeLastAnnual - activeFirstAnnual + 1,
    cropAnnualOffset: activeFirstAnnual,
  });
  // Per-row "prior" value: always zero (formatted by `fmt`, typically
  // renders as accounting dash). Prepend to every cropRow-derived value
  // array before mapping to <td>s.
  const PRIOR_ZERO = 0;
  // 1 Total + N period columns -> equal-width percentage applied to all.
  const nonLabelPct = nonLabelColumnPct(1 + periodAxis.count);

  // M2.0 Pass 14 (2026-05-13): annual-only basis. transformAnnualSeries
  // is now identity; quarterly + monthly distribution branches deleted
  // until M5 Financial Statements reintroduces them scoped to FS.
  const transformAnnualSeries = (annual: number[]): number[] => [...annual];
  // P11 Fix 16 (2026-05-13): periodTable + periodTotals builders
  // removed - they fed only the now-deleted Project Total footer.
  // Per-asset rows + closing subtotal still compute inline below.

  // Capex by Stage: rows = period (cap 24), cols = land/hard/soft/operating/total.
  // M2.0h Fix 6: stage rows distributed annually first, then split to
  // sub-periods per granularity.
  // 2026-08-16: `marketing` runs through this block alongside the others. These
  // literals are INFERRED, not typed as Record<CostStage, number>, so the
  // compiler does not force the new stage in; leaving it out would have dropped
  // marketing from the by-stage table and from its Total column silently.
  const annualStageRows: Array<{ land: number; hard: number; soft: number; marketing: number; operating: number }> = [];
  for (let i = 0; i < annualPeriodCount; i++) {
    let land = 0, hard = 0, soft = 0, marketing = 0, operating = 0;
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
        marketing += bd.byStage.marketing * share;
        operating += bd.byStage.operating * share;
      }
    }
    annualStageRows.push({ land, hard, soft, marketing, operating });
  }
  const landSeries = transformAnnualSeries(annualStageRows.map((r) => r.land));
  const hardSeries = transformAnnualSeries(annualStageRows.map((r) => r.hard));
  const softSeries = transformAnnualSeries(annualStageRows.map((r) => r.soft));
  const marketingSeries = transformAnnualSeries(annualStageRows.map((r) => r.marketing));
  const operatingSeries = transformAnnualSeries(annualStageRows.map((r) => r.operating));
  const stageTable = periodLabels.map((p, idx) => ({
    period: p,
    land: landSeries[idx] ?? 0,
    hard: hardSeries[idx] ?? 0,
    soft: softSeries[idx] ?? 0,
    marketing: marketingSeries[idx] ?? 0,
    operating: operatingSeries[idx] ?? 0,
    total: (landSeries[idx] ?? 0) + (hardSeries[idx] ?? 0) + (softSeries[idx] ?? 0)
      + (marketingSeries[idx] ?? 0) + (operatingSeries[idx] ?? 0),
  }));
  const stageTotals = stageTable.reduce(
    (acc, r) => ({
      land: acc.land + r.land,
      hard: acc.hard + r.hard,
      soft: acc.soft + r.soft,
      marketing: acc.marketing + r.marketing,
      operating: acc.operating + r.operating,
      total: acc.total + r.total,
    }),
    { land: 0, hard: 0, soft: 0, marketing: 0, operating: 0, total: 0 },
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
  // Header cells route through the shared CELL_HEADER token so every
  // Results table gets the universal centered alignment (label + number
  // columns alike). headStyle / headLeftStyle aliases retained for
  // back-compat with existing call sites + below; both resolve to the
  // same centered CELL_HEADER now.
  const headStyle: React.CSSProperties = CELL_HEADER;
  const headLeftStyle: React.CSSProperties = CELL_HEADER;

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
        <strong style={TABLE_TITLE} data-testid="capex-table-1-title">Table 1 - Construction Cost Schedule by Period (per cost line, per asset)</strong>
        <div style={{ overflowX: 'auto' }}>
          <table style={periodTableStyle(1 + periodAxis.count)}>
            <colgroup>
              <col style={{ width: COLUMN_WIDTHS.label }} />
              <col style={{ width: nonLabelPct }} />
              {periodAxis.labels.map((_, i) => (<col key={i} style={{ width: nonLabelPct }} />))}
            </colgroup>
            <thead>
              <tr>
                <th style={headLeftStyle}>Asset / Cost Line</th>
                <th style={headStyle}>Total</th>
                {periodAxis.labels.map((p, i) => (<th key={i} style={headStyle}>{p}</th>))}
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
                  // The Y0 upfront lump (land cash, land in kind, RETT).
                  //
                  // 2026-08-17: placed by the SHARED rule. The guard here used
                  // to be `offset > 0`, which dropped a PHASE 1 lump into no
                  // column at all while the financing engine placed it at index
                  // 0, so this table showed a land total with every period
                  // column blank and did not foot. Measured on a live project:
                  // 70,000,000 of phase 1 land, in the model and in the total
                  // column and in none of the periods beside it.
                  const upfrontCol = phaseLocalToProjectIndex(0, offset);
                  if (upfrontCol >= 0 && upfrontCol < annualPeriodCount) {
                    assetRowAnnual[upfrontCol] += bd.perPeriod[0] ?? 0;
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
                // Universal formatting (Tab 3 Costs Results, 2026-05-13).
                // Combined view: Asset Heading row (no fill, bold) ->
                // per-line nested data rows (no fill, regular) -> closing
                // Subtotal row (no fill, bold, top-border in header blue).
                // A final Project Total grand-total row is appended OUTSIDE
                // this map (header-blue fill, white bold). Single Asset
                // view: per-line rows + a single closing Grand Total row
                // labelled "Total" (no asset heading, no subtotal label).
                return (
                  <React.Fragment key={a.id}>
                    {resultsView === 'combined' && (
                      <tr data-testid={`capex-period-asset-${a.id}`}>
                        <td
                          style={{ ...ROW_ASSET_HEADING.name, padding: '6px 6px' }}
                          colSpan={2 + periodAxis.count}
                          data-testid={`capex-period-asset-${a.id}-header`}
                        >
                          {a.name}
                        </td>
                      </tr>
                    )}
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
                        // Upfront perPeriod[0], by the shared rule. "Phase 2+
                        // only" was the defect: see the asset row above.
                        const upfrontCol2 = phaseLocalToProjectIndex(0, offset2);
                        if (upfrontCol2 >= 0 && upfrontCol2 < annualPeriodCount) {
                          linePerPeriodAnnual[upfrontCol2] += linePP[0] ?? 0;
                        }
                      }
                      if (lineTotal === 0) return null;
                      const linePerPeriod = transformAnnualSeries(linePerPeriodAnnual);
                      return (
                        <tr key={`${a.id}-${line.id}`} data-testid={`capex-period-line-${a.id}-${line.id}`}>
                          <td style={{ ...ROW_DATA.name, paddingLeft: 24, color: 'var(--color-meta)' }}>{line.name}</td>
                          <td style={ROW_DATA.num}>{fmt(lineTotal)}</td>
                          <td style={ROW_DATA.num} data-testid={`capex-period-line-${a.id}-${line.id}-prior`}>{fmt(PRIOR_ZERO)}</td>
                          {cropRow(linePerPeriod).map((v, i) => (<td key={i} style={ROW_DATA.num}>{fmt(v)}</td>))}
                        </tr>
                      );
                    })}
                    {resultsView === 'combined' ? (
                      <tr data-testid={`capex-period-asset-${a.id}-subtotal`}>
                        <td style={ROW_SUBTOTAL.name}>
                          Subtotal - {a.name}
                        </td>
                        <td style={ROW_SUBTOTAL.num} data-testid={`capex-period-asset-${a.id}-total`}>{fmt(assetTotal)}</td>
                        <td style={ROW_SUBTOTAL.num} data-testid={`capex-period-${a.id}-prior`}>{fmt(PRIOR_ZERO)}</td>
                        {cropRow(assetRow).map((v, i) => (<td key={i} style={ROW_SUBTOTAL.num} data-testid={`capex-period-${a.id}-${i + 1}`}>{fmt(v)}</td>))}
                      </tr>
                    ) : (
                      <tr data-testid={`capex-period-asset-${a.id}-subtotal`}>
                        <td style={ROW_GRAND_TOTAL.name}>
                          Total
                        </td>
                        <td style={ROW_GRAND_TOTAL.num} data-testid={`capex-period-asset-${a.id}-total`}>{fmt(assetTotal)}</td>
                        <td style={ROW_GRAND_TOTAL.num} data-testid={`capex-period-${a.id}-prior`}>{fmt(PRIOR_ZERO)}</td>
                        {cropRow(assetRow).map((v, i) => (<td key={i} style={ROW_GRAND_TOTAL.num} data-testid={`capex-period-${a.id}-${i + 1}`}>{fmt(v)}</td>))}
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {resultsView === 'combined' && (() => {
                // Project Total grand-total row: sum every visible asset's
                // assetTotal + annual row using the SAME phase-offset
                // alignment as the per-asset builder above. Re-run the
                // accumulation here so we don't have to thread state out
                // of the per-asset map.
                const projectStartYear = new Date(project.startDate).getUTCFullYear();
                const grandAnnual = new Array<number>(annualPeriodCount).fill(0);
                let grandTotal = 0;
                for (const a of phaseAssets) {
                  for (const pb of perPhaseBreakdowns) {
                    const bd = pb.assetTotals[a.id];
                    if (!bd) continue;
                    grandTotal += bd.total;
                    const phaseObj = phases.find((p) => p.id === pb.phaseId);
                    const phaseStartIso = phaseObj?.startDate && phaseObj.startDate.length === 10
                      ? phaseObj.startDate
                      : project.startDate;
                    const phaseStartYear = new Date(phaseStartIso).getUTCFullYear();
                    const offset = Number.isFinite(phaseStartYear - projectStartYear)
                      ? Math.max(0, phaseStartYear - projectStartYear)
                      : 0;
                    for (let i = 1; i < bd.perPeriod.length; i++) {
                      const v = bd.perPeriod[i] ?? 0;
                      if (v === 0) continue;
                      const dest = offset + i - 1;
                      if (dest >= 0 && dest < annualPeriodCount) {
                        grandAnnual[dest] += v;
                      }
                    }
                    // The Y0 upfront lump, by the shared rule.
                    const grandUpfrontCol = phaseLocalToProjectIndex(0, offset);
                    if (grandUpfrontCol >= 0 && grandUpfrontCol < annualPeriodCount) {
                      grandAnnual[grandUpfrontCol] += bd.perPeriod[0] ?? 0;
                    }
                  }
                }
                if (grandTotal === 0) return null;
                const grandRow = transformAnnualSeries(grandAnnual);
                return (
                  <tr data-testid="capex-period-project-total">
                    <td style={ROW_GRAND_TOTAL.name}>Project Total</td>
                    <td style={ROW_GRAND_TOTAL.num} data-testid="capex-period-project-total-amount">{fmt(grandTotal)}</td>
                    <td style={ROW_GRAND_TOTAL.num} data-testid="capex-period-project-total-prior">{fmt(PRIOR_ZERO)}</td>
                    {cropRow(grandRow).map((v, i) => (<td key={i} style={ROW_GRAND_TOTAL.num} data-testid={`capex-period-project-total-${i + 1}`}>{fmt(v)}</td>))}
                  </tr>
                );
              })()}
            </tbody>
            {/* Tab 3 Costs Results formatting (2026-05-13): the in-tbody
                Project Total grand-total row above replaces the older
                <tfoot> Project Total. Combined view shows it; Single
                Asset view drops it (one asset's "Total" row stands in). */}
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
            // Upfront perPeriod[0], by the shared rule.
            //
            // 2026-08-17: this one also accumulated `total` INSIDE the dropped
            // branch, so a phase-1 Y0 lump was missing from the row TOTAL as
            // well as from every column. The table was not merely displaying
            // the money in the wrong place, it was reporting a smaller number.
            const stageUpfrontCol = phaseLocalToProjectIndex(0, offset);
            if (stageUpfrontCol >= 0 && stageUpfrontCol < annualPeriodCount) {
              const tot = bd.perPeriod[0] ?? 0;
              const landAll = bd.perPeriodLandTotal[0] ?? 0;
              const landInKind = bd.perPeriodLandInKind[0] ?? 0;
              const v =
                mode === 'exclAll' ? tot - landAll
                : mode === 'exclInKind' ? tot - landInKind
                : tot;
              annualRow[stageUpfrontCol] += v;
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
          // Universal formatting (2026-05-13): asset rows render as plain
          // data (no "Subtotal - " prefix, no fill, regular weight) and a
          // closing Grand Total row sums every visible asset.
          const grandTotalAmount = rows.reduce((s, r) => s + r.total, 0);
          const grandTotalRow = new Array<number>(croppedPeriodCount).fill(0);
          for (const r of rows) {
            const cropped = cropRow(r.row);
            for (let i = 0; i < croppedPeriodCount; i++) {
              grandTotalRow[i] += cropped[i] ?? 0;
            }
          }
          return (
            <div style={sectionCardStyle} data-testid={`capex-summary-${testidKey}`}>
              <h3 style={{ ...TABLE_TITLE, margin: 0 }}>{title}</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 11 }}>
                  <colgroup>
                    <col style={{ width: COLUMN_WIDTHS.label }} />
                    <col style={{ width: nonLabelPct }} />
                    {periodAxis.labels.map((_, i) => (<col key={i} style={{ width: nonLabelPct }} />))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={headLeftStyle}>Asset</th>
                      <th style={headStyle}>Total</th>
                      {periodAxis.labels.map((p, i) => (<th key={i} style={headStyle}>{p}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td style={ROW_DATA.name} colSpan={2 + periodAxis.count}>No non-zero values for this view.</td></tr>
                    ) : (
                      <>
                        {rows.map((r) => (
                          <tr key={r.asset.id} data-testid={`capex-summary-${testidKey}-${r.asset.id}`}>
                            <td style={ROW_DATA.name}>{r.asset.name}</td>
                            <td style={ROW_DATA.num} data-testid={`capex-summary-${testidKey}-${r.asset.id}-total`}>{fmt(r.total)}</td>
                            <td style={ROW_DATA.num} data-testid={`capex-summary-${testidKey}-${r.asset.id}-prior`}>{fmt(PRIOR_ZERO)}</td>
                            {cropRow(r.row).map((v, i) => (<td key={i} style={ROW_DATA.num}>{fmt(v)}</td>))}
                          </tr>
                        ))}
                        <tr data-testid={`capex-summary-${testidKey}-grand-total`}>
                          <td style={ROW_GRAND_TOTAL.name}>Total</td>
                          <td style={ROW_GRAND_TOTAL.num} data-testid={`capex-summary-${testidKey}-grand-total-amount`}>{fmt(grandTotalAmount)}</td>
                          <td style={ROW_GRAND_TOTAL.num} data-testid={`capex-summary-${testidKey}-grand-total-prior`}>{fmt(PRIOR_ZERO)}</td>
                          {grandTotalRow.map((v, i) => (<td key={i} style={ROW_GRAND_TOTAL.num}>{fmt(v)}</td>))}
                        </tr>
                      </>
                    )}
                  </tbody>
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
                                <AccountingNumberInput
                                  min={0}
                                  value={effValue}
                                  onChange={(n) => writeOverrideValue(n)}
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
  const insertCostLineNear = useModule1Store((s) => s.insertCostLineNear);
  const moveCostLine = useModule1Store((s) => s.moveCostLine);
  const updateCostLine = useModule1Store((s) => s.updateCostLine);
  // 2026-08-15: writes Asset.capexPhasing from the one-curve control.
  const updateAsset = useModule1Store((s) => s.updateAsset);
  const removeCostLine = useModule1Store((s) => s.removeCostLine);
  const restoreCostLine = useModule1Store((s) => s.restoreCostLine);
  const setCostLines = useModule1Store((s) => s.setCostLines);
  const setCostOverride = useModule1Store((s) => s.setCostOverride);
  const removeCostOverride = useModule1Store((s) => s.removeCostOverride);

  // ── The shared cost catalog (2026-08-17) ───────────────────────────────
  //
  // Built-ins come from code, so the picker is populated before any network
  // call and stays populated if the call fails or the table is not there yet
  // (a deploy landing before migration 214). The user's own entries are a layer
  // on top. Nothing here is on a calculation path: an entry stamps its method,
  // stage and phasing source onto the LINE, and the engine reads the line.
  const [userCatalog, setUserCatalog] = useState<UserCostCatalogEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/refm/cost-catalog');
        if (!res.ok) return;
        const body = await res.json() as { entries?: UserCostCatalogEntry[] };
        if (!cancelled && Array.isArray(body.entries)) setUserCatalog(body.entries);
      } catch { /* built-ins are enough */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const catalogEntries = useMemo(() => mergeCatalog(userCatalog), [userCatalog]);
  const addCatalogEntry = async (draft: { label: string; method: CostMethod; stage: CostStage; phasingSource: CapexPhasingSource }): Promise<void> => {
    const res = await fetch('/api/refm/cost-catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const body = await res.json() as { entry?: UserCostCatalogEntry; error?: string };
    if (!res.ok || !body.entry) throw new Error(body.error ?? 'Could not save the entry.');
    setUserCatalog((prev) => [...prev.filter((e) => e.id !== body.entry!.id), body.entry!]);
  };

  // ── Undo for a deleted cost line (2026-08-17) ──────────────────────────
  // Deleting was immediate and irreversible, behind a confirm dialog that a
  // user learns to dismiss. The line, its position and its per-asset overrides
  // are held here until the next delete, so Undo restores the row exactly where
  // it was, which matters because position decides what a percentage may
  // charge on.
  const [undoBuffer, setUndoBuffer] = useState<{ line: CostLine; index: number; overrides: CostOverride[] } | null>(null);

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
  const [copyRemoveExtra, setCopyRemoveExtra] = useState<boolean>(false);
  const [copyResult, setCopyResult] = useState<
    { targets: number; lines: number; created: number; removed: number; skipped: number } | null
  >(null);
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
  // M2.0 Pass 14 (2026-05-13): annual-only basis until M5 Financial
  // Statements introduces a granularity toggle scoped to FS output.
  // project.outputGranularity is @deprecated; everything renders annual.
  const granularity: OutputGranularity = 'annual';
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

  // Per-phase pre-compute (one breakdown per (phase, asset)).
  // M2.0 Pass 14 (2026-05-13): parcel funding config threaded into
  // computeAssetCost so deferred-payment parcels spread Land Cash
  // across their configured periods. Read straight off project.financing
  // (same path Tab 4 uses); legacy projects without financing get
  // undefined and the engine takes its no-deferred fallback.
  const parcelFunding = project.financing?.parcelFunding;
  // 2026-08-16: the sell-results snapshot, so a cost line that follows
  // collections phases here exactly as it does in the model.
  //
  // This screen computes it rather than receiving it, matching what every other
  // module screen does (Module1Financing, both Module 2 screens, all of Module
  // 4 and 5, Module 7 and Overview each run their own). A parent-provided
  // snapshot would be better, but it is a shell change across ten screens and
  // belongs in its own pass; doing it here alone would leave this the single
  // screen fed from above while its own sibling tab computes its own.
  //
  // Note this is the LIGHT revenue engine, not computeFinancialsSnapshot: it
  // takes no cost input, so there is no circularity and no second cost pass.
  const sellSnap = useMemo(
    () => computeAllSellResults({ project, phases, assets, subUnits }),
    [project, phases, assets, subUnits],
  );
  const projectStartYearForCollections = sellSnap.yearLabels[0] ?? 0;
  const perPhaseBreakdowns = useMemo(() => {
    return phases.map((phase) => {
      const phaseAssets = assets.filter((a) => a.phaseId === phase.id && a.visible);
      const assetTotals: Record<string, AssetCostBreakdown> = {};
      for (const a of phaseAssets) {
        assetTotals[a.id] = computeAssetCost({
          asset: a, project, phase, parcels, assets, subUnits, costLines, costOverrides,
          landAllocationMode, parcelFunding,
          collectionsPerPeriod: collectionsForAsset(sellSnap, a.id, phase, projectStartYearForCollections),
          collectionsTotal: collectionsTotalForAsset(sellSnap, a.id),
        });
      }
      return { phaseId: phase.id, phaseName: phase.name, cp: phase.constructionPeriods, phaseAssets, assetTotals };
    });
  }, [phases, assets, project, parcels, subUnits, costLines, costOverrides, landAllocationMode, parcelFunding,
      sellSnap, projectStartYearForCollections]);

  const allVisibleAssets = useMemo(() => assets.filter((a) => a.visible), [assets]);

  // Stage totals across project (for top tile bar)
  const stageTotals = useMemo(() => {
    // Inferred literal, so the compiler does not force `marketing` in. Missing
    // it would leave the tile bar silently short of the marketing spend.
    // `landInKind` is not a stage: it is the in-kind SLICE of the land stage,
    // taken from the engine's own per-period series so the two total tiles
    // below use exactly the figures the Capex summary tables use.
    const acc = { land: 0, hard: 0, soft: 0, marketing: 0, operating: 0, landInKind: 0 };
    for (const pb of perPhaseBreakdowns) {
      for (const a of pb.phaseAssets) {
        const bd = pb.assetTotals[a.id];
        if (!bd) continue;
        acc.land += bd.byStage.land;
        acc.hard += bd.byStage.hard;
        acc.soft += bd.byStage.soft;
        acc.marketing += bd.byStage.marketing;
        acc.operating += bd.byStage.operating;
        acc.landInKind += (bd.perPeriodLandInKind ?? []).reduce((s, v) => s + (v ?? 0), 0);
      }
    }
    return acc;
  }, [perPhaseBreakdowns]);

  /**
   * The two project-level totals (2026-08-17).
   *
   * Derived from COST_STAGES rather than a hand-written sum, so a stage added
   * later cannot be silently left out of the headline figure. These are the
   * same two measures the Capex summary tables already report as "Incl All
   * Land" and "Excl Land In-Kind"; the tiles put them where the user looks
   * first instead of at the bottom of the Results sub-tab.
   */
  const totalInclLand = COST_STAGES.reduce((s, k) => s + (stageTotals[k] ?? 0), 0);
  const totalExclInKindLand = totalInclLand - stageTotals.landInKind;

  // projectTotal (sum of stage totals) was consumed by the now-removed
  // standalone Project Total bar; the in-table Grand Total rows on Tables
  // 1-4 own this rollup now.

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
  // construction end + 1 year buffer.
  // M2.0 Pass 14 (2026-05-13): project duration = max construction +
  // operating periods across all phases. Floor for the data-driven
  // axis so brand-new projects without cost-line data still render the
  // full project horizon. No hard cap.
  const projectStartYear = new Date(project.startDate).getUTCFullYear();
  const totalConstructionPeriods = phases.reduce((max, p) => {
    const phaseStartIso = p.startDate && p.startDate.length === 10 ? p.startDate : project.startDate;
    const phaseStartYear = new Date(phaseStartIso).getUTCFullYear();
    const offset = Number.isFinite(phaseStartYear - projectStartYear)
      ? Math.max(0, phaseStartYear - projectStartYear)
      : 0;
    const phaseDuration =
      p.constructionPeriods + p.operationsPeriods - p.overlapPeriods;
    return Math.max(max, offset + phaseDuration);
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

  /**
   * Country-gated lines that carry a rate and are NOT being charged (2026-08-17).
   *
   * The gate now stops the money as well as the row, which is the fix for a
   * doubled RETT. That closes a silent overcharge and opens the mirror image: a
   * rate typed while the country matched, still stored, now contributing
   * nothing, with the row invisible. So the tab says it out loud rather than
   * leaving the user to wonder where their transfer tax went.
   */
  // A plain filter, not a useMemo: this sits after an early return in the
  // component, where every other hook in the file is already flagged as
  // conditionally called. A cheap array scan does not need to add a sixth.
  const gatedWithRate = costLines.filter(
    (c) => !!c.requiresCountry
      && c.requiresCountry !== project.country
      && Math.abs(c.value) > 0
      && c.disabled !== true,
  );

  return (
    <div data-testid="module1-costs">
      {gatedWithRate.length > 0 && (
        <div
          data-testid="costs-country-gated-notice"
          style={{
            padding: 'var(--sp-1) var(--sp-2)', marginBottom: 'var(--sp-2)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-accent-warm)',
            background: 'color-mix(in srgb, var(--color-accent-warm) 10%, transparent)',
            fontSize: 12, lineHeight: 1.4,
          }}
        >
          <strong>
            {gatedWithRate.length === 1 ? '1 cost line carries a rate but does not apply here' : `${gatedWithRate.length} cost lines carry a rate but do not apply here`}
            :
          </strong>{' '}
          {gatedWithRate.map((c) => `${c.name} (${c.value}%, ${c.requiresCountry})`).join('; ')}.
          {' '}The project country is{' '}
          <strong>{project.country ? project.country : 'not set'}</strong>, so {gatedWithRate.length === 1 ? 'it is' : 'they are'} not charged and {gatedWithRate.length === 1 ? 'its row is' : 'their rows are'} hidden.
          {' '}Set the country in Project &amp; Phases to use {gatedWithRate.length === 1 ? 'it' : 'them'}.
        </div>
      )}
      {/* Undo for a deleted cost line. Deleting used to be immediate and
          irreversible behind a confirm dialog; this restores the row AT ITS
          INDEX, with its per-asset overrides, because position decides what a
          percentage may charge on. */}
      {undoBuffer && (
        <div
          data-testid="costs-undo-banner"
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap',
            padding: 'var(--sp-1) var(--sp-2)', marginBottom: 'var(--sp-2)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-accent-warm)',
            background: 'color-mix(in srgb, var(--color-accent-warm) 10%, transparent)',
            fontSize: 12,
          }}
        >
          <span>
            Removed <strong>{undoBuffer.line.name}</strong>
            {undoBuffer.overrides.length > 0
              ? ` and ${undoBuffer.overrides.length} per-asset override${undoBuffer.overrides.length === 1 ? '' : 's'}`
              : ''}.
          </span>
          <button
            type="button"
            data-testid="costs-undo-restore"
            onClick={() => {
              restoreCostLine(undoBuffer.line, undoBuffer.index, undoBuffer.overrides);
              setUndoBuffer(null);
            }}
            style={{
              fontSize: 11, padding: '4px 12px', fontWeight: 700,
              background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)',
              border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            }}
          >
            Undo
          </button>
          <button
            type="button"
            data-testid="costs-undo-dismiss"
            onClick={() => setUndoBuffer(null)}
            style={{ fontSize: 11, padding: '4px 10px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
          >
            Dismiss
          </button>
        </div>
      )}
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
            {/* Pass 41 (2026-05-14): Operating stage hidden from filter
                + tile bar. Engine still buckets to it for any cost line
                that resolves to operating, but it's surfaced via the
                Total Capex Excl. Land tile rather than its own pill. */}
            {COST_STAGES.filter((s) => s !== 'operating').map((s) => (
              <option key={s} value={s}>{COST_STAGE_LABELS[s]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Stage summary tile bar.
          Pass 41 (2026-05-14): four tiles - Land / Hard / Soft / Total
          Capex Excl. Land. Operating dropped per user feedback (rarely
          used and adds visual noise); Total Excl. Land = Hard + Soft +
          Operating, the figure most decks want for "construction-cost
          investment net of land".

          2026-08-16: the tile list is DERIVED, and marketing joins it when it
          carries spend. The list was `['land','hard','soft']`, so when the
          Construction Cost Excl. Land tile was narrowed to exclude marketing,
          marketing appeared in NO tile at all: the narrowing was justified on
          the basis that marketing had its own tile, and it did not. Operating
          stays out by the original decision, and marketing follows the same
          rule as any other optional stage: shown only when non-zero, so a
          project that does not use it keeps the four-tile bar. */}
      {(() => {
        // Headline stages always show, so the bar does not collapse on an empty
        // project. EVERY OTHER stage shows when it carries spend, which is the
        // safe default for a stage added later: it appears the moment it is
        // used rather than being silently absent. Written as a disjunction
        // rather than a list so there is no second stage roster to keep in step.
        const isHeadline = (s: CostStage): boolean => s === 'land' || s === 'hard' || s === 'soft';
        const shown = COST_STAGES.filter((s) => isHeadline(s) || Math.abs(stageTotals[s]) > 0.005);
        return (
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${shown.length + 3}, 1fr)`, gap: 'var(--sp-1)', marginBottom: 'var(--sp-2)' }} data-testid="costs-summary-tiles">
        {shown.map((s) => (
          <div key={s} style={{ ...sectionCardStyle, marginBottom: 0, padding: 12 }} data-testid={`costs-stage-${s}-card`}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>
              {COST_STAGE_LABELS[s]}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
              {formatAccounting(stageTotals[s], scale, decimals)}
            </div>
          </div>
        ))}
        <div
          style={{
            ...sectionCardStyle,
            marginBottom: 0,
            padding: 12,
            borderLeft: '3px solid var(--color-navy)',
          }}
          data-testid="costs-stage-total-excl-land-card"
        >
          {/* 2026-08-16: renamed and narrowed. This is CONSTRUCTION cost, and
              it excludes marketing as well as land, which is the total a
              reference budget reports. Marketing gets its own tile above
              whenever it carries spend, so the tiles plus land reconcile to
              total capex and nothing is hidden. */}
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>
            Construction Cost Excl. Land
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }} data-testid="costs-construction-excl-land">
            {formatAccounting(stageTotals.hard + stageTotals.soft + stageTotals.operating, scale, decimals)}
          </div>
          <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2 }}>
            excludes marketing
          </div>
        </div>
        {/* ── The two project totals (2026-08-17) ────────────────────────
            The tiles above are stages and a construction subtotal, so the
            figure a reader actually quotes, what the project costs, was not
            on the tile bar at all. Both are derived from COST_STAGES, and
            both match the Capex summary tables ("Incl All Land" and "Excl
            Land In-Kind") exactly, so the tile bar and the schedule cannot
            report different totals. */}
        <div
          style={{ ...sectionCardStyle, marginBottom: 0, padding: 12, borderLeft: '3px solid var(--color-navy)' }}
          data-testid="costs-total-excl-inkind-card"
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>
            Total Project Cost Excl. In-Kind Land
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }} data-testid="costs-total-excl-inkind">
            {formatAccounting(totalExclInKindLand, scale, decimals)}
          </div>
          <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2 }}>
            the cash cost of the project
          </div>
        </div>
        <div
          style={{
            ...sectionCardStyle,
            marginBottom: 0,
            padding: 12,
            borderLeft: '3px solid var(--color-navy)',
            background: 'color-mix(in srgb, var(--color-navy) 6%, transparent)',
          }}
          data-testid="costs-total-incl-land-card"
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>
            Total Project Cost Incl. Land
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }} data-testid="costs-total-incl-land">
            {formatAccounting(totalInclLand, scale, decimals)}
          </div>
          <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 2 }}>
            every stage, land included
          </div>
        </div>
      </div>
        );
      })()}

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
                EVERY phase except the active one.

                2026-08-17: cross-phase apply RECONCILES THE LINE SET rather
                than matching by name. It used to write per-asset overrides
                only, matching a target line whose display name was identical,
                and `continue` past anything with no match. So a renamed line,
                an added line and a deletion never crossed a phase boundary and
                nothing said so: the target phase kept the seeded catalog while
                the panel reported success. Matching is now by CATALOG IDENTITY,
                a missing line is CREATED, and the counts are stated.

                COST LINES ARE PER PHASE, NOT PER ASSET, so making a target's
                phase match the source's changes that phase for every asset in
                it. The confirm dialog says so, and removing lines the source
                does not have is opt-in. */}
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
                        pick a source asset + one or more targets. Reproduces the source asset&apos;s cost lines in the target&apos;s phase (matched by catalog entry, not by name) and copies method, value, window and phasing per line.
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
                  {/* What the copy actually did. The old panel closed silently
                      whether it had matched every line or none of them. */}
                  {copyResult && (
                    <div
                      data-testid="costs-copy-panel-result"
                      style={{
                        marginTop: 6, padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                        background: copyResult.skipped > 0
                          ? 'color-mix(in srgb, var(--color-accent-warm) 12%, transparent)'
                          : 'color-mix(in srgb, var(--color-success) 12%, transparent)',
                        fontSize: 11, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                      }}
                    >
                      <span>
                        Copied {copyResult.lines} line{copyResult.lines === 1 ? '' : 's'} to {copyResult.targets} asset{copyResult.targets === 1 ? '' : 's'}
                        {copyResult.created > 0 ? `, added ${copyResult.created} missing line${copyResult.created === 1 ? '' : 's'}` : ''}
                        {copyResult.removed > 0 ? `, removed ${copyResult.removed}` : ''}
                        {copyResult.skipped > 0 ? `, skipped ${copyResult.skipped} with no counterpart` : ''}.
                      </span>
                      <button
                        type="button" onClick={() => setCopyResult(null)}
                        data-testid="costs-copy-panel-result-dismiss"
                        style={{ fontSize: 10, padding: '2px 8px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
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
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--sp-1)', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                        {/* Removing lines from the target's PHASE affects every
                            asset in that phase, so it is never the default. */}
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={copyRemoveExtra}
                            onChange={(e) => setCopyRemoveExtra(e.target.checked)}
                            data-testid="costs-copy-panel-remove-extra"
                          />
                          Also remove lines the source does not have
                          <span style={{ color: 'var(--color-meta)' }}>(affects every asset in the target phase)</span>
                        </label>
                        <button
                          type="button"
                          disabled={selectedCount === 0}
                          onClick={() => {
                            if (selectedCount === 0) return;
                            const targetIds = Array.from(copyTargetIds);
                            const targets = peerAssets.filter((a) => copyTargetIds.has(a.id));
                            const targetNames = targets.map((a) => a.name).join(', ');
                            // ── The plan is PURE and lives in costCopyPlan.ts ──
                            // It used to be written out here, inside this click
                            // handler, which is why "copy reproduces the line
                            // set" could be asserted by grepping source strings
                            // while the live project still did not do it.
                            const plan = planCostCopy({
                              costLines,
                              sourcePhaseId: sourceAsset.phaseId,
                              sourceAssetId: sourceAsset.id,
                              targetPhaseIds: targets.map((a) => a.phaseId),
                              country: project.country,
                              removeExtra: copyRemoveExtra,
                            });
                            const crossPhaseCount = plan.phases.length;
                            const phaseNote = crossPhaseCount === 0 ? '' : [
                              '',
                              `${plan.created} line${plan.created === 1 ? '' : 's'} will be ADDED to ${crossPhaseCount} other phase${crossPhaseCount === 1 ? '' : 's'} so their cost lines match this asset's.`,
                              plan.phases.reduce((s, p) => s + p.extra.length, 0) > 0
                                ? (copyRemoveExtra
                                    ? `${plan.removed} line${plan.removed === 1 ? '' : 's'} that ${sourceAsset.name} does not have will be REMOVED from those phases.`
                                    : `${plan.phases.reduce((s, p) => s + p.extra.length, 0)} line${plan.phases.reduce((s, p) => s + p.extra.length, 0) === 1 ? '' : 's'} that ${sourceAsset.name} does not have will be LEFT IN PLACE.`)
                                : '',
                              'Cost lines belong to a phase, so this changes those phases for every asset in them, not only the targets.',
                            ].filter(Boolean).join('\n');
                            const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
                              ? window.confirm(
                                  `Copy ${sourceAsset.name}'s cost configuration (${plan.sourceLines.length} line${plan.sourceLines.length === 1 ? '' : 's'}) to ${targetIds.length} asset${targetIds.length === 1 ? '' : 's'}: ${targetNames}?\n\nExisting per-asset overrides on the targets will be overwritten.${phaseNote}`,
                                )
                              : true;
                            if (!ok) return;
                            // ONE write for the whole reconciliation, so the
                            // array (whose ORDER decides what a percentage may
                            // charge on) is never briefly half-reconciled.
                            if (plan.created > 0 || plan.removed > 0) setCostLines(plan.nextCostLines);

                            let skipped = 0;
                            for (const line of plan.sourceLines) {
                              const sourceOv = costOverrides.find((o) =>
                                o.assetId === sourceAsset.id && o.lineId === line.id,
                              );
                              const sourceActive = sourceOv !== undefined && sourceOv.overridden !== false;
                              const effMethod       = sourceActive ? (sourceOv?.method      ?? line.method)      : line.method;
                              const effValue        = sourceActive ? (sourceOv?.value       ?? line.value)       : line.value;
                              const effPhasing      = sourceActive ? (sourceOv?.phasing     ?? line.phasing)     : line.phasing;
                              const effDistribution = sourceActive ? (sourceOv?.distribution ?? line.distribution) : line.distribution;
                              const effDisabled     = sourceActive
                                ? (sourceOv?.disabled === true || line.disabled === true)
                                : line.disabled === true;
                              const effPerSubUnit   = sourceActive ? (sourceOv?.perSubUnitRates ?? line.perSubUnitRates) : line.perSubUnitRates;
                              const effStartPeriod  = sourceActive ? (sourceOv?.startPeriod ?? line.startPeriod) : line.startPeriod;
                              const effEndPeriod    = sourceActive ? (sourceOv?.endPeriod   ?? line.endPeriod)   : line.endPeriod;
                              const makeOverride = (assetId: string, lineId: string): CostOverride => ({
                                assetId,
                                lineId,
                                method: effMethod,
                                value: effValue,
                                phasing: effPhasing,
                                distribution: effDistribution ? [...effDistribution] : undefined,
                                disabled: effDisabled ? true : undefined,
                                perSubUnitRates: effPerSubUnit ? { ...effPerSubUnit } : undefined,
                                startPeriod: effStartPeriod,
                                endPeriod: effEndPeriod,
                                overridden: true,
                              });
                              // Source first: isolates the source asset from
                              // master mutations by other assets' edits later.
                              setCostOverride(makeOverride(sourceAsset.id, line.id));
                              for (const target of targets) {
                                const targetLineId = target.phaseId === sourceAsset.phaseId
                                  ? line.id
                                  : plan.phases.find((p) => p.phaseId === target.phaseId)?.mapping.get(line.id);
                                if (!targetLineId) { skipped += 1; continue; }
                                setCostOverride(makeOverride(target.id, targetLineId));
                              }
                            }
                            setCopyResult({
                              targets: targetIds.length,
                              lines: plan.sourceLines.length,
                              created: plan.created,
                              removed: plan.removed,
                              skipped,
                            });
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

            {/* Phase navigator (2026-05-13): replaced the legacy
                <select> with a row of pill buttons that mirror the
                asset pill row below. Same state field
                (inputsPhaseFilter) and the same downstream filter
                logic; only the control type changes. */}
            <div style={{ ...sectionCardStyle, padding: 'var(--sp-1) var(--sp-2)' }} data-testid="costs-inputs-asset-nav">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-1)', flexWrap: 'wrap', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', flexWrap: 'wrap' }} data-testid="costs-inputs-phase-pills">
                  <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>Phase:</strong>
                  {phases.map((p) => {
                    const isActive = p.id === effectivePhaseId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setInputsPhaseFilter(p.id)}
                        style={pillStyle(isActive)}
                        data-testid={`costs-inputs-phase-pill-${p.id}`}
                      >
                        {p.name}
                      </button>
                    );
                  })}
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
                onUpdateAsset={(assetId, patch) => updateAsset(assetId, patch)}
                collectionsTotal={collectionsTotalForAsset(sellSnap, activeAsset.id)}
                onUpdateOverride={(override) => setCostOverride(override)}
                onRemoveOverride={(assetId, lineId) => removeCostOverride(assetId, lineId)}
                onRemoveLine={(lineId) => {
                  // 2026-08-17: no confirm dialog. The line, its index and its
                  // overrides are held so Undo puts it back exactly where it
                  // was; an undo that works beats a dialog you learn to dismiss.
                  const index = costLines.findIndex((c) => c.id === lineId);
                  const line = costLines[index];
                  if (!line) return;
                  setUndoBuffer({
                    line,
                    index,
                    overrides: costOverrides.filter((o) => o.lineId === lineId),
                  });
                  removeCostLine(lineId);
                }}
                catalogEntries={catalogEntries}
                onAddCatalogEntry={addCatalogEntry}
                onAddCustom={() => addCostLine(makeCustomCostLine(activeAsset.phaseId, assetPhase?.constructionPeriods ?? 1))}
                onInsertNear={(anchorLineId, position) => insertCostLineNear(
                  makeCustomCostLine(activeAsset.phaseId, assetPhase?.constructionPeriods ?? 1),
                  anchorLineId,
                  position,
                )}
                onMoveLine={(lineId, direction, neighbourId) => moveCostLine(lineId, direction, neighbourId)}
              />
            )}
          </>
        );
      })()}


      {subTab === 'results' && allVisibleAssets.length > 0 && (
        <>
          {/* M2.0 Pass 14 (2026-05-13): granularity toggle removed.
              Annual-only basis until M5 Financial Statements introduces
              a granularity toggle scoped to FS output. */}
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
                  resultsView={resultsView}
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

      {/* Standalone Project Total bar removed (Tab 3 results formatting,
          2026-05-13): the in-table Grand Total rows on Tables 1-4 now
          serve this role across both Combined and Single Asset views. */}

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
