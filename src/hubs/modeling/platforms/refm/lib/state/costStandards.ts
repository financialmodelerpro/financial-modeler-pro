/**
 * costStandards.ts
 *
 * THE COST STANDARDS, IN THE REFERENCE MODEL'S SHAPE (2026-09-14, founder).
 *
 * Two short lists, not a grid:
 *   CONSTRUCTION COST  one row per asset type (the superstructure rate), then
 *                      Parking, Landscape and Villas Landscape as rows of the
 *                      same list. A row can be scoped to asset types, which is
 *                      how the villa landscape rate survives without a
 *                      per-type column.
 *   SOFT COSTS         one percentage per item for the project: engineering,
 *                      design, permits, developer fee, contingency, the land
 *                      transfer tax and marketing.
 * A user adds rows to either list, and a new row creates the matching line in
 * Capex the way the built-in items do.
 *
 * THESE ARE DEFAULTS. Precedence for one asset on one Capex line, first that
 * exists wins:
 *   1. the user's own per-asset override in Capex (never touched here);
 *   2. a rate typed on the PHASE LINE in Capex (`CostLine.rateStated`), so a
 *      phase that has its own superstructure rate keeps it;
 *   3. the row's rate for that PHASE (a phase exception on this tab);
 *   4. the row's own rate, the most specific row first: the asset's type row,
 *      then a row scoped to its type, then a row for all assets.
 * A line with no rate of its own and no applicable row stays blank.
 *
 * HOW IT REACHES THE ENGINE: a per-asset `CostOverride` flagged
 * `origin: 'standard'`, exactly as before, so the engine is unchanged.
 *
 * WHEN A ROW CREATES A LINE. A phase NOBODY HAS PRICED (no line in it carries a
 * rate of its own) takes the whole list, so a new project starts from the full
 * standard. A phase someone HAS priced keeps its own lines, and only a row the
 * user adds or edits here reaches it with a new line: seeding the standard list
 * onto an existing project must never add a cost line nobody asked for.
 *
 * IT SETTLES: the input comes back when nothing moves.
 *
 * Pure. No em dashes in this file.
 */
import { deriveAssetScope, deriveCostStage } from '@/src/core/calculations';
import { isRetailCompanion } from '@/src/core/calculations/retailCompanion';
import { standardConstructionBase } from '@/src/core/calculations/costBases';
import {
  BUILT_IN_COST_CATALOG, resolveCatalogId, stampFromEntry, mintLineId, normaliseCatalogId,
  type CostCatalogEntry,
} from './costCatalog';
import {
  assetStrategySells, deriveCostWindow,
  type Asset, type CostLine, type CostMethod, type CostOverride, type CostStage,
} from './module1-types';
import {
  normaliseAssetTypeId,
  type AssetTypeStandard, type AssetTypeValuesByType,
} from './assetTypeStandards';

export type CostStandardList = 'construction' | 'soft';

