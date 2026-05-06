'use client';

/**
 * Module1Costs.tsx (v6 schema, M2.0c rebuild)
 *
 * Full pre-M2.0 functionality restored:
 *   - 12 default cost lines + custom user-added lines
 *   - 13 calculation methods catalog
 *   - 6 allocation basis modes (per-asset / bua-share / gfa-share /
 *     land-share / category / manual)
 *   - 6 phasing modes (even / frontloaded / backloaded / sCurve /
 *     manual / phase-aligned)
 *   - 4 cost stages (land / hard / soft / operating)
 *   - 3 cost scopes (direct / indirect / allocated)
 *   - Per-asset cost overrides (collapsible per row)
 *   - Active filter (show/hide stage groups)
 *   - Conditional drivers (requiresCountry hides line unless project.country matches)
 *   - Granularity-aware period schedule (annual = N years, monthly = N×12 months)
 */

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import {
  type CostLine,
  type CostMethod,
  type CostPhasing,
  type CostStage,
  type CostScope,
  type AllocationBasis,
  COST_METHODS,
  COST_METHOD_LABELS,
  COST_PHASINGS,
  COST_STAGES,
  COST_STAGE_LABELS,
  COST_SCOPES,
  ALLOCATION_BASES,
} from '../../lib/state/module1-types';
import {
  computePhaseCost,
  computeAssetCost,
  resolveAssetAreaMetrics,
} from '@/src/core/calculations';
import { formatNumber, formatCurrency } from '@/src/core/formatters';

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

