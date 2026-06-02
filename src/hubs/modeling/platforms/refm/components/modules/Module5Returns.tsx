'use client';

/**
 * Module5Returns.tsx (M5 Returns, 2026-06-01)
 *
 * Returns surface: assumptions, the IRR / MOIC / NPV / Payback summary
 * across the three cash-flow bases (FCFF unlevered, FCFE levered,
 * Dividends realised), and the per-period cash-flow streams.
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
import { MetricCard, MetricGrid, AssumptionsPanel, fmtPct, fmtX, fmtYears, type AssumptionsValue } from './Module5Shared';

export default function Module5Returns(): React.JSX.Element {
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

  const cfg = rs.config;
  const r = rs.result;
  // M5 Pass 1 analytics blocks.
  const de = rs.developmentEconomics;
  const ex = rs.exitAnalysis;
  const su = rs.sourcesUses;
  const fm = rs.fundingMix;
  const ee = rs.equityExposure;
  const st = rs.stabilization;
  const da = rs.debtAnalytics;

  const assumptions: AssumptionsValue = {
    discountRatePct: cfg.discountRate * 100,
    exitYearOffset: cfg.exitYearOffset,
    terminalMethod: cfg.terminalMethod,
    exitMultiple: cfg.exitMultiple,
    perpetuityGrowthPct: cfg.perpetuityGrowth * 100,
  };
  const onAssumptions = (patch: Partial<AssumptionsValue>): void => {
    const next = { ...assumptions, ...patch };
    state.setProject({
      returns: {
        ...(project.returns ?? {}),
        discountRate: Math.max(0, next.discountRatePct / 100),
        exitYearOffset: next.exitYearOffset,
        terminalMethod: next.terminalMethod,
        exitMultiple: Math.max(0, next.exitMultiple),
        perpetuityGrowth: next.perpetuityGrowthPct / 100,
      },
    });
  };

  // Cash-flow streams over the hold horizon. Sponsor-IRR view: index 0 of
  // each stream is the INCEPTION period (projectStartYear − 1), which maps to
  // the table's prior-year column; indices 1..E are the axis years to exit.
  const axisLabels = rs.streamYearLabels.slice(1);
  const inceptionLabel = rs.streamYearLabels[0];
  // Build an M4Row from an (E+1) stream array: prior column = inception,
  // values = axis years, Total = full lifetime sum (incl. inception).
  const toRow = (label: string, arr: number[], opts: Partial<M4Row> = {}): M4Row => ({
    label,
    values: arr.slice(1),
    priorValue: arr[0] ?? 0,
    totalOverride: fmt(arr.reduce((s, v) => s + (v ?? 0), 0)),
    ...opts,
  });
  const noiStream = [0, ...rs.noiPerPeriod.slice(0, axisLabels.length)];
  const streamRows: M4Row[] = [
    toRow('FCFF, unlevered project', rs.fcffPerPeriod, { isSubtotal: true }),
    toRow('FCFE, levered equity', rs.fcfePerPeriod, { isSubtotal: true }),
    toRow('Distributed Equity (realized distributions)', rs.dividendStreamPerPeriod, { isSubtotal: true }),
    toRow('Memo: NOI (recurring)', noiStream, { indent: 1 }),
  ];

  // Per-stream summary table.
  const streamSummary: Array<{ key: string; label: string; s: typeof r.fcff }> = [
    { key: 'fcff', label: 'FCFF (unlevered project)', s: r.fcff },
    { key: 'fcfe', label: 'FCFE (levered equity)', s: r.fcfe },
    { key: 'dividends', label: 'Distributed Equity (realized distributions)', s: r.dividends },
  ];

  const irrTone = (irr: number | null) => (irr === null ? 'neutral' : irr >= cfg.discountRate ? 'good' : 'bad');

  // Step-by-step build-up rows (so the derivation is transparent).
  const b = rs.buildup;
  const fcffBuildupRows: M4Row[] = [
    toRow('(-) Historical Development Investment', b.existingPreCapexPerPeriod, { indent: 1 }),
    toRow('(+) Cash from Operations', b.cfoPerPeriod, { indent: 1 }),
    toRow('(+) Cash from Investing (new capex)', b.cfiPerPeriod, { indent: 1 }),
    toRow('(+) Terminal Enterprise Value', b.terminalEnterprisePerPeriod, { indent: 1 }),
    toRow('= FCFF (unlevered project)', rs.fcffPerPeriod, { isTotal: true }),
  ];
  // FCFE build-up — equity-centric. Existing equity = historical investment
  // net of the debt opening (the two inception lines combine to existing
  // equity). New CASH equity is the funding of the negative-FCFE periods
  // (noted in the caption); in-kind equity is shown explicitly.
  const fcfeBuildupRows: M4Row[] = [
    toRow('(-) Existing Equity Investment (at inception)', b.existingEquityPerPeriod, { indent: 1 }),
    toRow('(+) Cash from Operations', b.cfoPerPeriod, { indent: 1 }),
    toRow('(+) Cash from Investing (new capex)', b.cfiPerPeriod, { indent: 1 }),
    toRow('(-) In-Kind Equity Investment', b.inKindLandPerPeriod, { indent: 1 }),
    toRow('(+) Debt Drawdown', b.debtDrawPerPeriod, { indent: 1 }),
    toRow('(-) Principal Repayment', b.principalRepayPerPeriod, { indent: 1 }),
    toRow('(-) Interest Paid', b.interestPaidPerPeriod, { indent: 1 }),
    toRow('(+) Terminal Equity Value', b.terminalEquityPerPeriod, { indent: 1 }),
    toRow('= FCFE (levered equity)', rs.fcfePerPeriod, { isTotal: true }),
  ];
  const dividendBuildupRows: M4Row[] = [
    toRow('(-) Existing Equity Investment (at inception)', b.existingEquityPerPeriod, { indent: 1 }),
    toRow('(-) New Cash Equity Investment', b.equityCashPerPeriod, { indent: 1 }),
    toRow('(-) In-Kind Equity Investment', b.equityInKindPerPeriod, { indent: 1 }),
    toRow('(+) Dividends Distributed (cash-sweep waterfall)', b.dividendsDistributedPerPeriod, { indent: 1 }),
    toRow('(+) Terminal Equity Value', b.terminalEquityPerPeriod, { indent: 1 }),
    toRow('= Net Equity Cash Flow (dividend basis)', rs.dividendStreamPerPeriod, { isTotal: true }),
  ];

  return (
    <div data-testid="module5-returns" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <p style={{ color: 'var(--color-meta)', marginTop: 0, marginBottom: 'var(--sp-3)', fontSize: 'var(--font-small)' }}>
        Returns on three cash-flow bases: <strong>FCFF</strong> (unlevered, to all capital providers),{' '}
        <strong>FCFE</strong> (levered, free cash to equity after debt service), and <strong>Distributed Equity</strong>{' '}
        (IRR on the actual cash distributions to equity investors). Terminal value is added in the exit year per the assumptions below. NPV is intentionally omitted — IRR / MOIC / equity exposure / yield + exit metrics are the focus.
      </p>

      <AssumptionsPanel value={assumptions} yearLabels={rs.yearLabels} onChange={onAssumptions} />

      {/* ── Headline returns. NPV + Payback + Development Margin removed from
            here (2026-06-02): Returns tab focuses on IRR / MOIC / equity; the
            margin + exit ratios live in the RE Metrics tab. ── */}
      <MetricGrid min={155}>
        <MetricCard label="Project IRR (FCFF)" value={fmtPct(r.fcff.irr)} sub={`MOIC ${fmtX(r.fcff.moic)}`} tone={irrTone(r.fcff.irr)} />
        <MetricCard label="Equity IRR (FCFE)" value={fmtPct(r.fcfe.irr)} sub={`MOIC ${fmtX(r.fcfe.moic)}`} tone={irrTone(r.fcfe.irr)} />
        <MetricCard label="Distributed Equity IRR" value={fmtPct(r.dividends.irr)} sub={`MOIC ${fmtX(r.dividends.moic)}`} tone={irrTone(r.dividends.irr)} tooltip="IRR based on actual cash distributions to equity investors (existing + new cash + in-kind contributions out, dividends + terminal equity in). With the terminal-year 100% payout this matches the Equity IRR (FCFE)." />
        <MetricCard label="Equity Multiple" value={fmtX(r.realEstate.equityMultiple)} sub="distributions / invested" />
        <MetricCard label="Total Equity Required" value={fmt(ee.totalEquityRequired)} sub="cash + in-kind + existing" />
      </MetricGrid>

      {/* ── Development Economics (absolute $ figures; margins / ratios are in
            the RE Metrics tab) ── */}
      <SectionTitle>Development Economics</SectionTitle>
      <MetricGrid min={155}>
        <MetricCard label="Total Development Cost" value={fmt(de.totalDevelopmentCost)} sub="incl. land" />
        <MetricCard label="Total Financing Cost" value={fmt(de.totalFinancingCost)} sub="all interest over the hold" tooltip="Total interest accrued over the whole hold (lifetime finance cost), construction + operations, whether paid in cash or capitalised. The construction portion capitalised to the asset is shown separately in Sources & Uses as 'IDC Capitalized During Construction'." />
        <MetricCard label="Profit Before Financing" value={fmt(de.profitBeforeFinancing)} sub="GDV − dev cost" tone={de.profitBeforeFinancing >= 0 ? 'good' : 'bad'} />
        <MetricCard label="Profit After Financing" value={fmt(de.profitAfterFinancing)} sub="− financing cost" tone={de.profitAfterFinancing >= 0 ? 'good' : 'bad'} />
      </MetricGrid>

      {/* ── Exit Analysis (exit-year income + debt; exit ratios — LTV / Debt
            Yield / Cap Rate — are in the RE Metrics tab) ── */}
      <SectionTitle>Exit Analysis (exit {ex.exitYearLabel})</SectionTitle>
      <MetricGrid min={150}>
        <MetricCard label="Exit NOI" value={fmt(ex.exitNOI)} sub={currency} />
        <MetricCard label="Exit EBITDA" value={fmt(ex.exitEBITDA)} sub={currency} />
        <MetricCard label="Debt at Exit" value={fmt(ex.exitDebt)} sub={currency} />
      </MetricGrid>

      {/* ── Sources & Uses ── */}
      <SectionTitle>Sources &amp; Uses of Capital</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
        <SourcesUsesTable
          title="Sources"
          rows={[
            ['Existing Equity', su.existingEquity],
            ['New Equity (cash)', su.newEquityCash],
            ['In-Kind Equity (land)', su.inKindEquity],
            ['Existing Debt', su.existingDebt],
            ['New Debt (incl. capitalised IDC)', su.newDebt],
            ['Customer Collections / Pre-Sales', su.customerCollections],
            ['Operating Cash Generated', su.operatingCash],
          ]}
          total={su.totalSources}
          fmt={fmt}
        />
        <SourcesUsesTable
          title="Uses"
          rows={[
            ['Land', su.land],
            ['Construction & Infrastructure', su.construction],
            ['IDC Capitalized During Construction', su.idc],
            ['Reserves / Distributions', su.reservesDistributions],
          ]}
          total={su.totalUses}
          fmt={fmt}
        />
      </div>

      {/* ── Funding Mix (capital structure) ── */}
      <SectionTitle>Funding Mix</SectionTitle>
      <MetricGrid min={150}>
        <MetricCard label="Debt" value={fmtPct(fm.debtPct)} sub="% of total sources" />
        <MetricCard label="Cash Equity" value={fmtPct(fm.cashEquityPct)} sub="existing + new cash" />
        <MetricCard label="In-Kind Equity" value={fmtPct(fm.inKindEquityPct)} sub="contributed land" />
        <MetricCard label="Customer Funding" value={fmtPct(fm.customerFundingPct)} sub="pre-sales collections" />
      </MetricGrid>

      {/* ── Equity Exposure ── */}
      <SectionTitle>Equity Exposure</SectionTitle>
      <MetricGrid min={155}>
        <MetricCard label="Total Equity Required" value={fmt(ee.totalEquityRequired)} sub="cash + in-kind + existing" />
        <MetricCard label="Average Equity Invested" value={fmt(ee.averageEquityInvested)} sub="mean while committed" />
        <MetricCard label="Equity at Risk" value={fmt(ee.equityAtRisk)} sub="peak cumulative equity" tooltip="Equity at Risk = the maximum cumulative equity invested at any point — the deepest the sponsor is in before distributions begin to return capital." />
        <MetricCard label="Max Negative Cash Flow" value={fmt(ee.maxNegativeCumulativeCF)} sub="peak FCFE outflow" tone="bad" />
        <MetricCard label="First Positive CF Year" value={ee.firstPositiveCFYear !== null ? String(ee.firstPositiveCFYear) : 'n/a'} sub="FCFE turns positive" />
        <MetricCard label="First Dividend Year" value={ee.firstDividendYear !== null ? String(ee.firstDividendYear) : 'n/a'} sub="first distribution" />
      </MetricGrid>

      {/* ── Stabilization (income assets) ── */}
      {st.hasIncomeAssets && (
        <>
          <SectionTitle>Stabilization (income assets)</SectionTitle>
          <MetricGrid min={155}>
            <MetricCard label="Stabilised NOI" value={fmt(st.stabilisedNOI)} sub={currency} />
            <MetricCard label="Stabilised Yield on Cost" value={fmtPct(st.stabilisedYieldOnCost)} sub="NOI / total dev cost" tooltip="Yield on Cost = Stabilized NOI ÷ Total Development Cost — the going-in unlevered yield once the asset is stabilised." />
            <MetricCard label="Stabilization Year" value={st.stabilizationYear !== null ? String(st.stabilizationYear) : 'n/a'} sub="NOI ≥ 95% of stabilised" />
          </MetricGrid>
        </>
      )}

      {/* ── Debt Analytics ── */}
      <SectionTitle>Debt Analytics</SectionTitle>
      <MetricGrid min={155}>
        <MetricCard label="Peak Debt" value={fmt(da.peakDebt)} sub="max outstanding" />
        <MetricCard label="Average Debt Outstanding" value={fmt(da.averageDebtOutstanding)} sub="mean while drawn" />
        <MetricCard label="Remaining Debt at Exit" value={fmt(da.remainingDebtAtExit)} sub={currency} />
        <MetricCard label="Debt Paydown" value={fmtPct(da.paydownPct)} sub="(peak − exit) / peak" />
        <MetricCard label="Debt Tenor" value={fmtYears(da.tenorYears)} sub="first draw to repaid" />
      </MetricGrid>

      {/* Per-stream IRR / MOIC / profit table (NPV + Payback removed — Payback
          is in the KPI cards; NPV is not a primary real-estate metric). */}
      <section style={{ marginBottom: 'var(--sp-3)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', marginBottom: 'var(--sp-1)' }}>
          Returns by Cash-Flow Basis
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
            <thead>
              <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Basis</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>IRR</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>MOIC</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Invested</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Returned</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Net Profit</th>
              </tr>
            </thead>
            <tbody>
              {streamSummary.map(({ key, label, s }) => (
                <tr key={key} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>{label}</td>
                  <td style={{ textAlign: 'right', padding: '6px 10px' }}>{fmtPct(s.irr)}</td>
                  <td style={{ textAlign: 'right', padding: '6px 10px' }}>{fmtX(s.moic)}</td>
                  <td style={{ textAlign: 'right', padding: '6px 10px' }}>{fmt(s.totalOutflow)}</td>
                  <td style={{ textAlign: 'right', padding: '6px 10px' }}>{fmt(s.totalInflow)}</td>
                  <td style={{ textAlign: 'right', padding: '6px 10px', fontWeight: 600 }}>{fmt(s.netProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-period signed cash-flow streams */}
      <M4PeriodTable
        title={`Return Cash-Flow Streams (hold to ${rs.exitYearLabel})`}
        caption="Signed cash flows: negative = invested, positive = returned. Terminal value is included in the exit-year FCFF (enterprise) and FCFE / Distributed Equity (equity) cells. NOI is the recurring hospitality + lease income net of operating cost."
        yearLabels={axisLabels}
        rows={streamRows}
        currency={currency}
        fmt={fmt}
        priorYearLabel={inceptionLabel}
      />

      {/* Step-by-step build-ups so the derivation is transparent */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', margin: 'var(--sp-3) 0 var(--sp-1)' }}>
        Step-by-Step Build-Up
      </div>
      <M4PeriodTable
        title="FCFF Build-Up (unlevered, to all capital providers)"
        caption="Free Cash Flow to Firm = Cash from Operations + Cash from Investing (capex) less in-kind land contributed, plus the terminal enterprise value at exit. Pre-financing: interest and debt are excluded."
        yearLabels={axisLabels}
        rows={fcffBuildupRows}
        currency={currency}
        fmt={fmt}
        priorYearLabel={inceptionLabel}
      />
      <M4PeriodTable
        title="FCFE Build-Up (levered, free cash to equity)"
        caption="Free Cash Flow to Equity = existing equity investment (at inception) + project cash (Operations + Investing) − in-kind equity + debt drawdown − principal repayment − interest paid + terminal equity value at exit. The NEGATIVE periods are the NEW cash equity the sponsor must inject; in-kind + existing equity are shown explicitly. Distributed Equity (below) shows all three equity contributions side-by-side with the distributions."
        yearLabels={axisLabels}
        rows={fcfeBuildupRows}
        currency={currency}
        fmt={fmt}
        priorYearLabel={inceptionLabel}
      />
      <M4PeriodTable
        title="Distributed Equity Build-Up (realized distributions)"
        caption="Realized equity cash = dividends actually distributed by the cash-sweep waterfall, less the equity invested (existing + new cash + in-kind), plus the terminal equity value at exit. This is the basis for the Distributed Equity IRR. Dividends are sized in the Financial Statements (Cash Sweep + Dividend policy), not in the funding gap."
        yearLabels={axisLabels}
        rows={dividendBuildupRows}
        currency={currency}
        fmt={fmt}
        priorYearLabel={inceptionLabel}
      />
    </div>
  );
}

/** Section heading used between the KPI grids. */
function SectionTitle(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', margin: 'var(--sp-2) 0 var(--sp-1)' }}>
      {props.children}
    </div>
  );
}

/** Sources / Uses ledger: labelled rows + a bold total. */
function SourcesUsesTable(props: {
  title: string;
  rows: Array<[string, number]>;
  total: number;
  fmt: (n: number) => string;
}): React.JSX.Element {
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 10px)', overflow: 'hidden' }}>
      <div style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)', padding: '6px 10px', fontWeight: 700, fontSize: 12 }}>
        {props.title}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <tbody>
          {props.rows.map(([label, value], i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td style={{ textAlign: 'left', padding: '5px 10px', color: 'var(--color-heading)' }}>{label}</td>
              <td style={{ textAlign: 'right', padding: '5px 10px' }}>{props.fmt(value)}</td>
            </tr>
          ))}
          <tr style={{ background: 'var(--color-grey-pale, #f3f4f6)' }}>
            <td style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 800, color: 'var(--color-heading)' }}>Total {props.title}</td>
            <td style={{ textAlign: 'right', padding: '6px 10px', fontWeight: 800, color: 'var(--color-heading)' }}>{props.fmt(props.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
