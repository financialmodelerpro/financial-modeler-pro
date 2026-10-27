/**
 * stage5Statements.ts (2026-09-27; on the visible tabs 2026-10-15), FORMULA-LINKED EXPORT,
 * STAGE 5: THE STATEMENTS.
 *
 * Runs after the financing loop (stage 6), which it reads, and every layer before it.
 * Every row is one formula copied across the years (column-relative references), reading
 * the visible tabs; there is no working sheet.
 *
 * THE P&L, project and per phase, as `buildPLRows` builds it with every row a total reads
 * (zeros included): revenue per line and by section from Revenue (a Sell line earns its
 * recognition: pre-sales at handover plus sales after it; a hotel by department; a lease its
 * rent); cost of sales from Schedules; operating expenses per line, by hotel expense group
 * and HQ from Opex; selling and marketing expensed from Capex; EBITDA; depreciation from
 * Schedules; EBIT; interest, the fund fees and tax from the financing loop (its tax is on
 * the loop's own profit before tax, which Checks proves equals this one); the gain on
 * disposal as the exit proceeds less what Schedules writes off; profit after tax. A label
 * that carries a figure (a fee's rate and base, the tax rate) is a formula too.
 *
 * THE CASH FLOW, direct (project and per phase) and indirect: revenue received, the
 * operating receivables, opex paid through the payables, escrow, tax paid, capex per line
 * and land in kind from Capex, the financing flows from the loop, net, opening and closing
 * cash.
 *
 * THE BALANCE SHEET and its roll-forwards: land and depreciable NBV from Schedules, cash
 * from the Cash Flow, the receivables, inventory, escrow, payables and unearned revenue from
 * the tabs that make them, debt from the loop, and the equity, statutory reserve and
 * retained earnings roll-forwards beneath it, which close on its equity rows. The
 * reconciliation bridge reads each balance through the rule its row uses.
 *
 * Each group's rows are regenerated in the builder's own order and matched to the rows the
 * build emitted BY LABEL. A label that does not match refuses the layer rather than write a
 * formula on the wrong row.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { capexMethodOf } from './stage2Capex';
import { LiveWriter } from './writer';
import { accT } from './excelText';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { defaultDecimals } from '../styles';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { isRevenueSubUnit, isLandValueLine } from '@/src/core/calculations';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { FEE_BASE_LABELS, FUND_FEE_SPECS } from '../../fundTerms';
import { planRevenueLines, lineForAsset } from '../../revenueLines';
import { buildPLRows, buildDirectCFRows, buildIndirectCFRows, buildBSRows, SELLING_EXPENSE_LABEL, PHASE_RECON, PHASE_RECON_LINE } from '../../reports/m4Reports';
import { planReportLines, lineRowLabel } from '../../reports/lineRows';
import { hospitalityStatementsByLine, hospitalityRevenueParts, hospitalityCostParts, HOSPITALITY_COST_GROUPS } from '../../reports/hospitalityStatement';
import { revenueBySection } from '../../reports/revenueSections';
import type { Asset, CostLine } from '../../state/module1-types';
import type { M4Row } from '../../../components/modules/_shared/m4Table';

const PL = 'P&L';
const CF = 'Cash Flow';
const BS = 'Balance Sheet';
const ALL = '__all__';

type F = (t: number) => string;

export const stage5Statements: LiveLayer = {
  name: 'stage 5: statements',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const raw = ctx.opts.state;
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const snap = computeFinancialsSnapshot(state);
    const N = snap.axisLength;
    const { TOTAL_COL, OPEN_COL, LBL_COL } = PERIOD_COLS;
    const pc = (t: number): number => OPEN_COL + 1 + t;
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);
    const labels = getFinancialLabels(state.project.financialTerminology ?? defaultTerminologyForCountry(state.project.country));
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, state.project);
    const visible = state.assets.filter((a) => a.visible !== false);
    const booked = has('tl:flag:exit') && snap.disposal.booked;

    // ── Preconditions ────────────────────────────────────────────────────────
    const refuse: string[] = [];
    if (!has('schv:__project__:capDep')) refuse.push('the Schedules fixed asset tables are not live');
    if (!w.reg.keys().some((k) => k.startsWith('oxo:'))) refuse.push('Opex is not live');
    if (!w.reg.keys().some((k) => k.startsWith('rvc:'))) refuse.push('Revenue is not live');
    if (!has('fnc:tax') || !has('fnc:main:intexp')) refuse.push('the financing loop is not live');
    if (!has('project:taxRate')) refuse.push('the tax rate is not on the Inputs sheet');
    const taxLag = (state.project.tax?.paymentDays ?? 0) > 0;
    if (taxLag && !has('fnc:taxpay')) refuse.push('the tax payable is not on the Financing sheet');
    if (refuse.length) return [{ sheet: PL, status: 'values' as const, formulas: 0, note: `The P&L could not be made live for this model: ${refuse.join('; ')}.` }];

    // ── References: column relative, so a row is one formula copied across ───
    // `here` is the tab being written (its own references drop the sheet name). Inside
    // `prevOf` every reference reads the year before (the prior column for the first year).
    let here = PL;
    let shift = 0;
    const R = (key: string, t: number): string => {
      const a = w.addr(key);
      const ref = w.refP({ sheet: a.sheet, row: a.row, col: (LiveWriter.isWorking(a.sheet) ? 4 : pc(0)) + t + shift }, here);
      return shift < 0 ? `N(${ref})` : ref;
    };
    const prevOf = (f: F, t: number): string => { shift = -1; try { return f(t); } finally { shift = 0; } };
    /**
     * A TOTAL ADDS THE ROWS SHOWN UNDER IT (2026-10-20, founder): never the pieces again. Rows
     * that sit together are one SUM over their block, rows apart are added.
     */
    const sumKeysF = (keys: string[]): F => (t) => {
      const ks = keys.filter(has);
      if (ks.length === 0) return '0';
      const rows = ks.map((k) => w.addr(k).row);
      const together = ks.length > 1 && rows.every((r, i) => i === 0 || r === rows[i - 1] + 1);
      return together ? `SUM(${R(ks[0], t)}:${R(ks[ks.length - 1], t)})` : ks.map((k) => R(k, t)).join('+');
    };
    const delta = (f: F): F => (t) => `(${f(t)})-(${prevOf(f, t)})`;
    const sumF = (fs: F[]): F => (t) => fs.map((f) => f(t)).join('+') || '0';
    const neg = (f: F): F => (t) => `-(${f(t)})`;
    const keyF = (k: string): F => (has(k) ? (t) => R(k, t) : () => '0');
    const exitF: F = (t) => (booked ? R('tl:flag:exit', t) : '0');

    // ── The pieces, per asset and per project ────────────────────────────────
    const earner = (a: Asset): boolean => state.subUnits.some((u) => u.assetId === a.id && isRevenueSubUnit(u));
    const assetRev = (a: Asset): F => {
      const l = lineForAsset(lines, a.id);
      if (!l || !earner(a)) return () => '0';
      // THE LINE'S ROW IN REVENUE'S SUMMARY (2026-10-27): revenue recognised, one row per line.
      return keyF(`rvc:${l.key}:recognised`);
    };
    // Cost of sales is a LINE's (its rows on Schedules): it reads on the line's first plot, 0 on the others.
    const assetCos = (a: Asset): F => { const l = lineForAsset(lines, a.id); return l && l.host.id === a.id ? keyF(`cosc:${l.key}:cos`) : () => '0'; };
    const assetOpex = (a: Asset): F => keyF(`oxo:${a.id}:total`);
    const hq: F = keyF('oxo:hq:total');
    const expensedKeys = w.reg.keys().filter((k) => k.startsWith('cxe:') && k.split(':').length === 3);
    // A phase charges only the marketing its own plots spent (2026-10-25, m4Reports phaseSellingExpense):
    // the `cxe:<asset>:<line>` rows of the assets in that phase; the project view takes them all.
    const phaseOfAsset = new Map(state.assets.map((a) => [a.id, a.phaseId] as const));
    const sellingExpOf = (phaseId: string): F => {
      const ks = phaseId === ALL ? expensedKeys : expensedKeys.filter((k) => phaseOfAsset.get(k.split(':')[1]) === phaseId);
      return (t) => ks.map((k) => R(k, t)).join('+') || '0';
    };
    const projDep: F = (t) => `-${R('schv:__project__:dep', t)}`;
    const disposed: F = (t) => `-(${['schv:__project__:landDisp', 'schv:__project__:disp'].filter(has).map((k) => R(k, t)).join('+') || '0'})`;
    const feeIdx = FUND_FEE_SPECS.map((_, i) => i).filter((i) => has(`fnc:fee:${i}`));
    const feesF: F = (t) => feeIdx.map((i) => R(`fnc:fee:${i}`, t)).join('+') || '0';

    // ── Labels that carry a figure ───────────────────────────────────────────
    const scale = ctx.opts.displayScale ?? 'full';
    const dp = scale === 'full' ? 0 : (ctx.opts.displayDecimals ?? defaultDecimals(scale));
    const money = (e: string): string => accT(e, scale, dp);
    const q = (s: string): string => s.replace(/"/g, '""');
    const labelWrites: Array<{ sheet: string; key: string; formula: string }> = [];
    /** fundFeeLineLabel, as a formula: the fee's rate and the base it is charged on. */
    const feeLabelF = (i: number): string | null => {
      const line = snap.fundFees.lines[i];
      const spec = FUND_FEE_SPECS[i];
      if (!line || !spec || line.base === 'flat_amount' || !has(`ft:${spec.label}`)) return null;
      const capKey = line.base === 'fund_size' ? 'ftcap:Fund size' : line.base === 'total_equity' ? 'ftcap:Capex equity' : line.base === 'debt_facility' ? 'ftcap:Debt facility' : '';
      // A typed fund size (the override) is not their sum, so the capital block is not printed: it is the Inputs figure.
      const typedSize = line.base === 'fund_size' && !has(capKey) && has('ft:Fund size (typed target)');
      if (!capKey || (!has(capKey) && !typedSize)) return null;
      const base = typedSize ? `MAX(0,N(${w.ref('ft:Fund size (typed target)')}))` : w.refA(w.addr(capKey));
      const pct = `TEXT(N(${w.ref(`ft:${spec.label}`)}),"0.00%")`;
      const name = q(FEE_BASE_LABELS[line.base] ?? line.base);
      const years = `COLUMNS(${w.rangeA(PL, 3, pc(0), pc(N - 1))})`;
      const span = line.timing === 'annual' ? `&IF(${years}>1,", "&${years}&" periods","")` : '';
      return `"${q(line.label)} ("&${pct}&" of ${name}"&IF(${base}<>0," "&${money(base)}${span},", "&${money('0')}&" over the life")&")"`;
    };

    // ── THE P&L ──────────────────────────────────────────────────────────────
    const writes: Array<[string, string, F, 'sum' | 'first' | 'last']> = [];
    let refused = '';
    /** The project's cost of sales (the whole-project view's), for the indirect cash flow. */
    let cosTotalF: F = () => '0';
    const doView = (phaseId: string): void => {
      const phaseFiltered = phaseId !== ALL;
      const matches = (a: { phaseId: string }): boolean => !phaseFiltered || a.phaseId === phaseId;
      const rows: M4Row[] = buildPLRows({ snap, state, labels, filterPhaseId: phaseId, fmt: (v: number) => String(v), labelFmt: (v: number) => String(v), allRows: true });
      const residential = visible.filter((a) => (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && matches(a));
      const hosp = visible.filter((a) => a.strategy === 'Operate' && matches(a));
      const retail = visible.filter((a) => a.strategy === 'Lease' && matches(a));
      const hospLines = hospitalityStatementsByLine(snap, state, new Set(hosp.map((a) => a.id)));
      const byId = new Map(state.assets.map((a) => [a.id, a] as const));
      const lineF = (ids: Set<string>, pick: (a: Asset) => F): Array<{ label: string; f: F }> =>
        planReportLines(state, (a) => ids.has(a.id)).map((line) => ({ label: lineRowLabel(line, state), f: sumF(line.assetIds.map((id) => pick(byId.get(id)!))) }));
      const groups = new Map<string, Array<{ label: string; f: F }>>();
      const heads = new Map<string, F>();
      const secFs: F[] = [];
      for (const sec of revenueBySection(snap, state, matches)) {
        const inSec = new Set(sec.assetIds);
        const g = `pl-rev-${sec.key}`;
        const f = sumF(sec.assetIds.map((id) => assetRev(byId.get(id)!)));
        heads.set(g, f); secFs.push(f);
        const members: Array<{ label: string; f: F }> = [];
        for (const h of hospLines) {
          if (!h.line.members.some((m) => inSec.has(m.id))) continue;
          const earnerLine = lineForAsset(lines, h.line.members[0].id);
          const keyOf = ['rooms', 'fb', 'other'];
          hospitalityRevenueParts(h.statement).forEach((p, i) => {
            const k = earnerLine ? `rvc:${earnerLine.key}:${keyOf[i]}` : '';
            members.push({ label: `${h.line.label}: ${p.label}`, f: k ? keyF(k) : () => '0' });
          });
        }
        members.push(...lineF(new Set(visible.filter((a) => inSec.has(a.id) && a.strategy !== 'Operate').map((a) => a.id)), assetRev));
        groups.set(g, members);
      }
      const totalRev = sumF(secFs);
      const cosTotal = sumF(residential.map(assetCos));
      if (!phaseFiltered) cosTotalF = cosTotal;
      heads.set('pl-cos', neg(cosTotal));
      groups.set('pl-cos', lineF(new Set(residential.map((a) => a.id)), assetCos).map((m) => ({ label: m.label, f: neg(m.f) })));
      const hospOpex = sumF(hosp.map(assetOpex));
      heads.set('pl-opex-hosp', neg(hospOpex));
      const hospMembers: Array<{ label: string; f: F }> = [];
      for (const h of hospLines) {
        hospitalityCostParts(h.statement).forEach((p, i) => {
          hospMembers.push({ label: `${h.line.label}: ${p.label}`, f: neg(keyF(`oxo:${h.line.key}:grp:${HOSPITALITY_COST_GROUPS[i]}`)) });
        });
      }
      groups.set('pl-opex-hosp', hospMembers);
      const retailOpex = sumF(retail.map(assetOpex));
      heads.set('pl-opex-ret', neg(retailOpex));
      groups.set('pl-opex-ret', lineF(new Set(retail.map((a) => a.id)), assetOpex).map((m) => ({ label: m.label, f: neg(m.f) })));

      const seen = new Map<string, number>();
      const keyFor = (label: string): string => { const b = `pl|${phaseId}||${label}`; const n = seen.get(b) ?? 0; seen.set(b, n + 1); return n ? `${b}~${n}` : b; };
      const cursor = new Map<string, number>();
      const K = (label: string): string => `pl|${phaseId}||${label}`;
      const cell = (label: string): F => keyF(K(label));
      const opexRows: string[] = [];
      const feeRows: string[] = [];
      const usedFees = new Set<number>();
      // Each group's line and the rows shown under it; the revenue groups' lines for the total.
      const headKey = new Map<string, string>();
      const memberKeys = new Map<string, string[]>();
      const revHeads: string[] = [];
      // A fund fee's label carries its base, so a fee row is found by the fee's own name.
      const feeOf = (r: M4Row): number => (phaseFiltered || r.indent !== 1 ? -1
        : snap.fundFees.lines.findIndex((l, i) => !usedFees.has(i) && r.label.startsWith(`${l.label} (`)));
      for (const r of rows) {
        if (r.isSection && (r.collapseRole !== 'header' || r.values.length === 0)) continue;
        const fee = feeOf(r);
        const key = fee >= 0
          ? (w.reg.keys().find((k) => k.startsWith(`pl|${phaseId}||${snap.fundFees.lines[fee].label} (`)) ?? '')
          : keyFor(r.label);
        if (!has(key)) { refused = `the row "${r.label}" is not where the P&L put it`; return; }
        const g = r.collapseGroup;
        const L = r.label;
        let f: F | undefined;
        if (g && r.collapseRole === 'header') {
          f = heads.get(g); headKey.set(g, key);
          if (g.startsWith('pl-opex')) opexRows.push(key);
          if (g.startsWith('pl-rev-')) revHeads.push(key);
        } else if (g && r.collapseRole === 'member') {
          const i = cursor.get(g) ?? 0; cursor.set(g, i + 1);
          const m = groups.get(g)?.[i];
          if (!m || m.label !== L) { refused = `the ${g} rows do not match (${L} against ${m?.label ?? 'nothing'})`; return; }
          f = m.f;
          memberKeys.set(g, [...(memberKeys.get(g) ?? []), key]);
        } else if (L === 'Total Revenue') f = revHeads.length ? sumKeysF([...revHeads]) : totalRev;
        else if (L.startsWith('HQ Expenses')) { f = neg(hq); opexRows.push(key); }
        else if (L.startsWith(SELLING_EXPENSE_LABEL)) { f = neg(sellingExpOf(phaseId)); opexRows.push(key); }
        else if (L === 'Total Operating Expenses') { const rs = [...opexRows]; f = (t) => rs.map((k) => R(k, t)).join('+') || '0'; }
        else if (L === labels.ebitda && phaseFiltered) f = (t) => `${cell('Total Revenue')(t)}+${has(K('Residential cost of sales')) ? cell('Residential cost of sales')(t) : `-(${cosTotal(t)})`}+${cell('Total Operating Expenses')(t)}`;
        else if (!phaseFiltered) {
          if (fee >= 0) {
            usedFees.add(fee); feeRows.push(key);
            f = has(`fnc:fee:${fee}`) ? (t) => `-${R(`fnc:fee:${fee}`, t)}` : () => '0';
            const lf = feeLabelF(fee);
            if (lf) labelWrites.push({ sheet: PL, key, formula: lf });
          } else if (L === 'Total Fund Management Fee') { const rs = [...feeRows]; f = (t) => rs.map((k) => R(k, t)).join('+') || '0'; }
          else if (L === labels.ebitda) f = (t) => `${cell('Total Revenue')(t)}+${has(K('Residential cost of sales')) ? cell('Residential cost of sales')(t) : `-(${cosTotal(t)})`}+${cell('Total Operating Expenses')(t)}${has(K('Total Fund Management Fee')) ? `+${cell('Total Fund Management Fee')(t)}` : ''}`;
          else if (L === 'Depreciation & Amortization') f = neg(projDep);
          else if (L === labels.ebit) f = (t) => `${cell(labels.ebitda)(t)}+${cell('Depreciation & Amortization')(t)}`;
          else if (L === 'Interest & financing cost') f = keyF('fnc:main:intexp');
          else if (L === 'Gain on Disposal of Operating Assets') f = (t) => `${keyF('fnc:proceeds')(t)}-(${disposed(t)})`;
          else if (L === labels.pbt) f = (t) => `${cell(labels.ebit)(t)}+${cell('Interest & financing cost')(t)}${has(K('Gain on Disposal of Operating Assets')) ? `+${cell('Gain on Disposal of Operating Assets')(t)}` : ''}`;
          else if (L.startsWith(`${labels.tax} (`)) {
            // The loop's tax, on the loop's own profit before tax (Checks: it equals this P&L's).
            f = (t) => `-${R('fnc:tax', t)}`;
            labelWrites.push({ sheet: PL, key, formula: `"${q(labels.tax)} ("&TEXT(N(${w.ref('project:taxRate')}),"0.00%")&")"` });
          } else if (L === labels.pat) {
            const taxKey = w.reg.keys().find((k) => k.startsWith(`pl|${phaseId}||${labels.tax} (`)) as string;
            f = (t) => `${cell(labels.pbt)(t)}+${R(taxKey, t)}`;
          }
        }
        if (!f) { refused = `no rule for the P&L row "${L}"`; return; }
        writes.push([PL, key, f, 'sum']);
      }
      // A group's line is the sum of the rows shown under it.
      for (const [g, hk] of headKey) {
        const ms = memberKeys.get(g);
        if (!ms?.length) continue;
        const at = writes.findIndex((x) => x[1] === hk);
        if (at >= 0) writes[at] = [PL, hk, sumKeysF(ms), 'sum'];
      }
    };
    doView(ALL);
    for (const ph of state.phases) if (!refused && w.reg.keys().some((k) => k.startsWith(`pl|${ph.id}||`))) doView(ph.id);
    if (refused) return [{ sheet: PL, status: 'values' as const, formulas: 0, note: `The P&L could not be made live for this model: ${refused}.` }];
    // THE PHASE EBITDA RECONCILIATION (2026-10-25): each phase's EBITDA row, the project's HQ and fund fees,
    // their sum, the project EBITDA row and the difference, all read off the rows above.
    {
      const RK = (label: string): string => `pl|${PHASE_RECON_LINE}||${label}`;
      const sumKeys: string[] = [];
      const put = (label: string, f: F, inSum: boolean): void => {
        if (!has(RK(label))) return;
        writes.push([PL, RK(label), f, 'sum']);
        if (inSum) sumKeys.push(RK(label));
      };
      for (const ph of state.phases) {
        const k = `pl|${ph.id}||${labels.ebitda}`;
        put(PHASE_RECON.phase(ph.name), has(k) ? keyF(k) : () => '0', true);
      }
      put(PHASE_RECON.hq, neg(hq), true);
      const feeTotal = `pl|${ALL}||Total Fund Management Fee`;
      put(PHASE_RECON.fees, has(feeTotal) ? keyF(feeTotal) : neg(feesF), true);
      put(PHASE_RECON.sum, sumKeysF([...sumKeys]), false);
      put(PHASE_RECON.project, keyF(`pl|${ALL}||${labels.ebitda}`), false);
      put(PHASE_RECON.diff, (t) => `${R(RK(PHASE_RECON.sum), t)}-${R(RK(PHASE_RECON.project), t)}`, false);
    }
    const plWrites = writes.splice(0);
    const out: Array<{ sheet: string; status: 'live' | 'partial' | 'values'; note: string; formulas: number }> = [];

    // ── THE CASH FLOW, direct (project and per phase) and indirect ───────────
    const plF = (label: string): F => keyF(`pl|${ALL}||${label}`);
    const cosAddBack: F = (t) => (has(`pl|${ALL}||Residential cost of sales`) ? `-${R(`pl|${ALL}||Residential cost of sales`, t)}` : cosTotalF(t));
    const taxPay: F = taxLag ? keyF('fnc:taxpay') : () => '0';
    const costLineOf = (id: string): Pick<CostLine, 'id' | 'catalogId'> => (state.costLines as CostLine[]).find((x) => x.id === id) ?? { id };
    const capexRowsOf = (a: Asset): { cash: string[]; inKind: string[] } => {
      const keys = w.reg.keys().filter((k) => k.startsWith(`cxc:${a.id}:`) && k.split(':').length === 3);
      const inKind = keys.filter((k) => isLandValueLine(costLineOf(k.split(':')[2])) && capexMethodOf(state as never, k) === 'percent_of_inkind_land');
      return { cash: keys.filter((k) => !inKind.includes(k)), inKind };
    };
    const capexCash = (a: Asset): F => { const k = capexRowsOf(a).cash; return (t) => k.map((x) => R(x, t)).join('+') || '0'; };
    const inKindOf = (a: Asset): F => { const k = capexRowsOf(a).inKind; return (t) => k.map((x) => R(x, t)).join('+') || '0'; };
    // Cash collected: the line's row in Revenue's summary (a hotel or lease line's revenue less the rise in its receivable).
    const revRcv = (a: Asset): F => { const l = lineForAsset(lines, a.id); return l && earner(a) ? keyF(`rvc:${l.key}:collected`) : () => '0'; };
    // The Opex tab shows cash paid as a negative row ("Less: Cash Paid").
    const opexPaid = (a: Asset): F => neg(keyF(`oxo:ap:${a.id}:lessPaid`));
    const hqPaid: F = neg(keyF('oxo:ap:hq:lessPaid'));
    const sellEarners = visible.filter((a) => (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && has(`rvc:${a.id}:cash`));
    const lineSeries = (k: string): F => (t) => sellEarners.map((a) => { const l = lineForAsset(lines, a.id); return l && has(`rvc:${l.key}:${k}`) ? R(`rvc:${l.key}:${k}`, t) : '0'; }).join('+') || '0';
    const resAr = lineSeries('ar');
    const unearned = lineSeries('ur');
    const escB = (label: string): string => `esc||B. Escrow Balance Roll-Forward|${label}`;
    const escClose: F = keyF(escB('Closing Balance'));
    const apClose: F = keyF('opex|__project__|ap|Closing AP');
    const opArProject: F = (t) => lines.filter((l) => l.form !== 'sell').map((l) => `rvc:${l.key}:opar`).filter(has).map((k) => R(k, t)).join('+') || '0';
    const facs = state.financingTranches ?? [];
    const originF = (origin: 'new' | 'existing') => {
      const fs = facs.filter((f) => (f.origin === 'existing' ? 'existing' : 'new') === origin);
      return {
        draw: (t: number): string => fs.map((f) => `${keyF(`fnc:tr:${f.id}:draw`)(t)}+${keyF(`fnc:tr:${f.id}:idc`)(t)}`).join('+') || '0',
        repay: (t: number): string => `${fs.map((f) => keyF(`fnc:tr:${f.id}:repaid`)(t)).join('+') || '0'}${booked ? `-${exitF(t)}*MAX(0,${fs.map((f) => keyF(`fnc:main:tr:${f.id}:bal`)(t)).join('+') || '0'})` : ''}`,
        int: (t: number): string => `-(${fs.map((f) => keyF(`fnc:tr:${f.id}:charge`)(t)).join('+') || '0'})`,
      };
    };
    const debtBs: F = has('fnc:main:debtbs') ? keyF('fnc:main:debtbs')
      : (t) => facs.map((f) => `(1-${exitF(t)})*${keyF(`fnc:main:tr:${f.id}:bal`)(t)}`).join('+') || '0';

    let cfRefused = '';
    const cfView = (view: string, phaseId: string, rows: M4Row[]): void => {
      const phaseFiltered = phaseId !== ALL;
      const matches = (a: { phaseId: string }): boolean => !phaseFiltered || a.phaseId === phaseId;
      const res = visible.filter((a) => (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && matches(a));
      const hosp = visible.filter((a) => a.strategy === 'Operate' && matches(a));
      const ret = visible.filter((a) => a.strategy === 'Lease' && matches(a));
      const all = [...res, ...hosp, ...ret];
      const byId = new Map(state.assets.map((a) => [a.id, a] as const));
      // A capex line reads its asset's row on Capex Table 2 less its land in kind (Table 3 is gone, 2026-10-27).
      const cashCapexKey = (assetIds: readonly string[]): string | undefined => assetIds.map((id) => `cx2:${id}`).find(has);
      const lineInKind = (assetIds: readonly string[]): F => sumF(assetIds.map((id) => byId.get(id)).filter((a): a is Asset => !!a).map(inKindOf));
      const members = (list: Asset[], pick: (a: Asset) => F, sign: 1 | -1, capexLine = false): Array<{ label: string; f: F }> => {
        const ids = new Set(list.map((a) => a.id));
        return planReportLines(state, (a) => ids.has(a.id)).map((line) => {
          const one = capexLine ? cashCapexKey(line.assetIds) : undefined;
          const f = one ? (t: number) => `${R(one, t)}-(${lineInKind(line.assetIds)(t)})` : sumF(line.assetIds.map((id) => pick(byId.get(id)!)));
          return { label: lineRowLabel(line, state), f: sign === 1 ? f : neg(f) };
        });
      };
      const groups = new Map<string, Array<{ label: string; f: F }>>([
        ['cf-rev-res', members(res, revRcv, 1)], ['cf-rev-hosp', members(hosp, revRcv, 1)], ['cf-rev-ret', members(ret, revRcv, 1)],
        ['cf-opex-hosp', members(hosp, opexPaid, -1)], ['cf-opex-ret', members(ret, opexPaid, -1)],
        ['cf-capex-res', members(res, capexCash, -1, true)], ['cf-capex-hosp', members(hosp, capexCash, -1, true)], ['cf-capex-ret', members(ret, capexCash, -1, true)],
      ]);
      const heads = new Map<string, F>([
        ['cf-rev-res', sumF(res.map(revRcv))], ['cf-rev-hosp', sumF(hosp.map(revRcv))], ['cf-rev-ret', sumF(ret.map(revRcv))],
        ['cf-opex-hosp', neg(sumF(hosp.map(opexPaid)))], ['cf-opex-ret', neg(sumF(ret.map(opexPaid)))],
        ['cf-capex-res', neg(sumF(res.map(capexCash)))], ['cf-capex-hosp', neg(sumF(hosp.map(capexCash)))], ['cf-capex-ret', neg(sumF(ret.map(capexCash)))],
      ]);
      // The operating receivable of the lines in this view, each at its own days (Revenue).
      const opRev = sumF([...hosp, ...ret].map(assetRev));
      const viewIds = new Set([...hosp, ...ret].map((a) => a.id));
      const oparKeys = lines.filter((l) => l.form !== 'sell' && l.members.some((m) => viewIds.has(m.id))).map((l) => `rvc:${l.key}:opar`).filter(has);
      const opAr: F = (t) => oparKeys.map((k) => R(k, t)).join('+') || '0';
      const opCash: F = (t) => `MAX(0,${opRev(t)})-(${delta(opAr)(t)})`;
      // Land in kind reads Capex Table 5 (the project's, or the phase's), one cell.
      const inKindKey = phaseFiltered ? `cx5:${phaseId}:inkind` : 'cx5:total:inkind';
      const inKind = has(inKindKey) ? keyF(inKindKey) : sumF(all.map(inKindOf));
      const seen = new Map<string, number>();
      const keyFor = (label: string): string => { const b = `cf|${view}||${label}`; const n = seen.get(b) ?? 0; seen.set(b, n + 1); return n ? `${b}~${n}` : b; };
      const K = (label: string): string => `cf|${view}||${label}`;
      const sumRows = (labs: string[]): F => (t) => labs.filter((l) => has(K(l))).map((l) => R(K(l), t)).join('+') || '0';
      /** A phase's escrow: its revenue lines' held cash, and all held so far released in the release year. */
      const phaseEscrow = (kind: 'held' | 'release'): F => (t) => lines.filter((l) => l.phaseId === phaseId && has(`escc:${l.key}:held`)).map((l) => {
        if (kind === 'held') return R(`escc:${l.key}:held`, t);
        const relY = w.refA(w.addr(`escc:${l.key}:release`), here);
        const yr = (c: number, rel = false): string => (rel ? w.refP({ sheet: 'Revenue', row: 3, col: c }, here) : w.refA({ sheet: 'Revenue', row: 3, col: c }, here));
        const hr = w.addr(`escc:${l.key}:held`).row;
        const toNow = `'Revenue'!$${colLetter(pc(0))}$${hr}:${colLetter(pc(t))}$${hr}`;
        w.refP({ sheet: 'Revenue', row: hr, col: pc(t) }, here);
        return `(${yr(pc(t), true)}=MAX(${yr(pc(0))},MIN(${yr(pc(N - 1))},${relY})))*SUM(${toNow})`;
      }).join('+') || '0';
      const cursor = new Map<string, number>();
      const financing: string[] = [];
      const operating: string[] = [];
      const investing: string[] = [];
      // Each group's line and the rows under it (a total adds the rows shown, never the pieces).
      const headKey = new Map<string, string>();
      const memberKeys = new Map<string, string[]>();
      const headOf = (g: string): string[] => (headKey.has(g) ? [headKey.get(g)!] : []);
      const OPAR = 'Less: Rise in operating receivables';
      // A residential line with an operating cost has no row of its own to show it, so its collection keeps the pieces.
      const resNoOpex = res.every((a) => (snap.perAssetCF.get(a.id)?.opexPaidPerPeriod ?? []).every((v) => !v));
      let inFinancing = false;
      let inIndirectOps = view === 'indirect';
      for (const r of rows) {
        if (r.isSection && (r.collapseRole !== 'header' || r.values.length === 0)) {
          if (r.label === 'CASH FROM FINANCING') inFinancing = true;
          if (r.label === 'CASH FROM INVESTMENT') inIndirectOps = false;
          continue;
        }
        const key = keyFor(r.label);
        if (!has(key)) { cfRefused = `the row "${r.label}" is not where the Cash Flow put it`; return; }
        const g = r.collapseGroup;
        const L = r.label;
        let f: F | undefined;
        let tot: 'sum' | 'first' | 'last' = 'sum';
        if (g && r.collapseRole === 'header') { f = heads.get(g); headKey.set(g, key); if (g.startsWith('cf-capex')) investing.push(L); }
        else if (g && r.collapseRole === 'member') {
          const i = cursor.get(g) ?? 0; cursor.set(g, i + 1);
          const m = groups.get(g)?.[i];
          if (!m || m.label !== L) { cfRefused = `the ${g} rows do not match (${L} against ${m?.label ?? 'nothing'})`; return; }
          f = m.f;
          memberKeys.set(g, [...(memberKeys.get(g) ?? []), key]);
        } else if (L === OPAR) f = neg(delta(opAr));
        else if (inIndirectOps) {
          if (L === 'Cash Flow from Operations') { const rs = [...operating]; f = sumRows(rs); }
          else {
            operating.push(L);
            if (L.startsWith(labels.pat)) f = plF(labels.pat);
            else if (L.startsWith('(+) Depreciation & Amortization')) f = neg(plF('Depreciation & Amortization'));
            else if (L.startsWith('(+) Interest expense (add back)')) f = neg(plF('Interest & financing cost'));
            else if (L.startsWith('(−) Change in AR')) f = neg(delta((t) => `${opAr(t)}+${resAr(t)}`));
            else if (L === '(+) Cost of sales (add back; capex in investing)') f = cosAddBack;
            else if (L.startsWith('(−) Gain on disposal')) f = neg(plF('Gain on Disposal of Operating Assets'));
            else if (L === '(+) Change in AP') f = delta(apClose);
            else if (L === '(+) Change in Unearned Revenue') f = delta(unearned);
            else if (L === `(+) Change in ${labels.tax} payable`) f = delta(taxPay);
            else if (L === '(+) Change in Escrow balance') f = neg(delta(escClose));
          }
        } else if (L === 'Total Revenue Received') {
          // Each line's row is its cash (a hotel or lease line's revenue less the rise in its
          // receivable, on Revenue, 2026-10-27), so the total adds the class rows above it.
          const heads = [...headOf('cf-rev-res'), ...headOf('cf-rev-hosp'), ...headOf('cf-rev-ret'), ...(has(K(OPAR)) ? [K(OPAR)] : [])];
          const classes = [res, hosp, ret].filter((x) => x.length).length;
          f = heads.length && heads.length >= classes ? sumKeysF(heads) : (t) => `${sumF(res.map(revRcv))(t)}+${opCash(t)}`;
        }
        else if (L === 'Less: Inaccessible Funds Locked') f = phaseFiltered ? neg(phaseEscrow('held')) : neg(keyF(escB('Total Additions')));
        else if (L === 'Add: Release of Inaccessible Funds') f = phaseFiltered ? phaseEscrow('release') : neg(keyF(escB('Less: Release of Locked Funds')));
        else if (L.startsWith('HQ Expenses')) f = neg(hqPaid);
        else if (L.startsWith(SELLING_EXPENSE_LABEL)) f = neg(sellingExpOf(phaseId));
        // A class's contribution: its revenue received and its opex paid, the rows above.
        // (A residential line pays no operating cost of its own, so it is its collections.)
        else if (L === '= Residential Cash Collection') f = headKey.has('cf-rev-res') && resNoOpex ? sumKeysF(headOf('cf-rev-res')) : (t) => `${sumF(res.map(revRcv))(t)}-(${sumF(res.map(opexPaid))(t)})`;
        else if (L === '= Hospitality EBITDA') f = headKey.has('cf-rev-hosp') ? sumKeysF([...headOf('cf-rev-hosp'), ...headOf('cf-opex-hosp')]) : (t) => `${sumF(hosp.map(revRcv))(t)}-(${sumF(hosp.map(opexPaid))(t)})`;
        else if (L === '= Retail NOI') f = headKey.has('cf-rev-ret') ? sumKeysF([...headOf('cf-rev-ret'), ...headOf('cf-opex-ret')]) : (t) => `${sumF(ret.map(revRcv))(t)}-(${sumF(ret.map(opexPaid))(t)})`;
        else if (L === 'Total Operating Expenses Paid') {
          const parts = [...headOf('cf-opex-hosp'), ...headOf('cf-opex-ret'), ...['HQ Expenses', SELLING_EXPENSE_LABEL].map(K).filter(has)];
          f = resNoOpex ? sumKeysF(parts) : (t) => `-(${sumF(all.map(opexPaid))(t)})${phaseFiltered ? '' : `-${hqPaid(t)}`}-(${sellingExpOf(phaseId)(t)})`;
        }
        else if (L === 'Fund Management and Other Expenses') f = neg(feesF);
        else if (L === labels.taxPaid) f = neg(keyF('fnc:taxpaid'));
        else if (L === 'Cash Flow from Operations') {
          // Every component is a row (the builder prints them all): the totals add the rows.
          f = sumRows(['Total Revenue Received', 'Less: Inaccessible Funds Locked', 'Add: Release of Inaccessible Funds', 'Total Operating Expenses Paid', 'Fund Management and Other Expenses', labels.taxPaid]);
        }
        else if (L.startsWith('Land In-Kind')) { f = neg(inKind); investing.push(L); }
        else if (L === 'Total Capex') { const rs = [...investing]; f = sumRows(rs); }
        // The exit is project level: a phase's view shows the row at zero, as the platform does.
        else if (L === 'Proceeds from Disposal of Operating Assets') f = phaseFiltered ? () => '0' : keyF('fnc:proceeds');
        else if (L === 'Cash Flow from Investment') f = sumRows(['Total Capex', 'Proceeds from Disposal of Operating Assets']);
        else if (inFinancing && L === 'Cash Flow from Financing') { const rs = [...financing]; f = sumRows(rs); }
        else if (inFinancing && !['Net Cash Flow', 'Opening cash', 'Closing cash'].includes(L)) {
          // The financing flows, read from the loop's rows on Financing.
          const nw = originF('new'), ex = originF('existing');
          if (L.startsWith('In-Kind Equity')) f = inKind;
          else if (L === 'Equity Drawdown, development') f = keyF('fnc:main:equity');
          else if (L === 'Equity Drawdown (Cash)') f = sumF([keyF('fnc:main:equity'), keyF('fnc:main:feedraw')]);
          else if (L === 'Equity Drawdown, management fee') f = keyF('fnc:main:feedraw');
          else if (L === 'Debt Drawdown, New loans') f = nw.draw;
          else if (L === 'Debt Repayment, New loans') f = nw.repay;
          else if (L === 'Interest Paid, New loans') f = nw.int;
          else if (L === 'Debt Drawdown, Existing loans') f = ex.draw;
          else if (L === 'Debt Repayment, Existing loans') f = ex.repay;
          else if (L === 'Interest Paid, Existing loans') f = ex.int;
          else if (L === 'Dividends paid') f = keyF('fnc:main:div');
          financing.push(L);
        } else if (L === 'Net Cash Flow') f = sumRows(['Cash Flow from Operations', 'Cash Flow from Investment', 'Cash Flow from Financing']);
        else if (L === 'Opening cash') { f = (t) => prevOf(keyF(K('Closing cash')), t); tot = 'first'; }
        else if (L === 'Closing cash') { f = sumRows(['Opening cash', 'Net Cash Flow']); tot = 'last'; }
        if (!f) { cfRefused = `no rule for the Cash Flow row "${L}"${phaseFiltered ? ` (${phaseId})` : ''}`; return; }
        writes.push([CF, key, f, tot]);
      }
      // A group's line is the sum of the rows shown under it.
      for (const [g, hk] of headKey) {
        const ms = memberKeys.get(g);
        if (!ms?.length) continue;
        const at = writes.findIndex((x) => x[1] === hk);
        if (at >= 0) writes[at] = [CF, hk, sumKeysF(ms), 'sum'];
      }
    };
    cfView('direct', ALL, buildDirectCFRows({ snap, state, labels, filterPhaseId: ALL, fmt: (v: number) => String(v), allRows: true }));
    if (!cfRefused) cfView('indirect', ALL, buildIndirectCFRows({ snap, state, labels, filterPhaseId: ALL, fmt: (v: number) => String(v), allRows: true }));
    for (const ph of state.phases) if (!cfRefused && w.reg.keys().some((k) => k.startsWith(`cf|${ph.id}||`))) cfView(ph.id, ph.id, buildDirectCFRows({ snap, state, labels, filterPhaseId: ph.id, fmt: (v: number) => String(v), allRows: true }));
    const cfWrites = cfRefused ? [] : writes.splice(0);
    if (cfRefused) writes.length = 0;

    // ── THE BALANCE SHEET and its equity roll-forwards ───────────────────────
    let bsRefused = cfRefused ? 'the Cash Flow is not live' : '';
    const bsRows = buildBSRows({ snap, state, labels, filterPhaseId: ALL, fmt: (v: number) => String(v), allRows: true }).rows;
    const BK = (label: string): string => `bs|${ALL}||${label}`;
    const sumB = (labs: string[]): F => (t) => labs.filter((l) => has(BK(l))).map((l) => R(BK(l), t)).join('+') || '0';
    const sc = (key: string): F => keyF(key);
    const E1 = (l: string): string => `sch|E1||${l}`, SR = (l: string): string => `sch|SR||${l}`, E2 = (l: string): string => `sch|E2||${l}`;
    const rollKeys = [E1('Opening equity'), E1('(+) Cash equity drawdown'), E1('(+) In-Kind equity (land in-kind, non-cash)'), E1('Closing equity (cumulative)'),
      SR('Opening statutory reserve'), SR('(+) Transfer from profit after tax'), SR('Closing statutory reserve'),
      E2('Opening retained earnings'), E2('(+) PAT for the period'), E2('(−) Transfer to statutory reserve'), E2('(−) Dividends declared'), E2('Closing retained earnings')];
    const missingRoll = rollKeys.filter((k) => !has(k));
    if (!bsRefused && missingRoll.length) bsRefused = `the roll-forward row ${missingRoll[0].split('||')[1]} is not on the Balance Sheet`;
    if (!bsRefused && (!has('project:reserveRate') || !has('project:shareCapital') || ((state.project.statutoryReserve?.capOfShareCapital ?? 0) > 0 && !has('project:reserveCap')))) bsRefused = 'the share capital and statutory reserve inputs are not on the Inputs sheet';
    const shareClose = sc(E1('Closing equity (cumulative)'));
    if (!bsRefused) {
      // Equity: the opening (the share capital typed on Inputs before the first year), the cash
      // and in-kind equity drawn, the closing. Every opening is the closing of the year before.
      const cashEq = sumF([keyF('fnc:main:equity'), keyF('fnc:main:feedraw')]);
      writes.push([BS, E1('Opening equity'), (t) => prevOf(shareClose, t), 'first']);
      writes.push([BS, E1('(+) Cash equity drawdown'), cashEq, 'sum']);
      writes.push([BS, E1('(+) In-Kind equity (land in-kind, non-cash)'), keyF('fnc:inkind'), 'sum']);
      if (has(E1('(+) Existing equity (pre-axis carry-forward)'))) writes.push([BS, E1('(+) Existing equity (pre-axis carry-forward)'), () => '0', 'sum']);
      writes.push([BS, E1('Closing equity (cumulative)'), (t) => [E1('Opening equity'), E1('(+) Cash equity drawdown'), E1('(+) In-Kind equity (land in-kind, non-cash)'), E1('(+) Existing equity (pre-axis carry-forward)')].filter(has).map((k) => R(k, t)).join('+'), 'last']);
      // The statutory reserve: the rate of a positive profit after tax, up to the cap on share capital.
      const pat = plF(labels.pat);
      const capPct = (state.project.statutoryReserve?.capOfShareCapital ?? 0) > 0;
      const resOpen = sc(SR('Opening statutory reserve'));
      writes.push([BS, SR('Opening statutory reserve'), (t) => prevOf(sc(SR('Closing statutory reserve')), t), 'first']);
      writes.push([BS, SR('(+) Transfer from profit after tax'), (t) => {
        const transfer = `MAX(0,${pat(t)})*MAX(0,N(${w.ref('project:reserveRate')}))`;
        return capPct ? `MAX(0,MIN(${transfer},${shareClose(t)}*MAX(0,N(${w.ref('project:reserveCap')}))-${resOpen(t)}))` : transfer;
      }, 'sum']);
      writes.push([BS, SR('Closing statutory reserve'), (t) => `${R(SR('Opening statutory reserve'), t)}+${R(SR('(+) Transfer from profit after tax'), t)}`, 'last']);
      // Retained earnings: profit after tax, less the reserve transfer and the dividends.
      writes.push([BS, E2('Opening retained earnings'), (t) => prevOf(sc(E2('Closing retained earnings')), t), 'first']);
      writes.push([BS, E2('(+) PAT for the period'), pat, 'sum']);
      writes.push([BS, E2('(−) Transfer to statutory reserve'), neg(sc(SR('(+) Transfer from profit after tax'))), 'sum']);
      writes.push([BS, E2('(−) Dividends declared'), keyF('fnc:main:div'), 'sum']);
      writes.push([BS, E2('Closing retained earnings'), (t) => [E2('Opening retained earnings'), E2('(+) PAT for the period'), E2('(−) Transfer to statutory reserve'), E2('(−) Dividends declared')].map((k) => R(k, t)).join('+'), 'last']);
    }
    const bsSeen = new Map<string, number>();
    for (const r of bsRows) {
      if (bsRefused) break;
      if (r.isSection && r.values.length === 0) continue;
      const base = BK(r.label); const n = bsSeen.get(base) ?? 0; bsSeen.set(base, n + 1);
      const key = n ? `${base}~${n}` : base;
      if (!has(key)) { bsRefused = `the row "${r.label}" is not where the Balance Sheet put it`; break; }
      const L = r.label;
      let f: F | undefined;
      if (L === 'Land') f = sc('schv:__project__:landClose');
      else if (L.startsWith('Fixed Assets (NBV')) f = sc('schv:__project__:close');
      else if (L === 'Total Fixed Assets') f = sumB(['Land', bsRows.find((x) => x.label.startsWith('Fixed Assets (NBV'))?.label ?? '']);
      else if (L === 'Cash') f = keyF('cf|direct||Closing cash');
      else if (L === 'Accounts Receivable (Operating)') f = opArProject;
      else if (L === 'Residential Sales Receivables') f = resAr;
      else if (L === 'Inventory (Residential WIP)') f = has('schv:A3:close') ? sc('schv:A3:close') : undefined;
      else if (L === 'Restricted Cash (Escrow)') f = escClose;
      else if (L === 'Total Current Assets') f = sumB(['Cash', 'Accounts Receivable (Operating)', 'Residential Sales Receivables', 'Inventory (Residential WIP)', 'Restricted Cash (Escrow)']);
      else if (L === 'TOTAL ASSETS') f = sumB(['Total Fixed Assets', 'Total Current Assets']);
      else if (L === 'Accounts Payable') f = apClose;
      else if (L === 'Unearned Revenue (Off-plan advances)') f = unearned;
      else if (L === `${labels.tax} payable`) f = taxPay;
      else if (L === 'Total Current Liabilities') f = sumB(['Accounts Payable', 'Unearned Revenue (Off-plan advances)', `${labels.tax} payable`]);
      else if (L === 'Debt (long-term)') f = debtBs;
      else if (L === 'TOTAL LIABILITIES') f = sumB(['Total Current Liabilities', 'Debt (long-term)']);
      else if (L === 'Share Capital') f = shareClose;
      else if (L === 'Statutory Reserve') f = sc(SR('Closing statutory reserve'));
      else if (L === 'Retained Earnings') f = sc(E2('Closing retained earnings'));
      else if (L === 'Total Equity') f = sumB(['Share Capital', 'Statutory Reserve', 'Retained Earnings']);
      else if (L === 'TOTAL LIABILITIES + EQUITY') f = sumB(['TOTAL LIABILITIES', 'Total Equity']);
      else if (L.startsWith('BS Check')) f = (t) => `${R(BK('TOTAL ASSETS'), t)}-${R(BK('TOTAL LIABILITIES + EQUITY'), t)}`;
      if (!f) { bsRefused = `no rule for the Balance Sheet row "${L}"`; break; }
      writes.push([BS, key, f, key.includes('||BS Check') ? 'maxabs' as never : 'last']);
    }
    // ── THE RECONCILIATION BRIDGE (2026-09-28): each line the change in ONE balance, through
    // the rule its row above uses; Unexplained is the change in the check row less every line.
    const checkLabel = bsRows.find((x) => x.label.startsWith('BS Check'))?.label;
    const RK = (label: string): string => `bsr|${ALL}||${label}`;
    const bridgeRefused = snap.bs.historicalOpeningCashTotal !== 0 || snap.financing.existing.debtOutstandingTotal !== 0 || snap.financing.existing.equityTotal !== 0;
    const bridge: Array<[string, F]> = [
      ['Net cash flow (Direct = Indirect)', keyF('cf|direct||Net Cash Flow')],
      ['Δ Debt outstanding', neg(delta(debtBs))],
      ['Δ Share capital', neg(delta(shareClose))],
      ['Δ Reserve + Retained earnings', neg(delta(sumF([sc(SR('Closing statutory reserve')), sc(E2('Closing retained earnings'))])))],
      ['Δ Accounts payable', neg(delta(apClose))],
      ['Δ Unearned revenue', neg(delta(unearned))],
      ...(taxLag ? [['Δ Tax payable', neg(delta(taxPay))] as [string, F]] : []),
      ['Δ Restricted cash (escrow)', delta(escClose)],
      ['Δ AR (operating)', delta(opArProject)],
      ['Δ Receivables (residential)', delta(resAr)],
      ['Δ Inventory', delta(sc('schv:A3:close'))],
      ['Δ Fixed assets NBV', delta(sc('schv:__project__:capNbv'))],
      ['Δ Land', delta(sc('schv:__project__:landClose'))],
      ['Δ Capitalised IDC NBV', delta(sc('schv:__project__:idcNbv'))],
    ];
    const bridgeKeys = [...bridge.map(([l]) => RK(l)), RK('= Δ BS difference (this period)'), RK('Unexplained (must be 0)'), RK('BS difference (cumulative)')];
    const bridgeLive = !bsRefused && !bridgeRefused && !!checkLabel && bridgeKeys.every(has);
    if (bridgeLive && checkLabel) {
      const checkF = keyF(BK(checkLabel));
      for (const [label, f] of bridge) writes.push([BS, RK(label), f, 'none' as never]);
      writes.push([BS, RK('= Δ BS difference (this period)'), delta(checkF), 'none' as never]);
      writes.push([BS, RK('Unexplained (must be 0)'), (t) => `${R(RK('= Δ BS difference (this period)'), t)}-(${bridge.map(([l]) => R(RK(l), t)).join('+')})`, 'none' as never]);
      writes.push([BS, RK('BS difference (cumulative)'), checkF, 'none' as never]);
    }
    const bsWrites = bsRefused ? [] : writes.splice(0);

    // ── Write ────────────────────────────────────────────────────────────────
    const apply = (list: Array<[string, string, F, string]>): void => {
      for (const [sheet, key, f, tot] of list) {
        here = sheet;
        const r = w.addr(key).row;
        for (let t = 0; t < N; t++) w.fA({ sheet, row: r, col: pc(t) }, f(t));
        const rng = w.rangeA(sheet, r, pc(0), pc(N - 1));
        const T = { sheet, row: r, col: TOTAL_COL };
        if (tot === 'first') w.fA(T, w.refA({ sheet, row: r, col: pc(0) }, sheet));
        else if (tot === 'last') w.fA(T, w.refA({ sheet, row: r, col: pc(N - 1) }, sheet));
        else if (tot === 'maxabs') w.fA(T, `MAX(ABS(MAX(${rng})),ABS(MIN(${rng})))`);
        // The opening column inside the sum (a blank or text there reads as nothing, as N did).
        else if (tot === 'sum') w.fA(T, `SUM(${w.rangeA(sheet, r, OPEN_COL, pc(N - 1))})`);
      }
    };
    apply(plWrites);
    // The labels that carry a figure.
    // A label the twin printed short (over 60 characters, its bracket cut) stays the twin's words (2026-10-20).
    for (const l of labelWrites) {
      const at = { sheet: l.sheet, row: w.addr(l.key).row, col: LBL_COL };
      const now = wb.getWorksheet(l.sheet)!.getCell(at.row, at.col).value;
      if (typeof now === 'string' && !now.includes('(')) continue;
      w.fA(at, l.formula);
    }
    out.push({ sheet: PL, status: 'live', formulas: w.formulas.get(PL) ?? 0,
      note: 'Live: the income statement, project and per phase, every row one formula across the years over Revenue, Schedules, Opex, Capex and the financing loop, down to profit after tax; the fee and tax labels are formulas too.' });
    if (cfRefused) out.push({ sheet: CF, status: 'values' as const, formulas: 0, note: `The Cash Flow could not be made live for this model: ${cfRefused}.` });
    else {
      apply(cfWrites);
      out.push({ sheet: CF, status: 'live', formulas: w.formulas.get(CF) ?? 0,
        note: 'Live: the direct cash flow (revenue received, the operating receivables, opex paid through the payables, escrow, tax paid, capex per line and land in kind, the financing flows from the loop), the indirect cash flow from profit after tax, and net, opening and closing cash.' });
    }
    if (bsRefused) out.push({ sheet: BS, status: 'values' as const, formulas: 0, note: `The Balance Sheet could not be made live for this model: ${bsRefused}.` });
    else {
      apply(bsWrites);
      // The share capital before the first year: the amount typed on Inputs.
      const ce = w.addr(E1('Closing equity (cumulative)'));
      w.fA({ sheet: BS, row: ce.row, col: OPEN_COL }, `MAX(0,N(${w.ref('project:shareCapital')}))`);
      out.push({ sheet: BS, status: bridgeLive ? 'live' : 'partial', formulas: w.formulas.get(BS) ?? 0,
        note: `Live: every balance, from Schedules, Revenue, Opex, the Cash Flow and the financing loop, the equity, statutory reserve and retained earnings roll-forwards beneath it, and the check row. ${bridgeLive
          ? 'The reconciliation bridge is live too: each line is the change in one balance, read through the same rule as its row above.'
          : 'The reconciliation bridge is the platform\'s values: this model carries balances from before the model starts, which have no cell to read.'}` });
    }
    return out;
  },
};

function colLetter(c: number): string { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }
