/**
 * sellingCosts.ts (2026-08-19)
 *
 * THE ONE PLACE A PERCENT-OF-REVENUE COST IS MULTIPLIED OUT.
 *
 * A marketing budget and a sales commission are percentages of revenue. The RATE
 * is a cost input, typed on the Capex tab where a user expects to type a cost
 * rate. The BASE is a revenue figure, and it belongs to the revenue module,
 * which is the only thing that knows what an asset actually earns over the hold.
 * This file owns the join, so the Capex engine and the Module 2 Revenue display
 * cannot arrive at two different answers.
 *
 * ── WHY IT LIVES IN core/calculations/revenue AND NOT IN THE PLATFORM ────────
 *
 * `computeAssetCost` lives in `src/core` and must not import the platform hub.
 * The revenue snapshot is therefore consumed STRUCTURALLY (see `RevenueSource`),
 * exactly as `capexPhasing.ts` already consumes it for the collections series.
 *
 * ── THE DEPENDENCY DIRECTION, WHICH MUST NOT INVERT ──────────────────────────
 *
 *     sub-units + phases  ->  computeAllSellResults        (reads NO cost input)
 *              sale / operating revenue
 *                         ->  resolveSellingCostBasis      (this file)
 *              basis x rate
 *                         ->  computeAssetCost             (reads, never re-derives)
 *                         ->  capex, financing, statements, exports
 *
 * Acyclic, and it stays acyclic only because `computeAllSellResults` takes
 * project, phases, assets and sub-units and nothing from the cost side. Note
 * that `revenue-resolvers.computeAssetCapex` calls BACK into `computeAssetCost`,
 * so the ordering above is load-bearing rather than incidental: revenue must be
 * fully resolved before any cost is valued.
 *
 * ── THE DEFECT HISTORY THIS CLOSES ───────────────────────────────────────────
 *
 * The base used to be `computeAssetRevenue`, the sum of `metricValue x unitPrice`
 * over the Sellable AND Operable AND Leasable sub-units. Those are three
 * incompatible products: a sale value for the first, ONE YEAR of rent for the
 * second, ONE NIGHT at full occupancy for the third. Measured on the live
 * projects, that understated a leased asset by 5x to 11x and a hotel by 2,255x
 * to 4,739x, and it ignored sale price indexation so even a Sell asset was low.
 *
 * Pure. No em dashes in this file.
 */

/** The methods whose amount is a percentage of a revenue figure. */
export type SellingCostMethod =
  | 'percent_of_revenue_sale'
  | 'percent_of_revenue_cash'
  | 'percent_of_total_revenue';

export const SELLING_COST_METHODS: readonly SellingCostMethod[] = [
  'percent_of_revenue_sale',
  'percent_of_revenue_cash',
  'percent_of_total_revenue',
];

export function isSellingCostMethod(method: string): method is SellingCostMethod {
  return (SELLING_COST_METHODS as readonly string[]).includes(method);
}

/**
 * The shape a revenue snapshot presents here. Structural rather than the
 * concrete `ProjectRevenueSnapshot`, so `src/core` keeps no import back into the
 * platform's revenue resolvers. Superset-compatible with `CollectionsSource` in
 * capexPhasing.ts, and the real snapshot satisfies both.
 */
export interface RevenueSource {
  bySellAsset: Map<string, {
    cashCollectedPerPeriod?: number[];
    presalesRevenuePerPeriod?: number[];
    postSalesRevenuePerPeriod?: number[];
  } | undefined>;
  byHospitalityAsset?: Map<string, { totalRevenuePerPeriod?: number[] } | undefined>;
  byLeaseAsset?: Map<string, { totalRevenuePerPeriod?: number[] } | undefined>;
}

/** Why a basis is what it is, so a row can say it rather than print a bare zero. */
export type SellingCostBasisReason =
  /** A real revenue figure from the revenue module. */
  | 'resolved'
  /** The asset is held and operated, so it has no sale. A genuine zero. */
  | 'no_sale_on_held_asset'
  /** The revenue module resolves this asset to nothing at all. */
  | 'no_revenue'
  /** No revenue snapshot was supplied, so the caller fell back. NOT a zero. */
  | 'no_snapshot';

