/**
 * costStandards.ts
 *
 * COST RATES DEFAULT FROM THE ASSET TYPE (2026-09-14, founder's direction).
 *
 * The reference model states its costs in ONE input table: a construction rate
 * per asset type, component rates for parking and landscape, then every soft
 * cost as a percentage, the transfer tax on land and the marketing fee on
 * sales. That is the shape of the Types and Standards cost table: ONE ROW PER
 * COST ITEM, ONE COLUMN PER ASSET TYPE, and a selling cost applies only to a
 * type whose strategy sells.
 *
 * THE STANDARD IS A RATE PER CATALOG ENTRY, PER TYPE:
 * `project.assetTypeValues[typeId].costRates[catalogId]`, in the line's own
 * units (per sqm for a rate method, percent for a percentage method).
 *
 * THE TABLE FILLS THE CAPEX TAB. For every asset of a type with a rate:
 *   1. a phase with no line for that entry GETS one, minted from the catalog at
 *      its catalog position with a zero master rate (so no other type is
 *      charged), a percentage charging the construction lines above it;
 *   2. the asset gets a per-asset `CostOverride` flagged `origin: 'standard'`
 *      at the rate, mirroring the line in everything but the value.
 * The engine is unchanged: it already prices an active override.
 *
 * THE USER'S OWN OVERRIDE ALWAYS WINS. An override without the flag is never
 * touched, and editing a standard-sourced override in Capex writes one without
 * the flag, so the edit becomes the user's. Removing it brings the standard back.
 *
 * A RETAIL STRIP KEEPS ITS OWN BASIS. Its two seeded construction overrides
 * take the standard's value and keep the retail basis, and get their seed back
 * when the rate goes.
 *
 * IT SETTLES: the input object comes back when nothing moves.
 *
 * Pure. No em dashes in this file.
 */
import { deriveAssetScope, deriveCostStage } from '@/src/core/calculations';
import { isRetailCompanion } from '@/src/core/calculations/retailCompanion';
import { standardConstructionBase } from '@/src/core/calculations/costBases';
import {
  BUILT_IN_COST_CATALOG, resolveCatalogId, stampFromEntry, mintLineId, type CostCatalogEntry,
} from './costCatalog';
import {
  assetStrategySells, deriveCostWindow,
  type Asset, type CostLine, type CostOverride,
} from './module1-types';
import type { AssetTypeValuesByType } from './assetTypeStandards';

/** The strip basis per standard construction base, as the store seeds it. */
const STRIP_BASIS: Readonly<Record<string, string>> = {
  'construction-bua': 'rate_x_retail_gfa',
  'construction-parking': 'rate_x_retail_parking_area',
};

export interface StandardsState {
  assets: readonly Asset[];
  costLines: readonly CostLine[];
  costOverrides: readonly CostOverride[];
  project: { assetTypeValues?: AssetTypeValuesByType };
  phases?: readonly { id: string; constructionPeriods?: number }[];
}

export interface StandardsSettleResult<T> {
  state: T;
  changed: boolean;
  written: number;
  removed: number;
  linesAdded: number;
}

export type StandardCostGroup = 'hard' | 'soft' | 'land' | 'selling';

/** One ROW of the Standards cost table: a cost item a type can carry a rate for. */
export interface StandardCostRow {
  catalogId: string;
  label: string;
  group: StandardCostGroup;
  unit: 'percent' | 'rate' | 'amount';
  method: string;
  /** A selling cost: only a type whose strategy sells can carry it. */
  sellingOnly: boolean;
}

export const STANDARD_COST_GROUP_LABEL: Readonly<Record<StandardCostGroup, string>> = {
  hard: 'Hard costs',
  soft: 'Soft costs',
  land: 'Land charges',
  selling: 'Selling costs',
};

/** The unit a line's value is stated in, read from its method. */
export function costMethodUnit(method: string): StandardCostRow['unit'] {
  if (method.startsWith('percent')) return 'percent';
  if (method.startsWith('rate')) return 'rate';
  return 'amount';
}

const LAND_VALUE_IDS = new Set(['land-cash', 'land-inkind']);

/**
 * WHAT A LINE IS, FOR A STANDARD. The catalog identity, except that a line on
 * the MARKETING stage is marketing whatever id it carries: a live phase line is
 * `commission__phase_2` by id while named Marketing and charged as marketing,
 * and reading it as commission made a marketing standard mint a SECOND
 * marketing line beside it. The Revenue tab names selling costs by the same rule.
 */
export function standardIdentity(line: CostLine): string | undefined {
  if (deriveCostStage(line) === 'marketing' || line.stage === 'marketing' || line.stageOverride === 'marketing') return 'marketing';
  return resolveCatalogId(line);
}

function groupOf(stage: string, sellingOnly: boolean): StandardCostGroup {
  if (sellingOnly) return 'selling';
  if (stage === 'land') return 'land';
  if (stage === 'hard') return 'hard';
  return 'soft';
}

