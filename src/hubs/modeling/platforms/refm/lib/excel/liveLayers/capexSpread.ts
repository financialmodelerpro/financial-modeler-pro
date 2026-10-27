/**
 * capexSpread.ts (2026-10-15), THE CAPEX SPREAD PLAN FOR THE LIVE WORKBOOK.
 *
 * How each plot's cost line spreads its base-year amount over the years, the
 * engine's rules (`computeAssetCost`, `resolveLinePhasing`, `distribute`):
 *
 *   even         equal shares over the line's window of phase periods
 *   curve        the plot's typed spend curve, sliced to the window and
 *                normalised (a window the curve says nothing about is even)
 *   collections  the plot's sales collections, positive years only, over the
 *                phase's slots (none collected: even over the window)
 *   land cash    the plot's land cash line's shares (RETT follows it)
 *
 * The window is the line's own, or derived from the construction years where
 * the line follows them (`deriveCostWindow`). Phase period 0 lands in the year
 * before the phase starts (never before the first model year), period i in the
 * phase's year i (`phaseLocalToProjectIndex`).
 *
 * The plan names each distinct spread once (a "spread row" on the Capex tab) and
 * says where its window is typed: the construction years (worked out), the line's
 * own window (one input per cost line), or one plot's own window (that plot's).
 *
 * Shared by the builder (which lays out the rows and their platform values) and
 * the live layer (which writes their formulas), so the two cannot disagree.
 *
 * No em dashes in this file.
 */
import { assetLabel } from '@/src/core/calculations/assetName';
import { isLandValueLine } from '@/src/core/calculations';
import { assetVisibleLines } from '@/src/core/calculations/selectedBase';
import { isParcelDrivenLandLine, resolvePhasingSource, collectionsForAsset, phaseLocalToProjectIndex } from '@/src/core/calculations/capexPhasing';
import { lineEscalates } from '@/src/core/calculations/costEscalation';
import { deriveLineBaseId } from '../../state/module1-types';
import type { Asset, CostLine, CostOverride, Phase, Parcel } from '../../state/module1-types';

export type SpreadKind = 'even' | 'curve' | 'collections';
export interface SpreadRow {
  key: string;
  label: string;
  phaseId: string;
  kind: SpreadKind;
  /** The window, in phase periods. */
  start: number;
  end: number;
  /** Where the window comes from: the construction years, the cost line's own window, or one plot's. */
  win: 'follows' | 'line' | 'plot';
  /** The window comes from the construction years. */
  follows: boolean;
  /** The line the window belongs to (its own window), and the rule of a followed one. */
  lineId: string;
  baseId: string;
  /** The plot whose curve or collections it reads. */
  assetId?: string;
  /** The platform's shares on the project axis. */
  shares: number[];
}
export interface PlotLine { assetId: string; lineId: string; spread: string; escalates: boolean; method: string; disabled: boolean }
export interface CapexSpreadPlan {
  rows: Map<string, SpreadRow>;
  plotLine: Map<string, PlotLine>;
}

interface PlanState {
  assets: Asset[]; phases: Phase[]; parcels: Parcel[]; costLines: CostLine[]; costOverrides: CostOverride[];
  project: { costEscalationPct?: number };
}

/** The followed window's start and end for a line, from the construction years (deriveCostWindow). */
export function followedWindow(baseId: string, cp: number): { start: number; end: number } {
  const c = Math.max(1, cp);
  const start = baseId === 'land-cash' || baseId === 'land-inkind' || baseId === 'rett' ? 0
    : baseId === 'landscaping' || baseId === 'marketing' || baseId === 'commission' ? Math.max(1, Math.floor(c / 2))
      : baseId === 'pre-operating' ? Math.max(1, c - 6) : 1;
  return { start, end: start === 0 ? 0 : Math.max(start, c) };
}

/** A followed window's start rule (deriveCostWindow): lines with the same rule share a window. */
export function followedRule(baseId: string): 'land' | 'half' | 'preop' | 'std' {
  return baseId === 'land-cash' || baseId === 'land-inkind' || baseId === 'rett' ? 'land'
    : baseId === 'landscaping' || baseId === 'marketing' || baseId === 'commission' ? 'half' : baseId === 'pre-operating' ? 'preop' : 'std';
}

