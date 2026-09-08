/**
 * assetName.ts (2026-09-08)
 *
 * WHAT AN ASSET IS CALLED, in one place.
 *
 * THE NAME IS OPTIONAL AND FALLS BACK TO THE TYPE. Five plots of Branded Villas
 * with five invented names is a user typing five identities for one thing, and
 * the schedules group by type and merge them anyway, so those names vanish from
 * the output with nothing saying why. An asset with no name is called by its
 * type. The name stays available for the case where it earns its keep, a
 * landmark a client knows by name, and stops being a field anyone feels obliged
 * to fill in.
 *
 * NOTHING STORED IS REWRITTEN. This resolves at READ time. A name someone typed
 * is kept verbatim in the snapshot and still wins here; only a blank one falls
 * through to the type. That is also what lets a blank stay visibly blank in the
 * one place it should, the name input itself, which shows the resolved name as
 * a placeholder instead.
 *
 * Pure. No imports. No em dashes in this file.
 */

/** The last resort, when an asset has neither a name nor a type. */
export const UNNAMED_ASSET = 'Unnamed asset';

/** The shape this needs. Structural, so core stays free of platform imports. */
export interface NameableAsset {
  name?: string;
  type?: string;
}

/**
 * What to CALL this asset: its name, else its type, else a last resort.
 *
 * Whitespace-only counts as blank, because a name of " " is not a name and the
 * alternative is a row labelled with a space.
 */
export function assetDisplayName(asset: NameableAsset): string {
  const name = (asset.name ?? '').trim();
  if (name !== '') return name;
  const type = (asset.type ?? '').trim();
  if (type !== '') return type;
  // NEVER AN EMPTY STRING. A blank label in a schedule, an export or a deck is
  // a row nobody can identify, which is worse than an ugly placeholder.
  return UNNAMED_ASSET;
}

/** True when the asset is being called by its type rather than a typed name, so
 *  a surface can show that as a placeholder rather than as a value. */
export function assetNameIsDerived(asset: NameableAsset): boolean {
  return (asset.name ?? '').trim() === '';
}

/**
 * Every asset in a list, with its name RESOLVED.
 *
 * ONE CALL AT AN EXPORT'S FRONT DOOR beats editing every read behind it. The
 * Excel workbook alone reads an asset name in 26 places, and several of those
 * are MAP KEYS rather than labels: resolving the labels and not the keys would
 * put a row under one name and look it up under another. Rewriting the list
 * once keeps keys and labels the same string by construction.
 *
 * The copy is shallow and the snapshot is untouched: this is a read-time view,
 * and nothing here is ever written back.
 */
export function withResolvedAssetNames<T extends NameableAsset>(assets: readonly T[]): T[] {
  return assets.map((a) => (assetNameIsDerived(a) ? { ...a, name: assetDisplayName(a) } : a));
}
