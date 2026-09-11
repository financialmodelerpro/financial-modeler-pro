/**
 * assetTypeStandards.ts (2026-09-07, land planning step 1)
 *
 * THE NAMES ARE THE FIRM'S, THE VALUES ARE THE PROJECT'S (mig 244).
 *
 * An asset type has two halves and they belong in different places:
 *
 *   THE VOCABULARY, on the ACCOUNT (`refm_asset_types`): the type's name, its
 *   category and its position in the firm's list. Shared by every member
 *   across the firm's projects, exactly like the cost catalog.
 *
 *   THE VALUES, in the PROJECT SNAPSHOT (`project.assetTypeValues`, keyed by
 *   the vocabulary entry id, plus `project.parkingAreaPerSlotSqm`): average
 *   unit size, parking ratio and its basis, construction cost per sqm, and a
 *   revenue rate whose unit names its basis. A firm's schemes genuinely
 *   differ, so these are assumptions OF A PROJECT.
 *
 * WHY THAT SPLIT REMOVES STAMPING. While the values sat on an account table
 * the engine must never read, they had to be COPIED onto the asset at
 * selection time so a later edit could not move a saved model, and a copy can
 * go stale. As project inputs they need no copy: they version, they diff, the
 * change log records them, and nothing has to be re-picked. `Asset.
 * assetTypeStandards` is deleted; `Asset.assetTypeId` stays and is now the KEY
 * these values are looked up by.
 *
 * A BLANK VALUE AND A TYPED ZERO ARE DIFFERENT ANSWERS. The reference company
 * tables hold both: a villa type with parking ratio 0 (a real zero, villas
 * park on plot) and a commercial type with no unit size at all (nobody has
 * decided). An ABSENT key is the blank; 0 is a decision. Never write null into
 * a value, so no later reader can collapse absence into zero with a Number()
 * coercion (the `Number(null) === 0` family, docs/TRAPS.md 2.4).
 *
 * NOTHING HERE IS WIRED TO THE ENGINE YET. The values are ordinary model
 * inputs that no calculation reads; the area chain that will consume them is a
 * later step, and until it lands the Module 6 picker keeps them out.
 *
 * Pure. No imports from module1-types (this file must stay leaf-level so the
 * types file can reference it without a cycle). No em dashes in this file.
 */

import { normaliseAssetTypeId } from '@/src/core/calculations/typeKey';

export type ParkingRatioBasis = 'slots_per_unit' | 'sqm_per_slot';

export const PARKING_RATIO_BASES: readonly ParkingRatioBasis[] = ['slots_per_unit', 'sqm_per_slot'];

export const PARKING_RATIO_BASIS_LABELS: Record<ParkingRatioBasis, string> = {
  slots_per_unit: 'slots per unit / key',
  sqm_per_slot: 'sqm of GFA per slot',
};

/**
 * What a revenue rate is PER (mig 243).
 *
 * ONE rate column with a unit beside it, rather than four half-empty columns:
 * the unit NAMES the basis, so the same field carries a sale price per sqm, a
 * price per unit, a lease rent per sqm per year and a hospitality ADR per key
 * per night. Kept as a union in code and validated at the route (the mig 214
 * rationale: a vocabulary change stays a code change).
 */
export type RevenueRateUnit = 'per_sqm' | 'per_unit' | 'per_sqm_year' | 'adr_per_key_night';

export const REVENUE_RATE_UNITS: readonly RevenueRateUnit[] = [
  'per_sqm', 'per_unit', 'per_sqm_year', 'adr_per_key_night',
];

export const REVENUE_RATE_UNIT_LABELS: Record<RevenueRateUnit, string> = {
  per_sqm: 'per sqm (sale)',
  per_unit: 'per unit (sale)',
  per_sqm_year: 'per sqm per year (lease)',
  adr_per_key_night: 'ADR, per key per night',
};

