'use client';

/**
 * Module2Revenue.tsx (M2 Pass 5 redesign, phase-wise + simple inline inputs)
 *
 * Pass 1 grouped assets by strategy and routed every input through a
 * 1180px modal. User feedback (2026-05-16): the layout was complex
 * and congested, the sidebar entry felt unclickable, and revenue
 * should be entered phase-wise (mirroring Module 1 Tab 2's structure).
 *
 * Pass 5 layout:
 * - Phase header bar (navy gradient, click to collapse - same visual
 *   token as Tab 2) per phase.
 * - Asset cards within each phase. Sell-strategy assets carry a
 *   simple inline form: per-sub-unit velocity row + compact cash
 *   payment profile + recognition method radio. No live preview, no
 *   multi-cohort tabs in the inline view.
 * - "Advanced..." button on each Sell asset opens the existing
 *   Module2SellModal (cohorts + escrow + indexation + price + profile
 *   overrides + live preview + reconciliation).
 * - Non-Sell strategy assets show a clean "coming soon" placeholder.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import type { Asset, SubUnit, Phase } from '../../lib/state/module1-types';
import { computeProjectTimeline, computeSubUnitArea } from '@/src/core/calculations';
import { formatArea } from '@/src/core/formatters';
import { resolveHandoverYear } from '@/src/core/calculations/revenue';
import Module2SellModal from '../modals/Module2SellModal';

const FAST_INPUT: React.CSSProperties = {
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px 4px',
  width: '100%',
  fontSize: 11,
  textAlign: 'right',
  fontFamily: 'inherit',
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

const STRATEGY_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  'Sell': { bg: 'color-mix(in srgb, var(--color-navy, #0f2e4c) 14%, transparent)', fg: 'var(--color-navy, #0f2e4c)', label: 'Residential / Sell' },
  'Operate': { bg: 'color-mix(in srgb, var(--color-success, #166534) 14%, transparent)', fg: 'var(--color-success, #166534)', label: 'Hospitality / Operate' },
  'Lease': { bg: 'color-mix(in srgb, var(--color-warning, #92400e) 14%, transparent)', fg: 'var(--color-warning, #92400e)', label: 'Retail / Office / Lease' },
  'Sell + Manage': { bg: 'color-mix(in srgb, var(--color-info, #1d4ed8) 14%, transparent)', fg: 'var(--color-info, #1d4ed8)', label: 'Sell + Manage' },
};

function paddedArray(src: number[] | undefined, length: number): number[] {
  const out = new Array<number>(length).fill(0);
  if (!src) return out;
  for (let i = 0; i < Math.min(src.length, length); i++) out[i] = src[i] ?? 0;
  return out;
}

function subUnitSummary(units: SubUnit[]): string {
  if (units.length === 0) return 'No sub-units yet';
  const totalCount = units
    .filter((u) => u.metric === 'units')
    .reduce((s, u) => s + Math.max(0, u.metricValue), 0);
  const totalArea = units.reduce((s, u) => s + computeSubUnitArea(u), 0);
  const a = totalCount > 0 ? `${Math.round(totalCount).toLocaleString('en-US')} units` : null;
  const b = totalArea > 0 ? `${formatArea(totalArea, 0)} sqm` : null;
  return [a, b].filter(Boolean).join(' · ') || 'No measurements';
}

export default function Module2Revenue(): React.JSX.Element {
  const { project, phases, assets, subUnits } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      assets: s.assets,
      subUnits: s.subUnits,
    })),
  );

  const visibleAssets = useMemo(
    () => assets.filter((a) => a.visible !== false && a.isCompanion !== true),
    [assets],
  );

  const [advancedAssetId, setAdvancedAssetId] = useState<string | null>(null);
  const advancedAsset = advancedAssetId ? assets.find((a) => a.id === advancedAssetId) : null;

  return (
    <div data-testid="module2-shell" style={{ padding: 'var(--sp-3)' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>
          Module 2 · Revenue
        </h1>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)', maxWidth: 800 }}>
          Configure revenue per phase. Each asset's revenue form follows its M1 strategy. Phase 1 (Residential / Sell) is live; other strategies follow.
        </p>
      </div>

      {visibleAssets.length === 0 && (
        <div
          data-testid="module2-no-assets"
          style={{
            padding: 'var(--sp-3)',
            background: 'var(--color-surface)',
            border: '1px dashed var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--font-small)',
          }}
        >
          No assets yet. Add assets on Module 1 · Tab 2 (Assets &amp; Sub-units), then come back to configure their revenue.
        </div>
      )}

      {phases.map((p) => (
        <PhaseSection
          key={p.id}
          phase={p}
          assets={visibleAssets.filter((a) => a.phaseId === p.id)}
          subUnits={subUnits}
          project={project}
          phases={phases}
          onOpenAdvanced={(id) => setAdvancedAssetId(id)}
        />
      ))}

      {advancedAsset && (
        <Module2SellModal
          asset={advancedAsset}
          onClose={() => setAdvancedAssetId(null)}
        />
      )}
    </div>
  );
}

// ── Phase section ─────────────────────────────────────────────────────

interface PhaseSectionProps {
  phase: Phase;
  assets: Asset[];
  subUnits: SubUnit[];
  project: ReturnType<typeof useModule1Store.getState>['project'];
  phases: Phase[];
  onOpenAdvanced: (assetId: string) => void;
}

function PhaseSection({ phase, assets, subUnits, project, phases, onOpenAdvanced }: PhaseSectionProps): React.JSX.Element {
  const collapseKey = `m2-phase-collapsed-${phase.id}`;
  const readCollapsed = (): boolean => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem(collapseKey) === 'true'; }
    catch { return false; }
  };
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  useEffect(() => {
    try { window.localStorage.setItem(collapseKey, String(collapsed)); } catch { /* noop */ }
  }, [collapsed, collapseKey]);

  return (
    <div data-testid={`m2-phase-${phase.id}`} style={{ marginBottom: 'var(--sp-3)' }}>
      <div style={phaseHeaderStyle} onClick={() => setCollapsed(!collapsed)}>
        <div>
          <strong style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{phase.name}</strong>
          <span style={{ marginLeft: 12, fontSize: 11, opacity: 0.85 }}>
            {phase.status ?? 'planning'} · {phase.constructionPeriods}p construction + {phase.operationsPeriods}p operations
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, opacity: 0.85 }} data-testid={`m2-phase-${phase.id}-asset-count`}>
            {assets.length} asset{assets.length === 1 ? '' : 's'}
          </span>
          <span style={{ fontSize: 14, opacity: 0.85 }}>{collapsed ? '▶' : '▼'}</span>
        </div>
      </div>

      {!collapsed && (
        <>
          {assets.length === 0 && (
            <div
              style={{
                background: 'var(--color-surface)',
                border: '1px dashed var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--sp-2)',
                color: 'var(--color-text-muted)',
                fontSize: 'var(--font-small)',
                fontStyle: 'italic',
              }}
            >
              No assets in {phase.name} yet. Add them on Module 1 · Tab 2.
            </div>
          )}
          {assets.map((a) => (
            <AssetCard
              key={a.id}
              asset={a}
              subUnits={subUnits.filter((u) => u.assetId === a.id)}
              phase={phase}
              project={project}
              phases={phases}
              onOpenAdvanced={() => onOpenAdvanced(a.id)}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ── Asset card with inline revenue inputs ─────────────────────────────

interface AssetCardProps {
  asset: Asset;
  subUnits: SubUnit[];
  phase: Phase;
  project: ReturnType<typeof useModule1Store.getState>['project'];
  phases: Phase[];
  onOpenAdvanced: () => void;
}

function AssetCard({ asset, subUnits, phase, project, phases, onOpenAdvanced }: AssetCardProps): React.JSX.Element {
  const updateAsset = useModule1Store((s) => s.updateAsset);
  const strategyMeta = STRATEGY_BADGE[asset.strategy ?? ''] ?? { bg: 'var(--color-surface)', fg: 'var(--color-meta)', label: asset.strategy ?? '?' };
  const isSell = asset.strategy === 'Sell';

  const timeline = useMemo(() => computeProjectTimeline(project, phases), [project, phases]);
  const totalPeriods = Math.max(1, timeline.totalPeriods);
  const projectStartYear = new Date(timeline.startDate).getUTCFullYear();
  const yearLabels = useMemo(
    () => Array.from({ length: totalPeriods }, (_, i) => projectStartYear + i),
    [totalPeriods, projectStartYear],
  );
  const phaseStartYear = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
  const handoverYear = resolveHandoverYear(
    totalPeriods,
    phaseStartYear,
    phase.constructionPeriods ?? 0,
    projectStartYear,
  );

  // Inline editing writes directly to Asset.revenue.sell.cohorts[0] when
  // this is a Sell asset. We work against a single-cohort view; the
  // Advanced modal exposes the full multi-cohort + escrow + indexation
  // surface and any extra cohorts the user added there stay on save.
  const sellConfig = asset.revenue?.sell;
  const cohort0 = sellConfig?.cohorts?.[0];

  const updateSellInline = (patch: Partial<NonNullable<Asset['revenue']>['sell']>): void => {
    const baseCohorts = sellConfig?.cohorts && sellConfig.cohorts.length > 0
      ? sellConfig.cohorts
      : [{ id: `cohort_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
           name: 'Cohort 1',
           subUnits: subUnits.map((su) => ({
             subUnitId: su.id,
             preSalesVelocity: new Array<number>(totalPeriods).fill(0),
             postSalesVelocity: new Array<number>(totalPeriods).fill(0),
           })) }];

    const nextSell = {
      assetId: asset.id,
      subUnits: sellConfig?.subUnits ?? subUnits.map((su) => ({
        subUnitId: su.id,
        preSalesVelocity: new Array<number>(totalPeriods).fill(0),
        postSalesVelocity: new Array<number>(totalPeriods).fill(0),
      })),
      cashPaymentProfile: sellConfig?.cashPaymentProfile ?? {
        percentages: new Array<number>(totalPeriods).fill(0),
        profileMode: 'absolute_with_catchup' as const,
      },
      recognitionProfile: sellConfig?.recognitionProfile ?? {
        method: 'point_in_time' as const,
        pointInTimeYear: 'handover' as const,
      },
      escrow: sellConfig?.escrow ?? { enabled: false, heldPct: 0.04, releaseYear: handoverYear },
      indexation: sellConfig?.indexation ?? { method: 'none' as const },
      handoverYearOverride: sellConfig?.handoverYearOverride,
      cohorts: baseCohorts,
      ...patch,
    };
    updateAsset(asset.id, { revenue: { ...(asset.revenue ?? {}), sell: nextSell } });
  };

  const setCohortVelocity = (subUnitId: string, periodIdx: number, pct: number): void => {
    const baseCohorts = (sellConfig?.cohorts && sellConfig.cohorts.length > 0)
      ? sellConfig.cohorts
      : [{ id: `cohort_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
           name: 'Cohort 1',
           subUnits: subUnits.map((su) => ({
             subUnitId: su.id,
             preSalesVelocity: new Array<number>(totalPeriods).fill(0),
             postSalesVelocity: new Array<number>(totalPeriods).fill(0),
           })) }];

    const nextCohorts = baseCohorts.map((c, i) => {
      if (i !== 0) return c;
      const ensuredSubs = subUnits.map((su) => {
        const existing = c.subUnits.find((s) => s.subUnitId === su.id);
        return {
          subUnitId: su.id,
          preSalesVelocity: paddedArray(existing?.preSalesVelocity, totalPeriods),
          postSalesVelocity: paddedArray(existing?.postSalesVelocity, totalPeriods),
        };
      });
      return {
        ...c,
        subUnits: ensuredSubs.map((s) => {
          if (s.subUnitId !== subUnitId) return s;
          const next = [...s.preSalesVelocity];
          next[periodIdx] = Math.max(0, Math.min(1, pct / 100));
          return { ...s, preSalesVelocity: next };
        }),
      };
    });
    updateSellInline({ cohorts: nextCohorts });
  };

  const setCashPct = (periodIdx: number, pct: number): void => {
    const next = paddedArray(sellConfig?.cashPaymentProfile?.percentages, totalPeriods);
    next[periodIdx] = Math.max(0, Math.min(1, pct / 100));
    updateSellInline({
      cashPaymentProfile: {
        percentages: next,
        positions: sellConfig?.cashPaymentProfile?.positions,
        profileMode: sellConfig?.cashPaymentProfile?.profileMode ?? 'absolute_with_catchup',
      },
    });
  };

  const setRecognitionMethod = (method: 'point_in_time' | 'over_time'): void => {
    updateSellInline({
      recognitionProfile: {
        method,
        pointInTimeYear: sellConfig?.recognitionProfile?.pointInTimeYear ?? 'handover',
        percentages: method === 'over_time'
          ? sellConfig?.recognitionProfile?.percentages ?? new Array<number>(totalPeriods).fill(0)
          : undefined,
        positions: sellConfig?.recognitionProfile?.positions,
        profileMode: sellConfig?.recognitionProfile?.profileMode ?? 'absolute_with_catchup',
      },
    });
  };

  // Single-cohort view of velocity. When the user has multiple cohorts
  // (set in the Advanced modal), the inline grid sums them for display
  // and a chip warns "Multi-cohort - edit in Advanced".
  const totalCohorts = sellConfig?.cohorts?.length ?? 0;
  const multiCohortMode = totalCohorts > 1;
  const inlineCohort = cohort0;

  const cashSum = (sellConfig?.cashPaymentProfile?.percentages ?? []).reduce((s, v) => s + v, 0);
  const cashSumOk = Math.abs(cashSum - 1) < 0.005;

  return (
    <div
      data-testid={`m2-asset-${asset.id}`}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--sp-2)',
        marginBottom: 'var(--sp-1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: isSell ? 'var(--sp-2)' : 0, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14, color: 'var(--color-heading)' }}>{asset.name}</strong>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          padding: '2px 8px',
          background: strategyMeta.bg,
          color: strategyMeta.fg,
          borderRadius: 'var(--radius-sm)',
        }}>
          {strategyMeta.label}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-meta)' }}>
          {subUnitSummary(subUnits)}
        </span>
        {isSell && multiCohortMode && (
          <span style={{ fontSize: 10, color: 'var(--color-warning, #92400e)', fontWeight: 600, padding: '2px 8px', background: 'color-mix(in srgb, var(--color-warning, #92400e) 12%, transparent)', borderRadius: 'var(--radius-sm)' }}>
            {totalCohorts} cohorts · edit in Advanced
          </span>
        )}
        {isSell && (
          <button
            type="button"
            onClick={onOpenAdvanced}
            data-testid={`m2-asset-${asset.id}-advanced`}
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              padding: '4px 10px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              color: 'var(--color-navy)',
              fontWeight: 600,
            }}
          >
            Advanced (cohorts · escrow · indexation · preview)
          </button>
        )}
      </div>

      {!isSell && (
        <div style={{
          padding: '6px 10px',
          background: 'var(--color-surface-alt, #f3f4f6)',
          border: '1px dashed var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-muted)',
          fontSize: 11,
          fontStyle: 'italic',
        }}>
          Revenue form for {strategyMeta.label} ships in a later pass.
        </div>
      )}

      {isSell && subUnits.length === 0 && (
        <div style={{
          padding: '6px 10px',
          background: 'var(--color-surface-alt, #f3f4f6)',
          border: '1px dashed var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-muted)',
          fontSize: 11,
          fontStyle: 'italic',
        }}>
          Add sub-units on Module 1 · Tab 2 to enter sales velocity here.
        </div>
      )}

      {isSell && subUnits.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>

          {/* Sales velocity per sub-unit (single-cohort inline view) */}
          <InlineSection
            title="Sales velocity (% per year)"
            hint={`Sum per sub-unit <= 100%. Residual rolls into post-handover. Handover at ${yearLabels[handoverYear]}.`}
          >
            <InlineGrid
              yearLabels={yearLabels}
              handoverYear={handoverYear}
              rows={subUnits.map((su) => {
                const cfgSU = inlineCohort?.subUnits.find((s) => s.subUnitId === su.id);
                const pre = cfgSU?.preSalesVelocity ?? [];
                const sum = pre.reduce((s, v) => s + v, 0);
                return {
                  id: su.id,
                  label: su.name || 'sub-unit',
                  hint: `${su.category} · ${su.metric === 'units' ? `${Math.max(0, su.metricValue).toLocaleString()} units` : `${formatArea(computeSubUnitArea(su), 0)} sqm`}${sum > 0 ? ` · sold ${(sum * 100).toFixed(0)}%` : ''}`,
                  sumOver: sum > 1 + 1e-6,
                  values: pre,
                  onChange: (i, pct) => setCohortVelocity(su.id, i, pct),
                };
              })}
              disabled={multiCohortMode}
            />
          </InlineSection>

          {/* Cash payment profile + recognition method on one row */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--sp-2)' }}>
            <InlineSection
              title="Cash payment profile (% per year)"
              hint="Profile is positioned in absolute project years. Cohort sold in year N catches up cumulative through N at N then per profile in later years."
              tag={`Sum: ${(cashSum * 100).toFixed(1)}%`}
              tagColor={cashSumOk ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)'}
            >
              <InlineProfileStrip
                yearLabels={yearLabels}
                handoverYear={handoverYear}
                values={sellConfig?.cashPaymentProfile?.percentages ?? []}
                onChange={setCashPct}
              />
            </InlineSection>

            <InlineSection title="Recognition" hint="">
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <MethodPill
                  active={sellConfig?.recognitionProfile?.method !== 'over_time'}
                  label="Point-in-Time"
                  onClick={() => setRecognitionMethod('point_in_time')}
                />
                <MethodPill
                  active={sellConfig?.recognitionProfile?.method === 'over_time'}
                  label="Over-Time"
                  onClick={() => setRecognitionMethod('over_time')}
                />
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic' }}>
                {sellConfig?.recognitionProfile?.method === 'over_time'
                  ? 'Over-Time profile + escrow + indexation in Advanced.'
                  : `Lumps at handover (${yearLabels[handoverYear]}).`}
              </div>
            </InlineSection>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small inline subcomponents ────────────────────────────────────────

function InlineSection({ title, hint, tag, tagColor, children }: { title: string; hint?: string; tag?: string; tagColor?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-heading)' }}>
          {title}
        </div>
        {tag && (
          <span style={{ fontSize: 10, fontWeight: 700, color: tagColor ?? 'var(--color-meta)' }}>
            {tag}
          </span>
        )}
      </div>
      {children}
      {hint && (
        <div style={{ fontSize: 9, color: 'var(--color-text-muted)', fontStyle: 'italic', marginTop: 3 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

interface InlineGridRow {
  id: string;
  label: string;
  hint: string;
  sumOver: boolean;
  values: number[];
  onChange: (periodIdx: number, pct: number) => void;
}

function InlineGrid({ yearLabels, handoverYear, rows, disabled }: { yearLabels: number[]; handoverYear: number; rows: InlineGridRow[]; disabled?: boolean }): React.JSX.Element {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
      <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--color-surface-alt, #f3f4f6)' }}>
            <th style={{ padding: '4px 6px', textAlign: 'left', position: 'sticky', left: 0, background: 'var(--color-surface-alt, #f3f4f6)' }}>Sub-unit</th>
            {yearLabels.map((y, i) => (
              <th
                key={i}
                style={{
                  padding: '4px 6px',
                  textAlign: 'center',
                  minWidth: 50,
                  color: i === handoverYear ? 'var(--color-info, #1d4ed8)' : 'var(--color-body)',
                  fontWeight: i === handoverYear ? 700 : 600,
                }}
                title={i === handoverYear ? `Handover ${y}` : String(y)}
              >
                {y}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ padding: '4px 6px', position: 'sticky', left: 0, background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }}>
                <div style={{ fontWeight: 700, color: 'var(--color-heading)' }}>{r.label}</div>
                <div style={{ fontSize: 9, color: r.sumOver ? 'var(--color-warning, #92400e)' : 'var(--color-meta)' }}>
                  {r.hint}{r.sumOver ? ' ⚠ over 100%' : ''}
                </div>
              </td>
              {yearLabels.map((_, i) => (
                <td key={i} style={{ padding: '2px 3px', textAlign: 'center' }}>
                  <input
                    type="number"
                    value={Math.round((r.values[i] ?? 0) * 10000) / 100}
                    onChange={(e) => r.onChange(i, Number(e.target.value) || 0)}
                    style={FAST_INPUT}
                    step={1}
                    min={0}
                    max={100}
                    disabled={disabled}
                    title={disabled ? 'Multi-cohort mode - edit in Advanced' : ''}
                    data-testid={`m2-vel-${r.id}-${i}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InlineProfileStrip({ yearLabels, handoverYear, values, onChange }: { yearLabels: number[]; handoverYear: number; values: number[]; onChange: (i: number, pct: number) => void }): React.JSX.Element {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
      <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--color-surface-alt, #f3f4f6)' }}>
            {yearLabels.map((y, i) => (
              <th
                key={i}
                style={{
                  padding: '4px 6px',
                  textAlign: 'center',
                  minWidth: 50,
                  color: i === handoverYear ? 'var(--color-info, #1d4ed8)' : 'var(--color-body)',
                  fontWeight: i === handoverYear ? 700 : 600,
                }}
              >
                {y}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {yearLabels.map((_, i) => (
              <td key={i} style={{ padding: '2px 3px', textAlign: 'center' }}>
                <input
                  type="number"
                  value={Math.round((values[i] ?? 0) * 10000) / 100}
                  onChange={(e) => onChange(i, Number(e.target.value) || 0)}
                  style={FAST_INPUT}
                  step={1}
                  min={0}
                  max={100}
                  data-testid={`m2-cash-${i}`}
                />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function MethodPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 10px',
        background: active ? 'var(--color-navy)' : 'var(--color-surface)',
        color: active ? 'var(--color-on-primary-navy)' : 'var(--color-body)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 11,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
