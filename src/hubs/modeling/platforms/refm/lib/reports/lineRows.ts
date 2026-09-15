/**
 * lineRows.ts (2026-09-15)
 *
 * PRESENTATION BY LINE, NOT BY PLOT (founder: "every surface after the assets
 * and sub-units tab should present by line, not by plot").
 *
 * The engine stays per asset, as decided: every result below is keyed by asset
 * id. What a reader sees is pooled to the CONSOLIDATED LINE, the same grouping
 * `planCapexSummaryLines` gives the capex tables (one row per line, a companion
 * immediately beside the line it belongs to, an asset in no line kept at the
 * end of its phase), so the IDC table, escrow, AP, fixed assets, the statement
 * members, the disposal working and the exports all name the same rows the
 * capex tables and table 4 already do. Land 2 of a Branded Villas line is no
 * longer its own row anywhere after the assets tab.
 *
 * Land funding stays per plot on purpose (founder, same day): debt and equity
 * are raised against a parcel, so it is not pooled.
 *
 * No em dashes in this file.
 */

import type { Asset, Parcel, Phase } from '../state/module1-types';
import { assetLabel, assetPlotLabel } from '@/src/core/calculations/assetName';
import { planCapexSummaryLines, type CapexReport, type CapexSummaryLine } from './capexReports';

export type ReportLine = CapexSummaryLine;

export interface LineState {
  assets: readonly Asset[];
  phases: readonly Phase[];
  parcels: readonly Parcel[];
}

/** The lines of the visible assets that pass `include`, in the capex tables' order. */
export function planReportLines(state: LineState, include?: (a: Asset) => boolean): ReportLine[] {
  const ctx = { parcels: state.parcels as Parcel[], phases: state.phases as Phase[] };
  const pool = state.assets.filter((a) => a.visible !== false && (include ? include(a) : true));
  return planCapexSummaryLines(
    pool as unknown as Parameters<typeof planCapexSummaryLines>[0],
    state.phases,
    (id) => {
      const a = state.assets.find((x) => x.id === id);
      return a ? assetLabel(a, ctx) : id;
    },
  );
}

/** "Land 1 + Land 2" for a line of several plots; empty for a line of one. */
export function linePlots(line: ReportLine, state: LineState): string {
  if (line.assetIds.length < 2) return '';
  const ctx = { parcels: state.parcels as Parcel[], phases: state.phases as Phase[] };
  return line.assetIds
    .map((id) => state.assets.find((a) => a.id === id))
    .map((a) => (a ? assetPlotLabel(a, ctx) : undefined))
    .filter((x): x is string => !!x)
    .join(' + ');
}

/** A line's name for a row that sits beside a phase column: the type, and its plots when it pools several. */
export function lineRowLabel(line: ReportLine, state: LineState): string {
  const plots = linePlots(line, state);
  return plots ? `${line.label} (${plots})` : line.label;
}

/** A line's name where no phase column says the phase: the phase leads on a multi-phase project. */
export function lineTitle(line: ReportLine, state: LineState): string {
  const name = lineRowLabel(line, state);
  // A companion line is already labelled with its phase; never say it twice.
  return state.phases.length > 1 && line.phaseName && !name.startsWith(`${line.phaseName}, `) ? `${line.phaseName}, ${name}` : name;
}

/** The members' per-period series added together; an asset with no series adds nothing. */
export function sumLine(line: ReportLine, pick: (assetId: string) => readonly number[] | undefined, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  for (const id of line.assetIds) {
    const s = pick(id);
    if (!s) continue;
    for (let t = 0; t < n; t++) out[t] += s[t] ?? 0;
  }
  return out;
}

/** The line an asset sits on. */
export function lineOfAsset(lines: readonly ReportLine[], assetId: string): ReportLine | undefined {
  return lines.find((l) => l.assetIds.includes(assetId));
}

/** One asset per line, its first plot, carrying the line's title as its name: for an input table
 *  that shows a line's terms (written to every plot on it) once. */
