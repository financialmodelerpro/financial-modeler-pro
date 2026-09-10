/**
 * assetTableModel.ts (2026-09-07, land planning step 3)
 *
 * How the Assets table GROUPS and CHECKS, as pure functions.
 *
 * PRESENTATION ONLY. Every number here comes from the existing engine
 * helpers (`computeAssetLandSqm`, `computeLandLandChain` is not involved);
 * this file decides which asset appears under which plot and whether a plot's
 * assets add up. Nothing in the calculation engine calls it, and it computes
 * no model value of its own.
 *
 * A PLOT IS A PARCEL. The reference workbook is one flat table whose rows
 * carry a cluster column; this platform groups the rows under the plot they
 * draw from, which is the same information with the repetition removed, plus
 * the one thing the flat table cannot show: whether a plot is fully drawn.
 *
 * AN ASSET BELONGS TO EXACTLY ONE PLOT (2026-09-08). Two plots for one
 * building is modelled by merging the plots or by splitting the building into
 * two assets, which is the same model with one less special case. Measured
 * before removing it: across 1406 stored versions and 9399 asset rows, ZERO
 * used a multi-parcel split, so nothing live was lost.
 *
 * TWO THINGS AN ASSET CAN BE:
 *   - drawn from ONE parcel: it sits under that plot, and the plot's check is
 *     a simple sum of the assets under it.
 *   - drawn from NO specific parcel (a weighted-average or custom-rate
 *     sentinel, or nothing at all): it sits in a final group of its own
 *     rather than being hidden or silently attached to plot one. This is not
 *     an edge case: 6860 of those 9399 rows are on a sentinel.
 *
 * No em dashes in this file.
 */

import { resolveAssetPlotDraw, resolveSubUnitMetric } from '@/src/core/calculations';
import type { SubUnit as SubUnitForMetric } from '../../../lib/state/module1-types';
import { groupAssetsForConsolidation, type NormaliseTypeId } from '@/src/core/calculations/consolidation';
import { poolLineAreas } from '@/src/core/calculations/consolidatedLine';
import type { Asset, Parcel } from '../../../lib/state/module1-types';
import { isParcelSentinel } from '../../../lib/state/module1-types';

/** The bucket for assets that name no real parcel. Not a parcel id, and
 *  deliberately not a valid one, so it can never collide. */
export const UNPLOTTED_GROUP = '__unplotted__';

export interface AssetPlotGroup {
  /** The parcel id, or UNPLOTTED_GROUP. */
  key: string;
  parcel?: Parcel;
  assets: Asset[];
  /** The parcel's own area, when this group is a real parcel. */
  parcelAreaSqm?: number;
  /** What the assets under this plot draw from it. A plain sum, now that an
   *  asset belongs to exactly one plot. */
  allocatedSqm: number;
  /** parcelArea - allocated. Positive means the plot is not fully drawn;
   *  negative means it is over-drawn. Absent for the unplotted group, which
   *  has no area to check against. */
  remainingSqm?: number;
  /** 'ok' within half a sqm, else 'under' or 'over'. Absent for unplotted. */
  status?: 'ok' | 'under' | 'over';
}

/** How much of ONE parcel an asset draws: its explicit sqm when it names that
 *  parcel, and nothing otherwise. An asset naming no real parcel draws nothing
 *  FROM A NAMED PLOT, which is exactly what puts it in the unplotted group. */
/**
 * THE CHECK MUST SUM WHAT THE ENGINE DRAWS, not the raw stored field.
 *
 * This read `landAllocation.sqm` directly, so it was a THIRD answer to "how
 * much does this asset take from this plot", beside the two in the engine. It
 * reported a plot as under-drawn while the engine drew the whole thing, which
 * is worse than either number being wrong: the check that exists to catch a
 * mismatch was itself the mismatch. It now delegates to the one rule.
 */
export function assetDrawFromParcel(
  asset: Asset,
  parcelId: string,
  parcels: readonly Parcel[],
  assets: readonly Asset[],
): number {
  const named = asset.landAllocation?.parcelId;
  if (named !== parcelId || isParcelSentinel(named)) return 0;
  const draw = resolveAssetPlotDraw(asset, parcels as Parcel[], assets as Asset[]);
  return draw ? draw.sqm : 0;
}

