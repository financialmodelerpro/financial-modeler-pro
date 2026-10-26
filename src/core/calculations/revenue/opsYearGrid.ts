/**
 * OPERATING GRIDS ARE KEYED BY OPERATING YEAR (2026-10-26, founder).
 *
 * A grid that applies while a line operates (a hotel or lease line's occupancy
 * ramp, a Sell line's sales during operation) is stored by OPERATING YEAR:
 * entry 0 is the first year the line operates. Before this, those grids were
 * stored by year of the phase, so adding a construction year opened the hotel
 * on the ramp's second value and left its new last year at 0 (measured on the
 * live project: Phase 2 construction 3 to 4 years, the 45% first year lost).
 *
 * Pre-sales stay keyed by year of the phase, which is the CONSTRUCTION year
 * (construction starts with the phase), and once a row is keyed by operating
 * year its pre-sales apply in construction years only, so the two grids meet
 * at the handover whatever the construction length.
 *
 * These functions turn an operating-year grid into the phase-year array the
 * engine and every screen already read, at the phase's construction length as
 * it stands. That is the ONE place the conversion happens; nothing else
 * offsets an operating-year grid. Zero imports.
 */

/** Place an operating-year grid on the years of the phase (index 0 = the phase's first year). */
export function opsGridToPhaseLocal(byOps: readonly number[], firstOpsLocal: number): number[] {
  const start = Math.max(0, Math.floor(firstOpsLocal));
  const out = new Array<number>(start + byOps.length).fill(0);
  for (let k = 0; k < byOps.length; k++) out[start + k] = byOps[k] ?? 0;
  return out;
}

/** Read an operating-year grid back out of a phase-year array (the inverse, for a screen's write). */
export function phaseLocalToOpsGrid(phaseLocal: readonly number[] | undefined, firstOpsLocal: number, length: number): number[] {
  const start = Math.max(0, Math.floor(firstOpsLocal));
  const out = new Array<number>(Math.max(0, length)).fill(0);
  for (let k = 0; k < out.length; k++) out[k] = phaseLocal?.[start + k] ?? 0;
  return out;
}

/**
 * The year of the phase (0-based) a SELL line's sales during operation start in:
 * the year after its construction, less any legacy overlap. The Revenue tab's
 * velocity window has always used this rule.
 */
export function sellFirstOpsLocal(constructionPeriods: number, overlapPeriods = 0): number {
  return Math.max(0, Math.max(0, constructionPeriods) - Math.max(0, overlapPeriods));
}

/**
 * A Sell row's pace as years of the phase, at the construction length in force.
 * A row keyed by operating year (`postOps` present) places its sales during
 * operation after the construction years and keeps its pre-sales to them; a row
 * still keyed by year of the phase is returned exactly as stored.
 */
export function sellPaceByPhase(
  stored: { pre?: number[]; post?: number[]; postOps?: number[]; preLegacy?: number[]; postLegacy?: number[] },
  constructionPeriods: number,
  overlapPeriods = 0,
): { pre: number[] | undefined; post: number[] | undefined; preLegacy?: number[]; postLegacy?: number[] } {
  if (stored.postOps === undefined) return { pre: stored.pre, post: stored.post, preLegacy: stored.preLegacy, postLegacy: stored.postLegacy };
  const cp = Math.max(0, constructionPeriods);
  const pre = new Array<number>(cp).fill(0);
  for (let i = 0; i < cp; i++) pre[i] = stored.pre?.[i] ?? 0;
  return { pre, post: opsGridToPhaseLocal(stored.postOps, sellFirstOpsLocal(cp, overlapPeriods)), preLegacy: undefined, postLegacy: undefined };
}
