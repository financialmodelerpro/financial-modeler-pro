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
export type { ProfileSpec, ProfileResolver } from './cohort';
export {
  resolveDownpayment, hasAnyDownpayment, instalmentCount, buildSaleCohortProfile,
} from './cohortTerms';
export type { DownpaymentEntry, DownpaymentSource, ResolvedDownpayment, SaleCohortTerms } from './cohortTerms';
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
// THE cost-of-sales engine, and the only one (2026-08-30). A second engine,
// `buildCostOfSalesV2`, was exported here and used by the Module 2 screen and
// both exports while the P&L used this one; they disagreed by up to 407,131,731
// in a single year on a live project. It is deleted, not deprecated. The base
// and the spread are assembled once, in the platform's Module 2 cost-of-sales
// layer (hubs/modeling/platforms/refm/lib/costOfSales.ts), which calls this.
export { buildCostOfSales } from './costOfSales';
export type { CostOfSalesResult } from './costOfSales';
export { computeEscrow } from './escrow';
export type { EscrowConfig, EscrowAssetResult } from './escrow';
