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
import { featureUsed } from '../exportScope';
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
  | { kind: 'feeTot' }                       // Financing: the fund fees' total, negated (2026-11-15)
  | { kind: 'gainP' }                        // the gain on disposal: the exit proceeds less what the exit writes off (Schedules)
  | { kind: 'taxable'; pbt: string; gain: string } // profit before zakat less the gain where the gain is not charged
  | { kind: 'taxRel'; taxable: string; pool: string } // corporate tax: the relief of the losses carried forward
  | { kind: 'taxPool'; taxable: string; rel: string } // corporate tax: the losses carried forward
  | { kind: 'taxP'; taxable: string; rel?: string } // zakat or tax on the P&L, negated
  | { kind: 'cosLines'; lines: string[] }    // a phase's cost of sales, its lines added, negated
  | { kind: 'opexPhase'; assetIds: string[]; phaseId: string } // a phase's opex and its selling, negated
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

    // ONE ROW PER LINE, NO CATEGORY ROWS (2026-11-15, founder).
    const revKeys: string[] = [];
    const revVals: number[][] = [];
    const sellRev: Array<[string, number[]]> = [], opRev: Array<[string, number[]]> = [];
    for (const g of groupRevenueLines(vl.filter(earns))) for (const l of g.lines) {
      const v = perAsset(l, (x) => x.revenuePerPeriod);
      const k = K(`rev:${l.key}`);
      revKeys.push(k); revVals.push(v);
      (l.form === 'sell' ? sellRev : opRev).push([k, v]);
      rows.push({ key: k, label: revenueLineName(l), kind: 'row', indent: 1, values: v, src: { kind: 'rev', line: l.key } });
    }
    const totRev = add(revVals);
    const cosLines = vl.filter((l) => l.form === 'sell' && earns(l));
    const opexLines = groupRevenueLines(vl.filter((l) => l.form !== 'sell')).flatMap((g) => g.lines);
    if (view !== PL_ALL) {
      // A PHASE, TO EBITDA (2026-11-15, founder): revenue by line, cost of sales, opex with its selling, EBITDA.
      const cosV = neg(add(cosLines.map((l) => perAsset(l, (x) => x.cosPerPeriod))));
      rows.push({ key: K('Residential cost of sales'), label: 'Cost of sales', kind: 'row', values: cosV, src: { kind: 'cosLines', lines: cosLines.map((l) => l.key) } });
      const opV = add([neg(add(opexLines.map((l) => perAsset(l, (x) => x.opexPerPeriod)))), neg(sl(snap.pl.sellingExpenseByPhase?.[view]))]);
      rows.push({ key: K('Total Operating Expenses'), label: 'Operating expenses, including selling', kind: 'row', values: opV, src: { kind: 'opexPhase', assetIds: opexLines.flatMap((l) => l.members.filter((m) => visIds.has(m.id)).map((m) => m.id)), phaseId: view } });
      rows.push({ key: K(labels.ebitda), label: labels.ebitda, kind: 'row', style: 'total', values: add([totRev, cosV, opV]), sum: [...revKeys, K('Residential cost of sales'), K('Total Operating Expenses')] });
      continue;
    }
    rows.push({ key: K('Total Revenue'), label: 'Total revenue', kind: 'row', style: 'total', values: totRev, sum: revKeys });

    // Cost of sales, by line.
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
    // RESIDENTIAL GROSS PROFIT AND OPERATING NOI, EACH ITS OWN SUBTOTAL BEFORE THE PROJECT EBITDA (2026-11-19, founder C13).
    rows.push({ key: K('Residential gross profit'), label: 'Residential gross profit', kind: 'row', style: 'total', values: add([...sellRev.map((x) => x[1]), totCos]), sum: [...sellRev.map((x) => x[0]), K('Residential cost of sales')] });

    // Operating expenses, one row per line.
    const opexKeys: string[] = [];
    const opexVals: number[][] = [];
    for (const l of opexLines) {
      const v = neg(perAsset(l, (x) => x.opexPerPeriod));
      const k = K(`opex:${l.key}`);
      opexKeys.push(k); opexVals.push(v);
      rows.push({ key: k, label: revenueLineName(l), kind: 'row', indent: 1, values: v, src: { kind: 'opex', assetIds: l.members.filter((m) => visIds.has(m.id)).map((m) => m.id) } });
    }
    if (opRev.length || opexKeys.length) rows.push({ key: K('Operating NOI'), label: 'Operating NOI', kind: 'row', style: 'total', values: add([...opRev.map((x) => x[1]), ...opexVals]), sum: [...opRev.map((x) => x[0]), ...opexKeys] });
    const ebitdaKeys = [K('Residential gross profit'), ...(opRev.length || opexKeys.length ? [K('Operating NOI')] : [])];
    // HQ off: no HQ row (2026-11-15).
    if (featureUsed(state as never, 'hq')) {
      const v = neg(sl(snap.pl.hqOpexPerPeriod));
      rows.push({ key: K('HQ overheads'), label: 'HQ overheads', kind: 'row', values: v, src: { kind: 'hq' } });
      opexKeys.push(K('HQ overheads')); opexVals.push(v); ebitdaKeys.push(K('HQ overheads'));
    }
    {
      const v = neg(sl(snap.pl.sellingExpensePerPeriod));
      rows.push({ key: K('Selling and marketing'), label: 'Selling and marketing', kind: 'row', values: v, src: { kind: 'mkt', phaseId: view } });
      opexKeys.push(K('Selling and marketing')); opexVals.push(v); ebitdaKeys.push(K('Selling and marketing'));
    }

    // The fund fees: one row, the total on Financing (2026-11-15, founder); EBITDA is struck after them.
    // PROJECT EBITDA, THEN THE FUND FEES, THEN EBITDA AFTER THEM (2026-11-19, founder B1): the covenants read the
    // project EBITDA; the fund fees are their total on Financing (the arranging fee inside them, not in finance cost).
    const ebitdaParts = ebitdaKeys;
    if (fundOn) {
      rows.push({ key: K('ebitdaPre'), label: `Project ${labels.ebitda}`, kind: 'row', style: 'total', values: sl(snap.pl.ebitdaBeforeFundFeesPerPeriod), sum: ebitdaParts });
      rows.push({ key: K('Total Fund Management Fee'), label: 'Fund fees', kind: 'row', values: neg(sl(snap.fundFees.totalPerPeriod)), src: { kind: 'feeTot' } });
      rows.push({ key: K(labels.ebitda), label: `${labels.ebitda} after fund fees`, kind: 'row', style: 'total', values: sl(snap.pl.ebitdaPerPeriod), sum: [K('ebitdaPre'), K('Total Fund Management Fee')] });
    } else rows.push({ key: K(labels.ebitda), label: labels.ebitda, kind: 'row', style: 'total', values: sl(snap.pl.ebitdaPerPeriod), sum: ebitdaParts });
    rows.push({ key: K('Depreciation & Amortization'), label: 'Depreciation', kind: 'row', values: neg(sl(snap.pl.daPerPeriod)), src: { kind: 'dep' } });
    rows.push({ key: K(labels.ebit), label: labels.ebit, kind: 'row', style: 'subtotal', values: sl(snap.pl.ebitPerPeriod), sum: [K(labels.ebitda), K('Depreciation & Amortization')] });
    rows.push({ key: K('Interest & financing cost'), label: 'Interest expensed', kind: 'row', values: neg(sl(snap.pl.interestExpensePerPeriod)), src: { kind: 'int' } });
    rows.push({ key: K('Gain on Disposal of Operating Assets'), label: 'Gain on disposal', kind: 'row', values: sl(snap.pl.gainOnDisposalPerPeriod), src: { kind: 'gainP' } });
    rows.push({ key: K(labels.pbt), label: labels.pbt, kind: 'row', style: 'subtotal', values: sl(snap.pl.pbtPerPeriod), sum: [K(labels.ebit), K('Interest & financing cost'), K('Gain on Disposal of Operating Assets')] });
    // ZAKAT ON THE P&L (2026-11-15, founder): the profit it is charged on, the corporate tax losses where they
    // apply, and the charge; Financing reads it back (formulaWorkbook LOOP_LINKS).
    const taxedGain = p.tax?.applyToDisposalGain === true;
    const cit = !zakat;
    let taxableKey = K(labels.pbt);
    if (!taxedGain) {
      taxableKey = K('taxable');
      rows.push({ key: taxableKey, label: zakat ? 'Profit zakat is charged on' : 'Taxable profit', kind: 'row', indent: 1, values: sl(snap.pl.pbtPerPeriod).map((v, t) => v - (sl(snap.pl.gainOnDisposalPerPeriod)[t] ?? 0)), src: { kind: 'taxable', pbt: K(labels.pbt), gain: K('Gain on Disposal of Operating Assets') } });
    }
    if (cit) {
      rows.push({ key: K('taxRel'), label: 'Tax loss relief', kind: 'row', indent: 1, values: sl(snap.pl.taxLossReliefPerPeriod), src: { kind: 'taxRel', taxable: taxableKey, pool: K('taxPool') } });
      rows.push({ key: K('taxPool'), label: 'Tax losses carried forward', kind: 'row', indent: 1, values: sl(snap.pl.taxLossCarriedForwardPerPeriod), src: { kind: 'taxPool', taxable: taxableKey, rel: K('taxRel') } });
    }
    rows.push({ key: K('zakat'), label: labels.tax, kind: 'row', values: neg(sl(snap.pl.taxPerPeriod)), src: { kind: 'taxP', taxable: taxableKey, rel: cit ? K('taxRel') : undefined }, rateKey: 'project:taxRate', rateFmt: 'pct',
      labelRate: zakat ? `of ${labels.pbt.toLowerCase()}` : 'of taxable profit' });
    rows.push({ key: K(labels.pat), label: labels.pat, kind: 'row', style: 'total', values: sl(snap.pl.patPerPeriod), sum: [K(labels.pbt), K('zakat')] });
  }
  // THE PHASES TO THE PROJECT (2026-11-19, founder B2): each phase's EBITDA, less what no phase carries (HQ, the
  // fund fees), is the project EBITDA after fund fees; the check reads 0.
  const phaseKeys = state.phases.map((ph) => `pl|${ph.id}||${labels.ebitda}`).filter((k) => rows.some((x) => x.key === k));
  if (phaseKeys.length > 1) {
    const R = (name: string): string => `pl|rec||${name}`;
    const val = (k: string): number[] => rows.find((x) => x.key === k)?.values ?? sl(undefined);
    rows.push({ key: 'pl|gap|rec', label: '', kind: 'gap' });
    rows.push({ key: R('#section'), label: 'Reconciliation: the phases to the project', kind: 'section' });
    const parts: string[] = [];
    for (const k of phaseKeys) { const ph = state.phases.find((x) => k.startsWith(`pl|${x.id}||`)); rows.push({ key: R(`ph:${ph?.id}`), label: `${labels.ebitda}: ${ph?.name}`, kind: 'row', indent: 1, values: val(k), src: { kind: 'link', key: k } }); parts.push(R(`ph:${ph?.id}`)); }
    const A = (name: string): string => `pl|${PL_ALL}||${name}`;
    if (rows.some((x) => x.key === A('HQ overheads'))) { rows.push({ key: R('hq'), label: 'HQ overheads, not allocated to a phase', kind: 'row', indent: 1, values: val(A('HQ overheads')), src: { kind: 'link', key: A('HQ overheads') } }); parts.push(R('hq')); }
    if (rows.some((x) => x.key === A('Total Fund Management Fee'))) { rows.push({ key: R('fees'), label: 'Fund fees, not allocated to a phase', kind: 'row', indent: 1, values: val(A('Total Fund Management Fee')), src: { kind: 'link', key: A('Total Fund Management Fee') } }); parts.push(R('fees')); }
    const sumV = add(parts.map((k) => val(k.startsWith('pl|rec||ph:') ? phaseKeys[parts.indexOf(k)] : k === R('hq') ? A('HQ overheads') : A('Total Fund Management Fee'))));
    rows.push({ key: R('total'), label: `${labels.ebitda} after fund fees, from the phases`, kind: 'row', style: 'subtotal', values: sumV, sum: parts });
    rows.push({ key: R('chk'), label: `Check: less the project ${labels.ebitda} after fund fees (0)`, kind: 'row', values: sl(undefined), src: { kind: 'diff', a: R('total'), b: A(labels.ebitda) } });
  }
  return rows;
}