/** The plot an asset belongs to: the parcel it names, or the unplotted group. */
export function primaryParcelId(asset: Asset): string {
  const named = asset.landAllocation?.parcelId;
  if (named && !isParcelSentinel(named)) return named;
  return UNPLOTTED_GROUP;
}

/**
 * Group the assets under their plots, in parcel order, with the unplotted
 * group last. EVERY parcel appears, including one nothing draws from yet,
 * because an empty plot is a fact worth showing; the unplotted group appears
 * only when something is in it.
 *
 * Companions are excluded: they carry no land of their own (the engine's
 * Rule 2), so filing them under a plot would double-count the check.
 */
export function groupAssetsByPlot(
  assets: readonly Asset[],
  parcels: readonly Parcel[],
): AssetPlotGroup[] {
  const real = assets.filter((a) => a.isCompanion !== true);
  const groups: AssetPlotGroup[] = parcels.map((p) => {
    const mine = real.filter((a) => primaryParcelId(a) === p.id);
    // A SIMPLE SUM OF THE ASSETS UNDER IT, now that an asset belongs to
    // exactly one plot: what is filed here is all that can draw from here.
    const allocatedSqm = mine.reduce((sum, a) => sum + assetDrawFromParcel(a, p.id, parcels, assets), 0);
    const parcelAreaSqm = Math.max(0, p.area);
    const remainingSqm = parcelAreaSqm - allocatedSqm;
    const status: AssetPlotGroup['status'] =
      Math.abs(remainingSqm) < 0.5 ? 'ok' : remainingSqm > 0 ? 'under' : 'over';
    return { key: p.id, parcel: p, assets: mine, parcelAreaSqm, allocatedSqm, remainingSqm, status };
  });

  const unplotted = real.filter((a) => primaryParcelId(a) === UNPLOTTED_GROUP);
  if (unplotted.length > 0) {
    groups.push({ key: UNPLOTTED_GROUP, assets: unplotted, allocatedSqm: 0 });
  }
  return groups;
}

/** One sentence for a plot's check, so the header states the answer rather
 *  than leaving a reader to subtract two numbers. */
export function plotCheckText(g: AssetPlotGroup, fmt: (n: number) => string): string {
  if (g.key === UNPLOTTED_GROUP) {
    return 'These assets do not draw from a specific plot (a weighted average, a custom rate, or no land yet).';
  }
  if (g.status === 'ok') return 'Assets draw exactly this plot\'s area.';
  if (g.status === 'under') return `${fmt(g.remainingSqm ?? 0)} sqm of this plot is not drawn by any asset.`;
  return `Assets draw ${fmt(Math.abs(g.remainingSqm ?? 0))} sqm more than this plot holds.`;
}

/**
 * WHICH SUB-UNITS BELONG TO WHICH CONSOLIDATED LINE.
 *
 * A PURE PARTITION, and it lives here rather than in the tab because the tab's
 * first attempt was a defect that markup could not have shown. That version
 * asked, once per line, "group these sub-units under these assets", handing it
 * the LINE's members but the WHOLE PROJECT's sub-units. The grouping helper's
 * contract is that anything left unmatched is an orphan the user must still be
 * able to reach, so every other line's sub-units came back as an "Unassigned"
 * group under every line: on one live project four sub-units repeated under
 * four headings, on another twelve to fourteen under seven, and every line
 * header printed the same NSA (the project total, 47,500 sqm) because named
 * plus orphans is always the whole project. One wrong argument, three symptoms
 * that each looked like a separate display bug.
 *
 * So the rule is stated once, as a partition: every sub-unit lands in exactly
 * one bucket, the buckets sum to the input, and nothing can appear twice.
 * `stray` holds what belongs to no line (an asset since deleted, or a
 * companion, whose sub-units mirror its parent's and are filtered out by the
 * caller). It is a real bucket, not a leftover: a row nothing shows is a row
 * nobody can delete.
 *
 * PRESENTATION ONLY, like the rest of this file. A sub-unit's `assetId` is
 * untouched; it re-parents onto the line in a later pass, together with the
 * engine's lookup sites and the asset-keyed cost overrides, because a
 * half-moved parent is two answers to one question.
 */
export interface SubUnitLinePartition {
  /** The consolidation key: one type in one phase. */
  key: string;
  phaseId: string;
  typeLabel: string;
  typed: boolean;
  members: Asset[];
  subUnits: SubUnitLike[];
}