/**
 * THE ROWS: every built-in catalog entry a building can carry a rate for
 * (the two land value rows are derivations and are not offered), in catalog
 * order, then any catalog identity the project's own lines carry that the
 * built-in list does not know. The method shown is the project's line method
 * where one exists, since a user may have moved a line to another basis.
 */
export function standardCostRows(costLines: readonly CostLine[]): StandardCostRow[] {
  const lineFor = (id: string): CostLine | undefined =>
    costLines.find((l) => !l.targetAssetId && standardIdentity(l) === id);
  const rows: StandardCostRow[] = [];
  for (const e of BUILT_IN_COST_CATALOG) {
    if (LAND_VALUE_IDS.has(e.id) || e.selectable === false) continue;
    const line = lineFor(e.id);
    const method = line?.method ?? e.method;
    const sellingOnly = e.assetScope === 'selling';
    rows.push({
      catalogId: e.id,
      label: e.id === 'construction-bua' ? 'Construction cost (superstructure)' : e.label,
      group: groupOf(e.stage, sellingOnly),
      unit: costMethodUnit(method),
      method,
      sellingOnly,
    });
  }
  const known = new Set(rows.map((r) => r.catalogId));
  for (const line of costLines) {
    if (line.isLocked || line.targetAssetId) continue;
    const id = standardIdentity(line);
    if (!id || known.has(id) || LAND_VALUE_IDS.has(id)) continue;
    known.add(id);
    const sellingOnly = deriveAssetScope(line) === 'selling';
    rows.push({
      catalogId: id, label: line.name, group: groupOf(deriveCostStage(line), sellingOnly),
      unit: costMethodUnit(line.method), method: line.method, sellingOnly,
    });
  }
  const order: StandardCostGroup[] = ['hard', 'soft', 'land', 'selling'];
  return order.flatMap((g) => rows.filter((r) => r.group === g));
}

const CATALOG_INDEX = new Map(BUILT_IN_COST_CATALOG.map((e, i) => [e.id, i]));
/** Percentages that charge the hard AND soft lines above them, as the seed does. */
const CHARGES_SOFT_TOO = new Set(['developer-fee', 'contingency']);

/**
 * A LINE FOR AN ENTRY A PHASE DOES NOT HAVE, placed where the catalog puts it.
 * Zero master rate: the standard reaches its own type through the override.
 */
function mintStandardLine(
  entry: CostCatalogEntry,
  phaseId: string,
  phaseLines: readonly CostLine[],
  constructionPeriods: number,
  takenIds: readonly string[],
): { line: CostLine; insertAfterId?: string; insertBeforeId?: string } {
  const idx = CATALOG_INDEX.get(entry.id) ?? Number.MAX_SAFE_INTEGER;
  const rank = (l: CostLine): number => CATALOG_INDEX.get(standardIdentity(l) ?? '') ?? -1;
  let after: CostLine | undefined;
  for (const l of phaseLines) {
    const r = rank(l);
    if (r >= 0 && r < idx) after = l;
  }
  const above = after ? phaseLines.slice(0, phaseLines.indexOf(after) + 1) : [];
  const stage = (l: CostLine): string => deriveCostStage(l);
  const selected = entry.method === 'percent_of_selected' && entry.assetScope !== 'selling'
    ? above.filter((l) => !l.isLocked && deriveAssetScope(l) !== 'selling'
      && (stage(l) === 'hard' || (CHARGES_SOFT_TOO.has(entry.id) && stage(l) === 'soft'))).map((l) => l.id)
    : undefined;
  const line: CostLine = {
    id: mintLineId(entry.id, phaseId, takenIds),
    phaseId,
    name: entry.label,
    value: 0,
    ...deriveCostWindow(entry.id, constructionPeriods),
    windowFollowsConstruction: true,
    phasing: 'even',
    ...stampFromEntry(entry),
    ...(selected !== undefined ? { selectedLineIds: selected } : {}),
  } as CostLine;
  return after
    ? { line, insertAfterId: after.id }
    : { line, insertBeforeId: phaseLines[0]?.id };
}