export interface CostStandardRow {
  /** Stable id: `type:<assetTypeId>`, `cat:<catalogId>[:<scope>]` or `custom:<catalogId>`. */
  id: string;
  list: CostStandardList;
  label: string;
  /** The Capex line identity this row prices. */
  catalogId: string;
  /** The basis a line created from this row takes. */
  method: CostMethod;
  /** A type row: the superstructure rate of this asset type. */
  assetTypeId?: string;
  /** A row that applies only to these asset types (the villa landscape rate). */
  appliesToTypeIds?: string[];
  /** Absent is blank: not decided. */
  rate?: number;
  /** A rate for one phase, which wins over `rate` in that phase. */
  byPhase?: Record<string, number>;
  /** True once a user added or edited the row: it then creates missing lines
   *  in every phase it applies to, priced or not. */
  linked?: boolean;
  /** Added on this tab rather than shipped with the list. */
  custom?: boolean;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ── The shipped list, in the reference model's shape and figures ───────────

const TYPE_DEFAULTS: ReadonlyArray<readonly [string, number | undefined]> = [
  ['Branded Villas', 11000],
  ['High End Apartments', 4500],
  ['Branded Apartments High', 9000],
  ['Branded Apartments Mid', undefined],
  ['Apartments', 3000],
  ['Residential', undefined],
  ['Resort 5 Star', 14000],
  ['4 Star Hotel', undefined],
  ['Standalone Commercial', 3000],
  ['Retail (Ground Floor)', 2200],
];

const SOFT_DEFAULTS: ReadonlyArray<readonly [string, string, CostMethod, number]> = [
  ['engineering-supervision', 'Engineering Supervision', 'percent_of_selected', 3.5],
  ['design-consultancy', 'Design Consultancy', 'percent_of_selected', 3],
  ['permits-approvals', 'Permits and Approvals', 'percent_of_selected', 0.05],
  ['developer-fee', 'Developer Fee', 'percent_of_selected', 10],
  ['contingency', 'Contingency', 'percent_of_selected', 5],
  ['rett', 'RETT', 'percent_of_cash_land', 5],
  ['marketing', 'Marketing', 'percent_of_revenue_sale', 3.5],
];

const withRate = (row: CostStandardRow, rate: number | undefined): CostStandardRow =>
  (finite(rate) ? { ...row, rate } : row);

/**
 * THE LIST A PROJECT STARTS WITH, stored on first load. A project that already
 * carried per-type cost rates (the table this replaces, 2026-09-14 morning)
 * keeps them: a superstructure rate becomes its type row, any other rate a row
 * scoped to that type.
 */
export function seedCostStandardRows(
  assetTypes: readonly AssetTypeStandard[],
  valuesByType: AssetTypeValuesByType | undefined,
): CostStandardRow[] {
  const rows: CostStandardRow[] = [];
  for (const [label, rate] of TYPE_DEFAULTS) {
    const id = normaliseAssetTypeId(label);
    rows.push(withRate({ id: `type:${id}`, list: 'construction', label, catalogId: 'construction-bua', method: 'rate_x_main_asset_gfa', assetTypeId: id }, rate));
  }
  const villaTypes = [...new Set([
    normaliseAssetTypeId('Branded Villas'),
    ...assetTypes.filter((t) => /villa/i.test(t.label)).map((t) => t.id),
  ])];
  rows.push({ id: 'cat:construction-parking', list: 'construction', label: 'Parking', catalogId: 'construction-parking', method: 'rate_x_parking_area', rate: 2800 });
  rows.push({ id: 'cat:landscaping', list: 'construction', label: 'Landscape', catalogId: 'landscaping', method: 'rate_x_landscape_area', rate: 800 });
  rows.push({ id: 'cat:landscaping:villas', list: 'construction', label: 'Villas Landscape', catalogId: 'landscaping', method: 'rate_x_landscape_area', appliesToTypeIds: villaTypes, rate: 1200 });
  for (const [catalogId, label, method, rate] of SOFT_DEFAULTS) {
    rows.push({ id: `cat:${catalogId}`, list: 'soft', label, catalogId, method, rate });
  }

  // Carry the rates of the table this replaces, unchanged in effect.
  for (const [typeId, values] of Object.entries(valuesByType ?? {})) {
    for (const [catalogId, rate] of Object.entries(values?.costRates ?? {})) {
      if (!finite(rate)) continue;
      const typeLabel = assetTypes.find((t) => t.id === typeId)?.label ?? typeId;
      if (catalogId === 'construction-bua') {
        const at = rows.findIndex((r) => r.assetTypeId === typeId);
        if (at >= 0) rows[at] = { ...rows[at], rate, linked: true };
        else rows.splice(TYPE_DEFAULTS.length, 0, { id: `type:${typeId}`, list: 'construction', label: typeLabel, catalogId, method: 'rate_x_main_asset_gfa', assetTypeId: typeId, rate, linked: true });
        continue;
      }
      const entry = BUILT_IN_COST_CATALOG.find((e) => e.id === catalogId);
      rows.push({
        id: `type:${typeId}:${catalogId}`,
        list: entry?.stage === 'hard' ? 'construction' : 'soft',
        label: `${entry?.label ?? catalogId} (${typeLabel})`,
        catalogId,
        method: entry?.method ?? 'fixed',
        appliesToTypeIds: [typeId],
        rate,
        linked: true,
      });
    }
  }
  return rows;
}

// ── Reading the list ────────────────────────────────────────────────────────

/** The row's rate in one phase: the phase exception, else the row's own. */
export function rowRateFor(row: CostStandardRow, phaseId: string): number | undefined {
  const p = row.byPhase?.[phaseId];
  if (finite(p)) return p;
  return finite(row.rate) ? row.rate : undefined;
}

const rowHasAnyRate = (row: CostStandardRow): boolean =>
  finite(row.rate) || Object.values(row.byPhase ?? {}).some(finite);

/**
 * THE CONSTRUCTION LIST AS SHOWN: the stored type rows in order, a blank type
 * row for any project type the list does not yet hold (writing a rate stores
 * it), then the other construction rows.
 */
export function constructionRowsForView(
  rows: readonly CostStandardRow[],
  assetTypes: readonly AssetTypeStandard[],
): Array<CostStandardRow & { stored: boolean }> {
  const construction = rows.filter((r) => r.list === 'construction');
  const typeRows = construction.filter((r) => r.assetTypeId !== undefined).map((r) => ({ ...r, stored: true }));
  const held = new Set(typeRows.map((r) => r.assetTypeId));
  for (const t of assetTypes) {
    if (held.has(t.id)) continue;
    typeRows.push({ id: `type:${t.id}`, list: 'construction', label: t.label, catalogId: 'construction-bua', method: 'rate_x_main_asset_gfa', assetTypeId: t.id, stored: false });
  }
  const others = construction.filter((r) => r.assetTypeId === undefined).map((r) => ({ ...r, stored: true }));
  return [...typeRows, ...others];
}

/** Replace a row, or store it: a new type row goes after the last type row. */
export function upsertCostStandardRow(rows: readonly CostStandardRow[], row: CostStandardRow): CostStandardRow[] {
  const at = rows.findIndex((r) => r.id === row.id);
  if (at >= 0) return rows.map((r, i) => (i === at ? row : r));
  if (row.assetTypeId !== undefined) {
    let last = -1;
    rows.forEach((r, i) => { if (r.assetTypeId !== undefined) last = i; });
    const next = [...rows];
    next.splice(last + 1, 0, row);
    return next;
  }
  return [...rows, row];
}

/** A row a user adds. Its identity is its name, unless the name IS a catalog item. */
export function newCustomRow(list: CostStandardList, label: string, method: CostMethod): CostStandardRow {
  const catalogId = normaliseCatalogId(label) || `item-${label.length}`;
  return { id: `custom:${catalogId}`, list, label: label.trim(), catalogId, method, linked: true, custom: true };
}

/** What a line IS, for a standard: marketing by its stage whatever its id. */
export function standardIdentity(line: CostLine): string | undefined {
  if (deriveCostStage(line) === 'marketing' || line.stage === 'marketing' || line.stageOverride === 'marketing') return 'marketing';
  return resolveCatalogId(line);
}

/** Whether a phase line carries a rate of its own. Absent marker: a non-zero value. */
export function lineHasOwnRate(line: CostLine): boolean {
  return line.rateStated ?? (line.value !== 0);
}

/**
 * THE MARKER, SET ON LOAD. A line that predates it states a rate when its value
 * is not zero: every seeded line is zero until someone types, so a zero is the
 * blank. From here on typing on the line sets it (a typed 0 included).
 */
export function settleLineRateStated(costLines: readonly CostLine[]): { costLines: CostLine[]; changed: boolean } {
  let changed = false;
  const next = costLines.map((c) => {
    if (c.rateStated !== undefined || c.isLocked) return c;
    changed = true;
    return { ...c, rateStated: c.value !== 0 };
  });
  return { costLines: changed ? next : (costLines as CostLine[]), changed };
}

/** The type an asset prices as. A retail strip carries no type of its own and
 *  prices as the project's ground-floor retail type. */
export function standardTypeIdFor(
  asset: Pick<Asset, 'assetTypeId' | 'isCompanion' | 'companionType'>,
  assetTypes: readonly AssetTypeStandard[],
): string | undefined {
  if (asset.assetTypeId) return asset.assetTypeId;
  if (!isRetailCompanion(asset)) return undefined;
  return assetTypes.find((t) => /ground[\s-]*floor/i.test(t.label) || t.id.includes('ground-floor'))?.id;
}

const appliesTo = (row: CostStandardRow, typeId: string | undefined): 'type' | 'scoped' | 'open' | null => {
  if (row.assetTypeId !== undefined) return typeId !== undefined && row.assetTypeId === typeId ? 'type' : null;
  if ((row.appliesToTypeIds ?? []).length > 0) return typeId !== undefined && row.appliesToTypeIds!.includes(typeId) ? 'scoped' : null;
  return 'open';
};

/** The default for one asset type on one line identity in one phase. */
export function pickStandardRate(
  rows: readonly CostStandardRow[],
  typeId: string | undefined,
  catalogId: string,
  phaseId: string,
): { rate: number; row: CostStandardRow } | undefined {
  const candidates = rows.filter((r) => r.catalogId === catalogId);
  const ordered = [
    ...candidates.filter((r) => appliesTo(r, typeId) === 'type'),
    ...candidates.filter((r) => appliesTo(r, typeId) === 'scoped'),
    ...candidates.filter((r) => appliesTo(r, typeId) === 'open'),
  ];
  for (const row of ordered) {
    const rate = rowRateFor(row, phaseId);
    if (rate !== undefined) return { rate, row };
  }
  return undefined;
}

// ── Creating lines ──────────────────────────────────────────────────────────

const CATALOG_INDEX = new Map(BUILT_IN_COST_CATALOG.map((e, i) => [e.id, i]));
const CHARGES_SOFT_TOO = new Set(['developer-fee', 'contingency']);

/** The catalog entry a row creates a line from. A row's own method wins, since
 *  the list states permits as a percentage where the catalog has a lump sum. */
function entryForRow(row: CostStandardRow): CostCatalogEntry {
  const built = BUILT_IN_COST_CATALOG.find((e) => e.id === row.catalogId);
  const stage: CostStage = built?.stage
    ?? (row.list === 'construction' ? 'hard'
      : row.method.startsWith('percent_of_revenue') ? 'marketing'
        : row.method === 'percent_of_cash_land' ? 'land' : 'soft');
  return {
    id: row.catalogId,
    label: row.assetTypeId !== undefined ? 'Construction (superstructure)' : row.label,
    method: row.method,
    stage,
    phasingSource: built?.phasingSource
      ?? (row.method.startsWith('percent_of_revenue') ? 'collections' : row.method === 'percent_of_cash_land' ? 'land_cash' : undefined),
    allocationBasis: built?.allocationBasis ?? (row.method === 'rate_per_land' ? 'land_share' : row.method === 'fixed' ? 'per_asset' : 'bua_share'),
    scope: built?.scope ?? (row.list === 'construction' ? 'direct' : 'indirect'),
    assetScope: built?.assetScope ?? (row.method.startsWith('percent_of_revenue') ? 'selling' : undefined),
    builtIn: true,
  };
}

/** Where a line for an item the catalog does not know sits among the rest. */
function rankOf(id: string | undefined, entry?: CostCatalogEntry): number {
  if (id !== undefined && CATALOG_INDEX.has(id)) return CATALOG_INDEX.get(id)!;
  if (!entry) return -1;
  const anchor = entry.stage === 'hard' ? 'landscaping'
    : entry.stage === 'land' ? 'rett'
      : entry.stage === 'marketing' ? 'marketing' : 'pre-operating';
  return (CATALOG_INDEX.get(anchor) ?? 0) + 0.5;
}

function mintLine(
  entry: CostCatalogEntry,
  phaseId: string,
  phaseLines: readonly CostLine[],
  constructionPeriods: number,
  takenIds: readonly string[],
): { line: CostLine; afterId?: string; beforeId?: string } {
  const idx = rankOf(entry.id, entry);
  let after: CostLine | undefined;
  for (const l of phaseLines) {
    const r = rankOf(standardIdentity(l));
    if (r >= 0 && r < idx) after = l;
  }
  const above = after ? phaseLines.slice(0, phaseLines.indexOf(after) + 1) : [];
  const selected = entry.method === 'percent_of_selected' && entry.assetScope !== 'selling'
    ? above.filter((l) => !l.isLocked && deriveAssetScope(l) !== 'selling'
      && (deriveCostStage(l) === 'hard' || (CHARGES_SOFT_TOO.has(entry.id) && deriveCostStage(l) === 'soft'))).map((l) => l.id)
    : undefined;
  const line = {
    id: mintLineId(entry.id, phaseId, takenIds),
    phaseId,
    name: entry.label,
    value: 0,
    rateStated: false,
    ...deriveCostWindow(entry.id, constructionPeriods),
    windowFollowsConstruction: true,
    phasing: 'even',
    ...stampFromEntry(entry),
    ...(selected !== undefined ? { selectedLineIds: selected } : {}),
  } as CostLine;
  return after ? { line, afterId: after.id } : { line, beforeId: phaseLines[0]?.id };
}

// ── The settle ──────────────────────────────────────────────────────────────

export interface StandardsState {
  assets: readonly Asset[];
  costLines: readonly CostLine[];
  costOverrides: readonly CostOverride[];
  project: { costStandardRows?: readonly CostStandardRow[]; assetTypes?: readonly AssetTypeStandard[] };
  phases?: readonly { id: string; constructionPeriods?: number }[];
}

export interface StandardsSettleResult<T> {
  state: T;
  changed: boolean;
  written: number;
  removed: number;
  linesAdded: number;
}

const STRIP_BASIS: Readonly<Record<string, string>> = {
  'construction-bua': 'rate_x_retail_gfa',
  'construction-parking': 'rate_x_retail_parking_area',
};

const same = (a: CostOverride, b: CostOverride): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * A STRIP'S SEED FOLLOWS ITS LINE (2026-09-14). The store seeds a retail strip's
 * construction override AT THE LINE'S RATE, so it is a mirror, not a user's
 * choice. When the line's rate changes, a strip override still carrying the OLD
 * rate moves with it; otherwise clearing the line left the strip on the old rate
 * and the settle took the stale copy for the user's own.
 */
export function followStripSeeds(
  overrides: readonly CostOverride[],
  assets: readonly Asset[],
  before: CostLine,
  after: CostLine,
): CostOverride[] {
  if (before.value === after.value || standardConstructionBase(before) === undefined) return overrides as CostOverride[];
  let moved = false;
  const next = overrides.map((o) => {
    if (o.lineId !== before.id || !isStripSeed(o, before)) return o;
    const asset = assets.find((a) => a.id === o.assetId);
    if (!asset || !isRetailCompanion(asset)) return o;
    moved = true;
    return { ...o, value: after.value };
  });
  return moved ? next : (overrides as CostOverride[]);
}

function isStripSeed(o: CostOverride, line: CostLine): boolean {
  return o.origin === undefined && o.overridden !== false && o.value === line.value
    && o.distribution === undefined && o.perSubUnitRates === undefined
    && o.startPeriod === undefined && o.endPeriod === undefined && o.phasingSource === undefined;
}

export function settleStandardCostOverrides<T extends StandardsState>(state: T): StandardsSettleResult<T> {
  const rows = state.project.costStandardRows ?? [];
  const assetTypes = state.project.assetTypes ?? [];
  const charged = (a: Asset): boolean => a.visible !== false && !(a.isCompanion === true && a.strategy === 'Operate');
  const typeOf = (a: Asset): string | undefined => standardTypeIdFor(a, assetTypes);

  // ── 1. lines the list needs and a phase does not have ──
  let costLines: CostLine[] = state.costLines as CostLine[];
  let linesAdded = 0;
  const phaseIds = [...new Set(state.assets.filter(charged).map((a) => a.phaseId))];
  for (const phaseId of phaseIds) {
    const priced = costLines.some((l) => l.phaseId === phaseId && !l.isLocked && !l.targetAssetId && lineHasOwnRate(l));
    const phaseAssets = state.assets.filter((a) => charged(a) && a.phaseId === phaseId);
    for (const row of rows) {
      if (!(row.linked || !priced)) continue;
      if (!row.custom && !rowHasAnyRate(row)) continue;
      if (!row.custom && rowRateFor(row, phaseId) === undefined) continue;
      const entry = entryForRow(row);
      const selling = entry.assetScope === 'selling';
      if (!phaseAssets.some((a) => appliesTo(row, typeOf(a)) !== null && (!selling || assetStrategySells(a.strategy)))) continue;
      const phaseLines = costLines.filter((l) => l.phaseId === phaseId && !l.targetAssetId);
      if (phaseLines.some((l) => standardIdentity(l) === row.catalogId)) continue;
      const cp = state.phases?.find((p) => p.id === phaseId)?.constructionPeriods ?? 1;
      const minted = mintLine(entry, phaseId, phaseLines, cp, costLines.map((l) => l.id));
      const next = [...costLines];
      const anchor = minted.afterId ?? minted.beforeId;
      const at = anchor ? next.findIndex((l) => l.id === anchor) : -1;
      if (at < 0) next.push(minted.line);
      else next.splice(minted.afterId ? at + 1 : at, 0, minted.line);
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

  if (rows.length > 0) {
    for (const asset of state.assets) {
      if (!charged(asset)) continue;
      const typeId = typeOf(asset);
      const strip = isRetailCompanion(asset);
      const sells = assetStrategySells(asset.strategy);
      for (const line of costLines) {
        if (line.phaseId !== asset.phaseId || line.targetAssetId || line.isLocked) continue;
        if (lineHasOwnRate(line)) continue; // the phase line's own rate wins
        if (deriveAssetScope(line) === 'selling' && !sells) continue;
        const identity = standardIdentity(line);
        if (identity === undefined) continue;
        const pick = pickStandardRate(rows, typeId, identity, asset.phaseId);
        if (!pick) continue;
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
          value: pick.rate,
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
  }

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

/** What a basis reads as beside a rate. */
export function costStandardBasisLabel(method: string, currency: string): string {
  switch (method) {
    case 'percent_of_selected': return '% of hard cost';
    case 'percent_of_cash_land': return '% of land value, cash';
    case 'percent_of_revenue_sale': return '% of sale revenue';
    case 'percent_of_revenue_cash': return '% of sale cash';
    case 'rate_x_main_asset_gfa': return `${currency} per sqm of main asset GFA`.trim();
    case 'rate_x_parking_area': return `${currency} per sqm of parking area`.trim();
    case 'rate_x_landscape_area': return `${currency} per sqm of landscape area`.trim();
    case 'rate_per_land': return `${currency} per sqm of plot`.trim();
    case 'rate_x_retail_gfa': return `${currency} per sqm of retail GFA`.trim();
    case 'fixed': return `${currency} lump sum per asset`.trim();
    default: return method;
  }
}
