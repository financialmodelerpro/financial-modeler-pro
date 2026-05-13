import type { FinancingTranche } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

/**
 * Auto-normalise NEW facility shares so they sum to exactly 100.
 *
 * Existing facilities (origin === 'existing') are excluded; their
 * drawdown is zero and `totalDrawn = openingBalance` independent of
 * share. The map only contains entries for new facilities.
 *
 *   - No new tranches: empty map.
 *   - Any new tranche missing facilitySharePct: equal-split fallback
 *     (every new facility gets 100 / count).
 *   - Sum > 0 but != 100: rescale proportionally.
 *   - Sum = 0 (every share zeroed): equal-split fallback.
 */
export function normaliseFacilityShares(tranches: FinancingTranche[]): Map<string, number> {
  const out = new Map<string, number>();
  const newOnes = tranches.filter((t) => t.origin !== 'existing');
  const n = newOnes.length;
  if (n === 0) return out;
  const anyMissing = newOnes.some((t) => typeof t.facilitySharePct !== 'number');
  if (anyMissing) {
    const eq = 100 / n;
    for (const t of newOnes) out.set(t.id, eq);
    return out;
  }
  let total = 0;
  for (const t of newOnes) total += Math.max(0, t.facilitySharePct ?? 0);
  if (total <= 0) {
    const eq = 100 / n;
    for (const t of newOnes) out.set(t.id, eq);
    return out;
  }
  for (const t of newOnes) {
    out.set(t.id, (Math.max(0, t.facilitySharePct ?? 0) / total) * 100);
  }
  return out;
}
