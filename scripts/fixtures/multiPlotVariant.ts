/**
 * multiPlotVariant.ts (2026-10-20)
 *
 * A SECOND PROJECT WITH SEVERAL LANDS PER ASSET, for the live workbook's proof that
 * Capex works one row per cost line per asset (founder, 2026-10-20). No open project
 * other than the reference one has assets, and it pools plots on one line only, so
 * the verifier builds this copy of it: the Phase 1 villas gain a third plot with a curve of
 * its own (three plots, three spreads), and the Phase 2 villas a second plot with a curve of
 * its own. (A hotel or lease line on several plots is refused by the Opex tab, which shows
 * one plot's opex per line; that limit is the Opex tab's, not Capex's.) Each new plot is a full asset on its own parcel, priced on
 * the same cost lines, with no sub-units of its own (as Land 2 already is), so its
 * line pools it and the blended spend share is what the workbook must reproduce.
 *
 * The copy is the snapshot edited and re-run through the platform's own load and
 * Assets-tab reconciliations (platformAfterEdit), never saved anywhere.
 *
 * No em dashes in this file.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { platformAfterEdit } from './platformAfterEdit';
import type { LiveExportInputs } from './liveExportInputs';

function addPlot(s: any, hostId: string, plot: { id: string; name: string; area: number }, assetId: string, curve: number[] | undefined): void {
  const host = s.assets.find((a: any) => a.id === hostId);
  if (!host) throw new Error(`multiPlotVariant: no asset ${hostId}`);
  const parcel = s.parcels.find((p: any) => p.id === host.landAllocation?.parcelId);
  if (!parcel) throw new Error(`multiPlotVariant: ${hostId} draws no parcel`);
  s.parcels.push({ ...structuredClone(parcel), id: plot.id, name: plot.name, area: plot.area });
  const a = structuredClone(host);
  a.id = assetId;
  a.landAllocation = { sqm: plot.area, parcelId: plot.id };
  delete a.derivedAreas;
  if (curve) a.capexPhasing = { phasing: 'manual', distribution: curve }; else delete a.capexPhasing;
  s.assets.push(a);
  for (const o of s.costOverrides.filter((x: any) => x.assetId === hostId)) s.costOverrides.push({ ...structuredClone(o), assetId });
}

/** The reference project with the Phase 1 villas on three plots and the Phase 2 villas on two. */
export function multiPlotVariant(input: LiveExportInputs): LiveExportInputs {
  const s: any = structuredClone(input.snapshot);
  const villas1 = s.assets.find((a: any) => a.strategy === 'Sell' && a.phaseId === 'phase_1' && a.visible !== false && a.capexPhasing?.phasing === 'manual');
  const villas2 = s.assets.find((a: any) => a.strategy === 'Sell' && a.phaseId === 'phase_2' && a.visible !== false);
  if (!villas1 || !villas2) throw new Error('multiPlotVariant: the reference project no longer has villas in both phases');
  addPlot(s, villas1.id, { id: 'parcel_variant_9', name: 'Land 9', area: 6000 }, 'asset_variant_villas_1b', [0, 0, 20, 30, 50]);
  addPlot(s, villas2.id, { id: 'parcel_variant_8', name: 'Land 8', area: 3000 }, 'asset_variant_villas_2b', [0, 10, 20, 70]);
  const state = platformAfterEdit(s) as LiveExportInputs['state'];
  return { ...input, projectName: `${input.projectName} (several lands per asset)`, snapshot: s, state };
}
