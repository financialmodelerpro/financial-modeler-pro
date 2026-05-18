/**
 * M2 Revenue Engine, public entry.
 *
 * Phase 1 ships Sell-strategy primitives: cohort matrix, cash payment
 * distribution, recognition, AR / Unearned / CoS schedules. Hospitality,
 * Lease, Sell+Manage to follow in Pass 8+.
 *
 * Pass 7d (2026-05-17): Wafi escrow + multi-cohort removed. Single
 * implicit cohort drives the engine. buildCohortMatrix remains as a
 * shared helper (cash + recognition vintage matrices).
 */
export type {
  AncillaryRevenueConfig,
  AncillaryRevenueMode,
  AssetSellConfig,
  CashPaymentProfile,
  HospitalityAssetResult,
  HospitalityConfig,
  IndexationConfig,
  ProfileMode,
  ReconcileIdentity,
  ReconcileReport,
  RecognitionProfile,
  SellAssetResult,
  SellSubUnitConfig,
  SubUnitMaterial,
} from './types';

export { applyIndexation } from './indexation';
export { buildCohortMatrix, columnSums } from './cohort';
export { distributeCashCollection } from './payment';
export { buildRecognition } from './recognition';
export { computeSellAsset, resolveHandoverYear } from './sell';
export type { ComputeSellInputs } from './sell';
export { computeHospitalityAsset } from './hospitality';
export type { ComputeHospitalityInputs } from './hospitality';
export { reconcileSellAsset } from './reconcile';
export { buildAccountsReceivable } from './accountsReceivable';
export type { AccountsReceivableResult } from './accountsReceivable';
export { buildAccountsReceivableDSO } from './accountsReceivableDSO';
export type { AccountsReceivableDSOResult, BuildAccountsReceivableDSOInputs } from './accountsReceivableDSO';
export { buildUnearnedRevenue } from './unearnedRevenue';
export type { UnearnedRevenueResult } from './unearnedRevenue';
export { buildCostOfSales } from './costOfSales';
export type { CostOfSalesResult } from './costOfSales';
export { buildCostOfSalesV2 } from './costOfSalesV2';
export type { CostOfSalesV2Inputs, CostOfSalesV2Result } from './costOfSalesV2';
