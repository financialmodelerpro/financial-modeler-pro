/**
 * bsPlan.ts (2026-11-03), THE LIVE BALANCE SHEET, ROW BY ROW.
 *
 * One list of the rows the live Balance Sheet carries, with the platform's value for each: the
 * builder prints them and the statements layer (stage 5) writes each row's formula from its `src`,
 * so the two cannot disagree about what a row is.
 *
 * A STATEMENT THAT ONLY LINKS (2026-11-03, founder): every balance links ONE row of the tab that
 * works it out (Schedules: land, fixed assets, inventory; Revenue: the receivables, unearned revenue
 * and escrow; Opex: the payables; Financing: each facility's balance after the exit and the zakat
 * payable; the Cash Flow: cash). The debt total is the SUM of the facility rows. Equity links its
 * three roll-forwards beneath the statement: share capital (the opening on Inputs, the equity drawn,
 * less the capital returned), the statutory reserve (the rate x a positive profit after tax, capped
 * at the cap x share capital) and retained earnings (profit after tax, less the reserve and the
 * dividends). A distribution is a dividend up to the retained earnings available and a return of
 * capital beyond them (financials-resolvers, the platform's own rule). The check row is assets less
 * liabilities and equity, and Checks reads it.
 *
 * Keys keep the names later layers read (`bs|__all__||Cash`, `...||Total Fixed Assets`,
 * `...||Debt (long-term)` for the debt total, `...||TOTAL ASSETS`, `...||TOTAL LIABILITIES + EQUITY`).
 *
 * No em dashes in this file.
 */
import { computeFinancialsSnapshot, type FinancialsResolverState } from '../../financials-resolvers';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { orderedFacilities } from './financingPlan';

type Snap = ReturnType<typeof computeFinancialsSnapshot>;

/** Where a row's formula comes from. */
export type BsSrc =
  | { kind: 'link'; key: string }                    // one cell, as it stands
  | { kind: 'neg'; key: string }                     // one cell, negated
  | { kind: 'prev'; key: string }                    // a row's value the year before (the opening column before year 1)
  | { kind: 'diff'; a: string; b: string }
  | { kind: 'transfer' }                             // the statutory reserve transfer
  | { kind: 'roc' }                                  // the capital returned (negative)
  | { kind: 'div' };                                 // the dividends declared (negative)

export interface BsRow {
  key: string;
  label: string;
  kind: 'section' | 'head' | 'row' | 'gap';
  values?: number[];
  src?: BsSrc;
  sum?: string[];
  style?: 'total' | 'subtotal';
  indent?: number;
  /** Total column: 'last' (a balance, the default), 'first' (an opening), 'sum' (a flow), 'maxabs' (the check). */
  total?: 'last' | 'first' | 'sum' | 'maxabs';
}

export const BS = (label: string): string => `bs|__all__||${label}`;
export const E1 = (l: string): string => `sch|E1||${l}`;
export const SR = (l: string): string => `sch|SR||${l}`;
export const E2 = (l: string): string => `sch|E2||${l}`;
export const ESC_CLOSE = 'esc||B. Escrow Balance Roll-Forward|Closing Balance';
export const BS_CHECK = BS('Balance check');

