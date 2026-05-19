'use client';

/**
 * Module4FixedAssets.tsx (M4 Pass 1 UI, 2026-05-19)
 *
 * Surfaces the depreciation engine snapshot built by
 * `computeAllFixedAssetResults` in fixed-assets-resolvers.ts.
 *
 * Structure mirrors Module 2 Revenue / CoS:
 *   - Strategy-first outer PhaseSection (Hospitality / Operations +
 *     Retail / Lease — Sell parents are excluded because their capex
 *     flows through M2 Cost of Sales).
 *   - Nested PhaseDivider per project phase.
 *   - Collapsible AssetSection per asset with a full roll-forward:
 *       Opening NBV + Additions − Depreciation = Closing NBV
 *       (with Land additions called out separately, since Land does not
 *        depreciate but does sit on the BS).
 *   - Closing project rollup PhaseSection (phaseId=__project__):
 *       Additions / Land Additions / Depreciable Additions / Depreciation /
 *       Accumulated Depreciation / Opening NBV / Closing NBV.
 *
 * Methodology lives in src/core/calculations/depreciation/. Pass 1 uses
 * a coarse Land / Hard / Soft component split via `byStage`; finer
 * component lives (Capitalised Interest @ 7 yrs + Pre-Op @ 7 yrs)
 * surface in a later pass once the financing engine exposes the
 * capitalised-interest stream as its own input.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeAllFixedAssetResults } from '../../lib/fixed-assets-resolvers';
import { resolveUsefulLifeYears } from '@/src/core/calculations';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import {
  CELL_HEADER, CELL_HEADER_TOTAL, COLUMN_WIDTHS,
  ROW_DATA, ROW_GRAND_TOTAL, ROW_SUBTOTAL, TABLE_TITLE,
  nonLabelColumnPct,
} from './_shared/tableStyles';
import { PhaseSection, AssetSection } from './_shared/PhaseSection';

interface Row {
  label: string;
  values: number[];
  isTotal?: boolean;
  isSubtotal?: boolean;
  isSection?: boolean;
  indent?: number;
  totalOverride?: string;
  aggregation?: 'sum' | 'last';
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
              const agg = r.aggregation ?? 'sum';
              const totalDisplay = r.totalOverride ?? (
                agg === 'last'
                  ? fmt(r.values[r.values.length - 1] ?? 0)
                  : fmt(r.values.reduce((s, v) => s + (v ?? 0), 0))
              );
              return (
                <tr key={r.label + idx}>
                  <td style={{ ...tokens.name, paddingLeft: `${10 + indent * 12}px` }}>{r.label}</td>
                  <td style={tokens.numTotal}>{totalDisplay}</td>
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

function PhaseDivider({ title, meta, count }: { title: string; meta?: string; count?: string }): React.JSX.Element {
  return (
    <div style={{
      marginTop: 'var(--sp-2)',
      marginBottom: 'var(--sp-1)',
      padding: '6px 12px',
      background: 'color-mix(in srgb, var(--color-navy) 6%, transparent)',
      borderLeft: '3px solid var(--color-navy)',
      borderRadius: '2px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <div>
        <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-heading)' }}>{title}</strong>
        {meta && <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--color-meta)' }}>{meta}</span>}
      </div>
      {count && <span style={{ fontSize: 11, color: 'var(--color-meta)' }}>{count}</span>}
    </div>
  );
}

export default function Module4FixedAssets(): React.JSX.Element {
  const { project, phases, assets, subUnits, parcels, costLines, costOverrides, landAllocationMode } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      assets: s.assets,
      subUnits: s.subUnits,
      parcels: s.parcels,
      costLines: s.costLines,
      costOverrides: s.costOverrides,
      landAllocationMode: s.landAllocationMode,
    })),
  );

  const snap = useMemo(
    () => computeAllFixedAssetResults({ project, phases, assets, subUnits, parcels, costLines, costOverrides, landAllocationMode }),
    [project, phases, assets, subUnits, parcels, costLines, costOverrides, landAllocationMode],
  );

  const scale: DisplayScale = (project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(project.currency ?? 'SAR', scale);
  const yearLabels = snap.yearLabels;
  const N = yearLabels.length;

  // Strategy groups (mirrors Module3OpexOutput).
  const faAssets = useMemo(() => assets.filter((a) => snap.byAsset.has(a.id)), [assets, snap.byAsset]);
  const hospitalityAssets = useMemo(
    () => faAssets.filter((a) => a.strategy === 'Operate' || a.isCompanion === true),
    [faAssets],
  );
  const leaseAssets = useMemo(
    () => faAssets.filter((a) => a.strategy === 'Lease'),
    [faAssets],
  );

  const renderAssetBody = (a: typeof assets[number]): React.JSX.Element | null => {
    const r = snap.byAsset.get(a.id);
    if (!r) return null;
    const usefulLife = resolveUsefulLifeYears(a);
    const finalClose = r.closingNBVPerPeriod[N - 1] ?? 0;
    return (
      <>
        <PeriodTable
          title={`${a.name} — Roll-Forward`}
          caption={`Useful life ${usefulLife} yrs · straight-line. Land additions echo through opening / closing balances but are excluded from the depreciation base.`}
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={[
            { label: 'Opening NBV', values: r.openingNBVPerPeriod, indent: 1, aggregation: 'last', totalOverride: fmt(r.openingNBVPerPeriod[0] ?? 0) },
            { label: '(+) Additions (total)', values: r.additionsPerPeriod, indent: 1 },
            { label: '   of which: Land (non-depreciable)', values: r.additionsLandPerPeriod, indent: 2 },
            { label: '   of which: Depreciable basis', values: r.depreciableAdditionsPerPeriod, indent: 2 },
            { label: '(−) Depreciation', values: r.depreciationPerPeriod.map((v) => -v), indent: 1 },
            { label: 'Closing NBV', values: r.closingNBVPerPeriod, isTotal: true, aggregation: 'last', totalOverride: fmt(finalClose) },
            { label: 'Accumulated Depreciation', values: r.accumDepPerPeriod, indent: 1, aggregation: 'last', totalOverride: fmt(r.accumDepPerPeriod[N - 1] ?? 0) },
          ]}
        />
      </>
    );
  };

  return (
    <div data-testid="module4-fixed-assets" style={{ padding: 'var(--sp-3)' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 4 · Fixed Assets &amp; Depreciation</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>
          {currency}
        </div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)', maxWidth: 800 }}>
          Per-asset Fixed Asset roll-forward (Opening NBV + Additions − Depreciation = Closing NBV) using straight-line
          over the asset's useful life. Hospitality + Retail / Lease + Sell + Manage companions depreciate here; Sell
          and Sell + Manage parents flow through Module 2 Cost of Sales. Land additions sit on the BS but never
          depreciate (life=0). Existing operations seed Opening NBV from the asset's historical Building basis.
        </p>
      </div>

      {faAssets.length === 0 && (
        <div style={{
          padding: 'var(--sp-3)',
          textAlign: 'center',
          color: 'var(--color-meta)',
          background: 'var(--color-grey-pale)',
          borderRadius: 'var(--radius-sm)',
        }}>
          No depreciable assets in this project. Sell-only projects route capex through Cost of Sales (Module 2 Tab 3) instead.
        </div>
      )}

      {/* Hospitality / Operations */}
      <PhaseSection
        phaseId="strategy-hospitality"
        title="Hospitality / Operations"
        meta="Operate assets + Sell + Manage operate companions across all phases"
        countLabel={`${hospitalityAssets.length} asset${hospitalityAssets.length === 1 ? '' : 's'}`}
        storageKey="fmp:m4:fa:strategy:hospitality:collapsed"
      >
        {hospitalityAssets.length === 0 && (
          <div style={{ padding: '8px 12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
            No Operate or Sell + Manage assets configured yet.
          </div>
        )}
        {phases.map((p) => {
          const phaseAssets = hospitalityAssets.filter((a) => a.phaseId === p.id);
          if (phaseAssets.length === 0) return null;
          return (
            <div key={`hosp-${p.id}`} style={{ marginBottom: 'var(--sp-2)' }}>
              <PhaseDivider
                title={p.name}
                meta={`${p.status ?? 'planning'}`}
                count={`${phaseAssets.length} hospitality asset${phaseAssets.length === 1 ? '' : 's'}`}
              />
              {phaseAssets.map((a) => (
                <AssetSection
                  key={a.id}
                  assetId={a.id}
                  title={a.name}
                  meta={a.strategy === 'Operate' ? 'Hospitality' : a.strategy}
                  storageKey={`fmp:m4:fa:asset:${a.id}:collapsed`}
                >
                  {renderAssetBody(a)}
                </AssetSection>
              ))}
            </div>
          );
        })}
      </PhaseSection>

      {/* Retail / Lease */}
      <PhaseSection
        phaseId="strategy-retail"
        title="Retail / Lease"
        meta="Lease assets across all phases"
        countLabel={`${leaseAssets.length} asset${leaseAssets.length === 1 ? '' : 's'}`}
        storageKey="fmp:m4:fa:strategy:retail:collapsed"
      >
        {leaseAssets.length === 0 && (
          <div style={{ padding: '8px 12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
            No Lease assets configured yet.
          </div>
        )}
        {phases.map((p) => {
          const phaseAssets = leaseAssets.filter((a) => a.phaseId === p.id);
          if (phaseAssets.length === 0) return null;
          return (
            <div key={`lease-${p.id}`} style={{ marginBottom: 'var(--sp-2)' }}>
              <PhaseDivider
                title={p.name}
                meta={`${p.status ?? 'planning'}`}
                count={`${phaseAssets.length} lease asset${phaseAssets.length === 1 ? '' : 's'}`}
              />
              {phaseAssets.map((a) => (
                <AssetSection
                  key={a.id}
                  assetId={a.id}
                  title={a.name}
                  meta="Retail / Lease"
                  storageKey={`fmp:m4:fa:asset:${a.id}:collapsed`}
                >
                  {renderAssetBody(a)}
                </AssetSection>
              ))}
            </div>
          );
        })}
      </PhaseSection>

      {/* Project rollup */}
      <PhaseSection
        phaseId="__project__"
        title="Project Total"
        meta="all phases combined"
        storageKey="fmp:m4:fa:phase:__project__:collapsed"
      >
        <PeriodTable
          title="Project Fixed Assets — Roll-Forward"
          caption="Sum of every Hospitality + Lease asset's roll-forward. Closing NBV at exit picks up residual depreciable basis + Land that has not been written off (net-worth exit convention)."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={[
            { label: 'Opening NBV', values: snap.projectTotals.openingNBVPerPeriod, indent: 1, aggregation: 'last', totalOverride: fmt(snap.projectTotals.openingNBVPerPeriod[0] ?? 0) },
            { label: '(+) Additions (total)', values: snap.projectTotals.additionsPerPeriod, indent: 1 },
            { label: '   of which: Land', values: snap.projectTotals.additionsLandPerPeriod, indent: 2 },
            { label: '   of which: Depreciable basis', values: snap.projectTotals.depreciableAdditionsPerPeriod, indent: 2 },
            { label: '(−) Depreciation', values: snap.projectTotals.depreciationPerPeriod.map((v) => -v), indent: 1 },
            { label: 'Closing NBV', values: snap.projectTotals.closingNBVPerPeriod, isTotal: true, aggregation: 'last', totalOverride: fmt(snap.projectTotals.closingNBVPerPeriod[N - 1] ?? 0) },
            { label: 'Accumulated Depreciation', values: snap.projectTotals.accumDepPerPeriod, indent: 1, aggregation: 'last', totalOverride: fmt(snap.projectTotals.accumDepPerPeriod[N - 1] ?? 0) },
          ]}
        />
      </PhaseSection>
    </div>
  );
}
