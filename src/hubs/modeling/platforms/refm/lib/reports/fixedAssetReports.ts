/**
 * fixedAssetReports.ts (2026-09-17)
 *
 * THE FIXED ASSETS & D&A SCHEDULE, BUILT ONCE.
 *
 * The Module 4 Schedules sub-tab and the workbook's Schedules tab both render
 * from here, so the two cannot disagree about which tables exist, what a row is
 * called, what sign it carries or what a total holds. Until this file the screen
 * built its rows inline and the workbook kept a shorter copy of its own, which
 * left three measured differences on FMP - MARINA GATE:
 *
 *   - the workbook's per line depreciation left the capitalised interest out, so
 *     its lines added to 17,338,705 in 2031 against a P&L D&A of 19,578,725;
 *   - the screen filed a line into Hospitality when it was a companion, so the
 *     two retail strips (Lease companions) showed in BOTH groups;
 *   - "Total Fixed Assets" said it was the balance sheet line and left the
 *     capitalised interest out of it (2027: 14,684,187 against 14,933,488).
 *
 * The IDC pool is split the way the money actually goes: interest capitalised
 * into an Operate or Lease asset depreciates with it, while interest capitalised
 * into a Sell asset is inventory and is released through Cost of Sales. Adding
 * both into one additions row printed 7,844,032 of additions over a closing
 * balance of 249,302 in 2027.
 *
 * Pure: no React. Every series comes from the fixed asset and IDC snapshots the
 * caller already holds, and every disposal from `scheduleWithDisposal`, the rule
 * the balance sheet runs. No em dashes in this file.
 */
import type { Asset, Parcel, Phase } from '../state/module1-types';
import type { ProjectFixedAssetSnapshot, AssetFixedAssetRow, LandRollForward } from '../fixed-assets-resolvers';
import type { ProjectIDCSnapshot, AssetIDCRow } from '../financials-resolvers';
import { resolveUsefulLifeYears } from '@/src/core/calculations';
import { planReportLines, lineTitle, poolResults } from './lineRows';
import { scheduleWithDisposal, type DisposalContext } from './disposalSchedules';

/** One row of a fixed asset table. `aggregation: 'last'` = the Total column holds the last period. */
export interface FixedAssetRow {
  label: string;
  values: number[];
  isTotal?: boolean;
  isSubtotal?: boolean;
  indent?: number;
  aggregation?: 'sum' | 'last';
  /** The prior-year column (pre-axis carry). Absent = blank. */
  priorValue?: number;
}

export interface FixedAssetTable {
  title: string;
  caption: string;
  rows: FixedAssetRow[];
}

/** One line's depreciation inputs, as the inputs table shows them. */
export interface FixedAssetInputRow {
  /** The line's first plot: the asset an edit is keyed by. */
  hostId: string;
  memberIds: readonly string[];
  title: string;
  strategyLabel: string;
  method: 'straight_line' | 'reducing_balance';
  methodLabel: string;
  /** The stored life, undefined or 0 when the line inherits its category default. */
  lifeStored: number | undefined;
  inheritsLife: boolean;
  /** The life the engine uses (resolveUsefulLifeYears on the line). */
  lifeEffective: number;
  /** The stored reducing balance rate, if any. */
  rateStored: number | undefined;
  /** The annual rate in force: the reducing balance rate, or 1 / life on straight line. */
  rateEffective: number;
  openingLand: number;
  openingBuilding: number;
}

export interface FixedAssetLineBlock {
  hostId: string;
  memberIds: readonly string[];
  title: string;
  /** Short strategy and method tag for a card heading. */
  meta: string;
  land: FixedAssetTable;
  depreciable: FixedAssetTable;
  total: FixedAssetTable;
}

export interface FixedAssetGroup {
  key: 'hospitality' | 'retail';
  title: string;
  meta: string;
  emptyText: string;
  lines: FixedAssetLineBlock[];
}

export interface FixedAssetReport {
  inputs: FixedAssetInputRow[];
  inputsCaption: string;
  groups: FixedAssetGroup[];
  project: { land: FixedAssetTable; depreciable: FixedAssetTable; total: FixedAssetTable; idcPool: FixedAssetTable | null };
}

