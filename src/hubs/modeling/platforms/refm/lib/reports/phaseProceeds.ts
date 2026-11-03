/**
 * phaseProceeds.ts (2026-11-03), A PHASE'S SHARE OF THE EXIT PROCEEDS, ONE RULE.
 *
 * The exit sells the held assets (hotel and lease lines) as one disposal. A phase's share is its
 * held lines' income (revenue less opex) in the basis year over the project's, so the phases add to
 * the project exactly. Read by the platform's phase cash flow, the live workbook's Financing tab
 * and its phase cash flows.
 *
 * No em dashes in this file.
 */
import type { computeFinancialsSnapshot, FinancialsResolverState } from '../financials-resolvers';

type Snap = ReturnType<typeof computeFinancialsSnapshot>;

/** The held lines' income per year, for one phase or (phaseId null) the project. */
export function heldIncomePerPeriod(snap: Snap, state: Pick<FinancialsResolverState, 'assets'>, phaseId: string | null): number[] {
  const N = snap.axisLength;
  const v = new Array<number>(N).fill(0);
  const phaseOf = new Map(state.assets.map((a) => [a.id, a.phaseId] as const));
  for (const pa of snap.perAssetPL.values()) {
    if (pa.strategy !== 'Operate' && pa.strategy !== 'Lease') continue;
    if (phaseId && phaseOf.get(pa.assetId) !== phaseId) continue;
    for (let t = 0; t < N; t++) v[t] += (pa.revenuePerPeriod[t] ?? 0) - (pa.opexPerPeriod[t] ?? 0);
  }
  return v;
}

/** The phase's share of the exit proceeds (0 when the project's held income in the basis year is 0). */
export function phaseProceedsShare(snap: Snap, state: Pick<FinancialsResolverState, 'assets'>, phaseId: string): number {
  const M = snap.disposal.metricIdx;
  const all = heldIncomePerPeriod(snap, state, null)[M] ?? 0;
  return all !== 0 ? (heldIncomePerPeriod(snap, state, phaseId)[M] ?? 0) / all : 0;
}

/** The phase's exit proceeds per year: the project's proceeds x the phase's share. */
export function phaseProceedsPerPeriod(snap: Snap, state: Pick<FinancialsResolverState, 'assets'>, phaseId: string): number[] {
  const share = phaseProceedsShare(snap, state, phaseId);
  return Array.from({ length: snap.axisLength }, (_, t) => (snap.directCF.proceedsFromDisposalPerPeriod?.[t] ?? 0) * share);
}