/**
 * THE P&L LINE ROWS BY SECTION AND BY PHASE (2026-11-15): the P&L has no category rows, so a reader that
 * wants a section's revenue or opex, or a phase's revenue, adds the line rows this names.
 */
export function plLineKeys(state: FinancialsResolverState): { bySection: Map<string, { rev: string[]; opex: string[] }>; byPhase: Map<string, string[]> } {
  const p = state.project;
  const visIds = new Set(state.assets.filter((a) => a.visible !== false).map((a) => a.id));
  const lines = planRevenueLines(state.assets, state.subUnits, state.phases, p);
  const earns = (l: RevenueLine): boolean => l.members.some((m) => visIds.has(m.id) && state.subUnits.some((u) => u.assetId === m.id && isRevenueSubUnit(u)));
  const bySection = new Map<string, { rev: string[]; opex: string[] }>();
  const at = (s: string): { rev: string[]; opex: string[] } => { if (!bySection.has(s)) bySection.set(s, { rev: [], opex: [] }); return bySection.get(s)!; };
  for (const g of groupRevenueLines(lines.filter(earns))) for (const l of g.lines) at(g.section).rev.push(`pl|${PL_ALL}||rev:${l.key}`);
  for (const g of groupRevenueLines(lines.filter((l) => l.form !== 'sell'))) for (const l of g.lines) at(g.section).opex.push(`pl|${PL_ALL}||opex:${l.key}`);
  const byPhase = new Map<string, string[]>();
  for (const ph of state.phases) byPhase.set(ph.id, groupRevenueLines(lines.filter((l) => earns(l) && l.phaseId === ph.id)).flatMap((g) => g.lines).map((l) => `pl|${ph.id}||rev:${l.key}`));
  return { bySection, byPhase };
}
