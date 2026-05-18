'use client';

/**
 * Module3Opex.tsx
 *
 * Per-asset Operating Expense inputs. Layout mirrors M2 Module 2
 * Revenue: phase-grouped collapsible asset cards. Each asset that runs
 * operations (Hospitality, Lease, Sell + Manage companions) carries a
 * flat list of opex line items, each with: name + category + mode +
 * value + indexation. A separate HQ section at the top holds project-
 * wide corporate overheads.
 */

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import type { Asset, Phase } from '../../lib/state/module1-types';
import {
  defaultHospitalityOpexLines,
  defaultLeaseOpexLines,
  defaultHQOpexLines,
  type OpexLine,
  type OpexLineCategory,
  type OpexLineMode,
} from '@/src/core/calculations/opex';
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
const phaseHeaderStyle: React.CSSProperties = {
  background: 'var(--color-navy)',
  color: 'var(--color-on-primary-navy)',
  padding: 'var(--sp-2) var(--sp-3)',
  borderRadius: 'var(--radius-sm)',
  marginBottom: 'var(--sp-2)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  cursor: 'pointer',
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
  cam: 'Common area maintenance',
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
  'mgmt_base', 'cam', 'utilities', 'rent_insurance', 'property_tax', 'other',
];
const HQ_CATEGORIES: OpexLineCategory[] = [
  'hq_payroll', 'hq_office', 'hq_professional', 'hq_other',
];

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
      indexation: { method: 'yoy_compound', rate: 0.03, startYear: 0 },
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
  // Per-asset tables pass the operations window so a line can use a
  // year-by-year inflation ramp. HQ + project templates omit this and
  // only get None / Flat YoY % options.
  opsYearCells,
  axisLength,
}: {
  lines: OpexLine[];
  allowedCategories: OpexLineCategory[];
  allowedModes: OpexLineMode[];
  onChange: (next: OpexLine[]) => void;
  testidPrefix: string;
  opsYearCells?: Array<{ idx: number; year: number }>;
  axisLength?: number;
}): React.JSX.Element {
  const updateLine = (idx: number, patch: Partial<OpexLine>): void => {
    const next = lines.map((l, i) => (i === idx ? { ...l, ...patch } : l));
    onChange(next);
  };
  const removeLine = (idx: number): void => onChange(lines.filter((_, i) => i !== idx));
  const addLine = (): void => onChange([...lines, defaultLineForStrategy('Hospitality')]);

  // Indexation method changes. When switching between methods, preserve
  // intent: Off -> Flat seeds 3%; Flat -> Yearly seeds an array filled
  // with the prior flat rate so the user keeps the same total effect
  // and tweaks year-by-year afterward.
  const setIndexationMethod = (
    idx: number,
    method: 'none' | 'yoy_compound' | 'yoy_per_period',
  ): void => {
    const cur = lines[idx].indexation;
    if (method === 'none') {
      updateLine(idx, { indexation: { method: 'none' } });
      return;
    }
    if (method === 'yoy_compound') {
      const rate = cur.method === 'yoy_compound' ? (cur.rate ?? 0.03) : 0.03;
      updateLine(idx, { indexation: { method: 'yoy_compound', rate, startYear: 0 } });
      return;
    }
    // yoy_per_period: seed growthPerPeriod with the prior flat rate so
    // factor[t] starts equivalent to the flat case.
    const seedRate = cur.method === 'yoy_compound' ? (cur.rate ?? 0.03) : 0.03;
    const N = Math.max(0, axisLength ?? 0);
    const growth = new Array<number>(N).fill(0);
    if (opsYearCells) {
      for (const c of opsYearCells) {
        if (c.idx >= 0 && c.idx < N) growth[c.idx] = seedRate;
      }
    }
    updateLine(idx, { indexation: { method: 'yoy_per_period', startYear: 0, growthPerPeriod: growth } });
  };

  const setFlatRate = (idx: number, pct: number): void => {
    updateLine(idx, { indexation: { method: 'yoy_compound', rate: Math.max(0, pct / 100), startYear: 0 } });
  };

  const setPerPeriodRate = (idx: number, projectIdx: number, pct: number): void => {
    const cur = lines[idx].indexation;
    const N = Math.max(0, axisLength ?? 0);
    const base = cur.method === 'yoy_per_period' ? (cur.growthPerPeriod ?? []) : [];
    const next = new Array<number>(N).fill(0);
    for (let i = 0; i < Math.min(base.length, N); i++) next[i] = base[i] ?? 0;
    next[projectIdx] = Math.max(0, pct / 100);
    updateLine(idx, { indexation: { method: 'yoy_per_period', startYear: 0, growthPerPeriod: next } });
  };

  // Renders a mode-aware value cell: % for pct_* / pct_of_gop, raw
  // accounting number for fixed_baseline / per_room_year / per_sqm_year.
  const renderValueInput = (line: OpexLine, idx: number): React.JSX.Element => {
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
            <th style={{ padding: '6px 8px', textAlign: 'right', minWidth: 110 }}>Value</th>
            <th style={{ padding: '6px 8px', textAlign: 'left', minWidth: 130 }}>Inflation</th>
            <th style={{ padding: '6px 8px', textAlign: 'center', minWidth: 60 }}>On</th>
            <th style={{ padding: '6px 8px', textAlign: 'center', minWidth: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, idx) => {
            const method = l.indexation.method === 'yoy_compound' || l.indexation.method === 'yoy_per_period'
              ? l.indexation.method
              : 'none';
            const flatRate = l.indexation.method === 'yoy_compound'
              ? Math.round(((l.indexation.rate ?? 0) * 100) * 100) / 100
              : 0;
            const supportsPerPeriod = opsYearCells && opsYearCells.length > 0;
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
                      onChange={(e) => updateLine(idx, { mode: e.target.value as OpexLineMode })}
                      style={{ ...FAST_INPUT, textAlign: 'left' }}
                      data-testid={`${testidPrefix}-mode-${idx}`}
                    >
                      {allowedModes.map((m) => (
                        <option key={m} value={m}>{MODE_LABELS[m]}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '4px 6px' }}>{renderValueInput(l, idx)}</td>
                  <td style={{ padding: '4px 6px' }}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                      {(['none', 'yoy_compound', 'yoy_per_period'] as const).map((m) => {
                        const active = method === m;
                        const disabled = m === 'yoy_per_period' && !supportsPerPeriod;
                        const label = m === 'none' ? 'Off' : m === 'yoy_compound' ? 'Flat' : 'Yearly';
                        return (
                          <button
                            key={m}
                            type="button"
                            disabled={disabled}
                            onClick={() => setIndexationMethod(idx, m)}
                            title={disabled ? 'Yearly inflation is per-asset only (not available on HQ).' : ''}
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
                            data-testid={`${testidPrefix}-infl-${m}-${idx}`}
                          >
                            {label}
                          </button>
                        );
                      })}
                      {method === 'yoy_compound' && (
                        <PercentageInput
                          value={flatRate}
                          onChange={(n) => setFlatRate(idx, n)}
                          min={0}
                          max={50}
                          decimals={2}
                          style={{ ...FAST_INPUT, width: 60 }}
                          data-testid={`${testidPrefix}-infl-rate-${idx}`}
                        />
                      )}
                      {method === 'yoy_per_period' && supportsPerPeriod && (
                        <span style={{ fontSize: 10, color: 'var(--color-meta)', fontStyle: 'italic' }}>
                          ↓ per-year strip below
                        </span>
                      )}
                    </div>
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
                {method === 'yoy_per_period' && supportsPerPeriod && opsYearCells && (
                  <tr style={{ background: 'var(--color-grey-pale)' }}>
                    <td colSpan={7} style={{ padding: '6px 12px' }}>
                      <div style={{ fontSize: 10, color: 'var(--color-meta)', marginBottom: 4 }}>
                        Per-year inflation % for <strong>{l.name}</strong>. factor[y] = factor[y−1] × (1 + growth[y]).
                        Leave at 0% to freeze the factor for that year.
                      </div>
                      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)' }}>
                        <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                              <th style={{ padding: '4px 6px', textAlign: 'left' }}>Year</th>
                              {opsYearCells.map((c) => (
                                <th key={c.idx} style={{ padding: '4px 6px', textAlign: 'center' }}>{c.year}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td style={{ padding: '4px 6px', fontWeight: 600 }}>Growth %</td>
                              {opsYearCells.map((c) => {
                                const v = l.indexation.method === 'yoy_per_period'
                                  ? (l.indexation.growthPerPeriod?.[c.idx] ?? 0) * 100
                                  : 0;
                                return (
                                  <td key={c.idx} style={{ padding: '2px 4px' }}>
                                    <PercentageInput
                                      value={v}
                                      onChange={(n) => setPerPeriodRate(idx, c.idx, n)}
                                      min={-50}
                                      max={50}
                                      decimals={2}
                                      style={{ ...FAST_INPUT, width: '100%' }}
                                      data-testid={`${testidPrefix}-infl-yr-${idx}-${c.idx}`}
                                    />
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
  const [collapsedPhases, setCollapsedPhases] = useState<Record<string, boolean>>({});

  // Filter to opex-relevant assets: Hospitality (Operate, including
  // Sell + Manage companions whose strategy is 'Operate') and Lease.
  // Sell + Manage PARENTS (strategy 'Sell + Manage') have no opex —
  // their operating side lives on the companion. Pure Sell has no
  // ongoing operations.
  const opexAssets = useMemo(
    () => assets.filter((a) => a.strategy === 'Operate' || a.strategy === 'Lease'),
    [assets],
  );
  const assetsByPhase = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const a of opexAssets) {
      const arr = map.get(a.phaseId) ?? [];
      arr.push(a);
      map.set(a.phaseId, arr);
    }
    return map;
  }, [opexAssets]);

  // HQ lines: seeded with defaults on first read so the user sees a
  // sensible starting point. Saving only writes when the user edits.
  const hqLines: OpexLine[] = useMemo(() => {
    if (project.hqOpex?.lines && project.hqOpex.lines.length > 0) {
      return project.hqOpex.lines.map((l) => ({ ...l }));
    }
    return defaultHQOpexLines();
  }, [project.hqOpex]);

  const setHqLines = (next: OpexLine[]): void => {
    setProject({ hqOpex: { lines: next } });
  };

  const setAssetLines = (assetId: string, next: OpexLine[]): void => {
    updateAsset(assetId, { opex: { lines: next } });
  };

  const seedAsset = (a: Asset): void => {
    const seed = a.strategy === 'Operate'
      ? defaultHospitalityOpexLines()
      : a.strategy === 'Lease'
        ? defaultLeaseOpexLines()
        : [];
    if (seed.length > 0) setAssetLines(a.id, seed);
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

  // Bulk-apply: copy this asset's lines to every other asset that shares
  // the same strategy bucket (all Hospitality OR all Retail/Lease).
  const applyToStrategy = (sourceAsset: Asset): void => {
    const sourceLines = sourceAsset.opex?.lines ?? [];
    if (sourceLines.length === 0) return;
    const isHospitality = sourceAsset.strategy === 'Operate';
    const isLease = sourceAsset.strategy === 'Lease';
    if (!isHospitality && !isLease) return;
    for (const other of assets) {
      if (other.id === sourceAsset.id) continue;
      const matches = isHospitality ? other.strategy === 'Operate' : other.strategy === 'Lease';
      if (!matches) continue;
      // Fresh ids per asset so future per-asset edits don't ricochet.
      const cloned = sourceLines.map((l) => ({ ...l, id: `${l.id}-${other.id.slice(0, 6)}` }));
      updateAsset(other.id, { opex: { lines: cloned } });
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

  // Visible phases = phases with at least one opex-relevant asset.
  const visiblePhases: Phase[] = useMemo(
    () => phases.filter((p) => (assetsByPhase.get(p.id)?.length ?? 0) > 0),
    [phases, assetsByPhase],
  );

  return (
    <div data-testid="module3-opex">
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Operating Expenses</h2>
        <p style={{ fontSize: 12, color: 'var(--color-meta)' }}>
          Per-asset opex line items for Hospitality (Operate, including Sell + Manage companions) and Retail/Lease. Plus
          project-wide HQ overheads. Each line carries its own inflation method (Off, Flat YoY %, or Yearly custom for
          per-period growth). Use <em>Apply to all Hospitality / Retail</em> on any asset to push its configuration to
          every other asset of the same strategy.
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
        <OpexLineTable
          lines={hqLines}
          allowedCategories={HQ_CATEGORIES}
          allowedModes={HQ_MODES}
          onChange={setHqLines}
          testidPrefix="m3-hq"
        />
      </AssetCard>

      {/* Per-phase per-asset opex */}
      {visiblePhases.length === 0 && (
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

      {visiblePhases.map((phase) => {
        const phaseAssets = assetsByPhase.get(phase.id) ?? [];
        const phaseCollapsed = collapsedPhases[phase.id] === true;
        return (
          <div key={phase.id} style={{ marginBottom: 'var(--sp-3)' }}>
            <div
              style={phaseHeaderStyle}
              onClick={() => setCollapsedPhases((s) => ({ ...s, [phase.id]: !s[phase.id] }))}
              data-testid={`m3-phase-header-${phase.id}`}
            >
              <span>{phaseCollapsed ? '▶' : '▼'} {phase.name} ({phaseAssets.length} asset{phaseAssets.length === 1 ? '' : 's'})</span>
            </div>
            {!phaseCollapsed && phaseAssets.map((a) => {
              const collapsed = collapsedAssets[a.id] === true;
              const lines = a.opex?.lines ?? [];
              const hasLines = lines.length > 0;
              const sb = strategyBadge(a);
              return (
                <AssetCard
                  key={a.id}
                  title={<span>{a.name}</span>}
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
                      <OpexLineTable
                        lines={lines}
                        allowedCategories={assetCategoriesFor(a)}
                        allowedModes={assetModesFor(a)}
                        onChange={(next) => setAssetLines(a.id, next)}
                        testidPrefix={`m3-asset-${a.id}`}
                        opsYearCells={opsYearsForAsset(a)}
                        axisLength={axisLength}
                      />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => {
                            const label = a.strategy === 'Lease' ? 'Retail / Lease' : 'Hospitality';
                            const ok = window.confirm(
                              `Apply this asset's opex lines to every other ${label} asset?\n\n` +
                              `Each ${label} asset will be overwritten with the lines configured here. ` +
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
                          title={`Copy these lines to every other ${a.strategy === 'Lease' ? 'Retail/Lease' : 'Hospitality'} asset.`}
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
      })}
    </div>
  );
}