/** The little of a sub-unit this partition needs: which asset it hangs off. */
export interface SubUnitLike {
  id: string;
  assetId: string;
}

export function partitionSubUnitsByLine<U extends SubUnitLike>(
  assets: readonly Asset[],
  subUnits: readonly U[],
  phaseIds: readonly string[],
  normaliseTypeId: NormaliseTypeId,
): { lines: Array<SubUnitLinePartition & { subUnits: U[] }>; stray: U[] } {
  const lines = groupAssetsForConsolidation(
    assets as unknown as Parameters<typeof groupAssetsForConsolidation>[0],
    phaseIds,
    normaliseTypeId,
  );
  const claimed = new Set<string>();
  const out = lines.map((line) => {
    const members = line.assets as unknown as Asset[];
    const memberIds = new Set(members.map((m) => m.id));
    const mine = subUnits.filter((u) => memberIds.has(u.assetId));
    for (const u of mine) claimed.add(u.id);
    return {
      key: line.key,
      phaseId: line.phaseId,
      typeLabel: line.typeLabel,
      typed: line.typed,
      members,
      subUnits: mine,
    };
  });
  return { lines: out, stray: subUnits.filter((u) => !claimed.has(u.id)) };
}

// ── WHAT THE SUB-UNITS ARE PARTS OF, and what they add up to ──────────────

export type NsaSource = 'chain' | 'entered' | 'none';

export interface ResolvedNsa {
  value: number;
  source: NsaSource;
}

/**
 * THE WHOLE THAT THE PARTS ARE CHECKED AGAINST.
 *
 * OPT IN, LIKE THE REST OF THE CHAIN. When the area chain is running for a
 * plot it has already worked out that plot's net saleable area, and that is the
 * figure the sub-units are parts of; when it is not, the entered NSA stays the
 * reference exactly as before. The chain is never forced on anyone and never
 * ignored once someone has turned it on.
 *
 * THIS REVERSES A DELIBERATE RULE, so the reason is worth keeping. The check
 * read the ENTERED NSA and nothing else, on the principle that a derivation has
 * no business inside an editing surface. In practice every live asset has an
 * entered NSA of 0, so the check never fired once, on any project: every group
 * read "no NSA entered, so there is nothing to check the parts against" while
 * the chain sat one table above with the answer. A check that cannot fire is
 * not a conservative check, it is an absent one.
 *
 * A CHAIN NSA OF ZERO IS STILL THE CHAIN SPEAKING. It means this plot builds
 * nothing saleable (a full service deduction, say), so parts allocated against
 * it are over-allocated. Falling back to the entered figure there would answer
 * a question the chain has already answered.
 */
export function resolveAssetNsa(
  enteredSqm: number | undefined,
  chainNsaSqm: number | undefined,
): ResolvedNsa {
  if (typeof chainNsaSqm === 'number' && Number.isFinite(chainNsaSqm)) {
    return { value: Math.max(0, chainNsaSqm), source: 'chain' };
  }
  if (typeof enteredSqm === 'number' && Number.isFinite(enteredSqm) && enteredSqm > 0) {
    return { value: enteredSqm, source: 'entered' };
  }
  return { value: 0, source: 'none' };
}

/**
 * WHAT KIND OF PRICE A RATE IS, which is not the same question as what it is
 * PER.
 *
 * A sale price is a CAPITAL value. A lease rate is a value PER YEAR. An ADR is
 * a value PER NIGHT. Dividing any of them by an area gives a number, and only
 * the first two are a thing anyone would call a rate per sqm.
 *
 * FOUND ON LIVE DATA: a hotel line of 140 keys at 850 per room per night
 * blended to "9 per sqm". That is 119,000 a night over 13,300 sqm, so the
 * figure is real and its label is a lie: it is per sqm per NIGHT, presented
 * beside capital values per sqm as though the two could be compared.
 */
export type RateTimeBasis = 'capital' | 'year' | 'night';

/** One sub-unit, reduced to what a total needs. */
export interface SubUnitValueRow {
  areaSqm: number;
  units?: number;
  rate?: number;
  /** True when the rate is charged per unit or key, false when per sqm. */
  perUnit: boolean;
  /** Capital, per year or per night. Absent when the row carries no rate. */
  timeBasis?: RateTimeBasis;
}

