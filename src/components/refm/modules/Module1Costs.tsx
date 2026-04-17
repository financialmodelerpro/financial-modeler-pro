'use client';

import React, { useState } from 'react';
import type { CostItem, CostInputMode, ProjectType, AreaMetrics } from '@/src/types/project.types';
import { formatNumber, formatCurrency } from '@/src/core/core-formatters';
import { STAGE_COLOR, STAGE_BG_RGBA, PHASE_COLOR, ASSET_COLOR, KPI_ACCENT } from '@/src/styles/tokens';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Module1CostsProps {
  projectType: ProjectType;
  costInputMode: CostInputMode;
  setCostInputMode: (v: CostInputMode) => void;
  handleCostInputModeChange: (newMode: CostInputMode) => void;
  residentialCosts: CostItem[]; setResidentialCosts: (v: CostItem[]) => void;
  hospitalityCosts: CostItem[]; setHospitalityCosts: (v: CostItem[]) => void;
  retailCosts: CostItem[]; setRetailCosts: (v: CostItem[]) => void;
  nextCostId: number; setNextCostId: (v: number) => void;
  constructionPeriods: number;
  currency: string;
  modelType: 'monthly' | 'annual';
  projectStart: string;
  calculateItemTotal: (cost: CostItem, assetType: string, costsArr?: CostItem[]) => number;
  distributeCost: (cost: CostItem, assetType: string) => number[];
  getPhasingMode: (cost: CostItem) => string;
  getPhasingValues: (cost: CostItem) => number[];
  calcSameForAllDisplayTotal: (cost: CostItem) => number;
  showResidential: boolean;
  showHospitality: boolean;
  showRetail: boolean;
  readOnly: boolean;
  // Stage state
  costStage: Record<number, number>;
  setCostStage: (v: Record<number, number>) => void;
  // Area data
  getAreas: (assetType: string) => AreaMetrics;
  // Land values
  totalLandArea: number;
  landValuePerSqm: number;
  inKindPercent: number;
  cashPercent: number;
  residentialPercent: number;
  hospitalityPercent: number;
  retailPercent: number;
  residentialLandValue: number;
  hospitalityLandValue: number;
  retailLandValue: number;
  // Sync helper
  syncSameForAllToAllAssets: (masterCosts: CostItem[]) => void;
  // V14 state
  costScope: Record<number, string>;
  setCostScope: (v: Record<number, string>) => void;
  costDevFeeMode: Record<number, string>;
  setCostDevFeeMode: (v: Record<number, string>) => void;
  allocBasis: 'direct_cost' | 'gfa';
  setAllocBasis: (v: 'direct_cost' | 'gfa') => void;
  calcItemTotalV14: (cost: CostItem, assetType: string, costsArr?: CostItem[]) => number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
  'fixed':                'Fixed Amount',
  'rate_total_allocated': 'Rate × Total Land',
  'rate_net_developable': 'Rate × NDA',
  'rate_roads':           'Rate × Roads',
  'rate_gfa':             'Rate × GFA',
  'rate_bua':             'Rate × BUA',
  'percent_base':         '% of Selected',
  'percent_total_land':   '% of Total Land Value',
  'percent_cash_land':    '% of Cash Land Value',
  'percent_inkind_land':  '% of In-Kind Land Value',
};

