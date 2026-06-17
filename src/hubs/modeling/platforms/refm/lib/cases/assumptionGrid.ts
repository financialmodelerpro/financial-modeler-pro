/**
 * assumptionGrid.ts (2026-06-15): presentation layer for the Module 6 Scenario
 * assumptions grid.
 *
 * Holds NO override-engine logic (no mutation, no round-trip decisions, that
 * stays in applyOverrides / snapshot-diff). It turns the round-trip-safe field
 * catalog (enumerateOverridableFields) into something a human reads:
 *   - a plain-English label,
 *   - entity ATTRIBUTION (asset / phase / facility / sub-unit), resolved from a
 *     GridContext so rows are never ambiguous duplicates,
 *   - a CATEGORY for grouping,
 *   - a per-field FORMAT (percent at the right stored scale, accounting, etc.),
 *   - and the curated key-driver default set.
 *
 * Construction cost levers are MODEL-AWARE: this project enters costs per asset,
 * so the real rates live in costOverrides[assetId::lineId], not the phase-level
 * master costLines[].value (which is 0 or a stale seed). curatedDefaultFields
 * therefore surfaces one row per asset from the per-asset overrides when they
 * exist, and drops zero/unused master levers so no misleading defaults show.
 */
import type { HydrateSnapshot } from '../state/module1-store';
import { enumerateOverridableFields, type OverridableField } from './applyOverrides';
import { deriveLineBaseId } from '../state/module1-types';
import type { Asset, Phase, CostLine, SubUnit, CostOverride, FinancingTranche } from '../state/module1-types';

// ── Categories (mirror the Inputs-tab bands) ────────────────────────────────
export type AssumptionCategory = 'project' | 'construction' | 'financing' | 'revenue' | 'opex';

export const ASSUMPTION_CATEGORY_ORDER: readonly AssumptionCategory[] = [
  'project', 'construction', 'financing', 'revenue', 'opex',
];

export const ASSUMPTION_CATEGORY_LABELS: Record<AssumptionCategory, string> = {
  project: 'Project, Returns & Exit',
  construction: 'Construction & Capex',
  financing: 'Financing',
  revenue: 'Revenue',
  opex: 'Opex',
};

// How a value is displayed + edited. Percent fields are stored in TWO scales:
// fractions 0..1 (discount, tax, indexation) and whole 0..100 (debt %, occupancy,
// contingency, pre-op, prof-fee). Both render as % at 2dp; editing is in the
// displayed unit and converted back on commit. Rates / prices use accounting.
export type AssumptionFormat = 'percent-fraction' | 'percent-whole' | 'accounting' | 'number' | 'text' | 'boolean';

export interface AssumptionDescriptor {
  /** Plain-English primary label, e.g. "Discount rate", "Construction cost rate (per BUA)". */
  label: string;
  /** Entity attribution, e.g. "Hotel · Phase 2", "Keys (Hotel)", "Senior · Phase 1". Empty for project-level. */
  context: string;
  category: AssumptionCategory;
  format: AssumptionFormat;
  /** Member of the curated key-driver default view. */
  curated: boolean;
}

// ── Construction cost lines surfaced as levers (stable base ids) ────────────
const CONSTRUCTION_LEVER_IDS = new Set<string>([
  'construction-bua', 'construction-parking', 'infrastructure', 'landscaping',
  'pre-operating', 'professional-fee', 'contingency',
]);
// Cost levers stored as a WHOLE percent (value = 5 means 5%) vs a rate/amount.
const PERCENT_COST_LEVER_IDS = new Set<string>([
  'pre-operating', 'professional-fee', 'contingency', 'commission', 'land-cash', 'land-inkind',
]);

// Labels mirror the Capex (Module 1 Costs) line names + their displayed units
// exactly, so the grid lever and the Capex line read as one consistent label:
// BUA is priced per sqm, Parking per bay.
const COST_LINE_LEVER_LABELS: Record<string, string> = {
  'construction-bua': 'Construction (BUA), per sqm',
  'construction-parking': 'Construction (Parking), per bay',
  'infrastructure': 'Infrastructure rate',
  'landscaping': 'Landscaping rate',
  'pre-operating': 'Pre-operating %',
  'professional-fee': 'Professional fee %',
  'contingency': 'Contingency %',
  'commission': 'Commission %',
  'land-cash': 'Land cost (cash) %',
  'land-inkind': 'Land cost (in-kind) %',
};

// ── Plain-English labels per entity-relative leaf field ─────────────────────
const FIELD_LABELS: Record<string, string> = {
  'returns.discountRate': 'Discount rate',
  'returns.exitMultiple': 'Exit multiple',
  'returns.perpetuityGrowth': 'Perpetuity growth rate',
  'returns.exitYearOffset': 'Exit year (offset)',
  'tax.rate': 'Tax / Zakat rate',
  'operatingAr.dsoDays': 'Receivable days (DSO)',
  'shareCapital': 'Share capital',
  'statutoryReserve.transferRate': 'Statutory reserve transfer rate',
  'statutoryReserve.capOfShareCapital': 'Statutory reserve cap',
  'financing.minimumCashReserve': 'Minimum cash reserve',
  'financing.cashSweep.sweepRatioPct': 'Cash sweep %',
  'financing.netFundingConfig.existingCash': 'Existing cash',
  'financing.cashDeficitConfig.initialCash': 'Initial cash',
  'unitPrice': 'Unit price / rate',
  'startingAdr': 'Starting ADR',
  'occupancyPct': 'Occupancy %',
  'revenue.operate.startingADR': 'Starting ADR',
  'revenue.operate.adrIndexation.rate': 'ADR indexation',
  'revenue.sell.indexation.rate': 'Sales price indexation',
  'revenue.lease.baseRate': 'Base lease rate',
  'revenue.lease.rentIndexation.rate': 'Rent indexation',
  'opex.defaultIndexation.rate': 'Opex inflation',
  'opex.apDaysOverride': 'Payable days (DPO)',
};

const SUFFIX_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/debtPct$/, 'Debt %'],
  [/equityPct$/, 'Equity %'],
  [/interbankRatePct$/, 'Interest rate (interbank)'],
  [/creditSpreadPct$/, 'Credit spread'],
  [/interestRatePct$/, 'Interest rate'],
  [/spreadBps$/, 'Spread (bps)'],
  [/\.rate$/, 'Indexation rate'],
];

