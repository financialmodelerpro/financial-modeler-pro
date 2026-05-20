/**
 * M4 Pass 2b (2026-05-20): country-driven financial-statement label set.
 *
 * Most jurisdictions use the international FRS / IFRS terminology
 * (EBITDA, EBIT, PBT, PAT, Tax). Saudi Arabia uses Zakat-flavour
 * terminology (EBIZDA, EBIZ, PBZ, PAZ, Zakat). The shape of every
 * statement is identical — only the row labels change — so a single
 * source-of-truth label set keeps the engines clean and the UI
 * consistent.
 *
 * Drive via `project.financialTerminology` ('standard' | 'saudi').
 * Defaults to 'standard'. UI components call getFinancialLabels(mode).
 */

export type FinancialTerminologyMode = 'standard' | 'saudi';

export interface FinancialLabels {
  /** EBITDA / EBIZDA — earnings before interest, tax, D&A. */
  ebitda: string;
  /** EBIT / EBIZ — earnings before interest and tax. */
  ebit: string;
  /** PBT / PBZ — profit before tax. */
  pbt: string;
  /** PAT / PAZ — profit after tax. */
  pat: string;
  /** Tax / Zakat — direct tax charge on PBT. */
  tax: string;
  /** "Tax Paid" / "Zakat Paid" — cash-flow line. */
  taxPaid: string;
  /** "Tax Rate" / "Zakat Rate" — input label. */
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
  ebitda: 'EBIZDA',
  ebit: 'EBIZ',
  pbt: 'PBZ',
  pat: 'PAZ',
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