export interface SellingCostBasis {
  kind: SellingCostMethod;
  /** The figure the percentage is charged on. */
  amount: number;
  reason: SellingCostBasisReason;
  /** True when a revenue snapshot was supplied at all. False means the caller is
   *  on the legacy fallback and the amount above is NOT authoritative. */
  fromRevenueModule: boolean;
  /** One line for the screen, naming the basis. */
  label: string;
}

const sumSeries = (a: readonly number[] | undefined): number =>
  (a ?? []).reduce((s, v) => s + (v ?? 0), 0);

/** The asset's SALE VALUE (GDV) over the hold. Zero for a held asset. */
export function saleRevenueOf(revenue: RevenueSource | undefined, assetId: string): number | undefined {
  if (!revenue?.bySellAsset) return undefined;
  const r = revenue.bySellAsset.get(assetId);
  return sumSeries(r?.presalesRevenuePerPeriod) + sumSeries(r?.postSalesRevenuePerPeriod);
}

/** Sales cash actually collected over the hold. */
export function collectionsOf(revenue: RevenueSource | undefined, assetId: string): number | undefined {
  const series = revenue?.bySellAsset?.get(assetId)?.cashCollectedPerPeriod;
  if (!series || series.length === 0) return undefined;
  return sumSeries(series);
}

/** Sale plus hospitality plus lease revenue over the hold. */
export function totalRevenueOf(revenue: RevenueSource | undefined, assetId: string): number | undefined {
  if (!revenue?.bySellAsset) return undefined;
  if (!revenue.byHospitalityAsset || !revenue.byLeaseAsset) return undefined;
  const sale = saleRevenueOf(revenue, assetId) ?? 0;
  const hosp = sumSeries(revenue.byHospitalityAsset.get(assetId)?.totalRevenuePerPeriod);
  const lease = sumSeries(revenue.byLeaseAsset.get(assetId)?.totalRevenuePerPeriod);
  return sale + hosp + lease;
}

/**
 * THE BASIS for one method on one asset.
 *
 * ZERO AND ABSENT ARE DIFFERENT ANSWERS and conflating them reinstates the
 * defect. A held asset genuinely has no sale value, so a sale-basis line on it
 * is zero; returning "absent" there would send the caller back to the sub-unit
 * product and charge a marketing budget on a hotel's nightly rate. So
 * `fromRevenueModule` is false ONLY when no snapshot was supplied at all.
 *
 * `fallback` is the legacy sub-unit product, used only in that last case, so a
 * caller with no revenue in scope behaves exactly as it did before the link.
 */
export function resolveSellingCostBasis(
  revenue: RevenueSource | undefined,
  assetId: string,
  method: SellingCostMethod,
  fallback: number,
  /** For the wording only: an asset that does not sell. */
  isHeldAsset = false,
): SellingCostBasis {
  const label = method === 'percent_of_revenue_cash' ? 'sales cash collected'
    : method === 'percent_of_revenue_sale' ? 'sale value (GDV), from Revenue'
    : 'total revenue over the hold, from Revenue';

  const raw = method === 'percent_of_revenue_cash' ? collectionsOf(revenue, assetId)
    : method === 'percent_of_revenue_sale' ? saleRevenueOf(revenue, assetId)
    : totalRevenueOf(revenue, assetId);

  if (raw === undefined) {
    return { kind: method, amount: fallback, reason: 'no_snapshot', fromRevenueModule: false, label };
  }
  if (raw > 0) {
    return { kind: method, amount: raw, reason: 'resolved', fromRevenueModule: true, label };
  }
  const reason: SellingCostBasisReason =
    method === 'percent_of_revenue_sale' && isHeldAsset ? 'no_sale_on_held_asset' : 'no_revenue';
  return { kind: method, amount: 0, reason, fromRevenueModule: true, label };
}

/** Clamp a percentage the way the cost engine always has. */
function clampPct(n: number): number {
  const v = Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(100, v));
}

