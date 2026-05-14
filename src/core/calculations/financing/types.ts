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
  method4: number;
  selected: number;
  selectedMethodId: FundingMethodId;
  debtPct: number;
  equityPct: number;
  // Pass 26 (2026-05-14): Minimum Cash Reserve buffer.
  //   minCashReserve         = project-level setting (lump value)
  //   minCashByPeriod        = lump placed at the first non-zero
  //                            capex period (axis-indexed)
  //   selectedByPeriod       = capex-only funding need per period
  //                            (mirrors selected method curve)
  //   totalFundingNeedByPeriod = selectedByPeriod + minCashByPeriod
  //   selectedWithMinCash    = sum of totalFundingNeedByPeriod
  // Methods 1 + 2 add the buffer on top of the selected curve. Method
  // 3 (Cash Deficit) absorbs it implicitly via the deficit calc.
  minCashReserve: number;
  minCashByPeriod: number[];
  selectedByPeriod: number[];
  totalFundingNeedByPeriod: number[];
  selectedWithMinCash: number;
  // Pass 30 (2026-05-14): Method 4 (Specified Debt + Equity) supplies
  // per-period debt + equity arrays directly. When set, debtEquity.ts
  // uses these instead of the capex-derived split.
  customDebtByPeriod?: number[];
  customEquityByPeriod?: number[];
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
  // Pass 31 (2026-05-14): existing-vs-new breakdowns so the Combined
  // Debt Service table can render a separate line for each origin
  // alongside the totals. Existing facilities never produce capex
  // drawdown (their debt is already on the books) so their drawdown
  // arrays are intentionally absent.
  existingInterestAccrued: number[];
  existingInterestExpensed: number[];
  existingPrincipalRepaid: number[];
  existingDebtServiceCash: number[];
  newInterestAccrued: number[];
  newInterestExpensed: number[];
  newPrincipalRepaid: number[];
  newDebtServiceCash: number[];
}

export interface EquityMovement {
  cashPerPeriod: number[];
  inKindPerPeriod: number[];
  existingEquityPerPeriod: number[];
  totalPerPeriod: number[];
  totalCash: number;
  totalInKind: number;
  totalExisting: number;
  grandTotal: number;
}

export interface ExistingAggregate {
  preCapexTotal: number;
  debtOutstandingTotal: number;
  equityTotal: number;
  preCapexByPhase: Map<string, number>;
  debtByPhase: Map<string, number>;
  equityByPhase: Map<string, number>;
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
  existing: ExistingAggregate;
  reconciliation: Reconciliation;
}
