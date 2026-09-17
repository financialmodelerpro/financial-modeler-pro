/**
 * assetInputsView.ts (2026-09-17)
 *
 * WHAT MODULE 1 TABS 4 AND 5 SHOW, as plain rows, for a surface that cannot
 * render the screens themselves (the Excel model export).
 *
 * PRESENTATION ONLY, and it computes no rule of its own. Every figure comes
 * from the function the screen calls: the chain through `computeAssetChain`
 * (the ONE chain call site), land through `computeAssetLandBreakdown` and
 * `resolveAssetAreaMetrics` with the argument lists the Assets tab and the
 * PDF use, inherited massing through `withInheritedMassingAll` and
 * `chainMassingFor`, the plot and line groupings through `groupAssetsByPlot`,
 * `groupAssetsForConsolidation` and `partitionSubUnitsByLine`, the totals
 * through `totalsFromRows`, the order of Table 5 through `orderSubUnitLines`,
 * and the cost standards through `constructionRowsForView` and the basis
 * labels in costStandards.ts.
 *
 * WHY IT LIVES BESIDE assetTableModel.ts AND NOT IN lib/excel. The standards
 * a type states (its unit size, its parking ratio, its values) are read by
 * nothing that computes money, and the verifiers hold the calculation and
 * export roots to that. Displaying them is not pricing from them, but the
 * reading belongs next to the tab's own model, so the export receives rows
 * with neutral field names and never touches the standards itself.
 *
 * No em dashes in this file.
 */

import {
  computeAssetLandBreakdown, resolveAssetAreaMetrics, resolveAssetPlotDraw, resolveSubUnitMetric,
  computeSubUnitArea,
} from '@/src/core/calculations';
import { withInheritedMassingAll } from '@/src/core/calculations/landChain';
import { groupAssetsForConsolidation } from '@/src/core/calculations/consolidation';
import { isRetailCompanion } from '@/src/core/calculations/retailCompanion';
import { assetPlotLabel } from '@/src/core/calculations/assetName';
import {
  chainMassingFor, resolveAssetTypeValues, resolveChainDefaults, resolveRetailSlotArea, sortAssetTypes,
  normaliseAssetTypeId, PARKING_RATIO_BASIS_LABELS,
} from '../../../lib/state/assetTypeStandards';
import { constructionRowsForView, costStandardBasisLabel, rowBasisLabel } from '../../../lib/state/costStandards';
import { typePriceColumns } from '../../../lib/state/subUnitPriceDefaults';
import { hasDualPrice } from '../../../lib/state/subUnitPrices';
import { assetCapexCategory } from '../../../lib/reports/capexReports';
import { planReportLines, lineTitle } from '../../../lib/reports/lineRows';
import type {
  Asset, CostLine, LandAllocationMode, Parcel, Phase, Project, SubUnit,
} from '../../../lib/state/module1-types';
import {
  computeAssetChain, groupAssetsByPlot, plotCheckText, partitionSubUnitsByLine, resolveAssetNsa, lineNsaOf,
  orderSubUnitLines, totalsFromRows, assetHasSubstance, UNPLOTTED_GROUP,
  type ResolvedNsa, type TotalledRow,
} from './assetTableModel';
import type { ChainResult } from '@/src/core/calculations/landChain';

export interface InputsViewState {
  project: Project;
  phases: readonly Phase[];
  parcels: readonly Parcel[];
  assets: readonly Asset[];
  subUnits: readonly SubUnit[];
  costLines?: readonly CostLine[];
  landAllocationMode: LandAllocationMode;
}

/** A value on a table, and whether the user typed it (an input) or it came
 *  from somewhere else (inherited from the type, or derived). */
export interface ViewCell<T = number> { value?: T; typed: boolean; note?: string }

const area = (n: number): string => Math.round(n).toLocaleString('en-US');

/** The assets every surface after the screen reads: visible, with the type's
 *  massing filled in over copies, exactly as the Assets tab resolves them. */
function viewAssets(state: InputsViewState): Asset[] {
  return withInheritedMassingAll(
    state.assets.filter((a) => a.visible !== false),
    (a) => chainMassingFor(a, state.project.assetTypeValues),
  );
}

// ── TAB 4: ASSET TYPES AND STANDARDS ────────────────────────────────────────

