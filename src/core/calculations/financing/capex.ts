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
 * Project capex aggregation (no-prior-column convention, 2026-05-14).
 *
 * Maps `distributeItemCost`'s local index 0 (Y0 lump) AND local index 1
 * (first construction period) to `projIdx = phaseOffset`, so they
 * sum at the phase's first active project column. Local i >= 2 maps
 * to `projIdx = phaseOffset + i - 1`. This gives a phase with
 * constructionPeriods = cp a contiguous block of cp project cols.
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
        const projIdx = i === 0 ? offset : offset + i - 1;
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
