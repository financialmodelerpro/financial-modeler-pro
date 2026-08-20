/**
 * Default seed line items per strategy.
 *
 * Mirrors KPMG SC7 hospitality hierarchy (Direct rooms / F&B / Other +
 * Indirect G&A / IT / S&M / POM / Energy / EOSB + Mgmt base / tech /
 * incentive + Replacement reserve + Rent & insurance) and a simpler
 * Lease bundle (property management, CAM, utilities, tax, insurance).
 *
 * Default % values are sensible mid-market hospitality benchmarks.
 * Users can edit every line; the engine treats this as a starting
 * point, not a hard-coded rule.
 *
 * Pass 3 (2026-05-19): the 3% YoY inflation seed moved off per-line
 * configs and onto an asset-level default (see defaultOpexIndexation
 * below). Every fixed-cost line is born with useAssetDefault: true so
 * a single asset-level pill drives them all; %-of-revenue + pct_of_gop
 * lines never index regardless of config.
 */

import type { IndexationConfig } from '@/src/core/calculations/revenue/types';
import type { OpexLine } from './types';

const noIdx = { method: 'none' as const };

/** Asset/HQ-level default inflation seed: 3% YoY compound from year 0. */
export function defaultOpexIndexation(): IndexationConfig {
  return { method: 'yoy_compound', rate: 0.03, startYear: 0 };
}

/**
 * Coerce a stored / overridden opex indexation config into a usable one.
 *
 * A scenario override (Module 6 grid) writes a single leaf, so it can set
 * `defaultIndexation.rate` while leaving `method` undefined. Such a config used
 * to be silently dropped: the asset resolver gates on `stored.method` and falls
 * back to the 3% default, and applyIndexation no-ops when `method` is missing.
 * Either way an opex-inflation override never reached the engine. So when a
 * config carries a finite numeric `rate` but no usable `method`, treat it as the
 * platform-standard YoY compound (with that rate) instead of discarding it.
 *
 * A config that already has a `method` is returned unchanged, so existing base
 * results are unaffected: a method-less-but-rated config only ever arises from
 * an override, never from the Module 3 pills (which always set a method).
 */
export function normalizeOpexIndexation(stored: unknown): IndexationConfig {
  const cfg = stored as Partial<IndexationConfig> | null | undefined;
  if (cfg && cfg.method) return cfg as IndexationConfig;
  if (cfg && typeof cfg.rate === 'number' && Number.isFinite(cfg.rate)) {
    return { ...defaultOpexIndexation(), ...cfg, method: 'yoy_compound' };
  }
  return defaultOpexIndexation();
}

let _id = 0;
const nid = (prefix: string): string => `${prefix}-${++_id}-${Math.random().toString(36).slice(2, 8)}`;

