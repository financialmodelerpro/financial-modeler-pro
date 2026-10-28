/**
 * stage4Schedules.ts (2026-09-27; on the visible tab 2026-10-15; made short 2026-10-28),
 * FORMULA-LINKED EXPORT, STAGE 4: SCHEDULES.
 *
 * Runs after Capex, Revenue and Opex, since it reads them. Every figure is a row on
 * the Schedules tab, laid out by `addSchedulesLive` (keys `fa|<host>|<id>` and
 * `cs|<line>|<id>`):
 *
 *   FIXED ASSETS, per held asset (Operate and Lease) as `computeAllFixedAssetResults`
 *     builds it. A helper row carries the useful life (B, from Inputs: the asset's own
 *     life, a blank taking its category default there), the first depreciation year
 *     (C, the year after the Timeline's handover year) and, each year, the year that
 *     year's additions start depreciating (the later of the two). Land: its plots'
 *     land value rows on Capex are the additions (land never depreciates). Building:
 *     the rest of Capex, plus the interest capitalised into the asset (the financing
 *     loop's rows, the one backward link); each year's additions depreciate straight
 *     line over the life from their start year (one SUMPRODUCT); the exit (the
 *     Timeline's exit flag) writes the balances off in the exit year. The capitalised
 *     interest's own depreciation and NBV are memo rows (the loop and the balance
 *     sheet read them). The project rows are SUMs of the assets'.
 *   COST OF SALES, per Sell line as `buildAssetCostOfSales` builds it: the line's
 *     capex plus its capitalised interest is the base, released on the share of the
 *     line's lifetime revenue recognised each year (Revenue's summary row); one
 *     inventory roll-forward; the project rows are SUMs.
 *
 * The working capital schedules (receivables, unearned revenue, escrow, payables) are
 * not repeated here: the Balance Sheet links Revenue and Opex, where they are worked out.
 *
 * WAITS FOR THE FINANCING: capitalised interest comes out of the circular solve, so
 * its cells hold the platform's values, marked pending, until the financing layer
 * writes their formulas into the same cells (`schv:<host>:idcAdd`, `cosc:<line>:idc`).
 *
 * REFUSES by name (the Schedules sheet stays values): Capex not live, reducing balance
 * depreciation, a phase overlap, existing operations carried in, plots of one line with
 * different lives, a life not on Inputs, an exit before the last year, a Sell plot
 * holding inventory with no cost of sales line.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { isLandValueLine, resolveUsefulLifeYears } from '@/src/core/calculations';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { planRevenueLines } from '../../revenueLines';
import { buildFixedAssetReport } from '../../reports/fixedAssetReports';
import { disposalContextOf } from '../../reports/disposalSchedules';
import { planReportLines, poolCapexByLine } from '../../reports/lineRows';
import { buildCapexReport } from '../../reports/capexReports';
import type { CostLine, Asset } from '../../state/module1-types';
import { usefulLifeCategory } from '../inputsSheetSections';

const SCH = 'Schedules';

/** A HELD ASSET'S USEFUL LIFE IN FORCE: column B of its depreciation helper row on Schedules. */
export function lifeInForce(w: LiveWriter, host: Asset, here?: string): string {
  const a = w.addr(`fain:${host.id}`);
  return w.refA({ sheet: a.sheet, row: a.row, col: PERIOD_COLS.META_B }, here);
}

/**
 * EACH YEAR'S ADDITION DEPRECIATES OVER THE LIFE FROM THE LATER OF ITS OWN YEAR AND THE FIRST
 * OPERATING YEAR: the rule the financing loop's fee-free solve uses. `addAll` is the additions
 * row across the years; `idxAll` and `idxNow` are Schedules' year-index row and this year's cell.
 */
