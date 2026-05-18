'use client';

/**
 * Module2Schedules.tsx (M2 Pass 9g-G, rewritten as Financial-Statement Feed)
 *
 * Project-level summary that aggregates per-asset revenue + CoS +
 * working-capital streams into the line items that flow directly into
 * the Income Statement, Balance Sheet, and Cash Flow Statement in M3.
 *
 * Three sub-tables, in this order:
 *   1. Income Statement Feed
 *        Revenue (Sell Pre-Sales + Sell SDO + Hospitality + Lease)
 *        Cost of Sales (Construction + Operations)
 *        Gross Margin = Revenue - CoS
 *   2. Balance Sheet Feed (closing balances per period)
 *        Inventory                 (Sell only — opening + capex - CoS)
 *        Accounts Receivable       (Sell + Hospitality + Lease, summed)
 *        Unearned Revenue          (Sell)
 *        Accounts Payable          (placeholder, M3 will wire supplier terms)
 *        Net Working Capital
 *   3. Cash Flow Feed (per-period flows)
 *        Cash collected from customers (Sell + Hospitality + Lease)
 *        Capex (negative — build into inventory)
 *        Net Operating Cash Flow
 *
 * No per-phase / per-asset detail here — that lives in the Revenue +
 * CoS + Inputs tabs. This tab is purely the rolled-up feed for the
 * financial statements.
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

function makeFmt(scale: DisplayScale, decimals: DisplayDecimals): (v: number) => string {
  return (v: number) => {
    if (!Number.isFinite(v)) return '-';
    if (Math.abs(v) < 0.5) return '-';
    return formatAccounting(v, scale, decimals);
  };
}

interface Row {
  label: string;
  values: number[];
  isTotal?: boolean;
  isSubtotal?: boolean;
  isSection?: boolean;
  indent?: number;
}

function PeriodTable({ title, caption, yearLabels, rows, currency, latestLabel = 'Latest', fmt }: {
  title: string; caption?: string; yearLabels: number[]; rows: Row[]; currency: string; latestLabel?: string; fmt: (v: number) => string;
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
              <th style={CELL_HEADER_TOTAL}>{latestLabel}</th>
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
              const latest = r.values[r.values.length - 1] ?? 0;
              return (
                <tr key={r.label + idx}>
                  <td style={{ ...tokens.name, paddingLeft: `${10 + indent * 12}px` }}>{r.label}</td>
                  <td style={tokens.numTotal}>{fmt(latest)}</td>
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

  // ── Build all per-asset CoS + Inventory streams, then aggregate ──
  const feed = useMemo(() => {
    const N = snap.axisLength;
    const zeros = (): number[] => new Array<number>(N).fill(0);
    const projectStartYearLocal = snap.yearLabels[0] ?? 0;

    // Income Statement streams
    const sellPresalesRev = zeros();
    const sellPostSalesRev = zeros();
    const hospRev = zeros();
    const leaseRev = zeros();

    // Cost of Sales streams (Sell + Sell+Manage parents only)
    const cosConstruction = zeros();
    const cosOperations = zeros();
    const projCapex = zeros();

    // Balance Sheet streams (closing)
    const projInventory = zeros();
    const projAR = zeros();
    const projUR = zeros();

    // Cash Flow streams
    const cashSell = zeros();
    const cashHosp = zeros();
    const cashLease = zeros();

    // Sell + Sell+Manage parents
    for (const a of assets) {
      if (a.visible === false || a.isCompanion === true) continue;
      if (a.strategy !== 'Sell' && a.strategy !== 'Sell + Manage') continue;
      const r = snap.bySellAsset.get(a.id);
      if (!r) continue;
      const phase = phases.find((p) => p.id === a.phaseId);
      if (!phase) continue;

      for (let i = 0; i < N; i++) {
        sellPresalesRev[i] += r.presalesRecognitionPerPeriod[i] ?? 0;
        sellPostSalesRev[i] += r.postSalesRecognitionPerPeriod[i] ?? 0;
        cashSell[i] += r.cashCollectedPerPeriod[i] ?? 0;
      }

      // CoS + Inventory: mirror Module2CostOfSales per-asset computation.
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
        a, phase, projectStartYearLocal, N,
        r.presalesRecognitionPerPeriod,
      );
      const cos = buildCostOfSalesV2({
        capexPerPeriod,
        presalesPerPeriod: presales,
        postSalesPerPeriod: postSales,
        recognitionPerPeriod: profileRes.profile,
        totalInventory,
        axisLength: N,
      });

      // Aggregate streams
      for (let i = 0; i < N; i++) {
        projCapex[i] += capexPerPeriod[i] ?? 0;
        cosConstruction[i] += cos.cosConstructionPerPeriod[i] ?? 0;
        cosOperations[i] += cos.cosOperationsPerPeriod[i] ?? 0;
      }

      // Per-asset inventory roll-forward, summed into project inventory.
      let prev = 0;
      for (let t = 0; t < N; t++) {
        const cap = Math.max(0, capexPerPeriod[t] ?? 0);
        const coSC = Math.max(0, cos.cosConstructionPerPeriod[t] ?? 0);
        const coSO = Math.max(0, cos.cosOperationsPerPeriod[t] ?? 0);
        const close = Math.max(0, prev + cap - coSC - coSO);
        projInventory[t] += close;
        prev = close;
      }

      // AR / Unearned per Sell asset (cumulative recognition vs cumulative cash).
      const ar = buildAccountsReceivable(r.recognitionPerPeriod, r.cashCollectedPerPeriod, N);
      const ur = buildUnearnedRevenue(r.recognitionPerPeriod, r.cashCollectedPerPeriod, N);
      for (let i = 0; i < N; i++) {
        projAR[i] += ar.perPeriod[i] ?? 0;
        projUR[i] += ur.perPeriod[i] ?? 0;
      }
    }

    // Hospitality + Sell+Manage companions
    for (const a of assets) {
      if (a.visible === false) continue;
      const isOperate = a.strategy === 'Operate' || a.isCompanion === true;
      if (!isOperate) continue;
      const r = snap.byHospitalityAsset.get(a.id);
      if (!r) continue;
      const dso = a.revenue?.operate?.dso ?? 30;
      const arH = buildAccountsReceivableDSO({
        revenuePerPeriod: r.totalRevenuePerPeriod,
        dsoDays: dso,
        daysPerYear: a.revenue?.operate?.daysPerYear ?? 365,
        axisLength: N,
      });
      for (let i = 0; i < N; i++) {
        hospRev[i] += r.totalRevenuePerPeriod[i] ?? 0;
        projAR[i] += arH.perPeriod[i] ?? 0;
        cashHosp[i] += arH.cashReceivedPerPeriod[i] ?? 0;
      }
    }

    // Lease parents
    for (const a of assets) {
      if (a.visible === false || a.isCompanion === true) continue;
      if (a.strategy !== 'Lease') continue;
      const r = snap.byLeaseAsset.get(a.id);
      if (!r) continue;
      const arDays = a.revenue?.lease?.arDays ?? 30;
      const arL = buildAccountsReceivableDSO({
        revenuePerPeriod: r.totalRevenuePerPeriod,
        dsoDays: arDays,
        daysPerYear: 365,
        axisLength: N,
      });
      for (let i = 0; i < N; i++) {
        leaseRev[i] += r.totalRevenuePerPeriod[i] ?? 0;
        projAR[i] += arL.perPeriod[i] ?? 0;
        cashLease[i] += arL.cashReceivedPerPeriod[i] ?? 0;
      }
    }

    const totalRevenue = zeros();
    const totalCoS = zeros();
    const grossMargin = zeros();
    const totalCash = zeros();
    const ap = zeros();   // Pass 9g-G placeholder — M3 will wire supplier terms
    const nwc = zeros();
    const netOpCf = zeros();
    for (let i = 0; i < N; i++) {
      totalRevenue[i] = sellPresalesRev[i] + sellPostSalesRev[i] + hospRev[i] + leaseRev[i];
      totalCoS[i] = cosConstruction[i] + cosOperations[i];
      grossMargin[i] = totalRevenue[i] - totalCoS[i];
      totalCash[i] = cashSell[i] + cashHosp[i] + cashLease[i];
      // Net Working Capital = (AR + Inventory) - (Unearned + AP)
      nwc[i] = (projAR[i] + projInventory[i]) - (projUR[i] + ap[i]);
      netOpCf[i] = totalCash[i] - projCapex[i];
    }

    return {
      sellPresalesRev, sellPostSalesRev, hospRev, leaseRev, totalRevenue,
      cosConstruction, cosOperations, totalCoS, grossMargin,
      projInventory, projAR, projUR, ap, nwc,
      cashSell, cashHosp, cashLease, totalCash, projCapex, netOpCf,
    };
  }, [snap, assets, phases, project, state.subUnits, state.parcels, state.costLines, state.costOverrides, state.landAllocationMode]);

  if (snap.axisLength === 0) {
    return (
      <div data-testid="m2-schedules" style={{ padding: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Schedules</h1>
        <div style={{
          marginTop: 'var(--sp-3)', padding: 'var(--sp-3)', background: 'var(--color-surface)',
          border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-muted)', fontSize: 'var(--font-small)',
        }}>
          No project timeline yet.
        </div>
      </div>
    );
  }

  return (
    <div data-testid="m2-schedules" style={{ padding: 'var(--sp-3)' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Schedules</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>
          {currencyHeaderLine(currency, scale)} ({decimals} dp)
        </div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)', maxWidth: 800 }}>
          Project-level financial-statement feed. Three sub-tables aggregate every asset / strategy into the line items
          that flow into the Income Statement (P&L), Balance Sheet, and Cash Flow Statement in Module 3.
        </p>
      </div>

      <PhaseSection
        phaseId="m2-schedules-pl"
        title="Income Statement Feed"
        meta="Revenue + Cost of Sales + Gross Margin"
        storageKey="fmp:m2:schedules:pl:collapsed"
      >
        <PeriodTable
          title="Income Statement · Project Totals"
          caption="Revenue and Cost of Sales summed across all assets and strategies. Operating-sales convention: Hospitality + Lease + post-handover Sell recognise revenue = cash in the same period; Sell pre-sales follow the recognition profile entered on Inputs."
          yearLabels={snap.yearLabels}
          rows={[
            { label: 'Revenue', values: [], isSection: true },
            { label: 'Sell · Pre-Sales', values: feed.sellPresalesRev, indent: 1 },
            { label: 'Sell · Sales During Operation', values: feed.sellPostSalesRev, indent: 1 },
            { label: 'Hospitality / Operations', values: feed.hospRev, indent: 1 },
            { label: 'Retail / Lease', values: feed.leaseRev, indent: 1 },
            { label: 'Total Revenue', values: feed.totalRevenue, isTotal: true },
            { label: 'Cost of Sales', values: [], isSection: true },
            { label: 'CoS during construction (pre-sales cohort)', values: feed.cosConstruction, indent: 1 },
            { label: 'CoS during operations (post-handover sales)', values: feed.cosOperations, indent: 1 },
            { label: 'Total Cost of Sales', values: feed.totalCoS, isTotal: true },
            { label: 'Gross Margin', values: [], isSection: true },
            { label: 'Gross Margin (Revenue - CoS)', values: feed.grossMargin, isTotal: true },
          ]}
          currency={currency}
          latestLabel="Last"
          fmt={fmt}
        />
      </PhaseSection>

      <PhaseSection
        phaseId="m2-schedules-bs"
        title="Balance Sheet Feed"
        meta="Closing balances per period"
        storageKey="fmp:m2:schedules:bs:collapsed"
      >
        <PeriodTable
          title="Balance Sheet · Working-Capital Lines (closing)"
          caption="Inventory: Sell capex not yet released to CoS. AR: cumulative recognition not yet collected (Sell + Hospitality + Lease, summed). Unearned Revenue: cumulative cash collected ahead of recognition. AP: supplier credit terms wire in at M3."
          yearLabels={snap.yearLabels}
          rows={[
            { label: 'Current Assets', values: [], isSection: true },
            { label: 'Inventory (work-in-progress + completed-unsold)', values: feed.projInventory, indent: 1 },
            { label: 'Accounts Receivable', values: feed.projAR, indent: 1 },
            { label: 'Current Liabilities', values: [], isSection: true },
            { label: 'Unearned Revenue', values: feed.projUR, indent: 1 },
            { label: 'Accounts Payable (placeholder — M3 supplier terms)', values: feed.ap, indent: 1 },
            { label: 'Net Working Capital', values: feed.nwc, isTotal: true },
          ]}
          currency={currency}
          latestLabel="Closing"
          fmt={fmt}
        />
      </PhaseSection>

      <PhaseSection
        phaseId="m2-schedules-cf"
        title="Cash Flow Feed"
        meta="Operating cash flows per period"
        storageKey="fmp:m2:schedules:cf:collapsed"
      >
        <PeriodTable
          title="Cash Flow · Operating Activities"
          caption="Cash collected from customers: Sell cash profile + Hospitality DSO-driven cash + Lease DSO-driven cash. Capex appears here as the inventory build (a negative operating-cash item under the indirect method, or a separate investing line under the direct method)."
          yearLabels={snap.yearLabels}
          rows={[
            { label: 'Cash Collected from Customers', values: [], isSection: true },
            { label: 'Sell (Pre-Sales + SDO cash)', values: feed.cashSell, indent: 1 },
            { label: 'Hospitality / Operations', values: feed.cashHosp, indent: 1 },
            { label: 'Retail / Lease', values: feed.cashLease, indent: 1 },
            { label: 'Total Cash from Customers', values: feed.totalCash, isSubtotal: true },
            { label: 'Cash Invested', values: [], isSection: true },
            { label: '(-) Capex (build into inventory)', values: feed.projCapex.map((v) => -v), indent: 1 },
            { label: 'Net Operating Cash Flow', values: feed.netOpCf, isTotal: true },
          ]}
          currency={currency}
          latestLabel="Last"
          fmt={fmt}
        />
      </PhaseSection>
    </div>
  );
}
