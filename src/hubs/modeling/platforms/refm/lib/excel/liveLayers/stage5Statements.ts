/**
 * stage5Statements.ts (2026-09-27), FORMULA-LINKED EXPORT, STAGE 5: THE STATEMENTS.
 *
 * Runs after every earlier layer, since the statements read all of them.
 *
 * THE P&L, project and per phase, as `buildPLRows` builds it, every row a formula:
 *   revenue per line and by section from the Revenue working sheet (a Sell plot
 *   earns its recognition: pre-sales at handover plus sales after it; a hotel by
 *   department; a lease its rent); cost of sales from the Cost of Sales working
 *   sheet; operating expenses per line, by hotel expense group and HQ from the
 *   Opex working sheet; EBITDA; depreciation from the Schedules working sheet;
 *   EBIT; the gain on disposal as the exit proceeds less the book value the
 *   Schedules sheet disposes of; profit before tax; tax at the Inputs sheet's
 *   rate on the profit before tax less the gain (the gain is taxed only where the
 *   project says so); profit after tax.
 *
 * Each group's rows are regenerated in the builder's own order, dropped where the
 * builder drops them (a line with no figure in any year), and matched to the rows
 * the hardcoded build emitted BY LABEL. A label that does not match refuses the
 * layer rather than write a formula on the wrong row.
 *
 * WAITS FOR STAGE 6 (the circular financing), as the platform's values, pending:
 * the fund fees (their base is frozen from a solved pass), interest, the
 * depreciation on capitalised interest and cost of sales (which carries it).
 * WAITS FOR STAGE 7: the exit proceeds (the terminal value, from Returns).
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { isRevenueSubUnit, isLandValueLine } from '@/src/core/calculations';
import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { planRevenueLines, lineForAsset } from '../../revenueLines';
import { buildPLRows, buildDirectCFRows, buildIndirectCFRows, buildBSRows } from '../../reports/m4Reports';
import { planReportLines, lineRowLabel, sumLine } from '../../reports/lineRows';
import { hospitalityStatementsByLine, hospitalityRevenueParts, hospitalityCostParts, HOSPITALITY_COST_GROUPS } from '../../reports/hospitalityStatement';
import { revenueBySection } from '../../reports/revenueSections';
import type { Asset, CostLine } from '../../state/module1-types';
import type { M4Row } from '../../../components/modules/_shared/m4Table';

const PL = 'P&L';
const CALC = 'Statements Calc';
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
    const { TOTAL_COL, OPEN_COL } = PERIOD_COLS;
    const pc = (t: number): number => OPEN_COL + 1 + t;
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);
    const labels = getFinancialLabels(state.project.financialTerminology ?? defaultTerminologyForCountry(state.project.country));
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, state.project);
    const visible = state.assets.filter((a) => a.visible !== false);

    // ── Preconditions ────────────────────────────────────────────────────────
    const refuse: string[] = [];
    if (!has('schg:__project__:dep')) refuse.push('the Schedules working sheet is not live');
    if (!w.reg.keys().some((k) => k.startsWith('oxc:'))) refuse.push('Opex is not live');
    if (!w.reg.keys().some((k) => k.startsWith('rvc:'))) refuse.push('Revenue is not live');
    if (!has('project:taxRate')) refuse.push('the tax rate is not on the Inputs sheet');
    if (refuse.length) return [{ sheet: PL, status: 'values' as const, formulas: 0, note: `The P&L could not be made live for this model: ${refuse.join('; ')}.` }];

    // ── The working sheet: what the loop and Returns still own, pending ─────
    const cs = wb.addWorksheet(CALC, { state: 'hidden' });
    cs.getCell(1, 1).value = 'Statements working sheet: the figures the financing solve (stage 6) and Returns (stage 7) still own, as the platform\'s values, pending. Hidden.';
    const cT = (t: number): number => 4 + t;
    let cr = 3;
    for (let t = 0; t < N; t++) cs.getCell(cr, cT(t)).value = `Year ${t + 1}`;
    cr += 1;
    const C = (r: number, c: number) => ({ sheet: CALC, row: r, col: c });
    const at = (r: number, t: number): string => w.refA(C(r, cT(t)));
    const pendingRow = (key: string, label: string, vals: readonly number[]): number => {
      const r = cr++; cs.getCell(r, 1).value = label; w.claim(key, CALC, r, 1);
      for (let t = 0; t < N; t++) w.valueA(C(r, cT(t)), vals[t] ?? 0, { pending: true });
      return r;
    };
    const interest = pendingRow('stc:interest', 'interest expensed (financing, pending)', snap.pl.interestExpensePerPeriod);
    const proceeds = pendingRow('stc:proceeds', 'exit proceeds (Returns, pending)', Array.from({ length: N }, (_, t) => (snap.disposal.booked && t === snap.disposal.exitIdx ? snap.disposal.proceeds : 0)));
    const feeRows = snap.fundFees.lines.map((l, i) => pendingRow(`stc:fee:${i}`, `${l.label} (fund fee, pending)`, l.amountPerPeriod));
    for (let col = 1; col <= cT(N - 1); col++) cs.getColumn(col).width = col <= 3 ? 26 : 14;

    // ── The pieces, per asset and per project ────────────────────────────────
    const sheetAt = (sheet: string, key: string, t: number): string => w.refA({ sheet, row: w.addr(key).row, col: 4 + t });
    const rv = (key: string, t: number): string => sheetAt('Revenue Calc', key, t);
    const earner = (a: Asset): boolean => state.subUnits.some((u) => u.assetId === a.id && isRevenueSubUnit(u));
    const assetRev = (a: Asset): F => {
      const l = lineForAsset(lines, a.id);
      if (!l || !earner(a)) return () => '0';
      if (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') return has(`rvc:${l.key}:recPre`) ? (t) => `${rv(`rvc:${l.key}:recPre`, t)}+${rv(`rvc:${l.key}:postRev`, t)}` : () => '0';
      if (a.strategy === 'Operate') return has(`rvc:${l.key}:total`) ? (t) => rv(`rvc:${l.key}:total`, t) : () => '0';
      if (a.strategy === 'Lease') return has(`rvc:${l.key}:rev`) ? (t) => rv(`rvc:${l.key}:rev`, t) : () => '0';
      return () => '0';
    };
    const assetCos = (a: Asset): F => (has(`cosc:${a.id}:cos`) ? (t) => sheetAt('Cost of Sales Calc', `cosc:${a.id}:cos`, t) : () => '0');
    const assetOpex = (a: Asset): F => (has(`oxc:${a.id}:total`) ? (t) => sheetAt('Opex Calc', `oxc:${a.id}:total`, t) : () => '0');
    const sumF = (fs: F[]): F => (t) => fs.map((f) => f(t)).join('+') || '0';
    const neg = (f: F): F => (t) => `-(${f(t)})`;
    const hq: F = (t) => sheetAt('Opex Calc', 'oxc:hq:total', t);
    const projDep: F = (t) => `${sheetAt('Schedules Calc', 'schg:__project__:dep', t)}${has('schg:__project__:idcDep') ? `+${sheetAt('Schedules Calc', 'schg:__project__:idcDep', t)}` : ''}`;
    const disposed: F = (t) => ['schg:__project__:land:disp', 'schg:__project__:cap:disp', 'schg:__project__:idc:disp'].filter(has).map((k) => sheetAt('Schedules Calc', k, t)).join('+') || '0';

    // ── Match the builder's rows to formulas ─────────────────────────────────
    const cell = (key: string, t: number): string => w.refA({ sheet: PL, row: w.addr(key).row, col: pc(t) });
    // Every formula is COLLECTED first and written only once the whole statement has
    // matched, so a refusal leaves the sheet exactly as the platform printed it.
    const writes: Array<[string, F]> = [];
    const writeRow = (key: string, f: F): void => { writes.push([key, f]); };
    const applyRow = (key: string, f: F): void => {
      const r = w.addr(key).row;
      for (let t = 0; t < N; t++) w.fA({ sheet: PL, row: r, col: pc(t) }, f(t));
      w.fA({ sheet: PL, row: r, col: TOTAL_COL }, `SUM(${w.rangeA(PL, r, pc(0), pc(N - 1))})+N(${w.refA({ sheet: PL, row: r, col: OPEN_COL })})`);
    };
    const nonZero = (v: readonly number[]): boolean => v.some((x) => x !== 0);
    let refused = '';

    const doView = (phaseId: string): void => {
      const phaseFiltered = phaseId !== ALL;
      const matches = (a: { phaseId: string }): boolean => !phaseFiltered || a.phaseId === phaseId;
      const rows: M4Row[] = buildPLRows({ snap, state, labels, filterPhaseId: phaseId, fmt: (v: number) => String(v), labelFmt: (v: number) => String(v) });
      const residential = visible.filter((a) => (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && matches(a));
      const hosp = visible.filter((a) => a.strategy === 'Operate' && matches(a));
      const retail = visible.filter((a) => a.strategy === 'Lease' && matches(a));
      const hospLines = hospitalityStatementsByLine(snap, state, new Set(hosp.map((a) => a.id)));
      const byId = new Map(state.assets.map((a) => [a.id, a] as const));
      const lineF = (ids: Set<string>, pick: (a: Asset) => F, key: 'revenuePerPeriod' | 'cosPerPeriod' | 'opexPerPeriod'): Array<{ label: string; f: F }> => {
        const out: Array<{ label: string; f: F }> = [];
        for (const line of planReportLines(state, (a) => ids.has(a.id))) {
          if (!nonZero(sumLine(line, (id) => snap.perAssetPL.get(id)?.[key], N))) continue;
          out.push({ label: lineRowLabel(line, state), f: sumF(line.assetIds.map((id) => pick(byId.get(id)!))) });
        }
        return out;
      };
      // The members each group carries, in the builder's order.
      const groups = new Map<string, Array<{ label: string; f: F }>>();
      const heads = new Map<string, F>();
      let totalRev: F = () => '0';
      const secFs: F[] = [];
      for (const sec of revenueBySection(snap, state, matches)) {
        if (!nonZero(sec.values)) continue;
        const inSec = new Set(sec.assetIds);
        const g = `pl-rev-${sec.key}`;
        const f = sumF(sec.assetIds.map((id) => assetRev(byId.get(id)!)));
        heads.set(g, f); secFs.push(f);
        const members: Array<{ label: string; f: F }> = [];
        for (const h of hospLines) {
          if (!h.line.members.some((m) => inSec.has(m.id))) continue;
          const earnerLine = lineForAsset(lines, h.line.members[0].id);
          const parts = hospitalityRevenueParts(h.statement);
          const keyOf = ['rooms', 'fb', 'other'];
          parts.forEach((p, i) => {
            if (!nonZero(p.values)) return;
            const k = earnerLine ? `rvc:${earnerLine.key}:${keyOf[i]}` : '';
            members.push({ label: `${h.line.label}: ${p.label}`, f: k && has(k) ? (t) => rv(k, t) : () => '0' });
          });
        }
        members.push(...lineF(new Set(visible.filter((a) => inSec.has(a.id) && a.strategy !== 'Operate').map((a) => a.id)), assetRev, 'revenuePerPeriod'));
        groups.set(g, members);
      }
      totalRev = sumF(secFs);
      const cosTotal = sumF(residential.map(assetCos));
      heads.set('pl-cos', neg(cosTotal));
      groups.set('pl-cos', lineF(new Set(residential.map((a) => a.id)), assetCos, 'cosPerPeriod').map((m) => ({ label: m.label, f: neg(m.f) })));
      const hospOpex = sumF(hosp.map(assetOpex));
      heads.set('pl-opex-hosp', neg(hospOpex));
      const hospMembers: Array<{ label: string; f: F }> = [];
      for (const h of hospLines) {
        const parts = hospitalityCostParts(h.statement);
        parts.forEach((p, i) => {
          if (!nonZero(p.values)) return;
          const k = `oxc:${h.line.key}:grp:${HOSPITALITY_COST_GROUPS[i]}`;
          hospMembers.push({ label: `${h.line.label}: ${p.label}`, f: has(k) ? neg((t) => sheetAt('Opex Calc', k, t)) : () => '0' });
        });
      }
      groups.set('pl-opex-hosp', hospMembers);
      const retailOpex = sumF(retail.map(assetOpex));
      heads.set('pl-opex-ret', neg(retailOpex));
      groups.set('pl-opex-ret', lineF(new Set(retail.map((a) => a.id)), assetOpex, 'opexPerPeriod').map((m) => ({ label: m.label, f: neg(m.f) })));
      const totalOpex: F = (t) => `${hospOpex(t)}+${retailOpex(t)}+${hq(t)}`;

      // Walk the emitted rows.
      const seen = new Map<string, number>();
      const keyFor = (label: string): string => { const base = `pl|${phaseId}||${label}`; const n = seen.get(base) ?? 0; seen.set(base, n + 1); return n ? `${base}~${n}` : base; };
      const cursor = new Map<string, number>();
      const K = (label: string): string => `pl|${phaseId}||${label}`;
      const feeKeys: string[] = [];
      // A fund fee's label carries its base at the workbook's display scale, so a fee
      // row is found by the fee's own name, the rest of the label being the base.
      const feeOf = (r: M4Row): number => (phaseFiltered || r.indent !== 1 ? -1 : snap.fundFees.lines.findIndex((l, i) => !feeKeys.includes(String(i)) && r.label.startsWith(`${l.label} (`)
        && r.values.length === N && r.values.every((v, t) => Math.abs(v + (l.amountPerPeriod[t] ?? 0)) < 1e-6)));
      for (const r of rows) {
        if (r.isSection && (r.collapseRole !== 'header' || r.values.length === 0)) continue;
        const fee = feeOf(r);
        const key = fee >= 0
          ? (w.reg.keys().find((k) => k.startsWith(`pl|${phaseId}||${snap.fundFees.lines[fee].label} (`)) ?? '')
          : keyFor(r.label);
        if (!has(key)) { refused = `the row "${r.label}" is not where the P&L put it`; return; }
        const g = r.collapseGroup;
        let f: F | undefined;
        if (g && r.collapseRole === 'header') f = heads.get(g);
        else if (g && r.collapseRole === 'member') {
          const i = cursor.get(g) ?? 0; cursor.set(g, i + 1);
          const m = groups.get(g)?.[i];
          if (!m || m.label !== r.label) { refused = `the ${g} rows do not match (${r.label} against ${m?.label ?? 'nothing'})`; return; }
          f = m.f;
        } else if (r.label === 'Total Revenue') f = totalRev;
        else if (r.label.startsWith('HQ Expenses')) f = neg(hq);
        else if (r.label === 'Total Operating Expenses') f = neg(totalOpex);
        else if (r.label === labels.ebitda && phaseFiltered) f = (t) => `${cell(K('Total Revenue'), t)}-(${cosTotal(t)})-(${totalOpex(t)})`;
        else if (!phaseFiltered) {
          if (fee >= 0) { feeKeys.push(String(fee)); f = (t) => `-${at(feeRows[fee], t)}`; }
          else if (r.label === 'Total Fund Management Fee') f = (t) => `-(${feeRows.map((fr) => at(fr, t)).join('+') || '0'})`;
          else if (r.label === labels.ebitda) f = (t) => `${cell(K('Total Revenue'), t)}-(${cosTotal(t)})-(${totalOpex(t)})${has(K('Total Fund Management Fee')) ? `+${cell(K('Total Fund Management Fee'), t)}` : ''}`;
          else if (r.label === 'Depreciation & Amortization') f = neg(projDep);
          else if (r.label === labels.ebit) f = (t) => `${cell(K(labels.ebitda), t)}+${cell(K('Depreciation & Amortization'), t)}`;
          else if (r.label === 'Interest & financing cost') f = (t) => `-${at(interest, t)}`;
          else if (r.label === 'Gain on Disposal of Operating Assets') f = (t) => `${at(proceeds, t)}-(${disposed(t)})`;
          else if (r.label === labels.pbt) f = (t) => `${cell(K(labels.ebit), t)}+${cell(K('Interest & financing cost'), t)}${has(K('Gain on Disposal of Operating Assets')) ? `+${cell(K('Gain on Disposal of Operating Assets'), t)}` : ''}`;
          else if (r.label.startsWith(`${labels.tax} (`)) {
            const gain = (t: number): string => (has(K('Gain on Disposal of Operating Assets')) ? cell(K('Gain on Disposal of Operating Assets'), t) : '0');
            const taxed = state.project.tax?.applyToDisposalGain === true;
            f = (t) => `-MAX(0,${cell(K(labels.pbt), t)}${taxed ? '' : `-${gain(t)}`})*MAX(0,N(${w.ref('project:taxRate')}))`;
          } else if (r.label === labels.pat) {
            const taxKey = w.reg.keys().find((k) => k.startsWith(`pl|${phaseId}||${labels.tax} (`)) as string;
            f = (t) => `${cell(K(labels.pbt), t)}+${cell(taxKey, t)}`;
          }
        }
        if (!f) { refused = `no rule for the P&L row "${r.label}"`; return; }
        writeRow(key, f);
      }
    };
    doView(ALL);
    for (const ph of state.phases) if (!refused && w.reg.keys().some((k) => k.startsWith(`pl|${ph.id}||`))) doView(ph.id);
    if (refused) return [{ sheet: PL, status: 'values' as const, formulas: 0, note: `The P&L could not be made live for this model: ${refused}.` }];
    for (const [key, f] of writes) applyRow(key, f);
    const out: Array<{ sheet: string; status: 'live' | 'partial' | 'values'; note: string; formulas: number }> = [{
      sheet: PL, status: 'partial' as const, formulas: w.formulas.get(PL) ?? 0,
      note: 'Live: the income statement, project and per phase, every row a formula over the Revenue, Cost of Sales, Opex and Schedules working sheets, down to profit after tax at the Inputs sheet\'s rate. The fund fees, interest, the depreciation on capitalised interest and cost of sales (which carries it) come out of the financing and wait for that stage; the exit proceeds wait for Returns. The Fund Fee Basis block is the platform\'s values.',
    }];

    // ── THE CASH FLOW, direct (project and per phase) and indirect ───────────
    const CF = 'Cash Flow';
    const cfWrites: Array<[string, F, 'sum' | 'first' | 'last']> = [];
    let cfRefused = '';
    const plCell = (label: string, t: number): string => w.refA({ sheet: PL, row: w.addr(`pl|${ALL}||${label}`).row, col: pc(t) });
    const plKey = (prefix: string): string | undefined => w.reg.keys().find((k) => k.startsWith(`pl|${ALL}||${prefix}`));
    const P0 = w.addr('cxc:P0').col;
    const cx = (k: string, t: number): string => w.refA({ sheet: 'Capex Calc', row: w.addr(k).row, col: P0 + t });
    const costLineOf = (id: string): Pick<CostLine, 'id' | 'catalogId'> => (state.costLines as CostLine[]).find((x) => x.id === id) ?? { id };
    const capexRowsOf = (a: Asset): { cash: string[]; inKind: string[] } => {
      const keys = w.reg.keys().filter((k) => k.startsWith(`cxc:${a.id}:`) && k.split(':').length === 3);
      const inKind = keys.filter((k) => isLandValueLine(costLineOf(k.split(':')[2])) && w.platformValue({ sheet: 'Capex Calc', row: w.addr(k).row, col: 3 }) === 'percent_of_inkind_land');
      return { cash: keys.filter((k) => !inKind.includes(k)), inKind };
    };
    const capexCash = (a: Asset): F => { const k = capexRowsOf(a).cash; return (t) => k.map((x) => cx(x, t)).join('+') || '0'; };
    const inKindOf = (a: Asset): F => { const k = capexRowsOf(a).inKind; return (t) => k.map((x) => cx(x, t)).join('+') || '0'; };
    const revRcv = (a: Asset): F => ((a.strategy === 'Sell' || a.strategy === 'Sell + Manage')
      ? (has(`rvc:${a.id}:cash`) ? (t) => rv(`rvc:${a.id}:cash`, t) : () => '0')
      : assetRev(a));
    const opexPaid = (a: Asset): F => (has(`oxc:ap:${a.id}:paid`) ? (t) => sheetAt('Opex Calc', `oxc:ap:${a.id}:paid`, t) : () => '0');
    const hqPaid: F = (t) => sheetAt('Opex Calc', 'oxc:ap:hq:paid', t);
    const dso = (): string => `MAX(0,N(${w.ref('project:dso')}))`;
    const arDays = Math.max(1, state.project.operatingAr?.daysPerYear ?? 365);
    const sellEarners = visible.filter((a) => (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && has(`rvc:${a.id}:cash`));
    const lineSeries = (k: string): F => (t) => sellEarners.map((a) => { const l = lineForAsset(lines, a.id); return l && has(`rvc:${l.key}:${k}`) ? rv(`rvc:${l.key}:${k}`, t) : '0'; }).join('+') || '0';
    const resAr = lineSeries('ar');
    const unearned = lineSeries('ur');
    const prevOf = (f: F, t: number): string => (t === 0 ? '0' : f(t - 1));
    const escB = (label: string): string => `esc||B. Escrow Balance Roll-Forward|${label}`;
    const revCell = (key: string, t: number): string => w.refA({ sheet: 'Revenue', row: w.addr(key).row, col: pc(t) });
    const hasEscrow = has(escB('Closing Balance'));
    const escClose: F = (t) => (hasEscrow ? revCell(escB('Closing Balance'), t) : '0');
    const apClose: F = (t) => w.refA({ sheet: 'Opex', row: w.addr('opex|__project__|ap|Closing AP').row, col: pc(t) });
    const pendCf = new Map<string, number>();

    const cfView = (view: string, phaseId: string, rows: M4Row[]): void => {
      const phaseFiltered = phaseId !== ALL;
      const matches = (a: { phaseId: string }): boolean => !phaseFiltered || a.phaseId === phaseId;
      const res = visible.filter((a) => (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && matches(a));
      const hosp = visible.filter((a) => a.strategy === 'Operate' && matches(a));
      const ret = visible.filter((a) => a.strategy === 'Lease' && matches(a));
      const all = [...res, ...hosp, ...ret];
      const byId = new Map(state.assets.map((a) => [a.id, a] as const));
      const cfSeries = (id: string, k: 'revenueReceivedPerPeriod' | 'opexPaidPerPeriod' | 'capex'): number[] | undefined => {
        const cf = snap.perAssetCF.get(id);
        if (!cf) return undefined;
        return k === 'capex' ? cf.capexPerPeriod.map((v, t) => (v ?? 0) - (cf.landInKindPerPeriod[t] ?? 0)) : (cf[k] as number[]);
      };
      const members = (list: Asset[], pick: (a: Asset) => F, k: 'revenueReceivedPerPeriod' | 'opexPaidPerPeriod' | 'capex', sign: 1 | -1): Array<{ label: string; f: F }> => {
        const ids = new Set(list.map((a) => a.id));
        const outM: Array<{ label: string; f: F }> = [];
        for (const line of planReportLines(state, (a) => ids.has(a.id))) {
          if (!nonZero(sumLine(line, (id) => cfSeries(id, k), N))) continue;
          const f = sumF(line.assetIds.map((id) => pick(byId.get(id)!)));
          outM.push({ label: lineRowLabel(line, state), f: sign === 1 ? f : neg(f) });
        }
        return outM;
      };
      const groups = new Map<string, Array<{ label: string; f: F }>>([
        ['cf-rev-res', members(res, revRcv, 'revenueReceivedPerPeriod', 1)], ['cf-rev-hosp', members(hosp, revRcv, 'revenueReceivedPerPeriod', 1)], ['cf-rev-ret', members(ret, revRcv, 'revenueReceivedPerPeriod', 1)],
        ['cf-opex-hosp', members(hosp, opexPaid, 'opexPaidPerPeriod', -1)], ['cf-opex-ret', members(ret, opexPaid, 'opexPaidPerPeriod', -1)],
        ['cf-capex-res', members(res, capexCash, 'capex', -1)], ['cf-capex-hosp', members(hosp, capexCash, 'capex', -1)], ['cf-capex-ret', members(ret, capexCash, 'capex', -1)],
      ]);
      const heads = new Map<string, F>([
        ['cf-rev-res', sumF(res.map(revRcv))], ['cf-rev-hosp', sumF(hosp.map(revRcv))], ['cf-rev-ret', sumF(ret.map(revRcv))],
        ['cf-opex-hosp', neg(sumF(hosp.map(opexPaid)))], ['cf-opex-ret', neg(sumF(ret.map(opexPaid)))],
        ['cf-capex-res', neg(sumF(res.map(capexCash)))], ['cf-capex-hosp', neg(sumF(hosp.map(capexCash)))], ['cf-capex-ret', neg(sumF(ret.map(capexCash)))],
      ]);
      // The operating receivable: on the project's (or this phase's) operating revenue, at the project DSO.
      const opRev = sumF([...hosp, ...ret].map(assetRev));
      const opAr: F = (t) => `MAX(0,${opRev(t)})*${dso()}/${arDays}`;
      const opCash: F = (t) => `MAX(0,${opRev(t)})-(${opAr(t)}-(${prevOf(opAr, t)}))`;
      const inKind = sumF(all.map(inKindOf));
      const cash = sumF(all.map(capexCash));

      const seen = new Map<string, number>();
      const keyFor = (label: string): string => { const base = `cf|${view}||${label}`; const n = seen.get(base) ?? 0; seen.set(base, n + 1); return n ? `${base}~${n}` : base; };
      const K = (label: string): string => `cf|${view}||${label}`;
      const C2 = (label: string, t: number): string => (has(K(label)) ? w.refA({ sheet: CF, row: w.addr(K(label)).row, col: pc(t) }) : '0');
      const sumRows = (labs: string[]): F => (t) => labs.filter((l) => has(K(l))).map((l) => C2(l, t)).join('+') || '0';
      const cursor = new Map<string, number>();
      const financing: string[] = [];
      const operating: string[] = [];
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
        if (g && r.collapseRole === 'header') f = heads.get(g);
        else if (g && r.collapseRole === 'member') {
          const i = cursor.get(g) ?? 0; cursor.set(g, i + 1);
          const m = groups.get(g)?.[i];
          if (!m || m.label !== L) { cfRefused = `the ${g} rows do not match (${L} against ${m?.label ?? 'nothing'})`; return; }
          f = m.f;
        } else if (inIndirectOps) {
          if (L === 'Cash Flow from Operations') f = sumRows([...operating]);
          else {
            operating.push(L);
            if (L === labels.pat) f = (t) => plCell(labels.pat, t);
            else if (L === '(+) Depreciation & Amortization') f = (t) => `-${plCell('Depreciation & Amortization', t)}`;
            else if (L === '(+) Interest expense (add back)') f = (t) => `-${plCell('Interest & financing cost', t)}`;
            else if (L.startsWith('(−) Change in AR')) f = (t) => `-((${opAr(t)}+${resAr(t)})-(${prevOf(opAr, t)}+${prevOf(resAr, t)}))`;
            else if (L === '(+) Cost of sales (add back; capex in investing)') f = (t) => `-${plCell('Residential cost of sales', t)}`;
            else if (L.startsWith('(−) Gain on disposal')) f = (t) => `-${plCell('Gain on Disposal of Operating Assets', t)}`;
            else if (L === '(+) Change in AP') f = (t) => `${apClose(t)}-${prevOf(apClose, t)}`;
            else if (L === '(+) Change in Unearned Revenue') f = (t) => `(${unearned(t)})-(${prevOf(unearned, t)})`;
            else if (L === '(+) Change in Escrow balance') f = (t) => `-((${escClose(t)})-(${prevOf(escClose, t)}))`;
          }
        } else if (L === 'Total Revenue Received') f = (t) => `${sumF(res.map(revRcv))(t)}+${opCash(t)}`;
        else if (L === 'Less: Inaccessible Funds Locked' && !phaseFiltered) f = (t) => `-${revCell(escB('Total Additions'), t)}`;
        else if (L === 'Add: Release of Inaccessible Funds' && !phaseFiltered) f = (t) => `-${revCell(escB('Less: Release of Locked Funds'), t)}`;
        else if (L.startsWith('HQ Expenses')) f = neg(hqPaid);
        else if (L === '= Residential Cash Collection') f = (t) => `${sumF(res.map(revRcv))(t)}-(${sumF(res.map(opexPaid))(t)})`;
        else if (L === '= Hospitality EBITDA') f = (t) => `${sumF(hosp.map(revRcv))(t)}-(${sumF(hosp.map(opexPaid))(t)})`;
        else if (L === '= Retail NOI') f = (t) => `${sumF(ret.map(revRcv))(t)}-(${sumF(ret.map(opexPaid))(t)})`;
        else if (L === 'Total Operating Expenses Paid') f = (t) => `-(${sumF(all.map(opexPaid))(t)})-${hqPaid(t)}`;
        else if (L === 'Fund Management and Other Expenses') f = (t) => `-(${feeRows.map((fr) => at(fr, t)).join('+') || '0'})`;
        else if (L === labels.taxPaid) { const tk = plKey(`${labels.tax} (`); if (tk) f = (t) => w.refA({ sheet: PL, row: w.addr(tk).row, col: pc(t) }); }
        else if (L === 'Cash Flow from Operations') f = sumRows(['Total Revenue Received', 'Less: Inaccessible Funds Locked', 'Add: Release of Inaccessible Funds', 'Total Operating Expenses Paid', 'Fund Management and Other Expenses', labels.taxPaid]);
        else if (L.startsWith('Land In-Kind')) f = neg(inKind);
        else if (L === 'Total Capex') f = (t) => `-(${cash(t)})-(${inKind(t)})`;
        else if (L === 'Proceeds from Disposal of Operating Assets') f = (t) => at(proceeds, t);
        else if (L === 'Cash Flow from Investment') f = sumRows(['Total Capex', 'Proceeds from Disposal of Operating Assets']);
        else if (inFinancing && L.startsWith('In-Kind Equity')) { f = inKind; financing.push(L); }
        else if (inFinancing && L === 'Cash Flow from Financing') f = sumRows([...financing]);
        else if (inFinancing && !['Net Cash Flow', 'Opening cash', 'Closing cash'].includes(L)) {
          // The financing solve owns these (equity, debt, interest paid, dividends): the platform's values, pending.
          const pk = `stc:cf:${L}`;
          if (!pendCf.has(pk)) pendCf.set(pk, pendingRow(pk, `${L} (financing, pending)`, r.values));
          const pr = pendCf.get(pk)!;
          f = (t) => at(pr, t);
          financing.push(L);
        } else if (L === 'Net Cash Flow') f = sumRows(['Cash Flow from Operations', 'Cash Flow from Investment', 'Cash Flow from Financing']);
        else if (L === 'Opening cash') { const o0 = snap.directCF.openingCashPerPeriod[0] ?? 0; f = (t) => (t === 0 ? String(o0) : C2('Closing cash', t - 1)); tot = 'first'; }
        else if (L === 'Closing cash') { f = sumRows(['Opening cash', 'Net Cash Flow']); tot = 'last'; }
        if (!f) { cfRefused = `no rule for the Cash Flow row "${L}"${phaseFiltered ? ` (${phaseId})` : ''}`; return; }
        cfWrites.push([key, f, tot]);
      }
    };
    cfView('direct', ALL, buildDirectCFRows({ snap, state, labels, filterPhaseId: ALL, fmt: (v: number) => String(v) }));
    if (!cfRefused) cfView('indirect', ALL, buildIndirectCFRows({ snap, state, labels, filterPhaseId: ALL, fmt: (v: number) => String(v) }));
    for (const ph of state.phases) if (!cfRefused && w.reg.keys().some((k) => k.startsWith(`cf|${ph.id}||`))) cfView(ph.id, ph.id, buildDirectCFRows({ snap, state, labels, filterPhaseId: ph.id, fmt: (v: number) => String(v) }));
    if (cfRefused) out.push({ sheet: CF, status: 'values' as const, formulas: 0, note: `The Cash Flow could not be made live for this model: ${cfRefused}.` });
    else {
      for (const [key, f, tot] of cfWrites) {
        const r = w.addr(key).row;
        for (let t = 0; t < N; t++) w.fA({ sheet: CF, row: r, col: pc(t) }, f(t));
        const rng = (): string => w.rangeA(CF, r, pc(0), pc(N - 1));
        w.fA({ sheet: CF, row: r, col: TOTAL_COL }, tot === 'first' ? w.refA({ sheet: CF, row: r, col: pc(0) }) : tot === 'last' ? w.refA({ sheet: CF, row: r, col: pc(N - 1) }) : `SUM(${rng()})+N(${w.refA({ sheet: CF, row: r, col: OPEN_COL })})`);
      }
      out.push({
        sheet: CF, status: 'partial' as const, formulas: w.formulas.get(CF) ?? 0,
        note: 'Live: the direct cash flow (revenue received, the operating receivable on the project DSO, opex paid through the payables, tax, capex per line from the Capex working sheet, land in kind), the indirect cash flow from profit after tax, and net, opening and closing cash. The financing flows (equity and debt drawn, repayments, interest paid, dividends) and the fund fees come out of the financing solve and wait for that stage; the exit proceeds wait for Returns.',
      });
    }
    // ── THE BALANCE SHEET ────────────────────────────────────────────────────
    // Land and depreciable NBV from the Schedules working sheet (after the exit
    // write-off), cash from the Cash Flow, the receivables, inventory, escrow,
    // payables and unearned revenue from the working sheets, retained earnings
    // rolled forward from profit after tax less the statutory reserve transfer
    // and the dividends. Debt and share capital come out of the financing solve.
    const BS = 'Balance Sheet';
    const bsWrites: Array<[string, F]> = [];
    let bsRefused = cfRefused ? 'the Cash Flow is not live' : '';
    const bsRows = buildBSRows({ snap, state, labels, filterPhaseId: ALL, fmt: (v: number) => String(v) }).rows;
    const BK = (label: string): string => `bs|${ALL}||${label}`;
    const bsCell = (label: string, t: number): string => w.refA({ sheet: BS, row: w.addr(BK(label)).row, col: pc(t) });
    const hasB = (label: string): boolean => has(BK(label));
    const sumB = (labs: string[]): F => (t) => labs.filter(hasB).map((l) => bsCell(l, t)).join('+') || '0';
    const sc = (key: string): F => (t) => sheetAt('Schedules Calc', key, t);
    const cfCell = (label: string, t: number): string => w.refA({ sheet: CF, row: w.addr(`cf|direct||${label}`).row, col: pc(t) });
    const opArProject: F = (t) => `MAX(0,${sumF(visible.filter((a) => a.strategy === 'Operate' || a.strategy === 'Lease').map(assetRev))(t)})*${dso()}/${arDays}`;
    const debtRow = pendingRow('stc:bs:debt', 'debt outstanding (financing, pending)', snap.bs.debtOutstandingPerPeriod);
    const shareRow = pendingRow('stc:bs:share', 'share capital (financing, pending)', snap.bs.shareCapitalPerPeriod);
    const reserveCapPct = Math.max(0, state.project.statutoryReserve?.capOfShareCapital ?? 0);
    // The reserve: the transfer in force each year and the running balance, on the working sheet.
    const rTransfer = cr++; cs.getCell(rTransfer, 1).value = 'statutory reserve transfer'; w.claim('stc:bs:transfer', CALC, rTransfer, 1);
    const rReserve = cr++; cs.getCell(rReserve, 1).value = 'statutory reserve balance'; w.claim('stc:bs:reserve', CALC, rReserve, 1);
    const rRetained = cr++; cs.getCell(rRetained, 1).value = 'retained earnings'; w.claim('stc:bs:retained', CALC, rRetained, 1);
    const divKey = w.reg.keys().find((k) => k === 'cf|direct||Dividends paid');
    const pat: F = (t) => plCell(labels.pat, t);
    for (let t = 0; t < N; t++) {
      const prevRes = t === 0 ? '0' : at(rReserve, t - 1);
      const transfer = `MAX(0,${pat(t)})*MAX(0,N(${w.ref('project:reserveRate')}))`;
      const cap = reserveCapPct > 0 ? `${at(shareRow, t)}*MAX(0,N(${w.ref('project:reserveCap')}))` : '';
      w.fA(C(rTransfer, cT(t)), cap ? `MAX(0,MIN(${transfer},${cap}-${prevRes}))` : `MAX(0,${transfer})`, { cached: snap.bs.statutoryReserveTransferPerPeriod?.[t] ?? 0 });
      w.fA(C(rReserve, cT(t)), `${prevRes}+${at(rTransfer, t)}`, { cached: snap.bs.statutoryReservePerPeriod[t] ?? 0 });
      w.fA(C(rRetained, cT(t)), `${t === 0 ? '0' : at(rRetained, t - 1)}+${pat(t)}-${at(rTransfer, t)}${divKey ? `+${w.refA({ sheet: CF, row: w.addr(divKey).row, col: pc(t) })}` : ''}`, { cached: snap.bs.retainedEarningsPerPeriod[t] ?? 0 });
    }
    if (!has('project:reserveRate') || (reserveCapPct > 0 && !has('project:reserveCap'))) bsRefused ||= 'the statutory reserve inputs are not on the Inputs sheet';
    const bsSeen = new Map<string, number>();
    for (const r of bsRows) {
      if (bsRefused) break;
      if (r.isSection && r.values.length === 0) continue;
      const base = BK(r.label); const n = bsSeen.get(base) ?? 0; bsSeen.set(base, n + 1);
      const key = n ? `${base}~${n}` : base;
      if (!has(key)) { bsRefused = `the row "${r.label}" is not where the Balance Sheet put it`; break; }
      const L = r.label;
      let f: F | undefined;
      if (L === 'Land') f = sc('schg:__project__:land:adj');
      else if (L.startsWith('Fixed Assets (NBV')) f = (t) => `${sc('schg:__project__:cap:adj')(t)}${has('schg:__project__:idc:adj') ? `+${sc('schg:__project__:idc:adj')(t)}` : ''}`;
      else if (L === 'Total Fixed Assets') f = sumB(['Land', bsRows.find((x) => x.label.startsWith('Fixed Assets (NBV'))?.label ?? '']);
      else if (L === 'Cash') f = (t) => cfCell('Closing cash', t);
      else if (L === 'Accounts Receivable (Operating)') f = opArProject;
      else if (L === 'Residential Sales Receivables') f = resAr;
      else if (L === 'Inventory (Residential WIP)') f = has('schc:A3:close') ? sc('schc:A3:close') : undefined;
      else if (L === 'Restricted Cash (Escrow)') f = escClose;
      else if (L === 'Total Current Assets') f = sumB(['Cash', 'Accounts Receivable (Operating)', 'Residential Sales Receivables', 'Inventory (Residential WIP)', 'Restricted Cash (Escrow)']);
      else if (L === 'TOTAL ASSETS') f = sumB(['Total Fixed Assets', 'Total Current Assets']);
      else if (L === 'Accounts Payable') f = apClose;
      else if (L === 'Unearned Revenue (Off-plan advances)') f = unearned;
      else if (L === 'Total Current Liabilities') f = sumB(['Accounts Payable', 'Unearned Revenue (Off-plan advances)']);
      else if (L === 'Debt (long-term)') f = (t) => at(debtRow, t);
      else if (L === 'TOTAL LIABILITIES') f = sumB(['Total Current Liabilities', 'Debt (long-term)']);
      else if (L === 'Share Capital') f = (t) => at(shareRow, t);
      else if (L === 'Statutory Reserve') f = (t) => at(rReserve, t);
      else if (L === 'Retained Earnings') f = (t) => at(rRetained, t);
      else if (L === 'Total Equity') f = sumB(['Share Capital', 'Statutory Reserve', 'Retained Earnings']);
      else if (L === 'TOTAL LIABILITIES + EQUITY') f = sumB(['TOTAL LIABILITIES', 'Total Equity']);
      else if (L.startsWith('BS Check')) f = (t) => `${bsCell('TOTAL ASSETS', t)}-${bsCell('TOTAL LIABILITIES + EQUITY', t)}`;
      if (!f) { bsRefused = `no rule for the Balance Sheet row "${L}"`; break; }
      bsWrites.push([key, f]);
    }
    if (bsRefused) out.push({ sheet: BS, status: 'values' as const, formulas: 0, note: `The Balance Sheet could not be made live for this model: ${bsRefused}.` });
    else {
      for (const [key, f] of bsWrites) {
        const r = w.addr(key).row;
        for (let t = 0; t < N; t++) w.fA({ sheet: BS, row: r, col: pc(t) }, f(t));
        // Every balance sheet row is a closing balance: its lead cell is the last year,
        // and the check row's is the largest difference in any year, as the platform prints it.
        const rng = w.rangeA(BS, r, pc(0), pc(N - 1));
        w.fA({ sheet: BS, row: r, col: TOTAL_COL }, key.includes('||BS Check') ? `MAX(ABS(MAX(${rng})),ABS(MIN(${rng})))` : w.refA({ sheet: BS, row: r, col: pc(N - 1) }));
      }
      out.push({
        sheet: BS, status: 'partial' as const, formulas: w.formulas.get(BS) ?? 0,
        note: 'Live: every balance, from the Schedules, Revenue, Cost of Sales and Opex working sheets and the Cash Flow, retained earnings rolled forward from profit after tax less the statutory reserve and dividends, and the check row. Debt, share capital and dividends come out of the financing solve and wait for that stage, and until then the check row reads zero only before an input moves. The reconciliation bridge beneath is the platform\'s values.',
      });
    }
    return out;
  },
};
