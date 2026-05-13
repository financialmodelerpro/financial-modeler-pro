/**
 * Tab 4 Financing engine, internal result types (rebuild 2026-05-14).
 *
 * Every per-period array is PROJECT-period indexed and has length
 * equal to `axis.totalPeriods + 1` (column 0 holds the project Y0
 * lump for in-kind / existing-facility opening balances). Cropping
 * down to the UI's display window is the UI's job; the engine
 * always emits full project-period arrays.
 */

import type { FundingMethodId } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

export interface ProjectAxis {
  totalPeriods: number;
  phaseOffsets: Map<string, number>;
}

export interface CapexAggregate {
  totals: {
    exclAllLand: number;
    exclLandInKind: number;
    inclAllLand: number;
  };
  perPeriod: {
    exclAllLand: number[];
    exclLandInKind: number[];
    inclAllLand: number[];
    landCash: number[];
    landInKind: number[];
    nonLand: number[];
  };
}

export interface FundingRequirement {
  method1: number;
  method2: number;
  method3: number;
  selected: number;
  selectedMethodId: FundingMethodId;
  debtPct: number;
  equityPct: number;
}

export interface DebtEquitySplit {
  debt: number[];
  equity: number[];
  inKind: number[];
  landDebt: number[];
  landEquity: number[];
  nonLandDebt: number[];
  nonLandEquity: number[];
}

export interface FacilityResult {
  trancheId: string;
  sharePct: number;
  drawSchedule: number[];
  outstanding: number[];
  interestAccrued: number[];
  interestCapitalized: number[];
  interestPaid: number[];
  principalRepaid: number[];
  totalDrawn: number;
  totalInterest: number;
  totalPrincipal: number;
}

export interface CombinedDebtService {
  totalDrawdown: number[];
  totalInterestAccrued: number[];
  totalInterestCapitalized: number[];
  totalInterestExpensed: number[];
  totalPrincipalRepaid: number[];
  debtServiceCash: number[];
}

export interface EquityMovement {
  cashPerPeriod: number[];
  inKindPerPeriod: number[];
  totalPerPeriod: number[];
  totalCash: number;
  totalInKind: number;
  grandTotal: number;
}

export interface Reconciliation {
  ok: boolean;
  issues: string[];
}

export interface FinancingComputation {
  axis: ProjectAxis;
  capex: CapexAggregate;
  funding: FundingRequirement;
  debtEquitySplit: DebtEquitySplit;
  shares: Map<string, number>;
  facilities: Map<string, FacilityResult>;
  combined: CombinedDebtService;
  equity: EquityMovement;
  reconciliation: Reconciliation;
}
