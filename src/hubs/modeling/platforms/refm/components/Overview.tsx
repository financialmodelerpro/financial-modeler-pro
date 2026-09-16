'use client';

/**
 * Overview.tsx (2026-06-16, visual design pass 2026-06-16b)
 *
 * One-page INVESTOR SUMMARY of the single currently-open project. Distinct from
 * the Dashboard (the all-projects hub): Overview is only meaningful when a
 * project is open and reads the SAME snapshots every other module uses
 * (computeFinancialsSnapshot -> computeReturnsSnapshot). No engine changes.
 *
 * Visual hierarchy (top to bottom): header + glanceable health status line ->
 * a brand-navy HERO band of headline returns (the dominant element) -> brand-
 * accented grouped sections (Key Economics, Cost & Capital Structure with a
 * capital-structure donut, Timeline). Styling uses the existing design tokens
 * (navy / gold palette, kpi-card pattern, section labels), no ad-hoc colors.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { formatAccounting, currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { useModule1Store } from '../lib/state/module1-store';
import { computeFinancialsSnapshot } from '../lib/financials-resolvers';
import { computeReturnsSnapshot } from '../lib/returns-resolvers';
import { fundingChartPoints, type FundingYearPoint } from '../lib/portfolio/fundingSeries';
import { buildOverviewReport, type OverviewReport } from '../lib/reports/overviewReport';

interface OverviewProps {
  projectName: string | null;
  status?: string | null;
}

// ── Section label (matches .section-label token usage across the platform) ───
const sectionLabel: React.CSSProperties = {
  fontSize: 'var(--font-micro)', fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--color-meta)', margin: '0 0 var(--sp-2)',
  display: 'flex', alignItems: 'center', gap: 8,
};
const accentDot = (color: string): React.CSSProperties => ({ width: 8, height: 8, borderRadius: 2, background: color });

const th: React.CSSProperties = { padding: '8px 10px', fontSize: 'var(--font-micro)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '7px 10px', textAlign: 'right', color: 'var(--color-body)', whiteSpace: 'nowrap' };

const sectionGrid: React.CSSProperties = {
  display: 'grid', gap: 'var(--sp-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', marginBottom: 'var(--sp-3)',
};

// Brand-accented KPI card (reuses the .kpi-card design: 4px accent bar + body).
function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }): React.JSX.Element {
  return (
    <div className="kpi-card">
      <div className="kpi-card__accent" style={{ background: accent }} />
      <div className="kpi-card__body">
        <div className="kpi-card__label">{label}</div>
        <div className="kpi-card__value">{value}</div>
        {sub && <div className="kpi-card__sub">{sub}</div>}
      </div>
    </div>
  );
}

type ChipKind = 'ok' | 'warn' | 'err';
function Chip({ kind, label }: { kind: ChipKind; label: string }): React.JSX.Element {
  const c = {
    ok:   { bg: 'var(--color-green-light)',  fg: 'var(--color-green-dark)', icon: '✓' },
    warn: { bg: 'var(--color-gold-light)',   fg: 'var(--color-gold-dark)',  icon: '!' },
    err:  { bg: 'color-mix(in srgb, var(--color-negative) 12%, transparent)', fg: 'var(--color-negative)', icon: '✗' },
  }[kind];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-micro)', fontWeight: 600, padding: '5px 12px', borderRadius: 'var(--radius-pill)', background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>
      <span style={{ fontWeight: 800 }}>{c.icon}</span>{label}
    </span>
  );
}

export default function Overview({ projectName, status }: OverviewProps): React.JSX.Element {
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
  const project = state.project;
  const scale: DisplayScale = (project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (project.displayDecimals ?? 0) as DisplayDecimals;
  const currency = currencyHeaderLine(project.currency ?? 'SAR', scale);

  const money = (n: number | null | undefined): string =>
    n == null || !Number.isFinite(n) ? 'n/a' : formatAccounting(n, scale, decimals);
  const pct = (v: number | null | undefined): string =>
    v == null || !Number.isFinite(v) ? 'n/a' : `${(v * 100).toFixed(1)}%`;
  const mult = (v: number | null | undefined): string =>
    v == null || !Number.isFinite(v) ? 'n/a' : `${v.toFixed(2)}x`;
  /** An area or a count: never scaled, because 37,000 sqm is 37,000 sqm. */
  const area = (v: number | null | undefined): string =>
    v == null || !Number.isFinite(v) ? 'n/a' : Math.round(v).toLocaleString('en-US');
  /** A rate per sqm: full units, the way a developer quotes it. */
  const rate = (v: number | null | undefined): string =>
    v == null || !Number.isFinite(v) ? 'n/a' : Math.round(v).toLocaleString('en-US');

  const computed = useMemo(() => {
    try {
      const snap = computeFinancialsSnapshot(state as never);
      const rs = computeReturnsSnapshot(snap, project);
      return {
        rs,
        // EVERY FIGURE ON THIS PAGE COMES FROM ONE BUILDER (2026-09-16), so the
        // overview cannot hold a different definition of land, area or cost per
        // sqm from the tabs it summarises.
        ov: buildOverviewReport(snap, rs, state as never),
        // Funding by year comes from the SHARED rule, so this chart cannot hold
        // a different definition of the requirement than the Financing tab's
        // Funding Gap sub-tab and the portfolio tile do.
        funding: fundingChartPoints(snap),
      };
    } catch {
      return null;
    }
  }, [state, project]);
  const rs = computed?.rs ?? null;
  const ov: OverviewReport | null = computed?.ov ?? null;
  const funding: FundingYearPoint[] = computed?.funding ?? [];

  if (!rs || !ov) {
    return (
      <div style={{ padding: 'var(--sp-3)' }} data-testid="overview">
        <h1 style={{ fontSize: 'var(--font-h1)', fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>{projectName ?? 'Project'} overview</h1>
        <p style={{ color: 'var(--color-meta)', marginTop: 8 }}>The investor summary will appear once the model has enough inputs to compute returns.</p>
      </div>
    );
  }

  const re = rs.result.realEstate;
  const de = rs.developmentEconomics;
  const mix = rs.fundingMix;
  const su = rs.sourcesUses;
  const cashEquityPct = mix.cashEquityPct ?? 0;
  const inKindPct = mix.inKindEquityPct ?? 0;
  const debtPct = mix.debtPct ?? 0;
  const equityPct = cashEquityPct + inKindPct;
  const startYear = rs.yearLabels[0];
  const horizon = rs.yearLabels.length;

  // Capital-structure donut: debt / cash equity / in-kind, normalised to their
  // own sum (the capital stack, excluding customer collections).
  const stackSum = debtPct + cashEquityPct + inKindPct || 1;
  const seg = {
    debt: (debtPct / stackSum) * 100,
    cash: (cashEquityPct / stackSum) * 100,
    inkind: (inKindPct / stackSum) * 100,
  };
  const c1 = seg.debt, c2 = seg.debt + seg.cash;
  const donutBg = `conic-gradient(var(--color-navy) 0 ${c1}%, var(--color-gold) ${c1}% ${c2}%, var(--color-navy-mid) ${c2}% 100%)`;

  const chips: { kind: ChipKind; label: string }[] = [
    { kind: (de.profitAfterFinancing ?? 0) >= 0 ? 'ok' : 'err', label: `Profit after financing ${(de.profitAfterFinancing ?? 0) >= 0 ? 'positive' : 'negative'}` },
    { kind: (de.developmentMargin ?? 0) >= 0.15 ? 'ok' : (de.developmentMargin ?? 0) >= 0 ? 'warn' : 'err', label: `Margin ${pct(de.developmentMargin)}` },
  ];

  const heroItem = (label: string, value: string): React.JSX.Element => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 'var(--font-micro)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.66)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 800, color: '#fff', lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</div>
    </div>
  );

  // ── Funding requirement by year (this project only) ────────────────────────
  // Sits at the foot of Cost & capital structure, which is where it belongs:
  // that section already says how the capital splits (the donut) and what it
  // costs (the tiles), and this says WHEN it is needed, which is the question
  // Peak Equity right above it raises. Amounts are ON the bars, not on hover,
  // because a single project has room for them and this is a figure a reader
  // wants to quote rather than discover. The empty head and tail are already
  // trimmed by the shared rule; an interior empty year is kept.
  const fundingMax = funding.reduce((m, p) => Math.max(m, p.value), 0);
  const fundingChart = funding.length === 0 || fundingMax <= 0 ? null : (
    <div className="card" style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }} data-testid="overview-funding-chart">
      <div style={{ fontSize: 'var(--font-meta)', fontWeight: 700, color: 'var(--color-heading)', marginBottom: 2 }}>
        Funding requirement by year
      </div>
      <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)', marginBottom: 'var(--sp-2)' }}>
        Net cash this project must raise in each calendar year. Figures in {currency}.
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-2)', overflowX: 'auto', paddingBottom: 4 }}>
        {funding.map((p) => (
          <div key={p.year} style={{ flex: '1 1 0', minWidth: 62, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
            {/* The amount, shown rather than hidden behind a hover. money()
                prints the en-dash for a zero, so an empty interior year does
                not read as a currency figure of nothing. */}
            <div style={{ fontSize: 'var(--font-micro)', fontWeight: 700, color: 'var(--color-heading)', whiteSpace: 'nowrap' }}>
              {money(p.value)}
            </div>
            <div style={{ height: 132, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <div
                style={{
                  width: '100%',
                  // A funded year always draws something, so a small figure
                  // beside a large one is visible rather than a bare label.
                  height: p.value > 0 ? `${Math.max(3, (p.value / fundingMax) * 100)}%` : 0,
                  background: 'var(--color-navy)',
                  borderTop: p.value > 0 ? '3px solid var(--color-gold)' : undefined,
                  borderRadius: '2px 2px 0 0',
                }}
              />
            </div>
            <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)', whiteSpace: 'nowrap' }}>{p.year}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const legendRow = (color: string, label: string, value: string): React.JSX.Element => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--font-meta)' }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
      <span style={{ color: 'var(--color-body)', flex: 1 }}>{label}</span>
      <span style={{ fontWeight: 700, color: 'var(--color-heading)' }}>{value}</span>
    </div>
  );

  return (
    <div style={{ padding: 'var(--sp-3)', width: '100%' }} data-testid="overview">
      {/* ── Header + glanceable health status line ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 style={{ fontSize: 'var(--font-h1)', fontWeight: 700, color: 'var(--color-heading)', margin: 0, letterSpacing: '-0.02em' }}>
          {projectName ?? 'Project'}
        </h1>
        {status && <span style={{ fontSize: 'var(--font-micro)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-navy)', background: 'var(--color-navy-light)', padding: '3px 10px', borderRadius: 'var(--radius-pill)' }}>{status}</span>}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {chips.map((c, i) => <Chip key={i} kind={c.kind} label={c.label} />)}
        </div>
      </div>
      <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-meta)', marginTop: 0, marginBottom: 'var(--sp-3)' }}>
        Investor summary for the open project. Figures in {currency}; exit year {rs.exitYearLabel}.
      </p>

      {/* ── HERO: headline returns (dominant brand-navy band) ── */}
      <div
        style={{
          borderRadius: 'var(--radius-md)',
          background: 'linear-gradient(135deg, var(--color-navy-dark) 0%, var(--color-navy) 100%)',
          boxShadow: 'var(--shadow-2)',
          padding: 'var(--sp-3)',
          marginBottom: 'var(--sp-3)',
          borderTop: '3px solid var(--color-gold)',
        }}
        data-testid="overview-hero"
      >
        <div style={{ fontSize: 'var(--font-micro)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-gold)', marginBottom: 'var(--sp-2)' }}>
          Headline returns
        </div>
        <div style={{ display: 'grid', gap: 'var(--sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
          {ov.returns.map((r) => (
            <div key={r.key} style={{ minWidth: 0 }} data-testid={`overview-return-${r.key}`}>
              <div style={{ fontSize: 'var(--font-micro)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.66)', marginBottom: 6 }}>{r.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 34, fontWeight: 800, color: '#fff', lineHeight: 1, letterSpacing: '-0.02em' }}>{pct(r.irr)}</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-gold)', lineHeight: 1 }}>{mult(r.moic)}</span>
              </div>
              <div style={{ fontSize: 'var(--font-micro)', color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
                {r.preFeeIrr !== undefined
                  ? `IRR and MOIC after the performance fee; pre-fee ${pct(r.preFeeIrr)} and ${mult(r.preFeeMoic ?? null)}`
                  : 'IRR and MOIC'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── COST PER SQM (2026-09-16, founder: "the first number a developer
          quotes and it is nowhere today"), its own band rather than a tile in a
          group. Development cost is land and capex; construction excludes land. ── */}
      <div className="card" style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-3)', borderLeft: '4px solid var(--color-gold)' }} data-testid="overview-cost-per-sqm">
        <div style={{ ...sectionLabel, margin: '0 0 var(--sp-2)' }}><span style={accentDot('var(--color-gold)')} />Cost per sqm</div>
        <div style={{ display: 'grid', gap: 'var(--sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
          {[
            ['Development cost / GFA', ov.costPerSqm.developmentCostPerGfa, `${money(ov.costPerSqm.totalDevelopmentCost)} over ${area(ov.costPerSqm.gfaSqm)} sqm`],
            ['Construction cost / GFA', ov.costPerSqm.constructionCostPerGfa, 'excludes land'],
            ['Development cost / saleable', ov.costPerSqm.developmentCostPerSaleable, `over ${area(ov.costPerSqm.saleableSqm)} sqm`],
            ['Revenue / saleable', ov.costPerSqm.revenuePerSaleable, 'what it sells or lets for'],
          ].map(([label, value, sub]) => (
            <div key={String(label)} style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--font-micro)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-meta)', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--color-heading)', lineHeight: 1 }}>{rate(value as number | null)}</div>
              <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)', marginTop: 3 }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Key economics ── */}
      <div style={sectionLabel}><span style={accentDot('var(--color-navy)')} />Key economics</div>
      <div style={sectionGrid}>
        <Kpi label="Gross Development Value" value={money(de.gdv)} accent="var(--color-navy)" />
        <Kpi label="Total Development Cost" value={money(rs.totalDevelopmentCost)} sub="land + capex" accent="var(--color-navy)" />
        <Kpi label="Profit after Financing" value={money(de.profitAfterFinancing)} accent="var(--color-navy)" />
        <Kpi label="Development Margin" value={pct(de.developmentMargin)} sub="profit / GDV" accent="var(--color-navy)" />
      </div>

      {/* ── Cost & capital structure (with the one summary chart) ── */}
      <div style={sectionLabel}><span style={accentDot('var(--color-gold)')} />Cost &amp; capital structure</div>
      <div style={{ display: 'grid', gap: 'var(--sp-2)', gridTemplateColumns: 'minmax(220px, 280px) 1fr', alignItems: 'stretch', marginBottom: 'var(--sp-3)' }}>
        {/* Donut card */}
        <div className="card" style={{ padding: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }} data-testid="overview-capital-donut">
          <div style={{ position: 'relative', width: 104, height: 104, flexShrink: 0 }}>
            <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: donutBg }} />
            <div style={{ position: 'absolute', inset: 16, borderRadius: '50%', background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>Debt</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-heading)' }}>{pct(debtPct)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
            {legendRow('var(--color-navy)', 'Debt', pct(debtPct))}
            {legendRow('var(--color-gold)', 'Cash equity', pct(cashEquityPct))}
            {legendRow('var(--color-navy-mid)', 'In-kind equity', pct(inKindPct))}
          </div>
        </div>
        {/* Supporting KPIs */}
        <div style={{ display: 'grid', gap: 'var(--sp-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <Kpi label="Land Cost" value={money(su.land)} accent="var(--color-gold)" />
          <Kpi label="Capex (construction)" value={money(su.construction)} sub="excl. land" accent="var(--color-gold)" />
          <Kpi label="Debt / Equity" value={`${pct(debtPct)} / ${pct(equityPct)}`} sub="of total sources" accent="var(--color-gold)" />
          <Kpi label="Peak Equity" value={money(re.peakEquity)} accent="var(--color-gold)" />
          <Kpi label="Total Financing Cost" value={money(de.totalFinancingCost)} accent="var(--color-gold)" />
          <Kpi label="Cap Rate at Exit" value={pct(re.capRateAtExit)} accent="var(--color-gold)" />
        </div>
      </div>

      {/* ── When that capital is needed ── */}
      {fundingChart}

      {/* ── Timeline & structure ── */}
      <div style={sectionLabel}><span style={accentDot('var(--color-navy-mid)')} />Timeline &amp; structure</div>
      <div style={sectionGrid}>
        <Kpi label="Start year" value={startYear != null ? String(startYear) : 'n/a'} accent="var(--color-navy-mid)" />
        <Kpi label="Model horizon" value={`${horizon} yr`} sub={`to ${rs.exitYearLabel}`} accent="var(--color-navy-mid)" />
        <Kpi label="Phases" value={String(state.phases.length)} accent="var(--color-navy-mid)" />
        <Kpi label="Lines" value={String(ov.scheme.lines)} sub="consolidated" accent="var(--color-navy-mid)" />
      </div>

      {/* ── The scheme: what is being built, before what it earns ── */}
      <div style={sectionLabel}><span style={accentDot('var(--color-navy)')} />Scheme</div>
      <div style={sectionGrid}>
        <Kpi label="Total land area" value={`${area(ov.scheme.landSqm)} sqm`} sub={money(ov.scheme.landValue)} accent="var(--color-navy)" />
        <Kpi label="Total GFA" value={`${area(ov.scheme.gfaSqm)} sqm`} sub={`BUA ${area(ov.scheme.buaSqm)}`} accent="var(--color-navy)" />
        <Kpi label="Plot ratio" value={ov.scheme.plotRatio == null ? 'n/a' : `${ov.scheme.plotRatio.toFixed(2)}x`} sub="GFA / land" accent="var(--color-navy)" />
        <Kpi label="Saleable and leasable" value={`${area(ov.scheme.saleableSqm)} sqm`} sub={`${area(ov.scheme.units)} units, ${area(ov.scheme.keys)} keys, ${area(ov.scheme.leasableSqm)} sqm let`} accent="var(--color-navy)" />
      </div>

      {/* ── Land and what it carries, by the types actually in use ── */}
      <div style={sectionLabel}><span style={accentDot('var(--color-gold)')} />Land and build, by asset type</div>
      <div className="card" style={{ padding: 0, marginBottom: 'var(--sp-3)', overflowX: 'auto' }} data-testid="overview-by-type">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-meta)' }}>
          <thead>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              {['Asset type', 'Land (sqm)', 'Share of land', 'GFA (sqm)', 'Units', 'Keys', 'Leasable (sqm)'].map((h, i) => (
                <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ov.byType.map((t) => (
              <tr key={t.typeId} style={{ borderBottom: '1px solid var(--color-border)' }} data-testid={`overview-type-${t.typeId}`}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{t.label}</td>
                <td style={td}>{area(t.landSqm)}</td>
                <td style={td}>{pct(t.landPct)}</td>
                <td style={td}>{area(t.gfaSqm)}</td>
                <td style={td}>{t.units > 0 ? area(t.units) : '-'}</td>
                <td style={td}>{t.keys > 0 ? area(t.keys) : '-'}</td>
                <td style={td}>{t.leasableSqm > 0 ? area(t.leasableSqm) : '-'}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--color-navy)' }}>
              <td style={{ ...td, textAlign: 'left', fontWeight: 800 }}>Total</td>
              <td style={{ ...td, fontWeight: 800 }}>{area(ov.scheme.landSqm)}</td>
              <td style={{ ...td, fontWeight: 800 }}>100.0%</td>
              <td style={{ ...td, fontWeight: 800 }}>{area(ov.scheme.gfaSqm)}</td>
              <td style={{ ...td, fontWeight: 800 }}>{ov.scheme.units > 0 ? area(ov.scheme.units) : '-'}</td>
              <td style={{ ...td, fontWeight: 800 }}>{ov.scheme.keys > 0 ? area(ov.scheme.keys) : '-'}</td>
              <td style={{ ...td, fontWeight: 800 }}>{ov.scheme.leasableSqm > 0 ? area(ov.scheme.leasableSqm) : '-'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Where the revenue comes from, by the Revenue tab's own sections ── */}
      {ov.revenueMix.length > 0 && (
        <>
          <div style={sectionLabel}><span style={accentDot('var(--color-navy-mid)')} />Revenue mix</div>
          <div className="card" style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }} data-testid="overview-revenue-mix">
            {ov.revenueMix.map((r) => (
              <div key={r.label} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-meta)', marginBottom: 3 }}>
                  <span style={{ color: 'var(--color-body)' }}>{r.label}</span>
                  <span style={{ fontWeight: 700, color: 'var(--color-heading)' }}>{money(r.value)} <span style={{ color: 'var(--color-meta)', fontWeight: 600 }}>{pct(r.pct)}</span></span>
                </div>
                <div style={{ height: 8, background: 'var(--color-navy-light)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(1, r.pct * 100)}%`, height: '100%', background: 'var(--color-navy)' }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Phase by phase ── */}
      <div style={sectionLabel}><span style={accentDot('var(--color-navy)')} />Phases</div>
      <div className="card" style={{ padding: 0, marginBottom: 'var(--sp-3)', overflowX: 'auto' }} data-testid="overview-phases">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-meta)' }}>
          <thead>
            <tr style={{ background: 'var(--color-navy)', color: 'var(--color-on-primary-navy)' }}>
              {['Phase', 'Construction', 'Operations from', 'Lines', 'Land (sqm)', 'GFA (sqm)', 'Capex', 'Revenue', 'EBITDA'].map((h, i) => (
                <th key={h} style={{ ...th, textAlign: i <= 2 ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ov.phases.map((ph) => (
              <tr key={ph.id} style={{ borderBottom: '1px solid var(--color-border)' }} data-testid={`overview-phase-${ph.id}`}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{ph.name}</td>
                <td style={{ ...td, textAlign: 'left' }}>{ph.startYear ?? 'n/a'} to {ph.constructionEndYear ?? 'n/a'}</td>
                <td style={{ ...td, textAlign: 'left' }}>{ph.operationsStartYear ?? 'n/a'}</td>
                <td style={td}>{ph.lines}</td>
                <td style={td}>{area(ph.landSqm)}</td>
                <td style={td}>{area(ph.gfaSqm)}</td>
                <td style={td}>{money(ph.capex)}</td>
                <td style={td}>{money(ph.revenue)}</td>
                <td style={td}>{money(ph.ebitda)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── The exit, and the tightest the cash gets ── */}
      <div style={sectionLabel}><span style={accentDot('var(--color-gold)')} />Exit and cash</div>
      <div style={sectionGrid}>
        <Kpi label="Exit year" value={String(ov.exit.year)} sub={ov.exit.booked ? 'held assets sold' : 'no terminal value'} accent="var(--color-gold)" />
        <Kpi label="Terminal value" value={money(ov.exit.terminalValue)} sub="proceeds from disposal" accent="var(--color-gold)" />
        <Kpi label="Gain on disposal" value={money(ov.exit.gainOnDisposal)} sub="proceeds less book value" accent="var(--color-gold)" />
        <Kpi label="Peak debt" value={money(ov.exit.peakDebt)} accent="var(--color-gold)" />
        <Kpi label="Cash low point" value={money(ov.exit.cashLow)} sub={ov.exit.cashLowYear == null ? undefined : `in ${ov.exit.cashLowYear}`} accent="var(--color-gold)" />
      </div>
    </div>
  );
}
