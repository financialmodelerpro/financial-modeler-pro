import type {
  Asset,
  Phase,
  FinancingTranche,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { getAssetPreCapexTotal } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import type { ExistingAggregate } from './types';

/**
 * Existing operations aggregate.
 *
 * Pass 38 (2026-05-14): pre-capex / existing equity derived from
 * per-asset values for assets in operational phases. The phase-level
 * historicalBaseline fields (historicalCapexTotal /
 * historicalEquityContributed) are deprecated and no longer read; the
 * trimmed Tab 1 form only collects opening-BS items
 * (currentDebtOutstanding, cumulativeDepreciation,
 * netBookValueFixedAssets) which are unrelated to this aggregation.
 *
 * Pass 56 (2026-05-16): pre-capex now reads through
 * getAssetPreCapexTotal(asset) so the Land + Building split sums into
 * the same total this aggregate has always exposed. Legacy snapshots
 * (only historicalPreCapex set) still produce the same numbers via the
 * helper's fallback.
 *
 * Existing debt comes from facilities with `origin === 'existing'`
 * (their `openingBalance`).
 */
export function buildExistingAggregate(
  phases: Phase[],
  tranches: FinancingTranche[],
  assets: Asset[] = [],
): ExistingAggregate {
  const preCapexByPhase = new Map<string, number>();
  const debtByPhase     = new Map<string, number>();
  const equityByPhase   = new Map<string, number>();

  const operationalPhaseIds = new Set(
    phases.filter((p) => p.status === 'operational').map((p) => p.id),
  );

  let preCapexTotal = 0;
  let equityTotal = 0;
  for (const a of assets) {
    if (!operationalPhaseIds.has(a.phaseId)) continue;
    const pc = getAssetPreCapexTotal(a);
    const eq = Math.max(0, a.historicalEquityAmount ?? 0);
    if (pc > 0) {
      preCapexByPhase.set(a.phaseId, (preCapexByPhase.get(a.phaseId) ?? 0) + pc);
      preCapexTotal += pc;
    }
    if (eq > 0) {
      equityByPhase.set(a.phaseId, (equityByPhase.get(a.phaseId) ?? 0) + eq);
      equityTotal += eq;
    }
  }

  let debtOutstandingTotal = 0;
  for (const t of tranches) {
    if (t.origin !== 'existing') continue;
    const ob = Math.max(0, t.openingBalance ?? 0);
    debtOutstandingTotal += ob;
    debtByPhase.set(t.phaseId, (debtByPhase.get(t.phaseId) ?? 0) + ob);
  }

  return {
    preCapexTotal,
    debtOutstandingTotal,
    equityTotal,
    preCapexByPhase,
    debtByPhase,
    equityByPhase,
  };
}
