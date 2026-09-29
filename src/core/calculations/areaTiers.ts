/**
 * THE AREA TIERS IN THE WORDS A SURFACE PRINTS (2026-09-29).
 *
 * `resolveAssetAreaMetrics` keeps the platform's historical field names, which
 * swap the two outer tiers against the industry words the Assets tab uses:
 *
 *   platform `nsa` = NSA            (the sub-units, what is sold or let)
 *   platform `bua` = Total GFA      (NSA + support, parking EXCLUDED)
 *   platform `gfa` = Total BUA      (Total GFA + parking, everything built)
 *
 * so NSA sits inside Total GFA, which sits inside Total BUA. A surface that
 * printed `m.gfa` under the word "GFA" showed the Summary's Total GFA and BUA
 * the wrong way round, and a plot ratio of BUA over land (2.86 on the live
 * project, where GFA over land is 2.42). Every surface that PRINTS a tier
 * reads it through this one function, so the word and the sum cannot part
 * again; the engine keeps its field names, which are read by name nowhere a
 * user sees them.
 *
 * Pure, zero imports.
 */
export interface AreaTiers {
  /** Net saleable (or lettable) area. */
  nsaSqm: number;
  /** Total GFA: NSA + support, parking excluded (platform `bua`). */
  totalGfaSqm: number;
  /** Total BUA: Total GFA + parking, everything built (platform `gfa`). */
  totalBuaSqm: number;
}

export function areaTiers(m: { nsa: number; bua: number; gfa: number }): AreaTiers {
  return { nsaSqm: m.nsa, totalGfaSqm: m.bua, totalBuaSqm: m.gfa };
}

/** The plot ratio: Total GFA over land. Null where there is no land. */
export function plotRatio(totalGfaSqm: number, landSqm: number): number | null {
  return landSqm > 0 ? totalGfaSqm / landSqm : null;
}