export interface TypeValuesRow {
  id: string;
  label: string;
  category: string;
  strategy?: string;
  unitSizeSqm?: number;
  ratio?: number;
  /** The stated basis, absent when the type states none. */
  ratioBasis?: string;
  /** What the screen's dropdown displays when no basis is stated. */
  ratioBasisDefault: string;
  utilisationPct?: number;
  coveragePct?: number;
  far?: number;
  servicePct?: number;
}

export interface CostStandardView {
  label: string;
  appliesTo: string;
  basis: string;
  /** Stated as typed: a soft row's rate is a PERCENT (3.5 = 3.5%). */
  rate?: number;
  isPercent: boolean;
  byPhase: Array<{ phaseName: string; rate: number }>;
  /** Construction type rows only: the two prices the type states, each with
   *  the unit its strategy reads it in, or null when the strategy uses none. */
  pricePerUnit?: { value?: number; unit: string } | null;
  pricePerSqm?: { value?: number; unit: string } | null;
}

export interface StandardsView {
  baseYear: number;
  types: TypeValuesRow[];
  slotAreaSqm?: number;
  escalationPct?: number;
  construction: CostStandardView[];
  soft: CostStandardView[];
}

export function buildStandardsView(state: InputsViewState): StandardsView {
  const p = state.project;
  const entries = sortAssetTypes(p.assetTypes ?? []);
  const values = p.assetTypeValues ?? {};
  const baseYear = new Date(p.startDate).getUTCFullYear();
  const types: TypeValuesRow[] = entries.map((e) => {
    const v = values[e.id];
    return {
      id: e.id,
      label: e.label,
      category: e.category ?? '',
      strategy: v?.strategy,
      unitSizeSqm: v?.avgUnitSizeSqm,
      ratio: v?.parkingRatio,
      ratioBasis: v?.parkingRatioBasis !== undefined ? PARKING_RATIO_BASIS_LABELS[v.parkingRatioBasis] : undefined,
      ratioBasisDefault: PARKING_RATIO_BASIS_LABELS.slots_per_unit,
      utilisationPct: v?.utilisationPct,
      coveragePct: v?.coveragePct,
      far: v?.farRatio,
      servicePct: v?.servicePct,
    };
  });
  const stored = p.costStandardRows ?? [];
  const costLines = (state.costLines ?? []) as CostLine[];
  const currency = p.currency ?? '';
  const phaseRates = (byPhase: Record<string, number> | undefined): Array<{ phaseName: string; rate: number }> =>
    state.phases
      .filter((ph) => typeof byPhase?.[ph.id] === 'number')
      .map((ph) => ({ phaseName: ph.name, rate: byPhase![ph.id] }));
  const construction: CostStandardView[] = constructionRowsForView(stored, entries).map((row) => {
    const typeId = row.assetTypeId;
    const tv = typeId !== undefined ? values[typeId] : undefined;
    const cols = typePriceColumns(tv?.strategy);
    return {
      label: row.label,
      appliesTo: typeId !== undefined
        ? 'Assets of this type'
        : (row.appliesToTypeIds ?? []).length > 0
          ? (row.appliesToTypeIds ?? []).map((id) => entries.find((e) => e.id === id)?.label ?? id).join(', ')
          : 'All assets',
      basis: costStandardBasisLabel(row.method, currency, row.catalogId),
      rate: row.rate,
      isPercent: false,
      byPhase: phaseRates(row.byPhase),
      ...(typeId !== undefined ? {
        pricePerUnit: cols.unit === null ? null : { value: tv?.pricePerUnit, unit: cols.unit },
        pricePerSqm: cols.sqm === null ? null : { value: tv?.pricePerSqm, unit: cols.sqm },
      } : {}),
    };
  });
  const soft: CostStandardView[] = stored.filter((r) => r.list === 'soft').map((row) => {
    const basis = row.method === 'percent_of_selected'
      ? rowBasisLabel(row, stored, costLines)
      : costStandardBasisLabel(row.method, currency, row.catalogId);
    return {
      label: row.label,
      appliesTo: basis,
      basis,
      rate: row.rate,
      isPercent: row.method.startsWith('percent'),
      byPhase: phaseRates(row.byPhase),
    };
  });
  return {
    baseYear,
    types,
    slotAreaSqm: p.parkingAreaPerSlotSqm,
    escalationPct: p.costEscalationPct,
    construction,
    soft,
  };
}

