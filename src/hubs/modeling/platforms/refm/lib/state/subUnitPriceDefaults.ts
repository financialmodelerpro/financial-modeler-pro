/**
 * subUnitPriceDefaults.ts (2026-09-15)
 *
 * A TYPE STATES ITS PRICES, AND A TABLE 5 ROW WITH NO PRICE OF ITS OWN TAKES
 * THEM (founder: "if our asset doesn't have multiple sub-units table 5 will get
 * these prices and the user can override there").
 *
 * TWO PRICES PER TYPE, READ BY ITS STRATEGY (founder, same day: "the rate column
 * carries its own unit per row"). Types and Standards carries a price per unit
 * and a price per sqm on each type (`AssetTypeValues.pricePerUnit` /
 * `pricePerSqm`), and what they mean follows the type's strategy
 * (`typePriceColumns`, the ONE rule the tab's unit labels and this settle share):
 *   - Sell or Sell + Manage: both are sale prices, taken by Sellable rows;
 *   - Operate: the per-unit price is the ADR per key night, taken by Operable
 *     rows, and the per-sqm price is not used;
 *   - Lease: the per-sqm price is the rent per sqm per year, taken by Leasable
 *     rows, and the per-unit price is not used;
 *   - no strategy: a row takes the column its category reads (Sellable both,
 *     Operable per unit, Leasable per sqm).
 * A figure the tab does not show can therefore never price a row.
 *
 *   - `SubUnit.priceStated` says whether the row's price is the user's. Typing
 *     a price on Table 5 sets it; on load a row with no marker counts as stated
 *     when it carries any positive price, so every priced row keeps its price.
 *   - Support rows and companion mirror rows are left alone. A blank type price
 *     is 0.
 *
 * `settleSubUnitPrices` then makes `unitPrice` the active basis's price, so run
 * this BEFORE it. Every settle here returns its input when nothing moves.
 * No em dashes in this file.
 */

import type { Asset, SubUnit } from './module1-types';
import type { AssetTypeStandard, AssetTypeValues } from './assetTypeStandards';
import { standardTypeIdFor } from './costStandards';

const positive = (n: number | undefined): boolean => typeof n === 'number' && n > 0;

/** What a type's two prices mean under its strategy: the unit label of each, or
 *  null where the strategy does not use that column. */
export function typePriceColumns(strategy: string | undefined): { unit: string | null; sqm: string | null } {
  if (strategy === 'Sell' || strategy === 'Sell + Manage') return { unit: 'sale price per unit', sqm: 'sale price per sqm' };
  if (strategy === 'Operate') return { unit: 'ADR per key night', sqm: null };
  if (strategy === 'Lease') return { unit: null, sqm: 'rent per sqm per year' };
  return { unit: 'sale price or ADR per key night', sqm: 'sale price or rent per sqm per year' };
}

/** The load marker: absent means "was a price ever given", read from the prices. */
export function settleSubUnitPriceStated(subUnits: readonly SubUnit[]): { subUnits: SubUnit[]; changed: boolean } {
  let changed = false;
  const next = subUnits.map((u) => {
    if (u.priceStated !== undefined) return u;
    changed = true;
    return {
      ...u,
      priceStated: positive(u.unitPrice) || positive(u.pricePerSqm) || positive(u.pricePerUnit) || positive(u.startingAdr),
    };
  });
  return changed ? { subUnits: next, changed } : { subUnits: subUnits as SubUnit[], changed: false };
}

/** The prices a type states for a row of this category, keyed by the row's own
 *  fields. A category the type's strategy does not price gets nothing. */
export function typePricesFor(
  category: SubUnit['category'],
  v: AssetTypeValues | undefined,
): Partial<Record<'pricePerUnit' | 'pricePerSqm', number>> {
  const st = v?.strategy;
  const open = st === undefined;
  if (category === 'Sellable' && (open || st === 'Sell' || st === 'Sell + Manage')) {
    return { pricePerUnit: v?.pricePerUnit ?? 0, pricePerSqm: v?.pricePerSqm ?? 0 };
  }
  if (category === 'Operable' && (open || st === 'Operate')) return { pricePerUnit: v?.pricePerUnit ?? 0 };
  if (category === 'Leasable' && (open || st === 'Lease')) return { pricePerSqm: v?.pricePerSqm ?? 0 };
  return {};
}

