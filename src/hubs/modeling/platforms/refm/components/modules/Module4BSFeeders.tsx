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
          caption="Per-asset closing AR (mirror of M2 Revenue Output Block 5) + project total. AR forms ONLY on pre-sales (sale value lumps at sale year, cash collects via milestone profile). Post-handover sales (SDO) recognise revenue = cash same period and never accrue AR. Opening + Pre-Sales Sale Value − Pre-Sales Cash Collected = Closing AR."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={(() => {
            // M4 Pass 2N-Fix #3 (2026-05-21): A1 now literally mirrors
            // the per-asset AR built in M2 Revenue Output (Block 5).
            // Each Sell + Sell+Manage parent contributes its
            // bundle.ar (which is buildAccountsReceivable(presalesSV,
            // presalesCash)). The project totals are SUMS of the
            // per-asset closings — guaranteed to equal the M2 Output
            // numbers asset-for-asset. The previous SDO-inclusive
            // billed/collected lines were confusing because the SDO
            // terms cancelled (revenue=cash same period) yet showed
            // non-zero values in the display.
            const opening = zeros(), saleValue = zeros(), cashCollected = zeros(), closing = zeros();
            const perAssetRows: import('./_shared/m4Table').M4Row[] = [];
            const sellEntries = Array.from(snap.byAssetSchedules.entries()).filter(([id]) => snap.revenue.bySellAsset.has(id));
            for (const [assetId, bundle] of sellEntries) {
              const sell = snap.revenue.bySellAsset.get(assetId)!;
              for (let t = 0; t < N; t++) {
                opening[t] += bundle.ar.openingPerPeriod[t] ?? 0;
                saleValue[t] += sell.presalesSalesValuePerPeriod[t] ?? 0;
                cashCollected[t] += sell.presalesCashPerPeriod[t] ?? 0;
                closing[t] += bundle.ar.perPeriod[t] ?? 0;
              }
            }
            const rows: import('./_shared/m4Table').M4Row[] = [];
            rows.push({ label: 'Opening AR (project)', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) });
            rows.push({ label: '(+) Pre-Sales Sale Value', values: saleValue, indent: 1 });
            rows.push({ label: '(−) Pre-Sales Cash Collected', values: cashCollected.map((v) => -v), indent: 1 });
            rows.push({ label: 'Closing AR (project total)', values: closing, isSubtotal: true, totalOverride: fmt(closing[N - 1] ?? 0) });
            // Per-asset closing AR breakdown (mirror).
            if (sellEntries.length > 0) {
              rows.push({ label: 'Closing AR by asset', values: [], isSection: true });
              for (const [assetId, bundle] of sellEntries) {
                const asset = state.assets.find((a) => a.id === assetId);
                rows.push({
                  label: asset?.name ?? assetId,
                  values: bundle.ar.perPeriod.slice(0, N),
                  indent: 1,
                  totalOverride: fmt(bundle.ar.perPeriod[N - 1] ?? 0),
                });
              }
              rows.push({ label: 'Total Closing AR', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) });
            }
            void perAssetRows;
            return rows;
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
            // M4 Pass 2N-Fix #3 (2026-05-21): L2 mirrors M2 Output
            // Block 6 (Unearned Revenue) per asset + project total.
            const opening = zeros(), saleValue = zeros(), recognized = zeros(), closing = zeros();
            const sellEntries = Array.from(snap.byAssetSchedules.entries()).filter(([id]) => snap.revenue.bySellAsset.has(id));
            for (const [assetId, bundle] of sellEntries) {
              const sell = snap.revenue.bySellAsset.get(assetId)!;
              for (let t = 0; t < N; t++) {
                opening[t] += bundle.unearned.openingPerPeriod[t] ?? 0;
                saleValue[t] += sell.presalesSalesValuePerPeriod[t] ?? 0;
                recognized[t] += sell.presalesRecognitionPerPeriod[t] ?? 0;
                closing[t] += bundle.unearned.perPeriod[t] ?? 0;
              }
            }
            const rows: import('./_shared/m4Table').M4Row[] = [];
            rows.push({ label: 'Opening unearned revenue (project)', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) });
            rows.push({ label: '(+) Pre-sales contracts signed (sale value)', values: saleValue, indent: 1 });
            rows.push({ label: '(−) Revenue recognized (at handover)', values: recognized.map((v) => -v), indent: 1 });
            rows.push({ label: 'Closing unearned revenue (project total)', values: closing, isSubtotal: true, totalOverride: fmt(closing[N - 1] ?? 0) });
            if (sellEntries.length > 0) {
              rows.push({ label: 'Closing unearned revenue by asset', values: [], isSection: true });
              for (const [assetId, bundle] of sellEntries) {
                const asset = state.assets.find((a) => a.id === assetId);
                rows.push({
                  label: asset?.name ?? assetId,
                  values: bundle.unearned.perPeriod.slice(0, N),
                  indent: 1,
                  totalOverride: fmt(bundle.unearned.perPeriod[N - 1] ?? 0),
                });
              }
              rows.push({ label: 'Total Closing Unearned Revenue', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) });
            }
            return rows;
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
      <PhaseSection phaseId="m4-bs-equity" title="EQUITY" meta="Equity roll-forward + Retained Earnings schedule" storageKey="fmp:m4:bs:equity:collapsed">
        {/* E1: Equity Roll-Forward split by type (Pass 2P) */}
        <M4PeriodTable
          title="E1. Equity Cumulative Roll-Forward (project, split by type)"
          caption="Opening + Cash + In-Kind + Existing = Closing. Cash equity flows through Cash Flow (financing block); In-Kind equity is non-cash (land contributed in-kind, recognised on BS as Land + Share Capital simultaneously); Existing equity carries pre-existing operational-phase equity forward at axis start."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={(() => {
            // M4 Pass 2R-Fix (2026-05-24): pre-axis injections (existing
            // equity carry-forward) go into the PRIOR column, not into
            // axis Y0. Previously the engine lumped existing equity into
            // existingEquityPerPeriod[0] which painted Y0 with the pre-
            // axis value, so the prior-year column showed blank while
            // Y0 over-stated drawdowns. Now we route the existing-equity
            // lump to priorValue and zero axis[0], so:
            //   Prior year (e.g. 2025): closing equity = priorEquity lump
            //   Year 0 (e.g. 2026): opening = priorEquity, +draws -> closing
            const cashDraws = snap.financing.equity.cashPerPeriod.slice(0, N);
            const inKindDraws = snap.financing.equity.inKindPerPeriod.slice(0, N);
            const existingDrawsRaw = snap.financing.equity.existingEquityPerPeriod.slice(0, N);
            while (cashDraws.length < N) cashDraws.push(0);
            while (inKindDraws.length < N) inKindDraws.push(0);
            while (existingDrawsRaw.length < N) existingDrawsRaw.push(0);
            const priorExisting = existingDrawsRaw.reduce((s, v) => s + v, 0);
            // Axis values for the existing-equity row: zero everywhere
            // (the lump moves to the prior column).
            const existingAxisZeros = zeros();
            const priorOpening = 0;
            const priorClosing = priorExisting;
            const opening = zeros();
            const closing = zeros();
            let running = priorClosing;
            for (let t = 0; t < N; t++) {
              opening[t] = running;
              running += (cashDraws[t] ?? 0) + (inKindDraws[t] ?? 0);
              closing[t] = running;
            }
            const rows: M4Row[] = [
              { label: 'Opening equity', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0), priorValue: priorOpening },
              { label: '(+) Cash equity drawdown', values: cashDraws, indent: 1, priorValue: 0 },
              { label: '(+) In-Kind equity (land in-kind, non-cash)', values: inKindDraws, indent: 1, priorValue: 0 },
            ];
            if (Math.abs(priorExisting) > 0.5) {
              rows.push({
                label: '(+) Existing equity (pre-axis carry-forward)',
                values: existingAxisZeros,
                indent: 1,
                priorValue: priorExisting,
              });
            }
            rows.push({
              label: 'Closing equity (cumulative)',
              values: closing,
              isTotal: true,
              totalOverride: fmt(closing[N - 1] ?? 0),
              priorValue: priorClosing,
            });
            return rows;
          })()}
        />

        {/* E2: Retained Earnings Schedule (Pass 2P) */}
        <M4PeriodTable
          title="E2. Retained Earnings Roll-Forward (project)"
          caption="Opening RE + PAT − Statutory reserve transfer − Dividends = Closing RE. Dividends are zero today (Dividend policy lands in a follow-up pass); the row is present so the schedule is wired end-to-end."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={(() => {
            const pat = snap.pl.patPerPeriod.slice(0, N);
            const reserveTransfer = snap.bs.statutoryReserveTransferPerPeriod.slice(0, N);
            const dividends = snap.bs.dividendsPerPeriod.slice(0, N);
            const closing = snap.bs.retainedEarningsPerPeriod.slice(0, N);
            while (pat.length < N) pat.push(0);
            while (reserveTransfer.length < N) reserveTransfer.push(0);
            while (dividends.length < N) dividends.push(0);
            while (closing.length < N) closing.push(0);
            const opening = zeros();
            for (let t = 0; t < N; t++) opening[t] = t === 0 ? 0 : (closing[t - 1] ?? 0);
            return [
              { label: 'Opening retained earnings', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
              { label: '(+) PAT for the period', values: pat, indent: 1 },
              { label: '(−) Transfer to statutory reserve', values: reserveTransfer.map((v) => -v), indent: 1 },
              { label: '(−) Dividends declared', values: dividends.map((v) => -v), indent: 1 },
              { label: 'Closing retained earnings', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
            ];
          })()}
        />
      </PhaseSection>

      {/* M4 Pass 2O (2026-05-24): IDC Allocation moved to Module 1
          Financing → Schedules → IDC Allocation. The MEMO section here
          previously duplicated that breakdown; removed to avoid two
          sources of truth. */}
    </div>
  );
}
