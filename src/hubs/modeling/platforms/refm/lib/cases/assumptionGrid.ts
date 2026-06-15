/**
 * assumptionGrid.ts (2026-06-15): presentation layer for the Module 6 Scenario
 * assumptions grid.
 *
 * This file holds NO override-engine logic: it never mutates a model and never
 * decides what round-trips (that stays in applyOverrides / snapshot-diff). It
 * only turns the round-trip-safe field catalog (enumerateOverridableFields) into
 * something a human reads: a plain-English label, an entity context line, a
 * category for grouping, and whether the field belongs to the curated
 * "key driver" default view. Maintained as explicit maps so labels stay
 * consistent and adding a new lever is a one-line change.
 */
import type { HydrateSnapshot } from '../state/module1-store';
import { enumerateOverridableFields, type OverridableField } from './applyOverrides';
import { deriveLineBaseId } from '../state/module1-types';

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

export interface AssumptionDescriptor {
  /** Plain-English primary label, e.g. "Discount rate", "Construction cost rate (per BUA)". */
  label: string;
  /** Secondary entity context, e.g. "Apartments", "Senior facility". Empty for project-level. */
  context: string;
  category: AssumptionCategory;
  /** Member of the curated key-driver default view. */
  curated: boolean;
}

// ── Construction cost lines surfaced as levers (stable base ids) ────────────
// Cost-line ids are phase-scoped (`${baseId}__${phaseId}`); deriveLineBaseId
// recovers the stable base id so renamed lines + multi-phase projects still map.
const CONSTRUCTION_LEVER_IDS = new Set<string>([
  'construction-bua', 'construction-parking', 'infrastructure', 'landscaping',
  'pre-operating', 'professional-fee', 'contingency',
]);

const COST_LINE_LEVER_LABELS: Record<string, string> = {
  'construction-bua': 'Construction cost rate (per BUA)',
  'construction-parking': 'Parking cost rate (per bay)',
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
// Keyed by OverridableField.field (the leaf path within the entity, e.g.
// "returns.discountRate", "financing.minimumCashReserve", "unitPrice"). Cost
// lines are handled separately (their leaf is just "value").
const FIELD_LABELS: Record<string, string> = {
  // Returns & exit
  'returns.discountRate': 'Discount rate',
  'returns.exitMultiple': 'Exit multiple',
  'returns.perpetuityGrowth': 'Perpetuity growth rate',
  'returns.exitYearOffset': 'Exit year (offset)',
  // Project working capital / tax
  'tax.rate': 'Tax / Zakat rate',
  'operatingAr.dsoDays': 'Receivable days (DSO)',
  'shareCapital': 'Share capital',
  'statutoryReserve.transferRate': 'Statutory reserve transfer rate',
  'statutoryReserve.capOfShareCapital': 'Statutory reserve cap',
  // Financing
  'financing.minimumCashReserve': 'Minimum cash reserve',
  'financing.cashSweep.sweepRatioPct': 'Cash sweep %',
  'financing.netFundingConfig.existingCash': 'Existing cash',
  'financing.cashDeficitConfig.initialCash': 'Initial cash',
  // Revenue (sub-unit)
  'unitPrice': 'Unit price / rate',
  'startingAdr': 'Starting ADR',
  'occupancyPct': 'Occupancy %',
  // Revenue (asset)
  'revenue.operate.startingADR': 'Starting ADR',
  'revenue.operate.adrIndexation.rate': 'ADR indexation',
  'revenue.sell.indexation.rate': 'Sales price indexation',
  'revenue.lease.baseRate': 'Base lease rate',
  'revenue.lease.rentIndexation.rate': 'Rent indexation',
  // Opex
  'opex.defaultIndexation.rate': 'Opex inflation',
  'opex.apDaysOverride': 'Payable days (DPO)',
};

// Suffix fallbacks (applied after an exact miss) keyed on the leaf's tail.
const SUFFIX_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/debtPct$/, 'Debt %'],
  [/equityPct$/, 'Equity %'],
  [/interestRatePct$/, 'Interest rate'],
  [/spreadBps$/, 'Spread (bps)'],
  [/\.rate$/, 'Indexation rate'],
];

