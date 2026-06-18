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
import { MetricCard, MetricGrid, CollapsibleSection, fmtPct, fmtX, type CardTone } from './Module5Shared';
import { FAST_INPUT } from './_shared/inputStyles';
import { DEFAULT_COVENANTS, type CovenantThreshold, type CovenantMetric } from '../../lib/state/module1-types';
import { evaluateCovenant, covenantUnit, covenantSeries, reduceWorst, reduceAvg, type CovenantInputs } from '../../lib/covenants';

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

  // Snapshot-derived ratio inputs for the Lender Covenants section AND the
  // headline cards. DSCR + ICR come straight off the snapshot; Debt Yield is
  // derived NOI / debt; LTV is measured at peak debt (debt outstanding / GDV),
  // since LTV at exit is ~0% once debt is repaid. ltvAtExit is the fallback.
  const covenantInputs: CovenantInputs = {
    dscrPerPeriod: m.dscrPerPeriod,
    icrPerPeriod: m.icrPerPeriod,
    noiPerPeriod: rs.noiPerPeriod, debtOutstandingPerPeriod: snap.bs.debtOutstandingPerPeriod,
    gdvValue: de.gdv, ltvAtExit: m.ltvAtExit,
  };
  const covenants = project.covenants ?? DEFAULT_COVENANTS;
  const setCovenants = (next: CovenantThreshold[]): void => state.setProject({ covenants: next });

  // ── Single source of truth ────────────────────────────────────────────────
  // Every headline ratio is derived from the SAME per-period series the covenant
  // heatmap renders, via the shared reducers (reduceWorst / reduceAvg), so a
  // headline card can never disagree with the per-period row it summarises.
  const dscrSeries = covenantSeries('dscr', covenantInputs);
  const icrSeriesArr = covenantSeries('icr', covenantInputs);
  const debtYieldSeries = covenantSeries('debt_yield', covenantInputs);
  const ltvSeries = covenantSeries('ltv', covenantInputs);

  const minDSCR = reduceWorst(dscrSeries, 'min');             // worst debt-service period
  const avgDSCR = reduceAvg(dscrSeries);                      // mean over debt-service periods
  const minICR = reduceWorst(icrSeriesArr, 'min');            // worst interest period
  const debtYieldWorst = reduceWorst(debtYieldSeries, 'min'); // worst operating period with debt
  const ltvPeak = reduceWorst(ltvSeries, 'max');             // peak debt / GDV; null if no GDV basis
  const ltvHero = ltvPeak != null ? ltvPeak : m.ltvAtExit;   // fall back to LTV at exit
  const equityMoic = rs.result.fcfe.moic;                     // == selected Exit-Year row Equity MOIC

  // Covenant thresholds (editable, saved with the project) drive the hero
  // pass / breach badges so they track the same bar as the covenant table.
  const dscrThreshold = covenants.find((c) => c.metric === 'dscr')?.threshold ?? 1.20;
  const ltvThreshold = covenants.find((c) => c.metric === 'ltv')?.threshold ?? 0.60;
  const dscrPass = minDSCR == null ? null : minDSCR >= dscrThreshold;
  const ltvPass = ltvHero == null ? null : ltvHero <= ltvThreshold;
  const toneOf = (pass: boolean | null): CardTone => (pass == null ? 'neutral' : pass ? 'good' : 'bad');
  const badgeOf = (pass: boolean | null): { text: string; tone: CardTone } | undefined =>
    pass == null ? undefined : pass ? { text: 'Pass', tone: 'good' } : { text: 'Breach', tone: 'bad' };

  // ── Operating KPI blocks (demoted detail; rendered only when present) ──────
  const hospitalityBlock = (() => {
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
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-heading)', margin: 'var(--sp-2) 0 var(--sp-1)' }}>
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
  })();

  const residentialBlock = (() => {
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
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-heading)', margin: 'var(--sp-2) 0 var(--sp-1)' }}>
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
  })();

  const leaseBlock = (() => {
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
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-heading)', margin: 'var(--sp-2) 0 var(--sp-1)' }}>
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
  })();
  const hasOperatingKpis = !!(hospitalityBlock || residentialBlock || leaseBlock);

  const sectionTitle = (text: string): React.JSX.Element => (
    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', margin: 'var(--sp-3) 0 var(--sp-1)' }}>{text}</div>
  );

  return (
    <div data-testid="module5-metrics" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <p style={{ color: 'var(--color-meta)', marginTop: 0, marginBottom: 'var(--sp-3)', fontSize: 'var(--font-small)' }}>
        Real-estate decision view. The hero metrics below are the deal-deciders; Lender Covenants and Exit-Year Analysis are the analytical centrepieces; supporting detail is grouped underneath. Every coverage / leverage headline (Min DSCR, Debt Yield, peak LTV) is derived from the per-period series shown in the covenant heatmap, so a headline always equals the row it summarises.
      </p>

      {/* ── HERO: the handful of metrics that decide the deal ─────────────── */}
      <div data-testid="re-metrics-hero">
        <MetricGrid min={190}>
          <MetricCard size="hero" label="Equity Multiple (MOIC)" value={fmtX(equityMoic)} sub="equity out / equity in, at the selected exit" tooltip="Total equity distributions divided by equity invested, computed on the FCFE stream. Ties to the selected Exit-Year row's Equity MOIC." />
          <MetricCard size="hero" label="Yield on Cost" value={fmtPct(m.yieldOnCost)} sub="stabilised NOI / total cost" />
          <MetricCard size="hero" label="Profit Margin" value={fmtPct(m.profitMargin)} sub="PAT / revenue" />
          <MetricCard size="hero" label="Min DSCR" value={fmtX(minDSCR)} sub={`worst debt-service yr · vs ${fmtX(dscrThreshold)}`} tone={toneOf(dscrPass)} badge={badgeOf(dscrPass)} />
          <MetricCard size="hero" label="Peak Equity" value={fmt(m.peakEquity)} sub={`max equity at risk · ${currency}`} />
          <MetricCard size="hero" label={ltvPeak != null ? 'LTV (peak debt)' : 'LTV at Exit'} value={fmtPct(ltvHero)} sub={`${ltvPeak != null ? 'peak debt / GDV' : 'debt / exit value'} · vs ${fmtPct(ltvThreshold, 0)}`} tone={toneOf(ltvPass)} badge={badgeOf(ltvPass)} />
        </MetricGrid>
      </div>

      {/* ── CENTREPIECE 1: Lender Covenants (per-period heatmap, editable
            thresholds, pass / breach). Ratios are snapshot-derived; the hero
            Min DSCR / LTV / Debt Yield are reduced from these same series. ── */}
      <LenderCovenants
        covenants={covenants}
        inputs={covenantInputs}
        yearLabels={rs.yearLabels}
        onChange={setCovenants}
      />

      {/* ── CENTREPIECE 2: Exit-Year Analysis (hold vs sell timing) ───────── */}
      {sectionTitle('Exit-Year Analysis (hold vs sell timing)')}
      <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 'var(--sp-1)' }}>
        Project IRR (FCFF) and Equity IRR (FCFE) if the asset is sold at the end of each year, using that year&apos;s terminal value. The highlighted row is the selected Exit Year; its Equity MOIC is the hero Equity Multiple above.
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

      {/* ── DETAIL (demoted): coverage + profitability, economics, income, funding ── */}
      <CollapsibleSection title="Coverage and profitability detail" defaultOpen>
        <MetricGrid min={150}>
          <MetricCard label="Avg DSCR" value={fmtX(avgDSCR)} sub="mean over debt-service years" />
          <MetricCard label="Min Interest Cover" value={fmtX(minICR)} sub="worst yr · EBITDA / interest" />
          <MetricCard label="Debt Yield" value={fmtPct(debtYieldWorst)} sub="worst operating yr · NOI / debt" />
          <MetricCard label="Avg Cash-on-Cash" value={fmtPct(m.cashOnCashAvg)} sub="cash yield on equity" />
          <MetricCard label="Cap Rate at Exit" value={fmtPct(m.capRateAtExit)} sub="exit NOI / exit value" />
          <MetricCard label="Profit on Cost" value={fmtPct(m.profitOnCost)} sub="(revenue - cost) / cost" />
          <MetricCard label="Development Spread" value={fmtPct(m.developmentSpread)} sub="yield on cost - exit cap rate" />
          <MetricCard label="Max Negative Cash Flow" value={fmt(ee.maxNegativeCumulativeCF)} sub="peak FCFE outflow" tone="bad" />
        </MetricGrid>
      </CollapsibleSection>

      <CollapsibleSection title="Development economics" defaultOpen>
        <MetricGrid min={150}>
          <MetricCard label="Gross Development Value" value={fmt(de.gdv)} sub={`GDV, ${currency}`} />
          <MetricCard label="Total Development Cost" value={fmt(de.totalDevelopmentCost)} sub={currency} />
          <MetricCard label="Total Financing Cost" value={fmt(de.totalFinancingCost)} sub={currency} />
          <MetricCard label="Profit before Financing" value={fmt(de.profitBeforeFinancing)} sub="GDV less cost" tone={de.profitBeforeFinancing >= 0 ? 'good' : 'bad'} />
          <MetricCard label="Profit after Financing" value={fmt(de.profitAfterFinancing)} sub="less financing cost" tone={de.profitAfterFinancing >= 0 ? 'good' : 'bad'} />
          <MetricCard label="Development Margin" value={fmtPct(de.developmentMargin)} sub="profit / GDV" tone={de.developmentMargin !== null && de.developmentMargin > 0 ? 'good' : 'neutral'} />
          <MetricCard label="Cost to Value" value={fmtPct(de.costToValue)} sub="dev cost / GDV" />
        </MetricGrid>
      </CollapsibleSection>

      <CollapsibleSection title="Income and exit profile">
        <MetricGrid min={150}>
          <MetricCard label="Stabilised NOI" value={fmt(rs.stabilisedNOI)} sub={currency} />
          <MetricCard label="Exit NOI" value={fmt(rs.exitNOI)} sub={`year ${rs.exitYearLabel}`} />
          <MetricCard label="Stabilisation Year" value={rs.stabilization.stabilizationYear != null ? String(rs.stabilization.stabilizationYear) : 'n/a'} sub="NOI reaches 95% of stable" />
          <MetricCard label="Stabilised Yield on Cost" value={fmtPct(rs.stabilization.stabilisedYieldOnCost)} sub="stabilised NOI / dev cost" />
          <MetricCard label="Exit Cap Rate" value={fmtPct(m.capRateAtExit)} sub="exit NOI / exit value" />
          <MetricCard label="Terminal Enterprise Value" value={fmt(rs.terminalEnterpriseValue)} sub={currency} />
          <MetricCard label="Terminal Equity Value" value={fmt(rs.terminalEquityValue)} sub="EV less debt + cash" />
        </MetricGrid>
      </CollapsibleSection>

      <CollapsibleSection title="Funding mix">
        <MetricGrid min={150}>
          <MetricCard label="Debt" value={fmtPct(fm.debtPct)} sub="% of total sources" />
          <MetricCard label="Cash Equity" value={fmtPct(fm.cashEquityPct)} sub="existing + new cash" />
          <MetricCard label="In-Kind Equity" value={fmtPct(fm.inKindEquityPct)} sub="contributed land" />
          <MetricCard label="Customer Funding" value={fmtPct(fm.customerFundingPct)} sub="pre-sales collections" />
        </MetricGrid>
      </CollapsibleSection>

      {/* Operating KPIs (hospitality / residential / lease), rendered only when
          the project carries the matching asset strategies. Blended over the
          hold; ADR / RevPAR / rent / price rates are per-unit (NOT scaled). */}
      {hasOperatingKpis && (
        <CollapsibleSection title="Operating KPIs (hospitality / residential / lease)">
          {hospitalityBlock}
          {residentialBlock}
          {leaseBlock}
        </CollapsibleSection>
      )}
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
