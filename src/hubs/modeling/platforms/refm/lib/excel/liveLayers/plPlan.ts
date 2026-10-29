/**
 * plPlan.ts (2026-10-29), THE LIVE P&L, ROW BY ROW.
 *
 * One list of the rows the live P&L carries, with the platform's value for each: the builder
 * (`addProfitLossLive`) prints them, the statements layer (stage 5) writes each row's formula by
 * its `src` and `sum` description, so the two cannot disagree about what a row is.
 *
 * THE ORDER (2026-10-29, founder): revenue by line under its group, total revenue; cost of sales
 * by line, total cost of sales; gross profit; operating expenses by line under the SAME groups,
 * HQ overheads and selling and marketing, total operating expenses; the fund fees and their total;
 * EBITDA (struck after the fund fees, the platform's EBITDA and the covenants' basis); depreciation;
 * interest; gain on disposal; profit before zakat; zakat; profit after zakat. A phase view runs the
 * same structure to EBITDA with its own selling and marketing, no HQ and no fund fees; the
 * reconciliation foots the phases to the project EBITDA. Every subtotal is a SUM of rows above it.
 *
 * Keys keep the names the later layers already read (`pl|<view>||Total Revenue`, `...||Hospitality
 * Revenue`, `...||Hospitality operating expenses`, `...||Gain on Disposal of Operating Assets`,
 * the EBITDA / profit labels), whatever the row now says.
 *
 * No em dashes in this file.
 */
import { computeFinancialsSnapshot, type FinancialsResolverState } from '../../financials-resolvers';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { isRevenueSubUnit } from '@/src/core/calculations';
import { planRevenueLines, groupRevenueLines, type RevenueLine } from '../../revenueLines';
import { revenueLineName } from '../../reports/revenueOutputReports';
import { FUND_FEE_SPECS, resolveFundTerms } from '../../fundTerms';
import { PHASE_RECON, PHASE_RECON_LINE } from '../../reports/m4Reports';

type Snap = ReturnType<typeof computeFinancialsSnapshot>;
export const PL_ALL = '__all__';

/** Where a row's formula comes from. */
export type PlSrc =
  | { kind: 'rev'; line: string }            // Revenue: the line's revenue recognised
  | { kind: 'cos'; line: string }            // Schedules: the line's cost of sales, negated
  | { kind: 'opex'; assetIds: string[] }     // Opex: the line's total opex, negated
  | { kind: 'hq' }                           // Opex: HQ overheads, negated
  | { kind: 'mkt'; phaseId: string }         // Capex: selling and marketing expensed, negated
  | { kind: 'fee'; index: number }           // Financing: the fee, negated
  | { kind: 'dep' }                          // Schedules: depreciation (already negative)
  | { kind: 'int' }                          // Financing: interest expensed (already negative)
  | { kind: 'gain' }                         // Financing: the gain on disposal
  | { kind: 'tax' }                          // Financing: zakat or tax, negated
  | { kind: 'link'; key: string }            // another P&L row (the reconciliation)
  | { kind: 'diff'; a: string; b: string };  // a less b (the reconciliation)

export interface PlRow {
  key: string;
  label: string;
  kind: 'section' | 'head' | 'row' | 'gap';
  values?: number[];
  src?: PlSrc;
  /** A subtotal: the SUM of these keys. */
  sum?: string[];
  style?: 'total' | 'subtotal';
  indent?: number;
  /** A number in column B (a fee's rate, the zakat rate), from this Inputs key. */
  rateKey?: string;
  rateFmt?: 'pct' | 'money';
  /** A label written as a formula (the zakat rate in words). */
  labelRate?: string;
}