// Per-period / year-on-year levers: the engine reads a per-period series (e.g.
// per-period occupancy on the operate config), NOT this single scalar, so they
// cannot work as a single-value scenario override and only caused dead-lever
// confusion. Excluded from BOTH the curated view and the add-row picker.
const PER_PERIOD_GRID_LEAVES = new Set<string>(['occupancyPct']);
export function isPerPeriodLever(field: string): boolean {
  return PER_PERIOD_GRID_LEAVES.has(field);
}

const CURATED_LEAVES = new Set<string>([
  'returns.discountRate', 'returns.exitMultiple', 'returns.perpetuityGrowth',
  // Tax / Zakat rate is intentionally NOT curated: it is constant across cases,
  // so it is noise in the assumptions grid. Still reachable via "Show all".
  'unitPrice', 'startingAdr',
  'revenue.operate.startingADR', 'revenue.operate.adrIndexation.rate',
  'revenue.sell.indexation.rate', 'revenue.lease.baseRate', 'revenue.lease.rentIndexation.rate',
  'opex.defaultIndexation.rate',
]);

// Money / rate amounts that render in accounting format.
const ACCOUNTING_LEAVES = new Set<string>([
  'unitPrice', 'startingAdr', 'revenue.operate.startingADR', 'revenue.lease.baseRate',
  'financing.minimumCashReserve', 'shareCapital',
  'financing.netFundingConfig.existingCash', 'financing.cashDeficitConfig.initialCash',
  'financing.fixedAmountConfig.debtAmount', 'financing.fixedAmountConfig.equityAmount',
  'rate', 'area',
]);
const PERCENT_FRACTION_LEAVES = new Set<string>([
  'returns.discountRate', 'returns.perpetuityGrowth', 'tax.rate',
  'statutoryReserve.transferRate', 'statutoryReserve.capOfShareCapital',
]);

const ACRONYMS = ['adr', 'nda', 'bua', 'nsa', 'gfa', 'irr', 'dso', 'dpo', 'ga', 'fb', 'dscr', 'ltv', 'ltc'];

// ── GridContext: resolve ids to names for attribution ───────────────────────
export interface GridContext {
  assets: Map<string, { name: string; phaseId?: string }>;
  phases: Map<string, string>;
  parcels: Map<string, string>;
  costLines: Map<string, { baseId: string; phaseId?: string; value: number; disabled?: boolean; targetAssetId?: string }>;
  subUnits: Map<string, { name: string; assetId?: string }>;
  tranches: Map<string, { name: string; phaseId?: string }>;
  /** Active per-asset cost overrides (overridden !== false, not disabled) grouped by lineId. */
  activeOverridesByLine: Map<string, Array<{ assetId: string; lineId: string; value: number }>>;
}

export function buildGridContext(model: HydrateSnapshot): GridContext {
  const m = model as unknown as {
    assets?: Asset[]; phases?: Phase[]; parcels?: Array<{ id: string; name?: string }>; costLines?: CostLine[];
    subUnits?: SubUnit[]; financingTranches?: FinancingTranche[]; costOverrides?: CostOverride[];
  };
  const assets = new Map<string, { name: string; phaseId?: string }>();
  for (const a of m.assets ?? []) assets.set(a.id, { name: a.name || a.id, phaseId: a.phaseId });
  const phases = new Map<string, string>();
  for (const p of m.phases ?? []) phases.set(p.id, p.name || p.id);
  const parcels = new Map<string, string>();
  for (const p of m.parcels ?? []) parcels.set(p.id, p.name || p.id);
  const costLines = new Map<string, { baseId: string; phaseId?: string; value: number; disabled?: boolean; targetAssetId?: string }>();
  for (const l of m.costLines ?? []) costLines.set(l.id, { baseId: deriveLineBaseId(l.id), phaseId: l.phaseId, value: Number(l.value) || 0, disabled: l.disabled, targetAssetId: l.targetAssetId });
  const subUnits = new Map<string, { name: string; assetId?: string }>();
  for (const u of m.subUnits ?? []) subUnits.set(u.id, { name: u.name || u.id, assetId: u.assetId });
  const tranches = new Map<string, { name: string; phaseId?: string }>();
  for (const t of m.financingTranches ?? []) tranches.set(t.id, { name: t.name || t.id, phaseId: t.phaseId });
  const activeOverridesByLine = new Map<string, Array<{ assetId: string; lineId: string; value: number }>>();
  for (const o of m.costOverrides ?? []) {
    if (o.overridden === false || o.disabled) continue; // inactive -> reads master, or zeroed
    const arr = activeOverridesByLine.get(o.lineId) ?? [];
    arr.push({ assetId: o.assetId, lineId: o.lineId, value: Number(o.value) || 0 });
    activeOverridesByLine.set(o.lineId, arr);
  }
  return { assets, phases, parcels, costLines, subUnits, tranches, activeOverridesByLine };
}

