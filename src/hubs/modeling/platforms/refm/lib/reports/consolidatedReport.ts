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
  groupAssetsForConsolidation,
  UNTYPED_LABEL,
  type ConsolidatableAsset,
  type NormaliseTypeId,
} from '@/src/core/calculations/consolidation';
import type { CapexInputAsset } from './capexReports';

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
  // INJECTED, like the grouping key's own normaliser and for the same two
  // reasons: there is ONE implementation of type identity and it lives in the
  // platform, and importing it here would make this file read as an engine file
  // that consults the asset type standards, which it does not.
  normaliseTypeId: NormaliseTypeId,
): ConsolidatedReport {
  const phaseName = new Map(phases.map((p) => [p.id, p.name] as const));
  const capex = new Map(capexByAsset.map((c) => [c.assetId, c] as const));
  const groups = groupAssetsForConsolidation(assets, phases.map((p) => p.id), normaliseTypeId);

  const rows: ConsolidatedRow[] = groups.map((g) => {
    const sums = { ...ZERO };
    for (const a of g.assets) {
      const c = capex.get(a.id);
      if (!c) continue;
      sums.land += c.land;
      sums.hard += c.hard;
      sums.soft += c.soft;
      sums.marketing += c.marketing;
      sums.operating += c.operating;
      sums.total += c.total;
    }
    return {
      key: g.key,
      phaseId: g.phaseId,
      phaseName: phaseName.get(g.phaseId) ?? g.phaseId,
      typeLabel: g.typed ? g.typeLabel : UNTYPED_LABEL,
      strategy: g.strategy,
      typed: g.typed,
      assetCount: g.assets.length,
      // The grouping key's asset shape has an optional name; the callers here
      // pass real assets, which always have one.
      assetNames: g.assets.map((a) => a.name ?? ''),
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
