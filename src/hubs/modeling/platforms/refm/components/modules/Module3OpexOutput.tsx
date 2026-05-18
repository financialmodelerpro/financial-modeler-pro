'use client';

/**
 * Module3OpexOutput.tsx
 *
 * Read-only output surface for Module 3. Each operating asset gets a
 * Drivers + Calculations table:
 *   DRIVERS    Total Revenue / Direct Costs / Indirect Costs
 *   GOP        Revenue − Direct − Indirect (with margin row)
 *   BELOW GOP  Management fee, Replacement reserve, Rent & insurance,
 *              other fixed charges
 *   NOI        Revenue − Total Opex
 *
 * Project total table at the bottom aggregates per-asset opex plus
 * HQ corporate overheads.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeAllSellResults } from '../../lib/revenue-resolvers';
import { computeAllOpexResults } from '../../lib/opex-resolvers';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt, makePctFmt } from './_shared/numberFmt';
import {
  CELL_HEADER, CELL_HEADER_TOTAL, COLUMN_WIDTHS,
  ROW_DATA, ROW_GRAND_TOTAL, ROW_SUBTOTAL, TABLE_TITLE,
  nonLabelColumnPct,
} from './_shared/tableStyles';

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
  const pctFmt = makePctFmt(1);
  const currency = currencyHeaderLine(project.currency ?? 'SAR', scale);
  const yearLabels = snap.opex.yearLabels;

  // Phase grouping
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

  return (
    <div data-testid="module3-opex-output">
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Opex Output</h2>
        <p style={{ fontSize: 12, color: 'var(--color-meta)' }}>
          Per-asset operational expense build. Revenue → Direct costs → GOP → Indirect → Mgmt fee + other charges → NOI.
          Edit drivers on the Inputs tab.
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
            {phaseAssets.map((a) => {
              const r = snap.opex.byAsset.get(a.id);
              if (!r) return null;
              const isLease = a.strategy === 'Lease';

              // Source revenue stream for this asset's drivers row
              const revRow: number[] = (() => {
                if (isLease) {
                  return snap.rev.byLeaseAsset.get(a.id)?.totalRevenuePerPeriod ?? new Array(yearLabels.length).fill(0);
                }
                return snap.rev.byHospitalityAsset.get(a.id)?.totalRevenuePerPeriod ?? new Array(yearLabels.length).fill(0);
              })();

              const lineRows: Row[] = a.opex?.lines
                ? a.opex.lines.map((ln, i) => ({
                    label: ln.disabled ? `${ln.name} (off)` : ln.name,
                    values: r.perLinePerPeriod[i] ?? new Array(yearLabels.length).fill(0),
                    indent: 1,
                  }))
                : [];

              return (
                <div key={a.id} style={{ marginBottom: 'var(--sp-3)' }}>
                  <PeriodTable
                    title={`${a.name} (${a.strategy})`}
                    caption="Revenue → Direct → GOP → Indirect → Mgmt → Other → NOI"
                    yearLabels={yearLabels}
                    currency={currency}
                    fmt={fmt}
                    rows={[
                      { label: 'Drivers', isSection: true, values: [] },
                      { label: 'Total Revenue', values: revRow, indent: 1 },

                      { label: 'Direct costs', isSection: true, values: [] },
                      ...lineRows.filter((_, i) => {
                        const cat = a.opex?.lines?.[i]?.category;
                        return cat === 'direct_rooms' || cat === 'direct_fb' || cat === 'direct_other';
                      }),
                      { label: 'Total direct costs', values: r.directCostsPerPeriod, isSubtotal: true },

                      { label: 'Gross Operating Profit (GOP)', isSection: true, values: [] },
                      { label: 'GOP', values: r.gopPerPeriod, isSubtotal: true },
                      { label: 'GOP margin', values: r.gopMarginPerPeriod, indent: 1, rowFmt: pctFmt, aggregation: 'avg' },

                      { label: 'Indirect / undistributed costs', isSection: true, values: [] },
                      ...lineRows.filter((_, i) => {
                        const cat = a.opex?.lines?.[i]?.category ?? '';
                        return typeof cat === 'string' && cat.startsWith('indirect_');
                      }),
                      { label: 'Total indirect costs', values: r.indirectCostsPerPeriod, isSubtotal: true },

                      { label: 'Management fee + reserve', isSection: true, values: [] },
                      ...lineRows.filter((_, i) => {
                        const cat = a.opex?.lines?.[i]?.category ?? '';
                        return typeof cat === 'string' && (cat.startsWith('mgmt_') || cat === 'replacement_reserve');
                      }),
                      { label: 'Total management + reserve', values: r.managementFeePerPeriod, isSubtotal: true },

                      { label: 'Other fixed charges', isSection: true, values: [] },
                      ...lineRows.filter((_, i) => {
                        const cat = a.opex?.lines?.[i]?.category ?? '';
                        return ['rent_insurance', 'property_tax', 'utilities', 'cam', 'other'].indexOf(cat as string) >= 0;
                      }),
                      { label: 'Total other charges', values: r.otherOpexPerPeriod, isSubtotal: true },

                      { label: 'Bottom line', isSection: true, values: [] },
                      { label: 'Total Operating Expenses', values: r.totalOpexPerPeriod, isTotal: true },
                      { label: 'NOI (Revenue − Total Opex)', values: r.noiPerPeriod, isTotal: true },
                    ]}
                  />
                </div>
              );
            })}
          </div>
        );
      })}

      {/* HQ project-wide */}
      <PeriodTable
        title="HQ &amp; Corporate Overheads (project-wide)"
        caption="Lines configured on the Inputs tab. Fixed_baseline lines compound by their inflation rate; pct_of_total_rev lines scale with project total revenue."
        yearLabels={yearLabels}
        currency={currency}
        fmt={fmt}
        rows={[
          ...(project.hqOpex?.lines ?? []).map((ln, i) => ({
            label: ln.disabled ? `${ln.name} (off)` : ln.name,
            values: snap.opex.hq.perLinePerPeriod[i] ?? new Array(yearLabels.length).fill(0),
            indent: 1,
          })),
          { label: 'Total HQ Opex', values: snap.opex.hq.totalOpexPerPeriod, isTotal: true },
        ]}
      />

      {/* Project total */}
      <PeriodTable
        title="Project Total Opex"
        caption="Sum of per-asset opex plus HQ corporate overheads."
        yearLabels={yearLabels}
        currency={currency}
        fmt={fmt}
        rows={[
          { label: 'Direct costs', values: snap.opex.projectTotals.directCostsPerPeriod, indent: 1 },
          { label: 'Indirect costs', values: snap.opex.projectTotals.indirectCostsPerPeriod, indent: 1 },
          { label: 'Management fee + reserve', values: snap.opex.projectTotals.managementFeePerPeriod, indent: 1 },
          { label: 'Other fixed charges', values: snap.opex.projectTotals.otherOpexPerPeriod, indent: 1 },
          { label: 'HQ overheads', values: snap.opex.hq.totalOpexPerPeriod, indent: 1 },
          { label: 'Total Project Opex', values: snap.opex.totalOpexPerPeriodInclHQ, isTotal: true },
        ]}
      />
    </div>
  );
}
