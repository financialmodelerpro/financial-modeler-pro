/**
 * stage3Opex.ts (2026-09-27), FORMULA-LINKED EXPORT, STAGE 3c: OPEX.
 *
 * Runs AFTER Revenue, since every percentage line charges on what a line earns.
 *
 * The engine (`computeAssetOpex`, fed by opex-resolvers) prices each ASSET over
 * its operating window; the Opex sheet presents by LINE. So the arithmetic lives
 * on a hidden working sheet, "Opex Calc", as the engine's own two passes:
 *
 *   PASS A, every line not on GOP: a fixed amount, a rate per key or per sqm of
 *     leasable area (each x the inflation factor), or a share of the rooms, F&B,
 *     other, total or lease revenue the Revenue working sheet computes. Zero
 *     outside the operating window, which opex resolves by ITS OWN rule
 *     (`resolveOpsWindow`: offset from the project start date, the default start
 *     the year after handover, an override clamped to handover, at least one year).
 *   PASS B: direct and indirect costs (a GOP-driven line in either category is
 *     left out of both, as the engine leaves it), GOP = total revenue less both,
 *     then the lines charged on GOP. Management, other, total opex and NOI.
 *
 * The visible sheet sums from there: the hotel operating statement (statistics,
 * revenue by department, the four expense groups, departmental profit, GOP,
 * EBITDA, margins, the check row), the lease operating statement, the two
 * operating summaries, HQ overheads, the project total and the payables
 * roll-forwards (closing = opex x DPO / days, cash paid = opex less the change).
 *
 * Inputs stay where the sheet shows them: each line's value and its On / Off,
 * the DPO settings and overrides. The inflation, which the cards state in words,
 * is listed at the foot as a rate and a start year. A line's MODE and category
 * are the structure of its formula and are fixed at export.
 *
 * A table row the platform shows only while it is non-zero stays hidden here if
 * an input later makes it non-zero, but every total, GOP and EBITDA includes it.
 *
 * REFUSES by name (Opex stays values): Revenue not live, a year-by-year rate,
 * an inflation method other than none / one step / compounding, a phase overlap,
 * a line whose opex sits on more than one plot, an asset running on the default
 * seed the sheet does not show.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { ARGB, NUMFMT, setInput, setLabel, fillRange } from '../styles';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { normalizeOpexIndexation, type OpexLine } from '@/src/core/calculations/opex';
import { isRevenueSubUnit } from '@/src/core/calculations';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { planRevenueLines, lineForAsset } from '../../revenueLines';
import { revenueLineName } from '../../reports/revenueOutputReports';
import { buildOpexReport, leaseCostBucket } from '../../reports/opexReports';
import { hospitalityCostGroup, type HospitalityCostGroup } from '../../reports/hospitalityStatement';
import { planReportLines } from '../../reports/lineRows';
import type { Asset, Phase } from '../../state/module1-types';

const CALC = 'Opex Calc';
const OPEX = 'Opex';
const RCALC = 'Revenue Calc';
const IDX_METHODS = new Set(['none', 'yoy_compound', 'single_rate']);
const FIXED_MODES = new Set(['fixed_baseline', 'per_room_year', 'per_sqm_year']);
const DIRECT = new Set(['direct_rooms', 'direct_fb', 'direct_other']);
const INDIRECT = new Set(['indirect_ga', 'indirect_it', 'indirect_sm', 'indirect_pom', 'indirect_energy', 'indirect_eosb']);
const MGMT = new Set(['mgmt_base', 'mgmt_tech', 'mgmt_incentive', 'replacement_reserve']);

type Idx = { method?: string; rate?: number; startYear?: number };

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
    if (!w.reg.keys().some((k) => k.startsWith('rvc:'))) refuse.push('Revenue is not live for this model');
    const idxOf = (cfg: unknown): Idx => normalizeOpexIndexation(cfg) as Idx;
    const lineIdx = (a: Asset | null, l: OpexLine, dflt: Idx): Idx => {
      if (a === null ? l.mode !== 'fixed_baseline' : !FIXED_MODES.has(l.mode)) return { method: 'none' };
      if (l.useAssetDefault !== false) return dflt;
      return (l.indexation ?? { method: 'none' }) as Idx;
    };
    const cardHosts = new Set(planReportLines(lineState, (a) => a.strategy === 'Operate' || a.strategy === 'Lease').map((l) => l.assetIds[0]));
    for (const a of opexAssets) {
      const name = a.name;
      const stored = a.opex?.lines ?? [];
      if (stored.length === 0) { refuse.push(`${name}: opex runs on the default seed, which the sheet does not show`); continue; }
      if (!cardHosts.has(a.id)) refuse.push(`${name}: its opex sits on a line with more than one plot`);
      const l = lineForAsset(lines, a.id);
      if (l && l.members.filter((m) => opexAssets.includes(m)).length > 1) refuse.push(`${name}: its line carries opex on more than one plot`);
      const p = phases.find((x) => x.id === a.phaseId);
      if (p && (p.overlapPeriods ?? 0) !== 0) refuse.push(`${name}: a phase overlap, which the sheet does not show`);
      const dflt = idxOf(a.opex?.defaultIndexation);
      for (const ln of stored as OpexLine[]) {
        if (ln.rateMode === 'yoy') refuse.push(`${name}: ${ln.name} has year-by-year rates`);
        const ix = lineIdx(a, ln, dflt);
        if (!IDX_METHODS.has(ix.method ?? 'none')) refuse.push(`${name}: ${ln.name} inflation ${ix.method}`);
      }
    }
    const hqStored = (project.hqOpex?.lines ?? []) as OpexLine[];
    const hqDefault = idxOf(project.hqOpex?.defaultIndexation);
    for (const ln of hqStored) {
      if (ln.rateMode === 'yoy') refuse.push(`HQ: ${ln.name} has year-by-year rates`);
      const ix = lineIdx(null, ln, hqDefault);
      if (!IDX_METHODS.has(ix.method ?? 'none')) refuse.push(`HQ: ${ln.name} inflation ${ix.method}`);
    }
    if (hqStored.length === 0) refuse.push('HQ runs on the default seed, which the sheet does not show');
    if (refuse.length) return values(`Opex could not be made live for this model: ${[...new Set(refuse)].join('; ')}.`);

    // ── Inflation, which the cards state in words, listed at the sheet's foot ─
    const ox = wb.getWorksheet(OPEX)!;
    let fr = ox.rowCount + 3;
    setLabel(ox.getCell(fr, 1), 'Live model inputs: inflation, which the cards above state in words (the formulas above read these)', { bold: true });
    fillRange(ox, fr, 1, fr, OPEN_COL + N, ARGB.subtotal);
    fr += 1;
    setLabel(ox.getCell(fr, 1), 'Inflation applies to the fixed amounts and the rates per key and per sqm; a share of revenue or GOP rides on the revenue it charges on. A start year is a model year counted from 0. A line\'s mode and category are the structure of its formula and are fixed at export.');
    ox.getCell(fr, 1).font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
    fr += 2;
    setLabel(ox.getCell(fr, 1), 'Applies to', { bold: true }); setLabel(ox.getCell(fr, 2), 'Method', { bold: true });
    setLabel(ox.getCell(fr, TOTAL_COL), 'Rate', { bold: true }); setLabel(ox.getCell(fr, OPEN_COL), 'From model year', { bold: true });
    fr += 1;
    const methodText = (m: string): string => (m === 'none' ? 'none' : m === 'yoy_compound' ? 'compounding each year' : 'one step');
    const footRow = (key: string, label: string, ix: Idx): void => {
      const m = ix.method ?? 'none';
      if (m === 'none') return;
      setLabel(ox.getCell(fr, 1), label, { indent: 1 });
      setLabel(ox.getCell(fr, 2), methodText(m));
      setInput(ox.getCell(fr, TOTAL_COL), ix.rate ?? 0, NUMFMT.pct2);
      setInput(ox.getCell(fr, OPEN_COL), ix.startYear ?? 0, NUMFMT.int);
      w.claim(key, OPEX, fr, 1);
      fr += 1;
    };
    const cardName = (a: Asset): string => { const l = lineForAsset(lines, a.id); return l ? revenueLineName(l) : a.name; };
    footRow('oxfoot|hq|idx', 'HQ & Corporate Overheads, default', hqDefault);
    hqStored.forEach((ln, i) => { if (ln.useAssetDefault === false && ln.mode === 'fixed_baseline') footRow(`oxfoot|hq|${i}|idx`, `HQ, ${ln.name}`, (ln.indexation ?? { method: 'none' }) as Idx); });
    for (const a of opexAssets) {
      footRow(`oxfoot|${a.id}|idx`, `${cardName(a)}, asset default`, idxOf(a.opex?.defaultIndexation));
      (a.opex?.lines ?? []).forEach((ln, i) => { if (ln.useAssetDefault === false && FIXED_MODES.has(ln.mode)) footRow(`oxfoot|${a.id}|${i}|idx`, `${cardName(a)}, ${ln.name}`, (ln.indexation ?? { method: 'none' }) as Idx); });
    }
    const factorF = (footKey: string, ix: Idx, t: number): string => {
      const m = ix.method ?? 'none';
      if (m === 'none' || !has(footKey)) return '1';
      const rate = w.ref(footKey, TOTAL_COL), start = w.ref(footKey, OPEN_COL);
      return m === 'yoy_compound' ? `(1+${rate})^MAX(0,${t}-MAX(0,${start}))` : `IF(${t}>=MAX(0,${start}),1+${rate},1)`;
    };

    // ── Input cells on the cards ─────────────────────────────────────────────
    /** The registry key of each stored line's row on a card, in emission order (~n on a repeat). */
    const cardKeys = (scopeLine: string, names: string[], before: string[] = []): string[] => {
      const seen = new Map<string, number>();
      for (const b of before) seen.set(b, (seen.get(b) ?? 0) + 1);
      return names.map((n) => { const c = seen.get(n) ?? 0; seen.set(n, c + 1); return `opexin|${scopeLine}||${n}${c ? `~${c}` : ''}`; });
    };
    const valueCell = (key: string): string => w.ref(key, OPEN_COL + 1);
    const onCell = (key: string): string => w.ref(key, OPEN_COL + 3);

    // ── The working sheet ────────────────────────────────────────────────────
    const cs = wb.addWorksheet(CALC, { state: 'hidden' });
    cs.getCell(1, 1).value = 'Opex working sheet: the engine\'s two passes per plot, then HQ and the payables. Hidden; the Opex sheet sums a line from here.';
    const cT = (t: number): number => 4 + t;
    let cr = 3;
    for (let t = 0; t < N; t++) cs.getCell(cr, cT(t)).value = `Year ${t + 1}`;
    cr += 1;
    const C = (r: number, c: number) => ({ sheet: CALC, row: r, col: c });
    const at = (r: number, t: number): string => w.refA(C(r, cT(t)));
    const newRow = (key: string, label: string, f?: (t: number) => string): number => {
      const r = cr++; cs.getCell(r, 1).value = label; w.claim(key, CALC, r, 1);
      if (f) for (let t = 0; t < N; t++) w.fA(C(r, cT(t)), f(t));
      return r;
    };
    const rv = (key: string, t: number): string => w.ref(key, 4 + t);
    const sumOf = (rows: number[], t: number): string => rows.map((r) => at(r, t)).join('+') || '0';

    const psy = newRow('oxc:psy', 'Project start year (the year opex offsets are counted from)');
    w.fA(C(psy, 3), `YEAR(${w.ref('project:startDate')})`, { cached: new Date(project.startDate).getUTCFullYear() });
    const PSY = (): string => w.refA(C(psy, 3));

    interface AssetCalc { a: Asset; stored: OpexLine[]; lineRows: number[]; direct: number; indirect: number; mgmt: number; other: number; total: number; gop: number; noi: number; tr: number; keys: () => string; lineKeys: string[] }
    const calcs = new Map<string, AssetCalc>();
    for (const a of opexAssets) {
      const p = phases.find((x) => x.id === a.phaseId)!;
      const l = lineForAsset(lines, a.id);
      const earner = !!l && has(`rvc:${l.key}:${a.strategy === 'Operate' ? 'total' : 'rev'}`) && state.subUnits.some((u) => u.assetId === a.id && isRevenueSubUnit(u));
      const stored = (a.opex?.lines ?? []) as OpexLine[];
      // The operating window, opex's own rule.
      const win = newRow(`oxc:${a.id}:win`, `${a.name}: offset, handover, default start, start, end (S, E)`);
      w.fA(C(win, 3), `YEAR(${w.ref(`phase:${p.id}:start`)})-${PSY()}`);
      w.fA(C(win, 4), `MAX(0,${w.refA(C(win, 3))}+MAX(0,${w.ref(`phase:${p.id}:cp`)})-1)`);
      w.fA(C(win, 5), `${w.refA(C(win, 4))}+1`);
      const startKey = l ? `revin|${l.key}|${a.strategy === 'Operate' ? 'ADR Indexation' : 'Rent Indexation'}|Operations start year` : '';
      const override = a.strategy === 'Operate' ? a.revenue?.operate?.operationsStartYearOverride : a.revenue?.lease?.operationsStartYearOverride;
      let rawStart = w.refA(C(win, 5));
      if (startKey && has(startKey)) {
        const cell = w.addr(startKey, TOTAL_COL);
        const shown = w.platformValue(cell);
        const clamp = `MAX(${w.refA(C(win, 4))},${w.refA(cell)}-${PSY()})`;
        rawStart = override != null ? clamp : `IF(${w.refA(cell)}=${typeof shown === 'number' ? shown : `"${shown}"`},${w.refA(C(win, 5))},${clamp})`;
      } else if (override != null) rawStart = `MAX(${w.refA(C(win, 4))},${override}-${PSY()})`;
      w.fA(C(win, 6), rawStart);
      w.fA(C(win, 7), `MAX(0,MIN(${N - 1},${w.refA(C(win, 6))}))`);
      w.fA(C(win, 8), `MAX(${w.refA(C(win, 7))},MIN(${N - 1},MAX(${w.refA(C(win, 6))},MIN(${N - 1},${w.refA(C(win, 5))}+MAX(0,${w.ref(`phase:${p.id}:op`)})-1))))`);
      const S = (): string => w.refA(C(win, 7)), E = (): string => w.refA(C(win, 8));
      const inOps = newRow(`oxc:${a.id}:inOps`, 'in operations', (t) => `IF(AND(${t}>=${S()},${t}<=${E()}),1,0)`);

      // The revenue it charges on, and its drivers.
      const zero = (): string => '0';
      const stream = (k: string) => (t: number): string => (earner && l ? rv(`rvc:${l.key}:${k}`, t) : zero());
      const isOp = a.strategy === 'Operate';
      const tr = newRow(`oxc:${a.id}:tr`, 'total revenue', isOp ? stream('total') : stream('rev'));
      const streamFor = (mode: string): ((t: number) => string) | null => {
        if (mode === 'pct_of_room_rev') return isOp ? stream('rooms') : zero;
        if (mode === 'pct_of_fb_rev') return isOp ? stream('fb') : zero;
        if (mode === 'pct_of_other_rev') return isOp ? stream('other') : zero;
        if (mode === 'pct_of_total_rev') return (t) => at(tr, t);
        if (mode === 'pct_of_lease_rev') return isOp ? zero : stream('rev');
        return null;
      };
      const keys = (): string => (isOp && earner && l ? w.ref(`rvc:${l.key}:keys`, 3) : '0');
      const gla = (): string => (!isOp && earner && l ? w.ref(`rvc:${l.key}:gla`, 3) : '0');

      const dflt = idxOf(a.opex?.defaultIndexation);
      const dfltF = (dflt.method ?? 'none') === 'none' ? null : newRow(`oxc:${a.id}:factor`, 'asset inflation factor', (t) => factorF(`oxfoot|${a.id}|idx`, dflt, t));
      const names = stored.map((x) => x.name);
      const keysIn = cardKeys(a.id, names, ['Asset Inflation']);
      const lineRows: number[] = new Array<number>(stored.length).fill(0);
      const passA = (i: number): void => {
        const ln = stored[i];
        const k = keysIn[i];
        if (!has(k)) throw new Error(`opex card row missing: ${k}`);
        const ix = lineIdx(a, ln, dflt);
        const own = ln.useAssetDefault === false && FIXED_MODES.has(ln.mode) && (ix.method ?? 'none') !== 'none';
        const fRow = own ? newRow(`oxc:${a.id}:${i}:factor`, `${ln.name} inflation factor`, (t) => factorF(`oxfoot|${a.id}|${i}|idx`, ix, t)) : (FIXED_MODES.has(ln.mode) && (ix.method ?? 'none') !== 'none' ? dfltF : null);
        const fac = (t: number): string => (fRow ? at(fRow, t) : '1');
        const rate = (): string => `MAX(0,N(${valueCell(k)}))`;
        const s = streamFor(ln.mode);
        lineRows[i] = newRow(`oxc:${a.id}:L${i}`, ln.name, (t) => {
          let v: string;
          if (ln.mode === 'fixed_baseline') v = `${rate()}*${fac(t)}`;
          else if (ln.mode === 'per_room_year') v = `${rate()}*MAX(0,${keys()})*${fac(t)}`;
          else if (ln.mode === 'per_sqm_year') v = `${rate()}*MAX(0,${gla()})*${fac(t)}`;
          else if (s) v = `${rate()}*MAX(0,${s(t)})`;
          else return '0';
          return `IF(${onCell(k)}="Off",0,IF(${at(inOps, t)}=1,${v},0))`;
        });
      };
      stored.forEach((ln, i) => { if (ln.mode !== 'pct_of_gop') passA(i); });
      const notGop = (set: Set<string>): number[] => stored.map((ln, i) => (set.has(String(ln.category)) && ln.mode !== 'pct_of_gop' ? lineRows[i] : -1)).filter((r) => r > 0);
      const direct = newRow(`oxc:${a.id}:direct`, 'direct costs', (t) => sumOf(notGop(DIRECT), t));
      const indirect = newRow(`oxc:${a.id}:indirect`, 'indirect costs', (t) => sumOf(notGop(INDIRECT), t));
      const gop = newRow(`oxc:${a.id}:gop`, 'GOP (engine)', (t) => `${at(tr, t)}-${at(direct, t)}-${at(indirect, t)}`);
      stored.forEach((ln, i) => {
        if (ln.mode !== 'pct_of_gop') return;
        const k = keysIn[i];
        if (!has(k)) throw new Error(`opex card row missing: ${k}`);
        lineRows[i] = newRow(`oxc:${a.id}:L${i}`, ln.name, (t) => `IF(${onCell(k)}="Off",0,IF(${at(inOps, t)}=1,MAX(0,N(${valueCell(k)}))*MAX(0,${at(gop, t)}),0))`);
      });
      const pick = (f: (cat: string) => boolean): number[] => stored.map((ln, i) => (f(String(ln.category)) ? lineRows[i] : -1)).filter((r) => r > 0);
      const mgmt = newRow(`oxc:${a.id}:mgmt`, 'management fees and reserve', (t) => sumOf(pick((c) => MGMT.has(c)), t));
      const other = newRow(`oxc:${a.id}:other`, 'other charges', (t) => sumOf(pick((c) => !MGMT.has(c) && !DIRECT.has(c) && !INDIRECT.has(c)), t));
      const total = newRow(`oxc:${a.id}:total`, 'total opex', (t) => sumOf(lineRows, t));
      const noi = newRow(`oxc:${a.id}:noi`, 'NOI', (t) => `${at(tr, t)}-${at(total, t)}`);
      calcs.set(a.id, { a, stored, lineRows, direct, indirect, mgmt, other, total, gop, noi, tr, keys, lineKeys: keysIn });
    }

    // HQ: fixed amounts and a share of the project's total revenue, every year.
    const projTR = newRow('oxc:hq:tr', 'project total revenue (HQ basis)', (t) => {
      const parts: string[] = [];
      for (const l of lines) {
        if (l.form === 'sell' && has(`rvc:${l.key}:preRev`)) parts.push(rv(`rvc:${l.key}:preRev`, t), rv(`rvc:${l.key}:postRev`, t));
        else if (l.form === 'operate' && has(`rvc:${l.key}:total`)) parts.push(rv(`rvc:${l.key}:total`, t));
        else if (l.form === 'lease' && has(`rvc:${l.key}:rev`)) parts.push(rv(`rvc:${l.key}:rev`, t));
      }
      return parts.join('+') || '0';
    });
    const hqKeys = cardKeys('__hq__', hqStored.map((x) => x.name), ['HQ Inflation']);
    const hqF = (hqDefault.method ?? 'none') === 'none' ? null : newRow('oxc:hq:factor', 'HQ inflation factor', (t) => factorF('oxfoot|hq|idx', hqDefault, t));
    const hqRows = hqStored.map((ln, i) => {
      const k = hqKeys[i];
      if (!has(k)) throw new Error(`HQ card row missing: ${k}`);
      const ix = lineIdx(null, ln, hqDefault);
      const own = ln.useAssetDefault === false && ln.mode === 'fixed_baseline' && (ix.method ?? 'none') !== 'none';
      const fRow = own ? newRow(`oxc:hq:${i}:factor`, `${ln.name} inflation factor`, (t) => factorF(`oxfoot|hq|${i}|idx`, ix, t)) : (ln.mode === 'fixed_baseline' && (ix.method ?? 'none') !== 'none' ? hqF : null);
      return newRow(`oxc:hq:L${i}`, ln.name, (t) => {
        const rate = `MAX(0,N(${valueCell(k)}))`;
        const v = ln.mode === 'fixed_baseline' ? `${rate}*${fRow ? at(fRow, t) : '1'}` : ln.mode === 'pct_of_total_rev' ? `${rate}*MAX(0,${at(projTR, t)})` : '';
        return v ? `IF(${onCell(k)}="Off",0,${v})` : '0';
      });
    });
    const hqTotal = newRow('oxc:hq:total', 'HQ total', (t) => sumOf(hqRows, t));

    // Payables: the DPO inputs, then closing = MAX(0, opex) x DPO / days.
    const apIn = (label: string): string => `opexin|__ap__||${label}`;
    const dpoDefault = (): string => `MAX(0,N(${w.ref(apIn('Project Default DPO (days)'), TOTAL_COL)}))`;
    const daysBasis = (): string => `MAX(1,N(${w.ref(apIn('Days basis'), TOTAL_COL)}))`;
    const hosts = planReportLines(lineState, (a) => a.strategy === 'Operate' || a.strategy === 'Lease').map((ln) => state.assets.find((x) => x.id === ln.assetIds[0])!);
    const hospitality = hosts.filter((h) => h.strategy === 'Operate'), lease = hosts.filter((h) => h.strategy === 'Lease');
    const dpoKeys = cardKeys('__ap__', [...hospitality, ...lease].map(cardName));
    const dpoKey = new Map<string, string>();
    [...hospitality, ...lease].forEach((h, i) => {
      const k = dpoKeys[i];
      if (!has(k)) return;
      const ov = w.addr(k, OPEN_COL);
      w.f(k, `IF(AND(ISNUMBER(${w.refA(ov)}),N(${w.refA(ov)})>=0),${w.refA(ov)},${dpoDefault()})`, { col: TOTAL_COL });
      dpoKey.set(h.id, k);
    });
    interface ApCalc { inc: number; close: number; open: number; paid: number }
    const apCalc = (key: string, label: string, incF: (t: number) => string, dpo: () => string): ApCalc => {
      const inc = newRow(`oxc:ap:${key}:inc`, `${label}: opex incurred`, (t) => `MAX(0,${incF(t)})`);
      const close = newRow(`oxc:ap:${key}:close`, `${label}: AP closing`, (t) => `${at(inc, t)}*${dpo()}/${daysBasis()}`);
      const open = newRow(`oxc:ap:${key}:open`, `${label}: AP opening`, (t) => (t === 0 ? '0' : at(close, t - 1)));
      const paid = newRow(`oxc:ap:${key}:paid`, `${label}: cash paid`, (t) => `${at(inc, t)}-(${at(close, t)}-${at(open, t)})`);
      return { inc, close, open, paid };
    };
    const apByAsset = new Map<string, ApCalc>();
    for (const [id, c] of calcs) {
      const k = dpoKey.get(id);
      const ov = c.a.opex?.apDaysOverride;
      // Built inside each formula, so the reference is recorded against the cell that reads it.
      const dpo = (): string => (k ? w.ref(k, TOTAL_COL) : ov !== undefined && ov >= 0 ? String(ov) : dpoDefault());
      apByAsset.set(id, apCalc(id, c.a.name, (t) => at(c.total, t), dpo));
    }
    const apHq = apCalc('hq', 'HQ', (t) => at(hqTotal, t), dpoDefault);
    for (let col = 1; col <= cT(N - 1); col++) cs.getColumn(col).width = col <= 3 ? 26 : 14;

    // ── The visible Opex Output ──────────────────────────────────────────────
    const cell = (key: string, t: number): string => w.refA({ sheet: OPEX, row: w.addr(key).row, col: pc(t) });
    const row = (key: string, f: (t: number) => string, total: 'sum' | 'last' | 'first' | ((range: string) => string) = 'sum'): void => {
      if (!has(key)) return;
      const r = w.addr(key).row;
      for (let t = 0; t < N; t++) w.fA({ sheet: OPEX, row: r, col: pc(t) }, f(t));
      const rng = (): string => w.rangeA(OPEX, r, pc(0), pc(N - 1));
      if (total === 'sum') w.fA({ sheet: OPEX, row: r, col: TOTAL_COL }, `SUM(${rng()})+N(${w.refA({ sheet: OPEX, row: r, col: OPEN_COL })})`);
      else if (total === 'last') w.fA({ sheet: OPEX, row: r, col: TOTAL_COL }, w.refA({ sheet: OPEX, row: r, col: pc(N - 1) }));
      else if (total === 'first') w.fA({ sheet: OPEX, row: r, col: TOTAL_COL }, w.refA({ sheet: OPEX, row: r, col: pc(0) }));
      else w.fA({ sheet: OPEX, row: r, col: TOTAL_COL }, total(rng()));
    };
    const ratioRow = (key: string, num: string, den: string): void => {
      row(key, (t) => `IF(${cell(den, t)}>0,${cell(num, t)}/${cell(den, t)},0)`, () => {
        const sn = `SUM(${w.rangeA(OPEX, w.addr(num).row, pc(0), pc(N - 1))})`, sd = `SUM(${w.rangeA(OPEX, w.addr(den).row, pc(0), pc(N - 1))})`;
        return `IF(${sd}>0,${sn}/${sd},0)`;
      });
    };
    const occ = new Map<string, number>();
    const keyOf = (base: string): string => { const n = occ.get(base) ?? 0; occ.set(base, n + 1); return n ? `${base}~${n}` : base; };
    const tables = buildOpexReport(snap, state);
    const lineTotals = new Map<string, { rev: string; gop?: string; ebitda: string }>();

    for (const t of tables.filter((x) => x.lineKey)) {
      const l = lines.find((x) => x.key === t.lineKey);
      if (!l) continue;
      const members = [...calcs.values()].filter((c) => l.members.some((m) => m.id === c.a.id));
      if (!members.length) continue;
      const c = members[0];
      occ.clear();
      const tableId = t.title.endsWith('Operating statistics') ? 'stats' : 'stmt';
      const K = (label: string): string => `opex|${l.key}|${tableId}|${label}`;
      if (tableId === 'stats') {
        const R = (k: string, t2: number): string => rv(`rvc:${l.key}:${k}`, t2);
        const KY = (): string => w.ref(`rvc:${l.key}:keys`, 3);
        const rowRv = (k: string): string => w.rangeA(RCALC, w.addr(`rvc:${l.key}:${k}`).row, 4, 4 + N - 1);
        row(K('Keys'), (t2) => `IF(${R('arn', t2)}>0,${KY()},0)`, () => KY());
        row(K('Available room nights'), (t2) => R('arn', t2));
        row(K('Occupied room nights'), (t2) => R('orn', t2));
        row(K('Occupancy'), (t2) => `IF(${R('arn', t2)}>0,${R('orn', t2)}/${R('arn', t2)},0)`, () => `IF(SUM(${rowRv('arn')})>0,SUM(${rowRv('orn')})/SUM(${rowRv('arn')}),0)`);
        row(K('Average daily rate, ADR'), (t2) => `IF(${R('orn', t2)}>0,${R('rooms', t2)}/${R('orn', t2)},0)`, () => `IF(SUM(${rowRv('orn')})>0,SUM(${rowRv('rooms')})/SUM(${rowRv('orn')}),0)`);
        row(K('Revenue per available room, RevPAR'), (t2) => `IF(${R('arn', t2)}>0,${R('rooms', t2)}/${R('arn', t2)},0)`, () => `IF(SUM(${rowRv('arn')})>0,SUM(${rowRv('rooms')})/SUM(${rowRv('arn')}),0)`);
        continue;
      }
      if (l.form === 'operate') {
        row(K('Rooms revenue'), (t2) => rv(`rvc:${l.key}:rooms`, t2));
        row(K('F&B revenue'), (t2) => rv(`rvc:${l.key}:fb`, t2));
        row(K('Other revenue'), (t2) => rv(`rvc:${l.key}:other`, t2));
        row(K('Total revenue'), (t2) => at(c.tr, t2));
        // Each shown cost row sums the plot's lines of that group and name; each
        // group total sums every line of the group, shown or not.
        const groupOf = (ln: OpexLine): HospitalityCostGroup => hospitalityCostGroup(String(ln.category));
        const shown = new Set<string>();
        for (const r of t.rows) {
          if (r.isSection || r.isSubtotal || r.isTotal || !r.indent) continue;
          const [g] = (['departmental', 'undistributed', 'management', 'fixed'] as HospitalityCostGroup[]).filter((gg) => c.stored.some((ln) => groupOf(ln) === gg && ln.name === r.label));
          if (!g || shown.has(`${g}|${r.label}`)) continue;
          shown.add(`${g}|${r.label}`);
          const rows = c.stored.map((ln, i) => (groupOf(ln) === g && ln.name === r.label ? c.lineRows[i] : -1)).filter((x) => x > 0);
          row(keyOf(K(r.label)), (t2) => sumOf(rows, t2));
        }
        const grp = (g: HospitalityCostGroup) => (t2: number): string => sumOf(c.stored.map((ln, i) => (groupOf(ln) === g ? c.lineRows[i] : -1)).filter((x) => x > 0), t2);
        const gRow = new Map<HospitalityCostGroup, string>();
        const gCalc = new Map<HospitalityCostGroup, number>();
        for (const [g, lab] of [['departmental', 'Total departmental expenses'], ['undistributed', 'Total undistributed operating expenses'], ['management', 'Total management fees'], ['fixed', 'Total fixed charges and reserves']] as Array<[HospitalityCostGroup, string]>) {
          gCalc.set(g, newRow(`oxc:${l.key}:grp:${g}`, `${revenueLineName(l)}: ${g}`, grp(g)));
          if (has(K(lab))) { row(K(lab), (t2) => at(gCalc.get(g)!, t2)); gRow.set(g, K(lab)); }
        }
        const G = (g: HospitalityCostGroup, t2: number): string => at(gCalc.get(g)!, t2);
        const dp = newRow(`oxc:${l.key}:dp`, 'departmental profit', (t2) => `${at(c.tr, t2)}-${G('departmental', t2)}`);
        const gp = newRow(`oxc:${l.key}:gop`, 'GOP (statement)', (t2) => `${at(dp, t2)}-${G('undistributed', t2)}`);
        const eb = newRow(`oxc:${l.key}:ebitda`, 'EBITDA', (t2) => `${at(gp, t2)}-${G('management', t2)}-${G('fixed', t2)}`);
        row(K('Departmental profit'), (t2) => at(dp, t2));
        row(K('Gross operating profit, GOP'), (t2) => at(gp, t2));
        ratioRow(K('GOP margin'), K('Gross operating profit, GOP'), K('Total revenue'));
        row(K('EBITDA, net operating income'), (t2) => at(eb, t2));
        ratioRow(K('EBITDA margin'), K('EBITDA, net operating income'), K('Total revenue'));
        row(K('Check, total opex less the four expense groups'), (t2) => `${at(c.total, t2)}-${G('departmental', t2)}-${G('undistributed', t2)}-${G('management', t2)}-${G('fixed', t2)}`);
        lineTotals.set(l.key, { rev: K('Total revenue'), gop: K('Gross operating profit, GOP'), ebitda: K('EBITDA, net operating income') });
        continue;
      }
      // Lease: the three buckets.
      row(K('Lease revenue'), (t2) => at(c.tr, t2));
      row(K('Total revenue'), (t2) => at(c.tr, t2));
      const bucketOf = (ln: OpexLine) => leaseCostBucket(String(ln.category));
      const shown = new Set<string>();
      let bucket: string | null = null;
      for (const r of t.rows) {
        if (r.isSection) { bucket = r.label === 'Property operating costs' ? 'operating' : r.label === 'Service charge and recoverable costs' ? 'recoveries' : r.label === 'Other charges' ? 'other_charges' : null; continue; }
        if (!bucket || r.isSubtotal || r.isTotal || !r.indent) continue;
        if (shown.has(`${bucket}|${r.label}`)) continue;
        shown.add(`${bucket}|${r.label}`);
        const b = bucket;
        const rows = c.stored.map((ln, i) => (bucketOf(ln) === b && ln.name === r.label ? c.lineRows[i] : -1)).filter((x) => x > 0);
        row(keyOf(K(r.label)), (t2) => sumOf(rows, t2));
      }
      const bRows = (b: string): number[] => c.stored.map((ln, i) => (bucketOf(ln) === b ? c.lineRows[i] : -1)).filter((x) => x > 0);
      row(K('Total property operating costs'), (t2) => sumOf(bRows('operating'), t2));
      row(K('Total service charge and recoverable costs'), (t2) => sumOf(bRows('recoveries'), t2));
      row(K('Total other charges'), (t2) => sumOf(bRows('other_charges'), t2));
      row(K('Total operating expenses'), (t2) => at(c.total, t2));
      row(K('EBITDA, net operating income'), (t2) => at(c.noi, t2));
      ratioRow(K('EBITDA margin'), K('EBITDA, net operating income'), K('Total revenue'));
      row(K('Check, total opex less the expense groups'), (t2) => `${at(c.total, t2)}-(${sumOf([...bRows('operating'), ...bRows('recoveries'), ...bRows('other_charges')], t2)})`);
      lineTotals.set(l.key, { rev: K('Total revenue'), ebitda: K('EBITDA, net operating income') });
    }

    // Project tables.
    for (const t of tables.filter((x) => !x.lineKey)) {
      occ.clear();
      const tid = t.title.split(',')[0].trim();
      const K = (label: string): string => keyOf(`opex|__project__|${tid}|${label}`);
      if (t.title === 'Hospitality operating summary' || t.title === 'Leasing operating summary') {
        const form = t.title.startsWith('Hospitality') ? 'operate' : 'lease';
        const order = tables.filter((x) => x.lineKey && x.title.endsWith('Operating statement') && lines.find((l) => l.key === x.lineKey)?.form === form).map((x) => x.lineKey as string);
        let pickKey: 'rev' | 'gop' | 'ebitda' = 'rev';
        let members: string[] = [];
        for (const r of t.rows) {
          if (r.isSection) { pickKey = r.label === 'Total revenue' ? 'rev' : r.label.startsWith('Gross') ? 'gop' : 'ebitda'; members = []; continue; }
          const k = K(r.label);
          if (r.isSubtotal) { const ms = members; row(k, (t2) => ms.map((m) => cell(m, t2)).join('+') || '0'); continue; }
          const lk = order[members.length];
          const src = lk ? lineTotals.get(lk)?.[pickKey] : undefined;
          if (src && has(k)) { row(k, (t2) => cell(src, t2)); members.push(k); }
        }
        continue;
      }
      if (t.title.startsWith('HQ & Corporate Overheads')) {
        hqStored.forEach((_, i) => row(K(t.rows[i]?.label ?? ''), (t2) => at(hqRows[i], t2)));
        row(K('Total HQ Opex'), (t2) => at(hqTotal, t2));
        continue;
      }
      if (t.title === 'Project Total Opex') {
        const all = [...calcs.values()];
        const S2 = (pickRow: (c: AssetCalc) => number) => (t2: number): string => sumOf(all.map(pickRow), t2);
        row(K('Direct costs'), S2((c) => c.direct));
        row(K('Indirect costs'), S2((c) => c.indirect));
        row(K('Management fees and replacement reserve'), S2((c) => c.mgmt));
        row(K('Other charges'), S2((c) => c.other));
        row(K('All asset opex'), S2((c) => c.total));
        row(K('HQ overheads'), (t2) => at(hqTotal, t2));
        row(K('Total Project Opex'), (t2) => `${sumOf(all.map((c) => c.total), t2)}+${at(hqTotal, t2)}`);
      }
    }

    // Payables roll-forwards.
    const apRows = (lineKey: string, inc: string, pick: (f: (a: ApCalc) => number, t: number) => string): void => {
      const K = (label: string): string => `opex|${lineKey}|ap|${label}`;
      row(K('Opening AP'), (t) => pick((a) => a.open, t), 'first');
      row(K(inc), (t) => pick((a) => a.inc, t));
      row(K('Less: Cash Paid'), (t) => `-(${pick((a) => a.paid, t)})`);
      row(K('Closing AP'), (t) => pick((a) => a.close, t), 'last');
    };
    for (const rl of planReportLines(lineState, (a) => snap.ap.byAsset.has(a.id))) {
      const ms = rl.assetIds.map((id) => apByAsset.get(id)).filter((x): x is ApCalc => !!x);
      apRows(`ap:${rl.assetIds.join('+')}`, 'Opex Incurred', (f, t) => ms.map((m) => at(f(m), t)).join('+') || '0');
    }
    apRows('__hq__', 'HQ Opex Incurred', (f, t) => at(f(apHq), t));
    const allAp = [...apByAsset.values(), apHq];
    apRows('__project__', 'Opex Incurred', (f, t) => allAp.map((m) => at(f(m), t)).join('+'));

    const formulas = w.formulas.get(OPEX) ?? 0;
    return [{
      sheet: OPEX, status: 'live' as const, formulas,
      note: 'Opex: every line is charged on the Revenue working sheet over its operating window, then GOP, the lines charged on GOP, the operating statements, the project total and the payables. A line\'s mode and category are fixed at export; a row the platform hides while it is zero stays hidden, but every total includes it.',
    }];
  },
};
