/**
 * costPerSqmReport.ts (2026-09-24)
 *
 * COST PER SQM, PER LINE, AND WHAT A SELL LINE EARNS PER SQM.
 *
 * The founder's analysis for the end of the Capex results:
 *
 *   1. A grid per line: three cost bases against three area denominators.
 *        construction      = hard + soft
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
 * Marketing and operating stages are not in any base: the founder's bases are
 * construction (hard and soft), interest and land.
 *
 * Pure. No em dashes in this file.
 */
import { resolveSubUnitMetric } from '@/src/core/calculations';
import { assetLabel } from '@/src/core/calculations/assetName';
import type { ProjectFinancialsSnapshot, FinancialsResolverState } from '../financials-resolvers';
import { buildCapexReport, planCapexSummaryLines, type CapexPlannableAsset } from './capexReports';

/** The three cost bases, in the order they build up. */
export const COST_BASES = [
  { key: 'construction', label: 'Construction (hard and soft)' },
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
    let hard = 0, soft = 0, land = 0, idc = 0, nsa = 0, bua = 0, gfa = 0;
    let gdv = 0, gdvAtBase = 0, areaSold = 0, sellMembers = 0;
    for (const id of ln.assetIds) {
      const r = rowById.get(id);
      if (!r) continue;
      hard += r.hard; soft += r.soft; land += r.landStage;
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

    const cost: Record<CostBaseKey, number> = {
      construction: hard + soft,
      withIdc: hard + soft + idc,
      withLand: hard + soft + idc + land,
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

    lines.push({ key: ln.key, label: ln.label, phaseName: ln.phaseName, strategy: ln.strategy, memberIds: ln.assetIds, hard, soft, idc, land, cost, area, perSqm, sale });
  }
  return { lines };
}
