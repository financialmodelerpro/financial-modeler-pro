/**
 * stage4Schedules.ts (2026-09-27; on the visible tab 2026-10-15), FORMULA-LINKED
 * EXPORT, STAGE 4: SCHEDULES.
 *
 * Runs after Capex, Revenue, Cost of Sales and Opex, since it reads all four. Every
 * figure is a row on the Schedules tab:
 *
 *   FIXED ASSETS & D&A, per held line (Operate and Lease) as
 *     `computeAllFixedAssetResults` builds it: the line's plots' land value rows on
 *     Capex are its land additions (land never depreciates), the rest of their rows
 *     its depreciable additions. Each year's addition depreciates straight line from
 *     the later of its own year and the first operating year, over the line's useful
 *     life: one SUMPRODUCT over the additions row and the index row, on its own row
 *     ("of which: on capex") where interest was capitalised. NBV is floored at zero;
 *     the exit (the Timeline's exit flag) writes the balances off in the exit year.
 *     The project tables add the lines.
 *   BS SCHEDULES: the sales receivables and unearned revenue roll forward from
 *     Revenue's rows; the operating receivables close on the feed's rows; inventory
 *     rolls forward from the cost of sales rows; escrow and payables read Revenue
 *     and Opex.
 *
 * WAITS FOR THE FINANCING: interest capitalised into a held line, its depreciation
 * and its NBV come out of the circular solve, so those cells hold the platform's
 * values, marked pending, until the financing layer writes their formulas into the
 * same cells (the `schv:` keys below). Debt, equity and retained earnings are the
 * Balance Sheet's (stage 8).
 *
 * REFUSES by name (the Schedules sheet stays values): Capex not live, reducing
 * balance depreciation, a phase overlap, existing operations carried in, plots of one
 * line with different lives, an exit before the last year, an operating receivable
 * year that is not 365 days, a Sell plot holding inventory with no cost of sales line.
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
import { buildFixedAssetReport, type FixedAssetTable } from '../../reports/fixedAssetReports';
import { disposalContextOf } from '../../reports/disposalSchedules';
import { buildBsFeederTables } from '../../reports/m4Reports';
import { planReportLines, poolMapByLine } from '../../reports/lineRows';
import type { Asset, CostLine, Phase } from '../../state/module1-types';
import { usefulLifeCategory } from '../inputsSheetSections';

const SCH = 'Schedules';

/**
 * A HELD LINE'S USEFUL LIFE IN FORCE: the life on the Schedules inputs table, a blank or
 * zero inheriting the category default (`resolveUsefulLifeYears`). The one formula every
 * reader of the life uses (this layer and the financing solve).
 */
export function lifeInForce(w: LiveWriter, host: Asset, here?: string): string {
  const a = w.addr(`fain:${host.id}`);
  const life = w.refA({ sheet: a.sheet, row: a.row, col: PERIOD_COLS.TOTAL_COL }, here);
  // The table's cell IS the life in force (written from Inputs below); no default is typed in a formula.
  if (w.has(`falife:${host.id}`)) return life;
  const dflt = resolveUsefulLifeYears({ ...host, usefulLifeYears: undefined } as Asset);
  return `IF(N(${life})>0,N(${life}),${dflt})`;
}

/**
 * EACH YEAR'S ADDITION DEPRECIATES OVER THE LIFE FROM THE LATER OF ITS OWN YEAR AND THE FIRST
 * OPERATING YEAR: the one rule, here and in the financing loop's fee-free solve. `addAll` is the
 * additions row across the years; `idxAll` and `idxNow` are Schedules' year-index row and this year's cell.
 */
