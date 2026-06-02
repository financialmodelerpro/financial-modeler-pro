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
    toRow('Dividends, realised equity', rs.dividendStreamPerPeriod, { isSubtotal: true }),
    toRow('Memo: NOI (recurring)', noiStream, { indent: 1 }),
  ];

  // Per-stream summary table.
  const streamSummary: Array<{ key: string; label: string; s: typeof r.fcff }> = [
    { key: 'fcff', label: 'FCFF (unlevered project)', s: r.fcff },
    { key: 'fcfe', label: 'FCFE (levered equity)', s: r.fcfe },
    { key: 'dividends', label: 'Dividends (realised equity)', s: r.dividends },
  ];

  const irrTone = (irr: number | null) => (irr === null ? 'neutral' : irr >= cfg.discountRate ? 'good' : 'bad');

  // Step-by-step build-up rows (so the derivation is transparent).
  const b = rs.buildup;
  const fcffBuildupRows: M4Row[] = [
    toRow('(-) Existing Pre-Capex (at inception)', b.existingPreCapexPerPeriod, { indent: 1 }),
    toRow('(+) Cash from Operations', b.cfoPerPeriod, { indent: 1 }),
    toRow('(+) Cash from Investing (new capex)', b.cfiPerPeriod, { indent: 1 }),
    toRow('(+) Terminal Enterprise Value', b.terminalEnterprisePerPeriod, { indent: 1 }),
    toRow('= FCFF (unlevered project)', rs.fcffPerPeriod, { isTotal: true }),
  ];
  const fcfeBuildupRows: M4Row[] = [
    toRow('(-) Existing Pre-Capex (at inception)', b.existingPreCapexPerPeriod, { indent: 1 }),
    toRow('(+) Existing Debt Opening (drawdown at inception)', b.existingDebtOpeningPerPeriod, { indent: 1 }),
    toRow('(+) Cash from Operations', b.cfoPerPeriod, { indent: 1 }),
    toRow('(+) Cash from Investing (new capex)', b.cfiPerPeriod, { indent: 1 }),
    toRow('(-) In-kind Land Contribution', b.inKindLandPerPeriod, { indent: 1 }),
    toRow('(+) Debt Drawdown', b.debtDrawPerPeriod, { indent: 1 }),
    toRow('(-) Principal Repayment', b.principalRepayPerPeriod, { indent: 1 }),
    toRow('(-) Interest Paid', b.interestPaidPerPeriod, { indent: 1 }),
    toRow('(+) Terminal Equity Value', b.terminalEquityPerPeriod, { indent: 1 }),
    toRow('= FCFE (levered equity)', rs.fcfePerPeriod, { isTotal: true }),
  ];
  const dividendBuildupRows: M4Row[] = [
    toRow('(-) Existing Equity (at inception)', b.existingEquityPerPeriod, { indent: 1 }),
    toRow('(-) Cash Equity Contributed', b.equityCashPerPeriod, { indent: 1 }),
    toRow('(-) In-kind Equity Contributed', b.equityInKindPerPeriod, { indent: 1 }),
    toRow('(+) Dividends Distributed (cash-sweep waterfall)', b.dividendsDistributedPerPeriod, { indent: 1 }),
    toRow('(+) Terminal Equity Value', b.terminalEquityPerPeriod, { indent: 1 }),
    toRow('= Net Equity Cash Flow (dividend basis)', rs.dividendStreamPerPeriod, { isTotal: true }),
  ];

  return (
    <div data-testid="module5-returns" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <p style={{ color: 'var(--color-meta)', marginTop: 0, marginBottom: 'var(--sp-3)', fontSize: 'var(--font-small)' }}>
        Returns on three cash-flow bases: <strong>FCFF</strong> (unlevered, to all capital providers),{' '}
        <strong>FCFE</strong> (levered, free cash to equity after debt service), and <strong>Dividends</strong>{' '}
        (actually distributed equity cash). Terminal value is added in the exit year per the assumptions below.
      </p>

      <AssumptionsPanel value={assumptions} yearLabels={rs.yearLabels} onChange={onAssumptions} />

      {/* ── Headline returns (NPV moved to the per-basis table below) ── */}
      <MetricGrid min={155}>
        <MetricCard label="Project IRR (FCFF)" value={fmtPct(r.fcff.irr)} sub={`MOIC ${fmtX(r.fcff.moic)}`} tone={irrTone(r.fcff.irr)} />
        <MetricCard label="Equity IRR (FCFE)" value={fmtPct(r.fcfe.irr)} sub={`MOIC ${fmtX(r.fcfe.moic)}`} tone={irrTone(r.fcfe.irr)} />
        <MetricCard label="Dividend IRR" value={fmtPct(r.dividends.irr)} sub={`MOIC ${fmtX(r.dividends.moic)}`} tone={irrTone(r.dividends.irr)} />
        <MetricCard label="Equity Multiple" value={fmtX(r.realEstate.equityMultiple)} sub="distributions / invested" />
        <MetricCard label="Development Margin" value={fmtPct(de.developmentMargin)} sub="profit after financing / GDV" tone={(de.developmentMargin ?? 0) >= 0 ? 'good' : 'bad'} />
        <MetricCard label="Payback (FCFE)" value={fmtYears(r.fcfe.paybackPeriod)} sub="undiscounted" />
        <MetricCard label="Payback (FCFF)" value={fmtYears(r.fcff.paybackPeriod)} sub="undiscounted" />
        <MetricCard label="Total Equity Required" value={fmt(ee.totalEquityRequired)} sub="cash + in-kind + existing" />
      </MetricGrid>

      {/* ── Development Economics ── */}
      <SectionTitle>Development Economics</SectionTitle>
      <MetricGrid min={155}>
        <MetricCard label="GDV (Gross Dev Value)" value={fmt(de.gdv)} sub={currency} />
        <MetricCard label="Total Development Cost" value={fmt(de.totalDevelopmentCost)} sub="incl. land" />
        <MetricCard label="Total Financing Cost" value={fmt(de.totalFinancingCost)} sub="interest over the hold" />
        <MetricCard label="Profit Before Financing" value={fmt(de.profitBeforeFinancing)} sub="GDV − dev cost" tone={de.profitBeforeFinancing >= 0 ? 'good' : 'bad'} />
        <MetricCard label="Profit After Financing" value={fmt(de.profitAfterFinancing)} sub="− financing cost" tone={de.profitAfterFinancing >= 0 ? 'good' : 'bad'} />
        <MetricCard label="Development Margin" value={fmtPct(de.developmentMargin)} sub="profit / GDV" />
        <MetricCard label="Cost-to-Value" value={fmtPct(de.costToValue)} sub="dev cost / GDV" />
      </MetricGrid>

      {/* ── Exit Analysis ── */}
      <SectionTitle>Exit Analysis (exit {ex.exitYearLabel})</SectionTitle>
      <MetricGrid min={150}>
        <MetricCard label="Exit NOI" value={fmt(ex.exitNOI)} sub={currency} />
        <MetricCard label="Exit EBITDA" value={fmt(ex.exitEBITDA)} sub={currency} />
        <MetricCard label="Enterprise Value" value={fmt(ex.exitEnterpriseValue)} sub="at exit" />
        <MetricCard label="Equity Value" value={fmt(ex.exitEquityValue)} sub="EV − debt at exit" />
        <MetricCard label="Debt at Exit" value={fmt(ex.exitDebt)} sub={currency} />
        <MetricCard label="LTV at Exit" value={fmtPct(ex.ltvAtExit)} sub="debt / EV" />
        <MetricCard label="Debt Yield" value={fmtPct(ex.debtYield)} sub="NOI / debt" />
        <MetricCard label="Cap Rate at Exit" value={fmtPct(ex.capRate)} sub="NOI / EV" />
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
            ['Operating / Pre-Sales Cash', su.operatingCashFunding],
          ]}
          total={su.totalSources}
          fmt={fmt}
        />
        <SourcesUsesTable
          title="Uses"
          rows={[
            ['Land', su.land],
            ['Construction (non-land capex)', su.construction],
            ['Interest During Construction (IDC)', su.idc],
          ]}
          total={su.totalUses}
          fmt={fmt}
        />
      </div>

      {/* ── Equity Exposure ── */}
      <SectionTitle>Equity Exposure</SectionTitle>
      <MetricGrid min={155}>
        <MetricCard label="Total Equity Required" value={fmt(ee.totalEquityRequired)} sub="cash + in-kind + existing" />
        <MetricCard label="Average Equity Invested" value={fmt(ee.averageEquityInvested)} sub="mean while committed" />
        <MetricCard label="Equity at Risk" value={fmt(ee.equityAtRisk)} sub="peak cumulative equity" />
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
            <MetricCard label="Stabilised Yield on Cost" value={fmtPct(st.stabilisedYieldOnCost)} sub="NOI / total dev cost" />
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

      {/* Per-stream IRR / MOIC / NPV / Payback / profit table */}
      <section style={{ marginBottom: 'var(--sp-3)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)', marginBottom: 'var(--sp-1)' }}>
          Returns by Cash-Flow Basis
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
            <thead>
              <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Basis</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>IRR</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>MOIC</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>NPV</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Payback</th>
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
                  <td style={{ textAlign: 'right', padding: '6px 10px' }}>{fmt(s.npv)}</td>
                  <td style={{ textAlign: 'right', padding: '6px 10px' }}>{fmtYears(s.paybackPeriod)}</td>
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
        caption="Signed cash flows: negative = invested, positive = returned. Terminal value is included in the exit-year FCFF (enterprise) and FCFE / Dividends (equity) cells. NOI is the recurring hospitality + lease income net of operating cost."
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
        caption="Free Cash Flow to Equity = Unlevered Free Cash Flow plus debt drawdown, less principal repayment and interest paid, plus the terminal equity value (enterprise value less debt at exit) at exit. The negative periods are the equity required after debt service."
        yearLabels={axisLabels}
        rows={fcfeBuildupRows}
        currency={currency}
        fmt={fmt}
        priorYearLabel={inceptionLabel}
      />
      <M4PeriodTable
        title="Dividend Build-Up (realised equity cash)"
        caption="Realised equity cash = dividends actually distributed by the cash-sweep waterfall, less cash + in-kind equity contributed, plus the terminal equity value at exit. Dividends are sized in the Financial Statements (Cash Sweep + Dividend policy), not in the funding gap."
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
