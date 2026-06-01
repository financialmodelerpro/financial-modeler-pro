'use client';

/**
 * Module3OpexOutput.tsx (Pass 5, 2026-05-19)
 *
 * Re-skinned to mirror the Revenue / CoS output pattern: strategy-first
 * outer `PhaseSection` (Hospitality / Operations, Retail / Lease) with
 * a nested `PhaseDivider` per project phase, each asset wrapped in a
 * collapsible `AssetSection`. The project rollup lives in a closing
 * `PhaseSection phaseId="__project__"` and uses strategy-section header
 * rows + per-asset rows + grand totals inside each per-category table,
 * matching `Module2CostOfSales.tsx`.
 *
 * Per-asset surface (unchanged math): Revenue Breakdown (Rooms / F&B /
 * Other / Total for hospitality, Total Lease Revenue for retail)
 * followed by stand-alone category tables.
 *   Hospitality: Direct · Indirect / Undistributed · Management Fees ·
 *                Reserves & Other Charges
 *   Retail:      Property Operating · Pass-Through / Recoveries (memo) ·
 *                Other Charges
 *
 * No GOP / NOI / margin rows, those compose in M4 P&L.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeAllSellResults } from '../../lib/revenue-resolvers';
import { computeAllOpexResults, computeOpexApSnapshot } from '../../lib/opex-resolvers';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import {
  CELL_HEADER, CELL_HEADER_TOTAL, COLUMN_WIDTHS,
  ROW_DATA, ROW_GRAND_TOTAL, ROW_SUBTOTAL, TABLE_TITLE,
  nonLabelColumnPct,
  periodTableStyle,
} from './_shared/tableStyles';
import { PhaseSection, AssetSection } from './_shared/PhaseSection';
import { AssetQuickNav } from './_shared/AssetQuickNav';
import type { OpexLineCategory } from '@/src/core/calculations/opex';

type Aggregation = 'sum' | 'last' | 'avg' | 'none';

interface Row {
  label: string;
  values: number[];
  isTotal?: boolean;
  isSubtotal?: boolean;
  isSection?: boolean;
  indent?: number;
  aggregation?: Aggregation;
  totalOverride?: string;
  rowFmt?: (v: number) => string;
}

function PeriodTable({ title, caption, yearLabels, rows, currency, fmt }: {
  title: string; caption?: string; yearLabels: number[]; rows: Row[]; currency: string;
  fmt: (v: number) => string;
}): React.JSX.Element {
  if (rows.length === 0) return <></>;
  // Universal prior-year column: leads with the year before project
  // start so the year axis aligns column-for-column across the platform.
  const resolvedPriorYear = yearLabels.length > 0 ? yearLabels[0] - 1 : undefined;
  const hasPrior = resolvedPriorYear !== undefined;
  const nonLabelPct = nonLabelColumnPct(1 + (hasPrior ? 1 : 0) + yearLabels.length);
  const priorCellStyle: React.CSSProperties = { color: 'var(--color-meta)', fontStyle: 'italic' };
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <span style={TABLE_TITLE}>{title} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-meta)' }}>({currency})</span></span>
      {caption && (
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, fontStyle: 'italic' }}>{caption}</div>
      )}
      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
        <table style={periodTableStyle(1 + (hasPrior ? 1 : 0) + yearLabels.length)}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            {hasPrior && (<col style={{ width: nonLabelPct }} />)}
            {yearLabels.map((y) => (<col key={y} style={{ width: nonLabelPct }} />))}
          </colgroup>
          <thead>
            <tr>
              <th style={CELL_HEADER}>Line</th>
              <th style={CELL_HEADER_TOTAL}>Total</th>
              {hasPrior && (<th style={{ ...CELL_HEADER, fontStyle: 'italic', color: 'var(--color-meta)' }}>{resolvedPriorYear}</th>)}
              {yearLabels.map((y) => (<th key={y} style={CELL_HEADER}>{y}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              if (r.isSection) {
                return (
                  <tr key={`section-${idx}`}>
                    <td colSpan={2 + (hasPrior ? 1 : 0) + yearLabels.length}
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
              const rowFmt = r.rowFmt ?? fmt;
              const agg: Aggregation = r.aggregation ?? 'sum';
              let totalDisplay: string;
              if (r.totalOverride != null) totalDisplay = r.totalOverride;
              else if (agg === 'sum') totalDisplay = rowFmt(r.values.reduce((s, v) => s + v, 0));
              else if (agg === 'last') totalDisplay = rowFmt(r.values[r.values.length - 1] ?? 0);
              else if (agg === 'avg') {
                const nonZero = r.values.filter((v) => v !== 0).length;
                totalDisplay = nonZero > 0 ? rowFmt(r.values.reduce((s, v) => s + v, 0) / nonZero) : '-';
              } else totalDisplay = '';
              return (
                <tr key={r.label + idx}>
                  <td style={{ ...tokens.name, paddingLeft: `${10 + indent * 12}px` }}>{r.label}</td>
                  <td style={tokens.numTotal}>{totalDisplay}</td>
                  {hasPrior && (<td style={{ ...tokens.num, ...priorCellStyle }}>{rowFmt(0)}</td>)}
                  {r.values.map((v, j) => (<td key={j} style={tokens.num}>{rowFmt(v)}</td>))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Light phase divider rendered inside a strategy `PhaseSection`. Lifted
 * verbatim from `Module2RevenueOutput.tsx` / `Module2CostOfSales.tsx` so
 * every output tab uses the same nesting visual.
 */
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

