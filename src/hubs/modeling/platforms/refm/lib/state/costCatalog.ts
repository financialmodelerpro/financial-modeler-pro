/**
 * costCatalog.ts (2026-08-17)
 *
 * A COST LINE HAS TWO PARTS: a catalog entry underneath that carries the
 * behaviour, and a display name the user can rename freely.
 *
 * THE DEFECT CLASS THIS CLOSES. Until now a row's behaviour lived in its `id`
 * (the seeded method, `STANDARD_STAGE_BY_ID`, the seeded `phasingSource`) while
 * its label was free text, and nothing on screen connected the two. So a live
 * project carried a row labelled "Permits and approvals" that was the seeded
 * Commission line: it looked like permits, it charged like commission, it
 * followed sales collections, and no surface said so. Renaming is the natural
 * thing to do and it silently detached the label from the behaviour.
 *
 * Now: selecting an entry STAMPS its method, stage and phasing source onto the
 * line and records `catalogId`. Renaming afterwards changes the label and
 * nothing else, and the row shows its catalog identity as a caption, so a line
 * labelled in a project's own vocabulary still declares what it is.
 *
 * THE LINE OWNS ITS OWN BEHAVIOUR, NOT THE CATALOG. The catalog writes onto the
 * line at selection time and is never read by the engine, the reports or the
 * exports. A catalog that cannot be reached (a failed fetch, a deploy landing
 * before its migration, an entry someone deleted) can therefore never change a
 * number: at worst a caption falls back to "custom". This is deliberate and is
 * the reason `catalogId` is a label-side concern only.
 *
 * BUILT-INS LIVE HERE, IN CODE. User additions are shared across that user's
 * projects and live in `refm_cost_catalog` (migration 214). Code-side built-ins
 * mean a project always has the standard list with no database round trip and
 * no empty-state, and a user entry is a layer on top rather than a replacement.
 *
 * Pure. No em dashes in this file.
 */

import {
  isStandardCostLineBaseId,
  deriveLineBaseId,
  type AllocationBasis,
  type CapexPhasingSource,
  type CostLine,
  type CostMethod,
  type CostScope,
  type CostStage,
} from './module1-types';

export interface CostCatalogEntry {
  /** Stable id. Constrained to [a-z0-9-] because a line minted from an entry
   *  composes its id as `${catalogId}__${phaseId}` and `deriveLineBaseId`
   *  splits on the double underscore. */
  id: string;
  /** The default display name. The user may rename the line afterwards. */
  label: string;
  method: CostMethod;
  stage: CostStage;
  /** Absent means `inherit`, which is what most construction lines want. */
  phasingSource?: CapexPhasingSource;
  allocationBasis: AllocationBasis;
  scope: CostScope;
  /** One line on what the entry is for, shown in the picker. */
  hint?: string;
  /** False for the two parcel-driven land rows: they are derivations, not
   *  choices, so they are never offered even though they resolve for captions. */
  selectable?: boolean;
  /** True for the entries defined here rather than added by a user. */
  builtIn: true;
}

/** A user's own entry, from `refm_cost_catalog`. Same shape, different origin. */
export interface UserCostCatalogEntry extends Omit<CostCatalogEntry, 'builtIn'> {
  builtIn?: false;
  createdAt?: string;
}

export type AnyCostCatalogEntry = CostCatalogEntry | UserCostCatalogEntry;

/**
 * The built-in catalog.
 *
 * Ten of these are the ids the standard seed already uses, so an existing line
 * resolves its identity with no migration and no data change: `commission__p1`
 * resolves to Commission whatever it has been renamed to. The remaining four
 * (engineering supervision, design consultancy, permits and approvals, project
 * management) are SELECTABLE BUT NOT SEEDED, so a new project does not arrive
 * with four more zero rows to clear.
 *
 * Professional Fee is kept alongside Project Management and Design Consultancy
 * rather than retired in their favour: it is in use on a live project, and
 * retiring a live entry to tidy a taxonomy costs more than the tidiness is
 * worth.
 */
