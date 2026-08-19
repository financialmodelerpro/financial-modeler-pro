import type {
  Project,
  Phase,
  Parcel,
  Asset,
  SubUnit,
  CostLine,
  CostOverride,
  CostStage,
  LandAllocationMode,
  ParcelFundingConfig,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { COST_STAGES } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { computeAssetCost, deriveCostStage } from '../index';
import { collectionsForAssetAtOffset, phaseLocalToProjectIndex, type CollectionsSource } from '../capexPhasing';
import type { CapexAggregate, ProjectAxis } from './types';

export interface CapexInputs {
  project: Project;
  phases: Phase[];
  parcels: Parcel[];
  assets: Asset[];
  subUnits: SubUnit[];
  costLines: CostLine[];
  costOverrides: CostOverride[];
  landAllocationMode: LandAllocationMode;
  parcelFunding: ParcelFundingConfig[];
  /**
   * 2026-08-16: the revenue engine's per-asset output, so a cost line that
   * follows collections phases here exactly as it does in the P&L path.
   *
   * Optional, and the reason it can be: the revenue engine runs BEFORE the
   * financing solve and reads no cost input, so supplying it introduces no
   * circularity. A caller that omits it leaves collections-following lines on
   * their own curve, which is a divergence, so every production caller passes
   * it and `verify-capex-collections` checks that they do.
   */
  revenue?: CollectionsSource;
}

/**
 * Project capex aggregation (mirrors Costs tab Table 3 mapping, 2026-05-14).
 *
 * Maps `distributeItemCost`'s local indices onto the project axis with the
 * SHARED `phaseLocalToProjectIndex`, which is the one definition of that rule.
 *
 * 2026-08-17: this docstring used to describe the Y0 lump as dropped for phase
 * 1 and claimed the Costs tab matched. Neither had been true since M4 Pass 2W
 * (2026-05-24) clamped the mapping here: the code below has placed phase 1's Y0
 * lump at axis index 0 ever since, while the Costs tab kept dropping it, so the
 * two surfaces disagreed by the whole of a first phase's land for twelve weeks.
 * Both now call the same function, and the comment describes what it does.
 *
 * Operational phases (status === 'operational') are skipped entirely;
 * their historical capex flows through `existing.ts` instead.
 */
export function aggregateProjectCapex(inputs: CapexInputs, axis: ProjectAxis): CapexAggregate {
  const N = axis.totalPeriods;
  const inclAllLand   = new Array<number>(N).fill(0);
  const landTotal     = new Array<number>(N).fill(0);
  const landInKind    = new Array<number>(N).fill(0);

  // 2026-06-03: per-line totals (for the exact computed Amount of every
  // cost line) + per-stage per-period schedule (for the full Capex
  // Results breakdown). lineStage maps a cost-line id to its stage so the
  // per-line distribution can be bucketed by stage on the project axis.
  //
  // 2026-08-16: the stage is DERIVED, not read off the stored field. A catalog
  // line's stage comes from its id via deriveCostStage, which is what the
  // screen, the report builders and the engine's own byStage all use; reading
  // `cl.stage` here let the financing path bucket a line differently from every
  // other surface whenever the two disagree.
  const lineStage = new Map<string, CostStage>();
  for (const cl of inputs.costLines) lineStage.set(cl.id, deriveCostStage(cl));
  const perLineTotals: Record<string, number> = {};
  // 2026-08-16: buckets are DERIVED FROM COST_STAGES, not a literal.
  //
  // This was `{ land, hard, soft, operating }` written out by hand, and the
  // increment below is unguarded, so adding the `marketing` stage made a
  // non-zero marketing line throw `Cannot read properties of undefined`. It was
  // latent only because the seeded line carries a zero rate and computeAssetCost
  // skips zero-total lines before building perLinePerPeriod, so the crash needed
  // a user to type a rate. Deriving the keys means a future stage cannot
  // reintroduce it.
  const perStagePerPeriod: Record<string, number[]> = {};
  for (const s of COST_STAGES) perStagePerPeriod[s] = new Array<number>(N).fill(0);

  for (const phase of inputs.phases) {
    if (phase.status === 'operational') continue;
    const offset = axis.phaseOffsets.get(phase.id) ?? 0;
    const phaseAssets = inputs.assets.filter((a) => a.phaseId === phase.id && a.visible);
    for (const asset of phaseAssets) {
      const breakdown = computeAssetCost({
        asset,
        project: inputs.project,
        phase,
        parcels: inputs.parcels,
        assets: inputs.assets,
        subUnits: inputs.subUnits,
        costLines: inputs.costLines,
        costOverrides: inputs.costOverrides,
        landAllocationMode: inputs.landAllocationMode,
        parcelFunding: inputs.parcelFunding,
        // The axis already holds this phase's offset, so use it rather than
        // re-deriving one from dates: two sources for the same number is how
        // the financing schedule ends up a period out from the P&L.
        collectionsPerPeriod: collectionsForAssetAtOffset(inputs.revenue, asset.id, offset, phase),
        // The revenue snapshot (2026-08-19). Same one-directional link as the
        // collections series above: revenue depends on sub-units and phases and
        // never on cost, so it is fully resolved before any cost is valued.
        revenue: inputs.revenue,
      });
      // Per-line computed totals (summed across every asset that draws on
      // the line). byLineId already carries the asset's resolved amount.
      for (const [lineId, amt] of Object.entries(breakdown.byLineId ?? {})) {
        perLineTotals[lineId] = (perLineTotals[lineId] ?? 0) + (amt ?? 0);
      }
      // Per-line per-period distribution, bucketed by stage and placed on
      // the project axis with the SAME offset rule as the totals below so
      // the per-stage rows reconcile to inclAllLand.
      for (const [lineId, dist] of Object.entries(breakdown.perLinePerPeriod ?? {})) {
        const stage = lineStage.get(lineId);
        if (!stage) continue;
        // Defensive even though the keys are now derived: a line carrying a
        // stage outside the registry (a hand-built fixture, a legacy snapshot)
        // must be skipped, not thrown on. Dropping it from the per-stage
        // schedule is recoverable; crashing the whole model is not.
        const bucket = perStagePerPeriod[stage];
        if (!bucket) continue;
        for (let i = 0; i < dist.length; i++) {
          const projIdx = phaseLocalToProjectIndex(i, offset);
          if (projIdx < 0 || projIdx >= N) continue;
          bucket[projIdx] += dist[i] ?? 0;
        }
      }
      const perAll  = breakdown.perPeriod ?? [];
      const perLand = breakdown.perPeriodLandTotal ?? [];
      const perInK  = breakdown.perPeriodLandInKind ?? [];
      const len = Math.max(perAll.length, perLand.length, perInK.length);
      for (let i = 0; i < len; i++) {
        // M4 Pass 2W (2026-05-24) clamped phase 1's i=0 lump onto axis index 0
        // rather than dropping it at -1, which had been silently deleting the
        // upfront land. 2026-08-17: that rule is now SHARED, because the Costs
        // tab was still dropping it and the two surfaces disagreed by the whole
        // of a first phase's land.
        const projIdx = phaseLocalToProjectIndex(i, offset);
        if (projIdx < 0 || projIdx >= N) continue;
        inclAllLand[projIdx] += perAll[i] ?? 0;
        landTotal[projIdx]   += perLand[i] ?? 0;
        landInKind[projIdx]  += perInK[i]  ?? 0;
      }
    }
  }

  const landCash       = new Array<number>(N).fill(0);
  const nonLand        = new Array<number>(N).fill(0);
  const exclAllLand    = new Array<number>(N).fill(0);
  const exclLandInKind = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) {
    landCash[i]       = Math.max(0, landTotal[i] - landInKind[i]);
    nonLand[i]        = Math.max(0, inclAllLand[i] - landTotal[i]);
    exclAllLand[i]    = nonLand[i];
    exclLandInKind[i] = nonLand[i] + landCash[i];
  }

  const totals = {
    exclAllLand:    sum(exclAllLand),
    exclLandInKind: sum(exclLandInKind),
    inclAllLand:    sum(inclAllLand),
  };

  return {
    totals,
    perPeriod: { exclAllLand, exclLandInKind, inclAllLand, landCash, landInKind, nonLand },
    perLineTotals,
    perStagePerPeriod,
  };
}

function sum(arr: number[]): number {
  let s = 0;
  for (const v of arr) s += v;
  return s;
}