export interface FixedAssetReportInput {
  fa: ProjectFixedAssetSnapshot;
  idc: Pick<ProjectIDCSnapshot, 'byAsset' | 'totalIdcPerPeriod' | 'totalConstructionInterestPerPeriod' | 'idcDepreciationPerPeriod' | 'idcNbvPerPeriod'>;
  state: { assets: readonly Asset[]; phases: readonly Phase[]; parcels: readonly Parcel[] };
  dCtx: DisposalContext;
}

const zeros = (n: number): number[] => new Array<number>(n).fill(0);
const neg = (a: readonly number[]): number[] => a.map((v) => -v);
const addArr = (a: readonly number[], b: readonly number[]): number[] => a.map((v, t) => v + (b[t] ?? 0));

/** Whether an IDC row feeds a held fixed asset (it depreciates) rather than Sell inventory. */
export function idcRowIsHeld(row: Pick<AssetIDCRow, 'strategy'>): boolean {
  return row.strategy === 'Operate' || row.strategy === 'Lease';
}

function methodLabelOf(method: 'straight_line' | 'reducing_balance', life: number, rateStored: number | undefined): { label: string; rate: number } {
  if (method === 'reducing_balance') {
    const rate = rateStored !== undefined ? rateStored : life > 0 ? 2 / life : 0;
    return { label: `Reducing Balance @ ${(rate * 100).toFixed(2)}%`, rate };
  }
  return { label: `Straight Line ${life} yrs`, rate: life > 0 ? 1 / life : 0 };
}

/** Land: Opening + Additions - Disposed = Closing. */
function landRows(land: LandRollForward, dCtx: DisposalContext): FixedAssetRow[] {
  const openingAtZero = land.openingPerPeriod[0] ?? 0;
  const w = scheduleWithDisposal({ ...land }, dCtx);
  return [
    { label: 'Opening Land', values: w.openingPerPeriod, indent: 1, aggregation: 'last', priorValue: openingAtZero },
    { label: '(+) Land Additions', values: w.additionsPerPeriod, indent: 1, priorValue: 0 },
    ...(w.disposed ? [{ label: '(−) Land Disposed at Exit', values: neg(w.disposalPerPeriod), indent: 1, priorValue: 0 }] : []),
    { label: 'Closing Land', values: w.closingPerPeriod, isTotal: true, aggregation: 'last', priorValue: openingAtZero },
  ];
}

interface DepreciableParts {
  rows: FixedAssetRow[];
  hasIdc: boolean;
  /** Opening and closing depreciable NBV INCLUDING the capitalised interest, disposal applied. */
  opening: number[];
  closing: number[];
  disposal: number[];
  disposed: boolean;
}

/**
 * Depreciable assets: Opening + Capex Additions + IDC Additions - Depreciation
 * (on both) - Disposed = Closing, with the closing split beneath when interest
 * was capitalised. `idc` is the held IDC for this table (a line's own rows, or
 * the project's held pool).
 */