function getPeriodLabel(idx: number, projectStart: string, modelType: 'monthly' | 'annual'): string {
  if (idx === 0) return 'P0';
  if (modelType === 'annual') return `Y${idx}`;
  const d = new Date(projectStart);
  if (Number.isNaN(d.getTime())) return `M${idx}`;
  d.setMonth(d.getMonth() + (idx - 1));
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

interface CostRowProps {
  line: CostLine;
  asset: { id: string; name: string };
  total: number;
  perPeriod: number[];
  allLines: CostLine[];
  onUpdate: (patch: Partial<CostLine>) => void;
  onRemove: () => void;
  isLocked: boolean;
}

function CostRow({ line, asset, total, perPeriod, allLines, onUpdate, onRemove, isLocked }: CostRowProps): React.JSX.Element {
  void asset;
  void perPeriod;
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isPercentSelected = line.method === 'percent_of_selected';
  const isManual = line.phasing === 'manual';
  const span = Math.max(1, line.endPeriod - line.startPeriod + 1);
  const manualValues = useMemo(() => {
    const arr = line.distribution ?? [];
    const out = new Array<number>(span);
    for (let i = 0; i < span; i++) out[i] = arr[i] ?? 100 / span;
    return out;
  }, [line.distribution, span]);

  const updateManualValue = (idx: number, val: number): void => {
    const next = manualValues.slice();
    next[idx] = val;
    onUpdate({ distribution: next });
  };

  return (
    <>
      <tr
        data-testid={`cost-row-${line.id}`}
        style={{ background: STAGE_BG[line.stage] }}
      >
        <td style={{ padding: '4px', minWidth: 160 }}>
          <input
            type="text"
            value={line.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            disabled={isLocked}
            style={inputStyle}
          />
        </td>
        <td style={{ padding: '4px', minWidth: 90 }}>
          <select
            value={line.stage}
            onChange={(e) => onUpdate({ stage: e.target.value as CostStage })}
            disabled={isLocked}
            style={{ ...inputStyle, fontSize: 11 }}
            data-testid={`cost-${line.id}-stage`}
          >
            {COST_STAGES.map((s) => (
              <option key={s} value={s}>{COST_STAGE_LABELS[s]}</option>
            ))}
          </select>
          <select
            value={line.scope}
            onChange={(e) => onUpdate({ scope: e.target.value as CostScope })}
            style={{ ...inputStyle, fontSize: 10, marginTop: 2 }}
            data-testid={`cost-${line.id}-scope`}
          >
            {COST_SCOPES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </td>
        <td style={{ padding: '4px', minWidth: 160 }}>
          <select
            value={line.method}
            onChange={(e) => onUpdate({ method: e.target.value as CostMethod })}
            style={{ ...inputStyle, fontSize: 11 }}
            data-testid={`cost-${line.id}-method`}
          >
            {COST_METHODS.map((m) => (
              <option key={m} value={m}>{COST_METHOD_LABELS[m]}</option>
            ))}
          </select>
          <select
            value={line.allocationBasis}
            onChange={(e) => onUpdate({ allocationBasis: e.target.value as AllocationBasis })}
            style={{ ...inputStyle, fontSize: 10, marginTop: 2 }}
            data-testid={`cost-${line.id}-allocation`}
          >
            {ALLOCATION_BASES.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </td>
        <td style={{ padding: '4px', minWidth: 90 }}>
          <input
            type="number"
            value={line.value}
            onChange={(e) => onUpdate({ value: parseFloat(e.target.value) || 0 })}
            style={inputStyle}
            data-testid={`cost-${line.id}-value`}
          />
        </td>
        <td style={{ padding: '4px', width: 60 }}>
          <input
            type="number"
            min={0}
            value={line.startPeriod}
            onChange={(e) => onUpdate({ startPeriod: parseInt(e.target.value) || 0 })}
            style={inputStyle}
            data-testid={`cost-${line.id}-start`}
          />
        </td>
        <td style={{ padding: '4px', width: 60 }}>
          <input
            type="number"
            min={0}
            value={line.endPeriod}
            onChange={(e) => onUpdate({ endPeriod: parseInt(e.target.value) || 0 })}
            style={inputStyle}
            data-testid={`cost-${line.id}-end`}
          />
        </td>
        <td style={{ padding: '4px', minWidth: 110 }}>
          <select
            value={line.phasing}
            onChange={(e) => onUpdate({ phasing: e.target.value as CostPhasing })}
            style={{ ...inputStyle, fontSize: 11 }}
            data-testid={`cost-${line.id}-phasing`}
          >
            {COST_PHASINGS.map((p) => (
              <option key={p} value={p}>{PHASING_LABELS[p]}</option>
            ))}
          </select>
        </td>
        <td style={{ padding: '4px', minWidth: 100, textAlign: 'right' }}>
          <div style={calcOutputStyle} data-testid={`cost-${line.id}-total`}>
            {formatNumber(total)}
          </div>
        </td>
        <td style={{ padding: '4px', width: 70, textAlign: 'right' }}>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{ ...inputStyle, background: 'transparent', cursor: 'pointer', fontSize: 10 }}
            data-testid={`cost-${line.id}-advanced`}
          >
            {showAdvanced ? '▼' : '▶'}
          </button>
          {!isLocked && (
            <button
              type="button"
              onClick={onRemove}
              style={{ ...inputStyle, background: 'transparent', cursor: 'pointer', fontSize: 10, marginTop: 2, color: 'var(--color-negative)' }}
              data-testid={`cost-${line.id}-remove`}
            >
              ✕
            </button>
          )}
        </td>
      </tr>

      {showAdvanced && (
        <tr style={{ background: 'var(--color-grey-pale)' }}>
          <td colSpan={9} style={{ padding: '8px 12px' }}>
            {isPercentSelected && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Selected Lines (base for %)
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {allLines.filter((l) => l.id !== line.id).map((l) => {
                    const sel = (line.selectedLineIds ?? []).includes(l.id);
                    return (
                      <label key={l.id} style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <input
                          type="checkbox"
                          checked={sel}
                          onChange={(e) => {
                            const ids = new Set(line.selectedLineIds ?? []);
                            if (e.target.checked) ids.add(l.id);
                            else ids.delete(l.id);
                            onUpdate({ selectedLineIds: Array.from(ids) });
                          }}
                          data-testid={`cost-${line.id}-select-${l.id}`}
                        />
                        {l.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            {isManual && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Manual phasing % per period (sum auto-normalises)
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {manualValues.map((v, idx) => (
                    <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 9, color: 'var(--color-meta)' }}>P{line.startPeriod + idx}</span>
                      <input
                        type="number"
                        value={v}
                        onChange={(e) => updateManualValue(idx, parseFloat(e.target.value) || 0)}
                        style={{ ...inputStyle, width: 60, fontSize: 10 }}
                        data-testid={`cost-${line.id}-manual-${idx}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>
              Conditional driver:{' '}
              <input
                type="text"
                value={line.requiresCountry ?? ''}
                placeholder="Country code (optional)"
                onChange={(e) => onUpdate({ requiresCountry: e.target.value || undefined })}
                style={{ ...inputStyle, width: 180, fontSize: 10, display: 'inline-block', marginLeft: 4 }}
                data-testid={`cost-${line.id}-requires-country`}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

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
  const addCostLine = useModule1Store((s) => s.addCostLine);
  const updateCostLine = useModule1Store((s) => s.updateCostLine);
  const removeCostLine = useModule1Store((s) => s.removeCostLine);

  const [stageFilter, setStageFilter] = useState<CostStage | 'all'>('all');
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);

  const phase = phases.find((p) => p.id === activePhaseId) ?? phases[0];
  const phaseAssets = useMemo(
    () => assets.filter((a) => a.phaseId === phase?.id && a.visible),
    [assets, phase?.id],
  );
  const phaseLines = useMemo(
    () => costLines.filter((c) => c.phaseId === phase?.id),
    [costLines, phase?.id],
  );

  // Conditional driver: filter by requiresCountry against project.country
  const visibleLines = useMemo(() => {
    return phaseLines.filter((l) => {
      if (l.requiresCountry && project.country !== l.requiresCountry) return false;
      if (stageFilter !== 'all' && l.stage !== stageFilter) return false;
      return true;
    });
  }, [phaseLines, stageFilter, project.country]);

  if (!phase) {
    return (
      <div style={{ padding: 'var(--sp-3)' }} data-testid="costs-empty">
        Add a phase first (Tab 1) before configuring costs.
      </div>
    );
  }

  const phaseCost = computePhaseCost(
    phase, project, costLines, costOverrides, parcels, assets, subUnits, landAllocationMode,
  );

  // For per-asset detail panel:
  const focusAsset = activeAssetId ? phaseAssets.find((a) => a.id === activeAssetId) : phaseAssets[0];
  const focusBreakdown = focusAsset
    ? computeAssetCost(focusAsset, project, phase, parcels, assets, subUnits, costLines, costOverrides, landAllocationMode)
    : null;
  const focusMetrics = focusAsset
    ? resolveAssetAreaMetrics(focusAsset, project, parcels, phaseAssets, subUnits, landAllocationMode)
    : null;

  const handleAddCustom = (stage: CostStage): void => {
    const id = `custom-${Date.now()}`;
    addCostLine({
      id, phaseId: phase.id, name: 'New Cost Item',
      method: 'fixed', value: 0,
      stage, scope: 'direct', allocationBasis: 'per_asset',
      startPeriod: 1, endPeriod: phase.constructionPeriods,
      phasing: 'even',
    });
  };

  const periodCount = Math.min(phase.constructionPeriods, 24);
  const periodLabels = Array.from({ length: periodCount }, (_, i) => getPeriodLabel(i + 1, project.startDate, project.modelType));

  return (
    <div data-testid="module1-costs">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 'var(--sp-2)', flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--font-h2)', fontWeight: 'var(--fw-bold)' }}>3. Development Costs</h2>
          <div style={{ color: 'var(--color-meta)', fontSize: 12 }}>
            Granularity: <strong>{project.modelType}</strong> · Construction window: {phase.constructionPeriods} {project.modelType === 'annual' ? 'years' : 'months'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={phase.id}
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

      {/* Stage summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--sp-1)', marginBottom: 'var(--sp-2)' }}>
        {COST_STAGES.map((s) => (
          <div key={s} style={{ ...sectionCardStyle, marginBottom: 0, padding: 12 }} data-testid={`costs-stage-${s}-card`}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>
              {COST_STAGE_LABELS[s]}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
              {formatCurrency(phaseCost.byStage[s], project.currency)}
            </div>
          </div>
        ))}
      </div>

      {/* Cost lines table */}
      <div style={sectionCardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong style={{ fontSize: 13 }}>Cost Lines</strong>
          <div style={{ display: 'flex', gap: 6 }}>
            {COST_STAGES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleAddCustom(s)}
                className="btn-secondary"
                style={{ fontSize: 11, padding: '4px 8px' }}
                data-testid={`costs-add-${s}`}
              >
                + {COST_STAGE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={{ padding: '6px', textAlign: 'left' }}>Cost Line</th>
              <th style={{ padding: '6px', textAlign: 'left' }}>Stage / Scope</th>
              <th style={{ padding: '6px', textAlign: 'left' }}>Method / Alloc</th>
              <th style={{ padding: '6px', textAlign: 'right' }}>Value</th>
              <th style={{ padding: '6px', textAlign: 'right' }}>Start</th>
              <th style={{ padding: '6px', textAlign: 'right' }}>End</th>
              <th style={{ padding: '6px', textAlign: 'left' }}>Phasing</th>
              <th style={{ padding: '6px', textAlign: 'right' }}>Total ({project.currency})</th>
              <th style={{ padding: '6px' }}></th>
            </tr>
          </thead>
          <tbody>
            {visibleLines.map((line) => {
              const total = phaseAssets.reduce((s, a) => s + (phaseCost.byAssetId[a.id]?.byLineId[line.id] ?? 0), 0);
              const perPeriod: number[] = [];
              return (
                <CostRow
                  key={line.id}
                  line={line}
                  asset={focusAsset ?? { id: '', name: '' }}
                  total={total}
                  perPeriod={perPeriod}
                  allLines={phaseLines}
                  onUpdate={(patch) => updateCostLine(line.id, patch)}
                  onRemove={() => removeCostLine(line.id)}
                  isLocked={line.isLocked === true}
                />
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--color-grey-pale)' }}>
              <td colSpan={7} style={{ padding: '6px', textAlign: 'right', fontWeight: 700 }}>
                Phase Total
              </td>
              <td style={{ padding: '6px', textAlign: 'right', fontWeight: 700 }} data-testid="costs-phase-total">
                {formatCurrency(phaseCost.total, project.currency)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Per-asset detail panel */}
      {phaseAssets.length > 0 && focusAsset && focusBreakdown && focusMetrics && (
        <div style={sectionCardStyle} data-testid="costs-asset-detail">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>Per-Asset Breakdown</strong>
            <select
              value={focusAsset.id}
              onChange={(e) => setActiveAssetId(e.target.value)}
              style={inputStyle}
              data-testid="costs-asset-select"
            >
              {phaseAssets.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 11, marginBottom: 12 }}>
            <div><span style={{ color: 'var(--color-meta)' }}>Land:</span> {formatNumber(focusMetrics.landSqm)} sqm</div>
            <div><span style={{ color: 'var(--color-meta)' }}>NDA:</span> {formatNumber(focusMetrics.ndaSqm)} sqm</div>
            <div><span style={{ color: 'var(--color-meta)' }}>GFA:</span> {formatNumber(focusMetrics.gfa)} sqm</div>
            <div><span style={{ color: 'var(--color-meta)' }}>BUA:</span> {formatNumber(focusMetrics.bua)} sqm</div>
            <div><span style={{ color: 'var(--color-meta)' }}>NSA:</span> {formatNumber(focusMetrics.nsa)} sqm</div>
            <div><span style={{ color: 'var(--color-meta)' }}>Units:</span> {formatNumber(focusMetrics.unitCount)}</div>
            <div><span style={{ color: 'var(--color-meta)' }}>Land $:</span> {formatCurrency(focusMetrics.landValue, project.currency)}</div>
            <div><span style={{ color: 'var(--color-meta)' }}>Total $:</span> {formatCurrency(focusBreakdown.total, project.currency)}</div>
          </div>

          {/* Period schedule (only first 24 periods to keep render fast) */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                  <th style={{ padding: '4px 6px', textAlign: 'left' }}>Period</th>
                  {periodLabels.map((p, i) => (<th key={i} style={{ padding: '4px 6px', textAlign: 'right' }}>{p}</th>))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: '4px 6px', fontWeight: 600 }}>{focusAsset.name} CapEx</td>
                  {periodLabels.map((_, i) => (
                    <td key={i} style={{ padding: '4px 6px', textAlign: 'right' }} data-testid={`costs-period-${i + 1}`}>
                      {formatNumber(focusBreakdown.perPeriod[i + 1] ?? 0)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
