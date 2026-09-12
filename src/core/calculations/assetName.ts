/**
 * assetName.ts (2026-09-08, rewritten 2026-09-10)
 *
 * WHAT AN ASSET IS CALLED, in one place.
 *
 * THE MANUAL NAME IS RETIRED. It was optional and fell back to the type, which
 * was already an admission that five plots of Branded Villas with five invented
 * names is a user typing five identities for one thing. It went further than
 * that: the schedules group by TYPE and merge those plots, so the names vanish
 * from the output with nothing saying why, and two plots called different
 * things read as two different buildings in a table that has already added them
 * together. An asset is identified by WHERE it is and WHAT it is.
 *
 * SO THE LABEL IS DERIVED, and it is derived from four things:
 *
 *   THE PLOT, when the asset draws from one: "Land 1, Branded Villas". Three
 *   plots of one type stay distinguishable because the plot distinguishes them.
 *
 *   THE PHASE, when it does not. Measured before choosing this: most assets
 *   have NO plot. On one live project 7 of 8 draw from a weighted-average or
 *   custom-rate sentinel, and `assetTableModel`'s own header records 6,860 of
 *   9,399 historical rows in that state. A label of "(no plot)" repeated seven
 *   times is not a label, so the phase takes the plot's place.
 *
 *   THE PHASE AGAIN, as a suffix, when the project has more than one and the
 *   plot alone would not separate two assets. Two live collisions were exactly
 *   this: Branded Residences in phases 2 and 3, Strip Retail in phases 2 and 3.
 *
 *   A COMPANION MARKER, because a Sell asset and its Operate companion share a
 *   type, a phase and a plot and differ only in treatment. That was the fourth
 *   live collision and the only one phase could not break.
 *
 * NOTHING STORED IS REWRITTEN. `Asset.name` stays declared and stored, and
 * sixteen live assets still carry the name someone typed; nothing reads it.
 * Retiring rather than deleting costs nothing and keeps the evidence.
 *
 * Pure. No imports. No em dashes in this file.
 */

/** The last resort, when an asset has neither a plot, a phase nor a type. */
export const UNNAMED_ASSET = 'Unnamed asset';

/** The shape this needs. Structural, so core stays free of platform imports. */
export interface NameableAsset {
  /** RETIRED 2026-09-10: stored, never read. See the header. */
  name?: string;
  type?: string;
  phaseId?: string;
  landAllocation?: { parcelId?: string };
  isCompanion?: boolean;
  companionType?: string;
  strategy?: string;
}

/**
 * Where the label gets the plot and phase names. Passed IN rather than looked
 * up, so this file stays pure and every caller states which project's plots it
 * means. REQUIRED, deliberately: an optional context is a defect waiting for
 * one caller to omit it and silently produce a shorter label than its
 * neighbour (docs/TRAPS.md 7.7).
 */
export interface AssetLabelContext {
  parcels: readonly { id: string; name?: string }[];
  phases: readonly { id: string; name?: string }[];
}

/** A sentinel parcel id is not a plot: it says "weighted average" or "custom
 *  rate", which is the absence of one. Kept here rather than imported so this
 *  file has no dependencies; the platform's `isParcelSentinel` agrees. */
function realParcelId(asset: NameableAsset): string | undefined {
  const id = asset.landAllocation?.parcelId;
  if (typeof id !== 'string' || id === '') return undefined;
  return id.startsWith('__') ? undefined : id;
}

/** The marker that separates a companion from the asset it accompanies. */
function companionMarker(asset: NameableAsset): string | undefined {
  if (asset.isCompanion !== true) return undefined;
  if (asset.companionType === 'retail') return 'Retail';
  // The Operate companion of a Sell + Manage parent: same type, same phase,
  // same plot, and only the treatment differs.
  return 'Operate';
}

/**
 * WHAT TO CALL THIS ASSET: where it is, then what it is, then what separates it
 * from anything that would otherwise read the same.
 *
 * "Land 1, Branded Villas"
 * "Phase 2, Branded Residences"          (no plot: a sentinel draw)
 * "Land 1, Branded Villas, Phase 2"      (multi-phase project, plot reused)
 * "Phase 2, High-end Apartments (Operate)"
 */
export function assetLabel(asset: NameableAsset, ctx: AssetLabelContext): string {
  const type = (asset.type ?? '').trim();
  const parcelId = realParcelId(asset);
  const parcel = parcelId === undefined ? undefined : ctx.parcels.find((p) => p.id === parcelId);
  const plotName = (parcel?.name ?? '').trim();
  const phase = ctx.phases.find((p) => p.id === asset.phaseId);
  const phaseName = (phase?.name ?? '').trim();
  const multiPhase = ctx.phases.length > 1;

  const head = plotName !== '' ? plotName : phaseName;
  const parts: string[] = [];
  if (head !== '') parts.push(head);
  if (type !== '') parts.push(type);
  // The phase EARNS its place only when it adds something: a project with one
  // phase repeats it on every row for nothing, and an asset already led by its
  // phase does not need it twice.
  if (multiPhase && plotName !== '' && phaseName !== '') parts.push(phaseName);
  if (parts.length === 0) return UNNAMED_ASSET;
  const marker = companionMarker(asset);
  return marker === undefined ? parts.join(', ') : `${parts.join(', ')} (${marker})`;
}

/**
 * WHAT SEPARATES AN ASSET FROM THE LINE IT SITS ON (2026-09-12).
 *
 * A consolidated line already states the phase and the type, so an asset
 * nested under it needs to say only what the line does not: which PLOT it
 * draws from. Returns undefined when it has nothing to add, which is an asset
 * with no plot, and a caller then has a heading it should not print: the full
 * label there would repeat the line with a different separator ("Phase 2:
 * Branded Residences" above "Phase 2, Branded Residences"), which is every
 * block on a project whose assets draw from a sentinel.
 *
 * It reads the SAME plot the label reads, through the same sentinel rule, so
 * the two can never disagree about whether an asset has one.
 */
export function assetPlotLabel(asset: NameableAsset, ctx: AssetLabelContext): string | undefined {
  const parcelId = realParcelId(asset);
  if (parcelId === undefined) return undefined;
  const name = (ctx.parcels.find((p) => p.id === parcelId)?.name ?? '').trim();
  if (name === '') return undefined;
  const marker = companionMarker(asset);
  return marker === undefined ? name : `${name} (${marker})`;
}

/**
 * Every asset in a list, with its label written into `name`.
 *
 * ONE CALL AT AN EXPORT'S FRONT DOOR beats editing every read behind it. The
 * Excel workbook alone reads an asset name in 26 places, and several were MAP
 * KEYS rather than labels; those move to `assetId` in the same change as this
 * rewrite, because a label that can repeat is not an identity.
 *
 * The copy is shallow and the snapshot is untouched: a read-time view, never
 * written back.
 */
export function withResolvedAssetNames<T extends NameableAsset>(
  assets: readonly T[],
  ctx: AssetLabelContext,
): T[] {
  return assets.map((a) => ({ ...a, name: assetLabel(a, ctx) }));
}
