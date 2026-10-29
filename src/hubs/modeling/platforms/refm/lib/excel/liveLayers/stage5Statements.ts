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

import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';

import { getFinancialLabels, defaultTerminologyForCountry } from '@/src/core/calculations/financials';
import { computeFinancialsSnapshot } from '../../financials-resolvers';

import { planRevenueLines, lineForAsset } from '../../revenueLines';
import { plPlan } from './plPlan';
import { cfPlan } from './cfPlan';
import { buildBSRows } from '../../reports/m4Reports';




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
    if (!has('schv:__project__:dep')) refuse.push('the Schedules fixed asset tables are not live');
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
    const delta = (f: F): F => (t) => `(${f(t)})-(${prevOf(f, t)})`;
    const sumF = (fs: F[]): F => (t) => fs.map((f) => f(t)).join('+') || '0';
    const neg = (f: F): F => (t) => `-(${f(t)})`;
    const keyF = (k: string): F => (has(k) ? (t) => R(k, t) : () => '0');
    const exitF: F = (t) => (booked ? R('tl:flag:exit', t) : '0');

    const expensedKeys = w.reg.keys().filter((k) => k.startsWith('cxe:') && k.split(':').length === 3);
    // A phase charges only the marketing its own plots spent (2026-10-25, m4Reports phaseSellingExpense):
    // the `cxe:<asset>:<line>` rows of the assets in that phase; the project view takes them all.
    const phaseOfAsset = new Map(state.assets.map((a) => [a.id, a.phaseId] as const));

    // ── THE P&L, ROW BY ROW FROM `plPlan` (2026-10-29) ────────────────────────
    // Each line links its source once (a cost is one minus sign), and every subtotal is a SUM of
    // the rows above it. The zakat label carries the rate on Inputs; column B carries each fee's
    // rate (and the zakat rate) as a number linked to Inputs.
    const q = (s: string): string => s.replace(/"/g, '""');
    const labelWrites: Array<{ sheet: string; key: string; formula: string }> = [];
    const writes: Array<[string, string, F, 'sum' | 'first' | 'last']> = [];
    let refused = '';
    /** A subtotal: SUM over a block of rows, or SUM of the rows named. */
    const sumOfF = (keys: string[]): F => (t) => {
      const ks = keys.filter(has);
      if (!ks.length) return '0';
      const rows = ks.map((k) => w.addr(k).row);
      const together = ks.length > 1 && rows.every((r, i) => i === 0 || r === rows[i - 1] + 1);
      return together ? `SUM(${R(ks[0], t)}:${R(ks[ks.length - 1], t)})` : `SUM(${ks.map((k) => R(k, t)).join(',')})`;
    };
    /** A cost: its source rows, negated once. */
    const costOf = (keys: string[]): F => (t) => {
      const ks = keys.filter(has);
      if (!ks.length) return '0';
      return ks.length === 1 ? `-${R(ks[0], t)}` : `-(${ks.map((k) => R(k, t)).join('+')})`;
    };
    const rateWrites: Array<{ key: string; rateKey: string }> = [];
    for (const row of plPlan(state, snap)) {
      if (row.kind !== 'row') continue;
      if (!has(row.key)) { refused = `the row "${row.label}" is not on the P&L`; break; }
      let f: F | undefined;
      if (row.sum) f = sumOfF(row.sum);
      else if (row.src) {
        const s = row.src;
        switch (s.kind) {
          case 'rev': f = keyF(`rvc:${s.line}:recognised`); break;
          case 'cos': f = costOf([`cosc:${s.line}:cos`]); break;
          case 'opex': f = costOf(s.assetIds.map((id) => `oxo:${id}:total`)); break;
          case 'hq': f = costOf(['oxo:hq:total']); break;
          case 'mkt': f = costOf(s.phaseId === ALL && has('cx1e:total') ? ['cx1e:total'] : expensedKeys.filter((k) => s.phaseId === ALL || phaseOfAsset.get(k.split(':')[1]) === s.phaseId)); break;
          case 'fee': f = costOf([`fnc:fee:${s.index}`]); break;
          case 'dep': f = keyF('schv:__project__:dep'); break;
          case 'int': f = keyF('fnc:main:intexp'); break;
          case 'gain': f = keyF('fl:gain'); break;
          case 'tax': f = costOf(['fnc:tax']); break;
          case 'link': f = keyF(s.key); break;
          case 'diff': f = (t) => `${R(s.a, t)}-${R(s.b, t)}`; break;
        }
      }
      if (!f) { refused = `no rule for the P&L row "${row.label}"`; break; }
      writes.push([PL, row.key, f, 'sum']);
      if (row.rateKey) {
        if (!has(row.rateKey)) { refused = `the rate of "${row.label}" is not on Inputs`; break; }
        rateWrites.push({ key: row.key, rateKey: row.rateKey });
      }
      if (row.labelRate && row.rateKey) labelWrites.push({ sheet: PL, key: row.key, formula: `"${q(row.label)}, "&TEXT(N(${w.ref(row.rateKey)}),"0.0%")&" ${q(row.labelRate)}"` });
    }
    if (refused) return [{ sheet: PL, status: 'values' as const, formulas: 0, note: `The P&L could not be made live for this model: ${refused}.` }];
    const plWrites = writes.splice(0);
    const out: Array<{ sheet: string; status: 'live' | 'partial' | 'values'; note: string; formulas: number }> = [];

    // ── THE CASH FLOW, direct (project and per phase) and indirect ───────────
    const plF = (label: string): F => keyF(`pl|${ALL}||${label}`);
    const taxPay: F = taxLag ? keyF('fnc:taxpay') : () => '0';
    const sellEarners = visible.filter((a) => (a.strategy === 'Sell' || a.strategy === 'Sell + Manage') && has(`rvc:${a.id}:cash`));
    const lineSeries = (k: string): F => (t) => sellEarners.map((a) => { const l = lineForAsset(lines, a.id); return l && has(`rvc:${l.key}:${k}`) ? R(`rvc:${l.key}:${k}`, t) : '0'; }).join('+') || '0';
    const resAr = lineSeries('ar');
    const unearned = lineSeries('ur');
    const escB = (label: string): string => `esc||B. Escrow Balance Roll-Forward|${label}`;
    const escClose: F = keyF(escB('Closing Balance'));
    const apClose: F = keyF('ox|ap|close');
    const opArProject: F = (t) => lines.filter((l) => l.form !== 'sell').map((l) => `rvc:${l.key}:opar`).filter(has).map((k) => R(k, t)).join('+') || '0';
    const facs = state.financingTranches ?? [];
    const debtBs: F = has('fnc:main:debtbs') ? keyF('fnc:main:debtbs')
      : (t) => facs.map((f) => `(1-${exitF(t)})*${keyF(`fnc:main:tr:${f.id}:bal`)(t)}`).join('+') || '0';

    let cfRefused = '';
    // ── THE CASH FLOW, ROW BY ROW FROM `cfPlan` (2026-10-29): a statement that only links ──
    // Each line links one row of the tab that works it out (a cost is one minus sign; opex paid is the
    // opex less the rise in its payable, the one working kept here); every subtotal is a SUM of the
    // rows above it; a year-before reference reads the prior column as it stands (no N()).
    {
      const sumOfF = (keys: string[]): F => (t) => {
        const ks = keys.filter(has);
        if (!ks.length) return '0';
        const rows = ks.map((k) => w.addr(k).row);
        const together = ks.length > 1 && rows.every((r, i) => i === 0 || r === rows[i - 1] + 1);
        return together ? `SUM(${R(ks[0], t)}:${R(ks[ks.length - 1], t)})` : `SUM(${ks.map((k) => R(k, t)).join(',')})`;
      };
      /** A cell the year before, as it stands (the opening column holds the balance before the first year). */
      const prev = (key: string, t: number): string => { const a = w.addr(key); return w.refP({ sheet: a.sheet, row: a.row, col: pc(t) - 1 }, here); };
      const costOf = (keys: string[]): F => (t) => {
        const ks = keys.filter(has);
        if (!ks.length) return '0';
        return ks.length === 1 ? `-${R(ks[0], t)}` : `-(${ks.map((k) => R(k, t)).join('+')})`;
      };
      const mktKeys = (phaseId: string | null): string[] => (phaseId === null && has('cx1e:total') ? ['cx1e:total']
        : expensedKeys.filter((k) => phaseId === null || phaseOfAsset.get(k.split(':')[1]) === phaseId));
      here = CF;
      for (const row of cfPlan(state, snap)) {
        if (row.kind !== 'row') continue;
        if (!has(row.key)) { cfRefused = `the row "${row.label}" is not on the Cash Flow`; break; }
        let f: F | undefined;
        if (row.sum) f = sumOfF(row.sum);
        else if (row.src) {
          const s = row.src;
          switch (s.kind) {
            case 'link': if (!has(s.key)) { cfRefused = `"${row.label}" has nothing to link (${s.key})`; break; } f = keyF(s.key); break;
            case 'add': f = (t) => s.keys.filter(has).map((k) => R(k, t)).join('+') || '0'; break;
            case 'cost': if (!s.keys.every(has)) { cfRefused = `"${row.label}" has nothing to link (${s.keys.join(', ')})`; break; } f = costOf(s.keys); break;
            case 'mkt': f = costOf(mktKeys(s.phaseId)); break;
            case 'paid': {
              const ps = s.pairs.filter((x) => has(x.opex) && has(x.close));
              f = (t) => (ps.length ? `-(${ps.map((x) => `${R(x.opex, t)}-${R(x.close, t)}+${prev(x.close, t)}`).join('+')})` : '0');
              break;
            }
            case 'rise': f = (t) => `${s.sign < 0 ? '-' : ''}(${R(s.key, t)}-${prev(s.key, t)})`; break;
            case 'prev': f = (t) => prev(s.key, t); break;
            case 'diff': f = (t) => `${R(s.a, t)}-${R(s.b, t)}`; break;
          }
        }
        if (cfRefused) break;
        if (!f) { cfRefused = `no rule for the Cash Flow row "${row.label}"`; break; }
        writes.push([CF, row.key, f, row.total ?? 'sum']);
      }
    }
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
      // The building NBV less its capitalised interest part (Schedules carries the total and the interest memo).
      ['Δ Fixed assets NBV', delta((t) => `${sc('schv:__project__:close')(t)}${has('schv:__project__:idcNbv') ? `-${sc('schv:__project__:idcNbv')(t)}` : ''}`)],
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
    for (const x of rateWrites) w.fA({ sheet: PL, row: w.addr(x.key).row, col: PERIOD_COLS.META_B }, `N(${w.ref(x.rateKey)})`);
    // The labels that carry a figure.
    for (const l of labelWrites) {
      const at = { sheet: l.sheet, row: w.addr(l.key).row, col: LBL_COL };
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

