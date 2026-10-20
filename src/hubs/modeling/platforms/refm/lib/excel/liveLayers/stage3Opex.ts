/**
 * stage3Opex.ts (2026-09-27, rebuilt 2026-10-14), FORMULA-LINKED EXPORT: OPEX.
 *
 * EVERY FIGURE ON THE OPEX TAB IS BUILT FROM ROWS ON THE TABS (founder,
 * 2026-10-14). There is no working sheet: each line's operating statement
 * carries the two things its costs read that no other tab shows (the years it
 * operates and its inflation factor), every cost line is a row, zeros and
 * switched-off lines included, and every total sums the rows above it.
 *
 *   In operations   the phase's handover and operating years on the Timeline,
 *                   from the line's operations start year on Revenue (the
 *                   engine's window, opex-resolvers `resolveOpsWindow`)
 *   Inflation       the factor while operating, counted from the later of the
 *                   year typed on Inputs and the line's first operating year
 *                   (assetOpex.ts, 2026-10-05)
 *   A cost line     a fixed amount x the factor, a rate per key or per sqm of
 *                   leasable area (Revenue's figures) x the factor, or a share
 *                   of a revenue row on this statement while operating; a line
 *                   on GOP takes its share of the statement's GOP. Off is zero.
 *   Totals          each group sums its lines; GOP, EBITDA and the operating
 *                   summaries follow; HQ overheads are a fixed amount x the HQ
 *                   factor or a share of Revenue's project sales value
 *   Payables        closing = opex x DPO / days, opening = last year's closing,
 *                   cash paid = opex less the change
 *
 * Inputs are typed on Inputs and shown on the cards here: the value and On /
 * Off of every line, the inflation rate and start year, the DPO days and the
 * days basis. A line's mode and category are the structure of its formula and
 * are fixed at export.
 *
 * REFUSES by name (Opex stays values): the Timeline or Revenue rows it reads
 * are not live, a year-by-year rate, an inflation other than none, compounding
 * or one step, a line with its own inflation, a line on GOP that is itself a
 * departmental or undistributed cost (or sits on a lease line, which has no
 * GOP), a phase overlap, a line whose opex sits on more than one plot, an
 * asset running on the default seed the sheet does not show, an exit before
 * the last year, and a project start date in a different year from the first
 * phase's.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import type { CellAddr } from '../cellRegistry';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { normalizeOpexIndexation, hqOpexLinesInForce, type OpexLine } from '@/src/core/calculations/opex';
import { isRevenueSubUnit } from '@/src/core/calculations';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { planRevenueLines, lineForAsset, type RevenueLine } from '../../revenueLines';
import { revenueLineName } from '../../reports/revenueOutputReports';
import { buildOpexReport, leaseCostBucket, type LeaseCostBucket } from '../../reports/opexReports';
import { hospitalityCostGroup, HOSPITALITY_COST_GROUPS, type HospitalityCostGroup } from '../../reports/hospitalityStatement';
import { planReportLines } from '../../reports/lineRows';
import type { Asset, Phase } from '../../state/module1-types';

const OPEX = 'Opex';
const IDX_METHODS = new Set(['none', 'yoy_compound', 'single_rate']);
const FIXED_MODES = new Set(['fixed_baseline', 'per_room_year', 'per_sqm_year']);
const DIRECT = new Set(['direct_rooms', 'direct_fb', 'direct_other']);
const INDIRECT = new Set(['indirect_ga', 'indirect_it', 'indirect_sm', 'indirect_pom', 'indirect_energy', 'indirect_eosb']);
const MGMT = new Set(['mgmt_base', 'mgmt_tech', 'mgmt_incentive', 'replacement_reserve']);

type Idx = { method?: string; rate?: number; startYear?: number };
/** The engine's project-total bucket for a category (opex-resolvers `projectTotals`). */
type Bucket = 'direct' | 'indirect' | 'mgmt' | 'other';
const bucketOf = (cat: string): Bucket => (DIRECT.has(cat) ? 'direct' : INDIRECT.has(cat) ? 'indirect' : MGMT.has(cat) ? 'mgmt' : 'other');

