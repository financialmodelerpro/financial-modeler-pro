/**
 * modelCapex.ts (2026-10-07, founder)
 *
 * THE ONE RULE FOR WHETHER A PHASE'S ASSETS COST ANYTHING IN THE MODEL.
 *
 * A phase that is already OPERATING when the model starts was built before it:
 * its land and building come in as HISTORICAL OPENING balances (the asset's
 * `historicalPreCapexLand` / `historicalPreCapexBuilding`, funded by its
 * historical debt and equity, `financing/existing.ts`), never as model capex.
 *
 * Before this file each reader decided that for itself. The capex aggregate
 * skipped an operational phase; the fixed asset schedule, cost of sales, the
 * financing hooks, the selling cost report, the capex report and the live
 * workbook's Capex stage did not, and priced the operational asset's plot and
 * lines anyway. So the existing-operations fixture carried 1,350.7m of land on
 * its operational hotel that no capex, cash or equity entry funded, and its
 * balance sheet was out by exactly that from the first year (TRAPS 7.63).
 *
 * `computeAssetCost` applies this first and returns an empty breakdown, so
 * every reader of an asset's cost gets the same answer; `aggregateProjectCapex`
 * calls it for the phase loop. Zero imports, so anything may call it.
 *
 * No em dashes in this file.
 */
export function phaseHasModelCapex(phase: { status?: string } | null | undefined): boolean {
  return phase?.status !== 'operational';
}
