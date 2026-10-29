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
import { computeFinancialsSnapshot, type FinancialsResolverState } from '../../financials-resolvers';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { isRevenueSubUnit } from '@/src/core/calculations';
import { planRevenueLines, groupRevenueLines, type RevenueLine } from '../../revenueLines';
import { revenueLineName } from '../../reports/revenueOutputReports';
import { resolveFundTerms } from '../../fundTerms';

type Snap = ReturnType<typeof computeFinancialsSnapshot>;

/** Where a row's formula comes from. */
export type CfSrc =
  | { kind: 'link'; key: string }                                  // one cell, as it stands
  | { kind: 'add'; keys: string[] }                                // cells added, as they stand
  | { kind: 'mkt'; phaseId: string | null }                        // Capex: selling and marketing expensed, negated
  | { kind: 'cost'; keys: string[] }                               // costs, negated once
  | { kind: 'paid'; pairs: Array<{ opex: string; close: string }> } // opex less the rise in its payable, negated
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
  const hasEscrow = snap.escrow.byAsset.size > 0;
  const taxLag = (p.tax?.paymentDays ?? 0) > 0;
  const TAX = (p.tax?.basis ?? 'zakat') !== 'cit' ? 'Zakat' : 'Tax';
  const dcf = snap.directCF;
  const rows: CfRow[] = [];
  const multiPhase = state.phases.length > 1;
  const capexKeyOf = (l: RevenueLine): string => `cx2:${ids(l)[0]}`;

  /** Operations and investing for a view: the project (`direct`) or one phase. */
  const opsAndInv = (view: string, phaseId: string | null): { cfo: string; cfi: string; cfoV: number[]; cfiV: number[] } => {
    const K = (name: string): string => `cf|${view}||${name}`;
    const vl = lines.filter((l) => !phaseId || l.phaseId === phaseId);
    rows.push({ key: K('#ops'), label: 'Operating activities', kind: 'head' });
    // Cash collected by line, in the P&L's groups.
    const colGroups: string[] = []; const colVals: number[][] = [];
    for (const g of groupRevenueLines(vl.filter(earns))) {
      const head: CfRow = { key: K(`${g.section} cash collected`), label: `${g.section} cash collected`, kind: 'row', style: 'subtotal', sum: [] };
      rows.push(head);
      const vs: number[][] = [];
      for (const l of g.lines) {
        const v = perAsset(l, (x) => x.revenueReceivedPerPeriod);
        vs.push(v);
        head.sum!.push(K(`rcv:${l.key}`));
        rows.push({ key: K(`rcv:${l.key}`), label: revenueLineName(l), kind: 'row', indent: 1, values: v, src: { kind: 'link', key: `rvc:${l.key}:collected` } });
      }
      head.values = add(vs); colGroups.push(head.key); colVals.push(head.values);
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
    // Opex paid by line, the same groups.
    const opGroups: string[] = []; const opVals: number[][] = [];
    for (const g of groupRevenueLines(vl.filter((l) => l.form !== 'sell'))) {
      const head: CfRow = { key: K(`${g.section} opex paid`), label: `${g.section} opex paid`, kind: 'row', style: 'subtotal', sum: [] };
      rows.push(head);
      const vs: number[][] = [];
      for (const l of g.lines) {
        const v = neg(perAsset(l, (x) => x.opexPaidPerPeriod));
        vs.push(v);
        head.sum!.push(K(`paid:${l.key}`));
        rows.push({ key: K(`paid:${l.key}`), label: revenueLineName(l), kind: 'row', indent: 1, values: v, src: { kind: 'paid', pairs: ids(l).map((id) => ({ opex: `oxo:${id}:total`, close: `oxo:ap:${id}:close` })) } });
      }
      head.values = add(vs); opGroups.push(head.key); opVals.push(head.values);
    }
    if (!phaseId) {
      const v = sl(dcf.hqOpexPaidPerPeriod);
      rows.push({ key: K('HQ overheads paid'), label: 'HQ overheads paid', kind: 'row', values: v, src: { kind: 'paid', pairs: [{ opex: 'oxo:hq:total', close: 'oxo:ap:hq:close' }] } });
      opGroups.push(K('HQ overheads paid')); opVals.push(v);
    }
    {
      const v = phaseId ? neg(sl(snap.pl.sellingExpenseByPhase?.[phaseId])) : sl(dcf.sellingExpensePaidPerPeriod);
      rows.push({ key: K('Selling and marketing paid'), label: 'Selling and marketing paid', kind: 'row', values: v, src: { kind: 'mkt', phaseId } });
      opGroups.push(K('Selling and marketing paid')); opVals.push(v);
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

    // Investing: capex by line (Capex Table 2, the land in kind inside it), and the disposal proceeds.
    rows.push({ key: K('#inv'), label: 'Investing activities', kind: 'head' });
    const cxGroups: string[] = []; const cxVals: number[][] = [];
    for (const g of groupRevenueLines(vl.filter((l) => ids(l).some((id) => snap.perAssetCF.has(id))))) {
      const head: CfRow = { key: K(`${g.section} capex`), label: `${g.section} capex`, kind: 'row', style: 'subtotal', sum: [] };
      rows.push(head);
      const vs: number[][] = [];
      for (const l of g.lines) {
        const v = neg(perAsset(l, (x) => x.capexPerPeriod));
        vs.push(v);
        head.sum!.push(K(`capex:${l.key}`));
        rows.push({ key: K(`capex:${l.key}`), label: revenueLineName(l), kind: 'row', indent: 1, values: v, src: { kind: 'cost', keys: [capexKeyOf(l)] } });
      }
      head.values = add(vs); cxGroups.push(head.key); cxVals.push(head.values);
    }
    const totCx = add(cxVals);
    rows.push({ key: K('Total capex'), label: 'Total capex (land in kind included, matched in financing)', kind: 'row', style: 'subtotal', values: totCx, sum: cxGroups });
    const proceeds = sl(dcf.proceedsFromDisposalPerPeriod);
    let procV = proceeds;
    let procKey = 'fl:proceeds';
    if (phaseId && multiPhase) {
      const pl = snap.perAssetPL;
      const noiOf = (pid: string | null): number[] => {
        const v = new Array<number>(N).fill(0);
        for (const pa of pl.values()) {
          if (pa.strategy !== 'Operate' && pa.strategy !== 'Lease') continue;
          if (pid && state.assets.find((a) => a.id === pa.assetId)?.phaseId !== pid) continue;
          for (let t = 0; t < N; t++) v[t] += (pa.revenuePerPeriod[t] ?? 0) - (pa.opexPerPeriod[t] ?? 0);
        }
        return v;
      };
      const M = snap.disposal.metricIdx;
      const all = noiOf(null)[M] ?? 0;
      const share = all !== 0 ? (noiOf(phaseId)[M] ?? 0) / all : 0;
      procV = proceeds.map((x) => x * share);
      procKey = `fnc:ph:${phaseId}:proceeds`;
    }
    rows.push({ key: K('Proceeds from Disposal of Operating Assets'), label: 'Disposal proceeds', kind: 'row', values: procV, src: { kind: 'link', key: procKey } });
    const cfiV = add([totCx, procV]);
    rows.push({ key: K('Cash Flow from Investment'), label: 'Cash flow from investing', kind: 'row', style: 'total', values: cfiV, sum: [K('Total capex'), K('Proceeds from Disposal of Operating Assets')] });
    return { cfo: K('Cash Flow from Operations'), cfi: K('Cash Flow from Investment'), cfoV, cfiV };
  };

  // ── The project, direct method ───────────────────────────────────────────
  rows.push({ key: 'cf|direct||#section', label: 'Cash flow, direct method: Project', kind: 'section' });
  const proj = opsAndInv('direct', null);
  const D = (name: string): string => `cf|direct||${name}`;
  rows.push({ key: D('#fin'), label: 'Financing activities', kind: 'head' });
  const finRows: Array<[string, string, number[], string]> = [
    ['Equity drawn in cash', 'Equity drawn in cash', sl(dcf.equityDrawdownPerPeriod), 'fl:eqCash'],
    ['Land contributed in kind', 'Land contributed in kind (non-cash equity, in capex above)', sl(snap.financing.equity.inKindPerPeriod), 'fl:inKind'],
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

  // ── The indirect method: operating cash only, and its check ──────────────
  const ic = snap.indirectCF;
  const I = (name: string): string => `cf|indirect||${name}`;
  rows.push({ key: 'cf|gap|ind', label: '', kind: 'gap' });
  rows.push({ key: I('#section'), label: 'Cash flow from operations, indirect method: Project', kind: 'section' });
  const indRows: Array<[string, string, number[], CfSrc]> = [
    ['pat', labels.pat, sl(ic.patPerPeriod), { kind: 'link', key: `pl|__all__||${labels.pat}` }],
    ['dep', 'Depreciation (non-cash)', sl(ic.daPerPeriod), { kind: 'cost', keys: ['pl|__all__||Depreciation & Amortization'] }],
    ['int', 'Interest expensed (paid in financing)', sl(ic.interestExpensePerPeriod), { kind: 'cost', keys: ['pl|__all__||Interest & financing cost'] }],
    ['cos', 'Cost of sales (its capex is in investing)', sl(ic.costOfSalesAddBackPerPeriod), { kind: 'cost', keys: ['pl|__all__||Residential cost of sales'] }],
    ['gain', 'Gain on disposal (its proceeds are in investing)', sl(ic.gainOnDisposalPerPeriod), { kind: 'cost', keys: ['pl|__all__||Gain on Disposal of Operating Assets'] }],
    ['ar', 'Change in receivables', sl(ic.changeInArPerPeriod), { kind: 'rise', key: 'rvc:__project__:ar', sign: -1 }],
    ['ap', 'Change in payables', sl(ic.changeInApPerPeriod), { kind: 'rise', key: 'ox|ap|close', sign: 1 }],
    ['ur', 'Change in unearned revenue', sl(ic.changeInUnearnedPerPeriod), { kind: 'rise', key: 'rvc:__project__:ur', sign: 1 }],
  ];
  if (taxLag) indRows.push(['taxpay', `Change in ${TAX.toLowerCase()} payable`, sl(ic.changeInTaxPayablePerPeriod), { kind: 'rise', key: 'fl:taxPay', sign: 1 }]);
  if (hasEscrow) indRows.push(['esc', 'Change in the escrow balance', sl(ic.changeInEscrowPerPeriod), { kind: 'rise', key: 'esc||B. Escrow Balance Roll-Forward|Closing Balance', sign: -1 }]);
  for (const [k, label, v, src] of indRows) rows.push({ key: I(k), label, kind: 'row', indent: k === 'pat' ? 0 : 1, values: v, src });
  const indCfo = add(indRows.map((x) => x[2]));
  rows.push({ key: I('Cash Flow from Operations'), label: 'Cash flow from operations (indirect)', kind: 'row', style: 'total', values: indCfo, sum: indRows.map((x) => I(x[0])) });
  rows.push({ key: I('check'), label: 'Check: direct less indirect (should be zero)', kind: 'row', values: proj.cfoV.map((v, t) => v - indCfo[t]), src: { kind: 'diff', a: D('Cash Flow from Operations'), b: I('Cash Flow from Operations') } });

  // ── Each phase: operations and investing ─────────────────────────────────
  const phaseNets: Array<{ key: string; v: number[]; name: string }> = [];
  if (multiPhase) for (const ph of state.phases) {
    if (!lines.some((l) => l.phaseId === ph.id)) continue;
    const V = `ph:${ph.id}`;
    rows.push({ key: `cf|gap|${V}`, label: '', kind: 'gap' });
    rows.push({ key: `cf|${V}||#section`, label: `Cash flow: ${ph.name} (operations and investing)`, kind: 'section' });
    const r = opsAndInv(V, ph.id);
    const k = `cf|${V}||Net cash flow`;
    const v = add([r.cfoV, r.cfiV]);
    rows.push({ key: k, label: `Net cash flow, ${ph.name}`, kind: 'row', style: 'subtotal', values: v, sum: [r.cfo, r.cfi] });
    phaseNets.push({ key: k, v, name: ph.name });
  }

  // ── The phases to the project ────────────────────────────────────────────
  if (phaseNets.length) {
    const R = (name: string): string => `cf|recon||${name}`;
    rows.push({ key: 'cf|gap|recon', label: '', kind: 'gap' });
    rows.push({ key: R('#section'), label: 'The phases to the project net cash flow', kind: 'section' });
    const keys: string[] = []; const vals: number[][] = [];
    const link = (name: string, label: string, v: number[], key: string): void => { rows.push({ key: R(name), label, kind: 'row', values: v, src: { kind: 'link', key } }); keys.push(R(name)); vals.push(v); };
    for (const pn of phaseNets) link(`net:${pn.name}`, `${pn.name} net cash flow`, pn.v, pn.key);
    const get = (k: string): number[] => rows.find((x) => x.key === k)?.values ?? new Array<number>(N).fill(0);
    link('hq', 'Project level: HQ overheads paid', get(D('HQ overheads paid')), D('HQ overheads paid'));
    if (fundOn) link('fees', 'Project level: fund fees paid', get(D('Fund fees paid')), D('Fund fees paid'));
    link('tax', `Project level: ${TAX.toLowerCase()} paid`, get(D('Tax paid')), D('Tax paid'));
    link('cff', 'Project level: cash flow from financing', cffV, D('Cash Flow from Financing'));
    const sum = add(vals);
    rows.push({ key: R('sum'), label: 'Project net cash flow, from the phases', kind: 'row', style: 'subtotal', values: sum, sum: keys });
    rows.push({ key: R('proj'), label: 'Project net cash flow, per the statement', kind: 'row', values: net, src: { kind: 'link', key: D('Net Cash Flow') } });
    rows.push({ key: R('diff'), label: 'Difference (should be zero)', kind: 'row', values: sum.map((v, t) => v - net[t]), src: { kind: 'diff', a: R('sum'), b: R('proj') } });
  }
  return rows;
}
