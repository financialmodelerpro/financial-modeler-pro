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
import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../../lib/financials-resolvers';
import { computeReturnsSnapshot } from '../../lib/returns-resolvers';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { MetricCard, MetricGrid, fmtPct, fmtX } from './Module5Shared';
import { FAST_INPUT } from './_shared/inputStyles';
import { DEFAULT_COVENANTS, type CovenantThreshold, type CovenantMetric } from '../../lib/state/module1-types';
import { evaluateCovenant, covenantUnit, type CovenantInputs } from '../../lib/covenants';

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
      setProject: s.setProject,
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
  const ee = rs.equityExposure;
  const fm = rs.fundingMix;

  const dscrTone = m.dscrMin === null ? 'neutral' : m.dscrMin >= 1.2 ? 'good' : 'bad';
  const ltvTone = m.ltvAtExit === null ? 'neutral' : m.ltvAtExit <= 0.6 ? 'good' : 'bad';

  // Snapshot-derived ratio inputs for the Lender Covenants section. DSCR + ICR
  // come straight off the snapshot; Debt Yield is derived NOI / debt; LTV is
  // measured at peak debt (debt outstanding / GDV), since LTV at exit is ~0%
  // once debt is repaid. ltvAtExit is the fallback when no GDV basis exists.
  const covenantInputs: CovenantInputs = {
    dscrPerPeriod: m.dscrPerPeriod, dscrMin: m.dscrMin, dscrAvg: m.dscrAvg,
    icrPerPeriod: m.icrPerPeriod, icrMin: m.icrMin,
    noiPerPeriod: rs.noiPerPeriod, debtOutstandingPerPeriod: snap.bs.debtOutstandingPerPeriod,
    gdvValue: de.gdv, ltvAtExit: m.ltvAtExit,
  };
  const covenants = project.covenants ?? DEFAULT_COVENANTS;
  const setCovenants = (next: CovenantThreshold[]): void => state.setProject({ covenants: next });

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
        <MetricCard label="Max Negative Cash Flow" value={fmt(ee.maxNegativeCumulativeCF)} sub="peak FCFE outflow" tone="bad" />
      </MetricGrid>

      {/* ── Lender Covenants (NEW): per-period DSCR / ICR / Debt Yield + LTV at
            exit, editable thresholds, pass / breach. Ratios are snapshot-derived. ── */}
      <LenderCovenants
        covenants={covenants}
        inputs={covenantInputs}
        yearLabels={rs.yearLabels}
        onChange={setCovenants}
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

      {/* ── Funding Mix (received from Returns): capital structure as % of sources. ── */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', margin: 'var(--sp-3) 0 var(--sp-1)' }}>
        Funding Mix
      </div>
      <MetricGrid min={150}>
        <MetricCard label="Debt" value={fmtPct(fm.debtPct)} sub="% of total sources" />
        <MetricCard label="Cash Equity" value={fmtPct(fm.cashEquityPct)} sub="existing + new cash" />
        <MetricCard label="In-Kind Equity" value={fmtPct(fm.inKindEquityPct)} sub="contributed land" />
        <MetricCard label="Customer Funding" value={fmtPct(fm.customerFundingPct)} sub="pre-sales collections" />
      </MetricGrid>

      {/* Income + exit profile (going-in vs exit, NOI) */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', margin: 'var(--sp-3) 0 var(--sp-1)' }}>
        Income and Exit Profile
      </div>
      <MetricGrid min={150}>
        <MetricCard label="Stabilised NOI" value={fmt(rs.stabilisedNOI)} sub={currency} />
        <MetricCard label="Exit NOI" value={fmt(rs.exitNOI)} sub={`year ${rs.exitYearLabel}`} />
        <MetricCard label="Stabilisation Year" value={rs.stabilization.stabilizationYear != null ? String(rs.stabilization.stabilizationYear) : 'n/a'} sub="NOI reaches 95% of stable" />
        <MetricCard label="Stabilised Yield on Cost" value={fmtPct(rs.stabilization.stabilisedYieldOnCost)} sub="stabilised NOI / dev cost" />
        <MetricCard label="Exit Cap Rate" value={fmtPct(m.capRateAtExit)} sub="exit NOI / exit value" />
        <MetricCard label="Terminal Enterprise Value" value={fmt(rs.terminalEnterpriseValue)} sub={currency} />
        <MetricCard label="Terminal Equity Value" value={fmt(rs.terminalEquityValue)} sub="EV less debt + cash" />
      </MetricGrid>

      {/* ── Exit-Year Analysis (received from Returns): hold vs sell timing. ── */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', margin: 'var(--sp-3) 0 var(--sp-1)' }}>
        Exit-Year Analysis (hold vs sell timing)
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 'var(--sp-1)' }}>
        Project IRR (FCFF) and Equity IRR (FCFE) if the asset is sold at the end of each year, using that year&apos;s terminal value. The highlighted row is the selected Exit Year.
      </div>
      <div style={{ overflowX: 'auto', marginBottom: 'var(--sp-3)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
          <thead>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={{ textAlign: 'left', padding: '6px 10px' }}>Exit Year</th>
              <th style={{ textAlign: 'right', padding: '6px 10px' }}>Enterprise Value</th>
              <th style={{ textAlign: 'right', padding: '6px 10px' }}>Equity Value</th>
              <th style={{ textAlign: 'right', padding: '6px 10px' }}>Project IRR</th>
              <th style={{ textAlign: 'right', padding: '6px 10px' }}>Equity IRR</th>
              <th style={{ textAlign: 'right', padding: '6px 10px' }}>Equity MOIC</th>
            </tr>
          </thead>
          <tbody>
            {rs.exitYears.map((row) => (
              <tr key={row.exitIdx} style={{ borderBottom: '1px solid var(--color-border)', background: row.isSelected ? 'var(--color-navy-pale, #F4F7FC)' : 'transparent', fontWeight: row.isSelected ? 700 : 400 }}>
                <td style={{ textAlign: 'left', padding: '5px 10px' }}>{row.exitYearLabel}{row.isSelected ? '  ◀ selected' : ''}</td>
                <td style={{ textAlign: 'right', padding: '5px 10px' }}>{fmt(row.enterpriseValue)}</td>
                <td style={{ textAlign: 'right', padding: '5px 10px' }}>{fmt(row.equityValue)}</td>
                <td style={{ textAlign: 'right', padding: '5px 10px' }}>{fmtPct(row.fcffIrr)}</td>
                <td style={{ textAlign: 'right', padding: '5px 10px' }}>{fmtPct(row.fcfeIrr)}</td>
                <td style={{ textAlign: 'right', padding: '5px 10px' }}>{fmtX(row.equityMoic)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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

// ── Lender Covenants ────────────────────────────────────────────────────────
const COV_METRIC_OPTIONS: Array<{ v: CovenantMetric; label: string }> = [
  { v: 'dscr', label: 'DSCR' },
  { v: 'icr', label: 'Interest Cover (ICR)' },
  { v: 'ltv', label: 'LTV (peak debt)' },
  { v: 'debt_yield', label: 'Debt Yield' },
  { v: 'custom', label: 'Custom' },
];
const COV_METRIC_DEFAULTS: Record<CovenantMetric, { operator: 'min' | 'max'; threshold: number }> = {
  dscr: { operator: 'min', threshold: 1.20 },
  icr: { operator: 'min', threshold: 2.00 },
  ltv: { operator: 'max', threshold: 0.60 },
  debt_yield: { operator: 'min', threshold: 0.10 },
  custom: { operator: 'min', threshold: 1.00 },
};
const fmtCov = (v: number | null, unit: 'x' | 'pct'): string => (v == null ? '-' : unit === 'x' ? ratioFmt(v) : pctRowFmt(v));

function LenderCovenants(props: {
  covenants: CovenantThreshold[];
  inputs: CovenantInputs;
  yearLabels: number[];
  onChange: (next: CovenantThreshold[]) => void;
}): React.JSX.Element {
  const { covenants, inputs, yearLabels, onChange } = props;
  const evals = covenants.map((c) => ({ cov: c, ev: evaluateCovenant(c, inputs) }));

  const upd = (id: string, patch: Partial<CovenantThreshold>): void =>
    onChange(covenants.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const changeMetric = (id: string, metric: CovenantMetric): void =>
    upd(id, { metric, operator: COV_METRIC_DEFAULTS[metric].operator, threshold: COV_METRIC_DEFAULTS[metric].threshold });
  const add = (): void => onChange([...covenants, { id: `cov_${Date.now()}_${covenants.length}`, metric: 'custom', label: 'New covenant', operator: 'min', threshold: 1.0 }]);
  const remove = (id: string): void => onChange(covenants.filter((c) => c.id !== id));

  const th: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 11 };
  const thL: React.CSSProperties = { ...th, textAlign: 'left' };
  const td: React.CSSProperties = { textAlign: 'right', padding: '5px 8px', fontSize: 12, borderBottom: '1px solid var(--color-border)' };
  const tdL: React.CSSProperties = { ...td, textAlign: 'left' };
  const sel: React.CSSProperties = { ...FAST_INPUT, width: 'auto', cursor: 'pointer' };

  const statusPill = (pass: boolean | null): React.JSX.Element => {
    const [bg, fg, txt] = pass === null
      ? ['var(--color-grey-pale, #f3f4f6)', 'var(--color-meta)', 'n/a']
      : pass
        ? ['var(--color-success-bg, #dcfce7)', 'var(--color-success, #166534)', 'Pass']
        : ['var(--color-warning-bg, #fef3c7)', 'var(--color-warning, #92400e)', 'Breach'];
    return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 12, background: bg, color: fg }}>{txt}</span>;
  };

  // Per-period heatmap rows: metric-backed covenants that have a real series
  // (LTV is exit-only; custom has no series).
  const perPeriod = evals.filter(({ ev, cov }) => !ev.exitOnly && cov.metric !== 'custom' && ev.seriesPerPeriod.some((v) => v != null));
  const cellBg = (cov: CovenantThreshold, v: number | null): string => {
    if (v == null) return 'transparent';
    const pass = cov.operator === 'min' ? v >= cov.threshold : v <= cov.threshold;
    return pass ? 'var(--color-success-bg, #dcfce7)' : 'var(--color-warning-bg, #fef3c7)';
  };

  return (
    <section style={{ marginBottom: 'var(--sp-3)' }} data-testid="lender-covenants">
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', margin: 'var(--sp-3) 0 var(--sp-1)' }}>Lender Covenants</div>
      <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 'var(--sp-1)' }}>
        Standard covenants vs editable thresholds (saved with the project). Worst = the binding period (min for DSCR / ICR / Debt Yield, max for LTV); Pass / Breach compares the worst to the threshold. DSCR and Interest Cover come from the snapshot; Debt Yield = NOI / debt; LTV is measured at peak debt (peak debt outstanding / Gross Development Value), since LTV at exit is ~0% once debt is repaid and meaningless for a lender. Where there is no value basis it falls back to LTV at exit (labelled as such). Thresholds are in x for DSCR / ICR and % for LTV / Debt Yield.
      </div>

      {/* Summary: editable thresholds + worst / avg + pass / breach. */}
      <div style={{ overflowX: 'auto', marginBottom: 'var(--sp-2)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={thL}>Covenant</th>
              <th style={thL}>Metric</th>
              <th style={th}>Test</th>
              <th style={th}>Threshold</th>
              <th style={th}>Worst</th>
              <th style={th}>Avg</th>
              <th style={th}>Status</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {evals.map(({ cov, ev }) => {
              const unit = covenantUnit(cov.metric);
              const display = unit === 'pct' ? cov.threshold * 100 : cov.threshold;
              return (
                <tr key={cov.id} data-testid={`covenant-${cov.id}`}>
                  <td style={tdL}>
                    <input value={cov.label} onChange={(e) => upd(cov.id, { label: e.target.value })} style={{ ...FAST_INPUT, width: 150 }} title="Covenant name" />
                  </td>
                  <td style={tdL}>
                    <select value={cov.metric} onChange={(e) => changeMetric(cov.id, e.target.value as CovenantMetric)} style={sel}>
                      {COV_METRIC_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                    </select>
                    {ev.basisLabel && <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 2 }} data-testid={`covenant-basis-${cov.id}`}>{ev.basisLabel}</div>}
                  </td>
                  <td style={td}>
                    <select value={cov.operator} onChange={(e) => upd(cov.id, { operator: e.target.value as 'min' | 'max' })} style={sel}>
                      <option value="min">min ≥</option>
                      <option value="max">max ≤</option>
                    </select>
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>
                      <input type="number" step="0.01" value={Number.isFinite(display) ? display : 0}
                        onChange={(e) => { const n = parseFloat(e.target.value); const v = Number.isFinite(n) ? n : 0; upd(cov.id, { threshold: unit === 'pct' ? v / 100 : v }); }}
                        data-testid={`covenant-threshold-${cov.id}`}
                        style={{ ...FAST_INPUT, width: 64, textAlign: 'right' }} />
                      <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>{unit === 'pct' ? '%' : 'x'}</span>
                    </div>
                  </td>
                  <td style={{ ...td, fontWeight: 600 }}>{fmtCov(ev.worst, unit)}</td>
                  <td style={td}>{fmtCov(ev.avg, unit)}</td>
                  <td style={td}>{statusPill(ev.pass)}</td>
                  <td style={td}>
                    <button type="button" onClick={() => remove(cov.id)} title="Remove covenant" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-muted)', fontSize: 13 }}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginBottom: 'var(--sp-2)' }}>
        <button type="button" onClick={add} data-testid="covenant-add" style={{ border: '1px solid var(--color-navy)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: 'transparent', color: 'var(--color-navy)' }}>+ Add covenant</button>
      </div>

      {/* Per-period ratio heatmap (green = pass, amber = breach vs threshold). */}
      {perPeriod.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                <th style={{ ...thL, position: 'sticky', left: 0, background: 'var(--color-navy)', minWidth: 180 }}>Covenant by year</th>
                {yearLabels.map((y, i) => <th key={i} style={th}>{y}</th>)}
              </tr>
            </thead>
            <tbody>
              {perPeriod.map(({ cov, ev }) => (
                <tr key={cov.id}>
                  <td style={{ ...tdL, position: 'sticky', left: 0, background: 'var(--color-surface, #fff)', fontWeight: 600 }}>{cov.label}</td>
                  {yearLabels.map((_, i) => {
                    const v = ev.seriesPerPeriod[i] ?? null;
                    return <td key={i} style={{ ...td, background: cellBg(cov, v) }}>{fmtCov(v, ev.unit)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
