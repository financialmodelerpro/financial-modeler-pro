/**
 * existingOperationsSellState.ts (2026-10-07, founder)
 *
 * THE SELL HALF OF EXISTING OPERATIONS. The committed existing-operations
 * capture (existingOperationsState.ts) has ONE asset on its operational phase,
 * an Operate hotel, so it exercises the fixed asset schedule and nothing else:
 * a SELL asset on an operational phase, which runs through inventory and cost
 * of sales instead, was never exercised by any fixture.
 *
 * THIS IS THAT CAPTURE WITH ONE DOCUMENTED EDIT: a copy of its own Phase 2
 * "Branded Apartments" (Sell), with that asset's sub-units and prices, placed
 * on the operational Phase 1 on a custom allocation of the same area. Nothing
 * else changes, so any difference against the base capture is this asset.
 *
 * WHAT IT PROVES (verify-model-capex): an asset on an operational phase costs
 * nothing in the model (phaseHasModelCapex), on every reader of an asset's
 * cost, and the balance sheet balances with it present.
 *
 * No em dashes in this file.
 */
import { buildExistingOperationsState } from './existingOperationsState';

export const EXISTING_OPS_SELL_LABEL = 'FIXTURE (existing operations, a Sell asset on the operational phase)';
export const OPERATIONAL_SELL_ASSET_ID = 'asset_operational_sell_copy';
const SOURCE_SELL_ASSET_ID = 'asset_1778503832523';

export function buildExistingOperationsSellState(): any {
  const s = buildExistingOperationsState();
  const src = s.assets.find((a: any) => a.id === SOURCE_SELL_ASSET_ID);
  if (!src || src.strategy !== 'Sell') throw new Error('existingOperationsSellState: the source Sell asset is missing from the capture');
  s.assets.push({ ...JSON.parse(JSON.stringify(src)), id: OPERATIONAL_SELL_ASSET_ID, name: 'Branded Apartments (operational copy)', phaseId: 'phase_1' });
  const units = (s.subUnits ?? []).filter((u: any) => u.assetId === SOURCE_SELL_ASSET_ID);
  if (!units.length) throw new Error('existingOperationsSellState: the source asset has no sub-units');
  for (const u of units) s.subUnits.push({ ...JSON.parse(JSON.stringify(u)), id: `${u.id}__op_copy`, assetId: OPERATIONAL_SELL_ASSET_ID });
  return s;
}
