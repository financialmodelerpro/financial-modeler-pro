/**
 * costPerSqmReport.ts (2026-09-24)
 *
 * COST PER SQM, PER LINE, AND WHAT A SELL LINE EARNS PER SQM.
 *
 * The founder's analysis for the end of the Capex results:
 *
 *   1. A grid per line: three cost bases against three area denominators.
 *        construction      = hard + soft + operating (pre-opening), the
 *                            platform's one definition (`constructionCostOf`)
 *        + IDC             = construction + capitalised interest
 *        + land            = construction + IDC + the land stage
 *      each over NSA, BUA and GFA (the platform's three tiers,
 *      NSA within BUA within GFA, as `resolveAssetAreaMetrics` states them).
 *
 *   2. For SELL lines only, on NSA: the three cost bases against two prices,
 *        base price     = GDV at the Table 5 prices, before escalation,
 *                         over area sold
 *        realised price = GDV (what the engine sold for, escalation included)
 *                         over area sold
 *      the margin per sqm against each, and the gap between the two prices,
 *      which is what escalation earned per sqm.
 *
 * NOTHING HERE IS COMPUTED A SECOND TIME. Each figure is read from where the
 * platform already holds it:
 *   - hard, soft and the land stage (land value plus anything else charged in
 *     that stage, RETT above all) from `buildCapexReport(...).treatment`, the
 *     rows the Capex tab and the workbook render;
 *   - NSA, BUA and GFA from the SAME treatment rows, which carry the metrics
 *     the Capex report resolved (through the one massing door it already is,
 *     so this file is not a sixth, `verify-retail-companion` J5);
 *   - capitalised IDC from the IDC schedule, floored at zero per period, the
 *     rule cost of sales applies to the same series;
 *   - GDV, and area and units sold, from the engine's Sell result; GDV at base
 *     prices as quantity sold x the sub-unit's base price (Table 5), the same
 *     base the Revenue tab's price table multiplies by the indexation factor.
 * Rows are LINES (`planCapexSummaryLines`), as on every surface after the
 * Assets tab, so a line's figures are its plots' figures summed before any
 * division.
 *
 * Marketing is in no base: it sits outside construction everywhere.
 *
 * Pure. No em dashes in this file.
 */
import { resolveSubUnitMetric } from '@/src/core/calculations';
import { assetLabel } from '@/src/core/calculations/assetName';
import type { ProjectFinancialsSnapshot, FinancialsResolverState } from '../financials-resolvers';
import { buildCapexReport, planCapexSummaryLines, constructionCostOf, type CapexPlannableAsset } from './capexReports';

/** The three cost bases, in the order they build up. */
export const COST_BASES = [
  { key: 'construction', label: 'Construction (hard, soft, pre-opening)' },
  { key: 'withIdc', label: 'Construction + IDC' },
  { key: 'withLand', label: 'Construction + IDC + land' },
] as const;
export type CostBaseKey = typeof COST_BASES[number]['key'];

/** The three area denominators, smallest first. */
export const AREA_BASES = [
  { key: 'nsa', label: 'NSA' },
  { key: 'bua', label: 'BUA' },
  { key: 'gfa', label: 'GFA' },
] as const;
export type AreaKey = typeof AREA_BASES[number]['key'];

export interface CostPerSqmLine {
  key: string;
  label: string;
  phaseName: string;
  strategy: string;
  /** The assets (plots) this line sums. */
  memberIds: string[];
  /** Amounts, before any division. */
  hard: number;
  soft: number;
  /** The operating (pre-opening) stage, inside construction. */
  operating: number;
  idc: number;
  land: number;
  cost: Record<CostBaseKey, number>;
  area: Record<AreaKey, number>;
  /** cost / area, or null where the area is zero (nothing to divide by). */
  perSqm: Record<CostBaseKey, Record<AreaKey, number | null>>;
  /** Present on a Sell line only. */
  sale?: SaleComparison;
}

export interface SaleComparison {
  /** Everything the engine sold for, escalation included. */
  gdv: number;
  /** The same quantities at the Table 5 prices, before escalation. */
  gdvAtBase: number;
  /** Area sold over the whole model (sqm). */
  areaSold: number;
  /** NSA of the line, for reading area sold against it. */
  nsa: number;
  basePrice: number | null;
  realisedPrice: number | null;
  /** realised less base: what escalation earned per sqm sold. */
  escalationPerSqm: number | null;
  /** Cost per sqm of NSA, per base. */
  costPerSqm: Record<CostBaseKey, number | null>;
  /** price less cost per sqm, per price and per base. */
  marginAtBase: Record<CostBaseKey, number | null>;
  marginAtRealised: Record<CostBaseKey, number | null>;
}

