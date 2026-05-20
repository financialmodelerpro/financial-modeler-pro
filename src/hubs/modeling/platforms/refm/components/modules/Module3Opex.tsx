'use client';

/**
 * Module3Opex.tsx
 *
 * Per-asset Operating Expense inputs. Each asset card carries an
 * asset-level Inflation panel (Off / Flat / Compound / Per-Year) plus
 * a flat list of line items. The asset-level inflation drives every
 * fixed-cost line (fixed_baseline / per_room_year / per_sqm_year)
 * that has not opted out via an individual override. %-of-revenue
 * + pct_of_gop lines never index: their auto-escalation comes from
 * the underlying revenue stream so any inflation on top would be
 * double-counted.
 *
 * Pass 3 (2026-05-19): inflation moved off per-line config and onto
 * an asset-level default with per-line override. HQ section follows
 * the same pattern (project-wide default + per-line override).
 */

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import type { Asset } from '../../lib/state/module1-types';
import {
  defaultHospitalityOpexLines,
  defaultLeaseOpexLines,
  defaultHQOpexLines,
  defaultOpexIndexation,
  type OpexLine,
  type OpexLineCategory,
  type OpexLineMode,
} from '@/src/core/calculations/opex';
import type { IndexationConfig } from '@/src/core/calculations/revenue/types';
import { AccountingNumberInput } from '../ui/AccountingNumberInput';
import { PercentageInput } from '../ui/PercentageInput';

// ─── styling primitives (mirror M2) ───────────────────────────────
const FAST_INPUT: React.CSSProperties = {
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px 6px',
  fontSize: 11,
  textAlign: 'right',
  fontFamily: 'inherit',
  width: '100%',
};
// ─── category / mode catalogs ─────────────────────────────────────
const CATEGORY_LABELS: Record<OpexLineCategory, string> = {
  direct_rooms: 'Direct, Rooms',
  direct_fb: 'Direct, F&B',
  direct_other: 'Direct, Other dept.',
  indirect_ga: 'Indirect, G&A',
  indirect_it: 'Indirect, IT',
  indirect_sm: 'Indirect, Sales & Marketing',
  indirect_pom: 'Indirect, Property Operations & Maint.',
  indirect_energy: 'Indirect, Energy',
  indirect_eosb: 'Indirect, EOSB',
  mgmt_base: 'Management, Base fee',
  mgmt_tech: 'Management, Technology fee',
  mgmt_incentive: 'Management, Incentive fee',
  replacement_reserve: 'Replacement reserve',
  rent_insurance: 'Rent & insurance',
  property_tax: 'Property tax',
  utilities: 'Utilities',
  cam: 'Service charge / CAM',
  repairs_maintenance: 'Repairs & maintenance',
  hq_payroll: 'HQ, Payroll',
  hq_office: 'HQ, Office & overheads',
  hq_professional: 'HQ, Professional fees',
  hq_other: 'HQ, Other',
  other: 'Other',
};

const MODE_LABELS: Record<OpexLineMode, string> = {
  fixed_baseline: 'Fixed (currency / year)',
  pct_of_room_rev: '% of Room Revenue',
  pct_of_fb_rev: '% of F&B Revenue',
  pct_of_other_rev: '% of Other Revenue',
  pct_of_total_rev: '% of Total Revenue',
  pct_of_lease_rev: '% of Lease Revenue',
  per_room_year: 'Per Key per Year',
  per_sqm_year: 'Per SQM per Year',
  pct_of_gop: '% of GOP',
};

// Modes valid per strategy bucket. Each strategy's UI hides modes
// that don't apply (e.g. Lease can't read room revenue).
const HOSP_MODES: OpexLineMode[] = [
  'pct_of_room_rev', 'pct_of_fb_rev', 'pct_of_other_rev', 'pct_of_total_rev',
  'per_room_year', 'fixed_baseline', 'pct_of_gop',
];
const LEASE_MODES: OpexLineMode[] = [
  'pct_of_lease_rev', 'pct_of_total_rev', 'per_sqm_year', 'fixed_baseline',
];
const HQ_MODES: OpexLineMode[] = ['fixed_baseline', 'pct_of_total_rev'];

const HOSP_CATEGORIES: OpexLineCategory[] = [
  'direct_rooms', 'direct_fb', 'direct_other',
  'indirect_ga', 'indirect_it', 'indirect_sm', 'indirect_pom', 'indirect_energy', 'indirect_eosb',
  'mgmt_base', 'mgmt_tech', 'mgmt_incentive', 'replacement_reserve',
  'rent_insurance', 'property_tax', 'utilities', 'other',
];
const LEASE_CATEGORIES: OpexLineCategory[] = [
  'mgmt_base', 'repairs_maintenance', 'rent_insurance', 'utilities',
  'cam',
  // Lease assets can also carry G&A when the owner wants to allocate
  // a portion of indirect overheads to the property (per Ahmad
  // 2026-05-20).
  'indirect_ga',
  'property_tax', 'replacement_reserve', 'other',
];
const HQ_CATEGORIES: OpexLineCategory[] = [
  'hq_payroll', 'hq_office', 'hq_professional', 'hq_other',
];

