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
    && v.revenueRate === undefined;
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

/** One phrase naming where a resolved standard came from, for a caption. */
export function describeSource(source: StandardSource): string {
  switch (source) {
    case 'sub_units': return 'from sub-units';
    case 'sub_unit':  return 'overridden here';
    case 'asset_type': return 'from the asset type';
    default: return 'not set';
  }
}

/** Same shape rule as the cost catalog id: usable inside composed ids and
 *  file-ish keys. */
export function normaliseAssetTypeId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

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