export const BUILT_IN_COST_CATALOG: readonly CostCatalogEntry[] = [
  // ── Parcel-driven land rows: resolvable for captions, never offered ──────
  {
    id: 'land-cash', label: 'Land (Cash)', method: 'percent_of_cash_land', stage: 'land',
    allocationBasis: 'land_share', scope: 'direct', selectable: false, builtIn: true,
    hint: 'Derived from the parcels in Tab 2. Not a choice.',
  },
  {
    id: 'land-inkind', label: 'Land (In-Kind)', method: 'percent_of_inkind_land', stage: 'land',
    allocationBasis: 'land_share', scope: 'direct', selectable: false, builtIn: true,
    hint: 'Derived from the parcels in Tab 2. Not a choice.',
  },
  // ── Land stage ──────────────────────────────────────────────────────────
  {
    id: 'rett', label: 'Real estate transfer tax', method: 'percent_of_cash_land', stage: 'land',
    phasingSource: 'land_cash', allocationBasis: 'land_share', scope: 'direct', builtIn: true,
    hint: 'Due when the land cash is paid, so it follows the land cash outflow.',
  },
  // ── Hard cost ───────────────────────────────────────────────────────────
  {
    id: 'construction-bua', label: 'Superstructure', method: 'rate_per_bua', stage: 'hard',
    allocationBasis: 'bua_share', scope: 'direct', builtIn: true,
    hint: 'Rate per sqm of built-up area.',
  },
  {
    id: 'construction-parking', label: 'Parking', method: 'rate_x_parking_area', stage: 'hard',
    allocationBasis: 'per_asset', scope: 'direct', builtIn: true,
    hint: 'Rate per sqm of parking area.',
  },
  {
    id: 'infrastructure', label: 'Infrastructure', method: 'rate_per_nda', stage: 'hard',
    allocationBasis: 'land_share', scope: 'direct', builtIn: true,
    hint: 'Rate per sqm of net developable area.',
  },
  {
    id: 'landscaping', label: 'Landscape', method: 'rate_per_nda', stage: 'hard',
    allocationBasis: 'land_share', scope: 'direct', builtIn: true,
    hint: 'Rate per sqm of net developable area.',
  },
  // ── Soft cost ───────────────────────────────────────────────────────────
  {
    id: 'design-consultancy', label: 'Design consultancy', method: 'percent_of_selected', stage: 'soft',
    allocationBasis: 'bua_share', scope: 'indirect', builtIn: true,
    hint: 'A percentage of the construction lines above it.',
  },
  {
    id: 'engineering-supervision', label: 'Engineering supervision', method: 'percent_of_selected', stage: 'soft',
    allocationBasis: 'bua_share', scope: 'indirect', builtIn: true,
    hint: 'A percentage of the construction lines above it.',
  },
  {
    id: 'permits-approvals', label: 'Permits and approvals', method: 'fixed', stage: 'soft',
    allocationBasis: 'per_asset', scope: 'indirect', builtIn: true,
    hint: 'A lump sum of authority fees.',
  },
  {
    id: 'project-management', label: 'Project management', method: 'percent_of_selected', stage: 'soft',
    allocationBasis: 'bua_share', scope: 'indirect', builtIn: true,
    hint: 'A percentage of the construction lines above it.',
  },
  {
    id: 'professional-fee', label: 'Professional fee', method: 'percent_of_selected', stage: 'soft',
    allocationBasis: 'bua_share', scope: 'indirect', builtIn: true,
    hint: 'A percentage of the construction lines above it.',
  },
  {
    id: 'pre-operating', label: 'Pre-operating', method: 'percent_of_selected', stage: 'soft',
    allocationBasis: 'bua_share', scope: 'indirect', builtIn: true,
    hint: 'Mobilisation and pre-opening cost, before operations begin.',
  },
  {
    id: 'developer-fee', label: 'Developer fee', method: 'percent_of_selected', stage: 'soft',
    allocationBasis: 'bua_share', scope: 'indirect', builtIn: true,
    hint: 'Charged on the lines above it. Keep it above the contingency so the contingency can charge on it.',
  },
  {
    id: 'contingency', label: 'Contingency', method: 'percent_of_selected', stage: 'soft',
    allocationBasis: 'bua_share', scope: 'indirect', builtIn: true,
    hint: 'Charged on everything selected above it.',
  },
  {
    id: 'commission', label: 'Commission', method: 'percent_of_selected', stage: 'soft',
    phasingSource: 'collections', allocationBasis: 'per_asset', scope: 'indirect', builtIn: true,
    hint: 'A selling cost paid out of cash received, so it follows sales collections.',
  },
  // ── Marketing stage ─────────────────────────────────────────────────────
  {
    id: 'marketing', label: 'Marketing', method: 'percent_of_revenue_sale', stage: 'marketing',
    phasingSource: 'collections', allocationBasis: 'per_asset', scope: 'indirect', builtIn: true,
    hint: 'A selling cost, outside construction cost, following sales collections.',
  },
];

/** The id a line resolves to, or undefined when it is a genuine one-off.
 *
 *  `catalogId` first, then the line's own base id, which is what makes every
 *  EXISTING line resolve with no migration: a renamed `commission__phase_1`
 *  still declares itself as Commission. */
