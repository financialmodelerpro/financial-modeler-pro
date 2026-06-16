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
  [/interestRatePct$/, 'Interest rate'],
  [/spreadBps$/, 'Spread (bps)'],
  [/\.rate$/, 'Indexation rate'],
];

const CURATED_LEAVES = new Set<string>([
  'returns.discountRate', 'returns.exitMultiple', 'returns.perpetuityGrowth',
  // Tax / Zakat rate is intentionally NOT curated: it is constant across cases,
  // so it is noise in the assumptions grid. Still reachable via "Show all".
  'unitPrice', 'startingAdr', 'occupancyPct',
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
  if (/interestRatePct$/.test(f.field) && f.path.startsWith('financingTranches[')) return true;
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

/**
 * Why a lever cannot move results under the model's CURRENT configuration, or
 * null when it is active. Confirmed empirically against live projects: the grid
 * was offering levers that the engine ignores under the active config (e.g. the
 * fixed-ratio Debt % when funding is gap-sized, or a hotel's single occupancy
 * field when revenue runs off per-period occupancy). Offering a dead lever is
 * exactly what made the comparison read as a broken override pipeline. Callers
 * drop these from the curated default set and label them "not used under current
 * settings" so the user is never given a control that does nothing.
 */
export function inactiveLeverReason(path: string, model: HydrateSnapshot): string | null {
  const m = model as unknown as { project?: any; assets?: Asset[]; subUnits?: SubUnit[] };
  const proj = m.project ?? {};
  const fundingMethod = Number(proj.financing?.fundingMethod ?? 1);
  const terminalMethod = proj.returns?.terminalMethod ?? 'exit_multiple';

  // Fixed-ratio Debt / Equity %: only used by Method 1. Methods 2 + 3 gap-size
  // debt from the cash deficit, so the fixed-ratio split is ignored.
  if (/^project\.financing\.fixedRatio\.(debtPct|equityPct)$/.test(path) && fundingMethod !== 1) {
    return `Debt is sized by funding method ${fundingMethod} (gap-sizing); the fixed-ratio split is not used`;
  }
  // Explicit tranche terms: not used under fixed-ratio (Method 1) funding.
  if (/^financingTranches\[[^\]]+\]\.(interestRatePct|ltvPct)$/.test(path) && fundingMethod === 1) {
    return 'Fixed-ratio funding is active; explicit tranche terms are not used';
  }
  // Perpetuity growth vs exit multiple: only one drives terminal value.
  if (path === 'project.returns.perpetuityGrowth' && terminalMethod !== 'perpetuity') {
    return 'Terminal value uses an exit multiple; perpetuity growth is not used';
  }
  if (path === 'project.returns.exitMultiple' && terminalMethod !== 'exit_multiple') {
    return 'Terminal value uses perpetuity growth; the exit multiple is not used';
  }
  // Sub-unit Occupancy %: hospitality (Operate) revenue runs off per-period
  // occupancy on the asset's operate config, NOT this single sub-unit field.
  const occ = /^subUnits\[id=([^\]]+)\]\.occupancyPct$/.exec(path);
  if (occ) {
    const su = (m.subUnits ?? []).find((u) => u.id === occ[1]);
    const asset = su ? (m.assets ?? []).find((a) => a.id === su.assetId) : undefined;
    if (asset?.strategy === 'Operate') {
      return 'Hospitality revenue uses per-period occupancy; this single occupancy field is not used';
    }
  }
  // Opex inflation: only escalates fixed-cost opex lines. An asset whose stored
  // opex is entirely %-of-revenue has nothing for the rate to act on.
  const opex = /^assets\[id=([^\]]+)\]\.opex\.defaultIndexation\.rate$/.exec(path);
  if (opex) {
    const asset = (m.assets ?? []).find((a) => a.id === opex[1]) as (Asset & { opex?: { lines?: Array<{ mode?: string; disabled?: boolean }> } }) | undefined;
    const lines = asset?.opex?.lines ?? [];
    const FIXED = ['fixed_baseline', 'per_room_year', 'per_sqm_year'];
    const hasFixed = lines.some((l) => FIXED.indexOf(l.mode ?? '') >= 0 && l.disabled !== true);
    if (asset?.opex && lines.length > 0 && !hasFixed) {
      return 'This asset has no fixed-cost opex lines; an inflation rate only escalates fixed-cost lines';
    }
  }
  // Lease base rate: only a fallback when a sub-unit carries no per-unit rent.
  const lease = /^assets\[id=([^\]]+)\]\.revenue\.lease\.baseRate$/.exec(path);
  if (lease) {
    const priced = (m.subUnits ?? []).some((u) => (u as { assetId?: string }).assetId === lease[1] && Number((u as { unitPrice?: number }).unitPrice) > 0);
    if (priced) return 'Lease revenue uses per-unit rent (unit price); the base rate is only a fallback';
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
