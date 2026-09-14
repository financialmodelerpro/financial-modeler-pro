/**
 * costStandards.ts
 *
 * COST RATES DEFAULT FROM THE ASSET TYPE (2026-09-14, founder's direction).
 *
 * The reference model states a construction rate per asset type (a villa at
 * one rate per sqm, an apartment at another), component rates for parking and
 * landscape, and soft costs as a percentage of hard cost. The platform's capex
 * lines belong to a PHASE, so every asset in a phase shared one rate and a
 * mixed phase had to be typed asset by asset through overrides.
 *
 * THE STANDARD IS A RATE PER CATALOG LINE, PER TYPE:
 * `project.assetTypeValues[typeId].costRates[catalogId]`, in the line's own
 * units (per sqm for a rate method, percent for a percentage method). The
 * columns are the project's own hard and soft capex lines, so a line the user
 * adds in Capex becomes a column with no code change.
 *
 * HOW IT REACHES THE MODEL: THROUGH THE ORDINARY OVERRIDE, NOT A NEW ENGINE
 * PATH. For every asset of a type with a rate on a line of its phase, this
 * settle writes a per-asset `CostOverride` flagged `origin: 'standard'`. The
 * engine already prices an active override, so it needs no change and every
 * surface that reads the override (Capex, reports, exports, scenarios) already
 * agrees. The override mirrors the line in everything but the value, so a
 * phasing or basis edit on the line still reaches it.
 *
 * THE USER'S OWN OVERRIDE ALWAYS WINS. An override without the flag is never
 * touched, and editing a standard-sourced override in Capex writes one without
 * the flag (every editor builds the override field by field), so the edit
 * becomes the user's and the type no longer moves it. Removing that user
 * override puts the standard back on the next settle.
 *
 * A RETAIL STRIP KEEPS ITS OWN BASIS. The store seeds a strip's two
 * construction overrides on Retail GFA and Retail Parking Area at the line's
 * rate. While such a seed still carries the line's rate it is treated as a
 * seed, not a user's choice: the standard replaces its value and keeps its
 * basis, and when the type's rate goes the seed is restored rather than
 * deleted, so the strip is never left pricing its floor area on a host basis.
 *
 * IT SETTLES: the input object comes back when nothing moves, so opening a
 * project whose overrides already agree cannot mark it dirty.
 *
 * Pure. No em dashes in this file.
 */
import { deriveAssetScope, deriveCostStage } from '@/src/core/calculations';
import { isRetailCompanion } from '@/src/core/calculations/retailCompanion';
import { standardConstructionBase } from '@/src/core/calculations/costBases';
import { resolveCatalogId } from './costCatalog';
import type { Asset, CostLine, CostOverride } from './module1-types';
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
}

export interface StandardsSettleResult<T> {
  state: T;
  changed: boolean;
  written: number;
  removed: number;
}

/** One column on the Standards tab: a catalog line the project prices. */
export interface StandardCostColumn {
  catalogId: string;
  label: string;
  stage: 'hard' | 'soft';
  unit: 'percent' | 'rate' | 'amount';
  method: string;
}

/** The unit a line's value is stated in, read from its method. */
export function costMethodUnit(method: string): StandardCostColumn['unit'] {
  if (method.startsWith('percent')) return 'percent';
  if (method.startsWith('rate')) return 'rate';
  return 'amount';
}

/**
 * THE COLUMNS: every hard and soft capex line of the project with a catalog
 * identity, once each, in the order the project lists them (hard first). Land,
 * marketing, the locked derivations and the selling costs are not a property
 * of a building type, so they are not offered.
 */
export function standardCostColumns(costLines: readonly CostLine[]): StandardCostColumn[] {
  const seen = new Map<string, StandardCostColumn>();
  for (const line of costLines) {
    if (line.isLocked || line.targetAssetId) continue;
    const stage = deriveCostStage(line);
    if (stage !== 'hard' && stage !== 'soft') continue;
    if (deriveAssetScope(line) === 'selling') continue;
    const catalogId = resolveCatalogId(line);
    if (!catalogId || seen.has(catalogId)) continue;
    seen.set(catalogId, { catalogId, label: line.name, stage, unit: costMethodUnit(line.method), method: line.method });
  }
  const cols = [...seen.values()];
  return [...cols.filter((c) => c.stage === 'hard'), ...cols.filter((c) => c.stage === 'soft')];
}

const same = (a: CostOverride, b: CostOverride): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** An override is a strip SEED while it still carries the line's own rate. */
function isStripSeed(o: CostOverride, line: CostLine): boolean {
  return o.origin === undefined && o.overridden !== false && o.value === line.value
    && o.distribution === undefined && o.perSubUnitRates === undefined
    && o.startPeriod === undefined && o.endPeriod === undefined && o.phasingSource === undefined;
}

export function settleStandardCostOverrides<T extends StandardsState>(state: T): StandardsSettleResult<T> {
  const values = state.project.assetTypeValues ?? {};
  const key = (assetId: string, lineId: string): string => `${assetId}::${lineId}`;
  const existing = new Map(state.costOverrides.map((o) => [key(o.assetId, o.lineId), o]));
  const replace = new Map<string, CostOverride | null>();
  const add: CostOverride[] = [];
  const desiredKeys = new Set<string>();

  for (const asset of state.assets) {
    // The Operate companion charges no capex of its own.
    if (asset.isCompanion === true && asset.strategy === 'Operate') continue;
    const rates = asset.assetTypeId ? values[asset.assetTypeId]?.costRates : undefined;
    if (!rates) continue;
    const strip = isRetailCompanion(asset);
    for (const line of state.costLines) {
      if (line.phaseId !== asset.phaseId || line.targetAssetId || line.isLocked) continue;
      const catalogId = resolveCatalogId(line);
      const rate = catalogId !== undefined ? rates[catalogId] : undefined;
      if (typeof rate !== 'number' || !Number.isFinite(rate)) continue;
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
    const line = state.costLines.find((l) => l.id === o.lineId);
    const base = line ? standardConstructionBase(line) : undefined;
    if (asset && line && base !== undefined && isRetailCompanion(asset)) {
      replace.set(k, { assetId: o.assetId, lineId: o.lineId, method: o.method, value: line.value, phasing: line.phasing, overridden: true });
    } else {
      replace.set(k, null);
      removed += 1;
    }
  }

  if (add.length === 0 && replace.size === 0) {
    return { state, changed: false, written: 0, removed: 0 };
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
    state: { ...state, costOverrides },
    changed: true,
    written: add.length + [...replace.values()].filter((r) => r !== null).length,
    removed,
  };
}