// Fixed-cost modes are the ONLY ones that take inflation. %-of-rev
// and pct_of_gop modes escalate automatically through the revenue
// stream itself, so the UI hides inflation controls for them and the
// engine ignores any indexation config they may carry.
const FIXED_COST_MODES: ReadonlyArray<OpexLineMode> = [
  'fixed_baseline', 'per_room_year', 'per_sqm_year',
];
function isFixedCostMode(m: OpexLineMode): boolean {
  return FIXED_COST_MODES.indexOf(m) >= 0;
}

// ─── utilities ────────────────────────────────────────────────────
function nid(): string {
  return `opex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultLineForStrategy(strategy: 'Hospitality' | 'Lease' | 'HQ'): OpexLine {
  if (strategy === 'Lease') {
    return {
      id: nid(),
      name: 'New line',
      category: 'other',
      mode: 'pct_of_lease_rev',
      value: 0.01,
      indexation: { method: 'none' },
    };
  }
  if (strategy === 'HQ') {
    return {
      id: nid(),
      name: 'New HQ line',
      category: 'hq_other',
      mode: 'fixed_baseline',
      value: 100000,
      indexation: { method: 'none' },
      useAssetDefault: true,
    };
  }
  return {
    id: nid(),
    name: 'New line',
    category: 'other',
    mode: 'pct_of_total_rev',
    value: 0.01,
    indexation: { method: 'none' },
  };
}

// ─── inflation method helpers ─────────────────────────────────────
type InflationMethod = 'none' | 'single_rate' | 'yoy_compound' | 'yoy_per_period';

function methodOf(config: IndexationConfig | undefined): InflationMethod {
  const m = config?.method;
  if (m === 'single_rate' || m === 'yoy_compound' || m === 'yoy_per_period') return m;
  return 'none';
}

function methodLabel(m: InflationMethod): string {
  if (m === 'none') return 'Off';
  if (m === 'single_rate') return 'Flat';
  if (m === 'yoy_compound') return 'Compound';
  return 'Per-Year';
}

function buildIndexationConfig(
  method: InflationMethod,
  prev: IndexationConfig | undefined,
  axisLength: number,
  yearCells: Array<{ idx: number; year: number }>,
): IndexationConfig {
  if (method === 'none') return { method: 'none' };
  const prevRate = (prev?.method === 'single_rate' || prev?.method === 'yoy_compound') ? (prev.rate ?? 0.03) : 0.03;
  if (method === 'single_rate') return { method: 'single_rate', rate: prevRate, startYear: 0 };
  if (method === 'yoy_compound') return { method: 'yoy_compound', rate: prevRate, startYear: 0 };
  // yoy_per_period — seed every ops year with the prior flat rate so
  // the user starts from an equivalent baseline.
  const N = Math.max(0, axisLength);
  const growth = new Array<number>(N).fill(0);
  for (const c of yearCells) {
    if (c.idx >= 0 && c.idx < N) growth[c.idx] = prevRate;
  }
  return { method: 'yoy_per_period', startYear: 0, growthPerPeriod: growth };
}

/** Short summary string used inside the "Inherits" badge. */
function summarizeIndexation(cfg: IndexationConfig | undefined): string {
  const m = methodOf(cfg);
  if (m === 'none') return 'Off';
  if (m === 'single_rate' || m === 'yoy_compound') {
    const pct = ((cfg?.rate ?? 0) * 100).toFixed(2).replace(/\.00$/, '');
    return `${methodLabel(m)} ${pct}%`;
  }
  return 'Per-Year';
}

// ─── reusable Inflation panel ─────────────────────────────────────
function InflationPanel({
  config,
  onChange,
  axisLength,
  yearCells,
  testidPrefix,
  leftLabel,
  showPerYear = true,
  compact = false,
}: {
  config: IndexationConfig | undefined;
  onChange: (next: IndexationConfig) => void;
  axisLength: number;
  yearCells: Array<{ idx: number; year: number }>;
  testidPrefix: string;
  leftLabel?: string;
  showPerYear?: boolean;
  compact?: boolean;
}): React.JSX.Element {
  const method = methodOf(config);
  const set = (m: InflationMethod): void => {
    onChange(buildIndexationConfig(m, config, axisLength, yearCells));
  };

  const setRate = (pct: number): void => {
    const m: InflationMethod = method === 'single_rate' ? 'single_rate' : 'yoy_compound';
    onChange({ method: m, rate: Math.max(0, pct / 100), startYear: 0 });
  };

  const setPerYear = (cellIdx: number, pct: number): void => {
    const N = Math.max(0, axisLength);
    const base = config?.method === 'yoy_per_period' ? (config.growthPerPeriod ?? []) : [];
    const next = new Array<number>(N).fill(0);
    for (let i = 0; i < Math.min(base.length, N); i++) next[i] = base[i] ?? 0;
    if (cellIdx >= 0 && cellIdx < N) next[cellIdx] = Math.max(-0.99, pct / 100);
    onChange({ method: 'yoy_per_period', startYear: 0, growthPerPeriod: next });
  };

  const methods: InflationMethod[] = showPerYear
    ? ['none', 'single_rate', 'yoy_compound', 'yoy_per_period']
    : ['none', 'single_rate', 'yoy_compound'];

  return (
    <div data-testid={testidPrefix}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {leftLabel && (
          <span style={{ fontSize: compact ? 10 : 11, color: 'var(--color-meta)', fontWeight: 600 }}>{leftLabel}</span>
        )}
        {methods.map((m) => {
          const active = method === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => set(m)}
              style={{
                fontSize: compact ? 10 : 11,
                padding: compact ? '3px 8px' : '4px 10px',
                background: active ? 'var(--color-navy)' : 'var(--color-surface)',
                color: active ? 'var(--color-on-primary-navy)' : 'var(--color-navy)',
                border: '1px solid var(--color-navy)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontWeight: 600,
              }}
              data-testid={`${testidPrefix}-method-${m}`}
            >
              {methodLabel(m)}
            </button>
          );
        })}
        {(method === 'single_rate' || method === 'yoy_compound') && (
          <>
            <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 4 }}>Rate %</span>
            <div style={{ width: 80 }}>
              <PercentageInput
                value={(config?.rate ?? 0) * 100}
                onChange={setRate}
                min={0}
                max={50}
                decimals={2}
                style={FAST_INPUT}
                data-testid={`${testidPrefix}-rate`}
              />
            </div>
            <span style={{ fontSize: 10, color: 'var(--color-meta)', fontStyle: 'italic' }}>
              {method === 'single_rate'
                ? 'Single uplift held flat thereafter'
                : 'Compounds: value × (1 + r) every year'}
            </span>
          </>
        )}
      </div>
      {method === 'yoy_per_period' && showPerYear && yearCells.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 10, color: 'var(--color-meta)', fontStyle: 'italic', marginBottom: 4 }}>
            Per-year inflation %. factor[y] = factor[y−1] × (1 + growth[y]). Negative values allowed.
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)' }}>
            <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                  <th style={{ padding: '4px 6px', textAlign: 'left' }}>Year</th>
                  {yearCells.map((c) => (
                    <th key={c.idx} style={{ padding: '4px 6px', textAlign: 'center' }}>{c.year}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: '4px 6px', fontWeight: 600 }}>Growth %</td>
                  {yearCells.map((c) => {
                    const v = config?.method === 'yoy_per_period'
                      ? (config.growthPerPeriod?.[c.idx] ?? 0) * 100
                      : 0;
                    return (
                      <td key={c.idx} style={{ padding: '2px 4px' }}>
                        <PercentageInput
                          value={v}
                          onChange={(n) => setPerYear(c.idx, n)}
                          min={-50}
                          max={50}
                          decimals={2}
                          style={{ ...FAST_INPUT, width: '100%' }}
                          data-testid={`${testidPrefix}-yr-${c.idx}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── shared "section card" wrapper ────────────────────────────────
function AssetCard({
  title,
  badge,
  badgeColor,
  collapsed,
  onToggle,
  children,
}: {
  title: React.ReactNode;
  badge?: string;
  badgeColor?: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        marginBottom: 'var(--sp-2)',
        background: 'var(--color-surface)',
        overflow: 'hidden',
      }}
    >
      <div
        onClick={onToggle}
        style={{
          padding: '8px 12px',
          background: 'var(--color-grey-pale)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--color-meta)' }}>{collapsed ? '▶' : '▼'}</span>
          {title}
          {badge && (
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
              background: `color-mix(in srgb, ${badgeColor ?? 'var(--color-meta)'} 14%, transparent)`,
              color: badgeColor ?? 'var(--color-meta)',
            }}>{badge}</span>
          )}
        </div>
      </div>
      {!collapsed && <div style={{ padding: 'var(--sp-2) var(--sp-3)' }}>{children}</div>}
    </div>
  );
}

