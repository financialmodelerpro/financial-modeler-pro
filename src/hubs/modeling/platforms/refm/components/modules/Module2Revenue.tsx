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
import { formatArea, formatAccounting } from '@/src/core/formatters';
import { PercentageInput } from '../ui/PercentageInput';
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

  // Asset-level collapse per [[feedback_ui_universal_defaults]] rule 4.
  const assetCollapseKey = `m2-input-asset-collapsed-${asset.id}`;
  const readAssetCollapsed = (): boolean => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem(assetCollapseKey) === 'true'; }
    catch { return false; }
  };
  const [assetCollapsed, setAssetCollapsed] = useState<boolean>(readAssetCollapsed);
  useEffect(() => {
    try { window.localStorage.setItem(assetCollapseKey, String(assetCollapsed)); } catch { /* noop */ }
  }, [assetCollapsed, assetCollapseKey]);

  const timeline = useMemo(() => computeProjectTimeline(project, phases), [project, phases]);
  const totalPeriods = Math.max(1, timeline.totalPeriods);
  const projectStartYear = new Date(timeline.startDate).getUTCFullYear();
  const yearLabels = useMemo(
    () => Array.from({ length: totalPeriods }, (_, i) => projectStartYear + i),
    [totalPeriods, projectStartYear],
  );
  const phaseStartYear = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
  // Pass 6 (2026-05-16): per-asset windows anchored to the phase. The
  // asset's revenue inputs only show the years where activity can occur:
  //   Pre-Sales window = phase construction years (phaseStart .. handover).
  //   Post-Sales window = phase operations years (handover+1 .. opsEnd),
  //   minus phase overlap.
  // Cash profile window = construction start to operations end (the
  // active span where milestones can fall).
  const cp = Math.max(0, phase.constructionPeriods ?? 0);
  const op = Math.max(0, phase.operationsPeriods ?? 0);
  const overlap = Math.max(0, phase.overlapPeriods ?? 0);
  const constructionStartIdx = Math.max(0, Math.min(totalPeriods - 1, phaseStartYear - projectStartYear));
  const handoverYear = Math.max(constructionStartIdx, Math.min(totalPeriods - 1, constructionStartIdx + cp - 1));
  const operationsStartIdx = Math.max(constructionStartIdx, Math.min(totalPeriods - 1, handoverYear + 1 - overlap));
  const operationsEndIdx = Math.max(operationsStartIdx, Math.min(totalPeriods - 1, operationsStartIdx + op - 1));

  type WindowCell = { idx: number; year: number; isHandover: boolean };
  const constructionWindow: WindowCell[] = cp > 0
    ? Array.from({ length: Math.max(0, handoverYear - constructionStartIdx + 1) }, (_, k) => {
        const idx = constructionStartIdx + k;
        return { idx, year: projectStartYear + idx, isHandover: idx === handoverYear };
      })
    : [];
  const operationsWindow: WindowCell[] = op > 0
    ? Array.from({ length: Math.max(0, operationsEndIdx - operationsStartIdx + 1) }, (_, k) => {
        const idx = operationsStartIdx + k;
        return { idx, year: projectStartYear + idx, isHandover: false };
      })
    : [];
  const cashWindowStart = constructionStartIdx;
  const cashWindowEnd = op > 0 ? operationsEndIdx : Math.min(totalPeriods - 1, handoverYear);
  const cashWindow: WindowCell[] = Array.from(
    { length: Math.max(0, cashWindowEnd - cashWindowStart + 1) },
    (_, k) => {
      const idx = cashWindowStart + k;
      return { idx, year: projectStartYear + idx, isHandover: idx === handoverYear };
    },
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

  const setCohortVelocity = (subUnitId: string, periodIdx: number, pct: number, kind: 'pre' | 'post'): void => {
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
          if (kind === 'pre') {
            const next = [...s.preSalesVelocity];
            next[periodIdx] = Math.max(0, Math.min(1, pct / 100));
            return { ...s, preSalesVelocity: next };
          }
          const next = [...s.postSalesVelocity];
          next[periodIdx] = Math.max(0, Math.min(1, pct / 100));
          return { ...s, postSalesVelocity: next };
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

  const setIndexationMethod = (method: 'none' | 'single_rate' | 'yoy_compound' | 'step'): void => {
    updateSellInline({
      indexation: {
        method,
        rate: sellConfig?.indexation?.rate ?? 0,
        startYear: sellConfig?.indexation?.startYear ?? 0,
        steps: sellConfig?.indexation?.steps,
      },
    });
  };
  const setIndexationRate = (pct: number): void => {
    updateSellInline({
      indexation: {
        method: sellConfig?.indexation?.method ?? 'yoy_compound',
        rate: Math.max(0, pct / 100),
        startYear: sellConfig?.indexation?.startYear ?? 0,
        steps: sellConfig?.indexation?.steps,
      },
    });
  };
  const setIndexationStartYear = (year: number): void => {
    const idx = Math.max(0, Math.min(totalPeriods - 1, year - projectStartYear));
    updateSellInline({
      indexation: {
        method: sellConfig?.indexation?.method ?? 'yoy_compound',
        rate: sellConfig?.indexation?.rate ?? 0,
        startYear: idx,
        steps: sellConfig?.indexation?.steps,
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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: isSell && !assetCollapsed ? 'var(--sp-2)' : 0, flexWrap: 'wrap' }}>
        <span
          onClick={() => setAssetCollapsed(!assetCollapsed)}
          style={{ cursor: 'pointer', fontSize: 12, color: 'var(--color-meta)', marginRight: 4 }}
          data-testid={`m2-input-asset-${asset.id}-toggle`}
        >
          {assetCollapsed ? '▶' : '▼'}
        </span>
        <strong
          style={{ fontSize: 14, color: 'var(--color-heading)', cursor: 'pointer' }}
          onClick={() => setAssetCollapsed(!assetCollapsed)}
        >
          {asset.name}
        </strong>
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

      {!isSell && !assetCollapsed && (
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

      {isSell && !assetCollapsed && subUnits.length === 0 && (
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

      {isSell && !assetCollapsed && subUnits.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>

          {/* Pre-Sales velocity, scoped to construction window */}
          {constructionWindow.length > 0 && (
            <InlineSection
              title={`Pre-Sales velocity · Construction ${constructionWindow[0].year} to ${constructionWindow[constructionWindow.length - 1].year}`}
              hint="Pre-sales run during the asset's construction period. Sum per sub-unit + post-sales sum ≤ 100%. Handover column marked with *."
            >
              <InlineGrid
                cells={constructionWindow}
                rows={subUnits.map((su) => buildVelocityRow(su, inlineCohort, project.currency, totalPeriods, 'pre', (suId, idx, pct) => setCohortVelocity(suId, idx, pct, 'pre')))}
                disabled={multiCohortMode}
              />
            </InlineSection>
          )}

          {/* Post-Sales velocity, scoped to operations window */}
          {operationsWindow.length > 0 && (
            <InlineSection
              title={`Post-Sales velocity · Operations ${operationsWindow[0].year} to ${operationsWindow[operationsWindow.length - 1].year}`}
              hint="Sales During Operation. Applies to residual units left over after pre-sales. Recognized + collected in the same year (point-in-time)."
            >
              <InlineGrid
                cells={operationsWindow}
                rows={subUnits.map((su) => buildVelocityRow(su, inlineCohort, project.currency, totalPeriods, 'post', (suId, idx, pct) => setCohortVelocity(suId, idx, pct, 'post')))}
                disabled={multiCohortMode}
              />
            </InlineSection>
          )}

          {constructionWindow.length === 0 && operationsWindow.length === 0 && (
            <div style={{ padding: '6px 10px', background: 'var(--color-surface-alt, #f3f4f6)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
              Phase has no construction or operations periods. Set them on Module 1 · Tab 1.
            </div>
          )}

          {/* Price Indexation block */}
          <InlineSection
            title="Price Indexation"
            hint="Base sale rate per sub-unit (read from M1 Tab 2) lifts each year by the indexation factor. None = flat. Single-rate = one-step bump from start year. YoY = compounding annual lift. Step = override per year via Advanced."
          >
            <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', flexWrap: 'wrap' }}>
              <MethodPill active={(sellConfig?.indexation?.method ?? 'none') === 'none'} label="None" onClick={() => setIndexationMethod('none')} />
              <MethodPill active={sellConfig?.indexation?.method === 'single_rate'} label="Single-Rate" onClick={() => setIndexationMethod('single_rate')} />
              <MethodPill active={sellConfig?.indexation?.method === 'yoy_compound'} label="YoY Compound" onClick={() => setIndexationMethod('yoy_compound')} />
              <MethodPill active={sellConfig?.indexation?.method === 'step'} label="Step (Advanced)" onClick={() => setIndexationMethod('step')} />
              {sellConfig?.indexation?.method && sellConfig.indexation.method !== 'none' && sellConfig.indexation.method !== 'step' && (
                <>
                  <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Rate %</span>
                  <div style={{ width: 80 }}>
                    <PercentageInput
                      value={(sellConfig.indexation.rate ?? 0) * 100}
                      onChange={setIndexationRate}
                      min={0}
                      max={50}
                      decimals={2}
                      style={FAST_INPUT}
                      data-testid={`m2-asset-${asset.id}-idx-rate`}
                    />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Start Year</span>
                  <select
                    value={yearLabels[sellConfig.indexation.startYear ?? 0] ?? yearLabels[0]}
                    onChange={(e) => setIndexationStartYear(parseInt(e.target.value, 10))}
                    style={{ ...FAST_INPUT, width: 90, padding: '2px 4px', textAlign: 'left' }}
                    data-testid={`m2-asset-${asset.id}-idx-start`}
                  >
                    {yearLabels.map((y) => (<option key={y} value={y}>{y}</option>))}
                  </select>
                </>
              )}
            </div>
          </InlineSection>

          {/* Cash payment profile + recognition method on one row */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--sp-2)' }}>
            <InlineSection
              title={`Cash payment profile · ${cashWindow[0]?.year ?? '?'} to ${cashWindow[cashWindow.length - 1]?.year ?? '?'}`}
              hint="Milestones (% of cohort value collected per project year). Cohort sold in year N catches up cumulative-to-N at N then per profile in later years."
              tag={`Sum: ${(cashSum * 100).toFixed(1)}%`}
              tagColor={cashSumOk ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)'}
            >
              <InlineProfileStrip
                cells={cashWindow}
                values={sellConfig?.cashPaymentProfile?.percentages ?? []}
                onChange={setCashPct}
              />
            </InlineSection>

            <InlineSection title="Recognition">
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

// Build a velocity row for the inline grid. Sub-unit label includes
// the sale price (per unit or per sqm, depending on metric) read
// directly from M1 Tab 2 - the price stays read-only on this surface
// so the user knows there is one canonical place to edit it.
function buildVelocityRow(
  su: SubUnit,
  cohort: { subUnits: Array<{ subUnitId: string; preSalesVelocity: number[]; postSalesVelocity: number[] }> } | undefined,
  currency: string,
  totalPeriods: number,
  kind: 'pre' | 'post',
  onChange: (subUnitId: string, periodIdx: number, pct: number) => void,
): InlineGridRow {
  const cfgSU = cohort?.subUnits.find((s) => s.subUnitId === su.id);
  const arr = kind === 'pre' ? cfgSU?.preSalesVelocity : cfgSU?.postSalesVelocity;
  const values = paddedArray(arr, totalPeriods);
  const preSum = (cfgSU?.preSalesVelocity ?? []).reduce((s, v) => s + v, 0);
  const postSum = (cfgSU?.postSalesVelocity ?? []).reduce((s, v) => s + v, 0);
  const sumSelf = kind === 'pre' ? preSum : postSum;
  const sumAll = preSum + postSum;
  const overall = sumAll > 1 + 1e-6;

  const sizeHint = su.metric === 'units'
    ? `${Math.max(0, su.metricValue).toLocaleString()} units`
    : `${formatArea(computeSubUnitArea(su), 0)} sqm`;
  const priceHint = (su.unitPrice && su.unitPrice > 0)
    ? (su.metric === 'units'
        ? `${currency} ${formatAccounting(su.unitPrice, 'full', 0)} / unit`
        : `${currency} ${formatAccounting(su.unitPrice, 'full', 0)} / sqm`)
    : 'no price set';

  return {
    id: su.id,
    label: su.name || 'sub-unit',
    priceHint,
    hint: `${su.category} · ${sizeHint}${sumSelf > 0 ? ` · ${kind === 'pre' ? 'pre' : 'post'} ${(sumSelf * 100).toFixed(0)}%` : ''}${sumAll > 0 && kind === 'pre' ? ` · total ${(sumAll * 100).toFixed(0)}%` : ''}`,
    sumOver: overall,
    values,
    onChange: (idx, pct) => onChange(su.id, idx, pct),
  };
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
  priceHint: string;
  hint: string;
  sumOver: boolean;
  values: number[];   // full project-axis array; cells index into this via cell.idx
  onChange: (projectIdx: number, pct: number) => void;
}

type WindowCell = { idx: number; year: number; isHandover: boolean };

function InlineGrid({ cells, rows, disabled }: { cells: WindowCell[]; rows: InlineGridRow[]; disabled?: boolean }): React.JSX.Element {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
      <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--color-surface-alt, #f3f4f6)' }}>
            <th style={{ padding: '4px 6px', textAlign: 'left', position: 'sticky', left: 0, background: 'var(--color-surface-alt, #f3f4f6)', minWidth: 220 }}>Sub-unit · price</th>
            {cells.map((c) => (
              <th
                key={c.idx}
                style={{
                  padding: '4px 6px',
                  textAlign: 'center',
                  minWidth: 55,
                  color: c.isHandover ? 'var(--color-info, #1d4ed8)' : 'var(--color-body)',
                  fontWeight: c.isHandover ? 700 : 600,
                }}
                title={c.isHandover ? `Handover ${c.year}` : String(c.year)}
              >
                {c.year}{c.isHandover ? '*' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ padding: '4px 6px', position: 'sticky', left: 0, background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }}>
                <div style={{ fontWeight: 700, color: 'var(--color-heading)' }}>
                  {r.label}
                  <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--color-navy, #0f2e4c)' }}>
                    · {r.priceHint}
                  </span>
                </div>
                <div style={{ fontSize: 9, color: r.sumOver ? 'var(--color-warning, #92400e)' : 'var(--color-meta)' }}>
                  {r.hint}{r.sumOver ? ' ⚠ over 100%' : ''}
                </div>
              </td>
              {cells.map((c) => (
                <td key={c.idx} style={{ padding: '2px 3px', textAlign: 'center' }}>
                  <PercentageInput
                    value={(r.values[c.idx] ?? 0) * 100}
                    onChange={(n) => r.onChange(c.idx, n)}
                    min={0}
                    max={100}
                    decimals={2}
                    style={FAST_INPUT}
                    disabled={disabled}
                    title={disabled ? 'Multi-cohort mode - edit in Advanced' : ''}
                    data-testid={`m2-vel-${r.id}-${c.idx}`}
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

function InlineProfileStrip({ cells, values, onChange }: { cells: WindowCell[]; values: number[]; onChange: (projectIdx: number, pct: number) => void }): React.JSX.Element {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
      <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--color-surface-alt, #f3f4f6)' }}>
            {cells.map((c) => (
              <th
                key={c.idx}
                style={{
                  padding: '4px 6px',
                  textAlign: 'center',
                  minWidth: 55,
                  color: c.isHandover ? 'var(--color-info, #1d4ed8)' : 'var(--color-body)',
                  fontWeight: c.isHandover ? 700 : 600,
                }}
              >
                {c.year}{c.isHandover ? '*' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {cells.map((c) => (
              <td key={c.idx} style={{ padding: '2px 3px', textAlign: 'center' }}>
                <PercentageInput
                  value={(values[c.idx] ?? 0) * 100}
                  onChange={(n) => onChange(c.idx, n)}
                  min={0}
                  max={100}
                  decimals={2}
                  style={FAST_INPUT}
                  data-testid={`m2-cash-${c.idx}`}
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
