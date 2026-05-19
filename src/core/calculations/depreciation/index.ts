/**
 * Public surface of the Fixed Asset + Depreciation engine.
 */

export type {
  DepreciationMethod,
  AssetFixedAssetConfig,
  AssetFixedAssetResult,
  ProjectFixedAssetTotals,
} from './types';
export { buildStraightLine } from './straightLine';
export { computeAssetFixedAssets } from './fixedAssets';
