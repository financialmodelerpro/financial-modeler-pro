/**
 * stage2Capex.ts (2026-09-27; rebuilt on the visible tab 2026-10-15), FORMULA-LINKED
 * EXPORT, STAGE 2: CAPEX.
 *
 * Every figure is a row on the Capex tab (founder, 2026-10-14: no hidden sheets); since 2026-10-27
 * the tab is one schedule by asset and the spend shares it reads, with no input card. A row is the
 * engine's own rule (computeAssetCost), one per cost line per asset:
 *
 *   Rate      B: read where it is typed (Inputs, the land value lines' locked 100%) or the cost
 *             standard row the platform picked
 *   Quantity  C: rate_x_* methods: the Land & Area figure (the line's merged figure for an asset on
 *             several plots); percent of cash / in-kind land: the line's land value on Land & Area;
 *             percent of selected lines: the SUM of the asset's rows it selects (upward only);
 *             marketing: the line's sales value on Revenue
 *   Years     B x C x the spend share of the year x the escalation factor of the year (escalating
 *             lines only, lineEscalates)
 *
 * The spend shares are one row per distinct spread (capexSpread.ts, shared with the builder): even
 * over a window of phase periods, the plot's typed curve inside it over its total there, or the
 * line's sales collections inside the phase's years, each even where the curve or the collections
 * say nothing. A followed window is the construction years' rule (deriveCostWindow, a landscape-type
 * line from half the construction years); an own window is typed on Inputs. Where an asset's plots
 * spread a line differently (planCapexBlends), a hard line blends them by plot quantity and the soft
 * lines by each plot's hard-cost money, which is exact while every soft line selects all the hard
 * lines.
 *
 * REFUSES by name, leaving Capex as values: a deferred land payment, an allocated
 * line, a method outside the set above, a line spread other than evenly, a curve
 * typed on one plot's override, a phase-specific or hidden standard rate, a base not
 * on Land & Area, a plot window typed on a line that follows the construction years,
 * and a pooled line whose plots file under different capex categories.
 *
 * STRUCTURAL, fixed at export: which lines exist on which plot, which lines a
 * percentage selects, which standard row a rate comes from, which source a line's
 * timing follows, and which lines are switched off.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { capexCols } from '../buildModelWorkbook';
import { ARGB } from '../styles';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { resolveCostCategory, isLandValueLine, deriveCostStage } from '@/src/core/calculations';
import { assetVisibleLines, allowedSelectedIds } from '@/src/core/calculations/selectedBase';
import { isParcelDrivenLandLine, resolvePhasingSource } from '@/src/core/calculations/capexPhasing';
import { isRetailCompanion } from '@/src/core/calculations/retailCompanion';
import { isExpensedAsIncurred } from '@/src/core/calculations/sellingExpense';
import { standardTypeIdFor, standardIdentity, pickStandardRate } from '../../state/costStandards';
import type { Asset, CostLine, CostOverride, Phase } from '../../state/module1-types';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { buildCapexReport, assetCapexSection } from '../../reports/capexReports';
import { poolCapexByLine, planReportLines } from '../../reports/lineRows';
import { planCapexSpread, planCapexBlends, followedRule } from './capexSpread';

const CAPEX = 'Capex';
const INPUTS = 'Inputs';
const SUPPORTED = new Set([
  'rate_x_main_asset_gfa', 'rate_x_parking_area', 'rate_x_landscape_area', 'rate_x_retail_gfa', 'rate_x_retail_parking_area',
  'percent_of_cash_land', 'percent_of_inkind_land', 'percent_of_selected', 'percent_of_revenue_sale',
]);
const PERCENT = (m: string): boolean => m.startsWith('percent_of_');

/** Where a rate is typed: a cost standard row, the land value lines' locked 100%, the cost line
 *  itself (one input per line), or the line's override on this pooled line (one input per line row). */
type RateSrc = { kind: 'std'; key: string } | { kind: 'locked' } | { kind: 'plot'; value: number } | { kind: 'line' };
type Base = { kind: 'ref'; key: string; ifNumber?: boolean } | { kind: 'zero' } | { kind: 'selected'; ids: string[] } | { kind: 'revenue' };
interface PlotLine {
  asset: Asset; line: CostLine; method: string; disabled: boolean; rate: RateSrc; base: Base;
  /** The plot's own window (typed on its Inputs row). */
  ownWindow: boolean;
  key: string;
}

/** THE EFFECTIVE METHOD OF A CAPEX ROW KEY (`cxc:<plot>:<line>`): the plot's override, else the line's. */
export function capexMethodOf(state: { costLines: CostLine[]; costOverrides: CostOverride[] }, key: string): string {
  const [, plot, lineId] = key.split(':');
  const line = state.costLines.find((l) => l.id === lineId);
  const ov = state.costOverrides.find((o) => o.assetId === plot && o.lineId === lineId);
  return String(ov && ov.overridden !== false ? ov.method ?? line?.method : line?.method);
}

