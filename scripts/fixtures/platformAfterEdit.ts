/**
 * platformAfterEdit.ts (2026-09-27)
 *
 * WHAT THE PLATFORM HOLDS AFTER A USER CHANGES AN INPUT ON MODULE 1, for the
 * formula-linked export's input-change proof (verify-formula-workbook C).
 *
 * The edited snapshot goes through the store's own `hydrate` (the load-time
 * settle), then the two reconciliations the Assets tab runs as effects while it
 * is open, which is where a plot, FAR or coverage is edited: the retail
 * companion sync (the strip's pooled GFA and its derived row) and the line
 * sub-unit sync (a typed share re-derives its area from the line's NSA). They
 * are applied through the STORE's actions with the plans built by the SAME
 * functions the tab calls (Module1Assets.tsx: buildAssetRows -> computeAssetChain,
 * buildRetailCompanionSpecs, planLineSubUnits), repeated until nothing moves,
 * and the result is read back through `extractPersistSnapshot`, the save door.
 *
 * The derived support row and the derived area fields are opt-in per project
 * (`useDerivedAreas`); a model with it on is REFUSED here rather than half
 * emulated.
 *
 * No em dashes in this file.
 */
import { useModule1Store, modelFromSnapshot, type HydrateSnapshot } from '../../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import {
  computeAssetChain, groupAssetsByPlot, planLineSubUnits, resolveAssetNsa, mintId,
} from '../../src/hubs/modeling/platforms/refm/components/modules/_shared/assetTableModel';
import { buildRetailCompanionSpecs, isRetailCompanion } from '../../src/core/calculations/retailCompanion';
import { groupAssetsForConsolidation } from '../../src/core/calculations/consolidation';
import {
  resolveRetailSlotArea, resolveAssetTypeValues, normaliseAssetTypeId,
} from '../../src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards';
import type { Asset, SubUnit } from '../../src/hubs/modeling/platforms/refm/lib/state/module1-types';

export function platformAfterEdit(snapshot: HydrateSnapshot): ReturnType<typeof modelFromSnapshot> {
  const store = useModule1Store;
  store.getState().hydrate(structuredClone(snapshot));
  if (store.getState().project.useDerivedAreas === true) throw new Error('platformAfterEdit: useDerivedAreas is on; the derived support and area syncs are not emulated');
  for (let pass = 0; pass < 8; pass++) {
    const before = store.getState();
    const { assets, parcels, subUnits, project, phases, landAllocationMode } = before;
    const slot = resolveRetailSlotArea(project.assetTypeValues);
    const model = { assets, parcels, subUnits, project, landAllocationMode };
    const chainOf = new Map<string, ReturnType<typeof computeAssetChain>['chain']>();
    for (const g of groupAssetsByPlot(assets, parcels)) for (const a of g.assets) chainOf.set(a.id, computeAssetChain(a as Asset, model as never, slot).chain);
    const lines = groupAssetsForConsolidation(assets as never, phases.map((p) => p.id), normaliseAssetTypeId);
    store.getState().syncRetailCompanions(buildRetailCompanionSpecs(lines.map((g) => ({
      key: g.key, phaseId: g.phaseId, typeLabel: g.typeLabel,
      hosts: (g.assets as unknown as Asset[]).filter((a) => chainOf.has(a.id)).map((a) => {
        const ch = chainOf.get(a.id)!;
        return { assetId: a.id, retailGfaSqm: ch.retailGfaSqm, retailParkingAreaSqm: ch.retailParkingAreaSqm, retailParkingSlots: ch.retailParkingSlots };
      }),
    }))));
    const mid = store.getState();
    const nsaByAsset: Record<string, ReturnType<typeof resolveAssetNsa>> = {};
    for (const a of mid.assets) {
      if (isRetailCompanion(a)) nsaByAsset[a.id] = resolveAssetNsa(a.sellableBuaSqm, undefined);
      else if (chainOf.has(a.id)) nsaByAsset[a.id] = resolveAssetNsa(a.sellableBuaSqm, chainOf.get(a.id)!.netSaleableSqm);
    }
    store.getState().syncLineSubUnits(planLineSubUnits(
      mid.assets.filter((a) => !isRetailCompanion(a)) as Asset[], mid.subUnits as SubUnit[], mid.phases.map((p) => p.id), nsaByAsset,
      normaliseAssetTypeId, (a) => a.name, (a) => resolveAssetTypeValues(a, mid.project.assetTypeValues)?.avgUnitSizeSqm,
    ), () => mintId('subunit'));
    const after = store.getState();
    if (after.assets === before.assets && after.subUnits === before.subUnits) break;
    if (pass === 7) throw new Error('platformAfterEdit: the Assets tab reconciliations did not settle in 8 passes');
  }
  return modelFromSnapshot(store.getState().extractPersistSnapshot());
}