export const stage3Opex: LiveLayer = {
  name: 'stage 3c: opex',
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
    const project = state.project;
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, project);
    const lineState = { assets: state.assets, phases: state.phases, parcels: state.parcels };
    const values = (note: string) => [{ sheet: OPEX, status: 'values' as const, formulas: 0, note }];

    // ── Which assets carry opex, and refusals ────────────────────────────────
    const opexAssets = state.assets.filter((a) => (a.strategy === 'Operate' || a.strategy === 'Lease') && snap.opex.byAsset.has(a.id));
    const refuse: string[] = [];
    const idxOf = (cfg: unknown): Idx => normalizeOpexIndexation(cfg) as Idx;
    if (new Date(project.startDate).getUTCFullYear() !== snap.projectStartYear) refuse.push('the project start date falls in a different year from the first phase\'s start, which the operating years do not show');
    const cardHosts = new Set(planReportLines(lineState, (a) => a.strategy === 'Operate' || a.strategy === 'Lease').map((l) => l.assetIds[0]));
    for (const a of opexAssets) {
      const name = a.name;
      const stored = (a.opex?.lines ?? []) as OpexLine[];
      if (stored.length === 0) { refuse.push(`${name}: opex runs on the default seed, which the sheet does not show`); continue; }
      if (!cardHosts.has(a.id)) refuse.push(`${name}: its opex sits on a line with more than one plot`);
      const l = lineForAsset(lines, a.id);
      if (l && l.members.filter((m) => opexAssets.includes(m)).length > 1) refuse.push(`${name}: its line carries opex on more than one plot`);
      const p = phases.find((x) => x.id === a.phaseId);
      if (p && (p.overlapPeriods ?? 0) !== 0) refuse.push(`${name}: a phase overlap, which the sheet does not show`);
      if (!has(`tl:flag:${a.phaseId}:ops`) || !has(`tl:flag:${a.phaseId}:hand`)) refuse.push(`${name}: the Timeline's operating years are not live`);
      const dflt = idxOf(a.opex?.defaultIndexation);
      if (!IDX_METHODS.has(dflt.method ?? 'none')) refuse.push(`${name}: inflation ${dflt.method}`);
      if ((dflt.method ?? 'none') !== 'none' && (!has(`oxin|${a.id}|rate`) || !has(`oxin|${a.id}|from`))) refuse.push(`${name}: its inflation has no rate on Inputs`);
      for (const ln of stored) {
        if (ln.rateMode === 'yoy') refuse.push(`${name}: ${ln.name} has year-by-year rates`);
        const own = ln.useAssetDefault === false && FIXED_MODES.has(ln.mode) && (ln.indexation?.method ?? 'none') !== 'none';
        if (own) refuse.push(`${name}: ${ln.name} has its own inflation`);
        if (ln.mode === 'pct_of_gop' && (a.strategy === 'Lease' || DIRECT.has(String(ln.category)) || INDIRECT.has(String(ln.category)))) refuse.push(`${name}: ${ln.name} is charged on GOP from inside GOP`);
      }
    }
    const hqStored = hqOpexLinesInForce(project.hqOpex?.lines as OpexLine[] | undefined);
    const hqDefault = idxOf(project.hqOpex?.defaultIndexation);
    if (!IDX_METHODS.has(hqDefault.method ?? 'none')) refuse.push(`HQ: inflation ${hqDefault.method}`);
    if ((hqDefault.method ?? 'none') !== 'none' && (!has('oxin|hq|rate') || !has('oxin|hq|from'))) refuse.push('HQ: its inflation has no rate on Inputs');
    for (const ln of hqStored) {
      if (ln.rateMode === 'yoy') refuse.push(`HQ: ${ln.name} has year-by-year rates`);
      if (ln.useAssetDefault === false && ln.mode === 'fixed_baseline' && (ln.indexation?.method ?? 'none') !== 'none') refuse.push(`HQ: ${ln.name} has its own inflation`);
    }
    if (!has('rev|__project__|Project Revenue (Sales Value year-on-year)|Total Project')) refuse.push('Revenue\'s project sales value is not on the Revenue tab');
    // An exit before the last year stops the held assets trading after it (`stopAfterExit`).
    if (snap.disposal.booked && snap.disposal.exitIdx < N - 1 && opexAssets.length) refuse.push('the exit falls before the last year, which stops the held assets trading after it');
    if (refuse.length) return values(`Opex could not be made live for this model: ${[...new Set(refuse)].join('; ')}.`);

    // ── Writing helpers ──────────────────────────────────────────────────────
    const at = (key: string, col: number): CellAddr => ({ sheet: w.addr(key).sheet, row: w.addr(key).row, col });
    /** This year's cell of a registered row, column relative (same sheet: no sheet name). */
    const P = (key: string, t: number): string => w.refP(at(key, pc(t)), OPEX);
    /** A fixed cell (a rate, a count) of a registered row. */
    const A = (key: string, col: number): string => w.refA(at(key, col), OPEX);
    const row = (key: string, f: (t: number) => string, total: 'sum' | 'last' | 'first' | 'none' | ((t0: string, t1: string) => string) = 'sum'): void => {
      if (!has(key)) return;
      const r = w.addr(key).row;
      for (let t = 0; t < N; t++) w.fA({ sheet: OPEX, row: r, col: pc(t) }, f(t));
      const T = { sheet: OPEX, row: r, col: TOTAL_COL };
      if (total === 'none') return;
      if (total === 'sum') w.fA(T, `SUM(${w.rangeA(OPEX, r, pc(0), pc(N - 1))})`);
      else if (total === 'last') w.fA(T, w.refA({ sheet: OPEX, row: r, col: pc(N - 1) }));
      else if (total === 'first') w.fA(T, w.refA({ sheet: OPEX, row: r, col: pc(0) }));
      else w.fA(T, total(colOf(pc(0)), colOf(pc(N - 1))));
    };
    const colOf = (c: number): string => { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
    /** SUM of a block of rows on this sheet, this year's column. */
    const sumRows = (rows: number[], t: number): string => {
      if (!rows.length) return '0';
      const sorted = [...rows].sort((a, b) => a - b);
      const contiguous = sorted.every((r, i) => i === 0 || r === sorted[i - 1] + 1);
      if (contiguous) { const c = colOf(pc(t)); for (const r of sorted) w.refP({ sheet: OPEX, row: r, col: pc(t) }, OPEX); return sorted.length === 1 ? `${c}$${sorted[0]}` : `SUM(${c}$${sorted[0]}:${c}$${sorted[sorted.length - 1]})`; }
      return sorted.map((r) => w.refP({ sheet: OPEX, row: r, col: pc(t) }, OPEX)).join('+');
    };
    const ratioRow = (key: string, num: string, den: string): void => {
      row(key, (t) => `IF(${P(den, t)}>0,${P(num, t)}/${P(den, t)},0)`, () => {
        const sn = `SUM(${w.rangeA(OPEX, w.addr(num).row, pc(0), pc(N - 1))})`, sd = `SUM(${w.rangeA(OPEX, w.addr(den).row, pc(0), pc(N - 1))})`;
        return `IF(${sd}>0,${sn}/${sd},0)`;
      });
    };
    const occ = new Map<string, number>();
    const keyOf = (base: string): string => { const n = occ.get(base) ?? 0; occ.set(base, n + 1); return n ? `${base}~${n}` : base; };

    // ── The cards: the value and On / Off of each line, echoes of Inputs ─────
    const cardKeys = (scopeLine: string, names: string[], before: string[] = []): string[] => {
      const seen = new Map<string, number>();
      for (const b of before) seen.set(b, (seen.get(b) ?? 0) + 1);
      return names.map((n) => { const c = seen.get(n) ?? 0; seen.set(n, c + 1); return `opexin|${scopeLine}||${n}${c ? `~${c}` : ''}`; });
    };
    const valueCell = (key: string): string => A(key, OPEN_COL + 1);
    const onCell = (key: string): string => A(key, OPEN_COL + 3);
    // The DPO card: each line's effective days are worked out on Inputs beside its override.
    const apIn = (label: string): string => `opexin|__ap__||${label}`;
    const dpoDefaultIn = reg.keys().find((k) => k.startsWith('inp=opexin|__ap__||Project Default DPO (days)'));
    const hosts = planReportLines(lineState, (a) => a.strategy === 'Operate' || a.strategy === 'Lease').map((ln) => state.assets.find((x) => x.id === ln.assetIds[0])!);
    const cardName = (a: Asset): string => { const l = lineForAsset(lines, a.id); return l ? revenueLineName(l) : a.name; };
    const ordered = [...hosts.filter((h) => h.strategy === 'Operate'), ...hosts.filter((h) => h.strategy === 'Lease')];
    const dpoKeys = cardKeys('__ap__', ordered.map(cardName));
    const dpoCard = new Map<string, string>();
    ordered.forEach((h, i) => {
      const k = dpoKeys[i], ik = `oxin|dpo|${h.id}`;
      if (!has(k) || !has(ik) || !dpoDefaultIn) return;
      // The days in force: the line's override typed on Inputs, a blank taking the project default.
      const ov = at(ik, 2);
      w.f(k, `IF(ISNUMBER(${w.refA(ov)}),${w.refA(ov)},${w.refA(w.addr(dpoDefaultIn))})`, { col: TOTAL_COL });
      w.f(k, `IF(ISNUMBER(${w.refA(ov)}),${w.refA(ov)},"inherit")`, { col: OPEN_COL });
      dpoCard.set(h.id, k);
    });

    // ── The statements ───────────────────────────────────────────────────────
    const tables = buildOpexReport(snap, state, { allLines: true });
    interface LineOut { asset: Asset; line: RevenueLine; total: string; rev: string; gop?: string; ebitda: string; cells: Array<{ row: number; bucket: Bucket }> }
    const outs: LineOut[] = [];
    const hospGroupRow = new Map<string, Map<HospitalityCostGroup, string>>();

    for (const tb of tables.filter((x) => x.lineKey)) {
      const l = lines.find((x) => x.key === tb.lineKey);
      if (!l) continue;
      const a = l.members.find((m) => opexAssets.includes(m));
      if (!a) continue;
      occ.clear();
      const tableId = tb.title.endsWith('Operating statistics') ? 'stats' : 'stmt';
      const K = (label: string): string => `opex|${l.key}|${tableId}|${label}`;
      const isOp = a.strategy === 'Operate';
      const earner = state.subUnits.some((u) => u.assetId === a.id && isRevenueSubUnit(u));
      const RV = (label: string): string => `rev|${l.key}|${label}`;
      const rvP = (label: string, t: number): string => (earner && has(RV(label)) ? P(RV(label), t) : '0');

      if (tableId === 'stats') {
        row(K('Keys'), (t) => rvP('1.|Total Rooms (Keys)', t), () => (earner && has(`revin|${l.key}||Keys the engine counts`) ? A(`revin|${l.key}||Keys the engine counts`, TOTAL_COL) : '0'));
        row(K('Available room nights'), (t) => rvP('1.|Available Room Nights', t));
        row(K('Occupied room nights'), (t) => rvP('1.|Occupied Room Nights', t));
        ratioRow(K('Occupancy'), K('Occupied room nights'), K('Available room nights'));
        // The rates read the statement's rooms revenue, below on this tab.
        const rooms = `opex|${l.key}|stmt|Rooms revenue`;
        row(K('Average daily rate, ADR'), (t) => `IF(${P(K('Occupied room nights'), t)}>0,${P(rooms, t)}/${P(K('Occupied room nights'), t)},0)`, () => {
          const s = (k: string): string => `SUM(${w.rangeA(OPEX, w.addr(k).row, pc(0), pc(N - 1))})`;
          return `IF(${s(K('Occupied room nights'))}>0,${s(rooms)}/${s(K('Occupied room nights'))},0)`;
        });
        row(K('Revenue per available room, RevPAR'), (t) => `IF(${P(K('Available room nights'), t)}>0,${P(rooms, t)}/${P(K('Available room nights'), t)},0)`, () => {
          const s = (k: string): string => `SUM(${w.rangeA(OPEX, w.addr(k).row, pc(0), pc(N - 1))})`;
          return `IF(${s(K('Available room nights'))}>0,${s(rooms)}/${s(K('Available room nights'))},0)`;
        });
        continue;
      }

      // Operating years and inflation.
      const ops = (t: number): string => P(`tl:flag:${a.phaseId}:ops`, t);
      const hand = (t: number): string => P(`tl:flag:${a.phaseId}:hand`, t);
      const startKey = `revin|${l.key}|${isOp ? 'ADR Indexation' : 'Rent Indexation'}|Operations start year`;
      const yearHere = (t: number): string => w.refP({ sheet: OPEX, row: 3, col: pc(t) }, OPEX);
      const inOpsK = K('In operations (1 = yes)');
      row(inOpsK, (t) => (has(startKey) ? `(${hand(t)}+${ops(t)})*(${yearHere(t)}>=${A(startKey, TOTAL_COL)})` : ops(t)));
      const IO = (t: number): string => P(inOpsK, t);
      const ix = idxOf(a.opex?.defaultIndexation);
      const facK = K('Inflation factor while operating');
      if (has(facK)) {
        const rate = (): string => A(`oxin|${a.id}|rate`, 2), from = (): string => A(`oxin|${a.id}|from`, 2);
        const r0 = w.addr(inOpsK).row;
        const yearsIn = (t: number): string => { w.refP({ sheet: OPEX, row: r0, col: pc(t) }, OPEX); w.refP({ sheet: OPEX, row: r0, col: pc(0) }, OPEX); return `SUM($${colOf(pc(0))}$${r0}:${colOf(pc(t))}$${r0})`; };
        const exp = (t: number): string => `MIN(${yearHere(t)}-${from()},${yearsIn(t)}-1)`;
        row(facK, (t) => (ix.method === 'yoy_compound' ? `${IO(t)}*(1+${rate()})^MAX(0,${exp(t)})` : `${IO(t)}*IF(${exp(t)}>=0,1+${rate()},1)`), 'none');
      }
      const FAC = (t: number): string => (has(facK) ? P(facK, t) : IO(t));

      // Revenue on the statement, from the Revenue tab.
      const revRows: Record<string, string> = {};
      if (isOp) {
        row(K('Rooms revenue'), (t) => rvP('2.|Rooms Revenue', t));
        row(K('F&B revenue'), (t) => rvP('2.|F&B Revenue', t));
        row(K('Other revenue'), (t) => rvP('2.|Other Revenue', t));
        row(K('Total revenue'), (t) => sumRows([w.addr(K('Rooms revenue')).row, w.addr(K('F&B revenue')).row, w.addr(K('Other revenue')).row], t));
        Object.assign(revRows, { pct_of_room_rev: K('Rooms revenue'), pct_of_fb_rev: K('F&B revenue'), pct_of_other_rev: K('Other revenue'), pct_of_total_rev: K('Total revenue') });
      } else {
        row(K('Lease revenue'), (t) => rvP('2.|Total Lease Revenue', t));
        row(K('Total revenue'), (t) => sumRows([w.addr(K('Lease revenue')).row], t));
        Object.assign(revRows, { pct_of_lease_rev: K('Lease revenue'), pct_of_total_rev: K('Total revenue') });
      }
      const keys = (): string => (isOp && earner && has(`revin|${l.key}||Keys the engine counts`) ? A(`revin|${l.key}||Keys the engine counts`, TOTAL_COL) : '0');
      const gla = (): string => (!isOp && earner && has(RV('1.|Total Gross Lease Area (sqm)')) ? A(RV('1.|Total Gross Lease Area (sqm)'), TOTAL_COL) : '0');
      const stored = (a.opex?.lines ?? []) as OpexLine[];
      const inKeys = cardKeys(a.id, stored.map((x) => x.name), ['Asset Inflation']);
      const gopKey = K('Gross operating profit, GOP');
      const lineF = (i: number) => (t: number): string => {
        const ln = stored[i], k = inKeys[i];
        if (!has(k)) throw new Error(`opex card row missing: ${k}`);
        // A rate and a revenue row are never negative; GOP can be, so only it is floored (assetOpex.ts).
        const rate = valueCell(k);
        let v: string;
        if (ln.mode === 'fixed_baseline') v = `${rate}*${FAC(t)}`;
        else if (ln.mode === 'per_room_year') v = keys() === '0' ? '0' : `${rate}*${keys()}*${FAC(t)}`;
        else if (ln.mode === 'per_sqm_year') v = gla() === '0' ? '0' : `${rate}*${gla()}*${FAC(t)}`;
        else if (ln.mode === 'pct_of_gop') v = `${rate}*MAX(0,${P(gopKey, t)})*${IO(t)}`;
        else if (revRows[ln.mode]) v = `${rate}*${P(revRows[ln.mode], t)}*${IO(t)}`;
        else return '0';
        return v === '0' ? '0' : `IF(${onCell(k)}="Off",0,${v})`;
      };
      // Each shown cost row is the plot's lines of that group and name (one, unless a name repeats).
      const cells: LineOut['cells'] = [];
      const groupRows = new Map<string, number[]>();
      const costRow = (group: string, label: string, idxs: number[]): void => {
        const key = keyOf(K(label));
        if (!has(key)) return;
        const fs = idxs.map(lineF);
        row(key, (t) => { const parts = fs.map((f) => f(t)).filter((x) => x !== '0'); return parts.length ? parts.join('+') : '0'; });
        const r = w.addr(key).row;
        groupRows.set(group, [...(groupRows.get(group) ?? []), r]);
        for (const i of idxs) cells.push({ row: r, bucket: bucketOf(String(stored[i].category)) });
      };
      const sectionOf = isOp
        ? (ln: OpexLine): string => hospitalityCostGroup(String(ln.category))
        : (ln: OpexLine): string => leaseCostBucket(String(ln.category));
      // Walk the table's own rows so labels and order are the builder's.
      let current: string | null = null;
      const SECTION_OF: Record<string, string> = {
        'Departmental expenses': 'departmental', 'Undistributed operating expenses': 'undistributed', 'Management fees': 'management', 'Fixed charges and reserves': 'fixed',
        'Property operating costs': 'operating', 'Service charge and recoverable costs': 'recoveries', 'Other charges': 'other_charges',
      };
      const seen = new Set<string>();
      occ.clear();
      // Revenue and driver rows were keyed above in order; re-key them so repeats count right.
      for (const r of tb.rows) {
        if (r.isSection) { current = SECTION_OF[r.label] ?? null; continue; }
        if (!current || r.isSubtotal || r.isTotal || !r.indent) { keyOf(K(r.label)); continue; }
        const g = current;
        const idxs = stored.map((ln, i) => (sectionOf(ln) === g && ln.name === r.label ? i : -1)).filter((i) => i >= 0);
        if (seen.has(`${g}|${r.label}`)) { keyOf(K(r.label)); continue; }
        seen.add(`${g}|${r.label}`);
        costRow(g, r.label, idxs);
      }
      const G = (g: string): number[] => groupRows.get(g) ?? [];
      const totalOpexK = K('Total operating expenses');
      if (isOp) {
        const gk = new Map<HospitalityCostGroup, string>();
        for (const [g, lab] of [['departmental', 'Total departmental expenses'], ['undistributed', 'Total undistributed operating expenses'], ['management', 'Total management fees'], ['fixed', 'Total fixed charges and reserves']] as Array<[HospitalityCostGroup, string]>) {
          if (has(K(lab))) { row(K(lab), (t) => sumRows(G(g), t)); gk.set(g, K(lab)); }
        }
        hospGroupRow.set(l.key, gk);
        row(K('Departmental profit'), (t) => `${P(K('Total revenue'), t)}-${P(gk.get('departmental')!, t)}`);
        row(gopKey, (t) => `${P(K('Departmental profit'), t)}-${P(gk.get('undistributed')!, t)}`);
        ratioRow(K('GOP margin'), gopKey, K('Total revenue'));
        row(totalOpexK, (t) => HOSPITALITY_COST_GROUPS.map((g) => P(gk.get(g)!, t)).join('+'));
        row(K('EBITDA, net operating income'), (t) => `${P(gopKey, t)}-${P(gk.get('management')!, t)}-${P(gk.get('fixed')!, t)}`);
        ratioRow(K('EBITDA margin'), K('EBITDA, net operating income'), K('Total revenue'));
        row(K('Check, total opex less the four expense groups'), (t) => `${P(totalOpexK, t)}-(${HOSPITALITY_COST_GROUPS.map((g) => P(gk.get(g)!, t)).join('+')})`);
        outs.push({ asset: a, line: l, total: totalOpexK, rev: K('Total revenue'), gop: gopKey, ebitda: K('EBITDA, net operating income'), cells });
      } else {
        const bk: Array<[LeaseCostBucket, string]> = [['operating', 'Total property operating costs'], ['recoveries', 'Total service charge and recoverable costs'], ['other_charges', 'Total other charges']];
        for (const [b, lab] of bk) row(K(lab), (t) => sumRows(G(b), t));
        row(totalOpexK, (t) => bk.map(([, lab]) => P(K(lab), t)).join('+'));
        row(K('EBITDA, net operating income'), (t) => `${P(K('Total revenue'), t)}-${P(totalOpexK, t)}`);
        ratioRow(K('EBITDA margin'), K('EBITDA, net operating income'), K('Total revenue'));
        row(K('Check, total opex less the expense groups'), (t) => `${P(totalOpexK, t)}-(${bk.map(([, lab]) => P(K(lab), t)).join('+')})`);
        outs.push({ asset: a, line: l, total: totalOpexK, rev: K('Total revenue'), ebitda: K('EBITDA, net operating income'), cells });
      }
    }

    // ── Project tables ───────────────────────────────────────────────────────
    const hqLineRows: number[] = [];
    let hqTotalK = '';
    for (const tb of tables.filter((x) => !x.lineKey)) {
      occ.clear();
      const tid = tb.title.split(',')[0].trim();
      const K = (label: string): string => keyOf(`opex|__project__|${tid}|${label}`);
      if (tb.title === 'Hospitality operating summary' || tb.title === 'Leasing operating summary') {
        const form = tb.title.startsWith('Hospitality') ? 'operate' : 'lease';
        const order = outs.filter((o) => o.line.form === form);
        let pickKey: 'rev' | 'gop' | 'ebitda' = 'rev';
        let members: number[] = [];
        for (const r of tb.rows) {
          if (r.isSection) { pickKey = r.label === 'Total revenue' ? 'rev' : r.label.startsWith('Gross') ? 'gop' : 'ebitda'; members = []; continue; }
          const k = K(r.label);
          if (r.isSubtotal) { const ms = members; row(k, (t) => sumRows(ms, t)); continue; }
          const src = order[members.length]?.[pickKey];
          if (src && has(k)) { row(k, (t) => P(src, t)); members.push(w.addr(k).row); }
        }
        continue;
      }
      if (tb.title.startsWith('HQ & Corporate Overheads')) {
        const hqKeys = cardKeys('__hq__', hqStored.map((x) => x.name), ['HQ Inflation']);
        let rowIdx = 0;
        const facK = (hqDefault.method ?? 'none') !== 'none' ? K(tb.rows[rowIdx++].label) : '';
        if (facK) {
          const rate = A('oxin|hq|rate', 2), from = A('oxin|hq|from', 2), axis = A('project:axisYear', 2);
          const yr = (t: number): string => w.refP({ sheet: OPEX, row: 3, col: pc(t) }, OPEX);
          row(facK, (t) => (hqDefault.method === 'yoy_compound' ? `(1+${rate})^MAX(0,${yr(t)}-MAX(${from},${axis}))` : `IF(${yr(t)}>=MAX(${from},${axis}),1+${rate},1)`), 'none');
        }
        const salesValue = 'rev|__project__|Project Revenue (Sales Value year-on-year)|Total Project';
        hqStored.forEach((ln, i) => {
          const key = K(tb.rows[rowIdx++]?.label ?? '');
          const k = hqKeys[i];
          if (!has(k)) throw new Error(`HQ card row missing: ${k}`);
          row(key, (t) => {
            const rate = valueCell(k);
            const v = ln.mode === 'fixed_baseline' ? (facK ? `${rate}*${P(facK, t)}` : rate) : ln.mode === 'pct_of_total_rev' ? `${rate}*${P(salesValue, t)}` : '';
            return v ? `IF(${onCell(k)}="Off",0,${v})` : '0';
          });
          if (has(key)) hqLineRows.push(w.addr(key).row);
        });
        hqTotalK = K('Total HQ Opex');
        row(hqTotalK, (t) => sumRows(hqLineRows, t));
        continue;
      }
      if (tb.title === 'Project Total Opex') {
        const by = (b: Bucket): number[] => outs.flatMap((o) => o.cells.filter((c) => c.bucket === b).map((c) => c.row));
        const uniq = (rs: number[]): number[] => [...new Set(rs)];
        row(K('Direct costs'), (t) => sumRows(uniq(by('direct')), t));
        row(K('Indirect costs'), (t) => sumRows(uniq(by('indirect')), t));
        row(K('Management fees and replacement reserve'), (t) => sumRows(uniq(by('mgmt')), t));
        row(K('Other charges'), (t) => sumRows(uniq(by('other')), t));
        const allK = K('All asset opex');
        const four = ['Direct costs', 'Indirect costs', 'Management fees and replacement reserve', 'Other charges'].map((x) => w.addr(`opex|__project__|Project Total Opex|${x}`).row);
        row(allK, (t) => sumRows(four, t));
        const hqK = K('HQ overheads');
        row(hqK, (t) => (hqTotalK ? P(hqTotalK, t) : '0'));
        row(K('Total Project Opex'), (t) => `${P(allK, t)}+${P(hqK, t)}`);
      }
    }

    // ── Payables roll-forwards ───────────────────────────────────────────────
    const daysCard = (): string => `MAX(1,${A(apIn('Days basis'), TOTAL_COL)})`;
    const apRows = (scope: string, incLabel: string, inc: (t: number) => string, dpo: () => string): { lessPaid: string } => {
      const K = (label: string): string => `opex|${scope}|ap|${label}`;
      row(K(incLabel), inc);
      row(K('Closing AP'), (t) => `${P(K(incLabel), t)}*${dpo()}/${daysCard()}`, 'last');
      row(K('Opening AP'), (t) => w.refP({ sheet: OPEX, row: w.addr(K('Closing AP')).row, col: pc(t) - 1 }, OPEX), 'first');
      row(K('Less: Cash Paid'), (t) => `${P(K('Closing AP'), t)}-${P(K('Opening AP'), t)}-${P(K(incLabel), t)}`);
      return { lessPaid: K('Less: Cash Paid') };
    };
    const apLines = planReportLines(lineState, (a) => snap.ap.byAsset.has(a.id));
    const apScopes: string[] = [];
    for (const rl of apLines) {
      const o = outs.find((x) => rl.assetIds.includes(x.asset.id));
      const scope = `ap:${rl.assetIds.join('+')}`;
      const card = o ? dpoCard.get(o.asset.id) : undefined;
      const res = apRows(scope, 'Opex Incurred', (t) => (o ? P(o.total, t) : '0'), () => (card ? A(card, TOTAL_COL) : '0'));
      if (o) { w.claim(`oxo:ap:${o.asset.id}:lessPaid`, OPEX, w.addr(res.lessPaid).row, 1); }
      apScopes.push(scope);
    }
    const hqAp = apRows('__hq__', 'HQ Opex Incurred', (t) => (hqTotalK ? P(hqTotalK, t) : '0'), () => `N(${A(apIn('Project Default DPO (days)'), TOTAL_COL)})`); // the card echoes Inputs and prints a zero as words
    w.claim('oxo:ap:hq:lessPaid', OPEX, w.addr(hqAp.lessPaid).row, 1);
    // The project roll-forward sums the line and HQ roll-forwards above it.
    const projK = (label: string): string => `opex|__project__|ap|${label}`;
    const parts = (label: string, hqLabel = label): number[] => [...apScopes.map((s) => `opex|${s}|ap|${label}`), `opex|__hq__|ap|${hqLabel}`].filter(has).map((k) => w.addr(k).row);
    row(projK('Opening AP'), (t) => sumRows(parts('Opening AP'), t), 'first');
    row(projK('Opex Incurred'), (t) => sumRows(parts('Opex Incurred', 'HQ Opex Incurred'), t));
    row(projK('Less: Cash Paid'), (t) => sumRows(parts('Less: Cash Paid'), t));
    row(projK('Closing AP'), (t) => sumRows(parts('Closing AP'), t), 'last');

    // ── What later tabs read: the visible rows, named once here ─────────────
    for (const o of outs) w.claim(`oxo:${o.asset.id}:total`, OPEX, w.addr(o.total).row, 1);
    for (const [lk, gk] of hospGroupRow) for (const [g, k] of gk) w.claim(`oxo:${lk}:grp:${g}`, OPEX, w.addr(k).row, 1);
    if (hqTotalK) w.claim('oxo:hq:total', OPEX, w.addr(hqTotalK).row, 1);

    const formulas = w.formulas.get(OPEX) ?? 0;
    return [{
      sheet: OPEX, status: 'live' as const, formulas,
      note: 'Opex: each line\'s statement shows the years it operates and its inflation factor, every cost line has a row (zeros and switched-off lines included), every total sums the rows above it, and the payables roll forward from the statements. A line\'s mode and category are fixed at export.',
    }];
  },
};
