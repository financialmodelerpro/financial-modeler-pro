'use client';

/**
 * Module1Financing.tsx (v6 schema, M2.0c rebuild)
 *
 * Full pre-M2.0 functionality restored:
 *   - 5 drawdown methods (capex_basis / manual / debt_equity_ratio /
 *     capex_minus_presales / min_cash_floor)
 *   - 5 repayment methods (manual / straight_line / cashsweep_continuous
 *     / cashsweep_from_period / cashsweep_min_cash)
 *   - IDC capitalization toggle
 *   - Per-asset financing detail (tranche.assetId optional)
 *   - Per-phase tranche grouping
 *   - Period-by-period drawdown + repayment + balance schedule
 *   - Total interest paid display + debt summary
 *   - Granularity-aware (annual / monthly), follows project.modelType
 *   - Equity contributions (per-phase, three timing modes)
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import {
  type FinancingTranche,
  type DrawdownMethod,
  type RepaymentMethod,
  type EquityContribution,
  DRAWDOWN_METHODS,
  DRAWDOWN_METHOD_LABELS,
  REPAYMENT_METHODS,
  REPAYMENT_METHOD_LABELS,
  EQUITY_TIMINGS,
  makeDefaultFinancingTranche,
} from '../../lib/state/module1-types';
import { computePhaseCost, computeFinancing, resolveAssetAreaMetrics } from '@/src/core/calculations';
import { currencyHeaderLine, formatNumber } from '@/src/core/formatters';

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

function getPeriodLabel(idx: number, projectStart: string, modelType: 'monthly' | 'annual'): string {
  if (idx === 0) return 'P0';
  if (modelType === 'annual') return `Y${idx}`;
  const d = new Date(projectStart);
  if (Number.isNaN(d.getTime())) return `M${idx}`;
  d.setMonth(d.getMonth() + (idx - 1));
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

interface TrancheCardProps {
  tranche: FinancingTranche;
  phase: { id: string; name: string; constructionPeriods: number; operationsPeriods: number; overlapPeriods: number; constructionStart: number };
  capexPerPeriod: number[];
  presalesPerPeriod: number[];
  project: Parameters<typeof computeFinancing>[4];
  onUpdate: (patch: Partial<FinancingTranche>) => void;
  onRemove: () => void;
  assets: Array<{ id: string; name: string }>;
}

function TrancheCard({
  tranche, phase, capexPerPeriod, presalesPerPeriod, project,
  onUpdate, onRemove, assets,
}: TrancheCardProps): React.JSX.Element {
  const result = useMemo(
    () => computeFinancing(tranche, phase, capexPerPeriod, presalesPerPeriod, project),
    [tranche, phase, capexPerPeriod, presalesPerPeriod, project],
  );

  const isCashSweep = tranche.repaymentMethod.startsWith('cashsweep');
  const periodCount = Math.min(result.periods, 24);
  const periodLabels = Array.from({ length: periodCount }, (_, i) => getPeriodLabel(i + 1, project.startDate, project.modelType));
  const draws = result.drawSchedule.slice(0, periodCount);
  const balances = result.outstandingBalance.slice(0, periodCount);
  const interest = result.interestAccrued.slice(0, periodCount);
  const principal = result.principalRepaid.slice(0, periodCount);

  return (
    <div style={sectionCardStyle} data-testid={`tranche-${tranche.id}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <input
          type="text"
          value={tranche.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          style={{ ...inputStyle, fontSize: 14, fontWeight: 700, maxWidth: 300 }}
          data-testid={`tranche-${tranche.id}-name`}
        />
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
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>LTV %</label>
          <input
            type="number" min={0} max={100}
            value={tranche.ltvPct}
            onChange={(e) => onUpdate({ ltvPct: parseFloat(e.target.value) || 0 })}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-ltv`}
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
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Repayment Periods</label>
          <input
            type="number" min={0}
            value={tranche.repaymentPeriods}
            onChange={(e) => onUpdate({ repaymentPeriods: parseInt(e.target.value) || 0 })}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-rep-periods`}
          />
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Per-Asset</label>
          <select
            value={tranche.assetId ?? ''}
            onChange={(e) => onUpdate({ assetId: e.target.value || undefined })}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-asset`}
          >
            <option value="">Phase-wide</option>
            {assets.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
          </select>
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
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Repayment Method</label>
          <select
            value={tranche.repaymentMethod}
            onChange={(e) => onUpdate({ repaymentMethod: e.target.value as RepaymentMethod })}
            style={inputStyle}
            data-testid={`tranche-${tranche.id}-repayment`}
          >
            {REPAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{REPAYMENT_METHOD_LABELS[m]}</option>
            ))}
          </select>
          {tranche.repaymentMethod === 'cashsweep_from_period' && (
            <input
              type="number" min={0}
              placeholder="Sweep start period"
              value={tranche.sweepStartPeriod ?? 0}
              onChange={(e) => onUpdate({ sweepStartPeriod: parseInt(e.target.value) || 0 })}
              style={{ ...inputStyle, marginTop: 4 }}
              data-testid={`tranche-${tranche.id}-sweep-start`}
            />
          )}
          {tranche.repaymentMethod === 'cashsweep_min_cash' && (
            <input
              type="number" min={0}
              placeholder="Min cash floor"
              value={tranche.sweepMinCashFloor ?? 0}
              onChange={(e) => onUpdate({ sweepMinCashFloor: parseFloat(e.target.value) || 0 })}
              style={{ ...inputStyle, marginTop: 4 }}
              data-testid={`tranche-${tranche.id}-sweep-floor`}
            />
          )}
        </div>
      </div>

      <label style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={tranche.idcCapitalize}
          onChange={(e) => onUpdate({ idcCapitalize: e.target.checked })}
          data-testid={`tranche-${tranche.id}-idc`}
        />
        Capitalize interest during construction (IDC)
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
        <div style={calcOutputStyle}>
          <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>Total Debt</div>
          <div style={{ fontSize: 14, fontWeight: 700 }} data-testid={`tranche-${tranche.id}-total-debt`}>
            {formatNumber(result.totalDebt)}
          </div>
        </div>
        <div style={calcOutputStyle}>
          <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>Total Interest</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {formatNumber(result.totalInterest)}
          </div>
        </div>
        <div style={calcOutputStyle}>
          <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>Total Repayment</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {formatNumber(result.totalRepayment)}
          </div>
        </div>
        <div style={calcOutputStyle}>
          <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>Periodic Rate</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {(result.periodicRate * 100).toFixed(4)}%
          </div>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={{ padding: '4px 6px', textAlign: 'left' }}>Schedule</th>
              {periodLabels.map((p, i) => (
                <th key={i} style={{ padding: '4px 6px', textAlign: 'right' }}>{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '4px 6px', fontWeight: 600 }}>Drawdown</td>
              {draws.map((v, i) => (<td key={i} style={{ padding: '4px 6px', textAlign: 'right' }} data-testid={`tranche-${tranche.id}-draw-${i + 1}`}>{formatNumber(v)}</td>))}
            </tr>
            <tr>
              <td style={{ padding: '4px 6px', fontWeight: 600 }}>Interest</td>
              {interest.map((v, i) => (<td key={i} style={{ padding: '4px 6px', textAlign: 'right' }}>{formatNumber(v)}</td>))}
            </tr>
            <tr>
              <td style={{ padding: '4px 6px', fontWeight: 600 }}>Principal Repaid</td>
              {principal.map((v, i) => (<td key={i} style={{ padding: '4px 6px', textAlign: 'right' }}>{formatNumber(v)}</td>))}
            </tr>
            <tr>
              <td style={{ padding: '4px 6px', fontWeight: 600 }}>Outstanding Balance</td>
              {balances.map((v, i) => (<td key={i} style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 700 }} data-testid={`tranche-${tranche.id}-balance-${i + 1}`}>{formatNumber(v)}</td>))}
            </tr>
          </tbody>
        </table>
      </div>
      {isCashSweep && (
        <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 6 }}>
          Cash sweep approximated as straight-line over remaining periods until Module 3 supplies real cashflow surplus per period (M2.1).
        </div>
      )}
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
  const addFinancingTranche = useModule1Store((s) => s.addFinancingTranche);
  const updateFinancingTranche = useModule1Store((s) => s.updateFinancingTranche);
  const removeFinancingTranche = useModule1Store((s) => s.removeFinancingTranche);
  const addEquityContribution = useModule1Store((s) => s.addEquityContribution);
  const updateEquityContribution = useModule1Store((s) => s.updateEquityContribution);
  const removeEquityContribution = useModule1Store((s) => s.removeEquityContribution);

  const phase = phases.find((p) => p.id === activePhaseId) ?? phases[0];
  const phaseAssets = useMemo(
    () => assets.filter((a) => a.phaseId === phase?.id && a.visible),
    [assets, phase?.id],
  );

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

  const totalDebtAcrossTranches = phaseTranches.reduce((s, t) => {
    const r = computeFinancing(t, phase, capexPerPeriod, presalesPerPeriod, project);
    return s + r.totalDebt;
  }, 0);
  const totalInterestAcross = phaseTranches.reduce((s, t) => {
    const r = computeFinancing(t, phase, capexPerPeriod, presalesPerPeriod, project);
    return s + r.totalInterest;
  }, 0);
  const totalCashEquity = phaseEquity.reduce((s, e) => s + (e.amount || 0), 0);
  // M2.0d Fix 8: in-kind equity = sum of in-kind land value across this
  // phase's visible assets (allocation already resolved per landAllocationMode).
  // Each asset's inKindLandValue tracks its share of parcels.inKindValue
  // and is the equity-in-kind contribution that funds its capex without
  // a cash outflow.
  const totalInKindEquity = phaseAssets.reduce((s, a) => {
    const m = resolveAssetAreaMetrics(a, project, parcels, phaseAssets, subUnits, landAllocationMode);
    return s + Math.max(0, m.inKindLandValue);
  }, 0);
  const totalEquity = totalCashEquity + totalInKindEquity;

  const handleAddTranche = (): void => {
    const id = `tranche-${Date.now()}`;
    const t = makeDefaultFinancingTranche(id, phase.id);
    t.repaymentPeriods = Math.max(1, phase.operationsPeriods);
    addFinancingTranche(t);
  };

  const handleAddEquity = (): void => {
    const c: EquityContribution = {
      id: `equity-${Date.now()}`,
      phaseId: phase.id,
      name: 'Sponsor Equity',
      amount: 0,
      timing: 'upfront',
    };
    addEquityContribution(c);
  };

  return (
    <div data-testid="module1-financing">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 'var(--sp-2)', flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--font-h2)', fontWeight: 'var(--fw-bold)' }}>4. Financing</h2>
          <div style={{ color: 'var(--color-meta)', fontSize: 12 }}>
            Granularity: <strong>{project.modelType}</strong> · Total span: {phase.constructionPeriods + phase.operationsPeriods - phase.overlapPeriods} {project.modelType === 'annual' ? 'years' : 'months'}
          </div>
          {/* M2.0h Fix 2 (2026-05-07): single currency / scale header line per tab. */}
          <div
            style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', fontStyle: 'italic', marginTop: 4 }}
            data-testid="currency-header-line"
          >
            {currencyHeaderLine(project.currency, project.displayScale ?? 'full')}
          </div>
        </div>
        <select
          value={phase.id}
          onChange={(e) => setActivePhaseId(e.target.value)}
          style={inputStyle}
          data-testid="financing-phase-select"
        >
          {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 'var(--sp-1)', marginBottom: 'var(--sp-2)' }}>
        <div style={{ ...sectionCardStyle, marginBottom: 0, padding: 12 }} data-testid="financing-summary-capex">
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Phase CapEx</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{formatNumber(phaseCost.total)}</div>
        </div>
        <div style={{ ...sectionCardStyle, marginBottom: 0, padding: 12 }} data-testid="financing-summary-debt">
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Total Debt</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{formatNumber(totalDebtAcrossTranches)}</div>
        </div>
        <div style={{ ...sectionCardStyle, marginBottom: 0, padding: 12 }} data-testid="financing-summary-cash-equity">
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Cash Equity</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{formatNumber(totalCashEquity)}</div>
          <div style={{ fontSize: 9, color: 'var(--color-meta)' }}>Manual contributions</div>
        </div>
        <div style={{ ...sectionCardStyle, marginBottom: 0, padding: 12 }} data-testid="financing-summary-inkind-equity">
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>In-Kind Equity</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{formatNumber(totalInKindEquity)}</div>
          <div style={{ fontSize: 9, color: 'var(--color-meta)' }}>Auto from in-kind land</div>
        </div>
        <div style={{ ...sectionCardStyle, marginBottom: 0, padding: 12 }} data-testid="financing-summary-interest">
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-meta)', textTransform: 'uppercase' }}>Total Interest</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{formatNumber(totalInterestAcross)}</div>
        </div>
      </div>
      <div style={{ ...sectionCardStyle, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} data-testid="financing-equity-summary">
        <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)' }}>
          Equity Summary, Cash + In-Kind
        </strong>
        <strong style={{ fontSize: 14 }} data-testid="financing-equity-summary-total">
          {formatNumber(totalEquity)}
        </strong>
      </div>

      <div style={{ marginBottom: 'var(--sp-2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong style={{ fontSize: 13 }}>Debt Tranches ({phaseTranches.length})</strong>
          <button type="button" className="btn-primary" onClick={handleAddTranche} style={{ fontSize: 11, padding: '4px 10px' }} data-testid="financing-add-tranche">
            + Add Tranche
          </button>
        </div>
        {phaseTranches.length === 0 && (
          <div style={{ ...sectionCardStyle, color: 'var(--color-meta)', textAlign: 'center' }}>
            No tranches yet. Add one to size debt.
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
            onUpdate={(patch) => updateFinancingTranche(t.id, patch)}
            onRemove={() => removeFinancingTranche(t.id)}
            assets={phaseAssets.map((a) => ({ id: a.id, name: a.name }))}
          />
        ))}
      </div>

      <div style={sectionCardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong style={{ fontSize: 13 }}>Equity Contributions ({phaseEquity.length})</strong>
          <button type="button" className="btn-secondary" onClick={handleAddEquity} style={{ fontSize: 11, padding: '4px 10px' }} data-testid="financing-add-equity">
            + Add Equity
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
                <th style={{ padding: '4px 6px', textAlign: 'right' }}>Amount</th>
                <th style={{ padding: '4px 6px', textAlign: 'left' }}>Timing</th>
                <th style={{ padding: '4px 6px' }}></th>
              </tr>
            </thead>
            <tbody>
              {phaseEquity.map((e) => (
                <tr key={e.id} data-testid={`equity-${e.id}`}>
                  <td style={{ padding: '4px' }}>
                    <input type="text" value={e.name} onChange={(ev) => updateEquityContribution(e.id, { name: ev.target.value })} style={inputStyle} />
                  </td>
                  <td style={{ padding: '4px' }}>
                    <input type="number" value={e.amount} onChange={(ev) => updateEquityContribution(e.id, { amount: parseFloat(ev.target.value) || 0 })} style={inputStyle} />
                  </td>
                  <td style={{ padding: '4px' }}>
                    <select value={e.timing} onChange={(ev) => updateEquityContribution(e.id, { timing: ev.target.value as EquityContribution['timing'] })} style={inputStyle}>
                      {EQUITY_TIMINGS.map((t) => (<option key={t} value={t}>{t}</option>))}
                    </select>
                  </td>
                  <td style={{ padding: '4px', width: 60 }}>
                    <button type="button" onClick={() => removeEquityContribution(e.id)} style={{ ...inputStyle, background: 'transparent', cursor: 'pointer', color: 'var(--color-negative)' }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