// ── TAB 5, TABLES 2 AND 3: BY PLOT ──────────────────────────────────────────

export interface EntryRow {
  assetId: string;
  typeLabel: string;
  strategy: string;
  plotAreaSqm: ViewCell;
  utilisationPct: ViewCell;
  coveragePct: ViewCell;
  far: ViewCell;
  maxFloors: ViewCell;
  retailPct: ViewCell;
  servicePct: ViewCell;
}

export interface ChainRow {
  assetId: string;
  label: string;
  landSqm: number;
  chain: ChainResult;
  unitSizeSqm?: number;
  ratio?: number;
  ratioBasis?: string;
}

export interface PlotGroupView {
  key: string;
  plotLabel: string;
  phaseName?: string;
  check: string;
  entries: EntryRow[];
  chains: ChainRow[];
  /** The retail companions' land carved from this plot's hosts. */
  retailPieces: Array<{ name: string; sqm: number }>;
}

/** A pooled row of the by-line table, or its total. */
export interface PooledView {
  landSqm: number;
  pooled: Record<string, number>;
  landscapePct?: number;
  avgUnitSize?: number;
  /** Parking slots over units, from the row's own sums. */
  slotsPerUnit?: number;
}

/** The totals rule's result under the view's own field names. */
function pooledView(rows: readonly TotalledRow[], companionLandSqm: number): PooledView {
  const t = totalsFromRows(rows, companionLandSqm);
  return { landSqm: t.landSqm, pooled: t.pooled, landscapePct: t.landscapePct, avgUnitSize: t.avgUnitSize, slotsPerUnit: t.parkingRatio };
}

export interface LineAreaView extends PooledView {
  key: string;
  typeLabel: string;
  phaseName: string;
  strategy: string;
  plots: number;
}

export interface CompanionAreaView {
  name: string;
  phaseName: string;
  strategy: string;
  hosts: number;
  landSqm: number;
  retailGfaSqm: number;
  slots: number;
  parkingAreaSqm: number;
  totalBuaSqm: number;
}

export interface AssetAreaTables {
  plots: PlotGroupView[];
  plotTotal: PooledView;
  lines: LineAreaView[];
  companions: CompanionAreaView[];
  lineTotal: PooledView;
  parcelsTotalSqm: number;
}

/** A plot input: the plot's own figure wins, absent inherits the type's, a
 *  typed zero is a statement (resolveChainDefaults, the screen's rule). */
function massingCell(typed: number | undefined, resolved: number | undefined, source: string): ViewCell {
  if (typeof typed === 'number' && Number.isFinite(typed)) return { value: typed, typed: true };
  if (source === 'asset_type' && typeof resolved === 'number') return { value: resolved, typed: false, note: 'from the type' };
  return { typed: false };
}

