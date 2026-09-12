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
  /** An Operate companion names its parent; a retail strip names its hosts. */
  parentAssetId?: string;
  isCompanion?: boolean;
  companionType?: string;
  retailHostAssetIds?: string[];
}
export interface IntegrityParcel { id: string }
export interface IntegrityScoped { assetId?: string }

export interface IntegrityState {
  assets: readonly IntegrityAsset[];
  parcels: readonly IntegrityParcel[];
  /** The dependents (2026-09-12). Optional so the two-array fixture and any
   *  caller that only has plots and assets still type-check. */
  subUnits?: readonly { id: string; assetId: string }[];
  costLines?: readonly { id: string; targetAssetId?: string }[];
  costOverrides?: readonly { assetId: string; lineId: string }[];
  financingTranches?: readonly IntegrityScoped[];
  equityContributions?: readonly IntegrityScoped[];
  cases?: readonly { overrides?: Record<string, unknown> }[];
}

/** One thing that was pointing at nothing, named so a caller can say what it
 *  repaired rather than reporting a count. */
export interface IntegrityRepair {
  kind: 'asset-plot' | 'orphan-sub-unit' | 'orphan-override' | 'orphan-line' | 'orphan-strip' | 'tranche-scope' | 'equity-scope';
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
  // THE DEPENDENTS (2026-09-12): a sub-unit, override, per-asset line, tranche
  // scope or equity scope that names an asset which no longer exists, and a
  // retail strip whose hosts are all gone. Each is a reference to nothing and
  // is dropped (a scope is cleared, the row stays); nothing here moves a value
  // an existing asset carries.
  const assetIds = new Set(state.assets.map((a) => a.id));
  for (const u of state.subUnits ?? []) if (!assetIds.has(u.assetId)) repairs.push({ kind: 'orphan-sub-unit', ownerId: u.id, missingId: u.assetId });
  for (const o of state.costOverrides ?? []) if (!assetIds.has(o.assetId)) repairs.push({ kind: 'orphan-override', ownerId: `${o.assetId}::${o.lineId}`, missingId: o.assetId });
  for (const c of state.costLines ?? []) if (c.targetAssetId !== undefined && !assetIds.has(c.targetAssetId)) repairs.push({ kind: 'orphan-line', ownerId: c.id, missingId: c.targetAssetId });
  (state.financingTranches ?? []).forEach((t, i) => { if (t.assetId !== undefined && !assetIds.has(t.assetId)) repairs.push({ kind: 'tranche-scope', ownerId: String(i), missingId: t.assetId }); });
  (state.equityContributions ?? []).forEach((e, i) => { if (e.assetId !== undefined && !assetIds.has(e.assetId)) repairs.push({ kind: 'equity-scope', ownerId: String(i), missingId: e.assetId }); });
  for (const a of state.assets) {
    if (!(a.isCompanion === true && a.companionType === 'retail')) continue;
    const hosts = a.retailHostAssetIds ?? [];
    if (hosts.length > 0 && hosts.every((h) => !assetIds.has(h))) repairs.push({ kind: 'orphan-strip', ownerId: a.id, missingId: hosts.join(',') });
  }
  if (repairs.length === 0) return { state, repairs, changed: false };

