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

/** The stored price field a row's metric makes active. */
export function activePriceKey(u: SubUnit, asset: Asset | undefined): PriceBasis {
  return resolveSubUnitMetric(u, asset) === 'units' ? 'pricePerUnit' : 'pricePerSqm';
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
