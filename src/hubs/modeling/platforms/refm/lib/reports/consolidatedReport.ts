/**
 * consolidatedReport.ts (2026-09-08, consolidation step 2)
 *
 * THE CONSOLIDATED VIEW: what the schedules would look like grouped by
 * (phase, type, strategy) instead of one row per asset.
 *
 * A VIEW, NOT AN ENTITY. Every figure here is a SUM of figures the platform
 * already computed for each asset. Nothing is stored, nothing is keyed on a
 * group id, and no calculation reads this file: it is a presentation layer over
 * the existing snapshot, exactly like `streamReports.ts` and `checksReport.ts`.
 * That is deliberate and it is the whole safety argument for shipping it early.
 * `byAssetCostOfSales` stays keyed by asset id and is read by Modules 4 and 5,
 * both PDFs and the workbook; making consolidation the engine's key would be a
 * five-surface change, and this codebase has already paid once for a second
 * cost-of-sales engine that diverged by 407m in a single year.
 *
 * THE TOTAL IS THE POINT. A consolidated table whose total differs from the
 * per-asset total is worse than no table, because both are on screen and the
 * reader has no way to tell which is wrong. `consolidatedTotals` is a plain sum
 * of the same rows the per-asset table shows, and `verify-consolidated-view`
 * asserts the two agree to the cent on every live project.
 *
 * No em dashes in this file.
 */

import {
  UNTYPED_LABEL,
  type ConsolidatableAsset,
} from '@/src/core/calculations/consolidation';
import { planCapexSummaryLines, type CapexInputAsset, type CapexPlannableAsset } from './capexReports';

/**
 * What this view needs to know about one asset's cost. Minimal on purpose: the
 * Costs tab and the export builders each already hold a per-asset total, and
 * this takes whichever they have rather than making either recompute.
 */
export interface PerAssetCost {
  assetId: string;
  land: number;
  hard: number;
  soft: number;
  marketing: number;
  operating: number;
  total: number;
}

/** Adapter for the shared capex report, so the exports feed the same builder. */
export function perAssetCostsFromCapexReport(rows: readonly CapexInputAsset[]): PerAssetCost[] {
  return rows.map((c) => ({
    assetId: c.assetId,
    land: c.subtotals.land,
    hard: c.subtotals.hard,
    soft: c.subtotals.soft,
    marketing: c.subtotals.marketing,
    operating: c.subtotals.operating,
    total: c.subtotals.total,
  }));
}

export interface ConsolidatedRow {
  key: string;
  phaseId: string;
  phaseName: string;
  /** The type as the user wrote it, or the untyped label. */
  typeLabel: string;
  strategy: string;
  /** False when this row stands for one unclassified asset. */
  typed: boolean;
  /** How many assets rolled into this row. 1 means the row is a relabelling. */
  assetCount: number;
  /** The names of those assets, so a merged row can still say what is in it. */
  assetNames: string[];

  land: number;
  hard: number;
  soft: number;
  marketing: number;
  operating: number;
  total: number;
}

export interface ConsolidatedReport {
  rows: ConsolidatedRow[];
  /** Rows that actually merge more than one asset. */
  mergedRows: ConsolidatedRow[];
  totals: { land: number; hard: number; soft: number; marketing: number; operating: number; total: number };
  /** The per-asset totals this view must reproduce, carried so a surface can
   *  show the reconciliation rather than asserting it silently. */
  perAssetTotal: number;
  /** perAssetTotal less the consolidated total. Zero, or the view is wrong. */
  difference: number;
  /** True when every row holds exactly one asset, so the view changes nothing. */
  isRelabellingOnly: boolean;
}

interface AssetLike extends ConsolidatableAsset {
  name: string;
}

const ZERO = { land: 0, hard: 0, soft: 0, marketing: 0, operating: 0, total: 0 };

/**
 * Build the consolidated view from the assets and the per-asset capex rows the
 * existing report already produced.
 *
 * The capex rows are passed IN rather than recomputed. Recomputing would make
 * this a second opinion on the same question, and the one thing this view must
 * never be is a second opinion.
 */
export function buildConsolidatedReport(
  assets: readonly AssetLike[],
  phases: readonly { id: string; name: string }[],
  capexByAsset: readonly PerAssetCost[],
  // THE NORMALISER IS NO LONGER INJECTED (2026-09-12). It was, so that type
  // identity had one implementation and this file did not read as an engine
  // file consulting the asset type standards. The rows come from
  // `planCapexSummaryLines` now, which owns that call, so passing one here
  // would be a parameter nothing uses.
): ConsolidatedReport {
  const capex = new Map(capexByAsset.map((c) => [c.assetId, c] as const));
  /**
   * A COMPANION IS A ROW, NOT A GAP (2026-09-12).
   *
   * This walked `groupAssetsForConsolidation` directly, which excludes
   * companions BY DESIGN because a line holds one strategy. That was correct
   * and harmless while a companion cost nothing: the engine short-circuited
   * it to zero and the totals still tied. Consolidation step 6 (5ad4518e,
   * 2026-09-10) narrowed the short-circuit to the OPERATE companion alone, so
   * the retail strips began carrying real capex that no row could hold, and
   * this view has not tied since. Measured on FMP - MARINA GATE the day it
   * broke and again today: the gap is the two strips, to the cent.
   *
   *   Phase 1, Branded Villas (Retail)   31,143,760.84
   *   Phase 2, Branded Villas (Retail)   18,999,105.98
   *                                      -------------
   *                                      50,142,866.82   = the gap
   *
   * The rows come from `planCapexSummaryLines` now, the SAME planner the four
   * capex tables and both exports order their rows by, so a companion sits
   * beside the line it carves from and this view cannot disagree with them
   * about what a row is. Its own reconciliation is what caught this, and it
   * is kept: a view that can tell you it does not tie is worth more than one
   * that cannot.
   */
  const rows: ConsolidatedRow[] = planCapexSummaryLines(
    assets as unknown as CapexPlannableAsset[],
    phases,
    (id) => assets.find((a) => a.id === id)?.name ?? id,
  ).map((ln) => {
    const sums = { ...ZERO };
    for (const id of ln.assetIds) {
      const c = capex.get(id);
      if (!c) continue;
      sums.land += c.land;
      sums.hard += c.hard;
      sums.soft += c.soft;
      sums.marketing += c.marketing;
      sums.operating += c.operating;
      sums.total += c.total;
    }
    return {
      key: ln.key,
      phaseId: ln.phaseId,
      phaseName: ln.phaseName,
      typeLabel: ln.typed ? ln.label : UNTYPED_LABEL,
      strategy: ln.strategy,
      typed: ln.typed,
      assetCount: ln.assetIds.length,
      assetNames: ln.assetIds.map((id) => assets.find((a) => a.id === id)?.name ?? id),
      ...sums,
    };
  });
  const totals = rows.reduce((acc, r) => ({
    land: acc.land + r.land,
    hard: acc.hard + r.hard,
    soft: acc.soft + r.soft,
    marketing: acc.marketing + r.marketing,
    operating: acc.operating + r.operating,
    total: acc.total + r.total,
  }), { ...ZERO });

  // THE RECONCILIATION, computed from the SOURCE rows rather than from the
  // groups, so a grouping bug cannot make both sides agree on a wrong number.
  const perAssetTotal = capexByAsset.reduce((s, c) => s + c.total, 0);

  return {
    rows,
    mergedRows: rows.filter((r) => r.assetCount > 1),
    totals,
    perAssetTotal,
    difference: perAssetTotal - totals.total,
    isRelabellingOnly: rows.every((r) => r.assetCount === 1),
  };
}
