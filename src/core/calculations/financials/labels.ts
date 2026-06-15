/**
 * M4 Pass 2b (2026-05-20): country-driven financial-statement label set.
 *
 * Most jurisdictions use the international FRS / IFRS terminology
 * (EBITDA, EBIT, PBT, PAT, Tax). Saudi Arabia swaps the direct charge
 * to Zakat: Zakat, "Profit before Zakat", "Profit after Zakat". EBITDA
 * and EBIT are universal acronyms and stay EXACTLY the same in both
 * modes (the "T" in EBITDA / EBIT is part of the standard term, never
 * relabelled). The shape of every statement is identical, only the row
 * labels change, so a single source-of-truth label set keeps the
 * engines clean and the UI consistent.
 *
 * Drive via `project.financialTerminology` ('standard' | 'saudi').
 * Defaults to 'standard'. UI components call getFinancialLabels(mode).
 */

export type FinancialTerminologyMode = 'standard' | 'saudi';

export interface FinancialLabels {
  /** EBITDA: earnings before interest, tax, D&A. Universal, identical in both modes. */
  ebitda: string;
  /** EBIT: earnings before interest and tax. Universal, identical in both modes. */
  ebit: string;
  /** PBT / "Profit before Zakat": profit before the direct charge. */
  pbt: string;
  /** PAT / "Profit after Zakat": profit after the direct charge. */
  pat: string;
  /** Tax / Zakat: direct tax charge on PBT. */
  tax: string;
  /** "Tax Paid" / "Zakat Paid": cash-flow line. */
  taxPaid: string;
  /** "Tax Rate" / "Zakat Rate": input label. */
  taxRate: string;
  /** "Income Statement" / "P&L" headline. Saudi keeps "Income Statement". */
  incomeStatementTitle: string;
}

const STANDARD: FinancialLabels = {
  ebitda: 'EBITDA',
  ebit: 'EBIT',
  pbt: 'PBT',
  pat: 'PAT',
  tax: 'Tax',
  taxPaid: 'Tax Paid',
  taxRate: 'Tax Rate',
  incomeStatementTitle: 'Income Statement (P&L)',
};

const SAUDI: FinancialLabels = {
  // EBITDA + EBIT are universal acronyms: identical to standard, never relabelled.
  ebitda: 'EBITDA',
  ebit: 'EBIT',
  // Only the direct charge becomes Zakat; spell the profit lines out so there is
  // no mangled acronym (the old 'PBZ' / 'PAZ' were a wrong T->Z on PBT / PAT).
  pbt: 'Profit before Zakat',
  pat: 'Profit after Zakat',
  tax: 'Zakat',
  taxPaid: 'Zakat Paid',
  taxRate: 'Zakat Rate',
  incomeStatementTitle: 'Income Statement (P&L)',
};

export function getFinancialLabels(mode: FinancialTerminologyMode | undefined): FinancialLabels {
  return mode === 'saudi' ? SAUDI : STANDARD;
}

/**
 * Heuristic: pick the default terminology from the country string.
 * Used on hydrate so an existing snapshot with country='Saudi Arabia'
 * auto-gets the right labels without an explicit toggle.
 */
export function defaultTerminologyForCountry(country: string | undefined): FinancialTerminologyMode {
  if (!country) return 'standard';
  const c = country.trim().toLowerCase();
  if (c === 'saudi arabia' || c === 'ksa' || c === 'saudi') return 'saudi';
  return 'standard';
}
