/**
 * cfPlan.ts (2026-10-29), THE LIVE CASH FLOW, ROW BY ROW.
 *
 * One list of the rows the live Cash Flow carries, with the platform's value for each: the builder
 * (`addCashFlowLive`) prints them, the statements layer (stage 5) writes each row's formula from its
 * `src` or `sum`, so the two cannot disagree about what a row is.
 *
 * A STATEMENT THAT ONLY LINKS (2026-10-29, founder): operating cash (cash collected by line from
 * Revenue, escrow held and released, opex paid by line from Opex, HQ, selling and marketing, the
 * fund fees, zakat paid), investing cash (capex by line from Capex Table 2, the land in kind inside
 * it and matched in financing; the disposal proceeds from Financing), financing cash (one link to
 * Financing each), net cash flow and closing cash. The indirect method shows operating cash only,
 * with a check against the direct figure. Each phase runs operations and investing; the
 * reconciliation adds the phases and the project-level items to the project net cash flow. Groups
 * match the P&L (Residential, Hospitality, Standalone Commercial, Retail Ground Floor) and every line
 * names its phase. Keys keep the names later layers read (`cf|direct||Cash Flow from Operations`,
 * `...||Cash Flow from Investment`, `...||Proceeds from Disposal of Operating Assets`, `...||Net
 * Cash Flow`, `...||Closing cash`, `cf|indirect||Cash Flow from Operations`).
 *
 * No em dashes in this file.
 */
import { escrowInForce, featureUsed } from '../exportScope';
import { computeFinancialsSnapshot, type FinancialsResolverState } from '../../financials-resolvers';
import { phaseProceedsPerPeriod } from '../../reports/phaseProceeds';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { isRevenueSubUnit, isLandValueLine } from '@/src/core/calculations';
import { planRevenueLines, groupRevenueLines, type RevenueLine } from '../../revenueLines';
import { revenueLineName } from '../../reports/revenueOutputReports';
import { resolveFundTerms } from '../../fundTerms';

type Snap = ReturnType<typeof computeFinancialsSnapshot>;

/** Where a row's formula comes from. */
export type CfSrc =
  | { kind: 'link'; key: string }                                  // one cell, as it stands
  | { kind: 'add'; keys: string[] }                                // cells added, as they stand
  | { kind: 'mkt'; phaseId: string | null }                        // Capex: selling and marketing expensed, negated
  | { kind: 'comm'; phaseId: string | null }                       // Revenue 5.2: the sales commission paid, negated
  | { kind: 'cost'; keys: string[] }                               // costs, negated once
  | { kind: 'cash'; key: string; less: string[] }                  // a cost less its non-cash part (the rows that exist), negated
  | { kind: 'paid'; keys: string[] }                               // Opex: the cash paid rows that exist, negated once
  | { kind: 'rise'; key: string; sign: 1 | -1 }                    // the change in a balance (x sign)
  | { kind: 'prev'; key: string }                                  // the row's value the year before
  | { kind: 'diff'; a: string; b: string };

export interface CfRow {
  key: string;
  label: string;
  kind: 'section' | 'head' | 'row' | 'gap';
  values?: number[];
  src?: CfSrc;
  sum?: string[];
  style?: 'total' | 'subtotal';
  indent?: number;
  /** Total column: 'sum' (default), 'first' (an opening balance) or 'last' (a closing one). */
  total?: 'sum' | 'first' | 'last';
}

