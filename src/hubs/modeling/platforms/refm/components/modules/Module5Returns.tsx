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
import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeFinancialsSnapshot, type ProjectFinancialsSnapshot } from '../../lib/financials-resolvers';
import { computeReturnsSnapshot, computeReturnsSensitivity } from '../../lib/returns-resolvers';
import type { SensitivityVariable } from '@/src/core/calculations/returns';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { M4PeriodTable, type M4Row } from './_shared/m4Table';
import { MetricCard, MetricGrid, AssumptionsPanel, fmtPct, fmtX, fmtYears, type AssumptionsValue } from './Module5Shared';
import { FAST_INPUT } from './_shared/inputStyles';
import type { ProjectPartner } from '../../lib/state/module1-types';

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
  // FCFE build-up, equity-centric. Existing equity = historical investment
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
        (IRR on the actual cash distributions to equity investors). Terminal value is added in the exit year per the assumptions below. NPV is intentionally omitted, IRR / MOIC / equity exposure / yield + exit metrics are the focus.
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

      {/* ── M5 Pass 2: Equity Partners ── */}
      <PartnersSection
        partners={project.partners ?? []}
        snapshot={rs.partners}
        streamPriorLabel={inceptionLabel}
        streamAxisLabels={axisLabels}
        fmt={fmt}
        currency={currency}
        onChange={(next) => state.setProject({ partners: next })}
      />

      {/* ── Development Economics (absolute $ figures; margins / ratios are in
            the RE Metrics tab) ── */}
      <SectionTitle>Development Economics</SectionTitle>
      <MetricGrid min={155}>
        <MetricCard label="Total Development Cost" value={fmt(de.totalDevelopmentCost)} sub="incl. land" />
        <MetricCard label="Total Financing Cost" value={fmt(de.totalFinancingCost)} sub="all interest over the hold" tooltip="Total interest accrued over the whole hold (lifetime finance cost), construction + operations, whether paid in cash or capitalised. The construction portion capitalised to the asset is shown separately in Sources & Uses as 'IDC Capitalized During Construction'." />
        <MetricCard label="Profit Before Financing" value={fmt(de.profitBeforeFinancing)} sub="GDV − dev cost" tone={de.profitBeforeFinancing >= 0 ? 'good' : 'bad'} />
        <MetricCard label="Profit After Financing" value={fmt(de.profitAfterFinancing)} sub="− financing cost" tone={de.profitAfterFinancing >= 0 ? 'good' : 'bad'} />
      </MetricGrid>

      {/* ── Exit Analysis (exit-year income + debt; exit ratios, LTV / Debt
            Yield / Cap Rate, are in the RE Metrics tab) ── */}
      <SectionTitle>Exit Analysis (exit {ex.exitYearLabel})</SectionTitle>
      <MetricGrid min={150}>
        <MetricCard label="Exit NOI" value={fmt(ex.exitNOI)} sub={currency} />
        <MetricCard label="Exit EBITDA" value={fmt(ex.exitEBITDA)} sub={currency} />
        <MetricCard label="Debt at Exit" value={fmt(ex.exitDebt)} sub={currency} />
      </MetricGrid>

      {/* ── M5 Pass 2: Exit-Year Analysis (hold vs sell timing) ── */}
      <SectionTitle>Exit-Year Analysis (hold vs sell timing)</SectionTitle>
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
        <MetricCard label="Equity at Risk" value={fmt(ee.equityAtRisk)} sub="peak cumulative equity" tooltip="Equity at Risk = the maximum cumulative equity invested at any point, the deepest the sponsor is in before distributions begin to return capital." />
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
            <MetricCard label="Stabilised Yield on Cost" value={fmtPct(st.stabilisedYieldOnCost)} sub="NOI / total dev cost" tooltip="Yield on Cost = Stabilized NOI ÷ Total Development Cost, the going-in unlevered yield once the asset is stabilised." />
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

      {/* ── M5 Pass 2: Two-way Sensitivity (Equity IRR) ── */}
      <SensitivitySection snap={snap} project={project} />

      {/* Per-stream IRR / MOIC / profit table (NPV + Payback removed, Payback
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

/** M5 Pass 2: two-way sensitivity grid on Equity IRR. */
const SENS_VARS: Array<{ v: SensitivityVariable; label: string; kind: 'rate' | 'shock' }> = [
  { v: 'exit_cap_rate', label: 'Exit Cap Rate', kind: 'rate' },
  { v: 'discount_rate', label: 'Discount Rate', kind: 'rate' },
  { v: 'sales_price_pct', label: 'Sales Price', kind: 'shock' },
  { v: 'adr_pct', label: 'ADR', kind: 'shock' },
  { v: 'construction_cost_pct', label: 'Construction Cost', kind: 'shock' },
];
function sensValueLabel(v: SensitivityVariable, x: number): string {
  const kind = SENS_VARS.find((s) => s.v === v)?.kind ?? 'shock';
  if (kind === 'rate') return `${(x * 100).toFixed(1)}%`;
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
}
function SensitivitySection(props: {
  snap: ProjectFinancialsSnapshot;
  project: import('../../lib/state/module1-types').Project;
}): React.JSX.Element {
  const [xVar, setXVar] = useState<SensitivityVariable>('exit_cap_rate');
  const [yVar, setYVar] = useState<SensitivityVariable>('sales_price_pct');
  const grid = useMemo(() => computeReturnsSensitivity(props.snap, props.project, xVar, yVar), [props.snap, props.project, xVar, yVar]);
  const irrPct = (v: number | null): string => (v === null || !Number.isFinite(v) ? 'n/a' : `${(v * 100).toFixed(1)}%`);
  // Heatmap: green when >= base equity IRR, amber when below.
  const base = grid.baseEquityIrr;
  const cellBg = (v: number | null): string => {
    if (v === null || base === null) return 'transparent';
    return v >= base ? 'var(--color-success-bg, #dcfce7)' : 'var(--color-warning-bg, #fef3c7)';
  };
  const sel: React.CSSProperties = { ...FAST_INPUT, cursor: 'pointer', width: 'auto' };
  const th: React.CSSProperties = { padding: '5px 8px', fontSize: 11, textAlign: 'right' };

  return (
    <section style={{ marginBottom: 'var(--sp-3)' }}>
      <SectionTitle>Sensitivity, Equity IRR (FCFE)</SectionTitle>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 'var(--sp-1)', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-heading)' }}>
          Columns:{' '}
          <select value={xVar} onChange={(e) => setXVar(e.target.value as SensitivityVariable)} style={sel}>
            {SENS_VARS.map((s) => <option key={s.v} value={s.v} disabled={s.v === yVar}>{s.label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-heading)' }}>
          Rows:{' '}
          <select value={yVar} onChange={(e) => setYVar(e.target.value as SensitivityVariable)} style={sel}>
            {SENS_VARS.map((s) => <option key={s.v} value={s.v} disabled={s.v === xVar}>{s.label}</option>)}
          </select>
        </label>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 'var(--sp-1)' }}>
        Equity IRR across combinations. Exit Cap Rate and Discount Rate are exact; Sales Price, ADR and Construction Cost are proportional cash-flow shocks (approximate, not a full re-forecast). Green = at or above the base-case Equity IRR ({irrPct(base)}).
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              <th style={{ ...th, textAlign: 'left' }}>{SENS_VARS.find((s) => s.v === yVar)?.label} \\ {SENS_VARS.find((s) => s.v === xVar)?.label}</th>
              {grid.xValues.map((xv, i) => <th key={i} style={th}>{sensValueLabel(xVar, xv)}</th>)}
            </tr>
          </thead>
          <tbody>
            {grid.yValues.map((yv, yi) => (
              <tr key={yi}>
                <td style={{ padding: '5px 8px', fontSize: 11, fontWeight: 700, background: 'var(--color-grey-pale, #f3f4f6)', color: 'var(--color-heading)' }}>{sensValueLabel(yVar, yv)}</td>
                {grid.xValues.map((_, xi) => (
                  <td key={xi} style={{ padding: '5px 10px', fontSize: 12, textAlign: 'right', borderBottom: '1px solid var(--color-border)', background: cellBg(grid.irr[yi][xi]) }}>
                    {irrPct(grid.irr[yi][xi])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** M5 Pass 2: equity-by-type allocation matrix + per-partner returns + streams. */
function PartnersSection(props: {
  partners: ProjectPartner[];
  snapshot: import('@/src/core/calculations/returns').PartnersSnapshot;
  streamPriorLabel: number;
  streamAxisLabels: number[];
  fmt: (n: number) => string;
  currency: string;
  onChange: (next: ProjectPartner[]) => void;
}): React.JSX.Element {
  const { partners, snapshot, streamPriorLabel, streamAxisLabels, fmt, onChange } = props;
  const rows = snapshot.partners;
  const manualMode = snapshot.manualMode;

  // Default to one Sponsor holding the project's full equity PER TYPE (matches
  // the engine's synthesized default); the first edit / add materializes it.
  const effectivePartners: ProjectPartner[] = partners.length
    ? partners
    : [{ id: 'sponsor', name: 'Sponsor', cashContribution: snapshot.totalCash, inKindContribution: snapshot.totalInKind, existingContribution: snapshot.totalExisting }];

  const update = (id: string, patch: Partial<ProjectPartner>): void =>
    onChange(effectivePartners.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const remove = (id: string): void => onChange(effectivePartners.filter((p) => p.id !== id));
  const addPartner = (): void =>
    onChange([...effectivePartners, { id: `p_${Date.now()}_${effectivePartners.length}`, name: `Partner ${effectivePartners.length + 1}`, cashContribution: 0, inKindContribution: 0, existingContribution: 0 }]);
  const setMode = (mode: 'auto' | 'manual'): void => {
    if (mode === 'manual') onChange(effectivePartners.map((p, i) => ({ ...p, manualShareholdingPct: Number(((rows[i]?.shareholdingPct ?? 0) * 100).toFixed(4)) })));
    else onChange(effectivePartners.map((p) => ({ ...p, manualShareholdingPct: undefined })));
  };

  const numCell = (v: number | undefined, onSet: (n: number) => void): React.JSX.Element => (
    <input type="number" value={Number.isFinite(v) ? v : 0} onChange={(e) => onSet(parseFloat(e.target.value) || 0)} style={{ ...FAST_INPUT, width: '100%', textAlign: 'right' }} />
  );
  const th: React.CSSProperties = { textAlign: 'right', padding: '5px 8px', fontSize: 11 };
  const thL: React.CSSProperties = { ...th, textAlign: 'left' };
  const td: React.CSSProperties = { textAlign: 'right', padding: '4px 8px', fontSize: 11, borderBottom: '1px solid var(--color-border)' };
  const tdL: React.CSSProperties = { ...td, textAlign: 'left' };

  const Chip = ({ ok, text }: { ok: boolean; text: string }): React.JSX.Element => (
    <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, marginRight: 8,
      color: ok ? 'var(--color-success, #166534)' : 'var(--color-warning, #92400e)',
      background: ok ? 'var(--color-success-bg, #dcfce7)' : 'var(--color-warning-bg, #fef3c7)' }}>
      {ok ? '✓ ' : '⚠ '}{text}
    </span>
  );

  // Equity broken out BY TYPE (rows). Each type carries its project total and
  // is allocated across partners (columns); each row must reconcile.
  type EqKey = 'cashContribution' | 'inKindContribution' | 'existingContribution';
  const equityTypes: Array<{ key: EqKey; label: string; total: number; allocated: number; ok: boolean }> = [
    { key: 'cashContribution', label: 'New Cash Equity', total: snapshot.totalCash, allocated: snapshot.allocatedCash, ok: snapshot.cashReconciles },
    { key: 'inKindContribution', label: 'In-Kind Equity (land)', total: snapshot.totalInKind, allocated: snapshot.allocatedInKind, ok: snapshot.inKindReconciles },
    { key: 'existingContribution', label: 'Existing Equity', total: snapshot.totalExisting, allocated: snapshot.allocatedExisting, ok: snapshot.existingReconciles },
  ];

  return (
    <section style={{ marginBottom: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--sp-1)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)' }}>Equity Partners</div>
        <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
          <button type="button" onClick={() => setMode('auto')} style={pillStyle(!manualMode)}>Auto %</button>
          <button type="button" onClick={() => setMode('manual')} style={pillStyle(manualMode)}>Manual %</button>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 'var(--sp-1)' }}>
        Equity is shown by type with its project total; allocate each type across partners so every row reconciles. Shareholding auto-computes from total contribution (or switch to Manual %). Each partner&apos;s IRR is a yearly equity IRR (contributions timed as they occur, dividends + terminal by shareholding), the same basis as the project FCFE / Distributed-Equity stream.
      </div>

      {(
        <>
          {/* Equity allocation matrix: types (rows) x partners (columns). */}
          <div style={{ overflowX: 'auto', marginBottom: 'var(--sp-1)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                  <th style={thL}>Equity Type</th>
                  <th style={th}>Project Total</th>
                  {effectivePartners.map((p) => (
                    <th key={p.id} style={th}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                        <input value={p.name} onChange={(e) => update(p.id, { name: e.target.value })} style={{ ...FAST_INPUT, width: 100, color: 'var(--color-heading)' }} />
                        <button type="button" onClick={() => remove(p.id)} style={{ ...removeBtn, color: 'var(--color-on-primary-navy)' }} title="Remove partner">✕</button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {equityTypes.map((type) => (
                  <tr key={type.key}>
                    <td style={tdL}>{type.label}</td>
                    <td style={{ ...td, color: type.ok ? 'var(--color-heading)' : 'var(--color-warning, #92400e)', fontWeight: 600 }}>
                      {fmt(type.total)}{type.ok ? '' : ' ⚠'}
                    </td>
                    {effectivePartners.map((p) => (
                      <td key={p.id} style={td}>{numCell(p[type.key], (n) => update(p.id, { [type.key]: n } as Partial<ProjectPartner>))}</td>
                    ))}
                  </tr>
                ))}
                <tr style={{ background: 'var(--color-grey-pale, #f3f4f6)' }}>
                  <td style={{ ...tdL, fontWeight: 800 }}>Total Invested</td>
                  <td style={{ ...td, fontWeight: 800 }}>{fmt(snapshot.totalProjectEquity)}</td>
                  {effectivePartners.map((p, i) => <td key={p.id} style={{ ...td, fontWeight: 700 }}>{fmt(rows[i]?.totalEquityInvested ?? 0)}</td>)}
                </tr>
                <tr>
                  <td style={tdL}>Shareholding %</td>
                  <td style={td}>{fmtPct(snapshot.shareholdingSum)}</td>
                  {effectivePartners.map((p, i) => (
                    <td key={p.id} style={td}>
                      {manualMode ? numCell(p.manualShareholdingPct, (n) => update(p.id, { manualShareholdingPct: n })) : fmtPct(rows[i]?.shareholdingPct ?? 0)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <button type="button" onClick={addPartner} style={addBtnGhost}>+ Add Partner</button>{' '}
            {equityTypes.map((type) => (
              <Chip key={type.key} ok={type.ok} text={`${type.label}: ${fmt(type.allocated)} / ${fmt(type.total)}`} />
            ))}
            <Chip ok={snapshot.shareholdingReconciles} text={`Shareholding ${fmtPct(snapshot.shareholdingSum)}`} />
          </div>

          {/* Per-partner outputs */}
          <div style={{ overflowX: 'auto', marginBottom: 'var(--sp-2)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
              <thead>
                <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                  <th style={thL}>Partner</th>
                  <th style={th}>Invested</th>
                  <th style={th}>Share %</th>
                  <th style={th}>Dividends</th>
                  <th style={th}>Terminal</th>
                  <th style={th}>Returned</th>
                  <th style={th}>IRR</th>
                  <th style={th}>MOIC</th>
                  <th style={th}>Equity Mult.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...tdL, fontWeight: 600 }}>{r.name}</td>
                    <td style={td}>{fmt(r.totalEquityInvested)}</td>
                    <td style={td}>{fmtPct(r.shareholdingPct)}</td>
                    <td style={td}>{fmt(r.dividendsReceived)}</td>
                    <td style={td}>{fmt(r.terminalDistribution)}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{fmt(r.totalCashReturned)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{fmtPct(r.irr)}</td>
                    <td style={td}>{fmtX(r.moic)}</td>
                    <td style={td}>{fmtX(r.equityMultiple)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Per-partner cash-flow streams */}
          <M4PeriodTable
            title="Partner Cash-Flow Streams"
            caption="Signed cash flows by shareholding: inception = −equity contributed (prior column), each period = dividend share, exit adds the terminal equity share. The Total column is each partner's lifetime net; the Total row sums all partners (ties to the project Distributed Equity stream over the hold)."
            yearLabels={streamAxisLabels}
            rows={[
              ...rows.map((r) => ({ label: r.name, values: r.cashFlowStream.slice(1), priorValue: r.cashFlowStream[0] ?? 0, totalOverride: fmt(r.cashFlowStream.reduce((s, v) => s + (v ?? 0), 0)) } as M4Row)),
              { label: 'Total (all partners)', values: snapshot.totalStream.slice(1), priorValue: snapshot.totalStream[0] ?? 0, totalOverride: fmt(snapshot.totalStream.reduce((s, v) => s + (v ?? 0), 0)), isTotal: true } as M4Row,
            ]}
            currency={props.currency}
            fmt={fmt}
            priorYearLabel={streamPriorLabel}
          />
        </>
      )}
    </section>
  );
}

const pillBase: React.CSSProperties = { border: '1px solid var(--color-border)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontWeight: 600 };
const pillStyle = (active: boolean): React.CSSProperties => ({ ...pillBase, background: active ? 'var(--color-navy)' : 'var(--color-surface)', color: active ? 'var(--color-on-primary-navy)' : 'var(--color-heading)' });
const addBtnGhost: React.CSSProperties = { border: '1px solid var(--color-navy)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: 'transparent', color: 'var(--color-navy)' };
const removeBtn: React.CSSProperties = { border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-muted)', fontSize: 13 };

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
