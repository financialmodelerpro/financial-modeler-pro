/**
 * Tab 4 Financing engine, internal result types (rebuild 2026-05-14).
 *
 * Every per-period array is PROJECT-period indexed and has length
 * equal to `axis.totalPeriods` (NO prior column). arr[0] is the
 * project's FIRST active year. Cropping down to the UI's display
 * window is the UI's job; the engine always emits full project-
 * period arrays.
 *
 * NOTE (Pass 2N-Fix 2026-05-21): earlier docstrings claimed arrays
 * were length+1 with column 0 = prior. That convention was retired
 * in axis.ts (2026-05-14) but several composer slices kept the
 * stale +1 assumption, dropping year-0 financing data. See
 * financials-resolvers.ts for the back-correction.
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
  /** Closing balance at end of each project year. Length = totalPeriods. */
  outstanding: number[];
  /** Balance carried into year 0 (start-of-axis). Existing tranches with
   *  origination before the axis seed this; new tranches + existing
   *  raised inside the axis are 0. Use this for the BS prior-year column. */
  openingBalance: number;
  interestAccrued: number[];
  /** Construction-window interest added to the debt balance (funding via
   *  additional drawdown). Zero when idcConfig.fundingMode === 'cash'.
   *  Used by the financing CF block as "IDC Drawdown". */
  interestCapitalized: number[];
  interestPaid: number[];
  /** M4 Pass 2O (2026-05-24): construction-window interest routed to
   *  asset basis for accounting. Zero when idcConfig.capitalize === false.
   *  Decoupled from interestCapitalized (which is the funding side).
   *  Source for the IDC allocator in financials-resolvers. */
  interestForAssetBasis: number[];
  /** M4 Pass 2O (2026-05-24): interest accrued during the construction
   *  window of this facility (gross, ignores capitalize / fundingMode).
   *  Lets the IDC Summary panel show construction-interest stream even
   *  when capitalize=false. Zero outside the construction window and
   *  for existing facilities. */
  interestDuringConstruction: number[];
  principalRepaid: number[];
  totalDrawn: number;
  totalInterest: number;
  totalPrincipal: number;
}

export interface CombinedDebtService {
  totalDrawdown: number[];
  totalInterestAccrued: number[];
  /** Sum of FacilityResult.interestCapitalized: amount added to debt
   *  balance (the "additional drawdown" piece). Zero when fundingMode='cash'. */
  totalInterestCapitalized: number[];
  /** P&L Interest Expense (accrual basis) = totalInterestAccrued -
   *  totalInterestForAssetBasis. Construction interest when capitalize=false
   *  flows through here. M4 Pass 2O. */
  totalInterestExpensed: number[];
  /** Sum of FacilityResult.interestForAssetBasis: amount going to asset
   *  basis (IDC source for the composer's allocation). M4 Pass 2O. */
  totalInterestForAssetBasis: number[];
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
