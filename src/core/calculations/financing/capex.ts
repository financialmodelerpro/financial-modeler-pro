import type {
  Project,
  Phase,
  Parcel,
  Asset,
  SubUnit,
  CostLine,
  CostOverride,
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
      const perAll  = breakdown.perPeriod ?? [];
      const perLand = breakdown.perPeriodLandTotal ?? [];
      const perInK  = breakdown.perPeriodLandInKind ?? [];
      const len = Math.max(perAll.length, perLand.length, perInK.length);
      for (let i = 0; i < len; i++) {
        const projIdx = i === 0 ? offset - 1 : offset + i - 1;
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
  };
}

function sum(arr: number[]): number {
  let s = 0;
  for (const v of arr) s += v;
  return s;
}
