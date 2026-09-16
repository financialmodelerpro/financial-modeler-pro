/**
 * costEscalation.ts (2026-09-16, step 10b)
 *
 * CONSTRUCTION COST ESCALATION: ONE PROJECT RATE, AND EVERY RATE IS BASE-YEAR MONEY.
 *
 * A rate typed anywhere (a Standards default, a Capex phase line, a per-asset
 * override) is money of the PROJECT START YEAR. Escalation prices it into the
 * years the line actually spends: a line spending in project year 3 at 4% a year
 * costs 1.04^3 of what its rate says.
 *
 * WHAT ESCALATES, and what does not:
 *   escalates   every rate line (rate per sqm, per unit, per bay, the area and
 *               chain bases), whatever set the rate: the rate is base-year money
 *   never       a `fixed` lump sum, because a stated amount is already an amount
 *   never       the land VALUE lines, and anything charged on land: a parcel's
 *               price is what the deal says, not a rate that inflates
 *   never       a line charged on revenue (a selling cost), because revenue
 *               carries its own indexation and this would escalate it twice
 *   once        a percentage line (soft costs, contingency, developer fee)
 *               charges on the ESCALATED base and is not escalated again
 *
 * THE TIMING IS THE LINE'S OWN SPEND PROFILE, which means escalation and phasing
 * interact BY DESIGN (founder, 2026-09-16): moving a line's spend later raises
 * its cost at an unchanged rate, because a later payment is a larger payment.
 * The alternative (escalating every line at its phase start) would price a 2033
 * payment in 2029 money, so it was not taken.
 *
 * Pure, no imports. No em dashes in this file.
 */

/** Methods whose amount is stated rather than rated: a lump sum never escalates. */
const STATED_AMOUNT_METHODS = new Set<string>(['fixed']);

/** Charged on land or on revenue: escalating these would inflate a deal price or
 *  double-index revenue. */
const EXEMPT_BASE_METHODS = new Set<string>([
  'percent_of_total_land', 'percent_of_cash_land', 'percent_of_inkind_land',
  'percent_of_revenue_sale', 'percent_of_revenue_rent', 'percent_of_revenue',
]);

/** A percentage line inherits its base's escalation, so it is not escalated itself. */
const INHERITS_FROM_BASE_METHODS = new Set<string>(['percent_of_selected', 'percent_of_construction']);

export interface EscalationInput {
  /** The method the line is priced on. */
  method: string;
  /** True for the two standard land VALUE lines (isLandValueLine). */
  isLandValue: boolean;
}

/** Whether this line's own total escalates. */
export function lineEscalates(line: EscalationInput): boolean {
  if (line.isLandValue) return false;
  if (STATED_AMOUNT_METHODS.has(line.method)) return false;
  if (EXEMPT_BASE_METHODS.has(line.method)) return false;
  if (INHERITS_FROM_BASE_METHODS.has(line.method)) return false;
  return true;
}

/** The factor for money spent in project period `projIdx`, at `ratePct` a year
 *  (a whole percent: 4 means 4%). Period 0 is the base year, so its factor is 1. */
export function escalationFactorAt(projIdx: number, ratePct: number | undefined, periodsPerYear = 1): number {
  const r = (ratePct ?? 0) / 100;
  if (!Number.isFinite(r) || r === 0) return 1;
  const years = Math.max(0, projIdx) / Math.max(1, periodsPerYear);
  return Math.pow(1 + r, years);
}

/**
 * The one factor for a line, weighted by WHERE IT SPENDS: the sum of each
 * period's weight times that period's factor. With weights summing to 1 this is
 * the factor that turns the base-year total into the escalated total, and it
 * agrees with escalating each period on its own (which is what the schedule
 * does), so the total and the periods beside it cannot disagree.
 *
 * `projIdxOf` maps the line's own period index to the project axis, so a later
 * phase escalates further without anything here knowing about phases.
 */
export function weightedEscalation(
  weights: readonly number[],
  projIdxOf: (localIdx: number) => number,
  ratePct: number | undefined,
  periodsPerYear = 1,
): number {
  const r = (ratePct ?? 0) / 100;
  if (!Number.isFinite(r) || r === 0) return 1;
  let sum = 0;
  let total = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] ?? 0;
    if (w === 0) continue;
    total += w;
    sum += w * escalationFactorAt(projIdxOf(i), ratePct, periodsPerYear);
  }
  return total > 0 ? sum / total : 1;
}