/** The compact form, for a caption or a table cell. */
export const REVENUE_RATE_UNIT_SHORT: Record<RevenueRateUnit, string> = {
  per_sqm: '/sqm',
  per_unit: '/unit',
  per_sqm_year: '/sqm/year',
  adr_per_key_night: '/key/night',
};

/** One row of the firm's VOCABULARY, as served by /api/refm/asset-types.
 *  Names only: since mig 244 the values live on the project. */
export interface AssetTypeStandard {
  /** Stable id, [a-z0-9-], unique per account. Survives a rename, which is
   *  what keeps a project's values and an asset's reference attached to the
   *  same type after the firm renames it. */
  id: string;
  label: string;
  /** Free-text grouping (Residential / Hospitality / Retail / ...). */
  category?: string;
  /** The firm's own position for this row. ABSENT means never reordered and
   *  falls back to label order; 0 is a real first position (the mig 229
   *  rule, so "unset" and "first" stay different answers). */
  sortOrder?: number;
  createdAt?: string;
}

/**
 * THE PROJECT'S VALUES for one asset type, held in the snapshot under
 * `project.assetTypeValues[entryId]` (mig 244).
 *
 * Every field is optional and an ABSENT field is the blank: not decided. A 0
 * is a decision and must survive as one. `parkingRatioBasis` rides with the
 * ratio (it names what the ratio counts), and `revenueRateUnit` rides with the
 * rate (it names what the rate is per); neither is ever defaulted onto a value
 * nobody typed.
 */
export interface AssetTypeValues {
  avgUnitSizeSqm?: number;
  parkingRatio?: number;
  parkingRatioBasis?: ParkingRatioBasis;
  constructionCostPerSqm?: number;
  revenueRate?: number;
  revenueRateUnit?: RevenueRateUnit;
  /**
   * THE MASSING A TYPE USUALLY BUILDS TO (2026-09-10).
   *
   * Coverage, FAR and the service share are typed PER PLOT, and five plots of
   * one type usually share them: the reference workbook's fourteen Standalone
   * Commercial rows all read FAR 1.6 and coverage 60%. Fifteen typed numbers
   * where three would do, and each one a chance to mistype.
   *
   * SAME INHERIT-AND-OVERRIDE SHAPE AS THE PARKING RATIO: the type carries the
   * default, the PLOT overrides where it differs, absent means inherit and a
   * typed 0 is a real override. Resolved by `resolveChainDefaults` below.
   *
   * THE RETAIL SHARE IS DELIBERATELY NOT HERE. It is ground-floor retail on
   * THIS plot, it drives which companion exists and how much land is carved,
   * and it is the most plot-specific figure in the chain.
   *
   * FAR IS THE ONE TO WATCH, and the plot row shows it inherited rather than
   * blank for that reason: it is a planning constraint of a piece of GROUND,
   * not a preference of a building type, and the reference's own FAR varies
   * 1.2 to 5 WITHIN one type. Offering a default is a convenience; hiding that
   * it applied would be a trap.
   */
  coveragePct?: number;
  farRatio?: number;
  servicePct?: number;
}

/** What a plot states, structurally, so this file stays import-free. Matches
 *  `LandChainInputs` on the three fields a type can default. */
export interface ChainDefaultable {
  coveragePct?: number;
  farRatio?: number;
  servicePct?: number;
}

export interface ResolvedChainDefaults extends ChainDefaultable {
  /** Where each figure came from, so a cell can say "from the type". */
  sources: { coveragePct: StandardSource; farRatio: StandardSource; servicePct: StandardSource };
}

/**
 * THE PLOT WINS, THE TYPE FILLS IN. One rule for all three, so a reader cannot
 * find coverage inheriting one way and FAR another.
 *
 * A TYPED ZERO IS AN OVERRIDE, never a blank: 0% coverage is a real statement
 * (a plot left open) and must not be replaced by the type's 60%. Absent is the
 * only thing that inherits, which is the same rule the parking ratio, the unit
 * size and the cost catalog all keep.
 */