const same = (a: CostOverride, b: CostOverride): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** An override is a strip SEED while it still carries the line's own rate. */
function isStripSeed(o: CostOverride, line: CostLine): boolean {
  return o.origin === undefined && o.overridden !== false && o.value === line.value
    && o.distribution === undefined && o.perSubUnitRates === undefined
    && o.startPeriod === undefined && o.endPeriod === undefined && o.phasingSource === undefined;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function settleStandardCostOverrides<T extends StandardsState>(state: T): StandardsSettleResult<T> {
  const values = state.project.assetTypeValues ?? {};
  const charged = (a: Asset): boolean => !(a.isCompanion === true && a.strategy === 'Operate');

  // ── 1. lines the standards need and a phase does not have ──
  let costLines: CostLine[] = state.costLines as CostLine[];
  let linesAdded = 0;
  for (const asset of state.assets) {
    if (!charged(asset) || !asset.assetTypeId) continue;
    const rates = values[asset.assetTypeId]?.costRates;
    if (!rates) continue;
    for (const [catalogId, rate] of Object.entries(rates)) {
      if (!finite(rate)) continue;
      const entry = BUILT_IN_COST_CATALOG.find((e) => e.id === catalogId);
      if (!entry || LAND_VALUE_IDS.has(entry.id) || entry.selectable === false) continue;
      if (entry.assetScope === 'selling' && !assetStrategySells(asset.strategy)) continue;
      const phaseLines = costLines.filter((l) => l.phaseId === asset.phaseId && !l.targetAssetId);
      if (phaseLines.some((l) => standardIdentity(l) === catalogId)) continue;
      const cp = state.phases?.find((p) => p.id === asset.phaseId)?.constructionPeriods ?? 1;
      const minted = mintStandardLine(entry, asset.phaseId, phaseLines, cp, costLines.map((l) => l.id));
      const next = [...costLines];
      const anchor = minted.insertAfterId ?? minted.insertBeforeId;
      const at = anchor ? next.findIndex((l) => l.id === anchor) : -1;
      if (at < 0) next.push(minted.line);
      else next.splice(minted.insertAfterId ? at + 1 : at, 0, minted.line);
      costLines = next;
      linesAdded += 1;
    }
  }

  // ── 2. the standard overrides ──
  const key = (assetId: string, lineId: string): string => `${assetId}::${lineId}`;
  const existing = new Map(state.costOverrides.map((o) => [key(o.assetId, o.lineId), o]));
  const replace = new Map<string, CostOverride | null>();
  const add: CostOverride[] = [];
  const desiredKeys = new Set<string>();

  for (const asset of state.assets) {
    if (!charged(asset)) continue;
    const rates = asset.assetTypeId ? values[asset.assetTypeId]?.costRates : undefined;
    if (!rates) continue;
    const strip = isRetailCompanion(asset);
    const sells = assetStrategySells(asset.strategy);
    for (const line of costLines) {
      if (line.phaseId !== asset.phaseId || line.targetAssetId || line.isLocked) continue;
      if (deriveAssetScope(line) === 'selling' && !sells) continue;
      const catalogId = standardIdentity(line);
      const rate = catalogId !== undefined ? rates[catalogId] : undefined;
      if (!finite(rate)) continue;
      const k = key(asset.id, line.id);
      const prior = existing.get(k);
      const base = standardConstructionBase(line);
      const seed = strip && base !== undefined && prior !== undefined && isStripSeed(prior, line);
      if (prior && prior.origin !== 'standard' && !seed) continue; // the user's own
      desiredKeys.add(k);
      const method = strip
        ? (prior?.method ?? (base ? STRIP_BASIS[base] : undefined) ?? line.method)
        : line.method;
      const next: CostOverride = {
        assetId: asset.id,
        lineId: line.id,
        method: method as CostOverride['method'],
        value: rate,
        phasing: line.phasing,
        ...(line.distribution !== undefined ? { distribution: line.distribution } : {}),
        ...(line.disabled === true ? { disabled: true } : {}),
        overridden: true,
        origin: 'standard',
      };
      if (!prior) add.push(next);
      else if (!same(prior, next)) replace.set(k, next);
    }
  }

  // A standard override whose rate has gone: a strip's goes back to its seed,
  // every other one is removed so the asset reads the line again.
  let removed = 0;
  for (const o of state.costOverrides) {
    if (o.origin !== 'standard') continue;
    const k = key(o.assetId, o.lineId);
    if (desiredKeys.has(k)) continue;
    const asset = state.assets.find((a) => a.id === o.assetId);
    const line = costLines.find((l) => l.id === o.lineId);
    const base = line ? standardConstructionBase(line) : undefined;
    if (asset && line && base !== undefined && isRetailCompanion(asset)) {
      replace.set(k, { assetId: o.assetId, lineId: o.lineId, method: o.method, value: line.value, phasing: line.phasing, overridden: true });
    } else {
      replace.set(k, null);
      removed += 1;
    }
  }

  if (add.length === 0 && replace.size === 0 && linesAdded === 0) {
    return { state, changed: false, written: 0, removed: 0, linesAdded: 0 };
  }
  const costOverrides: CostOverride[] = [];
  for (const o of state.costOverrides) {
    const k = key(o.assetId, o.lineId);
    if (!replace.has(k)) { costOverrides.push(o); continue; }
    const r = replace.get(k);
    if (r) costOverrides.push(r);
  }
  costOverrides.push(...add);
  return {
    state: { ...state, costLines, costOverrides },
    changed: true,
    written: add.length + [...replace.values()].filter((r) => r !== null).length,
    removed,
    linesAdded,
  };
}
