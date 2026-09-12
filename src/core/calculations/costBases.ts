/**
 * THE REFERENCE COST BASES, APPLIED ON LOAD AND ON SAVE (2026-09-12).
 *
 * Founder's direction, after a live session in which every asset of one
 * project ended up on the wrong basis: "for each asset pick the correct
 * basis by default". The reference prices a HOST's superstructure on Main
 * Asset GFA and its parking on its parking area, and a RETAIL STRIP on its
 * Retail GFA and its retail parking. Each of the four methods reads its own
 * figure on one side and 0 on the other, so a phase line on a strip basis
 * prices every host at nothing, and a strip override on a host basis prices
 * the strip at nothing. Neither is ever what anyone meant.
 *
 * WHAT MOVES, and only this:
 *   - the two STANDARD construction lines of a phase (`construction-bua__<p>`
 *     and `construction-parking__<p>`): a strip-only basis goes back to the
 *     host basis, and Total GFA on the superstructure line goes to Main Asset
 *     GFA (which falls back to Total GFA where the chain derived nothing, so a
 *     project with no land planning does not move by a cent);
 *   - a STRIP's override on those lines from a host basis to the strip basis,
 *     and a HOST's override from a strip basis to the host basis;
 *   - a strip with NO override on a line that exists is seeded with one at the
 *     line's rate (the same plan the store applies when it adds a strip).
 * A parking line on any other basis (slots, NSA, a lump sum) is the user's
 * choice and is left alone. Custom lines are never touched.
 *
 * IT SETTLES: the input object comes back when there is nothing to move, so
 * a project on the reference bases hydrates to the object it always did and
 * opening it cannot mark it dirty.
 */
import { isRetailCompanion, planRetailCompanionOverrides } from './retailCompanion';

export interface BasesCostLine { id: string; phaseId: string; method: string; value: number; phasing: string }
export interface BasesCostOverride { assetId: string; lineId: string; method: string }
export interface BasesAsset { id: string; phaseId: string; isCompanion?: boolean; companionType?: string }
export interface BasesState {
  assets: readonly BasesAsset[];
  costLines: readonly BasesCostLine[];
  costOverrides: readonly BasesCostOverride[];
}

export interface CostBaseMove {
  kind: 'line' | 'override' | 'seed';
  lineId: string;
  assetId?: string;
  from?: string;
  to: string;
}

export interface CostBasesResult<T> { state: T; changed: boolean; moves: CostBaseMove[] }

const HOST_BASIS: Readonly<Record<string, string>> = {
  'construction-bua': 'rate_x_main_asset_gfa',
  'construction-parking': 'rate_x_parking_area',
};
const STRIP_BASIS: Readonly<Record<string, string>> = {
  'construction-bua': 'rate_x_retail_gfa',
  'construction-parking': 'rate_x_retail_parking_area',
};
/** What a host line moves FROM, per standard line. */
const LINE_MOVES_FROM: Readonly<Record<string, readonly string[]>> = {
  'construction-bua': ['rate_per_bua', 'rate_x_retail_gfa'],
  'construction-parking': ['rate_x_retail_parking_area'],
};
/** What a strip override moves FROM (a host basis), per standard line. */
const STRIP_MOVES_FROM: Readonly<Record<string, readonly string[]>> = {
  'construction-bua': ['rate_x_main_asset_gfa', 'rate_per_bua'],
  'construction-parking': ['rate_x_parking_area'],
};

/** The standard base id of a line, or undefined for a custom line. */
export function standardConstructionBase(line: { id: string; phaseId: string }): string | undefined {
  for (const base of Object.keys(HOST_BASIS)) {
    if (line.id === `${base}__${line.phaseId}`) return base;
  }
  return undefined;
}

export function applyReferenceCostBases<T extends BasesState>(state: T): CostBasesResult<T> {
  const moves: CostBaseMove[] = [];
  const strips = new Set(state.assets.filter((a) => isRetailCompanion(a)).map((a) => a.id));
  const hosts = new Set(state.assets.filter((a) => !isRetailCompanion(a)).map((a) => a.id));
  const baseOf = new Map<string, string>();
  for (const l of state.costLines) { const b = standardConstructionBase(l); if (b) baseOf.set(l.id, b); }

  let linesChanged = false;
  const costLines = state.costLines.map((l) => {
    const base = baseOf.get(l.id);
    if (!base || !LINE_MOVES_FROM[base].includes(l.method)) return l;
    linesChanged = true;
    moves.push({ kind: 'line', lineId: l.id, from: l.method, to: HOST_BASIS[base] });
    return { ...l, method: HOST_BASIS[base] };
  });

  let overridesChanged = false;
  const costOverrides = state.costOverrides.map((o) => {
    const base = baseOf.get(o.lineId);
    if (!base) return o;
    if (strips.has(o.assetId) && STRIP_MOVES_FROM[base].includes(o.method)) {
      overridesChanged = true;
      moves.push({ kind: 'override', lineId: o.lineId, assetId: o.assetId, from: o.method, to: STRIP_BASIS[base] });
      return { ...o, method: STRIP_BASIS[base] };
    }
    if (hosts.has(o.assetId) && o.method === STRIP_BASIS[base]) {
      overridesChanged = true;
      moves.push({ kind: 'override', lineId: o.lineId, assetId: o.assetId, from: o.method, to: HOST_BASIS[base] });
      return { ...o, method: HOST_BASIS[base] };
    }
    return o;
  });

  const seeds = planRetailCompanionOverrides(
    state.assets.filter((a) => strips.has(a.id)).map((a) => ({ id: a.id, phaseId: a.phaseId })),
    costLines,
    costOverrides,
  );
  for (const sd of seeds) moves.push({ kind: 'seed', lineId: sd.lineId, assetId: sd.assetId, to: sd.method });

  if (!linesChanged && !overridesChanged && seeds.length === 0) return { state, changed: false, moves };
  return {
    state: {
      ...state,
      ...(linesChanged ? { costLines } : {}),
      ...(overridesChanged || seeds.length > 0 ? { costOverrides: [...costOverrides, ...seeds] } : {}),
    },
    changed: true,
    moves,
  };
}
