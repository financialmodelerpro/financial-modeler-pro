/**
 * stage3Cos.ts (2026-09-27), FORMULA-LINKED EXPORT, STAGE 3b: the rest of Revenue.
 *
 * Runs AFTER Capex and Revenue, since it reads both working sheets.
 *
 *   SELLING COSTS (Revenue section 2, top): each line's marketing and
 *     commission, the rate, the sale revenue it charges on and the cost, and the
 *     year-on-year schedule, read from the Capex working sheet (the one
 *     calculation both tabs show).
 *   COST OF SALES (section 3), per Sell plot as `buildAssetCostOfSales` builds
 *     it: the plot's capex on the project axis plus its capitalised interest is
 *     the base; it is released on the LINE's recognition share (a plot with no
 *     revenue rows releases as its line sells); inventory is cumulative base less
 *     cumulative charge; the vintage matrix spreads each year's base on the same
 *     share. A line is the sum of its plots, its recognition taken once.
 *   SCHEDULES (section 4): the income statement, balance sheet and cash flow
 *     feeds per line; an operating line's receivable is revenue x receivable days
 *     over the days in its year, and its cash is revenue less the movement.
 *   ESCROW (section 5): pre-sales cash held at the effective held % through the
 *     held-until year and released in one sum in the release year.
 *
 * WAITS FOR STAGE 6: capitalised interest comes out of the circular financing.
 * It sits on the working sheet as the platform's value, marked pending, so Cost
 * of Sales and everything built on it (inventory, gross margin, the capex feed)
 * is pending too, and the proof lets those cells lag an input change while
 * every other cell must follow it. The basis sentence heading each Cost of
 * Sales build still states the platform's lifetime figures in words.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { planRevenueLines, REVENUE_SECTIONS, type RevenueLine } from '../../revenueLines';
import { revenueLineName } from '../../reports/revenueOutputReports';
import { buildSellingCostReport } from '../../reports/sellingCostReports';
import { planReportLines } from '../../reports/lineRows';
import type { Asset, Phase } from '../../state/module1-types';

const CALC = 'Cost of Sales Calc';
const REV = 'Revenue';
const CXCALC = 'Capex Calc';

export const stage3Cos: LiveLayer = {
  name: 'stage 3b: selling costs, cost of sales, schedules, escrow',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const raw = ctx.opts.state;
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const snap = computeFinancialsSnapshot(state);
    const N = snap.axisLength;
    const { TOTAL_COL, OPEN_COL } = PERIOD_COLS;
    const pc = (t: number): number => OPEN_COL + 1 + t;
    const w = new LiveWriter(wb, reg, ctx.pending);
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, state.project);
    const phases = state.phases as Phase[];

    // Both working sheets must be live, or this stays values.
    if (!w.has('cxc:P0') || !w.reg.keys().some((k) => k.startsWith('rvc:'))) {
      return [{ sheet: REV, status: 'partial' as const, formulas: 0, note: 'Selling costs, Cost of Sales, Schedules and Escrow stay the platform\'s values: Capex or Revenue is not live for this model.' }];
    }
    const P0 = w.addr('cxc:P0').col;
    const cxP = (row: number, t: number): string => w.refA({ sheet: CXCALC, row, col: P0 + t });
    const rv = (key: string, t: number): string => w.ref(key, 4 + t); // Revenue Calc column of year t
    const has = (k: string): boolean => w.has(k);
    const cell = (key: string, t: number): string => w.refA({ sheet: REV, row: w.addr(key).row, col: pc(t) });
    /** A period row on the Revenue sheet and its Total column, as the platform writes it. */
    const row = (key: string, f: (t: number) => string, total: 'sum' | 'last' | 'none' | ((range: string) => string) = 'sum'): void => {
      if (!has(key)) return;
      const r = w.addr(key).row;
      for (let t = 0; t < N; t++) w.fA({ sheet: REV, row: r, col: pc(t) }, f(t));
      const range = (): string => w.rangeA(REV, r, pc(0), pc(N - 1));
      if (total === 'sum') w.fA({ sheet: REV, row: r, col: TOTAL_COL }, `SUM(${range()})+N(${w.refA({ sheet: REV, row: r, col: OPEN_COL })})`);
      else if (total === 'last') w.fA({ sheet: REV, row: r, col: TOTAL_COL }, w.refA({ sheet: REV, row: r, col: pc(N - 1) }));
      else if (typeof total === 'function') w.fA({ sheet: REV, row: r, col: TOTAL_COL }, total(range()));
    };
    const occ = new Map<string, number>();
    const keyOf = (base: string): string => { const n = occ.get(base) ?? 0; occ.set(base, n + 1); return n ? `${base}~${n}` : base; };
    const lineOfAsset = (id: string): RevenueLine | undefined => lines.find((l) => l.members.some((m) => m.id === id));

    // ── Selling costs: the table and its year-on-year schedule ──────────────
    const sc = buildSellingCostReport({
      revenue: snap.revenue, assets: state.assets, phases: state.phases, costLines: state.costLines,
      costOverrides: state.costOverrides, parcels: state.parcels, landAllocationMode: state.landAllocationMode,
      project: state.project, subUnits: state.subUnits, yearLabels: snap.yearLabels, projectStartYear: snap.revenue.projectStartYear,
    });
    // A selling line's working row: `cxc:` when capitalised (commission), `cxe:` when expensed as incurred
    // (marketing, sellingExpense.ts), as stage 2 keys them (2026-10-08).
    const workingRowOf = (plot: string, lineId: string): string => (has(`cxc:${plot}:${lineId}`) ? `cxc:${plot}:${lineId}` : `cxe:${plot}:${lineId}`);
    if (sc) {
      const costRows: string[] = [];
      for (const d of sc.display) {
        const key = keyOf(`rev|__sell__||${d.label}`);
        if (!has(key)) continue;
        const l = lines.find((x) => x.key === d.lineKey);
        const members = (l?.members ?? []).map((m) => workingRowOf(m.id, d.lineId)).filter(has);
        if (!members.length) continue;
        const r = w.addr(key).row;
        const at = (k: string, col: number): string => w.refA({ sheet: CXCALC, row: w.addr(k).row, col });
        w.fA({ sheet: REV, row: r, col: 5 }, at(members[0], 4));
        w.fA({ sheet: REV, row: r, col: 7 }, members.map((k) => at(k, 5)).join('+'));
        w.fA({ sheet: REV, row: r, col: 8 }, members.map((k) => at(k, 6)).join('+'));
        costRows.push(key);
      }
      if (has('rev|__sell__||Total selling costs')) w.fA({ sheet: REV, row: w.addr('rev|__sell__||Total selling costs').row, col: 8 }, costRows.map((k) => w.refA({ sheet: REV, row: w.addr(k).row, col: 8 })).join('+') || '0');
      occ.clear();
      const yoyRows: string[] = [];
      for (const s of sc.schedule?.rows ?? []) {
        const key = keyOf(`rev|__sell__|Selling Costs|${s.assetName}`);
        const [lineKey, lineId] = s.key.split('::');
        const l = lines.find((x) => x.key === lineKey) ?? lineOfAsset(lineKey);
        const members = (l?.members ?? []).map((m) => workingRowOf(m.id, lineId)).filter(has);
        row(key, (t) => members.map((k) => cxP(w.addr(k).row, t)).join('+') || '0');
        if (has(key)) yoyRows.push(key);
      }
      row('rev|__sell__|Selling Costs|Total selling costs', (t) => yoyRows.map((k) => cell(k, t)).join('+') || '0');
    }

    // ── Cost of Sales, per Sell plot, on its line's recognition ─────────────
    const cs = wb.addWorksheet(CALC, { state: 'hidden' });
    cs.getCell(1, 1).value = 'Cost of Sales working sheet: per Sell plot, the base (capex plus capitalised interest) released on the line\'s recognition share. Capitalised interest waits for the financing stages (pending).';
    const cT = (t: number): number => 4 + t;
    let cr = 3;
    const C = (r: number, c: number) => ({ sheet: CALC, row: r, col: c });
    const at = (r: number, t: number): string => w.refA(C(r, cT(t)));
    const range = (r: number): string => w.rangeA(CALC, r, cT(0), cT(N - 1));
    const newRow = (key: string, label: string, f?: (t: number) => string): number => {
      const r = cr++; cs.getCell(r, 1).value = label; w.claim(key, CALC, r, 1);
      if (f) for (let t = 0; t < N; t++) w.fA(C(r, cT(t)), f(t));
      return r;
    };
    // Which plots have a cost of sales, and which lines they sum into.
    const cosById = snap.byAssetCostOfSales;
    const anyNZ = (a: number[] | undefined): boolean => !!a && a.some((v) => (v ?? 0) !== 0);
    interface LineCos { line: RevenueLine; capex: number; idc: number; base: number; rec: number; share: number; cos: number; pre: number; post: number; inv: number; vint: number[]; totRec: () => string; baseTot: () => string }
    const lineCos = new Map<string, LineCos>();
    for (const l of lines.filter((x) => x.form === 'sell')) {
      const parts = l.members.filter((m) => anyNZ(cosById.get(m.id)?.cos.perPeriod));
      if (!parts.length || !has(`rvc:${l.key}:recPre`)) continue;
      // The line's recognition (total, pre, post): the revenue working sheet's.
      const recRow = newRow(`cosc:${l.key}:rec`, `${revenueLineName(l)}: line recognition`, (t) => `${rv(`rvc:${l.key}:recPre`, t)}+${rv(`rvc:${l.key}:postRev`, t)}`);
      const partRows: Array<{ capex: number; idc: number; base: number; cos: number; pre: number; post: number; inv: number; vint: number[] }> = [];
      for (const m of parts) {
        const calcRows = w.reg.keys().filter((k) => k.startsWith(`cxc:${m.id}:`) && k.split(':').length === 3);
        const capex = newRow(`cosc:${m.id}:capex`, `${m.name}: capex on the axis`, (t) => calcRows.map((k) => cxP(w.addr(k).row, t)).join('+') || '0');
        const idcArr = snap.idc.byAsset.get(m.id)?.idcPerPeriod ?? [];
        const idc = newRow(`cosc:${m.id}:idc`, `${m.name}: capitalised interest (financing, pending)`);
        for (let t = 0; t < N; t++) w.valueA(C(idc, cT(t)), Math.max(0, idcArr[t] ?? 0), { pending: true });
        const base = newRow(`cosc:${m.id}:base`, 'base', (t) => `${at(capex, t)}+${at(idc, t)}`);
        const tot = (): string => `SUM(${range(recRow)})`;
        const B = (): string => `SUM(${range(base)})`;
        const cos = newRow(`cosc:${m.id}:cos`, 'cost of sales', (t) => `IF(AND(${tot()}>0,${B()}>0),${B()}*(MAX(0,${at(recRow, t)})/${tot()}),0)`);
        const pre = newRow(`cosc:${m.id}:pre`, 'on pre-sales', (t) => `IF(${tot()}>0,${B()}*(MAX(0,${rv(`rvc:${l.key}:recPre`, t)})/${tot()}),0)`);
        const post = newRow(`cosc:${m.id}:post`, 'on post-handover', (t) => `IF(${tot()}>0,${B()}*(MAX(0,${rv(`rvc:${l.key}:postRev`, t)})/${tot()}),0)`);
        const inv = newRow(`cosc:${m.id}:inv`, 'inventory', (t) => `SUM(${w.rangeA(CALC, base, cT(0), cT(t))})-SUM(${w.rangeA(CALC, cos, cT(0), cT(t))})`);
        const vint: number[] = [];
        for (let i = 0; i < N; i++) vint.push(newRow(`cosc:${m.id}:v${i}`, `spent in year ${i + 1}`, (t) => `IF(${tot()}>0,${at(base, i)}*(MAX(0,${at(recRow, t)})/${tot()}),0)`));
        partRows.push({ capex, idc, base, cos, pre, post, inv, vint });
      }
      const S = (key: string, label: string, pick: (p: typeof partRows[number]) => number): number => newRow(`cosc:${l.key}:${key}`, label, (t) => partRows.map((p) => at(pick(p), t)).join('+'));
      const capex = S('capex', 'line capex', (p) => p.capex), idc = S('idc', 'line capitalised interest', (p) => p.idc), base = S('base', 'line base', (p) => p.base);
      const cos = S('cos', 'line cost of sales', (p) => p.cos), pre = S('pre', 'line on pre-sales', (p) => p.pre), post = S('post', 'line on post-handover', (p) => p.post), inv = S('inv', 'line inventory', (p) => p.inv);
      const vint: number[] = [];
      for (let i = 0; i < N; i++) vint.push(newRow(`cosc:${l.key}:v${i}`, `line spent in year ${i + 1}`, (t) => partRows.map((p) => at(p.vint[i], t)).join('+')));
      const totRec = (): string => `SUM(${range(recRow)})`;
      const share = newRow(`cosc:${l.key}:share`, 'line recognition share', (t) => `IF(${totRec()}>0,MAX(0,${at(recRow, t)})/${totRec()},0)`);
      lineCos.set(l.key, { line: l, capex, idc, base, rec: recRow, share, cos, pre, post, inv, vint, totRec, baseTot: () => `SUM(${range(base)})` });
    }
    for (let col = 1; col <= cT(N - 1); col++) cs.getColumn(col).width = col <= 3 ? 26 : 14;

    // The visible Cost of Sales tables.
    const K = (l: RevenueLine, table: string, label: string): string => `cos|${l.key}|${table}|${label}`;
    for (const [, lc] of lineCos) {
      const l = lc.line;
      row(K(l, 'Cost of Sales Build', 'Capex, from Module 1'), (t) => at(lc.capex, t));
      row(K(l, 'Cost of Sales Build', 'Capitalised IDC'), (t) => at(lc.idc, t));
      row(K(l, 'Cost of Sales Build', 'Total base charged through cost of sales'), (t) => at(lc.base, t));
      row(K(l, 'Cost of Sales Build', 'Revenue recognised'), (t) => at(lc.rec, t));
      row(K(l, 'Cost of Sales Build', 'Recognition share of lifetime revenue'), (t) => at(lc.share, t));
      row(K(l, 'Cost of Sales Build', 'Cost of Sales, total base x recognition share'), (t) => at(lc.cos, t));
      row(K(l, 'Cost of Sales Build', 'Check, base x share less cost of sales; Total = total base less total cost of sales'),
        (t) => `${lc.baseTot()}*${at(lc.share, t)}-${at(lc.cos, t)}`, () => `${lc.baseTot()}-SUM(${range(lc.cos)})`);
      for (let i = 0; i < N; i++) row(K(l, 'Cost of Sales Vintage Matrix', `Spent in ${snap.yearLabels[i]}`), (t) => at(lc.vint[i], t));
      row(K(l, 'Cost of Sales Vintage Matrix', 'Total'), (t) => lc.vint.map((r) => at(r, t)).join('+'));
      row(K(l, 'Cost of Sales Summary', 'On pre-sales recognition'), (t) => at(lc.pre, t));
      row(K(l, 'Cost of Sales Summary', 'On post-handover sales'), (t) => at(lc.post, t));
      row(K(l, 'Cost of Sales Summary', 'Total Cost of Sales'), (t) => at(lc.cos, t));
      row(K(l, 'Inventory Roll-Forward', 'Opening balance'), (t) => (t === 0 ? '0' : at(lc.inv, t - 1)), 'none');
      row(K(l, 'Inventory Roll-Forward', '(+) Capex (incl. capitalised IDC)'), (t) => at(lc.base, t));
      row(K(l, 'Inventory Roll-Forward', '(-) Cost of Sales'), (t) => `-${at(lc.cos, t)}`);
      row(K(l, 'Inventory Roll-Forward', 'Inventory balance (as carried on the balance sheet)'), (t) => at(lc.inv, t), 'last');
    }
    // The project roll-ups, by section.
    const projTables: Array<[string, (lc: LineCos) => number, string]> = [
      ['Project Cost of Sales', (lc) => lc.pre, 'Total on pre-sales recognition'],
      ['Project Cost of Sales', (lc) => lc.post, 'Total on post-handover sales'],
      ['Project Total Cost of Sales', (lc) => lc.cos, 'Total Cost of Sales'],
    ];
    occ.clear();
    for (const [table, pick, totalLabel] of projTables) {
      const sectionKeys: string[] = [];
      for (const section of REVENUE_SECTIONS) {
        const items = [...lineCos.values()].filter((x) => x.line.section === section);
        if (!items.length) continue;
        const keys: string[] = [];
        for (const lc of items) { const k = keyOf(`cos|__project__|${table}|${revenueLineName(lc.line)}`); row(k, (t) => at(pick(lc), t)); keys.push(k); }
        const tk = keyOf(`cos|__project__|${table}|Total ${section}`);
        row(tk, (t) => keys.filter(has).map((k) => cell(k, t)).join('+') || '0');
        sectionKeys.push(tk);
      }
      row(keyOf(`cos|__project__|${table}|${totalLabel}`), (t) => sectionKeys.filter(has).map((k) => cell(k, t)).join('+') || '0');
    }

    // ── Schedules: the three feeds ───────────────────────────────────────────
    type Feed = { name: string; section: string; revenue: (t: number) => string; cash: (t: number) => string; cosC: (t: number) => string; cosO: (t: number) => string; cosT: (t: number) => string; inv: (t: number) => string; ar: (t: number) => string; ur: (t: number) => string; capex: (t: number) => string };
    const feeds: Feed[] = [];
    const Z = (): string => '0';
    for (const l of lines) {
      const name = revenueLineName(l);
      if (l.form === 'sell' && has(`rvc:${l.key}:recPre`)) {
        const lc = lineCos.get(l.key);
        feeds.push({
          name, section: l.section,
          revenue: (t) => `${rv(`rvc:${l.key}:recPre`, t)}+${rv(`rvc:${l.key}:postRev`, t)}`,
          cash: (t) => `${rv(`rvc:${l.key}:cashPre`, t)}+${rv(`rvc:${l.key}:postRev`, t)}`,
          cosC: lc ? (t) => at(lc.pre, t) : Z, cosO: lc ? (t) => at(lc.post, t) : Z, cosT: lc ? (t) => at(lc.cos, t) : Z,
          inv: lc ? (t) => at(lc.inv, t) : Z,
          ar: (t) => rv(`rvc:${l.key}:ar`, t), ur: (t) => rv(`rvc:${l.key}:ur`, t),
          capex: lc ? (t) => at(lc.base, t) : Z,
        });
      } else if (l.form !== 'sell') {
        const revKey = l.form === 'operate' ? `rvc:${l.key}:total` : `rvc:${l.key}:rev`;
        if (!has(revKey)) continue;
        // The project DSO, the terms the balance sheet uses (revenueOutputReports).
        const dso = (): string => `MAX(0,N(${w.ref('project:dso')}))`;
        const days = (): string => String(Math.max(1, state.project.operatingAr?.daysPerYear ?? 365));
        const close = (t: number): string => `MAX(0,${rv(revKey, t)})*(${dso()}/${days()})`;
        feeds.push({
          name, section: l.section,
          revenue: (t) => rv(revKey, t),
          cash: (t) => `MAX(0,${rv(revKey, t)})-(${close(t)}-${t === 0 ? '0' : close(t - 1)})`,
          cosC: Z, cosO: Z, cosT: Z, inv: Z, ar: close, ur: Z, capex: Z,
        });
      }
    }
    const S1 = 'sched|Income Statement Feed', S2 = 'sched|Balance Sheet Feed', S3 = 'sched|Cash Flow Feed';
    const grouped = (tableKey: string, f: (x: Feed) => (t: number) => string, grandLabel: string, stock: boolean, labelOf: (x: Feed) => string = (x) => x.name, sectionTotals = true): void => {
      occ.clear();
      const tot = stock ? 'last' as const : 'sum' as const;
      const all: string[] = [];
      for (const section of REVENUE_SECTIONS) {
        const items = feeds.filter((x) => x.section === section);
        const keys: string[] = [];
        for (const x of items) { const k = keyOf(`${tableKey}|${labelOf(x)}`); if (!has(k)) continue; row(k, f(x), tot); keys.push(k); }
        if (!keys.length) continue;
        all.push(...keys);
        if (sectionTotals) row(keyOf(`${tableKey}|Total ${section}`), (t) => keys.map((k) => cell(k, t)).join('+'), tot);
      }
      row(`${tableKey}|${grandLabel}`, (t) => feeds.map((x) => f(x)(t)).join('+') || '0', tot);
    };
    grouped(`${S1}|Revenue (P&L)`, (x) => x.revenue, 'Total Revenue', false);
    for (const x of feeds) {
      row(`${S1}|Cost of Sales (P&L)|${x.name}, CoS during construction`, x.cosC);
      row(`${S1}|Cost of Sales (P&L)|${x.name}, CoS during operations`, x.cosO);
      row(`${S1}|Cost of Sales (P&L)|${x.name}, Total Cost of Sales`, x.cosT);
    }
    row(`${S1}|Cost of Sales (P&L)|Total Cost of Sales`, (t) => feeds.map((x) => x.cosT(t)).join('+'));
    row(`${S1}|Gross Margin (P&L)|Revenue`, (t) => feeds.map((x) => x.revenue(t)).join('+'));
    row(`${S1}|Gross Margin (P&L)|(-) Cost of Sales`, (t) => `-(${feeds.map((x) => x.cosT(t)).join('+')})`);
    row(`${S1}|Gross Margin (P&L)|Gross Margin`, (t) => `${cell(`${S1}|Gross Margin (P&L)|Revenue`, t)}+${cell(`${S1}|Gross Margin (P&L)|(-) Cost of Sales`, t)}`);
    grouped(`${S2}|Inventory (closing balances)`, (x) => x.inv, 'Total Inventory', true, (x) => x.name, false);
    grouped(`${S2}|Accounts Receivable (closing balances)`, (x) => x.ar, 'Total Accounts Receivable', true);
    grouped(`${S2}|Unearned Revenue (closing balances)`, (x) => x.ur, 'Total Unearned Revenue', true, (x) => x.name, false);
    grouped(`${S3}|Cash Collected from Customers (per line)`, (x) => x.cash, 'Total Cash from Customers', false);
    grouped(`${S3}|Capex (per Sell line)`, (x) => x.capex, 'Total Capex', false, (x) => `${x.name}, Capex`, false);

    // ── Escrow ───────────────────────────────────────────────────────────────
    const escLines = planReportLines({ assets: state.assets, phases: state.phases, parcels: state.parcels }, (a) => snap.escrow.byAsset.has(a.id));
    if (escLines.length && has('esc|||Project Held % (regulator-locked)')) {
      const pct = (): string => w.ref('esc|||Project Held % (regulator-locked)', TOTAL_COL);
      const dUntil = (): string => w.ref('esc|||Default Held Until Year (optional)', TOTAL_COL);
      const dRelease = (): string => w.ref('esc|||Default Release Year (optional)', TOTAL_COL);
      const AXIS = (): string => w.ref('project:axisYear');
      const heldKeys: Array<{ key: string; held: number; rel: number; cash: number }> = [];
      for (const el of escLines) {
        const host = state.assets.find((a) => a.id === el.assetIds[0]) as Asset;
        const rl = lineOfAsset(host.id);
        if (!rl || !has(`rvc:${rl.key}:cashPre`)) continue;
        const name = revenueLineName(rl);
        const inKey = `esc|||${name}`;
        if (!has(inKey)) continue;
        const r = w.addr(inKey).row;
        const ov = (c: number): string => w.refA({ sheet: REV, row: r, col: c });
        const p = phases.find((x) => x.id === host.phaseId)!;
        const handover = (): string => `YEAR(${w.ref(`phase:${p.id}:start`)})+MAX(0,${w.ref(`phase:${p.id}:cp`)}-1)`;
        w.fA({ sheet: REV, row: r, col: TOTAL_COL }, `IF(AND(ISNUMBER(${ov(OPEN_COL)}),N(${ov(OPEN_COL)})>=0),${ov(OPEN_COL)},MAX(0,N(${pct()})))`);
        w.fA({ sheet: REV, row: r, col: OPEN_COL + 1 }, `IF(ISNUMBER(${ov(OPEN_COL + 2)}),${ov(OPEN_COL + 2)},IF(ISNUMBER(${dUntil()}),${dUntil()},${handover()}))`);
        w.fA({ sheet: REV, row: r, col: OPEN_COL + 3 }, `IF(ISNUMBER(${ov(OPEN_COL + 4)}),${ov(OPEN_COL + 4)},IF(ISNUMBER(${dRelease()}),${dRelease()},${handover()}+1))`);
        const effPct = (): string => w.refA({ sheet: REV, row: r, col: TOTAL_COL });
        const untilIdx = (): string => `MAX(0,MIN(${N - 1},${w.refA({ sheet: REV, row: r, col: OPEN_COL + 1 })}-${AXIS()}))`;
        const relIdx = (): string => `MAX(0,MIN(${N - 1},${w.refA({ sheet: REV, row: r, col: OPEN_COL + 3 })}-${AXIS()}))`;
        const cash = newRow(`escc:${rl.key}:cash`, `${name}: pre-sales cash`, (t) => rv(`rvc:${rl.key}:cashPre`, t));
        const held = newRow(`escc:${rl.key}:held`, `${name}: held`, (t) => `IF(${t}<=${untilIdx()},MAX(0,${at(cash, t)})*MAX(0,${effPct()}),0)`);
        const rel = newRow(`escc:${rl.key}:release`, `${name}: released`, (t) => `IF(${t}=${relIdx()},SUMPRODUCT((COLUMN(${range(held)})-${cT(0)}<=${relIdx()})*${range(held)}),0)`);
        heldKeys.push({ key: name, held, rel, cash });
      }
      const A = (label: string): string => `esc||A. Pre-Sales Cash by Asset (subject to escrow)|${label}`;
      const B = (label: string): string => `esc||B. Escrow Balance Roll-Forward|${label}`;
      const Cc = (label: string): string => `esc||C. Cash Flow Impact (project totals)|${label}`;
      for (const h of heldKeys) { row(A(h.key), (t) => at(h.cash, t)); row(B(h.key), (t) => at(h.held, t)); }
      row(A('Total Pre-Sales Cash (all assets)'), (t) => heldKeys.map((h) => at(h.cash, t)).join('+') || '0');
      row(B('Total Additions'), (t) => heldKeys.map((h) => at(h.held, t)).join('+') || '0');
      row(B('Less: Release of Locked Funds'), (t) => `-(${heldKeys.map((h) => at(h.rel, t)).join('+') || '0'})`);
      const bal = newRow('escc:balance', 'escrow balance (floored at zero)', (t) => `MAX(0,${t === 0 ? '0' : `${at(cr - 1, t - 1)}`}+${cell(B('Total Additions'), t)}+${cell(B('Less: Release of Locked Funds'), t)})`);
      row(B('Closing Balance'), (t) => at(bal, t), 'last');
      row(B('Opening Balance'), (t) => (t === 0 ? '0' : at(bal, t - 1)), 'none');
      row(Cc('Less: Inaccessible Funds Locked'), (t) => `-${cell(B('Total Additions'), t)}`);
      row(Cc('Add: Release of Inaccessible Funds'), (t) => `-${cell(B('Less: Release of Locked Funds'), t)}`);
      row(Cc('Net Cash Flow Adjustment (to M4)'), (t) => `${cell(Cc('Less: Inaccessible Funds Locked'), t)}+${cell(Cc('Add: Release of Inaccessible Funds'), t)}`);
    }

    return [{ sheet: REV, status: 'partial' as const, formulas: w.formulas.get(REV) ?? 0,
      note: 'Also live: selling costs (read from the Capex working sheet), Cost of Sales (each Sell plot\'s capex plus capitalised interest, released on its line\'s recognition share, on a hidden working sheet), the Schedules feeds and Escrow.',
      waits: {
        on: 'financing',
        text: 'Capitalised interest comes out of the financing and waits for that stage, so Cost of Sales, inventory, gross margin and the capex feed do not yet follow an input that moves it; the basis sentence over each Cost of Sales build states the platform\'s lifetime figures in words.',
        after: 'Capitalised interest reads the live financing solve. The basis sentence over each Cost of Sales build states the platform\'s lifetime figures in words, as of export, and the rows at the foot of the Revenue Output are the platform\'s values.',
      } }];
  },
};
