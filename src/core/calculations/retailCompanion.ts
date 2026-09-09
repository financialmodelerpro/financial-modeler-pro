/**
 * retailCompanion.ts (2026-09-09, consolidation step 4)
 *
 * GROUND-FLOOR RETAIL IS AN ASSET, NOT A COLUMN.
 *
 * The area chain derives a Retail GFA for every plot with a ground-floor retail
 * share, and until now that was where it stopped: a figure in a read-only
 * table, feeding nothing. It is a different BUILDING from the one above it, in
 * the commercial sense that matters here: the developer SELLS the apartments
 * and HOLDS the shops. Those are two strategies, so they are two assets. The
 * host stays Sell and its cost goes to cost of sales; the retail is Lease, so
 * it capitalises as a fixed asset and earns rent.
 *
 * ONE PER LINE, NOT ONE PER PLOT. A line is one type in one phase; four plots
 * of Branded Villas with ground-floor retail are one retail line, because that
 * is how the schedules read the project and a landlord does not hold four
 * separate strips because the podium happens to sit on four title deeds. The
 * areas POOL, which needs no rule: the chain has already run per plot (it must,
 * since massing is a property of ground) and floor areas add.
 *
 * COSTED AT ZERO IN THIS STEP, and that is not a stub. `computeAssetCost`
 * short-circuits any `isCompanion` asset to an explicit empty breakdown before
 * a single cost line is resolved, and `computeAssetLandSqm` gives it no land
 * (Rule 2). So the retail companion cannot charge anything, and the engine is
 * byte-identical with it present. The land carve-out and the cost lines are
 * later steps; this one only makes the asset exist.
 *
 * REUSES THE EXISTING COMPANION MECHANISM rather than adding a second one:
 * the same `isCompanion` flag every engine, resolver, report and export already
 * knows, discriminated by `companionType` so a retail companion never picks up
 * the Operate companion's behaviour (it mirrors no sub-units and inherits no
 * ADR).
 *
 * PURE, AND IT IMPORTS NOTHING. It takes chain results that have already been
 * computed and returns a description; nothing here runs the chain, reads a
 * store or builds an Asset. No em dashes in this file.
 */

/** What one host plot contributes: the chain's retail figures, already derived. */
export interface RetailHostChain {
  assetId: string;
  /** Building Footprint x Retail % (ground floor). Absent when not derivable. */
  retailGfaSqm?: number;
  /** Retail GFA / its own area per slot. Absent without that figure. */
  retailParkingAreaSqm?: number;
  /** The slot count behind that area, carried for the same reason. */
  retailParkingSlots?: number;
}

/** One line, and the plots under it. */
export interface RetailLineInput {
  /** The consolidation key: one type in one phase. */
  key: string;
  phaseId: string;
  /** What the line is called, which is its type. */
  typeLabel: string;
  hosts: readonly RetailHostChain[];
}

/** Everything the factory needs to mint or refresh one retail companion. */
export interface RetailCompanionSpec {
  id: string;
  lineKey: string;
  phaseId: string;
  typeLabel: string;
  /** Every plot contributing retail, in line order. */
  hostAssetIds: string[];
  retailGfaSqm: number;
  retailParkingAreaSqm: number;
  retailParkingSlots: number;
}

/**
 * A DETERMINISTIC ID, DERIVED FROM THE LINE.
 *
 * Not minted from a clock: the companion is not a thing a user creates, it is a
 * thing the line HAS, so re-deriving it must find the same asset rather than
 * make a second one. The line key is `phase|type`, and `|` is replaced because
 * an id ends up in DOM attributes and test ids.
 */
export function retailCompanionId(lineKey: string): string {
  return `retail_${lineKey.replace(/[^A-Za-z0-9_-]+/g, '__')}`;
}

/** True when this asset is a retail companion, asked in ONE place. */
export function isRetailCompanion(
  a: { isCompanion?: boolean; companionType?: string },
): boolean {
  return a.isCompanion === true && a.companionType === 'retail';
}