// Financing-config method labels, so project.financing.<config>.debtPct rows are
// distinguishable instead of N identical "Debt %" rows.
const FINANCING_CONFIG_LABELS: Record<string, string> = {
  fixedRatio: 'Fixed-ratio funding',
  netFundingConfig: 'Net-funding method',
  cashDeficitConfig: 'Cash-deficit method',
  fixedAmountConfig: 'Fixed-amount funding',
  cashSweep: 'Cash sweep',
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function selectorOf(path: string, key: string): string | null {
  const m = new RegExp(`^${key}\\[(?:id=)?([^\\]]+)\\]`).exec(path);
  return m ? m[1] : null;
}
function entityContext(group: string): string {
  const idx = group.indexOf(': ');
  return idx === -1 ? '' : group.slice(idx + 2);
}
function join(parts: Array<string | undefined>): string {
  return parts.filter((p) => p && p.trim()).join(' · ');
}
function humanizeLeaf(leaf: string): string {
  let s = leaf.split('.').pop() ?? leaf;
  s = s.replace(/Pct\b/g, ' %');
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  s = s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.charAt(0).toUpperCase() + s.slice(1);
  for (const ac of ACRONYMS) s = s.replace(new RegExp(`\\b${ac}\\b`, 'gi'), ac.toUpperCase());
  return s;
}
function categoryOf(path: string): AssumptionCategory {
  // Per-parcel land levers (purchase price etc.) sit with Construction & Capex.
  if (path.startsWith('costLines[') || path.startsWith('costOverrides[') || path.startsWith('parcels[')) return 'construction';
  if (path.startsWith('project.financing') || path.startsWith('financingTranches[')
    || path.startsWith('equityContributions[') || path.includes('parcelFunding[')) return 'financing';
  if (path.includes('.opex.') || path.includes('].opex')) return 'opex';
  if (path.includes('.revenue.') || path.startsWith('subUnits[')) return 'revenue';
  return 'project';
}

/** Detect the stored scale / format of a numeric field so it renders correctly. */
function formatForField(f: OverridableField, costBaseId?: string): AssumptionFormat {
  if (f.type === 'boolean') return 'boolean';
  if (f.type === 'string') return 'text';
  if (costBaseId !== undefined) return PERCENT_COST_LEVER_IDS.has(costBaseId) ? 'percent-whole' : 'accounting';
  const leaf = f.field;
  if (PERCENT_FRACTION_LEAVES.has(leaf) || /\.rate$/.test(leaf)) return 'percent-fraction';
  if (/Pct$/.test(leaf) || leaf === 'payoutRatio') return 'percent-whole';
  if (ACCOUNTING_LEAVES.has(leaf)) return 'accounting';
  return 'number';
}

function isCuratedField(f: OverridableField): boolean {
  if (CURATED_LEAVES.has(f.field)) return true;
  // Per-parcel land purchase price (currency / sqm) is a key driver.
  if (f.field === 'rate' && f.path.startsWith('parcels[')) return true;
  // Interest-rate levers per facility: the effective-rate components (interbank
  // rate + credit spread) the engine actually reads, plus the legacy single
  // interestRatePct (live only on facilities without components; otherwise gated).
  if (/(interbankRatePct|creditSpreadPct|interestRatePct)$/.test(f.field) && f.path.startsWith('financingTranches[')) return true;
  if (/debtPct$/.test(f.field) && f.path.startsWith('project.financing')) return true;
  return false;
}

/** Turn one round-trip-safe field into its human-readable descriptor. With a
 *  GridContext, attribution resolves ids to asset / phase / facility names. */
export function describeAssumption(f: OverridableField, ctx?: GridContext): AssumptionDescriptor {
  const category = categoryOf(f.path);

  // ── Construction / capex: cost-line OR per-asset cost-override value. ──
  const isMasterCost = f.path.startsWith('costLines[') && f.field === 'value';
  const isOverrideCost = f.path.startsWith('costOverrides[') && f.field === 'value';
  if (isMasterCost || isOverrideCost) {
    let baseId = '';
    let context = entityContext(f.group);
    if (isOverrideCost) {
      const sel = selectorOf(f.path, 'costOverrides'); // assetId::lineId
      const [assetId, lineId] = (sel ?? '').split('::');
      baseId = deriveLineBaseId(lineId ?? '');
      if (ctx) {
        const asset = ctx.assets.get(assetId ?? '')?.name;
        const phaseId = ctx.costLines.get(lineId ?? '')?.phaseId;
        context = join([asset, phaseId ? ctx.phases.get(phaseId) : undefined]);
      }
    } else {
      const lineId = selectorOf(f.path, 'costLines') ?? '';
      const line = ctx?.costLines.get(lineId);
      baseId = line?.baseId ?? deriveLineBaseId(lineId);
      if (ctx) {
        const asset = line?.targetAssetId ? ctx.assets.get(line.targetAssetId)?.name : undefined;
        context = join([asset, line?.phaseId ? ctx.phases.get(line.phaseId) : undefined]);
      }
    }
    const label = COST_LINE_LEVER_LABELS[baseId] ?? humanizeLeaf(baseId || 'value');
    return { label, context, category, format: formatForField(f, baseId), curated: CONSTRUCTION_LEVER_IDS.has(baseId) };
  }

  // ── Land: per-parcel purchase price (rate per sqm) + parcel attributes. ──
  // Land cost lines are locked and derive from the parcels, so the real land
  // price lever is Parcel.rate. Surface it under Construction & Capex.
  if (f.path.startsWith('parcels[')) {
    const id = selectorOf(f.path, 'parcels') ?? '';
    const context = ctx?.parcels.get(id) ?? entityContext(f.group);
    const PARCEL_LABELS: Record<string, string> = {
      rate: 'Land purchase price (per sqm)',
      area: 'Land area (sqm)',
      cashPct: 'Land cost (cash) %',
      inKindPct: 'Land cost (in-kind) %',
    };
    const label = PARCEL_LABELS[f.field] ?? humanizeLeaf(f.field);
    return { label, context, category: 'construction', format: formatForField(f), curated: isCuratedField(f) };
  }

  // ── Attribution for the other entity rows. ──
  let context = entityContext(f.group);
  if (ctx) {
    if (f.path.startsWith('subUnits[')) {
      const id = selectorOf(f.path, 'subUnits') ?? '';
      const su = ctx.subUnits.get(id);
      const asset = su?.assetId ? ctx.assets.get(su.assetId)?.name : undefined;
      context = su ? `${su.name}${asset ? ` (${asset})` : ''}` : context;
    } else if (f.path.startsWith('assets[')) {
      const id = selectorOf(f.path, 'assets') ?? '';
      const a = ctx.assets.get(id);
      context = a ? join([a.name, a.phaseId ? ctx.phases.get(a.phaseId) : undefined]) : context;
    } else if (f.path.startsWith('financingTranches[')) {
      const id = selectorOf(f.path, 'financingTranches') ?? '';
      const t = ctx.tranches.get(id);
      context = t ? join([t.name, t.phaseId ? ctx.phases.get(t.phaseId) : undefined]) : context;
    } else if (f.path.startsWith('project.financing.')) {
      // Per-parcel funding split -> parcel; named method config -> method label.
      const pf = /parcelFunding\[parcelId=([^\]]+)\]/.exec(f.path);
      if (pf) {
        context = ctx.parcels.get(pf[1]) ?? `Parcel ${pf[1]}`;
      } else {
        const seg = f.path.slice('project.financing.'.length).split('.')[0];
        context = FINANCING_CONFIG_LABELS[seg] ?? context;
      }
    }
  }

  let label = FIELD_LABELS[f.field];
  if (!label) { for (const [re, l] of SUFFIX_LABELS) if (re.test(f.field)) { label = l; break; } }
  if (!label) label = humanizeLeaf(f.field);
  return { label, context, category, format: formatForField(f), curated: isCuratedField(f) };
}

/** Best-effort descriptor for a path that may not be in the live catalog. */
export function assumptionFor(path: string, field: OverridableField | undefined, value: unknown, ctx?: GridContext): AssumptionDescriptor {
  if (field) return describeAssumption(field, ctx);
  const firstDot = path.indexOf('.');
  const leaf = firstDot === -1 ? path : path.slice(firstDot + 1);
  const t = typeof value;
  const synthetic: OverridableField = {
    path, group: '', field: leaf,
    value: value as OverridableField['value'],
    type: (t === 'number' || t === 'boolean') ? t : 'string',
  };
  return describeAssumption(synthetic, ctx);
}

