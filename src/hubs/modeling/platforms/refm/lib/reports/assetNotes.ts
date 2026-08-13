/**
 * assetNotes.ts (REFM)
 *
 * A zero that is a FACT about the model, told apart from a zero that is
 * missing data.
 *
 * WHY THIS FILE EXISTS. Two assets on a live project reported 0 sqm of
 * built-up area in the asset composition table, and zero cost with a 100%
 * margin in per-asset economics. Both figures are correct and neither is an
 * input anyone forgot to fill in:
 *
 *   HOTEL PHASE 1 is an existing operational asset. There is no new build, so
 *   there is no built-up area to report on the forward model, and its 3,682.1m
 *   of development cost was spent before the model starts and sits in
 *   historical pre-capex rather than in any capex line. Per-asset economics
 *   counts forward capex, so cost reads zero and every unit of revenue looks
 *   like margin.
 *
 *   RESIDENTIAL TOWER - OPERATE is a companion asset. Its built-up area and
 *   its development cost both sit on its parent, Residential Tower, which is
 *   what a companion IS: the same building, run under a second strategy.
 *   Double-counting either would overstate the project.
 *
 * Beside six assets reporting real areas of 84,297 to 2,907 sqm, a bare 0
 * reads as a gap in the model. So the zero is replaced by a marker and the
 * reason is named in a footnote under the table.
 *
 * THE RULE IS SHARED because the same two assets appear with the same zeros in
 * the executive summary composition table, the assets input table, per-asset
 * economics, the workbook and both PDFs. Written per surface it would have
 * been written five times and would have disagreed by the second one.
 *
 * ONLY AN ACTUAL ZERO IS MARKED. A companion that does carry its own area
 * prints that area; nothing here suppresses a real figure.
 *
 * PURE: project state in, markers and sentences out.
 *
 * No em dashes in this file.
 */
import type { FinancialsResolverState } from '../financials-resolvers';

/** Why an asset's zero is structural. */
export type StructuralZeroKind = 'companion' | 'existing_operations';

export interface AssetStructuralZero {
  kind: StructuralZeroKind;
  /** The footnote marker, e.g. '[a]'. Assigned per document, in the order the
   *  reasons first appear, so the footnote list reads top down. */
  marker: string;
  /** The footnote sentence, naming the parent or the historical amount. */
  reason: string;
}

/** The value a marked cell prints in place of the zero: a dash carrying the
 *  footnote marker. Deliberately NOT a bare en-dash, which already means
 *  "rounds to zero at the displayed precision" everywhere in these exports. */
export function structuralZeroCell(z: AssetStructuralZero): string {
  return `- ${z.marker}`;
}

type AssetLike = FinancialsResolverState['assets'][number];

/** Historical spend that happened before the model's first period. */
function historicalPreCapex(asset: AssetLike): number {
  return Number((asset as { historicalPreCapex?: number }).historicalPreCapex ?? 0);
}

/**
 * Why this asset's zeros are structural, or null when they are not.
 *
 * Detection is on the asset's OWN declared shape, never on the zero itself: a
 * companion is a companion because `isCompanion` says so, not because a number
 * came out as zero. That ordering matters, or a genuinely empty asset would be
 * quietly explained away as a companion.
 */
export function structuralZeroKindFor(asset: AssetLike): StructuralZeroKind | null {
  if ((asset as { isCompanion?: boolean }).isCompanion === true) return 'companion';
  const status = (asset as { status?: string }).status;
  if (status === 'operational' && historicalPreCapex(asset) > 0) return 'existing_operations';
  return null;
}