export interface PooledSubUnits {
  areaSqm: number;
  units: number;
  value: number;
  /** Value over area. Zero when there is no area, never a division by zero. */
  blendedRate: number;
  /** True when the rows priced here are not all on the same basis, so the
   *  blended rate mixes a price per unit with a price per sqm. That is fine:
   *  both are values, and the pooled figure is a value per sqm either way. */
  mixedBasis: boolean;
  /** How many rows carried a rate at all, so a caption can say what the
   *  blended figure is actually made of. */
  pricedRows: number;
  /** The one time basis every priced row shares, or undefined when they do not
   *  share one. A blend across two of these is not a number. */
  timeBasis?: RateTimeBasis;
  /**
   * Whether the blended figure may be SHOWN.
   *
   * False when there is no rate, no area to divide by, more than one time
   * basis, or a per-NIGHT basis, which the founder ruled out explicitly: a line
   * priced per room per night must not blend against sqm. The value is still
   * computed and carried, so a caller can say WHY rather than showing nothing.
   */
  blendable: boolean;
}

/**
 * TOTAL AREA, TOTAL UNITS, AND A BLENDED RATE THAT IS VALUE OVER AREA.
 *
 * NEVER AN AVERAGE OF RATES. The same rule as the line's blended land rate,
 * for the same reason: averaging two prices weights a 200 sqm shop equally with
 * a 20,000 sqm tower, so the answer moves when you split a row in two. Value
 * over area does not.
 *
 * A row's value is its rate times WHAT THE RATE IS PER: units for a per-unit or
 * per-key price, area for a per-sqm one. `mixedBasis` says when those two have
 * been added together, because a pooled figure over rows priced differently is
 * a real number that a reader should be told the shape of rather than handed
 * flat.
 */
export function poolSubUnits(rows: readonly SubUnitValueRow[]): PooledSubUnits {
  let areaSqm = 0, units = 0, value = 0, pricedRows = 0;
  const bases = new Set<boolean>();
  const times = new Set<RateTimeBasis>();
  for (const r of rows) {
    areaSqm += Number.isFinite(r.areaSqm) ? r.areaSqm : 0;
    if (typeof r.units === 'number' && Number.isFinite(r.units)) units += r.units;
    const rate = r.rate;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate === 0) continue;
    const qty = r.perUnit ? (r.units ?? 0) : r.areaSqm;
    if (!Number.isFinite(qty)) continue;
    value += rate * qty;
    pricedRows += 1;
    bases.add(r.perUnit);
    if (r.timeBasis) times.add(r.timeBasis);
  }
  const timeBasis = times.size === 1 ? [...times][0] : undefined;
  return {
    areaSqm,
    units,
    value,
    blendedRate: areaSqm > 0 ? value / areaSqm : 0,
    mixedBasis: bases.size > 1,
    pricedRows,
    timeBasis,
    // A PER-NIGHT RATE IS NOT BLENDED AGAINST SQM. Nor are two time bases
    // added together. Both produce a real number and a false label, which is
    // worse than a dash because it invites a comparison that does not hold.
    blendable: pricedRows > 0 && areaSqm > 0
      && timeBasis !== undefined && timeBasis !== 'night',
  };
}

// ── MINTING AN ID THAT CANNOT COLLIDE ─────────────────────────────────────

let lastMintedId = 0;

/**
 * A NEW ROW'S ID. Monotonic, never a duplicate, same `prefix_number` shape.
 *
 * Every add button on this tab minted `${prefix}_${Date.now()}`, which is
 * MILLISECOND resolution. Two adds inside one millisecond, which a double-click
 * on "+ Sub-unit" produces without trying, mint the SAME ID. Everything
 * downstream keys on it, so from that moment the two rows are one row wearing
 * two coats: `updateSubUnit(id, patch)` maps the whole array and patches BOTH,
 * so a rate typed into one appears in the other; `removeSubUnit(id)` deletes
 * both; and React renders duplicate keys. That is exactly the reported
 * behaviour, two new sub-units always showing one rate, and nothing in the
 * codebase copies a rate onto a new row, so a shared id is the only mechanism
 * that produces it.
 *
 * The counter makes the value strictly increasing even when the clock does not
 * move, so ids stay sortable and stay unique for the life of the tab.
 */