export function bsPlan(state: FinancialsResolverState, snap: Snap = computeFinancialsSnapshot(state)): BsRow[] {
  const N = snap.axisLength;
  const p = state.project;
  const labels = getFinancialLabels(p.financialTerminology ?? defaultTerminologyForCountry(p.country));
  const sl = (a: readonly number[] | undefined): number[] => Array.from({ length: N }, (_, t) => Number(a?.[t] ?? 0));
  const neg = (a: readonly number[]): number[] => a.map((v) => -(v ?? 0));
  const add = (...xs: Array<readonly number[]>): number[] => Array.from({ length: N }, (_, t) => xs.reduce((s, x) => s + (x[t] ?? 0), 0));
  const prevOf = (a: readonly number[], open: number): number[] => a.map((_, t) => (t === 0 ? open : a[t - 1] ?? 0));
  const bs = snap.bs;
  const rows: BsRow[] = [];
  const row = (key: string, label: string, values: number[], src: BsSrc | null, o: Partial<BsRow> = {}): void => {
    rows.push({ key, label, kind: 'row', values, ...(src ? { src } : {}), ...o });
  };
  const head = (key: string, label: string): void => { rows.push({ key, label, kind: 'head' }); };

  // ── Assets ───────────────────────────────────────────────────────────────
  rows.push({ key: 'bs|__all__||#section', label: 'Balance Sheet: Project', kind: 'section' });
  head(BS('#assets'), 'Assets');
  const fa = add(bs.nbvPerPeriod, bs.totalFixedAssetsPerPeriod.map((v, t) => v - (bs.nbvPerPeriod[t] ?? 0) - (bs.landPerPeriod[t] ?? 0)));
  row(BS('Land'), 'Land', sl(bs.landPerPeriod), { kind: 'link', key: 'schv:__project__:landClose' }, { indent: 1 });
  row(BS('Fixed Assets'), 'Fixed assets (net book value, incl. capitalised interest)', fa, { kind: 'link', key: 'schv:__project__:close' }, { indent: 1 });
  row(BS('Total Fixed Assets'), 'Total fixed assets', sl(bs.totalFixedAssetsPerPeriod), null, { style: 'subtotal', sum: [BS('Land'), BS('Fixed Assets')] });
  const ca: string[] = [];
  const caRow = (key: string, label: string, v: number[], src: BsSrc): void => { row(key, label, v, src, { indent: 1 }); ca.push(key); };
  caRow(BS('Cash'), 'Cash', sl(bs.cashPerPeriod), { kind: 'link', key: 'cf|direct||Closing cash' });
  caRow(BS('Operating Receivables'), 'Operating receivables (hotel and lease)', sl(bs.arPerPeriod), { kind: 'link', key: 'rvc:__project__:opar' });
  caRow(BS('Sales Receivables'), 'Sales receivables', sl(bs.residentialReceivablesPerPeriod), { kind: 'link', key: 'rvc:__project__:sar' });
  caRow(BS('Inventory'), 'Inventory (residential work in progress)', sl(bs.inventoryPerPeriod), { kind: 'link', key: 'schv:A3:close' });
  if (snap.escrow.byAsset.size > 0) caRow(BS('Restricted Cash (Escrow)'), 'Restricted cash (escrow)', sl(bs.escrowRestrictedCashPerPeriod), { kind: 'link', key: ESC_CLOSE });
  row(BS('Total Current Assets'), 'Total current assets', sl(bs.totalCurrentAssetsPerPeriod), null, { style: 'subtotal', sum: ca });
  row(BS('TOTAL ASSETS'), 'Total assets', sl(bs.totalAssetsPerPeriod), null, { style: 'total', sum: [BS('Total Fixed Assets'), BS('Total Current Assets')] });

  // ── Liabilities ──────────────────────────────────────────────────────────
  head(BS('#liabilities'), 'Liabilities');
  row(BS('Accounts Payable'), 'Accounts payable', sl(bs.apPerPeriod), { kind: 'link', key: 'ox|ap|close' }, { indent: 1 });
  row(BS('Unearned Revenue'), 'Unearned revenue (off-plan advances)', sl(bs.unearnedRevenuePerPeriod), { kind: 'link', key: 'rvc:__project__:ur' }, { indent: 1 });
  row(BS('Tax payable'), `${labels.tax} payable`, sl(bs.taxPayablePerPeriod), { kind: 'link', key: 'fl:taxPay' }, { indent: 1 });
  row(BS('Total Current Liabilities'), 'Total current liabilities', sl(bs.totalCurrentLiabilitiesPerPeriod), null, { style: 'subtotal', sum: [BS('Accounts Payable'), BS('Unearned Revenue'), BS('Tax payable')] });
  const exitFrom = snap.disposal.booked ? snap.disposal.exitIdx : N;
  const debtKeys: string[] = [];
  for (const t of orderedFacilities(state.financingTranches ?? [])) {
    const f = snap.financing.facilities.get(t.id);
    const v = sl(f?.outstanding).map((x, i) => (i >= exitFrom ? 0 : x));
    const k = BS(`debt:${t.id}`);
    row(k, t.name, v, { kind: 'link', key: `fl:tr:${t.id}:bs` }, { indent: 1 });
    debtKeys.push(k);
  }
  row(BS('Debt (long-term)'), 'Total debt', sl(bs.debtOutstandingPerPeriod), null, { style: 'subtotal', sum: debtKeys });
  row(BS('TOTAL LIABILITIES'), 'Total liabilities', sl(bs.totalLiabilitiesPerPeriod), null, { style: 'total', sum: [BS('Total Current Liabilities'), BS('Debt (long-term)')] });

  // ── Equity ───────────────────────────────────────────────────────────────
  head(BS('#equity'), 'Shareholders\' equity');
  row(BS('Share Capital'), 'Share capital', sl(bs.shareCapitalPerPeriod), { kind: 'link', key: E1('Closing') }, { indent: 1 });
  row(BS('Statutory Reserve'), 'Statutory reserve', sl(bs.statutoryReservePerPeriod), { kind: 'link', key: SR('Closing') }, { indent: 1 });
  row(BS('Retained Earnings'), 'Retained earnings', sl(bs.retainedEarningsPerPeriod), { kind: 'link', key: E2('Closing') }, { indent: 1 });
  row(BS('Total Equity'), 'Total equity', sl(bs.totalEquityPerPeriod), null, { style: 'subtotal', sum: [BS('Share Capital'), BS('Statutory Reserve'), BS('Retained Earnings')] });
  row(BS('TOTAL LIABILITIES + EQUITY'), 'Total liabilities and equity', sl(bs.totalLiabilitiesAndEquityPerPeriod), null, { style: 'total', sum: [BS('TOTAL LIABILITIES'), BS('Total Equity')] });

  // ── Share capital ────────────────────────────────────────────────────────
  const shareOpen0 = p.shareCapital != null && p.shareCapital > 0 ? p.shareCapital : 0;
  const share = sl(bs.shareCapitalPerPeriod);
  const roc = sl(bs.returnOfCapitalPerPeriod);
  rows.push({ key: 'bs|gap|e1', label: '', kind: 'gap' });
  rows.push({ key: 'sch|E1||#section', label: 'Share capital', kind: 'section' });
  row(E1('Opening'), 'Opening', prevOf(share, shareOpen0), { kind: 'prev', key: E1('Closing') }, { total: 'first' });
  row(E1('Cash equity'), 'Equity drawn in cash', sl(snap.directCF.equityDrawdownPerPeriod), { kind: 'link', key: 'fl:eqCash' }, { indent: 1, total: 'sum' });
  row(E1('In-kind equity'), 'Land contributed in kind', sl(snap.financing.equity.inKindPerPeriod), { kind: 'link', key: 'fl:inKind' }, { indent: 1, total: 'sum' });
  row(E1('Return of capital'), 'Return of capital (distributions beyond the retained earnings available)', neg(roc), { kind: 'roc' }, { indent: 1, total: 'sum' });
  row(E1('Closing'), 'Closing', share, null, { style: 'subtotal', sum: [E1('Opening'), E1('Cash equity'), E1('In-kind equity'), E1('Return of capital')] });

  // ── Statutory reserve ────────────────────────────────────────────────────
  const res = sl(bs.statutoryReservePerPeriod);
  rows.push({ key: 'bs|gap|sr', label: '', kind: 'gap' });
  rows.push({ key: 'sch|SR||#section', label: 'Statutory reserve', kind: 'section' });
  row(SR('Opening'), 'Opening', prevOf(res, 0), { kind: 'prev', key: SR('Closing') }, { total: 'first' });
  row(SR('Transfer'), 'Transfer from profit after tax', sl(bs.statutoryReserveTransferPerPeriod), { kind: 'transfer' }, { indent: 1, total: 'sum' });
  row(SR('Closing'), 'Closing', res, null, { style: 'subtotal', sum: [SR('Opening'), SR('Transfer')] });

  // ── Retained earnings ────────────────────────────────────────────────────
  const re = sl(bs.retainedEarningsPerPeriod);
  rows.push({ key: 'bs|gap|e2', label: '', kind: 'gap' });
  rows.push({ key: 'sch|E2||#section', label: 'Retained earnings', kind: 'section' });
  row(E2('Opening'), 'Opening', prevOf(re, 0), { kind: 'prev', key: E2('Closing') }, { total: 'first' });
  row(E2('PAT'), labels.pat, sl(snap.pl.patPerPeriod), { kind: 'link', key: `pl|__all__||${labels.pat}` }, { indent: 1, total: 'sum' });
  row(E2('Transfer'), 'Transfer to the statutory reserve', neg(sl(bs.statutoryReserveTransferPerPeriod)), { kind: 'neg', key: SR('Transfer') }, { indent: 1, total: 'sum' });
  row(E2('Dividends'), 'Dividends declared', neg(sl(bs.dividendsDeclaredPerPeriod)), { kind: 'div' }, { indent: 1, total: 'sum' });
  row(E2('Closing'), 'Closing', re, null, { style: 'subtotal', sum: [E2('Opening'), E2('PAT'), E2('Transfer'), E2('Dividends')] });
  // THE BALANCE CHECK, ONE ROW PER YEAR AT THE FOOT (2026-11-12, founder): assets less liabilities and equity, zero every year.
  rows.push({ key: 'bs|gap|chk', label: '', kind: 'gap' });
  row(BS_CHECK, 'Balance check (assets less liabilities and equity)', sl(bs.bsDifferencePerPeriod), { kind: 'diff', a: BS('TOTAL ASSETS'), b: BS('TOTAL LIABILITIES + EQUITY') }, { total: 'maxabs' });
  return rows;
}