// ─── line editor table ────────────────────────────────────────────
function OpexLineTable({
  lines,
  allowedCategories,
  allowedModes,
  onChange,
  testidPrefix,
  defaultIndexation,
  // Per-asset tables pass the ops window so per-line overrides can use
  // a year-by-year strip. HQ uses a full-axis cell list so HQ overrides
  // still get a strip.
  yearCells,
  axisLength,
  newLineStrategy,
}: {
  lines: OpexLine[];
  allowedCategories: OpexLineCategory[];
  allowedModes: OpexLineMode[];
  onChange: (next: OpexLine[]) => void;
  testidPrefix: string;
  defaultIndexation: IndexationConfig;
  yearCells: Array<{ idx: number; year: number }>;
  axisLength: number;
  newLineStrategy: 'Hospitality' | 'Lease' | 'HQ';
}): React.JSX.Element {
  const updateLine = (idx: number, patch: Partial<OpexLine>): void => {
    const next = lines.map((l, i) => (i === idx ? { ...l, ...patch } : l));
    onChange(next);
  };
  const removeLine = (idx: number): void => onChange(lines.filter((_, i) => i !== idx));
  const addLine = (): void => onChange([...lines, defaultLineForStrategy(newLineStrategy)]);

  const setLineMode = (idx: number, mode: OpexLineMode): void => {
    // When switching to a %-of-rev / pct_of_gop mode, clear any
    // per-line override since inflation no longer applies.
    if (!isFixedCostMode(mode)) {
      updateLine(idx, { mode, useAssetDefault: true, indexation: { method: 'none' } });
    } else {
      updateLine(idx, { mode });
    }
  };

  const enableOverride = (idx: number): void => {
    // Seed the line's own indexation from the asset default so the
    // override starts at the same effective rate the user was inheriting.
    updateLine(idx, {
      useAssetDefault: false,
      indexation: { ...defaultIndexation },
    });
  };
  const revertToInherit = (idx: number): void => {
    updateLine(idx, { useAssetDefault: true, indexation: { method: 'none' } });
  };

  const setLineIndexation = (idx: number, next: IndexationConfig): void => {
    updateLine(idx, { indexation: next });
  };

  // Pass 4: per-line Single / YoY rate-mode toggle. When switching to
  // YoY, seed yoyRates[t] with line.value for every ops year so the
  // user starts from an equivalent baseline and tweaks year by year.
  // When switching back to Single, the yoyRates array is preserved on
  // the line (cheap), but the engine ignores it.
  const setLineRateMode = (idx: number, next: 'single' | 'yoy'): void => {
    const line = lines[idx];
    if (next === 'single') {
      updateLine(idx, { rateMode: 'single' });
      return;
    }
    const N = Math.max(0, axisLength);
    const seed = Math.max(0, line.value);
    const arr = new Array<number>(N).fill(0);
    for (const c of yearCells) {
      if (c.idx >= 0 && c.idx < N) arr[c.idx] = seed;
    }
    // Going YoY revokes any per-line inflation override (override is
    // meaningless when the rate is supplied per year already).
    updateLine(idx, {
      rateMode: 'yoy',
      yoyRates: arr,
      useAssetDefault: true,
      indexation: { method: 'none' },
    });
  };

  const setYoyCell = (idx: number, cellIdx: number, rawValue: number): void => {
    const line = lines[idx];
    const N = Math.max(0, axisLength);
    const base = line.yoyRates ?? [];
    const next = new Array<number>(N).fill(0);
    for (let i = 0; i < Math.min(base.length, N); i++) next[i] = base[i] ?? 0;
    if (cellIdx >= 0 && cellIdx < N) next[cellIdx] = Math.max(0, rawValue);
    updateLine(idx, { yoyRates: next });
  };

  // Renders a mode-aware value cell. When the line is in YoY mode the
  // single Value input collapses to a small badge — the per-period
  // rate strip lives in the sub-row below.
  const renderValueInput = (line: OpexLine, idx: number): React.JSX.Element => {
    if (line.rateMode === 'yoy') {
      return (
        <span
          style={{
            fontSize: 10,
            color: 'var(--color-meta)',
            fontStyle: 'italic',
          }}
          data-testid={`${testidPrefix}-value-yoy-${idx}`}
        >
          ↓ year-by-year
        </span>
      );
    }
    const isPct = line.mode.startsWith('pct_');
    if (isPct) {
      return (
        <PercentageInput
          value={Math.max(0, line.value) * 100}
          onChange={(n) => updateLine(idx, { value: Math.max(0, Math.min(1, n / 100)) })}
          min={0}
          max={100}
          decimals={2}
          style={FAST_INPUT}
          data-testid={`${testidPrefix}-value-${idx}`}
        />
      );
    }
    return (
      <AccountingNumberInput
        value={line.value}
        onChange={(n) => updateLine(idx, { value: Math.max(0, n) })}
        scale="full"
        decimals={0}
        min={0}
        style={FAST_INPUT}
        data-testid={`${testidPrefix}-value-${idx}`}
      />
    );
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
            <th style={{ padding: '6px 8px', textAlign: 'left', minWidth: 180 }}>Line item</th>
            <th style={{ padding: '6px 8px', textAlign: 'left', minWidth: 180 }}>Category</th>
            <th style={{ padding: '6px 8px', textAlign: 'left', minWidth: 180 }}>Mode</th>
            <th style={{ padding: '6px 8px', textAlign: 'center', minWidth: 110 }}>Rate</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', minWidth: 110 }}>Value</th>
            <th style={{ padding: '6px 8px', textAlign: 'left', minWidth: 200 }}>Inflation</th>
            <th style={{ padding: '6px 8px', textAlign: 'center', minWidth: 60 }}>On</th>
            <th style={{ padding: '6px 8px', textAlign: 'center', minWidth: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, idx) => {
            const fixedMode = isFixedCostMode(l.mode);
            const inheriting = l.useAssetDefault !== false;
            const isYoy = l.rateMode === 'yoy';
            const isPct = l.mode.startsWith('pct_');
            return (
              <React.Fragment key={l.id}>
                <tr style={{ borderBottom: '1px solid var(--color-border)', opacity: l.disabled ? 0.5 : 1 }}>
                  <td style={{ padding: '4px 6px' }}>
                    <input
                      type="text"
                      value={l.name}
                      onChange={(e) => updateLine(idx, { name: e.target.value })}
                      style={{ ...FAST_INPUT, textAlign: 'left' }}
                      data-testid={`${testidPrefix}-name-${idx}`}
                    />
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <select
                      value={l.category}
                      onChange={(e) => updateLine(idx, { category: e.target.value as OpexLineCategory })}
                      style={{ ...FAST_INPUT, textAlign: 'left' }}
                      data-testid={`${testidPrefix}-cat-${idx}`}
                    >
                      {allowedCategories.map((c) => (
                        <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <select
                      value={l.mode}
                      onChange={(e) => setLineMode(idx, e.target.value as OpexLineMode)}
                      style={{ ...FAST_INPUT, textAlign: 'left' }}
                      data-testid={`${testidPrefix}-mode-${idx}`}
                    >
                      {allowedModes.map((m) => (
                        <option key={m} value={m}>{MODE_LABELS[m]}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      {(['single', 'yoy'] as const).map((m) => {
                        const active = (l.rateMode ?? 'single') === m;
                        const disabled = m === 'yoy' && yearCells.length === 0;
                        return (
                          <button
                            key={m}
                            type="button"
                            disabled={disabled}
                            onClick={() => setLineRateMode(idx, m)}
                            title={
                              disabled
                                ? 'YoY rates need an operations window first.'
                                : m === 'single'
                                  ? 'One value applied every year (Asset Inflation still applies when on).'
                                  : 'Different value each year. Engine uses your per-period rates as-is; Asset Inflation is ignored.'
                            }
                            style={{
                              fontSize: 10,
                              padding: '3px 8px',
                              background: active ? 'var(--color-navy)' : 'var(--color-surface)',
                              color: active
                                ? 'var(--color-on-primary-navy)'
                                : disabled ? 'var(--color-meta)' : 'var(--color-navy)',
                              border: '1px solid var(--color-navy)',
                              borderRadius: 'var(--radius-sm)',
                              cursor: disabled ? 'not-allowed' : 'pointer',
                              fontWeight: 600,
                              opacity: disabled ? 0.5 : 1,
                            }}
                            data-testid={`${testidPrefix}-ratemode-${m}-${idx}`}
                          >
                            {m === 'single' ? 'Single' : 'YoY'}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td style={{ padding: '4px 6px' }}>{renderValueInput(l, idx)}</td>
                  <td style={{ padding: '4px 6px' }}>
                    {!fixedMode ? (
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--color-meta)',
                          fontStyle: 'italic',
                        }}
                        title="% of revenue (and % of GOP) auto-escalate through the revenue stream itself. Adding inflation on top would double-count."
                        data-testid={`${testidPrefix}-infl-disabled-${idx}`}
                      >
                        — auto via revenue
                      </span>
                    ) : isYoy ? (
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--color-meta)',
                          fontStyle: 'italic',
                        }}
                        title="YoY rates already include per-year values, so the asset-level inflation is bypassed for this line."
                        data-testid={`${testidPrefix}-infl-yoy-${idx}`}
                      >
                        — supplied by YoY rates
                      </span>
                    ) : inheriting ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: 'var(--radius-sm)',
                            background: 'color-mix(in srgb, var(--color-navy) 12%, transparent)',
                            color: 'var(--color-navy)',
                          }}
                          title="Inherits the asset-level inflation set at the top of this card."
                        >
                          Inherits: {summarizeIndexation(defaultIndexation)}
                        </span>
                        <button
                          type="button"
                          onClick={() => enableOverride(idx)}
                          style={{
                            fontSize: 10,
                            padding: '3px 8px',
                            background: 'var(--color-surface)',
                            color: 'var(--color-navy)',
                            border: '1px solid var(--color-navy)',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                            fontWeight: 600,
                          }}
                          data-testid={`${testidPrefix}-infl-override-${idx}`}
                        >
                          Override
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: 'var(--radius-sm)',
                            background: 'color-mix(in srgb, var(--color-warning, #92400e) 16%, transparent)',
                            color: 'var(--color-warning, #92400e)',
                          }}
                          title="This line is using its own inflation config and ignoring the asset-level default."
                        >
                          Override active: {summarizeIndexation(l.indexation)}
                        </span>
                        <button
                          type="button"
                          onClick={() => revertToInherit(idx)}
                          style={{
                            fontSize: 10,
                            padding: '3px 8px',
                            background: 'var(--color-surface)',
                            color: 'var(--color-navy)',
                            border: '1px solid var(--color-navy)',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                            fontWeight: 600,
                          }}
                          data-testid={`${testidPrefix}-infl-revert-${idx}`}
                        >
                          Use asset default
                        </button>
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={!l.disabled}
                      onChange={(e) => updateLine(idx, { disabled: !e.target.checked })}
                      data-testid={`${testidPrefix}-on-${idx}`}
                    />
                  </td>
                  <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      style={{
                        background: 'transparent',
                        color: 'var(--color-danger, #b91c1c)',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 14,
                      }}
                      title="Remove line"
                      data-testid={`${testidPrefix}-remove-${idx}`}
                    >×</button>
                  </td>
                </tr>
                {fixedMode && !inheriting && !isYoy && (
                  <tr style={{ background: 'var(--color-grey-pale)' }}>
                    <td colSpan={8} style={{ padding: '6px 12px' }}>
                      <div style={{ fontSize: 10, color: 'var(--color-meta)', marginBottom: 4 }}>
                        Override inflation for <strong>{l.name}</strong>. Engine uses this configuration instead of the asset default.
                      </div>
                      <InflationPanel
                        config={l.indexation}
                        onChange={(next) => setLineIndexation(idx, next)}
                        axisLength={axisLength}
                        yearCells={yearCells}
                        testidPrefix={`${testidPrefix}-infl-${idx}`}
                        compact
                      />
                    </td>
                  </tr>
                )}
                {isYoy && yearCells.length > 0 && (
                  <tr style={{ background: 'var(--color-grey-pale)' }}>
                    <td colSpan={8} style={{ padding: '6px 12px' }}>
                      <div style={{ fontSize: 10, color: 'var(--color-meta)', marginBottom: 4 }}>
                        Per-year rates for <strong>{l.name}</strong>. Engine reads each cell directly; the asset inflation is ignored.
                        {isPct ? ' Enter as a %.' : ` Units: ${l.mode === 'per_room_year' ? 'currency per key per year' : l.mode === 'per_sqm_year' ? 'currency per sqm per year' : 'currency / year'}.`}
                      </div>
                      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)' }}>
                        <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                              <th style={{ padding: '4px 6px', textAlign: 'left' }}>Year</th>
                              {yearCells.map((c) => (
                                <th key={c.idx} style={{ padding: '4px 6px', textAlign: 'center' }}>{c.year}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td style={{ padding: '4px 6px', fontWeight: 600 }}>
                                {isPct ? 'Rate %' : 'Value'}
                              </td>
                              {yearCells.map((c) => {
                                const stored = (l.yoyRates ?? [])[c.idx] ?? 0;
                                return (
                                  <td key={c.idx} style={{ padding: '2px 4px' }}>
                                    {isPct ? (
                                      <PercentageInput
                                        value={Math.max(0, stored) * 100}
                                        onChange={(n) => setYoyCell(idx, c.idx, Math.max(0, Math.min(1, n / 100)))}
                                        min={0}
                                        max={100}
                                        decimals={2}
                                        style={{ ...FAST_INPUT, width: '100%' }}
                                        data-testid={`${testidPrefix}-yoy-yr-${idx}-${c.idx}`}
                                      />
                                    ) : (
                                      <AccountingNumberInput
                                        value={stored}
                                        onChange={(n) => setYoyCell(idx, c.idx, n)}
                                        scale="full"
                                        decimals={0}
                                        min={0}
                                        style={{ ...FAST_INPUT, width: '100%' }}
                                        data-testid={`${testidPrefix}-yoy-yr-${idx}-${c.idx}`}
                                      />
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <button
          type="button"
          onClick={addLine}
          style={{
            fontSize: 10,
            padding: '4px 10px',
            background: 'var(--color-surface)',
            color: 'var(--color-navy)',
            border: '1px solid var(--color-navy)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            fontWeight: 600,
          }}
          data-testid={`${testidPrefix}-add`}
        >+ Add line</button>
      </div>
    </div>
  );
}

// ─── main module surface ──────────────────────────────────────────
export default function Module3Opex(): React.JSX.Element {
  const { project, phases, assets, setProject, updateAsset } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      assets: s.assets,
      setProject: s.setProject,
      updateAsset: s.updateAsset,
    })),
  );

  // Per-asset + HQ collapse state.
  const [hqCollapsed, setHqCollapsed] = useState<boolean>(false);
  const [collapsedAssets, setCollapsedAssets] = useState<Record<string, boolean>>({});

  // Filter to opex-relevant assets: Hospitality (Operate, including
  // Sell + Manage companions whose strategy is 'Operate') and Lease.
  // Sell + Manage PARENTS (strategy 'Sell + Manage') have no opex —
  // their operating side lives on the companion. Pure Sell has no
  // ongoing operations. Pass 5b (2026-05-20): listed flat by asset,
  // not grouped by phase — the phase name shows on each card so users
  // still see context.
  const opexAssets = useMemo(
    () => assets.filter((a) => a.strategy === 'Operate' || a.strategy === 'Lease'),
    [assets],
  );
  const phaseNameForAsset = (a: Asset): string => {
    const p = phases.find((x) => x.id === a.phaseId);
    return p?.name ?? '';
  };

  // HQ lines + default: seeded with defaults on first read so the user
  // sees a sensible starting point. Saving only writes when the user edits.
  const hqLines: OpexLine[] = useMemo(() => {
    if (project.hqOpex?.lines && project.hqOpex.lines.length > 0) {
      return project.hqOpex.lines.map((l) => ({ ...l }));
    }
    return defaultHQOpexLines();
  }, [project.hqOpex]);
  const hqDefaultIndexation: IndexationConfig = useMemo(() => {
    const stored = project.hqOpex?.defaultIndexation as IndexationConfig | undefined;
    return stored && stored.method ? stored : defaultOpexIndexation();
  }, [project.hqOpex]);

  const setHqLines = (next: OpexLine[]): void => {
    setProject({ hqOpex: { ...(project.hqOpex ?? { lines: [] }), defaultIndexation: hqDefaultIndexation, lines: next } });
  };
  const setHqDefaultIndexation = (next: IndexationConfig): void => {
    setProject({ hqOpex: { ...(project.hqOpex ?? { lines: hqLines }), defaultIndexation: next, lines: hqLines } });
  };

  const setAssetLines = (assetId: string, next: OpexLine[]): void => {
    const a = assets.find((x) => x.id === assetId);
    const curDefault: IndexationConfig | undefined = a?.opex?.defaultIndexation as IndexationConfig | undefined;
    updateAsset(assetId, { opex: { defaultIndexation: curDefault ?? defaultOpexIndexation(), lines: next } });
  };
  const setAssetDefaultIndexation = (assetId: string, next: IndexationConfig): void => {
    const a = assets.find((x) => x.id === assetId);
    const lines = a?.opex?.lines && a.opex.lines.length > 0
      ? a.opex.lines.map((l) => ({ ...l }))
      : (a?.strategy === 'Operate'
          ? defaultHospitalityOpexLines()
          : a?.strategy === 'Lease'
            ? defaultLeaseOpexLines()
            : []);
    updateAsset(assetId, { opex: { defaultIndexation: next, lines } });
  };
  const assetDefaultIndexation = (a: Asset): IndexationConfig => {
    const stored = a.opex?.defaultIndexation as IndexationConfig | undefined;
    return stored && stored.method ? stored : defaultOpexIndexation();
  };

  const seedAsset = (a: Asset): void => {
    const seed = a.strategy === 'Operate'
      ? defaultHospitalityOpexLines()
      : a.strategy === 'Lease'
        ? defaultLeaseOpexLines()
        : [];
    if (seed.length > 0) {
      updateAsset(a.id, { opex: { defaultIndexation: defaultOpexIndexation(), lines: seed } });
    }
  };

  // Compute project axis details once so per-asset ops windows can be
  // expressed in absolute project years (lines up with engine indexing).
  const projectStartYear = useMemo(
    () => new Date(project.startDate ?? '2025-01-01').getUTCFullYear(),
    [project.startDate],
  );
  const axisLength = useMemo(() => {
    let maxEnd = 1;
    for (const p of phases) {
      const phStart = p.startDate
        ? new Date(p.startDate).getUTCFullYear()
        : projectStartYear;
      const offset = Math.max(0, phStart - projectStartYear);
      const cp = Math.max(0, p.constructionPeriods ?? 0);
      const op = Math.max(0, p.operationsPeriods ?? 0);
      maxEnd = Math.max(maxEnd, offset + cp + op);
    }
    return Math.max(1, maxEnd);
  }, [phases, projectStartYear]);

  // Full-axis cell list used for HQ Per-Year strips (HQ has no ops window).
  const fullAxisCells = useMemo<Array<{ idx: number; year: number }>>(() => {
    const out: Array<{ idx: number; year: number }> = [];
    for (let i = 0; i < axisLength; i++) out.push({ idx: i, year: projectStartYear + i });
    return out;
  }, [axisLength, projectStartYear]);

  const opsYearsForAsset = (a: Asset): Array<{ idx: number; year: number }> => {
    const phase = phases.find((p) => p.id === a.phaseId);
    if (!phase) return [];
    const phStart = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
    const offset = Math.max(0, phStart - projectStartYear);
    const cp = Math.max(0, phase.constructionPeriods ?? 0);
    const op = Math.max(0, phase.operationsPeriods ?? 0);
    const overlap = Math.max(0, phase.overlapPeriods ?? 0);
    const handoverIdx = Math.max(0, offset + cp - 1);
    const defaultOpsStart = Math.max(handoverIdx, handoverIdx + 1 - overlap);
    let opsStartIdx = defaultOpsStart;
    if (a.strategy === 'Operate') {
      const override = a.revenue?.operate?.operationsStartYearOverride;
      if (typeof override === 'number') opsStartIdx = Math.max(handoverIdx, override - projectStartYear);
    } else if (a.strategy === 'Lease') {
      const override = a.revenue?.lease?.operationsStartYearOverride;
      if (typeof override === 'number') opsStartIdx = Math.max(handoverIdx, override - projectStartYear);
    }
    const opsEndIdx = Math.min(axisLength - 1, defaultOpsStart + op - 1);
    const cells: Array<{ idx: number; year: number }> = [];
    for (let i = opsStartIdx; i <= opsEndIdx; i++) {
      cells.push({ idx: i, year: projectStartYear + i });
    }
    return cells;
  };

  // Bulk-apply: copy this asset's lines + asset-level default inflation
  // to every other asset that shares the same strategy bucket (all
  // Hospitality OR all Retail/Lease).
  const applyToStrategy = (sourceAsset: Asset): void => {
    const sourceLines = sourceAsset.opex?.lines ?? [];
    if (sourceLines.length === 0) return;
    const isHospitality = sourceAsset.strategy === 'Operate';
    const isLease = sourceAsset.strategy === 'Lease';
    if (!isHospitality && !isLease) return;
    const sourceDefault = assetDefaultIndexation(sourceAsset);
    for (const other of assets) {
      if (other.id === sourceAsset.id) continue;
      const matches = isHospitality ? other.strategy === 'Operate' : other.strategy === 'Lease';
      if (!matches) continue;
      // Fresh ids per asset so future per-asset edits don't ricochet.
      const cloned = sourceLines.map((l) => ({ ...l, id: `${l.id}-${other.id.slice(0, 6)}` }));
      updateAsset(other.id, { opex: { defaultIndexation: { ...sourceDefault }, lines: cloned } });
    }
  };

  const assetCategoriesFor = (a: Asset): OpexLineCategory[] =>
    a.strategy === 'Lease' ? LEASE_CATEGORIES : HOSP_CATEGORIES;
  const assetModesFor = (a: Asset): OpexLineMode[] =>
    a.strategy === 'Lease' ? LEASE_MODES : HOSP_MODES;
  const strategyBadge = (a: Asset): { label: string; color: string } => {
    if (a.strategy === 'Lease') return { label: 'Retail / Lease', color: 'var(--color-warning, #92400e)' };
    if (a.isCompanion === true) return { label: 'Hospitality (Manage side)', color: 'var(--color-info, #1d4ed8)' };
    return { label: 'Hospitality', color: 'var(--color-success, #166534)' };
  };

  return (
    <div data-testid="module3-opex">
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Operating Expenses</h2>
        <p style={{ fontSize: 12, color: 'var(--color-meta)' }}>
          Each asset card holds a top-level <strong>Inflation</strong> control (Off / Flat / Compound / Per-Year)
          that drives every fixed-cost line below it. <em>% of revenue</em> and <em>% of GOP</em> lines auto-escalate
          through the revenue stream, so they show <em>— auto via revenue</em>. Any fixed-cost line can
          <em> Override</em> the asset default. HQ overheads use the same pattern at the project level.
        </p>
      </div>

      {/* HQ / project-wide opex */}
      <AssetCard
        title={<span style={{ color: 'var(--color-heading)' }}>🏢 HQ &amp; Corporate Overheads</span>}
        badge="project-wide"
        badgeColor="var(--color-meta)"
        collapsed={hqCollapsed}
        onToggle={() => setHqCollapsed((v) => !v)}
      >
        <div
          style={{
            marginBottom: 'var(--sp-2)',
            padding: '6px 10px',
            background: 'var(--color-grey-pale)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
          }}
        >
          <InflationPanel
            config={hqDefaultIndexation}
            onChange={setHqDefaultIndexation}
            axisLength={axisLength}
            yearCells={fullAxisCells}
            testidPrefix="m3-hq-default-infl"
            leftLabel="HQ Inflation"
          />
        </div>
        <OpexLineTable
          lines={hqLines}
          allowedCategories={HQ_CATEGORIES}
          allowedModes={HQ_MODES}
          onChange={setHqLines}
          testidPrefix="m3-hq"
          defaultIndexation={hqDefaultIndexation}
          yearCells={fullAxisCells}
          axisLength={axisLength}
          newLineStrategy="HQ"
        />
      </AssetCard>

      {/* Per-asset opex (flat list — phase shown on each card as a tag) */}
      {opexAssets.length === 0 && (
        <div style={{
          padding: 'var(--sp-3)',
          textAlign: 'center',
          color: 'var(--color-meta)',
          background: 'var(--color-grey-pale)',
          borderRadius: 'var(--radius-sm)',
        }}>
          No operating assets yet. Add Hospitality (Operate) or Retail/Lease assets in Module 1. Sell-only and Sell + Manage parents do not carry opex.
        </div>
      )}

      {opexAssets.map((a) => {
        const collapsed = collapsedAssets[a.id] === true;
        const lines = a.opex?.lines ?? [];
        const hasLines = lines.length > 0;
        const sb = strategyBadge(a);
        const yearCells = opsYearsForAsset(a);
        const assetDefault = assetDefaultIndexation(a);
        const phaseName = phaseNameForAsset(a);
        return (
          <AssetCard
            key={a.id}
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span>{a.name}</span>
                {phaseName && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'color-mix(in srgb, var(--color-meta) 14%, transparent)',
                      color: 'var(--color-meta)',
                    }}
                    title="Phase the asset belongs to (set in Module 1)."
                  >{phaseName}</span>
                )}
              </span>
            }
            badge={sb.label}
            badgeColor={sb.color}
            collapsed={collapsed}
            onToggle={() => setCollapsedAssets((s) => ({ ...s, [a.id]: !s[a.id] }))}
          >
            {!hasLines ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 'var(--sp-2)', background: 'var(--color-grey-pale)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ fontSize: 11, color: 'var(--color-meta)' }}>
                  No opex configured yet for this asset.
                </span>
                <button
                  type="button"
                  onClick={() => seedAsset(a)}
                  style={{
                    fontSize: 10,
                    padding: '4px 10px',
                    background: 'var(--color-navy)',
                    color: 'var(--color-on-primary-navy)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                  data-testid={`m3-seed-${a.id}`}
                >
                  Seed default {a.strategy === 'Lease' ? 'Lease' : 'Hospitality'} lines
                </button>
              </div>
            ) : (
              <>
                <div
                  style={{
                    marginBottom: 'var(--sp-2)',
                    padding: '6px 10px',
                    background: 'var(--color-grey-pale)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <InflationPanel
                    config={assetDefault}
                    onChange={(next) => setAssetDefaultIndexation(a.id, next)}
                    axisLength={axisLength}
                    yearCells={yearCells}
                    testidPrefix={`m3-asset-${a.id}-default-infl`}
                    leftLabel="Asset Inflation"
                  />
                </div>
                <OpexLineTable
                  lines={lines}
                  allowedCategories={assetCategoriesFor(a)}
                  allowedModes={assetModesFor(a)}
                  onChange={(next) => setAssetLines(a.id, next)}
                  testidPrefix={`m3-asset-${a.id}`}
                  defaultIndexation={assetDefault}
                  yearCells={yearCells}
                  axisLength={axisLength}
                  newLineStrategy={a.strategy === 'Lease' ? 'Lease' : 'Hospitality'}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const label = a.strategy === 'Lease' ? 'Retail / Lease' : 'Hospitality';
                      const ok = window.confirm(
                        `Apply this asset's opex lines + asset inflation to every other ${label} asset?\n\n` +
                        `Each ${label} asset will be overwritten with the lines AND the asset-level inflation configured here. ` +
                        `This won't change HQ overheads or assets of a different strategy.`,
                      );
                      if (ok) applyToStrategy(a);
                    }}
                    style={{
                      fontSize: 10,
                      padding: '4px 10px',
                      background: 'var(--color-surface)',
                      color: 'var(--color-navy)',
                      border: '1px solid var(--color-navy)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                    title={`Copy these lines + asset inflation to every other ${a.strategy === 'Lease' ? 'Retail/Lease' : 'Hospitality'} asset.`}
                    data-testid={`m3-apply-strategy-${a.id}`}
                  >
                    Apply to all {a.strategy === 'Lease' ? 'Retail/Lease' : 'Hospitality'}
                  </button>
                </div>
              </>
            )}
          </AssetCard>
        );
      })}
    </div>
  );
}