const pos = (v: number | undefined): number =>
  (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * One spec per line that actually builds retail.
 *
 * A LINE WITH NO RETAIL GETS NO COMPANION, which is the whole of the
 * create-and-remove rule: the reconcile below drops a companion whose line has
 * stopped deriving retail, so setting Retail % back to zero removes the asset
 * rather than leaving an empty Lease row on the model forever.
 *
 * Retail PARKING may be absent while retail GFA is present (it needs the retail
 * area-per-slot figure, which is its own input). That is not a reason to
 * withhold the companion: the shops exist whether or not anyone has said how
 * much parking they need, and a zero there is honest.
 */
export function buildRetailCompanionSpecs(
  lines: readonly RetailLineInput[],
): RetailCompanionSpec[] {
  const out: RetailCompanionSpec[] = [];
  for (const line of lines) {
    const contributing = line.hosts.filter((h) => pos(h.retailGfaSqm) > 0);
    if (contributing.length === 0) continue;
    out.push({
      id: retailCompanionId(line.key),
      lineKey: line.key,
      phaseId: line.phaseId,
      typeLabel: line.typeLabel,
      hostAssetIds: contributing.map((h) => h.assetId),
      retailGfaSqm: contributing.reduce((s, h) => s + pos(h.retailGfaSqm), 0),
      // Pooled from the SAME hosts, so a plot that contributes no retail GFA
      // cannot contribute retail parking either.
      retailParkingAreaSqm: contributing.reduce((s, h) => s + pos(h.retailParkingAreaSqm), 0),
      retailParkingSlots: contributing.reduce((s, h) => s + pos(h.retailParkingSlots), 0),
    });
  }
  return out;
}

/**
 * The shape this needs from an asset. Structural, so core stays import-free.
 *
 * NO INDEX SIGNATURE. One would let this accept anything and, worse, stop the
 * generic below inferring the caller's own Asset type, so the reconcile would
 * hand back a widened array the store could not assign. It needs three fields;
 * it asks for three fields.
 */
export interface ReconcilableAsset {
  id: string;
  isCompanion?: boolean;
  companionType?: string;
}

export interface RetailReconcile<T> {
  assets: T[];
  /** True when anything was added, removed or changed. */
  changed: boolean;
  added: string[];
  removed: string[];
  updated: string[];
}

/**
 * Bring the stored retail companions into line with what the lines derive.
 *
 * SELF-HEALING, LIKE THE OPERATE COMPANION SYNC IT SITS BESIDE: add what is
 * missing, drop what no longer has retail, refresh what moved, and return the
 * SAME array when nothing changed so a caller can skip a write. A companion is
 * identified by its id, which is derived from the line, so a line that is
 * renamed or re-typed produces a different id and the old one is removed rather
 * than silently re-labelled.
 *
 * `apply` builds or refreshes the platform Asset; this file never constructs
 * one, because an Asset is a platform type and this is core.
 */
export function reconcileRetailCompanions<T extends ReconcilableAsset>(
  assets: readonly T[],
  specs: readonly RetailCompanionSpec[],
  apply: (spec: RetailCompanionSpec, existing: T | undefined) => T,
  equal: (a: T, b: T) => boolean,
): RetailReconcile<T> {
  const wanted = new Map(specs.map((s) => [s.id, s] as const));
  const added: string[] = [];
  const removed: string[] = [];
  const updated: string[] = [];
  const out: T[] = [];
  const seen = new Set<string>();
  for (const a of assets) {
    if (!isRetailCompanion(a)) { out.push(a); continue; }
    const spec = wanted.get(a.id);
    if (!spec) { removed.push(a.id); continue; }
    seen.add(a.id);
    const next = apply(spec, a);
    if (equal(a, next)) { out.push(a); continue; }
    updated.push(a.id);
    out.push(next);
  }
  for (const s of specs) {
    if (seen.has(s.id)) continue;
    added.push(s.id);
    out.push(apply(s, undefined));
  }
  const changed = added.length > 0 || removed.length > 0 || updated.length > 0;
  return { assets: changed ? out : (assets as T[]), changed, added, removed, updated };
}

// ── THE COMPANION'S OWN SUB-UNIT ──────────────────────────────────────────

/** The little of a sub-unit this needs. Structural, so core stays import-free. */
export interface ReconcilableSubUnit {
  id: string;
  assetId: string;
}

/** The derived row's id, from the companion's. Deterministic for the same
 *  reason the companion's own id is: re-deriving must find the same row. */
export function retailCompanionSubUnitId(companionId: string): string {
  return `${companionId}__sub`;
}

export interface RetailSubUnitReconcile<U> {
  subUnits: U[];
  changed: boolean;
  added: string[];
  removed: string[];
  updated: string[];
}

/**
 * ONE DERIVED SUB-UNIT PER RETAIL COMPANION, so the strip can be priced.
 *
 * THE CONDITION THAT KEEPS THIS OUT OF THE USER'S WAY: the derived row is
 * refreshed only while it is the companion's ONLY sub-unit. The moment someone
 * adds a second row, the split becomes theirs and this stops touching any of
 * them, because a landlord splitting a strip into an anchor and four inline
 * units is doing something this rule cannot second-guess. It is the same
 * principle as the companion's own name surviving a re-derive, applied to the
 * one place a user would otherwise be fighting the model.
 *
 * A companion whose line stops building retail loses its companion, and the
 * caller drops the orphaned rows with it; this function only removes the
 * DERIVED row when its companion is gone, so a user's own rows are never
 * deleted by a derivation.
 */
export function reconcileRetailSubUnits<U extends ReconcilableSubUnit>(
  subUnits: readonly U[],
  specs: readonly RetailCompanionSpec[],
  build: (companionId: string, retailGfaSqm: number, existing: U | undefined) => U,
  equal: (a: U, b: U) => boolean,
): RetailSubUnitReconcile<U> {
  const byCompanion = new Map<string, U[]>();
  for (const u of subUnits) {
    const list = byCompanion.get(u.assetId) ?? [];
    list.push(u);
    byCompanion.set(u.assetId, list);
  }
  const wanted = new Map(specs.map((s) => [s.id, s] as const));
  const added: string[] = [];
  const removed: string[] = [];
  const updated: string[] = [];
  const out: U[] = [];
  for (const u of subUnits) {
    const derivedId = retailCompanionSubUnitId(u.assetId);
    if (u.id !== derivedId) { out.push(u); continue; }
    const spec = wanted.get(u.assetId);
    // THE DERIVED ROW GOES WHEN ITS COMPANION GOES, and only then.
    if (!spec) { removed.push(u.id); continue; }
    // THE USER HAS TAKEN OVER: more than one row on this companion means the
    // split is theirs, so the derivation steps back rather than overwriting an
    // area they have deliberately reduced.
    if ((byCompanion.get(u.assetId) ?? []).length > 1) { out.push(u); continue; }
    const next = build(u.assetId, spec.retailGfaSqm, u);
    if (equal(u, next)) { out.push(u); continue; }
    updated.push(u.id);
    out.push(next);
  }
  for (const s of specs) {
    const rows = byCompanion.get(s.id) ?? [];
    // Nothing at all on this companion: seed the one derived row. A companion
    // that already has rows (the user built their own) is left alone.
    if (rows.length > 0) continue;
    added.push(retailCompanionSubUnitId(s.id));
    out.push(build(s.id, s.retailGfaSqm, undefined));
  }
  const changed = added.length > 0 || removed.length > 0 || updated.length > 0;
  return { subUnits: changed ? out : (subUnits as U[]), changed, added, removed, updated };
}
