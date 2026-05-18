'use client';

/**
 * Module2RevenueOutput.tsx (M2 Pass 7s, per-asset narrative)
 *
 * One residential-first narrative per asset, in this order:
 *
 *   1. SQM Sold
 *      1a. Pre-Sales SQM, per sub-unit
 *      1b. Sales During Operation SQM, per sub-unit
 *      1c. Total SQM + reconciliation (cum % of BUA per sub-unit)
 *   2. Revenue (Sales Value)
 *      2a. Pre-Sales Revenue, per sub-unit
 *      2b. Sales During Operation Revenue, per sub-unit
 *      2c. Total Revenue, per sub-unit
 *   3. Revenue Recognised
 *      3a. Pre-Sales Recognition vintage matrix (per recognition profile)
 *      3b. Recognition Summary per period: Pre + SDO + Total
 *   4. Cash Collected
 *      4a. Pre-Sales Cash vintage matrix (per cash profile)
 *      4b. Cash Summary per period: Pre + SDO + Total
 *   5. Accounts Receivable (pre-sales only; SDO does not form a balance)
 *   6. Unearned Revenue (pre-sales only; SDO does not form a balance)
 *
 * Pass 7s (2026-05-18) surfaces Sales During Operation in Blocks 3 + 4
 * and restructures the Project Total section into strategy-grouped
 * per-asset breakdowns (Residential / Sell with nested Pre-Sales +
 * Sales During Operation; Hospitality / Operations; Retail / Lease;
 * Sell + Manage). Same structure applies to Revenue (Sales Value),
 * Recognition, and Cash. Hospitality / Lease / Sell+Manage groups
 * render as zero placeholders until Pass 8 / 9 / 10 wire their engines.
 *
 * Every table carries a one-line formula caption so the math is
 * documented inline. Token discipline: all styling pulls from
 * _shared/tableStyles + PhaseSection + VintageMatrix.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeAllSellResults, resolveSellConfig, type ProjectRevenueSnapshot } from '../../lib/revenue-resolvers';
import {
  buildAccountsReceivable,
  buildUnearnedRevenue,
  type SellAssetResult,
} from '@/src/core/calculations/revenue';
import type { Asset, SubUnit } from '../../lib/state/module1-types';
import { computeProjectTimeline, computeSubUnitArea } from '@/src/core/calculations';
import {
  formatAccounting,
  formatArea,
  currencyHeaderLine,
  type DisplayScale,
  type DisplayDecimals,
} from '@/src/core/formatters';
import {
  CELL_HEADER,
  CELL_HEADER_TOTAL,
  COLUMN_WIDTHS,
  ROW_DATA,
  ROW_SUBTOTAL,
  ROW_GRAND_TOTAL,
  TABLE_TITLE,
  nonLabelColumnPct,
} from './_shared/tableStyles';
import { PhaseSection, AssetSection } from './_shared/PhaseSection';
import VintageMatrix from './_shared/VintageMatrix';

function makeCurrencyFmt(scale: DisplayScale, decimals: DisplayDecimals): (v: number) => string {
  return (v: number) => {
    if (!Number.isFinite(v)) return '-';
    if (Math.abs(v) < 0.5) return '-';
    return formatAccounting(v, scale, decimals);
  };
}

function makeAreaFmt(decimals: DisplayDecimals): (v: number) => string {
  return (v: number) => {
    if (!Number.isFinite(v)) return '-';
    if (Math.abs(v) < 0.5) return '-';
    return formatArea(v, decimals);
  };
}

/**
 * Pass 7x (2026-05-18): sub-unit reference chip strip mirroring the
 * one in the Inputs tab. Renders each sub-unit's name + area + sale
 * rate as a read-only chip so users can verify M1 Tab 2 entries
 * without leaving the Output surface.
 */
