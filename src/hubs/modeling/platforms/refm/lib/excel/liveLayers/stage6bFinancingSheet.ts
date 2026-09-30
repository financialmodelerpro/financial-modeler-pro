/**
 * stage6bFinancingSheet.ts (2026-09-27), FORMULA-LINKED EXPORT, STAGE 6b: THE FINANCING SHEET.
 *
 * Stage 6a solves the financing live on a hidden working sheet. This layer makes
 * the visible Financing sheet, all four sub-tabs, formulas over that solve: the
 * summary tiles, the funding basis, land funding by phase, the facility's rate,
 * the capex breakdown, the funding requirement by method, the debt and equity
 * required, the debt movement, combined debt service, the finance cost ledger,
 * capitalised interest by line (and where it is routed), the equity movement,
 * the Method 2 and Method 3 funding gap tables, the cash waterfall and the
 * per-facility sweep. Inputs stay inputs; every other figure is a formula.
 *
 * Rows are found by their registered key (fin|<section>|<label>), a label that
 * carries a figure (a line's land share in the IDC allocation) by its line, and a
 * row this layer has no rule for REFUSES the sheet rather than stay a value
 * beside live ones.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { isLandValueLine } from '@/src/core/calculations';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { planRevenueLines, lineForAsset } from '../../revenueLines';
import { planReportLines, lineTitle } from '../../reports/lineRows';
import type { Asset, CostLine, Phase } from '../../state/module1-types';
import { operatingCashClass } from '../../reports/financingReports';

const FIN = 'Financing';
const CALC = 'Financing Calc';

type F = (t: number) => string;
type Tot = 'sum' | 'last' | 'first' | 'none' | ((range: string) => string);

export const stage6bFinancingSheet: LiveLayer = {
  name: 'stage 6b: the Financing sheet',
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
    if (!has('fnc:main:interest')) return [{ sheet: FIN, status: 'values' as const, formulas: 0, note: 'The Financing sheet stays the platform\'s values: the financing solve is not live for this model.' }];
    const phases = state.phases as Phase[];
    const visible = state.assets.filter((a) => a.visible !== false);
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, state.project);
    const lineState = { assets: state.assets, phases: state.phases, parcels: state.parcels };
    // EVERY FACILITY HAS ITS OWN ROWS (2026-09-28, stages B and C): the solve writes
    // fnc:main:tr:<id>:* per loan beside the totals every other table reads.
    const tranches = state.financingTranches ?? [];
    const esc = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const T = (id: string, s: string) => (t: number): string => calc(`fnc:main:tr:${id}:${s}`, t);

    // ── Readers ──────────────────────────────────────────────────────────────
    const calc = (key: string, t: number): string => w.refA({ sheet: CALC, row: w.addr(key).row, col: 4 + t });
    const calcRng = (key: string): string => w.rangeA(CALC, w.addr(key).row, 4, 4 + N - 1);
    const sc3 = (key: string): string => w.refA({ sheet: CALC, row: w.addr(key).row, col: 3 });
    const M = (s: string) => (t: number): string => calc(`fnc:main:${s}`, t);
    const S = (s: string) => (t: number): string => calc(`fnc:${s}`, t);
    const neg = (f: F): F => (t) => `-(${f(t)})`;
    const add = (...fs: F[]): F => (t) => fs.map((f) => f(t)).join('+') || '0';
    const prevOf = (f: F, t: number, first = '0'): string => (t === 0 ? first : f(t - 1));
    const MIN = (): string => sc3('fnc:min');
    const P0 = w.addr('cxc:P0').col;
    const cx = (k: string, t: number): string => w.refA({ sheet: 'Capex Calc', row: w.addr(k).row, col: P0 + t });
    const costLineOf = (id: string): Pick<CostLine, 'id' | 'catalogId'> => (state.costLines as CostLine[]).find((x) => x.id === id) ?? { id };
    const capexKeys = (a: Asset): string[] => w.reg.keys().filter((k) => k.startsWith(`cxc:${a.id}:`) && k.split(':').length === 3);
    const isInKind = (k: string): boolean => w.platformValue({ sheet: 'Capex Calc', row: w.addr(k).row, col: 3 }) === 'percent_of_inkind_land';
    const landCashOf = (list: Asset[]): F => { const ks = list.flatMap(capexKeys).filter((k) => isLandValueLine(costLineOf(k.split(':')[2])) && !isInKind(k)); return (t) => ks.map((k) => cx(k, t)).join('+') || '0'; };
    const landInKindOf = (list: Asset[]): F => { const ks = list.flatMap(capexKeys).filter((k) => isLandValueLine(costLineOf(k.split(':')[2])) && isInKind(k)); return (t) => ks.map((k) => cx(k, t)).join('+') || '0'; };
    const inPhase = (p: Phase): Asset[] => visible.filter((a) => a.phaseId === p.id);
    const landCash = landCashOf(visible);
    const nonLand: F = (t) => `MAX(0,${S('capexall')(t)}-(${landCash(t)})-${S('inkind')(t)})`;
    const exclLandInKind: F = (t) => `${nonLand(t)}+${landCash(t)}`;
    const debtSplit = M('debt'), equityDev = M('equity'), feeDraw = M('feedraw'), draw = M('draw'), idcDraw = M('idcdraw'), interest = M('interest');
    const sweep = M('sweep'), sched = M('sched'), bal = M('bal'), repay = M('repay'), netReq = M('netreq'), divT = M('div'), closeCash = M('close'), cfo = M('cfo'), cfi = S('cfi');
    const intExp = M('intexp'), fromCash = M('fromcash'), inKind = S('inkind');
    const feeByEquity = state.project.fundTerms?.enabled === true && state.project.fundTerms?.managementFeeFunding === 'equity';
    const feeTotal: F = (t) => { const ks = w.reg.keys().filter((k) => /^fnc:fee:\d+$/.test(k)); return ks.map((k) => calc(k, t)).join('+') || '0'; };
    const gapTot = (): string => sc3('fnc:main:gaptot');
    // THE SELECTED METHOD'S REQUIREMENT (computeFundingRequirement, 2026-09-28 stage A):
    // Method 3 the deficit, Method 2 its gap, Method 1 capex; a gap method with no gap
    // falls back to capex. Methods 1 and 2 add the minimum cash buffer in the first
    // capex year; Method 3's deficit already funds up to the minimum.
    const METHOD = (state.project.financing?.fundingMethod ?? 1) as number;
    const gap2 = S('gap2');
    const selected: F = (t) => (METHOD === 3 ? `IF(${gapTot()}>0,${netReq(t)},${exclLandInKind(t)})`
      : METHOD === 2 ? `IF(${sc3('fnc:gap2tot')}>0,${gap2(t)},${exclLandInKind(t)})` : exclLandInKind(t));
    const minAtF: F = (t) => (METHOD === 3 ? '0' : `IF(${t}=${sc3('fnc:main:first')},${MIN()},0)`);
    // A total the sheet already shows is READ from its row, never re-expanded: under
    // Methods 1 and 2 the requirement is a per-year capex sum, and restating it inside the
    // Funding Basis checks built a 9,251-character formula Excel refuses to open (8,192).
    const finTot = (key: string, fallback: () => string): string => (has(key) ? w.refA({ sheet: FIN, row: w.addr(key).row, col: TOTAL_COL }) : fallback());
    const needTotal = (): string => (METHOD === 3 ? `SUM(${calcRng('fnc:main:netreq')})`
      : finTot('fin|7. Funding Requirement|Total Funding Need', () => `(${sumAll(selected)})+${MIN()}`));
    const capexTotal = (): string => finTot('fin|6. Capex Breakdown|Total Capex Incl Cash Land', () => sumAll(exclLandInKind));
    // The waterfall's own cash after funding (opening next year).
    const afterFee: F = (t) => (t + 1 < N ? calc('fnc:main:open', t + 1) : `(${calc('fnc:main:avail', t)}+${netReq(t)}${feeByEquity ? `-(${feeTotal(t)})+${feeDraw(t)}` : ''})`);
    const sellEarners = visible.filter((a) => (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && has(`rvc:${a.id}:cash`));
    const presalesGross: F = (t) => sellEarners.map((a) => { const l = lineForAsset(lines, a.id); return l && has(`rvc:${l.key}:cashPre`) ? w.refA({ sheet: 'Revenue Calc', row: w.addr(`rvc:${l.key}:cashPre`).row, col: 4 + t }) : '0'; }).join('+') || '0';
    const escB = (label: string): string => `esc||B. Escrow Balance Roll-Forward|${label}`;
    const revCell = (key: string, t: number): string => w.refA({ sheet: 'Revenue', row: w.addr(key).row, col: pc(t) });
    const escHeld: F = (t) => (has(escB('Total Additions')) ? revCell(escB('Total Additions'), t) : '0');
    const escRelease: F = (t) => (has(escB('Less: Release of Locked Funds')) ? `-(${revCell(escB('Less: Release of Locked Funds'), t)})` : '0');
    const presalesNet: F = (t) => `(${presalesGross(t)})-(${escHeld(t)})+(${escRelease(t)})`;
    const capexCash = S('capex');
    const methodA: F = (t) => `MAX(0,${capexCash(t)}-${t === 0 ? '0' : `(${presalesNet(t - 1)})`})`;
    // Per-asset cash flow classes (the Method 3 table's operating inflows).
    const rv = (key: string, t: number): string => w.refA({ sheet: 'Revenue Calc', row: w.addr(key).row, col: 4 + t });
    const assetRev = (a: Asset): F => {
      const l = lineForAsset(lines, a.id);
      if (!l || !state.subUnits.some((u) => u.assetId === a.id)) return () => '0';
      if (a.strategy === 'Operate') return has(`rvc:${l.key}:total`) ? (t) => rv(`rvc:${l.key}:total`, t) : () => '0';
      if (a.strategy === 'Lease') return has(`rvc:${l.key}:rev`) ? (t) => rv(`rvc:${l.key}:rev`, t) : () => '0';
      return has(`rvc:${a.id}:cash`) ? (t) => rv(`rvc:${a.id}:cash`, t) : () => '0';
    };
    const opexPaid = (a: Asset): F => (has(`oxc:ap:${a.id}:paid`) ? (t) => w.refA({ sheet: 'Opex Calc', row: w.addr(`oxc:ap:${a.id}:paid`).row, col: 4 + t }) : () => '0');
    const classOf = (pick: (a: Asset) => boolean): F => (t) => visible.filter(pick).map((a) => `(${assetRev(a)(t)})-(${opexPaid(a)(t)})`).join('+') || '0';
    // The one classifier (operatingCashClass), by strategy: a Lease retail strip is retail, not hospitality.
    const resColl = classOf((a) => operatingCashClass(a) === 'residential');
    const hospEb = classOf((a) => operatingCashClass(a) === 'hospitality');
    const retNoi = classOf((a) => operatingCashClass(a) === 'retail');
    const opIn: F = (t) => `${cfo(t)}${feeByEquity ? `+(${feeTotal(t)})` : ''}`;
    // Capitalised interest by line.
    const idcOf = (ids: readonly string[]): F => (t) => ids.filter((id) => has(`fnc:main:idc:${id}`)).map((id) => calc(`fnc:main:idc:${id}`, t)).join('+') || '0';
    const idcLines = planReportLines(lineState, (a) => snap.idc.byAsset.has(a.id));
    const heldIds = (ids: readonly string[]): boolean => ids.some((id) => { const a = state.assets.find((x) => x.id === id); return a?.strategy === 'Operate' || a?.strategy === 'Lease'; });

    // ── Rules: section, label -> formula and Total ───────────────────────────
    const rules: Array<{ match: (sec: string, label: string) => boolean; f?: F; scalar?: () => string; tot?: Tot }> = [];
    const R = (sec: string | RegExp, label: string | RegExp, rule: { f?: F; scalar?: () => string; tot?: Tot }): void => {
      rules.push({ match: (s, l) => (typeof sec === 'string' ? s === sec : sec.test(s)) && (typeof label === 'string' ? l === label : label.test(l)), ...rule });
    };
    const sumAll = (f: F): string => Array.from({ length: N }, (_, t) => f(t)).join('+');
    // Summary.
    // buildFinancingSummary (2026-09-29): debt RAISED (capex and IDC drawdowns), equity RAISED (cash for
    // development and fees, in kind) and every unit of capitalised interest, not the sizing split.
    const sumDebt = (): string => `SUM(${calcRng('fnc:main:draw')})+SUM(${calcRng('fnc:main:idcdraw')})`;
    const sumEquity = (): string => `SUM(${calcRng('fnc:main:equity')})+SUM(${calcRng('fnc:main:feedraw')})+SUM(${calcRng('fnc:inkind')})`;
    R('Summary', 'Total Funding', { scalar: () => `${sumDebt()}+${sumEquity()}` });
    R('Summary', 'Total Debt', { scalar: sumDebt });
    R('Summary', 'Total Equity', { scalar: sumEquity });
    R('Summary', 'IDC (Construction)', { scalar: () => `SUM(${calcRng('fnc:main:basis')})` });
    // BY ORIGIN (2026-09-29, existing loans): new and existing facilities report apart. An existing
    // loan is never capitalised, so its interest is expensed in full; a new loan's expensed interest is
    // its interest less what was capitalised.
    const hasEx = has('fnc:main:int:existing');
    const O = (o: 'new' | 'existing', s: string): F => (t) => calc(`fnc:main:${s}:${o}`, t);
    const expNew: F = (t) => `${O('new', 'int')(t)}-${calc('fnc:main:basis', t)}`;
    R('Summary', 'Finance Cost (New)', { scalar: () => `SUM(${calcRng('fnc:main:int:new')})` });
    R('Summary', 'Finance Cost (Existing)', { scalar: () => (hasEx ? `SUM(${calcRng('fnc:main:int:existing')})` : '0') });
    R('8. Total Debt Required', 'Existing Debt (opening balance, pre-axis)', { f: () => '0' });
    // 3. Funding Basis.
    R('3. Funding Basis', 'Total Capex (excl Land In-Kind)', { scalar: capexTotal });
    R('3. Funding Basis', 'Total Funding Need', { scalar: needTotal });
    R('3. Funding Basis', 'Funded from Project Cash', { scalar: () => `(${capexTotal()})+${MIN()}-(${needTotal()})` });
    R('3. Funding Basis', 'Sources vs Uses', { scalar: () => {
      const src = `(SUM(${calcRng('fnc:main:debt')})+SUM(${calcRng('fnc:main:equity')}))`, need = needTotal();
      return `IF(ABS(${src}-${need})<1,"Match ("&TEXT(ROUND(${src},0),"#,##0")&")","Gap "&TEXT(ROUND(${src}-${need},0),"#,##0"))`;
    } });
    // 4. Land funding by phase.
    for (const p of phases) {
      R('4. Land Funding (per phase, from the Capex results)', `${p.name}, Land Cash (Capex Table 5)`, { f: landCashOf(inPhase(p)) });
      R('4. Land Funding (per phase, from the Capex results)', `${p.name}, Land In-Kind (Capex Table 5)`, { f: landInKindOf(inPhase(p)) });
    }
    R('4. Land Funding (per phase, from the Capex results)', 'Total, Land Cash', { f: landCash });
    R('4. Land Funding (per phase, from the Capex results)', 'Total, Land In-Kind', { f: landInKindOf(visible) });
    // 5. The facility's rate.
    for (const tr of tranches) R(`${tr.name} (${tr.origin === 'existing' ? 'existing' : 'new'} facility)`, 'Interest Rate %', { scalar: () => sc3(has(`fnc:tr:${tr.id}:rate`) ? `fnc:tr:${tr.id}:rate` : 'fnc:rate') });
    // 6. Capex breakdown.
    R('6. Capex Breakdown', 'Capex (excluding Land)', { f: nonLand });
    R('6. Capex Breakdown', 'Land Cash Value', { f: landCash });
    R('6. Capex Breakdown', 'Total Capex Incl Cash Land', { f: exclLandInKind });
    // 7. Funding requirement.
    R('7. Funding Requirement', 'Method 1, Fixed Debt-to-Equity Ratio', { f: exclLandInKind });
    R('7. Funding Requirement', 'Method 2, Net Funding Requirement', { f: methodA });
    R('7. Funding Requirement', 'Method 3, Cash Deficit Funding', { f: netReq });
    R('7. Funding Requirement', 'Method 4, Specified Debt + Equity (manual)', { f: () => '0' });
    R('7. Funding Requirement', /^Selected \(Method \d\)$/, { f: selected });
    R('7. Funding Requirement', '+ Minimum Cash Reserve', { f: minAtF });
    R('7. Funding Requirement', 'Total Funding Need', { f: add(selected, minAtF) });
    // 8 and 9. Debt and equity required.
    for (const tr of tranches) R('8. Total Debt Required', tr.name, { f: T(tr.id, 'draw') });
    R('8. Total Debt Required', 'Capex Drawdown Subtotal', { f: debtSplit });
    R('8. Total Debt Required', 'IDC Drawdown (capitalized interest)', { f: idcDraw });
    R('8. Total Debt Required', 'Total Debt Required (new draws + IDC)', { f: add(debtSplit, idcDraw) });
    R('9. Total Equity Required', /^Cash Equity(, development.*)?$/, { f: equityDev });
    R('9. Total Equity Required', 'In-Kind Equity', { f: inKind });
    R('9. Total Equity Required', /^Cash Equity, fund management fee/, { f: feeDraw });
    R('9. Total Equity Required', 'Total Equity Required', { f: add(equityDev, feeDraw, inKind) });
    // Debt movement, combined debt service, finance cost.
    for (const tr of tranches) {
      // With more than one facility the title carries its share: "Senior debt (60% of the project facility)".
      const DM = new RegExp(`^Debt Movement, ${esc(tr.name)}( \\(.*\\))?$`);
      const tb = T(tr.id, 'bal'), td = T(tr.id, 'draw'), ti = T(tr.id, 'idc');
      R(DM, 'Opening', { f: (t) => prevOf(tb, t), tot: 'last' });
      R(DM, 'Capex Drawdown', { f: td });
      R(DM, 'IDC Drawdown (capitalized interest)', { f: ti });
      R(DM, 'Total Drawdown', { f: add(td, ti) });
      R(DM, /^Principal Repaid/, { f: neg(add(T(tr.id, 'sched'), T(tr.id, 'sweep'))) });
      R(DM, 'Closing', { f: tb, tot: 'last' });
    }
    R('Combined Debt Service', 'Total Capex Drawdown', { f: draw });
    R('Combined Debt Service', 'Total IDC Drawdown', { f: idcDraw });
    R('Combined Debt Service', 'Total Drawdown (Capex + IDC)', { f: add(draw, idcDraw) });
    R('Combined Debt Service', /^(Total )?Interest Expensed$/, { f: neg(intExp) });
    R('Combined Debt Service', 'Interest Expensed - New', { f: neg(expNew) });
    R('Combined Debt Service', 'Interest Expensed - Existing', { f: neg(O('existing', 'int')) });
    R('Combined Debt Service', 'Total Principal Repaid', { f: neg(add(sched, sweep)) });
    R('Combined Debt Service', /^Principal Repaid - New/, { f: neg(O('new', 'princ')) });
    R('Combined Debt Service', /^Principal Repaid - Existing/, { f: neg(O('existing', 'princ')) });
    R('Combined Debt Service', '  of which repaid by cash sweep', { f: neg(sweep) });
    R('Combined Debt Service', '  of which scheduled amortisation', { f: neg(sched) });
    R('Combined Debt Service', 'Total Debt Service (Cash)', { f: neg(add(interest, sched, sweep)) });
    R('Combined Debt Service', 'Debt Service - New', { f: neg(add(O('new', 'int'), O('new', 'princ'))) });
    R('Combined Debt Service', 'Debt Service - Existing', { f: neg(add(O('existing', 'int'), O('existing', 'princ'))) });
    R('Combined Debt Service', 'Scheduled Debt Service (covenant basis)', { f: neg(add(interest, sched)) });
    for (const tr of tranches) {
      const FC = new RegExp(`^Finance Cost, ${esc(tr.name)}( \\(.*\\))?$`);
      R(FC, 'Opening', { f: () => '0', tot: 'last' });
      R(FC, 'Charge (Accrued)', { f: T(tr.id, 'int') });
      R(FC, 'Paid', { f: neg(T(tr.id, 'int')) });
      R(FC, '(memo) of which funded by drawing debt', { f: T(tr.id, 'idc') });
      R(FC, 'Closing', { f: () => '0', tot: 'last' });
    }
    // With more than one facility the sheet adds the combined ledger, every facility's in one.
    const CFC = 'Combined Finance Cost (all facilities)';
    R(CFC, 'Opening', { f: () => '0', tot: 'last' });
    R(CFC, /^Charge \(Accrued/, { f: interest });
    R(CFC, 'Paid', { f: neg(interest) });
    R(CFC, '(memo) of which funded by drawing debt', { f: idcDraw });
    R(CFC, 'Closing', { f: () => '0', tot: 'last' });
    // Capitalised interest by line and where it goes.
    const IDC = /^IDC Allocation, by Line/;
    for (const l of idcLines) {
      const title = lineTitle(l, lineState);
      const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      R(IDC, new RegExp(`^${esc} \\(Land `), { f: idcOf(l.assetIds) });
      R(/^Routed to CoS via Inventory/, title, { f: idcOf(l.assetIds) });
      R(/^Routed to Fixed Assets/, `${title} (Additions)`, { f: idcOf(l.assetIds) });
    }
    R(IDC, 'Total IDC (allocated to assets)', { f: M('basis') });
    R(IDC, /^(Memo: Total construction interest \(accrual\)|Total construction interest to P&L Finance Cost)$/, { f: M('basis') });
    const sellIdc = idcLines.filter((l) => !heldIds(l.assetIds)).flatMap((l) => l.assetIds);
    const heldIdc = idcLines.filter((l) => heldIds(l.assetIds)).flatMap((l) => l.assetIds);
    R(/^Routed to CoS via Inventory/, 'Subtotal: Sell IDC to CoS', { f: idcOf(sellIdc) });
    R(/^Routed to Fixed Assets/, 'Subtotal: Operate/Lease IDC to Fixed Assets', { f: idcOf(heldIdc) });
    R(/^Routed to Fixed Assets/, 'Operate/Lease IDC Depreciation (charge to D&A)', { f: neg(M('idcdep')) });
    R(/^Routed to Fixed Assets/, /^Disposed at Exit/, { f: neg(M('idcdisp')) });
    R(/^Routed to Fixed Assets/, /^Operate\/Lease IDC NBV/, { f: (t) => `${M('idcnbv')(t)}-${M('idcdisp')(t)}`, tot: 'last' });
    // Equity movement.
    const eqClose: F = (t) => `SUM(${w.rangeA(CALC, w.addr('fnc:main:equity').row, 4, 4 + t)})+SUM(${w.rangeA(CALC, w.addr('fnc:main:feedraw').row, 4, 4 + t)})+SUM(${w.rangeA(CALC, w.addr('fnc:inkind').row, 4, 4 + t)})`;
    R('Equity Movement', 'Opening (incl. existing carry-forward)', { f: (t) => prevOf(eqClose, t), tot: 'last' });
    R('Equity Movement', /^Cash Contribution(, development)?$/, { f: equityDev });
    R('Equity Movement', 'Cash Contribution, fund management fee', { f: feeDraw });
    R('Equity Movement', 'In-Kind Contribution', { f: inKind });
    R('Equity Movement', 'Closing (cumulative equity)', { f: eqClose, tot: 'last' });
    // Method 2.
    const M2 = 'Method 2, Net Funding Requirement (Capex vs Pre-Sales)';
    R(M2, 'Total project capex (excl land in-kind)', { f: capexCash });
    R(M2, 'Advance received from customer (gross)', { f: presalesGross });
    R(M2, 'Less: Inaccessible funds locked (escrow held)', { f: neg(escHeld) });
    R(M2, 'Add: Release of inaccessible funds (escrow release)', { f: escRelease });
    R(M2, 'Advance received from customer (net)', { f: presalesNet });
    R(M2, /^Funding requirement fulfilled by pre-sales/, { f: (t) => `MIN(${capexCash(t)},MAX(0,${t === 0 ? '0' : `(${presalesNet(t - 1)})`}))` });
    R(M2, /^Funding gap = MAX/, { f: methodA });
    R(M2, 'Cumulative Funding Gap (A)', { f: (t) => Array.from({ length: t + 1 }, (_, u) => methodA(u)).join('+'), tot: 'last' });
    // Method 3.
    const M3 = 'Method 3, Cash Deficit Funding (Drawdown Sizing)';
    R(M3, 'Cash Capex (construction, land cash, RETT)', { f: neg(cfi) });
    R(M3, 'Residential cash collection', { f: resColl });
    R(M3, 'Hospitality EBITDA', { f: hospEb });
    R(M3, 'Retail NOI', { f: retNoi });
    R(M3, '(-) Fund management fee', { f: neg(feeTotal) });
    R(M3, 'Other operating cash (HQ, tax, escrow movements)', { f: (t) => `(${opIn(t)})-(${resColl(t)})-(${hospEb(t)})-(${retNoi(t)})${feeByEquity ? '' : `+(${feeTotal(t)})`}` });
    R(M3, '= Total operating inflows', { f: opIn });
    R(M3, '= Pre-financing net cash (inflows less cash capex)', { f: (t) => `(${opIn(t)})+${cfi(t)}` });
    R(M3, 'Minimum cash target', { f: () => MIN(), tot: 'last' });
    R(M3, 'Opening cash', { f: M('open'), tot: 'last' });
    R(M3, '(+) Existing equity opening', { f: () => '0' });
    R(M3, '(+) Existing debt opening balance', { f: () => '0' });
    R(M3, '= Cash before financing', { f: M('avail'), tot: 'last' });
    R(M3, /^Development funding need = /, { f: netReq });
    // Under Methods 1 and 2 this table is the deficit ILLUSTRATION at the selected
    // method's ratio as typed (the platform's own table), not the draws the model made;
    // under Method 3 the two are the same series.
    // The ratio is the method's NORMALISED share (60 / 30 typed is 66.7% debt), the Calc's.
    const m3Debt: F = METHOD === 3 ? debtSplit : (t) => `${netReq(t)}*${sc3('fnc:dF')}`;
    const m3Equity: F = METHOD === 3 ? equityDev : (t) => `${netReq(t)}*${sc3('fnc:eF')}`;
    R(M3, /^Debt draw, base/, { f: m3Debt });
    R(M3, /^Equity draw, base/, { f: m3Equity });
    R(M3, 'Debt Drawdown, capex', { f: m3Debt });
    R(M3, /^Debt Drawdown, IDC/, { f: idcDraw });
    R(M3, '= Total Debt Drawdown', { f: add(m3Debt, idcDraw) });
    R(M3, 'Equity Drawdown, development', { f: m3Equity });
    R(M3, /^Equity Drawdown, fund management fee/, { f: feeDraw });
    R(M3, '= Total Equity Drawdown', { f: add(m3Equity, feeDraw) });
    R(M3, '(-) Fund management fee paid from cash (not drawn)', { f: (t) => `-((${feeTotal(t)})-${feeDraw(t)})` });
    R(M3, /^Closing cash \(after funding/, { f: afterFee, tot: 'last' });
    // Cash waterfall and the sweep.
    const CW = /^Cash Waterfall/;
    const openCash: F = (t) => prevOf(closeCash, t);
    const cashAvail: F = (t) => `${openCash(t)}+${cfo(t)}+${cfi(t)}+${equityDev(t)}+${feeDraw(t)}+${draw(t)}+${idcDraw(t)}-${interest(t)}`;
    R(CW, 'Opening Cash', { f: openCash, tot: 'last' });
    R(CW, '(+) Cash from Operations', { f: cfo });
    R(CW, '(-) Cash from Investing (capex)', { f: cfi });
    R(CW, '(+) Equity Drawdown (Cash)', { f: add(equityDev, feeDraw) });
    R(CW, '(+) Equity In-Kind (memo, non-cash)', { f: inKind });
    R(CW, /^\(\+\) Debt Drawdown/, { f: add(draw, idcDraw) });
    R(CW, '(-) Interest Paid', { f: neg(interest) });
    R(CW, '= Cash Available', { f: cashAvail, tot: 'last' });
    R(CW, /^\(memo\) Minimum Cash Requirement/, { f: () => `-${MIN()}`, tot: () => `-${MIN()}` });
    R(CW, /^\(memo\) Headroom above/, { f: (t) => `${cashAvail(t)}-${MIN()}`, tot: 'last' });
    for (const tr of tranches) R(CW, new RegExp(`^\\(-\\) Debt Paid: ${esc(tr.name)}`), { f: neg(add(T(tr.id, 'sched'), T(tr.id, 'sweep'))) });
    R(CW, '(-) Debt Paid (total principal incl. sweep)', { f: neg(repay) });
    R(CW, '= Cash Available for Dividend', { f: (t) => `${cashAvail(t)}-${repay(t)}`, tot: 'last' });
    R(CW, /^\(-\) Dividend Paid/, { f: neg(divT) });
    R(CW, /^= Closing Cash/, { f: closeCash, tot: 'last' });
    R(CW, '(memo) IDC paid in cash', { f: fromCash });
    R(CW, '(memo) IDC capitalised to debt', { f: idcDraw });
    const X = snap.disposal.exitIdx, booked = snap.disposal.booked;
    const postSweep: F = (t) => (booked && t >= X ? '0' : bal(t));
    for (const tr of tranches) {
      const post: F = (t) => (booked && t >= X ? '0' : T(tr.id, 'bal')(t));
      R('Per-Tranche Debt: Sweep & Outstanding', new RegExp(`^${esc(tr.name)}, Opening \\(pre-sweep\\)$`), { f: (t) => `${post(t)}+${T(tr.id, 'sweep')(t)}`, tot: 'last' });
      R('Per-Tranche Debt: Sweep & Outstanding', new RegExp(`^${esc(tr.name)}, Sweep Applied \\(`), { f: neg(T(tr.id, 'sweep')) });
      R('Per-Tranche Debt: Sweep & Outstanding', new RegExp(`^${esc(tr.name)}, Closing \\(post-sweep\\)$`), { f: post, tot: 'last' });
    }
    R('Per-Tranche Debt: Sweep & Outstanding', 'Project total debt outstanding (post-sweep)', { f: postSweep, tot: 'last' });

    // ── Write, or refuse if a period row has no rule ─────────────────────────
    const INPUT_SECS = ['1. Project Financing Settings', '1b. IDC (Interest During Construction) Policy', '2. Funding Method', '2a. Method 1 Configuration', '2a. Method 2 Configuration', '2a. Method 3 Configuration', 'Cash Sweep Settings', 'Dividend Policy'];
    const writes: Array<() => void> = [];
    const unmatched: string[] = [];
    for (const key of w.reg.keys().filter((k) => k.startsWith('fin|'))) {
      const [, sec, labelRaw] = key.split('|');
      const label = labelRaw.replace(/~\d+$/, '');
      const a = w.addr(key);
      const rule = rules.find((r) => r.match(sec, label));
      if (!rule) {
        // The inputs (their sections, the facility band, a phase's land Debt / Equity %)
        // and text stay as they are; any other figure with no rule refuses the sheet.
        const text = typeof w.platformValue({ sheet: FIN, row: a.row, col: TOTAL_COL }) === 'string';
        const input = INPUT_SECS.includes(sec) || / \((new|existing) facility\)$/.test(sec) || (/^4\. Land Funding/.test(sec) && /(Debt|Equity) %$/.test(label));
        if (!input && !text) unmatched.push(`${sec} / ${label}`);
        continue;
      }
      if (rule.scalar) { const sf = rule.scalar; writes.push(() => w.fA({ sheet: FIN, row: a.row, col: TOTAL_COL }, sf())); continue; }
      const f = rule.f!;
      const tot = rule.tot ?? 'sum';
      writes.push(() => {
        for (let t = 0; t < N; t++) w.fA({ sheet: FIN, row: a.row, col: pc(t) }, f(t));
        const rng = (): string => w.rangeA(FIN, a.row, pc(0), pc(N - 1));
        const totalF = typeof tot === 'function' ? tot(rng())
          : tot === 'sum' ? `SUM(${rng()})+N(${w.refA({ sheet: FIN, row: a.row, col: OPEN_COL })})`
            : tot === 'last' ? w.refA({ sheet: FIN, row: a.row, col: pc(N - 1) })
              : tot === 'first' ? w.refA({ sheet: FIN, row: a.row, col: pc(0) }) : '';
        if (totalF) w.fA({ sheet: FIN, row: a.row, col: TOTAL_COL }, totalF);
      });
    }
    if (unmatched.length) return [{ sheet: FIN, status: 'values' as const, formulas: 0, note: `The Financing sheet stays the platform's values: no rule for ${unmatched.slice(0, 6).join('; ')}${unmatched.length > 6 ? ` and ${unmatched.length - 6} more` : ''}.` }];
    for (const fn of writes) fn();
    return [{
      sheet: FIN, status: 'live' as const, formulas: w.formulas.get(FIN) ?? 0,
      note: 'The financing is solved live on a hidden working sheet (Financing Calc) as circular formulas Excel iterates, the platform\'s fixed point: the fee-free solve that sizes the fund fees, then the real one (the Method 3 deficit, interest paid from the headroom during construction and drawn as debt for the rest, the cash sweep, dividends by phase). Every table here reads it.',
    }];
  },
};
