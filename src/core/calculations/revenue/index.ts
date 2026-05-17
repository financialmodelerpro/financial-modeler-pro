/**
 * M2 Revenue Engine - public entry.
 *
 * Phase 1 ships the Sell-strategy primitives (cohort matrix, cash
 * payment distribution, recognition, Wafi escrow, asset orchestrator,
 * reconciliation). Phase 2-4 will add Operate / Lease / Sell+Manage
 * surfaces. Engine is pure and store-free; the M2 UI layer is the
 * only place that bridges to the M1 store.
 */
export type {
  AssetSellConfig,
  CashPaymentProfile,
  Cohort,
  IndexationConfig,
  ProfileMode,
  ReconcileIdentity,
  ReconcileReport,
  RecognitionProfile,
  SellAssetResult,
  SellSubUnitConfig,
  SubUnitMaterial,
  WafiEscrowConfig,
} from './types';

export { applyIndexation } from './indexation';
export { buildCohortMatrix, columnSums } from './cohort';
export { distributeCashCollection } from './payment';
export { buildRecognition } from './recognition';
export { buildEscrowMovement } from './escrow';
export type { EscrowMovement } from './escrow';
export { computeSellAsset, resolveHandoverYear } from './sell';
export type { ComputeSellInputs } from './sell';
export { reconcileSellAsset } from './reconcile';
export { buildAccountsReceivable } from './accountsReceivable';
export type { AccountsReceivableResult } from './accountsReceivable';
export { buildUnearnedRevenue } from './unearnedRevenue';
export type { UnearnedRevenueResult } from './unearnedRevenue';
export { buildCostOfSales } from './costOfSales';
export type { CostOfSalesResult } from './costOfSales';
