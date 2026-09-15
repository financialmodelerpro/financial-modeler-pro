/**
 * subUnitPriceDefaults.ts (2026-09-15)
 *
 * A TYPE STATES ITS PRICES, AND A TABLE 5 ROW WITH NO PRICE OF ITS OWN TAKES
 * THEM (founder: "if our asset doesn't have multiple sub-units table 5 will get
 * these prices and the user can override there"). Types and Standards carries a
 * sale price per unit, a sale price per sqm, an ADR and a lease rate per asset
 * type (`AssetTypeValues`); this is the one rule that puts them on the rows.
 *
 *   - `SubUnit.priceStated` says whether the row's price is the user's. Typing
 *     a price on Table 5 sets it; on load a row with no marker counts as stated
 *     when it carries any positive price, so every priced row keeps its price.
 *   - An UNSTATED row follows its type by category: a Sellable row takes both
 *     sale prices, an Operable row the ADR (its price per unit), a Leasable row
 *     the lease rate (its price per sqm). A blank type price is 0.
 *   - Support rows are never priced, and a companion mirror row (priced by its
 *     own ADR, rebuilt from its parent on every edit) is left alone.
 *
 * `settleSubUnitPrices` then makes `unitPrice` the active basis's price, so run
 * this BEFORE it. Both settle: the input array comes back when nothing moves.
 * No em dashes in this file.
 */

import type { Asset, SubUnit } from './module1-types';
import type { AssetTypeStandard, AssetTypeValues } from './assetTypeStandards';
import { standardTypeIdFor } from './costStandards';

const positive = (n: number | undefined): boolean => typeof n === 'number' && n > 0;

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

/** The prices a type states for a row of this category, keyed by the row's own fields. */
export function typePricesFor(
  category: SubUnit['category'],
  v: AssetTypeValues | undefined,
): Partial<Record<'pricePerUnit' | 'pricePerSqm', number>> {
  if (category === 'Sellable') return { pricePerUnit: v?.salePricePerUnit ?? 0, pricePerSqm: v?.salePricePerSqm ?? 0 };
  if (category === 'Operable') return { pricePerUnit: v?.adrPerKeyNight ?? 0 };
  if (category === 'Leasable') return { pricePerSqm: v?.leaseRatePerSqmYear ?? 0 };
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