export function planCapexSpread(
  state: PlanState,
  members: Map<string, string[]>,
  revenue: Parameters<typeof collectionsForAsset>[0],
  projectStartYear: number,
  axisLength: number,
): CapexSpreadPlan {
  const N = axisLength;
  const rows = new Map<string, SpreadRow>();
  const plotLine = new Map<string, PlotLine>();
  const names = { parcels: state.parcels, phases: state.phases };
  const phaseOf = (a: Asset): Phase | undefined => state.phases.find((p) => p.id === a.phaseId);
  const offsetOf = (p: Phase): number => Math.max(0, new Date(p.startDate as string).getUTCFullYear() - projectStartYear);
  const toAxis = (local: number[], off: number): number[] => {
    const out = new Array<number>(N).fill(0);
    local.forEach((v, i) => { const t = phaseLocalToProjectIndex(i, off); if (t >= 0 && t < N) out[t] += v; });
    return out;
  };
  const evenLocal = (start: number, end: number): number[] => {
    const e = Math.max(start, end);
    const out = new Array<number>(e + 1).fill(0);
    for (let i = start; i <= e; i++) out[i] = 1 / (e - start + 1);
    return out;
  };
  // A window typed on one plot's override is that plot's (computeAssetCost: the override's start and end win).
  const plotWindow = (a: Asset | undefined, line: CostLine): CostOverride | undefined => {
    if (!a) return undefined;
    const ov = state.costOverrides.find((o) => o.assetId === a.id && o.lineId === line.id);
    return ov && ov.overridden !== false && (ov.startPeriod !== undefined || ov.endPeriod !== undefined) ? ov : undefined;
  };
  const windowOf = (line: CostLine, p: Phase, a?: Asset): { start: number; end: number; follows: boolean; win: SpreadRow['win'] } => {
    const ov = plotWindow(a, line);
    if (ov) return { start: ov.startPeriod ?? line.startPeriod, end: ov.endPeriod ?? line.endPeriod, follows: false, win: 'plot' };
    return line.windowFollowsConstruction === true
      ? { ...followedWindow(deriveLineBaseId(line.id), p.constructionPeriods ?? 0), follows: true, win: 'follows' }
      : { start: line.startPeriod, end: line.endPeriod, follows: false, win: 'line' };
  };
  const winTag = (line: CostLine, w: { win: SpreadRow['win'] }, a?: Asset): string => (w.win === 'follows' ? `f:${followedRule(deriveLineBaseId(line.id))}` : w.win === 'plot' ? `p:${a!.id}:${line.id}` : line.id);
  const evenRow = (line: CostLine, p: Phase, a?: Asset): string => {
    const win = windowOf(line, p, a);
    const key = `even|${p.id}|${winTag(line, win, a)}`;
    if (!rows.has(key)) rows.set(key, {
      key, phaseId: p.id, kind: 'even', start: win.start, end: Math.max(win.start, win.end), win: win.win, follows: win.follows, lineId: line.id, baseId: deriveLineBaseId(line.id),
      assetId: win.win === 'plot' ? a?.id : undefined,
      // Short labels (2026-10-20): the spread and its window in phase periods; the Guide explains them.
      label: `Even${state.phases.length > 1 ? `, ${p.name}` : ''}, P${win.start} to P${Math.max(win.start, win.end)}${win.follows ? '' : `, ${win.win === 'plot' && a ? `${assetLabel(a, names)} ` : ''}${line.name}`}`,
      shares: toAxis(evenLocal(win.start, win.end), offsetOf(p)),
    });
    return key;
  };
  const curveRow = (a: Asset, line: CostLine, p: Phase): string | null => {
    const win = windowOf(line, p, a);
    const dist = a.capexPhasing?.distribution ?? [];
    const slice = dist.slice(win.start, Math.max(win.start, win.end) + 1).map((v) => Math.max(0, v ?? 0));
    const sum = slice.reduce((s, v) => s + v, 0);
    if (!(sum > 0)) return null;
    const key = `curve|${a.id}|${winTag(line, win, a)}`;
    if (!rows.has(key)) {
      const local = new Array<number>(Math.max(win.start, win.end) + 1).fill(0);
      slice.forEach((v, k) => { local[win.start + k] = v / sum; });
      rows.set(key, {
        key, phaseId: p.id, kind: 'curve', start: win.start, end: Math.max(win.start, win.end), win: win.win, follows: win.follows, lineId: line.id, baseId: deriveLineBaseId(line.id), assetId: a.id,
        label: `Curve, ${assetLabel(a, names)}, P${win.start} to P${Math.max(win.start, win.end)}`,
        shares: toAxis(local, offsetOf(p)),
      });
    }
    return key;
  };
  const collectionsRow = (a: Asset, line: CostLine, p: Phase): string | null => {
    const series = collectionsForAsset(revenue, a.id, p, projectStartYear);
    const pos = (series ?? []).map((v) => Math.max(0, v ?? 0));
    const sum = pos.reduce((s, v) => s + v, 0);
    if (!(sum > 0)) return null;
    const win = windowOf(line, p, a);
    const key = `coll|${a.id}|${winTag(line, win, a)}`;
    if (!rows.has(key)) rows.set(key, {
      key, phaseId: p.id, kind: 'collections', start: win.start, end: Math.max(win.start, win.end), win: win.win, follows: win.follows, lineId: line.id, baseId: deriveLineBaseId(line.id), assetId: a.id,
      label: `Collections, ${assetLabel(a, names)}`,
      shares: toAxis(pos.map((v) => v / sum), offsetOf(p)),
    });
    return key;
  };

  for (const [, ids] of members) {
    for (const id of ids) {
      const a = state.assets.find((x) => x.id === id);
      const p = a && phaseOf(a);
      if (!a || !p) continue;
      const lines = assetVisibleLines(state.costLines, p.id, a.id, a.strategy);
      const landCash = lines.find((l) => isParcelDrivenLandLine(l) && l.method === 'percent_of_cash_land');
      for (const line of lines) {
        const ov = state.costOverrides.find((o) => o.assetId === a.id && o.lineId === line.id);
        const act = ov !== undefined && ov.overridden !== false;
        const method = String(act ? ov!.method ?? line.method : line.method);
        const disabled = line.disabled === true || (act && ov!.disabled === true);
        const src = isParcelDrivenLandLine(line) ? 'own' : resolvePhasingSource(line, ov);
        let spread: string;
        if (src === 'inherit') spread = curveRow(a, line, p) ?? evenRow(line, p, a);
        else if (src === 'land_cash') spread = landCash ? evenRow(landCash, p, a) : evenRow(line, p, a);
        else if (src === 'collections') spread = collectionsRow(a, line, p) ?? evenRow(line, p, a);
        else spread = evenRow(line, p, a);
        plotLine.set(`${a.id}|${line.id}`, { assetId: a.id, lineId: line.id, spread, method, disabled, escalates: !disabled && lineEscalates({ method, isLandValue: isLandValueLine(line) }) });
      }
    }
  }

  return { rows, plotLine };
}

