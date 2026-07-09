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
import React, { useMemo, useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { listParties } from '../../lib/persistence/client';
import { isEquityParty, type Party } from '../../lib/parties';
import { computeFinancialsSnapshot, type ProjectFinancialsSnapshot } from '../../lib/financials-resolvers';
import { computeReturnsSnapshot, computeReturnsSensitivity } from '../../lib/returns-resolvers';
import type { SensitivityVariable } from '@/src/core/calculations/returns';
import { currencyHeaderLine, formatScaledForExport, SCALE_DIVISOR, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import { M4PeriodTable, type M4Row } from './_shared/m4Table';
import { MetricCard, MetricGrid, AssumptionsPanel, fmtPct, fmtX, type AssumptionsValue } from './Module5Shared';
import { FAST_INPUT } from './_shared/inputStyles';
import type { ProjectPartner } from '../../lib/state/module1-types';
import { useEntitlements } from '../../lib/useEntitlements';
import UpgradePrompt from '@/src/shared/components/UpgradePrompt';

export default function Module5Returns({ activeProjectId = null }: { activeProjectId?: string | null } = {}): React.JSX.Element {
  // Module 1 Parties carrying an equity role, offered as the source for equity
  // partner identity. Identity only, never feeds the returns math.
  const [equityParties, setEquityParties] = useState<Party[]>([]);
  useEffect(() => {
    let alive = true;
    if (!activeProjectId) { setEquityParties([]); return; }
    void listParties(activeProjectId).then(({ data }) => {
      if (alive && data) setEquityParties(data.parties.filter((p) => isEquityParty(p.roles)));
    });
    return () => { alive = false; };
  }, [activeProjectId]);

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
  // Development economics + sources/uses render here. The detailed analytics
  // blocks (exitAnalysis / exitYears / fundingMix / equityExposure /
  // stabilization / debtAnalytics) moved to the RE Metrics tab; their data
  // stays on rs (computed in returns-resolvers) for that surface to consume.
  const de = rs.developmentEconomics;
  const su = rs.sourcesUses;

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
        (IRR on the actual cash distributions to equity investors). Terminal value is added in the exit year per the assumptions below. NPV is intentionally omitted; IRR / MOIC plus a tight Development Economics are the focus. Exit-year, funding-mix and equity-exposure analytics live on the RE Metrics tab.
      </p>

      <AssumptionsPanel value={assumptions} yearLabels={rs.yearLabels} onChange={onAssumptions} />

      {/* ── Headline returns: IRR + MOIC by basis (the primary tiles). ── */}
      <MetricGrid min={155}>
        <MetricCard label="Project IRR (FCFF)" value={fmtPct(r.fcff.irr)} sub={`MOIC ${fmtX(r.fcff.moic)}`} tone={irrTone(r.fcff.irr)} />
        <MetricCard label="Equity IRR (FCFE)" value={fmtPct(r.fcfe.irr)} sub={`MOIC ${fmtX(r.fcfe.moic)}`} tone={irrTone(r.fcfe.irr)} />
        <MetricCard label="Distributed Equity IRR" value={fmtPct(r.dividends.irr)} sub={`MOIC ${fmtX(r.dividends.moic)}`} tone={irrTone(r.dividends.irr)} tooltip="IRR based on actual cash distributions to equity investors (existing + new cash + in-kind contributions out, dividends + terminal equity in). With the terminal-year 100% payout this matches the Equity IRR (FCFE)." />
        <MetricCard label="Equity Multiple" value={fmtX(r.realEstate.equityMultiple)} sub="distributions / invested" />
      </MetricGrid>

      {/* ── Development Economics (tight, on top): the decision-useful $ + margin.
            Detailed analytics moved to the RE Metrics tab. ── */}
      <SectionTitle>Development Economics</SectionTitle>
      <MetricGrid min={155}>
        <MetricCard label="Total Development Cost" value={fmt(de.totalDevelopmentCost)} sub="incl. land" />
        <MetricCard label="Total Financing Cost" value={fmt(de.totalFinancingCost)} sub="all interest over the hold" tooltip="Total interest accrued over the whole hold (lifetime finance cost), construction + operations, whether paid in cash or capitalised. The construction portion capitalised to the asset is shown separately in Sources & Uses as 'IDC Capitalized During Construction'." />
        <MetricCard label="Profit Before Financing" value={fmt(de.profitBeforeFinancing)} sub="GDV − dev cost" tone={de.profitBeforeFinancing >= 0 ? 'good' : 'bad'} />
        <MetricCard label="Profit After Financing" value={fmt(de.profitAfterFinancing)} sub="− financing cost" tone={de.profitAfterFinancing >= 0 ? 'good' : 'bad'} />
        <MetricCard label="Development Margin" value={fmtPct(de.developmentMargin)} sub="profit / GDV" tone={de.developmentMargin == null ? 'neutral' : de.developmentMargin >= 0 ? 'good' : 'bad'} />
      </MetricGrid>

      {/* ── Equity Partners ── */}
      <PartnersSection
        partners={project.partners ?? []}
        equityParties={equityParties}
        snapshot={rs.partners}
        streamPriorLabel={inceptionLabel}
        streamAxisLabels={axisLabels}
        consolidatedFcfeIrr={r.fcfe.irr}
        consolidatedDdmIrr={r.dividends.irr}
        fmt={fmt}
        scale={scale}
        decimals={decimals}
        currency={currency}
        onChange={(next) => state.setProject({ partners: next })}
      />

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

      {/* ── Two-way Sensitivity (Equity IRR), moved to the bottom of the tab. ── */}
      <SensitivitySection snap={snap} project={project} />
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
  const ent = useEntitlements();
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

  // Sensitivity is a gated feature. While the gate loads we show the grid (no
  // flash of lock); once loaded, a non-entitled user sees the upgrade prompt.
  if (ent.loaded && !ent.canAccess('sensitivity')) {
    return (
      <section style={{ marginBottom: 'var(--sp-3)' }} data-testid="sensitivity-locked">
        <SectionTitle>Sensitivity, Equity IRR (FCFE)</SectionTitle>
        <UpgradePrompt
          featureKey="sensitivity"
          requiredPlan="professional"
          variant="card"
          message="Sensitivity Analysis is not included in your current plan. Upgrade to unlock the two-way IRR sensitivity grid."
        />
      </section>
    );
  }

  return (
    <section style={{ marginBottom: 'var(--sp-3)' }} data-testid="sensitivity-grid">
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
  equityParties: Party[];
  snapshot: import('@/src/core/calculations/returns').PartnersSnapshot;
  streamPriorLabel: number;
  streamAxisLabels: number[];
  consolidatedFcfeIrr: number | null;
  consolidatedDdmIrr: number | null;
  fmt: (n: number) => string;
  scale: DisplayScale;
  decimals: DisplayDecimals;
  currency: string;
  onChange: (next: ProjectPartner[]) => void;
}): React.JSX.Element {
  const { partners, equityParties, snapshot, streamPriorLabel, streamAxisLabels, consolidatedFcfeIrr, consolidatedDdmIrr, fmt, scale, decimals, onChange } = props;
  const rows = snapshot.partners;

  // Equity broken out BY TYPE. Each type carries its project total (from
  // financing) and partners hold a PERCENTAGE share of it. The shares across
  // partners always sum to 100, so the amounts always reconcile to the total.
  type EqKey = 'cash' | 'inKind' | 'existing';
  const PCT_FIELD: Record<EqKey, 'cashPct' | 'inKindPct' | 'existingPct'> = {
    cash: 'cashPct', inKind: 'inKindPct', existing: 'existingPct',
  };
  const equityTypes: Array<{ key: EqKey; label: string; total: number }> = [
    { key: 'cash',     label: 'New Cash Equity',        total: snapshot.totalCash },
    { key: 'inKind',   label: 'In-Kind Equity (land)',  total: snapshot.totalInKind },
    { key: 'existing', label: 'Existing Equity',        total: snapshot.totalExisting },
  ];

  // Default to one Sponsor holding 100% of every type (matches the engine's
  // synthesized default); the first edit / add materializes real partners.
  const effectivePartners: ProjectPartner[] = partners.length
    ? partners
    : [{ id: 'sponsor', name: 'Sponsor', cashPct: 100, inKindPct: 100, existingPct: 100 }];

  const pctOf = (p: ProjectPartner, key: EqKey): number => {
    const v = p[PCT_FIELD[key]];
    return Number.isFinite(v) ? (v as number) : 0;
  };
  const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

  // Re-balance one equity type so the shares across partners always sum to
  // 100: the edited partner takes newPct, the remainder is spread over the
  // others in proportion to their current shares (equally when they are all
  // zero). This is what makes the split fully flexible, change any amount or
  // %, and the others auto-adjust to keep the project total intact.
  const rebalance = (list: ProjectPartner[], key: EqKey, editedId: string, newPctRaw: number): ProjectPartner[] => {
    const field = PCT_FIELD[key];
    const newPct = Math.max(0, Math.min(100, newPctRaw));
    const others = list.filter((p) => p.id !== editedId);
    const remaining = 100 - newPct;
    const sumOthers = others.reduce((s, p) => s + pctOf(p, key), 0);
    return list.map((p) => {
      if (p.id === editedId) return { ...p, [field]: round4(newPct) };
      let v: number;
      if (others.length === 0) v = 0;
      else if (sumOthers > 1e-9) v = (pctOf(p, key) / sumOthers) * remaining;
      else v = remaining / others.length;
      return { ...p, [field]: round4(v) };
    });
  };
  // Normalise a type's shares to sum to 100 across the list (after a remove).
  const normalise = (list: ProjectPartner[], key: EqKey): ProjectPartner[] => {
    if (list.length === 0) return list;
    const field = PCT_FIELD[key];
    const total = list.reduce((s, p) => s + pctOf(p, key), 0);
    return list.map((p) => ({ ...p, [field]: round4(total > 1e-9 ? (pctOf(p, key) / total) * 100 : 100 / list.length) }));
  };

  const setPct = (key: EqKey, id: string, pct: number): void =>
    onChange(rebalance(effectivePartners, key, id, pct));
  const setAmount = (key: EqKey, id: string, amount: number, total: number): void =>
    onChange(rebalance(effectivePartners, key, id, total > 0 ? (amount / total) * 100 : 0));
  const setName = (id: string, name: string): void =>
    onChange(effectivePartners.map((p) => (p.id === id ? { ...p, name } : p)));
  // Link a partner to a Module 1 Party: record the partyId AND snapshot the
  // party's current name (the name then stays stable in the saved version even
  // if the party is later renamed or deleted). partyId is identity only; the
  // returns engine never reads it, so no number changes.
  const linkParty = (id: string, party: Party): void =>
    onChange(effectivePartners.map((p) => (p.id === id ? { ...p, partyId: party.id, name: party.name } : p)));
  // Unlink: drop the partyId, keep the current (snapshotted) name as free text.
  const unlinkParty = (id: string): void =>
    onChange(effectivePartners.map((p) => (p.id === id ? { ...p, partyId: undefined } : p)));
  // Agreed shareholding override (the negotiated final cap-table %). Setting it
  // stamps manualShareholdingPct (drives BOTH the FCFE and DDM splits); clearing
  // it reverts the partner to the computed weighted-average share.
  const setAgreedPct = (id: string, pct: number | null): void =>
    onChange(effectivePartners.map((p) => {
      if (p.id !== id) return p;
      if (pct === null) { const { manualShareholdingPct: _drop, ...rest } = p; return rest; }
      return { ...p, manualShareholdingPct: Math.max(0, Math.min(100, pct)) };
    }));
  const addPartner = (): void => {
    // Equal-split every type across the new roster (1 -> 100%, 2 -> 50/50,
    // 3 -> 33.33% ...), per the "auto divide" requirement.
    const added: ProjectPartner = { id: `p_${Date.now()}_${effectivePartners.length}`, name: `Partner ${effectivePartners.length + 1}` };
    const next = [...effectivePartners, added];
    const eq = round4(100 / next.length);
    onChange(next.map((p) => ({ ...p, cashPct: eq, inKindPct: eq, existingPct: eq })));
  };
  const remove = (id: string): void => {
    let next = effectivePartners.filter((p) => p.id !== id);
    for (const t of equityTypes) next = normalise(next, t.key);
    onChange(next);
  };

  const th: React.CSSProperties = { textAlign: 'right', padding: '5px 8px', fontSize: 11 };
  const thL: React.CSSProperties = { ...th, textAlign: 'left' };
  const td: React.CSSProperties = { textAlign: 'right', padding: '4px 8px', fontSize: 11, borderBottom: '1px solid var(--color-border)' };
  const tdL: React.CSSProperties = { ...td, textAlign: 'left' };

  // One partner cell per equity type: amount (top) + % (bottom), both editable
  // and linked (amount = % x project total). Editing either rebalances the
  // others.
  // Amounts display in the SAME scale + thousand-separator format as every
  // other figure on the surface (project.displayScale), so the editable cell
  // matches the "Project Total" column instead of showing a raw full-unit
  // integer. On edit we strip the formatting and rescale back to full units
  // before converting to a share %.
  const scaleDiv = SCALE_DIVISOR[scale];
  const fmtAmtInput = (full: number): string => formatScaledForExport(full, scale, decimals);
  const parseAmtInput = (raw: string): number => {
    const cleaned = raw.replace(/,/g, '').replace(/[()]/g, (m) => (m === '(' ? '-' : ''));
    const scaled = parseFloat(cleaned);
    return Number.isFinite(scaled) ? scaled * scaleDiv : 0;
  };
  const allocCell = (p: ProjectPartner, type: { key: EqKey; total: number }): React.JSX.Element => {
    const pct = pctOf(p, type.key);
    const amount = (type.total * pct) / 100;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'stretch' }}>
        <AmountInput
          amount={amount} disabled={type.total <= 0}
          fmt={fmtAmtInput} parse={parseAmtInput}
          onCommit={(full) => setAmount(type.key, p.id, full, type.total)}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <input
            type="number" value={round4(pct)}
            onChange={(e) => setPct(type.key, p.id, parseFloat(e.target.value) || 0)}
            style={{ ...FAST_INPUT, width: '100%', textAlign: 'right', fontSize: 10 }} title="Share %"
          />
          <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>%</span>
        </div>
      </div>
    );
  };

  // Partner identity control. When Module 1 Parties with an equity role exist,
  // the name is picked from a dropdown of those parties (which stores partyId +
  // snapshots the name). A "Custom name" option keeps the free-text input as a
  // fallback for unlinked / legacy partners. A partner linked to a party that
  // is no longer in the list (renamed / deleted) still shows its snapshotted
  // name via a synthetic option, so the saved version stays stable.
  const CUSTOM = '__custom__';
  const selectStyle: React.CSSProperties = {
    width: 128, fontSize: 11, padding: '3px 4px', borderRadius: 4,
    border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-heading)',
  };
  const partnerNameCell = (p: ProjectPartner): React.JSX.Element => {
    const linkedFound = p.partyId ? equityParties.find((x) => x.id === p.partyId) : undefined;
    const linkedMissing = !!p.partyId && !linkedFound;
    const selectValue = p.partyId ?? CUSTOM;
    const onSelect = (v: string): void => {
      if (v === CUSTOM) { unlinkParty(p.id); return; }
      const party = equityParties.find((x) => x.id === v);
      if (party) linkParty(p.id, party);
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
        {equityParties.length > 0 || p.partyId ? (
          <>
            <select value={selectValue} onChange={(e) => onSelect(e.target.value)} style={selectStyle} title="Link to a Module 1 Party (equity role) or keep a custom name">
              {equityParties.map((party) => (
                <option key={party.id} value={party.id}>{party.name}</option>
              ))}
              {linkedMissing && <option value={p.partyId}>{p.name} (unavailable)</option>}
              <option value={CUSTOM}>Custom name…</option>
            </select>
            {!p.partyId && (
              <input value={p.name} onChange={(e) => setName(p.id, e.target.value)} placeholder="Partner name" style={{ ...FAST_INPUT, width: 128, color: 'var(--color-heading)' }} />
            )}
          </>
        ) : (
          // No equity parties defined yet: plain free-text, same as before.
          <input value={p.name} onChange={(e) => setName(p.id, e.target.value)} style={{ ...FAST_INPUT, width: 128, color: 'var(--color-heading)' }} />
        )}
      </div>
    );
  };

  // Reconciliation chip on the AGREED shares (the driver): green when they sum
  // to 100%, amber with a signed delta otherwise.
  const agreedOk = snapshot.shareholdingReconciles;
  const agreedDelta = snapshot.shareholdingDelta; // decimal (sum - 1)
  const chipBg = agreedOk ? '#E7F6EC' : '#FEF3C7';
  const chipFg = agreedOk ? '#1A7A30' : '#92400E';
  const reconChip = <span style={{ fontWeight: 700, color: chipFg }}>{fmtPct(snapshot.shareholdingSum)}</span>;
  const reconChipRow = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--sp-2)' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: chipBg, color: chipFg, borderRadius: 999, padding: '4px 12px', fontSize: 11, fontWeight: 700 }}>
        {agreedOk ? '✓' : '⚠'} Agreed shares total {fmtPct(snapshot.shareholdingSum)}
        {!agreedOk && <span style={{ fontWeight: 600 }}>({agreedDelta >= 0 ? '+' : ''}{fmtPct(agreedDelta)} vs 100%)</span>}
      </span>
    </div>
  );

  // Side-by-side per-partner stream table: partners = columns, periods = rows,
  // IRR row at the bottom, Total column reconciling to the consolidated stream.
  const streamLabels = [streamPriorLabel, ...streamAxisLabels];
  const sideBySide = (
    title: string, caption: string,
    pick: (r: import('@/src/core/calculations/returns').PartnerResult) => number[],
    total: number[], irrOf: (r: import('@/src/core/calculations/returns').PartnerResult) => number | null, consolidatedIrr: number | null,
  ): React.JSX.Element => (
    <div style={{ overflowX: 'auto', marginBottom: 'var(--sp-2)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-heading)', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 10, color: 'var(--color-meta)', marginBottom: 6 }}>{caption}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
        <thead>
          <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
            <th style={thL}>Period</th>
            {rows.map((r) => <th key={r.id} style={th}>{r.name}</th>)}
            <th style={th}>Total</th>
          </tr>
        </thead>
        <tbody>
          {streamLabels.map((label, idx) => (
            <tr key={label + idx}>
              <td style={tdL}>{idx === 0 ? `${label} (inception)` : label}</td>
              {rows.map((r) => <td key={r.id} style={td}>{fmt(pick(r)[idx] ?? 0)}</td>)}
              <td style={{ ...td, fontWeight: 600 }}>{fmt(total[idx] ?? 0)}</td>
            </tr>
          ))}
          <tr style={{ background: 'var(--color-grey-pale, #f3f4f6)' }}>
            <td style={{ ...tdL, fontWeight: 800 }}>IRR</td>
            {rows.map((r) => <td key={r.id} style={{ ...td, fontWeight: 700 }}>{fmtPct(irrOf(r))}</td>)}
            <td style={{ ...td, fontWeight: 800 }}>{fmtPct(consolidatedIrr)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <section style={{ marginBottom: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--sp-1)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-heading)' }}>Equity Partners</div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 'var(--sp-1)' }}>
        Each equity type shows its project total split across partners as both an amount and a %, both editable. With one partner it holds 100%; adding a partner auto-divides equally (50% each for two, 33.33% for three). Change any amount or % and the others auto-adjust so each type always sums to its total. Shareholding (the dividend / terminal share) is each partner&apos;s total equity over the project total, and each partner&apos;s IRR is a yearly equity IRR on the same basis as the project FCFE / Distributed-Equity stream.
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
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, justifyContent: 'flex-end' }}>
                        {partnerNameCell(p)}
                        <button type="button" onClick={() => remove(p.id)} style={{ ...removeBtn, color: 'var(--color-on-primary-navy)' }} title="Remove partner" disabled={effectivePartners.length <= 1}>✕</button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {equityTypes.map((type) => (
                  <tr key={type.key}>
                    <td style={tdL}>{type.label}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{fmt(type.total)}</td>
                    {effectivePartners.map((p) => (
                      <td key={p.id} style={td}>{allocCell(p, type)}</td>
                    ))}
                  </tr>
                ))}
                <tr style={{ background: 'var(--color-grey-pale, #f3f4f6)' }}>
                  <td style={{ ...tdL, fontWeight: 800 }}>Total Invested</td>
                  <td style={{ ...td, fontWeight: 800 }}>{fmt(snapshot.totalProjectEquity)}</td>
                  {effectivePartners.map((p, i) => <td key={p.id} style={{ ...td, fontWeight: 700 }}>{fmt(rows[i]?.totalEquityInvested ?? 0)}</td>)}
                </tr>
                <tr>
                  <td style={tdL}>Weighted-Avg %</td>
                  <td style={td}>{fmtPct(snapshot.weightedAvgSum)}</td>
                  {effectivePartners.map((p, i) => (
                    <td key={p.id} style={{ ...td, color: 'var(--color-meta)' }} title="Time-weighted average capital balance (computed)">{fmtPct(rows[i]?.weightedAvgShareholdingPct ?? 0)}</td>
                  ))}
                </tr>
                <tr>
                  <td style={tdL}>Agreed % <span style={{ color: 'var(--color-meta)', fontWeight: 400 }}>(override)</span></td>
                  <td style={td}>{reconChip}</td>
                  {effectivePartners.map((p, i) => {
                    const wavg = round4((rows[i]?.weightedAvgShareholdingPct ?? 0) * 100);
                    const isManual = rows[i]?.shareholdingIsManual ?? false;
                    return (
                      <td key={p.id} style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>
                          <input
                            type="number" value={isManual ? round4((rows[i]?.shareholdingPct ?? 0) * 100) : ''}
                            placeholder={String(wavg)}
                            onChange={(e) => { const v = e.target.value; setAgreedPct(p.id, v === '' ? null : (parseFloat(v) || 0)); }}
                            style={{ ...FAST_INPUT, width: 56, textAlign: 'right', fontSize: 10 }}
                            title="Agreed cap-table share. Blank = use the computed weighted-average."
                          />
                          <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>%</span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          {reconChipRow}
          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <button type="button" onClick={addPartner} style={addBtnGhost}>+ Add Partner</button>
          </div>

          {/* Per-partner outputs: FCFE basis (headline) + DDM IRR. */}
          <div style={{ overflowX: 'auto', marginBottom: 'var(--sp-2)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
              <thead>
                <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
                  <th style={thL}>Partner</th>
                  <th style={th}>Invested</th>
                  <th style={th}>Agreed %</th>
                  <th style={th} title="FCFE-based internal rate of return">FCFE IRR</th>
                  <th style={th}>FCFE MOIC</th>
                  <th style={th}>FCFE Eq. Mult.</th>
                  <th style={th} title="Distributed-Equity (dividend) IRR">DDM IRR</th>
                  <th style={th}>Distributions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...tdL, fontWeight: 600 }}>{r.name}</td>
                    <td style={td}>{fmt(r.totalEquityInvested)}</td>
                    <td style={td}>{fmtPct(r.shareholdingPct)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{fmtPct(r.fcfeIrr)}</td>
                    <td style={td}>{fmtX(r.fcfeMoic)}</td>
                    <td style={td}>{fmtX(r.fcfeEquityMultiple)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{fmtPct(r.irr)}</td>
                    <td style={td}>{fmt(r.totalCashReturned)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Per-partner streams, both bases (partners = columns, periods = rows,
              IRR row at bottom, Total column reconciling to the consolidated). */}
          {sideBySide(
            'FCFE Streams by Partner',
            'Each partner’s agreed share of the consolidated FCFE (levered free cash flow) each period. Negative = capital in, positive = cash out. The Total column reconciles to the consolidated FCFE.',
            (r) => r.fcfeStream, snapshot.totalFcfeStream, (r) => r.fcfeIrr, consolidatedFcfeIrr,
          )}
          {sideBySide(
            'Distributed-Equity (DDM) Streams by Partner',
            'Each partner’s agreed share of dividends distributed (plus terminal equity at exit), less equity contributed at its timing. The Total column reconciles to the consolidated Distributed-Equity stream.',
            (r) => r.cashFlowStream, snapshot.totalStream, (r) => r.irr, consolidatedDdmIrr,
          )}
        </>
      )}
    </section>
  );
}

/**
 * Scale-aware currency input. Renders the value formatted (thousand
 * separators, project display scale) when idle, switches to a raw editable
 * buffer on focus so typing is never reformatted mid-keystroke, and commits
 * the parsed full-unit value on blur / Enter.
 */
function AmountInput(props: {
  amount: number;
  disabled: boolean;
  fmt: (full: number) => string;
  parse: (raw: string) => number;
  onCommit: (full: number) => void;
}): React.JSX.Element {
  const { amount, disabled, fmt, parse, onCommit } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    onCommit(parse(draft));
    setDraft(null);
  };
  return (
    <input
      type="text" inputMode="decimal" disabled={disabled}
      value={draft ?? fmt(amount)}
      onFocus={(e) => { setDraft(fmt(amount)); e.currentTarget.select(); }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      style={{ ...FAST_INPUT, width: '100%', textAlign: 'right' }} title="Amount"
    />
  );
}

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
