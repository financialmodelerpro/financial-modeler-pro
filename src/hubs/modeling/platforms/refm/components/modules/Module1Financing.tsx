'use client';

/**
 * Module1Financing.tsx (M2.0 Tab 4)
 *
 * Per-phase financing tranches + equity contributions. Each tranche
 * picks one of 5 drawdown methods × 3 repayment methods, with optional
 * IDC capitalization and cash-sweep parameters.
 *
 * MAAD-Spec: financing math is per-tranche (multiple tranches per
 * phase supported, e.g. senior + mezz). The summary panel rolls up
 * total debt / equity / interest across all tranches in the active
 * phase.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import {
  type FinancingTranche,
  type DrawdownMethod,
  type RepaymentMethod,
  type EquityContribution,
  type EquityTiming,
  DRAWDOWN_METHODS,
  REPAYMENT_METHODS,
  EQUITY_TIMINGS,
} from '../../lib/state/module1-types';
import {
  computePhaseCost,
  computeFinancing,
  distribute,
} from '@/src/core/calculations';
import InputLabel from '../ui/InputLabel';

const inputStyle: React.CSSProperties = {
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--sp-1)',
  fontSize: 'var(--font-body)',
  width: '100%',
};

const calcOutputStyle: React.CSSProperties = {
  background: 'var(--color-grey-pale)',
  color: 'var(--color-heading)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--sp-1)',
  fontSize: 'var(--font-body)',
};

const sectionCardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
  padding: 'var(--sp-3)',
  marginBottom: 'var(--sp-3)',
};

const fmt = (n: number, digits = 0): string =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : 'n/a';

const DRAWDOWN_LABELS: Record<DrawdownMethod, string> = {
  sameAsCost: 'Same as cost curve',
  evenOverPhase: 'Even over phase',
  frontloaded: 'Frontloaded (S-curve)',
  backloaded: 'Backloaded (S-curve)',
  manual: 'Manual schedule',
};

const REPAYMENT_LABELS: Record<RepaymentMethod, string> = {
  fixedSchedule: 'Fixed schedule (straight-line principal)',
  cashSweep: 'Cash sweep',
  bullet: 'Bullet (interest-only + principal at maturity)',
};

const EQUITY_TIMING_LABELS: Record<EquityTiming, string> = {
  upfront: 'Upfront (period 1)',
  evenOverPhase: 'Even over phase',
  manual: 'Manual schedule',
};

export default function Module1Financing(): React.JSX.Element {
  const {
    project,
    phases,
    activePhaseId,
    setActivePhaseId,
    parcels,
    assets,
    subUnits,
    costLines,
    financingTranches,
    equityContributions,
    addFinancingTranche,
    updateFinancingTranche,
    removeFinancingTranche,
    addEquityContribution,
    updateEquityContribution,
    removeEquityContribution,
  } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      activePhaseId: s.activePhaseId,
      setActivePhaseId: s.setActivePhaseId,
      parcels: s.parcels,
      assets: s.assets,
      subUnits: s.subUnits,
      costLines: s.costLines,
      financingTranches: s.financingTranches,
      equityContributions: s.equityContributions,
      addFinancingTranche: s.addFinancingTranche,
      updateFinancingTranche: s.updateFinancingTranche,
      removeFinancingTranche: s.removeFinancingTranche,
      addEquityContribution: s.addEquityContribution,
      updateEquityContribution: s.updateEquityContribution,
      removeEquityContribution: s.removeEquityContribution,
    })),
  );

  const activePhase = phases.find((p) => p.id === activePhaseId) ?? phases[0];
  const phaseId = activePhase?.id ?? phases[0]?.id ?? '';
  const phaseTranches = useMemo(
    () => financingTranches.filter((t) => t.phaseId === phaseId),
    [financingTranches, phaseId],
  );
  const phaseEquity = useMemo(
    () => equityContributions.filter((e) => e.phaseId === phaseId),
    [equityContributions, phaseId],
  );
  const breakdown = useMemo(() => {
    if (!activePhase) return null;
    return computePhaseCost(activePhase, costLines, parcels, assets, subUnits);
  }, [activePhase, costLines, parcels, assets, subUnits]);

  // Build per-period capex curve for the phase using the cost lines'
  // distribution. For simplicity here, approximate the curve by
  // distributing each line's total via its phasing across construction.
  const capexCurve = useMemo(() => {
    if (!activePhase || !breakdown) return [] as number[];
    const cp = activePhase.constructionPeriods;
    const out = new Array<number>(cp).fill(0);
    for (const line of costLines.filter((c) => c.phaseId === activePhase.id)) {
      const total = breakdown.byLine[line.key];
      if (total <= 0) continue;
      const w = distribute(line.phasing, cp, line.distribution);
      for (let i = 0; i < cp; i++) out[i] += total * w[i];
    }
    return out;
  }, [activePhase, breakdown, costLines]);

  const financingResults = useMemo(() => {
    if (!activePhase) return [];
    return phaseTranches.map((t) => ({
      tranche: t,
      result: computeFinancing(t, activePhase, capexCurve, project.modelType),
    }));
  }, [activePhase, phaseTranches, capexCurve, project.modelType]);

  const totalDebt = financingResults.reduce((s, f) => s + f.result.totalDebt, 0);
  const totalInterest = financingResults.reduce((s, f) => s + f.result.totalInterest, 0);
  const totalEquity = phaseEquity.reduce((s, e) => s + e.amount, 0);
  const totalCapex = breakdown?.total ?? 0;
  const equityFromGap = Math.max(0, totalCapex - totalDebt);

  if (!activePhase) {
    return <div data-testid="tab-financing-empty">No phases configured.</div>;
  }

  const handleAddTranche = (): void => {
    addFinancingTranche({
      id: `tranche_${Date.now()}`,
      phaseId,
      name: phaseTranches.length === 0 ? 'Senior debt' : `Tranche ${phaseTranches.length + 1}`,
      ltvPct: 60,
      interestRatePct: 7.5,
      drawdownMethod: 'sameAsCost',
      repaymentMethod: 'fixedSchedule',
      repaymentPeriods: 60,
      idcCapitalize: true,
    });
  };

  const handleAddEquity = (): void => {
    addEquityContribution({
      id: `equity_${Date.now()}`,
      phaseId,
      name: `Equity ${phaseEquity.length + 1}`,
      amount: 0,
      timing: 'upfront',
    });
  };

  return (
    <div data-testid="tab-financing">
      <h2 style={{ fontSize: 'var(--font-h2)', marginBottom: 'var(--sp-3)' }}>4. Financing</h2>

      <div
        style={{
          background: 'var(--color-primary-pale)',
          border: '1px solid var(--color-primary)',
          borderRadius: 'var(--radius)',
          padding: 'var(--sp-2)',
          marginBottom: 'var(--sp-3)',
          fontSize: 'var(--font-small)',
        }}
        data-testid="tab4-callout"
      >
        <strong>What goes here:</strong> Debt tranches and equity contributions
        per phase. Multiple tranches supported (e.g. senior + mezzanine).
        Each tranche picks a drawdown curve, a repayment method, an interest
        rate, and whether interest during construction is capitalised.
      </div>

      {phases.length > 1 && (
        <div style={{ marginBottom: 'var(--sp-2)' }}>
          <InputLabel label="Active Phase" help="Switch which phase you're editing." inputId="financing-active-phase" />
          <select
            id="financing-active-phase"
            data-testid="financing-active-phase"
            value={phaseId}
            onChange={(e) => setActivePhaseId(e.target.value)}
            style={{ ...inputStyle, maxWidth: 320 }}
          >
            {phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={sectionCardStyle} data-testid="tranches-section">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--sp-2)',
          }}
        >
          <h3 style={{ fontSize: 'var(--font-h3)', margin: 0 }}>Debt tranches</h3>
          <button
            type="button"
            onClick={handleAddTranche}
            data-testid="add-tranche"
            className="btn-primary"
            style={{ padding: 'var(--sp-1) var(--sp-2)', fontSize: 'var(--font-small)' }}
          >
            + Add Tranche
          </button>
        </div>
        {phaseTranches.length === 0 && (
          <div
            style={{
              padding: 'var(--sp-2)',
              fontSize: 'var(--font-small)',
              color: 'var(--color-meta)',
            }}
            data-testid="tranches-empty"
          >
            No tranches yet. Add at least one to model debt.
          </div>
        )}
        {phaseTranches.map((tranche) => {
          const result = financingResults.find((f) => f.tranche.id === tranche.id)?.result;
          return (
            <TrancheCard
              key={tranche.id}
              tranche={tranche}
              currency={project.currency}
              totalDebt={result?.totalDebt ?? 0}
              totalInterest={result?.totalInterest ?? 0}
              periodicRate={result?.periodicRate ?? 0}
              onUpdate={(patch) => updateFinancingTranche(tranche.id, patch)}
              onRemove={() => removeFinancingTranche(tranche.id)}
            />
          );
        })}
      </div>

      <div style={sectionCardStyle} data-testid="equity-section">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--sp-2)',
          }}
        >
          <h3 style={{ fontSize: 'var(--font-h3)', margin: 0 }}>Equity contributions</h3>
          <button
            type="button"
            onClick={handleAddEquity}
            data-testid="add-equity"
            className="btn-primary"
            style={{ padding: 'var(--sp-1) var(--sp-2)', fontSize: 'var(--font-small)' }}
          >
            + Add Equity
          </button>
        </div>
        {phaseEquity.map((equity) => (
          <EquityRow
            key={equity.id}
            equity={equity}
            currency={project.currency}
            onUpdate={(patch) => updateEquityContribution(equity.id, patch)}
            onRemove={() => removeEquityContribution(equity.id)}
          />
        ))}
      </div>

      <div style={sectionCardStyle} data-testid="financing-summary">
        <h3 style={{ fontSize: 'var(--font-h3)', margin: 0, marginBottom: 'var(--sp-2)' }}>
          Phase summary
        </h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 'var(--sp-2)',
            fontSize: 'var(--font-small)',
          }}
        >
          <div data-testid="summary-total-capex">
            <strong>Total CapEx:</strong>{' '}
            <span style={calcOutputStyle}>{fmt(totalCapex)} {project.currency}</span>
          </div>
          <div data-testid="summary-total-debt">
            <strong>Total Debt:</strong>{' '}
            <span style={calcOutputStyle}>{fmt(totalDebt)} {project.currency}</span>
          </div>
          <div data-testid="summary-total-interest">
            <strong>Total Interest:</strong>{' '}
            <span style={calcOutputStyle}>{fmt(totalInterest)} {project.currency}</span>
          </div>
          <div data-testid="summary-total-equity">
            <strong>Total Equity (explicit):</strong>{' '}
            <span style={calcOutputStyle}>{fmt(totalEquity)} {project.currency}</span>
          </div>
          <div data-testid="summary-equity-gap">
            <strong>Equity from gap (CapEx, Debt):</strong>{' '}
            <span style={calcOutputStyle}>{fmt(equityFromGap)} {project.currency}</span>
          </div>
          <div data-testid="summary-blended-ltv">
            <strong>Blended LTV:</strong>{' '}
            <span style={calcOutputStyle}>
              {fmt(totalCapex > 0 ? (totalDebt / totalCapex) * 100 : 0, 1)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface TrancheCardProps {
  tranche: FinancingTranche;
  currency: string;
  totalDebt: number;
  totalInterest: number;
  periodicRate: number;
  onUpdate: (patch: Partial<FinancingTranche>) => void;
  onRemove: () => void;
}

function TrancheCard({
  tranche,
  currency,
  totalDebt,
  totalInterest,
  periodicRate,
  onUpdate,
  onRemove,
}: TrancheCardProps): React.JSX.Element {
  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        padding: 'var(--sp-2)',
        marginBottom: 'var(--sp-2)',
      }}
      data-testid={`tranche-card-${tranche.id}`}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--sp-2)',
        }}
      >
        <div>
          <InputLabel label="Tranche Name" help="Free-text label." inputId={`tranche-${tranche.id}-name`} />
          <input
            id={`tranche-${tranche.id}-name`}
            data-testid={`tranche-${tranche.id}-name`}
            type="text"
            value={tranche.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div>
          <InputLabel label="LTV %" help="Loan-to-Value: % of phase CapEx funded by this tranche." inputId={`tranche-${tranche.id}-ltv`} />
          <input
            id={`tranche-${tranche.id}-ltv`}
            data-testid={`tranche-${tranche.id}-ltv`}
            type="number"
            min={0}
            max={100}
            value={tranche.ltvPct}
            onChange={(e) => onUpdate({ ltvPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
            style={inputStyle}
          />
        </div>
        <div>
          <InputLabel label="Interest Rate %" help="Annual interest rate. Divided by 12 for monthly model." inputId={`tranche-${tranche.id}-rate`} />
          <input
            id={`tranche-${tranche.id}-rate`}
            data-testid={`tranche-${tranche.id}-rate`}
            type="number"
            min={0}
            step={0.1}
            value={tranche.interestRatePct}
            onChange={(e) => onUpdate({ interestRatePct: Math.max(0, Number(e.target.value) || 0) })}
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-1)' }}>
          <label style={{ fontSize: 'var(--font-small)', display: 'inline-flex', gap: 6 }}>
            <input
              type="checkbox"
              checked={tranche.idcCapitalize}
              data-testid={`tranche-${tranche.id}-idc`}
              onChange={(e) => onUpdate({ idcCapitalize: e.target.checked })}
            />
            Capitalize IDC
          </label>
          <button
            type="button"
            onClick={onRemove}
            data-testid={`tranche-${tranche.id}-remove`}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: 'var(--font-micro)',
            }}
          >
            Remove
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--sp-2)',
        }}
      >
        <div>
          <InputLabel label="Drawdown Method" help="How the tranche draws funds across construction." inputId={`tranche-${tranche.id}-drawdown`} />
          <select
            id={`tranche-${tranche.id}-drawdown`}
            data-testid={`tranche-${tranche.id}-drawdown`}
            value={tranche.drawdownMethod}
            onChange={(e) => onUpdate({ drawdownMethod: e.target.value as DrawdownMethod })}
            style={inputStyle}
          >
            {DRAWDOWN_METHODS.map((m) => (
              <option key={m} value={m}>
                {DRAWDOWN_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <InputLabel label="Repayment Method" help="Fixed schedule = straight-line principal. Cash sweep = surplus cash repays. Bullet = interest-only + lump at maturity." inputId={`tranche-${tranche.id}-repayment`} />
          <select
            id={`tranche-${tranche.id}-repayment`}
            data-testid={`tranche-${tranche.id}-repayment`}
            value={tranche.repaymentMethod}
            onChange={(e) => onUpdate({ repaymentMethod: e.target.value as RepaymentMethod })}
            style={inputStyle}
          >
            {REPAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {REPAYMENT_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <InputLabel label="Repayment Periods" help="How many periods principal is repaid over (or maturity period for bullet)." inputId={`tranche-${tranche.id}-repaymentPeriods`} />
          <input
            id={`tranche-${tranche.id}-repaymentPeriods`}
            data-testid={`tranche-${tranche.id}-repaymentPeriods`}
            type="number"
            min={0}
            value={tranche.repaymentPeriods}
            onChange={(e) => onUpdate({ repaymentPeriods: Math.max(0, Number(e.target.value) || 0) })}
            style={inputStyle}
          />
        </div>
      </div>

      {tranche.repaymentMethod === 'cashSweep' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 'var(--sp-2)',
            marginBottom: 'var(--sp-2)',
          }}
        >
          <div>
            <InputLabel label="Sweep Start Period" help="Sweep begins this many periods after operations start. 0 = continuous from ops start." inputId={`tranche-${tranche.id}-sweepStart`} />
            <input
              id={`tranche-${tranche.id}-sweepStart`}
              data-testid={`tranche-${tranche.id}-sweepStart`}
              type="number"
              min={0}
              value={tranche.sweepStartPeriod ?? 0}
              onChange={(e) => onUpdate({ sweepStartPeriod: Math.max(0, Number(e.target.value) || 0) })}
              style={inputStyle}
            />
          </div>
          <div>
            <InputLabel label="Cash Floor %" help="% of period cash retained before sweep applies." inputId={`tranche-${tranche.id}-cashFloor`} />
            <input
              id={`tranche-${tranche.id}-cashFloor`}
              data-testid={`tranche-${tranche.id}-cashFloor`}
              type="number"
              min={0}
              max={100}
              value={tranche.cashFloorPct ?? 0}
              onChange={(e) => onUpdate({ cashFloorPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              style={inputStyle}
            />
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 'var(--sp-2)',
          fontSize: 'var(--font-small)',
        }}
      >
        <div data-testid={`tranche-${tranche.id}-totalDebt`}>
          <strong>Total Debt:</strong>{' '}
          <span style={calcOutputStyle}>{fmt(totalDebt)} {currency}</span>
        </div>
        <div data-testid={`tranche-${tranche.id}-totalInterest`}>
          <strong>Total Interest:</strong>{' '}
          <span style={calcOutputStyle}>{fmt(totalInterest)} {currency}</span>
        </div>
        <div data-testid={`tranche-${tranche.id}-periodicRate`}>
          <strong>Periodic Rate:</strong>{' '}
          <span style={calcOutputStyle}>{fmt(periodicRate * 100, 4)}%</span>
        </div>
      </div>
    </div>
  );
}

interface EquityRowProps {
  equity: EquityContribution;
  currency: string;
  onUpdate: (patch: Partial<EquityContribution>) => void;
  onRemove: () => void;
}

function EquityRow({ equity, currency, onUpdate, onRemove }: EquityRowProps): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1.5fr 1fr 1.2fr 60px',
        gap: 'var(--sp-2)',
        marginBottom: 'var(--sp-1)',
        fontSize: 'var(--font-small)',
        alignItems: 'center',
      }}
      data-testid={`equity-row-${equity.id}`}
    >
      <input
        type="text"
        value={equity.name}
        data-testid={`equity-${equity.id}-name`}
        onChange={(e) => onUpdate({ name: e.target.value })}
        style={inputStyle}
      />
      <input
        type="number"
        min={0}
        value={equity.amount}
        data-testid={`equity-${equity.id}-amount`}
        onChange={(e) => onUpdate({ amount: Math.max(0, Number(e.target.value) || 0) })}
        style={inputStyle}
        placeholder={currency}
      />
      <select
        value={equity.timing}
        data-testid={`equity-${equity.id}-timing`}
        onChange={(e) => onUpdate({ timing: e.target.value as EquityTiming })}
        style={inputStyle}
      >
        {EQUITY_TIMINGS.map((t) => (
          <option key={t} value={t}>
            {EQUITY_TIMING_LABELS[t]}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onRemove}
        data-testid={`equity-${equity.id}-remove`}
        style={{
          background: 'transparent',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '2px 6px',
          cursor: 'pointer',
          fontSize: 'var(--font-micro)',
        }}
      >
        x
      </button>
    </div>
  );
}
