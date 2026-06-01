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
 *   Project Total, same three tables aggregated across every asset.
 *
 * Phase nesting dropped per user direction (asset level, not phase
 * level). Strategy outer kept for consistency with the rest of the
 * platform. Sell + Sell+Manage parents are excluded entirely (capex
 * flows through M2 Cost of Sales).
 *
 * Engine handles only the depreciable roll-forward. Land is composed
 * in fixed-assets-resolvers.ts (pure additive); both are surfaced here
 * side-by-side so the user sees Land never depreciating.
 */

import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import {
  computeAllFixedAssetResults,
  type AssetFixedAssetRow,
  type LandRollForward,
  type ProjectFixedAssetSnapshot,
} from '../../lib/fixed-assets-resolvers';
import { computeIdcSnapshot, type AssetIDCRow } from '../../lib/financials-resolvers';
import { computeFinancingResult } from '@/src/core/calculations/financing';
import { DEFAULT_PROJECT_FINANCING_CONFIG } from '../../lib/state/module1-types';
import { resolveUsefulLifeYears } from '@/src/core/calculations';
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
import { PercentageInput } from '../ui/PercentageInput';
import { FAST_INPUT } from './_shared/inputStyles';

interface Row {
  label: string;
  values: number[];
  isTotal?: boolean;
  isSubtotal?: boolean;
  isSection?: boolean;
  indent?: number;
  totalOverride?: string;
  aggregation?: 'sum' | 'last';
  /** M4 Pass 2X (2026-05-24): prior-year opening value for stock rows. */
  priorValue?: number;
}

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
      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
        <table style={periodTableStyle(colCount)}>
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
              const priorStyle: React.CSSProperties = { ...tokens.num, fontStyle: 'italic', color: 'var(--color-meta)' };
              return (
                <tr key={r.label + idx}>
                  <td style={{ ...tokens.name, paddingLeft: `${10 + indent * 12}px` }}>{r.label}</td>
                  <td style={tokens.numTotal}>{totalDisplay}</td>
                  {hasPrior && (<td style={priorStyle}>{r.priorValue !== undefined ? fmt(r.priorValue) : ''}</td>)}
                  {r.values.map((v, j) => (<td key={j} style={tokens.num}>{fmt(v ?? 0)}</td>)) }
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function landTableRows(land: LandRollForward): Row[] {
  // M4 Pass 2X (2026-05-24): opening at t=0 represents pre-axis Land
  // carry (operational phase historicalPreCapexLand). Show in prior col.
  const openingAtZero = land.openingPerPeriod[0] ?? 0;
  return [
    { label: 'Opening Land', values: land.openingPerPeriod, indent: 1, aggregation: 'last', priorValue: openingAtZero },
    { label: '(+) Land Additions', values: land.additionsPerPeriod, indent: 1, priorValue: 0 },
    { label: 'Closing Land', values: land.closingPerPeriod, isTotal: true, aggregation: 'last', priorValue: openingAtZero },
  ];
}

function depreciableTableRows(row: AssetFixedAssetRow, idc?: AssetIDCRow): Row[] {
  const d = row.depreciable;
  // M4 Pass 2Q (2026-05-24): integrate IDC into the depreciable roll-
  // forward when it's nonzero for this asset. Layout per user:
  //   Opening + (+) Capex Additions + (+) IDC Additions − Depreciation = Closing
  // Depreciation is on (Capex + IDC) combined. Capex NBV + IDC NBV are
  // shown as memo splits beneath so the user can see the source of the
  // closing balance.
  const N = d.openingNBVPerPeriod.length;
  const idcAdditions = idc ? idc.idcPerPeriod.slice(0, N) : new Array<number>(N).fill(0);
  const idcDep = idc ? idc.depreciationPerPeriod.slice(0, N) : new Array<number>(N).fill(0);
  const idcNbv = idc ? idc.closingNbvPerPeriod.slice(0, N) : new Array<number>(N).fill(0);
  const hasIdc = (idc?.totalIdc ?? 0) > 0;

  const combinedOpening = new Array<number>(N).fill(0);
  const combinedClosing = new Array<number>(N).fill(0);
  const combinedDep = new Array<number>(N).fill(0);
  for (let t = 0; t < N; t++) {
    // Combined opening at t = capex opening + IDC opening.
    // IDC opening = previous-period IDC closing (zero at t=0).
    const idcOpening = t === 0 ? 0 : (idcNbv[t - 1] ?? 0);
    combinedOpening[t] = (d.openingNBVPerPeriod[t] ?? 0) + idcOpening;
    combinedClosing[t] = (d.closingNBVPerPeriod[t] ?? 0) + (idcNbv[t] ?? 0);
    combinedDep[t] = (d.depreciationPerPeriod[t] ?? 0) + (idcDep[t] ?? 0);
  }

  // M4 Pass 2X (2026-05-24): opening NBV at t=0 = pre-axis carry
  // (operational phase historicalPreCapexBuilding). Show in prior col.
  const openingAtZeroCapex = d.openingNBVPerPeriod[0] ?? 0;
  const openingAtZeroCombined = combinedOpening[0] ?? 0;
  if (!hasIdc) {
    return [
      { label: 'Opening NBV', values: d.openingNBVPerPeriod, indent: 1, aggregation: 'last', priorValue: openingAtZeroCapex },
      { label: '(+) Capex Additions', values: d.additionsPerPeriod, indent: 1, priorValue: 0 },
      { label: '(−) Depreciation', values: d.depreciationPerPeriod.map((v) => -v), indent: 1, priorValue: 0 },
      { label: 'Closing NBV', values: d.closingNBVPerPeriod, isTotal: true, aggregation: 'last', priorValue: openingAtZeroCapex },
      { label: 'Accumulated Depreciation (memo)', values: d.accumDepPerPeriod, indent: 1, aggregation: 'last', priorValue: 0 },
    ];
  }
  return [
    { label: 'Opening NBV (Capex + IDC)', values: combinedOpening, indent: 1, aggregation: 'last', priorValue: openingAtZeroCombined },
    { label: '(+) Capex Additions', values: d.additionsPerPeriod, indent: 1, priorValue: 0 },
    { label: '(+) IDC Additions (capitalised interest)', values: idcAdditions, indent: 1, priorValue: 0 },
    { label: '(−) Depreciation (on Capex + IDC)', values: combinedDep.map((v) => -v), indent: 1, priorValue: 0 },
    { label: 'Closing NBV (Capex + IDC)', values: combinedClosing, isTotal: true, aggregation: 'last', priorValue: openingAtZeroCombined },
    { label: '   of which: Capex NBV', values: d.closingNBVPerPeriod, indent: 2, aggregation: 'last', priorValue: openingAtZeroCapex },
    { label: '   of which: IDC NBV', values: idcNbv, indent: 2, aggregation: 'last', priorValue: 0 },
    { label: 'Accumulated Capex Depreciation (memo)', values: d.accumDepPerPeriod, indent: 1, aggregation: 'last', priorValue: 0 },
  ];
}

function totalFATableRows(combinedOpening: number[], combinedClosing: number[], landClose: number[], depClose: number[]): Row[] {
  return [
    { label: 'Opening Fixed Assets (Land + Depreciable)', values: combinedOpening, indent: 1, aggregation: 'last' },
    { label: '   of which: Land', values: landClose.map((_, i) => (i === 0 ? combinedOpening[0] - depClose[0] : combinedOpening[i] - depClose[i])), indent: 2, aggregation: 'last' },
    { label: '   of which: Depreciable NBV', values: depClose.map((_, i) => (combinedOpening[i] - (combinedOpening[i] - depClose[i]))), indent: 2, aggregation: 'last' },
    { label: 'Closing Fixed Assets (Land + Depreciable)', values: combinedClosing, isTotal: true, aggregation: 'last' },
  ];
}

export default function Module4FixedAssets(): React.JSX.Element {
  const { project, phases, assets, subUnits, parcels, costLines, costOverrides, landAllocationMode, financingTranches, equityContributions, updateAsset } = useModule1Store(
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
      updateAsset: s.updateAsset,
    })),
  );

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

  const scale: DisplayScale = (project.displayScale ?? 'thousands');
  const decimals: DisplayDecimals = (project.displayDecimals ?? 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);
  const currency = currencyHeaderLine(project.currency ?? 'SAR', scale);
  const yearLabels = snap.yearLabels;
  const N = yearLabels.length;
  // M4 Pass 2X (2026-05-24): prior-year column for consistency with the
  // rest of the platform. Opening Land + Opening NBV land in the prior
  // column instead of being lumped into Y0.
  const priorYear = snap.projectStartYear - 1;

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

  const setAssetUsefulLife = (assetId: string, life: number): void => {
    updateAsset(assetId, { usefulLifeYears: Math.max(0, Math.floor(life)) });
  };
  const setAssetMethod = (assetId: string, method: 'straight_line' | 'reducing_balance'): void => {
    updateAsset(assetId, { depreciationMethod: method });
  };
  const setAssetRate = (assetId: string, rate: number | undefined): void => {
    updateAsset(assetId, { depreciationRate: rate });
  };

  const renderAssetBody = (a: typeof assets[number]): React.JSX.Element | null => {
    const row = snap.byAsset.get(a.id);
    if (!row) return null;
    // M4 Pass 2i (2026-05-20): per-asset inputs panel removed from the
    // card body and consolidated into a single inputs table at the top
    // of the tab. Body now renders only the three roll-forward tables.
    const lifeEffective = row.usefulLifeYears;
    const method = a.depreciationMethod ?? 'straight_line';
    const isRB = method === 'reducing_balance';
    const rateStored = a.depreciationRate;
    const defaultRBRate = lifeEffective > 0 ? 2 / lifeEffective : 0;
    const effectiveRate = isRB ? (rateStored !== undefined ? rateStored : defaultRBRate) : 0;
    const methodLabel = isRB
      ? `Reducing Balance @ ${(effectiveRate * 100).toFixed(2)}%`
      : `Straight Line ${lifeEffective} yrs`;

    // Total FA rows: prefer using engine-derived openings + closings
    // directly so we don't reconstruct Land vs Depreciable from
    // closing balances (which can drift after a depreciation step).
    const totalFA: Row[] = [
      { label: 'Opening Land', values: row.land.openingPerPeriod, indent: 1, aggregation: 'last' },
      { label: 'Opening Depreciable NBV', values: row.depreciable.openingNBVPerPeriod, indent: 1, aggregation: 'last' },
      { label: 'Opening Fixed Assets', values: row.combinedOpeningPerPeriod, isSubtotal: true, aggregation: 'last' },
      { label: 'Closing Land', values: row.land.closingPerPeriod, indent: 1, aggregation: 'last' },
      { label: 'Closing Depreciable NBV', values: row.depreciable.closingNBVPerPeriod, indent: 1, aggregation: 'last' },
      { label: 'Closing Fixed Assets', values: row.combinedClosingPerPeriod, isTotal: true, aggregation: 'last' },
    ];

    return (
      <>
        <PeriodTable
          title={`${a.name}: Land Roll-Forward`}
          caption="Land sits on the balance sheet but never depreciates. Closing Land = Opening Land + Land Additions."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={landTableRows(row.land)}
        />

        <PeriodTable
          title={`${a.name}: Depreciable Assets Roll-Forward`}
          caption={`${methodLabel}. Closing NBV = Opening + Capex Additions + IDC Additions − Depreciation. When IDC is present, depreciation applies to both Capex AND IDC; the closing split is shown beneath.`}
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={depreciableTableRows(row, idcSnap.byAsset.get(a.id))}
        />

        <PeriodTable
          title={`${a.name}: Total Fixed Assets (Land + Depreciable)`}
          caption="Sum of Land closing + Depreciable closing NBV. This is the asset's Fixed Assets line on the balance sheet."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={totalFA}
        />
      </>
    );
  };

  // Project totals, Land roll-forward, Depreciable roll-forward,
  // and Combined Total Fixed Assets.
  const projectLand = snap.projectTotals.land;
  const projectDep = snap.projectTotals.depreciable;
  const projectTotalRows: Row[] = [
    { label: 'Opening Land', values: projectLand.openingPerPeriod, indent: 1, aggregation: 'last' },
    { label: 'Opening Depreciable NBV', values: projectDep.openingNBVPerPeriod, indent: 1, aggregation: 'last' },
    { label: 'Opening Fixed Assets', values: snap.projectTotals.combinedOpeningPerPeriod, isSubtotal: true, aggregation: 'last' },
    { label: 'Closing Land', values: projectLand.closingPerPeriod, indent: 1, aggregation: 'last' },
    { label: 'Closing Depreciable NBV', values: projectDep.closingNBVPerPeriod, indent: 1, aggregation: 'last' },
    { label: 'Closing Fixed Assets', values: snap.projectTotals.combinedClosingPerPeriod, isTotal: true, aggregation: 'last' },
  ];

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

      {/* M2 Pass 9M (2026-05-21): asset quick-nav strip. */}
      <AssetQuickNav assets={assets} idPrefix="m4-fa-asset" testidPrefix="m4-fa-nav" />

      {/* M4 Pass 2i (2026-05-20): consolidated Inputs table at the top
       *  of the tab. Per Ahmad: every asset's Method / Useful Life /
       *  Rate should be edited in one place at the top, not buried
       *  inside each asset card. Opening Land + Building NBV shown as
       *  read-only memos when the asset carries existing-ops history.
       */}
      {faAssets.length > 0 && (
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
                {faAssets.map((a) => {
                  const row = snap.byAsset.get(a.id);
                  if (!row) return null;
                  const lifeStored = a.usefulLifeYears;
                  const lifeEffective = row.usefulLifeYears;
                  const inheriting = lifeStored === undefined || lifeStored <= 0;
                  const openingLand = row.land.openingAtAxisStart;
                  const openingBuilding = row.depreciable.openingNBVPerPeriod[0] ?? 0;
                  const method = a.depreciationMethod ?? 'straight_line';
                  const isRB = method === 'reducing_balance';
                  const rateStored = a.depreciationRate;
                  const defaultRBRate = lifeEffective > 0 ? 2 / lifeEffective : 0;
                  const strategyLabel = a.strategy === 'Operate'
                    ? (a.isCompanion ? 'Hospitality (Manage)' : 'Hospitality')
                    : a.strategy === 'Lease' ? 'Retail / Lease' : a.strategy;
                  return (
                    <tr key={a.id}>
                      <td style={{ ...ROW_DATA.name }}>{a.name}</td>
                      <td style={{ ...ROW_DATA.name, color: 'var(--color-meta)', fontSize: 11 }}>{strategyLabel}</td>
                      <td style={{ ...ROW_DATA.num, textAlign: 'left' }}>
                        <select
                          value={method}
                          onChange={(e) => setAssetMethod(a.id, e.target.value as 'straight_line' | 'reducing_balance')}
                          style={{ ...FAST_INPUT, textAlign: 'left' }}
                          data-testid={`m4-fa-inputs-method-${a.id}`}
                        >
                          <option value="straight_line">Straight Line (SL)</option>
                          <option value="reducing_balance">Reducing Balance (WDV)</option>
                        </select>
                      </td>
                      <td style={{ ...ROW_DATA.num }}>
                        <input
                          type="number"
                          value={inheriting ? '' : lifeStored}
                          placeholder={`auto: ${lifeEffective}`}
                          min={0}
                          max={60}
                          onChange={(e) => {
                            const v = e.target.value;
                            setAssetUsefulLife(a.id, v === '' ? 0 : Number(v));
                          }}
                          style={FAST_INPUT}
                          data-testid={`m4-fa-inputs-life-${a.id}`}
                        />
                      </td>
                      <td style={{ ...ROW_DATA.num }}>
                        {isRB ? (
                          <PercentageInput
                            value={(rateStored !== undefined ? rateStored : defaultRBRate) * 100}
                            onChange={(p) => setAssetRate(a.id, p / 100)}
                            min={0}
                            max={100}
                            decimals={2}
                            style={FAST_INPUT}
                            data-testid={`m4-fa-inputs-rate-${a.id}`}
                          />
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--color-meta)', fontStyle: 'italic' }}>
                            {lifeEffective > 0 ? `${(100 / lifeEffective).toFixed(2)}% / yr` : '-'}
                          </span>
                        )}
                      </td>
                      <td style={{ ...ROW_DATA.num, color: openingLand > 0 ? 'var(--color-text)' : 'var(--color-meta)', fontStyle: openingLand > 0 ? 'normal' : 'italic' }}>
                        {openingLand > 0 ? fmt(openingLand) : '-'}
                      </td>
                      <td style={{ ...ROW_DATA.num, color: openingBuilding > 0 ? 'var(--color-text)' : 'var(--color-meta)', fontStyle: openingBuilding > 0 ? 'normal' : 'italic' }}>
                        {openingBuilding > 0 ? fmt(openingBuilding) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-meta)', marginTop: 6, fontStyle: 'italic' }}>
            Useful Life blank = inherits the asset's category default. RB Rate blank = 2 / life (double-declining).
            Opening Land + Building NBV are read-only memos sourced from Module 1 Tab 4 Existing Operations.
          </div>
        </PhaseSection>
      )}

      {/* Hospitality / Operations */}
      <PhaseSection
        phaseId="strategy-hospitality"
        title="Hospitality / Operations"
        meta="Operate assets + Sell + Manage operate companions"
        countLabel={`${hospitalityAssets.length} asset${hospitalityAssets.length === 1 ? '' : 's'}`}
        storageKey="fmp:m4:fa:strategy:hospitality:collapsed"
        assetIds={hospitalityAssets.map((a) => a.id)}
      >
        {hospitalityAssets.length === 0 && (
          <div style={{ padding: '8px 12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
            No Operate or Sell + Manage assets configured yet.
          </div>
        )}
        {hospitalityAssets.map((a) => (
          <AssetSection
            key={a.id}
            assetId={a.id}
            domId={`m4-fa-asset-${a.id}`}
            title={a.name}
            meta={`${a.strategy === 'Operate' ? 'Hospitality' : a.strategy} · ${a.depreciationMethod === 'reducing_balance' ? `RB ${(((a.depreciationRate ?? 2 / Math.max(1, resolveUsefulLifeYears(a))) * 100).toFixed(2))}%` : `SL ${resolveUsefulLifeYears(a)} yrs`}`}
            storageKey={`fmp:m4:fa:asset:${a.id}:collapsed`}
          >
            {renderAssetBody(a)}
          </AssetSection>
        ))}
      </PhaseSection>

      {/* Retail / Lease */}
      <PhaseSection
        phaseId="strategy-retail"
        title="Retail / Lease"
        meta="Lease assets"
        countLabel={`${leaseAssets.length} asset${leaseAssets.length === 1 ? '' : 's'}`}
        storageKey="fmp:m4:fa:strategy:retail:collapsed"
        assetIds={leaseAssets.map((a) => a.id)}
      >
        {leaseAssets.length === 0 && (
          <div style={{ padding: '8px 12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
            No Lease assets configured yet.
          </div>
        )}
        {leaseAssets.map((a) => (
          <AssetSection
            key={a.id}
            assetId={a.id}
            domId={`m4-fa-asset-${a.id}`}
            title={a.name}
            meta={`Retail / Lease · ${a.depreciationMethod === 'reducing_balance' ? `RB ${(((a.depreciationRate ?? 2 / Math.max(1, resolveUsefulLifeYears(a))) * 100).toFixed(2))}%` : `SL ${resolveUsefulLifeYears(a)} yrs`}`}
            storageKey={`fmp:m4:fa:asset:${a.id}:collapsed`}
          >
            {renderAssetBody(a)}
          </AssetSection>
        ))}
      </PhaseSection>

      {/* Project rollup */}
      <PhaseSection
        phaseId="__project__"
        title="Project Total"
        meta="all assets combined"
        storageKey="fmp:m4:fa:phase:__project__:collapsed"
      >
        <PeriodTable
          title="Project Land: Roll-Forward"
          caption="Sum of every asset's Land roll-forward. Land never depreciates so closing Land = sum of all assets' opening Land + project-wide Land additions."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={landTableRows(projectLand)}
        />
        {(() => {
          const Nproj = projectDep.openingNBVPerPeriod.length;
          const idcAddProj = idcSnap.totalIdcPerPeriod.slice(0, Nproj);
          const idcDepProj = idcSnap.idcDepreciationPerPeriod.slice(0, Nproj);
          const idcNbvProj = idcSnap.idcNbvPerPeriod.slice(0, Nproj);
          const hasIdcProj = idcAddProj.some((v) => Math.abs(v) > 0.5);
          const combinedOpening = new Array<number>(Nproj).fill(0);
          const combinedClosing = new Array<number>(Nproj).fill(0);
          const combinedDep = new Array<number>(Nproj).fill(0);
          for (let t = 0; t < Nproj; t++) {
            const idcOpening = t === 0 ? 0 : (idcNbvProj[t - 1] ?? 0);
            combinedOpening[t] = (projectDep.openingNBVPerPeriod[t] ?? 0) + idcOpening;
            combinedClosing[t] = (projectDep.closingNBVPerPeriod[t] ?? 0) + (idcNbvProj[t] ?? 0);
            combinedDep[t] = (projectDep.depreciationPerPeriod[t] ?? 0) + (idcDepProj[t] ?? 0);
          }
          const rows: Row[] = hasIdcProj
            ? [
                { label: 'Opening NBV (Capex + IDC)', values: combinedOpening, indent: 1, aggregation: 'last' },
                { label: '(+) Capex Additions', values: projectDep.additionsPerPeriod, indent: 1 },
                { label: '(+) IDC Additions (capitalised interest)', values: idcAddProj, indent: 1 },
                { label: '(−) Depreciation (on Capex + IDC)', values: combinedDep.map((v) => -v), indent: 1 },
                { label: 'Closing NBV (Capex + IDC)', values: combinedClosing, isTotal: true, aggregation: 'last' },
                { label: '   of which: Capex NBV', values: projectDep.closingNBVPerPeriod, indent: 2, aggregation: 'last' },
                { label: '   of which: IDC NBV', values: idcNbvProj, indent: 2, aggregation: 'last' },
                { label: 'Accumulated Capex Depreciation (memo)', values: projectDep.accumDepPerPeriod, indent: 1, aggregation: 'last' },
              ]
            : [
                { label: 'Opening NBV', values: projectDep.openingNBVPerPeriod, indent: 1, aggregation: 'last' },
                { label: '(+) Capex Additions', values: projectDep.additionsPerPeriod, indent: 1 },
                { label: '(−) Depreciation', values: projectDep.depreciationPerPeriod.map((v) => -v), indent: 1 },
                { label: 'Closing NBV', values: projectDep.closingNBVPerPeriod, isTotal: true, aggregation: 'last' },
                { label: 'Accumulated Depreciation (memo)', values: projectDep.accumDepPerPeriod, indent: 1, aggregation: 'last' },
              ];
          return (
            <PeriodTable
              title="Project Depreciable Assets: Roll-Forward"
              caption={hasIdcProj
                ? 'Sum of every asset\'s depreciable roll-forward. Operate/Lease IDC is integrated: depreciation applies to Capex + IDC together.'
                : 'Sum of every asset\'s depreciable roll-forward. Depreciation per period = sum of per-asset depreciation streams.'}
              yearLabels={yearLabels}
              currency={currency}
              fmt={fmt}
              priorYearLabel={priorYear}
              rows={rows}
            />
          );
        })()}
        <PeriodTable
          title="Project Total Fixed Assets (Land + Depreciable)"
          caption="The Fixed Assets line on the project balance sheet. Equals Land closing + Depreciable closing NBV across every asset."
          yearLabels={yearLabels}
          currency={currency}
          fmt={fmt}
          priorYearLabel={priorYear}
          rows={projectTotalRows}
        />
      </PhaseSection>
    </div>
  );
}
