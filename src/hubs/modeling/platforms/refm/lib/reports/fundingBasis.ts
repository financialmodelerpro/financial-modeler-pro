/**
 * fundingBasis.ts (2026-09-17)
 *
 * THE FUNDING BASIS CHECK, ONE RULE for the Financing screen (section 3) and
 * the Excel workbook.
 *
 * The check compared debt + equity against capex (excl. land in-kind) plus the
 * minimum cash. That identity holds only when the funding method finances ALL
 * capex (Method 1). Methods 2 and 3 size debt and equity NET of the project's
 * own cash (pre-sales, operating inflows), so on the live project the chip read
 * "Gap -509,516,352" while debt + equity (742.9m) matched the selected method's
 * funding need exactly: the 509.5m is capex the project pays from its own cash,
 * not a hole in the funding.
 *
 * So the test is the one the sizing actually makes: sources = the selected
 * method's funding need (incl. the minimum cash). The rest of the uses is shown
 * as its own visible line, "funded from project cash", never hidden in a gap.
 *
 * Pure. No em dashes in this file.
 */
import type { FinancingComputation } from '@/src/core/calculations/financing/types';

export interface FundingBasis {
  /** Capex excl. land in-kind (Capex Table 3). */
  capexExclInKind: number;
  minCashReserve: number;
  /** Capex excl. land in-kind + minimum cash. */
  uses: number;
  /** The selected method's funding need, incl. the minimum cash. */
  fundingNeed: number;
  debt: number;
  equity: number;
  /** Debt + equity sized by the selected method. */
  sources: number;
  /** Uses the sizing leaves to the project's own cash (pre-sales, operations); 0 under Method 1. */
  fundedFromProjectCash: number;
  /** Sources match the funding need (within 1 unit). */
  ok: boolean;
  /** Sources less the funding need (0 when ok). */
  gap: number;
}

const sum = (a: number[] | undefined): number => (a ?? []).reduce((s, v) => s + (v ?? 0), 0);

export function computeFundingBasis(fin: Pick<FinancingComputation, 'capex' | 'funding' | 'debtEquitySplit'>): FundingBasis {
  const capexExclInKind = fin.capex.totals.exclLandInKind;
  const minCashReserve = fin.funding.minCashReserve ?? 0;
  const uses = capexExclInKind + minCashReserve;
  const fundingNeed = fin.funding.selectedWithMinCash;
  const debt = sum(fin.debtEquitySplit.debt);
  const equity = sum(fin.debtEquitySplit.equity);
  const sources = debt + equity;
  const gap = sources - fundingNeed;
  return {
    capexExclInKind, minCashReserve, uses, fundingNeed, debt, equity, sources,
    fundedFromProjectCash: uses - fundingNeed,
    ok: Math.abs(gap) < 1,
    gap,
  };
}
