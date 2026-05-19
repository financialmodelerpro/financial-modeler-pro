'use client';

/**
 * Module3OpexOutput.tsx (Pass 4, 2026-05-19)
 *
 * Restructured to category-wise tables. Each operating asset section
 * leads with a Revenue Breakdown table (Rooms / F&B / Other / Total
 * for hospitality, Total Revenue for retail) followed by stand-alone
 * tables per expense category:
 *   Hospitality: Direct Costs · Indirect / Undistributed Costs ·
 *                Management Fees · Reserves & Other Charges
 *   Retail:      Property Operating Costs · Pass-Through / Recoveries
 *                (memo) · Other Charges
 *
 * No GOP / NOI / margin rows — those compose in M4 P&L.
 *
 * The project-total section at the bottom rolls every asset up by
 * category, one row per asset that contributes to that category, plus
 * HQ overheads and a grand total Total Project Opex.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeAllSellResults } from '../../lib/revenue-resolvers';
import { computeAllOpexResults } from '../../lib/opex-resolvers';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import {
  CELL_HEADER, CELL_HEADER_TOTAL, COLUMN_WIDTHS,
  ROW_DATA, ROW_GRAND_TOTAL, ROW_SUBTOTAL, TABLE_TITLE,
  nonLabelColumnPct,
} from './_shared/tableStyles';
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
    return { rev, opex };
  }, [project, phases, assets, subUnits]);

  const scale: DisplayScale = (project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(project.currency ?? 'SAR', scale);
  const yearLabels = snap.opex.yearLabels;
  const N = yearLabels.length;

  // Phase grouping for the per-asset section.
  const phasesById = useMemo(() => {
    const m = new Map<string, typeof phases[number]>();
    for (const p of phases) m.set(p.id, p);
    return m;
  }, [phases]);

  const opexAssets = useMemo(() => assets.filter((a) => snap.opex.byAsset.has(a.id)), [assets, snap.opex.byAsset]);
  const phaseOrder = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const a of opexAssets) {
      if (a.phaseId && !seen.has(a.phaseId)) { seen.add(a.phaseId); order.push(a.phaseId); }
    }
    return order;
  }, [opexAssets]);

  // ─── per-asset section ───────────────────────────────────────────
  const renderHospitalityAsset = (a: typeof assets[number]): React.JSX.Element | null => {
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
      <div key={a.id} style={{ marginBottom: 'var(--sp-4)' }}>
        <div style={{
          background: 'var(--color-navy-pale, color-mix(in srgb, var(--color-navy) 10%, white))',
          border: '1px solid var(--color-navy)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 12px',
          fontWeight: 700,
          fontSize: 13,
          color: 'var(--color-navy)',
          marginBottom: 'var(--sp-2)',
        }}>
          {a.name} <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--color-meta)' }}>({a.strategy === 'Operate' ? 'Hospitality' : a.strategy})</span>
        </div>

        <PeriodTable
          title={`${a.name} — Revenue Breakdown`}
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={revRows}
        />

        <PeriodTable
          title={`${a.name} — Direct Costs`}
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
          title={`${a.name} — Indirect / Undistributed Costs`}
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
          title={`${a.name} — Management Fees`}
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
          title={`${a.name} — Reserves & Other Charges`}
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
      </div>
    );
  };

  const renderLeaseAsset = (a: typeof assets[number]): React.JSX.Element | null => {
    const r = snap.opex.byAsset.get(a.id);
    if (!r) return null;
    const rev = snap.rev.byLeaseAsset.get(a.id);
    const zeros = (): number[] => new Array<number>(N).fill(0);

    // M2 Lease engine surfaces only Total Revenue per asset; the
    // breakdown (Gross Rent / Service Charge / Other) is a future M2
    // refinement. Show what we have today.
    const revRows: Row[] = [
      { label: 'Total Lease Revenue', values: rev?.totalRevenuePerPeriod ?? zeros(), isTotal: true },
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
      <div key={a.id} style={{ marginBottom: 'var(--sp-4)' }}>
        <div style={{
          background: 'var(--color-navy-pale, color-mix(in srgb, var(--color-navy) 10%, white))',
          border: '1px solid var(--color-navy)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 12px',
          fontWeight: 700,
          fontSize: 13,
          color: 'var(--color-navy)',
          marginBottom: 'var(--sp-2)',
        }}>
          {a.name} <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--color-meta)' }}>(Retail / Lease)</span>
        </div>

        <PeriodTable
          title={`${a.name} — Revenue Breakdown`}
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          rows={revRows}
        />

        <PeriodTable
          title={`${a.name} — Property Operating Costs`}
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
          title={`${a.name} — Pass-Through / Recoveries (memo)`}
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
          title={`${a.name} — Other Charges`}
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
      </div>
    );
  };

  // ─── project total rollups, per category ─────────────────────────
  // Helper: sum the per-line arrays for a given asset, filtered by a
  // bucket predicate. Returns null when the asset contributes nothing
  // to that bucket so the row drops out of the rollup table.
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

  const rollupRows = (predicate: (cat: OpexLineCategory) => boolean, totalLabel: string): Row[] => {
    const rows: Row[] = [];
    const sums: number[][] = [];
    for (const a of opexAssets) {
      const arr = assetSumIn(a.id, predicate);
      if (!arr) continue;
      rows.push({ label: a.name, values: arr, indent: 1 });
      sums.push(arr);
    }
    if (rows.length === 0) return [];
    rows.push({ label: totalLabel, values: sumArrays(sums, N), isTotal: true });
    return rows;
  };

  return (
    <div data-testid="module3-opex-output">
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Opex Output</h2>
        <p style={{ fontSize: 12, color: 'var(--color-meta)' }}>
          Per-asset Revenue Breakdown followed by category-wise expense tables. Hospitality assets show
          Direct / Indirect / Management / Reserves; Retail assets show Property Operating / Recoveries /
          Other Charges. No GOP / NOI rows — those compose in M4 P&L.
        </p>
      </div>

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

      {phaseOrder.map((phaseId) => {
        const phase = phasesById.get(phaseId);
        if (!phase) return null;
        const phaseAssets = opexAssets.filter((a) => a.phaseId === phaseId);
        return (
          <div key={phaseId} style={{ marginBottom: 'var(--sp-4)' }}>
            <div style={{
              background: 'var(--color-navy)',
              color: 'var(--color-on-primary-navy)',
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              marginBottom: 'var(--sp-2)',
              fontWeight: 600,
            }}>
              {phase.name} ({phaseAssets.length} asset{phaseAssets.length === 1 ? '' : 's'})
            </div>
            {phaseAssets.map((a) => (
              a.strategy === 'Lease' ? renderLeaseAsset(a) : renderHospitalityAsset(a)
            ))}
          </div>
        );
      })}

      {/* HQ / project-wide */}
      <div style={{
        background: 'var(--color-navy)',
        color: 'var(--color-on-primary-navy)',
        padding: '8px 12px',
        borderRadius: 'var(--radius-sm)',
        marginBottom: 'var(--sp-2)',
        fontWeight: 600,
      }}>
        Project rollup
      </div>
      <PeriodTable
        title="HQ &amp; Corporate Overheads (project-wide)"
        caption="Lines configured on the Inputs tab. Fixed_baseline lines inherit the HQ inflation default; pct_of_total_rev lines scale with project total revenue."
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
        title="Project Total — Direct Costs"
        caption="Hospitality assets only."
        yearLabels={yearLabels}
        currency={currency}
        fmt={fmt}
        rows={rollupRows((c) => hospBucketFor(c) === 'direct', 'Project Total Direct Costs')}
      />

      <PeriodTable
        title="Project Total — Indirect / Operating Costs"
        caption="Hospitality Indirect lines and Retail Property Operating lines pooled here, one row per asset."
        yearLabels={yearLabels}
        currency={currency}
        fmt={fmt}
        rows={rollupRows(
          (c) => hospBucketFor(c) === 'indirect' || leaseBucketFor(c) === 'operating',
          'Project Total Indirect / Operating Costs',
        )}
      />

      <PeriodTable
        title="Project Total — Management Fees"
        caption="Hospitality management fee lines."
        yearLabels={yearLabels}
        currency={currency}
        fmt={fmt}
        rows={rollupRows((c) => hospBucketFor(c) === 'mgmt', 'Project Total Management Fees')}
      />

      <PeriodTable
        title="Project Total — Reserves & Other Charges"
        caption="Hospitality Reserves + Retail Recoveries + Retail Other Charges, one row per contributing asset."
        yearLabels={yearLabels}
        currency={currency}
        fmt={fmt}
        rows={rollupRows(
          (c) => hospBucketFor(c) === 'reserves'
            || leaseBucketFor(c) === 'recoveries'
            || leaseBucketFor(c) === 'other_charges',
          'Project Total Reserves & Other',
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
    </div>
  );
}
