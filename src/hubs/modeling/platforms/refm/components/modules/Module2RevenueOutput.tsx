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

function unitsFmt(v: number): string {
  if (!Number.isFinite(v)) return '-';
  if (Math.abs(v) < 0.5) return '-';
  return Math.round(v).toLocaleString('en-US');
}

/**
 * Pass 7y (2026-05-18): per-asset metric resolution. Returns the
 * dominant metric for an asset based on its sub-units. Uniform asset
 * (all sub-units in same metric) -> that metric. Mixed -> 'area' (the
 * universal denominator the engine always tracks). Empty -> 'area'.
 *
 * SubUnitMetric type is 'units' | 'area'; UI calls 'area' "sqm" in
 * user-facing labels.
 */
function resolveAssetMetric(units: Array<{ metric: 'units' | 'area' }>): {
  metric: 'units' | 'area';
  uniform: boolean;
} {
  if (units.length === 0) return { metric: 'area', uniform: true };
  const first = units[0].metric;
  const uniform = units.every((u) => u.metric === first);
  return { metric: uniform ? first : 'area', uniform };
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
  /**
   * Pass 8f (2026-05-18): per-row formatter overriding the table's fmt
   * prop. Lets a single PeriodTable mix currency / integer / % / decimal
   * factor rows — e.g., Hospitality Block 1 walking from Rooms (int) ->
   * Days (int) -> Occupancy (%) -> ADR Factor (×) -> ADR (currency) ->
   * ARN/ORN/Guests (int).
   */
  rowFmt?: (v: number) => string;
  /**
   * Optional explicit string for the "Total" column. Use for constant
   * broadcast values (Rooms, Days) where summing across years is
   * meaningless, or for rate rows where you'd rather show
   * latest/average/dash than a nonsense sum.
   */
  totalOverride?: string;
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
              // Pass 8f: respect per-row formatter + total override.
              const cellFmt = r.rowFmt ?? fmt;
              const totalDisplay = r.totalOverride ?? cellFmt(total);
              return (
                <tr key={`${r.label}-${idx}`}>
                  <td style={labelStyle}>{r.label}</td>
                  <td style={tokens.numTotal}>{totalDisplay}</td>
                  {trailingHeader && (
                    <td style={tokens.num}>{r.trailing ?? ''}</td>
                  )}
                  {r.values.map((v, j) => (<td key={j} style={tokens.num}>{cellFmt(v ?? 0)}</td>))}
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
 * Total Sold block (1c) with reconciliation. Generic across metrics:
 * pass per-sub-unit denominator (total area when metric='sqm', total
 * units when metric='units') + the matching pre/post arrays.
 *
 * Pass 7y (2026-05-18): renamed from buildTotalSqmReconciledRows; the
 * math is identical for both metrics, the math just divides sold by
 * total inventory.
 */
function buildTotalSoldReconciledRows(
  subUnits: Array<{ id: string; name: string }>,
  totalInventoryPerSU: number[],
  preSU: Record<string, number[]>,
  postSU: Record<string, number[]>,
  totalAcrossSU: number[],
  assetInventory: number,
): PeriodRow[] {
  const rows: PeriodRow[] = [];
  subUnits.forEach((su, idx) => {
    const inv = Math.max(0, totalInventoryPerSU[idx] ?? 0);
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
    const cumPct = inv > 0 ? sold / inv : 0;
    const pctLabel = `${(cumPct * 100).toFixed(0)}%`;
    rows.push({ label: su.name || 'sub-unit', values: combined, trailing: pctLabel });
  });
  const assetCumPct = assetInventory > 0
    ? totalAcrossSU.reduce((s, v) => s + v, 0) / assetInventory
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
      // Pass 8b (2026-05-18): real engine values for Operate + Sell +
      // Manage companions. Revenue / Recognition / Cash all read
      // totalRevenuePerPeriod (operating-sales convention: rec = cash
      // = revenue same period). Companion engine still wires in at
      // Pass 10; meanwhile companions without operate config are zero.
      const hospResult = snap.byHospitalityAsset.get(a.id);
      const vals = hospResult ? hospResult.totalRevenuePerPeriod : zeros();
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
  // Pass 8c (2026-05-18): Hospitality-only projects no longer hit the
  // "no Sell assets" placeholder. The output surface now serves both
  // Sell narratives + Hospitality narratives.
  const operateAssetsAny = assets.some(
    (a) => a.visible !== false && (a.strategy === 'Operate' || a.isCompanion === true),
  );

  if (sellAssets.length === 0 && !operateAssetsAny) {
    return (
      <div data-testid="m2-revenue-output" style={{ padding: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Revenue (Output)</h1>
        <div style={{
          marginTop: 'var(--sp-3)', padding: 'var(--sp-3)', background: 'var(--color-surface)',
          border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-muted)', fontSize: 'var(--font-small)',
        }}>
          No revenue-bearing assets configured. Add Sell, Operate, or Sell + Manage assets in Module 1 Tab 2, then enter revenue inputs in Module 2 Tab 1.
        </div>
      </div>
    );
  }

  // Pass 9d (2026-05-18): renderHospitalityAssetSection lifts the
  // hospitality per-asset JSX (Blocks 1 + 2) into a helper so it can
  // be rendered in two places:
  //   1. The standalone Hospitality phase section (pure Operate
  //      assets + Operate companions of non-Sell-Manage parents).
  //   2. Inline under each Sell + Manage parent, immediately after
  //      the parent's Sell narrative — so the user sees Tower 01's
  //      Sell blocks and its Manage / Operate blocks together in
  //      one continuous asset narrative.
  // The `inline` flag wraps the section in a left-border + label
  // chip ("↳ Manage / Operate") to make the parent-child link
  // visible. Standalone callers pass inline=false.
  const renderHospitalityAssetSection = (a: Asset, inline: boolean): React.JSX.Element => {
    const r = snap.byHospitalityAsset.get(a.id);
    const assetSubUnits = subUnits.filter((u) => u.assetId === a.id);
    const wrap = (inner: React.JSX.Element): React.JSX.Element => {
      if (!inline) return inner;
      return (
        <div
          key={a.id}
          style={{
            marginLeft: 20,
            marginTop: -6,
            marginBottom: 'var(--sp-3)',
            paddingLeft: 12,
            borderLeft: '3px solid var(--color-info, #1d4ed8)',
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-info, #1d4ed8)',
              fontWeight: 600,
              marginBottom: 4,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            ↳ Manage / Operate · revenue from operations after handover
          </div>
          {inner}
        </div>
      );
    };
    if (!r) {
      return wrap(
        <AssetSection
          key={a.id}
          assetId={a.id}
          title={a.name}
          meta={a.type ? `${a.type}` : undefined}
          storageKey={`fmp:m2:revenue:asset:${a.id}:collapsed`}
        >
          <SubUnitReferenceStrip units={assetSubUnits} currency={currency} />
          <div style={{ padding: '8px 12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
            No operate config yet. Enter ADR + Occupancy on the Inputs tab.
          </div>
        </AssetSection>,
      );
    }
    const pctFmt = (v: number): string => {
      if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return '-';
      return `${(v * 100).toFixed(1)}%`;
    };
    const factorFmt = (v: number): string => {
      if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return '-';
      return `${v.toFixed(4)}×`;
    };
    // Pass 9e-4 (2026-05-18): ADR + per-guest rates are per-night /
    // per-guest figures, NOT period flow amounts. The project-level
    // display scale (typically 'thousands') would render 1,200 SAR as
    // "1" — wrong for rate fields. Force 'full' scale + 0 decimals for
    // ADR and per-guest rate rows.
    const adrFmt = makeCurrencyFmt('full', 0);
    const opCfg = a.revenue?.operate;
    const opKeys = assetSubUnits
      .filter((u) => u.metric === 'units')
      .reduce((s, u) => s + Math.max(0, Math.round(u.metricValue)), 0);
    const opDaysPerYear = opCfg?.daysPerYear ?? 365;
    const opGuestsPerOR = opCfg?.guestsPerOccupiedRoom ?? 1.5;
    const opFbMode = opCfg?.fb?.mode ?? 'percent_of_rooms';
    const opOtherMode = opCfg?.otherRevenue?.mode ?? 'percent_of_rooms';
    const resolveAncillary = (raw: number | number[] | undefined, n: number): number[] => {
      if (Array.isArray(raw)) {
        const out = new Array<number>(n).fill(0);
        for (let i = 0; i < n; i++) out[i] = Math.max(0, raw[i] ?? 0);
        return out;
      }
      const scalar = Math.max(0, raw ?? 0);
      return new Array<number>(n).fill(scalar);
    };
    const isScalar = (raw: number | number[] | undefined): boolean => !Array.isArray(raw);
    const N = r.adrPerPeriod.length;
    const opFbPctOfRoomsArr = resolveAncillary(opCfg?.fb?.percentOfRooms, N);
    const opFbRatePerGuestArr = resolveAncillary(opCfg?.fb?.ratePerGuest, N);
    const opFbFixedArr = resolveAncillary(opCfg?.fb?.fixedAmountPerPeriod, N);
    const opOtherPctOfRoomsArr = resolveAncillary(opCfg?.otherRevenue?.percentOfRooms, N);
    const opOtherRatePerGuestArr = resolveAncillary(opCfg?.otherRevenue?.ratePerGuest, N);
    const opOtherFixedArr = resolveAncillary(opCfg?.otherRevenue?.fixedAmountPerPeriod, N);
    const opFbPctScalar = isScalar(opCfg?.fb?.percentOfRooms) ? Math.max(0, (opCfg?.fb?.percentOfRooms as number | undefined) ?? 0) : null;
    const opFbRatePerGuestScalar = isScalar(opCfg?.fb?.ratePerGuest) ? Math.max(0, (opCfg?.fb?.ratePerGuest as number | undefined) ?? 0) : null;
    const opOtherPctScalar = isScalar(opCfg?.otherRevenue?.percentOfRooms) ? Math.max(0, (opCfg?.otherRevenue?.percentOfRooms as number | undefined) ?? 0) : null;
    const opOtherRatePerGuestScalar = isScalar(opCfg?.otherRevenue?.ratePerGuest) ? Math.max(0, (opCfg?.otherRevenue?.ratePerGuest as number | undefined) ?? 0) : null;
    const opsMask = r.availableRoomNightsPerPeriod.map((arn) => (arn > 0 ? 1 : 0));
    const masked = (arr: number[]): number[] => arr.map((v, i) => v * (opsMask[i] ?? 0));
    const showGuestsPerOR = opFbMode === 'per_guest' || opOtherMode === 'per_guest';
    const broadcastIfOps = (v: number): number[] => r.availableRoomNightsPerPeriod.map((arn) => (arn > 0 ? v : 0));
    const intFmt = unitsFmt;
    const finalAdr = (() => {
      for (let i = r.adrPerPeriod.length - 1; i >= 0; i--) if (r.adrPerPeriod[i] > 0) return r.adrPerPeriod[i];
      return 0;
    })();
    const finalFactor = (() => {
      for (let i = r.adrIndexationFactorPerPeriod.length - 1; i >= 0; i--) if (r.adrIndexationFactorPerPeriod[i] > 0) return r.adrIndexationFactorPerPeriod[i];
      return 0;
    })();
    const occNonZero = r.occupancyPerPeriod.filter((v) => v > 0);
    const occAvg = occNonZero.length > 0 ? occNonZero.reduce((s, v) => s + v, 0) / occNonZero.length : 0;
    const unitSubUnits = assetSubUnits.filter((u) => u.metric === 'units');
    const showPerSuBreakdown = unitSubUnits.length > 1;
    const lastNonZero = (arr: number[]): number => {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i] > 0) return arr[i];
      return 0;
    };
    const perSuAdrRows = showPerSuBreakdown
      ? unitSubUnits.flatMap((u) => {
          const sub = r.perSubUnit?.[u.id];
          if (!sub) return [];
          const keysRounded = Math.round(Math.max(0, u.metricValue));
          return [{
            label: `${u.name} ADR (${keysRounded.toLocaleString('en-US')} keys)`,
            values: sub.adrPerPeriod,
            rowFmt: adrFmt,
            totalOverride: adrFmt(lastNonZero(sub.adrPerPeriod)),
            indent: 2,
          }];
        })
      : [];
    const perSuRoomsRevenueRows = showPerSuBreakdown
      ? unitSubUnits.flatMap((u) => {
          const sub = r.perSubUnit?.[u.id];
          if (!sub) return [];
          return [{
            label: `${u.name} Rooms Revenue`,
            values: sub.roomsRevenuePerPeriod,
            rowFmt: fmt,
            indent: 1,
          }];
        })
      : [];
    // Pass 9e-9 (2026-05-18): per-sub-unit ARN + ORN breakdown so the
    // user can see how many room nights each room type contributes
    // before the asset-level total. Mirrors the ADR + Rooms Revenue
    // breakdown above.
    const perSuArnRows = showPerSuBreakdown
      ? unitSubUnits.flatMap((u) => {
          const sub = r.perSubUnit?.[u.id];
          if (!sub) return [];
          const keysRounded = Math.round(Math.max(0, u.metricValue));
          return [{
            label: `${u.name} ARN (${keysRounded.toLocaleString('en-US')} keys × Days)`,
            values: sub.availableRoomNightsPerPeriod,
            rowFmt: intFmt,
            indent: 2,
          }];
        })
      : [];
    const perSuOrnRows = showPerSuBreakdown
      ? unitSubUnits.flatMap((u) => {
          const sub = r.perSubUnit?.[u.id];
          if (!sub) return [];
          return [{
            label: `${u.name} ORN (ARN × Occupancy)`,
            values: sub.occupiedRoomNightsPerPeriod,
            rowFmt: intFmt,
            indent: 2,
          }];
        })
      : [];
    return wrap(
      <AssetSection
        key={a.id}
        assetId={a.id}
        title={a.name}
        meta={a.type ? `${a.type}` : undefined}
        storageKey={`fmp:m2:revenue:asset:${a.id}:collapsed`}
      >
        <SubUnitReferenceStrip units={assetSubUnits} currency={currency} />
        <SectionHeading n="1" title="Operations Capacity" />
        <PeriodTable
          title="1. Drivers + Calculations"
          formula="Driver rows are user inputs (broadcast or per-year); only the F&B + Other inputs matching the active mode are shown. Calculations: Available Room Nights = Keys × Days/Year; Occupied Room Nights = ARN × Occupancy; Guests = ORN × Guests/Room."
          yearLabels={snap.yearLabels}
          rows={[
            { label: 'Drivers', values: [], kind: 'section' as const, indent: 0 },
            { label: 'Total Rooms (Keys)', values: broadcastIfOps(opKeys), rowFmt: intFmt, totalOverride: intFmt(opKeys), indent: 1 },
            { label: 'Days per Year', values: broadcastIfOps(opDaysPerYear), rowFmt: intFmt, totalOverride: intFmt(opDaysPerYear), indent: 1 },
            { label: 'Occupancy %', values: r.occupancyPerPeriod, rowFmt: pctFmt, totalOverride: pctFmt(occAvg), indent: 1 },
            { label: 'ADR Indexation Factor', values: r.adrIndexationFactorPerPeriod, rowFmt: factorFmt, totalOverride: factorFmt(finalFactor), indent: 1 },
            {
              label: showPerSuBreakdown
                ? `ADR (keys-weighted avg, ${currency} per occupied room night)`
                : `ADR (${currency} per occupied room night)`,
              values: r.adrPerPeriod,
              rowFmt: adrFmt,
              totalOverride: adrFmt(finalAdr),
              indent: 1,
            },
            ...perSuAdrRows,
            ...(showGuestsPerOR
              ? [{ label: 'Guests per Occupied Room', values: broadcastIfOps(opGuestsPerOR), rowFmt: (v: number) => (Number.isFinite(v) && v > 0 ? v.toFixed(2) : '-'), totalOverride: opGuestsPerOR.toFixed(2), indent: 1 }]
              : []),
            ...(opFbMode === 'percent_of_rooms'
              ? [{ label: 'F&B % of Rooms Revenue', values: masked(opFbPctOfRoomsArr), rowFmt: pctFmt, totalOverride: opFbPctScalar !== null ? pctFmt(opFbPctScalar) : undefined, indent: 1 }]
              : []),
            ...(opFbMode === 'per_guest'
              ? [{ label: `F&B Rate per Guest (${currency})`, values: masked(opFbRatePerGuestArr), rowFmt: adrFmt, totalOverride: opFbRatePerGuestScalar !== null ? adrFmt(opFbRatePerGuestScalar) : undefined, indent: 1 }]
              : []),
            ...(opFbMode === 'fixed_amount'
              ? [{ label: `F&B Fixed Amount per Year (${currency})`, values: masked(opFbFixedArr), rowFmt: fmt, indent: 1 }]
              : []),
            ...(opOtherMode === 'percent_of_rooms'
              ? [{ label: 'Other % of Rooms Revenue', values: masked(opOtherPctOfRoomsArr), rowFmt: pctFmt, totalOverride: opOtherPctScalar !== null ? pctFmt(opOtherPctScalar) : undefined, indent: 1 }]
              : []),
            ...(opOtherMode === 'per_guest'
              ? [{ label: `Other Rate per Guest (${currency})`, values: masked(opOtherRatePerGuestArr), rowFmt: adrFmt, totalOverride: opOtherRatePerGuestScalar !== null ? adrFmt(opOtherRatePerGuestScalar) : undefined, indent: 1 }]
              : []),
            ...(opOtherMode === 'fixed_amount'
              ? [{ label: `Other Fixed Amount per Year (${currency})`, values: masked(opOtherFixedArr), rowFmt: fmt, indent: 1 }]
              : []),
            { label: 'Calculations', values: [], kind: 'section' as const, indent: 0 },
            ...perSuArnRows,
            {
              label: showPerSuBreakdown ? 'Total Available Room Nights' : 'Available Room Nights',
              values: r.availableRoomNightsPerPeriod,
              rowFmt: intFmt,
              kind: showPerSuBreakdown ? 'subtotal' as const : undefined,
              indent: 1,
            },
            ...perSuOrnRows,
            {
              label: showPerSuBreakdown ? 'Total Occupied Room Nights' : 'Occupied Room Nights',
              values: r.occupiedRoomNightsPerPeriod,
              rowFmt: intFmt,
              kind: showPerSuBreakdown ? 'subtotal' as const : undefined,
              indent: 1,
            },
            { label: `Guests per Year (× ${opGuestsPerOR.toFixed(2)} guests / ORN)`, values: r.guestsPerPeriod, rowFmt: intFmt, kind: 'subtotal' as const, indent: 1 },
          ]}
          fmt={intFmt}
        />
        <SectionHeading n="2" title="Revenue" />
        <PeriodTable
          title="2. Rooms + F&B + Other + Total Hospitality Revenue"
          formula="Rooms = ORN × ADR (per sub-unit, then summed). F&B + Other follow per-asset mode (% of Rooms / Per Guest / Fixed Annual). Operating-sales convention: recognition = cash = revenue in the same period."
          yearLabels={snap.yearLabels}
          rows={[
            ...perSuRoomsRevenueRows,
            {
              label: showPerSuBreakdown ? 'Total Rooms Revenue' : 'Rooms Revenue',
              values: r.roomsRevenuePerPeriod,
              kind: showPerSuBreakdown ? 'subtotal' as const : undefined,
            },
            { label: 'F&B Revenue', values: r.fbRevenuePerPeriod },
            { label: 'Other Revenue', values: r.otherRevenuePerPeriod },
            { label: 'Total Hospitality Revenue', values: r.totalRevenuePerPeriod, kind: 'grand' as const },
          ]}
          fmt={fmt}
        />
        <div style={{ fontSize: 11, color: 'var(--color-meta)', fontStyle: 'italic', padding: '4px 0' }}>
          Recognition + Cash: equal to Total Revenue per period (operating-sales convention, no deferral). AR via DSO surfaces on the Schedules tab.
        </div>
      </AssetSection>,
    );
  };

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

      {/* Pass 9e-8 (2026-05-18): strategy-first grouping per user.
          Outer sections are Residential / Sell, Hospitality / Operations,
          Retail / Lease. Inside each, phases are nested as smaller
          subheadings. Asset cards (AssetSection) keep their own
          per-card collapse, so a 10-asset, 3-phase project still feels
          tidy. */}
      <PhaseSection
        phaseId="strategy-sell"
        title="Residential / Sell"
        meta="Sell + Sell + Manage parents across all phases"
        countLabel={`${sellAssets.length} asset${sellAssets.length === 1 ? '' : 's'}`}
        storageKey="fmp:m2:revenue:strategy:sell:collapsed"
      >
      {sellAssets.length === 0 && (
        <div style={{ padding: '8px 12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
          No Sell or Sell + Manage assets configured yet.
        </div>
      )}
      {phases.map((p) => {
        const phaseAssets = sellAssets.filter((a) => a.phaseId === p.id);
        if (phaseAssets.length === 0) return null;
        const handoverYearIdx = Math.max(0, Math.min(snap.axisLength - 1,
          (p.startDate ? new Date(p.startDate).getUTCFullYear() : projectStartYear)
            + (p.constructionPeriods ?? 0) - 1 - projectStartYear));

        return (
          <div key={p.id} style={{ marginBottom: 'var(--sp-2)' }}>
            <PhaseDivider
              title={p.name}
              meta={`${p.status ?? 'planning'} · handover ${snap.yearLabels[handoverYearIdx] ?? '?'}`}
              count={`${phaseAssets.length} Sell asset${phaseAssets.length === 1 ? '' : 's'}`}
            />
            {phaseAssets.map((a) => {
              const r = snap.bySellAsset.get(a.id);
              // Pass 9e-7 (2026-05-18): for Sell + Manage parents with
              // no revenue.sell config yet, render a placeholder so the
              // asset still appears in the Sell section. The companion
              // is no longer nested here — it shows in the standalone
              // Hospitality / Operations section per user direction
              // (same treatment as other hospitality assets).
              if (!r) {
                if (a.strategy === 'Sell + Manage') {
                  return (
                    <AssetSection
                      key={a.id}
                      assetId={a.id}
                      title={a.name}
                      meta={a.type ? `${a.type}` : undefined}
                      storageKey={`fmp:m2:revenue:asset:${a.id}:collapsed`}
                    >
                      <div style={{ padding: '8px 12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
                        No Sell-side revenue config yet. Enter velocity / cash / recognition on the Inputs tab to populate Blocks 1-6. The Manage / Operate half shows under Hospitality / Operations below.
                      </div>
                    </AssetSection>
                  );
                }
                return null;
              }
              const assetSubUnits = subUnits.filter((u) => u.assetId === a.id);
              const cfg = resolveSellConfig(a, project);
              const cashProfile = cfg?.cashPaymentProfile;
              const recProfile = cfg?.recognitionProfile;
              const indexation = cfg?.indexation;
              const totalAreaPerSU = assetSubUnits.map((su) => computeSubUnitArea(su));
              const assetBUA = totalAreaPerSU.reduce((s, v) => s + v, 0);
              // Pass 7y: metric-aware Block 1. Uniform-units asset shows
              // Block 1 in units (apartments / keys); uniform-sqm shows
              // in sqm; mixed-asset falls back to sqm (universal).
              const { metric: assetMetric, uniform: metricUniform } = resolveAssetMetric(assetSubUnits);
              const useUnits = assetMetric === 'units';
              const totalUnitsPerSU = assetSubUnits.map((su) => su.metric === 'units' ? Math.max(0, su.metricValue) : 0);
              const assetTotalUnits = totalUnitsPerSU.reduce((s, v) => s + v, 0);
              const inventoryLabel = useUnits ? 'Units' : 'SQM';
              const inventoryLabelLower = useUnits ? 'units' : 'sqm';
              const inventoryFmt = useUnits ? unitsFmt : areaFmt;
              const preInventoryPerSU = useUnits ? r.presalesUnitsPerPeriodPerSubUnit : r.presalesAreaPerPeriodPerSubUnit;
              const postInventoryPerSU = useUnits ? r.postSalesUnitsPerPeriodPerSubUnit : r.postSalesAreaPerPeriodPerSubUnit;
              const preInventoryTotal = useUnits ? r.presalesUnitsPerPeriod : r.presalesAreaPerPeriod;
              const postInventoryTotal = useUnits ? r.postSalesUnitsPerPeriod : r.postSalesAreaPerPeriod;
              const inventoryDenomPerSU = useUnits ? totalUnitsPerSU : totalAreaPerSU;
              const inventoryDenomAsset = useUnits ? assetTotalUnits : assetBUA;

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

              // Pass 9e-7 (2026-05-18): companion no longer rendered
              // inline in the Sell section. It shows under Hospitality
              // / Operations as a separate asset, mirroring the Inputs
              // tab's separate-collapsible treatment.
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

                  {/* 1. Inventory Sold (metric-aware per Pass 7y) */}
                  <SectionHeading n="1" title={`${inventoryLabel} Sold`} />
                  {!metricUniform && (
                    <div style={{ fontSize: 10, color: 'var(--color-meta)', fontStyle: 'italic', marginBottom: 6 }}>
                      Note: sub-units use mixed metrics. Block 1 shown in sqm (the universal denominator). Per-sub-unit native metrics still apply for rounding.
                    </div>
                  )}
                  <PeriodTable
                    title={`1a. Pre-Sales ${inventoryLabel} (per sub-unit)`}
                    formula={`Pre-Sales ${inventoryLabel}[su, y] = preSalesVelocity[su, y] x sub-unit total inventory (capped at remaining unsold inventory). Engine rounds to whole ${inventoryLabelLower} per sub-unit before deriving revenue.`}
                    yearLabels={snap.yearLabels}
                    rows={buildPerSubUnitRows(
                      assetSubUnits,
                      preInventoryPerSU,
                      preInventoryTotal,
                      `Asset Pre-Sales ${inventoryLabel}`,
                    )}
                    fmt={inventoryFmt}
                  />
                  <PeriodTable
                    title={`1b. Sales During Operation ${inventoryLabel} (per sub-unit)`}
                    formula={`Post-Sales ${inventoryLabel}[su, y] = postSalesVelocity[su, y] x sub-unit total inventory (capped at remaining unsold inventory).`}
                    yearLabels={snap.yearLabels}
                    rows={buildPerSubUnitRows(
                      assetSubUnits,
                      postInventoryPerSU,
                      postInventoryTotal,
                      `Asset Post-Sales ${inventoryLabel}`,
                    )}
                    fmt={inventoryFmt}
                  />
                  <PeriodTable
                    title={`1c. Total ${inventoryLabel} Sold + Reconciliation`}
                    formula={`Total ${inventoryLabel}[su, y] = Pre + Post. Cum % Sold = sum(Pre + Post) / sub-unit total inventory. Engine caps each sub-unit at 100%; this column shows under/over-sell vs total inventory.`}
                    yearLabels={snap.yearLabels}
                    rows={buildTotalSoldReconciledRows(
                      assetSubUnits,
                      inventoryDenomPerSU,
                      preInventoryPerSU,
                      postInventoryPerSU,
                      preInventoryTotal.map((v, i) => v + (postInventoryTotal[i] ?? 0)),
                      inventoryDenomAsset,
                    )}
                    fmt={inventoryFmt}
                    trailingHeader="Cum % Sold"
                  />

                  {/* 2. Revenue */}
                  <SectionHeading n="2" title="Revenue (Sales Value)" />
                  <PeriodTable
                    title="2a. Pre-Sales Revenue (per sub-unit)"
                    formula={`Pre-Sales Revenue[su, y] = Pre-Sales ${inventoryLabel}[su, y] x base rate (M1 Tab 2) x indexation factor at year y (indexation: ${indexLabel}).`}
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
                    formula={`Post-Sales Revenue[su, y] = Post-Sales ${inventoryLabel}[su, y] x base rate x indexation factor at y (indexation: ${indexLabel}).`}
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
                  <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, fontStyle: 'italic', lineHeight: 1.4 }}>
                    Formula: rows = cohort sale year, columns = year recognised. {recLabel}.
                    {recProfile?.method === 'point_in_time' && (recProfile.pointInTimeYear ?? 'handover') === 'handover' && (
                      <> <strong>Handover</strong> resolves to <strong>{snap.yearLabels[handoverYearIdx] ?? '?'}</strong> (last construction year, marked <strong>*</strong> in the matrix below). Every pre-sales cohort lumps 100% there.</>
                    )}
                    {' '}Sum across each row = cohort total sales value; sum down each column = P&amp;L recognition per year (Pre-Sales only).
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
          </div>
        );
      })}
      </PhaseSection>

      {/* Pass 9e-8 (2026-05-18): Hospitality / Operations strategy
          section with phases nested inside. Includes pure Operate +
          every companion (Operate-side of Sell+Manage parents). */}
      <PhaseSection
        phaseId="strategy-hospitality"
        title="Hospitality / Operations"
        meta="Operate assets + Sell + Manage operate companions across all phases"
        countLabel={(() => {
          const n = assets.filter((a) => a.visible !== false && (a.strategy === 'Operate' || a.isCompanion === true)).length;
          return `${n} asset${n === 1 ? '' : 's'}`;
        })()}
        storageKey="fmp:m2:revenue:strategy:hospitality:collapsed"
      >
      {(() => {
        const anyHosp = assets.some((a) => a.visible !== false && (a.strategy === 'Operate' || a.isCompanion === true));
        if (!anyHosp) {
          return (
            <div style={{ padding: '8px 12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
              No Operate or Sell + Manage assets configured yet.
            </div>
          );
        }
        return null;
      })()}
      {phases.map((p) => {
        const phaseHospitalityAssets = assets.filter((a) => {
          if (a.phaseId !== p.id || a.visible === false) return false;
          return a.strategy === 'Operate' || a.isCompanion === true;
        });
        if (phaseHospitalityAssets.length === 0) return null;
        return (
          <div key={`hosp-${p.id}`} style={{ marginBottom: 'var(--sp-2)' }}>
            <PhaseDivider
              title={p.name}
              meta={`${p.status ?? 'planning'}`}
              count={`${phaseHospitalityAssets.length} hospitality asset${phaseHospitalityAssets.length === 1 ? '' : 's'}`}
            />
            {phaseHospitalityAssets.map((a) => renderHospitalityAssetSection(a, false))}
          </div>
        );
      })}
      </PhaseSection>

      {/* Pass 9e-8: Retail / Lease placeholder. Wires in at Pass 9 / Retail engine. */}
      <PhaseSection
        phaseId="strategy-retail"
        title="Retail / Lease"
        meta="Lease assets across all phases"
        countLabel={(() => {
          const n = assets.filter((a) => a.visible !== false && a.strategy === 'Lease').length;
          return `${n} asset${n === 1 ? '' : 's'}`;
        })()}
        storageKey="fmp:m2:revenue:strategy:retail:collapsed"
      >
        <div style={{ padding: '8px 12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
          Lease revenue engine queued. Tracked Lease assets will surface here once Module 2 Lease (Pass 9) ships.
        </div>
      </PhaseSection>

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

/**
 * Pass 9e-8 (2026-05-18): phase divider rendered inside a strategy
 * section. Lighter than a full PhaseSection chrome (no collapse, no
 * navy bar) so the strategy header stays the dominant visual anchor.
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

export type { SellAssetResult };
