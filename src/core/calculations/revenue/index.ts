/**
 * M2 Revenue Engine, public entry.
 *
 * Ships Sell + Hospitality + Lease + Sell+Manage primitives: cohort
 * matrix, cash payment distribution, recognition, AR / Unearned / CoS
 * schedules. Single implicit cohort drives the Sell engine;
 * buildCohortMatrix produces cash + recognition vintage matrices.
 */
export type {
  AncillaryRevenueConfig,
  AncillaryRevenueMode,
  AssetSellConfig,
  CashPaymentProfile,
  HospitalityAssetResult,
  HospitalityConfig,
  IndexationConfig,
  LeaseAssetResult,
  LeaseConfig,
  LeaseSubUnitConfig,
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
export { computeLeaseAsset } from './lease';
export type { ComputeLeaseInputs } from './lease';
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