/** The curated key-driver fields shown by default. MODEL-AWARE for construction:
 *  per-asset cost overrides (the real rates) win over the phase-level master, and
 *  zero / disabled / unused levers are dropped so no stale seed defaults show. */
export function curatedDefaultFields(model: HydrateSnapshot): OverridableField[] {
  const ctx = buildGridContext(model);
  const all = enumerateOverridableFields(model);
  const byPath = new Map(all.map((f) => [f.path, f]));
  const out: OverridableField[] = [];

  // 1. Non-cost curated key drivers.
  for (const f of all) {
    if (f.path.startsWith('costLines[') || f.path.startsWith('costOverrides[')) continue;
    if (isCuratedField(f)) out.push(f);
  }

  // 2. Construction cost levers, sourced per asset where overrides exist.
  for (const [lineId, line] of ctx.costLines) {
    if (!CONSTRUCTION_LEVER_IDS.has(line.baseId) || line.disabled) continue;
    const active = (ctx.activeOverridesByLine.get(lineId) ?? []).filter((o) => Number(o.value) !== 0);
    if (active.length > 0) {
      for (const o of active) {
        const fld = byPath.get(`costOverrides[${o.assetId}::${o.lineId}].value`);
        if (fld) out.push(fld);
      }
    } else if (Number(line.value) !== 0) {
      const fld = byPath.get(`costLines[id=${lineId}].value`);
      if (fld) out.push(fld);
    }
    // else: zero master + no active overrides -> unused, dropped.
  }
  return out;
}

// ── Non-economic / structural fields: NEVER a financial scenario lever ───────
// These round-trip the diff grammar (so the catalog can technically address
// them) but are identity, structure, display / UI view-state, engine-derived
// geometry, seed-only templates, legacy fields or timeline indices that a
// value-only override cannot drive. The Module 6 picker DROPS them so the user
// is never offered a control that does nothing. Distinct from inactiveLeverReason
// (config-inert ECONOMIC levers, which stay visible, annotated "not used under
// current settings"): these are dropped entirely because they are non-economic
// regardless of any configuration.

// Leaf names that are non-economic for every entity.
const NON_ECONOMIC_LEAVES: Record<string, string> = {
  name: 'a label', status: 'a status flag', type: 'an entity type', location: 'a location label',
  projectType: 'a project-type selector', phaseId: 'an entity reference', parentAssetId: 'an entity reference',
  companionType: 'a structural flag', subUnitMetric: 'a unit-of-measure selector', id: 'an identifier',
  projectNdaScope: 'a scope selector', modelType: 'a model-type selector',
  viewMode: 'a UI view setting', assetFilter: 'a UI filter', phaseFilter: 'a UI filter',
  resultsViewMode: 'a UI view setting', outputGranularity: 'an output-granularity setting',
  displayScale: 'a display setting', displayDecimals: 'a display setting', currency: 'a display currency',
  financialTerminology: 'a terminology (labels-only) setting', useScenarios: 'the scenario on/off control',
  scenarioPriorCaseId: 'an internal control reference', isLocked: 'a structural lock flag',
  // engine-derived geometry: GFA / sellable BUA / parking bays / companion units
  // are computed (from sub-units or the parent), not a direct dial here.
  gfaSqm: 'engine-derived geometry', sellableBuaSqm: 'engine-derived geometry',
  parkingBaysRequired: 'engine-derived geometry', unitsFromParent: 'engine-derived (from the parent asset)',
};

// Structural SELECTORS: enum fields that define HOW an entity is set up (its
// category / scope / phasing curve / method), not a numeric assumption value a
// scenario dials. A scenario varies values, it does not restructure the model.
const STRUCTURAL_SELECTOR_PATTERNS: ReadonlyArray<RegExp> = [
  /^costLines\[[^\]]+\]\.(costCategory|scope|stage|allocationBasis|method|phasing)$/,
  /^costOverrides\[[^\]]+\]\.(phasing|method)$/,
  /^subUnits\[[^\]]+\]\.(metric|category|parentSubUnitId)$/,
  /^financingTranches\[[^\]]+\]\.(origin|scope|scopeId|interestRateType|graceInterestTreatment|equalRepaymentSubMethod|repaymentSubMethod|repaymentMethod|drawdownMethod)$/,
];

/** A reason string when `path` is a non-economic / structural field that must be
 *  dropped from the override catalog, or null when it is a legitimate dial. Pure
 *  (no model needed): the classification is structural, not config-dependent. */
export function nonEconomicLeverReason(path: string, field: string): string | null {
  const leaf = field.split('.').pop() ?? field;
  const desc = NON_ECONOMIC_LEAVES[leaf];
  if (desc) return `${desc}, not a financial assumption`;
  for (const re of STRUCTURAL_SELECTOR_PATTERNS) {
    if (re.test(path)) return 'a structural selector (defines how the line / unit / facility is set up, not a numeric assumption)';
  }
  // Calendar dates + absolute position indices: a value-only scenario override
  // does NOT re-derive the period axis (the timeline cascade is intentionally not
  // run), so these cannot work as single-value scenario levers. NOTE: timeline
  // DURATIONS (constructionPeriods / operationsPeriods / overlapPeriods) ARE read
  // by the axis builder and DO move results, so they are deliberately NOT here.
  if (/\.startDate$/.test(path) || path === 'project.startDate') return 'a calendar date; a value-only override does not re-derive the period axis (timeline cascade is not run)';
  if (/^phases\[[^\]]+\]\.constructionStart$/.test(path)) {
    return 'an absolute period/position index; a value-only override does not re-derive the period axis (cascade not run)';
  }
  // Project-level revenue TEMPLATES seed NEW assets only; existing assets carry
  // their own values, so the template is never read for the live model.
  if (/^project\.revenueTemplates\./.test(path)) return 'a template default that only seeds new assets; existing assets carry their own values';
  // Per-phase dividend policy is legacy: dividends are now a single project-level
  // policy (project.dividendPolicy), so the per-phase fields are unused.
  if (/^phases\[[^\]]+\]\.dividendPolicy\./.test(path)) return 'dividends are a single project-level policy; per-phase dividend fields are legacy and unused';
  // Existing-operations / historical baseline inputs are not consumed by the
  // scenario compute pipeline (audit finding: see verify-module6-field-census).
  if (/\.historicalBaseline\./.test(path) || /\.(historicalPreCapex|historicalDebtAmount)$/.test(path)) {
    return 'an existing-operations baseline input; not consumed by the scenario compute pipeline (audit finding)';
  }
  return null;
}

