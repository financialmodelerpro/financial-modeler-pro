'use client';

/**
 * Module5Shared.tsx (M5 Returns, 2026-06-01)
 *
 * Small shared pieces for the two Module 5 surfaces (Returns + RE
 * Metrics): the KPI card, the assumptions panel, and metric formatters.
 * Uses the platform design tokens; no new layout primitives.
 */
import React from 'react';
import { FAST_INPUT } from './_shared/inputStyles';
import { OverrideBadge } from './_shared/OverrideBadge';

/** Format a decimal as a percentage; null -> "n/a". */
export function fmtPct(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  return `${(v * 100).toFixed(dp)}%`;
}
/** Format a multiple (MOIC / equity multiple / coverage ratios). */
export function fmtX(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  return `${v.toFixed(dp)}x`;
}
/** Format a payback / duration in years. */
export function fmtYears(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  return `${v.toFixed(dp)} yrs`;
}

export type CardTone = 'good' | 'bad' | 'neutral';

const toneColor = (tone: CardTone): string =>
  tone === 'good' ? 'var(--color-success, #166534)'
  : tone === 'bad' ? 'var(--color-warning, #92400e)'
  : 'var(--color-heading)';

/** KPI tile: bold headline value + label + optional sub-line. An optional
 *  `tooltip` adds an ⓘ affordance + native title on hover (metric definition). */
export function MetricCard(props: { label: string; value: string; sub?: string; tone?: CardTone; tooltip?: string }): React.JSX.Element {
  return (
    <div
      title={props.tooltip}
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md, 10px)',
        background: 'var(--color-surface)',
        padding: 'var(--sp-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.25 }}>
        {props.label}{props.tooltip && <span title={props.tooltip} style={{ cursor: 'help', color: 'var(--color-primary, #1d4ed8)', marginLeft: 4 }}>ⓘ</span>}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: toneColor(props.tone ?? 'neutral'), lineHeight: 1.1 }}>
        {props.value}
      </div>
      {props.sub && <div style={{ fontSize: 11, color: 'var(--color-meta)' }}>{props.sub}</div>}
    </div>
  );
}

/** Responsive KPI grid. */
export function MetricGrid(props: { children: React.ReactNode; min?: number }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${props.min ?? 150}px, 1fr))`,
        gap: 'var(--sp-2)',
        marginBottom: 'var(--sp-3)',
      }}
    >
      {props.children}
    </div>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4, color: 'var(--color-heading)' };
const selectStyle: React.CSSProperties = { ...FAST_INPUT, cursor: 'pointer' };

export interface AssumptionsValue {
  discountRatePct: number;
  exitYearOffset: number;
  terminalMethod: 'none' | 'exit_multiple' | 'perpetuity';
  exitMultiple: number;
  perpetuityGrowthPct: number;
}

/** Returns assumptions panel (discount rate / exit year / terminal value). */
export function AssumptionsPanel(props: {
  value: AssumptionsValue;
  yearLabels: number[];
  onChange: (patch: Partial<AssumptionsValue>) => void;
}): React.JSX.Element {
  const { value, yearLabels, onChange } = props;
  const numInput = (v: number, onSet: (n: number) => void, step = 0.5): React.JSX.Element => (
    <input
      type="number"
      value={Number.isFinite(v) ? v : 0}
      step={step}
      onChange={(e) => onSet(parseFloat(e.target.value))}
      style={FAST_INPUT}
    />
  );
  return (
    <section
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md, 10px)',
        background: 'var(--color-surface)',
        padding: 'var(--sp-2)',
        marginBottom: 'var(--sp-3)',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', marginBottom: 'var(--sp-2)' }}>
        Returns Assumptions
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 'var(--sp-2)', alignItems: 'end' }}>
        <div>
          <label style={labelStyle}>Discount Rate (%)<OverrideBadge path="project.returns.discountRate" /></label>
          {numInput(value.discountRatePct, (n) => onChange({ discountRatePct: Math.max(0, n) }))}
        </div>
        <div>
          <label style={labelStyle}>Exit Year</label>
          <select
            value={value.exitYearOffset}
            onChange={(e) => onChange({ exitYearOffset: parseInt(e.target.value, 10) })}
            style={selectStyle}
          >
            {yearLabels.map((y, i) => <option key={i} value={i}>{y}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Terminal Value Method</label>
          <select
            value={value.terminalMethod}
            onChange={(e) => onChange({ terminalMethod: e.target.value as AssumptionsValue['terminalMethod'] })}
            style={selectStyle}
          >
            <option value="exit_multiple">Exit Multiple</option>
            <option value="perpetuity">Perpetuity (Gordon)</option>
            <option value="none">None</option>
          </select>
        </div>
        {value.terminalMethod === 'exit_multiple' && (
          <div>
            <label style={labelStyle}>Exit Multiple (x stabilised NOI)<OverrideBadge path="project.returns.exitMultiple" /></label>
            {numInput(value.exitMultiple, (n) => onChange({ exitMultiple: Math.max(0, n) }), 0.5)}
          </div>
        )}
        {value.terminalMethod === 'perpetuity' && (
          <div>
            <label style={labelStyle}>Perpetuity Growth (%)<OverrideBadge path="project.returns.perpetuityGrowth" /></label>
            {numInput(value.perpetuityGrowthPct, (n) => onChange({ perpetuityGrowthPct: n }), 0.25)}
          </div>
        )}
      </div>
    </section>
  );
}