export function resolveChainDefaults(
  plot: ChainDefaultable | undefined,
  values: AssetTypeValues | undefined,
): ResolvedChainDefaults {
  const one = (
    p2: number | undefined, t: number | undefined,
  ): { value?: number; source: StandardSource } => {
    if (typeof p2 === 'number' && Number.isFinite(p2)) return { value: p2, source: 'sub_unit' };
    if (typeof t === 'number' && Number.isFinite(t)) return { value: t, source: 'asset_type' };
    return { source: 'unset' };
  };
  const cov = one(plot?.coveragePct, values?.coveragePct);
  const far = one(plot?.farRatio, values?.farRatio);
  const svc = one(plot?.servicePct, values?.servicePct);
  return {
    ...(cov.value !== undefined ? { coveragePct: cov.value } : {}),
    ...(far.value !== undefined ? { farRatio: far.value } : {}),
    ...(svc.value !== undefined ? { servicePct: svc.value } : {}),
    sources: { coveragePct: cov.source, farRatio: far.source, servicePct: svc.source },
  };
}

/**
 * WHAT ONE ASSET INHERITS, in the shape the chain takes (2026-09-11).
 *
 * `resolveChainDefaults` answers the same question and also reports WHERE each
 * figure came from, which the plot row needs so an inherited FAR can render
 * greyed. A consumer that only wants the values should not have to carry the
 * sources into a chain input object, so this is that one line, stated once:
 * both the assets tab and the engine's front door call it, and the rule stays
 * `resolveChainDefaults`.
 */
export function chainMassingFor(
  asset: TypedAsset & { landChain?: { coveragePct?: number; farRatio?: number; servicePct?: number } },
  valuesByType: AssetTypeValuesByType | undefined,
): { coveragePct?: number; farRatio?: number; servicePct?: number } {
  const { sources: _sources, ...values } = resolveChainDefaults(
    asset.landChain, resolveAssetTypeValues(asset, valuesByType),
  );
  return values;
}

/** Every type's values in one project, keyed by vocabulary entry id. */
export type AssetTypeValuesByType = Record<string, AssetTypeValues>;

/** True when a values entry states nothing at all, so a caller can drop it
 *  rather than store an empty object that reads as "configured". */
export function assetTypeValuesAreEmpty(v: AssetTypeValues | undefined): boolean {
  if (!v) return true;
  return v.avgUnitSizeSqm === undefined
    && v.parkingRatio === undefined
    && v.constructionCostPerSqm === undefined
    && v.revenueRate === undefined
    // THE MASSING DEFAULTS COUNT AS CONFIGURED TOO (2026-09-10), or an entry
    // holding only a coverage would be dropped on the next write.
    && v.coveragePct === undefined
    && v.farRatio === undefined
    && v.servicePct === undefined;
}

/** The little of an asset this needs to say which type it is. */
export interface TypedAsset {
  assetTypeId?: string;
  type?: string;
}

/**
 * WHICH TYPE IS THIS ASSET? ONE ANSWER, and until 2026-09-09 there were two.
 *
 * The grouping key already resolved it both ways (`consolidationKeyParts`):
 * the stored registry reference when there is one, and otherwise the type
 * LABEL normalised into the same id space, because the vocabulary's entry ids
 * are minted from labels by `normaliseAssetTypeId`, so a picked
 * `branded-villas` and a typed "Branded Villas" are one type.
 *
 * The VALUES lookup did not. It read `project.assetTypeValues[asset.assetTypeId]`
 * and nothing else, so an asset whose type was set in the table row (which
 * wrote the label and never the reference) resolved to nothing. MEASURED on the
 * live projects: 11 of 12 typed assets carried a label with no reference, and
 * the one plot that had a reference derived its units and parking while its
 * neighbour, same type, same firm standard, showed dashes from Average Unit
 * Size onward. Two ways to answer one question, and the cheaper one lost.
 *
 * Identity resolves here, once. An absent answer is undefined, never a
 * fabricated id, so an untyped asset finds no values rather than someone
 * else's.
 */
