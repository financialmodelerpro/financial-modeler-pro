/**
 * verify-capex-stage-buckets.ts (2026-08-16)
 *
 * `aggregateProjectCapex` buckets every cost line's per-period distribution by
 * stage. It built those buckets from a HAND-WRITTEN LITERAL
 * (`{ land, hard, soft, operating }`) and incremented without a guard, so
 * adding the `marketing` stage made a non-zero marketing line throw
 * `TypeError: Cannot read properties of undefined`.
 *
 * IT SHIPPED BECAUSE NO FIXTURE GAVE MARKETING A RATE. The seeded line carries
 * zero, and computeAssetCost skips zero-total lines before building
 * perLinePerPeriod, so the crash needed a user to type a number. The whole
 * 111-verifier suite passed over it twice.
 *
 * So this file does two things:
 *   A. every stage in the registry survives the aggregate, driven off
 *      COST_STAGES so a future stage is covered the day it is added
 *   B. a NON-ZERO marketing line specifically, which is the case that threw
 *
 * Run: npx tsx scripts/verify-capex-stage-buckets.ts
 * No em dashes in this file.
 */

import { aggregateProjectCapex } from '../src/core/calculations/financing/capex';
import { deriveCostStage } from '../src/core/calculations';
import {
  makeBlankCostLines, makeDefaultPhase, makeDefaultProject,
  COST_STAGES,
  type Asset, type CostLine, type SubUnit,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { passed += 1; return; }
  failures.push(`${name}${detail ? `  [${detail}]` : ''}`);
};

const project = makeDefaultProject();
const phase = { ...makeDefaultPhase(), id: 'p1', constructionPeriods: 3, operationsPeriods: 3, status: 'planned' };
const asset = {
  id: 'a1', phaseId: 'p1', name: 'A', type: '', strategy: 'Sell', visible: true,
  gfaSqm: 1000, buaSqm: 1000, sellableBuaSqm: 1000, parkingBaysRequired: 4, status: 'planned',
} as Asset;
const subUnits: SubUnit[] = [{
  id: 'su1', assetId: 'a1', name: 'U', category: 'Sellable',
  metric: 'units', metricValue: 10, unitArea: 100, unitPrice: 100_000,
} as SubUnit];
const parcels = [{ id: 'pc1', phaseId: 'p1', name: 'Plot', area: 5000, rate: 400, cashPct: 100, inKindPct: 0 }];
const axis = { totalPeriods: 8, phaseOffsets: new Map([['p1', 0]]) };

const aggregate = (lines: CostLine[]): ReturnType<typeof aggregateProjectCapex> =>
  aggregateProjectCapex({
    project, phases: [phase], assets: [asset], subUnits,
    parcels, costLines: lines, costOverrides: [], landAllocationMode: 'autoByBua',
  } as never, axis as never);

const catalog = makeBlankCostLines('p1', 3);
const withRate = (baseId: string, value: number) => (c: CostLine): CostLine =>
  (c.id.split('__')[0] === baseId ? { ...c, value } : c);

// ── A. Every registered stage survives ─────────────────────────────────────
{
  const agg = aggregate(catalog);
  const keys = Object.keys(agg.perStagePerPeriod ?? {});
  for (const s of COST_STAGES) {
    check(`A1 the aggregate has a bucket for stage '${s}'`, keys.includes(s),
      `keys: ${keys.join(', ')}`);
  }
  check('A2 the buckets are exactly the registry, no more and no less',
    keys.length === COST_STAGES.length, `${keys.length} vs ${COST_STAGES.length}`);
}

// ── B. THE CASE THAT THREW ─────────────────────────────────────────────────
{
  // A marketing line with a real rate. Before the fix this threw outright.
  const lines = catalog.map(withRate('marketing', 3)).map(withRate('construction-bua', 2000));
  let threw = '';
  let agg: ReturnType<typeof aggregateProjectCapex> | null = null;
  try { agg = aggregate(lines); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
  check('B1 a NON-ZERO marketing line does not throw', threw === '', threw);
  if (agg) {
    const mk = agg.perStagePerPeriod?.marketing ?? [];
    const total = mk.reduce((s, v) => s + v, 0);
    check('B2 ...and its spend lands in the marketing bucket', total > 0, String(total));
    // 3% of gross revenue 10 x 100,000 = 30,000.
    check('B3 ...at the right amount', Math.abs(total - 30_000) < 1e-6, String(total));
    check('B4 ...and NOT in the soft bucket',
      Math.abs((agg.perStagePerPeriod?.soft ?? []).reduce((s, v) => s + v, 0)) < 1e-9,
      'marketing must not be counted as a soft cost');
    // The per-stage rows must still reconcile to the headline schedule, or the
    // bucketing is losing money somewhere.
    const stageSum = COST_STAGES.reduce(
      (s, st) => s + (agg!.perStagePerPeriod?.[st] ?? []).reduce((a, v) => a + v, 0), 0);
    const incl = agg.perPeriod.inclAllLand.reduce((s, v) => s + v, 0);
    check('B5 the per-stage rows reconcile to inclAllLand',
      Math.abs(stageSum - incl) < 1e-6, `${stageSum} vs ${incl}`);
  }
}

// ── C. A line on an UNKNOWN stage is skipped, not thrown on ────────────────
{
  const rogue = [...catalog, ({
    id: 'rogue__p1', phaseId: 'p1', name: 'Rogue', method: 'fixed', value: 1000,
    stage: 'not_a_stage', scope: 'direct', allocationBasis: 'per_asset',
    startPeriod: 1, endPeriod: 2, phasing: 'even',
  } as unknown as CostLine)];
  let threw = '';
  try { aggregate(rogue); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
  check('C1 an unregistered stage is skipped rather than crashing the model', threw === '', threw);
}

// ── D. Stage is DERIVED here, as everywhere else ───────────────────────────
{
  // A catalog line whose STORED stage contradicts its id. deriveCostStage wins,
  // so the financing path buckets it the same way the screen and reports do.
  const lying = catalog
    .map(withRate('construction-bua', 2000))
    .map((c) => (c.id.split('__')[0] === 'construction-bua' ? { ...c, stage: 'soft' } as CostLine : c));
  const agg = aggregate(lying);
  const hard = (agg.perStagePerPeriod?.hard ?? []).reduce((s, v) => s + v, 0);
  const soft = (agg.perStagePerPeriod?.soft ?? []).reduce((s, v) => s + v, 0);
  check('D1 a catalog line buckets by its DERIVED stage, not its stored one',
    hard > 0 && Math.abs(soft) < 1e-9, `hard=${hard} soft=${soft}`);
  check('D2 ...and deriveCostStage is what says so',
    deriveCostStage({ ...catalog.find((c) => c.id.startsWith('construction-bua'))!, stage: 'soft' } as CostLine) === 'hard');
}

console.log('');
if (failures.length === 0) {
  console.log(`verify-capex-stage-buckets: ${passed} passed, 0 failures`);
  process.exit(0);
}
console.log(`verify-capex-stage-buckets: ${passed} passed, ${failures.length} FAILURES`);
for (const f of failures) console.log(`  FAIL  ${f}`);
process.exit(1);
