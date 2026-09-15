/**
 * settleModel.ts (2026-09-15, step 8)
 *
 * THE ONE LOAD-TIME SETTLE, FOR EVERY MODEL THAT IS SHOWN.
 *
 * Moved verbatim out of the store's hydrate so the scenario models built
 * outside it (the comparison, the year-on-year report, the exports, a case
 * switch, a grid edit) settle through the SAME passes as an opened model. Until
 * this move only the model a project OPENED on was settled: a scenario's type
 * price or cost default reached a model only if that scenario happened to be
 * the active one when the project was opened, and read as zero everywhere else
 * (on the live project a 10% type price cut read -6.99 points of equity IRR as
 * the active scenario and 0.00 in the comparison column).
 *
 * Each pass settles (returns its input when nothing moves), so a settled model
 * settles to itself. No em dashes in this file.
 */
import type { HydrateSnapshot } from './module1-store';
import { settleFollowingCostWindows } from './module1-types';
import { applyDerivedAreasPlan, planDerivedAreasForModel } from '../../components/modules/_shared/assetTableModel';
import { repairProjectIntegrity } from '@/src/core/calculations/projectIntegrity';
import { applyReferenceCostBases } from '@/src/core/calculations/costBases';
import { seedCostStandardRows, settleLineRateStated, settleLineSelectionStated, settleStandardCostOverrides } from './costStandards';
import { planTypeMassingWriteBack } from './assetTypeStandards';
import { seedRevenueBlocks } from './revenueSeeds';
import { settleSubUnitPrices } from './subUnitPrices';
import { settleTypePriceFields, settleSubUnitPriceStated, settleSubUnitPriceDefaults } from './subUnitPriceDefaults';

export function settleModel(merged: HydrateSnapshot) {
      /**
       * EVERY REFERENCE POINTS AT SOMETHING THAT EXISTS, CHECKED ON LOAD.
       *
       * This is the one door every load goes through: opening a project,
       * restoring a version, switching a case, and the local-snapshot path the
       * wizard uses. Putting the check on a TAB is what let a dangling plot
       * reference live in a saved model for two days: the tab that could have
       * repaired it was not the tab anybody was looking at.
       *
       * IT SETTLES. `repairProjectIntegrity` returns the INPUT OBJECT when
       * nothing is wrong, so a clean project hydrates to the same object it
       * always did and opening one can never mark it dirty.
       */
      const repaired = repairProjectIntegrity(merged);
      /**
       * THE BRIDGE TO CAPEX IS FILLED ON LOAD (2026-09-12). Until today it was
       * filled by an effect on the assets tab and nowhere else, so capex priced
       * whatever the last visit to that tab had left behind. The chain runs
       * here through the SAME function the tab calls, and the applier returns
       * the input array when nothing moved, so a settled project hydrates to
       * the object it always did.
       */
      const bridged = applyDerivedAreasPlan(repaired.state.assets, planDerivedAreasForModel(repaired.state));
      const bridgedModel = bridged.changed ? { ...repaired.state, assets: bridged.assets } : repaired.state;
      /**
       * AND THE STANDARD CONSTRUCTION LINES ARE ON THE REFERENCE BASES
       * (2026-09-12): hosts on Main Asset GFA and Parking Area, strips on
       * Retail GFA and Retail Parking Area, a strip with no override seeded.
       * Same door, same settle rule: the input object when nothing moves.
       */
      const based = applyReferenceCostBases(bridgedModel);
      // And a window that declares itself derived reads as derived.
      const windows = settleFollowingCostWindows(based.state.costLines, based.state.phases);
      const windowed = windows.moved > 0 ? { ...based.state, costLines: windows.costLines } : based.state;
      /**
       * AND EVERY ASSET CARRIES THE REVENUE BLOCK ITS STRATEGY READS
       * (2026-09-13, revenueSeeds.ts). The tab created it lazily on the first
       * edit, so five of eight live assets had none and every rate typed on
       * Table 5 reached nothing. The seed is the tab's own default and earns
       * nothing; the input array comes back when nothing was missing.
       */
      /**
       * AND THE TYPE STANDARDS (2026-09-14): a type's absent utilisation,
       * coverage, FAR or service share is filled when every plot of the type
       * states the same figure (never overwriting one the user typed there),
       * and a type's cost rates become standard-sourced overrides on its
       * assets. Both settle.
       */
      const rowsModel = windowed.project.costStandardRows === undefined
        ? { ...windowed, project: { ...windowed.project, costStandardRows: seedCostStandardRows(windowed.project.assetTypes ?? [], windowed.project.assetTypeValues) } }
        : windowed;
      const stated = settleLineRateStated(rowsModel.costLines);
      const ratedModel0 = stated.changed ? { ...rowsModel, costLines: stated.costLines } : rowsModel;
      const selStated = settleLineSelectionStated(ratedModel0.costLines, ratedModel0.project.costStandardRows ?? []);
      const ratedModel = selStated.changed ? { ...ratedModel0, costLines: selStated.costLines } : ratedModel0;
      const massed = planTypeMassingWriteBack(ratedModel.assets, ratedModel.project.assetTypeValues, { overwrite: false });
      const massedModel = massed.changed ? { ...ratedModel, project: { ...ratedModel.project, assetTypeValues: massed.values } } : ratedModel;
      const standardModel = settleStandardCostOverrides(massedModel).state;
      const seeded = seedRevenueBlocks(standardModel.assets);
      const seededModel = seeded.changed ? { ...standardModel, assets: seeded.assets } : standardModel;
      /**
       * AND EVERY SUB-UNIT'S ACTIVE PRICE IS THE ONE ITS BASIS STATES
       * (2026-09-13, subUnitPrices.ts): a row carries a price per sqm and a
       * price per unit, `unitPrice` is whichever its metric makes active, and
       * a row that predates the pair takes its price as the statement in its
       * active basis. Settles like the rest.
       */
      // THE TYPE'S PRICES FIRST (2026-09-15, subUnitPriceDefaults.ts): a row with no
      // marker and a positive price is the user's; a row with none takes its type's.
      // The first cut's four type price fields fold into the two (2026-09-15).
      const foldedValues = settleTypePriceFields(seededModel.project.assetTypeValues);
      const valuedModel = foldedValues.changed ? { ...seededModel, project: { ...seededModel.project, assetTypeValues: foldedValues.values } } : seededModel;
      const defaultedRows = settleSubUnitPriceDefaults(settleSubUnitPriceStated(valuedModel.subUnits).subUnits, valuedModel.assets, valuedModel.project.assetTypes ?? [], valuedModel.project.assetTypeValues);
      const priced = settleSubUnitPrices(defaultedRows.subUnits, valuedModel.assets);
      const model = priced.subUnits !== valuedModel.subUnits ? { ...valuedModel, subUnits: priced.subUnits } : valuedModel;
      return { model, priced, seeded, windows, based, repaired };
}