export function resolveAssetTypeKey(asset: TypedAsset): string | undefined {
  const ref = (asset.assetTypeId ?? '').trim();
  // THE STORED REFERENCE WINS, even when the firm has since deleted that entry:
  // the project's values for it deliberately survive the deletion, so a stale
  // reference must still find them rather than falling back to a label that
  // might now mean something else.
  if (ref !== '') return ref;
  const label = (asset.type ?? '').trim();
  if (label === '') return undefined;
  const id = normaliseAssetTypeId(label);
  return id === '' ? undefined : id;
}

/** This asset's project values, resolved through the one identity rule. */
export function resolveAssetTypeValues(
  asset: TypedAsset,
  valuesByType: AssetTypeValuesByType | undefined,
): AssetTypeValues | undefined {
  const key = resolveAssetTypeKey(asset);
  return key === undefined ? undefined : valuesByType?.[key];
}

/**
 * The values a project holds for types that are NO LONGER in the firm's list.
 *
 * Removing a type from the account vocabulary must not delete a project's
 * numbers as a side effect (the same instinct as "the entry outlives the
 * author"): the values stay, and the surface says they belong to a type that
 * is no longer listed. Returns the orphaned entry ids, in a stable order.
 */
export function orphanedValueTypeIds(
  values: AssetTypeValuesByType | undefined,
  entries: readonly AssetTypeStandard[],
): string[] {
  if (!values) return [];
  const known = new Set(entries.map((e) => e.id));
  return Object.keys(values)
    .filter((id) => !known.has(id) && !assetTypeValuesAreEmpty(values[id]))
    .sort();
}

/**
 * The firm's list in the firm's order: explicit positions first (ascending),
 * then everything never reordered, alphabetically. ONE ordering rule, shared
 * by the route, the tab and the verifier, so a reorder cannot mean one thing
 * on screen and another on reload.
 */
