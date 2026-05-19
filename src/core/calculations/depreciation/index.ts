/**
 * Public surface of the Fixed Asset + Depreciation engine.
 *
 * The engine handles ONLY the depreciable roll-forward. Land
 * roll-forward + Total Fixed Assets composition live in the M4
 * resolver (src/hubs/modeling/platforms/refm/lib/fixed-assets-resolvers.ts)
 * because they are pure additive composition (no engine math needed).
 */

export type {
  DepreciationMethod,
  AssetFixedAssetConfig,
  AssetFixedAssetResult,
} from './types';
export { buildStraightLine, buildReducingBalance } from './straightLine';
export { computeAssetFixedAssets } from './fixedAssets';