export function defaultHospitalityOpexLines(): OpexLine[] {
  _id = 0;
  return [
    // Direct departmental, auto-escalate via revenue, never index.
    { id: nid('rooms'), name: 'Rooms direct cost', category: 'direct_rooms', mode: 'pct_of_room_rev', value: 0, indexation: noIdx },
    { id: nid('fb'), name: 'F&B direct cost', category: 'direct_fb', mode: 'pct_of_fb_rev', value: 0, indexation: noIdx },
    { id: nid('ood'), name: 'Other dept. direct cost', category: 'direct_other', mode: 'pct_of_other_rev', value: 0, indexation: noIdx },

    // Indirect (undistributed), % of TR, auto-escalate via revenue.
    { id: nid('ga'), name: 'General & administrative', category: 'indirect_ga', mode: 'pct_of_total_rev', value: 0, indexation: noIdx },
    { id: nid('it'), name: 'IT', category: 'indirect_it', mode: 'pct_of_total_rev', value: 0, indexation: noIdx },
    { id: nid('sm'), name: 'Sales & marketing', category: 'indirect_sm', mode: 'pct_of_total_rev', value: 0, indexation: noIdx },
    { id: nid('pom'), name: 'Property operations & maintenance', category: 'indirect_pom', mode: 'pct_of_total_rev', value: 0, indexation: noIdx },
    { id: nid('energy'), name: 'Energy / utilities', category: 'indirect_energy', mode: 'pct_of_total_rev', value: 0, indexation: noIdx },
    { id: nid('eosb'), name: 'EOSB (end of service)', category: 'indirect_eosb', mode: 'pct_of_total_rev', value: 0, indexation: noIdx },

    // Management fee + reserve
    { id: nid('mgmtbase'), name: 'Base management fee', category: 'mgmt_base', mode: 'pct_of_total_rev', value: 0, indexation: noIdx },
    // Per-key fixed: inherits asset-level default inflation by default.
    { id: nid('mgmttech'), name: 'Technology service fee', category: 'mgmt_tech', mode: 'per_room_year', value: 0, indexation: noIdx, useAssetDefault: true },
    { id: nid('mgmtinc'), name: 'Incentive management fee', category: 'mgmt_incentive', mode: 'pct_of_gop', value: 0, indexation: noIdx },
    { id: nid('reserve'), name: 'Replacement reserve', category: 'replacement_reserve', mode: 'pct_of_total_rev', value: 0, indexation: noIdx },

    // Fixed charges
    { id: nid('rentins'), name: 'Rent & insurance', category: 'rent_insurance', mode: 'per_room_year', value: 0, indexation: noIdx, useAssetDefault: true },
    { id: nid('proptax'), name: 'Property tax', category: 'property_tax', mode: 'pct_of_total_rev', value: 0, indexation: noIdx },
  ];
}

/**
 * Retail / Lease lite seed (Pass 4, 2026-05-19). Mirrors a typical
 * NNN-style mall pro forma: a small Property Operating bundle
 * (property management, R&M, insurance, utilities), a recoverable
 * service-charge memo, and Other Charges (property tax, reserves /
 * sinking fund). Reuses the existing CAM category for the service
 * charge recoverable line so the OpexLineCategory enum stays small.
 */
export function defaultLeaseOpexLines(): OpexLine[] {
  _id = 0;
  return [
    // Property Operating
    { id: nid('propmgmt'), name: 'Property management', category: 'mgmt_base', mode: 'pct_of_lease_rev', value: 0, indexation: noIdx },
    { id: nid('rm'), name: 'Repairs & maintenance', category: 'repairs_maintenance', mode: 'per_sqm_year', value: 0, indexation: noIdx, useAssetDefault: true },
    { id: nid('insurance'), name: 'Insurance', category: 'rent_insurance', mode: 'per_sqm_year', value: 0, indexation: noIdx, useAssetDefault: true },
    { id: nid('utilities'), name: 'Utilities (landlord side)', category: 'utilities', mode: 'pct_of_lease_rev', value: 0, indexation: noIdx },
    // Pass-Through / Recoveries (memo, usually charged back to tenants
    // under NNN; engine still totals it so the user can see the gross.)
    { id: nid('servchg'), name: 'Service charge recoverable', category: 'cam', mode: 'per_sqm_year', value: 0, indexation: noIdx, useAssetDefault: true },
    // Other Charges
    { id: nid('proptax'), name: 'Property tax', category: 'property_tax', mode: 'pct_of_lease_rev', value: 0, indexation: noIdx },
    { id: nid('reserves'), name: 'Reserves / sinking fund', category: 'replacement_reserve', mode: 'pct_of_lease_rev', value: 0, indexation: noIdx },
  ];
}

export function defaultHQOpexLines(): OpexLine[] {
  _id = 0;
  return [
    { id: nid('payroll'), name: 'HQ payroll', category: 'hq_payroll', mode: 'fixed_baseline', value: 0, indexation: noIdx, useAssetDefault: true },
    { id: nid('office'), name: 'HQ office & overheads', category: 'hq_office', mode: 'fixed_baseline', value: 0, indexation: noIdx, useAssetDefault: true },
    { id: nid('professional'), name: 'Professional fees (legal, audit, advisory)', category: 'hq_professional', mode: 'fixed_baseline', value: 0, indexation: noIdx, useAssetDefault: true },
    { id: nid('hqother'), name: 'Other corporate opex', category: 'hq_other', mode: 'pct_of_total_rev', value: 0, indexation: noIdx },
  ];
}