export interface CostPerSqmReport { lines: CostPerSqmLine[] }

const sum = (xs: readonly number[] | undefined): number => (xs ?? []).reduce((s, v) => s + (v ?? 0), 0);
const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const sub = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b);

export function buildCostPerSqmReport(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState): CostPerSqmReport {
  const capex = buildCapexReport(snap, state);
  const rowById = new Map(capex.treatment.map((r) => [r.id, r] as const));
  const priced = state.assets.filter((a) => rowById.has(a.id));
  const plan = planCapexSummaryLines(
    priced as unknown as CapexPlannableAsset[],
    state.phases,
    (id) => { const a = priced.find((x) => x.id === id); return a ? assetLabel(a, state) : id; },
  );

  const idcOf = (id: string): number =>
    (snap.idc.byAsset.get(id)?.idcPerPeriod ?? []).reduce((s, v) => s + Math.max(0, v ?? 0), 0);

  const lines: CostPerSqmLine[] = [];
  for (const ln of plan) {
    let hard = 0, soft = 0, operating = 0, land = 0, idc = 0, nsa = 0, bua = 0, gfa = 0;
    let gdv = 0, gdvAtBase = 0, areaSold = 0, sellMembers = 0;
    for (const id of ln.assetIds) {
      const r = rowById.get(id);
      if (!r) continue;
      hard += r.hard; soft += r.soft; operating += r.operating; land += r.landStage;
      idc += idcOf(id);
      nsa += r.nsa ?? 0; bua += r.bua ?? 0; gfa += r.gfa ?? 0;

      const sell = snap.revenue.bySellAsset.get(id);
      const asset = state.assets.find((a) => a.id === id);
      if (!sell || !asset) continue;
      sellMembers++;
      gdv += sum(sell.presalesRevenuePerPeriod) + sum(sell.postSalesRevenuePerPeriod);
      areaSold += sum(sell.presalesAreaPerPeriod) + sum(sell.postSalesAreaPerPeriod);
      for (const su of state.subUnits.filter((s) => s.assetId === id)) {
        const byUnits = resolveSubUnitMetric(su, asset) === 'units';
        const qty = byUnits
          ? sum(sell.presalesUnitsPerPeriodPerSubUnit[su.id]) + sum(sell.postSalesUnitsPerPeriodPerSubUnit[su.id])
          : sum(sell.presalesAreaPerPeriodPerSubUnit[su.id]) + sum(sell.postSalesAreaPerPeriodPerSubUnit[su.id]);
        gdvAtBase += qty * Math.max(0, su.unitPrice ?? 0);
      }
    }

    const construction = constructionCostOf({ hard, soft, operating });
    const cost: Record<CostBaseKey, number> = {
      construction,
      withIdc: construction + idc,
      withLand: construction + idc + land,
    };
    const area: Record<AreaKey, number> = { nsa, bua, gfa };
    const perSqm = Object.fromEntries(COST_BASES.map((b) => [b.key,
      Object.fromEntries(AREA_BASES.map((ar) => [ar.key, div(cost[b.key], area[ar.key])])),
    ])) as CostPerSqmLine['perSqm'];

    let sale: SaleComparison | undefined;
    if (sellMembers > 0) {
      const basePrice = div(gdvAtBase, areaSold);
      const realisedPrice = div(gdv, areaSold);
      const costPerSqm = Object.fromEntries(COST_BASES.map((b) => [b.key, perSqm[b.key].nsa])) as SaleComparison['costPerSqm'];
      sale = {
        gdv, gdvAtBase, areaSold, nsa, basePrice, realisedPrice,
        escalationPerSqm: sub(realisedPrice, basePrice),
        costPerSqm,
        marginAtBase: Object.fromEntries(COST_BASES.map((b) => [b.key, sub(basePrice, costPerSqm[b.key])])) as SaleComparison['marginAtBase'],
        marginAtRealised: Object.fromEntries(COST_BASES.map((b) => [b.key, sub(realisedPrice, costPerSqm[b.key])])) as SaleComparison['marginAtRealised'],
      };
    }

    lines.push({ key: ln.key, label: ln.label, phaseName: ln.phaseName, strategy: ln.strategy, memberIds: ln.assetIds, hard, soft, operating, idc, land, cost, area, perSqm, sale });
  }
  return { lines };
}

