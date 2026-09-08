/**
 * consolidation.ts (2026-09-08, consolidation step 1)
 *
 * THE GROUPING KEY: which assets a consolidated schedule would treat as ONE
 * row. Nothing else. This file computes no money, reads no snapshot and is
 * imported by no calculation, resolver, report or export; `verify-consolidation-key`
 * fails if that changes. So it can ship before anything consolidates, and an
 * asset's numbers are byte-identical with it present.
 *
 * THE KEY IS (PHASE, TYPE, STRATEGY), AND THE PHASE IS NOT OPTIONAL.
 *
 * The reference workbook keys its roll-up on ASSET TYPE ALONE, then assumes the
 * type determines both the plan and the start year: its schedule takes
 * MINIFS(startYear) and XLOOKUP(plan) off the first matching plot. Both are
 * silent lossy collapses, and neither ever fires there because no type in any
 * of its eight clusters spans two plans or two start years.
 *
 * OUR DATA ALREADY BREAKS THAT ASSUMPTION. FMP RE HUB carries
 * "Strip Retail | Lease" in Phase 2 AND Phase 3, and "Branded Residences | Sell"
 * in Phase 2 AND Phase 3. A type-only key merges across phases and destroys the
 * phase dimension that Modules 4 and 5 depend on, so the phase is part of the
 * key and a merge can never cross one.
 *
 * THE TYPE NORMALISER IS INJECTED, not reimplemented. An asset's identity is
 * `assetTypeId` when the firm's registry has been used and the free-text `type`
 * otherwise, and the two must land in the same space or "Branded Villas" and
 * the registry entry `branded-villas` would read as two types. The platform's
 * `normaliseAssetTypeId` is the ONE implementation of that mapping, and it is
 * passed in rather than copied, which is also what keeps this file free of
 * imports.
 *
 * Pure. No imports. No em dashes in this file.
 */

/** The shape this file needs from an asset. Structural on purpose: the platform
 *  `Asset` satisfies it, and core stays free of platform imports. */
export interface ConsolidatableAsset {
  id: string;
  phaseId: string;
  strategy: string;
  /** Free-text type. May be absent or blank. */
  type?: string;
  /** Reference into the firm's asset type registry, when one was picked. */
  assetTypeId?: string;
  isCompanion?: boolean;
  visible?: boolean;
  name?: string;
}

/** Maps a free-text type label to the same id space the registry uses. */
export type NormaliseTypeId = (label: string) => string;

/** Prefix marking a key that stands for ONE untyped asset rather than a type. */
export const UNTYPED_KEY_PREFIX = 'untyped:';

export const UNTYPED_LABEL = '(no type)';

export interface ConsolidationKeyParts {
  phaseId: string;
  /** The type's identity, or `untyped:<assetId>` when it has none. */
  typeKey: string;
  strategy: string;
  /** False when this asset carries no type and therefore consolidates alone. */
  typed: boolean;
}

/**
 * AN UNTYPED ASSET CONSOLIDATES WITH NOTHING, INCLUDING OTHER UNTYPED ASSETS.
 *
 * Its key is seeded with its own id, so it forms a group of one.
 *
 * Consolidation is a MERGE, and the two ways of being wrong are not equal. A
 * wrong merge silently combines two schedules that should be separate and the
 * numbers stop being attributable; a missed merge leaves one extra row on
 * screen. Pooling every untyped asset into a single "(no type)" bucket would
 * put a hotel and a retail strip in one row for no reason other than that
 * neither has been classified yet, which is the wrong failure to choose.
 *
 * It also keeps the surface honest for exactly the rows a user is mid-way
 * through entering: an untyped asset behaves precisely as it does today, so
 * the consolidated view is provably inert for it, and the group carries
 * `typed: false` so a surface can say WHY it did not consolidate rather than
 * leaving the user to wonder.
 *
 * The reference workbook behaves the same way by accident: its roll-up is a
 * SUMIF over a fixed ten-type list, so a plot with no type matches no row and
 * contributes to nothing, rather than falling into a bucket.
 */