export function settleSubUnitPriceDefaults(
  subUnits: readonly SubUnit[],
  assets: readonly Asset[],
  assetTypes: readonly AssetTypeStandard[],
  values: Record<string, AssetTypeValues> | undefined,
): { subUnits: SubUnit[]; changed: boolean } {
  const byId = new Map(assets.map((a) => [a.id, a] as const));
  let changed = false;
  const next = subUnits.map((u) => {
    if (u.priceStated !== false || u.category === 'Support' || u.parentSubUnitId !== undefined) return u;
    const asset = byId.get(u.assetId);
    if (!asset) return u;
    const typeId = standardTypeIdFor(asset, assetTypes);
    const targets = typePricesFor(u.category, typeId !== undefined ? values?.[typeId] : undefined);
    let row = u;
    for (const [key, target] of Object.entries(targets) as Array<['pricePerUnit' | 'pricePerSqm', number]>) {
      // An absent price with a blank default stays absent: nothing to state.
      if ((row[key] ?? 0) === target) continue;
      row = { ...row, [key]: target };
    }
    if (row !== u) changed = true;
    return row;
  });
  return changed ? { subUnits: next, changed } : { subUnits: subUnits as SubUnit[], changed: false };
}

/**
 * THE FOUR FIELDS OF THE FIRST CUT (live for part of 2026-09-15) fold into the
 * two: a sale price or an ADR per unit becomes the price per unit, a sale price
 * or a rent per sqm the price per sqm. A value already stated on the two wins.
 * Load and save only; settles.
 */
const LEGACY_PRICE_KEYS = ['salePricePerUnit', 'adrPerKeyNight', 'salePricePerSqm', 'leaseRatePerSqmYear'] as const;
export function settleTypePriceFields(
  values: Record<string, AssetTypeValues> | undefined,
): { values: Record<string, AssetTypeValues> | undefined; changed: boolean } {
  if (!values) return { values, changed: false };
  let changed = false;
  const next: Record<string, AssetTypeValues> = {};
  for (const [id, v] of Object.entries(values)) {
    const raw = v as AssetTypeValues & Partial<Record<(typeof LEGACY_PRICE_KEYS)[number], number>>;
    if (!LEGACY_PRICE_KEYS.some((k) => k in raw)) { next[id] = v; continue; }
    changed = true;
    const { salePricePerUnit, adrPerKeyNight, salePricePerSqm, leaseRatePerSqmYear, ...rest } = raw;
    const unit = rest.pricePerUnit ?? salePricePerUnit ?? adrPerKeyNight;
    const sqm = rest.pricePerSqm ?? salePricePerSqm ?? leaseRatePerSqmYear;
    next[id] = { ...rest, ...(unit !== undefined ? { pricePerUnit: unit } : {}), ...(sqm !== undefined ? { pricePerSqm: sqm } : {}) };
  }
  return changed ? { values: next, changed } : { values, changed: false };
}

/**
 * THE WAY BACK (2026-09-15, founder: "once a row is typed there is no way back,
 * so a mistyped price detaches that row from its type permanently"). What the
 * row's type would price it at, for the "Use type price" control on Table 5.
 * Null where the settle would leave the row alone (Support, a companion mirror,
 * no asset or type) or where the type states no price for the row, so the
 * control never offers to price a row at nothing.
 */
export interface TypePriceDefault {
  typeId: string;
  label: string;
  prices: Partial<Record<'pricePerUnit' | 'pricePerSqm', number>>;
  columns: { unit: string | null; sqm: string | null };
}

export function typePriceDefaultFor(
  u: SubUnit,
  asset: Asset | undefined,
  assetTypes: readonly AssetTypeStandard[],
  values: Record<string, AssetTypeValues> | undefined,
): TypePriceDefault | null {
  if (!asset || u.category === 'Support' || u.parentSubUnitId !== undefined) return null;
  const typeId = standardTypeIdFor(asset, assetTypes);
  if (typeId === undefined) return null;
  const v = values?.[typeId];
  const prices = typePricesFor(u.category, v);
  if (!Object.values(prices).some((p) => (p ?? 0) > 0)) return null;
  return { typeId, label: assetTypes.find((t) => t.id === typeId)?.label ?? typeId, prices, columns: typePriceColumns(v?.strategy) };
}

/** "ADR per key night 850", for the control's title, in the type's own units. */
export function describeTypePrices(def: TypePriceDefault): string {
  const parts: string[] = [];
  if ((def.prices.pricePerUnit ?? 0) > 0) parts.push(`${def.columns.unit ?? 'per unit'} ${def.prices.pricePerUnit!.toLocaleString()}`);
  if ((def.prices.pricePerSqm ?? 0) > 0) parts.push(`${def.columns.sqm ?? 'per sqm'} ${def.prices.pricePerSqm!.toLocaleString()}`);
  return parts.join(', ');
}