/** The unit an AMOUNT column is stated in, from the scale it is shown at. */
export function amountUnit(currency: string, scale: 'full' | 'thousands' | 'millions'): string {
  return scale === 'thousands' ? `${currency} '000` : scale === 'millions' ? `${currency} M` : currency;
}

/* ───────────────── the two tables, as every surface prints them ───────────────── */

/** A cell: text, or a number tagged with WHAT it is, so each surface formats
 *  it its own way (the screen and PDF as text, the workbook as a number with a
 *  number format) and none of them decides what the figure is. */
export type CostPerSqmCell =
  | string
  | { n: number | null; as: 'amount' | 'perSqm' | 'area' };

export interface CostPerSqmTable {
  title: string;
  caption: string;
  columns: string[];
  rows: Array<{ cells: CostPerSqmCell[]; kind: 'heading' | 'data' | 'subtotal' }>;
}

/**
 * TABLE 7 AS ROWS (2026-09-24): titles, captions, columns and rows stated once,
 * so the Capex screen, the PDF and the workbook print the same table in the
 * same words. `scaleTag` is the amount column's unit ("SAR '000"); per-sqm
 * figures are always full currency units.
 */
export function costPerSqmTables(
  lines: readonly CostPerSqmLine[],
  opts: { currency: string; scaleTag: string; multiPhase: boolean },
): CostPerSqmTable[] {
  const { currency, scaleTag, multiPhase } = opts;
  const name = (l: CostPerSqmLine): string => (multiPhase ? `${l.label}, ${l.phaseName}` : l.label);
  const out: CostPerSqmTable[] = [];
  if (lines.length === 0) return out;

  const a: CostPerSqmTable = {
    title: 'Table 7a - Cost per sqm, by line',
    caption: `Cost in ${scaleTag}; per sqm figures in ${currency} at full scale. Construction is the hard, soft and pre-opening stages, the platform's one definition of the word; IDC is the interest capitalised to the line; land is the land stage (land value and anything charged with it, such as transfer tax). Marketing sits outside all three. Each is divided by the line's NSA, BUA and GFA (NSA within BUA within GFA).`,
    columns: ['Line and cost base', `Cost (${scaleTag})`, ...AREA_BASES.map((x) => `Per sqm of ${x.label}`)],
    rows: [],
  };
  for (const l of lines) {
    a.rows.push({ kind: 'heading', cells: [name(l), '', ...AREA_BASES.map((x) => ({ n: l.area[x.key], as: 'area' as const }))] });
    for (const b of COST_BASES) {
      a.rows.push({ kind: 'data', cells: [b.label, { n: l.cost[b.key], as: 'amount' }, ...AREA_BASES.map((x) => ({ n: l.perSqm[b.key][x.key], as: 'perSqm' as const }))] });
    }
  }
  out.push(a);

  const sells = lines.filter((l) => l.sale);
  if (sells.length > 0) {
    const t: CostPerSqmTable = {
      title: 'Table 7b - Sale price against cost, per sqm of NSA (Sell lines)',
      caption: `${currency} per sqm, at full scale. The base price is what the area sold would fetch at the Table 5 prices before escalation; the realised price is GDV (what the model sells it for, escalation included) over the area sold. The margin is each price less the cost per sqm of NSA on each base, and the gap between the two prices is what escalation earned per sqm sold.`,
      columns: ['Line and cost base', 'Cost per sqm of NSA', 'Margin at base price', 'Margin at realised price'],
      rows: [],
    };
    for (const l of sells) {
      const s = l.sale!;
      t.rows.push({ kind: 'heading', cells: [name(l), 'Area sold (sqm)', 'Base price', 'Realised price'] });
      t.rows.push({ kind: 'data', cells: [`NSA ${Math.round(s.nsa).toLocaleString('en-US')} sqm`, { n: s.areaSold, as: 'area' }, { n: s.basePrice, as: 'perSqm' }, { n: s.realisedPrice, as: 'perSqm' }] });
      for (const b of COST_BASES) {
        t.rows.push({ kind: 'data', cells: [b.label, { n: s.costPerSqm[b.key], as: 'perSqm' }, { n: s.marginAtBase[b.key], as: 'perSqm' }, { n: s.marginAtRealised[b.key], as: 'perSqm' }] });
      }
      t.rows.push({ kind: 'subtotal', cells: ['Escalation earned (realised less base price)', '', '', { n: s.escalationPerSqm, as: 'perSqm' }] });
    }
    out.push(t);
  }
  return out;
}
