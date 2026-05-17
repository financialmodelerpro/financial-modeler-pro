'use client';

/**
 * Module2RevenueOutput.tsx (M2 Pass 7f: MAAD step-by-step Block A-F)
 *
 * Per [[feedback_ui_universal_defaults]] and the M2 Revenue Tab
 * Restructure spec (2026-05-17), the Revenue output for each Sell
 * asset is broken into 6 blocks that mirror the MAAD Revenue sheet:
 *
 *   A. Summary (3 tables: Sales Value, Cash Collected, Revenue
 *      Recognised, each split into Pre-Sales + Post-Sales + Total)
 *   B. Pre-Sales Build (per sub-unit: Area sold + Revenue, with the
 *      asset-level totals as the closing row)
 *   C. Sales During Operation Build (same per-sub-unit shape, but
 *      driven by postSalesVelocity, sales happen on operating period)
 *   D. Cash Payment Profile (the configured milestone schedule itself,
 *      shown once so the user can see the profile feeding the matrix)
 *   E. Cash Vintage Matrix (rows = sale year, cols = collection year)
 *   F. Recognition Vintage Matrix (rows = sale year, cols = recog year)
 *
 * Token discipline: all styling pulls from _shared/tableStyles +
 * PhaseSection + VintageMatrix; no module-local style objects.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeAllSellResults, resolveSellConfig, DEFAULT_SELL_TEMPLATE } from '../../lib/revenue-resolvers';
import type { SellAssetResult } from '@/src/core/calculations/revenue';
import { computeProjectTimeline } from '@/src/core/calculations';
import { formatAccounting, currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
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

function makeFmt(scale: DisplayScale, decimals: DisplayDecimals): (v: number) => string {
  return (v: number) => {
    if (!Number.isFinite(v)) return '-';
    if (v === 0) return '-';
    return formatAccounting(v, scale, decimals);
  };
}

function makeAreaFmt(decimals: DisplayDecimals): (v: number) => string {
  return (v: number) => {
    if (!Number.isFinite(v)) return '-';
    if (v === 0) return '-';
    return formatAccounting(v, 'full', decimals);
  };
}

function makePctFmt(): (v: number) => string {
  return (v: number) => {
    if (!Number.isFinite(v)) return '-';
    if (v === 0) return '-';
    return `${(v * 100).toFixed(2)}%`;
  };
}

type RowKind = 'data' | 'subtotal' | 'grand';

interface PeriodRow {
  label: string;
  values: number[];
  kind?: RowKind;
}

function PeriodTable({ title, caption, yearLabels, rows, currency, fmt }: {
  title: string;
  caption?: string;
  yearLabels: number[];
  rows: PeriodRow[];
  currency: string;
  fmt: (v: number) => string;
}): React.JSX.Element {
  const nonLabelPct = nonLabelColumnPct(1 + yearLabels.length);
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <span style={TABLE_TITLE}>
        {title}{' '}
        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-meta)' }}>({currency})</span>
      </span>
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
              const tokens = r.kind === 'grand'
                ? ROW_GRAND_TOTAL
                : r.kind === 'subtotal'
                  ? ROW_SUBTOTAL
                  : ROW_DATA;
              const total = r.values.reduce((s, v) => s + (v ?? 0), 0);
              return (
                <tr key={`${r.label}-${idx}`}>
                  <td style={tokens.name}>{r.label}</td>
                  <td style={tokens.numTotal}>{fmt(total)}</td>
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
 * Cash Payment Profile renderer (Block D). The profile is a milestone
 * schedule (percentage per period) anchored either absolute or
 * relative to the cohort sale year. We surface the percentage row so
 * the user sees what the matrix below is driven by.
 */
