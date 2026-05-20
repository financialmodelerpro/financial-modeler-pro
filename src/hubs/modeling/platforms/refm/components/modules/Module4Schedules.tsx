'use client';

/**
 * Module4Schedules.tsx (M4 Pass 2b, 2026-05-20)
 *
 * Single-tab dashboard of every schedule feeding the Balance Sheet.
 * No new math: pure read-from-engines. Each section is a collapsible
 * PhaseSection holding one or more PeriodTables.
 *
 * Sections (mirror the reference v1.16 BS Plan + BS Build sheets):
 *   1. Accounts Receivable (residential milestone-driven from M2)
 *   2. Inventory (residential WIP — cumulative capex − cumulative CoS)
 *   3. Unearned Revenue (off-plan advances from M2)
 *   4. Escrow Balance (M2 Pass 9h)
 *   5. Accounts Payable (M3 Pass 2a)
 *   6. Fixed Assets — Capex + NBV + Accumulated Dep (M4 Pass 1)
 *   7. Debt Outstanding (M1 financing)
 *   8. Equity Roll-Forward (M1 financing)
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { PhaseSection } from './_shared/PhaseSection';
import { M4PeriodTable, type M4Row } from './_shared/m4Table';

export default function Module4Schedules(): React.JSX.Element {
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

  // Accumulated depreciation series (project)
  const accumDep: number[] = snap.fixedAssets.projectTotals.depreciable.accumDepPerPeriod.slice(0, N);
  const capexProj: number[] = snap.financing.capex.perPeriod.inclAllLand.slice(1, 1 + N);
  while (capexProj.length < N) capexProj.push(0);

  return (
    <div data-testid="module4-schedules" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 4 · BS Schedules</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>{currency}</div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)' }}>
          Every schedule that feeds the Balance Sheet, read-only, sourced from Modules 1-3 + M4 Pass 1. Configure
          inputs in their home modules (AP in M3 Output, Escrow in M2 Escrow tab, etc.) — this tab is a view-only
          consolidator.
        </p>
      </div>

      {/* 1a. Residential Receivables (milestone) */}
      <PhaseSection phaseId="m4-sch-ar" title="1a. Residential Sales Receivables" meta="Milestone-driven (M2 Pass 7q)" storageKey="fmp:m4:sch:ar:collapsed">
        <M4PeriodTable
          title="Residential Sales Receivables — Roll-Forward (project)"
          caption="Opening + Revenue billed − Cash collected = Closing. Driven by M2 Sell asset milestone schedule (pre-sales + sales-during-operation)."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={(() => {
            const opening = zeros(), billed = zeros(), collected = zeros(), closing = zeros();
            for (const [assetId, bundle] of snap.byAssetSchedules) {
              const sell = snap.revenue.bySellAsset.get(assetId);
              if (!sell) continue;
              for (let t = 0; t < N; t++) {
                opening[t] += bundle.ar.openingPerPeriod[t] ?? 0;
                billed[t] += sell.presalesSalesValuePerPeriod[t] ?? 0;
                collected[t] += sell.cashCollectedPerPeriod[t] ?? 0;
                closing[t] += bundle.ar.perPeriod[t] ?? 0;
              }
            }
            return [
              { label: 'Opening AR', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
              { label: '(+) Revenue billed', values: billed, indent: 1 },
              { label: '(−) Cash collected', values: collected.map((v) => -v), indent: 1 },
              { label: 'Closing AR', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
            ];
          })()}
        />
      </PhaseSection>

      {/* 1b. Operating Receivables (DSO-driven, M4 Pass 2g) */}
      <PhaseSection phaseId="m4-sch-ar-op" title="1b. Operating Receivables" meta="DSO-driven (hospitality + lease)" storageKey="fmp:m4:sch:ar-op:collapsed">
        <M4PeriodTable
          title="Operating AR — Roll-Forward (project)"
          caption="Closing AR = Operating revenue × DSO / 365. Cash received = Revenue − ΔAR. Set DSO in Module 4 Balance Sheet → Working Capital Inputs."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
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
      </PhaseSection>

      {/* 2. Inventory (Residential WIP) */}
      <PhaseSection phaseId="m4-sch-inv" title="2. Inventory (Residential WIP)" meta="Cumulative capex − cumulative CoS per Sell asset" storageKey="fmp:m4:sch:inv:collapsed">
        <M4PeriodTable
          title="Residential WIP — Roll-Forward (project)"
          caption="Opening + Capex capitalized − Released to CoS = Closing. Floored at 0 once CoS has fully unwound the capex."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={(() => {
            const closing = zeros();
            for (const cf of snap.perAssetCF.values()) {
              for (let t = 0; t < N; t++) closing[t] += cf.inventoryPerPeriod[t] ?? 0;
            }
            const opening = zeros();
            for (let t = 1; t < N; t++) opening[t] = closing[t - 1] ?? 0;
            const cosTotal = snap.pl.cosPerPeriod;
            // Capex capitalized = change in (closing + cumulative CoS) per period
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

      {/* 3. Unearned Revenue */}
      <PhaseSection phaseId="m4-sch-unearned" title="3. Unearned Revenue (Off-plan advances)" meta="M2 Sell pre-sales liability" storageKey="fmp:m4:sch:unearned:collapsed">
        <M4PeriodTable
          title="Unearned Revenue — Roll-Forward (project)"
          caption="Opening + Cash collected − Revenue recognized = Closing. Liability until residential units are handed over."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={(() => {
            const opening = zeros(), cash = zeros(), recognized = zeros(), closing = zeros();
            for (const [assetId, bundle] of snap.byAssetSchedules) {
              const sell = snap.revenue.bySellAsset.get(assetId);
              if (!sell) continue;
              for (let t = 0; t < N; t++) {
                opening[t] += bundle.unearned.openingPerPeriod[t] ?? 0;
                cash[t] += sell.presalesSalesValuePerPeriod[t] ?? 0;
                recognized[t] += sell.presalesRecognitionPerPeriod[t] ?? 0;
                closing[t] += bundle.unearned.perPeriod[t] ?? 0;
              }
            }
            return [
              { label: 'Opening unearned revenue', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
              { label: '(+) Cash collected', values: cash, indent: 1 },
              { label: '(−) Revenue recognized', values: recognized.map((v) => -v), indent: 1 },
              { label: 'Closing unearned revenue', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
            ];
          })()}
        />
      </PhaseSection>

      {/* 4. Escrow Balance */}
      <PhaseSection phaseId="m4-sch-escrow" title="4. Escrow Balance (Inaccessible Funds)" meta="M2 Pass 9h-3" storageKey="fmp:m4:sch:escrow:collapsed">
        <M4PeriodTable
          title="Escrow — Balance Roll-Forward (project)"
          caption="Opening + Held − Release = Closing. Held during construction; releases on each asset's Release Year."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
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
      </PhaseSection>

      {/* 5. Accounts Payable */}
      <PhaseSection phaseId="m4-sch-ap" title="5. Accounts Payable" meta="M3 Pass 2a — DPO-driven" storageKey="fmp:m4:sch:ap:collapsed">
        <M4PeriodTable
          title="AP — Roll-Forward (project)"
          caption="Opening + Opex Incurred − Cash Paid = Closing. Configure DPO in M3 Opex Output."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={[
            { label: 'Opening AP', values: snap.ap.projectTotals.openingApPerPeriod, isSubtotal: true, totalOverride: fmt(snap.ap.projectTotals.openingApPerPeriod[0] ?? 0) },
            { label: '(+) Opex incurred', values: snap.ap.projectTotals.opexIncurredPerPeriod, indent: 1 },
            { label: '(−) Cash paid', values: snap.ap.projectTotals.cashPaidPerPeriod.map((v) => -v), indent: 1 },
            { label: 'Closing AP', values: snap.ap.projectTotals.closingApPerPeriod, isTotal: true, totalOverride: fmt(snap.ap.projectTotals.closingApPerPeriod[N - 1] ?? 0) },
          ]}
        />
      </PhaseSection>

      {/* 5b. IDC Allocation (M4 Pass 2f) */}
      <PhaseSection
        phaseId="m4-sch-idc"
        title="5b. Capitalised Interest (IDC) Allocation"
        meta="Allocated by land-area share — Sell IDC -> CoS, Operate/Lease IDC -> D&A"
        storageKey="fmp:m4:sch:idc:collapsed"
      >
        <M4PeriodTable
          title="IDC by Asset — Allocation (project)"
          caption="Total IDC per period from the financing engine, distributed across visible non-companion assets by land-sqm share. Sell / Sell+Manage assets capitalise IDC to inventory (released to CoS via the recognition profile). Operate / Lease assets capitalise IDC to Fixed Assets (depreciated over useful life)."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={(() => {
            const rows: M4Row[] = [];
            const idcAssetRows = Array.from(snap.idc.byAsset.values()).filter((r) => r.totalIdc > 0);
            if (idcAssetRows.length === 0) {
              return [
                { label: 'Total IDC (project)', values: snap.idc.totalIdcPerPeriod, isTotal: true },
                { label: 'No allocation — set project land area on assets or check financing tranches for capitalised interest.', values: zeros(), isSection: true },
              ];
            }
            rows.push({ label: 'IDC capitalised this period:', values: [], isSection: true });
            for (const r of idcAssetRows) {
              rows.push({
                label: `${r.assetName} (${(r.shareOfTotalLand * 100).toFixed(2)}% land share)`,
                values: r.idcPerPeriod,
                indent: 1,
              });
            }
            rows.push({ label: 'Total IDC (project)', values: snap.idc.totalIdcPerPeriod, isTotal: true });
            rows.push({ label: 'Operate/Lease IDC depreciation', values: snap.idc.idcDepreciationPerPeriod.map((v) => -v), indent: 1 });
            rows.push({
              label: 'Operate/Lease IDC NBV (closing)',
              values: snap.idc.idcNbvPerPeriod,
              isSubtotal: true,
              totalOverride: fmt(snap.idc.idcNbvPerPeriod[N - 1] ?? 0),
            });
            return rows;
          })()}
        />
      </PhaseSection>

      {/* 6. Fixed Assets */}
      <PhaseSection phaseId="m4-sch-fa" title="6. Fixed Assets (NBV)" meta="M4 Pass 1 depreciation roll-forward" storageKey="fmp:m4:sch:fa:collapsed">
        <M4PeriodTable
          title="Fixed Assets — Roll-Forward (project)"
          caption="Land never depreciates. Depreciable Opening NBV + Additions − Depreciation = Closing NBV. Accumulated D&A shown for the BS line."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={[
            { label: 'Land (additive only)', values: snap.fixedAssets.projectTotals.land.closingPerPeriod.slice(0, N), isSubtotal: true, totalOverride: fmt(snap.fixedAssets.projectTotals.land.closingPerPeriod[N - 1] ?? 0) },
            { label: 'Depreciable Opening NBV', values: snap.fixedAssets.projectTotals.depreciable.openingNBVPerPeriod.slice(0, N), indent: 1, totalOverride: fmt(snap.fixedAssets.projectTotals.depreciable.openingNBVPerPeriod[0] ?? 0) },
            { label: '(+) Additions (capex)', values: snap.fixedAssets.projectTotals.depreciable.additionsPerPeriod.slice(0, N), indent: 1 },
            { label: '(−) Depreciation', values: snap.fixedAssets.projectTotals.depreciable.depreciationPerPeriod.slice(0, N).map((v) => -v), indent: 1 },
            { label: 'Depreciable Closing NBV', values: snap.fixedAssets.projectTotals.depreciable.closingNBVPerPeriod.slice(0, N), isSubtotal: true, totalOverride: fmt(snap.fixedAssets.projectTotals.depreciable.closingNBVPerPeriod[N - 1] ?? 0) },
            { label: 'Total Fixed Assets (Land + NBV)', values: snap.bs.totalFixedAssetsPerPeriod, isTotal: true, totalOverride: fmt(snap.bs.totalFixedAssetsPerPeriod[N - 1] ?? 0) },
            { label: 'Accumulated Depreciation (memo)', values: accumDep, indent: 1, totalOverride: fmt(accumDep[N - 1] ?? 0) },
            { label: 'Project capex (inc. Land, memo)', values: capexProj, indent: 1 },
          ]}
        />
      </PhaseSection>

      {/* 7. Debt */}
      <PhaseSection phaseId="m4-sch-debt" title="7. Debt Outstanding" meta="M1 financing tranches" storageKey="fmp:m4:sch:debt:collapsed">
        <M4PeriodTable
          title="Debt — Outstanding by Tranche (project)"
          caption="Per-tranche outstanding balance. Drawdowns add; principal repayments subtract; interest is recorded in the P&L."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={(() => {
            const rows: M4Row[] = [];
            const totalOut = zeros();
            for (const t of state.financingTranches) {
              const f = snap.financing.facilities.get(t.id);
              if (!f) continue;
              const outRow = f.outstanding.slice(1, 1 + N);
              while (outRow.length < N) outRow.push(0);
              rows.push({ label: t.name, values: outRow, indent: 1, totalOverride: fmt(outRow[N - 1] ?? 0) });
              for (let i = 0; i < N; i++) totalOut[i] += outRow[i] ?? 0;
            }
            rows.push({ label: 'Total Debt Outstanding', values: totalOut, isTotal: true, totalOverride: fmt(totalOut[N - 1] ?? 0) });
            return rows;
          })()}
        />
      </PhaseSection>

      {/* 8. Equity */}
      <PhaseSection phaseId="m4-sch-equity" title="8. Equity Roll-Forward" meta="Cumulative equity drawdowns from M1" storageKey="fmp:m4:sch:equity:collapsed">
        <M4PeriodTable
          title="Equity — Cumulative Roll-Forward (project)"
          caption="Opening + Equity drawdown = Closing. Cumulative across the project axis."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={(() => {
            const draws = snap.directCF.equityDrawdownPerPeriod;
            const closing = zeros();
            const opening = zeros();
            let running = 0;
            for (let t = 0; t < N; t++) {
              opening[t] = running;
              running += draws[t] ?? 0;
              closing[t] = running;
            }
            return [
              { label: 'Opening equity', values: opening, isSubtotal: true, totalOverride: fmt(opening[0] ?? 0) },
              { label: '(+) Equity drawdown', values: draws, indent: 1 },
              { label: 'Closing equity (cumulative)', values: closing, isTotal: true, totalOverride: fmt(closing[N - 1] ?? 0) },
            ];
          })()}
        />
      </PhaseSection>
    </div>
  );
}