function depreciableParts(
  dep: { openingNBVPerPeriod: number[]; additionsPerPeriod: number[]; depreciationPerPeriod: number[]; closingNBVPerPeriod: number[]; accumDepPerPeriod: number[] },
  idc: { additions: readonly number[]; depreciation: readonly number[]; closing: readonly number[] } | undefined,
  dCtx: DisposalContext,
): DepreciableParts {
  const N = dep.openingNBVPerPeriod.length;
  const capexD = scheduleWithDisposal({ openingPerPeriod: dep.openingNBVPerPeriod, additionsPerPeriod: dep.additionsPerPeriod, depreciationPerPeriod: dep.depreciationPerPeriod, closingPerPeriod: dep.closingNBVPerPeriod, accumDepPerPeriod: dep.accumDepPerPeriod }, dCtx);
  const hasIdc = idc !== undefined && idc.additions.some((v) => Math.abs(v) > 0.5);
  const idcD = hasIdc ? scheduleWithDisposal({ additionsPerPeriod: idc!.additions, depreciationPerPeriod: idc!.depreciation, closingPerPeriod: idc!.closing }, dCtx) : undefined;
  const openingAtZeroCapex = dep.openingNBVPerPeriod[0] ?? 0;
  if (!idcD) {
    return {
      hasIdc: false,
      opening: capexD.openingPerPeriod,
      closing: capexD.closingPerPeriod,
      disposal: capexD.disposalPerPeriod,
      disposed: capexD.disposed,
      rows: [
        { label: 'Opening NBV', values: capexD.openingPerPeriod, indent: 1, aggregation: 'last', priorValue: openingAtZeroCapex },
        { label: '(+) Capex Additions', values: capexD.additionsPerPeriod, indent: 1, priorValue: 0 },
        { label: '(−) Depreciation', values: neg(capexD.depreciationPerPeriod), indent: 1, priorValue: 0 },
        ...(capexD.disposed ? [{ label: '(−) Disposed at Exit (net book value)', values: neg(capexD.disposalPerPeriod), indent: 1, priorValue: 0 }] : []),
        { label: 'Closing NBV', values: capexD.closingPerPeriod, isTotal: true, aggregation: 'last', priorValue: openingAtZeroCapex },
        { label: 'Accumulated Depreciation (memo)', values: capexD.accumDepPerPeriod, indent: 1, aggregation: 'last', priorValue: 0 },
      ],
    };
  }
  const idcNbv = idcD.closingPerPeriod.slice(0, N);
  const opening = zeros(N), closing = zeros(N), depn = zeros(N);
  for (let t = 0; t < N; t++) {
    opening[t] = (capexD.openingPerPeriod[t] ?? 0) + (t === 0 ? 0 : idcNbv[t - 1] ?? 0);
    closing[t] = (capexD.closingPerPeriod[t] ?? 0) + (idcNbv[t] ?? 0);
    depn[t] = (capexD.depreciationPerPeriod[t] ?? 0) + (idcD.depreciationPerPeriod[t] ?? 0);
  }
  const disposal = addArr(capexD.disposalPerPeriod, idcD.disposalPerPeriod);
  const disposed = capexD.disposed || idcD.disposed;
  const openingAtZero = opening[0] ?? 0;
  return {
    hasIdc: true,
    opening,
    closing,
    disposal,
    disposed,
    rows: [
      { label: 'Opening NBV (Capex + IDC)', values: opening, indent: 1, aggregation: 'last', priorValue: openingAtZero },
      { label: '(+) Capex Additions', values: capexD.additionsPerPeriod, indent: 1, priorValue: 0 },
      { label: '(+) IDC Additions (capitalised interest)', values: idcD.additionsPerPeriod.slice(0, N), indent: 1, priorValue: 0 },
      { label: '(−) Depreciation (on Capex + IDC)', values: neg(depn), indent: 1, priorValue: 0 },
      ...(disposed ? [{ label: '(−) Disposed at Exit (net book value)', values: neg(disposal), indent: 1, priorValue: 0 }] : []),
      { label: 'Closing NBV (Capex + IDC)', values: closing, isTotal: true, aggregation: 'last', priorValue: openingAtZero },
      { label: '   of which: Capex NBV', values: capexD.closingPerPeriod, indent: 2, aggregation: 'last', priorValue: openingAtZeroCapex },
      { label: '   of which: IDC NBV', values: idcNbv, indent: 2, aggregation: 'last', priorValue: 0 },
      { label: 'Accumulated Capex Depreciation (memo)', values: capexD.accumDepPerPeriod, indent: 1, aggregation: 'last', priorValue: 0 },
    ],
  };
}

/** Land + depreciable NBV (with its capitalised interest): the balance sheet's Fixed Assets. */
function totalRows(land: LandRollForward, dep: DepreciableParts, dCtx: DisposalContext): FixedAssetRow[] {
  const landD = scheduleWithDisposal({ ...land }, dCtx);
  const depLabel = dep.hasIdc ? 'Depreciable NBV (Capex + IDC)' : 'Depreciable NBV';
  return [
    { label: 'Opening Land', values: landD.openingPerPeriod, indent: 1, aggregation: 'last' },
    { label: `Opening ${depLabel}`, values: dep.opening, indent: 1, aggregation: 'last' },
    { label: 'Opening Fixed Assets', values: addArr(landD.openingPerPeriod, dep.opening), isSubtotal: true, aggregation: 'last' },
    ...(landD.disposed || dep.disposed ? [{ label: '(−) Disposed at Exit (land and net book value)', values: neg(addArr(landD.disposalPerPeriod, dep.disposal)), indent: 1 }] : []),
    { label: 'Closing Land', values: landD.closingPerPeriod, indent: 1, aggregation: 'last' },
    { label: `Closing ${depLabel}`, values: dep.closing, indent: 1, aggregation: 'last' },
    { label: 'Closing Fixed Assets', values: addArr(landD.closingPerPeriod, dep.closing), isTotal: true, aggregation: 'last' },
  ];
}

