/**
 * selectedBase.ts (2026-08-15)
 *
 * Which cost lines may compose a `percent_of_selected` base.
 *
 * THE RULE IS POSITIONAL: a line may charge on any line ABOVE it on the same
 * asset, and on nothing else. Not on itself, and not on anything below.
 *
 * WHY POSITIONAL RATHER THAN BY METHOD. The picker used to exclude every
 * `percent_of_selected` line outright, commented "we don't allow recursive
 * references". That banned a whole method to prevent a cycle, and the cost was
 * the ordinary chain a development budget is built from: a developers fee
 * charged on hard cost plus the soft costs above it, and then a contingency
 * charged on everything including the developers fee. Both are
 * `percent_of_selected`, so the chain could not be expressed at all. It also
 * blocked the STANDARD catalog from putting professional fee inside
 * contingency's base.
 *
 * Ordering gives the same guarantee for free. If every reference points
 * strictly upward, a cycle is unrepresentable: there is no sequence of upward
 * steps that returns to where it started. So the rule buys back the whole
 * feature and loses nothing.
 *
 * WHY THIS IS SHARED WITH THE ENGINE. The engine resolves
 * `percent_of_selected` in ONE FORWARD PASS, reading each line's total out of a
 * map that is filled as it goes. That made position load-bearing already, but
 * only by accident and with no guard: a selection pointing DOWNWARD read an
 * absent entry and contributed ZERO, silently. Measured before this fix, on a
 * chain of construction 1000 / dev fee 10% / contingency 5%:
 *
 *   dev fee ABOVE contingency  ->  contingency 55.00   (correct)
 *   dev fee BELOW contingency  ->  contingency 50.00   (dev fee counted as 0)
 *
 * and a two-line cycle produced 500 and 750, numbers that are artefacts of
 * array position rather than anything the user asked for. Enforcing the rule in
 * the engine turns "happens to read zero" into "is defined to be excluded", and
 * makes the picker's list and the maths the same rule rather than two rules
 * that agree today.
 *
 * ORDER IS ARRAY ORDER. The Capex table renders `costLines` filtered, never
 * sorted, so the order on screen is the order in the array is the order the
 * engine iterates. "Above" therefore means "earlier in this list".
 *
 * KNOWN GAP, recorded here because the cascade otherwise composes exactly.
 * A reference budget totals "construction cost excluding land" as hard cost
 * plus engineering, design, permits, developer fee and contingency, with SALES
 * MARKETING deliberately outside that total even though it sits INSIDE the
 * developer fee and contingency bases. The bases are expressible (they are just
 * selections), but the TOTAL is not: every subtotal the platform reports is
 * either the asset total or a STAGE subtotal, and sales marketing is a soft
 * cost, so it falls inside "development cost (excl. land)". There is no
 * user-defined subtotal that can leave a named line out. Pinned by
 * `verify-selected-base` section E.
 *
 * Pure. No em dashes in this file.
 */

import type { CostLine } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

/**
 * The lines visible to one asset within its phase, in display order. Mirrors
 * the Capex table's own filter so "above" means the same thing in both.
 *
 * 2026-08-17: THIS IS ALSO THE SET THE ENGINE CHARGES. `computeAssetCost` used
 * to build its own list filtering on phase and target asset only, so a
 * country-gated line was charged while being invisible in the inputs, which
 * double-charged a transfer tax on a live project. One rule, one answer.
 *
 * `assetId` accepts undefined for "the phase's project-wide lines only", which
 * is what a phase-level reconciliation needs: a line targeted at some other
 * asset is not part of the phase's shared set.
 */
export function assetVisibleLines(
  lines: CostLine[],
  phaseId: string,
  assetId: string | undefined,
  country?: string,
): CostLine[] {
  return lines.filter((c) =>
    c.phaseId === phaseId
    && (c.targetAssetId === undefined || c.targetAssetId === assetId)
    && (!c.requiresCountry || c.requiresCountry === country));
}

/**
 * The lines a given line may charge on: everything strictly above it, in
 * display order. Returns [] when the line is not in the list (a stale id, or a
 * line filtered out by country), which is the safe answer: charge on nothing
 * rather than on an arbitrary set.
 */
export function eligibleBaseLines(
  visible: CostLine[],
  lineId: string,
): CostLine[] {
  const idx = visible.findIndex((c) => c.id === lineId);
  if (idx <= 0) return [];
  return visible.slice(0, idx);
}

/**
 * Filter a stored `selectedLineIds` down to the ones the rule actually allows.
 *
 * This is what the engine applies, and it is why a legacy selection pointing at
 * a line below cannot quietly contribute: it is dropped by rule, at the same
 * value (zero) it was already contributing by accident, so no existing model
 * moves. What changes is that the exclusion is now deliberate and testable.
 */
export function allowedSelectedIds(
  visible: CostLine[],
  lineId: string,
  selectedLineIds: readonly string[] | undefined,
): string[] {
  if (!selectedLineIds?.length) return [];
  const allowed = new Set(eligibleBaseLines(visible, lineId).map((c) => c.id));
  return selectedLineIds.filter((id) => allowed.has(id));
}