export function lineHosts(state: LineState, include?: (a: Asset) => boolean): Asset[] {
  return planReportLines(state, include)
    .map((line) => {
      const host = state.assets.find((a) => a.id === line.assetIds[0]);
      return host ? ({ ...host, name: lineTitle(line, state) } as Asset) : undefined;
    })
    .filter((a): a is Asset => !!a);
}

/** Fields that describe the axis rather than an amount: taken from the first member, never added. */
const FIRST_KEYS: ReadonlySet<string> = new Set(['axisLength', 'projectStartYear', 'yearLabels']);

/**
 * THE MEMBERS' RESULTS POOLED INTO ONE, same shape. Numbers and number arrays
 * add (arrays element by element, to the longest, matrices cell by cell);
 * nested objects pool field by field; the axis fields and anything else (a
 * string, a flag, a map) come from the first member. A caller corrects
 * afterwards any field that must not add (a rate, a day count, a share of a
 * whole), and says so where it does.
 */
export function poolResults<T>(items: readonly T[]): T {
  if (items.length === 1) return items[0];
  const pool = (vals: unknown[], key?: string): unknown => {
    const present = vals.filter((v) => v !== undefined && v !== null);
    if (present.length === 0) return vals[0];
    const first = present[0];
    if (key !== undefined && FIRST_KEYS.has(key)) return first;
    if (typeof first === 'number') return present.reduce((s: number, v) => s + (typeof v === 'number' ? v : 0), 0);
    if (Array.isArray(first)) {
      if (present.every((v) => Array.isArray(v) && (v as unknown[]).every((x) => typeof x === 'number'))) {
        const len = Math.max(...present.map((v) => (v as number[]).length));
        const out = new Array<number>(len).fill(0);
        for (const v of present as number[][]) for (let i = 0; i < v.length; i++) out[i] += v[i] ?? 0;
        return out;
      }
      if (present.every((v) => Array.isArray(v) && (v as unknown[]).every((x) => Array.isArray(x)))) {
        const len = Math.max(...present.map((v) => (v as unknown[]).length));
        return Array.from({ length: len }, (_, i) => pool(present.map((v) => (v as unknown[])[i])));
      }
      return first;
    }
    if (typeof first === 'object' && !(first instanceof Map) && !(first instanceof Set)) {
      const keys = new Set<string>();
      for (const v of present) for (const k of Object.keys(v as object)) keys.add(k);
      const out: Record<string, unknown> = {};
      for (const k of keys) out[k] = pool(present.map((v) => (v as Record<string, unknown>)[k]), k);
      return out;
    }
    return first;
  };
  return pool(items as unknown[]) as T;
}

/**
 * AN ASSET-KEYED RESULT MAP, ONE ENTRY PER LINE: [first plot's id, pooled result,
 * line title, member ids], in the capex tables' order. `fix` corrects a pooled
 * field that must not add; it receives the members so it can weight a rate.
 */
export function poolMapByLine<T>(
  map: ReadonlyMap<string, T>,
  state: LineState,
  fix?: (pooled: T, members: readonly T[]) => T,
): Array<[string, T, string, string[]]> {
  const out: Array<[string, T, string, string[]]> = [];
  for (const line of planReportLines(state, (a) => map.has(a.id))) {
    const ids = line.assetIds.filter((id) => map.has(id));
    const members = ids.map((id) => map.get(id)!);
    if (members.length === 0) continue;
    const pooled = members.length === 1 ? members[0] : (fix ? fix(poolResults(members), members) : poolResults(members));
    out.push([ids[0], pooled, lineTitle(line, state), ids]);
  }
  return out;
}

/** A hotel's occupancy and ADR pooled as rates: occupied over available nights, rooms revenue over occupied nights. */
export function fixHospitalityRates<T extends { availableRoomNightsPerPeriod: number[]; occupiedRoomNightsPerPeriod: number[]; roomsRevenuePerPeriod: number[]; occupancyPerPeriod: number[]; adrPerPeriod: number[] }>(pooled: T): T {
  return {
    ...pooled,
    occupancyPerPeriod: pooled.occupiedRoomNightsPerPeriod.map((o, t) => ((pooled.availableRoomNightsPerPeriod[t] ?? 0) > 0 ? o / pooled.availableRoomNightsPerPeriod[t] : 0)),
    adrPerPeriod: pooled.roomsRevenuePerPeriod.map((rv, t) => ((pooled.occupiedRoomNightsPerPeriod[t] ?? 0) > 0 ? rv / pooled.occupiedRoomNightsPerPeriod[t] : 0)),
  };
}

