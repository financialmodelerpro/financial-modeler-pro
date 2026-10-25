/**
 * stage3Cos.ts (2026-09-27; on the visible tabs 2026-10-15), FORMULA-LINKED EXPORT,
 * STAGE 3b: selling costs, cost of sales, the schedule feeds and escrow.
 *
 * Runs AFTER Capex and Revenue, since it reads both. In the live layout the first
 * three sit on Schedules (they read Capex, which comes after Revenue in the flow);
 * escrow reads only Revenue and stays there. Every figure is a row on a visible tab:
 *
 *   SELLING COSTS: each line's marketing and commission, the rate, the sale revenue
 *     it charges on and the cost, read from the plots' rows on Capex, and the
 *     year-on-year schedule, the same rows by year.
 *   COST OF SALES, per Sell line as `buildAssetCostOfSales` builds it: the line's
 *     capex (Capex's subtotal for the line, else its plots' rows) plus its
 *     capitalised interest is the base; the recognition share is each year's
 *     revenue recognised over the lifetime's; cost of sales is the base times the
 *     share; the vintage matrix is each year's base times the share (one formula per
 *     row); inventory rolls forward from its own previous column. A plot of a merged
 *     line with capex and no rows releases on the line's sales, so the line is the unit.
 *   THE FEEDS: the income statement, balance sheet and cash flow feeds per line; an
 *     operating line's receivable is revenue x its days over 365, its cash revenue
 *     less the movement.
 *   ESCROW: pre-sales cash held at the effective held % through the held-until year
 *     and released, all held so far, in the release year; both years clamped to the
 *     workbook's years by its own header row.
 *
 * WAITS FOR THE FINANCING: capitalised interest comes out of the circular solve.
 * Its row holds the platform's values, marked pending, until the financing layer
 * writes its formula into the same cells (`cosc:<line>:idc`).
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { statedLineReceivableDays } from '../../receivableDays';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { planRevenueLines, REVENUE_SECTIONS, type RevenueLine } from '../../revenueLines';
import { revenueLineName } from '../../reports/revenueOutputReports';
import { buildSellingCostReport } from '../../reports/sellingCostReports';
import { buildCapexReport } from '../../reports/capexReports';
import { planReportLines, poolCapexByLine } from '../../reports/lineRows';
import type { Asset } from '../../state/module1-types';

const REV = 'Revenue';

export const stage3Cos: LiveLayer = {
  name: 'stage 3b: selling costs, cost of sales, schedule feeds, escrow',
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
    const has = (k: string): boolean => w.has(k);

    if (!w.reg.keys().some((k) => k.startsWith('cxc:')) || !w.reg.keys().some((k) => k.startsWith('rvc:'))) {
      return [{ sheet: REV, status: 'partial' as const, formulas: 0, note: 'Selling costs, Cost of Sales, the Schedules feeds and Escrow stay the platform\'s values: Capex or Revenue is not live for this model.' }];
    }

    // ── Writing helpers: one formula per row, period references column relative ──
    let here = REV;
    const colOf = (c: number): string => { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
    /** Year t of a registered row (dt = -1: the column before), column relative. */
    const p = (key: string, t: number, dt = 0): string => { const a = w.addr(key); return w.refP({ sheet: a.sheet, row: a.row, col: pc(t) + dt }, here); };
    /** A fixed cell of a registered row. */
    const fx = (key: string, col: number): string => { const a = w.addr(key); return w.refA({ sheet: a.sheet, row: a.row, col }, here); };
    const row = (key: string, f: (t: number) => string, total: 'sum' | 'last' | 'none' | (() => string) = 'sum'): void => {
      if (!has(key)) return;
      const a = w.addr(key);
      here = a.sheet;
      for (let t = 0; t < N; t++) w.fA({ sheet: a.sheet, row: a.row, col: pc(t) }, f(t));
      const T = { sheet: a.sheet, row: a.row, col: TOTAL_COL };
      if (total === 'sum') w.fA(T, `SUM(${w.rangeA(a.sheet, a.row, pc(0), pc(N - 1))})`);
      else if (total === 'last') w.fA(T, w.refA({ sheet: a.sheet, row: a.row, col: pc(N - 1) }, here));
      else if (typeof total === 'function') w.fA(T, total());
    };
    /** The sum of rows in one year: a SUM over a block where they are contiguous on one tab. */
    const sumKeys = (keys: string[], t: number): string => {
      const ks = keys.filter(has);
      if (!ks.length) return '0';
      const addrs = ks.map((k) => w.addr(k));
      const sheet = addrs[0].sheet;
      const rs = addrs.map((a) => a.row).sort((x, y) => x - y);
      if (addrs.every((a) => a.sheet === sheet) && rs.length > 1 && rs.every((r, i) => i === 0 || r === rs[i - 1] + 1)) {
        for (const r of rs) w.refP({ sheet, row: r, col: pc(t) }, here);
        return `SUM(${sheet === here ? '' : `'${sheet}'!`}${colOf(pc(t))}$${rs[0]}:${colOf(pc(t))}$${rs[rs.length - 1]})`;
      }
      return ks.map((k) => p(k, t)).join('+');
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
    // A selling line's row on Capex: `cxc:` when capitalised (commission), `cxe:` when expensed as incurred.
    const capexRowOf = (plot: string, lineId: string): string => (has(`cxc:${plot}:${lineId}`) ? `cxc:${plot}:${lineId}` : `cxe:${plot}:${lineId}`);
    if (sc) {
      const costRows: string[] = [];
      for (const d of sc.display) {
        const key = keyOf(`rev|__sell__||${d.label}`);
        if (!has(key)) continue;
        const l = lines.find((x) => x.key === d.lineKey);
        const members = (l?.members ?? []).map((m) => capexRowOf(m.id, d.lineId)).filter(has);
        if (!members.length) continue;
        const a = w.addr(key);
        here = a.sheet;
        // The asset's row on Capex: its rate (where it is typed), the base it charges on (C) and its total.
        w.fA({ sheet: a.sheet, row: a.row, col: 5 }, has(members[0].replace(/^cx[ce]:/, 'cxrate:')) ? `N(${w.ref(members[0].replace(/^cx[ce]:/, 'cxrate:'))})` : fx(members[0], 3));
        w.fA({ sheet: a.sheet, row: a.row, col: 7 }, members.map((k) => fx(k, 3)).join('+'));
        w.fA({ sheet: a.sheet, row: a.row, col: 8 }, members.map((k) => w.one(k)).join('+'));
        costRows.push(key);
      }
      if (has('rev|__sell__||Total selling costs')) {
        const a = w.addr('rev|__sell__||Total selling costs');
        here = a.sheet;
        w.fA({ sheet: a.sheet, row: a.row, col: 8 }, costRows.map((k) => fx(k, 8)).join('+') || '0');
      }
      occ.clear();
      const yoyRows: string[] = [];
      for (const s of sc.schedule?.rows ?? []) {
        const key = keyOf(`rev|__sell__|Selling Costs|${s.assetName}`);
        const [lineKey, lineId] = s.key.split('::');
        const l = lines.find((x) => x.key === lineKey) ?? lineOfAsset(lineKey);
        const members = (l?.members ?? []).map((m) => capexRowOf(m.id, lineId)).filter(has);
        row(key, (t) => members.map((k) => p(k, t)).join('+') || '0');
        if (has(key)) yoyRows.push(key);
      }
      row('rev|__sell__|Selling Costs|Total selling costs', (t) => sumKeys(yoyRows, t));
    }

    // ── Cost of Sales, per Sell line, on the line's recognition ─────────────
    const cosById = snap.byAssetCostOfSales;
    const anyNZ = (a: number[] | undefined): boolean => !!a && a.some((v) => (v ?? 0) !== 0);
    const capexLines = poolCapexByLine(buildCapexReport(snap, state), state).members;
    const lineCos = new Map<string, RevenueLine>();
    for (const l of lines.filter((x) => x.form === 'sell')) {
      const parts = l.members.filter((m) => anyNZ(cosById.get(m.id)?.cos.perPeriod));
      if (!parts.length || !has(`rvc:${l.key}:recPre`)) continue;
      const K = (table: string, label: string): string => `cos|${l.key}|${table}|${label}`;
      const B = (label: string): string => K('Cost of Sales Build', label);
      const kCapex = B('Capex, from Module 1'), kIdc = B('Capitalised IDC'), kBase = B('Total base charged through cost of sales');
      const kRec = B('Revenue recognised'), kShare = B('Recognition share of lifetime revenue'), kCos = B('Cost of Sales, total base x recognition share');
      const kChk = B('Check, base x share less cost of sales; Total = total base less total cost of sales');
      const S = (label: string): string => K('Cost of Sales Summary', label);
      const I = (label: string): string => K('Inventory Roll-Forward', label);
      const kOpen = I('Opening balance'), kAdd = I('(+) Capex (incl. capitalised IDC)'), kRel = I('(-) Cost of Sales'), kInv = I('Inventory balance (as carried on the balance sheet)');
      if (![kCapex, kIdc, kBase, kRec, kShare, kCos, S('On pre-sales recognition'), S('On post-handover sales'), kInv].every(has)) continue;
      lineCos.set(l.key, l);
      // The line's capex: Capex's subtotal for the line where its plots are exactly these, else the plots' rows.
      const ids = new Set(parts.map((m) => m.id));
      const host = [...capexLines].find(([, xs]) => xs.length === ids.size && xs.every((x) => ids.has(x)))?.[0];
      const plotRows = parts.flatMap((m) => w.reg.keys().filter((k) => k.startsWith(`cxc:${m.id}:`) && k.split(':').length === 3));
      row(kCapex, (t) => (host && has(`cx1sub:${host}`) ? p(`cx1sub:${host}`, t) : plotRows.map((k) => p(k, t)).join('+') || '0'));
      // Capitalised interest: the platform's values until the financing writes its formula here.
      {
        const a = w.addr(kIdc);
        for (let t = 0; t < N; t++) {
          const v = parts.reduce((s, m) => s + Math.max(0, snap.idc.byAsset.get(m.id)?.idcPerPeriod[t] ?? 0), 0);
          w.valueA({ sheet: a.sheet, row: a.row, col: pc(t) }, v, { pending: true });
        }
        here = a.sheet;
        w.fA({ sheet: a.sheet, row: a.row, col: TOTAL_COL }, `SUM(${w.rangeA(a.sheet, a.row, pc(0), pc(N - 1))})`);
      }
      row(kBase, (t) => `${p(kCapex, t)}+${p(kIdc, t)}`);
      row(kRec, (t) => `${p(`rvc:${l.key}:recPre`, t)}+${p(`rvc:${l.key}:postRev`, t)}`);
      const TR = (): string => fx(kRec, TOTAL_COL), TB = (): string => fx(kBase, TOTAL_COL);
      row(kShare, (t) => `IF(${TR()}>0,MAX(0,${p(kRec, t)})/${TR()},0)`);
      row(kCos, (t) => `IF(${TB()}>0,${TB()}*${p(kShare, t)},0)`);
      row(kChk, (t) => `${TB()}*${p(kShare, t)}-${p(kCos, t)}`, () => `${TB()}-${fx(kCos, TOTAL_COL)}`);
      // The vintage matrix: each year's base, released on the same share.
      const vk = Array.from({ length: N }, (_, i) => K('Cost of Sales Vintage Matrix', `Spent in ${snap.yearLabels[i]}`));
      vk.forEach((k, i) => row(k, (t) => `${fx(kBase, pc(i))}*${p(kShare, t)}`));
      row(K('Cost of Sales Vintage Matrix', 'Total'), (t) => sumKeys(vk, t));
      row(S('On pre-sales recognition'), (t) => `IF(${TR()}>0,${TB()}*MAX(0,${p(`rvc:${l.key}:recPre`, t)})/${TR()},0)`);
      row(S('On post-handover sales'), (t) => `IF(${TR()}>0,${TB()}*MAX(0,${p(`rvc:${l.key}:postRev`, t)})/${TR()},0)`);
      row(S('Total Cost of Sales'), (t) => p(kCos, t));
      // The opening balance's Total is the balance at the start, the first year's opening.
      row(kOpen, (t) => p(kInv, t, -1), () => w.refA({ sheet: w.addr(kOpen).sheet, row: w.addr(kOpen).row, col: pc(0) }, here));
      row(kAdd, (t) => p(kBase, t));
      row(kRel, (t) => `-${p(kCos, t)}`);
      row(kInv, (t) => `${p(kOpen, t)}+${p(kAdd, t)}+${p(kRel, t)}`, 'last');
      // The line's rows, for the tabs that read them.
      const claim = (name: string, key: string): void => { const a = w.addr(key); w.claim(`cosc:${l.key}:${name}`, a.sheet, a.row, 1); };
      claim('capex', kCapex); claim('idc', kIdc); claim('base', kBase); claim('rec', kRec); claim('share', kShare); claim('cos', kCos);
      claim('pre', S('On pre-sales recognition')); claim('post', S('On post-handover sales')); claim('inv', kInv);
    }
    // The project roll-ups, by section.
    const projTables: Array<[string, string, string]> = [
      ['Project Cost of Sales', 'pre', 'Total on pre-sales recognition'],
      ['Project Cost of Sales', 'post', 'Total on post-handover sales'],
      ['Project Total Cost of Sales', 'cos', 'Total Cost of Sales'],
    ];
    occ.clear();
    for (const [table, pick, totalLabel] of projTables) {
      const sectionKeys: string[] = [];
      for (const section of REVENUE_SECTIONS) {
        const items = [...lineCos.values()].filter((x) => x.section === section);
        if (!items.length) continue;
        const keys: string[] = [];
        for (const l of items) { const k = keyOf(`cos|__project__|${table}|${revenueLineName(l)}`); row(k, (t) => p(`cosc:${l.key}:${pick}`, t)); keys.push(k); }
        const tk = keyOf(`cos|__project__|${table}|Total ${section}`);
        row(tk, (t) => sumKeys(keys, t));
        sectionKeys.push(tk);
      }
      row(keyOf(`cos|__project__|${table}|${totalLabel}`), (t) => sumKeys(sectionKeys, t));
    }

    // ── The schedule feeds ───────────────────────────────────────────────────
    type Feed = { key?: string; name: string; section: string; revenue: (t: number) => string; cash: (t: number) => string; cosC: (t: number) => string; cosO: (t: number) => string; cosT: (t: number) => string; inv: (t: number) => string; ar: (t: number) => string; ur: (t: number) => string; capex: (t: number) => string };
    const feeds: Feed[] = [];
    const Z = (): string => '0';
    for (const l of lines) {
      const name = revenueLineName(l);
      if (l.form === 'sell' && has(`rvc:${l.key}:recPre`)) {
        const c = (k: string): ((t: number) => string) => (lineCos.has(l.key) ? (t) => p(`cosc:${l.key}:${k}`, t) : Z);
        feeds.push({
          name, section: l.section,
          revenue: (t) => `${p(`rvc:${l.key}:recPre`, t)}+${p(`rvc:${l.key}:postRev`, t)}`,
          cash: (t) => `${p(`rvc:${l.key}:cashPre`, t)}+${p(`rvc:${l.key}:postRev`, t)}`,
          cosC: c('pre'), cosO: c('post'), cosT: c('cos'), inv: c('inv'),
          ar: (t) => p(`rvc:${l.key}:ar`, t), ur: (t) => p(`rvc:${l.key}:ur`, t),
          capex: c('base'),
        });
      } else if (l.form !== 'sell') {
        const revKey = l.form === 'operate' ? `rvc:${l.key}:total` : `rvc:${l.key}:rev`;
        if (!has(revKey)) continue;
        // THE LINE'S RECEIVABLE AT THE CLOSE IS ITS ROW IN THE RECEIVABLES FEED: its revenue at
        // its own days where the line card states them, else the project DSO (receivableDays.ts).
        // LIVE (2026-10-25): the line's own days on Inputs where it types a positive figure, else the
        // project DSO, worked out here for every hotel and lease line, so typing either moves the cash.
        const own = statedLineReceivableDays(l.host);
        const arIn = `rxin|${l.key}|arDays`;
        const daysKey = own !== undefined ? w.reg.keys().find((k) => k.startsWith(`revin|${l.key}|`) && k.endsWith('|Accounts Receivable Days')) : undefined;
        const dso = (): string => w.refA(w.addr('project:dso'), here);
        const days = (): string => (has(arIn)
          ? `IF(N(${w.refA(w.addr(arIn, 2), here)})>0,N(${w.refA(w.addr(arIn, 2), here)}),N(${dso()}))`
          : daysKey ? fx(daysKey, TOTAL_COL) : dso());
        feeds.push({
          key: l.key, name, section: l.section,
          revenue: (t) => p(revKey, t),
          cash: (t) => `${p(revKey, t)}-(${p(`rvc:${l.key}:opar`, t)}-${p(`rvc:${l.key}:opar`, t, -1)})`,
          cosC: Z, cosO: Z, cosT: Z, inv: Z, ar: (t) => `${p(revKey, t)}*${days()}/365`, ur: Z, capex: Z,
        });
      }
    }
    const S1 = 'sched|Income Statement Feed', S2 = 'sched|Balance Sheet Feed', S3 = 'sched|Cash Flow Feed';
    const grouped = (tableKey: string, f: (x: Feed) => (t: number) => string, grandLabel: string, stock: boolean, labelOf: (x: Feed) => string = (x) => x.name, sectionTotals = true): void => {
      occ.clear();
      const tot = stock ? 'last' as const : 'sum' as const;
      const all: string[] = [], totals: string[] = [];
      for (const section of REVENUE_SECTIONS) {
        const items = feeds.filter((x) => x.section === section);
        const keys: string[] = [];
        for (const x of items) {
          const k = keyOf(`${tableKey}|${labelOf(x)}`); if (!has(k)) continue;
          // A hotel or lease line's receivable row is the line's operating receivable.
          if (x.key && tableKey.endsWith('Accounts Receivable (closing balances)')) { const a = w.addr(k); w.claim(`rvc:${x.key}:opar`, a.sheet, a.row, 1); }
          row(k, f(x), tot); keys.push(k);
        }
        if (!keys.length) continue;
        all.push(...keys);
        if (sectionTotals) { const tk = keyOf(`${tableKey}|Total ${section}`); row(tk, (t) => sumKeys(keys, t), tot); if (has(tk)) totals.push(tk); }
      }
      row(`${tableKey}|${grandLabel}`, (t) => sumKeys(sectionTotals ? totals : all, t), tot);
    };
    grouped(`${S1}|Revenue (P&L)`, (x) => x.revenue, 'Total Revenue', false);
    for (const x of feeds) {
      row(`${S1}|Cost of Sales (P&L)|${x.name}, CoS during construction`, x.cosC);
      row(`${S1}|Cost of Sales (P&L)|${x.name}, CoS during operations`, x.cosO);
      row(`${S1}|Cost of Sales (P&L)|${x.name}, Total Cost of Sales`, x.cosT);
    }
    row(`${S1}|Cost of Sales (P&L)|Total Cost of Sales`, (t) => feeds.map((x) => `${S1}|Cost of Sales (P&L)|${x.name}, Total Cost of Sales`).filter(has).map((k) => p(k, t)).join('+') || '0');
    row(`${S1}|Gross Margin (P&L)|Revenue`, (t) => p(`${S1}|Revenue (P&L)|Total Revenue`, t));
    row(`${S1}|Gross Margin (P&L)|(-) Cost of Sales`, (t) => `-${p(`${S1}|Cost of Sales (P&L)|Total Cost of Sales`, t)}`);
    row(`${S1}|Gross Margin (P&L)|Gross Margin`, (t) => `${p(`${S1}|Gross Margin (P&L)|Revenue`, t)}+${p(`${S1}|Gross Margin (P&L)|(-) Cost of Sales`, t)}`);
    grouped(`${S2}|Inventory (closing balances)`, (x) => x.inv, 'Total Inventory', true, (x) => x.name, false);
    grouped(`${S2}|Accounts Receivable (closing balances)`, (x) => x.ar, 'Total Accounts Receivable', true);
    grouped(`${S2}|Unearned Revenue (closing balances)`, (x) => x.ur, 'Total Unearned Revenue', true, (x) => x.name, false);
    grouped(`${S3}|Cash Collected from Customers (per line)`, (x) => x.cash, 'Total Cash from Customers', false);
    grouped(`${S3}|Capex (per Sell line)`, (x) => x.capex, 'Total Capex', false, (x) => `${x.name}, Capex`, false);

    // ── Escrow (Revenue) ─────────────────────────────────────────────────────
    const escLines = planReportLines({ assets: state.assets, phases: state.phases, parcels: state.parcels }, (a) => snap.escrow.byAsset.has(a.id));
    if (escLines.length && has('esc|||Project Held % (regulator-locked)')) {
      here = REV;
      const pct = (): string => fx('esc|||Project Held % (regulator-locked)', TOTAL_COL);
      const dUntil = (): string => fx('esc|||Default Held Until Year (optional)', TOTAL_COL);
      const dRelease = (): string => fx('esc|||Default Release Year (optional)', TOTAL_COL);
      // The workbook's first and last years, from its own header row (the Timeline's).
      const Y = (t: number): string => w.refP({ sheet: REV, row: 3, col: pc(t) }, REV);
      const Y0 = (): string => w.refA({ sheet: REV, row: 3, col: pc(0) }, REV), YN = (): string => w.refA({ sheet: REV, row: 3, col: pc(N - 1) }, REV);
      const A = (label: string): string => `esc||A. Pre-Sales Cash by Asset (subject to escrow)|${label}`;
      const Bk = (label: string): string => `esc||B. Escrow Balance Roll-Forward|${label}`;
      const Cc = (label: string): string => `esc||C. Cash Flow Impact (project totals)|${label}`;
      const cashKeys: string[] = [], heldKeys: string[] = [];
      const releases: Array<{ held: string; rel: () => string }> = [];
      for (const el of escLines) {
        const host = state.assets.find((a) => a.id === el.assetIds[0]) as Asset;
        const rl = lineOfAsset(host.id);
        if (!rl || !has(`rvc:${rl.key}:cashPre`)) continue;
        const name = revenueLineName(rl);
        const inKey = `esc|||${name}`;
        if (!has(inKey) || !has(A(name)) || !has(Bk(name))) continue;
        const r = w.addr(inKey).row;
        const ov = (c: number): string => w.refA({ sheet: REV, row: r, col: c }, REV);
        const p0 = state.phases.find((x) => x.id === host.phaseId)!;
        const handover = (): string => `YEAR(${w.ref(`phase:${p0.id}:start`)})+MAX(0,${w.ref(`phase:${p0.id}:cp`)}-1)`;
        here = REV;
        w.fA({ sheet: REV, row: r, col: TOTAL_COL }, `IF(AND(ISNUMBER(${ov(OPEN_COL)}),N(${ov(OPEN_COL)})>=0),${ov(OPEN_COL)},MAX(0,N(${pct()})))`);
        w.fA({ sheet: REV, row: r, col: OPEN_COL + 1 }, `IF(ISNUMBER(${ov(OPEN_COL + 2)}),${ov(OPEN_COL + 2)},IF(ISNUMBER(${dUntil()}),${dUntil()},${handover()}))`);
        w.fA({ sheet: REV, row: r, col: OPEN_COL + 3 }, `IF(ISNUMBER(${ov(OPEN_COL + 4)}),${ov(OPEN_COL + 4)},IF(ISNUMBER(${dRelease()}),${dRelease()},${handover()}+1))`);
        const eff = (): string => ov(TOTAL_COL), until = (): string => ov(OPEN_COL + 1), relY = (): string => ov(OPEN_COL + 3);
        row(A(name), (t) => p(`rvc:${rl.key}:cashPre`, t));
        row(Bk(name), (t) => `IF(${Y(t)}<=MAX(${Y0()},MIN(${YN()},${until()})),MAX(0,${p(A(name), t)})*MAX(0,${eff()}),0)`);
        cashKeys.push(A(name)); heldKeys.push(Bk(name));
        releases.push({ held: Bk(name), rel: relY });
        w.claim(`escc:${rl.key}:held`, REV, w.addr(Bk(name)).row, 1);
        w.claim(`escc:${rl.key}:in`, REV, r, 1);
      }
      row(A('Total Pre-Sales Cash (all assets)'), (t) => sumKeys(cashKeys, t));
      row(Bk('Total Additions'), (t) => sumKeys(heldKeys, t));
      // A line releases everything it has held so far, in its release year (clamped to the workbook's years).
      row(Bk('Less: Release of Locked Funds'), (t) => `-(${releases.map((x) => {
        const hr = w.addr(x.held).row;
        w.refP({ sheet: REV, row: hr, col: pc(t) }, REV);
        return `(${Y(t)}=MAX(${Y0()},MIN(${YN()},${x.rel()})))*SUM($${colOf(pc(0))}$${hr}:${colOf(pc(t))}$${hr})`;
      }).join('+') || '0'})`);
      row(Bk('Closing Balance'), (t) => `MAX(0,${p(Bk('Closing Balance'), t, -1)}+${p(Bk('Total Additions'), t)}+${p(Bk('Less: Release of Locked Funds'), t)})`, 'last');
      row(Bk('Opening Balance'), (t) => p(Bk('Closing Balance'), t, -1), 'none');
      row(Cc('Less: Inaccessible Funds Locked'), (t) => `-${p(Bk('Total Additions'), t)}`);
      row(Cc('Add: Release of Inaccessible Funds'), (t) => `-${p(Bk('Less: Release of Locked Funds'), t)}`);
      row(Cc('Net Cash Flow Adjustment (to M4)'), (t) => `${p(Cc('Less: Inaccessible Funds Locked'), t)}+${p(Cc('Add: Release of Inaccessible Funds'), t)}`);
    }

    const sheets = [...new Set([...lineCos.keys()].map((k) => w.addr(`cosc:${k}:cos`).sheet))];
    const where = sheets[0] ?? 'Schedules';
    return [{ sheet: where, status: 'partial' as const, formulas: w.formulas.get(where) ?? 0,
      note: 'Also live: selling costs (the plots\' rows on Capex), Cost of Sales (each Sell line\'s capex plus capitalised interest, released on its recognition share, with its vintage matrix and inventory), the Schedules feeds and Escrow, every figure a row on the tab.',
      waits: {
        on: 'financing',
        text: 'Capitalised interest comes out of the financing and waits for that stage, so Cost of Sales, inventory, gross margin and the capex feed do not yet follow an input that moves it.',
        after: 'Capitalised interest reads the live financing solve.',
      } }];
  },
};
