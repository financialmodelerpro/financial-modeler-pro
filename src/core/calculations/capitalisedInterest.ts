/**
 * WHICH ASSETS SHARE CAPITALISED INTEREST (2026-09-29). ONE rule, called by the engine
 * (`computeIdcSnapshot`) and by the live workbook's copy of the split, so the two cannot pick
 * different assets.
 *
 * Capitalised interest follows the capex it finances: each year's interest during construction
 * is shared among the assets whose construction is running that year, in proportion to their
 * land (or GFA). Every asset that carries its own capex takes its share, and that includes a
 * retail strip, which owns land carved from its hosts, carries its own capex and depreciates as
 * a held asset. The one asset left out is the OPERATE companion of a Sell + Manage asset: it
 * carries no capex (its cost stays on its parent, which takes the share), so a share for it would
 * move interest away from assets that are actually spending.
 *
 * The rule once skipped every companion. It was written when "companion" meant only the Operate
 * companion; the retail strip became a companion with real cost on 2026-09-10 and was left out of
 * the split until 2026-09-29 (4.09m on Marina Gate carried by the other five lines instead).
 *
 * Pure. Imports only the companion classifier.
 */
import { isRetailCompanion } from './retailCompanion';

export function sharesCapitalisedInterest(a: { visible?: boolean; isCompanion?: boolean; companionType?: string }): boolean {
  if (a.visible === false) return false;
  return a.isCompanion !== true || isRetailCompanion(a);
}

/** The rule in the words every surface prints beneath the allocation. */
export const CAPITALISED_INTEREST_RULE =
  'Each year\'s capitalised interest is shared among the assets whose construction is running that year, in proportion to their land (or GFA). Every asset that carries its own capex takes its share, a retail strip included. The Operate companion of a Sell + Manage asset takes none: it carries no capex, its cost sits on its parent, and the parent takes the share.';