/** A lease line's occupancy and indexed rent pooled as rates: occupied over leasable area (each plot's
 *  leasable area implied by its own occupancy), revenue over occupied area. */
export function fixLeaseRates<T extends { occupiedAreaPerPeriod: number[]; occupancyPerPeriod: number[]; indexedRatePerPeriod: number[]; totalRevenuePerPeriod: number[] }>(pooled: T, members: readonly T[]): T {
  const n = pooled.occupiedAreaPerPeriod.length;
  const leasable = new Array<number>(n).fill(0);
  for (const m of members) for (let t = 0; t < n; t++) {
    const occ = m.occupancyPerPeriod[t] ?? 0;
    if (occ > 0) leasable[t] += (m.occupiedAreaPerPeriod[t] ?? 0) / occ;
  }
  return {
    ...pooled,
    occupancyPerPeriod: pooled.occupiedAreaPerPeriod.map((a, t) => (leasable[t] > 0 ? a / leasable[t] : 0)),
    indexedRatePerPeriod: pooled.totalRevenuePerPeriod.map((rv, t) => ((pooled.occupiedAreaPerPeriod[t] ?? 0) > 0 ? rv / pooled.occupiedAreaPerPeriod[t] : (members[0].indexedRatePerPeriod[t] ?? 0))),
  };
}

type CapexInput = CapexReport['inputAssets'][number];
type CapexInputLineRow = CapexInput['lines'][number];
/** A pooled capex input line: `rateVaries` is true when the plots on the line carry different rates. */
export type PooledCapexInputLine = CapexInputLineRow & { rateVaries?: boolean };

/**
 * THE CAPEX REPORT, ONE INPUT BLOCK AND ONE SERIES PER LINE, for the exports.
 * Each cost line adds its plots' amounts, quantities and per-period spend. The
 * rate is the plots' rate when they agree; when they differ it is the rate that
 * reproduces the pooled amount on the pooled quantity (so rate x quantity still
 * reads true), and the line says the rate varies by plot.
 */
