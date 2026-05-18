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
}: {
  lines: OpexLine[];
  allowedCategories: OpexLineCategory[];
  allowedModes: OpexLineMode[];
  onChange: (next: OpexLine[]) => void;
  testidPrefix: string;
}): React.JSX.Element {
  const updateLine = (idx: number, patch: Partial<OpexLine>): void => {
    const next = lines.map((l, i) => (i === idx ? { ...l, ...patch } : l));
    onChange(next);
  };
  const removeLine = (idx: number): void => onChange(lines.filter((_, i) => i !== idx));
  const addLine = (): void => onChange([...lines, defaultLineForStrategy('Hospitality')]);
  const updateIndexation = (idx: number, method: 'none' | 'yoy_compound', rate: number): void => {
    const patch: Partial<OpexLine> = method === 'none'
      ? { indexation: { method: 'none' } }
      : { indexation: { method: 'yoy_compound', rate: Math.max(0, rate / 100), startYear: 0 } };
    updateLine(idx, patch);
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
            const inflRate = l.indexation.method === 'yoy_compound'
              ? Math.round(((l.indexation.rate ?? 0) * 100) * 100) / 100
              : 0;
            return (
              <tr key={l.id} style={{ borderBottom: '1px solid var(--color-border)', opacity: l.disabled ? 0.5 : 1 }}>
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
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={l.indexation.method === 'yoy_compound'}
                      onChange={(e) => updateIndexation(idx, e.target.checked ? 'yoy_compound' : 'none', inflRate)}
                      data-testid={`${testidPrefix}-infl-on-${idx}`}
                    />
                    {l.indexation.method === 'yoy_compound' && (
                      <PercentageInput
                        value={inflRate}
                        onChange={(n) => updateIndexation(idx, 'yoy_compound', n)}
                        min={0}
                        max={50}
                        decimals={2}
                        style={{ ...FAST_INPUT, width: 60 }}
                        data-testid={`${testidPrefix}-infl-rate-${idx}`}
                      />
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

  // Filter to opex-relevant assets (skip Sell-only).
  const opexAssets = useMemo(() => assets.filter((a) => a.strategy !== 'Sell'), [assets]);
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
    const seed = (a.strategy === 'Operate' || a.strategy === 'Sell + Manage')
      ? defaultHospitalityOpexLines()
      : a.strategy === 'Lease'
        ? defaultLeaseOpexLines()
        : [];
    if (seed.length > 0) setAssetLines(a.id, seed);
  };

  const assetCategoriesFor = (a: Asset): OpexLineCategory[] =>
    a.strategy === 'Lease' ? LEASE_CATEGORIES : HOSP_CATEGORIES;
  const assetModesFor = (a: Asset): OpexLineMode[] =>
    a.strategy === 'Lease' ? LEASE_MODES : HOSP_MODES;
  const strategyBadge = (a: Asset): { label: string; color: string } => {
    if (a.strategy === 'Lease') return { label: 'Retail / Lease', color: 'var(--color-warning, #92400e)' };
    if (a.strategy === 'Sell + Manage') return { label: 'Sell + Manage', color: 'var(--color-info, #1d4ed8)' };
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
          Per-asset opex line items (direct departmental, indirect undistributed, management fees, replacement reserve,
          fixed charges). Plus project-wide HQ overheads. Engine evaluates each line over the asset&apos;s operations window.
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
          No operating assets yet. Add Hospitality (Operate), Lease, or Sell + Manage assets in Module 1.
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
                    <OpexLineTable
                      lines={lines}
                      allowedCategories={assetCategoriesFor(a)}
                      allowedModes={assetModesFor(a)}
                      onChange={(next) => setAssetLines(a.id, next)}
                      testidPrefix={`m3-asset-${a.id}`}
                    />
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
