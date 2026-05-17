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
import type { Asset, SubUnit, Phase, Project } from '../../lib/state/module1-types';
import { computeProjectTimeline, computeSubUnitArea } from '@/src/core/calculations';
import { formatArea, formatAccounting } from '@/src/core/formatters';
import { PercentageInput } from '../ui/PercentageInput';
import { CELL_HEADER } from './_shared/tableStyles';
import { DEFAULT_SELL_TEMPLATE } from '../../lib/revenue-resolvers';

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

      {visibleAssets.some((a) => a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && (
        <SellTemplateCard project={project} phases={phases} />
      )}

      {phases.map((p) => (
        <PhaseSection
          key={p.id}
          phase={p}
          assets={visibleAssets.filter((a) => a.phaseId === p.id)}
          subUnits={subUnits}
          project={project}
          phases={phases}
        />
      ))}
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
}

function PhaseSection({ phase, assets, subUnits, project, phases }: PhaseSectionProps): React.JSX.Element {
  const collapseKey = `fmp:m2:inputs:phase:${phase.id}:collapsed`;
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
}

function AssetCard({ asset, subUnits, phase, project, phases }: AssetCardProps): React.JSX.Element {
  const updateAsset = useModule1Store((s) => s.updateAsset);
  const strategyMeta = STRATEGY_BADGE[asset.strategy ?? ''] ?? { bg: 'var(--color-surface)', fg: 'var(--color-meta)', label: asset.strategy ?? '?' };
  const isSell = asset.strategy === 'Sell';

  // Asset-level collapse per [[feedback_ui_universal_defaults]] rule 4.
  const assetCollapseKey = `fmp:m2:inputs:asset:${asset.id}:collapsed`;
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
  const projectStartYear = new Date(timeline.startDate).getUTCFullYear();
  // Universal-styling-fix (2026-05-17): computeProjectTimeline returns
  // YEARS ELAPSED (endYear - startYear), which is off-by-one for slot
  // count and causes the Post-Sales operations window to collapse when
  // a phase's operations extend up to the project end. The financing
  // engine's buildProjectAxis uses `max(phaseOffset + cp + op - overlap)`
  // which gives the correct INCLUSIVE slot count. Mirror that derivation
  // here so M2's axis can never collapse below the data extent.
  const effectiveTotalPeriods = useMemo(() => {
    let maxEnd = Math.max(1, timeline.totalPeriods);
    for (const p of phases) {
      const ps = p.startDate ? new Date(p.startDate).getUTCFullYear() : projectStartYear;
      const psIdx = Math.max(0, ps - projectStartYear);
      const phaseLen = Math.max(0, (p.constructionPeriods ?? 0) + (p.operationsPeriods ?? 0) - (p.overlapPeriods ?? 0));
      if (psIdx + phaseLen > maxEnd) maxEnd = psIdx + phaseLen;
    }
    return maxEnd;
  }, [timeline.totalPeriods, phases, projectStartYear]);
  const totalPeriods = effectiveTotalPeriods;
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

  // Pass 7e (2026-05-17): cash/recognition/indexation cascade from a
  // project-level Sell template. Per-asset override available via the
  // overrideProfile flag. Velocity stays per-asset always.
  const sellConfig = asset.revenue?.sell;
  const template = project.revenueTemplates?.sell ?? DEFAULT_SELL_TEMPLATE;
  const isOverridden = sellConfig?.overrideProfile === true;
  // Effective values shown on the card. Read from template unless
  // overridden, then read from asset (falling back to template when the
  // asset doesn't carry a particular field yet).
  const effCash = isOverridden && sellConfig?.cashPaymentProfile
    ? sellConfig.cashPaymentProfile
    : template.cashPaymentProfile;
  const effRec = isOverridden && sellConfig?.recognitionProfile
    ? sellConfig.recognitionProfile
    : template.recognitionProfile;
  const effIdx = isOverridden && sellConfig?.indexation
    ? sellConfig.indexation
    : template.indexation;

  const updateSellInline = (patch: Partial<NonNullable<Asset['revenue']>['sell']>): void => {
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
      indexation: sellConfig?.indexation ?? { method: 'none' as const },
      handoverYearOverride: sellConfig?.handoverYearOverride,
      overrideProfile: sellConfig?.overrideProfile,
      ...patch,
    };
    updateAsset(asset.id, { revenue: { ...(asset.revenue ?? {}), sell: nextSell } });
  };

  const toggleOverride = (): void => {
    if (isOverridden) {
      // Revert to template, drop the per-asset profiles.
      updateSellInline({
        overrideProfile: false,
        cashPaymentProfile: undefined,
        recognitionProfile: undefined,
        indexation: undefined,
      } as Partial<NonNullable<Asset['revenue']>['sell']>);
    } else {
      // Snapshot current effective values onto the asset so the user
      // starts editing from the same numbers they were seeing.
      updateSellInline({
        overrideProfile: true,
        cashPaymentProfile: { ...effCash },
        recognitionProfile: { ...effRec },
        indexation: { ...effIdx },
      });
    }
  };

  const setVelocity = (subUnitId: string, periodIdx: number, pct: number, kind: 'pre' | 'post'): void => {
    const baseSubs = subUnits.map((su) => {
      const existing = sellConfig?.subUnits.find((s) => s.subUnitId === su.id);
      return {
        subUnitId: su.id,
        preSalesVelocity: paddedArray(existing?.preSalesVelocity, totalPeriods),
        postSalesVelocity: paddedArray(existing?.postSalesVelocity, totalPeriods),
      };
    });
    const nextSubs = baseSubs.map((s) => {
      if (s.subUnitId !== subUnitId) return s;
      if (kind === 'pre') {
        const next = [...s.preSalesVelocity];
        next[periodIdx] = Math.max(0, Math.min(1, pct / 100));
        return { ...s, preSalesVelocity: next };
      }
      const next = [...s.postSalesVelocity];
      next[periodIdx] = Math.max(0, Math.min(1, pct / 100));
      return { ...s, postSalesVelocity: next };
    });
    updateSellInline({ subUnits: nextSubs });
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

  const cashSum = effCash.percentages.reduce((s, v) => s + v, 0);
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
        {isSell && (
          <button
            type="button"
            onClick={toggleOverride}
            data-testid={`m2-input-asset-${asset.id}-override`}
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              padding: '3px 10px',
              background: isOverridden ? 'var(--color-warning, #92400e)' : 'var(--color-surface)',
              color: isOverridden ? 'var(--color-on-primary-navy, #fff)' : 'var(--color-navy)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              fontWeight: 700,
            }}
            title={isOverridden ? 'Currently overrides the project template. Click to revert to template.' : 'Currently tracks the project template. Click to override for this asset only.'}
          >
            {isOverridden ? 'Override ON (click to revert)' : 'Tracks Template (click to override)'}
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
                rows={subUnits.map((su) => buildVelocityRow(su, sellConfig, project.currency, totalPeriods, 'pre', (suId, idx, pct) => setVelocity(suId, idx, pct, 'pre')))}
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
                rows={subUnits.map((su) => buildVelocityRow(su, sellConfig, project.currency, totalPeriods, 'post', (suId, idx, pct) => setVelocity(suId, idx, pct, 'post')))}
              />
            </InlineSection>
          )}

          {constructionWindow.length === 0 && operationsWindow.length === 0 && (
            <div style={{ padding: '6px 10px', background: 'var(--color-surface-alt, #f3f4f6)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
              Phase has no construction or operations periods. Set them on Module 1 · Tab 1.
            </div>
          )}

          {/* Year-on-year SQM sold preview (Pass 7e). Computed from
              the velocity grid above, cumulative across pre+post. */}
          <SqmSoldPreview
            subUnits={subUnits}
            sellConfig={sellConfig}
            cells={[...constructionWindow, ...operationsWindow.filter((c) => !constructionWindow.some((x) => x.idx === c.idx))]}
            totalPeriods={totalPeriods}
          />

          {/* Cascade banner: if not overridden, show that this asset
              tracks the project template, with values rendered read-only. */}
          {!isOverridden && (
            <div style={{
              padding: '6px 10px',
              background: 'var(--color-grey-pale)',
              border: '1px dashed var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-meta)',
              fontSize: 11,
              fontStyle: 'italic',
            }}>
              Cash + Recognition + Indexation track the project-wide Sell template (above). Click Override to customise per asset.
            </div>
          )}

          {/* Price Indexation block, EFFECTIVE values (template or override) */}
          <InlineSection
            title={`Price Indexation${isOverridden ? '' : ' · from template'}`}
            hint="Base sale rate per sub-unit (M1 Tab 2) lifts by the indexation factor each year."
          >
            <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', flexWrap: 'wrap' }}>
              <MethodPill active={effIdx.method === 'none'} label="None" onClick={() => isOverridden && setIndexationMethod('none')} />
              <MethodPill active={effIdx.method === 'single_rate'} label="Single-Rate" onClick={() => isOverridden && setIndexationMethod('single_rate')} />
              <MethodPill active={effIdx.method === 'yoy_compound'} label="YoY Compound" onClick={() => isOverridden && setIndexationMethod('yoy_compound')} />
              <MethodPill active={effIdx.method === 'step'} label="Step" onClick={() => isOverridden && setIndexationMethod('step')} />
              {effIdx.method !== 'none' && effIdx.method !== 'step' && (
                <>
                  <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Rate %</span>
                  <div style={{ width: 80 }}>
                    <PercentageInput
                      value={(effIdx.rate ?? 0) * 100}
                      onChange={setIndexationRate}
                      min={0}
                      max={50}
                      decimals={2}
                      style={FAST_INPUT}
                      disabled={!isOverridden}
                      data-testid={`m2-asset-${asset.id}-idx-rate`}
                    />
                  </div>
                </>
              )}
            </div>
          </InlineSection>

          {/* Cash payment profile + recognition method on one row */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--sp-2)' }}>
            <InlineSection
              title={`Cash payment profile${isOverridden ? '' : ' · from template'} · ${cashWindow[0]?.year ?? '?'} to ${cashWindow[cashWindow.length - 1]?.year ?? '?'}`}
              hint="Milestones (% of cohort value collected per project year). Cohort sold in year N catches up cumulative-to-N at N then per profile in later years."
              tag={`Sum: ${(cashSum * 100).toFixed(1)}%`}
              tagColor={cashSumOk ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)'}
            >
              <InlineProfileStrip
                cells={cashWindow}
                values={effCash.percentages}
                onChange={isOverridden ? setCashPct : () => undefined}
                readOnly={!isOverridden}
              />
            </InlineSection>

            <InlineSection title={`Recognition${isOverridden ? '' : ' · from template'}`}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <MethodPill
                  active={effRec.method !== 'over_time'}
                  label="Point-in-Time"
                  onClick={() => isOverridden && setRecognitionMethod('point_in_time')}
                />
                <MethodPill
                  active={effRec.method === 'over_time'}
                  label="Over-Time"
                  onClick={() => isOverridden && setRecognitionMethod('over_time')}
                />
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic' }}>
                {effRec.method === 'over_time'
                  ? 'Over-Time profile edited on template card above.'
                  : `Lumps at handover (${yearLabels[handoverYear]}).`}
              </div>
            </InlineSection>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Year-on-year SQM sold preview (Pass 7e) ───────────────────────────
// Renders below the velocity grid so the user sees the SQM each cell
// represents (cumulative pct x sub-unit total area). Also surfaces a
// cumulative pct chip per sub-unit so overshoot / undershoot is visible
// at a glance (the engine caps at 100% but the user needs to see when
// they're under-selling).
function SqmSoldPreview({ subUnits, sellConfig, cells, totalPeriods }: {
  subUnits: SubUnit[];
  sellConfig: NonNullable<Asset['revenue']>['sell'] | undefined;
  cells: WindowCell[];
  totalPeriods: number;
}): React.JSX.Element | null {
  if (subUnits.length === 0 || cells.length === 0) return null;
  const sortedCells = [...cells].sort((a, b) => a.idx - b.idx);
  const HEADER_STICKY: React.CSSProperties = { ...CELL_HEADER, textAlign: 'left', position: 'sticky', left: 0, minWidth: 220, zIndex: 1 };
  const HEADER_YEAR: React.CSSProperties = { ...CELL_HEADER, minWidth: 55 };
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-heading)', marginBottom: 4 }}>
        Year-on-Year SQM Sold (computed from velocity)
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
        <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={HEADER_STICKY}>Sub-unit · total area · cumulative %</th>
              {sortedCells.map((c) => (<th key={c.idx} style={HEADER_YEAR}>{c.year}</th>))}
            </tr>
          </thead>
          <tbody>
            {subUnits.map((su) => {
              const totalArea = computeSubUnitArea(su);
              const cfgSU = sellConfig?.subUnits.find((s) => s.subUnitId === su.id);
              const pre = paddedArray(cfgSU?.preSalesVelocity, totalPeriods);
              const post = paddedArray(cfgSU?.postSalesVelocity, totalPeriods);
              const cumPct = pre.reduce((s, v) => s + v, 0) + post.reduce((s, v) => s + v, 0);
              const over = cumPct > 1 + 1e-6;
              const under = cumPct < 1 - 1e-3;
              const chipColor = over ? 'var(--color-warning, #92400e)' : (under ? 'var(--color-meta)' : 'var(--color-success, #166534)');
              return (
                <tr key={su.id}>
                  <td style={{ padding: '4px 6px', position: 'sticky', left: 0, background: 'var(--color-grey-pale)', borderRight: '1px solid var(--color-border)' }}>
                    <div style={{ fontWeight: 700, color: 'var(--color-heading)' }}>{su.name || 'sub-unit'}</div>
                    <div style={{ fontSize: 9, color: 'var(--color-meta)' }}>
                      Area {formatArea(totalArea, 0)} sqm · <span style={{ color: chipColor, fontWeight: 700 }}>cum {(cumPct * 100).toFixed(0)}%</span>
                      {over ? ' ⚠ over 100%' : under ? ' (unsold)' : ' ✓'}
                    </div>
                  </td>
                  {sortedCells.map((c) => {
                    const pct = Math.min(Math.max(0, pre[c.idx] ?? 0) + Math.max(0, post[c.idx] ?? 0), 1);
                    const sqm = totalArea * pct;
                    return (
                      <td key={c.idx} style={{ padding: '4px 6px', textAlign: 'right', background: 'var(--color-grey-pale)', color: 'var(--color-heading)' }}>
                        {sqm > 0.5 ? formatArea(sqm, 0) : '-'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Build a velocity row for the inline grid. Sub-unit label includes
// the sale price (per unit or per sqm, depending on metric) read
// directly from M1 Tab 2 - the price stays read-only on this surface
// so the user knows there is one canonical place to edit it.
function buildVelocityRow(
  su: SubUnit,
  cfg: { subUnits: Array<{ subUnitId: string; preSalesVelocity: number[]; postSalesVelocity: number[] }> } | undefined,
  currency: string,
  totalPeriods: number,
  kind: 'pre' | 'post',
  onChange: (subUnitId: string, periodIdx: number, pct: number) => void,
): InlineGridRow {
  const cfgSU = cfg?.subUnits.find((s) => s.subUnitId === su.id);
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

function InlineGrid({ cells, rows }: { cells: WindowCell[]; rows: InlineGridRow[] }): React.JSX.Element {
  // Universal CELL_HEADER token (navy + white text, bold, centered). Sticky
  // first column re-applies the navy background so the sub-unit label header
  // stays solid on horizontal scroll. Handover column underlines with the
  // accent color while keeping the white text required by rule 1
  // ([[feedback_ui_universal_defaults]]).
  const HEADER_STICKY: React.CSSProperties = { ...CELL_HEADER, textAlign: 'left', position: 'sticky', left: 0, minWidth: 220, zIndex: 1 };
  const HEADER_YEAR: React.CSSProperties = { ...CELL_HEADER, minWidth: 55 };
  const HEADER_HANDOVER: React.CSSProperties = { ...HEADER_YEAR, borderBottom: '2px solid var(--color-warning, #f59e0b)' };
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
      <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={HEADER_STICKY}>Sub-unit · price</th>
            {cells.map((c) => (
              <th
                key={c.idx}
                style={c.isHandover ? HEADER_HANDOVER : HEADER_YEAR}
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

function InlineProfileStrip({ cells, values, onChange, readOnly }: { cells: WindowCell[]; values: number[]; onChange: (projectIdx: number, pct: number) => void; readOnly?: boolean }): React.JSX.Element {
  const HEADER_YEAR: React.CSSProperties = { ...CELL_HEADER, minWidth: 55 };
  const HEADER_HANDOVER: React.CSSProperties = { ...HEADER_YEAR, borderBottom: '2px solid var(--color-warning, #f59e0b)' };
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
      <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {cells.map((c) => (
              <th
                key={c.idx}
                style={c.isHandover ? HEADER_HANDOVER : HEADER_YEAR}
                title={c.isHandover ? `Handover ${c.year}` : String(c.year)}
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
                  disabled={readOnly}
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

// ── Project-wide Sell Template card (Pass 7e) ─────────────────────────
// Per [[feedback-ui-universal-defaults]] rule + user request 2026-05-17:
// one settings template per strategy at project level. All Sell assets
// inherit cash + recognition + indexation from here unless they flip
// the Override chip on their own card.

function SellTemplateCard({ project, phases }: { project: Project; phases: Phase[] }): React.JSX.Element {
  const setProject = useModule1Store((s) => s.setProject);
  const template = project.revenueTemplates?.sell ?? DEFAULT_SELL_TEMPLATE;
  const timeline = useMemo(() => computeProjectTimeline(project, phases), [project, phases]);
  const projectStartYear = new Date(timeline.startDate).getUTCFullYear();
  const effectiveTotalPeriods = useMemo(() => {
    let maxEnd = Math.max(1, timeline.totalPeriods);
    for (const p of phases) {
      const ps = p.startDate ? new Date(p.startDate).getUTCFullYear() : projectStartYear;
      const psIdx = Math.max(0, ps - projectStartYear);
      const phaseLen = Math.max(0, (p.constructionPeriods ?? 0) + (p.operationsPeriods ?? 0) - (p.overlapPeriods ?? 0));
      if (psIdx + phaseLen > maxEnd) maxEnd = psIdx + phaseLen;
    }
    return maxEnd;
  }, [timeline.totalPeriods, phases, projectStartYear]);
  const cells: WindowCell[] = useMemo(
    () => Array.from({ length: effectiveTotalPeriods }, (_, i) => ({ idx: i, year: projectStartYear + i, isHandover: false })),
    [effectiveTotalPeriods, projectStartYear],
  );

  const updateTemplate = (patch: Partial<NonNullable<NonNullable<Project['revenueTemplates']>['sell']>>): void => {
    setProject({
      revenueTemplates: {
        ...(project.revenueTemplates ?? {}),
        sell: { ...template, ...patch },
      },
    });
  };

  const setCashPct = (idx: number, pct: number): void => {
    const next = paddedArray(template.cashPaymentProfile.percentages, effectiveTotalPeriods);
    next[idx] = Math.max(0, Math.min(1, pct / 100));
    updateTemplate({
      cashPaymentProfile: { ...template.cashPaymentProfile, percentages: next },
    });
  };

  const setRecMethod = (method: 'point_in_time' | 'over_time'): void => {
    updateTemplate({
      recognitionProfile: {
        method,
        pointInTimeYear: template.recognitionProfile.pointInTimeYear ?? 'handover',
        percentages: method === 'over_time'
          ? template.recognitionProfile.percentages ?? new Array<number>(effectiveTotalPeriods).fill(0)
          : undefined,
        positions: template.recognitionProfile.positions,
        profileMode: template.recognitionProfile.profileMode ?? 'absolute_with_catchup',
      },
    });
  };

  const setRecPct = (idx: number, pct: number): void => {
    if (template.recognitionProfile.method !== 'over_time') return;
    const next = paddedArray(template.recognitionProfile.percentages, effectiveTotalPeriods);
    next[idx] = Math.max(0, Math.min(1, pct / 100));
    updateTemplate({
      recognitionProfile: { ...template.recognitionProfile, percentages: next },
    });
  };

  const setIdxMethod = (method: 'none' | 'single_rate' | 'yoy_compound' | 'step'): void => {
    updateTemplate({ indexation: { ...template.indexation, method } });
  };
  const setIdxRate = (pct: number): void => {
    updateTemplate({ indexation: { ...template.indexation, rate: Math.max(0, pct / 100) } });
  };

  const cashSum = template.cashPaymentProfile.percentages.reduce((s, v) => s + v, 0);
  const cashSumOk = Math.abs(cashSum - 1) < 0.005;
  const recSum = (template.recognitionProfile.percentages ?? []).reduce((s, v) => s + v, 0);
  const recSumOk = template.recognitionProfile.method === 'point_in_time' || Math.abs(recSum - 1) < 0.005;

  return (
    <div
      data-testid="m2-sell-template-card"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-navy)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--sp-2)',
        marginBottom: 'var(--sp-3)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-2)', flexWrap: 'wrap', gap: 8 }}>
        <strong style={{ fontSize: 13, color: 'var(--color-heading)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Project-Wide Sell Template
        </strong>
        <span style={{ fontSize: 11, color: 'var(--color-meta)', fontStyle: 'italic' }}>
          Applies to every Sell + Sell+Manage asset. Per-asset override via the chip on each card.
        </span>
      </div>

      {/* Indexation */}
      <InlineSection title="Price Indexation">
        <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', flexWrap: 'wrap' }}>
          <MethodPill active={template.indexation.method === 'none'} label="None" onClick={() => setIdxMethod('none')} />
          <MethodPill active={template.indexation.method === 'single_rate'} label="Single-Rate" onClick={() => setIdxMethod('single_rate')} />
          <MethodPill active={template.indexation.method === 'yoy_compound'} label="YoY Compound" onClick={() => setIdxMethod('yoy_compound')} />
          <MethodPill active={template.indexation.method === 'step'} label="Step" onClick={() => setIdxMethod('step')} />
          {template.indexation.method !== 'none' && template.indexation.method !== 'step' && (
            <>
              <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Rate %</span>
              <div style={{ width: 80 }}>
                <PercentageInput
                  value={(template.indexation.rate ?? 0) * 100}
                  onChange={setIdxRate}
                  min={0}
                  max={50}
                  decimals={2}
                  style={FAST_INPUT}
                  data-testid="m2-tpl-idx-rate"
                />
              </div>
            </>
          )}
        </div>
      </InlineSection>

      {/* Cash payment profile */}
      <div style={{ marginTop: 'var(--sp-2)' }}>
        <InlineSection
          title="Cash Payment Profile (per project year)"
          hint="Milestones expressed as % of cohort value collected at each project year. Cohort sold in year N catches up cumulative-to-N at N then per profile in later years."
          tag={`Sum: ${(cashSum * 100).toFixed(1)}%`}
          tagColor={cashSumOk ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)'}
        >
          <InlineProfileStrip
            cells={cells}
            values={template.cashPaymentProfile.percentages}
            onChange={setCashPct}
          />
        </InlineSection>
      </div>

      {/* Recognition */}
      <div style={{ marginTop: 'var(--sp-2)' }}>
        <InlineSection title="Revenue Recognition">
          <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            <MethodPill active={template.recognitionProfile.method === 'point_in_time'} label="Point-in-Time" onClick={() => setRecMethod('point_in_time')} />
            <MethodPill active={template.recognitionProfile.method === 'over_time'} label="Over-Time" onClick={() => setRecMethod('over_time')} />
            {template.recognitionProfile.method === 'over_time' && (
              <span style={{ fontSize: 10, fontWeight: 700, color: recSumOk ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)', marginLeft: 8 }}>
                Sum: {(recSum * 100).toFixed(1)}%
              </span>
            )}
          </div>
          {template.recognitionProfile.method === 'over_time' && (
            <InlineProfileStrip
              cells={cells}
              values={template.recognitionProfile.percentages ?? []}
              onChange={setRecPct}
            />
          )}
          {template.recognitionProfile.method === 'point_in_time' && (
            <div style={{ fontSize: 10, color: 'var(--color-meta)', fontStyle: 'italic' }}>
              Cohort revenue lumps at handover year of its phase.
            </div>
          )}
        </InlineSection>
      </div>
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