const PER_PERIOD_INDEXATION_METHODS = new Set(['yoy_per_period']);

/**
 * Why a lever cannot move results under the model's CURRENT configuration, or
 * null when it is active. Confirmed empirically against live projects (see
 * verify-module6-field-census.ts, run on FMP RE HUB): the grid was offering
 * levers the engine ignores under the active config, e.g. the fixed-ratio Debt %
 * when funding is gap-sized, a hotel's single occupancy field when revenue runs
 * off per-period occupancy, or an ADR-indexation RATE when the method reads a
 * per-period series. Offering a dead lever is exactly what made the comparison
 * read as a broken override pipeline. Callers drop these from the curated default
 * set and label them "not used under current settings" so the user is never given
 * a control that does nothing. These are ECONOMIC levers that are inert under THIS
 * config (still shown, annotated); non-economic/structural fields are handled by
 * nonEconomicLeverReason (dropped entirely).
 */
export function inactiveLeverReason(path: string, model: HydrateSnapshot): string | null {
  const m = model as unknown as { project?: any; assets?: Asset[]; subUnits?: SubUnit[] };
  const proj = m.project ?? {};
  const fundingMethod = Number(proj.financing?.fundingMethod ?? 1);
  const terminalMethod = proj.returns?.terminalMethod ?? 'exit_multiple';
  const assetById = (id: string): any => (m.assets ?? []).find((a) => a.id === id);
  const subUnitById = (id: string): any => (m.subUnits ?? []).find((u) => u.id === id);

  // ── Funding-method config blocks: only the active method's block is read.
  //    Method 1 = fixedRatio, 2 = netFundingConfig, 3 = cashDeficitConfig,
  //    4 = fixedAmountConfig. ──
  const FUNDING_BLOCK: Record<string, number> = { fixedRatio: 1, netFundingConfig: 2, cashDeficitConfig: 3, fixedAmountConfig: 4 };
  const fb = /^project\.financing\.(fixedRatio|netFundingConfig|cashDeficitConfig|fixedAmountConfig)\./.exec(path);
  if (fb) {
    const wantMethod = FUNDING_BLOCK[fb[1]];
    if (wantMethod !== fundingMethod) {
      return `Funding method ${fundingMethod} is active; the ${FINANCING_CONFIG_LABELS[fb[1]] ?? fb[1]} inputs are not used`;
    }
    // Active method, but the cash-position scalars only bind when the deficit
    // actually draws on them; under the current funding plan they are inert.
    if (/\.(initialCash|minimumCashReserve|existingCash)$/.test(path)) {
      return 'a secondary funding input; it only binds when the funding gap draws on it (no effect under the current plan)';
    }
  }
  // Per-parcel funding split: not used unless the parcel is fixed-ratio funded.
  const pf = /^project\.financing\.parcelFunding\[parcelId=([^\]]+)\]\.(debtPct|equityPct|fundingType)$/.exec(path);
  if (pf) {
    const parcelCfg = (proj.financing?.parcelFunding ?? []).find((x: any) => String(x.parcelId) === pf[1]);
    const ft = parcelCfg?.fundingType ?? '100pct_equity';
    if (ft !== 'fixed_ratio' || pf[2] === 'fundingType') {
      return `This parcel is funded ${ft.replace(/_/g, ' ')}; the per-parcel funding split is not the funding driver`;
    }
  }
  // Single interest-rate field: ignored by the engine when the facility carries
  // rate COMPONENTS (interbank rate + credit spread), which is the effective rate
  // it reads (schedule.ts). On such facilities the live levers are the interbank
  // rate + credit spread (surfaced + curated separately), so the single
  // interestRatePct is a dead control and is gated here. A facility WITHOUT
  // components still reads interestRatePct, so it stays a live lever there.
  const irate = /^financingTranches\[id=([^\]]+)\]\.interestRatePct$/.exec(path);
  if (irate) {
    const t = ((model as unknown as { financingTranches?: Array<{ id: string; interbankRatePct?: number; creditSpreadPct?: number }> }).financingTranches ?? [])
      .find((x) => x.id === irate[1]);
    if (t && (t.interbankRatePct !== undefined || t.creditSpreadPct !== undefined)) {
      return 'This facility\'s rate is set by the interbank rate + credit spread; the single interest rate field is not used';
    }
  }
  // Other explicit tranche terms: debt is sized centrally (by the funding method
  // or from the existing facilities), so a facility's own sizing / repayment
  // terms are not the funding driver. (Interest-rate COMPONENTS are deliberately
  // NOT here: they drive the interest cost on drawn debt and are live levers.)
  if (/^financingTranches\[[^\]]+\]\.(baseRate|ltvPct|facilitySharePct|repaymentPeriods|repaymentStartYear|remainingRepaymentPeriods|upfrontFeePct|drawdownStartPeriod|idcCapitalize|autoGenerateIdcCostLine)$/.test(path)
      || /^financingTranches\[[^\]]+\]\.cashSweepConfig\.startingYear$/.test(path)) {
    return fundingMethod === 1
      ? 'Fixed-ratio funding is active; explicit tranche terms are not used'
      : `Debt is sized by funding method ${fundingMethod}; this facility's explicit terms are not the funding driver`;
  }

  // ── Terminal value: only one of exit multiple / perpetuity growth drives it. ──
  if (path === 'project.returns.perpetuityGrowth' && terminalMethod !== 'perpetuity') {
    return 'Terminal value uses an exit multiple; perpetuity growth is not used';
  }
  if (path === 'project.returns.exitMultiple' && terminalMethod !== 'exit_multiple') {
    return 'Terminal value uses perpetuity growth; the exit multiple is not used';
  }

  // ── Cross-strategy revenue blocks: an asset reads only its strategy's block. ──
  const rev = /^assets\[id=([^\]]+)\]\.revenue\.(operate|sell|lease)\./.exec(path);
  if (rev) {
    const asset = assetById(rev[1]);
    const strat = asset?.strategy as string | undefined;
    const block = rev[2];
    const used = block === 'operate' ? strat === 'Operate'
      : block === 'sell' ? (strat === 'Sell' || strat === 'Sell + Manage')
      : /* lease */ strat === 'Lease';
    if (strat && !used) {
      return `Asset strategy is "${strat}"; the ${block} revenue block is not used`;
    }
  }
  // Management agreement: only Sell + Manage assets earn a management fee, and a
  // Sell + Manage asset with a companion Operate asset models its management
  // revenue on the companion, so the parent fields are not read.
  const mgmt = /^assets\[id=([^\]]+)\]\.managementAgreement\./.exec(path);
  if (mgmt) {
    const strat = assetById(mgmt[1])?.strategy;
    if (strat !== 'Sell + Manage') return `Asset strategy is "${strat}"; the management-agreement inputs are not used`;
    const hasCompanion = (m.assets ?? []).some((a) => (a as any).parentAssetId === mgmt[1]);
    if (hasCompanion) return 'Management revenue is modelled on this asset\'s companion Operate asset; the parent management-agreement fields are not used';
  }

  // ── Indexation. A per-period method reads a per-period SERIES, so the scalar
  //    RATE is not used (the same class as the occupancy lever); start-year +
  //    method still bind. When indexation is OFF ('none') nothing escalates, so
  //    rate + start-year are dead (the method itself is the switch and stays
  //    live). A scalar method with a zero rate is a LIVE activation lever (set
  //    it to switch indexation on), so it is NOT gated. ──
  const idx = /^assets\[id=([^\]]+)\]\.revenue\.(operate|sell|lease)\.(adrIndexation|indexation|rentIndexation)\.(rate|startYear|method)$/.exec(path);
  if (idx) {
    const asset = assetById(idx[1]);
    const cfg = asset?.revenue?.[idx[2]]?.[idx[3]];
    const method = cfg?.method as string | undefined;
    if (idx[4] === 'rate' && method && PER_PERIOD_INDEXATION_METHODS.has(method)) {
      return 'Indexation uses a per-period series (method "yoy per period"); this single rate is not used';
    }
    if (method === 'none') {
      // Off entirely: rate, start-year AND the method switch are all dead (with a
      // zero rate, switching the method on still escalates nothing).
      return 'Indexation is off (method "none") for this asset; nothing to escalate';
    }
    if (idx[4] !== 'rate' && Number(cfg?.rate) === 0 && !(method && PER_PERIOD_INDEXATION_METHODS.has(method))) {
      // Scalar method with a zero rate: the RATE is the live activation lever (set
      // it to switch indexation on), but the method / start-year do nothing until
      // a rate is entered. (A per-period method drives off its series, so its
      // method + start-year stay live even at a zero scalar rate.)
      return 'Indexation rate is zero; the method / start-year do nothing until a rate is set';
    }
  }

  // ── Operate (hospitality) asset-level detail: revenue runs off per-sub-unit
  //    (keys: ADR / occupancy) and per-period inputs, so the asset-level operate
  //    scalars are not the driver. NOTE: fb.mode / otherRevenue.mode DO move (they
  //    switch how F&B / other revenue is computed) and are deliberately NOT here. ──
  const opDetail = /^assets\[id=([^\]]+)\]\.revenue\.operate\.(startingADR|dso|guestsPerOccupiedRoom|rentalPoolMode)$/.exec(path)
    || /^assets\[id=([^\]]+)\]\.revenue\.operate\.(fb|otherRevenue)\.(ratePerGuest)$/.exec(path);
  if (opDetail) {
    const asset = assetById(opDetail[1]);
    if (asset?.strategy === 'Operate') return 'Hospitality revenue is driven by per-sub-unit (ADR / occupancy) and per-period inputs; this asset-level operate detail has no headline-KPI effect';
  }
  // Other-revenue MODE switches how that revenue is computed, but has nothing to
  // scale when other revenue is off for the asset (here: zero on these assets).
  // NOTE: F&B mode (fb.mode) DOES move (F&B scales off the sub-unit room revenue,
  // which exists even at a zero asset-level ADR), so it is deliberately NOT here.
  const opMode = /^assets\[id=([^\]]+)\]\.revenue\.operate\.otherRevenue\.mode$/.exec(path);
  if (opMode) {
    const asset = assetById(opMode[1]);
    if (asset?.strategy === 'Operate' && !(Number(asset?.revenue?.operate?.startingADR) > 0)) {
      return 'Other revenue is not active for this Operate asset; the other-revenue mode has nothing to scale';
    }
  }
  // Companion (rental-pool Operate) asset: depreciation is modelled on its parent
  // asset, so the companion's useful life is not used.
  const life = /^assets\[id=([^\]]+)\]\.usefulLifeYears$/.exec(path);
  if (life) {
    const asset = assetById(life[1]);
    if (asset && ((asset as any).parentAssetId || (asset as any).companionType)) {
      return 'Companion asset; depreciation is modelled on the parent asset, so its useful life is not used';
    }
  }

  // ── Sub-unit Occupancy %: hospitality (Operate) revenue runs off per-period
  //    occupancy on the asset's operate config, NOT this single sub-unit field. ──
  const occ = /^subUnits\[id=([^\]]+)\]\.occupancyPct$/.exec(path);
  if (occ) {
    const asset = assetById(subUnitById(occ[1])?.assetId ?? '');
    if (asset?.strategy === 'Operate') {
      return 'Hospitality revenue uses per-period occupancy; this single occupancy field is not used';
    }
  }
  // ── Sub-unit price / area vs operating margin. unit price / area are priced
  //    drivers for Sell / Lease sub-units but unused for an ADR-driven Operate
  //    sub-unit; unit area is also unused when the asset prices per UNIT (metric
  //    'units'); operating margin is not consumed by the current opex model
  //    (opex is itemised via the opex lines). ──
  const suField = /^subUnits\[id=([^\]]+)\]\.(unitPrice|unitArea|operatingMargin)$/.exec(path);
  if (suField) {
    const asset = assetById(subUnitById(suField[1])?.assetId ?? '');
    const strat = asset?.strategy as string | undefined;
    if (suField[2] === 'operatingMargin') {
      return 'Sub-unit operating margin is not consumed by the current opex model (opex is itemised via the opex lines)';
    }
    if (suField[2] === 'unitArea') {
      // Per-unit area is inert when: priced by total area (metric "area"); the
      // sub-unit's asset is a companion (built area sits on the parent); or the
      // asset is in an operational phase (its build is historical). A units-metric
      // construction sub-unit DOES use it (area x units drives build area).
      const su = subUnitById(suField[1]);
      const ph = asset?.phaseId ? (m as any).phases?.find((p: any) => p.id === asset.phaseId) : undefined;
      if (su?.metric === 'area') return 'This sub-unit is priced by total area (metric "area"); the per-unit area is not used';
      if ((asset as any)?.parentAssetId || (asset as any)?.companionType) return 'Companion sub-unit; its built area sits on the parent asset, so the per-unit area is not used';
      if (ph?.status === 'operational') return 'This sub-unit is in an operational phase; its per-unit area is historical, not in the forward build';
    }
    if (suField[2] === 'unitPrice' && ((asset as any)?.parentAssetId || (asset as any)?.companionType)) {
      return 'Companion sub-unit; revenue is modelled on the parent asset\'s rental pool, so its unit price is not used';
    }
  }

  // ── Asset-level geometry. Land area / units are entered per sub-unit (so the
  //    asset-level value is unused), and BUA / land allocation on an already
  //    OPERATIONAL phase asset are historical (the live BUA / land levers are the
  //    construction-phase assets, which DO move). ──
  const geomAsset = /^assets\[id=([^\]]+)\]\.(buaSqm|landAllocation\.sqm)$/.exec(path);
  if (geomAsset) {
    const asset = assetById(geomAsset[1]);
    const ph = asset?.phaseId ? (m as any).phases?.find((p: any) => p.id === asset.phaseId) : undefined;
    if (ph?.status === 'operational') return 'This asset is in an operational phase; its BUA / land allocation are historical, not in the forward projection';
    // A companion (rental-pool) asset builds nothing of its own (its build sits on
    // the parent), and a Sell asset that enters built area per sub-unit (area
    // metric) derives its BUA from the sub-units, so the asset-level BUA is unused.
    if (geomAsset[2] === 'buaSqm') {
      if ((asset as any)?.parentAssetId || (asset as any)?.companionType) return 'Companion asset; its built area sits on the parent asset, so the asset-level BUA is not used';
      if (asset?.strategy === 'Sell' && (asset as any)?.subUnitMetric === 'area') return 'This Sell asset enters built area per sub-unit (area metric); the asset-level BUA is not used';
    }
  }
  if (/^assets\[id=([^\]]+)\]\.landAreaSqm$/.test(path)) {
    const id = /^assets\[id=([^\]]+)\]/.exec(path)![1];
    if ((m.subUnits ?? []).some((u) => (u as any).assetId === id)) return 'Area is entered per sub-unit; this asset-level land area value is not used';
  }
  // Sell-recognition timing detail: the handover year is used only under a
  // point-in-time method; the profile mode is used only under an over-time method.
  const recDetail = /^assets\[id=([^\]]+)\]\.revenue\.sell\.recognitionProfile\.(pointInTimeYear|profileMode)$/.exec(path);
  if (recDetail) {
    const method = assetById(recDetail[1])?.revenue?.sell?.recognitionProfile?.method;
    if (recDetail[2] === 'pointInTimeYear' && method && method !== 'point_in_time') return 'Revenue is recognised over time; the point-in-time handover year is not used';
    if (recDetail[2] === 'profileMode' && method === 'point_in_time') return 'Revenue is recognised at a point in time; the over-time profile mode is not used';
  }
  // Working-capital timing (operate DSO / lease AR days): affects balance-sheet
  // and cash phasing, not a headline comparison KPI.
  if (/^assets\[id=[^\]]+\]\.revenue\.(operate\.dso|lease\.arDays)$/.test(path)) {
    return 'Working-capital timing; affects balance-sheet / cash phasing, no headline comparison KPI';
  }

  // ── Operational phases: their forward operations / overlap period counts are
  //    fixed by the operational baseline, so overriding them does nothing. ──
  const phPeriods = /^phases\[id=([^\]]+)\]\.(operationsPeriods|overlapPeriods)$/.exec(path);
  if (phPeriods) {
    const ph = (m as any).phases?.find((p: any) => p.id === phPeriods[1]);
    if (ph?.status === 'operational') return 'This phase is already operational; its forward operations / overlap period counts are not used';
  }

  // Land cost lines. Land is funded in-kind here, so the cash-land line value
  // contributes nothing; and land cost is incurred upfront, so neither land line's
  // phasing (start / end period) is used. (The in-kind land VALUE still moves and
  // stays active.)
  const landLine = /^costLines\[id=([^\]]+)\]\.(value|startPeriod|endPeriod|disabled)$/.exec(path);
  if (landLine) {
    const baseId = deriveLineBaseId(landLine[1]);
    if (baseId === 'land-cash' || baseId === 'land-inkind') {
      if (landLine[2] === 'startPeriod' || landLine[2] === 'endPeriod') {
        return 'Land cost is incurred upfront; the land cost-line phasing (start / end period) is not used';
      }
      if (baseId === 'land-cash') return 'Land is funded in-kind here; the cash-land cost line contributes nothing (use the per-parcel land price)';
    }
  }
  // ── Master cost-line fields on an already-OPERATIONAL phase: the costs are
  //    historical, not in the forward projection. (Construction-phase master cost
  //    lines DO move and are left active even when some assets also override them.) ──
  const cl = /^costLines\[id=([^\]]+)\]\./.exec(path);
  if (cl) {
    const line = ((model as unknown as { costLines?: CostLine[] }).costLines ?? []).find((l) => l.id === cl[1]);
    const ph = line?.phaseId ? (m as any).phases?.find((p: any) => p.id === line.phaseId) : undefined;
    if (ph?.status === 'operational') return 'This cost line belongs to an operational phase; its costs are historical, not in the forward projection';
  }
  // Cost overrides. An inactive override (overridden=false / disabled) tracks the
  // master, so its value does nothing; a parking override has nothing to multiply
  // when the asset requires no parking bays.
  const co = /^costOverrides\[([^:]+)::([^\]]+)\]\.(value|startPeriod|endPeriod|overridden)$/.exec(path);
  if (co) {
    const ov = ((model as unknown as { costOverrides?: CostOverride[] }).costOverrides ?? [])
      .find((o) => o.assetId === co[1] && o.lineId === co[2]);
    if (ov && (ov.overridden === false || ov.disabled)) return 'This per-asset override is inactive (it tracks the master); its value is not used';
    // Parking cost is rate x parking AREA; an asset with no parking area has
    // nothing for the parking rate / phasing to act on.
    if (deriveLineBaseId(co[2]) === 'construction-parking' && !(Number(assetById(co[1])?.parkingArea) > 0)) {
      return 'This asset has no parking area; the parking cost rate has nothing to multiply';
    }
    // Commission is a revenue-driven cost recognised WITH the sale, so a
    // commission override's own phasing (start / end period) is not used.
    if (deriveLineBaseId(co[2]) === 'commission' && (co[3] === 'startPeriod' || co[3] === 'endPeriod')) {
      return 'Commission is a revenue-driven cost recognised with the sale; the override phasing (start / end period) is not used';
    }
    // Parking override activation toggle is a no-op: with no parking area there is
    // nothing to cost, and where parking is costed the per-asset override
    // duplicates the master rate, so flipping "overridden" changes nothing.
    if (deriveLineBaseId(co[2]) === 'construction-parking' && co[3] === 'overridden') {
      return 'Parking override activation toggle; it duplicates the master parking rate (or the asset has no parking area), so it changes nothing';
    }
    // Parking override phasing only binds when the asset actually carries parking
    // area to cost.
    if (deriveLineBaseId(co[2]) === 'construction-parking' && (co[3] === 'startPeriod' || co[3] === 'endPeriod')
        && !(Number(assetById(co[1])?.parkingArea) > 0)) {
      return 'This asset has no parking area; the parking override phasing changes nothing';
    }
  }

  // ── Opex inflation: only escalates fixed-cost opex lines. ──
  const opex = /^assets\[id=([^\]]+)\]\.opex\.defaultIndexation\.(rate|startYear|method)$/.exec(path);
  if (opex) {
    const asset = assetById(opex[1]) as (Asset & { opex?: { lines?: Array<{ mode?: string; disabled?: boolean }> } }) | undefined;
    const lines = asset?.opex?.lines ?? [];
    const FIXED = ['fixed_baseline', 'per_room_year', 'per_sqm_year'];
    const hasFixed = lines.some((l) => FIXED.indexOf(l.mode ?? '') >= 0 && l.disabled !== true);
    if (asset?.opex && lines.length > 0 && !hasFixed) {
      return 'This asset has no fixed-cost opex lines; an inflation rate only escalates fixed-cost lines';
    }
  }

  // ── Lease base rate: only a fallback when a sub-unit carries no per-unit rent. ──
  const lease = /^assets\[id=([^\]]+)\]\.revenue\.lease\.baseRate$/.exec(path);
  if (lease) {
    const priced = (m.subUnits ?? []).some((u) => (u as { assetId?: string }).assetId === lease[1] && Number((u as { unitPrice?: number }).unitPrice) > 0);
    if (priced) return 'Lease revenue uses per-unit rent (unit price); the base rate is only a fallback';
  }

  // ── NDA / parks / roads deductions: inert when the deduction is off / zero. ──
  if (/^(project\.projectParksPct|project\.projectRoadsPct)$/.test(path) && !(Number(proj.projectParksPct) > 0 || Number(proj.projectRoadsPct) > 0)) {
    return 'No parks / roads deduction is configured; this rate has no land area to reduce';
  }
  const parcelDed = /^parcels\[id=([^\]]+)\]\.(parksPct|roadsPct|hasNdaDeduction)$/.exec(path);
  if (parcelDed) {
    return 'NDA / parks / roads deduction is not active for this parcel; the input has no effect';
  }
  if (path === 'project.projectNdaEnabled' || path === 'project.country') {
    return path === 'project.country'
      ? 'Country is blank / terminology-only here; it does not change the computed numbers'
      : 'No NDA area deduction is configured; the toggle has no land area to act on';
  }

  return null;
}