/**
 * THE VALUES THIS FILE USED TO SEED (frozen 2026-08-20).
 *
 * Every builder above now seeds a value of ZERO: the line items are the
 * starting structure, the numbers are the user's. Before this, a new project
 * was computed on these figures without anybody entering them, and on screen
 * they were indistinguishable from a number that had been.
 *
 * This table is kept because a saved project can still be holding one of them
 * on a DISABLED line. Zeroing the builders does not reach a value that is
 * already stored, so re-enabling such a line would resurrect a number nobody
 * typed. `isLegacySeedValue` lets the snapshot repair recognise exactly those
 * and no others: a disabled line carrying a value the user chose is left
 * alone, because clearing it would destroy their input to fix ours.
 *
 * It is FROZEN. It is a record of what was, not a source of defaults, and
 * nothing may read it to seed anything.
 */
export const LEGACY_OPEX_SEED_VALUES: ReadonlyArray<{ category: string; mode: string; value: number }> = [
  { category: 'direct_rooms', mode: 'pct_of_room_rev', value: 0.25 },
  { category: 'direct_fb', mode: 'pct_of_fb_rev', value: 0.65 },
  { category: 'direct_other', mode: 'pct_of_other_rev', value: 0.5 },
  { category: 'indirect_ga', mode: 'pct_of_total_rev', value: 0.08 },
  { category: 'indirect_it', mode: 'pct_of_total_rev', value: 0.02 },
  { category: 'indirect_sm', mode: 'pct_of_total_rev', value: 0.06 },
  { category: 'indirect_pom', mode: 'pct_of_total_rev', value: 0.04 },
  { category: 'indirect_energy', mode: 'pct_of_total_rev', value: 0.04 },
  { category: 'indirect_eosb', mode: 'pct_of_total_rev', value: 0.01 },
  { category: 'mgmt_base', mode: 'pct_of_total_rev', value: 0.03 },
  { category: 'mgmt_tech', mode: 'per_room_year', value: 1200 },
  { category: 'mgmt_incentive', mode: 'pct_of_gop', value: 0.08 },
  { category: 'replacement_reserve', mode: 'pct_of_total_rev', value: 0.04 },
  { category: 'rent_insurance', mode: 'per_room_year', value: 5000 },
  { category: 'property_tax', mode: 'pct_of_total_rev', value: 0.005 },
  { category: 'mgmt_base', mode: 'pct_of_lease_rev', value: 0.03 },
  { category: 'repairs_maintenance', mode: 'per_sqm_year', value: 30 },
  { category: 'rent_insurance', mode: 'per_sqm_year', value: 10 },
  { category: 'utilities', mode: 'pct_of_lease_rev', value: 0.02 },
  { category: 'cam', mode: 'per_sqm_year', value: 50 },
  { category: 'property_tax', mode: 'pct_of_lease_rev', value: 0.015 },
  { category: 'replacement_reserve', mode: 'pct_of_lease_rev', value: 0.01 },
  { category: 'hq_payroll', mode: 'fixed_baseline', value: 5000000 },
  { category: 'hq_office', mode: 'fixed_baseline', value: 1500000 },
  { category: 'hq_professional', mode: 'fixed_baseline', value: 800000 },
  { category: 'hq_other', mode: 'pct_of_total_rev', value: 0.005 },
];

/**
 * Is this stored value one this codebase put there?
 *
 * Matched on category AND mode AND the exact value. All three, because a
 * category alone is not enough (the same category is seeded differently under
 * a different mode), and because a user who happens to type the old default is
 * indistinguishable from one who never touched it. That last case resolves in
 * favour of clearing, which is the safe direction: the line is DISABLED, so
 * the value is charging nothing either way, and a user re-enabling it will
 * type the number they want.
 */
export function isLegacySeedValue(category: string | undefined, mode: string | undefined, value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return false;
  return LEGACY_OPEX_SEED_VALUES.some((v) => v.category === category && v.mode === mode && v.value === value);
}
