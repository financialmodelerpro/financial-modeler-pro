import type {
  Phase,
  FinancingTranche,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import type { ExistingAggregate } from './types';

/**
 * Existing operations aggregate.
 *
 * Pre-capex / existing equity come from operational phases'
 * `historicalBaseline`. Existing debt comes from facilities with
 * `origin === 'existing'` (their `openingBalance`). Each is also
 * grouped by phase so Tab 1's validation chip can match
 * phase-level historical totals against the per-facility breakdown.
 */
export function buildExistingAggregate(
  phases: Phase[],
  tranches: FinancingTranche[],
): ExistingAggregate {
  const preCapexByPhase = new Map<string, number>();
  const debtByPhase     = new Map<string, number>();
  const equityByPhase   = new Map<string, number>();

  let preCapexTotal = 0;
  let equityTotal = 0;
  for (const phase of phases) {
    if (phase.status !== 'operational') continue;
    const b = phase.historicalBaseline;
    if (!b) continue;
    const pc = Math.max(0, b.historicalCapexTotal ?? 0);
    const eq = Math.max(0, b.historicalEquityContributed ?? 0);
    preCapexByPhase.set(phase.id, pc);
    equityByPhase.set(phase.id, eq);
    preCapexTotal += pc;
    equityTotal += eq;
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