// ── Item-grouped layout (Option 2) + applied-value test ─────────────────────
export interface GridRowLite { path: string; descriptor: AssumptionDescriptor; }
export interface GridItem {
  /** Assumption-type heading, e.g. "Construction cost rate (per BUA)". */
  label: string;
  /** True when the item is entity-scoped (a sub-heading + one row per entity).
   *  False for a single project-level value (Discount rate etc.) shown as one row. */
  grouped: boolean;
  rows: GridRowLite[];
}
export interface GridCategoryGroup { category: AssumptionCategory; label: string; items: GridItem[]; }

/** Whether a Management value counts as an applied lever. Zero / undefined /
 *  empty are "not applied" and the grid suppresses such rows (unless the field
 *  is overridden in a case). Booleans are always applied. */
export function isAppliedValue(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

/** Option 2 layout: bucket rows into category groups (in Inputs-tab order), then
 *  by assumption item (descriptor.label). An item with any entity-scoped row
 *  becomes a sub-heading with one row per entity; a purely project-level item
 *  stays a single standalone row. Insertion order is preserved (curated first).
 *  Pure: suppression of unused rows happens BEFORE this, in the caller. */
export function groupAssumptionRows(rows: GridRowLite[]): GridCategoryGroup[] {
  const byCat = new Map<AssumptionCategory, GridRowLite[]>();
  for (const r of rows) {
    const arr = byCat.get(r.descriptor.category) ?? [];
    arr.push(r); byCat.set(r.descriptor.category, arr);
  }
  return ASSUMPTION_CATEGORY_ORDER
    .filter((c) => (byCat.get(c)?.length ?? 0) > 0)
    .map((c) => {
      const catRows = byCat.get(c)!;
      const itemMap = new Map<string, GridRowLite[]>();
      const order: string[] = [];
      for (const r of catRows) {
        if (!itemMap.has(r.descriptor.label)) { itemMap.set(r.descriptor.label, []); order.push(r.descriptor.label); }
        itemMap.get(r.descriptor.label)!.push(r);
      }
      const items: GridItem[] = order.map((label) => {
        const rs = itemMap.get(label)!;
        const grouped = rs.some((r) => r.descriptor.context.trim() !== '');
        return { label, grouped, rows: rs };
      });
      return { category: c, label: ASSUMPTION_CATEGORY_LABELS[c], items };
    });
}

// ── Value formatting + parsing (display in the right unit, store correctly) ──
const SUFFIX_FOR: Record<AssumptionFormat, string> = {
  'percent-fraction': '%', 'percent-whole': '%', accounting: '', number: '', text: '', boolean: '',
};
export function assumptionUnitSuffix(format: AssumptionFormat): string {
  return SUFFIX_FOR[format] ?? '';
}

/** Render a stored value in its display unit (percent at 2dp, accounting grouped). */
export function formatAssumptionValue(value: unknown, format: AssumptionFormat): string {
  if (value === undefined || value === null) return '';
  if (format === 'boolean') return String(value === true || value === 'true');
  if (format === 'text') return String(value);
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  switch (format) {
    case 'percent-fraction': return (n * 100).toFixed(2);
    case 'percent-whole': return n.toFixed(2);
    case 'accounting': return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    default: return String(n);
  }
}

/** Parse a user-typed display value back to the stored scale. Null = invalid. */
export function parseAssumptionInput(raw: string, format: AssumptionFormat): number | null {
  const cleaned = raw.replace(/[,%\s]/g, '');
  if (cleaned === '') return null;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return format === 'percent-fraction' ? n / 100 : n;
}
