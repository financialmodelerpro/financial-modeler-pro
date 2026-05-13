/**
 * Tab 4 Financing engine, orchestrator (rebuild 2026-05-14).
 *
 * Single entry point for the rebuilt Tab 4. Wraps the 7 modules
 * (axis, capex, funding, debtEquity, shares, schedule,
 * equityMovement) and runs reconcile() at the end so callers
 * surface any identity violation immediately.
 *
 * One source of truth per number; downstream UI never derives the
 * same quantity twice. All per-period arrays are PROJECT-period
 * indexed and length `axis.totalPeriods + 1`.
 */

import type {
  Project,
  Phase,
  Parcel,
  Asset,
  SubUnit,
  CostLine,
  CostOverride,
  LandAllocationMode,
  FinancingTranche,
  EquityContribution,
  ProjectFinancingConfig,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

import { buildProjectAxis } from './axis';
import { aggregateProjectCapex } from './capex';
import { computeFundingRequirement } from './funding';
import { computeDebtEquitySplit } from './debtEquity';
import { normaliseFacilityShares } from './shares';
import { computeFacilitySchedule, combineDebtService } from './schedule';
import { computeEquityMovement } from './equityMovement';
import { reconcile } from './reconcile';
import type { FacilityResult, FinancingComputation } from './types';

export interface FinancingContext {
  project: Project;
  phases: Phase[];
  parcels: Parcel[];
  assets: Asset[];
  subUnits: SubUnit[];
  costLines: CostLine[];
  costOverrides: CostOverride[];
  landAllocationMode: LandAllocationMode;
  financingConfig: ProjectFinancingConfig;
  tranches: FinancingTranche[];
  equityContributions: EquityContribution[];
}

export function computeFinancingResult(ctx: FinancingContext): FinancingComputation {
  const axis = buildProjectAxis(ctx.project, ctx.phases);

  const capex = aggregateProjectCapex({
    project:            ctx.project,
    phases:             ctx.phases,
    parcels:            ctx.parcels,
    assets:             ctx.assets,
    subUnits:           ctx.subUnits,
    costLines:          ctx.costLines,
    costOverrides:      ctx.costOverrides,
    landAllocationMode: ctx.landAllocationMode,
    parcelFunding:      ctx.financingConfig.parcelFunding ?? [],
  }, axis);

  const funding = computeFundingRequirement(capex, ctx.financingConfig);

  const split = computeDebtEquitySplit(
    capex,
    funding,
    ctx.parcels,
    ctx.financingConfig.parcelFunding ?? [],
    axis,
  );

  const shares = normaliseFacilityShares(ctx.tranches);

  const facilities = new Map<string, FacilityResult>();
  for (const t of ctx.tranches) {
    const pct = shares.get(t.id) ?? 0;
    facilities.set(
      t.id,
      computeFacilitySchedule(t, ctx.project, ctx.phases, axis, split.debt, pct),
    );
  }

  const combined = combineDebtService(facilities, axis);
  const equity = computeEquityMovement(split, axis);
  const reconciliation = reconcile(axis, capex, funding, split, shares, facilities, equity);

  return { axis, capex, funding, debtEquitySplit: split, shares, facilities, combined, equity, reconciliation };
}

export type {
  FinancingComputation,
  ProjectAxis,
  CapexAggregate,
  FundingRequirement,
  DebtEquitySplit,
  FacilityResult,
  CombinedDebtService,
  EquityMovement,
  Reconciliation,
} from './types';
