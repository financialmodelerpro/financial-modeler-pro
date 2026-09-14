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
 * 2026-09-14: the tab renders the SHARED builder (lib/reports/opexReports),
 * per LINE, filed by the one section rule, like Revenue and Cost of Sales. A
 * hospitality line shows its operating statistics and its operating statement
 * down to GOP and EBITDA (lib/reports/hospitalityStatement); a lease line its
 * costs by kind and its net operating income. The PDF and the workbook render
 * the same tables. The per-asset renderers, the strategy-or-companion filing
 * and the rollups that counted the retail strips twice are gone.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { computeAllSellResults } from '../../lib/revenue-resolvers';
import { computeAllOpexResults, computeOpexApSnapshot } from '../../lib/opex-resolvers';
import { currencyHeaderLine, formatAccounting, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
import { makeFmt } from './_shared/numberFmt';
import {
  CELL_HEADER, CELL_HEADER_TOTAL, COLUMN_WIDTHS,
  ROW_DATA, ROW_GRAND_TOTAL, ROW_SUBTOTAL, TABLE_TITLE,
  nonLabelColumnPct,
  periodTableStyle,
  PERIOD_LABEL_PX, STICKY_DATA_BG, STICKY_SUBTOTAL_BG, freezeCol,
} from './_shared/tableStyles';
import { ScrollableTable } from './_shared/ScrollableTable';
import { PhaseSection, AssetSection } from './_shared/PhaseSection';
import { RevenueLineNav } from './_shared/RevenueLineNav';
import { buildOpexReport } from '../../lib/reports/opexReports';
import { planRevenueLines, REVENUE_SECTIONS, REVENUE_SECTION_KEY, REVENUE_SECTION_META } from '../../lib/revenueLines';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';

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
  /** From the shared builder (M4Row): a ratio, a count or a rate, and the
   *  lifetime figure where a sum is wrong (2026-09-14). */
  isPercent?: boolean;
  valueKind?: 'count' | 'rate';
  totalValue?: number;
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
      <ScrollableTable>
        <table style={periodTableStyle(1 + (hasPrior ? 1 : 0) + yearLabels.length)}>
          <colgroup>
            <col style={{ width: COLUMN_WIDTHS.label }} />
            <col style={{ width: nonLabelPct }} />
            {hasPrior && (<col style={{ width: nonLabelPct }} />)}
            {yearLabels.map((y) => (<col key={y} style={{ width: nonLabelPct }} />))}
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...CELL_HEADER, ...freezeCol(0) }}>Line</th>
              <th style={{ ...CELL_HEADER_TOTAL, ...freezeCol(PERIOD_LABEL_PX) }}>Total</th>
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
                        ...freezeCol(0),
                      }}
                    >{r.label}</td>
                  </tr>
                );
              }
              const tokens = r.isTotal ? ROW_GRAND_TOTAL : r.isSubtotal ? ROW_SUBTOTAL : ROW_DATA;
              const stickyBg = r.isTotal ? undefined : r.isSubtotal ? STICKY_SUBTOTAL_BG : STICKY_DATA_BG;
              const indent = r.indent ?? 0;
              const rowFmt = r.rowFmt
                ?? (r.isPercent
                  ? (v: number): string => (v === 0 ? '-' : `${(v * 100).toFixed(1)}%`)
                  : r.valueKind === 'count'
                    ? (v: number): string => formatAccounting(v, 'full', 0)
                    : r.valueKind === 'rate'
                      ? (v: number): string => formatAccounting(v, 'full', 2)
                      : fmt);
              const agg: Aggregation = r.aggregation ?? 'sum';
              let totalDisplay: string;
              if (r.totalOverride != null) totalDisplay = r.totalOverride;
              else if (r.totalValue !== undefined) totalDisplay = rowFmt(r.totalValue);
              else if (agg === 'sum') totalDisplay = rowFmt(r.values.reduce((s, v) => s + v, 0));
              else if (agg === 'last') totalDisplay = rowFmt(r.values[r.values.length - 1] ?? 0);
              else if (agg === 'avg') {
                const nonZero = r.values.filter((v) => v !== 0).length;
                totalDisplay = nonZero > 0 ? rowFmt(r.values.reduce((s, v) => s + v, 0) / nonZero) : '-';
              } else totalDisplay = '';
              return (
                <tr key={r.label + idx}>
                  <td style={{ ...tokens.name, paddingLeft: `${10 + indent * 12}px`, ...freezeCol(0, stickyBg) }}>{r.label}</td>
                  <td style={{ ...tokens.numTotal, ...freezeCol(PERIOD_LABEL_PX, stickyBg) }}>{totalDisplay}</td>
                  {hasPrior && (<td style={{ ...tokens.num, ...priorCellStyle }}>{rowFmt(0)}</td>)}
                  {r.values.map((v, j) => (<td key={j} style={tokens.num}>{rowFmt(v)}</td>))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}

export default function Module3OpexOutput(): React.JSX.Element {
  const { project, phases, parcels, assets: rawAssets, subUnits } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      parcels: s.parcels,
      assets: s.assets,
      subUnits: s.subUnits,
    })),
  );
  // The tab's asset list, with every name RESOLVED, so an asset the user has
  // not named shows as its type here rather than as a blank option. The memo
  // keeps the array stable: resolving inside the selector would hand
  // useShallow a new array every render.
  const assets = useMemo(() => withResolvedAssetNames(rawAssets, { parcels, phases }), [rawAssets, parcels, phases]);

  const snap = useMemo(() => {
    const rev = computeAllSellResults({ project, phases, assets, subUnits });
    const opex = computeAllOpexResults({ project, phases, assets, subUnits }, rev);
    const ap = computeOpexApSnapshot({ project, phases, parcels, assets }, opex);
    return { rev, opex, ap };
  }, [project, phases, parcels, assets, subUnits]);

  const scale: DisplayScale = (project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(project.currency ?? 'SAR', scale);
  const yearLabels = snap.opex.yearLabels;
  const N = yearLabels.length;

  // THE SHARED BUILDER, PER LINE, FILED BY SECTION (2026-09-14). The tab used
  // to build its own tables per asset and file them by strategy OR the
  // companion flag, which put both retail strips under Hospitality as well as
  // Retail, counted their costs twice in the rollups, dropped lease property
  // management (an `indirect_*` line) from the Retail tables, and showed no
  // GOP or NOI for a hotel anywhere. The PDF and the workbook render this
  // same list, so the three surfaces cannot drift.
  const tables = useMemo(
    () => buildOpexReport(
      { opex: snap.opex, revenue: snap.rev, axisLength: snap.rev.axisLength },
      { assets, subUnits, phases, project },
    ),
    [snap, assets, subUnits, phases, project],
  );
  const lines = useMemo(() => planRevenueLines(assets, subUnits, phases, project), [assets, subUnits, phases, project]);
  const lineTables = tables.filter((t) => t.lineKey);
  const projectTables = tables.filter((t) => !t.lineKey);

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
          One card per line (one type in one phase across its plots), filed under the same sections as Revenue.
          A hospitality line shows its operating statistics and its operating statement: revenue by department,
          departmental expenses, undistributed expenses, gross operating profit, management fees, fixed charges
          and reserves, down to EBITDA. A lease line shows its costs by kind and its net operating income.
        </p>
      </div>

      {/* ONE PILL PER LINE that carries opex, filed by the one rule. */}
      <RevenueLineNav
        lines={lines.filter((l) => lineTables.some((t) => t.lineKey === l.key))}
        idPrefix="m3-opex-out-line"
        testidPrefix="m3-opex-out-nav"
      />

      {lineTables.length === 0 && (
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

      {REVENUE_SECTIONS.map((section) => {
        const sectionTables = lineTables.filter((t) => t.section === section);
        if (sectionTables.length === 0) return null;
        const lineKeys = Array.from(new Set(sectionTables.map((t) => t.lineKey ?? '')));
        const sectionKey = REVENUE_SECTION_KEY[section];
        return (
          <PhaseSection
            key={section}
            phaseId={`section-${sectionKey}-opex`}
            title={section}
            meta={REVENUE_SECTION_META[section]}
            countLabel={`${lineKeys.length} line${lineKeys.length === 1 ? '' : 's'}`}
            storageKey={`fmp:m3:opex:section:${sectionKey}:collapsed`}
            assetIds={lineKeys}
          >
            {lineKeys.map((key) => {
              const line = lines.find((l) => l.key === key);
              return (
                <AssetSection
                  key={key}
                  assetId={key}
                  domId={`m3-opex-out-line-${key}`}
                  title={line ? line.label : key}
                  meta={line?.phaseName}
                  storageKey={`fmp:m3:opex:line:${key}:collapsed`}
                >
                  {sectionTables.filter((t) => t.lineKey === key).map((t) => (
                    <PeriodTable
                      key={t.title}
                      title={t.title}
                      yearLabels={yearLabels}
                      currency={currency}
                      fmt={fmt}
                      rows={t.rows}
                    />
                  ))}
                </AssetSection>
              );
            })}
          </PhaseSection>
        );
      })}

      <PhaseSection
        phaseId="__project__"
        title="Project Total"
        meta="hospitality summary, HQ overheads and the project opex"
        storageKey="fmp:m3:opex:phase:__project__:collapsed"
      >
        {projectTables.map((t) => (
          <PeriodTable
            key={t.title}
            title={t.title}
            yearLabels={yearLabels}
            currency={currency}
            fmt={fmt}
            rows={t.rows}
          />
        ))}
      </PhaseSection>

      {/* M4 Pass 2a (2026-05-20): Accounts Payable roll-forward. Feeds
       *  the Balance Sheet (current liabilities) + Cash Flow (cash
       *  paid for opex). Per-asset + HQ rows + project totals. */}
      {renderAccountsPayableSection()}
    </div>
  );
}
