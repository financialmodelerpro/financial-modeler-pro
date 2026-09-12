/**
 * projectIntegrity.ts (2026-09-12)
 *
 * EVERY REFERENCE IN A MODEL POINTS AT SOMETHING THAT EXISTS, and this is the
 * one place that is checked.
 *
 * IT IS BORN FROM A MEASURED DEFECT. `removeParcel` deleted the plot row and
 * nothing else, so an asset created on a plot kept pointing at it after the
 * plot was gone. On FMP - MARINA GATE that left `asset_1789041611899`, High End
 * Apartments, pointing at `parcel_1789041596118`, deleted on 2026-09-10 at
 * 13:56:06. The label resolver could not find the plot, fell back to the phase,
 * and the row stopped reading "Land 7, High End Apartments" and started reading
 * "Phase 1, High End Apartments": to a reader, a row they had deleted appearing
 * under a new name. The append-only change log carries ONE row for that asset,
 * its creation, and no removal anywhere in 446 entries.
 *
 * WHY IT LIVES IN THE PERSISTENCE LAYER AND NOT ON A TAB. Every reconciliation
 * this platform has runs in a `useEffect` on the assets tab, so a model is only
 * as repaired as the last tab you happened to open. This runs where a project
 * is LOADED and where it is SAVED, so a stale reference cannot outlive a single
 * round trip whatever you were looking at.
 *
 * IT MUST SETTLE. Running it twice must produce the same state as running it
 * once, and running it on a clean model must produce the SAME OBJECT, or
 * opening a project would mark it dirty and every open would write a version.
 * `verify-project-integrity` asserts both, on the fixture and on live data.
 *
 * IT REPAIRS REFERENCES, NEVER VALUES. Nothing here may move a number: it
 * clears a pointer that resolves to nothing and reports what it cleared. A
 * repair that changed money would be a silent edit of somebody's model.
 *
 * Pure. No imports, no em dashes.
 */

/** The little of each entity this needs. Structural, so this file stays pure. */
export interface IntegrityAsset {
  id: string;
  landAllocation?: { parcelId?: string; sqm?: number };
}
export interface IntegrityParcel { id: string }

export interface IntegrityState {
  assets: readonly IntegrityAsset[];
  parcels: readonly IntegrityParcel[];
}

/** One thing that was pointing at nothing, named so a caller can say what it
 *  repaired rather than reporting a count. */
export interface IntegrityRepair {
  kind: 'asset-plot';
  /** The entity that held the dangling reference. */
  ownerId: string;
  /** What it pointed at, which no longer exists. */
  missingId: string;
}

export interface IntegrityResult<T extends IntegrityState> {
  state: T;
  repairs: IntegrityRepair[];
  /** False when nothing was wrong, and then `state` IS the input object. */
  changed: boolean;
}

/**
 * A SENTINEL IS NOT A REFERENCE. `__weighted_average__` and `__custom_rate__`
 * say "no plot", which is a real answer and not a dangling pointer. The label
 * resolver agrees, through the same `__` test, and `verify-project-integrity`
 * fails if a sentinel is ever repaired away.
 */
const isRealParcelRef = (id: unknown): id is string =>
  typeof id === 'string' && id !== '' && !id.startsWith('__');

/**
 * THE PLOTS EVERY ASSET DRAWS FROM, and which of those no longer exist.
 *
 * Exported on its own because the REFUSAL needs it too: `removeParcel` asks
 * how many assets a plot carries before it deletes anything, and that question
 * and this repair must be the same question, or a plot could be refused for
 * carrying an asset whose pointer this then cleared.
 */
export function assetsOnParcel(assets: readonly IntegrityAsset[], parcelId: string): string[] {
  return assets.filter((a) => a.landAllocation?.parcelId === parcelId).map((a) => a.id);
}

/**
 * Clear every reference that resolves to nothing, and say what was cleared.
 *
 * Returns the INPUT OBJECT when there is nothing to repair, so a caller can
 * test identity and a clean project never looks edited.
 */
export function repairProjectIntegrity<T extends IntegrityState>(state: T): IntegrityResult<T> {
  const live = new Set(state.parcels.map((p) => p.id));
  const repairs: IntegrityRepair[] = [];
  for (const a of state.assets) {
    const ref = a.landAllocation?.parcelId;
    if (!isRealParcelRef(ref) || live.has(ref)) continue;
    repairs.push({ kind: 'asset-plot', ownerId: a.id, missingId: ref });
  }
  if (repairs.length === 0) return { state, repairs, changed: false };

  const broken = new Set(repairs.map((r) => r.ownerId));
  const assets = state.assets.map((a) => {
    if (!broken.has(a.id)) return a;
    // THE POINTER GOES, THE AREA STAYS. The sqm an asset draws is the user's
    // number and this pass does not own it; clearing it would move land value
    // and this repairs references, never values. With no parcel the asset
    // falls to the project's ordinary allocation rule, which is exactly what
    // an asset that never had a plot does.
    const { parcelId: _dropped, ...rest } = a.landAllocation ?? {};
    void _dropped;
    return { ...a, landAllocation: rest };
  });
  return { state: { ...state, assets }, repairs, changed: true };
}

/** One line per repair, for the console and the change record. */
export function describeRepairs(repairs: readonly IntegrityRepair[]): string[] {
  return repairs.map((r) => `asset ${r.ownerId} pointed at plot ${r.missingId}, which no longer exists; the plot reference was cleared`);
}
