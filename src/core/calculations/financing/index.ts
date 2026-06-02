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
import { computeFundingRequirement, type FundingGapInputs } from './funding';
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
  /**
   * Per-period funding-gap series for Methods 2 + 3 (Net Funding
   * Requirement + Cash Deficit). Derived from the post-revenue snapshot
   * (computeFundingGap) and passed in so the core engine stays free of
   * any revenue / FS dependency. Optional: absent => Methods 2 + 3
   * fall back to 0.
   */
  fundingGap?: FundingGapInputs;
  /**
   * Conditional IDC (2026-06-02): per-period surplus-cash budget available
   * to pay construction interest in cash instead of capitalising it to
   * debt (idcConfig.fundingMode === 'conditional'). Derived from the
   * post-revenue snapshot's Method 3 waterfall (cash above the minimum
   * reserve in each construction period) and fed via the snapshot
   * two-pass. Optional: absent => 'conditional' behaves like
   * 'debt_drawdown' (everything capitalised).
   */
  idcCashBudget?: number[];
  /**
   * Cash-sweep budget (2026-06-02): per-period cash available for debt
   * repayment (after min cash + dividends-before-sweep). Sweep-eligible
   * tranches repay principal from it (existing-first / priority order),
   * reducing the balance so interest follows. Derived from pass-1 of the
   * snapshot two-pass. Absent => no sweep repayment.
   */
  sweepBudget?: number[];
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

  const funding = computeFundingRequirement(capex, ctx.financingConfig, ctx.fundingGap);

  const split = computeDebtEquitySplit(
    capex,
    funding,
    ctx.parcels,
    ctx.financingConfig.parcelFunding ?? [],
    axis,
    ctx.phases,
    ctx.project,
  );

  const shares = normaliseFacilityShares(ctx.tranches);
  const existing = buildExistingAggregate(ctx.phases, ctx.tranches, ctx.assets, ctx.project);

  // Conditional IDC (2026-06-02): mutable per-period cash budget shared
  // across tranches. Each construction period pays interest in cash up to
  // the remaining budget, capitalising the shortfall. Tranches consume the
  // budget in EXISTING-first, then priority-ascending order (same ordering
  // the cash sweep uses) so allocation is deterministic.
  const remainingIdcBudget = (ctx.idcCashBudget ?? []).slice();
  const remainingSweepBudget = (ctx.sweepBudget ?? []).slice();
  const trancheOrder = ctx.tranches.slice().sort((a, b) => {
    const aEx = a.origin === 'existing';
    const bEx = b.origin === 'existing';
    if (aEx !== bEx) return aEx ? -1 : 1;
    const ap = a.cashSweepConfig?.priority ?? 100;
    const bp = b.cashSweepConfig?.priority ?? 100;
    return ap - bp;
  });

  // Compute schedules in budget-consumption order (existing-first), then
  // assemble the final map in the ORIGINAL tranche order so downstream
  // per-tranche tables keep their displayed sequence.
  const computed = new Map<string, FacilityResult>();
  for (const t of trancheOrder) {
    const pct = shares.get(t.id) ?? 0;
    computed.set(
      t.id,
      computeFacilitySchedule(t, ctx.project, ctx.phases, axis, split.debt, pct, remainingIdcBudget, remainingSweepBudget),
    );
  }
  const facilities = new Map<string, FacilityResult>();
  for (const t of ctx.tranches) {
    const r = computed.get(t.id);
    if (r) facilities.set(t.id, r);
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

export type { FundingGapInputs } from './funding';

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
