'use client';

/**
 * Module4BSFeeders.tsx (M4 Pass 2i, 2026-05-20)
 *
 * Read-only consolidator of every schedule that feeds the Balance
 * Sheet, ordered by BS sequence (Assets → Liabilities → Equity →
 * Memo). No new math: each section is a collapsible PhaseSection
 * holding one or more PeriodTables wired to the financials snapshot.
 *
 * Layout:
 *   ASSETS:
 *     A1. Residential Sales Receivables (M2 milestone)
 *     A2. Operating Receivables (M4 Pass 2g DSO)
 *     A3. Inventory (Residential WIP, M2 CoS)
 *   LIABILITIES:
 *     L1. Accounts Payable (M3 Pass 2a DPO)
 *     L2. Unearned Revenue (M2 off-plan advances)
 *     L3. Escrow Balance (M2 Pass 9h regulator lock)
 *     L4. Debt Outstanding (M1 financing)
 *   EQUITY:
 *     E1. Equity Roll-Forward (M1 cumulative drawdowns)
 *   MEMO:
 *     M1. Capitalised Interest (IDC) Allocation (M4 Pass 2f)
 *
 * Fixed Assets + Depreciation lives in the sibling "Fixed Assets & D&A"
 * sub-tab so this view stays focused on the working-capital + financing
 * feeders. Both tabs are rendered by Module4Schedules (parent shell).
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { PhaseSection } from './_shared/PhaseSection';
import { M4PeriodTable, type M4Row } from './_shared/m4Table';

export default function Module4BSFeeders(): React.JSX.Element {
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
      financingTranches: s.financingTranches,
      equityContributions: s.equityContributions,
    })),
  );

  const snap = useMemo(() => computeFinancialsSnapshot(state), [state]);

  const project = state.project;
  const scale: DisplayScale = (project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(project.currency ?? 'SAR', scale);
  const N = snap.axisLength;
  const yearLabels = snap.yearLabels;
  const zeros = (): number[] => new Array<number>(N).fill(0);

  // M4 Pass 2j (2026-05-20): prior-year column = projectStartYear - 1.
  // Stock lines pick up opening balances from financing.existing;
  // working-capital roll-forwards start at 0.
  const priorYear = snap.projectStartYear - 1;
  const priorDebt = snap.financing.existing.debtOutstandingTotal;
  const priorEquity = snap.financing.existing.equityTotal;

  // Section-divider row helper.
  const sectionRow = (label: string): M4Row => ({ label, values: [], isSection: true });

  return (
    <div data-testid="module4-bs-feeders" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)' }}>
          Schedules sourced from Modules 1-3 + M4 Pass 1, ordered top-to-bottom by Balance Sheet sequence. Configure
          the underlying inputs in their home modules (AP days in M3 Opex Output, DSO in this module's Balance
          Sheet tab, Escrow in M2 Escrow, etc.). Fixed Assets &amp; Depreciation lives on the sibling sub-tab.
        </p>
      </div>

      {/* ─── ASSETS ──────────────────────────────────────────────── */}
      <PhaseSection phaseId="m4-bs-assets" title="ASSETS" meta="Current asset schedules" storageKey="fmp:m4:bs:assets:collapsed">
        {/* A1: Residential Sales Receivables */}
        <M4PeriodTable
          title="A1. Residential Sales Receivables: Roll-Forward (project)"
          caption="Opening + Revenue billed (pre-sales + SDO) − Cash collected = Closing. Driven by the M2 Sell asset milestone schedule."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={(() => {
            const opening = zeros(), billed = zeros(), collected = zeros(), closing = zeros();
            for (const [assetId, bundle] of snap.byAssetSchedules) {
              const sell = snap.revenue.bySellAsset.get(assetId);
              if (!sell) continue;
              for (let t = 0; t < N; t++) {
                opening[t] += bundle.ar.openingPerPeriod[t] ?? 0;
                billed[t] += (sell.presalesSalesValuePerPeriod[t] ?? 0)
                  + (sell.postSalesRevenuePerPeriod[t] ?? 0);
                collected[t] += sell.cashCollectedPerPeriod[t] ?? 0;
                closing[t] += bundle.ar.perPeriod[t] ?? 0;
              }
            }
            return [
              { label: 'Opening AR', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
              { label: '(+) Revenue billed (pre-sales + SDO)', values: billed, indent: 1 },
              { label: '(−) Cash collected (pre-sales + SDO)', values: collected.map((v) => -v), indent: 1 },
              { label: 'Closing AR', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
            ];
          })()}
        />

        {/* A2: Operating Receivables (DSO) */}
        <M4PeriodTable
          title="A2. Operating Receivables: Roll-Forward (project)"
          caption="DSO-driven for hospitality + lease revenue. Closing AR = Operating revenue × DSO / 365. Configure DSO in the Balance Sheet tab → Working Capital Inputs."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={(() => {
            const operatingRev = snap.pl.hospitalityRevenuePerPeriod.map((v, i) => v + (snap.pl.retailRevenuePerPeriod[i] ?? 0));
            const closing = snap.bs.arPerPeriod;
            const opening = zeros();
            for (let t = 1; t < N; t++) opening[t] = closing[t - 1] ?? 0;
            const change = closing.map((v, i) => v - (opening[i] ?? 0));
            const cash = operatingRev.map((v, i) => v - (change[i] ?? 0));
            return [
              { label: 'Opening AR', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
              { label: '(+) Operating revenue billed', values: operatingRev, indent: 1 },
              { label: '(−) Cash collected', values: cash.map((v) => -v), indent: 1 },
              { label: 'Closing AR', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
            ];
          })()}
        />

        {/* A3: Inventory */}
        <M4PeriodTable
          title="A3. Inventory (Residential WIP): Roll-Forward (project)"
          caption="Opening + Capex capitalized − Released to CoS = Closing. Floored at 0 once CoS has fully unwound the capex."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={(() => {
            const closing = zeros();
            for (const cf of snap.perAssetCF.values()) {
              for (let t = 0; t < N; t++) closing[t] += cf.inventoryPerPeriod[t] ?? 0;
            }
            const opening = zeros();
            for (let t = 1; t < N; t++) opening[t] = closing[t - 1] ?? 0;
            const cosTotal = snap.pl.cosPerPeriod;
            const capexCapitalized = zeros();
            for (let t = 0; t < N; t++) {
              capexCapitalized[t] = (closing[t] - opening[t]) + (cosTotal[t] ?? 0);
            }
            return [
              { label: 'Opening inventory', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
              { label: '(+) Capex capitalized', values: capexCapitalized, indent: 1 },
              { label: '(−) Released to Cost of Sales', values: cosTotal.map((v) => -v), indent: 1 },
              { label: 'Closing inventory', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
            ];
          })()}
        />
      </PhaseSection>

      {/* ─── LIABILITIES ─────────────────────────────────────────── */}
      <PhaseSection phaseId="m4-bs-liabs" title="LIABILITIES" meta="Current + non-current liability schedules" storageKey="fmp:m4:bs:liabs:collapsed">
        {/* L1: Accounts Payable */}
        <M4PeriodTable
          title="L1. Accounts Payable: Roll-Forward (project)"
          caption="DPO-driven AP. Opening + Opex Incurred − Cash Paid = Closing. Configure DPO in M3 Opex Output."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={[
            { label: 'Opening AP', values: snap.ap.projectTotals.openingApPerPeriod, isSubtotal: true, totalOverride: fmt(snap.ap.projectTotals.openingApPerPeriod[0] ?? 0), priorValue: 0 },
            { label: '(+) Opex incurred', values: snap.ap.projectTotals.opexIncurredPerPeriod, indent: 1, priorValue: 0 },
            { label: '(−) Cash paid', values: snap.ap.projectTotals.cashPaidPerPeriod.map((v) => -v), indent: 1, priorValue: 0 },
            { label: 'Closing AP', values: snap.ap.projectTotals.closingApPerPeriod, isTotal: true, totalOverride: fmt(snap.ap.projectTotals.closingApPerPeriod[N - 1] ?? 0), priorValue: 0 },
          ]}
        />

        {/* L2: Unearned Revenue */}
        <M4PeriodTable
          title="L2. Unearned Revenue (Off-plan advances): Roll-Forward (project)"
          caption="Opening + Pre-sales contracts signed (sale value) − Revenue recognized at handover = Closing. Liability until residential units hand over."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={(() => {
            const opening = zeros(), saleValue = zeros(), recognized = zeros(), closing = zeros();
            for (const [assetId, bundle] of snap.byAssetSchedules) {
              const sell = snap.revenue.bySellAsset.get(assetId);
              if (!sell) continue;
              for (let t = 0; t < N; t++) {
                opening[t] += bundle.unearned.openingPerPeriod[t] ?? 0;
                saleValue[t] += sell.presalesSalesValuePerPeriod[t] ?? 0;
                recognized[t] += sell.presalesRecognitionPerPeriod[t] ?? 0;
                closing[t] += bundle.unearned.perPeriod[t] ?? 0;
              }
            }
            return [
              { label: 'Opening unearned revenue', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
              { label: '(+) Pre-sales contracts signed (sale value)', values: saleValue, indent: 1 },
              { label: '(−) Revenue recognized (at handover)', values: recognized.map((v) => -v), indent: 1 },
              { label: 'Closing unearned revenue', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
            ];
          })()}
        />

        {/* L3: Escrow Balance */}
        <M4PeriodTable
          title="L3. Escrow Balance (Inaccessible Funds): Roll-Forward (project)"
          caption="Opening + Held − Release = Closing. Held during construction; releases on each asset's Release Year. See the M2 Escrow tab for inputs."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={(() => {
            const closing = snap.escrow.projectTotals.cumulativeBalancePerPeriod.slice(0, N);
            const opening = zeros();
            for (let t = 1; t < N; t++) opening[t] = closing[t - 1] ?? 0;
            return [
              { label: 'Opening Balance', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
              { label: '(+) Held this period', values: snap.escrow.projectTotals.heldPerPeriod, indent: 1 },
              { label: '(−) Release', values: snap.escrow.projectTotals.releasePerPeriod.map((v) => -v), indent: 1 },
              { label: 'Closing Balance', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
            ];
          })()}
        />

        {/* L4: Debt Outstanding */}
        <M4PeriodTable
          title="L4. Debt Outstanding by Tranche (project)"
          caption="Per-tranche outstanding balance. Drawdowns add; principal repayments subtract; interest is recorded in the P&L."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={(() => {
            const rows: M4Row[] = [];
            const totalOut = zeros();
            let totalPrior = 0;
            for (const t of state.financingTranches) {
              const f = snap.financing.facilities.get(t.id);
              if (!f) continue;
              // M4 Pass 2N-Fix (2026-05-21): f.outstanding is length N
              // where outstanding[i] = closing balance at end of year i.
              // The prior-column opening balance is f.openingBalance
              // (existing facilities carry their pre-axis balance; new
              // facilities + raised-inside-axis facilities are 0).
              const outRow = f.outstanding.slice(0, N);
              while (outRow.length < N) outRow.push(0);
              const facPrior = f.openingBalance ?? 0;
              rows.push({ label: t.name, values: outRow, indent: 1, totalOverride: fmt(outRow[N - 1] ?? 0), priorValue: facPrior });
              for (let i = 0; i < N; i++) totalOut[i] += outRow[i] ?? 0;
              totalPrior += facPrior;
            }
            rows.push({ label: 'Total Debt Outstanding', values: totalOut, isTotal: true, totalOverride: fmt(totalOut[N - 1] ?? 0), priorValue: totalPrior });
            return rows;
          })()}
        />
      </PhaseSection>

      {/* ─── EQUITY ──────────────────────────────────────────────── */}
      <PhaseSection phaseId="m4-bs-equity" title="EQUITY" meta="Equity roll-forward" storageKey="fmp:m4:bs:equity:collapsed">
        {/* E1: Equity Roll-Forward */}
        <M4PeriodTable
          title="E1. Equity Cumulative Roll-Forward (project)"
          caption="Opening + Equity drawdown = Closing. Cumulative across the project axis. Statutory reserve + retained earnings build on this base (see the Balance Sheet tab)."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={(() => {
            const draws = snap.directCF.equityDrawdownPerPeriod;
            const closing = zeros();
            const opening = zeros();
            // M4 Pass 2j: seed cumulative equity from existing equity at
            // axis start. Opening[0] carries the existing equity total
            // forward into year 0 so the BS share capital reconciles.
            let running = priorEquity;
            for (let t = 0; t < N; t++) {
              opening[t] = running;
              running += draws[t] ?? 0;
              closing[t] = running;
            }
            return [
              { label: 'Opening equity', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0), priorValue: priorEquity },
              { label: '(+) Equity drawdown', values: draws, indent: 1, priorValue: 0 },
              { label: 'Closing equity (cumulative)', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0), priorValue: priorEquity },
            ];
          })()}
        />
      </PhaseSection>

      {/* ─── MEMO ────────────────────────────────────────────────── */}
      <PhaseSection phaseId="m4-bs-memo" title="MEMO" meta="Feeders that aren't BS line items themselves" storageKey="fmp:m4:bs:memo:collapsed">
        {/* M1: IDC Allocation */}
        <M4PeriodTable
          title="M1. Capitalised Interest (IDC) Allocation (project)"
          caption="Total IDC per period from the financing engine, distributed across visible non-companion assets by active-construction land share. SELL / Sell+Manage IDC → augments CoS capex base, unwinds to P&L via recognition (sits in Inventory until released). OPERATE / Lease IDC → adds to Fixed Assets at handover and depreciates straight-line over useful life."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={(() => {
            const rows: M4Row[] = [];
            const idcAssetRows = Array.from(snap.idc.byAsset.values()).filter((r) => r.totalIdc > 0);
            if (idcAssetRows.length === 0) {
              return [
                { label: 'Total IDC (project)', values: snap.idc.totalIdcPerPeriod, isTotal: true },
                sectionRow('No allocation. Set project land area on assets or check financing tranches for capitalised interest.'),
              ];
            }
            // M4 Pass 2N-Fix (2026-05-21): split per-asset IDC by routing
            // (Sell → CoS via Inventory vs Operate/Lease → Fixed Assets
            // via D&A) so the user can see exactly how each asset's
            // capitalised interest flows through the financials.
            const assetById = new Map(state.assets.map((a) => [a.id, a] as const));
            const sellRows = idcAssetRows.filter((r) => {
              const a = assetById.get(r.assetId);
              return a && (a.strategy === 'Sell' || a.strategy === 'Sell + Manage');
            });
            const opLeaseRows = idcAssetRows.filter((r) => {
              const a = assetById.get(r.assetId);
              return a && (a.strategy === 'Operate' || a.strategy === 'Lease');
            });
            const sumRows = (rows: typeof idcAssetRows): number[] => {
              const out = zeros();
              for (const r of rows) for (let t = 0; t < N; t++) out[t] += r.idcPerPeriod[t] ?? 0;
              return out;
            };
            const sellSubtotal = sumRows(sellRows);
            const opLeaseSubtotal = sumRows(opLeaseRows);

            if (sellRows.length > 0) {
              rows.push(sectionRow('Sell / Sell+Manage IDC → routed to CoS via Inventory'));
              for (const r of sellRows) {
                rows.push({
                  label: `${r.assetName} (${(r.shareOfTotalLand * 100).toFixed(2)}% land share)`,
                  values: r.idcPerPeriod,
                  indent: 1,
                });
              }
              rows.push({
                label: 'Subtotal: Sell IDC → CoS',
                values: sellSubtotal,
                isSubtotal: true,
                totalOverride: fmt(sellSubtotal.reduce((s, v) => s + v, 0)),
              });
            }
            if (opLeaseRows.length > 0) {
              rows.push(sectionRow('Operate / Lease IDC → routed to Fixed Assets via D&A'));
              for (const r of opLeaseRows) {
                rows.push({
                  label: `${r.assetName} (${(r.shareOfTotalLand * 100).toFixed(2)}% land share)`,
                  values: r.idcPerPeriod,
                  indent: 1,
                });
              }
              rows.push({
                label: 'Subtotal: Operate/Lease IDC → Fixed Assets',
                values: opLeaseSubtotal,
                isSubtotal: true,
                totalOverride: fmt(opLeaseSubtotal.reduce((s, v) => s + v, 0)),
              });
            }
            rows.push({ label: 'Total IDC (project)', values: snap.idc.totalIdcPerPeriod, isTotal: true });
            rows.push(sectionRow('Operate / Lease IDC lifecycle on Fixed Assets:'));
            rows.push({ label: 'Operate/Lease IDC depreciation (charge to D&A)', values: snap.idc.idcDepreciationPerPeriod.map((v) => -v), indent: 1 });
            rows.push({
              label: 'Operate/Lease IDC NBV (closing, on BS Fixed Assets)',
              values: snap.idc.idcNbvPerPeriod,
              isSubtotal: true,
              totalOverride: fmt(snap.idc.idcNbvPerPeriod[N - 1] ?? 0),
            });
            return rows;
          })()}
        />
      </PhaseSection>
    </div>
  );
}
