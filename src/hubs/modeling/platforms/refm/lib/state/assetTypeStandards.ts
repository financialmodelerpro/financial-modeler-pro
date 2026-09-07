/**
 * assetTypeStandards.ts (2026-09-07, land planning step 1)
 *
 * THE FIRM'S ASSET TYPE REGISTRY AND COMPANY STANDARDS. An asset type is a row
 * in the firm's own vocabulary (account-scoped, `refm_asset_types`, mig 242),
 * carrying the two company standards the reference land structure keys off the
 * type: AVERAGE UNIT SIZE (sqm per unit or key) and PARKING RATIO (slots per
 * unit, or sqm of GFA per slot for retail-style types). One account-wide
 * scalar rides alongside: PARKING AREA PER SLOT (`refm_account_standards`).
 *
 * THE ENGINE NEVER READS THE TABLES. This follows the cost catalog rule
 * (lib/state/costCatalog.ts, mig 214/241) exactly: selecting an asset type
 * STAMPS the resolved values onto the ASSET (`asset.assetTypeStandards`), and
 * anything that ever consumes a standard reads the asset. So an old version
 * recomputes identically after the firm edits its standards, and an
 * unreachable registry can never change a number.
 *
 * A BLANK VALUE AND A TYPED ZERO ARE DIFFERENT ANSWERS. The reference company
 * tables hold both: a villa type with parking ratio 0 (a real zero, villas
 * park on plot) and a commercial type with no unit size at all (nobody has
 * decided). Storage keeps them apart (NULL vs 0 in the table), and the stamp
 * keeps them apart by OMITTING the key for a blank rather than writing null,
 * so no later reader can collapse absence into zero with a Number() coercion
 * (the `Number(null) === 0` family, docs/TRAPS.md 2.4).
 *
 * NOTHING HERE IS WIRED TO THE ENGINE IN STEP 1. The stamp is carried state;
 * the area chain that will consume it is a later step.
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

/** One row of the firm's registry, as served by /api/refm/asset-types.
 *  A standards field that is ABSENT is blank in the firm's table (nobody has
 *  decided); a 0 is a decision. The API layer maps NULL to absent. */
export interface AssetTypeStandard {
  /** Stable id, [a-z0-9-], unique per account. */
  id: string;
  label: string;
  /** Free-text grouping (Residential / Hospitality / Retail / ...). */
  category?: string;
  avgUnitSizeSqm?: number;
  parkingRatio?: number;
  parkingRatioBasis: ParkingRatioBasis;
  createdAt?: string;
}

/** Account-wide scalars (one row per account in refm_account_standards). */
export interface AccountAreaStandards {
  /** Sqm of parking area one slot occupies. Absent = blank. */
  parkingAreaPerSlotSqm?: number;
}

/**
 * What selecting an asset type writes onto the asset. Everything the future
 * area chain will need is FROZEN here at selection time, including the
 * account scalar, so the model is self-contained: the registry can change or
 * disappear and every saved version still recomputes byte-identically.
 *
 * Blank standards OMIT their key. Never write null here: a null survives
 * JSON round trips and invites `Number(null)` readers; an absent key is
 * unambiguous.
 */
export interface AssetTypeStandardsStamp {
  /** The registry label at stamp time, kept so the asset still names its
   *  type after the registry entry is renamed or deleted. */
  label: string;
  category?: string;
  avgUnitSizeSqm?: number;
  parkingRatio?: number;
  parkingRatioBasis?: ParkingRatioBasis;
  parkingAreaPerSlotSqm?: number;
  /** ISO timestamp of the selection that produced this stamp. */
  stampedAt: string;
}

/** Build the stamp for one selection. Conditional spreads keep blank values
 *  ABSENT rather than null or 0. */
export function stampFromAssetType(
  entry: AssetTypeStandard,
  account: AccountAreaStandards,
  now?: string,
): AssetTypeStandardsStamp {
  return {
    label: entry.label,
    ...(entry.category !== undefined && entry.category !== '' ? { category: entry.category } : {}),
    ...(entry.avgUnitSizeSqm !== undefined ? { avgUnitSizeSqm: entry.avgUnitSizeSqm } : {}),
    ...(entry.parkingRatio !== undefined
      ? { parkingRatio: entry.parkingRatio, parkingRatioBasis: entry.parkingRatioBasis }
      : {}),
    ...(account.parkingAreaPerSlotSqm !== undefined
      ? { parkingAreaPerSlotSqm: account.parkingAreaPerSlotSqm }
      : {}),
    stampedAt: now ?? new Date().toISOString(),
  };
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

/** The compact caption an asset card shows for its stamp. */
export function describeStamp(stamp: AssetTypeStandardsStamp): string {
  const parts: string[] = [];
  parts.push(`Unit size ${describeStandardValue(stamp.avgUnitSizeSqm, 'sqm')}`);
  const ratioUnit = stamp.parkingRatioBasis === 'sqm_per_slot' ? 'sqm/slot' : 'slots/unit';
  parts.push(`Parking ${describeStandardValue(stamp.parkingRatio, ratioUnit)}`);
  parts.push(`Slot area ${describeStandardValue(stamp.parkingAreaPerSlotSqm, 'sqm')}`);
  return parts.join(' | ');
}
