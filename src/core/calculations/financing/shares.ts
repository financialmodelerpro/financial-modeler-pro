import type { FinancingTranche } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

/**
 * Resolve each NEW facility's share of the project debt requirement.
 *
 * A SHARE IS USED EXACTLY AS TYPED (2026-08-17). This function used to
 * RESCALE: any set of shares whose sum was not 100 was divided through by that
 * sum. Typing 100 into the first of two facilities while the second still said
 * 50 produced 66.67 and 33.33, so the number on the screen was not the number
 * in the model, there was no way to make one facility carry the whole
 * requirement, and the rescale happened silently on every recompute.
 *
 * Silent scaling is the worst of both worlds: it cannot be seen, it cannot be
 * overridden, and it turns a user's arithmetic mistake into a model that
 * quietly disagrees with its own inputs. So the shares are now verbatim and a
 * sum that is not 100 is REPORTED: `reconcile` already carried the check
 * (`Facility shares sum N (expected 100)`), which could never fire while this
 * function guaranteed 100, and the Financing tab states it beside the
 * facilities.
 *
 * TWO THINGS THAT ARE NOT SILENT SCALING, and stay:
 *
 *   - EXISTING facilities (origin === 'existing') are excluded entirely. Their
 *     drawdown is zero and `totalDrawn = openingBalance` regardless of share,
 *     so they are not part of this split at all.
 *   - When NO new facility carries a share, they split equally. Nothing was
 *     typed, so nothing is being overridden, and some answer is needed.
 *
 * A share that is absent while another is typed resolves to ZERO rather than to
 * an equal split. The old code did the opposite: one missing share discarded
 * every typed one and equal-split the lot, which is a louder version of the
 * same defect. (In practice a missing share is rare: the hydrate migration
 * backfills `facilitySharePct` on every multi-facility snapshot.)
 *
 * Pure. No em dashes in this file.
 */
export function resolveFacilityShares(tranches: FinancingTranche[]): Map<string, number> {
  const out = new Map<string, number>();
  const newOnes = tranches.filter((t) => t.origin !== 'existing');
  if (newOnes.length === 0) return out;

  const anyTyped = newOnes.some((t) => typeof t.facilitySharePct === 'number');
  if (!anyTyped) {
    const eq = 100 / newOnes.length;
    for (const t of newOnes) out.set(t.id, eq);
    return out;
  }

  // Verbatim, floored at zero. A negative share is not a share.
  for (const t of newOnes) out.set(t.id, Math.max(0, t.facilitySharePct ?? 0));
  return out;
}

/** What the shares add up to, and whether that is the 100 the model needs.
 *  Shared so the tab and any check say the same thing. */
export function facilityShareTotal(shares: Map<string, number>): number {
  let total = 0;
  for (const v of shares.values()) total += v;
  return total;
}

export function facilityShareSumIsValid(shares: Map<string, number>): boolean {
  if (shares.size === 0) return true;
  return Math.abs(facilityShareTotal(shares) - 100) < 0.01;
}