export function buildAssetAreaTables(state: InputsViewState): AssetAreaTables {
  const assets = viewAssets(state);
  const raw = new Map(state.assets.map((a) => [a.id, a] as const));
  const parcels = state.parcels as Parcel[];
  const subUnits = state.subUnits as SubUnit[];
  const project = state.project;
  const model = { assets, parcels, subUnits, project, landAllocationMode: state.landAllocationMode };
  const slot = resolveRetailSlotArea(project.assetTypeValues);
  const phaseName = (id: string | undefined): string | undefined => state.phases.find((p) => p.id === id)?.name;

  // Carved land per companion and per plot, through the engine's own function.
  const byCompanion: Record<string, number> = {};
  const byParcel: Record<string, Array<{ name: string; sqm: number }>> = {};
  let companionTotal = 0;
  for (const a of assets) {
    if (!isRetailCompanion(a)) continue;
    const b = computeAssetLandBreakdown(a, parcels, assets, subUnits, state.landAllocationMode);
    byCompanion[a.id] = b.landSqm;
    companionTotal += b.landSqm;
    for (const sp of b.splits) {
      if (!sp.parcelId || sp.sqm <= 0) continue;
      (byParcel[sp.parcelId] ??= []).push({ name: a.name, sqm: sp.sqm });
    }
  }

  const rowById = new Map<string, TotalledRow & { assetId: string }>();
  const plots: PlotGroupView[] = groupAssetsByPlot(assets, parcels).map((g) => {
    const plotLabel = g.parcel ? g.parcel.name : 'No specific plot';
    const entries: EntryRow[] = [];
    const chains: ChainRow[] = [];
    for (const asset of g.assets) {
      const { chain, typeValues, unitSize, landSqm } = computeAssetChain(asset, model, slot);
      const stated = raw.get(asset.id) ?? asset;
      const resolved = resolveChainDefaults(stated.landChain, resolveAssetTypeValues(stated, project.assetTypeValues));
      const draw = resolveAssetPlotDraw(asset, parcels, assets);
      const typedDraw = draw?.source === 'typed';
      entries.push({
        assetId: asset.id,
        typeLabel: asset.type || asset.name,
        strategy: String(asset.strategy),
        plotAreaSqm: typedDraw
          ? { value: stated.landAllocation?.sqm, typed: true }
          : { value: landSqm, typed: false, note: draw?.source === 'whole_plot' ? 'blank, draws the whole plot' : undefined },
        utilisationPct: massingCell(stated.landChain?.utilisationPct, resolved.utilisationPct, resolved.sources.utilisationPct),
        coveragePct: massingCell(stated.landChain?.coveragePct, resolved.coveragePct, resolved.sources.coveragePct),
        far: massingCell(stated.landChain?.farRatio, resolved.farRatio, resolved.sources.farRatio),
        maxFloors: { value: stated.landChain?.maxFloors, typed: typeof stated.landChain?.maxFloors === 'number' },
        retailPct: { value: stated.landChain?.retailPct, typed: typeof stated.landChain?.retailPct === 'number' },
        servicePct: massingCell(stated.landChain?.servicePct, resolved.servicePct, resolved.sources.servicePct),
      });
      chains.push({
        assetId: asset.id,
        label: asset.type || asset.name,
        landSqm,
        chain,
        unitSizeSqm: unitSize.value,
        ratio: typeValues?.parkingRatio,
        ratioBasis: typeValues?.parkingRatioBasis === 'sqm_per_slot' ? 'sqm per slot' : typeValues?.parkingRatio !== undefined ? 'slots per unit' : undefined,
      });
      rowById.set(asset.id, { assetId: asset.id, landSqm, chain: chain as unknown as Record<string, number | undefined> });
    }
    return {
      key: g.key,
      plotLabel,
      phaseName: g.key === UNPLOTTED_GROUP ? undefined : phaseName(g.parcel?.phaseId),
      check: plotCheckText(g, area),
      entries,
      chains,
      retailPieces: byParcel[g.parcel?.id ?? ''] ?? [],
    };
  });
  const allRows = [...rowById.values()];
  const plotTotal = pooledView(allRows, companionTotal);

  const groups = groupAssetsForConsolidation(
    assets as unknown as Parameters<typeof groupAssetsForConsolidation>[0],
    state.phases.map((p) => p.id),
    normaliseAssetTypeId,
  );
  const lines: LineAreaView[] = [];
  const companions: CompanionAreaView[] = [];
  const lineRows: TotalledRow[] = [];
  for (const g of groups) {
    const members = (g.assets as unknown as Asset[]);
    const rows = members.map((m) => rowById.get(m.id)).filter((r): r is TotalledRow & { assetId: string } => !!r);
    lineRows.push(...rows);
    const live = rows.filter((r) => {
      const a = assets.find((x) => x.id === r.assetId);
      return a ? assetHasSubstance(a, subUnits) : false;
    });
    if (live.length > 0) {
      // THE SAME RULE AS THE TOTALS (totalsFromRows): areas pooled, the three
      // ratios quotients of this row's own sums.
      lines.push({
        ...pooledView(live, 0),
        key: g.key,
        typeLabel: g.typeLabel,
        phaseName: phaseName(g.phaseId) ?? g.phaseId,
        strategy: String(members[0]?.strategy ?? ''),
        plots: live.length,
      });
    }
  }
  for (const g of groups) {
    const strip = assets.find((a) => isRetailCompanion(a) && a.retailLineKey === g.key);
    if (!strip) continue;
    const retailGfa = strip.buaSqm ?? 0;
    companions.push({
      name: strip.name,
      phaseName: phaseName(strip.phaseId) ?? strip.phaseId,
      strategy: String(strip.strategy),
      hosts: (strip.retailHostAssetIds ?? []).length,
      landSqm: byCompanion[strip.id] ?? 0,
      retailGfaSqm: retailGfa,
      slots: strip.parkingBaysRequired ?? 0,
      parkingAreaSqm: Math.max(0, (strip.gfaSqm ?? 0) - retailGfa),
      totalBuaSqm: strip.gfaSqm ?? 0,
    });
  }
  return {
    plots,
    plotTotal,
    lines,
    companions,
    lineTotal: pooledView(lineRows, companionTotal),
    parcelsTotalSqm: parcels.reduce((s, p) => s + Math.max(0, p.area), 0),
  };
}

