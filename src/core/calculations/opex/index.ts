/**
 * Module 3 Opex Engine, public entry.
 *
 * Per-asset opex (Hospitality, Lease) + project-wide HQ opex. Each
 * asset's opex is a flat list of line items; line modes cover the
 * KPMG SC7 hospitality hierarchy (direct % of dept rev / indirect
 * % of TR / per-key fixed / mgmt fees / replacement reserve) and the
 * simpler lease bundle (per-sqm CAM / insurance / property tax).
 */

export type {
  AssetOpexInputs,
  AssetOpexResult,
  HQOpexInputs,
  HQOpexResult,
  OpexLine,
  OpexLineCategory,
  OpexLineMode,
  OpexRevenueContext,
} from './types';

export { computeAssetOpex } from './assetOpex';
export { computeHQOpex } from './hqOpex';
export {
  defaultHospitalityOpexLines,
  defaultLeaseOpexLines,
  defaultHQOpexLines,
  defaultOpexIndexation,
  normalizeOpexIndexation,
  // The frozen record of the values these builders used to seed, and the
  // predicate that recognises one. Exported so the snapshot repair and the
  // engine verifier can read them; nothing may use them to seed anything.
  LEGACY_OPEX_SEED_VALUES,
  isLegacySeedValue,
} from './defaults';
export { buildAccountsPayable } from './accountsPayable';
export type {
  AccountsPayableResult,
  BuildAccountsPayableInputs,
} from './accountsPayable';
