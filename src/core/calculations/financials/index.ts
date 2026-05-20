/**
 * Module 4 Financial Statements — public entry.
 *
 * Composes M2 (revenue + CoS) + M3 (opex + AP) + M4 Pass 1 (D&A) + M1
 * (financing) into the canonical P&L, Cash Flow (Direct + Indirect)
 * and Balance Sheet surfaces. Pure functions; no store reads.
 */

export {
  getFinancialLabels,
  defaultTerminologyForCountry,
} from './labels';
export type {
  FinancialLabels,
  FinancialTerminologyMode,
} from './labels';