/**
 * WHICH SPREAD EACH ASSET'S COST LINE READS (2026-10-27, founder), shared by the builder and the
 * layer. An asset's plots may spread a line differently (one types a curve, another does not):
 *
 *   - a plot whose amount for the line is zero BY STRUCTURE (the line is off there, or its base
 *     cannot exist there: sale revenue on a plot with no sale rows, a strip's area on a host) is
 *     left out, so a line whose other plots all agree reads their one spread (marketing follows the
 *     one plot that sells, its line's collections);
 *   - a hard line (rate x an area) whose plots still differ blends their spreads weighted by each
 *     plot's quantity (the rate is the line's, so it cancels);
 *   - a soft line (a percentage of selected lines) blends them weighted by each plot's hard-cost
 *     money, which is exact while every soft line selects all the hard lines, directly or through
 *     other soft lines that do (the layer refuses otherwise): the soft lines with the same plot
 *     spreads share one blend.
 */
export interface CapexBlendPlan {
  /** `${host}|${lineId}` -> the row key the line's years read: `cxw:<spread>`, `cxbw:<host>:<line>` or `cxbs:<host>:<n>`. */
  use: Map<string, string>;
  hard: Array<{ host: string; lid: string; key: string; plots: string[] }>;
  soft: Array<{ host: string; key: string; plots: string[]; lids: string[] }>;
  /** Per host whose soft lines blend: one weight row per plot, its hard-cost money. */
  weights: Array<{ host: string; plot: string; key: string }>;
  /** The hard lines whose money weighs a host's soft blend. */
  hardLines: Map<string, string[]>;
  /** A mixed line the plan cannot express (neither hard nor soft). */
  other: Array<{ host: string; lid: string }>;
}
const STRIP_ONLY = new Set(['rate_x_retail_gfa', 'rate_x_retail_parking_area']);
const HOST_ONLY = new Set(['rate_x_main_asset_gfa', 'rate_x_parking_area', 'rate_x_landscape_area']);
export function planCapexBlends(
  state: PlanState & { subUnits: Array<{ assetId: string; category?: string }> },
  members: Map<string, string[]>,
  plan: CapexSpreadPlan,
  isStrip: (a: Asset) => boolean,
): CapexBlendPlan {
  const use = new Map<string, string>();
  const hard: CapexBlendPlan['hard'] = [], soft: CapexBlendPlan['soft'] = [], weights: CapexBlendPlan['weights'] = [], other: CapexBlendPlan['other'] = [];
  const hardLines = new Map<string, string[]>();
  const sells = (id: string): boolean => state.subUnits.some((u) => u.assetId === id && u.category !== 'Support');
  for (const [host, ids] of members) {
    const lids = [...new Set(ids.flatMap((id) => [...plan.plotLine.values()].filter((x) => x.assetId === id).map((x) => x.lineId)))];
    const zero = (id: string, lid: string): boolean => {
      const pl = plan.plotLine.get(`${id}|${lid}`);
      if (!pl || pl.disabled) return true;
      const a = state.assets.find((x) => x.id === id);
      if (!a) return true;
      if (pl.method === 'percent_of_revenue_sale' && !sells(id)) return true;
      return isStrip(a) ? HOST_ONLY.has(pl.method) : STRIP_ONLY.has(pl.method);
    };
    const softGroups = new Map<string, { lids: string[]; plots: string[] }>();
    for (const lid of lids) {
      const live = ids.filter((id) => !zero(id, lid));
      const spreads = live.map((id) => plan.plotLine.get(`${id}|${lid}`)!.spread);
      const first = (live.length ? spreads[0] : ids.map((id) => plan.plotLine.get(`${id}|${lid}`)?.spread).find((x): x is string => !!x)) ?? '';
      if (new Set(spreads).size <= 1) { use.set(`${host}|${lid}`, `cxw:${first}`); continue; }
      const method = plan.plotLine.get(`${live[0]}|${lid}`)!.method;
      if (method.startsWith('rate_x_')) {
        const key = `cxbw:${host}:${lid}`;
        hard.push({ host, lid, key, plots: live });
        use.set(`${host}|${lid}`, key);
      } else if (method === 'percent_of_selected') {
        const tuple = live.map((id, i) => `${id}=${spreads[i]}`).join(',');
        const g = softGroups.get(tuple) ?? { lids: [], plots: live };
        g.lids.push(lid); softGroups.set(tuple, g);
      } else other.push({ host, lid });
    }
    let n = 0;
    for (const g of softGroups.values()) {
      const key = `cxbs:${host}:${n++}`;
      soft.push({ host, key, plots: g.plots, lids: g.lids });
      for (const lid of g.lids) use.set(`${host}|${lid}`, key);
    }
    if (softGroups.size) {
      const plots = [...new Set([...softGroups.values()].flatMap((g) => g.plots))];
      for (const p of plots) weights.push({ host, plot: p, key: `cxhw:${host}:${p}` });
      hardLines.set(host, lids.filter((lid) => ids.some((id) => !zero(id, lid) && plan.plotLine.get(`${id}|${lid}`)!.method.startsWith('rate_x_'))));
    }
  }
  return { use, hard, soft, weights, hardLines, other };
}