/** The reason sentence for a kind, naming the parent or the historical amount. */
function reasonFor(
  kind: StructuralZeroKind,
  asset: AssetLike,
  state: FinancialsResolverState,
  money: (v: number) => string,
): string {
  if (kind === 'companion') {
    const parentId = (asset as { parentAssetId?: string }).parentAssetId;
    const parent = state.assets.find((a) => a.id === parentId);
    const named = parent ? `its parent asset, ${parent.name}` : 'its parent asset';
    return `Companion asset: it runs a second strategy over the SAME building, so its built-up area and its development cost are reported on ${named} and are not repeated here. A figure in these columns would double count the project.`;
  }
  const spent = historicalPreCapex(asset);
  return `Existing operational asset: there is no new build, so it reports no built-up area, and its development cost of ${money(spent)} was incurred before the model starts. That spend sits in historical pre-capex, not in any capex line, which is why cost reads nil and revenue reads as all margin here.`;
}

export interface AssetNoteSet {
  /** Per asset id, when that asset's zeros are structural. */
  byAssetId: Map<string, AssetStructuralZero>;
  /** Every footnote this project could raise, in marker order. */
  allFootnotes: Array<{ marker: string; text: string }>;
  /** The marker for a BUA cell that is structurally nil, else null. */
  hasBuaNote: (assetId: string, bua: number) => AssetStructuralZero | null;
  /** The marker for a cost / margin cell that is structurally nil, else null. */
  hasCostNote: (assetId: string, cost: number) => AssetStructuralZero | null;
  /**
   * The footnotes a table actually raised, clearing the tally for the next one.
   *
   * Call it immediately after building a table's rows. A marker that never
   * appeared in a cell must not appear underneath it: a companion that does
   * carry its own area raises nothing, and printing its footnote anyway would
   * be a note explaining a number that is not there.
   */
  takeFootnotes: () => Array<{ marker: string; text: string }>;
}

const MARKERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/**
 * The structural-zero notes for a project, with markers assigned once so every
 * table in the same document uses the same letter for the same reason.
 *
 * `money` formats the historical pre-capex figure, so the footnote is quoted at
 * the surface's own display scale.
 *
 * Takes no snapshot on purpose: whether a zero is structural is a fact about
 * how the asset is DECLARED, not about what the engine computed. Reading it
 * off the computed zero would explain away a genuinely empty asset.
 */
export function buildAssetNotes(
  state: FinancialsResolverState,
  money: (v: number) => string,
): AssetNoteSet {
  const byAssetId = new Map<string, AssetStructuralZero>();
  const footnotes: Array<{ marker: string; text: string }> = [];
  const markerByKind = new Map<StructuralZeroKind, string>();

  for (const asset of state.assets) {
    if (asset.visible === false) continue;
    const kind = structuralZeroKindFor(asset);
    if (!kind) continue;
    let marker = markerByKind.get(kind);
    if (!marker) {
      marker = `[${MARKERS[markerByKind.size] ?? String(markerByKind.size + 1)}]`;
      markerByKind.set(kind, marker);
      footnotes.push({ marker, text: '' });
    }
    byAssetId.set(asset.id, { kind, marker, reason: reasonFor(kind, asset, state, money) });
  }

  // The footnote text is the reason from the FIRST asset carrying that kind,
  // which is what names the parent or the amount. Filled after the loop so a
  // second companion does not append a second identical footnote.
  for (const fn of footnotes) {
    const first = [...byAssetId.values()].find((z) => z.marker === fn.marker);
    fn.text = first ? `${fn.marker} ${first.reason}` : fn.marker;
  }

  const nonZero = (v: number): boolean => Math.abs(v) > 1e-6;
  const used = new Set<string>();
  const raise = (assetId: string, value: number): AssetStructuralZero | null => {
    if (nonZero(value)) return null;
    const z = byAssetId.get(assetId);
    if (!z) return null;
    used.add(z.marker);
    return z;
  };
  return {
    byAssetId,
    allFootnotes: footnotes,
    hasBuaNote: raise,
    hasCostNote: raise,
    takeFootnotes: () => {
      const out = footnotes.filter((f) => used.has(f.marker));
      used.clear();
      return out;
    },
  };
}
