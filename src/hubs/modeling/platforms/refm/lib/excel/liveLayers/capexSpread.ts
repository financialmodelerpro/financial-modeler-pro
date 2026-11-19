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
import { isParcelDrivenLandLine, resolvePhasingSource, collectionsForAsset, phaseLocalToProjectIndex, sellShapesForAssetAtOffset, commissionShape } from '@/src/core/calculations/capexPhasing';
import { lineEscalates } from '@/src/core/calculations/costEscalation';
import { deriveLineBaseId } from '../../state/module1-types';
import type { Asset, CostLine, CostOverride, Phase, Parcel } from '../../state/module1-types';

export type SpreadKind = 'even' | 'curve' | 'collections' | 'blend';
/** WHICH REVENUE ROW A 'collections' SPREAD READS (2026-11-18): cash collected, the value sold, or the revenue recognised. */
export type SpreadBasis = 'cash' | 'sold' | 'rec';
/** The Revenue row each basis reads (rvc:<asset>:<key>). */
export const SPREAD_BASIS_ROW: Record<SpreadBasis, string> = { cash: 'cash', sold: 'saleRev', rec: 'rec' };
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
  /** A 'collections' spread's basis (absent = cash collected, the original). */
  basis?: SpreadBasis;
  /** A 'blend' (the commission terms): the spreads it combines, by basis (2026-11-18). */
  parts?: Partial<Record<SpreadBasis, string>>;
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

/**
 * ONE CURVE ROW FOR THE SAME CURVE (2026-11-15, founder): assets whose typed spend curves are the same
 * on the platform share one curve, read from one Inputs row. The first asset of each curve (in the
 * model's order) stands for the group; Inputs lists the group on that row and registers every member's
 * key there, so the Capex rows that read it are exact.
 */
export function curveGroups(state: { assets: Asset[] }): Map<string, string[]> {
  const sig = (a: Asset): string => {
    const d = (a.capexPhasing?.distribution ?? []).map((v) => Math.max(0, v ?? 0));
    while (d.length && d[d.length - 1] === 0) d.pop();
    return JSON.stringify(d);
  };
  const out = new Map<string, string[]>();
  const firstOf = new Map<string, string>();
  for (const a of state.assets) {
    if (a.visible === false || a.capexPhasing?.phasing !== 'manual' || !(a.capexPhasing.distribution ?? []).some((v) => (v ?? 0) !== 0)) continue;
    const k = sig(a);
    const first = firstOf.get(k);
    if (first) out.get(first)!.push(a.id); else { firstOf.set(k, a.id); out.set(a.id, [a.id]); }
  }
  return out;
}
export function curveCanon(state: { assets: Asset[] }): Map<string, string> {
  const m = new Map<string, string>();
  for (const [first, ids] of curveGroups(state)) for (const id of ids) m.set(id, first);
  return m;
}

/**
 * ONE WINDOW FOR THE CASH AND IN-KIND LAND LINES WHERE THEY MATCH (2026-11-15, founder): in a phase whose
 * two land value lines carry the same window (the line's own, and every asset override the same on both),
 * the in-kind line reads the cash line's window: one Inputs row and one spend share. Maps the in-kind
 * line id to the cash line id.
 */
