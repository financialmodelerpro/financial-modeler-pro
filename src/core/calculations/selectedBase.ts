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

import {
  assetStrategySells,
  SELLING_ONLY_BASE_IDS,
  type AssetStrategy,
  type CostAssetScope,
  type CostLine,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { resolveCatalogId } from '@/src/hubs/modeling/platforms/refm/lib/state/costCatalog';

/**
 * WHICH ASSETS A COST LINE APPLIES TO. The ONE implementation (2026-08-19).
 *
 * Precedence, and it is the same shape `deriveCostStage` uses:
 *
 *   1. the user's own `assetScopeOverride`, which outranks everything
 *   2. the line's CATALOG IDENTITY, when that identity is a selling cost
 *   3. 'all'
 *
 * STEP 2 READS `resolveCatalogId`, WHICH IS THE POINT. The first version of
 * this resolved identity from `deriveLineBaseId(line.id)` alone, which is a
 * SECOND identity rule, and it disagreed with the shared one on exactly the
 * shape a real project produces: a line added from the catalog picker gets a
 * minted id like `custom-1787123860417__phase_1` and carries its identity in
 * `catalogId`. Its base id is `custom-1787123860417`, which matches no selling
 * id, so the scope resolved to 'all' and a Marketing line kept charging a leased
 * asset (measured live: 119,700 on Podium Retail) while the seeded
 * `commission__phase_2` on the same project was correctly scoped. One rule
 * written twice with two answers, which is the defect class this repo keeps
 * meeting; there is now one implementation and every caller reads it.
 *
 * Lives HERE rather than in `calculations/index.ts` because the visibility
 * filter below needs it and `index.ts` imports this module, so putting it there
 * would need a private copy of the precedence, which is what went wrong.
 * `index.ts` re-exports it, so existing callers are unchanged.
 */
export function deriveAssetScope(line: CostLine): CostAssetScope {
  if (line.assetScopeOverride) return line.assetScopeOverride;
  const identity = resolveCatalogId(line);
  if (identity !== undefined && SELLING_ONLY_BASE_IDS.has(identity)) return 'selling';
  return 'all';
}

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
 *
 * 2026-08-17c: THE COUNTRY GATE IS GONE, and with it the `country` parameter.
 * A line could be present but invisible, and that produced two silent money
 * defects in one week (a hidden row charging, then a hidden row appearing and
 * doubling a cost). Visibility no longer depends on any project attribute:
 * every line in the phase that is not targeted at another asset is shown, and
 * shown is charged. `retireCountryGatedLines` clears the flag from saved
 * snapshots on load.
 *
 * 2026-08-19: A SELLING COST APPLIES ONLY TO AN ASSET THAT SELLS. `strategy`
 * is the fourth argument and is OPTIONAL, because two callers legitimately ask
 * about the phase rather than about one asset (the copy planner's target list
 * and the phase-level reconciliation): omitting it keeps every line, which is
 * the pre-existing behaviour and the right answer for a phase-level question.
 *
 * Note this is NOT a gate of the kind 7.19 warns about. A gate hides a row from
 * the screen while the engine charges it; this is the same single rule the
 * engine charges from, so an asset that cannot see a marketing line is not
 * charged for one, and the Costs tab says why the row is absent.
 */
export function assetVisibleLines(
  lines: CostLine[],
  phaseId: string,
  assetId: string | undefined,
  strategy?: AssetStrategy,
): CostLine[] {
  const sells = strategy === undefined ? true : assetStrategySells(strategy);
  return lines.filter((c) =>
    c.phaseId === phaseId
    && (c.targetAssetId === undefined || c.targetAssetId === assetId)
    && (sells || lineAppliesToNonSellingAsset(c)));
}

/**
 * Whether a line applies to an asset that does NOT sell. One line, delegating
 * to `deriveAssetScope` above, so there is no second copy of the precedence to
 * drift. An earlier version spelled the precedence out here to avoid an import
 * cycle that does not exist, and the two copies promptly disagreed.
 */
function lineAppliesToNonSellingAsset(line: CostLine): boolean {
  return deriveAssetScope(line) === 'all';
}

/**
 * The lines a given line may charge on: everything strictly above it, in
 * display order. Returns [] when the line is not in the list (a stale id, or a
 * line targeted at another asset), which is the safe answer: charge on nothing
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