// ── LAND BY ASSET (what capex charges and the balance sheet holds) ──────────

export interface AssetLandView {
  assetId: string;
  name: string;
  category: string;
  landSqm: number;
  landRate: number;
  landValue: number;
  cashLandValue: number;
  inKindLandValue: number;
  /** The engine's built area for the asset, read for the nil-area footnote. */
  builtAreaSqm: number;
}

export function buildAssetLandView(state: InputsViewState): AssetLandView[] {
  const visible = viewAssets(state);
  return visible.map((a) => {
    const inPhase = visible.filter((x) => x.phaseId === a.phaseId);
    const m = resolveAssetAreaMetrics(a, state.project, state.parcels as Parcel[], inPhase, state.subUnits as SubUnit[], state.landAllocationMode);
    return {
      assetId: a.id,
      name: a.name,
      category: assetCapexCategory(a, state.project),
      landSqm: m.landSqm,
      landRate: m.landSqm > 0 ? m.landValue / m.landSqm : 0,
      landValue: m.landValue,
      cashLandValue: m.cashLandValue,
      inKindLandValue: m.inKindLandValue,
      builtAreaSqm: m.bua,
    };
  });
}

// ── TAB 5, TABLE 5: SUB-UNITS UNDER THE MERGED LINE ─────────────────────────

export interface SubUnitRowView {
  id: string;
  name: string;
  /** The plot the row hangs off, named only on a line of several plots. */
  plot?: string;
  category: string;
  metric: 'area' | 'units';
  sharePct: ViewCell;
  areaSqm: ViewCell;
  unitSizeSqm?: number;
  units: ViewCell;
  rate: number;
  rateBasis: string;
  otherRate?: { value?: number; basis: string };
  otherNote?: string;
}

export interface SubUnitLineView {
  key: string;
  title: string;
  category: string;
  rows: SubUnitRowView[];
  nsaSqm: number;
  areaSqm: number;
  check: string;
}

/** Table 5's Rate Basis column, the screen's `rateUnitLabel` rule. */
function rateBasisOf(category: string, metric: 'area' | 'units'): string {
  if (category === 'Sellable') return metric === 'units' ? 'per unit' : 'per sqm';
  if (category === 'Operable') return 'per room/night';
  if (category === 'Leasable') return 'per sqm/year';
  return '';
}