export function mintId(prefix: string): string {
  const now = Date.now();
  lastMintedId = now > lastMintedId ? now : lastMintedId + 1;
  return `${prefix}_${lastMintedId}`;
}

// ── THE TOTAL ROW, ONE RULE FOR TWO TABLES (2026-09-10) ────────────────────
//
// Tables 3 and 4 show the same assets under two groupings (by plot, by line),
// so their totals must agree. That is guaranteed by writing the sum ONCE and
// having both call it, not by writing it twice carefully. It lives here rather
// than in the tab because a verifier must be able to RUN it: a check that reads
// two JSX blocks and satisfies itself that they look alike proves nothing about
// what they add up to.

/** The chain fields a line or a total sums. Listed rather than inferred, so a
 *  new chain field is a deliberate addition here rather than a silent
 *  omission from every pooled figure on the tab. */
export const POOLED_AREA_KEYS = [
  'landUtilisedSqm', 'footprintSqm', 'landscapeSqm', 'retailGfaSqm', 'lobbyGfaSqm',
  'totalGfaSqm', 'mainAssetGfaSqm', 'netSaleableSqm', 'units', 'parkingSlots',
  'retailParkingSlots', 'totalParkingSlots', 'parkingAreaSqm', 'retailParkingAreaSqm',
  'totalParkingAreaSqm', 'totalBuaSqm',
] as const;

/** All a total needs of a row: its land and its chain result. Structural, so
 *  the tab's own richer row type satisfies it without this file learning it. */
export interface TotalledRow {
  landSqm: number;
  chain: Partial<Record<string, number | undefined>>;
}

export interface AreaTotals {
  landSqm: number;
  pooled: Record<string, number>;
  landscapePct?: number;
  avgUnitSize?: number;
  parkingRatio?: number;
}

/**
 * Total the rows, and add the land the retail companions hold.
 *
 * THE COMPANION CONTRIBUTES LAND AND NOTHING ELSE, and that is not an
 * omission. Its floor area IS its hosts' retail GFA, already inside their
 * Retail GFA, Total GFA and Total BUA, so adding it again would double count
 * the very area the carve exists to place. Its LAND is the opposite case: the
 * hosts gave it up and their rows are already net of it, so leaving it out
 * makes the Land column short by exactly the carve, which is how the carve
 * managed to be invisible for a day.
 *
 * The three ratios are quotients of the SUMMED columns, never averages of the
 * rows' own ratios, which is the rule table 4 already applies to a line built
 * from several plots. Absent, never zero, when there is nothing to divide by.
 */
export function totalsFromRows(
  rows: readonly TotalledRow[],
  companionLandSqm: number,
): AreaTotals {
  const pooled = poolLineAreas(rows.map((r) => r.chain), POOLED_AREA_KEYS as unknown as string[]);
  const q = (a: number | undefined, b: number | undefined): number | undefined =>
    (typeof a === 'number' && typeof b === 'number' && b > 0) ? a / b : undefined;
  return {
    landSqm: rows.reduce((t, r) => t + (Number.isFinite(r.landSqm) ? r.landSqm : 0), 0)
      + (Number.isFinite(companionLandSqm) ? companionLandSqm : 0),
    pooled,
    landscapePct: q(pooled.landscapeSqm, pooled.landUtilisedSqm),
    avgUnitSize: q(pooled.netSaleableSqm, pooled.units),
    parkingRatio: q(pooled.parkingSlots, pooled.units),
  };
}