// Curated key-driver leaves (non cost-line). Construction levers are curated via
// CONSTRUCTION_LEVER_IDS; financing debt %/interest are curated by suffix below.
const CURATED_LEAVES = new Set<string>([
  'returns.discountRate', 'returns.exitMultiple', 'returns.perpetuityGrowth',
  'tax.rate',
  'unitPrice', 'startingAdr', 'occupancyPct',
  'revenue.operate.startingADR', 'revenue.operate.adrIndexation.rate',
  'revenue.sell.indexation.rate', 'revenue.lease.baseRate', 'revenue.lease.rentIndexation.rate',
  'opex.defaultIndexation.rate',
]);

const ACRONYMS = ['adr', 'nda', 'bua', 'nsa', 'gfa', 'irr', 'dso', 'dpo', 'ga', 'fb', 'dscr', 'ltv', 'ltc'];

// ── Helpers ─────────────────────────────────────────────────────────────────
function extractIdSelector(path: string, key: string): string | null {
  const m = new RegExp(`^${key}\\[id=([^\\]]+)\\]`).exec(path);
  return m ? m[1] : null;
}

function entityContext(group: string): string {
  const idx = group.indexOf(': ');
  return idx === -1 ? '' : group.slice(idx + 2);
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
  if (path.startsWith('costLines[') || path.startsWith('costOverrides[')) return 'construction';
  if (path.startsWith('project.financing') || path.startsWith('financingTranches[')
    || path.startsWith('equityContributions[') || path.includes('parcelFunding[')) return 'financing';
  if (path.includes('.opex.') || path.includes('].opex')) return 'opex';
  if (path.includes('.revenue.') || path.startsWith('subUnits[')) return 'revenue';
  return 'project';
}

function isCuratedField(f: OverridableField): boolean {
  if (CURATED_LEAVES.has(f.field)) return true;
  if (/interestRatePct$/.test(f.field) && f.path.startsWith('financingTranches[')) return true;
  if (/debtPct$/.test(f.field) && f.path.startsWith('project.financing')) return true;
  return false;
}

/** Turn one round-trip-safe field into its human-readable descriptor. */
export function describeAssumption(f: OverridableField): AssumptionDescriptor {
  const category = categoryOf(f.path);
  const context = entityContext(f.group);

  // Construction / capex cost-line value = a named lever.
  if (category === 'construction' && f.path.startsWith('costLines[') && f.field === 'value') {
    const sel = extractIdSelector(f.path, 'costLines');
    const baseId = sel ? deriveLineBaseId(sel) : '';
    const label = COST_LINE_LEVER_LABELS[baseId] ?? (context || 'Cost value');
    return { label, context, category, curated: CONSTRUCTION_LEVER_IDS.has(baseId) };
  }

  let label = FIELD_LABELS[f.field];
  if (!label) { for (const [re, l] of SUFFIX_LABELS) if (re.test(f.field)) { label = l; break; } }
  if (!label) label = humanizeLeaf(f.field);
  return { label, context, category, curated: isCuratedField(f) };
}

/** Best-effort descriptor for a path that may not be in the live catalog (a
 *  stored override on an entity the picker no longer enumerates). Synthesises a
 *  minimal field so the row still reads sensibly. */
export function assumptionFor(path: string, field: OverridableField | undefined, value: unknown): AssumptionDescriptor {
  if (field) return describeAssumption(field);
  const firstDot = path.indexOf('.');
  const leaf = firstDot === -1 ? path : path.slice(firstDot + 1);
  const t = typeof value;
  const synthetic: OverridableField = {
    path, group: '', field: leaf,
    value: value as OverridableField['value'],
    type: (t === 'number' || t === 'boolean') ? t : 'string',
  };
  return describeAssumption(synthetic);
}

/** The curated key-driver fields shown by default in the grid (a subset of the
 *  round-trip-safe catalog). Robust across models: only fields the model carries
 *  appear, and construction levers surface wherever cost lines exist. */
export function curatedDefaultFields(model: HydrateSnapshot): OverridableField[] {
  return enumerateOverridableFields(model).filter((f) => describeAssumption(f).curated);
}