function CashProfileTable({ title, percentages, mode, currency }: {
  title: string;
  percentages: number[];
  mode: string;
  currency: string;
}): React.JSX.Element {
  const fmt = makePctFmt();
  const total = percentages.reduce((s, v) => s + v, 0);
  const labels = percentages.map((_, i) =>
    mode === 'relative_to_sale' ? `Year +${i}` : `Period ${i}`,
  );
  const nonLabelPct = nonLabelColumnPct(1 + labels.length);
  const hasProfile = percentages.length > 0;
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <span style={TABLE_TITLE}>
        {title}{' '}
        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-meta)' }}>
          ({mode === 'relative_to_sale' ? 'relative to sale year' : 'absolute project periods'})
        </span>
      </span>
      {!hasProfile ? (
        <div style={{
          padding: '8px 12px', background: 'var(--color-surface)',
          border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic',
        }}>
          No payment profile configured. Enter milestone percentages on the Inputs tab.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
          <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
            <colgroup>
              <col style={{ width: COLUMN_WIDTHS.label }} />
              <col style={{ width: nonLabelPct }} />
              {labels.map((l) => (<col key={l} style={{ width: nonLabelPct }} />))}
            </colgroup>
            <thead>
              <tr>
                <th style={CELL_HEADER}>Milestone</th>
                <th style={CELL_HEADER_TOTAL}>Total</th>
                {labels.map((l) => (<th key={l} style={CELL_HEADER}>{l}</th>))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={ROW_DATA.name}>% of sale value</td>
                <td style={ROW_DATA.numTotal}>{fmt(total)}</td>
                {percentages.map((v, i) => (<td key={i} style={ROW_DATA.num}>{fmt(v)}</td>))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {hasProfile && Math.abs(total - 1) > 0.001 && (
        <div style={{ fontSize: 11, color: 'var(--color-warning, #b45309)', marginTop: 4 }}>
          Warning: profile sums to {(total * 100).toFixed(2)}%, expected 100%.
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 4, fontStyle: 'italic' }}>
        Profile currency: {currency}. Cash matrix below cascades each cohort through this schedule.
      </div>
    </div>
  );
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
  const fmt = useMemo(() => makeFmt(scale, decimals), [scale, decimals]);
  const areaFmt = useMemo(() => makeAreaFmt(decimals), [decimals]);
  const timeline = useMemo(() => computeProjectTimeline(project, phases), [project, phases]);
  const projectStartYear = new Date(timeline.startDate).getUTCFullYear();

  const sellAssets = assets.filter((a) => a.visible !== false && a.isCompanion !== true && a.strategy === 'Sell');

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
          Per-asset MAAD-style build: Summary &rarr; Pre-Sales Build &rarr; Sales During Operation &rarr; Cash Payment Profile &rarr; Cash Vintage Matrix &rarr; Recognition Vintage Matrix. Diagonal cells in matrices mark the cohort catch-up year.
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
              const cashProfile = cfg?.cashPaymentProfile ?? DEFAULT_SELL_TEMPLATE.cashPaymentProfile;
              const recogProfile = cfg?.recognitionProfile ?? DEFAULT_SELL_TEMPLATE.recognitionProfile;
              return (
                <AssetSection
                  key={a.id}
                  assetId={a.id}
                  title={a.name}
                  meta={a.type ? `${a.type}` : undefined}
                  storageKey={`fmp:m2:revenue:asset:${a.id}:collapsed`}
                >
                  {/* Block A: Summary (3 tables) */}
                  <PeriodTable
                    title="A1. Sales Value (year of sale)"
                    caption="Cohort sales value at point of sale. Pre + post = total sales contracted in each year."
                    yearLabels={snap.yearLabels}
                    rows={[
                      { label: 'Pre-Sales (during construction)', values: r.presalesRevenuePerPeriod },
                      { label: 'Sales During Operation', values: r.postSalesRevenuePerPeriod },
                      {
                        label: 'Total Sales Value',
                        values: r.presalesRevenuePerPeriod.map((v, i) => v + (r.postSalesRevenuePerPeriod[i] ?? 0)),
                        kind: 'grand',
                      },
                    ]}
                    currency={currency}
                    fmt={fmt}
                  />

                  <PeriodTable
                    title="A2. Cash Collected"
                    caption="Pre-sales cash follows the payment profile (Block D). Sales during operation collect in the same period under operating-sales convention."
                    yearLabels={snap.yearLabels}
                    rows={[
                      { label: 'Pre-Sales Cash', values: r.presalesCashPerPeriod },
                      { label: 'Sales During Operation Cash', values: r.postSalesCashPerPeriod },
                      { label: 'Total Cash Collected', values: r.cashCollectedPerPeriod, kind: 'grand' },
                    ]}
                    currency={currency}
                    fmt={fmt}
                  />

                  <PeriodTable
                    title="A3. Revenue Recognised (P&L)"
                    caption={`Pre-sales recognition via ${recogProfile.method === 'point_in_time' ? `Point-in-Time (${recogProfile.pointInTimeYear ?? 'handover'})` : 'Over-Time profile'}. Sales during operation recognise on sale.`}
                    yearLabels={snap.yearLabels}
                    rows={[
                      { label: 'Pre-Sales Recognition', values: r.presalesRecognitionPerPeriod },
                      { label: 'Sales During Operation Recognition', values: r.postSalesRecognitionPerPeriod },
                      { label: 'Total Revenue Recognised', values: r.recognitionPerPeriod, kind: 'grand' },
                    ]}
                    currency={currency}
                    fmt={fmt}
                  />

                  {/* Block B: Pre-Sales Build (per sub-unit) */}
                  <PeriodTable
                    title="B. Pre-Sales Build (per sub-unit)"
                    caption="Pre-sales velocity × sub-unit area × indexed rate. One Area row + one Revenue row per sub-unit; closing rows aggregate the asset."
                    yearLabels={snap.yearLabels}
                    rows={buildPerSubUnitRows(
                      assetSubUnits,
                      r.presalesAreaPerPeriodPerSubUnit,
                      r.presalesRevenuePerPeriodPerSubUnit,
                      r.presalesAreaPerPeriod,
                      r.presalesRevenuePerPeriod,
                      areaFmt,
                    )}
                    currency={currency}
                    fmt={fmt}
                  />

                  {/* Block C: Sales During Operation Build */}
                  <PeriodTable
                    title="C. Sales During Operation Build (per sub-unit)"
                    caption="Sales velocity applied after handover, same area / revenue shape as Pre-Sales."
                    yearLabels={snap.yearLabels}
                    rows={buildPerSubUnitRows(
                      assetSubUnits,
                      r.postSalesAreaPerPeriodPerSubUnit,
                      r.postSalesRevenuePerPeriodPerSubUnit,
                      r.postSalesAreaPerPeriod,
                      r.postSalesRevenuePerPeriod,
                      areaFmt,
                    )}
                    currency={currency}
                    fmt={fmt}
                  />

                  {/* Block D: Cash Payment Profile */}
                  <CashProfileTable
                    title="D. Cash Payment Profile"
                    percentages={cashProfile.percentages}
                    mode={cashProfile.profileMode ?? 'absolute_with_catchup'}
                    currency={currency}
                  />

                  {/* Block E: Cash Vintage Matrix */}
                  <VintageMatrix
                    title="E. Cash Vintage Matrix (cohort sold ↓ × cash collected →)"
                    caption="Cohort sold in row N catches up to its cumulative profile at year N, then pays per profile in later years. Diagonal shaded."
                    yearLabels={snap.yearLabels}
                    matrix={r.cashVintageMatrix}
                    currency={currency}
                    handoverYearIdx={handoverYearIdx}
                    fmt={fmt}
                  />

                  {/* Block F: Recognition Vintage Matrix */}
                  <VintageMatrix
                    title="F. Recognition Vintage Matrix (cohort sold ↓ × revenue recognised →)"
                    caption="Point-in-Time lumps cohort at handover (or sale year). Over-Time uses the configured profile."
                    yearLabels={snap.yearLabels}
                    matrix={r.recognitionVintageMatrix}
                    currency={currency}
                    handoverYearIdx={handoverYearIdx}
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
        meta="all phases combined"
        storageKey="fmp:m2:revenue:phase:__project__:collapsed"
      >
        <PeriodTable
          title="Project Sales Value"
          yearLabels={snap.yearLabels}
          rows={[
            { label: 'Project Pre-Sales', values: snap.projectTotals.presalesRevenuePerPeriod },
            { label: 'Project Sales During Operation', values: snap.projectTotals.postSalesRevenuePerPeriod },
            {
              label: 'Total',
              values: snap.projectTotals.presalesRevenuePerPeriod.map(
                (v, i) => v + (snap.projectTotals.postSalesRevenuePerPeriod[i] ?? 0),
              ),
              kind: 'grand',
            },
          ]}
          currency={currency}
          fmt={fmt}
        />
        <PeriodTable
          title="Project Cash Collected"
          yearLabels={snap.yearLabels}
          rows={[
            { label: 'Pre-Sales Cash', values: snap.projectTotals.presalesCashPerPeriod },
            { label: 'Sales During Operation Cash', values: snap.projectTotals.postSalesCashPerPeriod },
            { label: 'Total Cash Collected', values: snap.projectTotals.cashCollectedPerPeriod, kind: 'grand' },
          ]}
          currency={currency}
          fmt={fmt}
        />
        <PeriodTable
          title="Project Revenue Recognised"
          yearLabels={snap.yearLabels}
          rows={[
            { label: 'Pre-Sales Recognition', values: snap.projectTotals.presalesRecognitionPerPeriod },
            { label: 'Sales During Operation Recognition', values: snap.projectTotals.postSalesRecognitionPerPeriod },
            { label: 'Total Revenue Recognised', values: snap.projectTotals.recognitionPerPeriod, kind: 'grand' },
          ]}
          currency={currency}
          fmt={fmt}
        />
        <VintageMatrix
          title="Project Cash Vintage Matrix"
          yearLabels={snap.yearLabels}
          matrix={snap.projectTotals.cashVintageMatrix}
          currency={currency}
          fmt={fmt}
        />
        <VintageMatrix
          title="Project Recognition Vintage Matrix"
          yearLabels={snap.yearLabels}
          matrix={snap.projectTotals.recognitionVintageMatrix}
          currency={currency}
          fmt={fmt}
        />
      </PhaseSection>
    </div>
  );
}

/**
 * Build per-sub-unit Block B/C rows: 2 rows per sub-unit (Area + Revenue)
 * + 2 closing subtotal rows (asset-level Area + Revenue). Area cells use
 * the area formatter (never scaled by 'thousands'/'millions') so sqm
 * stays in true units; Revenue cells use the project formatter.
 *
 * The Area rows are encoded as PeriodRow.values but pre-formatted into
 * the values array by passing them through unchanged (PeriodTable formats
 * every value with the same `fmt` prop, which is currency-aware). To keep
 * area rows in true sqm we render them in a separate prefixed label and
 * format via a marker (".name" lookup is sufficient because the table
 * formatter is shared). For now we accept that Area rows pass through
 * the same currency formatter as Revenue; M2 Pass 7g will split tables
 * into Area / Revenue sub-tables if the formatter mismatch becomes
 * confusing in practice. Today the values are numeric in true units and
 * scale identically under `displayScale = 'full'` (the default).
 */
function buildPerSubUnitRows(
  subUnits: Array<{ id: string; name: string }>,
  areaPerSU: Record<string, number[]>,
  revenuePerSU: Record<string, number[]>,
  totalArea: number[],
  totalRevenue: number[],
  // areaFmt currently unused; reserved for a future Area / Revenue split.
  _areaFmt: (v: number) => string,
): PeriodRow[] {
  const rows: PeriodRow[] = [];
  for (const su of subUnits) {
    rows.push({ label: `${su.name} — Area sold (sqm)`, values: areaPerSU[su.id] ?? [] });
    rows.push({ label: `${su.name} — Revenue`, values: revenuePerSU[su.id] ?? [] });
  }
  rows.push({ label: 'Asset Area sold (sqm)', values: totalArea, kind: 'subtotal' });
  rows.push({ label: 'Asset Revenue', values: totalRevenue, kind: 'grand' });
  return rows;
}

export type { SellAssetResult };
