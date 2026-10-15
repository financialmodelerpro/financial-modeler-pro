/**
 * expensedRows.ts (2026-10-15), THE SELLING AND MARKETING EXPENSED AS INCURRED, BY PLOT.
 *
 * The live workbook prints the marketing-stage lines a phase expenses (sellingExpense.ts:
 * never capex, charged by the P&L in the year spent) as their own block on Capex. Each is
 * valued here exactly as the engine values it, through computeAssetCost with the revenue
 * collections and bases, so the rows tie to the P&L. One call site, in a file of its own.
 *
 * No em dashes in this file.
 */
import { computeAssetCost } from '@/src/core/calculations';
import { collectionsForAsset, phaseLocalToProjectIndex } from '@/src/core/calculations/capexPhasing';
import { isExpensedAsIncurred } from '@/src/core/calculations/sellingExpense';
import type { computeFinancialsSnapshot, FinancialsResolverState } from '../financials-resolvers';
import type { Asset } from '../state/module1-types';

export interface ExpensedRow { a: Asset; line: FinancialsResolverState['costLines'][number]; per: number[]; amount: number }

/** Each asset's expensed lines, per project year; `keep` says whether a line has a row for the asset. */
export function expensedRowsOf(
  state: FinancialsResolverState,
  snap: ReturnType<typeof computeFinancialsSnapshot>,
  assetIds: readonly string[],
  keep: (assetId: string, lineId: string, valued: boolean) => boolean,
): ExpensedRow[] {
  const N = snap.axisLength;
  const out: ExpensedRow[] = [];
  for (const id of assetIds) {
    const a = state.assets.find((x) => x.id === id);
    const ph = a && state.phases.find((p) => p.id === a.phaseId);
    if (!a || !ph) continue;
    const exp = state.costLines.filter((c) => c.phaseId === ph.id && isExpensedAsIncurred(c));
    if (!exp.length) continue;
    const bd = computeAssetCost({
      asset: a, project: state.project, phase: ph, parcels: state.parcels, assets: state.assets, subUnits: state.subUnits, costLines: state.costLines, costOverrides: state.costOverrides,
      landAllocationMode: state.landAllocationMode, parcelFunding: state.project.financing?.parcelFunding,
      collectionsPerPeriod: collectionsForAsset(snap.revenue as never, a.id, ph, snap.projectStartYear), revenue: snap.revenue as never,
    });
    const off = Math.max(0, new Date(ph.startDate as string).getUTCFullYear() - snap.projectStartYear);
    for (const line of exp) {
      if (!keep(a.id, line.id, line.id in bd.expensed.byLineId)) continue;
      const per = new Array<number>(N).fill(0);
      (bd.expensed.perLinePerPeriod[line.id] ?? []).forEach((v, i) => { const t = phaseLocalToProjectIndex(i, off); if (t >= 0 && t < N) per[t] += v ?? 0; });
      out.push({ a, line, per, amount: bd.expensed.byLineId[line.id] ?? 0 });
    }
  }
  return out;
}
