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
 */

import type { OpexLine } from './types';

const noIdx = { method: 'none' as const };
const defaultInflation = { method: 'yoy_compound' as const, rate: 0.03, startYear: 0 };

let _id = 0;
const nid = (prefix: string): string => `${prefix}-${++_id}-${Math.random().toString(36).slice(2, 8)}`;

export function defaultHospitalityOpexLines(): OpexLine[] {
  _id = 0;
  return [
    // Direct departmental
    { id: nid('rooms'), name: 'Rooms direct cost', category: 'direct_rooms', mode: 'pct_of_room_rev', value: 0.25, indexation: noIdx },
    { id: nid('fb'), name: 'F&B direct cost', category: 'direct_fb', mode: 'pct_of_fb_rev', value: 0.65, indexation: noIdx },
    { id: nid('ood'), name: 'Other dept. direct cost', category: 'direct_other', mode: 'pct_of_other_rev', value: 0.50, indexation: noIdx },

    // Indirect (undistributed)
    { id: nid('ga'), name: 'General & administrative', category: 'indirect_ga', mode: 'pct_of_total_rev', value: 0.08, indexation: noIdx },
    { id: nid('it'), name: 'IT', category: 'indirect_it', mode: 'pct_of_total_rev', value: 0.02, indexation: noIdx },
    { id: nid('sm'), name: 'Sales & marketing', category: 'indirect_sm', mode: 'pct_of_total_rev', value: 0.06, indexation: noIdx },
    { id: nid('pom'), name: 'Property operations & maintenance', category: 'indirect_pom', mode: 'pct_of_total_rev', value: 0.04, indexation: noIdx },
    { id: nid('energy'), name: 'Energy / utilities', category: 'indirect_energy', mode: 'pct_of_total_rev', value: 0.04, indexation: noIdx },
    { id: nid('eosb'), name: 'EOSB (end of service)', category: 'indirect_eosb', mode: 'pct_of_total_rev', value: 0.01, indexation: noIdx },

    // Management fee + reserve
    { id: nid('mgmtbase'), name: 'Base management fee', category: 'mgmt_base', mode: 'pct_of_total_rev', value: 0.03, indexation: noIdx },
    { id: nid('mgmttech'), name: 'Technology service fee', category: 'mgmt_tech', mode: 'per_room_year', value: 1200, indexation: defaultInflation },
    { id: nid('mgmtinc'), name: 'Incentive management fee', category: 'mgmt_incentive', mode: 'pct_of_gop', value: 0.08, indexation: noIdx },
    { id: nid('reserve'), name: 'Replacement reserve', category: 'replacement_reserve', mode: 'pct_of_total_rev', value: 0.04, indexation: noIdx },

    // Fixed charges
    { id: nid('rentins'), name: 'Rent & insurance', category: 'rent_insurance', mode: 'per_room_year', value: 5000, indexation: defaultInflation },
    { id: nid('proptax'), name: 'Property tax', category: 'property_tax', mode: 'pct_of_total_rev', value: 0.005, indexation: noIdx },
  ];
}

export function defaultLeaseOpexLines(): OpexLine[] {
  _id = 0;
  return [
    { id: nid('propmgmt'), name: 'Property management fee', category: 'mgmt_base', mode: 'pct_of_lease_rev', value: 0.03, indexation: noIdx },
    { id: nid('cam'), name: 'Common area maintenance', category: 'cam', mode: 'per_sqm_year', value: 50, indexation: defaultInflation },
    { id: nid('utilities'), name: 'Utilities (landlord side)', category: 'utilities', mode: 'pct_of_lease_rev', value: 0.02, indexation: noIdx },
    { id: nid('insurance'), name: 'Insurance', category: 'rent_insurance', mode: 'per_sqm_year', value: 10, indexation: defaultInflation },
    { id: nid('proptax'), name: 'Property tax', category: 'property_tax', mode: 'pct_of_lease_rev', value: 0.015, indexation: noIdx },
  ];
}

export function defaultHQOpexLines(): OpexLine[] {
  _id = 0;
  return [
    { id: nid('payroll'), name: 'HQ payroll', category: 'hq_payroll', mode: 'fixed_baseline', value: 5_000_000, indexation: defaultInflation },
    { id: nid('office'), name: 'HQ office & overheads', category: 'hq_office', mode: 'fixed_baseline', value: 1_500_000, indexation: defaultInflation },
    { id: nid('professional'), name: 'Professional fees (legal, audit, advisory)', category: 'hq_professional', mode: 'fixed_baseline', value: 800_000, indexation: defaultInflation },
    { id: nid('hqother'), name: 'Other corporate opex', category: 'hq_other', mode: 'pct_of_total_rev', value: 0.005, indexation: noIdx },
  ];
}
