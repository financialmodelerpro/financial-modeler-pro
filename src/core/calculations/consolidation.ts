/**
 * consolidation.ts (2026-09-08, consolidation step 1)
 *
 * THE GROUPING KEY: which assets a consolidated schedule would treat as ONE
 * row. Nothing else. This file computes no money, reads no snapshot and is
 * imported by no calculation, resolver, report or export; `verify-consolidation-key`
 * fails if that changes. So it can ship before anything consolidates, and an
 * asset's numbers are byte-identical with it present.
 *
 * THE KEY IS (PHASE, TYPE). THE PHASE IS NOT OPTIONAL AND THE STRATEGY IS NOT
 * PART OF IT.
 *
 * Strategy left the key on 2026-09-09, and this is the design decision the rest
 * of consolidation rests on: the fields that used to COLLIDE between two plots
 * of one type belong to the LINE, not to the plot. Strategy, recognition,
 * indexation, ADR, opex and its indexation, capex phasing and useful life are
 * all properties of the thing being built, not of the ground it stands on. Once
 * they live on the line, two plots cannot disagree about them, because neither
 * plot holds them. The merge is therefore UNCONDITIONAL: same type, same phase,
 * one line. A different phase is a different line.
 *
 * The plot keeps only what is genuinely per plot: its land area and rate, and
 * the chain inputs describing that plot's own massing, coverage, FAR, retail
 * share, service share, utilisation and floors. The line sums the derived areas.
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
  // STRATEGY IS CARRIED ON THE PARTS BUT NOT IN THE KEY. It is still read from
  // the asset today, because that is where it is stored; it is the LINE that
  // resolves it. Keeping it out of the key is what makes the merge
  // unconditional.
  return `${p.phaseId}|${p.typeKey}`;
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
  /**
   * GONE, and the reason is worth keeping.
   *
   * Step 1 counted companions rather than filtering them, on the principle that
   * this layer should not decide invisibly which members a number includes.
   * Dropping strategy from the key made that principle point the other way: a
   * companion and its Sell + Manage parent share a phase and a type, so they
   * would merge into one line carrying two strategies, which is the one thing a
   * line cannot hold. A companion is not a plot. It is now excluded at the door,
   * visibly, in one place, and the counter that would always read zero is gone
   * rather than left behind to imply otherwise.
   */
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
    // A COMPANION IS NOT A PLOT AND SO IS NOT A LINE MEMBER.
    //
    // It is the Operate sibling of a Sell + Manage asset: the same building
    // under a second treatment. It carries no land (the engine excludes it from
    // land aggregation) and no cost (computeAssetCost short-circuits it to
    // zero), and it exists only as a mirror of its parent's sub-units.
    //
    // MEASURED, NOT ASSUMED. Dropping strategy from the key merges FMP RE HUB's
    // "Residential Tower" (Sell + Manage) with "Residential Tower - Operate"
    // (Operate) into one phase_2 high-end-apartments line carrying TWO
    // strategies, which is precisely what a line cannot hold. Excluding
    // companions leaves every live line on both projects with exactly one
    // member, which is the state this step has to preserve.
    if (a.isCompanion === true) continue;
    const parts = consolidationKeyParts(a, normaliseTypeId);
    const key = `${parts.phaseId}|${parts.typeKey}|${parts.strategy}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.assets.push(a);
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

// ── Consolidation step 1: the line's durable identity ─────────────────────

/**
 * An asset's membership of a consolidated line, as stored on the asset.
 *
 * The shape is duplicated from `Asset.consolidation` deliberately: this file
 * imports nothing, and the platform type structurally satisfies it.
 */
export interface ConsolidationMembership {
  id: string;
  keyAtAssignment: string;
}

export interface AssignableAsset extends ConsolidatableAsset {
  consolidation?: ConsolidationMembership;
}

/** How an asset came by its line id, so a caller can report rather than guess. */
export type AssignmentSource = 'existing' | 'adopted' | 'minted';

export interface ConsolidationAssignment {
  assetId: string;
  id: string;
  keyAtAssignment: string;
  source: AssignmentSource;
}

/** Mints a new line id. Injected so this function is deterministic in a test
 *  and so the id format is the caller's decision, not this file's. */
export type MintLineId = (seed: { key: string; index: number }) => string;

/**
 * Decide a consolidated line id for every asset, ONCE.
 *
 * THE RULE, in three lines:
 *   an asset that already has an id KEEPS it, whatever its key now says;
 *   an asset without one ADOPTS the id of a same-key asset that has one;
 *   otherwise it MINTS a new one, which the next same-key asset will adopt.
 *
 * WHY KEEPING WINS OVER MATCHING. A line has to be an identity before a
 * sub-unit can point at it, and a key built from phase, type and strategy is
 * not one: the user edits all three. Re-deriving on every read would re-parent
 * sub-units while somebody types a type name, silently, with revenue landing on
 * the wrong line and no error anywhere. So the key decides membership once and
 * the id then survives every edit.
 *
 * THE COST OF THAT, STATED. An asset retyped after assignment keeps a line id
 * that no longer matches its key. That is not an oversight, it is the trade:
 * `keyAtAssignment` records what the key WAS, `consolidationDrift` finds every
 * asset where the two disagree, and whether membership follows the new key is a
 * later step's decision taken in the open. A silently correct answer that
 * changes under a keystroke is worse than a stale one you can see.
 *
 * PURE, and callable with no side effects: it returns assignments and writes
 * nothing. Nothing calls it yet.
 */
export function assignConsolidationIds(
  assets: readonly AssignableAsset[],
  normaliseTypeId: NormaliseTypeId,
  mintLineId: MintLineId,
): ConsolidationAssignment[] {
  const byKey = new Map<string, string>();
  // PRE-EXISTING IDS CLAIM THEIR KEY FIRST, in a separate pass. Doing it in one
  // pass would let an asset earlier in the array mint a fresh id for a key that
  // a later asset already holds one for, splitting a line in two.
  for (const a of assets) {
    if (!a.consolidation) continue;
    const key = consolidationKey(a, normaliseTypeId);
    if (!byKey.has(key)) byKey.set(key, a.consolidation.id);
  }
  const out: ConsolidationAssignment[] = [];
  let minted = 0;
  for (const a of assets) {
    const key = consolidationKey(a, normaliseTypeId);
    if (a.consolidation) {
      // KEPT VERBATIM, including its recorded key: rewriting keyAtAssignment
      // here would erase the drift this field exists to make visible.
      out.push({ assetId: a.id, id: a.consolidation.id, keyAtAssignment: a.consolidation.keyAtAssignment, source: 'existing' });
      continue;
    }
    const held = byKey.get(key);
    if (held !== undefined) {
      out.push({ assetId: a.id, id: held, keyAtAssignment: key, source: 'adopted' });
      continue;
    }
    const id = mintLineId({ key, index: minted });
    minted += 1;
    byKey.set(key, id);
    out.push({ assetId: a.id, id, keyAtAssignment: key, source: 'minted' });
  }
  return out;
}

export interface ConsolidationDrift {
  assetId: string;
  id: string;
  keyAtAssignment: string;
  currentKey: string;
}

/**
 * Assets whose (phase, type, strategy) no longer matches the key their line id
 * was assigned under.
 *
 * This is the whole safety net for a sticky id. An empty result means every
 * line still describes its members; a non-empty one is a list of decisions
 * somebody has to take, not a fault to hide.
 */
export function consolidationDrift(
  assets: readonly AssignableAsset[],
  normaliseTypeId: NormaliseTypeId,
): ConsolidationDrift[] {
  const out: ConsolidationDrift[] = [];
  for (const a of assets) {
    if (!a.consolidation) continue;
    const currentKey = consolidationKey(a, normaliseTypeId);
    if (currentKey === a.consolidation.keyAtAssignment) continue;
    out.push({ assetId: a.id, id: a.consolidation.id, keyAtAssignment: a.consolidation.keyAtAssignment, currentKey });
  }
  return out;
}

/** Apply assignments to a list, returning a NEW list. Writes nothing to the
 *  input, so a caller can diff before deciding to persist. */
export function withConsolidationIds<T extends AssignableAsset>(
  assets: readonly T[],
  assignments: readonly ConsolidationAssignment[],
): T[] {
  const byAsset = new Map(assignments.map((x) => [x.assetId, x] as const));
  return assets.map((a) => {
    const x = byAsset.get(a.id);
    if (!x) return a;
    if (a.consolidation && a.consolidation.id === x.id
      && a.consolidation.keyAtAssignment === x.keyAtAssignment) return a;
    return { ...a, consolidation: { id: x.id, keyAtAssignment: x.keyAtAssignment } };
  });
}
