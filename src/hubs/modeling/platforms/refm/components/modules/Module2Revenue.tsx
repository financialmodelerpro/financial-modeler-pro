'use client';

/**
 * Module2Revenue.tsx (M2 Pass 7g, per-asset inputs only)
 *
 * Pass 7e introduced a project-wide Sell template that cascaded cash +
 * recognition + indexation to every Sell asset. User feedback
 * (2026-05-17, Pass 7g): kill the template, each asset owns its own
 * cash payment profile, recognition profile, and indexation. Phases
 * stay collapsible; each asset card shows the full set of editable
 * inputs needed to drive the engine on its own.
 *
 * Tab 1 layout:
 *  - Phase header bar (navy, click to collapse).
 *  - Asset cards inside each phase. Sell strategy carries:
 *      - Per-sub-unit Pre-Sales velocity grid (construction window).
 *      - Per-sub-unit Sales During Operation velocity grid (ops window).
 *      - Year-on-year SQM Sold preview computed from velocity.
 *      - Price Indexation pills + rate (none / single / yoy / step).
 *      - Cash Payment Profile strip across the asset's cash window.
 *      - Revenue Recognition pills + (if Over-Time) percentages strip.
 *  - Non-Sell strategies show a "coming soon" placeholder.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import type { Asset, SubUnit, Phase, Project } from '../../lib/state/module1-types';
import { computeProjectTimeline, computeSubUnitArea } from '@/src/core/calculations';
import { formatArea, formatAccounting } from '@/src/core/formatters';
import { PercentageInput } from '../ui/PercentageInput';
import { AccountingNumberInput } from '../ui/AccountingNumberInput';
import { CELL_HEADER } from './_shared/tableStyles';

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

/**
 * Pass 7x (2026-05-18): sub-unit reference chip strip. Read-only
 * line showing each sub-unit's area + sale rate so the user can
 * verify M1 Tab 2 inputs without leaving the Revenue surface. Used
 * by both Inputs (above the velocity grids) and Output (above each
 * per-asset narrative).
 */
