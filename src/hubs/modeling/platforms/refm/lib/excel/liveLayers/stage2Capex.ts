/**
 * stage2Capex.ts (2026-09-27; rebuilt on the visible tab 2026-10-15), FORMULA-LINKED
 * EXPORT, STAGE 2: CAPEX.
 *
 * Every figure is a row on the Capex tab (founder, 2026-10-14: no hidden sheets). The
 * engine works per plot and cost line (`computeAssetCost`); the tab presents by line,
 * and a line with several plots shows each plot above it, the line row their total,
 * because the later tabs read a plot's own capex (cost of sales, depreciation, land
 * in kind). A plot's row is the engine's own rule:
 *
 *   Rate      Inputs (the line's or the plot's typed rate, the land value lines'
 *             locked 100%) or the cost standard row the platform picked
 *   Quantity  rate_x_* methods: the Land & Area figure (`resolveAssetAreaMetrics`:
 *             main asset GFA, main parking and landscape on a host, retail GFA and
 *             retail parking on a strip); percent of cash / in-kind land: the plot's
 *             land value; percent of selected lines: the totals of the plot's rows it
 *             selects (`allowedSelectedIds`, upward only); marketing: the plot's sale
 *             revenue on Revenue
 *   Years     rate x quantity x the spend share of the year x the escalation factor
 *             of the year (escalating lines only, `lineEscalates`); a percentage is
 *             clamped to 0..100%, a rate floored at zero
 *
 * The spend shares are rows above Table 1, one per distinct spread (`capexSpread.ts`,
 * shared with the builder): even over a window of phase periods, the plot's typed
 * curve inside it, or the plot's sales collections inside the phase's years, each
 * falling back to even where the curve or the collections say nothing, as
 * `resolveLinePhasing` does. A window is the construction years' rule
 * (`deriveCostWindow`), the cost line's own (typed once on Inputs, on its first plot's
 * row; the other plots' rows echo it) or one plot's own.
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
import { capexCols, capexBasisWords } from '../buildModelWorkbook';
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
import { planCapexSpread, followedRule } from './capexSpread';

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
    const { C_RATE, C_QTY, C_OPEN, C_TOT, C_CHK } = capexCols(N);
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
            if (!strip && (a.parkingArea ?? 0) > 0 && (!w.has(`chain:${a.id}:parea`) || typeof w.platformValue(w.addr(`chain:${a.id}:parea`)) !== 'number')) refuse.push(`${a.name} types a parking area the chain does not replace`);
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
      if (!w.has(`cxw:${sp.key}`) || ((sp.kind === 'curve' || sp.kind === 'collections') && !w.has(`cxwc:${sp.key}`))) refuse.push(`the spend share "${sp.label}" is not on the sheet`);
      if (sp.kind === 'curve' && !w.has(`inpcurve:${sp.assetId}`)) refuse.push(`the spend curve of ${sp.label} is not on Inputs`);
      if (sp.kind === 'collections' && !w.has(`rvc:${sp.assetId}:cash`)) refuse.push(`the collections of ${sp.label} are not on Revenue`);
    }
    if (refuse.length) return values([...new Set(refuse)].join('; '));

    // ── Writing helpers ──────────────────────────────────────────────────────
    const colOf = (c: number): string => { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
    /** A fixed cell on this tab. */
    const A = (row: number, col: number): string => w.refA({ sheet: CAPEX, row, col }, CAPEX);
    /** This year's cell of a row on this tab, column relative. */
    const P = (row: number, col: number): string => w.refP({ sheet: CAPEX, row, col }, CAPEX);
    const sumAcross = (row: number): string => `SUM(${w.rangeA(CAPEX, row, cP(0), cP(N - 1))})`;
    const unshade = (cell: ExcelJS.Cell): void => {
      cell.fill = { type: 'pattern', pattern: 'none' } as ExcelJS.Fill;
      cell.border = {};
      cell.font = { ...(cell.font ?? {}), color: { argb: ARGB.formula } };
    };
    const axis = (): string => w.ref('project:axisYear');
    const inpRow = (plot: string, lineId: string): number => w.addr(`inpcx:${hostOf.get(plot) ?? plot}:${lineId}`).row;
    const inp = (row: number, col: number): string => w.refA({ sheet: INPUTS, row, col });

    // ONE INPUT PER COST LINE (2026-10-15): a rate or a window the cost line carries is typed on
    // its first plot's Inputs row; every other plot's row echoes it.
    const firstRow = new Map<string, number>();
    const firstWindowRow = new Map<string, number>();
    for (const k of reg.keys().filter((x) => x.startsWith('inpcx:'))) {
      const [, plot, lineId] = k.split(':');
      const pl = plotLines.get(`${plot}|${lineId}`) ?? membersOf(plot).map((id) => plotLines.get(`${id}|${lineId}`)).find((x) => !!x);
      if (!pl) continue;
      const row = w.addr(k).row;
      // Typed once: the other rows of the same cost line are left blank (Inputs holds typed values only).
      if (pl.rate.kind === 'line' && !firstRow.has(lineId)) firstRow.set(lineId, row);
      const followsOrOther = pl.line.windowFollowsConstruction === true || pl.ownWindow || (!isParcelDrivenLandLine(pl.line) && resolvePhasingSource(pl.line, overrides.find((o) => o.assetId === plot && o.lineId === lineId)) === 'land_cash');
      if (!followsOrOther && !firstWindowRow.has(lineId)) firstWindowRow.set(lineId, row);
    }

    // ── The escalation factor, by the year the money is spent ───────────────
    const escRow = w.addr('cx:escf').row;
    const escRate = A(w.addr('cx:esc').row, w.addr('cx:esc').col);
    for (let t = 0; t < N; t++) w.fA({ sheet: CAPEX, row: escRow, col: cP(t) }, `(1+${escRate})^(${P(4, cP(t))}-1)`);

    // ── The spend shares ─────────────────────────────────────────────────────
    // Live columns: B from, C to, D Total, the phase's first year after the years.
    const C_FROM = 2, C_TO = 3, C_FY = C_CHK;
    for (const sp of plan.rows.values()) {
      const r = w.addr(`cxw:${sp.key}`).row;
      const ph = phases.find((p) => p.id === sp.phaseId)!;
      const cp = (): string => w.ref(`tl:phase:${ph.id}:cp`);
      // The phase's first year, and the window in phase periods, from the Timeline's phase table.
      w.fA({ sheet: CAPEX, row: r, col: C_FY }, `MAX(${axis()},YEAR(${w.ref(`tl:phase:${ph.id}:cs`)}))`);
      if (sp.win === 'follows') {
        const rule = followedRule(sp.baseId);
        const start = rule === 'land' ? '0' : rule === 'half' ? `MAX(1,INT(MAX(1,${cp()})/2))` : rule === 'preop' ? `MAX(1,MAX(1,${cp()})-6)` : '1';
        w.fA({ sheet: CAPEX, row: r, col: C_FROM }, start);
        w.fA({ sheet: CAPEX, row: r, col: C_TO }, rule === 'land' ? '0' : `MAX(${A(r, C_FROM)},MAX(1,${cp()}))`);
      } else {
        const ir = sp.win === 'plot' ? inpRow(sp.assetId!, sp.lineId) : firstWindowRow.get(sp.lineId);
        if (ir === undefined) return values(`the window of ${sp.label} has no input row`);
        w.fA({ sheet: CAPEX, row: r, col: C_FROM }, `N(${inp(ir, 6)})`);
        w.fA({ sheet: CAPEX, row: r, col: C_TO }, `N(${inp(ir, 7)})`);
      }
      const B = A(r, C_FY), C = A(r, C_FROM), D = A(r, C_TO);
      const i1 = (c: number): string => `(${P(3, c)}-${B}+1)`;
      const z0 = (c: number): string => `(${P(3, c)}=MAX(${axis()},${B}-1))`;
      const even = (c: number): string => `(${z0(c)}*(${C}<=0)+(${i1(c)}>=MAX(1,${C}))*(${i1(c)}<=MAX(${C},${D})))/(MAX(${C},${D})-${C}+1)`;
      if (sp.kind === 'even') {
        for (let t = 0; t < N; t++) w.fA({ sheet: CAPEX, row: r, col: cP(t) }, even(cP(t)));
      } else {
        const tr = w.addr(`cxwc:${sp.key}`).row;
        if (sp.kind === 'curve') {
          const cv = w.addr(`inpcurve:${sp.assetId}`).row;
          const L = Math.max(...plotAssets.filter((a) => a.capexPhasing?.phasing === 'manual').map((a) => (a.capexPhasing?.distribution ?? []).length));
          const rng = w.rangeA(INPUTS, cv, 2, 2 + L - 1);
          for (let t = 0; t < N; t++) {
            const c = cP(t);
            w.fA({ sheet: CAPEX, row: tr, col: c }, `${z0(c)}*(${C}<=0)*MAX(0,N(${inp(cv, 2)}))+IF(AND(${i1(c)}>=MAX(1,${C}),${i1(c)}<=MAX(${C},${D}),${i1(c)}<=COLUMNS(${rng})-1),MAX(0,INDEX(${rng},1,${i1(c)}+1)),0)`);
          }
        } else {
          const cash = w.addr(`rvc:${sp.assetId}:cash`);
          for (let t = 0; t < N; t++) {
            const c = cP(t);
            w.fA({ sheet: CAPEX, row: tr, col: c }, `IF(AND(${i1(c)}>=1,${i1(c)}<=${cp()}+${w.ref(`tl:phase:${ph.id}:op`)}+1),MAX(0,${w.refP({ sheet: cash.sheet, row: cash.row, col: c }, CAPEX)}),0)`);
          }
        }
        w.fA({ sheet: CAPEX, row: tr, col: C_TOT }, sumAcross(tr));
        const TT = A(tr, C_TOT);
        for (let t = 0; t < N; t++) w.fA({ sheet: CAPEX, row: r, col: cP(t) }, `IF(${TT}>0,${P(tr, cP(t))}/${TT},${even(cP(t))})`);
      }
      w.fA({ sheet: CAPEX, row: r, col: C_TOT }, sumAcross(r));
    }

    // ── Table 1: ONE ROW PER COST LINE PER ASSET (founder, 2026-10-20) ─────────
    // An asset's plots are pooled: the row is keyed on the asset's first plot that carries the
    // line (every reader sums an asset's rows, so the key is the asset's), its quantity is the
    // asset's (the merged-by-line figure on Land & Area, the land of its plots, the lines it
    // selects, or its sale revenue), and its years spread on the one spend share its plots share,
    // or, where they spread differently, on the blended share above (each plot weighted by its amount).
    const hostLines = new Map<string, string[]>();
    for (const m of pooled.report.inputAssets) hostLines.set(m.assetId, m.lines.map((l) => l.id));
    const chainLineKey = new Map<string, string>();
    for (const l of planReportLines(state, () => true)) for (const id of l.assetIds) chainLineKey.set(id, l.key);
    /** The plot-line that stands for an asset's line: its first plot that carries it. */
    const repOf = (host: string, lid: string): PlotLine | undefined => membersOf(host).map((id) => plotLines.get(`${id}|${lid}`)).find((x): x is PlotLine => !!x);
    const plsOf = (host: string, lid: string): PlotLine[] => membersOf(host).map((id) => plotLines.get(`${id}|${lid}`)).filter((x): x is PlotLine => !!x);
    /** The row each asset's line sits on, keyed by its representative plot. */
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
      if (b.kind === 'ref') { const ref = w.ref(b.key); return b.ifNumber ? `IF(ISNUMBER(${ref}),${ref},0)` : `N(${ref})`; }
      if (b.kind === 'revenue') return w.one(`rvc:${pl.asset.id}:saleRev`);
      return '0';
    };
    /** An asset's quantity: the merged-by-line figure where Land & Area has one, else its plots'. */
    const MERGED: Record<string, string> = { rate_x_main_asset_gfa: 'main', rate_x_parking_area: 'parea', rate_x_landscape_area: 'ls' };
    const assetQty = (host: string, pls: PlotLine[]): string => {
      const rep = pls[0];
      if (rep.base.kind === 'selected') {
        const parts = rep.base.ids.map((id) => rowOf.get(`${rep.asset.id}|${id}`)).filter((x): x is number => x !== undefined).map((rr) => A(rr, C_TOT));
        return parts.length ? parts.join('+') : '0';
      }
      if (pls.length === 1) return plotQty(rep);
      const lk = chainLineKey.get(host);
      const mk = MERGED[rep.method] && lk ? `chainline:${lk}:${MERGED[rep.method]}` : '';
      if (mk && w.has(mk) && pls.every((x) => x.base.kind === 'ref')) { const ref = w.ref(mk); return `IF(ISNUMBER(${ref}),${ref},0)`; }
      return pls.map(plotQty).join('+');
    };
    const rateOf = (pl: PlotLine): string => {
      const ir = pl.rate.kind === 'std' ? 0 : inpRow(pl.asset.id, pl.line.id);
      return pl.rate.kind === 'std' ? w.ref(pl.rate.key) : pl.rate.kind === 'line' ? `N(${inp(firstRow.get(pl.line.id) ?? ir, 3)})` : `N(${inp(ir, 3)})`;
    };
    const rateIn = (pl: PlotLine): string => (PERCENT(pl.method) ? `MIN(MAX(${rateOf(pl)},0),1)` : `MAX(0,${rateOf(pl)})`);

    // The blended spend shares: each plot's weight (its base-year amount) and the weighted share.
    const C_W = C_CHK;
    for (const [host, lids] of hostLines) {
      const ids = membersOf(host);
      const expensed = [...plotLines.values()].filter((x) => x.key.startsWith('cxe:') && ids.includes(x.asset.id)).map((x) => x.line.id);
      for (const lid of [...new Set([...lids, ...expensed])]) {
        const bk = `cxbw:${host}:${lid}`;
        if (!w.has(bk)) continue;
        const br = w.addr(bk).row;
        const wCell = (i: number): number => C_W + i;
        // A weight is base-year money (rate x the plot's quantity); a percentage line charges on its
        // selected lines' ESCALATED money, so each selected weight is lifted by its own factor,
        // the plot's spread of it weighted by the year's escalation.
        const escalated = (id: string, sid: string, i: number): string => {
          const cell = A(w.addr(`cxbw:${host}:${sid}`).row, wCell(i));
          const sp = plan.plotLine.get(`${id}|${sid}`);
          if (!sp?.escalates) return cell; // (at no escalation the factor is 1: the shares sum to 1)
          return `${cell}*SUMPRODUCT(${w.rangeA(CAPEX, w.addr(`cxw:${sp.spread}`).row, cP(0), cP(N - 1))},${w.rangeA(CAPEX, escRow, cP(0), cP(N - 1))})`;
        };
        ids.forEach((id, i) => {
          const pl = plotLines.get(`${id}|${lid}`);
          let f = '0';
          if (pl && !pl.disabled) {
            if (pl.base.kind === 'selected') {
              const parts = pl.base.ids.filter((sid) => w.has(`cxbw:${host}:${sid}`)).map((sid) => escalated(id, sid, i));
              f = parts.length ? `${rateIn(pl)}*(${parts.join('+')})` : '0';
            } else f = `${rateIn(pl)}*${plotQty(pl)}`;
          }
          w.fA({ sheet: CAPEX, row: br, col: wCell(i) }, f);
        });
        const W = ids.map((_, i) => A(br, wCell(i)));
        const spr = ids.map((id) => plan.plotLine.get(`${id}|${lid}`)?.spread);
        const firstSp = spr.find((x): x is string => !!x);
        if (!firstSp) return values(`the blended spend share of ${lid} on ${host} has no spread`);
        for (let t = 0; t < N; t++) {
          const c = cP(t);
          const terms = ids.map((_, i) => (spr[i] ? `${W[i]}*${P(w.addr(`cxw:${spr[i]}`).row, c)}` : '')).filter(Boolean);
          const tot = `SUM(${w.rangeA(CAPEX, br, wCell(0), wCell(ids.length - 1))})`;
          w.fA({ sheet: CAPEX, row: br, col: c }, `IF(${tot}>0,(${terms.join('+')})/${tot},${P(w.addr(`cxw:${firstSp}`).row, c)})`);
        }
        w.fA({ sheet: CAPEX, row: br, col: C_TOT }, sumAcross(br));
      }
    }

    for (const [pk, row] of rowOf) {
      const rep = plotLines.get(pk)!;
      const host = hostOfRep.get(pk)!;
      const pls = plsOf(host, rep.line.id);
      w.claim(rep.key, CAPEX, row, 1);
      // The rate, where the readers find it (the cost line's input or standard).
      const rateCell = rep.rate.kind === 'std' ? w.addr(rep.rate.key)
        : { sheet: INPUTS, row: rep.rate.kind === 'line' ? (firstRow.get(rep.line.id) ?? inpRow(rep.asset.id, rep.line.id)) : inpRow(rep.asset.id, rep.line.id), col: 3 };
      // Named apart from the row keys (cxc:<plot>:<line>), which readers find by prefix.
      w.claim(rep.key.replace(/^cx[ce]:/, 'cxrate:'), rateCell.sheet, rateCell.row, rateCell.col);
      // The basis, with the rate written in.
      const words = capexBasisWords(rep.method);
      if (words) w.fA({ sheet: CAPEX, row, col: 2 }, `TEXT(${rateOf(rep)},"${words.fmt}")&"${words.words}"`);
      // Quantity.
      w.fA({ sheet: CAPEX, row, col: C_QTY }, assetQty(host, pls));
      // The years: one spread its plots share, else the blended share.
      const sps = new Set(pls.map((x) => plan.plotLine.get(`${x.asset.id}|${x.line.id}`)?.spread));
      const pc = plan.plotLine.get(pk);
      const spRow = sps.size > 1 ? (w.has(`cxbw:${host}:${rep.line.id}`) ? w.addr(`cxbw:${host}:${rep.line.id}`).row : undefined)
        : (pc ? w.addr(`cxw:${pc.spread}`).row : undefined);
      if (sps.size > 1 && spRow === undefined) return values(`the plots of ${rep.line.name} on ${host} spread differently and the sheet has no blended share for it`);
      if (pls.some((x) => x.disabled) && !pls.every((x) => x.disabled)) return values(`${rep.line.name} is switched off on some plots of ${host} and not on others`);
      const off = pls.every((x) => x.disabled);
      for (let t = 0; t < N; t++) {
        const c = cP(t);
        if (off || spRow === undefined) { w.valueA({ sheet: CAPEX, row, col: c }, 0); continue; }
        w.fA({ sheet: CAPEX, row, col: c }, `${rateIn(rep)}*${A(row, C_QTY)}*${P(spRow, c)}${pc?.escalates ? `*${P(escRow, c)}` : ''}`);
      }
      w.fA({ sheet: CAPEX, row, col: C_TOT }, sumAcross(row));
    }
    const K = (key: string, col: number): string => w.refA({ sheet: CAPEX, row: w.addr(key).row, col }, CAPEX);
    const KP = (key: string, col: number): string => w.refP({ sheet: CAPEX, row: w.addr(key).row, col }, CAPEX);
    const sumKeys = (key: string, keys: string[]): void => {
      if (!w.has(key)) return;
      const r = w.addr(key).row;
      for (let t = 0; t < N; t++) w.fA({ sheet: CAPEX, row: r, col: cP(t) }, keys.length ? keys.map((k) => KP(k, cP(t))).join('+') : '0');
      w.fA({ sheet: CAPEX, row: r, col: C_TOT }, sumAcross(r));
    };
    const t1Keys = (host: string): string[] => (hostLines.get(host) ?? []).map((lid) => `cx1:${host}:${lid}`).filter((k) => w.has(k));
    for (const host of hostLines.keys()) {
      sumKeys(`cx1sub:${host}`, t1Keys(host));
      // The input profile above: each year's share of the line's total.
      for (const lid of hostLines.get(host) ?? []) {
        const k1 = `cx1:${host}:${lid}`, ki = `cxin:${host}:${lid}`;
        if (!w.has(k1) || !w.has(ki)) continue;
        // The cost line's rate, read where it is typed (Inputs or the cost standard row).
        const rep = repOf(host, lid);
        if (rep) w.f(ki, rateOf(rep), { col: C_RATE });
        const ri = w.addr(ki).row;
        for (let t = 0; t < N; t++) w.fA({ sheet: CAPEX, row: ri, col: cP(t) }, `IF(${K(k1, C_TOT)}=0,0,${KP(k1, cP(t))}/${K(k1, C_TOT)})`);
        w.fA({ sheet: CAPEX, row: ri, col: C_TOT }, sumAcross(ri));
        w.fA({ sheet: CAPEX, row: ri, col: C_CHK }, `IF(ABS(${A(ri, C_TOT)}-IF(${K(k1, C_TOT)}<>0,1,0))<=0.0001,"OK","CHECK")`);
      }
    }
    const hosts = [...hostLines.keys()].filter((h) => w.has(`cx1sub:${h}`));
    if (w.has('cx1e:total')) {
      const er = [...plotLines.entries()].filter(([, x]) => x.key.startsWith('cxe:')).map(([pk]) => rowOf.get(pk)).filter((x): x is number => x !== undefined).sort((x, y) => x - y);
      const r = w.addr('cx1e:total').row;
      for (let t = 0; t < N; t++) w.fA({ sheet: CAPEX, row: r, col: cP(t) }, er.length ? er.map((rr) => P(rr, cP(t))).join('+') : '0');
      w.fA({ sheet: CAPEX, row: r, col: C_TOT }, sumAcross(r));
    }
    sumKeys('cx1:total', hosts.map((h) => `cx1sub:${h}`));

    // ── Tables 2 to 4: a line's series incl, excl in-kind land, excl all land value ─
    const lineById = new Map(costLines.map((l) => [l.id, l] as const));
    const landKeys = (host: string, pred: (l: CostLine) => boolean): string[] => t1Keys(host).filter((k) => { const l = lineById.get(k.split(':')[2]); return !!l && pred(l); });
    const isInKindLand = (l: CostLine): boolean => isLandValueLine(l) && l.method === 'percent_of_inkind_land';
    const isCashLand = (l: CostLine): boolean => isLandValueLine(l) && l.method === 'percent_of_cash_land';
    const seriesTerm = (host: string, kind: 'incl' | 'exclInKind' | 'exclAll', c: number): string => {
      const minus = kind === 'incl' ? [] : landKeys(host, kind === 'exclInKind' ? isInKindLand : (l) => isLandValueLine(l));
      return `${KP(`cx1sub:${host}`, c)}${minus.map((k) => `-${KP(k, c)}`).join('')}`;
    };
    const phaseOfHost = (h: string): string => state.assets.find((a) => a.id === h)?.phaseId ?? '';
    for (const [pfx, kind] of [['cx2', 'incl'], ['cx3', 'exclInKind'], ['cx4', 'exclAll']] as const) {
      const inTable = hosts.filter((h) => w.has(`${pfx}:${h}`));
      for (const h of inTable) {
        const r = w.addr(`${pfx}:${h}`).row;
        for (let t = 0; t < N; t++) w.fA({ sheet: CAPEX, row: r, col: cP(t) }, seriesTerm(h, kind, cP(t)));
        w.fA({ sheet: CAPEX, row: r, col: C_TOT }, sumAcross(r));
      }
      for (const ph of phases) sumKeys(`${pfx}sub:${ph.id}`, inTable.filter((h) => phaseOfHost(h) === ph.id).map((h) => `${pfx}:${h}`));
      sumKeys(`${pfx}:total`, inTable.map((h) => `${pfx}:${h}`));
    }

    // ── Table 5: land cash and in-kind by phase, and the memo of the rest of the land stage ─
    const byPhase = (phId: string, pred: (l: CostLine) => boolean): string[] => hosts.filter((h) => phaseOfHost(h) === phId).flatMap((h) => landKeys(h, pred));
    const isMemo = (l: CostLine): boolean => deriveCostStage(l) === 'land' && !isLandValueLine(l);
    const cashK: string[] = [], inkK: string[] = [], memoK: string[] = [];
    for (const ph of phases) {
      if (w.has(`cx5:${ph.id}:cash`)) { sumKeys(`cx5:${ph.id}:cash`, byPhase(ph.id, isCashLand)); cashK.push(`cx5:${ph.id}:cash`); }
      if (w.has(`cx5:${ph.id}:inkind`)) { sumKeys(`cx5:${ph.id}:inkind`, byPhase(ph.id, isInKindLand)); inkK.push(`cx5:${ph.id}:inkind`); }
      sumKeys(`cx5:${ph.id}:sub`, [`cx5:${ph.id}:cash`, `cx5:${ph.id}:inkind`].filter((k) => w.has(k)));
      if (w.has(`cx5memo:${ph.id}`)) { sumKeys(`cx5memo:${ph.id}`, byPhase(ph.id, isMemo)); memoK.push(`cx5memo:${ph.id}`); }
    }
    if (w.has('cx5:total:cash')) { sumKeys('cx5:total:cash', cashK); sumKeys('cx5:total:inkind', inkK); sumKeys('cx5:total:land', ['cx5:total:cash', 'cx5:total:inkind']); }
    if (w.has('cx5memo:total')) { sumKeys('cx5memo:total', memoK); sumKeys('cx5:stage', ['cx5:total:land', 'cx5memo:total']); }

    // ── Table 6: by category, incl all land and excl total land ─────────────
    const catOf = (h: string): string => assetCapexSection(state.assets.find((a) => a.id === h)!, project);
    for (const ti of [0, 1]) {
      const catKeys: string[] = [];
      for (const key of reg.keys().filter((k) => k.startsWith(`cx6:${ti}:`) && k !== `cx6:${ti}:total`)) {
        const label = key.slice(`cx6:${ti}:`.length);
        const hs = hosts.filter((h) => catOf(h) === label);
        const r = w.addr(key).row;
        for (let t = 0; t < N; t++) w.fA({ sheet: CAPEX, row: r, col: cP(t) }, hs.length ? hs.map((h) => seriesTerm(h, ti === 0 ? 'incl' : 'exclAll', cP(t))).join('+') : '0');
        w.fA({ sheet: CAPEX, row: r, col: C_TOT }, sumAcross(r));
        catKeys.push(key);
      }
      sumKeys(`cx6:${ti}:total`, catKeys);
    }

    // ── The consolidated view: one row per line, the stage columns summed from Table 1 ─
    const treatIds = new Set(capex.treatment.map((t) => t.id));
    const stageCols: Array<[string, number]> = [['land', C_OPEN], ['hard', C_OPEN + 1], ['soft', C_OPEN + 2], ['marketing', C_OPEN + 3], ['operating', C_OPEN + 4]];
    const cTotalCons = C_OPEN + 5;
    const hostOfAsset = new Map<string, string>();
    for (const [host, ids] of members) for (const id of ids) hostOfAsset.set(id, host);
    const consKeys: string[] = [];
    for (const pl of planReportLines(state, (a) => treatIds.has(a.id))) {
      const key = `cxcons:${pl.key}`; if (!w.has(key)) continue;
      const host = pl.assetIds.find((id) => hostLines.has(id)) ?? hostOfAsset.get(pl.assetIds[0]);
      if (!host) continue;
      consKeys.push(key);
      for (const [stage, col] of stageCols) {
        const ks = t1Keys(host).filter((k) => { const l = lineById.get(k.split(':')[2]); return !!l && deriveCostStage(l) === stage; });
        w.f(key, ks.length ? ks.map((k) => K(k, C_TOT)).join('+') : '0', { col });
      }
      w.f(key, stageCols.map(([, col]) => K(key, col)).join('+'), { col: cTotalCons });
    }
    if (w.has('cxcons:total')) {
      for (const [, col] of [...stageCols, ['total', cTotalCons] as [string, number]]) w.f('cxcons:total', consKeys.length ? consKeys.map((k) => K(k, col)).join('+') : '0', { col });
      const tot = K('cxcons:total', cTotalCons), proj = K('cx1:total', C_TOT);
      w.fA(w.addr('cxcons:tie'), `IF(ABS(${tot}-${proj})<0.005,"Ties to the per-asset total: "&TEXT(${proj},"#,##0.00")&".","Does NOT tie to the per-asset total ("&TEXT(${proj},"#,##0.00")&"), out by "&TEXT(${tot}-${proj},"#,##0.00")&". Treat the per-asset tables as authoritative.")`);
    }

    // The check row: every cost line total summed.
    const allT1 = [...hostLines.keys()].flatMap((h) => t1Keys(h));
    w.f('cx:check', allT1.map((k) => K(k, C_TOT)).join('+'));

    const pending = [...w.pending].filter((a) => a.startsWith(`${CAPEX}!`));
    return [{
      sheet: CAPEX, status: pending.length ? 'partial' as const : 'live' as const, formulas: w.formulas.get(CAPEX) ?? 0, pending,
      note: 'Live: every cost line on every plot (rate from Inputs or the cost standards, quantity from Land & Area, Revenue or the lines it selects, years from the spend shares and the escalation factor above), each line the total of its plots, Tables 1 to 6, the consolidated view and the check row. The spread windows, rates and curves are typed on Inputs.',
    }];
  },
};
