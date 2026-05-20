'use client';

/**
 * Module2Escrow.tsx (M2 Pass 9h, simplified 2026-05-20)
 *
 * Pre-sales Escrow sub-tab. A regulator withholds a configured % of every
 * pre-sales cash inflow as Inaccessible Funds. By default the withholding
 * stops at the asset's handover year (= construction completion); the user
 * can extend it. The cumulative held balance releases in a single lump on
 * the configured release year (defaults to the year after handover).
 *
 * Layout:
 *   1. Inputs: project defaults (Held %, Held Until Year, Release Year) +
 *      per-asset override table (Held %, Held Until Year, Release Year).
 *   2. Escrow Roll-Forward: single project-level table with six lines
 *      (Pre-Sales Cash, Less: Held, Add: Release, Net Movement, Cumulative
 *      Balance, Net CF Adjustment).
 *   3. Per-Asset Detail (collapsible).
 *
 * Math lives in src/core/calculations/revenue/escrow.ts. The resolver
 * in revenue-resolvers.ts threads project + per-asset overrides through.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import {
  computeAllSellResults,
  computeEscrowSnapshot,
} from '../../lib/revenue-resolvers';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import {
  CELL_HEADER, CELL_HEADER_TOTAL, COLUMN_WIDTHS,
  ROW_DATA, ROW_GRAND_TOTAL, ROW_SUBTOTAL, TABLE_TITLE,
  nonLabelColumnPct,
} from './_shared/tableStyles';
import { PhaseSection, AssetSection } from './_shared/PhaseSection';
import { PercentageInput } from '../ui/PercentageInput';

const FAST_INPUT: React.CSSProperties = {
  width: '100%',
  padding: '4px 6px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-navy-pale, color-mix(in srgb, var(--color-navy) 8%, white))',
  color: 'var(--color-navy)',
  fontSize: 12,
};

interface Row {
  label: string;
  values: number[];
  isTotal?: boolean;
  isSubtotal?: boolean;
  isSection?: boolean;
  indent?: number;
  totalOverride?: string;
}

function PeriodTable({ title, caption, yearLabels, rows, currency, fmt }: {
  title: string; caption?: string; yearLabels: number[]; rows: Row[]; currency: string;
  fmt: (v: number) => string;
}): React.JSX.Element {
  if (rows.length === 0) return <></>;
  const nonLabelPct = nonLabelColumnPct(1 + yearLabels.length);
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <span style={TABLE_TITLE}>{title} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-meta)' }}>({currency})</span></span>
      {caption && (
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, fontStyle: 'italic' }}>{caption}</div>
      )}
      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            {yearLabels.map((y) => (<col key={y} style={{ width: nonLabelPct }} />))}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Line</th>
              <th style={CELL_HEADER_TOTAL}>Total</th>
              {yearLabels.map((y) => (<th key={y} style={CELL_HEADER}>{y}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              if (r.isSection) {
                return (
                  <tr key={`section-${idx}`}>
                    <td colSpan={2 + yearLabels.length}
                      style={{
                        padding: '8px 10px 4px',
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: 'var(--color-navy)',
                        background: 'color-mix(in srgb, var(--color-navy) 5%, transparent)',
                        borderTop: idx === 0 ? 'none' : '1px solid var(--color-border)',
                      }}
                    >{r.label}</td>
                  </tr>
                );
              }
              const tokens = r.isTotal ? ROW_GRAND_TOTAL : r.isSubtotal ? ROW_SUBTOTAL : ROW_DATA;
              const indent = r.indent ?? 0;
              const total = r.totalOverride ?? fmt(r.values.reduce((s, v) => s + (v ?? 0), 0));
              return (
                <tr key={r.label + idx}>
                  <td style={{ ...tokens.name, paddingLeft: `${10 + indent * 12}px` }}>{r.label}</td>
                  <td style={tokens.numTotal}>{total}</td>
                  {r.values.map((v, j) => (<td key={j} style={tokens.num}>{fmt(v ?? 0)}</td>))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Module2Escrow(): React.JSX.Element {
  const { project, phases, assets, subUnits, setProject, updateAsset } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      assets: s.assets,
      subUnits: s.subUnits,
      setProject: s.setProject,
      updateAsset: s.updateAsset,
    })),
  );

  const snap = useMemo(() => {
    const rev = computeAllSellResults({ project, phases, assets, subUnits });
    const escrow = computeEscrowSnapshot({ project, phases, assets, subUnits }, rev);
    return { rev, escrow };
  }, [project, phases, assets, subUnits]);

  const scale: DisplayScale = (project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(project.currency ?? 'SAR', scale);
  const yearLabels = snap.escrow.yearLabels;
  const N = yearLabels.length;
  const projectStartYear = snap.escrow.projectStartYear;

  const escrowAssetRows = useMemo(
    () => Array.from(snap.escrow.byAsset.values()),
    [snap.escrow.byAsset],
  );

  const projectHeldPct = project.escrow?.heldPct ?? 0;
  const projectDefaultReleaseYear = project.escrow?.defaultReleaseYear;
  const projectDefaultHeldUntilYear = project.escrow?.defaultHeldUntilYear;

  const setProjectHeldPct = (pct: number): void => {
    setProject({ escrow: { ...(project.escrow ?? {}), heldPct: Math.max(0, pct) } });
  };
  const setProjectDefaultReleaseYear = (yr: number | undefined): void => {
    setProject({ escrow: { ...(project.escrow ?? {}), defaultReleaseYear: yr } });
  };
  const setProjectDefaultHeldUntilYear = (yr: number | undefined): void => {
    setProject({ escrow: { ...(project.escrow ?? {}), defaultHeldUntilYear: yr } });
  };
  const setAssetHeldOverride = (assetId: string, pct: number | undefined): void => {
    const a = assets.find((x) => x.id === assetId);
    if (!a) return;
    const prev = a.revenue?.sell;
    if (!prev) return;
    const escrow = { ...(prev.escrow ?? {}) };
    if (pct === undefined) delete escrow.heldPctOverride;
    else escrow.heldPctOverride = Math.max(0, pct);
    updateAsset(assetId, { revenue: { ...(a.revenue ?? {}), sell: { ...prev, escrow } } });
  };
  const setAssetReleaseOverride = (assetId: string, yr: number | undefined): void => {
    const a = assets.find((x) => x.id === assetId);
    if (!a) return;
    const prev = a.revenue?.sell;
    if (!prev) return;
    const escrow = { ...(prev.escrow ?? {}) };
    if (yr === undefined) delete escrow.releaseYearOverride;
    else escrow.releaseYearOverride = yr;
    updateAsset(assetId, { revenue: { ...(a.revenue ?? {}), sell: { ...prev, escrow } } });
  };
  const setAssetHeldUntilOverride = (assetId: string, yr: number | undefined): void => {
    const a = assets.find((x) => x.id === assetId);
    if (!a) return;
    const prev = a.revenue?.sell;
    if (!prev) return;
    const escrow = { ...(prev.escrow ?? {}) };
    if (yr === undefined) delete escrow.heldUntilYearOverride;
    else escrow.heldUntilYearOverride = yr;
    updateAsset(assetId, { revenue: { ...(a.revenue ?? {}), sell: { ...prev, escrow } } });
  };

  return (
    <div data-testid="module2-escrow" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 2 · Pre-Sales Escrow</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>
          {currency}
        </div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)' }}>
          A regulator withholds Held % of every pre-sales cash inflow as Inaccessible Funds. Withholding runs from
          project start through Held Until Year (defaults to each asset's handover year, i.e. construction completion).
          Pre-sales cash arriving in later operating years is not locked. The cumulative held balance releases to the
          developer as a single lump on Release Year (defaults to handover year + 1). The Net CF Adjustment line is
          what Module 4 will deduct (held) and add back (release) on the corporate cash flow.
        </p>
      </div>

      {/* ── 1. Inputs ───────────────────────────────────────────── */}
      <PhaseSection
        phaseId="escrow-inputs"
        title="1. Escrow Inputs"
        meta="Project-wide held % + held-until + release-year defaults; per-asset overrides"
        storageKey="fmp:m2:escrow:inputs:collapsed"
      >
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(200px, 1fr))',
          gap: 'var(--sp-2)',
          padding: 'var(--sp-2)',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: 'var(--sp-3)',
        }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'block', marginBottom: 4 }}>
              Project Held % (regulator-locked)
            </label>
            <PercentageInput
              value={projectHeldPct * 100}
              onChange={(p) => setProjectHeldPct(p / 100)}
              min={0}
              max={100}
              decimals={2}
              style={FAST_INPUT}
              data-testid="m2-escrow-project-heldpct"
            />
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
              Default fraction withheld from every pre-sales inflow. Per-asset overrides win.
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'block', marginBottom: 4 }}>
              Default Held Until Year (optional)
            </label>
            <input
              type="number"
              value={projectDefaultHeldUntilYear ?? ''}
              min={projectStartYear}
              max={projectStartYear + Math.max(0, N - 1)}
              placeholder="auto: handover year"
              onChange={(e) => {
                const v = e.target.value;
                setProjectDefaultHeldUntilYear(v === '' ? undefined : Number(v));
              }}
              style={FAST_INPUT}
              data-testid="m2-escrow-project-helduntilyear"
            />
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
              Blank = withhold only through each asset's handover year (= end of construction). Pre-sales cash after this year passes through untouched.
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-meta)', display: 'block', marginBottom: 4 }}>
              Default Release Year (optional)
            </label>
            <input
              type="number"
              value={projectDefaultReleaseYear ?? ''}
              min={projectStartYear}
              max={projectStartYear + Math.max(0, N - 1)}
              placeholder="auto: handover year + 1"
              onChange={(e) => {
                const v = e.target.value;
                setProjectDefaultReleaseYear(v === '' ? undefined : Number(v));
              }}
              style={FAST_INPUT}
              data-testid="m2-escrow-project-releaseyear"
            />
            <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 4 }}>
              Blank = each asset uses (its handover year + 1), i.e. the year AFTER construction completes.
            </div>
          </div>
        </div>

        {/* Per-asset overrides table */}
        {escrowAssetRows.length === 0 ? (
          <div style={{ padding: '8px 12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
            No Sell or Sell + Manage assets configured yet. Add one in Module 2 Inputs to drive escrow.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={CELL_HEADER}>Asset</th>
                  <th style={CELL_HEADER}>Effective Held %</th>
                  <th style={CELL_HEADER}>Held % Override</th>
                  <th style={CELL_HEADER}>Effective Held Until</th>
                  <th style={CELL_HEADER}>Held Until Override</th>
                  <th style={CELL_HEADER}>Effective Release Year</th>
                  <th style={CELL_HEADER}>Release Year Override</th>
                </tr>
              </thead>
              <tbody>
                {escrowAssetRows.map((ar) => {
                  const a = assets.find((x) => x.id === ar.assetId);
                  const override = a?.revenue?.sell?.escrow?.heldPctOverride;
                  const releaseOverride = a?.revenue?.sell?.escrow?.releaseYearOverride;
                  const heldUntilOverride = a?.revenue?.sell?.escrow?.heldUntilYearOverride;
                  return (
                    <tr key={ar.assetId}>
                      <td style={{ ...ROW_DATA.name }}>{ar.assetName}</td>
                      <td style={{ ...ROW_DATA.num }}>{(ar.effectiveHeldPct * 100).toFixed(2)}%</td>
                      <td style={{ ...ROW_DATA.num }}>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                          <div style={{ width: 80 }}>
                            <PercentageInput
                              value={override !== undefined ? override * 100 : 0}
                              onChange={(p) => setAssetHeldOverride(ar.assetId, p / 100)}
                              min={0}
                              max={100}
                              decimals={2}
                              style={FAST_INPUT}
                              disabled={override === undefined}
                              data-testid={`m2-escrow-asset-${ar.assetId}-heldpct`}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => setAssetHeldOverride(ar.assetId, override === undefined ? ar.effectiveHeldPct : undefined)}
                            style={{
                              fontSize: 10,
                              padding: '2px 6px',
                              background: override !== undefined ? 'var(--color-navy)' : 'transparent',
                              color: override !== undefined ? 'var(--color-on-primary-navy)' : 'var(--color-navy)',
                              border: '1px solid var(--color-navy)',
                              borderRadius: 'var(--radius-sm)',
                              cursor: 'pointer',
                            }}
                          >
                            {override !== undefined ? 'Override' : 'Inherit'}
                          </button>
                        </div>
                      </td>
                      <td style={{ ...ROW_DATA.num }}>{ar.effectiveHeldUntilYear}</td>
                      <td style={{ ...ROW_DATA.num }}>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                          <div style={{ width: 100 }}>
                            <input
                              type="number"
                              value={heldUntilOverride ?? ''}
                              placeholder="auto"
                              min={projectStartYear}
                              max={projectStartYear + Math.max(0, N - 1)}
                              onChange={(e) => {
                                const v = e.target.value;
                                setAssetHeldUntilOverride(ar.assetId, v === '' ? undefined : Number(v));
                              }}
                              style={FAST_INPUT}
                              data-testid={`m2-escrow-asset-${ar.assetId}-helduntilyear`}
                            />
                          </div>
                        </div>
                      </td>
                      <td style={{ ...ROW_DATA.num }}>{ar.effectiveReleaseYear}</td>
                      <td style={{ ...ROW_DATA.num }}>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                          <div style={{ width: 100 }}>
                            <input
                              type="number"
                              value={releaseOverride ?? ''}
                              placeholder="auto"
                              min={projectStartYear}
                              max={projectStartYear + Math.max(0, N - 1)}
                              onChange={(e) => {
                                const v = e.target.value;
                                setAssetReleaseOverride(ar.assetId, v === '' ? undefined : Number(v));
                              }}
                              style={FAST_INPUT}
                              data-testid={`m2-escrow-asset-${ar.assetId}-releaseyear`}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PhaseSection>

      {/* ── 2. Escrow Roll-Forward (project-level, single table) ─── */}
      <PhaseSection
        phaseId="escrow-outputs"
        title="2. Escrow Roll-Forward"
        meta="Single project-level schedule (per-asset detail below)"
        storageKey="fmp:m2:escrow:outputs:collapsed"
      >
        {escrowAssetRows.length === 0 ? (
          <div style={{ padding: '8px 12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
            Nothing to schedule yet — no Sell / Sell + Manage assets with pre-sales inflows.
          </div>
        ) : (
          <PeriodTable
            title="Escrow Roll-Forward (project totals)"
            caption="Held[t] = Pre-Sales Cash[t] × effective held %, only through each asset's Held Until Year (= handover year by default). Release[t] = cumulative held released as a lump on each asset's Release Year. Net CF Adjustment = Release − Held; sum over the axis = 0 (escrow is a wash)."
            yearLabels={yearLabels}
            currency={currency}
            fmt={fmt}
            rows={[
              {
                label: 'Pre-Sales Cash (subject to escrow)',
                values: snap.escrow.projectTotals.preSalesCashPerPeriod,
              },
              {
                label: 'Less: Held (regulator lock)',
                values: snap.escrow.projectTotals.heldPerPeriod.map((v) => -v),
              },
              {
                label: 'Add: Release of locked funds',
                values: snap.escrow.projectTotals.releasePerPeriod,
              },
              {
                label: 'Net Movement (Held − Release)',
                values: snap.escrow.projectTotals.netMovementPerPeriod,
                isSubtotal: true,
              },
              {
                label: 'Cumulative Locked Balance',
                values: snap.escrow.projectTotals.cumulativeBalancePerPeriod,
                isSubtotal: true,
                totalOverride: fmt(snap.escrow.projectTotals.cumulativeBalancePerPeriod[N - 1] ?? 0),
              },
              {
                label: 'Net Cash Flow Adjustment (to M4)',
                values: snap.escrow.projectTotals.cashFlowAdjustmentPerPeriod,
                isTotal: true,
              },
            ]}
          />
        )}
      </PhaseSection>

      {/* Per-asset detail (collapsible) */}
      {escrowAssetRows.length > 0 && (
        <PhaseSection
          phaseId="escrow-perasset"
          title="3. Per-Asset Detail"
          meta="full roll-forward for each Sell asset"
          storageKey="fmp:m2:escrow:perasset:collapsed"
          defaultOpen={false}
        >
          {escrowAssetRows.map((ar) => (
            <AssetSection
              key={ar.assetId}
              assetId={ar.assetId}
              title={ar.assetName}
              meta={`Held ${(ar.effectiveHeldPct * 100).toFixed(2)}% · Until ${ar.effectiveHeldUntilYear} · Release ${ar.effectiveReleaseYear}`}
              storageKey={`fmp:m2:escrow:asset:${ar.assetId}:collapsed`}
              defaultOpen={false}
            >
              <PeriodTable
                title={`${ar.assetName} — Roll-Forward`}
                yearLabels={yearLabels}
                currency={currency}
                fmt={fmt}
                rows={[
                  { label: 'Pre-Sales Cash', values: ar.preSalesCashPerPeriod, indent: 1 },
                  { label: 'Held this period', values: ar.result.heldPerPeriod, indent: 1 },
                  { label: 'Released this period', values: ar.result.releasePerPeriod, indent: 1 },
                  { label: 'Net Movement', values: ar.result.netMovementPerPeriod, isSubtotal: true },
                  {
                    label: 'Cumulative Locked Balance',
                    values: ar.result.cumulativeBalancePerPeriod,
                    isTotal: true,
                    totalOverride: fmt(ar.result.cumulativeBalancePerPeriod[N - 1] ?? 0),
                  },
                ]}
              />
            </AssetSection>
          ))}
        </PhaseSection>
      )}
    </div>
  );
}
