'use client';

/**
 * Module2RevenueOutput.tsx (M2 Pass 7h, per-asset narrative)
 *
 * One residential-first narrative per asset, in this order:
 *
 *   1. SQM Sold
 *      1a. Pre-Sales SQM, per sub-unit
 *      1b. Sales During Operation SQM, per sub-unit
 *      1c. Total SQM + reconciliation (cum % of BUA per sub-unit)
 *   2. Revenue
 *      2a. Pre-Sales Revenue, per sub-unit
 *      2b. Sales During Operation Revenue, per sub-unit
 *      2c. Total Revenue, per sub-unit
 *   3. Revenue Recognised vintage matrix
 *   4. Cash Collected vintage matrix (per cash profile)
 *   5. Accounts Receivable
 *   6. Unearned Revenue
 *
 * Every table carries a one-line formula caption so the math is
 * documented inline. Token discipline: all styling pulls from
 * _shared/tableStyles + PhaseSection + VintageMatrix.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeAllSellResults, resolveSellConfig } from '../../lib/revenue-resolvers';
import {
  buildAccountsReceivable,
  buildUnearnedRevenue,
  type SellAssetResult,
} from '@/src/core/calculations/revenue';
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

type RowKind = 'data' | 'subtotal' | 'grand';

interface PeriodRow {
  label: string;
  values: number[];
  kind?: RowKind;
  /** Optional trailing column rendered after Total (e.g. cum % of BUA). */
  trailing?: string;
}

function PeriodTable({
  title,
  formula,
  yearLabels,
  rows,
  unit,
  fmt,
  trailingHeader,
}: {
  title: string;
  formula: string;
  yearLabels: number[];
  rows: PeriodRow[];
  unit: string;
  fmt: (v: number) => string;
  trailingHeader?: string;
}): React.JSX.Element {
  const extraCols = trailingHeader ? 1 : 0;
  const nonLabelPct = nonLabelColumnPct(1 + extraCols + yearLabels.length);
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <span style={TABLE_TITLE}>
        {title}{' '}
        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-meta)' }}>({unit})</span>
      </span>
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

              // 5 + 6: AR + Unearned per asset
              const ar = buildAccountsReceivable(r.recognitionPerPeriod, r.cashCollectedPerPeriod, r.axisLength);
              const ur = buildUnearnedRevenue(r.recognitionPerPeriod, r.cashCollectedPerPeriod, r.axisLength);

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

                  {/* 3. Revenue Recognised vintage matrix */}
                  <SectionHeading n="3" title="Revenue Recognised (vintage matrix)" />
                  <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, fontStyle: 'italic' }}>
                    Formula: rows = cohort sale year, columns = year recognised. {recLabel}. Sum across each row = cohort total sales value; sum down each column = P&amp;L recognition per year.
                  </div>
                  <VintageMatrix
                    title="3. Recognition Vintage Matrix"
                    yearLabels={snap.yearLabels}
                    matrix={r.recognitionVintageMatrix}
                    currency={currency}
                    handoverYearIdx={handoverYearIdx}
                    fmt={fmt}
                  />

                  {/* 4. Cash Collected vintage matrix */}
                  <SectionHeading n="4" title="Cash Collected (vintage matrix)" />
                  <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, fontStyle: 'italic' }}>
                    Formula: rows = cohort sale year, columns = year collected. Each cohort cascades through the cash payment profile ({cashMode}). Sum across each row = cohort total sales value; sum down each column = cash collected per year.
                  </div>
                  <VintageMatrix
                    title="4. Cash Vintage Matrix"
                    yearLabels={snap.yearLabels}
                    matrix={r.cashVintageMatrix}
                    currency={currency}
                    handoverYearIdx={handoverYearIdx}
                    fmt={fmt}
                  />

                  {/* 5. Accounts Receivable, roll-forward floored */}
                  <SectionHeading n="5" title="Accounts Receivable" />
                  <PeriodTable
                    title="5. Accounts Receivable (roll-forward, mirrors MAAD BS Build section 5)"
                    formula="Opening[y] = Closing[y-1] (Opening[0] = 0). Closing[y] = MAX(0, Opening + Revenue Recognised - Cash Collected). Roll-forward floored each period: once AR drops to 0 the overhang doesn't carry forward. MAAD wires Recognised = Revenue!L164+L165+L166 (per-asset accrual), Cash = Revenue!L22 (pre-sales cash); we feed the same accrual stream + cash stream so the math ties out cell-for-cell."
                    yearLabels={snap.yearLabels}
                    rows={[
                      { label: 'Opening AR', values: ar.openingPerPeriod },
                      { label: '(+) Revenue Recognised', values: r.recognitionPerPeriod },
                      { label: '(-) Cash Collected', values: r.cashCollectedPerPeriod.map((v) => -v) },
                      { label: 'Change in AR (CF delta)', values: ar.changePerPeriod, kind: 'subtotal' },
                      { label: 'Closing AR', values: ar.perPeriod, kind: 'grand' },
                    ]}
                    unit={currency}
                    fmt={fmt}
                  />

                  {/* 6. Unearned Revenue, roll-forward floored (IFRS 15) */}
                  <SectionHeading n="6" title="Unearned Revenue" />
                  <PeriodTable
                    title="6. Unearned Revenue (roll-forward, MAAD BS Build section 4 wiring corrected)"
                    formula="Opening[y] = Closing[y-1] (Opening[0] = 0). Closing[y] = MAX(0, Opening + Cash Collected - Revenue Recognised). Roll-forward floored each period: once Unearned unwinds to 0, new cash overruns build it back up. Note: MAAD v1.16 section 4 wires both inputs at L22 (cash), so its Unearned column always reports 0. We use accrual recognition (Revenue!L170) instead, which is the IFRS 15 deferred-revenue stock and matches what audit expects."
                    yearLabels={snap.yearLabels}
                    rows={[
                      { label: 'Opening Unearned', values: ur.openingPerPeriod },
                      { label: '(+) Cash Collected', values: r.cashCollectedPerPeriod },
                      { label: '(-) Revenue Recognised', values: r.recognitionPerPeriod.map((v) => -v) },
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
        meta="all phases combined"
        storageKey="fmp:m2:revenue:phase:__project__:collapsed"
      >
        <PeriodTable
          title="Project Revenue (sales value year-on-year)"
          formula="Sum of per-asset Pre + Post Revenue across every Sell asset."
          yearLabels={snap.yearLabels}
          rows={[
            { label: 'Project Pre-Sales Revenue', values: snap.projectTotals.presalesRevenuePerPeriod },
            { label: 'Project Sales During Operation Revenue', values: snap.projectTotals.postSalesRevenuePerPeriod },
            {
              label: 'Project Total Revenue',
              values: snap.projectTotals.presalesRevenuePerPeriod.map(
                (v, i) => v + (snap.projectTotals.postSalesRevenuePerPeriod[i] ?? 0),
              ),
              kind: 'grand',
            },
          ]}
          unit={currency}
          fmt={fmt}
        />
        <PeriodTable
          title="Project Recognition + Cash"
          formula="Sum of per-asset Recognition + Cash across every Sell asset."
          yearLabels={snap.yearLabels}
          rows={[
            { label: 'Project Revenue Recognised', values: snap.projectTotals.recognitionPerPeriod },
            { label: 'Project Cash Collected', values: snap.projectTotals.cashCollectedPerPeriod, kind: 'grand' },
          ]}
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
