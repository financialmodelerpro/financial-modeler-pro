'use client';

/**
 * Module2CostOfSales.tsx (M2 Pass 9e-2, rebuilt for the joint
 * cumulative cost-of-sales formula).
 *
 * Cost of Sales follows the joint cumulative design:
 *
 *   CoS during construction = ∆(cum_recognition × cum_pre_sales) × total_capex
 *   CoS during operations   = (post_handover_sales[t] / inventory) × total_capex
 *
 * The joint cumulative formula respects BOTH sales cohort commitment
 * AND construction recognition progress. A unit pre-sold in year Y can
 * only contribute to CoS once construction progress reaches it; until
 * then it sits as inventory. After handover, remaining unsold units
 * recognise their cost basis SAME PERIOD as the sale closes
 * (operating-sales convention, matches Sales During Operation).
 *
 * The vintage matrix (capex year × recognition year) shows where each
 * capex dollar gets released as CoS over time. Row sum (vintage i) =
 * capex_i × pre_sales_total_pct.
 *
 * Universal UI rules per [[feedback_ui_universal_defaults]]:
 * navy headers white text, phase-then-asset, collapsible, project-setup formatting.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeAllSellResults } from '../../lib/revenue-resolvers';
import { buildCostOfSalesV2, type CostOfSalesV2Result, resolveHandoverYear } from '@/src/core/calculations/revenue';
import { computeAssetCost, type AssetCostBreakdown } from '@/src/core/calculations';
import type { Asset, Phase } from '../../lib/state/module1-types';
import { formatAccounting, currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import {
  CELL_HEADER,
  CELL_HEADER_TOTAL,
  COLUMN_WIDTHS,
  ROW_DATA,
  ROW_GRAND_TOTAL,
  TABLE_TITLE,
  nonLabelColumnPct,
} from './_shared/tableStyles';
import { PhaseSection, AssetSection } from './_shared/PhaseSection';
import VintageMatrix from './_shared/VintageMatrix';

function makeFmt(scale: DisplayScale, decimals: DisplayDecimals): (v: number) => string {
  return (v: number) => {
    if (!Number.isFinite(v)) return '-';
    if (v === 0) return '-';
    return formatAccounting(v, scale, decimals);
  };
}

/**
 * Pass 9f-3 (2026-05-18): builds the LITERAL recognition profile %
 * stream on the project axis, matching the values the user entered in
 * Revenue Inputs (e.g. [2%, 22%, 42%, 35%] at construction periods).
 * The previous Pass 9f-2 used presalesRecognitionPerPeriod / total
 * which produced cohort-weighted percentages diverging from the input
 * profile when pre-sales velocity spread cohorts across multiple
 * years (catchup logic).
 *
 * Modes:
 *   - 'absolute_with_catchup' (default): pct[k] lands at axis index
 *     positions[k] (defaults to k). Out-of-axis pct collapses to last
 *     in-axis position so a profile like positions=[1,2,3,4] on a
 *     short axis still sums to 100%.
 *   - 'point_in_time': 100% at handoverYear (or saleYear, but for the
 *     project-axis cumulative we treat handover as the anchor).
 *   - 'relative_to_sale': can't be flattened to a project-axis profile
 *     without a single sale year — fall back to the derived
 *     presalesRecognitionPerPeriod / total stream. Annotated inline.
 */
