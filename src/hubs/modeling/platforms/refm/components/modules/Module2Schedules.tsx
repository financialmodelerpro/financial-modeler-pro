'use client';

/**
 * Module2Schedules.tsx (M2 Pass 9g-I, financial-statement feed v2)
 *
 * Project-level summary structured per-asset (under strategy groups)
 * so each line item feeds directly into the financial statements in
 * M3. Four sub-tables:
 *
 *   1. Income Statement Feed
 *        Revenue                      per asset, grouped by strategy
 *        Cost of Sales                per Sell asset, grouped
 *        Gross Margin                 Revenue - CoS
 *   2. Balance Sheet Feed (closing balances)
 *        Inventory                    per Sell asset
 *        Accounts Receivable          per asset (Sell + Hospitality + Lease)
 *        Unearned Revenue             per Sell asset
 *        Accounts Payable             placeholder (M3 supplier terms)
 *        Net Working Capital
 *   3. Cash Flow Feed (Direct Method)
 *        Cash from Customers          per asset, grouped
 *        Capex                        per Sell asset
 *        Net Operating Cash (Direct)  cash in - cash out
 *   4. Cash Flow Feed (Indirect Method)
 *        Net Income (proxy)           Revenue - CoS  (M3 adds opex + D&A)
 *        Working-capital changes      Δ Inventory / AR / UR / AP
 *        Net Operating Cash (Indirect)
 *        (-) Capex (Investing)
 *        Net Cash Flow
 *
 * Row aggregation: FLOW rows (Revenue, CoS, Cash collected, ∆ deltas)
 * show SUM in the total column. STOCK rows (Inventory, AR, UR, AP)
 * show CLOSING (last period) in the total column.
 *
 * Pass 9g-I (2026-05-18):
 *   - AR / Unearned engine call args fixed (was passing recognition
 *     where sale-value was expected, causing negative balances).
 *   - Total cell honours aggregation: 'sum' (flows) | 'last' (stocks).
 *   - Per-asset detail under strategy sections (no Pre/Post split).
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
import { formatAccounting, currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
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

const ZERO_SNAP_THRESHOLD = 1;
function makeFmt(scale: DisplayScale, decimals: DisplayDecimals): (v: number) => string {
  return (v: number) => {
    if (!Number.isFinite(v)) return '-';
    if (Math.abs(v) < ZERO_SNAP_THRESHOLD) return '-';
    return formatAccounting(v, scale, decimals);
  };
}

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
              <th style={CELL_HEADER_TOTAL}>{totalLabel}</th>
              {yearLabels.map((y) => (<th key={y} style={CELL_HEADER}>{y}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              if (r.isSection) {
                return (
                  <tr key={`section-${idx}`}>
                    <td
                      colSpan={2 + yearLabels.length}
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

  // Working-capital deltas (closing[t] - closing[t-1]).
  const delta = (arr: number[]): number[] => {
    const d = zeros();
    for (let i = 0; i < N; i++) d[i] = arr[i] - (i > 0 ? arr[i - 1] : 0);
    return d;
  };
  const dInventory = delta(totalInventory);
  const dAR = delta(totalAR);
  const dUR = delta(totalUR);
  const dAP = delta(totalAP);

  // Indirect CF reconstruction:
  // Cash from ops (Indirect) = NI + ΔUR + ΔAP - ΔInventory - ΔAR
  // For verification: this should equal totalCash - totalCapex (when
  // engine math holds; small float residuals snap to 0).
  const indirectOpsCash = grossMargin.map((ni, i) =>
    ni + dUR[i] + dAP[i] - dInventory[i] - dAR[i]
  );

  const netOpCashDirect = totalCash.map((v, i) => v - totalCapex[i]);
  const investingCash = totalCapex.map((v) => -v);
  const netCashIndirect = indirectOpsCash.map((v, i) => v + investingCash[i]);
  const nwc = totalAR.map((v, i) => v + totalInventory[i] - totalUR[i] - totalAP[i]);

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
      rows.push({ label, values: [], isSection: true });
      const groupSeries: number[][] = [];
      for (const a of group) {
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
    // Grand row across all assets
    const allSeries = perAssetFeed.map((a) => a[field] as number[]);
    rows.push({
      label: grandLabel,
      values: sumArrays(allSeries),
      isTotal: true,
      aggregation: aggForTotal,
    });
    return rows;
  };

  // For CoS we only show Sell assets (other strategies have no CoS).
  const cosRows: Row[] = [];
  if (sellAssets.length > 0) {
    cosRows.push({ label: 'Residential / Sell', values: [], isSection: true });
    for (const a of sellAssets) {
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
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)', maxWidth: 800 }}>
          Per-asset feed grouped by strategy. Flow lines (Revenue, CoS, Cash, Δ) show <strong>lifetime sum</strong>
          in the Total column. Stock lines (Inventory, AR, UR) show <strong>closing balance</strong>. Both Direct
          and Indirect cash-flow methods are surfaced; Project Finance models typically run with Direct.
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
          totalLabel="Lifetime Total"
          fmt={fmt}
        />
        {cosRows.length > 0 && (
          <PeriodTable
            title="Cost of Sales (P&L)"
            caption="Per-asset CoS for Sell + Sell+Manage parents. Hospitality / Lease assets carry no CoS by convention (capex stays on balance sheet, M3 depreciation handles cost recovery)."
            yearLabels={snap.yearLabels}
            rows={cosRows}
            currency={currency}
            totalLabel="Lifetime Total"
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
          totalLabel="Lifetime Total"
          fmt={fmt}
        />
      </PhaseSection>

      <PhaseSection
        phaseId="m2-schedules-bs"
        title="Balance Sheet Feed"
        meta="Per-asset closing balances per period"
        storageKey="fmp:m2:schedules:bs:collapsed"
      >
        <PeriodTable
          title="Inventory (closing balances)"
          caption="Sell-strategy work-in-progress + completed-but-unsold inventory. Settles to 0 once cumulative CoS recognises 100% of capex."
          yearLabels={snap.yearLabels}
          rows={sellAssets.length > 0 ? [
            { label: 'Residential / Sell', values: [], isSection: true },
            ...sellAssets.map((a) => ({ label: a.name, values: a.inventory, indent: 1, aggregation: 'last' as Aggregation })),
            { label: 'Total Inventory', values: totalInventory, isTotal: true, aggregation: 'last' as Aggregation },
          ] : [{ label: 'No Sell-strategy assets', values: [], aggregation: 'none' as Aggregation }]}
          currency={currency}
          totalLabel="Closing"
          fmt={fmt}
        />
        <PeriodTable
          title="Accounts Receivable (closing balances)"
          caption="Sell AR: pre-sales sale value not yet collected. Hospitality / Lease AR: revenue × receivable-days / 365. AR settles to 0 once cumulative cash equals cumulative sale value (Sell) or revenue tails off (Hospitality / Lease)."
          yearLabels={snap.yearLabels}
          rows={groupedRows('ar', 'last', 'last', 'Total Accounts Receivable')}
          currency={currency}
          totalLabel="Closing"
          fmt={fmt}
        />
        <PeriodTable
          title="Unearned Revenue (closing balances)"
          caption="Pre-sales sale value not yet recognised. Sell-strategy only — Hospitality + Lease recognise revenue in the same period it's earned, no deferral. Settles to 0 once cumulative recognition equals cumulative sale value."
          yearLabels={snap.yearLabels}
          rows={sellAssets.length > 0 ? [
            { label: 'Residential / Sell', values: [], isSection: true },
            ...sellAssets.map((a) => ({ label: a.name, values: a.ur, indent: 1, aggregation: 'last' as Aggregation })),
            { label: 'Total Unearned Revenue', values: totalUR, isTotal: true, aggregation: 'last' as Aggregation },
          ] : [{ label: 'No Sell-strategy assets', values: [], aggregation: 'none' as Aggregation }]}
          currency={currency}
          totalLabel="Closing"
          fmt={fmt}
        />
        <PeriodTable
          title="Accounts Payable + Net Working Capital"
          caption="AP placeholder until M3 wires supplier credit terms. NWC = (AR + Inventory) - (Unearned + AP)."
          yearLabels={snap.yearLabels}
          rows={[
            { label: 'Accounts Payable (M3 placeholder)', values: totalAP, aggregation: 'last' as Aggregation },
            { label: 'Net Working Capital', values: nwc, isTotal: true, aggregation: 'last' as Aggregation },
          ]}
          currency={currency}
          totalLabel="Closing"
          fmt={fmt}
        />
      </PhaseSection>

      <PhaseSection
        phaseId="m2-schedules-cf-direct"
        title="Cash Flow Feed — Direct Method"
        meta="Cash from customers - Capex = Net Operating Cash"
        storageKey="fmp:m2:schedules:cf-direct:collapsed"
      >
        <PeriodTable
          title="Cash Collected from Customers (per asset)"
          caption="Sell: cash payment profile (milestone-driven). Hospitality / Lease: revenue × (1 - receivable-days / 365)."
          yearLabels={snap.yearLabels}
          rows={groupedRows('cashCollected', 'sum', 'sum', 'Total Cash from Customers')}
          currency={currency}
          totalLabel="Lifetime Total"
          fmt={fmt}
        />
        <PeriodTable
          title="Capex (per Sell asset)"
          caption="Construction capex from Module 1 cost engine, project-axis-aligned. Lease + Hospitality capex shows here too once those asset types wire in M3 (currently zero in this projection)."
          yearLabels={snap.yearLabels}
          rows={sellAssets.length > 0 ? [
            { label: 'Residential / Sell', values: [], isSection: true },
            ...sellAssets.map((a) => ({ label: `${a.name} · Capex`, values: a.capex, indent: 1, aggregation: 'sum' as Aggregation })),
            { label: 'Total Capex', values: totalCapex, isTotal: true, aggregation: 'sum' as Aggregation },
          ] : [{ label: 'No Sell-strategy assets', values: [], aggregation: 'none' as Aggregation }]}
          currency={currency}
          totalLabel="Lifetime Total"
          fmt={fmt}
        />
        <PeriodTable
          title="Net Operating Cash (Direct)"
          caption="Cash from customers - Capex. Project Finance models typically read the Direct method here directly."
          yearLabels={snap.yearLabels}
          rows={[
            { label: '(+) Cash Collected from Customers', values: totalCash, aggregation: 'sum' },
            { label: '(-) Capex (cash invested in inventory)', values: totalCapex.map((v) => -v), aggregation: 'sum' },
            { label: 'Net Operating Cash Flow (Direct)', values: netOpCashDirect, isTotal: true, aggregation: 'sum' },
          ]}
          currency={currency}
          totalLabel="Lifetime Total"
          fmt={fmt}
        />
      </PhaseSection>

      <PhaseSection
        phaseId="m2-schedules-cf-indirect"
        title="Cash Flow Feed — Indirect Method"
        meta="Net Income + non-cash + working-capital movement"
        storageKey="fmp:m2:schedules:cf-indirect:collapsed"
      >
        <PeriodTable
          title="Cash Flow Reconciliation (Indirect)"
          caption="NI + ΔUnearned + ΔAP − ΔInventory − ΔAR + non-cash items = Cash from Operations. D&A + opex wire in at M3 (currently zero). Subtract Capex (Investing) for total free cash flow. Should reconcile to Direct method within float residuals."
          yearLabels={snap.yearLabels}
          rows={[
            { label: 'Operating Activities', values: [], isSection: true },
            { label: 'Net Income (proxy: Gross Margin until M3 opex/D&A)', values: grossMargin, indent: 1, aggregation: 'sum' },
            { label: 'Non-cash items (D&A — M3 placeholder)', values: zeros(), indent: 1, aggregation: 'sum' },
            { label: 'Working-Capital Changes', values: [], isSection: true },
            { label: '(+) Δ Unearned Revenue', values: dUR, indent: 1, aggregation: 'sum' },
            { label: '(+) Δ Accounts Payable', values: dAP, indent: 1, aggregation: 'sum' },
            { label: '(-) Δ Inventory', values: dInventory.map((v) => -v), indent: 1, aggregation: 'sum' },
            { label: '(-) Δ Accounts Receivable', values: dAR.map((v) => -v), indent: 1, aggregation: 'sum' },
            { label: 'Cash from Operations (Indirect)', values: indirectOpsCash, isSubtotal: true, aggregation: 'sum' },
            { label: 'Investing Activities', values: [], isSection: true },
            { label: '(-) Capex', values: investingCash, indent: 1, aggregation: 'sum' },
            { label: 'Net Cash Flow', values: netCashIndirect, isTotal: true, aggregation: 'sum' },
          ]}
          currency={currency}
          totalLabel="Lifetime Total"
          fmt={fmt}
        />
      </PhaseSection>
    </div>
  );
}