export function vintageDepF(addAll: string, life: string, firstOp: string, idxAll: string, idxNow: string): string {
  const V = `((${idxAll}>${firstOp})*${idxAll}+(${idxAll}<=${firstOp})*${firstOp})`;
  return `IF(${life}>0,SUMPRODUCT((${addAll}>0)*${addAll}/MAX(1,${life})*(${V}<=${idxNow})*(${V}+MAX(1,INT(${life}))>${idxNow})),0)`;
}
/** The year number (1 = the first year) depreciation starts: column C of the asset's helper row. */
export function firstOperatingIdx(w: LiveWriter, phaseId: string, hostId?: string): string {
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
    const { TOTAL_COL, OPEN_COL, META_B } = PERIOD_COLS;
    const META_C = META_B + 1;
    const pc = (t: number): number => OPEN_COL + 1 + t;
    const w = new LiveWriter(wb, reg, ctx.pending);
    const has = (k: string): boolean => w.has(k);
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, state.project);
    const lineState = { assets: state.assets, phases: state.phases, parcels: state.parcels };
    const values = (note: string) => [{ sheet: SCH, status: 'values' as const, formulas: 0, note }];

    // ── Refusals ─────────────────────────────────────────────────────────────
    const refuse: string[] = [];
    if (!w.reg.keys().some((k) => k.startsWith('cxc:'))) refuse.push('Capex is not live for this model');
    const dCtx = disposalContextOf(snap);
    const booked = dCtx.booked;
    if (booked && dCtx.exitIdx < N - 1) refuse.push('the exit falls before the last year');
    if (booked && !has('tl:flag:exit')) refuse.push('the Timeline shows no exit year');
    const faAssets = state.assets.filter((a) => snap.fixedAssets.byAsset.has(a.id));
    for (const a of faAssets) {
      if ((a.depreciationMethod ?? 'straight_line') !== 'straight_line') refuse.push(`${a.name}: reducing balance depreciation`);
      const p = state.phases.find((x) => x.id === a.phaseId);
      if (p && (p.overlapPeriods ?? 0) !== 0) refuse.push(`${a.name}: a phase overlap, which the sheet does not show`);
      if ((a.historicalPreCapexLand ?? 0) > 0 || (a.historicalPreCapexBuilding ?? 0) > 0) refuse.push(`${a.name}: existing operations carried in`);
    }
    const report = buildFixedAssetReport({ fa: snap.fixedAssets, idc: snap.idc, state, dCtx });
    const faLines = report.groups.flatMap((g) => g.lines);
    for (const l of planReportLines(lineState, (a) => snap.fixedAssets.byAsset.has(a.id))) {
      const lives = new Set(l.assetIds.map((id) => resolveUsefulLifeYears(state.assets.find((a) => a.id === id)!)));
      if (lives.size > 1) refuse.push(`${l.assetIds.join(', ')}: plots of one line depreciate over different lives`);
    }
    for (const l of faLines) {
      const host = state.assets.find((a) => a.id === l.hostId)!;
      if (!has(`fa|${l.hostId}|help`)) refuse.push(`${host.name}: no fixed asset table`);
      if (!has(`falife:${host.id}`) || !has(`fadefault:${usefulLifeCategory(host)}`)) refuse.push(`${host.name}: its useful life is not on Inputs`);
      if (!has(`tl:flag:${host.phaseId}:hand`)) refuse.push(`${host.name}: the Timeline's handover year is not live`);
    }
    const cosLines = lines.filter((l) => l.form === 'sell' && has(`cs|${l.key}|cos`));
    for (const [id, c] of snap.byAssetCostOfSales) {
      if (c.inventoryPerPeriod.some((v) => Math.abs(v) > 0) && !cosLines.some((l) => l.members.some((m) => m.id === id))) refuse.push(`${id} holds inventory with no cost of sales line`);
    }
    for (const l of cosLines) if (!has(`rvc:${l.key}:recognised`)) refuse.push(`${l.label}: its revenue recognised is not on Revenue`);
    if (refuse.length) return values(`Schedules could not be made live for this model: ${[...new Set(refuse)].join('; ')}.`);

    // ── Writing helpers: one formula per row, period references column relative ──
    const here = SCH;
    const p = (key: string, t: number, dt = 0): string => { const a = w.addr(key); return w.refP({ sheet: a.sheet, row: a.row, col: pc(t) + dt }, here); };
    const fx = (key: string, col: number): string => { const a = w.addr(key); return w.refA({ sheet: a.sheet, row: a.row, col }, here); };
    const rng = (key: string): string => { const a = w.addr(key); return w.rangeA(a.sheet, a.row, pc(0), pc(N - 1)); };
    const row = (key: string, f: (t: number) => string, total: 'sum' | 'none'): void => {
      if (!has(key)) return;
      const r = w.addr(key).row;
      for (let t = 0; t < N; t++) w.fA({ sheet: SCH, row: r, col: pc(t) }, f(t));
      if (total === 'sum') w.fA({ sheet: SCH, row: r, col: TOTAL_COL }, `SUM(${w.rangeA(SCH, r, pc(0), pc(N - 1))})`);
    };
    /** The platform's values, marked pending: the financing layer writes the formula into these cells. */
    const pendingRow = (key: string): void => {
      if (!has(key)) return;
      const r = w.addr(key).row;
      for (let t = 0; t < N; t++) w.valueA({ sheet: SCH, row: r, col: pc(t) }, Number(w.platformValue({ sheet: SCH, row: r, col: pc(t) }) ?? 0), { pending: true });
      w.fA({ sheet: SCH, row: r, col: TOTAL_COL }, `SUM(${w.rangeA(SCH, r, pc(0), pc(N - 1))})`);
    };
    /** A total of rows on this tab: SUM over a block where they sit together, else SUM of the cells. */
    const sumOf = (keys: string[], t: number): string => {
      const ks = keys.filter(has);
      if (!ks.length) return '0';
      const rs = ks.map((k) => w.addr(k).row).sort((a, b) => a - b);
      for (const r of rs) w.refP({ sheet: SCH, row: r, col: pc(t) }, here);
      if (rs.length > 1 && rs.every((r, i) => i === 0 || r === rs[i - 1] + 1)) return `SUM(${p(ks.find((k) => w.addr(k).row === rs[0])!, t)}:${p(ks.find((k) => w.addr(k).row === rs[rs.length - 1])!, t)})`;
      return `SUM(${ks.map((k) => p(k, t)).join(',')})`;
    };
    const exit = (t: number): string => (booked ? w.refP({ sheet: 'Timeline', row: w.addr('tl:flag:exit').row, col: pc(t) }, here) : '0');
    const idxNow = (t: number): string => w.refP({ sheet: SCH, row: 4, col: pc(t) }, here);
    const claim = (name: string, key: string): void => { if (has(key)) w.claim(name, SCH, w.addr(key).row, 1); };
    const costLineOf = (id: string): Pick<CostLine, 'id' | 'catalogId'> => (state.costLines as CostLine[]).find((x) => x.id === id) ?? { id };
    const ROWS = ['landOpen', 'landAdd', 'landDisp', 'landClose', 'open', 'capAdd', 'idcAdd', 'dep', 'disp', 'close', 'idcDep', 'idcNbv'] as const;
    const CLAIMED = ['landAdd', 'landDisp', 'landClose', 'capAdd', 'idcAdd', 'dep', 'disp', 'close', 'idcDep', 'idcNbv'] as const;

    // ── Fixed assets, per held asset ─────────────────────────────────────────
    for (const l of faLines) {
      const host = state.assets.find((a) => a.id === l.hostId)!;
      const K = (id: string): string => `fa|${l.hostId}|${id}`;
      // The helper: the life in force (B), the first depreciation year (C), each year's start year.
      const hk = K('help');
      const ov = w.ref(`falife:${host.id}`), dflt = w.ref(`fadefault:${usefulLifeCategory(host)}`);
      w.fA({ sheet: SCH, row: w.addr(hk).row, col: META_B }, `IF(N(${ov})>0,N(${ov}),${dflt})`);
      const hand = w.addr(`tl:flag:${host.phaseId}:hand`);
      w.fA({ sheet: SCH, row: w.addr(hk).row, col: META_C }, `SUMPRODUCT(${w.rangeA('Timeline', hand.row, pc(0), pc(N - 1))},${w.rangeA('Timeline', 4, pc(0), pc(N - 1))})+1`);
      const life = fx(hk, META_B), first = fx(hk, META_C);
      row(hk, (t) => `MAX(${idxNow(t)},${first})`, 'none');
      // Each year's additions depreciate from their start year, over the life.
      const dep = (addKeys: string[]) => (t: number): string => {
        const adds = addKeys.filter(has).map((k) => rng(k));
        const sum = adds.length > 1 ? `(${adds.join('+')})` : adds[0];
        return `IF(${life}>0,SUMPRODUCT((${sum}>0)*${sum}*(${rng(hk)}<=${idxNow(t)})*(${rng(hk)}+MAX(1,INT(${life}))>${idxNow(t)}))/MAX(1,${life}),0)`;
      };
      // The asset's rows on Capex: Table 4 (excluding all land) is what depreciates, Table 2 less it is its land.
      const keys = l.memberIds.flatMap((id) => w.reg.keys().filter((k) => k.startsWith(`cxc:${id}:`) && k.split(':').length === 3));
      const landKeys = keys.filter((k) => isLandValueLine(costLineOf(k.split(':')[2])));
      const otherKeys = keys.filter((k) => !landKeys.includes(k));
      const c2 = l.memberIds.map((id) => `cx2:${id}`).find(has), c4 = l.memberIds.map((id) => `cx4:${id}`).find(has);
      const byTables = !!c2 && !!c4 && c2.slice(4) === c4.slice(4);
      const withIdc = has(K('idcAdd'));
      // Land.
      row(K('landOpen'), (t) => p(K('landClose'), t, -1), 'none');
      row(K('landAdd'), byTables ? (t) => `${p(c2!, t)}-${p(c4!, t)}` : (t) => landKeys.map((k) => p(k, t)).join('+') || '0', 'sum');
      row(K('landDisp'), (t) => `-${exit(t)}*(${p(K('landOpen'), t)}+${p(K('landAdd'), t)})`, 'sum');
      row(K('landClose'), (t) => `${p(K('landOpen'), t)}+${p(K('landAdd'), t)}${has(K('landDisp')) ? `+${p(K('landDisp'), t)}` : ''}`, 'none');
      // Building.
      row(K('open'), (t) => p(K('close'), t, -1), 'none');
      row(K('capAdd'), byTables ? (t) => p(c4!, t) : (t) => otherKeys.map((k) => p(k, t)).join('+') || '0', 'sum');
      if (withIdc) pendingRow(K('idcAdd'));
      const flows = [K('capAdd'), ...(withIdc ? [K('idcAdd')] : [])];
      row(K('dep'), (t) => `-${dep(flows)(t)}`, 'sum');
      const before = (t: number): string => `${p(K('open'), t)}+${p(K('capAdd'), t)}${withIdc ? `+${p(K('idcAdd'), t)}` : ''}+${p(K('dep'), t)}`;
      row(K('disp'), (t) => `-${exit(t)}*(${before(t)})`, 'sum');
      row(K('close'), (t) => `${before(t)}${has(K('disp')) ? `+${p(K('disp'), t)}` : ''}`, 'none');
      if (withIdc) {
        row(K('idcDep'), dep([K('idcAdd')]), 'sum');
        row(K('idcNbv'), (t) => `(1-${exit(t)})*(${p(K('idcNbv'), t, -1)}+${p(K('idcAdd'), t)}-${p(K('idcDep'), t)})`, 'none');
      }
      for (const name of CLAIMED) claim(`schv:${l.hostId}:${name}`, K(name));
    }
    // The project: each row the SUM of the assets' rows.
    {
      const K = (id: string): string => `fa|__project__|${id}`;
      for (const id of ROWS) {
        const parts = faLines.map((l) => `fa|${l.hostId}|${id}`).filter(has);
        row(K(id), (t) => sumOf(parts, t), id === 'landOpen' || id === 'landClose' || id === 'open' || id === 'close' || id === 'idcNbv' ? 'none' : 'sum');
      }
      for (const name of CLAIMED) claim(`schv:__project__:${name}`, K(name));
    }

    // ── Cost of sales and inventory, per Sell line ───────────────────────────
    const cosById = snap.byAssetCostOfSales;
    const anyNZ = (a: number[] | undefined): boolean => !!a && a.some((v) => (v ?? 0) !== 0);
    const capexLines = poolCapexByLine(buildCapexReport(snap, state), state).members;
    for (const l of cosLines) {
      const K = (id: string): string => `cs|${l.key}|${id}`;
      const parts = l.members.filter((m) => anyNZ(cosById.get(m.id)?.cos.perPeriod));
      // The line's capex: Capex's subtotal for the line where its plots are exactly these, else the plots' rows.
      const ids = new Set(parts.map((m) => m.id));
      const hostKey = [...capexLines].find(([, xs]) => xs.length === ids.size && xs.every((x) => ids.has(x)))?.[0];
      const plotRows = parts.flatMap((m) => w.reg.keys().filter((k) => k.startsWith(`cxc:${m.id}:`) && k.split(':').length === 3));
      row(K('capex'), (t) => (hostKey && has(`cx1sub:${hostKey}`) ? p(`cx1sub:${hostKey}`, t) : plotRows.map((k) => p(k, t)).join('+') || '0'), 'sum');
      pendingRow(K('idc'));
      row(K('base'), (t) => sumOf([K('capex'), K('idc')], t), 'sum');
      const rec = `rvc:${l.key}:recognised`;
      const recTot = fx(rec, TOTAL_COL);
      row(K('share'), (t) => `IF(${recTot}>0,MAX(0,${p(rec, t)})/${recTot},0)`, 'sum');
      const baseTot = fx(K('base'), TOTAL_COL);
      row(K('cos'), (t) => `IF(${baseTot}>0,${baseTot}*${p(K('share'), t)},0)`, 'sum');
      row(K('open'), (t) => p(K('close'), t, -1), 'none');
      row(K('add'), (t) => p(K('base'), t), 'sum');
      row(K('out'), (t) => `-${p(K('cos'), t)}`, 'sum');
      row(K('close'), (t) => `${p(K('open'), t)}+${p(K('add'), t)}+${p(K('out'), t)}`, 'none');
      for (const [name, id] of [['capex', 'capex'], ['idc', 'idc'], ['base', 'base'], ['share', 'share'], ['cos', 'cos'], ['inv', 'close']] as const) {
        const a = w.addr(K(id)); w.claim(`cosc:${l.key}:${name}`, a.sheet, a.row, 1);
      }
    }
    row('cs|__project__|cos', (t) => sumOf(cosLines.map((l) => `cs|${l.key}|cos`), t), 'sum');
    row('cs|__project__|inv', (t) => sumOf(cosLines.map((l) => `cs|${l.key}|close`), t), 'none');
    claim('schv:A3:close', 'cs|__project__|inv');

    return [{
      sheet: SCH, status: 'partial' as const, formulas: w.formulas.get(SCH) ?? 0,
      note: 'Live: one fixed asset table per held asset and the project (each year\'s capex and capitalised interest depreciating straight line from its start year over the useful life on Inputs, the exit write-off in the exit year), and one cost of sales and inventory block per Sell line and the project, every figure a row on the tab. The Balance Sheet reads receivables, unearned revenue, escrow and payables from Revenue and Opex.',
      waits: {
        on: 'financing',
        text: 'Capitalised interest comes out of the financing and waits for that stage, so depreciation, NBV, cost of sales and inventory do not yet follow an input that moves it.',
        after: 'Capitalised interest reads the live financing solve.',
      },
    }];
  },
};