// ─── category routing ─────────────────────────────────────────────
// Maps each OpexLineCategory to a section bucket per strategy. The
// project-total rollup uses the same buckets to figure out which
// asset rows show up under which header.
type HospBucket = 'direct' | 'indirect' | 'mgmt' | 'reserves' | null;
type LeaseBucket = 'operating' | 'recoveries' | 'other_charges' | null;

function hospBucketFor(cat: OpexLineCategory): HospBucket {
  if (cat === 'direct_rooms' || cat === 'direct_fb' || cat === 'direct_other') return 'direct';
  if (cat.startsWith('indirect_')) return 'indirect';
  if (cat === 'mgmt_base' || cat === 'mgmt_tech' || cat === 'mgmt_incentive') return 'mgmt';
  if (cat === 'replacement_reserve' || cat === 'rent_insurance' || cat === 'property_tax' || cat === 'utilities' || cat === 'other') return 'reserves';
  return null;
}
function leaseBucketFor(cat: OpexLineCategory): LeaseBucket {
  if (cat === 'mgmt_base' || cat === 'repairs_maintenance' || cat === 'rent_insurance' || cat === 'utilities') return 'operating';
  if (cat === 'cam') return 'recoveries';
  if (cat === 'property_tax' || cat === 'replacement_reserve' || cat === 'other') return 'other_charges';
  return null;
}

function sumArrays(arrs: number[][], N: number): number[] {
  const out = new Array<number>(N).fill(0);
  for (const a of arrs) {
    for (let t = 0; t < N; t++) out[t] += a[t] ?? 0;
  }
  return out;
}