export function landWindowCanon(state: { costLines: CostLine[]; costOverrides: CostOverride[]; phases: Phase[] }): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of state.phases) {
    const cash = state.costLines.find((l) => l.phaseId === p.id && isLandValueLine(l) && l.method === 'percent_of_cash_land');
    const kind = state.costLines.find((l) => l.phaseId === p.id && isLandValueLine(l) && l.method === 'percent_of_inkind_land');
    if (!cash || !kind) continue;
    const same = (a: CostLine, b: CostLine): boolean => a.windowFollowsConstruction === b.windowFollowsConstruction && a.startPeriod === b.startPeriod && a.endPeriod === b.endPeriod && (a.phasing ?? 'even') === (b.phasing ?? 'even');
    if (!same(cash, kind)) continue;
    const win = (lineId: string, assetId: string): string => {
      const o = state.costOverrides.find((x) => x.assetId === assetId && x.lineId === lineId && x.overridden !== false);
      return o && (o.startPeriod !== undefined || o.endPeriod !== undefined) ? `${o.startPeriod}-${o.endPeriod}` : '';
    };
    const assets = [...new Set(state.costOverrides.filter((o) => o.lineId === cash.id || o.lineId === kind.id).map((o) => o.assetId))];
    if (assets.some((id) => win(cash.id, id) !== win(kind.id, id))) continue;
    out.set(kind.id, cash.id);
  }
  return out;
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
  const curveOf = curveCanon(state);
  const landOf = landWindowCanon(state);
  const lid = (line: CostLine): string => landOf.get(line.id) ?? line.id;
  // A ROW IS SHARED ONLY WHERE THE RULE IS THE SAME (2026-11-15, founder): a landscape window follows its
  // own rule (from half the construction years) even where its years happen to match, so it keeps its row.
  const sameAsStd = (_line: CostLine, _p: Phase): boolean => false;
  const winTag = (line: CostLine, w: { win: SpreadRow['win'] }, a?: Asset, p?: Phase): string => (w.win === 'follows' ? `f:${p && sameAsStd(line, p) ? 'std' : followedRule(deriveLineBaseId(line.id))}` : w.win === 'plot' ? `p:${a!.id}:${lid(line)}` : lid(line));
  const baseOf = (line: CostLine, p: Phase, w: { win: SpreadRow['win'] }): string => (w.win === 'follows' && sameAsStd(line, p) ? '__std__' : deriveLineBaseId(line.id));
  const evenRow = (line: CostLine, p: Phase, a?: Asset): string => {
    const win = windowOf(line, p, a);
    const key = `even|${p.id}|${winTag(line, win, a, p)}`;
    if (!rows.has(key)) rows.set(key, {
      key, phaseId: p.id, kind: 'even', start: win.start, end: Math.max(win.start, win.end), win: win.win, follows: win.follows, lineId: lid(line), baseId: baseOf(line, p, win),
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
    // The group's first asset stands for a curve shared by several (curveGroups).
    const ca = curveOf.get(a.id) ?? a.id;
    const key = `curve|${win.win === 'plot' ? a.id : ca}|${p.id}|${winTag(line, win, a, p)}`;
    if (!rows.has(key)) {
      const local = new Array<number>(Math.max(win.start, win.end) + 1).fill(0);
      slice.forEach((v, k) => { local[win.start + k] = v / sum; });
      rows.set(key, {
        key, phaseId: p.id, kind: 'curve', start: win.start, end: Math.max(win.start, win.end), win: win.win, follows: win.follows, lineId: lid(line), baseId: baseOf(line, p, win), assetId: win.win === 'plot' ? a.id : ca,
        label: `Curve, ${assetLabel(a, names)}, P${win.start} to P${Math.max(win.start, win.end)}`,
        shares: toAxis(local, offsetOf(p)),
      });
    }
    return key;
  };
  /** The phase-local series of a basis (the engine's own placement, capexPhasing.ts). */
  const basisSeries = (a: Asset, p: Phase, basis: SpreadBasis): number[] | undefined => {
    if (basis === 'cash') return collectionsForAsset(revenue, a.id, p, projectStartYear);
    const sh = sellShapesForAssetAtOffset(revenue as never, a.id, offsetOf(p), p);
    return basis === 'sold' ? sh.sales : sh.handover;
  };
  /** A share row on a basis other than cash collected (the sale year, the handover), same shape as collections. */
  const basisRow = (a: Asset, line: CostLine, p: Phase, basis: SpreadBasis): string | null => {
    if (basis === 'cash') return collectionsRow(a, line, p);
    const pos = (basisSeries(a, p, basis) ?? []).map((v) => Math.max(0, v ?? 0));
    const sum = pos.reduce((s, v) => s + v, 0);
    if (!(sum > 0)) return null;
    const win = windowOf(line, p, a);
    const key = `coll|${basis}|${a.id}|${winTag(line, win, a)}`;
    if (!rows.has(key)) rows.set(key, {
      key, phaseId: p.id, kind: 'collections', basis, start: win.start, end: Math.max(win.start, win.end), win: win.win, follows: win.follows, lineId: line.id, baseId: deriveLineBaseId(line.id), assetId: a.id,
      label: `${basis === 'sold' ? 'Units sold' : 'Handover'}, ${assetLabel(a, names)}`,
      shares: toAxis(pos.map((v) => v / sum), offsetOf(p)),
    });
    return key;
  };
  /** THE COMMISSION TERMS (2026-11-18): the share on contract on the sale year, the rest on collections or the
   *  handover, as Inputs says; the platform's shares are commissionShape, the engine's own rule. */
  const commissionRow = (a: Asset, line: CostLine, p: Phase): string | null => {
    const parts: Partial<Record<SpreadBasis, string>> = {};
    for (const b of ['sold', 'cash', 'rec'] as const) { const k = basisRow(a, line, p, b); if (k) parts[b] = k; }
    if (!parts.sold && !parts.cash && !parts.rec) return null;
    const local = commissionShape(a.commissionTiming, { salesPerPeriod: basisSeries(a, p, 'sold'), collectionsPerPeriod: basisSeries(a, p, 'cash'), handoverPerPeriod: basisSeries(a, p, 'rec') });
    if (!local) return null;
    const win = windowOf(line, p, a);
    const key = `ctb|${a.id}|${winTag(line, win, a)}`;
    if (!rows.has(key)) rows.set(key, {
      key, phaseId: p.id, kind: 'blend', parts, start: win.start, end: Math.max(win.start, win.end), win: win.win, follows: win.follows, lineId: line.id, baseId: deriveLineBaseId(line.id), assetId: a.id,
      label: `Commission terms, ${assetLabel(a, names)}`,
      shares: toAxis(local, offsetOf(p)),
    });
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
        else if (src === 'sales') spread = basisRow(a, line, p, 'sold') ?? evenRow(line, p, a);
        else if (src === 'commission_terms') spread = commissionRow(a, line, p) ?? evenRow(line, p, a);
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

/**
 * THE CONSTRUCTION PHASING TABLE (2026-11-19, founder: "phasing inputs as one working table on Project Inputs").
 *
 * Every spend share the Capex tab reads that is not driven by revenue (an even window, a plot's curve) is one
 * row of % by construction year, typed on the input tab. The Capex share of a year is that year's % over the
 * row's total (the engine slices a curve to the window and normalises it, and a typed row that does not add to
 * 100% is read the same way):
 *
 *   - one row per spend curve (plots typing the same curve share it, curveGroups), the phase curve;
 *   - one row per phase for the land value lines (cash and in-kind) and the lines that follow the land cash
 *     (RETT), as % by year, where they differ from the curve;
 *   - one row only for a line whose spread differs from its phase's rows (landscape on its own window, a plot
 *     without a curve): a line whose spread a row reproduces EXACTLY reads that row and has none of its own.
 *
 * Year k of a phase is its k-th calendar year (year 0 the year before it starts, shown only when a share falls
 * there); a phase that starts with the model has no year 0, so the engine's period 0 lands in year 1, where the
 * project axis puts it. A cell outside a row's years is "n/a".
 *
 * Shared by the builder (which writes the rows and the Capex share rows) and the live layer (which writes the
 * formulas), so the two cannot disagree. Pure.
 */
export interface PhasingTableRow {
  /** Registry keys of the row: `inpcurve:<asset>` for every plot of a curve, else `inpph:<n>`. */
  keys: string[];
  /** The row's name on the input tab. */
  label: string;
  /** Its name on the Capex tab after the phase ("curve", "land and RETT", "landscape override"). */
  short: string;
  /** The phases whose spreads read it (a curve may be shared by plots of several phases). */
  phaseIds: string[];
  kind: 'curve' | 'land' | 'line';
  /** The phase's standard spread (its curve, or even over its construction years where it has no curve). */
  standard: boolean;
  /** The % by construction year (a share); a year absent from the map is "n/a" on the row. */
  values: Map<number, number>;
  /** The spread rows (planCapexSpread keys) that read it, with their phase. */
  spreads: Array<{ key: string; phaseId: string }>;
}
export interface PhasingTable {
  rows: PhasingTableRow[];
  /** The first and last construction year the table shows (0 only when a share falls in the year before a phase). */
  kMin: number;
  kMax: number;
  /** A spread key -> the index of the row it reads. */
  rowOfSpread: Map<string, number>;
}

/** The spread rows a formula reads: the one spread of each asset's line, and every plot's spread a blend combines. */
export function usedSpreads(plan: CapexSpreadPlan, blends: CapexBlendPlan): Set<string> {
  const out = new Set<string>();
  for (const v of blends.use.values()) if (v.startsWith('cxw:')) out.add(v.slice(4));
  for (const b of blends.hard) for (const id of b.plots) { const s = plan.plotLine.get(`${id}|${b.lid}`)?.spread; if (s) out.add(s); }
  for (const b of blends.soft) for (const id of b.plots) for (const lid of b.lids) { const s = plan.plotLine.get(`${id}|${lid}`)?.spread; if (s) out.add(s); }
  // A blend (the commission terms) reads its parts.
  for (const k of [...out]) for (const p of Object.values(plan.rows.get(k)?.parts ?? {})) if (p) out.add(p);
  return out;
}

export function planPhasingTable(
  state: PlanState,
  plan: CapexSpreadPlan,
  used: Set<string>,
  projectStartYear: number,
  axisLength: number,
): PhasingTable {
  const N = axisLength;
  const phases = state.phases;
  const offOf = (p: Phase): number => Math.max(0, new Date(p.startDate as string).getUTCFullYear() - projectStartYear);
  const cpOf = (p: Phase): number => Math.max(1, p.constructionPeriods ?? 0);
  const phaseById = new Map(phases.map((p) => [p.id, p] as const));
  const implied = (values: Map<number, number>, off: number): number[] => {
    let tot = 0; for (const v of values.values()) tot += Math.max(0, v);
    const out = new Array<number>(N).fill(0);
    if (!(tot > 0)) return out;
    for (let t = 0; t < N; t++) out[t] = Math.max(0, values.get(t - off + 1) ?? 0) / tot;
    return out;
  };
  const same = (a: number[], b: number[]): boolean => a.every((v, t) => Math.abs(v - (b[t] ?? 0)) < 1e-9);
  const byYear = (shares: number[], off: number): Map<number, number> => {
    const m = new Map<number, number>();
    shares.forEach((v, t) => { if (Math.abs(v) > 1e-12) m.set(t - off + 1, (m.get(t - off + 1) ?? 0) + v); });
    return m;
  };
  const isStd = (sp: SpreadRow): boolean => sp.win === 'follows' && followedRule(sp.baseId) === 'std';
  // The curve rows, made when a spread reads one: every plot of a curve group shares its row.
  const groups = curveGroups(state);
  const curveCand = [...groups.entries()].map(([first, ids]) => {
    const a = state.assets.find((x) => x.id === first)!;
    const ph = [...new Set(ids.map((id) => state.assets.find((x) => x.id === id)?.phaseId).filter((x): x is string => !!x))];
    const hi = Math.max(1, ...ph.map((id) => cpOf(phaseById.get(id)!)));
    const dist = a.capexPhasing?.distribution ?? [];
    const values = new Map<number, number>();
    for (let k = 1; k <= hi; k++) values.set(k, Math.max(0, dist[k] ?? 0) / 100);
    return { first, ids, values, phaseIds: ph };
  });
  type Row = PhasingTableRow & { who?: Asset[] };
  const rows: Row[] = [];
  const rowOfSpread = new Map<string, number>();
  const curveRowOf = new Map<string, number>();
  const names = { parcels: state.parcels, phases };
  // The spreads to place, the curves first (so a line on a curve's years reads the curve row), phase by phase.
  const order = [...plan.rows.values()].filter((sp) => used.has(sp.key) && (sp.kind === 'even' || sp.kind === 'curve'))
    .sort((x, y) => phases.findIndex((p) => p.id === x.phaseId) - phases.findIndex((p) => p.id === y.phaseId)
      || (x.kind === 'curve' ? 0 : 1) - (y.kind === 'curve' ? 0 : 1) || (isStd(x) ? 0 : 1) - (isStd(y) ? 0 : 1));
  for (const sp of order) {
    const ph = phaseById.get(sp.phaseId);
    if (!ph) continue;
    const off = offOf(ph);
    const shares = sp.shares.slice(0, N);
    // 1. A row already made reproduces it: a curve row in any phase, any other row in its own phase.
    let at = rows.findIndex((r) => (r.kind === 'curve' || r.phaseIds.includes(ph.id)) && same(implied(r.values, off), shares));
    // 2. A curve not yet on the table reproduces it (its own plot's first).
    if (at < 0) {
      const own = sp.kind === 'curve' ? curveCand.find((c) => c.ids.includes(sp.assetId ?? '')) : undefined;
      const cand = [own, ...curveCand].filter((c): c is typeof curveCand[number] => !!c && !curveRowOf.has(c.first)).find((c) => same(implied(c.values, off), shares));
      if (cand) {
        const who = cand.ids.map((id) => state.assets.find((x) => x.id === id)).filter((x): x is Asset => !!x);
        rows.push({ keys: cand.ids.map((id) => `inpcurve:${id}`), label: '', short: '', phaseIds: [...cand.phaseIds], kind: 'curve', standard: true, values: cand.values, spreads: [], who });
        at = rows.length - 1;
        curveRowOf.set(cand.first, at);
      }
    }
    // 3. Its own row of % by year.
    if (at < 0) {
      const values = byYear(shares, off);
      // Year 0 only where a share falls in the year before the phase (a phase that starts with the model has
      // none on the axis: its period 0 is already in year 1).
      const first = off > 0 && (values.get(0) ?? 0) > 0 ? 0 : 1;
      const hi = Math.max(cpOf(ph), ...values.keys());
      for (let k = first; k <= hi; k++) if (!values.has(k)) values.set(k, 0);
      const land = isParcelDrivenLandLine({ id: sp.lineId });
      rows.push({ keys: [], label: '', short: '', phaseIds: [ph.id], kind: land ? 'land' : 'line', standard: !land && isStd(sp), values, spreads: [] });
      at = rows.length - 1;
    }
    const row = rows[at];
    if (!row.phaseIds.includes(ph.id)) row.phaseIds.push(ph.id);
    row.spreads.push({ key: sp.key, phaseId: ph.id });
    rowOfSpread.set(sp.key, at);
  }
  // Names: what reads each row, in the platform's words.
  const linesOf = (r: Row): CostLine[] => {
    const keys = new Set(r.spreads.map((s) => s.key));
    const ids = new Set([...plan.plotLine.values()].filter((pl) => keys.has(pl.spread) && !pl.disabled).map((pl) => pl.lineId));
    return state.costLines.filter((l) => ids.has(l.id));
  };
  const phaseName = (id: string): string => phaseById.get(id)?.name ?? id;
  const multi = phases.length > 1;
  for (const r of rows) {
    const ph = [...new Set(r.phaseIds)].sort((a, b) => phases.findIndex((p) => p.id === a) - phases.findIndex((p) => p.id === b)).map(phaseName);
    const phs = ph.length > 1 ? `${ph.slice(0, -1).join(', ')} and ${ph[ph.length - 1]}` : ph[0] ?? '';
    const lines = linesOf(r);
    if (r.kind === 'curve' || r.standard) {
      const curvesIn = r.phaseIds.map((id) => curveCand.filter((c) => c.phaseIds.includes(id)).length);
      const named = curvesIn.some((n) => n > 1) && r.who ? `, ${[...new Set(r.who.map((a) => String(a.type ?? '').trim() || assetLabel(a, names)))].join(', ')}` : '';
      r.standard = true;
      r.label = `${multi ? `${phs} curve` : 'Phase curve'}${named} (all other ${multi ? `${phs} ` : ''}lines)`;
      r.short = `curve${named}`;
      continue;
    }
    if (r.kind === 'land') {
      const cash = lines.some((l) => isLandValueLine(l) && l.method === 'percent_of_cash_land');
      const kind = lines.some((l) => isLandValueLine(l) && l.method === 'percent_of_inkind_land');
      const land = cash && kind ? 'Land (cash and in-kind)' : cash ? 'Land (cash)' : 'Land (in-kind)';
      const rest = [...new Set(lines.filter((l) => !isLandValueLine(l)).map((l) => l.name))];
      r.label = `${land}${rest.length ? ` and ${rest.join(', ')}` : ''}${multi ? `, ${phs}` : ''}`;
      r.short = `land${rest.length ? ` and ${rest.join(', ')}` : ''}`;
      continue;
    }
    const nm = [...new Set(lines.map((l) => l.name))];
    r.label = `${nm.join(', ') || 'Cost line'}${multi ? `, ${phs}` : ''}`;
    r.short = `${nm.join(', ').toLowerCase() || 'line'} override`;
  }
  // Order: the curves, then land, then the other lines, each by phase.
  const rank = (r: Row): number => (r.standard ? 0 : r.kind === 'land' ? 1 : 2);
  const phaseRank = (r: Row): number => Math.min(...r.phaseIds.map((id) => phases.findIndex((p) => p.id === id)));
  const sorted = rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || phaseRank(a.r) - phaseRank(b.r) || a.i - b.i);
  const remap = new Map(sorted.map((x, j) => [x.i, j] as const));
  const out: PhasingTableRow[] = sorted.map((x) => { const { who: _who, ...rest } = x.r; void _who; return rest; });
  out.forEach((r, j) => { if (r.kind !== 'curve') r.keys = [`inpph:${j}`]; });
  for (const [k, i] of rowOfSpread) rowOfSpread.set(k, remap.get(i)!);
  const allK = out.flatMap((r) => [...r.values.keys()]);
  const maxCp = Math.max(1, ...phases.map(cpOf));
  return { rows: out, kMin: allK.some((k) => k <= 0) ? 0 : 1, kMax: Math.max(maxCp, ...allK), rowOfSpread };
}