export const stage2Capex: LiveLayer = {
  name: 'stage 2: capex',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const raw = ctx.opts.state;
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const project = state.project;
    const phases = state.phases as Phase[];
    const costLines = state.costLines as CostLine[];
    const overrides = state.costOverrides as CostOverride[];
    const snap = computeFinancialsSnapshot(state);
    const N = snap.axisLength;
    const capex = buildCapexReport(snap, state);
    const pooled = poolCapexByLine(capex, state);
    const { C_QTY, C_OPEN, C_TOT } = capexCols(N);
    const cP = (t: number): number => C_OPEN + 1 + t;
    const w = new LiveWriter(wb, reg, ctx.pending);
    LiveWriter.totalCols.set(CAPEX, C_TOT);
    const values = (why: string) => [{ sheet: CAPEX, status: 'values' as const, formulas: 0, note: `Capex could not be made live for this model: ${why}.` }];
    if (!w.has('cx:escf') || !w.has('cx:esc')) return values('the sheet was not laid out for the live workbook');

    // ── What each plot's line is ─────────────────────────────────────────────
    const refuse: string[] = [];
    if ((project.financing?.parcelFunding ?? []).some((p) => p.fundingType === 'deferred_payment')) refuse.push('a plot is paid on a deferred schedule');
    const stdRows = project.costStandardRows ?? [];
    const assetTypes = project.assetTypes ?? [];
    const members = new Map(pooled.members);
    const membersOf = (host: string): string[] => members.get(host) ?? [host];
    const hostOf = new Map<string, string>();
    for (const [host, ids] of members) for (const id of ids) hostOf.set(id, host);
    const noRevenueRows = (a: Asset): boolean => !(state.subUnits as Array<{ assetId: string; category?: string }>).some((u) => u.assetId === a.id && u.category !== 'Support');
    const plotLines = new Map<string, PlotLine>();
    const plotAssets = [...members.values()].flat().map((id) => state.assets.find((a) => a.id === id)).filter((a): a is Asset => !!a);
    for (const a of plotAssets) {
      const phase = phases.find((p) => p.id === a.phaseId);
      if (!phase) { refuse.push(`${a.name} has no phase`); continue; }
      if (a.isCompanion === true && !isRetailCompanion(a)) continue; // the Operate companion carries no cost
      if (a.capexPhasing && a.capexPhasing.phasing !== 'manual') refuse.push(`${a.name}'s spend curve is ${a.capexPhasing.phasing}, not typed by period`);
      const typeId = standardTypeIdFor(a, assetTypes);
      for (const line of assetVisibleLines(costLines, phase.id, a.id, a.strategy)) {
        const ov = overrides.find((o) => o.assetId === a.id && o.lineId === line.id);
        const act = ov !== undefined && ov.overridden !== false;
        const method = String(act ? ov!.method ?? line.method : line.method);
        const phasing = act ? ov!.phasing ?? line.phasing : line.phasing;
        const disabled = line.disabled === true || (act && ov!.disabled === true);
        const where = `${line.name} on ${a.name}`;
        if (resolveCostCategory(line) !== 'direct') refuse.push(`${where} is allocated across the phase`);
        if (!SUPPORTED.has(method)) refuse.push(`${where} uses ${method}`);
        if (phasing !== 'even' && phasing !== 'phase_aligned') refuse.push(`${where} spreads ${phasing}`);
        if (act && ov!.distribution !== undefined) refuse.push(`${where} has a curve typed for this plot`);
        const ownWindow = act && (ov!.startPeriod !== undefined || ov!.endPeriod !== undefined);
        if (ownWindow && line.windowFollowsConstruction === true) refuse.push(`${where} types its own window on a line that follows the construction years`);
        // The rate.
        let rate: RateSrc = { kind: 'line' };
        if (act && ov!.origin === 'standard') {
          const identity = standardIdentity(line);
          const pick = identity ? pickStandardRate(stdRows, typeId, identity, phase.id) : undefined;
          if (!pick) refuse.push(`${where}: no standard row found for its rate`);
          else if (typeof pick.row.byPhase?.[phase.id] === 'number') refuse.push(`${where} takes a phase-specific standard rate, shown on Inputs only as text`);
          else if (!w.has(`std:${pick.row.id}:rate`)) refuse.push(`${where} takes its rate from a standard row Inputs does not show`);
          else rate = { kind: 'std', key: `std:${pick.row.id}:rate` };
        } else if (line.isLocked === true && isLandValueLine(line) && !act) rate = { kind: 'locked' };
        else if (act && ov!.value !== undefined) rate = { kind: 'plot', value: ov!.value };
        // The quantity.
        const strip = isRetailCompanion(a);
        let base: Base = { kind: 'zero' };
        switch (method) {
          case 'rate_x_main_asset_gfa': base = strip ? { kind: 'zero' } : { kind: 'ref', key: `chain:${a.id}:main` }; break;
          case 'rate_x_parking_area':
            // The chain's figure wins; a typed area is read only where the chain derives none (resolveAssetAreaMetrics).
            if (!strip && (a.parkingArea ?? 0) > 0 && (!w.has(`chain:${a.id}:parea`) || !Number.isFinite(a.derivedAreas?.parkingAreaSqm))) refuse.push(`${a.name} types a parking area the chain does not replace`);
            base = strip ? { kind: 'zero' } : { kind: 'ref', key: `chain:${a.id}:parea`, ifNumber: true }; break;
          case 'rate_x_landscape_area': base = strip ? { kind: 'zero' } : { kind: 'ref', key: `chain:${a.id}:ls`, ifNumber: true }; break;
          case 'rate_x_retail_gfa': base = strip ? { kind: 'ref', key: `chaincomp:${a.name}:ret` } : { kind: 'zero' }; break;
          case 'rate_x_retail_parking_area': base = strip ? { kind: 'ref', key: `chaincomp:${a.name}:rparea`, ifNumber: true } : { kind: 'zero' }; break;
          case 'percent_of_cash_land': base = { kind: 'ref', key: `land:${a.id}:cash` }; break;
          case 'percent_of_inkind_land': base = { kind: 'ref', key: `land:${a.id}:inkind` }; break;
          case 'percent_of_selected': base = { kind: 'selected', ids: allowedSelectedIds(assetVisibleLines(costLines, phase.id, a.id, a.strategy), line.id, line.selectedLineIds) }; break;
          case 'percent_of_revenue_sale':
            if (noRevenueRows(a)) base = { kind: 'zero' };
            else if (!w.has(`rvc:${a.id}:saleRev`)) refuse.push(`${where}: the plot's sale revenue is not on Revenue`);
            else base = { kind: 'revenue' };
            break;
        }
        if (base.kind === 'ref' && !w.has(base.key)) refuse.push(`${where}: its base (${base.key}) is not on Land & Area`);
        const src = isParcelDrivenLandLine(line) ? 'own' : resolvePhasingSource(line, ov);
        if (!['own', 'inherit', 'land_cash', 'collections'].includes(src)) refuse.push(`${where} follows ${src}`);
        // A line EXPENSED AS INCURRED (marketing, sellingExpense.ts) keys `cxe:`, so every stage that
        // sums a plot's capex (`cxc:`) leaves it out, as computeAssetCost does (2026-10-08).
        plotLines.set(`${a.id}|${line.id}`, { asset: a, line, method, disabled, rate, base, ownWindow, key: `${isExpensedAsIncurred(line) ? 'cxe' : 'cxc'}:${a.id}:${line.id}` });
      }
    }
    // THE PLATFORM TAKES ONE RATE AND ONE WINDOW PER LINE (an override typed on a line is fanned out to
    // every plot), so Inputs shows one row per line: a stored override that differs between a line's
    // plots has no input to read and is refused; a line that needs an input and has no row is refused.
    for (const pl of plotLines.values()) {
      const host = hostOf.get(pl.asset.id) ?? pl.asset.id;
      const sibs = membersOf(host).map((id) => plotLines.get(`${id}|${pl.line.id}`)).filter((x): x is PlotLine => !!x);
      const sig = (x: PlotLine): string => (x.rate.kind === 'plot' ? `v:${x.rate.value}` : x.rate.kind === 'std' ? x.rate.key : x.rate.kind);
      if (new Set(sibs.map(sig)).size > 1) refuse.push(`the plots of ${pl.line.name} on ${host} carry different rates, and Inputs shows one per line`);
      const winOf = (x: PlotLine): string => { const o = overrides.find((v) => v.assetId === x.asset.id && v.lineId === x.line.id); return x.ownWindow ? `${o?.startPeriod}-${o?.endPeriod}` : 'line'; };
      if (new Set(sibs.map(winOf)).size > 1) refuse.push(`the plots of ${pl.line.name} on ${host} carry different windows, and Inputs shows one per line`);
      const needsRow = !pl.disabled && (pl.rate.kind !== 'std' || (pl.ownWindow || (pl.line.windowFollowsConstruction !== true && !isExpensedAsIncurred(pl.line))));
      if (needsRow && !w.has(`inpcx:${host}:${pl.line.id}`)) refuse.push(`${pl.line.name} on ${pl.asset.name} has no row on Inputs`);
    }
    for (const [, ids] of members) {
      const cats = new Set(ids.map((id) => state.assets.find((a) => a.id === id)).filter((a): a is Asset => !!a).map((a) => assetCapexSection(a, project)));
      if (cats.size > 1) refuse.push(`a line's plots file under different capex categories (${[...cats].join(', ')})`);
    }
    const plan = planCapexSpread(state, members, snap.revenue as never, snap.projectStartYear, N);
    for (const sp of plan.rows.values()) {
      if (!w.has(`cxw:${sp.key}`)) refuse.push(`the spend share "${sp.label}" is not on the sheet`);
      if (sp.kind === 'curve' && !w.has(`inpcurve:${sp.assetId}`)) refuse.push(`the spend curve of ${sp.label} is not on Inputs`);
      if (sp.kind === 'collections' && !w.has(`rvc:${sp.assetId}:cash`)) refuse.push(`the collections of ${sp.label} are not on Revenue`);
    }
    // THE BLENDS (2026-10-27): a soft line blends on its plots' hard-cost money, exact only while it
    // selects every hard line of the asset, directly or through soft lines that do.
    const blends = planCapexBlends(state, members, plan, (a) => isRetailCompanion(a));
    for (const o of blends.other) refuse.push(`${costLines.find((c) => c.id === o.lid)?.name ?? o.lid} spreads differently on the plots of one asset and is neither a rate on an area nor a share of selected lines`);
    const hardSel = (host: string, lid: string, seen = new Set<string>()): Set<string> | null => {
      const pl = membersOf(host).map((id) => plotLines.get(`${id}|${lid}`)).find((x) => !!x);
      if (!pl || seen.has(lid)) return null;
      seen.add(lid);
      if (pl.method.startsWith('rate_x_')) return new Set([lid]);
      if (pl.base.kind !== 'selected') return null;
      const out = new Set<string>();
      for (const id of pl.base.ids) { const s = hardSel(host, id, new Set(seen)); if (!s) return null; for (const x of s) out.add(x); }
      return out;
    };
    for (const b of blends.soft) {
      const want = new Set(blends.hardLines.get(b.host) ?? []);
      for (const lid of b.lids) {
        const got = hardSel(b.host, lid);
        if (!got || got.size !== want.size || [...want].some((x) => !got.has(x))) refuse.push(`${costLines.find((c) => c.id === lid)?.name ?? lid} on an asset with several plots selects only some of its hard lines`);
      }
    }
    if (refuse.length) return values([...new Set(refuse)].join('; '));

    // ── Writing helpers ──────────────────────────────────────────────────────
    const colOf = (c: number): string => { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
    /** A fixed cell on this tab. */
    const A = (row: number, col: number): string => w.refA({ sheet: CAPEX, row, col }, CAPEX);
    /** This year's cell of a row on this tab, column relative. */
    const P = (row: number, col: number): string => w.refP({ sheet: CAPEX, row, col }, CAPEX);
    const sumAcross = (row: number): string => `SUM(${w.rangeA(CAPEX, row, cP(0), cP(N - 1)).replace(/^'?Capex'?!/, '')})`;
    /** A block of rows in one column, as one SUM (a range where they are contiguous). */
    const sumCol = (rows: number[], c: number): string => {
      if (!rows.length) return '0';
      const s = [...rows].sort((x, y) => x - y);
      for (const rr of s) P(rr, c);
      const L = colOf(c);
      if (s.length === 1) return `${L}$${s[0]}`;
      const runs: string[] = [];
      for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; runs.push(j > i ? `${L}$${s[i]}:${L}$${s[j]}` : `${L}$${s[i]}`); i = j + 1; }
      return `SUM(${runs.join(',')})`;
    };
    const axis = (): string => w.ref('project:axisYear');
    const inpRow = (plot: string, lineId: string): number => w.addr(`inpcx:${hostOf.get(plot) ?? plot}:${lineId}`).row;
    const inp = (row: number, col: number): string => w.refA({ sheet: INPUTS, row, col });

    // ONE INPUT PER COST LINE (2026-10-15): a rate or a window the cost line carries is typed on
    // its first plot's Inputs row; every other plot's row of that line is blank.
    const firstRow = new Map<string, number>();
    const firstWindowRow = new Map<string, number>();
    for (const k of reg.keys().filter((x) => x.startsWith('inpcx:'))) {
      const [, plot, lineId] = k.split(':');
      const pl = plotLines.get(`${plot}|${lineId}`) ?? membersOf(plot).map((id) => plotLines.get(`${id}|${lineId}`)).find((x) => !!x);
      if (!pl) continue;
      const row = w.addr(k).row;
      if (pl.rate.kind === 'line' && !firstRow.has(lineId)) firstRow.set(lineId, row);
      const followsOrOther = pl.line.windowFollowsConstruction === true || pl.ownWindow || (!isParcelDrivenLandLine(pl.line) && resolvePhasingSource(pl.line, overrides.find((o) => o.assetId === plot && o.lineId === lineId)) === 'land_cash');
      if (!followsOrOther && !firstWindowRow.has(lineId)) firstWindowRow.set(lineId, row);
    }

    // ── The escalation factor, by the year the money is spent ───────────────
    const escRow = w.addr('cx:escf').row;
    for (let t = 0; t < N; t++) w.fA({ sheet: CAPEX, row: escRow, col: cP(t) }, `(1+${w.ref('cx:esc')})^(${P(4, cP(t))}-1)`);

    // ── The spend shares, one row per distinct spread ──────────────────────
    // B from, C to (phase periods), D total, E the curve's or collections' total in the window.
    const C_FROM = 2, C_TO = 3, C_WIN = C_OPEN;
    // Each phase's period of every year, its first year in the Total column.
    for (const ph of phases) {
      if (!w.has(`cxpp:${ph.id}`)) continue;
      const pr = w.addr(`cxpp:${ph.id}`).row;
      w.fA({ sheet: CAPEX, row: pr, col: C_TOT }, `MAX(${axis()},YEAR(${w.ref(`tl:phase:${ph.id}:cs`)}))`);
      for (let t = 0; t < N; t++) w.fA({ sheet: CAPEX, row: pr, col: cP(t) }, `${P(3, cP(t))}-${A(pr, C_TOT)}+1`);
    }
    for (const sp of plan.rows.values()) {
      const r = w.addr(`cxw:${sp.key}`).row;
      const ph = phases.find((p) => p.id === sp.phaseId)!;
      const cp = (): string => w.ref(`tl:phase:${ph.id}:cp`);
      if (sp.win === 'follows') {
        // The platform's rule (deriveCostWindow), from the construction years on Timeline.
        const rule = followedRule(sp.baseId);
        const start = rule === 'land' ? '0' : rule === 'half' ? `MAX(1,INT(${cp()}/2))` : rule === 'preop' ? `MAX(1,${cp()}-6)` : '1';
        w.fA({ sheet: CAPEX, row: r, col: C_FROM }, start);
        w.fA({ sheet: CAPEX, row: r, col: C_TO }, rule === 'land' ? '0' : `MAX(${A(r, C_FROM)},${cp()})`);
      } else {
        const ir = sp.win === 'plot' ? inpRow(sp.assetId!, sp.lineId) : firstWindowRow.get(sp.lineId);
        if (ir === undefined) return values(`the window of ${sp.label} has no input row`);
        w.fA({ sheet: CAPEX, row: r, col: C_FROM }, inp(ir, 6));
        w.fA({ sheet: CAPEX, row: r, col: C_TO }, inp(ir, 7));
      }
      // The phase period of a year: its year less the phase's first year, plus 1; period 0 is the
      // year before (never before the first model year).
      if (!w.has(`cxpp:${ph.id}`)) return values(`the phase periods of ${ph.name} are not on the sheet`);
      const ppr = w.addr(`cxpp:${ph.id}`).row;
      const first = A(ppr, C_TOT);
      const B = A(r, C_FROM), C = A(r, C_TO);
      const i1 = (c: number): string => P(ppr, c);
      const z0 = (c: number): string => `(${P(3, c)}=MAX(${axis()},${first}-1))`;
      const inWin = (c: number): string => `(${i1(c)}>=MAX(1,${B}))*(${i1(c)}<=MAX(${B},${C}))`;
      // A window that follows the construction years never holds period 0 unless it is the land rule.
      const p0 = sp.win !== 'follows' || followedRule(sp.baseId) === 'land';
      const even = (c: number): string => `(${p0 ? `${z0(c)}*(${B}<=0)+` : ''}${inWin(c)})/(MAX(${B},${C})-${B}+1)`;
      if (sp.kind === 'even') {
        for (let t = 0; t < N; t++) w.fA({ sheet: CAPEX, row: r, col: cP(t) }, even(cP(t)));
      } else if (sp.kind === 'curve') {
        // The plot's typed curve inside the window, over its total there (even where it is zero).
        const cv = w.addr(`inpcurve:${sp.assetId}`).row;
        const rng = w.rangeA(INPUTS, cv, 2, 2 + N);
        const at = (k: string): string => `INDEX(${rng},1,${k})`;
        w.fA({ sheet: CAPEX, row: r, col: C_WIN }, `${p0 ? `(${B}<=0)*${at('1')}+` : ''}SUM(${at(`MAX(1,${B})+1`)}:${at(`MAX(${B},${C})+1`)})`);
        const W = A(r, C_WIN);
        for (let t = 0; t < N; t++) {
          const c = cP(t);
          w.fA({ sheet: CAPEX, row: r, col: c }, `IF(${W}>0,(${p0 ? `${z0(c)}*(${B}<=0)*${at('1')}+` : ''}IF(${inWin(c)},${at(`${i1(c)}+1`)},0))/${W},${even(c)})`);
        }
      } else {
        // The line's sales collections inside the phase's years, over their total there.
        const cash = w.addr(`rvc:${sp.assetId}:cash`);
        const yrs = w.rangeA(CAPEX, 3, cP(0), cP(N - 1)).replace(/^'?Capex'?!/, '');
        const cashRng = w.rangeA(cash.sheet, cash.row, cP(0), cP(N - 1));
        const slots = `${cp()}+${w.ref(`tl:phase:${ph.id}:op`)}+1`;
        const pps = w.rangeA(CAPEX, ppr, cP(0), cP(N - 1)).replace(/^'?Capex'?!/, '');
        void yrs;
        w.fA({ sheet: CAPEX, row: r, col: C_WIN }, `SUMPRODUCT((${pps}>=1)*(${pps}<=${slots}),${cashRng})`);
        const W = A(r, C_WIN);
        for (let t = 0; t < N; t++) {
          const c = cP(t);
          w.fA({ sheet: CAPEX, row: r, col: c }, `IF(${W}>0,(${i1(c)}>=1)*(${i1(c)}<=${slots})*${w.refP({ sheet: cash.sheet, row: cash.row, col: c }, CAPEX)}/${W},${even(c)})`);
        }
      }
      w.fA({ sheet: CAPEX, row: r, col: C_TOT }, sumAcross(r));
    }

    // ── Table 1: ONE ROW PER COST LINE PER ASSET ─────────────────────────────
    const hostLines = new Map<string, string[]>();
    for (const m of pooled.report.inputAssets) hostLines.set(m.assetId, m.lines.map((l) => l.id));
    const chainLineKey = new Map<string, string>();
    for (const l of planReportLines(state, () => true)) for (const id of l.assetIds) chainLineKey.set(id, l.key);
    const repOf = (host: string, lid: string): PlotLine | undefined => membersOf(host).map((id) => plotLines.get(`${id}|${lid}`)).find((x): x is PlotLine => !!x);
    const plsOf = (host: string, lid: string): PlotLine[] => membersOf(host).map((id) => plotLines.get(`${id}|${lid}`)).filter((x): x is PlotLine => !!x);
    const rowOf = new Map<string, number>();
    const hostOfRep = new Map<string, string>();
    for (const [host, lids] of hostLines) {
      for (const lid of lids) {
        const rep = repOf(host, lid);
        if (!rep || !w.has(`cx1:${host}:${lid}`)) continue;
        rowOf.set(`${rep.asset.id}|${lid}`, w.addr(`cx1:${host}:${lid}`).row);
        hostOfRep.set(`${rep.asset.id}|${lid}`, host);
      }
    }
    // Selling and marketing expensed as incurred: a row per asset, outside Table 1.
    for (const pl of plotLines.values()) {
      if (!pl.key.startsWith('cxe:')) continue;
      const host = hostOf.get(pl.asset.id) ?? pl.asset.id;
      const rep = repOf(host, pl.line.id);
      const ek = `cx1e:${host}:${pl.line.id}`;
      if (rep && w.has(ek) && !rowOf.has(`${rep.asset.id}|${pl.line.id}`)) {
        rowOf.set(`${rep.asset.id}|${pl.line.id}`, w.addr(ek).row);
        hostOfRep.set(`${rep.asset.id}|${pl.line.id}`, host);
      }
    }
    for (const pl of plotLines.values()) {
      if (pl.disabled || !pl.key.startsWith('cxe:')) continue;
      const host = hostOf.get(pl.asset.id) ?? pl.asset.id;
      const rep = repOf(host, pl.line.id);
      if (rep && !rowOf.has(`${rep.asset.id}|${pl.line.id}`)) return values(`${pl.line.name} on ${pl.asset.name} has no row on the sheet`);
    }
    /** One plot's quantity for its line (the base its rate multiplies), as the engine reads it. */
    const plotQty = (pl: PlotLine): string => {
      const b = pl.base;
      if (b.kind === 'ref') return w.ref(b.key);
      if (b.kind === 'revenue') return w.one(`rvc:${pl.asset.id}:saleRev`);
      return '0';
    };
    /** An asset's quantity: the line's figure on Land & Area where it has one, else its plot's. */
    const MERGED: Record<string, string> = { rate_x_main_asset_gfa: 'chainline:%:main', rate_x_parking_area: 'chainline:%:parea', rate_x_landscape_area: 'chainline:%:ls', percent_of_cash_land: 'landline:%:cash', percent_of_inkind_land: 'landline:%:inkind' };
    const assetQty = (host: string, pls: PlotLine[]): string => {
      const rep = pls[0];
      if (rep.base.kind === 'selected') {
        const rows = rep.base.ids.map((id) => rowOf.get(`${rep.asset.id}|${id}`)).filter((x): x is number => x !== undefined);
        return sumCol(rows, C_TOT).replace(/([A-Z]+)\$(\d+)/g, '$$$1$$$2');
      }
      if (pls.length === 1) return plotQty(rep);
      const lk = chainLineKey.get(host);
      const mk = MERGED[rep.method] && lk ? MERGED[rep.method].replace('%', lk) : '';
      if (mk && w.has(mk) && pls.every((x) => x.base.kind === 'ref')) return w.ref(mk);
      return pls.map(plotQty).join('+');
    };
    const rateRef = (pl: PlotLine): string => (pl.rate.kind === 'std' ? w.ref(pl.rate.key)
      : inp(pl.rate.kind === 'line' ? (firstRow.get(pl.line.id) ?? inpRow(pl.asset.id, pl.line.id)) : inpRow(pl.asset.id, pl.line.id), 3));

    // ── The blends: where an asset's plots spread a line differently ────────
    const spreadRow = (plot: string, lid: string): number => w.addr(`cxw:${plan.plotLine.get(`${plot}|${lid}`)!.spread}`).row;
    const blendRow = (r: number, plots: string[], weight: (id: string) => string, lid: (id: string) => string): void => {
      const W = plots.map(weight);
      const tot = W.length > 1 ? `(${W.join('+')})` : W[0];
      for (let t = 0; t < N; t++) {
        const c = cP(t);
        const terms = plots.map((id, i) => `${W[i]}*${P(spreadRow(id, lid(id)), c)}`);
        w.fA({ sheet: CAPEX, row: r, col: c }, `IF(${tot}>0,(${terms.join('+')})/${tot},${P(spreadRow(plots[0], lid(plots[0])), c)})`);
      }
      w.fA({ sheet: CAPEX, row: r, col: C_TOT }, sumAcross(r));
    };
    for (const b of blends.hard) {
      if (!w.has(b.key)) return values(`the blended spend share of ${b.lid} on ${b.host} is not on the sheet`);
      blendRow(w.addr(b.key).row, b.plots, (id) => plotQty(plotLines.get(`${id}|${b.lid}`)!), () => b.lid);
    }
    for (const wt of blends.weights) {
      if (!w.has(wt.key)) return values('a plot\'s hard-cost weight is not on the sheet');
      // The plot's hard-cost money: each hard line's rate x the plot's quantity, spread and escalated.
      const parts = (blends.hardLines.get(wt.host) ?? []).map((lid) => {
        const pl = plotLines.get(`${wt.plot}|${lid}`);
        if (!pl || pl.disabled) return '';
        const sp = plan.plotLine.get(`${wt.plot}|${lid}`)!;
        const esc = sp.escalates ? `*SUMPRODUCT(${w.rangeA(CAPEX, spreadRow(wt.plot, lid), cP(0), cP(N - 1)).replace(/^'?Capex'?!/, '')},${w.rangeA(CAPEX, escRow, cP(0), cP(N - 1)).replace(/^'?Capex'?!/, '')})` : '';
        return `${rateRef(pl)}*${plotQty(pl)}${esc}`;
      }).filter(Boolean);
      w.f(wt.key, parts.join('+') || '0', { col: C_TOT });
    }
    for (const b of blends.soft) {
      if (!w.has(b.key)) return values(`the blended soft-cost share on ${b.host} is not on the sheet`);
      const wRow = (id: string): string => A(w.addr(`cxhw:${b.host}:${id}`).row, C_TOT);
      blendRow(w.addr(b.key).row, b.plots, wRow, () => b.lids[0]);
    }

    for (const [pk, row] of rowOf) {
      const rep = plotLines.get(pk)!;
      const host = hostOfRep.get(pk)!;
      const pls = plsOf(host, rep.line.id);
      w.claim(rep.key, CAPEX, row, 1);
      const rateCell = rep.rate.kind === 'std' ? w.addr(rep.rate.key)
        : { sheet: INPUTS, row: rep.rate.kind === 'line' ? (firstRow.get(rep.line.id) ?? inpRow(rep.asset.id, rep.line.id)) : inpRow(rep.asset.id, rep.line.id), col: 3 };
      // Named apart from the row keys (cxc:<plot>:<line>), which readers find by prefix.
      w.claim(rep.key.replace(/^cx[ce]:/, 'cxrate:'), rateCell.sheet, rateCell.row, rateCell.col);
      // The rate as a number (B) and the quantity (C), read where they are typed or derived.
      w.fA({ sheet: CAPEX, row, col: 2 }, rateRef(rep));
      w.fA({ sheet: CAPEX, row, col: C_QTY }, assetQty(host, pls));
      const use = blends.use.get(`${host}|${rep.line.id}`);
      const spRow = use && w.has(use) ? w.addr(use).row : undefined;
      if (pls.some((x) => x.disabled) && !pls.every((x) => x.disabled)) return values(`${rep.line.name} is switched off on some plots of ${host} and not on others`);
      const off = pls.every((x) => x.disabled);
      const esc = plan.plotLine.get(pk)?.escalates;
      for (let t = 0; t < N; t++) {
        const c = cP(t);
        if (off || spRow === undefined) { w.valueA({ sheet: CAPEX, row, col: c }, 0); continue; }
        // Rate x quantity x the year's spend share x the year's escalation factor.
        w.fA({ sheet: CAPEX, row, col: c }, `${A(row, 2)}*${A(row, C_QTY)}*${P(spRow, c)}${esc ? `*${P(escRow, c)}` : ''}`);
      }
      w.fA({ sheet: CAPEX, row, col: C_TOT }, sumAcross(row));
    }
    const K = (key: string, col: number): string => w.refA({ sheet: CAPEX, row: w.addr(key).row, col }, CAPEX);
    /** A total row: the SUM of the given rows, every year and the Total. */
    const sumKeys = (key: string, keys: string[]): void => {
      if (!w.has(key)) return;
      const r = w.addr(key).row;
      const rows = keys.filter((k) => w.has(k)).map((k) => w.addr(k).row);
      for (let t = 0; t < N; t++) w.fA({ sheet: CAPEX, row: r, col: cP(t) }, sumCol(rows, cP(t)));
      w.fA({ sheet: CAPEX, row: r, col: C_TOT }, sumAcross(r));
    };
    const t1Keys = (host: string): string[] => (hostLines.get(host) ?? []).map((lid) => `cx1:${host}:${lid}`).filter((k) => w.has(k));
    for (const host of hostLines.keys()) sumKeys(`cx1sub:${host}`, t1Keys(host));
    const hosts = [...hostLines.keys()].filter((h) => w.has(`cx1sub:${h}`));
    if (w.has('cx1e:total')) sumKeys('cx1e:total', reg.keys().filter((k) => k.startsWith('cx1e:') && k !== 'cx1e:total'));
    sumKeys('cx1:total', hosts.map((h) => `cx1sub:${h}`));

    // ── Tables 2 and 4: an asset's capex incl. and excl. its land value ──────
    const lineById = new Map(costLines.map((l) => [l.id, l] as const));
    const landKeys = (host: string, pred: (l: CostLine) => boolean): string[] => t1Keys(host).filter((k) => { const l = lineById.get(k.split(':')[2]); return !!l && pred(l); });
    const isInKindLand = (l: CostLine): boolean => isLandValueLine(l) && l.method === 'percent_of_inkind_land';
    const isCashLand = (l: CostLine): boolean => isLandValueLine(l) && l.method === 'percent_of_cash_land';
    const KP = (key: string, col: number): string => w.refP({ sheet: CAPEX, row: w.addr(key).row, col }, CAPEX);
    const phaseOfHost = (h: string): string => state.assets.find((a) => a.id === h)?.phaseId ?? '';
    for (const [pfx, exclLand] of [['cx2', false], ['cx4', true]] as const) {
      const inTable = hosts.filter((h) => w.has(`${pfx}:${h}`));
      for (const h of inTable) {
        const r = w.addr(`${pfx}:${h}`).row;
        const minus = exclLand ? landKeys(h, (l) => isLandValueLine(l)) : [];
        for (let t = 0; t < N; t++) w.fA({ sheet: CAPEX, row: r, col: cP(t) }, `${KP(`cx1sub:${h}`, cP(t))}${minus.map((k) => `-${KP(k, cP(t))}`).join('')}`);
        w.fA({ sheet: CAPEX, row: r, col: C_TOT }, sumAcross(r));
      }
      for (const ph of phases) sumKeys(`${pfx}sub:${ph.id}`, inTable.filter((h) => phaseOfHost(h) === ph.id).map((h) => `${pfx}:${h}`));
      sumKeys(`${pfx}:total`, inTable.map((h) => `${pfx}:${h}`));
    }

    // ── Table 5: land cash and in-kind by phase, and the rest of the land stage ─
    const byPhase = (phId: string, pred: (l: CostLine) => boolean): string[] => hosts.filter((h) => phaseOfHost(h) === phId).flatMap((h) => landKeys(h, pred));
    const isMemo = (l: CostLine): boolean => deriveCostStage(l) === 'land' && !isLandValueLine(l);
    const cashK: string[] = [], inkK: string[] = [];
    for (const ph of phases) {
      if (w.has(`cx5:${ph.id}:cash`)) { sumKeys(`cx5:${ph.id}:cash`, byPhase(ph.id, isCashLand)); cashK.push(`cx5:${ph.id}:cash`); }
      if (w.has(`cx5:${ph.id}:inkind`)) { sumKeys(`cx5:${ph.id}:inkind`, byPhase(ph.id, isInKindLand)); inkK.push(`cx5:${ph.id}:inkind`); }
      sumKeys(`cx5:${ph.id}:sub`, [`cx5:${ph.id}:cash`, `cx5:${ph.id}:inkind`]);
      if (w.has(`cx5memo:${ph.id}`)) sumKeys(`cx5memo:${ph.id}`, byPhase(ph.id, isMemo));
    }
    if (w.has('cx5:total:cash')) { sumKeys('cx5:total:cash', cashK); sumKeys('cx5:total:inkind', inkK); sumKeys('cx5:total:land', ['cx5:total:cash', 'cx5:total:inkind']); }
    void K;

    const pending = [...w.pending].filter((a) => a.startsWith(`${CAPEX}!`));
    return [{
      sheet: CAPEX, status: pending.length ? 'partial' as const : 'live' as const, formulas: w.formulas.get(CAPEX) ?? 0, pending,
      note: 'Live: one row per cost line per asset (the rate from Inputs or the cost standards in B, the quantity from Land & Area, Revenue or the lines it selects in C, each year rate x quantity x the spend share x the escalation factor), the spend shares (one row per distinct spread; a blend only where an asset\'s plots spread a line differently), the selling and marketing expensed, and Tables 2, 4 and 5.',
    }];
  },
};