export default function Module3OpexOutput(): React.JSX.Element {
  const { project, phases, assets, subUnits } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      assets: s.assets,
      subUnits: s.subUnits,
    })),
  );

  const snap = useMemo(() => {
    const rev = computeAllSellResults({ project, phases, assets, subUnits });
    const opex = computeAllOpexResults({ project, phases, assets, subUnits }, rev);
    const ap = computeOpexApSnapshot({ project, assets }, opex);
    return { rev, opex, ap };
  }, [project, phases, assets, subUnits]);

  const scale: DisplayScale = (project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(project.currency ?? 'SAR', scale);
  const yearLabels = snap.opex.yearLabels;
  const N = yearLabels.length;

  // Assets that actually have an opex engine result (Hospitality + Lease).
  // Sell parents / pure Sell have no opex by convention.
  const opexAssets = useMemo(() => assets.filter((a) => snap.opex.byAsset.has(a.id)), [assets, snap.opex.byAsset]);
  const hospitalityAssets = useMemo(
    () => opexAssets.filter((a) => a.strategy === 'Operate' || a.isCompanion === true),
    [opexAssets],
  );
  const leaseAssets = useMemo(
    () => opexAssets.filter((a) => a.strategy === 'Lease'),
    [opexAssets],
  );

  // ─── per-asset section renderers ─────────────────────────────────
  const renderHospitalityAssetBody = (a: typeof assets[number]): React.JSX.Element | null => {
    const r = snap.opex.byAsset.get(a.id);
    if (!r) return null;
    const rev = snap.rev.byHospitalityAsset.get(a.id);
    const zeros = (): number[] => new Array<number>(N).fill(0);

    const revRows: Row[] = [
      { label: 'Rooms Revenue', values: rev?.roomsRevenuePerPeriod ?? zeros(), indent: 1 },
      { label: 'F&B Revenue', values: rev?.fbRevenuePerPeriod ?? zeros(), indent: 1 },
      { label: 'Other Department Revenue', values: rev?.otherRevenuePerPeriod ?? zeros(), indent: 1 },
      { label: 'Total Revenue', values: rev?.totalRevenuePerPeriod ?? zeros(), isTotal: true },
    ];

    const linesByBucket: Record<NonNullable<HospBucket>, Row[]> = { direct: [], indirect: [], mgmt: [], reserves: [] };
    const lines = a.opex?.lines ?? [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const bucket = hospBucketFor(ln.category);
      if (!bucket) continue;
      linesByBucket[bucket].push({
        label: ln.disabled ? `${ln.name} (off)` : ln.name,
        values: r.perLinePerPeriod[i] ?? zeros(),
        indent: 1,
      });
    }

    return (
      <>
        <PeriodTable
          title={`${a.name}: Revenue Breakdown`}
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={revRows}
        />

        <PeriodTable
          title={`${a.name}: Direct Costs`}
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={linesByBucket.direct.length > 0
            ? [
                ...linesByBucket.direct,
                { label: 'Total Direct Costs', values: r.directCostsPerPeriod, isTotal: true },
              ]
            : []}
        />

        <PeriodTable
          title={`${a.name}: Indirect / Undistributed Costs`}
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={linesByBucket.indirect.length > 0
            ? [
                ...linesByBucket.indirect,
                { label: 'Total Indirect Costs', values: r.indirectCostsPerPeriod, isTotal: true },
              ]
            : []}
        />

        <PeriodTable
          title={`${a.name}: Management Fees`}
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={linesByBucket.mgmt.length > 0
            ? [
                ...linesByBucket.mgmt,
                { label: 'Total Management Fees', values: sumArrays(linesByBucket.mgmt.map((row) => row.values), N), isTotal: true },
              ]
            : []}
        />

        <PeriodTable
          title={`${a.name}: Reserves & Other Charges`}
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={linesByBucket.reserves.length > 0
            ? [
                ...linesByBucket.reserves,
                { label: 'Total Reserves & Other', values: sumArrays(linesByBucket.reserves.map((row) => row.values), N), isTotal: true },
              ]
            : []}
        />
      </>
    );
  };

  const renderLeaseAssetBody = (a: typeof assets[number]): React.JSX.Element | null => {
    const r = snap.opex.byAsset.get(a.id);
    if (!r) return null;
    const rev = snap.rev.byLeaseAsset.get(a.id);
    const zeros = (): number[] => new Array<number>(N).fill(0);

    // M2 Lease engine surfaces only Total Revenue per asset; the
    // breakdown (Gross Rent / Service Charge / Other) is a future M2
    // refinement. Still render as line row + Total row for consistency
    // with the Hospitality / Direct / Indirect tables, a single-line
    // table without a header data row visually breaks the rhythm.
    const leaseRevenue = rev?.totalRevenuePerPeriod ?? zeros();
    const revRows: Row[] = [
      { label: 'Lease Revenue', values: leaseRevenue, indent: 1 },
      { label: 'Total Revenue', values: leaseRevenue, isTotal: true },
    ];

    const linesByBucket: Record<NonNullable<LeaseBucket>, Row[]> = { operating: [], recoveries: [], other_charges: [] };
    const lines = a.opex?.lines ?? [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const bucket = leaseBucketFor(ln.category);
      if (!bucket) continue;
      linesByBucket[bucket].push({
        label: ln.disabled ? `${ln.name} (off)` : ln.name,
        values: r.perLinePerPeriod[i] ?? zeros(),
        indent: 1,
      });
    }

    return (
      <>
        <PeriodTable
          title={`${a.name}: Revenue Breakdown`}
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={revRows}
        />

        <PeriodTable
          title={`${a.name}: Property Operating Costs`}
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={linesByBucket.operating.length > 0
            ? [
                ...linesByBucket.operating,
                { label: 'Total Property Operating Costs', values: sumArrays(linesByBucket.operating.map((row) => row.values), N), isTotal: true },
              ]
            : []}
        />

        <PeriodTable
          title={`${a.name}: Pass-Through / Recoveries (memo)`}
          caption="Service charges typically recovered from tenants under NNN leases; shown gross for transparency."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={linesByBucket.recoveries.length > 0
            ? [
                ...linesByBucket.recoveries,
                { label: 'Total Recoveries', values: sumArrays(linesByBucket.recoveries.map((row) => row.values), N), isTotal: true },
              ]
            : []}
        />

        <PeriodTable
          title={`${a.name}: Other Charges`}
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={linesByBucket.other_charges.length > 0
            ? [
                ...linesByBucket.other_charges,
                { label: 'Total Other Charges', values: sumArrays(linesByBucket.other_charges.map((row) => row.values), N), isTotal: true },
              ]
            : []}
        />
      </>
    );
  };

  // ─── project total rollup helpers ────────────────────────────────
  // Build rows for a per-category project rollup that mirrors the M2
  // CoS Project Total shape: strategy section header → asset rows →
  // section subtotal → grand total. `predicate` selects which line
  // categories contribute; `subset` restricts the asset universe to a
  // strategy.
  const assetSumIn = (assetId: string, predicate: (cat: OpexLineCategory) => boolean): number[] | null => {
    const a = assets.find((x) => x.id === assetId);
    const r = snap.opex.byAsset.get(assetId);
    if (!a || !r) return null;
    const lines = a.opex?.lines ?? [];
    const out = new Array<number>(N).fill(0);
    let touched = false;
    for (let i = 0; i < lines.length; i++) {
      if (!predicate(lines[i].category)) continue;
      const arr = r.perLinePerPeriod[i];
      if (!arr) continue;
      for (let t = 0; t < N; t++) out[t] += arr[t] ?? 0;
      touched = true;
    }
    return touched ? out : null;
  };

  type AssetSlice = typeof assets[number];
  const groupedRollupRows = (groups: Array<{
    label: string;
    assets: AssetSlice[];
    predicate: (cat: OpexLineCategory) => boolean;
  }>, grandLabel: string): Row[] => {
    const rows: Row[] = [];
    const grandSeries: number[][] = [];
    for (const g of groups) {
      const groupSeries: number[][] = [];
      const groupRows: Row[] = [];
      for (const a of g.assets) {
        const arr = assetSumIn(a.id, g.predicate);
        if (!arr) continue;
        groupRows.push({ label: a.name, values: arr, indent: 2 });
        groupSeries.push(arr);
      }
      if (groupRows.length === 0) continue;
      rows.push({ label: g.label, values: [], isSection: true, indent: 0 });
      rows.push(...groupRows);
      rows.push({
        label: `Total ${g.label}`,
        values: sumArrays(groupSeries, N),
        isSubtotal: true,
        indent: 1,
      });
      grandSeries.push(...groupSeries);
    }
    if (rows.length === 0) return [];
    rows.push({
      label: grandLabel,
      values: sumArrays(grandSeries, N),
      isTotal: true,
      indent: 0,
    });
    return rows;
  };

  // ── M4 Pass 2a (2026-05-20): Accounts Payable schedule ──────────
  // DPO inputs (project default + days basis + per-asset override) live
  // on the Opex Inputs tab (Module3Opex). This surface is output only:
  // the DPO-driven AP roll-forward per asset / HQ / project total.

  const renderAccountsPayableSection = (): React.JSX.Element => {
    const apAssetRows = Array.from(snap.ap.byAsset.values());
    const projectTotalAp = snap.ap.projectTotals;

    return (
      <PhaseSection
        phaseId="__opex-ap__"
        title="Accounts Payable (Opex)"
        meta="DPO-driven AP roll-forward (set DPO on the Inputs tab). Feeds BS current liabilities + CF cash paid for opex"
        storageKey="fmp:m3:opex:ap:collapsed"
      >
        {apAssetRows.length === 0 ? (
          <div style={{ padding: '8px 12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
            No opex assets configured yet, AP schedule will populate once Hospitality or Lease assets are added.
          </div>
        ) : (
          <>
            {/* Per-asset AP roll-forward */}
            {apAssetRows.map((ar) => (
              <AssetSection
                key={ar.assetId}
                assetId={ar.assetId}
                domId={`m3-opex-out-asset-${ar.assetId}`}
                title={ar.assetName}
                meta={`DPO ${ar.effectiveApDays} days`}
                storageKey={`fmp:m3:opex:ap:asset:${ar.assetId}:collapsed`}
                defaultOpen={false}
              >
                <PeriodTable
                  title={`${ar.assetName}: AP Roll-Forward`}
                  yearLabels={yearLabels}
                  currency={currency}
                  fmt={fmt}
                  rows={[
                    {
                      label: 'Opening AP',
                      values: ar.result.openingPerPeriod,
                      isSubtotal: true,
                      totalOverride: fmt(ar.result.openingPerPeriod[0] ?? 0),
                    },
                    { label: 'Opex Incurred', values: ar.opexIncurredPerPeriod, indent: 1 },
                    { label: 'Less: Cash Paid', values: ar.result.cashPaidPerPeriod.map((v) => -v), indent: 1 },
                    {
                      label: 'Closing AP',
                      values: ar.result.perPeriod,
                      isTotal: true,
                      totalOverride: fmt(ar.result.perPeriod[N - 1] ?? 0),
                    },
                  ]}
                />
              </AssetSection>
            ))}

            {/* HQ AP roll-forward */}
            <AssetSection
              assetId="__hq-ap__"
              title="HQ &amp; Corporate Overheads"
              meta={`DPO ${snap.ap.hq.apDays} days`}
              storageKey="fmp:m3:opex:ap:hq:collapsed"
              defaultOpen={false}
            >
              <PeriodTable
                title="HQ: AP Roll-Forward"
                yearLabels={yearLabels}
                currency={currency}
                fmt={fmt}
                rows={[
                  {
                    label: 'Opening AP',
                    values: snap.ap.hq.result.openingPerPeriod,
                    isSubtotal: true,
                    totalOverride: fmt(snap.ap.hq.result.openingPerPeriod[0] ?? 0),
                  },
                  { label: 'HQ Opex Incurred', values: snap.ap.hq.opexIncurredPerPeriod, indent: 1 },
                  { label: 'Less: Cash Paid', values: snap.ap.hq.result.cashPaidPerPeriod.map((v) => -v), indent: 1 },
                  {
                    label: 'Closing AP',
                    values: snap.ap.hq.result.perPeriod,
                    isTotal: true,
                    totalOverride: fmt(snap.ap.hq.result.perPeriod[N - 1] ?? 0),
                  },
                ]}
              />
            </AssetSection>

            {/* Project totals */}
            <PeriodTable
              title="Project Total: AP Roll-Forward"
              caption="Sum across every asset + HQ. Feeds Balance Sheet current liabilities. Cash Paid = Opex Incurred − ΔAP."
              yearLabels={yearLabels}
              currency={currency}
              fmt={fmt}
              rows={[
                {
                  label: 'Opening AP',
                  values: projectTotalAp.openingApPerPeriod,
                  isSubtotal: true,
                  totalOverride: fmt(projectTotalAp.openingApPerPeriod[0] ?? 0),
                },
                { label: 'Opex Incurred', values: projectTotalAp.opexIncurredPerPeriod, indent: 1 },
                { label: 'Less: Cash Paid', values: projectTotalAp.cashPaidPerPeriod.map((v) => -v), indent: 1 },
                {
                  label: 'Closing AP',
                  values: projectTotalAp.closingApPerPeriod,
                  isTotal: true,
                  totalOverride: fmt(projectTotalAp.closingApPerPeriod[N - 1] ?? 0),
                },
              ]}
            />
          </>
        )}
      </PhaseSection>
    );
  };

  return (
    <div data-testid="module3-opex-output" style={{ padding: 'var(--sp-3)' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 3 · Opex (Output)</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>
          {currency}
        </div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)', maxWidth: 800 }}>
          Per-asset Revenue Breakdown followed by category-wise expense tables. Hospitality assets show
          Direct / Indirect / Management / Reserves; Retail assets show Property Operating / Recoveries /
          Other Charges. Phases and assets collapse. No GOP / NOI rows, those compose in M4 P&L.
        </p>
      </div>

      {/* M2 Pass 9M (2026-05-21): asset quick-nav strip. */}
      <AssetQuickNav assets={assets} idPrefix="m3-opex-out-asset" testidPrefix="m3-opex-out-nav" />

      {opexAssets.length === 0 && (
        <div style={{
          padding: 'var(--sp-3)',
          textAlign: 'center',
          color: 'var(--color-meta)',
          background: 'var(--color-grey-pale)',
          borderRadius: 'var(--radius-sm)',
        }}>
          No opex configured yet. Seed defaults per asset on the Inputs tab.
        </div>
      )}

      {/* Hospitality / Operations strategy section (pure Operate + Sell+Manage companions). */}
      <PhaseSection
        phaseId="strategy-hospitality"
        title="Hospitality / Operations"
        meta="Operate assets + Sell + Manage operate companions across all phases"
        countLabel={`${hospitalityAssets.length} asset${hospitalityAssets.length === 1 ? '' : 's'}`}
        storageKey="fmp:m3:opex:strategy:hospitality:collapsed"
        assetIds={hospitalityAssets.map((a) => a.id)}
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
                  domId={`m3-opex-out-asset-${a.id}`}
                  title={a.name}
                  meta={a.strategy === 'Operate' ? 'Hospitality' : a.strategy}
                  storageKey={`fmp:m3:opex:asset:${a.id}:collapsed`}
                >
                  {renderHospitalityAssetBody(a)}
                </AssetSection>
              ))}
            </div>
          );
        })}
      </PhaseSection>

      {/* Retail / Lease strategy section. */}
      <PhaseSection
        phaseId="strategy-retail"
        title="Retail / Lease"
        meta="Lease assets across all phases"
        countLabel={`${leaseAssets.length} asset${leaseAssets.length === 1 ? '' : 's'}`}
        storageKey="fmp:m3:opex:strategy:retail:collapsed"
        assetIds={leaseAssets.map((a) => a.id)}
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
                  domId={`m3-opex-out-asset-${a.id}`}
                  title={a.name}
                  meta="Retail / Lease"
                  storageKey={`fmp:m3:opex:asset:${a.id}:collapsed`}
                >
                  {renderLeaseAssetBody(a)}
                </AssetSection>
              ))}
            </div>
          );
        })}
      </PhaseSection>

      {/* Project Total rollup (mirrors Revenue / CoS shape). */}
      <PhaseSection
        phaseId="__project__"
        title="Project Total"
        meta="all phases combined, grouped by strategy"
        storageKey="fmp:m3:opex:phase:__project__:collapsed"
      >
        <PeriodTable
          title="HQ & Corporate Overheads (project-wide)"
          caption="Lines configured on the Inputs tab. Fixed-cost lines inherit the HQ inflation default; %-of-revenue lines scale with project total revenue."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={[
            ...(project.hqOpex?.lines ?? []).map((ln, i) => ({
              label: ln.disabled ? `${ln.name} (off)` : ln.name,
              values: snap.opex.hq.perLinePerPeriod[i] ?? new Array(N).fill(0),
              indent: 1,
            })),
            { label: 'Total HQ Opex', values: snap.opex.hq.totalOpexPerPeriod, isTotal: true },
          ]}
        />

        <PeriodTable
          title="Project Opex · Direct Costs"
          caption="Hospitality direct cost lines (Rooms / F&B / Other Dept). Lease assets carry no direct cost line by convention."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={groupedRollupRows(
            [{ label: 'Hospitality / Operations', assets: hospitalityAssets, predicate: (c) => hospBucketFor(c) === 'direct' }],
            'Project Total · Direct Costs',
          )}
        />

        <PeriodTable
          title="Project Opex · Indirect / Operating Costs"
          caption="Hospitality Indirect / Undistributed lines and Retail Property Operating lines, one row per contributing asset."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={groupedRollupRows(
            [
              { label: 'Hospitality / Operations', assets: hospitalityAssets, predicate: (c) => hospBucketFor(c) === 'indirect' },
              { label: 'Retail / Lease', assets: leaseAssets, predicate: (c) => leaseBucketFor(c) === 'operating' },
            ],
            'Project Total · Indirect / Operating',
          )}
        />

        <PeriodTable
          title="Project Opex · Management Fees"
          caption="Hospitality management fee lines (base + technology + incentive)."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={groupedRollupRows(
            [{ label: 'Hospitality / Operations', assets: hospitalityAssets, predicate: (c) => hospBucketFor(c) === 'mgmt' }],
            'Project Total · Management Fees',
          )}
        />

        <PeriodTable
          title="Project Opex · Reserves & Other Charges"
          caption="Hospitality Reserves + Retail Recoveries (memo) + Retail Other Charges, one row per contributing asset."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={groupedRollupRows(
            [
              { label: 'Hospitality / Operations', assets: hospitalityAssets, predicate: (c) => hospBucketFor(c) === 'reserves' },
              { label: 'Retail / Lease', assets: leaseAssets, predicate: (c) => leaseBucketFor(c) === 'recoveries' || leaseBucketFor(c) === 'other_charges' },
            ],
            'Project Total · Reserves & Other',
          )}
        />

        <PeriodTable
          title="Project Total Opex"
          caption="Sum of every per-asset line plus HQ corporate overheads."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={[
            { label: 'All asset opex', values: snap.opex.projectTotals.totalOpexPerPeriod, indent: 1 },
            { label: 'HQ overheads', values: snap.opex.hq.totalOpexPerPeriod, indent: 1 },
            { label: 'Total Project Opex', values: snap.opex.totalOpexPerPeriodInclHQ, isTotal: true },
          ]}
        />
      </PhaseSection>

      {/* M4 Pass 2a (2026-05-20): Accounts Payable roll-forward. Feeds
       *  the Balance Sheet (current liabilities) + Cash Flow (cash
       *  paid for opex). Per-asset + HQ rows + project totals. */}
      {renderAccountsPayableSection()}
    </div>
  );
}