export function plPlan(state: FinancialsResolverState, snap: Snap = computeFinancialsSnapshot(state)): PlRow[] {
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
  const perAsset = (l: RevenueLine, pick: (x: { revenuePerPeriod: number[]; cosPerPeriod: number[]; opexPerPeriod: number[] }) => number[]): number[] =>
    add(l.members.filter((m) => visIds.has(m.id)).map((m) => { const pa = snap.perAssetPL.get(m.id); return pa ? sl(pick(pa)) : sl(undefined); }));
  const fundOn = resolveFundTerms(p).enabled;
  const zakat = (p.tax?.basis ?? 'zakat') !== 'cit';
  const rows: PlRow[] = [];
  const views = [PL_ALL, ...state.phases.map((ph) => ph.id)];

  for (const view of views) {
    const ph = state.phases.find((x) => x.id === view);
    const inView = (l: RevenueLine): boolean => view === PL_ALL || l.phaseId === view;
    const K = (name: string): string => `pl|${view}||${name}`;
    const vl = lines.filter(inView);
    if (view !== PL_ALL && !vl.some(earns) && !(snap.pl.sellingExpenseByPhase?.[view] ?? []).some((v) => v)) continue;
    if (rows.length) rows.push({ key: `pl|gap|${view}`, label: '', kind: 'gap' });
    rows.push({ key: K('#section'), label: view === PL_ALL ? `${labels.incomeStatementTitle}: Project` : `${labels.incomeStatementTitle}: ${ph?.name} (to ${labels.ebitda})`, kind: 'section' });

    // Revenue: each group's lines, the group's total, then the total of the groups.
    const groups = groupRevenueLines(vl.filter(earns));
    const revGroupKeys: string[] = [];
    for (const g of groups) {
      const memberKeys: string[] = [];
      const vals: number[][] = [];
      rows.push({ key: K(`${g.section} Revenue`), label: `${g.section} revenue`, kind: 'row', style: 'subtotal', values: [], sum: memberKeys });
      const head = rows[rows.length - 1];
      for (const l of g.lines) {
        const v = perAsset(l, (x) => x.revenuePerPeriod);
        vals.push(v);
        const k = K(`rev:${l.key}`);
        memberKeys.push(k);
        rows.push({ key: k, label: revenueLineName(l), kind: 'row', indent: 1, values: v, src: { kind: 'rev', line: l.key } });
      }
      head.values = add(vals);
      revGroupKeys.push(head.key);
    }
    const totRev = add(revGroupKeys.map((k) => rows.find((r) => r.key === k)!.values!));
    rows.push({ key: K('Total Revenue'), label: 'Total revenue', kind: 'row', style: 'total', values: totRev, sum: revGroupKeys });

    // Cost of sales, by line.
    const cosLines = vl.filter((l) => l.form === 'sell' && earns(l));
    const cosKeys: string[] = [];
    const cosVals: number[][] = [];
    for (const l of cosLines) {
      const v = neg(perAsset(l, (x) => x.cosPerPeriod));
      cosVals.push(v);
      const k = K(`cos:${l.key}`);
      cosKeys.push(k);
      rows.push({ key: k, label: `Cost of sales: ${revenueLineName(l)}`, kind: 'row', indent: 1, values: v, src: { kind: 'cos', line: l.key } });
    }
    const totCos = add(cosVals);
    rows.push({ key: K('Residential cost of sales'), label: 'Total cost of sales', kind: 'row', style: 'subtotal', values: totCos, sum: cosKeys });
    rows.push({ key: K('Gross profit'), label: 'Gross profit', kind: 'row', style: 'total', values: add([totRev, totCos]), sum: [K('Total Revenue'), K('Residential cost of sales')] });

    // Operating expenses, by line under the same groups.
    const opexKeys: string[] = [];
    const opexVals: number[][] = [];
    for (const g of groupRevenueLines(vl.filter((l) => l.form !== 'sell'))) {
      const memberKeys: string[] = [];
      const vals: number[][] = [];
      rows.push({ key: K(`${g.section} operating expenses`), label: `${g.section} operating expenses`, kind: 'row', style: 'subtotal', values: [], sum: memberKeys });
      const head = rows[rows.length - 1];
      for (const l of g.lines) {
        const v = neg(perAsset(l, (x) => x.opexPerPeriod));
        vals.push(v);
        const k = K(`opex:${l.key}`);
        memberKeys.push(k);
        rows.push({ key: k, label: revenueLineName(l), kind: 'row', indent: 1, values: v, src: { kind: 'opex', assetIds: l.members.filter((m) => visIds.has(m.id)).map((m) => m.id) } });
      }
      head.values = add(vals);
      opexKeys.push(head.key); opexVals.push(head.values);
    }
    if (view === PL_ALL) {
      const v = neg(sl(snap.pl.hqOpexPerPeriod));
      rows.push({ key: K('HQ overheads'), label: 'HQ overheads', kind: 'row', values: v, src: { kind: 'hq' } });
      opexKeys.push(K('HQ overheads')); opexVals.push(v);
    }
    {
      const v = neg(sl(view === PL_ALL ? snap.pl.sellingExpensePerPeriod : snap.pl.sellingExpenseByPhase?.[view]));
      rows.push({ key: K('Selling and marketing'), label: 'Selling and marketing', kind: 'row', values: v, src: { kind: 'mkt', phaseId: view } });
      opexKeys.push(K('Selling and marketing')); opexVals.push(v);
    }
    const totOpex = add(opexVals);
    rows.push({ key: K('Total Operating Expenses'), label: 'Total operating expenses', kind: 'row', style: 'subtotal', values: totOpex, sum: opexKeys });

    // The fund fees (project only), then EBITDA, struck after them.
    const ebitdaParts = [K('Gross profit'), K('Total Operating Expenses')];
    if (view === PL_ALL && fundOn) {
      const feeKeys: string[] = [];
      FUND_FEE_SPECS.forEach((spec, i) => {
        const k = K(`fee:${i}`);
        feeKeys.push(k);
        rows.push({ key: k, label: spec.label, kind: 'row', indent: 1, values: neg(sl(snap.fundFees.lines[i]?.amountPerPeriod)), src: { kind: 'fee', index: i }, rateKey: `ft:${spec.label}`, rateFmt: spec.kind === 'amount' ? 'money' : 'pct' });
      });
      rows.push({ key: K('Total Fund Management Fee'), label: 'Total fund fees', kind: 'row', style: 'subtotal', values: neg(sl(snap.fundFees.totalPerPeriod)), sum: feeKeys });
      ebitdaParts.push(K('Total Fund Management Fee'));
    }
    if (view === PL_ALL) {
      rows.push({ key: K(labels.ebitda), label: labels.ebitda, kind: 'row', style: 'total', values: sl(snap.pl.ebitdaPerPeriod), sum: ebitdaParts });
      rows.push({ key: K('Depreciation & Amortization'), label: 'Depreciation', kind: 'row', values: neg(sl(snap.pl.daPerPeriod)), src: { kind: 'dep' } });
      rows.push({ key: K('Interest & financing cost'), label: 'Interest expensed', kind: 'row', values: neg(sl(snap.pl.interestExpensePerPeriod)), src: { kind: 'int' } });
      rows.push({ key: K('Gain on Disposal of Operating Assets'), label: 'Gain on disposal', kind: 'row', values: sl(snap.pl.gainOnDisposalPerPeriod), src: { kind: 'gain' } });
      rows.push({ key: K(labels.pbt), label: labels.pbt, kind: 'row', style: 'subtotal', values: sl(snap.pl.pbtPerPeriod), sum: [K(labels.ebitda), K('Depreciation & Amortization'), K('Interest & financing cost'), K('Gain on Disposal of Operating Assets')] });
      rows.push({ key: K('zakat'), label: labels.tax, kind: 'row', values: neg(sl(snap.pl.taxPerPeriod)), src: { kind: 'tax' }, rateKey: 'project:taxRate', rateFmt: 'pct',
        labelRate: zakat ? `of ${labels.pbt.toLowerCase()}` : 'of taxable profit' });
      rows.push({ key: K(labels.pat), label: labels.pat, kind: 'row', style: 'total', values: sl(snap.pl.patPerPeriod), sum: [K(labels.pbt), K('zakat')] });
    } else {
      const own = add([totRev, totCos, totOpex]);
      rows.push({ key: K(labels.ebitda), label: labels.ebitda, kind: 'row', style: 'total', values: own, sum: ebitdaParts });
    }
  }

  // The reconciliation: the phases' EBITDA, the project's HQ and fund fees, their sum, the project EBITDA.
  const RK = (name: string): string => `pl|${PHASE_RECON_LINE}||${name}`;
  rows.push({ key: 'pl|gap|recon', label: '', kind: 'gap' });
  rows.push({ key: RK('#section'), label: 'Phase EBITDA reconciliation', kind: 'section' });
  const reconKeys: string[] = [];
  const reconVals: number[][] = [];
  for (const ph of state.phases) {
    const src = rows.find((r) => r.key === `pl|${ph.id}||${labels.ebitda}`);
    if (!src) continue;
    reconKeys.push(RK(PHASE_RECON.phase(ph.name)));
    reconVals.push(src.values!);
    rows.push({ key: RK(PHASE_RECON.phase(ph.name)), label: PHASE_RECON.phase(ph.name), kind: 'row', values: src.values!, src: { kind: 'link', key: src.key } });
  }
  const hq = rows.find((r) => r.key === `pl|${PL_ALL}||HQ overheads`)!;
  reconKeys.push(RK(PHASE_RECON.hq)); reconVals.push(hq.values!);
  rows.push({ key: RK(PHASE_RECON.hq), label: PHASE_RECON.hq, kind: 'row', values: hq.values!, src: { kind: 'link', key: hq.key } });
  const fees = rows.find((r) => r.key === `pl|${PL_ALL}||Total Fund Management Fee`);
  if (fees) {
    reconKeys.push(RK(PHASE_RECON.fees)); reconVals.push(fees.values!);
    rows.push({ key: RK(PHASE_RECON.fees), label: PHASE_RECON.fees, kind: 'row', values: fees.values!, src: { kind: 'link', key: fees.key } });
  }
  const sum = add(reconVals);
  const proj = sl(snap.pl.ebitdaPerPeriod);
  rows.push({ key: RK(PHASE_RECON.sum), label: PHASE_RECON.sum, kind: 'row', style: 'subtotal', values: sum, sum: reconKeys });
  rows.push({ key: RK(PHASE_RECON.project), label: PHASE_RECON.project, kind: 'row', values: proj, src: { kind: 'link', key: `pl|${PL_ALL}||${labels.ebitda}` } });
  rows.push({ key: RK(PHASE_RECON.diff), label: PHASE_RECON.diff, kind: 'row', values: sum.map((v, t) => v - proj[t]), src: { kind: 'diff', a: RK(PHASE_RECON.sum), b: RK(PHASE_RECON.project) } });
  return rows;
}