export function buildSubUnitLines(state: InputsViewState): SubUnitLineView[] {
  const assets = viewAssets(state);
  const byId = new Map(assets.map((a) => [a.id, a] as const));
  const parcels = state.parcels as Parcel[];
  const phases = state.phases as Phase[];
  const phaseIds = phases.map((p) => p.id);
  const subUnits = (state.subUnits as SubUnit[]).filter((u) => byId.has(u.assetId) || !state.assets.some((a) => a.id === u.assetId));
  const model = { assets, parcels, subUnits: state.subUnits as SubUnit[], project: state.project, landAllocationMode: state.landAllocationMode };
  const slot = resolveRetailSlotArea(state.project.assetTypeValues);

  // What each plot's parts are parts of: the chain's NSA where it runs.
  const nsaByAsset: Record<string, ResolvedNsa> = {};
  for (const a of assets) {
    if (isRetailCompanion(a)) { nsaByAsset[a.id] = resolveAssetNsa(a.sellableBuaSqm, undefined); continue; }
    if (a.isCompanion === true) continue;
    nsaByAsset[a.id] = resolveAssetNsa(a.sellableBuaSqm, computeAssetChain(a, model, slot).chain.netSaleableSqm);
  }
  const reportLines = planReportLines({ assets, phases, parcels });
  const titleFor = (firstId: string | undefined, fallback: string): string => {
    const line = reportLines.find((l) => firstId !== undefined && l.assetIds.includes(firstId));
    return line ? lineTitle(line, { assets, phases, parcels }) : fallback;
  };

  const retail = assets.filter((a) => isRetailCompanion(a));
  const hosts = assets.filter((a) => !isRetailCompanion(a));
  const { lines, stray } = partitionSubUnitsByLine(hosts, subUnits, phaseIds, normaliseAssetTypeId);
  type Built = SubUnitLineView & { label: string; phaseId?: string; isStrip: boolean };
  const out: Built[] = [];
  const build = (key: string, label: string, title: string, members: Asset[], units: SubUnit[], phaseId: string | undefined, isStrip: boolean): void => {
    if (units.length === 0) return;
    const nsa = key === '__no_line__' ? 0 : lineNsaOf(members, nsaByAsset).value;
    const rows: SubUnitRowView[] = units.map((u) => {
      const asset = byId.get(u.assetId);
      const metric = resolveSubUnitMetric(u, asset);
      const isUnits = metric === 'units';
      const unitArea = Math.max(0, u.unitArea ?? 0);
      const areaSqm = computeSubUnitArea(u, asset);
      const share = nsa > 0 ? (areaSqm / nsa) * 100 : undefined;
      const shareTyped = !isUnits && nsa > 0 && typeof u.nsaSharePct === 'number';
      return {
        id: u.id,
        name: u.name,
        plot: members.length > 1 || !asset ? (asset ? (assetPlotLabel(asset, { parcels, phases }) ?? asset.name) : 'no asset') : undefined,
        category: String(u.category),
        metric,
        sharePct: shareTyped ? { value: u.nsaSharePct, typed: true } : { value: share, typed: false },
        areaSqm: { value: areaSqm, typed: !isUnits && !shareTyped },
        unitSizeSqm: u.unitArea,
        units: isUnits
          ? { value: u.metricValue, typed: true }
          : { value: unitArea > 0 ? Math.round(u.metricValue / unitArea) : undefined, typed: false },
        rate: u.unitPrice ?? 0,
        rateBasis: rateBasisOf(String(u.category), metric) || 'no rate',
        ...(hasDualPrice(u)
          ? { otherRate: { value: isUnits ? u.pricePerSqm : u.pricePerUnit, basis: `per ${isUnits ? 'sqm' : 'unit'}` } }
          : { otherNote: u.category === 'Operable' ? 'ADR, whatever the count' : u.category === 'Leasable' ? 'per sqm/year, whatever the count' : '' }),
      };
    });
    const areaSum = rows.reduce((s, r) => s + (r.areaSqm.value ?? 0), 0);
    const check = key === '__no_line__'
      ? 'These point at an asset that is not on a line.'
      : nsa > 0
        ? `${area(areaSum)} of ${area(nsa)} sqm allocated (${((areaSum / nsa) * 100).toFixed(1)}%)${Math.abs(areaSum - nsa) < 0.01 ? ', sub-units sum to NSA' : areaSum < nsa ? ', under-allocated' : ', over-allocated'}.`
        : 'No NSA on this line, so there is nothing to check the parts against.';
    out.push({
      key, title, label, phaseId, isStrip,
      category: members[0] ? assetCapexCategory(members[0], state.project) : 'Other',
      rows, nsaSqm: nsa, areaSqm: areaSum, check,
    });
  };
  for (const line of lines) {
    build(line.key, line.typeLabel, titleFor(line.members[0]?.id, line.typeLabel), line.members, line.subUnits, line.phaseId, false);
  }
  const claimed = new Set<string>();
  for (const a of retail) {
    const mine = stray.filter((u) => u.assetId === a.id);
    for (const u of mine) claimed.add(u.id);
    build(`retail__${a.id}`, `${a.type || 'Retail'} (Retail)`, titleFor(a.id, a.name), [a], mine, a.phaseId, true);
  }
  const retailIds = new Set(retail.map((a) => a.id));
  build('__no_line__', 'Not on a line', 'Not on a line', [], stray.filter((u) => !claimed.has(u.id) && !retailIds.has(u.assetId)), undefined, false);
  return orderSubUnitLines(out, phaseIds);
}
