'use client';

/**
 * Module4FixedAssets.tsx (M4 Pass 1c, 2026-05-19)
 *
 * Asset-level Fixed Assets + Depreciation tab. Surface follows the
 * universal Revenue / CoS / Opex pattern:
 *
 *   Strategy section (Hospitality / Operations, Retail / Lease)
 *     AssetSection, collapsible card per asset
 *       Inputs panel: useful life (+ existing-ops historical Land /
 *                     Building NBV when present)
 *       Table 1: Land, Roll-Forward (Opening + Additions = Closing)
 *       Table 2: Depreciable Assets, Roll-Forward (Opening + Additions
 *                − Depreciation = Closing + Accumulated Depreciation)
 *       Table 3: Total Fixed Assets (Land + Depreciable closing)
 *   Project Total, same three tables aggregated across every asset,
 *   plus the capitalised interest pool split held vs Sell inventory.
 *
 * THE ROWS ARE BUILT ONCE (2026-09-17): `lib/reports/fixedAssetReports.ts`
 * builds every table on this tab, and the workbook's Schedules tab renders the
 * same builder, so the screen and the export cannot drift. This file keeps only
 * what a screen owns: the snapshots it computes, the editable inputs and the
 * rendering.
 *
 * Phase nesting dropped per user direction (asset level, not phase
 * level). Strategy outer kept for consistency with the rest of the
 * platform. Sell + Sell+Manage parents are excluded entirely (capex
 * flows through M2 Cost of Sales).
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { type DisposalContext } from '../../lib/reports/disposalSchedules';
import { buildFixedAssetReport, type FixedAssetRow, type FixedAssetTable } from '../../lib/reports/fixedAssetReports';
import { resolveReturnsConfig } from '../../lib/returns-resolvers';
import {
  computeAllFixedAssetResults,
  type ProjectFixedAssetSnapshot,
} from '../../lib/fixed-assets-resolvers';
import { computeIdcSnapshot } from '../../lib/financials-resolvers';
import { computeFinancingResult } from '@/src/core/calculations/financing';
import { DEFAULT_PROJECT_FINANCING_CONFIG } from '../../lib/state/module1-types';
import { currencyHeaderLine, type DisplayScale, type DisplayDecimals } from '@/src/core/formatters';
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
import { AssetQuickNav } from './_shared/AssetQuickNav';
import { PercentageInput } from '../ui/PercentageInput';
import { FAST_INPUT } from './_shared/inputStyles';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';

type Row = FixedAssetRow & { isSection?: boolean; totalOverride?: string };

function PeriodTable({ title, caption, yearLabels, rows, currency, fmt, priorYearLabel }: {
  title: string; caption?: string; yearLabels: number[]; rows: Row[]; currency: string;
  fmt: (v: number) => string;
  /** M4 Pass 2X (2026-05-24): show a prior-year column between Total and Y0
   *  for consistency with M1 Capex Results + Module 4 BS / CF / P&L. */
  priorYearLabel?: number;
}): React.JSX.Element {
  if (rows.length === 0) return <></>;
  const hasPrior = priorYearLabel !== undefined;
  const colCount = (hasPrior ? 2 : 1) + yearLabels.length;
  const nonLabelPct = nonLabelColumnPct(colCount);
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <span style={TABLE_TITLE}>{title} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-meta)' }}>({currency})</span></span>
      {caption && (
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 6, fontStyle: 'italic' }}>{caption}</div>
      )}
      <ScrollableTable>
        <table style={periodTableStyle(colCount)}>
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
              {hasPrior && (<th style={{ ...CELL_HEADER, fontStyle: 'italic', color: 'var(--color-meta)' }}>{priorYearLabel}</th>)}
              {yearLabels.map((y) => (<th key={y} style={CELL_HEADER}>{y}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              if (r.isSection) {
                return (
                  <tr key={`section-${idx}`}>
                    <td colSpan={(hasPrior ? 3 : 2) + yearLabels.length}
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
              const agg = r.aggregation ?? 'sum';
              const totalDisplay = r.totalOverride ?? (
                agg === 'last'
                  ? fmt(r.values[r.values.length - 1] ?? 0)
                  : fmt(r.values.reduce((s, v) => s + (v ?? 0), 0))
              );
              const priorStyle: React.CSSProperties = { ...tokens.num, fontStyle: 'italic', color: 'var(--color-meta)' };
              return (
                <tr key={r.label + idx}>
                  <td style={{ ...tokens.name, paddingLeft: `${10 + indent * 12}px`, ...freezeCol(0, stickyBg) }}>{r.label}</td>
                  <td style={{ ...tokens.numTotal, ...freezeCol(PERIOD_LABEL_PX, stickyBg) }}>{totalDisplay}</td>
                  {hasPrior && (<td style={priorStyle}>{r.priorValue !== undefined ? fmt(r.priorValue) : ''}</td>)}
                  {r.values.map((v, j) => (<td key={j} style={tokens.num}>{fmt(v ?? 0)}</td>)) }
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}

export default function Module4FixedAssets(): React.JSX.Element {
  const { project, phases, assets: rawAssets, subUnits, parcels, costLines, costOverrides, landAllocationMode, financingTranches, equityContributions, updateAsset: updateOneAsset } = useModule1Store(
    useShallow((s) => ({
      project: s.project,
      phases: s.phases,
      parcels: s.parcels,
      assets: s.assets,
      subUnits: s.subUnits,
      costLines: s.costLines,
      costOverrides: s.costOverrides,
      landAllocationMode: s.landAllocationMode,
      financingTranches: s.financingTranches,
      equityContributions: s.equityContributions,
      updateAsset: s.updateAsset,
    })),
  );
  // The tab's asset list, with every name RESOLVED, so an asset the user has
  // not named shows as its type here rather than as a blank option. The memo
  // keeps the array stable: resolving inside the selector would hand
  // useShallow a new array every render.
  const assets = useMemo(() => withResolvedAssetNames(rawAssets, { parcels, phases }), [rawAssets, parcels, phases]);

  const snap: ProjectFixedAssetSnapshot = useMemo(
    () => computeAllFixedAssetResults({ project, phases, assets, subUnits, parcels, costLines, costOverrides, landAllocationMode }),
    [project, phases, assets, subUnits, parcels, costLines, costOverrides, landAllocationMode],
  );

  // M4 Pass 2Q (2026-05-24): pull the IDC snapshot so per-asset
  // Depreciable Roll-Forward can integrate IDC additions + depreciation
  // alongside capex (depreciation = on Capex + IDC).
  const financing = useMemo(
    () => computeFinancingResult({
      project, phases, parcels, assets, subUnits, costLines, costOverrides,
      landAllocationMode,
      financingConfig: project.financing ?? DEFAULT_PROJECT_FINANCING_CONFIG,
      tranches: financingTranches,
      equityContributions,
    }),
    [project, phases, parcels, assets, subUnits, costLines, costOverrides, landAllocationMode, financingTranches, equityContributions],
  );
  const idcSnap = useMemo(
    () => computeIdcSnapshot(
      { project, phases, assets, subUnits, parcels, landAllocationMode },
      financing,
      { axisLength: snap.axisLength, projectStartYear: snap.projectStartYear },
    ),
    [project, phases, assets, subUnits, parcels, landAllocationMode, financing, snap.axisLength, snap.projectStartYear],
  );

  // THE DISPOSAL THE BALANCE SHEET BOOKED (2026-09-16, step 10). This tab computes
  // its own fixed asset and IDC snapshots, so it resolves the exit the same way the
  // composer does: the terminal method decides whether anything is sold at all.
  const disposalCtx: DisposalContext = useMemo(() => {
    const cfg = resolveReturnsConfig(project, snap.axisLength);
    return { booked: cfg.terminalMethod !== 'none', exitIdx: cfg.exitYearOffset, axisLength: snap.axisLength };
  }, [project, snap.axisLength]);

  // Every table on the tab, from the shared builder the workbook renders too.
  const report = useMemo(
    () => buildFixedAssetReport({ fa: snap, idc: idcSnap, state: { assets, phases, parcels }, dCtx: disposalCtx }),
    [snap, idcSnap, assets, phases, parcels, disposalCtx],
  );

  const scale: DisplayScale = (project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(project.currency ?? 'SAR', scale);
  const yearLabels = snap.yearLabels;
  // M4 Pass 2X (2026-05-24): prior-year column for consistency with the
  // rest of the platform. Opening Land + Opening NBV land in the prior
  // column instead of being lumped into Y0.
  const priorYear = snap.projectStartYear - 1;

  // ONE CARD AND ONE INPUT ROW PER CONSOLIDATED LINE (2026-09-15). The engine
  // stays per asset: an input typed on a line is written to every plot on it,
  // as the capex and revenue line cards already do.
  const membersOf = (hostId: string): readonly string[] => report.inputs.find((i) => i.hostId === hostId)?.memberIds ?? [hostId];
  const updateAsset = (assetId: string, patch: Parameters<typeof updateOneAsset>[1]): void => {
    for (const id of membersOf(assetId)) updateOneAsset(id, patch);
  };
  const navAssets = useMemo(
    () => report.groups.flatMap((g) => g.lines).map((l) => ({ ...assets.find((a) => a.id === l.hostId)!, name: l.title })),
    [report, assets],
  );

  const setAssetUsefulLife = (assetId: string, life: number): void => {
    updateAsset(assetId, { usefulLifeYears: Math.max(0, Math.floor(life)) });
  };
  const setAssetMethod = (assetId: string, method: 'straight_line' | 'reducing_balance'): void => {
    updateAsset(assetId, { depreciationMethod: method });
  };
  const setAssetRate = (assetId: string, rate: number | undefined): void => {
    updateAsset(assetId, { depreciationRate: rate });
  };

  const renderTable = (t: FixedAssetTable, key: string): React.JSX.Element => (
    <PeriodTable key={key} title={t.title} caption={t.caption} yearLabels={yearLabels} currency={currency} fmt={fmt} priorYearLabel={priorYear} rows={t.rows} />
  );

  return (
    <div data-testid="module4-fixed-assets" style={{ padding: 'var(--sp-3)', width: '100%' }}>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h1 style={{ fontSize: 'var(--font-h2)', color: 'var(--color-heading)', margin: 0 }}>Module 4 · Fixed Assets &amp; Depreciation</h1>
        <div style={{ fontSize: 11, color: 'var(--color-meta)', marginTop: 2, fontStyle: 'italic' }}>
          {currency}
        </div>
        <p style={{ color: 'var(--color-meta)', marginTop: 4, fontSize: 'var(--font-small)' }}>
          Per-asset Land + Depreciable Asset roll-forwards. Land sits on the balance sheet but never depreciates;
          Depreciable Assets follow straight-line over the asset's useful life. Hospitality + Retail / Lease + Sell
          + Manage companions are tracked here; Sell and Sell + Manage parents flow through Module 2 Cost of Sales.
          Existing operations seed Opening Land + Building NBV from Module 1 Tab 4. Project Total rolls every asset
          up at the bottom, mirroring Revenue and Costs.
        </p>
      </div>

      {report.inputs.length === 0 && (
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

      {/* M2 Pass 9M (2026-05-21): asset quick-nav strip. */}
      <AssetQuickNav assets={navAssets} idPrefix="m4-fa-asset" testidPrefix="m4-fa-nav" />

      {/* M4 Pass 2i (2026-05-20): consolidated Inputs table at the top
       *  of the tab. Per Ahmad: every asset's Method / Useful Life /
       *  Rate should be edited in one place at the top, not buried
       *  inside each asset card. Opening Land + Building NBV shown as
       *  read-only memos when the asset carries existing-ops history.
       */}
      {report.inputs.length > 0 && (
        <PhaseSection
          phaseId="m4-fa-inputs"
          title="Depreciation Inputs (all assets)"
          meta="Method, useful life, and rate per asset, edited in one place"
          storageKey="fmp:m4:fa:inputs:collapsed"
        >
          <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={CELL_HEADER}>Asset</th>
                  <th style={CELL_HEADER}>Strategy</th>
                  <th style={CELL_HEADER}>Method</th>
                  <th style={CELL_HEADER}>Useful Life (yrs)</th>
                  <th style={CELL_HEADER}>Rate</th>
                  <th style={CELL_HEADER}>Opening Land</th>
                  <th style={CELL_HEADER}>Opening Bldg NBV</th>
                </tr>
              </thead>
              <tbody>
                {report.inputs.map((i) => {
                  const isRB = i.method === 'reducing_balance';
                  return (
                    <tr key={i.hostId}>
                      <td style={{ ...ROW_DATA.name }}>{i.title}</td>
                      <td style={{ ...ROW_DATA.name, color: 'var(--color-meta)', fontSize: 11 }}>{i.strategyLabel}</td>
                      <td style={{ ...ROW_DATA.num, textAlign: 'left' }}>
                        <select
                          value={i.method}
                          onChange={(e) => setAssetMethod(i.hostId, e.target.value as 'straight_line' | 'reducing_balance')}
                          style={{ ...FAST_INPUT, textAlign: 'left' }}
                          data-testid={`m4-fa-inputs-method-${i.hostId}`}
                        >
                          <option value="straight_line">Straight Line (SL)</option>
                          <option value="reducing_balance">Reducing Balance (WDV)</option>
                        </select>
                      </td>
                      <td style={{ ...ROW_DATA.num }}>
                        <input
                          type="number"
                          value={i.inheritsLife ? '' : i.lifeStored}
                          placeholder={`auto: ${i.lifeEffective}`}
                          min={0}
                          max={60}
                          onChange={(e) => {
                            const v = e.target.value;
                            setAssetUsefulLife(i.hostId, v === '' ? 0 : Number(v));
                          }}
                          style={FAST_INPUT}
                          data-testid={`m4-fa-inputs-life-${i.hostId}`}
                        />
                      </td>
                      <td style={{ ...ROW_DATA.num }}>
                        {isRB ? (
                          <PercentageInput
                            value={i.rateEffective * 100}
                            onChange={(p) => setAssetRate(i.hostId, p / 100)}
                            min={0}
                            max={100}
                            decimals={2}
                            style={FAST_INPUT}
                            data-testid={`m4-fa-inputs-rate-${i.hostId}`}
                          />
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--color-meta)', fontStyle: 'italic' }}>
                            {i.lifeEffective > 0 ? `${(i.rateEffective * 100).toFixed(2)}% / yr` : '-'}
                          </span>
                        )}
                      </td>
                      <td style={{ ...ROW_DATA.num, color: i.openingLand > 0 ? 'var(--color-text)' : 'var(--color-meta)', fontStyle: i.openingLand > 0 ? 'normal' : 'italic' }}>
                        {i.openingLand > 0 ? fmt(i.openingLand) : '-'}
                      </td>
                      <td style={{ ...ROW_DATA.num, color: i.openingBuilding > 0 ? 'var(--color-text)' : 'var(--color-meta)', fontStyle: i.openingBuilding > 0 ? 'normal' : 'italic' }}>
                        {i.openingBuilding > 0 ? fmt(i.openingBuilding) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 6, fontStyle: 'italic' }}>
            {report.inputsCaption}
          </div>
        </PhaseSection>
      )}

      {/* Hospitality / Operations, then Retail / Lease: one group per strategy, a line in exactly one. */}
      {report.groups.map((g) => (
        <PhaseSection
          key={g.key}
          phaseId={g.key === 'hospitality' ? 'strategy-hospitality' : 'strategy-retail'}
          title={g.title}
          meta={g.meta}
          countLabel={`${g.lines.length} asset${g.lines.length === 1 ? '' : 's'}`}
          storageKey={`fmp:m4:fa:strategy:${g.key}:collapsed`}
          assetIds={g.lines.map((l) => l.hostId)}
        >
          {g.lines.length === 0 && (
            <div style={{ padding: '8px 12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
              {g.emptyText}
            </div>
          )}
          {g.lines.map((l) => (
            <AssetSection
              key={l.hostId}
              assetId={l.hostId}
              domId={`m4-fa-asset-${l.hostId}`}
              title={l.title}
              meta={l.meta}
              storageKey={`fmp:m4:fa:asset:${l.hostId}:collapsed`}
            >
              {renderTable(l.land, 'land')}
              {renderTable(l.depreciable, 'dep')}
              {renderTable(l.total, 'total')}
            </AssetSection>
          ))}
        </PhaseSection>
      ))}

      {/* Project rollup */}
      <PhaseSection
        phaseId="__project__"
        title="Project Total"
        meta="all assets combined"
        storageKey="fmp:m4:fa:phase:__project__:collapsed"
      >
        {renderTable(report.project.land, 'land')}
        {renderTable(report.project.depreciable, 'dep')}
        {renderTable(report.project.total, 'total')}
        {report.project.idcPool && renderTable(report.project.idcPool, 'idc')}
      </PhaseSection>
    </div>
  );
}