export function cfPlan(state: FinancialsResolverState, snap: Snap = computeFinancialsSnapshot(state)): CfRow[] {
  const N = snap.axisLength;
  const p = state.project;
  const labels = getFinancialLabels(p.financialTerminology ?? defaultTerminologyForCountry(p.country));
  const sl = (a: readonly number[] | undefined): number[] => Array.from({ length: N }, (_, t) => Number(a?.[t] ?? 0));
  const neg = (a: readonly number[]): number[] => a.map((v) => -(v ?? 0));
  const add = (xs: Array<readonly number[]>): number[] => Array.from({ length: N }, (_, t) => xs.reduce((s, x) => s + (x[t] ?? 0), 0));
  const visible = state.assets.filter((a) => a.visible !== false);
  const visIds = new Set(visible.map((a) => a.id));
  const lines = planRevenueLines(state.assets, state.subUnits, state.phases, p);
  const earns = (l: RevenueLine): boolean => l.members.some((m) => visIds.has(m.id) && state.subUnits.some((u) => u.assetId === m.id && isRevenueSubUnit(u)));
  const ids = (l: RevenueLine): string[] => l.members.filter((m) => visIds.has(m.id)).map((m) => m.id);
  const perAsset = (l: RevenueLine, pick: (x: { revenueReceivedPerPeriod: number[]; opexPaidPerPeriod: number[]; capexPerPeriod: number[] }) => number[]): number[] =>
    add(ids(l).map((id) => { const c = snap.perAssetCF.get(id); return c ? sl(pick(c)) : sl(undefined); }));
  const escOf = (l: RevenueLine, pick: 'heldPerPeriod' | 'releasePerPeriod'): number[] =>
    add(ids(l).map((id) => { const e = snap.escrow.byAsset.get(id) as { result?: Record<string, number[]> } & Record<string, unknown> | undefined; return sl(e?.result?.[pick] ?? (e?.[pick] as number[] | undefined)); }));
  const fundOn = resolveFundTerms(p).enabled;
  // Escrow off (0%, no line overriding it) builds no escrow row (2026-11-15).
  const hasEscrow = snap.escrow.byAsset.size > 0 && escrowInForce(state as never);
  const TAX = (p.tax?.basis ?? 'zakat') !== 'cit' ? 'Zakat' : 'Tax';
  const dcf = snap.directCF;
  const rows: CfRow[] = [];
  const multiPhase = state.phases.length > 1;
  const capexKeyOf = (l: RevenueLine): string => `cx2:${ids(l)[0]}`;
  // The land contributed in kind inside a line's capex: its in-kind land value rows on Capex Table 1.
  const inKindLines = (state.costLines ?? []).filter((c) => isLandValueLine(c) && c.method === 'percent_of_inkind_land');
  const inKindKeysOf = (l: RevenueLine): string[] => ids(l).slice(0, 1).flatMap((h) => inKindLines.map((c) => `cx1:${h}:${c.id}`));

  /** Operations and investing for a view: the project (`direct`) or one phase. */
  const opsAndInv = (view: string, phaseId: string | null): { cfo: string; cfi: string; cfoV: number[]; cfiV: number[] } => {
    const K = (name: string): string => `cf|${view}||${name}`;
    const vl = lines.filter((l) => !phaseId || l.phaseId === phaseId);
    rows.push({ key: K('#ops'), label: 'Operating activities', kind: 'head' });
    // Cash collected: one row per line, no category rows (2026-11-15, founder).
    const colGroups: string[] = []; const colVals: number[][] = [];
    for (const l of groupRevenueLines(vl.filter(earns)).flatMap((g) => g.lines)) {
      const v = perAsset(l, (x) => x.revenueReceivedPerPeriod);
      rows.push({ key: K(`rcv:${l.key}`), label: `Cash collected: ${revenueLineName(l)}`, kind: 'row', indent: 1, values: v, src: { kind: 'link', key: `rvc:${l.key}:collected` } });
      colGroups.push(K(`rcv:${l.key}`)); colVals.push(v);
    }
    const parts: string[] = []; const partV: number[][] = [];
    const totCol = add(colVals);
    rows.push({ key: K('Total cash collected'), label: 'Total cash collected', kind: 'row', style: 'subtotal', values: totCol, sum: colGroups });
    parts.push(K('Total cash collected')); partV.push(totCol);
    if (hasEscrow) {
      const el = vl.filter((l) => l.form === 'sell' && earns(l) && ids(l).some((id) => snap.escrow.byAsset.has(id)));
      const held = phaseId ? neg(add(el.map((l) => escOf(l, 'heldPerPeriod')))) : sl(dcf.escrowHeldPerPeriod);
      const rel = phaseId ? add(el.map((l) => escOf(l, 'releasePerPeriod'))) : sl(dcf.escrowReleasePerPeriod);
      rows.push({ key: K('Escrow: cash held'), label: 'Escrow: cash held', kind: 'row', values: held,
        src: phaseId ? { kind: 'cost', keys: el.map((l) => `escc:${l.key}:held`) } : { kind: 'link', key: 'esc||C. Cash Flow Impact (project totals)|Less: cash locked in escrow' } });
      rows.push({ key: K('Escrow: cash released'), label: 'Escrow: cash released', kind: 'row', values: rel,
        src: phaseId ? { kind: 'add', keys: el.map((l) => `escc:${l.key}:released`) } : { kind: 'link', key: 'esc||C. Cash Flow Impact (project totals)|Add: cash released from escrow' } });
      parts.push(K('Escrow: cash held'), K('Escrow: cash released')); partV.push(held, rel);
    }
    // Opex paid: one row per line.
    const opGroups: string[] = []; const opVals: number[][] = [];
    for (const l of groupRevenueLines(vl.filter((l) => l.form !== 'sell')).flatMap((g) => g.lines)) {
      const v = neg(perAsset(l, (x) => x.opexPaidPerPeriod));
      rows.push({ key: K(`paid:${l.key}`), label: `Opex paid: ${revenueLineName(l)}`, kind: 'row', indent: 1, values: v, src: { kind: 'paid', keys: ids(l).map((id) => `oxo:paid:${id}`) } });
      opGroups.push(K(`paid:${l.key}`)); opVals.push(v);
    }
    // HQ off: no HQ row (2026-11-15).
    if (!phaseId && featureUsed(state as never, 'hq')) {
      const v = sl(dcf.hqOpexPaidPerPeriod);
      rows.push({ key: K('HQ overheads paid'), label: 'HQ overheads paid', kind: 'row', values: v, src: { kind: 'paid', keys: ['oxo:paid:hq'] } });
      opGroups.push(K('HQ overheads paid')); opVals.push(v);
    }
    {
      const v = phaseId ? neg(sl(snap.pl.sellingExpenseByPhase?.[phaseId])) : sl(dcf.sellingExpensePaidPerPeriod);
      rows.push({ key: K('Selling and marketing paid'), label: 'Selling and marketing paid', kind: 'row', values: v, src: { kind: 'mkt', phaseId } });
      opGroups.push(K('Selling and marketing paid')); opVals.push(v);
    }
    // THE SALES COMMISSION IS PAID IN OPERATIONS (2026-11-19, founder A2): Revenue 5.2, out of the capex below.
    {
      const v = phaseId
        ? neg(add(state.assets.filter((a) => a.visible !== false && a.phaseId === phaseId).map((a) => sl(snap.perAssetCF.get(a.id)?.salesCommissionPerPeriod))))
        : sl(dcf.salesCommissionPaidPerPeriod);
      if (v.some((x) => Math.abs(x) > 0.005)) {
        rows.push({ key: K('Sales commission paid'), label: 'Sales commission paid', kind: 'row', values: v, src: { kind: 'comm', phaseId } });
        opGroups.push(K('Sales commission paid')); opVals.push(v);
      }
    }
    const totPaid = add(opVals);
    rows.push({ key: K('Total opex paid'), label: 'Total opex paid', kind: 'row', style: 'subtotal', values: totPaid, sum: opGroups });
    parts.push(K('Total opex paid')); partV.push(totPaid);
    if (!phaseId) {
      if (fundOn) {
        const v = sl(dcf.fundFeesPaidPerPeriod);
        rows.push({ key: K('Fund fees paid'), label: 'Fund fees paid', kind: 'row', values: v, src: { kind: 'cost', keys: ['fl:feeTot'] } });
        parts.push(K('Fund fees paid')); partV.push(v);
      }
      const v = sl(dcf.taxPaidPerPeriod);
      rows.push({ key: K('Tax paid'), label: `${TAX} paid`, kind: 'row', values: v, src: { kind: 'cost', keys: ['fl:taxPaid'] } });
      parts.push(K('Tax paid')); partV.push(v);
    }
    const cfoV = add(partV);
    rows.push({ key: K('Cash Flow from Operations'), label: phaseId ? 'Cash flow from operations' : 'Cash flow from operations', kind: 'row', style: 'total', values: cfoV, sum: parts });

    // Investing: capex paid in cash by line (Capex Table 2 less its land in kind), the land in kind
    // (non-cash, Capex Table 5, matched by the in-kind equity in financing), and the disposal proceeds.
    rows.push({ key: K('#inv'), label: 'Investing activities', kind: 'head' });
    // Capex paid in cash, one row per line; the land contributed in kind is not cash and is not here
    // (2026-11-15, founder; it stays in share capital on the Balance Sheet).
    const cxGroups: string[] = []; const cxVals: number[][] = [];
    for (const l of groupRevenueLines(vl.filter((l) => ids(l).some((id) => snap.perAssetCF.has(id)))).flatMap((g) => g.lines)) {
      const v = neg(add(ids(l).map((id) => { const c = snap.perAssetCF.get(id); return c ? sl(c.capexPerPeriod).map((x, t) => x - (c.landInKindPerPeriod?.[t] ?? 0) - (c.salesCommissionPerPeriod?.[t] ?? 0)) : sl(undefined); })));
      rows.push({ key: K(`capex:${l.key}`), label: `Capex: ${revenueLineName(l)}`, kind: 'row', indent: 1, values: v, src: { kind: 'cash', key: capexKeyOf(l), less: inKindKeysOf(l) } });
      cxGroups.push(K(`capex:${l.key}`)); cxVals.push(v);
    }
    const totCx = add(cxVals);
    rows.push({ key: K('Total capex paid in cash'), label: 'Total capex paid in cash', kind: 'row', style: 'subtotal', values: totCx, sum: cxGroups });
    const proceeds = sl(dcf.proceedsFromDisposalPerPeriod);
    let procV = proceeds;
    let procKey = 'fl:proceeds';
    if (phaseId && multiPhase) {
      procV = phaseProceedsPerPeriod(snap, state, phaseId);
      procKey = `fnc:ph:${phaseId}:proceeds`;
    }
    rows.push({ key: K('Proceeds from Disposal of Operating Assets'), label: 'Disposal proceeds', kind: 'row', values: procV, src: { kind: 'link', key: procKey } });
    const cfiV = add([totCx, procV]);
    rows.push({ key: K('Cash Flow from Investment'), label: 'Cash flow from investing', kind: 'row', style: 'total', values: cfiV, sum: [K('Total capex paid in cash'), K('Proceeds from Disposal of Operating Assets')] });
    return { cfo: K('Cash Flow from Operations'), cfi: K('Cash Flow from Investment'), cfoV, cfiV };
  };

  // ── The project, direct method ───────────────────────────────────────────
  rows.push({ key: 'cf|direct||#section', label: 'Cash flow, direct method: Project', kind: 'section' });
  const proj = opsAndInv('direct', null);
  const D = (name: string): string => `cf|direct||${name}`;
  rows.push({ key: D('#fin'), label: 'Financing activities', kind: 'head' });
  const finRows: Array<[string, string, number[], string]> = [
    ['Equity drawn in cash', 'Equity drawn in cash', sl(dcf.equityDrawdownPerPeriod), 'fl:eqCash'],
    ['Debt drawn', 'Debt drawn (capex and interest)', sl(dcf.debtDrawdownPerPeriod), 'fl:debtCash'],
    ['Debt repaid', 'Debt repaid (scheduled, swept and at the exit)', sl(dcf.debtRepaymentPerPeriod), 'fl:repaidCash'],
    ['Interest paid', 'Interest paid', sl(dcf.interestPaidPerPeriod), 'fl:intPaid'],
    ['Dividends paid', 'Dividends paid', neg(sl(snap.dividends.totalDividendsPerPeriod)), 'fl:div'],
  ];
  for (const [k, label, v, src] of finRows) rows.push({ key: D(k), label, kind: 'row', values: v, src: { kind: 'link', key: src } });
  const cffV = add(finRows.map((x) => x[2]));
  rows.push({ key: D('Cash Flow from Financing'), label: 'Cash flow from financing', kind: 'row', style: 'total', values: cffV, sum: finRows.map((x) => D(x[0])) });
  const net = add([proj.cfoV, proj.cfiV, cffV]);
  rows.push({ key: D('Net Cash Flow'), label: 'Net cash flow', kind: 'row', style: 'subtotal', values: net, sum: [proj.cfo, proj.cfi, D('Cash Flow from Financing')] });
  rows.push({ key: D('Opening cash'), label: 'Opening cash', kind: 'row', values: sl(dcf.openingCashPerPeriod), src: { kind: 'prev', key: D('Closing cash') }, total: 'first' });
  rows.push({ key: D('Closing cash'), label: 'Closing cash', kind: 'row', style: 'total', values: sl(dcf.closingCashPerPeriod), sum: [D('Opening cash'), D('Net Cash Flow')], total: 'last' });

  // (2026-11-15, founder) No indirect method, no phase cash flows and no reconciliation: the direct method only.
  void labels; void phaseProceedsPerPeriod; void multiPhase;
  return rows;
}
