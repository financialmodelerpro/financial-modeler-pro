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
import { computeAssetCost } from '../index';
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
}

/**
 * Project capex aggregation (mirrors Costs tab Table 3 mapping, 2026-05-14).
 *
 * Maps `distributeItemCost`'s local indices onto the project axis using
 * the same offset rule as Module1Costs Table 3 (Capex Excl Land In-Kind):
 *   - Local i = 0 (Y0 upfront lump): only included when offset > 0,
 *     placed at projIdx = offset - 1 (the year before the phase starts).
 *     Phase 1 (offset = 0) drops its Y0 lump entirely.
 *   - Local i >= 1: projIdx = offset + i - 1, so the phase's first
 *     construction year (i = 1) lands at projIdx = offset.
 *
 * This guarantees the Financing Tab's Capex Breakdown table shows the
 * exact same per-year values as the Costs Tab's Capex schedule.
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
  const lineStage = new Map<string, CostStage>();
  for (const cl of inputs.costLines) lineStage.set(cl.id, cl.stage);
  const perLineTotals: Record<string, number> = {};
  const perStagePerPeriod: Record<string, number[]> = {
    land: new Array<number>(N).fill(0),
    hard: new Array<number>(N).fill(0),
    soft: new Array<number>(N).fill(0),
    operating: new Array<number>(N).fill(0),
  };

  for (const phase of inputs.phases) {
    if (phase.status === 'operational') continue;
    const offset = axis.phaseOffsets.get(phase.id) ?? 0;
    const phaseAssets = inputs.assets.filter((a) => a.phaseId === phase.id && a.visible);
    for (const asset of phaseAssets) {
      const breakdown = computeAssetCost(
        asset,
        inputs.project,
        phase,
        inputs.parcels,
        inputs.assets,
        inputs.subUnits,
        inputs.costLines,
        inputs.costOverrides,
        inputs.landAllocationMode,
        inputs.parcelFunding,
      );
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
        const bucket = perStagePerPeriod[stage];
        for (let i = 0; i < dist.length; i++) {
          const projIdx = i === 0 ? Math.max(0, offset - 1) : offset + i - 1;
          if (projIdx < 0 || projIdx >= N) continue;
          bucket[projIdx] += dist[i] ?? 0;
        }
      }
      const perAll  = breakdown.perPeriod ?? [];
      const perLand = breakdown.perPeriodLandTotal ?? [];
      const perInK  = breakdown.perPeriodLandInKind ?? [];
      const len = Math.max(perAll.length, perLand.length, perInK.length);
      for (let i = 0; i < len; i++) {
        // M4 Pass 2W (2026-05-24): rescue Phase 1's i=0 lump from the
        // drop. Previously projIdx = offset - 1 produced -1 for Phase 1
        // (offset=0), silently deleting the Y0 capex (typically the
        // upfront land cash + in-kind). Equity engine stamps in-kind
        // at axis[0] regardless of phase (debtEquity.ts:131), so this
        // asymmetry leaked into the BS check as Assets < L+E during
        // construction. Now Phase 1's Y0 lump lands at axis index 0
        // (clamped) so both sides align. Phase 2+ behaviour unchanged
        // (Math.max(0, offset-1) = offset-1 when offset>=1).
        const projIdx = i === 0 ? Math.max(0, offset - 1) : offset + i - 1;
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
