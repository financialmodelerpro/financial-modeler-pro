/**
 * opexInputLabels.ts (2026-09-17)
 *
 * THE WORDS THE MODULE 3 INPUTS TAB USES FOR AN OPEX LINE, STATED ONCE: the
 * category and mode labels, which modes take inflation, and how an inflation
 * setting reads. They lived as private constants on the Opex Inputs screen, so
 * the workbook printed the stored codes (`indirect_ga`, `pct_of_lease_rev`)
 * where the screen reads "Indirect, G&A" and "% of Lease Revenue". The screen
 * and the workbook both import these now.
 *
 * Pure. No em dashes in this file.
 */

import type { OpexLine, OpexLineCategory, OpexLineMode } from '@/src/core/calculations/opex';
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

/** Fixed-cost modes are the ONLY ones that take inflation. %-of-revenue and
 *  % of GOP lines escalate through the revenue stream itself, so the engine
 *  ignores any indexation they carry. */
export const FIXED_COST_OPEX_MODES: ReadonlyArray<OpexLineMode> = ['fixed_baseline', 'per_room_year', 'per_sqm_year'];
export function isFixedCostOpexMode(m: OpexLineMode): boolean {
  return FIXED_COST_OPEX_MODES.indexOf(m) >= 0;
}

export type OpexInflationMethod = 'none' | 'single_rate' | 'yoy_compound' | 'yoy_per_period';

export function opexInflationMethodOf(config: IndexationConfig | undefined): OpexInflationMethod {
  const m = config?.method;
  if (m === 'single_rate' || m === 'yoy_compound' || m === 'yoy_per_period') return m;
  return 'none';
}

export function opexInflationMethodLabel(m: OpexInflationMethod): string {
  if (m === 'none') return 'Off';
  if (m === 'single_rate') return 'Flat';
  if (m === 'yoy_compound') return 'Compound';
  return 'Per-Year';
}

/** Short summary, as the "Inherits" and "Override active" badges read. */
export function summarizeOpexIndexation(cfg: IndexationConfig | undefined): string {
  const m = opexInflationMethodOf(cfg);
  if (m === 'none') return 'Off';
  if (m === 'single_rate' || m === 'yoy_compound') {
    const pct = ((cfg?.rate ?? 0) * 100).toFixed(2).replace(/\.00$/, '');
    return `${opexInflationMethodLabel(m)} ${pct}%`;
  }
  return 'Per-Year';
}

/** What the Inflation column says for one line, in the screen's words. */
export function opexLineInflationText(line: Pick<OpexLine, 'mode' | 'rateMode' | 'useAssetDefault' | 'indexation'>, defaultIndexation: IndexationConfig | undefined): string {
  if (!isFixedCostOpexMode(line.mode)) return 'auto via revenue';
  if (line.rateMode === 'yoy') return 'supplied by YoY rates';
  if (line.useAssetDefault !== false) return `Inherits: ${summarizeOpexIndexation(defaultIndexation)}`;
  return `Override active: ${summarizeOpexIndexation(line.indexation)}`;
}
