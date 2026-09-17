/**
 * opexLineLabels.ts (2026-09-17)
 *
 * WHAT AN OPEX LINE'S CATEGORY, MODE AND INFLATION READ AS, stated once. The
 * Module 3 Inputs screen renders these words and the Excel model export prints
 * them, so the two cannot drift into two vocabularies (the workbook printed the
 * raw codes `indirect_ga` and `pct_of_lease_rev` beside a screen that said
 * "Indirect, G&A" and "% of Lease Revenue").
 *
 * No em dashes in this file.
 */

import type { OpexLineCategory, OpexLineMode } from '@/src/core/calculations/opex';
import type { IndexationConfig } from '@/src/core/calculations/revenue/types';

export const OPEX_CATEGORY_LABELS: Record<OpexLineCategory, string> = {
  direct_rooms: 'Direct, Rooms',
  direct_fb: 'Direct, F&B',
  direct_other: 'Direct, Other dept.',
  indirect_ga: 'Indirect, G&A',
  indirect_it: 'Indirect, IT',
  indirect_sm: 'Indirect, Sales & Marketing',
  indirect_pom: 'Indirect, Property Operations & Maint.',
  indirect_energy: 'Indirect, Energy',
  indirect_eosb: 'Indirect, EOSB',
  mgmt_base: 'Management, Base fee',
  mgmt_tech: 'Management, Technology fee',
  mgmt_incentive: 'Management, Incentive fee',
  replacement_reserve: 'Replacement reserve',
  rent_insurance: 'Rent & insurance',
  property_tax: 'Property tax',
  utilities: 'Utilities',
  cam: 'Service charge / CAM',
  repairs_maintenance: 'Repairs & maintenance',
  hq_payroll: 'HQ, Payroll',
  hq_office: 'HQ, Office & overheads',
  hq_professional: 'HQ, Professional fees',
  hq_other: 'HQ, Other',
  other: 'Other',
};

export const OPEX_MODE_LABELS: Record<OpexLineMode, string> = {
  fixed_baseline: 'Fixed (currency / year)',
  pct_of_room_rev: '% of Room Revenue',
  pct_of_fb_rev: '% of F&B Revenue',
  pct_of_other_rev: '% of Other Revenue',
  pct_of_total_rev: '% of Total Revenue',
  pct_of_lease_rev: '% of Lease Revenue',
  per_room_year: 'Per Key per Year',
  per_sqm_year: 'Per SQM per Year',
  pct_of_gop: '% of GOP',
};

/** The only modes that take inflation: a percentage of revenue or of GOP
 *  escalates through the revenue stream itself. */
export function isFixedCostOpexMode(m: OpexLineMode): boolean {
  return m === 'fixed_baseline' || m === 'per_room_year' || m === 'per_sqm_year';
}

/** An inflation setting in the screen's words: Off, Flat 3%, Compound 3%, Per-Year. */
export function summarizeOpexIndexation(cfg: IndexationConfig | undefined): string {
  const m = cfg?.method;
  if (m === 'single_rate' || m === 'yoy_compound') {
    const pct = ((cfg?.rate ?? 0) * 100).toFixed(2).replace(/\.00$/, '');
    return `${m === 'single_rate' ? 'Flat' : 'Compound'} ${pct}%`;
  }
  if (m === 'yoy_per_period') return 'Per-Year';
  return 'Off';
}