export const FIXED_ASSET_INPUTS_CAPTION = 'Useful Life blank = inherits the asset\'s category default. RB Rate blank = 2 / life (double-declining). Opening Land + Building NBV are read-only memos sourced from Module 1 Tab 4 Existing Operations.';

export function buildFixedAssetReport(input: FixedAssetReportInput): FixedAssetReport {
  const { fa, idc, state, dCtx } = input;
  const N = fa.axisLength;
  const lines = planReportLines(state, (a) => fa.byAsset.has(a.id));
  const inputs: FixedAssetInputRow[] = [];
  const hospitality: FixedAssetLineBlock[] = [];
  const retail: FixedAssetLineBlock[] = [];

  for (const line of lines) {
    const faRows = line.assetIds.map((id) => fa.byAsset.get(id)).filter((r): r is AssetFixedAssetRow => !!r);
    if (faRows.length === 0) continue;
    const host = state.assets.find((a) => a.id === line.assetIds[0]);
    if (!host) continue;
    const row: AssetFixedAssetRow = { ...poolResults(faRows), usefulLifeYears: faRows[0].usefulLifeYears, asset: faRows[0].asset };
    const idcRows = line.assetIds.map((id) => idc.byAsset.get(id)).filter((r): r is AssetIDCRow => !!r && idcRowIsHeld(r));
    const idcRow = idcRows.length === 0 ? undefined : poolResults(idcRows);
    const title = lineTitle(line, state);
    const lifeEffective = row.usefulLifeYears > 0 ? row.usefulLifeYears : resolveUsefulLifeYears(host);
    const method = host.depreciationMethod ?? 'straight_line';
    const m = methodLabelOf(method, lifeEffective, host.depreciationRate);
    const strategyLabel = host.strategy === 'Operate'
      ? (host.isCompanion ? 'Hospitality (Manage)' : 'Hospitality')
      : host.strategy === 'Lease' ? 'Retail / Lease' : host.strategy;
    inputs.push({
      hostId: host.id,
      memberIds: line.assetIds,
      title,
      strategyLabel,
      method,
      methodLabel: m.label,
      lifeStored: host.usefulLifeYears,
      inheritsLife: host.usefulLifeYears === undefined || host.usefulLifeYears <= 0,
      lifeEffective,
      rateStored: host.depreciationRate,
      rateEffective: m.rate,
      openingLand: row.land.openingAtAxisStart,
      openingBuilding: row.depreciable.openingNBVPerPeriod[0] ?? 0,
    });

    const dep = depreciableParts(
      row.depreciable,
      idcRow ? { additions: idcRow.idcPerPeriod.slice(0, N), depreciation: idcRow.depreciationPerPeriod.slice(0, N), closing: idcRow.closingNbvPerPeriod.slice(0, N) } : undefined,
      dCtx,
    );
    const block: FixedAssetLineBlock = {
      hostId: host.id,
      memberIds: line.assetIds,
      title,
      meta: `${host.strategy === 'Operate' ? 'Hospitality' : host.strategy === 'Lease' ? 'Retail / Lease' : host.strategy} · ${method === 'reducing_balance' ? `RB ${(m.rate * 100).toFixed(2)}%` : `SL ${lifeEffective} yrs`}`,
      land: { title: `${title}: Land Roll-Forward`, caption: 'Land sits on the balance sheet but never depreciates. Closing Land = Opening Land + Land Additions.', rows: landRows(row.land, dCtx) },
      depreciable: { title: `${title}: Depreciable Assets Roll-Forward`, caption: `${m.label}. Closing NBV = Opening + Capex Additions + IDC Additions − Depreciation. When IDC is present, depreciation applies to both Capex AND IDC; the closing split is shown beneath.`, rows: dep.rows },
      total: { title: `${title}: Total Fixed Assets (Land + Depreciable)`, caption: 'Sum of Land closing + Depreciable closing NBV, capitalised interest included. This is the line\'s Fixed Assets on the balance sheet.', rows: totalRows(row.land, dep, dCtx) },
    };
    // ONE GROUP PER LINE, BY STRATEGY. A retail strip is a Lease companion, so the
    // companion flag must not file it under Hospitality as well.
    if (host.strategy === 'Operate') hospitality.push(block);
    else retail.push(block);
  }

  // The project: every line's land and depreciable roll-forward, with the HELD
  // capitalised interest (Operate and Lease) inside the depreciable table.
  const held = zeros(N);
  for (const r of idc.byAsset.values()) {
    if (!idcRowIsHeld(r)) continue;
    for (let t = 0; t < N; t++) held[t] += r.idcPerPeriod[t] ?? 0;
  }
  const total = idc.totalIdcPerPeriod.slice(0, N);
  const toInventory = total.map((v, t) => v - (held[t] ?? 0));
  const idcDep = idc.idcDepreciationPerPeriod.slice(0, N);
  const idcNbv = idc.idcNbvPerPeriod.slice(0, N);
  const projDep = depreciableParts(fa.projectTotals.depreciable, { additions: held, depreciation: idcDep, closing: idcNbv }, dCtx);

  let idcPool: FixedAssetTable | null = null;
  const anyIdc = total.some((v) => Math.abs(v) > 0.5) || idcNbv.some((v) => Math.abs(v) > 0.5);
  if (anyIdc) {
    const heldD = scheduleWithDisposal({ additionsPerPeriod: held, depreciationPerPeriod: idcDep, closingPerPeriod: idcNbv }, dCtx);
    idcPool = {
      title: 'Capitalised Interest (IDC) Pool',
      caption: 'Construction interest capitalised this period, split by where it goes. Interest on an Operate or Lease asset is a fixed asset: it depreciates with the asset and is sold with it at the exit. Interest on a Sell asset is inventory and is released through Cost of Sales, so it never enters this roll-forward.',
      rows: [
        { label: 'Construction interest', values: idc.totalConstructionInterestPerPeriod.slice(0, N), indent: 1 },
        { label: 'Capitalised to held fixed assets (Operate / Lease)', values: held, indent: 1 },
        { label: 'Capitalised to Sell inventory (released through Cost of Sales, memo)', values: toInventory, indent: 1 },
        { label: 'Opening IDC NBV (held)', values: heldD.openingPerPeriod, indent: 1, aggregation: 'last' },
        { label: '(+) IDC Additions (held)', values: heldD.additionsPerPeriod, indent: 1 },
        { label: '(−) IDC Depreciation', values: neg(heldD.depreciationPerPeriod), indent: 1 },
        ...(heldD.disposed ? [{ label: '(−) Disposed at Exit (capitalised interest)', values: neg(heldD.disposalPerPeriod), indent: 1 }] : []),
        { label: 'Closing IDC NBV (held)', values: heldD.closingPerPeriod, isTotal: true, aggregation: 'last' },
      ],
    };
  }

  return {
    inputs,
    inputsCaption: FIXED_ASSET_INPUTS_CAPTION,
    groups: [
      { key: 'hospitality', title: 'Hospitality / Operations', meta: 'Operate assets + Sell + Manage operate companions', emptyText: 'No Operate or Sell + Manage assets configured yet.', lines: hospitality },
      { key: 'retail', title: 'Retail / Lease', meta: 'Lease assets', emptyText: 'No Lease assets configured yet.', lines: retail },
    ],
    project: {
      land: { title: 'Project Land: Roll-Forward', caption: 'Sum of every asset\'s Land roll-forward. Land never depreciates so closing Land = sum of all assets\' opening Land + project-wide Land additions.', rows: landRows(fa.projectTotals.land, dCtx) },
      depreciable: {
        title: 'Project Depreciable Assets: Roll-Forward',
        caption: projDep.hasIdc
          ? 'Sum of every asset\'s depreciable roll-forward. Operate/Lease IDC is integrated: depreciation applies to Capex + IDC together. IDC capitalised into Sell assets is inventory and is not in this table (see the IDC pool below).'
          : 'Sum of every asset\'s depreciable roll-forward. Depreciation per period = sum of per-asset depreciation streams.',
        rows: projDep.rows,
      },
      total: { title: 'Project Total Fixed Assets (Land + Depreciable)', caption: 'The Fixed Assets line on the project balance sheet. Equals Land closing + Depreciable closing NBV (capitalised interest included) across every asset.', rows: totalRows(fa.projectTotals.land, projDep, dCtx) },
      idcPool,
    },
  };
}
