import type { FinancingTranche } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

/**
 * Auto-normalise facility shares so they sum to exactly 100.
 *
 *   - No tranches: empty map.
 *   - Any tranche missing facilitySharePct: equal-split fallback
 *     (every facility gets 100 / count).
 *   - Sum > 0 but != 100: rescale proportionally.
 *   - Sum = 0 (every share zeroed): equal-split fallback.
 */
export function normaliseFacilityShares(tranches: FinancingTranche[]): Map<string, number> {
  const out = new Map<string, number>();
  const n = tranches.length;
  if (n === 0) return out;
  const anyMissing = tranches.some((t) => typeof t.facilitySharePct !== 'number');
  if (anyMissing) {
    const eq = 100 / n;
    for (const t of tranches) out.set(t.id, eq);
    return out;
  }
  let total = 0;
  for (const t of tranches) total += Math.max(0, t.facilitySharePct ?? 0);
  if (total <= 0) {
    const eq = 100 / n;
    for (const t of tranches) out.set(t.id, eq);
    return out;
  }
  for (const t of tranches) {
    out.set(t.id, (Math.max(0, t.facilitySharePct ?? 0) / total) * 100);
  }
  return out;
}
