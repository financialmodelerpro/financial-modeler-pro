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

  const rs = useMemo(() => {
    try {
      const snap = computeFinancialsSnapshot(state as never);
      return computeReturnsSnapshot(snap, project);
    } catch {
      return null;
    }
  }, [state, project]);

  if (!rs) {
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
    { kind: re.dscrMin == null ? 'warn' : re.dscrMin >= 1.2 ? 'ok' : re.dscrMin >= 1.0 ? 'warn' : 'err', label: re.dscrMin == null ? 'No debt service' : `Min DSCR ${mult(re.dscrMin)}` },
  ];

  const heroItem = (label: string, value: string): React.JSX.Element => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 'var(--font-micro)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.66)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 800, color: '#fff', lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</div>
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
        <div style={{ display: 'grid', gap: 'var(--sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          {heroItem('Project IRR (FCFF)', pct(rs.result.fcff.irr))}
          {heroItem('Equity IRR (FCFE)', pct(rs.result.fcfe.irr))}
          {heroItem('Equity MOIC', mult(rs.result.fcfe.moic))}
          {heroItem('Equity Multiple', mult(re.equityMultiple))}
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

      {/* ── Timeline & structure ── */}
      <div style={sectionLabel}><span style={accentDot('var(--color-navy-mid)')} />Timeline &amp; structure</div>
      <div style={sectionGrid}>
        <Kpi label="Start year" value={startYear != null ? String(startYear) : 'n/a'} accent="var(--color-navy-mid)" />
        <Kpi label="Model horizon" value={`${horizon} yr`} sub={`to ${rs.exitYearLabel}`} accent="var(--color-navy-mid)" />
        <Kpi label="Phases" value={String(state.phases.length)} accent="var(--color-navy-mid)" />
        <Kpi label="Assets" value={String(state.assets.length)} accent="var(--color-navy-mid)" />
      </div>
    </div>
  );
}
