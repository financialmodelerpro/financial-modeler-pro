'use client';

/**
 * Module2Escrow.tsx (M2 Pass 9h-2, asset-wise layout 2026-05-20)
 *
 * Pre-sales Escrow sub-tab. A regulator withholds a configured % of every
 * pre-sales cash inflow as Inaccessible Funds. Withholding stops at the
 * asset's handover year by default; the user can extend it. The cumulative
 * held balance releases as a single lump on the configured release year.
 *
 * Layout (mirrors the reference v1.16 Escrow tab top-to-bottom):
 *   1. Inputs: project defaults (Held %, Held Until Year, Release Year) +
 *      per-asset override table.
 *   2. Pre-Sales Cash by Asset (rows = each Sell / Sell+Manage asset).
 *   3. Escrow Balance Roll-Forward: Opening Balance / Additions
 *      (per-asset rows + total) / Less Release / Closing Balance.
 *   4. Cash Flow Impact (project totals: Less Held / Add Release / Net).
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
  type EscrowAssetRow,
} from '../../lib/revenue-resolvers';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import {
  CELL_HEADER, CELL_HEADER_TOTAL, COLUMN_WIDTHS,
  ROW_DATA, ROW_GRAND_TOTAL, ROW_SUBTOTAL, TABLE_TITLE,
  nonLabelColumnPct,
} from './_shared/tableStyles';
import { PhaseSection } from './_shared/PhaseSection';
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

  // Builds per-asset rows for an output table: one row per asset, plus
  // a Total footer row aggregating the same series across all assets.
  // Mirrors the reference v1.16 layout where every output schedule lists
  // each asset on its own line.
  const buildAssetRow = (
    totalLabel: string,
    pick: (row: EscrowAssetRow) => number[],
  ): Row[] => {
    if (escrowAssetRows.length === 0) return [];
    const rows: Row[] = [];
    const sumSeries = new Array<number>(N).fill(0);
    for (const ar of escrowAssetRows) {
      const vals = pick(ar);
      rows.push({ label: ar.assetName || 'Sell asset', values: vals, indent: 1 });
      for (let t = 0; t < N; t++) sumSeries[t] += vals[t] ?? 0;
    }
    rows.push({ label: totalLabel, values: sumSeries, isTotal: true });
    return rows;
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

      {/* ── 2. Output schedules (v1.16 asset-wise layout) ────────── */}
      <PhaseSection
        phaseId="escrow-outputs"
        title="2. Escrow Schedules"
        meta="Pre-Sales → Held → Release → Cash Flow Impact (per-asset rows)"
        storageKey="fmp:m2:escrow:outputs:collapsed"
      >
        {escrowAssetRows.length === 0 ? (
          <div style={{ padding: '8px 12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
            Nothing to schedule yet, no Sell / Sell + Manage assets with pre-sales inflows.
          </div>
        ) : (
          <>
            <PeriodTable
              title="A. Pre-Sales Cash by Asset (subject to escrow)"
              caption="Pre-sales cash collected per period, per asset. Drives the Held calculation below: Held[t] = Pre-Sales Cash[t] × effective held %, only through each asset's Held Until Year."
              yearLabels={yearLabels}
              currency={currency}
              fmt={fmt}
              rows={buildAssetRow('Total Pre-Sales Cash (all assets)', (ar) => ar.preSalesCashPerPeriod)}
            />

            {(() => {
              // Build Escrow Balance Roll-Forward table:
              //   Opening Balance = previous period's closing balance
              //                   = projectTotals.cumulativeBalance[t-1] (zero at t=0)
              //   Additions       = per-asset held rows + total
              //   Less Release    = project total release
              //   Closing Balance = projectTotals.cumulativeBalance[t]
              const closing = snap.escrow.projectTotals.cumulativeBalancePerPeriod;
              const opening = new Array<number>(N).fill(0);
              for (let t = 1; t < N; t++) opening[t] = closing[t - 1] ?? 0;
              const totalAdditions = snap.escrow.projectTotals.heldPerPeriod;
              const release = snap.escrow.projectTotals.releasePerPeriod;
              const rollForwardRows: Row[] = [
                {
                  label: 'Opening Balance',
                  values: opening,
                  isSubtotal: true,
                  totalOverride: fmt(opening[0] ?? 0),
                },
                { label: 'Additions:', values: [], isSection: true },
                ...escrowAssetRows.map((ar) => ({
                  label: ar.assetName || 'Sell asset',
                  values: ar.result.heldPerPeriod,
                  indent: 1,
                })),
                {
                  label: 'Total Additions',
                  values: totalAdditions,
                  isSubtotal: true,
                },
                {
                  label: 'Less: Release of Locked Funds',
                  values: release.map((v) => -v),
                  isSubtotal: true,
                },
                {
                  label: 'Closing Balance',
                  values: closing,
                  isTotal: true,
                  totalOverride: fmt(closing[N - 1] ?? 0),
                },
              ];
              return (
                <PeriodTable
                  title="B. Escrow Balance Roll-Forward"
                  caption="Opening + Additions (each asset's held per period) − Release = Closing. Additions stop at each asset's Held Until Year (handover year by default). Release lumps on each asset's Release Year. Closing should return to zero once every asset has released."
                  yearLabels={yearLabels}
                  currency={currency}
                  fmt={fmt}
                  rows={rollForwardRows}
                />
              );
            })()}

            <PeriodTable
              title="C. Cash Flow Impact (project totals)"
              caption="What Module 4 will deduct (held) and add back (release) on the corporate cash flow. Net = Release − Held; sums to zero over the axis (escrow is a wash)."
              yearLabels={yearLabels}
              currency={currency}
              fmt={fmt}
              rows={[
                {
                  label: 'Less: Inaccessible Funds Locked',
                  values: snap.escrow.projectTotals.heldPerPeriod.map((v) => -v),
                  indent: 1,
                },
                {
                  label: 'Add: Release of Inaccessible Funds',
                  values: snap.escrow.projectTotals.releasePerPeriod,
                  indent: 1,
                },
                {
                  label: 'Net Cash Flow Adjustment (to M4)',
                  values: snap.escrow.projectTotals.cashFlowAdjustmentPerPeriod,
                  isTotal: true,
                },
              ]}
            />
          </>
        )}
      </PhaseSection>

    </div>
  );
}