export function sortAssetTypes(entries: readonly AssetTypeStandard[]): AssetTypeStandard[] {
  return entries.slice().sort((a, b) => {
    const ao = a.sortOrder, bo = b.sortOrder;
    if (ao !== undefined && bo !== undefined && ao !== bo) return ao - bo;
    if (ao !== undefined && bo === undefined) return -1;
    if (ao === undefined && bo !== undefined) return 1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * BACKFILLING A PROJECT'S LIST FROM WHAT THE PROJECT ALREADY REFERENCES
 * (2026-09-10).
 *
 * Every project that predates the move carries no list, and it must not get one
 * from an account: reading the owner's account here would reintroduce, at
 * hydrate, exactly the cross-scope lookup the move is removing (docs/TRAPS.md
 * 7.35). Everything needed is inside the snapshot already.
 *
 * THREE SOURCES, in order of how much each knows about the label:
 *
 *   1. AN ASSET'S OWN REFERENCE plus its own label. `assetTypeId` is the id and
 *      `type` is what the user was shown when they picked it, so the pair is
 *      the best recovery there is: it is what the account row said at the time.
 *   2. AN ASSET WITH NO REFERENCE but a free-text label. Its values already
 *      resolve by the label-derived id (`resolveAssetTypeKey`), so the type is
 *      real whether or not anybody ever registered it.
 *   3. A VALUE KEY WITH NO ASSET. The retail companion's type is the live case:
 *      `retail-combined` carries the ground-floor retail divisor on a project
 *      where no asset is of that type. Dropping it would orphan a value that is
 *      in use.
 *
 * A LABEL IS RECOVERED, NEVER INVENTED: the asset's own text first, then the
 * catalog entry with the same id, and only then the id with its hyphens opened
 * out. That last case needs the account row deleted AND no asset carrying the
 * type, which on both live projects is nobody.
 *
 * NO ORDER IS INVENTED EITHER. `sortOrder` stays absent on every backfilled
 * row, which the shared ordering rule reads as "never reordered" and sorts
 * alphabetically. Stamping 0..N would claim the user had arranged a list they
 * have never seen (the mig 229 rule: unset and first are different answers).
 *
 * PURE, AND IT WRITES NO VALUES. It names types; the values keyed by those
 * names are untouched, which is what makes it provably number-neutral.
 */
export function backfillAssetTypes(
  assets: readonly { type?: string; assetTypeId?: string }[],
  valueKeys: readonly string[],
  catalog: readonly { label: string; category?: string }[],
): AssetTypeStandard[] {
  const catalogById = new Map<string, { label: string; category?: string }>();
  for (const c of catalog) {
    const id = normaliseAssetTypeId(c.label);
    if (id !== '' && !catalogById.has(id)) catalogById.set(id, c);
  }
  const categoryOf = (id: string, label: string): string | undefined => {
    const byId = catalogById.get(id)?.category;
    if (byId) return byId;
    return catalogById.get(normaliseAssetTypeId(label))?.category;
  };

  const out = new Map<string, AssetTypeStandard>();
  // WHICH IDS HOLD A LABEL SOMEBODY ACTUALLY TYPED, as against one recovered
  // from the catalog or opened out of the id. Tracked separately because the
  // recovered label is never blank, so 'is it still empty' cannot tell them
  // apart: an asset carrying the id and no type would otherwise pin the
  // fallback and lock out the real name on the next asset.
  const real = new Set<string>();
  const add = (rawId: string, rawLabel: string | undefined): void => {
    const id = rawId.trim();
    if (id === '') return;
    const label = (rawLabel ?? '').trim();
    // FIRST REAL LABEL WINS, and a real one always beats a recovered one.
    if (real.has(id)) return;
    if (out.has(id) && label === '') return;
    if (label !== '') real.add(id);
    const recovered = label !== ''
      ? label
      : (catalogById.get(id)?.label ?? id.split('-').filter(Boolean).join(' '));
    const category = categoryOf(id, recovered);
    out.set(id, { id, label: recovered, ...(category ? { category } : {}) });
  };

  for (const a of assets) {
    const ref = (a.assetTypeId ?? '').trim();
    const label = (a.type ?? '').trim();
    if (ref !== '') { add(ref, label); continue; }
    if (label !== '') add(normaliseAssetTypeId(label), label);
  }
  for (const id of valueKeys) add(id, undefined);

  return sortAssetTypes([...out.values()]);
}

// ── The two resolution rules ────────────────────────────────────────────────
//
// DISPLAY ONLY, TODAY. Nothing in the calculation engine calls either of
// these: they state WHICH source a value would come from, so the Assets tab
// can show it and a later step can wire it. Both are pure and both keep a
// typed zero apart from a blank, because an override of 0 is an answer.

/** Where a resolved standard came from. */
export type StandardSource = 'sub_units' | 'sub_unit' | 'asset_type' | 'unset';

export interface ResolvedStandard {
  value?: number;
  source: StandardSource;
}

/**
 * THE UNIT SIZE RULE: sub-units first, the asset type average as the fallback.
 *
 * A sub-unit carries the area of ITS OWN unit, which is more precise than one
 * average across a whole asset type, so any sub-unit that states a unit area
 * wins. The returned value is then the OBSERVED average of those areas (a
 * read-out; a consumer would use each sub-unit's own figure). With no
 * sub-unit area anywhere, the asset type's stamped average is the fallback,
 * which is what it is for.
 *
 * A sub-unit with no unit area, or an area of zero, carries no detail and
 * does not displace the fallback.
 */
export function resolveAvgUnitSize(
  subUnitAreas: readonly (number | undefined)[],
  values: AssetTypeValues | undefined,
): ResolvedStandard {
  const stated = subUnitAreas.filter((a): a is number => typeof a === 'number' && a > 0);
  if (stated.length > 0) {
    return { value: stated.reduce((s, a) => s + a, 0) / stated.length, source: 'sub_units' };
  }
  if (values?.avgUnitSizeSqm !== undefined) return { value: values.avgUnitSizeSqm, source: 'asset_type' };
  return { source: 'unset' };
}

export interface ResolvedParkingRatio extends ResolvedStandard {
  basis?: ParkingRatioBasis;
}

/**
 * THE PARKING RULE: the asset type carries the default, a sub-unit may
 * override it, and the detail wins wherever it lives. Same inherit-and-
 * override shape the cost lines use, so an override of ZERO is an override
 * (a villa row that needs no bay), never a blank.
 */
export function resolveParkingRatio(
  subUnitOverride: number | undefined,
  values: AssetTypeValues | undefined,
): ResolvedParkingRatio {
  if (subUnitOverride !== undefined) {
    return { value: subUnitOverride, source: 'sub_unit', ...(values?.parkingRatioBasis ? { basis: values.parkingRatioBasis } : {}) };
  }
  if (values?.parkingRatio !== undefined) {
    return { value: values.parkingRatio, source: 'asset_type', ...(values.parkingRatioBasis ? { basis: values.parkingRatioBasis } : {}) };
  }
  return { source: 'unset' };
}

/**
 * THE PLATFORM'S GROUND-FLOOR RETAIL TYPE.
 *
 * The catalog in module1-types spells this label in its Retail category. It is
 * declared HERE rather than imported from there because module1-types imports
 * nothing at runtime and this file must stay leaf-level, so the two spellings
 * are a MIRRORED PAIR: `verify-land-chain` fails if the catalog's Retail
 * category stops containing this exact string, which is the only thing keeping
 * a rename in one file from silently unhooking retail parking in the other.
 */
export const GROUND_FLOOR_RETAIL_TYPE_LABEL = 'Retail combined';

/**
 * SQM OF RETAIL GFA PER PARKING SLOT: the divisor a host plot's ground-floor
 * retail uses, resolved from the project's asset type values (2026-09-10).
 *
 * IT IS A TYPE STANDARD, NOT A PROJECT FIELD. It lived on `project.
 * retailAreaPerSlotSqm` for a day, and before that on every plot row, and both
 * shapes put one number somewhere it could disagree with the type table that
 * already had a cell for it: a retail type states its parking ratio in sqm per
 * slot, which IS this figure. The reference agrees, and more directly than the
 * intermediate design did: its retail-parking column divides by the retail row
 * of the ordinary parking-ratio table. On the one live project holding retail
 * the two places HAD disagreed, the project field carrying 40 (the area a slot
 * occupies) where the reference divides by 25.
 *
 * THE RULE, in order:
 *   1. The ground-floor retail type, when it states a POSITIVE sqm-per-slot
 *      ratio. This is the workbook's fixed reference, and it is what makes the
 *      answer deterministic when a firm's list holds several retail types.
 *   2. Otherwise, the ONE type that states a positive sqm-per-slot ratio, when
 *      exactly one does, so a firm that renamed or replaced the entry still
 *      derives retail parking.
 *   3. Otherwise nothing, and the chain reports `no_retail_area_per_slot` by
 *      name. That covers both "nobody has said" and "two types claim it", and
 *      the gap sentence names the ground-floor retail type as the place to
 *      settle it, which resolves the second case the moment it is followed.
 *
 * A TYPED ZERO IS NOT A DIVISOR. "This type needs no parking" is a real answer
 * for an asset's OWN parking (rule 8 of the chain derives zero slots from it),
 * but it cannot size a shop's, so it does not make an entry a candidate here.
 * A slots-per-unit ratio is not a candidate either: it counts a different
 * thing.
 */
export function resolveRetailSlotArea(
  valuesByType: AssetTypeValuesByType | undefined,
): number | undefined {
  if (!valuesByType) return undefined;
  const candidates = Object.keys(valuesByType).sort().filter((id) => {
    const v = valuesByType[id];
    return v?.parkingRatioBasis === 'sqm_per_slot'
      && typeof v.parkingRatio === 'number' && Number.isFinite(v.parkingRatio)
      && v.parkingRatio > 0;
  });
  const named = normaliseAssetTypeId(GROUND_FLOOR_RETAIL_TYPE_LABEL);
  if (candidates.includes(named)) return valuesByType[named]?.parkingRatio;
  if (candidates.length === 1) return valuesByType[candidates[0]]?.parkingRatio;
  return undefined;
}

/** One phrase naming where a resolved standard came from, for a caption. */
export function describeSource(source: StandardSource): string {
  switch (source) {
    case 'sub_units': return 'from sub-units';
    case 'sub_unit':  return 'overridden here';
    case 'asset_type': return 'from the asset type';
    default: return 'not set';
  }
}

/** THE ID FOR A TYPE LABEL, re-exported from its own leaf.
 *
 *  It moved to `core/calculations/typeKey.ts` on 2026-09-10 so a report that
 *  needs only the mapping can import only the mapping: this file is on
 *  `verify-asset-type-standards` A1's forbidden list, and rightly, because no
 *  engine or export may read the standards. Re-exported rather than moved
 *  outright so every existing caller is unchanged and there is still ONE
 *  implementation. Same shape rule as the cost catalog id. */
export { normaliseAssetTypeId };

/**
 * The labels from `labels` that have NO standard yet: not matching any
 * registry entry by normalised id or by case-insensitive label.
 *
 * ONE rule for both quick-add lists in the standards modal (the platform
 * catalog and the types already used on the open project), so "already
 * covered" cannot mean two different things. Deduped case-insensitively,
 * first spelling wins, blanks dropped, first-seen order preserved.
 */
export function typesWithoutStandard(
  labels: readonly string[],
  entries: readonly AssetTypeStandard[],
): string[] {
  const coveredIds = new Set(entries.map((e) => e.id));
  const coveredLabels = new Set(entries.map((e) => e.label.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    if (!label) continue;
    const lower = label.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    const id = normaliseAssetTypeId(label);
    if (coveredLabels.has(lower)) continue;
    if (id && coveredIds.has(id)) continue;
    out.push(label);
  }
  return out;
}

/** One phrase for a standards value, keeping blank and zero visibly apart.
 *  The UI must never print a blank as 0. */
export function describeStandardValue(value: number | undefined, unit: string): string {
  if (value === undefined) return 'not set';
  return `${value} ${unit}`;
}

/** The compact caption an asset card shows for its type's PROJECT values.
 *  A read-out of live inputs, not a copy: change one on the standards tab and
 *  this line changes with it. */
export function describeValues(
  values: AssetTypeValues | undefined,
  parkingAreaPerSlotSqm?: number,
): string {
  const v = values ?? {};
  const parts: string[] = [];
  parts.push(`Unit size ${describeStandardValue(v.avgUnitSizeSqm, 'sqm')}`);
  const ratioUnit = v.parkingRatioBasis === 'sqm_per_slot' ? 'sqm/slot' : 'slots/unit';
  parts.push(`Parking ${describeStandardValue(v.parkingRatio, ratioUnit)}`);
  parts.push(`Slot area ${describeStandardValue(parkingAreaPerSlotSqm, 'sqm')}`);
  // THE BUILD COST AND THE REVENUE RATE ARE NOT STATED (2026-09-08), for the
  // same reason their columns are hidden on the standards tab: nothing reads
  // them, so a figure here would invite the question of where it applies and
  // the answer today is nowhere. Worse, this caption would be the ONLY place
  // showing a value the user can no longer see or edit. The fields, the
  // stored values and REVENUE_RATE_UNIT_SHORT all stay for when the wiring
  // lands, and this line grows back with the columns.
  return parts.join(' | ');
}
