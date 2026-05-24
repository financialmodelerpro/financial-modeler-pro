/**
 * Tab 4 Financing engine, orchestrator (rebuild 2026-05-14).
 *
 * Single entry point for the rebuilt Tab 4. Wraps the 8 modules
 * (axis, capex, funding, debtEquity, shares, schedule, equityMovement,
 * existing) and runs reconcile() at the end so callers surface any
 * identity violation immediately.
 *
 * One source of truth per number; downstream UI never derives the
 * same quantity twice. All per-period arrays are PROJECT-period
 * indexed and length `axis.totalPeriods + 1`. Index 0 is the prior
 * column (Y0 lump for new-construction land, opening balance for
 * existing facilities, operational pre-capex / existing equity).
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
import { buildExistingAggregate } from './existing';
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
  const existing = buildExistingAggregate(ctx.phases, ctx.tranches, ctx.assets, ctx.project);

  const facilities = new Map<string, FacilityResult>();
  for (const t of ctx.tranches) {
    const pct = shares.get(t.id) ?? 0;
    facilities.set(
      t.id,
      computeFacilitySchedule(t, ctx.project, ctx.phases, axis, split.debt, pct),
    );
  }

  const combined = combineDebtService(facilities, axis, ctx.tranches);
  const equity = computeEquityMovement(split, existing, axis);
  const reconciliation = reconcile(axis, capex, funding, split, shares, facilities, ctx.tranches, equity, existing);

  return {
    axis, capex, funding, debtEquitySplit: split,
    shares, facilities, combined, equity, existing,
    reconciliation,
  };
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
  ExistingAggregate,
  Reconciliation,
} from './types';