  const broken = new Set(repairs.filter((r) => r.kind === 'asset-plot').map((r) => r.ownerId));
  const deadStrips = new Set(repairs.filter((r) => r.kind === 'orphan-strip').map((r) => r.ownerId));
  const gone = (id: string): boolean => !assetIds.has(id) || deadStrips.has(id);
  const assets = state.assets.filter((a) => !deadStrips.has(a.id)).map((a) => {
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
  const next: T = { ...state, assets };
  if (state.subUnits) next.subUnits = state.subUnits.filter((u) => !gone(u.assetId));
  if (state.costOverrides) next.costOverrides = state.costOverrides.filter((o) => !gone(o.assetId));
  if (state.costLines) next.costLines = state.costLines.filter((cl) => cl.targetAssetId === undefined || !gone(cl.targetAssetId));
  if (state.financingTranches) next.financingTranches = state.financingTranches.map((t) => (t.assetId !== undefined && gone(t.assetId) ? { ...t, assetId: undefined } : t));
  if (state.equityContributions) next.equityContributions = state.equityContributions.map((e) => (e.assetId !== undefined && gone(e.assetId) ? { ...e, assetId: undefined } : e));
  return { state: next, repairs, changed: true };
}

// ── THE CASCADE (2026-09-12) ─────────────────────────────────────────────
//
// Founder: "delete a plot or an asset and everything depending on it should
// adjust, without me hunting for leftovers". Removing an asset takes its
// Operate companion, its sub-units, its per-asset cost lines and overrides,
// detaches it from its retail strip (and removes the strip when it was the
// last host), clears a tranche or equity scope that named it, and drops the
// scenario overrides written against it. Removing a plot removes every asset
// drawing from it through the same rule, then the plot. ONE rule for both,
// so the two deletes cannot leave different leftovers.

export interface CascadeReport {
  assetIds: string[];
  subUnits: number;
  costLines: number;
  costOverrides: number;
  stripsRemoved: string[];
  stripsDetached: string[];
  tranchesRescoped: number;
  equityRescoped: number;
  overridePathsDropped: number;
}

export function cascadeAssetRemoval<T extends IntegrityState>(state: T, ids: readonly string[]): { state: T; report: CascadeReport } {
  const removed = new Set<string>(ids);
  // Operate companions go with their parent.
  for (const a of state.assets) if (a.parentAssetId !== undefined && removed.has(a.parentAssetId)) removed.add(a.id);
  // A retail strip loses the hosts that go; with none left it goes too.
  const stripsRemoved: string[] = [];
  const stripsDetached: string[] = [];
  const assets = state.assets
    .map((a) => {
      if (!(a.isCompanion === true && a.companionType === 'retail') || removed.has(a.id)) return a;
      const hosts = a.retailHostAssetIds ?? [];
      const kept = hosts.filter((h) => !removed.has(h));
      if (kept.length === hosts.length) return a;
      if (kept.length === 0 && hosts.length > 0) { removed.add(a.id); stripsRemoved.push(a.id); return a; }
      stripsDetached.push(a.id);
      return { ...a, retailHostAssetIds: kept };
    })
    .filter((a) => !removed.has(a.id));
  const subUnits = (state.subUnits ?? []).filter((u) => !removed.has(u.assetId));
  const costLines = (state.costLines ?? []).filter((c) => c.targetAssetId === undefined || !removed.has(c.targetAssetId));
  const costOverrides = (state.costOverrides ?? []).filter((o) => !removed.has(o.assetId));
  let tranchesRescoped = 0, equityRescoped = 0, overridePathsDropped = 0;
  const financingTranches = (state.financingTranches ?? []).map((t) => (t.assetId !== undefined && removed.has(t.assetId) ? (tranchesRescoped += 1, { ...t, assetId: undefined }) : t));
  const equityContributions = (state.equityContributions ?? []).map((e) => (e.assetId !== undefined && removed.has(e.assetId) ? (equityRescoped += 1, { ...e, assetId: undefined }) : e));
  // Scenario overrides are keyed by path, `assets[id=<id>]...` and
  // `subUnits[id=<id>]...`: an override against a row that no longer exists
  // is a reference to nothing.
  const deadSubUnits = new Set((state.subUnits ?? []).filter((u) => removed.has(u.assetId)).map((u) => u.id));
  const isDeadPath = (path: string): boolean => {
    const m = /^(assets|subUnits)\[id=([^\]]+)\]/.exec(path);
    if (!m) return false;
    return m[1] === 'assets' ? removed.has(m[2]) : deadSubUnits.has(m[2]);
  };
  const cases = (state.cases ?? []).map((c) => {
    const o = c.overrides;
    if (!o) return c;
    const keys = Object.keys(o).filter(isDeadPath);
    if (keys.length === 0) return c;
    overridePathsDropped += keys.length;
    const rest: Record<string, unknown> = { ...o };
    for (const k of keys) delete rest[k];
    return { ...c, overrides: rest };
  });
  const next: T = { ...state, assets };
  if (state.subUnits) next.subUnits = subUnits;
  if (state.costLines) next.costLines = costLines;
  if (state.costOverrides) next.costOverrides = costOverrides;
  if (state.financingTranches) next.financingTranches = financingTranches;
  if (state.equityContributions) next.equityContributions = equityContributions;
  if (state.cases) next.cases = cases;
  return {
    state: next,
    report: {
      assetIds: [...removed],
      subUnits: (state.subUnits ?? []).length - subUnits.length,
      costLines: (state.costLines ?? []).length - costLines.length,
      costOverrides: (state.costOverrides ?? []).length - costOverrides.length,
      stripsRemoved, stripsDetached, tranchesRescoped, equityRescoped, overridePathsDropped,
    },
  };
}

/** One line per repair, for the console and the change record. */
export function describeRepairs(repairs: readonly IntegrityRepair[]): string[] {
  return repairs.map((r) => {
    switch (r.kind) {
      case 'asset-plot': return `asset ${r.ownerId} pointed at plot ${r.missingId}, which no longer exists; the plot reference was cleared`;
      case 'orphan-sub-unit': return `sub-unit ${r.ownerId} belonged to asset ${r.missingId}, which no longer exists; it was removed`;
      case 'orphan-override': return `cost override ${r.ownerId} named asset ${r.missingId}, which no longer exists; it was removed`;
      case 'orphan-line': return `cost line ${r.ownerId} targeted asset ${r.missingId}, which no longer exists; it was removed`;
      case 'orphan-strip': return `retail strip ${r.ownerId} had no host left (${r.missingId}); it was removed`;
      case 'tranche-scope': return `facility ${r.ownerId} was scoped to asset ${r.missingId}, which no longer exists; it finances its phase now`;
      case 'equity-scope': return `equity contribution ${r.ownerId} was scoped to asset ${r.missingId}, which no longer exists; it is phase-wide now`;
      default: return `${r.kind} ${r.ownerId} -> ${r.missingId}`;
    }
  });
}