function buildLiteralRecognitionProfile(
  asset: Asset,
  phase: Phase | undefined,
  projectStartYear: number,
  axisLength: number,
  derivedFallback: number[],
): { profile: number[]; mode: 'literal' | 'derived' } {
  const N = Math.max(0, axisLength);
  const out = new Array<number>(N).fill(0);
  const sellCfg = asset.revenue?.sell;
  if (!sellCfg || !phase) return { profile: derivedFallback.slice(0, N), mode: 'derived' };
  const profile = sellCfg.recognitionProfile;
  const phaseStartYear = phase.startDate
    ? new Date(phase.startDate).getUTCFullYear()
    : projectStartYear;
  const cp = Math.max(0, phase.constructionPeriods ?? 0);
  const handoverYear = resolveHandoverYear(N, phaseStartYear, cp, projectStartYear, sellCfg.handoverYearOverride);
  const phaseOffset = Math.max(0, phaseStartYear - projectStartYear);

  if (profile.method === 'point_in_time') {
    const anchor = profile.pointInTimeYear ?? 'handover';
    if (anchor === 'handover') {
      const idx = Math.max(0, Math.min(N - 1, handoverYear));
      out[idx] = 1;
      return { profile: out, mode: 'literal' };
    }
    return { profile: derivedFallback.slice(0, N), mode: 'derived' };
  }

  const pct = profile.percentages ?? [];
  const pos = profile.positions ?? pct.map((_, k) => k);
  const mode = profile.profileMode ?? 'absolute_with_catchup';

  if (mode === 'relative_to_sale' || pct.length === 0) {
    return { profile: derivedFallback.slice(0, N), mode: 'derived' };
  }

  // Pass 9g-D-fix3 (2026-05-18): positions are PROJECT-AXIS-ABSOLUTE
  // indices, not phase-local. The Revenue Inputs strip writes
  // percentages[c.idx] where c.idx is the project-axis position
  // (cashWindow cells), and the cohort engine compares `position`
  // directly to `saleYear` (also project-axis). The previous code
  // added `phaseOffset` on top, shifting every recognition row one
  // phase-length later (user reported: Revenue showed 2026, CoS
  // rendered 2027). Use positions / default-k directly. Overflow
  // collapses into the last in-axis slot to preserve sum=100%.
  void phaseOffset;
  let overflow = 0;
  for (let k = 0; k < pct.length; k++) {
    const axisIdx = pos[k] ?? k;
    const value = Math.max(0, pct[k] ?? 0);
    if (axisIdx < 0 || axisIdx >= N) {
      overflow += value;
    } else {
      out[axisIdx] += value;
    }
  }
  if (overflow > 0) {
    // Park overflow on the handover year so a profile that runs past
    // the axis still sums correctly. Falls back to last axis slot
    // when handover is outside the axis.
    const lastIdx = Math.max(0, Math.min(N - 1, handoverYear));
    out[lastIdx] += overflow;
  }

  // Normalise to sum=1 in case percentages were entered as 0..100 or
  // any rounding makes them sum to 0.99. Catches both "2,22,42,35" and
  // "0.02,0.22,0.42,0.35" without callers needing to pre-normalise.
  const sum = out.reduce((s, v) => s + v, 0);
  if (sum > 0 && Math.abs(sum - 1) > 1e-6) {
    for (let i = 0; i < N; i++) out[i] = out[i] / sum;
  }
  return { profile: out, mode: 'literal' };
}

interface Row {
  label: string;
  values: number[];
  isTotal?: boolean;
  isSection?: boolean;        // Pass 9a (2026-05-18): colspan section header
  indent?: number;
  rowFmt?: (v: number) => string;
  totalOverride?: string;
}