export function poolCapexByLine(capex: CapexReport, state: LineState): { report: CapexReport; members: Map<string, string[]> } {
  const inputById = new Map(capex.inputAssets.map((ia) => [ia.assetId, ia] as const));
  const seriesById = new Map(capex.assetSeries.map((s) => [s.assetId, s] as const));
  const members = new Map<string, string[]>();
  const inputAssets: CapexInput[] = [];
  const assetSeries: CapexReport['assetSeries'] = [];
  for (const line of planReportLines(state, (a) => inputById.has(a.id) || seriesById.has(a.id))) {
    const ids = line.assetIds;
    members.set(ids[0], ids);
    const blocks = ids.map((id) => inputById.get(id)).filter((b): b is CapexInput => !!b);
    if (blocks.length === 1) inputAssets.push({ ...blocks[0], assetName: lineTitle(line, state) });
    else if (blocks.length > 1) {
      const order: string[] = [];
      const byLine = new Map<string, CapexInputLineRow[]>();
      for (const b of blocks) for (const l of b.lines) {
        if (!byLine.has(l.id)) { byLine.set(l.id, []); order.push(l.id); }
        byLine.get(l.id)!.push(l);
      }
      const lines: PooledCapexInputLine[] = order.map((id) => {
        const ls = byLine.get(id)!;
        const base = ls[0];
        const amount = ls.reduce((s, l) => s + l.amount, 0);
        const same = ls.every((l) => l.rate === base.rate);
        const qty = ls.reduce((s, l) => s + (l.rate !== 0 ? l.amount / (l.isPercent ? l.rate / 100 : l.rate) : 0), 0);
        const pooledRate = same ? base.rate : (qty !== 0 ? (base.isPercent ? (amount / qty) * 100 : amount / qty) : base.rate);
        const metricValue = ls.every((l) => typeof l.metricValue === 'number') ? ls.reduce((s, l) => s + (l.metricValue as number), 0) : base.metricValue;
        return { ...base, amount, rate: pooledRate, metricValue, perPeriod: poolResults(ls.map((l) => l.perPeriod)), rateVaries: !same };
      });
      inputAssets.push({
        ...blocks[0],
        assetName: lineTitle(line, state),
        lines,
        subtotals: poolResults(blocks.map((b) => b.subtotals)),
        total: blocks.reduce((s, b) => s + b.total, 0),
      });
    }
    const ser = ids.map((id) => seriesById.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
    if (ser.length) assetSeries.push({ ...poolResults(ser), assetId: ids[0] });
  }
  return { report: { ...capex, inputAssets, assetSeries }, members };
}

/** The per-asset economics, one row per line: revenue, cost and profit add; the margin and the yield
 *  on cost are struck on the pooled figures (the yield weighted by cost). */
export function poolReturnRows<T extends { assetId: string; assetName: string; totalRevenue: number; totalCost: number; profit: number; profitMargin: number | null; yieldOnCost: number | null; isIncomeAsset: boolean }>(
  rows: readonly T[],
  state: LineState,
): T[] {
  const byId = new Map(rows.map((r) => [r.assetId, r] as const));
  const out: T[] = [];
  for (const line of planReportLines(state, (a) => byId.has(a.id))) {
    const ms = line.assetIds.map((id) => byId.get(id)).filter((r): r is T => !!r);
    if (ms.length === 0) continue;
    const totalRevenue = ms.reduce((s, r) => s + r.totalRevenue, 0);
    const totalCost = ms.reduce((s, r) => s + r.totalCost, 0);
    const profit = ms.reduce((s, r) => s + r.profit, 0);
    const income = ms[0].isIncomeAsset;
    const noi = ms.reduce((s, r) => s + (r.yieldOnCost ?? 0) * r.totalCost, 0);
    out.push({
      ...ms[0],
      assetName: lineTitle(line, state),
      totalRevenue, totalCost, profit,
      profitMargin: ms.length === 1 ? ms[0].profitMargin : (totalRevenue !== 0 ? profit / totalRevenue : null),
      yieldOnCost: ms.length === 1 ? ms[0].yieldOnCost : (income && totalCost !== 0 ? noi / totalCost : null),
    });
  }
  return out;
}

/** An advisory per asset, pooled per consolidated line (2026-09-15, step 9): the
 *  amounts add and the row is named for the line. `merge` folds the next member in. */
function poolAdvisories<T extends { assetId: string; assetName: string }>(items: readonly T[], state: LineState, merge: (acc: T, next: T) => T): T[] {
  const byId = new Map(items.map((x) => [x.assetId, x] as const));
  const out: T[] = [];
  const placed = new Set<string>();
  for (const line of planReportLines(state, (a) => byId.has(a.id))) {
    const members = line.assetIds.map((id) => byId.get(id)).filter((x): x is T => !!x);
    if (members.length === 0) continue;
    members.forEach((m) => placed.add(m.assetId));
    const pooled = members.slice(1).reduce(merge, { ...members[0] });
    out.push({ ...pooled, assetId: members[0].assetId, assetName: lineTitle(line, state) });
  }
  for (const x of items) if (!placed.has(x.assetId)) out.push(x);
  return out;
}

/** The revenue basis advisory per line: gross and collections add, the divergence is struck on the sums. */
export function poolRevenueBasisByLine<T extends { assetId: string; assetName: string; gross: number; collections: number; relative: number }>(items: readonly T[], state: LineState): T[] {
  return poolAdvisories(items, state, (acc, next) => {
    const gross = acc.gross + next.gross;
    const collections = acc.collections + next.collections;
    return { ...acc, gross, collections, relative: gross > 0 ? collections / gross - 1 : 0 };
  });
}

/** The missing-downpayment advisory per line: the sale value at stake adds. */
export function poolSaleCohortByLine<T extends { assetId: string; assetName: string; saleValue: number }>(items: readonly T[], state: LineState): T[] {
  return poolAdvisories(items, state, (acc, next) => ({ ...acc, saleValue: acc.saleValue + next.saleValue }));
}
