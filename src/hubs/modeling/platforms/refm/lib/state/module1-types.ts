/**
 * module1-types.ts
 *
 * Normalized data shape for REFM Module 1, introduced in Phase M1.R.
 *
 * Replaces the legacy shape that hardcoded three asset classes
 * (residentialCosts, hospitalityCosts, retailCosts) and a single
 * Construction-Operations timeline with:
 *
 *   - assets[]  : typed AssetClass array (1..N assets, custom or pre-built type)
 *   - phases[]  : typed Phase array      (1..N sequenced phases)
 *   - costs[]   : flat CostLine list keyed by assetId (+ optional phaseId)
 *
 * Architecture sheet sections 1, 2, 8, 14 inform the shape:
 *   - 5-layer hierarchy: Master Holding > Sub-Project > Phase > Asset > Sub-Unit
 *     (Master Holding + Sub-Unit are deferred; this refactor covers Phase + Asset).
 *   - Category enum locked to Sell | Operate | Lease | Hybrid.
 *   - Asset type is a string drawn from 20 pre-built types or a custom value.
 *   - Cost methods preserved verbatim (see CostItem.method in core/types).
 */

import type { CostItem } from '@core/types/project.types';

// ── Asset categories (Architecture section 2, locked enum) ─────────────────
export type AssetCategory = 'Sell' | 'Operate' | 'Lease' | 'Hybrid';

// ── Pre-built asset types (Architecture section 2, 20 entries) ─────────────
// Custom strings are also valid; the type is `string` rather than a union to
// permit user-defined types entered via the asset-type dropdown's free-form
// option. UI dropdowns surface the 20 below as the default suggestions.
export const PREBUILT_ASSET_TYPES = {
  Sell: [
    'Branded Villas',
    'Branded Apartments',
    'High-end Villas',
    'High-end Apartments',
    'Class B Apartments',
  ],
  Operate: [
    'Hotel 4-star',
    'Hotel 5-star',
    'Resort',
    'Serviced Apartments',
    'Senior Living',
    'Student Housing',
  ],
  Lease: [
    'Retail',
    'Office',
    'Industrial',
    'Healthcare',
    'Self-Storage',
    'Data Center',
  ],
  Hybrid: ['Marina', 'Cinema', 'Mixed-Use'],
} as const;

export interface AssetClass {
  id: string;
  name: string;
  type: string;
  category: AssetCategory;
  allocationPct: number;
  deductPct: number;
  efficiencyPct: number;
  visible: boolean;
}

export interface Phase {
  id: string;
  name: string;
  constructionStart: number;
  constructionPeriods: number;
  operationsStart: number;
  operationsPeriods: number;
  overlapPeriods: number;
}

export interface CostLine extends CostItem {
  assetId: string;
  phaseId?: string;
}

// ── Canonical legacy asset ids ──────────────────────────────────────────────
// The three legacy asset classes survive the refactor as named ids so
// downstream modules and persistence keep referring to them.
export const LEGACY_ASSET_IDS = {
  residential: 'residential',
  hospitality: 'hospitality',
  retail:      'retail',
} as const;

export type LegacyAssetId = (typeof LEGACY_ASSET_IDS)[keyof typeof LEGACY_ASSET_IDS];

// ── Defaults ───────────────────────────────────────────────────────────────
// Used by the migrator and by the store's blank-project initializer.
export const DEFAULT_LEGACY_ASSETS: AssetClass[] = [
  {
    id: LEGACY_ASSET_IDS.residential,
    name: 'Residential',
    type: 'High-end Apartments',
    category: 'Sell',
    allocationPct: 50,
    deductPct: 10,
    efficiencyPct: 85,
    visible: true,
  },
  {
    id: LEGACY_ASSET_IDS.hospitality,
    name: 'Hospitality',
    type: 'Hotel 5-star',
    category: 'Operate',
    allocationPct: 30,
    deductPct: 15,
    efficiencyPct: 80,
    visible: true,
  },
  {
    id: LEGACY_ASSET_IDS.retail,
    name: 'Retail',
    type: 'Retail',
    category: 'Lease',
    allocationPct: 20,
    deductPct: 5,
    efficiencyPct: 90,
    visible: true,
  },
];

export const DEFAULT_PHASE_ID = 'phase_1';

export function makeDefaultPhase(constructionPeriods: number, operationsPeriods: number, overlapPeriods: number): Phase {
  return {
    id: DEFAULT_PHASE_ID,
    name: 'Phase 1',
    constructionStart: 1,
    constructionPeriods,
    operationsStart: Math.max(1, constructionPeriods - overlapPeriods + 1),
    operationsPeriods,
    overlapPeriods,
  };
}