function PeriodTable({ title, caption, yearLabels, rows, currency, fmt }: {
  title: string; caption?: string; yearLabels: number[]; rows: Row[]; currency: string; fmt: (v: number) => string;
}): React.JSX.Element {
  const nonLabelPct = nonLabelColumnPct(1 + yearLabels.length);
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <span style={TABLE_TITLE}>{title} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-meta)' }}>({currency})</span></span>
      {caption && (
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, fontStyle: 'italic' }}>{caption}</div>
      )}
      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            {yearLabels.map((y) => (<col key={y} style={{ width: nonLabelPct }} />))}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Line</th>
              <th style={CELL_HEADER_TOTAL}>Total</th>
              {yearLabels.map((y) => (<th key={y} style={CELL_HEADER}>{y}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              if (r.isSection) {
                const indentPx = Math.max(0, r.indent ?? 0) * 14;
                return (
                  <tr key={r.label + idx}>
                    <td
                      colSpan={2 + yearLabels.length}
                      style={{
                        padding: `var(--sp-1) calc(var(--sp-2) + ${indentPx}px)`,
                        fontSize: 11,
                        fontWeight: 700,
                        color: 'var(--color-heading)',
                        background: 'color-mix(in srgb, var(--color-navy) 8%, transparent)',
                        borderTop: '1px solid var(--color-border)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {r.label}
                    </td>
                  </tr>
                );
              }
              const tokens = r.isTotal ? ROW_GRAND_TOTAL : ROW_DATA;
              const cellFmt = r.rowFmt ?? fmt;
              const total = r.values.reduce((s, v) => s + v, 0);
              const totalDisplay = r.totalOverride ?? cellFmt(total);
              const indentPx = Math.max(0, r.indent ?? 0) * 14;
              const labelStyle = indentPx > 0
                ? { ...tokens.name, paddingLeft: `calc(${tokens.name.paddingLeft ?? 'var(--sp-2)'} + ${indentPx}px)` }
                : tokens.name;
              return (
                <tr key={r.label + idx}>
                  <td style={labelStyle}>{r.label}</td>
                  <td style={tokens.numTotal}>{totalDisplay}</td>
                  {r.values.map((v, j) => (<td key={j} style={tokens.num}>{cellFmt(v)}</td>))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Module2CostOfSales(): React.JSX.Element {
  const state = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      assets: s.assets,
      subUnits: s.subUnits,
      parcels: s.parcels,
      costLines: s.costLines,
      costOverrides: s.costOverrides,
      landAllocationMode: s.landAllocationMode,
    })),
  );

  const snap = useMemo(
    () => computeAllSellResults({ project: state.project, phases: state.phases, assets: state.assets, subUnits: state.subUnits }),
    [state.project, state.phases, state.assets, state.subUnits],
  );

  // Pass 7w (2026-05-18): Sell + Manage parents get the same CoS
  // treatment as pure Sell. Companion-side opex handled in M3.
  const sellAssets = state.assets.filter(
    (a) => a.visible !== false
      && a.isCompanion !== true
      && (a.strategy === 'Sell' || a.strategy === 'Sell + Manage'),
  );
  const currency = state.project.currency || '';
  const scale: DisplayScale = state.project.displayScale ?? 'full';
  const decimals: DisplayDecimals = state.project.displayDecimals ?? 2;
  const fmt = useMemo(() => makeFmt(scale, decimals), [scale, decimals]);

  const perAsset = useMemo(() => sellAssets.map((a) => {
    const r = snap.bySellAsset.get(a.id);
    const phase = state.phases.find((p) => p.id === a.phaseId);
    const breakdown: AssetCostBreakdown | null = phase
      ? computeAssetCost(
          a,
          state.project,
          phase,
          state.parcels,
          state.assets,
          state.subUnits,
          state.costLines,
          state.costOverrides,
          state.landAllocationMode,
          state.project.financing?.parcelFunding,
        )
      : null;
    const N = snap.axisLength;
    // Pass 9e-2 (2026-05-18): per-period capex on the project axis.
    // Mirrors the Costs Tab Table 3 mapping (financing/capex.ts):
    //   local i=0 (Y0 lump) -> projIdx = offset - 1
    //   local i>=1          -> projIdx = offset + i - 1
    // where offset = phaseStartYear - projectStartYear.
    const capexPerPeriod = new Array<number>(N).fill(0);
    if (phase && breakdown) {
      const projectStartYear = snap.yearLabels[0] ?? 0;
      const phaseStartYear = phase.startDate
        ? new Date(phase.startDate).getUTCFullYear()
        : projectStartYear;
      const offset = Math.max(0, phaseStartYear - projectStartYear);
      const perAll = breakdown.perPeriod ?? [];
      for (let i = 0; i < perAll.length; i++) {
        const projIdx = i === 0 ? offset - 1 : offset + i - 1;
        if (projIdx >= 0 && projIdx < N) capexPerPeriod[projIdx] += perAll[i] ?? 0;
      }
    }
    const capex = breakdown?.total ?? 0;
    // Sales cohort + recognition profile (already resolved in the
    // revenue engine). The engine returns per-period units AND area;
    // we pick the same metric the revenue surface uses (units when all
    // sub-units are unit-metric, else area).
    const assetSubUnits = state.subUnits.filter((u) => u.assetId === a.id);
    const allUnits = assetSubUnits.length > 0 && assetSubUnits.every((u) => u.metric === 'units');
    const presales = r ? (allUnits ? r.presalesUnitsPerPeriod : r.presalesAreaPerPeriod) : new Array<number>(N).fill(0);
    const postSales = r ? (allUnits ? r.postSalesUnitsPerPeriod : r.postSalesAreaPerPeriod) : new Array<number>(N).fill(0);
    const totalPre = presales.reduce((s, v) => s + Math.max(0, v), 0);
    const totalPost = postSales.reduce((s, v) => s + Math.max(0, v), 0);
    const totalInventory = totalPre + totalPost;
    // Pass 9f-3 (2026-05-18): use the LITERAL recognition profile %
    // entered in Revenue Inputs (project-axis-anchored, sums to 100%)
    // rather than the cohort-weighted presalesRecognitionPerPeriod
    // stream. The CoS joint factor (cum_rec × cum_pre) is conceptually
    // project-axis-anchored — mixing in cohort weighting double-counts
    // the velocity ramp on the recognition side. Falls back to the
    // derived stream for relative_to_sale profiles where no single
    // project-axis % shape exists.
    const projectStartYearLocal = snap.yearLabels[0] ?? 0;
    const derivedFallback = r?.presalesRecognitionPerPeriod ?? new Array<number>(N).fill(0);
    const profileResolution = buildLiteralRecognitionProfile(
      a,
      phase,
      projectStartYearLocal,
      N,
      derivedFallback,
    );
    const recognitionProfile = profileResolution.profile;
    const cos: CostOfSalesV2Result = buildCostOfSalesV2({
      capexPerPeriod,
      presalesPerPeriod: presales,
      postSalesPerPeriod: postSales,
      recognitionPerPeriod: recognitionProfile,
      totalInventory,
      axisLength: N,
    });
    return { asset: a, sell: r, capex, capexPerPeriod, cos, breakdown, recognitionProfile, profileMode: profileResolution.mode };
  }), [sellAssets, snap, state]);

  const projTotals = useMemo(() => {
    const N = snap.axisLength;
    const construction = new Array<number>(N).fill(0);
    const operations = new Array<number>(N).fill(0);
    const total = new Array<number>(N).fill(0);
    const cum = new Array<number>(N).fill(0);
    let totalCapex = 0;
    for (const row of perAsset) {
      totalCapex += row.cos.totalCapex;
      for (let i = 0; i < N; i++) {
        construction[i] += row.cos.cosConstructionPerPeriod[i] ?? 0;
        operations[i] += row.cos.cosOperationsPerPeriod[i] ?? 0;
        total[i] += row.cos.totalCosPerPeriod[i] ?? 0;
      }
    }
    let running = 0;
    for (let i = 0; i < N; i++) { running += total[i]; cum[i] = running; }
    return { construction, operations, total, cumulative: cum, totalCapex };
  }, [perAsset, snap.axisLength]);

  if (sellAssets.length === 0) {
    return (
      <div data-testid="m2-cost-of-sales" style={{ padding: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Cost of Sales</h1>
        <div style={{
          marginTop: 'var(--sp-3)', padding: 'var(--sp-3)', background: 'var(--color-surface)',
          border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-muted)', fontSize: 'var(--font-small)',
        }}>
          No Sell-strategy assets configured.
        </div>
      </div>
    );
  }

  return (
    <div data-testid="m2-cost-of-sales" style={{ padding: 'var(--sp-3)' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Cost of Sales</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>
          {currencyHeaderLine(currency, scale)} ({decimals} dp)
        </div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)', maxWidth: 800 }}>
          CoS during construction = ∆(cum recognition × cum pre-sales) × total capex.
          CoS during operations = post-handover sales × total capex (same period). Phases and assets collapse.
        </p>
      </div>

      {/* Pass 9f-2 (2026-05-18): strategy-first grouping to mirror
          Revenue Output. CoS only applies to Sell + Sell + Manage
          parents, so a single outer strategy section covers everything. */}
      <PhaseSection
        phaseId="strategy-sell-cos"
        title="Residential / Sell"
        meta="Sell + Sell + Manage parents across all phases"
        countLabel={`${perAsset.length} asset${perAsset.length === 1 ? '' : 's'}`}
        storageKey="fmp:m2:costofsales:strategy:sell:collapsed"
      >
      {perAsset.length === 0 && (
        <div style={{ padding: '8px 12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
          No Sell or Sell + Manage assets configured yet.
        </div>
      )}
      {state.phases.map((p) => {
        const phaseRows = perAsset.filter((row) => row.asset.phaseId === p.id);
        if (phaseRows.length === 0) return null;
        return (
          <div key={p.id} style={{ marginBottom: 'var(--sp-2)' }}>
            <PhaseDivider
              title={p.name}
              meta={`${p.status ?? 'planning'}`}
              count={`${phaseRows.length} Sell asset${phaseRows.length === 1 ? '' : 's'}`}
            />
            {phaseRows.map((row) => {
              // Pass 9e-10 (2026-05-18): % rows follow project decimals.
              const pctFmt = (v: number): string => {
                if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return '-';
                return `${(v * 100).toFixed(decimals)}%`;
              };
              const bd = row.breakdown;
              const stageLand = bd?.byStage.land ?? 0;
              const stageHard = bd?.byStage.hard ?? 0;
              const stageSoft = bd?.byStage.soft ?? 0;
              const stageOperating = bd?.byStage.operating ?? 0;
              const cos = row.cos;
              const totalCapex = cos.totalCapex;
              const r = row.sell;
              const N = snap.axisLength;
              const assetSubUnits = state.subUnits.filter((u) => u.assetId === row.asset.id);
              const allUnits = assetSubUnits.length > 0 && assetSubUnits.every((u) => u.metric === 'units');
              const presales = r ? (allUnits ? r.presalesUnitsPerPeriod : r.presalesAreaPerPeriod) : new Array<number>(N).fill(0);
              const postSales = r ? (allUnits ? r.postSalesUnitsPerPeriod : r.postSalesAreaPerPeriod) : new Array<number>(N).fill(0);
              const totalSold = presales.reduce((s, v) => s + Math.max(0, v), 0) + postSales.reduce((s, v) => s + Math.max(0, v), 0);
              const denominator = totalSold > 0 ? totalSold : 1e-9;
              const presalesPctPerPeriod = presales.map((v) => v / denominator);
              const postSalesPctPerPeriod = postSales.map((v) => v / denominator);
              // Last non-zero finalisers for the Total column.
              const totalPreSalesPct = presalesPctPerPeriod.reduce((s, v) => s + v, 0);
              const totalPostSalesPct = postSalesPctPerPeriod.reduce((s, v) => s + v, 0);
              const cumPreFinal = cos.cumPreSalesPerPeriod[cos.cumPreSalesPerPeriod.length - 1] ?? 0;
              const cumRecFinal = cos.cumRecognitionPerPeriod[cos.cumRecognitionPerPeriod.length - 1] ?? 0;
              const jointFinal = cos.jointFactorPerPeriod[cos.jointFactorPerPeriod.length - 1] ?? 0;
              const inventoryLabel = allUnits ? 'units' : 'sqm';
              // Pass 9f-3 (2026-05-18): per-period recognition % is the
              // LITERAL profile entered in Revenue Inputs (e.g. 2%, 22%,
              // 42%, 35% over the four construction years), not a
              // cohort-weighted derived stream. Falls back to the
              // weighted stream only for relative_to_sale profiles
              // where no project-axis shape exists.
              const recognitionPctPerPeriod = row.recognitionProfile;
              const totalRecPct = recognitionPctPerPeriod.reduce((s, v) => s + v, 0);
              const profileSourceCaption = row.profileMode === 'literal'
                ? undefined
                : 'Recognition profile is relative-to-sale — % shown is the cohort-weighted projection.';

              return (
                <AssetSection
                  key={row.asset.id}
                  assetId={row.asset.id}
                  title={row.asset.name}
                  meta={`Total Capex (incl. Land) ${currency} ${fmt(totalCapex)} · CoS construction + operations`}
                  storageKey={`fmp:m2:costofsales:asset:${row.asset.id}:collapsed`}
                >
                  <PeriodTable
                    title="Cost of Sales · Drivers"
                    caption={
                      `Capex per year (from M1) + pre-sales cohort + post-handover sales + revenue recognition profile during construction. These four streams drive the CoS calculation below.` +
                      (profileSourceCaption ? ` ${profileSourceCaption}` : '')
                    }
                    yearLabels={snap.yearLabels}
                    rows={[
                      { label: 'Capex by stage (Total Capex basis for CoS)', values: [], isSection: true, indent: 0 },
                      { label: 'Land (total)', values: [], totalOverride: fmt(stageLand), indent: 1 },
                      { label: 'Hard Costs (total)', values: [], totalOverride: fmt(stageHard), indent: 1 },
                      { label: 'Soft Costs (total)', values: [], totalOverride: fmt(stageSoft), indent: 1 },
                      ...(stageOperating > 0
                        ? [{ label: 'Operating-stage capex (total)', values: [], totalOverride: fmt(stageOperating), indent: 1 }]
                        : []),
                      { label: 'Capex per period (project axis)', values: row.capexPerPeriod, totalOverride: fmt(totalCapex), isTotal: true, indent: 1 },
                      { label: 'Sales cohort (% of total inventory sold)', values: [], isSection: true, indent: 0 },
                      { label: `Pre-Sales % per period (${inventoryLabel})`, values: presalesPctPerPeriod, rowFmt: pctFmt, totalOverride: pctFmt(totalPreSalesPct), indent: 1 },
                      { label: 'Cumulative Pre-Sales %', values: cos.cumPreSalesPerPeriod, rowFmt: pctFmt, totalOverride: pctFmt(cumPreFinal), indent: 1 },
                      { label: `Sales (post-handover) % per period`, values: postSalesPctPerPeriod, rowFmt: pctFmt, totalOverride: pctFmt(totalPostSalesPct), indent: 1 },
                      { label: 'Revenue Recognition profile (during construction)', values: [], isSection: true, indent: 0 },
                      { label: 'Recognition % per period', values: recognitionPctPerPeriod, rowFmt: pctFmt, totalOverride: pctFmt(totalRecPct), indent: 1 },
                      { label: 'Cumulative Recognition %', values: cos.cumRecognitionPerPeriod, rowFmt: pctFmt, totalOverride: pctFmt(cumRecFinal), indent: 1 },
                      { label: 'Joint factor = cum Recognition × cum Pre-Sales', values: cos.jointFactorPerPeriod, rowFmt: pctFmt, totalOverride: pctFmt(jointFinal), indent: 1 },
                      { label: '∆ Joint factor (drives CoS during construction)', values: cos.deltaJointPerPeriod, rowFmt: pctFmt, totalOverride: pctFmt(cos.deltaJointPerPeriod.reduce((s, v) => s + v, 0)), indent: 1 },
                    ]}
                    currency={currency}
                    fmt={fmt}
                  />
                  {/* Pass 9g-F (2026-05-18): Vintage matrix BEFORE the
                      summary table, mirroring the Revenue Output sequence
                      (Block 3a vintage matrix → Block 3b recognition
                      summary). The vintage matrix shows where each year's
                      capex dollar lands as CoS over time (rows = capex
                      spend year, cols = CoS year). */}
                  <VintageMatrix
                    title="Cost of Sales · Vintage Matrix"
                    caption="Each row = capex spent in that year. Each column = CoS recognised in that year. Cell(i, t) = capex_i × ∆joint[t] (or × joint[i] on the spend year, collapsing missed pre-i recognition). Row sum = capex_i × cum Pre-Sales %. Diagonal highlights where capex first contributes."
                    yearLabels={snap.yearLabels}
                    matrix={cos.vintageMatrix}
                    currency={currency}
                    fmt={fmt}
                    rowAxisHeader="Capex spent in ↓ / CoS year →"
                    rowTotalHeader="Capex Released"
                    rowLabelPrefix="Spent in"
                    emptyMessage="No capex spend yet. Enter cost lines on Module 1 Tab 3."
                  />
                  <PeriodTable
                    title="Cost of Sales · Summary"
                    caption="CoS during construction = ∆(cum recognition × cum pre-sales) × total capex. CoS during operations = post-handover sales × total capex (same period, operating-sales convention)."
                    yearLabels={snap.yearLabels}
                    rows={[
                      { label: 'CoS during construction (pre-sales cohort)', values: cos.cosConstructionPerPeriod, indent: 0 },
                      { label: 'CoS during operations (post-handover sales)', values: cos.cosOperationsPerPeriod, indent: 0 },
                      { label: 'Total Cost of Sales', values: cos.totalCosPerPeriod, isTotal: true, indent: 0 },
                    ]}
                    currency={currency}
                    fmt={fmt}
                  />
                  {(() => {
                    // Pass 9g-E-fix (2026-05-18): Inventory roll-forward
                    // per the v7.0 reference schedule:
                    //   Opening balance
                    //   (+) Capex
                    //   (-) Cost of Sales during construction
                    //   (-) Cost of Sales during operations
                    //   Inventory balance
                    // CoS split mirrors the engine's two streams so the
                    // user can see where each release comes from.
                    const N = snap.axisLength;
                    const opening = new Array<number>(N).fill(0);
                    const balance = new Array<number>(N).fill(0);
                    let prev = 0;
                    for (let t = 0; t < N; t++) {
                      opening[t] = prev;
                      const cap = Math.max(0, row.capexPerPeriod[t] ?? 0);
                      const coSC = Math.max(0, cos.cosConstructionPerPeriod[t] ?? 0);
                      const coSO = Math.max(0, cos.cosOperationsPerPeriod[t] ?? 0);
                      const close = Math.max(0, prev + cap - coSC - coSO);
                      balance[t] = close;
                      prev = close;
                    }
                    const cosConstrNeg = cos.cosConstructionPerPeriod.map((v) => -Math.max(0, v));
                    const cosOpsNeg = cos.cosOperationsPerPeriod.map((v) => -Math.max(0, v));
                    const balanceFinal = balance[balance.length - 1] ?? 0;
                    return (
                      <PeriodTable
                        title="Inventory · Roll-Forward"
                        caption="Inventory tracks construction-in-progress + completed-but-unsold stock on the balance sheet. Opening + Capex - CoS (construction + operations) = Inventory balance. Settles to 0 once 100% of inventory has been sold + matched to CoS."
                        yearLabels={snap.yearLabels}
                        rows={[
                          { label: 'Opening balance', values: opening, indent: 0 },
                          { label: '(+) Capex', values: row.capexPerPeriod, indent: 0 },
                          { label: '(-) Cost of Sales during construction', values: cosConstrNeg, indent: 0 },
                          { label: '(-) Cost of Sales during operations', values: cosOpsNeg, indent: 0 },
                          { label: 'Inventory balance', values: balance, isTotal: true, indent: 0, totalOverride: fmt(balanceFinal) },
                        ]}
                        currency={currency}
                        fmt={fmt}
                      />
                    );
                  })()}
                </AssetSection>
              );
            })}
          </div>
        );
      })}
      </PhaseSection>

      <PhaseSection
        phaseId="__project__"
        title="Project Total"
        meta={`Total capex ${currency} ${fmt(projTotals.totalCapex)}`}
        storageKey="fmp:m2:costofsales:phase:__project__:collapsed"
      >
        {(() => {
          // Pass 9g-F (2026-05-18): mirror Revenue Output's project
          // total shape. Strategy-grouped: Residential / Sell (covers
          // pure Sell + Sell+Manage parents). Each row = per-asset CoS
          // construction + operations + total; group grand row sums
          // across assets. Hospitality / Lease groups have no CoS by
          // strategy convention (capex stays on balance sheet, gets
          // depreciated in M3), so they don't appear here.
          const N = snap.axisLength;
          const zeros = (): number[] => new Array<number>(N).fill(0);
          const sumArr = (arrs: number[][]): number[] => {
            const out = zeros();
            for (const a of arrs) for (let i = 0; i < N; i++) out[i] += a[i] ?? 0;
            return out;
          };

          // CoS during Construction view
          const constructionRows: Row[] = [];
          const operationsRows: Row[] = [];
          const totalRows: Row[] = [];

          constructionRows.push({ label: 'Residential / Sell', values: [], isSection: true, indent: 0 });
          operationsRows.push({ label: 'Residential / Sell', values: [], isSection: true, indent: 0 });
          totalRows.push({ label: 'Residential / Sell', values: [], isSection: true, indent: 0 });
          const constrSeries: number[][] = [];
          const opsSeries: number[][] = [];
          const totalSeries: number[][] = [];
          for (const row of perAsset) {
            constructionRows.push({ label: row.asset.name || 'Sell asset', values: row.cos.cosConstructionPerPeriod, indent: 1 });
            operationsRows.push({ label: row.asset.name || 'Sell asset', values: row.cos.cosOperationsPerPeriod, indent: 1 });
            totalRows.push({ label: row.asset.name || 'Sell asset', values: row.cos.totalCosPerPeriod, indent: 1 });
            constrSeries.push(row.cos.cosConstructionPerPeriod);
            opsSeries.push(row.cos.cosOperationsPerPeriod);
            totalSeries.push(row.cos.totalCosPerPeriod);
          }
          constructionRows.push({ label: 'Total Residential / Sell · CoS during construction', values: sumArr(constrSeries), isTotal: true, indent: 0 });
          operationsRows.push({ label: 'Total Residential / Sell · CoS during operations', values: sumArr(opsSeries), isTotal: true, indent: 0 });
          totalRows.push({ label: 'Total Residential / Sell · Cost of Sales', values: sumArr(totalSeries), isTotal: true, indent: 0 });

          return (
            <>
              <PeriodTable
                title="Project Cost of Sales · During Construction"
                caption="Per-asset breakdown grouped by strategy. Construction CoS = ∆(cum recognition × cum pre-sales) × total capex. Hospitality / Lease assets carry no CoS by convention (depreciation handles their cost recovery in M3)."
                yearLabels={snap.yearLabels}
                rows={constructionRows}
                currency={currency}
                fmt={fmt}
              />
              <PeriodTable
                title="Project Cost of Sales · During Operations"
                caption="Post-handover sales × total capex (same period, operating-sales convention)."
                yearLabels={snap.yearLabels}
                rows={operationsRows}
                currency={currency}
                fmt={fmt}
              />
              <PeriodTable
                title="Project Total Cost of Sales"
                caption="Construction + Operations per asset, then summed."
                yearLabels={snap.yearLabels}
                rows={totalRows}
                currency={currency}
                fmt={fmt}
              />
            </>
          );
        })()}
      </PhaseSection>
    </div>
  );
}

/**
 * Pass 9f-2 (2026-05-18): phase divider rendered inside a strategy
 * section. Lighter than the full PhaseSection chrome so the strategy
 * header stays the dominant visual anchor.
 */
function PhaseDivider({ title, meta, count }: { title: string; meta?: string; count?: string }): React.JSX.Element {
  return (
    <div style={{
      marginTop: 'var(--sp-2)',
      marginBottom: 'var(--sp-1)',
      padding: '6px 12px',
      background: 'color-mix(in srgb, var(--color-navy) 6%, transparent)',
      borderLeft: '3px solid var(--color-navy)',
      borderRadius: '2px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <div>
        <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-heading)' }}>{title}</strong>
        {meta && <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--color-meta)' }}>{meta}</span>}
      </div>
      {count && <span style={{ fontSize: 11, color: 'var(--color-meta)' }}>{count}</span>}
    </div>
  );
}
