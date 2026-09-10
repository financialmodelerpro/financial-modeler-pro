/**
 * typeKey.ts (2026-09-10)
 *
 * THE ONE MAPPING FROM AN ASSET TYPE LABEL TO ITS ID, and nothing else.
 *
 * It lived in the asset type standards file in `lib/state/`, which is the right home for
 * the standards themselves and the wrong one for this: that file is on
 * `verify-asset-type-standards` A1's forbidden list, because no engine, report
 * or export may READ the asset type standards. A report that groups its rows by
 * the consolidation key needs the mapping and nothing else from that file, and
 * importing the whole module to get it trips a check that is right to fire.
 *
 * So the mapping moves to its own leaf. That file re-exports it, so
 * there is still ONE implementation and every existing caller is unchanged; the
 * difference is that a caller who needs only this can say so.
 *
 * NOT INJECTED INTO `consolidation.ts`. That file states, and means, that the
 * normaliser is passed in rather than imported so it keeps zero imports; this
 * file does not change that.
 *
 * Pure. No imports. No em dashes in this file.
 */

/**
 * A stable id for a type LABEL: lower case, non-alphanumerics collapsed to
 * single hyphens, trimmed, capped at the column width.
 *
 * "Branded Villas" and the registry entry `branded-villas` must land in the
 * same space or they read as two types, which is what this exists to prevent.
 * An empty result means the label had nothing to build an id from, and callers
 * treat that as "no type" rather than as an id of ''.
 */
export function normaliseAssetTypeId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