function SubUnitReferenceStrip({
  units,
  currency,
}: {
  units: SubUnit[];
  currency: string;
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
        const rateLabel = (su.unitPrice && su.unitPrice > 0)
          ? (isUnitsMetric
              ? `${currency} ${formatAccounting(su.unitPrice, 'full', 0)} / unit`
              : `${currency} ${formatAccounting(su.unitPrice, 'full', 0)} / sqm`)
          : 'no price';
        const sizeLabel = isUnitsMetric
          ? `${Math.round(Math.max(0, su.metricValue)).toLocaleString('en-US')} units · ${formatArea(area, 0)} sqm`
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

type RowKind = 'data' | 'subtotal' | 'grand' | 'section';

interface PeriodRow {
  label: string;
  values: number[];
  kind?: RowKind;
  /** Optional trailing column rendered after Total (e.g. cum % of BUA). */
  trailing?: string;
  /** Visual indent depth, applied to the label cell. */
  indent?: number;
}

function PeriodTable({
  title,
  formula,
  yearLabels,
  rows,
  fmt,
  trailingHeader,
}: {
  title: string;
  formula: string;
  yearLabels: number[];
  rows: PeriodRow[];
  /** @deprecated Pass 7u: unit suffix dropped; currency comes from tab header, area is in the title. Kept for backward compat with call sites; ignored. */
  unit?: string;
  fmt: (v: number) => string;
  trailingHeader?: string;
}): React.JSX.Element {
  const extraCols = trailingHeader ? 1 : 0;
  const nonLabelPct = nonLabelColumnPct(1 + extraCols + yearLabels.length);
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <span style={TABLE_TITLE}>{title}</span>
      <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, fontStyle: 'italic' }}>
        Formula: {formula}
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            {trailingHeader && (<col style={{ width: nonLabelPct }} />)}
            {yearLabels.map((y) => (<col key={y} style={{ width: nonLabelPct }} />))}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Line</th>
              <th style={CELL_HEADER_TOTAL}>Total</th>
              {trailingHeader && (<th style={CELL_HEADER}>{trailingHeader}</th>)}
              {yearLabels.map((y) => (<th key={y} style={CELL_HEADER}>{y}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              if (r.kind === 'section') {
                const valueColCount = 1 + (trailingHeader ? 1 : 0) + yearLabels.length;
                const indentPx = Math.max(0, (r.indent ?? 0)) * 14;
                return (
                  <tr key={`${r.label}-${idx}`}>
                    <td
                      colSpan={1 + valueColCount}
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
              const tokens = r.kind === 'grand'
                ? ROW_GRAND_TOTAL
                : r.kind === 'subtotal'
                  ? ROW_SUBTOTAL
                  : ROW_DATA;
              const total = r.values.reduce((s, v) => s + (v ?? 0), 0);
              const indentPx = Math.max(0, (r.indent ?? 0)) * 14;
              const labelStyle = indentPx > 0
                ? { ...tokens.name, paddingLeft: `calc(${tokens.name.paddingLeft ?? 'var(--sp-2)'} + ${indentPx}px)` }
                : tokens.name;
              return (
                <tr key={`${r.label}-${idx}`}>
                  <td style={labelStyle}>{r.label}</td>
                  <td style={tokens.numTotal}>{fmt(total)}</td>
                  {trailingHeader && (
                    <td style={tokens.num}>{r.trailing ?? ''}</td>
                  )}
                  {r.values.map((v, j) => (<td key={j} style={tokens.num}>{fmt(v ?? 0)}</td>))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Per-sub-unit block: builds an "id -> per-period array" map into rows
 * keyed by sub-unit name + a closing asset-total row. Used by both the
 * SQM blocks (1a / 1b / 1c) and the Revenue blocks (2a / 2b / 2c).
 */
function buildPerSubUnitRows(
  subUnits: Array<{ id: string; name: string }>,
  perSU: Record<string, number[]>,
  totalAcrossSU: number[],
  totalLabel: string,
): PeriodRow[] {
  const rows: PeriodRow[] = [];
  for (const su of subUnits) {
    rows.push({ label: su.name || 'sub-unit', values: perSU[su.id] ?? [] });
  }
  rows.push({ label: totalLabel, values: totalAcrossSU, kind: 'grand' });
  return rows;
}

/**
 * Total SQM block (1c) with reconciliation. For each sub-unit row,
 * trailing column shows cumulative pct of BUA = sum(pre + post) / area.
 */
function buildTotalSqmReconciledRows(
  subUnits: Array<{ id: string; name: string }>,
  totalAreaPerSU: number[],
  preSU: Record<string, number[]>,
  postSU: Record<string, number[]>,
  totalAcrossSU: number[],
  assetBUA: number,
): PeriodRow[] {
  const rows: PeriodRow[] = [];
  subUnits.forEach((su, idx) => {
    const area = Math.max(0, totalAreaPerSU[idx] ?? 0);
    const pre = preSU[su.id] ?? [];
    const post = postSU[su.id] ?? [];
    const N = Math.max(pre.length, post.length);
    const combined: number[] = new Array(N).fill(0);
    let sold = 0;
    for (let i = 0; i < N; i++) {
      const v = (pre[i] ?? 0) + (post[i] ?? 0);
      combined[i] = v;
      sold += v;
    }
    const cumPct = area > 0 ? sold / area : 0;
    const pctLabel = `${(cumPct * 100).toFixed(0)}%`;
    rows.push({ label: su.name || 'sub-unit', values: combined, trailing: pctLabel });
  });
  const assetCumPct = assetBUA > 0
    ? totalAcrossSU.reduce((s, v) => s + v, 0) / assetBUA
    : 0;
  rows.push({
    label: 'Asset Total',
    values: totalAcrossSU,
    kind: 'grand',
    trailing: `${(assetCumPct * 100).toFixed(0)}%`,
  });
  return rows;
}

/**
 * Pass 7s (2026-05-18): Project Total breakdown grouped by strategy.
 * Pass 7u (2026-05-18): Sell + Manage no longer renders as a standalone
 * group. Its parent (the sell side) goes into Residential / Sell with
 * the Pre-Sales + Sales During Operation nesting; its companion (the
 * operate side) goes into Hospitality / Operations alongside pure
 * Operate-strategy assets.
 *
 * View selector picks Revenue (sales value), Recognition, or Cash. For
 * each strategy:
 *   - Residential / Sell (includes Sell + Manage parents): nested
 *     Pre-Sales (per asset + subtotal) + Sales During Operation
 *     (per asset + subtotal) + strategy total.
 *   - Hospitality / Operations (includes Sell + Manage companions):
 *     flat per-asset + strategy total. Engines wire in Pass 8 (Operate)
 *     and Pass 10 (Sell + Manage companion).
 *   - Retail / Lease: flat per-asset + strategy total. Pass 9.
 *
 * Strategy groups with zero assets are skipped entirely.
 */
type RevenueView = 'revenue' | 'recognition' | 'cash';

function pickSegment(r: SellAssetResult, view: RevenueView, segment: 'pre' | 'post'): number[] {
  if (view === 'revenue') return segment === 'pre' ? r.presalesRevenuePerPeriod : r.postSalesRevenuePerPeriod;
  if (view === 'recognition') return segment === 'pre' ? r.presalesRecognitionPerPeriod : r.postSalesRecognitionPerPeriod;
  return segment === 'pre' ? r.presalesCashPerPeriod : r.postSalesCashPerPeriod;
}

function sumArrays(arrs: number[][], axisLength: number): number[] {
  const out = new Array<number>(axisLength).fill(0);
  for (const a of arrs) for (let i = 0; i < axisLength; i++) out[i] += a[i] ?? 0;
  return out;
}

function buildProjectGroupedRows({
  view,
  assets,
  snap,
}: {
  view: RevenueView;
  assets: Asset[];
  snap: ProjectRevenueSnapshot;
}): PeriodRow[] {
  const rows: PeriodRow[] = [];
  const N = snap.axisLength;
  const zeros = (): number[] => new Array<number>(N).fill(0);

  const visibleParents = assets.filter((a) => a.visible !== false && a.isCompanion !== true);
  const companions = assets.filter((a) => a.visible !== false && a.isCompanion === true);

  // Sell group: pure Sell + Sell + Manage parents (both have Pre-Sales
  // + Sales During Operation phases).
  const sellAssets = visibleParents.filter(
    (a) => a.strategy === 'Sell' || a.strategy === 'Sell + Manage',
  );
  // Operate group: pure Operate + every companion (companions are the
  // operate-side of a Sell + Manage parent).
  const operateAssets = [
    ...visibleParents.filter((a) => a.strategy === 'Operate'),
    ...companions,
  ];
  const leaseAssets = visibleParents.filter((a) => a.strategy === 'Lease');

  if (sellAssets.length > 0) {
    rows.push({ label: 'Residential / Sell', values: [], kind: 'section', indent: 0 });

    if (view === 'revenue') {
      // Pass 7u: Revenue (Sales Value) is timing-agnostic — sale value
      // is sale value when the sale happens. Flat per-asset rows
      // (combined Pre + Post) suffice; the Pre/Post split is reserved
      // for Recognition + Cash where timing differs.
      const series: number[][] = [];
      for (const a of sellAssets) {
        const r = snap.bySellAsset.get(a.id);
        const pre = r ? pickSegment(r, 'revenue', 'pre') : zeros();
        const post = r ? pickSegment(r, 'revenue', 'post') : zeros();
        const combined = pre.map((v, i) => v + (post[i] ?? 0));
        rows.push({ label: a.name || 'Sell asset', values: combined, indent: 1 });
        series.push(combined);
      }
      rows.push({
        label: 'Total Residential / Sell',
        values: sumArrays(series, N),
        kind: 'grand',
        indent: 0,
      });
    } else {
      rows.push({ label: 'Pre-Sales', values: [], kind: 'section', indent: 1 });
      const preSeries: number[][] = [];
      for (const a of sellAssets) {
        const r = snap.bySellAsset.get(a.id);
        const vals = r ? pickSegment(r, view, 'pre') : zeros();
        rows.push({ label: a.name || 'Sell asset', values: vals, indent: 2 });
        preSeries.push(vals);
      }
      const preTotal = sumArrays(preSeries, N);
      rows.push({ label: 'Total Pre-Sales', values: preTotal, kind: 'subtotal', indent: 1 });

      rows.push({ label: 'Sales During Operation', values: [], kind: 'section', indent: 1 });
      const postSeries: number[][] = [];
      for (const a of sellAssets) {
        const r = snap.bySellAsset.get(a.id);
        const vals = r ? pickSegment(r, view, 'post') : zeros();
        rows.push({ label: a.name || 'Sell asset', values: vals, indent: 2 });
        postSeries.push(vals);
      }
      const postTotal = sumArrays(postSeries, N);
      rows.push({ label: 'Total Sales During Operation', values: postTotal, kind: 'subtotal', indent: 1 });

      rows.push({
        label: 'Total Residential / Sell',
        values: preTotal.map((v, i) => v + (postTotal[i] ?? 0)),
        kind: 'grand',
        indent: 0,
      });
    }
  }

  if (operateAssets.length > 0) {
    rows.push({ label: 'Hospitality / Operations', values: [], kind: 'section', indent: 0 });
    const series: number[][] = [];
    for (const a of operateAssets) {
      // Pure Operate engine wires in Pass 8; companion (Sell + Manage
      // operate side) engine wires in Pass 10. Zero placeholders until.
      const vals = zeros();
      rows.push({ label: a.name || 'Operate asset', values: vals, indent: 1 });
      series.push(vals);
    }
    rows.push({
      label: 'Total Hospitality / Operations',
      values: sumArrays(series, N),
      kind: 'grand',
      indent: 0,
    });
  }

  if (leaseAssets.length > 0) {
    rows.push({ label: 'Retail / Lease', values: [], kind: 'section', indent: 0 });
    const series: number[][] = [];
    for (const a of leaseAssets) {
      // Engine wires in Pass 9 — zeros until then.
      const vals = zeros();
      rows.push({ label: a.name || 'Lease asset', values: vals, indent: 1 });
      series.push(vals);
    }
    rows.push({
      label: 'Total Retail / Lease',
      values: sumArrays(series, N),
      kind: 'grand',
      indent: 0,
    });
  }

  return rows;
}

export default function Module2RevenueOutput(): React.JSX.Element {
  const { project, phases, assets, subUnits } = useModule1Store(
    useShallow((s) => ({ project: s.project, phases: s.phases, assets: s.assets, subUnits: s.subUnits })),
  );

  const snap = useMemo(
    () => computeAllSellResults({ project, phases, assets, subUnits }),
    [project, phases, assets, subUnits],
  );
  const currency = project.currency || '';
  const scale: DisplayScale = project.displayScale ?? 'full';
  const decimals: DisplayDecimals = project.displayDecimals ?? 2;
  const fmt = useMemo(() => makeCurrencyFmt(scale, decimals), [scale, decimals]);
  const areaFmt = useMemo(() => makeAreaFmt(0), []);
  const timeline = useMemo(() => computeProjectTimeline(project, phases), [project, phases]);
  const projectStartYear = new Date(timeline.startDate).getUTCFullYear();

  // Pass 7w (2026-05-18): Sell + Manage parents render the same
  // per-asset narrative (Blocks 1-6) as pure Sell. Companions live
  // in Hospitality / Operations (Pass 10).
  const sellAssets = assets.filter(
    (a) => a.visible !== false
      && a.isCompanion !== true
      && (a.strategy === 'Sell' || a.strategy === 'Sell + Manage'),
  );

  if (sellAssets.length === 0) {
    return (
      <div data-testid="m2-revenue-output" style={{ padding: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Revenue (Output)</h1>
        <div style={{
          marginTop: 'var(--sp-3)', padding: 'var(--sp-3)', background: 'var(--color-surface)',
          border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-muted)', fontSize: 'var(--font-small)',
        }}>
          No Sell-strategy assets configured. Add Sell assets in Module 1 Tab 2, then enter revenue inputs in Module 2 Tab 1.
        </div>
      </div>
    );
  }

  return (
    <div data-testid="m2-revenue-output" style={{ padding: 'var(--sp-3)' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Revenue (Output)</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>
          {currencyHeaderLine(currency, scale)} ({decimals} dp)
        </div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)', maxWidth: 800 }}>
          Per-asset build: SQM Sold &rarr; Revenue &rarr; Recognition matrix &rarr; Cash matrix &rarr; Accounts Receivable &rarr; Unearned Revenue. Each table carries its formula inline.
        </p>
      </div>

      {phases.map((p) => {
        const phaseAssets = sellAssets.filter((a) => a.phaseId === p.id);
        if (phaseAssets.length === 0) return null;
        const handoverYearIdx = Math.max(0, Math.min(snap.axisLength - 1,
          (p.startDate ? new Date(p.startDate).getUTCFullYear() : projectStartYear)
            + (p.constructionPeriods ?? 0) - 1 - projectStartYear));

        return (
          <PhaseSection
            key={p.id}
            phaseId={p.id}
            title={p.name}
            meta={`${p.status ?? 'planning'} · handover ${snap.yearLabels[handoverYearIdx] ?? '?'}`}
            countLabel={`${phaseAssets.length} Sell asset${phaseAssets.length === 1 ? '' : 's'}`}
            storageKey={`fmp:m2:revenue:phase:${p.id}:collapsed`}
          >
            {phaseAssets.map((a) => {
              const r = snap.bySellAsset.get(a.id);
              if (!r) return null;
              const assetSubUnits = subUnits.filter((u) => u.assetId === a.id);
              const cfg = resolveSellConfig(a, project);
              const cashProfile = cfg?.cashPaymentProfile;
              const recProfile = cfg?.recognitionProfile;
              const indexation = cfg?.indexation;
              const totalAreaPerSU = assetSubUnits.map((su) => computeSubUnitArea(su));
              const assetBUA = totalAreaPerSU.reduce((s, v) => s + v, 0);

              // 5 + 6: AR + Unearned per asset (Pass 7q sale-value driven).
              // AR  = Pre-Sales Sale Value - Cash Received
              // UR  = Pre-Sales Sale Value - Revenue Recognised
              const ar = buildAccountsReceivable(
                r.presalesRevenuePerPeriod,
                r.presalesCashPerPeriod,
                r.axisLength,
              );
              const ur = buildUnearnedRevenue(
                r.presalesRecognitionPerPeriod,
                r.presalesRevenuePerPeriod,
                r.axisLength,
              );

              // Captions
              const indexLabel = indexation?.method === 'yoy_compound'
                ? `YoY ${((indexation.rate ?? 0) * 100).toFixed(2)}%`
                : indexation?.method === 'single_rate'
                  ? `single rate ${((indexation.rate ?? 0) * 100).toFixed(2)}%`
                  : indexation?.method === 'step'
                    ? 'step schedule'
                    : 'none';
              const recLabel = recProfile?.method === 'point_in_time'
                ? `Point-in-Time at ${recProfile.pointInTimeYear ?? 'handover'}`
                : 'Over-Time profile';
              const cashMode = cashProfile?.profileMode === 'relative_to_sale'
                ? 'relative-to-sale milestone schedule'
                : 'absolute milestone schedule with sale-year catchup';

              return (
                <AssetSection
                  key={a.id}
                  assetId={a.id}
                  title={a.name}
                  meta={a.type ? `${a.type}` : undefined}
                  storageKey={`fmp:m2:revenue:asset:${a.id}:collapsed`}
                >
                  {/* Pass 7x: sub-unit reference strip so users can
                      verify the area + price they entered in M1 Tab 2
                      without switching back. */}
                  <SubUnitReferenceStrip units={assetSubUnits} currency={currency} />

                  {/* 1. SQM Sold */}
                  <SectionHeading n="1" title="SQM Sold" />
                  <PeriodTable
                    title="1a. Pre-Sales SQM (per sub-unit)"
                    formula="Pre-Sales SQM[su, y] = preSalesVelocity[su, y] x sub-unit total area (capped at remaining unsold area)."
                    yearLabels={snap.yearLabels}
                    rows={buildPerSubUnitRows(
                      assetSubUnits,
                      r.presalesAreaPerPeriodPerSubUnit,
                      r.presalesAreaPerPeriod,
                      'Asset Pre-Sales SQM',
                    )}
                    unit="sqm"
                    fmt={areaFmt}
                  />
                  <PeriodTable
                    title="1b. Sales During Operation SQM (per sub-unit)"
                    formula="Post-Sales SQM[su, y] = postSalesVelocity[su, y] x sub-unit total area (capped at remaining unsold area)."
                    yearLabels={snap.yearLabels}
                    rows={buildPerSubUnitRows(
                      assetSubUnits,
                      r.postSalesAreaPerPeriodPerSubUnit,
                      r.postSalesAreaPerPeriod,
                      'Asset Post-Sales SQM',
                    )}
                    unit="sqm"
                    fmt={areaFmt}
                  />
                  <PeriodTable
                    title="1c. Total SQM Sold + Reconciliation"
                    formula="Total SQM[su, y] = Pre + Post. Cum % of BUA = sum(Pre + Post) / sub-unit total area. Engine caps each sub-unit at 100%; this column shows under/over-sell vs BUA."
                    yearLabels={snap.yearLabels}
                    rows={buildTotalSqmReconciledRows(
                      assetSubUnits,
                      totalAreaPerSU,
                      r.presalesAreaPerPeriodPerSubUnit,
                      r.postSalesAreaPerPeriodPerSubUnit,
                      r.presalesAreaPerPeriod.map((v, i) => v + (r.postSalesAreaPerPeriod[i] ?? 0)),
                      assetBUA,
                    )}
                    unit="sqm"
                    fmt={areaFmt}
                    trailingHeader="Cum % of BUA"
                  />

                  {/* 2. Revenue */}
                  <SectionHeading n="2" title="Revenue (Sales Value)" />
                  <PeriodTable
                    title="2a. Pre-Sales Revenue (per sub-unit)"
                    formula={`Pre-Sales Revenue[su, y] = Pre-Sales SQM[su, y] x base rate (M1 Tab 2) x indexation factor at year y (indexation: ${indexLabel}).`}
                    yearLabels={snap.yearLabels}
                    rows={buildPerSubUnitRows(
                      assetSubUnits,
                      r.presalesRevenuePerPeriodPerSubUnit,
                      r.presalesRevenuePerPeriod,
                      'Asset Pre-Sales Revenue',
                    )}
                    unit={currency}
                    fmt={fmt}
                  />
                  <PeriodTable
                    title="2b. Sales During Operation Revenue (per sub-unit)"
                    formula={`Post-Sales Revenue[su, y] = Post-Sales SQM[su, y] x base rate x indexation factor at y (indexation: ${indexLabel}).`}
                    yearLabels={snap.yearLabels}
                    rows={buildPerSubUnitRows(
                      assetSubUnits,
                      r.postSalesRevenuePerPeriodPerSubUnit,
                      r.postSalesRevenuePerPeriod,
                      'Asset Post-Sales Revenue',
                    )}
                    unit={currency}
                    fmt={fmt}
                  />
                  <PeriodTable
                    title="2c. Total Revenue (per sub-unit)"
                    formula="Total Revenue[su, y] = Pre-Sales Revenue + Post-Sales Revenue."
                    yearLabels={snap.yearLabels}
                    rows={(() => {
                      const totalPerSU: Record<string, number[]> = {};
                      for (const su of assetSubUnits) {
                        const pre = r.presalesRevenuePerPeriodPerSubUnit[su.id] ?? [];
                        const post = r.postSalesRevenuePerPeriodPerSubUnit[su.id] ?? [];
                        const N = Math.max(pre.length, post.length);
                        const arr = new Array<number>(N).fill(0);
                        for (let i = 0; i < N; i++) arr[i] = (pre[i] ?? 0) + (post[i] ?? 0);
                        totalPerSU[su.id] = arr;
                      }
                      const totalAcross = r.presalesRevenuePerPeriod.map((v, i) => v + (r.postSalesRevenuePerPeriod[i] ?? 0));
                      return buildPerSubUnitRows(
                        assetSubUnits,
                        totalPerSU,
                        totalAcross,
                        'Asset Total Revenue',
                      );
                    })()}
                    unit={currency}
                    fmt={fmt}
                  />

                  {/* 3. Revenue Recognised */}
                  <SectionHeading n="3" title="Revenue Recognised" />
                  <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, fontStyle: 'italic' }}>
                    Formula: rows = cohort sale year, columns = year recognised. {recLabel}. Sum across each row = cohort total sales value; sum down each column = P&amp;L recognition per year (Pre-Sales only).
                  </div>
                  <VintageMatrix
                    title="3a. Pre-Sales Recognition Vintage Matrix"
                    yearLabels={snap.yearLabels}
                    matrix={r.recognitionVintageMatrix}
                    currency={currency}
                    handoverYearIdx={handoverYearIdx}
                    fmt={fmt}
                  />
                  <PeriodTable
                    title="3b. Recognition Summary (per period)"
                    formula="Pre-Sales Recognised = column-sum of 3a (per recognition profile). Sales During Operation Recognised = post-sales revenue recognised same period (operating sales, no deferral). Total = Pre + Post = P&L revenue per year."
                    yearLabels={snap.yearLabels}
                    rows={[
                      { label: 'Pre-Sales Recognised', values: r.presalesRecognitionPerPeriod },
                      { label: 'Sales During Operation Recognised', values: r.postSalesRecognitionPerPeriod },
                      { label: 'Total Revenue Recognised', values: r.recognitionPerPeriod, kind: 'grand' },
                    ]}
                    unit={currency}
                    fmt={fmt}
                  />

                  {/* 4. Cash Collected */}
                  <SectionHeading n="4" title="Cash Collected" />
                  <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, fontStyle: 'italic' }}>
                    Formula: rows = cohort sale year, columns = year collected. Each cohort cascades through the cash payment profile ({cashMode}). Sum across each row = cohort total sales value; sum down each column = cash collected per year (Pre-Sales only).
                  </div>
                  <VintageMatrix
                    title="4a. Pre-Sales Cash Vintage Matrix"
                    yearLabels={snap.yearLabels}
                    matrix={r.cashVintageMatrix}
                    currency={currency}
                    handoverYearIdx={handoverYearIdx}
                    fmt={fmt}
                  />
                  <PeriodTable
                    title="4b. Cash Summary (per period)"
                    formula="Pre-Sales Cash = column-sum of 4a (per cash payment profile). Sales During Operation Cash = post-sales revenue collected same period (operating sales, no deferral). Total = Pre + Post = cash flow from revenue per year."
                    yearLabels={snap.yearLabels}
                    rows={[
                      { label: 'Pre-Sales Cash', values: r.presalesCashPerPeriod },
                      { label: 'Sales During Operation Cash', values: r.postSalesCashPerPeriod },
                      { label: 'Total Cash Collected', values: r.cashCollectedPerPeriod, kind: 'grand' },
                    ]}
                    unit={currency}
                    fmt={fmt}
                  />

                  {/* 5. Accounts Receivable, sale-value driven roll-forward */}
                  <SectionHeading n="5" title="Accounts Receivable" />
                  <PeriodTable
                    title="5. Accounts Receivable (Sales Receivable roll-forward)"
                    formula="Closing[y] = Opening[y] + Pre-Sales Sale Value[y] - Cash Received[y]. Opening[y] = Closing[y-1] (Opening[0] = 0). Sale value (Block 2a) credits the receivable at contract signing; cash received via the milestone profile drains it. Settles to 0 when total cash equals total pre-sales sale value."
                    yearLabels={snap.yearLabels}
                    rows={[
                      { label: 'Opening AR', values: ar.openingPerPeriod },
                      { label: '(+) Pre-Sales Sale Value', values: r.presalesRevenuePerPeriod },
                      { label: '(-) Cash Received', values: r.presalesCashPerPeriod.map((v) => -v) },
                      { label: 'Change in AR (CF delta)', values: ar.changePerPeriod, kind: 'subtotal' },
                      { label: 'Closing AR', values: ar.perPeriod, kind: 'grand' },
                    ]}
                    unit={currency}
                    fmt={fmt}
                  />

                  {/* 6. Unearned Revenue, sale-value driven roll-forward */}
                  <SectionHeading n="6" title="Unearned Revenue" />
                  <PeriodTable
                    title="6. Unearned Revenue (Contract Liability roll-forward)"
                    formula="Closing[y] = Opening[y] + Pre-Sales Sale Value[y] - Revenue Recognised[y]. Opening[y] = Closing[y-1] (Opening[0] = 0). Sale value (Block 2a) credits the obligation at contract signing; recognition via the recognition profile drains it. Settles to 0 when total recognition equals total pre-sales sale value."
                    yearLabels={snap.yearLabels}
                    rows={[
                      { label: 'Opening Unearned', values: ur.openingPerPeriod },
                      { label: '(+) Pre-Sales Sale Value', values: r.presalesRevenuePerPeriod },
                      { label: '(-) Revenue Recognised', values: r.presalesRecognitionPerPeriod.map((v) => -v) },
                      { label: 'Change in Unearned (CF delta)', values: ur.changePerPeriod, kind: 'subtotal' },
                      { label: 'Closing Unearned', values: ur.perPeriod, kind: 'grand' },
                    ]}
                    unit={currency}
                    fmt={fmt}
                  />
                </AssetSection>
              );
            })}
          </PhaseSection>
        );
      })}

      <PhaseSection
        phaseId="__project__"
        title="Project Total"
        meta="all phases combined, grouped by strategy"
        storageKey="fmp:m2:revenue:phase:__project__:collapsed"
      >
        <PeriodTable
          title="Project Revenue (Sales Value year-on-year)"
          formula="Per-asset breakdown grouped by strategy. Sell shows Pre-Sales + Sales During Operation. Hospitality / Lease / Sell+Manage placeholder zeros wire in at Pass 8 / 9 / 10."
          yearLabels={snap.yearLabels}
          rows={buildProjectGroupedRows({ view: 'revenue', assets, snap })}
          unit={currency}
          fmt={fmt}
        />
        <PeriodTable
          title="Project Revenue Recognised"
          formula="Per-asset breakdown grouped by strategy. Sell Pre-Sales = recognition profile spread; Sales During Operation = same-period (operating). Hospitality / Lease / Sell+Manage placeholder zeros wire in at Pass 8 / 9 / 10."
          yearLabels={snap.yearLabels}
          rows={buildProjectGroupedRows({ view: 'recognition', assets, snap })}
          unit={currency}
          fmt={fmt}
        />
        <PeriodTable
          title="Project Cash Collected"
          formula="Per-asset breakdown grouped by strategy. Sell Pre-Sales = cash payment profile; Sales During Operation = same-period (operating). Hospitality / Lease / Sell+Manage placeholder zeros wire in at Pass 8 / 9 / 10."
          yearLabels={snap.yearLabels}
          rows={buildProjectGroupedRows({ view: 'cash', assets, snap })}
          unit={currency}
          fmt={fmt}
        />
      </PhaseSection>
    </div>
  );
}

function SectionHeading({ n, title }: { n: string; title: string }): React.JSX.Element {
  return (
    <div style={{
      marginTop: 'var(--sp-3)',
      marginBottom: 'var(--sp-1)',
      padding: '4px 8px',
      background: 'color-mix(in srgb, var(--color-navy) 8%, transparent)',
      borderLeft: '3px solid var(--color-navy)',
      borderRadius: '2px',
    }}>
      <strong style={{
        fontSize: 12,
        color: 'var(--color-heading)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        {n}. {title}
      </strong>
    </div>
  );
}

export type { SellAssetResult };