export function vintageDepF(addAll: string, life: string, firstOp: string, idxAll: string, idxNow: string): string {
  const V = `((${idxAll}>${firstOp})*${idxAll}+(${idxAll}<=${firstOp})*${firstOp})`;
  return `IF(${life}>0,SUMPRODUCT((${addAll}>0)*${addAll}/MAX(1,${life})*(${V}<=${idxNow})*(${V}+MAX(1,INT(${life}))>${idxNow})),0)`;
}
/** The year index (1 = the first year) of a phase's first operating year, from the Timeline's phase table. */
export function firstOperatingIdx(w: LiveWriter, phaseId: string, hostId?: string): string {
  // The held line's own cell on the depreciation inputs table, where the live layout carries one.
  if (hostId && w.has(`fafirst:${hostId}`)) return w.ref(`fafirst:${hostId}`);
  return `(MAX(0,YEAR(${w.ref(`tl:phase:${phaseId}:cs`)})-${w.ref('project:axisYear')})+MAX(0,${w.ref(`tl:phase:${phaseId}:cp`)})+1)`;
}

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
    if (!w.reg.keys().some((k) => k.startsWith('cxc:'))) refuse.push('Capex is not live for this model');
    const dCtx = disposalContextOf(snap);
    if (dCtx.booked && dCtx.exitIdx < N - 1) refuse.push('the exit falls before the last year');
    if (dCtx.booked && !has('tl:flag:exit')) refuse.push('the Timeline shows no exit year');
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
      if (!has(`fain:${l.assetIds[0]}`)) refuse.push(`${l.assetIds[0]}: no life on the inputs table`);
    }
    const oparKeys = lines.filter((l) => l.form !== 'sell').map((l) => `rvc:${l.key}:opar`).filter(has);
    const arDays = state.project.operatingAr?.daysPerYear;
    if (arDays !== undefined && arDays !== 365) refuse.push('the operating receivables use a year that is not 365 days, which the sheet does not show');
    const invLines = lines.filter((l) => l.form === 'sell' && has(`cosc:${l.key}:inv`));
    for (const [id, c] of snap.byAssetCostOfSales) {
      if (c.inventoryPerPeriod.some((v) => Math.abs(v) > 0) && !invLines.some((l) => l.members.some((m) => m.id === id))) refuse.push(`${id} holds inventory with no cost of sales line`);
    }
    if (refuse.length) return values(`Schedules could not be made live for this model: ${[...new Set(refuse)].join('; ')}.`);

    // ── Writing helpers: one formula per row, period references column relative ──
    const here = SCH;
    const p = (key: string, t: number, dt = 0): string => { const a = w.addr(key); return w.refP({ sheet: a.sheet, row: a.row, col: pc(t) + dt }, here); };
    const fx = (key: string, col: number): string => { const a = w.addr(key); return w.refA({ sheet: a.sheet, row: a.row, col }, here); };
    const row = (key: string, f: (t: number) => string, total: 'sum' | 'last' | 'first' | 'sumPrior' | 'none'): void => {
      if (!has(key)) return;
      const r = w.addr(key).row;
      for (let t = 0; t < N; t++) w.fA({ sheet: SCH, row: r, col: pc(t) }, f(t));
      const rng = (): string => w.rangeA(SCH, r, pc(0), pc(N - 1));
      if (total === 'sum') w.fA({ sheet: SCH, row: r, col: TOTAL_COL }, `SUM(${rng()})`);
      else if (total === 'sumPrior') w.fA({ sheet: SCH, row: r, col: TOTAL_COL }, `SUM(${rng()})+N(${w.refA({ sheet: SCH, row: r, col: OPEN_COL }, here)})`);
      else if (total === 'last') w.fA({ sheet: SCH, row: r, col: TOTAL_COL }, w.refA({ sheet: SCH, row: r, col: pc(N - 1) }, here));
      else if (total === 'first') w.fA({ sheet: SCH, row: r, col: TOTAL_COL }, w.refA({ sheet: SCH, row: r, col: pc(0) }, here));
    };
    /** The platform's values, marked pending: the financing layer writes the formula into these cells. */
    const pendingRow = (key: string, vals: readonly number[], total: 'sum' | 'last'): void => {
      if (!has(key)) return;
      const r = w.addr(key).row;
      for (let t = 0; t < N; t++) w.valueA({ sheet: SCH, row: r, col: pc(t) }, vals[t] ?? 0, { pending: true });
      if (total === 'sum') w.fA({ sheet: SCH, row: r, col: TOTAL_COL }, `SUM(${w.rangeA(SCH, r, pc(0), pc(N - 1))})`);
      else w.fA({ sheet: SCH, row: r, col: TOTAL_COL }, w.refA({ sheet: SCH, row: r, col: pc(N - 1) }, here));
    };
    const plat = (key: string): number[] => Array.from({ length: N }, (_, t) => Number(w.platformValue({ sheet: SCH, row: w.addr(key).row, col: pc(t) }) ?? 0));
    const booked = dCtx.booked;
    const exit = (t: number): string => (booked ? w.refP({ sheet: 'Timeline', row: w.addr('tl:flag:exit').row, col: pc(t) }, here) : '0');
    const idxRow = (t: number): string => w.refP({ sheet: SCH, row: 4, col: pc(t) }, here);
    const idxAll = (): string => w.rangeA(SCH, 4, pc(0), pc(N - 1));
    const claim = (name: string, key: string): void => { if (has(key)) w.claim(name, SCH, w.addr(key).row, 1); };
    const costLineOf = (id: string): Pick<CostLine, 'id' | 'catalogId'> => (state.costLines as CostLine[]).find((x) => x.id === id) ?? { id };

    // ── Fixed assets, per held line ──────────────────────────────────────────
    const report = buildFixedAssetReport({ fa: snap.fixedAssets, idc: snap.idc, state, dCtx });
    const find = (t: FixedAssetTable, kind: string, keyBase: string, pred: (label: string) => boolean): string | undefined => {
      const r = t.rows.find((x) => pred(x.label));
      return r ? `sch|${keyBase}|${kind}|${r.label}` : undefined;
    };
    interface Rows { landAdd: string; landOpen: string; landDisp?: string; landClose: string; open: string; capAdd: string; idcAdd?: string; idcDep?: string; dep: string; capDep: string; disp?: string; close: string; capNbv: string; idcNbv?: string; accum?: string; tot: FixedAssetTable }
    const rowsOf = (keyBase: string, land: FixedAssetTable, dep: FixedAssetTable, tot: FixedAssetTable): Rows | null => {
      const L = (pred: (s: string) => boolean): string | undefined => find(land, 'land', keyBase, pred);
      const D = (pred: (s: string) => boolean): string | undefined => find(dep, 'dep', keyBase, pred);
      const withIdc = dep.rows.some((r) => r.label.includes('IDC'));
      const capDepKey = `sch|${keyBase}|dep|   of which: on capex`;
      const idcDepKey = `sch|${keyBase}|dep|   of which: on capitalised interest`;
      const out = {
        landAdd: L((s) => s === '(+) Land Additions'), landOpen: L((s) => s === 'Opening Land'), landDisp: L((s) => s.startsWith('(−) Land Disposed')), landClose: L((s) => s === 'Closing Land'),
        open: D((s) => s.startsWith('Opening NBV')), capAdd: D((s) => s === '(+) Capex Additions'), idcAdd: D((s) => s.startsWith('(+) IDC Additions')),
        dep: D((s) => s.startsWith('(−) Depreciation')), capDep: withIdc ? capDepKey : D((s) => s.startsWith('(−) Depreciation')), idcDep: withIdc ? idcDepKey : undefined,
        disp: D((s) => s.startsWith('(−) Disposed at Exit')), close: D((s) => s.startsWith('Closing NBV')),
        capNbv: withIdc ? D((s) => s.includes('of which: Capex NBV')) : D((s) => s.startsWith('Closing NBV')),
        idcNbv: D((s) => s.includes('of which: IDC NBV')), accum: D((s) => s.startsWith('Accumulated')), tot,
      };
      if (!out.landAdd || !out.landOpen || !out.landClose || !out.open || !out.capAdd || !out.dep || !out.capDep || !out.close || !out.capNbv || !has(out.capDep)) return null;
      if (withIdc && (!out.idcAdd || !out.idcNbv || !has(idcDepKey))) return null;
      return out as Rows;
    };
    /** Write a line's (or the project's) three tables. `capDepF` and the additions come from the caller. */
    /** `idc`: the interest additions (null: the financing loop writes them) and their depreciation. */
    const writeTables = (keyBase: string, r: Rows, landAddF: (t: number) => string, capAddF: (t: number) => string, capDepF: ((t: number) => string) | null, idc: { add: ((t: number) => string) | null; dep: (t: number) => string } | null): void => {
      const withIdc = !!r.idcAdd;
      // Land.
      row(r.landAdd, landAddF, 'sum');
      row(r.landOpen, (t) => p(r.landClose, t, -1), 'last');
      if (r.landDisp) row(r.landDisp, (t) => `-(${exit(t)}*(${p(r.landOpen, t)}+${p(r.landAdd, t)}))`, 'sum');
      row(r.landClose, (t) => `${p(r.landOpen, t)}+${p(r.landAdd, t)}${r.landDisp ? `+${p(r.landDisp, t)}` : ''}`, 'last');
      // Depreciable: additions, the capex depreciation, the capex NBV.
      row(r.capAdd, capAddF, 'sum');
      const capDepPos = (t: number): string => (withIdc ? p(r.capDep, t) : `-${p(r.dep, t)}`);
      if (capDepF) row(r.capDep, withIdc ? capDepF : (t) => `-(${capDepF(t)})`, 'sum');
      const capPre = (t: number): string => `MAX(0,${p(r.capNbv, t, -1)}+${p(r.capAdd, t)}-${capDepPos(t)})`;
      row(r.capNbv, (t) => `(1-${exit(t)})*${capPre(t)}`, 'last');
      if (withIdc && idc) {
        // CAPITALISED INTEREST: its additions are the financing loop's (written into these cells
        // by the loop, the one backward link); its depreciation, NBV and write-off are worked
        // out here, by the rule capex follows.
        if (idc.add) row(r.idcAdd!, idc.add, 'sum'); else pendingRow(r.idcAdd!, plat(r.idcAdd!), 'sum');
        row(r.idcDep!, idc.dep, 'sum');
        row(r.dep, (t) => `-(${p(r.capDep, t)}+${p(r.idcDep!, t)})`, 'sum');
        const idcPre = (t: number): string => `MAX(0,${p(r.idcNbv!, t, -1)}+${p(r.idcAdd!, t)}-${p(r.idcDep!, t)})`;
        if (r.disp) row(r.disp, (t) => `-(${exit(t)}*(${capPre(t)}+${idcPre(t)}))`, 'sum');
        row(r.idcNbv!, (t) => `(1-${exit(t)})*${idcPre(t)}`, 'last');
        row(r.close, (t) => `${p(r.capNbv, t)}+${p(r.idcNbv!, t)}`, 'last');
      } else if (r.disp) row(r.disp, (t) => `-(${exit(t)}*${capPre(t)})`, 'sum');
      row(r.open, (t) => p(r.close, t, -1), 'last');
      if (r.accum) row(r.accum, (t) => `(1-${exit(t)})*(${p(r.accum!, t, -1)}+${capDepPos(t)})`, 'last');
      // Total: land and depreciable.
      for (const x of r.tot.rows) {
        const key = `sch|${keyBase}|total|${x.label}`;
        const L = x.label;
        if (L === 'Opening Land') row(key, (t) => p(r.landOpen, t), 'last');
        else if (L.startsWith('Opening Depreciable')) row(key, (t) => p(r.open, t), 'last');
        else if (L === 'Opening Fixed Assets') row(key, (t) => `${p(r.landOpen, t)}+${p(r.open, t)}`, 'last');
        else if (L.startsWith('(−) Disposed at Exit')) row(key, (t) => [r.landDisp, r.disp].filter((k): k is string => !!k).map((k) => p(k, t)).join('+') || '0', 'sum');
        else if (L === 'Closing Land') row(key, (t) => p(r.landClose, t), 'last');
        else if (L.startsWith('Closing Depreciable')) row(key, (t) => p(r.close, t), 'last');
        else if (L === 'Closing Fixed Assets') row(key, (t) => `${p(r.landClose, t)}+${p(r.close, t)}`, 'last');
        else throw new Error(`Schedules: no rule for the row "${L}" (total)`);
      }
      // The rows later layers read.
      for (const [name, k] of Object.entries({ landAdd: r.landAdd, landDisp: r.landDisp, landClose: r.landClose, capAdd: r.capAdd, capDep: r.capDep, dep: r.dep, disp: r.disp, capNbv: r.capNbv, idcAdd: r.idcAdd, idcDep: r.idcDep, idcNbv: r.idcNbv, close: r.close })) {
        if (k) claim(`schv:${keyBase}:${name}`, k);
      }
    };

    const lineRows = new Map<string, Rows>();
    for (const gr of report.groups) {
      for (const l of gr.lines) {
        const r = rowsOf(l.hostId, l.land, l.depreciable, l.total);
        if (!r) return values(`Schedules could not be made live for this model: ${l.title}'s tables do not carry the rows the formulas need.`);
        const host = state.assets.find((a) => a.id === l.hostId)!;
        const p0 = phases.find((x) => x.id === host.phaseId)!;
        const keys = l.memberIds.flatMap((id) => w.reg.keys().filter((k) => k.startsWith(`cxc:${id}:`) && k.split(':').length === 3));
        const landKeys = keys.filter((k) => isLandValueLine(costLineOf(k.split(':')[2])));
        const otherKeys = keys.filter((k) => !landKeys.includes(k));
        // The life, and the year index of the first operating year.
        const Lf = (): string => lifeInForce(w, host, here);
        const inputs = w.addr(`fain:${host.id}`);
        // The life in force: the life typed on Inputs, a blank taking its category's default there.
        const dk = `fadefault:${usefulLifeCategory(host)}`;
        if (w.has(`falife:${host.id}`) && w.has(dk)) {
          const ov = w.ref(`falife:${host.id}`);
          w.fA({ sheet: SCH, row: inputs.row, col: TOTAL_COL }, `IF(N(${ov})>0,N(${ov}),${w.ref(dk)})`);
        }
        w.fA({ sheet: SCH, row: inputs.row, col: OPEN_COL }, `IF(${Lf()}>0,1/${Lf()},0)`);
        // The year depreciation starts (the first operating year, as a model year number).
        if (w.has(`fafirst:${host.id}`)) w.f(`fafirst:${host.id}`, firstOperatingIdx(w, p0.id));
        // Each year's addition depreciates from the later of its own year and the first operating year.
        const vintageDep = (addKey: string) => (t: number): string => vintageDepF(w.rangeA(SCH, w.addr(addKey).row, pc(0), pc(N - 1)), Lf(), firstOperatingIdx(w, p0.id, host.id), idxAll(), idxRow(t));
        // The asset's rows on Capex: Table 4 (excluding all land) is what depreciates, Table 2 less it is its land.
        const c2 = l.memberIds.map((id) => `cx2:${id}`).find((k) => w.has(k)), c4 = l.memberIds.map((id) => `cx4:${id}`).find((k) => w.has(k));
        const byTables = !!c2 && !!c4 && c2.slice(4) === c4.slice(4);
        writeTables(l.hostId, r,
          byTables ? (t) => `${p(c2!, t)}-${p(c4!, t)}` : (t) => landKeys.map((k) => p(k, t)).join('+') || '0',
          byTables ? (t) => p(c4!, t) : (t) => otherKeys.map((k) => p(k, t)).join('+') || '0', vintageDep(r.capAdd),
          r.idcAdd ? { add: null, dep: vintageDep(r.idcAdd) } : null);
        lineRows.set(l.hostId, r);
        w.claim(`schc:${host.id}:life`, inputs.sheet, inputs.row, TOTAL_COL);
      }
    }
    // The project: the lines added.
    {
      const pr = rowsOf('__project__', report.project.land, report.project.depreciable, report.project.total);
      if (!pr) return values('Schedules could not be made live for this model: the project tables do not carry the rows the formulas need.');
      const ls = [...lineRows.values()];
      const sum = (pick: (x: Rows) => string | ((t: number) => string)) => (t: number): string => ls.map((x) => { const v = pick(x); return typeof v === 'string' ? p(v, t) : v(t); }).join('+') || '0';
      const capDepOf = (x: Rows): string | ((t: number) => string) => (x.idcAdd ? x.capDep : (t: number) => `(-${p(x.dep, t)})`);
      const zero = (): string => '0';
      writeTables('__project__', pr, sum((x) => x.landAdd), sum((x) => x.capAdd), pr.idcAdd ? sum(capDepOf) : (t) => `-(${sum((x) => x.dep)(t)})`,
        pr.idcAdd ? { add: sum((x) => x.idcAdd ?? zero), dep: sum((x) => x.idcDep ?? zero) } : null);
    }
    // The capitalised interest pool's per-line additions read the financing (stage 8).

    // ── BS Schedules ─────────────────────────────────────────────────────────
    const feeders = buildBsFeederTables({ snap, state, fmt: (v: number) => String(v) });
    const F = (tbl: string, label: string): string => `sch|${tbl}||${label}`;
    const sellMap = new Map([...snap.byAssetSchedules.entries()].filter(([id]) => snap.revenue.bySellAsset.has(id)));
    const sellLines = poolMapByLine(sellMap, lineState).map(([id, , name]) => ({ name, rl: lineForAsset(lines, id) }));
    const sellKey = (k: string): string[] => sellLines.map((s) => (s.rl ? `rvc:${s.rl.key}:${k}` : '')).filter((x) => x && has(x));
    // The balance sheet reads the receivable and unearned balances as Revenue holds them, not floored.
    const sumP = (keys: string[], t: number): string => keys.map((k) => p(k, t)).join('+') || '0';
    const byLine = (tbl: string, rowsT: Array<{ label: string }>, k: string): string[] => {
      const out: string[] = [];
      const occ = new Map<string, number>();
      for (const s of sellLines) {
        const n = occ.get(s.name) ?? 0; occ.set(s.name, n + 1);
        const key = n ? `${F(tbl, s.name)}~${n}` : F(tbl, s.name);
        const src = s.rl && has(`rvc:${s.rl.key}:${k}`) ? `rvc:${s.rl.key}:${k}` : '';
        if (!rowsT.some((r) => r.label === s.name)) continue;
        row(key, (t) => (src ? p(src, t) : '0'), 'last');
        out.push(key);
      }
      return out;
    };
    for (const tbl of feeders) {
      if (tbl.key === 'A1') {
        const C = F('A1', 'Closing AR (project total)');
        row(F('A1', 'Opening AR (project)'), (t) => p(C, t, -1), 'first');
        row(F('A1', '(+) Pre-Sales Sale Value'), (t) => sumP(sellKey('preRev'), t), 'sumPrior');
        row(F('A1', '(−) Pre-Sales Cash Collected'), (t) => `-(${sumP(sellKey('cashPre'), t)})`, 'sumPrior');
        row(C, (t) => `${p(F('A1', 'Opening AR (project)'), t)}+${p(F('A1', '(+) Pre-Sales Sale Value'), t)}+${p(F('A1', '(−) Pre-Sales Cash Collected'), t)}`, 'last');
        const ks = byLine('A1', tbl.rows, 'ar');
        row(F('A1', 'Total Closing AR'), (t) => sumP(ks, t), 'last');
      } else if (tbl.key === 'L2') {
        const C = F('L2', 'Closing unearned revenue (project total)');
        row(F('L2', 'Opening unearned revenue (project)'), (t) => p(C, t, -1), 'first');
        row(F('L2', '(+) Pre-sales contracts signed (sale value)'), (t) => sumP(sellKey('preRev'), t), 'sumPrior');
        row(F('L2', '(−) Revenue recognized (at handover)'), (t) => `-(${sumP(sellKey('recPre'), t)})`, 'sumPrior');
        row(C, (t) => `${p(F('L2', 'Opening unearned revenue (project)'), t)}+${p(F('L2', '(+) Pre-sales contracts signed (sale value)'), t)}+${p(F('L2', '(−) Revenue recognized (at handover)'), t)}`, 'last');
        const ks = byLine('L2', tbl.rows, 'ur');
        row(F('L2', 'Total Closing Unearned Revenue'), (t) => sumP(ks, t), 'last');
      } else if (tbl.key === 'A2') {
        const opKeys = lines.filter((l) => l.form !== 'sell').map((l) => `rvc:${l.key}:${l.form === 'operate' ? 'total' : 'rev'}`).filter(has);
        const C = F('A2', 'Closing AR');
        row(F('A2', 'Opening AR'), (t) => p(C, t, -1), 'first');
        row(F('A2', '(+) Operating revenue billed'), (t) => sumP(opKeys, t), 'sumPrior');
        row(C, (t) => sumP(oparKeys, t), 'last');
        row(F('A2', '(−) Cash collected'), (t) => `${p(C, t)}-${p(F('A2', 'Opening AR'), t)}-${p(F('A2', '(+) Operating revenue billed'), t)}`, 'sumPrior');
      } else if (tbl.key === 'A3') {
        const C = F('A3', 'Closing inventory');
        row(F('A3', 'Opening inventory'), (t) => p(C, t, -1), 'first');
        row(F('A3', '(+) Capex capitalized'), (t) => sumP(invLines.map((l) => `cosc:${l.key}:base`).filter(has), t), 'sumPrior');
        row(F('A3', '(−) Released to Cost of Sales'), (t) => `-(${sumP(invLines.map((l) => `cosc:${l.key}:cos`).filter(has), t)})`, 'sumPrior');
        row(C, (t) => `${p(F('A3', 'Opening inventory'), t)}+${p(F('A3', '(+) Capex capitalized'), t)}+${p(F('A3', '(−) Released to Cost of Sales'), t)}`, 'last');
      } else if (tbl.key === 'A4') {
        const B = (label: string): string => `esc||B. Escrow Balance Roll-Forward|${label}`;
        if (!has(B('Closing Balance'))) continue;
        row(F('A4', 'Opening Balance'), (t) => p(B('Closing Balance'), t, -1), 'first');
        row(F('A4', '(+) Held this period'), (t) => p(B('Total Additions'), t), 'sumPrior');
        row(F('A4', '(−) Release'), (t) => p(B('Less: Release of Locked Funds'), t), 'sumPrior');
        row(F('A4', 'Closing Balance'), (t) => p(B('Closing Balance'), t), 'last');
      } else if (tbl.key === 'L1') {
        // Opex's project roll-forward (2026-10-28): cash paid is a positive row there, an outflow here.
        if (!has('ox|ap|close')) continue;
        row(F('L1', 'Opening AP'), (t) => p('ox|ap|open', t), 'first');
        row(F('L1', '(+) Opex incurred'), (t) => p('ox|ap|inc', t), 'sumPrior');
        row(F('L1', '(−) Cash paid'), (t) => `-${p('ox|ap|paid', t)}`, 'sumPrior');
        row(F('L1', 'Closing AP'), (t) => p('ox|ap|close', t), 'last');
      }
    }
    claim('schv:A3:close', F('A3', 'Closing inventory'));

    return [{
      sheet: SCH, status: 'partial' as const, formulas: w.formulas.get(SCH) ?? 0,
      note: 'Live: the land and depreciable roll-forwards per line and for the project (each year\'s capex its own straight-line vintage from the first operating year, the useful life on the inputs table, the exit write-off in the exit year), and the sales and operating receivables, inventory, escrow, payables and unearned revenue schedules, every figure a row on the tab.',
      waits: {
        on: 'financing',
        text: 'Capitalised interest, its depreciation and its NBV come out of the financing and wait for that stage, so the combined depreciation, NBV and inventory do not yet follow an input that moves it.',
        after: 'Capitalised interest, its depreciation and its NBV per line and for the project read the live financing solve.',
      },
    }];
  },
};