/**
 * THE MULTIPLICATION. The only one in the codebase for these three methods:
 * the cost engine calls it, and so does the Module 2 Revenue display, so the
 * number on screen and the number in the model are the same by construction and
 * not by two sites agreeing.
 */
export function sellingCostAmount(basis: SellingCostBasis, ratePct: number): number {
  return basis.amount * (clampPct(ratePct) / 100);
}

/** One row of the Module 2 Revenue Selling Costs table. */
export interface SellingCostRow {
  assetId: string;
  assetName: string;
  phaseId: string;
  strategy: string;
  lineId: string;
  lineName: string;
  /** 'marketing' | 'commission' | a custom entry id, resolved by the caller. */
  catalogId: string | undefined;
  method: SellingCostMethod;
  ratePct: number;
  basis: SellingCostBasis;
  amount: number;
  /** Empty when the row carries a real figure. Otherwise why it is zero. */
  note: string;
}

export interface SellingCostsSnapshot {
  rows: SellingCostRow[];
  totalByAsset: Map<string, number>;
  total: number;
}

/** The wording for a zero, so a held asset states its reason rather than
 *  printing a bare 0 that reads as a missing input. */
export function sellingCostNote(basis: SellingCostBasis, ratePct: number): string {
  if (basis.reason === 'no_sale_on_held_asset') {
    return 'No sale value: this asset is held and operated, not sold, so a selling cost has nothing to be a percentage of.';
  }
  if (basis.reason === 'no_revenue') {
    return 'The revenue module resolves no revenue for this asset yet.';
  }
  if (basis.reason === 'no_snapshot') {
    return 'No revenue snapshot in scope, so this falls back to the sub-unit list value.';
  }
  if (clampPct(ratePct) === 0) return 'Rate is zero.';
  return '';
}

/**
 * Every selling cost in the model, per asset and per line.
 *
 * Deliberately parameterised on the CALLER's line list and identity resolution
 * rather than importing the catalog: `src/core` does not read the catalog, and
 * a line's behaviour is written onto the line, not looked up (see
 * costCatalog.ts). The caller passes the lines each asset actually carries,
 * which is the shared visibility rule's answer, so a line hidden from an asset
 * cannot appear here either.
 */
export function computeSellingCosts(input: {
  revenue: RevenueSource | undefined;
  assets: ReadonlyArray<{ id: string; name: string; phaseId: string; strategy: string; isCompanion?: boolean }>;
  /** The lines this asset carries, already filtered by the shared rule. */
  linesForAsset: (assetId: string) => ReadonlyArray<{
    id: string; name: string; method: string; value: number; catalogId?: string;
  }>;
  /** The per-asset effective rate, so an override wins exactly as it does in the engine. */
  rateFor: (assetId: string, lineId: string, lineValue: number) => number;
  /** Whether the asset sells. Passed in so there is one definition of it. */
  sells: (strategy: string) => boolean;
  /** The legacy fallback basis, per asset, for the no-snapshot case. */
  fallbackBasis: (assetId: string) => number;
}): SellingCostsSnapshot {
  const rows: SellingCostRow[] = [];
  const totalByAsset = new Map<string, number>();
  let total = 0;
  for (const a of input.assets) {
    if (a.isCompanion === true) continue;
    const held = !input.sells(a.strategy);
    for (const line of input.linesForAsset(a.id)) {
      if (!isSellingCostMethod(line.method)) continue;
      const ratePct = input.rateFor(a.id, line.id, line.value);
      const basis = resolveSellingCostBasis(
        input.revenue, a.id, line.method, input.fallbackBasis(a.id), held,
      );
      const amount = sellingCostAmount(basis, ratePct);
      rows.push({
        assetId: a.id, assetName: a.name, phaseId: a.phaseId, strategy: a.strategy,
        lineId: line.id, lineName: line.name, catalogId: line.catalogId,
        method: line.method, ratePct, basis, amount,
        note: sellingCostNote(basis, ratePct),
      });
      totalByAsset.set(a.id, (totalByAsset.get(a.id) ?? 0) + amount);
      total += amount;
    }
  }
  return { rows, totalByAsset, total };
}