// ── A LINE ALWAYS HAS SOMETHING TO PRICE, AND A TYPED SHARE FOLLOWS ITS NSA ──
//   (2026-09-10)
//
// Two rules that belong together because they are two halves of one sentence:
// what a line's parts ARE, and what happens to them when the whole moves.
//
// 1. A LINE WITH NO SUB-UNIT GETS ONE. Table 5 lists sub-units, so a line whose
//    assets have none has no row at all (`build()` returns undefined on an
//    empty list), which means it cannot be priced and earns nothing however
//    complete its areas are. Five live assets were in that state, two of them
//    the Standalone Commercial lines carrying 1,250 and 7,500 sqm of NSA. The
//    same answer the retail companion already gets: derive the row, because its
//    area is a figure the model already knows and asking a user to retype it
//    would put one fact in two places.
//
// 2. A TYPED SHARE IS A STATEMENT, AND THE AREA FOLLOWS IT. Until now the AREA
//    was the only stored quantity and the share was derived for display, so
//    typing a share wrote an area ONCE and the two drifted apart the moment
//    land, coverage, FAR or the retail share moved the line's NSA: the share
//    column kept reading 50% while the areas underneath added up to something
//    else, and the line reported itself over or under allocated. Whichever the
//    user typed is the statement and the other follows, so a share is STORED
//    (`SubUnit.nsaSharePct`) and its area is re-derived here.
//
// THE AREA STAYS THE ONE STORED QUANTITY EVERY READER USES. The engine, the
// reports and the exports all read `metricValue`, and none of them learns about
// shares: the plan below is applied by the store, which writes the area back,
// exactly as the retail companion's own sub-unit is refreshed. A share that
// derived at read time would be a second answer to "how big is this row".

export interface LineSubUnitSeed {
  lineKey: string;
  /** The line's first member. A line with several plots and NO sub-units at all
   *  has nobody to say how the parts split, so the whole NSA lands on one of
   *  them; every live line needing a seed has exactly one plot. */
  assetId: string;
  name: string;
  category: 'Sellable' | 'Operable' | 'Leasable';
  areaSqm: number;
}

export interface ShareRealloc {
  subUnitId: string;
  areaSqm: number;
}

/**
 * A ROW THAT PREDATES SHARES, GIVEN THE SHARE IT ALREADY SHOWS.
 *
 * Every row rendered a share long before one could be stated: the column
 * divides the row's area by the line's NSA. So the share was always on screen
 * and never in the file, and the two only agreed until the NSA moved. A
 * conversion writes the share the row is ALREADY displaying and touches no
 * area, so it changes what the row MEANS and not what it measures.
 */
export interface ShareConversion {
  subUnitId: string;
  nsaSharePct: number;
}

export interface LineSubUnitPlan {
  seeds: LineSubUnitSeed[];
  reallocations: ShareRealloc[];
  conversions: ShareConversion[];
}

/** What one sub-unit needs to state for these rules. */
export interface PlannableSubUnit extends SubUnitLike {
  /** The ROW's metric. Never read on its own: the ASSET's wins where it states
   *  one (docs/TRAPS.md 7.32), which is why every rule below resolves it
   *  through `effectiveMetric`. One live row carries metric 'units' under an
   *  asset whose metric is 'area', and reading the row alone would have left
   *  exactly that row behind on every rule here. */
  metric: 'area' | 'units';
  metricValue: number;
  unitArea?: number;
  /** Support is not part of NSA (NSA = Sellable + Operable + Leasable), so a
   *  share of NSA is not a statement it can make. */
  category?: string;
  /** The STATEMENT, when the user typed a share rather than an area. */
  nsaSharePct?: number;
}

/** THE METRIC IS THE ASSET'S where it states one (TRAPS 7.32). This was a
 *  private copy here for one day; the ENGINE had the same rule wrong, so on
 *  2026-09-10 the rule moved to core (`resolveSubUnitMetric`) and both the
 *  engine and these table rules read that one. A local copy of a rule the
 *  engine also holds is exactly how the two came to disagree in the first
 *  place. */
function effectiveMetric(u: PlannableSubUnit, asset: Asset | undefined): 'area' | 'units' {
  return resolveSubUnitMetric(u as unknown as SubUnitForMetric, asset);
}

/** The category a seeded row takes, from the asset's strategy. The same
 *  mapping the Add button uses, so a derived row and a typed one are the same
 *  kind of thing. */
export function seedCategoryFor(strategy: string): 'Sellable' | 'Operable' | 'Leasable' {
  if (strategy === 'Lease') return 'Leasable';
  if (strategy === 'Operate') return 'Operable';
  return 'Sellable';
}

/** A line's NSA: the sum of its plots', each resolved by the one rule. Shared
 *  by the display grouping and the plan so they cannot disagree about the
 *  whole that the parts are parts of. */
