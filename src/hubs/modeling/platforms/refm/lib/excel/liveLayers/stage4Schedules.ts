/**
 * stage4Schedules.ts (2026-09-27), FORMULA-LINKED EXPORT, STAGE 4: SCHEDULES.
 *
 * Runs after Capex, Revenue, Cost of Sales and Opex, since it reads all four.
 *
 *   FIXED ASSETS & D&A, per Operate and Lease plot as `computeAllFixedAssetResults`
 *     builds them, on a hidden working sheet ("Schedules Calc"): the plot's capex
 *     on the axis from the Capex working sheet, its land value lines as land
 *     additions (land never depreciates), the rest as depreciable additions. Each
 *     year's addition is its own straight-line vintage from the later of its own
 *     year and the first operating year, for the line's useful life; closing NBV
 *     is floored at zero. The exit writes the balances off in the exit year
 *     (`scheduleWithDisposal`), and the tables sum a line's plots.
 *   BS SCHEDULES: the sales receivables and unearned revenue from the Revenue
 *     working sheet, the operating receivables on the project DSO, inventory from
 *     the Cost of Sales working sheet, escrow from the Revenue sheet and payables
 *     from the Opex sheet.
 *
 * WAITS FOR STAGE 6: interest capitalised into a held asset, its depreciation
 * and its NBV come out of the circular financing, so they sit on the working
 * sheet as the platform's values, marked pending, and every figure that adds
 * them (the combined depreciation and NBV, the totals, inventory) is pending
 * too. The IDC pool table stays the platform's values.
 * WAITS FOR STAGE 5: debt outstanding, the equity roll-forward and retained
 * earnings stay the platform's values.
 *
 * REFUSES by name (the Schedules sheet stays values): Capex not live, reducing
 * balance depreciation, a phase overlap, existing operations carried in, plots
 * of one line with different lives, an exit before the last year, an operating
 * receivable year that is not 365 days (it is not shown).
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { isLandValueLine, resolveUsefulLifeYears } from '@/src/core/calculations';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { planRevenueLines, lineForAsset } from '../../revenueLines';
import { buildFixedAssetReport, idcRowIsHeld, type FixedAssetTable } from '../../reports/fixedAssetReports';
import { disposalContextOf } from '../../reports/disposalSchedules';
import { buildBsFeederTables } from '../../reports/m4Reports';
import { planReportLines, poolMapByLine } from '../../reports/lineRows';
import type { Asset, CostLine, Phase } from '../../state/module1-types';

const CALC = 'Schedules Calc';
const SCH = 'Schedules';
const CXCALC = 'Capex Calc';
const RCALC = 'Revenue Calc';

export const stage4Schedules: LiveLayer = {
  name: 'stage 4: schedules',
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
    const phases = state.phases as Phase[];
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, state.project);
    const lineState = { assets: state.assets, phases: state.phases, parcels: state.parcels };
    const values = (note: string) => [{ sheet: SCH, status: 'values' as const, formulas: 0, note }];

    // ── Refusals ─────────────────────────────────────────────────────────────
    const refuse: string[] = [];
    if (!has('cxc:P0')) refuse.push('Capex is not live for this model');
    const dCtx = disposalContextOf(snap);
    if (dCtx.booked && dCtx.exitIdx < N - 1) refuse.push('the exit falls before the last year');
    const faAssets = state.assets.filter((a) => snap.fixedAssets.byAsset.has(a.id));
    for (const a of faAssets) {
      if ((a.depreciationMethod ?? 'straight_line') !== 'straight_line') refuse.push(`${a.name}: reducing balance depreciation`);
      const p = phases.find((x) => x.id === a.phaseId);
      if (p && (p.overlapPeriods ?? 0) !== 0) refuse.push(`${a.name}: a phase overlap, which the sheet does not show`);
      if ((a.historicalPreCapexLand ?? 0) > 0 || (a.historicalPreCapexBuilding ?? 0) > 0) refuse.push(`${a.name}: existing operations carried in`);
    }
    const faLines = planReportLines(lineState, (a) => snap.fixedAssets.byAsset.has(a.id));
    for (const l of faLines) {
      const lives = new Set(l.assetIds.map((id) => resolveUsefulLifeYears(state.assets.find((a) => a.id === id)!)));
      if (lives.size > 1) refuse.push(`${l.assetIds.join(', ')}: plots of one line depreciate over different lives`);
    }
    const arDays = state.project.operatingAr?.daysPerYear;
    if (arDays !== undefined && arDays !== 365) refuse.push('the operating receivables use a year that is not 365 days, which the sheet does not show');
    if (refuse.length) return values(`Schedules could not be made live for this model: ${[...new Set(refuse)].join('; ')}.`);

    // ── The working sheet ────────────────────────────────────────────────────
    const P0 = w.addr('cxc:P0').col;
    const cs = wb.addWorksheet(CALC, { state: 'hidden' });
    cs.getCell(1, 1).value = 'Schedules working sheet: per held plot, land and depreciable additions, straight-line vintages and the exit write-off. Capitalised interest waits for the financing stages (pending).';
    const cT = (t: number): number => 4 + t;
    let cr = 3;
    for (let t = 0; t < N; t++) cs.getCell(cr, cT(t)).value = `Year ${t + 1}`;
    cr += 1;
    const C = (r: number, c: number) => ({ sheet: CALC, row: r, col: c });
    const at = (r: number, t: number): string => w.refA(C(r, cT(t)));
    const range = (r: number): string => w.rangeA(CALC, r, cT(0), cT(N - 1));
    const newRow = (key: string, label: string, f?: (t: number) => string): number => {
      const r = cr++; cs.getCell(r, 1).value = label; w.claim(key, CALC, r, 1);
      if (f) for (let t = 0; t < N; t++) w.fA(C(r, cT(t)), f(t));
      return r;
    };
    const pendingRow = (key: string, label: string, vals: readonly number[]): number => {
      const r = newRow(key, label);
      for (let t = 0; t < N; t++) w.valueA(C(r, cT(t)), vals[t] ?? 0, { pending: true });
      return r;
    };
    const sum = (rows: number[], t: number): string => rows.map((r) => at(r, t)).join('+') || '0';
    const X = N - 1;
    const booked = dCtx.booked;
    /** The exit write-off on a closing series (X is the last year here): the balance goes to zero in X. */
    const writeOff = (key: string, closing: number): { adj: number; disp: number } => {
      const adj = newRow(`${key}:adj`, 'closing after the exit', (t) => (booked && t === X ? '0' : at(closing, t)));
      const disp = newRow(`${key}:disp`, 'disposed at the exit', (t) => (booked && t === X ? at(closing, t) : '0'));
      return { adj, disp };
    };

    // The life each line depreciates over: the inputs table, blank or zero inheriting the category default.
    const lifeOf = new Map<string, () => string>();
    for (const l of faLines) {
      const host = state.assets.find((a) => a.id === l.assetIds[0])!;
      const dflt = resolveUsefulLifeYears({ ...host, usefulLifeYears: undefined } as Asset);
      if (!has(`fain:${host.id}`)) continue;
      const r = w.addr(`fain:${host.id}`).row;
      const lifeCell = (): string => w.refA({ sheet: SCH, row: r, col: TOTAL_COL });
      const eff = newRow(`schc:${host.id}:life`, `${host.id}: useful life in force`);
      w.fA(C(eff, 3), `IF(N(${lifeCell()})>0,N(${lifeCell()}),${dflt})`, { cached: resolveUsefulLifeYears(host) });
      w.fA({ sheet: SCH, row: r, col: OPEN_COL }, `IF(${w.refA(C(eff, 3))}>0,1/${w.refA(C(eff, 3))},0)`);
      for (const id of l.assetIds) lifeOf.set(id, () => w.refA(C(eff, 3)));
    }

    interface Plot { land: number; landAdd: number; depAdd: number; dep: number; close: number; accum: number; idcAdd?: number; idcDep?: number; idcClose?: number }
    const plots = new Map<string, Plot>();
    const costLineOf = (id: string): Pick<CostLine, 'id' | 'catalogId'> => (state.costLines as CostLine[]).find((x) => x.id === id) ?? { id };
    for (const a of faAssets) {
      const p = phases.find((x) => x.id === a.phaseId)!;
      const L = lifeOf.get(a.id);
      if (!L) return values(`Schedules could not be made live for this model: ${a.name} has no life on the inputs table.`);
      const keys = w.reg.keys().filter((k) => k.startsWith(`cxc:${a.id}:`) && k.split(':').length === 3);
      const cx = (k: string, t: number): string => w.refA({ sheet: CXCALC, row: w.addr(k).row, col: P0 + t });
      const landKeys = keys.filter((k) => isLandValueLine(costLineOf(k.split(':')[2])));
      const all = newRow(`schc:${a.id}:capex`, `${a.name}: capex on the axis`, (t) => keys.map((k) => cx(k, t)).join('+') || '0');
      const landAdd = newRow(`schc:${a.id}:landAdd`, 'land additions', (t) => landKeys.map((k) => cx(k, t)).join('+') || '0');
      const land = newRow(`schc:${a.id}:land`, 'land closing', (t) => `${t === 0 ? '0' : at(cr - 1, t - 1)}+MAX(0,${at(landAdd, t)})`);
      const depAdd = newRow(`schc:${a.id}:depAdd`, 'depreciable additions', (t) => `MAX(0,${at(all, t)}-${at(landAdd, t)})`);
      // Each year's addition depreciates from the later of its own year and the first operating year.
      const S = (): string => `(MAX(0,YEAR(${w.ref(`phase:${p.id}:start`)})-${w.ref('project:axisYear')})+MAX(0,${w.ref(`phase:${p.id}:cp`)}))`;
      const vs = newRow(`schc:${a.id}:vstart`, 'vintage start', (t) => `MAX(${t},${S()})`);
      const dep = newRow(`schc:${a.id}:dep`, 'depreciation (capex)', (t) => {
        const addR = range(depAdd), vsR = range(vs);
        return `IF(${L()}>0,SUMPRODUCT((${addR}>0)*${addR}/MAX(1,${L()})*(${vsR}<=${t})*(${vsR}+MAX(1,INT(${L()}))>${t})),0)`;
      });
      const close = newRow(`schc:${a.id}:close`, 'depreciable closing (capex)', (t) => `MAX(0,${t === 0 ? '0' : at(cr - 1, t - 1)}+${at(depAdd, t)}-${at(dep, t)})`);
      const accum = newRow(`schc:${a.id}:accum`, 'accumulated depreciation (capex)', (t) => `SUM(${w.rangeA(CALC, dep, cT(0), cT(t))})`);
      const row: Plot = { land, landAdd, depAdd, dep, close, accum };
      const idc = snap.idc.byAsset.get(a.id);
      if (idc && idcRowIsHeld(idc)) {
        row.idcAdd = pendingRow(`schc:${a.id}:idcAdd`, 'capitalised interest (financing, pending)', idc.idcPerPeriod);
        row.idcDep = pendingRow(`schc:${a.id}:idcDep`, 'its depreciation (pending)', idc.depreciationPerPeriod);
        row.idcClose = pendingRow(`schc:${a.id}:idcClose`, 'its NBV (pending)', idc.closingNbvPerPeriod);
      }
      plots.set(a.id, row);
    }
    for (let col = 1; col <= cT(N - 1); col++) cs.getColumn(col).width = col <= 3 ? 26 : 14;

    // ── The visible tables ───────────────────────────────────────────────────
    const row = (key: string, f: (t: number) => string, total: 'sum' | 'last' | 'first' | 'sumPrior'): void => {
      if (!has(key)) return;
      const r = w.addr(key).row;
      for (let t = 0; t < N; t++) w.fA({ sheet: SCH, row: r, col: pc(t) }, f(t));
      const rng = (): string => w.rangeA(SCH, r, pc(0), pc(N - 1));
      if (total === 'sum') w.fA({ sheet: SCH, row: r, col: TOTAL_COL }, `SUM(${rng()})`);
      else if (total === 'sumPrior') w.fA({ sheet: SCH, row: r, col: TOTAL_COL }, `SUM(${rng()})+N(${w.refA({ sheet: SCH, row: r, col: OPEN_COL })})`);
      else if (total === 'last') w.fA({ sheet: SCH, row: r, col: TOTAL_COL }, w.refA({ sheet: SCH, row: r, col: pc(N - 1) }));
      else w.fA({ sheet: SCH, row: r, col: TOTAL_COL }, w.refA({ sheet: SCH, row: r, col: pc(0) }));
    };

    /** A set of plots as one schedule: every series a sum, the exit applied to the sums. */
    interface Group { landAdd: number; landAdj: number; landDisp: number; depAdd: number; dep: number; capAdj: number; capDisp: number; accumAdj: number; idc: { add: number; dep: number; adj: number; disp: number } | null }
    const group = (key: string, ids: string[], idcOverride?: { add: readonly number[]; dep: readonly number[]; close: readonly number[] }): Group => {
      const ps = ids.map((id) => plots.get(id)).filter((x): x is Plot => !!x);
      const S = (label: string, pick: (p: Plot) => number | undefined): number => newRow(`schg:${key}:${label}`, `${key}: ${label}`, (t) => sum(ps.map(pick).filter((x): x is number => x !== undefined), t));
      const landAdd = S('landAdd', (p) => p.landAdd), landClose = S('land', (p) => p.land);
      const depAdd = S('depAdd', (p) => p.depAdd), dep = S('dep', (p) => p.dep), capClose = S('close', (p) => p.close);
      const accum = S('accum', (p) => p.accum);
      const accumAdj = newRow(`schg:${key}:accumAdj`, 'accumulated after the exit', (t) => (booked && t >= X ? '0' : at(accum, t)));
      const lw = writeOff(`schg:${key}:land`, landClose), cw = writeOff(`schg:${key}:cap`, capClose);
      let idc: Group['idc'] = null;
      if (idcOverride) {
        const add = pendingRow(`schg:${key}:idcAdd`, 'held capitalised interest (pending)', idcOverride.add);
        const d = pendingRow(`schg:${key}:idcDep`, 'its depreciation (pending)', idcOverride.dep);
        const c = pendingRow(`schg:${key}:idcClose`, 'its NBV (pending)', idcOverride.close);
        const iw = writeOff(`schg:${key}:idc`, c);
        idc = { add, dep: d, adj: iw.adj, disp: iw.disp };
      } else if (ps.some((p) => p.idcAdd !== undefined)) {
        const add = S('idcAdd', (p) => p.idcAdd), d = S('idcDep', (p) => p.idcDep), c = S('idcClose', (p) => p.idcClose);
        const iw = writeOff(`schg:${key}:idc`, c);
        idc = { add, dep: d, adj: iw.adj, disp: iw.disp };
      }
      return { landAdd, landAdj: lw.adj, landDisp: lw.disp, depAdd, dep, capAdj: cw.adj, capDisp: cw.disp, accumAdj, idc };
    };
    const prev = (r: number, t: number): string => (t === 0 ? '0' : at(r, t - 1));
    /** Write one fixed asset table by its row labels (the report decides which rows exist). */
    const writeTable = (keyBase: string, kind: 'land' | 'dep' | 'total', table: FixedAssetTable, g: Group): void => {
      const withIdc = table.rows.some((r) => r.label.includes('IDC'));
      const idc = withIdc ? g.idc : null;
      const depOpen = (t: number): string => `${prev(g.capAdj, t)}${idc ? `+${prev(idc.adj, t)}` : ''}`;
      const depClose = (t: number): string => `${at(g.capAdj, t)}${idc ? `+${at(idc.adj, t)}` : ''}`;
      const depDisp = (t: number): string => `${at(g.capDisp, t)}${idc ? `+${at(idc.disp, t)}` : ''}`;
      for (const r of table.rows) {
        const key = `sch|${keyBase}|${kind}|${r.label}`;
        const tot = r.aggregation === 'last' ? 'last' as const : 'sum' as const;
        const L = r.label;
        let f: ((t: number) => string) | null = null;
        if (kind === 'land') {
          if (L === 'Opening Land') f = (t) => prev(g.landAdj, t);
          else if (L === '(+) Land Additions') f = (t) => at(g.landAdd, t);
          else if (L.startsWith('(−) Land Disposed')) f = (t) => `-${at(g.landDisp, t)}`;
          else if (L === 'Closing Land') f = (t) => at(g.landAdj, t);
        } else if (kind === 'dep') {
          if (L.startsWith('Opening NBV')) f = depOpen;
          else if (L === '(+) Capex Additions') f = (t) => at(g.depAdd, t);
          else if (L.startsWith('(+) IDC Additions') && idc) f = (t) => at(idc.add, t);
          else if (L.startsWith('(−) Depreciation')) f = (t) => `-(${at(g.dep, t)}${idc ? `+${at(idc.dep, t)}` : ''})`;
          else if (L.startsWith('(−) Disposed at Exit')) f = (t) => `-(${depDisp(t)})`;
          else if (L.startsWith('Closing NBV')) f = depClose;
          else if (L.includes('of which: Capex NBV')) f = (t) => at(g.capAdj, t);
          else if (L.includes('of which: IDC NBV') && idc) f = (t) => at(idc.adj, t);
          else if (L.startsWith('Accumulated')) f = (t) => at(g.accumAdj, t);
        } else {
          if (L === 'Opening Land') f = (t) => prev(g.landAdj, t);
          else if (L.startsWith('Opening Depreciable')) f = depOpen;
          else if (L === 'Opening Fixed Assets') f = (t) => `${prev(g.landAdj, t)}+${depOpen(t)}`;
          else if (L.startsWith('(−) Disposed at Exit')) f = (t) => `-(${at(g.landDisp, t)}+${depDisp(t)})`;
          else if (L === 'Closing Land') f = (t) => at(g.landAdj, t);
          else if (L.startsWith('Closing Depreciable')) f = depClose;
          else if (L === 'Closing Fixed Assets') f = (t) => `${at(g.landAdj, t)}+${depClose(t)}`;
        }
        if (!f) throw new Error(`Schedules: no rule for the row "${L}" (${kind})`);
        row(key, f, tot);
      }
    };

    const report = buildFixedAssetReport({ fa: snap.fixedAssets, idc: snap.idc, state, dCtx });
    for (const gr of report.groups) {
      for (const l of gr.lines) {
        const g = group(l.hostId, [...l.memberIds]);
        writeTable(l.hostId, 'land', l.land, g);
        writeTable(l.hostId, 'dep', l.depreciable, g);
        writeTable(l.hostId, 'total', l.total, g);
      }
    }
    // The project: every plot, with the project's held capitalised interest (pending).
    const heldAdd = new Array<number>(N).fill(0);
    for (const r of snap.idc.byAsset.values()) if (idcRowIsHeld(r)) for (let t = 0; t < N; t++) heldAdd[t] += r.idcPerPeriod[t] ?? 0;
    const pg = group('__project__', faAssets.map((a) => a.id), { add: heldAdd, dep: snap.idc.idcDepreciationPerPeriod, close: snap.idc.idcNbvPerPeriod });
    writeTable('__project__', 'land', report.project.land, pg);
    writeTable('__project__', 'dep', report.project.depreciable, pg);
    writeTable('__project__', 'total', report.project.total, pg);

    // ── BS Schedules ─────────────────────────────────────────────────────────
    const rv = (key: string, t: number): string => w.refA({ sheet: RCALC, row: w.addr(key).row, col: 4 + t });
    const feeders = buildBsFeederTables({ snap, state, fmt: (v: number) => String(v) });
    const F = (tbl: string, label: string): string => `sch|${tbl}||${label}`;
    const sellMap = new Map([...snap.byAssetSchedules.entries()].filter(([id]) => snap.revenue.bySellAsset.has(id)));
    const sellLines = poolMapByLine(sellMap, lineState).map(([id, , name]) => ({ name, rl: lineForAsset(lines, id) }));
    const sellKey = (k: string): string[] => sellLines.map((s) => (s.rl ? `rvc:${s.rl.key}:${k}` : '')).filter((x) => x && has(x));
    // The balance sheet reads the receivable and unearned balances as the schedules hold them,
    // NOT floored as the Revenue sheet's feed prints them (a negative balance stays negative).
    const sumRv = (keys: string[], t: number): string => keys.map((k) => rv(k, t)).join('+') || '0';
    const byLine = (tbl: string, rows: Array<{ label: string }>, k: string): string[] => {
      const out: string[] = [];
      const occ = new Map<string, number>();
      for (const s of sellLines) {
        const n = occ.get(s.name) ?? 0; occ.set(s.name, n + 1);
        const key = n ? `${F(tbl, s.name)}~${n}` : F(tbl, s.name);
        const src = s.rl && has(`rvc:${s.rl.key}:${k}`) ? `rvc:${s.rl.key}:${k}` : '';
        if (!rows.some((r) => r.label === s.name)) continue;
        row(key, (t) => (src ? rv(src, t) : '0'), 'last');
        out.push(key);
      }
      return out;
    };
    for (const tbl of feeders) {
      if (tbl.key === 'A1') {
        const close = newRow('schc:A1:close', 'sales receivables, closing', (t) => sumRv(sellKey('ar'), t));
        row(F('A1', 'Opening AR (project)'), (t) => prev(close, t), 'first');
        row(F('A1', '(+) Pre-Sales Sale Value'), (t) => sumRv(sellKey('preRev'), t), 'sumPrior');
        row(F('A1', '(−) Pre-Sales Cash Collected'), (t) => `-(${sumRv(sellKey('cashPre'), t)})`, 'sumPrior');
        row(F('A1', 'Closing AR (project total)'), (t) => at(close, t), 'last');
        byLine('A1', tbl.rows, 'ar');
        row(F('A1', 'Total Closing AR'), (t) => at(close, t), 'last');
      } else if (tbl.key === 'L2') {
        const close = newRow('schc:L2:close', 'unearned revenue, closing', (t) => sumRv(sellKey('ur'), t));
        row(F('L2', 'Opening unearned revenue (project)'), (t) => prev(close, t), 'first');
        row(F('L2', '(+) Pre-sales contracts signed (sale value)'), (t) => sumRv(sellKey('preRev'), t), 'sumPrior');
        row(F('L2', '(−) Revenue recognized (at handover)'), (t) => `-(${sumRv(sellKey('recPre'), t)})`, 'sumPrior');
        row(F('L2', 'Closing unearned revenue (project total)'), (t) => at(close, t), 'last');
        byLine('L2', tbl.rows, 'ur');
        row(F('L2', 'Total Closing Unearned Revenue'), (t) => at(close, t), 'last');
      } else if (tbl.key === 'A2') {
        const opKeys = lines.filter((l) => l.form !== 'sell').map((l) => `rvc:${l.key}:${l.form === 'operate' ? 'total' : 'rev'}`).filter(has);
        const rev = newRow('schc:A2:rev', 'operating revenue', (t) => sumRv(opKeys, t));
        const close = newRow('schc:A2:close', 'operating receivables, closing', (t) => `MAX(0,${at(rev, t)})*MAX(0,N(${w.ref('project:dso')}))/365`);
        row(F('A2', 'Opening AR'), (t) => prev(close, t), 'first');
        row(F('A2', '(+) Operating revenue billed'), (t) => at(rev, t), 'sumPrior');
        row(F('A2', '(−) Cash collected'), (t) => `-(${at(rev, t)}-(${at(close, t)}-${prev(close, t)}))`, 'sumPrior');
        row(F('A2', 'Closing AR'), (t) => at(close, t), 'last');
      } else if (tbl.key === 'A3') {
        // Each Sell plot's inventory, from the Cost of Sales working sheet; a plot
        // with no cost of sales row carries its platform value, pending (it holds interest).
        const invRows: string[] = [], cosRows: string[] = [];
        const pend: number[] = [];
        for (const [id, c] of snap.byAssetCostOfSales) {
          if (has(`cosc:${id}:inv`)) { invRows.push(`cosc:${id}:inv`); cosRows.push(`cosc:${id}:cos`); }
          else if (c.inventoryPerPeriod.some((v) => Math.abs(v) > 0)) pend.push(pendingRow(`schc:A3:${id}`, `${id}: inventory (pending)`, c.inventoryPerPeriod));
        }
        const cc = (k: string, t: number): string => w.refA({ sheet: 'Cost of Sales Calc', row: w.addr(k).row, col: 4 + t });
        const close = newRow('schc:A3:close', 'inventory, closing', (t) => [...invRows.map((k) => cc(k, t)), ...pend.map((r) => at(r, t))].join('+') || '0');
        const cos = newRow('schc:A3:cos', 'cost of sales', (t) => cosRows.map((k) => cc(k, t)).join('+') || '0');
        row(F('A3', 'Opening inventory'), (t) => prev(close, t), 'first');
        row(F('A3', '(+) Capex capitalized'), (t) => `${at(close, t)}-${prev(close, t)}+${at(cos, t)}`, 'sumPrior');
        row(F('A3', '(−) Released to Cost of Sales'), (t) => `-${at(cos, t)}`, 'sumPrior');
        row(F('A3', 'Closing inventory'), (t) => at(close, t), 'last');
      } else if (tbl.key === 'A4') {
        const B = (label: string): string => `esc||B. Escrow Balance Roll-Forward|${label}`;
        if (!has(B('Closing Balance'))) continue;
        const rc = (k: string, t: number): string => w.refA({ sheet: 'Revenue', row: w.addr(k).row, col: pc(t) });
        row(F('A4', 'Opening Balance'), (t) => (t === 0 ? '0' : rc(B('Closing Balance'), t - 1)), 'first');
        row(F('A4', '(+) Held this period'), (t) => rc(B('Total Additions'), t), 'sumPrior');
        row(F('A4', '(−) Release'), (t) => rc(B('Less: Release of Locked Funds'), t), 'sumPrior');
        row(F('A4', 'Closing Balance'), (t) => rc(B('Closing Balance'), t), 'last');
      } else if (tbl.key === 'L1') {
        const O = (label: string): string => `opex|__project__|ap|${label}`;
        if (!has(O('Closing AP'))) continue;
        const oc = (k: string, t: number): string => w.refA({ sheet: 'Opex', row: w.addr(k).row, col: pc(t) });
        row(F('L1', 'Opening AP'), (t) => oc(O('Opening AP'), t), 'first');
        row(F('L1', '(+) Opex incurred'), (t) => oc(O('Opex Incurred'), t), 'sumPrior');
        row(F('L1', '(−) Cash paid'), (t) => oc(O('Less: Cash Paid'), t), 'sumPrior');
        row(F('L1', 'Closing AP'), (t) => oc(O('Closing AP'), t), 'last');
      }
    }

    return [{
      sheet: SCH, status: 'partial' as const, formulas: w.formulas.get(SCH) ?? 0,
      note: 'Live: the land and depreciable roll-forwards per line and for the project (each year\'s capex its own straight-line vintage from the first operating year, the useful life on the inputs table, the exit write-off in the exit year), and the sales and operating receivables, inventory, escrow, payables and unearned revenue schedules. Capitalised interest, its depreciation and its NBV come out of the financing and wait for that stage, so the combined depreciation, NBV and inventory do not yet follow an input that moves it, and the IDC pool, debt, equity and retained earnings are the platform\'s values.',
    }];
  },
};