export function resolveCatalogId(line: Pick<CostLine, 'id' | 'catalogId'>): string | undefined {
  if (line.catalogId) return line.catalogId;
  const baseId = deriveLineBaseId(line.id);
  if (isStandardCostLineBaseId(baseId)) return baseId;
  if (BUILT_IN_COST_CATALOG.some((e) => e.id === baseId)) return baseId;
  return undefined;
}

/** Built-ins plus the user's own, built-ins first, each group alphabetical by
 *  label. User entries never shadow a built-in id. */
export function mergeCatalog(userEntries: readonly UserCostCatalogEntry[] = []): AnyCostCatalogEntry[] {
  const byLabel = (a: AnyCostCatalogEntry, b: AnyCostCatalogEntry): number => a.label.localeCompare(b.label);
  const builtInIds = new Set(BUILT_IN_COST_CATALOG.map((e) => e.id));
  const users = userEntries.filter((e) => !builtInIds.has(e.id)).slice().sort(byLabel);
  return [...BUILT_IN_COST_CATALOG.slice().sort(byLabel), ...users];
}

export function findCatalogEntry(
  id: string | undefined,
  userEntries: readonly UserCostCatalogEntry[] = [],
): AnyCostCatalogEntry | undefined {
  if (!id) return undefined;
  return BUILT_IN_COST_CATALOG.find((e) => e.id === id) ?? userEntries.find((e) => e.id === id);
}

/** What the caption prints. A line with no resolvable entry is a one-off, and
 *  says so rather than showing nothing. */
export function catalogLabelFor(
  line: Pick<CostLine, 'id' | 'catalogId'>,
  userEntries: readonly UserCostCatalogEntry[] = [],
): string {
  const id = resolveCatalogId(line);
  if (!id) return 'Custom line';
  return findCatalogEntry(id, userEntries)?.label ?? id;
}

/** The fields an entry stamps onto a line. Everything else on the line (its
 *  name, value, window, selection) is the user's and is never touched here. */
export interface CatalogStamp {
  catalogId: string;
  method: CostMethod;
  stage: CostStage;
  stageOverride: CostStage;
  phasingSource: CapexPhasingSource;
  allocationBasis: AllocationBasis;
  scope: CostScope;
}

export function stampFromEntry(entry: AnyCostCatalogEntry): CatalogStamp {
  return {
    catalogId: entry.id,
    method: entry.method,
    stage: entry.stage,
    // The stage is written to BOTH: `stage` for readers that use the raw field,
    // and `stageOverride` because the id map outranks `stage` and a line minted
    // from one catalog entry must not classify as another one's id.
    stageOverride: entry.stage,
    phasingSource: entry.phasingSource ?? 'inherit',
    allocationBasis: entry.allocationBasis,
    scope: entry.scope,
  };
}

/** What a reassignment would change, so the row can say it before doing it.
 *  A reassignment that silently moved a number would be the same class of
 *  defect the catalog exists to close. */
export interface CatalogChange { field: string; from: string; to: string }

export function describeCatalogChange(
  line: Pick<CostLine, 'id' | 'catalogId' | 'method' | 'stage' | 'stageOverride' | 'phasingSource' | 'allocationBasis'>,
  entry: AnyCostCatalogEntry,
  labels: {
    method: Record<string, string>;
    stage: Record<string, string>;
    source: Record<string, string>;
  },
): CatalogChange[] {
  const stamp = stampFromEntry(entry);
  const out: CatalogChange[] = [];
  if (line.method !== stamp.method) {
    out.push({ field: 'Method', from: labels.method[line.method] ?? line.method, to: labels.method[stamp.method] ?? stamp.method });
  }
  const currentStage = line.stageOverride ?? line.stage;
  if (currentStage !== stamp.stage) {
    out.push({ field: 'Stage', from: labels.stage[currentStage] ?? currentStage, to: labels.stage[stamp.stage] ?? stamp.stage });
  }
  const currentSource = line.phasingSource ?? 'inherit';
  if (currentSource !== stamp.phasingSource) {
    out.push({ field: 'Phasing source', from: labels.source[currentSource] ?? currentSource, to: labels.source[stamp.phasingSource] ?? stamp.phasingSource });
  }
  return out;
}

/** A new id for a line minted from a catalog entry, unique inside its phase. */
export function mintLineId(catalogId: string, phaseId: string, taken: readonly string[]): string {
  const base = `${catalogId}__${phaseId}`;
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${catalogId}-${n}__${phaseId}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${catalogId}-${taken.length + 1}__${phaseId}`;
}

/** Ids are used inside a composed line id, so they must not carry the phase
 *  separator or anything a filename-ish key would not survive. */
export function normaliseCatalogId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