function SubUnitReferenceStrip({
  units,
  currency,
  mode = 'sell',
}: {
  units: SubUnit[];
  currency: string;
  // Pass 9e (2026-05-18): 'operate' surfaces SubUnit.startingAdr as
  // "ADR / night" and labels the count as "keys". 'sell' (default)
  // surfaces unitPrice as "/ unit" or "/ sqm" depending on metric.
  // Pass 9g (2026-05-18): 'lease' surfaces unitPrice as "/ sqm / yr"
  // (annual base rent rate).
  mode?: 'sell' | 'operate' | 'lease';
}): React.JSX.Element | null {
  if (units.length === 0) return null;
  return (
    <div style={{
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap',
      padding: '6px 8px',
      background: 'var(--color-grey-pale)',
      border: '1px dashed var(--color-border)',
      borderRadius: 'var(--radius-sm)',
      marginBottom: 'var(--sp-2)',
    }}>
      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-meta)', alignSelf: 'center' }}>
        Sub-units (from M1)
      </span>
      {units.map((su) => {
        const area = computeSubUnitArea(su);
        const isUnitsMetric = su.metric === 'units';
        const countNoun = mode === 'operate' && isUnitsMetric ? 'keys' : 'units';
        let rateLabel: string;
        if (mode === 'operate' && isUnitsMetric) {
          const adr = su.startingAdr ?? su.unitPrice ?? 0;
          rateLabel = adr > 0 ? `${currency} ${formatAccounting(adr, 'full', 0)} / night (ADR)` : 'no ADR';
        } else if (mode === 'lease') {
          rateLabel = (su.unitPrice && su.unitPrice > 0)
            ? `${currency} ${formatAccounting(su.unitPrice, 'full', 0)} / sqm / yr`
            : 'no rate';
        } else {
          rateLabel = (su.unitPrice && su.unitPrice > 0)
            ? (isUnitsMetric
                ? `${currency} ${formatAccounting(su.unitPrice, 'full', 0)} / unit`
                : `${currency} ${formatAccounting(su.unitPrice, 'full', 0)} / sqm`)
            : 'no price';
        }
        const sizeLabel = isUnitsMetric
          ? `${Math.round(Math.max(0, su.metricValue)).toLocaleString('en-US')} ${countNoun} · ${formatArea(area, 0)} sqm`
          : `${formatArea(area, 0)} sqm`;
        return (
          <span
            key={su.id}
            style={{
              fontSize: 10,
              padding: '3px 8px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            <strong style={{ color: 'var(--color-heading)' }}>{su.name || 'sub-unit'}</strong>
            {' · '}
            {sizeLabel}
            {' · '}
            {rateLabel}
          </span>
        );
      })}
    </div>
  );
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
          Configure revenue per phase. Each asset owns its own velocity, indexation, cash profile, and recognition method. Phase 1 (Residential / Sell) is live; other strategies follow.
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
          allAssets={assets}
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
  allAssets: Asset[];
  subUnits: SubUnit[];
  project: Project;
  phases: Phase[];
}

function PhaseSection({ phase, assets, allAssets, subUnits, project, phases }: PhaseSectionProps): React.JSX.Element {
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
          {assets.map((a) => {
            // Pass 9d (2026-05-18): when a Sell + Manage parent is
            // rendered, also surface its companion's Hospitality
            // inputs as a SIBLING card so the user has somewhere to
            // enter ADR / occupancy / F&B / Other for the manage half.
            // Pass 9e-6 (2026-05-18): per user feedback, the companion
            // is no longer visually nested inside the parent's card —
            // it renders as its own collapsible sibling, with a small
            // "Linked to {parent}" reference chip on top to preserve
            // the relationship.
            const companion = a.strategy === 'Sell + Manage'
              ? allAssets.find((c) => c.parentAssetId === a.id && c.isCompanion === true && c.visible !== false)
              : undefined;
            return (
              <React.Fragment key={a.id}>
                {companion && (
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--color-info, #1d4ed8)',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      padding: '4px 10px',
                      background: 'color-mix(in srgb, var(--color-info, #1d4ed8) 8%, transparent)',
                      borderLeft: '3px solid var(--color-info, #1d4ed8)',
                      borderTopLeftRadius: 'var(--radius-sm)',
                      borderTopRightRadius: 'var(--radius-sm)',
                      marginBottom: 0,
                    }}
                  >
                    ↑ Sell · linked to {companion.name} (Manage / Operate companion below)
                  </div>
                )}
                <AssetCard
                  asset={a}
                  subUnits={subUnits.filter((u) => u.assetId === a.id)}
                  phase={phase}
                  project={project}
                  phases={phases}
                />
                {companion && (
                  <div style={{ marginBottom: 'var(--sp-2)' }}>
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--color-info, #1d4ed8)',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        padding: '4px 10px',
                        background: 'color-mix(in srgb, var(--color-info, #1d4ed8) 8%, transparent)',
                        borderLeft: '3px solid var(--color-info, #1d4ed8)',
                        borderTopLeftRadius: 'var(--radius-sm)',
                        borderTopRightRadius: 'var(--radius-sm)',
                        marginBottom: 0,
                      }}
                    >
                      ↳ Manage / Operate · linked to {a.name} (Sell side above)
                    </div>
                    <AssetCard
                      asset={companion}
                      subUnits={subUnits.filter((u) => u.assetId === companion.id)}
                      phase={phase}
                      project={project}
                      phases={phases}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
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
  project: Project;
  phases: Phase[];
}

function AssetCard({ asset, subUnits, phase, project, phases }: AssetCardProps): React.JSX.Element {
  const updateAsset = useModule1Store((s) => s.updateAsset);
  const updateSubUnit = useModule1Store((s) => s.updateSubUnit);
  const strategyMeta = STRATEGY_BADGE[asset.strategy ?? ''] ?? { bg: 'var(--color-surface)', fg: 'var(--color-meta)', label: asset.strategy ?? '?' };
  // Pass 7w (2026-05-18): Sell + Manage parents get full Sell-side
  // treatment (velocity grid, indexation, cash profile, recognition
  // profile). The companion (operate side) handled by isHospitality.
  const isSell = asset.strategy === 'Sell' || asset.strategy === 'Sell + Manage';
  // Pass 8b (2026-05-18): Hospitality (Operate-strategy) input variant.
  // Pure Operate assets + every companion (companions are the operate
  // side of a Sell + Manage parent).
  const isHospitality = asset.strategy === 'Operate' || asset.isCompanion === true;
  // Pass 9g (2026-05-18): Retail / Office Lease input variant.
  const isLease = asset.strategy === 'Lease';

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

  // Pass 7v (2026-05-18): velocity grid defaults to a single shared row
  // across all sub-units. User toggles "Split per sub-unit" to expose
  // the per-sub-unit editor when 1BR / Penthouse really do absorb at
  // different rates. Storage stays per-sub-unit so the engine is
  // untouched; collapsed-mode writes propagate to every sub-unit.
  const splitVelocityKey = `fmp:m2:inputs:asset:${asset.id}:velocity:split`;
  const readSplitVelocity = (): boolean => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem(splitVelocityKey) === 'true'; }
    catch { return false; }
  };
  const [splitVelocity, setSplitVelocity] = useState<boolean>(readSplitVelocity);
  useEffect(() => {
    try { window.localStorage.setItem(splitVelocityKey, String(splitVelocity)); } catch { /* noop */ }
  }, [splitVelocity, splitVelocityKey]);

  const timeline = useMemo(() => computeProjectTimeline(project, phases), [project, phases]);
  const projectStartYear = new Date(timeline.startDate).getUTCFullYear();
  // computeProjectTimeline returns YEARS ELAPSED (off-by-one for slot
  // count). Mirror the financing engine's `max(phaseOffset + cp + op -
  // overlap)` derivation so the axis can't collapse below the data
  // extent.
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
  const cp = Math.max(0, phase.constructionPeriods ?? 0);
  const op = Math.max(0, phase.operationsPeriods ?? 0);
  const overlap = Math.max(0, phase.overlapPeriods ?? 0);
  const constructionStartIdx = Math.max(0, Math.min(totalPeriods - 1, phaseStartYear - projectStartYear));
  const handoverYear = Math.max(constructionStartIdx, Math.min(totalPeriods - 1, constructionStartIdx + cp - 1));
  const defaultOperationsStartIdx = Math.max(constructionStartIdx, Math.min(totalPeriods - 1, handoverYear + 1 - overlap));
  // Pass 9e (2026-05-18): per-asset override so a hotel can soft-open
  // mid-construction (or any custom calendar year). Resolver mirrors
  // this logic; this is the UI-side window so the occupancy + ADR
  // strips render the right year range.
  const opsStartOverride = asset.revenue?.operate?.operationsStartYearOverride;
  const operationsStartIdx = opsStartOverride != null
    ? Math.max(constructionStartIdx, Math.min(totalPeriods - 1, opsStartOverride - projectStartYear))
    : defaultOperationsStartIdx;
  // Pass 9e-8 (2026-05-18): end stays anchored to the phase's
  // calendar end (defaultOperationsStartIdx + op - 1), so the override
  // can only pull the start in, never trim the back.
  const operationsEndIdx = Math.max(operationsStartIdx, Math.min(totalPeriods - 1, defaultOperationsStartIdx + op - 1));

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

  // Pass 7g (2026-05-17): per-asset only. Read straight from
  // asset.revenue.sell with sensible defaults; no project-level
  // template, no override chip.
  const sellConfig = asset.revenue?.sell;
  const cashProfile = sellConfig?.cashPaymentProfile ?? {
    percentages: [] as number[],
    profileMode: 'absolute_with_catchup' as const,
  };
  const recProfile = sellConfig?.recognitionProfile ?? {
    method: 'point_in_time' as const,
    pointInTimeYear: 'handover' as const,
  };
  const idxConfig = sellConfig?.indexation ?? { method: 'none' as const };

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
      ...patch,
    };
    updateAsset(asset.id, { revenue: { ...(asset.revenue ?? {}), sell: nextSell } });
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

  // Pass 7v: collapsed-mode setter. Writes the same pct to every
  // sub-unit's velocity slot for `periodIdx`. Engine still reads
  // per-sub-unit; this just keeps every sub-unit in lockstep when the
  // user is in "All sub-units" view.
  const setVelocityForAllSubUnits = (periodIdx: number, pct: number, kind: 'pre' | 'post'): void => {
    const clamped = Math.max(0, Math.min(1, pct / 100));
    const baseSubs = subUnits.map((su) => {
      const existing = sellConfig?.subUnits.find((s) => s.subUnitId === su.id);
      return {
        subUnitId: su.id,
        preSalesVelocity: paddedArray(existing?.preSalesVelocity, totalPeriods),
        postSalesVelocity: paddedArray(existing?.postSalesVelocity, totalPeriods),
      };
    });
    const nextSubs = baseSubs.map((s) => {
      if (kind === 'pre') {
        const next = [...s.preSalesVelocity];
        next[periodIdx] = clamped;
        return { ...s, preSalesVelocity: next };
      }
      const next = [...s.postSalesVelocity];
      next[periodIdx] = clamped;
      return { ...s, postSalesVelocity: next };
    });
    updateSellInline({ subUnits: nextSubs });
  };

  const setCashPct = (periodIdx: number, pct: number): void => {
    const next = paddedArray(cashProfile.percentages, totalPeriods);
    next[periodIdx] = Math.max(0, Math.min(1, pct / 100));
    updateSellInline({
      cashPaymentProfile: {
        percentages: next,
        positions: cashProfile.positions,
        profileMode: cashProfile.profileMode ?? 'absolute_with_catchup',
      },
    });
  };

  const setRecognitionMethod = (method: 'point_in_time' | 'over_time'): void => {
    // Pass 7t (2026-05-18): retain `percentages` even when switching to
    // Point-in-Time so toggling back to Over-Time preserves the user's
    // schedule. Engine only consumes `percentages` when method ===
    // 'over_time' (see sell.ts:178-189), so the carry-over is inert in
    // PIT mode. First-time switch to Over-Time still seeds a fresh
    // zero array when none exists.
    updateSellInline({
      recognitionProfile: {
        method,
        pointInTimeYear: recProfile.pointInTimeYear ?? 'handover',
        percentages: method === 'over_time'
          ? recProfile.percentages ?? new Array<number>(totalPeriods).fill(0)
          : recProfile.percentages,
        positions: recProfile.positions,
        profileMode: recProfile.profileMode ?? 'absolute_with_catchup',
      },
    });
  };

  const setRecognitionPct = (periodIdx: number, pct: number): void => {
    if (recProfile.method !== 'over_time') return;
    const next = paddedArray(recProfile.percentages, totalPeriods);
    next[periodIdx] = Math.max(0, Math.min(1, pct / 100));
    updateSellInline({
      recognitionProfile: { ...recProfile, percentages: next },
    });
  };

  const setRecognitionAnchor = (anchor: 'handover' | 'sale_year'): void => {
    if (recProfile.method !== 'point_in_time') return;
    updateSellInline({
      recognitionProfile: { ...recProfile, pointInTimeYear: anchor },
    });
  };

  const setIndexationMethod = (method: 'none' | 'single_rate' | 'yoy_compound' | 'step'): void => {
    updateSellInline({
      indexation: {
        method,
        rate: idxConfig.rate ?? 0,
        startYear: idxConfig.startYear ?? 0,
        steps: idxConfig.steps,
      },
    });
  };
  const setIndexationRate = (pct: number): void => {
    updateSellInline({
      indexation: {
        method: idxConfig.method === 'none' ? 'yoy_compound' : idxConfig.method,
        rate: Math.max(0, pct / 100),
        startYear: idxConfig.startYear ?? 0,
        steps: idxConfig.steps,
      },
    });
  };
  const setIndexationStartYear = (yearAbs: number): void => {
    const idx = Math.max(0, Math.min(totalPeriods - 1, yearAbs - projectStartYear));
    updateSellInline({
      indexation: {
        method: idxConfig.method === 'none' ? 'yoy_compound' : idxConfig.method,
        rate: idxConfig.rate ?? 0,
        startYear: idx,
        steps: idxConfig.steps,
      },
    });
  };
  const setStepYear = (stepIdx: number, yearAbs: number): void => {
    const steps = (idxConfig.steps ?? []).slice();
    const idx = Math.max(0, Math.min(totalPeriods - 1, yearAbs - projectStartYear));
    if (!steps[stepIdx]) return;
    steps[stepIdx] = { ...steps[stepIdx], year: idx };
    updateSellInline({ indexation: { ...idxConfig, method: 'step', steps } });
  };
  const setStepUpliftPct = (stepIdx: number, upliftPct: number): void => {
    const steps = (idxConfig.steps ?? []).slice();
    if (!steps[stepIdx]) return;
    const factor = 1 + Math.max(0, upliftPct) / 100;
    steps[stepIdx] = { ...steps[stepIdx], factor };
    updateSellInline({ indexation: { ...idxConfig, method: 'step', steps } });
  };
  const addStep = (): void => {
    const steps = (idxConfig.steps ?? []).slice();
    steps.push({ year: 0, factor: 1.0 });
    updateSellInline({ indexation: { ...idxConfig, method: 'step', steps } });
  };
  const removeStep = (stepIdx: number): void => {
    const steps = (idxConfig.steps ?? []).slice();
    steps.splice(stepIdx, 1);
    updateSellInline({ indexation: { ...idxConfig, method: 'step', steps } });
  };

  // ── Pass 8b (2026-05-18): Hospitality (Operate) config + setters ─
  type OperateCfg = NonNullable<NonNullable<Asset['revenue']>['operate']>;
  type AncillaryCfg = OperateCfg['fb']; // same shape as otherRevenue
  const operateConfig = asset.revenue?.operate;
  const opADRIdx = operateConfig?.adrIndexation ?? { method: 'none' as const };
  const opFb: AncillaryCfg = operateConfig?.fb ?? { mode: 'percent_of_rooms' as const, percentOfRooms: 0 };
  const opOther: AncillaryCfg = operateConfig?.otherRevenue ?? { mode: 'percent_of_rooms' as const, percentOfRooms: 0 };
  const opOccupancy = operateConfig?.occupancyPerPeriod ?? new Array<number>(totalPeriods).fill(0);
  const opGuestsPerOR = operateConfig?.guestsPerOccupiedRoom ?? 1.5;
  const opStartingADR = operateConfig?.startingADR ?? 0;
  const opDSO = operateConfig?.dso ?? 30;

  const updateOperateInline = (patch: Partial<OperateCfg>): void => {
    // Pass 9b (2026-05-18): merge existing + patch FIRST, then coalesce
    // each known field to a default. Spreading `operateConfig` with
    // undefined own properties used to overwrite the default constants,
    // which sent startingADR=undefined into the store and rendered as 0
    // even after the user typed an ADR. Coalescing per-field guarantees
    // every emitted snapshot is a complete, valid OperateCfg.
    const merged: Partial<OperateCfg> = { ...(operateConfig ?? {}), ...patch };
    // Pass 9e (2026-05-18): preserve every key from the merged shape so
    // new optional fields (operationsStartYearOverride, etc.) reach the
    // store. Required fields keep their per-field coalesce so an
    // undefined own-property on a stale snapshot can't clobber the
    // defaults (Pass 9b bug fix).
    const next: OperateCfg = {
      ...merged,
      assetId: asset.id,
      daysPerYear: merged.daysPerYear ?? 365,
      startingADR: merged.startingADR ?? opStartingADR,
      adrIndexation: merged.adrIndexation ?? opADRIdx,
      occupancyPerPeriod: paddedArray(merged.occupancyPerPeriod ?? opOccupancy, totalPeriods),
      guestsPerOccupiedRoom: merged.guestsPerOccupiedRoom ?? opGuestsPerOR,
      fb: merged.fb ?? opFb,
      otherRevenue: merged.otherRevenue ?? opOther,
      dso: merged.dso ?? opDSO,
    };
    updateAsset(asset.id, { revenue: { ...(asset.revenue ?? {}), operate: next } });
  };
  const setOperateADR = (n: number): void => updateOperateInline({ startingADR: Math.max(0, n) });
  const setOperateOccupancy = (idx: number, pct: number): void => {
    const next = paddedArray(opOccupancy, totalPeriods);
    next[idx] = Math.max(0, Math.min(1, pct / 100));
    updateOperateInline({ occupancyPerPeriod: next });
  };
  const setOperateGuestsPerOR = (n: number): void => updateOperateInline({ guestsPerOccupiedRoom: Math.max(0, n) });
  // Pass 8e (2026-05-18): typical hospitality stabilization curve.
  // Ramp 40% / 60% / 65% across years 1-3, then stabilised 67% for the
  // remainder of the operations window. Standard 5-star / urban hotel
  // shape; user can tweak per-year afterward.
  const applyOccupancyStabilizationPreset = (): void => {
    const ramp = [0.40, 0.60, 0.65];
    const stabilized = 0.67;
    const next = paddedArray(opOccupancy, totalPeriods);
    const opLen = operationsEndIdx - operationsStartIdx + 1;
    for (let k = 0; k < opLen; k++) {
      const idx = operationsStartIdx + k;
      next[idx] = k < ramp.length ? ramp[k] : stabilized;
    }
    updateOperateInline({ occupancyPerPeriod: next });
  };
  const setOperateDSO = (n: number): void => updateOperateInline({ dso: Math.max(0, Math.round(n)) });
  const setOperateADRIndexationMethod = (method: 'none' | 'yoy_compound' | 'step' | 'yoy_per_period'): void => {
    updateOperateInline({ adrIndexation: { ...opADRIdx, method } });
  };
  const setOperateADRIndexationRate = (pct: number): void => {
    updateOperateInline({ adrIndexation: { method: opADRIdx.method === 'none' ? 'yoy_compound' : opADRIdx.method, rate: Math.max(0, pct / 100), startYear: opADRIdx.startYear ?? operationsStartIdx } });
  };
  const setOperateADRIndexationStartYear = (yearAbs: number): void => {
    const idx = Math.max(0, Math.min(totalPeriods - 1, yearAbs - projectStartYear));
    updateOperateInline({ adrIndexation: { method: opADRIdx.method === 'none' ? 'yoy_compound' : opADRIdx.method, rate: opADRIdx.rate ?? 0, startYear: idx } });
  };
  // Pass 8e (2026-05-18): per-year ADR growth setter. Allows negative
  // values (e.g., -2% in a recession year). Engine clamps growth ≥ -99%
  // so factor cannot collapse to 0.
  const setOperateADRGrowthPerYear = (periodIdx: number, pctValue: number): void => {
    const current = paddedArray(opADRIdx.growthPerPeriod, totalPeriods);
    current[periodIdx] = pctValue / 100;
    updateOperateInline({ adrIndexation: { ...opADRIdx, method: 'yoy_per_period', growthPerPeriod: current, startYear: opADRIdx.startYear ?? operationsStartIdx } });
  };
  const setFbMode = (mode: 'percent_of_rooms' | 'per_guest' | 'fixed_amount'): void => {
    updateOperateInline({ fb: { ...opFb, mode } });
  };
  const setFbPercent = (pct: number): void => updateOperateInline({ fb: { ...opFb, percentOfRooms: Math.max(0, pct / 100) } });
  const setFbRatePerGuest = (n: number): void => updateOperateInline({ fb: { ...opFb, ratePerGuest: Math.max(0, n) } });
  const setFbFixed = (n: number): void => updateOperateInline({ fb: { ...opFb, fixedAmountPerPeriod: Math.max(0, n) } });
  const setOtherMode = (mode: 'percent_of_rooms' | 'per_guest' | 'fixed_amount'): void => {
    updateOperateInline({ otherRevenue: { ...opOther, mode } });
  };
  const setOtherPercent = (pct: number): void => updateOperateInline({ otherRevenue: { ...opOther, percentOfRooms: Math.max(0, pct / 100) } });
  const setOtherRatePerGuest = (n: number): void => updateOperateInline({ otherRevenue: { ...opOther, ratePerGuest: Math.max(0, n) } });
  const setOtherFixed = (n: number): void => updateOperateInline({ otherRevenue: { ...opOther, fixedAmountPerPeriod: Math.max(0, n) } });

  // ── Pass 9g (2026-05-18): Retail / Office Lease config + setters ─
  type LeaseCfg = NonNullable<NonNullable<Asset['revenue']>['lease']>;
  const leaseConfig = asset.revenue?.lease;
  const leaseRentIdx = leaseConfig?.rentIndexation ?? { method: 'none' as const };
  const leaseOccupancy = leaseConfig?.occupancyPerPeriod ?? new Array<number>(totalPeriods).fill(0);
  const leaseBaseRate = leaseConfig?.baseRate ?? 0;
  const leaseArDays = leaseConfig?.arDays ?? 30;
  const leaseOpsStartOverride = leaseConfig?.operationsStartYearOverride;

  const updateLeaseInline = (patch: Partial<LeaseCfg>): void => {
    const merged: Partial<LeaseCfg> = { ...(leaseConfig ?? {}), ...patch };
    const next: LeaseCfg = {
      ...merged,
      assetId: asset.id,
      baseRate: merged.baseRate ?? leaseBaseRate,
      rentIndexation: merged.rentIndexation ?? leaseRentIdx,
      occupancyPerPeriod: paddedArray(merged.occupancyPerPeriod ?? leaseOccupancy, totalPeriods),
      arDays: merged.arDays ?? leaseArDays,
    };
    updateAsset(asset.id, { revenue: { ...(asset.revenue ?? {}), lease: next } });
  };
  const setLeaseOccupancy = (idx: number, pct: number): void => {
    const next = paddedArray(leaseOccupancy, totalPeriods);
    next[idx] = Math.max(0, Math.min(1, pct / 100));
    updateLeaseInline({ occupancyPerPeriod: next });
  };
  const applyLeaseOccupancyStabilizationPreset = (): void => {
    // Retail / office stabilisation curve (reference v1.16 row 332):
    // ramp 45% / 60% / 75% across years 1-3, then 90% stabilised.
    const ramp = [0.45, 0.60, 0.75];
    const stabilized = 0.90;
    const next = paddedArray(leaseOccupancy, totalPeriods);
    const opLen = operationsEndIdx - operationsStartIdx + 1;
    for (let k = 0; k < opLen; k++) {
      const idx = operationsStartIdx + k;
      next[idx] = k < ramp.length ? ramp[k] : stabilized;
    }
    updateLeaseInline({ occupancyPerPeriod: next });
  };
  const setLeaseArDays = (n: number): void => updateLeaseInline({ arDays: Math.max(0, Math.round(n)) });
  const setLeaseRentIndexationMethod = (method: 'none' | 'yoy_compound' | 'step' | 'yoy_per_period'): void => {
    updateLeaseInline({ rentIndexation: { ...leaseRentIdx, method } });
  };
  const setLeaseRentIndexationRate = (pct: number): void => {
    updateLeaseInline({ rentIndexation: { method: leaseRentIdx.method === 'none' ? 'yoy_compound' : leaseRentIdx.method, rate: Math.max(0, pct / 100), startYear: leaseRentIdx.startYear ?? operationsStartIdx } });
  };
  const setLeaseRentIndexationStartYear = (yearAbs: number): void => {
    const idx = Math.max(0, Math.min(totalPeriods - 1, yearAbs - projectStartYear));
    updateLeaseInline({ rentIndexation: { method: leaseRentIdx.method === 'none' ? 'yoy_compound' : leaseRentIdx.method, rate: leaseRentIdx.rate ?? 0, startYear: idx } });
  };
  const setLeaseRentGrowthPerYear = (periodIdx: number, pctValue: number): void => {
    const current = paddedArray(leaseRentIdx.growthPerPeriod, totalPeriods);
    current[periodIdx] = pctValue / 100;
    updateLeaseInline({ rentIndexation: { ...leaseRentIdx, method: 'yoy_per_period', growthPerPeriod: current, startYear: leaseRentIdx.startYear ?? operationsStartIdx } });
  };

  // Read scalar values (or pull index 0 from arrays for legacy data)
  const scalarOf = (v: number | number[] | undefined): number => {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    return v[0] ?? 0;
  };

  const cashSum = cashProfile.percentages.reduce((s, v) => s + v, 0);
  const cashSumOk = Math.abs(cashSum - 1) < 0.005;
  const recSum = (recProfile.percentages ?? []).reduce((s, v) => s + v, 0);
  const recSumOk = recProfile.method === 'point_in_time' || Math.abs(recSum - 1) < 0.005;

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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: (isSell || isHospitality || isLease) && !assetCollapsed ? 'var(--sp-2)' : 0, flexWrap: 'wrap' }}>
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
      </div>

      {isHospitality && !assetCollapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
          <SubUnitReferenceStrip units={subUnits} currency={project.currency || ''} mode="operate" />

          {operationsWindow.length === 0 ? (
            <div style={{ padding: '6px 10px', background: 'var(--color-surface-alt, #f3f4f6)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
              Phase has no operations periods. Set them on Module 1 Tab 1.
            </div>
          ) : (
            <>
              {/* ADR (Pass 9e: asset-level Starting ADR input removed —
                  per-sub-unit ADR comes from Module 1 Tab 2 startingAdr.
                  Indexation pills + Per-Year strip remain at the asset
                  level since they apply uniformly to all room types
                  unless overridden via SubUnit.hospitalityIndexation.) */}
              <InlineSection
                title={`ADR Indexation · Operations ${operationsWindow[0].year} to ${operationsWindow[operationsWindow.length - 1].year}`}
                hint="Per-sub-unit ADR is entered in Module 1 Tab 2 (Starting ADR per room type). Indexation escalates each sub-unit's ADR from Start Year onwards (unless a sub-unit carries its own indexation override)."
              >
                <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>Indexation</span>
                  <MethodPill active={opADRIdx.method === 'none'} label="None" onClick={() => setOperateADRIndexationMethod('none')} />
                  <MethodPill active={opADRIdx.method === 'yoy_compound'} label="YoY Compound" onClick={() => setOperateADRIndexationMethod('yoy_compound')} />
                  <MethodPill active={opADRIdx.method === 'yoy_per_period'} label="Per-Year" onClick={() => setOperateADRIndexationMethod('yoy_per_period')} />
                  <MethodPill active={opADRIdx.method === 'step'} label="Step" onClick={() => setOperateADRIndexationMethod('step')} />
                  {opADRIdx.method === 'yoy_compound' && (
                    <>
                      <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Rate %</span>
                      <div style={{ width: 80 }}>
                        <PercentageInput
                          value={(opADRIdx.rate ?? 0) * 100}
                          onChange={setOperateADRIndexationRate}
                          min={0}
                          max={50}
                          decimals={2}
                          style={FAST_INPUT}
                          data-testid={`m2-asset-${asset.id}-adr-idx-rate`}
                        />
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Start Year</span>
                      <div style={{ width: 90 }}>
                        <input
                          type="number"
                          value={projectStartYear + (opADRIdx.startYear ?? operationsStartIdx)}
                          min={projectStartYear}
                          max={projectStartYear + Math.max(0, totalPeriods - 1)}
                          onChange={(e) => setOperateADRIndexationStartYear(Number(e.target.value))}
                          style={FAST_INPUT}
                          data-testid={`m2-asset-${asset.id}-adr-idx-startyear`}
                        />
                      </div>
                    </>
                  )}
                  {opADRIdx.method === 'yoy_per_period' && (
                    <>
                      <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Start Year</span>
                      <div style={{ width: 90 }}>
                        <input
                          type="number"
                          value={projectStartYear + (opADRIdx.startYear ?? operationsStartIdx)}
                          min={projectStartYear}
                          max={projectStartYear + Math.max(0, totalPeriods - 1)}
                          onChange={(e) => setOperateADRIndexationStartYear(Number(e.target.value))}
                          style={FAST_INPUT}
                          data-testid={`m2-asset-${asset.id}-adr-idx-pyrgrowth-start`}
                        />
                      </div>
                    </>
                  )}
                </div>
                {opADRIdx.method === 'yoy_per_period' && operationsWindow.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic', marginBottom: 4 }}>
                      Per-year growth from Start Year. Compounds cumulatively: ADR[y] = ADR[y-1] × (1 + growth[y]). Negative values allowed (engine clamps growth ≥ -99%). Year matching Start Year stays at base.
                    </div>
                    <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
                      <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ ...CELL_HEADER, textAlign: 'left', minWidth: 140 }}>ADR Growth %</th>
                            {operationsWindow.map((c) => (
                              <th key={c.idx} style={{ ...CELL_HEADER, minWidth: 55 }}>
                                {c.year}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td style={{ padding: '4px 6px', fontWeight: 700, color: 'var(--color-heading)', borderRight: '1px solid var(--color-border)' }}>
                              YoY growth
                            </td>
                            {operationsWindow.map((c) => (
                              <td key={c.idx} style={{ padding: '2px 3px', textAlign: 'center' }}>
                                <PercentageInput
                                  value={((opADRIdx.growthPerPeriod ?? [])[c.idx] ?? 0) * 100}
                                  onChange={(n) => setOperateADRGrowthPerYear(c.idx, n)}
                                  min={-50}
                                  max={100}
                                  decimals={2}
                                  style={FAST_INPUT}
                                  data-testid={`m2-asset-${asset.id}-adr-pyrgrowth-${c.idx}`}
                                />
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </InlineSection>

              {/* Pass 9e (2026-05-18): Per Room Type split table (Pass 9c)
                  removed. Sub-unit Starting ADR is now Module 1's
                  single edit surface; the read-only sub-unit chip
                  strip above renders the current values for context. */}

              {/* Pass 9e (2026-05-18): operations start year override.
                  Default is the year after handover; user can pull it
                  forward to soft-open mid-construction. */}
              <InlineSection
                title="Operations start year"
                hint="Defaults to the year after handover. Override to soft-open mid-construction (hotel running while still building) or push to any specific year."
              >
                <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>Start operations in</span>
                  <div style={{ width: 90 }}>
                    <input
                      type="number"
                      value={projectStartYear + operationsStartIdx}
                      min={projectStartYear + constructionStartIdx}
                      max={projectStartYear + Math.max(0, totalPeriods - 1)}
                      onChange={(e) => {
                        const yr = Number(e.target.value);
                        const defaultYr = projectStartYear + defaultOperationsStartIdx;
                        updateOperateInline({ operationsStartYearOverride: yr === defaultYr ? undefined : yr });
                      }}
                      style={FAST_INPUT}
                      data-testid={`m2-asset-${asset.id}-ops-start-year`}
                    />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>
                    Default (after handover): {projectStartYear + defaultOperationsStartIdx}
                  </span>
                  {opsStartOverride != null && (
                    <button
                      type="button"
                      onClick={() => updateOperateInline({ operationsStartYearOverride: undefined })}
                      style={{
                        fontSize: 10,
                        padding: '2px 8px',
                        background: 'var(--color-surface)',
                        color: 'var(--color-meta)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                      }}
                    >
                      Reset to default
                    </button>
                  )}
                </div>
              </InlineSection>

              {/* Occupancy ramp */}
              <InlineSection
                title="Occupancy ramp"
                hint="Per-year occupancy %. Drives Occupied Room Nights = Keys × 365 × Occupancy."
                tag={(() => {
                  const visible = operationsWindow.map((c) => opOccupancy[c.idx] ?? 0);
                  const max = Math.max(0, ...visible);
                  return `peak ${(max * 100).toFixed(0)}%`;
                })()}
              >
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                  <button
                    type="button"
                    onClick={applyOccupancyStabilizationPreset}
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
                    title="Fill the operations window with a typical stabilization curve: yr1 40% / yr2 60% / yr3 65% / yr4+ stabilised 67%. Edit per-year afterward."
                    data-testid={`m2-asset-${asset.id}-occ-preset`}
                  >
                    Apply stabilization curve (40 → 60 → 65 → 67%)
                  </button>
                </div>
                <InlineProfileStrip
                  cells={operationsWindow}
                  values={opOccupancy}
                  onChange={setOperateOccupancy}
                  testidPrefix={`m2-asset-${asset.id}-occ`}
                  showCumulative={false}
                  label="Occupancy"
                />
              </InlineSection>

              {/* Guests per occupied room night */}
              <InlineSection
                title="Average guests per occupied room night"
                hint="Used by per-guest F&B / Other revenue modes. Default 1.5."
              >
                <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
                  <div style={{ width: 80 }}>
                    <AccountingNumberInput
                      value={opGuestsPerOR}
                      onChange={setOperateGuestsPerOR}
                      scale="full"
                      decimals={2}
                      min={0}
                      style={FAST_INPUT}
                      data-testid={`m2-asset-${asset.id}-guests-per-or`}
                    />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>
                    Guests / Year = Occupied Room Nights × {opGuestsPerOR.toFixed(2)}
                  </span>
                </div>
              </InlineSection>

              {/* F&B Revenue */}
              <InlineSection
                title="F&B Revenue"
                hint="Pick the driver. % of Rooms = F&B as % of Rooms revenue. Per Guest = guests × rate per guest. Baseline + Growth = explicit baseline amount escalated by an indexation rate."
              >
                <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <MethodPill active={opFb.mode === 'percent_of_rooms'} label="% of Rooms" onClick={() => setFbMode('percent_of_rooms')} />
                  <MethodPill active={opFb.mode === 'per_guest'} label="Per Guest" onClick={() => setFbMode('per_guest')} />
                  <MethodPill active={opFb.mode === 'fixed_amount'} label="Baseline + Growth" onClick={() => setFbMode('fixed_amount')} />
                  {opFb.mode === 'percent_of_rooms' && (
                    <>
                      <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>F&B %</span>
                      <div style={{ width: 80 }}>
                        <PercentageInput
                          value={scalarOf(opFb.percentOfRooms) * 100}
                          onChange={setFbPercent}
                          min={0}
                          max={200}
                          decimals={2}
                          style={FAST_INPUT}
                          data-testid={`m2-asset-${asset.id}-fb-pct`}
                        />
                      </div>
                    </>
                  )}
                  {opFb.mode === 'per_guest' && (
                    <>
                      <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Rate per Guest ({project.currency})</span>
                      <div style={{ width: 120 }}>
                        <AccountingNumberInput
                          value={scalarOf(opFb.ratePerGuest)}
                          onChange={setFbRatePerGuest}
                          scale="full"
                          decimals={0}
                          min={0}
                          style={FAST_INPUT}
                          data-testid={`m2-asset-${asset.id}-fb-rate`}
                        />
                      </div>
                    </>
                  )}
                  {opFb.mode === 'fixed_amount' && (
                    <>
                      <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Baseline Amount ({project.currency})</span>
                      <div style={{ width: 150 }}>
                        <AccountingNumberInput
                          value={scalarOf(opFb.fixedAmountPerPeriod)}
                          onChange={setFbFixed}
                          scale="full"
                          decimals={0}
                          min={0}
                          style={FAST_INPUT}
                          data-testid={`m2-asset-${asset.id}-fb-fixed`}
                        />
                      </div>
                    </>
                  )}
                </div>
              </InlineSection>

              {/* Other Revenue */}
              <InlineSection
                title="Other Revenue"
                hint="Same flexibility as F&B. Use for spa / parking / minibar / banqueting rollups, or set Baseline + Growth for a contractual line that escalates over time."
              >
                <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <MethodPill active={opOther.mode === 'percent_of_rooms'} label="% of Rooms" onClick={() => setOtherMode('percent_of_rooms')} />
                  <MethodPill active={opOther.mode === 'per_guest'} label="Per Guest" onClick={() => setOtherMode('per_guest')} />
                  <MethodPill active={opOther.mode === 'fixed_amount'} label="Baseline + Growth" onClick={() => setOtherMode('fixed_amount')} />
                  {opOther.mode === 'percent_of_rooms' && (
                    <>
                      <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Other %</span>
                      <div style={{ width: 80 }}>
                        <PercentageInput
                          value={scalarOf(opOther.percentOfRooms) * 100}
                          onChange={setOtherPercent}
                          min={0}
                          max={200}
                          decimals={2}
                          style={FAST_INPUT}
                          data-testid={`m2-asset-${asset.id}-other-pct`}
                        />
                      </div>
                    </>
                  )}
                  {opOther.mode === 'per_guest' && (
                    <>
                      <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Rate per Guest ({project.currency})</span>
                      <div style={{ width: 120 }}>
                        <AccountingNumberInput
                          value={scalarOf(opOther.ratePerGuest)}
                          onChange={setOtherRatePerGuest}
                          scale="full"
                          decimals={0}
                          min={0}
                          style={FAST_INPUT}
                          data-testid={`m2-asset-${asset.id}-other-rate`}
                        />
                      </div>
                    </>
                  )}
                  {opOther.mode === 'fixed_amount' && (
                    <>
                      <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Baseline Amount ({project.currency})</span>
                      <div style={{ width: 150 }}>
                        <AccountingNumberInput
                          value={scalarOf(opOther.fixedAmountPerPeriod)}
                          onChange={setOtherFixed}
                          scale="full"
                          decimals={0}
                          min={0}
                          style={FAST_INPUT}
                          data-testid={`m2-asset-${asset.id}-other-fixed`}
                        />
                      </div>
                    </>
                  )}
                </div>
              </InlineSection>

              {/* DSO (drives AR roll-forward, Pass 8d) */}
              <InlineSection
                title="Accounts Receivable Days"
                hint="Drives the AR roll-forward on the Schedules tab. Hospitality default 30 days. (Industry term: DSO, Days Sales Outstanding.)"
              >
                <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
                  <div style={{ width: 80 }}>
                    <AccountingNumberInput
                      value={opDSO}
                      onChange={setOperateDSO}
                      scale="full"
                      decimals={0}
                      min={0}
                      style={FAST_INPUT}
                      data-testid={`m2-asset-${asset.id}-dso`}
                    />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>days</span>
                </div>
              </InlineSection>
            </>
          )}
        </div>
      )}

      {!isSell && !isHospitality && !isLease && !assetCollapsed && (
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

      {isLease && !assetCollapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
          <SubUnitReferenceStrip units={subUnits} currency={project.currency || ''} mode="lease" />

          {operationsWindow.length === 0 ? (
            <div style={{ padding: '6px 10px', background: 'var(--color-surface-alt, #f3f4f6)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
              Phase has no operations periods. Set them on Module 1 Tab 1.
            </div>
          ) : (
            <>
              <InlineSection
                title={`Rent Indexation · Operations ${operationsWindow[0].year} to ${operationsWindow[operationsWindow.length - 1].year}`}
                hint="Per-sub-unit base rates come from Module 1 Tab 2 (Unit price per sqm/yr). Indexation escalates each sub-unit's rate from Start Year onwards."
              >
                <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>Indexation</span>
                  <MethodPill active={leaseRentIdx.method === 'none'} label="None" onClick={() => setLeaseRentIndexationMethod('none')} />
                  <MethodPill active={leaseRentIdx.method === 'yoy_compound'} label="YoY Compound" onClick={() => setLeaseRentIndexationMethod('yoy_compound')} />
                  <MethodPill active={leaseRentIdx.method === 'yoy_per_period'} label="Per-Year" onClick={() => setLeaseRentIndexationMethod('yoy_per_period')} />
                  <MethodPill active={leaseRentIdx.method === 'step'} label="Step" onClick={() => setLeaseRentIndexationMethod('step')} />
                  {leaseRentIdx.method === 'yoy_compound' && (
                    <>
                      <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Rate %</span>
                      <div style={{ width: 80 }}>
                        <PercentageInput
                          value={(leaseRentIdx.rate ?? 0) * 100}
                          onChange={setLeaseRentIndexationRate}
                          min={0}
                          max={50}
                          decimals={2}
                          style={FAST_INPUT}
                          data-testid={`m2-asset-${asset.id}-lease-rent-idx-rate`}
                        />
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Start Year</span>
                      <div style={{ width: 90 }}>
                        <input
                          type="number"
                          value={projectStartYear + (leaseRentIdx.startYear ?? operationsStartIdx)}
                          min={projectStartYear}
                          max={projectStartYear + Math.max(0, totalPeriods - 1)}
                          onChange={(e) => setLeaseRentIndexationStartYear(Number(e.target.value))}
                          style={FAST_INPUT}
                          data-testid={`m2-asset-${asset.id}-lease-rent-idx-startyear`}
                        />
                      </div>
                    </>
                  )}
                  {leaseRentIdx.method === 'yoy_per_period' && (
                    <>
                      <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Start Year</span>
                      <div style={{ width: 90 }}>
                        <input
                          type="number"
                          value={projectStartYear + (leaseRentIdx.startYear ?? operationsStartIdx)}
                          min={projectStartYear}
                          max={projectStartYear + Math.max(0, totalPeriods - 1)}
                          onChange={(e) => setLeaseRentIndexationStartYear(Number(e.target.value))}
                          style={FAST_INPUT}
                          data-testid={`m2-asset-${asset.id}-lease-rent-idx-pyrgrowth-start`}
                        />
                      </div>
                    </>
                  )}
                </div>
                {leaseRentIdx.method === 'yoy_per_period' && operationsWindow.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic', marginBottom: 4 }}>
                      Per-year growth from Start Year. Compounds cumulatively: Rate[y] = Rate[y-1] × (1 + growth[y]). Negative values allowed.
                    </div>
                    <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
                      <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ ...CELL_HEADER, textAlign: 'left', minWidth: 140 }}>Rent Growth %</th>
                            {operationsWindow.map((c) => (
                              <th key={c.idx} style={{ ...CELL_HEADER, minWidth: 55 }}>
                                {c.year}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td style={{ padding: '4px 6px', fontWeight: 700, color: 'var(--color-heading)', borderRight: '1px solid var(--color-border)' }}>
                              YoY growth
                            </td>
                            {operationsWindow.map((c) => (
                              <td key={c.idx} style={{ padding: '2px 3px', textAlign: 'center' }}>
                                <PercentageInput
                                  value={((leaseRentIdx.growthPerPeriod ?? [])[c.idx] ?? 0) * 100}
                                  onChange={(n) => setLeaseRentGrowthPerYear(c.idx, n)}
                                  min={-50}
                                  max={100}
                                  decimals={2}
                                  style={FAST_INPUT}
                                  data-testid={`m2-asset-${asset.id}-lease-rent-pyrgrowth-${c.idx}`}
                                />
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </InlineSection>

              <InlineSection
                title="Operations start year"
                hint="Defaults to the year after handover. Override to soft-open mid-construction or push to any specific year."
              >
                <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>Start operations in</span>
                  <div style={{ width: 90 }}>
                    <input
                      type="number"
                      value={projectStartYear + operationsStartIdx}
                      min={projectStartYear + constructionStartIdx}
                      max={projectStartYear + Math.max(0, totalPeriods - 1)}
                      onChange={(e) => {
                        const yr = Number(e.target.value);
                        const defaultYr = projectStartYear + defaultOperationsStartIdx;
                        updateLeaseInline({ operationsStartYearOverride: yr === defaultYr ? undefined : yr });
                      }}
                      style={FAST_INPUT}
                      data-testid={`m2-asset-${asset.id}-lease-ops-start-year`}
                    />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>
                    Default (after handover): {projectStartYear + defaultOperationsStartIdx}
                  </span>
                  {leaseOpsStartOverride != null && (
                    <button
                      type="button"
                      onClick={() => updateLeaseInline({ operationsStartYearOverride: undefined })}
                      style={{
                        fontSize: 10,
                        padding: '2px 8px',
                        background: 'var(--color-surface)',
                        color: 'var(--color-meta)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                      }}
                    >
                      Reset to default
                    </button>
                  )}
                </div>
              </InlineSection>

              <InlineSection
                title="Occupancy ramp"
                hint="Per-year occupancy %. Drives Occupied Lease Area = GLA × Occupancy."
                tag={(() => {
                  const visible = operationsWindow.map((c) => leaseOccupancy[c.idx] ?? 0);
                  const max = Math.max(0, ...visible);
                  return `peak ${(max * 100).toFixed(0)}%`;
                })()}
              >
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                  <button
                    type="button"
                    onClick={applyLeaseOccupancyStabilizationPreset}
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
                    title="Fill the operations window with a typical retail / office ramp: yr1 45% / yr2 60% / yr3 75% / yr4+ stabilised 90%."
                    data-testid={`m2-asset-${asset.id}-lease-occ-preset`}
                  >
                    Apply ramp (45 → 60 → 75 → 90%)
                  </button>
                </div>
                <InlineProfileStrip
                  cells={operationsWindow}
                  values={leaseOccupancy}
                  onChange={setLeaseOccupancy}
                  testidPrefix={`m2-asset-${asset.id}-lease-occ`}
                  showCumulative={false}
                  label="Occupancy"
                />
              </InlineSection>

              <InlineSection
                title="Accounts Receivable Days"
                hint="Days between revenue recognition (per-period rent earned) and cash collection. Default 30 days."
              >
                <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>AR days</span>
                  <div style={{ width: 80 }}>
                    <input
                      type="number"
                      value={leaseArDays}
                      min={0}
                      max={365}
                      onChange={(e) => setLeaseArDays(Number(e.target.value))}
                      style={FAST_INPUT}
                      data-testid={`m2-asset-${asset.id}-lease-ar-days`}
                    />
                  </div>
                </div>
              </InlineSection>
            </>
          )}
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

          {/* Pass 7x: sub-unit reference strip so users can verify the
              area + price they entered in M1 Tab 2 without switching
              tabs. */}
          <SubUnitReferenceStrip units={subUnits} currency={project.currency || ''} />

          {/* Pass 7v: per-asset velocity view toggle. Default collapsed
              (lockstep across all sub-units); opt-in split exposes the
              per-sub-unit editor. */}
          {subUnits.length > 1 && (constructionWindow.length > 0 || operationsWindow.length > 0) && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -2 }}>
              <button
                type="button"
                onClick={() => setSplitVelocity(!splitVelocity)}
                style={{
                  fontSize: 10,
                  padding: '3px 8px',
                  background: splitVelocity ? 'var(--color-navy-pale)' : 'var(--color-surface)',
                  color: splitVelocity ? 'var(--color-navy)' : 'var(--color-meta)',
                  border: `1px solid ${splitVelocity ? 'var(--color-navy)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
                data-testid={`m2-asset-${asset.id}-velocity-split-toggle`}
                title={splitVelocity
                  ? 'Combine: one shared schedule across all sub-units (writes propagate to every sub-unit).'
                  : 'Split: edit a separate velocity schedule per sub-unit (1BR vs Penthouse absorb differently).'}
              >
                {splitVelocity ? '▾ Combine sub-units' : '▸ Split per sub-unit'}
              </button>
            </div>
          )}

          {/* Pre-Sales velocity, scoped to construction window */}
          {constructionWindow.length > 0 && (
            <InlineSection
              title={`Pre-Sales velocity · Construction ${constructionWindow[0].year} to ${constructionWindow[constructionWindow.length - 1].year}`}
              hint="Pre-sales run during the asset's construction period. Sum per sub-unit + post-sales sum <= 100%. Handover column marked with *."
            >
              <InlineGrid
                cells={constructionWindow}
                rows={splitVelocity || subUnits.length === 1
                  ? subUnits.map((su) => buildVelocityRow(su, sellConfig, project.currency, totalPeriods, 'pre', (suId, idx, pct) => setVelocity(suId, idx, pct, 'pre')))
                  : [buildSharedVelocityRow(sellConfig, subUnits, totalPeriods, 'pre', (idx, pct) => setVelocityForAllSubUnits(idx, pct, 'pre'))]}
              />
            </InlineSection>
          )}

          {/* Post-Sales velocity, scoped to operations window */}
          {operationsWindow.length > 0 && (
            <InlineSection
              title={`Sales During Operation · ${operationsWindow[0].year} to ${operationsWindow[operationsWindow.length - 1].year}`}
              hint="Sales during operating period. Applies to residual units left over after pre-sales. Collected + recognised in the same year."
            >
              <InlineGrid
                cells={operationsWindow}
                rows={splitVelocity || subUnits.length === 1
                  ? subUnits.map((su) => buildVelocityRow(su, sellConfig, project.currency, totalPeriods, 'post', (suId, idx, pct) => setVelocity(suId, idx, pct, 'post')))
                  : [buildSharedVelocityRow(sellConfig, subUnits, totalPeriods, 'post', (idx, pct) => setVelocityForAllSubUnits(idx, pct, 'post'))]}
              />
            </InlineSection>
          )}

          {constructionWindow.length === 0 && operationsWindow.length === 0 && (
            <div style={{ padding: '6px 10px', background: 'var(--color-surface-alt, #f3f4f6)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
              Phase has no construction or operations periods. Set them on Module 1 · Tab 1.
            </div>
          )}

          {/* Pass 7h (2026-05-17): Year-on-year SQM sold preview moved
              to the Revenue Output tab so the Inputs surface stays
              focused on what the user is editing. */}

          {/* Price Indexation */}
          <InlineSection
            title="Price Indexation"
            hint="Base sale rate per sub-unit (M1 Tab 2) lifts by the indexation factor each year. Method controls how the factor evolves with time."
          >
            <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', flexWrap: 'wrap' }}>
              <MethodPill active={idxConfig.method === 'none'} label="None" onClick={() => setIndexationMethod('none')} />
              <MethodPill active={idxConfig.method === 'yoy_compound'} label="YoY Compound" onClick={() => setIndexationMethod('yoy_compound')} />
              <MethodPill active={idxConfig.method === 'step'} label="Step" onClick={() => setIndexationMethod('step')} />
              {idxConfig.method === 'yoy_compound' && (
                <>
                  <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Rate %</span>
                  <div style={{ width: 80 }}>
                    <PercentageInput
                      value={(idxConfig.rate ?? 0) * 100}
                      onChange={setIndexationRate}
                      min={0}
                      max={50}
                      decimals={2}
                      style={FAST_INPUT}
                      data-testid={`m2-asset-${asset.id}-idx-rate`}
                    />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 8 }}>Start Year</span>
                  <div style={{ width: 90 }}>
                    <input
                      type="number"
                      value={projectStartYear + (idxConfig.startYear ?? 0)}
                      min={projectStartYear}
                      max={projectStartYear + Math.max(0, totalPeriods - 1)}
                      onChange={(e) => setIndexationStartYear(Number(e.target.value))}
                      style={FAST_INPUT}
                      data-testid={`m2-asset-${asset.id}-idx-startyear`}
                    />
                  </div>
                </>
              )}
            </div>
            {idxConfig.method !== 'none' && (
              <div style={{ marginTop: 6, padding: '6px 10px', background: 'var(--color-grey-pale)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 10, color: 'var(--color-meta)', lineHeight: 1.5 }}>
                {idxConfig.method === 'yoy_compound' && (
                  <>
                    <strong>YoY Compound:</strong> rate compounds annually from Start Year. rate(year) = base &times; (1 + {(idxConfig.rate ?? 0) * 100}%)<sup>(year &minus; Start Year)</sup>. Year 0 from Start Year = base; each subsequent year multiplies again.
                  </>
                )}
                {idxConfig.method === 'step' && (
                  <>
                    <strong>Step:</strong> declare specific years and the multiplier to apply from that year forward. The latest step year &le; current year wins. Example: 2030 &rarr; 1.05 (5% uplift), 2035 &rarr; 1.10 (10% uplift). Use to model contracted rent reviews or staged price increases.
                  </>
                )}
              </div>
            )}
            {idxConfig.method === 'step' && (
              <div style={{ marginTop: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <strong style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-heading)' }}>
                    Step Schedule
                  </strong>
                  <button
                    type="button"
                    onClick={addStep}
                    data-testid={`m2-asset-${asset.id}-idx-add-step`}
                    style={{ fontSize: 10, padding: '3px 8px', background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)', border: '1px solid var(--color-navy)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 700 }}
                  >
                    + Add Step
                  </button>
                </div>
                {(idxConfig.steps ?? []).length === 0 ? (
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                    No steps yet. Add one to set a year + uplift %.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
                    <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={CELL_HEADER}>Step</th>
                          <th style={CELL_HEADER}>Year</th>
                          <th style={CELL_HEADER}>Uplift %</th>
                          <th style={CELL_HEADER}>Factor</th>
                          <th style={CELL_HEADER}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(idxConfig.steps ?? []).map((step, sIdx) => {
                          const upliftPct = (Math.max(1, step.factor) - 1) * 100;
                          return (
                            <tr key={sIdx}>
                              <td style={{ padding: '4px 6px', textAlign: 'center', color: 'var(--color-meta)' }}>#{sIdx + 1}</td>
                              <td style={{ padding: '2px 4px' }}>
                                <input
                                  type="number"
                                  value={projectStartYear + step.year}
                                  min={projectStartYear}
                                  max={projectStartYear + Math.max(0, totalPeriods - 1)}
                                  onChange={(e) => setStepYear(sIdx, Number(e.target.value))}
                                  style={FAST_INPUT}
                                  data-testid={`m2-asset-${asset.id}-idx-step-${sIdx}-year`}
                                />
                              </td>
                              <td style={{ padding: '2px 4px' }}>
                                <PercentageInput
                                  value={upliftPct}
                                  onChange={(n) => setStepUpliftPct(sIdx, n)}
                                  min={0}
                                  max={500}
                                  decimals={2}
                                  style={FAST_INPUT}
                                  data-testid={`m2-asset-${asset.id}-idx-step-${sIdx}-pct`}
                                />
                              </td>
                              <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--color-meta)' }}>
                                {step.factor.toFixed(4)}
                              </td>
                              <td style={{ padding: '2px 4px', textAlign: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => removeStep(sIdx)}
                                  style={{ fontSize: 10, padding: '2px 6px', background: 'var(--color-surface)', color: 'var(--color-warning, #92400e)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                                  data-testid={`m2-asset-${asset.id}-idx-step-${sIdx}-remove`}
                                >
                                  remove
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </InlineSection>

          {/* Revenue Recognition (full row, ABOVE Cash) */}
          <InlineSection
            title="Revenue Recognition"
            tag={recProfile.method === 'over_time' ? `Sum: ${(recSum * 100).toFixed(1)}%` : undefined}
            tagColor={recSumOk ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)'}
          >
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <MethodPill
                active={recProfile.method !== 'over_time'}
                label="Point-in-Time"
                onClick={() => setRecognitionMethod('point_in_time')}
              />
              <MethodPill
                active={recProfile.method === 'over_time'}
                label="Over-Time"
                onClick={() => setRecognitionMethod('over_time')}
              />
            </div>
            {recProfile.method === 'point_in_time' && (
              <>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                  <MethodPill
                    active={(recProfile.pointInTimeYear ?? 'handover') === 'handover'}
                    label={`At handover (${yearLabels[handoverYear] ?? '?'})`}
                    onClick={() => setRecognitionAnchor('handover')}
                  />
                  <MethodPill
                    active={recProfile.pointInTimeYear === 'sale_year'}
                    label="At sale year"
                    onClick={() => setRecognitionAnchor('sale_year')}
                  />
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic', lineHeight: 1.4 }}>
                  {(recProfile.pointInTimeYear ?? 'handover') === 'handover'
                    ? <>
                        <strong>Rule:</strong> handover = LAST construction year (={yearLabels[handoverYear]}), not the first operations year. Every pre-sales cohort (2026-{yearLabels[handoverYear]}) lumps 100% of revenue at {yearLabels[handoverYear]}. Sales During Operation recognise in their own sale year (operating-sales convention).
                      </>
                    : 'Each cohort recognises 100% of revenue in the same year it is sold.'}
                </div>
              </>
            )}
            {recProfile.method === 'over_time' && (
              <div style={{ marginTop: 6 }}>
                <InlineProfileStrip
                  cells={cashWindow}
                  values={recProfile.percentages ?? []}
                  onChange={setRecognitionPct}
                  testidPrefix={`m2-rec-${asset.id}`}
                />
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic' }}>
                  Percent of cohort recognised per project year. Catch-up applies at the cohort sale year (absolute mode). Total must sum to 100%.
                </div>
              </div>
            )}
          </InlineSection>

          {/* Cash Payment Profile (full row, BELOW Recognition) */}
          <InlineSection
            title={`Cash payment profile · ${cashWindow[0]?.year ?? '?'} to ${cashWindow[cashWindow.length - 1]?.year ?? '?'}`}
            hint="Milestones (% of cohort value collected per project year). Cohort sold in year N catches up cumulative-to-N at N then per profile in later years."
            tag={`Sum: ${(cashSum * 100).toFixed(1)}%`}
            tagColor={cashSumOk ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)'}
          >
            <InlineProfileStrip
              cells={cashWindow}
              values={cashProfile.percentages}
              onChange={setCashPct}
              testidPrefix={`m2-cash-${asset.id}`}
            />
          </InlineSection>
        </div>
      )}
    </div>
  );
}

// Build a velocity row for the inline grid. Sub-unit label includes
// the sale price (per unit or per sqm, depending on metric) read
// directly from M1 Tab 2; the price stays read-only on this surface
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
    ? `${Math.round(Math.max(0, su.metricValue)).toLocaleString()} units`
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

// Pass 7v (2026-05-18): shared velocity row across all sub-units.
// Reads sub-unit[0]'s schedule as the representative values and flags
// divergence when sub-units have drifted apart (auto-detection so the
// user knows editing in shared mode will overwrite all).
function buildSharedVelocityRow(
  cfg: { subUnits: Array<{ subUnitId: string; preSalesVelocity: number[]; postSalesVelocity: number[] }> } | undefined,
  subUnitsInAsset: SubUnit[],
  totalPeriods: number,
  kind: 'pre' | 'post',
  onChange: (periodIdx: number, pct: number) => void,
): InlineGridRow {
  const arrays = subUnitsInAsset.map((su) => {
    const cfgSU = cfg?.subUnits.find((s) => s.subUnitId === su.id);
    const arr = kind === 'pre' ? cfgSU?.preSalesVelocity : cfgSU?.postSalesVelocity;
    return paddedArray(arr, totalPeriods);
  });
  const first = arrays[0] ?? new Array<number>(totalPeriods).fill(0);
  const divergent = arrays.length > 1
    && arrays.some((arr) => arr.some((v, i) => Math.abs(v - first[i]) > 1e-9));
  // Also flag divergence between pre + post sums when one would push
  // the asset above 100% sold.
  const preSumFirst = (kind === 'pre' ? first : (cfg?.subUnits[0]?.preSalesVelocity ?? [])).reduce((s, v) => s + v, 0);
  const postSumFirst = (kind === 'post' ? first : (cfg?.subUnits[0]?.postSalesVelocity ?? [])).reduce((s, v) => s + v, 0);
  const sumSelf = kind === 'pre' ? preSumFirst : postSumFirst;
  const sumAll = preSumFirst + postSumFirst;
  const overall = sumAll > 1 + 1e-6;

  const subUnitCountLabel = `${subUnitsInAsset.length} sub-unit${subUnitsInAsset.length === 1 ? '' : 's'}`;
  const sumHint = sumSelf > 0 ? ` · ${kind === 'pre' ? 'pre' : 'post'} ${(sumSelf * 100).toFixed(0)}%` : '';
  const totalHint = sumAll > 0 && kind === 'pre' ? ` · total ${(sumAll * 100).toFixed(0)}%` : '';
  const divergenceHint = divergent ? ' · sub-units differ; editing overwrites all' : '';

  return {
    id: '__shared__',
    label: 'All sub-units',
    priceHint: subUnitCountLabel,
    hint: `Lockstep across every sub-unit${sumHint}${totalHint}${divergenceHint}`,
    sumOver: overall,
    values: first,
    onChange: (idx, pct) => onChange(idx, pct),
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

// Universal Total cell token. Sits between the label column and the
// year columns on every editable calc grid, matching the Total column
// pattern from Module 1 results tables (CELL_HEADER_TOTAL on header,
// dashed-right separator on cells).
const HEADER_TOTAL_CELL: React.CSSProperties = {
  ...CELL_HEADER,
  minWidth: 70,
  borderRight: '1px dashed color-mix(in srgb, var(--color-on-primary-navy) 50%, transparent)',
};
const BODY_TOTAL_CELL: React.CSSProperties = {
  padding: '4px 6px',
  textAlign: 'right',
  fontWeight: 700,
  fontSize: 10,
  color: 'var(--color-heading)',
  borderRight: '1px dashed var(--color-border-strong, var(--color-border))',
  whiteSpace: 'nowrap',
};

function InlineGrid({ cells, rows }: { cells: WindowCell[]; rows: InlineGridRow[] }): React.JSX.Element {
  const HEADER_STICKY: React.CSSProperties = { ...CELL_HEADER, textAlign: 'left', position: 'sticky', left: 0, minWidth: 220, zIndex: 1 };
  const HEADER_YEAR: React.CSSProperties = { ...CELL_HEADER, minWidth: 55 };
  const HEADER_HANDOVER: React.CSSProperties = { ...HEADER_YEAR, borderBottom: '2px solid var(--color-warning, #f59e0b)' };
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
      <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={HEADER_STICKY}>Sub-unit · price</th>
            <th style={HEADER_TOTAL_CELL}>Total</th>
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
          {rows.map((r) => {
            // Total = sum of velocity across the visible cells for this
            // strip (pre OR post, not both). Caller's hint still carries
            // the cross-strip combined % for context.
            const rowTotal = cells.reduce((s, c) => s + (r.values[c.idx] ?? 0), 0);
            const totalPct = `${(rowTotal * 100).toFixed(0)}%`;
            return (
              <tr key={r.id}>
                <td style={{ padding: '4px 6px', position: 'sticky', left: 0, background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }}>
                  <div style={{ fontWeight: 700, color: 'var(--color-heading)' }}>
                    {r.label}
                    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--color-navy, #0f2e4c)' }}>
                      · {r.priceHint}
                    </span>
                  </div>
                  <div style={{ fontSize: 9, color: r.sumOver ? 'var(--color-warning, #92400e)' : 'var(--color-meta)' }}>
                    {r.hint}{r.sumOver ? ' over 100%' : ''}
                  </div>
                </td>
                <td style={BODY_TOTAL_CELL}>{totalPct}</td>
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InlineProfileStrip({ cells, values, onChange, testidPrefix, showCumulative = true, label = 'Profile %' }: {
  cells: WindowCell[];
  values: number[];
  onChange: (projectIdx: number, pct: number) => void;
  testidPrefix?: string;
  // Pass 8f (2026-05-18): cash + recognition profiles sum to 100% across
  // the cohort, so the cumulative row is meaningful. Occupancy is a
  // per-year rate (no cohort sum semantics), so disable for that case.
  showCumulative?: boolean;
  // Pass 9e (2026-05-18): per-caller row label. Defaults to 'Profile %'
  // for cash + recognition profiles; occupancy passes 'Occupancy'.
  label?: string;
}): React.JSX.Element {
  const HEADER_YEAR: React.CSSProperties = { ...CELL_HEADER, minWidth: 55 };
  const HEADER_HANDOVER: React.CSSProperties = { ...HEADER_YEAR, borderBottom: '2px solid var(--color-warning, #f59e0b)' };
  const HEADER_LABEL: React.CSSProperties = { ...CELL_HEADER, textAlign: 'left', minWidth: 140 };
  const stripTotal = cells.reduce((s, c) => s + (values[c.idx] ?? 0), 0);
  const stripTotalPct = `${(stripTotal * 100).toFixed(1)}%`;
  // Pass 8f: per-year rates (occupancy) — show average instead of sum
  // since summing % across years is meaningless. Visible non-zero years
  // only so a sparse ramp doesn't dilute toward zero.
  const nonZeroCount = cells.reduce((s, c) => s + ((values[c.idx] ?? 0) > 0 ? 1 : 0), 0);
  const stripAvgPct = nonZeroCount > 0
    ? `${(stripTotal / nonZeroCount * 100).toFixed(1)}%`
    : '-';
  const summaryLabel = showCumulative ? 'Total' : 'Avg';
  const summaryValue = showCumulative ? stripTotalPct : stripAvgPct;
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
      <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={HEADER_LABEL}>{label}</th>
            <th style={HEADER_TOTAL_CELL}>{summaryLabel}</th>
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
            <td style={{ padding: '4px 6px', fontWeight: 700, color: 'var(--color-heading)', borderRight: '1px solid var(--color-border)' }}>
              {label}
            </td>
            <td style={BODY_TOTAL_CELL}>{summaryValue}</td>
            {cells.map((c) => (
              <td key={c.idx} style={{ padding: '2px 3px', textAlign: 'center' }}>
                <PercentageInput
                  value={(values[c.idx] ?? 0) * 100}
                  onChange={(n) => onChange(c.idx, n)}
                  min={0}
                  max={100}
                  decimals={2}
                  style={FAST_INPUT}
                  data-testid={testidPrefix ? `${testidPrefix}-${c.idx}` : `m2-profile-${c.idx}`}
                />
              </td>
            ))}
          </tr>
          {showCumulative && (
            <tr>
              <td style={{ padding: '4px 6px', fontWeight: 700, color: 'var(--color-meta)', borderRight: '1px solid var(--color-border)', background: 'var(--color-grey-pale)' }}>
                Cumulative %
              </td>
              <td style={{ ...BODY_TOTAL_CELL, background: 'var(--color-grey-pale)', color: 'var(--color-meta)' }}>{stripTotalPct}</td>
              {(() => {
                let running = 0;
                return cells.map((c) => {
                  running += Math.max(0, values[c.idx] ?? 0);
                  return (
                    <td
                      key={c.idx}
                      style={{
                        padding: '4px 6px',
                        textAlign: 'right',
                        fontSize: 10,
                        fontWeight: 600,
                        color: 'var(--color-meta)',
                        background: 'var(--color-grey-pale)',
                      }}
                      data-testid={testidPrefix ? `${testidPrefix}-cum-${c.idx}` : `m2-profile-cum-${c.idx}`}
                    >
                      {running > 0 ? `${(running * 100).toFixed(1)}%` : '-'}
                    </td>
                  );
                });
              })()}
            </tr>
          )}
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
