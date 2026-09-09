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

// ── THE LAND CARVE-OUT (step 5, the first step that moves money) ──────────

/** One host, with the chain figures the carve needs and what it draws today. */
export interface RetailLandHost {
  assetId: string;
  /** The plot it draws from, so the companion draws from the same one. */
  parcelId?: string;
  /** Sqm/rate as resolved BEFORE any carve. */
  grossSqm: number;
  rate: number;
  /** From the chain, already computed: the share is retail over total. */
  retailGfaSqm?: number;
  totalGfaSqm?: number;
}

export interface RetailLandHostResult {
  assetId: string;
  /** retailGFA / totalGFA. Zero when the chain cannot derive both. */
  share: number;
  grossSqm: number;
  carvedSqm: number;
  netSqm: number;
  rate: number;
  carvedValue: number;
  netValue: number;
}

export interface RetailLandCarve {
  hosts: RetailLandHostResult[];
  /** What the companion gains: exactly what the hosts lose. */
  companionSqm: number;
  companionValue: number;
  /** One entry per contributing plot, which is what the engine's existing
   *  multi-parcel branch reads. */
  companionSplits: Array<{ parcelId: string; sqm: number; rate: number; value: number }>;
  /** Sum of what the hosts lost, kept separately from what the companion
   *  gained so a caller can compare the two rather than trust one. */
  hostsLostSqm: number;
  hostsLostValue: number;
}

/**
 * BOTH HALVES OF THE CARVE, FROM ONE FUNCTION.
 *
 * The retail companion holds floor area that sits ON its hosts' land, so it
 * must take a share of that land and every host must lose EXACTLY what it
 * gains. Computing the two halves in two places is how a project total keeps
 * footing while the individual assets are wrong, which is the failure mode this
 * shape exists to prevent: the giving and the taking are one arithmetic.
 *
 * THE SHARE IS RETAIL GFA OVER TOTAL GFA, per host, which is the reference's
 * own carve (plot land value x retail GFA / total GFA, pinned to the cent on
 * two types). It is taken from the CHAIN RESULTS rather than restated as a
 * formula here, so there is one definition of what retail GFA is. Note the land
 * cancels out of that ratio, since both halves are proportional to it, so the
 * share is a property of the plot's massing and not of its size.
 *
 * PER PLOT, AT THAT PLOT'S OWN RATE. A line pooling two plots at different
 * rates carves from each at its own rate, which is why the companion gets
 * SPLITS rather than a blended sqm: a blended rate would make the companion's
 * value depend on which plot it was written against.
 *
 * A HOST WHOSE CHAIN CANNOT DERIVE RETAIL GIVES UP NOTHING, and its share is
 * reported as 0 rather than omitted, so a caller can show a host that
 * contributes no land beside one that does.
 */
export function carveRetailLand(hosts: readonly RetailLandHost[]): RetailLandCarve {
  const results: RetailLandHostResult[] = [];
  const byParcel = new Map<string, { sqm: number; rate: number; value: number }>();
  for (const h of hosts) {
    const retail = pos(h.retailGfaSqm);
    const total = pos(h.totalGfaSqm);
    const share = total > 0 ? retail / total : 0;
    const gross = Math.max(0, Number.isFinite(h.grossSqm) ? h.grossSqm : 0);
    const rate = Math.max(0, Number.isFinite(h.rate) ? h.rate : 0);
    // NO PLOT, NO CARVE. A host drawing from a weighted average or a custom
    // rate has no parcel for the companion to take a slice OF, so it gives up
    // nothing: carving there would take land from a host that the companion
    // could not be credited with, and the two halves would stop matching. That
    // is the exact failure this function exists to make impossible.
    const carvedSqm = h.parcelId ? gross * share : 0;
    results.push({
      assetId: h.assetId,
      share,
      grossSqm: gross,
      carvedSqm,
      netSqm: gross - carvedSqm,
      rate,
      carvedValue: carvedSqm * rate,
      netValue: (gross - carvedSqm) * rate,
    });
    if (carvedSqm <= 0 || !h.parcelId) continue;
    const cur = byParcel.get(h.parcelId) ?? { sqm: 0, rate, value: 0 };
    byParcel.set(h.parcelId, {
      sqm: cur.sqm + carvedSqm,
      rate,
      value: cur.value + carvedSqm * rate,
    });
  }
  const companionSplits = [...byParcel.entries()]
    .map(([parcelId, v]) => ({ parcelId, sqm: v.sqm, rate: v.rate, value: v.value }));
  return {
    hosts: results,
    companionSqm: companionSplits.reduce((s, x) => s + x.sqm, 0),
    companionValue: companionSplits.reduce((s, x) => s + x.value, 0),
    companionSplits,
    // MEASURED SEPARATELY, ON PURPOSE. A caller comparing these against the
    // companion figures is checking the arithmetic rather than reading the same
    // number twice under two names.
    hostsLostSqm: results.reduce((s, r) => s + r.carvedSqm, 0),
    hostsLostValue: results.reduce((s, r) => s + r.carvedValue, 0),
  };
}