export function lineNsaOf(
  members: readonly Asset[],
  nsaByAsset: Record<string, ResolvedNsa>,
): { value: number; source: NsaSource } {
  let value = 0;
  let sawChain = false, sawEntered = false;
  for (const m of members) {
    const r = nsaByAsset[m.id] ?? { value: 0, source: 'none' as const };
    value += r.value;
    if (r.source === 'chain') sawChain = true;
    if (r.source === 'entered') sawEntered = true;
  }
  return { value, source: sawEntered ? 'entered' : (sawChain ? 'chain' : 'none') };
}

/**
 * What the store should add and what it should re-derive.
 *
 * PURE, AND IT DECIDES NOTHING IT CANNOT SEE. A line with no NSA gets no seed:
 * a row of zero area is not something to price, it is a row nobody can fill in.
 * A COUNT-METRIC ASSET GETS NO SEED EITHER, and that is deliberate rather than
 * an oversight: on an asset whose parts are counted, "the whole NSA" is a
 * number of keys, which needs a unit size nobody has necessarily stated, and
 * inventing one would be the platform deciding how many apartments a tower has.
 */
export function planLineSubUnits(
  assets: readonly Asset[],
  subUnits: readonly PlannableSubUnit[],
  phaseIds: readonly string[],
  nsaByAsset: Record<string, ResolvedNsa>,
  normaliseTypeId: NormaliseTypeId,
  displayName: (a: Asset) => string,
): LineSubUnitPlan {
  const seeds: LineSubUnitSeed[] = [];
  const reallocations: ShareRealloc[] = [];
  const conversions: ShareConversion[] = [];
  const { lines } = partitionSubUnitsByLine(assets, subUnits, phaseIds, normaliseTypeId);
  for (const line of lines) {
    const nsa = lineNsaOf(line.members, nsaByAsset).value;
    // A SHARE OF NOTHING IS NOT A STATEMENT. A line with no resolvable NSA
    // (no chain running for its plots and none carrying an entered figure) has
    // no whole for a part to be a share OF, so nothing here converts, seeds or
    // re-derives. Measured before choosing this: every one of one live
    // project's eight lines is in that state, twelve rows, and all twelve are
    // left exactly as they are.
    if (nsa <= 0) continue;
    const memberById = new Map(line.members.map((m) => [m.id, m] as const));
    if (line.subUnits.length === 0) {
      const host = line.members[0];
      // An asset whose metric is COUNT states its parts as keys, not as an
      // area, so there is nothing honest to seed.
      if (!host || host.subUnitMetric === 'units') continue;
      seeds.push({
        lineKey: line.key,
        assetId: host.id,
        name: displayName(host),
        category: seedCategoryFor(String(host.strategy ?? '')),
        areaSqm: nsa,
      });
      continue;
    }
    for (const u of line.subUnits) {
      // A COUNT ROW HAS NO SHARE TO FOLLOW: its count is the statement and its
      // area derives from the count, which is the existing rule and stays. The
      // metric is the ASSET's where it states one, never the row's alone.
      if (effectiveMetric(u, memberById.get(u.assetId)) === 'units') continue;
      // SUPPORT IS NOT PART OF NSA (founder's decision, 2026-09-10), so a share
      // of NSA is not a statement it can make: NSA is Sellable + Operable +
      // Leasable, and a back-of-house row is none of those. It stays area
      // stated, and a user who wants it to scale can still type a share, which
      // is the same escape hatch in the other direction.
      if (u.category === 'Support') continue;
      const share = u.nsaSharePct;
      if (typeof share !== 'number' || !Number.isFinite(share)) {
        // NO STORED SHARE YET: this row predates the field, so it is converted
        // to the share IT ALREADY SHOWS. The area is untouched, which is the
        // whole point of choosing this over rescaling: conversion changes what
        // the row MEANS, never what it measures. A share that cannot be
        // computed is not invented.
        if (!Number.isFinite(u.metricValue)) continue;
        conversions.push({ subUnitId: u.id, nsaSharePct: (u.metricValue / nsa) * 100 });
        continue;
      }
      const areaSqm = (nsa * share) / 100;
      // A HUNDREDTH OF A SQM IS NOT A CHANGE, the same tolerance the line's own
      // allocation check uses, so float noise cannot mark a project dirty.
      if (Math.abs(areaSqm - u.metricValue) < 0.01) continue;
      reallocations.push({ subUnitId: u.id, areaSqm });
    }
  }
  return { seeds, reallocations, conversions };
}