export function consolidationKeyParts(
  asset: ConsolidatableAsset,
  normaliseTypeId: NormaliseTypeId,
): ConsolidationKeyParts {
  const registryId = (asset.assetTypeId ?? '').trim();
  const freeText = (asset.type ?? '').trim();
  let typeKey: string;
  let typed: boolean;
  if (registryId !== '') {
    typeKey = registryId;
    typed = true;
  } else if (freeText !== '') {
    // THE SAME ID SPACE AS THE REGISTRY, via the platform's one normaliser, so
    // a typed-in "Branded Villas" and a picked `branded-villas` are one type.
    // A label that normalises to nothing (punctuation only) is not a type.
    const id = normaliseTypeId(freeText);
    typeKey = id === '' ? `${UNTYPED_KEY_PREFIX}${asset.id}` : id;
    typed = id !== '';
  } else {
    typeKey = `${UNTYPED_KEY_PREFIX}${asset.id}`;
    typed = false;
  }
  return { phaseId: asset.phaseId, typeKey, strategy: asset.strategy, typed };
}

/**
 * The key as one string.
 *
 * THE SEPARATOR IS A PIPE, and it was a NUL byte until the first sabotage run
 * could not grep this file: raw control characters make a TypeScript source
 * BINARY to grep, diff and every review tool, which is a high price for a
 * separator. A pipe cannot appear in any of the three parts either. A phase id
 * is generated, a type key is normalised to a-z0-9 and dashes, and a strategy
 * is one of four literals; only the strategy contains a space, so a space would
 * NOT have been safe.
 */
export function consolidationKey(
  asset: ConsolidatableAsset,
  normaliseTypeId: NormaliseTypeId,
): string {
  const p = consolidationKeyParts(asset, normaliseTypeId);
  return `${p.phaseId}|${p.typeKey}|${p.strategy}`;
}

export interface ConsolidationGroup {
  key: string;
  phaseId: string;
  typeKey: string;
  /** What to show: the members' own type text, or the untyped label. */
  typeLabel: string;
  strategy: string;
  typed: boolean;
  assets: ConsolidatableAsset[];
  /** Members that are auto-generated Operate siblings. Counted, not filtered:
   *  which of them a consolidated NUMBER should include is the wiring step's
   *  decision, and this step must not make it invisibly. */
  companionCount: number;
  /** Members not on the model. Counted for the same reason. */
  hiddenCount: number;
}

/**
 * Assets grouped by the key, in a stable order: phase order first (so a
 * consolidated view reads down the programme), then type label, then strategy.
 * Every asset lands in exactly one group and no asset is dropped.
 */
export function groupAssetsForConsolidation(
  assets: readonly ConsolidatableAsset[],
  phaseOrder: readonly string[],
  normaliseTypeId: NormaliseTypeId,
): ConsolidationGroup[] {
  const byKey = new Map<string, ConsolidationGroup>();
  for (const a of assets) {
    const parts = consolidationKeyParts(a, normaliseTypeId);
    const key = `${parts.phaseId}|${parts.typeKey}|${parts.strategy}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.assets.push(a);
      if (a.isCompanion === true) existing.companionCount += 1;
      if (a.visible === false) existing.hiddenCount += 1;
      continue;
    }
    byKey.set(key, {
      key,
      phaseId: parts.phaseId,
      typeKey: parts.typeKey,
      typeLabel: parts.typed ? ((a.type ?? '').trim() || parts.typeKey) : UNTYPED_LABEL,
      strategy: parts.strategy,
      typed: parts.typed,
      assets: [a],
      companionCount: a.isCompanion === true ? 1 : 0,
      hiddenCount: a.visible === false ? 1 : 0,
    });
  }
  const phaseRank = new Map(phaseOrder.map((id, i) => [id, i] as const));
  // A phase the caller did not list sorts LAST rather than first, so an
  // unknown id cannot quietly lead the report.
  const rank = (id: string): number => phaseRank.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...byKey.values()].sort((x, y) =>
    rank(x.phaseId) - rank(y.phaseId)
    || x.typeLabel.localeCompare(y.typeLabel)
    || x.strategy.localeCompare(y.strategy)
    || x.typeKey.localeCompare(y.typeKey));
}

/** Groups that would MERGE more than one asset. The interesting ones: every
 *  other group is a relabelling of a row that already exists. */
export function mergingGroups(groups: readonly ConsolidationGroup[]): ConsolidationGroup[] {
  return groups.filter((g) => g.assets.length > 1);
}
