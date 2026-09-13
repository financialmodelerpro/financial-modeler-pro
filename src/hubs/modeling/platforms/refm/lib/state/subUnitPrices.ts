/**
 * subUnitPrices.ts (2026-09-13)
 *
 * A SUB-UNIT CARRIES BOTH PRICES, AND `unitPrice` IS WHICHEVER ITS METRIC
 * MAKES ACTIVE. See the field comment on `SubUnit.pricePerSqm` for why.
 *
 * ONE RULE, called on load, on save and on every metric switch:
 *   1. the active basis with no stated price takes `unitPrice` (a backfill,
 *      so every existing row keeps the price it had);
 *   2. `unitPrice` becomes the active basis's stated price.
 * The metric is the ASSET's where it states one (docs/TRAPS.md 7.32).
 *
 * SETTLES: the input array comes back when nothing moves, so a settled model
 * hydrates to the object it always did. No em dashes in this file.
 */

import { resolveSubUnitMetric } from '@/src/core/calculations';
import type { Asset, SubUnit } from './module1-types';

export type PriceBasis = 'pricePerSqm' | 'pricePerUnit';

/** The stored price field a row's basis makes active. ONLY A SELLABLE ROW
 *  FOLLOWS ITS METRIC: an Operable row's rate is always the ADR per room per
 *  night (`pricePerUnit`) and a Leasable row's is always per sqm per year
 *  (`pricePerSqm`), whatever the row is counted in, because that is what the
 *  hospitality and lease engines read them as (2026-09-13). */
export function activePriceKey(u: SubUnit, asset: Asset | undefined): PriceBasis {
  return priceKeyFor(u.category, resolveSubUnitMetric(u, asset));
}

/** The same rule from a category and an already-resolved metric, for a cell
 *  that has the metric in hand and no asset. */
export function priceKeyFor(category: string | undefined, metric: 'units' | 'area'): PriceBasis {
  if (category === 'Operable') return 'pricePerUnit';
  if (category === 'Leasable') return 'pricePerSqm';
  return metric === 'units' ? 'pricePerUnit' : 'pricePerSqm';
}

/** Whether a row carries TWO prices at all: only a Sellable row sells by area
 *  or by unit, so only it has an "other basis" to state. */
export function hasDualPrice(u: Pick<SubUnit, 'category'>): boolean {
  return u.category === 'Sellable';
}

/** The other one. */
export function otherPriceKey(key: PriceBasis): PriceBasis {
  return key === 'pricePerUnit' ? 'pricePerSqm' : 'pricePerUnit';
}

export function settleSubUnitPrices(
  subUnits: readonly SubUnit[],
  assets: readonly Asset[],
): { subUnits: SubUnit[]; changed: boolean; moved: Array<{ subUnitId: string; unitPrice: number }> } {
  const byId = new Map(assets.map((a) => [a.id, a] as const));
  const moved: Array<{ subUnitId: string; unitPrice: number }> = [];
  let changed = false;
  const next = subUnits.map((u) => {
    const key = activePriceKey(u, byId.get(u.assetId));
    const stated = u[key];
    const current = Math.max(0, u.unitPrice ?? 0);
    if (stated === undefined) {
      // Backfill: the row's price becomes the statement in its active basis.
      changed = true;
      return { ...u, [key]: current, unitPrice: current };
    }
    const active = Math.max(0, stated);
    if (active === current) return u;
    changed = true;
    moved.push({ subUnitId: u.id, unitPrice: active });
    return { ...u, unitPrice: active };
  });
  return changed ? { subUnits: next, changed, moved } : { subUnits: subUnits as SubUnit[], changed: false, moved };
}

/** The rows on a line that have NO price stated in the basis they are about
 *  to switch to, for the alert the switch raises. */
export function rowsWithoutPriceIn(subUnits: readonly SubUnit[], key: PriceBasis): SubUnit[] {
  return subUnits.filter((u) => !(typeof u[key] === 'number' && (u[key] as number) > 0));
}
