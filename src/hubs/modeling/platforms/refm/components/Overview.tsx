'use client';

/**
 * Overview.tsx (2026-06-16)
 *
 * One-page INVESTOR SUMMARY of the single currently-open project. Distinct from
 * the Dashboard (the all-projects hub): Overview is only meaningful when a
 * project is open and reads the SAME snapshots every other module uses
 * (computeFinancialsSnapshot -> computeReturnsSnapshot). No engine changes, no
 * raw module-navigation cards (navigation lives in the sidebar / Dashboard).
 *
 * Sections: headline returns, key economics, development-cost split, capital
 * structure, timeline / phase snapshot, and a strip of health chips.
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

// ── Small presentational helpers ────────────────────────────────────────────
const card: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 10, padding: 'var(--sp-2)',
  background: 'var(--color-surface, #fff)',
};
const sectionTitle: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--color-meta)', margin: '0 0 10px',
};

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }): React.JSX.Element {
  return (
    <div style={{ ...card, padding: 'var(--sp-2)' }}>
      <div style={{ fontSize: 11, color: 'var(--color-meta)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ? 'var(--color-primary, #1d4ed8)' : 'var(--color-heading)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

type ChipKind = 'ok' | 'warn' | 'err';
function Chip({ kind, label }: { kind: ChipKind; label: string }): React.JSX.Element {
  const c = {
    ok:   { bg: 'color-mix(in srgb, var(--color-success) 12%, transparent)', fg: 'var(--color-success)', border: 'color-mix(in srgb, var(--color-success) 30%, transparent)', icon: '✓' },
    warn: { bg: 'color-mix(in srgb, var(--color-warning) 14%, transparent)', fg: 'var(--color-warning)', border: 'color-mix(in srgb, var(--color-warning) 30%, transparent)', icon: '!' },
    err:  { bg: 'color-mix(in srgb, var(--color-danger)  12%, transparent)', fg: 'var(--color-danger)',  border: 'color-mix(in srgb, var(--color-danger)  30%, transparent)', icon: '✗' },
  }[kind];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: c.bg, color: c.fg, border: `1px solid ${c.border}`, whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 10, fontWeight: 800 }}>{c.icon}</span>{label}
    </span>
  );
}

const grid = (min: number): React.CSSProperties => ({
  display: 'grid', gap: 'var(--sp-2)', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, marginBottom: 'var(--sp-3)',
});

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
        <h1 style={{ fontSize: 'var(--font-h1)', fontWeight: 800, color: 'var(--color-heading)', margin: 0 }}>{projectName ?? 'Project'} overview</h1>
        <p style={{ color: 'var(--color-meta)', marginTop: 8 }}>The investor summary will appear once the model has enough inputs to compute returns.</p>
      </div>
    );
  }

  const re = rs.result.realEstate;
  const de = rs.developmentEconomics;
  const mix = rs.fundingMix;
  const su = rs.sourcesUses;
  const equityPct = (mix.cashEquityPct ?? 0) + (mix.inKindEquityPct ?? 0);

  const horizon = rs.yearLabels.length;
  const startYear = rs.yearLabels[0];

  // Health chips, derived from snapshot fields only (no engine change).
  const chips: { kind: ChipKind; label: string }[] = [
    { kind: (de.profitAfterFinancing ?? 0) >= 0 ? 'ok' : 'err', label: `Profit after financing ${(de.profitAfterFinancing ?? 0) >= 0 ? 'positive' : 'negative'}` },
    { kind: (de.developmentMargin ?? 0) >= 0.15 ? 'ok' : (de.developmentMargin ?? 0) >= 0 ? 'warn' : 'err', label: `Development margin ${pct(de.developmentMargin)}` },
    { kind: re.dscrMin == null ? 'warn' : re.dscrMin >= 1.2 ? 'ok' : re.dscrMin >= 1.0 ? 'warn' : 'err', label: re.dscrMin == null ? 'No debt service' : `Min DSCR ${mult(re.dscrMin)}` },
  ];

  return (
    <div style={{ padding: 'var(--sp-3)', width: '100%' }} data-testid="overview">
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <h1 style={{ fontSize: 'var(--font-h1)', fontWeight: 800, color: 'var(--color-heading)', margin: 0, letterSpacing: '-0.02em' }}>
          {projectName ?? 'Project'}
        </h1>
        {status && <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-meta)' }}>{status}</span>}
      </div>
      <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-small)', marginTop: 0, marginBottom: 'var(--sp-3)' }}>
        Investor summary for the open project. Figures in {currency}; exit year {rs.exitYearLabel}.
      </p>

      {/* ── Headline returns ── */}
      <div style={sectionTitle}>Headline returns</div>
      <div style={grid(180)}>
        <Tile label="Project IRR (FCFF)" value={pct(rs.result.fcff.irr)} accent />
        <Tile label="Equity IRR (FCFE)" value={pct(rs.result.fcfe.irr)} accent />
        <Tile label="Equity MOIC" value={mult(rs.result.fcfe.moic)} />
        <Tile label="Equity Multiple" value={mult(re.equityMultiple)} sub="distributions / invested" />
      </div>

      {/* ── Key economics ── */}
      <div style={sectionTitle}>Key economics</div>
      <div style={grid(180)}>
        <Tile label="Gross Development Value" value={money(de.gdv)} />
        <Tile label="Total Development Cost" value={money(rs.totalDevelopmentCost)} sub="land + capex" />
        <Tile label="Profit after Financing" value={money(de.profitAfterFinancing)} />
        <Tile label="Development Margin" value={pct(de.developmentMargin)} sub="profit / GDV" />
      </div>

      {/* ── Development cost split + capital structure ── */}
      <div style={sectionTitle}>Cost split and capital structure</div>
      <div style={grid(180)}>
        <Tile label="Land Cost" value={money(su.land)} />
        <Tile label="Capex (construction)" value={money(su.construction)} sub="excl. land" />
        <Tile label="Debt / Equity" value={`${pct(mix.debtPct)} / ${pct(equityPct)}`} sub="of total sources" />
        <Tile label="Peak Equity" value={money(re.peakEquity)} />
        <Tile label="Total Financing Cost" value={money(de.totalFinancingCost)} />
        <Tile label="Cap Rate at Exit" value={pct(re.capRateAtExit)} />
      </div>

      {/* ── Timeline / phase snapshot ── */}
      <div style={sectionTitle}>Timeline and structure</div>
      <div style={grid(160)}>
        <Tile label="Start year" value={startYear != null ? String(startYear) : 'n/a'} />
        <Tile label="Model horizon" value={`${horizon} yr`} sub={`to ${rs.exitYearLabel}`} />
        <Tile label="Phases" value={String(state.phases.length)} />
        <Tile label="Assets" value={String(state.assets.length)} />
      </div>

      {/* ── Health chips ── */}
      <div style={sectionTitle}>Health</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {chips.map((c, i) => <Chip key={i} kind={c.kind} label={c.label} />)}
      </div>
    </div>
  );
}
