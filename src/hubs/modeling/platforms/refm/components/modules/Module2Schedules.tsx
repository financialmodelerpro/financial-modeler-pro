'use client';

/**
 * Module2Schedules.tsx (M2 Pass 9g-L, raw line-item feed)
 *
 * Project-level per-asset feed grouped by strategy. Surfaces only the
 * RAW line items that flow into the financial statements in Module 3.
 * The full P&L / BS / CF compose in M3 from these inputs (NI = Revenue
 * - CoS - opex - D&A; Direct CF; Indirect CF reconciliation; Net
 * Working Capital roll-forward; etc.).
 *
 * Three sub-tables:
 *   1. Income Statement Feed
 *        Revenue per asset → Total Revenue
 *        Cost of Sales per Sell asset → Total CoS
 *        Gross Margin (= Revenue - CoS, helper line)
 *   2. Balance Sheet Feed (closing balances)
 *        Inventory per Sell asset
 *        Accounts Receivable per asset (Sell + Hospitality + Lease)
 *        Unearned Revenue per Sell asset
 *   3. Cash Flow Feed
 *        Cash collected per asset (Sell + Hospitality + Lease)
 *        Capex per Sell asset
 *
 * Pass 9g-L (2026-05-18): removed Net Working Capital + Direct / Indirect
 * CF reconciliation tables. Those compose in M3 once Net Income, D&A,
 * and opex are available. Zero-value rows hidden across the board.
 *
 * Row aggregation: FLOW rows (Revenue, CoS, Cash) show SUM in the total
 * column. STOCK rows (Inventory, AR, UR) show CLOSING (last period).
 *
 * Universal UI rules per [[feedback_ui_universal_defaults]].
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeAllSellResults, resolveLiteralRecognitionProfile } from '../../lib/revenue-resolvers';
import {
  buildAccountsReceivable,
  buildUnearnedRevenue,
  buildAccountsReceivableDSO,
  buildCostOfSalesV2,
} from '@/src/core/calculations/revenue';
import { computeAssetCost } from '@/src/core/calculations';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt, ZERO_SNAP_THRESHOLD } from './_shared/numberFmt';
import {
  CELL_HEADER,
  CELL_HEADER_TOTAL,
  COLUMN_WIDTHS,
  ROW_DATA,
  ROW_GRAND_TOTAL,
  ROW_SUBTOTAL,
  TABLE_TITLE,
  nonLabelColumnPct,
} from './_shared/tableStyles';
import { PhaseSection } from './_shared/PhaseSection';

type Aggregation = 'sum' | 'last' | 'none';

interface Row {
  label: string;
  values: number[];
  isTotal?: boolean;
  isSubtotal?: boolean;
  isSection?: boolean;
  indent?: number;
  aggregation?: Aggregation;   // default 'sum' for data rows
  totalOverride?: string;
}

function PeriodTable({ title, caption, yearLabels, rows, currency, totalLabel = 'Total', fmt }: {
  title: string; caption?: string; yearLabels: number[]; rows: Row[]; currency: string;
  totalLabel?: string; fmt: (v: number) => string;
}): React.JSX.Element {
  // Universal prior-year column: leads with the year before project
  // start so the year axis aligns column-for-column across the platform.
  const resolvedPriorYear = yearLabels.length > 0 ? yearLabels[0] - 1 : undefined;
  const hasPrior = resolvedPriorYear !== undefined;
  const nonLabelPct = nonLabelColumnPct(1 + (hasPrior ? 1 : 0) + yearLabels.length);
  const priorCellStyle: React.CSSProperties = { color: 'var(--color-meta)', fontStyle: 'italic' };
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
            {hasPrior && (<col style={{ width: nonLabelPct }} />)}
            {yearLabels.map((y) => (<col key={y} style={{ width: nonLabelPct }} />))}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Line</th>
              <th style={CELL_HEADER_TOTAL}>{totalLabel}</th>
              {hasPrior && (<th style={{ ...CELL_HEADER, fontStyle: 'italic', color: 'var(--color-meta)' }}>{resolvedPriorYear}</th>)}
              {yearLabels.map((y) => (<th key={y} style={CELL_HEADER}>{y}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              if (r.isSection) {
                return (
                  <tr key={`section-${idx}`}>
                    <td
                      colSpan={2 + (hasPrior ? 1 : 0) + yearLabels.length}
                      style={{
                        padding: '8px 10px 4px',
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: 'var(--color-navy)',
                        background: 'color-mix(in srgb, var(--color-navy) 5%, transparent)',
                        borderTop: idx === 0 ? 'none' : '1px solid var(--color-border)',
                      }}
                    >
                      {r.label}
                    </td>
                  </tr>
                );
              }
              const tokens = r.isTotal ? ROW_GRAND_TOTAL : r.isSubtotal ? ROW_SUBTOTAL : ROW_DATA;
              const indent = r.indent ?? 0;
              const agg: Aggregation = r.aggregation ?? 'sum';
              let totalDisplay: string;
              if (r.totalOverride != null) {
                totalDisplay = r.totalOverride;
              } else if (agg === 'sum') {
                const sum = r.values.reduce((s, v) => s + v, 0);
                totalDisplay = fmt(sum);
              } else if (agg === 'last') {
                const last = r.values[r.values.length - 1] ?? 0;
                totalDisplay = fmt(last);
              } else {
                totalDisplay = '';
              }
              return (
                <tr key={r.label + idx}>
                  <td style={{ ...tokens.name, paddingLeft: `${10 + indent * 12}px` }}>{r.label}</td>
                  <td style={tokens.numTotal}>{totalDisplay}</td>
                  {hasPrior && (<td style={{ ...tokens.num, ...priorCellStyle }}>{fmt(0)}</td>)}
                  {r.values.map((v, j) => (<td key={j} style={tokens.num}>{fmt(v)}</td>))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface PerAssetFeed {
  assetId: string;
  name: string;
  strategy: 'Sell' | 'Sell + Manage' | 'Operate' | 'Lease' | string;
  isCompanion: boolean;
  revenue: number[];
  cashCollected: number[];
  cosConstr: number[];
  cosOps: number[];
  totalCos: number[];
  inventory: number[];
  ar: number[];
  ur: number[];
  capex: number[];
}

export default function Module2Schedules(): React.JSX.Element {
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
  const { project, phases, assets } = state;
  const snap = useMemo(
    () => computeAllSellResults({ project, phases, assets, subUnits: state.subUnits }),
    [project, phases, assets, state.subUnits],
  );
  const currency = project.currency || '';
  const scale: DisplayScale = project.displayScale ?? 'full';
  const decimals: DisplayDecimals = project.displayDecimals ?? 2;
  const fmt = useMemo(() => makeFmt(scale, decimals), [scale, decimals]);

  const perAssetFeed = useMemo<PerAssetFeed[]>(() => {
    const N = snap.axisLength;
    const zeros = (): number[] => new Array<number>(N).fill(0);
    const projectStartYearLocal = snap.yearLabels[0] ?? 0;
    const out: PerAssetFeed[] = [];

    for (const a of assets) {
      if (a.visible === false) continue;

      // Sell + Sell+Manage parents (revenue + CoS + inventory + AR + UR)
      if ((a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && a.isCompanion !== true) {
        const r = snap.bySellAsset.get(a.id);
        if (!r) continue;
        const phase = phases.find((p) => p.id === a.phaseId);
        if (!phase) continue;

        const breakdown = computeAssetCost(
          a, project, phase, state.parcels, assets, state.subUnits,
          state.costLines, state.costOverrides, state.landAllocationMode,
          project.financing?.parcelFunding,
        );
        const phaseStartYear = phase.startDate
          ? new Date(phase.startDate).getUTCFullYear()
          : projectStartYearLocal;
        const offset = Math.max(0, phaseStartYear - projectStartYearLocal);
        const capexPerPeriod = zeros();
        const perAll = breakdown.perPeriod ?? [];
        for (let i = 0; i < perAll.length; i++) {
          const projIdx = i === 0 ? offset - 1 : offset + i - 1;
          if (projIdx >= 0 && projIdx < N) capexPerPeriod[projIdx] += perAll[i] ?? 0;
        }
        const assetSubs = state.subUnits.filter((u) => u.assetId === a.id);
        const allUnits = assetSubs.length > 0 && assetSubs.every((u) => u.metric === 'units');
        const presales = allUnits ? r.presalesUnitsPerPeriod : r.presalesAreaPerPeriod;
        const postSales = allUnits ? r.postSalesUnitsPerPeriod : r.postSalesAreaPerPeriod;
        const totalInventory = presales.reduce((s, v) => s + Math.max(0, v), 0)
          + postSales.reduce((s, v) => s + Math.max(0, v), 0);
        const profileRes = resolveLiteralRecognitionProfile(
          a, phase, projectStartYearLocal, N, r.presalesRecognitionPerPeriod,
        );
        const cos = buildCostOfSalesV2({
          capexPerPeriod,
          presalesPerPeriod: presales,
          postSalesPerPeriod: postSales,
          recognitionPerPeriod: profileRes.profile,
          totalInventory,
          axisLength: N,
        });

        // Inventory roll-forward with snap-to-zero residual.
        const inventory = zeros();
        let prev = 0;
        for (let t = 0; t < N; t++) {
          const cap = Math.max(0, capexPerPeriod[t] ?? 0);
          const coSC = Math.max(0, cos.cosConstructionPerPeriod[t] ?? 0);
          const coSO = Math.max(0, cos.cosOperationsPerPeriod[t] ?? 0);
          let close = Math.max(0, prev + cap - coSC - coSO);
          if (Math.abs(close) < 1000) close = 0;
          inventory[t] = close;
          prev = close;
        }

        // Pass 9g-I (2026-05-18): correct engine args.
        //   AR = Pre-Sales Sale Value (signing) - Pre-Sales Cash Received
        //   UR = Pre-Sales Sale Value (signing) - Pre-Sales Recognised
        // Was passing recognition+cash to AR (negative when cash > rec)
        // and recognition+cash to UR (negative when cash > rec).
        const ar = buildAccountsReceivable(
          r.presalesRevenuePerPeriod,
          r.presalesCashPerPeriod,
          N,
        );
        const ur = buildUnearnedRevenue(
          r.presalesRecognitionPerPeriod,
          r.presalesRevenuePerPeriod,
          N,
        );

        // Revenue = total recognition; Cash = total cash collected.
        // Operating-sales convention: SDO recognition = SDO cash same
        // period, so totalRecognition + totalCash both feed cleanly.
        const revenue = r.recognitionPerPeriod.slice();
        const cashCollected = r.cashCollectedPerPeriod.slice();

        // Snap AR/UR per period to suppress sub-currency-unit residuals.
        const arSnapped = ar.perPeriod.map((v) => Math.abs(v) < 1 ? 0 : Math.max(0, v));
        const urSnapped = ur.perPeriod.map((v) => Math.abs(v) < 1 ? 0 : Math.max(0, v));

        out.push({
          assetId: a.id,
          name: a.name || 'Sell asset',
          strategy: a.strategy,
          isCompanion: false,
          revenue,
          cashCollected,
          cosConstr: cos.cosConstructionPerPeriod.slice(),
          cosOps: cos.cosOperationsPerPeriod.slice(),
          totalCos: cos.totalCosPerPeriod.slice(),
          inventory,
          ar: arSnapped,
          ur: urSnapped,
          capex: capexPerPeriod,
        });
      }

      // Hospitality (Operate parents + every companion)
      if (a.strategy === 'Operate' || a.isCompanion === true) {
        const r = snap.byHospitalityAsset.get(a.id);
        if (!r) continue;
        const dso = a.revenue?.operate?.dso ?? 30;
        const arH = buildAccountsReceivableDSO({
          revenuePerPeriod: r.totalRevenuePerPeriod,
          dsoDays: dso,
          daysPerYear: a.revenue?.operate?.daysPerYear ?? 365,
          axisLength: N,
        });
        out.push({
          assetId: a.id,
          name: a.name || 'Hospitality asset',
          strategy: a.strategy,
          isCompanion: a.isCompanion === true,
          revenue: r.totalRevenuePerPeriod.slice(),
          cashCollected: arH.cashReceivedPerPeriod.slice(),
          cosConstr: zeros(),
          cosOps: zeros(),
          totalCos: zeros(),
          inventory: zeros(),
          ar: arH.perPeriod.map((v) => Math.abs(v) < 1 ? 0 : Math.max(0, v)),
          ur: zeros(),
          capex: zeros(),
        });
      }

      // Lease parents
      if (a.strategy === 'Lease' && a.isCompanion !== true) {
        const r = snap.byLeaseAsset.get(a.id);
        if (!r) continue;
        const arDays = a.revenue?.lease?.arDays ?? 30;
        const arL = buildAccountsReceivableDSO({
          revenuePerPeriod: r.totalRevenuePerPeriod,
          dsoDays: arDays,
          daysPerYear: 365,
          axisLength: N,
        });
        out.push({
          assetId: a.id,
          name: a.name || 'Lease asset',
          strategy: a.strategy,
          isCompanion: false,
          revenue: r.totalRevenuePerPeriod.slice(),
          cashCollected: arL.cashReceivedPerPeriod.slice(),
          cosConstr: zeros(),
          cosOps: zeros(),
          totalCos: zeros(),
          inventory: zeros(),
          ar: arL.perPeriod.map((v) => Math.abs(v) < 1 ? 0 : Math.max(0, v)),
          ur: zeros(),
          capex: zeros(),
        });
      }
    }
    return out;
  }, [snap, assets, phases, project, state.subUnits, state.parcels, state.costLines, state.costOverrides, state.landAllocationMode]);

  // ─ Bucket assets by strategy group for the rendered tables ─
  const sellAssets = perAssetFeed.filter((a) => (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && !a.isCompanion);
  const hospAssets = perAssetFeed.filter((a) => a.strategy === 'Operate' || a.isCompanion);
  const leaseAssets = perAssetFeed.filter((a) => a.strategy === 'Lease' && !a.isCompanion);

  const N = snap.axisLength;
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const sumArrays = (arrs: number[][]): number[] => {
    const out = zeros();
    for (const a of arrs) for (let i = 0; i < N; i++) out[i] += a[i] ?? 0;
    return out;
  };

  // ─ Project totals for the deltas + indirect CF ─
  const totalRevenue = sumArrays(perAssetFeed.map((a) => a.revenue));
  const totalCoS = sumArrays(perAssetFeed.map((a) => a.totalCos));
  const grossMargin = totalRevenue.map((v, i) => v - totalCoS[i]);
  const totalCash = sumArrays(perAssetFeed.map((a) => a.cashCollected));
  const totalCapex = sumArrays(perAssetFeed.map((a) => a.capex));
  const totalInventory = sumArrays(perAssetFeed.map((a) => a.inventory));
  const totalAR = sumArrays(perAssetFeed.map((a) => a.ar));
  const totalUR = sumArrays(perAssetFeed.map((a) => a.ur));
  const totalAP = zeros();   // M3 placeholder

  // Pass 9g-L (2026-05-18): Direct + Indirect CF reconciliation and
  // Net Working Capital removed, those derivations belong in Module 3
  // (Financial Statements). Schedules is a raw line-item feed only.
  // totalAP retained as a project-total placeholder so future M3
  // supplier-terms work has a hook.
  void totalAP;

  // ─ Empty state ─
  if (perAssetFeed.length === 0) {
    return (
      <div data-testid="m2-schedules" style={{ padding: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Schedules</h1>
        <div style={{
          marginTop: 'var(--sp-3)', padding: 'var(--sp-3)', background: 'var(--color-surface)',
          border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-muted)', fontSize: 'var(--font-small)',
        }}>
          No revenue-bearing assets configured yet.
        </div>
      </div>
    );
  }

  // Pass 9g-K (2026-05-18): only show assets that actually have
  // non-zero values for the field in question. AR for hospitality / lease
  // is only meaningful when the asset has revenue + DSO/arDays set; zero
  // rows clutter the financial-statement feed.
  const hasAnyValue = (arr: number[]): boolean => arr.some((v) => Math.abs(v) >= ZERO_SNAP_THRESHOLD);

  // ─ Row builders ─
  const groupedRows = (
    field: keyof PerAssetFeed,
    aggForLeaf: Aggregation,
    aggForTotal: Aggregation,
    grandLabel: string,
  ): Row[] => {
    const rows: Row[] = [];
    const pushGroup = (label: string, group: PerAssetFeed[]): void => {
      if (group.length === 0) return;
      // Filter out all-zero assets so a hotel with no revenue doesn't
      // clutter the AR table, etc.
      const activeAssets = group.filter((a) => hasAnyValue(a[field] as number[]));
      if (activeAssets.length === 0) return;
      rows.push({ label, values: [], isSection: true });
      const groupSeries: number[][] = [];
      for (const a of activeAssets) {
        const vals = (a[field] as number[]).slice();
        rows.push({ label: a.name, values: vals, indent: 1, aggregation: aggForLeaf });
        groupSeries.push(vals);
      }
      rows.push({
        label: `Total ${label}`,
        values: sumArrays(groupSeries),
        indent: 0,
        isSubtotal: true,
        aggregation: aggForTotal,
      });
    };
    pushGroup('Residential / Sell', sellAssets);
    pushGroup('Hospitality / Operations', hospAssets);
    pushGroup('Retail / Lease', leaseAssets);
    // Grand row across all assets (still uses ALL assets so totals reconcile).
    const allSeries = perAssetFeed.map((a) => a[field] as number[]);
    const grandTotal = sumArrays(allSeries);
    if (hasAnyValue(grandTotal)) {
      rows.push({
        label: grandLabel,
        values: grandTotal,
        isTotal: true,
        aggregation: aggForTotal,
      });
    }
    return rows;
  };

  // For CoS we only show Sell assets (other strategies have no CoS).
  // Filter out Sell assets that produced zero CoS (degenerate configs).
  const cosRows: Row[] = [];
  const activeCosSellAssets = sellAssets.filter((a) => hasAnyValue(a.totalCos));
  if (activeCosSellAssets.length > 0) {
    cosRows.push({ label: 'Residential / Sell', values: [], isSection: true });
    for (const a of activeCosSellAssets) {
      cosRows.push({ label: `${a.name} · CoS during construction`, values: a.cosConstr, indent: 1, aggregation: 'sum' });
      cosRows.push({ label: `${a.name} · CoS during operations`, values: a.cosOps, indent: 1, aggregation: 'sum' });
      cosRows.push({ label: `${a.name} · Total Cost of Sales`, values: a.totalCos, indent: 1, isSubtotal: true, aggregation: 'sum' });
    }
    cosRows.push({ label: 'Total Cost of Sales', values: totalCoS, isTotal: true, aggregation: 'sum' });
  }

  return (
    <div data-testid="m2-schedules" style={{ padding: 'var(--sp-3)' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Schedules</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>
          {currencyHeaderLine(currency, scale)} ({decimals} dp)
        </div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)' }}>
          Per-asset feed grouped by strategy. Only assets with non-zero values for a given line appear; zero rows are hidden so the
          feed stays compact. Flow lines (Revenue, CoS, Cash) show <strong>sum</strong> in the Total column; stock lines
          (Inventory, AR, UR) show <strong>closing balance</strong>. Schedules surfaces only raw line items here, Direct /
          Indirect cash-flow reconciliation, Net Working Capital, and the full P&amp;L / BS / CF statements compose in Module 3.
        </p>
      </div>

      <PhaseSection
        phaseId="m2-schedules-pl"
        title="Income Statement Feed"
        meta="Revenue + Cost of Sales + Gross Margin (per asset → grouped → total)"
        storageKey="fmp:m2:schedules:pl:collapsed"
      >
        <PeriodTable
          title="Revenue (P&L)"
          caption="Per-asset revenue grouped by strategy. Operating-sales convention: Hospitality + Lease + Sales During Operation recognise revenue = cash same period; Sell pre-sales follow the recognition profile on Inputs."
          yearLabels={snap.yearLabels}
          rows={groupedRows('revenue', 'sum', 'sum', 'Total Revenue')}
          currency={currency}
          totalLabel="Total"
          fmt={fmt}
        />
        {cosRows.length > 0 && (
          <PeriodTable
            title="Cost of Sales (P&L)"
            caption="Per-asset CoS for Sell + Sell+Manage parents. Hospitality / Lease assets carry no CoS by convention (capex stays on balance sheet, M3 depreciation handles cost recovery)."
            yearLabels={snap.yearLabels}
            rows={cosRows}
            currency={currency}
            totalLabel="Total"
            fmt={fmt}
          />
        )}
        <PeriodTable
          title="Gross Margin (P&L)"
          caption="Revenue - Cost of Sales. M3 will subtract operating expenses + D&A to arrive at Net Income."
          yearLabels={snap.yearLabels}
          rows={[
            { label: 'Revenue', values: totalRevenue, aggregation: 'sum' },
            { label: '(-) Cost of Sales', values: totalCoS.map((v) => -v), aggregation: 'sum' },
            { label: 'Gross Margin', values: grossMargin, isTotal: true, aggregation: 'sum' },
          ]}
          currency={currency}
          totalLabel="Total"
          fmt={fmt}
        />
      </PhaseSection>

      <PhaseSection
        phaseId="m2-schedules-bs"
        title="Balance Sheet Feed"
        meta="Per-asset closing balances per period"
        storageKey="fmp:m2:schedules:bs:collapsed"
      >
        {(() => {
          const activeInvAssets = sellAssets.filter((a) => hasAnyValue(a.inventory));
          if (activeInvAssets.length === 0) return null;
          return (
            <PeriodTable
              title="Inventory (closing balances)"
              caption="Sell-strategy work-in-progress + completed-but-unsold inventory. Settles to 0 once cumulative CoS recognises 100% of capex."
              yearLabels={snap.yearLabels}
              rows={[
                { label: 'Residential / Sell', values: [], isSection: true },
                ...activeInvAssets.map((a) => ({ label: a.name, values: a.inventory, indent: 1, aggregation: 'last' as Aggregation })),
                { label: 'Total Inventory', values: totalInventory, isTotal: true, aggregation: 'last' as Aggregation },
              ]}
              currency={currency}
              totalLabel="Closing"
              fmt={fmt}
            />
          );
        })()}
        <PeriodTable
          title="Accounts Receivable (closing balances)"
          caption="Sell AR: pre-sales sale value not yet collected. Hospitality / Lease AR: revenue × receivable-days / 365. AR settles to 0 once cumulative cash equals cumulative sale value (Sell) or revenue tails off (Hospitality / Lease)."
          yearLabels={snap.yearLabels}
          rows={groupedRows('ar', 'last', 'last', 'Total Accounts Receivable')}
          currency={currency}
          totalLabel="Closing"
          fmt={fmt}
        />
        {(() => {
          const activeUrAssets = sellAssets.filter((a) => hasAnyValue(a.ur));
          if (activeUrAssets.length === 0) return null;
          return (
            <PeriodTable
              title="Unearned Revenue (closing balances)"
              caption="Pre-sales sale value not yet recognised. Sell-strategy only, Hospitality + Lease recognise revenue in the same period it's earned, no deferral. Settles to 0 once cumulative recognition equals cumulative sale value."
              yearLabels={snap.yearLabels}
              rows={[
                { label: 'Residential / Sell', values: [], isSection: true },
                ...activeUrAssets.map((a) => ({ label: a.name, values: a.ur, indent: 1, aggregation: 'last' as Aggregation })),
                { label: 'Total Unearned Revenue', values: totalUR, isTotal: true, aggregation: 'last' as Aggregation },
              ]}
              currency={currency}
              totalLabel="Closing"
              fmt={fmt}
            />
          );
        })()}
      </PhaseSection>

      {/* Pass 9g-L (2026-05-18): Cash Flow Feed reduced to the two
          input streams (cash collected per asset + capex per Sell
          asset). The Direct / Indirect reconciliation tables were
          removed, those derivations belong in Module 3 (Financial
          Statements) where Net Income, D&A, opex, and working-
          capital movement compose the full CF statement. Schedules
          stays a raw line-item feed only. */}
      <PhaseSection
        phaseId="m2-schedules-cf"
        title="Cash Flow Feed"
        meta="Cash collected + Capex per asset, composed into the full CF statement in Module 3"
        storageKey="fmp:m2:schedules:cf:collapsed"
      >
        <PeriodTable
          title="Cash Collected from Customers (per asset)"
          caption="Sell: cash payment profile (milestone-driven). Hospitality / Lease: revenue × (1 - receivable-days / 365)."
          yearLabels={snap.yearLabels}
          rows={groupedRows('cashCollected', 'sum', 'sum', 'Total Cash from Customers')}
          currency={currency}
          totalLabel="Total"
          fmt={fmt}
        />
        {(() => {
          const activeCapexAssets = sellAssets.filter((a) => hasAnyValue(a.capex));
          if (activeCapexAssets.length === 0) return null;
          return (
            <PeriodTable
              title="Capex (per Sell asset)"
              caption="Construction capex from Module 1 cost engine, project-axis-aligned. Lease + Hospitality capex shows here too once those asset types wire in M3 (currently zero in this projection)."
              yearLabels={snap.yearLabels}
              rows={[
                { label: 'Residential / Sell', values: [], isSection: true },
                ...activeCapexAssets.map((a) => ({ label: `${a.name} · Capex`, values: a.capex, indent: 1, aggregation: 'sum' as Aggregation })),
                { label: 'Total Capex', values: totalCapex, isTotal: true, aggregation: 'sum' as Aggregation },
              ]}
              currency={currency}
              totalLabel="Total"
              fmt={fmt}
            />
          );
        })()}
      </PhaseSection>
    </div>
  );
}