const inputStyle: React.CSSProperties = {
  padding: '4px 6px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: '12px',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'Inter, sans-serif',
  background: 'var(--color-warning-bg)',
  color: 'var(--color-warning-text)',
  fontWeight: 600,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPeriodLabel(idx: number, projectStart: string, modelType: 'monthly' | 'annual'): string {
  if (modelType === 'annual') return `Y${idx + 1}`;
  const d = new Date(projectStart);
  d.setMonth(d.getMonth() + idx);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function buildMethodHint(method: string, areas: AreaMetrics, currency: string): string {
  switch (method) {
    case 'rate_total_allocated': return `× ${formatNumber(areas.totalAllocated)} sqm (Total Land)`;
    case 'rate_net_developable':  return `× ${formatNumber(areas.netDevelopable)} sqm (NDA)`;
    case 'rate_roads':            return `× ${formatNumber(areas.roadsArea)} sqm (Roads)`;
    case 'rate_gfa':              return `× ${formatNumber(areas.gfa)} sqm (GFA)`;
    case 'rate_bua':              return `× ${formatNumber(areas.bua)} sqm (BUA)`;
    case 'percent_total_land':    return `× ${currency} ${formatNumber(areas.landValue)} (Total Land Value)`;
    case 'percent_cash_land':     return `× ${currency} ${formatNumber(areas.cashLandValue)} (Cash Land)`;
    case 'percent_inkind_land':   return `× ${currency} ${formatNumber(areas.inKindLandValue)} (In-Kind Land)`;
    default: return '';
  }
}

// ── CostTable sub-component ──────────────────────────────────────────────────

interface CostTableProps {
  assetType: string;
  assetLabel: string;
  costs: CostItem[];
  setCosts: (v: CostItem[]) => void;
  nextCostId: number;
  setNextCostId: (v: number) => void;
  constructionPeriods: number;
  currency: string;
  modelType: 'monthly' | 'annual';
  projectStart: string;
  calculateItemTotal: (cost: CostItem, assetType: string, costsArr?: CostItem[]) => number;
  distributeCost: (cost: CostItem, assetType: string) => number[];
  getPhasingMode: (cost: CostItem) => string;
  getPhasingValues: (cost: CostItem) => number[];
  calcSameForAllDisplayTotal: (cost: CostItem) => number;
  readOnly: boolean;
  accentColor: string;
  costStage: Record<number, number>;
  setCostStage: (v: Record<number, number>) => void;
  getAreas: (assetType: string) => AreaMetrics;
  inKindLandValue: number;
  isSameForAll?: boolean;
  // V14 state
  costScope: Record<number, string>;
  setCostScope: (v: Record<number, string>) => void;
  costDevFeeMode: Record<number, string>;
  setCostDevFeeMode: (v: Record<number, string>) => void;
}

function CostTable({
  assetType, assetLabel, costs, setCosts, nextCostId, setNextCostId,
  constructionPeriods, currency, modelType, projectStart,
  calculateItemTotal, distributeCost, getPhasingMode, getPhasingValues,
  calcSameForAllDisplayTotal,
  readOnly, accentColor, costStage, setCostStage, getAreas,
  inKindLandValue, isSameForAll,
  costScope, setCostScope, costDevFeeMode, setCostDevFeeMode,
}: CostTableProps) {
  const areas = getAreas(assetType);
  const getStage = (cost: CostItem) => costStage[cost.id] || (cost.id <= 4 ? 1 : cost.id <= 8 ? 2 : 3);
  const getScope = (cost: CostItem) => costScope[cost.id] || 'asset';
  const getDevFeeMode = (cost: CostItem) => costDevFeeMode[cost.id] || 'exclude';
  const setScope = (id: number, scope: string) => setCostScope({ ...costScope, [id]: scope });
  const setDevFeeMode = (id: number, mode: string) => setCostDevFeeMode({ ...costDevFeeMode, [id]: mode });

  // Group costs by stage
  const stage1 = costs.filter(c => c.canDelete !== false && getStage(c) === 1);
  const stage2 = costs.filter(c => c.canDelete !== false && getStage(c) === 2);
  const stage3 = costs.filter(c => c.canDelete !== false && getStage(c) === 3);

  const lockedRows = costs.filter(c => c.canDelete === false);

  const grandTotal = costs.reduce((s, c) => {
    if (c.canDelete === false) return s;
    const t = isSameForAll ? calcSameForAllDisplayTotal(c) : calculateItemTotal(c, assetType, costs);
    return s + t;
  }, 0);

  const addRow = (stage: number) => {
    const newItem: CostItem = {
      id: nextCostId,
      name: 'New Cost Item',
      method: 'fixed',
      value: 0,
      baseType: '',
      startPeriod: 1,
      endPeriod: constructionPeriods,
      phasing: 'even',
      canDelete: true,
    };
    setCosts([...costs, newItem]);
    setCostStage({ ...costStage, [nextCostId]: stage });
    setNextCostId(nextCostId + 1);
  };

  const updateCost = (id: number, field: keyof CostItem, value: unknown) => {
    setCosts(costs.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const deleteCost = (id: number) => {
    setCosts(costs.filter(c => c.id !== id));
  };

  const setStage = (id: number, stage: number) => {
    setCostStage({ ...costStage, [id]: stage });
  };

  const maxPeriods = Math.min(constructionPeriods, 24);
  const periodLabels = Array.from({ length: maxPeriods }, (_, i) => getPeriodLabel(i, projectStart, modelType));

  // Sum all costs distributed across periods (for combined cost summary)
  const periodTotals = Array.from({ length: maxPeriods }, (_, i) => {
    return costs
      .filter(c => c.canDelete !== false)
      .reduce((sum, cost) => {
        const dist = distributeCost(cost, assetType);
        return sum + (dist[i + 1] || 0); // dist[0]=P0, dist[1]=P1..Pn
      }, 0);
  });

  const renderCostRow = (cost: CostItem) => {
    const total = isSameForAll ? calcSameForAllDisplayTotal(cost) : calculateItemTotal(cost, assetType, costs);
    const phasingMode = getPhasingMode(cost);
    const hint = buildMethodHint(cost.method, areas, currency);
    const dist = distributeCost(cost, assetType);

    const updatePhasingManualValue = (periodIdx: number, val: number) => {
      const existingValues = getPhasingValues(cost);
      const count = Math.max(1, cost.endPeriod - cost.startPeriod + 1);
      const newVals = Array.from({ length: count }, (_, i) => existingValues[i] || 0);
      newVals[periodIdx] = val;
      updateCost(cost.id, 'phasing', { type: 'manual', values: newVals });
    };

    const initManualPhasing = () => {
      const count = Math.max(1, cost.endPeriod - cost.startPeriod + 1);
      const equalPct = parseFloat((100 / count).toFixed(2));
      const vals = Array.from({ length: count }, (_, i) =>
        i === count - 1 ? 100 - equalPct * (count - 1) : equalPct
      );
      updateCost(cost.id, 'phasing', { type: 'manual', values: vals });
    };

    const manualVals = getPhasingValues(cost);
    const manualSum = manualVals.reduce((s, v) => s + (v || 0), 0);

    return (
      <React.Fragment key={cost.id}>
        <tr>
          {/* Cost Name */}
          <td style={{ minWidth: 150 }}>
            <input
              className="input-assumption"
              style={inputStyle}
              type="text"
              value={cost.name}
              onChange={e => updateCost(cost.id, 'name', e.target.value)}
              disabled={readOnly}
            />
          </td>

          {/* Stage + Scope */}
          <td style={{ minWidth: 90 }}>
            <select
              className="input-assumption"
              style={{ ...inputStyle, fontSize: '11px' }}
              value={getStage(cost)}
              onChange={e => setStage(cost.id, Number(e.target.value))}
              disabled={readOnly}
            >
              <option value={1}>Stage 1</option>
              <option value={2}>Stage 2</option>
              <option value={3}>Stage 3</option>
            </select>
            <select
              className="input-assumption"
              style={{ ...inputStyle, fontSize: '10px', marginTop: '2px' }}
              value={getScope(cost)}
              onChange={e => setScope(cost.id, e.target.value)}
              disabled={readOnly}
            >
              <option value="asset">Asset</option>
              <option value="project">Project</option>
            </select>
          </td>

          {/* Method + Base Selection */}
          <td style={{ minWidth: 200 }}>
            <select
              className="input-assumption"
              style={{ ...inputStyle, fontSize: '11px' }}
              value={cost.method}
              onChange={e => updateCost(cost.id, 'method', e.target.value)}
              disabled={readOnly}
            >
              {Object.entries(METHOD_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {hint && (
              <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginTop: '2px', fontStyle: 'italic' }}>
                {hint}
              </div>
            )}
            {cost.method === 'percent_base' && (
              <div style={{ marginTop: '4px' }}>
                <div style={{ display: 'flex', gap: '4px', marginBottom: '3px' }}>
                  {(['exclude', 'include'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => !readOnly && setDevFeeMode(cost.id, mode)}
                      disabled={readOnly}
                      style={{
                        padding: '1px 6px', fontSize: '9px', borderRadius: '3px',
                        border: getDevFeeMode(cost) === mode ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                        background: getDevFeeMode(cost) === mode ? 'rgba(27,79,138,0.1)' : 'var(--color-surface)',
                        cursor: readOnly ? 'not-allowed' : 'pointer',
                        fontWeight: getDevFeeMode(cost) === mode ? 700 : 400,
                        color: getDevFeeMode(cost) === mode ? 'var(--color-primary)' : 'var(--color-muted)',
                        fontFamily: 'Inter, sans-serif',
                      }}
                    >
                      {mode === 'include' ? '⟳ Incl. Dev Fee' : '- Excl. Dev Fee'}
                    </button>
                  ))}
                </div>
                <div style={{ maxHeight: '80px', overflowY: 'auto' }}>
                {costs.filter(c => c.id !== cost.id && c.canDelete !== false).map(other => (
                  <label key={other.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', cursor: 'pointer', padding: '1px 0' }}>
                    <input
                      type="checkbox"
                      checked={(cost.selectedIds || []).includes(other.id)}
                      onChange={e => {
                        const sel = cost.selectedIds || [];
                        const next = e.target.checked ? [...sel, other.id] : sel.filter(id => id !== other.id);
                        updateCost(cost.id, 'selectedIds', next);
                      }}
                      disabled={readOnly}
                    />
                    {other.name}
                  </label>
                ))}
                </div>
              </div>
            )}
          </td>

          {/* Value */}
          <td style={{ minWidth: 80 }}>
            <input
              className="input-assumption"
              style={{ ...inputStyle, textAlign: 'right' }}
              type="number"
              min={0}
              step={cost.method.startsWith('percent') ? 0.1 : 1}
              value={cost.value}
              onChange={e => updateCost(cost.id, 'value', Number(e.target.value))}
              disabled={readOnly}
            />
          </td>

          {/* Total */}
          <td style={{ fontWeight: 600, color: 'var(--color-heading)', textAlign: 'right', minWidth: 100 }}>
            {formatNumber(total)}
          </td>

          {/* Start */}
          <td style={{ minWidth: 60 }}>
            <input
              className="input-assumption"
              style={{ ...inputStyle, textAlign: 'center' }}
              type="number"
              min={1}
              max={constructionPeriods}
              value={cost.startPeriod}
              onChange={e => updateCost(cost.id, 'startPeriod', Number(e.target.value))}
              disabled={readOnly}
            />
          </td>

          {/* End */}
          <td style={{ minWidth: 60 }}>
            <input
              className="input-assumption"
              style={{ ...inputStyle, textAlign: 'center' }}
              type="number"
              min={1}
              max={constructionPeriods}
              value={cost.endPeriod}
              onChange={e => updateCost(cost.id, 'endPeriod', Number(e.target.value))}
              disabled={readOnly}
            />
          </td>

          {/* Phasing */}
          <td style={{ minWidth: 90 }}>
            <select
              className="input-assumption"
              style={{ ...inputStyle, fontSize: '11px' }}
              value={phasingMode}
              onChange={e => {
                if (e.target.value === 'manual') {
                  initManualPhasing();
                } else {
                  updateCost(cost.id, 'phasing', 'even');
                }
              }}
              disabled={readOnly}
            >
              <option value="even">Even</option>
              <option value="manual">Manual</option>
            </select>
          </td>

          {/* Delete */}
          {!readOnly && (
            <td style={{ width: 40 }}>
              {cost.canDelete && (
                <button
                  className="btn-danger rbac-action-btn"
                  style={{ padding: '2px 6px', fontSize: '11px' }}
                  onClick={() => deleteCost(cost.id)}
                >
                  ✕
                </button>
              )}
            </td>
          )}
        </tr>

        {/* Manual phasing inputs */}
        {phasingMode === 'manual' && (
          <tr style={{ background: 'var(--color-input-bg)' }}>
            <td colSpan={!readOnly ? 9 : 8} style={{ padding: '8px 12px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-muted)', marginBottom: '6px' }}>
                Manual Phasing (%) - Sum: <span style={{ color: Math.abs(manualSum - 100) < 0.1 ? 'var(--color-green-dark)' : 'var(--color-negative)', fontWeight: 700 }}>{manualSum.toFixed(1)}%</span> {Math.abs(manualSum - 100) < 0.1 ? '✓' : '(must = 100%)'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {Array.from({ length: cost.endPeriod - cost.startPeriod + 1 }, (_, i) => (
                  <div key={i} style={{ textAlign: 'center', minWidth: '60px' }}>
                    <div style={{ fontSize: '9px', color: 'var(--color-muted)', marginBottom: '2px' }}>
                      {getPeriodLabel(cost.startPeriod - 1 + i, projectStart, modelType)}
                    </div>
                    <input
                      className="input-assumption"
                      style={{ ...inputStyle, width: '58px', textAlign: 'right', fontSize: '11px' }}
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={manualVals[i] || 0}
                      onChange={e => updatePhasingManualValue(i, Number(e.target.value))}
                      disabled={readOnly}
                    />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '6px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {dist.slice(1).map((v, i) => (
                  <div key={i} style={{
                    padding: '3px 7px', borderRadius: '4px', fontSize: '10px',
                    background: v > 0 ? 'rgba(27,79,138,0.08)' : 'var(--color-grey-pale)',
                    color: v > 0 ? 'var(--color-primary)' : 'var(--color-muted)',
                    fontWeight: v > 0 ? 600 : 400,
                  }}>
                    {getPeriodLabel(i, projectStart, modelType)}: {v > 0 ? formatNumber(v) : '-'}
                  </div>
                ))}
              </div>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  const stageHeaders: Record<number, string> = {
    1: '▸ Stage 1 - Direct Base Costs',
    2: '▸ Stage 2 - Shared Project Costs',
    3: '▸ Stage 3 - Derived Costs',
  };
  const renderStageSection = (stageNum: number, stageCosts: CostItem[]) => (
    <React.Fragment key={stageNum}>
      <tr>
        <td colSpan={!readOnly ? 9 : 8} style={{
          padding: '6px 10px',
          background: STAGE_BG_RGBA[stageNum],
          fontWeight: 700, fontSize: '11px',
          color: STAGE_COLOR[stageNum],
          borderTop: '1px solid var(--color-border)',
        }}>
          {stageHeaders[stageNum]}
          {!readOnly && (
            <button
              onClick={() => addRow(stageNum)}
              style={{
                marginLeft: '12px', padding: '1px 8px', fontSize: '10px',
                background: STAGE_COLOR[stageNum], color: '#fff',
                border: 'none', borderRadius: '3px', cursor: 'pointer',
              }}
            >
              + Add
            </button>
          )}
        </td>
      </tr>
      {stageCosts.map(renderCostRow)}
    </React.Fragment>
  );

  return (
    <div className="module-card" style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '4px', height: '20px', borderRadius: '2px', background: accentColor }} />
          <h3 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
            {assetLabel} - Development Costs
          </h3>
          <span style={{ fontSize: '11px', fontWeight: 700, color: accentColor }}>
            {formatCurrency(grandTotal, currency)}
          </span>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="table-standard cost-input-table" style={{ minWidth: '900px' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', minWidth: 150 }}>Cost Name</th>
              <th style={{ minWidth: 90 }}>Stage / Scope</th>
              <th style={{ minWidth: 200 }}>Method / Base Selection</th>
              <th style={{ minWidth: 80 }}>Input Value</th>
              <th style={{ minWidth: 100 }}>Total ({currency})</th>
              <th style={{ minWidth: 60 }}>Start</th>
              <th style={{ minWidth: 60 }}>End</th>
              <th style={{ minWidth: 90 }}>Phasing</th>
              {!readOnly && <th style={{ width: 40 }}>Del</th>}
            </tr>
          </thead>
          <tbody>
            {/* ── Row 1: Land In-Kind (always first, always locked at P0) ── */}
            {inKindLandValue > 0 && (
              <tr style={{ background: 'var(--color-input-bg)', borderLeft: '3px solid var(--color-gold-dark)' }}>
                <td style={{ fontWeight: 700, fontSize: '12px', color: 'var(--color-gold-dark)' }}>
                  Land (In-Kind)
                </td>
                <td style={{ color: 'var(--color-gold-dark)', fontSize: '11px', fontStyle: 'italic' }} colSpan={2}>
                  🔒 Calculated from Land &amp; Area tab
                </td>
                <td />
                <td style={{ fontWeight: 700, textAlign: 'right', color: 'var(--color-gold-dark)' }}>
                  {formatNumber(inKindLandValue)}
                </td>
                <td style={{ textAlign: 'center', color: 'var(--color-gold-dark)', fontSize: '11px' }}>P0</td>
                <td style={{ textAlign: 'center', color: 'var(--color-gold-dark)', fontSize: '11px' }}>P0</td>
                <td style={{ textAlign: 'center', color: 'var(--color-gold-dark)', fontSize: '11px', fontStyle: 'italic' }}>P0 only</td>
                {!readOnly && <td style={{ textAlign: 'center', color: 'var(--color-grey-light)' }}>🔒</td>}
              </tr>
            )}
            {/* ── Row 2: Land Cash (locked value, but phasing is editable) ── */}
            {lockedRows.map(cost => {
              const total = isSameForAll ? calcSameForAllDisplayTotal(cost) : calculateItemTotal(cost, assetType, costs);
              return (
                <tr key={cost.id} style={{ background: 'var(--color-input-bg)', borderLeft: '3px solid var(--color-gold-dark)' }}>
                  <td style={{ fontWeight: 700, fontSize: '12px', color: 'var(--color-gold-dark)' }}>
                    {cost.name}
                  </td>
                  <td style={{ color: 'var(--color-gold-dark)', fontSize: '11px', fontStyle: 'italic' }} colSpan={2}>
                    🔒 Calculated from Land &amp; Area tab
                  </td>
                  <td />
                  <td style={{ fontWeight: 700, textAlign: 'right', color: 'var(--color-gold-dark)' }}>
                    {formatNumber(total)}
                  </td>
                  {/* Start period - editable */}
                  <td style={{ minWidth: 60 }}>
                    <input
                      className="input-assumption"
                      style={{ ...inputStyle, textAlign: 'center' }}
                      type="number"
                      min={0}
                      max={constructionPeriods}
                      value={cost.startPeriod}
                      onChange={e => {
                        const s = Math.min(Number(e.target.value), constructionPeriods);
                        setCosts(costs.map(c => c.id === cost.id
                          ? { ...c, startPeriod: s, endPeriod: Math.max(c.endPeriod, s), phasing: 'even' }
                          : c));
                      }}
                      disabled={readOnly}
                    />
                  </td>
                  {/* End period - editable */}
                  <td style={{ minWidth: 60 }}>
                    <input
                      className="input-assumption"
                      style={{ ...inputStyle, textAlign: 'center' }}
                      type="number"
                      min={cost.startPeriod}
                      max={constructionPeriods}
                      value={cost.endPeriod}
                      onChange={e => {
                        const end = Math.max(Number(e.target.value), cost.startPeriod);
                        setCosts(costs.map(c => c.id === cost.id
                          ? { ...c, endPeriod: end, phasing: 'even' }
                          : c));
                      }}
                      disabled={readOnly}
                    />
                  </td>
                  {/* Phasing - always Even for Land Cash */}
                  <td style={{ minWidth: 90, textAlign: 'center', fontSize: '11px', color: 'var(--color-gold-dark)', fontStyle: 'italic' }}>
                    Even
                  </td>
                  {!readOnly && <td style={{ textAlign: 'center', color: 'var(--color-grey-light)' }}>🔒</td>}
                </tr>
              );
            })}

            {renderStageSection(1, stage1)}
            {renderStageSection(2, stage2)}
            {renderStageSection(3, stage3)}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} style={{ fontWeight: 700 }}>TOTAL DEVELOPMENT COSTS</td>
              <td style={{ fontWeight: 700, textAlign: 'right' }}>{formatCurrency(grandTotal, currency)}</td>
              <td colSpan={!readOnly ? 4 : 3} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Period totals */}
      {maxPeriods > 0 && (
        <div style={{ marginTop: 'var(--sp-2)' }}>
          <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginBottom: '6px', fontWeight: 600 }}>
            Total by Period ({currency}):
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {periodTotals.map((v, i) => (
              <div key={i} style={{
                padding: '6px 10px', borderRadius: '6px',
                background: v > 0 ? 'rgba(27,79,138,0.08)' : 'var(--color-grey-pale)',
                border: '1px solid var(--color-border)', fontSize: '11px',
              }}>
                <div style={{ fontSize: '10px', color: 'var(--color-muted)', fontWeight: 700 }}>{periodLabels[i]}</div>
                <div style={{ fontWeight: 600, color: v > 0 ? 'var(--color-primary)' : 'var(--color-muted)' }}>
                  {v > 0 ? formatNumber(v) : '-'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function Module1Costs({
  projectType, costInputMode, setCostInputMode, handleCostInputModeChange,
  residentialCosts, setResidentialCosts,
  hospitalityCosts, setHospitalityCosts,
  retailCosts, setRetailCosts,
  nextCostId, setNextCostId,
  constructionPeriods, currency, modelType, projectStart,
  calculateItemTotal, distributeCost, getPhasingMode, getPhasingValues,
  calcSameForAllDisplayTotal,
  showResidential, showHospitality, showRetail,
  readOnly,
  costStage, setCostStage, getAreas,
  totalLandArea, landValuePerSqm, inKindPercent, cashPercent,
  residentialPercent, hospitalityPercent, retailPercent,
  residentialLandValue, hospitalityLandValue, retailLandValue,
  syncSameForAllToAllAssets,
  costScope, setCostScope, costDevFeeMode, setCostDevFeeMode,
  allocBasis, setAllocBasis, calcItemTotalV14,
}: Module1CostsProps) {

  const [activeCostFilter, setActiveCostFilter] = useState<string>('combined');

  // ── Totals ──
  const resTotal  = residentialCosts.filter(c => c.canDelete !== false).reduce((s, c) => s + calculateItemTotal(c, 'residential', residentialCosts), 0);
  const hospTotal = hospitalityCosts.filter(c => c.canDelete !== false).reduce((s, c) => s + calculateItemTotal(c, 'hospitality', hospitalityCosts), 0);
  const retTotal  = retailCosts.filter(c => c.canDelete !== false).reduce((s, c) => s + calculateItemTotal(c, 'retail', retailCosts), 0);
  const sameTotal = residentialCosts.filter(c => c.canDelete !== false).reduce((s, c) => s + calcSameForAllDisplayTotal(c), 0);

  const getStage = (cost: CostItem) => costStage[cost.id] || (cost.id <= 4 ? 1 : cost.id <= 8 ? 2 : 3);

  // ── TPDC by stage - mirrors legacy getUnifiedCostTotal ──
  // Includes locked rows (Land Cash) in stage 1, in-kind land virtual item in stage 1 and TPDC.
  const getStageTotal = (stage: number): number => {
    const activeAssetsList = [
      ...(showResidential ? [{ costs: residentialCosts, assetType: 'residential', allocPct: residentialPercent }] : []),
      ...(showHospitality ? [{ costs: hospitalityCosts, assetType: 'hospitality', allocPct: hospitalityPercent }] : []),
      ...(showRetail      ? [{ costs: retailCosts,       assetType: 'retail',       allocPct: retailPercent }]      : []),
    ];
    const totalAllocPct = activeAssetsList.reduce((s, a) => s + a.allocPct, 0);

    // Collect unique cost names for this stage (including locked rows - Land Cash defaults to stage 1)
    const seen = new Set<string>();
    const names: string[] = [];
    activeAssetsList.forEach(({ costs }) => {
      costs.forEach(c => {
        if (getStage(c) === stage && !seen.has(c.name)) {
          seen.add(c.name);
          names.push(c.name);
        }
      });
    });

    let total = 0;
    names.forEach(name => {
      activeAssetsList.forEach(({ assetType, allocPct, costs }) => {
        const cost = costs.find(c => c.name === name);
        if (!cost) return;
        // Same-for-all locked rows store full project value → proportion by asset allocation
        if (costInputMode === 'same-for-all' && cost.canDelete === false) {
          const factor = totalAllocPct > 0 ? allocPct / totalAllocPct : 0;
          total += calculateItemTotal(cost, assetType) * factor;
        } else {
          total += calculateItemTotal(cost, assetType, costs);
        }
      });
    });

    // Land In-Kind is a virtual Stage-1 item (not in any cost array)
    if (stage === 1) {
      total += totalLandArea * landValuePerSqm * (inKindPercent / 100);
    }

    return total;
  };

  const tpdc1 = getStageTotal(1);
  const tpdc2 = getStageTotal(2);
  const tpdc3 = getStageTotal(3);
  const tpdcTotal = tpdc1 + tpdc2 + tpdc3;

  // ── Combined cost summary per period ──
  const maxPeriods = Math.min(constructionPeriods, 24);
  // periodLabels covers P1..Pmax (construction); P0 is shown as a separate column
  const periodLabels = Array.from({ length: maxPeriods }, (_, i) => getPeriodLabel(i, projectStart, modelType));

  // Mirrors legacy getAssetDist + buildCombinedLines:
  // - Includes all costs (locked and deletable)
  // - Applies same-for-all proportioning for locked rows
  // - periods[0] = P0, periods[1..N] = P1..PN
  const getCombinedCostSummary = () => {
    const allActiveAssets = [
      ...(showResidential ? [{ assetType: 'residential', costs: residentialCosts, allocPct: residentialPercent }] : []),
      ...(showHospitality ? [{ assetType: 'hospitality',  costs: hospitalityCosts, allocPct: hospitalityPercent }]  : []),
      ...(showRetail      ? [{ assetType: 'retail',       costs: retailCosts,       allocPct: retailPercent }]      : []),
    ];
    const totalAllocPct = allActiveAssets.reduce((s, a) => s + a.allocPct, 0);
    const costsMap: Record<string, CostItem[]> = { residential: residentialCosts, hospitality: hospitalityCosts, retail: retailCosts };

    // Filter to selected asset(s)
    const filteredAssets = activeCostFilter === 'combined'
      ? allActiveAssets
      : allActiveAssets.filter(a => a.assetType === activeCostFilter);

    // Collect unique cost names in order (same as legacy)
    const seen = new Set<string>();
    const names: string[] = [];
    filteredAssets.forEach(({ costs }) => {
      costs.forEach(c => { if (!seen.has(c.name)) { seen.add(c.name); names.push(c.name); } });
    });

    // getAssetDist: mirrors legacy - applies proportioning for same-for-all locked rows
    const getAssetDist = (costName: string, assetType: string): number[] => {
      const cost = (costsMap[assetType] || []).find(c => c.name === costName);
      if (!cost) return Array(constructionPeriods + 1).fill(0);
      if (costInputMode === 'same-for-all' && cost.canDelete === false) {
        const fullDist = distributeCost(cost, assetType);
        const assetAllocPct = allActiveAssets.find(a => a.assetType === assetType)?.allocPct || 0;
        const factor = totalAllocPct > 0 ? assetAllocPct / totalAllocPct : 0;
        return fullDist.map(v => v * factor);
      }
      return distributeCost(cost, assetType);
    };

    // numPeriods = P0..maxPeriods (maxPeriods + 1 columns)
    const numPeriods = maxPeriods + 1;

    return names.map(name => {
      const dist = Array(numPeriods).fill(0);
      filteredAssets.forEach(({ assetType }) => {
        const d = getAssetDist(name, assetType);
        for (let i = 0; i < numPeriods; i++) dist[i] += d[i] || 0;
      });
      const total = dist.reduce((s, v) => s + v, 0);
      return { name, periods: dist, total };
    });
  };

  const combinedSummary = getCombinedCostSummary();
  // combinedPeriodTotals[0] = P0 total, [1..N] = P1..PN totals
  const combinedPeriodTotals = Array.from({ length: maxPeriods + 1 }, (_, i) =>
    combinedSummary.reduce((s, row) => s + (row.periods[i] || 0), 0)
  );

  // ── CAPEX per-asset period rows (for incl/excl land in-kind tables) ──
  const activeAssets = [
    ...(showResidential ? [{ label: 'Residential', assetType: 'residential', costs: residentialCosts, landValue: residentialLandValue, allocPct: residentialPercent }] : []),
    ...(showHospitality ? [{ label: 'Hospitality',  assetType: 'hospitality',  costs: hospitalityCosts, landValue: hospitalityLandValue, allocPct: hospitalityPercent }] : []),
    ...(showRetail      ? [{ label: 'Retail',        assetType: 'retail',       costs: retailCosts,       landValue: retailLandValue,       allocPct: retailPercent }]      : []),
  ];
  const capexTotalAllocPct = activeAssets.reduce((s, a) => s + a.allocPct, 0);

  // Mirrors legacy calculateResidentialCapex: ALL costs (including locked rows = Land Cash).
  // Same-for-all locked rows store full project value → proportion by asset allocation factor.
  const getCapexRow = (assetType: string, costs: CostItem[], allocPct: number) => {
    const periods = Array(maxPeriods + 1).fill(0); // index 0 = P0
    costs.forEach(cost => {
      let dist: number[];
      if (costInputMode === 'same-for-all' && cost.canDelete === false) {
        const fullDist = distributeCost(cost, assetType);
        const factor = capexTotalAllocPct > 0 ? allocPct / capexTotalAllocPct : 0;
        dist = fullDist.map(v => v * factor);
      } else {
        dist = distributeCost(cost, assetType);
      }
      dist.forEach((v, i) => { if (i <= maxPeriods) periods[i] += v; });
    });
    return periods;
  };

  const capexRows = activeAssets.map(a => ({
    ...a,
    periods: getCapexRow(a.assetType, a.costs, a.allocPct),
  }));

  const capexTotalsExclLand = Array.from({ length: maxPeriods + 1 }, (_, i) =>
    capexRows.reduce((s, r) => s + (r.periods[i] || 0), 0)
  );

  // Incl. In-Kind: add in-kind land at P0 per asset
  const capexRowsInclLand = capexRows.map(r => {
    const p = [...r.periods];
    p[0] += r.landValue * (inKindPercent / 100);
    return { ...r, periods: p };
  });

  const capexTotalsInclLand = Array.from({ length: maxPeriods + 1 }, (_, i) =>
    capexRowsInclLand.reduce((s, r) => s + (r.periods[i] || 0), 0)
  );

  // Excl. ALL land: no Land Cash (canDelete=false) and no Land In-Kind addition
  const capexRowsExclAllLand = activeAssets.map(a => ({
    ...a,
    periods: getCapexRow(a.assetType, a.costs.filter(c => c.canDelete !== false), a.allocPct),
  }));
  const capexTotalsExclAllLand = Array.from({ length: maxPeriods + 1 }, (_, i) =>
    capexRowsExclAllLand.reduce((s, r) => s + (r.periods[i] || 0), 0)
  );

  const isSameForAll = costInputMode === 'same-for-all';

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-section)', fontWeight: 'var(--fw-bold)', color: 'var(--color-heading)', margin: '0 0 4px' }}>
            Development Costs
          </h2>
          <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-meta)', margin: 0 }}>
            Define construction and soft cost items, phasing, and total CapEx
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--color-muted)', fontWeight: 600 }}>Alloc Basis:</span>
            {(['direct_cost', 'gfa'] as const).map(basis => (
              <button
                key={basis}
                onClick={() => !readOnly && setAllocBasis(basis)}
                disabled={readOnly}
                style={{
                  padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                  border: allocBasis === basis ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  background: allocBasis === basis ? 'rgba(27,79,138,0.08)' : 'var(--color-surface)',
                  cursor: readOnly ? 'not-allowed' : 'pointer',
                  fontWeight: allocBasis === basis ? 700 : 400,
                  color: allocBasis === basis ? 'var(--color-primary)' : 'var(--color-body)',
                  fontSize: '11px', fontFamily: 'Inter, sans-serif',
                }}
              >
                {basis === 'direct_cost' ? 'Direct Cost' : 'GFA'}
              </button>
            ))}
          </div>
          <span style={{ fontSize: '11px', color: 'var(--color-muted)', fontWeight: 600 }}>Input Mode:</span>
          {(['same-for-all', 'separate'] as CostInputMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => !readOnly && handleCostInputModeChange(mode)}
              disabled={readOnly}
              style={{
                padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                border: costInputMode === mode ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                background: costInputMode === mode ? 'rgba(27,79,138,0.08)' : 'var(--color-surface)',
                cursor: readOnly ? 'not-allowed' : 'pointer',
                fontWeight: costInputMode === mode ? 700 : 400,
                color: costInputMode === mode ? 'var(--color-primary)' : 'var(--color-body)',
                fontSize: '12px', fontFamily: 'Inter, sans-serif',
              }}
            >
              {mode === 'same-for-all' ? '⊟ Same for All' : '⊞ Separate'}
            </button>
          ))}
        </div>
      </div>

      {/* TPDC KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: 'var(--sp-1)', marginBottom: 'var(--sp-2)' }}>
        {[
          { label: 'Stage 1 - Direct',   value: tpdc1,     color: 'var(--color-navy)' },
          { label: 'Stage 2 - Shared',   value: tpdc2,     color: 'var(--color-navy-mid)' },
          { label: 'Stage 3 - Derived',  value: tpdc3,     color: 'var(--color-navy-dark)' },
          { label: 'TPDC Total',         value: tpdcTotal, color: 'var(--color-gold-dark)' },
        ].map((kpi, i) => (
          <div key={i} className="kpi-card">
            <div className="kpi-card__accent" style={{ background: kpi.color }} />
            <div className="kpi-card__body">
              <div className="kpi-card__label">{kpi.label}</div>
              <div className="kpi-card__value" style={{ fontSize: '14px' }}>{formatCurrency(kpi.value, currency)}</div>
            </div>
          </div>
        ))}
        {!isSameForAll && (
          <>
            {showResidential && (
              <div className="kpi-card">
                <div className="kpi-card__accent" style={{ background: 'var(--color-navy)' }} />
                <div className="kpi-card__body">
                  <div className="kpi-card__label">Residential CapEx</div>
                  <div className="kpi-card__value" style={{ fontSize: '14px' }}>{formatCurrency(resTotal, currency)}</div>
                </div>
              </div>
            )}
            {showHospitality && (
              <div className="kpi-card">
                <div className="kpi-card__accent" style={{ background: KPI_ACCENT.hospitality }} />
                <div className="kpi-card__body">
                  <div className="kpi-card__label">Hospitality CapEx</div>
                  <div className="kpi-card__value" style={{ fontSize: '14px' }}>{formatCurrency(hospTotal, currency)}</div>
                </div>
              </div>
            )}
            {showRetail && (
              <div className="kpi-card">
                <div className="kpi-card__accent" style={{ background: KPI_ACCENT.retail }} />
                <div className="kpi-card__body">
                  <div className="kpi-card__label">Retail CapEx</div>
                  <div className="kpi-card__value" style={{ fontSize: '14px' }}>{formatCurrency(retTotal, currency)}</div>
                </div>
              </div>
            )}
          </>
        )}
        {isSameForAll && (
          <div className="kpi-card">
            <div className="kpi-card__accent" style={{ background: 'var(--color-green-dark)' }} />
            <div className="kpi-card__body">
              <div className="kpi-card__label">Total CapEx (All Assets)</div>
              <div className="kpi-card__value" style={{ fontSize: '14px' }}>{formatCurrency(sameTotal, currency)}</div>
            </div>
          </div>
        )}
      </div>

      {/* Cost Input Tables */}
      {isSameForAll ? (
        <CostTable
          assetType="residential"
          assetLabel="All Assets (Same for All)"
          costs={residentialCosts}
          setCosts={c => { setResidentialCosts(c); syncSameForAllToAllAssets(c); }}
          nextCostId={nextCostId}
          setNextCostId={setNextCostId}
          constructionPeriods={constructionPeriods}
          currency={currency}
          modelType={modelType}
          projectStart={projectStart}
          calculateItemTotal={calculateItemTotal}
          distributeCost={distributeCost}
          getPhasingMode={getPhasingMode}
          getPhasingValues={getPhasingValues}
          calcSameForAllDisplayTotal={calcSameForAllDisplayTotal}
          readOnly={readOnly}
          accentColor={ASSET_COLOR.residential}
          costStage={costStage}
          setCostStage={setCostStage}
          getAreas={getAreas}
          inKindLandValue={inKindPercent > 0 ? (totalLandArea * landValuePerSqm * (inKindPercent / 100)) : 0}
          isSameForAll={true}
          costScope={costScope}
          setCostScope={setCostScope}
          costDevFeeMode={costDevFeeMode}
          setCostDevFeeMode={setCostDevFeeMode}
        />
      ) : (
        <>
          {showResidential && (
            <CostTable
              assetType="residential"
              assetLabel="Residential"
              costs={residentialCosts}
              setCosts={setResidentialCosts}
              nextCostId={nextCostId}
              setNextCostId={setNextCostId}
              constructionPeriods={constructionPeriods}
              currency={currency}
              modelType={modelType}
              projectStart={projectStart}
              calculateItemTotal={calculateItemTotal}
              distributeCost={distributeCost}
              getPhasingMode={getPhasingMode}
              getPhasingValues={getPhasingValues}
              calcSameForAllDisplayTotal={calcSameForAllDisplayTotal}
              readOnly={readOnly}
              accentColor={ASSET_COLOR.residential}
              costStage={costStage}
              setCostStage={setCostStage}
              getAreas={getAreas}
              inKindLandValue={residentialLandValue * (inKindPercent / 100)}
              costScope={costScope}
              setCostScope={setCostScope}
              costDevFeeMode={costDevFeeMode}
              setCostDevFeeMode={setCostDevFeeMode}
            />
          )}
          {showHospitality && (
            <CostTable
              assetType="hospitality"
              assetLabel="Hospitality"
              costs={hospitalityCosts}
              setCosts={setHospitalityCosts}
              nextCostId={nextCostId}
              setNextCostId={setNextCostId}
              constructionPeriods={constructionPeriods}
              currency={currency}
              modelType={modelType}
              projectStart={projectStart}
              calculateItemTotal={calculateItemTotal}
              distributeCost={distributeCost}
              getPhasingMode={getPhasingMode}
              getPhasingValues={getPhasingValues}
              calcSameForAllDisplayTotal={calcSameForAllDisplayTotal}
              readOnly={readOnly}
              accentColor={ASSET_COLOR.hospitality}
              costStage={costStage}
              setCostStage={setCostStage}
              getAreas={getAreas}
              inKindLandValue={hospitalityLandValue * (inKindPercent / 100)}
              costScope={costScope}
              setCostScope={setCostScope}
              costDevFeeMode={costDevFeeMode}
              setCostDevFeeMode={setCostDevFeeMode}
            />
          )}
          {showRetail && (
            <CostTable
              assetType="retail"
              assetLabel="Retail"
              costs={retailCosts}
              setCosts={setRetailCosts}
              nextCostId={nextCostId}
              setNextCostId={setNextCostId}
              constructionPeriods={constructionPeriods}
              currency={currency}
              modelType={modelType}
              projectStart={projectStart}
              calculateItemTotal={calculateItemTotal}
              distributeCost={distributeCost}
              getPhasingMode={getPhasingMode}
              getPhasingValues={getPhasingValues}
              calcSameForAllDisplayTotal={calcSameForAllDisplayTotal}
              readOnly={readOnly}
              accentColor={ASSET_COLOR.retail}
              costStage={costStage}
              setCostStage={setCostStage}
              getAreas={getAreas}
              inKindLandValue={retailLandValue * (inKindPercent / 100)}
              costScope={costScope}
              setCostScope={setCostScope}
              costDevFeeMode={costDevFeeMode}
              setCostDevFeeMode={setCostDevFeeMode}
            />
          )}
        </>
      )}

      {/* ── Combined Cost Summary Table ── */}
      <div className="module-card" style={{ padding: 'var(--sp-3)', marginTop: 'var(--sp-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-2)' }}>
          <h3 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-heading)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
            Combined Cost Summary - By Period
          </h3>
          <div style={{ display: 'flex', gap: '6px' }}>
            {[
              { key: 'combined',    label: 'Combined' },
              ...(showResidential ? [{ key: 'residential', label: 'Residential' }] : []),
              ...(showHospitality ? [{ key: 'hospitality', label: 'Hospitality' }] : []),
              ...(showRetail      ? [{ key: 'retail',      label: 'Retail' }]      : []),
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setActiveCostFilter(f.key)}
                style={{
                  padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: '11px',
                  border: activeCostFilter === f.key ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  background: activeCostFilter === f.key ? 'rgba(27,79,138,0.08)' : 'var(--color-surface)',
                  cursor: 'pointer', fontWeight: activeCostFilter === f.key ? 700 : 400,
                  color: activeCostFilter === f.key ? 'var(--color-primary)' : 'var(--color-body)',
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table-standard" style={{ minWidth: `${200 + (maxPeriods + 1) * 80}px` }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', minWidth: 180 }}>Cost Item</th>
                <th style={{ textAlign: 'right', minWidth: 100 }}>Total</th>
                {/* P0 column - amber (pre-construction) */}
                <th style={{
                  textAlign: 'right', minWidth: 75,
                  background: PHASE_COLOR.preBg, color: PHASE_COLOR.pre,
                  fontSize: '10px', fontWeight: 700,
                }}>
                  P0
                  <div style={{ fontSize: '8px', opacity: 0.7, fontWeight: 400 }}>Pre</div>
                </th>
                {periodLabels.map((lbl, i) => (
                  <th key={i} style={{
                    textAlign: 'right', minWidth: 75,
                    background: PHASE_COLOR.constructionBg, color: PHASE_COLOR.construction,
                    fontSize: '10px', fontWeight: 700,
                  }}>
                    {lbl}
                    <div style={{ fontSize: '8px', opacity: 0.7, fontWeight: 400 }}>Con</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Land In-Kind virtual row - P0 only */}
              {(() => {
                const inkTotal =
                  activeCostFilter === 'residential' ? residentialLandValue * (inKindPercent / 100) :
                  activeCostFilter === 'hospitality' ? hospitalityLandValue * (inKindPercent / 100) :
                  activeCostFilter === 'retail'      ? retailLandValue      * (inKindPercent / 100) :
                  (residentialLandValue + hospitalityLandValue + retailLandValue) * (inKindPercent / 100);
                if (inkTotal <= 0) return null;
                return (
                  <tr style={{ background: 'var(--color-input-bg)' }}>
                    <td style={{ fontWeight: 600, fontSize: '12px', color: 'var(--color-gold-dark)' }}>Land (In-Kind) - P0</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-gold-dark)' }}>{formatNumber(inkTotal)}</td>
                    {/* P0 column */}
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-gold-dark)' }}>({formatNumber(inkTotal)})</td>
                    {periodLabels.map((_, i) => (
                      <td key={i} style={{ textAlign: 'right', color: 'var(--color-muted)' }}>-</td>
                    ))}
                  </tr>
                );
              })()}
              {combinedSummary.map((row, ri) => (
                <tr key={ri}>
                  <td style={{ fontSize: '12px' }}>{row.name}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatNumber(row.total)}</td>
                  {/* P0 - index 0 */}
                  <td style={{ textAlign: 'right', color: row.periods[0] > 0 ? 'var(--color-gold-dark)' : 'var(--color-muted)', fontWeight: row.periods[0] > 0 ? 600 : 400 }}>
                    {row.periods[0] > 0 ? formatNumber(row.periods[0]) : '-'}
                  </td>
                  {/* P1..Pmax - index 1..N */}
                  {row.periods.slice(1).map((v, i) => (
                    <td key={i} style={{ textAlign: 'right', color: v > 0 ? 'var(--color-body)' : 'var(--color-muted)' }}>
                      {v > 0 ? formatNumber(v) : '-'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ fontWeight: 700 }}>TOTAL</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatNumber(combinedPeriodTotals.reduce((s, v) => s + v, 0))}</td>
                {/* P0 total */}
                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-gold-dark)' }}>
                  {combinedPeriodTotals[0] > 0 ? formatNumber(combinedPeriodTotals[0]) : '-'}
                </td>
                {combinedPeriodTotals.slice(1).map((v, i) => (
                  <td key={i} style={{ textAlign: 'right', fontWeight: 700 }}>{v > 0 ? formatNumber(v) : '-'}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── CAPEX Summary Excl. All Land ── */}
      {activeAssets.length > 0 && (
        <div className="module-card" style={{ padding: 'var(--sp-3)', marginTop: 'var(--sp-2)' }}>
          <h3 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-heading)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px', marginTop: 0 }}>
            CAPEX Summary - Excluding Land
          </h3>
          <p style={{ fontSize: '11px', color: 'var(--color-muted)', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
            Development costs only - excludes Land Cash and Land In-Kind
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="table-standard" style={{ minWidth: `${200 + (maxPeriods + 1) * 80}px` }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', minWidth: 140 }}>Asset</th>
                  <th style={{ textAlign: 'right', minWidth: 80 }}>P0</th>
                  {periodLabels.map((lbl, i) => (
                    <th key={i} style={{ textAlign: 'right', minWidth: 75 }}>{lbl}</th>
                  ))}
                  <th style={{ textAlign: 'right', minWidth: 100 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {capexRowsExclAllLand.map((row, ri) => {
                  const rowTotal = row.periods.reduce((s, v) => s + v, 0);
                  return (
                    <tr key={ri}>
                      <td style={{ fontWeight: 600, fontSize: '12px' }}>{row.label}</td>
                      {row.periods.slice(0, maxPeriods + 1).map((v, i) => (
                        <td key={i} style={{ textAlign: 'right', color: v > 0 ? 'var(--color-body)' : 'var(--color-muted)' }}>
                          {v > 0 ? formatNumber(v) : '-'}
                        </td>
                      ))}
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatNumber(rowTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 700 }}>TOTAL</td>
                  {capexTotalsExclAllLand.slice(0, maxPeriods + 1).map((v, i) => (
                    <td key={i} style={{ textAlign: 'right', fontWeight: 700 }}>{v > 0 ? formatNumber(v) : '-'}</td>
                  ))}
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatNumber(capexTotalsExclAllLand.reduce((s, v) => s + v, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── CAPEX Summary Excl. Land In-Kind ── */}
      {activeAssets.length > 0 && (
        <div className="module-card" style={{ padding: 'var(--sp-3)', marginTop: 'var(--sp-2)' }}>
          <h3 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-heading)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
            CAPEX Summary - Excl. Land In-Kind
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="table-standard" style={{ minWidth: `${200 + (maxPeriods + 1) * 80}px` }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', minWidth: 140 }}>Asset</th>
                  <th style={{ textAlign: 'right', minWidth: 80 }}>P0</th>
                  {periodLabels.map((lbl, i) => (
                    <th key={i} style={{ textAlign: 'right', minWidth: 75 }}>{lbl}</th>
                  ))}
                  <th style={{ textAlign: 'right', minWidth: 100 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {capexRows.map((row, ri) => {
                  const rowTotal = row.periods.reduce((s, v) => s + v, 0);
                  return (
                    <tr key={ri}>
                      <td style={{ fontWeight: 600, fontSize: '12px' }}>{row.label}</td>
                      {row.periods.slice(0, maxPeriods + 1).map((v, i) => (
                        <td key={i} style={{ textAlign: 'right', color: v > 0 ? 'var(--color-body)' : 'var(--color-muted)' }}>
                          {v > 0 ? formatNumber(v) : '-'}
                        </td>
                      ))}
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatNumber(rowTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 700 }}>TOTAL</td>
                  {capexTotalsExclLand.slice(0, maxPeriods + 1).map((v, i) => (
                    <td key={i} style={{ textAlign: 'right', fontWeight: 700 }}>{v > 0 ? formatNumber(v) : '-'}</td>
                  ))}
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatNumber(capexTotalsExclLand.reduce((s, v) => s + v, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── CAPEX Summary Incl. Land In-Kind ── */}
      {activeAssets.length > 0 && inKindPercent > 0 && (
        <div className="module-card" style={{ padding: 'var(--sp-3)', marginTop: 'var(--sp-2)' }}>
          <h3 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-heading)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
            CAPEX Summary - Incl. Land In-Kind
          </h3>
          <p style={{ fontSize: '11px', color: 'var(--color-muted)', marginBottom: 'var(--sp-2)', marginTop: 0 }}>
            In-Kind land value ({inKindPercent.toFixed(1)}%) added at Period 0 per asset
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="table-standard" style={{ minWidth: `${200 + (maxPeriods + 1) * 80}px` }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', minWidth: 140 }}>Asset</th>
                  <th style={{ textAlign: 'right', minWidth: 80 }}>P0</th>
                  {periodLabels.map((lbl, i) => (
                    <th key={i} style={{ textAlign: 'right', minWidth: 75 }}>{lbl}</th>
                  ))}
                  <th style={{ textAlign: 'right', minWidth: 100 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {capexRowsInclLand.map((row, ri) => {
                  const rowTotal = row.periods.reduce((s, v) => s + v, 0);
                  return (
                    <tr key={ri}>
                      <td style={{ fontWeight: 600, fontSize: '12px' }}>{row.label}</td>
                      {row.periods.slice(0, maxPeriods + 1).map((v, i) => (
                        <td key={i} style={{ textAlign: 'right', color: v > 0 ? 'var(--color-body)' : 'var(--color-muted)' }}>
                          {v > 0 ? formatNumber(v) : '-'}
                        </td>
                      ))}
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatNumber(rowTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 700 }}>TOTAL</td>
                  {capexTotalsInclLand.slice(0, maxPeriods + 1).map((v, i) => (
                    <td key={i} style={{ textAlign: 'right', fontWeight: 700 }}>{v > 0 ? formatNumber(v) : '-'}</td>
                  ))}
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatNumber(capexTotalsInclLand.reduce((s, v) => s + v, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
