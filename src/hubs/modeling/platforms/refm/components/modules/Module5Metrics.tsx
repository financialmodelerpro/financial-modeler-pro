'use client';

/**
 * Module5Metrics.tsx (M5 Returns, 2026-06-01)
 *
 * Real-estate metric surface: Yield on Cost, Profit Margin, Cap Rate,
 * Cash-on-Cash, DSCR, LTV at Exit, Equity Multiple, Debt Yield, ICR,
 * Development Spread, plus the per-period coverage ratios.
 *
 * All math lives in returns-resolvers.ts -> core/calculations/returns.
 */
import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { computeReturnsSnapshot } from '../../lib/returns-resolvers';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { M4PeriodTable, type M4Row } from './_shared/m4Table';
import { MetricCard, MetricGrid, fmtPct, fmtX } from './Module5Shared';

const ratioFmt = (v: number): string => (Math.abs(v) < 1e-9 ? '-' : `${v.toFixed(2)}x`);
const pctRowFmt = (v: number): string => (Math.abs(v) < 1e-9 ? '-' : `${(v * 100).toFixed(1)}%`);

export default function Module5Metrics(): React.JSX.Element {
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
  const rs = useMemo(() => computeReturnsSnapshot(snap, project), [snap, project]);

  const scale: DisplayScale = (project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(project.currency ?? 'SAR', scale);
  const m = rs.result.realEstate;
  const de = rs.developmentEconomics;

  const dscrTone = m.dscrMin === null ? 'neutral' : m.dscrMin >= 1.2 ? 'good' : 'bad';
  const ltvTone = m.ltvAtExit === null ? 'neutral' : m.ltvAtExit <= 0.6 ? 'good' : 'bad';

  const ratioRows: M4Row[] = [
    { label: 'DSCR (CFADS / debt service)', values: m.dscrPerPeriod, rowFmt: ratioFmt, totalOverride: `avg ${fmtX(m.dscrAvg)}`, isSubtotal: true },
    { label: 'Interest Coverage (EBITDA / interest)', values: m.icrPerPeriod, rowFmt: ratioFmt, totalOverride: `min ${fmtX(m.icrMin)}` },
    { label: 'Cash-on-Cash (distribution / equity)', values: m.cashOnCashPerPeriod, rowFmt: pctRowFmt, totalOverride: `avg ${fmtPct(m.cashOnCashAvg)}` },
  ];

  return (
    <div data-testid="module5-metrics" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <p style={{ color: 'var(--color-meta)', marginTop: 0, marginBottom: 'var(--sp-3)', fontSize: 'var(--font-small)' }}>
        Real-estate return + leverage metrics. Exit-based metrics (Cap Rate, LTV, Debt Yield) use the terminal value
        from the Returns tab. Coverage ratios are shown per period below; the Total column carries the average / min.
      </p>

      {/* Profitability + yield KPIs */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', marginBottom: 'var(--sp-1)' }}>
        Profitability and Yield
      </div>
      <MetricGrid min={150}>
        <MetricCard label="Yield on Cost" value={fmtPct(m.yieldOnCost)} sub="stabilised NOI / cost" tone="neutral" />
        <MetricCard label="Cap Rate at Exit" value={fmtPct(m.capRateAtExit)} sub="exit NOI / exit value" />
        <MetricCard label="Development Spread" value={fmtPct(m.developmentSpread)} sub="yield on cost less cap rate" tone={m.developmentSpread !== null && m.developmentSpread > 0 ? 'good' : 'neutral'} />
        <MetricCard label="Profit on Cost" value={fmtPct(m.profitOnCost)} sub="(revenue - cost) / cost" />
        <MetricCard label="Profit Margin" value={fmtPct(m.profitMargin)} sub="PAT / revenue" />
        <MetricCard label="Equity Multiple" value={fmtX(m.equityMultiple)} sub="distributions / invested" />
      </MetricGrid>

      {/* Leverage + coverage KPIs */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', marginBottom: 'var(--sp-1)' }}>
        Leverage and Coverage
      </div>
      <MetricGrid min={150}>
        <MetricCard label="LTV at Exit" value={fmtPct(m.ltvAtExit)} sub="debt / exit value" tone={ltvTone} />
        <MetricCard label="Debt Yield" value={fmtPct(m.debtYield)} sub="NOI / debt" />
        <MetricCard label="Min DSCR" value={fmtX(m.dscrMin)} sub="worst coverage period" tone={dscrTone} />
        <MetricCard label="Avg DSCR" value={fmtX(m.dscrAvg)} sub="mean over debt years" />
        <MetricCard label="Min Interest Cover" value={fmtX(m.icrMin)} sub="EBITDA / interest" />
        <MetricCard label="Avg Cash-on-Cash" value={fmtPct(m.cashOnCashAvg)} sub="cash yield on equity" />
        <MetricCard label="Peak Equity" value={fmt(m.peakEquity)} sub={currency} />
      </MetricGrid>

      {/* Per-period coverage ratios */}
      <M4PeriodTable
        title="Coverage and Cash Ratios by Year"
        caption="DSCR = cash available for debt service / debt service (periods with no debt service show a dash). Interest cover = EBITDA / interest. Cash-on-Cash = distributions / cumulative equity. The Total column shows the average (DSCR, Cash-on-Cash) or minimum (Interest cover)."
        yearLabels={rs.yearLabels}
        rows={ratioRows}
        currency={currency}
        fmt={fmt}
        priorYearLabel={snap.projectStartYear - 1}
      />

      {/* Development economics (real-estate residual / profit view) */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', margin: 'var(--sp-3) 0 var(--sp-1)' }}>
        Development Economics
      </div>
      <MetricGrid min={150}>
        <MetricCard label="Gross Development Value" value={fmt(de.gdv)} sub={`GDV, ${currency}`} />
        <MetricCard label="Total Development Cost" value={fmt(de.totalDevelopmentCost)} sub={currency} />
        <MetricCard label="Total Financing Cost" value={fmt(de.totalFinancingCost)} sub={currency} />
        <MetricCard label="Profit before Financing" value={fmt(de.profitBeforeFinancing)} sub="GDV less cost" tone={de.profitBeforeFinancing >= 0 ? 'good' : 'bad'} />
        <MetricCard label="Profit after Financing" value={fmt(de.profitAfterFinancing)} sub="less financing cost" tone={de.profitAfterFinancing >= 0 ? 'good' : 'bad'} />
        <MetricCard label="Development Margin" value={fmtPct(de.developmentMargin)} sub="profit / GDV" tone={de.developmentMargin !== null && de.developmentMargin > 0 ? 'good' : 'neutral'} />
        <MetricCard label="Cost to Value" value={fmtPct(de.costToValue)} sub="dev cost / GDV" />
      </MetricGrid>

      {/* Income + exit profile (going-in vs exit, NOI) */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', margin: 'var(--sp-3) 0 var(--sp-1)' }}>
        Income and Exit Profile
      </div>
      <MetricGrid min={150}>
        <MetricCard label="Stabilised NOI" value={fmt(rs.stabilisedNOI)} sub={currency} />
        <MetricCard label="Exit NOI" value={fmt(rs.exitNOI)} sub={`year ${rs.exitYearLabel}`} />
        <MetricCard label="Stabilisation Year" value={rs.stabilization.stabilizationYear != null ? String(rs.stabilization.stabilizationYear) : 'n/a'} sub="NOI reaches 95% of stable" />
        <MetricCard label="Going-in Yield on Cost" value={fmtPct(m.yieldOnCost)} sub="stabilised NOI / cost" />
        <MetricCard label="Exit Cap Rate" value={fmtPct(m.capRateAtExit)} sub="exit NOI / exit value" />
        <MetricCard label="Terminal Enterprise Value" value={fmt(rs.terminalEnterpriseValue)} sub={currency} />
        <MetricCard label="Terminal Equity Value" value={fmt(rs.terminalEquityValue)} sub="EV less debt + cash" />
      </MetricGrid>

      {/* Hospitality operations (only when the project has Operate assets with
          room-night demand). Operating KPIs are blended across the hold and
          across hospitality assets: ADR / RevPAR are per-night rates (NOT
          scaled like the currency figures), occupancy is occupied / available. */}
      {(() => {
        const hosp = [...snap.revenue.byHospitalityAsset.values()];
        const sumArr = (a: number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);
        let avail = 0, occRn = 0, rooms = 0, fb = 0, other = 0, totalHosp = 0;
        for (const h of hosp) {
          avail += sumArr(h.availableRoomNightsPerPeriod);
          occRn += sumArr(h.occupiedRoomNightsPerPeriod);
          rooms += sumArr(h.roomsRevenuePerPeriod);
          fb += sumArr(h.fbRevenuePerPeriod);
          other += sumArr(h.otherRevenuePerPeriod);
          totalHosp += sumArr(h.totalRevenuePerPeriod);
        }
        if (avail <= 0) return null; // no hospitality demand => hide the section
        const occupancy = avail > 0 ? occRn / avail : null;
        const adr = occRn > 0 ? rooms / occRn : null;
        const revpar = avail > 0 ? rooms / avail : null;
        const ccy = project.currency ?? 'SAR';
        const rate = (v: number | null): string => (v == null ? 'n/a' : Math.round(v).toLocaleString());
        const intFmt = (v: number): string => Math.round(v).toLocaleString();
        return (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', margin: 'var(--sp-3) 0 var(--sp-1)' }}>
              Hospitality Operations
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 'var(--sp-1)' }}>
              Blended across all hospitality (Operate) assets over the hold. ADR and RevPAR are per-night rates in {ccy} (not scaled); occupancy is occupied / available room nights.
            </div>
            <MetricGrid min={150}>
              <MetricCard label="Occupancy" value={fmtPct(occupancy)} sub="occupied / available nights" />
              <MetricCard label="ADR" value={rate(adr)} sub={`${ccy} / occupied night`} />
              <MetricCard label="RevPAR" value={rate(revpar)} sub={`${ccy} / available night`} />
              <MetricCard label="Rooms Revenue" value={fmt(rooms)} sub={currency} />
              <MetricCard label="F&B Revenue" value={fmt(fb)} sub={currency} />
              <MetricCard label="Other Revenue" value={fmt(other)} sub={currency} />
              <MetricCard label="Total Hospitality Revenue" value={fmt(totalHosp)} sub={currency} />
              <MetricCard label="Available Room Nights" value={intFmt(avail)} sub="capacity over hold" />
            </MetricGrid>
          </>
        );
      })()}

      {/* Residential (for-sale) operating KPIs. Shown only when the project
          has Sell / Sell+Manage assets with sales. Prices are sale value and
          per-unit / per-sqm rates (NOT currency-scaled). */}
      {(() => {
        const sell = [...snap.revenue.bySellAsset.entries()];
        const sumArr = (a: number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);
        const areaOf = new Map<string, number>();
        for (const a of state.assets) areaOf.set(a.id, a.sellableBuaSqm || a.buaSqm || 0);
        let units = 0, preSale = 0, postSale = 0, area = 0;
        const activeYears = new Set<number>();
        for (const [id, s] of sell) {
          const preU = sumArr(s.presalesUnitsPerPeriod);
          const postU = sumArr(s.postSalesUnitsPerPeriod);
          units += preU + postU;
          preSale += sumArr(s.presalesRevenuePerPeriod);
          postSale += sumArr(s.postSalesRevenuePerPeriod);
          if (preU + postU > 0) area += areaOf.get(id) ?? 0;
          s.presalesUnitsPerPeriod.forEach((v, t) => {
            if ((v ?? 0) + (s.postSalesUnitsPerPeriod[t] ?? 0) > 0) activeYears.add(t);
          });
        }
        const saleValue = preSale + postSale;
        if (saleValue <= 0 && units <= 0) return null;
        const pricePerUnit = units > 0 ? saleValue / units : null;
        const pricePerSqm = area > 0 ? saleValue / area : null;
        const preSalesPct = saleValue > 0 ? preSale / saleValue : null;
        const velocity = activeYears.size > 0 ? units / activeYears.size : null;
        const ccy = project.currency ?? 'SAR';
        const rate = (v: number | null): string => (v == null ? 'n/a' : Math.round(v).toLocaleString());
        const intFmt = (v: number): string => Math.round(v).toLocaleString();
        return (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', margin: 'var(--sp-3) 0 var(--sp-1)' }}>
              Residential (For-Sale)
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 'var(--sp-1)' }}>
              Blended across all Sell / Sell+Manage assets over the hold. Prices are sale value; per-unit and per-sqm rates are in {ccy} (not scaled).
            </div>
            <MetricGrid min={150}>
              <MetricCard label="Residential GDV" value={fmt(saleValue)} sub={`sale value, ${currency}`} />
              <MetricCard label="Units Sold" value={intFmt(units)} sub="pre + post sales" />
              <MetricCard label="Avg Sale Price / Unit" value={rate(pricePerUnit)} sub={`${ccy} / unit`} />
              <MetricCard label="Avg Sale Price / sqm" value={rate(pricePerSqm)} sub={`${ccy} / sellable sqm`} />
              <MetricCard label="Pre-Sales %" value={fmtPct(preSalesPct)} sub="pre-sales / residential GDV" />
              <MetricCard label="Sales Velocity" value={rate(velocity)} sub="units / yr (active years)" />
            </MetricGrid>
          </>
        );
      })()}

      {/* Lease / income KPIs. Shown only when the project has Lease assets.
          Rent is achieved rent per occupied sqm per year (NOT currency-scaled);
          occupancy is occupied area over GLA across operating periods. (WAULT
          is not shown: the lease model has no per-tenant lease-term input.) */}
      {(() => {
        const lease = [...snap.revenue.byLeaseAsset.values()];
        const sumArr = (a: number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);
        let gla = 0, revenue = 0, occupiedArea = 0, glaYears = 0;
        for (const l of lease) {
          const assetGla = Object.values(l.perSubUnit).reduce((s, su) => s + (su.gla ?? 0), 0);
          gla += assetGla;
          revenue += sumArr(l.totalRevenuePerPeriod);
          occupiedArea += sumArr(l.occupiedAreaPerPeriod);
          const activePeriods = l.occupiedAreaPerPeriod.filter((v) => (v ?? 0) > 0).length;
          glaYears += assetGla * activePeriods;
        }
        if (gla <= 0 && revenue <= 0) return null;
        const avgOcc = glaYears > 0 ? occupiedArea / glaYears : null;
        const rentPerSqm = occupiedArea > 0 ? revenue / occupiedArea : null;
        const ccy = project.currency ?? 'SAR';
        const rate = (v: number | null): string => (v == null ? 'n/a' : Math.round(v).toLocaleString());
        const intFmt = (v: number): string => Math.round(v).toLocaleString();
        return (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', margin: 'var(--sp-3) 0 var(--sp-1)' }}>
              Lease / Income (Retail, Office)
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 'var(--sp-1)' }}>
              Blended across all Lease assets over the hold. Rent is achieved rent per occupied sqm per year in {ccy} (not scaled); occupancy is occupied area / GLA over operating periods.
            </div>
            <MetricGrid min={150}>
              <MetricCard label="Total GLA" value={intFmt(gla)} sub="sqm leasable" />
              <MetricCard label="Avg Occupancy" value={fmtPct(avgOcc)} sub="occupied / GLA over ops" />
              <MetricCard label="Rent per Leased sqm" value={rate(rentPerSqm)} sub={`${ccy} / occupied sqm / yr`} />
              <MetricCard label="Total Lease Revenue" value={fmt(revenue)} sub={currency} />
            </MetricGrid>
          </>
        );
      })()}
    </div>
  );
}
