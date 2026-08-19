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

/** Small status pill (Pass / Breach / neutral note) using the covenant palette. */
function StatusPill(props: { text: string; tone: CardTone }): React.JSX.Element {
  const [bg, fg] = props.tone === 'good'
    ? ['var(--color-success-bg, #dcfce7)', 'var(--color-success, #166534)']
    : props.tone === 'bad'
      ? ['var(--color-warning-bg, #fef3c7)', 'var(--color-warning, #92400e)']
      : ['var(--color-grey-pale, #f3f4f6)', 'var(--color-meta)'];
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 12, background: bg, color: fg, whiteSpace: 'nowrap' }}>{props.text}</span>;
}

/** KPI tile: bold headline value + label + optional sub-line. An optional
 *  `tooltip` adds an ⓘ affordance + native title on hover (metric definition).
 *  `size: 'hero'` enlarges the tile for the decision-first strip at the top;
 *  `badge` shows a Pass / Breach pill next to the value where a threshold exists. */
export function MetricCard(props: { label: string; value: string; sub?: string; tone?: CardTone; tooltip?: string; size?: 'hero'; badge?: { text: string; tone: CardTone } }): React.JSX.Element {
  const hero = props.size === 'hero';
  return (
    <div
      title={props.tooltip}
      style={{
        border: hero ? '1px solid var(--color-navy, #1e293b)' : '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md, 10px)',
        background: 'var(--color-surface)',
        padding: hero ? 'var(--sp-3)' : 'var(--sp-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: hero ? 4 : 2,
        minWidth: 0,
        boxShadow: hero ? '0 1px 3px rgba(15,23,42,0.08)' : undefined,
      }}
    >
      <div style={{ fontSize: hero ? 12 : 11, fontWeight: hero ? 700 : 600, color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.25 }}>
        {props.label}{props.tooltip && <span title={props.tooltip} style={{ cursor: 'help', color: 'var(--color-primary, #1d4ed8)', marginLeft: 4 }}>ⓘ</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: hero ? 30 : 20, fontWeight: 800, color: toneColor(props.tone ?? 'neutral'), lineHeight: 1.05 }}>
          {props.value}
        </div>
        {props.badge && <StatusPill text={props.badge.text} tone={props.badge.tone} />}
      </div>
      {props.sub && <div style={{ fontSize: 11, color: 'var(--color-meta)' }}>{props.sub}</div>}
    </div>
  );
}

/** Collapsible detail section (native disclosure, design-token styled) used to
 *  demote low-signal metric groups below the decision-first hero + centrepieces. */
export function CollapsibleSection(props: { title: string; defaultOpen?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <details open={props.defaultOpen} style={{ marginBottom: 'var(--sp-3)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--sp-2)' }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', padding: '2px 0', userSelect: 'none' }}>
        {props.title}
      </summary>
      <div style={{ marginTop: 'var(--sp-2)' }}>{props.children}</div>
    </details>
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
  terminalMethod: 'none' | 'exit_multiple' | 'perpetuity' | 'cap_rate';
  exitMultiple: number;
  perpetuityGrowthPct: number;
  /** The exit cap rate as a PERCENT, resolved (derived or manual). */
  capRatePct: number;
  /** `r - g` as a percent, so the panel can show what the model would use even
   *  while an override is in force. */
  capRateDerivedPct: number;
  capRateOverride: boolean;
  /** Grow the exit metric by (1 + g) before capitalising. */
  applyGrowthToTerminal: boolean;
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
            <option value="cap_rate">Exit Cap Rate</option>
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
        {(value.terminalMethod === 'perpetuity' || value.terminalMethod === 'cap_rate') && (
          <div>
            <label style={labelStyle}>Growth g (%)<OverrideBadge path="project.returns.perpetuityGrowth" /></label>
            {numInput(value.perpetuityGrowthPct, (n) => onChange({ perpetuityGrowthPct: n }), 0.25)}
          </div>
        )}
        {/* THE EXIT CAP RATE (2026-08-19). Derived as WACC less growth unless the
            user types one, so a project that never touches it follows the two
            rates it is made of instead of freezing a number that goes stale.
            Shown whenever the cap rate is the valuation basis. */}
        {value.terminalMethod === 'cap_rate' && (
          <div>
            <label style={labelStyle}>
              Exit Cap Rate (%)<OverrideBadge path="project.returns.capRate" />
            </label>
            {numInput(
              value.capRateOverride ? value.capRatePct : value.capRateDerivedPct,
              (n) => onChange({ capRatePct: Math.max(0, n), capRateOverride: true }),
              0.25,
            )}
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 2 }}>
              {value.capRateOverride ? (
                <>
                  Set by you. <button
                    type="button"
                    data-testid="returns-cap-rate-use-derived"
                    onClick={() => onChange({ capRateOverride: false })}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-navy)', cursor: 'pointer', textDecoration: 'underline', fontSize: 10 }}
                  >Use WACC less growth ({value.capRateDerivedPct.toFixed(2)}%)</button>
                </>
              ) : (
                <>WACC less growth: {value.discountRatePct.toFixed(2)}% - {value.perpetuityGrowthPct.toFixed(2)}% = {value.capRateDerivedPct.toFixed(2)}%. Type to override.</>
              )}
            </div>
          </div>
        )}
        {/* THE FORWARD-INCOME TOGGLE. A capitalisation is conventionally applied
            to NEXT year's income, and that step used to be buried inside the
            Gordon formula as a literal (1 + g), invisible and unavailable to the
            other methods. */}
        {value.terminalMethod !== 'none' && (
          <div>
            <label style={labelStyle}>
              Terminal metric<OverrideBadge path="project.returns.applyGrowthToTerminal" />
            </label>
            <select
              value={value.applyGrowthToTerminal ? 'forward' : 'current'}
              data-testid="returns-apply-growth"
              onChange={(e) => onChange({ applyGrowthToTerminal: e.target.value === 'forward' })}
              style={selectStyle}
            >
              <option value="current">Exit year as is</option>
              <option value="forward">Grown by (1 + g)</option>
            </select>
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 2 }}>
              {value.applyGrowthToTerminal
                ? `Capitalises forward income: exit metric x (1 + ${value.perpetuityGrowthPct.toFixed(2)}%).`
                : 'Capitalises the exit year figure itself.'}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
